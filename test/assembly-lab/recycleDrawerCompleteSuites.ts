/**
 * 回收站抽屉补齐（#154，RECYCLE-DRAWER-COMPLETE 套件）：抽屉头三样（返回 / 清空 / 恢复全部）
 * + 行的右键入口 / 状态点 / 图钉。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与 `recycleDrawerRowSuites.ts`（F-45）/
 * `recycleEntryAlignSuites.ts`（F-38）同一条：那个文件是本批开发的合入热点，新套件放外面
 * 能少一半冲突面。注册方式是在 `suites.ts` 的 `SUITES` 末尾追加一项。
 *
 * **这一条与相邻套件的分工**：F-15 管回收站两层语义与抽屉的存在 / 分块 / 折叠，F-45 管块头
 * 与行尾两枚动作的几何，F-24 管抽屉开合的动效，F-38 管底部入口行那一行的几何。本条只管
 * **#154 这一轮补进来的四件事**：① 抽屉头的返回 / 清空 / 恢复全部（在场、形态、动作与出口），
 * ② 行的右键菜单（与行尾两枚动作同一份项），③ 行上的状态点，④ 行上的图钉。
 *
 * **官方有没有对应物（#154 的口径）**：官方 0.1.6-alpha.1 的
 * `@deepseek-ai/dsh-client-ui-settings-unarchive-sessions` 是一页**设置页 section**（已归档
 * 会话清单 + 每行一枚「取消归档」按钮），头部没有返回也没有批量动作、行上没有状态点也没有
 * 图钉——所以这四件事都照旧侧栏正本（`src/ui/sessionsWebview.ts` 的 `renderRecycleHeader` /
 * `renderRecycleSessionRow`）补，逐条理由写在 `recycleDrawer.ts` 的文件头。
 *
 * ## 夹具**自带数据**（#154 修，上一版撞在「这台机器上碰巧有几条会话」上）
 *
 * 上一版从树上**挑真实会话**（「树里至少有 4 条会话可供夹具使用」那条前置条件）：共享日常
 * 实例上会话多、这条成立；主线在**全新隔离实例**（干净 DSH_HOME、一条会话都没有）上跑时当场
 * 红，而且它下面的每一条断言都跟着没了对象。这与 #116 / #148 记的是同一类问题——判据不许
 * 依赖环境里碰巧有什么。现在这一条**一条断言都不吃当天数据**，四条会话与那棵工作区由夹
 * 具**自己造**：
 *
 * - `session/list` 回执夹具：把 `items` 整个换成四条合成会话（id / 标题 / `running` / `cwd` /
 *   `projections.values.title` 全由套件给）。标题的**权威位置**是回执项里的
 *   `projections.values.title`（顶层 `title` 一并写上，两种读法都自洽），实测依据见 F-45 的
 *   `installLongTitleFixture`；
 * - `workspace/follow` 基线帧夹具：换成一棵合成工作区（成员 = 那四条），其余工作区帧丢掉、
 *   归档集合清空——与 F-21 的 `installWorkspaceFixture` / F-49(search-hit) 的 mux 夹具同一套做法；
 * - 假宿主状态夹具：`recycle-bin` / `pinned` / `unread` 三个键都指向合成 id（开页时一次装上）。
 *
 * 四条会话各演一个角色：**跑着的**那条先在主树读一次状态点、再用**既有的**行菜单挪进抽屉，
 * 判「同一会话同一口径」；**已置顶且已在回收站**那条出抽屉里的图钉（这个组合界面本身造不出来
 * ——置顶的会话不许移入回收站，只能由夹具注入）；**在主树置顶**那条当主树那一侧的图钉参照物、
 * 也是待会儿被行菜单「标为未读」的那条；**未读且已在回收站**那条出抽屉里的未读点。
 *
 * ## 页面语言两种都收
 *
 * 字典文案按**页面语言**渲染：共享日常实例是中文，全新隔离实例是英文（F-52 记过同一条）。
 * 所以凡是拿词曲做**绝对**比较的断言都按「zh / en 任一命中」判（`dictLang`），并在事实行里
 * 记下这一轮读到的是哪一种；两侧对照的断言（主树 vs 抽屉）在同一条页面上，不受影响。
 *
 * ## 动作顺序为什么这么排
 *
 * 主树那一侧的交互（行菜单「移入回收站」/「标为未读」）必须在**抽屉关着**的时候做——抽屉
 * 半高盖住列表下半块，盖住的那一行悬停不到、⋯ 按钮不会显形。所以本套件的顺序是：① 抽屉关着
 * 时读主树的点与图钉、用既有行菜单造现场 → ② 开抽屉量抽屉里的一切 → ③ 收尾（返回 / 清空 /
 * 恢复全部、空集合那一页）。
 *
 * 全程只读真网关（只写假宿主的 `recycle-bin` / `pinned` / `unread`——那三个状态本来就在 dsh
 * 自己的目录里，不是网关的写面），零 pageerror；本套件**从不点归档确认**（那会写真实网关）。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import type { BrowserContext } from 'playwright'
import { openTreePage, withoutKnownNoise, type OpenedPage } from './harness.ts'
import { LAB_TREES, type LabTreeRoute } from './labServer.ts'
import { SCALE_TIERS } from '../../packages/dsh-workspace-tree/src/workspaceTree/styles.ts'
import { EN, ZH } from '../../packages/dsh-workspace-tree/src/workspaceTree/locale.ts'
// 只取类型（编译后不留 import，运行期没有环）：套件接口定义在 suites.ts 里。
import type { LabSuite } from './suites.ts'

const route = (name: string): LabTreeRoute => {
  const found = LAB_TREES.find((candidate) => candidate.route === name)
  if (found === undefined) throw new Error(`lab: unknown tree route ${name}`)
  return found
}

const DRAWER = '[data-dshone-tree="recycle-drawer"]'
const HEADER = '.dshOneTree_drawerHeader'
const HEADING = '.dshOneTree_drawerHeading'
const TITLE = '.dshOneTree_drawerTitle'
const COUNT = '.dshOneTree_drawerCount'
const BACK = '[data-dshone-tree-action="recycle-close"]'
const HEADER_EMPTY = '[data-dshone-tree-action="recycle-drawer-empty-all"]'
const HEADER_RESTORE_ALL = '[data-dshone-tree-action="recycle-drawer-restore-all"]'
const ENTRY_EMPTY = '[data-dshone-tree-action="recycle-empty-all"]'
const ENTRY_RESTORE_ALL = '[data-dshone-tree-action="recycle-restore-all"]'
const ENTRY_MAIN = '[data-dshone-tree-action="recycle-toggle"]'
const DRAWER_ROWS = '[data-dshone-recycle-row]'
const TREE_ROWS = '[data-dshone-tree-row="session"]'
const MENU_RESTORE = '[data-dshone-tree-item="recycle-restore"]'
const MENU_ARCHIVE = '[data-dshone-tree-item="recycle-archive"]'
const CONFIRM = '[data-dshone-tree-action="archive-confirm"]'

/**
 * 写类 `/api/` 方法的判定（只读守卫用）。
 *
 * 为什么判「有没有写类方法」而不是「一个请求都没有」：页面自己会按它的节奏轮询读接口
 * （实测这些窗口里出现过 `session/list` / `settings/describe` / `dynamicCordisRunner/*`
 * 这些读类调用），拿别人的心跳判我们的动作会把套件变成看运气。写类方法一个都不许有，
 * 才是这几条要守的事。
 */
const WRITE_METHOD = /archive|delete|write|rename|create|fork/i

/** 关系量容差 1px；尺寸读数 0.5px。 */
const EPS = 1
const SIZE_EPS = 0.5

const px = (value: string | undefined): number => Number.parseFloat(value ?? 'NaN')

/**
 * 词典文案的语言判定：页面语言由实例决定（日常实例 zh、全新隔离实例 en，见 F-52 的同一条）。
 * 返回命中的那一种（报告里记下来）；都不是（或取到空串）返回空串，判据当场红。
 */
function dictLang(key: string, actual: string | undefined): 'zh' | 'en' | '' {
  const value = actual ?? ''
  if (value === '') return ''
  if (ZH[key] === value) return 'zh'
  if (EN[key] === value) return 'en'
  return ''
}

/** 词典文案两侧（报告用）。 */
const dictBoth = (key: string): string => `zh=${JSON.stringify(ZH[key] ?? '')} en=${JSON.stringify(EN[key] ?? '')}`

// ---------------------------------------------------------------------------
// 夹具：四条合成会话 + 一棵合成工作区（自带数据，见文件头）
// ---------------------------------------------------------------------------

/** 合成工作区（`workspace/follow` 基线帧夹具用它替换真清单）。 */
const LAB_WORKSPACE = { key: 'lab-drawer-ws', path: '/lab/drawer-ws', title: 'Lab Drawer Workspace' } as const

/** 夹具那一条会话的规格（`session/list` 回执夹具按它造 items）。 */
interface LabSessionSpec {
  readonly id: string
  readonly title: string
  readonly running: boolean
}

