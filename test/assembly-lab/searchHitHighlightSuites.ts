/**
 * 搜索命中高亮（#152，F-49）。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与 `searchCollapseSuites.ts` / `topbarRhythmSuites.ts`
 * 同一条：那个文件是本批开发的合入热点，新套件放外面能少一半冲突面。注册方式是在
 * `suites.ts` 的 `SUITES` 末尾追加一项。
 *
 * ## 为什么要自己造数据（这条是本套件的立身之本）
 *
 * 「当天网关上的会话标题里有没有这个查询串」是**当天数据**，靠它判高亮会得到一条会自己
 * 变红的套件（#116 / #148 记的就是这一类抖动）。所以这里三处命中全部由**页内夹具**造出来，
 * 请求不落到网关（与 F-18 的 `schedule` 夹具、F-39 的 `running` 夹具、F-45 的标题夹具同一
 * 处置）：
 *
 * - `session/list` 回执里把三条**真会话**的标题换成固定文案（标题那一路的第一条路）；
 * - `session/control` 基线帧里那三条的标题一并换掉（标题那一路的第二条路，见下）；
 * - `workspace/follow` 基线帧换成三棵**合成**工作区，其中一棵的名字含查询串（工作区名那一路）；
 * - `session/search` 回执返回这三条会话 + 各自固定文案的片段（片段那一路）。
 *
 * 三条会话 id 本身是从页面上真行里取的（与 F-45 同一做法），所以「夹具接上了没有」是当场
 * 可判的：接不上就没有行、断言直接红，不会静默退化成「今天恰好没命中」。三条各司其职：
 * 命中行（三处都会标）、非命中行（一处都不该标）、边界行（重叠与相邻那一条，见
 * `BOUNDARY_TITLE`）。
 *
 * ## 标题为什么必须两条路都补（#158：共享实例上 35/44 红的根因）
 *
 * 官方投影存储的写入方有两类：`session/list` / `session/added` / 控制流增量帧都**按序号取新**，
 * 而控制流**基线**帧是 `replaceControlBaseline` 的 `truncate` + `seed`——**整个不看序号**，
 * 基线里出现的每条会话都被硬换一遍。有使用者的实例上基线会带着树里那些会话（#158 实测共享实例
 * 11 块、空闲实例 0 块），于是只补 `session/list` 的夹具在共享实例上必红：基线先到就把真标题
 * 以真序号种进存储，那份没抬序号的回执随后被序号挡掉；就算抬了序号，基线后到照样换回去。
 * 两条路的处置分别写在 `installApiFixtures` 与 `installMuxFixtures` 的注释里，A/B 现场实测记在
 * #158。
 *
 * ## 判据的期望值从哪来
 *
 * `rows.ts` 的 `highlightMatches` 与 `styles.ts` 的 `.dshOneTree_searchMark` 是唯一事实源，
 * 这里只按**标准词**描述它们的行为：三处各自把**每一处**命中词都标出来（大小写不敏感、只标
 * 命中词不标整段、相邻两处都标、重叠只算一次）、`<mark>` 语义标签、加粗 + 变色 + 无底色、
 * 颜色 = 官方 token `--dsw-alias-state-business-primary`（同一枚 token 挂探针上比，不写死
 * 色值）。为什么是「旧侧栏那一版」而不是「官方那一版」：**官方搜索结果没有高亮**（实测结论
 * 写在 `rows.ts` 那个函数上），没有可对齐的形态，按 `AGENTS.md` 的口径照旧侧栏补；「每一处
 * 都标」是 #166 用户拍板后定的口径（#152 起先照旧侧栏只标第一处）。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { openTreePage, withoutKnownNoise, type OpenedPage } from './harness.ts'
import { LAB_TREES, type LabTreeRoute } from './labServer.ts'
// 只取类型（编译后不留 import，运行期没有环）：套件接口定义在 suites.ts 里。
import type { LabSuite } from './suites.ts'

const route = (name: string): LabTreeRoute => {
  const found = LAB_TREES.find((candidate) => candidate.route === name)
  if (found === undefined) throw new Error(`lab: unknown tree route ${name}`)
  return found
}

async function shot(ctx: { shots: string }, page: OpenedPage['page'], name: string): Promise<string> {
  const file = path.join(ctx.shots, `${name}.png`)
  await fsp.mkdir(ctx.shots, { recursive: true })
  await page.screenshot({ path: file })
  return file
}

// ---------------------------------------------------------------------------
// 夹具常量：三处的固定文案，以及那个大小写故意写乱的查询串
// ---------------------------------------------------------------------------

/**
 * 键入搜索框的查询串（大小写故意写乱，用来钉「大小写不敏感」）。
 * 三处文案里它各以**不同的原始大小写**出现，所以「标出来的是原文那一段」也是可判的。
 */
const QUERY = 'LaBhIt'

/**
 * 标题：查询串出现 **4 处**（4 处的原始大小写各不相同），且最后两处**紧挨着**（中间没有任何别的
 * 字符）——#166 起每一处都标，相邻那两处之间不许留下没标的缝。
 */
const HIT_TITLE = 'labhit first · LABHIT second · LaBhItLaBhIt adjacent'

/** 标题里那 4 处标记各自的文字（顺序 = 出现顺序，大小写 = 原文那一处）。 */
const TITLE_MARKS = ['labhit', 'LABHIT', 'LaBhIt', 'LaBhIt']

