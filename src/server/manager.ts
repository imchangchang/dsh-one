import * as vscode from 'vscode'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import * as crypto from 'node:crypto'
import * as os from 'node:os'
import { makeDescribeRequest, validateDescribeResponse } from '../pure/envelope.ts'
import { parseReadyLine } from '../pure/readyLine.ts'
import { gte } from '../pure/semver.ts'
import { ensureSession, ensureWorkspace } from './dshRpc.ts'
import { locateDsh } from './locateDsh.ts'
import type { Logger } from '../log.ts'

/** dsh learned --no-open in 0.1.0-rc.7; older builds exit on the unknown flag. */
const NO_OPEN_MIN_VERSION = '0.1.0-rc.7'
const START_TIMEOUT_MS = 90_000
const PROBE_TIMEOUT_MS = 3_000
const KILL_GRACE_MS = 5_000
const TAIL_LINES = 40

export type ServerState = 'stopped' | 'starting' | 'running' | 'error'

export interface ServerStatus {
  state: ServerState
  url?: string
  port?: number
  /** true when we connected to an already-running instance we must never kill. */
  adopted?: boolean
  error?: string
}

class TailBuffer {
  private lines: string[] = []
  push(chunk: string): void {
    this.lines.push(...chunk.split('\n'))
    if (this.lines.length > TAIL_LINES) this.lines.splice(0, this.lines.length - TAIL_LINES)
  }
  text(): string {
    return this.lines.join('\n').trim()
  }
}

/**
 * POST /api/host.describe and verify the rpcId echo — this is how we know a
 * port actually speaks dsh Gateway RPC (and isn't some other web server).
 */
export async function probeDsh(port: number, logger: Logger): Promise<string | null> {
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
      return `http://127.0.0.1:${port}`
    }
    logger.info(`probe: ${url} responded but failed rpcId validation`)
    return null
  } catch {
    return null
  }
}

/**
 * Owns the dsh web server lifecycle: probe-then-spawn, readiness detection,
 * and careful cleanup (only processes we spawned ourselves are ever killed).
 */
export class ServerManager implements vscode.Disposable {
  private status: ServerStatus = { state: 'stopped' }
  private child: ChildProcess | null = null
  /** PID of the process group we own; null when adopted or stopped. */
  private ownedPid: number | null = null
  private inflight: Promise<ServerStatus> | null = null
  private stopping = false

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
        this.setStatus({ state: 'error', error: message })
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

    // Probe before spawn: adopt an already-running dsh on the configured port.
    if (port > 0) {
      const adoptedUrl = await probeDsh(port, this.logger)
      if (adoptedUrl) {
        this.logger.info(`adopting existing dsh at ${adoptedUrl} (will never kill it)`)
        await this.preseedWorkspace(adoptedUrl)
        this.setStatus({ state: 'running', url: adoptedUrl, port, adopted: true })
        return this.status
      }
    }

    const dsh = await locateDsh(this.logger)
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir()

    // Sanitize the environment: the extension host injects NODE_OPTIONS /
    // ELECTRON_RUN_AS_NODE, both of which break a plain node child process.
    const env = { ...process.env }
    delete env.NODE_OPTIONS
    delete env.ELECTRON_RUN_AS_NODE

    const args = ['web', '--host', '127.0.0.1', '--port', String(port)]
    // --no-open only exists in dsh >= 0.1.0-rc.7; older versions would exit.
    // An unparseable version is treated as modern.
    if (dsh.version === 'unknown' || gte(dsh.version, NO_OPEN_MIN_VERSION)) {
      args.push('--no-open')
    }

    this.logger.info(`spawning: ${dsh.command} ${args.join(' ')} (cwd=${workspaceRoot})`)

