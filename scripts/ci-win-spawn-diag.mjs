// 临时诊断（spawn-dsh-windows-output-pipe 第三轮）：验证
// - P3': cmd /c 内部重定向（无引号路径）在 detached 下能否落盘
// - P3'': 带空格路径的内部引号能否被 cmd 正确解析
// - P4: node 直跑 dsh.js（resolveDshJs 同款路径推断）+ detached + fd 直传
// 数据拿到后本文件删除。
import { spawn, spawnSync } from 'node:child_process'
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

const main = async () => {
  const dir = os.tmpdir()
  const f = (n) => path.join(dir, n)
  const show = (p) => {
    console.log(`  ${p}=${fs.existsSync(p) ? JSON.stringify(fs.readFileSync(p, 'utf8')) : '(missing)'}`)
  }

  // P3'：cmd /c 内部重定向，路径无空格（不引号包裹）+ detached
  await run('P3_nospace_redir_detached', 'cmd.exe', ['/d', '/s', '/c', `dsh --version > ${f('p3.log')} 2>&1`], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  show(f('p3.log'))

  // P3''：带空格目录路径（内部引号）+ detached
  const spacedDir = path.join(dir, 'has space')
  fs.mkdirSync(spacedDir, { recursive: true })
  const spacedLog = path.join(spacedDir, 'p3s.log')
  await run('P3_spaced_redir_detached', 'cmd.exe', ['/d', '/s', '/c', `dsh --version > "${spacedLog}" 2>&1`], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  show(spacedLog)

  // P3' 无 detached 对照
  await run('P3_nospace_redir_nodetach', 'cmd.exe', ['/d', '/s', '/c', `dsh --version > ${f('p3nd.log')} 2>&1`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  show(f('p3nd.log'))

  // P4：node 直跑 dsh.js + detached + fd 直传（与新版 spawnDsh.ts win32 主路径一致）
  const where = spawnSync('cmd.exe', ['/d', '/s', '/c', 'where dsh.cmd'], { encoding: 'utf8' })
  const shim = (where.stdout ?? '').trim().split(/\r?\n/)[0]
  console.log(`  dsh.cmd=${shim || '(not found)'}`)
  const dshJs = shim ? path.join(path.dirname(shim), 'node_modules', '@deepseek-ai', 'dsh', 'bin', 'dsh.js') : ''
  console.log(`  dsh.js exists=${dshJs ? fs.existsSync(dshJs) : false} (${dshJs})`)
  if (dshJs && fs.existsSync(dshJs)) {
    const fd = fs.openSync(f('p4.log'), 'w')
    const c = spawn('node', [dshJs, '--version'], {
      detached: true,
      windowsHide: true,
      stdio: ['ignore', fd, fd],
    })
    c.unref()
    await new Promise((resolve) => {
      c.once('error', resolve)
      c.once('exit', resolve)
      setTimeout(resolve, 8000)
    })
    fs.closeSync(fd)
    show(f('p4.log'))
  }
  console.log('DIAG_DONE')
}

main()
