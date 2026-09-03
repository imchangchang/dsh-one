/**
 * 测试用的最小 WebSocket 客户端：用 node:net 原生握手 + 组帧/解帧，
 * 独立于 server.ts 的实现，验证 mock dsh 的 RFC6455 服务端行为。
 * 只处理单帧（FIN=1）+ 客户端掩码 + 服务端不掩码，与 mock 的简化边界对齐。
 */
import * as net from 'node:net'
import * as crypto from 'node:crypto'

/** RFC6455 必需的 GUID。 */
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

/** 构造一帧（可带客户端掩码）。 */
export function buildFrame(opcode: number, payload: Buffer, masked: boolean): Buffer {
  const len = payload.length
  let header: Buffer
  if (len < 126) {
    header = Buffer.alloc(masked ? 6 : 2)
    header[0] = 0x80 | opcode
    header[1] = (masked ? 0x80 : 0) | len
  } else if (len < 65536) {
    header = Buffer.alloc(masked ? 8 : 4)
    header[0] = 0x80 | opcode
    header[1] = (masked ? 0x80 : 0) | 126
    header.writeUInt16BE(len, 2)
  } else {
    header = Buffer.alloc(masked ? 16 : 10)
    header[0] = 0x80 | opcode
    header[1] = (masked ? 0x80 : 0) | 127
    header.writeBigUInt64BE(BigInt(len), 2)
  }
  if (!masked) return Buffer.concat([header, payload])
  const key = crypto.randomBytes(4)
  const off = header.length - 4
  key.copy(header, off)
  const out = Buffer.allocUnsafe(len)
  for (let i = 0; i < len; i++) out[i] = payload[i] ^ key[i & 3]
  return Buffer.concat([header, out])
}

interface ParsedFrame {
  opcode: number
  payload: Buffer
}

/** 从缓冲剥出一帧（服务端帧不掩码；顺带兼容客户端掩码帧）。 */
export function parseFrame(buffer: Buffer): { frame: ParsedFrame; consumed: number } | null {
  if (buffer.length < 2) return null
  const b0 = buffer[0]
  const b1 = buffer[1]
  const opcode = b0 & 0x0f
  const masked = (b1 & 0x80) !== 0
  let len = b1 & 0x7f
  let offset = 2
  if (len === 126) {
    if (buffer.length < 4) return null
    len = buffer.readUInt16BE(2)
    offset = 4
  } else if (len === 127) {
    if (buffer.length < 10) return null
    len = Number(buffer.readBigUInt64BE(2))
    offset = 10
  }
  const maskLen = masked ? 4 : 0
  const total = offset + maskLen + len
  if (buffer.length < total) return null
  let payload = buffer.subarray(offset + maskLen, total)
  if (masked) {
    const key = buffer.subarray(offset, offset + 4)
    const out = Buffer.allocUnsafe(len)
    for (let i = 0; i < len; i++) out[i] = payload[i] ^ key[i & 3]
    payload = out
  }
  return { frame: { opcode, payload }, consumed: total }
}

interface HandshakeResult {
  status: number
  headers: Record<string, string>
  key: string
  accept: string
}

/** 一次原生 WS 升级 + 后续帧收发。 */
export class RawWsClient {
  private socket: net.Socket = null as unknown as net.Socket
  private buffer = Buffer.alloc(0)
  private queue: ParsedFrame[] = []
  private waiters: Array<(frame: ParsedFrame) => void> = []
  private closed = false
  handshook = false
  private readonly handshakeBuf: Buffer[] = []

  /** 发起握手。`connect` 返回的 accept 需与 wsAccept(key) 一致。 */
  async connect(port: number, path: string): Promise<HandshakeResult> {
    const key = crypto.randomBytes(16).toString('base64')
    const result = await new Promise<HandshakeResult>((resolve, reject) => {
      const socket = net.connect(port, '127.0.0.1')
      this.socket = socket
      let settled = false
      socket.on('data', (chunk: Buffer) => {
        if (!this.handshook) {
          // 握手阶段：累积到头部，找到 \r\n\r\n 即完成；剩余字节交给帧解析。
          this.handshakeBuf.push(chunk as Buffer)
          const acc = Buffer.concat(this.handshakeBuf)
          const idx = acc.indexOf('\r\n\r\n')
          if (idx === -1) return
          this.handshook = true
          settled = true
          const head = acc.subarray(0, idx).toString('utf8')
          const rest = acc.subarray(idx + 4)
          const lines = head.split('\r\n')
          const status = Number(lines[0].split(' ')[1])
          const headers: Record<string, string> = {}
          for (const line of lines.slice(1)) {
            const m = /^([^:]+):\s*(.*)$/.exec(line)
            if (m) headers[m[1].toLowerCase()] = m[2]
          }
          resolve({ status, headers, key, accept: headers['sec-websocket-accept'] ?? '' })
          if (rest.length > 0) this.onData(rest)
          return
        }
        this.onData(chunk as Buffer)
      })
      socket.on('error', reject)
      socket.on('close', () => {
        this.closed = true
        if (!settled) reject(new Error('socket closed before handshake'))
        for (const w of this.waiters) w({ opcode: 0x8, payload: Buffer.alloc(0) })
        this.waiters = []
      })
      socket.write(
        `GET ${path} HTTP/1.1\r\n` +
          `Host: 127.0.0.1:${port}\r\n` +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          `Sec-WebSocket-Key: ${key}\r\n` +
          'Sec-WebSocket-Version: 13\r\n\r\n',
      )
    })
    return result
  }

  sendFrame(opcode: number, payload: Buffer, masked = true): void {
    if (this.closed) return
    this.socket.write(buildFrame(opcode, payload, masked))
  }

  sendText(text: string, masked = true): void {
    this.sendFrame(0x1, Buffer.from(text, 'utf8'), masked)
  }

  sendPing(payload: Buffer, masked = true): void {
    this.sendFrame(0x9, payload, masked)
  }

  /** 读下一帧（阻塞直至有完整帧或连接关闭）。 */
  readFrame(): Promise<ParsedFrame> {
    if (this.queue.length > 0) return Promise.resolve(this.queue.shift() as ParsedFrame)
    return new Promise((resolve) => this.waiters.push(resolve))
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    for (;;) {
      const parsed = parseFrame(this.buffer)
      if (!parsed) return
      this.buffer = this.buffer.subarray(parsed.consumed)
      const frame = parsed.frame
      if (this.waiters.length > 0) {
        const w = this.waiters.shift() as (frame: ParsedFrame) => void
        w(frame)
      } else {
        this.queue.push(frame)
      }
    }
  }

  close(): void {
    if (this.closed) return
    this.sendFrame(0x8, Buffer.alloc(0), true)
    this.socket.end()
  }
}

/** 预期的 Sec-WebSocket-Accept（与 mock 同算法）。 */
export function expectWsAccept(key: string): string {
  return crypto.createHash('sha1').update(key + WS_GUID).digest('base64')
}
