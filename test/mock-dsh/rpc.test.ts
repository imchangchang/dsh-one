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

test('/api/respond：对已下发 approval/question 的 rpcId 返回 accepted:true，未知 rpcId 返回 false', async () => {
  // chatSession 的挂载顺序：先拉 history 基线（tail 页）、再连 mux；mock 的
  // onSubscribe 由 history tail 页触发（见 server.ts scheduleOnSubscribe），
  // 所以先 rpc history 再连 WS。
  await rpc('session.history', { sessionId: 'scn-approval' }, 'rpc-history-appr')
  const ws = new RawWsClient()
  await ws.connect(mock.port, '/api/events.mux')
  let approvalRpcId: string | undefined
  for (let i = 0; i < 20 && !approvalRpcId; i++) {
    const frame = await ws.readFrame()
    const msg = JSON.parse(frame.payload.toString('utf8'))
    if (msg.method === 'approval/requested' && msg.payload.sessionId === 'scn-approval') {
      approvalRpcId = msg.rpcId
    }
  }
  assert.equal(typeof approvalRpcId, 'string')

  const okRes = await fetch(mock.url + '/api/respond', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-response', rpcId: approvalRpcId, result: { ok: true, value: { outcome: 'allowed-once' } } }),
  })
  const ok = await okRes.json()
  assert.equal(ok.accepted, true)

  // 已应答过的 rpcId 或未知 rpcId → accepted:false。
  const unknownRes = await fetch(mock.url + '/api/respond', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-response', rpcId: '00000000-0000-4000-8000-000000000000', result: { ok: true, value: {} } }),
  })
  assert.equal((await unknownRes.json()).accepted, false)
  ws.close()
})

test('onSubscribe 依 history tail 页触发：只连 mux 不拉 history 不推 approval', async () => {
  const ws = new RawWsClient()
  await ws.connect(mock.port, '/api/events.mux')
  // 限时收集帧（readFrame 无超时，这里用 deadline 竞速）。
  const frames: Array<Record<string, unknown>> = []
  const deadline = Date.now() + 600
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now()
    const read = ws.readFrame().then((f) => f.payload.toString('utf8'))
    const timeout = new Promise((r) => setTimeout(() => r(null), Math.max(remaining, 1)))
    const text = (await Promise.race([read, timeout])) as string | null
    if (text === null) break
    frames.push(JSON.parse(text))
  }
  const approvals = frames.filter((m) => m.method === 'approval/requested')
  assert.equal(approvals.length, 0, `未拉 history 不应推 approval，实际收到 ${approvals.length} 帧`)
  assert.equal(
    frames.every((m) => m.method === 'session/subscribed'),
    true,
    '未拉 history 时只应有 subscribed 基线帧',
  )
  ws.close()
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
