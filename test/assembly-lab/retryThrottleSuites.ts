/**
 * 重试限流与失败日志限频套件（#229，F-68）。
 *
 * ## 现场是什么，为什么这么造
 *
 * 2026-09-22 那次「侧栏一直报错」的现场是：网关不可达约 40 秒里，页面**无退避、无上限**地
 * 重试同一个接口——页面日志里 `transport fetch …/api/commands/list failed: TypeError:
 * Failed to fetch` 那一段共 16410 行（≈280 次/秒），镜像日志里同一时刻 460 条
 * `assembly mirror: POST /api/commands/list failed: connect ECONNREFUSED`，2 MB 的宿主日志
 * 整段被同一条错误吃穿、翻转两轮，别的问题线索全被冲掉。
 *
 * 查清的调用方（#229 的排查结论）：`commands/list` 在整份官方前端里**只有一处**调用——
 * `@deepseek-ai/dsh-client-ui-commands` 的 `CommandDirectory`（`ctx.remote.commands.list`，
 * `lib/client.js:741`），我们自己的代码一处调用都没有。也就是说重试发生在**官方客户端那一层**，
 * 我们改不了它；能兜住后果的只有传输层（`ui/assembly/pageHtml.ts` 的 transportJs）。
 *
 * 所以这一套要造的现场不是「官方为什么一直重试」（那是 #226 那一路的事），而是**一个无退避重试的
 * 调用方 + 一个不可达的网关**——调用方由本套件的页内夹具扮演：一次接一次地发同一个 RPC，
 * 不等待、不间隔、每次换一个 `rpcId`（与官方 `createWebConnectionRpc` 的真实请求逐字同形：
 * `POST /api/commands/list`，body 是 `{type:"client-request", rpcId, method, payload}`）。
 * 夹具只让出一次事件循环、不加任何退避——这是「无退避重试」的最小忠实实现，也是这一套唯一
 * 「造」的地方；**请求发没发出去、发了几次、日志记了几条，全读真东西**（页面上传输层
 * `NATIVE_FETCH` 那一层的真实调用计数、宿主侧收到的 `assembly:log` 行、镜像自己打的日志行）。
 *
 * 「网关不可达」用**真的停实例**：本套件自起一台隔离实例（`freshGateway.ts`，独立临时
 * `DSH_HOME` + 随机端口 + `--no-open`），观测窗里按 PID 收掉它（页面侧于是 `Failed to fetch`、
 * 镜像侧于是 `connect ECONNREFUSED`，与现场逐字同形）；恢复那一段用**同端口同 HOME**再起一台
 * （#202 定的口径：同一份 HOME 才保得住 cookie 的签名密钥）。本套件全程不碰用户日常那台
 * （缺省 3080），也不碰本轮跑着的隔离实例（那台由 `verify.ts` 起、后面别的套件还要用）。
 *
 * ## 三组读数（对应 #229 验收的三条）
 *
 * 1. **请求量有上限**：限流档 12 秒窗口里真发出去的请求 ≤ 12 条（退避 250ms 起、翻倍、封顶 2s，
 *    理论值 ≤ 6）；负向对照（`?retryThrottle=off`）同一个夹具、同一个窗口重新变成几百条。
 * 2. **日志不刷穿**：同一原因（同一目标）在页面侧只记「第一条 + 窗口汇总行」，汇总行带
 *    「已重复 N 次」的计数；负向对照下页面侧重新变成逐条（几百行）。镜像侧那半的限频与页面侧
 *    的开关**无关**（各自一层），所以两档里镜像侧都是「几百条失败请求 → 一两条日志」。
 * 3. **恢复后照常**：同端口同 HOME 起回网关后，退避窗封顶 2 秒 ⇒ 第一次成功落在 ≤ 2.5 秒内；
 *    之后连续成功、失败不再增长；页面 `#root` 仍有内容、composer 槽位在、**另外一条**普通 RPC
 *    （`settings/describe`，不是被限流的那个目标）也通；两侧日志各补一条「恢复」收尾行。
 *
 * ## 夹具的校准（如实记下）
 *
 * 夹具每次尝试都 `setTimeout 0` 让出一次事件循环，所以它的重试速率是「事件循环能跑多快」——
 * 与现场那 280 次/秒同量级（现场那 280 次/秒受限于每次真请求 ~3.6ms）。**判据不看夹具速率**，
 * 看的是「真发出去的请求数」与「日志条数」在限流开/关两档下的差别，所以夹具快慢不影响结论。
 */
