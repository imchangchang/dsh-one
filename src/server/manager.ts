import * as vscode from 'vscode'
import { spawn, spawnSync } from 'node:child_process'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { makeDescribeRequest, validateDescribeResponse } from '../pure/envelope.ts'
import { parseReadyLine } from '../pure/readyLine.ts'
import { gte } from '../pure/semver.ts'
import { locateDsh, DshNotFoundError } from './locateDsh.ts'
import type { Logger } from '../log.ts'

/** dsh learned --no-open in 0.1.0-rc.7; older builds exit on the unknown flag. */
const NO_OPEN_MIN_VERSION = '0.1.0-rc.7'
const START_TIMEOUT_MS = 90_000
const PROBE_TIMEOUT_MS = 3_000
const KILL_GRACE_MS = 5_000
const TAIL_LINES = 40
const HEALTH_INTERVAL_MS = 30_000
/** Readiness poll cadence while a spawned dsh boots. */
const READY_POLL_MS = 250
/** How far past the configured port we scan for a free fallback port. */
const PORT_FALLBACK_ATTEMPTS = 50

export type ServerState = 'stopped' | 'starting' | 'running' | 'error'

export interface ServerStatus {
  state: ServerState
  url?: string
  port?: number
  /** true when we connected to an already-running instance we must never kill. */
  adopted?: boolean
  error?: string
  /** Why startup failed; 'dshNotFound' means no dsh executable was located. */
  reason?: 'dshNotFound'
}

/**
 * Tri-state port probe (modeled on dsh-vscode's probeService): POST
 * /api/host.describe and verify the rpcId echo.
 * - 'dsh': the port speaks dsh Gateway RPC — safe to adopt.
 * - 'foreign': something answered HTTP but failed validation — occupied.
 * - 'down': no response — free to spawn on.
 */
export type PortProbe = 'dsh' | 'foreign' | 'down'

export async function probePort(port: number, logger: Logger): Promise<PortProbe> {
  const rpcId = crypto.randomUUID()
  const url = `http://127.0.0.1:${port}/api/host.describe`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(makeDescribeRequest(rpcId)),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    const text = await res.text()
    if (res.ok && validateDescribeResponse(text, rpcId)) {
      logger.info(`probe: ${url} answered host.describe (rpcId echoed)`)
      return 'dsh'
    }
    logger.info(`probe: ${url} responded but failed rpcId validation (foreign service)`)
    return 'foreign'
  } catch {
    logger.info(`probe: ${url} no response (down)`)
    return 'down'
  }
}

/** POST /api/host.describe and return the base URL only when the port is dsh. */
export async function probeDsh(port: number, logger: Logger): Promise<string | null> {
  return (await probePort(port, logger)) === 'dsh' ? `http://127.0.0.1:${port}` : null
}

/** process.kill(pid, 0) liveness probe: ESRCH = gone, EPERM = alive but not ours. */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** pidfile 记录：上一次（可能已退出的扩展宿主）spawn 的 dsh 身份。 */
interface OwnedRecord {
  pid: number
  port: number
}

/**
 * Owns the dsh web server lifecycle: probe-then-spawn, readiness detection,
 * and careful cleanup (only processes we spawned ourselves are ever killed).
 * dsh 与 VSCode 窗口生命周期解绑：reload/关窗不再终止 dsh——spawn 时
 * detached + unref、stdio 进日志文件（管道读端随宿主退出会造成 EPIPE），
 * 身份经 globalStorage 的 pidfile 跨宿主传递，下次激活时 re-own。
 */
export class ServerManager implements vscode.Disposable {
  private status: ServerStatus = { state: 'stopped' }
  /** PID of the process group we own; null when adopted or stopped. */
  private ownedPid: number | null = null
  private inflight: Promise<ServerStatus> | null = null
  private stopping = false
  /** stop() 递增；进行中的 start 失败时据此判断是用户喊停而非真错误。 */
  private stopGeneration = 0
  private healthTimer: NodeJS.Timeout | null = null

