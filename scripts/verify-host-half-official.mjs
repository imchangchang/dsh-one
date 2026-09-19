#!/usr/bin/env node
/**
 * 官方侧验证（#84）：在**隔离的临时 HOME + 临时 profile** 里装宿主半包、起真 dsh
 * 宿主，逐个调用能力端点，核对结果与落盘物。
 *
 * 为什么必须是真环境：宿主半能不能被发现，取决于官方网关的 SRC 端点认领、loader
 * 把我们的补丁行挂进树、包依赖能否解析——这三件事都只有真 dsh 进程能回答。这条
 * 脚本把它们跑成可复现的证据。
 *
 * **隔离保证**：全程 `HOME=<临时目录>`（dsh 的 profile、会话、状态文件全部落在临时
 * HOME 里），不碰用户的 `~/.dsh` 与真实 profile；临时目录结束后删除（`--keep` 保留
 * 供人工查看）。启动的 dsh 用完即杀。
 *
 * 用法：
 *   node scripts/verify-host-half-official.mjs [--keep] [--port 3399] [--json]
 *
 * 退出码：0 = 全部断言通过；1 = 有断言失败（输出里标出哪一条）。
 */
import { spawn, spawnSync } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import { assertBuildArtifacts } from './check-build-artifacts.mjs'

const args = process.argv.slice(2)
const keep = args.includes('--keep')
const asJson = args.includes('--json')
const portArg = args.indexOf('--port')
/** 端口：显式给就照用，否则现取一个空闲端口（避免撞上用户正在跑的 dsh）。 */
async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => { resolve(port) })
    })
  })
}
const ROOT = path.resolve(import.meta.dirname, '..')
const PKG_DIR = path.join(ROOT, 'packages', 'dsh-host-capabilities')
const ENDPOINT = (method) => `dshOneHostCapabilities/${method}`

const evidence = []
const failures = []

