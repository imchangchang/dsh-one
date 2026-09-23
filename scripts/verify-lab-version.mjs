#!/usr/bin/env node
/**
 * 浏览器验证（装配实验室）跑在**指定版本的 dsh** 上——上游发版时接新版本的第一步门禁。
 *
 * ## 为什么需要它（#191）
 *
 * 实验室连的 `dsh` 是 `PATH` 上那一个（`test/assembly-lab/labGateway.ts` 直接 spawn `dsh`），
 * 所以它验的一直是**本机已装**的那一版。于是「上游发新版 → 装配页整棵起不来」这种事在
 * 本机永远看不见：0.1.6-alpha.2 就是靠着这一条整页白（`renderSlot('root') before any
 * 'root' registration`），而探针那一套查的是「名字还在不在」——它读字节，不跑页面，
 * 查不出「装起来崩不崩」。本脚本把「装一份候选版本到临时目录 + 用它跑实验室」合成一条
 * 命令，让「接新版本」这一步有一步必跑的、能判死的动作。
 *
 * ## 候选版本怎么装（#231）
 *
 * **按确切版本钉住整棵同族依赖树，装完再核一遍。** 为什么非钉不可：`@deepseek-ai/dsh`
 * 自己的依赖写的是 `^0.1.6-alpha.1` 这种范围，同一个范围里 alpha.2 也满足——不钉的话
 * `npm install` 会把**子包**装成 alpha.2、`dsh` 自己还是 alpha.1，得到一棵版本混杂的树：
 * 它跑不起来（实测 `SyntaxError: … '@deepseek-ai/dsh-app-boot' does not provide an export
 * named 'watchUserPatches'`），而门禁照跑照出读数——那读数既不代表候选版也不代表现网。
 *
 * 同一件事还有**第二半**（0.1.2-rc.1 上实测撞到）：上游不只 `dsh*` 这一族按批次发版，
 * `@deepseek-ai/cordis-plugin-hmr` 这种包也在同一批里、范围写成 `^1.0.17`，npm 就顺到比候选
 * 版本晚 19 天发布的那一版——那种树上 `dsh web` 一启动就报
 * `Error: dsh: user patch-layer watching requires the Cordis HMR service` 并退出，
 * 整轮与 F-01 都跑不起来。所以钉的范围是**上游自己那一批（`@deepseek-ai/*` 全部）**。
 *
 * 三步（判据与纯函数在 `scripts/labCandidateTree.ts`，单测 `test/labCandidateTree.test.ts`）：
 *
 * 1. 写一份只声明 `@deepseek-ai/dsh@<要验的那一版>` 的清单，`npm install
 *    --package-lock-only` 解析一次（**只取元数据、不下载**），从锁文件里拿到整棵树的
 *    上游包名与解析出来的确切版本；
 * 2. 按包名算**期望版本**，写进 `overrides` 真装——范围里的其它版本不再有机会被选中：
 *    同族包钉候选那一版；同期上游包（`@deepseek-ai/cordis*` 这些）钉**候选发布窗口内**
 *    最新的一版（候选发布时刻 + 一小时；这一批各包发布时刻实测散在 ±13 分钟内）；
 * 3. 装完读一遍树里的版本清单逐条对账：同族包必须同版本、同期上游包必须是期望那一版、
 *    树里还要没有没钉到的上游包；任何一条不成立就报错停下、不跑套件。
 *
 * 任何一步失败都把完整的报错带出来（npm 自己的 stdout / stderr 原样打出，不留短尾巴）。
 *
 * 范围之外（`commander` 这类第三方）不动——它们版本线独立、也没出过这类事故；要连它们
 * 一起冻就得按日期过滤整棵树，那是另一件事，真需要了再另立条目。
 *
 * ## 它证明什么、不证明什么
 *
 * 证明：**这一版 dsh 上四棵装配树装得起来**（F-01 CONTRACT：零槽位崩溃、零装载未激活、
 * 预期槽位有内容、frame 插件真的执行）。不证明：宿主层（CSP / 剪贴板 / 原生菜单）——
 * 那是 VS Code 验证的事；也不证明探针那一面。
 *
 * ## 用法
 *
 *   node scripts/verify-lab-version.mjs 0.1.6-alpha.2
 *   node scripts/verify-lab-version.mjs 0.1.6-alpha.2 --suite F-01,F-10,F-11
 *   node scripts/verify-lab-version.mjs 0.1.2-rc.1 --suite all      # 整轮（全部套件）
 *   node scripts/verify-lab-version.mjs next                        # 按 npm 标签
 *   node scripts/verify-lab-version.mjs --from <目录>               # 复用一份已有的安装
 *
 * 候选版本装在临时目录里（跑完删掉，**不动本机的 dsh 安装**）；实验室照默认跑法起
 * 自己的隔离实例（独立 `DSH_HOME` + 随机端口 + 跑完按 PID 收），用户的 `~/.dsh` 与
 * 日常那台实例都不碰。
 *
 * `--from <目录>` 跳过安装、直接核这一棵树的版本（负向对照用：喂一棵混装的树进去，
 * 它必须报错停下）。给了它时 `<version>` 可省。
 *
 * 退出码 = 实验室的退出码（0 全过 / 1 有断言失败 / 2 起不来或版本校验不过）。
 */
