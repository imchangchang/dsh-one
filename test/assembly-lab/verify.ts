/**
 * 装配实验室验证入口（#78）：`npm run verify:lab`。
 *
 * 跑法：起实验室服务器（真实模块 + 真实网关只读）→ 起 chromium → 逐套件断言
 * → 写 ledger JSON → 用 `test/sandbox/report.mjs` 渲染单文件 HTML 报告。
 *
 * 参数（都能用环境变量给，便于 CI/其他 session）：
 *   --gateway <url>   网关地址（LAB_GATEWAY，缺省 http://127.0.0.1:3080）
 *   --token <token>   网关 launch token（LAB_TOKEN，缺省读 ~/.dsh/dsh-owned.json）
 *   --port <n>        实验室端口（LAB_PORT，缺省 3179；0 = 随机）
 *   --suite <ids>     只跑指定套件（逗号分隔，如 F-01,F-04；缺省全跑）
 *   --out <dir>       产物目录（缺省 test/assembly-lab/out）
 *   --headed          开有界面的浏览器（人工看现场用）
 *   --keep            跑完不关实验室服务器（配合 --headed 人工点页面）
 *   --no-report       只写 ledger，不渲染 HTML 报告
 */
import { execFileSync, spawnSync } from 'node:child_process'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Check, launchBrowser } from './harness.ts'
import { consoleLogger, defaultGateway, defaultPluginsDir, defaultPort, startLabServer } from './labServer.ts'
import { SUITES } from './suites.ts'

const LAB_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.join(LAB_DIR, '..', '..')

interface Args {
  gateway: string
  token?: string
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

async function main(): Promise<number> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) return printUsage()
  const args = parseArgs(process.argv.slice(2))
  const log = consoleLogger(args.quiet)

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

  let lab
  try {
    lab = await startLabServer({
      gateway: args.gateway,
      ...(args.token === undefined ? {} : { token: args.token }),
      log,
      pluginsDir,
      port: args.port,
    })
  } catch (err) {
    process.stderr.write(`test/assembly-lab: 实验室起不来：${err instanceof Error ? err.message : String(err)}\n`)
    return 2
  }

  const browser = await launchBrowser(!args.headed)
  const items: unknown[] = []
  let failed = 0
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
  } finally {
    await browser.close()
    if (!args.keep) lab.dispose()
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
          mode: '浏览器验证（真实仓库模块 + 真实 dsh 网关只读 + 假宿主）',
          dsh: lab.dshVersion ?? '（未知）',
          gateway: args.gateway,
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
  (code) => {
    process.exitCode = code
  },
  (err: unknown) => {
    process.stderr.write(`test/assembly-lab: 未预期失败：${err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)}\n`)
    process.exitCode = 2
  },
)
