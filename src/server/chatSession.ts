import * as vscode from 'vscode'
import type { Logger } from '../log.ts'
import type { ChatState, JobItem, OutgoingImage, PendingRequest, QuestionAnswerInput, QueuedItem } from '../pure/chatContract.ts'
import { ConversationFolder } from '../pure/conversation.ts'
import type { HistoryEntryLike, SessionEventLike, ToolEventViewLike } from '../pure/conversation.ts'
import { formatStatsLine } from '../pure/sessionStats.ts'
import type { SessionStatsLike } from '../pure/sessionStats.ts'
import { subscribeMuxEvents } from './muxEvents.ts'
import type { MuxFrame } from './muxEvents.ts'
import { cancelSession, promptSession, respond, sessionHistory, sessionModels, updateQueue } from './dshRpc.ts'
import type { ImageLimits, SessionModels } from './dshRpc.ts'

/** Streaming snapshots are pushed at most this often; structural changes flush immediately. */
const FLUSH_INTERVAL_MS = 100
/** Safety bound on the history back-pagination at attach time. */
const MAX_HISTORY_PAGES = 100

/** Loose mirror of AskUserQuestionItem (dsh-user-questions types). */
interface QuestionItem {
  id: string
  question: string
  detail?: string
  header?: string
  options?: Array<{ label: string; description?: string }>
  multiSelect?: boolean
  intent?: { kind: string; approve?: string }
}

/** Loose mirror of QueuedInboxItem (apiproxy events.d.ts); context items are invisible until claimed. */
interface QueuedInboxItemLike {
  id: string
  placement: 'queued' | 'steering' | 'context'
  message?: { content?: Array<{ type: string; text?: unknown }> }
}

/** Loose mirror of JobView (apiproxy jobs.d.ts). */
interface JobViewLike {
  id: string
  kind: string
  label: string
  status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed'
  detail?: string
}

/** Loose mirror of PermissionSelect (dsh-permission-presets types; `permissions` projection value). */
interface PermissionSelectLike {
  options?: Array<{ value?: string; name?: string }>
  currentValue?: string
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * kebab-case machine name → Title Case (`workspace-write` → `Workspace Write`),
 * same transform as the web client's permission select; non-kebab names pass
 * through unchanged.
 */
export function permissionDisplayName(name: string): string {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return name
  return name
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Web-client option label: `danger-full-access` uses the product label
 * "Full access" instead of the machine-name transform (dsh-client-ui-conversation
 * PermissionSelect does the same override).
 */
function permissionOptionLabel(value: string, name: string): string {
  return value === 'danger-full-access' ? 'Full access' : permissionDisplayName(name)
}

/**
 * Footer pill label for the current selection, web style "DeepSeek-V4-Flash
 * High": catalog display name + reasoning effort name, falling back to the
 * raw ids when the route is absent from the (advisory) catalog.
 */
function modelLabelOf(models: SessionModels): string {
  const { current } = models
  const group = models.groups.find((g) => g.id === current.provider)
  const model = group?.models.find((m) => m.id === current.model)
  let label = model?.name ?? current.model
  const effortId = current.reasoningEffort ?? model?.reasoning?.defaultEffort
  if (effortId) {
    const effort = model?.reasoning?.efforts.find((e) => e.id === effortId)
    label += ` ${effort?.name ?? permissionDisplayName(effortId)}`
  }
  return label
}

/** Flatten a queued message: preview strips attachment lines, editText keeps them. */
function queueItemOf(item: QueuedInboxItemLike): { text: string; editText: string } {
  const content = item.message?.content
  if (!Array.isArray(content)) return { text: '', editText: '' }
  const images = content.filter((b) => b && b.type === 'image').length
  let files = 0
  const previewLines: string[] = []
  const editLines: string[] = []
  for (const b of content) {
    if (!b || b.type !== 'text' || typeof b.text !== 'string') continue
    for (const line of b.text.split('\n')) {
      editLines.push(line)
      // Attachment lines the composer appended ride this text block too.
      if (/^<attachment>.+<\/attachment>$/.test(line.trim())) files += 1
      else previewLines.push(line)
    }
  }
  const text = previewLines.join('\n').trim()
  const notes = [images > 0 ? `[图片 ×${images}]` : '', files > 0 ? `[文件 ×${files}]` : ''].filter(Boolean)
  return { text: [...notes, text].filter(Boolean).join(' '), editText: editLines.join('\n').trim() }
}

/** Narrow an unknown projection value to SessionStatsLike; null when malformed. */
function asStats(value: unknown): SessionStatsLike | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const nums = ['turns', 'steps', 'llmMs', 'toolMs', 'ttftMs', 'ttftSteps', 'decodeMs', 'decodeTokens']
  if (!nums.every((k) => typeof v[k] === 'number')) return null
  return value as SessionStatsLike
}

/** Narrow an unknown projection value to the imageLimits shape; null when malformed. */
function asImageLimits(value: unknown): ImageLimits | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (
    typeof v.maxImageBytes !== 'number' ||
    typeof v.maxImagesPerMessage !== 'number' ||
    typeof v.maxMessageImageBytes !== 'number' ||
    !Array.isArray(v.mediaTypes) ||
    !v.mediaTypes.every((t) => typeof t === 'string')
  ) {
    return null
  }
  return value as ImageLimits
}