  private readonly onDidChangeStateEmitter = new vscode.EventEmitter<ServerStatus>()
  readonly onDidChangeState = this.onDidChangeStateEmitter.event

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly logger: Logger,
  ) {}

  getStatus(): ServerStatus {
    return this.status
  }

  private setStatus(next: ServerStatus): void {
    this.status = next
    this.onDidChangeStateEmitter.fire(next)
  }

  /** Singleton start: concurrent callers share one in-flight promise. */
  ensureStarted(): Promise<ServerStatus> {
    if (this.status.state === 'running') return Promise.resolve(this.status)
    if (this.inflight) return this.inflight
    const generation = this.stopGeneration
    this.inflight = this.start()
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        this.logger.error(`failed to start dsh: ${message}`)
        // 用户中途 stop()（启动中的 dsh 被杀导致 start 失败）不置 error，
        // 否则状态栏会留下一个误导性的错误态。
        if (generation === this.stopGeneration) {
          this.setStatus({
            state: 'error',
            error: message,
            reason: err instanceof DshNotFoundError ? 'dshNotFound' : undefined,
          })
        }
        return this.status
      })
      .finally(() => {
        this.inflight = null
      })
    return this.inflight
  }

  async restart(): Promise<ServerStatus> {
    await this.stop()
    return this.ensureStarted()
  }

  async stop(): Promise<void> {
    this.stopping = true
    this.stopGeneration++
    this.stopHealthCheck()
    try {
      await this.killOwned(KILL_GRACE_MS)
    } finally {
      this.ownedPid = null
      this.setStatus({ state: 'stopped' })
      this.stopping = false
    }
  }

  private async start(): Promise<ServerStatus> {
    this.setStatus({ state: 'starting' })
    const cfg = vscode.workspace.getConfiguration('dshOne')
    const port = cfg.get<number>('port', 3080)

    // Re-own 优先：上一个扩展宿主 spawn 的 dsh 在 reload 后仍在跑（生命周期
    // 已解绑）。pidfile + pid 存活 + 端口身份确认三者齐备才认领。
    // 已知风险（已拍板接受）：dsh 死亡后 pid 被系统复用、且端口又被另一个手动
    // 启动的 dsh 占用时，stop 会误杀复用 pid 的进程组——host.describe 不含
    // pid，无法更严格地验证。
    const owned = await this.readOwned()
    if (owned) {
      const alive = pidAlive(owned.pid)
      this.logger.info(`pidfile found: pid=${owned.pid} port=${owned.port} alive=${alive}`)
      if (alive) {
        // port=0（系统分配）时 pidfile 里没有实际端口，从日志文件的就绪行拿。
        const ownedPort = owned.port > 0 ? owned.port : await this.readyPortFromLog()
        if (ownedPort !== null && (await probePort(ownedPort, this.logger)) === 'dsh') {
          const ownedUrl = `http://127.0.0.1:${ownedPort}`
          this.logger.info(`re-owning dsh at ${ownedUrl} (pid=${owned.pid}, spawned by a previous window)`)
          this.ownedPid = owned.pid
          this.setStatus({ state: 'running', url: ownedUrl, port: ownedPort, adopted: false })
          this.startHealthCheck(ownedPort)
          return this.status
        }
      }
    } else {
      this.logger.info('no pidfile found, falling through to probe/spawn')
    }
    await this.clearOwned() // 记录过期（pid 已死或端口不应答），清掉再走正常流程

    // Probe before spawn: adopt an already-running dsh on the configured port;
    // when a foreign service occupies it, fall back to a nearby free port
    // (runtime-only substitution, the user's setting is never rewritten).
    let spawnPort = port
    if (port > 0) {
      const probe = await probePort(port, this.logger)
      if (probe === 'dsh') {
        const adoptedUrl = `http://127.0.0.1:${port}`
        this.logger.info(`adopting existing dsh at ${adoptedUrl} (will never kill it)`)
        // 不再 preseed：影响方向是 dsh → VS Code 单向，当前文件夹不在 dsh
        // 工作区列表里就什么都不做（不注册、不建会话），被用户删掉的工作区
        // 不再在 reload 后复活。已知配套变化：当前文件夹无 dsh 会话时
        // sessionsStore.latestCurrentSessionId() 返回 null，聊天面板停在
        // 空态（extension.ts 的 auto-attach 对 null 天然跳过），用户手动
        // 选会话即可。
        this.setStatus({ state: 'running', url: adoptedUrl, port, adopted: true })
        this.startHealthCheck(port)
        return this.status
      }
      if (probe === 'foreign') {
        const free = await this.findFreePort(port)
        if (free === null) {
          throw new Error(vscode.l10n.t('Port {0} is occupied by another program, and ports {1}–{2} are all unavailable', port, port + 1, port + PORT_FALLBACK_ATTEMPTS))
        }
        this.logger.warn(`port ${port} is occupied by a foreign service; falling back to ${free}`)
        void vscode.window.showWarningMessage(
          vscode.l10n.t('DSH One: port {0} is occupied by another program; using port {1} this time (setting unchanged)', port, free),
        )
        spawnPort = free
      }
    }

    const dsh = await locateDsh(this.logger)
    let workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir()
    // 当前文件夹可能已从磁盘删除（VS Code 仍持有过期路径）——spawn 的
    // cwd 不存在会直接 ENOENT、服务起不来，回退 home 目录。
    try {
      await fsp.stat(workspaceRoot)
    } catch {
      const fallback = os.homedir()
      this.logger.warn(`workspace root ${workspaceRoot} no longer exists; spawning with cwd=${fallback}`)
      workspaceRoot = fallback
    }

    // Sanitize the environment: the extension host injects NODE_OPTIONS /
    // ELECTRON_RUN_AS_NODE, both of which break a plain node child process.
    const env = { ...process.env }
    delete env.NODE_OPTIONS
    delete env.ELECTRON_RUN_AS_NODE

    const args = ['web', '--host', '127.0.0.1', '--port', String(spawnPort)]
    // --no-open only exists in dsh >= 0.1.0-rc.7; older versions would exit.
    // An unparseable version is treated as modern.
    if (dsh.version === 'unknown' || gte(dsh.version, NO_OPEN_MIN_VERSION)) {
      args.push('--no-open')
    }

    this.logger.info(`spawning: ${dsh.command} ${args.join(' ')} (cwd=${workspaceRoot})`)

    // 父死子存：单层 detached+unref 不够——实测 VS Code 在 reload 后会对扩展
    // 宿主的进程树做 SIGTERM 树杀（pgrep -P 递归，terminateProcess.sh），
    // detached 的 dsh 因 ppid 链仍在而被带走。所以经短命启动器
    // （dist/spawnDsh.js）双层 spawn：启动器拉起 dsh（detached + stdio 进日志
    // 文件）后立即退出，dsh 被 launchd 收养，从宿主的进程树上消失。
    // 日志文件每次 spawn 截断（已拍板：截断而非滚动保留）。
    await fsp.mkdir(this.context.globalStorageUri.fsPath, { recursive: true })
    const launcher = path.join(this.context.extensionUri.fsPath, 'dist', 'spawnDsh.js')
    const dshPid = await this.spawnViaLauncher(launcher, dsh.command, args, env, workspaceRoot)
    this.ownedPid = dshPid
    this.logger.info(`dsh logs to ${this.logFile()}`)
    await this.writeOwned({ pid: dshPid, port: spawnPort })

    const ready = await this.waitReady(dshPid, spawnPort)
    const actualPort = Number(new URL(ready).port)
    // port=0 时启动后才知道实际端口，回填 pidfile 供下次 re-own。
    if (actualPort !== spawnPort) await this.writeOwned({ pid: dshPid, port: actualPort })
    this.setStatus({ state: 'running', url: ready, adopted: false, port: actualPort })
    this.startHealthCheck(actualPort)
    this.logger.info(`dsh is ready at ${ready}`)
    return this.status
  }

  /** First port after `start` that answers nothing; null when the range is full. */
  private async findFreePort(start: number): Promise<number | null> {
    for (let p = start + 1; p <= start + PORT_FALLBACK_ATTEMPTS && p <= 65535; p++) {
      if ((await probePort(p, this.logger)) === 'down') return p
    }
    return null
  }

  /**
   * Post-ready health check (dsh-vscode's design): probe every 30s; a lost
   * server — including an adopted instance we do not own — drops the status
   * back to stopped so the UI stops claiming "running". An owned child that
   * stops answering is killed so the next start gets its port back.
   */
  private startHealthCheck(port: number): void {
    this.stopHealthCheck()
    this.healthTimer = setInterval(() => {
      void probeDsh(port, this.logger).then(async (url) => {
        if (url || this.status.state !== 'running') return
        this.logger.warn(`health probe failed on :${port}; marking the server stopped`)
        this.stopHealthCheck()
        await this.killOwned(KILL_GRACE_MS)
        this.ownedPid = null
        this.setStatus({ state: 'stopped' })
      })
    }, HEALTH_INTERVAL_MS)
    this.healthTimer.unref()
  }

  private stopHealthCheck(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer)
      this.healthTimer = null
    }
  }

  /**
   * 经短命启动器拉起 dsh，返回 dsh 的真实 pid。启动器自身以
   * ELECTRON_RUN_AS_NODE 跑在扩展宿主自带的 Electron/Node 二进制上
   * （不依赖 PATH 里有 node）；它的唯一职责是 detached spawn dsh 后立刻
   * 退出，让 dsh 被 launchd 收养、脱离宿主进程树。
   */
  private spawnViaLauncher(
    launcher: string,
    dshCommand: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    cwd: string,
  ): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const proc = spawn(process.execPath, [launcher, dshCommand, this.logFile(), ...args], {
        cwd,
        env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let out = ''
      let errOut = ''
      let settled = false
      const fail = (err: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(hangTimer)
        proc.kill()
        reject(err)
      }
      // 启动器正常是毫秒级退出；挂死（极端情况）不能拖着 start() 永远
      // 停在 starting，10s 兜底杀掉并报错。
      const hangTimer = setTimeout(() => fail(new Error(vscode.l10n.t('dsh launcher did not respond ({0}s timeout)', 10))), 10_000)
      proc.stdout?.on('data', (d: Buffer) => (out += d.toString()))
      proc.stderr?.on('data', (d: Buffer) => (errOut += d.toString()))
      proc.once('error', (err) => fail(new Error(vscode.l10n.t('Failed to start dsh launcher: {0}', err.message))))
      proc.once('exit', (code) => {
        if (settled) return
        settled = true
        clearTimeout(hangTimer)
        const pid = Number(out.trim())
        if (code === 0 && Number.isInteger(pid) && pid > 0) {
          resolve(pid)
        } else {
          reject(new Error(vscode.l10n.t('dsh launcher failed (code={0}): {1}', String(code), errOut.trim() || out.trim())))
        }
      })
    })
  }

  /**
   * Readiness by polling: dsh 端口被占时直接启动失败（不会自己换端口），
   * 所以固定端口轮询 probeDsh 即可，不依赖 stdout 就绪行。port=0（系统分配）
   * 是例外——实际端口只能从日志文件里的 `dsh web: …` 就绪行拿到再确认。
   * 进程提前退出（pid 消失）/ 90s 超时都会带上日志文件尾部作为错误详情。
   * 双层 spawn 后扩展不再持有 dsh 的进程句柄，早退只能靠 pid 存活判断。
   */
  private waitReady(pid: number, port: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let settled = false

      const cleanup = (): void => {
        clearTimeout(timer)
        clearInterval(poll)
      }
      const fail = (err: Error): void => {
        if (settled) return
        settled = true
        cleanup()
        reject(err)
      }
      const done = (url: string): void => {
        if (settled) return
        settled = true
        cleanup()
        resolve(url)
      }

      const timer = setTimeout(() => {
        void this.readLogTail().then((tail) =>
          fail(new Error(vscode.l10n.t('dsh startup timed out ({0}s)\n{1}', START_TIMEOUT_MS / 1000, tail))),
        )
      }, START_TIMEOUT_MS)

      let probing = false
      const poll = setInterval(() => {
        // 探测超时（3s）远长于轮询间隔（250ms），挂起的端口会叠加并发
        // 请求；用 busy 标志串行化。
        if (probing) return
        probing = true
        void (async () => {
          if (!pidAlive(pid)) {
            const tail = await this.readLogTail()
            fail(new Error(vscode.l10n.t('dsh exited early\n{0}', tail)))
            return
          }
          let candidate = port
          if (candidate === 0) {
            const text = await fsp.readFile(this.logFile(), 'utf8').catch(() => '')
            const ready = parseReadyLine(text)
            if (!ready) return
            candidate = ready.port
          }
          const url = await probeDsh(candidate, this.logger)
          if (url) done(url)
        })().finally(() => {
          probing = false
        })
      }, READY_POLL_MS)
    })
  }

  /**
   * Kill only the process we own (spawned this run or re-owned via pidfile).
   * Adopted instances are never touched. Windows: taskkill /T /F. POSIX:
   * SIGTERM the detached process group, escalating to SIGKILL after
   * `graceMs`. Works from the pid alone — a re-owned instance has no child
   * handle, so liveness is polled instead of waiting on 'exit'.
   */
  private async killOwned(graceMs: number): Promise<void> {
    const pid = this.ownedPid
    if (pid === null) return
    this.logger.info(`stopping dsh (pid=${pid})`)

    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      try {
        process.kill(-pid, 'SIGTERM')
      } catch {
        // already gone
      }
      const deadline = Date.now() + graceMs
      while (pidAlive(pid) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100))
      }
      if (pidAlive(pid)) {
        this.logger.warn(`dsh ignored SIGTERM for ${graceMs}ms, sending SIGKILL`)
        try {
          process.kill(-pid, 'SIGKILL')
        } catch {
          // already gone
        }
      }
    }
    this.ownedPid = null
    await this.clearOwned()
  }

  /** globalStorage 下 dsh 的 stdout/stderr 日志文件（每次 spawn 截断）。 */
  private logFile(): string {
    return path.join(this.context.globalStorageUri.fsPath, 'dsh-web.log')
  }

  /** globalStorage 下的 pidfile：{pid, port}，reload 后据此 re-own。 */
  private ownedFile(): string {
    return path.join(this.context.globalStorageUri.fsPath, 'dsh-owned.json')
  }

  private async writeOwned(record: OwnedRecord): Promise<void> {
    try {
      await fsp.mkdir(this.context.globalStorageUri.fsPath, { recursive: true })
      await fsp.writeFile(this.ownedFile(), JSON.stringify(record))
    } catch (err) {
      this.logger.warn(`writing the dsh pidfile failed: ${err instanceof Error ? err.message : err}`)
    }
  }

  private async readOwned(): Promise<OwnedRecord | null> {
    try {
      const parsed = JSON.parse(await fsp.readFile(this.ownedFile(), 'utf8')) as Partial<OwnedRecord>
      if (typeof parsed.pid !== 'number' || typeof parsed.port !== 'number') return null
      return { pid: parsed.pid, port: parsed.port }
    } catch {
      return null
    }
  }

  private async clearOwned(): Promise<void> {
    await fsp.rm(this.ownedFile(), { force: true }).catch(() => undefined)
  }

  /** port=0 spawn 的实际端口只能从日志文件的就绪行解析（读前 64KB）；读不到返回 null。 */
  private async readyPortFromLog(): Promise<number | null> {
    try {
      const handle = await fsp.open(this.logFile(), 'r')
      try {
        const buf = Buffer.alloc(64 * 1024)
        const { bytesRead } = await handle.read(buf, 0, buf.length, 0)
        return parseReadyLine(buf.toString('utf8', 0, bytesRead))?.port ?? null
      } finally {
        await handle.close()
      }
    } catch {
      return null
    }
  }

  /** 日志文件尾部（错误详情用）；读不到返回空串。 */
  private async readLogTail(): Promise<string> {
    try {
      const text = await fsp.readFile(this.logFile(), 'utf8')
      return text.split('\n').slice(-TAIL_LINES).join('\n').trim()
    } catch {
      return ''
    }
  }

  /**
   * dispose 只清理本地资源（健康检查计时器、事件发射器）。
   * dsh 不随扩展宿主退出——它由 pidfile 记录身份，下个窗口 re-own；
   * 只有用户显式 dshOne.stop / dshOne.restart 才会杀它。
   */
  dispose(): void {
    this.stopHealthCheck()
    this.onDidChangeStateEmitter.dispose()
  }
}
