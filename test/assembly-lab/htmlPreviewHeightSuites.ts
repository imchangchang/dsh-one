/**
 * 沙箱 srcdoc 帧的内容高度撑开（#185，HTML-PREVIEW-HEIGHT 套件；#193 补自足的夹具卡层）。
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
 * 根因（#185 实测）：**Chromium 把本页的 CSP 继承给 `srcdoc` 帧**（`srcdoc` 是 local
 * scheme，帧文档没有自己的来源可寻址），于是本页那句 `script-src 'nonce-…'` 也管到帧
 * 里面去；而帧的 HTML 是插件自己生成的、拿不到本页 nonce，帧内内联脚本**一律被判违规**。
 * 这类卡片的撑高协议恰好全靠一句帧内内联脚本（量 `document.documentElement.scrollHeight`
 * 再 `parent.postMessage` 回父页），脚本一被挡住，卡片就永远停在这个插件自己的最小高度上
 * （48px）——官方网关页整页**没有 CSP**，同一句脚本在官方页照常执行，所以官方页正常、
 * 装配页压扁。
 *
 * 修法在 `src/ui/assembly/pageHtml.ts` 的 `srcdocNonceJs`：写 `srcdoc` 时给**声明了隔离
 * 沙箱的帧**（`sandbox` 带 `allow-scripts`、不带 `allow-same-origin`）里每个 `<script>`
 * 打上本页 nonce，与本页自己的内联脚本走同一条政策（「script 必须带 nonce」）；没有
 * `sandbox` 或带 `allow-same-origin` 的帧与本页同源，一个字节都不改（守边界，见下面的
 * 守卫断言）。
 *
 * ## 套件怎么判（三层，都不许写成「高度 > 0」那种橡皮图章）
 *
 * **① 机制层（自足）**：往两个页面里各插一个**同样的探针帧**——可见、
 * `sandbox="allow-scripts"`、`srcdoc` 里一个 500px 高的方块 + 一句上报内联脚本。判据：
 * 装配页上探针帧的 `srcdoc` 带上了本页 nonce（机制在场）、并且**真的上报了内容高度 500**
 * （脚本真的跑了）；官方页同一条上报 500（两侧同值）。另外两个守卫帧
 * （`allow-scripts allow-same-origin`、完全不带 `sandbox`）**不许**被打 nonce、也**不许**
 * 上报——这条把「只对隔离沙箱帧补 nonce、本页顶层脚本政策不放开」钉死，防止将来为了
 * 图省事把 `script-src` 整体放宽。
 *
 * **② 夹具卡层（自足，默认跑法里就覆盖用户报的那一层）**：见下面「夹具卡」那一节。
 *
 * **③ 真实卡片层（只在 `--gateway` 连外部实例时跑）**：在同一台网关上找**同一批** HTML
 * 预览卡（两侧按 `iframe@sandbox` + 非空 `srcdoc` 认，按 `title` 配对），先让帧在**可见**
 * 状态下重新载入（先点开它所在的 `turn-process` 折叠组，再重写一次 `srcdoc` 属性——同一
 * 动作两侧各做一遍），然后逐卡比较：卡片高度 = 帧文档的内容高度（±2px）、卡片高度 =
 * 官方页那一份（±2px，两侧先按视口把卡片宽度调到一致，宽度不同内容高度本来就不同）、
 * 装配页那份的 `srcdoc` 带 nonce 而官方页那份不带。
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
 *   ——正是本页补 nonce 覆盖的那一档（也是唯一能覆盖的档：同源帧不碰）。
 * - **帧文档的形状**：自带一份 `<meta http-equiv="Content-Security-Policy">`（含
 *   `script-src 'unsafe-inline'`）、内联 `<style>`、内容片段，末尾一句内联 `<script>`。
 *   帧自己的 CSP 允许内联脚本，但**本页的 CSP 是继承进来一起判的**——这正是坏点所在，
 *   少了这份自带 CSP 就假不出真插件的处境。
 * - **帧内那句脚本**：`post()` 量 `document.documentElement.scrollHeight` 再
 *   `parent.postMessage({type:'dsh-visualize:height', token, height}, '*')`，并
 *   `new ResizeObserver(post).observe(document.documentElement)` + `addEventListener('load', post)`
 *   ——与真插件的 `heightReporter` 逐句同形（连消息类型都用它那个常量值）。
 * - **父页那份卡片的协议**：高度状态从**插件自己的最小高度 48px** 起（真插件
 *   `MIN_HEIGHT = 48`），只有收到 `type` 与 `token` 都对得上的上报才
 *   `max(48, min(ceil(height), 上限))` 地改写 `iframe.style.height`（上限照抄它的
 *   `HEIGHT_CAP.inline = 800`）。**收不到上报就永远停在 48px**——#185 的坏法就是这个。
 * - **挂载点**：挂在官方对话区里（`[data-conversation-scroll]` 的
 *   `[data-slot="conversation.session"]` 座位，官方 `ui-conversation` 渲染消息流的地方），
 *   与真卡片同处一条布局链（对话区滚动体 + 我们外框的 flex 列）——不是插在一个与对话区
 *   无关的浮层里。
 * - **写 `srcdoc` 的路径**：`frame.setAttribute('srcdoc', …)`，与 React 渲染
 *   `srcDoc` 属性走的是同一条被补 nonce 补丁覆盖的路径。
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
 * 上面这条修法原来只在**写 `srcdoc` 那一刻**读一次 `sandbox`：先写 `sandbox`、后写
 * `srcdoc`（React 按 JSX 属性顺序渲染的结果，真插件与我们造的夹具卡都是这样）那一档读得到；
 * 插件**反过来写**的那一档，写 `srcdoc` 那一刻读到的 `sandbox` 还是 `null`，帧被当成
 * 「没沙箱的帧」放过——帧内脚本照旧被挡住、卡片又停回 48px。现在补这一次有三个落点（都汇到
 * 同一个复核，同一条判据）：写 `srcdoc` 的那一刻先判一次；那一刻还判不出来（`sandbox` 没来）
 * 就在这一轮任务结束时再判一次（同一个任务里写的 `sandbox` 那时已经在了）；帧挂在文档里时，
 * `sandbox` 的任何改动由盯这条属性的属性观察再复核一次（见 `src/ui/assembly/pageHtml.ts` 的
 * `srcdocNonceJs`）。
 *
 * 本套件把这一维也钉住，用的是同一批判据、只把写属性的顺序倒过来（顺带把「沙箱怎么写的」
 * 也覆盖全：正序那批走 `setAttribute`、倒序那批走令牌表 `frame.sandbox.add(...)`——两条
 * 写路径各有一档探针，修法里对应两处不同的时机）：
 *
 * - **机制层**多三个探针帧：一个隔离沙箱（`sandbox="allow-scripts"`）但**先写 `srcdoc`
 *   后写 `sandbox`**（沙箱那一笔走令牌表）——它也要被打上 nonce、也要上报内容高度 500；
 *   一个同源（`allow-scripts allow-same-origin`）的倒序探针——它同样**不许**被改、
 *   **不许**上报，用来钉「换了判据时机并没有放宽口径」；还有一个先按隔离档写（当场被补上
 *   nonce）、读数之后再**用令牌表**改成同源档——补上去的 nonce 那时候必须被摘回来
 *   （补一次的动作现在两个方向都会写：只许往隔离档补、不许在同源帧上留痕）。
 * - **夹具卡层**多一张**倒序卡**：同一段片段、同一句上报脚本、同一条父页协议、同一个挂载点，
 *   只有写属性的顺序不一样。它也要被打上 nonce、帧内脚本也要跑、卡片也要按内容撑开，
 *   **并且与顺序正常那张同高（±2px）**——写属性的顺序不该改变结果。
 *
 * **改前这一层必红**（负向对照读数见 README）：撤掉「sandbox 落地后回头补一次」那一段，
 * 倒序探针与倒序卡那几条当场红，顺序正常的那一批与两条守卫照旧绿。
 *
 * **判据不许放宽的地方**：夹具卡那一层的每一条都是**无条件**断言——挂不上、帧不报、卡
 * 停在最小高度，都会红；「当天网关上没有这类卡片」这件事**不再**能让任何一条悄悄消失。
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
const LAB_FRAME_TITLE_PREFIXES = ['lab-185-', 'lab-193-', 'lab-196-'] as const

/** 一个帧是不是本套件自己造的（探针帧 / 夹具卡）。 */
function isLabFrame(title: string | null): boolean {
  const value = title ?? ''
  return LAB_FRAME_TITLE_PREFIXES.some((prefix) => value.startsWith(prefix))
}