import { execFileSync, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ROOT_PACKAGE,
  checkVendorVersions,
  exactPinnedVersions,
  exactPinnedVersionsFromPackages,
  isFamilyName,
  isVendorName,
  mismatchDetailLines,
  pickAsOfVersion,
  pinnedOverrides,
  readInstalledPackages,
  resolvedVersionFromLock,
  vendorDeclaredSpecsFromLock,
  vendorNamesFromLock,
  versionReportLines,
} from './labCandidateTree.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..')
const NPM_PKG = ROOT_PACKAGE

function usage() {
  process.stderr.write(
    [
      '用法: node scripts/verify-lab-version.mjs <version|tag> [--suite F-01,F-10|all]',
      '',
      '  <version>        要验的 dsh 版本（如 0.1.6-alpha.2）或 npm 标签（如 next）；',
      '                   给了 --from 时可省',
      '  --suite <ids>    只跑指定套件（缺省 F-01：底座契约完备性——「装不装得起来」那一面）；',
      '                   `all` = 整轮（全部套件，读数与 `npm run verify:lab` 同一份）',
      '  --from <dir>     复用一份已有的安装（跳过安装，仍核版本一致性；负向对照用）',
      '  --check-only     只核版本一致性、不跑套件（拿它快速确认「装出来的树是干净的那一版」）',
      '  --keep           跑完留下候选版本那份安装（排查用；路径会打印出来）',
      '',
    ].join('\n'),
  )
}

const argv = process.argv.slice(2)
if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
  usage()
  process.exit(argv.length === 0 ? 2 : 0)
}

const options = { keep: false }
const positional = []
for (let index = 0; index < argv.length; index += 1) {
  const arg = argv[index]
  if (arg === '--keep') {
    options.keep = true
    continue
  }
  if (arg === '--check-only') {
    options.checkOnly = true
    continue
  }
  if (arg === '--suite' || arg === '--from') {
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) {
      process.stderr.write(`${arg} 后面要给一个值。\n`)
      usage()
      process.exit(2)
    }
    options[arg === '--suite' ? 'suites' : 'from'] = value
    index += 1
    continue
  }
  if (arg.startsWith('-')) {
    process.stderr.write(`不认识的参数：${arg}\n`)
    usage()
    process.exit(2)
  }
  positional.push(arg)
}
const version = positional[0]
const suites = options.suites ?? 'F-01'
if (version === undefined && options.from === undefined) {
  process.stderr.write('要说清验哪一版（位置参数），或用 --from 指一份已有的安装。\n')
  usage()
  process.exit(2)
}

const tmp = options.from === undefined ? fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-version-')) : undefined
const installDir = tmp ?? String(options.from)
const cleanup = () => {
  if (tmp === undefined) return
  if (options.keep) {
    process.stderr.write(`[lab-version] 候选版本留在 ${tmp}\n`)
    return
  }
  fs.rmSync(tmp, { recursive: true, force: true })
}

