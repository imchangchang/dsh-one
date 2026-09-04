import type { Disposable } from 'vscode'
import * as crypto from 'node:crypto'
import type { Logger } from '../log.ts'
import { cookieHeader } from './serverAuth.ts'
import { parseMuxServerFrame } from '../pure/remoteFrames.ts'
import type { RemoteMuxClientFrame } from '../pure/remoteFrames.ts'

/**
 * dsh >= 0.1.2 event/state transport: one authenticated WS
 * (`/api/remote.mux`, cookie header) multiplexes logical Typert Remote
 * streams. This module owns the socket and exposes per-stream subscriptions;
 * the logical stream vocabulary (endpoints/frame shapes) lives in
 * src/pure/remoteFrames.ts. Reconnect is the subscriber's job: every live
 * stream gets onError when the socket drops (never after dispose), matching
 * the legacy hostEvents/muxEvents contract.
 */

interface StreamHandlers {
  onItem: (value: unknown) => void
  onEnd?: () => void
  onError?: (err: Error) => void
}

const muxByOrigin = new Map<string, RemoteMux>()

function wsEndpoint(origin: string, pathname: string): string {
  return `${origin.replace(/^http/, 'ws')}${pathname}`
}

export class RemoteMux {
  private socket: WebSocket | null = null
  private connecting = false
  private pendingFrames: RemoteMuxClientFrame[] = []
  private streams = new Map<string, StreamHandlers>()
  private disposed = false

  constructor(
    private readonly origin: string,
    private readonly logger: Logger,
  ) {}

  /** Open a logical stream; resolves nothing (frames arrive via handlers). */
  open(endpoint: string, payload: unknown, handlers: StreamHandlers): string {
    if (this.disposed) throw new Error('remote mux is disposed')
    const streamId = crypto.randomUUID()
    this.streams.set(streamId, handlers)
    this.send({ type: 'open', streamId, endpoint, payload })
    this.ensureSocket()
    return streamId
  }

  cancel(streamId: string): void {
    if (this.disposed) return
    this.streams.delete(streamId)
    this.send({ type: 'cancel', streamId })
  }

  close(): void {
    if (this.disposed) return
    this.disposed = true
    const error = new Error('remote mux disposed')
    for (const [streamId, handlers] of this.streams) {
      handlers.onError?.(error)
      this.streams.delete(streamId)
    }
    this.socket?.close()
    this.socket = null
  }

  /** Occupy a socket failure: every live stream loses its carrier. */
  private failAll(error: Error): void {
    for (const [streamId, handlers] of [...this.streams]) {
      this.streams.delete(streamId)
      handlers.onError?.(error)
    }
  }

  private send(frame: RemoteMuxClientFrame): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(frame))
    } else {
      this.pendingFrames.push(frame)
    }
  }

  private ensureSocket(): void {
    if (this.socket !== null || this.connecting) return
    this.connecting = true
    const cookie = cookieHeader(this.origin)
    // 宿主 WebSocket 的第二个参数接受 {headers:{Cookie}}（已用 Code Helper
    // Node 实测：带 cookie 打开 /api/remote.mux 成功）；标准 WebSocket 类型
    // 只声明 protocols，此处按运行时行为窄化。
    const socket = new WebSocket(wsEndpoint(this.origin, '/api/remote.mux'), (
      cookie === undefined ? undefined : { headers: { Cookie: cookie } }
    ) as unknown as string | string[] | undefined)
    this.socket = socket
    socket.onopen = () => {
      this.connecting = false
      const queued = this.pendingFrames
      this.pendingFrames = []
      for (const frame of queued) socket.send(JSON.stringify(frame))
    }
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return
      const frame = parseMuxServerFrame(event.data)
      if (frame === null) return
      if (frame.type === 'item') {
        this.streams.get(frame.streamId)?.onItem(frame.value)
        return
      }
      if (frame.type === 'end') {
        const handlers = this.streams.get(frame.streamId)
        this.streams.delete(frame.streamId)
        handlers?.onEnd?.()
        return
      }
      const handlers = this.streams.get(frame.streamId)
      this.streams.delete(frame.streamId)
      handlers?.onError?.(new Error(`${frame.error.code}: ${frame.error.message}`))
    }
    socket.onclose = () => {
      this.connecting = false
      if (this.socket === socket) this.socket = null
      if (!this.disposed) this.failAll(new Error('remote.mux connection lost'))
    }
    socket.onerror = () => {
      this.logger.warn('remote mux: socket errored')
    }
  }
}

/** Shared per-origin mux; the last disposing subscriber closes the socket. */
export function getMux(origin: string, logger: Logger): RemoteMux {
  let mux = muxByOrigin.get(origin)
  if (mux === undefined) {
    mux = new RemoteMux(origin, logger)
    muxByOrigin.set(origin, mux)
  }
  return mux
}

export function releaseMux(origin: string): void {
  const mux = muxByOrigin.get(origin)
  if (mux !== undefined) {
    muxByOrigin.delete(origin)
    mux.close()
  }
}

/**
 * Subscribe one logical stream with a disposable; the stream re-opens after
 * connection loss by calling `retry` from its onError handler.
 */
export function openStream(
  origin: string,
  endpoint: string,
  payload: unknown,
  logger: Logger,
  handlers: StreamHandlers,
): Disposable & { retry: () => void } {
  let disposed = false
  let streamId: string | null = null
  const mux = getMux(origin, logger)
  const retry = (): void => {
    if (disposed) return
    streamId = mux.open(endpoint, payload, handlers)
  }
  retry()
  return {
    retry,
    dispose(): void {
      disposed = true
      if (streamId !== null) mux.cancel(streamId)
    },
  }
}