import * as path from 'node:path'
import type { Page } from 'playwright'
import { openTreePage, type OpenedPage } from './harness.ts'
import { startFreshGateway, type FreshGateway } from './freshGateway.ts'
import {
  LAB_TREES,
  RETRY_THROTTLE_OFF,
  RETRY_THROTTLE_QUERY,
  startLabServer,
  type LabServer,
  type LabTreeRoute,
} from './labServer.ts'
import type { LogSink } from '../../src/log.ts'
import type { LabSuite, SuiteContext } from './suites.ts'

const route = (name: string): LabTreeRoute => {
  const found = LAB_TREES.find((candidate) => candidate.route === name)
  if (found === undefined) throw new Error(`lab: unknown tree route ${name}`)
  return found
}

/** 被重试的那个目标（现场读到的就是它）。 */
const TARGET = '/api/commands/list'

/** 观测窗（毫秒）：一个窗口里夹几千次重试，够看出「有没有上限」。比日志汇总窗（10 秒）长，
 *  这样「第一条 + 一条带计数的汇总行」在同一个窗口里都看得到（#229 验收第 2 条要的就是这两条）。 */
const STORM_MS = 12_000

/** 恢复窗（毫秒）：网关回来之后继续重试这么久，看第一次成功落在什么时候。 */
const RECOVERY_MS = 3_000

/** 退避封顶 2 秒 ⇒ 网关回来之后最多 2 秒就该发出一次真请求；留 0.5 秒余量判「≤ 2.5 秒」。 */
const RECOVERY_BUDGET_MS = 2_500

/** 限流档的真请求条数上限：理论值 ≤ 9（12 秒窗，退避很快推到 2 秒封顶），留一点余量。 */
const THROTTLED_MAX_REQUESTS = 12

/** 限流档的日志条数上限：第一条 + 每 10 秒一条汇总行 ⇒ 12 秒窗里正好 2 条；留一条余量。 */
const THROTTLED_MAX_LOG_LINES = 3

/** 负向对照的下限：页面侧真发出去的请求至少要这么多（否则「去掉限流就重新刷屏」不成立）。 */
const UNTHROTTLED_MIN_REQUESTS = 100

/** 负向对照的日志下限：逐条记的话这十几秒里必然超过这个数（夹具每次尝试都失败）。 */
const UNTHROTTLED_MIN_LOG_LINES = 50

/**
 * 页内夹具：一个无退避重试的调用方 + 传输层真请求计数器。
 *
 * - 计数器包在 `globalThis.fetch` 上（页面任何脚本之前装）：传输脚本在启动时取
 *   `NATIVE_FETCH = globalThis.fetch.bind(globalThis)`，取到的就是这一层，于是
 *   **每一次真的发出去的请求**都被记下来（被退避压掉的、被合并的一个都不会进来）。
 * - `run(ms)` 就是那个调用方：连续发 `__DSH_TRANSPORT__.fetch(TARGET, …)`，除等它自己
 *   落定之外不加任何间隔，每次换一个 `rpcId`（与官方那一处同形）。
 */
