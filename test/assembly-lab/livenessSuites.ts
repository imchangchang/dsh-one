/**
 * 交互活性探针（#156）：把「点一下有没有可观测反应」变成一条常驻断言。
 *
 * 现场（用户报的）：composer 左下那枚 **＋（悬停提示「添加文件或调用指令」）点了没反应**——
 * 气泡出得来（hover 命中没问题），点下去什么也不发生。用户同时说「这类问题还挺多的」，
 * 所以本条要的不是修一个按钮，而是**一条能自己抓住这一类问题的判据**。
 *
 * ## 这一套件判什么
 *
 * 对一批**指定的交互点**逐个做「悬停 → 拍基线 → 点一下 → 等 1200 毫秒 → 再拍一次」，
 * 只要下列任一路信号响了就算「有反应」（前四路判的是**结构变没变**，后两路是 #170 补的
 * **文字与样式/属性**）：
 *   - DOM 里新增/移除了**有意义的元素**（脚本、样式、tooltip 这类噪音按标记滤掉）；
 *   - 弹层出现（`role=menu/listbox/dialog` 计数变化，菜单常常只是换个可见性）；
 *   - 宿主通道有新消息（能力口调用与 postMessage 计数）；
 *   - 语义上行有新消息（`assembly:log` 这类页面自身的诊断不算——每次点击都发一条）；
 *   - **文字变了**（`characterData` 突变：例如官方字号步进器里那个 `<span>{fontSize}</span>`，
 *     点一下变的是**同一个文字节点的 `nodeValue`**，从 14 变 15）；
 *   - **样式 / 属性变了**（`attributes` 突变：例如字号与主题这类偏好只改 CSS 变量或 class）。
 *
 * ## 为什么补上「文字 / 属性」（#170）
 *
 * 现场：官方设置页的「增大字号」被这一套判成「点了没反应」。查下来不是控件坏了，是探针的
 * 观察粒度不够——`MutationObserver` 只声明了 `{childList: true, subtree: true}`，而那个控件
 * 点一下改的正是同一个文字节点的 `nodeValue` 加样式，两样都不在观察范围内。只改文字、或
 * 只改样式的控件在设置页里是一大类（字号、主题、各种偏好），这一路判红全是**假红**。
 *
 * issue 给的三条路里（① 观察器补 `characterData` / `attributes`；② 每个交互点自带一条读数；
 * ③ 白名单「只改样式/文字」一类）**选的是 ①，并按套件原有的「末态」口径实现**：
 *   - ② 要给每个交互点各写一条读数（读 `getComputedStyle`、读某枚 `.value` 的文本），判据长度
 *     随交互点数线性增长，而且每条读数都是**我们自己猜**「这个控件该改哪一处」；猜错（控件换了
 *     实现）就又是一条假红。① 观察的是**用户看得见的那两类变化**（页面上的字变了、样式变了），
 *     与具体控件无关，以后新增交互点不用再写读数。
 *   - ③ 等于把这一类控件排除在判据之外、放弃对它们的覆盖，以后新长出来的同类控件一律抓不到
 *     （issue 正文明列了这条缺点）。
 *   - ① 的风险是**判据变松**（页面自己那点风吹草动都算反应），所以配了下面这组常驻护栏。
 *
 * **但这两路不是无条件算数**：一条交互点**算「有反应」的那几路信号由它自己声明**（交互点表
 * 里的 `signals`），**缺省仍是只看结构的那四路**（也就是 #170 之前的口径）。理由：期望是「弹层
 * 开出来 / 内容切过去」的那些点，一旦把文字/属性也算成反应，「弹层其实没开、只是按钮上
 * `aria-expanded` 翻了一下」这类回归就从判据里溜走了——那正是这一套最初要抓的东西（#156 的
 * ＋）。所以**假红**这一头由交互点表自己敞开：反应本来就只出在文字或样式上的控件（官方设置
 * 页的字号步进器那一类）写 `signals: ALL_SIGNALS`。今天这三棵树上**没有**已点交互点需要它
 * ——把观察器改回只声明 `childList` 再跑一遍量过：48 条里红的只有下面那组对照件的两条「按
 * 现在的读法判绿」，其余 46 条（含三棵树全部真实交互点）逐条同值。这条口径以后怎么用、
 * 以及「需要它时怎么证」由下面的对照件守着。
 *
 * ## 探针自己的对照件（`runProbeFixtures`，在设置页上真跑）
 *
 * 「文字 / 属性这两路真的看得见吗、看见了会不会把不该放过的也放过」不是靠读代码相信，是靠
 * 实测——设置页末尾就地装五枚合成控件（只是页面上就地挂几个节点，点它们不碰网关、跑完摘掉），
 * 逐条判（装的与判的都在套件里，谁哪天把观察粒度改回去，这几条当场红）：
 *   - 「只改文字」「只改样式」两枚**真会变**的控件：按**改前的读法**（只看结构那四路）必须判红、
 *     按**六路全开**必须判绿——这就是 #170 的负向对照（同一轮里两边读数都取，作为常驻证据）；
 *   - 一枚**真·点了没反应**的控件（handler 只把点击数加一，页面一个字节都不改）：点击确实
 *     落下了（计数为 1），读数必须仍是「无反应」——守「判据没被放宽成『点了就算』」，也顺带
 *     证明这一页在 1200 毫秒窗口里没有别的东西在改 DOM / 属性；
 *   - 两枚**闪一下又复原**的控件（改完 250 毫秒再改回去）：读数必须仍是「无反应」——守的是
 *     #156 的现场（composer 的 ＋：菜单开了又立刻自己关掉 = 有变动、没结果），文字/属性这
 *     两路不许把这个口径吃掉。
 *
 * **只写客户端存储的控件不在此列**：本套件不观察 `localStorage`。理由是这类写入对用户不是
 * 「看得见的变化」——只落一份客户端存储、页面上一动不动，用户看到的仍然是「点了没反应」，
 * 那该判红；要覆盖它的动作走页面内夹具与契约断言，而不是把它算成反应。
 *
 * 判据分两种，**都由运行期事实给出，不写死**：
 *
 * 1. **官方页可比的交互点**（composer 那一排、对话区页签、右栏开关）：同一轮里另开一页
 *    **官方页面本身**（网关 origin，实验室能开 `/`），点同一个控件，然后判
 *    「官方有反应 ⇒ 我们也必须有反应」。这样就不会因为「今天这台机器上那个控件本来
 *    就不灵」（例如会话被另一个 dsh 进程占着、见 #145）而误红——那种情形官方页同样不灵，
 *    判据自动置为「只记事实」。
 * 2. **只有我们有的交互点**（侧栏自有树的六枚、设置页各节）：期望是固定的（必须反应），
 *    因为它们的行由我们自己的实现与夹具决定，不依赖当天网关数据。
 *
 * **禁用态那两条**（空草稿时的「发送消息」、回收站计数为 0 时的「清空」）：点它没反应才是
 * 对的——现在它们也归到下面「只观察」那一类（顺带不再点，理由见交互点表）。
 *
 * ## 只观察、绝不点击的那一类（`observeOnly`，#163）
 *
 * 实验室连的是**用户真机上的网关**，所以有些控件「点一下」的后果不在这一页里，而是
 * **经网关落到用户机器上**：官方的会话头 action「在访达中打开工作目录」点下去会 POST
 * 网关的 `/open-in-app/open`，宿主侧再跑 macOS 的 `open <工作目录>`——每跑一轮整轮就在
 * 用户桌面上拉起一次访达（#163 的现场，用户看到的就是「怎么总是有个进程用 Finder 打开
 * 文件夹」）。这类动作越过了「实验室只读」这条底线（#98）：它不写网关数据，但它**动了
 * 用户环境**。
 *
 * 所以交互点分两类，判据不同：
 *   - **可点**：点一下，等反应窗口，看有没有可观测变化（上面那套）；
 *   - **只观察**（`observeOnly` 给了理由的那些）：**一步都不点**，只判「控件在场（可见、
 *     几何非零）」与「这一步没有派发过任何点击」，禁用态、几何、指针落点记进事实。
 *     要覆盖这一类控件的**动作**，正确手段是假宿主 + 契约断言（宿主能力口那一条在假宿主
 *     里被记录下来、不落地），而不是为了覆盖去真点——见 `test/assembly-lab/README.md`
 *     的「只读是什么意思」。
 *
 * 落在这一类的五条（每条的理由写在交互点表里）：会话头的「在访达中打开工作目录」、
 * 设置页的「打开配置文件」与「增大字号」，加上本来就点不动的两枚禁用态（空草稿的发送、
 * 回收站计数 0 时的清空）——它们本来也只是「看一眼禁用态」，顺带不再点。
 *
 * **这条政策只保证「我们的探针不点」**（#163）；它背后的「万一真发了也必须当场红」由
 * #175 的机制级守卫兜底：整轮里**任何一页**发出的请求命中 `harness.ts` 的
 * `NATIVE_SIDE_EFFECT_ROUTES`（拉本机应用 / 用系统默认应用开文件 / 原生选目录面板 /
 * 在真机上起 shell 那几条）就整轮红，与这里点不点无关。两条合起来才是闭环——枚举会漏，
 * 判据不会。跑法与复现方法见 `README.md` 的「只读与不动用户机器」那一节。
 *
 * ## 第一例（＋）的专门断言：不许静默
 *
 * ＋ 的「没反应」不是禁用态导致的（按钮 `disabled=false`），而是**菜单开了又立刻自己关掉**：
 * 官方 `ui-input-trigger` 的候选菜单只有一个 source（`command`），source 一失败，
 * reducer 就把这一组摘掉、没有组剩下了菜单自动关闭，全程唯一痕迹是**一行 console.error**。
 * 所以套件对 ＋ 另加三条：
 *   - 按钮**不是禁用态**（排掉「本来就点不动」这一种解释）；
 *   - 没反应时，页面上必须留下**能指名道姓的那一行**（哪个 source 失败、什么原因）——
 *     这一条把「静默失败」变成「有据可查的失败」；
 *   - **正向对照**（页面内就地摘掉违规贡献后必须恢复）：官方 `commandUi.register` 的
 *     契约要求贡献带 `available`（`lib/types/client/contract.d.ts` 的
 *     `CommandContribution`），而官方 `candidates()` 直接 `contribution.available(session)`。
 *     一旦有插件交了不带 `available` 的贡献（现场实测：`@dsh-one/dsh-llm-provider`
 *     注册的 `/model`），整条 `/` 候选列表就会 `TypeError` 整批失败。套件在页面里
 *     抓根 ctx（与 harness 的 fiber 探针同一手法）、把这类贡献摘掉再点一次：**必须恢复**。
 *     环境本身不可用（会话被别的进程占着、`command directory warmup failed`）时这一条
 *     只记事实——那是 #145 那条已知情形，不是本条要判的东西。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import type { BrowserContext, Page } from 'playwright'
import {
  capturePage,
  openTreePage,
  texts,
  withoutKnownNoise,
  type Check,
} from './harness.ts'
import { fakeHostScript } from './fakeHost.ts'
import { LAB_TREES, type LabTreeRoute } from './labServer.ts'
import { cookieHeader } from '../../src/server/assemblyMirror.ts'
import { listSessions, sessionCompletedTurns } from '../../src/server/dshRpc.ts'
import type { LabSuite, SuiteContext } from './suites.ts'

const route = (name: string): LabTreeRoute => {
  const found = LAB_TREES.find((candidate) => candidate.route === name)
  if (found === undefined) throw new Error(`lab: unknown tree route ${name}`)
  return found
}

async function shot(ctx: SuiteContext, page: Page, name: string): Promise<string> {
  const file = path.join(ctx.shots, `${name}.png`)
  await fsp.mkdir(ctx.shots, { recursive: true })
  await page.screenshot({ path: file })
  return file
}

/** 点下去之后等多久看变化（毫秒）——判据里的 N。 */
const REACTION_WINDOW_MS = 1200
/** 悬停之后等气泡出来再拍基线（官方 Tooltip 的 delayMs 是 500）。 */
const HOVER_SETTLE_MS = 800

