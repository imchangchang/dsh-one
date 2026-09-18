/**
 * 装配失败提示条套件（#201）：**装配失败时页面上必须有一行看得见的说明加一个重载入口，
 * 不许整页白**。
 *
 * 判据落在用户看到的东西上，分三层：
 * 1. **现场是真的**——注入一次真装配失败之后，`#root` 里一个可见的盒都不剩（这就是用户
 *    报的那一态：整页白、此后新内容一条不出来）；
 * 2. **页面上有提示**——那一刻出现一类提示条（自有标记 `[data-dshone-page-failure]`），
 *    它**真的在用户眼前**（可见盒非零、视口顶部那一点 `elementFromPoint` 落在它里面），
 *    一行说明 + 原始错误文本 + 一个 `[data-dshone-page-reload]` 重载入口；
 * 3. **原始错误没被吞**——那条 `SlotAssemblyError` 照旧在页面控制台/未捕获错误里
 *    （提示条只是把用户看得见的那一层补上，不拦日志），并且提示条把错误原文摆到用户眼前。
 *
 * 再往下两条：点重载入口必须真的把这一页救回来（整页重载 → 装配重新跑起来 → 内容回来、
 * 提示条消失）；救回来之后**静置一段零提示条**——这一条是「不误报」的常驻把关，免得
 * 这个机制在页面上乱喊。
 *
 * ## 「改前是空白」怎么钉在这份套件里
 *
 * 改前（页面运行时没有提示条）与改后的差别是**行为**差别，套件跑的是改后那份代码，
 * 钉不出「改前」那一读数（同 #202 的口径）。所以改前那一读数在这里换个角度钉死：
 * 注入之后先断言**页面确实空了**（`#root` 零可见盒）——那一态就是用户看到的整页白，
 * 改前的页面从此刻起一直停在它上面；提示条出现的位置正落在它之后。改前/改后各跑一次
 * 的实测读数（红/绿与两张截图）写在 #201 的汇报里。
 *
 * ## 注入的是什么（可注入的失败现场）
 *
 * 走官方 root 槽位的**公开提供点** `ctx.slots.provideRoot`（`@deepseek-ai/
 * dsh-client-ui-renderer/lib/client.js` 里 `SlotRegistry.provideRoot`）：给 root 绑定
 * 声明一个**没有源**的 strict 钩子，渲染器物化 root 绑定时抛
 * `SlotAssemblyError: strict standard hook '…' has no source`（同文件
 * `materializeStandardBinding`）。选它的理由：
 *
 * - 它和 alpha.2 那条（`scope 'session-maybe' rendered without an installed adapter`）
 *   **同一类、同一条路径**：渲染器自己抛的 `SlotAssemblyError`，官方 entry 边界
 *   **故意**不兜（`getDerivedStateFromError` 里 `instanceof SlotAssemblyError` 就重抛），
 *   一路穿到 React root → 整棵树被卸掉；
 * - 它是**运行时**注入的（页面挂起来之后再声明），所以走的是「挂载之后出装配错」这条
 *   路——启动期的装配错官方自己有失败卡片（`Failed to load plugins`），不是本条的现场；
 * - 它只碰公开 API，不写官方内部字段：页面侧那一句就是 `provideRoot({hooks:{…}})`，
 *   注入点由 fiber 探针留下的 `ctx` 提供（见 harness.ts 的 `fiberProbeScript`）。
 *
 * 这条路依赖官方 `provideRoot` 的钩子源契约（形如「声明的 strict 钩子必须有源」），
 * 与上游探针盯的客户端契约面同类；真变了的话这里的注入会当场失效 → 第 1 层断言直接红
 * （不静默）。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import type { Page } from 'playwright'
import { openTreePage, type OpenedPage } from './harness.ts'
import { LAB_TREES, type LabTreeRoute } from './labServer.ts'
import { PAGE_FAILURE_MARK, PAGE_FAILURE_TEXT, PAGE_RELOAD_MARK } from '../../src/ui/assembly/failureNotice.ts'
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

/** 提示条那几条文案的 zh / en 两份（期望值只从词典来，不写死中文——同 #208）。 */
const bothLangs = (key: string): string[] => [PAGE_FAILURE_TEXT.zh[key], PAGE_FAILURE_TEXT.en[key]]

