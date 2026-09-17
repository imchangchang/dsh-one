/**
 * 浏览器验证 harness 的公共件（#78）：开页、抓控制台、查槽位、收集断言。
 *
 * 验证套件（suites.ts）只用这里的两样东西：
 * - `openTreePage`：按实验室某棵树的页面开一个干净上下文（新 localStorage、
 *   装了假宿主），等首屏就绪并静置，返回该页的控制台/报错记录；
 * - `Check`：断言收集器——一条断言一处观测，最后折成 ledger 条目。
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { installLabDataset, type DatasetStats, type LabDataset } from './dataset.ts'
import { EN, ZH } from '../../src/ui/assembly/shell/workspaceTree/locale.ts'
import { fakeHostScript } from './fakeHost.ts'
import type { LabServer, LabTreeRoute } from './labServer.ts'

/** 一条断言的结论。 */
export interface Assertion {
  label: string
  ok: boolean
  detail: string
}

/**
 * 一条**文案**断言：把期望值写成插件词典里的那条中文，再按当前页面语言放宽到它对应的
 * 两种取值（zh / en）。
 *
 * 为什么要有它：页面语言是**运行环境的输入**（开发者日常实例是 zh，全新 `DSH_HOME` 的空
 * 实例起来是 en）。断言里写死中文会得到一条「换台机器就红」的假失败（#148 立、#162 普查），
 * 所以期望值一律从词典来：给一条中文文案，这里反查出它的键、把 `{n}` 这类占位抓出来，
 * 再渲染出 zh / en 两份；断言判「实测值等于其中一份」。
 *
 * 判据一个字没放宽：能对上的永远是**同一个键**的那两种语言取值。
 */
/**
 * 官方命名空间的几条（我们的弹窗经官方 `t()` 取，值不归 `workspaceTree/locale.ts` 管）：
 * 值取自官方词典本身（zh 页 / en 页各实测一次）。套件判这些文案时同样要两种语言都认。
 */
const OFFICIAL_EXTRA: Readonly<Record<string, readonly [string, string]>> = {
  取消: ['取消', 'Cancel'],
}

export function texts(zhText: string): string[] {
  const extra = OFFICIAL_EXTRA[zhText]
  if (extra !== undefined) return [...extra]
  for (const [key, template] of Object.entries(ZH)) {
    if (template === zhText) return [zhText, EN[key] ?? zhText]
  }
  // 带占位的那几条：把模板按占位切成字面量段，逐段试「截断到第 i 段」（i = 0,1,2… 个占位）。
  // 这样 `仅显示前 20 条结果` 与只写了前半句的 `仅显示前` 都能对上同一条词典文案，
  // 并渲染出 en 那一份（`Showing the first 20 results` / `Showing the first`）。
  // 逐段要求**整段对上**（不是随便 startsWith），免得像早先那样配到隔壁那条上。
  const escape = (part: string): string => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  for (const [key, template] of Object.entries(ZH)) {
    const english = EN[key]
    if (typeof english !== 'string') continue
    const zhParts = template.split(/\{(\w+)\}/)
    const enParts = english.split(/\{(\w+)\}/)
    if (zhParts.length !== enParts.length) continue
    // 模板以占位开头（`{n} 个会话没能移入回收站`、`{n} ago` 这类）时的两条护栏：
    // 首个占位**只认数字**，而且输入必须以数字开头——否则前缀匹配会退化成「随便一段话
    // 只要以某个尾巴结尾就算命中」（早先实测：`仅显示前` 配到了 `{n} 前` 那条上，
    // 渲染出「仅显示 ago」）。
    const leadingNumeric = (zhParts[0] ?? '').length === 0
    for (let placeholders = 0; placeholders * 2 < zhParts.length; placeholders += 1) {
      const zhSegments: string[] = []
      const enSegments: string[] = []
      for (let index = 0; index <= placeholders; index += 1) {
        zhSegments.push(zhParts[index * 2] as string)
        enSegments.push(enParts[index * 2] as string)
      }
      if (placeholders === 0) {
        // 只写了前半句时（`仅显示前` 对 `仅显示前 {n} 条结果…`）连首段末尾的空白一起去掉再比。
        if (zhSegments[0] === zhText) return [zhText, enSegments[0] as string]
        if ((zhSegments[0] ?? '').trimEnd() === zhText) {
          return [zhText, (enSegments[0] ?? '').trimEnd()]
        }
        continue
      }
      const names: string[] = []
      for (let index = 1; index <= placeholders; index += 1) names.push(zhParts[index * 2 - 1] as string)
      if (leadingNumeric && !/^\d/.test(zhText)) continue
      const wildcard = `(${leadingNumeric ? '\\d+' : '.+?'})`
      const pattern = `^${zhSegments.map(escape).join(wildcard)}$`
      const match = new RegExp(pattern, 'u').exec(zhText)
      if (match === null) continue
      const values = Object.fromEntries(names.map((name, index) => [name, match[index + 1] ?? '']))
      const render = (segments: readonly string[]): string =>
        segments.reduce((acc, segment, index) => acc + (index === 0 ? '' : (values[names[index - 1] as string] ?? '')) + segment, '')
      return [render(zhSegments), render(enSegments)]
    }
  }
  // 词典里没有这一条（例如夹具自己起的名字）：原样返回，判据照旧只认这一份。
  return [zhText]
}