const STORM_SCRIPT = `(() => {
  const TARGET = ${JSON.stringify(TARGET)}
  const real = globalThis.fetch.bind(globalThis)
  const sent = []
  globalThis.fetch = function (input, init) {
    let url = ''
    try { url = input && input.url ? String(input.url) : String(input) } catch (ignored) { url = '?' }
    if (url.indexOf(TARGET) !== -1) sent.push(Date.now())
    return real.apply(this, arguments)
  }
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  globalThis.__LAB_STORM__ = {
    async run(ms) {
      const started = Date.now()
      const deadline = started + ms
      let attempts = 0
      let ok = 0
      let failed = 0
      let lastError = ''
      let firstOkAt = null
      while (Date.now() < deadline) {
        attempts += 1
        try {
          const res = await globalThis.__DSH_TRANSPORT__.fetch(TARGET, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'client-request', rpcId: 'lab-storm-' + attempts, method: 'commands/list', payload: { agentId: 'lab' } }),
          })
          if (res.ok) { ok += 1; if (firstOkAt === null) firstOkAt = Date.now() }
          else { failed += 1; lastError = 'HTTP ' + res.status }
        } catch (err) {
          failed += 1
          lastError = String(err)
        }
        // 只让出一次事件循环：夹具是「尽快重试」，不加任何退避。
        await wait(0)
      }
      return {
        attempts: attempts,
        ok: ok,
        failed: failed,
        lastError: lastError,
        sentDuring: sent.filter((at) => at >= started).length,
        firstOkDelayMs: firstOkAt === null ? null : firstOkAt - started,
        windowMs: Date.now() - started,
      }
    },
  }
})()`

/** 夹具一次观测窗的读数。 */
interface StormReading {
  /** 调用方一共试了几次（含被退避压掉、没发出去的）。 */
  attempts: number
  ok: number
  failed: number
  lastError: string
  /** 本次窗口里真发出去的请求数（`NATIVE_FETCH` 那一层）。 */
  sentDuring: number
  /** 本窗口开始后多久才有第一次成功（毫秒；没成功时 null）。 */
  firstOkDelayMs: number | null
  windowMs: number
}

async function runStorm(page: Page, ms: number): Promise<StormReading> {
  return (await page.evaluate(
    (window) => (globalThis as unknown as { __LAB_STORM__: { run(ms: number): Promise<StormReading> } }).__LAB_STORM__.run(window),
    ms,
  )) as StormReading
}

/** 页面侧发给宿主的日志行（探针那条通道，真宿主里就是「DSH One」输出面板与日志文件）。 */
async function pageLogLines(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const host = (globalThis as unknown as { __LAB_HOST__?: { sent?: { type?: string; text?: unknown }[] } }).__LAB_HOST__
    return (host?.sent ?? [])
      .filter((message) => message?.type === 'assembly:log')
      .map((message) => String(message.text))
  })
}

/** 日志里提到这个目标的行。 */
const targetLines = (lines: readonly string[]): string[] => lines.filter((line) => line.includes(TARGET))

/**
 * 日志里的失败行与恢复行（措辞见 src/pure/logThrottle.ts 与 transportJs）。
 *
 * 失败在页面侧有两种形状，都要认：请求根本没拿到响应 = `transport fetch <url> failed: <err>`；
 * 镜像还在、只是上游网关没了 = 镜像回 502、页面记 `transport fetch <url> -> HTTP 502`。
 * 两种在现场都出现过（实验室这一档稳定拿到的是后者——镜像活、网关死）。
 */
const failureLines = (lines: readonly string[]): string[] =>
  lines.filter((line) => line.includes('failed') || /-> HTTP \d/.test(line))
const recoveryLines = (lines: readonly string[]): string[] => lines.filter((line) => line.includes('recovered'))

/** 「已重复 N 次」的计数行（同一原因限频的判据）。 */
const repeatLines = (lines: readonly string[]): string[] => lines.filter((line) => /same cause repeated \d+ times/.test(line))

/** 一条记录下来的镜像日志（`LogSink` 的替身）。 */
interface RecordedLine {
  level: string
  line: string
}

