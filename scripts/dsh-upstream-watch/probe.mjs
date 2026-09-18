#!/usr/bin/env node
/**
 * dsh 上游版本兼容性探针（dsh-one 视角）。
 *
 * 用法：
 *   node scripts/dsh-upstream-watch/probe.mjs --command <dsh 可执行文件或命令名> \
 *        [--expect-version 0.1.3-alpha.1] [--json <结果输出路径>]
 *
 * 行为：用临时 DSH_HOME 起 `dsh web --host 127.0.0.1 --port <空闲端口> --no-open`，
 * 逐项核实 dsh-one 实际依赖的 **wire 面**（启动/认证/unary RPC/WS 流）、**网关前端
 * 产物**（伺服面里的 `/` 启动契约标记、首个 batch 的 combo 端点、Origin 栅栏——
 * #67 的 N1–N3）、**客户端契约面**（网关下发的 combo 里我们必须存在的 slot 名 /
 * root 级 hook 名 / 取用过的字段与方法名，取法见 clientContract.mjs）与 **官方产物面**
 * （本机已安装的官方包文件里必须还在的内部标识符——静默失效型依赖，取法见
 * officialIdentifiers.mjs），输出结果表；有任何 fail 时退出码为 1（skip 不算失败）。
 * 探针全部只读/无副作用（创建的 workspace/session 在隔离 DSH_HOME 内，进程退出即弃；
 * 官方产物面只读磁盘，连本机默认 `~/.dsh` 也只看不改）。
 *
 * 检查项清单与人工补充项见 docs/dsh-compat-checklist.md。
 *
 * 一处刻意的设计（#37）：`commands/execute` 该发什么参数形状，探针**不复刻**——
 * 直接 import dsh-one 源码里的 `commandsExecuteArgs`（`src/pure/dshWire.ts`），
 * 与运行时同一份。探针跟着 dsh-one 走，就不会再出现「探针自己过时、报出上游没改
 * 的假失败」。
 */
import { checkClientContract } from './clientContract.mjs'
import { checkOfficialIdentifiers, resolveRealpath } from './officialIdentifiers.mjs'
import { commandsExecuteArgs } from '../../src/pure/dshWire.ts'
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