/** ① 跑着的：先在主树读一次状态点，再用既有行菜单挪进抽屉。 */
const LAB_RUNNING: LabSessionSpec = {
  id: 'session-1a5d1a5d-0000-4000-8000-000000000001',
  title: '【夹具】跑着的会话（先读主树、再挪进抽屉）',
  running: true,
}
/** ② 置顶 + 已在回收站：抽屉里的图钉（这个组合界面造不出来，只能注入）。 */
const LAB_PINNED_IN_BIN: LabSessionSpec = {
  id: 'session-1a5d1a5d-0000-4000-8000-000000000002',
  title: '【夹具】置顶且已在回收站',
  running: false,
}
/** ③ 未读 + 已在回收站：抽屉里的未读点。 */
const LAB_UNREAD_IN_BIN: LabSessionSpec = {
  id: 'session-1a5d1a5d-0000-4000-8000-000000000003',
  title: '【夹具】未读且已在回收站',
  running: false,
}
/** ④ 在主树置顶：主树那一侧的图钉参照物，也是待会儿被「标为未读」的那条。 */
const LAB_PINNED_IN_TREE: LabSessionSpec = {
  id: 'session-1a5d1a5d-0000-4000-8000-000000000004',
  title: '【夹具】在主树置顶（待标未读）',
  running: false,
}

/** 四条合成会话（顺序即 `session/list` 回执里的顺序）。 */
const LAB_SESSIONS: readonly LabSessionSpec[] = [LAB_RUNNING, LAB_PINNED_IN_BIN, LAB_UNREAD_IN_BIN, LAB_PINNED_IN_TREE]

/** 假宿主状态夹具：回收站两条、置顶两条、未读一条（都指向合成 id）。 */
const LAB_HOST_STATE: Readonly<Record<string, unknown>> = {
  'recycle-bin': { version: 1, sessionIds: [LAB_PINNED_IN_BIN.id, LAB_UNREAD_IN_BIN.id] },
  pinned: { version: 1, sessionIds: [LAB_PINNED_IN_BIN.id, LAB_PINNED_IN_TREE.id] },
  unread: { version: 1, sessionIds: [LAB_UNREAD_IN_BIN.id] },
}

/** 四条合成会话的 `updatedAt`（相对开页时刻的过去时间：时间标签稳定、不跟时钟走）。 */
const LAB_UPDATED_AT = Date.now() - 5 * 60_000

/**
 * 让页面一开就把夹具那条跑着的会话当作**当前会话**（官方恢复键 `dsh.sessions.current`，
 * 形状 `{sessionId}`——实测读的官方 `SessionRuntime` 构造函数里 `restored.sessionId`）。
 *
 * 为什么必须种：官方 `ui-workspace` 在装载期有一条自启逻辑——会话服务的 `phase === 'ready'`
 * 而 `sessions.current === undefined` 时，它会「打开最近的那个工作区」= `connectWorkspace` =
 * 给那个工作区**建一条空白会话**。我们那棵合成工作区（`lab-drawer-ws`）在网关侧并不存在，
 * 于是这条请求必然被拒，而列表每刷新一次它就再试一次（实测共享实例上 11 次、隔离实例上 5 次
 * `session/create`）——**那是对网关写面的请求，本套件不许有**，且它是夹具自己招来的（不是插件
 * 的动作）。种上当前会话之后那条自启逻辑第一次判断就早退，一条写类请求都不产生；顺带把页面
 * 摆成真实用户的形态（手里本来就开着一个会话）。
 */
async function seedCurrentSession(context: BrowserContext): Promise<void> {
  await context.addInitScript({
    content: `try { localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: ${JSON.stringify(LAB_RUNNING.id)} })) } catch {}`,
  })
}

/**
 * `session/list` 回执夹具：把 `items` **整个换成**四条合成会话。
 *
 * 只改页面收到的回执，请求照旧落到网关（`route.fetch()` 拿真回执、原样换掉 `items`），所以
 * 信封与 rpcId 都是真的。形状按实测来（F-45 的探针）：`{sessionId, updatedAt, running, blank,
 * cwd, projections:{values:{title}}}`——标题的权威位置是 `projections.values.title`。
 * 非清单请求交给更早注册的那条处理器（`fallback()`，不是 `fetch()`——后者会绕过只读守卫）。
 */
async function installSyntheticListFixture(
  page: OpenedPage['page'],
  onApiCall?: (method: string) => void,
): Promise<{ calls: number; replaced: number }> {
  const stats = { calls: 0, replaced: 0 }
  await page.route('**/api/**', async (requestRoute) => {
    const request = requestRoute.request()
    const method = decodeURIComponent(request.url()).split('/api/')[1] ?? ''
    if (!method.startsWith('session/list')) {
      await requestRoute.fallback()
      return
    }
    onApiCall?.(method)
    stats.calls += 1
    const response = await requestRoute.fetch()
    const body = await response.text()
    const parsed = JSON.parse(body) as { result?: { value?: { items?: unknown[] } } }
    if (parsed.result?.value !== undefined) {
      parsed.result.value.items = LAB_SESSIONS.map((session, index) => ({
        sessionId: session.id,
        updatedAt: LAB_UPDATED_AT - index * 60_000,
        running: session.running,
        blank: false,
        cwd: LAB_WORKSPACE.path,
        // `asOfSeq` 给一个大值：投影值按序号取新，夹具希望这一份永远算最新的（见 F-45
        // `installLongTitleFixture` 里的实测说明）；这些 id 都是合成的，不会与谁冲突。
        projections: { asOfSeq: 1_000_000, values: { title: session.title } },
      }))
      stats.replaced = LAB_SESSIONS.length
    }
    await requestRoute.fulfill({ response, body: JSON.stringify(parsed) })
  })
  return stats
}

/**
 * `workspace/follow` 基线帧夹具：换成一棵合成工作区（成员 = 四条合成会话），其余工作区帧
 * 一律丢掉、归档集合清空。与 F-21 的 `installWorkspaceFixture` / F-49(search-hit) 的 mux 夹具
 * 同一套做法（那边是多棵、这边一棵，判据只需要一棵）。
 */
async function installSyntheticWorkspaceFixture(page: OpenedPage['page']): Promise<{ frames: number; dropped: number }> {
  const stats = { frames: 0, dropped: 0 }
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
        /* 客户端帧形状变了就原样转发（夹具不参与协议解读） */
      }
      upstream.send(message)
    })
    upstream.onMessage((message) => {
      let frame:
        | { streamId?: string; type?: string; value?: { type?: string; value?: { items?: unknown[]; archivedSessionIds?: unknown } } }
        | undefined
      try {
        frame = JSON.parse(String(message)) as typeof frame
      } catch {
        frame = undefined
      }
      if (frame?.streamId === undefined || endpoints.get(frame.streamId) !== 'workspace/follow') {
        socket.send(message)
        return
      }
      const payload = frame.value
      if (frame.type === 'item' && payload?.type === 'baseline' && payload.value !== undefined) {
        payload.value.items = [
          {
            workspaceId: LAB_WORKSPACE.key,
            path: LAB_WORKSPACE.path,
            title: LAB_WORKSPACE.title,
            sessionIds: LAB_SESSIONS.map((session) => session.id),
            updatedAt: new Date(0).toISOString(),
          },
        ]
        // 归档集合清空：合成工作区引用的是套件自己造的会话，留着真归档集合只会让「谁在树里」
        // 变得不确定（真网关只读，这里只改页面收到的帧）。
        payload.value.archivedSessionIds = []
        stats.frames += 1
        socket.send(JSON.stringify(frame))
        return
      }
      // 非基线帧（upsert / order / remove / archived）一律不转发：否则真工作区会从增量里
      // 回到树里，合成的那一棵就不确定是唯一的一棵了。
      stats.dropped += 1
    })
  })
  return stats
}

// ---------------------------------------------------------------------------
// 读数
// ---------------------------------------------------------------------------

interface Box {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
}

/** 只用到四边的矩形（主树那一行的读数用）。 */
interface Rect {
  left: number
  right: number
  width: number
  height: number
}

/** 一枚图标渲染出来的形状指纹（`path/rect/circle` 的几何属性，不带尺寸与类名）。 */
interface IconFact {
  viewBox: string
  width: string
  height: string
  shapes: string[]
}

interface HeaderFacts {
  back: { box: Box; aria: string; title: string; icon: IconFact | null; name: string } | null
  empty: { box: Box; aria: string; disabled: boolean; color: string; icon: IconFact | null; radius: string } | null
  restoreAll: { box: Box; aria: string; disabled: boolean; color: string; icon: IconFact | null; radius: string } | null
  entryEmpty: { box: Box; aria: string; disabled: boolean; color: string; icon: IconFact | null; radius: string } | null
  entryRestoreAll: { box: Box; aria: string; disabled: boolean; color: string; icon: IconFact | null; radius: string } | null
  header: Box | null
  heading: Box | null
  headingGap: number
  title: Box | null
  titleText: string
  count: Box | null
  countText: string
  row: Box | null
  rowTitleText: string
  rowSlot: Box | null
  rowDot: { state: string; box: Box; color: string; viewBox: string; shapeCount: number } | null
  rowPin: Box | null
  rowPinIcon: IconFact | null
  rowTitle: Box | null
  /** 抽屉里此刻有几行（计数与行数的关系量）。 */
  rows: number
  /** 页面上还剩几枚常显的 ⋯ 入口（#144 退场后必须是 0）。 */
  explicitMenus: number
}

