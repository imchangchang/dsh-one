#!/usr/bin/env node
/**
 * 实验室孤儿巡检（#192）：判据 + 命令行入口，一个文件。
 *
 * 用法（缺省只报不动，`--kill` 才真收）：
 *
 *   scripts/lab-doctor.sh             # 巡检，打印现状（POSIX 入口；`node scripts/labDoctor.mjs` 同一件事）
 *   scripts/lab-doctor.sh --kill      # 巡检 + 收掉判据认定的孤儿
 *
 * 退出码：0 = 干净；1 = 还有孤儿（进程或临时目录）；2 = 用法错或当前平台跑不了。
 *
 * 实验室与各验证脚本自己起的 `dsh web` 实例，正常路径上都按 PID 收得掉
 * （#177 · #190 · #197）。收不掉的只剩两类物理事实：进程吃的是 `SIGKILL`
 * （信号根本没有机会进我们的收尾代码，父进程一退它就被 init 收养、PPID 变 1），
 * 或者父进程整棵被别的工具杀掉（收尾链一次都没跑到）。这两种情况只能事后发现，
 * 这个脚本就是那对眼睛。
 *
 * 判据的**唯一风险点**是别把用户自己那台实例当成孤儿收掉。所以「可以收」要同时
 * 满足四件事，任一条不成立就绝不收：
 *
 * 1. 命令行是我们自起实例的形状（`dsh web … --no-open`）；
 * 2. `DSH_HOME` 指向本机临时目录下、按实验室前缀 `mkdtemp` 出来的目录——用户那台
 *    用的是 `~/.dsh`，永远不满足这一条；
 * 3. pid 与端口都不是 `~/.dsh/dsh-owned.json` 里登记的那台（宁可不收，不可错收）；
 * 4. 父进程已经没了（PPID 为 1，或父进程不在进程表里）。
 *
 * 判据本身是纯函数（`classify`），单测在 `test/labDoctor.test.ts`；本文件被直接运行
 * 时（`node scripts/labDoctor.mjs`，或 `scripts/lab-doctor.sh` 包装）才去动进程。
 */
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/**
 * 实验室自起实例的临时 `DSH_HOME` 前缀（mkdtemp 模板，出处见
 * `test/assembly-lab/labGateway.ts`、`test/assembly-lab/freshGateway.ts`；
 * `dsh-empty-gateway-` 是会话里手工 `mktemp -d` 起空网关时用的，同样是临时家目录）。
 */
export const LAB_HOME_PREFIXES = ['dsh-lab-home-', 'dsh-lab-fresh-home-', 'dsh-empty-gateway-']

/** 命令行里的 dsh 可执行文件 + `web` 子命令（`node …/bin/dsh web …` 也算）。 */
const DSH_WEB_RE = /(^|[/\\])dsh(\.cmd|\.exe)?\s+web(\s|$)/
/** `--no-open`：自起实例的标志——实验室与探针起网关都带它，用户手起的那台不带。 */
const NO_OPEN_RE = /(^|\s)--no-open(\s|$)/
/** `--port 3080` 与 `--port=3080` 两种写法。 */
const PORT_RE = /(^|\s)--port(\s+|=)(\d+)(\s|$)/

/**
 * 目录「刚建出来」的宽限：一个正在启动的网关先 `mkdtemp` 再 `spawn`，两者之间有
 * 几毫秒的空档；这段时间里它的进程可能还没出现在进程表上，看起来就像没人认领。
 * 宁可放过一个孤儿（下次再跑就收了），也不删掉一个正在启动的实例的家目录。
 */
const FRESH_DIR_MS = 60_000

/** 收进程时的礼貌等待：先 `SIGTERM`，这么久还不退再 `SIGKILL`。 */
const TERM_GRACE_MS = 5_000

/** 命令行是不是我们自起实例的形状。 */
export function isLabCommand(args) {
  return DSH_WEB_RE.test(args) && NO_OPEN_RE.test(args)
}

/** 命令行里的 `--port N`（没有就 undefined）。 */
export function parsePort(args) {
  const m = PORT_RE.exec(args)
  return m === null ? undefined : Number.parseInt(m[3], 10)
}

/** 把路径规范化到同一把尺子上（`/var` 与 `/private/var` 这类软链在本机是同一处）。 */
export function canonical(p) {
  if (p === undefined || p === null || p === '') return undefined
  try {
    return fs.realpathSync(p)
  } catch {
    return path.resolve(p)
  }
}

