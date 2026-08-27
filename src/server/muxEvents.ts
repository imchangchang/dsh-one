import * as vscode from 'vscode'
import type { Logger } from '../log.ts'

/**
 * One downlink frame from WS /api/events.mux. On the wire frames arrive as
 * {type:'server-request', rpcId, method, payload}; approval/question requests
 * carry a stable rpcId that must be echoed back via POST /api/respond.
 */
export interface MuxFrame {
  rpcId?: string
  method: string
  payload: unknown
}

/**
 * Subscribe to the mux event stream (downlink-only; the server closes client
 * messages with 1008). No reconnect logic — callers re-subscribe on state
 * changes. Fires onFrame for every frame, including control frames like
 * session/subscribed.
 */
export function subscribeMuxEvents(url: string, logger: Logger, onFrame: (frame: MuxFrame) => void): vscode.Disposable {
  const socket = new WebSocket(`${url.replace(/^http/, 'ws')}/api/events.mux`)
  socket.onopen = () => {
    logger.info('mux events: subscribed')
  }
  socket.onmessage = (event) => {
    if (typeof event.data !== 'string') return
    let frame: { type?: string; rpcId?: string; method?: string; payload?: unknown }
    try {
      frame = JSON.parse(event.data) as typeof frame
    } catch {
      return
    }
    if (frame?.type !== 'server-request' || typeof frame.method !== 'string') return
    onFrame({ rpcId: frame.rpcId, method: frame.method, payload: frame.payload })
  }
  socket.onclose = () => {
    logger.info('mux events: stream closed')
  }
  socket.onerror = () => {
    logger.warn('mux events: stream errored')
  }
  return new vscode.Disposable(() => socket.close())
}
