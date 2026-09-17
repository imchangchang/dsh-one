#!/usr/bin/env node
/**
 * 旧侧栏 × 现装配侧栏「并排渲染对照」harness（issue #129）。
 *
 * 做什么：把**退役但仍在仓库里**的旧侧栏（`src/ui/sessionsView.ts` +
 * `src/ui/sessionsWebview.ts`）独立渲染出来，与**现装配侧栏**（`.dshOneTree_*`，
 * 装配页 `/sidebar`）在**同一份数据、同一宽度**下并排截图，并逐项读
 * `getBoundingClientRect` / computed style 量几何。结论写进
 * `docs/legacy-vs-current-sidebar-render.md`。
 *
 * 两侧各自怎么拿到页面（都不抄模板、用的都是仓库里的真代码）：
 * - **旧侧栏**：`legacyPage.ts` 打桩 `vscode` 之后调真的
 *   `SessionsViewProvider.resolveWebviewView()`——HTML 骨架、`SESSIONS_STYLE`、译文
 *   注入与 `dist/sessionsWebview.js` 全是那份代码的产物；数据由
 *   `postMessage({type:'sessions', snapshot})` 灌进去（旧侧栏本来就是宿主推快照的形态）。
 * - **现装配侧栏**：复用装配实验室（`test/assembly-lab/`）——真装配页 + 真网关 + 假宿主。
 *
 * 两侧的数据来自**同一次**只读网关读取（`session/list` 与 `workspace/follow`），再各按
 * 自己的原生通道喂进去（旧侧栏吃 `SessionsSnapshot`；现装配侧吃假宿主的 `stateRead` 键值
 * 与官方客户端的 `localStorage` 视图态）。两侧「怎么读数据」是真的不一样，所以 harness
 * 不硬塞同一棵 DOM 给两边，只保证喂进去的是同一批事实。
 *
 * 只读纪律：全程不喂 prompt、不新建会话、不改任何状态；旧侧栏的动作消息（打开 / 新建 /
 * 重命名 / 回收站…）**一律不实现**（点了不报错）；现装配侧的动作只在假宿主里落空。
 * 轻量守卫见本文件末尾的「网关会话数跑前跑后一致」。
 *
 * 用法（跑法与端口见同目录 README）：
 *   npm run verify:legacy-sidebar                    # 自己起一个 dsh 实例，跑完立刻收掉
 *   LEGACY_GATEWAY=http://127.0.0.1:3080 LEGACY_TOKEN=… npm run verify:legacy-sidebar
 *   LEGACY_HEADED=1 npm run verify:legacy-sidebar    # 开有界面的浏览器看现场
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { openTreePage } from '../assembly-lab/harness.ts'
import { consoleLogger, defaultPluginsDir, LAB_TREES, startLabServer, type LabServer, type LabTreeRoute } from '../assembly-lab/labServer.ts'
import type { Logger } from '../../src/log.ts'
import { listSessions } from '../../src/server/dshRpc.ts'
import { buildLegacyPage, startLegacyServer } from './legacyPage.ts'
import { bundle } from './l10n.ts'
import {
  currentSideHostState,
  fetchGatewayModel,
  legacySnapshot,
  userFacts,
  type GatewayModel,
  type LegacySnapshotInput,
  type UserFacts,
} from './snapshot.ts'
import { vscodeThemeCss } from './theme.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, 'out')
const SHOTS = path.join(OUT, 'shots')
const WIDTHS = [260, 340, 500] as const
/** 量几何与截图时用的主宽度（文档表格里那一列）。 */
const REPORT_WIDTH = 340
const HEIGHT = 900

/* ---------------------------------------------------------------------------
 * 断言与观测收集
 * ------------------------------------------------------------------------ */

interface Check {
  label: string
  ok: boolean
  detail: string
}

const checks: Check[] = []
const facts: string[] = []

function check(label: string, ok: boolean, detail = ''): boolean {
  checks.push({ label, ok: Boolean(ok), detail: String(detail) })
  return Boolean(ok)
}

function fact(line: string): void {
  facts.push(line)
}

/* ---------------------------------------------------------------------------
 * 网关：自己起一个隔离实例，跑完立刻收掉
 * ------------------------------------------------------------------------ */

interface GatewayHandle {
  origin: string
  token: string
  dispose(): Promise<void>
}

async function ensureGateway(): Promise<GatewayHandle> {
  const given = process.env.LEGACY_GATEWAY ?? process.env.LAB_GATEWAY
  if (given !== undefined && given !== '') {
    const token = process.env.LEGACY_TOKEN ?? process.env.LAB_TOKEN
    if (token === undefined || token === '') {
      throw new Error('LEGACY_GATEWAY 给了但没给 LEGACY_TOKEN（复用已有实例时必须带 launch token）')
    }
    fact(`网关：复用调用方给的实例 ${given}`)
    return { origin: given, token, dispose: async () => undefined }
  }

  const port = process.env.LEGACY_GATEWAY_PORT ?? '0'
  const child: ChildProcess = spawn('dsh', ['web', '--host', '127.0.0.1', '--port', port, '--no-open'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const url = await new Promise<string>((resolve, reject) => {
    let buffer = ''
    let done = false
    const timer = setTimeout(() => {
      if (done) return
      done = true
      reject(new Error(`dsh web 起不来（20s 内没打出带 token 的地址）；输出：${buffer.slice(-400)}`))
    }, 20_000)
    const sweep = (chunk: Buffer): void => {
      buffer += chunk.toString()
      const match = /http:\/\/127\.0\.0\.1:(\d+)\/\?token=([A-Za-z0-9_-]+)/.exec(buffer)
      if (match !== null && !done) {
        done = true
        clearTimeout(timer)
        resolve(match[0])
      }
    }
    child.stdout?.on('data', sweep)
    child.stderr?.on('data', sweep)
    child.on('exit', (code) => {
      if (done) return
      done = true
      clearTimeout(timer)
      reject(new Error(`dsh web 提前退出（code=${String(code)}）：${buffer.slice(-400)}`))
    })
  })
  const parsed = new URL(url)
  const origin = `${parsed.protocol}//${parsed.host}`
  fact(`网关：本 harness 自己起的 \`dsh web --host 127.0.0.1 --port ${port} --no-open\`（${origin}，跑完立刻收掉）`)
  return {
    origin,
    token: parsed.searchParams.get('token') ?? '',
    dispose: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve()
          return
        }
        child.once('exit', () => resolve())
        child.kill('SIGTERM')
        setTimeout(() => {
          if (child.exitCode === null) child.kill('SIGKILL')
        }, 5_000)
      }),
  }
}

/* ---------------------------------------------------------------------------
 * 旧侧栏那一页
 * ------------------------------------------------------------------------ */

/**
 * 页面侧的 `acquireVsCodeApi`（VS Code 在 webview 里预置的那件东西的替身）。
 * 页面发回的动作消息只记进 `__legacySent`——本 harness 只渲染，动作一律不实现。
 */
const ACQUIRE_STUB =
  'window.acquireVsCodeApi = () => ({ postMessage(message) { (globalThis.__legacySent ??= []).push(message) } })'

interface OpenedLegacy {
  context: BrowserContext
  page: Page
  errors: string[]
}

async function openLegacyPage(browser: Browser, origin: string, snapshot: unknown): Promise<OpenedLegacy> {
  const context = await browser.newContext({ viewport: { width: WIDTHS[0], height: HEIGHT }, deviceScaleFactor: 2 })
  await context.addInitScript({ content: ACQUIRE_STUB })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.goto(origin)
  // 主题变量必须在页面脚本跑完后来贴：旧侧栏只认 `--vscode-*`，不给这组变量，
  // `font-family` / `font-size` / `color` 全落浏览器初值（取值与出处见 theme.ts）。
  await page.addStyleTag({ content: vscodeThemeCss() })
  await page.waitForTimeout(200)
  await page.evaluate((snap: unknown) => {
    window.postMessage({ type: 'sessions', snapshot: snap }, '*')
  }, snapshot)
  await page.waitForTimeout(300)
  return { context, page, errors }
}

