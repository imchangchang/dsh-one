/**
 * 装配实验室验证入口（#78）：`npm run verify:lab`。
 *
 * 跑法：起实验室服务器（真实模块 + 真实网关只读）→ 起 chromium → 逐套件断言
 * → 写 ledger JSON → 用 `test/sandbox/report.mjs` 渲染单文件 HTML 报告。
 *
 * 参数（都能用环境变量给，便于 CI/其他 session）：
 *   --gateway <url>   网关地址（LAB_GATEWAY，缺省 http://127.0.0.1:3080）
 *   --token <token>   网关 launch token（LAB_TOKEN，缺省读 ~/.dsh/dsh-owned.json）
 *   --empty           改用**现起的空实例网关**（全新 DSH_HOME，工作区与会话都是零），
 *                     不连日常实例；与 --gateway / --token 互斥。跑法与理由见 README
 *                     的「空实例整轮」一节（#162）
 *   --port <n>        实验室端口（LAB_PORT，缺省 3179；0 = 随机）
 *   --suite <ids>     只跑指定套件（逗号分隔，如 F-01,F-04；缺省全跑）
 *   --out <dir>       产物目录（缺省 test/assembly-lab/out）
 *   --headed          开有界面的浏览器（人工看现场用）
 *   --keep            跑完不关实验室服务器（配合 --headed 人工点页面）
 *   --no-report       只写 ledger，不渲染 HTML 报告
 *
 * 收尾（#88）：无论跑完、有断言失败，还是被 Ctrl-C / SIGTERM 打断，都会回收
 * chromium、实验室服务器（`--empty` 时还有那个空实例网关），并以真实结果作为退出码
 * ——0 = 全过，1 = 有断言失败，2 = 起不来或未预期失败，130 / 143 = 被 Ctrl-C /
 * SIGTERM 打断。
 */
import { execFileSync, spawnSync } from 'node:child_process'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser } from 'playwright'
import { Check, launchBrowser } from './harness.ts'
import { startEmptyGateway, type EmptyGateway } from './emptyGateway.ts'
import {
  consoleLogger,
  defaultGateway,
  defaultPluginsDir,
  defaultPort,
  startLabServer,
  type LabServer,
} from './labServer.ts'
import { SUITES } from './suites.ts'
import { listSessions } from '../../src/server/dshRpc.ts'

const LAB_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.join(LAB_DIR, '..', '..')

/**
 * 本次运行起过的东西（chromium、实验室服务器，`--empty` 时还有空实例网关）。
 * 放在模块级，是为了让信号处理也能看见它们——SIGINT / SIGTERM 时要把它们收干净，
 * 不能像 #88 之前那样一按 Ctrl-C 就留下挂着不动的孤儿进程（现场实测一台机器上堆了 38 个）。
 */
const resources: { browser?: Browser; lab?: LabServer; empty?: EmptyGateway } = {}
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

/** 回收本次运行起的 chromium、实验室服务器与空实例网关（重复调用安全）。 */
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
  // 空实例网关是本次运行自己起的进程，`--keep` 也照收——它会占着一个端口，
  // 而且临时 HOME 里的东西没人会再用（#162：跑完必须按 PID 收干净）。
  if (resources.empty !== undefined) {
    const empty = resources.empty
    resources.empty = undefined
    await withTimeout('收掉空实例网关', empty.dispose(), 20_000)
  }
}

/** 被 Ctrl-C / SIGTERM 打断：收干净，再用约定俗成的退出码退（130 / 143）。 */
async function onSignal(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  process.stderr.write(`\ntest/assembly-lab: 收到 ${signal}，正在回收 chromium 与实验室服务器…\n`)
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
  gateway: string
  token?: string
  /** `--empty`：不连日常实例，现起一个空实例网关（见 {@link startEmptyGateway}）。 */
  empty: boolean
  port: number
  suites?: string[]
  out: string
  headed: boolean
  keep: boolean
  report: boolean
  quiet: boolean
}