/** 标题按「文本 / 标记」切开的样子：钉住相邻两处之间没有夹缝、原文其余部分一字不丢。 */
const TITLE_SEGMENTS = ['mark:labhit', 'text: first · ', 'mark:LABHIT', 'text: second · ', 'mark:LaBhIt', 'mark:LaBhIt', 'text: adjacent']

/** 工作区名：查询串出现**两处**（两处原始大小写不同）。 */
const HIT_WORKSPACE = 'LabHit Workspace · labhit'
/** 工作区名里那两处标记各自的文字。 */
const WORKSPACE_MARKS = ['LabHit', 'labhit']

/** 未命中那条会话所在的工作区名（不含查询串，所以那一行的工作区名一处都不标）。 */
const MISS_WORKSPACE = 'Neutral Place'
/** 未命中那条会话的标题（不含查询串）。 */
const MISS_TITLE = 'neutral row'

/** 命中那条的片段：查询串出现**两处**（第一处在开头不远处，窄宽度下也看得见），整段够长会被省略号截断。 */
const HIT_SNIPPET =
  'excerpt: LaBhIt is the first hit here, then a long tail keeps this row clipped at narrow widths, and further on the same excerpt repeats labhit a second time'
/** 片段里那两处标记各自的文字。 */
const SNIPPET_MARKS = ['LaBhIt', 'labhit']

/** 命中行整行的标记文字（标题 → 工作区名 → 片段，与文档顺序一致）。 */
const HIT_MARKS = [...TITLE_MARKS, ...WORKSPACE_MARKS, ...SNIPPET_MARKS]

/** 未命中那条的片段（不含查询串）——它由宿主的内容搜索带回来，所以行在、但一处都不该标。 */
const MISS_SNIPPET = 'excerpt without the term'

/**
 * 第三条受控会话（边界行），专量「重叠与相邻」这一条：它的标题里放的是**自己和自己重叠**的那个
 * 词（`aba` 的前缀 = 后缀），也就是「重叠不重复计」唯一量得出来的形状——
 * - `ababa` 里 0 与 2 两个位置都起得来 `aba`，但它们互相压着，只算**第一处**（从命中那一段的末尾
 *   继续往后找，而不是从它后面一个字符）；
 * - `abaaba` 里那两处**紧挨着**（第二处从第一处的下一个字符开始），两处都要标。
 *
 * 所以整条标题的标记就是 3 处，且最后两处之间一个未标字符都没有（由切分读数钉住）。
 */
const BOUNDARY_QUERY = 'aba'
const BOUNDARY_TITLE = 'ababa then abaaba'
/** 边界行标题里那 3 处标记的文字（`ababa` 里重叠的那一处不在其中）。 */
const BOUNDARY_MARKS = ['aba', 'aba', 'aba']
/** 边界行标题的切分：中间那一段是 `ababa` 留下的尾巴（重叠那一处不再参与匹配），末尾两处紧挨着。 */
const BOUNDARY_SEGMENTS = ['mark:aba', 'text:ba then ', 'mark:aba', 'mark:aba']
/** 边界行所在的工作区名与它的片段（都不含边界查询串——同一行里「别处一处都不标」的对照）。 */
const BOUNDARY_WORKSPACE = 'Boundary Place'
const BOUNDARY_SNIPPET = 'excerpt for the boundary row'

/** 官方那枚「业务主色」token（浅色 #4176e6 / 深色 #679efe，官方 `_folderActive` 用的同一枚）。 */
const MARK_TOKEN = '--dsw-alias-state-business-primary'

/** 搜索区与三处的选择器（自有契约，与 F-18 / F-37 用的是同一组标记）。 */
const SEARCH_AREA = '[data-dshone-tree="search"]'
const SEARCH_BUTTON = '[data-dshone-tree-action="search"]'
const SEARCH_INPUT = '[data-dshone-tree="search-input"]'
const ROW = `${SEARCH_AREA} [data-dshone-tree-row="search"]`
const TITLE = '.dshOneTree_searchRowTitle'
const WORKSPACE = '.dshOneTree_searchRowWorkspace'
const SNIPPET = '.dshOneTree_searchRowSnippet'

/** 三档宽度（与 F-42 / F-44 / F-45 同一组，栅格各不相同才量得出「窄的时候还成不成立」）。 */
const WIDTHS = [260, 340, 500] as const

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

interface FixtureTitles {
  /** 会话 id → 夹具要盖上的标题（同时盖 `title` 与 `displayTitle`，两者都读得到）。 */
  readonly [sessionId: string]: string
}

interface FixtureStats {
  /** 被夹具换过的 `session/search` 请求数（>0 = 那条查询真的走到了这条 RPC）。 */
  searchCalls: number
  /** 被夹具换过标题的 `session/list` 回执数。 */
  listCalls: number
  /** 标题真的被换掉的会话数（0 = 夹具没接上，别把空读数当结论）。 */
  titled: number
  /** `workspace/follow` 基线帧被换成合成工作区的次数。 */
  workspaceFrames: number
  /** 收到的 `session/control` 基线帧数（含一条都没补上的那些）。 */
  controlFrames: number
  /** 在控制流基线里真的换掉标题的会话数（0 = 基线里没有我们的靶子，这条夹具没起作用）。 */
  controlTitles: number
}