// ---------------------------------------------------------------------------
// ① 机制层：探针帧（自证「补 nonce」这条机制本身在场）
// ---------------------------------------------------------------------------

/** 帧的两个属性谁先写（#196）：`sandbox-first` 是 React 按 JSX 属性顺序渲染的结果，`srcdoc-first` 是反过来那一档。 */
type AttributeOrder = 'sandbox-first' | 'srcdoc-first'

/** 沙箱怎么写（#196）：`attribute` 走 `setAttribute`（React 与普通 DOM 都走它），`tokenList` 走令牌表（`frame.sandbox.add(...)`，**不**经过 `setAttribute`）。 */
type SandboxWrite = 'attribute' | 'tokenList'

/**
 * 探针帧的六档（token 与 title 都按 name 派生，各帧各判各的）：两档隔离沙箱帧差两维——
 * 写属性的顺序（`srcdoc-first` 那一档用令牌表写沙箱，因此把「谁先写」与「沙箱怎么写的」
 * 两条写路径各钉一档），另三档是守卫（同源两种写属性顺序各一档、完全不带 `sandbox`）。
 * `sameOriginReversed` 这一档是 #196 新加的：判据换了时机之后，紧挨着隔离档的那个同源档
 * 同样不许被碰。另有一帧 `reclassified` 用来判「隔离档改成同源档」那条边（见 `runProbes`）。
 */
