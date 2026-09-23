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
 * 就是它的读数），实测记录见 #231。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { spawnSync } from 'node:child_process'
import { scratchDirSync } from './scratchDirs.ts'
import {
  ROOT_PACKAGE,
  checkFamilyVersions,
  familyNamesFromLock,
  mismatchDetailLines,
  pinnedOverrides,
  readInstalledPackages,
  resolvedVersionFromLock,
  versionReportLines,
} from '../scripts/labCandidateTree.ts'

const ROOT = path.join(import.meta.dirname, '..')
const CLI = path.join(ROOT, 'scripts', 'verify-lab-version.mjs')

/** 在一棵「装出来的树」里放一个包。 */
function writePackage(tree: string, name: string, version: string): void {
  const dir = path.join(tree, 'node_modules', ...name.split('/'))
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version }), 'utf8')
}

function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8' })
  return { status: result.status, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? '') }
}

test('锁文件：取同族包名（含嵌套键、剔掉非同族），取解析出来的确切版本', () => {
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
  assert.deepEqual(familyNamesFromLock(lock), [
    '@deepseek-ai/dsh',
    '@deepseek-ai/dsh-app-boot',
    '@deepseek-ai/dsh-hmr',
  ])
  assert.equal(resolvedVersionFromLock(lock), '0.1.6-alpha.1')
  assert.equal(resolvedVersionFromLock({ packages: {} }), undefined)
})

test('钉版本：同族子包一律钉到确切版本，`@deepseek-ai/dsh` 自己不进 overrides', () => {
  const overrides = pinnedOverrides(['@deepseek-ai/dsh', '@deepseek-ai/dsh-app-boot', '@deepseek-ai/dsh-client-ui-layout'], '0.1.6-alpha.1')
  assert.deepEqual(overrides, {
    '@deepseek-ai/dsh-app-boot': '0.1.6-alpha.1',
    '@deepseek-ai/dsh-client-ui-layout': '0.1.6-alpha.1',
  })
  assert.equal(Object.hasOwn(overrides, ROOT_PACKAGE), false, '根包由 dependencies 钉，overrides 里再钉一次 npm 会报冲突')
})

test('内部一致性：一致 / 混装 / 缺关键子包三种结论', () => {
  const clean = [
    { name: ROOT_PACKAGE, version: '0.1.6-alpha.1', where: 'node_modules/@deepseek-ai/dsh' },
    { name: '@deepseek-ai/dsh-app-boot', version: '0.1.6-alpha.1', where: 'node_modules/@deepseek-ai/dsh-app-boot' },
  ]
  const cleanVerdict = checkFamilyVersions(clean)
  assert.equal(cleanVerdict.ok, true)
  assert.equal(cleanVerdict.expected, '0.1.6-alpha.1')
  assert.deepEqual(cleanVerdict.mismatches, [])
  assert.deepEqual(cleanVerdict.distinctVersions, ['0.1.6-alpha.1'])
  assert.ok(cleanVerdict.missingKey.includes('@deepseek-ai/dsh-base'), '关键子包里没出现的那几个要如实点名')

  const mixed = [...clean, { name: '@deepseek-ai/dsh-app-boot', version: '0.1.6-alpha.2', where: 'node_modules/other/node_modules/@deepseek-ai/dsh-app-boot' }]
  const mixedVerdict = checkFamilyVersions(mixed)
  assert.equal(mixedVerdict.ok, false)
  assert.deepEqual(mixedVerdict.distinctVersions, ['0.1.6-alpha.1', '0.1.6-alpha.2'])
  assert.equal(mixedVerdict.mismatches.length, 1)
  assert.match(mismatchDetailLines(mixedVerdict, { installDir: '/tmp/x' }).join('\n'), /版本混装/)
  assert.match(mismatchDetailLines(mixedVerdict).join('\n'), /@deepseek-ai\/dsh-app-boot@0\.1\.6-alpha\.2/)

  const empty = checkFamilyVersions([{ name: 'commander', version: '15.0.0', where: 'node_modules/commander' }])
  assert.equal(empty.ok, false, '树里连 @deepseek-ai/dsh 都没有时不能判成一致')
  assert.equal(empty.expected, undefined)
})

test('读树：嵌套那一份也单独列出来，并按包名排序', async () => {
  const tree = scratchDirSync('dsh-lab-version-')
  writePackage(tree, '@deepseek-ai/dsh', '0.1.6-alpha.1')
  writePackage(tree, '@deepseek-ai/dsh-app-boot', '0.1.6-alpha.1')
  writePackage(tree, 'commander', '15.0.0')
  fs.mkdirSync(path.join(tree, 'node_modules', 'other', 'node_modules', '@deepseek-ai'), { recursive: true })
  writePackage(path.join(tree, 'node_modules', 'other'), '@deepseek-ai/dsh-app-boot', '0.1.6-alpha.2')

  const packages = await readInstalledPackages(tree)
  assert.deepEqual(
    packages.map((each) => `${each.name}@${each.version}`),
    ['@deepseek-ai/dsh@0.1.6-alpha.1', '@deepseek-ai/dsh-app-boot@0.1.6-alpha.1', '@deepseek-ai/dsh-app-boot@0.1.6-alpha.2'],
  )
  assert.equal(checkFamilyVersions(packages).ok, false, '嵌套的那一份版本不同也该判成混装')
  assert.ok(versionReportLines(checkFamilyVersions(packages))[0]?.includes('版本集合 = {0.1.6-alpha.1, 0.1.6-alpha.2}'))
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