/**
 * 装 HTTP 侧夹具（一个 handler 管三件事，避免多条 `page.route` 抢同一个请求）：
 * - `session/search` → 换成受控的三条结果（一条命中、一条不含查询串、一条边界文案）；
 * - `session/list` → 把目标会话的标题换成受控文案，并把 `asOfSeq` 抬到远大于网关的值；
 * - 其余原样透传（网关只读，夹具只改页面收到的回执）。
 *
 * ## 为什么标题要**两条路都补**（#158 实测的根因）
 *
 * 官方会话标题的权威位置是**投影存储**那一格，而这一格有四个写入方（官方
 * `@deepseek-ai/dsh-api-session-controller` 的 client bundle，0.1.6-alpha.1 实测）：
 *
 * 1. `session/list` 回执 / 列表刷新 → `store.apply(key, value, asOfSeq)`；
 * 2. `session/added` 事件 → `apply`；
 * 3. 控制流的 `projection` 增量帧 → `apply`；
 * 4. 控制流的**基线帧** → `replaceControlBaseline`：先 `store.truncate(asOfSeq)`、
 *    再 `store.seed({...block, asOfSeq})`。
 *
 * 前三者都**按序号取新**（`apply` 里 `seq <= row.seq` 直接 return），所以只补一条路时
 * 要同时把序号抬大，否则会被先到的那一份挡住；而第 4 条**整个不看序号**——基线里出现的
 * 每条会话都是 truncate + seed 硬换一遍，序号抬到多大都会被换回去。
 *
 * 本套件的靶子是**真会话 id**，而控制流基线在有人用着的实例上会带着这些会话（#158 实测：
 * 共享实例 11 块、空实例 0 块），所以两条路都得补：`session/list` 这一路见本函数，
 * `session/control` 那一路见 {@link installMuxFixtures}。
 */
async function installApiFixtures(
  page: OpenedPage['page'],
  titles: FixtureTitles,
  targets: { readonly hit: string; readonly miss: string; readonly boundary: string },
  stats: FixtureStats,
): Promise<void> {
  await page.route('**/api/**', async (requestRoute) => {
    const request = requestRoute.request()
    const method = decodeURIComponent(request.url()).split('/api/')[1] ?? ''
    if (method.startsWith('session/search')) {
      stats.searchCalls += 1
      let rpcId = ''
      try {
        rpcId = (JSON.parse(request.postData() ?? '{}') as { rpcId?: string }).rpcId ?? ''
      } catch {
        /* 形状不对就空 rpcId——下面这条回执只给夹具用，真请求走 route.fetch 原样透传 */
      }
      await requestRoute.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          type: 'server-response',
          rpcId,
          result: {
            ok: true,
            value: {
              items: [
                { id: targets.hit, snippet: HIT_SNIPPET },
                { id: targets.miss, snippet: MISS_SNIPPET },
                { id: targets.boundary, snippet: BOUNDARY_SNIPPET },
              ],
              hasMore: false,
            },
          },
        }),
      })
      return
    }
    const response = await requestRoute.fetch()
    const body = await response.text()
    if (!method.startsWith('session/list')) {
      await requestRoute.fulfill({ response, body })
      return
    }
    stats.listCalls += 1
    const parsed = JSON.parse(body) as {
      result?: {
        value?: {
          items?: {
            sessionId?: string
            title?: string
            blank?: boolean
            projections?: { asOfSeq?: number; values?: Record<string, unknown> }
          }[]
        }
      }
    }
    for (const item of parsed.result?.value?.items ?? []) {
      const title = item.sessionId === undefined ? undefined : titles[item.sessionId]
      if (title === undefined) continue
      // 会话标题的**权威位置**是 list 回执里的 `projections.values.title`（官方
      // `buildListSnapshot` 就是拿 `projectionStore.get("title")` 当 `entry.title`，
      // 商店再经 `displayTitleOf` 把它变成 `displayTitle`），所以只改顶层 `title`
      // 是改不动的。顶层那两个字段一并写上，让回执在两种读法下都自洽。
      item.projections = { ...(item.projections ?? {}), values: { ...(item.projections?.values ?? {}), title } }
      // 序号也要抬：投影存储按序号取新，而控制流基线常常比这份回执先到（#158 实测共享实例
      // 上基线 162ms、这份回执 538ms），那一刻真标题已经以网关那个序号落进存储，只换值不换
      // 序号会被原样忽略（F-45 的同类问题记在 #154）。抬大之后这份回执就是更新的那一份。
      item.projections.asOfSeq = Math.max(item.projections.asOfSeq ?? 0, 0) + 1_000_000
      item.title = title
      // 空白会话会被渲染成「新会话」兜底文案（`displayTitle` 那一条），夹具这几条要看得见标题，
      // 所以一并翻成非空白。这只改夹具覆盖到的几条，不动任何界面判定口径。
      item.blank = false
      stats.titled += 1
    }
    await requestRoute.fulfill({ response, body: JSON.stringify(parsed) })
  })
}

/**
 * 装流侧夹具（一个 mux handler 管两条流，避免两条 `routeWebSocket` 抢同一条连接）：
 *
 * - `workspace/follow`：基线帧换成三棵**合成**工作区（标题受控、成员是页面上挑出来的真会话），
 *   其余工作区帧一律丢掉——否则真工作区会从增量里回来，成员归属就不确定了。与 F-21 的
 *   `installWorkspaceFixture` 同一套做法（那边也是三棵，这边标题与成员受控）。
 * - `session/control`：基线帧里那三条靶子的 `title` 一并换成受控文案（其余会话原样）。
 *   为什么非补不可：控制流基线是**不看序号**的那一路（`replaceControlBaseline` 对基线里的
 *   每条会话 `truncate` + `seed`，把整块投影换掉）——#158 实测：只补 `session/list` 时，
 *   基线后到就把抬过序号的值照样换回真标题（A/B 现场：把扣住的基线放行，那一行立刻从夹具
 *   文案变回网关的真标题，而基线里没有的第三条不受影响）。**基线块的 `asOfSeq` 不动**：
 *   基线里其余投影键（goal / tokenUsage / contextPressure…）不是夹具该碰的，抬序号会把它们
 *   一起钉死；`truncate` + `seed` 本来就不看序号，只换值就够。
 */
