/**
 * 实验室的**隔离实例**（#177）：为「整轮浏览器验证」现起一个 dsh 网关——独立的临时
 * `DSH_HOME`、独立的随机端口、跑完按 PID 收掉、临时目录一并删。
 *
 * 名词（先说清楚再用，见 README「隔离实例」一节）：
 * - **隔离实例** = 实验室**自己起**的那台 `dsh web`。它的 `DSH_HOME` 指向本次运行新建的
 *   临时目录，所以工作区 / 会话 / 设置全部落在那里，用户的 `~/.dsh` 一个字节都不动；
 * - **播种** = 整轮开始前，经**官方 RPC** 往这台实例里写入真数据（工作区、各种状态的会话、
 *   归档记录），让套件面对的是真会话而不是页内自造的帧。
 *
 * 为什么默认跑这台而不是用户日常那台（#177 的用户拍板）：对着用户实例只能只读，
 * 判据要么吃当天数据、要么在页面里自造帧；自起一台之后写操作自由，判据可以用真数据算。
 * 历史沿革：本模块的前身是 #162 的 `emptyGateway.ts`（那时这套跑法还是 `--empty` 这个
 * opt-in 开关，实例里只放「两个工作区各一个会话」的最小数据）。
 *
 * 隔离保证（照 `AGENTS.md` 的规矩来）：
 * - 端口现取一个空闲的，**不碰用户正在用的 3080**；起之前再确认一次端口没人监听；
 * - 不用 `pkill`：收尾一律**按 PID**（先 SIGTERM，不退再 SIGKILL）。`pkill -f "dsh web"`
 *   会把用户自己的实例一起杀掉（#162 之前有 session 这么干过）；
 * - **不写 `~/.dsh/dsh-owned.json`**：那个文件是扩展 spawn/adopt 实例时记的，这里直接
 *   用 `dsh web` 起进程，不经过扩展那条路。
 *
 * 实例的设置文档（`DSH_HOME/settings.yaml`）在**起进程之前**写好，两件事：
 * ① 页面语言钉死成 zh（语言是判据的环境输入，不钉住就会有「换台机器就红」的假失败）；
 * ② 模型指向本次现起的假模型端点（见 `labLlm.ts`），播种才能真跑出非 blank 的会话。
 *
 * 另外在起进程之前写一份**本实例的用户补丁层** `DSH_HOME/cordis.patch.yml`（见
 * {@link cordisPatchYaml}）：内容搜索（官方 `session-query-sqlite`）在官方出厂配置里
 * 是**关着**的，要显式打开（#195）。
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import * as fsp from 'node:fs/promises'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import { scratchDir } from '../scratchDirs.ts'
import { exchangeToken } from '../../src/server/assemblyMirror.ts'
import type { LogSink } from '../../src/log.ts'
import { appendGatewayOutput, defaultFailureLogPath, gatewayFailureDetail, writeGatewayOutput } from './gatewayLog.ts'
import { startLabLlm, type MockLlm } from './labLlm.ts'
import { seedLabInstance, type LabSeed } from './seed.ts'

export interface LabGateway {
  /** 网关地址（`http://127.0.0.1:<随机端口>`）。 */
  readonly gateway: string
  /** 网关端口（收尾后要证明它没人监听了）。 */
  readonly port: number
  /** 网关 launch token。 */
  readonly token: string
  /** dsh 版本（`dsh --version` 的输出，取不到为 undefined）。 */
  readonly version?: string
  /** 临时 `DSH_HOME`（跑完连同里面的东西一起删）。 */
  readonly home: string
  readonly pid: number
  /** 播种进这台实例的真数据（见 `seed.ts`；`seed: false` 时全空）。 */
  readonly seed: LabSeed
  dispose(): Promise<void>
}

/** 现取一个空闲端口：绑 0 让系统给，拿到号就关掉。 */
export async function freePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => {
        resolve(port)
      })
    })
  })
}

