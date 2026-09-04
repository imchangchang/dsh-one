/**
 * mock dsh Gateway：零依赖，全程用 node:http / node:crypto / node:net。
 *
 * 目的：让 dsh-one 扩展把它当真正的 dsh 后端接管，按 test/mock-dsh/scenario.ts
 * 的场景编排出一套确定性的 UI 状态（正常对话、approval/question、todos、子代理、
 * 错误态、流式回复…），用于测试与宣传截图。
 *
 * 协议面（对照扩展的消费端逐项实现，见 src/server/dshRpc.ts 的调用点）：
 * - POST /api/<method>：`{"type":"client-request","rpcId","method","payload"}`，
 *   回包必须 echo rpcId：`{"rpcId","result":{"ok":true,"value"}}` 或 ok:false。
 *   扩展的 host.describe 探测只校验 rpcId echo（src/pure/envelope.ts），所以
 *   mock 只要把 describe 验过，扩展就认定「这是 dsh」并 adopt，无需假可执行文件。
 * - POST /api/respond：`{"type":"client-response","rpcId","result":{"ok":true,"value"}}`，
 *   回包 `{"accepted":true}`（扩展检查 body.accepted===true）。只接受曾在
 *   approval/question 帧里下发过的 rpcId（与应答对上）。应答成功即移除该
 *   pending 状态并广播 *-resolved 帧（对齐真实 dsh）。
 * - GET /api/session.export?sessionId=...&includeDescendants=true：任意字节
 *   （扩展原样存文件）。
 * - WS /api/events.host + /api/events.mux：最小 RFC6455 服务端。
 *
 * 简化边界（注释即验收口径）：
 * - WS 只处理单帧、FIN=1、无分片（extension 的客户端只发/收小帧，测试也如此）；
 *   控制帧（close/ping/pong）要求 payload ≤125 字节（RFC 硬性要求）。
 * - 客户端→服务端一律带 mask（RFC 要求），服务端→客户端不掩码。mock 对收到的
 *   文本帧原样回显（方便「文本帧收发」测试），真实 dsh 不会这么做。
 * - 除 /api/respond、/api/session.export、/api/events.* 外的 /api/* 都按 RPC 处理。
 *
 * 运行方式：
 *   node test/mock-dsh/server.ts            # 默认场景 + 端口 3080
 *   node test/mock-dsh/server.ts --port 3080 # 指定端口（自定义场景见 scenario.ts）
 */