async function installMuxFixtures(
  page: OpenedPage['page'],
  targets: { readonly hit: string; readonly miss: string; readonly boundary: string },
  titles: FixtureTitles,
  stats: FixtureStats,
): Promise<void> {
  const members = targets
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
      const text = String(message)
      let frame:
        | {
            streamId?: string
            type?: string
            value?: {
              type?: string
              value?: {
                items?: unknown[]
                archivedSessionIds?: unknown
                projections?: Record<string, { values?: Record<string, unknown> }>
              }
            }
          }
        | undefined
      try {
        frame = JSON.parse(text) as typeof frame
      } catch {
        frame = undefined
      }
      const endpoint = frame?.streamId === undefined ? undefined : endpoints.get(frame.streamId)
      if (endpoint === 'session/control') {
        const payload = frame?.value
        if (frame?.type !== 'item' || payload?.type !== 'baseline') {
          // 增量帧（projection / jobs / queues）照原样转发：那几条路按序号取新，夹具抬过
          // 序号的那份仍是最新的那一份。
          socket.send(message)
          return
        }
        stats.controlFrames += 1
        let patched = 0
        for (const [sessionId, block] of Object.entries(payload.value?.projections ?? {})) {
          const title = titles[sessionId]
          if (title === undefined) continue
          block.values = { ...(block.values ?? {}), title }
          patched += 1
        }
        if (patched === 0) {
          // 基线里一条靶子都没有（空闲/全新实例上就是这样）：原样转发，一个字节都不动。
          socket.send(message)
          return
        }
        stats.controlTitles += patched
        socket.send(JSON.stringify(frame))
        return
      }
      if (endpoint !== 'workspace/follow') {
        socket.send(message)
        return
      }
      const payload = frame?.value
      if (frame?.type === 'item' && payload?.type === 'baseline' && payload.value !== undefined) {
        payload.value.items = [
          { workspaceId: 'lab-hit-ws', path: '/lab/hit', title: HIT_WORKSPACE, sessionIds: [members.hit], updatedAt: new Date(0).toISOString() },
          { workspaceId: 'lab-miss-ws', path: '/lab/miss', title: MISS_WORKSPACE, sessionIds: [members.miss], updatedAt: new Date(0).toISOString() },
          { workspaceId: 'lab-boundary-ws', path: '/lab/boundary', title: BOUNDARY_WORKSPACE, sessionIds: [members.boundary], updatedAt: new Date(0).toISOString() },
        ]
        // 归档集合清空：合成工作区引用的是套件挑的可见会话，留着真归档集合只会让「谁在树里」
        // 变得不确定（真网关只读，这里只改页面收到的帧）。
        payload.value.archivedSessionIds = []
        stats.workspaceFrames += 1
        socket.send(JSON.stringify(frame))
        return
      }
      // 非基线帧（upsert / order / remove / archived）一律不转发。
    })
  })
}

// ---------------------------------------------------------------------------
// 读数
// ---------------------------------------------------------------------------

interface PartReading {
  /** 这一处的完整文字（`textContent`，与加不加高亮无关）。 */
  text: string
  /** 这一处里 `<mark>` 的文字，按文档顺序。 */
  marks: string[]
  /**
   * 这一处的子节点按「文本 / 标记」切开的样子（`text:…` / `mark:…`，注释节点不算）。
   * 用来判「相邻两处标记之间没有夹缝」与「标记之外的文字一字不丢」——只数标记体现不出这两件事。
   */
  segments: string[]
  /** 这一处的文字色（解析后的 rgb(...)，用来判「整段没被染色」）。 */
  color: string
  fontSize: string
  /** 容器自身有没有被省略号截断（`scrollWidth > clientWidth`）。 */
  clipped: boolean
  scrollWidth: number
  clientWidth: number
  /** 盒子左右缘（判「没被 mark 挤出去」）。 */
  left: number
  right: number
}

interface RowReading {
  id: string
  /** 行里 `<mark>` 的总数。 */
  markCount: number
  /** 行里所有 `<mark>` 的文字（按文档顺序，跨三处连着排）。 */
  markTexts: string[]
  /** 行里所有 `<mark>` 是不是都叫这个名字（自有类名）。 */
  markClasses: string[]
  /** 行里所有 `<mark>` 的标签名（判语义标签）。 */
  markTags: string[]
  title: PartReading | null
  workspace: PartReading | null
  snippet: PartReading | null
}

