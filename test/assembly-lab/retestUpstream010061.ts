/**
 * 上游两条遗留 issue 的**复测装置**（#10 / #61）——一次性探针，不进套件集。
 *
 * 跑法（在装了 Playwright 的仓库里）：
 *
 *   node test/assembly-lab/retestUpstream010061.ts
 *   PATH=<临时装的 dsh 的 bin>:$PATH node test/assembly-lab/retestUpstream010061.ts
 *
 * 它自己起一台**隔离实例**（`labGateway.ts` 那条路：临时 `DSH_HOME` + 随机端口 +
 * `--no-open`），播种出真数据，然后：
 *
 * - **#61「打开正在运行的会话卡在『载入历史…』」**：把官方页直接开到播种出来的
 *   「运行中」会话上（`dsh.sessions.current` 恢复键），也走一遍当初的复现路径
 *   （先落空闲会话、再点侧栏里那一行），量「载入历史…」到历史出现的时长；
 *   同一会话在装配页（`/chat`）上再量一遍当对照。
 * - **#10「聊天事件流静默卡死」**：官方页与装配页各开一条有历史的空闲会话，
 *   记下基线行数；然后**重启网关实例**（按 PID 收掉旧进程、同一 `DSH_HOME` 与端口
 *   重起一个新进程——启动 token 每次进程现取，但浏览器 cookie 由 `DSH_HOME` 里持久化的
 *   签名密钥签出，所以旧页面的 cookie 在重启后仍然有效，这正是当年那场事故的处境），
 *   观察页面上有没有恢复/重连提示，再经官方 RPC 往那条会话发一条新提示词，看新内容
 *   会不会渲染出来（渲染不出来 = 静默卡死）。
 *
 * 为什么这个装置能成立的几条事实（都从官方代码核过，改版本时先复核）：
 * - 启动 token 是**每进程**现取的随机值（`dsh-client-connection/lib/index.js` 的
 *   `processLaunchToken`），重启后必然变；而**浏览器 cookie 的签名密钥**是持久化在
 *   `DSH_HOME` 的凭据记录里的（同文件 `initializeSecret`），所以旧标签页的 cookie
 *   在重启后照样通过校验——旧页面不会因为 401 被踢出去，才会「静默」。
 * - 恢复提示的文案来自官方 `@deepseek-ai/dsh-client-ui-settings-general` 的词典
 *   （`connection.error` / `connection.connecting` / `connection.connected` /
 *   `connection.reconnect` / `connection.restart`），渲染在设置栏那一枚
 *   `ConnectionIndicator` 上；它只在**宽**档设置栏里渲染（`state: wide ? … : void 0`）。
 * - 聊天区「载入历史…」= 官方 `ui-chat` 词典的 `chat.loadingHistory`，只在
 *   `openState === 'loading'` 时渲染；消息行是 `[data-chat-flow] > [data-chat-flow-key]`
 *   （官方自己量行数用的就是这条选择器，见 `ui-chat/lib/client.js` 的 `loadThrough`）。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, BrowserContext, Page } from 'playwright'
import { cookieHeader } from '../../src/server/assemblyMirror.ts'
import { createSession, listSessions, promptSession, renameSession, sessionCompletedTurns } from '../../src/server/dshRpc.ts'
import { capturePage, launchBrowser, openTreePage, type PageCapture } from './harness.ts'
import { portListening, startLabGateway, type LabGateway } from './labGateway.ts'
import { consoleLogger, defaultPluginsDir, LAB_TREES, startLabServer, type LabServer } from './labServer.ts'

const LAB_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.join(LAB_DIR, '..', '..')

/**
 * 本次运行的产物目录。`--label <名字>` 给一份子目录名（默认按 dsh 版本猜），
 * 于是同一台机器上跑 alpha.1 与 alpha.2 两次，截图与报告各归各的、不会互相覆盖。
 */
const LABEL_ARG = ((): string | undefined => {
  const index = process.argv.indexOf('--label')
  return index >= 0 ? process.argv[index + 1] : undefined
})()
const OUT_DIR = path.join(LAB_DIR, 'out', 'upstream-010-061', LABEL_ARG ?? 'run')

