import { spawnSync } from 'node:child_process'
import * as fsp from 'node:fs/promises'
import { probePort } from './portProbe.ts'
import { parseDshEntryFromCommandLine, extractDshVersion } from '../pure/dshCommandLine.ts'
import type { Logger } from '../log.ts'

/**
 * 外部启动的 dsh 实例管理（A 档）：pid 探测 / 身份确认 / 单 pid 停止。
 *
 * 与 killOwned 的进程组杀法（manager.ts）不同：外部实例多半在终端的 shell
 * 里 `dsh web` 拉起，进程组是 shell 的——`process.kill(-pid)` 会把 shell 及
 * 同组任务一起杀。这里只向**单 pid** 发信号（调研结论 adopted-dsh-takeover：
 * dsh web 在 CLI 进程内同进程启动 web app，且装了 SIGTERM/SIGINT handler，
 * 单发 SIGTERM 即走 dsh 自己的优雅关闭；Windows 无信号，`taskkill /T /F`
 * 硬杀，无优雅路径）。
 *
 * 不 import vscode，便于 node --test 直接单测（解析函数走纯文本）。
 */

/** process.kill(pid, 0) liveness probe: ESRCH = gone, EPERM = alive but not ours. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

const CMD_TIMEOUT_MS = 5_000

/**
 * 探测在 `port` 上 LISTEN 的进程 pid（通常一个）。
 * macOS：`lsof -tiTCP:<port> -sTCP:LISTEN`；
 * Windows：`netstat -ano`（解析 LISTENING 行）；
 * Linux：/proc/net/tcp(+tcp6) 的 0A=LISTEN 行拿 inode，再扫 /proc/<pid>/fd
 * 的 socket:[inode] 对照（不依赖 lsof）。
 */
export async function findListenerPid(port: number, logger: Logger): Promise<number | null> {
  if (process.platform === 'darwin') {
    const res = spawnSync('lsof', ['-ti', `TCP:${port}`, '-s', 'TCP:LISTEN'], {
      timeout: CMD_TIMEOUT_MS,
      encoding: 'utf8',
      windowsHide: true,
    })
    if (res.error) {
      logger.warn(`lsof failed: ${res.error.message}`)
      return null
    }
    return parseLsofPids(res.stdout)[0] ?? null
  }
  if (process.platform === 'win32') {
    const res = spawnSync('netstat', ['-ano'], {
      timeout: CMD_TIMEOUT_MS,
      encoding: 'utf8',
      windowsHide: true,
    })
    if (res.error) {
      logger.warn(`netstat failed: ${res.error.message}`)
      return null
    }
    return parseNetstatPids(res.stdout, port)[0] ?? null
  }
  const inodes = new Set<string>()
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    const text = await fsp.readFile(file, 'utf8').catch(() => '')
    for (const row of parseProcTcpListeners(text)) {
      if (row.port === port) inodes.add(row.inode)
    }
  }
  if (inodes.size === 0) return null
  const pids = (await fsp.readdir('/proc').catch(() => [])).filter((n) => /^\d+$/.test(n))
  for (const pid of pids) {
    const fds = await fsp.readdir(`/proc/${pid}/fd`).catch(() => [])
    for (const fd of fds) {
      const link = await fsp.readlink(`/proc/${pid}/fd/${fd}`).catch(() => '')
      const inode = socketInodeFromFdLink(link)
      if (inode !== null && inodes.has(inode)) return Number(pid)
    }
  }
  return null
}

/** macOS lsof `-tiTCP:<port> -sTCP:LISTEN` 的输出：每行一个纯数字 pid。 */
export function parseLsofPids(output: string): number[] {
  return output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^\d+$/.test(l))
    .map(Number)
}

/** Windows `netstat -ano` 输出中匹配端口的 LISTENING 行 → pid 列表。 */
export function parseNetstatPids(output: string, port: number): number[] {
  const pids: number[] = []
  for (const line of output.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/)
    if (cols.length < 5 || cols[0].toUpperCase() !== 'TCP') continue
    if (cols[3].toUpperCase() !== 'LISTENING') continue
    const localPort = Number(cols[1].slice(cols[1].lastIndexOf(':') + 1))
    if (localPort !== port) continue
    const pid = Number(cols[cols.length - 1])
    if (Number.isInteger(pid) && pid > 0) pids.push(pid)
  }
  return pids
}

export interface ProcTcpListener {
  port: number
  inode: string
}

/**
 * 解析 /proc/net/tcp(+tcp6) 的 LISTEN 行（state 0A）：
 * 行字段 sl local_address rem_address st tx_queue:rx_queue tr:tm->when retrnmt
 * uid timeout inode …——local_address 是 `HEXIP:HEXPORT`，尾部 inode 是 socket inode。
 */
export function parseProcTcpListeners(text: string): ProcTcpListener[] {
  const rows: ProcTcpListener[] = []
  for (const line of text.split('\n').slice(1)) {
    const f = line.trim().split(/\s+/)
    if (f.length < 10 || f[3] !== '0A') continue
    const port = Number.parseInt(f[1].split(':')[1] ?? '', 16)
    if (!Number.isFinite(port)) continue
    const inode = f[9]
    if (!inode) continue
    rows.push({ port, inode })
  }
  return rows
}

