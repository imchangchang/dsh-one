/**
 * 沙箱 srcdoc 帧的处境与官方页一致（#185 立、#193 补自足的夹具卡层、#196 补两个属性写入顺序
 * 那一维、**#188 把判据改成「帧内脚本真的执行」这一组**）。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与 `sidebarHScrollSuites.ts` /
 * `comboTopbarRightInsetSuites.ts` 同一条：那个文件是本批开发的合入热点，新套件放外面能
 * 少一半冲突面。注册方式是在 `suites.ts` 的 `SUITES` 末尾追加一项。
 *
 * ## 这一条抓的是什么
 *
 * 用户实测（#185）：同一条 HTML 预览卡（`@dsh-external/dsh-visualize` 渲染的
 * `<iframe sandbox="allow-scripts" srcdoc="…">`，卡片头是「大图对比（480×480） +
 * HTML 路径」）在**官方 web 页**里按内容撑开、在 **VS Code 装配页的对话区**里被压成
 * 一条窄框（只露出内容最上面一小条 + 自带滚动条）。
 *
 * 根因是**装配页当时自带的那份 CSP**（#185 实测）：Chromium 把本页的 CSP 继承给 `srcdoc`
 * 帧（`srcdoc` 是 local scheme，帧文档没有自己的来源可寻址），于是本页那句
 * `script-src 'nonce-…'` 也管到帧里面去；而帧的 HTML 是插件自己生成的、拿不到本页 nonce，
 * 帧内内联脚本**一律被判违规**。这类卡片的撑高协议恰好全靠一句帧内内联脚本（量
 * `document.documentElement.scrollHeight` 再 `parent.postMessage` 回父页），脚本一被挡住，
 * 卡片就永远停在这个插件自己的最小高度上（48px）——官方网关页整页**没有 CSP**，同一句脚本
 * 在官方页照常执行。
 *
 * #185 当时用「给隔离沙箱帧补本页 nonce」修掉了它（`pageHtml.ts` 里的 `srcdocNonceJs`）。
 * **#188 起那份 CSP 本身去掉了**（用户拍板：装配页与官方页同处境，见 `docs/architecture.md`
 * 的「日志与安全细节」一节里那条 webview CSP），补 nonce 那层随之一起下线——它当年唯一的用处
 * 就是匹配我们自己那条 `script-src`（理由写在 `pageHtml.ts` 原处）。
 *
 * 于是本套件按 #188 换口径：判**用户看到的结果**——帧内脚本照常执行、卡片按内容撑开、与官方页
 * 同值、本页一个字节都不改插件写下的帧；「是否带 nonce」降级为**事实记录**（今天两侧都不带，
 * 报告里逐条记清）。判据一条没删：原来那几条非正面的（同源帧 / 不带 `sandbox` 的帧不许被改、
 * 改档之后不许留痕）换成同一件事的更严版本——**本页对所有帧的 `srcdoc` 都一个字节不动**，
 * 那才是与官方页同处境的直接含义。
 *
 * ## 套件怎么判（三层，都不许写成「高度 > 0」那种橡皮图章）
 *
 * **① 机制层（自足）**：往两个页面里各插**七档探针帧**——六档判「帧内脚本真的执行」，一档
 * 判「帧里的内联事件属性真的响应」。判据：
 *   - **两侧都没有 CSP meta**：本页那份是 #188 去掉的，官方页本来就没有（这一条从「我们知道
 *     官方页没有」升级成对两侧的断言）；
 *   - **六档探针帧的内联脚本全部执行**（各自上报内容高度 500，并逐帧与官方页同值 ±2px）：
 *     改前只有两个隔离沙箱帧跑得起来，同源帧与不带 `sandbox` 的帧被本页 `script-src` 挡住——
 *     这一组读数就是「CSP 走了」的可执行版本；
 *   - **本页一个字节都不改第三方帧的 `srcdoc`**（逐帧与插件写下的那一份逐字相等）：改前六帧
 *     全被打上本页 nonce（#185 的修法），现在与官方页一样原样不动；
 *   - **帧里的内联事件属性（`onclick=`）真的响应**：点一下父页收到上报，官方页同样收到。这是
 *     #188 里那一类「按 CSP 规则只能靠 `'unsafe-inline'` 放行、nonce/hash 对它无效」的差异；
 *   - **远端资源不再被本页挡**（#186 里那条 F-09 的红就是它）：页面上挂一个非本机源的图片，
 *     判「浏览器真的去发那条请求了」（改前 `img-src` 只放行 loopback 与 data:/blob:，请求根本
 *     发不出去、页面上只多一条 CSP 违规）＋「全程零 CSP 违规」。
 *
 * **② 夹具卡层（自足，默认跑法里就覆盖用户报的那一层）**：见下面「夹具卡」那一节。
 *
 * **③ 真实卡片层（只在 `--gateway` 连外部实例时跑）**：在同一台网关上找**同一批** HTML
 * 预览卡（两侧按 `iframe@sandbox` + 非空 `srcdoc` 认，按 `title` 配对），先让帧在**可见**
 * 状态下重新载入（先点开它所在的 `turn-process` 折叠组，再重写一次 `srcdoc` 属性——同一
 * 动作两侧各做一遍），然后逐卡比较：卡片高度 = 帧文档的内容高度（±2px）、卡片高度 =
 * 官方页那一份（±2px，两侧先按视口把卡片宽度调到一致，宽度不同内容高度本来就不同）。
 * 「装配页那份带 nonce 而官方页那份不带」当年是这一层的一条断言，#188 起降级为事实
 * （并同时记下两侧 `srcdoc` 是否逐字相同）。
 *
 * **为什么真实卡片层只在外部实例模式跑**：那一层要当天网关上有 `@dsh-external/dsh-visualize`
 * 这类第三方插件渲染出来的卡片，而默认跑法的隔离实例里只有官方插件与我们的插件——它在那
 * 里一条断言都跑不出来，#177 之后就成了「默认跑法静默少 10 条」（#193 立这条的地方）。
 * 所以它的判据只在**明确连外部实例**（`--gateway`，例如用户日常那台 3080，只读）时生效，
 * 默认跑法里记一条事实说明它没跑——**断言数因此不再随当天网关有没有卡片而变**（#193 的
 * 验收项）。用户报的那个坏法由 ② 的夹具卡在默认跑法里钉着。
 *
 * ## 夹具卡（#193）：为什么它算「同一层」的证据
 *
 * 夹具卡不是随便造一张 iframe，而是**按 `@dsh-external/dsh-visualize` 的同形件**造的
 * （出处：用户 profile 里装的 `~/.dsh/profiles/web/node_modules/@dsh-external/dsh-visualize`
 * 的 `src/shell.ts` 与 `src/client/VisualizeCard.tsx`，版本 0.1.2）。同形的关键点逐条列出：
 *
 * - **帧的沙箱声明**：`sandbox="allow-scripts"` 一个 token，不带 `allow-same-origin`
 *   ——正是这类卡片的写法（#196 那一维里也是本页当年唯一会补 nonce 的那一档）。
 * - **帧文档的形状**：自带一份 `<meta http-equiv="Content-Security-Policy">`（含
 *   `script-src 'unsafe-inline'`）、内联 `<style>`、内容片段，末尾一句内联 `<script>`。
 *   帧自己那份 CSP 允许内联脚本，但**当年本页的 CSP 会继承进来一起判**——这正是坏点所在，
 *   少了这份自带 CSP 就假不出真插件的处境（今天两侧都没有政策可违，这一份仍然照真插件写）。
 * - **帧内那句脚本**：`post()` 量 `document.documentElement.scrollHeight` 再
 *   `parent.postMessage({type:'dsh-visualize:height', token, height}, '*')`，并
 *   `new ResizeObserver(post).observe(document.documentElement)` + `addEventListener('load', post)`
 *   ——与真插件的 `heightReporter` 逐句同形（连消息类型都用它那个常量值）。
 * - **父页那份卡片的协议**：高度状态从**插件自己的最小高度 48px** 起（真插件
 *   `MIN_HEIGHT = 48`），只有收到 `type` 与 `token` 都对得上的上报才
 *   `max(48, min(ceil(height), 上限))` 地改写 `iframe.style.height`（上限照抄它的
 *   `HEIGHT_CAP.inline = 800`）。**收不到上报就永远停在 48px**——#185 的坏法就是这个。
 * - **挂载点**：挂在官方对话区里（`[data-conversation-scroll]` 的
 *   `[data-slot="conversation.session"]` 槽位，官方 `ui-conversation` 渲染消息流的地方），
 *   与真卡片同处一条布局链（对话区滚动体 + 我们外框的 flex 列）——不是插在一个与对话区
 *   无关的浮层里。
 * - **写 `srcdoc` 的路径**：`frame.setAttribute('srcdoc', …)`，与 React 渲染
 *   `srcDoc` 属性走的是同一条路径。
 *
 * **为什么夹具的高度不随宽度变**：片段是一块固定高 600px 的方块（真插件的片段是图片，
 * 高度会随宽度变），所以两侧不必先对齐卡片宽度就能直接比高度——判据少一处抖动的来源，
 * 也把期望值钉成确定的数（内容高度 = 600 + 帧 document 的 body 内边距 8 = 608px）。
 *
 * **守卫/对照的同形件**：官方页上也挂同一张夹具卡。官方页整页没有 CSP，同一张卡在那里的
 * 结果就是「真插件在官方页里长什么样」的基准——装配页那一份必须与它同高（±2px），
 * 而 48px 那个坏法在两侧同值这条断言上也会当场露出来（官方页 608 / 装配页 48）。
 *
 * ## 再加上「两个属性谁先写」这一维（#196）
 *
 * React 按 JSX 属性顺序渲染（`.tsx` 里 `sandbox` 写在 `srcDoc` 前面），插件也可能反过来写，
 * 当年这两档在本页的命运不同（写 `srcdoc` 那一刻读到的 `sandbox` 还是 `null`，那一帧就漏补
 * 了 nonce、卡片又停回 48px）。这一维**仍然全部覆盖**，只是判的东西跟着 #188 换了：
 * 两种写属性顺序各有一档探针帧（倒序那一档的沙箱走令牌表 `frame.sandbox.add(...)`，只被属性
 * 观察看得见——两条写路径各钉一档）＋夹具卡层一张倒序卡。它们要判的是**结果一样**：
 * 都要挂进对话区、帧内脚本都要跑、都要按内容撑开、都不能停在 48px、都要与正序那张同高；
 * 而「本页补没补 nonce」当年那条断言，今天与其它帧一样只作事实记录（本页对所有帧一个字节
 * 都不改）。另有一帧先按隔离档写、读数之前再改用令牌表变成同源档——判据同样是「它的 `srcdoc`
 * 一个字节没被动过」。
 *
 * **判据不许放宽的地方**：夹具卡那一层的每一条都是**无条件**断言——挂不上、帧不报、卡
 * 停在最小高度，都会红；「当天网关上没有这类卡片」这件事**不再**能让任何一条悄悄消失。
 * #188 换口径时逐条核过：非正面的那几条（不许被改 / 不许留痕）换成了更严的一条
 * （本页一个字节都不改任何帧的 `srcdoc`），正面那几条（脚本执行、卡片撑开、两侧同值）
 * 一条没动，另新加了对两侧 CSP meta 与远端资源的判据。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { capturePage, openTreePage, type OpenedPage } from './harness.ts'
import { LAB_TREES, type LabTreeRoute } from './labServer.ts'
import { listSessions } from '../../src/server/dshRpc.ts'
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

/** 视口高度（固定住只为让读数可比；高度不参与判据）。 */
const VIEWPORT_HEIGHT = 900
/** chat 装配页起手宽度（真实卡片层比高度前会按官方那一份校正，见 matchCardWidth）。 */
const CHAT_START_WIDTH = 1050
/** 本套件自己造的帧（探针帧 + 夹具卡）的 `title` 前缀：真实卡片层认卡片时要跳过它们。 */
const LAB_FRAME_TITLE_PREFIXES = ['lab-185-', 'lab-188-', 'lab-193-', 'lab-196-'] as const