/**
 * 一串实测文案里有没有词典里这条（**数组元素逐个等于**它的 zh / en 任一份）。
 *
 * 与 {@link hasText} 的差别：那个判「一段文字里含不含这条」，这个判「这一串条目里有没有
 * 等于这条的那一项」。菜单项清单这类读数是数组，用这个。
 */
export function hasAnyText(actual: readonly (string | null | undefined)[], zhText: string): boolean {
  const allowed = texts(zhText)
  return actual.some((item) => typeof item === 'string' && allowed.includes(item))
}

/**
 * 实测文案**恰好等于**词典里那条（zh / en 任一份）。判据写成「页面文案是『取消置顶』」时用它，
 * 与 {@link texts} 的差别只是这里直接吃实测值、不必自己判 `typeof`。
 */
export function isText(actual: string | null | undefined, zhText: string): boolean {
  return typeof actual === 'string' && texts(zhText).includes(actual)
}

/**
 * 「这段实测文案里含不含词典里那条」（zh / en 任一份含上就算）。
 *
 * 与 {@link texts} 同一件事的另一种用法：判据写成「页面文案里出现『回收站』」时，
 * 期望值同样要从词典来，不能写死中文（理由见 `texts`）。带占位的那几条
 * （`归档整组（2 个会话）`）也会按实测里的数字渲染出 en 那一份再比。
 */
export function hasText(actual: string | null | undefined, zhText: string): boolean {
  const text = typeof actual === 'string' ? actual : ''
  return texts(zhText).some((variant) => text.includes(variant))
}

/** 断言收集器：`ok/eq` 记一条，`fact` 记一个观测值（不计入通过数，写进报告说明）。 */
export class Check {
  private readonly assertions: Assertion[] = []
  private readonly facts: string[] = []

  ok(label: string, condition: boolean, detail?: unknown): boolean {
    this.assertions.push({ label, ok: condition, detail: detail === undefined ? '' : String(detail) })
    return condition
  }

  eq(label: string, actual: unknown, expected: unknown): boolean {
    const same = JSON.stringify(actual) === JSON.stringify(expected)
    return this.ok(label, same, same ? String(actual) : `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`)
  }

  /**
   * 一组文案的逐项比较（见 {@link texts}）：期望写成一串词典里的中文（可以混着不是词典文案的
   * 值，例如图标名 `minus`），实测值逐项等于它的 zh / en 任一份就算过。
   */
  eqTexts(label: string, actual: readonly string[] | undefined, expected: readonly string[]): boolean {
    const list = Array.isArray(actual) ? actual : []
    const same =
      list.length === expected.length &&
      expected.every((want, index) => texts(want).includes(list[index] ?? '\u0000'))
    return this.ok(
      label,
      same,
      same ? JSON.stringify(list) : `actual=${JSON.stringify(list)} expected（每项 zh/en 任一份）=${JSON.stringify(expected)}`,
    )
  }

  /**
   * 文案断言（见 {@link texts}）：`expected` 写成词典里的中文，实测值等于它的 zh / en 任一份
   * 就算过。用它的地方都是「页面把这条文案渲染成什么」这一类的判据。
   */
  eqText(label: string, actual: unknown, expected: string): boolean {
    const allowed = texts(expected)
    const same = allowed.includes(typeof actual === 'string' ? actual : JSON.stringify(actual))
    return this.ok(
      label,
      same,
      same ? String(actual) : `actual=${JSON.stringify(actual)} expected（zh/en 任一份）=${JSON.stringify(allowed)}`,
    )
  }

  /** 只记录观测值（例如「treeitems=17」），不判定。 */
  fact(line: string): void {
    this.facts.push(line)
  }

  get passed(): number {
    return this.assertions.filter((a) => a.ok).length
  }

  get failed(): Assertion[] {
    return this.assertions.filter((a) => !a.ok)
  }

  get total(): number {
    return this.assertions.length
  }

  /** 报告里的「说明」栏：先给结论计数，再给观测值，最后列失败明细。 */
  notes(): string {
    const head = `本套件断言 ${String(this.total)} 条，通过 ${String(this.passed)}。`
    const facts = this.facts.length === 0 ? '' : `\n观测：\n${this.facts.map((f) => `- ${f}`).join('\n')}`
    const failures =
      this.failed.length === 0
        ? ''
        : `\n失败断言：\n${this.failed.map((f) => `- ${f.label}${f.detail === '' ? '' : `（${f.detail}）`}`).join('\n')}`
    return head + facts + failures
  }
}

/** 一页的控制台记录（分类靠文本，因为官方不会给错误打标记）。 */
export interface PageCapture {
  consoleErrors: string[]
  consoleWarnings: string[]
  pageErrors: string[]
  /** 全部 console 文本（诊断用，仅在失败时进报告）。 */
  all: string[]
}

/** 官方渲染层的崩溃信号：槽位条目抛错 / 链式选择器抛错。 */
export const CRASH_RE = /slot entry crashed|chain selector crashed/
/** 官方装载层的「契约没满足」信号：条目没激活（缺服务）——页面上会整块报错。 */
export const BOOT_FAIL_RE = /did not activate|waiting for service/

