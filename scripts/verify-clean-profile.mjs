#!/usr/bin/env node
/**
 * 干净 profile 门禁（#165）：在**全新的 DSH_HOME** 里装进自有插件包、现起一个隔离的
 * dsh 网关，再用仓库真实模块的装配页（实验室那套 pageHtml / wireFilter / mirror）逐棵树
 * 打开，核对「干净 profile 上装配页能起来」。
 *
 * 为什么单独一条门禁：日常实例（用户的 ~/.dsh，装了几十个插件）与本条的场景差一件事
 * ——把自有插件包装进 profile 之后插件总数多五个，官方按 combo URL 的长度上限
 * （3KB）把 application 阶段切成**两批**，于是
 *   ① 过滤自检只看第一批时会误判「清单对不上」而抛错、整页打不开；
 *   ② 网关清单里已经有同 id 的自有插件时，装配侧再叠一份本地 bundle 会让客户端抛
 *      duplicate graph entry。
 * 这两条都只在「干净 profile + 装了我们的包」这个组合上出现，日常实例上照不出来
 * （实测：日常实例只有一个 application 批），所以必须有这条常驻门禁盯着。
 *
 * 与另外几条的关系：
 * - `npm run verify:lab`：日常实例上的全量套件（F-11 里钉着「条落在第二批」的口径用例）；
 * - `npm run verify:plugins-official`：官方页面本身（我们包的清单/产物）；
 * - 本脚本：**我们的装配页**在干净 profile 上能不能起来（三棵生产树 + 侧栏对照档）。
 *
 * 用法：
 *   node scripts/verify-clean-profile.mjs [--keep] [--json]
 * 退出码：0 = 全部通过；1 = 有断言失败（输出里标出哪一条）；
 * 130 / 143 = 被 Ctrl-C / SIGTERM 打断（收尾跑完再退，与装配实验室同一口径）。
 */
import { spawn, spawnSync } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import { chromium } from 'playwright'
import { assertBuildArtifacts } from './check-build-artifacts.mjs'

const args = process.argv.slice(2)
const keep = args.includes('--keep')
const asJson = args.includes('--json')

const ROOT = path.resolve(import.meta.dirname, '..')
const PACKAGES_DIR = path.join(ROOT, 'packages')
const HOST_HALF = 'dsh-host-capabilities'

/**
 * 已知的、与本条门禁无关的阻断项：命中即记为「已知阻断」，不当失败，但**必须**
 * 与签名逐字相符（换个原因红起来照样是失败）。修好之后这一项会自动变成「例外已
 * 不再需要」，提示从表里删掉——不静默留着。
 */
const KNOWN_BLOCKERS = [
  {
    issue: '#164',
    why: '侧栏树的 block list 还挡着 ui-commands，官方 ui-model-selection 等它的 commandUi（boot 卡 pending）',
    trees: ['sidebar', 'sidebar-official'],
    match: /dsh-client-ui-model-selection: pending \(waiting for service: commandUi\)/,
  },
]

/** 逐棵树的打开方式：就绪选择器与视口（与实验室一致）。 */
const TREES = [
  { route: 'chat', ready: '[data-slot="conversation.composer.bar"]', viewport: { width: 1200, height: 900 } },
  { route: 'sidebar', ready: '.dshOneTree_root', viewport: { width: 380, height: 900 } },
  { route: 'sidebar-official', ready: '[class*="_sectionHeader"]', viewport: { width: 380, height: 900 } },
  { route: 'settings', ready: '[data-slot="settings.section"]', viewport: { width: 1200, height: 900 } },
]

const evidence = []
const failures = []

