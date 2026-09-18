/**
 * 实验室孤儿巡检（#192，`scripts/lab-doctor.sh` + `scripts/labDoctor.mjs`）的单测与
 * 端到端负向对照。
 *
 * 这条脚本**唯一**的风险是收错东西——把用户自己那台实例当成孤儿收掉。所以分两段：
 *
 * 1. 纯判据单测：四条件（命令行形状 / 临时 `DSH_HOME` / 不是登记实例 / 父进程已死）
 *    逐条正反两面钉死，改判据改坏了这里先红；
 * 2. 端到端：在一个砂箱 `HOME` + 砂箱 `TMPDIR` 里真起两个假实例——一个登记进
 *    `dsh-owned.json` 当「你自己那台」，一个是孤儿——然后跑真脚本，对退出码、输出
 *    与「谁还活着」下断言。假实例的命令行与 `DSH_HOME` 都跟真实验室实例一个形状
 *    （连家目录都故意用实验室前缀），所以这里验的就是判据本身，不是替身。
 *    段 2 是 POSIX 专属（脚本用 `ps` 读进程表、读环境），Windows 上跳过。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { spawnSync } from 'node:child_process'
import { scratchDirSync } from './scratchDirs.ts'

const ROOT = path.join(import.meta.dirname, '..')
const MODULE_PATH = path.join(ROOT, 'scripts', 'labDoctor.mjs')
const SCRIPT = path.join(ROOT, 'scripts', 'lab-doctor.sh')

type Verdict = 'owned' | 'foreign' | 'lab-live' | 'lab-orphan'

interface ClassifyInput {
  pid: number
  ppid: number
  args: string
  dshHome?: string
  owned?: { pid: number; port: number } | null
  tmpdir?: string
  byPid?: Map<number, unknown>
}
interface LabDoctor {
  LAB_HOME_PREFIXES: readonly string[]
  isLabCommand(args: string): boolean
  parsePort(args: string): number | undefined
  isLabHome(dir: string, tmpdir?: string): boolean
  parseElapsed(text: string): number | undefined
  classify(rec: ClassifyInput): { verdict: Verdict; why: string }
  parseProcEnviron(text: string): string | undefined
  parsePsEnvLine(text: string): string | undefined
  listProcesses(platform?: string): unknown[] | null
  diagnose(options?: { platform?: string; tmpdir?: string; home?: string }): { unsupported?: boolean; platform?: string }
}

const doctor = (await import(MODULE_PATH)) as LabDoctor

/** 真实验室实例的命令行长这样（`test/assembly-lab/labGateway.ts` 的 spawn 参数）。 */
const labArgs = (port: number, extra: string[] = []): string =>
  [`node /Users/x/.nvm/versions/node/v24.19.0/bin/dsh`, 'web', '--host', '127.0.0.1', '--port', String(port), '--no-open', ...extra].join(' ')

// ---------------------------------------------------------------- 段 1：纯判据

test('isLabCommand：认得自起实例的形状，也认得不是的', () => {
  for (const args of [
    labArgs(59724),
    labArgs(0),
    'dsh web --host 127.0.0.1 --port 1 --no-open',
    'node C:\\x\\dsh.cmd web --host 127.0.0.1 --port 1234 --no-open',
  ]) {
    assert.equal(doctor.isLabCommand(args), true, `该认出来：${args}`)
  }
  const notLab: [string, string][] = [
    ['node /Users/x/bin/dsh web --host 127.0.0.1 --port 3080', '用户日常那台不带 --no-open（人是看着页面的）'],
    ['node /Users/x/bin/dsh --profile plan-test --port 3081 --no-open', '没有 web 子命令'],
    ['bash /repo/scripts/lab-doctor.sh --kill', '我们自己的巡检脚本'],
    ['node /repo/dsh-one/build.mjs', '路径里带 dsh 但不是 dsh'],
  ]
  for (const [args, why] of notLab) {
    assert.equal(doctor.isLabCommand(args), false, `不该认出来（${why}）：${args}`)
  }
})