/**
 * 目录是不是本机临时目录下、按实验室前缀建出来的 `DSH_HOME`。
 *
 * 比的是**父目录**的规范路径而不是目录本身的：本机 tmpdir 的规范路径是
 * `/private/var/...`（`os.tmpdir()` 给的是 `/var/...`），而候选目录常常已经不存在了
 * （孤儿实例退掉、目录还在；或者顺手检查一个还没建出来的家目录），路径不存在时
 * `realpath` 退化成 `resolve`，两边就对不上了。父目录（tmpdir 本身）一定存在，
 * 拿它比才稳。
 */
export function isLabHome(dir, tmpdir = os.tmpdir()) {
  if (typeof dir !== 'string' || dir === '') return false
  const t = canonical(tmpdir)
  if (t === undefined) return false
  const parent = canonical(path.dirname(path.resolve(dir)))
  if (parent === undefined || parent !== t) return false
  return LAB_HOME_PREFIXES.some((prefix) => path.basename(path.resolve(dir)).startsWith(prefix))
}

/** 父进程还在不在。 */
function parentAlive(ppid, byPid) {
  if (ppid === 0 || ppid === 1) return false
  return byPid.has(ppid)
}

/**
 * 给一条进程记录定性质。返回 `{ verdict, why }`，`verdict` 取值：
 *
 * - `owned`：用户自己那台实例（`~/.dsh/dsh-owned.json` 登记的那台）——**永不收**；
 * - `foreign`：命令行对但家目录不是实验室临时目录（例如用真实 `~/.dsh` 起的）
 *   ——**永不收**；取不到 `DSH_HOME` 也落这里（读不到就按陌生人对待）；
 * - `lab-live`：实验室起的、父进程还在跑——**不收**，它有人管；
 * - `lab-orphan`：实验室起的、父进程没了——**这就是孤儿**，`--kill` 时收它。
 */
export function classify(rec) {
  const { pid, ppid, args, dshHome, owned, tmpdir, byPid = new Map() } = rec
  if (!isLabCommand(args)) return { verdict: 'foreign', why: '命令行不是自起实例的形状' }
  if (owned !== null && owned !== undefined && pid === owned.pid) {
    return { verdict: 'owned', why: '`~/.dsh/dsh-owned.json` 登记的正是这个 pid' }
  }
  const port = parsePort(args)
  if (owned !== null && owned !== undefined && port !== undefined && port === owned.port) {
    return { verdict: 'owned', why: `端口 ${String(port)} 就是登记实例的端口` }
  }
  if (dshHome === undefined || !isLabHome(dshHome, tmpdir)) {
    return {
      verdict: 'foreign',
      why: dshHome === undefined ? '读不到 DSH_HOME（按陌生人对待）' : `DSH_HOME 不是实验室临时目录（${dshHome}）`,
    }
  }
  if (parentAlive(ppid, byPid)) {
    return { verdict: 'lab-live', why: `父进程 ${String(ppid)} 还在，它有人管` }
  }
  return {
    verdict: 'lab-orphan',
    why: ppid === 1 ? 'PPID 已是 1（父进程退了，被 init 收养）' : `父进程 ${String(ppid)} 已不在进程表里`,
  }
}

/** `ps` 的 `etime` 三种形状：`MM:SS`、`HH:MM:SS`、`D-HH:MM:SS`。 */
export function parseElapsed(text) {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(text.trim())
  if (m === null) return undefined
  const days = Number.parseInt(m[1] ?? '0', 10)
  const hours = Number.parseInt(m[2] ?? '0', 10)
  return days * 86_400 + hours * 3_600 + Number.parseInt(m[3], 10) * 60 + Number.parseInt(m[4], 10)
}

/** Linux 形状：`/proc/<pid>/environ` 是 NUL 分隔的 `KEY=VALUE` 串。 */
export function parseProcEnviron(text) {
  const m = /(?:^|\0)DSH_HOME=([^\0]*)/.exec(text)
  return m === null ? undefined : m[1]
}

/** macOS 形状：`ps eww -p <pid> -o command=` 把环境接在命令行后面，空格分隔。 */
export function parsePsEnvLine(text) {
  const m = /(?:^|\s)DSH_HOME=(\S*)/.exec(text)
  return m === null ? undefined : m[1]
}