/** 跑一次 npm；输出收进内存，失败时整段带出来（#231 要的就是「失败时看得见真报错」）。 */
function runNpm(args, dir) {
  return execFileSync('npm', args, { cwd: dir, encoding: 'utf8', timeout: 900_000, maxBuffer: 64 * 1024 * 1024 })
}

/** 失败时的完整说明：异常本身 + npm 自己的 stdout / stderr（不再截成一条短尾巴）。 */
function failureDetail(err) {
  const parts = [err instanceof Error ? err.message : String(err)]
  const stderr = typeof err?.stderr === 'string' ? err.stderr.trim() : ''
  if (stderr !== '') parts.push(`npm stderr：\n${stderr}`)
  const stdout = typeof err?.stdout === 'string' ? err.stdout.trim() : ''
  if (stdout !== '') parts.push(`npm stdout：\n${stdout}`)
  return parts.join('\n')
}

function writeManifest(dir, body) {
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    `${JSON.stringify({ name: 'dsh-lab-version-candidate', private: true, ...body }, null, 2)}\n`,
    'utf8',
  )
}

/**
 * 候选发布窗口的上界：候选版本自己的发布时刻 + 一小时。
 *
 * 一小时是照着上游**批次的形状**定的：同一批里各包的发布时间不是同一个瞬时，实测候选
 * 本体发布前后 ±13 分钟内都还在发（0.1.6-alpha.2 最晚的一条比本体晚 114 秒），给一小时
 * 足够容纳整批，又不会宽到把下一批（隔着两天以上）圈进来。
 */
const RELEASE_WINDOW_MS = 60 * 60 * 1000

/** 查一个包的发布时刻表（包名 → 版本 → ISO 时刻）。 */
function packageTimes(name) {
  return JSON.parse(runNpm(['view', name, 'time', '--json'], os.tmpdir()))
}

/** 候选本体的发布窗口上界（见 {@link RELEASE_WINDOW_MS}）。 */
function candidateReleaseCutoff(resolved, timesCache) {
  const times = timesCache.get(NPM_PKG) ?? packageTimes(NPM_PKG)
  timesCache.set(NPM_PKG, times)
  const published = times[resolved]
  if (typeof published !== 'string') {
    throw new Error(`查不到 ${NPM_PKG}@${resolved} 的发布时刻，没法算候选发布窗口。`)
  }
  return new Date(Date.parse(published) + RELEASE_WINDOW_MS).toISOString()
}

/**
 * 期望版本表这一层的构造：同族包钉候选那一版（彼此同版本），同期上游包钉候选发布窗口内
 * 最新的一版——**除非上游自己把那个包钉成了确切版本**（`exactPins[包名]`，见
 * `labCandidateTree.ts` 的 `exactPinnedVersions`：0.1.5-rc.3 的 `dsh` / `dsh-base` 就把
 * `@deepseek-ai/cordis-plugin-hmr` 写成 `1.0.17`，窗口启发式会把它顶成 1.0.18、那一版
 * `dsh web` 起不来）。发布时刻表按包名缓存，同一次运行里不重复查。
 *
 * 返回 `undefined` 表示**这个包在候选的发布窗口里还没有任何版本**——那是比候选更新的批次
 * 才引入的包（实测：`@deepseek-ai/libreoffice-kit` 的首个版本比 0.1.6-alpha.1 晚 2.7 小时
 * 发布，只出现在「按最新解析」的那棵树上），候选那一版根本依赖不到它，所以**不钉**：
 * 它要是真被装进了树（说明有谁依赖它），校验那一关会把它当「没钉到的上游包」拦下来。
 */
function makeTargetsBuilder(resolved, exactPins = {}) {
  const timesCache = new Map()
  let cutoff
  return (name) => {
    if (isFamilyName(name)) return resolved
    if (exactPins[name] !== undefined) return exactPins[name]
    if (cutoff === undefined) cutoff = candidateReleaseCutoff(resolved, timesCache)
    const times = timesCache.get(name) ?? packageTimes(name)
    timesCache.set(name, times)
    return pickAsOfVersion(times, cutoff)
  }
}