/** 隔离实例起进程时给 `apiKeyEnv` 的那个值（与 `labGateway.ts` 里同一份，重启时要照给）。 */
const MOCK_LLM_KEY = 'lab-mock-key'

/** 官方恢复/重连提示的文案（zh 页；来源见文件头的出处）。 */
const RECOVERY_LABELS = ['连接异常，刷新重试', '重新连接中', '连接成功', '连接异常，点击立即重连', '连接中断，正在重试，点击立即重连']

// ---------------------------------------------------------------------------
// 页内记录器：从导航第一刻起盯三件事（载入历史 / 历史行 / 恢复提示），
// 免得「提示只闪 2 秒」这类瞬态靠外面轮询漏掉。
// ---------------------------------------------------------------------------

const RECORDER_SOURCE = `(${String(function installRecorder(): void {
  type Mark = { at: number; what: string; detail: string }
  const record = {
    t0: Date.now(),
    marks: [] as Mark[],
    seen: new Set<string>(),
  }
  const mark = (what: string, detail: string): void => {
    const key = `${what}|${detail}`
    if (record.seen.has(key)) return
    record.seen.add(key)
    record.marks.push({ at: Date.now(), what, detail })
  }
  const labels = ['连接异常，刷新重试', '重新连接中', '连接成功', '连接异常，点击立即重连', '连接中断，正在重试，点击立即重连']
  const rowsOf = (): number => document.querySelectorAll('[data-chat-flow] > [data-chat-flow-key]:not(:empty):not([hidden])').length
  const tick = (): void => {
    const text = document.body === null ? '' : document.body.innerText
    if (document.querySelector('[data-slot="conversation.session.header"]') !== null) mark('header', '')
    const rows = rowsOf()
    if (rows > 0) mark('history-row', String(rows))
    if (text.includes('载入历史') || text.includes('Loading history')) mark('loading-history', 'present')
    else if (record.seen.has('loading-history|present')) mark('loading-history', 'gone')
    for (const label of labels) {
      if (text.includes(label)) mark('recovery-hint', label)
    }
    for (const element of Array.from(document.querySelectorAll('[aria-label]'))) {
      const label = element.getAttribute('aria-label') ?? ''
      if (labels.includes(label)) mark('recovery-hint', label)
    }
  }
  tick()
  window.setInterval(tick, 100)
  ;(globalThis as { __RETEST__?: unknown }).__RETEST__ = record
})})()`

interface RecorderMark {
  at: number
  what: string
  detail: string
}

interface RecorderRecord {
  t0: number
  marks: RecorderMark[]
}

/** 读页内记录器（没装上返回 null）。 */
async function readRecorder(page: Page): Promise<RecorderRecord | null> {
  return await page.evaluate(() => {
    const raw = (globalThis as { __RETEST__?: { t0: number; marks: RecorderMark[] } }).__RETEST__
    return raw === undefined ? null : raw
  })
}

/** 把页内记录缩成「第几毫秒出现了什么」，人读得懂。 */
function timeline(record: RecorderRecord | null): string[] {
  if (record === null) return ['（记录器没装上）']
  return record.marks.map((mark) => `+${String(mark.at - record.t0)}ms ${mark.what}${mark.detail === '' ? '' : ` ${mark.detail}`}`)
}

/** 某一类记录第一次出现的相对时刻（毫秒；没出现返回 null）。 */
function firstAt(record: RecorderRecord | null, what: string): number | null {
  const hit = record?.marks.find((mark) => mark.what === what)
  return hit === undefined ? null : hit.at - (record?.t0 ?? 0)
}

/** 「载入历史…」从出现到消失的间隔（毫秒；一直没出现或一直没消失返回 null）。 */
function loadingGoneAt(record: RecorderRecord | null): number | null {
  const hit = record?.marks.find((mark) => mark.what === 'loading-history' && mark.detail === 'gone')
  return hit === undefined ? null : hit.at - (record?.t0 ?? 0)
}

// ---------------------------------------------------------------------------
// 开页
// ---------------------------------------------------------------------------

