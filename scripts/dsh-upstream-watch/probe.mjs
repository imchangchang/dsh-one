#!/usr/bin/env node
/**
 * dsh 上游版本兼容性探针（dsh-one 视角）。
 *
 * 用法：
 *   node scripts/dsh-upstream-watch/probe.mjs --command <dsh 可执行文件或命令名> \
 *        [--expect-version 0.1.3-alpha.1] [--json <结果输出路径>]
 *
 * 行为：用临时 DSH_HOME 起 `dsh web --host 127.0.0.1 --port <空闲端口> --no-open`，
 * 逐项核实 dsh-one 实际依赖的 wire 面（启动/认证/unary RPC/WS 流），输出结果表；
 * 有任何 fail 时退出码为 1（skip 不算失败）。探针全部只读/无副作用（创建的
 * workspace/session 在隔离 DSH_HOME 内，进程退出即弃）。
 *
 * 检查项清单与人工补充项见 docs/dsh-compat-checklist.md。
 */
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

// ---------- 参数 ----------

function parseArgs(argv) {
  const opts = { command: null, expectVersion: null, json: null, cwd: null }
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--command') opts.command = argv[++i]
    else if (a === '--expect-version') opts.expectVersion = argv[++i]
    else if (a === '--json') opts.json = argv[++i]
    else if (a === '--cwd') opts.cwd = argv[++i]
    else if (a === '--help' || a === '-h') {
      console.log('usage: probe.mjs --command <dsh> [--expect-version <v>] [--json <out>] [--cwd <dir>]')
      process.exit(0)
    } else throw new Error(`unknown arg: ${a}`)
  }
  if (!opts.command) throw new Error('--command is required')
  return opts
}

// ---------- 结果收集 ----------

const results = []
function record(id, name, status, detail) {
  results.push({ id, name, status, detail: detail ?? '' })
  const mark = { pass: '✅', fail: '❌', skip: '⏭️' }[status]
  console.log(`${mark} ${id}: ${name}${detail ? ` — ${detail}` : ''}`)
}

// ---------- 工具 ----------

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

/** `--command` 允许整串命令行（如源码构建的 `node --import tsx/esm apps/cli/src/bin.ts`）。 */
function splitCommand(cmd) {
  return cmd.trim().split(/\s+/)
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const [bin, ...prefix] = splitCommand(cmd)
    const child = spawn(bin, [...prefix, ...args], { cwd: opts.cwd ?? undefined, ...opts, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    child.on('close', (code) => resolve({ code, out, err }))
    child.on('error', (e) => resolve({ code: -1, out, err: String(e) }))
  })
}

/** 从 `dsh --version` 输出提取第一个 semver 形状 token（对齐 dsh-one 的解析）。 */
function extractVersion(text) {
  const m = text.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/)
  return m ? m[0] : null
}