/**
 * `--from` 那一路：拿一份已有的树算期望版本表（树里没有候选本体时给不出期望，返回空表）。
 * 窗口里没有版本的包名照 {@link makeTargetsBuilder} 的口径跳过——树里真有它的话，
 * 校验会把它当「没钉到的上游包」拦下来。上游自己钉死确切版本的那些包从树里的清单读
 * （`exactPinnedVersionsFromPackages`），口径与装那一路同源。
 */
async function targetsForExistingTree(packages, resolved) {
  const targets = {}
  if (resolved === undefined) return targets
  const expectedFor = makeTargetsBuilder(resolved, exactPinnedVersionsFromPackages(packages))
  for (const name of [...new Set(packages.map((each) => each.name))].sort()) {
    const expected = expectedFor(name)
    if (expected !== undefined) targets[name] = expected
  }
  return targets
}

/**
 * 装一份候选并返回装出来的确切版本与期望版本表。
 *
 * 三件事（理由见文件头「候选版本怎么装」）：
 * ① 元数据解析一次，拿到整棵树的上游包名（只取元数据，不下载）；
 * ② 按包名算期望版本——同族包是候选那一版，同期上游包是候选发布窗口内最新的一版；
 * ③ 真装，装完再扫一遍树：要是出现了期望表里没有的上游包，就把它也算进来重装，
 *    直到稳定（最多 4 轮；真不稳定就是有问题，直接抛出来）。
 */
async function installPinnedCandidate(dir, spec) {
  writeManifest(dir, { dependencies: { [NPM_PKG]: spec } })
  process.stderr.write(`[lab-version] 解析 ${NPM_PKG}@${spec} 的依赖树（只取元数据，不下载）…\n`)
  runNpm(['install', '--package-lock-only', '--no-audit', '--no-fund', '--loglevel=error'], dir)
  const lock = readLock(dir)
  const resolved = resolvedVersionFromLock(lock)
  if (resolved === undefined) {
    throw new Error(`解析出来的依赖树里没有 ${ROOT_PACKAGE}，装不下去（锁文件：${path.join(dir, 'package-lock.json')}）。`)
  }
  const exactPins = exactPinnedVersions(vendorDeclaredSpecsFromLock(lock))
  const expectedFor = makeTargetsBuilder(resolved, exactPins)
  const targets = {}
  const outOfWindow = new Set()
  const addTargets = (names) => {
    for (const name of names) {
      const expected = expectedFor(name)
      if (expected === undefined) outOfWindow.add(name)
      else targets[name] = expected
    }
  }
  addTargets(vendorNamesFromLock(lock))
  const siblingCount = Object.keys(targets).filter((name) => !isFamilyName(name)).length
  const pinnedNames = Object.keys(exactPins).filter((name) => isVendorName(name) && !isFamilyName(name))
  process.stderr.write(
    `[lab-version] 候选版本 = ${resolved}；钉住 ${String(Object.keys(targets).length)} 个上游包（其中同期上游包 ${String(siblingCount)} 个按候选发布窗口取版本）后真装…\n`,
  )
  if (pinnedNames.length > 0) {
    process.stderr.write(
      `[lab-version] 其中 ${String(pinnedNames.length)} 个上游**自己钉死了确切版本**（照它钉的那一版，窗口启发式不许顶掉）：` +
        `${pinnedNames.map((name) => `${name}@${exactPins[name]}`).join('、')}\n`,
    )
  }
  for (let pass = 1; pass <= 4; pass += 1) {
    writeManifest(dir, { dependencies: { [NPM_PKG]: resolved }, overrides: pinnedOverrides(targets) })
    // 锁文件是**没钉住**的那一份解析结果，留着 npm 就照它装——删掉，让它按钉住后的清单重解。
    fs.rmSync(path.join(dir, 'package-lock.json'), { force: true })
    runNpm(['install', '--no-audit', '--no-fund', '--loglevel=error'], dir)
    const installed = await readInstalledPackages(dir)
    const fresh = [...new Set(installed.map((each) => each.name))].filter(
      (name) => targets[name] === undefined && !outOfWindow.has(name),
    )
    if (fresh.length === 0) return { resolved, targets, outOfWindow: [...outOfWindow] }
    process.stderr.write(
      `[lab-version] 这一轮又出现 ${String(fresh.length)} 个上游包，一并钉住后重装：${fresh.join('、')}\n`,
    )
    addTargets(fresh)
  }
  throw new Error('上游包清单连着四轮都在变（每一轮装完都多出没钉到的包），这棵树的形状不对劲，停下来。')
}

