/**
 * 会话行状态点逐案审计（#146）：空闲 / 跑完还没打开 / 手动未读 / 运行中 / 等待交互。
 *
 * 为什么单独一个套件、而且为什么它主要在**对照**而不是在断言一个值：用户报的
 * 「绿点还不对」上一轮（#140）只修通了等待态的数据源，状态点本身的「在不在 / 是什么
 * state / 什么颜色 / 多大」**一条断言都没有**，所以它能连漏两轮。本套件把五情形逐条钉住，
 * 并且每一情形都与**同一台机器上另开的官方浏览区页**（`/sidebar-official`，同一 frame 不装
 * 自有树插件、由官方 ui-workspace 渲染）并排对照：同一会话、同一种态，四项（在不在 /
 * `data-state` / 解析色 / 尺寸）逐项相等。对照能成立的前提是**期望值都是运行期读的**——
 * 颜色拿同一枚官方 token 挂探针元素比（不写死色值），尺寸与官方页同态读数直接比、槽位
 * 尺寸从 `workspaceTree/styles.ts` 的档位表读（`SCALE_TIERS.standard.slotWidth/slotHeight`）。
 *
 * ## 逐案结论（本套件就是这些结论的可执行版本）
 *
 * | 情形 | 自有树 | 官方页 | 判定 |
 * | --- | --- | --- | --- |
 * | 空闲 | 不渲染点（空槽 16×20） | 不渲染点（空槽同几何） | 一致（官方 `showsStatusDot`） |
 * | 跑完还没打开 | `done` 绿点 | `done` 绿点 | 一致——同一份官方 client 状态（完成提醒）+ 同一个官方 `StateDot` |
 * | 运行中 | `ongoing` 8 格矩阵 | 同 | 一致 |
 * | 等待交互 | `warning` 黄点 | 同 | 一致 |
 * | 手动未读 | `done` 绿点 + 标题加粗 | （官方没有这个功能） | **我们自定**：形态与**旧侧栏正本**一致（见下） |
 * | 跑完时**正开在宿主面板里**（#147） | 不渲染点（宿主报的集合把它压住） | `done` 绿点 | **有意不同**：官方 web 只有一页、`selected` 就是屏幕上那一条；我们有两个 webview，侧栏页的 `selected` 与宿主开着的面板可以是两回事，所以宿主的这份事实要并进渲染判据（见下） |
 *
 * #147 那一行怎么做出来的（本套件的 ⑧ 段）：夹具 = 假宿主报「面板里开着这条会话」
 * （`reportPanelSessions`：记表 + 广播 `dshOne.panelSessions`，与真宿主同一份事实），
 * 会话**不是**侧栏页的当前会话，再驱动官方那条 run→idle 边；断言 = 我们自己这一页不
 * 亮点、同屏对照的官方页照旧亮（差异正是补的那条）。另外钉住边界：宿主改口「没开」
 * 之后绿点会回来（官方提醒从头到尾都在，压住它的就是宿主这份事实）。
 *
 * 手动未读为什么是「绿点 + 加粗」而不是「只有加粗」：旧侧栏的**渲染体**是
 * `src/ui/sessionsWebview.ts`（`sessionsView.ts` 是宿主侧那一半：HTML/CSS + 消息处理，
 * 它的 `.session-title.unread{font-weight:600}` 正是给 webview 用的类名）。那一版的
 * `sessionStatusMarker`（`sessionsWebview.ts:2391-2406`）对未读返回的是
 * `el('span','session-dot completed')`、CSS 在 `sessionsView.ts:462-471`（绿点 + 加粗），
 * 行渲染处 `sessionsWebview.ts:2438` 同时挂 `session-title unread`。仓库自己那份
 * `docs/legacy-vs-current-sidebar-compare.md`（#128 的产出）第 115 行也把它记成
 * 「未读：绿点 + 标题加粗 …… 一致」。所以「旧侧栏未读只有加粗、没有点」这个说法只读了
 * `sessionsView.ts` 里那一行 CSS——那一版根本没有渲染未读标记（它连状态点都不渲染）。
 * 结论：绿点保留（正本依据），未读与已完成的区分点是**标题字重**（600 / 400）与读屏文案
 * （未读 / 已完成）——两者都由本套件钉住，防止哪天被「顺手统一」掉。
 *
 * ## 夹具
 *
 * 五情形里只有「手动未读」能靠假宿主的状态存储直接造出来（`state: {unread: …}`，与 F-14
 * 同一套）。其余四态都靠**官方那条链路**造：往页面的官方转发事件流（`$events`）投官方帧
 * （`api-session/status` 造运行中与「跑完还没打开」、`approval/request` 瀑布帧造等待交互），
 * 夹具本体在 `pendingDotSuites.ts` 里（F-43 写的，这里复用同一份，避免两处漂）。这样
 * 「同一会话同一种态」在两侧是**真的同一件事**，并排对照才有意义。
 *
 * 全程只读网关：注入的 `eventId` 网关不知道，页面永远不会把结果回给网关（取消帧一到，
 * 官方那条瀑布直接在 abort 分支返回）。搜索那一步打的是官方只读搜索路径。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import type { BrowserContext, Page } from 'playwright'
import { openTreePage, type Check, texts, isText } from './harness.ts'
import { LAB_TREES, type LabTreeRoute } from './labServer.ts'
import { SCALE_TIERS } from '../../src/ui/assembly/shell/workspaceTree/styles.ts'
import { emit, installEventStreamInjector, waitForEventStream, type EventStreamInjector } from './harness.ts'
import { expandAllWorkspaces, expandOfficialWorkspaces, waterfall } from './pendingDotSuites.ts'
// 只取类型（编译后不留 import，运行期没有环）：套件接口定义在 suites.ts 里。
import type { LabSuite } from './suites.ts'

const route = (name: string): LabTreeRoute => {
  const found = LAB_TREES.find((candidate) => candidate.route === name)
  if (found === undefined) throw new Error(`lab: unknown tree route ${name}`)
  return found
}

/** 自有树的行 / 标题 / 搜索区标记（与 F-07 / F-14 / F-36 用的是同一组）。 */
const SESSION_ROW = '[data-dshone-tree-row="session"]'
const SEARCH_ROW = '[data-dshone-tree-row="search"]'
const SEARCH_BUTTON = '[data-dshone-tree-action="search"]'
const SEARCH_INPUT = '[data-dshone-tree="search-input"]'
/** 官方浏览区的行（官方不写 data 属性，只能按类名后缀认，与 F-04 / F-36 / F-43 同）。 */
const OFFICIAL_ROW = '[class*="_sessionRow"]'
const OFFICIAL_TITLE = '[class*="_title"]'

