/**
 * 集成验证 shareControlStream 的晚订阅者重放（queue-lost-after-session-switch）：
 * 用最小 remote.mux WS 服务端模拟 dsh 0.1.2 gateway——`session/control` 流在
 * open 时推 baseline + 增量，之后新建的逻辑流不复推。
 *
 * 场景：JobsStore 先订阅（占住单例流）→ 服务端推 baseline + queue 增量 →
 * 晚到的 ChatSessionController 再订阅 → 必须立即收到合成的 baseline 帧
 * （含合并后的队列），否则排队消息在会话切换后丢失。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as http from 'node:http'
import type { Socket } from 'node:net'
import { encodeFrame, decodeFrame, wsAccept } from './mock-dsh/server.ts'
import { subscribeControlStream } from '../src/server/modernStreams.ts'
import type { ControlStreamFrame } from '../src/pure/remoteFrames.ts'
import type { Logger } from '../src/log.ts'

/** 最小 remote.mux 服务端：只实现 open/cancel + 按 streamId 推 item 帧。 */
class MockMuxServer {
  private readonly server = http.createServer()
  private readonly sockets = new Set<Socket>()
  private streams = new Map<string, Socket>()
  port = 0

  constructor() {
    this.server.on('upgrade', (req, rawSocket, head) => {
      const socket = rawSocket as Socket
      if ((req.url ?? '').split('?')[0] !== '/api/remote.mux') {
        socket.destroy()
        return
      }
      const key = req.headers['sec-websocket-key']
      if (typeof key !== 'string' || key === '') {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
        socket.destroy()
        return
      }
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          `Sec-WebSocket-Accept: ${wsAccept(key)}\r\n` +
          '\r\n',
      )
      this.sockets.add(socket)
      socket.on('close', () => {
        this.sockets.delete(socket)
        for (const [id, s] of this.streams) {
          if (s === socket) this.streams.delete(id)
        }
      })
      socket.on('data', (chunk) => this.onData(socket, chunk))
      if (head.length > 0) this.onData(socket, head)
    })
    this.server.on('connection', (socket) => {
      this.sockets.add(socket)
      socket.on('close', () => this.sockets.delete(socket))
      socket.on('error', () => this.sockets.delete(socket))
    })
  }

  async listen(): Promise<number> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve))
    const addr = this.server.address()
    if (addr === null || typeof addr === 'string') throw new Error('mock mux: no port')
    this.port = addr.port
    return this.port
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy()
    await new Promise<void>((resolve) => this.server.close(() => resolve()))
  }

  /** 客户端 open/cancel 帧解析（行缓冲剥帧，匹配 decodeFrame 的最小子集）。 */
  private buffer = new Map<Socket, Buffer>()

  private onData(socket: Socket, chunk: Buffer): void {
    let buf = Buffer.concat([this.buffer.get(socket) ?? Buffer.alloc(0), chunk])
    for (;;) {
      const parsed = decodeFrame(buf)
      if (!parsed) break
      buf = buf.subarray(parsed.consumed)
      const { opcode, payload } = parsed.frame
      if (opcode === 0x8) {
        socket.end()
        return
      }
      if (opcode !== 0x1) continue
      let frame: { type?: string; streamId?: string }
      try {
        frame = JSON.parse(payload.toString('utf8')) as typeof frame
      } catch {
        continue
      }
      if (frame.type === 'open' && typeof frame.streamId === 'string') {
        this.streams.set(frame.streamId, socket)
      } else if (frame.type === 'cancel' && typeof frame.streamId === 'string') {
        this.streams.delete(frame.streamId)
      }
    }
    this.buffer.set(socket, buf)
  }

  /** 向一条流推送一个 item 帧（值为逻辑流帧本身）。 */
  push(streamId: string, value: unknown): void {
    const socket = this.streams.get(streamId)
    if (!socket) throw new Error(`mock mux: no stream ${streamId}`)
    socket.write(encodeFrame(0x1, Buffer.from(JSON.stringify({ type: 'item', streamId, value }), 'utf8')))
  }

  /** 等待某个 streamId 出现（open 帧到达）。 */
  async waitStream(streamId: string, timeoutMs = 2000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (!this.streams.has(streamId)) {
      if (Date.now() > deadline) throw new Error(`mock mux: stream ${streamId} never opened`)
      await new Promise((r) => setTimeout(r, 10))
    }
  }

  /** 等待任意一条流打开（返回其 streamId）。 */
  async waitAnyStream(timeoutMs = 2000): Promise<string> {
    const deadline = Date.now() + timeoutMs
    while (this.streams.size === 0) {
      if (Date.now() > deadline) throw new Error('mock mux: no stream opened')
      await new Promise((r) => setTimeout(r, 10))
    }
    return this.streams.keys().next().value as string
  }
}