function record(name, ok, detail) {
  evidence.push({ name, ok, detail })
  if (!ok) failures.push(name)
  if (!asJson) console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

function note(name, detail) {
  evidence.push({ name, ok: true, detail, note: true })
  if (!asJson) console.log(` note  ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

/** 仓库里所有声明了 dsh.client 的插件包（读清单，不硬编码——新增包自动纳入）。 */
async function pluginPackages() {
  const found = []
  for (const dir of (await fs.readdir(PACKAGES_DIR)).sort()) {
    const manifest = JSON.parse(await fs.readFile(path.join(PACKAGES_DIR, dir, 'package.json'), 'utf8'))
    if (manifest.dsh?.client !== undefined) found.push(path.join(PACKAGES_DIR, dir))
  }
  return found
}

/**
 * 本次运行起过的东西（chromium、装配页服务器、子进程）与临时目录。放在模块级，是为了让
 * **信号处理**也看得见它们：`chromium.launch()` 默认带 `handleSIGINT` / `handleSIGTERM`，
 * Playwright 自己也装了一对信号处理，收到信号就关掉浏览器然后 `process.exit(130)`——
 * `main()` 的 `finally`（关 chromium、收实验室服务器与子进程、删临时目录）一句都跑不到，
 * 进程按 130 退掉、临时目录留在原地（#190 实测）。现在两个开关都关掉，收尾统一由这里的
 * `onSignal` 负责。
 */
const resources = { browser: null, lab: null, children: [], tmp: null }
/** 已经进了收尾流程（信号打断会直接退进程，别让收尾跑第二遍）。 */
let shuttingDown = false
/** `--keep`：跑完保留临时目录供人工查看；被信号打断时改成 false（一律收干净，不留半截现场）。 */
let keepTmpDir = keep

const spawnChild = (command, commandArgs, options = {}) => {
  const child = spawn(command, commandArgs, { ...options })
  resources.children.push(child)
  return child
}

/**
 * 带超时的收尾：收尾本身也不许把进程卡住（装配实验室 #88 的现场就是「断言跑完、
 * 报告写完，进程还挂着」），宁可放弃等待也要退出去。
 */
async function withTimeout(step, work, ms) {
  let timer
  try {
    await Promise.race([
      work.then(
        () => undefined,
        // 收尾失败不改写验证结论，但也不能默默吞掉——打到 stderr 让人看得见。
        (error) => {
          process.stderr.write(
            `verify-clean-profile: ${step} 失败：${error instanceof Error ? error.message : String(error)}\n`,
          )
        },
      ),
      new Promise((resolve) => {
        timer = setTimeout(() => {
          process.stderr.write(`verify-clean-profile: ${step} 超过 ${String(ms / 1000)} 秒没结束，不再等它。\n`)
          resolve()
        }, ms)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** 按 PID 收掉本次运行起的子进程（先 SIGTERM 再 SIGKILL）。 */
async function killChildren() {
  for (const child of resources.children) {
    if (child.exitCode === null) child.kill('SIGTERM')
  }
  await new Promise((resolve) => setTimeout(resolve, 1200))
  for (const child of resources.children) {
    if (child.exitCode === null) child.kill('SIGKILL')
  }
}

/**
 * 收尾：关 chromium、收实验室服务器、按 PID 收子进程、删临时目录。正常跑完与信号打断都会调
 * 它，两条路共享同一个在途 promise——被打断的那一瞬 `main()` 的 `finally` 可能也刚起来，
 * 只收一次，后到的那条等前一条收完，免得「一边还在删临时目录、另一边已经退进程」（退早了
 * 目录就留在原地）。
 */
let disposal = null
function disposeResources() {
  disposal ??= (async () => {
    const browser = resources.browser
    resources.browser = null
    if (browser !== null) await withTimeout('关闭 chromium', browser.close(), 15_000)
    const lab = resources.lab
    resources.lab = null
    if (lab !== null) lab.dispose()
    await withTimeout('收掉子进程', killChildren(), 20_000)
    const tmp = resources.tmp
    resources.tmp = null
    if (tmp === null) return
    // `--keep` 保留临时目录给人工查看；被信号打断时 `keepTmpDir` 已改成 false，一律收干净。
    if (keepTmpDir) {
      if (!asJson) console.log(`临时目录保留：${tmp}`)
    } else await fs.rm(tmp, { recursive: true, force: true })
  })()
  return disposal
}

/** 被 Ctrl-C / SIGTERM 打断：收干净，再用约定俗成的退出码退（130 / 143）。 */
async function onSignal(signal) {
  if (shuttingDown) return
  shuttingDown = true
  keepTmpDir = false
  process.stderr.write(`\nverify-clean-profile: 收到 ${signal}，正在回收 chromium、隔离实例与临时目录…\n`)
  await disposeResources()
  process.exit(signal === 'SIGINT' ? 130 : 143)
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void onSignal(signal))
// 兜底（信号之外的意外路径）：退出前把子进程打掉，别留孤儿。
process.on('exit', () => {
  for (const child of resources.children) if (child.exitCode === null) child.kill('SIGKILL')
})

async function main() {
  assertBuildArtifacts()
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-clean-profile-'))
  resources.tmp = tmp
  const dshHome = path.join(tmp, 'dsh-home')
  await fs.mkdir(dshHome, { recursive: true })
  const gatewayPort = await freePort()

  try {
    if (!asJson) console.log(`临时 DSH_HOME: ${dshHome}\ndsh 端口: ${gatewayPort}`)

    // 1) 把自有插件包与宿主半装进干净 profile（file: 安装，与发布后的安装路径一致）。
    const pkgs = await pluginPackages()
    record('仓库里至少有 1 个自有插件包（packages/* 声明了 dsh.client）', pkgs.length > 0, pkgs.length === 0 ? '' : pkgs.map((dir) => path.basename(dir)).join(', '))
    const specs = [...pkgs.map((dir) => `file:${dir}`), `file:${path.join(PACKAGES_DIR, HOST_HALF)}`]
    const add = spawnSync('dsh', ['plugin', '--profile', 'web', 'add', ...specs], {
      encoding: 'utf8',
      env: { ...process.env, DSH_HOME: dshHome },
    })
    record('装包进干净 profile（dsh plugin add）', add.status === 0, add.status === 0 ? '' : `${add.stdout ?? ''}${add.stderr ?? ''}`.slice(-400))
    if (add.status !== 0) return 1

    // 2) 起隔离网关（独立端口、不开浏览器、跑完按 PID 收掉；不写用户的 dsh-owned.json，
    //    DSH_HOME 指向临时目录）。
    const child = spawnChild('dsh', ['web', '--host', '127.0.0.1', '--port', String(gatewayPort), '--no-open'], {
      env: { ...process.env, DSH_HOME: dshHome },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const readyLine = await new Promise((resolve) => {
      let buf = ''
      const timer = setTimeout(() => resolve(null), 120_000)
      child.stdout.on('data', (data) => {
        buf += data
        const matched = /dsh web: (https?:\/\/\S+)/.exec(buf)
        if (matched !== null) {
          clearTimeout(timer)
          resolve(matched[1])
        }
      })
      child.on('close', () => {
        clearTimeout(timer)
        resolve(null)
      })
    })
    record('干净实例起得来（就绪行带 launch token）', readyLine !== null)
    if (readyLine === null) return 1
    const readyUrl = new URL(readyLine)
    const gateway = `${readyUrl.protocol}//${readyUrl.host}`
    const token = readyUrl.searchParams.get('token')

    // 3) 起装配页服务（仓库真实模块：labServer + wireFilter + mirror）。
    const labModule = await import(path.join(ROOT, 'test', 'assembly-lab', 'labServer.ts'))
    const lab = await labModule.startLabServer({
      gateway,
      token,
      log: labModule.consoleLogger(true),
      pluginsDir: path.join(ROOT, 'dist', 'assembly', 'plugins'),
      port: 0,
    })
    resources.lab = lab

    // 4) 先核这条门禁的**前提**：干净 profile 上的 wire 真的被切成了多个 application
    //    批（不然这条门禁是空的——判据没了落点，也必须红）。
    const wire = await lab.gatewayWire()
    const appBatches = wire.batches.filter((batch) => batch.phase === 'application')
    record(
      `干净 profile 的 wire 被切成了多个 application 批（本条门禁的前提；实测 ${String(appBatches.length)} 批：${appBatches.map((batch) => batch.entries.length).join(' + ')} 条）`,
      appBatches.length >= 2,
      appBatches.map((batch) => batch.entries.slice(0, 2).join(',')).join(' | '),
    )

    // 5) 逐棵树打开：页面必须组装得出来（filterWire + mirror 不报错）并且装得起来。
    const browser = await chromium.launch({ handleSIGINT: false, handleSIGTERM: false })
    resources.browser = browser
    for (const tree of TREES) {
      const context = await browser.newContext({ viewport: tree.viewport })
      const page = await context.newPage()
      const pageErrors = []
      const consoleErrors = []
      page.on('pageerror', (error) => pageErrors.push(String(error)))
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text())
      })
      const currentErrors = () => [...pageErrors, ...consoleErrors].join('\n')
      let status = 0
      let body = ''
      let booted = false
      try {
        const response = await page.goto(`${lab.origin}/${tree.route}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        status = response?.status() ?? 0
        if (status !== 200) body = (await page.content()).slice(0, 300)
        else {
          await page.waitForSelector(tree.ready, { timeout: 30_000 })
          booted = true
        }
      } catch {
        /* 没就绪：下面的断言按现场信息判 */
      }
      const errors = currentErrors()
      const duplicate = /duplicate graph entry/.test(errors)
      const filterFail = /blocklist entries/.test(errors) || /blocklist entries/.test(body)
      record(
        `${tree.route}：装配页组装得出来（HTTP 200，过滤管道没抛错）`,
        status === 200 && !filterFail,
        status === 200 ? '' : body || '（页面没返回 200）',
      )
      record(`${tree.route}：没有同 id 重复叠加（duplicate graph entry）`, !duplicate, duplicate ? errors.slice(0, 200) : '')
      if (booted) {
        record(`${tree.route}：页面装起来了（就绪选择器 ${tree.ready} 出现）`, true)
      } else {
        const known = KNOWN_BLOCKERS.find(
          (blocker) => blocker.trees.includes(tree.route) && blocker.match.test(errors),
        )
        if (known !== undefined) {
          note(`${tree.route}：被已知阻断项 ${known.issue} 挡住（${known.why}）——不属本条门禁`, errors.split('\n')[0]?.slice(0, 160))
        } else {
          record(`${tree.route}：页面装起来了（就绪选择器 ${tree.ready} 出现）`, false, errors.slice(0, 400) || '没就绪')
        }
      }
      await context.close()
    }

    // 已知阻断项修好之后，例外表就该删——这里主动提示，避免它静默留着。
    for (const blocker of KNOWN_BLOCKERS) {
      const stillBlocked = evidence.some((item) => item.note === true && item.name.includes(blocker.issue))
      if (!stillBlocked) note(`例外表里的 ${blocker.issue} 已经不再触发，可以从 KNOWN_BLOCKERS 里删掉`, blocker.why)
    }
    return failures.length === 0 ? 0 : 1
  } finally {
    // 被信号打断时收尾归 onSignal 管（它会等收尾真跑完再退），这里不再插一脚：两边同时收
    // 会互相抢资源，抢着退的那一边会把还在删目录的另一边打断（#190 实测就是这么留下目录的）。
    if (!shuttingDown) await disposeResources()
  }
}

let code = 1
try {
  code = await main()
} catch (error) {
  // 被信号打断时，收尾会让在途操作（页面、请求）报错——那不是这一轮的结论：退出码由
  // onSignal 定（130 / 143），这里咽掉它；真出别的事照旧往外抛（未捕获异常、按 1 退）。
  if (!shuttingDown) throw error
}

// 被信号打断就到此为止：onSignal 还在收尾，收完它会自己退，别抢在它前面退，也别把
// 这一轮打印成「失败」。
if (!shuttingDown) {
  if (asJson) {
    console.log(JSON.stringify({ evidence, failures }, null, 2))
  } else {
    console.log(`\n${failures.length === 0 ? '全部通过' : `失败 ${String(failures.length)} 条：${failures.join(' / ')}`}`)
  }
  process.exit(code)
}
