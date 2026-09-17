#!/usr/bin/env node
/**
 * 官方 web 真机实测（#73）：在**隔离的临时 HOME + 临时 profile** 里把自有插件包装进
 * profile，起一个**独立端口的真 dsh web 实例**，用 Playwright 打开**官方页面本身**
 * （不是我们的装配页），核对插件真的被官方加载并工作。
 *
 * 为什么必须是真环境：包能不能被官方认，取决于官方三件事各自成立——
 *   ① `dsh plugin add` 认 `dsh.bundle` 把包并进 profile 的层列表；
 *   ② 官方 loader 认包清单的主入口，把行挂进树；
 *   ③ 官方 client-modules 扫行里的 `dsh.client`，把 `exports["./client"]` 的 bundle
 *      并进 `__DSH_BOOT__` 与 combo 段，浏览器侧才有东西加载。
 * 这三件事只有真 dsh 进程 + 真浏览器能回答。这条脚本把它们跑成可复现的证据。
 *
 * 它与另外两条验证线的关系：装配实验室（`npm run verify:lab`）验的是**我们的装配页**
 * （自有 shell + block list + 自有插件叠加），这条验的是**官方页面**（官方全家桶 +
 * 我们装进 profile 的包），两者不互相替代。VS Code 验证仍是宿主层的最终准绳。
 *
 * 模型用仓库自带的假端点（`test/mock-llm/`）：真 dsh 走全部真实逻辑，只有模型响应
 * 是按固定场景回的。这样脚本能造出「含提交号的助手消息」与「含行内码的助手消息」，
 * 而不用任何真实凭据。
 *
 * **隔离保证**：全程 `HOME=<临时目录>`（dsh 的 profile、会话、状态文件全部落在临时
 * HOME 里），不碰用户的 `~/.dsh`、不碰正在跑的 dsh 实例；端口默认现取空闲的；
 * 临时目录结束后删除（`--keep` 保留供人工查看）；起的进程与 chromium 用完即收。
 *
 * 用法：
 *   node scripts/verify-plugins-official.mjs [--keep] [--port 3399] [--json]
 *
 * 退出码：0 = 全部断言通过；1 = 有断言失败（输出里标出哪一条）；
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
const portArg = args.indexOf('--port')

const ROOT = path.resolve(import.meta.dirname, '..')
const PACKAGES_DIR = path.join(ROOT, 'packages')
const HOST_HALF = 'dsh-host-capabilities'
/** 假端点的模型名与场景关键词（与 `test/mock-llm/scenario.ts` 的规则一致）。 */
const MOCK_KEY_ENV = 'DSH_ONE_VERIFY_MOCK_KEY'
const PROMPT_COMMIT = 'commit 演示'
const PROMPT_INLINE_CODE = '行内码路径'
/**
 * 演示仓库的提交号：由固定的 author/日期/内容/提交信息决定（与 `test/mock-llm`
 * 的「commit 演示」规则文本、`test/sandbox/entrypoint.sh` 的兜底演示仓库同一份）。
 * 改任一创建参数都会失配——三处必须同步改。
 */
const DEMO_SHA = 'cb1f933e15289a00e30865e8dd3963ba90a96780'

const evidence = []
const failures = []