// ---------------------------------------------------------------------------
// 页面侧记录器
// ---------------------------------------------------------------------------

/**
 * 活性记录器：只记**有意义的** DOM 变化。
 *
 * 为什么必须过滤：① 页面自己会周期性地插 `<script>`/`<style>`（与点击无关）；
 * ② 鼠标移上去会出官方 Tooltip（`role="tooltip"`），点下去它又会消失——两者都不是
 * 「这个控件干了什么」。滤掉这两类之后，剩下的增减才配叫「反应」。
 *
 * 四路信号都记：元素增减（`childList`，判据取末态，见 {@link LivenessSnapshot}）、
 * **文字**（`characterData`）与**样式/属性**（`attributes`）这两路是 #170 补的，它们记的是
 * **每个节点第一次变动前的值**（`charFirst` / `attrFirst`）——快照时拿「此刻的值」与它比，
 * 相同就说明这一路只是**闪了一下又复原**，不算反应（与元素数同一套末态口径）。原始突变
 * 次数（`charEvents` / `attrEvents`）只写进明细给人看，不参与判定。
 */
export function livenessRecorderScript(): string {
  return `(() => {
  if (globalThis.__LAB_LIVENESS__ !== undefined && globalThis.__LAB_LIVENESS__.installed === true) return
  const rec = {
    installed: true, interesting: 0, removed: 0, added: [],
    charEvents: 0, attrEvents: 0, charFirst: new Map(), attrFirst: new Map(),
  }
  globalThis.__LAB_LIVENESS__ = rec
  const NOISE = "script,style,[role=tooltip],[data-lab-noise]"
  const meaningful = (node) => {
    if (node === null || node.nodeType !== 1) return false
    try {
      if (typeof node.matches === "function" && node.matches(NOISE)) return false
      if (typeof node.closest === "function" && node.closest(NOISE) !== null) return false
    } catch (error) {
      return true
    }
    return true
  }
  // 文字与属性这两路同样按噪音子树滤：脚本/样式自己的文字在变、tooltip 上的属性在变，
  // 都不是「这个控件干了什么」（与上面 childList 那一路同一份 NOISE）。
  const inNoise = (node) => {
    const el = node.nodeType === 1 ? node : node.parentElement
    if (el === null || typeof el.closest !== "function") return false
    try {
      return el.closest(NOISE) !== null
    } catch (error) {
      return false
    }
  }
  const note = (node) => {
    rec.interesting += 1
    if (rec.added.length >= 24) return
    let slot = ""
    try {
      slot = node.closest("[data-slot]")?.getAttribute("data-slot") ?? ""
    } catch (error) {
      slot = ""
    }
    rec.added.push(node.tagName.toLowerCase() + (slot === "" ? "" : "@" + slot))
  }
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "characterData") {
        const node = record.target
        if (inNoise(node)) continue
        rec.charEvents += 1
        if (!rec.charFirst.has(node)) rec.charFirst.set(node, record.oldValue ?? node.data)
        continue
      }
      if (record.type === "attributes") {
        const el = record.target
        const name = record.attributeName
        if (name === null || inNoise(el)) continue
        rec.attrEvents += 1
        let per = rec.attrFirst.get(el)
        if (per === undefined) {
          per = new Map()
          rec.attrFirst.set(el, per)
        }
        if (!per.has(name)) per.set(name, record.oldValue)
        continue
      }
      for (const node of record.addedNodes) if (meaningful(node)) note(node)
      for (const node of record.removedNodes) if (meaningful(node)) rec.removed += 1
    }
  }).observe(document, {
    childList: true,
    subtree: true,
    characterData: true,
    characterDataOldValue: true,
    attributes: true,
    attributeOldValue: true,
  })
})()`
}

/** 一次快照：可观测状态 + 宿主通道计数。 */
interface LivenessSnapshot {
  /**
   * 页面上**有意义的元素数**（脚本、样式、tooltip 之外的）。
   *
   * 为什么用「元素数的前后差」而不是「DOM 变动次数」判反应：变动次数会把**闪一下又
   * 复原**的也算成反应，而用户看到的恰恰是「点下去什么都没有」——本条的现场（composer
   * 的 ＋：菜单开了又立刻自己关掉）就是这么一种「有变动、没结果」。所以判据取**末态**：
   * 等满反应窗口之后再数一遍，数没变就是没反应，变动的故事另记在明细里给人看。
   */
  elements: number
  mutations: number
  added: string[]
  popups: number
  hostCalls: number
  /** **语义**上行消息数（`assembly:log` 这类页面自身诊断不算——每次点击它都会发一条）。 */
  sent: number
  /** 新出现的语义上行消息类型（写进明细，人读得出「走了哪条通道」）。 */
  sentTypes: string[]
  /**
   * **末态仍是新的**文字变化条数（#170）。
   *
   * 与元素数同一套「取末态」口径：记的是每个文字节点**第一次变动前的值**，这里拿它跟
   * 「此刻的值」比——闪一下又复原（例如菜单开了又关）的不算，只有真留在页面上的才算。
   */
  textChanges: number
  /** **末态仍是新的**属性变化条数（#170；样式、class、`aria-*` 都在这条路上）。 */
  attrChanges: number
  /** 文字变化的读数样本（`"14"→"15"`，写进明细）。 */
  textSamples: string[]
  /** 属性变化的读数样本（`span.style` / `html.data-theme`，写进明细）。 */
  attrSamples: string[]
  /** 文字 / 属性这两路**原始突变次数**（含闪一下又复原的），只给人看，不参与判定。 */
  textEvents: number
  attrEvents: number
}

async function livenessSnapshot(page: Page): Promise<LivenessSnapshot> {
  return page.evaluate(() => {
    const rec = (
      globalThis as {
        __LAB_LIVENESS__?: {
          interesting: number
          removed: number
          added: string[]
          charEvents: number
          attrEvents: number
          charFirst: Map<Text, string>
          attrFirst: Map<Element, Map<string, string | null>>
        }
      }
    ).__LAB_LIVENESS__
    const host = (globalThis as { __LAB_HOST__?: { hostCalls: unknown[]; sent: unknown[] } }).__LAB_HOST__
    const sent = (host?.sent ?? []).map((message) => (message as { type?: string }).type ?? '?')
    // `assembly:log` 是**页面自身的诊断探针**（`src/ui/assembly/probe.ts`：每次点击 capture
    // 阶段发一条），与「这个控件干没干事」无关，必须先滤掉，否则任何点击都算有反应。
    const semantic = sent.filter((type) => type !== 'assembly:log')
    let elements = 0
    for (const element of Array.from(document.querySelectorAll('*'))) {
      if (element.closest('script,style,[role=tooltip]') !== null) continue
      elements += 1
    }
    const short = (value: string | null): string => JSON.stringify(String(value ?? '').slice(0, 16))
    const textSamples: string[] = []
    let textChanges = 0
    for (const [node, original] of rec?.charFirst ?? []) {
      const now = node.data
      if (now === original) continue
      textChanges += 1
      if (textSamples.length < 6) textSamples.push(`${short(original)}→${short(now)}`)
    }
    const attrSamples: string[] = []
    let attrChanges = 0
    for (const [element, per] of rec?.attrFirst ?? []) {
      const tag = element.tagName.toLowerCase()
      for (const [name, original] of per) {
        const now = element.getAttribute(name)
        if (now === original) continue
        attrChanges += 1
        if (attrSamples.length < 6) attrSamples.push(`${tag}.${name} ${short(original)}→${short(now)}`)
      }
    }
    return {
      elements,
      mutations: (rec?.interesting ?? 0) + (rec?.removed ?? 0),
      added: rec?.added ?? [],
      popups: document.querySelectorAll('[role="menu"],[role="listbox"],[role="dialog"]').length,
      hostCalls: host?.hostCalls.length ?? -1,
      sent: semantic.length,
      sentTypes: [...new Set(semantic)].slice(-4),
      textChanges,
      attrChanges,
      textSamples,
      attrSamples,
      textEvents: rec?.charEvents ?? 0,
      attrEvents: rec?.attrEvents ?? 0,
    }
  })
}

/** 「有反应」的六路信号。 */
export type LivenessSignal = 'element' | 'popup' | 'host' | 'sent' | 'text' | 'attr'

/**
 * 只看**结构变没变**的那四路信号（元素数 / 弹层 / 宿主通道 / 语义上行）——#170 之前
 * `reacted` 的全部口径。
 *
 * 也是**缺省口径**：一条交互点没说「它的反应可以只出在文字/属性上」时，就按这四路判。
 * 这样「弹层该开却没开、只是 `aria-expanded` 翻了一下」这类回归仍然判红——判据一个字没放宽。
 */
export const STRUCTURAL_SIGNALS: readonly LivenessSignal[] = ['element', 'popup', 'host', 'sent']

/**
 * 六路全开（#170 的完整口径）：文字与属性这两路也算反应。
 *
 * 给**反应本来就只出在文字或样式上**的交互点用（设置页的字号步进器那一类：改的是同一个
 * 文字节点的 `nodeValue` 加一条样式），也是对照件证明「改前的读法判红、现在的读法判绿」时
 * 两边对照用的那一份。
 */
export const ALL_SIGNALS: readonly LivenessSignal[] = [...STRUCTURAL_SIGNALS, 'text', 'attr']

/** 六路信号一个都没响（元素不在场时的空读数）。 */
const NO_SIGNALS: Record<LivenessSignal, boolean> = {
  element: false,
  popup: false,
  host: false,
  sent: false,
  text: false,
  attr: false,
}

/** 一条读数在指定那几路信号上算不算「有反应」（报告里用来对照「改前的读法」）。 */
export function reactedOn(probe: ClickProbe, signals: readonly LivenessSignal[]): boolean {
  return signals.some((name) => probe.signals[name] === true)
}

/** 一次点击探测的结论。 */
export interface ClickProbe {
  label: string
  /** 选择器在页面上有没有命中**可见**的元素。 */
  present: boolean
  /** 命中的那一个是不是禁用态（禁用态本来就点不动，「只观察」那几条里有两枚就是它）。 */
  disabled: boolean
  /** 是否出现了可观测反应（按调用方挑的那几路信号判）。 */
  reacted: boolean
  /** 六路信号各自响没响（#170：报告里读得出「反应出在哪一路上」）。 */
  signals: Record<LivenessSignal, boolean>
  /** 人是读的观测明细（写进报告的事实里）。 */
  detail: string
}

/** 挑第一个**可见**的匹配元素（`first()` 有时命中被藏起来的那一个）。 */
async function visibleIndex(page: Page, selector: string): Promise<number | null> {
  const count = await page.locator(selector).count()
  for (let index = 0; index < count; index++) {
    const box = await page.locator(selector).nth(index).boundingBox()
    if (box !== null && box.width > 0 && box.height > 0) return index
  }
  return null
}