function parseArgs(argv: readonly string[]): Args {
  const value = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`)
    return index >= 0 ? argv[index + 1] : undefined
  }
  const suiteList = value('suite')
  const token = value('token') ?? process.env.LAB_TOKEN ?? process.env.DSH_TOKEN
  return {
    gateway: value('gateway') ?? defaultGateway(),
    ...(token === undefined || token === '' ? {} : { token }),
    empty: argv.includes('--empty'),
    port: Number(value('port') ?? defaultPort()),
    ...(suiteList === undefined ? {} : { suites: suiteList.split(',').map((id) => id.trim().toUpperCase()).filter((id) => id !== '') }),
    out: path.resolve(value('out') ?? path.join(LAB_DIR, argv.includes('--empty') ? 'out-empty' : 'out')),
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

async function main(): Promise<number> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) return printUsage()
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

  // `--empty`：现起一个空实例网关（全新 DSH_HOME），整轮对着它跑。这样「判据有没有
  // 吃运行环境的输入」会一次性暴露，不用靠撞（#162）。起了就是本次运行的资源，
  // 收尾与信号处理都会按 PID 收掉它。
  let gateway = args.gateway
  let token = args.token
  let version: string | undefined
  if (args.empty) {
    const conflicting =
      process.argv.includes('--gateway') || process.argv.includes('--token') || (process.env.LAB_GATEWAY ?? '') !== ''
    if (conflicting) {
      process.stderr.write(
        'test/assembly-lab: `--empty` 与 `--gateway` / `--token` / `LAB_GATEWAY` 互斥——空实例整轮连的是本次现起的那个网关，不接受另外指定。\n',
      )
      return 2
    }
    try {
      const empty = await startEmptyGateway(log)
      resources.empty = empty
      gateway = empty.gateway
      token = empty.token
      version = empty.version
    } catch (err) {
      process.stderr.write(`test/assembly-lab: 空实例网关起不来：${err instanceof Error ? err.message : String(err)}\n`)
      await disposeResources(false)
      return 2
    }
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
  // 只读守卫（报告里的 R-06）：整轮跑前跑后数一遍网关上的会话数——实验室的任何
  // 动作都不该创建/删除会话（喂 prompt、点「新建会话」都会改变这个数）。这是
  // 「真实网关只读」的可执行定义，不是口头承诺。
  let sessionsBefore: number | undefined
  try {
    sessionsBefore = (await listSessions(gateway)).length
  } catch (err) {
    log.warn(`lab: 跑前会话数取不到（${err instanceof Error ? err.message : String(err)}）`)
  }
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

    const readonly = new Check()
    let sessionsAfter: number | undefined
    try {
      sessionsAfter = (await listSessions(gateway)).length
    } catch (err) {
      readonly.ok('跑后仍能读到网关会话清单', false, err instanceof Error ? err.message : String(err))
    }
    if (sessionsBefore !== undefined && sessionsAfter !== undefined) {
      readonly.fact(`网关会话数：跑前 ${String(sessionsBefore)}，跑后 ${String(sessionsAfter)}`)
      readonly.eq('整轮验证没有创建/删除任何会话（网关只读）', sessionsAfter, sessionsBefore)
    } else {
      readonly.ok('网关会话数前/后都读到了（才能证明只读）', false, `before=${String(sessionsBefore)} after=${String(sessionsAfter)}`)
    }
    const readonlyPassed = readonly.failed.length === 0
    if (!readonlyPassed) failed += 1
    process.stdout.write(
      `${readonlyPassed ? 'PASS' : 'FAIL'} R-06 实验室对真实网关只读 — 断言 ${String(readonly.passed)}/${String(readonly.total)}\n`,
    )
    for (const assertion of readonly.failed) {
      process.stdout.write(`      ✗ ${assertion.label}（${assertion.detail}）\n`)
    }
    items.push({
      id: 'R-06',
      phase: 'regression',
      name: '实验室对真实网关只读（跑前跑后会话数不变）',
      expect:
        '整轮浏览器验证跑完，网关上的会话数与跑前完全相同：实验室只渲染与做本地夹具交互，不创建会话、不发 prompt、不归档（唯一写类动作是 token 换票，与扩展自身连接路径相同）。',
      result: readonlyPassed ? 'pass' : 'fail',
      screenshots: [],
      notes: readonly.notes(),
    })
  } finally {
    await disposeResources(args.keep)
  }

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
            args.empty === true
              ? '浏览器验证（真实仓库模块 + 现起的空实例网关［全新 DSH_HOME］只读 + 假宿主）'
              : '浏览器验证（真实仓库模块 + 真实 dsh 网关只读 + 假宿主）',
          dsh: lab.dshVersion ?? '（未知）',
          gateway,
          lab: lab.origin,
          driver: `playwright chromium + test/assembly-lab/verify.ts（${String(items.length)} 个套件）`,
          date: new Date().toISOString(),
        },
        coverageNote:
          '本报告是浏览器验证（第一道验证）：装配页由仓库真实模块（pageHtml / wireFilter / trees / assemblyMirror）构建，数据面是本机真实 dsh 网关（只读），宿主通道是假宿主（按同一协议应答）。未覆盖：真 VS Code webview 宿主层（CSP 差异、剪贴板、原生菜单、多 webview 生命周期）、运行中回合的停止路径、真模型输出、macOS 之外的平台。这些见 VS Code 验证（scripts/dev-ui-test.sh，最终准绳）与 test/sandbox 沙盒。',
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