function record(name, ok, detail) {
  evidence.push({ name, ok, detail })
  if (!ok) failures.push(name)
  if (!asJson) console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

/** 现取一个空闲端口（不撞用户正在跑的 dsh）。 */
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

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { encoding: 'utf8', ...options })
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(' ')} failed (${String(result.status)}):\n${result.stdout}\n${result.stderr}`)
  }
  return result.stdout
}

/** 本次实测要装进 profile 的插件包（读包清单，不硬编码清单——新增包自动纳入）。 */
async function pluginPackages() {
  const found = []
  for (const dir of (await fs.readdir(PACKAGES_DIR)).sort()) {
    const pkgDir = path.join(PACKAGES_DIR, dir)
    const manifest = JSON.parse(await fs.readFile(path.join(pkgDir, 'package.json'), 'utf8'))
    if (manifest.dsh?.client !== undefined) found.push({ dir: pkgDir, name: manifest.name })
  }
  return found
}

let PORT = 0

/**
 * 本次运行起过的东西（chromium、子进程）与临时目录。放在模块级，是为了让**信号处理**
 * 也看得见它们：`chromium.launch()` 默认带 `handleSIGINT` / `handleSIGTERM`，Playwright
 * 自己也装了一对信号处理，收到信号就关掉浏览器然后 `process.exit(130)`——`main()` 的
 * `finally`（关 chromium、收子进程、删临时目录）一句都跑不到，进程按 130 退掉、临时目录
 * 留在原地（#190 实测）。现在两个开关都关掉，收尾统一由这里的 `onSignal` 负责。
 */
const resources = { browser: null, children: [], tmp: null }
/** 已经进了收尾流程（信号打断会直接退进程，别让收尾跑第二遍）。 */
let shuttingDown = false
/** `--keep`：跑完保留临时目录供人工查看；被信号打断时改成 false（一律收干净，不留半截现场）。 */
let keepTmpDir = keep

const spawnChild = (command, commandArgs, options = {}) => {
  const child = spawn(command, commandArgs, { detached: false, ...options })
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
            `verify-plugins-official: ${step} 失败：${error instanceof Error ? error.message : String(error)}\n`,
          )
        },
      ),
      new Promise((resolve) => {
        timer = setTimeout(() => {
          process.stderr.write(`verify-plugins-official: ${step} 超过 ${String(ms / 1000)} 秒没结束，不再等它。\n`)
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
  await new Promise((resolve) => setTimeout(resolve, 800))
  for (const child of resources.children) {
    if (child.exitCode === null) child.kill('SIGKILL')
  }
}

/**
 * 收尾：关 chromium、按 PID 收子进程、删临时目录。正常跑完与信号打断都会调它，两条路共享
 * 同一个在途 promise——被打断的那一瞬 `main()` 的 `finally` 可能也刚起来，只收一次，后到的
 * 那条等前一条收完，免得「一边还在删临时目录、另一边已经退进程」（退早了目录就留在原地）。
 */
let disposal = null
function disposeResources() {
  disposal ??= (async () => {
    const browser = resources.browser
    resources.browser = null
    if (browser !== null) await withTimeout('关闭 chromium', browser.close(), 15_000)
    await withTimeout('收掉子进程', killChildren(), 20_000)
    const tmp = resources.tmp
    resources.tmp = null
    if (tmp === null) return
    // `--keep` 保留临时目录给人工查看；被信号打断时 `keepTmpDir` 已改成 false，一律收干净。
    if (keepTmpDir) console.log(`保留临时目录：${tmp}`)
    else await fs.rm(tmp, { recursive: true, force: true })
  })()
  return disposal
}

/** 被 Ctrl-C / SIGTERM 打断：收干净，再用约定俗成的退出码退（130 / 143）。 */
async function onSignal(signal) {
  if (shuttingDown) return
  shuttingDown = true
  keepTmpDir = false
  process.stderr.write(`\nverify-plugins-official: 收到 ${signal}，正在回收 chromium、隔离实例与临时目录…\n`)
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
  PORT = portArg >= 0 ? Number(args[portArg + 1]) : await freePort()
  const mockPort = await freePort()
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-plugins-verify-'))
  resources.tmp = tmp
  const home = path.join(tmp, 'home')
  const work = path.join(tmp, 'work')
  await fs.mkdir(home, { recursive: true })
  await fs.mkdir(work, { recursive: true })
  if (!asJson) console.log(`临时 HOME: ${home}\ndsh 端口: ${PORT}\n假模型端口: ${mockPort}`)

  const pkgs = await pluginPackages()
  record(
    '仓库里至少有 1 个自有插件包（packages/* 声明了 dsh.client）',
    pkgs.length > 0,
    pkgs.map((p) => p.name).join(', '),
  )
  const clientPkgs = pkgs.filter((p) => p.name !== `@dsh-one/${HOST_HALF}`)
  let browser = null

  try {
    // 0) 假模型端点 + 隔离 HOME 的模型配置：真 dsh 走全部真实逻辑，只有模型响应
    //    按固定场景回。没有它，「含提交号的助手消息」这类夹具就造不出来。
    const mockLog = await fs.open(path.join(tmp, 'mock-llm.log'), 'w')
    spawnChild('node', [path.join(ROOT, 'test', 'mock-llm', 'server.ts'), '--port', String(mockPort)], {
      stdio: ['ignore', mockLog.fd, mockLog.fd],
    })
    await fs.mkdir(path.join(home, '.dsh'), { recursive: true })
    await fs.writeFile(
      path.join(home, '.dsh', 'settings.yaml'),
      [
        'agent-default-model:',
        '  provider: mock-llm',
        '  model: mock-flash',
        'llm-pi-ai:',
        '  providers:',
        '    mock-llm:',
        `      baseURL: "http://127.0.0.1:${String(mockPort)}/v1"`,
        '      api: "openai-completions"',
        `      apiKeyEnv: ${MOCK_KEY_ENV}`,
        '      displayName: "Mock LLM"',
        '      models:',
        '        - id: mock-flash',
        '          name: mock-flash',
        '          contextWindow: 128000',
        '          maxTokens: 8192',
        '          input: ["text"]',
        '',
      ].join('\n'),
    )
    const mockReady = await waitForHttp(`http://127.0.0.1:${String(mockPort)}/v1/models`)
    record('假模型端点起来了（真 dsh 的模型请求打到它）', mockReady)

    // 1) 演示仓库：固定 author/日期/内容的单提交仓库，提交号与假模型规则文本对上。
    run('git', ['init', '-q'], { cwd: work })
    await fs.writeFile(path.join(work, 'README.md'), 'demo content\n')
    run('git', ['add', 'README.md'], { cwd: work })
    const gitEnv = {
      ...process.env,
      GIT_AUTHOR_NAME: 'Demo Author',
      GIT_AUTHOR_EMAIL: 'demo@example.com',
      GIT_AUTHOR_DATE: '2026-09-03T10:00:00+08:00',
      GIT_COMMITTER_NAME: 'Demo Author',
      GIT_COMMITTER_EMAIL: 'demo@example.com',
      GIT_COMMITTER_DATE: '2026-09-03T10:00:00+08:00',
    }
    run('git', ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'feat(demo): 初始提交', '-m', '这是 body 第二行。'], {
      cwd: work,
      env: gitEnv,
    })
    const sha = run('git', ['rev-parse', 'HEAD'], { cwd: work }).trim()
    record('演示仓库的提交号与假模型规则文本对上', sha === DEMO_SHA, sha)

    // 2) 装包进临时 profile——用 `file:` 安装（pnpm 会把包拷进 profile 的
    //    node_modules 并一起装上它声明的依赖，与发布后的安装路径一致；`link:`
    //    不会装依赖）。宿主半一起装：git 卡片与工作区树的状态读写要它在网关侧。
    const specs = [...pkgs.map((p) => `file:${p.dir}`), `file:${path.join(PACKAGES_DIR, HOST_HALF)}`]
    run('dsh', ['plugin', '--profile', 'web', 'add', ...specs], { env: { ...process.env, HOME: home } })

    const profileDir = path.join(home, '.dsh', 'profiles', 'web')
    const profileManifest = JSON.parse(await fs.readFile(path.join(profileDir, 'package.json'), 'utf8'))
    const bundles = profileManifest.dsh?.profile?.bundles ?? []
    for (const pkg of pkgs) {
      record(`${pkg.name} 进了 profile 的层列表（dsh.profile.bundles）`, bundles.includes(pkg.name))
    }
    record('宿主半一起装进 profile', bundles.includes(`@dsh-one/${HOST_HALF}`))
    const missingArtifacts = []
    for (const pkg of clientPkgs) {
      const present = await fs
        .stat(path.join(profileDir, 'node_modules', ...pkg.name.split('/'), 'lib', 'client.js'))
        .then(() => true)
        .catch(() => false)
      if (!present) missingArtifacts.push(pkg.name)
    }
    record('每个插件包的浏览器侧产物都进了 profile', missingArtifacts.length === 0, missingArtifacts.join(', '))

    // 3) 起真 dsh web（独立端口），等 ready 行拿 launch token。
    const logFile = path.join(tmp, 'dsh.log')
    const logHandle = await fs.open(logFile, 'w')
    const child = spawnChild('dsh', ['web', '--host', '127.0.0.1', '--port', String(PORT), '--no-open'], {
      env: { ...process.env, HOME: home, [MOCK_KEY_ENV]: 'mock-key-1' },
      stdio: ['ignore', logHandle.fd, logHandle.fd],
    })
    browser = await chromium.launch({ handleSIGINT: false, handleSIGTERM: false })
    resources.browser = browser

    const readyLine = await waitForReady(logFile)
    const logText = await fs.readFile(logFile, 'utf8').catch(() => '')
    record(
      '真 dsh web 实例起来了（隔离 HOME + 独立端口）',
      readyLine !== null,
      readyLine ?? logText.split('\n').slice(0, 5).join(' | ').slice(0, 400),
    )
    if (readyLine === null) throw new Error('dsh 未就绪')
    const token = /token=([A-Za-z0-9_-]+)/.exec(readyLine)?.[1]
    if (token === undefined) throw new Error('就绪行里没有 launch token')
    const cookie = await mintCookie(token)

    // 4) 夹具：官方 UI 要有「一个工作区 + 一个会话」才会渲染对话区与侧栏树。
    //    走官方网关自己的 RPC（与官方客户端同一条路），不打开任何系统对话框。
    const workspace = (await rpc(cookie, 'workspace/create', { request: { path: work } })).payload?.workspace
    const sessionId = (
      await rpc(cookie, 'session/create', { request: { workspaceId: workspace?.workspaceId } })
    ).payload?.sessionId
    record('夹具：官方网关接受了临时工作区与会话', typeof sessionId === 'string' && sessionId !== '', String(sessionId))

    // 5) 打开**官方页面本身**（不是我们的装配页），收网络与控制台证据。
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const pageErrors = []
    const consoleErrors = []
    const pluginRequests = []
    const hostHalfCalls = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('request', (request) => {
      const url = request.url()
      if (url.includes('/plugins/')) pluginRequests.push(url)
      const call = /\/api\/(dshOneHostCapabilities\/[A-Za-z]+)/.exec(url)
      if (call !== null) hostHalfCalls.push(call[1])
    })
    await page.goto(`http://127.0.0.1:${String(PORT)}/?token=${token}`, { waitUntil: 'load' })
    await page.waitForFunction(() => document.querySelector('[data-slot="conversation.composer.bar"]') !== null, undefined, {
      timeout: 60_000,
    })
    await page.waitForTimeout(2000)

    // 5a) 官方装载面：每个自有包都在 `__DSH_BOOT__` 的行里，而且真的被请求过
    //     （包进 profile ≠ 加载；行在 wire 里 ≠ 浏览器取了那份 bundle）。
    const bootIds = await page.evaluate(() => globalThis.__DSH_BOOT__.entries.map((entry) => entry.id))
    for (const pkg of clientPkgs) {
      record(`${pkg.name} 进了官方 __DSH_BOOT__ 行`, bootIds.includes(pkg.name))
      record(
        `${pkg.name} 的 combo 段被官方页面真的请求了`,
        pluginRequests.some((url) => url.includes(`${pkg.name}/client.js`)),
      )
    }

    // 5b) 装载层零失败：官方 web 的启动审计会把「条目没激活」整块抛出来。
    const bootFailure = await page.evaluate(() => document.body.innerText.includes('Failed to load plugins'))
    record('页面没有「Failed to load plugins」（官方启动审计全过）', !bootFailure)

    // 6) 端到端行为证据：官方页面上这些自有插件真的在工作。
    await dismissOfficialOnboarding(page)
    await assertComposerClear(page)
    await assertWorkspaceTree(page)

    // 6a) 一轮真回合（假模型）：消息落下后才有的证据——会话头、提交卡、行内码菜单。
    await sendTurn(page, PROMPT_COMMIT, 'cb1f933e')
    await assertGitCard(page, hostHalfCalls)
    await assertSessionExport(page)
    await sendTurn(page, PROMPT_INLINE_CODE, 'sessionsWebview.ts')
    await assertContextMenu(page)

    record('页面零 pageerror', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
    record('页面零 console error', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))

    if (!asJson) {
      const shot = path.join(tmp, 'official-web.png')
      await page.screenshot({ path: shot })
      console.log(`官方页面截图：${shot}`)
    }
  } finally {
    // 被信号打断时收尾归 onSignal 管（它会等收尾真跑完再退），这里不再插一脚：两边同时收
    // 会互相抢资源，抢着退的那一边会把还在删目录的另一边打断（#190 实测就是这么留下目录的）。
    if (!shuttingDown) await disposeResources()
  }

  if (asJson) console.log(JSON.stringify({ evidence, failures }, null, 2))
  else {
    console.log(`\n${failures.length === 0 ? '全部通过' : `失败 ${String(failures.length)} 项`}（${String(evidence.length)} 项断言）`)
    if (failures.length > 0) console.log(`失败项：${failures.join('；')}`)
  }
  process.exitCode = failures.length === 0 ? 0 : 1
}