/** `/proc/<pid>/fd/<n>` 符号链接 `socket:[inode]` → inode 数字字符串；非 socket 返回 null。 */
export function socketInodeFromFdLink(link: string): string | null {
  const m = /^socket:\[(\d+)\]$/.exec(link)
  return m ? m[1] : null
}

/**
 * 杀前身份确认：pid 的完整命令行（POSIX `ps -p <pid> -o command=`；
 * Windows PowerShell `Get-CimInstance Win32_Process`）。读取失败返回 null。
 */
export function processCommandLine(pid: number): string | null {
  if (process.platform === 'win32') {
    const script = `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object -ExpandProperty CommandLine`
    const res = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: CMD_TIMEOUT_MS, encoding: 'utf8', windowsHide: true },
    )
    return res.status === 0 ? res.stdout.trim() || null : null
  }
  const res = spawnSync('ps', ['-p', String(pid), '-o', 'command='], {
    timeout: CMD_TIMEOUT_MS,
    encoding: 'utf8',
    windowsHide: true,
  })
  return res.status === 0 ? res.stdout.trim() || null : null
}

/** `--version` 查询超时；实例卡死时也保证 tooltip 组装有界。 */
const VERSION_TIMEOUT_MS = 5_000

/**
 * 探询一个「外部启动/收养实例」的真实版本：从其命令行解析 dsh 入口并执行
 * `--version`（与扩展 PATH 无关，避免多安装误导）。解析或执行失败返回
 * undefined（调用方不显示版本）；版本串提取失败返回 'unknown'。
 *
 * 与 locateDsh 同款 env 清理：扩展宿主注入的 NODE_OPTIONS /
 * ELECTRON_RUN_AS_NODE 会破坏子进程（node 直跑 bin.js 场景）。
 */
export function probeDshVersionFromCommandLine(
  cmdline: string | null,
  logger: Logger,
): string | undefined {
  if (!cmdline) return undefined
  const entry = parseDshEntryFromCommandLine(cmdline)
  if (!entry) {
    logger.info(`dsh version probe skipped: cannot resolve dsh entry from command line: ${cmdline.slice(0, 120)}`)
    return undefined
  }
  const env = { ...process.env }
  delete env.NODE_OPTIONS
  delete env.ELECTRON_RUN_AS_NODE
  const res = spawnSync(entry.command, [...entry.args, '--version'], {
    shell: process.platform === 'win32',
    env,
    encoding: 'utf8',
    timeout: VERSION_TIMEOUT_MS,
  })
  if (res.error || res.status !== 0) {
    logger.info(`dsh version probe failed (exit=${res.status ?? 'err'}): ${entry.command} ${entry.args.join(' ')}`)
    return undefined
  }
  return extractDshVersion(`${res.stdout ?? ''}\n${res.stderr ?? ''}`)
}

/**
 * 命令行含 dsh 特征才允许杀（降低「pid/端口被复用」的误杀窗口；理论竞态
 * 消不掉——与 owned pidfile 误杀窗同类，architecture.md 决策 1 已接受）。
 * 特征：安装在 `@deepseek-ai/dsh` 包路径（npm 全局/本地），或路径段名为
 * dsh / dsh.js / dsh.cmd / dsh.exe（本地 checkout）。
 */
export function isDshCommandLine(cmdline: string): boolean {
  const c = cmdline.toLowerCase()
  if (/@deepseek-ai[\\/]dsh/.test(c)) return true
  return /(^|[\s"'/\\])(dsh|dsh\.js|dsh\.cmd|dsh\.exe)([\s"'\\/]|$)/.test(c)
}

const KILL_POLL_MS = 100

/** 停止外部实例：只向单 pid 发信号（POSIX SIGTERM 优雅关闭，graceMs 后 SIGKILL；Windows taskkill /T /F）。 */
export async function stopExternalPid(pid: number, graceMs: number, logger: Logger): Promise<void> {
  logger.info(`stopping external dsh (pid=${pid}, single-process signal)`)
  if (process.platform === 'win32') {
    // Windows 无信号，dsh 的 SIGTERM handler 收不到 → taskkill /T /F 硬杀（无优雅路径）。
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    return
  }
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    // already gone
  }
  const deadline = Date.now() + graceMs
  while (pidAlive(pid) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, KILL_POLL_MS))
  }
  if (pidAlive(pid)) {
    logger.warn(`external dsh ignored SIGTERM for ${graceMs}ms, sending SIGKILL`)
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // already gone
    }
  }
}

/** 等待端口不再应答（进程死后 listener 异步关闭的竞态窗口）；超时最多 `waitMs`，不抛错。 */
export async function drainPort(port: number, logger: Logger, waitMs = 5_000): Promise<void> {
  const deadline = Date.now() + waitMs
  for (;;) {
    if ((await probePort(port, logger)) === 'down') return
    if (Date.now() >= deadline) {
      logger.warn(`port ${port} still answering ${waitMs}ms after the stop; proceeding`)
      return
    }
    await new Promise((r) => setTimeout(r, KILL_POLL_MS))
  }
}