function recordingLogger(into: RecordedLine[]): LogSink {
  return {
    info: (line) => into.push({ level: 'info', line }),
    warn: (line) => into.push({ level: 'warn', line }),
    error: (line) => into.push({ level: 'error', line }),
  }
}

/** 一套「自己的网关 + 自己的实验室服务器 + 一页」，收尾要一起收。 */
interface Armed {
  gateway: FreshGateway
  lab: LabServer
  opened: OpenedPage
  /** 镜像日志里提到这个目标的行。 */
  mirrorTargetLines: () => string[]
  dispose: () => Promise<void>
}

/**
 * 起一台自己的隔离实例 + 一个只属于本套件的实验室服务器，然后开一页（装上夹具）。
 *
 * 为什么要自己起一套：这一套要**真的把网关停掉**（现场就是这么来的），而本轮跑着的那台隔离
 * 实例是后面所有套件的数据面，停它等于把整轮打红（#202 起就是这个口径：要停实例的套件自起一台）。
 */
async function arm(ctx: SuiteContext, query: Record<string, string>): Promise<Armed> {
  const gateway = await startFreshGateway({})
  const mirrorLines: RecordedLine[] = []
  const lab = await startLabServer({
    gateway: gateway.origin,
    token: gateway.token,
    ...(gateway.version === undefined ? {} : { version: gateway.version }),
    log: recordingLogger(mirrorLines),
    pluginsDir: ctx.lab.pluginsDir,
    port: 0,
    external: false,
  })
  const opened = await openTreePage(ctx.browser, lab, route('chat'), {
    width: 900,
    height: 700,
    settleMs: 2_500,
    initScript: STORM_SCRIPT,
    query,
  })
  return {
    gateway,
    lab,
    opened,
    mirrorTargetLines: () => mirrorLines.map((entry) => entry.line).filter((line) => line.includes(TARGET)),
    dispose: async () => {
      await opened.context.close().catch(() => undefined)
      lab.dispose()
      await gateway.dispose().catch(() => undefined)
    },
  }
}

/** 页面照常的读数（恢复那一段要看的东西）。 */
interface SurfaceReading {
  rootText: string
  composer: number
  /** 现场那条 RPC 之外，页面自己再发一次普通 RPC 的结果。 */
  probeRpc: string
}

/**
 * 恢复之后页面照常吗：`#root` 还有内容、composer 槽位还在、**另外一条**普通 RPC（不是被限流的
 * 那个目标）也通。第三条是关键——它证明限流没有变成「整页再也不发请求」。
 */
async function readSurface(page: Page): Promise<SurfaceReading> {
  return page.evaluate(async () => {
    const squeeze = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim()
    let probeRpc = ''
    try {
      const res = await (globalThis as unknown as { __DSH_TRANSPORT__: { fetch(i: string, init: RequestInit): Promise<Response> } }).__DSH_TRANSPORT__.fetch('/api/settings/describe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'lab-surface-probe', method: 'settings/describe', payload: {} }),
      })
      probeRpc = `HTTP ${String(res.status)}`
    } catch (err) {
      probeRpc = `throw ${String(err)}`
    }
    return {
      rootText: squeeze(document.getElementById('root')?.textContent).slice(0, 120),
      composer: document.querySelectorAll('[data-slot="conversation.composer.bar"]').length,
      probeRpc,
    }
  })
}

