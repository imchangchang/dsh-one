import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDshEntryFromCommandLine, extractDshVersion } from '../src/pure/dshCommandLine.ts'

test('parse: npm 全局包安装（node @deepseek-ai/dsh/lib/bin.js）', () => {
  const cmd =
    'node /Users/cgeng/.nvm/versions/node/v24.19.0/lib/node_modules/@deepseek-ai/dsh/lib/bin.js web --host 127.0.0.1 --port 3080 --no-open'
  assert.deepEqual(parseDshEntryFromCommandLine(cmd), {
    command: 'node',
    args: ['/Users/cgeng/.nvm/versions/node/v24.19.0/lib/node_modules/@deepseek-ai/dsh/lib/bin.js'],
  })
})

test('parse: 命令行直接指向包目录（…/@deepseek-ai/dsh …）→ lib/bin.js', () => {
  const cmd = 'node /opt/xyz/node_modules/@deepseek-ai/dsh web --port 3080'
  assert.deepEqual(parseDshEntryFromCommandLine(cmd), {
    command: 'node',
    args: ['/opt/xyz/node_modules/@deepseek-ai/dsh/lib/bin.js'],
  })
})

test('parse: 官方打包产物 dist/dsh.js', () => {
  const cmd = 'node /opt/dsh/dist/dsh.js web --port 3080'
  assert.deepEqual(parseDshEntryFromCommandLine(cmd), {
    command: 'node',
    args: ['/opt/dsh/dist/dsh.js'],
  })
})

test('parse: nvm shim 转发（node …/bin/dsh web）', () => {
  const cmd = 'node /Users/cgeng/.nvm/versions/node/v24.19.0/bin/dsh web --port 3080 --no-open'
  assert.deepEqual(parseDshEntryFromCommandLine(cmd), {
    command: '/Users/cgeng/.nvm/versions/node/v24.19.0/bin/dsh',
    args: [],
  })
})

test('parse: Windows npm 全局 shim（dsh.cmd），含引号 token', () => {
  const cmd = 'node "C:\\Users\\me\\AppData\\Roaming\\npm\\dsh.cmd" web --port 3080'
  assert.deepEqual(parseDshEntryFromCommandLine(cmd), {
    command: 'C:\\Users\\me\\AppData\\Roaming\\npm\\dsh.cmd',
    args: [],
  })
})

test('parse: 本地 checkout（token 含 dsh 路径段）', () => {
  const cmd = 'node /work/dsh/dist/dsh.js web --port 3080'
  assert.deepEqual(parseDshEntryFromCommandLine(cmd), {
    command: 'node',
    args: ['/work/dsh/dist/dsh.js'],
  })
})

test('parse: 裸 dsh / 无路径无法确认来源 → null（不显示版本）', () => {
  assert.equal(parseDshEntryFromCommandLine('dsh web --port 3080'), null)
  assert.equal(parseDshEntryFromCommandLine(''), null)
  assert.equal(parseDshEntryFromCommandLine('node bin.js web --port 3080'), null)
})

test('parse: Windows 反斜杠包路径归一', () => {
  const cmd = 'node C:\\app\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js web --port 3080'
  assert.deepEqual(parseDshEntryFromCommandLine(cmd), {
    command: 'node',
    args: ['C:/app/node_modules/@deepseek-ai/dsh/lib/bin.js'],
  })
})

test('extractDshVersion: 从 --version 输出提第一个 semver；无则 unknown', () => {
  assert.equal(extractDshVersion('0.1.2-rc.1\n'), '0.1.2-rc.1')
  assert.equal(extractDshVersion('v1.0.0\n'), '1.0.0')
  assert.equal(extractDshVersion('dsh version 0.1.1 running\n'), '0.1.1')
  assert.equal(extractDshVersion('not a version'), 'unknown')
  assert.equal(extractDshVersion(''), 'unknown')
})
