/**
 * 装配页传输层的失败退避与失败日志限频的**确定性**判据（#229）。
 *
 * 浏览器实验室里那套（F-68）验的是「真页面上真的限住了」，这里把同一段内联脚本放进最小沙箱里
 * 逐条走它的分支——那些分支在真页面上要么造不出来、要么代价太大（要等真实的秒级窗口）：
 *
 * - **负向对照**：同一驱动、同一串事件，`retryThrottle: false` 时真请求数必须**逐次**（改前
 *   就是这个数），限流装上之后必须塌下来——两条断言落在同一份读数上，改前的数字是「实测」；
 * - **时间窗汇总行**：真页面上要等 10 秒才看得到第二条，这里用假钟瞬间推过去，断言措辞
 *   （`same cause repeated N times`）与计数都对；
 * - **5xx 也进退避**：网关不可达时镜像回的是 502，真页面上要让镜像在同一个窗口里回 502
 *   不太好造，这里直接让它回；
 * - **同一请求合并 / 不同请求不合并**：这一条要卡住「请求在飞」的那一刻，页面上做不稳；
 * - **两半实现一致**：`pure/logThrottle.ts` 的 Node 实现与塞进页面的那份 JS 实现跑同一串事件，
 *   逐行比对输出（谁改了不跟另一半说就红）。
 *
 * 跑法：`transportJs(...)` 的产物丢进 `node:vm`（页面里它是内联 `<script>`，全局就是它的作用域），
 * 外面给 `location` / `document` / `fetch` / `Date`（假钟）/ `Response` / 探针一套替身。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as vm from 'node:vm'
import { transportJs } from '../src/ui/assembly/pageHtml.ts'
import { createFailureLog, failureLogJs, FAILURE_LOG_WINDOW_MS } from '../src/pure/logThrottle.ts'

const MIRROR = 'http://127.0.0.1:9500'
const PAGE = `${MIRROR}/chat`
const TARGET = '/api/commands/list'
const FAILED = 'TypeError: Failed to fetch'

/** 沙箱里那一页的替身（真请求一次不落地，全走假 fetch）。 */
interface Harness {
  /** 调用方视角的一次尝试：`__DSH_TRANSPORT__.fetch`，与官方客户端那条路同一个入口。 */
  attempt(body?: string): Promise<{ ok: boolean; status: number; error?: string }>
  /** 真发出去的请求（NATIVE_FETCH 那一层）的耗时读数。 */
  sent: number[]
  /** 探针收到的日志行（真宿主里就是输出面板与日志文件里那些行）。 */
  logs: string[]
  /** 推进假钟（毫秒）。 */
  advance(ms: number): void
  /** 让假 fetch 从现在起好好回执（网关回来了）。 */
  heal(): void
  /** 让假 fetch 从现在起回 5xx（镜像顶不住时那条路）。 */
  break503(): void
  /** 让假 fetch 从现在起回一个 4xx（应用自己的答复——不是「目标不可达」）。 */
  break4xx(): void
  /** 假 fetch 挂住不落定；返回放行函数（造「请求在飞」那一刻）。 */
  hang(): () => void
}

interface HarnessOptions {
  /** 传输层装不装重试限流（与 `AssemblyPageOptions.retryThrottle` 同一处开关）。 */
  retryThrottle?: boolean
}

function makeHarness(options: HarnessOptions = {}): Harness {
  const clock = { now: 1_000 }
  const sent: number[] = []
  const logs: string[] = []
  /** 假 fetch 的行为（可变：`hang` 那一档要卡住「请求在飞」的那一刻）。 */
  const behaviour: {
    kind: 'fail' | 'ok' | 'status' | 'hang'
    status: number
    waiters: (() => void)[]
  } = { kind: 'fail', status: 200, waiters: [] }
  const sandbox: Record<string, unknown> = {
    URL,
    Map,
    Promise,
    Response,
    setTimeout,
    console,
    JSON,
    String,
    Number,
    Math,
    Error,
    TypeError,
    Array,
    Object,
    Date: { now: () => clock.now },
    location: { href: PAGE, origin: MIRROR, protocol: 'http:', host: '127.0.0.1:9500' },
    document: { baseURI: PAGE },
    __DSH_ONE_PROBE__: { log: (_level: string, text: string) => logs.push(text) },
    fetch: (input: unknown, init: RequestInit | undefined) => {
      const url = String(input)
      sent.push(clock.now)
      if (behaviour.kind === 'hang') {
        return new Promise((resolve) => {
          behaviour.waiters.push(() => resolve({ ok: true, status: 200, url, init }))
        })
      }
      if (behaviour.kind === 'fail') return Promise.reject(new TypeError('Failed to fetch'))
      if (behaviour.kind === 'status') return Promise.resolve({ ok: false, status: behaviour.status, url })
      return Promise.resolve({ ok: true, status: 200, url, init })
    },
  }
  const context = vm.createContext(sandbox)
  vm.runInContext(transportJs(MIRROR, [], options.retryThrottle !== false), context, { filename: 'transport.js' })
  const transport = sandbox.__DSH_TRANSPORT__ as {
    fetch(input: string, init: RequestInit): Promise<{ ok: boolean; status: number }>
  }
  assert.equal(typeof transport.fetch, 'function', '传输脚本没装上 __DSH_TRANSPORT__.fetch')
  return {
    sent,
    logs,
    advance: (ms) => {
      clock.now += ms
    },
    heal: () => {
      behaviour.kind = 'ok'
    },
    break503: () => {
      behaviour.kind = 'status'
      behaviour.status = 503
    },
    break4xx: () => {
      behaviour.kind = 'status'
      behaviour.status = 404
    },
    hang: () => {
      behaviour.kind = 'hang'
      return () => {
        behaviour.kind = 'ok'
        behaviour.waiters.splice(0).forEach((release) => {
          release()
        })
      }
    },
    attempt: async (body = '{"rpcId":"1"}') => {
      try {
        const res = await transport.fetch(TARGET, { method: 'POST', body })
        return { ok: res.ok === true, status: Number(res.status) }
      } catch (err) {
        return { ok: false, status: 0, error: String(err) }
      }
    },
  }
}