/**
 * 关掉官方首启引导：临时 HOME 是新装的，官方会先弹「测试期声明」和「配 API key」
 * 两个模态，不关掉它们会拦住后面所有点击。本脚本不配任何真实凭据，所以一律走
 * 「稍后配置」那条路。
 */
async function dismissOfficialOnboarding(page) {
  for (const name of [/^Continue$/, /^Configure later$/]) {
    const button = page.getByRole('button', { name })
    if ((await button.count()) > 0) {
      await button
        .first()
        .click({ timeout: 5000 })
        .catch(() => {})
      await page.waitForTimeout(1000)
    }
  }
  await page.waitForTimeout(500)
}

/** 在官方 composer 里发一轮（真 dsh + 假模型），等助手消息落下。 */
async function sendTurn(page, prompt, expectText) {
  const input = page.locator('[data-slot="conversation.composer.bar"] [contenteditable="true"]').first()
  await input.click()
  await page.keyboard.type(prompt)
  await page.keyboard.press('Enter')
  await page.getByText(expectText).first().waitFor({ timeout: 90_000 })
  await page.waitForTimeout(1500)
  // 收掉「已清空」提示的残留（清空件在上一节动过 composer）。
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
}

/** 端到端：清空件——输入正文 → Esc ×2 出提示 → 清空生效 → Ctrl+Z 反悔还原。 */
async function assertComposerClear(page) {
  const HINT = '[data-dshone-clear-hint]'
  const text = 'dsh-one official web verify'
  const input = page.locator('[data-slot="conversation.composer.bar"] [contenteditable="true"]').first()
  await input.click()
  await page.keyboard.type(text)
  await page.waitForTimeout(300)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await page.keyboard.press('Escape')
  const hint = await page
    .waitForSelector(HINT, { timeout: 5000 })
    .then((handle) => handle.getAttribute('data-dshone-clear-hint'))
    .catch(() => null)
  record('清空件：Esc ×2 后官方 composer 里出现自有提示（slot 条目真的渲染了）', hint !== null, String(hint))
  const cleared = await composerText(page)
  record('清空件：第二次 Esc 真的清空了草稿（走官方 inputActions.setDraft）', cleared === '', JSON.stringify(cleared))
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(500)
  const restored = await composerText(page)
  record('清空件：Ctrl+Z 反悔把正文还原回来', restored === text.replace(/\s+/g, ''), JSON.stringify(restored))
  // 收尾：把草稿清掉，别让后续的回合看到脏输入。
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
}