/** Narrow an unknown projection value to PermissionSelectLike; null when malformed. */
function asPermissionSelect(value: unknown): PermissionSelectLike | null {
  if (!value || typeof value !== 'object') return null
  const v = value as PermissionSelectLike
  if (!Array.isArray(v.options) || typeof v.currentValue !== 'string') return null
  return v
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
  /** Latest session/queue snapshot, user-visible placements only. */
  private queue: QueuedItem[] = []
  /** Raw queued items by id, kept so queue edits can preserve non-text content. */
  private queueRaw = new Map<string, QueuedInboxItemLike>()
  /** Latest session/jobs snapshot, live jobs only. */
  private jobs: JobItem[] = []
  private sessionTitle: string | undefined
  /** Watermark for the title projection's higher-seq-wins rule. */
  private titleSeq = -1
  /** Permission select from the `permissions` projection (higher seq wins). */
  private permissions: { options: Array<{ value: string; label: string }>; current: string } | undefined
  private permissionsSeq = -1
  /** Formatted stats line from the `sessionStats` projection (higher seq wins). */
  private statsLine: string | undefined
  private statsSeq = -1
  /** Image intake limits from the `imageLimits` projection; undefined = no pre-check. */
  imageLimits: ImageLimits | undefined
  /** Footer model pill, filled by refreshModels(). */
  private modelLabel: string | undefined
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
      queue: [...this.queue],
      jobs: [...this.jobs],
      running: this.folder.hasOpenTurn(),
      canSend: this.ready && !this.disposed,
      modelLabel: this.modelLabel,
      permissions: this.permissions,
      statsLine: this.statsLine,
    }
  }

  /** Queue (or steer) one user prompt. Slash commands do not belong here — see chatView's runCommand. */
  async send(text: string, images?: OutgoingImage[], steer = false): Promise<void> {
    try {
      await promptSession(this.url, this.sessionId, text, steer ? 'steer' : 'queue', images)
    } catch (error) {
      this.logger.error(`chat: prompt failed: ${errorText(error)}`)
      throw error
    }
  }

  /** Re-read session.models and refresh the footer model pill. */
  async refreshModels(): Promise<void> {
    const models = await sessionModels(this.url, this.sessionId)
    if (this.disposed) return
    this.modelLabel = modelLabelOf(models)
    this.push(true)
  }

  /**
   * Stop the active turn and drain the queue. dsh's cancel deliberately
   * preserves pending inbox work (it resumes FIFO once cancellation
   * settles), so "stop" here also removes every queued prompt and returns
   * their texts for the composer to restore as drafts.
   */
  async stop(): Promise<string[]> {
    try {
      await cancelSession(this.url, this.sessionId)
    } catch (error) {
      this.logger.error(`chat: cancel failed: ${errorText(error)}`)
      throw error
    }
    const restored: string[] = []
    for (const item of this.queue) {
      try {
        await updateQueue(this.url, this.sessionId, item.id, { kind: 'remove' })
        if (item.editText) restored.push(item.editText)
      } catch (error) {
        // A concurrently claimed item is already running — nothing to restore.
        this.logger.warn(`chat: removing queued ${item.id} failed: ${errorText(error)}`)
      }
    }
    return restored
  }

  /** Turn one queued prompt into an immediate steer. */
  async steerQueued(itemId: string): Promise<void> {
    await updateQueue(this.url, this.sessionId, itemId, { kind: 'steer' })
  }

  /** Drop one queued prompt. */
  async removeQueued(itemId: string): Promise<void> {
    await updateQueue(this.url, this.sessionId, itemId, { kind: 'remove' })
  }

  /** Replace a queued prompt's text, preserving its non-text content (images). */
  async editQueued(itemId: string, text: string): Promise<void> {
    const item = this.queueRaw.get(itemId)
    if (!item) throw new Error(`queue item ${itemId} is not pending`)
    const kept = (item.message?.content ?? []).filter((b) => b && b.type !== 'text')
    const content: unknown[] = [...kept, ...(text.trim() ? [{ type: 'text', text }] : [])]
    await updateQueue(this.url, this.sessionId, itemId, { kind: 'edit', content })
  }

  async respondApproval(rpcId: string, outcome: 'allowed-once' | 'rejected'): Promise<void> {
    const entry = this.pending.find((p) => p.kind === 'approval' && p.rpcId === rpcId)
    if (!entry || entry.kind !== 'approval') throw new Error(`approval ${rpcId} is not pending`)
    await respond(this.url, rpcId, { sessionId: this.sessionId, approvalId: entry.approvalId, outcome })
  }

  async answerQuestion(rpcId: string, answers: QuestionAnswerInput[]): Promise<void> {
    const items = this.questionItems.get(rpcId)
    if (!items) throw new Error(`question ${rpcId} is not pending`)
    // Same encoding as the web client's QuestionComposer: per-question
    // selected labels plus an optional free-text custom answer, ids echoed.
    const value = {
      sessionId: this.sessionId,
      answer: {
        answers: items.map((q, i) => {
          const a = answers[i]
          return {
            id: q.id,
            selected: a?.selected ?? [],
            ...(a?.custom ? { custom: a.custom } : {}),
          }
        }),
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
        // Other projections share the baseline watermark and the same
        // higher-seq-wins rule as the title.
        this.permissionsSeq = projections.asOfSeq
        this.statsSeq = projections.asOfSeq
        this.applyPermissionsValue(projections.values.permissions)
        this.applyStatsValue(projections.values.sessionStats)
        const limits = asImageLimits(projections.values.imageLimits)
        if (limits) this.imageLimits = limits
      }
    } catch (error) {
      this.logger.warn(`chat: history baseline failed for ${this.sessionId}: ${errorText(error)}`)
    }
    if (this.disposed) return
    this.mux = subscribeMuxEvents(this.url, this.logger, (frame) => this.onFrame(frame))
    this.ready = true
    this.push(true)
    // Model label rides no projection; fetch it once the stream is attached.
    this.refreshModels().catch((error: unknown) => {
      this.logger.warn(`chat: session.models failed for ${this.sessionId}: ${errorText(error)}`)
    })
  }

  /** Fold one `permissions` projection value into state (baseline or push frame). */
  private applyPermissionsValue(value: unknown): void {
    const select = asPermissionSelect(value)
    if (!select) return
    const options = (select.options ?? [])
      .filter((o): o is { value: string; name: string } =>
        typeof o?.value === 'string' && typeof o?.name === 'string',
      )
      .map((o) => ({ value: o.value, label: permissionOptionLabel(o.value, o.name) }))
    if (options.length === 0) return
    this.permissions = { options, current: select.currentValue as string }
  }

  /** Fold one `sessionStats` projection value into the footer line. */
  private applyStatsValue(value: unknown): void {
    const stats = asStats(value)
    if (!stats) return
    this.statsLine = formatStatsLine(stats)
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
        const seq = typeof payload.seq === 'number' ? payload.seq : -1
        switch (payload.key) {
          case 'title': {
            if (seq <= this.titleSeq) return
            this.titleSeq = seq
            this.sessionTitle = typeof payload.value === 'string' && payload.value ? payload.value : undefined
            this.push(true)
            return
          }
          case 'permissions': {
            if (seq <= this.permissionsSeq) return
            this.permissionsSeq = seq
            this.applyPermissionsValue(payload.value)
            this.push(true)
            return
          }
          case 'sessionStats': {
            if (seq <= this.statsSeq) return
            this.statsSeq = seq
            this.applyStatsValue(payload.value)
            this.push(true)
            return
          }
          case 'imageLimits': {
            const limits = asImageLimits(payload.value)
            if (limits) this.imageLimits = limits
            return
          }
          default:
            return
        }
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
            detail: q.detail,
            options: q.options,
            multiSelect: q.multiSelect,
            intent: q.intent,
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
      case 'session/queue': {
        // Whole-snapshot replacement: queued prompts are not durable events,
        // so this frame is the only place they are visible until claimed.
        const items = Array.isArray(payload.items) ? (payload.items as QueuedInboxItemLike[]) : []
        this.queueRaw.clear()
        this.queue = items
          .filter((item): item is QueuedInboxItemLike & { placement: 'queued' | 'steering' } =>
            item.placement === 'queued' || item.placement === 'steering',
          )
          .map((item) => {
            const id = String(item.id)
            this.queueRaw.set(id, item)
            return { id, placement: item.placement, ...queueItemOf(item) }
          })
        this.push(true)
        return
      }
      default:
        return
      case 'session/jobs': {
        // Whole-snapshot replacement, same convergence model as session/queue.
        const jobs = Array.isArray(payload.jobs) ? (payload.jobs as JobViewLike[]) : []
        this.jobs = jobs
          .filter((j): j is JobViewLike & { status: 'running' | 'stopping' } =>
            j.status === 'running' || j.status === 'stopping',
          )
          .map((j) => ({
            id: String(j.id),
            kind: String(j.kind),
            label: String(j.label),
            status: j.status,
            ...(j.detail ? { detail: String(j.detail) } : {}),
          }))
        this.push(true)
        return
      }
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
