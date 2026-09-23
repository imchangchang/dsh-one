/**
 * 「候选版本树」那两条判据（#231）：
 *
 * - 纯函数单测：`scripts/labCandidateTree.ts` 的读数、钉版本、内部一致性判定；
 * - 端到端负向对照：把一棵**人为混装**的树喂给 `scripts/verify-lab-version.mjs --from`，
 *   它必须**报错停下**（退出码 2、打印是哪几个包版本不对），而不是照跑套件给个假绿；
 *   另配一棵版本一致的树当正面照（`--check-only`，不跑套件）。
 *
 * 为什么不在这里真装一遍候选：那是网络 + 上百个包的活，跑在 `npm test` 里太贵也太脆；
 * 「钉住之后真装出来是不是一致的」由这条门禁自己每次跑的时候核（装完那一遍版本清单
 * 就是它的读数），实测记录见 #231。`--from` 那一路只查发布时刻表、且只在树里真有同期
 * 上游包时才查，所以下面这些假树（只有 `dsh*`）一个网络请求都不发。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { spawnSync } from 'node:child_process'
import { scratchDirSync } from './scratchDirs.ts'
import {
  ROOT_PACKAGE,
  checkVendorVersions,
  mismatchDetailLines,
  pickAsOfVersion,
  pinnedOverrides,
  readInstalledPackages,
  resolvedVersionFromLock,
  vendorNamesFromLock,
  versionReportLines,
} from '../scripts/labCandidateTree.ts'

const ROOT = path.join(import.meta.dirname, '..')
const CLI = path.join(ROOT, 'scripts', 'verify-lab-version.mjs')

/** 在一棵「装出来的树」里放一个包。 */
function writePackage(tree: string, name: string, version: string, extra: Record<string, unknown> = {}): void {
  const dir = path.join(tree, 'node_modules', ...name.split('/'))
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version, ...extra }), 'utf8')
}

function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8' })
  return { status: result.status, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? '') }
}

test('锁文件：取上游包名（`@deepseek-ai/*` 全部，含嵌套键），取解析出来的确切版本', () => {
  const lock = {
    packages: {
      '': { name: 'lab' },
      'node_modules/@deepseek-ai/dsh': { version: '0.1.6-alpha.1' },
      'node_modules/@deepseek-ai/dsh-app-boot': { version: '0.1.6-alpha.1' },
      'node_modules/@deepseek-ai/cordis': { version: '4.0.2' },
      'node_modules/other/node_modules/@deepseek-ai/dsh-hmr': { version: '0.1.6-alpha.1' },
      'node_modules/commander': { version: '15.0.0' },
    },
  }
  // 同期上游包（cordis 这种非 dsh* 的）也要在名单里：#231 现场的第二半就是它。
  assert.deepEqual(vendorNamesFromLock(lock), [
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh',
    '@deepseek-ai/dsh-app-boot',
    '@deepseek-ai/dsh-hmr',
  ])
  assert.equal(resolvedVersionFromLock(lock), '0.1.6-alpha.1')
  assert.equal(resolvedVersionFromLock({ packages: {} }), undefined)
})

test('发布窗口取版本：挑窗口内最新发布的那一版（按发布时刻，不按版本号大小）', () => {
  const times = {
    created: '2026-08-01T00:00:00.000Z',
    modified: '2026-09-22T00:00:00.000Z',
    '1.0.2': '2026-08-01T00:00:00.000Z',
    '1.0.17': '2026-08-30T13:14:24.871Z',
    '1.0.18': '2026-09-22T03:46:37.411Z',
    '1.0.19': '2026-09-22T15:39:05.442Z',
  }
  // 0.1.2-rc.1 的发布窗口（2026-09-03 + 1 小时）：1.0.17 才对，不能顺到 1.0.18/1.0.19。
  assert.equal(pickAsOfVersion(times, '2026-09-03T07:21:53.000Z'), '1.0.17')
  // 窗口边界是闭的（正好发布在窗口上界那一刻也算）。
  assert.equal(pickAsOfVersion(times, '2026-08-30T13:14:24.871Z'), '1.0.17')
  // 比最早的还早 ⇒ 挑不出来（调用方按「装不下去」处理）。
  assert.equal(pickAsOfVersion(times, '2026-07-01T00:00:00.000Z'), undefined)
  assert.equal(pickAsOfVersion(times, '不是时刻'), undefined)
})