test('parsePort：两种写法都认，没有就是 undefined', () => {
  assert.equal(doctor.parsePort(labArgs(59724)), 59724)
  assert.equal(doctor.parsePort('dsh web --host 127.0.0.1 --port=3080 --no-open'), 3080)
  assert.equal(doctor.parsePort('dsh web --host 127.0.0.1 --no-open'), undefined)
})

test('parseElapsed：ps 的三种 etime 形状', () => {
  assert.equal(doctor.parseElapsed('00:05'), 5)
  assert.equal(doctor.parseElapsed('02:03:04'), 7_384)
  assert.equal(doctor.parseElapsed('1-00:00:00'), 86_400)
  assert.equal(doctor.parseElapsed('垃圾'), undefined)
})

test('读 DSH_HOME 的两种平台形状各自能解析（Linux 的 /proc 串、macOS 的 ps 行）', () => {
  // Linux：`/proc/<pid>/environ` 是 NUL 分隔的 KEY=VALUE
  assert.equal(doctor.parseProcEnviron('HOME=/Users/x\0DSH_HOME=/tmp/dsh-lab-home-AAAAAA\0PATH=/bin'), '/tmp/dsh-lab-home-AAAAAA')
  assert.equal(doctor.parseProcEnviron('DSH_HOME=/tmp/dsh-lab-home-AAAAAA\0'), '/tmp/dsh-lab-home-AAAAAA', '头一个也是 NUL 起头')
  assert.equal(doctor.parseProcEnviron('HOME=/Users/x\0PATH=/bin'), undefined, '没设就是 undefined')
  // macOS：`ps eww -p <pid> -o command=` 把环境接在命令行后面
  assert.equal(doctor.parsePsEnvLine('node /x/bin/dsh web --host 127.0.0.1 --port 1 --no-open DSH_HOME=/tmp/dsh-lab-home-BBBBBB PATH=/bin'), '/tmp/dsh-lab-home-BBBBBB')
  assert.equal(doctor.parsePsEnvLine('node /x/bin/dsh web --host 127.0.0.1 --port 1 --no-open HOME=/Users/x'), undefined, '没设就是 undefined')
})

test('平台分叉：Windows 上没有这套判据，明说不支持而不是猜', () => {
  assert.equal(doctor.listProcesses('win32'), null)
  assert.deepEqual(doctor.diagnose({ platform: 'win32' }), { unsupported: true, platform: 'win32' })
})

test('平台分叉：POSIX 上真去读进程表（读得到自己那条）', { skip: process.platform === 'win32' ? 'POSIX 专属' : false }, () => {
  const rows = doctor.listProcesses(process.platform)
  assert.ok(Array.isArray(rows) && rows.length > 0, '进程表读出来是空的')
  assert.ok((rows as { pid: number }[]).some((r) => r.pid === process.pid), '进程表里该有自己')
})

test('isLabHome：只认临时目录下、按实验室前缀建出来的家目录', () => {
  const tmp = scratchDirSync('dsh-lab-doctor-judge-')
  const other = scratchDirSync('dsh-lab-doctor-other-')
  try {
    for (const prefix of doctor.LAB_HOME_PREFIXES) {
      assert.equal(doctor.isLabHome(path.join(tmp, `${prefix}XXXXXX`), tmp), true, prefix)
    }
    assert.equal(doctor.isLabHome(path.join(tmp, 'not-a-lab-home'), tmp), false, '前缀不对')
    assert.equal(doctor.isLabHome(path.join(other, 'dsh-lab-home-XXXXXX'), tmp), false, '不在本次扫的临时目录里')
    assert.equal(doctor.isLabHome(path.join(os.homedir(), '.dsh'), tmp), false, '用户真实家目录')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
    fs.rmSync(other, { recursive: true, force: true })
  }
})