/** 读一遍结果行（按会话 id 取），三处的 mark 分开数、分开记文字。 */
async function readRows(page: OpenedPage['page']): Promise<RowReading[]> {
  return await page.evaluate(
    ([rowSel, titleSel, workspaceSel, snippetSel]) => {
      const round = (value: number): number => Math.round(value * 100) / 100
      const readPart = (node: Element | null): PartReading | null => {
        if (node === null) return null
        const style = getComputedStyle(node)
        const rect = node.getBoundingClientRect()
        return {
          text: node.textContent ?? '',
          marks: Array.from(node.querySelectorAll('mark')).map((mark) => mark.textContent ?? ''),
          // 注释节点不算内容：React 在文本子节点之间偶尔会插一个空的注释节点。
          segments: Array.from(node.childNodes)
            .filter((child) => child.nodeType !== 8)
            .map((child) => `${child.nodeName === 'MARK' ? 'mark' : 'text'}:${child.textContent ?? ''}`),
          color: style.color,
          fontSize: style.fontSize,
          clipped: node.scrollWidth > node.clientWidth,
          scrollWidth: node.scrollWidth,
          clientWidth: node.clientWidth,
          left: round(rect.left),
          right: round(rect.right),
        }
      }
      return Array.from(document.querySelectorAll(rowSel)).map((row) => {
        const marks = Array.from(row.querySelectorAll('mark'))
        return {
          id: row.getAttribute('data-dshone-tree-session') ?? '',
          markCount: marks.length,
          markTexts: marks.map((mark) => mark.textContent ?? ''),
          markClasses: marks.map((mark) => mark.getAttribute('class') ?? ''),
          markTags: marks.map((mark) => mark.tagName),
          title: readPart(row.querySelector(titleSel)),
          workspace: readPart(row.querySelector(workspaceSel)),
          snippet: readPart(row.querySelector(snippetSel)),
        }
      })
    },
    [ROW, TITLE, WORKSPACE, SNIPPET] as const,
  )
}

/** 把 `<mark>` 自己的计算样式读出来（字重 / 颜色 / 底色）。 */
async function readMarkStyle(
  page: OpenedPage['page'],
): Promise<{ fontWeight: string; color: string; backgroundColor: string; tokenColor: string } | null> {
  return await page.evaluate(
    ([rowSel, token]) => {
      const mark = document.querySelector(`${rowSel} mark`)
      if (mark === null) return null
      const style = getComputedStyle(mark)
      const host = document.querySelector('[data-shell="dsh-one-sidebar"]') ?? document.body
      const probe = document.createElement('span')
      probe.style.color = `var(${token})`
      host.appendChild(probe)
      const tokenColor = getComputedStyle(probe).color
      probe.remove()
      return { fontWeight: style.fontWeight, color: style.color, backgroundColor: style.backgroundColor, tokenColor }
    },
    [ROW, MARK_TOKEN] as const,
  )
}

/**
 * 等结果行落定（回执 → 插件 → 快照 → 重渲染是一条异步链）。
 *
 * `done` 是「可以停了」的判据：搜索有**两条独立的路**——本地标题 / 工作区名命中是同步的，
 * 内容搜索那一路要等 `SEARCH_DEBOUNCE_MS` 之后才发、回来才带得回片段。只等「有行」会在
 * 内容结果到之前就收手，读到「标题高亮有了、片段还没有」的中间态。所以本套件等的是
 * 「那条**只有内容搜索才带得回来**的行出现了」，超时也照旧往下判（读数会如实报出来）。
 */
async function waitForRows(
  page: OpenedPage['page'],
  done: (rows: RowReading[]) => boolean,
  timeoutMs = 8_000,
): Promise<RowReading[]> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const rows = await readRows(page)
    if (done(rows) || Date.now() > deadline) return rows
    await page.waitForTimeout(200)
  }
}

/** 打出那条查询（搜索栏 #132 起默认收起，先点开放大镜）。 */
async function search(page: OpenedPage['page'], query: string): Promise<void> {
  if ((await page.locator(SEARCH_INPUT).count()) === 0) {
    await page.click(SEARCH_BUTTON)
    await page.waitForTimeout(250)
  }
  await page.fill(SEARCH_INPUT, query)
}

/** 窄 / 中 / 宽三档下的横向几何（行没被挤出去、页面没横向溢出）。 */
async function readWidthFacts(page: OpenedPage['page']): Promise<{
  rowRight: number
  listRight: number
  rowScrollOverflow: number
  docScrollOverflow: number
  rowWidth: number
}> {
  return await page.evaluate(([rowSel]) => {
    const round = (value: number): number => Math.round(value * 100) / 100
    const row = document.querySelector(rowSel)
    const list = document.querySelector('.dshOneTree_listArea') ?? document.querySelector('.dshOneTree_list')
    return {
      rowRight: row === null ? Number.NaN : round(row.getBoundingClientRect().right),
      listRight: list === null ? Number.NaN : round(list.getBoundingClientRect().right),
      rowScrollOverflow: row === null ? 0 : row.scrollWidth - row.clientWidth,
      docScrollOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      rowWidth: row === null ? 0 : round(row.getBoundingClientRect().width),
    }
  }, [ROW] as const)
}

