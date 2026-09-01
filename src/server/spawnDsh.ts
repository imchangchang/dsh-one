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

// 确保 stdout 的 pid 真正 flush 后再退出：process.exit 不会等待异步 stdout 写，
// 末尾空写一个空 chunk 当屏障，等它回调时前面的 pid 已落到管道。
const flushExit = (code: number): void => {
  process.stdout.write('', () => process.exit(code))
}

if (process.platform === 'win32') {
  // Windows：dsh 是 .cmd shim，必须经 cmd.exe 执行。CI 实测（node 22，
  // windows-latest）detached（DETACHED_PROCESS）下子进程 stdio 输出链断裂：
  // pipe 收集、文件 fd 直传均 0 字节；与包装方式无关（Node shell:true 自动
  // 包装 / 显式 cmd.exe /c / PowerShell 通道均无输出，去掉 detached 立即正常）。
  // 因此日志输出不依赖 stdio 句柄传递：重定向（> log 2>&1）由 cmd 自己完成，
  // 启动器在 spawn 事件后立即退出；dsh 常驻时由 cmd 持续写日志文件。
  // 每次 spawn 用 > 截断日志（与 POSIX 的 openSync 'w' 一致）。
  const quote = (s: string): string => (/\s/.test(s) ? `"${s}"` : s)
  const cmdLine = [quote(dshCommand), ...args.map(quote), '>', quote(logFile), '2>&1'].join(' ')
  const child = spawn('cmd.exe', ['/d', '/s', '/c', cmdLine], {
    detached: true,
    shell: false,
    windowsHide: true,
    stdio: 'ignore',
    env,
  })
  child.unref()
  child.once('spawn', () => {
    process.stdout.write(`${child.pid}\n`, () => process.exit(0))
  })
  child.once('error', (err) => {
    process.stderr.write(String(err))
    process.exit(1)
  })
} else if (process.env.DSH_FORCE_PIPE === '1') {
  // 调试开关：任意平台强制走 pipe 收集路径（原生 shell 包装），
  // 用于本地/CI 实测 pipe 路径；真实 win32 分支无法在 mac 上现跑。
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
} else {
  // POSIX：detached + stdio 直接进日志文件 fd。
  const logFd = fs.openSync(logFile, 'w')
  const child = spawn(dshCommand, args, {
    detached: true,
    shell: false,
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
}