test('classify：四条件逐条正反面对照（收错的防线全在这里）', () => {
  const tmp = scratchDirSync('dsh-lab-doctor-judge-')
  const labHome = path.join(tmp, 'dsh-lab-home-AAAAAA')
  const owned = { pid: 1000, port: 3080 }
  /** 默认当「父进程还活着」：进程表里放一条 42。 */
  const alive = new Map<number, unknown>([[42, { pid: 42 }]])
  const at = (over: Partial<ClassifyInput>): ClassifyInput => ({
    pid: 2000,
    ppid: 1,
    args: labArgs(41999),
    dshHome: labHome,
    owned,
    tmpdir: tmp,
    byPid: new Map<number, unknown>(),
    ...over,
  })
  try {
    // ① 命令行不像自起实例 → 陌生人
    assert.equal(doctor.classify(at({ args: 'node /Users/x/bin/dsh --profile plan-test --port 3081 --no-open', dshHome: labHome })).verdict, 'foreign')

    // ② 登记实例：pid 命中就别的一律不看（DSH_HOME 是实验室临时目录、PPID 也是 1，照样不收）
    assert.equal(doctor.classify(at({ pid: owned.pid })).verdict, 'owned')
    // ③ 端口命中登记实例：同样不收（登记可能旧了，宁可少杀不错杀）
    assert.equal(doctor.classify(at({ args: labArgs(owned.port) })).verdict, 'owned')

    // ④ 命令行像、但 DSH_HOME 是用户真实家目录 → 不收
    assert.equal(doctor.classify(at({ dshHome: path.join(os.homedir(), '.dsh') })).verdict, 'foreign')
    // ⑤ DSH_HOME 读不到 → 按陌生人对待，不收
    assert.equal(doctor.classify(at({ dshHome: undefined })).verdict, 'foreign')

    // ⑥ 实验室临时家目录 + 父进程还在 → 有人管，不收
    assert.equal(doctor.classify(at({ ppid: 42, byPid: alive })).verdict, 'lab-live')

    // ⑦ 实验室临时家目录 + PPID 1 → 孤儿，可收
    assert.equal(doctor.classify(at({ ppid: 1, byPid: alive })).verdict, 'lab-orphan')
    // ⑧ 实验室临时家目录 + 父进程不在进程表里 → 同样是孤儿
    assert.equal(doctor.classify(at({ ppid: 999_999, byPid: alive })).verdict, 'lab-orphan')

    // ⑨ 真·用户实例（登记 pid + 真实家目录 + PPID 1）在所有条件都凑齐时仍是 owned
    const real = at({ pid: owned.pid, dshHome: path.join(os.homedir(), '.dsh'), ppid: 1 })
    assert.equal(doctor.classify(real).verdict, 'owned')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------- 段 2：端到端

/** 假 dsh：只挂着不动，给巡检脚本当靶子（命令行形状由调用方给）。 */
const FAKE_DSH = 'setTimeout(() => {}, 600000)\n'

/** 假 dsh（无视 SIGTERM 版）：用来验「SIGTERM 收不掉时要补 SIGKILL」这条路。 */
const FAKE_DSH_IGNORING_TERM = "process.on('SIGTERM', () => {})\nsetTimeout(() => {}, 600000)\n"

/**
 * 起一条假实例，并把它变成孤儿（PPID 1）：经一个中间进程 spawn + `detached`，
 * 中间进程立刻退，假实例就被 init 收养——这正是 #192 要抓的那种现场。
 */
const INTERMEDIATE = `
import { spawn } from 'node:child_process'
const [dsh, ...args] = process.argv.slice(2)
const child = spawn(process.execPath, [dsh, ...args], { env: process.env, detached: true, stdio: 'ignore' })
child.unref()
process.stdout.write(String(child.pid))
`

function ppidOf(pid: number): number | undefined {
  const r = spawnSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' })
  if (r.status !== 0) return undefined
  const n = Number.parseInt(r.stdout.trim(), 10)
  return Number.isNaN(n) ? undefined : n
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function startFakeInstance(sandbox: string, port: number, dshHome: string): Promise<number> {
  const r = spawnSync(process.execPath, [path.join(sandbox, 'intermediate.mjs'), path.join(sandbox, 'bin', 'dsh'), 'web', '--host', '127.0.0.1', '--port', String(port), '--no-open'], {
    encoding: 'utf8',
    env: { ...process.env, DSH_HOME: dshHome },
  })
  assert.equal(r.status, 0, `假实例没起来：${r.stderr}`)
  const pid = Number.parseInt(r.stdout.trim(), 10)
  assert.ok(Number.isInteger(pid) && pid > 0, `假实例没给出 pid：${r.stdout}`)
  for (let i = 0; i < 100; i += 1) {
    if (ppidOf(pid) === 1) return pid
    await sleep(50)
  }
  throw new Error(`假实例 ${String(pid)} 没变成孤儿（父进程一直是 ${String(ppidOf(pid))}）`)
}

function killed(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return false
  } catch {
    return true
  }
}

interface Run {
  status: number
  stdout: string
  stderr: string
}

function runDoctor(home: string, tmpdir: string, extra: string[] = []): Run {
  const r = spawnSync('bash', [SCRIPT, ...extra], {
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, HOME: home, TMPDIR: tmpdir },
  })
  return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

test(
  '端到端：有孤儿时报得出来，--kill 只收孤儿，绝不动登记的那台',
  { skip: process.platform === 'win32' ? '巡检脚本用 ps 读进程表，POSIX 专属' : false },
  async () => {
    const sandbox = scratchDirSync('dsh-lab-doctor-e2e-')
    const tmpdir = path.join(sandbox, 'tmp')
    const home = path.join(sandbox, 'home')
    const userHome = path.join(tmpdir, 'dsh-lab-home-userAAAA')
    const orphanHome = path.join(tmpdir, 'dsh-lab-home-orphBBBB')
    const leftover = path.join(tmpdir, 'dsh-lab-fresh-home-leftover')
    const pids: number[] = []
    try {
      fs.mkdirSync(path.join(sandbox, 'bin'), { recursive: true })
      fs.mkdirSync(path.join(home, '.dsh'), { recursive: true })
      fs.mkdirSync(userHome, { recursive: true })
      fs.mkdirSync(orphanHome, { recursive: true })
      fs.writeFileSync(path.join(sandbox, 'bin', 'dsh'), FAKE_DSH)
      fs.writeFileSync(path.join(sandbox, 'intermediate.mjs'), INTERMEDIATE)

      // 「你自己那台」：命令行与实验室实例一模一样（连家目录都用了实验室前缀），
      // 唯一救它的是登记文件。这样验的才是登记判据本身，而不是「家目录不像」。
      const userPid = await startFakeInstance(sandbox, 3080, userHome)
      pids.push(userPid)
      fs.writeFileSync(path.join(home, '.dsh', 'dsh-owned.json'), JSON.stringify({ pid: userPid, port: 3080 }))

      const orphanPid = await startFakeInstance(sandbox, 41999, orphanHome)
      pids.push(orphanPid)

      // 上一个会话崩在这一步留下的空家目录（老时间戳：不是「刚建出来」免检的那一类）
      fs.mkdirSync(leftover, { recursive: true })
      const old = new Date('2026-01-01T00:00:00Z')
      fs.utimesSync(leftover, old, old)

      // —— 有孤儿状态：默认只报不动 ——
      const dry = runDoctor(home, tmpdir)
      assert.equal(dry.status, 1, `有孤儿时退出码该是 1：\n${dry.stdout}\n${dry.stderr}`)
      assert.match(dry.stdout, new RegExp(`pid ${String(orphanPid)} .*孤儿`), '孤儿实例要报出来')
      assert.match(dry.stdout, new RegExp(`pid ${String(userPid)} .*你自己那台`), '登记的那台要认出来')
      assert.doesNotMatch(dry.stdout, new RegExp(`pid ${String(userPid)}[^\\n]*孤儿`), '登记的那台绝不能被判成孤儿')
      assert.match(dry.stdout, new RegExp(leftover.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), '没人认领的临时目录要报出来')
      assert.equal(killed(orphanPid), false, '只报不动：dry-run 不许杀任何东西')
      assert.equal(killed(userPid), false, '只报不动：dry-run 不许杀任何东西')

      // —— 收 ——
      const reap = runDoctor(home, tmpdir, ['--kill'])
      assert.equal(reap.status, 0, `收完该是干净退出码：\n${reap.stdout}\n${reap.stderr}`)
      assert.ok(killed(orphanPid), '孤儿实例要被收掉')
      assert.equal(killed(userPid), false, '登记的那台必须活着')
      assert.equal(fs.existsSync(orphanHome), false, '孤儿的临时家目录要删掉')
      assert.equal(fs.existsSync(leftover), false, '没人认领的临时目录要删掉')
      assert.equal(fs.existsSync(userHome), true, '登记实例的家目录不许动')

      // —— 没有孤儿状态：干净退出，且不误报登记实例 ——
      const clean = runDoctor(home, tmpdir)
      assert.equal(clean.status, 0, `干净时退出码该是 0：\n${clean.stdout}`)
      assert.match(clean.stdout, /结论：干净/)
      assert.match(clean.stdout, new RegExp(`pid ${String(userPid)} .*你自己那台`), '登记的那台仍要认得出来')
      assert.doesNotMatch(clean.stdout, /· 孤儿（可收）/, '干净状态下不许出现任何「孤儿（可收）」')
      assert.equal(killed(userPid), false, '干净状态下登记实例照样活着')

      // 脚本自己不留新残留：砂箱临时目录里只剩登记实例那个家目录。
      assert.deepEqual(fs.readdirSync(tmpdir), ['dsh-lab-home-userAAAA'])
    } finally {
      for (const pid of pids) {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          // 已经被脚本自己收掉的，正常
        }
      }
      fs.rmSync(sandbox, { recursive: true, force: true })
    }
  },
)

test(
  '端到端：SIGTERM 收不掉（进程无视信号）的孤儿，会补 SIGKILL 收掉',
  { skip: process.platform === 'win32' ? '巡检脚本用 ps 读进程表，POSIX 专属' : false },
  async () => {
    const sandbox = scratchDirSync('dsh-lab-doctor-e2e-')
    const tmpdir = path.join(sandbox, 'tmp')
    const home = path.join(sandbox, 'home')
    const orphanHome = path.join(tmpdir, 'dsh-lab-home-stubborn')
    let pid = 0
    try {
      fs.mkdirSync(path.join(sandbox, 'bin'), { recursive: true })
      fs.mkdirSync(path.join(home, '.dsh'), { recursive: true })
      fs.mkdirSync(tmpdir, { recursive: true })
      fs.mkdirSync(orphanHome, { recursive: true })
      fs.writeFileSync(path.join(sandbox, 'bin', 'dsh'), FAKE_DSH_IGNORING_TERM)
      fs.writeFileSync(path.join(sandbox, 'intermediate.mjs'), INTERMEDIATE)

      pid = await startFakeInstance(sandbox, 41998, orphanHome)

      const report = runDoctor(home, tmpdir, ['--kill'])
      assert.equal(report.status, 0, `该收干净：\n${report.stdout}\n${report.stderr}`)
      assert.match(report.stdout, /SIGKILL 收掉/, 'SIGTERM 没收掉时要走到 SIGKILL 那条')
      assert.ok(killed(pid), '无视 SIGTERM 的孤儿也要被收掉')
      assert.equal(fs.existsSync(orphanHome), false, '它的临时家目录也要删掉')
    } finally {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // 已经被脚本自己收掉的，正常
      }
      fs.rmSync(sandbox, { recursive: true, force: true })
    }
  },
)
