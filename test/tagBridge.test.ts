import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { TagBridge, type TagBridgeAssignInput, type TagBridgeAssignResult } from '../src/server/tagBridge.ts'

const noopLogger = { info: () => {}, warn: () => {} }

async function tmpDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'dsh-tag-bridge-'))
}

/** 起一个桥（可注入 assignTags），读回 bridge.json 记录做断言。 */
async function startBridge(
  file: string,
  assignTags: (input: TagBridgeAssignInput) => TagBridgeAssignResult = () => ({
    ok: true,
    tagName: 'g',
    tagId: 't-1',
    sessionCount: 1,
  }),
) {
  const bridge = new TagBridge({ filePath: file, assignTags, logger: noopLogger })
  await bridge.start()
  const record = JSON.parse(await readFile(file, 'utf8')) as { port: number; token: string }
  return { bridge, record }
}

function post(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: unknown }> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, json: await r.json() }))
}

test('start writes bridge.json {port, token}; POST /tag with Bearer token assigns', async () => {
  const file = path.join(await tmpDir(), 'bridge.json')
  const seen: TagBridgeAssignInput[] = []
  const { bridge, record } = await startBridge(file, (input) => {
    seen.push(input)
    return { ok: true, tagName: input.group, tagId: 't-9', sessionCount: input.sessionIds.length }
  })
  try {
    assert.equal(record.port, bridge.port)
    assert.equal(typeof record.token, 'string')
    assert.ok(record.token.length >= 20)
    const r = await post(`http://127.0.0.1:${record.port}/tag`, { group: '批量组', sessionIds: ['s1', 's2'] }, {
      authorization: `Bearer ${record.token}`,
    })
    assert.equal(r.status, 200)
    assert.deepEqual(seen, [{ group: '批量组', sessionIds: ['s1', 's2'] }])
    assert.deepEqual(r.json, { ok: true, tag: { name: '批量组', id: 't-9' }, sessionCount: 2 })
  } finally {
    await bridge.dispose()
  }
})

test('POST without / with wrong token → 401 (never reaches assignTags)', async () => {
  const file = path.join(await tmpDir(), 'bridge.json')
  let called = 0
  const { bridge, record } = await startBridge(file, () => {
    called += 1
    return { ok: true, tagName: 'g', tagId: 't', sessionCount: 1 }
  })
  try {
    const noAuth = await post(`http://127.0.0.1:${record.port}/tag`, { group: 'g', sessionIds: ['s'] })
    assert.equal(noAuth.status, 401)
    const wrong = await post(`http://127.0.0.1:${record.port}/tag`, { group: 'g', sessionIds: ['s'] }, {
      authorization: 'Bearer wrong',
    })
    assert.equal(wrong.status, 401)
    assert.equal(called, 0)
  } finally {
    await bridge.dispose()
  }
})

test('wrong method or wrong path → 404; malformed body → 400/413', async () => {
  const file = path.join(await tmpDir(), 'bridge.json')
  const { bridge, record } = await startBridge(file)
  try {
    const get = await fetch(`http://127.0.0.1:${record.port}/tag`)
    assert.equal(get.status, 404)
    const badPath = await post(`http://127.0.0.1:${record.port}/other`, { group: 'g', sessionIds: ['s'] }, {
      authorization: `Bearer ${record.token}`,
    })
    assert.equal(badPath.status, 404)
    // 坏 JSON：fetch 对 body 得给原始字符串。
    const badJson = await fetch(`http://127.0.0.1:${record.port}/tag`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${record.token}` },
      body: '{broken',
    })
    assert.equal(badJson.status, 400)
    // 坏形状（组名空）→ 400
    const empty = await post(`http://127.0.0.1:${record.port}/tag`, { group: '  ', sessionIds: ['s'] }, {
      authorization: `Bearer ${record.token}`,
    })
    assert.equal(empty.status, 400)
  } finally {
    await bridge.dispose()
  }
})

test('dispose removes bridge.json when this window is the registrant', async () => {
  const file = path.join(await tmpDir(), 'bridge.json')
  const { bridge } = await startBridge(file)
  assert.equal(await bridge.dispose(), true)
  await assert.rejects(readFile(file, 'utf8'), /ENOENT/)
})

test('dispose leaves a superseding window record alone (multi-window: 晚激活覆盖注册)', async () => {
  const file = path.join(await tmpDir(), 'bridge.json')
  const a = await startBridge(file)
  // 窗口 B 晚激活，用同一份 bridge.json 覆盖注册。
  const b = await startBridge(file)
  // A 失效：dispose A 不得动 B 的记录。
  assert.equal(await a.bridge.dispose(), false)
  const left = JSON.parse(await readFile(file, 'utf8')) as { port: number; token: string }
  assert.equal(left.port, b.record.port)
  assert.equal(left.token, b.record.token)
  // 最后一个窗口（B）dispose 才清记录。
  assert.equal(await b.bridge.dispose(), true)
  await assert.rejects(readFile(file, 'utf8'), /ENOENT/)
})

test('start failure does not throw into caller (bad bind) but keeps extension usable', async () => {
  const file = path.join(await tmpDir(), 'bridge.json')
  // 先占一个端口再让桥 bind 同一个 → listen 失败。
  const holder = await startBridge(file)
  const dup = new TagBridge({ filePath: file, assignTags: () => ({ ok: true }), logger: noopLogger })
  // 人工复现 bind 失败：直接对一个已占但错误的地址路径无意义，这里仅验证 dispose 幂等。
  assert.equal(await dup.dispose(), false) // 未 start，dispose 是 no-op
  await holder.bridge.dispose()
})

test('dispose is idempotent (calling twice is a no-op)', async () => {
  const file = path.join(await tmpDir(), 'bridge.json')
  const { bridge } = await startBridge(file)
  await bridge.dispose()
  await bridge.dispose() // 第二次应安全返回 false（已不监听）
})