/**
 * 点一个控件，回答「有没有反应」。
 *
 * 顺序是刻意的：**先悬停再拍基线**——Tooltip 是悬停就出的，把它算进点击的反应会让
 * 任何控件都「有反应」，这条判据就废了。
 *
 * `options.signals` 指定用哪几路信号判（见 {@link LivenessSignal}）——**缺省是只看结构的那四路**，
 * 也就是 #170 之前的口径：文字/属性这两路只在调用方**明确声明**「这条的反应可以只出在文字或
 * 样式上」时才算数。缺省从严的理由（为什么不是六路全开）写在文件头「为什么补上文字/属性」。
 */
export async function probeClick(
  page: Page,
  label: string,
  selector: string,
  options: { signals?: readonly LivenessSignal[] } = {},
): Promise<ClickProbe> {
  const nothing = (): Record<LivenessSignal, boolean> => ({ ...NO_SIGNALS })
  const index = await visibleIndex(page, selector)
  if (index === null) {
    return {
      label,
      present: false,
      disabled: false,
      reacted: false,
      signals: nothing(),
      detail: '元素不在场（选择器没命中可见元素）',
    }
  }
  const target = page.locator(selector).nth(index)
  // 先滚进视口再量：这一批交互点里有的在列表底部（底部动作条、设置项），页面被前面的
  // 操作撑高之后它的坐标会落到视口之外——`elementFromPoint` 那时返回 null，点击等于没点。
  await target.scrollIntoViewIfNeeded().catch(() => undefined)
  const box = await target.boundingBox()
  if (box === null) {
    return {
      label,
      present: false,
      disabled: false,
      reacted: false,
      signals: nothing(),
      detail: '元素不在场（拿到盒子之后又不可见）',
    }
  }
  const disabled = await target
    .isDisabled()
    .then((value) => value)
    .catch(() => false)
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const hit = await page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y)
      if (el === null) return 'none'
      return `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}`
    },
    point,
  )
  await page.mouse.move(point.x, point.y)
  await page.waitForTimeout(HOVER_SETTLE_MS)
  const before = await livenessSnapshot(page)
  await page.mouse.click(point.x, point.y)
  await page.waitForTimeout(REACTION_WINDOW_MS)
  const after = await livenessSnapshot(page)
  const elementDelta = after.elements - before.elements
  const popupDelta = after.popups - before.popups
  const hostDelta = after.hostCalls - before.hostCalls
  const sentDelta = after.sent - before.sent
  const mutationDelta = after.mutations - before.mutations
  const textDelta = after.textChanges - before.textChanges
  const attrDelta = after.attrChanges - before.attrChanges
  const signals: Record<LivenessSignal, boolean> = {
    element: elementDelta !== 0,
    popup: popupDelta !== 0,
    host: hostDelta !== 0,
    sent: sentDelta !== 0,
    text: textDelta !== 0,
    attr: attrDelta !== 0,
  }
  // 缺省只看结构那四路（#170 之前的口径，见函数注释）：文字/属性两路要调用方显式声明才算。
  const reacted = (options.signals ?? STRUCTURAL_SIGNALS).some((name) => signals[name])
  // 收尾：把这一下可能开出来的弹层关掉再量下一个——不然下一个交互点的读数里会掺着
  // 上一个留下的菜单（实测过：权限那一下留着的菜单会让「模型选择」显示成「弹层 1→0」）。
  // 弹层还没关干净就再按一次（反馈这类弹窗要两次 Esc 才收）。
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  if (after.popups > before.popups) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  }
  const samples = (all: string[], delta: number): string =>
    delta === 0 ? '无' : all.slice(all.length - Math.max(1, delta)).join(',') || '（已不在 DOM）'
  return {
    label,
    present: true,
    disabled,
    reacted,
    signals,
    detail: `元素数 ${String(before.elements)}→${String(after.elements)}（Δ${String(elementDelta)}）· 弹层 ${String(before.popups)}→${String(after.popups)} · 宿主调用 +${String(hostDelta)} · 语义上行 +${String(sentDelta)}${sentDelta === 0 ? '' : `（${after.sentTypes.join(',')}）`} · 文字 Δ${String(textDelta)}（末态仍是新的共 ${String(after.textChanges)} 条，本轮原始突变 +${String(after.textEvents - before.textEvents)} 次：${samples(after.textSamples, textDelta)}）· 属性 Δ${String(attrDelta)}（末态仍是新的共 ${String(after.attrChanges)} 条，本轮原始突变 +${String(after.attrEvents - before.attrEvents)} 次：${samples(after.attrSamples, attrDelta)}）· 明细：DOM 变动 ${String(mutationDelta)} 次（新增 ${after.added.slice(after.added.length - Math.max(0, mutationDelta)).join(',') || '无'}）· 禁用=${String(disabled)} · 指针落点 ${hit}`,
  }
}

// ---------------------------------------------------------------------------
// 只观察不点击（#163）
// ---------------------------------------------------------------------------

/** 一次「只看不点」的结论。 */
export interface ObserveProbe {
  label: string
  /** 选择器在页面上有没有命中**可见**的元素。 */
  present: boolean
  /** 命中的那一个是不是禁用态。 */
  disabled: boolean
  /** 命中的那一个的几何（可见即非零）。 */
  box: { width: number; height: number } | null
  /** 观察窗口内**页面上收到过几次真实的点击**——正常必须是 0（这一步一下都不点）。 */
  clicks: number
  /** 人是读的观测明细（写进报告的事实里）。 */
  detail: string
}

/**
 * 只看不点：判「控件在场 / 几何 / 禁用态」，**绝不派发点击**。
 *
 * 用在会经**真网关**落到**用户机器**上的那些控件上（见文件头「只观察、绝不点击的那一类」）：
 * 这类控件点一下的后果不在这一页里——它在用户的桌面上拉起访达、开系统编辑器、改用户的
 * 设置文档。实验室连的是用户真机上的网关，所以「为了覆盖而点一下」是不可接受的代价。
 *
 * 「这一步一下都没点」不是靠自觉，而是量出来的：观察窗口内页面侧记一次真实 click 就算数，
 * 数与 0 不符即判红——将来有人把这个分支改回点击，这一条会当场抓住。
 */
export async function probeObserve(page: Page, label: string, selector: string): Promise<ObserveProbe> {
  const index = await visibleIndex(page, selector)
  if (index === null) {
    return { label, present: false, disabled: false, box: null, clicks: 0, detail: '元素不在场（选择器没命中可见元素）' }
  }
  const target = page.locator(selector).nth(index)
  // 与 probeClick 同一套量法：先滚进视口再量，坐标才落在页面上。
  await target.scrollIntoViewIfNeeded().catch(() => undefined)
  const box = await target.boundingBox()
  if (box === null) {
    return { label, present: false, disabled: false, box: null, clicks: 0, detail: '元素不在场（拿到盒子之后又不可见）' }
  }
  const disabled = await target
    .isDisabled()
    .then((value) => value)
    .catch(() => false)
  const aria = await target.getAttribute('aria-label').catch(() => null)
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const hit = await page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y)
      if (el === null) return 'none'
      return `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}`
    },
    point,
  )
  // 观察期间**把指针停到它上面**（悬停不出动作，但能让报告里那一下「为什么只观察」看得见
  // 是哪一枚），然后钉一个文档级点击计数器，等满一个反应窗口再读。
  await page.mouse.move(point.x, point.y)
  const clicks = await page.evaluate(async (window: number) => {
    let seen = 0
    const bump = (): void => {
      seen += 1
    }
    document.addEventListener('click', bump, true)
    try {
      await new Promise((resolve) => setTimeout(resolve, window))
    } finally {
      document.removeEventListener('click', bump, true)
    }
    return seen
  }, REACTION_WINDOW_MS)
  return {
    label,
    present: true,
    disabled,
    box: { width: box.width, height: box.height },
    clicks,
    detail: `只观察（不点击）· 几何 ${box.width.toFixed(1)}×${box.height.toFixed(1)} · 禁用=${String(disabled)} · aria-label=${JSON.stringify(aria ?? '')} · 指针落点 ${hit} · 观察窗口 ${String(REACTION_WINDOW_MS)} 毫秒内页面收到的点击次数 ${String(clicks)}`,
  }
}

/**
 * 走完一条「只看不点」的交互点，落成断言。
 *
 * `assertPresent` 为假时（例如这一轮页面上根本没有会话头、会话头那几枚无从谈起）只记事实：
 * 「控件不在场」在这一轮不是缺陷，那是环境（#145）。在场时一律断言，因为这几条现在就只剩
 * 「在不在、可不可用」这一层覆盖了——它们不再提供「点下去有没有反应」那一层。
 */
async function observePoint(
  check: Check,
  page: Page,
  point: LivenessPoint,
  where: string,
  assertPresent: boolean,
): Promise<void> {
  const seen = await probeObserve(page, point.label, point.selector)
  const reason = point.observeOnly ?? '（没写理由——按约定每条只观察的交互点都必须写）'
  check.fact(`[${where}·只观察] ${point.label}：${seen.detail} ；期望=${point.expect} ；不点的理由=${reason}`)
  if (!seen.present) {
    if (assertPresent) {
      check.ok(`[只观察] ${point.label}：控件在场（可见、几何非零）`, false, `元素不在场；期望=${point.expect}`)
    } else {
      check.fact(`[${where}·只观察] ${point.label}：这一轮页面上没有这个控件（本轮的页面前提不成立），跳过判定`)
    }
    return
  }
  check.ok(
    `[只观察] ${point.label}：控件在场（可见、几何非零）`,
    seen.box !== null && seen.box.width > 0 && seen.box.height > 0,
    seen.detail,
  )
  if (point.expectDisabled === true) {
    check.ok(`[只观察] ${point.label}：当前是禁用态（本来就点不动）`, seen.disabled, seen.detail)
  }
  check.ok(
    `[只观察] ${point.label}：这一步没有派发过任何点击`,
    seen.clicks === 0,
    `观察窗口内页面收到的点击次数=${String(seen.clicks)}；不点的理由=${reason}`,
  )
}

// ---------------------------------------------------------------------------
// 探针自己的对照件（#170）：在真实页面上就地装五枚合成控件
// ---------------------------------------------------------------------------

/** 对照件的页面侧状态（点击计数 + 末态读数），用来判「点击真的落在了对照件上」。 */
interface FixtureState {
  clicks: Record<string, number>
  text: string
  flashText: string
  flashAttr: string | null
  styleOutlined: boolean
}

/** 读对照件的状态（都在页面里就地读，不写任何别的东西）。 */
async function fixtureState(page: Page): Promise<FixtureState> {
  return page.evaluate(() => {
    const state = (globalThis as { __LAB_FIXTURES__?: { clicks: Record<string, number> } }).__LAB_FIXTURES__
    const value = (id: string): string => {
      const node = document.querySelector(id)?.firstChild as Text | null | undefined
      return node === null || node === undefined ? '' : node.data
    }
    const style = document.querySelector('#lab-fixture-style')?.getAttribute('style') ?? ''
    return {
      clicks: state?.clicks ?? {},
      text: value('#lab-fixture-text'),
      flashText: value('#lab-fixture-text-flash'),
      flashAttr: document.querySelector('#lab-fixture-attr-flash')?.getAttribute('data-lab-flag') ?? null,
      styleOutlined: /outline/.test(style),
    }
  })
}

