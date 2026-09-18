/**
 * 机器现场读数（#203）：这一轮整轮验证是**独占**跑的，还是**并发**跑的。
 *
 * 为什么要有它：长轮次里那次会话面退化只在「机器上同时有别的 session 在跑实验」时出现过，
 * 事后单跑全绿。要能把这种红与真回归分开，报告里就必须有一行「这一轮跑的时候机器是什么
 * 样」，而不是靠人回忆。读数进 ledger 的 `environment.machine`（报告抬头那张表）与 R-06
 * 的观测行——**只记事实，不判任何一条断言**（别人的实验不该决定我们的门禁，见 #175）。
 *
 * 口径（`ps` 快照 + `os` 的三个量，**只读**）：
 * - **别的实验室轮次** = **以 `node` 开头**、命令里含 `test/assembly-lab/verify.ts` 且 pid 不是
 *   自己的进程——别的 session 的 `verify:lab`（正是 #203 现场里那些实验）。只认 node 开头，
 *   是因为启动它的 shell 的命令行里也含同一段路径（#203 第一次实测把 3 条轮次数成了 10 条）；
 * - **别的 dsh 网关** = `dsh web` 进程里不属于本轮隔离实例的那些（用户日常那台会在里面，
 *   所以这条只作事实，单看它不能判「并发」）；
 * - **别的 chromium** = 命令里含 `ms-playwright` 且不属于本轮的那些进程（别的浏览器验证线；
 *   一趟验证会拉起好几个进程，所以这个数只当「机器上还有几摊浏览器」的量级看）。
 *
 * `ps` 在 macOS / Linux 上都在；取不到（例如 Windows 没有 `ps`）时如实记一句「取不到」，
 * 不猜、也不当作「没有并发」。
 */
import { execFileSync } from 'node:child_process'
import * as os from 'node:os'

export interface MachineLoad {
  /** 别的实验室轮次条数；-1 = 这次读不到。 */
  otherLabRounds: number
  /** 别的 dsh 网关条数（不含本轮隔离实例）；-1 = 这次读不到。 */
  otherGateways: number
  /** 别的 chromium **进程**条数（一趟浏览器验证会拉起好几个），-1 = 这次读不到。 */
  otherBrowsers: number
  /** 那几台别的网关的端口（人看的）。 */
  otherGatewayPorts: number[]
  /** 1 分钟平均负载。 */
  load1: number
  /** 逻辑核数。 */
  cpus: number
  /** 可用内存占比（0~1）。 */
  freeMemRatio: number
  /** 读不到时的实情（空串 = 读到了）。 */
  detail: string
}

/** 从 `ps -Ao pid=,command=` 的输出里数出「别人也在跑什么」（纯函数，单测覆盖）。 */
export function countProcesses(
  output: string,
  options: { selfPid: number; gatewayPid?: number },
): { otherLabRounds: number; otherGateways: number; otherBrowsers: number; otherGatewayPorts: number[] } {
  let otherLabRounds = 0
  let otherGateways = 0
  let otherBrowsers = 0
  const otherGatewayPorts: number[] = []
  for (const line of output.split('\n')) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line)
    if (match === null) continue
    const pid = Number(match[1])
    const command = match[2] ?? ''
    if (command === '') continue
    // 只认**真在跑这条轮次的 node 进程**：命令必须以 `node`（可带路径）开头。
    // 不加这条会把启动它的 shell 也算进去——`bash -c '… node test/assembly-lab/verify.ts …'`
    // 的命令行里同样含那段路径，#203 第一次实测把 3 条轮次数成了 10 条。
    if (/^(\S*\/)?node\s+\S*test\/assembly-lab\/verify\.ts\b/.test(command) && pid !== options.selfPid) {
      otherLabRounds += 1
    }
    if (/(^|[/\s])dsh\s+web\b/.test(command) && pid !== options.gatewayPid) {
      otherGateways += 1
      const port = /--port\s+(\d+)/.exec(command)?.[1]
      if (port !== undefined) otherGatewayPorts.push(Number(port))
    }
    // chromium 数的是**进程**（一趟浏览器验证会拉起浏览器主进程 + gpu + 网络 + 每个渲染进程），
    // 所以这个数只当「机器上还有几摊浏览器」的量级看，别当轮次条数。
    if (command.includes('ms-playwright') && pid !== options.selfPid) otherBrowsers += 1
  }
  return { otherLabRounds, otherGateways, otherBrowsers, otherGatewayPorts: otherGatewayPorts.sort((a, b) => a - b) }
}

/** 一次机器现场读数。`gatewayPid` = 本轮隔离实例的 pid（有就排除掉）。 */
export function readMachineLoad(gatewayPid?: number): MachineLoad {
  const base: MachineLoad = {
    otherLabRounds: -1,
    otherGateways: -1,
    otherBrowsers: -1,
    otherGatewayPorts: [],
    load1: os.loadavg()[0] ?? 0,
    cpus: os.cpus().length,
    freeMemRatio: os.totalmem() === 0 ? 0 : os.freemem() / os.totalmem(),
    detail: '',
  }
  let output: string
  try {
    output = execFileSync('ps', ['-Ao', 'pid=,command='], { encoding: 'utf8', timeout: 10_000 })
  } catch (err) {
    return { ...base, detail: `ps 读不到（${err instanceof Error ? err.message.split('\n')[0] ?? '' : String(err)}）` }
  }
  const counts = countProcesses(output, { selfPid: process.pid, ...(gatewayPid === undefined ? {} : { gatewayPid }) })
  return { ...base, ...counts }
}

/** 一行读数的口径说明与数值（报告里逐条记事实用）。 */
export function describeMachineLoad(load: MachineLoad): string {
  if (load.detail !== '') return `机器现场：${load.detail}`
  return (
    `机器现场：别的实验室轮次 ${String(load.otherLabRounds)} 条、别的 dsh 网关 ${String(load.otherGateways)} 台` +
    `${load.otherGatewayPorts.length === 0 ? '' : `（端口 ${load.otherGatewayPorts.join('/')}）`}、别的 chromium ${String(load.otherBrowsers)} 个进程；` +
    `负载 ${load.load1.toFixed(2)}/${String(load.cpus)} 核、可用内存 ${(load.freeMemRatio * 100).toFixed(0)}%`
  )
}

/**
 * 「这一轮是并发跑的还是独占跑的」的一句话结论（进报告抬头那张表，给人一眼看出）。
 *
 * 判据**故意不看别的 dsh 网关那一项**：用户日常那台 3080 永远在，拿它当依据的话每一轮
 * 都会被判成并发。判的是「有没有别人同时在做实验」：别的实验室轮次 > 0，或负载已经压到
 * 每核 0.5 以上。
 */
export function concurrencyLabel(load: MachineLoad): string {
  if (load.detail !== '') return `读不到（${load.detail}）`
  const busy = load.load1 >= load.cpus * 0.5
  if (load.otherLabRounds === 0 && !busy) return `独占（同一时刻没有别的实验室轮次，负载 ${load.load1.toFixed(2)}/${String(load.cpus)} 核）`
  const reasons: string[] = []
  if (load.otherLabRounds > 0) reasons.push(`同时有 ${String(load.otherLabRounds)} 条别的实验室轮次`)
  if (busy) reasons.push(`负载 ${load.load1.toFixed(2)}/${String(load.cpus)} 核`)
  return `并发（${reasons.join('、')}）`
}