export const RETRY_THROTTLE_SUITE: LabSuite = {
  id: 'F-68',
  phase: 'new-feature',
  name: '网关不可达时的重试限流与失败日志限频：同一目标的请求有上限、同一原因的日志只记一条+计数、网关回来照常',
  expect:
    '装配页传输层的失败退避与失败日志限频（#229，实现见 src/ui/assembly/pageHtml.ts 的 transportJs 与 src/pure/logThrottle.ts）。现场由一个页内夹具造成：一个无退避重试的调用方（连续发 `POST /api/commands/list`，与官方 `createWebConnectionRpc` 的请求体同形、每次换 rpcId、不加任何间隔）撞上一台**真的被停掉的**网关。① **限流档**（缺省页面）：12 秒窗口里调用方试了几千次，但**真发出去的请求 ≤ 12 条**（退避 250ms 起、翻倍、封顶 2s）；同一原因在页面侧只记「第一条 + 一条带「已重复 N 次」计数的窗口汇总行」（≤ 3 行，改前是几千行）；镜像侧那半的限频与页面侧的开关无关，同样是一两条。② **恢复档**：同端口同 HOME 起回网关后，第一次成功落在 ≤ 2.5 秒内（退避封顶 2 秒），之后连续成功、失败不再增长；页面 `#root` 仍有内容、composer 槽位在、**另外一条**普通 RPC（settings/describe，不是被限流的那个目标）也通——证明限流没变成「卡死不再发请求」；两侧日志各补一条「恢复」收尾行。③ **负向对照**（`?retryThrottle=off`，同一个夹具、同一个窗口、同一台被停掉的网关）：页面侧真请求数 ≥ 100、失败日志各 ≥ 50 行——把限流去掉，第 ① 条那两个上限必须重新失败。',
  run: async (ctx: SuiteContext, check): Promise<string[]> => {
    const shots: string[] = []
    const shot = async (page: Page, name: string): Promise<void> => {
      const file = path.join(ctx.shots, `${name}.png`)
      await page.screenshot({ path: file })
      shots.push(file)
    }

    // ======================================================================
    // ① 限流档 + ② 恢复档（同一页、同一台实例：先停、再同端口同 HOME 起回来）
    // ======================================================================
    const throttled = await arm(ctx, {})
    let restarted: FreshGateway | undefined
    try {
      await throttled.gateway.stop()
      const during = await runStorm(throttled.opened.page, STORM_MS)
      const pageLines = targetLines(await pageLogLines(throttled.opened.page))
      const mirrorLines = throttled.mirrorTargetLines()
      const duringSeconds = during.windowMs / 1000
      check.fact(
        `限流档（${String(Math.round(duringSeconds))} 秒窗）：调用方试了 ${String(during.attempts)} 次（${(during.attempts / duringSeconds).toFixed(0)} 次/秒），真发出去 ${String(during.sentDuring)} 条（${(during.sentDuring / duringSeconds).toFixed(1)} 条/秒）；失败 ${String(during.failed)} 次，最后一次错误 ${JSON.stringify(during.lastError.slice(0, 100))}`,
      )
      check.fact(
        `限流档日志：页面侧 ${String(pageLines.length)} 行（失败行 ${String(failureLines(pageLines).length)}）、镜像侧 ${String(mirrorLines.length)} 行（失败行 ${String(failureLines(mirrorLines).length)}）；页面侧原文 ${JSON.stringify(pageLines.slice(0, 3).map((line) => line.slice(0, 200)))}`,
      )
      check.ok(
        '限流档：现场成立——夹具在这段时间里是真的在无退避重试（试了几百次以上，且确实在失败）',
        during.attempts >= 200 && during.failed >= 200,
        `attempts=${String(during.attempts)} failed=${String(during.failed)} lastError=${JSON.stringify(during.lastError.slice(0, 120))}`,
      )
      check.ok(
        `限流档：真发出去的请求数 ≤ ${String(THROTTLED_MAX_REQUESTS)}（改前同一个夹具是每秒几百条；退避 250ms 起、封顶 2s）`,
        during.sentDuring <= THROTTLED_MAX_REQUESTS,
        `sent=${String(during.sentDuring)}（${(during.sentDuring / duringSeconds).toFixed(1)} 条/秒）；夹具共试 ${String(during.attempts)} 次`,
      )
      check.ok(
        `限流档：页面侧同一原因只记「第一条 + 窗口汇总行」（≤ ${String(THROTTLED_MAX_LOG_LINES)} 行，且确实记了失败）`,
        pageLines.length <= THROTTLED_MAX_LOG_LINES && failureLines(pageLines).length >= 1,
        `页面侧 ${String(pageLines.length)} 行；失败行 ${String(failureLines(pageLines).length)} 条`,
      )
      check.ok(
        '限流档：被压掉的重复次数有账——页面侧至少一条带「已重复 N 次」的汇总行',
        repeatLines(pageLines).length >= 1,
        `带计数的行 ${String(repeatLines(pageLines).length)} 条：${JSON.stringify(repeatLines(pageLines).slice(0, 2).map((line) => line.slice(0, 200)))}`,
      )
      check.ok(
        `限流档：镜像侧同一原因同样只记一两条（≤ ${String(THROTTLED_MAX_LOG_LINES)} 行）`,
        mirrorLines.length <= THROTTLED_MAX_LOG_LINES && failureLines(mirrorLines).length >= 1,
        `镜像侧 ${String(mirrorLines.length)} 行；例如 ${JSON.stringify(mirrorLines.slice(0, 2).map((line) => line.slice(0, 160)))}`,
      )
      await shot(throttled.opened.page, 'f-68-1-throttled-during-outage')

      // ------------------------------------------------------------------
      // ② 恢复档：同端口同 HOME 起回网关 → 退避窗封顶 2 秒 ⇒ 很快通，页面照常
      // ------------------------------------------------------------------
      restarted = await startFreshGateway({ port: Number(new URL(throttled.gateway.origin).port), home: throttled.gateway.home })
      const recovery = await runStorm(throttled.opened.page, RECOVERY_MS)
      const surface = await readSurface(throttled.opened.page)
      const recoveryPageLines = targetLines(await pageLogLines(throttled.opened.page))
      const recoveryMirrorLines = throttled.mirrorTargetLines()
      check.fact(
        `恢复档：网关回来后 ${String(Math.round(recovery.windowMs / 1000))} 秒窗里调用方试 ${String(recovery.attempts)} 次、成功 ${String(recovery.ok)} 次、失败 ${String(recovery.failed)} 次；第一次成功距「网关回来」约 ${String(recovery.firstOkDelayMs)} 毫秒`,
      )
      check.ok(
        `恢复档：网关回来之后 ≤ ${String(RECOVERY_BUDGET_MS)} 毫秒内就有一次成功（退避封顶 2 秒，不会卡住不重试）`,
        recovery.ok >= 1 && (recovery.firstOkDelayMs ?? Number.POSITIVE_INFINITY) <= RECOVERY_BUDGET_MS,
        `ok=${String(recovery.ok)} 第一次成功约 ${String(recovery.firstOkDelayMs)} 毫秒后、失败 ${String(recovery.failed)} 次`,
      )
      check.ok(
        '恢复档：之后连续成功（窗口里成功数远超失败数，退避已清零）',
        recovery.ok >= 2 && recovery.ok > recovery.failed,
        `ok=${String(recovery.ok)} failed=${String(recovery.failed)}`,
      )
      check.ok(
        '恢复档：页面照常——`#root` 仍有内容、composer 槽位还在、另一条普通 RPC（settings/describe）也通',
        surface.rootText.length > 0 && surface.composer > 0 && surface.probeRpc === 'HTTP 200',
        `#root=${JSON.stringify(surface.rootText)} composer=${String(surface.composer)} probeRpc=${JSON.stringify(surface.probeRpc)}`,
      )
      check.ok(
        '恢复档：页面侧日志补了一条「恢复」收尾行（同一原因结清，不再只报坏不报好）',
        recoveryLines(recoveryPageLines).length >= 1,
        `页面侧恢复行 ${String(recoveryLines(recoveryPageLines).length)} 条；例如 ${JSON.stringify(recoveryLines(recoveryPageLines).slice(0, 1).map((line) => line.slice(0, 200)))}`,
      )
      check.ok(
        '恢复档：镜像侧日志也补了一条「恢复」收尾行（网关回来之后转发成功的第一次）',
        recoveryLines(recoveryMirrorLines).length >= 1,
        `镜像侧恢复行 ${String(recoveryLines(recoveryMirrorLines).length)} 条；例如 ${JSON.stringify(recoveryLines(recoveryMirrorLines).slice(0, 1).map((line) => line.slice(0, 160)))}`,
      )
      await shot(throttled.opened.page, 'f-68-2-recovered')
    } finally {
      if (restarted !== undefined) await restarted.dispose().catch(() => undefined)
      await throttled.dispose()
    }

    // ======================================================================
    // ③ 负向对照：同一个夹具、同一个窗口、同一台被停掉的网关，只是把限流去掉
    // ======================================================================
    const unthrottled = await arm(ctx, { [RETRY_THROTTLE_QUERY]: RETRY_THROTTLE_OFF })
    try {
      await unthrottled.gateway.stop()
      const reading = await runStorm(unthrottled.opened.page, STORM_MS)
      const pageLines = targetLines(await pageLogLines(unthrottled.opened.page))
      const mirrorLines = unthrottled.mirrorTargetLines()
      const seconds = reading.windowMs / 1000
      check.fact(
        `负向对照（\`?retryThrottle=off\`）：调用方试 ${String(reading.attempts)} 次、真发出去 ${String(reading.sentDuring)} 条（${(reading.sentDuring / seconds).toFixed(0)} 条/秒）；页面侧日志 ${String(pageLines.length)} 行（失败 ${String(failureLines(pageLines).length)}）、镜像侧 ${String(mirrorLines.length)} 行（失败 ${String(failureLines(mirrorLines).length)}）`,
      )
      check.ok(
        `负向对照：页面侧真请求数重新变成几百条（≥ ${String(UNTHROTTLED_MIN_REQUESTS)}）——第 ① 条那个上限因此失败`,
        reading.sentDuring >= UNTHROTTLED_MIN_REQUESTS,
        `sent=${String(reading.sentDuring)}（限流档是 ≤ ${String(THROTTLED_MAX_REQUESTS)}）attempts=${String(reading.attempts)}`,
      )
      check.ok(
        `负向对照：页面侧失败日志重新变成逐条（≥ ${String(UNTHROTTLED_MIN_LOG_LINES)} 行）——第 ① 条那个日志上限因此失败`,
        failureLines(pageLines).length >= UNTHROTTLED_MIN_LOG_LINES,
        `页面侧失败行 ${String(failureLines(pageLines).length)} 条（限流档是 ≤ ${String(THROTTLED_MAX_LOG_LINES)}）`,
      )
      check.ok(
        '负向对照：页面侧不再有「已重复 N 次」的汇总行（计数行确实来自限流那套，不是本来就有的）',
        repeatLines(pageLines).length === 0,
        `页面侧计数行 ${String(repeatLines(pageLines).length)} 条`,
      )
      check.ok(
        `负向对照：几百条失败请求转发进镜像，镜像侧日志仍是「一两条」（≤ ${String(THROTTLED_MAX_LOG_LINES)} 行）——镜像那半的限频与页面侧这个开关无关，是各自独立的一层`,
        mirrorLines.length >= 1 && mirrorLines.length <= THROTTLED_MAX_LOG_LINES,
        `镜像侧 ${String(mirrorLines.length)} 行；例如 ${JSON.stringify(mirrorLines.slice(0, 1).map((line) => line.slice(0, 160)))}`,
      )
      check.fact(`负向对照页面侧日志样例：${JSON.stringify(pageLines.slice(0, 2).map((line) => line.slice(0, 160)))}`)
      await shot(unthrottled.opened.page, 'f-68-3-unthrottled-negative-control')
    } finally {
      await unthrottled.dispose()
    }

    return shots
  },
}
