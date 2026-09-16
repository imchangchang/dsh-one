/**
 * 浏览器验证 harness 的公共件（#78）：开页、抓控制台、查槽位、收集断言。
 *
 * 验证套件（suites.ts）只用这里的两样东西：
 * - `openTreePage`：按实验室某棵树的页面开一个干净上下文（新 localStorage、
 *   装了假宿主），等首屏就绪并静置，返回该页的控制台/报错记录；
 * - `Check`：断言收集器——一条断言一处观测，最后折成 ledger 条目。
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { fakeHostScript } from './fakeHost.ts'
import type { LabServer, LabTreeRoute } from './labServer.ts'

/** 一条断言的结论。 */
export interface Assertion {
  label: string
  ok: boolean
  detail: string
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
 * src/ui/assembly/shell/settingsFramePlugin.ts 的 root 注册注释），不是官方件噪音。
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
  /** 假宿主的状态存储初值（键 → 值；#82 的迁移/读写断言用）。 */
  state?: Record<string, unknown>
}

export interface OpenedPage {
  context: BrowserContext
  page: Page
  capture: PageCapture
  url: string
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
  await context.addInitScript({ content: fakeHostScript(options.state ?? {}) })
  return await openPageIn(lab, route, context, options)
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
): Promise<OpenedPage> {
  // 抹自有 frame 标记（#83）：两处入口都认这个开关，且必须在建页之前装——
  // 页面任何脚本执行前生效，属性才从来没进过 DOM。（假宿主由上下文持有者
  // 在 `newContext` 之后统一装，同源的后续页面自然继承，不重复装。）
  if (options.stripFrameMarkers === true) await context.addInitScript({ content: stripFrameMarkersScript() })
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
  return { context, page, capture, url, ready }
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