/** 端到端：会话导出——同一座位里官方同名条目被 shadow，渲染出来的是自有按钮。 */
async function assertSessionExport(page) {
  const ours = await page.locator('[data-dshone-export]').count()
  record('会话导出：官方会话头里渲染的是自有按钮（[data-dshone-export] 在场）', ours === 1, `count=${String(ours)}`)
  // 官方 `@deepseek-ai/dsh-session-log-export` 渲染的是一个**只有图标**的按钮，可及名
  // 是它词典里的 `header.more`（en「More actions」/ zh「更多操作」）。同名条目被 shadow
  // 之后它整个不渲染——这条断言就是「按 id 的 shadow 生效」的直接证据。
  const officialMore = await page
    .locator('[data-slot="conversation.session.header.utilities"] button[aria-label]')
    .evaluateAll((els) => els.filter((el) => /More actions|更多操作/.test(el.getAttribute('aria-label') ?? '')).length)
  record('会话导出：同座位的官方同名条目不再渲染（list slot 按 id 的 shadow 生效）', officialMore === 0, `官方图标按钮数=${String(officialMore)}`)
}

/** 端到端：工作区树——官方 sidebar.workspaces 座位里渲染的是自有树。 */
async function assertWorkspaceTree(page) {
  const rows = await page.locator('[data-slot="sidebar.workspaces"] [data-dshone-tree-row="workspace"]').count()
  record('工作区树：官方 sidebar.workspaces 座位里渲染的是自有树的行', rows >= 1, `rows=${String(rows)}`)
  const filter = await page.locator('[data-dshone-tree="group-filter"]').count()
  record('工作区树：自有分组过滤条在场（官方 web 侧用的是同一份组件）', filter >= 1, `count=${String(filter)}`)
}

