// 临时诊断（spawn-dsh-windows-output-pipe 第二轮）：验证 detached 下
// cmd 内部重定向能否落盘、detached 是否断一切 stdio 输出。
// 数据拿到后本文件删除。
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const run = (label, cmd, args, opts, timeoutMs = 8000) =>
  new Promise((resolve) => {
    const t0 = Date.now()
    const c = spawn(cmd, args, { windowsHide: true, ...opts })
    let out = ''
    let err = ''
    let settled = false
    const done = (tag) => {
      if (settled) return
      settled = true
      console.log(
        `[${label}] ${tag} code=${c.exitCode ?? '?'} elapsed=${Date.now() - t0}ms out="${out.trim()}" err="${err.trim()}"`,
      )
      try {
        c.kill()
      } catch {}
      resolve()
    }
    c.stdout?.on('data', (d) => (out += d))
    c.stderr?.on('data', (d) => (err += d))
    c.on('error', (e) => done('error=' + e.message))
    c.on('exit', (code) => done('exit'))
    setTimeout(() => done('timeout'), timeoutMs)
  })

const f = (n) => path.join(os.tmpdir(), n)
const show = (n) => {
  const p = f(n)
  console.log(`  ${n}=${fs.existsSync(p) ? JSON.stringify(fs.readFileSync(p, 'utf8')) : '(missing)'}`)
}

const main = async () => {
  // F1（核心）：detached + cmd 内部重定向——生产实现（spawnDsh.ts win32 分支）的同款路径
  await run(
    'F1_cmd_redir_detached',
    'cmd.exe',
    ['/d', '/s', '/c', `dsh --version > "${f('f1.log')}" 2>&1`],
    { detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  show('f1.log')
  // F2：detached + node 直跑 + pipe——detached 下 node 自己的输出能否读到
  await run('F2_node_detached_pipe', process.execPath, ['-e', "console.log('NODE_DETACHED_OUT')"], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  // F3：无 detached + cmd 内部重定向——对照
  await run('F3_cmd_redir_nodetach', 'cmd.exe', ['/d', '/s', '/c', `dsh --version > "${f('f3.log')}" 2>&1`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  show('f3.log')
  // F4：detached + 进程自己写文件（不经 stdout）——确认 detached 进程本身可工作
  await run(
    'F4_node_self_write',
    process.execPath,
    ['-e', `require('node:fs').writeFileSync(${JSON.stringify(f('f4.txt'))}, 'SELF_WRITE_OK')`],
    { detached: true, stdio: 'ignore' },
  )
  show('f4.txt')
  console.log('DIAG_DONE')
}

main()
