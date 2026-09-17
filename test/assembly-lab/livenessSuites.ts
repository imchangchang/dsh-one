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
 * 只要出现下列任一可观测变化就算「有反应」：
 *   - DOM 里新增/移除了**有意义的元素**（脚本、样式、tooltip 这类噪音按标记滤掉）；
 *   - 弹层出现（`role=menu/listbox/dialog` 计数变化，菜单常常只是换个可见性）；
 *   - 宿主通道有新消息（能力口调用与 postMessage 计数）。
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
  withoutKnownNoise,
  type Check,
} from './harness.ts'
import { fakeHostScript } from './fakeHost.ts'
import { LAB_TREES, type LabServer, type LabTreeRoute } from './labServer.ts'
import { cookieHeader } from '../../src/server/assemblyMirror.ts'
import { listSessions } from '../../src/server/dshRpc.ts'
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
 */
export function livenessRecorderScript(): string {
  return `(() => {
  if (globalThis.__LAB_LIVENESS__ !== undefined && globalThis.__LAB_LIVENESS__.installed === true) return
  const rec = { installed: true, interesting: 0, removed: 0, added: [] }
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
      for (const node of record.addedNodes) if (meaningful(node)) note(node)
      for (const node of record.removedNodes) if (meaningful(node)) rec.removed += 1
    }
  }).observe(document, { childList: true, subtree: true })
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
}

async function livenessSnapshot(page: Page): Promise<LivenessSnapshot> {
  return page.evaluate(() => {
    const rec = (globalThis as { __LAB_LIVENESS__?: { interesting: number; removed: number; added: string[] } })
      .__LAB_LIVENESS__
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
    return {
      elements,
      mutations: (rec?.interesting ?? 0) + (rec?.removed ?? 0),
      added: rec?.added ?? [],
      popups: document.querySelectorAll('[role="menu"],[role="listbox"],[role="dialog"]').length,
      hostCalls: host?.hostCalls.length ?? -1,
      sent: semantic.length,
      sentTypes: [...new Set(semantic)].slice(-4),
    }
  })
}

/** 一次点击探测的结论。 */
export interface ClickProbe {
  label: string
  /** 选择器在页面上有没有命中**可见**的元素。 */
  present: boolean
  /** 命中的那一个是不是禁用态（禁用态本来就点不动，「只观察」那几条里有两枚就是它）。 */
  disabled: boolean
  /** 是否出现了可观测反应。 */
  reacted: boolean
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
 */
export async function probeClick(page: Page, label: string, selector: string): Promise<ClickProbe> {
  const index = await visibleIndex(page, selector)
  if (index === null) {
    return { label, present: false, disabled: false, reacted: false, detail: '元素不在场（选择器没命中可见元素）' }
  }
  const target = page.locator(selector).nth(index)
  // 先滚进视口再量：这一批交互点里有的在列表底部（底部动作条、设置项），页面被前面的
  // 操作撑高之后它的坐标会落到视口之外——`elementFromPoint` 那时返回 null，点击等于没点。
  await target.scrollIntoViewIfNeeded().catch(() => undefined)
  const box = await target.boundingBox()
  if (box === null) {
    return { label, present: false, disabled: false, reacted: false, detail: '元素不在场（拿到盒子之后又不可见）' }
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
  const reacted = elementDelta !== 0 || popupDelta !== 0 || hostDelta !== 0 || sentDelta !== 0
  // 收尾：把这一下可能开出来的弹层关掉再量下一个——不然下一个交互点的读数里会掺着
  // 上一个留下的菜单（实测过：权限那一下留着的菜单会让「模型选择」显示成「弹层 1→0」）。
  // 弹层还没关干净就再按一次（反馈这类弹窗要两次 Esc 才收）。
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  if (after.popups > before.popups) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  }
  return {
    label,
    present: true,
    disabled,
    reacted,
    detail: `元素数 ${String(before.elements)}→${String(after.elements)}（Δ${String(elementDelta)}）· 弹层 ${String(before.popups)}→${String(after.popups)} · 宿主调用 +${String(hostDelta)} · 语义上行 +${String(sentDelta)}${sentDelta === 0 ? '' : `（${after.sentTypes.join(',')}）`} · 明细：DOM 变动 ${String(mutationDelta)} 次（新增 ${after.added.slice(after.added.length - Math.max(0, mutationDelta)).join(',') || '无'}）· 禁用=${String(disabled)} · 指针落点 ${hit}`,
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

/** 一个交互点。 */
interface LivenessPoint {
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
}

const COMPOSER = '[data-slot="conversation.composer.bar"]'

/** chat 树（对话区）：官方页有全部同一批控件，逐个与官方对照。 */
const CHAT_POINTS: ReadonlyArray<LivenessPoint> = [
  {
    label: 'composer 的 ＋（添加文件或调用指令）',
    selector: `${COMPOSER} button[aria-label="添加文件或调用指令"]`,
    expect: '弹出指令候选菜单（官方 `/` 源）',
    official: `${COMPOSER} button[aria-label="添加文件或调用指令"]`,
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
    selector: `${COMPOSER} button[aria-label^="上下文已用"]`,
    expect: '弹出上下文用量详情',
    official: `${COMPOSER} button[aria-label^="上下文已用"]`,
  },
  {
    label: 'composer 的发送（空草稿）',
    selector: `${COMPOSER} button[aria-label="发送消息"]`,
    expect: '禁用态：本来就无反应',
    observeOnly:
      '空草稿时官方与我们的发送键都是禁用态，看的只是「它是禁用态」这一件事；而它的动作是**发消息**（写操作），轮不到为了覆盖去点它——万一哪天这一轮草稿不为空，点下去就是把一条消息送进真网关',
    expectDisabled: true,
  },
  {
    label: '对话区页签 · 轨迹',
    selector: '[data-slot="conversation.session.header"] [role="tab"]:has-text("轨迹")',
    expect: '切到轨迹视图（DOM 结构变）',
    official: '[data-slot="conversation.session.header"] [role="tab"]:has-text("轨迹")',
  },
  {
    label: '会话头 · 在访达中打开工作目录',
    selector: '[data-slot="conversation.session.header.utilities"] button[aria-label^="在"]',
    expect: '官方 open-in-app 的分裂按钮：点它=把工作目录交给本机文件管理器',
    official: '[data-slot="conversation.session.header.utilities"] button[aria-label^="在"]',
    observeOnly:
      '这枚是官方 `@deepseek-ai/dsh-client-ui-open-in-app` 的分裂按钮，点一下就往**真网关**发 `POST /open-in-app/open`（app + 工作目录路径），宿主侧再跑 macOS 的 `open <工作目录>`——实验室连的是用户真机上的网关，点它等于真在用户桌面上拉起一次访达（#163 的现场：每跑一轮整轮就拉一次，用户看到的是「怎么总是有个进程用 Finder 打开文件夹」）',
  },
  {
    label: '会话头 · 打开 / 收起右侧边栏',
    selector: '[data-slot="conversation.session.header.corner"] button',
    expect: '右栏开合（DOM 结构变）',
    official: '[data-slot="conversation.session.header.corner"] button',
  },
  {
    label: '对话区 · 助手动作「好的回答」',
    // 这一条**保持可点**（#163 复核过它会不会改用户状态，结论是不会）：点它的效果是开反馈
    // 弹窗（客户端行为）。已经点过赞的那条消息上，这枚按钮的 `aria-label` 是官方词典里的
    // 「取消标记」，本探针的选择器（`aria-label="好的回答"`）命中不到它，所以走不到官方那条
    // **删掉用户反馈**的路径（`retract` → `remote.messageFeedback.delete`）；悬停与点击触发的
    // `ensure()` 走的是 `remote.list`（读）。出处 `dsh-client-ui-message-feedback/lib/client.js`
    // 的 `likeLabel` 与 `choose`。
    selector: '[data-slot="conversation.chat.assistant-actions"] button[aria-label="好的回答"]',
    expect: '弹出反馈弹层',
    official: '[data-slot="conversation.chat.assistant-actions"] button[aria-label="好的回答"]',
  },
]

/** sidebar 树：这几枚是自有实现（官方页没有同形件），期望固定。 */
const SIDEBAR_POINTS: ReadonlyArray<LivenessPoint> = [
  {
    label: '侧栏 · 分组过滤胶囊',
    selector: '[data-slot="sidebar.workspaces"] button[aria-label^="按分组过滤"]',
    expect: '弹出分组过滤菜单',
  },
  { label: '侧栏 · 搜索（收起态放大镜）', selector: 'button[aria-label="搜索会话"]', expect: '展开搜索框' },
  {
    label: '侧栏 · 折叠 / 展开全部',
    selector: 'button[aria-label="折叠所有工作区"], button[aria-label="展开所有工作区"]',
    expect: '树整体收起或展开',
  },
  { label: '侧栏 · 添加工作区', selector: 'button[aria-label="添加工作区"]', expect: '弹出两项菜单' },
  { label: '侧栏 · 设置齿轮', selector: 'button[aria-label="设置"]', expect: '经宿主能力口打开设置页' },
  { label: '侧栏 · 批量选择', selector: 'button[aria-label="批量选择"]', expect: '进入多选态' },
  {
    label: '侧栏 · 回收站入口',
    selector: '[data-slot="sidebar.footer.action"] button[aria-label^="回收站"]',
    expect: '开回收站抽屉',
  },
  {
    label: '侧栏 · 清空回收站（计数 0）',
    selector: 'button[aria-label="清空回收站"]',
    expect: '禁用态：本来就无反应',
    observeOnly:
      '回收站计数为 0 时这两枚动作就是禁用态（见 F-15 / F-38），能看的只是「它是禁用态」；它的动作是**永久归档回收站里的会话**（终点动作、不可逆），一旦哪一轮夹具不为空就会真去写网关',
    expectDisabled: true,
  },
]

/** settings 树：设置页各节与通用设置里的控件（官方页这两处是弹窗，形态不同，不做对照）。 */
const SETTINGS_POINTS: ReadonlyArray<LivenessPoint> = [
  { label: '设置 · 导航到「模型服务」', selector: 'button:has-text("模型服务")', expect: '切到该节内容' },
  { label: '设置 · 导航回「通用设置」', selector: 'button:has-text("通用设置")', expect: '切回该节内容' },
  {
    label: '设置 · 权限预设下拉',
    selector: '[data-slot="settings.general.item"] button:has-text("工作区内修改")',
    expect: '弹出预设选项',
  },
  { label: '设置 · 语言下拉', selector: '[data-slot="settings.general.item"] button:has-text("中文")', expect: '弹出语言选项' },
  {
    label: '设置 · 增大字号',
    selector: 'button[aria-label="增大字号"], button[aria-label="增大字体"]',
    expect: '官方 ui-theme 的字号步进器：写用户的设置文档',
    observeOnly:
      '官方 `@deepseek-ai/dsh-client-ui-theme` 的字号步进器点一下就 `theme.setFontSize(px)` → `host.set("fontSize", px)`，也就是**经网关把新字号写进用户的设置文档**（出处 `lib/client.js` 的 setFontSize 注释「the only font-size write entry … written through the settings scope」）——哪怕这一轮它是禁用态（只记事实），它是不是禁用取决于用户当前的设置，所以整条只观察不点',
  },
  {
    label: '设置 · 打开配置文件',
    selector: '[data-slot="settings.action"] button',
    expect: '打开设置文档（官方那条经网关宿主用系统默认应用打开）',
    observeOnly:
      '`settings.action` 这个 slot 里官方那条 `open-document` 的动作是 `remote.settings.openSettingsDocument`，由**网关宿主**用系统默认应用打开 `~/.dsh/settings.yaml`（宿主侧 `dsh-api-settings-controller` → `openNativeTextFile`）；我们自己那条（`open-document-vscode`）走宿主能力口、本身没有原生副作用。两枚在同一个 slot 里、靠一条 CSS 把官方那条藏起来，藏法一旦失效探针就会点到官方的——所以这一条按整条只观察，指着这个 slot 里的控件在不在、可不可用',
  },
]

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
 * 这台网关上**服务得了**的会话候选（当作夹具用）。
 *
 * 为什么要挑：装配页默认开的是网关记着的「当前会话」，而那一条常常正被另一个 dsh
 * 进程占着写句柄（#145 的现场）——那种会话打开后只有半个界面（composer 在、会话头不在），
 * 拿它当夹具会让一批交互点「元素不在场」而空转。挑一条顶层、不在跑、非空的会话，
 * 逐条试到界面真渲染出来为止；挑不到就如实记事实（不判失败）。
 */
async function servableSessionCandidates(gateway: string): Promise<readonly string[]> {
  try {
    const rows = await listSessions(gateway)
    return rows
      .filter((row) => row.origin !== 'subagent' && row.parentSessionId === undefined && !row.running && !row.blank)
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
    '对一批交互点逐个「悬停 → 拍基线 → 点一下 → 1200 毫秒内有没有可观测变化（有意义 DOM 变化 / 弹层出现 / 宿主通道有新消息任一）」。**判据不写死**：官方页里存在的交互点与官方页本身对照（官方有反应 ⇒ 我们必须有反应），只有我们有的交互点按「必须反应」判。**另一类是「只观察、绝不点击」**：动作经真网关落到用户机器上（会话头的「在访达中打开工作目录」会在用户桌面上拉起访达）或会改用户持久状态的控件（设置页的「增大字号」「打开配置文件」，以及本来就点不动的两枚禁用态：空草稿的发送、回收站计数 0 时的清空），这一类只判「控件在场（可见、几何非零）」「期望禁用时确实是禁用态」「这一步没有派发过任何点击」，每条的不点理由写在交互点表里。composer 的 ＋ 另有一条静默判据：「点了没反应时页面必须留下能指名道姓的失败行（哪个 source 失败、什么原因）」，外加一条页面内正向对照——把官方 `commandUi` 贡献表里**不合契约（缺 `available`）**的贡献就地摘掉之后 ＋ 必须恢复；环境本身服务不了这条会话（`command directory warmup failed`，#145）时这一条只记事实。全程只读：不点发送、不点归档确认、不写任何网关数据、不在用户机器上拉起原生应用。',
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
        const probe = await probeClick(official.page, point.label, point.official)
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
        const ours = await probeClick(chatPage.page, point.label, point.selector)
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
      const addSelector = `${COMPOSER} button[aria-label="添加文件或调用指令"]`
      const addOurs = await probeClick(chatPage.page, 'composer ＋', addSelector)
      const failures = candidateFailureLines(chatPage.capture.all)
      check.fact(`＋ 的候选失败行：${JSON.stringify(failures.map((line) => line.slice(0, 200)))}`)
      check.ok('＋ 不是禁用态（点不动不是因为按钮被禁用）', addOurs.present && !addOurs.disabled, `present=${String(addOurs.present)} disabled=${String(addOurs.disabled)}`)
      check.ok(
        '＋ 没反应时，页面必定留下一行能指名道姓的失败（哪个 source 失败、什么原因）——静默失败判红',
        addOurs.reacted || failures.length > 0,
        `reacted=${String(addOurs.reacted)} 失败行 ${String(failures.length)} 条`,
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
          const afterStrip = await probeClick(stripPage, 'composer ＋（摘掉违规贡献后）', addSelector)
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
              afterStrip.detail,
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
        const ours = await probeClick(sidebarPage.page, point.label, point.selector)
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
      // 走宿主能力口。这个 slot 里到底有哪几条、官方那条是不是被自有 CSS 藏了，是这个判断的依据，
      // 所以逐条数出来写进事实（不然「藏法失效就会点到官方的」只是读代码的推断，看不出来）。
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
        const ours = await probeClick(settingsPage.page, point.label, point.selector)
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
      check.eq('[settings] 零 pageerror', withoutKnownNoise(settingsPage.capture.pageErrors).real, [])
      screenshots.push(await shot(ctx, settingsPage.page, 'liveness-03-settings'))
    } finally {
      await settingsPage.context.close()
    }

    return screenshots
  },
}