test('钉版本：期望表逐条变成 overrides，`@deepseek-ai/dsh` 自己不进 overrides', () => {
  const overrides = pinnedOverrides({
    '@deepseek-ai/dsh': '0.1.2-rc.1',
    '@deepseek-ai/dsh-app-boot': '0.1.2-rc.1',
    '@deepseek-ai/cordis-plugin-hmr': '1.0.17',
  })
  assert.deepEqual(overrides, {
    '@deepseek-ai/dsh-app-boot': '0.1.2-rc.1',
    '@deepseek-ai/cordis-plugin-hmr': '1.0.17',
  })
  assert.equal(Object.hasOwn(overrides, ROOT_PACKAGE), false, '根包由 dependencies 钉，overrides 里再钉一次 npm 会报冲突')
})

test('内部一致性：一致 / 同族混装 / 同期上游包被顺到新版 / 有没钉到的包，四种结论', () => {
  const targets = {
    '@deepseek-ai/dsh': '0.1.2-rc.1',
    '@deepseek-ai/dsh-app-boot': '0.1.2-rc.1',
    '@deepseek-ai/cordis-plugin-hmr': '1.0.17',
  }
  const clean = [
    { name: ROOT_PACKAGE, version: '0.1.2-rc.1', where: 'node_modules/@deepseek-ai/dsh' },
    { name: '@deepseek-ai/dsh-app-boot', version: '0.1.2-rc.1', where: 'node_modules/@deepseek-ai/dsh-app-boot' },
    { name: '@deepseek-ai/cordis-plugin-hmr', version: '1.0.17', where: 'node_modules/@deepseek-ai/cordis-plugin-hmr' },
  ]
  const cleanVerdict = checkVendorVersions(clean, targets)
  assert.equal(cleanVerdict.ok, true)
  assert.equal(cleanVerdict.candidate, '0.1.2-rc.1')
  assert.deepEqual(cleanVerdict.mismatches, [])
  assert.deepEqual(cleanVerdict.distinctFamilyVersions, ['0.1.2-rc.1'])
  assert.ok(cleanVerdict.missingKey.includes('@deepseek-ai/dsh-base'), '关键子包里没出现的那几个要如实点名')

  // ① 同族混装（alpha.1 + 子包 alpha.2）
  const mixedFamily = [...clean, { name: '@deepseek-ai/dsh-app-boot', version: '0.1.6-alpha.2', where: 'node_modules/x/node_modules/@deepseek-ai/dsh-app-boot' }]
  const mixedVerdict = checkVendorVersions(mixedFamily, targets)
  assert.equal(mixedVerdict.ok, false)
  assert.deepEqual(mixedVerdict.distinctFamilyVersions, ['0.1.2-rc.1', '0.1.6-alpha.2'])
  assert.equal(mixedVerdict.mismatches.length, 1)
  assert.match(mismatchDetailLines(mixedVerdict, { targets }).join('\n'), /版本混装/)

  // ② 同期上游包被 npm 顺到窗口外的新版（0.1.2-rc.1 上真踩到的那种）
  const drifted = clean.map((each) =>
    each.name === '@deepseek-ai/cordis-plugin-hmr' ? { ...each, version: '1.0.19' } : each,
  )
  const driftedVerdict = checkVendorVersions(drifted, targets)
  assert.equal(driftedVerdict.ok, false)
  assert.deepEqual(
    driftedVerdict.mismatches.map((each) => `${each.name}@${each.version}`),
    ['@deepseek-ai/cordis-plugin-hmr@1.0.19'],
  )
  assert.match(mismatchDetailLines(driftedVerdict, { targets }).join('\n'), /期望 1\.0\.17/)

  // ③ 树里有没钉到的上游包（没期望可比 ⇒ 读数同样不作数）
  const stranger = [...clean, { name: '@deepseek-ai/dsh-newcomer', version: '9.9.9', where: 'node_modules/@deepseek-ai/dsh-newcomer' }]
  const strangerVerdict = checkVendorVersions(stranger, targets)
  assert.equal(strangerVerdict.ok, false)
  assert.deepEqual(
    strangerVerdict.unknown.map((each) => each.name),
    ['@deepseek-ai/dsh-newcomer'],
  )
  assert.match(mismatchDetailLines(strangerVerdict, { targets }).join('\n'), /没钉到版本的上游包/)

  // ④ 树里连 @deepseek-ai/dsh 都没有时不能判成一致
  const empty = checkVendorVersions([{ name: 'commander', version: '15.0.0', where: 'node_modules/commander' }], {})
  assert.equal(empty.ok, false)
  assert.equal(empty.candidate, undefined)
})