function readLock(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8'))
}

/**
 * 候选那份 `dsh --version` 的原话（报告里的证据之一）。
 *
 * 用 `node <包自己声明的 bin> --version` 跑，不走 `node_modules/.bin` 的 shim：shim 在
 * Windows 上是 `.cmd` 批处理、形状与 POSIX 不一样，这里不想为它多一条路径。用 spawnSync
 * 而不是 execFileSync：后者的 stderr 缺省是**继承**的，一棵跑不起来的树上这条探针会把
 * 一大段崩溃栈直接倒到我们的输出里（实测混装树就是这个样子），而它只是一条旁证。
 *
 * 跑不起来（清单里没声明 bin、文件不在、启动就报错）返回 undefined——版本校验的**判据**
 * 是包清单，这一条只是给人看的旁证，别让它把校验挡在前面。
 */
function candidateVersionOutput(dir) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'node_modules', NPM_PKG, 'package.json'), 'utf8'))
    const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.dsh
    if (typeof bin !== 'string') return undefined
    const result = spawnSync(process.execPath, [path.join(dir, 'node_modules', NPM_PKG, bin), '--version'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 120_000,
    })
    if (result.error !== undefined || result.status !== 0) return undefined
    return String(result.stdout ?? '').trim().split('\n')[0]
  } catch {
    return undefined
  }
}

try {
  let packages = await readInstalledPackages(installDir)
  let targets = {}
  if (options.from === undefined) {
    const installed = await installPinnedCandidate(tmp, version)
    targets = installed.targets
    packages = await readInstalledPackages(installDir)
    for (const name of installed.outOfWindow) {
      process.stderr.write(`[lab-version] ${name} 在候选的发布窗口里还没有版本，不钉（候选那一版依赖不到它）。\n`)
    }
  } else {
    const installedCandidate = packages.find((each) => each.name === NPM_PKG)?.version
    targets = await targetsForExistingTree(packages, installedCandidate)
  }
  const verdict = checkVendorVersions(packages, targets)
  for (const line of versionReportLines(verdict, { targets })) process.stderr.write(`${line}\n`)
  if (version !== undefined && /^\d/.test(version) && verdict.candidate !== version) {
    process.stderr.write(`[lab-version] 装出来的 dsh 是 ${verdict.candidate ?? '（不在树里）'}，不是你要的 ${version}。\n`)
    cleanup()
    process.exit(2)
  }
  if (verdict.ok !== true) {
    for (const line of mismatchDetailLines(verdict, { installDir, targets })) process.stderr.write(`${line}\n`)
    process.stderr.write('[lab-version] 停下，不跑套件（宁可红，不要假绿：这棵树上的读数不作数）。\n')
    cleanup()
    process.exit(2)
  }
  const reported = candidateVersionOutput(installDir)
  if (reported !== undefined) process.stderr.write(`[lab-version] dsh --version = ${reported}\n`)
  if (options.checkOnly === true) {
    process.stderr.write('[lab-version] 版本一致性核过（--check-only：不跑套件）。\n')
    cleanup()
    process.exit(0)
  }
  const suiteArgs = suites === 'all' ? [] : ['--suite', suites]
  process.stderr.write(`[lab-version] dsh ${verdict.candidate ?? '?'}：跑 verify:lab ${suites === 'all' ? '（整轮）' : `--suite ${suites}`}\n`)
  const bin = path.join(installDir, 'node_modules', '.bin')
  const result = spawnSync('npm', ['run', 'verify:lab', '--', ...suiteArgs], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` },
  })
  if (result.error) throw result.error
  process.stderr.write(`[lab-version] dsh ${verdict.candidate ?? '?'}：verify:lab 退出码 ${String(result.status ?? 'signal')}\n`)
  cleanup()
  process.exit(result.status ?? 2)
} catch (err) {
  process.stderr.write(`[lab-version] 失败：${failureDetail(err)}\n`)
  cleanup()
  process.exit(2)
}