/**
 * 端到端：提交卡——消息里的提交号被装饰，悬停出卡片，卡片内容来自**宿主半**的
 * git 查询（走官方网关 RPC）。这条同时证明「插件 + 宿主半」两端都在官方侧跑通了。
 */
async function assertGitCard(page, hostHalfCalls) {
  const chip = page.locator('[data-dshone-commit]').first()
  const decorated = await chip.count()
  record('提交卡：助手消息里的提交号被装饰成可点标记', decorated === 1, `count=${String(decorated)}`)
  if (decorated === 0) return
  await chip.hover()
  const card = page.locator('[data-dshone-git-card]').first()
  const appeared = await card
    .waitFor({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false)
  record('提交卡：悬停弹出卡片', appeared)
  if (!appeared) return
  // 卡片先渲染「查询中」，宿主半的回执到了才换成提交信息——等它换过来再读。
  const settled = await page
    .waitForFunction(
      () => {
        const el = document.querySelector('[data-dshone-git-card]')
        return el !== null && el.querySelector('.dshOneGitCard_subject') !== null
      },
      undefined,
      { timeout: 20_000 },
    )
    .then(() => true)
    .catch(() => false)
  const text = (await card.innerText()).replace(/\s+/g, ' ')
  record(
    '提交卡：卡片内容来自宿主半的 git 查询（出现演示仓库的提交信息）',
    settled && text.includes('feat(demo)'),
    text.slice(0, 140),
  )
  record(
    '提交卡：查询走的是宿主半的官方网关端点（dshOneHostCapabilities/gitShow）',
    hostHalfCalls.includes('dshOneHostCapabilities/gitShow'),
    hostHalfCalls.join(', '),
  )
  await page.mouse.move(0, 0)
  await page.waitForTimeout(300)
}

/** 端到端：行内码右键菜单——助手消息里的行内码右键出官方 Menu 原语的菜单。 */
async function assertContextMenu(page) {
  const code = page.locator('code').filter({ hasText: 'sessionsWebview.ts' }).first()
  if ((await code.count()) === 0) {
    record('行内码右键菜单：消息里找到了行内码（夹具）', false)
    return
  }
  await code.click({ button: 'right' })
  const menu = page.locator('[data-dshone-menu]').first()
  const opened = await menu
    .waitFor({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false)
  record('行内码右键菜单：右键行内码弹出自有菜单（官方 Menu 原语）', opened)
  const marked = await page.locator('[data-dshone-menu-target]').count()
  record('行内码右键菜单：被点的行内码被高亮标记', marked === 1, `count=${String(marked)}`)
  if (opened) {
    const items = await menu.locator('[role="menuitem"]').count()
    record('行内码右键菜单：菜单里有官方 Menu 渲染出来的菜单项', items >= 1, `items=${String(items)}`)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  }
}

/** composer 里的纯文本（官方编辑器是 contenteditable，读 innerText 即所见内容）。 */
async function composerText(page) {
  return await page
    .locator('[data-slot="conversation.composer.bar"] [contenteditable="true"]')
    .first()
    .innerText()
    .then((text) => text.replace(/[\u200b\s]+/g, ''))
    .catch(() => null)
}

/** 轮询 dsh 日志等就绪行（`dsh web: http://127.0.0.1:<port>/?token=…`）。 */
async function waitForReady(logFile, timeoutMs = 120_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const text = await fs.readFile(logFile, 'utf8').catch(() => '')
    const line = /dsh web: http:\/\/127\.0\.0\.1:\d+\/[^\s]*/.exec(text)
    if (line !== null) return line[0]
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return null
}

/** 轮询一个本地 URL 直到它给出非 5xx（起假模型端点后用）。 */
async function waitForHttp(url, timeoutMs = 20_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.status < 500) return true
    } catch {
      // 还没起来，继续轮询
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  return false
}

/** 用 launch token 换 cookie（官方浏览器会话鉴权；token 本身不能调 API）。 */
async function mintCookie(token) {
  const response = await fetch(`http://127.0.0.1:${String(PORT)}/?token=${token}`, { redirect: 'manual' })
  const setCookie = response.headers.getSetCookie?.() ?? []
  const cookie = setCookie.map((value) => value.split(';')[0]).join('; ')
  if (cookie === '') throw new Error(`token 换 cookie 失败（HTTP ${String(response.status)}）`)
  return cookie
}

/** 调一次官方网关 RPC（与官方客户端同一条线形态：client-request 信封 + { args } 载荷）。 */
async function rpc(cookie, method, argsObject) {
  const response = await fetch(`http://127.0.0.1:${String(PORT)}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ type: 'client-request', rpcId: `verify-${String(Date.now())}`, method, payload: { args: argsObject } }),
  })
  const body = await response.json().catch(() => null)
  const result = body?.result
  return { status: response.status, payload: result?.ok === true ? result.value : null, raw: body }
}

try {
  await main()
} catch (error) {
  // 被信号打断时，收尾会让在途操作（页面、请求）报错——那不是这一轮的结论：退出码由
  // onSignal 定（130 / 143），这里咽掉它；真出别的事照旧往外抛（未捕获异常、按 1 退）。
  if (!shuttingDown) throw error
}