/** dsh-one 同款 unary RPC 信封。`headers` 用于 Origin 栅栏那两项（#67 N3）。 */
async function rpc(baseUrl, cookie, method, args, headers = {}) {
  const rpcId = crypto.randomUUID()
  const res = await fetch(`${baseUrl}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
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
  // 正常跑完与 Ctrl-C / SIGTERM 走 cleanup()；未预期异常只能靠 `exit` 兜底——那里只来得及
  // 做同步的事，所以另写一个同步版。缺了这段兜底的话，probe 一被异常带走，它起的 dsh web
  // 与临时 DSH_HOME 就留在机器上没人管了（#192）。
  const cleanupSync = () => {
    if (child && child.exitCode === null) { try { child.kill('SIGKILL') } catch { /* 已经没了 */ } }
    try { fs.rmSync(dshHome, { recursive: true, force: true }) } catch { /* 临时目录 */ }
  }
  process.on('SIGINT', async () => { await cleanup(); process.exit(130) })
  process.on('SIGTERM', async () => { await cleanup(); process.exit(143) })
  process.on('exit', () => { cleanupSync() })

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

  // 11. commands/execute 参数形状：形状取自 dsh-one 源码的同一份单一事实源
  // （src/pure/dshWire.ts 的 commandsExecuteArgs，按版本分叉 0.1.2 的 `images`
  // / 0.1.3+ 的 `submittedAttachments`）——探针不再自己复刻协议知识，也就不会再
  // 出现「dsh-one 早改对了、探针还发老形状」那种假失败（#37）。
  const execArgs = commandsExecuteArgs(version, sessionId ?? '', '/dsh-one-probe-no-such-command')
  const execName = `commands/execute 接受 dsh-one 现发的 args 形状（${shapeKeys(execArgs)}，取自 src/pure/dshWire.ts）`
  if (sessionId) {
    const exec = await rpc(baseUrl, cookie, 'commands/execute', execArgs)
    const errCode = exec.body?.result && !exec.body.result.ok ? exec.body.result.error?.code : null
    if (exec.status === 200 && exec.body?.rpcId === exec.rpcId && errCode !== 'gateway/arguments-invalid') {
      record('commands-execute-args', execName, 'pass', errCode ? `业务错误可接受: ${errCode}` : 'ok')
    } else {
      record('commands-execute-args', execName, 'fail',
        errCode ?? `HTTP ${exec.status} ${JSON.stringify(exec.body ?? exec.text).slice(0, 160)}`)
    }
  } else record('commands-execute-args', execName, 'skip', '无 sessionId')

  // 12-14. WS mux
  if (cookie) {
    const wsResult = await probeWs(baseUrl, cookie, sessionId)
    for (const r of wsResult) record(r.id, r.name, r.status, r.detail)
  } else {
    record('ws-mux-connect', 'WS /api/remote.mux 带 cookie 建连', 'skip', '无 cookie')
    record('ws-session-follow', 'session/follow snapshot 帧形状', 'skip', '无 cookie')
    record('ws-session-control', 'session/control baseline 帧', 'skip', '无 cookie')
  }

  // 15-17. 网关前端产物（#67 N1–N3）：`/` 的启动契约标记、combo 端点、Origin 栅栏
  for (const r of await probeBootSurface(baseUrl, cookie)) {
    record(r.id, r.name, r.status, r.detail)
  }

  // 18-21. 客户端契约面（#79）：网关 combo 里的 slot 名 / root 级 hook 名 / 取用过的字段名
  for (const r of await probeClientContract(baseUrl, cookie, version)) {
    record(r.id, r.name, r.status, r.detail)
  }

  // 22. 官方产物面（#179）：本机已安装的官方包文件里必须还在的内部标识符
  {
    const found = findOfficialRoot(opts, dshHome)
    if (found.root === null) {
      record('official-identifiers', '官方内部标识符在场（本机官方产物，存在性检查）', 'fail',
        `找不到官方产物目录（找过：${found.tried.join('、')}）——这一面未核实，不能当成没问题`)
    } else {
      const r = checkOfficialIdentifiers({ root: found.root, version, profile: found.profile })
      record(r.id, r.name, r.status, r.detail)
    }
  }

  await cleanup()
  const failed = results.filter((r) => r.status === 'fail').length
  return finish(opts, failed > 0 ? 1 : 0)
}

/**
 * 官方产物根目录（`…/@deepseek-ai`，#179 那一项读的就是它下面的包文件）。
 *
 * 三个候选按可信度排：
 *
 * ① 被测实例自己的 profile（`<DSH_HOME>/profiles/node_modules`）——网关实际加载的那一份。
 *    但它**不是每种安装方式都有**：实测全局装的 dsh 起新 DSH_HOME 会建它，npm `--prefix`
 *    装出来的那份不建（只建 `profiles/web`）。
 * ② 被测 dsh **自己安装树**里的官方包——从 `--command` 解析到的可执行文件、以及 `--cwd`
 *    往上逐级找 `node_modules/@deepseek-ai`；npm 全局装（包嵌在 `<cli>/node_modules` 下）、
 *    `--prefix` 装（包在 `<prefix>/node_modules` 下）、源码构建（pnpm workspace 根）都落在这里。
 * ③ 本机默认 `~/.dsh` 的 profile——#179 点名的那个路径；**可能不是本次被测版本**，
 *    所以 detail 里如实写明读的是哪一份。
 *
 * 候选目录要求里面真有官方包（`dsh-client-ui-layout` 在），免得认错目录（例如我们自己的
 * profile 里也有一个 `@deepseek-ai`，那里面只放自有插件）。都没有时返回 `{ root: null, tried }`，
 * 由调用方报红并列出找过的地方——取不到就不能让这一面显示成「没问题」。
 */
function findOfficialRoot(opts, dshHome) {
  const candidates = []
  const add = (dir, profile) => candidates.push({ dir, profile })
  add(path.join(dshHome, 'profiles', 'node_modules', '@deepseek-ai'), '被测实例自己的 profile（网关实际加载的那一份）')
  for (const start of cliSearchStarts(opts)) {
    for (const anc of ancestors(start)) {
      add(path.join(anc, 'node_modules', '@deepseek-ai'), `被测 dsh 的安装树（${anc}/node_modules）`)
    }
  }
  add(path.join(os.homedir(), '.dsh', 'profiles', 'node_modules', '@deepseek-ai'), '本机默认 ~/.dsh 的 profile（可能不是本次被测版本）')

  for (const c of candidates) {
    if (fs.existsSync(path.join(c.dir, 'dsh-client-ui-layout'))) return { root: resolveRealpath(c.dir), profile: c.profile }
  }
  return { root: null, tried: candidates.map((c) => c.dir) }
}

/** 从这些目录往上找官方包：`--command` 里的可执行文件所在目录、`--cwd`（缺省用当前目录）。 */
function cliSearchStarts(opts) {
  const starts = []
  const [bin] = splitCommand(opts.command)
  if (bin.includes('/') || bin.includes('\\')) starts.push(path.dirname(resolveRealpath(bin)))
  starts.push(opts.cwd ? resolveRealpath(opts.cwd) : process.cwd())
  return starts
}

/** `dir` 及其各级父目录（含自身，到文件系统根为止）。 */
function ancestors(dir) {
  const out = []
  let cur = path.resolve(dir)
  for (;;) {
    out.push(cur)
    const up = path.dirname(cur)
    if (up === cur) return out
    cur = up
  }
}

/**
 * 网关前端产物三项（#67 的 N1–N3，依据 docs/upstream-dependency-audit.html §4 F1–F6 与 §6.2）：
 *
 * - N1 `boot-html-contract`：带 cookie GET 网关 `/`，HTML 里必须还有启动契约的标记
 *   （`__ModuleLoader__` 门面 / `__DSH_BOOT__` 清单 / 主题预置脚本的 `const preference`），
 *   且 `__DSH_BOOT__` 能解析出 ≥ 40 个 entries——dsh-one 的装配页逐字照抄这三段
 *   （pageHtml.ts：门面 + 主题预置 + 内联 wire）。
 * - N2 `combo-endpoint`：从清单取**首个** batch 的 combo URL 请求，200 且 body > 10 KB
 *   ——dsh-one 的 mirror 就是拉这个端点（`/plugins/??…&rev=`）再按插件段过滤的。
 * - N3 `origin-fence`：带 cookie POST 同一方法两次——`Origin: http://127.0.0.1:1` 被网关
 *   信任栅栏拒（403）、`Origin: <网关权威>` 才通（200），证明 mirror 把 Origin 改写为
 *   网关权威这一手仍然必要且有效。
 *
 * 取不到产物时 N1/N2 都 fail（不能因为取不到就让这一面显示为「没问题」）。
 */

/** N1：网关 `/` 里必须还在的三段启动契约标记（dsh-one 装配页逐字对应）。 */
const BOOT_HTML_MARKERS = ['__ModuleLoader__', '__DSH_BOOT__', 'const preference']
/** N1：`__DSH_BOOT__.entries` 的下限——官方 0.1.6-alpha.1 实测 56，掉到 40 以下说明清单被换过写法。 */
const MIN_BOOT_ENTRIES = 40
/** N2：首个 batch 的 combo 下限（0.1.6-alpha.1 实测 bootstrap 批 20.8 KB）。 */
const MIN_COMBO_BYTES = 10 * 1024

async function probeBootSurface(baseUrl, cookie) {
  const out = []
  const headers = cookie ? { cookie } : {}
  let html = null
  let htmlError = null
  let bootWire = null
  let manifestError = null
  try {
    const res = await fetch(`${baseUrl}/`, { headers })
    if (!res.ok) throw new Error(`GET /: HTTP ${res.status}`)
    html = await res.text()
  } catch (e) {
    htmlError = String(e?.message ?? e)
  }
  if (html !== null) {
    const m = /globalThis\["__DSH_BOOT__"\] = (\{[\s\S]*?\})<\/script>/.exec(html)
    if (m === null) {
      manifestError = html.includes('__DSH_BOOT__')
        ? 'HTML 里有 __DSH_BOOT__ 标记，但清单解析不出来（官方改了注入写法）'
        : 'HTML 里没有 __DSH_BOOT__ 注入'
    } else {
      try { bootWire = JSON.parse(m[1]) } catch (e) { manifestError = `__DSH_BOOT__ 不是合法 JSON：${String(e?.message ?? e)}` }
    }
  }

  // N1
  const n1Name = `网关 / 启动契约：${BOOT_HTML_MARKERS.join(' / ')} 在场 + __DSH_BOOT__ entries ≥ ${MIN_BOOT_ENTRIES}`
  const missing = html === null ? [] : BOOT_HTML_MARKERS.filter((s) => !html.includes(s))
  const entries = Array.isArray(bootWire?.entries) ? bootWire.entries.length : null
  const n1Problems = []
  if (htmlError !== null) n1Problems.push(htmlError)
  if (missing.length > 0) n1Problems.push(`缺标记 ${missing.join('、')}`)
  if (manifestError !== null) n1Problems.push(manifestError)
  else if (html !== null && entries === null) n1Problems.push('__DSH_BOOT__.entries 取不到')
  else if (entries !== null && entries < MIN_BOOT_ENTRIES) n1Problems.push(`entries=${entries}（< ${MIN_BOOT_ENTRIES}）`)
  out.push({
    id: 'boot-html-contract', name: n1Name, status: n1Problems.length === 0 ? 'pass' : 'fail',
    detail: n1Problems.length === 0 ? `标记 ${BOOT_HTML_MARKERS.length}/${BOOT_HTML_MARKERS.length} 在场，entries=${entries}` : n1Problems.join('；'),
  })

  // N2
  const n2Name = `combo 端点（__DSH_BOOT__ 首个 batch）：HTTP 200 且 body > ${MIN_COMBO_BYTES / 1024} KB`
  const firstBatch = (Array.isArray(bootWire?.batches) ? bootWire.batches : [])[0]
  if (htmlError !== null) {
    out.push({ id: 'combo-endpoint', name: n2Name, status: 'fail', detail: `取不到 HTML：${htmlError}` })
  } else if (manifestError !== null) {
    out.push({ id: 'combo-endpoint', name: n2Name, status: 'fail', detail: `取不到清单：${manifestError}` })
  } else if (firstBatch?.url === undefined) {
    out.push({ id: 'combo-endpoint', name: n2Name, status: 'fail', detail: '__DSH_BOOT__.batches 为空或首个 batch 没有 url' })
  } else {
    try {
      const res = await fetch(new URL(firstBatch.url, baseUrl), { headers })
      const bytes = (await res.arrayBuffer()).byteLength
      const ok = res.status === 200 && bytes > MIN_COMBO_BYTES
      out.push({
        id: 'combo-endpoint', name: n2Name, status: ok ? 'pass' : 'fail',
        detail: `HTTP ${res.status}，${(bytes / 1024).toFixed(1)} KB（phase=${firstBatch.phase ?? '?'}${ok ? '' : `，阈值 ${MIN_COMBO_BYTES / 1024} KB`}）`,
      })
    } catch (e) {
      out.push({ id: 'combo-endpoint', name: n2Name, status: 'fail', detail: `GET ${firstBatch.url}: ${String(e?.message ?? e)}` })
    }
  }

  // N3：栅栏判定先于路由（对不存在的方法也回 403），所以「通」这一半必须用真实存在的
  // 方法。这里用 session/list，不用 §6.2 写的 host.describe——实测两个已支持版本的认证
  // 网关（0.1.2-rc.1 / 0.1.6-alpha.1）对 /api/host.describe 的任何 payload 都回 404
  // not found（403 那半它照样成立），拿它判「权威 Origin → 200」判不出来。
  const fenceArgs = { _request: {} }
  const bad = await rpc(baseUrl, cookie, 'session/list', fenceArgs, { origin: 'http://127.0.0.1:1' })
  const good = await rpc(baseUrl, cookie, 'session/list', fenceArgs, { origin: baseUrl })
  const fenceOk = bad.status === 403 && good.status === 200
  out.push({
    id: 'origin-fence',
    name: 'Origin 栅栏：非权威 Origin → 403、Origin = 网关权威 → 200',
    status: fenceOk ? 'pass' : 'fail',
    detail: `非权威 Origin → ${bad.status}（期望 403）、权威 Origin → ${good.status}（期望 200）；mirror 改写 Origin/Referer 为网关权威的依据`,
  })

  return out
}

/**
 * 客户端契约面四项（#79）：取网关 `/` 的 `__DSH_BOOT__` → application 批 combo →
 * 交给 clientContract.mjs 查 slot / root hook / 字段名。combo 是官方发给浏览器的
 * 原样产物（不经我们的 mirror/过滤），所以它反映的是**上游契约本身**。
 * 取不到 combo 时四项全 fail（不能因为取不到就让这一面显示为「没问题」）。
 */
async function probeClientContract(baseUrl, cookie, version) {
  let comboText = null
  let failure = null
  try {
    const res = await fetch(`${baseUrl}/`, { headers: cookie ? { cookie } : {} })
    if (!res.ok) throw new Error(`GET /: HTTP ${res.status}`)
    const html = await res.text()
    const m = /globalThis\["__DSH_BOOT__"\] = (\{[\s\S]*?\})<\/script>/.exec(html)
    if (m === null) throw new Error('gateway HTML has no __DSH_BOOT__ injection')
    const wire = JSON.parse(m[1])
    const batch = (wire.batches ?? []).find((b) => b.phase === 'application') ?? (wire.batches ?? []).at(-1)
    if (batch === undefined) throw new Error('__DSH_BOOT__ has no batch to fetch')
    const comboRes = await fetch(new URL(batch.url, baseUrl), { headers: cookie ? { cookie } : {} })
    if (!comboRes.ok) throw new Error(`GET combo (${batch.phase}): HTTP ${comboRes.status}`)
    comboText = await comboRes.text()
  } catch (e) {
    failure = String(e?.message ?? e)
  }

  if (comboText === null) return checkClientContract({ comboText: null, version, unavailableReason: failure })
  return checkClientContract({ comboText, version })
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