/* ---------------------------------------------------------------------------
 * 现装配侧栏那一页
 * ------------------------------------------------------------------------ */

/**
 * 页内夹具：把 `workspace/follow` 的工作区清单改成空（零工作区空态用）。
 *
 * 与装配实验室 F-18 同一手法（改的是**页面收到的帧**，请求不落到网关）：先把
 * `open` 帧的 streamId → endpoint 记下来，再把工作区基线的 `items` 清空、其余
 * 工作区增量帧一律丢掉——两种处置合起来，页面上冒不出工作区。
 */
async function installEmptyWorkspacesFixture(page: Page): Promise<void> {
  await page.routeWebSocket(/remote\.mux/, (socket) => {
    const upstream = socket.connectToServer()
    const endpoints = new Map<string, string>()
    socket.onMessage((message) => {
      try {
        const frame = JSON.parse(String(message)) as { type?: string; streamId?: string; endpoint?: string }
        if (frame.type === 'open' && frame.streamId !== undefined && frame.endpoint !== undefined) {
          endpoints.set(frame.streamId, frame.endpoint)
        }
      } catch {
        /* 客户端帧形状变了就原样转发，夹具不参与协议解读 */
      }
      upstream.send(message)
    })
    upstream.onMessage((message) => {
      let frame: { streamId?: string; type?: string; value?: { value?: { items?: unknown[] } } } | undefined
      try {
        frame = JSON.parse(String(message)) as typeof frame
      } catch {
        frame = undefined
      }
      const endpoint = frame?.streamId === undefined ? undefined : endpoints.get(frame.streamId)
      if (endpoint !== 'workspace/follow') {
        socket.send(message)
        return
      }
      const items = frame?.value?.value?.items
      if (frame === undefined || frame.type !== 'item' || !Array.isArray(items)) return
      items.length = 0
      socket.send(JSON.stringify(frame))
    })
  })
}

/* ---------------------------------------------------------------------------
 * 状态表：每个状态在两侧各怎么造出来
 * ------------------------------------------------------------------------ */

const t = (key: string): string => bundle()[key] ?? key

const LEGACY_SESSION_ROW = '.sessions-list .session-row'
const CURRENT_SESSION_ROW = '[data-dshone-tree-row="session"]'

/** 右击第一行会话开菜单（两侧同一个动作，选择器不同）。 */
async function openSessionMenu(page: Page, selector: string): Promise<void> {
  await page.locator(selector).first().click({ button: 'right' })
  await page.waitForTimeout(300)
}

/** 在已经开着的菜单里按文案点一项。 */
async function clickByText(page: Page, root: string, text: string): Promise<void> {
  await page.locator(root).filter({ hasText: text }).last().click({ timeout: 5_000 })
  await page.waitForTimeout(300)
}

/** 点同一枚开关 N 次（现装配侧的「折叠/展开全部」是同一枚按钮）。 */
async function clickTimes(page: Page, selector: string, times: number): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await page.locator(selector).first().click()
    await page.waitForTimeout(200)
  }
}

/** 旧侧栏快照的「改哪几项」；`model` 与默认值由主流程补齐。 */
type LegacyOverrides = Partial<Omit<LegacySnapshotInput, 'model'>>

interface StateSpec {
  id: string
  name: string
  legacy: (uf: UserFacts) => LegacyOverrides
  /** 现装配侧：假宿主的 `stateRead` 键值。 */
  currentState: (uf: UserFacts) => Record<string, unknown>
  /**
   * 现装配侧的**官方客户端视图态**（localStorage `dsh.workspaceTree.view`）要显式声明的
   * 展开集合；返回 null = 用它的开箱默认（只展开当前会话那一组）。
   */
  currentExpanded?: (uf: UserFacts) => string[] | null
  /** 打开页之后的界面驱动（旧侧栏：菜单/多选/抽屉；现装配侧：同义的界面动作）。 */
  driveLegacy?: (page: Page) => Promise<void>
  driveCurrent?: (page: Page) => Promise<void>
  /** 这一态要装「零工作区」页内夹具（现装配侧）。 */
  emptyWorkspaces?: boolean
  /** 这一态要看的是标签组块：截图前把组块滚进视野（两侧滚的是同一棵工作区的组块）。 */
  focusTag?: boolean
  /** 这一态什么时候造不出来（数据不足等）。 */
  skipWhen?: (uf: UserFacts) => string | null
}

