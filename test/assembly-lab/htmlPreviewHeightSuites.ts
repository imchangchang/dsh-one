/**
 * 沙箱 srcdoc 帧的内容高度撑开（#185，HTML-PREVIEW-HEIGHT 套件）。
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
 * 根因（本轮实测，证据在下面两条断言里）：**Chromium 把本页的 CSP 继承给 `srcdoc` 帧**
 * （`srcdoc` 是 local scheme，帧文档没有自己的来源可寻址），于是本页那句
 * `script-src 'nonce-…'` 也管到帧里面去；而帧的 HTML 是插件自己生成的、拿不到本页
 * nonce，帧内内联脚本**一律被判违规**。这类卡片的撑高协议恰好全靠一句帧内内联脚本
 * （量 `document.documentElement.scrollHeight` 再 `parent.postMessage` 回父页），脚本
 * 一被挡住，卡片就永远停在这个插件自己的最小高度上（48px）——官方网关页整页**没有 CSP**，
 * 同一句脚本在官方页照常执行，所以官方页正常、装配页压扁。
 *
 * 修法在 `src/ui/assembly/pageHtml.ts` 的 `srcdocNonceJs`：写 `srcdoc` 时给**声明了隔离
 * 沙箱的帧**（`sandbox` 带 `allow-scripts`、不带 `allow-same-origin`）里每个 `<script>`
 * 打上本页 nonce，与本页自己的内联脚本走同一条政策（「script 必须带 nonce」）；没有
 * `sandbox` 或带 `allow-same-origin` 的帧与本页同源，一个字节都不改（守边界，见下面的
 * 守卫断言）。
 *
 * ## 套件怎么判（两层，都不许写成「高度 > 0」那种橡皮图章）
 *
 * **① 机制层（自足、不吃当天数据）**：往两个页面里各插一个**同样的探针帧**——可见、
 * `sandbox="allow-scripts"`、`srcdoc` 里一个 500px 高的方块 + 一句上报内联脚本。判据：
 * 装配页上探针帧的 `srcdoc` 带上了本页 nonce（机制在场）、并且**真的上报了内容高度 500**
 * （脚本真的跑了）；官方页同一条上报 500（两侧同值）。另外两个守卫帧（
 * `allow-scripts allow-same-origin`、完全不带 `sandbox`）**不许**被打 nonce、也**不许**
 * 上报——这条把「只对隔离沙箱帧补 nonce、本页顶层脚本政策不放开」钉死，防止将来为了
 * 图省事把 `script-src` 整体放宽。
 *
 * **② 真实卡片层（当天网关上有这类卡片时）**：在同一台网关上找**同一批** HTML 预览卡
 * （两侧按 `iframe@sandbox` + 非空 `srcdoc` 认，按 `title` 配对），先让帧在**可见**状态下
 * 重新载入（先点开它所在的 `turn-process` 折叠组，再重写一次 `srcdoc` 属性——同一动作
 * 两侧各做一遍），然后逐卡比较：
 * - 卡片高度 = 帧文档的内容高度（±2px）——就是用户要的那一条，改前这里是 48 vs 747；
 * - 卡片高度 = 官方页那一份（±2px）——两侧先按视口把**卡片宽度**调到一致（宽度不同内容
 *   高度本来就不同，拿不同宽的两份比高度没有意义），调不到就记事实并跳过这一条；
 * - 机制证据：装配页那份卡片帧的 `srcdoc` 带 nonce，官方页那份不带（官方页没有 CSP）。
 *
 * **为什么这一档的数据面必须是用户日常实例**：卡片是 `@dsh-external/dsh-visualize`
 * 在用户 profile 里装的插件渲染的，空实例上没有它、也没有这段历史会话；日常实例上
 * **只读**（只开页与量几何，不点任何会写网关的东西）。
 *
 * **为什么「先点开折叠组再重载帧」这一步是必须的、也是两侧同做的**：这类插件的撑高协议
 * 只在**帧载入那一刻**量一次（它的 `ResizeObserver` 观察的是帧的根元素，之后内容变化不会
 * 再触发），所以帧在「折叠着（`hidden="until-found"`）」状态下挂载时量到的是 0，之后再也
 * 不重来——**这一条官方页同样如此**（实验室里两侧都点开折叠组、再各自重载帧，就是把这
 * 两个页面放回用户在官方页看到完整卡片时的处境：帧可见时载入）。判据因此不含「哪一侧更
 * 会挑时机」，只判「同样条件下两边的结果」。
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

/** 视口高度（三档宽度都用它；高度不参与判据，固定住只为让读数可比）。 */
const VIEWPORT_HEIGHT = 900
/** 装配页起手宽度（卡片宽度随后再按官方那一份校正，见 matchCardWidth）。 */
const CHAT_START_WIDTH = 1050
/** 官方页起手宽度（官方页自带侧栏，卡片比装配页窄一截）。 */
const OFFICIAL_WIDTH = 1280

