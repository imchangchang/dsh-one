import type { Disposable } from 'vscode'
import type { Logger } from '../log.ts'
import { openStream, getMux } from './remoteMux.ts'
import {
  parseEventStreamReady,
  parseEventStreamFrame,
  parseControlStreamFrame,
  parseWorkspaceStreamFrame,
  parseFollowStreamFrame,
} from '../pure/remoteFrames.ts'
import type { EventStreamFrame, WorkspaceStreamFrame } from '../pure/remoteFrames.ts'
import { sendWaterfallResult } from './dshRpc.ts'

/**
 * Shared logical streams for the 0.1.2 transport, refcounted per origin:
 * one `$events` stream and one `session/control` stream serve every consumer
 * (sessionsStore sidebar, jobsStore, chat sessions). The singleton owns
 * reconnect+backoff; subscribers just register handlers, which keeps the
 * per-consumer code the same shape as the legacy mux subscriptions.
 */

export interface ModernEventsHandler {
  /** One emitted forwarded event (`event` + Cordis args array). */
  onEvent?: (event: string, args: unknown[]) => void
  /** One waterfall request (approval/question); `answer` settles it. */
  onRequest?: (request: { eventId: string; agentId: string; event: string; req: Record<string, unknown>; answer: (value: unknown) => Promise<void> }) => void
  /** The host cancelled a pending waterfall (settled elsewhere / aborted turn). */
  onCancel?: (eventId: string) => void
  /** Stream dropped; pending state should be treated as gone. */
  onClose?: () => void
}

const RECONNECT_MAX_MS = 30_000

function backoff(attempts: number): number {
  return Math.min(1000 * 2 ** attempts, RECONNECT_MAX_MS)
}

interface EventStreamState {
  handlers: Set<ModernEventsHandler>
  subscription: (Disposable & { retry: () => void }) | null
  timer: NodeJS.Timeout | null
  attempts: number
  closed: boolean
  logger: Logger
}

const eventStreams = new Map<string, EventStreamState>()

/** Shared `$events` stream subscription (refcounted per origin). */
export function subscribeModernEvents(origin: string, logger: Logger, handler: ModernEventsHandler): Disposable {
  let state = eventStreams.get(origin)
  if (state === undefined) {
    state = { handlers: new Set(), subscription: null, timer: null, attempts: 0, closed: false, logger }
    eventStreams.set(origin, state)
  }
  state.handlers.add(handler)
  state.closed = false
  startEventStream(origin, logger, state)
  return {
    dispose(): void {
      state.handlers.delete(handler)
      if (state.handlers.size === 0 && !state.closed) {
        state.closed = true
        if (state.timer !== null) clearTimeout(state.timer)
        state.subscription?.dispose()
        state.subscription = null
        eventStreams.delete(origin)
      }
    },
  }
}

/** (Re)open the singleton $events stream; reconnect with backoff on loss. */
function startEventStream(origin: string, logger: Logger, state: EventStreamState): void {
  if (state.subscription !== null || state.timer !== null || state.closed) return
  let clientId: string | null = null
  state.subscription = openStream(
    origin,
    '$events',
    { args: {} },
    logger,
    {
      onItem(value: unknown) {
        if (clientId === null) {
          const ready = parseEventStreamReady(value)
          if (ready === null) return
          clientId = ready.clientId
          return
        }
        const frame: EventStreamFrame | null = parseEventStreamFrame(value)
        if (frame === null) return
        if (frame.type === 'cancel') {
          for (const handler of state.handlers) handler.onCancel?.(frame.eventId)
          return
        }
        if (frame.type === 'emit') {
          for (const handler of state.handlers) handler.onEvent?.(frame.event, frame.args)
          return
        }
        for (const handler of state.handlers) {
          handler.onRequest?.({
            eventId: frame.eventId,
            agentId: frame.agentId,
            event: frame.event,
            req: frame.request,
            answer: (value: unknown) => sendWaterfallResult(origin, clientId as string, frame.eventId, value),
          })
        }
      },
      onError() {
        // Socket dropped: current generation is void — the host cancels its
        // pending waterfalls; consumers clear transient state themselves.
        clientId = null
        state.subscription = null
        if (state.closed) return
        state.attempts += 1
        state.timer = setTimeout(() => {
          state.timer = null
          if (state.closed) return
          startEventStream(origin, logger, state)
        }, backoff(state.attempts - 1))
        for (const handler of state.handlers) handler.onClose?.()
      },
    },
  )
}

interface ControlStreamState {
  handlers: Set<(frame: NonNullable<ReturnType<typeof parseControlStreamFrame>>) => void>
  subscription: (Disposable & { retry: () => void }) | null
  timer: NodeJS.Timeout | null
  attempts: number
  closed: boolean
  logger: Logger
}