test('读树：嵌套那一份也单独列出来，并按包名排序', async () => {
  const tree = scratchDirSync('dsh-lab-version-')
  writePackage(tree, '@deepseek-ai/dsh', '0.1.6-alpha.1')
  writePackage(tree, '@deepseek-ai/dsh-app-boot', '0.1.6-alpha.1')
  writePackage(tree, '@deepseek-ai/cordis', '4.0.2')
  writePackage(tree, 'commander', '15.0.0')
  fs.mkdirSync(path.join(tree, 'node_modules', 'other', 'node_modules', '@deepseek-ai'), { recursive: true })
  writePackage(path.join(tree, 'node_modules', 'other'), '@deepseek-ai/dsh-app-boot', '0.1.6-alpha.2')

  const packages = await readInstalledPackages(tree)
  assert.deepEqual(
    packages.map((each) => `${each.name}@${each.version}`),
    [
      '@deepseek-ai/cordis@4.0.2',
      '@deepseek-ai/dsh@0.1.6-alpha.1',
      '@deepseek-ai/dsh-app-boot@0.1.6-alpha.1',
      '@deepseek-ai/dsh-app-boot@0.1.6-alpha.2',
    ],
  )
  const verdict = checkVendorVersions(packages, { '@deepseek-ai/dsh': '0.1.6-alpha.1', '@deepseek-ai/dsh-app-boot': '0.1.6-alpha.1' })
  assert.equal(verdict.ok, false, '嵌套的那一份版本不同、cordis 又没有期望 ⇒ 两样都不算数')
  assert.equal(verdict.mismatches.length, 1)
  assert.equal(verdict.unknown.length, 1)
  assert.match(versionReportLines(verdict, { targets: { '@deepseek-ai/dsh': '0.1.6-alpha.1', '@deepseek-ai/cordis': '4.0.2' } })[2] ?? '', /同期上游包按候选发布窗口钉住（1 个）：@deepseek-ai\/cordis@4\.0\.2/)
})

test('负向对照：混装的树喂进去必须报错停下、报出是哪几个包，且一条套件都不跑', () => {
  const tree = scratchDirSync('dsh-lab-version-')
  writePackage(tree, '@deepseek-ai/dsh', '0.1.6-alpha.1')
  writePackage(tree, '@deepseek-ai/dsh-app-boot', '0.1.6-alpha.2')

  const run = runCli(['0.1.6-alpha.1', '--from', tree])
  assert.equal(run.status, 2, `混装树必须判死，实际退出码 ${String(run.status)}\n${run.stderr}`)
  assert.match(run.stderr, /版本混装/)
  assert.match(run.stderr, /@deepseek-ai\/dsh-app-boot@0\.1\.6-alpha\.2/)
  assert.match(run.stderr, /停下，不跑套件/)
  assert.doesNotMatch(run.stderr, /verify:lab/, '版本不一致时套件一条都不该跑（跑了就是假读数）')
})