/**
 * 在**真实页面**上就地装五枚合成控件（#170 的对照件，理由见文件头「探针自己的对照件」）。
 *
 * 为什么装在真实页面上而不是另开一张空白页：① 这里要证的正是「这一页在 1200 毫秒窗口里
 * 有没有别的东西在改 DOM / 文字 / 属性」——空白页上没有这份环境；② 装在这一页上，探针看到的
 * 是新信号**在同一份现场**里的表现（同一个记录器、同一份噪音来源）。
 *
 * 五枚各自只干一件事（都先把点击数加一，好在失败时读出「点击到底落下没有」）：
 *   - `lab-fixture-text`：改**同一个文字节点的 `nodeValue`**（`0` → `1`）——官方那句
 *     `<span className={value}>{fontSize}</span>` 就是这一路；
 *   - `lab-fixture-style`：加一条 `outline`（只改样式，属性这一路）；
 *   - `lab-fixture-dead`：handler 里一件可观测的事都不干（真·点了没反应）；
 *   - `lab-fixture-text-flash` / `lab-fixture-attr-flash`：改完 250 毫秒再改回去（闪一下又复原）。
 */
async function installProbeFixtures(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = { clicks: {} as Record<string, number> }
    ;(globalThis as { __LAB_FIXTURES__?: typeof state }).__LAB_FIXTURES__ = state
    const host = document.createElement('div')
    host.id = 'lab-liveness-fixtures'
    // 固定钉在视口左下角（`probeClick` 会先把目标滚进视口，固定定位不受滚动影响），
    // 层级压过页面自身，免得点击落在别的东西上。
    host.setAttribute(
      'style',
      'position:fixed;left:6px;bottom:6px;z-index:2147483000;display:flex;gap:4px;padding:4px;background:#fff;border:1px solid #888;font:11px/1.2 monospace',
    )
    const make = (id: string, text: string, onClick: (button: HTMLButtonElement) => void): void => {
      const button = document.createElement('button')
      button.id = id
      button.type = 'button'
      button.setAttribute('style', 'width:58px;height:22px')
      button.append(document.createTextNode(text))
      button.addEventListener('click', () => {
        state.clicks[id] = (state.clicks[id] ?? 0) + 1
        onClick(button)
      })
      host.append(button)
    }
    make('lab-fixture-text', '0', (button) => {
      const node = button.firstChild as Text
      node.data = String(Number(node.data) + 1)
    })
    make('lab-fixture-style', '样式', (button) => {
      button.style.outline = '2px solid #f00'
    })
    make('lab-fixture-dead', '没反应', () => undefined)
    make('lab-fixture-text-flash', '0', (button) => {
      const node = button.firstChild as Text
      node.data = 'X'
      setTimeout(() => {
        node.data = '0'
      }, 250)
    })
    make('lab-fixture-attr-flash', '属性闪', (button) => {
      button.setAttribute('data-lab-flag', '1')
      setTimeout(() => {
        button.removeAttribute('data-lab-flag')
      }, 250)
    })
    document.body.append(host)
  })
}

/** 收起对照件（截图与后续断言里不该出现这五枚合成控件）。 */
async function removeProbeFixtures(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelector('#lab-liveness-fixtures')?.remove()
  })
}

/**
 * 跑一遍对照件，落成断言（#170 的负向对照与两条护栏）。
 *
 * 判据三组：
 *   1. **负向对照**（#170 就是这个）：只改文字 / 只改样式那两枚——按**改前的读法**
 *      （`STRUCTURAL_SIGNALS`）必须判红、按**六路全开**（`ALL_SIGNALS`）必须判绿；同时判
 *      「点击真落下了、页面上确实变了」（不然「判绿」可能只是因为点击根本没点到）。
 *   2. **真·点了没反应仍判红**：点击计数为 1（真点了），读数必须仍是「无反应」。
 *   3. **闪一下又复原仍判红**：文字与属性各一枚，改完 250 毫秒改回去，读数必须仍是「无反应」。
 *
 * 五枚都按 `ALL_SIGNALS`（六路全开）判——这一组对照件判的正是「放宽之后」的表现，放宽的
 * 边界由第 2、3 组守着；交互点表里那些点的缺省口径（只看结构那四路）不在这里。
 */
async function runProbeFixtures(check: Check, page: Page, where: string): Promise<void> {
  await installProbeFixtures(page)
  try {
    const text = await probeClick(page, '对照件 · 只改文字', '#lab-fixture-text', { signals: ALL_SIGNALS })
    check.fact(`[${where}·对照件] 只改文字：${text.detail}`)
    check.ok(
      '[对照件] 只改文字的可点控件：按改前的读法（只看结构那四路）判红——这一支就是 #170 要收的假红',
      !reactedOn(text, STRUCTURAL_SIGNALS),
      `signals=${JSON.stringify(text.signals)}；${text.detail}`,
    )
    check.ok(
      '[对照件] 只改文字的可点控件：按现在的读法判绿（文字这一路看得见）',
      text.reacted && text.signals.text,
      `reacted=${String(text.reacted)} signals=${JSON.stringify(text.signals)}`,
    )
    const style = await probeClick(page, '对照件 · 只改样式', '#lab-fixture-style', { signals: ALL_SIGNALS })
    check.fact(`[${where}·对照件] 只改样式：${style.detail}`)
    check.ok(
      '[对照件] 只改样式的可点控件：按改前的读法（只看结构那四路）判红——同一支假红的另一面',
      !reactedOn(style, STRUCTURAL_SIGNALS),
      `signals=${JSON.stringify(style.signals)}；${style.detail}`,
    )
    check.ok(
      '[对照件] 只改样式的可点控件：按现在的读法判绿（属性这一路看得见）',
      style.reacted && style.signals.attr,
      `reacted=${String(style.reacted)} signals=${JSON.stringify(style.signals)}`,
    )
    const dead = await probeClick(page, '对照件 · 点了没反应', '#lab-fixture-dead', { signals: ALL_SIGNALS })
    check.fact(`[${where}·对照件] 点了没反应：${dead.detail}`)
    const flashText = await probeClick(page, '对照件 · 文字闪一下又复原', '#lab-fixture-text-flash', { signals: ALL_SIGNALS })
    check.fact(`[${where}·对照件] 文字闪一下又复原：${flashText.detail}`)
    const flashAttr = await probeClick(page, '对照件 · 属性闪一下又复原', '#lab-fixture-attr-flash', { signals: ALL_SIGNALS })
    check.fact(`[${where}·对照件] 属性闪一下又复原：${flashAttr.detail}`)
    const state = await fixtureState(page)
    check.fact(`[${where}·对照件] 页面侧读数：${JSON.stringify(state)}`)
    check.ok(
      '[对照件] 五枚的点击都真的落下过（失败时读得出「是没点到」还是「判据放过了」）',
      Object.entries(state.clicks).length === 5 && Object.values(state.clicks).every((count) => count >= 1),
      JSON.stringify(state.clicks),
    )
    check.ok(
      '[对照件] 只改文字那枚：读数真的从 0 变成 1（判绿不是因为点击根本没点到）',
      state.text === '1',
      `text=${JSON.stringify(state.text)} clicks=${JSON.stringify(state.clicks)}`,
    )
    check.ok(
      '[对照件] 只改样式那枚：样式真的加上了 outline（判绿不是因为点击根本没点到）',
      state.styleOutlined,
      `styleOutlined=${String(state.styleOutlined)} clicks=${JSON.stringify(state.clicks)}`,
    )
    check.ok(
      '[对照件] 真·点了没反应的控件仍判红（点击计数为 1、页面上一个字节都没改）',
      !dead.reacted && (state.clicks['lab-fixture-dead'] ?? 0) >= 1,
      `reacted=${String(dead.reacted)} signals=${JSON.stringify(dead.signals)} clicks=${String(state.clicks['lab-fixture-dead'] ?? 0)}`,
    )
    check.ok(
      '[对照件] 文字闪一下又复原仍判红（判据取末态，不数变动次数——#156 那枚 ＋ 就是「有变动、没结果」）',
      !flashText.reacted && state.flashText === '0',
      `reacted=${String(flashText.reacted)} signals=${JSON.stringify(flashText.signals)} 末态=${JSON.stringify(state.flashText)}`,
    )
    check.ok(
      '[对照件] 属性闪一下又复原仍判红（同上：末态口径不许被新信号吃掉）',
      !flashAttr.reacted && state.flashAttr === null,
      `reacted=${String(flashAttr.reacted)} signals=${JSON.stringify(flashAttr.signals)} 末态=${JSON.stringify(state.flashAttr)}`,
    )
  } finally {
    await removeProbeFixtures(page)
  }
}

// ---------------------------------------------------------------------------
// ＋ 的专件：读官方 commandUi 的贡献表 + 摘掉违规贡献
// ---------------------------------------------------------------------------

/**
 * 抓官方客户端根 ctx（与 harness 的 fiber 探针同一手法：包 `__ModuleLoader__` 的 load，
 * 只给 `@deepseek-ai/dsh-client-modules` 的 apply 包一层——它是页面第一个跑起来的插件）。
 *
 * 为什么需要它：官方 `commandUi` 的贡献表在服务实例上（`live.contributions`），
 * 页面上没有别的公开读法，而我们要读的正是「谁交了一条不合契约的贡献」。
 */
export function commandRegistryScript(): string {
  return `(() => {
  const MODULES_ID = "@deepseek-ai/dsh-client-modules"
  const proxies = new WeakMap()
  const wrapLoad = (entry) => {
    if (typeof entry !== "function" || entry.__labCmdWrapped === true) return entry
    const original = entry
    const wrapped = function (registration) {
      if (registration !== null && typeof registration === "object" && typeof registration.factory === "function") {
        const id = registration.id ?? registration.name ?? "?"
        const factory = registration.factory
        registration.factory = function () {
          const exports = factory.apply(this, arguments)
          if (id === MODULES_ID && exports !== null && typeof exports === "object" && typeof exports.apply === "function") {
            const apply = exports.apply
            exports.apply = function (ctx) {
              globalThis.__LAB_COMMAND_CTX__ = ctx
              return apply.apply(this, arguments)
            }
          }
          return exports
        }
      }
      return original.apply(this, arguments)
    }
    wrapped.__labCmdWrapped = true
    return wrapped
  }
  const proxyFor = (target) => {
    if (target === null || typeof target !== "object") return target
    const cached = proxies.get(target)
    if (cached !== undefined) return cached
    const proxy = new Proxy(target, {
      get(t, prop) {
        const value = Reflect.get(t, prop, t)
        return prop === "load" && typeof value === "function" ? wrapLoad(value) : value
      },
      set(t, prop, value) {
        return Reflect.set(t, prop, prop === "load" && typeof value === "function" ? wrapLoad(value) : value, t)
      },
      defineProperty(t, prop, descriptor) {
        if (prop === "load" && typeof descriptor.value === "function") descriptor.value = wrapLoad(descriptor.value)
        return Reflect.defineProperty(t, prop, descriptor)
      },
    })
    proxies.set(target, proxy)
    return proxy
  }
  let current
  Object.defineProperty(globalThis, "__ModuleLoader__", {
    configurable: true,
    get() { return current === undefined ? undefined : proxyFor(current) },
    set(value) { current = value },
  })
})()`
}

/** 官方 `commandUi` 贡献表里的一条（只取我们要判的两格）。 */
interface CommandContributionFact {
  name: string
  hasAvailable: boolean
}

/** 读官方 commandUi 的贡献表；服务还没起来时返回 null。 */
export async function commandContributions(page: Page): Promise<ReadonlyArray<CommandContributionFact> | null> {
  return page.evaluate(() => {
    const ctx = (globalThis as { __LAB_COMMAND_CTX__?: { get(name: string): unknown } }).__LAB_COMMAND_CTX__
    if (ctx === undefined) return null
    const ui = ctx.get('commandUi') as { live?: { contributions?: Map<string, { available?: unknown }> } } | undefined
    const table = ui?.live?.contributions
    if (table === undefined) return null
    return [...table.entries()].map(([name, contribution]) => ({
      name,
      hasAvailable: typeof contribution.available === 'function',
    }))
  })
}

