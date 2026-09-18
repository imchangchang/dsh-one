/**
 * 宿主能力口（#84）的单测：线协议契约校核 + 宿主半三块纯逻辑（状态 / 落盘 / git）。
 *
 * 覆盖的是「不可信输入能做什么」与「数据落在哪儿」两类事实——这两类错了就是安全
 * 或数据事故，必须钉死在纯函数层。**构建期约束**（宿主半不能压缩：官方网关按方法
 * 形参名取值）另有一条断言盯着构建产物。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { existsSync } from 'node:fs'
import { scratchDirSync } from './scratchDirs.ts'
import {
  HOST_CAPABILITY_METHODS,
  HOST_CAPABILITY_SERVICE,
  capabilityEndpoint,
  failure,
  isCapabilityFailure,
  parseBase64,
  parseDownloadArgs,
  parseDownloadPath,
  parseSaveFileArgs,
  parseStateKey,
  parseStateValue,
  parseSuggestedName,
} from '../src/pure/hostCapabilities.ts'
import { deleteState, dshHomeDir, readState, stateFilePath, writeState } from '../packages/dsh-host-capabilities/src/stateStore.ts'
import { resolveSaveDir, saveContentFile, uniqueFileName } from '../packages/dsh-host-capabilities/src/saveContent.ts'

const tmpHome = (): string => scratchDirSync('dsh-cap-')

test('端点名 = <服务名>/<方法名>，方法表与宿主半实例方法一一对应', () => {
  assert.equal(capabilityEndpoint('stateRead'), `${HOST_CAPABILITY_SERVICE}/stateRead`)
  assert.deepEqual(Object.keys(HOST_CAPABILITY_METHODS).sort(), [
    'gitShow',
    'saveContent',
    'stateDelete',
    'stateRead',
    'stateWrite',
  ])
})

test('失败回执判定只认 { ok: false, error: { code, message } }', () => {
  assert.equal(isCapabilityFailure(failure('invalid-args', 'bad')), true)
  assert.equal(isCapabilityFailure({ ok: true, value: 1 }), false)
  assert.equal(isCapabilityFailure({ ok: false }), false)
  assert.equal(isCapabilityFailure({ ok: false, error: { code: 'x' } }), false)
  assert.equal(isCapabilityFailure(null), false)
})

test('状态键是路径穿越的唯一闸门：分隔符、..、空、超长一律拒', () => {
  assert.equal(parseStateKey('sidebar.recycle-bin'), 'sidebar.recycle-bin')
  assert.equal(parseStateKey('pinned'), 'pinned')
  for (const bad of ['../evil', 'a/b', 'a\\b', '', '.', '..', 'A-upper', 'a b', 'x'.repeat(65), 7, null, undefined]) {
    assert.equal(typeof parseStateKey(bad), 'object', `应拒绝 ${JSON.stringify(bad)}`)
  }
  assert.throws(() => stateFilePath('../evil', '/tmp'), /refusing to build a state path/)
})

test('状态值必须是能过线的 JSON（函数 / BigInt / 循环引用都过不了）', () => {
  assert.equal(parseStateValue(['a', 1]), '["a",1]')
  assert.equal(parseStateValue({ version: 1, sessionIds: [] }), '{"version":1,"sessionIds":[]}')
  assert.equal(typeof parseStateValue(undefined), 'object')
  assert.equal(typeof parseStateValue(() => 1), 'object')
  assert.equal(typeof parseStateValue(BigInt(1)), 'object')
  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  assert.equal(typeof parseStateValue(cyclic), 'object')
})

test('状态读写删落在 <home>/dsh-one/<键>.json，且是原子写', async () => {
  const home = tmpHome()
  assert.equal(dshHomeDir({ DSH_HOME: home }), home)
  assert.equal(dshHomeDir({}), path.join(os.homedir(), '.dsh'))
  assert.equal(await readState('recycle-bin', home), null)
  await writeState('recycle-bin', '{"version":1,"sessionIds":["s1"]}', home)
  assert.deepEqual(await readState('recycle-bin', home), { version: 1, sessionIds: ['s1'] })
  assert.equal(
    await fs.readFile(path.join(home, 'dsh-one', 'recycle-bin.json'), 'utf8'),
    '{"version":1,"sessionIds":["s1"]}',
  )
  // 目录里不留 tmp 残渣（原子写用同目录 tmp + rename）。
  assert.deepEqual((await fs.readdir(path.join(home, 'dsh-one'))).filter((f) => f.includes('.tmp-')), [])
  assert.equal(await deleteState('recycle-bin', home), true)
  assert.equal(await deleteState('recycle-bin', home), false)
  assert.equal(await readState('recycle-bin', home), null)
})

test('坏状态文件降级为 null（不让插件崩）', async () => {
  const home = tmpHome()
  await fs.mkdir(path.join(home, 'dsh-one'), { recursive: true })
  await fs.writeFile(path.join(home, 'dsh-one', 'groups.json'), '{ not json')
  assert.equal(await readState('groups', home), null)
})

test('落盘：文件名校核（无分隔符 / 无 ..）', () => {
  assert.equal(parseSuggestedName('dsh-session-abc.zip'), 'dsh-session-abc.zip')
  for (const bad of ['../x.zip', 'a/b.zip', 'a\\b.zip', '.', 'x..y', '', 'x'.repeat(129), 7]) {
    assert.equal(typeof parseSuggestedName(bad), 'object', `应拒绝 ${JSON.stringify(bad)}`)
  }
})

test('落盘：首选目录不存在时回落，重名不覆盖', async () => {
  const home = tmpHome()
  const fallback = path.join(home, 'exports')
  const dir = await resolveSaveDir({ preferred: path.join(home, 'nope'), fallback })
  assert.equal(dir, fallback)
  assert.equal(await uniqueFileName(dir, 'log.zip'), 'log.zip')
  const first = await saveContentFile('log.zip', Buffer.from('hello').toString('base64'), { preferred: path.join(home, 'nope'), fallback })
  const second = await saveContentFile('log.zip', Buffer.from('again').toString('base64'), { preferred: path.join(home, 'nope'), fallback })
  assert.equal(path.basename(first), 'log.zip')
  assert.equal(path.basename(second), 'log-1.zip')
  assert.equal(await fs.readFile(first, 'utf8'), 'hello')
  assert.equal(await fs.readFile(second, 'utf8'), 'again')
})

test('落盘：首选目录存在就用它', async () => {
  const home = tmpHome()
  const preferred = path.join(home, 'Downloads')
  await fs.mkdir(preferred)
  assert.equal(await resolveSaveDir({ preferred, fallback: path.join(home, 'exports') }), preferred)
})

test('base64 校核：空 / 长度非 4 的倍数 / 非法字符 / 超限一律拒', () => {
  assert.equal(parseBase64(Buffer.from('hi').toString('base64')), 'aGk=')
  for (const bad of ['', 'abc', '####', 7, undefined, 'A'.repeat(64 * 1024 * 1024 + 4)]) {
    assert.equal(typeof parseBase64(bad), 'object', `应拒绝 ${String(bad).slice(0, 16)}`)
  }
})

test('file.download 路径必须本站绝对路径（协议相对 / .. / 反斜杠 / 控制字符全拒）', () => {
  assert.equal(parseDownloadPath('/api/session.export?sessionId=s1'), '/api/session.export?sessionId=s1')
  for (const bad of [
    '//evil.example/x',
    'https://evil.example/x',
    '/api/../../etc/passwd',
    '/api/a\\b',
    '/api/a\u0000b',
    '',
    'api/x',
    7,
  ]) {
    assert.equal(typeof parseDownloadPath(bad), 'object', `应拒绝 ${JSON.stringify(bad)}`)
  }
  assert.equal(typeof parseDownloadArgs({ path: '/api/x' }), 'object', '缺 suggestedName 要拒')
  assert.deepEqual(parseDownloadArgs({ path: '/api/x', suggestedName: 'a.zip' }), {
    path: '/api/x',
    suggestedName: 'a.zip',
  })
  assert.deepEqual(parseSaveFileArgs({ suggestedName: 'a.zip', base64: 'aGk=' }), { suggestedName: 'a.zip', base64: 'aGk=' })
})

test('宿主半构建产物不压缩（官方网关按方法形参名取值）', async () => {
  // 产物不入库（#106）：`npm test` 会先 build，直接 `node --test` 跑本文件才会缺——给出该做什么。
  const bundlePath = path.join(import.meta.dirname, '..', 'packages', 'dsh-host-capabilities', 'lib', 'index.js')
  assert.ok(existsSync(bundlePath), `缺构建产物 packages/dsh-host-capabilities/lib/index.js——先跑 npm run build`)
  const bundle = await fs.readFile(bundlePath, 'utf8')
  for (const signature of ['async stateRead(key)', 'async stateWrite(key, value)', 'async stateDelete(key)', 'async gitShow(hash, cwd)', 'async saveContent(suggestedName, base64)']) {
    assert.ok(bundle.includes(signature), `宿主半 bundle 必须保留形参名：${signature}`)
  }
  assert.ok(bundle.includes('typertRemote'), '宿主半必须声明 typertRemote 绑定（网关 SRC 发现靠它）')
  // 官方包留 external：安装到 profile 时从包自己的依赖里解析，不打包进我们的产物。
  assert.ok(bundle.includes("from \"@deepseek-ai/dsh-typert-protocol\"") || bundle.includes("from '@deepseek-ai/dsh-typert-protocol'"))
})