/**
 * 已知噪音白名单：**只**放行与底座契约无关、且另有 issue 跟踪的官方插件噪音。
 * 崩溃（`slot entry crashed`）与装载未激活（`did not activate`）永远不准进这里
 * ——它们就是本套件要抓的底座缺口。每条必须带理由与跟踪 issue，无跟踪的不许进。
 *
 * 现在为空（#74 修完）：唯一那条「设置树 agent-preset 在非活跃上下文读 sessions」
 * 的真因是**我方 settings frame 少声明了官方 root 子槽 `main`**（根因与修法见
 * src/ui/assembly/shell/settingsLayoutPlugin.ts 的 root 注册注释），不是官方件噪音。
 * 留空机制不删：将来真要放行，仍按上面的规矩逐条带理由与 issue 进来。
 */
export const KNOWN_NOISE: ReadonlyArray<{ pattern: RegExp; reason: string }> = []

/** 命中白名单则返回理由（用于报告里如实记录放行了什么）。 */
export function knownNoise(line: string): string | undefined {
  return KNOWN_NOISE.find((entry) => entry.pattern.test(line))?.reason
}

/** 过滤掉已知噪音后的行（报告里同时保留「放行了什么」）。 */
export function withoutKnownNoise(lines: readonly string[]): { real: string[]; noise: string[] } {
  const real: string[] = []
  const noise: string[] = []
  for (const line of lines) {
    if (knownNoise(line) === undefined) real.push(line)
    else noise.push(line)
  }
  return { real, noise }
}


export function capturePage(page: Page): PageCapture {
  const captured: PageCapture = { consoleErrors: [], consoleWarnings: [], pageErrors: [], all: [] }
  page.on('console', (message) => {
    const text = `${message.type()}: ${message.text()}`
    captured.all.push(text)
    if (message.type() === 'error') captured.consoleErrors.push(message.text())
    if (message.type() === 'warning') captured.consoleWarnings.push(message.text())
  })
  page.on('pageerror', (error) => {
    captured.pageErrors.push(error.message)
    captured.all.push(`pageerror: ${error.message}`)
  })
  return captured
}

/** 打开一棵树的页面：干净上下文 + 假宿主 + 等首屏 + 静置。 */
export interface OpenOptions {
  width?: number
  height?: number
  theme?: 'dark' | 'light'
  /** chat 树的启动注入会话 id。 */
  sessionId?: string
  /** 首屏就绪超时（毫秒）。 */
  readyTimeoutMs?: number
  /** 首屏就绪后再静置多久（让异步注册/首帧请求落定）。 */
  settleMs?: number
  /**
   * 抹掉自有 frame 标记（#83 可移植性证据，见 `stripFrameMarkersScript`）：
   * 页面上不存在任何 `data-shell*` 标记，用来实测「插件不靠自有 frame 也工作」。
   */
  stripFrameMarkers?: boolean
  /** 装上 fiber 探针（#91，见 `fiberProbeScript`）：FIBER 套件读它的记录做断言。 */
  fiberProbe?: boolean
  /**
   * 装上 VS Code 链接拦截层的替身（#150，见 `vscodeLinkLayerScript`）：F-48 读它的记录
   * 断言「捕获兜底接管后这一层不再收到同一次点击」（不叠加成双开）。
   */
  linkLayer?: boolean
  /** 假宿主的状态存储初值（键 → 值；#82 的迁移/读写断言用）。 */
  state?: Record<string, unknown>
  /**
   * 点名让哪些宿主调用失败（#110）：假宿主对这些调用一律回
   * `{code:'lab/forced'}` 失败回执——验「动作失败时界面给不给可见反馈」要用真的
   * 失败回执，而不是去造假界面。只作用于 {@link openTreePage} 新建的上下文。
   */
  failCalls?: readonly string[]
  /**
   * 这个假宿主「打开的文件夹」（#112）：`vscode.workspaceFolders` 的回执，缺省空表
   * = 没开任何文件夹（侧栏树按「没有当前工作区」渲染：不显示徽标、不置顶）。场景中途
   * 要换成另一份，用 {@link setLabWorkspaceFolders} 再重载页面。
   */
  workspaceFolders?: readonly string[]
  /**
   * 页内数据集夹具（#162，见 `dataset.ts`）：给这一页喂一份套件自己声明的工作区与会话，
   * 判据就不再吃「这台机器上碰巧有什么数据」。**必须在页面第一次导航之前装**，所以走
   * 这里（`newContext` 之后、`newPage` 之前），套件不用为夹具再重载一次页面。
   *
   * 三种取值（**默认不装**，与「日常实例整轮是合入门禁」这条口径配套）：
   * - 传一份 `LabDataset`：装这一份——**要夹具数据的套件显式声明**，两种跑法下都用它。
   * - `null`：这一页明确要真网关数据（与官方页并排对照、零工作区空态这类套件）。
   * - 不传：听这一轮跑法的（`LabServer.dataset`，见 `labServer.startLabServer`）——
   *   **日常实例整轮不装**（套件本来就按真实数据写的），`--empty` 那一轮由 verify.ts
   *   统一给侧栏那两棵树装上 `SIDEBAR_DATASET`（空实例上没有数据可依赖，判据必须是
   *   自足的）。
   */
  dataset?: LabDataset | null
}

export interface OpenedPage {
  context: BrowserContext
  page: Page
  capture: PageCapture
  url: string
  /**
   * 这一页装的页内数据集夹具的计数（没装夹具时为 undefined）。套件用它断言
   * 「夹具真的接上了」，而不是把空读数当结论。
   */
  dataset?: DatasetStats
  /** 首屏就绪选择器是否出现（false 时页面很可能整块没起来）。 */
  ready: boolean
}