const PROBE_SPECS: readonly { name: string; sandbox: string | null; order: AttributeOrder; via: SandboxWrite }[] = [
  { name: 'isolated', sandbox: 'allow-scripts', order: 'sandbox-first', via: 'attribute' },
  { name: 'isolatedReversed', sandbox: 'allow-scripts', order: 'srcdoc-first', via: 'tokenList' },
  { name: 'sameOrigin', sandbox: 'allow-scripts allow-same-origin', order: 'sandbox-first', via: 'attribute' },
  { name: 'sameOriginReversed', sandbox: 'allow-scripts allow-same-origin', order: 'srcdoc-first', via: 'tokenList' },
  { name: 'bare', sandbox: null, order: 'sandbox-first', via: 'attribute' },
  { name: 'reclassified', sandbox: 'allow-scripts', order: 'sandbox-first', via: 'attribute' },
]

/** 那一帧（`reclassified`）会被改成同源档，用来判「补上去的 nonce 要摘回来」。 */
const RECLASSIFIED_PROBE = 'lab-185-reclassified'
/** 探针帧的内容高度（判据按它算，不写「> 0」）。 */
const PROBE_CONTENT_HEIGHT = 500

/**
 * 一个探针帧的 srcdoc：500px 的方块 + 一句量高上报的内联脚本。
 * token 按帧名派生，父页就能分开判「哪一帧上报了」。
 */