function record(name, ok, detail) {
  evidence.push({ name, ok, detail })
  if (!ok) failures.push(name)
  if (!asJson) console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { encoding: 'utf8', ...options })
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(' ')} failed (${String(result.status)}):\n${result.stdout}\n${result.stderr}`)
  }
  return result.stdout
}

async function main() {
  assertBuildArtifacts()
  PORT = portArg >= 0 ? Number(args[portArg + 1]) : await freePort()
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-host-half-verify-'))
  const home = path.join(tmp, 'home')
  await fs.mkdir(home, { recursive: true })
  if (!asJson) console.log(`临时 HOME: ${home}`)

  // 1) 装包进临时 profile——用 `file:` 安装（pnpm 会把包拷进 profile 的 node_modules
  //    并一起装上它声明的依赖，与发布后的安装路径一致；`link:` 不会装依赖）。
  const addOut = run('dsh', ['plugin', '--profile', 'web', 'add', `file:${PKG_DIR}`], {
    env: { ...process.env, HOME: home },
  })
  const profileDir = path.join(home, '.dsh', 'profiles', 'web')
  const installed = await fs
    .stat(path.join(profileDir, 'node_modules', '@dsh-one', 'dsh-host-capabilities', 'lib', 'index.js'))
    .then(() => true)
    .catch(() => false)
  record('profile 装上了宿主半包（file: 安装）', installed, profileDir)
  const manifest = JSON.parse(await fs.readFile(path.join(profileDir, 'package.json'), 'utf8'))
  record(
    '宿主半进入 dsh.profile.bundles 层列表',
    (manifest.dsh?.profile?.bundles ?? []).includes('@dsh-one/dsh-host-capabilities'),
    JSON.stringify(manifest.dsh?.profile?.bundles ?? []),
  )
  const peerResolved = await fs
    .stat(path.join(profileDir, 'node_modules', '@deepseek-ai', 'dsh-typert-protocol'))
    .then(() => true)
    .catch(() => false)
  record('官方协议包依赖被一并安装（包内 import 能解析）', peerResolved)

  // 2) 临时 HOME 里造一个 git 仓库当查询目标（落在 dsh 家目录内 = 允许根内，
  //    无需注册工作区；真实部署里允许根是 dsh 注册的工作区 + ~/.dsh）。
  const dshHome = path.join(home, '.dsh')
  const repo = path.join(dshHome, 'verify-repo')
  await fs.mkdir(repo, { recursive: true })
  run('git', ['init', '-q'], { cwd: repo })
  await fs.writeFile(path.join(repo, 'readme.md'), '# verify\n')
  run('git', ['-c', 'user.email=verify@example.com', '-c', 'user.name=verify', 'add', '.'], { cwd: repo })
  run('git', ['-c', 'user.email=verify@example.com', '-c', 'user.name=verify', 'commit', '-qm', 'verify commit'], { cwd: repo })
  const hash = run('git', ['rev-parse', 'HEAD'], { cwd: repo }).trim()

  // 3) 起真 dsh 宿主（web surface），等 ready 行拿端口与 launch token。
  const logFile = path.join(tmp, 'dsh.log')
  const logHandle = await fs.open(logFile, 'w')
  const child = spawn('dsh', ['web', '--host', '127.0.0.1', '--port', String(PORT), '--no-open'], {
    env: { ...process.env, HOME: home },
    stdio: ['ignore', logHandle.fd, logHandle.fd],
    detached: false,
  })
  const cleanup = async () => {
    if (child.exitCode === null) {
      child.kill('SIGTERM')
      await new Promise((resolve) => setTimeout(resolve, 500))
      if (child.exitCode === null) child.kill('SIGKILL')
    }
    await logHandle.close()
    if (!keep) await fs.rm(tmp, { recursive: true, force: true })
    else if (!asJson) console.log(`保留临时目录：${tmp}`)
  }
  process.on('exit', () => {
    if (child.exitCode === null) child.kill('SIGKILL')
  })

  try {
    const readyLine = await waitForReady(logFile)
    const logText = await fs.readFile(logFile, 'utf8').catch(() => '')
    record(
      '真 dsh 宿主起来了',
      readyLine !== null,
      readyLine ?? logText.split('\n').slice(0, 4).join(' | ').slice(0, 400),
    )
    if (readyLine === null) throw new Error('dsh 未就绪')
    const token = /token=([A-Za-z0-9_-]+)/.exec(readyLine)?.[1]
    if (token === undefined) throw new Error('就绪行里没有 launch token')
    const cookie = await mintCookie(token)

    // 3b) 插件树快照（官方 dsh-host-plugin-inventory 的 pluginInventory/list）：证明
    //     loader 真把我们的补丁行挂上树了、且 fiber 处于 active（不是只装了个包）。
    const inventory = await rpc(cookie, 'pluginInventory/list', {})
    const rows = inventory.payload?.entries ?? []
    const ours = rows.find((row) => row.moduleName === '@dsh-one/dsh-host-capabilities')
    record(
      '插件树里有宿主半那一行且 fiber active',
      ours !== undefined && ours.enabled === true && ours.fiberPhase === 'active',
      ours === undefined ? `快照里没有我们那一行（共 ${String(rows.length)} 行）` : JSON.stringify(ours),
    )

    const stateKey = 'verify-host-half'
    // 4) 状态：写 → 读 → 文件真的落在临时 HOME 的 ~/.dsh/dsh-one/ 下 → 删
    const write = await rpc(cookie, ENDPOINT('stateWrite'), { key: stateKey, value: { version: 1, sessionIds: ['s1'] } })
    record('stateWrite 返回成功', write.payload?.ok === true, JSON.stringify(write.remote))
    const stateFile = path.join(dshHome, 'dsh-one', `${stateKey}.json`)
    const onDisk = await fs.readFile(stateFile, 'utf8').catch(() => null)
    record(
      '状态落在临时 HOME 的 ~/.dsh/dsh-one/<键>.json',
      onDisk === '{"version":1,"sessionIds":["s1"]}',
      `${stateFile} = ${String(onDisk)}`,
    )
    const read = await rpc(cookie, ENDPOINT('stateRead'), { key: stateKey })
    record(
      'stateRead 读回同一份值',
      JSON.stringify(read.payload?.value) === '{"version":1,"sessionIds":["s1"]}',
      JSON.stringify(read.payload),
    )
    const del = await rpc(cookie, ENDPOINT('stateDelete'), { key: stateKey })
    record('stateDelete 删除成功', del.payload?.deleted === true, JSON.stringify(del.payload))
    record('删除后文件消失', (await fs.stat(stateFile).catch(() => null)) === null)

    // 5) 状态参数校核：路径穿越形态的键必须被拒（失败回执，不是抛错）
    const badKey = await rpc(cookie, ENDPOINT('stateWrite'), { key: '../evil', value: 1 })
    record(
      '非法状态键被拒（invalid-args，且不落盘）',
      badKey.payload?.ok === false && badKey.payload?.error?.code === 'invalid-args',
      JSON.stringify(badKey.payload),
    )

    // 6) 落盘能力：写一份内容，核对宿主磁盘上的字节
    const content = Buffer.from('dsh-one host capability verify\n', 'utf8').toString('base64')
    const saved = await rpc(cookie, ENDPOINT('saveContent'), { suggestedName: 'dsh-one-verify.txt', base64: content })
    const savedPath = saved.payload?.path
    const savedBytes = typeof savedPath === 'string' ? await fs.readFile(savedPath, 'utf8').catch(() => null) : null
    record(
      'saveContent 把内容写到宿主磁盘并可读回',
      savedBytes === 'dsh-one host capability verify\n',
      `${String(savedPath)} = ${String(savedBytes)}`,
    )

    // 7) 只读 git 查询（安全口径与宿主调用通道同一份代码）
    const git = await rpc(cookie, ENDPOINT('gitShow'), { hash, cwd: repo })
    record(
      'gitShow 查到临时仓库里的提交',
      git.payload?.ok === true && git.payload?.found === true && git.payload?.sha === hash,
      JSON.stringify({ hash: hash.slice(0, 8), result: git.payload }),
    )
    const badGit = await rpc(cookie, ENDPOINT('gitShow'), { hash: 'abc1234; rm -rf /', cwd: repo })
    record(
      '非法提交号被拒（invalid-args）',
      badGit.payload?.ok === false && badGit.payload?.error?.code === 'invalid-args',
      JSON.stringify(badGit.payload),
    )

    // 8) 未登记端点仍 404（SRC 认领只覆盖我们声明的方法）
    const unknown = await rpc(cookie, ENDPOINT('nope'), {})
    record('未声明的方法 → HTTP 404（端点认领按方法粒度）', unknown.status === 404, `HTTP ${String(unknown.status)}`)

    // 9) 参数键不匹配要被官方网关拒（SDK 与宿主半共用契约的兜底）
    const wrongArgs = await rpc(cookie, ENDPOINT('stateRead'), { unexpected: 1 })
    record(
      '参数键与描述符不符 → 官方网关 arguments-invalid',
      wrongArgs.failure?.code === 'gateway/arguments-invalid',
      JSON.stringify(wrongArgs.failure),
    )
  } finally {
    await cleanup()
  }

  if (asJson) console.log(JSON.stringify({ evidence, failures }, null, 2))
  else {
    console.log(`\n${failures.length === 0 ? '全部通过' : `失败 ${String(failures.length)} 项`}（${String(evidence.length)} 项断言）`)
    if (failures.length > 0) console.log(`失败项：${failures.join('；')}`)
  }
  process.exitCode = failures.length === 0 ? 0 : 1
}

/** 轮询 dsh 日志等就绪行（`dsh web: http://127.0.0.1:<port>/?token=…`）。 */
async function waitForReady(logFile, timeoutMs = 120_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const text = await fs.readFile(logFile, 'utf8').catch(() => '')
    const line = /dsh web: http:\/\/127\.0\.0\.1:\d+\/[^\s]*/.exec(text)
    if (line !== null) return line[0]
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return null
}

