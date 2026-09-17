/**
 * 装配实验室验证入口（#78）：`npm run verify:lab`。
 *
 * 跑法：起**隔离实例**（见下）并播种 → 起实验室服务器（真实模块 + 这台实例）→
 * 起 chromium → 逐套件断言 → 写 ledger JSON → 用 `test/sandbox/report.mjs`
 * 渲染单文件 HTML 报告。
 *
 * **默认连的就是实验室自己起的那台隔离实例**（#177）：独立的临时 `DSH_HOME`、
 * 随机空闲端口、`--no-open`，整轮跑完（或被打断、或异常退出）**按 PID** 收掉、
 * 临时目录删掉；跑之前经官方 RPC 往里播种真工作区与真会话（见 `seed.ts`）。
 * 用户的 `~/.dsh` 一个字节都不动，用户日常那台实例全程只被**只读探测**两次
 * （跑前一次、跑后一次，见 R-06）。
 *
 * 参数（部分能用环境变量给，便于 CI/其他 session）：
 *   --gateway <url>   连**外部实例**（LAB_GATEWAY 同义；人工排查用）。给了它就不再
 *                     自起实例，也不播种；那时按既有口径对待——**只读**，且 R-06
 *                     改判那台实例的会话数跑前跑后一致
 *   --token <token>   外部实例的 launch token（LAB_TOKEN；只有 --gateway 时才用得上，
 *                     缺省读 ~/.dsh/dsh-owned.json 里该端口那份）
 *   --port <n>        实验室端口（LAB_PORT，缺省 3179；0 = 随机）
 *   --suite <ids>     只跑指定套件（逗号分隔，如 F-01,F-04；缺省全跑）
 *   --out <dir>       产物目录（缺省 test/assembly-lab/out）
 *   --headed          开有界面的浏览器（人工看现场用）
 *   --keep            跑完不关实验室服务器（配合 --headed 人工点页面）
 *   --no-report       只写 ledger，不渲染 HTML 报告
 *
 * `--empty` 已退役（#177）：那套跑法就是现在的默认跑法，只是实例里现在会播种真数据。
 * 老参数仍然认，但直接报错退出——免得有人以为跑的是「空实例」。
 *
 * 收尾（#88）：无论跑完、有断言失败，还是被 Ctrl-C / SIGTERM 打断，都会回收
 * chromium、实验室服务器与隔离实例（按 PID），并以真实结果作为退出码
 * ——0 = 全过，1 = 有断言失败，2 = 起不来或未预期失败，130 / 143 = 被 Ctrl-C /
 * SIGTERM 打断。
 */
import { execFileSync, spawnSync } from 'node:child_process'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser } from 'playwright'
import { Check, apiMethodCounts, apiOriginCounts, launchBrowser } from './harness.ts'
import { startLabGateway, portListening, type LabGateway } from './labGateway.ts'
import {
  consoleLogger,
  defaultPluginsDir,
  defaultPort,
  resolveGatewayToken,
  startLabServer,
  type LabServer,
} from './labServer.ts'
import { SUITES } from './suites.ts'
import { listSessions } from '../../src/server/dshRpc.ts'
import { defaultOwnedPath, readOwnedRecord } from '../../src/server/ownedRecord.ts'
import { exchangeToken } from '../../src/server/assemblyMirror.ts'
import type { LogSink } from '../../src/log.ts'

const LAB_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.join(LAB_DIR, '..', '..')

/**
 * 本次运行起过的东西（chromium、实验室服务器、隔离实例）。
 * 放在模块级，是为了让信号处理也能看见它们——SIGINT / SIGTERM 时要把它们收干净，
 * 不能像 #88 之前那样一按 Ctrl-C 就留下挂着不动的孤儿进程（现场实测一台机器上堆了 38 个）。
 */
const resources: { browser?: Browser; lab?: LabServer; isolated?: LabGateway } = {}
/** `--keep`：故意把实验室服务器留着给人点页面，此时跑完不强制退出。 */
let keepServer = false
let shuttingDown = false