/**
 * 官方页（**网关 origin**，不经过我们的 mirror）：拿实验室换好的 cookie 直接进。
 *
 * 用网关 origin 而不是实验室的 `/official` 路由：判「上游问题还是我方装配层问题」要的
 * 是**一页没经过我们任何代码**的官方 GUI，而 `/official` 那一页的资产请求仍然经我们的
 * mirror（`labServer` 的注释写明了它是「同一网关、同一个浏览器里做 A/B 对照用」）。
 */
async function openOfficialPage(
  browser: Browser,
  gateway: string,
  options: { seedSession?: string } = {},
): Promise<{ context: BrowserContext; page: Page; capture: PageCapture; navigatedAt: number }> {
  const cookie = cookieHeader(gateway)
  const context = await browser.newContext({ viewport: { width: 1400, height: 950 } })
  if (cookie !== undefined) {
    const at = cookie.indexOf('=')
    await context.addCookies([
      { name: cookie.slice(0, at), value: cookie.slice(at + 1), domain: new URL(gateway).hostname, path: '/' },
    ])
  }
  if (options.seedSession !== undefined && options.seedSession !== '') {
    await context.addInitScript({
      content: `try { localStorage.setItem("dsh.sessions.current", ${JSON.stringify(JSON.stringify({ sessionId: options.seedSession }))}) } catch (error) {}`,
    })
  }
  await context.addInitScript({ content: RECORDER_SOURCE })
  const page = await context.newPage()
  const capture = capturePage(page)
  await page.goto(`${gateway}/`, { waitUntil: 'domcontentloaded' })
  return { context, page, capture, navigatedAt: Date.now() }
}

/** 装配页（`/chat` 树）：走实验室的公共入口开页，再装上记录器重载一次。 */
async function openAssemblyPage(
  browser: Browser,
  lab: LabServer,
  sessionId: string,
): Promise<{ context: BrowserContext; page: Page; capture: PageCapture; navigatedAt: number }> {
  const route = LAB_TREES.find((candidate) => candidate.route === 'chat')
  if (route === undefined) throw new Error('实验室里没有 chat 树')
  const opened = await openTreePage(browser, lab, route, { sessionId, readyTimeoutMs: 30_000 })
  await opened.context.addInitScript({ content: RECORDER_SOURCE })
  await opened.page.reload({ waitUntil: 'domcontentloaded' })
  return { context: opened.context, page: opened.page, capture: opened.capture, navigatedAt: Date.now() }
}

// ---------------------------------------------------------------------------
// 网关实例的重启
// ---------------------------------------------------------------------------

/** 收一个子进程：先 SIGTERM，`graceMs` 还不退就 SIGKILL（与 `labGateway.ts` 同口径）。 */
async function killByPid(child: ChildProcess, graceMs = 5_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* 已经没了 */
      }
      resolve()
    }, graceMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    try {
      child.kill('SIGTERM')
    } catch {
      clearTimeout(timer)
      resolve()
    }
  })
}

/** 等端口不再有人监听（旧的 dsh web 真退干净了）。 */
async function waitPortFree(port: number, timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!(await portListening(port))) return true
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return false
}

/** 等端口重新监听且 HTTP 通（新的 dsh web 起来了）。 */
async function waitPortReady(gateway: string, timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await fetch(gateway, { redirect: 'manual' })
      return true
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
  }
  return false
}

/**
 * 这台隔离实例的**当前活进程**（第一次重启之后 `gw.pid` 那条就死了，之后要收的、要杀的
 * 都是这里的新 pid）。
 */
interface LiveGateway {
  pid: number
  dispose: () => Promise<void>
}

/**
 * 重启这台隔离实例：按 PID 收掉当前活进程，**同一 `DSH_HOME`、同一端口**重起一个新进程
 * （等价于用户「杀旧进程 + 新 spawn」那一步）。`live` 里的 pid 换成新进程的。
 */