function probeSrcdoc(name: string): string {
  return (
    `<body style="margin:0"><div style="width:120px;height:${String(PROBE_CONTENT_HEIGHT)}px;background:#345"></div>` +
    `<script>parent.postMessage({type:"lab-185",token:"lab-185-${name}",height:document.documentElement.scrollHeight},"*")<\/script></body>`
  )
}

interface ProbeResult {
  /** 各探针帧的 srcdoc 里有没有本页 nonce。 */
  stamped: Record<string, boolean>
  /** 各探针帧上报的内容高度（没上报就是 -1）。 */
  reported: Record<string, number>
  /** 本页 CSP meta 里的 nonce（没有 CSP 时为 null）。 */
  pageNonce: string | null
}

/**
 * 往页面里插六个探针帧（#185 三档 + #196 两档 + 一档「隔离改成同源」）：隔离沙箱的两档
 * （`isolated` / `isolatedReversed`：`sandbox="allow-scripts"`，前者按「先 sandbox 后
 * srcdoc + `setAttribute`」写、后者按「先 srcdoc 后 sandbox + 令牌表」写，两维各钉一档）、
 * 同源的两档（`sameOrigin` / `sameOriginReversed`：`allow-scripts allow-same-origin`）、
 * `bare`（完全不带 `sandbox`）与 `reclassified`（先按隔离档写、读一遍读数之后再**用令牌表**
 * 改成同源档，判「补上去的 nonce 有没有摘回来」）。
 *
 * 六个都插在**固定定位、可见**的容器里——帧的撑高协议只在载入那一刻量一次，藏在
 * 折叠内容里的帧量到的是 0（见文件头），所以探针必须是载入即可见的。属性都写在**挂进
 * 文档之前**（`make` 里写完才 `appendChild`），插件先建节点再插进去时就是这么走的。
 */
