import * as vscode from 'vscode'
import type { Logger } from '../log.ts'
import type { ChatState, PendingRequest } from '../pure/chatContract.ts'
import { ConversationFolder } from '../pure/conversation.ts'
import type { HistoryEntryLike, SessionEventLike, ToolEventViewLike } from '../pure/conversation.ts'
import { subscribeMuxEvents } from './muxEvents.ts'
import type { MuxFrame } from './muxEvents.ts'
import { cancelSession, promptSession, respond, sessionHistory } from './dshRpc.ts'

/** Streaming snapshots are pushed at most this often; structural changes flush immediately. */
const FLUSH_INTERVAL_MS = 100
/** Safety bound on the history back-pagination at attach time. */
const MAX_HISTORY_PAGES = 100

/** Loose mirror of AskUserQuestionItem (dsh-user-questions types). */
interface QuestionItem {
  id: string
  question: string
  header?: string
  options?: Array<{ label: string; description?: string }>
  multiSelect?: boolean
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Owns one attached chat session: loads history, subscribes the mux stream,
 * folds events into ChatState (src/pure/chatContract.ts) and answers user
 * actions (send/stop/approval/question). Emits onDidChange with a full
 * snapshot, throttled during streaming. Not tied to any UI.
 */
export class ChatSessionController implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<ChatState>()
  readonly onDidChange = this.emitter.event

  private readonly folder = new ConversationFolder()
  private pending: PendingRequest[] = []
  private sessionTitle: string | undefined
  /** Watermark for the title projection's higher-seq-wins rule. */
  private titleSeq = -1
  private ready = false
  private mux: vscode.Disposable | undefined
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private lastFlush = 0
  private disposed = false
  /** Original question items by rpcId; the answer payload echoes their ids. */
  private readonly questionItems = new Map<string, QuestionItem[]>()

  constructor(
    readonly url: string,
    readonly sessionId: string,
    private readonly logger: Logger,
  ) {
    void this.init()
  }

  getState(): ChatState {
    return {
      sessionId: this.sessionId,
      sessionTitle: this.sessionTitle,
      messages: this.folder.messages(),
      pending: [...this.pending],
      running: this.folder.hasOpenTurn(),
      canSend: this.ready && !this.disposed,
    }
  }

  async send(text: string): Promise<void> {
    try {
      await promptSession(this.url, this.sessionId, text)
    } catch (error) {
      this.logger.error(`chat: prompt failed: ${errorText(error)}`)
      throw error
    }
  }

  async stop(): Promise<void> {
    try {
      await cancelSession(this.url, this.sessionId)
    } catch (error) {
      this.logger.error(`chat: cancel failed: ${errorText(error)}`)
      throw error
    }
  }

  async respondApproval(rpcId: string, outcome: 'allowed-once' | 'rejected'): Promise<void> {
    const entry = this.pending.find((p) => p.kind === 'approval' && p.rpcId === rpcId)
    if (!entry || entry.kind !== 'approval') throw new Error(`approval ${rpcId} is not pending`)
    await respond(this.url, rpcId, { sessionId: this.sessionId, approvalId: entry.approvalId, outcome })
  }

  async answerQuestion(rpcId: string, answer: string): Promise<void> {
    const items = this.questionItems.get(rpcId)
    if (!items) throw new Error(`question ${rpcId} is not pending`)
    // The webview answers with one string: when it matches an option label it
    // selects that option, otherwise it rides as the free-text custom answer —
    // applied to every question of the batch (one ask, one answer).
    const value = {
      sessionId: this.sessionId,
      answer: {
        answers: items.map((q) =>
          q.options?.some((o) => o.label === answer)
            ? { id: q.id, selected: [answer] }
            : { id: q.id, selected: [], custom: answer },
        ),
      },
    }
    await respond(this.url, rpcId, value)
  }

  dispose(): void {
    this.disposed = true
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = undefined
    this.mux?.dispose()
    this.emitter.dispose()
  }

