import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ALLOW_SCRIPTS_PACKAGES,
  commandLine,
  decideUpdate,
  latestFromRegistryJson,
  npmCommandCandidates,
  npmMajorFromVersion,
  registryLatestUrls,
  upgradeArgs,
} from '../src/pure/dshUpdate.ts'

test('registryLatestUrls: 官方源在前、npmmirror 兜底，且都指向 /latest', () => {
  const urls = registryLatestUrls()
  assert.equal(urls.length, 2)
  assert.equal(urls[0], 'https://registry.npmjs.org/@deepseek-ai/dsh/latest')
  assert.equal(urls[1], 'https://registry.npmmirror.com/@deepseek-ai/dsh/latest')
})

test('latestFromRegistryJson: /latest 的 manifest（顶层 version）', () => {
  assert.equal(latestFromRegistryJson({ name: '@deepseek-ai/dsh', version: '0.1.5-rc.1' }), '0.1.5-rc.1')
})

test('latestFromRegistryJson: 整份 packument（dist-tags.latest）', () => {
  const packument = {
    name: '@deepseek-ai/dsh',
    'dist-tags': { latest: '0.1.5-rc.1', next: '0.1.5-rc.2', alpha: '0.1.6-alpha.1' },
  }
  assert.equal(latestFromRegistryJson(packument), '0.1.5-rc.1')
})

test('latestFromRegistryJson: dist-tags.latest 优先于顶层 version', () => {
  assert.equal(
    latestFromRegistryJson({ 'dist-tags': { latest: '0.1.5-rc.1' }, version: '0.1.4' }),
    '0.1.5-rc.1',
  )
})

test('latestFromRegistryJson: 形状不对 / 版本非法一律 undefined（不能当成「已是最新」）', () => {
  assert.equal(latestFromRegistryJson(null), undefined)
  assert.equal(latestFromRegistryJson('nope'), undefined)
  assert.equal(latestFromRegistryJson({}), undefined)
  assert.equal(latestFromRegistryJson({ 'dist-tags': { alpha: '0.1.6-alpha.1' } }), undefined)
  assert.equal(latestFromRegistryJson({ version: 'not-a-version' }), undefined)
})

test('decideUpdate: latest 更新 → update', () => {
  assert.deepEqual(decideUpdate('0.1.5-rc.1', '0.1.5-rc.2'), {
    state: 'update',
    installed: '0.1.5-rc.1',
    latest: '0.1.5-rc.2',
  })
})

test('decideUpdate: 持平 → current', () => {
  assert.equal(decideUpdate('0.1.5-rc.1', '0.1.5-rc.1').state, 'current')
})

test('decideUpdate: 装的比 latest 新（alpha 通道）→ ahead', () => {
  // 现在 npm 上 latest=0.1.5-rc.1 比 0.1.6-alpha.1 旧：装了 alpha 的用户不能被提示「有更新」。
  assert.equal(decideUpdate('0.1.6-alpha.1', '0.1.5-rc.1').state, 'ahead')
  // 正式版 > 自己的预发布版。
  assert.equal(decideUpdate('0.1.6', '0.1.6-alpha.1').state, 'ahead')
})

test('decideUpdate: 缺版本或解析不出 → unknown（不是 current）', () => {
  assert.equal(decideUpdate(undefined, '0.1.5-rc.1').state, 'unknown')
  assert.equal(decideUpdate('0.1.5-rc.1', undefined).state, 'unknown')
  assert.equal(decideUpdate('unknown', '0.1.5-rc.1').state, 'unknown')
})

test('npmMajorFromVersion: 取主版本号', () => {
  assert.equal(npmMajorFromVersion('11.0.0'), 11)
  assert.equal(npmMajorFromVersion('10.9.2\n'), 10)
  assert.equal(npmMajorFromVersion('unknown'), undefined)
})

test('npmCommandCandidates: 便携/nvm 布局取同目录 npm', () => {
  assert.deepEqual(npmCommandCandidates('/Users/me/.dsh/node-darwin-arm64/bin/dsh', 'darwin'), [
    '/Users/me/.dsh/node-darwin-arm64/bin/npm',
    'npm',
  ])
  assert.deepEqual(npmCommandCandidates('C:\\Users\\me\\.dsh\\node-x64\\dsh.cmd', 'win32'), [
    'C:/Users/me/.dsh/node-x64/npm.cmd',
    'npm',
  ])
})

test('npmCommandCandidates: 裸 dsh 与包内脚本退回 PATH 的 npm', () => {
  assert.deepEqual(npmCommandCandidates('dsh', 'linux'), ['npm'])
  assert.deepEqual(
    npmCommandCandidates('/usr/lib/node_modules/@deepseek-ai/dsh/lib/bin.js', 'linux'),
    ['npm'],
  )
})

test('upgradeArgs: 已知版本装那个版本；未知时装 latest 标签', () => {
  assert.deepEqual(upgradeArgs('0.1.5-rc.2', 10), ['install', '-g', '@deepseek-ai/dsh@0.1.5-rc.2'])
  assert.deepEqual(upgradeArgs(undefined, 10), ['install', '-g', '@deepseek-ai/dsh@latest'])
})

test('upgradeArgs: npm 11+ 必须带 --allow-scripts（否则原生二进制缺失）', () => {
  const args = upgradeArgs('0.1.5-rc.2', 11)
  assert.equal(args.length, 4)
  assert.equal(args[0], 'install')
  assert.equal(args[1], '-g')
  assert.equal(args[2], '@deepseek-ai/dsh@0.1.5-rc.2')
  assert.equal(args[3], `--allow-scripts=${ALLOW_SCRIPTS_PACKAGES.join(',')}`)
  // 清单必须覆盖 koffi / node-pty 这类要跑构建脚本才有原生二进制的包。
  assert.ok(args[3].includes('koffi'))
  assert.ok(args[3].includes('node-pty'))
})

test('commandLine: 安全 token 原样、带空格路径加引号', () => {
  assert.equal(
    commandLine('npm', upgradeArgs('0.1.5-rc.2', 11)),
    `npm install -g @deepseek-ai/dsh@0.1.5-rc.2 --allow-scripts=${ALLOW_SCRIPTS_PACKAGES.join(',')}`,
  )
  assert.equal(
    commandLine('/Applications/Node 22/bin/npm', ['install', '-g', '@deepseek-ai/dsh@latest']),
    '"/Applications/Node 22/bin/npm" install -g @deepseek-ai/dsh@latest',
  )
})
