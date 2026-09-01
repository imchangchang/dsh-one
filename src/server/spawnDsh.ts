// 短命启动器：被扩展拉起后，把 dsh 以 detached+unref spawn 出来并立刻退出。
// dsh 随即被 launchd 收养，从扩展宿主的进程树里消失——VS Code reload 时对
// 扩展宿主进程树的 SIGTERM 树杀（pgrep -P 递归）因此够不到 dsh。
// 用法: node spawnDsh.js <dshCommand> <logFile> <dshArgs...>
// 成功时 stdout 打印一行 dsh pid。
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'

const [dshCommand, logFile, ...args] = process.argv.slice(2)

// 扩展宿主为跑这段脚本可能注入 ELECTRON_RUN_AS_NODE（见 manager.ts 的 spawn）；
// 不删会传染给 dsh。
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.NODE_OPTIONS

// CI 实测：Windows-latest 上 spawn(detached + shell + stdio 传文件 fd) 的输出不落盘
//（dsh 正常启动、pid 正常打印，但日志文件 0 字节），改为 pipe 收集再写盘。
// POSIX 分支保持原逻辑（已实测有效）。
// DSH_FORCE_PIPE=1 可在任意平台强制走 pipe 分支，便于本地/CI 实测 pipe 路径
//（真实 win32 分支无法在 mac 上现跑）。
const usePipe = process.platform === 'win32' || process.env.DSH_FORCE_PIPE === '1'

// 确保 stdout 的 pid 真正 flush 后再退出：process.exit 不会等待异步 stdout 写，
// 末尾空写一个空 chunk 当屏障，等它回调时前面的 pid 已落到管道。
const flushExit = (code: number): void => {
  process.stdout.write('', () => process.exit(code))
}

if (!usePipe) {
  // POSIX：detached + stdio 直接进日志文件 fd。
  const logFd = fs.openSync(logFile, 'w')
  const child = spawn(dshCommand, args, {
    detached: true,
    shell: process.platform === 'win32',
    windowsHide: true,
    stdio: ['ignore', logFd, logFd],
    env,
  })
  child.unref()
  child.once('spawn', () => {
    fs.closeSync(logFd)
    process.stdout.write(`${child.pid}\n`, () => process.exit(0))
  })
  child.once('error', (err) => {
    fs.closeSync(logFd)
    process.stderr.write(String(err))
    process.exit(1)
  })
} else {
  // Windows / force-pipe：stdout+stderr 用 pipe 收集。detached+unref 保留，
  // dsh 脱离父进程树，启动器驻留与否不影响 dsh 安全。
  const child = spawn(dshCommand, args, {
    detached: true,
    shell: true,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  })
  child.unref()

  let buf = ''
  let completed = false
  let residencyTimer: NodeJS.Timeout | undefined

  const finish = (): void => {
    if (completed) return
    completed = true
    clearTimeout(residencyTimer)
    try {
      // 每次 spawn 都截断日志（与 POSIX 的 openSync 'w' 一致）。
      fs.writeFileSync(logFile, buf)
    } catch (err) {
      process.stderr.write(String(err))
      flushExit(1)
      return
    }
    flushExit(0)
  }

  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (d) => (buf += d))
  child.stderr?.on('data', (d) => (buf += d))
  // 子进程退出（--version 这类快速退出）提前落盘退；常驻服务管道永不 end，
  // 靠兜底定时器最多驻留 2s 后写盘退，不阻塞调用方（已收内容可能为空）。
  child.once('exit', finish)
  child.stdout?.on('end', finish)
  child.stderr?.on('end', finish)
  child.once('error', (err) => {
    if (completed) return
    completed = true
    clearTimeout(residencyTimer)
    process.stderr.write(String(err))
    flushExit(1)
  })
  child.once('spawn', () => {
    process.stdout.write(`${child.pid}\n`)
  })
  residencyTimer = setTimeout(finish, 2000)
}