/** 失败的请求体（rpcId 每次换，与官方 `createWebConnectionRpc` 同形）。 */
const bodyOf = (n: number): string => `{"type":"client-request","rpcId":"t-${String(n)}","method":"commands/list"}`

test('负向对照：不装限流时，每次尝试都真发出去、每次失败都记一行（改前的样子）', async () => {
  const h = makeHarness({ retryThrottle: false })
  for (let i = 0; i < 200; i++) {
    h.advance(5)
    const res = await h.attempt(bodyOf(i))
    assert.equal(res.ok, false)
    assert.equal(res.error, FAILED)
  }
  assert.equal(h.sent.length, 200, '不装限流时真请求数必须等于尝试次数')
  assert.equal(h.logs.filter((line) => line.includes('failed')).length, 200, '不装限流时每次失败都记一行')
  assert.equal(h.logs.filter((line) => line.includes('same cause repeated')).length, 0)
})

test('装了限流：同一目标失败期间真请求数塌下来，同一原因的日志只记「第一条 + 窗口汇总行」', async () => {
  const attempts = 3_000
  const h = makeHarness()
  for (let i = 0; i < attempts; i++) {
    // 每次尝试推进 5 毫秒：3000 次 = 15 秒，正好横跨两个 10 秒的日志窗。
    h.advance(5)
    const res = await h.attempt(bodyOf(i))
    assert.equal(res.ok, false, '冷却期内的尝试拿到的还是失败')
    assert.equal(res.error, FAILED, '冷却期内回的是上一次同样的失败')
  }
  const seconds = (attempts * 5) / 1000
  assert.ok(
    h.sent.length <= 20,
    `真请求数必须塌下来（实测 ${String(h.sent.length)} 条 / ${String(seconds)} 秒，改前是 ${String(attempts)} 条）`,
  )
  assert.ok(h.sent.length >= 4, `但也不能是「再也不重试」（实测只有 ${String(h.sent.length)} 条真请求）`)
  const failures = h.logs.filter((line) => line.includes('failed'))
  assert.ok(failures.length >= 2, `跨了两个日志窗就该有第一条 + 汇总行（实测 ${String(failures.length)} 行）`)
  assert.ok(failures.length <= 4, `日志条数必须有上限（实测 ${String(failures.length)} 行 / ${String(seconds)} 秒）`)
  assert.equal(failures[0], `transport fetch ${MIRROR}${TARGET} failed: ${FAILED}`, '第一条照原样记')
  const repeats = h.logs.filter((line) => line.includes('same cause repeated'))
  assert.ok(repeats.length >= 1, `汇总行必须带「同一原因已重复 N 次」的计数（实测 ${JSON.stringify(h.logs)}）`)
  const counted = /same cause repeated (\d+) times/.exec(repeats[0] ?? '')
  assert.ok(counted !== null && Number(counted[1]) > 100, `计数要如实（读到 ${repeats[0] ?? '（空）'}）`)
})

test('网关回来之后：退避不再挡路，下一次尝试就成功，并补一条「恢复」收尾行', async () => {
  const h = makeHarness()
  // 先失败几十次，把退避推到封顶。
  for (let i = 0; i < 400; i++) {
    h.advance(5)
    await h.attempt(bodyOf(i))
  }
  const sentBefore = h.sent.length
  h.heal()
  // 退避封顶 2 秒 ⇒ 最多推进 2 秒就会发出一次真请求并成功。
  h.advance(2_000)
  const recovered = await h.attempt(bodyOf(999))
  assert.equal(recovered.ok, true, '网关回来之后必须能通（不许因为限流卡死）')
  assert.equal(h.sent.length, sentBefore + 1, '那一次是**真发出去**的，不是冷却期内的假失败')
  const recoveryLines = h.logs.filter((line) => line.includes('recovered'))
  assert.equal(recoveryLines.length, 1, `恢复必须补一条收尾行（实测 ${JSON.stringify(recoveryLines)}）`)
  assert.ok(
    /recovered after (\d+) repeats/.test(recoveryLines[0] ?? ''),
    `恢复行要带上之前重复了几次（读到 ${recoveryLines[0] ?? '（空）'}）`,
  )
  // 成功之后退避清零：紧接着的尝试立刻再发一次。
  const after = await h.attempt(bodyOf(1_000))
  assert.equal(after.ok, true)
  assert.equal(h.sent.length, sentBefore + 2, '恢复之后不再有冷却窗')
})

