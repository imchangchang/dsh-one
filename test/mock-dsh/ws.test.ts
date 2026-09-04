import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMockServer, wsAccept, type MockServer } from './server.ts'
import { RawWsClient, expectWsAccept } from './ws-client.ts'

let mock: MockServer

test.before(async () => {
  mock = await createMockServer().listen(0)
})

test.after(async () => {
  await mock.close()
})

const HOST_CHANNEL = '/api/events.host'

test('ws 握手：101 + Sec-WebSocket-Accept 正确（扩展全局 WebSocket 会做同样的握手）', async () => {
  const ws = new RawWsClient()
  const res = await ws.connect(mock.port, HOST_CHANNEL)
  assert.equal(res.status, 101)
  assert.equal(res.accept, expectWsAccept(res.key))
  // 与 server.ts 的 wsAccept 同算法（防 helper 与实现各错一半）。
  assert.equal(res.accept, wsAccept(res.key))
  assert.equal(res.headers.upgrade, 'websocket')
  ws.close()
})

test('ws 文本帧收发：客户端掩码帧被正确解析，mock 原样回显一帧', async () => {
  const ws = new RawWsClient()
  await ws.connect(mock.port, HOST_CHANNEL)
  ws.sendText('hello dsh')
  const frame = await ws.readFrame()
  assert.equal(frame.opcode, 0x1)
  assert.equal(frame.payload.toString('utf8'), 'hello dsh')
  ws.close()
})

test('ws 长度>125 字节的帧：16 位长度前缀正确解析并回显', async () => {
  const ws = new RawWsClient()
  await ws.connect(mock.port, HOST_CHANNEL)
  const big = 'x'.repeat(300)
  ws.sendText(big)
  const frame = await ws.readFrame()
  assert.equal(frame.opcode, 0x1)
  assert.equal(frame.payload.length, 300)
  assert.equal(frame.payload.toString('utf8'), big)
  ws.close()
})

test('ws ping/pong：客户端 ping 得到同 payload 的 pong', async () => {
  const ws = new RawWsClient()
  await ws.connect(mock.port, HOST_CHANNEL)
  ws.sendPing(Buffer.from('ping-1'))
  const frame = await ws.readFrame()
  assert.equal(frame.opcode, 0xa)
  assert.equal(frame.payload.toString('utf8'), 'ping-1')
  ws.close()
})

test('ws 非 websocket 路径被直接拒绝（不升级）', async () => {
  const ws = new RawWsClient()
  await assert.rejects(() => ws.connect(mock.port, '/api/not-a-ws'), (err) => {
    assert.ok(err instanceof Error)
    return true
  })
  ws.close()
})