/** 把 open/final 事件排进 handler（晚到者会收到同步重放，先后顺序可断）。 */
function collect(): { frames: ControlStreamFrame[]; add: (f: ControlStreamFrame) => void } {
  const frames: ControlStreamFrame[] = []
  return { frames, add: (f) => frames.push(f) }
}

const silence: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Logger

let mux: MockMuxServer
let origin: string

test.before(async () => {
  mux = new MockMuxServer()
  const port = await mux.listen()
  origin = `http://127.0.0.1:${port}`
})

test.after(async () => {
  await mux.close()
})

test('control 流：早订阅者收到 baseline + 增量；晚订阅者收到合成 baseline 重放', async () => {
  const first = collect()
  const second = collect()
  const sub1 = subscribeControlStream(origin, silence, first.add)
  try {
    // 等第一条逻辑流打开，服务端推 baseline + queue 增量（模拟「排队中又来了新消息」）。
    const earlyId = await mux.waitAnyStream()
    mux.push(earlyId, { type: 'baseline', value: { queues: { s1: [{ id: 'q1', placement: 'queued', text: 'a' }] } } })
    mux.push(earlyId, { type: 'queue', sessionId: 's1', items: [{ id: 'q1', placement: 'queued', text: 'a' }, { id: 'q2', placement: 'queued', text: 'b' }] })
    // 早订阅者必收这两帧（轮询等帧数）。
    const deadline = Date.now() + 2000
    while (first.frames.length < 2 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10))
    }
    assert.equal(first.frames.length, 2)

    // 晚订阅者（ChatSessionController 重建）：应立即同步收到合成 baseline。
    const sub2 = subscribeControlStream(origin, silence, second.add)
    try {
      assert.equal(second.frames.length, 1)
      const replayed = second.frames[0]
      assert.equal(replayed.type, 'baseline')
      const value = (replayed as Extract<ControlStreamFrame, { type: 'baseline' }>).value
      assert.deepEqual(value.queues, {
        s1: [
          { id: 'q1', placement: 'queued', text: 'a' },
          { id: 'q2', placement: 'queued', text: 'b' },
        ],
      })

      // 后续增量仍广播给两个订阅者（重放不夺走增量通道）。
      mux.push(earlyId, { type: 'queue', sessionId: 's1', items: [{ id: 'q3', placement: 'queued', text: 'c' }] })
      const d2 = Date.now() + 2000
      while ((first.frames.length < 3 || second.frames.length < 2) && Date.now() < d2) {
        await new Promise((r) => setTimeout(r, 10))
      }
      assert.equal(first.frames.length, 3)
      assert.equal(second.frames.length, 2)
      assert.deepEqual(second.frames[1], { type: 'queue', sessionId: 's1', items: [{ id: 'q3', placement: 'queued', text: 'c' }] })
    } finally {
      sub2.dispose()
    }
  } finally {
    sub1.dispose()
  }
})

test('control 流：晚订阅者注册时无已知状态则收到空的（不误报）', async () => {
  // 独立 origin：这个单例还没有任何帧，晚订阅者不该收到重放（不推空 baseline）。
  const mux2 = new MockMuxServer()
  const port2 = await mux2.listen()
  const origin2 = `http://127.0.0.1:${port2}`
  try {
    const first = collect()
    const sub1 = subscribeControlStream(origin2, silence, first.add)
    try {
      const earlyId = await mux2.waitAnyStream()
      // 服务端还没推 baseline，晚订阅者加入——快照为空，不重放。
      const second = collect()
      const sub2 = subscribeControlStream(origin2, silence, second.add)
      try {
        assert.equal(second.frames.length, 0)
        // 随后的 baseline 仍广播给两个。
        mux2.push(earlyId, { type: 'baseline', value: { queues: { s1: [] } } })
        const deadline = Date.now() + 2000
        while ((first.frames.length < 1 || second.frames.length < 1) && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 10))
        }
        assert.equal(first.frames.length, 1)
        assert.equal(second.frames.length, 1)
      } finally {
        sub2.dispose()
      }
    } finally {
      sub1.dispose()
    }
  } finally {
    await mux2.close()
  }
})