/** 读一次抽屉头 + 指定那一行的几何与关键读数（元素不在就记 null，不抛）。 */
async function readDrawer(page: OpenedPage['page'], rowId: string): Promise<HeaderFacts> {
  return page.evaluate(
    ([
      headerSelector,
      headingSelector,
      titleSelector,
      countSelector,
      backSelector,
      emptySelector,
      restoreSelector,
      entryEmptySelector,
      entryRestoreSelector,
      rowSelector,
    ]) => {
      const round = (value: number): number => Math.round(value * 100) / 100
      const box = (element: Element | null): Box | null => {
        if (element === null) return null
        const rect = element.getBoundingClientRect()
        return {
          left: round(rect.left),
          right: round(rect.right),
          top: round(rect.top),
          bottom: round(rect.bottom),
          width: round(rect.width),
          height: round(rect.height),
        }
      }
      const icon = (element: Element | null): IconFact | null => {
        const svg = element?.querySelector('svg') ?? null
        if (svg === null) return null
        return {
          viewBox: svg.getAttribute('viewBox') ?? '',
          width: svg.getAttribute('width') ?? '',
          height: svg.getAttribute('height') ?? '',
          shapes: Array.from(svg.querySelectorAll('path,rect,circle')).map(
            (shape) =>
              `${shape.tagName.toLowerCase()}|${shape.getAttribute('d') ?? ''}|${shape.getAttribute('cx') ?? ''}|${shape.getAttribute('x') ?? ''}`,
          ),
        }
      }
      const button = (
        selector: string,
      ): { box: Box; aria: string; disabled: boolean; color: string; icon: IconFact | null; radius: string } | null => {
        const element = document.querySelector(selector) as HTMLButtonElement | null
        const rect = box(element)
        if (element === null || rect === null) return null
        return {
          box: rect,
          aria: element.getAttribute('aria-label') ?? '',
          disabled: element.disabled,
          color: getComputedStyle(element).color,
          icon: icon(element),
          radius: getComputedStyle(element).borderTopLeftRadius,
        }
      }
      const header = document.querySelector(headerSelector)
      const back = document.querySelector(backSelector)
      const backBox = box(back)
      const heading = header?.querySelector(headingSelector) ?? null
      const title = header?.querySelector(titleSelector) ?? null
      const count = header?.querySelector(countSelector) ?? null
      const row = document.querySelector(rowSelector)
      const slot = row?.querySelector('.dshOneTree_slot') ?? null
      const dot = slot?.querySelector('[data-state]') ?? null
      const dotBox = box(dot)
      const pin = row?.querySelector('.dshOneTree_pin') ?? null
      return {
        back:
          back === null || backBox === null
            ? null
            : {
                box: backBox,
                aria: back.getAttribute('aria-label') ?? '',
                title: back.getAttribute('title') ?? '',
                icon: icon(back),
                name: back.getAttribute('data-dshone-tree-icon') ?? '',
              },
        empty: button(emptySelector),
        restoreAll: button(restoreSelector),
        entryEmpty: button(entryEmptySelector),
        entryRestoreAll: button(entryRestoreSelector),
        header: box(header),
        heading: box(heading),
        headingGap: heading === null ? -1 : Number.parseFloat(getComputedStyle(heading).columnGap) || 0,
        title: box(title),
        titleText: (title?.textContent ?? '').trim(),
        count: box(count),
        countText: (count?.textContent ?? '').trim(),
        row: box(row),
        rowTitleText: (row?.querySelector('.dshOneTree_title')?.textContent ?? '').trim(),
        rowSlot: box(slot),
        rowDot:
          dot === null || dotBox === null
            ? null
            : {
                state: dot.getAttribute('data-state') ?? '',
                box: dotBox,
                color: getComputedStyle(dot).color,
                viewBox: dot.getAttribute('viewBox') ?? '',
                shapeCount: dot.querySelectorAll('rect,path,circle').length,
              },
        rowPin: box(pin),
        rowPinIcon: icon(pin),
        rowTitle: box(row?.querySelector('.dshOneTree_title') ?? null),
        rows: document.querySelectorAll('[data-dshone-recycle-row]').length,
        explicitMenus: document.querySelectorAll('[data-dshone-recycle-menu]').length,
      }
    },
    [
      HEADER,
      HEADING,
      TITLE,
      COUNT,
      BACK,
      HEADER_EMPTY,
      HEADER_RESTORE_ALL,
      ENTRY_EMPTY,
      ENTRY_RESTORE_ALL,
      // 没给会话 id 时用一个必然匹配不到的选择器（空集合那一页量不到行）。
      rowId === '' ? '[data-dshone-recycle-row="__none__"]' : `[data-dshone-recycle-row="${rowId}"]`,
    ] as const,
  )
}

/** 一枚图标单独读一次（元素不在就是 null）。 */
async function readIcon(page: OpenedPage['page'], selector: string): Promise<IconFact | null> {
  return page.evaluate((sel) => {
    const svg = document.querySelector(sel)?.querySelector('svg') ?? null
    if (svg === null) return null
    return {
      viewBox: svg.getAttribute('viewBox') ?? '',
      width: svg.getAttribute('width') ?? '',
      height: svg.getAttribute('height') ?? '',
      shapes: Array.from(svg.querySelectorAll('path,rect,circle')).map(
        (shape) =>
          `${shape.tagName.toLowerCase()}|${shape.getAttribute('d') ?? ''}|${shape.getAttribute('cx') ?? ''}|${shape.getAttribute('x') ?? ''}`,
      ),
    }
  }, selector)
}

/** 主树一行上的状态点与图钉（判「与主树同一口径」的那一侧）。 */
async function readTreeRow(
  page: OpenedPage['page'],
  sessionId: string,
): Promise<{
  titleText: string
  dot: { state: string; viewBox: string; shapeCount: number; color: string } | null
  slot: Rect | null
  pin: Rect | null
  title: Rect | null
  titleWeight: string
  readLabels: string
}> {
  return page.evaluate((id) => {
    const round = (value: number): number => Math.round(value * 100) / 100
    const box = (element: Element | null): { left: number; right: number; width: number; height: number } | null => {
      if (element === null) return null
      const rect = element.getBoundingClientRect()
      return { left: round(rect.left), right: round(rect.right), width: round(rect.width), height: round(rect.height) }
    }
    const row = document.querySelector(`[data-dshone-tree-session="${id}"]`)
    const slot = row?.querySelector('.dshOneTree_slot') ?? null
    const dot = slot?.querySelector('[data-state]') ?? null
    const pin = row?.querySelector('.dshOneTree_pin') ?? null
    const title = row?.querySelector('.dshOneTree_title') ?? null
    return {
      titleText: (title?.textContent ?? '').trim(),
      dot:
        dot === null
          ? null
          : {
              state: dot.getAttribute('data-state') ?? '',
              viewBox: dot.getAttribute('viewBox') ?? '',
              shapeCount: dot.querySelectorAll('rect,path,circle').length,
              color: getComputedStyle(dot).color,
            },
      slot: box(slot),
      pin: box(pin),
      title: box(title),
      titleWeight: title === null ? '' : getComputedStyle(title).fontWeight,
      readLabels: Array.from(row?.querySelectorAll('.dshOneTree_visuallyHidden') ?? [])
        .map((node) => node.textContent ?? '')
        .join('|'),
    }
  }, sessionId)
}

/** 反色 token 的解析值（拿同一枚 token 挂探针元素上量，不写死色值）。 */
async function tokenValue(page: OpenedPage['page'], token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement('div')
    probe.style.color = `var(${name})`
    document.body.append(probe)
    const value = getComputedStyle(probe).color
    probe.remove()
    return value
  }, token)
}

/** 假宿主里 `recycle-bin` 的状态与它被写过的次数。 */
async function hostBin(page: OpenedPage['page']): Promise<{ ids: string[]; writes: number }> {
  return page.evaluate(() => {
    const host = (globalThis as unknown as {
      __LAB_HOST__?: {
        stateStore?: Record<string, { sessionIds?: string[] }>
        hostCalls?: { call: string; args?: { key?: string } }[]
      }
    }).__LAB_HOST__
    return {
      ids: host?.stateStore?.['recycle-bin']?.sessionIds ?? [],
      writes: (host?.hostCalls ?? []).filter((entry) => entry.call === 'state.write' && entry.args?.key === 'recycle-bin').length,
    }
  })
}

