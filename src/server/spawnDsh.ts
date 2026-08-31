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

const logFd = fs.openSync(logFile, 'w')
const child = spawn(dshCommand, args, {
  detached: true,
  // .cmd shims cannot be spawned directly on Windows — route through a shell.
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
