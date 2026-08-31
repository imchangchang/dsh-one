import * as vscode from 'vscode'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { makeDescribeRequest, validateDescribeResponse } from '../pure/envelope.ts'
import { parseReadyLine } from '../pure/readyLine.ts'
import { gte } from '../pure/semver.ts'
import { ensureSession, ensureWorkspace } from './dshRpc.ts'
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
  private child: ChildProcess | null = null
  /** PID of the process group we own; null when adopted or stopped. */
  private ownedPid: number | null = null
  private inflight: Promise<ServerStatus> | null = null
  private stopping = false
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
    this.inflight = this.start()
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        this.logger.error(`failed to start dsh: ${message}`)
        this.setStatus({
          state: 'error',
          error: message,
          reason: err instanceof DshNotFoundError ? 'dshNotFound' : undefined,
        })
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
    this.stopHealthCheck()
    try {
      await this.killOwned(KILL_GRACE_MS)
    } finally {
      this.child = null
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
    if (owned && pidAlive(owned.pid) && (await probePort(owned.port, this.logger)) === 'dsh') {
      const ownedUrl = `http://127.0.0.1:${owned.port}`
      this.logger.info(`re-owning dsh at ${ownedUrl} (pid=${owned.pid}, spawned by a previous window)`)
      this.ownedPid = owned.pid
      await this.preseedWorkspace(ownedUrl)
      this.setStatus({ state: 'running', url: ownedUrl, port: owned.port, adopted: false })
      this.startHealthCheck(owned.port)
      return this.status
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
        await this.preseedWorkspace(adoptedUrl)
        this.setStatus({ state: 'running', url: adoptedUrl, port, adopted: true })
        this.startHealthCheck(port)
        return this.status
      }
      if (probe === 'foreign') {
        const free = await this.findFreePort(port)
        if (free === null) {
          throw new Error(`端口 ${port} 被其他程序占用，且 ${port + 1}–${port + PORT_FALLBACK_ATTEMPTS} 均不可用`)
        }
        this.logger.warn(`port ${port} is occupied by a foreign service; falling back to ${free}`)
        void vscode.window.showWarningMessage(
          `DSH One: 端口 ${port} 被其他程序占用，本次已改用端口 ${free}（未修改设置）`,
        )
        spawnPort = free
      }
    }

    const dsh = await locateDsh(this.logger)
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir()

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

    // 父死子存的三件套：detached 自成进程组、unref 不拖住宿主、stdio 重定向
    // 到日志文件（pipe 的读端在宿主里，宿主退出后 dsh 写日志会吃 EPIPE 崩溃）。
    // 日志文件每次 spawn 截断（已拍板：截断而非滚动保留）。
    await fsp.mkdir(this.context.globalStorageUri.fsPath, { recursive: true })
    const logFd = fs.openSync(this.logFile(), 'w')
    // .cmd shims cannot be spawned directly on Windows — route through a shell.
    const child = spawn(dsh.command, args, {
      cwd: workspaceRoot,
      env,
      windowsHide: true,
      detached: true,
      shell: process.platform === 'win32',
      stdio: ['ignore', logFd, logFd],
    })
    child.unref()
    child.once('spawn', () => fs.closeSync(logFd))
    child.once('error', () => {
      try {
        fs.closeSync(logFd)
      } catch {
        // already closed
      }
    })
    this.child = child
    this.ownedPid = child.pid ?? null
    this.logger.info(`dsh logs to ${this.logFile()}`)
    if (this.ownedPid !== null) await this.writeOwned({ pid: this.ownedPid, port: spawnPort })

    child.on('exit', (code, signal) => {
      this.logger.warn(`dsh process exited (code=${code}, signal=${signal})`)
      this.stopHealthCheck()
      this.child = null
      this.ownedPid = null
      void this.clearOwned()
      if (!this.stopping && this.status.state !== 'error') {
        void this.readLogTail().then((tail) => {
          this.setStatus({ state: 'error', error: `dsh 意外退出 (code=${code}, signal=${signal})\n${tail}` })
        })
        vscode.window.showErrorMessage('DSH One: dsh 服务意外退出', '查看日志', '重试').then((pick) => {
          if (pick === '查看日志') this.logger.show()
          if (pick === '重试') void this.ensureStarted()
        })
      }
    })

    const ready = await this.waitReady(child, spawnPort)
    await this.preseedWorkspace(ready)
    this.setStatus({ state: 'running', url: ready, adopted: false, port: Number(new URL(ready).port) })
    this.startHealthCheck(Number(new URL(ready).port))
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
        this.child = null
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
   * Register the VSCode folder as a dsh workspace and give it a session, so
   * the web UI's "most recent workspace" startup strategy lands on it
   * directly instead of a workspace picker. Best-effort: failures only log.
   */
  private async preseedWorkspace(url: string): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    if (!folder) return
    try {
      const workspace = await ensureWorkspace(url, folder)
      const sessionId = await ensureSession(url, workspace)
      this.logger.info(`preseeded workspace ${workspace.workspaceId} (${folder}) with session ${sessionId}`)
    } catch (err) {
      this.logger.warn(`workspace preseed failed: ${err instanceof Error ? err.message : err}`)
    }
  }

  /**
   * Readiness by polling: dsh 端口被占时直接启动失败（不会自己换端口），
   * 所以固定端口轮询 probeDsh 即可，不依赖 stdout 就绪行。port=0（系统分配）
   * 是例外——实际端口只能从日志文件里的 `dsh web: …` 就绪行拿到再确认。
   * 进程提前退出 / spawn 错误 / 90s 超时都会带上日志文件尾部作为错误详情。
   */
  private waitReady(child: ChildProcess, port: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let settled = false

      const cleanup = (): void => {
        clearTimeout(timer)
        clearInterval(poll)
        child.off('exit', onExit)
        child.off('error', onError)
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
          fail(new Error(`dsh 启动超时（${START_TIMEOUT_MS / 1000}s）\n${tail}`)),
        )
      }, START_TIMEOUT_MS)

      const onExit = (code: number | null): void => {
        void this.readLogTail().then((tail) => fail(new Error(`dsh 提前退出 (code=${code})\n${tail}`)))
      }
      const onError = (err: Error): void => {
        fail(new Error(`无法启动 dsh 进程: ${err.message}`))
      }
      child.once('exit', onExit)
      child.once('error', onError)

      const poll = setInterval(() => {
        void (async () => {
          let candidate = port
          if (candidate === 0) {
            const text = await fsp.readFile(this.logFile(), 'utf8').catch(() => '')
            const ready = parseReadyLine(text)
            if (!ready) return
            candidate = ready.port
          }
          const url = await probeDsh(candidate, this.logger)
          if (url) done(url)
        })()
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
    this.child = null
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