const controlStreams = new Map<string, ControlStreamState>()

/** Shared `session/control` stream subscription (refcounted per origin). */
export function subscribeControlStream(
  origin: string,
  logger: Logger,
  onFrame: (frame: NonNullable<ReturnType<typeof parseControlStreamFrame>>) => void,
): Disposable {
  let state = controlStreams.get(origin)
  if (state === undefined) {
    state = { handlers: new Set(), subscription: null, timer: null, attempts: 0, closed: false, logger }
    controlStreams.set(origin, state)
  }
  state.handlers.add(onFrame)
  state.closed = false
  startControlStream(origin, logger, state)
  return {
    dispose(): void {
      state.handlers.delete(onFrame)
      if (state.handlers.size === 0 && !state.closed) {
        state.closed = true
        if (state.timer !== null) clearTimeout(state.timer)
        state.subscription?.dispose()
        state.subscription = null
        controlStreams.delete(origin)
      }
    },
  }
}

function startControlStream(origin: string, logger: Logger, state: ControlStreamState): void {
  if (state.subscription !== null || state.timer !== null || state.closed) return
  // Baseline events also flow through onFrame — consumers treat a baseline
  // as the whole-snapshot replacement the legacy mux used for re-baselining.
  state.subscription = openStream(
    origin,
    'session/control',
    { args: {} },
    logger,
    {
      onItem(value: unknown) {
        const frame = parseControlStreamFrame(value)
        if (frame === null) return
        for (const handler of state.handlers) handler(frame)
      },
      onError() {
        state.subscription = null
        if (state.closed) return
        state.attempts += 1
        state.timer = setTimeout(() => {
          state.timer = null
          if (state.closed) return
          startControlStream(origin, logger, state)
        }, backoff(state.attempts - 1))
      },
    },
  )
}

/** Drop the shared streams and the mux socket of an origin (server restart). */
export function purgeModernStreams(origin: string): void {
  const state = eventStreams.get(origin)
  if (state) {
    state.closed = true
    if (state.timer !== null) clearTimeout(state.timer)
    state.subscription?.dispose()
    eventStreams.delete(origin)
  }
  const control = controlStreams.get(origin)
  if (control) {
    control.closed = true
    if (control.timer !== null) clearTimeout(control.timer)
    control.subscription?.dispose()
    controlStreams.delete(origin)
  }
  getMux(origin, state?.logger ?? control?.logger ?? ({} as Logger)).close()
}

/** `workspace/follow` stream subscription (self-reconnecting). */
export function subscribeWorkspaceStream(
  origin: string,
  logger: Logger,
  onFrame: (frame: WorkspaceStreamFrame) => void,
): Disposable {
  let closed = false
  let subscription: (Disposable & { retry: () => void }) | null = null
  let timer: NodeJS.Timeout | null = null
  let attempts = 0
  const start = (): void => {
    if (closed || subscription !== null) return
    subscription = openStream(
      origin,
      'workspace/follow',
      { args: {} },
      logger,
      {
        onItem(value: unknown) {
          const frame = parseWorkspaceStreamFrame(value)
          if (frame !== null) onFrame(frame)
        },
        onError() {
          subscription = null
          if (closed) return
          attempts += 1
          timer = setTimeout(() => {
            timer = null
            start()
          }, backoff(attempts - 1))
        },
      },
    )
  }
  start()
  return {
    dispose(): void {
      closed = true
      if (timer !== null) clearTimeout(timer)
      subscription?.dispose()
    },
  }
}

/** Snapshot of the opening `session/follow` frame. */
export interface FollowSnapshot {
  cursor: number
  records: unknown[]
  hasMore: boolean
  header: Record<string, unknown>
  projections: Record<string, unknown>
}

/** `session/follow` stream subscription; reconnect is the caller's job. */
export function subscribeFollowStream(
  origin: string,
  logger: Logger,
  sessionId: string,
  handlers: {
    onSnapshot: (snapshot: FollowSnapshot) => void
    onEvent: (event: unknown) => void
    onError: (err: Error) => void
  },
): Disposable {
  return openStream(
    origin,
    'session/follow',
    { args: { request: { address: { kind: 'session', sessionId } } } },
    logger,
    {
      onItem(value: unknown) {
        const frame = parseFollowStreamFrame(value)
        if (frame === null) return
        if (frame.type === 'snapshot') {
          handlers.onSnapshot({
            cursor: frame.cursor,
            records: frame.records,
            hasMore: frame.hasMore,
            header: frame.header,
            projections: frame.projections,
          })
          return
        }
        handlers.onEvent(frame.event)
      },
      onError: (err) => handlers.onError(err),
    },
  )
}