/**
 * 读另一条进程的 `DSH_HOME`：Linux 走 `/proc`，其余 POSIX 走 `ps eww`（环境跟在命令行后面）。
 * 读不到（进程没了、没权限、平台不认这条路）一律返回 `undefined`——上层按「陌生人」对待。
 */
export function readDshHome(pid, platform = process.platform) {
  try {
    if (platform === 'linux') return parseProcEnviron(fs.readFileSync(`/proc/${String(pid)}/environ`, 'utf8'))
    const out = execFileSync('ps', ['eww', '-p', String(pid), '-o', 'command='], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    return parsePsEnvLine(out)
  } catch {
    return undefined
  }
}

/**
 * 进程表（`ps` 全量，POSIX）。Windows 上返回 `null`——实验室那套起实例的代码本来就只在
 * POSIX 上跑（`spawn('dsh', …)` 在 Windows 上没有 shim 解析），这里的判据（读环境变量）
 * 在那边也没有等价物，所以宁可明说「不支持」，不猜。
 */
export function listProcesses(platform = process.platform) {
  if (platform === 'win32') return null
  const out = execFileSync('ps', ['-eo', 'pid=,ppid=,etime=,args='], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  const rows = []
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line)
    if (m === null) continue
    rows.push({ pid: Number.parseInt(m[1], 10), ppid: Number.parseInt(m[2], 10), etime: m[3], args: m[4] })
  }
  return rows
}

/** `~/.dsh/dsh-owned.json`（形状见 `src/server/ownedRecord.ts` 的 `OwnedRecord`）。 */
export function readOwned(home = os.homedir()) {
  const file = path.join(home, '.dsh', 'dsh-owned.json')
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (typeof parsed?.pid !== 'number' || typeof parsed?.port !== 'number') return { file, record: null }
    return { file, record: { pid: parsed.pid, port: parsed.port } }
  } catch {
    return { file, record: null }
  }
}

/** 临时目录下按实验室前缀建出来的家目录。 */
export function listLabHomeDirs(tmpdir = os.tmpdir()) {
  let names
  try {
    names = fs.readdirSync(tmpdir)
  } catch {
    return []
  }
  return names
    .filter((name) => LAB_HOME_PREFIXES.some((prefix) => name.startsWith(prefix)))
    .map((name) => path.join(tmpdir, name))
    .sort()
}

/**
 * 扫一遍：候选进程（命令行像自起实例的）、它们的性质、临时目录里剩下的实验室家目录、
 * 以及登记在 `dsh-owned.json` 的那台。只读，不动任何东西。
 */
export function diagnose(options = {}) {
  const platform = options.platform ?? process.platform
  const tmpdir = options.tmpdir ?? os.tmpdir()
  const home = options.home ?? os.homedir()
  const rows = listProcesses(platform)
  if (rows === null) return { unsupported: true, platform }
  const byPid = new Map(rows.map((r) => [r.pid, r]))
  const { file: ownedFile, record: owned } = readOwned(home)

  const now = Date.now()
  const candidates = []
  const others = []
  /** pid → DSH_HOME，凡是命令行里出现 dsh 的都读一遍（目录认领判断要看到全部 dsh 实例）。 */
  const homesByPid = new Map()
  const dshish = rows.filter((r) => r.pid !== process.pid && r.pid !== process.ppid && /(^|[/\\])dsh(\.cmd|\.exe)?(\s|$)/.test(r.args))
  for (const row of dshish) {
    const dshHome = readDshHome(row.pid, platform)
    if (dshHome !== undefined) homesByPid.set(row.pid, dshHome)
    const common = {
      pid: row.pid,
      ppid: row.ppid,
      port: parsePort(row.args),
      dshHome,
      args: row.args,
      owned: owned !== null && row.pid === owned.pid,
    }
    if (!isLabCommand(row.args)) {
      // 命令行不是自起实例的形状（例如手工用 `--profile` 起的）。判据不碰它，但列出来
      // 有用：机器上「没人在管的 dsh 实例」不止实验室这一种来源。
      const elapsed = parseElapsed(row.etime)
      others.push({ ...common, startedAt: elapsed === undefined ? undefined : new Date(now - elapsed * 1000), elapsed })
      continue
    }
    const elapsed = parseElapsed(row.etime)
    candidates.push({
      ...common,
      startedAt: elapsed === undefined ? undefined : new Date(now - elapsed * 1000),
      elapsed,
      ...classify({ pid: row.pid, ppid: row.ppid, args: row.args, dshHome, owned, tmpdir, byPid }),
    })
  }
  candidates.sort((a, b) => a.pid - b.pid)
  others.sort((a, b) => a.pid - b.pid)

  const liveHomes = new Set([...homesByPid.values()].map((h) => canonical(h)))
  const labDirs = listLabHomeDirs(tmpdir).map((dir) => {
    const claimedBy = [...homesByPid.entries()].filter(([, h]) => canonical(h) === canonical(dir)).map(([pid]) => pid)
    let mtimeMs
    try {
      mtimeMs = fs.statSync(dir).mtimeMs
    } catch {
      mtimeMs = undefined
    }
    const fresh = mtimeMs !== undefined && now - mtimeMs < FRESH_DIR_MS
    return { dir, mtimeMs, claimedBy, orphan: claimedBy.length === 0, fresh }
  })

  const ownedProcess = owned === null ? undefined : rows.find((r) => r.pid === owned.pid)
  return {
    unsupported: false,
    tmpdir,
    ownedFile,
    owned: owned === null ? null : { ...owned, running: ownedProcess !== undefined },
    candidates,
    others,
    labDirs,
    orphans: candidates.filter((c) => c.verdict === 'lab-orphan'),
    orphanDirs: labDirs.filter((d) => d.orphan),
  }
}
/*
 * 命令行部分：把判据扫出来的东西打印出来，`--kill` 时按判据动手。
 * 判据本身是上面的纯函数（单测直接 import），这里只做 I/O 与打印。
 */
