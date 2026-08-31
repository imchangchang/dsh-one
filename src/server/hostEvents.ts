import * as vscode from 'vscode'
import type { Logger } from '../log.ts'

/**
 * Subscribes to the dsh host event stream (`WS <url>/api/events.host`).
 * Frames are `{type:'server-request', rpcId, method, payload}`; method and
 * the raw payload are forwarded to `onEvent`（载荷解析下沉到
 * src/pure/hostFrames.ts）。Reconnect is the caller's job: onClose fires
 * when the stream drops (never after dispose), so the caller can
 * re-subscribe with backoff.
 */
export function subscribeHostEvents(
  url: string,
  logger: Logger,
  onEvent: (method: string, payload: unknown) => void,
  onClose?: () => void,
): vscode.Disposable {
  let disposed = false
  const socket = new WebSocket(`${url.replace(/^http/, 'ws')}/api/events.host`)
  socket.onopen = () => {
    logger.info('host events: subscribed')
  }
  socket.onmessage = (event) => {
    if (typeof event.data !== 'string') return
    let frame: { method?: string; payload?: unknown }
    try {
      frame = JSON.parse(event.data) as { method?: string; payload?: unknown }
    } catch {
      return
    }
    if (frame.method) onEvent(frame.method, frame.payload)
  }
  socket.onclose = () => {
    logger.info('host events: stream closed')
    if (!disposed) onClose?.()
  }
  socket.onerror = () => {
    logger.warn('host events: stream errored')
  }
  return new vscode.Disposable(() => {
    disposed = true
    socket.close()
  })
}