import * as http from 'node:http'
import * as crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import type { Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import {
  defaultScenario,
  defaultPresets,
  type MockScenario,
  type ScopedSession,
  type MuxFrameSpec,
} from './scenario.ts'
import type { AgentPresetLike } from '../../src/pure/agentPreset.ts'
import type { HistoryEntryLike } from '../../src/pure/conversation.ts'
import type { WorkspaceView, SessionSummary } from '../../src/server/dshRpc.ts'

// ---------------------------------------------------------------------------
// WebSocket frame 编解码（最小 RFC6455 子集）
// ---------------------------------------------------------------------------

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

/** 计算 Sec-WebSocket-Accept：sha1(key + GUID) base64。 */
export function wsAccept(key: string): string {
  return crypto.createHash('sha1').update(key + WS_GUID).digest('base64')
}

/** 服务端→客户端帧：不掩码。 */
export function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const fin = 0x80
  const len = payload.length
  let header: Buffer
  if (len < 126) {
    header = Buffer.from([fin | opcode, len])
  } else if (len < 65536) {
    header = Buffer.alloc(4)
    header[0] = fin | opcode
    header[1] = 126
    header.writeUInt16BE(len, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = fin | opcode
    header[1] = 127
    header.writeBigUInt64BE(BigInt(len), 2)
  }
  return Buffer.concat([header, payload])
}

export interface DecodedFrame {
  fin: boolean
  opcode: number
  payload: Buffer
}

/**
 * 从缓冲解析最前面的一帧；不满一帧返回 null（等后续数据块）。
 * 只处理单帧 + FIN + 掩码位，不处理分片（continuation）——简化边界见文件头注释。
 */
export function decodeFrame(buffer: Buffer): { frame: DecodedFrame; consumed: number } | null {
  if (buffer.length < 2) return null
  const b0 = buffer[0]
  const b1 = buffer[1]
  const fin = (b0 & 0x80) !== 0
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
    const big = buffer.readBigUInt64BE(2)
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('frame payload too large')
    len = Number(big)
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
  return { frame: { fin, opcode, payload }, consumed: total }
}

// ---------------------------------------------------------------------------
// 单条 WebSocket 连接
// ---------------------------------------------------------------------------

type WsChannel = 'mux' | 'host'

class WsConnection {
  private buffer = Buffer.alloc(0)
  private closed = false
  /** 连接关闭回调（网关用它把连接从集合里移除）。 */
  onClose?: () => void
  private readonly socket: Socket
  readonly channel: WsChannel
  private readonly onFrame: (opcode: number, payload: Buffer) => void

  constructor(socket: Socket, channel: WsChannel, onFrame: (opcode: number, payload: Buffer) => void) {
    this.socket = socket
    this.channel = channel
    this.onFrame = onFrame
    socket.on('data', (chunk) => this.onData(chunk))
    socket.on('close', () => {
      this.closed = true
      this.onClose?.()
    })
    socket.on('error', () => {
      // 客户端断连等错误：交给 close 收尾，不抛。
    })
  }

  /** 写入 `head`（upgrade 事件带来的残余字节）作为首帧数据。 */
  feedHead(head: Buffer): void {
    if (head.length > 0) this.onData(head)
  }

  sendText(text: string): void {
    this.sendFrame(0x1, Buffer.from(text, 'utf8'))
  }

  sendFrame(opcode: number, payload: Buffer): void {
    if (this.closed) return
    this.socket.write(encodeFrame(opcode, payload))
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.sendFrame(0x8, Buffer.alloc(0))
    this.socket.end()
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    // 循环剥出缓冲里所有完整帧；残留不满一帧的等下一个数据块。
    for (;;) {
      const parsed = decodeFrame(this.buffer)
      if (!parsed) return
      this.buffer = this.buffer.subarray(parsed.consumed)
      this.handleFrame(parsed.frame)
    }
  }

  private handleFrame(frame: DecodedFrame): void {
    switch (frame.opcode) {
      case 0x9: // ping → pong
        this.sendFrame(0xa, frame.payload)
        return
      case 0xa: // pong：忽略
        return
      case 0x8: // close：回 close 再断
        this.close()
        return
      case 0x1: // text
      case 0x2: // binary（mock 只关心文本，二进制原样转发回显）
        // 原样回显，方便测试验证「文本帧收发」。
        this.sendFrame(frame.opcode, frame.payload)
        this.onFrame(frame.opcode, frame.payload)
        return
      default:
        // 其它 opcode（分片 continuation 等）不在 mock 支持范围。
        return
    }
  }
}

// ---------------------------------------------------------------------------
// RPC value 的接口镜射（对照 dshRpc.ts 调用点）
// ---------------------------------------------------------------------------

interface SessionModelsValue {
  current: { provider: string; model: string; reasoningEffort?: string }
  routable: boolean
  groups: Array<{ id: string; name: string; models: Array<{ id: string; name: string; description?: string; reasoning?: { efforts: Array<{ id: string; name: string; description?: string }>; defaultEffort?: string } }> }>
  failures: Array<{ id: string; name: string; message: string }>
}

// ---------------------------------------------------------------------------
// 网关核心
// ---------------------------------------------------------------------------

class Gateway {
  private readonly muxSockets = new Set<WsConnection>()
  private readonly hostSockets = new Set<WsConnection>()
  private readonly workspaces = new Map<string, WorkspaceView>()
  private readonly sessions = new Map<string, ScopedSession>()
  private readonly seqBySession = new Map<string, number>()
  private readonly turnBySession = new Map<string, number>()
  private readonly archived = new Set<string>()
  private readonly pendingRpcIds = new Set<string>()
  /** 每个会话的「未应答服务器请求」：状态化 pending（对齐真实 dsh——应答前一直存在、
   *  rpcId 稳定、任何连接进来都带；应答后移除并推 resolved 帧）。 */
  private readonly pendingBySession = new Map<string, Array<{ rpcId: string; method: string; payload: Record<string, unknown> }>>()
  /** 每个会话的 onPrompt 是否已被消费（一次性，见 session.prompt case）。 */
  private readonly promptUsed = new Set<string>()
  /** 每个会话待取消的定时器（session.cancel 清掉）。 */
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>[]>()
  private readonly presets: AgentPresetLike[]
  private readonly defaultModels: SessionModelsValue
  private readonly goalRoster = new Map<string, { id: string; revision: number; objective: string; phase: 'active' | 'paused' | 'blocked' | 'complete'; maxGoalRounds: number }>()
  private renameSeq = 0
  private readonly scenario: MockScenario

  constructor(scenario: MockScenario) {
    this.scenario = scenario
    this.presets = scenario.presets ?? defaultPresets()
    this.defaultModels = {
      current: { provider: 'deepseek', model: 'deepseek-v4-flash' },
      routable: true,
      groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' }] }],
      failures: [],
    }
    for (const w of scenario.workspaces) this.workspaces.set(w.workspaceId, { ...w })
    for (const s of scenario.sessions) this.registerSession(s)
  }

  private registerSession(s: ScopedSession): void {
    this.sessions.set(s.sessionId, s)
    const maxSeq = (s.history ?? []).reduce((m, h) => Math.max(m, h.event.seq), 0)
    this.seqBySession.set(s.sessionId, maxSeq)
    let maxTurn = 0
    for (const h of s.history ?? []) {
      if (h.event.type === 'turn/start') {
        const turn = (h.event.data as { turn?: unknown } | undefined)?.turn
        if (typeof turn === 'number' && Number.isFinite(turn)) maxTurn = Math.max(maxTurn, turn)
      }
    }
    this.turnBySession.set(s.sessionId, maxTurn)
    // pending 状态入册：rpcId 在注册时确定一次（payload 给了就沿用，否则随机），
    // 之后跨连接稳定——直到 /api/respond 应答才移除。
    const pendings: Array<{ rpcId: string; method: string; payload: Record<string, unknown> }> = []
    for (const req of s.pendingRequests ?? []) {
      const rpcId = typeof req.payload.rpcId === 'string' ? req.payload.rpcId : crypto.randomUUID()
      const { rpcId: _keep, ...rest } = req.payload
      void _keep
      pendings.push({ rpcId, method: req.method, payload: rest })
      this.pendingRpcIds.add(rpcId)
    }
    if (pendings.length > 0) this.pendingBySession.set(s.sessionId, pendings)
  }

  private nextSeq(sessionId: string): number {
    const next = (this.seqBySession.get(sessionId) ?? 0) + 1
    this.seqBySession.set(sessionId, next)
    return next
  }

  private nextTurn(sessionId: string): number {
    const next = (this.turnBySession.get(sessionId) ?? 0) + 1
    this.turnBySession.set(sessionId, next)
    return next
  }

  // ----- WebSocket 通道 -----

  /** 'upgrade' 事件：接受 /api/events.mux 与 /api/events.host，其余拒绝。 */
  private acceptUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = req.url ?? ''
    const channel: WsChannel | null = url.startsWith('/api/events.mux')
      ? 'mux'
      : url.startsWith('/api/events.host')
        ? 'host'
        : null
    if (channel === null) {
      socket.destroy()
      return
    }
    const key = req.headers['sec-websocket-key']
    if (typeof key !== 'string' || key === '') {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
      socket.destroy()
      return
    }
    const accept = wsAccept(key)
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n` +
        '\r\n',
    )
    const conn = new WsConnection(socket as Socket, channel, () => {
      // 客户端帧在 mock 里原样回显（WsConnection 已回显），网关不必再处理。
    })
    conn.onClose = () => (channel === 'mux' ? this.muxSockets.delete(conn) : this.hostSockets.delete(conn))
    conn.feedHead(head)
    if (channel === 'mux') this.onMuxConnect(conn)
    else this.onHostConnect(conn)
  }

  private onMuxConnect(conn: WsConnection): void {
    this.muxSockets.add(conn)
    // 订阅基线：补发每个已注册会话的 session/subscribed（lastSeq 带 gap 检查信息）。
    // 扩展侧的每个消费者（chatSession/jobsStore/sessionsStore）各有一条独立 WS，
    // 按 payload.sessionId 过滤帧；补发全部会话的基线没有副作用。
    for (const sessionId of this.sessions.keys()) {
      this.pushMux({ method: 'session/subscribed', payload: { sessionId, lastSeq: this.seqBySession.get(sessionId) ?? 0 } })
    }
    // 状态重放：把尚未应答的服务器请求（approval/question）随每个新连接重新下发。
    // 这是真实 dsh 的行为——pending 是会话状态不是一次性事件，扩展的消费者按
    // sessionId 过滤，只有对应会话的 chatSession 会折叠进 pending 面板。
    for (const [sessionId, pendings] of this.pendingBySession) {
      for (const p of pendings) {
        this.pushMux({ method: p.method, payload: { ...p.payload, sessionId }, rpcId: p.rpcId })
      }
    }
  }

  private onHostConnect(conn: WsConnection): void {
    this.hostSockets.add(conn)
  }

  // ----- 下行推送 -----

  private pushMux(frame: { method: string; payload: Record<string, unknown>; rpcId?: string }): void {
    const wire = JSON.stringify({ type: 'server-request', ...(frame.rpcId ? { rpcId: frame.rpcId } : {}), method: frame.method, payload: frame.payload })
    for (const c of this.muxSockets) c.sendText(wire)
  }

  private pushHost(method: string, payload: Record<string, unknown>): void {
    const wire = JSON.stringify({ method, payload })
    for (const c of this.hostSockets) c.sendText(wire)
  }

  // ----- 帧编排 -----

  /**
   * 推一序列会话帧：逐帧等待 delayMs（可选），注入 sessionId，保证
   * session/event 的 seq 单调递增（场景给了显式 seq 则沿用并推进游标）。
   * approval/question 帧自动分配并登记 rpcId（/api/respond 只能答这些）。
   * 定时器按会话登记，session.cancel 会清掉（onPrompt 帧同样可取消）。
   */
  private async scheduleSessionFrames(sessionId: string, steps: readonly MuxFrameSpec[]): Promise<void> {
    const timers: Array<ReturnType<typeof setTimeout>> = []
    this.timers.set(sessionId, timers)
    for (const step of steps) {
      if (step.delayMs && step.delayMs > 0) {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, step.delayMs as number)
          timers.push(t)
        })
      }
      const payload: Record<string, unknown> = { ...step.payload, sessionId }
      let rpcId: string | undefined
      if (step.method === 'approval/requested' || step.method === 'question/requested') {
        const existing = typeof step.payload.rpcId === 'string' ? step.payload.rpcId : undefined
        rpcId = existing ?? crypto.randomUUID()
        payload.rpcId = rpcId
        this.pendingRpcIds.add(rpcId)
      }
      if (step.method === 'session/event') {
        const event = (payload.event ?? {}) as Record<string, unknown>
        if (typeof event.seq !== 'number') event.seq = this.nextSeq(sessionId)
        else this.seqBySession.set(sessionId, Math.max(this.seqBySession.get(sessionId) ?? 0, event.seq as number))
        payload.event = event
      }
      this.pushMux({ method: step.method, payload, rpcId })
    }
    this.timers.delete(sessionId)
  }

  /** mock 默认 prompt 流：回显用户消息 + 一小段流式回复（场景未给 onPrompt 时兜底）。 */
  private defaultPromptTimeline(sessionId: string, promptText: string): MuxFrameSpec[] {
    const turn = this.nextTurn(sessionId)
    const steps: MuxFrameSpec[] = [
      { method: 'session/event', payload: { event: { type: 'user/message', data: { id: `user-${turn}`, content: [{ type: 'text', text: promptText }] } } } },
      { method: 'session/event', payload: { event: { type: 'turn/start', data: { turn } } } },
      { method: 'session/event', payload: { event: { type: 'step/start', data: { turn, step: 1 } } } },
      { method: 'session/event', payload: { event: { type: 'assistant/chunk', data: { turn, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'text' } } } } },
      { method: 'session/event', payload: { event: { type: 'assistant/chunk', data: { turn, step: 1, chunk: { type: 'text-delta', index: 0, text: '收到你的请求：' } } } } },
      { method: 'session/event', payload: { event: { type: 'assistant/chunk', data: { turn, step: 1, chunk: { type: 'text-delta', index: 0, text: `${promptText}` } } } } },
      { method: 'session/event', payload: { event: { type: 'assistant/chunk', data: { turn, step: 1, chunk: { type: 'text-delta', index: 0, text: '。这是一个 mock 回复。' } } } } },
    ]
    const fullText = `收到你的请求：${promptText}。这是一个 mock 回复。`
    steps.push(
      { method: 'session/event', payload: { event: { type: 'assistant/chunk', data: { turn, step: 1, chunk: { type: 'block-end', index: 0, block: { type: 'text', text: fullText } } } } } },
      { method: 'session/event', payload: { event: { type: 'assistant/message', data: { turn, step: 1, message: { id: `msg-${turn}`, content: [{ type: 'text', text: fullText }] }, usage: { outputTokens: 40 } } } } },
      { method: 'session/event', payload: { event: { type: 'turn/end', data: { turn, reason: { kind: 'stop' } } } } },
    )
    return steps
  }

  private promptTextOf(content: unknown): string {
    if (!Array.isArray(content)) return ''
    return content
      .filter((b): b is { type: string; text?: unknown } => typeof b === 'object' && b !== null && (b as { type?: unknown }).type === 'text')
      .map((b) => (typeof b.text === 'string' ? b.text : ''))
      .join('\n')
  }

  // ----- RPC dispatch -----

  private async dispatch(method: string, payload: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'host.describe':
        return { name: 'mock-dsh', version: '0.0.0', api: 'gateway' }

      case 'workspace.list':
        return { items: [...this.workspaces.values()], archivedSessionIds: [...this.archived] }

      case 'session.list': {
        const items = [...this.sessions.values()].map((s) => this.sessionSummaryOf(s))
        return { items }
      }

      case 'workspace.create': {
        const path = typeof payload.path === 'string' ? payload.path : `/repo/${crypto.randomUUID().slice(0, 6)}`
        const existing = [...this.workspaces.values()].find((w) => w.path === path)
        if (existing) return { workspace: existing, created: false }
        const workspace: WorkspaceView = {
          workspaceId: `ws-${crypto.randomUUID().slice(0, 8)}`,
          path,
          title: path.split('/').filter(Boolean).pop() ?? path,
          sessionIds: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        this.workspaces.set(workspace.workspaceId, workspace)
        this.pushHost('host/workspace-changed', { workspace })
        return { workspace, created: true }
      }

      case 'workspace.delete': {
        const workspaceId = typeof payload.workspaceId === 'string' ? payload.workspaceId : ''
        if (this.workspaces.delete(workspaceId)) {
          this.pushHost('host/workspace-removed', { workspaceId })
          this.pushHost('host/workspace-order-changed', { workspaceIds: [...this.workspaces.keys()] })
        }
        return { ok: true }
      }

      case 'workspace.archiveSession': {
        const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : ''
        this.archived.add(sessionId)
        this.pushHost('host/archived-sessions-changed', { archivedSessionIds: [...this.archived] })
        return { archivedSessionIds: [...this.archived] }
      }

      case 'session.create': {
        const sessionId = typeof payload.sessionId === 'string' && payload.sessionId
          ? payload.sessionId
          : `s-${crypto.randomUUID().slice(0, 12)}`
        const workspaceId = typeof payload.workspaceId === 'string' ? payload.workspaceId : undefined
        const cwd = typeof payload.cwd === 'string' ? payload.cwd : undefined
        const s: ScopedSession = { sessionId, history: [], projections: { asOfSeq: 0, values: {} } }
        this.registerSession(s)
        this.pushHost('host/session-added', { sessionId, blank: true, ...(cwd ? { origin: undefined } : {}), agentPreset: undefined })
        if (workspaceId) this.attachSessionToWorkspace(workspaceId, sessionId)
        return { sessionId }
      }

      case 'session.rename': {
        const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : ''
        const title = typeof payload.title === 'string' ? payload.title : ''
        const s = this.sessions.get(sessionId)
        const seq = ++this.renameSeq
        if (s) {
          const values = { ...(s.projections?.values ?? {}), title }
          s.projections = { asOfSeq: seq, values }
          if (s.summary) s.summary.projections = { asOfSeq: seq, values }
        }
        return { title, seq }
      }

      case 'session.history': {
        const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : ''
        const beforeSeq = typeof payload.beforeSeq === 'number' ? payload.beforeSeq : undefined
        const maxMessages = typeof payload.maxMessages === 'number' ? payload.maxMessages : 50
        const history = this.sessions.get(sessionId)?.history ?? []
        if (beforeSeq === undefined) {
          return { events: history, hasMore: false, projections: this.sessions.get(sessionId)?.projections }
        }
        const earlier = history.filter((h) => h.event.seq < beforeSeq)
        const page = earlier.slice(-maxMessages)
        return { events: page, hasMore: earlier.length > page.length }
      }

      case 'session.prompt': {
        const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : ''
        const text = this.promptTextOf(payload.content)
        const s = this.sessions.get(sessionId)
        // onPrompt 是一次性的（它的显式 seq 只在首个 prompt 序列里单调）；之后再
        // prompt 走默认流，保证 seq 始终递增。这符合 mock 做确定性截图的用法。
        const once = this.promptUsed.has(sessionId)
        this.promptUsed.add(sessionId)
        const steps = !once && s?.onPrompt?.length ? s.onPrompt : this.defaultPromptTimeline(sessionId, text)
        void this.scheduleSessionFrames(sessionId, steps)
        return { accepted: true }
      }

      case 'session.cancel': {
        const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : ''
        this.cancelScheduled(sessionId)
        return { ok: true }
      }

      case 'session.updateQueue':
        return this.updateQueue(payload)

      case 'session.models': {
        const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : ''
        return this.sessions.get(sessionId)?.models ?? this.defaultModels
      }

      case 'session.selectModel': {
        const selected: SessionModelsValue['current'] = {
          provider: typeof payload.provider === 'string' ? payload.provider : 'deepseek',
          model: typeof payload.model === 'string' ? payload.model : 'deepseek-v4-flash',
          ...(typeof payload.reasoningEffort === 'string' ? { reasoningEffort: payload.reasoningEffort } : {}),
        }
        // 尽量落到某个会话的 models.current（至少让 footer pill 反映新选择）。
        const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : ''
        const s = this.sessions.get(sessionId)
        if (s?.models) s.models.current = selected
        return { selected }
      }

      case 'session.search':
        return { items: [], hasMore: false }

      case 'session.attachment': {
        const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : ''
        void sessionId
        return { attachment: { mediaType: 'image/png' }, data: '' }
      }

      case 'session.fork': {
        const parentSessionId = typeof payload.sessionId === 'string' ? payload.sessionId : ''
        const childId = `s-${crypto.randomUUID().slice(0, 12)}`
        const s: ScopedSession = {
          sessionId: childId,
          summary: { sessionId: childId, parentSessionId, blank: true },
          history: [],
          projections: { asOfSeq: 0, values: {} },
        }
        this.registerSession(s)
        this.pushHost('host/session-added', { sessionId: childId, blank: true, parentSessionId })
        return { sessionId: childId }
      }

      case 'agentPreset.list':
        return { presets: this.presets }

      case 'subagent.list':
        return { entries: [], parentAvailable: true }

      case 'messageFeedback/list':
        return { ok: true, value: { items: [] } }

      case 'messageFeedback/put':
        return { ok: true, value: {} }

      case 'messageFeedback/delete':
        return { ok: true, value: {} }

      case 'fileReferences/list':
        return []

      case 'commands/execute': {
        const line = ((payload.args as { line?: unknown } | undefined)?.line as string | undefined) ?? ''
        return { commandId: `cmd-${crypto.randomUUID().slice(0, 8)}`, result: { kind: 'success', text: `mock 已受理命令：${line}` } }
      }

      case 'goals/pause':
        return this.mutateGoal(payload, 'paused')

      case 'goals/resume':
        return this.mutateGoal(payload, 'active')

      case 'goals/edit': {
        const newObjective = (payload.args as { request?: { objective?: unknown } } | undefined)?.request?.objective
        return this.mutateGoal(payload, undefined, typeof newObjective === 'string' ? newObjective : undefined)
      }

      case 'goals/clear':
        return this.clearGoal(payload)

      default:
        throw new Error(`mock dsh 未实现的方法：${method}`)
    }
  }

  private sessionSummaryOf(s: ScopedSession): SessionSummary {
    const now = Date.now()
    const base = s.summary ?? {}
    return {
      sessionId: s.sessionId,
      updatedAt: typeof base.updatedAt === 'number' ? base.updatedAt : now,
      running: base.running ?? false,
      blank: base.blank ?? false,
      ...(base.parentSessionId !== undefined ? { parentSessionId: base.parentSessionId } : {}),
      ...(base.origin !== undefined ? { origin: base.origin } : {}),
      ...(base.cwd !== undefined ? { cwd: base.cwd } : {}),
      ...(base.agentPreset !== undefined ? { agentPreset: base.agentPreset } : {}),
      ...(s.projections ? { projections: s.projections } : {}),
    }
  }

  private attachSessionToWorkspace(workspaceId: string, sessionId: string): void {
    const w = this.workspaces.get(workspaceId)
    if (!w) return
    w.sessionIds = [...w.sessionIds, sessionId]
    w.updatedAt = new Date().toISOString()
    this.pushHost('host/workspace-changed', { workspace: w })
  }

  private async updateQueue(payload: Record<string, unknown>): Promise<unknown> {
    const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : ''
    const itemId = typeof payload.itemId === 'string' ? payload.itemId : ''
    const action = (payload.action ?? {}) as { kind?: string; content?: unknown }
    // 简化：mock 只维护「未 claim 的排队项」为就地改/删；无持久队列时忽略。
    if (action.kind === 'remove' || action.kind === 'edit' || action.kind === 'steer') {
      void itemId
      void action.content
    }
    void sessionId
    return { ok: true }
  }

  // ----- goals/* -----

  private goalOf(sessionId: string): { id: string; revision: number; objective: string; phase: 'active' | 'paused' | 'blocked' | 'complete'; maxGoalRounds: number } {
    let g = this.goalRoster.get(sessionId)
    const projection = this.sessions.get(sessionId)?.projections?.values.goal as { goal?: unknown; phase?: unknown } | undefined
    const inner = projection?.goal as Record<string, unknown> | undefined
    if (!g && typeof inner === 'object' && inner && typeof inner.id === 'string') {
      g = {
        id: inner.id as string,
        revision: typeof inner.revision === 'number' ? inner.revision : 1,
        objective: typeof inner.objective === 'string' ? inner.objective : '',
        phase: (['active', 'paused', 'blocked', 'complete'] as const).includes(inner.phase as 'active')
          ? (inner.phase as 'active' | 'paused' | 'blocked' | 'complete')
          : 'active',
        maxGoalRounds: typeof inner.maxGoalRounds === 'number' ? inner.maxGoalRounds : 1,
      }
    }
    if (!g) g = { id: 'goal-1', revision: 1, objective: '演示目标', phase: 'active', maxGoalRounds: 5 }
    return g
  }

  private mutateGoal(
    payload: Record<string, unknown>,
    phase: 'active' | 'paused' | 'blocked' | 'complete' | undefined,
    objective?: string,
  ): unknown {
    const args = (payload.args ?? {}) as { agentId?: unknown; ref?: unknown; request?: unknown }
    const sessionId = typeof args.agentId === 'string' ? args.agentId : ''
    const g = this.goalOf(sessionId)
    if (phase) g.phase = phase
    if (objective !== undefined) g.objective = objective
    g.revision += 1
    this.goalRoster.set(sessionId, { ...g })
    this.pushGoalProjection(sessionId, { goal: g, roundsStarted: 1 })
    return g
  }

  private clearGoal(payload: Record<string, unknown>): unknown {
    const args = (payload.args ?? {}) as { agentId?: unknown; ref?: unknown }
    const sessionId = typeof args.agentId === 'string' ? args.agentId : ''
    const g = this.goalOf(sessionId)
    this.pushGoalProjection(sessionId, null)
    return { id: g.id, revision: g.revision }
  }

  private pushGoalProjection(sessionId: string, value: unknown): void {
    const seq = this.nextSeq(sessionId)
    this.pushMux({ method: 'session/projection', payload: { sessionId, seq, key: 'goal', value } })
  }

  // ----- 定时器管理 -----

  private cancelScheduled(sessionId: string): void {
    const timers = this.timers.get(sessionId)
    if (timers) for (const t of timers) clearTimeout(t)
    this.timers.delete(sessionId)
  }

  // ----- HTTP 请求 -----

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = req.url ?? ''
    if (req.method === 'POST' && url === '/api/respond') {
      const body = await readJson(req)
      const rpcId = typeof body.rpcId === 'string' ? body.rpcId : ''
      if (this.pendingRpcIds.delete(rpcId)) {
        // 状态化 pending：应答成功即移除，并向各连接推 resolved 帧（扩展按
        // approvalId / questionRpcId 清 pending 面板）。
        for (const [sessionId, pendings] of this.pendingBySession) {
          const idx = pendings.findIndex((p) => p.rpcId === rpcId)
          if (idx === -1) continue
          const [entry] = pendings.splice(idx, 1)
          if (pendings.length === 0) this.pendingBySession.delete(sessionId)
          if (entry.method === 'approval/requested') {
            this.pushMux({
              method: 'approval/resolved',
              payload: { sessionId, approvalId: entry.payload.approvalId },
            })
          } else {
            this.pushMux({ method: 'question/resolved', payload: { sessionId, questionRpcId: rpcId } })
          }
          break
        }
        this.writeJson(res, 200, { accepted: true })
      } else {
        this.writeJson(res, 200, { accepted: false, reason: 'not-pending' })
      }
      return
    }
    if (req.method === 'GET' && url.startsWith('/api/session.export')) {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment' })
      res.end(Buffer.from('mock session export\n'))
      return
    }
    if (req.method === 'POST' && url.startsWith('/api/')) {
      const method = url.slice('/api/'.length)
      const body = await readJson(req)
      const rpcId = typeof body.rpcId === 'string' ? body.rpcId : ''
      try {
        const value = await this.dispatch(method, (body.payload ?? {}) as Record<string, unknown>)
        this.writeJson(res, 200, { rpcId, result: { ok: true, value } })
      } catch (error) {
        this.writeJson(res, 200, { rpcId, result: { ok: false, error: { code: 'error', message: error instanceof Error ? error.message : String(error) } } })
      }
      return
    }
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
  }

  private writeJson(res: http.ServerResponse, status: number, value: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(value))
  }

  /** 在建立的 http server 上挂载 upgrade 与 request 路由。 */
  mount(server: http.Server): void {
    server.on('upgrade', (req, socket, head) => this.acceptUpgrade(req, socket, head))
    server.on('request', (req, res) => {
      this.handleRequest(req, res).catch(() => {
        try {
          res.writeHead(500, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'internal' }))
        } catch {
          // socket 可能已断。
        }
      })
    })
    // 无效请求头（如 HTTP/0.9）直接 400，避免挂起。
    server.on('clientError', (_err, socket) => {
      try {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
      } catch {
        socket.destroy()
      }
    })
  }
}

// ---------------------------------------------------------------------------
// 公开 API：createMockServer / MockServer / 入口
// ---------------------------------------------------------------------------

/** 读取一个 JSON 请求体（单次请求即可，mock 的 body 都很小）。 */
function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c as Buffer))
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve(raw === '' ? {} : (JSON.parse(raw) as Record<string, unknown>))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

export interface MockServer {
  /** 底层 http.Server（测试可用它在另起监听前建 WS/HTTP 连接）。 */
  readonly server: http.Server
  /** 实际监听端口（listen(0) 由系统分配）。 */
  port: number
  /** http://127.0.0.1:<port> 基地址。 */
  url: string
  listen(port?: number): Promise<MockServer>
  close(): Promise<void>
}

/** 构造并（可选）启动一个 mock dsh。默认场景见 scenario.defaultScenario。 */
export function createMockServer(scenario: MockScenario = defaultScenario()): MockServer {
  const gateway = new Gateway(scenario)
  const server = http.createServer()
  gateway.mount(server)
  let activeSockets = new Set<Socket>()

  const wrap: MockServer = {
    server,
    port: 0,
    url: '',
    listen(port = 3080): Promise<MockServer> {
      return new Promise((resolve) => {
        server.listen(port, '127.0.0.1', () => {
          const address = server.address()
          const p = typeof address === 'object' && address ? address.port : port
          wrap.port = p
          wrap.url = `http://127.0.0.1:${p}`
          resolve(wrap)
        })
      })
    },
    close(): Promise<void> {
      return new Promise((resolve) => {
        for (const s of activeSockets) s.destroy()
        activeSockets = new Set()
        server.close(() => resolve())
      })
    },
  }

  server.on('connection', (socket) => {
    activeSockets.add(socket)
    socket.on('close', () => activeSockets.delete(socket))
    socket.on('error', () => activeSockets.delete(socket))
  })

  return wrap
}

/** CLI 入口：起一个真实 mock dsh，供真 VS Code 窗口对接。 */
export function main(): void {
  const args = process.argv.slice(2)
  let port = 3080
  let scenario: MockScenario = defaultScenario()
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port') port = Number(args[++i]) || 3080
  }
  const mock = createMockServer(scenario)
  mock.listen(port).then(() => {
    console.log(`[mock-dsh] listening on ${mock.url}`)
  })
}

// 让 `node test/mock-dsh/server.ts`（或 --port）真正把服务拉起来；
// 被测试 import 时不会触发（createMockServer 是纯工厂）。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