/** 三档状态的官方 token（颜色一律挂探针比，不写死色值）。 */
const WARN_TOKEN = '--dsw-alias-state-warn-primary'
const ONGOING_TOKEN = '--dsw-static-deepseek-450'
const SUCCESS_TOKEN = '--dsw-alias-state-success-primary'

/** 槽位尺寸的期望值（档位表只给 px 字符串，比之前转成数字）。 */
const SLOT_SIZE = [Number.parseFloat(SCALE_TIERS.standard.slotWidth), Number.parseFloat(SCALE_TIERS.standard.slotHeight)]

interface Box {
  width: number
  height: number
}

interface DotFacts {
  /** 官方 `StateDot` 的 `data-state`（ongoing / warning / done）。 */
  state: string | null
  /** 点的形态（官方件：ongoing 是 8 格矩阵 svg，其余是圆点 span）。 */
  tag: string
  cells: number
  viewBox: string | null
  /** 解析出来的 `color`（官方 CSS 就是 `color:var(--dsw-alias-state-*)`）。 */
  color: string
  /** 点自己的盒子（四项里的「尺寸」）。 */
  box: Box
  /** 点旁边那些视觉隐藏的读屏文案（官方 `visuallyHidden`）。 */
  labels: string[]
}

interface RowFacts {
  id: string
  title: string
  /** 行的活状态（自有标记：waiting / running / idle）。 */
  status: string
  current: boolean
  /** 标题字重（未读 = 600、其余 400；「未读 vs 已完成」的区分点之一）。 */
  titleWeight: string
  /** 状态槽（空槽也在；空闲档「不渲染点」看的是它里面没有点）。 */
  slot: Box | null
  dot: DotFacts | null
}

/**
 * 读一页上所有会话行的事实：行自己的标记 + 状态槽 + 点（`data-state` / 形态 / 颜色 /
 * 尺寸 / 读屏文案）。`titleSel` 用来读标题字重——两侧的标题类名不同（自有
 * `.dshOneTree_title` / 官方哈希类名），所以由调用方给。
 */
async function readRows(page: Page, rowSel: string, titleSel: string, dotHostSel: string): Promise<RowFacts[]> {
  return (await page.evaluate(
    ({ rowSel, titleSel, dotHostSel }) => {
      const round = (value: number): number => Math.round(value * 100) / 100
      const box = (element: Element | null): Box | null => {
        const rect = element?.getBoundingClientRect() ?? null
        return rect === null ? null : { width: round(rect.width), height: round(rect.height) }
      }
      return Array.from(document.querySelectorAll(rowSel)).map((row) => {
        const dot = row.querySelector('[data-state]')
        const style = dot === null ? null : getComputedStyle(dot)
        const title = row.querySelector(titleSel) as HTMLElement | null
        return {
          id: row.getAttribute('data-dshone-tree-session') ?? '',
          title: (title?.textContent ?? '').trim(),
          status: row.getAttribute('data-dshone-tree-status') ?? '',
          current: row.getAttribute('aria-selected') === 'true',
          titleWeight: title === null ? '' : getComputedStyle(title).fontWeight,
          slot: box(row.querySelector(dotHostSel)),
          dot:
            dot === null || style === null
              ? null
              : {
                  state: dot.getAttribute('data-state'),
                  tag: dot.tagName.toLowerCase(),
                  cells: dot.querySelectorAll('rect').length,
                  viewBox: dot.getAttribute('viewBox'),
                  color: style.color,
                  box: box(dot),
                  labels: Array.from(row.querySelectorAll('[class*="visuallyHidden"], [class*="VisuallyHidden"]')).map(
                    (element) => (element.textContent ?? '').trim(),
                  ),
                },
        }
      })
    },
    { rowSel, titleSel, dotHostSel },
  )) as RowFacts[]
}

const readOwnRows = (page: Page): Promise<RowFacts[]> =>
  readRows(page, SESSION_ROW, '.dshOneTree_title', '.dshOneTree_slot')
const readOwnSearchRows = (page: Page): Promise<RowFacts[]> =>
  readRows(page, SEARCH_ROW, '[class*="searchRowTitle"]', '.dshOneTree_slot')
const readOfficialRows = (page: Page): Promise<RowFacts[]> =>
  readRows(page, OFFICIAL_ROW, OFFICIAL_TITLE, '[class*="_slot"]')

/** 某页上某枚官方 token 的解析色（与点同处一个 CSS 作用域，见 F-43 的说明）。 */
async function probeColor(page: Page, token: string): Promise<string> {
  return await page.evaluate((name) => {
    const host = document.querySelector('[data-shell="dsh-one-sidebar"]') ?? document.body
    const probe = document.createElement('span')
    probe.style.color = `var(${name})`
    host.appendChild(probe)
    const value = getComputedStyle(probe).color
    probe.remove()
    return value
  }, token)
}