/** 摘掉不合契约（缺 `available`）的贡献，返回被摘掉的名字（诊断用，只在页面内改）。 */
export async function stripMalformedContributions(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => {
    const ctx = (globalThis as { __LAB_COMMAND_CTX__?: { get(name: string): unknown } }).__LAB_COMMAND_CTX__
    const ui = ctx?.get('commandUi') as { live?: { contributions?: Map<string, { available?: unknown }> } } | undefined
    const table = ui?.live?.contributions
    if (table === undefined) return []
    const removed: string[] = []
    for (const [name, contribution] of [...table.entries()]) {
      if (typeof contribution.available !== 'function') {
        removed.push(name)
        table.delete(name)
      }
    }
    return removed
  })
}

/** 页面上「哪个 source 的候选失败了」那一行（官方 ui-input-trigger 打的；没有则空表）。 */
export function candidateFailureLines(lines: readonly string[]): readonly string[] {
  return lines.filter((line) => /\[ui-input-trigger\] source ".*" candidates failed/.test(line))
}

/** 会话根本服务不了（被别的 dsh 进程占着，#145）时官方那句 warmup 失败——环境不可用，不当缺陷判。 */
function sessionUnavailable(lines: readonly string[]): boolean {
  return lines.some((line) => /command directory warmup failed/.test(line))
}

// ---------------------------------------------------------------------------
// 交互点表
// ---------------------------------------------------------------------------

/**
 * 一条「按文案认控件」的文案**打哪儿来**（#209）。分三档：
 *
 * - `ours`：我们自己的控件，文案是我们那份词典（`workspaceTree/locale.ts`）里的键，
 *   `texts()` 反查键名就能给出 zh / en 两份；
 * - `official`：官方件的控件，文案由官方 `t()` 渲染，我们那份词典里没有——它的两份取值
 *   必须登记在 `harness.ts` 的 `OFFICIAL_EXTRA` 里（每条都写着「哪份官方包、哪个键」）；
 * - `locale-self-name`：语言下拉那一枚，按钮上写的是**当前语言用它自己的说法**写的名字
 *   （官方语言目录 `BUILT_IN_LOCALE_METADATA` 里的常量，不是词典键）——它的两份取值是两个
 *   语言的**自称**，按它自己的口径断言。
 *
 * 为什么要把它写在表上：这份声明就是自检的输入。自检不靠选择器字符串的形状去猜哪一条是
 * 「按文案认控件」（那种扫描器脆），而是按这里声明的档位逐条断言「两份取值都解析得出来、
 * 并且都真的落在选择器里」——见 `test/livenessTextSelectors.test.ts`。
 */
export type LivenessTextTier = 'ours' | 'official' | 'locale-self-name'

/** 交互点表里的一条文案：我们怎么称呼它（我们词典里那条中文）＋ 它的档位。 */
export interface LivenessTextSource {
  readonly zh: string
  readonly tier: LivenessTextTier
}

/** 一个交互点（#209 起 `LIVENESS_POINTS` 也会把它导出给自检读）。 */
export interface LivenessPoint {
  label: string
  selector: string
  /** 期望的反应（人读）。 */
  expect: string
  /**
   * 官方页上同一控件的选择器；给了就按「官方有反应 ⇒ 我们也得有」判。
   * 不给（只有我们有的控件）就按「必须反应」判。
   */
  official?: string
  /**
   * 这条交互点的选择器**按哪些文案认控件**（#209）：是就把那几条文案连同档位列出来。
   * 选择器不靠文案认控件的（按 `data-slot`、按结构断的那些）不给这个字段。
   *
   * 一个交互点可以对应不止一条文案（「折叠 / 展开全部」是一枚按钮、提示随态翻），所以是数组。
   */
  textSources?: readonly LivenessTextSource[]
  /**
   * **只观察、绝不点击**：理由是「点下去会发生什么」。
   *
   * 判据只有三条——控件在场（可见、几何非零）、（`expectDisabled` 时）当前是禁用态、
   * 这一步没有派发过点击；禁用态与几何记进事实。什么时候用：这条控件的动作**最终落到
   * 用户机器或用户的持久状态上**（点的是官方 UI、动作经真网关到宿主——拉访达、开系统
   * 编辑器、开终端、开外部浏览器；或点下去会发消息 / 改设置这类写操作）。
   */
  observeOnly?: string
  /** 与 `observeOnly` 一起用：期望它当前**就是禁用态**（本来就点不动），据此断言。 */
  expectDisabled?: boolean
  /**
   * 这条交互点**算「有反应」**的那几路信号；不给就是 {@link STRUCTURAL_SIGNALS}
   * （只看结构那四路 = #170 之前的口径，判据一个字没放宽）。
   *
   * 什么时候要给：这条控件的反应**本来就只出在文字或样式上**（页面上一个元素没增没减、也
   * 没有弹层与通道消息，只是那枚数字变了或那条样式变了）——官方设置页的字号步进器就是这么
   * 干的。这种点要给 {@link ALL_SIGNALS}，否则「点了没反应」是**假红**（#170 的现场）。
   * 反过来，期望是「弹层开出来 / 内容切过去」的点**不要**给：给了文字/属性这两路之后，
   * 弹层其实没开、只是按钮上 `aria-expanded` 翻了一下的回归就抓不到了。判错的症状很好认——
   * 报告里那条的明细会写「文字 Δ…」或「属性 Δ…」。
   */
  signals?: readonly LivenessSignal[]
}

const COMPOSER = '[data-slot="conversation.composer.bar"]'

/**
 * 走 {@link textSelector} 拼过选择器的那几条文案（#209 的自检读它）。
 *
 * 为什么要记这个：交互点表上声明的档位（{@link LivenessPoint.textSources}）与**实际**按文案
 * 拼过的选择器要能对上——表里声明了却没拼（选择器又被改回写死一种语言的字面量）、或者拼了
 * 却没声明档位（新加一条按文案认控件的东西而没人给它定档），两种都是 #209 要堵的静默缺口，
 * 自检按这两个方向的差集红。记的是 `textSelector` 的输入文案（调用发生在这个模块加载时）。
 */
const TEXT_SELECTOR_CALLS: string[] = []

/** {@link TEXT_SELECTOR_CALLS} 的只读视图（自检用）。 */
export function livenessTextSelectorCalls(): readonly string[] {
  return TEXT_SELECTOR_CALLS
}

/**
 * 交互点表里**按文案认控件**的那些选择器是怎么拼出来的（#208）。
 *
 * 每个交互点都先靠一条**文案**认出那个控件（`aria-label`、页签文字、按钮文字），而文案会随
 * **页面语言**变：zh 页上是词典里那条中文，en 页上是同一条键的英文。所以选择器不写死中文，
 * 而是把那条文案交给 {@link texts} 换出 zh / en 两份取值，各拼一条选择器再用逗号并起来
 * （Playwright 的选择器列表是「或」）——哪一份语言都命得中。
 *
 * 为什么必须这么拼：这一套每一步的起手就是「选择器命中的控件在不在场」，命不中即按
 * 「元素不在场 → 记事实跳过」放过去，**报告里看着全绿而覆盖面静默缩水**。实测（#208）：
 * `LAB_LOCALE=en` 跑 F-54 是 22/29，比 zh 那一轮少掉约二十条断言。页面语言是运行环境的
 * 输入（`LAB_LOCALE`，缺省 zh），判据不许依赖它。
 *
 * 文案的出处：我们自己的控件走 `workspaceTree/locale.ts`（`texts()` 反查键名）；官方件的
 * 标签在 `harness.ts` 的 `OFFICIAL_EXTRA`，逐条写着「哪份官方包、哪个键」。两边都查不到时
 * `texts()` 原样返回那一条中文（等于 en 页上又会落空），所以往表里加文案前先确认它有出处
 * （#209 起这条由 `test/livenessTextSelectors.test.ts` 常驻盯着）。
 */
function textSelector(zhText: string, build: (variant: string) => string): string {
  TEXT_SELECTOR_CALLS.push(zhText)
  return texts(zhText).map(build).join(', ')
}

/** composer 的 ＋：表里与「＋ 专件」那三条断言用同一个选择器，先算一次，免得两处各写各的。 */
const COMPOSER_COMMANDS = textSelector('添加文件或调用指令', (label) => `${COMPOSER} button[aria-label="${label}"]`)

/**
 * 会话头那枚官方 open-in-app 分裂按钮：它的 `aria-label` 是官方 `open.title` 渲染出来的
 * 「在 {app} 中打开工作目录」/「Open workspace in {app}」，`{app}` 由宿主报的已装应用填
 * （本机上是「访达」/「Finder」，也可能是终端等）。所以取模板里 `{app}` **之前那一段**做
 * 前缀匹配——应用名换了照样命中，两种语言各一条。
 */
const OPEN_IN_APP_BUTTON = textSelector(
  '在 {app} 中打开工作目录',
  (title) =>
    `[data-slot="conversation.session.header.utilities"] button[aria-label^="${title.split('{app}')[0] ?? ''}"]`,
)

/**
 * composer 的上下文用量那一枚：它的 `aria-label` 是官方 `context.aria` 带**百分比**渲染出来的，
 * 而两种语言里占位的位置不一样——zh「上下文已用 {percent}」占位在句末、en「{percent} of context used」
 * 在句首。所以按模板里那段字面量拼：占位后面还有字就用**前缀**匹配，占位在最前面就用**后缀**匹配
 * （两种语言各一条，页面是哪一份语言都命得中，判据的宽严与写死中文时逐字相同）。
 *
 * 拼法与上面几条统一走 {@link textSelector}（#209）：这样它也在自检的账上（走 `texts()` 直接
 * 拼的话，自检的对账看不到它）。
 */
const CONTEXT_METER_BUTTON = textSelector('上下文已用 {percent}', (template) => {
  const [head = '', tail = ''] = template.split('{percent}').map((part) => part.trim())
  return head === ''
    ? `${COMPOSER} button[aria-label$="${tail}"]`
    : `${COMPOSER} button[aria-label^="${head}"]`
})

/**
 * chat 树（对话区）：官方页有全部同一批控件，逐个与官方对照。
 * 这里按文案认控件的几枚认的都是**官方件**的标签（官方 `t()` 渲染），所以档位一律 `official`。
 */
