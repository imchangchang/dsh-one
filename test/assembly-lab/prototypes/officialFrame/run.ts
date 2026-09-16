/**
 * 官方 AppFrame 原型跑测（#89）：`node test/assembly-lab/prototypes/officialFrame/run.ts`
 *
 * 它做的事：起原型实验室服务器（真实模块 + 真实网关只读 + 假宿主）→ 用 Playwright
 * 逐场景开页、截图、量几何 → 写 ledger JSON → 用 `test/sandbox/report.mjs` 渲染
 * 单文件 HTML 报告。**只跑浏览器，不起真 VS Code 窗口**（AGENTS.md 铁律）。
 *
 * 参数：
 *   --port <n>        原型实验室端口（缺省 3313；其它 session 在用 3299/3311/3403）
 *   --compare-port    现状对照用的生产实验室端口（缺省 3314）
 *   --gateway <url>   网关地址（LAB_GATEWAY，缺省 3080）
 *   --token <token>   网关 launch token（缺省读 ~/.dsh/dsh-owned.json）
 *   --out <dir>       产物目录（缺省 test/assembly-lab/out/proto）
 *   --only <ids>      只跑指定场景 id（逗号分隔）
 *   --keep            跑完留服务器（人工点页面）
 */
import { execFileSync, spawnSync } from 'node:child_process'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, BrowserContext, Page } from 'playwright'
import { Check, capturePage, contractGaps, launchBrowser, type PageCapture } from '../../harness.ts'
import { fakeHostScript } from '../../fakeHost.ts'
import { consoleLogger, defaultGateway, defaultPluginsDir, LAB_TREES, startLabServer } from '../../labServer.ts'
import { listSessions } from '../../../../src/server/dshRpc.ts'
import { buildProtoPlugins } from './build.ts'
import { startProtoServer, type ProtoServer } from './server.ts'
import { type ProtoTreeRoute } from './trees.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.join(HERE, '..', '..', '..', '..')

interface Args {
  gateway: string
  token?: string
  port: number
  comparePort: number
  out: string
  only?: string[]
  keep: boolean
}

