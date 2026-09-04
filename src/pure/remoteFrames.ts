/**
 * dsh >= 0.1.2 Typert Remote wire vocabulary (verified against
 * dsh-api-gateway / dsh-api-session-controller 0.1.2-rc.1):
 *
 * - one multiplexed WS (`/api/remote.mux`); client frames are
 *   `{type:'open'|'cancel', streamId, ...}` and server frames are
 *   `{type:'item'|'end'|'error', streamId, ...}`
 * - `$events` stream: first item `{type:'ready', clientId, host}`, then
 *   `{type:'emit'|'waterfall'|'cancel', ...}`; waterfall answers go through
 *   the unary `$events/result` (clientId + eventId + outcome)
 * - `session/control`: baseline {queues, jobs, projections} then queue /
 *   jobs / projection increments
 * - `workspace/follow`: baseline {items, archivedSessionIds} then
 *   upsert / remove / order / archived increments
 * - `session/follow`: snapshot {header, cursor, records, hasMore,
 *   projections} then raw event entries
 *
 * Pure logic — no `vscode` import.
 */

export type RemoteMuxClientFrame =
  | { type: 'open'; streamId: string; endpoint: string; payload: unknown }
  | { type: 'cancel'; streamId: string }

export type RemoteMuxServerFrame =
  | { type: 'item'; streamId: string; value?: unknown }
  | { type: 'end'; streamId: string }
  | { type: 'error'; streamId: string; error: { code: string; message: string; details: unknown } }

/** Parse one client-bound WS frame; null when malformed. */
export function parseMuxServerFrame(text: string): RemoteMuxServerFrame | null {
  let decoded: unknown
  try {
    decoded = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof decoded !== 'object' || decoded === null) return null
  const frame = decoded as Record<string, unknown>
  if (frame.type === 'item' && typeof frame.streamId === 'string') {
    return { type: 'item', streamId: frame.streamId, ...(Object.hasOwn(frame, 'value') ? { value: frame.value } : {}) }
  }
  if (frame.type === 'end' && typeof frame.streamId === 'string') {
    return { type: 'end', streamId: frame.streamId }
  }
  if (frame.type === 'error' && typeof frame.streamId === 'string' && typeof frame.error === 'object' && frame.error !== null) {
    const err = frame.error as Record<string, unknown>
    return {
      type: 'error',
      streamId: frame.streamId,
      error: {
        code: typeof err.code === 'string' ? err.code : '',
        message: typeof err.message === 'string' ? err.message : 'remote stream error',
        details: err.details,
      },
    }
  }
  return null
}

/** First `$events` stream item: the connection generation identity. */
export interface EventStreamReady {
  clientId: string
  host: { home: string }
}

export function parseEventStreamReady(value: unknown): EventStreamReady | null {
  if (typeof value !== 'object' || value === null) return null
  const frame = value as Record<string, unknown>
  if (frame.type !== 'ready' || typeof frame.clientId !== 'string') return null
  const host = frame.host as Record<string, unknown> | undefined
  if (typeof host?.home !== 'string') return null
  return { clientId: frame.clientId, host: { home: host.home } }
}

export type EventStreamFrame =
  | { type: 'emit'; event: string; args: unknown[] }
  | { type: 'waterfall'; event: string; eventId: string; agentId: string; request: Record<string, unknown> }
  | { type: 'cancel'; eventId: string }

export function parseEventStreamFrame(value: unknown): EventStreamFrame | null {
  if (typeof value !== 'object' || value === null) return null
  const frame = value as Record<string, unknown>
  if (frame.type === 'cancel' && typeof frame.eventId === 'string') {
    return { type: 'cancel', eventId: frame.eventId }
  }
  if (frame.type === 'emit' && typeof frame.event === 'string' && Array.isArray(frame.args)) {
    return { type: 'emit', event: frame.event, args: frame.args as unknown[] }
  }
  if (
    frame.type === 'waterfall' &&
    typeof frame.event === 'string' &&
    typeof frame.eventId === 'string' &&
    typeof frame.agentId === 'string' &&
    typeof frame.request === 'object' &&
    frame.request !== null
  ) {
    return {
      type: 'waterfall',
      event: frame.event,
      eventId: frame.eventId,
      agentId: frame.agentId,
      request: frame.request as Record<string, unknown>,
    }
  }
  return null
}

/** `session/control` frames (baseline included). */
export type ControlStreamFrame =
  | { type: 'baseline'; value: Record<string, unknown> }
  | { type: 'queue'; sessionId: string; items: unknown[] }
  | { type: 'jobs'; sessionId: string; jobs: unknown[] }
  | { type: 'projection'; sessionId: string; key: string; value: unknown; seq: number }