import { fileURLToPath } from 'node:url'

const USAGE = `实验室孤儿巡检（#192）——看机器上有没有实验室自起、又没人回收的 dsh 实例。

用法：scripts/lab-doctor.sh [--kill]

  缺省   只报不动：列出候选实例（各自的性质与理由）、临时目录、以及你自己那台实例。
  --kill 真收：只收判据认定是实验室临时实例的孤儿（命令行 + 临时 DSH_HOME + 不是
         你登记的那台 + 父进程已死，四条同时成立），并删掉没人认领的实验室临时目录。
         SIGKILL 掉的是收不了的物理事实，这里只能事后发现、事后收。

退出码：0 = 干净；1 = 还有孤儿；2 = 用法错或当前平台跑不了。
`

function stamp(date) {
  if (date === undefined) return '未知'
  const pad = (n) => String(n).padStart(2, '0')
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function humanElapsed(seconds) {
  if (seconds === undefined) return ''
  if (seconds < 90) return `${String(seconds)} 秒`
  if (seconds < 3_600) return `${String(Math.round(seconds / 60))} 分钟`
  if (seconds < 86_400) return `${String(Math.round(seconds / 3_600))} 小时`
  return `${String(Math.round(seconds / 86_400))} 天`
}

const VERDICT_LABEL = {
  owned: '你自己那台（不收）',
  foreign: '不是实验室实例（不收）',
  'lab-live': '实验室起的，正在跑（不收）',
  'lab-orphan': '孤儿（可收）',
}

function printReport(report) {
  const lines = []
  lines.push(`实验室孤儿巡检（#192）—— 临时目录 ${report.tmpdir}`)
  lines.push('')

  lines.push('用户自己那台实例（登记在 ~/.dsh/dsh-owned.json）：')
  if (report.owned === null) {
    lines.push(`  没有登记（${report.ownedFile} 不存在、读不出，或字段不全）→ 那台实例只能靠「不是临时 DSH_HOME」识别`)
  } else {
    lines.push(`  pid ${String(report.owned.pid)} · 端口 ${String(report.owned.port)} · ${report.owned.running ? '正在跑' : '进程不在（登记是旧的）'}`)
    lines.push('  上面这个 pid 与端口是白名单：判据认它就别的一律不收。')
  }
  lines.push('')

  lines.push('命令行像自起实例的进程：')
  if (report.candidates.length === 0) {
    lines.push('  一个都没有。')
  } else {
    for (const c of report.candidates) {
      const home = c.dshHome ?? '没设（默认 ~/.dsh）'
      lines.push(`  pid ${String(c.pid)} · 端口 ${c.port ?? '未知'} · ${VERDICT_LABEL[c.verdict]}`)
      lines.push(`      起于 ${stamp(c.startedAt)}（${humanElapsed(c.elapsed)}前） · 父进程 ${String(c.ppid)} · DSH_HOME=${home}`)
      lines.push(`      为什么：${c.why}`)
    }
  }
  lines.push('')
  lines.push('其它 dsh 进程（命令行不是自起实例的形状，判据不碰；列出来只为看全现场）：')
  if (report.others.length === 0) {
    lines.push('  一个都没有。')
  } else {
    for (const o of report.others) {
      const mine = o.owned ? ' · 这是你登记的那台' : ''
      lines.push(`  pid ${String(o.pid)} · 父进程 ${String(o.ppid)} · 起于 ${stamp(o.startedAt)}（${humanElapsed(o.elapsed)}前）${mine}`)
      lines.push(`      ${o.args}`)
      lines.push(`      DSH_HOME=${o.dshHome ?? '没设（默认 ~/.dsh）'}`)
    }
  }
  lines.push('')

  lines.push('临时目录里的实验室家目录：')
  if (report.labDirs.length === 0) {
    lines.push('  一个都没有。')
  } else {
    for (const d of report.labDirs) {
      const who = d.claimedBy.length === 0 ? '没人认领' : `pid ${d.claimedBy.join('、')} 用着`
      const fresh = d.fresh ? ' · 刚建出来（可能正在启动，先放过）' : ''
      lines.push(`  ${d.dir}  [${who}${fresh}]`)
    }
  }
  lines.push('')

  const orphanCount = report.orphans.length
  const dirCount = report.orphanDirs.length
  if (orphanCount === 0 && dirCount === 0) {
    lines.push('结论：干净——没有孤儿实例，也没有没人认领的实验室临时目录。')
  } else {
    lines.push(`结论：${String(orphanCount)} 个孤儿实例、${String(dirCount)} 个没人认领的实验室临时目录。`)
    for (const c of report.orphans) lines.push(`  · pid ${String(c.pid)}（端口 ${c.port ?? '未知'}，${c.why}）`)
    for (const d of report.orphanDirs) lines.push(`  · ${d.dir}`)
  }
  return lines.join('\n')
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitGone(pid, ms) {
  const deadline = Date.now() + ms
  for (;;) {
    try {
      process.kill(pid, 0)
    } catch {
      return true
    }
    if (Date.now() >= deadline) return false
    await sleep(100)
  }
}

/**
 * 收一条孤儿：杀之前**再核一遍**（拿一份新的进程表重跑判据）。列表与动手之间隔了时间，
 * 这中间 pid 可能被回收、命令可能变了——所以四条件在这里一条不放松地重判，任何一条
 * 不成立就跳过并说明。
 */
async function reapProcess(orphan, report) {
  const fresh = diagnose({ tmpdir: report.tmpdir })
  const row = fresh.candidates.find((c) => c.pid === orphan.pid)
  if (row === undefined || row.verdict !== 'lab-orphan' || !isLabCommand(row.args) || !isLabHome(row.dshHome, fresh.tmpdir)) {
    return { pid: orphan.pid, ok: false, note: '动手前复核没通过（命令行或 DSH_HOME 变了 / 已经退了），跳过' }
  }
  const owned = fresh.owned
  if (owned !== null && (orphan.pid === owned.pid || (row.port !== undefined && row.port === owned.port))) {
    return { pid: orphan.pid, ok: false, note: '动手前复核发现它是登记实例（pid 或端口撞上），跳过' }
  }
  try {
    process.kill(orphan.pid, 'SIGTERM')
  } catch (err) {
    return { pid: orphan.pid, ok: false, note: `SIGTERM 发不出去：${err instanceof Error ? err.message : String(err)}` }
  }
  if (await waitGone(orphan.pid, TERM_GRACE_MS)) return { pid: orphan.pid, ok: true, note: 'SIGTERM 收掉' }
  try {
    process.kill(orphan.pid, 'SIGKILL')
  } catch (err) {
    return { pid: orphan.pid, ok: false, note: `SIGKILL 发不出去：${err instanceof Error ? err.message : String(err)}` }
  }
  return (await waitGone(orphan.pid, 5_000))
    ? { pid: orphan.pid, ok: true, note: 'SIGTERM 没退，SIGKILL 收掉' }
    : { pid: orphan.pid, ok: false, note: 'SIGKILL 之后还在，得人工看一眼' }
}

/**
 * 收了进程之后重扫一遍再删目录：刚被杀掉的实例，它的家目录这时才变成没人认领。
 *
 * 「刚建出来」的宽限（`fresh`）只对**从来没人认领**的目录生效：一个正在启动的网关
 * 先 `mkdtemp` 再 `spawn`，两者之间有几十毫秒的空档，这时它的目录看着就像没人要。
 * 刚刚被我们按 PID 收掉的那台不算——它的家目录删掉是安全的，不用等下一次。
 */
function reapDirs(report, killedPids) {
  const fresh = diagnose({ tmpdir: report.tmpdir })
  const claimedByKilled = (dir) => (report.labDirs.find((d) => d.dir === dir)?.claimedBy ?? []).some((pid) => killedPids.has(pid))
  const done = []
  for (const d of fresh.orphanDirs) {
    if (d.fresh && !claimedByKilled(d.dir)) {
      done.push({ dir: d.dir, ok: false, note: '刚建出来不到 1 分钟，可能正在启动，跳过（稍后再跑一次）' })
      continue
    }
    try {
      fs.rmSync(d.dir, { recursive: true, force: true })
      done.push({ dir: d.dir, ok: true, note: '删掉' })
    } catch (err) {
      done.push({ dir: d.dir, ok: false, note: `删不掉：${err instanceof Error ? err.message : String(err)}` })
    }
  }
  return done
}

/** `--kill` 之后的复查：干净就一句话，还有剩的就把剩下的逐条列出来。 */
function printAfter(report) {
  const lines = [`\n收完再看一遍：${String(report.orphans.length)} 个孤儿实例、${String(report.orphanDirs.length)} 个没人认领的实验室临时目录。`]
  for (const c of report.orphans) lines.push(`  · pid ${String(c.pid)}（端口 ${c.port ?? '未知'}，${c.why}）`)
  for (const d of report.orphanDirs) lines.push(`  · ${d.dir}${d.fresh ? '（刚建出来的，稍后再跑一次）' : ''}`)
  if (report.orphans.length === 0 && report.orphanDirs.length === 0) lines.push('干净了。')
  return lines.join('\n')
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('-h') || argv.includes('--help')) {
    process.stdout.write(USAGE)
    return 0
  }
  for (const arg of argv) {
    if (arg !== '--kill') {
      process.stderr.write(`lab-doctor: 不认识的参数 ${arg}\n\n${USAGE}`)
      return 2
    }
  }
  const kill = argv.includes('--kill')

  const report = diagnose({})
  if (report.unsupported) {
    process.stderr.write(`lab-doctor: 这套判据要在 POSIX 上跑（macOS / Linux），当前是 ${report.platform}。\n`)
    return 2
  }
  process.stdout.write(`${printReport(report)}\n`)

  if (!kill) {
    if (report.orphans.length === 0 && report.orphanDirs.length === 0) return 0
    process.stdout.write('\n上面这些还都在。确认无误后跑 `scripts/lab-doctor.sh --kill` 收掉。\n')
    return 1
  }

  if (report.orphans.length === 0 && report.orphanDirs.length === 0) return 0

  process.stdout.write('\n开始收（每条动手前都会重核一遍判据）：\n')
  const killedPids = new Set()
  for (const orphan of report.orphans) {
    const r = await reapProcess(orphan, report)
    if (r.ok) killedPids.add(r.pid)
    process.stdout.write(`  pid ${String(r.pid)}：${r.note}\n`)
  }
  for (const r of reapDirs(report, killedPids)) {
    process.stdout.write(`  ${r.dir}：${r.note}\n`)
  }

  const after = diagnose({})
  process.stdout.write(`${printAfter(after)}\n`)
  return after.orphans.length === 0 && after.orphanDirs.length === 0 ? 0 : 1
}

const entry = process.argv[1] === undefined ? '' : canonical(process.argv[1])
if (entry === canonical(fileURLToPath(import.meta.url))) {
  main().then(
    (code) => {
      process.exitCode = code
    },
    (err) => {
      process.stderr.write(`lab-doctor: 跑挂了：${err instanceof Error ? err.stack ?? err.message : String(err)}\n`)
      process.exitCode = 2
    },
  )
}