/**
 * 带超时的收尾：收尾本身也不许把进程卡住。#88 的现场就是「断言跑完、报告
 * 写完，进程还挂着」，所以宁可放弃等待也要退出去。
 */
async function withTimeout(step: string, work: Promise<unknown>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      work.then(
        () => undefined,
        (err: unknown) => {
          // 收尾失败不该改写验证结论，但也不能默默吞掉——打到 stderr 让人看得见。
          process.stderr.write(`test/assembly-lab: ${step} 失败：${err instanceof Error ? err.message : String(err)}\n`)
        },
      ),
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          process.stderr.write(`test/assembly-lab: ${step} 超过 ${String(ms / 1000)} 秒没结束，不再等它。\n`)
          resolve()
        }, ms)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** 回收本次运行起的 chromium、实验室服务器与隔离实例（重复调用安全）。 */
async function disposeResources(keepLab: boolean): Promise<void> {
  const browser = resources.browser
  resources.browser = undefined
  if (browser !== undefined) await withTimeout('关闭 chromium', browser.close(), 15_000)
  // `--keep` 时保留引用不销毁：之后若收到信号，还能从信号处理里收掉它。
  if (!keepLab && resources.lab !== undefined) {
    const lab = resources.lab
    resources.lab = undefined
    lab.dispose()
  }
  // 隔离实例是本次运行自己起的进程。`--keep`（人工开窗点页面）时**故意留着**：不留的话
  // 那几个页面就没有数据面了，`--keep` 也就没意义了——但信号处理照旧收它（Ctrl-C 之后
  // 不留残留）。其余情况一律按 PID 收干净（#177）。
  if (resources.isolated !== undefined && !keepLab) {
    const isolated = resources.isolated
    resources.isolated = undefined
    await withTimeout('收掉隔离实例', isolated.dispose(), 20_000)
  }
}

/** 被 Ctrl-C / SIGTERM 打断：收干净，再用约定俗成的退出码退（130 / 143）。 */
async function onSignal(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  process.stderr.write(`\ntest/assembly-lab: 收到 ${signal}，正在回收 chromium、实验室服务器与隔离实例…\n`)
  await disposeResources(false)
  process.exit(signal === 'SIGINT' ? 130 : 143)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void onSignal(signal))

/**
 * 跑完就退，退出码就是真实结果（#88）：不再指望「事件循环恰好没有悬挂句柄」
 * ——只要还剩一条没关的连接，Node 就不会自己退（现场抓到的是 mirror 转发的
 * 网关 `/plugins/events` 流）。先把已排队的 stdout 落盘（写一个空串，它的回调
 * 排在前面所有输出之后），再退；万一 stdout 卡住，5 秒后照样退。
 */
function finish(code: number): void {
  process.exitCode = code
  if (keepServer || shuttingDown) return
  const safety = setTimeout(() => process.exit(code), 5_000)
  process.stdout.write('', () => {
    clearTimeout(safety)
    process.exit(code)
  })
}

interface Args {
  /**
   * 外部实例地址（`--gateway` / `LAB_GATEWAY`）。给了就连它、不自起实例；缺省
   * = 自起隔离实例（#177 的默认跑法）。
   */
  gateway?: string
  token?: string
  port: number
  suites?: string[]
  out: string
  headed: boolean
  keep: boolean
  report: boolean
  quiet: boolean
}

/** `--empty` 退役后的说明（老脚本还在用它，所以认这个参数、但明确报错）。 */
const EMPTY_RETIRED =
  '`--empty` 已退役（#177）：零参数跑的就是「自起隔离实例」那套跑法，只是实例里现在会播种真数据。' +
  '直接跑 `npm run verify:lab`（要连外部实例用 `--gateway <url>`）。'