/** 组头勾选全选（旧侧栏的组头勾选框与现装配侧的组头框）。 */
const STATES: readonly StateSpec[] = [
  {
    id: 'default',
    name: '默认态（两边都展开到同一批行）',
    legacy: () => ({ collapsed: [] }),
    currentState: (uf) => hostState(uf),
    // 现装配侧开箱默认只展开当前会话那一组（#128 的 C-1），这里把官方客户端的视图态
    // 显式写成「全部展开」——只是把两边摆到同一批行上，好让逐行几何可比。
    currentExpanded: (uf) => [...uf.collapsedAll],
  },
  {
    id: 'default-native',
    name: '开箱默认（各按各的默认展开态）',
    legacy: () => ({ collapsed: [] }),
    currentState: (uf) => hostState(uf),
    // 这一对**故意不同**：旧侧栏开箱全展开，现装配侧默认折叠、只把当前会话那一组展开。
    // 它就是 #128 的 C-1 那一条的现场。
  },
  {
    id: 'collapsed',
    name: '折叠态（所有工作区都收起）',
    legacy: (uf) => ({ collapsed: [...uf.collapsedAll] }),
    currentState: (uf) => hostState(uf),
    // 先把「全部展开」写进视图态，再点一次折叠全部——这样收到的一定是全部工作区，
    // 而不是「从未显式展开过」的那种默认态。
    currentExpanded: (uf) => [...uf.collapsedAll],
    driveCurrent: (page) => clickTimes(page, '[data-dshone-tree-action="collapse-all"]', 1),
  },
  {
    id: 'multi-select',
    name: '多选态（组头勾选框全选）',
    legacy: () => ({ collapsed: [] }),
    currentState: (uf) => hostState(uf),
    currentExpanded: (uf) => [...uf.collapsedAll],
    skipWhen: (uf) => (uf.flat.length === 0 ? '网关数据里没有可勾选的会话' : null),
    // 两侧各走自己的入口：旧侧栏只有会话行菜单里的「选择多个」，现装配侧顶栏有一枚常驻入口
    // （#108 新增），组头三态全选两侧都有。
    driveLegacy: async (page) => {
      await openSessionMenu(page, LEGACY_SESSION_ROW)
      await clickByText(page, '.popover .menu-item', t('Select multiple'))
      await page.locator('.workspace-row .select-checkbox input').first().click()
      await page.waitForTimeout(300)
    },
    driveCurrent: async (page) => {
      await page.locator('[data-dshone-tree-action="select-mode"]').first().click()
      await page.waitForTimeout(300)
      // 别默认「第一组一定勾得上」：当天数据里**当前工作区可能一条能勾的会话都没有**
      //（那一组的组头框是灰的，Playwright 点不动，整轮 harness 会卡在这里超时崩掉——
      // 2026-09-17 实测：当前工作区 dsh_kb 的组头框 `aria-disabled="true"`）。所以改挑
      // 第一枚**能点的**组头框：数据健康时它就是原来那枚（第一组），行为一字未变；
      // 一枚都挑不出来时不点（这一态在现装配侧停在「刚进选择态」的样子，几何按「缺一侧」记，
      // 与别的缺数据情形同一条口径），并留一条事实说明原因。
      const box = page.locator('[data-dshone-tree-action="group-select"]:not([aria-disabled="true"])').first()
      if ((await box.count()) === 0) {
        fact('多选态：当天数据里没有一组能勾（组头框全灰）——现装配侧不点组头，这一态的几何按「缺一侧」记')
        return
      }
      await box.click()
      await page.waitForTimeout(300)
    },
  },
  {
    id: 'tag-groups',
    name: '标签组态（组块 = pill + 贯穿竖线 + 组内缩进）',
    legacy: (uf) => ({ collapsed: [], tags: uf.tags }),
    currentState: (uf) => hostState(uf, { tags: true }),
    currentExpanded: (uf) => [...uf.collapsedAll],
    skipWhen: (uf) => (uf.tags.length === 0 ? '网关数据里挑不出一棵工作区有足够多的非置顶会话可归组' : null),
    focusTag: true,
  },
  {
    id: 'recycle-drawer',
    name: '回收站抽屉展开（按原工作区分块）',
    legacy: (uf) => ({ collapsed: [], recycleBin: uf.recycleBin }),
    currentState: (uf) => hostState(uf, { recycle: true }),
    currentExpanded: (uf) => [...uf.collapsedAll],
    skipWhen: (uf) => (uf.recycleBin.length === 0 ? '网关数据凑不出可回收会话' : null),
    driveLegacy: async (page) => {
      await page.locator('.recycle-entry-main').click()
      await page.waitForTimeout(500)
    },
    driveCurrent: async (page) => {
      await page.locator('[data-dshone-tree-action="recycle-toggle"]').first().click()
      await page.waitForTimeout(600)
    },
  },
  {
    id: 'empty',
    name: '空态（零工作区）',
    legacy: () => ({ collapsed: [], noWorkspaces: true }),
    currentState: (uf) => hostState(uf),
    currentExpanded: (uf) => [...uf.collapsedAll],
    emptyWorkspaces: true,
  },
  {
    id: 'menu-l1',
    name: '右键菜单一级（会话行菜单）',
    legacy: () => ({ collapsed: [] }),
    currentState: (uf) => hostState(uf),
    currentExpanded: (uf) => [...uf.collapsedAll],
    skipWhen: (uf) => (uf.flat.length === 0 ? '网关数据里没有会话行可开菜单' : null),
    driveLegacy: (page) => openSessionMenu(page, LEGACY_SESSION_ROW),
    driveCurrent: (page) => openSessionMenu(page, CURRENT_SESSION_ROW),
  },
  {
    id: 'menu-l2',
    name: '右键菜单二级（「移到分组…」展开）',
    legacy: (uf) => ({ collapsed: [], tags: uf.tags }),
    currentState: (uf) => hostState(uf, { tags: true }),
    currentExpanded: (uf) => [...uf.collapsedAll],
    skipWhen: (uf) => (uf.tags.length === 0 ? '这一行没有标签组入口，二级菜单不出现' : null),
    focusTag: true,
    // 二级菜单只有「这一行所属工作区有标签组」时才出现（现装配侧整天不出现、旧侧栏恒出现
    // 但内容为空），所以两边都右击**标签组块里的那一行**——两侧的组块成员是同一批会话。
    driveLegacy: async (page) => {
      await openSessionMenu(page, '.tag-group .session-row')
      await clickByText(page, '.popover .menu-item', t('Move to group…'))
    },
    driveCurrent: async (page) => {
      await openSessionMenu(page, '.dshOneTree_tagRows [data-dshone-tree-row="session"]')
      await page.locator('[data-dshone-tree-item="moveToGroup"]').first().click()
      await page.waitForTimeout(300)
    },
  },
]

/** 现装配侧的假宿主状态（`stateRead` 的键值，形状见 `snapshot.ts`）。 */
function hostState(uf: UserFacts, extra: { tags?: boolean; recycle?: boolean } = {}): Record<string, unknown> {
  return currentSideHostState({
    pinned: uf.pinned,
    unread: uf.unread,
    tags: extra.tags === true ? uf.tags : [],
    recycleBin: extra.recycle === true ? uf.recycleBin : [],
  })
}

/* ---------------------------------------------------------------------------
 * 几何：指标表 + 取数
 * ------------------------------------------------------------------------ */

type Measure =
  | { kind: 'rect'; part: 'height' | 'width' }
  | { kind: 'style'; prop: string }
  | { kind: 'gap'; axis: 'y' | 'x' }
  | { kind: 'box' }
  /**
   * 第一个匹配元素**文字**左缘 − `minus` 匹配元素**文字**左缘（层级缩进那一类）。
   *
   * 为什么量文字而不是量盒子：缩进常常做成元素自己的 padding（盒子左缘一点都不动，
   * 动的是里面的字），量盒子会读成 0。用 Range 取内容盒才是「字真的往里挪了多少」。
   */
  | { kind: 'indent' }
  /**
   * 第一个匹配元素**文字**左缘 − `minus` 匹配元素**盒子**右缘（#143：子项文字与父项图标槽
   * 右缘那一条关系——图标槽里没有文字，量它的右缘只能取盒子）。
   */
  | { kind: 'textFromBoxRight' }

interface SideSpec {
  selector: string
  /** `indent` / `textFromBoxRight` 用的基准元素（同页里另一个选择器）。 */
  minus?: string
}

interface Metric {
  id: string
  /** 在哪个状态下量（对应 `STATES[].id`）。 */
  state: string
  label: string
  legacy: SideSpec
  current: SideSpec
  measure: Measure
  note?: string
}