/** 这个端口上有人在监听吗（起网关闭前再确认一次，别撞上别人刚起的服务）。 */
export async function portListening(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    const done = (listening: boolean): void => {
      socket.destroy()
      resolve(listening)
    }
    socket.on('connect', () => done(true))
    socket.on('error', () => done(false))
    socket.setTimeout(1_000, () => done(false))
  })
}

/** dsh 二进制的版本（页面上的版本门要它；取不到就返回 undefined，页面会挂一条信息条）。 */
function dshVersion(env: NodeJS.ProcessEnv): string | undefined {
  try {
    const out = execFileSync('dsh', ['--version'], { encoding: 'utf8', env, timeout: 20_000 }).trim()
    return /^\d+\.\d+\.\d+/.test(out) ? (out.split('\n')[0] ?? '').trim() : undefined
  } catch {
    return undefined
  }
}

/** 收一个子进程：先 SIGTERM，超过 `graceMs` 还不退就 SIGKILL。 */
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

/**
 * 实例自己的设置文档（`DSH_HOME/settings.yaml`）。
 *
 * 字段对照沙盒那条线（`test/sandbox/entrypoint.sh` 的 mock 分支，逐项从
 * `@deepseek-ai/dsh-llm-pi-ai` 的 schema 核过）：`apiKeyEnv` / `displayName` / `api` /
 * `baseURL` / `models` 必填，模型那几项显式补齐（contextWindow / maxTokens / input /
 * reasoningEfforts）。`apiKeyEnv` 指向的环境变量在起进程时给（见 `startLabGateway`）。
 *
 * `locale` = 页面语言（#206 加的参数，见 {@link StartLabGatewayOptions.locale}）。
 */
function settingsYaml(mockUrl: string, locale: string): string {
  return `# 实验室隔离实例的设置文档（本次运行现写，随临时 DSH_HOME 一起删）。
agent-default-model:
  provider: mock-llm
  model: mock-flash
  reasoningEffort: max
llm-pi-ai:
  providers:
    mock-llm:
      baseURL: "${mockUrl}/v1"
      api: "openai-completions"
      apiKeyEnv: MOCK_LLM_KEY
      displayName: "Lab Mock LLM"
      models:
        - id: mock-flash
          name: mock-flash
          contextWindow: 128000
          maxTokens: 8192
          input: ["text"]
          reasoningEfforts:
            off: null
            high: "high"
            max: "max"
# 页面语言钉死：判据不许吃语言（#162 立的约束，这里把环境输入本身固定住）。
locale:
  preference: ${locale}
`
}

export interface StartLabGatewayOptions {
  /** 指定端口（缺省现取空闲的）。 */
  port?: number
  /** 就绪超时（毫秒）。 */
  readyTimeoutMs?: number
  /** 起来之后播种真数据（缺省播，见 `seed.ts`）。 */
  seed?: boolean
  /**
   * 页面语言（写进实例设置文档的 `locale.preference`），缺省 `zh`；`LAB_LOCALE` 同义。
   *
   * #206 加的。为什么要这个口子：判据一律从词典读、zh / en 两份都认（#162 立的约束），
   * 但那条约束**只有在 en 页上真跑过一遍**才算数——写死中文的漏网断言在 zh 页上照样绿，
   * 得换个语言才露出来。给了它就 `LAB_LOCALE=en node test/assembly-lab/verify.ts --suite …`，
   * 与不改任何东西的 zh 轮共用同一套装置。
   */
  locale?: string
  /**
   * 把网关进程的 stdout / stderr **原样落一份到文件**（#203 的排障口子）。
   *
   * 为什么加：网关自己的日志（配置层重载、插件加载、服务卸载）是「会话面为什么没了」这类
   * 问题的第一手证据，而默认只在**进程退出**时把最后几行打给 logger——一轮跑完正常收尾时
   * 那段日志就跟着临时目录一起没了。给了这个路径就全程留一份（跟着产物目录走，不进仓库）。
   * 缺省不给 = 与 #203 之前逐字相同。
   */
  logPath?: string
}

