import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { TagBridge, type TagBridgeHandleResult } from '../src/server/tagBridge.ts'
import type { TagBridgeRequest } from '../src/pure/tagBridgeCore.ts'

const noopLogger = { info: () => {}, warn: () => {} }

async function tmpDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'dsh-tag-bridge-'))
}

const defaultHandle = (_req: TagBridgeRequest): TagBridgeHandleResult => ({
  ok: true,
  tagName: 'g',
  tagId: 't-1',
  sessionCount: 1,
})

/** 起一个桥（可注入 handle），读回 bridge.json 记录做断言。 */
async function startBridge(
  file: string,
  handle: (req: TagBridgeRequest) => TagBridgeHandleResult = defaultHandle,
) {
  const bridge = new TagBridge({ filePath: file, handle, logger: noopLogger })
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

test('assign: POST /tag {action:assign, group, sessionIds} → 200 with tag + sessionCount', async () => {
  const file = path.join(await tmpDir(), 'bridge.json')
  const seen: TagBridgeRequest[] = []
  const { bridge, record } = await startBridge(file, (req) => {
    seen.push(req)
    return { ok: true, tagName: '批量组', tagId: 't-9', sessionCount: req.action === 'assign' ? req.sessionIds.length : 0 }
  })
  try {
    const r = await post(`http://127.0.0.1:${record.port}/tag`, { action: 'assign', group: '批量组', sessionIds: ['s1', 's2'] }, {
      authorization: `Bearer ${record.token}`,
    })
    assert.equal(r.status, 200)
    assert.deepEqual(seen, [{ action: 'assign', group: '批量组', sessionIds: ['s1', 's2'] }])
    assert.deepEqual(r.json, { ok: true, tag: { name: '批量组', id: 't-9' }, sessionCount: 2 })
  } finally {
    await bridge.dispose()
  }
})

test('get: POST /tag {action:get, sessionId} → 200 with group (or null)', async () => {
  const file = path.join(await tmpDir(), 'bridge.json')
  const { bridge, record } = await startBridge(file, (req) => {
    if (req.action === 'get') {
      return { ok: true, group: { workspaceId: 'ws-1', id: 't-2', name: '进行中', color: 'blue', preset: true } }
    }
    return { ok: true }
  })
  try {
    const r = await post(`http://127.0.0.1:${record.port}/tag`, { action: 'get', sessionId: 's1' }, {
      authorization: `Bearer ${record.token}`,
    })
    assert.equal(r.status, 200)
    assert.deepEqual(r.json, { ok: true, group: { workspaceId: 'ws-1', id: 't-2', name: '进行中', color: 'blue', preset: true } })
  } finally {
    await bridge.dispose()
  }
})

test('unassign: POST /tag {action:unassign, sessionIds} → 200 with sessionCount', async () => {
  const file = path.join(await tmpDir(), 'bridge.json')
  const { bridge, record } = await startBridge(file, (req) =>
    req.action === 'unassign' ? { ok: true, sessionCount: req.sessionIds.length } : { ok: true },
  )
  try {
    const r = await post(`http://127.0.0.1:${record.port}/tag`, { action: 'unassign', sessionIds: ['s1', 's2'] }, {
      authorization: `Bearer ${record.token}`,
    })
    assert.equal(r.status, 200)
    assert.deepEqual(r.json, { ok: true, sessionCount: 2 })
  } finally {
    await bridge.dispose()
  }
})

test('get returns group:null when handle gives null', async () => {
  const file = path.join(await tmpDir(), 'bridge.json')
  const { bridge, record } = await startBridge(file, () => ({ ok: true, group: null }))
  try {
    const r = await post(`http://127.0.0.1:${record.port}/tag`, { action: 'get', sessionId: 's1' }, {
      authorization: `Bearer ${record.token}`,
    })
    assert.equal(r.status, 200)
    assert.deepEqual(r.json, { ok: true, group: null })
  } finally {
    await bridge.dispose()
  }
})

test('POST without / with wrong token → 401 (never reaches handle)', async () => {
  const file = path.join(await tmpDir(), 'bridge.json')
  let called = 0
  const { bridge, record } = await startBridge(file, () => {
    called += 1
    return { ok: true }
  })
  try {
    const noAuth = await post(`http://127.0.0.1:${record.port}/tag`, { action: 'unassign', sessionIds: ['s'] })
    assert.equal(noAuth.status, 401)
    const wrong = await post(`http://127.0.0.1:${record.port}/tag`, { action: 'unassign', sessionIds: ['s'] }, {
      authorization: 'Bearer wrong',
    })
    assert.equal(wrong.status, 401)
    assert.equal(called, 0)
  } finally {
    await bridge.dispose()
  }
})

test('wrong method or wrong path → 404; malformed body → 400', async () => {
  const file = path.join(await tmpDir(), 'bridge.json')
  const { bridge, record } = await startBridge(file)
  try {
    const get = await fetch(`http://127.0.0.1:${record.port}/tag`)
    assert.equal(get.status, 404)
    const badPath = await post(`http://127.0.0.1:${record.port}/other`, { action: 'unassign', sessionIds: ['s'] }, {
      authorization: `Bearer ${record.token}`,
    })
    assert.equal(badPath.status, 404)
    const badJson = await fetch(`http://127.0.0.1:${record.port}/tag`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${record.token}` },
      body: '{broken',
    })
    assert.equal(badJson.status, 400)
    // 缺 action（无默认行为）→ 400 bad-action；空组名 → 400 empty-group。
    const noAction = await post(`http://127.0.0.1:${record.port}/tag`, { group: 'g', sessionIds: ['s'] }, {
      authorization: `Bearer ${record.token}`,
    })
    assert.equal(noAction.status, 400)
    const empty = await post(`http://127.0.0.1:${record.port}/tag`, { action: 'assign', group: '  ', sessionIds: ['s'] }, {
      authorization: `Bearer ${record.token}`,
    })
    assert.equal(empty.status, 400)
  } finally {
    await bridge.dispose()
  }
})

test('store error surfaces as 500 with its error code', async () => {
  const file = path.join(await tmpDir(), 'bridge.json')
  const { bridge, record } = await startBridge(file, () => ({ ok: false, error: 'tag-not-found' }))
  try {
    const r = await post(`http://127.0.0.1:${record.port}/tag`, { action: 'assign', tagId: 'nope', sessionIds: ['s'] }, {
      authorization: `Bearer ${record.token}`,
    })
    assert.equal(r.status, 500)
    assert.deepEqual(r.json, { ok: false, error: 'tag-not-found' })
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
  const b = await startBridge(file)
  assert.equal(await a.bridge.dispose(), false)
  const left = JSON.parse(await readFile(file, 'utf8')) as { port: number; token: string }
  assert.equal(left.port, b.record.port)
  assert.equal(left.token, b.record.token)
  assert.equal(await b.bridge.dispose(), true)
  await assert.rejects(readFile(file, 'utf8'), /ENOENT/)
})

test('dispose is idempotent (calling twice is a no-op)', async () => {
  const file = path.join(await tmpDir(), 'bridge.json')
  const { bridge } = await startBridge(file)
  await bridge.dispose()
  await bridge.dispose()
})

test('start writes bridge.json {port, token}', async () => {
  const file = path.join(await tmpDir(), 'bridge.json')
  const { bridge, record } = await startBridge(file)
  try {
    assert.equal(record.port, bridge.port)
    assert.equal(typeof record.token, 'string')
    assert.ok(record.token.length >= 20)
  } finally {
    await bridge.dispose()
  }
})