const metrics: readonly Metric[] = [
  // ---- 行几何（默认态） ----
  { id: 'session-row-height', state: 'default', label: '会话行高', legacy: { selector: '.session-row' }, current: { selector: '.dshOneTree_sessionRow' }, measure: { kind: 'rect', part: 'height' } },
  { id: 'session-row-radius', state: 'default', label: '会话行圆角', legacy: { selector: '.session-row' }, current: { selector: '.dshOneTree_sessionRow' }, measure: { kind: 'style', prop: 'border-radius' } },
  { id: 'session-row-padding-left', state: 'default', label: '会话行左内边距', legacy: { selector: '.session-row' }, current: { selector: '.dshOneTree_sessionRow' }, measure: { kind: 'style', prop: 'padding-left' } },
  { id: 'session-row-padding-right', state: 'default', label: '会话行右内边距', legacy: { selector: '.session-row' }, current: { selector: '.dshOneTree_sessionRow' }, measure: { kind: 'style', prop: 'padding-right' } },
  { id: 'session-row-margin-left', state: 'default', label: '会话行左边距', legacy: { selector: '.session-row' }, current: { selector: '.dshOneTree_sessionRow' }, measure: { kind: 'style', prop: 'margin-left' } },
  { id: 'session-row-gap', state: 'default', label: '会话行间距（相邻两行）', legacy: { selector: '.session-row' }, current: { selector: '.dshOneTree_sessionRow' }, measure: { kind: 'gap', axis: 'y' } },
  { id: 'session-title-font', state: 'default', label: '会话标题字号', legacy: { selector: '.session-title' }, current: { selector: '.dshOneTree_title' }, measure: { kind: 'style', prop: 'font-size' } },
  { id: 'session-title-line', state: 'default', label: '会话标题行高', legacy: { selector: '.session-title' }, current: { selector: '.dshOneTree_title' }, measure: { kind: 'style', prop: 'line-height' } },
  { id: 'workspace-row-height', state: 'default', label: '工作区行高', legacy: { selector: '.workspace-row' }, current: { selector: '.dshOneTree_projectRow' }, measure: { kind: 'rect', part: 'height' } },
  { id: 'workspace-row-radius', state: 'default', label: '工作区行圆角', legacy: { selector: '.workspace-row' }, current: { selector: '.dshOneTree_projectRow' }, measure: { kind: 'style', prop: 'border-radius' } },
  { id: 'workspace-row-padding-left', state: 'default', label: '工作区行左内边距', legacy: { selector: '.workspace-row' }, current: { selector: '.dshOneTree_projectRow' }, measure: { kind: 'style', prop: 'padding-left' } },
  { id: 'workspace-label-font', state: 'default', label: '工作区名字号', legacy: { selector: '.workspace-label' }, current: { selector: '.dshOneTree_projectText .dshOneTree_title' }, measure: { kind: 'style', prop: 'font-size' } },
  { id: 'group-gap', state: 'default', label: '组间距（相邻两个工作区块）', legacy: { selector: '.workspace-group' }, current: { selector: '.dshOneTree_groupSection' }, measure: { kind: 'gap', axis: 'y' } },
  { id: 'icon-slot', state: 'default', label: '行首图标位（文件夹/箭头）', legacy: { selector: '.ws-folder' }, current: { selector: '.dshOneTree_folder' }, measure: { kind: 'box' } },
  { id: 'icon-slot-slot', state: 'default', label: '会话行首图标位（状态槽）', legacy: { selector: '.session-row .session-rear' }, current: { selector: '.dshOneTree_sessionRow .dshOneTree_slot' }, measure: { kind: 'box' }, note: '旧侧栏的状态标记在**行尾**、现装配侧在**行首**（#128 A4）——这里量的是同一个「状态标记外框」，位置差异看截图' },
  { id: 'status-dot', state: 'default', label: '未读状态点尺寸', legacy: { selector: '.session-dot' }, current: { selector: '.dshOneTree_dot' }, measure: { kind: 'box' } },
  { id: 'pin-size', state: 'default', label: '置顶图钉尺寸', legacy: { selector: '.session-pin' }, current: { selector: '.dshOneTree_pin' }, measure: { kind: 'box' } },
  { id: 'row-action-button', state: 'default', label: '行尾动作按钮（⋯）', legacy: { selector: '.session-row:hover .row-action' }, current: { selector: '.dshOneTree_sessionRow:hover .dshOneTree_rowIconButton' }, measure: { kind: 'box' }, note: '这一项要悬停才量得到（两侧的行尾动作按钮都是 hover 才出现），所以量它之前先把第一行会话悬停住' },
  { id: 'workspace-badge', state: 'default', label: '当前工作区小胶囊', legacy: { selector: '.workspace-row .workspace-badge' }, current: { selector: '.dshOneTree_workspaceBadge' }, measure: { kind: 'box' } },

  // ---- 顶栏骨架（默认态） ----
  { id: 'topbar-height', state: 'default', label: '顶栏高度', legacy: { selector: '.sessions-header' }, current: { selector: '.dshOneTree_sectionHeader' }, measure: { kind: 'rect', part: 'height' } },
  { id: 'topbar-icon-button', state: 'default', label: '顶栏图标按钮', legacy: { selector: '.sessions-header .sessions-tool' }, current: { selector: '.dshOneTree_sectionHeader .dshOneTree_iconButton' }, measure: { kind: 'box' } },
  { id: 'search-height', state: 'default', label: '搜索框高度', legacy: { selector: '.sessions-search' }, current: { selector: '.dshOneTree_search' }, measure: { kind: 'rect', part: 'height' }, note: '现装配侧的搜索栏常驻官方那套 UI 的**展开态**（#99），旧侧栏是常显输入框' },
  { id: 'search-radius', state: 'default', label: '搜索框圆角', legacy: { selector: '.sessions-search' }, current: { selector: '.dshOneTree_search' }, measure: { kind: 'style', prop: 'border-radius' } },

  // ---- 分组过滤胶囊（默认态） ----
  { id: 'pill-height', state: 'default', label: '分组过滤胶囊高', legacy: { selector: '.ws-group-select' }, current: { selector: '.dshOneTree_pill' }, measure: { kind: 'rect', part: 'height' } },
  { id: 'pill-radius', state: 'default', label: '分组过滤胶囊圆角', legacy: { selector: '.ws-group-select' }, current: { selector: '.dshOneTree_pill' }, measure: { kind: 'style', prop: 'border-radius' } },
  { id: 'pill-font', state: 'default', label: '分组过滤胶囊字号', legacy: { selector: '.ws-group-select' }, current: { selector: '.dshOneTree_pill' }, measure: { kind: 'style', prop: 'font-size' } },

  // ---- 列表容器（默认态） ----
  { id: 'list-padding-left', state: 'default', label: '列表左内边距', legacy: { selector: '.sessions-list' }, current: { selector: '.dshOneTree_list' }, measure: { kind: 'style', prop: 'padding-left' } },
  { id: 'list-padding-bottom', state: 'default', label: '列表下内边距', legacy: { selector: '.sessions-list' }, current: { selector: '.dshOneTree_list' }, measure: { kind: 'style', prop: 'padding-bottom' } },

  // ---- 回收站入口行（默认态） ----
  { id: 'recycle-entry-height', state: 'default', label: '回收站入口行高', legacy: { selector: '.recycle-entry' }, current: { selector: '.dshOneTree_footerRow' }, measure: { kind: 'rect', part: 'height' } },
  { id: 'recycle-entry-icon-button', state: 'default', label: '回收站入口动作按钮', legacy: { selector: '.recycle-entry .sessions-tool' }, current: { selector: '.dshOneTree_footerIconButton' }, measure: { kind: 'box' } },
  { id: 'recycle-entry-font', state: 'default', label: '回收站入口行字号', legacy: { selector: '.recycle-entry' }, current: { selector: '.dshOneTree_footerRow' }, measure: { kind: 'style', prop: 'font-size' } },

  // ---- 空态 ----
  { id: 'empty-font', state: 'empty', label: '空态主文字号', legacy: { selector: '.sessions-empty' }, current: { selector: '.dshOneTree_empty' }, measure: { kind: 'style', prop: 'font-size' } },
  { id: 'empty-padding-top', state: 'empty', label: '空态上内边距', legacy: { selector: '.sessions-empty' }, current: { selector: '.dshOneTree_empty' }, measure: { kind: 'style', prop: 'padding-top' } },
  { id: 'empty-padding-left', state: 'empty', label: '空态左内边距', legacy: { selector: '.sessions-empty' }, current: { selector: '.dshOneTree_empty' }, measure: { kind: 'style', prop: 'padding-left' } },

  // ---- 菜单一级 ----
  { id: 'menu-width', state: 'menu-l1', label: '菜单宽（最小宽撑出来的实际宽）', legacy: { selector: '.popover' }, current: { selector: '[role="menu"]' }, measure: { kind: 'rect', part: 'width' } },
  { id: 'menu-radius', state: 'menu-l1', label: '菜单圆角', legacy: { selector: '.popover' }, current: { selector: '[role="menu"]' }, measure: { kind: 'style', prop: 'border-radius' } },
  { id: 'menu-padding-top', state: 'menu-l1', label: '菜单上内边距', legacy: { selector: '.popover' }, current: { selector: '[role="menu"]' }, measure: { kind: 'style', prop: 'padding-top' } },
  { id: 'menu-item-height', state: 'menu-l1', label: '菜单项高', legacy: { selector: '.popover .menu-item' }, current: { selector: '[role="menu"] button[role="menuitem"]' }, measure: { kind: 'rect', part: 'height' } },
  { id: 'menu-item-radius', state: 'menu-l1', label: '菜单项圆角', legacy: { selector: '.popover .menu-item' }, current: { selector: '[role="menu"] button[role="menuitem"]' }, measure: { kind: 'style', prop: 'border-radius' } },
  { id: 'menu-item-font', state: 'menu-l1', label: '菜单项字号', legacy: { selector: '.popover .menu-item' }, current: { selector: '[role="menu"] button[role="menuitem"]' }, measure: { kind: 'style', prop: 'font-size' } },
  { id: 'menu-item-line', state: 'menu-l1', label: '菜单项行高', legacy: { selector: '.popover .menu-item' }, current: { selector: '[role="menu"] button[role="menuitem"]' }, measure: { kind: 'style', prop: 'line-height' } },
  { id: 'menu-item-padding-left', state: 'menu-l1', label: '菜单项左内边距', legacy: { selector: '.popover .menu-item' }, current: { selector: '[role="menu"] button[role="menuitem"]' }, measure: { kind: 'style', prop: 'padding-left' } },
  { id: 'menu-item-padding-top', state: 'menu-l1', label: '菜单项上内边距', legacy: { selector: '.popover .menu-item' }, current: { selector: '[role="menu"] button[role="menuitem"]' }, measure: { kind: 'style', prop: 'padding-top' } },
  { id: 'menu-item-gap', state: 'menu-l1', label: '菜单项间隙', legacy: { selector: '.popover .menu-item' }, current: { selector: '[role="menu"] button[role="menuitem"]' }, measure: { kind: 'gap', axis: 'y' } },
  { id: 'menu-icon-slot', state: 'menu-l1', label: '菜单项图标位', legacy: { selector: '.popover .menu-item .menu-item-icon' }, current: { selector: '[role="menu"] button[role="menuitem"] [class*="_itemIcon"]' }, measure: { kind: 'box' } },

  // ---- 菜单二级 ----
  { id: 'submenu-indent', state: 'menu-l2', label: '二级项相对一级项**图标列**的缩进', legacy: { selector: '.popover .tag-submenu .menu-item .menu-item-icon', minus: '.popover .menu-item .menu-item-icon' }, current: { selector: '[role="menu"] [data-dshone-tree-item^="tag:"]', minus: '[role="menu"] [class*="_itemIcon"]' }, measure: { kind: 'indent' }, note: '基准取**整个菜单第一项**的图标列（不是父项自己的图标列）：这一项量的是「二级项的内容列相对一级项图标列挪了多少」，父子那两条关系量更直接。两侧读数**不完全可比**：旧侧栏这一项取的是子项图标槽里那个 10px 色块（色块在 14px 槽里居中，多出 2px），算出来 = 子项内边距 24 − 第一项内边距 10 + 2 = 16；现装配侧取的是子项的文字 = 子项内边距 7 + 图标槽 14 + 项内间隙 6 − 第一项内边距 7 = 20（#174 起；#171 期间是 27、#167 期间是 34、#143 期间是 20）' },
  // #143：二级项与父项的两条关系量（用户报的「缩进太深」看的是第一条）。父项两侧各用自己的
  // 办法定位：旧侧栏取「紧挨着 `.tag-submenu` 容器的那一项」、现装配侧取它自己的项标记；
  // 子项文字两侧都取**标签那一个 span**（旧侧栏是那个没有类名的 span、现装配侧是
  // `.dshOneTree_submenuItem`）——用 Range 取内容盒才是字真的落在哪儿。
  { id: 'submenu-text-vs-parent-text', state: 'menu-l2', label: '子项文字左缘 − 父项文字左缘', legacy: { selector: '.popover .tag-submenu .menu-item > span:not([class])', minus: '.popover .menu-item:has(+ .tag-submenu) > span:not([class])' }, current: { selector: '[role="menu"] .dshOneTree_submenuItem', minus: '[role="menu"] [data-dshone-tree-item="moveToGroup"]' }, measure: { kind: 'indent' }, note: '这一条就是「子项比父项深多少」：正数 = 比父项深，负数 = 比父项浅，0 = 与父项同列。旧侧栏恒为 14（= 它自己那个图标槽的宽，也就是我们说的「旧侧栏那一档」）；现装配侧 #126 是 20（深两个图标槽，用户报「太深」）、#143 收到 0（用户又觉得「层级没了」）、#167 取回一位、回到与旧侧栏同值的 14，用户看过仍觉得偏大、#171 取那一档的一半 = 7，用户看过还是觉得偏大、#174 收到底 = 0（与父项文字严格对齐，空图标槽保留）' },
  { id: 'submenu-text-vs-parent-icon-right', state: 'menu-l2', label: '子项文字左缘 − 父项图标槽右缘', legacy: { selector: '.popover .tag-submenu .menu-item > span:not([class])', minus: '.popover .menu-item:has(+ .tag-submenu) .menu-item-icon' }, current: { selector: '[role="menu"] .dshOneTree_submenuItem', minus: '[role="menu"] button[role="menuitem"]:has([data-dshone-tree-item="moveToGroup"]) [class*="_itemIcon"]' }, measure: { kind: 'textFromBoxRight' }, note: '子项文字相对父项图标槽右缘差多少：差 = 子项自己的图标槽 + 项内间隙 − 那格缩进。旧侧栏 14 + 8 = 22；现装配侧 #167 起是 14 + 6 = 20，#171 起是 14 + 6 − 7 = 13，#174 起是 14 + 6 − 0 = 6（#143 期间同样是 6 = 只剩项内间隙，子项文字压在父项图标槽右侧）' },


  // ---- 标签组 ----
  { id: 'tag-pill-height', state: 'tag-groups', label: '标签组 pill 高', legacy: { selector: '.tag-pill' }, current: { selector: '.dshOneTree_tagPill' }, measure: { kind: 'rect', part: 'height' } },
  { id: 'tag-pill-radius', state: 'tag-groups', label: '标签组 pill 圆角', legacy: { selector: '.tag-pill' }, current: { selector: '.dshOneTree_tagPill' }, measure: { kind: 'style', prop: 'border-radius' } },
  { id: 'tag-pill-font', state: 'tag-groups', label: '标签组 pill 字号', legacy: { selector: '.tag-pill' }, current: { selector: '.dshOneTree_tagPill' }, measure: { kind: 'style', prop: 'font-size' } },
  { id: 'tag-head-height', state: 'tag-groups', label: '标签组组头高', legacy: { selector: '.tag-head' }, current: { selector: '.dshOneTree_tagHead' }, measure: { kind: 'rect', part: 'height' } },
  { id: 'tag-rail-height', state: 'tag-groups', label: '标签组竖线长', legacy: { selector: '.tag-line' }, current: { selector: '.dshOneTree_tagLine' }, measure: { kind: 'rect', part: 'height' } },
  { id: 'tag-rail-left', state: 'tag-groups', label: '标签组竖线左缘（相对组块左缘）', legacy: { selector: '.tag-line', minus: '.tag-group' }, current: { selector: '.dshOneTree_tagLine', minus: '.dshOneTree_tagBlock' }, measure: { kind: 'indent' } },
  { id: 'tag-row-indent', state: 'tag-groups', label: '组内会话行左内边距', legacy: { selector: '.session-row.tagged' }, current: { selector: '.dshOneTree_tagRows .dshOneTree_sessionRow' }, measure: { kind: 'style', prop: 'padding-left' } },

  // ---- 多选 ----
  { id: 'group-checkbox', state: 'multi-select', label: '组头勾选框尺寸', legacy: { selector: '.workspace-row .select-checkbox input' }, current: { selector: '.dshOneTree_groupCheck' }, measure: { kind: 'box' } },
  { id: 'selection-bar-height', state: 'multi-select', label: '选择态动作条高', legacy: { selector: '.selection-bar' }, current: { selector: '.dshOneTree_selectionBar' }, measure: { kind: 'rect', part: 'height' } },
  { id: 'selection-bar-padding-top', state: 'multi-select', label: '动作条上内边距', legacy: { selector: '.selection-bar' }, current: { selector: '.dshOneTree_selectionBar' }, measure: { kind: 'style', prop: 'padding-top' } },
  { id: 'selection-button-height', state: 'multi-select', label: '动作条按钮高', legacy: { selector: '.selection-bar button' }, current: { selector: '[data-dshone-tree-action="selection-exit"]' }, measure: { kind: 'rect', part: 'height' } },

  // ---- 回收站抽屉 ----
  { id: 'drawer-height', state: 'recycle-drawer', label: '抽屉高（半高档）', legacy: { selector: '.recycle-drawer' }, current: { selector: '.dshOneTree_drawer' }, measure: { kind: 'rect', part: 'height' } },
  { id: 'drawer-handle-height', state: 'recycle-drawer', label: '抽屉提手高', legacy: { selector: '.recycle-drawer-handle' }, current: { selector: '.dshOneTree_drawerHandle' }, measure: { kind: 'rect', part: 'height' } },
  { id: 'drawer-grip', state: 'recycle-drawer', label: '抽屉把手尺寸', legacy: { selector: '.recycle-drawer-grip' }, current: { selector: '.dshOneTree_drawerGrip' }, measure: { kind: 'box' } },
  { id: 'drawer-header-height', state: 'recycle-drawer', label: '抽屉头高', legacy: { selector: '.recycle-header' }, current: { selector: '.dshOneTree_drawerHeader' }, measure: { kind: 'rect', part: 'height' } },
  { id: 'drawer-group-header-height', state: 'recycle-drawer', label: '抽屉分块块头高', legacy: { selector: '.recycle-list .workspace-row' }, current: { selector: '.dshOneTree_drawerGroupLabel' }, measure: { kind: 'rect', part: 'height' } },
  { id: 'drawer-row-height', state: 'recycle-drawer', label: '抽屉里会话行高', legacy: { selector: '.recycle-list .session-row' }, current: { selector: '.dshOneTree_drawerRow' }, measure: { kind: 'rect', part: 'height' } },
]

