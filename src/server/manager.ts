import * as vscode from 'vscode'
import { spawn, spawnSync } from 'node:child_process'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { parseReadyLine, type ReadyInfo } from '../pure/readyLine.ts'
import { gte } from '../pure/semver.ts'
import { locateDsh, DshNotFoundError } from './locateDsh.ts'
import { probePort, probeDsh, PROBE_TIMEOUT_MS } from './portProbe.ts'
import { exchangeToken, probeToken, clearAuth, cookieHeader } from './serverAuth.ts'
import {
  acquireOwnedLock,
  clearOwnedRecord,
  defaultOwnedPath,
  isExternalRecord,
  migrateOwnedRecord,
  readOwnedRecord,
  resolveOwnership,
  writeOwnedRecord,
} from './ownedRecord.ts'
import { findListenerPid, processCommandLine, isDshCommandLine, stopExternalPid, drainPort, pidAlive, probeDshVersionFromCommandLine } from './externalDsh.ts'
import type { OwnedRecord } from './ownedRecord.ts'
import type { Logger } from '../log.ts'

/** dsh learned --no-open in 0.1.0-rc.7; older builds exit on the unknown flag. */
const NO_OPEN_MIN_VERSION = '0.1.0-rc.7'
const START_TIMEOUT_MS = 90_000
const KILL_GRACE_MS = 5_000
const TAIL_LINES = 40
const HEALTH_INTERVAL_MS = 10_000
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
  /**
   * true 时连接的是外部启动的 dsh 实例（0.1.2 认证 token 粘贴连接或 error 态
   * 检测到但未连接）——可管理（停止/重启），但杀前必须确认弹窗 + 单 pid。
   */
  external?: boolean
  /** dsh version reported by `dsh --version` at locate time; absent for adopted instances. */
  version?: string
  error?: string
  /** Why startup failed; 'dshNotFound' = 未安装；'authDshNoToken' = 端口上是认证 dsh 且无 token（防护：报错不另起）。 */
  reason?: 'dshNotFound' | 'authDshNoToken'
}

/** Readiness result: the clean origin plus the launch token when it exists. */
export interface ReadyResult {
  url: string
  port: number
  token?: string
}

/**
 * Owns the dsh web server lifecycle: probe-then-spawn, readiness detection,
 * and careful cleanup (only processes we spawned ourselves are ever killed).
 * dsh 与 VSCode 窗口生命周期解绑：reload/关窗不再终止 dsh——spawn 时
 * detached + unref、stdio 进日志文件（管道读端随宿主退出会造成 EPIPE），
 * 身份经共享记录（`~/.dsh/dsh-owned.json`，见 ownedRecord.ts）跨宿主传递，
 * 下次激活时 re-own。0.1.2 认证起，记录里的 token 让第二个 user-data 的窗口
 * 也能认证式 adopt（adopted: true，绝不 kill——kill 权只归 spawn 的窗口）。
 */