  /** Baseline: fold the full history window, then subscribe the mux stream. */
  private async init(): Promise<void> {
    try {
      let page = await sessionHistory(this.url, this.sessionId)
      const projections = page.projections
      let events: HistoryEntryLike[] = page.events
      let pages = 1
      while (page.hasMore && events.length > 0 && pages < MAX_HISTORY_PAGES) {
        page = await sessionHistory(this.url, this.sessionId, events[0].event.seq)
        events = [...page.events, ...events]
        pages += 1
      }
      if (page.hasMore) this.logger.warn(`chat: history of ${this.sessionId} truncated at ${MAX_HISTORY_PAGES} pages`)
      this.folder.applyHistory(events)
      if (projections) {
        this.titleSeq = projections.asOfSeq
        const title = projections.values.title
        this.sessionTitle = typeof title === 'string' && title ? title : undefined
      }
    } catch (error) {
      this.logger.warn(`chat: history baseline failed for ${this.sessionId}: ${errorText(error)}`)
    }
    if (this.disposed) return
    this.mux = subscribeMuxEvents(this.url, this.logger, (frame) => this.onFrame(frame))
    this.ready = true
    this.push(true)
  }

  private onFrame(frame: MuxFrame): void {
    if (this.disposed) return
    const payload = (frame.payload ?? {}) as Record<string, unknown>
    if (frame.method === 'stream/error') {
      this.logger.warn(`chat: mux stream error: ${JSON.stringify(payload.error ?? payload)}`)
      return
    }
    if (payload.sessionId !== this.sessionId) return
    switch (frame.method) {
      case 'session/subscribed':
        this.logger.info(`chat: subscribed to ${this.sessionId} (lastSeq ${String(payload.lastSeq)})`)
        return
      case 'session/event': {
        const event = payload.event as SessionEventLike
        const view = payload.view as ToolEventViewLike | undefined
        // Chunk deltas stream-throttle; every other event is structural.
        if (this.folder.applyEvent(event, view)) this.push(event.type !== 'assistant/chunk')
        return
      }
      case 'session/projection': {
        if (payload.key !== 'title') return
        const seq = typeof payload.seq === 'number' ? payload.seq : -1
        if (seq <= this.titleSeq) return
        this.titleSeq = seq
        this.sessionTitle = typeof payload.value === 'string' && payload.value ? payload.value : undefined
        this.push(true)
        return
      }
      case 'approval/requested': {
        if (typeof frame.rpcId !== 'string') return
        this.pending.push({
          kind: 'approval',
          rpcId: frame.rpcId,
          sessionId: this.sessionId,
          approvalId: String(payload.approvalId),
          toolName: typeof payload.toolName === 'string' ? payload.toolName : '',
          reason: typeof payload.reason === 'string' ? payload.reason : undefined,
        })
        this.push(true)
        return
      }
      case 'approval/resolved': {
        const before = this.pending.length
        this.pending = this.pending.filter(
          (p) => !(p.kind === 'approval' && p.approvalId === String(payload.approvalId)),
        )
        if (this.pending.length !== before) this.push(true)
        return
      }
      case 'question/requested': {
        if (typeof frame.rpcId !== 'string') return
        const items = Array.isArray(payload.questions) ? (payload.questions as QuestionItem[]) : []
        this.questionItems.set(frame.rpcId, items)
        this.pending.push({
          kind: 'question',
          rpcId: frame.rpcId,
          sessionId: this.sessionId,
          questions: items.map((q) => ({
            question: q.question,
            header: q.header,
            options: q.options,
            multiSelect: q.multiSelect,
          })),
        })
        this.push(true)
        return
      }
      case 'question/resolved': {
        const rpcId = typeof payload.questionRpcId === 'string' ? payload.questionRpcId : ''
        const before = this.pending.length
        this.pending = this.pending.filter((p) => !(p.kind === 'question' && p.rpcId === rpcId))
        this.questionItems.delete(rpcId)
        if (this.pending.length !== before) this.push(true)
        return
      }
      default:
        // session/queue and session/jobs carry no chat rendering yet.
        return
    }
  }

  /** Push a snapshot; immediate flushes now, otherwise throttled to FLUSH_INTERVAL_MS. */
  private push(immediate: boolean): void {
    if (this.disposed) return
    if (immediate) {
      if (this.flushTimer) clearTimeout(this.flushTimer)
      this.flushTimer = undefined
      this.flush()
      return
    }
    const wait = FLUSH_INTERVAL_MS - (Date.now() - this.lastFlush)
    if (wait <= 0) {
      this.flush()
      return
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = undefined
        this.flush()
      }, wait)
    }
  }

  private flush(): void {
    if (this.disposed) return
    this.lastFlush = Date.now()
    this.emitter.fire(this.getState())
  }
}