const NOTICE = `[${PAGE_FAILURE_MARK}]`
const RELOAD = `[${PAGE_RELOAD_MARK}]`

/** 注入用的那个钩子名（它出现在官方抛的那句错误里，判据按它认「原始错误」）。 */
const MISSING_HOOK = 'labAssemblyFailureProbe'

/** `#root` 上的正文（压缩空白、截断）：红的轮次里一眼看出那一刻页面上是什么。 */
async function rootDigest(page: Page): Promise<string> {
  return page.evaluate(() => {
    const text = document.getElementById('root')?.textContent ?? ''
    return text.replace(/\s+/g, ' ').trim().slice(0, 160)
  })
}

/** 页面上的读数（一次 evaluate 取全，判据只认用户看得见的东西）。 */
interface FailureReading {
  /** `#root` 的子元素数。 */
  rootChildren: number
  /** `#root` 里有没有可见的盒（宽高都 > 0）。 */
  rootVisible: boolean
  /** 提示条几枚。 */
  notice: number
  /** 提示条自己的提示值（`assembly` / `blank`）。 */
  noticeKind: string | null
  /** 提示条的可见盒（宽高）与文字两行 + 重载入口文字。 */
  noticeBox: { width: number; height: number } | null
  noticeTitle: string | null
  noticeReason: string | null
  reloadLabel: string | null
  /**
   * 视口顶部中间那一点（用户一眼看过去的位置）落在提示条里吗——「提示行真的在眼前」
   * 的判据，光在 DOM 里不算。
   */
  noticeAtTop: boolean
}

async function readFailure(page: Page): Promise<FailureReading> {
  return page.evaluate(
    ({ noticeSelector, reloadSelector, mark }) => {
      const squeeze = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim()
      const root = document.getElementById('root')
      const nodes = root === null ? [] : Array.from(root.querySelectorAll('*'))
      const rootVisible = nodes.some((node) => {
        const box = node.getBoundingClientRect()
        return box.width > 0 && box.height > 0
      })
      const bar = document.querySelector(noticeSelector)
      const box = bar === null ? null : bar.getBoundingClientRect()
      const top = document.elementFromPoint(Math.round(window.innerWidth / 2), 12)
      return {
        rootChildren: root === null ? -1 : root.childElementCount,
        rootVisible,
        notice: document.querySelectorAll(noticeSelector).length,
        noticeKind: bar === null ? null : bar.getAttribute(mark),
        noticeBox: box === null ? null : { width: box.width, height: box.height },
        noticeTitle: bar === null ? null : squeeze(bar.querySelector('[data-dshone-page-failure-title]')?.textContent),
        noticeReason: bar === null ? null : squeeze(bar.querySelector('[data-dshone-page-failure-reason]')?.textContent),
        reloadLabel: bar === null ? null : squeeze(bar.querySelector(reloadSelector)?.textContent),
        noticeAtTop: bar !== null && top !== null && (bar.contains(top) || top === bar),
      }
    },
    { noticeSelector: NOTICE, reloadSelector: RELOAD, mark: PAGE_FAILURE_MARK },
  )
}

/** 等某一刻的读数满足条件（超时返回最后一次读数）。 */
async function waitForReading(
  page: Page,
  predicate: (reading: FailureReading) => boolean,
  timeoutMs: number,
): Promise<FailureReading> {
  const deadline = Date.now() + timeoutMs
  let reading = await readFailure(page)
  while (!predicate(reading) && Date.now() < deadline) {
    await page.waitForTimeout(100)
    reading = await readFailure(page)
  }
  return reading
}