/**
 * 「页面上没有自有 frame 标记」的页面侧脚本（#83）：把 `data-shell*` 属性的写入
 * 全部拦掉（React 写属性走 `Element.prototype.setAttribute`），属性从来没进过
 * DOM。样式与其余 DOM 一律不动，所以页面照常渲染。
 *
 * 为什么用这个做可移植性证据：官方 web 里本来就没有这个元素，插件若还按
 * `[data-shell="dsh-one"]` 取挂载点，取不到就整块不工作——而这件事在「页面上有
 * 标记」的实验室页面里永远看不出来。抹掉之后仍工作，才说明挂载点在官方语义容器上。
 */
export function stripFrameMarkersScript(): string {
  return `(() => {
  const write = Element.prototype.setAttribute
  Element.prototype.setAttribute = function (name, value) {
    if (String(name).toLowerCase().startsWith("data-shell")) return
    return write.call(this, name, value)
  }
})()`
}

/**
 * VS Code webview 链接拦截层的**替身**（#150）：把 host 在真 webview 里装的那层
 * 「点锚点就交给宿主打开」的监听在实验室页面上重现一份，供套件观察它到底收到了几次点击。
 *
 * 为什么需要替身：这层拦截是**宿主（VS Code）装的**，实验室页面是普通浏览器，跑不出
 * 真 webview 的多层结构（真 webview = 外层文档 + 内层 iframe，监听挂在内层 window 上）。
 * 而 #150 要验的两件事都只有它在场才看得见——①「锚点自己 stopPropagation 就再也到不了
 * 这一层」（真因）；② 我们那层捕获兜底接管之后，这一层**不再收到**同一次点击（不会
 * 与它叠加成双开）。所以按官方源码逐句抄一份最小替身，把「postMessage 给宿主开链接」
 * 换成「记一笔」，其余（`isTrusted` 判据、`composedPath` 找锚点、hash 分支、`preventDefault`）
 * 与官方逐条同形。
 *
 * 出处：VS Code `out/vs/workbench/contrib/webview/browser/pre/index.html` 的
 * `handleInnerClick`（那个文件里它是 `contentWindow.addEventListener('click', handleInnerClick)`，
 * 即**冒泡阶段**、挂在页面 window 上，因此点击路径上一旦有人 `stopPropagation` 它就收不到）。
 * 记录读出走 {@link linkLayerFacts}。
 */
export function vscodeLinkLayerScript(): string {
  return `(() => {
  const record = []
  globalThis.__LAB_VSCODE_LINK_LAYER__ = { record }
  window.addEventListener("click", (event) => {
    if (!event.isTrusted || !event.view || !event.view.document) return
    const baseElement = event.view.document.querySelector("base")
    for (const pathElement of event.composedPath()) {
      const node = pathElement
      if (node.tagName && String(node.tagName).toLowerCase() === "a" && node.href) {
        if (node.getAttribute("href") === "#") {
          event.view.scrollTo(0, 0)
        } else if (node.hash && (node.getAttribute("href") === node.hash || (baseElement && node.href === baseElement.href + node.hash))) {
          const fragment = node.hash.slice(1)
          const decodedFragment = decodeURIComponent(fragment)
          const scrollTarget = event.view.document.getElementById(fragment) ?? event.view.document.getElementById(decodedFragment)
          if (scrollTarget) scrollTarget.scrollIntoView()
          else if (decodedFragment.toLowerCase() === "top") event.view.scrollTo(0, 0)
        } else {
          record.push({ kind: "link", href: node.getAttribute("href"), url: node.href.baseVal || node.href })
        }
        event.preventDefault()
        return
      }
    }
  })
})()`
}

/** 链接拦截层替身收到的点击（{@link vscodeLinkLayerScript}）。 */
export interface LinkLayerFacts {
  /** 每一次「这一层会交给宿主去开」的点击（顺序 = 点击顺序）。 */
  hits: ReadonlyArray<{ kind: string; href: string | null; url: string }>
}

/** 读出链接拦截层替身的记录（没装替身时 hits 为空表）。 */
export async function linkLayerFacts(page: Page): Promise<LinkLayerFacts> {
  const hits = await page.evaluate(() => {
    const layer = (globalThis as { __LAB_VSCODE_LINK_LAYER__?: { record: unknown[] } }).__LAB_VSCODE_LINK_LAYER__
    return (layer?.record ?? []) as { kind: string; href: string | null; url: string }[]
  })
  return { hits }
}