/** 悬停某一行 → 点它那一枚 ⋯ → 点菜单里的一项（既有路径，与 F-15 同做法）。 */
async function clickRowMenuItem(page: OpenedPage['page'], sessionId: string, item: string): Promise<void> {
  const row = page.locator(`[data-dshone-tree-session="${sessionId}"]`)
  await row.hover()
  await row.locator('.dshOneTree_rowIconButton').click()
  await page.waitForTimeout(250)
  await page.click(`[data-dshone-tree-item="${item}"]`)
  await page.waitForTimeout(300)
}

/**
 * 展开合成工作区那一行。
 *
 * 为什么必须显式展开：默认只有「当前会话所在那一组」自动展开（`autoExpandGroup`，官方同此），
 * 而合成会话**不是**当天那个当前会话（夹具把清单整个换掉了），所以这一组首开是收起的。点工作
 * 区行只是本地展开（不写网关），与 F-21 / F-52 的 `expandAllWorkspaces` 同一处置。
 */
async function expandLabWorkspace(page: OpenedPage['page']): Promise<string> {
  const row = page.locator(`[data-dshone-tree-row="workspace"][data-dshone-tree-key="${LAB_WORKSPACE.key}"]`)
  const before = (await row.count()) === 0 ? '' : ((await row.getAttribute('aria-expanded')) ?? '')
  if (before !== 'true' && (await row.count()) > 0) {
    await row.click()
    await page.waitForTimeout(350)
  }
  return before
}

/** 三档宽度下这一页有没有横向溢出（抽屉头 / 抽屉列表 / 行 / 列表 / 文档）。 */
async function overflowFacts(
  page: OpenedPage['page'],
): Promise<{ doc: number; list: number; header: number; row: number; drawer: number }> {
  return page.evaluate(
    ([headerSelector, rowSelector]) => {
      const over = (selector: string): number => {
        const element = document.querySelector(selector)
        return element === null ? 0 : element.scrollWidth - element.clientWidth
      }
      return {
        doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        list: over('.dshOneTree_list'),
        header: over(headerSelector),
        row: over(rowSelector),
        drawer: over('.dshOneTree_drawerList'),
      }
    },
    [HEADER, DRAWER_ROWS] as const,
  )
}

