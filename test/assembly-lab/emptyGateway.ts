/**
 * 空实例网关（#162）：为「空实例整轮」这条门禁现起一个**全新 `DSH_HOME`** 的真 dsh 网关。
 *
 * 为什么要有它：整轮套件里有一批判据吃了运行环境的输入——「这台机器上碰巧有多少工作区、
 * 多少会话、页面是哪种语言」。这类判据在开发者日常实例（工作区与会话都很多）上是绿的，
 * 在一台从没用过的机器上（全新 `DSH_HOME`，工作区与会话都是零）就红，而红的不是功能，
 * 是判据自己。把「空实例」变成一条随时能跑的跑法，这些判据会一次性全部暴露，而不是靠
 * 撞（#162 当天撞到 5 次）。
 *
 * 隔离保证（照 `AGENTS.md` 的规矩来）：
 * - 端口现取一个空闲的，**不碰用户正在用的 3080**；起之前再确认一次端口没人监听。
 * - `DSH_HOME` 指向本次运行新建的临时目录，所以工作区 / 会话 / 插件状态全部落在那里，
 *   用户的 `~/.dsh` 一个字节都不动。**不写 `~/.dsh/dsh-owned.json`**：那个文件是扩展
 *   spawn/adopt 实例时记的，这里直接用 `dsh web` 起进程，不经过扩展那条路。
 * - 跑完**按 PID** 收掉这个进程（先 SIGTERM，不退再 SIGKILL），临时目录一并删掉。
 *   绝不用 `pkill -f "dsh web"` 这类按名字杀的做法——那会把用户自己的实例一起杀掉
 *   （#162 之前有 session 这么干，打断了用户正在用的实例）。
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import * as crypto from 'node:crypto'
import * as fsp from 'node:fs/promises'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import { cookieHeader, exchangeToken } from '../../src/server/assemblyMirror.ts'
import type { LogSink } from '../../src/log.ts'

export interface EmptyGateway {
  readonly gateway: string
  readonly token: string
  /** dsh 版本（`dsh --version` 的输出，取不到为 undefined）。 */
  readonly version?: string
  /** 临时 `DSH_HOME`（跑完连同里面的东西一起删）。 */
  readonly home: string
  readonly pid: number
  /** 放进去的最小数据（见 {@link seedEmptyGateway}；`seed: false` 时两张表都空）。 */
  readonly seed: { readonly workspaceIds: readonly string[]; readonly sessionIds: readonly string[] }
  dispose(): Promise<void>
}

/** 现取一个空闲端口：绑 0 让系统给，拿到号就关掉。 */
export async function freePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => {
        resolve(port)
      })
    })
  })
}

/** 这个端口上有人在监听吗（起网关闭前再确认一次，别撞上别人刚起的服务）。 */
async function portListening(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    const done = (listening: boolean): void => {
      socket.destroy()
      resolve(listening)
    }
    socket.on('connect', () => done(true))
    socket.on('error', () => done(false))
    socket.setTimeout(1_000, () => done(false))
  })
}

/** dsh 二进制的版本（页面上的版本门要它；取不到就返回 undefined，页面会挂一条信息条）。 */
function dshVersion(env: NodeJS.ProcessEnv): string | undefined {
  try {
    const out = execFileSync('dsh', ['--version'], { encoding: 'utf8', env, timeout: 20_000 }).trim()
    return /^\d+\.\d+\.\d+/.test(out) ? (out.split('\n')[0] ?? '').trim() : undefined
  } catch {
    return undefined
  }
}

/** 收一个子进程：先 SIGTERM，超过 `graceMs` 还不退就 SIGKILL。 */
async function killByPid(child: ChildProcess, graceMs = 5_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* 已经没了 */
      }
      resolve()
    }, graceMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    try {
      child.kill('SIGTERM')
    } catch {
      clearTimeout(timer)
      resolve()
    }
  })
}

export interface StartEmptyGatewayOptions {
  /** 指定端口（缺省现取空闲的）。 */
  port?: number
  /** 就绪超时（毫秒）。 */
  readyTimeoutMs?: number
  /**
   * 起来之后往这个空实例里放一份**最小数据**（缺省放）：两个临时目录当工作区、各开一个
   * 会话。理由见 {@link seedEmptyGateway}。
   */
  seed?: boolean
}

/**
 * 空实例起来之后放一份最小数据：两个工作区 + 各一个会话。
 *
 * 为什么必须放（而不是让套件自己造）：对话区那棵树要有**一条真打开的会话**才有
 * composer、右栏、会话头这些座位——没有会话时它渲染的是「选一个工作区」的首屏，
 * 靠页内夹具造不出「会话真的开着」这件事（那要整条 `session/control` 流与投影）。
 * 侧栏那棵树同样要至少一行工作区。这份数据走**官方 RPC**（`workspace/create` +
 * `session/create`，与官方客户端同一条路），只写进本次运行的临时 `DSH_HOME`，
 * 用户的 `~/.dsh` 与日常实例一个字节都不动。
 *
 * 它只提供「有工作区、有会话」这个**下限**；要控制会话行有多少、标题是什么、
 * 属于哪个工作区，用套件自己的页内夹具（`test/assembly-lab/dataset.ts`）。
 */