/** 本次运行使用的端口（main 里赋值；HTTP 辅助函数共用）。 */
let PORT = 0

/** 用 launch token 换 cookie（官方浏览器会话鉴权；token 本身不能调 API）。 */
async function mintCookie(token) {
  const response = await fetch(`http://127.0.0.1:${String(PORT)}/?token=${token}`, { redirect: 'manual' })
  const setCookie = response.headers.getSetCookie?.() ?? []
  const cookie = setCookie.map((value) => value.split(';')[0]).join('; ')
  if (cookie === '') throw new Error(`token 换 cookie 失败（HTTP ${String(response.status)}）`)
  return cookie
}

/** 调一次能力端点（官方 Connection 的线形态：client-request 信封 + { args } 载荷）。 */
async function rpc(cookie, endpoint, argsObject) {
  const response = await fetch(`http://127.0.0.1:${String(PORT)}/api/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ type: 'client-request', rpcId: `verify-${String(Date.now())}`, method: endpoint, payload: { args: argsObject } }),
  })
  const text = await response.text()
  let body = null
  try {
    body = JSON.parse(text)
  } catch {
    body = { raw: text }
  }
  // 两层信封：外层是官方网关的 RemoteResult（{ok,value} 或 {ok:false,error}），
  // 内层是宿主半自己的回执（同样 {ok:true,…} 或 {ok:false,error}）。
  const remote = body?.result
  return {
    status: response.status,
    remote,
    failure: remote?.ok === false ? remote.error : null,
    payload: remote?.ok === true ? remote.value : null,
    raw: body,
  }
}

await main()