/** 等某个读数满足条件（注入帧到界面落定之间有一段异步链：帧 → 插件 → 快照 → 重渲染）。 */
async function waitFor<T>(page: Page, read: () => Promise<T>, predicate: (value: T) => boolean, timeoutMs = 8_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let value = await read()
  while (!predicate(value) && Date.now() < deadline) {
    await page.waitForTimeout(150)
    value = await read()
  }
  return value
}

const rowOf = (rows: readonly RowFacts[], id: string): RowFacts | undefined => rows.find((row) => row.id === id)
const offRowOf = (rows: readonly RowFacts[], title: string): RowFacts | undefined => rows.find((row) => row.title === title)

/**
 * #147：让假宿主把「面板里开着哪些会话」报成这一批——真宿主在这一处做的正是同一件事
 * （记下这份事实 + 给装配页广播一条 `dshOne.panelSessions`），假宿主的 `reportPanelSessions`
 * 把两者做在一起（表 + 广播），所以「逐条查询」与「整份读取」看到的是同一份事实。
 */
async function reportPanelSessions(page: Page, sessionIds: readonly string[]): Promise<void> {
  await page.evaluate((ids: string[]) => {
    const host = (globalThis as unknown as { __LAB_HOST__?: { reportPanelSessions(ids: string[]): void } }).__LAB_HOST__
    host?.reportPanelSessions(ids)
  }, [...sessionIds])
}

/** 假宿主侧关于 #147 那条通道的观测：页面挂载时读了几次快照、当前这份集合是什么。 */
async function panelSessionsHostFacts(page: Page): Promise<{ reads: number; open: readonly string[] }> {
  return await page.evaluate(() => {
    const host = (globalThis as unknown as {
      __LAB_HOST__?: { panelSessions?: unknown; hostCalls?: { call: string }[] }
    }).__LAB_HOST__
    const open = Array.isArray(host?.panelSessions) ? (host?.panelSessions as unknown[]).map((id) => String(id)) : []
    return {
      reads: (host?.hostCalls ?? []).filter((call) => call.call === 'session.panelSessions').length,
      open,
    }
  })
}
/** 官方页里某一行元素的下标（官方不写 data 属性，只能按标题在既定序列里定位）。 */
const officialRowIndex = async (page: Page, title: string): Promise<number> =>
  await page.evaluate(
    ({ rowSel, titleSel, wanted }) =>
      Array.from(document.querySelectorAll(rowSel)).findIndex(
        (row) => (row.querySelector(titleSel)?.textContent ?? '').trim() === wanted,
      ),
    { rowSel: OFFICIAL_ROW, titleSel: OFFICIAL_TITLE, wanted: title },
  )

/** 四态压缩成一行（`null` = 这一点不渲染），报告「观测」里逐案记一条用。 */
const describeDot = (dot: DotFacts | null): string =>
  dot === null
    ? '不渲染点'
    : `${String(dot.state)}（${dot.tag}${dot.cells > 0 ? ` ${String(dot.cells)} 格` : ''} ${String(dot.box.width)}×${String(dot.box.height)} ${dot.color} 文案=${dot.labels.join('|')}）`

/** 状态点的「四项」（在不在 / state / 解析色 / 尺寸）——并排对照与逐条钉住都用它。 */
const four = (row: RowFacts | undefined): unknown => {
  const dot = row?.dot ?? null
  return { present: dot !== null, state: dot?.state ?? null, color: dot?.color ?? null, size: dot === null ? null : [dot.box.width, dot.box.height] }
}

/** 一行元素的截图（并排对照的左右两半）。 */
async function rowShot(page: Page, selector: string, index: number): Promise<Buffer> {
  return await page.locator(selector).nth(index).screenshot()
}

/**
 * 单个元素直接落盘成一张截图（没有官方侧可对照的那一案用，例如搜索结果行——官方页在
 * 那一案里不在搜索态，拼不出并排）。
 */
async function elementShotFile(shotsDir: string, page: Page, selector: string, name: string, index: number): Promise<string> {
  const file = path.join(shotsDir, `${name}.png`)
  await fsp.mkdir(shotsDir, { recursive: true })
  await page.locator(selector).nth(index).screenshot({ path: file })
  return file
}

/**
 * 把两侧同一案的截图拼成一张「同屏并排」图：报告里给人逐条比对用（左边自有树、右边官方页，
 * 各自的会话行**原尺寸**并排放）。缩放会看不准点的大小，所以不缩放。
 */
async function sideBySide(
  context: BrowserContext,
  shotsDir: string,
  name: string,
  left: { label: string; png: Buffer },
  right: { label: string; png: Buffer },
): Promise<string> {
  const page = await context.newPage()
  const file = path.join(shotsDir, `${name}.png`)
  await fsp.mkdir(shotsDir, { recursive: true })
  const src = (png: Buffer): string => `data:image/png;base64,${png.toString('base64')}`
  const figure = (side: { label: string; png: Buffer }): string =>
    `<figure style="margin:0"><figcaption style="margin-bottom:6px">${side.label}</figcaption>` +
    `<img style="display:block" src="${src(side.png)}"></figure>`
  // 视口只取内容那一带（`fullPage` 截图因此紧紧贴住两行），不然并排图下面会留一大片空白。
  await page.setViewportSize({ width: 1700, height: 130 })
  await page.setContent(
    `<!doctype html><body style="margin:0;padding:10px;background:#141414;color:#d6d6d6;font:12px/1.5 -apple-system,system-ui,sans-serif;display:flex;gap:16px;align-items:flex-start">` +
      `${figure(left)}${figure(right)}</body>`,
  )
  await page.screenshot({ path: file, fullPage: true })
  await page.close()
  return file
}