export const RECYCLE_DRAWER_COMPLETE_SUITE: LabSuite = {
  id: 'F-53',
  phase: 'new-feature',
  name: '回收站抽屉补齐：抽屉头三样（返回 / 清空 / 恢复全部）+ 行的右键入口 / 状态点 / 图钉（#154，RECYCLE-DRAWER-COMPLETE 套件）',
  expect:
    '真装配页（真网关**只读** + 假宿主 + **自带数据的页内夹具**）上的四件事，期望值全部从 `workspaceTree/styles.ts` 的档位表与插件词典读（文案按页面语言 zh / en 任一命中）、几何按关系量判（±1px）。**夹具自带数据**：`session/list` 回执的 `items` 整个换成四条**合成**会话、`workspace/follow` 基线帧换成一棵**合成**工作区（成员 = 那四条）、假宿主状态里 `recycle-bin` / `pinned` / `unread` 都指向合成 id——所以本套件**一条断言都不吃当天数据**（没有「树里至少要有 N 条会话」这类前置条件：全新隔离实例上一条会话都没有，这一条照样跑到底）。**① 抽屉头三样**——最左是「返回」（标记 `data-dshone-tree-action="recycle-close"`：原来那枚 ✕ 由它接手，同一个动作同一个标记；`aria-label` / `title` = 词典 `recycle.back`；图标是官方的左向箭头：14 视框 / 画成 14×14；方盒取紧凑档 `iconButtonSize`），点它抽屉收起且再点入口行仍能打开；「清空」与「恢复全部」在标题右侧、**与底部入口行那两枚同一形态**（尺寸 / 圆角 / 图标 `path@d` / 词典文案四项逐项相同，清空按官方错误色 `--dsw-alias-state-error-primary` 的解析值）——点「清空」开的是**既有的**归档确认弹窗、取消后弹窗关掉、回收站状态一条不少、这一趟没有任何写类 `/api/` 方法（页面自己轮询的读接口不算）；点「恢复全部」走**既有的**全部还原（恰好一条 `state.write`、没有任何写类 `/api/` 方法、抽屉里的行清空、入口角标归 0）；计数与标题在**同一内联组**里（计数左缘 − 标题右缘 = 那一组自己的 `column-gap`，±1px），且计数 = 抽屉里此刻的行数；三档宽度（260/340/500）下抽屉头 / 抽屉列表 / 行 / 列表 / 文档都不横向溢出、三样都还在框里、计数仍可见。**② 行的右键入口**——行上没有常显的 ⋯ 入口（`[data-dshone-recycle-menu]` 计数为 0），在行上右键（不点任何按钮）能开出一份菜单，里面**恰好两项**（`recycle-restore` / `recycle-archive`，顺序固定），文案 = 词典 `recycle.restore` / `menu.archiveForever`、图标 `path@d` 与行尾那两枚动作按钮里的图标**逐字相同**（同一份项的两个出口），开菜单时那一行带上 `menuOpen`；菜单里的「归档」开的是同一个确认弹窗（取消后没有任何写类 `/api/` 方法、状态不动）。**③ 状态点与主树同一口径**——夹具把某条合成会话的 `running` 置为 true，先读它在**主树**行上的状态点（`data-state=ongoing`、官方 8 格矩阵：10×10 视框 / 8 个形状、颜色 = token `--dsw-static-deepseek-450` 的解析值、状态槽取标准档 16×20），再用**既有的**行菜单「移入回收站」把**同一条会话**挪进抽屉，读它在**抽屉**里的同一枚点——`data-state` / 形状指纹 / 解析色 / 状态槽几何逐项相同，且点整个落在行里、在标题之前；未读那一档另判：夹具注入一条未读的回收站会话，主树那一侧用行菜单「标为未读」现场造一条，两侧 `data-state`（done）、读屏文案（词典 `status.unread`）与标题字重（600）逐项相同。**④ 图钉**——夹具注入「已置顶 + 已在回收站」的那条（这个组合界面本身造不出来：置顶的会话不许移入回收站），抽屉行标题前出现图钉，且与主树里另一条置顶行的图钉是**同一枚标记**（形状指纹 / 视框 / 绘制尺寸逐项相同、几何 14×14、都在标题之前）；没置顶的那条行上图钉数为 0。**收尾**——计数 0 那一页（同一套夹具、回收站注入空集合）里「清空 / 恢复全部」两枚禁用且降透明度、返回仍能把抽屉关掉；全程零 pageerror、零写类 `/api/` 方法（本套件从不点归档确认）。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const shot = async (page: OpenedPage['page'], name: string): Promise<string> => {
      const file = path.join(ctx.shots, `${name}.png`)
      await fsp.mkdir(ctx.shots, { recursive: true })
      await page.screenshot({ path: file })
      return file
    }

    /** 一页的共用装置：只读守卫 + 两个夹具（页面语言与当天数据都不进判据）。 */
    const setUpPage = async (
      target: OpenedPage,
      apiCalls: string[],
    ): Promise<{ list: { calls: number; replaced: number }; workspace: { frames: number; dropped: number } }> => {
      await target.page.route('**/api/**', async (r) => {
        apiCalls.push(decodeURIComponent(r.request().url()).split('/api/')[1] ?? '')
        await r.continue()
      })
      const list = await installSyntheticListFixture(target.page, (method) => apiCalls.push(method))
      const workspace = await installSyntheticWorkspaceFixture(target.page)
      // 先种上当前会话（见 `seedCurrentSession`），再重载让夹具与它一起生效。
      await seedCurrentSession(target.context)
      await target.page.reload({ waitUntil: 'domcontentloaded' })
      await target.page.waitForSelector(route('sidebar').readySelector, { timeout: 40_000 })
      await target.page.waitForTimeout(2_500)
      return { list, workspace }
    }

    const opened = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), {
      width: 340,
      height: 900,
      state: LAB_HOST_STATE,
    })
    const { page } = opened
    const apiCalls: string[] = []
    try {
      await page.waitForSelector(route('sidebar').readySelector)
      const fixtures = await setUpPage(opened, apiCalls)
      // 开页阶段（夹具装好、页面重载完）走过的 `/api/`：单独记一份——「本套件自己的动作不写网关」
      // 这条只对**测量窗口**成立，装载期是页面自己（官方客户端）在讲话。
      const bootApiCalls = [...apiCalls]
      check.fact(`开页阶段走过的 /api/ 方法：${JSON.stringify(bootApiCalls)}`)
      check.fact(
        `夹具：session/list 被换 ${String(fixtures.list.calls)} 次（每次 ${String(fixtures.list.replaced)} 条合成会话）；` +
          `workspace/follow 基线帧被换 ${String(fixtures.workspace.frames)} 次、丢掉的非基线帧 ${String(fixtures.workspace.dropped)} 帧`,
      )
      check.ok(
        '夹具接上了：session/list 回执被换成四条合成会话、workspace/follow 基线帧被换成一棵合成工作区',
        fixtures.list.calls >= 1 && fixtures.list.replaced === LAB_SESSIONS.length && fixtures.workspace.frames >= 1,
        JSON.stringify(fixtures),
      )
      const expandedBefore = await expandLabWorkspace(page)
      const treeRowIds = await page.evaluate((selector: string) =>
        Array.from(document.querySelectorAll(selector)).map((row) => row.getAttribute('data-dshone-tree-session') ?? ''),
        TREE_ROWS,
      )
      check.eq(
        '夹具生效：页面把夹具那条跑着的会话当成「当前会话」（种了官方恢复键；官方那条「没有当前会话就给最近工作区建空白会话」的自启逻辑因此早退）',
        await page.getAttribute(`[data-dshone-tree-session="${LAB_RUNNING.id}"]`, 'aria-selected'),
        'true',
      )
      const treeTitles = await page.evaluate((selector: string) =>
        Array.from(document.querySelectorAll(selector)).map((row) => row.querySelector('.dshOneTree_title')?.textContent ?? ''),
        TREE_ROWS,
      )
      check.fact(`树里的会话行：${JSON.stringify(treeTitles)}（展开前 aria-expanded=${expandedBefore || '行还没渲染'}）`)
      check.eq(
        '夹具生效：树里恰好是那四条里**没进回收站**的两条（另外两条按设计在回收站里、不进树）',
        [...treeRowIds].sort(),
        [LAB_RUNNING.id, LAB_PINNED_IN_TREE.id].sort(),
      )
      const entryAria = await page.getAttribute(ENTRY_MAIN, 'aria-label')
      const pageLang =
        entryAria?.startsWith(ZH['recycle.open'] ?? '\u0000') === true
          ? 'zh'
          : entryAria?.startsWith(EN['recycle.open'] ?? '\u0000') === true
            ? 'en'
            : ''
      check.fact(`页面实际语言（按入口行 aria-label 「${String(entryAria)}」与词典比对读出）：${pageLang || '都不是（下面那几条词典断言会当场红）'}`)

      // =====================================================================
      // ③-A 抽屉关着时先量主树：那条跑着的会话的状态点 / 那条置顶行的图钉
      // =====================================================================
      const treeDot = await readTreeRow(page, LAB_RUNNING.id)
      check.fact(
        `主树里那条跑着的会话：标题「${treeDot.titleText}」data-state=${treeDot.dot?.state ?? '无点'} 视框=${treeDot.dot?.viewBox ?? ''} 形状数=${String(treeDot.dot?.shapeCount ?? -1)} 色=${treeDot.dot?.color ?? ''} 状态槽=${JSON.stringify(treeDot.slot)}`,
      )
      check.eq('夹具生效：主树里那条会话的标题就是夹具给的那条', treeDot.titleText, LAB_RUNNING.title)
      check.ok('主树里那条会话亮着状态点（夹具给的 running 生效）', treeDot.dot !== null, JSON.stringify(treeDot.dot))
      check.eq('主树那一枚是「运行中」点', treeDot.dot?.state, 'ongoing')
      check.eq('主树那一枚是官方 8 格矩阵（10×10 视框 / 8 个形状）', [treeDot.dot?.viewBox, treeDot.dot?.shapeCount], ['0 0 10 10', 8])
      const ongoingToken = await tokenValue(page, '--dsw-static-deepseek-450')
      check.eq('主树那一枚的颜色 = 官方 token `--dsw-static-deepseek-450` 的解析值', treeDot.dot?.color, ongoingToken)
      check.ok(
        '主树那一枚的状态槽取标准档（16×20）',
        treeDot.slot !== null &&
          Math.abs(treeDot.slot.width - px(SCALE_TIERS.standard.slotWidth)) <= SIZE_EPS &&
          Math.abs(treeDot.slot.height - px(SCALE_TIERS.standard.slotHeight)) <= SIZE_EPS,
        JSON.stringify(treeDot.slot),
      )

      const treePin = await readTreeRow(page, LAB_PINNED_IN_TREE.id)
      const treePinIcon = await readIcon(page, `[data-dshone-tree-session="${LAB_PINNED_IN_TREE.id}"] .dshOneTree_pin`)
      check.ok('主树里那条置顶行有图钉（夹具注入的 `pinned` 被读到了）', treePin.pin !== null && treePinIcon !== null, JSON.stringify(treePin.pin))
      check.ok(
        '主树图钉几何 14×14（紧凑档 iconSize）',
        treePin.pin !== null &&
          Math.abs(treePin.pin.width - px(SCALE_TIERS.compact.iconSize)) <= SIZE_EPS &&
          Math.abs(treePin.pin.height - px(SCALE_TIERS.compact.iconSize)) <= SIZE_EPS,
        JSON.stringify(treePin.pin),
      )
      check.ok(
        '主树图钉在标题之前（左缘 ≤ 标题左缘）',
        treePin.pin !== null && treePin.title !== null && treePin.pin.left <= treePin.title.left,
        `图钉 ${String(treePin.pin?.left)} vs 标题 ${String(treePin.title?.left)}`,
      )

      // ---- 抽屉关着时用既有行菜单造现场：那条跑着的挪进回收站、那条置顶的标为未读 ----
      const writesBeforeMove = (await hostBin(page)).writes
      await clickRowMenuItem(page, LAB_RUNNING.id, 'move-to-recycle-bin')
      const afterMove = await hostBin(page)
      check.eq('「移入回收站」只写本地集合（恰好一条 state.write）', afterMove.writes - writesBeforeMove, 1)
      check.ok('那条会话落进本地回收站集合', afterMove.ids.includes(LAB_RUNNING.id), JSON.stringify(afterMove.ids))

      await clickRowMenuItem(page, LAB_PINNED_IN_TREE.id, 'unread')
      const treeUnread = await readTreeRow(page, LAB_PINNED_IN_TREE.id)
      check.fact(
        `主树那条标为未读之后：data-state=${treeUnread.dot?.state ?? '无点'} 读屏=${treeUnread.readLabels} 字重=${treeUnread.titleWeight}`,
      )
      check.eq('未读那一档主树亮的是「未读」点（官方 done 那一档）', treeUnread.dot?.state, 'done')
      check.ok(
        '未读的读屏文案 = 词典 `status.unread`（页面语言 zh / en 任一）',
        dictLang('status.unread', treeUnread.readLabels) !== '',
        `实际=${JSON.stringify(treeUnread.readLabels)} ${dictBoth('status.unread')}`,
      )
      check.eq('未读的标题加粗（600，与主树既有口径一致）', treeUnread.titleWeight, '600')

      // =====================================================================
      // 打开抽屉：量抽屉里的同一枚点、图钉、未读
      // =====================================================================
      await page.click(ENTRY_MAIN)
      await page.waitForTimeout(500)
      check.eq('抽屉打开', await page.locator(DRAWER).count(), 1)
      screenshots.push(await shot(page, 'recycle-drawer-complete-open'))

      const drawerRow = await readDrawer(page, LAB_RUNNING.id)
      check.ok('夹具生效：抽屉里有那条刚挪进来的会话行', drawerRow.row !== null, JSON.stringify(drawerRow.row))
      check.eq('夹具生效：抽屉里那条行的标题就是夹具给的那条', drawerRow.rowTitleText, LAB_RUNNING.title)
      check.fact(
        `抽屉里同一会话：data-state=${drawerRow.rowDot?.state ?? '无点'} 视框=${drawerRow.rowDot?.viewBox ?? ''} 形状数=${String(drawerRow.rowDot?.shapeCount ?? -1)} 色=${drawerRow.rowDot?.color ?? ''} 状态槽=${JSON.stringify(drawerRow.rowSlot)}`,
      )
      check.eq('③ 同一会话：抽屉里那枚点与主树里那枚 `data-state` 相同', drawerRow.rowDot?.state, treeDot.dot?.state)
      check.eq(
        '③ 同一会话：形状指纹相同（同一枚官方 `StateDot`：10×10 视框 / 8 个形状）',
        [drawerRow.rowDot?.viewBox, drawerRow.rowDot?.shapeCount],
        [treeDot.dot?.viewBox, treeDot.dot?.shapeCount],
      )
      check.eq('③ 同一会话：解析色相同（同一枚 token 算出来的值）', drawerRow.rowDot?.color, treeDot.dot?.color)
      check.ok(
        '③ 状态点那一格取标准档（16×20，与主树同一格）',
        drawerRow.rowSlot !== null &&
          Math.abs(drawerRow.rowSlot.width - px(SCALE_TIERS.standard.slotWidth)) <= SIZE_EPS &&
          Math.abs(drawerRow.rowSlot.height - px(SCALE_TIERS.standard.slotHeight)) <= SIZE_EPS,
        JSON.stringify(drawerRow.rowSlot),
      )
      check.ok(
        '③ 状态点整个落在行里、在标题之前',
        drawerRow.rowDot !== null &&
          drawerRow.row !== null &&
          drawerRow.rowTitle !== null &&
          drawerRow.rowDot.box.left >= drawerRow.row.left &&
          drawerRow.rowDot.box.left <= drawerRow.rowTitle.left,
        `点 ${String(drawerRow.rowDot?.box.left)} 行 ${String(drawerRow.row?.left)} 标题 ${String(drawerRow.rowTitle?.left)}`,
      )

      // ④ 图钉：抽屉里那条「已置顶 + 已在回收站」的，与主树那一枚是同一枚标记。
      const pinnedRow = await readDrawer(page, LAB_PINNED_IN_BIN.id)
      check.ok('夹具生效：抽屉里那条置顶会话的行有图钉（界面上造不出的组合由夹具注入）', pinnedRow.rowPin !== null, JSON.stringify(pinnedRow.rowPin))
      check.eq('夹具生效：抽屉里那条行的标题就是夹具给的那条', pinnedRow.rowTitleText, LAB_PINNED_IN_BIN.title)
      check.eq('④ 图钉是同一枚标记：形状指纹逐字相同', pinnedRow.rowPinIcon?.shapes, treePinIcon?.shapes)
      check.eq(
        '④ 图钉的视框与绘制尺寸与主树那一枚相同',
        [pinnedRow.rowPinIcon?.viewBox, pinnedRow.rowPinIcon?.width, pinnedRow.rowPinIcon?.height],
        [treePinIcon?.viewBox, treePinIcon?.width, treePinIcon?.height],
      )
      check.ok(
        '④ 图钉几何 14×14（与主树那一枚同值）',
        pinnedRow.rowPin !== null &&
          treePin.pin !== null &&
          Math.abs(pinnedRow.rowPin.width - treePin.pin.width) <= SIZE_EPS &&
          Math.abs(pinnedRow.rowPin.height - treePin.pin.height) <= SIZE_EPS,
        `抽屉 ${JSON.stringify(pinnedRow.rowPin)} vs 主树 ${JSON.stringify(treePin.pin)}`,
      )
      check.ok(
        '④ 图钉在抽屉行的标题之前（与主树同一位置关系）',
        pinnedRow.rowPin !== null && pinnedRow.rowTitle !== null && pinnedRow.rowPin.left <= pinnedRow.rowTitle.left,
        `图钉 ${String(pinnedRow.rowPin?.left)} vs 标题 ${String(pinnedRow.rowTitle?.left)}`,
      )
      check.eq(
        '④ 没置顶的那条行上**没有**图钉（夹具只置顶了两条）',
        await page.locator(`${DRAWER_ROWS}[data-dshone-recycle-row="${LAB_RUNNING.id}"] .dshOneTree_pin`).count(),
        0,
      )

      // ③-C 未读：抽屉里那条（夹具注入）与主树那条（现场造的）逐项比。
      const unreadRow = await readDrawer(page, LAB_UNREAD_IN_BIN.id)
      const unreadDrawer = await page.evaluate((selector) => {
        const row = document.querySelector(selector)
        const dot = row?.querySelector('.dshOneTree_slot [data-state]') ?? null
        const title = row?.querySelector('.dshOneTree_title') ?? null
        return {
          state: dot?.getAttribute('data-state') ?? '',
          label: Array.from(row?.querySelectorAll('.dshOneTree_visuallyHidden') ?? [])
            .map((node) => node.textContent ?? '')
            .join('|'),
          weight: title === null ? '' : getComputedStyle(title).fontWeight,
        }
      }, `${DRAWER_ROWS}[data-dshone-recycle-row="${LAB_UNREAD_IN_BIN.id}"]`)
      check.fact(
        `未读两侧读数：主树=${JSON.stringify({ state: treeUnread.dot?.state, label: treeUnread.readLabels, weight: treeUnread.titleWeight })} 抽屉=${JSON.stringify(unreadDrawer)}（抽屉行在场=${String(unreadRow.row !== null)}）`,
      )
      check.ok('夹具生效：抽屉里那条未读会话的行在场', unreadRow.row !== null, JSON.stringify(unreadRow.row))
      check.eq('夹具生效：抽屉里那条行的标题就是夹具给的那条', unreadRow.rowTitleText, LAB_UNREAD_IN_BIN.title)
      check.eq('③ 未读两侧的 `data-state` 相同', unreadDrawer.state, treeUnread.dot?.state)
      check.eq('③ 未读两侧的读屏文案相同', unreadDrawer.label, treeUnread.readLabels)
      check.eq('③ 未读两侧的标题字重相同', unreadDrawer.weight, treeUnread.titleWeight)

      // =====================================================================
      // ② 行的右键入口：与行尾那两枚动作同一份项
      // =====================================================================
      check.eq('行上没有常显的 ⋯ 入口（#144 那一枚退场；右键那一份只在右键后才渲染）', drawerRow.explicitMenus, 0)
      check.eq('还没右键时页面上没有行菜单的项', await page.locator(MENU_RESTORE).count(), 0)

      const targetRow = page.locator(`${DRAWER_ROWS}[data-dshone-recycle-row="${LAB_RUNNING.id}"]`)
      const targetBox = await targetRow.boundingBox()
      check.ok('取到要点右键的那一行', targetBox !== null, JSON.stringify(targetBox))
      if (targetBox === null) return screenshots
      await page.mouse.click(targetBox.x + 40, targetBox.y + targetBox.height / 2, { button: 'right' })
      await page.waitForTimeout(400)
      const menuFacts = await page.evaluate(
        ([restoreSelector, archiveSelector, menuRestore, menuArchive, rowSelector]) => {
          const pathsOf = (element: Element | null): string[] =>
            Array.from(element?.querySelectorAll('path') ?? []).map((node) => node.getAttribute('d') ?? '')
          const menuButton = (selector: string): Element | null => document.querySelector(selector)?.closest('button') ?? null
          const row = document.querySelector(rowSelector)
          return {
            items: document.querySelectorAll('[role="menuitem"]').length,
            restorePath: pathsOf(menuButton(menuRestore)),
            archivePath: pathsOf(menuButton(menuArchive)),
            restoreText: (document.querySelector(menuRestore)?.textContent ?? '').trim(),
            archiveText: (document.querySelector(menuArchive)?.textContent ?? '').trim(),
            inlineRestorePath: pathsOf(row?.querySelector(restoreSelector) ?? null),
            inlineArchivePath: pathsOf(row?.querySelector(archiveSelector) ?? null),
            menuOpenRow: row?.className.includes('dshOneTree_menuOpen') ?? false,
          }
        },
        [
          '[data-dshone-recycle-restore]',
          '[data-dshone-recycle-archive]',
          MENU_RESTORE,
          MENU_ARCHIVE,
          `${DRAWER_ROWS}[data-dshone-recycle-row="${LAB_RUNNING.id}"]`,
        ] as const,
      )
      check.fact(
        `右键菜单：项=${String(menuFacts.items)} 还原「${menuFacts.restoreText}」归档「${menuFacts.archiveText}」行带 menuOpen=${String(menuFacts.menuOpenRow)}`,
      )
      screenshots.push(await shot(page, 'recycle-drawer-complete-context-menu'))
      check.eq('行右键真的开出了菜单（恰好两项）', menuFacts.items, 2)
      check.ok(
        '菜单项的文案 = 词典 recycle.restore（与行尾那一枚同一个动作；页面语言 zh / en 任一）',
        dictLang('recycle.restore', menuFacts.restoreText) !== '',
        `实际=${JSON.stringify(menuFacts.restoreText)} ${dictBoth('recycle.restore')}`,
      )
      check.ok(
        '菜单项的文案 = 词典 menu.archiveForever（与行尾那一枚同一个动作；页面语言 zh / en 任一）',
        dictLang('menu.archiveForever', menuFacts.archiveText) !== '',
        `实际=${JSON.stringify(menuFacts.archiveText)} ${dictBoth('menu.archiveForever')}`,
      )
      check.ok(
        '菜单里「还原」的图标与行尾那一枚逐字相同（`path@d`）',
        menuFacts.restorePath.length > 0 && JSON.stringify(menuFacts.restorePath) === JSON.stringify(menuFacts.inlineRestorePath),
        `菜单 ${JSON.stringify(menuFacts.restorePath)} vs 行尾 ${JSON.stringify(menuFacts.inlineRestorePath)}`,
      )
      check.ok(
        '菜单里「永久归档」的图标与行尾那一枚逐字相同（`path@d`）',
        menuFacts.archivePath.length > 0 && JSON.stringify(menuFacts.archivePath) === JSON.stringify(menuFacts.inlineArchivePath),
        `菜单 ${JSON.stringify(menuFacts.archivePath)} vs 行尾 ${JSON.stringify(menuFacts.inlineArchivePath)}`,
      )
      check.ok('菜单开着时那一行带 menuOpen 标记（与主树行菜单同一处置）', menuFacts.menuOpenRow)

      // 菜单里的「归档」= 同一个终点动作：开既有的确认弹窗（取消 → 不动状态、不写网关）。
      const apiBeforeMenuArchive = apiCalls.length
      const binBeforeMenuArchive = await hostBin(page)
      await page.click(MENU_ARCHIVE)
      await page.waitForTimeout(400)
      const confirmFromMenu = await page.evaluate(
        ([confirmSelector, rowSelector]) => ({
          button: document.querySelector(confirmSelector) !== null,
          rows: document.querySelectorAll(rowSelector).length,
        }),
        [CONFIRM, '[data-dshone-archive-row]'] as const,
      )
      check.ok('右键菜单里的「归档」开的是既有的归档确认弹窗（同一个终点动作）', confirmFromMenu.button && confirmFromMenu.rows >= 1, JSON.stringify(confirmFromMenu))
      screenshots.push(await shot(page, 'recycle-drawer-complete-menu-archive-confirm'))
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
      check.eq('取消确认 → 弹窗关掉', await page.locator(CONFIRM).count(), 0)
      check.eq('取消确认 → 回收站状态一条不少', (await hostBin(page)).ids, binBeforeMenuArchive.ids)
      check.fact(`右键菜单归档 + 取消这一趟走过的 /api/ 方法：${JSON.stringify(apiCalls.slice(apiBeforeMenuArchive))}`)
      check.eq(
        '右键菜单归档 + 取消这一趟：没有任何写类 /api/ 方法',
        apiCalls.slice(apiBeforeMenuArchive).filter((call) => WRITE_METHOD.test(call)),
        [],
      )
      // Esc 可能把抽屉也带走（抽屉自己的 Esc 与弹窗的 Esc 是两条独立路径），带走就重新打开。
      if ((await page.locator(DRAWER).count()) === 0) {
        check.fact('取消确认后抽屉跟着 Esc 一起关掉了（既有路径，与本次改动无关）——重新打开继续')
        await page.click(ENTRY_MAIN)
        await page.waitForTimeout(500)
      }

      // =====================================================================
      // ① 抽屉头三样：在场、形态（与底部入口行那两枚同一形态）、几何、文案
      // =====================================================================
      const head = await readDrawer(page, LAB_RUNNING.id)
      check.ok('① 抽屉头最左是「返回」', head.back !== null, JSON.stringify(head.back))
      check.ok(
        '① 返回的 aria-label = 词典 recycle.back（页面语言 zh / en 任一）',
        dictLang('recycle.back', head.back?.aria) !== '',
        `实际=${JSON.stringify(head.back?.aria)} ${dictBoth('recycle.back')}`,
      )
      check.ok(
        '① 返回的 title = 词典 recycle.back（悬停提示与读屏同一句）',
        dictLang('recycle.back', head.back?.title) !== '',
        `实际=${JSON.stringify(head.back?.title)} ${dictBoth('recycle.back')}`,
      )
      check.eq('① 返回用的就是官方左向箭头（组件标记）', head.back?.name, 'IconChevronLeftOutline14')
      check.ok(
        '① 返回的图标是官方 14 档图标的渲染（`viewBox="0 0 14 14"` / 画成 14×14 / 至少一条形状；`path@d` 记在事实里，截图看方向）',
        head.back?.icon != null &&
          head.back.icon.viewBox === '0 0 14 14' &&
          head.back.icon.width === '14' &&
          head.back.icon.height === '14' &&
          head.back.icon.shapes.length >= 1,
        JSON.stringify(head.back?.icon),
      )
      check.eq(
        '① 返回的按钮几何 = 紧凑档 iconButtonSize 的方盒（与顶栏那几枚同一条骨架语言）',
        [head.back?.box.width, head.back?.box.height],
        [px(SCALE_TIERS.compact.iconButtonSize), px(SCALE_TIERS.compact.iconButtonSize)],
      )
      check.ok('① 抽屉头里「清空」在场', head.empty !== null, JSON.stringify(head.empty))
      check.ok('① 抽屉头里「恢复全部」在场', head.restoreAll !== null, JSON.stringify(head.restoreAll))
      check.ok(
        '① 清空的 aria-label = 词典 recycle.emptyAll（与入口行那枚同一句；页面语言 zh / en 任一）',
        dictLang('recycle.emptyAll', head.empty?.aria) !== '',
        `实际=${JSON.stringify(head.empty?.aria)} ${dictBoth('recycle.emptyAll')}`,
      )
      check.ok(
        '① 恢复全部的 aria-label = 词典 recycle.restoreAll（与入口行那枚同一句；页面语言 zh / en 任一）',
        dictLang('recycle.restoreAll', head.restoreAll?.aria) !== '',
        `实际=${JSON.stringify(head.restoreAll?.aria)} ${dictBoth('recycle.restoreAll')}`,
      )
      check.eq('① 入口行清空那一枚的 aria-label 也是同一句（两处同一份文案）', head.entryEmpty?.aria, head.empty?.aria)
      check.eq('① 入口行恢复全部那一枚的 aria-label 也是同一句', head.entryRestoreAll?.aria, head.restoreAll?.aria)
      check.eq(
        '① 清空这一枚与入口行那枚同一形态（尺寸 / 圆角 / 图标形状指纹）',
        [head.empty?.box.width, head.empty?.box.height, head.empty?.radius, JSON.stringify(head.empty?.icon?.shapes)],
        [head.entryEmpty?.box.width, head.entryEmpty?.box.height, head.entryEmpty?.radius, JSON.stringify(head.entryEmpty?.icon?.shapes)],
      )
      check.eq(
        '① 恢复全部这一枚与入口行那枚同一形态（尺寸 / 圆角 / 图标形状指纹）',
        [head.restoreAll?.box.width, head.restoreAll?.box.height, head.restoreAll?.radius, JSON.stringify(head.restoreAll?.icon?.shapes)],
        [
          head.entryRestoreAll?.box.width,
          head.entryRestoreAll?.box.height,
          head.entryRestoreAll?.radius,
          JSON.stringify(head.entryRestoreAll?.icon?.shapes),
        ],
      )
      check.ok(
        '① 两枚的尺寸 = 紧凑档 iconButtonSize（档位表里查得到出处）',
        [head.empty, head.restoreAll].every(
          (entry) =>
            entry !== null &&
            Math.abs(entry.box.width - px(SCALE_TIERS.compact.iconButtonSize)) <= SIZE_EPS &&
            Math.abs(entry.box.height - px(SCALE_TIERS.compact.iconButtonSize)) <= SIZE_EPS,
        ),
        JSON.stringify([head.empty?.box, head.restoreAll?.box]),
      )
      const errorToken = await tokenValue(page, '--dsw-alias-state-error-primary')
      check.eq('① 清空按危险色（官方错误 token 的解析值）', head.empty?.color, errorToken)
      check.ok(
        '① 恢复全部不是危险色（与清空分得开）',
        head.restoreAll?.color !== head.empty?.color,
        `${String(head.restoreAll?.color)} vs ${String(head.empty?.color)}`,
      )
      const headerOrder = [head.back?.box.left, head.count?.left, head.empty?.box.left, head.restoreAll?.box.left]
      check.ok(
        '① 头里的顺序：返回 → 标题/计数 → 清空 → 恢复全部',
        headerOrder.every((value) => typeof value === 'number') &&
          headerOrder.every((value, index) => index === 0 || (value as number) > (headerOrder[index - 1] as number)),
        JSON.stringify(headerOrder),
      )
      check.ok(
        '① 标题文字 = 词典 recycle.title（页面语言 zh / en 任一）',
        dictLang('recycle.title', head.titleText) !== '',
        `实际=${JSON.stringify(head.titleText)} ${dictBoth('recycle.title')}`,
      )
      check.eq('① 计数 = 抽屉里此刻的行数（关系量，不写死条数）', head.countText, String(head.rows))
      check.ok(
        '① 计数与标题在同一个内联组里（计数左缘 − 标题右缘 = 那一组自己的 column-gap，±1px）',
        head.heading !== null &&
          head.title !== null &&
          head.count !== null &&
          head.headingGap >= 0 &&
          Math.abs(head.count.left - head.title.right - head.headingGap) <= EPS &&
          head.count.left >= head.heading.left &&
          head.count.right <= head.heading.right + EPS,
        `标题右缘 ${String(head.title?.right)} 计数左缘 ${String(head.count?.left)} gap=${String(head.headingGap)} 组=${JSON.stringify(head.heading)}`,
      )
      check.ok(
        '① 三样都在抽屉头的框里（左缘 ≥ 头左缘、右缘 ≤ 头右缘）',
        head.header !== null &&
          head.back !== null &&
          head.restoreAll !== null &&
          head.back.box.left >= head.header.left &&
          head.restoreAll.box.right <= head.header.right + EPS + 1,
        `头 ${JSON.stringify(head.header)} 返回 ${JSON.stringify(head.back?.box)} 恢复 ${JSON.stringify(head.restoreAll?.box)}`,
      )

      // =====================================================================
      // ① 三档宽度：三样都还在框里、计数可见、四处都不横向溢出
      // =====================================================================
      for (const width of [260, 340, 500] as const) {
        await page.setViewportSize({ width, height: 900 })
        await page.waitForTimeout(350)
        const reading = await readDrawer(page, LAB_PINNED_IN_BIN.id)
        const overflow = await overflowFacts(page)
        check.fact(
          `@${String(width)}：头=${JSON.stringify(reading.header)} 返回=${JSON.stringify(reading.back?.box)} 清空=${JSON.stringify(reading.empty?.box)} 恢复全部=${JSON.stringify(reading.restoreAll?.box)} 计数「${reading.countText}」=${JSON.stringify(reading.count)}`,
        )
        check.ok(
          `@${String(width)} 抽屉头三样都还在框里（左缘 ≥ 头左缘、右缘 ≤ 头右缘 + 1）`,
          reading.header !== null &&
            reading.back !== null &&
            reading.empty !== null &&
            reading.restoreAll !== null &&
            reading.back.box.left >= reading.header.left &&
            reading.restoreAll.box.right <= reading.header.right + EPS + 1,
          JSON.stringify({ header: reading.header, back: reading.back?.box, restore: reading.restoreAll?.box }),
        )
        check.ok(
          `@${String(width)} 抽屉头 / 抽屉列表 / 行 / 列表 / 文档都不横向溢出`,
          overflow.header <= 1 && overflow.drawer <= 1 && overflow.row <= 1 && overflow.list <= 1 && overflow.doc <= 1,
          JSON.stringify(overflow),
        )
        check.ok(
          `@${String(width)} 计数仍可见（宽高非 0、右缘仍在框内）`,
          reading.count !== null && reading.count.width > 0 && reading.count.right <= (reading.header?.right ?? 0) + EPS + 1,
          JSON.stringify(reading.count),
        )
      }
      await page.setViewportSize({ width: 340, height: 900 })
      await page.waitForTimeout(300)

      // =====================================================================
      // ① 返回：点它抽屉收起（有滑出过渡，等得比过渡长），再点入口行仍能打开
      // =====================================================================
      await page.click(BACK)
      await page.waitForTimeout(600)
      check.eq('① 点「返回」抽屉收起', await page.locator(DRAWER).count(), 0)
      check.eq('① 收起后入口行的标记同步翻成收起', await page.getAttribute(ENTRY_MAIN, 'data-dshone-tree-recycle-expanded'), 'false')
      await page.click(ENTRY_MAIN)
      await page.waitForTimeout(500)
      check.eq('① 再点入口行仍能打开（返回没有把开合态弄坏）', await page.locator(DRAWER).count(), 1)

      // =====================================================================
      // ① 清空：开既有的确认弹窗；取消 → 状态不动、不写网关
      // =====================================================================
      const apiBeforeEmpty = apiCalls.length
      const binBeforeEmpty = await hostBin(page)
      await page.click(HEADER_EMPTY)
      await page.waitForTimeout(400)
      const confirmFromHeader = await page.evaluate(
        ([confirmSelector, rowSelector]) => ({
          button: document.querySelector(confirmSelector) !== null,
          rows: document.querySelectorAll(rowSelector).length,
        }),
        [CONFIRM, '[data-dshone-archive-row]'] as const,
      )
      check.ok('① 点抽屉头的「清空」开的是既有的归档确认弹窗', confirmFromHeader.button && confirmFromHeader.rows >= 1, JSON.stringify(confirmFromHeader))
      screenshots.push(await shot(page, 'recycle-drawer-complete-header-empty-confirm'))
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
      check.eq('取消确认 → 弹窗关掉', await page.locator(CONFIRM).count(), 0)
      check.eq('取消确认 → 回收站状态一条不少', (await hostBin(page)).ids, binBeforeEmpty.ids)
      check.fact(`点清空 + 取消这一趟走过的 /api/ 方法：${JSON.stringify(apiCalls.slice(apiBeforeEmpty))}`)
      check.eq(
        '点清空 + 取消这一趟：没有任何写类 /api/ 方法（没有落到网关的写面）',
        apiCalls.slice(apiBeforeEmpty).filter((call) => WRITE_METHOD.test(call)),
        [],
      )
      if ((await page.locator(DRAWER).count()) === 0) {
        check.fact('取消确认后抽屉跟着 Esc 一起关掉了（既有路径）——重新打开继续')
        await page.click(ENTRY_MAIN)
        await page.waitForTimeout(500)
      }

      // =====================================================================
      // ① 恢复全部：本地可逆（一条 state.write、不写网关、行清空、角标归 0）
      // =====================================================================
      const apiBeforeRestoreAll = apiCalls.length
      const writesBeforeRestoreAll = (await hostBin(page)).writes
      await page.click(HEADER_RESTORE_ALL)
      await page.waitForTimeout(700)
      const binAfterRestoreAll = await hostBin(page)
      check.eq('① 点「恢复全部」走既有的全部还原：本地集合清空', binAfterRestoreAll.ids, [])
      check.eq('① 全程只落一条本地写入（state.write 的 recycle-bin，不落网关）', binAfterRestoreAll.writes - writesBeforeRestoreAll, 1)
      check.eq('① 恢复全部后抽屉里的行清空', await page.locator(DRAWER_ROWS).count(), 0)
      check.eq('① 恢复全部后入口角标归 0', await page.getAttribute(ENTRY_MAIN, 'data-dshone-tree-recycle-count'), '0')
      await expandLabWorkspace(page)
      const treeAfterRestore = await page.evaluate((selector: string) =>
        Array.from(document.querySelectorAll(selector))
          .map((row) => row.getAttribute('data-dshone-tree-session') ?? '')
          .sort(),
        TREE_ROWS,
      )
      check.eq(
        '① 恢复全部后四条合成会话全在树里',
        treeAfterRestore,
        LAB_SESSIONS.map((session) => session.id).sort(),
      )
      check.fact(`恢复全部这一趟走过的 /api/ 方法：${JSON.stringify(apiCalls.slice(apiBeforeRestoreAll))}`)
      check.eq(
        '① 恢复全部这一趟：没有任何写类 /api/ 方法（本地可逆那一层不碰网关写面）',
        apiCalls.slice(apiBeforeRestoreAll).filter((call) => WRITE_METHOD.test(call)),
        [],
      )

      // =====================================================================
      // 第三页：计数 0 —— 两枚动作禁用且降透明度、返回仍可用（同一套夹具，回收站注入空集合）
      // =====================================================================
      const emptyPage = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), {
        width: 340,
        height: 900,
        state: { ...LAB_HOST_STATE, 'recycle-bin': { version: 1, sessionIds: [] } },
      })
      try {
        const emptyCalls: string[] = []
        const emptyFixtures = await setUpPage(emptyPage, emptyCalls)
        check.fact(`计数 0 那一页的夹具：${JSON.stringify(emptyFixtures)}`)
        const emptyDrawer = emptyPage.page
        await emptyDrawer.click(ENTRY_MAIN)
        await emptyDrawer.waitForTimeout(500)
        const emptyFacts = await readDrawer(emptyDrawer, '')
        check.fact(`计数 0 那一页：计数=${emptyFacts.countText} 行=${String(emptyFacts.rows)}`)
        check.eq('计数 0：抽屉头的计数是 0', emptyFacts.countText, '0')
        check.eq('计数 0：清空与恢复全部两枚都禁用', [emptyFacts.empty?.disabled, emptyFacts.restoreAll?.disabled], [true, true])
        const opacity = await emptyDrawer.evaluate(
          ([emptySelector, restoreSelector]) =>
            [emptySelector, restoreSelector].map((selector) =>
              Number.parseFloat(getComputedStyle(document.querySelector(selector) ?? document.body).opacity),
            ),
          [HEADER_EMPTY, HEADER_RESTORE_ALL] as const,
        )
        check.ok('计数 0：两枚都有灰态（opacity 降到 1 以下）', opacity.every((value) => value < 1), JSON.stringify(opacity))
        check.ok(
          '计数 0：返回仍可用（在场且没被禁用）',
          emptyFacts.back !== null && !(await emptyDrawer.isDisabled(BACK)),
          JSON.stringify(emptyFacts.back?.box),
        )
        await emptyDrawer.click(BACK)
        await emptyDrawer.waitForTimeout(600)
        check.eq('计数 0：点返回抽屉照样收起', await emptyDrawer.locator(DRAWER).count(), 0)
        screenshots.push(await shot(emptyDrawer, 'recycle-drawer-complete-empty'))
        check.eq('计数 0 那一页零 pageerror', withoutKnownNoise(emptyPage.capture.pageErrors).real, [])
      } finally {
        await emptyPage.context.close()
      }

      check.eq(
        '全程只读网关：没有任何写类 /api/ 方法',
        apiCalls.filter((call) => WRITE_METHOD.test(call)),
        [],
      )
      check.eq('本套件全程零 pageerror', withoutKnownNoise(opened.capture.pageErrors).real, [])
    } finally {
      await opened.context.close()
    }
    return screenshots
  },
}