export class ServerManager implements vscode.Disposable {
  private status: ServerStatus = { state: 'stopped' }
  /** PID of the process group we own; null when adopted or stopped. */
  private ownedPid: number | null = null
  /** 窗口身份：globalStorage 路径（per user-data）。reload 后同值 → 认回自己 spawn
   * 的实例（kill 权）；另一 user-data 的窗口不匹配 → adopted。 */
  private readonly ownerId: string
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
  ) {
    this.ownerId = context.globalStorageUri.fsPath
  }

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
      if (this.status.url) clearAuth(this.status.url)
      this.ownedPid = null
      this.setStatus({ state: 'stopped' })
      this.stopping = false
    }
  }

  /**
   * B 档：粘贴外部实例的 launch token 换票连接。成功后把 token 记入共享记录
   * （source:'external' / owned:false，不写 owner——kill 权不归任何窗口，
   * 停止/重启走 A 档确认弹窗），任意窗口下次激活都能凭 token 重连。
   * 换票失败抛错（token 无效/服务不应答），由命令层提示。
   */
  async connectExternalToken(token: string): Promise<ServerStatus> {
    const port = this.status.port
    const isExternalTarget = this.status.reason === 'authDshNoToken' || this.status.external === true
    if (port === undefined || !isExternalTarget) {
      throw new Error(vscode.l10n.t('No external dsh instance is waiting for a token'))
    }
    const origin = `http://127.0.0.1:${port}`
    // exchangeToken 失败即抛（HTTP 非 303 / 无 cookie）——token 与实例进程绑死，
    // 换不成就是 token 错、实例重启过或端口被别的程序占了。
    const auth = await exchangeToken(origin, token, this.logger)
    const pid = (await findListenerPid(port, this.logger)) ?? 0
    await writeOwnedRecord(
      defaultOwnedPath(),
      { pid, port, token: auth.token ?? token, source: 'external', owned: false },
      this.logger,
    )
    this.logger.info(`connected to external dsh at ${origin} (past launch token; pid=${pid})`)
    this.setStatus({ state: 'running', url: origin, port, external: true })
    this.startHealthCheck(port)
    return this.status
  }

  /**
   * A 档：停止外部实例——pid 探测（三平台）→ 杀前身份确认（命令行含 dsh 特征，
   * 否则拒绝）→ 只向单 pid 发信号（外部实例进程组是 shell 的，不能复用
   * killOwned 的进程组杀）。确认弹窗由命令层负责，这里不弹。
   */
  async stopExternal(): Promise<void> {
    const port = this.status.port
    // adopted（另一窗口 spawn 的实例）同样可停：单用户多窗口场景下两个窗口属于
    // 同一人，确认弹窗由命令层负责（提示可能影响正在使用它的窗口）。
    if (
      port === undefined ||
      (this.status.reason !== 'authDshNoToken' && this.status.external !== true && this.status.adopted !== true)
    ) {
      throw new Error(vscode.l10n.t('No external dsh instance is running'))
    }
    const pid = await findListenerPid(port, this.logger)
    if (pid === null) {
      throw new Error(vscode.l10n.t('Could not find the process listening on port {0}', port))
    }
    const cmdline = processCommandLine(pid)
    if (cmdline === null || !isDshCommandLine(cmdline)) {
      throw new Error(vscode.l10n.t('Process {0} on port {1} does not look like dsh; stopping it was refused', pid, port))
    }
    this.stopHealthCheck()
    await stopExternalPid(pid, KILL_GRACE_MS, this.logger)
    // 等端口真正释放再收尾：SIGTERM 后 listener 关闭与进程退出有竞态，直接
    // 紧接 ensureStarted 的 probe 可能还看到 401（authDsh）而误判。
    await drainPort(port, this.logger)
    if (this.status.url) clearAuth(this.status.url)
    await this.clearOwned()
    this.setStatus({ state: 'stopped' })
    this.logger.info(`external dsh stopped (pid=${pid}, port=${port})`)
  }

  /** 重启外部实例 = A 档停止 + 扩展 spawn 新实例（新实例归扩展管理，后续免确认）。 */
  async restartExternal(): Promise<ServerStatus> {
    await this.stopExternal()
    return this.ensureStarted()
  }

  private async start(): Promise<ServerStatus> {
    this.setStatus({ state: 'starting' })
    const cfg = vscode.workspace.getConfiguration('dshOne')
    const port = cfg.get<number>('port', 3080)
    // 关键段锁：串行化「读记录 → 判定 → spawn → 落盘」（见 ownedRecord.ts）——
    // 两个窗口同时启动时后到者等前一个落盘后按记录 adopt，不会各自 spawn 出双实例。
    const lock = await acquireOwnedLock(defaultOwnedPath(), this.logger)
    try {
      return await this.startLocked(port)
    } finally {
      lock.release()
    }
  }

  private async startLocked(port: number): Promise<ServerStatus> {
    // 升级路径：旧 build 把记录写在 globalStorage（per user-data，窗口隔离），
    // 一次性迁到共享位置——owner 补成当前窗口，升级后 reload 仍认回自己的实例。
    await this.migrateLegacyRecord()

    // Re-own/adopt 优先：共享记录里上一次 spawn 的 dsh 身份（reload 或第二窗口
    // 场景）。pid 存活 + 端口身份确认（token 换票 / host.describe）才认领。
    // owner 与当前窗口一致 → 上一个宿主会话 spawn 的实例，re-own 并保留 kill 权；
    // owner 不同 → 另一窗口的实例，认证式 adopted（adopted:true，绝不 kill）。
    // source==='external' → 用户粘贴 token 连接的外部实例（B 档）：token 换票是
    // 身份闸，成功后 external:true（可管理需确认，kill 权不归窗口）。
    // 已知风险（已拍板接受）：dsh 死亡后 pid 被系统复用、且端口又被另一个手动
    // 启动的 dsh 占用时，stop 会误杀复用 pid 的进程组——host.describe 不含
    // pid，无法更严格地验证。
    const owned = await readOwnedRecord(defaultOwnedPath(), this.logger)
    if (owned) {
      if (isExternalRecord(owned) && owned.token) {
        // 外部实例重启后 token 必失效（token 只被生成它的进程换出 303），
        // 所以探票失败即清记录走探测流程；pid 存活不作闸（pid 可能被复用）。
        const ownedPort = owned.port > 0 ? owned.port : await this.readyPortFromLog()
        if (ownedPort !== null) {
          const ownedUrl = `http://127.0.0.1:${ownedPort}`
          if ((await probeToken(ownedUrl, owned.token, this.logger)) !== null) {
            this.logger.info(`connecting to external dsh at ${ownedUrl} (past launch token, pid=${owned.pid})`)
            this.setStatus({
              state: 'running',
              url: ownedUrl,
              port: ownedPort,
              external: true,
              version: probeDshVersionFromCommandLine(processCommandLine(owned.pid), this.logger),
            })
            this.startHealthCheck(ownedPort)
            return this.status
          }
          this.logger.info('external dsh record token no longer valid, clearing it')
        }
        await this.clearOwned()
      } else {
        const alive = pidAlive(owned.pid)
        const ownerLabel = owned.owner === undefined
          ? 'unknown'
          : owned.owner === this.ownerId ? 'this window' : 'another window'
        this.logger.info(`shared pidfile found: pid=${owned.pid} port=${owned.port} alive=${alive} owner=${ownerLabel}`)
        if (alive) {
          // port=0（系统分配）时记录里没有实际端口，从日志文件的就绪行拿。
          const ownedPort = owned.port > 0 ? owned.port : await this.readyPortFromLog()
          if (ownedPort !== null) {
            const ownedUrl = `http://127.0.0.1:${ownedPort}`
            const ownership = resolveOwnership(owned, this.ownerId)
            // 0.1.2 记录的 token：换到 cookie 既证明进程身份也完成认证（stdout 已随
            // 旧宿主丢失）。第二窗口拿到 token 同样能换票——这正是跨窗口 adopt 的前提。
            if (owned.token) {
              const auth = await probeToken(ownedUrl, owned.token, this.logger)
              if (auth !== null) {
                if (ownership === 'own') {
                  this.logger.info(`re-owning authenticated dsh at ${ownedUrl} (pid=${owned.pid}, spawned by this window's previous session)`)
                  this.ownedPid = owned.pid
                  this.setStatus({ state: 'running', url: ownedUrl, port: ownedPort, adopted: false, version: owned.version })
                  this.startHealthCheck(ownedPort)
                  return this.status
                }
                this.logger.info(`adopting another window's authenticated dsh at ${ownedUrl} (pid=${owned.pid}, will never kill it)`)
                this.setStatus({
                  state: 'running',
                  url: ownedUrl,
                  port: ownedPort,
                  adopted: true,
                  // 另一窗口 spawn 的实例：版本优先用 shared 记录（spawn 时已存）；
                  // 旧记录无 version（或外部记录）→ 从实例命令行解析真实入口查询，
                  // 不用扩展 PATH 的 dsh 近似（多安装会误导）。
                  version: owned.version ?? probeDshVersionFromCommandLine(processCommandLine(owned.pid), this.logger),
                })
                this.startHealthCheck(ownedPort)
                return this.status
              }
            } else if ((await probePort(ownedPort, this.logger)) === 'dsh') {
              if (ownership === 'own') {
                this.logger.info(`re-owning dsh at ${ownedUrl} (pid=${owned.pid}, spawned by this window's previous session)`)
                this.ownedPid = owned.pid
                this.setStatus({ state: 'running', url: ownedUrl, port: ownedPort, adopted: false, version: owned.version })
                this.startHealthCheck(ownedPort)
                return this.status
              }
              this.logger.info(`adopting another window's dsh at ${ownedUrl} (pid=${owned.pid}, will never kill it)`)
              this.setStatus({
                state: 'running',
                url: ownedUrl,
                port: ownedPort,
                adopted: true,
                version: owned.version ?? probeDshVersionFromCommandLine(processCommandLine(owned.pid), this.logger),
              })
              this.startHealthCheck(ownedPort)
              return this.status
            } else {
              // 0.1.2 认证实例 + 记录无 token：多半是 spawn 后 waitReady 未完成时
              // 窗口被关闭/reload（Windows 冷启动 60s+ 常见），399 行 token 补写
              // 没执行——就绪行（含 token）已写进 logFile，从这里恢复换票：
              // 换票成功 = 端口实例真实身份（token 只被该进程换出），补写记录
              // re-own/adopt 自愈；失败则落空走原来的 clear + 防护。
              const recovered = await this.tokenFromLog()
              if (recovered !== undefined) {
                const auth = await probeToken(ownedUrl, recovered, this.logger)
                if (auth !== null) {
                  const livePid = (await findListenerPid(ownedPort, this.logger)) ?? owned.pid
                  await this.writeOwned({ pid: livePid, port: ownedPort, token: recovered, version: owned.version })
                  if (ownership === 'own') {
                    this.logger.info(
                      `re-owning authenticated dsh at ${ownedUrl} (token recovered from log; pid=${owned.pid})`,
                    )
                    this.ownedPid = livePid
                    this.setStatus({ state: 'running', url: ownedUrl, port: ownedPort, adopted: false, version: owned.version })
                    this.startHealthCheck(ownedPort)
                    return this.status
                  }
                  this.logger.info(
                    `adopting another window's authenticated dsh at ${ownedUrl} (token recovered from log, will never kill it)`,
                  )
                  this.setStatus({ state: 'running', url: ownedUrl, port: ownedPort, adopted: true, version: owned.version })
                  this.startHealthCheck(ownedPort)
                  return this.status
                }
                this.logger.info(`token recovered from log but exchange failed (port=${ownedPort}); falling through`)
              }
            }
          }
        }
        // 记录过期（pid 已死/端口不应答/token 失效），清掉走正常流程。
        // 注意 external 记录不删 owner（本就没有）——clearOwned 删的是整份记录。
        await this.clearOwned()
      }
    } else {
      this.logger.info('no shared pidfile found, falling through to probe/spawn')
    }

    // Probe before spawn: adopt an already-running dsh on the configured port;
    // when a foreign service occupies it, fall back to a nearby free port
    // (runtime-only substitution, the user's setting is never rewritten).
    let spawnPort = port
    if (port > 0) {
      const probe = await probePort(port, this.logger)
      if (probe === 'dsh') {
        const adoptedUrl = `http://127.0.0.1:${port}`
        this.logger.info(`adopting existing dsh at ${adoptedUrl} (will never kill it)`)
        // 无 shared 记录（纯探测 adopt，如 0.1.1 无认证实例）：从监听 pid 命令行
        // 解析真实入口查询版本；探测失败就不显示（不拿扩展 PATH 的 dsh 近似）。
        const listenerPid = await findListenerPid(port, this.logger)
        this.setStatus({
          state: 'running',
          url: adoptedUrl,
          port,
          adopted: true,
          version: listenerPid === null
            ? undefined
            : probeDshVersionFromCommandLine(processCommandLine(listenerPid), this.logger),
        })
        // 不再 preseed：影响方向是 dsh → VS Code 单向，当前文件夹不在 dsh
        // 工作区列表里就什么都不做（不注册、不建会话），被用户删掉的工作区
        // 不再在 reload 后复活。已知配套变化：当前文件夹无 dsh 会话时
        // sessionsStore.latestCurrentSessionId() 返回 null，聊天面板停在
        // 空态（extension.ts 的 auto-attach 对 null 天然跳过），用户手动
        // 选会话即可。
        this.startHealthCheck(port)
        return this.status
      }
      if (probe === 'authDsh') {
        // 防护（用户已拍板，见 external-dsh-manage-012）：端口上是无凭证的认证
        // dsh（外部启动，token 只在它的终端 URL/stdout，扩展拿不到）——报错
        // 不另起，不再换端口 spawn 双实例。tooltip 提供「粘贴 token / 停止 /
        // 重启」管理入口（A/B 档）；错误态携带 port 供命令定位目标。
        const message = vscode.l10n.t(
          'Port {0} runs an authenticated dsh instance started outside this extension. Paste its launch token to connect, or stop it first.',
          port,
        )
        this.logger.warn(`port ${port} runs an authenticated dsh without a launch token; refusing to start a second instance`)
        this.setStatus({ state: 'error', error: message, reason: 'authDshNoToken', port })
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
    await this.writeOwned({ pid: dshPid, port: spawnPort, version: dsh.version })

    const ready = await this.waitReady(dshPid, spawnPort)
    const actualPort = ready.port
    if (ready.token !== undefined) {
      // 0.1.2：token 已随就绪行拿到并完成换票（auth 注册在 exchangeToken 内）。
      // 持久化 token 供下次 re-own（stdout 届时已丢）。
      await this.writeOwned({ pid: dshPid, port: actualPort, token: ready.token, version: dsh.version })
    } else if (actualPort !== spawnPort) {
      // port=0 时启动后才知道实际端口，回填 pidfile 供下次 re-own。
      await this.writeOwned({ pid: dshPid, port: actualPort, version: dsh.version })
    }
    this.setStatus({ state: 'running', url: ready.url, adopted: false, port: actualPort, version: dsh.version })
    this.startHealthCheck(actualPort)
    this.logger.info(`dsh is ready at ${ready.url}`)
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
   * Post-ready health check (dsh-vscode's design): probe every 10s; a lost
   * server — including an adopted instance we do not own — drops the status
   * back to stopped so the UI stops claiming "running". The interval is short
   * on purpose: users close their own terminal-started `dsh web` and expect
   * the status bar to follow quickly, not after half a minute. An owned child
   * that stops answering is killed so the next start gets its port back.
   */
  private startHealthCheck(port: number): void {
    this.stopHealthCheck()
    const origin = `http://127.0.0.1:${port}`
    this.healthTimer = setInterval(() => {
      const cookie = cookieHeader(origin)
      const probe = cookie !== undefined
        ? fetch(origin, {
            headers: { cookie },
            signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
          }).then((res) => (res.ok ? origin : null)).catch(() => null)
        : probeDsh(port, this.logger)
      void probe.then(async (url) => {
        if (url || this.status.state !== 'running') return
        this.logger.warn(`health probe failed on :${port}; marking the server stopped`)
        this.stopHealthCheck()
        clearAuth(origin)
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
   * Readiness by polling the dsh log file for the `dsh web: …` line.
   * 0.1.1：就绪行带端口，随后 probeDsh（host.describe）确认；0.1.2：就绪行
   * 带 launch token，GET /?token= 的 303 既是「服务已就绪」也是换票本身。
   * 进程提前退出（pid 消失）/ 90s 超时都会带上日志文件尾部作为错误详情。
   * 双层 spawn 后扩展不再持有 dsh 的进程句柄，早退只能靠 pid 存活判断。
   */
  private waitReady(pid: number, port: number): Promise<ReadyResult> {
    return new Promise<ReadyResult>((resolve, reject) => {
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
      const done = (ready: ReadyResult): void => {
        if (settled) return
        settled = true
        cleanup()
        resolve(ready)
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
          const text = await fsp.readFile(this.logFile(), 'utf8').catch(() => '')
          const info = parseReadyLine(text)
          if (!info) return
          const origin = new URL(info.url).origin
          if (info.token !== undefined) {
            // 换票失败（打印行与服务就绪之间的瞬时竞态）下一轮重试。
            try {
              await exchangeToken(origin, info.token, this.logger)
              done({ url: origin, port: info.port, token: info.token })
            } catch {
              /* retry next poll */
            }
            return
          }
          const url = await probeDsh(info.port, this.logger)
          if (url) done({ url, port: info.port })
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

  /** 写共享记录（~/.dsh/dsh-owned.json），owner = 当前窗口身份——kill 权只记给 spawn 方。 */
  private async writeOwned(record: OwnedRecord): Promise<void> {
    await writeOwnedRecord(defaultOwnedPath(), { ...record, owner: this.ownerId }, this.logger)
  }

  /** 清共享记录 + 旧 globalStorage 位置（迁移后应为空，force 兜底）。 */
  private async clearOwned(): Promise<void> {
    await clearOwnedRecord(defaultOwnedPath())
    await clearOwnedRecord(path.join(this.context.globalStorageUri.fsPath, 'dsh-owned.json'))
  }

  /** 旧 globalStorage pidfile → 共享位置一次性迁移（见 ownedRecord.ts）。 */
  private async migrateLegacyRecord(): Promise<void> {
    await migrateOwnedRecord(
      path.join(this.context.globalStorageUri.fsPath, 'dsh-owned.json'),
      defaultOwnedPath(),
      this.ownerId,
      this.logger,
    )
  }

  /** port=0 spawn 的实际端口只能从日志文件的就绪行解析（读前 64KB）；读不到返回 null。 */
  private async readyPortFromLog(): Promise<number | null> {
    return (await this.readyInfoFromLog())?.port ?? null
  }

  /** 日志文件里的 launch token（若就绪行带 token）；读不到返回 undefined。 */
  private async tokenFromLog(): Promise<string | undefined> {
    const info = await this.readyInfoFromLog()
    if (info === null) return undefined
    return info.token
  }

  /** 读日志文件头部（≤64KB）解析就绪行（URL/port/token）。 */
  private async readyInfoFromLog(): Promise<ReadyInfo | null> {
    try {
      const handle = await fsp.open(this.logFile(), 'r')
      try {
        const buf = Buffer.alloc(64 * 1024)
        const { bytesRead } = await handle.read(buf, 0, buf.length, 0)
        return parseReadyLine(buf.toString('utf8', 0, bytesRead))
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
   * dsh 不随扩展宿主退出——它由共享记录（~/.dsh/dsh-owned.json）记录身份，
   * 下个窗口 re-own/adopt；只有用户显式 dshOne.stop / dshOne.restart 才会杀它
   * （且只有持有该记录 owner 的窗口才会真正 kill）。
   */
  dispose(): void {
    this.stopHealthCheck()
    this.onDidChangeStateEmitter.dispose()
  }
}