test('5xx 也进退避：镜像顶不住时回的 502 同样按目标限频，冷却期内回同样的状态码', async () => {
  const h = makeHarness()
  h.break503()
  const first = await h.attempt(bodyOf(0))
  assert.equal(first.status, 503, '第一次是那一条真请求拿到的 503')
  assert.equal(h.sent.length, 1)
  // 冷却窗内连试 50 次：一次都不该发出去，但拿到的还是「上一次同样的失败」。
  for (let i = 1; i <= 50; i++) {
    h.advance(1)
    const res = await h.attempt(bodyOf(i))
    assert.equal(res.ok, false)
    assert.equal(res.status, 503, '冷却期内回的是上一次同样的 5xx')
  }
  assert.equal(h.sent.length, 1, '退避窗内一次请求都不许发出去')
  assert.ok(
    h.logs.filter((line) => line.includes('HTTP 503')).length <= 2,
    `5xx 的日志同样限频（实测 ${JSON.stringify(h.logs)}）`,
  )
})

test('4xx 不进冷却：请求到达了应用、拿到的是真实答复，照常每次尝试都发出去', async () => {
  const h = makeHarness()
  h.break503()
  h.break4xx()
  for (let i = 0; i < 30; i++) {
    h.advance(1)
    const res = await h.attempt(bodyOf(i))
    assert.equal(res.ok, false)
    assert.equal(res.status, 404, '拿到的是应用自己的答复')
  }
  assert.equal(h.sent.length, 30, '4xx 不是「目标不可达」，不许进冷却（否则正常报错会被限流挡住）')
})

test('同一个请求正在飞时合并成一条；不是同一个请求（请求体不同）不合并', async () => {
  const h = makeHarness()
  const release = h.hang()
  const a = h.attempt('{"rpcId":"same"}')
  const b = h.attempt('{"rpcId":"same"}')
  const c = h.attempt('{"rpcId":"other"}')
  release()
  const [ra, rb, rc] = await Promise.all([a, b, c])
  assert.equal(ra.ok, true)
  assert.equal(rb.ok, true)
  assert.equal(rc.ok, true)
  assert.equal(h.sent.length, 2, `同请求合并成一条、不同请求各发一条（实测发了 ${String(h.sent.length)} 条）`)
})

test('两半实现（Node 版与塞进页面的 JS 版）跑同一串事件逐行一致', () => {
  const sequence: { at: number; reason: string; message: string }[] = []
  const reasons = ['a', 'b', 'a', 'a']
  let at = 0
  for (let i = 0; i < 40; i++) {
    at += 1_500
    sequence.push({ at, reason: reasons[i % reasons.length] ?? 'a', message: `boom ${String(i)} at ${String(at)}` })
  }
  const clock = { now: 0 }
  const nodeSide = createFailureLog({ now: () => clock.now })
  const sandbox: Record<string, unknown> = {
    Map,
    Date: { now: () => clock.now },
    String,
    Number,
  }
  const context = vm.createContext(sandbox)
  vm.runInContext(`${failureLogJs()}\nglobalThis.__log = createFailureLog(${String(FAILURE_LOG_WINDOW_MS)})`, context, {
    filename: 'failureLog.js',
  })
  const pageSide = sandbox.__log as ReturnType<typeof createFailureLog>
  const nodeOut: string[] = []
  const pageOut: string[] = []
  for (const event of sequence) {
    clock.now = event.at
    const n = nodeSide.failed(event.reason, event.message)
    if (n !== undefined) nodeOut.push(n)
    const p = pageSide.failed(event.reason, event.message)
    if (p !== undefined) pageOut.push(p)
  }
  clock.now += 60_000
  for (const reason of new Set(sequence.map((event) => event.reason))) {
    const n = nodeSide.recovered(reason, `recovered ${reason}`)
    if (n !== undefined) nodeOut.push(n)
    const p = pageSide.recovered(reason, `recovered ${reason}`)
    if (p !== undefined) pageOut.push(p)
  }
  assert.deepEqual(pageOut, nodeOut, '页面侧那份 JS 与 Node 那份必须逐行一致')
  assert.ok(nodeOut.length >= 4, `这串事件该产生若干条（实测 ${JSON.stringify(nodeOut)}）`)
  assert.ok(nodeOut.some((line) => line.includes('same cause repeated')), '应当出现带计数的汇总行')
  assert.ok(nodeOut.some((line) => line.includes('recovered after')), '应当出现恢复收尾行')
})