export function parseControlStreamFrame(value: unknown): ControlStreamFrame | null {
  if (typeof value !== 'object' || value === null) return null
  const frame = value as Record<string, unknown>
  if (frame.type === 'baseline' && typeof frame.value === 'object' && frame.value !== null) {
    return { type: 'baseline', value: frame.value as Record<string, unknown> }
  }
  if (frame.type === 'queue' && typeof frame.sessionId === 'string' && Array.isArray(frame.items)) {
    return { type: 'queue', sessionId: frame.sessionId, items: frame.items as unknown[] }
  }
  if (frame.type === 'jobs' && typeof frame.sessionId === 'string' && Array.isArray(frame.jobs)) {
    return { type: 'jobs', sessionId: frame.sessionId, jobs: frame.jobs as unknown[] }
  }
  if (
    frame.type === 'projection' &&
    typeof frame.sessionId === 'string' &&
    typeof frame.key === 'string' &&
    typeof frame.seq === 'number'
  ) {
    return { type: 'projection', sessionId: frame.sessionId, key: frame.key, value: frame.value, seq: frame.seq }
  }
  return null
}

/** `workspace/follow` frames. */
export type WorkspaceStreamFrame =
  | { type: 'baseline'; items: unknown[]; archivedSessionIds: string[] }
  | { type: 'upsert'; workspace: Record<string, unknown> }
  | { type: 'remove'; workspaceId: string }
  | { type: 'order'; workspaceIds: string[] }
  | { type: 'archived'; archivedSessionIds: string[] }

export function parseWorkspaceStreamFrame(value: unknown): WorkspaceStreamFrame | null {
  if (typeof value !== 'object' || value === null) return null
  const frame = value as Record<string, unknown>
  if (frame.type === 'remove' && typeof frame.workspaceId === 'string') {
    return { type: 'remove', workspaceId: frame.workspaceId }
  }
  if (frame.type === 'order' && Array.isArray(frame.workspaceIds)) {
    return { type: 'order', workspaceIds: frame.workspaceIds as string[] }
  }
  if (frame.type === 'archived' && Array.isArray(frame.archivedSessionIds)) {
    return { type: 'archived', archivedSessionIds: frame.archivedSessionIds as string[] }
  }
  if (frame.type === 'upsert' && typeof frame.workspace === 'object' && frame.workspace !== null) {
    return { type: 'upsert', workspace: frame.workspace as Record<string, unknown> }
  }
  if (frame.type === 'baseline' && typeof frame.value === 'object' && frame.value !== null) {
    const baseline = frame.value as Record<string, unknown>
    return {
      type: 'baseline',
      items: Array.isArray(baseline.items) ? (baseline.items as unknown[]) : [],
      archivedSessionIds: Array.isArray(baseline.archivedSessionIds)
        ? (baseline.archivedSessionIds as string[]).filter((id): id is string => typeof id === 'string')
        : [],
    }
  }
  return null
}

/** `session/follow` frames: opening snapshot then raw event entries. */
export type FollowStreamFrame =
  | {
      type: 'snapshot'
      cursor: number
      records: unknown[]
      hasMore: boolean
      header: Record<string, unknown>
      projections: Record<string, unknown>
    }
  | { type: 'event'; event: { type: string; seq: number; time?: number; data?: unknown; surfaceOp?: unknown } }

export function parseFollowStreamFrame(value: unknown): FollowStreamFrame | null {
  if (typeof value !== 'object' || value === null) return null
  const frame = value as Record<string, unknown>
  if (frame.type === 'snapshot' && typeof frame.cursor === 'number' && Array.isArray(frame.records)) {
    return {
      type: 'snapshot',
      cursor: frame.cursor,
      records: frame.records as unknown[],
      hasMore: frame.hasMore === true,
      header: typeof frame.header === 'object' && frame.header !== null ? (frame.header as Record<string, unknown>) : {},
      projections:
        typeof frame.projections === 'object' && frame.projections !== null
          ? (frame.projections as Record<string, unknown>)
          : {},
    }
  }
  if (frame.type === 'event' && typeof frame.event === 'object' && frame.event !== null) {
    const event = frame.event as Record<string, unknown>
    if (typeof event.type !== 'string' || typeof event.seq !== 'number') return null
    return {
      type: 'event',
      event: {
        type: event.type,
        seq: event.seq,
        ...(typeof event.time === 'number' ? { time: event.time } : {}),
        ...(Object.hasOwn(event, 'data') ? { data: event.data } : {}),
        ...(Object.hasOwn(event, 'surfaceOp') ? { surfaceOp: event.surfaceOp } : {}),
      },
    }
  }
  // 0.1.2 packs Assistant delta runs into {type:'chunks', event} records inside
  // the history page; the follow stream itself emits plain event entries.
  return null
}
