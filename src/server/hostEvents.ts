import * as vscode from 'vscode'
import type { Logger } from '../log.ts'

/**
 * Subscribes to the dsh host event stream (`WS <url>/api/events.host`).
 * Frames are `{type:'server-request', rpcId, method, payload}`; only the
 * method string is forwarded to `onEvent`. There is no reconnect logic —
 * the caller re-subscribes when the server state changes again.
 */
export function subscribeHostEvents(
  url: string,
  logger: Logger,
  onEvent: (method: string) => void,
): vscode.Disposable {
  const socket = new WebSocket(`${url.replace(/^http/, 'ws')}/api/events.host`)
  socket.onopen = () => {
    logger.info('host events: subscribed')
  }
  socket.onmessage = (event) => {
    if (typeof event.data !== 'string') return
    let method: string | undefined
    try {
      method = (JSON.parse(event.data) as { method?: string }).method
    } catch {
      return
    }
    if (method) onEvent(method)
  }
  socket.onclose = () => {
    logger.info('host events: stream closed')
  }
  socket.onerror = () => {
    logger.warn('host events: stream errored')
  }
  return new vscode.Disposable(() => socket.close())
}