/** 一页面上按指标表取数（两侧各跑一次）。 */
interface Reading {
  found: boolean
  value: string
  /** 找不到时的原因（人看的）。 */
  why?: string
}

async function readMetrics(page: Page, specs: readonly { id: string; side: SideSpec; measure: Measure }[]): Promise<Record<string, Reading>> {
  return page.evaluate((input: typeof specs) => {
    const round = (value: number): string => `${String(Math.round(value * 100) / 100)}`
    const px = (value: string): string => value
    const out: Record<string, { found: boolean; value: string; why?: string }> = {}
    for (const spec of input) {
      const nodes = Array.from(document.querySelectorAll(spec.side.selector))
      if (nodes.length === 0) {
        out[spec.id] = { found: false, value: '', why: '没找到元素' }
        continue
      }
      const element = nodes[0] as Element
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      const measure = spec.measure
      if (measure.kind === 'rect') {
        out[spec.id] = { found: true, value: round(measure.part === 'height' ? rect.height : rect.width) }
        continue
      }
      if (measure.kind === 'style') {
        out[spec.id] = { found: true, value: px(style.getPropertyValue(measure.prop)) }
        continue
      }
      if (measure.kind === 'box') {
        out[spec.id] = { found: true, value: `${round(rect.width)}×${round(rect.height)}` }
        continue
      }
      if (measure.kind === 'gap') {
        const second = nodes[1] as Element | undefined
        if (second === undefined) {
          out[spec.id] = { found: false, value: '', why: '只有一条可达的样本行，量不出间距' }
          continue
        }
        const other = second.getBoundingClientRect()
        const value = measure.axis === 'y' ? other.top - rect.bottom : other.left - rect.right
        out[spec.id] = { found: true, value: round(value) }
        continue
      }
      // indent / textFromBoxRight：第一个匹配元素**文字**左缘 − 基准元素的文字左缘（indent）
      // 或盒子右缘（textFromBoxRight）
      const base = spec.side.minus === undefined ? null : (document.querySelector(spec.side.minus) as Element | null)
      if (base === null) {
        out[spec.id] = { found: false, value: '', why: '缩进基准元素没找到' }
        continue
      }
      const textLeft = (node: Element): number => {
        const range = document.createRange()
        range.selectNodeContents(node)
        const box = range.getBoundingClientRect()
        return box.width === 0 ? node.getBoundingClientRect().left : box.left
      }
      const minus = measure.kind === 'textFromBoxRight' ? base.getBoundingClientRect().right : textLeft(base)
      out[spec.id] = { found: true, value: round(textLeft(element) - minus) }
    }
    return out
  }, specs)
}