/**
 * 注入一次真装配失败（见文件头）：经 fiber 探针留下的 `ctx` 调官方 `provideRoot`，
 * 声明一个没有源的 strict 钩子。返回值是注入那一刻的事实（进报告），不参与判定。
 *
 * 服务怎么取：**不能用 `ctx.slots`**——探针拿到的那个 ctx 没声明过 `inject`，cordis
 * 的代理当场抛 `cannot get property "slots" without inject`（实测，见 #201 汇报）。
 * 走 cordis 自己的反射口 `ctx.reflect.get(name)`（ReflectService 的公开方法，
 * `@deepseek-ai/cordis` 的 `lib/index.js`），它按隔离键直接解析已注册的服务。
 * 包在 try 里：注入点没到位时要留下人话，而不是让整条套件崩在 evaluate 上。
 */
async function injectAssemblyFailure(page: Page): Promise<string> {
  return page.evaluate((hookName: string) => {
    const record = (globalThis as { __LAB_FIBER__?: { ctx?: unknown } }).__LAB_FIBER__
    const ctx = record?.ctx as { reflect?: { get?: (name: string) => unknown } } | undefined
    if (ctx === undefined) return '这个页面没给套件留下 ctx（fiber 探针没接上）'
    let slots: { provideRoot?: (value: unknown) => unknown } | undefined
    try {
      slots = ctx.reflect?.get?.('slots') as { provideRoot?: (value: unknown) => unknown } | undefined
    } catch (error) {
      return `反射取 slots 抛了：${error instanceof Error ? error.message : String(error)}`
    }
    if (slots === undefined || typeof slots.provideRoot !== 'function') return '反射取到的 slots 上没有 provideRoot'
    try {
      slots.provideRoot({ hooks: { [hookName]: undefined } })
      return 'provideRoot 收下了一个没有源的 strict 钩子'
    } catch (error) {
      return `provideRoot 抛了：${error instanceof Error ? error.message : String(error)}`
    }
  }, MISSING_HOOK)
}