/**
 * 本实例的**用户补丁层**（`DSH_HOME/cordis.patch.yml`），起进程之前写好。
 *
 * 它要打开的是**内容搜索**（官方 `@deepseek-ai/dsh-session-query-sqlite`）。出处与做法：
 *
 * - 官方出厂配置里这一条是**关着**的。`@deepseek-ai/dsh-base/cordis.patch.yml` 里那一行的
 *   注释原话：「web deployments keep the index off (the base row's `openAt: never`) …
 *   while search calls fail with `SESSION_QUERY_SEARCH_DISABLED` and SQLite is never opened;
 *   the Web sidebar search matches titles and workspace names only」，并写明打开方式
 *   「Deployments enabling content search override `openAt` to `first-search` or `startup`
 *   in a later patch layer (profile cordis.patch.yml or a `--patch` overlay), typically with
 *   a durable `path`」——所以这是官方给的机制，不是绕过。
 * - 用户补丁层的位置与生效顺序（`@deepseek-ai/dsh/lib/profile-boot-*.js` 的注释）：
 *   「The home-level user patch layer (`$DSH_HOME/cordis.patch.yml`), applied …」，
 *   即它排在 profile 自己的层**之后**，正好覆盖得了出厂那行 `openAt: never`。
 * - 索引文件落在**这台实例自己的临时 `DSH_HOME`** 里（与用户日常那台实例在
 *   `~/.dsh/profiles/web/cordis.patch.yml` 里配 `dshHomePath('session-query.sqlite')`
 *   同一形状），随临时目录一起删。
 *
 * 为什么非打开不可（#195）：F-37 要量**搜索结果行**的几何，其中一条判据量的是结果里
 * 那段摘要（snippet）的行高——摘要是内容搜索给出来的，搜索关着时结果行只有标题匹配、
 * 没有摘要那一段。
 */
function cordisPatchYaml(home: string): string {
  return `# 实验室隔离实例的用户补丁层（本次运行现写，随临时 DSH_HOME 一起删）。
# 打开内容搜索（官方出厂配置里是 openAt: never；理由与出处见 labGateway.ts 的同名注释）。
- id: session-query-sqlite
  config:
    path: ${JSON.stringify(path.join(home, 'session-query.sqlite'))}
    openAt: first-search
`
}

/**
 * 起一台隔离实例：临时 `DSH_HOME` + 随机端口 + `--no-open`（**必须**，否则会在用户
 * 桌面上弹一个浏览器窗口）+ 本次现起的假模型端点。
 */