/**
 * 页面侧 fiber 探针（#91）：把每个 cordis scope（fiber）的状态变化记进
 * `globalThis.__LAB_FIBER__`，供套件读出来断言。
 *
 * 为什么必须有它：cordis 插件 fiber 失败（例如 `slot "X" is not declared`）
 * **不进浏览器控制台**——官方 client logger 没有 console exporter（#74 实测首屏
 * console 0 行），整个 scope 静默失败，只能靠派生症状（服务在已失活上下文里被读）
 * 暴露。这类「官方改了座位名/父子声明就整块不活」的漂移要有自己的断言。
 *
 * 机制（三层，全部走官方既有接口，不改官方代码；@see AGENTS.md 的机制优先序）：
 * 1. 包 `__ModuleLoader__` 的 `load`：每个注册的 factory 包一层，模块 materialize
 *    （factory 执行）时记下 `插件 id → 其 apply 函数` 的映射。用 Proxy 而不是
 *    直接赋值——官方模块系统启动时会**把 facade 的 load 换成自己那份**，只包最初
 *    那个 facade 收不到后续注册。
 * 2. 只给 `@deepseek-ai/dsh-client-modules` 的 apply 包一层，拿它的 ctx：它是页面
 *    第一个跑起来的插件（装配页 facade 自己就按这个 id 找它，见 pageHtml.ts 的
 *    QUEUE_FACADE_JS），所以在**别的 fiber 还没创建之前**就接上事件总线。
 *    **不包别的插件的 apply**：替换 apply 会改掉插件对象的函数身份，官方 loader
 *    认得那个身份——实测（#91 取证）包 `@deepseek-ai/dsh-api-remotes` 的 apply 会让
 *    它挂载的 remote.* 服务全体消失、34 个条目停在 pending。
 * 3. 监听 cordis 事件总线的两个内部事件：`internal/plugin`（fiber 创建时发出，
 *    参数是 fiber，`fiber.runtime.callback` 就是它的插件回调）与 `internal/status`
 *    （状态变化时发出，参数是 fiber + 旧状态）。状态值来自官方 Fiber 的状态枚举：
 *    0 pending / 1 loading / 2 active / 3 FAILED / 4 disposed / 5 unloading。
 *    子 scope（会话级等）的 fiber 回调不在映射里，就沿 `fiber.parent` 往上找有主的
 *    那一层——#74 那条失败正是 ui-agent-preset 的**会话级** scope。
 */