export const ASSEMBLY_FAILURE_SUITE: LabSuite = {
  id: 'F-63',
  phase: 'new-feature',
  name: '装配失败提示条（页面上有说明与重载入口，不整页白）',
  expect:
    '注入一次装配失败后：页面确实空了（用户那一态）；页面上出现一行说明 + 错误原文 + 重载入口，且真的在视口里；' +
    '原始 SlotAssemblyError 照旧在控制台；点重载入口整页救回来；救回来之后静置零提示条（不误报）',
  async run(ctx: SuiteContext, check): Promise<string[]> {
    const chat = route('chat')
    const opened: OpenedPage = await openTreePage(ctx.browser, ctx.lab, chat, { fiberProbe: true })
    const page = opened.page
    const shots: string[] = []

    // 第 0 层：这一页本来好着（否则后面「变空」不是这次注入造成的）。
    const before = await readFailure(page)
    check.ok(
      '注入前：chat 树首屏起来了、提示条零枚',
      opened.ready && before.rootVisible && before.notice === 0,
      `ready=${String(opened.ready)} rootVisible=${String(before.rootVisible)} notice=${String(before.notice)} rootChildren=${String(before.rootChildren)}`,
    )
    check.fact(`注入前 #root 正文：${await rootDigest(page)}`)
    shots.push(await shot(ctx, page, 'f-63-1-before'))

    // 第 1 层：注入之后页面真的空了——用户看到的那一态（改前就停在这里）。
    const injected = await injectAssemblyFailure(page)
    check.fact(`注入：${injected}`)
    const blank = await waitForReading(page, (reading) => !reading.rootVisible, 8_000)
    check.ok(
      '注入之后 #root 里一个可见的盒都不剩（整页白那一态复现出来了）',
      !blank.rootVisible,
      `rootVisible=${String(blank.rootVisible)} rootChildren=${String(blank.rootChildren)}`,
    )
    check.fact(`注入后 #root 正文：${await rootDigest(page)}`)
    shots.push(await shot(ctx, page, 'f-63-2-blank'))

    // 第 2 层：提示条出现，且在用户眼前。
    const shown = await waitForReading(page, (reading) => reading.notice > 0, 8_000)
    check.eq('页面上出了提示条（一枚）', shown.notice, 1)
    check.eq('提示条带自己的种类标记（捕获到错误 = assembly）', shown.noticeKind, 'assembly')
    check.ok(
      '提示条有非零可见盒（不是隐藏节点）',
      shown.noticeBox !== null && shown.noticeBox.width > 0 && shown.noticeBox.height > 0,
      JSON.stringify(shown.noticeBox),
    )
    check.ok('视口顶部那一点落在提示条里（真的在眼前，不只是进了 DOM）', shown.noticeAtTop, `atTop=${String(shown.noticeAtTop)}`)
    check.ok(
      '说明那一行是词典里的装配失败那一条（zh/en 任一份）',
      bothLangs('failedTitle').includes(shown.noticeTitle ?? '\u0000'),
      `actual=${JSON.stringify(shown.noticeTitle)} expected=${JSON.stringify(bothLangs('failedTitle'))}`,
    )
    check.ok(
      '提示条把原始错误摆到用户眼前（含官方那句 strict hook 无源）',
      (shown.noticeReason ?? '').includes(MISSING_HOOK),
      `reason=${JSON.stringify(shown.noticeReason)}`,
    )
    check.ok(
      '重载入口在（词典里的那一条，zh/en 任一份）',
      bothLangs('reload').includes(shown.reloadLabel ?? '\u0000'),
      `actual=${JSON.stringify(shown.reloadLabel)}`,
    )
    // 原始错误没被吞：它照旧在控制台/未捕获错误里（提示条只补用户看得见的那一层）。
    const consoleLines = opened.capture.all.filter((line) => line.includes(MISSING_HOOK))
    check.ok(
      '原始 SlotAssemblyError 照旧可观测（控制台或未捕获错误里有它）',
      consoleLines.length > 0,
      `命中 ${String(consoleLines.length)} 行，例如 ${JSON.stringify(consoleLines[0] ?? '')}`,
    )
    check.fact(`页面报错通道：consoleErrors+pageErrors 命中 ${String(opened.capture.consoleErrors.concat(opened.capture.pageErrors).filter((line) => line.includes(MISSING_HOOK)).length)} 行`)
    shots.push(await shot(ctx, page, 'f-63-3-notice'))

    // 第 3 层：点重载入口，整页真的救回来（装配重新跑起来、内容回来、提示条消失）。
    // 没有重载入口可点时不静默跳过：#193 的口径是「条件包住的断言要留一条事实」。
    let reloadReady = false
    if (shown.reloadLabel !== null) {
      await page.click(RELOAD)
      try {
        await page.waitForLoadState('domcontentloaded', { timeout: 20_000 })
        await page.waitForSelector(chat.readySelector, { timeout: 40_000 })
        reloadReady = true
      } catch {
        reloadReady = false
      }
      const after = await waitForReading(page, (reading) => reading.rootVisible && reading.notice === 0, 5_000)
      check.ok('点重载入口之后整页重载了一遍（首屏就绪选择器又出现）', reloadReady, `ready=${String(reloadReady)}`)
      check.ok(
        '重载之后内容回来了、提示条没了',
        after.rootVisible && after.notice === 0,
        `rootVisible=${String(after.rootVisible)} notice=${String(after.notice)}`,
      )
    } else {
      check.fact('页面上没有重载入口，重载那一段没跑（这正是改前的样子：整页白、无处可点）')
    }
    shots.push(await shot(ctx, page, 'f-63-4-after-reload'))

    // 第 4 层：不误报——页面静置一段，零提示条。
    await page.waitForTimeout(2_500)
    const quiet = await readFailure(page)
    check.ok(
      '静置之后：页面上有内容、提示条零枚（这一条防「乱喊」）',
      quiet.notice === 0 && quiet.rootVisible,
      `notice=${String(quiet.notice)} rootVisible=${String(quiet.rootVisible)}`,
    )

    await opened.context.close()
    return shots
  },
}