test('正面照：版本一致的树核得过（--check-only 不跑套件）', () => {
  const tree = scratchDirSync('dsh-lab-version-')
  writePackage(tree, '@deepseek-ai/dsh', '0.1.6-alpha.2')
  writePackage(tree, '@deepseek-ai/dsh-app-boot', '0.1.6-alpha.2')
  writePackage(tree, '@deepseek-ai/dsh-client-ui-layout', '0.1.6-alpha.2')

  const run = runCli(['0.1.6-alpha.2', '--from', tree, '--check-only'])
  assert.equal(run.status, 0, `一致的树不该判死，实际退出码 ${String(run.status)}\n${run.stderr}`)
  assert.match(run.stderr, /版本集合 = \{0\.1\.6-alpha\.2\}/)
  assert.match(run.stderr, /版本一致性核过/)
  assert.doesNotMatch(run.stderr, /verify:lab/)
})

test('树里不是你要的那一版：也报错停下', () => {
  const tree = scratchDirSync('dsh-lab-version-')
  writePackage(tree, '@deepseek-ai/dsh', '0.1.6-alpha.2')
  writePackage(tree, '@deepseek-ai/dsh-app-boot', '0.1.6-alpha.2')

  const run = runCli(['0.1.6-alpha.1', '--from', tree, '--check-only'])
  assert.equal(run.status, 2)
  assert.match(run.stderr, /不是你要的 0\.1\.6-alpha\.1/)
})

test('读不到的包目录（没清单 / 清单不是 JSON）跳过，其余照读；跳掉的恰好是 dsh 自己则判不一致', async () => {
  const tree = scratchDirSync('dsh-lab-version-')
  writePackage(tree, '@deepseek-ai/dsh', '0.1.6-alpha.1')
  writePackage(tree, '@deepseek-ai/dsh-app-boot', '0.1.6-alpha.1')
  fs.mkdirSync(path.join(tree, 'node_modules', '@deepseek-ai', 'dsh-no-manifest'), { recursive: true })
  const broken = path.join(tree, 'node_modules', '@deepseek-ai', 'dsh-broken')
  fs.mkdirSync(broken, { recursive: true })
  fs.writeFileSync(path.join(broken, 'package.json'), '{"name": "@deepseek-ai/dsh-broken", ', 'utf8')

  const packages = await readInstalledPackages(tree)
  assert.deepEqual(
    packages.map((each) => `${each.name}@${each.version}`),
    ['@deepseek-ai/dsh@0.1.6-alpha.1', '@deepseek-ai/dsh-app-boot@0.1.6-alpha.1'],
  )
  // fail-closed：读不到的那一份恰好是 dsh 自己时，候选版本成了 undefined ⇒ 当场判不一致。
  const withoutRoot = checkVendorVersions([{ name: '@deepseek-ai/dsh-app-boot', version: '0.1.6-alpha.1', where: 'x' }], {})
  assert.equal(withoutRoot.ok, false)
  assert.equal(withoutRoot.candidate, undefined)
})

test('候选的 `dsh --version` 读得到时打进读数（读不到只跳过那一行旁证）', () => {
  const tree = scratchDirSync('dsh-lab-version-')
  writePackage(tree, '@deepseek-ai/dsh', '9.9.9', { bin: { dsh: 'lib/bin.js' } })
  writePackage(tree, '@deepseek-ai/dsh-app-boot', '9.9.9')
  const binDir = path.join(tree, 'node_modules', '@deepseek-ai', 'dsh', 'lib')
  fs.mkdirSync(binDir, { recursive: true })
  fs.writeFileSync(path.join(binDir, 'bin.js'), 'console.log("9.9.9")\n', 'utf8')

  const run = runCli(['9.9.9', '--from', tree, '--check-only'])
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stderr, /dsh --version = 9\.9\.9/)

  // 另一支：没有 bin 那份清单时函数返回 undefined，读数里少这一行、其余照旧（上面几个用例就是这一支）。
  const bare = scratchDirSync('dsh-lab-version-')
  writePackage(bare, '@deepseek-ai/dsh', '9.9.9')
  const bareRun = runCli(['9.9.9', '--from', bare, '--check-only'])
  assert.equal(bareRun.status, 0, bareRun.stderr)
  assert.doesNotMatch(bareRun.stderr, /dsh --version/)
})