const CHAT_POINTS: ReadonlyArray<LivenessPoint> = [
  {
    label: 'composer 的 ＋（添加文件或调用指令）',
    textSources: [{ zh: '添加文件或调用指令', tier: 'official' }],
    selector: COMPOSER_COMMANDS,
    expect: '弹出指令候选菜单（官方 `/` 源）',
    official: COMPOSER_COMMANDS,
  },
  {
    label: 'composer 的权限选择（访问模式）',
    selector: '[data-slot="conversation.input.permission"] button',
    expect: '弹出权限预设菜单',
    official: '[data-slot="conversation.input.permission"] button',
  },
  {
    label: 'composer 的模型选择',
    selector: '[data-slot="conversation.input.model"] button',
    expect: '弹出模型菜单',
    official: '[data-slot="conversation.input.model"] button',
  },
  {
    label: 'composer 的上下文用量',
    textSources: [{ zh: '上下文已用 {percent}', tier: 'official' }],
    selector: CONTEXT_METER_BUTTON,
    expect: '弹出上下文用量详情',
    official: CONTEXT_METER_BUTTON,
  },
  {
    label: 'composer 的发送（空草稿）',
    textSources: [{ zh: '发送消息', tier: 'official' }],
    selector: textSelector('发送消息', (label) => `${COMPOSER} button[aria-label="${label}"]`),
    expect: '禁用态：本来就无反应',
    observeOnly:
      '空草稿时官方与我们的发送键都是禁用态，看的只是「它是禁用态」这一件事；而它的动作是**发消息**（写操作），轮不到为了覆盖去点它——万一哪天这一轮草稿不为空，点下去就是把一条消息送进真网关',
    expectDisabled: true,
  },
  // #195：**这一条必须排在「轨迹」那一枚之前**——点「轨迹」会把整块对话流换成轨迹视图，
  // 助手动作那一排跟着一起从 DOM 里消失，排在它后面就永远量不到（实测：排在最后时，
  // 我们那页与官方页**两侧**都报「元素不在场」，而点「轨迹」之前那一排两枚按钮都在
  // 场、`opacity: 1`、盒宽 28px）。所以它排在对话区那几枚旁边，而不是列表末尾。
  {
    label: '对话区 · 助手动作「好的回答」',
    textSources: [{ zh: '好的回答', tier: 'official' }],
    // 这一条**保持可点**（#163 复核过它会不会改用户状态，结论是不会）：点它的效果是开反馈
    // 弹窗（客户端行为）。已经点过赞的那条消息上，这枚按钮的 `aria-label` 换成官方词典里
    // 另一条键（已经赞过就显示「取消标记」那种），本探针认的是「还没表态」那一条
    // （官方 `action.like`，「好的回答」/「Good response」）——它命中不到已表态那一枚，所以
    // 走不到官方那条**删掉用户反馈**的路径（`retract` → `remote.messageFeedback.delete`）；
    // 悬停与点击触发的 `ensure()` 走的是 `remote.list`（读）。出处
    // `dsh-client-ui-message-feedback/lib/client.js` 的 `likeLabel` 与 `choose`。
    selector: textSelector('好的回答', (label) => `[data-slot="conversation.chat.assistant-actions"] button[aria-label="${label}"]`),
    expect: '弹出反馈弹层',
    official: textSelector('好的回答', (label) => `[data-slot="conversation.chat.assistant-actions"] button[aria-label="${label}"]`),
  },
  {
    label: '对话区页签 · 轨迹',
    textSources: [{ zh: '轨迹', tier: 'official' }],
    selector: textSelector('轨迹', (label) => `[data-slot="conversation.session.header"] [role="tab"]:has-text("${label}")`),
    expect: '切到轨迹视图（DOM 结构变）',
    official: textSelector('轨迹', (label) => `[data-slot="conversation.session.header"] [role="tab"]:has-text("${label}")`),
  },
  {
    label: '会话头 · 在访达中打开工作目录',
    textSources: [{ zh: '在 {app} 中打开工作目录', tier: 'official' }],
    selector: OPEN_IN_APP_BUTTON,
    expect: '官方 open-in-app 的分裂按钮：点它=把工作目录交给本机文件管理器',
    official: OPEN_IN_APP_BUTTON,
    observeOnly:
      '这枚是官方 `@deepseek-ai/dsh-client-ui-open-in-app` 的分裂按钮，点一下就往**真网关**发 `POST /open-in-app/open`（app + 工作目录路径），宿主侧再跑 macOS 的 `open <工作目录>`——实验室连的是用户真机上的网关，点它等于真在用户桌面上拉起一次访达（#163 的现场：每跑一轮整轮就拉一次，用户看到的是「怎么总是有个进程用 Finder 打开文件夹」）',
  },
  {
    label: '会话头 · 打开 / 收起右侧边栏',
    selector: '[data-slot="conversation.session.header.corner"] button',
    expect: '右栏开合（DOM 结构变）',
    official: '[data-slot="conversation.session.header.corner"] button',
  },
]

/**
 * sidebar 树：这几枚是自有实现（官方页没有同形件），期望固定；文案都取我们自己的词典
 * （档位 `ours`——`workspaceTree/locale.ts` 里每条都有对应的英文值）。
 */
const SIDEBAR_POINTS: ReadonlyArray<LivenessPoint> = [
  {
    label: '侧栏 · 分组过滤胶囊',
    textSources: [{ zh: '按分组过滤', tier: 'ours' }],
    selector: textSelector('按分组过滤', (label) => `[data-slot="sidebar.workspaces"] button[aria-label^="${label}"]`),
    expect: '弹出分组过滤菜单',
  },
  {
    label: '侧栏 · 搜索（收起态放大镜）',
    textSources: [{ zh: '搜索会话', tier: 'ours' }],
    selector: textSelector('搜索会话', (label) => `button[aria-label="${label}"]`),
    expect: '展开搜索框',
  },
  {
    label: '侧栏 · 折叠 / 展开全部',
    // 折叠态与展开态各一条文案，两份语言都要认（一枚按钮，提示随态翻）。
    textSources: [
      { zh: '折叠所有工作区', tier: 'ours' },
      { zh: '展开所有工作区', tier: 'ours' },
    ],
    selector: [
      textSelector('折叠所有工作区', (label) => `button[aria-label="${label}"]`),
      textSelector('展开所有工作区', (label) => `button[aria-label="${label}"]`),
    ].join(', '),
    expect: '树整体收起或展开',
  },
  {
    label: '侧栏 · 添加工作区',
    textSources: [{ zh: '添加工作区', tier: 'ours' }],
    selector: textSelector('添加工作区', (label) => `button[aria-label="${label}"]`),
    expect: '弹出两项菜单',
  },
  {
    label: '侧栏 · 设置齿轮',
    textSources: [{ zh: '设置', tier: 'ours' }],
    selector: textSelector('设置', (label) => `button[aria-label="${label}"]`),
    expect: '经宿主能力口打开设置页',
  },
  {
    label: '侧栏 · 批量选择',
    textSources: [{ zh: '批量选择', tier: 'ours' }],
    selector: textSelector('批量选择', (label) => `button[aria-label="${label}"]`),
    expect: '进入多选态',
  },
  {
    label: '侧栏 · 回收站入口',
    textSources: [{ zh: '回收站', tier: 'ours' }],
    selector: textSelector('回收站', (label) => `[data-slot="sidebar.footer.action"] button[aria-label^="${label}"]`),
    expect: '开回收站抽屉',
  },
  {
    label: '侧栏 · 清空回收站（计数 0）',
    textSources: [{ zh: '清空回收站', tier: 'ours' }],
    selector: textSelector('清空回收站', (label) => `button[aria-label="${label}"]`),
    expect: '禁用态：本来就无反应',
    observeOnly:
      '回收站计数为 0 时这两枚动作就是禁用态（见 F-15 / F-38），能看的只是「它是禁用态」；它的动作是**永久归档回收站里的会话**（终点动作、不可逆），一旦哪一轮夹具不为空就会真去写网关',
    expectDisabled: true,
  },
]

/** settings 树：设置页各节与通用设置里的控件（官方页这两处是弹窗，形态不同，不做对照）。 */
const SETTINGS_POINTS: ReadonlyArray<LivenessPoint> = [
  // 「切到另一节」按**不是当前那一节**认，不写死节名：设置页的节来自装着的插件
  // （日常实例上有我们自己那件 `模型服务`，隔离实例上是官方的 `模型` / `插件` /
  // `Agent 预设` / `已归档会话`，见 `settingsLayoutPlugin` 的 navCell），写死一个节名
  // 会在别的实例上「元素不在场 → 跳过」，跟着「导航回通用设置」那一条也就成了空点
  // （当时已经在通用设置上，点下去当然没有反应——#177 实测红过一条）。
  { label: '设置 · 导航到另一节', selector: 'button.dshOneSettingsShell_navCell:not([aria-current])', expect: '切到该节内容' },
  {
    // 「通用设置」是**官方**那一节的名字（`general.nav`）：设置页的节由装着的那件官方插件
    // 注册、标题取它自己的词典，所以这条文案归 `OFFICIAL_EXTRA`。
    label: '设置 · 导航回「通用设置」',
    textSources: [{ zh: '通用设置', tier: 'official' }],
    selector: textSelector('通用设置', (label) => `button:has-text("${label}")`),
    expect: '切回该节内容',
  },
  {
    // 下拉上显示的是**当前那个**权限预设的名字（官方 `preset.workspaceWrite` = 工作区内修改 /
    // Workspace Write），所以两种语言各一条。
    label: '设置 · 权限预设下拉',
    textSources: [{ zh: '工作区内修改', tier: 'official' }],
    selector: textSelector('工作区内修改', (label) => `[data-slot="settings.general.item"] button:has-text("${label}")`),
    expect: '弹出预设选项',
  },
  {
    // 语言下拉那枚按钮显示的是**当前语言用它自己的说法**写的名字（官方语言目录里的常量，
    // 不是词典键）：zh 页上是「中文」、en 页上是「English」——只认中文的话，en 页上这一步
    // 会整条落空（#208）。档位是单开的那一档 `locale-self-name`（#209）：它的两份取值是
    // 两个语言的**自称**，不是某条词典键的 zh / en 译文，所以自检按它自己的口径断言。
    label: '设置 · 语言下拉',
    textSources: [{ zh: '中文', tier: 'locale-self-name' }],
    selector: textSelector('中文', (label) => `[data-slot="settings.general.item"] button:has-text("${label}")`),
    expect: '弹出语言选项',
  },
  {
    label: '设置 · 增大字号',
    textSources: [{ zh: '增大字号', tier: 'official' }],
    // 只认官方 ui-theme 的 `fontSize.increase`（增大字号 / Increase font size），按词典取两份。
    // （原来还挂着一条 `aria-label="增大字体"` 的兜底写法，本次去掉：本机装着的官方包
    // `@deepseek-ai/dsh-client-ui-theme/lib/client.js` 里只有 `fontSize.increase` 这一个键、
    // 取值是「增大字号」，那条兜底在任何一版官方产物里都查不到出处，留着只会让人以为它有用。）
    selector: textSelector('增大字号', (label) => `button[aria-label="${label}"]`),
    expect: '官方 ui-theme 的字号步进器：写用户的设置文档',
    observeOnly:
      '官方 `@deepseek-ai/dsh-client-ui-theme` 的字号步进器点一下就 `theme.setFontSize(px)` → `host.set("fontSize", px)`，也就是**经网关把新字号写进用户的设置文档**（出处 `lib/client.js` 的 setFontSize 注释「the only font-size write entry … written through the settings scope」）——哪怕这一轮它是禁用态（只记事实），它是不是禁用取决于用户当前的设置，所以整条只观察不点',
  },
  {
    label: '设置 · 打开配置文件',
    selector: '[data-slot="settings.action"] button',
    expect: '打开设置文档（官方那条经网关宿主用系统默认应用打开）',
    observeOnly:
      '`settings.action` 这个 slot 里官方那条 `open-document` 的动作是 `remote.settings.openSettingsDocument`，由**网关宿主**用系统默认应用打开 `~/.dsh/settings.yaml`（宿主侧 `dsh-api-settings-controller` → `openNativeTextFile`）；我们自己那条（`open-document-vscode`）走宿主能力口、本身没有原生副作用。两枚在同一个 slot 里、官方那条由 shell 按同 id + priority −1 遮蔽（#178 C10+C11），遮蔽一旦失效探针就会点到官方的——所以这一条按整条只观察，指着这个 slot 里的控件在不在、可不可用',
  },
]