function parseArgs(argv: readonly string[]): Args {
  const value = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`)
    return index >= 0 ? argv[index + 1] : undefined
  }
  const token = value('token') ?? process.env.LAB_TOKEN ?? process.env.DSH_TOKEN
  const only = value('only')
  return {
    gateway: value('gateway') ?? defaultGateway(),
    ...(token === undefined || token === '' ? {} : { token }),
    port: Number(value('port') ?? process.env.LAB_PORT ?? 3313),
    comparePort: Number(value('compare-port') ?? 3314),
    out: path.resolve(value('out') ?? path.join(HERE, '..', '..', 'out', 'proto')),
    ...(only === undefined ? {} : { only: only.split(',').map((id) => id.trim()) }),
    keep: argv.includes('--keep'),
  }
}

// ---------------------------------------------------------------------------
// 页面观测
// ---------------------------------------------------------------------------

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

interface Measurements {
  /** 官方 AppFrame 根元素的内联 grid-template-columns（没适配前的官方值）。 */
  track: string
  /** 生效的 grid-template-columns（computed，可能是被覆盖后的值）。 */
  computedTrack: string
  frame: Rect | null
  sidebarCol: Rect | null
  centerCol: Rect | null
  rightbarCol: Rect | null
  /** 侧栏列里的侧栏根（官方 ui-sidebar 的 SidebarRoot，或我们自有树的根）。 */
  sidebarRoot: (Rect & { classList: string; inlineWidth: string }) | null
  /** 原型形态插件写下的观测（html[data-proto-shape]）。 */
  shape: Record<string, unknown> | null
  /** 自有 frame 的根（生产树用；原型树应为 null）。 */
  ownFrameRoot: Rect | null
  /** 页面上的槽位锚点与其中断标记。 */
  slotKeys: string[]
  slotErrors: number
  /** 官方拖拽把手（data-side=sidebar|rightbar）——官方白送的那两件。 */
  handles: string[]
  /** 官方右栏展开钮数量（会话头右侧角，官方 ui-sidebar-right 渲染）。 */
  expandButtons: number
  /** 收尾主题（DOM 侧）：官方 theme presenter 最后一次 apply 的结果。 */
  theme: { colorScheme: string; darkAttr: boolean; bodyBg: string; hostTheme: string }
  /** 广告牌式事实：中列里第一个可识别的内容容器。 */
  content: {
    composer: Rect | null
    settingsPage: Rect | null
    ownWorkspaceTree: Rect | null
    officialSessionTree: Rect | null
  }
}

const MEASURE_JS = `(() => {
  const rect = (el) => {
    if (el === null) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
  }
  const query = (sel) => document.querySelector(sel)
  const frame = query('div:has(> [data-shell-overlay])')
  const column = (suffix) => query('div:has(> [data-shell-overlay]) > [class*="_' + suffix + '"]')
  const sidebarCol = column('sidebarCol')
  // 侧栏根：侧栏列里第一个 css-module 类名后缀为 _root 的元素（官方 SidebarRoot 的哈希
  // 类名形如 hHd-Xa_root；按后缀匹配是实验室既有约定）。它身上挂着官方下发的内联 width
  //（= computeColumns 解出的侧栏轨宽）。
  const sidebarRoot =
    sidebarCol === null
      ? null
      : (Array.from(sidebarCol.querySelectorAll('[class]')).find((el) => /_root$/.test(el.className)) ?? null)
  return {
    track: frame === null ? '' : frame.style.gridTemplateColumns,
    computedTrack: frame === null ? '' : getComputedStyle(frame).gridTemplateColumns,
    frame: rect(frame),
    sidebarCol: rect(sidebarCol),
    centerCol: rect(column('centerCol')),
    rightbarCol: rect(column('rightbarCol')),
    sidebarRoot:
      sidebarRoot === null
        ? null
        : { ...rect(sidebarRoot), classList: sidebarRoot.className, inlineWidth: (sidebarRoot).style.width },
    shape: (() => { try { return JSON.parse(document.documentElement.dataset.protoShape ?? 'null') } catch { return null } })(),
    ownFrameRoot: rect(query('[data-shell]')),
    slotKeys: Array.from(document.querySelectorAll('[data-slot]')).map((el) => el.getAttribute('data-slot')),
    slotErrors: document.querySelectorAll('[data-slot-error]').length,
    handles: Array.from(document.querySelectorAll('[data-side]')).map((el) => el.getAttribute('data-side')),
    expandButtons: document.querySelectorAll('[data-sidebar-right-expand]').length,
    theme: {
      colorScheme: document.documentElement.style.colorScheme,
      darkAttr: document.body.hasAttribute('data-ds-dark-theme'),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      hostTheme: String(globalThis.__DSH_ONE_HOST_THEME__ ?? ''),
    },
    content: {
      composer: rect(query('[data-slot="conversation.composer.bar"]')),
      settingsPage: rect(query('.dshOneSettingsShell_page')),
      ownWorkspaceTree: rect(query('.dshOneTree_root')),
      officialSessionTree: rect(query('[class*="_sectionHeader"]')),
    },
  }
})()`

interface Opened {
  context: BrowserContext
  page: Page
  capture: PageCapture
  url: string
  measures: Measurements
}

async function openPage(
  browser: Browser,
  origin: string,
  route: ProtoTreeRoute,
  options: { width: number; height?: number; shape?: string; sessionId?: string; settleMs?: number },
): Promise<Opened> {
  const context = await browser.newContext({
    viewport: { width: options.width, height: options.height ?? 900 },
    deviceScaleFactor: 2,
  })
  await context.addInitScript({ content: fakeHostScript() })
  const page = await context.newPage()
  const capture = capturePage(page)
  const query = new URLSearchParams()
  if (options.shape !== undefined) query.set('shape', options.shape)
  if (options.sessionId !== undefined) query.set('session', options.sessionId)
  const suffix = query.toString() === '' ? '' : `?${query.toString()}`
  const url = `${origin}/${route.route}${suffix}`
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  try {
    await page.waitForSelector(route.readySelector, { timeout: 45_000 })
  } catch {
    /* ready 缺失由调用方断言 */
  }
  await page.waitForTimeout(options.settleMs ?? 3_000)
  const measures = (await page.evaluate(MEASURE_JS)) as Measurements
  return { context, page, capture, url, measures }
}

/** 零崩溃断言（与实验室 F-01 CONTRACT 同一口径）。 */
function assertNoContractGap(check: Check, label: string, opened: Opened): void {
  const gaps = contractGaps(opened.capture)
  check.eq(`${label}：无槽位崩溃（slot entry crashed）`, gaps.crashes, [])
  check.eq(`${label}：无装载未激活（did not activate / waiting for service）`, gaps.bootFails, [])
  check.eq(`${label}：零页面报错`, gaps.pageErrors, [])
  check.eq(`${label}：零 data-slot-error 锚点`, opened.measures.slotErrors, 0)
}

// ---------------------------------------------------------------------------
// 场景
// ---------------------------------------------------------------------------

interface Scenario {
  id: string
  phase: 'new-feature' | 'regression'
  name: string
  expect: string
  run: (deps: Deps, check: Check) => Promise<string[]>
}

interface Deps {
  browser: Browser
  proto: ProtoServer
  prod: { origin: string; trees: typeof LAB_TREES }
  shots: string
  sessionId: string
}

const routeOf = (routes: ReadonlyArray<ProtoTreeRoute>, name: string): ProtoTreeRoute => {
  const found = routes.find((route) => route.route === name)
  if (found === undefined) throw new Error(`no prototype route ${name}`)
  return found
}

async function shot(deps: Deps, name: string, page: Page): Promise<string> {
  const file = path.join(deps.shots, `${name}.png`)
  await page.screenshot({ path: file })
  return file
}

/** chat 原型的一个形态档：打开 → 截图 → 量列几何（返回最后一次观测，供调用方再断言）。 */
async function chatScenario(
  deps: Deps,
  check: Check,
  shape: string,
  width: number,
  name: string,
): Promise<{ shots: string[]; measures: Measurements }> {
  const route = routeOf(deps.proto.routes, 'proto-chat')
  const opened = await openPage(deps.browser, deps.proto.origin, route, { width, shape, sessionId: deps.sessionId })
  const m = opened.measures
  check.fact(`${name}：frame=${JSON.stringify(m.frame)} 列宽 sidebar=${String(m.sidebarCol?.width)} center=${String(m.centerCol?.width)} rightbar=${String(m.rightbarCol?.width)}`)
  check.fact(`${name}：官方内联轨=${JSON.stringify(m.track)}；生效轨=${JSON.stringify(m.computedTrack)}；shape=${JSON.stringify(m.shape)}`)
  const shots = [await shot(deps, name, opened.page)]
  assertNoContractGap(check, name, opened)
  check.ok(`${name}：官方 AppFrame 上台（有官方内联 grid-template-columns）`, m.track !== '', `track=${JSON.stringify(m.track)}`)
  check.ok(`${name}：对话区渲染在中列里（composer 座位有内容）`, m.content.composer !== null, JSON.stringify(m.content.composer))
  check.eq(`${name}：自有 frame 不在页面上（root 由官方渲染）`, m.ownFrameRoot, null)
  await opened.context.close()
  return { shots, measures: m }
}

const SCENARIOS: ReadonlyArray<Scenario> = [
  {
    id: 'P-01',
    phase: 'new-feature',
    name: 'chat 原型（内联轨道改写）：官方 AppFrame 上场 + 零侧栏列',
    expect:
      '官方 ui-layout 渲染 root（官方内联 grid-template-columns 在），形态档 shape=js 把第一轨归零：侧栏列宽 0、中列吃满剩余宽度、对话区照常渲染在中列里、官方右栏轨的运行时值原样保留。零槽位崩溃、零未激活、零页面报错。',
    async run(deps, check) {
      const wide = await chatScenario(deps, check, 'js', 1200, 'proto-chat-js-1200')
      check.ok('shape=js@1200：侧栏列宽 0', wide.measures.sidebarCol?.width === 0, JSON.stringify(wide.measures.sidebarCol))
      check.ok(
        'shape=js@1200：中列 = frame 宽（右栏收起时不吃宽度）',
        wide.measures.frame !== null && wide.measures.centerCol?.width === wide.measures.frame.width,
        `frame=${String(wide.measures.frame?.width)} center=${String(wide.measures.centerCol?.width)}`,
      )
      check.ok('shape=js：官方轨道改写真的跑了（内联轨被重写成 0px 开头）', String(wide.measures.shape?.appliedTrack ?? '').startsWith('0px '), JSON.stringify(wide.measures.shape))
      const narrow = await chatScenario(deps, check, 'js', 500, 'proto-chat-js-500')
      check.ok('shape=js@500（VS Code 侧栏视图宽度）：中列仍吃满 frame 宽', narrow.measures.frame !== null && narrow.measures.centerCol?.width === narrow.measures.frame.width, `frame=${String(narrow.measures.frame?.width)} center=${String(narrow.measures.centerCol?.width)}`)
      return [...wide.shots, ...narrow.shots]
    },
  },
  {
    id: 'P-02',
    phase: 'new-feature',
    name: 'chat 原型：官方右栏是白送的（轨道 + 把手 + 拖动真能用）',
    expect:
      '点会话头右侧角的官方展开钮（[data-sidebar-right-expand]）后：官方右栏面板出现在 frame 右缘、宽度 = min(视口-中列底线400, clamp(视口×45%,300,视口×70%))、中列让出同宽轨道、官方 `rightbar` 拖拽把手出现且拖动真的改宽（量前后宽度）。',
    async run(deps, check) {
      const route = routeOf(deps.proto.routes, 'proto-chat')
      const opened = await openPage(deps.browser, deps.proto.origin, route, { width: 1280, shape: 'js', sessionId: deps.sessionId })
      const page = opened.page
      const before = opened.measures
      check.fact(`展开前：frame=${JSON.stringify(before.frame)} center=${String(before.centerCol?.width)} 生效轨=${JSON.stringify(before.computedTrack)}`)
      const expand = page.locator('[data-sidebar-right-expand]').first()
      check.ok('会话头上有官方展开钮（[data-sidebar-right-expand]）', (await expand.count()) > 0)
      await expand.click({ timeout: 10_000 })
      await page.waitForTimeout(1_200)
      const after = (await page.evaluate(MEASURE_JS)) as Measurements
      const panel = await page.evaluate(() => {
        const el = document.querySelector('[data-sidebar-right-panel]')
        if (el === null) return null
        const r = el.getBoundingClientRect()
        return { x: Math.round(r.x), width: Math.round(r.width), open: el.hasAttribute('data-sidebar-right-open'), mode: el.getAttribute('data-sidebar-right-panel') }
      })
      const handles = await page.evaluate(() => Array.from(document.querySelectorAll('[data-side]')).map((el) => el.getAttribute('data-side')))
      check.fact(`展开后：面板=${JSON.stringify(panel)}；把手=${JSON.stringify(handles)}；center=${String(after.centerCol?.width)} rightbar 轨=${String(after.rightbarCol?.width)}`)
      check.ok('官方右栏面板出现在页面上', panel !== null && panel.open === true, JSON.stringify(panel))
      const expectedWidth = Math.min(1280 - 400, Math.min(Math.max(Math.round(1280 * 0.45), 300), Math.round(1280 * 0.7)))
      check.ok(
        `面板宽 = 官方公式 min(视口-400, clamp(视口×45%,300,70%)) = ${String(expectedWidth)}`,
        panel !== null && Math.abs(panel.width - expectedWidth) <= 2,
        `panel=${JSON.stringify(panel)} expected=${String(expectedWidth)}`,
      )
      check.ok('面板贴右缘（左缘 + 宽 ≈ frame 宽）', after.frame !== null && panel !== null && Math.abs(panel.x + panel.width - (after.frame.x + after.frame.width)) <= 2, `panel=${JSON.stringify(panel)} frame=${JSON.stringify(after.frame)}`)
      check.ok('中列让出同宽轨道（对比展开前）', before.centerCol !== null && after.centerCol !== null && before.centerCol.width - after.centerCol.width >= expectedWidth - 2, `before=${String(before.centerCol?.width)} after=${String(after.centerCol?.width)}`)
      check.ok('官方 rightbar 拖拽把手在', handles.includes('rightbar'), JSON.stringify(handles))
      const shots = [await shot(deps, 'proto-chat-rightbar-open', page)]
      // 拖把手：向左拖 120px → 官方 setRightbar(base - dx) → 面板变宽。
      const handle = page.locator('[data-side="rightbar"]').first()
      const box = await handle.boundingBox()
      if (box === null) {
        check.ok('拿到把手几何（能拖）', false, 'boundingBox 为空')
      } else {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        await page.mouse.down()
        await page.mouse.move(box.x + box.width / 2 - 120, box.y + box.height / 2, { steps: 8 })
        await page.mouse.up()
        await page.waitForTimeout(800)
        const dragged = await page.evaluate(() => {
          const el = document.querySelector('[data-sidebar-right-panel]')
          return el === null ? null : Math.round(el.getBoundingClientRect().width)
        })
        check.ok('拖动把手真的改了面板宽（官方拖拽语义活的）', dragged !== null && panel !== null && dragged > panel.width, `before=${String(panel?.width)} after=${String(dragged)}`)
        check.fact(`拖动 120px 后面板宽=${String(dragged)}`)
      }
      shots.push(await shot(deps, 'proto-chat-rightbar-drag', page))
      assertNoContractGap(check, 'chat 右栏展开态', { ...opened, measures: after })
      await opened.context.close()
      return shots
    },
  },
  {
    id: 'P-03',
    phase: 'new-feature',
    name: 'chat 原型（纯 CSS 档）：侧栏列能去掉，但右栏轨跟着变常量',
    expect:
      'shape=css0 用一条 `!important` 的 `grid-template-columns:0px minmax(0,1fr) 0px` 覆盖官方内联轨：侧栏列宽 0 成立；但右栏打开时**中列不让轨**——面板浮在中列上方（官方语义里的「让轨」没了）。这条代价就是「只用 CSS、不改内联属性」交的学费。',
    async run(deps, check) {
      const css0 = await chatScenario(deps, check, 'css0', 1200, 'proto-chat-css0-1200')
      const shots = [...css0.shots]
      const route = routeOf(deps.proto.routes, 'proto-chat')
      const opened = await openPage(deps.browser, deps.proto.origin, route, { width: 1280, shape: 'css0', sessionId: deps.sessionId })
      const page = opened.page
      const before = opened.measures
      const expand = page.locator('[data-sidebar-right-expand]').first()
      if ((await expand.count()) === 0) {
        check.ok('chat 树里官方展开钮在（右栏可开）', false)
      } else {
        await expand.click({ timeout: 10_000 })
        await page.waitForTimeout(1_200)
        const after = (await page.evaluate(MEASURE_JS)) as Measurements
        const panel = await page.evaluate(() => {
          const el = document.querySelector('[data-sidebar-right-panel]')
          if (el === null) return null
          const r = el.getBoundingClientRect()
          return { x: Math.round(r.x), width: Math.round(r.width), open: el.hasAttribute('data-sidebar-right-open') }
        })
        check.fact(`css0 展开右栏后：面板=${JSON.stringify(panel)}；center=${String(after.centerCol?.width)} rightbar 轨=${String(after.rightbarCol?.width)}`)
        check.ok('css0：侧栏列宽仍为 0', after.sidebarCol?.width === 0, JSON.stringify(after.sidebarCol))
        check.ok(
          'css0：右栏面板照常打开（但轨道 = 0，中列不让）',
          panel !== null && panel.open === true && after.rightbarCol?.width === 0 && after.centerCol?.width === before.centerCol?.width,
          `panel=${JSON.stringify(panel)} centerBefore=${String(before.centerCol?.width)} centerAfter=${String(after.centerCol?.width)} track=${String(after.rightbarCol?.width)}`,
        )
        shots.push(await shot(deps, 'proto-chat-css0-rightbar-open', page))
      }
      assertNoContractGap(check, 'chat css0', opened)
      await opened.context.close()
      return shots
    },
  },
  {
    id: 'P-04',
    phase: 'new-feature',
    name: 'chat 原型（官方原样档）：三条轨都在，侧栏列关不掉',
    expect:
      'shape=raw 不做任何形态适配：官方 AppFrame 在 1200 宽下画「侧栏 280 列 + 中列 + 右列」；视口 < 1024 时侧栏自动降级成 56px 图标列（`computeColumns` 的收起轨），中列被压掉 56–420px。这就是「直接上官方 AppFrame、不做适配」在 VS Code 容器里的样子。',
    async run(deps, check) {
      const wide = await chatScenario(deps, check, 'raw', 1200, 'proto-chat-raw-1200')
      check.ok('raw@1200：侧栏列 = 官方默认 280', wide.measures.sidebarCol?.width === 280, JSON.stringify(wide.measures.sidebarCol))
      check.ok(
        'raw@1200：中列 = frame 宽 - 280（对话区被侧栏吃掉一块）',
        wide.measures.frame !== null && wide.measures.centerCol !== null && wide.measures.centerCol.width === wide.measures.frame.width - 280,
        `frame=${String(wide.measures.frame?.width)} center=${String(wide.measures.centerCol?.width)}`,
      )
      check.ok('raw@1200：官方侧栏拖拽把手在（官方白送）', wide.measures.handles.includes('sidebar'), JSON.stringify(wide.measures.handles))
      const narrow = await chatScenario(deps, check, 'raw', 500, 'proto-chat-raw-500')
      check.fact(`raw@500：侧栏列=${JSON.stringify(narrow.measures.sidebarCol)} center=${String(narrow.measures.centerCol?.width)}`)
      check.ok('raw@500：窄容器自动降级成 56px 图标列（官方 SIDEBAR_AUTO_COLLAPSE）', narrow.measures.sidebarCol?.width === 56, JSON.stringify(narrow.measures.sidebarCol))
      return [...wide.shots, ...narrow.shots]
    },
  },
  {
    id: 'P-05',
    phase: 'new-feature',
    name: 'sidebar 原型（单列铺满）：官方侧栏填满 VS Code 侧栏视图宽度',
    expect:
      'shape=fill 在 400px 宽（VS Code 侧栏视图的典型宽度）与 1200px 下：侧栏列宽 = frame 宽、侧栏根内联 width 被覆盖成 100%、自有工作区树照常渲染、右栏与中列归零；窄容器（<1024px）下官方本来会把侧栏降级成 56px 图标列，原型用官方 API `ctx.layout.toggleSidebar()` 打开展开态，宽内容因此仍在。',
    async run(deps, check) {
      const route = routeOf(deps.proto.routes, 'proto-sidebar')
      const shots: string[] = []
      for (const width of [400, 1200]) {
        const opened = await openPage(deps.browser, deps.proto.origin, route, { width, shape: 'fill' })
        const m = opened.measures
        check.fact(`fill@${String(width)}：frame=${JSON.stringify(m.frame)} sidebar=${String(m.sidebarCol?.width)} 侧栏根=${JSON.stringify(m.sidebarRoot)} center=${String(m.centerCol?.width)}`)
        check.ok(`fill@${String(width)}：侧栏列铺满 frame 宽`, m.frame !== null && m.sidebarCol?.width === m.frame.width, `frame=${String(m.frame?.width)} sidebar=${String(m.sidebarCol?.width)}`)
        check.ok(
          `fill@${String(width)}：侧栏根宽 = 侧栏列宽（官方内联 width 被 !important 覆盖）`,
          m.sidebarCol !== null && m.sidebarRoot !== null && m.sidebarRoot.width === m.sidebarCol.width,
          `col=${String(m.sidebarCol?.width)} root=${JSON.stringify(m.sidebarRoot)}`,
        )
        check.fact(`fill@${String(width)}：侧栏根类名=${JSON.stringify(m.sidebarRoot?.classList ?? '')} 内联 width=${JSON.stringify(m.sidebarRoot?.inlineWidth ?? '')}`)
        check.ok(`fill@${String(width)}：自有工作区树（dsh-workspace-tree）在渲染`, m.content.ownWorkspaceTree !== null, JSON.stringify(m.content.ownWorkspaceTree))
        check.ok(`fill@${String(width)}：中列与右栏列归零`, m.centerCol?.width === 0 && m.rightbarCol?.width === 0, `center=${String(m.centerCol?.width)} rightbar=${String(m.rightbarCol?.width)}`)
        check.ok(
          `fill@${String(width)}：窄容器下用官方 layout API 打开展开态`,
          width >= 1024 ? m.shape?.calledToggleSidebar === false : m.shape?.calledToggleSidebar === true,
          JSON.stringify(m.shape),
        )
        assertNoContractGap(check, `sidebar fill@${String(width)}`, opened)
        shots.push(await shot(deps, `proto-sidebar-fill-${String(width)}`, opened.page))
        await opened.context.close()
      }
      return shots
    },
  },
  {
    id: 'P-06',
    phase: 'new-feature',
    name: 'sidebar 原型（官方原样档）：窄容器里官方侧栏自己降级成 56px 图标列',
    expect:
      'shape=raw 在 400px 宽下不做适配：官方 AppFrame 判视口 < 1024px → 侧栏自动收起成 56px 图标列（品牌名/新会话文案等「宽内容」卸载，`sidebar.workspaces` 座位照渲染但只拿到 `wide:false`，自有工作区树因此被压成一条 < 56px 的碎条）。「铺满」这件事在不碰官方 store 的情况下办不到。1200px 下则是官方 264–420 钳位内的 280px 列，不铺满（VS Code 侧栏视图用不到这个宽度档，仅作对照）。',
    async run(deps, check) {
      const route = routeOf(deps.proto.routes, 'proto-sidebar')
      const shots: string[] = []
      const narrow = await openPage(deps.browser, deps.proto.origin, route, { width: 400, shape: 'raw' })
      check.fact(`raw@400：sidebar=${JSON.stringify(narrow.measures.sidebarCol)} 侧栏根=${JSON.stringify(narrow.measures.sidebarRoot)} 自有树=${JSON.stringify(narrow.measures.content.ownWorkspaceTree)}`)
      check.ok('raw@400：侧栏轨 = 官方窄容器降级值 56px', narrow.measures.sidebarCol?.width === 56, JSON.stringify(narrow.measures.sidebarCol))
      check.ok(
        'raw@400：自有工作区树仍在 DOM 里但被压缩到 56px 图标列内（官方给座位下发 wide:false，插件不认）',
        narrow.measures.content.ownWorkspaceTree !== null && narrow.measures.content.ownWorkspaceTree.width < 60,
        JSON.stringify(narrow.measures.content.ownWorkspaceTree),
      )
      check.ok('raw@400：侧栏根没有内联 width（官方收起态 = wide:false，不发 width）', narrow.measures.sidebarRoot === null || narrow.measures.sidebarRoot.inlineWidth === '', JSON.stringify(narrow.measures.sidebarRoot))
      shots.push(await shot(deps, 'proto-sidebar-raw-400', narrow.page))
      await narrow.context.close()
      const wide = await openPage(deps.browser, deps.proto.origin, route, { width: 1200, shape: 'raw' })
      check.fact(`raw@1200：sidebar=${JSON.stringify(wide.measures.sidebarCol)} 侧栏根=${JSON.stringify(wide.measures.sidebarRoot)}`)
      check.ok('raw@1200：侧栏轨 = 官方钳位内的 280px（不铺满 1200）', wide.measures.sidebarCol?.width === 280, JSON.stringify(wide.measures.sidebarCol))
      shots.push(await shot(deps, 'proto-sidebar-raw-1200', wide.page))
      await wide.context.close()
      return shots
    },
  },
  {
    id: 'P-07',
    phase: 'new-feature',
    name: 'settings 原型：设置页当官方 keyed `main` 全局面板',
    expect:
      'shape=page：形态插件往官方 `main` 槽注册一条 key=`dshOne.settings` 的 keyed 条目并用官方服务 `ctx.layout.selectPanel(key)` 选中它——设置页整页渲染在官方中列里（分节导航 + 设置项在），侧栏列宽 0，右栏自动下线（官方 RightbarRoot 在 activePanelId !== null 时返回 null），零崩溃。',
    async run(deps, check) {
      const route = routeOf(deps.proto.routes, 'proto-settings')
      const opened = await openPage(deps.browser, deps.proto.origin, route, { width: 1200, shape: 'page' })
      const m = opened.measures
      check.fact(`page@1200：frame=${JSON.stringify(m.frame)} sidebar=${String(m.sidebarCol?.width)} center=${String(m.centerCol?.width)} 设置页=${JSON.stringify(m.content.settingsPage)} shape=${JSON.stringify(m.shape)}`)
      check.ok('官方 AppFrame 上台', m.track !== '', `track=${JSON.stringify(m.track)}`)
      check.ok('侧栏列宽 0', m.sidebarCol?.width === 0, JSON.stringify(m.sidebarCol))
      check.ok('中列铺满 frame 宽', m.frame !== null && m.centerCol?.width === m.frame.width, `frame=${String(m.frame?.width)} center=${String(m.centerCol?.width)}`)
      check.ok('设置页渲染在中列里（几何落在中列范围内）', m.content.settingsPage !== null && m.centerCol !== null && m.content.settingsPage.x >= m.centerCol.x && m.content.settingsPage.x + m.content.settingsPage.width <= m.centerCol.x + m.centerCol.width + 1, `page=${JSON.stringify(m.content.settingsPage)} center=${JSON.stringify(m.centerCol)}`)
      check.ok('设置分节槽位有内容（settings.section）', m.slotKeys.includes('settings.section') && (await opened.page.locator('[data-slot="settings.section"] > *').count()) > 0)
      check.ok('右栏未渲染（全局面板下官方 RightbarRoot 返回 null）', (await opened.page.locator('[data-sidebar-right-panel]').count()) === 0)
      assertNoContractGap(check, 'settings page@1200', opened)
      const shots = [await shot(deps, 'proto-settings-page-1200', opened.page)]
      await opened.context.close()
      return shots
    },
  },
  {
    id: 'P-08',
    phase: 'new-feature',
    name: 'settings 原型（官方原样档）：不做适配时侧栏列占 280px',
    expect:
      'shape=raw：设置页仍以 keyed main 渲染（官方机制本身不需要形态适配），但官方侧栏列占 280px，设置页只能在剩下的宽度里居中——VS Code 的设置页会白丢一条侧栏宽度。',
    async run(deps, check) {
      const route = routeOf(deps.proto.routes, 'proto-settings')
      const opened = await openPage(deps.browser, deps.proto.origin, route, { width: 1200, shape: 'raw' })
      const m = opened.measures
      check.fact(`raw@1200：sidebar=${String(m.sidebarCol?.width)} center=${String(m.centerCol?.width)} 设置页=${JSON.stringify(m.content.settingsPage)}`)
      check.ok('raw：官方侧栏列占 280px（设置页让出一条列）', m.sidebarCol?.width === 280, JSON.stringify(m.sidebarCol))
      check.ok('raw：设置页仍渲染在中列里（keyed main 机制与形态无关）', m.content.settingsPage !== null, JSON.stringify(m.content.settingsPage))
      const shots = [await shot(deps, 'proto-settings-raw-1200', opened.page)]
      await opened.context.close()
      return shots
    },
  },
  {
    id: 'P-09',
    phase: 'regression',
    name: '现状对照：生产三棵树同尺寸渲染（自有 frame 渲染 root）',
    expect:
      '在同一台机器、同一个网关、同一批尺寸下，生产三棵树（自有 frame 插件渲染 root）的形态：chat = 中列 + 自有右列（本分支为 #77 之前的 details 实现）、sidebar@400 = 侧栏列铺满容器、settings = 整页设置。用来与原型原型逐张对照「形态差多少、多花的适配有多少」。',
    async run(deps, check) {
      const shots: string[] = []
      const open = async (routeName: string, width: number, sessionId?: string): Promise<Opened> => {
        const route = deps.prod.trees.find((candidate) => candidate.route === routeName)
        if (route === undefined) throw new Error(`no production route ${routeName}`)
        return openPage(deps.browser, deps.prod.origin, route as unknown as ProtoTreeRoute, {
          width,
          ...(sessionId === undefined ? {} : { sessionId }),
        })
      }
      const chat = await open('chat', 1200, deps.sessionId)
      check.fact(`现状 chat@1200：自有 frame=${JSON.stringify(chat.measures.ownFrameRoot)} 对话区=${JSON.stringify(chat.measures.content.composer)} 官方 frame 轨=${JSON.stringify(chat.measures.track)}`)
      check.ok('现状 chat：root 由自有 frame 渲染（官方内联轨不存在）', chat.measures.track === '' && chat.measures.ownFrameRoot !== null, `track=${JSON.stringify(chat.measures.track)} own=${JSON.stringify(chat.measures.ownFrameRoot)}`)
      check.ok('现状 chat：对话区在', chat.measures.content.composer !== null, JSON.stringify(chat.measures.content.composer))
      assertNoContractGap(check, '现状 chat@1200', chat)
      shots.push(await shot(deps, 'current-chat-1200', chat.page))
      await chat.context.close()

      const sidebar = await open('sidebar', 400)
      check.fact(`现状 sidebar@400：自有 frame=${JSON.stringify(sidebar.measures.ownFrameRoot)} 自有树=${JSON.stringify(sidebar.measures.content.ownWorkspaceTree)}`)
      check.ok('现状 sidebar@400：自有工作区树铺满视图', sidebar.measures.content.ownWorkspaceTree !== null, JSON.stringify(sidebar.measures.content.ownWorkspaceTree))
      assertNoContractGap(check, '现状 sidebar@400', sidebar)
      shots.push(await shot(deps, 'current-sidebar-400', sidebar.page))
      await sidebar.context.close()

      const settings = await open('settings', 1200)
      check.fact(`现状 settings@1200：自有 frame=${JSON.stringify(settings.measures.ownFrameRoot)} 设置页=${JSON.stringify(settings.measures.content.settingsPage)}`)
      check.ok('现状 settings@1200：设置页整页在', settings.measures.content.settingsPage !== null, JSON.stringify(settings.measures.content.settingsPage))
      assertNoContractGap(check, '现状 settings@1200', settings)
      shots.push(await shot(deps, 'current-settings-1200', settings.page))
      await settings.context.close()
      return shots
    },
  },
  {
    id: 'P-11',
    phase: 'new-feature',
    name: 'A/B 实验：同一棵 chat 树，只差「谁渲染 root」——收尾主题差一档',
    expect:
      '控制组（自有 frame + 同一份 block list + 同一批追加插件）与原型（官方 AppFrame）在同一宽度、同一页面预设（`__DSH_ONE_HOST_THEME__=dark`）下开同一棵树：主题服务里两边都是 `vscode-dark`，但**收尾主题不同**——控制组深色、原型浅色（原型页面的官方 presenter 最后一次 apply 落在浅色上，与 theme-follow 的修正存在时序竞争）。这是「官方 AppFrame 在场」这一个变量带来的可见差异，也是原型的已知缺陷。',
    async run(deps, check) {
      const control = routeOf(deps.proto.routes, 'proto-chat-control')
      const protoRoute = routeOf(deps.proto.routes, 'proto-chat')
      const controlPage = await openPage(deps.browser, deps.proto.origin, control, { width: 1200, shape: 'raw', sessionId: deps.sessionId })
      const protoPage = await openPage(deps.browser, deps.proto.origin, protoRoute, { width: 1200, shape: 'raw', sessionId: deps.sessionId })
      check.fact(`控制组（自有 frame）：主题=${JSON.stringify(controlPage.measures.theme)} 对话区=${JSON.stringify(controlPage.measures.content.composer)}`)
      // 形态探针插件（@dsh-one/proto-theme-probe）把每次 theme/change 打进 console：
      // 两边的**事件序列**在这里逐条比对——收尾 DOM 不同而事件序列相同，说明差异
      // 出在「谁最后 apply 到 DOM」而不是主题服务本身。
      const probeLines = (page: Opened): string[] => page.capture.all.filter((line) => line.includes('[probe]')).map((line) => line.replace(/^log: /, ''))
      check.fact(`控制组 theme/change 序列：${JSON.stringify(probeLines(controlPage))}`)
      check.fact(`原型 theme/change 序列：${JSON.stringify(probeLines(protoPage))}`)
      check.fact(`原型（官方 frame）：主题=${JSON.stringify(protoPage.measures.theme)} 对话区=${JSON.stringify(protoPage.measures.content.composer)}`)
      check.ok('控制组：自有 frame 渲染 root（官方 frame 不在）', controlPage.measures.track === '' && controlPage.measures.ownFrameRoot !== null, `track=${JSON.stringify(controlPage.measures.track)}`)
      check.ok('控制组：对话区照常渲染', controlPage.measures.content.composer !== null)
      check.ok('控制组收尾主题是深色（与生产树一致）', controlPage.measures.theme.darkAttr === true && controlPage.measures.theme.colorScheme === 'dark', JSON.stringify(controlPage.measures.theme))
      check.fact(`两边页面预设相同（hostTheme）：控制组=${controlPage.measures.theme.hostTheme} 原型=${protoPage.measures.theme.hostTheme}`)
      check.ok(
        '原型收尾主题也是深色（若是浅色，说明官方 presenter 与 theme-follow 的时序竞争真实存在）',
        protoPage.measures.theme.darkAttr === true,
        JSON.stringify(protoPage.measures.theme),
      )
      const shots = [await shot(deps, 'proto-chat-control-1200', controlPage.page), await shot(deps, 'proto-chat-raw-theme-1200', protoPage.page)]
      await controlPage.context.close()
      await protoPage.context.close()
      return shots
    },
  },
  {
    id: 'P-10',
    phase: 'new-feature',
    name: '官方 GUI 原样对照（同一网关、同一个浏览器）',
    expect:
      '网关自己的 /official 页面（官方 web，无任何我们的形态适配）在 1200 与 400 宽下的样子：作为「官方形态」的基准照片，与原型三树对照时不用想象官方长什么样。',
    async run(deps, check) {
      const shots: string[] = []
      for (const width of [1200, 400]) {
        const context = await deps.browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2 })
        const page = await context.newPage()
        await page.goto(`${deps.proto.origin}/official`, { waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(4_000)
        const frame = await page.evaluate(() => {
          const el = document.querySelector<HTMLElement>('div:has(> [data-shell-overlay])')
          if (el === null) return null
          const r = el.getBoundingClientRect()
          const cols = Array.from(el.children).map((child) => {
            const cr = child.getBoundingClientRect()
            return { cls: child.className, width: Math.round(cr.width) }
          })
          return { width: Math.round(r.width), track: el.style.gridTemplateColumns, cols }
        })
        check.fact(`official@${String(width)}：frame=${JSON.stringify(frame)}`)
        check.ok(`official@${String(width)}：官方 web 也是同一个 AppFrame 结构`, frame !== null && frame.track !== '', JSON.stringify(frame))
        shots.push(await shot(deps, `official-gui-${String(width)}`, page))
        await context.close()
      }
      return shots
    },
  },
]

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

function gitInfo(): { branch: string; commit: string } {
  const read = (args: string[]): string => {
    try {
      return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
    } catch {
      return ''
    }
  }
  return { branch: read(['rev-parse', '--abbrev-ref', 'HEAD']), commit: read(['rev-parse', 'HEAD']) }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))
  const log = consoleLogger(false)
  const shots = path.join(args.out, 'shots')
  await fsp.mkdir(shots, { recursive: true })

  const prodPluginsDir = defaultPluginsDir()
  const prodPlugins = await fsp.readdir(prodPluginsDir).catch(() => null)
  if (prodPlugins === null || prodPlugins.length === 0) {
    process.stderr.write(`先跑 npm run build（自有插件 bundle 缺：${prodPluginsDir}）\n`)
    return 2
  }
  // 原型插件与生产自有插件放同一个目录（mirror 只有一个 pluginsDir，见 build.ts 说明）。
  const pluginsDir = await buildProtoPlugins(prodPluginsDir)
  log.info(`proto plugins built -> ${pluginsDir}`)

  const proto = await startProtoServer({
    gateway: args.gateway,
    ...(args.token === undefined ? {} : { token: args.token }),
    log,
    pluginsDir,
    port: args.port,
  })
  const prod = await startLabServer({
    gateway: args.gateway,
    ...(args.token === undefined ? {} : { token: args.token }),
    log,
    pluginsDir: prodPluginsDir,
    port: args.comparePort,
  })
  const browser = await launchBrowser(true)

  let sessionsBefore: number | undefined
  try {
    sessionsBefore = (await listSessions(args.gateway)).length
  } catch (err) {
    log.warn(`跑前会话数取不到：${err instanceof Error ? err.message : String(err)}`)
  }
  const sessions = await listSessions(args.gateway)
  // 取一个非空白会话（与 #77 的右栏断言同一取法）：空白会话没有会话头，「展开右栏」
  // 那个官方按钮不会渲染。
  const sessionId = (sessions.find((session) => !session.blank) ?? sessions[0])?.sessionId ?? ''
  log.info(`chat 原型用启动会话 ${sessionId === '' ? '（网关没有会话，chat 页将为空）' : sessionId}`)

  const selected = args.only === undefined ? SCENARIOS : SCENARIOS.filter((scenario) => args.only?.includes(scenario.id) === true)
  const deps: Deps = { browser, proto, prod: { origin: prod.origin, trees: LAB_TREES }, shots, sessionId }
  const items: unknown[] = []
  let failed = 0
  try {
    for (const scenario of selected) {
      const check = new Check()
      const started = Date.now()
      let screenshots: string[] = []
      let crash: string | undefined
      try {
        screenshots = await scenario.run(deps, check)
      } catch (err) {
        crash = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
        check.ok(`${scenario.id} 执行到底`, false, crash.slice(0, 600))
      }
      const passed = check.failed.length === 0
      if (!passed) failed += 1
      const seconds = ((Date.now() - started) / 1000).toFixed(1)
      process.stdout.write(`${passed ? 'PASS' : 'FAIL'} ${scenario.id} ${scenario.name} — 断言 ${String(check.passed)}/${String(check.total)}（${seconds}s）\n`)
      for (const assertion of check.failed) {
        process.stdout.write(`      ✗ ${assertion.label}${assertion.detail === '' ? '' : `（${assertion.detail}）`}\n`)
      }
      items.push({
        id: scenario.id,
        phase: scenario.phase,
        name: scenario.name,
        expect: scenario.expect,
        result: passed ? 'pass' : 'fail',
        screenshots,
        notes: check.notes() + (crash === undefined ? '' : `\n套件异常：\n${crash}`),
      })
    }

    // 只读守卫（与实验室 R-06 同口径）。
    const readonly = new Check()
    let sessionsAfter: number | undefined
    try {
      sessionsAfter = (await listSessions(args.gateway)).length
    } catch (err) {
      readonly.ok('跑后仍能读到网关会话清单', false, err instanceof Error ? err.message : String(err))
    }
    readonly.fact(`网关会话数：跑前 ${String(sessionsBefore)}，跑后 ${String(sessionsAfter)}`)
    readonly.eq('整轮跑测没有创建/删除任何会话（网关只读）', sessionsAfter, sessionsBefore)
    const readonlyPassed = readonly.failed.length === 0
    if (!readonlyPassed) failed += 1
    process.stdout.write(`${readonlyPassed ? 'PASS' : 'FAIL'} P-99 原型跑测对真实网关只读 — 断言 ${String(readonly.passed)}/${String(readonly.total)}\n`)
    items.push({
      id: 'P-99',
      phase: 'regression',
      name: '原型跑测对真实网关只读（跑前跑后会话数不变）',
      expect: '整轮原型跑测只渲染与做本地交互，不创建会话、不发 prompt、不归档（唯一写类动作是 token 换票，与扩展自身连接路径相同）。',
      result: readonlyPassed ? 'pass' : 'fail',
      screenshots: [],
      notes: readonly.notes(),
    })
  } finally {
    await browser.close()
    if (!args.keep) {
      proto.dispose()
      prod.dispose()
    }
  }

  const { branch, commit } = gitInfo()
  const ledgerPath = path.join(args.out, 'official-frame.ledger.json')
  await fsp.writeFile(
    ledgerPath,
    `${JSON.stringify(
      {
        title: '官方 AppFrame 原型跑测（#89）：官方渲染 root + 只做 VS Code 形态适配',
        branch,
        commit,
        environment: {
          mode: '浏览器验证（真实仓库模块 + 真实 dsh 网关只读 + 假宿主）',
          dsh: proto.dshVersion ?? '（未知）',
          gateway: args.gateway,
          'proto lab': proto.origin,
          'production lab': prod.origin,
          driver: `playwright chromium + prototypes/officialFrame/run.ts（${String(items.length)} 项）`,
          date: new Date().toISOString(),
        },
        coverageNote:
          '本报告是浏览器验证（第一道验证）：页面由仓库真实模块（pageHtml / wireFilter / assemblyMirror）构建，数据面是本机真实 dsh 网关（只读），宿主是假宿主。未覆盖：真 VS Code webview 宿主层（CSP 差异、剪贴板、原生菜单、多 webview 生命周期）、macOS 之外的平台、真模型输出。原型插件与形态适配都不进生产代码路径。',
        items,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  process.stdout.write(`ledger: ${ledgerPath}\n`)
  const reportPath = path.join(args.out, 'official-frame.report.html')
  const rendered = spawnSync(process.execPath, [path.join(REPO_ROOT, 'test', 'sandbox', 'report.mjs'), '--ledger', ledgerPath, '--out', reportPath], {
    stdio: 'inherit',
  })
  if (rendered.status !== 0) process.stderr.write('报告渲染失败（ledger 仍可用）\n')
  return failed === 0 ? 0 : 1
}

main().then(
  (code) => {
    // 显式退出：页面与网关之间的 WS/keep-alive 连接挂在 loopback 代理上，事件循环不会
    // 自己空掉（实验室 verify.ts 的页面少、运气好；原型页面起满后必须显式收）。
    process.exit(code)
  },
  (err: unknown) => {
    process.stderr.write(`原型跑测未预期失败：${err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)}\n`)
    process.exit(2)
  },
)