function parseArgs(argv: readonly string[]): Args {
  const value = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`)
    return index >= 0 ? argv[index + 1] : undefined
  }
  const suiteList = value('suite')
  const token = value('token') ?? process.env.LAB_TOKEN ?? process.env.DSH_TOKEN
  const external = value('gateway') ?? process.env.LAB_GATEWAY
  return {
    ...(external === undefined || external === '' ? {} : { gateway: external }),
    ...(token === undefined || token === '' ? {} : { token }),
    port: Number(value('port') ?? defaultPort()),
    ...(suiteList === undefined ? {} : { suites: suiteList.split(',').map((id) => id.trim().toUpperCase()).filter((id) => id !== '') }),
    out: path.resolve(value('out') ?? path.join(LAB_DIR, 'out')),
    headed: argv.includes('--headed'),
    keep: argv.includes('--keep'),
    report: !argv.includes('--no-report'),
    quiet: argv.includes('--quiet'),
  }
}

/** `--help`：把文件头的说明打出来（参数与前置条件都在那里）。 */
async function printUsage(): Promise<number> {
  const source = await fsp.readFile(path.join(LAB_DIR, 'verify.ts'), 'utf8')
  const header = /\/\*\*([\s\S]*?)\*\//.exec(source)?.[1] ?? ''
  process.stdout.write(header.replace(/^ \* ?/gm, '').trim() + '\n')
  return 0
}

/** git 信息（报告抬头用；取不到就留空，不阻断验证）。 */
function gitInfo(): { branch: string; commit: string } {
  const read = (args: string[]): string => {
    try {
      return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
    } catch {
      return ''
    }
  }
  return { branch: read(['rev-parse', '--abbrev-ref', 'HEAD']), commit: read(['rev-parse', 'HEAD']) }
}

/**
 * 用户日常那台实例（R-06 只读探测打的就是它）：扩展的缺省端口。
 * 出处：`src/server/manager.ts` 的 `cfg.get<number>('port', 3080)`；用户在设置里改过
 * 端口的话这里探不到，R-06 会如实记一条事实（探不到就不可能被它碰到）。
 */
const EVERYDAY_GATEWAY = 'http://127.0.0.1:3080'

/** 一次**只读**探测的结果（R-06 的可执行定义就是跑前跑后各来一次）。 */
interface ReadOnlyProbe {
  origin: string
  ok: boolean
  sessions?: number
  detail: string
}

/**
 * 对某个实例做一次只读探测：换票（读 `~/.dsh/dsh-owned.json` 里那份 token）→ 数会话数。
 * 两步都是读（换票只是拿一个 cookie，`serverAuth.exchangeToken` 的注释与 `probeToken`
 * 的用法可证），不写对方的任何数据。
 */
async function probeReadOnly(origin: string, explicitToken: string | undefined, log: LogSink): Promise<ReadOnlyProbe> {
  try {
    const record = await readOwnedRecord(defaultOwnedPath())
    const token = resolveGatewayToken(origin, explicitToken, record)
    if (token === undefined) {
      return { origin, ok: false, detail: `${origin} 拿不到 launch token（~/.dsh/dsh-owned.json 里没有它）` }
    }
    await exchangeToken(origin, token, log)
    const sessions = (await listSessions(origin)).length
    return { origin, ok: true, sessions, detail: `${origin} 会话 ${String(sessions)} 条` }
  } catch (err) {
    return { origin, ok: false, detail: `${origin} 探测不到：${err instanceof Error ? err.message : String(err)}` }
  }
}

/** 这个 pid 还在吗（`kill(pid, 0)` 抛 ESRCH = 没了）。 */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * R-06 的**新口径**（#177）：从「网关会话数跑前跑后一致」改成「**整轮零请求打到实例之外**」。
 *
 * 旧口径在一个共享实例上根本守不住（别的 session 也在同一个网关上建会话，数自然对不上，
 * 见 #116），而且它守的是错的东西——真正要保证的是「实验室没碰用户的机器」。新口径把它
 * 换成三件可执行的事：
 * ① 整轮连的是自起的隔离实例（与用户日常实例不是同一个地址）；
 * ② 对用户日常实例只做一次**只读**探测（跑前一次、跑后一次），两次读数一致；
 * ③ 跑完隔离实例按 PID 收掉了、临时 `DSH_HOME` 删掉了。
 *
 * `--gateway` 连外部实例时没有 ①，改成：整轮连的就是指定那台，对它自己按只读口径
 * 跑前跑后各探测一次（连的是用户日常实例时，就是原来那条会话数不变的守卫）。
 */
function readonlyCheck(
  check: Check,
  options: {
    external?: string
    gateway: string
    probeBefore?: ReadOnlyProbe
    probeAfter?: ReadOnlyProbe
    everydayBefore?: ReadOnlyProbe
    everydayAfter?: ReadOnlyProbe
    isolated?: LabGateway
  },
): void {
  const { external, gateway } = options
  // 「整轮零请求打到实例之外」在**页面侧**的直接读数（#177）：页面上的一切请求都记了源，
  // 一条都不该落到本轮实例之外。这条比「日常实例会话数前后一致」结实——后者在共享实例上
  // 会被**别人**的写入顶红（#116 / #175 记的就是它），而别人写不写不归我们管。
  const origins = apiOriginCounts()
  check.fact(
    `整轮页面请求落到的源：${origins.size === 0 ? '（无）' : [...origins].map(([origin, count]) => `${origin}×${String(count)}`).join('、')}`,
  )
  if (external === undefined) {
    check.ok(
      '整轮零请求打到用户日常实例（页面请求的源里没有它）',
      !origins.has(EVERYDAY_GATEWAY),
      `日常实例 ${EVERYDAY_GATEWAY}，本轮请求的源 ${JSON.stringify([...origins.keys()])}`,
    )
    check.ok(
      '整轮连的是自起的隔离实例（不是用户日常实例）',
      gateway !== EVERYDAY_GATEWAY,
      `本轮网关 ${gateway}，日常实例 ${EVERYDAY_GATEWAY}`,
    )
    const before = options.everydayBefore
    const after = options.everydayAfter
    check.fact(`日常实例跑前只读探测：${before?.detail ?? '（没探）'}`)
    check.fact(`日常实例跑后只读探测：${after?.detail ?? '（没探）'}`)
    if (before?.ok === true && after?.ok === true && before.sessions !== after.sessions) {
      // 两台实例之间只有探测这两次接触，所以数变了只可能是**别人**在写那台共享实例
      // （并行 session、用户在 VS Code 里用）。如实记一条事实，不判红：判红等于让
      // 「别人的动作」决定我们的门禁（#175 的现场）。
      check.fact(
        `日常实例会话数跑前跑后不同（${String(before.sessions)} → ${String(after.sessions)}）：这台共享实例上有别的写者，本轮的写面全在隔离实例里（见上一条）`,
      )
    }
    if (before === undefined || after === undefined) {
      check.ok('日常实例各做了一次只读探测（跑前一次、跑后一次）', false, '探测记录缺一条')
    }
  } else {
    check.fact(`本轮连的是 --gateway 指定的外部实例：${external}`)
    const before = options.probeBefore
    const after = options.probeAfter
    check.ok('外部实例模式：整轮没有自起隔离实例', options.isolated === undefined, `isolated=${String(options.isolated !== undefined)}`)
    check.fact(`外部实例跑前只读探测：${before?.detail ?? '（没探）'}`)
    check.fact(`外部实例跑后只读探测：${after?.detail ?? '（没探）'}`)
    if (before?.ok === true && after?.ok === true) {
      check.eq('外部实例按只读对待（会话数跑前跑后一致）', after.sessions ?? -1, before.sessions ?? -2)
    } else if (before?.ok === false && after?.ok === false) {
      check.ok('外部实例探测不到（换票失败或没在跑），去起它或换 --token', false, before.detail)
    } else {
      check.ok('外部实例跑前跑后探测结果一致', false, `跑前 ${before?.detail ?? '没探'}，跑后 ${after?.detail ?? '没探'}`)
    }
    if (external !== EVERYDAY_GATEWAY) {
      const eb = options.everydayBefore
      const ea = options.everydayAfter
      check.fact(`日常实例跑前只读探测：${eb?.detail ?? '（没探）'}`)
      check.fact(`日常实例跑后只读探测：${ea?.detail ?? '（没探）'}`)
      check.ok(
        '整轮零请求打到用户日常实例（页面请求的源里没有它）',
        !origins.has(EVERYDAY_GATEWAY),
        `日常实例 ${EVERYDAY_GATEWAY}，本轮请求的源 ${JSON.stringify([...origins.keys()])}`,
      )
    }
  }
}

/** R-06 的后三条（跑完才量得到）：隔离实例的进程、端口与临时目录确实收掉了。 */
async function assertIsolatedCollected(check: Check, isolated: LabGateway): Promise<void> {
  check.ok(
    `隔离实例进程已按 PID 收掉（pid ${String(isolated.pid)}）`,
    !pidAlive(isolated.pid),
    `pid ${String(isolated.pid)} ${pidAlive(isolated.pid) ? '仍在' : '已退出'}`,
  )
  // 端口这一条是「有没有留下别的 dsh 进程占着它」的直接读数（进程自己换了 pid、
  // 或者 dsh 起了子进程时，只看 pid 是看不出来的）。
  const listening = await portListening(isolated.port)
  check.ok(`隔离实例的端口已释放（${String(isolated.port)}）`, !listening, listening ? '仍有人在监听' : '没人监听')
  const exists = await fsp
    .stat(isolated.home)
    .then(() => true)
    .catch(() => false)
  check.ok(`临时 DSH_HOME 已删掉（${isolated.home}）`, !exists, exists ? '目录仍在' : '目录已删')
}

/** 整轮页面发出的 `/api/<method>` 的观测（信息性，见 #175）：写类在前、读类归一行。 */
function apiRequestFacts(): string[] {
  const counts = apiMethodCounts()
  if (counts.size === 0) return ['整轮页面没有发出过任何 /api/ 请求（观测）']
  const entries = [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
  const writes = entries.filter(([method]) => WRITE_METHOD_RE.test(method))
  const reads = entries.filter(([method]) => !WRITE_METHOD_RE.test(method))
  return [
    `整轮发过的写类 RPC（观测，不判死）：${writes.length === 0 ? '（无）' : writes.map(([m, n]) => `${m}×${String(n)}`).join('、')}`,
    `整轮发过的读类 RPC：${reads.map(([m, n]) => `${m}×${String(n)}`).join('、')}`,
  ]
}

/**
 * 一条方法名算不算写类（#175 的口径）：方法名里带这些动作词的都算。
 * 这是**观测**用的粗分类，不参与判定——所以宁可宽一点，让它把可疑的名字都摆出来。
 */
const WRITE_METHOD_RE =
  /(create|delete|remove|rename|archive|prompt|respond|write|update|put|patch|execute|cancel|abort|fork|send|move|add|clear|reset|start|stop|pause|resume|select|open|set)/i

async function main(): Promise<number> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) return printUsage()
  if (process.argv.includes('--empty')) {
    process.stderr.write(`test/assembly-lab: ${EMPTY_RETIRED}\n`)
    return 2
  }
  const args = parseArgs(process.argv.slice(2))
  const log = consoleLogger(args.quiet)
  keepServer = args.keep

  const pluginsDir = defaultPluginsDir()
  const plugins = await fsp.readdir(pluginsDir).catch(() => null)
  if (plugins === null || plugins.length === 0) {
    process.stderr.write(
      `test/assembly-lab: 自有插件 bundle 目录为空或不存在（${pluginsDir}）——先跑 \`npm run build\`（\`npm run verify:lab\` 已包含）。\n`,
    )
    return 2
  }

  const suites = args.suites === undefined ? SUITES : SUITES.filter((suite) => args.suites?.includes(suite.id) === true)
  if (suites.length === 0) {
    process.stderr.write(`test/assembly-lab: 没有匹配的套件（可用：${SUITES.map((s) => s.id).join(', ')}）\n`)
    return 2
  }

  const shots = path.join(args.out, 'shots')
  await fsp.mkdir(shots, { recursive: true })

  // 数据面：缺省自起隔离实例并播种（#177）；给了 --gateway / LAB_GATEWAY 才去连外部实例。
  let gateway: string
  let token: string | undefined
  let version: string | undefined
  let isolated: LabGateway | undefined
  if (args.gateway === undefined) {
    try {
      isolated = await startLabGateway(log)
      resources.isolated = isolated
      gateway = isolated.gateway
      token = isolated.token
      version = isolated.version
    } catch (err) {
      process.stderr.write(`test/assembly-lab: 隔离实例起不来：${err instanceof Error ? err.message : String(err)}\n`)
      await disposeResources(false)
      return 2
    }
  } else {
    gateway = args.gateway
    token = args.token
  }

  let lab
  try {
    lab = await startLabServer({
      gateway,
      ...(token === undefined ? {} : { token }),
      ...(version === undefined ? {} : { version }),
      log,
      pluginsDir,
      port: args.port,
    })
  } catch (err) {
    process.stderr.write(`test/assembly-lab: 实验室起不来：${err instanceof Error ? err.message : String(err)}\n`)
    await disposeResources(false)
    return 2
  }
  resources.lab = lab

  const browser = await launchBrowser(!args.headed)
  resources.browser = browser
  const items: unknown[] = []
  let failed = 0
  // R-06 的探测：隔离模式下探的是**用户日常实例**（证明整轮没碰它）、外部模式下探的是
  // 连的那台（既有只读口径）。两次都在套件跑之前/之后，各一次。
  const watchEveryday = args.gateway === undefined || args.gateway !== EVERYDAY_GATEWAY
  const everydayBefore = watchEveryday ? await probeReadOnly(EVERYDAY_GATEWAY, undefined, log) : undefined
  const externalBefore = args.gateway === undefined ? undefined : await probeReadOnly(gateway, args.token, log)
  const readonly = new Check()
  try {
    for (const suite of suites) {
      const check = new Check()
      const started = Date.now()
      let screenshots: string[] = []
      let crash: string | undefined
      try {
        screenshots = await suite.run({ browser, lab, shots }, check)
      } catch (err) {
        crash = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
        check.ok(`${suite.id} 套件执行到底`, false, crash.slice(0, 400))
      }
      const seconds = ((Date.now() - started) / 1000).toFixed(1)
      const passed = check.failed.length === 0
      if (!passed) failed += 1
      process.stdout.write(
        `${passed ? 'PASS' : 'FAIL'} ${suite.id} ${suite.name} — 断言 ${String(check.passed)}/${String(check.total)}（${seconds}s）\n`,
      )
      for (const assertion of check.failed) {
        process.stdout.write(`      ✗ ${assertion.label}${assertion.detail === '' ? '' : `（${assertion.detail}）`}\n`)
      }
      items.push({
        id: suite.id,
        phase: suite.phase,
        name: suite.name,
        expect: suite.expect,
        result: passed ? 'pass' : 'fail',
        screenshots,
        notes: check.notes() + (crash === undefined ? '' : `\n套件异常：\n${crash}`),
      })
    }

    // 跑后那一次探测（同一次只读口径）。
    const everydayAfter = watchEveryday ? await probeReadOnly(EVERYDAY_GATEWAY, undefined, log) : undefined
    const externalAfter = args.gateway === undefined ? undefined : await probeReadOnly(gateway, args.token, log)
    for (const line of apiRequestFacts()) readonly.fact(line)
    readonlyCheck(readonly, {
      ...(args.gateway === undefined ? {} : { external: args.gateway }),
      gateway,
      ...(externalBefore === undefined ? {} : { probeBefore: externalBefore }),
      ...(externalAfter === undefined ? {} : { probeAfter: externalAfter }),
      ...(everydayBefore === undefined ? {} : { everydayBefore }),
      ...(everydayAfter === undefined ? {} : { everydayAfter }),
      ...(isolated === undefined ? {} : { isolated }),
    })
  } finally {
    await disposeResources(args.keep)
  }
  // 收尾之后的断言：隔离实例的进程、端口与临时目录确实没了（#177 的验收项之一）。
  // `--keep` 是唯一例外——那时它是**故意留着的**，如实记一条事实，不当作残留。
  if (isolated !== undefined && !args.keep) await assertIsolatedCollected(readonly, isolated)
  else if (isolated !== undefined) {
    readonly.fact(
      `--keep：隔离实例故意留着给人点页面（${isolated.gateway}，DSH_HOME=${isolated.home}，pid ${String(isolated.pid)}）——Ctrl-C 会收掉它`,
    )
  }

  const readonlyPassed = readonly.failed.length === 0
  if (!readonlyPassed) failed += 1
  process.stdout.write(
    `${readonlyPassed ? 'PASS' : 'FAIL'} R-06 只读与收尾（整轮零请求打到实例之外） — 断言 ${String(readonly.passed)}/${String(readonly.total)}\n`,
  )
  for (const assertion of readonly.failed) {
    process.stdout.write(`      ✗ ${assertion.label}（${assertion.detail}）\n`)
  }
  items.push({
    id: 'R-06',
    phase: 'regression',
    name: '整轮零请求打到实例之外（默认：隔离实例自起自收；--gateway：外部实例按只读对待）',
    expect:
      '整轮浏览器验证的写面只落在**实验室自起的隔离实例**里（独立临时 DSH_HOME、随机端口）：页面上发出的请求**一条都不落在本轮实例之外**（页面请求的源逐个记下来核过，用户日常实例不在里面），用户日常实例全程只被**只读**探测两次（跑前一次、跑后一次，读数记进事实——共享实例上有别的写者时读数会差，那不归本轮管，见上一条断言），跑完隔离实例按 PID 收掉、端口释放、临时 DSH_HOME 删掉。附整轮页面发出的 /api/ 方法清单（写类在前）作为观测。',
    result: readonlyPassed ? 'pass' : 'fail',
    screenshots: [],
    notes: readonly.notes(),
  })

  const { branch, commit } = gitInfo()
  const ledgerPath = path.join(args.out, 'verify.lab.ledger.json')
  await fsp.writeFile(
    ledgerPath,
    `${JSON.stringify(
      {
        title: 'DSH One 装配实验室报告：浏览器验证套件（#78）',
        branch,
        commit,
        environment: {
          mode:
            args.gateway === undefined
              ? '浏览器验证（真实仓库模块 + 实验室自起的隔离实例［临时 DSH_HOME，已播种真数据］+ 假宿主）'
              : `浏览器验证（真实仓库模块 + 外部实例 ${args.gateway}［只读］+ 假宿主）`,
          dsh: lab.dshVersion ?? '（未知）',
          gateway,
          lab: lab.origin,
          driver: `playwright chromium + test/assembly-lab/verify.ts（${String(items.length)} 个套件）`,
          date: new Date().toISOString(),
        },
        coverageNote:
          '本报告是浏览器验证（第一道验证）：装配页由仓库真实模块（pageHtml / wireFilter / trees / assemblyMirror）构建，数据面是实验室自起的隔离实例（临时 DSH_HOME、官方 RPC 播种的真工作区与会话；`--gateway` 时才连外部实例），宿主通道是假宿主（按同一协议应答）。未覆盖：真 VS Code webview 宿主层（CSP 差异、剪贴板、原生菜单、多 webview 生命周期）、真模型输出（模型由仓库 test/mock-llm 的假端点代行）、macOS 之外的平台。这些见 VS Code 验证（scripts/dev-ui-test.sh，最终准绳）与 test/sandbox 沙盒。',
        items,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  process.stdout.write(`ledger: ${ledgerPath}\n`)

  if (args.report) {
    const reportPath = path.join(args.out, 'verify.lab.report.html')
    const rendered = spawnSync(
      process.execPath,
      [path.join(REPO_ROOT, 'test', 'sandbox', 'report.mjs'), '--ledger', ledgerPath, '--out', reportPath],
      { stdio: 'inherit' },
    )
    if (rendered.status !== 0) process.stderr.write('test/assembly-lab: 报告渲染失败（ledger 仍然可用）\n')
  }

  return failed === 0 ? 0 : 1
}

main().then(
  (code) => finish(code),
  async (err: unknown) => {
    process.stderr.write(`test/assembly-lab: 未预期失败：${err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)}\n`)
    await disposeResources(keepServer)
    finish(2)
  },
)
