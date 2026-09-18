/**
 * 「全新 `DSH_HOME`」的 dsh 网关（#164）：实验室需要一台**干净 profile** 的
 * 网关时，用它现起一台、跑完按 PID 收掉、临时目录一并删掉。
 *
 * 为什么要有这个东西：日常那台网关带着用户 profile 的全部补丁与数据，
 * 有些缺口只会在干净 profile 上暴露（#164 的现场：侧栏树 block list 挡掉了
 * `ui-commands`，日常 profile 里它被 `@dsh-one/dsh-llm-provider` 的 bundle patch
 * 连带关掉了上游那几件、没人去等它的 `commandUi` 服务，于是只有全新 `DSH_HOME`
 * 上才卡 boot）。要常驻守住这一类，就必须能**在验证里现起一台干净的网关**。
 *
 * 规矩（都为了不打扰用户与其它 session）：
 * - 端口用 `--port 0` 让内核挑，**不占已知端口**；`--no-open` 不开浏览器窗口；
 * - `DSH_HOME` 指向 `mkdtemp` 出来的临时目录——不碰 `~/.dsh`，也不写
 *   `~/.dsh/dsh-owned.json`（那个文件只有扩展 spawn/adopt 的实例会记）；
 * - 收尾**按 PID** 杀（`SIGTERM` → 超时 `SIGKILL`），**不用 `pkill`**：
 *   `pkill -f "dsh web"` 会连用户正在用的实例一起打断。
 *
 * #162（空实例整轮门禁）要起自己的干净网关时可以直接复用本模块。
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { scratchDir } from '../scratchDirs.ts'

export interface FreshGateway {
  /** 临时 `DSH_HOME`（`dispose()` 时删掉）。 */
  readonly home: string
  /** `http://127.0.0.1:<port>`（端口由内核分配）。 */
  readonly origin: string
  /** 启动 URL 里那枚 launch token。 */
  readonly token: string
  /** `dsh --version` 读到的版本（读不到 undefined）：传给实验室消掉「版本未知」信息条。 */
  readonly version?: string
  /** 进程 pid（收尾按它杀）。 */
  readonly pid: number | undefined
  dispose(): Promise<void>
}

export interface FreshGatewayOptions {
  /** 等网关就绪的上限（毫秒，缺省 90 秒；冷启动要加载全部插件）。 */
  timeoutMs?: number
  /** 每一行启动输出的去处（诊断用；缺省不输出）。 */
  onLine?: (line: string) => void
}

/** 启动横幅里那行 `dsh web: http://127.0.0.1:PORT/?token=TOKEN`。 */
const BANNER_RE = /dsh web: (http:\/\/[^\s/]+)\/\?token=([A-Za-z0-9_-]+)/

/** `dsh` 可执行文件（PATH 里那个）。 */
const DSH = process.env.LAB_DSH ?? 'dsh'

function dshVersion(): string | undefined {
  try {
    return execFileSync(DSH, ['--version'], { encoding: 'utf8', timeout: 15_000 }).trim() || undefined
  } catch {
    return undefined
  }
}

/**
 * 起一台全新 `DSH_HOME` 的网关，等它打出启动横幅再返回。
 *
 * 起不来（`dsh` 不在 PATH、版本不兼容、端口起不来）时抛错，错误信息里带上它
 * 打过的全部输出——这种失败必须看得见，不能让它变成「套件悄悄跳过」。
 */
export async function startFreshGateway(options: FreshGatewayOptions = {}): Promise<FreshGateway> {
  const home = await scratchDir('dsh-lab-fresh-home-')
  const child: ChildProcess = spawn(DSH, ['web', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
    cwd: os.tmpdir(),
    env: { ...process.env, DSH_HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const output: string[] = []
  let settled = false

  const started = await new Promise<{ origin: string; token: string } | null>((resolve) => {
    let timer: NodeJS.Timeout | undefined
    const finish = (value: { origin: string; token: string } | null): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      resolve(value)
    }
    const consume = (chunk: Buffer): void => {
      const text = chunk.toString('utf8')
      options.onLine?.(text.trimEnd())
      // 只留最后 8KB：起得来时这些只是为了报错时能看懂现场。
      output.push(text)
      while (output.join('').length > 8192) output.shift()
      const match = BANNER_RE.exec(text)
      if (match !== null) finish({ origin: match[1], token: match[2] })
    }
    child.stdout?.on('data', consume)
    child.stderr?.on('data', consume)
    child.on('error', (err) => {
      output.push(`spawn ${DSH} 失败：${err.message}`)
      finish(null)
    })
    child.on('exit', (code, signal) => {
      output.push(`网关进程提前退出（code=${String(code)} signal=${String(signal)}）`)
      finish(null)
    })
    timer = setTimeout(() => {
      output.push(`等启动横幅超时（${String(options.timeoutMs ?? 90_000)}ms）`)
      finish(null)
    }, options.timeoutMs ?? 90_000)
  })

  if (started === null) {
    await kill(child)
    await fsp.rm(home, { recursive: true, force: true })
    throw new Error(`fresh gateway 起不来：\n${output.join('')}`)
  }

  return {
    home,
    origin: started.origin,
    token: started.token,
    version: dshVersion(),
    pid: child.pid,
    dispose: async (): Promise<void> => {
      await kill(child)
      await fsp.rm(home, { recursive: true, force: true })
    },
  }
}

/**
 * 按 PID 收进程：先 `SIGTERM`，给它 `graceMs` 自己退；到点还在就 `SIGKILL`。
 *
 * 单进程的 `dsh web` 杀掉就够了（它不在宿主上派生子进程）；不用 `pkill`，
 * 那会连用户自己正在用的实例一起带走（#164 的注意事项）。
 */
async function kill(child: ChildProcess, graceMs = 5000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  child.kill('SIGTERM')
  const timer = setTimeout(() => child.kill('SIGKILL'), graceMs)
  try {
    await exited
  } finally {
    clearTimeout(timer)
  }
}