async function restartGateway(gw: LabGateway, live: LiveGateway, log: (line: string) => void): Promise<void> {
  try {
    process.kill(live.pid, 'SIGTERM')
  } catch {
    /* 已经不在了 */
  }
  const freed = await waitPortFree(gw.port)
  log(`旧进程（pid ${String(live.pid)}）已退出，端口 ${String(gw.port)} ${freed ? '已释放' : '仍在监听（继续等新进程）'}`)
  const child = spawn('dsh', ['web', '--host', '127.0.0.1', '--port', String(gw.port), '--no-open'], {
    cwd: os.tmpdir(),
    env: { ...process.env, DSH_HOME: gw.home, MOCK_LLM_KEY: MOCK_LLM_KEY },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let tail = ''
  const onData = (chunk: Buffer): void => {
    tail = (tail + chunk.toString('utf8')).slice(-4_000)
  }
  child.stdout?.on('data', onData)
  child.stderr?.on('data', onData)
  const ready = await waitPortReady(gw.gateway)
  log(`新进程 pid ${String(child.pid ?? -1)}，HTTP ${ready ? '已通' : '没通'}；最后几行输出：${tail.trim().split('\n').slice(-2).join(' | ')}`)
  live.pid = child.pid ?? -1
  live.dispose = () => killByPid(child)
}

// ---------------------------------------------------------------------------
// 读数
// ---------------------------------------------------------------------------

interface ChatFacts {
  rows: number
  loadingHistory: boolean
  header: boolean
  /** 会话头里那一行标题（用来证明「页面真的切到了这条会话」）。 */
  sessionTitle: string
  text: string
}

async function chatFacts(page: Page): Promise<ChatFacts> {
  return await page.evaluate(() => {
    const rows = document.querySelectorAll('[data-chat-flow] > [data-chat-flow-key]:not(:empty):not([hidden])').length
    const text = document.body.innerText.replace(/\s+/g, ' ').trim()
    const header = document.querySelector('[data-slot="conversation.session.header"]')
    return {
      rows,
      loadingHistory: text.includes('载入历史') || text.includes('Loading history'),
      header: header !== null,
      sessionTitle: header === null ? '' : (header.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60),
      text: text.slice(0, 300),
    }
  })
}

/** 等到历史行数超过 `base`（新内容渲染出来了）。 */
async function waitRowsAbove(page: Page, base: number, timeoutMs: number): Promise<number | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const facts = await chatFacts(page)
    if (facts.rows > base) return facts.rows
    await page.waitForTimeout(500)
  }
  return null
}

/**
 * **Node 侧**量「从 `since` 这一刻起，历史行出现用了多久」——不依赖页内时钟，
 * 结论可以直接引用的那个数（页内记录器那一份用来抓瞬态提示）。
 */
async function timeToRows(page: Page, since: number, timeoutMs: number): Promise<{ elapsedMs: number; facts: ChatFacts } | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const facts = await chatFacts(page)
    if (facts.rows > 0) return { elapsedMs: Date.now() - since, facts }
    if (Date.now() > deadline) return null
    await page.waitForTimeout(100)
  }
}

/**
 * 同 {@link timeToRows}，但要等**会话头标题**先变成目标会话（证明侧栏那一下真的切过去了，
 * 而不是「本来就有历史行」）。
 */
async function timeToSession(
  page: Page,
  since: number,
  titlePart: string,
  timeoutMs: number,
): Promise<{ elapsedMs: number; facts: ChatFacts } | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const facts = await chatFacts(page)
    if (facts.rows > 0 && facts.sessionTitle.includes(titlePart)) return { elapsedMs: Date.now() - since, facts }
    if (Date.now() > deadline) return null
    await page.waitForTimeout(100)
  }
}