/* ---------------------------------------------------------------------------
 * 截图与并排合成
 * ------------------------------------------------------------------------ */

async function shoot(page: Page, name: string): Promise<string> {
  const file = path.join(SHOTS, `${name}.png`)
  await page.screenshot({ path: file })
  return file
}

/** 一页上渲染出来的工作区名（按 DOM 顺序，可见的那些）。 */
async function workspaceLabels(page: Page, selector: string): Promise<string[]> {
  return page.evaluate(
    (sel: string) =>
      Array.from(document.querySelectorAll(sel))
        .filter((element) => (element as HTMLElement).offsetParent !== null)
        .map((element) => (element.textContent ?? '').trim())
        .filter((text) => text !== ''),
    selector,
  )
}

/**
 * 把两张截图拼成一张「并排图」（左旧右现，同一宽度、1:1 显示）。
 *
 * 为什么自己拼而不是只给两张分开的图：并排是这一步的交付物本身——两张图放在同一个
 * 页面的同一行里，宽度一致、基线一致，人才好一眼比。实现只用 Playwright（把两张 PNG
 * 以 data URL 塞进一个空白页再整页截一张），不引图像库。
 */
async function composePair(
  browser: Browser,
  left: string,
  right: string,
  name: string,
  width: number,
  labelLeft: string,
  labelRight: string,
): Promise<string> {
  const toDataUrl = async (file: string): Promise<string> =>
    `data:image/png;base64,${(await fsp.readFile(file)).toString('base64')}`
  const page = await browser.newPage({ viewport: { width: width * 2 + 60, height: HEIGHT + 80 } })
  const [a, b] = await Promise.all([toDataUrl(left), toDataUrl(right)])
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; background: #3c3c3c; font: 12px/1.6 system-ui, sans-serif; color: #ddd; }
    .row { display: flex; gap: 12px; padding: 12px; align-items: flex-start; }
    .col { display: flex; flex-direction: column; gap: 6px; }
    .cap { text-align: center; }
    img { display: block; border: 1px solid #666; }
  </style></head><body><div class="row">
    <div class="col"><div class="cap">${labelLeft}</div><img width="${String(width)}" src="${a}"></div>
    <div class="col"><div class="cap">${labelRight}</div><img width="${String(width)}" src="${b}"></div>
  </div></body></html>`)
  const file = path.join(SHOTS, `${name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  await page.close()
  return file
}

/* ---------------------------------------------------------------------------
 * 主流程
 * ------------------------------------------------------------------------ */

interface RunResult {
  state: string
  width: number
  readings: { metric: Metric; legacy: Reading; current: Reading }[]
}

function verdict(legacy: Reading, current: Reading): '一致' | '不同' | '缺一侧' {
  if (!legacy.found || !current.found) return '缺一侧'
  return legacy.value === current.value ? '一致' : '不同'
}

async function main(): Promise<void> {
  await fsp.rm(OUT, { recursive: true, force: true })
  await fsp.mkdir(SHOTS, { recursive: true })

  const dshVersion = cliText(['--version'])
  const gateway = await ensureGateway()
  const log = consoleLogger(true)
  let lab: LabServer | undefined
  let legacyServer: Awaited<ReturnType<typeof startLegacyServer>> | undefined
  let browser: Browser | undefined
  const opened: { context: BrowserContext }[] = []

  try {
    lab = await startLabServer({
      gateway: gateway.origin,
      token: gateway.token,
      log,
      pluginsDir: defaultPluginsDir(),
      port: process.env.LEGACY_LAB_PORT === undefined ? 0 : Number(process.env.LEGACY_LAB_PORT),
      // 自己起的实例不在 `~/.dsh/dsh-owned.json` 里，实验室读不到版本会挂一条版本信息条
      // ——那条东西不属于侧栏本身，会把并排图的第一屏顶下去，所以把版本显式告诉它。
      ...(dshVersion === '' ? {} : { version: dshVersion }),
    })
    const sidebarRoute = LAB_TREES.find((candidate) => candidate.route === 'sidebar')
    if (sidebarRoute === undefined) throw new Error('lab: 没有 sidebar 这棵树')
    const route: LabTreeRoute = sidebarRoute

    // 两侧的同一份事实：一次只读读取（`workspace/follow` + `session/list`）。
    const model: GatewayModel = await fetchGatewayModel(gateway.origin, log as unknown as Logger)
    const uf = userFacts(model)
    fact(
      `网关事实：工作区 ${String(model.workspaces.length)} 棵、会话 ${String(model.sessions.length)} 条（可显示 ${String(uf.flat.length)} 条）；` +
        `置顶 ${String(uf.pinned.length)}、未读 ${String(uf.unread.length)}、标签组 ${String(uf.tags.length)} 个、回收站 ${String(uf.recycleBin.length)} 条`,
    )

    const before = await listSessions(gateway.origin)
    legacyServer = await startLegacyServer(buildLegacyPage(legacySnapshot({ model, collapsed: [], pinned: [], unread: [], tags: [], recycleBin: [], activeSessionId: uf.activeSessionId })))
    browser = await chromium.launch({ headless: process.env.LEGACY_HEADED !== '1' })

    const results: RunResult[] = []
    const skipped: { state: string; why: string }[] = []

    for (const state of STATES) {
      const why = state.skipWhen?.(uf) ?? null
      if (why !== null) {
        skipped.push({ state: state.name, why })
        fact(`状态「${state.name}」：跳过（${why}）——这一对没有成对截图`)
        continue
      }
      const snapshot = legacySnapshot({
        model,
        // 两侧的「用户事实」是同一份：置顶 / 未读 恒按 harness 挑出来的那两条会话，
        // 各状态只在此基础上改「展开态 / 标签组 / 回收站」。
        collapsed: [],
        pinned: uf.pinned,
        unread: uf.unread,
        tags: [],
        recycleBin: [],
        activeSessionId: uf.activeSessionId,
        currentFolder: model.paths[0],
        ...state.legacy(uf),
      })

      const legacy = await openLegacyPage(browser, legacyServer.origin, snapshot)
      opened.push(legacy)
      const current = await openTreePage(browser, lab, route, {
        width: WIDTHS[0],
        height: HEIGHT,
        state: state.currentState(uf),
        workspaceFolders: model.paths.slice(0, 1),
        settleMs: 1_500,
      })
      opened.push(current)
      // 官方客户端的展开态住 localStorage（`dsh.workspaceTree.view`，见
      // `pure/workspaceTreePrefs.ts` 的说明）：先写进去再重载，页面挂载时读到的就是它。
      // 不写 = 用它开箱的默认（只展开当前会话那一组）。
      const expanded = state.currentExpanded?.(uf) ?? null
      if (expanded !== null) {
        const prefs = {
          groupBy: 'workspace',
          orderBy: 'manual',
          activeGroupId: null,
          expandedGroups: expanded,
          recycleCollapsed: [],
          tagCollapsed: [],
        }
        await current.page.evaluate((value: string) => localStorage.setItem('dsh.workspaceTree.view', value), JSON.stringify(prefs))
        await current.page.reload({ waitUntil: 'domcontentloaded' })
        await current.page.waitForSelector(route.readySelector, { timeout: 40_000 }).catch(() => undefined)
        await current.page.waitForTimeout(1_200)
      }
      if (state.emptyWorkspaces === true) {
        await installEmptyWorkspacesFixture(current.page)
        await current.page.reload({ waitUntil: 'domcontentloaded' })
        await current.page.waitForSelector(route.readySelector, { timeout: 40_000 }).catch(() => undefined)
        await current.page.waitForTimeout(1_500)
      }

      if (state.focusTag === true) {
        // 标签组块不一定在首屏里（挑中的那棵工作区可能在列表靠下）：把两侧的组块滚进
        // 视野再截/再右击，否则「标签组态」那两张图上是别人的行。
        await legacy.page.evaluate(() => {
          document.querySelector('.tag-group')?.scrollIntoView({ block: 'center' })
        })
        await current.page.evaluate(() => {
          document.querySelector('.dshOneTree_tagRows')?.closest('.dshOneTree_tagBlock')?.scrollIntoView({ block: 'center' })
        })
        await legacy.page.waitForTimeout(300)
        await current.page.waitForTimeout(300)
      }
      if (state.driveLegacy !== undefined) await state.driveLegacy(legacy.page)
      if (state.driveCurrent !== undefined) await state.driveCurrent(current.page)
      await legacy.page.waitForTimeout(200)

      for (const width of WIDTHS) {
        await legacy.page.setViewportSize({ width, height: HEIGHT })
        await current.page.setViewportSize({ width, height: HEIGHT })
        await legacy.page.waitForTimeout(300)
        await current.page.waitForTimeout(400)

        const left = await shoot(legacy.page, `legacy-${state.id}-${String(width)}`)
        const right = await shoot(current.page, `current-${state.id}-${String(width)}`)
        await composePair(browser, left, right, `pair-${state.id}-${String(width)}`, width, '旧侧栏', '现装配侧栏')

        const specs = metrics
          .filter((metric) => metric.state === state.id)
          .map((metric) => ({ metric, legacySpec: { id: metric.id, side: metric.legacy, measure: metric.measure }, currentSpec: { id: metric.id, side: metric.current, measure: metric.measure } }))
        // 「行尾动作按钮」这一项只在悬停时才出现（两侧都是 hover 才展开）：量它之前先
        // 把第一行会话悬停住。截图已经拍完了，悬停不会进截图。
        if (state.id === 'default') {
          await legacy.page.locator(LEGACY_SESSION_ROW).first().hover()
          await current.page.locator(CURRENT_SESSION_ROW).first().hover()
          await legacy.page.waitForTimeout(200)
          await current.page.waitForTimeout(200)
        }
        const onLegacy = await readMetrics(legacy.page, specs.map((entry) => entry.legacySpec))
        const onCurrent = await readMetrics(current.page, specs.map((entry) => entry.currentSpec))
        for (const entry of specs) {
          results.push({
            state: state.id,
            width,
            readings: [
              {
                metric: entry.metric,
                legacy: onLegacy[entry.metric.id] ?? { found: false, value: '', why: '没读到' },
                current: onCurrent[entry.metric.id] ?? { found: false, value: '', why: '没读到' },
              },
            ],
          })
        }
      }

      check(
        `状态「${state.name}」：旧侧栏那一页零 console error / 零 pageerror`,
        legacy.errors.length === 0,
        legacy.errors.join(' | '),
      )
      const noisy = current.capture.pageErrors.filter((line) => !/Failed to load resource/.test(line))
      check(`状态「${state.name}」：现装配侧那一页零 pageerror`, noisy.length === 0, noisy.join(' | '))
      fact(`状态「${state.name}」：两侧各截 ${String(WIDTHS.length)} 档宽度（260/340/500）+ 一张并排图`)

      // 多选态：分组过滤条两侧的处置（#128 A2 只写了现装配侧「不收起」）。
      if (state.id === 'multi-select') {
        const probe = async (page: Page, selector: string): Promise<string> =>
          page.evaluate((sel: string) => {
            const element = document.querySelector(sel)
            if (element === null) return '不在场'
            const box = element.getBoundingClientRect()
            return box.width === 0 || box.height === 0 ? '在场但量不到（0 尺寸）' : `在场（${String(Math.round(box.width))}×${String(Math.round(box.height))}）`
          }, selector)
        fact(`多选态下的分组过滤条：旧 ${await probe(legacy.page, '.ws-group-select')} / 现 ${await probe(current.page, '.dshOneTree_pill')}`)
      }

      // 工作区顺序：两侧各把自己渲染出来的工作区名读出来比一遍。这一条是渲染才看得到的
      // 事实——源码级对照里「工作区分组顺序」被判成一致，实际两侧排法不同（见文档结论）。
      if (state.id === 'default-native') {
        const left = await workspaceLabels(legacy.page, '.sessions-list > .workspace-group .workspace-label')
        const right = await workspaceLabels(current.page, '[data-dshone-tree-row="workspace"] .dshOneTree_title')
        const overlap = left.filter((name) => right.includes(name))
        fact(`工作区顺序（旧）：${left.join(' > ')}`)
        fact(`工作区顺序（现）：${right.join(' > ')}`)
        check(
          '工作区清单：两侧渲染出的是同一批工作区（只多不少；旧侧栏多一个「未分组」桶）',
          right.every((name) => left.includes(name)) && left.length - right.length <= 1,
          `旧 ${String(left.length)} 棵 / 现 ${String(right.length)} 棵，两侧都有的是 ${String(overlap.length)} 棵`,
        )
        if (JSON.stringify(overlap) !== JSON.stringify(left) || overlap.length !== right.length) {
          fact(
            '工作区**顺序**两侧不同——旧侧栏按「当前文件夹优先 + 工作区 updatedAt 降序」排' +
              '（`pure/sessionTree.ts:417-421`），现装配侧按网关给的官方顺序排（`workspaceTree/tree.ts`）。' +
              '这一条在源码级对照（#128 A1）里被判成「一致」，是渲染才看出来的。',
          )
        }
      }
    }

    // ---- 几何结论（按主宽度 340 报） ----
    const byMetric = new Map<string, { metric: Metric; legacy: Reading; current: Reading }>()
    for (const result of results) {
      for (const entry of result.readings) {
        if (result.width !== REPORT_WIDTH) continue
        byMetric.set(entry.metric.id, entry)
      }
    }
    const same: string[] = []
    const different: string[] = []
    const missing: string[] = []
    for (const metric of metrics) {
      const entry = byMetric.get(metric.id)
      if (entry === undefined) continue
      const word = verdict(entry.legacy, entry.current)
      const line =
        `${metric.label}：旧 ${entry.legacy.found ? entry.legacy.value : '—'} / 现 ${entry.current.found ? entry.current.value : '—'}` +
        `${entry.legacy.found && entry.current.found && word === '不同' ? `（差 ${diffText(entry.legacy.value, entry.current.value)}）` : ''}`
      if (word === '一致') same.push(line)
      else if (word === '不同') different.push(line)
      else missing.push(`${line}（${entry.legacy.why ?? entry.current.why ?? '没量到'}）`)
    }
    fact(`几何对照：共 ${String(metrics.length)} 项，两侧读数**一致** ${String(same.length)} 项、**不同** ${String(different.length)} 项、有一侧量不到 ${String(missing.length)} 项`)
    check('几何对照：绝大多数项两侧都量到了（有内容的对照才有意义）', metrics.length - missing.length >= metrics.length * 0.8, `量不到 ${String(missing.length)} / ${String(metrics.length)}：${missing.join('；')}`)

    // 三档宽度下读数是否恒定（只有真正随宽度变的项才该变——宽度一变分母就变的那种）。
    const varying = (side: 'legacy' | 'current'): string[] => {
      const out: string[] = []
      for (const metric of metrics) {
        const values = WIDTHS.map((width) => {
          const hit = results.find((r) => r.state === metric.state && r.width === width)?.readings.find((e) => e.metric.id === metric.id)
          return hit?.[side].value ?? ''
        })
        if (new Set(values.filter((v) => v !== '')).size > 1) out.push(metric.label)
      }
      return out
    }
    fact(`三档宽度下读数会变的项：旧 ${varying('legacy').join('、') || '（没有）'}；现 ${varying('current').join('、') || '（没有）'}`)

    // ---- 只读守卫 ----
    const after = await listSessions(gateway.origin)
    check(
      '网关只读：跑前跑后会话数一致（没有喂 prompt、没有新建会话、没有改任何状态）',
      before.length === after.length,
      `跑前 ${String(before.length)} 条，跑后 ${String(after.length)} 条——本 harness 一个写类调用都没有，` +
        '涨了多半是同一台机器上别的 session 在这段时间里建了会话（#116 记的读数漂移）',
    )

    // ---- 产物 ----
    const ledger = {
      suite: 'LEGACY-SIDEBAR-RENDER',
      at: new Date().toISOString(),
      gateway: gateway.origin,
      branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
      commit: git(['rev-parse', '--short', 'HEAD']),
      widths: WIDTHS,
      reportWidth: REPORT_WIDTH,
      assertions: { total: checks.length, passed: checks.filter((c) => c.ok).length },
      checks,
      facts,
      skipped,
      geometry: metrics.map((metric) => {
        const entry = byMetric.get(metric.id)
        return {
          id: metric.id,
          state: metric.state,
          label: metric.label,
          legacySelector: metric.legacy.selector,
          currentSelector: metric.current.selector,
          kind: metric.measure.kind,
          legacy: entry?.legacy ?? { found: false, value: '' },
          current: entry?.current ?? { found: false, value: '' },
          verdict: entry === undefined ? '缺' : verdict(entry.legacy, entry.current),
        }
      }),
      geometryByWidth: results.map((result) => ({
        state: result.state,
        width: result.width,
        values: Object.fromEntries(result.readings.map((entry) => [entry.metric.id, { legacy: entry.legacy.value, current: entry.current.value }])),
      })),
    }
    await fsp.writeFile(path.join(OUT, 'verify.legacy-sidebar.ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`, 'utf8')

    await browser.close()
    browser = undefined

    for (const line of facts) process.stdout.write(`  · ${line}\n`)
    for (const failed of checks.filter((entry) => !entry.ok)) process.stdout.write(`  ✗ ${failed.label}${failed.detail === '' ? '' : `（${failed.detail}）`}\n`)
    const passed = checks.filter((entry) => entry.ok).length
    process.stdout.write(
      `\n[legacy-sidebar] 断言 ${String(checks.length)} 条，通过 ${String(passed)} 条；` +
        `几何 ${String(metrics.length)} 项（一致 ${String(same.length)} / 不同 ${String(different.length)} / 缺一侧 ${String(missing.length)}）；` +
        `产物 ${path.relative(process.cwd(), OUT)}/{verify.legacy-sidebar.ledger.json, shots/*.png}\n`,
    )
    if (passed !== checks.length) process.exitCode = 1
  } finally {
    for (const entry of opened) await entry.context.close().catch(() => undefined)
    await browser?.close().catch(() => undefined)
    await legacyServer?.dispose()
    await lab?.dispose()
    await gateway.dispose()
  }
}

function diffText(from: string, to: string): string {
  const a = Number.parseFloat(from)
  const b = Number.parseFloat(to)
  if (Number.isFinite(a) && Number.isFinite(b) && /^[-\d.]+$/.test(from.trim()) && /^[-\d.]+$/.test(to.trim())) {
    const delta = Math.round((b - a) * 100) / 100
    return `${delta > 0 ? '+' : ''}${String(delta)}px`
  }
  return `${from} → ${to}`
}

function git(args: readonly string[]): string {
  try {
    return execFileSync('git', [...args], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

/** 本机 dsh CLI 的版本串（拿不到就空串，退回「版本未知」那条信息条）。 */
function cliText(args: readonly string[]): string {
  try {
    return execFileSync('dsh', [...args], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

await main()