/** 探针帧名（token 与 title 都按它派生，三个帧各判各的）。 */
const PROBE_NAMES = ['isolated', 'sameOrigin', 'bare'] as const
type ProbeName = (typeof PROBE_NAMES)[number]
/** 探针帧的内容高度（判据按它算，不写「> 0」）。 */
const PROBE_CONTENT_HEIGHT = 500

/**
 * 一个探针帧的 srcdoc：500px 的方块 + 一句量高上报的内联脚本。
 * token 按帧名派生，父页就能分开判「哪一帧上报了」。
 */
function probeSrcdoc(name: ProbeName): string {
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
 * 往页面里插三个探针帧：`isolated`（本次要修的那一类：`sandbox="allow-scripts"`）、
 * `sameOrigin`（`allow-scripts allow-same-origin`）与 `bare`（完全不带 `sandbox`）。
 *
 * 三个都插在**固定定位、可见**的容器里——帧的撑高协议只在载入那一刻量一次，藏在
 * 折叠内容里的帧量到的是 0（见文件头），所以探针必须是载入即可见的。
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
    const make = (probe: { name: string; sandbox: string | null; srcdoc: string }): void => {
      const frame = document.createElement('iframe')
      frame.setAttribute('title', probe.name)
      frame.style.cssText = 'display:block;width:200px;height:40px;border:0'
      if (probe.sandbox !== null) frame.setAttribute('sandbox', probe.sandbox)
      frame.setAttribute('srcdoc', probe.srcdoc)
      holder.appendChild(frame)
    }
    for (const probe of probes.frames) make(probe)
    await new Promise((resolve) => setTimeout(resolve, 2500))
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
    frames: PROBE_NAMES.map((name) => ({
      name: `lab-185-${name}`,
      token: `lab-185-${name}`,
      sandbox: name === 'bare' ? null : name === 'isolated' ? 'allow-scripts' : 'allow-scripts allow-same-origin',
      srcdoc: probeSrcdoc(name),
    })),
  })
}

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
  const dom = await page.evaluate(() =>
    Array.from(document.querySelectorAll('iframe'))
      .filter((frame) => (frame.getAttribute('srcdoc') ?? '') !== '')
      // 本套件自己的探针帧（`lab-185-*`）不算卡片；它是 ① 机制层的夹具。
      .filter((frame) => (frame.getAttribute('title') ?? '').startsWith('lab-185-') === false)
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
  )
  const contents = new Map<string, number>()
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue
    const title = await frame.title().catch(() => '')
    if (title === '') continue
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
  await page.evaluate(() => {
    for (const frame of Array.from(document.querySelectorAll('iframe'))) {
      const srcdoc = frame.getAttribute('srcdoc') ?? ''
      if (srcdoc === '') continue
      frame.setAttribute('srcdoc', srcdoc)
    }
  })
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
    '真网关**只读** + 假宿主。① **机制层（自足）**：装配页与官方网关页各插一个**同样的、载入即可见的**探针帧（`sandbox="allow-scripts"` + `srcdoc` 里 500px 内容 + 一句量高上报的内联脚本）——装配页上它的 `srcdoc` 带上了本页 CSP 的 nonce（页面的 `srcdoc` 补 nonce 机制在场）、并且真的上报了内容高度 500（帧内内联脚本真的执行了，这正是 #185 的坏点：修前这里一条上报都没有）；官方页那一条上报同样是 500（两侧同值）。另两个守卫帧（`allow-scripts allow-same-origin`、完全不带 `sandbox`）**不许**被打 nonce、也**不许**上报——「只给隔离沙箱帧补 nonce、本页 `script-src` 不放开」这条边界被钉住。② **真实卡片层（当天网关上有这类卡片时）**：把两侧的 HTML 预览卡（按 `iframe` + 非空 `srcdoc` 认、按 `title` 配对）先点开所在的折叠组、再让帧在可见状态下重载一次（同一动作两侧各做一遍），然后逐卡判：**卡片高度 = 帧文档内容高度（±2px）**（修前是 48px vs 747px）、**卡片高度 = 官方页那一份（±2px）**（两侧先按视口把卡片宽度调到一致，宽度对不上时记事实并跳过这一条）、装配页那份的 `srcdoc` 带 nonce 而官方页那份不带。当天网关上没有这类卡片时（空实例、或用户没装可视化插件）这一层只记事实并跳过。全程零 pageerror。',
  run: async (ctx, check) => {
    const candidates = await listSessions(ctx.lab.gateway)
      .then((rows) => rows.filter((row) => row.blank !== true && row.running !== true).slice(0, 3))
      .catch(() => [])
    const screenshots: string[] = []
    let opened: OpenedPage | undefined
    try {
      // 开一页 chat 装配页：挑今天**有 HTML 预览卡**的那条会话（最多试三条候选——卡片是
      // 用户装了可视化插件、且会话里用过它才有的，哪条有是当天的数据事实）。找不到就只在
      // 第一条候选上跑机制层。
      for (const candidate of [...candidates, undefined]) {
        opened = await openTreePage(ctx.browser, ctx.lab, route('chat'), {
          ...(candidate === undefined ? {} : { sessionId: candidate.sessionId }),
          width: CHAT_START_WIDTH,
          height: VIEWPORT_HEIGHT,
          settleMs: 6_000,
        })
        const found = (await readCards(opened.page)).filter((card) => card.width > 0)
        if (found.length > 0 || candidate === undefined) {
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
      check.ok(
        '守卫：同源（allow-same-origin）的 srcdoc 帧一个字节都没被改',
        chatProbe.stamped['lab-185-sameOrigin'] === false,
        JSON.stringify(chatProbe.stamped),
      )
      check.ok(
        '守卫：不带 sandbox 的 srcdoc 帧一个字节都没被改',
        chatProbe.stamped['lab-185-bare'] === false,
        JSON.stringify(chatProbe.stamped),
      )
      check.ok(
        '守卫：这两类帧的内联脚本照旧被挡住（各自都没上报）——本页顶层 script-src 没被放宽',
        chatProbe.reported['lab-185-sameOrigin'] === -1 && chatProbe.reported['lab-185-bare'] === -1,
        `三帧各自上报的高度 ${JSON.stringify(chatProbe.reported)}（只有 isolated 那一帧该有值）`,
      )
      screenshots.push(await shot(ctx, opened.page, 'html-preview-height-probe-chat'))

      // ---- ② 真实卡片层 ----
      const chatCards = (await readCards(page)).filter((card) => card.width > 0)
      check.fact(
        `装配页上的 HTML 预览卡 ${String(chatCards.length)} 张：${JSON.stringify(chatCards.map((card) => `${card.title} ${String(card.width)}x${String(card.height)}`))}`,
      )
      if (chatCards.length === 0) {
        check.fact('当天网关上没有 HTML 预览卡（空实例 / 没装可视化插件）：真实卡片那一层只记事实')
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
        screenshots.push(await shot(ctx, opened.page, 'html-preview-height-chat'))
        screenshots.push(await shot(ctx, officialPage, 'html-preview-height-official'))
      }

      const gaps = [...opened.capture.pageErrors, ...officialCapture.pageErrors]
      check.ok('全程零 pageerror', gaps.length === 0, JSON.stringify(gaps.slice(0, 5)))
      return screenshots
    } finally {
      await opened?.context.close()
    }
  },
}