    // .cmd shims cannot be spawned directly on Windows — route through a shell.
    const child = spawn(dsh.command, args, {
      cwd: workspaceRoot,
      env,
      windowsHide: true,
      detached: process.platform !== 'win32',
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.child = child
    this.ownedPid = child.pid ?? null

    const tail = new TailBuffer()
    child.stdout?.on('data', (d: Buffer) => {
      tail.push(d.toString())
      this.logger.info(`[dsh] ${d.toString().trimEnd()}`)
    })
    child.stderr?.on('data', (d: Buffer) => {
      tail.push(d.toString())
      this.logger.warn(`[dsh] ${d.toString().trimEnd()}`)
    })
    child.on('exit', (code, signal) => {
      this.logger.warn(`dsh process exited (code=${code}, signal=${signal})`)
      if (!this.stopping && this.status.state !== 'error') {
        this.setStatus({
          state: 'error',
          error: `dsh 意外退出 (code=${code}, signal=${signal})\n${tail.text()}`,
        })
        vscode.window.showErrorMessage('DSH One: dsh 服务意外退出', '查看日志', '重试').then((pick) => {
          if (pick === '查看日志') this.logger.show()
          if (pick === '重试') void this.ensureStarted()
        })
      }
      this.child = null
      this.ownedPid = null
    })

    const ready = await this.waitReady(child, tail)
    await this.preseedWorkspace(ready)
    this.setStatus({ state: 'running', url: ready, adopted: false, port: Number(new URL(ready).port) })
    this.logger.info(`dsh is ready at ${ready}`)
    return this.status
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
   * Readiness is double-confirmed: first the `dsh web: http://127.0.0.1:<port>`
   * stdout line tells us the real port, then a host.describe RPC must echo our
   * rpcId before we declare the server up.
   */
  private waitReady(child: ChildProcess, tail: TailBuffer): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let settled = false
      let buffer = ''
      let confirming = false

      const fail = (err: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(err)
      }
      const done = (url: string): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(url)
      }

      const timer = setTimeout(() => {
        fail(new Error(`dsh 启动超时（${START_TIMEOUT_MS / 1000}s）\n${tail.text()}`))
      }, START_TIMEOUT_MS)

      child.once('exit', (code) => {
        fail(new Error(`dsh 提前退出 (code=${code})\n${tail.text()}`))
      })

      child.once('error', (err) => {
        fail(new Error(`无法启动 dsh 进程: ${err.message}`))
      })

      child.stdout?.on('data', (d: Buffer) => {
        if (settled || confirming) return
        buffer += d.toString()
        const ready = parseReadyLine(buffer)
        if (!ready) return
        confirming = true
        const port = ready.port
        void probeDsh(port, this.logger).then((url) => {
          if (url) done(url)
          else fail(new Error(`端口 ${port} 未通过 host.describe 身份确认\n${tail.text()}`))
        })
      })
    })
  }

  /**
   * Kill only the process we spawned. Adopted instances are never touched.
   * Windows: taskkill /T /F. POSIX: SIGTERM the detached process group,
   * escalating to SIGKILL after `graceMs`.
   */
  private async killOwned(graceMs: number): Promise<void> {
    const child = this.child
    const pid = this.ownedPid
    if (!child || pid === null) return
    this.logger.info(`stopping dsh (pid=${pid})`)

    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
      return
    }
    try {
      process.kill(-pid, 'SIGTERM')
    } catch {
      return // already gone
    }
    const exited = await new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(false), graceMs)
      child.once('exit', () => {
        clearTimeout(t)
        resolve(true)
      })
    })
    if (!exited) {
      this.logger.warn(`dsh ignored SIGTERM for ${graceMs}ms, sending SIGKILL`)
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        // already gone
      }
    }
  }

  /**
   * Synchronous cleanup for deactivate(): VSCode may not wait for async work
   * when the window closes. SIGTERM is sent immediately; a detached reaper
   * escalates to SIGKILL after 3s even if the extension host exits first.
   */
  killSync(): void {
    const pid = this.ownedPid
    if (pid === null) return
    this.logger.info(`deactivate: terminating owned dsh (pid=${pid})`)
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      try {
        process.kill(-pid, 'SIGTERM')
      } catch {
        return
      }
      const reaper = spawn('sh', ['-c', `sleep 3 && kill -KILL -${pid} 2>/dev/null || true`], {
        detached: true,
        stdio: 'ignore',
      })
      reaper.unref()
    }
    this.ownedPid = null
    this.child = null
  }

  dispose(): void {
    this.killSync()
    this.onDidChangeStateEmitter.dispose()
  }
}