async function runProbes(page: OpenedPage['page']): Promise<ProbeResult> {
  return page.evaluate(async (probes) => {
    const holder = document.createElement('div')
    holder.id = 'lab-185-probes'
    holder.style.cssText = 'position:fixed;left:0;bottom:0;width:200px;z-index:2147483000'
    document.body.appendChild(holder)
    const heights = new Map<string, number>()
    window.addEventListener('message', (event) => {
      const data = event.data as { type?: string; token?: string; height?: number } | null
      if (data === null || typeof data !== 'object') return
      if (data.type !== 'lab-185' || typeof data.height !== 'number') return
      heights.set(String(data.token), data.height)
    })
    const make = (probe: { name: string; sandbox: string | null; order: string; via: string; srcdoc: string }): void => {
      const frame = document.createElement('iframe')
      frame.setAttribute('title', probe.name)
      frame.style.cssText = 'display:block;width:200px;height:40px;border:0'
      const sandbox = (): void => {
        if (probe.sandbox === null) return
        // 沙箱怎么写的也是两条不同的路径，各有一档探针：`setAttribute`（React 与普通 DOM 都走它）
        // 与令牌表 `frame.sandbox.add(...)`（不走 `setAttribute`，只有属性观察看得见）。
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
    // 那一帧从隔离档改成同源档：补上去的 nonce 这时候要摘掉（边界两侧都不留痕）。
    // 用令牌表改（不走 `setAttribute`）——这一档只有「盯 sandbox 属性的属性观察」看得见。
    const reclassifiedFrame = holder.querySelector(`iframe[title="${probes.reclassified}"]`)
    if (reclassifiedFrame instanceof HTMLIFrameElement) reclassifiedFrame.sandbox.add('allow-same-origin')
    await new Promise((resolve) => setTimeout(resolve, 500))
    const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? ''
    const nonce = /'nonce-([^']+)'/.exec(meta)?.[1] ?? null
    const stamped: Record<string, boolean> = {}
    const reported: Record<string, number> = {}
    for (const probe of probes.frames) {
      const frame = holder.querySelector(`iframe[title="${probe.name}"]`)
      const srcdoc = frame?.getAttribute('srcdoc') ?? ''
      stamped[probe.name] = nonce !== null && srcdoc.includes(`nonce="${nonce}"`)
      reported[probe.name] = heights.get(probe.token) ?? -1
    }
    return { stamped, reported, pageNonce: nonce }
  }, {
    reclassified: RECLASSIFIED_PROBE,
    frames: PROBE_SPECS.map((spec) => ({
      name: `lab-185-${spec.name}`,
      token: `lab-185-${spec.name}`,
      sandbox: spec.sandbox,
      order: spec.order,
      via: spec.via,
      srcdoc: probeSrcdoc(spec.name),
    })),
  })
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
  /** 卡片帧的 `srcdoc` 里有没有本页 nonce。 */
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
 * 会话滚动体）里的 `[data-slot="conversation.session"]` 座位（官方渲染消息流的地方）——
 * 取不到座位就退到滚动体本身，并把实际用的挂载点如实返回（读数进报告，不静默降级）。
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
        return {
          title: frame.getAttribute('title') ?? '',
          height: Math.round(rect.height * 100) / 100,
          width: Math.round(rect.width * 100) / 100,
          stamped: (frame.getAttribute('srcdoc') ?? '').includes('nonce='),
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
  name: 'HTML 预览卡（沙箱 srcdoc 帧）在装配页里按内容撑开，与官方页那一份同值（HTML-PREVIEW-HEIGHT 套件）',
  expect:
    '真网关 + 假宿主（默认跑法是实验室自起的隔离实例）。① **机制层（自足）**：装配页与官方网关页各插一个**同样的、载入即可见的**探针帧（`sandbox="allow-scripts"` + `srcdoc` 里 500px 内容 + 一句量高上报的内联脚本）——装配页上它的 `srcdoc` 带上了本页 CSP 的 nonce（页面的 `srcdoc` 补 nonce 机制在场）、并且真的上报了内容高度 500（帧内内联脚本真的执行了，这正是 #185 的坏点：修前这里一条上报都没有）；官方页那一条上报同样是 500（两侧同值）。另两个守卫帧（`allow-scripts allow-same-origin`、完全不带 `sandbox`）**不许**被打 nonce、也**不许**上报——「只给隔离沙箱帧补 nonce、本页 `script-src` 不放开」这条边界被钉住。#196 再加两帧：同一档隔离沙箱帧但**先写 `srcdoc`、后写 `sandbox`**——它同样要被补上 nonce、同样要上报 500（改前这一帧不被补、也不上报，卡片就是这么又停回 48px 的）；同源的守卫帧两种写属性顺序各一帧，都不许被改、不许上报（判据换了时机也没放宽）；另有一帧先按隔离档写（当场被补上 nonce）、读数之后再改成同源档——那时补上去的 nonce 必须被摘回来，`srcdoc` 还原成插件写的那一份。② **夹具卡层（自足，覆盖用户报的那一层）**：两侧的官方对话区里各挂一张**与 `@dsh-external/dsh-visualize` 同形**的夹具卡（挂在 `[data-conversation-scroll]` 的 `conversation.session` 座位上；`iframe sandbox="allow-scripts"`、帧文档自带一份含 `unsafe-inline` 的 CSP meta、帧内一句量 `documentElement.scrollHeight` 再 `parent.postMessage` 的上报脚本、父页侧高度从插件最小高度 48px 起、只有收到对得上的上报才涨）。判据：装配页那份的 `srcdoc` 带上本页 nonce（机制在场）、帧内脚本真的执行了（父页收到上报）、帧文档渲染出完整内容（内容高度 = 夹具自己声明的 608px）、**卡片高度 ≥ 帧内容高度（±2px）**（#185 的用户判据）、**卡片没有停在 48px 最小高度上**（#185 的具体坏法）、装配页那一份与官方页那一份**同高（±2px）**、官方页那份的 `srcdoc` 一个字节没被改（官方页没有 CSP，不需要补）。这一层的每一条都是无条件断言——挂不上、帧不报、卡停住都判红，不再随当天网关有没有真实卡片而增减。#196 在同一处再挂一张**倒序卡**（同一段片段、同一句上报脚本、同一条父页协议、同一个挂载点，只把写属性的顺序倒过来：先 `srcdoc` 后 `sandbox`）：它也要挂进对话区、也要被补上 nonce、帧内脚本也要跑、也要按内容撑开、也不能停在 48px、**并且与正序那张同高（±2px）**，官方页那份同样一个字节没被改。③ **真实卡片层（只在 `--gateway` 连外部实例时跑）**：两侧的 HTML 预览卡（按 `iframe` + 非空 `srcdoc` 认、按 `title` 配对）先点开所在的折叠组、再让帧在可见状态下重载一次（同一动作两侧各做一遍），然后逐卡判：卡片高度 = 帧文档内容高度（±2px）、卡片高度 = 官方页那一份（±2px，两侧先按视口把卡片宽度调到一致，宽度对不上时记事实并跳过这一条）、装配页那份的 `srcdoc` 带 nonce 而官方页那份不带。默认跑法（自起隔离实例）里没有第三方插件的卡片，这一层如实记一条事实说明只在外部实例模式跑（#193）。全程零 pageerror。',
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

      // ---- ① 机制层：探针帧 ----
      const chatProbe = await runProbes(page)
      const officialProbe = await runProbes(officialPage)
      check.fact(
        `装配页 CSP nonce=${chatProbe.pageNonce === null ? '（没有 CSP meta）' : '在场'}；` +
          `探针 srcdoc 带 nonce：${JSON.stringify(chatProbe.stamped)}；` +
          `官方页探针 srcdoc 带 nonce：${JSON.stringify(officialProbe.stamped)}`,
      )
      check.ok(
        '装配页：给了沙箱（allow-scripts、无 allow-same-origin）的 srcdoc 帧被打上本页 nonce',
        chatProbe.pageNonce !== null && chatProbe.stamped['lab-185-isolated'] === true,
        JSON.stringify(chatProbe.stamped),
      )
      const chatProbeHeight = chatProbe.reported['lab-185-isolated'] ?? -1
      const officialProbeHeight = officialProbe.reported['lab-185-isolated'] ?? -1
      check.ok(
        '装配页：探针帧的内联脚本真的跑了（上报了内容高度，不是被 CSP 挡住）',
        chatProbeHeight >= PROBE_CONTENT_HEIGHT - 2,
        `上报 ${String(chatProbeHeight)}（期望 ≥ ${String(PROBE_CONTENT_HEIGHT - 2)}，修前这里是 -1：一条上报都没有）`,
      )
      check.ok(
        '官方页：同一条探针上报同样的内容高度（两侧同值）',
        officialProbeHeight >= PROBE_CONTENT_HEIGHT - 2 && Math.abs(officialProbeHeight - chatProbeHeight) <= 2,
        `装配页 ${String(chatProbeHeight)}、官方页 ${String(officialProbeHeight)}`,
      )
      // #196：同一档隔离沙箱帧，只把写属性的顺序倒过来（先 srcdoc 后 sandbox），而且沙箱那一笔
      // 走令牌表（`frame.sandbox.add`，与 `setAttribute` 是两条不同的写路径——两条都要覆盖）。
      check.ok(
        '装配页：先写 `srcdoc`、后写 `sandbox` 的隔离沙箱帧（沙箱走令牌表那一档），`sandbox` 落地后也补上了本页 nonce（#196 的负向对照）',
        chatProbe.stamped['lab-185-isolatedReversed'] === true,
        `倒序那一帧带 nonce=${String(chatProbe.stamped['lab-185-isolatedReversed'])}（改前这里是 false：写 srcdoc 那一刻读到的 sandbox 还是 null）`,
      )
      const chatReversedProbeHeight = chatProbe.reported['lab-185-isolatedReversed'] ?? -1
      check.ok(
        '装配页：倒序那一帧的内联脚本照常执行（上报了内容高度，与正序那一帧同值）',
        chatReversedProbeHeight >= PROBE_CONTENT_HEIGHT - 2 && Math.abs(chatReversedProbeHeight - chatProbeHeight) <= 2,
        `倒序（令牌表写沙箱）${String(chatReversedProbeHeight)}、正序 ${String(chatProbeHeight)}（期望都 ≥ ${String(PROBE_CONTENT_HEIGHT - 2)}，改前倒序这里是 -1）`,
      )
      check.ok(
        '守卫：同源（allow-same-origin）的 srcdoc 帧一个字节都没被改——两种写属性顺序各一帧',
        chatProbe.stamped['lab-185-sameOrigin'] === false && chatProbe.stamped['lab-185-sameOriginReversed'] === false,
        JSON.stringify(chatProbe.stamped),
      )
      check.ok(
        '守卫：不带 sandbox 的 srcdoc 帧一个字节都没被改',
        chatProbe.stamped['lab-185-bare'] === false,
        JSON.stringify(chatProbe.stamped),
      )
      const guardedProbes = ['lab-185-sameOrigin', 'lab-185-sameOriginReversed', 'lab-185-bare']
      check.ok(
        '守卫：这几类帧的内联脚本照旧被挡住（各自都没上报）——本页顶层 script-src 没被放宽',
        guardedProbes.every((name) => (chatProbe.reported[name] ?? -1) === -1),
        `六帧各自上报的高度 ${JSON.stringify(chatProbe.reported)}（只有两个隔离沙箱帧该有值）`,
      )
      check.ok(
        '守卫：帧从隔离档改成同源档之后（改档那一笔走令牌表），补上去的 nonce 被摘掉了（`srcdoc` 还原成插件写的那一份）',
        chatProbe.stamped[RECLASSIFIED_PROBE] === false,
        `改档之后带 nonce=${String(chatProbe.stamped[RECLASSIFIED_PROBE])}（改前这里是 true：补上去的 nonce 会留在已经变成同源的帧上）`,
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
        '夹具卡：装配页那份的 `srcdoc` 带上了本页 nonce（补 nonce 机制覆盖到这张卡）',
        chatCard.stamped,
        `装配页 nonce=${String(chatCard.stamped)}`,
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
        '夹具卡（倒序）：装配页那份的 `srcdoc` 也被补上本页 nonce（#196 的负向对照）',
        chatReversedCard.stamped,
        `装配页 nonce=${String(chatReversedCard.stamped)}（改前这里是 false，卡片因此停在 ${String(CARD_MIN_HEIGHT)}px）`,
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
        '夹具卡（倒序）：官方页那份的 `srcdoc` 一个字节没被改（官方页没有 CSP，哪种顺序都不需要补）',
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
                `官方页 ${String(theirs.width)}x${String(theirs.height)}（内容 ${String(theirs.contentHeight)}）`,
            )
            check.ok(
              `卡片「${ours.title}」：装配页那份按内容撑开（高度 = 帧内容高度，±2px）`,
              ours.contentHeight > 0 && ours.height >= ours.contentHeight - 2,
              `卡片高 ${String(ours.height)}、内容高 ${String(ours.contentHeight)}（修前这里停在插件最小高度 48）`,
            )
            check.ok(
              `卡片「${ours.title}」：装配页那份的 srcdoc 带本页 nonce（官方页那份不带——官方页没有 CSP）`,
              ours.stamped && !theirs.stamped,
              `装配页 nonce=${String(ours.stamped)}、官方页 nonce=${String(theirs.stamped)}`,
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
            check.fact('两侧卡片宽度没能调到 ±2px：跳过「与官方页同值」那一条，只判「按内容撑开」与机制在场')
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