/** 一个帧是不是本套件自己造的（探针帧 / 夹具卡）。 */
function isLabFrame(title: string | null): boolean {
  const value = title ?? ''
  return LAB_FRAME_TITLE_PREFIXES.some((prefix) => value.startsWith(prefix))
}

// ---------------------------------------------------------------------------
// ① 机制层：探针帧（自证「帧内脚本真的执行」这条判据本身在场）
// ---------------------------------------------------------------------------

/** 帧的两个属性谁先写（#196）：`sandbox-first` 是 React 按 JSX 属性顺序渲染的结果，`srcdoc-first` 是反过来那一档。 */
type AttributeOrder = 'sandbox-first' | 'srcdoc-first'

/** 沙箱怎么写（#196）：`attribute` 走 `setAttribute`（React 与普通 DOM 都走它），`tokenList` 走令牌表（`frame.sandbox.add(...)`，**不**经过 `setAttribute`）。 */
type SandboxWrite = 'attribute' | 'tokenList'

/** 这一档帧是干什么用的：`report` = 帧内内联脚本上报内容高度（判「脚本真的执行了」），`inline` = 帧里挂一句内联事件属性（`onclick=`）等一次点击。 */
type ProbeKind = 'report' | 'inline'

interface ProbeSpec {
  name: string
  sandbox: string | null
  order: AttributeOrder
  via: SandboxWrite
  kind: ProbeKind
}

/**
 * 探针帧的七档（token 与 title 都按 name 派生，各帧各判各的）。前六档判「帧内脚本真的执行」：
 * 两档隔离沙箱帧差两维——写属性的顺序（`srcdoc-first` 那一档用令牌表写沙箱，因此把「谁先写」
 * 与「沙箱怎么写的」两条写路径各钉一档），另三档是同源与不带 `sandbox` 的写法（#188 之前它们
 * 的脚本被本页 `script-src` 挡住、今天照常执行——这正是这一轮要判的东西），再加一帧
 * `reclassified`（先按隔离档写、读数之前改用令牌表变成同源档，判「本页一个字节都不改它」）。
 * 最后一档 `inlineHandler` 判帧里的内联事件属性（#188 记的那一类差异）。
 */
const PROBE_SPECS: readonly ProbeSpec[] = [
  { name: 'isolated', sandbox: 'allow-scripts', order: 'sandbox-first', via: 'attribute', kind: 'report' },
  { name: 'isolatedReversed', sandbox: 'allow-scripts', order: 'srcdoc-first', via: 'tokenList', kind: 'report' },
  { name: 'sameOrigin', sandbox: 'allow-scripts allow-same-origin', order: 'sandbox-first', via: 'attribute', kind: 'report' },
  { name: 'sameOriginReversed', sandbox: 'allow-scripts allow-same-origin', order: 'srcdoc-first', via: 'tokenList', kind: 'report' },
  { name: 'bare', sandbox: null, order: 'sandbox-first', via: 'attribute', kind: 'report' },
  { name: 'reclassified', sandbox: 'allow-scripts', order: 'sandbox-first', via: 'attribute', kind: 'report' },
  { name: 'inlineHandler', sandbox: 'allow-scripts', order: 'sandbox-first', via: 'attribute', kind: 'inline' },
]

/** 判「帧内脚本真的执行」的那六帧（`report` 档）。 */
const REPORT_PROBES = PROBE_SPECS.filter((spec) => spec.kind === 'report')
/** 那一帧（`reclassified`）会被改成同源档：读数之前换档，判它的 `srcdoc` 有没有被动过。 */
const RECLASSIFIED_PROBE = 'lab-185-reclassified'
/** 内联事件属性那一帧（#188）的按钮 id 与上报类型。 */
const INLINE_PROBE = 'lab-188-inlineHandler'
const INLINE_BUTTON_ID = 'lab-188-go'
const INLINE_MESSAGE_TYPE = 'lab-188'
/** 远端资源探针用的两个地址：`.invalid` 顶级域保证解析不出来，只判「请求有没有被政策挡」。
 * 两个任务各用一件资源，对应 #188 里那两类差异的两条指令（`img-src` 与 `font-src`）。 */
const REMOTE_RESOURCE_PROBES = [
  { kind: 'image', id: 'lab-188-remote-image', url: 'https://lab-188.invalid/lab-188.png' },
  { kind: 'font', id: 'lab-188-remote-font', url: 'https://lab-188.invalid/lab-188.woff2' },
] as const
/** 探针帧的内容高度（判据按它算，不写「> 0」）。 */
const PROBE_CONTENT_HEIGHT = 500

/**
 * 一个探针帧的 srcdoc。`report` 档 = 500px 的方块 + 一句量高上报的内联脚本（token 按帧名
 * 派生，父页就能分开判「哪一帧上报了」）；`inline` 档 = 与真插件同形的一份帧文档（自带一份
 * 允许内联脚本的 CSP meta）+ 一个只靠内联事件属性 `onclick=` 反应的按钮。
 */