/** 页面上此刻出现的恢复/重连提示（正文里出现的那几条）。 */
async function recoveryHints(page: Page): Promise<string[]> {
  return await page.evaluate((labels: string[]) => {
    const text = document.body.innerText
    const found = labels.filter((label) => text.includes(label))
    for (const element of Array.from(document.querySelectorAll('[aria-label]'))) {
      const label = element.getAttribute('aria-label') ?? ''
      if (labels.includes(label) && !found.includes(label)) found.push(label)
    }
    return found
  }, RECOVERY_LABELS)
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

interface PhaseLog {
  group: string
  lines: string[]
}

const log: PhaseLog[] = []
let current = '（开场）'

function say(line: string): void {
  const entry = log[log.length - 1]
  if (entry === undefined || entry.group !== current) log.push({ group: current, lines: [line] })
  else entry.lines.push(line)
  process.stderr.write(`[retest] ${line}\n`)
}

async function shot(page: Page, name: string): Promise<string> {
  const file = path.join(OUT_DIR, `${name}.png`)
  await page.screenshot({ path: file, fullPage: false }).catch(() => undefined)
  return file
}

async function main(): Promise<void> {
  await fsp.mkdir(OUT_DIR, { recursive: true })
  const labLog = consoleLogger(true)
  let gw: LabGateway | undefined
  let lab: LabServer | undefined
  let browser: Browser | undefined
  const live: LiveGateway = { pid: -1, dispose: async () => undefined }
  const contexts: BrowserContext[] = []
  try {
    gw = await startLabGateway(labLog, { readyTimeoutMs: 120_000 })
    live.pid = gw.pid
    const gateway = gw.gateway
    say(`隔离实例：${gateway}（pid ${String(gw.pid)}，DSH_HOME=${gw.home}，dsh ${gw.version ?? '（版本未知）'}）`)
    const running = gw.seed.sessions.find((session) => session.state === 'running')
    const idle = gw.seed.sessions.find((session) => session.state === 'idle' && session.title !== '')
    if (running === undefined || idle === undefined) throw new Error('播种里没有「运行中」或带标题的空闲会话，复测做不下去')
    say(`夹具会话：运行中 = ${running.title}（${running.sessionId}）；空闲 = ${idle.title}（${idle.sessionId}）`)

    lab = await startLabServer({
      gateway: gateway,
      token: gw.token,
      log: labLog,
      pluginsDir: defaultPluginsDir(),
      ...(gw.version === undefined ? {} : { version: gw.version }),
    })
    browser = await launchBrowser(true)

    // ------------------------------------------------------------------
    // 阶段 A：#61 —— 打开正在运行的会话
    // ------------------------------------------------------------------
    current = '#61 官方页：直接开到正在运行的会话（种 dsh.sessions.current）'
    {
      const opened = await openOfficialPage(browser, gateway, { seedSession: running.sessionId })
      contexts.push(opened.context)
      const appeared = await timeToRows(opened.page, opened.navigatedAt, 45_000)
      const record = await readRecorder(opened.page)
      const facts = await chatFacts(opened.page)
      say(
        appeared === null
          ? `导航后 45 秒内历史行一条都没出现（「载入历史…」在场 ${String(facts.loadingHistory)}）——现象复现`
          : `导航后 ${String(appeared.elapsedMs)}ms 历史行出现（${String(appeared.facts.rows)} 行），页面标题「${appeared.facts.sessionTitle}」`,
      )
      say(`页内记录器：header@${String(firstAt(record, 'header'))}ms、首条历史行@${String(firstAt(record, 'history-row'))}ms、「载入历史…」出现@${String(firstAt(record, 'loading-history'))}ms、消失@${String(loadingGoneAt(record))}ms`)
      await opened.page.waitForTimeout(45_000)
      const settled = await chatFacts(opened.page)
      say(`45 秒后的现场：历史行 ${String(settled.rows)}、「载入历史…」在场 ${String(settled.loadingHistory)}、会话头在场 ${String(settled.header)}`)
      say(`页内时间线：${timeline(record).join(' / ')}`)
      say(`截图 ${await shot(opened.page, 'A1-official-running-seeded')}`)
      say(`控制台报错 ${String(opened.capture.consoleErrors.length)} 条、pageerror ${String(opened.capture.pageErrors.length)} 条`)
    }

    // ------------------------------------------------------------------
    // 阶段 B：#61 —— 当初的复现路径（先落空闲会话，再点侧栏那一行）
    // ------------------------------------------------------------------
    current = '#61 官方页：先落空闲会话，再从侧栏点开正在运行的会话'
    {
      const opened = await openOfficialPage(browser, gateway, { seedSession: idle.sessionId })
      contexts.push(opened.context)
      await opened.page.waitForTimeout(6_000)
      const before = await chatFacts(opened.page)
      say(`起点（空闲会话 ${idle.title}）：历史行 ${String(before.rows)}、标题「${before.sessionTitle}」`)
      // 记下点击这一刻：页内记录器的 t0 是导航时刻，这里补一条自己的刻度。
      const clickedAt = Date.now()
      const clicked = await opened.page.evaluate((title: string) => {
        const rows = Array.from(document.querySelectorAll('[class*="_sessionRow"]'))
        const hit = rows.find((row) => (row.textContent ?? '').includes(title))
        if (hit === undefined) return false
        ;(hit as HTMLElement).click()
        return true
      }, running.title)
      say(`侧栏里找到并点了「${running.title}」那一行：${String(clicked)}`)
      if (!clicked) {
        say(`页面上此刻的会话行文本：${JSON.stringify(await opened.page.evaluate(() => Array.from(document.querySelectorAll('[class*="_sessionRow"]')).map((row) => (row.textContent ?? '').slice(0, 40))))}`)
      }
      const appeared = await timeToSession(opened.page, clickedAt, running.title, 45_000)
      say(
        appeared === null
          ? '点击后 45 秒内没切到这条会话或没出历史行——现象复现'
          : `点击后 ${String(appeared.elapsedMs)}ms 切到该会话且历史行在场（${String(appeared.facts.rows)} 行）`,
      )
      await opened.page.waitForTimeout(45_000)
      const record = await readRecorder(opened.page)
      const facts = await chatFacts(opened.page)
      const marks = (record?.marks ?? []).filter((mark) => mark.at >= clickedAt)
      say(`点击那一刻的起点：历史行 ${String(before.rows)}、标题「${before.sessionTitle}」`)
      say(`点击后 ${String(Date.now() - clickedAt)}ms 的现场：历史行 ${String(facts.rows)}、「载入历史…」在场 ${String(facts.loadingHistory)}、标题「${facts.sessionTitle}」`)
      say(`点击后的时间线：${marks.map((mark) => `+${String(mark.at - clickedAt)}ms ${mark.what}${mark.detail === '' ? '' : ` ${mark.detail}`}`).join(' / ') || '（记录器去重后这一段没有新事件——见下面的现场读数）'}`)
      say(`截图 ${await shot(opened.page, 'B1-official-running-clicked')}`)
    }

    // ------------------------------------------------------------------
    // 阶段 C：#61 —— 装配页对照（同一条运行中会话）
    // ------------------------------------------------------------------
    current = '#61 装配页（/chat 树）：同一条正在运行的会话'
    {
      const opened = await openAssemblyPage(browser, lab, running.sessionId)
      contexts.push(opened.context)
      const appeared = await timeToRows(opened.page, opened.navigatedAt, 30_000)
      say(appeared === null ? '重载后 30 秒内历史行一条都没出现——现象复现' : `重载后 ${String(appeared.elapsedMs)}ms 历史行出现（${String(appeared.facts.rows)} 行），标题「${appeared.facts.sessionTitle}」`)
      await opened.page.waitForTimeout(30_000)
      const record = await readRecorder(opened.page)
      const facts = await chatFacts(opened.page)
      say(`页内记录器：header@${String(firstAt(record, 'header'))}ms、首条历史行@${String(firstAt(record, 'history-row'))}ms、「载入历史…」出现@${String(firstAt(record, 'loading-history'))}ms、消失@${String(loadingGoneAt(record))}ms`)
      say(`30 秒后的现场：历史行 ${String(facts.rows)}、「载入历史…」在场 ${String(facts.loadingHistory)}`)
      say(`截图 ${await shot(opened.page, 'C1-assembly-running')}`)
    }

    // ------------------------------------------------------------------
    // 阶段 D：#10 —— 网关重启后的官方页
    // ------------------------------------------------------------------
    current = '#10 官方页：网关实例重启后事件流会不会自己接回来'
    {
      const opened = await openOfficialPage(browser, gateway, { seedSession: idle.sessionId })
      contexts.push(opened.context)
      await opened.page.waitForTimeout(12_000)
      const before = await chatFacts(opened.page)
      const documentBefore = await readRecorder(opened.page)
      say(`起点（${idle.title}）：历史行 ${String(before.rows)}、标题「${before.sessionTitle}」；页内文本前 120 字：${before.text.slice(0, 120)}`)
      say(`截图 ${await shot(opened.page, 'D1-official-before-restart')}`)
      if (before.rows === 0) say('起点一条历史行都没有，后面的「新内容」判据会不可靠——如实记下来。')
      await restartGateway(gw, live, say)
      await opened.page.waitForTimeout(30_000)
      const hints = await recoveryHints(opened.page)
      const mid = await chatFacts(opened.page)
      const documentAfter = await readRecorder(opened.page)
      say(`重启后 30 秒：页面上的恢复提示 ${JSON.stringify(hints)}；历史行 ${String(mid.rows)}、「载入历史…」在场 ${String(mid.loadingHistory)}`)
      say(`这一页有没有被整页重载过：${documentBefore?.t0 === documentAfter?.t0 ? '没有（记录器的文档起点没变）' : `有（${String(documentBefore?.t0)} → ${String(documentAfter?.t0)}）`}`)
      say(`重启前后这段的提示时间线：${timeline(documentAfter).filter((line) => line.includes('recovery-hint')).join(' / ') || '（一条都没有）'}`)
      say(`截图 ${await shot(opened.page, 'D2-official-after-restart')}`)
      const retryLines = opened.capture.all.filter((line) => /connection lost|retry #|reconnect/i.test(line))
      say(`页面控制台里与重连有关的行：${retryLines.length === 0 ? '（一条都没有）' : JSON.stringify(retryLines.slice(0, 6))}`)
      say(`重启后向这条会话发一条新提示词，看新内容会不会渲染出来…`)
      await promptSession(gateway, idle.sessionId, '实验室：普通对话 90，回一句话就结束。')
      const rows = await waitRowsAbove(opened.page, before.rows, 60_000)
      say(`发完提示词 60 秒内：${rows === null ? `历史行仍是 ${String((await chatFacts(opened.page)).rows)}（没有新内容）` : `历史行涨到 ${String(rows)}（新内容渲染出来了）`}`)
      say(`截图 ${await shot(opened.page, 'D3-official-after-new-turn')}`)
      say(`控制台报错 ${String(opened.capture.consoleErrors.length)} 条、pageerror ${String(opened.capture.pageErrors.length)} 条`)
    }

    // ------------------------------------------------------------------
    // 阶段 E：#10 —— 装配页同样的处境
    // ------------------------------------------------------------------
    current = '#10 装配页（/chat 树）：同一处境'
    {
      const opened = await openAssemblyPage(browser, lab, idle.sessionId)
      contexts.push(opened.context)
      await opened.page.waitForTimeout(12_000)
      const before = await chatFacts(opened.page)
      const documentBefore = await readRecorder(opened.page)
      say(`起点（${idle.title}）：历史行 ${String(before.rows)}、标题「${before.sessionTitle}」`)
      if (before.rows === 0) say('起点一条历史行都没有，后面的「新内容」判据会不可靠——如实记下来。')
      await restartGateway(gw, live, say)
      await opened.page.waitForTimeout(30_000)
      const hints = await recoveryHints(opened.page)
      const documentAfter = await readRecorder(opened.page)
      say(`重启后 30 秒这一刻页面上的恢复提示：${JSON.stringify(hints)}（「连接成功」只显示 2 秒，这一刻多半已经消失——真正作数的是下面那条时间线）`)
      const hintTimeline = timeline(documentAfter).filter((line) => line.includes('recovery-hint'))
      say(`重启前后**全程**出现过的恢复提示：${hintTimeline.join(' / ') || '（整段一条都没有）'}`)
      say(`这一页有没有被整页重载过：${documentBefore?.t0 === documentAfter?.t0 ? '没有（记录器的文档起点没变）' : `有（${String(documentBefore?.t0)} → ${String(documentAfter?.t0)}）`}`)
      const settingsSeat = await opened.page.evaluate(() => ({
        trigger: document.querySelector('[data-slot="settings.trigger"]') !== null,
        statusRoles: Array.from(document.querySelectorAll('[role="status"]')).map((node) => (node.getAttribute('aria-label') ?? '').slice(0, 40)),
      }))
      say(`页面上有没有官方设置栏那一枚恢复提示的座位（\`settings.trigger\`）：${String(settingsSeat.trigger)}；页面上 role=status 的元素：${JSON.stringify(settingsSeat.statusRoles)}`)
      await promptSession(gateway, idle.sessionId, '实验室：普通对话 91，回一句话就结束。')
      const rows = await waitRowsAbove(opened.page, before.rows, 60_000)
      say(`发完提示词 60 秒内：${rows === null ? `历史行仍是 ${String((await chatFacts(opened.page)).rows)}（没有新内容）` : `历史行涨到 ${String(rows)}（新内容渲染出来了）`}`)
      say(`截图 ${await shot(opened.page, 'E1-assembly-after-restart')}`)
    }

    // ------------------------------------------------------------------
    // 阶段 F：#61 的开放问题——触发条件到底是「运行中」还是「历史体量大」
    // ------------------------------------------------------------------
    current = '#61 官方页：历史体量大的空闲会话（触发条件的另一支）'
    {
      const workspaceId = idle.workspaceId
      const bigId = await createSession(gateway, { workspaceId })
      const turns = 30
      say(`造一条历史体量大的会话（${String(turns)} 轮真回合，并行下发、实例按队列顺序跑）…`)
      await Promise.all(
        Array.from({ length: turns }, (_, index) => promptSession(gateway, bigId, `实验室：普通对话 ${String(index + 100)}，回一句话就结束。`)),
      )
      const deadline = Date.now() + 300_000
      let completed = 0
      for (;;) {
        const row = (await listSessions(gateway)).find((session) => session.sessionId === bigId)
        completed = row === undefined ? 0 : sessionCompletedTurns(row)
        if (completed >= turns || Date.now() > deadline) break
        await new Promise((resolve) => setTimeout(resolve, 1_000))
      }
      say(`这条会话真实完成的回合数：${String(completed)}（跑完 ${String(turns)} 轮为满）`)
      await renameSession(gateway, bigId, 'Lab-States big-history')
      const opened = await openOfficialPage(browser, gateway, { seedSession: bigId })
      contexts.push(opened.context)
      const appeared = await timeToRows(opened.page, opened.navigatedAt, 45_000)
      const facts = await chatFacts(opened.page)
      say(appeared === null ? '导航后 45 秒内历史行一条都没出现——现象复现' : `导航后 ${String(appeared.elapsedMs)}ms 历史行出现（${String(appeared.facts.rows)} 行），标题「${appeared.facts.sessionTitle}」`)
      say(`45 秒后的现场：历史行 ${String(facts.rows)}、「载入历史…」在场 ${String(facts.loadingHistory)}`)
      say(`截图 ${await shot(opened.page, 'F1-official-big-history')}`)
      await opened.page.waitForTimeout(20_000)
      const later = await chatFacts(opened.page)
      say(`再等 20 秒：历史行 ${String(later.rows)}、「载入历史…」在场 ${String(later.loadingHistory)}`)
    }
  } finally {
    for (const context of contexts) await context.close().catch(() => undefined)
    if (browser !== undefined) await browser.close().catch(() => undefined)
    await live.dispose().catch(() => undefined)
    if (lab !== undefined) lab.dispose()
    if (gw !== undefined) await gw.dispose()
  }

  const report = { at: new Date().toISOString(), dsh: gw?.version ?? null, gateway: gw?.gateway ?? null, log }
  await fsp.writeFile(path.join(OUT_DIR, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  process.stderr.write(`\n[retest] 报告写入 ${path.join(OUT_DIR, 'report.json')}（仓库根 ${REPO_ROOT}）\n`)
  for (const entry of log) {
    process.stdout.write(`\n## ${entry.group}\n${entry.lines.map((line) => `- ${line}`).join('\n')}\n`)
  }
  // 显式退出：Playwright / 网关子进程的句柄有时会让事件循环挂着不退（第一轮实测跑完
  // 报告都打出来了进程还在），收尾已经在 finally 里做完了，这里直接退。
  process.exit(0)
}

await main()
