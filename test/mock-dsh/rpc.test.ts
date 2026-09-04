import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMockServer, type MockServer } from './server.ts'
import { RawWsClient } from './ws-client.ts'
import { validateDescribeResponse } from '../../src/pure/envelope.ts'
import { parseHostFrame } from '../../src/pure/hostFrames.ts'

let mock: MockServer

test.before(async () => {
  mock = await createMockServer().listen(0)
})

test.after(async () => {
  await mock.close()
})

async function rpc(method: string, payload: Record<string, unknown>, rpcId: string): Promise<any> {
  const res = await fetch(mock.url + `/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
  })
  return res.json()
}

test('host.describe：rpcId 回声（这正是扩展「这是 dsh」的探测判据）', async () => {
  const rpcId = '11111111-1111-4111-8111-111111111111'
  const res = await fetch(mock.url + '/api/host.describe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method: 'host.describe', payload: {} }),
  })
  const text = await res.text()
  // 扩展 probePort 用它判断：返回 JSON 对象且 rpcId 等于请求值。
  assert.equal(validateDescribeResponse(text, rpcId), true)
  const body = JSON.parse(text)
  assert.equal(body.rpcId, rpcId)
  assert.equal(body.result.ok, true)
})

test('典型 RPC 信封往返：session.list 返回 items，每个 item 有 sessionId', async () => {
  const body = await rpc('session.list', {}, 'rpc-list')
  assert.equal(body.rpcId, 'rpc-list')
  assert.equal(body.result.ok, true)
  const items: Array<Record<string, unknown>> = body.result.value.items
  assert.ok(Array.isArray(items))
  assert.ok(items.length >= 3)
  for (const item of items) assert.equal(typeof item.sessionId, 'string')
})

/** 读帧直到谓词命中（readFrame 无超时，这里包一层 deadline 上限）。 */
async function readUntil(
  ws: RawWsClient,
  pred: (m: Record<string, any>) => boolean,
  deadlineMs = 2000,
): Promise<Record<string, any> | null> {
  const deadline = Date.now() + deadlineMs
  for (;;) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) return null
    const read = ws.readFrame().then((f) => JSON.parse(f.payload.toString('utf8')))
    const timeout = new Promise((r) => setTimeout(() => r(null), Math.max(remaining, 1)))
    const msg = (await Promise.race([read, timeout])) as Record<string, any> | null
    if (msg === null) return null
    if (pred(msg)) return msg
  }
}

test('pending 状态：未应答时每次连接都重放，rpcId 跨连接稳定', async () => {
  const ws1 = new RawWsClient()
  await ws1.connect(mock.port, '/api/events.mux')
  const a1 = await readUntil(ws1, (m) => m.method === 'approval/requested' && m.payload?.sessionId === 'scn-approval')
  assert.notEqual(a1, null)
  ws1.close()

  const ws2 = new RawWsClient()
  await ws2.connect(mock.port, '/api/events.mux')
  const a2 = await readUntil(ws2, (m) => m.method === 'approval/requested' && m.payload?.sessionId === 'scn-approval')
  assert.notEqual(a2, null)
  // 未应答 → rpcId 稳定（真实 dsh 的 pending 请求在应答前编号不变）。
  assert.equal((a1 as Record<string, any>).rpcId, (a2 as Record<string, any>).rpcId)
  ws2.close()
})

test('/api/respond：pending 应答后 accepted:true，未知 rpcId 返回 false', async () => {
  // pending 是会话状态：连上 mux 就会收到 scn-approval 的 approval/requested
  // （状态重放，与 history/连接时序无关——对齐真实 dsh）。
  const ws = new RawWsClient()
  await ws.connect(mock.port, '/api/events.mux')
  const approval = await readUntil(
    ws,
    (m) => m.method === 'approval/requested' && m.payload?.sessionId === 'scn-approval',
  )
  assert.notEqual(approval, null)
  const approvalRpcId = (approval as Record<string, any>).rpcId as string

  const okRes = await fetch(mock.url + '/api/respond', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-response', rpcId: approvalRpcId, result: { ok: true, value: { outcome: 'allowed-once' } } }),
  })
  const ok = await okRes.json()
  assert.equal(ok.accepted, true)

  // 应答成功 → mock 广播 approval/resolved（扩展按 approvalId 清 pending 面板）。
  const resolved = await readUntil(ws, (m) => m.method === 'approval/resolved')
  assert.notEqual(resolved, null)
  const resolvedMsg = resolved as Record<string, any>
  assert.equal(resolvedMsg.payload?.approvalId, 'ap-1')
  assert.equal(resolvedMsg.payload?.sessionId, 'scn-approval')

  ws.close()
  // 已应答的 rpcId 不再可用；未知 rpcId 同样拒绝。
  const again = await fetch(mock.url + '/api/respond', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-response', rpcId: approvalRpcId, result: { ok: true, value: {} } }),
  })
  assert.equal((await again.json()).accepted, false)
  const unknownRes = await fetch(mock.url + '/api/respond', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-response', rpcId: '00000000-0000-4000-8000-000000000000', result: { ok: true, value: {} } }),
  })
  assert.equal((await unknownRes.json()).accepted, false)
})

test('编排：session.prompt 后 mux 收到 session/event，seq 单调递增且第一帧 seq=1', async () => {
  const ws = new RawWsClient()
  await ws.connect(mock.port, '/api/events.mux')
  // 等 mock 把订阅基线/approval 噪声推完（它们先于 prompt 事件到达）。
  await new Promise((r) => setTimeout(r, 50))
  await rpc('session.prompt', { sessionId: 'scn-empty', mode: 'queue', content: [{ type: 'text', text: '你好' }] }, 'rpc-prompt')

  const seqs: number[] = []
  for (let i = 0; i < 30 && seqs.length < 8; i++) {
    const frame = await ws.readFrame()
    const msg = JSON.parse(frame.payload.toString('utf8'))
    // 扩展 subscribeMuxEvents 只认 type==='server-request' 且 method 是字符串。
    if (msg.type !== 'server-request' || typeof msg.method !== 'string') continue
    if (msg.method !== 'session/event' || msg.payload.sessionId !== 'scn-empty') continue
    const event = msg.payload.event
    if (typeof event.seq === 'number') seqs.push(event.seq)
  }
  assert.ok(seqs.length >= 8, `expected ≥8 frames, got ${seqs.length}`)
  assert.equal(seqs[0], 1)
  for (let i = 1; i < seqs.length; i++) assert.ok(seqs[i] > seqs[i - 1], `seq not increasing at ${i}: ${seqs[i - 1]} → ${seqs[i]}`)
  ws.close()
})

test('events.host 帧：workspace.create 推 host/workspace-changed，parseHostFrame 非 null', async () => {
  const ws = new RawWsClient()
  await ws.connect(mock.port, '/api/events.host')
  await rpc('workspace.create', { path: '/mock/new-ws' }, 'rpc-ws')
  const frame = await ws.readFrame()
  const msg = JSON.parse(frame.payload.toString('utf8'))
  assert.equal(typeof msg.method, 'string')
  assert.equal(typeof msg.payload, 'object')
  // 用扩展自己的解析器验证帧格式：非 null 即格式兼容。
  assert.notEqual(parseHostFrame(msg.method, msg.payload), null)
  ws.close()
})