export async function startLabGateway(log: LogSink, options: StartLabGatewayOptions = {}): Promise<LabGateway> {
  const home = await scratchDir('dsh-lab-home-')
  const requested = options.port ?? (await freePort())
  if (await portListening(requested)) {
    await fsp.rm(home, { recursive: true, force: true })
    throw new Error(`隔离实例网关的端口 ${String(requested)} 已经有人在监听，换一个。`)
  }
  let llm: MockLlm | undefined
  let child: ChildProcess | undefined
  let output = ''
  // 收尾时主动杀掉网关不算「半路退出」：那条路上不吐诊断，免得每轮正常收尾都倒一大段日志。
  let stopping = false
  // 失败时那份完整输出落在哪：给了 `logPath` 就指它（那边全程在写），否则用它自己的兜底文件。
  const failureLogPath = options.logPath ?? defaultFailureLogPath(requested)
  // 调试日志（`logPath`，见 StartLabGatewayOptions）：全程留一份，缺省不给就不留。
  const debugLog = options.logPath === undefined ? undefined : fsp.open(options.logPath, 'a').catch(() => undefined)
  const onData = (chunk: Buffer): void => {
    // 窗口是 #231 放大的：原来只留 8 KB，而「网关一起来就崩」这种现场里真正的异常恰好被
    // 前面那一长串启动日志挤出了窗口（见 gatewayLog.ts 的文件头）。
    output = appendGatewayOutput(output, chunk.toString('utf8'))
    if (debugLog !== undefined) {
      void debugLog.then((handle) => {
        if (handle !== undefined) void handle.write(chunk).catch(() => undefined)
      })
    }
  }
  const dispose = async (): Promise<void> => {
    stopping = true
    if (debugLog !== undefined) {
      const handle = await debugLog.catch(() => undefined)
      await handle?.close().catch(() => undefined)
    }
    if (child !== undefined) await killByPid(child)
    if (llm !== undefined) await llm.close().catch(() => undefined)
    await fsp.rm(home, { recursive: true, force: true }).catch(() => undefined)
  }
  try {
    llm = await startLabLlm()
    await fsp.writeFile(path.join(home, 'settings.yaml'), settingsYaml(llm.url, options.locale ?? process.env.LAB_LOCALE ?? 'zh'), 'utf8')
    await fsp.writeFile(path.join(home, 'cordis.patch.yml'), cordisPatchYaml(home), 'utf8')
    const env: NodeJS.ProcessEnv = { ...process.env, DSH_HOME: home, MOCK_LLM_KEY: 'lab-mock-key' }
    child = spawn('dsh', ['web', '--host', '127.0.0.1', '--port', String(requested), '--no-open'], {
      cwd: os.tmpdir(),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    const deadline = Date.now() + (options.readyTimeoutMs ?? 90_000)
    let token: string | undefined
    let exited = false
    child.once('exit', (code, signal) => {
      exited = true
      // 跑到一半这个网关自己没了的话，整轮剩下的套件都会红成「连不上网关」——那不是判据
      // 的问题，而是环境没了。把退出码、信号与**真正的异常**如实打出来，别让人对着
      // 一屏 ECONNREFUSED 猜（第 4 轮实测踩到过一次；「真正的异常被尾巴截掉」是 #231）。
      const where = `code=${String(code ?? 'null')} signal=${String(signal ?? 'null')}`
      if (stopping) {
        log.warn(`隔离实例网关已收掉（${where}）。`)
        return
      }
      if (options.logPath === undefined) writeGatewayOutput(output, failureLogPath)
      log.warn(`隔离实例网关退出了（${where}）。${gatewayFailureDetail(output, { logPath: failureLogPath })}`)
    })
    while (Date.now() < deadline) {
      if (exited) break
      token = /token=([A-Za-z0-9_-]+)/.exec(output)?.[1]
      if (token !== undefined && output.includes('dsh web:')) break
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    if (token === undefined) {
      if (options.logPath === undefined) writeGatewayOutput(output, failureLogPath)
      throw new Error(`隔离实例网关没起来（${String(requested)}）。${gatewayFailureDetail(output, { logPath: failureLogPath })}`)
    }
    const gateway = `http://127.0.0.1:${String(requested)}`
    const port = requested
    // 就绪行出来表示已经在监听，但仍按 HTTP 确认一次——后面整轮都靠它，别在这里省一步。
    const httpDeadline = Date.now() + 15_000
    for (;;) {
      try {
        await fetch(gateway, { redirect: 'manual' })
        break
      } catch (err) {
        if (Date.now() > httpDeadline) {
          throw new Error(`隔离实例网关的 HTTP 端口不通（${String(port)}）：${err instanceof Error ? err.message : String(err)}`)
        }
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
    }
    const version = dshVersion(env)
    log.info(
      `隔离实例就绪：${gateway}（DSH_HOME=${home}，pid ${String(child.pid ?? -1)}，dsh ${version ?? '（版本未知）'}，假模型 ${llm.url}）`,
    )
    await exchangeToken(gateway, token, log)
    const seed = options.seed === false ? emptySeed() : await seedLabInstance(gateway, home, log)
    return {
      gateway,
      port,
      token,
      ...(version === undefined ? {} : { version }),
      home,
      pid: child.pid ?? -1,
      seed,
      dispose,
    }
  } catch (err) {
    await dispose()
    throw err
  }
}

/** 不播种时的空账（`seed: false`）。 */
function emptySeed(): LabSeed {
  return { workspaces: [], sessions: [], archivedSessionIds: [] }
}