/**
 * 三条交互点表合起来（#209 的自检读它，见 `test/livenessTextSelectors.test.ts`）。
 *
 * 为什么要有这个出口：自检要问的是「表里每一条**按文案认控件**的项，它的文案在 zh / en 两种
 * 页面语言下分别匹配什么」——它得能读到表上声明的档位（{@link LivenessPoint.textSources}）
 * 与那条选好的选择器字符串本身，而不是靠正则去猜哪一条是按文案认的。
 */
export const LIVENESS_POINTS: readonly LivenessPoint[] = [...CHAT_POINTS, ...SIDEBAR_POINTS, ...SETTINGS_POINTS]

// ---------------------------------------------------------------------------
// 套件
// ---------------------------------------------------------------------------

/** 打开官方页（网关 origin）：拿实验室已经换好的 cookie 直接进，数据面同一台网关。 */
async function openOfficialPage(
  ctx: SuiteContext,
  options: { seedSession?: string } = {},
): Promise<{ context: BrowserContext; page: Page; capture: ReturnType<typeof capturePage> }> {
  const cookie = cookieHeader(ctx.lab.gateway)
  const context = await ctx.browser.newContext({ viewport: { width: 1400, height: 950 } })
  if (cookie !== undefined) {
    const at = cookie.indexOf('=')
    await context.addCookies([
      {
        name: cookie.slice(0, at),
        value: cookie.slice(at + 1),
        domain: new URL(ctx.lab.gateway).hostname,
        path: '/',
      },
    ])
  }
  // 官方页自己那份「当前会话」恢复键（`dsh.sessions.current`，见 dsh-api-session-controller 的
  // selection store）：对齐到我们那页开着的会话，两侧才是同一份现场。
  if (options.seedSession !== undefined && options.seedSession !== '') {
    await context.addInitScript({
      content: `try { localStorage.setItem("dsh.sessions.current", ${JSON.stringify(JSON.stringify({ sessionId: options.seedSession }))}) } catch (error) {}`,
    })
  }
  const page = await context.newPage()
  const capture = capturePage(page)
  await page.goto(`${ctx.lab.gateway}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(`${COMPOSER} > *`, { timeout: 40_000 }).catch(() => undefined)
  await page.waitForTimeout(6_000)
  await page.evaluate(livenessRecorderScript())
  return { context, page, capture }
}

/** 读页面上开着的会话 id（官方客户端把它记在 `dsh.sessions.current` 里）。 */
async function currentSessionId(page: Page): Promise<string> {
  return page.evaluate(() => {
    try {
      const raw = localStorage.getItem('dsh.sessions.current')
      if (raw === null) return ''
      const parsed = JSON.parse(raw) as { sessionId?: string }
      return typeof parsed.sessionId === 'string' ? parsed.sessionId : ''
    } catch (error) {
      return ''
    }
  })
}

/** 页面上会话头是不是真渲染出来了（被别的 dsh 进程占着的会话只出 composer、不出会话头）。 */
async function conversationHeaderReady(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.querySelectorAll('[data-slot="conversation.session.header"] [role="tab"]').length >= 2,
  )
}

/**
 * 页面上有没有**已结束助手回合**的那一排助手动作（#195）。
 *
 * 为什么要单独判这一件事：官方 `@deepseek-ai/dsh-client-ui-chat` 的 `TurnTailNodeView`
 * 只在回合结束时才渲染这一排（`data.closing === null` 那条分支整块返回 `null`），
 * 而空白会话（一条消息都没有）永远不合上回合——「对话区 · 助手动作『好的回答』」这一枚
 * 就是死在这里的（隔离实例上客户端落脚的正好是播种出来的那条空白会话）。判据看的是
 * 这一排动作的**槽位**在不在，不是某一枚按钮的文案。
 */
async function assistantActionsPresent(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.querySelectorAll('[data-slot="conversation.chat.assistant-actions"]').length > 0,
  )
}

/**
 * 这台网关上**服务得了**的会话候选（当作夹具用）。
 *
 * 为什么要挑：装配页默认开的是网关记着的「当前会话」，而那一条常常正被另一个 dsh
 * 进程占着写句柄（#145 的现场）——那种会话打开后只有半个界面（composer 在、会话头不在），
 * 拿它当夹具会让一批交互点「元素不在场」而空转。挑一条顶层、不在跑、非空的会话，
 * 逐条试到界面真渲染出来为止；挑不到就如实记事实（不判失败）。
 *
 * `sessionCompletedTurns(row) > 0` 这一条是 #195 加的：没有**已结束回合**的会话里，
 * 官方那一排助手动作（`conversation.chat.assistant-actions`）压根不渲染，拿它当夹具
 * 会让依赖这一排的交互点空转——而「完成过至少一轮」正是那个槽位存在的充分前提
 * （回合计数来自宿主 side 的 `sessionStats` 投影，见 `src/server/dshRpc.ts` 的
 * `sessionCompletedTurns`）。
 */
async function servableSessionCandidates(gateway: string): Promise<readonly string[]> {
  try {
    const rows = await listSessions(gateway)
    return rows
      .filter(
        (row) =>
          row.origin !== 'subagent' &&
          row.parentSessionId === undefined &&
          !row.running &&
          !row.blank &&
          sessionCompletedTurns(row) > 0,
      )
      // 跳过最新的几条：正被用户开着的通常就是它们（会话日志是单写者，被别的 dsh 进程
      // 占着的会话服务不了，#145），挑稍早一点的更容易真拿到一条服务得了的。
      .slice(5, 9)
      .map((row) => row.sessionId)
  } catch {
    return []
  }
}

export const LIVENESS_SUITE: LabSuite = {
  id: 'F-54',
  phase: 'new-feature',
  name: '交互活性探针：点得动的控件点下去必须有可观测反应，官方点得动而我们的点不动即判红（INTERACTION-LIVENESS 套件）',
  expect:
    '对一批交互点逐个「悬停 → 拍基线 → 点一下 → 1200 毫秒内有没有可观测变化」。**可观测变化有六路**（#170 补了后两路）：有意义 DOM 变化 / 弹层出现 / 宿主通道有新消息 / 语义上行有新消息（前面四路只看结构变没变），以及**文字变了**（`characterData`）、**样式或属性变了**（`attributes`）——后两路按「末态」判（记的是每个节点第一次变动前的值，闪一下又复原不算），修的是「只改文字或只改样式的控件被判成点了没反应」这一支假红。**哪几路算一条交互点的反应由那条点自己声明**（交互点表里的 `signals`），缺省是只看结构那四路 = #170 之前的口径（判据一条都没放宽）：期望是「弹层开出来 / 内容切过去」的点只按那四路判，反应本来就只出在文字或样式上的控件才写 `signals: ALL_SIGNALS`。**探针自带五枚合成对照件**（装在同一张真实页面上跑）：只改文字、只改样式两枚必须「按改前的读法判红、按六路全开判绿」，真·点了没反应的与闪一下又复原的各一枚必须仍判红。**判据不写死**：官方页里存在的交互点与官方页本身对照（官方有反应 ⇒ 我们必须有反应），只有我们有的交互点按「必须反应」判。**另一类是「只观察、绝不点击」**：动作经真网关落到用户机器上（会话头的「在访达中打开工作目录」会在用户桌面上拉起访达）或会改用户持久状态的控件（设置页的「增大字号」「打开配置文件」，以及本来就点不动的两枚禁用态：空草稿的发送、回收站计数 0 时的清空），这一类只判「控件在场（可见、几何非零）」「期望禁用时确实是禁用态」「这一步没有派发过任何点击」，每条的不点理由写在交互点表里。composer 的 ＋ 另有一条静默判据：「点了没反应时页面必须留下能指名道姓的失败行（哪个 source 失败、什么原因）」，外加一条页面内正向对照——把官方 `commandUi` 贡献表里**不合契约（缺 `available`）**的贡献就地摘掉之后 ＋ 必须恢复；这两条判的是「菜单真的开了」，固定只按**前四路**判（不许被 #170 的两路放松）。环境本身服务不了这条会话（`command directory warmup failed`，#145）时这一条只记事实。全程只读：不点发送、不点归档确认、不写任何网关数据、不在用户机器上拉起原生应用。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const chat = route('chat')
    const sidebar = route('sidebar')
    const settings = route('settings')

    // ── 页 A：chat 树（对话区）+ 官方页对照 ────────────────────────────────
    const viewport = { width: 1400, height: 950 }
    let chatPage = await openTreePage(ctx.browser, ctx.lab, chat, viewport)
    let sessionFixture = await currentSessionId(chatPage.page)
    if (!(await conversationHeaderReady(chatPage.page))) {
      const candidates = await servableSessionCandidates(ctx.lab.gateway)
      check.fact(
        `默认开的那条会话（${sessionFixture === '' ? '读不到 id' : sessionFixture}）没渲染出会话头——按「服务得了」逐条试 ${String(candidates.length)} 条候选会话当夹具`,
      )
      for (const candidate of candidates) {
        const attempt = await openTreePage(ctx.browser, ctx.lab, chat, { ...viewport, sessionId: candidate })
        if (await conversationHeaderReady(attempt.page)) {
          await chatPage.context.close()
          chatPage = attempt
          sessionFixture = await currentSessionId(attempt.page)
          break
        }
        await attempt.context.close()
      }
    }
    // #195：会话头在、但**没有已结束的助手回合**时同样要换一条会话当夹具——「对话区 ·
    // 助手动作『好的回答』」那一排只在回合合上之后才渲染（官方 `TurnTailNodeView` 的
    // `data.closing === null` 分支整块返回 null），而隔离实例上客户端落脚的正是播种出来的
    // **空白**会话（每棵工作区一条，见 `seed.ts`），于是这一枚交互点整套「元素不在场」空转、
    // 一条断言都判不到。这里按上面同一套候选（`servableSessionCandidates` #195 起只给
    // 「完成过至少一轮」的会话）换一条真会话；**判据本身一个字没改**——换了夹具之后那一枚
    // 还是按「点下去有可观测反应 / 官方点得动我们也得点得动」判。
    if (!(await assistantActionsPresent(chatPage.page))) {
      const candidates = await servableSessionCandidates(ctx.lab.gateway)
      check.fact(
        `默认那条会话（${sessionFixture === '' ? '读不到 id' : sessionFixture}）页面上没有那一排助手动作（没有已结束的助手回合）——按「完成过至少一轮」逐条试 ${String(candidates.length)} 条候选会话当夹具`,
      )
      for (const candidate of candidates) {
        const attempt = await openTreePage(ctx.browser, ctx.lab, chat, { ...viewport, sessionId: candidate })
        if ((await conversationHeaderReady(attempt.page)) && (await assistantActionsPresent(attempt.page))) {
          await chatPage.context.close()
          chatPage = attempt
          sessionFixture = await currentSessionId(attempt.page)
          break
        }
        await attempt.context.close()
      }
    }
    check.fact(`这一轮用的夹具会话：${sessionFixture === '' ? '（读不到）' : sessionFixture}`)
    await chatPage.page.evaluate(livenessRecorderScript())
    const official = await openOfficialPage(ctx, { seedSession: sessionFixture })
    try {
      const seed = await currentSessionId(chatPage.page)
      check.fact(`我们那页开着的会话：${seed === '' ? '（读不到，用官方页自己的当前会话）' : seed}`)
      const officialSession = await currentSessionId(official.page)
      check.fact(
        `官方页开着的会话：${officialSession === '' ? '（空）' : officialSession}${seed !== '' && officialSession === seed ? '（与我们一致）' : '（与我们不一致——两条路的失败原因可能因此不同，报告里按事实读）'}`,
      )

      const officialResults = new Map<string, ClickProbe>()
      for (const point of CHAT_POINTS) {
        if (point.official === undefined) continue
        // 只观察的那几条在官方页上也**只看不点**：官方页连的是同一台真网关，点它同样会
        // 在用户机器上拉起访达。这里只记一条事实（官方页上这枚在不在），不做判定。
        if (point.observeOnly !== undefined) {
          const seen = await probeObserve(official.page, point.label, point.official)
          check.fact(`[官方页·只观察] ${point.label}：${seen.detail}`)
          continue
        }
        const probe = await probeClick(official.page, point.label, point.official, { signals: point.signals ?? STRUCTURAL_SIGNALS })
        officialResults.set(point.label, probe)
        check.fact(
          `[官方页] ${point.label}：${probe.present ? probe.detail : '元素不在场'}`,
        )
      }

      // 会话头渲染出来了吗（#145：被别的 dsh 进程占着的会话只有半个界面）——会话头那几枚
      // 只观察的控件在场与否要按这个前提判，不然「整页没有会话头」会被当成「控件没了」。
      const headerReady = await conversationHeaderReady(chatPage.page)

      for (const point of CHAT_POINTS) {
        if (point.observeOnly !== undefined) {
          await observePoint(check, chatPage.page, point, 'chat', headerReady)
          continue
        }
        const ours = await probeClick(chatPage.page, point.label, point.selector, { signals: point.signals ?? STRUCTURAL_SIGNALS })
        check.fact(`[chat] ${point.label}：${ours.detail}${ours.present ? '' : `（元素不在场；期望=${point.expect}）`}`)
        if (!ours.present) {
          check.fact(`[chat] ${point.label}：这一轮页面上没有这个控件，跳过判定`)
          continue
        }
        if (ours.disabled) {
          check.fact(`[chat] ${point.label}：这一轮它是禁用态（点它确实不该有反应），只记事实`)
          continue
        }
        const officialProbe = officialResults.get(point.label)
        if (officialProbe !== undefined && officialProbe.present) {
          check.ok(
            `[chat] ${point.label}：官方页点得动（${point.expect}）时我们同样点得动`,
            ours.reacted || !officialProbe.reacted,
            `ours.reacted=${String(ours.reacted)} official.reacted=${String(officialProbe.reacted)}；${ours.detail} / 官方：${officialProbe.detail}`,
          )
        } else {
          check.ok(`[chat] ${point.label}：点下去有可观测反应（${point.expect}）`, ours.reacted, ours.detail)
        }
      }

      // ── ＋ 的专件 ────────────────────────────────────────────────────
      // 与交互点表里那一条**同一个**选择器（`COMPOSER_COMMANDS`，zh / en 两份都认）：
      // 这里要是另写一份、只认中文，en 页上这三条专件断言会一起落空（#208）。
      const addSelector = COMPOSER_COMMANDS
      // 下面三条判的都是**菜单真的开了**（结构变了），所以固定按那四路判（不看文字与属性）——#170
      // 补的文字/属性两路不进这里，这三条的判据与补观察粒度之前逐字等价（不许被放松）。
      const addOurs = await probeClick(chatPage.page, 'composer ＋', addSelector, { signals: STRUCTURAL_SIGNALS })
      const failures = candidateFailureLines(chatPage.capture.all)
      check.fact(`＋ 的候选失败行：${JSON.stringify(failures.map((line) => line.slice(0, 200)))}`)
      check.ok('＋ 不是禁用态（点不动不是因为按钮被禁用）', addOurs.present && !addOurs.disabled, `present=${String(addOurs.present)} disabled=${String(addOurs.disabled)}`)
      check.ok(
        '＋ 没反应时，页面必定留下一行能指名道姓的失败（哪个 source 失败、什么原因）——静默失败判红',
        addOurs.reacted || failures.length > 0,
        `reacted=${String(addOurs.reacted)}（只按那四路判：不看文字与属性）失败行 ${String(failures.length)} 条；${addOurs.detail}`,
      )
      screenshots.push(await shot(ctx, chatPage.page, 'liveness-01-chat'))

      // 正向对照：换一页装上「读官方 commandUi 贡献表」的探针，摘掉不合契约的贡献再点一次。
      const stripContext = await ctx.browser.newContext({ viewport: { width: 1400, height: 950 } })
      await stripContext.addInitScript({ content: fakeHostScript({}, [], []) })
      await stripContext.addInitScript({ content: livenessRecorderScript() })
      await stripContext.addInitScript({ content: commandRegistryScript() })
      const stripPage = await stripContext.newPage()
      const stripCapture = capturePage(stripPage)
      try {
        await stripPage.goto(`${ctx.lab.origin}/${chat.route}${seed === '' ? '' : `?session=${seed}`}`, {
          waitUntil: 'domcontentloaded',
        })
        await stripPage.waitForSelector(chat.readySelector, { timeout: 40_000 }).catch(() => undefined)
        await stripPage.waitForTimeout(6_000)
        const contributions = await commandContributions(stripPage)
        check.fact(
          `官方 commandUi 贡献表：${contributions === null ? '（没读到，探针没接上）' : JSON.stringify(contributions)}`,
        )
        check.ok(
          '官方 commandUi 贡献表读到了（正向对照的前提：探针真的接上了根 ctx）',
          contributions !== null,
          String(contributions),
        )
        if (contributions !== null) {
          const malformed = contributions.filter((entry) => !entry.hasAvailable).map((entry) => entry.name)
          check.fact(`注册表里缺 available 的贡献（不合官方 CommandContribution 契约）：${JSON.stringify(malformed)}`)
          const removed = await stripMalformedContributions(stripPage)
          // 同上面那条：正向对照判的是**菜单真的开了**，只按那四路判（不看文字与属性，不许被 #170 的两路放松）。
          const afterStrip = await probeClick(stripPage, 'composer ＋（摘掉违规贡献后）', addSelector, {
            signals: STRUCTURAL_SIGNALS,
          })
          check.fact(`＋ 在摘掉 ${JSON.stringify(removed)} 之后：${afterStrip.detail}`)
          const unavailable = sessionUnavailable(stripCapture.all)
          if (unavailable) {
            check.fact(
              '这一轮官方那条「command directory warmup failed」在场（会话被别的 dsh 进程占着，#145）——正向对照只记事实，不当缺陷判',
            )
          } else {
            check.ok(
              '正向对照：不合契约的贡献摘掉之后 ＋ 必须恢复（证明了「点不动」的因果就在那条贡献上）',
              afterStrip.reacted,
              `（只按那四路判：不看文字与属性）${afterStrip.detail}`,
            )
          }
          check.ok(
            '正向对照页零 pageerror',
            withoutKnownNoise(stripCapture.pageErrors).real.length === 0,
            JSON.stringify(withoutKnownNoise(stripCapture.pageErrors).real),
          )
        }
      } finally {
        await stripContext.close()
      }

      check.eq(
        '[chat] 对话区零 pageerror',
        withoutKnownNoise(chatPage.capture.pageErrors).real,
        [],
      )
      check.eq('[官方页] 零 pageerror', withoutKnownNoise(official.capture.pageErrors).real, [])
    } finally {
      await official.context.close()
      await chatPage.context.close()
    }

    // ── 页 B：sidebar 树（自有树的那几枚）────────────────────────────────
    const sidebarPage = await openTreePage(ctx.browser, ctx.lab, sidebar, { width: 1400, height: 950 })
    await sidebarPage.page.evaluate(livenessRecorderScript())
    try {
      for (const point of SIDEBAR_POINTS) {
        if (point.observeOnly !== undefined) {
          await observePoint(check, sidebarPage.page, point, 'sidebar', true)
          continue
        }
        const ours = await probeClick(sidebarPage.page, point.label, point.selector, { signals: point.signals ?? STRUCTURAL_SIGNALS })
        check.fact(`[sidebar] ${point.label}：${ours.detail}${ours.present ? '' : `（元素不在场；期望=${point.expect}）`}`)
        if (!ours.present) {
          check.fact(`[sidebar] ${point.label}：这一轮页面上没有这个控件，跳过判定`)
          continue
        }
        if (ours.disabled) {
          check.fact(`[sidebar] ${point.label}：这一轮它是禁用态（点它确实不该有反应），只记事实`)
          continue
        }
        check.ok(`[sidebar] ${point.label}：点下去有可观测反应（${point.expect}）`, ours.reacted, ours.detail)
      }
      check.eq('[sidebar] 零 pageerror', withoutKnownNoise(sidebarPage.capture.pageErrors).real, [])
      screenshots.push(await shot(ctx, sidebarPage.page, 'liveness-02-sidebar'))
    } finally {
      await sidebarPage.context.close()
    }

    // ── 页 C：settings 树（设置各节）───────────────────────────────────
    const settingsPage = await openTreePage(ctx.browser, ctx.lab, settings, { width: 1400, height: 950 })
    await settingsPage.page.evaluate(livenessRecorderScript())
    try {
      // 「打开配置文件」那条为什么只观察：`settings.action` 这个 slot 里官方那条
      // （`open-document`）的动作是经**网关宿主**用系统默认应用打开设置文档，我们自己那条
      // 走宿主能力口。官方那条由 shell 按**同 id + priority −1 遮蔽**（#178 C10+C11，
      // 遮蔽上了它就不进渲染位、这里也就数不到它；遮蔽失效它会重新出现），
      // 所以逐条数出来写进事实（不然「遮蔽失效就会点到官方的」只是读代码的推断，看不出来）。
      const docEntries = await settingsPage.page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-slot="settings.action"] > *')).map((entry) => {
          const button = entry.querySelector('button')
          return {
            // 我们自己那条的标记挂在这一层元素上，所以连它自己一起看
            //（`querySelector` 只找后代、不找自己，只看后代会把两条都报成「不是我们的」）。
            ours: entry.matches('[data-dshone-doc-action]') || entry.querySelector('[data-dshone-doc-action]') !== null,
            visible: entry.getBoundingClientRect().width > 0,
            display: getComputedStyle(entry).display,
            text: (button?.textContent ?? '').trim(),
          }
        }),
      )
      check.fact(`[settings] settings.action slot 里的条目：${JSON.stringify(docEntries)}`)
      for (const point of SETTINGS_POINTS) {
        if (point.observeOnly !== undefined) {
          await observePoint(check, settingsPage.page, point, 'settings', true)
          continue
        }
        const ours = await probeClick(settingsPage.page, point.label, point.selector, { signals: point.signals ?? STRUCTURAL_SIGNALS })
        check.fact(`[settings] ${point.label}：${ours.detail}${ours.present ? '' : `（元素不在场；期望=${point.expect}）`}`)
        if (!ours.present) {
          check.fact(`[settings] ${point.label}：这一轮页面上没有这个控件，跳过判定`)
          continue
        }
        if (ours.disabled) {
          check.fact(`[settings] ${point.label}：这一轮它是禁用态（点它确实不该有反应），只记事实`)
          continue
        }
        check.ok(`[settings] ${point.label}：点下去有可观测反应（${point.expect}）`, ours.reacted, ours.detail)
      }
      // 探针自己的对照件（#170）：装在这一页上跑（理由与三组判据见文件头与 runProbeFixtures）。
      await runProbeFixtures(check, settingsPage.page, 'settings')
      check.eq('[settings] 零 pageerror', withoutKnownNoise(settingsPage.capture.pageErrors).real, [])
      screenshots.push(await shot(ctx, settingsPage.page, 'liveness-03-settings'))
    } finally {
      await settingsPage.context.close()
    }

    return screenshots
  },
}