/** 一次并排对照：自有页与官方页各截当前目标行，拼成一张图。 */
async function pairShot(
  ctx: { shots: string },
  own: Page,
  official: Page,
  id: string,
  title: string,
  name: string,
): Promise<string> {
  const index = await officialRowIndex(official, title)
  const ownIndex = await own.evaluate(
    (sessionId) =>
      Array.from(document.querySelectorAll('[data-dshone-tree-row="session"]')).findIndex(
        (row) => row.getAttribute('data-dshone-tree-session') === sessionId,
      ),
    id,
  )
  return await sideBySide(
    own.context(),
    ctx.shots,
    name,
    { label: '自有侧栏树（dsh-one）', png: await rowShot(own, SESSION_ROW, ownIndex) },
    { label: '官方浏览区（对照）', png: await rowShot(official, OFFICIAL_ROW, index) },
  )
}

export const STATUS_DOT_SUITE: LabSuite = {
  id: 'F-46',
  phase: 'new-feature',
  name: '会话行状态点逐案与官方页对照（#146）：空闲不渲染 / 跑完没打开 = 官方绿点 / 运行中 = 矩阵 / 等待 = 黄点 / 手动未读 = 绿点 + 加粗 / 宿主面板里开着的不亮绿点（#147）',
  expect:
    '同一条会话行在**同一份数据**下的状态点，自有侧栏树与官方浏览区逐案对照，四项（在不在 / `data-state` / 解析色 / 尺寸）逐项相等——对照用的态由官方那条链路在两侧同时造出来（`api-session/status` 帧造运行中与「跑完还没打开」、`approval/request` 瀑布帧造等待交互）。① **空闲**：两侧都不渲染点，状态槽 = 档位表标准档 `slotWidth`×`slotHeight`（16×20，从 `styles.ts` 的 `SCALE_TIERS` 读，不硬编码）。② **跑完还没打开**：两侧都是 `data-state=done`、解析色 = 官方 `--dsw-alias-state-success-primary`（同一枚 token 挂探针比，不写死色值）、读屏文案「已完成」、点几何相等。③ **运行中**：两侧 `ongoing`、8 格矩阵 svg（视框 `0 0 10 10`）、颜色 = `--dsw-static-deepseek-450`。④ **等待交互**：两侧 `warning`、颜色 = `--dsw-alias-state-warn-primary`、文案「等待审批」（#140 那条路不动，只在本套件里回归一遍）。⑤ **手动未读**（我们自定，官方没有这个概念）：`done` 绿点 + 标题加粗 600 + 读屏文案「未读」——形态与**旧侧栏正本**一致（`sessionsWebview.ts` 的 `sessionStatusMarker` 返回 `session-dot completed`、CSS 在 `sessionsView.ts`、行上同时挂 `session-title unread`；仓库自己的 `docs/legacy-vs-current-sidebar-compare.md` 第 115 行同样记成「绿点 + 标题加粗」），与「已完成」的区分点是**标题字重 600 / 400** 与读屏文案——三处都由本套件钉住；官方页同一行没有点也不加粗（那一侧没有这个功能）。⑥ **绿点灭的时机**：跑完还没打开的绿点在**打开这一行**之后灭（点行 → 官方 `sessions.open` → 官方 client 的 `select` 撤掉完成提醒，与官方页点行同一条语义）。⑦ **搜索结果行也是状态点的一处**：修掉 #146 查出来的「树层自己拼节点漏掉 `pendingInteraction` 与 `runningSubagentCount` 两格」——搜索命中一条正在等审批的会话时结果行同样亮黄点。⑧ **宿主的面板里开着的会话不亮这颗绿点**（#147）：官方那条提醒的武装条件是「这一页的 `selected` 不是它」，官方 web 只有一页所以成立，我们的 shell 有两个 webview（侧栏页 + 对话面板页各一份官方 client），宿主把面板切到某条会话不会回写给侧栏页 → 侧栏页照旧给一条**用户正开着**的会话亮「跑完还没打开」的绿点。本段夹具 = 假宿主报「面板里开着这条会话」（`reportPanelSessions`：记表 + 广播 `dshOne.panelSessions`，与真宿主同一份事实）+ 官方 `api-session/status` 帧驱动 run→idle 边（这条会话不是侧栏页的当前会话），断言四条：侧栏页挂载时确实读过宿主那份快照（通道真的通了）；宿主报「开着它」→ 那一行的绿点被压住，而同屏对照的**官方页照旧亮着**（差异正是补的那条）；面板还开着它再跑完一轮 → 绿点不出现且它仍不是当前会话（不是靠「点开它」撤掉的）；宿主改口「一条都没开」→ 绿点回来（官方提醒从头到尾都在，压住它的是宿主这份事实——这条边界是有意留下的，见 `pure/workspaceTreeView.ts` 的 `withoutPanelOpenCompleted`）。每案附一张同屏并排截图（左自有树 / 右官方页，行原尺寸）。全程零 pageerror、零槽位崩溃 / 零装载未激活；夹具只改页面收到的帧，网关只读。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const own = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { width: 380, height: 900 })
    const injector = await installEventStreamInjector(own.page)
    const official = await openTreePage(ctx.browser, ctx.lab, route('sidebar-official'), { width: 380, height: 900 })
    const officialInjector = await installEventStreamInjector(official.page)
    let unread: Awaited<ReturnType<typeof openTreePage>> | undefined
    try {
      for (const [page, treeRoute] of [
        [own.page, route('sidebar')],
        [official.page, route('sidebar-official')],
      ] as const) {
        await page.reload({ waitUntil: 'domcontentloaded' })
        await page.waitForSelector(treeRoute.readySelector, { timeout: 40_000 })
        await page.waitForTimeout(1_500)
      }
      await expandAllWorkspaces(own.page)
      const expandedOfficial = await expandOfficialWorkspaces(official.page)
      const ownReady = await waitForEventStream(injector, own.page)
      const officialReady = await waitForEventStream(officialInjector, official.page)
      check.ok('注入通道就绪（自有页：官方转发事件流 `$events` 连上并收到 ready 帧）', ownReady, JSON.stringify(injector.stats()))
      check.ok('注入通道就绪（官方对照页）', officialReady, JSON.stringify(officialInjector.stats()))

      // ---- 挑目标行（与 F-43 同一套约束）----
      // ① 非当前会话（官方完成提醒那条 run→idle 边只在非当前会话上武装）；
      // ② 基线上没有状态点（「凭空冒出一颗点」是最干净的信号）；
      // ③ 基线上标题不加粗（未读那一案要拿它与完成那一案对照）；
      // ④ **官方对照档里也看得见同一行且标题唯一**（官方件不写任何 data 属性，只能按标题认）。
      const officialBaseline = await readOfficialRows(official.page)
      check.fact(`官方对照档：展开 ${String(expandedOfficial)} 个工作区后渲染 ${String(officialBaseline.length)} 条会话行`)
      const ownBaseline = await readOwnRows(own.page)
      check.ok(
        '两侧都渲染出会话行（挑目标行才有意义）',
        ownBaseline.length > 0 && officialBaseline.length > 0,
        `own=${String(ownBaseline.length)} official=${String(officialBaseline.length)}`,
      )
      const uniqueTitles = new Set(
        officialBaseline
          .filter((row) => row.title !== '' && officialBaseline.filter((other) => other.title === row.title).length === 1)
          .map((row) => row.title),
      )
      const candidates = ownBaseline.filter(
        (row) => !row.current && row.id !== '' && row.title !== '' && row.dot === null && row.titleWeight === '400' && uniqueTitles.has(row.title),
      )
      check.ok(
        '两侧都看得见、标题在官方页里唯一的非当前空闲会话行存在（并排对照与完成提醒都需要它）',
        candidates.length > 0,
        `candidates=${String(candidates.length)} ownRows=${String(ownBaseline.length)} officialRows=${String(officialBaseline.length)}`,
      )
      const target = candidates[0]
      if (target === undefined) throw new Error('lab: no candidate session row')
      check.fact(
        `目标会话：${target.id}「${target.title}」基线 ${describeDot(target.dot)} 槽=${JSON.stringify(target.slot)} 标题字重=${target.titleWeight}`,
      )

      /** 目标行在两侧的当前读数。 */
      const ownTarget = async (): Promise<RowFacts | undefined> => rowOf(await readOwnRows(own.page), target.id)
      const offTarget = async (): Promise<RowFacts | undefined> => offRowOf(await readOfficialRows(official.page), target.title)
      const waitOwn = async (state: string | null): Promise<RowFacts | undefined> =>
        await waitFor(own.page, ownTarget, (row) => (row?.dot?.state ?? null) === state)
      const waitOff = async (state: string | null): Promise<RowFacts | undefined> =>
        await waitFor(official.page, offTarget, (row) => (row?.dot?.state ?? null) === state)

      // ---- ① 空闲：两侧都不渲染点 ----
      {
        const mine = await ownTarget()
        const theirs = await offTarget()
        check.eq('① 空闲：自有树不渲染状态点（官方 `showsStatusDot` 的口径）', mine?.dot ?? null, null)
        check.eq('① 空闲：官方页同一行也不渲染状态点', theirs?.dot ?? null, null)
        check.eq(
          `① 空闲：状态槽 = 档位表标准档 ${SCALE_TIERS.standard.slotWidth}×${SCALE_TIERS.standard.slotHeight}`,
          mine?.slot === null || mine?.slot === undefined ? null : [mine.slot.width, mine.slot.height],
          SLOT_SIZE,
        )
        check.eq(
          '① 空闲：两侧的状态槽几何相等（不是「我们有槽官方没有」）',
          mine?.slot === undefined || mine.slot === null ? null : [mine.slot.width, mine.slot.height],
          theirs?.slot === undefined || theirs.slot === null ? null : [theirs.slot.width, theirs.slot.height],
        )
        check.fact(`① 空闲：自有 ${describeDot(mine?.dot ?? null)}；官方 ${describeDot(theirs?.dot ?? null)}（槽 ${String(mine?.slot?.width)}×${String(mine?.slot?.height)}）`)
        screenshots.push(await pairShot(ctx, own.page, official.page, target.id, target.title, 'status-dot-idle-pair'))
      }

      // ---- ③ 运行中：两侧矩阵（跑完那一案要的 run→idle 边也从这里起步）----
      injector.push(emit('api-session/status', [target.id, true]))
      officialInjector.push(emit('api-session/status', [target.id, true]))
      const runningOwn = await waitOwn('ongoing')
      const runningOff = await waitOff('ongoing')
      {
        const mine = runningOwn?.dot ?? null
        const theirs = runningOff?.dot ?? null
        const ownProbe = await probeColor(own.page, ONGOING_TOKEN)
        const offProbe = await probeColor(official.page, ONGOING_TOKEN)
        check.eq('③ 运行中：自有树 data-state=ongoing', mine?.state ?? null, 'ongoing')
        check.eq('③ 运行中：与官方页同一行同一态的四项相等（在不在 / state / 解析色 / 尺寸）', four(runningOwn), four(runningOff))
        check.eq('③ 运行中：渲染的是官方矩阵件（svg / 8 格 / 10×10 视框）', [mine?.tag, mine?.cells, mine?.viewBox], ['svg', 8, '0 0 10 10'])
        check.ok(
          '③ 运行中：解析色 = 官方 `--dsw-static-deepseek-450`（两侧各自拿同一枚 token 挂探针比，不写死色值）',
          mine?.color === ownProbe && ownProbe !== '' && theirs?.color === offProbe && ownProbe === offProbe,
          `own=${String(mine?.color)}/${ownProbe} official=${String(theirs?.color)}/${offProbe}`,
        )
        check.fact(`③ 运行中：自有 ${describeDot(mine)}；官方 ${describeDot(theirs)}`)
        screenshots.push(await pairShot(ctx, own.page, official.page, target.id, target.title, 'status-dot-running-pair'))
      }

      // ---- ④ 等待交互：两侧黄点（#140 那条路的回归）----
      {
        const approvalId = 'lab-status-dot-approval'
        injector.push(
          waterfall('approval/request', approvalId, target.id, { toolName: 'bash', callId: 'lab-status-dot-call', reason: 'lab fixture' }),
        )
        officialInjector.push(
          waterfall('approval/request', approvalId, target.id, { toolName: 'bash', callId: 'lab-status-dot-call', reason: 'lab fixture' }),
        )
        const waitingOwn = await waitOwn('warning')
        const waitingOff = await waitOff('warning')
        const mine = waitingOwn?.dot ?? null
        const theirs = waitingOff?.dot ?? null
        const ownProbe = await probeColor(own.page, WARN_TOKEN)
        const offProbe = await probeColor(official.page, WARN_TOKEN)
        check.eq('④ 等待交互：自有树 data-state=warning', mine?.state ?? null, 'warning')
        check.eq('④ 等待交互：与官方页同一行同一态的四项相等', four(waitingOwn), four(waitingOff))
        check.ok(
          '④ 等待交互：解析色 = 官方 `--dsw-alias-state-warn-primary`（两侧各自拿同一枚 token 挂探针比）',
          mine?.color === ownProbe && ownProbe !== '' && theirs?.color === offProbe && ownProbe === offProbe,
          `own=${String(mine?.color)}/${ownProbe} official=${String(theirs?.color)}/${offProbe}`,
        )
        check.eq('④ 等待交互：读屏文案两侧相等（等待审批）', [mine?.labels, theirs?.labels], [['等待审批'], ['等待审批']])
        check.fact(`④ 等待交互：自有 ${describeDot(mine)}；官方 ${describeDot(theirs)}`)
        screenshots.push(await pairShot(ctx, own.page, official.page, target.id, target.title, 'status-dot-warning-pair'))
        // 取消帧一到就清，回到这一行被注入之前的那一态（此刻是运行中：上一段刚把它置成 true）
        injector.push({ type: 'cancel', eventId: approvalId })
        officialInjector.push({ type: 'cancel', eventId: approvalId })
        const backOwn = await waitOwn('ongoing')
        const backOff = await waitOff('ongoing')
        check.eq(
          '④ 取消帧一到两侧都回到取消前那一态（不留假黄点）',
          [backOwn?.dot?.state ?? null, backOff?.dot?.state ?? null],
          ['ongoing', 'ongoing'],
        )
      }

      // ---- ② 跑完还没打开：两侧官方绿点（run→idle 边武装完成提醒）----
      injector.push(emit('api-session/status', [target.id, false]))
      officialInjector.push(emit('api-session/status', [target.id, false]))
      const doneOwn = await waitOwn('done')
      const doneOff = await waitOff('done')
      {
        const mine = doneOwn?.dot ?? null
        const theirs = doneOff?.dot ?? null
        const ownProbe = await probeColor(own.page, SUCCESS_TOKEN)
        const offProbe = await probeColor(official.page, SUCCESS_TOKEN)
        check.eq('② 跑完还没打开：自有树 data-state=done', mine?.state ?? null, 'done')
        check.eq('② 跑完还没打开：与官方页同一行同一态的四项相等', four(doneOwn), four(doneOff))
        check.ok(
          '② 跑完还没打开：解析色 = 官方 `--dsw-alias-state-success-primary`（两侧各自拿同一枚 token 挂探针比）',
          mine?.color === ownProbe && ownProbe !== '' && theirs?.color === offProbe && ownProbe === offProbe,
          `own=${String(mine?.color)}/${ownProbe} official=${String(theirs?.color)}/${offProbe}`,
        )
        check.eq('② 跑完还没打开：读屏文案是官方那一档（已完成），两侧相等', [mine?.labels, theirs?.labels], [['已完成'], ['已完成']])
        check.eq('② 跑完还没打开：标题不加粗（未读才加粗——第 ⑤ 案要拿它对照）', [doneOwn?.titleWeight, doneOff?.titleWeight], ['400', '400'])
        check.fact(`② 跑完还没打开：自有 ${describeDot(mine)}；官方 ${describeDot(theirs)}`)
        screenshots.push(await pairShot(ctx, own.page, official.page, target.id, target.title, 'status-dot-completed-pair'))
      }

      // ---- ⑧ 宿主的面板里开着的会话（#147）----
      // 现场（用户话）：「这条会话我明明开着，它还给我一颗『跑完还没打开』的绿点」。
      // 官方那条提醒的武装条件是**这一页的 selected 不是它**（`syncCompletedNotifications`），
      // 官方 web 只有一页所以成立；我们的 shell 有两个 webview（侧栏页 + 对话面板页），
      // 宿主把面板切到某条会话不会回写给侧栏页 → 侧栏页的 selected 与屏幕上开着的会话
      // 可以是两回事。修法：宿主把自己那份事实（面板里开着哪些会话）广播给装配页，侧栏树
      // 把它算进**渲染判据**（`pure/workspaceTreeView.ts` 的 `withoutPanelOpenCompleted`）。
      //
      // 这一段的所有夹具都是「宿主报什么」（假宿主 `reportPanelSessions` = 记表 + 广播，
      // 与真宿主同一份事实），驱动的边是官方那条链路（`api-session/status` 帧）——所以
      // 「官方那条提醒真的武装着」这件事由 ② 与下面的「宿主改口没开 → 绿点回来」一起证。
      {
        const hostFacts = await panelSessionsHostFacts(own.page)
        check.ok(
          '⑧ 通道真的通了：侧栏页挂载时读了宿主那份快照（`session.panelSessions` 至少被调用一次）',
          hostFacts.reads >= 1,
          JSON.stringify(hostFacts),
        )
        check.eq('⑧ 前置：此刻这一行亮着「跑完还没打开」的绿点（② 刚武装的）', (await ownTarget())?.dot?.state ?? null, 'done')
        await reportPanelSessions(own.page, [target.id])
        const hidden = await waitFor(own.page, ownTarget, (row) => row?.dot === null)
        check.eq('⑧ 宿主报「这条会话开在面板里」→ 这一行的绿点被压住（它跑完时用户正开着它）', hidden?.dot ?? null, null)
        check.eq(
          '⑧ 同一时刻官方对照页同一行照旧亮着（那一侧没有「宿主面板」这件事实，判据原样成立——差异正是我们补的那条）',
          (await offTarget())?.dot?.state ?? null,
          'done',
        )
        check.fact(`⑧ 宿主报的这份事实：${JSON.stringify(hostFacts.open)}（这条会话 + 面板里开着它）`)
        screenshots.push(await pairShot(ctx, own.page, official.page, target.id, target.title, 'status-dot-panel-open-pair'))

        // 现场本体：面板还开着它，它又跑了一轮 —— 跑完仍不亮点（完成提醒连武装都不该发生）
        injector.push(emit('api-session/status', [target.id, true]))
        await waitOwn('ongoing')
        injector.push(emit('api-session/status', [target.id, false]))
        await own.page.waitForTimeout(1_200)
        const stillOpen = await ownTarget()
        check.eq('⑧ 开着它再跑完一轮：绿点不出现（用户报的现场本体）', stillOpen?.dot ?? null, null)
        check.eq('⑧ 跑完这一轮之后它仍不是当前会话（不是靠「点开它」把提醒撤掉的）', stillOpen?.current, false)

        // 边界（有意留下、写进断言免得被当成漏网）：宿主改口「一条都没开」→ 绿点回来，
        // 说明官方那条提醒从头到尾都在，压住它的一直是宿主这份事实。判据回答的是
        // 「此刻这条会话开在不在面板里」，不记忆「武装那一刻」——理由写在
        // `pure/workspaceTreeView.ts` 的 `withoutPanelOpenCompleted` 上面。
        await reportPanelSessions(own.page, [])
        const back = await waitFor(own.page, ownTarget, (row) => row?.dot?.state === 'done')
        check.eq('⑧ 边界：宿主改口「没开」→ 绿点回来（官方提醒仍在，压住它的是宿主这份事实）', back?.dot?.state ?? null, 'done')
        check.fact('⑧ 边界口径：绿点压住的条件是「此刻这条会话开在宿主面板里」；关掉面板之后提醒会回来（本步有意不做「武装那一刻」的记忆，见 issue #147 的结论）')
      }

      // ---- ⑥ 绿点灭的时机：打开这一行之后 ----
      {
        check.eq('⑥ 打开前：这一行亮着「跑完还没打开」的绿点', (await ownTarget())?.dot?.state ?? null, 'done')
        await own.page.click(`[data-dshone-tree-session="${target.id}"]`)
        const opened = await waitFor(own.page, ownTarget, (row) => row?.dot === null)
        check.eq('⑥ 点这一行（打开）之后：绿点灭掉', opened?.dot ?? null, null)
        check.eq('⑥ 打开之后这一行成为当前会话', opened?.current, true)
        // 官方页同一条语义：点它那一行同样灭（两侧行为一致，并排对照的另一半）
        const index = await officialRowIndex(official.page, target.title)
        check.ok('⑥ 官方页里定位得到同一行（按标题）', index >= 0, `index=${String(index)}`)
        await official.page.locator(OFFICIAL_ROW).nth(index).click()
        const offCleared = await waitFor(official.page, offTarget, (row) => row?.dot === null)
        check.eq('⑥ 官方页点同一行也灭（同一条语义：点行 = `sessions.open` = `select` 撤掉完成提醒）', offCleared?.dot ?? null, null)
        check.fact('⑥ 灭的机制：点行 → 官方 `sessions.open` → 官方 client 的 `select()` 撤掉该会话的完成提醒（两侧同一份官方代码）')
      }

      // ---- ⑤ 手动未读：我们自定（绿点 + 加粗），官方没有这个概念 ----
      {
        unread = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), {
          width: 380,
          height: 900,
          state: { unread: { version: 1, sessionIds: [target.id] } },
        })
        check.ok('⑤ 手动未读：注入了未读集合的页面装配起来了', unread.ready)
        await expandAllWorkspaces(unread.page)
        const mine = rowOf(await readOwnRows(unread.page), target.id)
        const probe = await probeColor(unread.page, SUCCESS_TOKEN)
        check.eq('⑤ 手动未读：状态点 data-state=done（借官方那颗 done 点）', mine?.dot?.state ?? null, 'done')
        check.ok(
          '⑤ 手动未读：解析色 = 官方 `--dsw-alias-state-success-primary`（同一枚 token 挂探针比）',
          mine?.dot?.color !== undefined && mine.dot.color === probe && probe !== '',
          `dot=${String(mine?.dot?.color)} probe=${probe}`,
        )
        check.eqTexts('⑤ 手动未读：读屏文案是「未读」（与「已完成」不同）', mine?.dot?.labels, ['未读'])
        check.eq('⑤ 手动未读：标题加粗 600（旧侧栏正本 `.session-title.unread` 的同一形态）', mine?.titleWeight, '600')
        // 「未读」与「已完成」可区分——点本身同形（都是官方 done 那颗），区分在两处：
        check.eq(
          '⑤ 未读 vs 已完成：点本身同形同色（同一颗官方 done 点：尺寸与解析色逐项相等）',
          mine?.dot === null || mine?.dot === undefined ? null : [mine.dot.box.width, mine.dot.box.height, mine.dot.color],
          doneOwn?.dot === null || doneOwn?.dot === undefined ? null : [doneOwn.dot.box.width, doneOwn.dot.box.height, doneOwn.dot.color],
        )
        check.ok(
          '⑤ 未读 vs 已完成：可区分处 = 标题字重（未读 600 / 已完成 400）与读屏文案（未读 / 已完成）',
          mine?.titleWeight === '600' &&
            doneOwn?.titleWeight === '400' &&
            isText(mine?.dot?.labels?.[0], '未读') &&
            isText(doneOwn?.dot?.labels?.[0], '已完成'),
          `未读字重=${String(mine?.titleWeight)} 已完成字重=${String(doneOwn?.titleWeight)} 未读文案=${String(mine?.dot?.labels)} 已完成文案=${String(doneOwn?.dot?.labels)}`,
        )
        const theirs = await offTarget()
        check.eq(
          '⑤ 官方页同一行没有点、也不加粗（官方没有手动未读这个概念——这一处差异是我们有意的扩展，见套件文件头的正本依据）',
          [theirs?.dot ?? null, theirs?.titleWeight],
          [null, '400'],
        )
        screenshots.push(
          await sideBySide(
            unread.context,
            ctx.shots,
            'status-dot-unread-pair',
            {
              label: '自有侧栏树（手动未读：绿点 + 加粗）',
              png: await rowShot(
                unread.page,
                SESSION_ROW,
                await unread.page.evaluate(
                  (sessionId) =>
                    Array.from(document.querySelectorAll('[data-dshone-tree-row="session"]')).findIndex(
                      (row) => row.getAttribute('data-dshone-tree-session') === sessionId,
                    ),
                  target.id,
                ),
              ),
            },
            {
              label: '官方浏览区（同一行：官方没有手动未读）',
              png: await rowShot(official.page, OFFICIAL_ROW, await officialRowIndex(official.page, target.title)),
            },
          ),
        )
        check.fact(
          `⑤ 手动未读：${describeDot(mine?.dot ?? null)} 标题字重=${String(mine?.titleWeight)}；同一行在官方页 ${describeDot(theirs?.dot ?? null)} 标题字重=${String(theirs?.titleWeight)}`,
        )
      }

      // ---- ⑦ 搜索结果行：树层自己拼节点漏掉的那两格（#146 修）----
      {
        const searchId = 'lab-status-dot-search'
        injector.push(
          waterfall('approval/request', searchId, target.id, { toolName: 'bash', callId: 'lab-status-dot-search-call', reason: 'lab fixture search' }),
        )
        await waitOwn('warning')
        await own.page.click(SEARCH_BUTTON)
        await own.page.fill(SEARCH_INPUT, target.title)
        const searchRows = await waitFor(own.page, () => readOwnSearchRows(own.page), (rows) => rowOf(rows, target.id)?.dot != null)
        const searchRow = rowOf(searchRows, target.id)
        check.eq(
          '⑦ 搜索结果行：等待交互同样亮黄点（修前树层自拼节点把 `pendingInteraction` 丢了，这里什么都不渲染）',
          searchRow?.dot?.state ?? null,
          'warning',
        )
        check.eqTexts('⑦ 搜索结果行：读屏文案同样是官方那一档', searchRow?.dot?.labels, ['等待审批'])
        check.ok(
          '⑦ 搜索结果行：解析色同样是 `--dsw-alias-state-warn-primary`',
          searchRow?.dot?.color === (await probeColor(own.page, WARN_TOKEN)),
          `dot=${String(searchRow?.dot?.color)}`,
        )
        screenshots.push(
          await elementShotFile(ctx.shots, own.page, SEARCH_ROW, 'status-dot-search-row', await own.page.evaluate(
            (sessionId) =>
              Array.from(document.querySelectorAll('[data-dshone-tree-row="search"]')).findIndex(
                (row) => row.getAttribute('data-dshone-tree-session') === sessionId,
              ),
            target.id,
          )),
        )
        check.fact(`⑦ 搜索结果行：${describeDot(searchRow?.dot ?? null)}（行上的活状态 ${String(searchRow?.status)}）`)
        injector.push({ type: 'cancel', eventId: searchId })
      }

      // ---- ⑧ 宿主的面板里开着的会话 ----
      // #147 起这一段是**断言**（原来是一条读代码记下的固定缺口 `check.fact`）：宿主把
      // 「面板里开着哪些会话」广播给装配页，侧栏树把它算进渲染绿点的判据——现场与逐条
      // 断言都写在上面 ⑧ 那一段里面（位置在 ② 与 ⑥ 之间：那时这一行还没被打开，绿点
      // 正由官方那条提醒武装着，正是要复现的现场）。
      check.fact(
        '⑧ 宿主面板态已进绿点判据（#147）：判据 = 官方完成提醒 × 宿主报的「此刻开在面板里」的集合；修法与边界的出处见 pure/workspaceTreeView.ts 的 `withoutPanelOpenCompleted`。',
      )

      check.eq('自有页零 pageerror', own.capture.pageErrors, [])
      check.eq('官方对照页零 pageerror', official.capture.pageErrors, [])
      check.eq('手动未读页零 pageerror', unread?.capture.pageErrors ?? [], [])
      const crashed = [...own.capture.consoleErrors, ...own.capture.consoleWarnings].filter((line) =>
        /slot entry crashed|chain selector crashed|did not activate/.test(line),
      )
      check.eq('自有页零槽位崩溃 / 零装载未激活', crashed, [])
    } finally {
      if (unread !== undefined) await unread.context.close()
      await official.context.close()
      await own.context.close()
    }
    return screenshots
  },
}