/** dsh-one 同款 unary RPC 信封。 */
async function rpc(baseUrl, cookie, method, args) {
  const rpcId = crypto.randomUUID()
  const res = await fetch(`${baseUrl}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args } }),
  })
  const text = await res.text()
  let body = null
  try { body = JSON.parse(text) } catch { /* 非 JSON（如 401 纯文本） */ }
  return { status: res.status, text, body, rpcId }
}

function shapeKeys(v) {
  if (Array.isArray(v)) return `array(${v.length})`
  if (v && typeof v === 'object') return `{${Object.keys(v).join(',')}}`
  return String(v)
}

// ---------- 主流程 ----------

async function main() {
  const opts = parseArgs(process.argv)
  const dshHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-probe-home-'))
  let child = null
  let baseUrl = null
  let cookie = null
  let sessionId = null
  let booted = false

  const cleanup = async () => {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM')
      await new Promise((r) => setTimeout(r, 1500))
      if (child.exitCode === null) child.kill('SIGKILL')
    }
    try { fs.rmSync(dshHome, { recursive: true, force: true }) } catch { /* 临时目录 */ }
  }
  process.on('SIGINT', async () => { await cleanup(); process.exit(130) })

  // 1. 版本解析
  const ver = await run(opts.command, ['--version'], { cwd: opts.cwd ?? undefined })
  const version = extractVersion(ver.out + ver.err)
  if (ver.code === 0 && version) {
    const mismatch = opts.expectVersion && version !== opts.expectVersion
    record('version-parse', '`dsh --version` 输出可解析', mismatch ? 'fail' : 'pass',
      mismatch ? `期望 ${opts.expectVersion}，实际 ${version}` : version)
    if (mismatch) { await cleanup(); return finish(opts, 1) }
  } else {
    record('version-parse', '`dsh --version` 输出可解析', 'fail', `exit=${ver.code} ${ver.err.slice(0, 200)}`)
    await cleanup(); return finish(opts, 1)
  }

  // 2. 启动 + 就绪行
  const port = await freePort()
  const env = { ...process.env, DSH_HOME: dshHome }
  delete env.NODE_OPTIONS
  delete env.ELECTRON_RUN_AS_NODE
  child = spawn(...(() => { const [bin, ...prefix] = splitCommand(opts.command); return [bin, [...prefix, 'web', '--host', '127.0.0.1', '--port', String(port), '--no-open'], { env, cwd: opts.cwd ?? undefined, stdio: ['ignore', 'pipe', 'pipe'] }] })())
  let stderrTail = ''
  child.stderr.on('data', (d) => { stderrTail = (stderrTail + d).slice(-2000) })
  const readyLine = await new Promise((resolve) => {
    let buf = ''
    const timer = setTimeout(() => resolve(null), 120_000)
    child.stdout.on('data', (d) => {
      buf += d
      const m = buf.match(/dsh web: (https?:\/\/\S+)/)
      if (m) { clearTimeout(timer); resolve(m[1]) }
    })
    child.on('close', () => { clearTimeout(timer); resolve(null) })
  })
  if (!readyLine) {
    record('ready-line', '`dsh web` 就绪行（含 ?token=）', 'fail', `120s 无就绪行；stderr: ${stderrTail.slice(-300)}`)
    await cleanup(); return finish(opts, 1)
  }
  const readyUrl = new URL(readyLine)
  const token = readyUrl.searchParams.get('token')
  baseUrl = `${readyUrl.protocol}//${readyUrl.host}`
  if (!token) {
    record('ready-line', '`dsh web` 就绪行（含 ?token=）', 'fail', `就绪行无 token: ${readyLine}`)
    await cleanup(); return finish(opts, 1)
  }
  record('ready-line', '`dsh web` 就绪行（含 ?token=）', 'pass', baseUrl)
  booted = true

  // 3. 401 指纹
  const unauth = await rpc(baseUrl, null, 'host.describe', {})
  record('auth-401-fingerprint', '无凭证 /api/* → 401 + 正文 unauthorized',
    unauth.status === 401 && unauth.text.trim() === 'unauthorized' ? 'pass' : 'fail',
    `HTTP ${unauth.status} body=${JSON.stringify(unauth.text.slice(0, 80))}`)

  // 4. token 换 cookie
  const exch = await fetch(`${baseUrl}/?token=${encodeURIComponent(token)}`, { redirect: 'manual' })
  const setCookies = exch.headers.getSetCookie ? exch.headers.getSetCookie() : []
  const authCookie = setCookies.find((c) => c.startsWith('dsh-auth-'))
  if ((exch.status === 303 || exch.status === 302) && authCookie) {
    cookie = authCookie.split(';')[0]
    record('token-exchange-cookie', 'GET /?token= → 303 + dsh-auth cookie', 'pass', cookie.split('=')[0])
  } else {
    record('token-exchange-cookie', 'GET /?token= → 303 + dsh-auth cookie', 'fail',
      `HTTP ${exch.status} set-cookie=${JSON.stringify(setCookies).slice(0, 120)}`)
  }

  // 5. session/list
  const list = await rpc(baseUrl, cookie, 'session/list', { _request: {} })
  const listValue = list.body?.result?.ok ? list.body.result.value : null
  record('rpc-session-list', 'session/list：信封 + rpcId 回显 + {items} 形状',
    list.status === 200 && list.body?.rpcId === list.rpcId && listValue && Array.isArray(listValue.items) ? 'pass' : 'fail',
    listValue ? `items=${listValue.items.length}` : `HTTP ${list.status} ${JSON.stringify(list.body ?? list.text).slice(0, 160)}`)

  // 6. session/modelCatalog
  const catalog = await rpc(baseUrl, cookie, 'session/modelCatalog', {})
  const catalogValue = catalog.body?.result?.ok ? catalog.body.result.value : null
  record('rpc-model-catalog', 'session/modelCatalog：groups/default 目录形状',
    catalogValue && Array.isArray(catalogValue.groups) ? 'pass' : 'fail',
    catalogValue ? `keys=${shapeKeys(catalogValue)}` : `HTTP ${catalog.status} ${JSON.stringify(catalog.body ?? catalog.text).slice(0, 160)}`)

  // 7. agentPresets/list
  const presets = await rpc(baseUrl, cookie, 'agentPresets/list', {})
  const presetsValue = presets.body?.result?.ok ? presets.body.result.value : null
  const presetArr = Array.isArray(presetsValue) ? presetsValue : (Array.isArray(presetsValue?.presets) ? presetsValue.presets : null)
  record('rpc-agent-presets', 'agentPresets/list：预设数组',
    presetArr ? 'pass' : 'fail',
    presetArr ? `count=${presetArr.length}` : `HTTP ${presets.status} ${JSON.stringify(presets.body ?? presets.text).slice(0, 160)}`)

  // 8. workspace/create + delete
  const wsDir = path.join(dshHome, 'probe-workspace')
  fs.mkdirSync(wsDir, { recursive: true })
  const wsCreate = await rpc(baseUrl, cookie, 'workspace/create', { request: { path: wsDir } })
  const wsValue = wsCreate.body?.result?.ok ? wsCreate.body.result.value : null
  const workspaceId = wsValue?.workspace?.workspaceId
  if (workspaceId) {
    const wsDel = await rpc(baseUrl, cookie, 'workspace/delete', { request: { workspaceId } })
    record('rpc-workspace-ops', 'workspace/create + delete',
      wsDel.body?.result?.ok ? 'pass' : 'fail',
      wsDel.body?.result?.ok ? `workspaceId=${workspaceId}` : `delete: ${JSON.stringify(wsDel.body ?? wsDel.text).slice(0, 160)}`)
  } else {
    record('rpc-workspace-ops', 'workspace/create + delete', 'fail',
      `create: HTTP ${wsCreate.status} ${JSON.stringify(wsCreate.body ?? wsCreate.text).slice(0, 160)}`)
  }

  // 9. session/create
  const created = await rpc(baseUrl, cookie, 'session/create', { request: { cwd: wsDir } })
  const createdValue = created.body?.result?.ok ? created.body.result.value : null
  sessionId = createdValue?.sessionId ?? null
  record('rpc-session-create', 'session/create：{sessionId}',
    sessionId ? 'pass' : 'fail',
    sessionId ?? `HTTP ${created.status} ${JSON.stringify(created.body ?? created.text).slice(0, 160)}`)

  // 10. commands/list
  if (sessionId) {
    const cmds = await rpc(baseUrl, cookie, 'commands/list', { agentId: sessionId })
    const cmdsValue = cmds.body?.result?.ok ? cmds.body.result.value : null
    record('rpc-commands-list', 'commands/list：命令名册数组',
      cmds.body?.result?.ok && (cmdsValue === undefined || Array.isArray(cmdsValue)) ? 'pass' : 'fail',
      cmds.body?.result?.ok ? `count=${Array.isArray(cmdsValue) ? cmdsValue.length : 'undefined'}` : `HTTP ${cmds.status} ${JSON.stringify(cmds.body ?? cmds.text).slice(0, 160)}`)
  } else record('rpc-commands-list', 'commands/list：命令名册数组', 'skip', '无 sessionId')

  // 11. commands/execute 参数形状（dsh-one 现发 {agentId, line, images}；
  // 0.1.3 上游改名为 submittedAttachments，gateway 严格校验会拒多余键）
  if (sessionId) {
    const exec = await rpc(baseUrl, cookie, 'commands/execute', { agentId: sessionId, line: '/dsh-one-probe-no-such-command', images: [] })
    const errCode = exec.body?.result && !exec.body.result.ok ? exec.body.result.error?.code : null
    if (exec.status === 200 && exec.body?.rpcId === exec.rpcId && errCode !== 'gateway/arguments-invalid') {
      record('commands-execute-args', 'commands/execute 接受 dsh-one 的 args 形状（images 键）', 'pass',
        errCode ? `业务错误可接受: ${errCode}` : 'ok')
    } else {
      record('commands-execute-args', 'commands/execute 接受 dsh-one 的 args 形状（images 键）', 'fail',
        errCode ?? `HTTP ${exec.status} ${JSON.stringify(exec.body ?? exec.text).slice(0, 160)}`)
    }
  } else record('commands-execute-args', 'commands/execute 接受 dsh-one 的 args 形状（images 键）', 'skip', '无 sessionId')

  // 12-14. WS mux
  if (cookie) {
    const wsResult = await probeWs(baseUrl, cookie, sessionId)
    for (const r of wsResult) record(r.id, r.name, r.status, r.detail)
  } else {
    record('ws-mux-connect', 'WS /api/remote.mux 带 cookie 建连', 'skip', '无 cookie')
    record('ws-session-follow', 'session/follow snapshot 帧形状', 'skip', '无 cookie')
    record('ws-session-control', 'session/control baseline 帧', 'skip', '无 cookie')
  }

  await cleanup()
  const failed = results.filter((r) => r.status === 'fail').length
  return finish(opts, failed > 0 ? 1 : 0)
}

/** WS 三项：建连 + session/follow snapshot + session/control baseline。 */
async function probeWs(baseUrl, cookie, sessionId) {
  const out = []
  const wsUrl = `${baseUrl.replace(/^http/, 'ws')}/api/remote.mux`
  let socket
  try {
    // 运行时（Node ≥22 的 undici WebSocket / VSCode 宿主）接受 {headers}；
    // 标准类型只声明 protocols，与 dsh-one remoteMux.ts 同款窄化。
    socket = new WebSocket(wsUrl, { headers: { Cookie: cookie } })
  } catch (e) {
    out.push({ id: 'ws-mux-connect', name: 'WS /api/remote.mux 带 cookie 建连', status: 'fail', detail: String(e) })
    return out
  }
  const streams = new Map()
  const opened = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 15_000)
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(true) })
    socket.addEventListener('error', () => { clearTimeout(timer); resolve(false) })
  })
  if (!opened) {
    out.push({ id: 'ws-mux-connect', name: 'WS /api/remote.mux 带 cookie 建连', status: 'fail', detail: '15s 未 open' })
    try { socket.close() } catch { /* ignore */ }
    return out
  }
  out.push({ id: 'ws-mux-connect', name: 'WS /api/remote.mux 带 cookie 建连', status: 'pass', detail: wsUrl })

  socket.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') return
    let frame
    try { frame = JSON.parse(event.data) } catch { return }
    if (frame && typeof frame.streamId === 'string' && streams.has(frame.streamId)) {
      streams.get(frame.streamId)(frame)
    }
  })

  function openStream(endpoint, payload) {
    const streamId = crypto.randomUUID()
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ timeout: true }), 15_000)
      streams.set(streamId, (frame) => {
        if (frame.type === 'item') { clearTimeout(timer); streams.delete(streamId); resolve({ value: frame.value }) }
        else if (frame.type === 'error') { clearTimeout(timer); streams.delete(streamId); resolve({ error: frame.error }) }
      })
      socket.send(JSON.stringify({ type: 'open', streamId, endpoint, payload }))
    })
  }

  // session/follow snapshot
  if (sessionId) {
    const follow = await openStream('session/follow', { args: { request: { address: { kind: 'session', sessionId } } } })
    const snap = follow.value
    if (snap && snap.type === 'snapshot' && typeof snap.cursor === 'number' && Array.isArray(snap.records) && snap.projections) {
      const headerKeys = snap.header && typeof snap.header === 'object' ? Object.keys(snap.header).join(',') : '(none)'
      const hasChunkRows = snap.records.some((r) => r && r.type === 'chunks')
      out.push({
        id: 'ws-session-follow', name: 'session/follow snapshot 帧形状', status: 'pass',
        detail: `cursor=${snap.cursor} records=${snap.records.length} hasMore=${snap.hasMore} headerKeys=[${headerKeys}] version=${snap.header?.version ?? '?'} chunkRows=${hasChunkRows}`,
      })
    } else {
      out.push({
        id: 'ws-session-follow', name: 'session/follow snapshot 帧形状', status: 'fail',
        detail: follow.timeout ? '15s 无首帧' : follow.error ? `${follow.error.code}: ${follow.error.message}` : `首帧=${JSON.stringify(follow.value).slice(0, 200)}`,
      })
    }
  } else out.push({ id: 'ws-session-follow', name: 'session/follow snapshot 帧形状', status: 'skip', detail: '无 sessionId' })

  // session/control baseline
  const control = await openStream('session/control', { args: {} })
  const cf = control.value
  if (cf && (cf.type === 'baseline' || cf.type === 'session/control' || typeof cf === 'object')) {
    out.push({ id: 'ws-session-control', name: 'session/control baseline 帧', status: 'pass', detail: `frame=${shapeKeys(cf)}` })
  } else {
    out.push({
      id: 'ws-session-control', name: 'session/control baseline 帧', status: 'fail',
      detail: control.timeout ? '15s 无首帧' : control.error ? `${control.error.code}: ${control.error.message}` : `首帧=${JSON.stringify(control.value).slice(0, 200)}`,
    })
  }

  try { socket.close() } catch { /* ignore */ }
  return out
}

function finish(opts, code) {
  const summary = {
    command: opts.command,
    expectVersion: opts.expectVersion,
    at: new Date().toISOString(),
    results,
    failed: results.filter((r) => r.status === 'fail').length,
    passed: results.filter((r) => r.status === 'pass').length,
    skipped: results.filter((r) => r.status === 'skip').length,
  }
  if (opts.json) fs.writeFileSync(opts.json, JSON.stringify(summary, null, 2))
  console.log(`\n${summary.passed} pass / ${summary.failed} fail / ${summary.skipped} skip`)
  process.exit(code)
}

main().catch((e) => { console.error(e); process.exit(2) })
