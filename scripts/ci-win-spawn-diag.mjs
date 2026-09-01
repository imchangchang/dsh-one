// 临时诊断（spawn-dsh-windows-output-pipe 第四轮）：搞清 dsh.cmd 真实内容与
// npm 全局包结构，修正 node 直跑的路径推断；并复测 cmd 重定向 detached 行为。
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

const cmdSync = (line) => spawnSync('cmd.exe', ['/d', '/s', '/c', line], { encoding: 'utf8' })

const main = async () => {
  const dir = os.tmpdir()
  const f = (n) => path.join(dir, n)
  const show = (p) => {
    console.log(`  ${p}=${fs.existsSync(p) ? JSON.stringify(fs.readFileSync(p, 'utf8')) : '(missing)'}`)
  }

  // 1) dsh.cmd 位置与完整内容（关键）
  const where = cmdSync('where dsh.cmd')
  const shim = (where.stdout ?? '').trim().split(/\r?\n/)[0]
  console.log(`  dsh.cmd=${shim || '(not found)'}`)
  if (shim && fs.existsSync(shim)) {
    console.log('  --- dsh.cmd content ---')
    console.log(fs.readFileSync(shim, 'utf8'))
    console.log('  --- end ---')
  }
  // 2) npm prefix 与包结构
  const prefix = (cmdSync('npm prefix -g').stdout ?? '').trim()
  console.log(`  npm prefix -g=${prefix}`)
  const pkgRoot = path.join(prefix, 'node_modules', '@deepseek-ai', 'dsh')
  console.log(`  pkg dir exists=${fs.existsSync(pkgRoot)} (${pkgRoot})`)
  if (fs.existsSync(pkgRoot)) {
    const walk = (p, depth) => {
      if (depth > 2) return
      let entries
      try {
        entries = fs.readdirSync(p, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        console.log(`  ${'  '.repeat(depth)}${e.name}${e.isDirectory() ? '/' : ''}`)
        if (e.isDirectory()) walk(path.join(p, e.name), depth + 1)
      }
    }
    walk(pkgRoot, 0)
  }
  // 3) P4 候选：node 直跑 bin/dsh.js（若存在）+ detached + fd 直传
  const candidates = [
    path.join(pkgRoot, 'bin', 'dsh.js'),
    path.join(pkgRoot, 'bin', 'dsh.mjs'),
    path.join(pkgRoot, 'bin', 'index.js'),
    path.join(pkgRoot, 'lib', 'dsh.js'),
  ]
  const js = candidates.find((p) => fs.existsSync(p)) ?? null
  console.log(`  resolved dsh entry=${js ?? '(none)'}`)
  if (js) {
    const fd = fs.openSync(f('p4.log'), 'w')
    const c = spawn('node', [js, '--version'], {
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
  // 4) 复测：cmd /c 重定向 + detached（对照，确认仍空）
  await run('P3_nospace_redir_detached', 'cmd.exe', ['/d', '/s', '/c', `dsh --version > ${f('p3r.log')} 2>&1`], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  show(f('p3r.log'))
  console.log('DIAG_DONE')
}

main()