export const SEARCH_HIT_HIGHLIGHT_SUITE: LabSuite = {
  id: 'F-49',
  phase: 'new-feature',
  name: '搜索命中高亮（#166）：关键词在标题 / 工作区名 / 命中片段三处**每一处都标**出来（SEARCH-HIT-HIGHLIGHT 套件）',
  expect:
    '真装配页（真网关**只读** + 假宿主 + 页内夹具造受控命中——标题那一路**两条路都补**：`session/list` 回执与 `session/control` 基线帧，因为后者不看序号、只补前者在有使用者的实例上必输（#158））上，搜索命中的三处高亮成立：① **三处各自把每一处命中都标出来（#166）**——一条命中行的标题（4 处）、工作区名（2 处）、片段（2 处）里的命中词**一处不漏**地包成 `<mark>`，标记文字就是原文里那一段（原文大小写照旧，不被查询串的大小写覆盖），顺序与出现顺序一致，整行的标记数与三处之和相等，三处的容器文字一字不差（高亮只加标记、不改文字），标题的子节点按「文本 / 标记」切开后与预期逐段相等（相邻那两处之间没有夹缝、其余文字一字不丢）；② **大小写不敏感**——查询串大小写写乱也照样命中（三处文案里那个词的原始大小写各不相同，标出来的是各自原文那一段）；③ **重叠与相邻这条边界**——换一个自己和自己重叠的查询词（`aba`）再搜一遍：`ababa` 里那两处互相压着的只算**第一处**（从命中那一段的末尾继续往后找），`abaaba` 里紧挨着的那两处**都标**，整条标题恰好 3 处且最后两处之间一个未标字符都没有（切分逐段相等），同一行里不含这个查询词的工作区名与片段一处都不标；④ **非命中行一处 `<mark>` 都没有**——宿主内容搜索带回来的另一条行（标题 / 工作区名 / 片段都不含查询串）整行零标记，搜索态之外的树行同样零标记；⑤ **标记是 `<mark>` 语义标签**、带自有类名，样式是**加粗 + 变色 + 无底色**（底色透明、字重 600），颜色解析值 = 官方 token `--dsw-alias-state-business-primary` 的解析值且与容器文字色不同，而**容器本身没被染色**（片段仍是官方那枚次要文字色）；⑥ **三档宽度（260/340/500）下不溢出、截断照旧**——行不横向溢出、不越出列表区右缘、页面无横向滚动，片段仍是 `nowrap + ellipsis` 并在窄档下**真的被截断**，高亮不把它撑破。全程零 pageerror。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const opened = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { width: 380, height: 900 })
    const { page } = opened
    try {
      await page.waitForSelector(route('sidebar').readySelector)

      // ---- ① 从页面上挑三条**真会话**当夹具的靶子（接不上就没有行，断言当场红） ----
      // 三条各司其职：命中行（三处都会标）、非命中行（一处都不该标）、边界行（重叠与相邻那一条）。
      // 侧栏首开只展开「当前会话所在的那一组」（#151 的默认值），所以先把树展开全，免得三条靶子
      // 全挤在同一个工作区里（那条边界要跨工作区也成立）。顶栏那一枚是**切换**：先把「还有展开着
      // 的」点成全折叠、再点一下就是全展开（`data-dshone-tree-collapsed` 就是当前态）。
      const toggleAll = '[data-dshone-tree-action="collapse-all"]'
      if ((await page.getAttribute(toggleAll, 'data-dshone-tree-collapsed')) !== 'true') {
        await page.click(toggleAll)
        await page.waitForTimeout(250)
      }
      await page.click(toggleAll)
      await page.waitForTimeout(400)
      const candidates = await page.evaluate(() =>
        // 挑「有相对时间」的那些行：空白会话占位行（当前那条「新会话」）没有时间，夹具虽然会把它
        // 翻成非空白，但选真会话更贴近它平时那一行。
        Array.from(document.querySelectorAll('[data-dshone-tree-row="session"]'))
          .filter((row) => row.querySelector('.dshOneTree_time') !== null)
          .map((row) => row.getAttribute('data-dshone-tree-session') ?? '')
          .filter((id) => id !== ''),
      )
      check.fact(`展开全之后树里可当靶子的真会话 ${String(candidates.length)} 条：${candidates.slice(0, 3).join(', ')}`)
      check.ok('树里至少有 3 条真会话可供夹具当靶子（命中 / 非命中 / 边界各一条）', candidates.length >= 3, JSON.stringify(candidates))
      if (candidates.length < 3) return screenshots
      const hitId = candidates[0] ?? ''
      const missId = candidates[1] ?? ''
      const boundaryId = candidates[2] ?? ''

      const stats: FixtureStats = { searchCalls: 0, listCalls: 0, titled: 0, workspaceFrames: 0, controlFrames: 0, controlTitles: 0 }
      const fixtureTitles = { [hitId]: HIT_TITLE, [missId]: MISS_TITLE, [boundaryId]: BOUNDARY_TITLE }
      const targets = { hit: hitId, miss: missId, boundary: boundaryId }
      await installApiFixtures(page, fixtureTitles, targets, stats)
      await installMuxFixtures(page, targets, fixtureTitles, stats)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector(route('sidebar').readySelector, { timeout: 40_000 })
      await page.waitForTimeout(2_500)
      check.fact(
        `夹具：session/list 回执 ${String(stats.listCalls)} 次、换掉标题 ${String(stats.titled)} 条；` +
          `session/control 基线帧 ${String(stats.controlFrames)} 次、其中换掉标题 ${String(stats.controlTitles)} 条（这一路不看序号，基线里带着的靶子只有它也补得上）；` +
          `workspace/follow 基线帧换掉 ${String(stats.workspaceFrames)} 次`,
      )
      check.ok('标题夹具接上了（三条靶子会话都换成了受控文案）', stats.titled >= 3, String(stats.titled))
      check.ok('工作区夹具接上了（基线帧被换成三棵合成工作区）', stats.workspaceFrames > 0, String(stats.workspaceFrames))

      // ---- ② 打查询 → 拿结果行（等到内容搜索那一路也回来，见 `waitForRows`） ----
      await search(page, QUERY)
      const rows = await waitForRows(page, (list) => list.some((row) => row.id === missId))
      const hit = rows.find((row) => row.id === hitId) ?? null
      const miss = rows.find((row) => row.id === missId) ?? null
      const boundaryUnderMain = rows.find((row) => row.id === boundaryId) ?? null
      check.fact(
        `结果行 ${String(rows.length)} 条：命中行=${hit === null ? '缺' : `${String(hit.markCount)} 处标记`}、非命中行=${miss === null ? '缺' : `${String(miss.markCount)} 处标记`}、边界行=${boundaryUnderMain === null ? '缺' : `${String(boundaryUnderMain.markCount)} 处标记`}（session/search 被夹具换了 ${String(stats.searchCalls)} 次）`,
      )
      check.ok('夹具那条内容搜索回执真的走过（没走过的话下面全是空读数）', stats.searchCalls > 0, String(stats.searchCalls))
      check.ok('受控的命中行在结果里', hit !== null, JSON.stringify(rows.map((row) => row.id)))
      if (hit === null) return screenshots
      check.ok('受控的非命中行也在结果里（它是宿主内容搜索带回来的）', miss !== null)
      check.ok('受控的边界行也在结果里（夹具第三条接上了，它由下面那一段用它自己的查询词量）', boundaryUnderMain !== null)

      // ---- ③ 三处各自把每一处命中都标出来、文字就是原文那一段 ----
      check.eq('命中行标题：完整文字一字不差（高亮只加标记、不改文字）', hit.title?.text, HIT_TITLE)
      check.eq('命中行标题：4 处全标了，顺序与原文一致、每处标的是原文那一段（大小写照原文）', hit.title?.marks, TITLE_MARKS)
      check.eq(
        '命中行标题：切分成「文本 / 标记」——相邻那两处之间没有夹缝，其余文字一字不丢',
        hit.title?.segments,
        TITLE_SEGMENTS,
      )
      check.eq('命中行工作区名：完整文字一字不差', hit.workspace?.text, HIT_WORKSPACE)
      check.eq('命中行工作区名：两处都标（查询串大小写写乱也命中，标的是原文那一段）', hit.workspace?.marks, WORKSPACE_MARKS)
      check.eq('命中行片段：完整文字一字不差', hit.snippet?.text, HIT_SNIPPET)
      check.eq('命中行片段：长片段里两处都标（不是只标开头那一处）', hit.snippet?.marks, SNIPPET_MARKS)
      check.eq(
        '命中行整行标记文字按文档顺序 = 三处各自那几段（标题 → 工作区名 → 片段）',
        hit.markTexts,
        HIT_MARKS,
      )
      check.eq(
        `命中行整行恰好 ${String(HIT_MARKS.length)} 处标记（标题 ${String(TITLE_MARKS.length)} + 工作区名 ${String(WORKSPACE_MARKS.length)} + 片段 ${String(SNIPPET_MARKS.length)}，多一处少一处都算红）`,
        hit.markCount,
        HIT_MARKS.length,
      )
      check.eq('三处标记都是 <mark> 语义标签（读屏软件认得）', hit.markTags, HIT_MARKS.map(() => 'MARK'))
      check.eq(
        '三处标记都带自有类名（样式不靠元素选择器，标签语义与呈现分开）',
        hit.markClasses,
        HIT_MARKS.map(() => 'dshOneTree_searchMark'),
      )

      // ---- ④ 非命中行一处都没有 ----
      check.ok('非命中行在结果里且零标记（标题 / 工作区名 / 片段三处都数了）', miss !== null && miss.markCount === 0, JSON.stringify(miss))
      check.eq('非命中行的文字照旧完整（不是被抹掉了）', [miss?.title?.text, miss?.workspace?.text, miss?.snippet?.text], [MISS_TITLE, MISS_WORKSPACE, MISS_SNIPPET])

      // ---- ⑤ 样式：加粗 + 变色 + 无底色；容器本身没被染色 ----
      const markStyle = await readMarkStyle(page)
      check.ok('读到了标记的计算样式', markStyle !== null)
      check.eq('标记加粗（沿用侧栏里已有的 600 档，与未读行的加粗同一档）', markStyle?.fontWeight, '600')
      check.ok(
        '标记无底色（旧侧栏那一版的处置：用户要的是「加底色不好看」）',
        markStyle?.backgroundColor === 'rgba(0, 0, 0, 0)' || markStyle?.backgroundColor === 'transparent',
        JSON.stringify(markStyle),
      )
      check.ok(
        '标记文字色 = 官方 token --dsw-alias-state-business-primary 的解析值',
        markStyle !== null && markStyle.color === markStyle.tokenColor,
        JSON.stringify(markStyle),
      )
      check.ok(
        '标记文字色与它所在的容器文字色不同（真的标出来了，不是同色）',
        markStyle !== null && hit.snippet !== null && markStyle.color !== hit.snippet.color,
        JSON.stringify({ mark: markStyle?.color, container: hit.snippet?.color }),
      )
      check.eq(
        '片段容器本身没被染色（只标命中词，不整段变色）',
        hit.snippet?.color,
        await page.evaluate(() => {
          const host = document.querySelector('[data-shell="dsh-one-sidebar"]') ?? document.body
          const probe = document.createElement('span')
          probe.style.color = 'var(--dsw-alias-label-secondary)'
          host.appendChild(probe)
          const value = getComputedStyle(probe).color
          probe.remove()
          return value
        }),
      )
      screenshots.push(await shot(ctx, page, 'search-hit-highlight'))

      // ---- ⑥ 三档宽度：不溢出、截断照旧 ----
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 })
        await page.waitForTimeout(300)
        const facts = await readWidthFacts(page)
        const reading = (await readRows(page)).find((row) => row.id === hitId) ?? null
        check.fact(`@${String(width)} 行=${String(facts.rowWidth)} 行右缘=${String(facts.rowRight)} 列表右缘=${String(facts.listRight)} 片段 scrollWidth/clientWidth=${String(reading?.snippet?.scrollWidth ?? -1)}/${String(reading?.snippet?.clientWidth ?? -1)}`)
        check.ok(
          `@${String(width)} 结果行不横向溢出（scrollWidth ≤ clientWidth + 1）`,
          facts.rowScrollOverflow <= 1,
          `溢出 ${String(facts.rowScrollOverflow)}px`,
        )
        check.ok(
          `@${String(width)} 结果行不越出列表区右缘`,
          facts.rowRight <= facts.listRight + 1,
          `行右缘 ${String(facts.rowRight)} / 列表右缘 ${String(facts.listRight)}`,
        )
        check.ok(`@${String(width)} 页面没有横向滚动`, facts.docScrollOverflow <= 1, `溢出 ${String(facts.docScrollOverflow)}px`)
        check.eq(
          `@${String(width)} 高亮没把标记弄丢（仍是 ${String(HIT_MARKS.length)} 处）`,
          reading?.markCount,
          HIT_MARKS.length,
        )
        const truncation = await page.evaluate(
          ([rowSel, snippetSel]) => {
            const snippet = document.querySelector(`${rowSel} ${snippetSel}`)
            if (snippet === null) return null
            const style = getComputedStyle(snippet)
            return { textOverflow: style.textOverflow, whiteSpace: style.whiteSpace, overflow: style.overflow, clipped: snippet.scrollWidth > snippet.clientWidth }
          },
          [ROW, SNIPPET] as const,
        )
        check.eq(
          `@${String(width)} 片段仍是官方那条省略号路（nowrap + ellipsis + hidden）`,
          [truncation?.textOverflow, truncation?.whiteSpace, truncation?.overflow],
          ['ellipsis', 'nowrap', 'hidden'],
        )
        check.ok(
          `@${String(width)} 这么长的片段在窄档下真的被截断（高亮没把它撑破）`,
          width >= 340 || truncation?.clipped === true,
          JSON.stringify(truncation),
        )
      }
      await page.setViewportSize({ width: 380, height: 900 })
      await page.waitForTimeout(200)
      screenshots.push(await shot(ctx, page, 'search-hit-highlight-narrow'))

      // ---- ⑦ 边界：重叠只算一次、相邻两处都标（换一个自己和自己重叠的查询词再搜一遍） ----
      await page.fill(SEARCH_INPUT, BOUNDARY_QUERY)
      const boundaryRows = await waitForRows(page, (list) => list.some((row) => row.id === boundaryId))
      const boundary = boundaryRows.find((row) => row.id === boundaryId) ?? null
      check.ok(
        '换成边界查询后边界行仍在结果里（它这一轮的查询词由本地标题那一路命中）',
        boundary !== null,
        JSON.stringify(boundaryRows.map((row) => row.id)),
      )
      check.eq('边界行标题：完整文字一字不差', boundary?.title?.text, BOUNDARY_TITLE)
      check.eq(
        '边界行标题：重叠那一处只算一次、紧挨着的那两处都标（共 3 处，顺序按原文）',
        boundary?.title?.marks,
        BOUNDARY_MARKS,
      )
      check.eq(
        '边界行标题：切分对得上——重叠的那一处不再参与下一次匹配（中间留着 `ababa` 的尾巴），末尾两处之间一个未标字符都没有',
        boundary?.title?.segments,
        BOUNDARY_SEGMENTS,
      )
      check.eq('边界行整行就这 3 处（没有多标出来一处）', boundary?.markCount, BOUNDARY_MARKS.length)
      check.eq('边界行工作区名不含这个查询词：一处标记都没有（同一行里的对照）', boundary?.workspace?.marks, [])
      check.eq('边界行片段不含这个查询词：一处标记都没有（同一行里的对照）', boundary?.snippet?.marks, [])
      screenshots.push(await shot(ctx, page, 'search-hit-highlight-boundary'))

      // ---- ⑧ 搜索态之外的树行没有标记（高亮只属于搜索结果行） ----
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
      const treeMarks = await page.evaluate(() => ({
        searchArea: document.querySelector('[data-dshone-tree="search"]') !== null,
        marks: document.querySelectorAll('[data-dshone-tree="groups"] mark').length,
        rows: document.querySelectorAll('[data-dshone-tree="groups"] [data-dshone-tree-row="session"]').length,
      }))
      check.ok('Esc 退出搜索态后树体回来（不是搜索区常驻）', !treeMarks.searchArea && treeMarks.rows > 0, JSON.stringify(treeMarks))
      check.eq('树里的会话行一处标记都没有（高亮只出现在搜索结果行上）', treeMarks.marks, 0)

      check.eq('搜索命中高亮套件全程零 pageerror', withoutKnownNoise(opened.capture.pageErrors).real, [])
    } finally {
      await opened.context.close()
    }
    return screenshots
  },
}