export function fiberProbeScript(): string {
  return `(() => {
  const MODULES_ID = "@deepseek-ai/dsh-client-modules"
  const STATE = { 0: "pending", 1: "loading", 2: "active", 3: "failed", 4: "disposed", 5: "unloading" }
  const record = { plugins: {}, attached: 0, events: 0, scopes: [], failed: [], errors: [] }
  globalThis.__LAB_FIBER__ = record
  const idsByCallback = new WeakMap()
  const idsByFiber = new Map()
  const seenBuses = new WeakSet()
  const stateOf = (value) => STATE[value] ?? String(value)
  const attach = (ctx) => {
    const service = ctx === undefined || ctx === null ? undefined : ctx.events
    const bus = service !== undefined && typeof service.on === "function" ? service : ctx
    if (bus === undefined || bus === null || typeof bus.on !== "function" || seenBuses.has(bus)) return
    seenBuses.add(bus)
    record.attached += 1
    bus.on("internal/plugin", (fiber) => {
      try {
        const callback = fiber && fiber.runtime ? fiber.runtime.callback : undefined
        const plugin = callback === undefined ? undefined : idsByCallback.get(callback)
        if (plugin !== undefined) idsByFiber.set(fiber.uid, plugin)
      } catch (err) {
        if (record.errors.length < 20) record.errors.push("plugin: " + String(err))
      }
    })
    bus.on("internal/status", (fiber, previous) => {
      try {
        if (fiber === undefined || fiber === null) return
        record.events += 1
        let plugin
        let owner = fiber
        while (owner !== undefined && owner !== null && plugin === undefined) {
          plugin = idsByFiber.get(owner.uid)
          const parentCtx = owner.parent
          const parentFiber = parentCtx === undefined || parentCtx === null ? undefined : parentCtx.fiber
          if (parentFiber === undefined || parentFiber === null || parentFiber === owner) break
          owner = parentFiber
        }
        let name = ""
        try { if (typeof fiber.name === "string") name = fiber.name } catch (ignored) {}
        const entry = {
          uid: fiber.uid,
          plugin: plugin ?? null,
          name,
          state: stateOf(fiber.state),
          prev: stateOf(previous),
          error: String((fiber._error && fiber._error.message) || ""),
        }
        if (record.scopes.length < 4000) record.scopes.push(entry)
        if (entry.state === "failed" && record.failed.length < 40) record.failed.push(entry)
      } catch (err) {
        if (record.errors.length < 20) record.errors.push("status: " + String(err))
      }
    })
  }
  const register = (exports, id) => {
    record.plugins[id] = true
    if (typeof exports === "function") idsByCallback.set(exports, id)
    else if (exports !== null && typeof exports === "object") {
      if (typeof exports.apply === "function") idsByCallback.set(exports.apply, id)
      const fallback = exports.default
      if (fallback !== undefined && fallback !== null && typeof fallback.apply === "function") idsByCallback.set(fallback.apply, id)
    }
  }
  const wrapLoad = (entry) => {
    if (typeof entry !== "function" || entry.__labWrapped === true) return entry
    const original = entry
    const wrapped = function (registration) {
      if (registration !== null && typeof registration === "object" && typeof registration.factory === "function") {
        const id = registration.id ?? registration.name ?? "?"
        const factory = registration.factory
        registration.factory = function () {
          const exports = factory.apply(this, arguments)
          try {
            register(exports, id)
            if (id === MODULES_ID && exports !== null && typeof exports === "object" && typeof exports.apply === "function") {
              const apply = exports.apply
              exports.apply = function (ctx) {
                attach(ctx)
                return apply.apply(this, arguments)
              }
            }
          } catch (err) {
            if (record.errors.length < 20) record.errors.push("register " + id + ": " + String(err))
          }
          return exports
        }
      }
      return original.apply(this, arguments)
    }
    wrapped.__labWrapped = true
    return wrapped
  }
  const proxies = new WeakMap()
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

/** fiber 探针记下的一处状态变化（`state`/`prev` 是官方 Fiber 状态枚举的名字）。 */
export interface FiberScopeFact {
  uid: number
  /** 这个 scope 属于哪个插件 id（子 scope 沿 parent 找到有主的那层；找不到为 null）。 */
  plugin: string | null
  name: string
  state: string
  prev: string
  error: string
}

export interface FiberProbeFacts {
  /** 探针登记到的插件 id（模块 materialize 时记下）。 */
  plugins: string[]
  /** 接上的 cordis 事件总线条数（0 = 探针没生效，断言会是空的）。 */
  attached: number
  /** 收到的 `internal/status` 事件数。 */
  events: number
  scopes: FiberScopeFact[]
  failed: FiberScopeFact[]
  /** 探针自身抛过的异常（非空说明记录可能不全，别把「零失败」当结论）。 */
  errors: string[]
}

/** 读出页面上的 fiber 探针记录（没装探针时返回 null）。 */
export async function fiberFacts(page: Page): Promise<FiberProbeFacts | null> {
  const raw = await page.evaluate(() => {
    const record = (globalThis as { __LAB_FIBER__?: unknown }).__LAB_FIBER__
    if (record === undefined) return null
    const typed = record as {
      plugins: Record<string, boolean>
      attached: number
      events: number
      scopes: FiberScopeFact[]
      failed: FiberScopeFact[]
      errors: string[]
    }
    return { ...typed, plugins: Object.keys(typed.plugins) }
  })
  return raw
}

export async function openTreePage(
  browser: Browser,
  lab: LabServer,
  route: LabTreeRoute,
  options: OpenOptions = {},
): Promise<OpenedPage> {
  const context = await browser.newContext({
    viewport: { width: options.width ?? 1200, height: options.height ?? 900 },
    deviceScaleFactor: 2,
  })
  await context.addInitScript({
    content: fakeHostScript(options.state ?? {}, options.failCalls ?? [], options.workspaceFolders ?? []),
  })
  // 数据集夹具（#162）：装在这个上下文上、在第一次导航之前，首帧基线就已是夹具那一份。
  // 缺省口径见 OpenOptions.dataset 的说明：套件显式声明的优先，否则听这一轮跑法的
  // （`lab.dataset`，只有 `--empty` 那一轮会给；只作用于侧栏那两棵树的页面）。
  const fallback = route.route.startsWith('sidebar') ? lab.dataset : undefined
  const dataset = options.dataset === undefined ? fallback : (options.dataset ?? undefined)
  const datasetStats = dataset === undefined ? undefined : await installLabDataset(context, dataset)
  return await openPageIn(lab, route, context, options, datasetStats)
}

/**
 * 把假宿主的「打开的文件夹」换成另一份（#112 的场景切换：空表 / 命中 / 多根 / 没命中）。
 *
 * 为什么必须重载页面才生效：这份表在页面挂载时经能力口读一次（读回前按「没有当前工作区」
 * 渲染），而初始化脚本每次导航都会重跑、把值重置回当初注入的那份。所以套件写第二份时
 * **另装一条初始化脚本**（后装的覆盖先装的），再重载页面——页面重挂载时读到的就是新的。
 */
export async function setLabWorkspaceFolders(context: BrowserContext, paths: readonly string[]): Promise<void> {
  await context.addInitScript({
    content: `(() => { globalThis.__LAB_HOST__.workspaceFolders = ${JSON.stringify([...paths])} })()`,
  })
}

/**
 * 在同一浏览器上下文（= 同一源、同一 localStorage）里再开一个装配页。
 *
 * 为什么需要它：真 VS Code 里多条 webview 同源、localStorage 共享——#71 的 spike
 * 实证多 tab 会互相覆盖官方恢复键（`dsh.sessions.current`），多开通道的启动注入
 * 正是为这个现场设计的。分上下文的开页（{@link openTreePage}）造不出这个现场，
 * 这一档断言（多开 tab 互不串）必须走这条。
 *
 * 注意：调用方关闭返回页时**只能关这个 page**，不能关 context（那会把先前那条
 * 页面一起关掉）——`context.close()` 由上下文的首个页面持有者负责。
 */
export async function openTreePageAlongside(
  existing: OpenedPage,
  lab: LabServer,
  route: LabTreeRoute,
  options: OpenOptions = {},
): Promise<OpenedPage> {
  return await openPageIn(lab, route, existing.context, options)
}

/** 在一个给定上下文里开页并等就绪（两个入口的共用体）。 */
async function openPageIn(
  lab: LabServer,
  route: LabTreeRoute,
  context: BrowserContext,
  options: OpenOptions,
  datasetStats?: DatasetStats,
): Promise<OpenedPage> {
  // 抹自有 frame 标记（#83）：两处入口都认这个开关，且必须在建页之前装——
  // 页面任何脚本执行前生效，属性才从来没进过 DOM。（假宿主由上下文持有者
  // 在 `newContext` 之后统一装，同源的后续页面自然继承，不重复装。）
  if (options.stripFrameMarkers === true) await context.addInitScript({ content: stripFrameMarkersScript() })
  // fiber 探针（#91）同理：必须早于页面任何脚本，才包得住 `__ModuleLoader__`
  // 的第一次赋值（facade）。
  if (options.fiberProbe === true) await context.addInitScript({ content: fiberProbeScript() })
  // 链接拦截层替身（#150）同一条道理：替身要早于页面任何脚本挂上，才对应真 webview
  // 里「外层文档先于页面内容装好监听」的位置。
  if (options.linkLayer === true) await context.addInitScript({ content: vscodeLinkLayerScript() })
  const page = await context.newPage()
  const capture = capturePage(page)
  const query = new URLSearchParams()
  if (options.theme === 'light') query.set('theme', 'light')
  if (options.sessionId !== undefined && options.sessionId !== '') query.set('session', options.sessionId)
  const suffix = query.toString() === '' ? '' : `?${query.toString()}`
  const url = `${lab.origin}/${route.route}${suffix}`
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  let ready = true
  try {
    await page.waitForSelector(route.readySelector, { timeout: options.readyTimeoutMs ?? 40_000 })
  } catch {
    ready = false
  }
  await page.waitForTimeout(options.settleMs ?? 2_500)
  return { context, page, capture, url, ready, ...(datasetStats === undefined ? {} : { dataset: datasetStats }) }
}

export interface SlotFact {
  key: string
  children: number
}

/** 页面上所有槽位锚点的子元素数 + 崩溃标记（`data-slot-error`）。 */
export async function slotFacts(page: Page): Promise<{ slots: SlotFact[]; errors: string[] }> {
  return page.evaluate(() => {
    const slots = Array.from(document.querySelectorAll('[data-slot]')).map((element) => ({
      key: element.getAttribute('data-slot') ?? '',
      children: element.children.length,
    }))
    const errors = Array.from(document.querySelectorAll('[data-slot-error]')).map(
      (element) => element.getAttribute('data-slot-error') ?? '',
    )
    return { slots, errors }
  })
}

/**
 * 槽位锚点的子元素数：`key` 是**完整槽位名**（如 `main`、`main.conversation`、
 * `conversation.composer.bar`）。给了 `outer` 就先定位外层锚点，再在外层之内找
 * `key`——用来断言嵌套槽位的从属关系。找不到返回 -1。
 */
export async function slotChildren(page: Page, key: string, outer?: string): Promise<number> {
  return page.evaluate(
    ({ slotKey, outerKey }) => {
      const scope: Element | null =
        outerKey === null ? document.body : document.querySelector(`[data-slot="${outerKey}"]`)
      const found: Element | null = scope === null ? null : scope.querySelector(`[data-slot="${slotKey}"]`)
      return found === null ? -1 : found.children.length
    },
    { slotKey: key, outerKey: outer ?? null },
  )
}

/** 页面可见文本（诊断/内容断言用，先压缩空白）。 */
export async function bodyText(page: Page): Promise<string> {
  const text = await page.evaluate(() => document.body.innerText)
  return text.replace(/\s+/g, ' ').trim()
}

/** 本次运行里页面上出现过的「契约缺口」文案（崩溃/未激活），失败时写进报告。 */
export function contractGaps(
  capture: PageCapture,
  extraErrors: readonly string[] = [],
): { crashes: string[]; bootFails: string[]; pageErrors: string[]; noise: string[] } {
  const errors = withoutKnownNoise([...capture.pageErrors, ...extraErrors])
  const lines = [...capture.consoleErrors, ...capture.consoleWarnings, ...capture.pageErrors, ...extraErrors]
  return {
    crashes: lines.filter((line) => CRASH_RE.test(line)),
    bootFails: lines.filter((line) => BOOT_FAIL_RE.test(line)),
    pageErrors: errors.real,
    noise: errors.noise,
  }
}

/** 造一个 headless（或带界面）的 chromium。 */
export async function launchBrowser(headless = true): Promise<Browser> {
  return chromium.launch({ headless })
}

/**
 * 等 fiber 状态**静下来**再下结论（F-10 / F-55 共用）。
 *
 * 为什么不能只睡一个固定时长：失败发生在会话级 scope 创建那一刻（#74 那条就是），
 * 而那一刻取决于会话数据什么时候到——睡短了会漏，睡长了每棵树白等。这里改成看
 * `internal/status` 事件的增长：连续 `quietMs` 没有新事件就当这棵树装完了，
 * 上限 `maxMs` 兜底（跑着的会话会持续推流，不能无限等）。
 */
export async function waitForFiberQuiet(
  page: Page,
  check: Check,
  label: string,
  options: { quietMs?: number; maxMs?: number } = {},
): Promise<FiberProbeFacts> {
  const quietMs = options.quietMs ?? 1500
  const maxMs = options.maxMs ?? 15_000
  const started = Date.now()
  let facts = await fiberFacts(page)
  let lastEvents = facts?.events ?? -1
  let quietSince = Date.now()
  while (Date.now() - started < maxMs) {
    await page.waitForTimeout(250)
    const next = await fiberFacts(page)
    if (next === null) break
    facts = next
    if (next.events !== lastEvents) {
      lastEvents = next.events
      quietSince = Date.now()
      continue
    }
    if (Date.now() - quietSince >= quietMs) break
  }
  check.fact(`${label}：fiber 探针等待 ${String(Date.now() - started)}ms 后静下来（事件数 ${String(facts?.events ?? -1)}）`)
  if (facts === null) throw new Error(`${label}: fiber 探针没装上（页面里没有 __LAB_FIBER__）`)
  return facts
}

/** 一条失败 scope 的人话描述（失败信息里直接点名插件、状态与原因）。 */
export function describeFiberFailure(fact: FiberScopeFact): string {
  const who = fact.plugin ?? `无主 scope（uid=${String(fact.uid)}${fact.name === '' ? '' : `, name=${fact.name}`}）`
  return `${who}: ${fact.error === '' ? `状态 ${fact.prev} → ${fact.state}` : fact.error}`
}

/** 各状态的 scope 数（报告里的观测行用）。 */
export function fiberStateCounts(facts: FiberProbeFacts): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const scope of facts.scopes) counts[scope.state] = (counts[scope.state] ?? 0) + 1
  return counts
}

// ---------------------------------------------------------------------------
// 夹具：页面与网关之间那条 mux WebSocket 上的官方转发事件（`$events`）
// ---------------------------------------------------------------------------

/**
 * 官方转发事件流在 mux 上的端点名（`dsh-api-gateway` 客户端的一个常量）。
 *
 * 这一段夹具（注入器 + 等就绪 + 帧构造）原来长在 F-43（`pendingDotSuites.ts`）里，
 * #145 的 F-47 要用同一条通道投另一种帧（`api-session/error`），所以搬进 harness——
 * 两个套件共用一份，免得两处各写一遍代理再各自漂移。
 */
const EVENT_STREAM_ENDPOINT = '$events'

export interface EventStreamInjector {
  /** 投一帧（未就绪就排队，`$events` 流就绪后按序发出）。 */
  push(frame: Record<string, unknown>): void
  /** 观测：见过几条连接、就绪几条、已投出几帧、还排着几帧、见过的端点名。 */
  stats(): { connections: number; ready: number; sent: number; queued: number; endpoints: string[] }
}

/**
 * 装官方转发事件的注入夹具（页面侧 WebSocket 代理）。
 *
 * 两件必须做对的事，都是实测撞出来的：
 * - **mux 信封**：页面那条 socket 上跑的是**多条逻辑流**，服务端写给页面的每条消息都是
 *   `{type:"item", streamId, value}`（`dsh-api-gateway` 客户端的 `parseRemoteStreamServerMessage`
 *   只认这个形状，值直接放在顶层会被判成非法帧、整条 socket 当场断掉重连）。
 * - **ready 先到页面**：客户端把 `$events` 流的**第一个**值当 ready 解析，排队中的帧抢在
 *   前面会让整条流报废。所以帧先排队，见到 `$events` 的 ready 再放。
 *
 * 另外页面**不是一条 socket**：`session/control` / `workspace/follow` / `$events` /
 * `session/follow` 各一条（实测四条），所以注入必须认准「打开过 `$events` 的那条连接
 * 与那个 streamId」，不能图省事发给最近一条。
 */
export async function installEventStreamInjector(page: Page): Promise<EventStreamInjector> {
  interface Connection {
    send(message: string): void
    ready: boolean
    queue: string[]
    /** 这条连接上 `$events` 流的 id（它自己开的那条逻辑流）。 */
    streamId?: string
  }
  const connections: Connection[] = []
  let events: Connection | undefined
  const endpointsSeen = new Set<string>()
  let sent = 0
  await page.routeWebSocket(/remote\.mux/, (socket) => {
    const upstream = socket.connectToServer()
    const endpoints = new Map<string, string>()
    const connection: Connection = {
      send: (message) => {
        socket.send(message)
      },
      ready: false,
      queue: [],
    }
    connections.push(connection)
    socket.onMessage((message) => {
      try {
        const frame = JSON.parse(String(message)) as { type?: string; streamId?: string; endpoint?: string }
        if (frame.type === 'open' && frame.streamId !== undefined && frame.endpoint !== undefined) {
          endpoints.set(frame.streamId, frame.endpoint)
          endpointsSeen.add(frame.endpoint)
          if (frame.endpoint === EVENT_STREAM_ENDPOINT) {
            connection.streamId = frame.streamId
            events = connection
          }
        }
      } catch {
        /* 客户端帧形状变了就原样转发，夹具自身不参与协议解读 */
      }
      upstream.send(message)
    })
    upstream.onMessage((message) => {
      const text = String(message)
      let frame: { type?: string; streamId?: string; value?: { type?: string } } | undefined
      try {
        frame = JSON.parse(text) as typeof frame
      } catch {
        frame = undefined
      }
      const endpoint = frame?.streamId === undefined ? undefined : endpoints.get(frame.streamId)
      if (endpoint === EVENT_STREAM_ENDPOINT && frame?.type === 'item' && frame.value?.type === 'ready' && !connection.ready) {
        socket.send(message)
        connection.ready = true
        for (const queued of connection.queue.splice(0)) {
          connection.send(queued)
          sent += 1
        }
        return
      }
      socket.send(message)
    })
  })
  return {
    push(frame) {
      const target = events
      const text = JSON.stringify({ type: 'item', streamId: target?.streamId, value: frame })
      if (target !== undefined && target.ready) {
        target.send(text)
        sent += 1
        return
      }
      target?.queue.push(text)
    },
    stats: () => ({
      connections: connections.length,
      ready: events !== undefined && events.ready ? 1 : 0,
      sent,
      queued: events?.queue.length ?? 0,
      endpoints: [...endpointsSeen],
    }),
  }
}

/** 等 `$events` 流就绪（页面的官方客户端连上网关并收到 ready 帧）。 */
export async function waitForEventStream(injector: EventStreamInjector, page: Page, timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const stats = injector.stats()
    if (stats.ready > 0 && stats.queued === 0) return true
    await page.waitForTimeout(150)
  }
  return false
}

/** 一帧官方 `$events` 流上的广播事件（会话状态推进用）。 */
export function emit(event: string, args: unknown[]): Record<string, unknown> {
  return { type: 'emit', event, args }
}