function probeSrcdoc(spec: ProbeSpec): string {
  if (spec.kind === 'inline') {
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:">
<title>lab-188 inline handler</title></head>
<body style="margin:0"><button id="${INLINE_BUTTON_ID}" style="width:120px;height:40px" onclick="parent.postMessage({type:'${INLINE_MESSAGE_TYPE}',token:'${INLINE_PROBE}'},'*')">go</button></body></html>`
  }
  return (
    `<body style="margin:0"><div style="width:120px;height:${String(PROBE_CONTENT_HEIGHT)}px;background:#345"></div>` +
    `<script>parent.postMessage({type:"lab-185",token:"lab-185-${spec.name}",height:document.documentElement.scrollHeight},"*")<\/script></body>`
  )
}

interface ProbeResult {
  /** 各探针帧的 `srcdoc` 有没有被动过（与插件写下的那一份逐字相等 = false）。 */
  rewrote: Record<string, boolean>
  /** 各探针帧的 `srcdoc` 里有没有带 `nonce=`（#188 起只作事实记录：本页不再补 nonce）。 */
  stamped: Record<string, boolean>
  /** 各探针帧上报的内容高度（没上报就是 -1）。 */
  reported: Record<string, number>
  /** 内联事件属性那一帧被点之后父页收到的上报条数（0 = 没响应）。 */
  inlineReports: number
  /** 本页有没有 CSP meta（`content` 原文；空串 = 没有）。 */
  cspMeta: string
}

/**
 * 往页面里插七档探针帧并读回读数（#185 三档 + #196 两档 + #188 一档内联事件属性）：
 * 隔离沙箱的两档（`isolated` / `isolatedReversed`：`sandbox="allow-scripts"`，前者按
 * 「先 sandbox 后 srcdoc + `setAttribute`」写、后者按「先 srcdoc 后 sandbox + 令牌表」写，
 * 两维各钉一档）、同源的两档（`sameOrigin` / `sameOriginReversed`：`allow-scripts
 * allow-same-origin`）、`bare`（完全不带 `sandbox`）、`reclassified`（先按隔离档写、读数之前
 * **用令牌表**改成同源档，判「本页有没有动它的 `srcdoc`」）与 `inlineHandler`（帧里挂一句
 * `onclick=`）。
 *
 * 七帧都插在**固定定位、可见**的容器里——帧的撑高协议只在载入那一刻量一次，藏在
 * 折叠内容里的帧量到的是 0（见文件头），所以探针必须是载入即可见的。属性都写在**挂进
 * 文档之前**（`make` 里写完才 `appendChild`），插件先建节点再插进去时就是这么走的。
 *
 * 分三步走（安装 → 点那一帧的内联事件属性 → 读回）：`inlineHandler` 是**不透明来源**的
 * 沙箱帧，页面自己的脚本碰不到它的 DOM（没有 `allow-same-origin`），所以那一下必须由
 * Playwright 从外面点进去。
 */
async function runProbes(page: OpenedPage['page']): Promise<ProbeResult> {
  await page.evaluate(async (probes) => {
    type Store = { heights: Map<string, number>; inlineReports: number }
    const store: Store = { heights: new Map(), inlineReports: 0 }
    ;(globalThis as unknown as { __LAB_188__?: Store }).__LAB_188__ = store
    window.addEventListener('message', (event) => {
      const data = event.data as { type?: string; token?: string; height?: number } | null
      if (data === null || typeof data !== 'object') return
      if (data.type === 'lab-185' && typeof data.height === 'number') {
        store.heights.set(String(data.token), data.height)
        return
      }
      if (data.type === 'lab-188') store.inlineReports += 1
    })
    const holder = document.createElement('div')
    holder.id = 'lab-185-probes'
    holder.style.cssText = 'position:fixed;left:0;bottom:0;width:200px;z-index:2147483000'
    document.body.appendChild(holder)
    const make = (probe: { name: string; sandbox: string | null; order: string; via: string; srcdoc: string }): void => {
      const frame = document.createElement('iframe')
      frame.setAttribute('title', probe.name)
      frame.style.cssText = 'display:block;width:200px;height:40px;border:0'
      const sandbox = (): void => {
        if (probe.sandbox === null) return
        // 沙箱怎么写的也是两条不同的路径，各有一档探针：`setAttribute`（React 与普通 DOM 都走它）
        // 与令牌表 `frame.sandbox.add(...)`（不走 `setAttribute`）。
        if (probe.via === 'tokenList') {
          for (const token of probe.sandbox.split(' ')) frame.sandbox.add(token)
        } else {
          frame.setAttribute('sandbox', probe.sandbox)
        }
      }
      const srcdoc = (): void => frame.setAttribute('srcdoc', probe.srcdoc)
      // 两种顺序就是插件渲染属性时分岔的那两档：React 按 JSX 顺序写（sandbox 在前），
      // 反过来写的那一档在写 srcdoc 那一刻读到的 sandbox 还是 null（#196）。
      // 属性都在**还没挂进文档**时写下来——插件先建好节点再插进去就是这么走的。
      if (probe.order === 'sandbox-first') {
        sandbox()
        srcdoc()
      } else {
        srcdoc()
        sandbox()
      }
      holder.appendChild(frame)
    }
    for (const probe of probes.frames) make(probe)
    await new Promise((resolve) => setTimeout(resolve, 2500))
    // 那一帧从隔离档改成同源档：本页仍然一个字节都不许动它的 `srcdoc`。用令牌表改
    // （不走 `setAttribute`）——这一档是「最容易被误伤」的那一种（属性后写、节点已挂上）。
    const reclassifiedFrame = holder.querySelector(`iframe[title="${probes.reclassified}"]`)
    if (reclassifiedFrame instanceof HTMLIFrameElement) reclassifiedFrame.sandbox.add('allow-same-origin')
    await new Promise((resolve) => setTimeout(resolve, 400))
  }, {
    reclassified: RECLASSIFIED_PROBE,
    frames: PROBE_SPECS.map((spec) => ({
      name: `lab-185-${spec.name}`,
      sandbox: spec.sandbox,
      order: spec.order,
      via: spec.via,
      srcdoc: probeSrcdoc(spec),
    })),
  })
  // 点那一帧自己的按钮：帧是不透明来源，只有从外面点得进去。点不到（帧没挂上 / 按钮不在）
  // 不让这一步抛错——读回来的 `inlineReports` 就是结论，由断言判红。
  await page
    .frameLocator(`iframe[title="lab-185-inlineHandler"]`)
    .locator(`#${INLINE_BUTTON_ID}`)
    .click({ timeout: 5_000 })
    .catch(() => undefined)
  await page.waitForTimeout(600)
  return page.evaluate((probes) => {
    type Store = { heights: Map<string, number>; inlineReports: number }
    const store = (globalThis as unknown as { __LAB_188__?: Store }).__LAB_188__
    const holder = document.querySelector('#lab-185-probes')
    const rewrote: Record<string, boolean> = {}
    const stamped: Record<string, boolean> = {}
    const reported: Record<string, number> = {}
    for (const probe of probes.frames) {
      const frame = holder?.querySelector(`iframe[title="${probe.name}"]`) ?? null
      const srcdoc = frame?.getAttribute('srcdoc') ?? ''
      rewrote[probe.name] = srcdoc !== probe.expected
      stamped[probe.name] = srcdoc.includes('nonce=')
      reported[probe.name] = store?.heights.get(probe.token) ?? -1
    }
    return {
      rewrote,
      stamped,
      reported,
      inlineReports: store?.inlineReports ?? 0,
      cspMeta: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? '',
    }
  }, {
    frames: PROBE_SPECS.map((spec) => ({
      name: `lab-185-${spec.name}`,
      token: `lab-185-${spec.name}`,
      expected: probeSrcdoc(spec),
    })),
  })
}

/** 一次远端资源探针的读数。 */
interface ResourceProbeReading {
  /** 浏览器有没有真的去发那条请求（有请求事件或失败事件 = 发过）。 */
  attempted: boolean
  /** 这条请求最终有没有拿到响应（加载成不成功只看网络，记事实用）。 */
  responded: boolean
  /** 这条请求的失败原因原文（`requestfailed`）。空串 = 没失败或没拿到原因。 */
  failureText: string
  /** 这条请求是不是被 CSP 挡下的（浏览器把「被政策挡住」也报成一次请求，所以要看失败原因）。 */
  blockedByCsp: boolean
  /** 探针挂上去之后这一页新出现的 CSP 违规条数（没 CSP 就是 0）。 */
  violations: number
}

/** 数一份页面捕获里与控制台 CSP 违规有关的行（`capturePage` 存的是逐行文本）。 */
function cspViolationLines(capture: { all: string[] }): string[] {
  return capture.all.filter((line) => /content security policy/i.test(line))
}

/**
 * 远端资源探针（#188 的另一类差异）：往页面上挂一件**非本机源**的资源——图片
 * （`https://lab-188.invalid/…`，`.invalid` 顶级域保证解析不出来）与一条同样来自远端的
 * 字体（`@font-face` + 一段用它的文字）各一件（#188 里那两类差异对应的 `img-src` 与
 * `font-src` 是两条不同的指令）。判三件事——① 浏览器真的去发这条请求了（有 `request` 或
 * `requestfailed` 事件）；② 这条请求**不是被本页政策挡下的**（Chromium 把「被 CSP 挡住」也
 * 报成一次请求，所以只看有没有请求事件判不出来——要看失败原因原文是不是 `csp`，外加控制台
 * 有没有一条 CSP 违规）；③ 探针挂上去之后**零 CSP 违规**。#188 之前本页的 `img-src` /
 * `font-src` 只放行 loopback 与 `data:` / `blob:`，②③ 当场红（#186 里那条 F-09 的红就是
 * 同一个成因）。资源最终加载成不成功不看（那取决于这台机器有没有网），只记事实。
 */
async function runResourceProbe(
  page: OpenedPage['page'],
  capture: { all: string[] },
  spec: { kind: 'image' | 'font'; id: string; url: string },
): Promise<ResourceProbeReading> {
  const before = cspViolationLines(capture).length
  let attempted = false
  let responded = false
  let failureText = ''
  const onRequest = (request: { url(): string }): void => {
    if (request.url() === spec.url) attempted = true
  }
  const onResponse = (response: { url(): string }): void => {
    if (response.url() === spec.url) responded = true
  }
  const onFailed = (request: { url(): string; failure(): { errorText: string } | null }): void => {
    if (request.url() !== spec.url) return
    attempted = true
    failureText = request.failure()?.errorText ?? ''
  }
  page.on('request', onRequest)
  page.on('response', onResponse)
  page.on('requestfailed', onFailed)
  try {
    await page.evaluate((probe) => {
      const holder = document.createElement('div')
      holder.id = `${probe.id}-holder`
      holder.style.cssText = 'position:fixed;right:0;bottom:0;width:8px;height:8px;z-index:2147483000'
      if (probe.kind === 'image') {
        const image = document.createElement('img')
        image.id = probe.id
        image.width = 8
        image.height = 8
        image.src = probe.url
        holder.appendChild(image)
      } else {
        const style = document.createElement('style')
        style.textContent = `@font-face{font-family:${probe.id};src:url("${probe.url}") format("woff2")}`
        const text = document.createElement('span')
        text.id = probe.id
        text.style.cssText = `font-family:${probe.id};font-size:12px`
        text.textContent = 'lab-188 font'
        holder.append(style, text)
      }
      document.body.appendChild(holder)
    }, spec)
    await page.waitForTimeout(1_500)
  } finally {
    page.off('request', onRequest)
    page.off('response', onResponse)
    page.off('requestfailed', onFailed)
    await page.evaluate((id) => document.getElementById(`${id}-holder`)?.remove(), spec.id).catch(() => undefined)
  }
  return {
    attempted,
    responded,
    failureText,
    blockedByCsp: /csp|content security policy/i.test(failureText),
    violations: cspViolationLines(capture).length - before,
  }
}

// ---------------------------------------------------------------------------
// ② 夹具卡层：与 `@dsh-external/dsh-visualize` 同形的一张第三方插件卡片
// ---------------------------------------------------------------------------

/** 帧→卡片那条量高上报的消息类型（照抄真插件的 `HEIGHT_MESSAGE_TYPE`）。 */
const CARD_REPORT_TYPE = 'dsh-visualize:height'
/** 插件自己的最小高度（真插件 `MIN_HEIGHT = 48`）：收不到上报时卡片就停在这里。 */
const CARD_MIN_HEIGHT = 48
/** 高度上限（真插件 `HEIGHT_CAP.inline = 800`）。 */
const CARD_HEIGHT_CAP = 800
/** 夹具片段的高度（一块固定高的方块，高度不随宽度变）。 */
const FIXTURE_FRAGMENT_HEIGHT = 600
/** 帧文档 body 的内边距（真插件 frame doc 里 `body{padding:4px 2px}`），进内容高度。 */
const FIXTURE_BODY_PADDING = 8
/** 夹具帧的内容高度期望值（片段高 + body 内边距）。 */
const FIXTURE_CONTENT_HEIGHT = FIXTURE_FRAGMENT_HEIGHT + FIXTURE_BODY_PADDING

/**
 * 一张夹具卡的固定件：写属性的顺序、容器上的 `data-lab-193` 取值、帧的 `title`
 * （也是帧文档的 `<title>`，与帧配对用）与上报 token（父页按 type + token 认这条上报是谁的）。
 */
interface CardVariant {
  order: AttributeOrder
  mark: string
  title: string
  token: string
}

/** 与真插件同形的夹具卡（#193）：React 按 JSX 属性顺序渲染，`sandbox` 写在 `srcdoc` 前面。 */
const CARD_SANDBOX_FIRST: CardVariant = {
  order: 'sandbox-first',
  mark: 'card',
  title: 'lab-193-外部卡片夹具（第三方插件形态）',
  token: 'lab-193-fixture',
}
/** 同一张卡的倒序形态（#196）：先写 `srcdoc`、后写 `sandbox`，其它逐字相同。 */
const CARD_SRCDOC_FIRST: CardVariant = {
  order: 'srcdoc-first',
  mark: 'card-srcdoc-first',
  title: 'lab-196-外部卡片夹具（先写 srcdoc 后写 sandbox）',
  token: 'lab-196-fixture',
}
/** 两张夹具卡（每个页面上各挂两张，判据各判各的）。 */
const CARD_VARIANTS: readonly CardVariant[] = [CARD_SANDBOX_FIRST, CARD_SRCDOC_FIRST]

/**
 * 夹具帧的 `srcdoc`：与真插件 `buildFrameDoc` 同形——自带一份 CSP meta（含
 * `script-src 'unsafe-inline'`）、`<style>`、片段、末尾那句量高上报的内联脚本。
 */
function fixtureFrameDoc(variant: CardVariant): string {
  const fragment = `<div style="width:100%;height:${String(FIXTURE_FRAGMENT_HEIGHT)}px;background:#2b3a55"></div>`
  // 与真插件 `heightReporter` 逐句同形：load 上报一次、内容变化由 ResizeObserver 再报。
  const reporter = `(function () {
  var post = function () {
    parent.postMessage({ type: ${JSON.stringify(CARD_REPORT_TYPE)}, token: ${JSON.stringify(variant.token)}, height: document.documentElement.scrollHeight }, '*');
  };
  new ResizeObserver(post).observe(document.documentElement);
  addEventListener('load', post);
  post();
})();`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; base-uri 'none'; form-action 'none'">
<title>${variant.title}</title>
<style>html,body{margin:0}body{padding:4px 2px}</style>
</head>
<body>
${fragment}
<script>${reporter}</script>
</body>
</html>`
}

/** 夹具卡一层的读数（每个页面的每一张卡各一份）。 */
interface FixtureCardReading {
  /** 卡片节点还在不在文档里（官方组件重渲染可能把它抹掉，所以要如实带上这一项）。 */
  mounted: boolean
  /** 卡片（`iframe` 元素）的实测高度与宽度。 */
  height: number
  width: number
  /** 帧文档的内容高度（帧自己上报的那个量；父页读不到，由 playwright 进帧读）。 */
  contentHeight: number
  /** 父页收到的量高上报（≥1 条 = 帧内联脚本真的执行了）。 */
  reports: number[]
  /** 卡片帧的 `srcdoc` 原文（判「本页有没有动过它」用：与夹具写下的那一份逐字比）。 */
  srcdoc: string
  /** 卡片帧的 `srcdoc` 里有没有 `nonce=`（#188 起只作事实记录：本页不再补 nonce）。 */
  stamped: boolean
  /** 卡片帧的 `sandbox` 取值（真插件就是 `allow-scripts` 一个 token）。 */
  sandbox: string | null
  /** 卡片帧的 `title` 属性（与帧文档的 `<title>` 配对用）。 */
  title: string
  /** 卡片挂没挂在官方对话区滚动体（`[data-conversation-scroll]`）里。 */
  inConversation: boolean
}

/** 夹具卡挂在哪儿了（挂载点 + 试了几次）。 */
interface FixtureMount {
  mountPoint: string
  attempts: number
}

/**
 * 往页面的官方对话区里挂一张夹具卡（`variant` 决定写属性的顺序，见 `CARD_VARIANTS`）。
 *
 * 挂载点按**官方语义结构**取：`[data-conversation-scroll]`（官方 `ui-conversation` 的
 * 会话滚动体）里的 `[data-slot="conversation.session"]` 槽位（官方渲染消息流的地方）——
 * 取不到槽位就退到滚动体本身，并把实际用的挂载点如实返回（读数进报告，不静默降级）。
 *
 * 官方组件可能在我们挂上之后重渲染、把不认识的节点抹掉，所以这里留一次重挂的机会；
 * 两次都没挂上就返回 `no-host`，由断言判红（**不许**悄悄跳过）。
 */
async function mountFixtureCard(page: OpenedPage['page'], variant: CardVariant): Promise<FixtureMount> {
  let mountPoint = 'no-host'
  let attempts = 0
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    attempts = attempt
    mountPoint = await page.evaluate((spec) => {
      type Store = Record<string, { reports: number[] }>
      document.querySelector(`[data-lab-193="${spec.mark}"]`)?.remove()
      const scroll = document.querySelector('[data-conversation-scroll]')
      const seat = document.querySelector('[data-slot="conversation.session"]')
      const host = seat ?? scroll
      if (host === null) return 'no-host'
      const reports: number[] = []
      const store = ((globalThis as unknown as { __LAB_193__?: Store }).__LAB_193__ ??= {})
      store[spec.mark] = { reports }
      const wrapper = document.createElement('div')
      wrapper.setAttribute('data-lab-193', spec.mark)
      const header = document.createElement('div')
      header.style.cssText = 'display:flex;align-items:baseline;gap:8px;font-size:12px;opacity:.65;margin:2px 0 6px;overflow:hidden;white-space:nowrap'
      header.textContent = spec.title
      const frame = document.createElement('iframe')
      frame.setAttribute('referrerpolicy', 'no-referrer')
      frame.setAttribute('title', spec.title)
      frame.style.cssText = `display:block;width:100%;border:0;background:transparent;height:${String(spec.minHeight)}px`
      let height = spec.minHeight
      window.addEventListener('message', (event) => {
        const data = event.data as { type?: unknown; token?: unknown; height?: unknown } | null
        if (data === null || typeof data !== 'object') return
        if (data.type !== spec.reportType || data.token !== spec.token) return
        if (typeof data.height !== 'number' || !Number.isFinite(data.height)) return
        height = Math.max(spec.minHeight, Math.min(Math.ceil(data.height), spec.cap))
        frame.style.height = `${String(height)}px`
        reports.push(data.height)
      })
      const sandbox = (): void => {
        // 真插件那一档：allow-scripts 一个 token，不带 allow-same-origin。
        frame.setAttribute('sandbox', 'allow-scripts')
      }
      const srcdoc = (): void => frame.setAttribute('srcdoc', spec.doc)
      // 两张卡只有这里不一样：`sandbox-first` 是 React 按 JSX 属性顺序渲染的结果，
      // `srcdoc-first` 是插件反过来写的那一档（#196）。
      if (spec.order === 'sandbox-first') {
        sandbox()
        srcdoc()
      } else {
        srcdoc()
        sandbox()
      }
      wrapper.append(header, frame)
      host.appendChild(wrapper)
      return seat === null ? 'scroll' : 'seat'
    }, {
      doc: fixtureFrameDoc(variant),
      title: variant.title,
      mark: variant.mark,
      order: variant.order,
      minHeight: CARD_MIN_HEIGHT,
      cap: CARD_HEIGHT_CAP,
      reportType: CARD_REPORT_TYPE,
      token: variant.token,
    })
    if (mountPoint === 'no-host') return { mountPoint, attempts }
    const reached = await waitForFixtureCard(page, variant)
    if (reached) break
  }
  return { mountPoint, attempts }
}

/** 卡片的轻量状态（轮询用：只读 DOM，不进帧）。 */
async function fixtureCardState(
  page: OpenedPage['page'],
  variant: CardVariant,
): Promise<{ mounted: boolean; reports: number; height: number }> {
  return page.evaluate((mark) => {
    type Store = Record<string, { reports: number[] }>
    const wrapper = document.querySelector(`[data-lab-193="${mark}"]`)
    const frame = wrapper?.querySelector('iframe') ?? null
    const reports = (globalThis as unknown as { __LAB_193__?: Store }).__LAB_193__?.[mark]?.reports ?? []
    return {
      mounted: wrapper !== null,
      reports: reports.length,
      height: frame === null ? -1 : Math.round(frame.getBoundingClientRect().height * 100) / 100,
    }
  }, variant.mark)
}

/**
 * 等夹具卡「被撑开」（父页收到了上报、卡片高度离开了最小高度）——等到了就是这一层该有的
 * 结果。**没等到也照样往下走**：读回来的读数就是「停在最小高度」那个坏法，由断言判红。
 */
async function waitForFixtureCard(
  page: OpenedPage['page'],
  variant: CardVariant,
  timeoutMs = 6_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const state = await fixtureCardState(page, variant)
    if (state.mounted && state.reports >= 1 && state.height > CARD_MIN_HEIGHT + 1) return true
    await page.waitForTimeout(200)
  }
  return false
}

/** 读出夹具卡的完整读数（卡片几何 + 父页收到的上报 + 帧文档的内容高度 + 沙箱/挂载信息）。 */
async function readFixtureCard(page: OpenedPage['page'], variant: CardVariant): Promise<FixtureCardReading> {
  const dom = await page.evaluate((mark) => {
    type Store = Record<string, { reports: number[] }>
    const wrapper = document.querySelector(`[data-lab-193="${mark}"]`)
    const frame = wrapper?.querySelector('iframe') ?? null
    const reports = (globalThis as unknown as { __LAB_193__?: Store }).__LAB_193__?.[mark]?.reports ?? []
    const rect = frame?.getBoundingClientRect() ?? null
    const srcdoc = frame?.getAttribute('srcdoc') ?? ''
    return {
      mounted: wrapper !== null,
      height: rect === null ? -1 : Math.round(rect.height * 100) / 100,
      width: rect === null ? -1 : Math.round(rect.width * 100) / 100,
      reports: [...reports],
      srcdoc,
      stamped: srcdoc.includes('nonce='),
      sandbox: frame?.getAttribute('sandbox') ?? null,
      title: frame?.getAttribute('title') ?? '',
      inConversation: frame !== null && frame.closest('[data-conversation-scroll]') !== null,
    }
  }, variant.mark)
  let contentHeight = -1
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue
    const title = await frame.title().catch(() => '')
    if (title !== variant.title) continue
    contentHeight = await frame
      .evaluate(() => document.documentElement.scrollHeight)
      .catch(() => -1)
  }
  return { ...dom, contentHeight }
}

// ---------------------------------------------------------------------------
// ③ 真实卡片层（只在 --gateway 连外部实例时跑）
// ---------------------------------------------------------------------------

/** 一张 HTML 预览卡（两侧按 title 配对）。 */
interface CardReading {
  title: string
  /** 卡片（iframe 元素）的实测高度与宽度。 */
  height: number
  width: number
  /** 帧文档的内容高度（帧自己上报的那个量，父页读不到，由 playwright 进帧读）。 */
  contentHeight: number
  /** 卡片帧的 srcdoc 里有没有 nonce。 */
  stamped: boolean
  /** 卡片帧的 srcdoc 原文（判「本页有没有动它」与两侧逐字比对用）。 */
  srcdoc: string
  /** 卡片此刻还挂在折叠内容里没有。 */
  hidden: boolean
}
/** 页面上所有 HTML 预览卡（`iframe` + 非空 `srcdoc`），连同每张卡的帧内容高度。 */
async function readCards(page: OpenedPage['page']): Promise<CardReading[]> {
  const dom = await page.evaluate((labPrefixes) =>
    Array.from(document.querySelectorAll('iframe'))
      .filter((frame) => (frame.getAttribute('srcdoc') ?? '') !== '')
      // 本套件自己造的帧（探针帧 `lab-185-*` 与夹具卡 `lab-193-*`）不算卡片。
      .filter((frame) => labPrefixes.some((prefix) => (frame.getAttribute('title') ?? '').startsWith(prefix)) === false)
      .map((frame) => {
        const rect = frame.getBoundingClientRect()
        let node: Element | null = frame
        let hidden = false
        while (node !== null) {
          if (node.hasAttribute('hidden')) hidden = true
          node = node.parentElement
        }
        const srcdoc = frame.getAttribute('srcdoc') ?? ''
        return {
          title: frame.getAttribute('title') ?? '',
          height: Math.round(rect.height * 100) / 100,
          width: Math.round(rect.width * 100) / 100,
          stamped: srcdoc.includes('nonce='),
          srcdoc,
          hidden,
        }
      }),
  [...LAB_FRAME_TITLE_PREFIXES])
  const contents = new Map<string, number>()
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue
    const title = await frame.title().catch(() => '')
    if (title === '' || isLabFrame(title)) continue
    const height = await frame
      .evaluate(() => document.documentElement.scrollHeight)
      .catch(() => -1)
    if (height >= 0) contents.set(title, height)
  }
  return dom.map((card) => ({ ...card, contentHeight: contents.get(card.title) ?? -1 }))
}

/** 展开卡片所在的 `turn-process` 折叠组（卡片住在工具卡里，折叠着时帧量到 0）。 */
async function revealCards(page: OpenedPage['page']): Promise<number> {
  const clicked = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button[data-turn-process]'))
    let count = 0
    for (const button of buttons) {
      if (button.getAttribute('aria-expanded') === 'false') {
        if (button instanceof HTMLElement) button.click()
        count += 1
      }
    }
    return count
  })
  await page.waitForTimeout(1500)
  return clicked
}

/** 让每张卡片的帧在**可见**状态下重新载入一次（同一动作两侧各做一遍，见文件头）。 */
async function reloadFrames(page: OpenedPage['page']): Promise<void> {
  await page.evaluate((labPrefixes) => {
    for (const frame of Array.from(document.querySelectorAll('iframe'))) {
      const srcdoc = frame.getAttribute('srcdoc') ?? ''
      if (srcdoc === '') continue
      // 本套件自己造的帧不用重载：探针帧的判据已经读完了，夹具卡与真卡片无关。
      if (labPrefixes.some((prefix) => (frame.getAttribute('title') ?? '').startsWith(prefix))) continue
      frame.setAttribute('srcdoc', srcdoc)
    }
  }, [...LAB_FRAME_TITLE_PREFIXES])
  await page.waitForTimeout(3000)
}

/**
 * 把装配页的视口宽度调到「卡片宽度 = 官方页那一份」（两侧比高度前必须先让卡片等宽）。
 *
 * 两侧的卡片宽度都对视口宽度单调（装配页斜率实测约 0.6、官方页约 0.35），所以先用两个
 * 自变量量出斜率、再按斜率一次算出目标视口，最后最多校正两次。返回**调到的最接近的
 * 卡片宽度**（不是视口宽度）——判据拿它与官方那一份比 ±2px。
 */
async function matchCardWidth(page: OpenedPage['page'], target: number): Promise<number> {
  const measure = async (width: number): Promise<number> => {
    await page.setViewportSize({ width, height: VIEWPORT_HEIGHT })
    await page.waitForTimeout(700)
    const cards = await readCards(page)
    return cards[0]?.width ?? -1
  }
  const lowWidth = CHAT_START_WIDTH
  const low = await measure(lowWidth)
  if (Math.abs(low - target) <= 1) return low
  const highWidth = lowWidth + 150
  const high = await measure(highWidth)
  if (Math.abs(high - target) <= 1) return high
  const slope = (high - low) / (highWidth - lowWidth)
  if (!Number.isFinite(slope) || Math.abs(slope) < 0.01) return Math.abs(high - target) <= Math.abs(low - target) ? high : low
  let best = Math.abs(high - target) <= Math.abs(low - target) ? high : low
  let baseWidth = highWidth
  let base = high
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const width = Math.round(baseWidth + (target - base) / slope)
    const card = await measure(width)
    if (Math.abs(card - target) < Math.abs(best - target)) best = card
    if (Math.abs(card - target) <= 1) return card
    baseWidth = width
    base = card
  }
  return best
}

export const HTML_PREVIEW_HEIGHT_SUITE: LabSuite = {
  id: 'F-59',
  phase: 'new-feature',
  name: 'HTML 预览卡（沙箱 srcdoc 帧）在装配页里的处境与官方页一致：帧内脚本照常执行、卡片按内容撑开、本页不挡远端资源（HTML-PREVIEW-HEIGHT 套件）',
  expect:
    '真网关 + 假宿主（默认跑法是实验室自起的隔离实例）。① **机制层（自足）**：装配页与官方网关页各插七档**载入即可见**的探针帧——六档判「帧内脚本真的执行」（隔离沙箱两档 `sandbox="allow-scripts"`；同源两档 `allow-scripts allow-same-origin`；一档完全不带 `sandbox`；一档先按隔离档写、读数之前改用令牌表变成同源档），一档判「帧里的内联事件属性真的响应」。判据：**两侧都没有 CSP meta**（本页那份是 #188 去掉的、官方页本来就没有）；**六档探针帧的内联脚本全部执行**（各自上报内容高度 500，并逐帧与官方页同值 ±2px——#188 之前只有两个隔离沙箱帧跑得起来，同源帧与不带 `sandbox` 的帧被本页 `script-src` 挡住）；**本页一个字节都不改第三方帧的 `srcdoc`**（逐帧与插件写下的那一份逐字相等——#188 之前六帧全被打上本页 nonce）；**帧里的内联事件属性（`onclick=`）点一下父页就收到上报**（官方页同样收到）——#188 里那一类「按 CSP 规则只能靠 `\'unsafe-inline\'` 放行、nonce/hash 对它无效」的差异；**远端资源不再被本页挡**：页面上挂一个非本机源的图片，浏览器真的去发那条请求（#188 之前 `img-src` 只放行 loopback 与 data:/blob:，请求根本发不出去、页面上只多一条 CSP 违规），且这一步零 CSP 违规。「是否带 nonce」一律如实记成事实（今天两侧都不带）。② **夹具卡层（自足，覆盖用户报的那一层）**：两侧的官方对话区里各挂一张**与 `@dsh-external/dsh-visualize` 同形**的夹具卡（挂在 `[data-conversation-scroll]` 的 `conversation.session` 槽位上；`iframe sandbox="allow-scripts"`、帧文档自带一份含 `unsafe-inline` 的 CSP meta、帧内一句量 `documentElement.scrollHeight` 再 `parent.postMessage` 的上报脚本、父页侧高度从插件最小高度 48px 起、只有收到对得上的上报才涨）。判据：帧内脚本真的执行了（父页收到上报）、帧文档渲染出完整内容（内容高度 = 夹具自己声明的 608px）、**卡片高度 ≥ 帧内容高度（±2px）**（#185 的用户判据）、**卡片没有停在 48px 最小高度上**（#185 的具体坏法）、装配页那一份与官方页那一份**同高（±2px）**、**本页一个字节都没改这张卡的 `srcdoc`**（与夹具写下的那一份逐字相等——#188 之前它被打上了本页 nonce）、官方页那份的 `srcdoc` 一个字节没被改。这一层的每一条都是无条件断言——挂不上、帧不报、卡停住都判红，不再随当天网关有没有真实卡片而增减。#196 在同一处再挂一张**倒序卡**（同一段片段、同一句上报脚本、同一条父页协议、同一个挂载点，只把写属性的顺序倒过来：先 `srcdoc` 后 `sandbox`）：它也要挂进对话区、帧内脚本也要跑、也要按内容撑开、也不能停在 48px、**并且与正序那张同高（±2px）**、它的 `srcdoc` 同样一个字节没被改（写属性的顺序不该改变结果）③ **真实卡片层（只在 `--gateway` 连外部实例时跑）**：两侧的 HTML 预览卡（按 `iframe` + 非空 `srcdoc` 认、按 `title` 配对）先点开所在的折叠组、再让帧在可见状态下重载一次（同一动作两侧各做一遍），然后逐卡判：卡片高度 = 帧文档内容高度（±2px）、卡片高度 = 官方页那一份（±2px，两侧先按视口把卡片宽度调到一致，宽度对不上时记事实并跳过这一条）；两侧那份 `srcdoc` 带不带 nonce、是否逐字相同如实记成事实（#188 起本页不再补 nonce）。默认跑法（自起隔离实例）里没有第三方插件的卡片，这一层如实记一条事实说明只在外部实例模式跑（#193）。全程零 pageerror。',
  run: async (ctx, check) => {
    const hunt = ctx.lab.external === true
    const candidates = await listSessions(ctx.lab.gateway)
      .then((rows) => rows.filter((row) => row.blank !== true && row.running !== true).slice(0, hunt ? 3 : 1))
      .catch(() => [])
    const screenshots: string[] = []
    let opened: OpenedPage | undefined
    try {
      // 开一页 chat 装配页。③ 真实卡片层要找「今天有 HTML 预览卡的会话」（最多试三条候选
      // ——卡片是用户装了可视化插件、且会话里用过它才有的，哪条有是当天的数据事实），
      // 默认跑法不吃这张卡（② 的夹具卡自己造），所以只开一条候选、省掉那一圈试错。
      for (const candidate of [...candidates, undefined]) {
        opened = await openTreePage(ctx.browser, ctx.lab, route('chat'), {
          ...(candidate === undefined ? {} : { sessionId: candidate.sessionId }),
          width: CHAT_START_WIDTH,
          height: VIEWPORT_HEIGHT,
          settleMs: 6_000,
        })
        const found = (await readCards(opened.page)).filter((card) => card.width > 0)
        if (found.length > 0 || candidate === undefined || !hunt) {
          check.fact(`chat 装配页开的会话：${candidate?.sessionId ?? '（没有可用会话，官方自建空白会话）'}（预览卡 ${String(found.length)} 张）`)
          break
        }
        await opened.context.close()
        opened = undefined
      }
      if (opened === undefined) throw new Error('F-59: 没能打开 chat 装配页')
      const page = opened.page
      // 官方网关页：同一上下文（同源、同 localStorage）另开一页，官方会自己恢复当前会话。
      const officialPage = await opened.context.newPage()
      const officialCapture = capturePage(officialPage)
      await officialPage.goto(`${ctx.lab.origin}/official`, { waitUntil: 'domcontentloaded' })
      await officialPage.waitForTimeout(9_000)

      // ---- ① 机制层：七档探针帧 ----
      const probeNames = REPORT_PROBES.map((spec) => `lab-185-${spec.name}`)
      const chatProbe = await runProbes(page)
      const officialProbe = await runProbes(officialPage)
      check.fact(
        `装配页 CSP meta=${chatProbe.cspMeta === '' ? '（没有，与官方页一致）' : chatProbe.cspMeta}；` +
          `官方页 CSP meta=${officialProbe.cspMeta === '' ? '（没有）' : officialProbe.cspMeta}`,
      )
      check.fact(
        `探针帧的 srcdoc 带 nonce：装配页 ${JSON.stringify(chatProbe.stamped)}、官方页 ${JSON.stringify(officialProbe.stamped)}；` +
          `内联事件属性那一帧收到的上报：装配页 ${String(chatProbe.inlineReports)} 条、官方页 ${String(officialProbe.inlineReports)} 条`,
      )
      check.ok(
        '① 装配页没有 CSP meta（#188 去掉的就是它；与官方页一致）',
        chatProbe.cspMeta === '',
        `读到 ${JSON.stringify(chatProbe.cspMeta)}`,
      )
      check.ok(
        '① 官方页同样没有 CSP meta（两侧同处境，这一条是基准）',
        officialProbe.cspMeta === '',
        `读到 ${JSON.stringify(officialProbe.cspMeta)}`,
      )
      const probesExecuted = probeNames.filter((name) => (chatProbe.reported[name] ?? -1) >= PROBE_CONTENT_HEIGHT - 2)
      check.ok(
        '① 六档探针帧的内联脚本全部执行（各自上报内容高度 500；改前只有两个隔离沙箱帧跑得起来）',
        probesExecuted.length === probeNames.length,
        `跑起来的 ${String(probesExecuted.length)}/${String(probeNames.length)} 帧：${JSON.stringify(chatProbe.reported)}`,
      )
      const probeParity = probeNames.filter(
        (name) => Math.abs((officialProbe.reported[name] ?? -1) - (chatProbe.reported[name] ?? -1)) <= 2,
      )
      check.ok(
        '① 逐帧与官方页同值（±2px；官方页那一条基准也在，说明这些帧在两侧都真的执行了）',
        probeParity.length === probeNames.length,
        `装配页 ${JSON.stringify(chatProbe.reported)}、官方页 ${JSON.stringify(officialProbe.reported)}`,
      )
      const rewrittenProbes = probeNames.filter((name) => chatProbe.rewrote[name] !== false)
      check.ok(
        '① 本页一个字节都不改第三方帧的 `srcdoc`（逐帧与插件写下的那一份逐字相等；#188 之前六帧全被打上本页 nonce）',
        rewrittenProbes.length === 0,
        `被动过的帧 ${JSON.stringify(rewrittenProbes)}；带 nonce 的读数 ${JSON.stringify(chatProbe.stamped)}`,
      )
      check.ok(
        '① 帧里的内联事件属性（`onclick=`）点一下父页真的收到上报（「只能靠 unsafe-inline 放行」那一类差异）',
        chatProbe.inlineReports >= 1,
        `装配页收到 ${String(chatProbe.inlineReports)} 条（#188 之前是 0：本页 CSP 不给 unsafe-inline，内联事件属性一律不执行）`,
      )
      check.ok(
        '① 官方页那一帧同样响应（两侧同处境）',
        officialProbe.inlineReports >= 1,
        `官方页收到 ${String(officialProbe.inlineReports)} 条`,
      )
      // 远端资源：两个页面各挂两件非本机源的资源（图片与字体，#186 里那条 F-09 的红就是这个成因）。
      const chatResources: ResourceProbeReading[] = []
      const officialResources: ResourceProbeReading[] = []
      for (const probe of REMOTE_RESOURCE_PROBES) {
        chatResources.push(await runResourceProbe(page, opened.capture, probe))
        officialResources.push(await runResourceProbe(officialPage, officialCapture, probe))
      }
      const describeResources = (readings: readonly ResourceProbeReading[], offset = 0): string =>
        readings
          .map(
            (reading, index) =>
              `${REMOTE_RESOURCE_PROBES[index + offset]?.kind ?? '?'} attempted=${String(reading.attempted)} responded=${String(reading.responded)} blockedByCsp=${String(reading.blockedByCsp)} 失败原因 ${JSON.stringify(reading.failureText)} 违规 ${String(reading.violations)} 条`,
          )
          .join('；')
      check.fact(`远端资源探针（${REMOTE_RESOURCE_PROBES.map((probe) => probe.url).join(' / ')}）：装配页 ${describeResources(chatResources)}`)
      check.fact(`远端资源探针：官方页 ${describeResources(officialResources)}`)
      // 判据是「不是被本页政策挡下的」：Chromium 把「被 CSP 挡住」也报成一次请求（失败原因
      // 就是 `csp`），所以只看有没有请求事件判不出来——要看失败原因与控制台违规两样。
      const notBlocked = (reading: ResourceProbeReading | undefined): boolean =>
        reading !== undefined && reading.attempted && !reading.blockedByCsp && reading.violations === 0
      check.ok(
        '① 远端资源：装配页那条图片请求不是被本页政策挡下的（#188 之前 img-src 把它挡在发出之前）',
        notBlocked(chatResources[0]),
        describeResources(chatResources.slice(0, 1)),
      )
      check.ok(
        '① 远端资源：装配页那条字体请求同样不是被政策挡下的（font-src 是另一条指令）',
        notBlocked(chatResources[1]),
        describeResources(chatResources.slice(1), 1),
      )
      check.ok(
        '① 远端资源：官方页那两件同样不是被政策挡下的（两侧同处境）',
        officialResources.every((reading) => notBlocked(reading)),
        describeResources(officialResources),
      )
      screenshots.push(await shot(ctx, opened.page, 'html-preview-height-probe-chat'))

      // ---- ② 夹具卡层：与真插件同形的两张卡（正序 + 倒序），挂在两侧的官方对话区里 ----
      const chatMount = await mountFixtureCard(page, CARD_SANDBOX_FIRST)
      const chatReversedMount = await mountFixtureCard(page, CARD_SRCDOC_FIRST)
      const officialMount = await mountFixtureCard(officialPage, CARD_SANDBOX_FIRST)
      const officialReversedMount = await mountFixtureCard(officialPage, CARD_SRCDOC_FIRST)
      check.fact(
        `夹具卡挂载点（正序 sandbox 在前）：装配页 ${chatMount.mountPoint}（试了 ${String(chatMount.attempts)} 次）、官方页 ${officialMount.mountPoint}（试了 ${String(officialMount.attempts)} 次）；` +
          `（倒序 srcdoc 在前）：装配页 ${chatReversedMount.mountPoint}（试了 ${String(chatReversedMount.attempts)} 次）、官方页 ${officialReversedMount.mountPoint}（试了 ${String(officialReversedMount.attempts)} 次）`,
      )
      const chatCard = await readFixtureCard(page, CARD_SANDBOX_FIRST)
      const chatReversedCard = await readFixtureCard(page, CARD_SRCDOC_FIRST)
      const officialCard = await readFixtureCard(officialPage, CARD_SANDBOX_FIRST)
      const officialReversedCard = await readFixtureCard(officialPage, CARD_SRCDOC_FIRST)
      check.fact(
        `夹具卡（正序）：装配页 ${String(chatCard.width)}x${String(chatCard.height)}（帧内容高 ${String(chatCard.contentHeight)}、上报 ${String(chatCard.reports.length)} 次 ${JSON.stringify(chatCard.reports.slice(0, 3))}、nonce=${String(chatCard.stamped)}）、` +
          `官方页 ${String(officialCard.width)}x${String(officialCard.height)}（帧内容高 ${String(officialCard.contentHeight)}、上报 ${String(officialCard.reports.length)} 次、nonce=${String(officialCard.stamped)}）`,
      )
      check.fact(
        `夹具卡（倒序）：装配页 ${String(chatReversedCard.width)}x${String(chatReversedCard.height)}（帧内容高 ${String(chatReversedCard.contentHeight)}、上报 ${String(chatReversedCard.reports.length)} 次 ${JSON.stringify(chatReversedCard.reports.slice(0, 3))}、nonce=${String(chatReversedCard.stamped)}）、` +
          `官方页 ${String(officialReversedCard.width)}x${String(officialReversedCard.height)}（帧内容高 ${String(officialReversedCard.contentHeight)}、上报 ${String(officialReversedCard.reports.length)} 次、nonce=${String(officialReversedCard.stamped)}）`,
      )
      check.ok(
        '夹具卡：挂进了官方对话区（`[data-conversation-scroll]` 里，与真卡片同处一条布局链）',
        chatMount.mountPoint !== 'no-host' && chatCard.mounted && chatCard.inConversation && officialCard.inConversation,
        `挂载点（装配页）=${chatMount.mountPoint}、卡片在文档里=${String(chatCard.mounted)}、在对话区里=${String(chatCard.inConversation)}/${String(officialCard.inConversation)}`,
      )
      check.ok(
        '夹具卡：两侧的沙箱声明都是真插件那一档（`allow-scripts` 一个 token，不带 `allow-same-origin`）',
        chatCard.sandbox === 'allow-scripts' && officialCard.sandbox === 'allow-scripts',
        `装配页 sandbox=${String(chatCard.sandbox)}、官方页 sandbox=${String(officialCard.sandbox)}`,
      )
      check.ok(
        '夹具卡：本页一个字节都不改这张卡的 `srcdoc`（与夹具写下的那一份逐字相等；#188 之前它被打上了本页 nonce）',
        chatCard.srcdoc === fixtureFrameDoc(CARD_SANDBOX_FIRST),
        `装配页 nonce=${String(chatCard.stamped)}、与夹具写下的那一份${chatCard.srcdoc === fixtureFrameDoc(CARD_SANDBOX_FIRST) ? '逐字相同' : '不同'}`,
      )
      check.ok(
        '夹具卡：官方页那份的 `srcdoc` 一个字节没被改（官方页没有 CSP，不需要补）',
        officialCard.stamped === false,
        `官方页 nonce=${String(officialCard.stamped)}`,
      )
      check.ok(
        '夹具卡：帧内那句量高内联脚本真的执行了（父页收到了上报）',
        chatCard.reports.length >= 1,
        `上报 ${String(chatCard.reports.length)} 次（修前这里是 0：帧内脚本被本页 CSP 挡住）`,
      )
      check.ok(
        `夹具卡：帧文档渲染出了完整内容（内容高度 = 夹具自己声明的 ${String(FIXTURE_CONTENT_HEIGHT)}px，±2px）`,
        Math.abs(chatCard.contentHeight - FIXTURE_CONTENT_HEIGHT) <= 2,
        `帧内容高 ${String(chatCard.contentHeight)}（期望 ${String(FIXTURE_CONTENT_HEIGHT)} = 片段 ${String(FIXTURE_FRAGMENT_HEIGHT)} + 帧 body 内边距 ${String(FIXTURE_BODY_PADDING)}）`,
      )
      check.ok(
        '夹具卡：卡片按内容撑开（卡片高度 ≥ 帧内容高度 − 2px）——#185 的用户判据',
        chatCard.height >= chatCard.contentHeight - 2,
        `卡片高 ${String(chatCard.height)}、帧内容高 ${String(chatCard.contentHeight)}`,
      )
      check.ok(
        `夹具卡：卡片没有停在插件自己的最小高度（${String(CARD_MIN_HEIGHT)}px）上——#185 的具体坏法`,
        chatCard.height > CARD_MIN_HEIGHT + 2,
        `卡片高 ${String(chatCard.height)}（最小高度 ${String(CARD_MIN_HEIGHT)}）`,
      )
      check.ok(
        '夹具卡：官方页那一份同样按内容撑开（对照：无 CSP 的官方页里本来就会涨）',
        officialCard.height >= officialCard.contentHeight - 2,
        `官方页卡片高 ${String(officialCard.height)}、帧内容高 ${String(officialCard.contentHeight)}`,
      )
      check.ok(
        '夹具卡：装配页那一份与官方页那一份同高（±2px）',
        Math.abs(chatCard.height - officialCard.height) <= 2,
        `装配页 ${String(chatCard.height)}、官方页 ${String(officialCard.height)}`,
      )
      // #196：同一张卡、同一段片段、同一句上报脚本，只把写属性的顺序倒过来（先 srcdoc 后 sandbox）。
      check.ok(
        '夹具卡（倒序 srcdoc 在前）：也挂进了官方对话区（`[data-conversation-scroll]` 里）',
        chatReversedMount.mountPoint !== 'no-host' && chatReversedCard.mounted && chatReversedCard.inConversation,
        `挂载点=${chatReversedMount.mountPoint}、卡片在文档里=${String(chatReversedCard.mounted)}、在对话区里=${String(chatReversedCard.inConversation)}`,
      )
      check.ok(
        '夹具卡（倒序）：本页一个字节都不改它的 `srcdoc`（写属性的顺序不该改变结果）',
        chatReversedCard.srcdoc === fixtureFrameDoc(CARD_SRCDOC_FIRST),
        `装配页 nonce=${String(chatReversedCard.stamped)}、与夹具写下的那一份${chatReversedCard.srcdoc === fixtureFrameDoc(CARD_SRCDOC_FIRST) ? '逐字相同' : '不同'}`,
      )
      check.ok(
        '夹具卡（倒序）：帧内那句量高内联脚本真的执行了（父页收到了上报）',
        chatReversedCard.reports.length >= 1,
        `上报 ${String(chatReversedCard.reports.length)} 次（改前这里是 0：帧内脚本被本页 CSP 挡住）`,
      )
      check.ok(
        '夹具卡（倒序）：卡片按内容撑开（卡片高度 ≥ 帧内容高度 − 2px）——#185 的用户判据',
        chatReversedCard.height >= chatReversedCard.contentHeight - 2,
        `卡片高 ${String(chatReversedCard.height)}、帧内容高 ${String(chatReversedCard.contentHeight)}`,
      )
      check.ok(
        `夹具卡（倒序）：卡片没有停在插件自己的最小高度（${String(CARD_MIN_HEIGHT)}px）上`,
        chatReversedCard.height > CARD_MIN_HEIGHT + 2,
        `卡片高 ${String(chatReversedCard.height)}（最小高度 ${String(CARD_MIN_HEIGHT)}）`,
      )
      check.ok(
        '夹具卡（倒序）：与「先 sandbox 后 srcdoc」那张同高（±2px，写属性的顺序不影响结果）',
        Math.abs(chatReversedCard.height - chatCard.height) <= 2,
        `倒序 ${String(chatReversedCard.height)}、正序 ${String(chatCard.height)}（±2px 之内）`,
      )
      check.ok(
        '夹具卡（倒序）：官方页那份的 `srcdoc` 一个字节没被改（我们只在自己那一页上工作）',
        officialReversedCard.stamped === false,
        `官方页 nonce=${String(officialReversedCard.stamped)}`,
      )
      screenshots.push(await shot(ctx, page, 'html-preview-height-fixture-chat'))
      screenshots.push(await shot(ctx, officialPage, 'html-preview-height-fixture-official'))

      // ---- ③ 真实卡片层（要当天网关上有第三方插件渲染的卡片；只在 --gateway 时跑）----
      if (!hunt) {
        check.fact(
          '真实卡片层没跑：默认跑法连的是自起的隔离实例，实例里只有官方插件与我们的插件（`@dsh-external/dsh-visualize` 这类第三方可视化插件不在里面）——' +
            '用户报的那一层由 ② 的夹具卡在默认跑法里覆盖；要跑真的第三方卡片，用 `--gateway` 连一台装了它的实例（#193）',
        )
      } else {
        const chatCards = (await readCards(page)).filter((card) => card.width > 0)
        check.fact(
          `装配页上的 HTML 预览卡 ${String(chatCards.length)} 张：${JSON.stringify(chatCards.map((card) => `${card.title} ${String(card.width)}x${String(card.height)}`))}`,
        )
        if (chatCards.length === 0) {
          check.fact('这一轮外部实例上没有 HTML 预览卡（没装可视化插件 / 会话里没用过它）：真实卡片这一层只记事实')
        } else {
          const revealed = await revealCards(page)
          await reloadFrames(page)
          const chatAfter = (await readCards(page)).filter((card) => card.width > 0)
          check.fact(`装配页：展开 ${String(revealed)} 个折叠组并让 ${String(chatAfter.length)} 张卡片的帧在可见状态下重载`)

          await revealCards(officialPage)
          await reloadFrames(officialPage)
          const officialAfter = (await readCards(officialPage)).filter((card) => card.width > 0)
          check.fact(
            `官方页上的 HTML 预览卡 ${String(officialAfter.length)} 张：${JSON.stringify(officialAfter.map((card) => `${card.title} ${String(card.width)}x${String(card.height)}`))}`,
          )
          check.ok(
            '两侧认到的是同一批卡片（按 title 配对）',
            officialAfter.length > 0 && chatAfter.every((card) => officialAfter.some((other) => other.title === card.title)),
            `装配页 ${JSON.stringify(chatAfter.map((card) => card.title))}、官方页 ${JSON.stringify(officialAfter.map((card) => card.title))}`,
          )

          // 卡片宽度先对齐（宽度不同、内容高度本来就不同，比高度没有意义）。
          const targetWidth = officialAfter[0]?.width ?? -1
          const matchedWidth = targetWidth < 0 ? -1 : await matchCardWidth(page, targetWidth)
          const widthMatched = matchedWidth >= 0 && Math.abs(matchedWidth - targetWidth) <= 2
          check.fact(
            `卡片宽度对齐：官方页 ${String(targetWidth)}px、装配页调到 ${String(matchedWidth)}px（${widthMatched ? '已对齐' : '没对上'}）`,
          )

          const cardsAfterMatch = (await readCards(page)).filter((card) => card.width > 0)
          let compared = 0
          for (const ours of cardsAfterMatch) {
            const theirs = officialAfter.find((card) => card.title === ours.title)
            if (theirs === undefined) {
              check.ok(`装配页那张「${ours.title}」在官方页上也找得到（同一次量得到）`, false, JSON.stringify(officialAfter.map((card) => card.title)))
              continue
            }
            check.fact(
              `卡片「${ours.title}」：装配页 ${String(ours.width)}x${String(ours.height)}（内容 ${String(ours.contentHeight)}，nonce=${String(ours.stamped)}）、` +
                `官方页 ${String(theirs.width)}x${String(theirs.height)}（内容 ${String(theirs.contentHeight)}）；` +
                `两侧那份 srcdoc ${ours.srcdoc === theirs.srcdoc ? '逐字相同' : `逐字不同（装配页 ${String(ours.srcdoc.length)} 字符、官方页 ${String(theirs.srcdoc.length)} 字符——两份都是插件按当页的宿主主题自己生成的，不是本页改写）`}`,
            )
            check.ok(
              `卡片「${ours.title}」：装配页那份按内容撑开（高度 = 帧内容高度，±2px）`,
              ours.contentHeight > 0 && ours.height >= ours.contentHeight - 2,
              `卡片高 ${String(ours.height)}、内容高 ${String(ours.contentHeight)}（修前这里停在插件最小高度 48）`,
            )
            check.ok(
              `卡片「${ours.title}」：本页没有改它的 srcdoc（#188 起本页不补 nonce、不动插件写下的帧）`,
              ours.stamped === false,
              `装配页 nonce=${String(ours.stamped)}、官方页 nonce=${String(theirs.stamped)}（#188 之前这一条判的是「装配页带、官方页不带」）`,
            )
            if (widthMatched) {
              compared += 1
              check.ok(
                `卡片「${ours.title}」：与官方页那一份同值（±2px，两侧卡片同宽）`,
                Math.abs(ours.height - theirs.height) <= 2,
                `装配页 ${String(ours.height)}、官方页 ${String(theirs.height)}`,
              )
            }
          }
          if (!widthMatched) {
            check.fact('两侧卡片宽度没能调到 ±2px：跳过「与官方页同值」那一条，只判「按内容撑开」与「本页不改插件帧」')
          } else {
            check.fact(`「与官方页同值」逐卡判过 ${String(compared)} 张`)
          }
          screenshots.push(await shot(ctx, page, 'html-preview-height-chat'))
          screenshots.push(await shot(ctx, officialPage, 'html-preview-height-official'))
        }
      }

      const gaps = [...opened.capture.pageErrors, ...officialCapture.pageErrors]
      check.ok('全程零 pageerror', gaps.length === 0, JSON.stringify(gaps.slice(0, 5)))
      return screenshots
    } finally {
      await opened?.context.close()
    }
  },
}