async function seedEmptyGateway(gateway: string, token: string, log: LogSink): Promise<{ workspaceIds: string[]; sessionIds: string[] }> {
  await exchangeToken(gateway, token, log)
  const cookie = cookieHeader(gateway)
  const call = async (method: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const response = await fetch(`${gateway}/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie === undefined ? {} : { cookie }) },
      body: JSON.stringify({ type: 'client-request', rpcId: `seed-${crypto.randomUUID()}`, method, payload: { args } }),
      signal: AbortSignal.timeout(30_000),
    })
    const body = (await response.json()) as { result?: { ok?: boolean; value?: Record<string, unknown>; error?: { message?: string } } }
    if (body.result?.ok !== true) {
      throw new Error(`${method} 失败：${body.result?.error?.message ?? `HTTP ${String(response.status)}`}`)
    }
    return body.result.value ?? {}
  }
  const workspaceIds: string[] = []
  const sessionIds: string[] = []
  for (const name of ['lab-workspace-a', 'lab-workspace-b']) {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), `${name}-`))
    const created = await call('workspace/create', { request: { path: dir } })
    const workspace = (created.workspace ?? {}) as { workspaceId?: unknown }
    const workspaceId = typeof workspace.workspaceId === 'string' ? workspace.workspaceId : undefined
    if (workspaceId === undefined) throw new Error('workspace/create 没有回 workspaceId')
    workspaceIds.push(workspaceId)
    const session = await call('session/create', { request: { workspaceId } })
    const sessionId = typeof session.sessionId === 'string' ? session.sessionId : undefined
    if (sessionId === undefined) throw new Error('session/create 没有回 sessionId')
    sessionIds.push(sessionId)
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
  log.info(`空实例的最小数据：工作区 ${workspaceIds.join('、')}，会话 ${sessionIds.join('、')}`)
  return { workspaceIds, sessionIds }
}

/**
 * 起一个空实例网关：临时 `DSH_HOME` + 独立端口 + `--no-open`（**必须**，否则会在用户
 * 桌面上弹一个浏览器窗口）。
 */
export async function startEmptyGateway(log: LogSink, options: StartEmptyGatewayOptions = {}): Promise<EmptyGateway> {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-empty-gateway-'))
  const requested = options.port ?? (await freePort())
  if (await portListening(requested)) {
    await fsp.rm(home, { recursive: true, force: true })
    throw new Error(`空实例网关的端口 ${String(requested)} 已经有人在监听，换一个。`)
  }
  const env: NodeJS.ProcessEnv = { ...process.env, DSH_HOME: home }
  let child: ChildProcess | undefined
  let log1 = ''
  const onData = (chunk: Buffer): void => {
    log1 = (log1 + chunk.toString('utf8')).slice(-8_000)
  }
  const dispose = async (): Promise<void> => {
    if (child !== undefined) await killByPid(child)
    await fsp.rm(home, { recursive: true, force: true }).catch(() => undefined)
  }
  try {
    child = spawn('dsh', ['web', '--host', '127.0.0.1', '--port', String(requested), '--no-open'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    const deadline = Date.now() + (options.readyTimeoutMs ?? 90_000)
    let token: string | undefined
    let exited = false
    child.once('exit', (code, signal) => {
      exited = true
      // 跑到一半这个网关自己没了的话，整轮剩下的套件都会红成「连不上网关」——那不是判据
      // 的问题，而是环境没了。把退出码、信号与它最后几行输出如实打出来，别让人对着
      // 一屏 ECONNREFUSED 猜（第 4 轮实测踩到过一次）。
      const tail = log1.trim().split('\n').slice(-6).join(' | ')
      log.warn(
        `空实例网关退出了（code=${String(code ?? 'null')} signal=${String(signal ?? 'null')}）：${tail === '' ? '没有输出' : tail}`,
      )
    })
    while (Date.now() < deadline) {
      if (exited) break
      token = /token=([A-Za-z0-9_-]+)/.exec(log1)?.[1]
      if (token !== undefined && log1.includes('dsh web:')) break
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    if (token === undefined) {
      const tail = log1.trim().split('\n').slice(-5).join(' | ')
      throw new Error(`空实例网关没起来（${String(requested)}）：${tail === '' ? '没有输出' : tail}`)
    }
    const gateway = `http://127.0.0.1:${String(requested)}`
    const port = requested
    // 就绪行出来表示已经在监听，但仍按 HTTP 确认一次——后面整轮都靠它，别在这里省一步。
    const httpDeadline = Date.now() + 15_000
    for (;;) {
      try {
        await fetch(gateway, { redirect: 'manual' })
        break
      } catch (err) {
        if (Date.now() > httpDeadline) {
          throw new Error(`空实例网关的 HTTP 端口不通（${String(port)}）：${err instanceof Error ? err.message : String(err)}`)
        }
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
    }
    const version = dshVersion(env)
    log.info(
      `空实例网关就绪：${gateway}（DSH_HOME=${home}，pid ${String(child.pid ?? -1)}，dsh ${version ?? '（版本未知）'}）`,
    )
    const seed = options.seed === false ? { workspaceIds: [], sessionIds: [] } : await seedEmptyGateway(gateway, token, log)
    return {
      gateway,
      token,
      ...(version === undefined ? {} : { version }),
      home,
      pid: child.pid ?? -1,
      seed,
      dispose,
    }
  } catch (err) {
    await dispose()
    throw err
  }
}
