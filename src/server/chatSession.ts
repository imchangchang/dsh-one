import * as vscode from 'vscode'
import type { Logger } from '../log.ts'
import type { ChatState, ChatTodoItem, JobItem, OutgoingImage, PendingRequest, QuestionAnswerInput, QueuedItem } from '../pure/chatContract.ts'
import { ConversationFolder, applyFeedbackRatings } from '../pure/conversation.ts'
import type { HistoryEntryLike, SessionEventLike, ToolEventViewLike } from '../pure/conversation.ts'
import { WorkflowRunFolder } from '../pure/workflowRun.ts'
import { formatStatsLine } from '../pure/sessionStats.ts'
import type { SessionStatsLike } from '../pure/sessionStats.ts'
import { subscribeMuxEvents } from './muxEvents.ts'
import type { MuxFrame } from './muxEvents.ts'
import {
  cancelSession,
  deleteMessageFeedback,
  forkSession,
  listAgentPresets,
  listMessageFeedback,
  promptSession,
  putMessageFeedback,
  respond,
  selectAgentPreset,
  sessionHistory,
  sessionModels,
  updateQueue,
} from './dshRpc.ts'
import type { ImageLimits, SessionModels } from './dshRpc.ts'
import { agentPresetDescription, agentPresetLabel, defaultAgentPresetId, resolveAgentPresets } from '../pure/agentPreset.ts'
import type { AgentPresetOption } from '../pure/agentPreset.ts'
import { extendWindowCursor, pageMeetsWindow, windowCursorOf } from '../pure/historyWindow.ts'
import type { HistoryWindowCursor } from '../pure/historyWindow.ts'

/** Streaming snapshots are pushed at most this often; structural changes flush immediately. */
const FLUSH_INTERVAL_MS = 100
/** Mux reconnect backoff: 1s doubling up to this cap. */
const RECONNECT_MAX_MS = 30_000

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

/** Loose mirror of the `contextPressure` projection value (dsh-token-meter). */
interface ContextPressureLike {
  pressureTokens?: number
  projectedTokens?: number
  contextWindow?: number
}

/** Loose mirror of the `contextBreakdown` projection value (dsh-token-meter). */
interface ContextBreakdownLike {
  systemTokens: number
  toolsTokens: number
  messageTokens: number
}

/** Narrow an unknown projection value to ContextPressureLike; null when malformed. */
function asContextPressure(value: unknown): ContextPressureLike | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  for (const k of ['pressureTokens', 'projectedTokens', 'contextWindow']) {
    if (v[k] !== undefined && typeof v[k] !== 'number') return null
  }
  return value as ContextPressureLike
}

/** Narrow an unknown projection value to ContextBreakdownLike; null when malformed. */
function asContextBreakdown(value: unknown): ContextBreakdownLike | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (typeof v.systemTokens !== 'number' || typeof v.toolsTokens !== 'number' || typeof v.messageTokens !== 'number') {
    return null
  }
  return value as ContextBreakdownLike
}

/**
 * Composer ring data from the two token-meter projections. The numerator is
 * projectedTokens — the provider sample carried forward over surface movement,
 * so compaction shows immediately — with pressureTokens as the legacy
 * fallback (same rule as the web client's contextOccupancy). Undefined until
 * both a sample and the context window are known.
 */
function contextUsageOf(
  pressure: ContextPressureLike | undefined,
  breakdown: ContextBreakdownLike | undefined,
  turns: number | undefined,
): ChatState['contextUsage'] {
  const used = pressure?.projectedTokens ?? pressure?.pressureTokens
  if (used === undefined || pressure?.contextWindow === undefined) return undefined
  return {
    percent: Math.min(100, Math.round((used / pressure.contextWindow) * 100)),
    usedTokens: used,
    contextWindow: pressure.contextWindow,
    ...(breakdown ? { breakdown } : {}),
    ...(turns !== undefined ? { turns } : {}),
  }
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
  /** tool-workflow/* 事件折叠（run→phase→member 卡片，见 src/pure/workflowRun.ts）。 */
  private readonly workflowRuns = new WorkflowRunFolder()
  private pending: PendingRequest[] = []
  /** Latest session/queue snapshot, user-visible placements only. */
  private queue: QueuedItem[] = []
  /** Raw queued items by id, kept so queue edits can preserve non-text content. */
  private queueRaw = new Map<string, QueuedInboxItemLike>()
  /** Latest session/jobs snapshot, live jobs only. */
  private jobs: JobItem[] = []
  private sessionTitle: string | undefined
  /** True once any turn/start event exists (history or live stream): the agent preset locks then. */
  private turnStarted = false
  /** Agent preset picker state (blank sessions only): roster options + the pinned id. */
  private agentPresetOptions: AgentPresetOption[] = []
  private agentPresetCurrent: string | undefined
  /** Seq watermark of agentPresetCurrent：窗口分页下更早的页后到，旧选择不得覆盖新值。 */
  private agentPresetSeq = -1
  /** 历史窗口游标（窗口分页）：earliestSeq 之前的更早历史可按需 loadEarlier。 */
  private historyCursor: HistoryWindowCursor = { earliestSeq: undefined, hasMore: false }
  /** 一页更早历史正在加载（防重入；ChatState.loadingEarlier 驱动按钮加载态）。 */
  private loadingEarlier = false
  /** Watermark for the title projection's higher-seq-wins rule. */
  private titleSeq = -1
  /** Permission select from the `permissions` projection (higher seq wins). */
  private permissions: { options: Array<{ value: string; label: string }>; current: string } | undefined
  private permissionsSeq = -1
  /** Formatted stats line from the `sessionStats` projection (higher seq wins). */
  private statsLine: string | undefined
  /** Closed-turn count from the same projection, for the context meter's per-turn estimate. */
  private statsTurns: number | undefined
  private statsSeq = -1
  /** Context-occupancy projections (token-meter), each higher seq wins. */
  private contextPressure: ContextPressureLike | undefined
  private pressureSeq = -1
  private contextBreakdown: ContextBreakdownLike | undefined
  private breakdownSeq = -1
  /** Task list from the `todos` projection (last-wins 整表、turn/start 置 null). */
  private todos: ChatTodoItem[] | undefined
  private todosSeq = -1
  /** Image intake limits from the `imageLimits` projection; undefined = no pre-check. */
  imageLimits: ImageLimits | undefined
  /** Footer model pill, filled by refreshModels(). */
  private modelLabel: string | undefined
  /** Stored per-message ratings: host messageId → rating + optimistic-lock version. */
  private feedback = new Map<string, { rating: 'positive' | 'negative'; version: string }>()
  private ready = false
  /**
   * 服务端 running 位（session.list 摘要 + host/session-status 帧，由
   * ChatViewProvider 从 SessionsStore 中继；官方 handleRunning 同款数据
   * 渠道）。undefined = 基线还没覆盖本会话，回退到 mux 事件折叠的
   * hasOpenTurn()——history 未落地或纯排队期间折叠值可能偏差，服务段位
   * 是权威值。
   */
  private serverRunning: boolean | undefined
  private mux: vscode.Disposable | undefined
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private lastFlush = 0
  private disposed = false
  /** Highest event seq folded so far (history baseline or live stream). */
  private maxSeqFolded = -1
  /** Reconnect state: backoff step, pending timer, and whether the next
   *  session/subscribed frame must be gap-checked against maxSeqFolded. */
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private awaitingRebaseline = false
  /** While a reconnect re-baseline fetches history, live events buffer here
   *  and refold onto the fresh baseline (they may postdate the fetch). */
  private rebaselineInFlight = false
  private pendingLiveEvents: Array<{ event: SessionEventLike; view: ToolEventViewLike | undefined }> = []
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
    const workflowRuns = this.workflowRuns.view()
    return {
      sessionId: this.sessionId,
      sessionTitle: this.sessionTitle,
      messages: this.folder.messages(),
      pending: [...this.pending],
      queue: [...this.queue],
      jobs: [...this.jobs],
      ...(workflowRuns.length > 0 ? { workflowRuns } : {}),
      running: this.serverRunning ?? this.folder.hasOpenTurn(),
      canSend: this.ready && !this.disposed,
      loading: !this.ready,
      hasEarlierHistory: this.historyCursor.hasMore,
      loadingEarlier: this.loadingEarlier,
      modelLabel: this.modelLabel,
      permissions: this.permissions,
      statsLine: this.statsLine,
      todos: this.todos,
      contextUsage: contextUsageOf(this.contextPressure, this.contextBreakdown, this.statsTurns),
      // 只透给空会话：turn 一开跑 host 就锁定 preset（agent-preset-locked）。
      ...(!this.turnStarted && this.agentPresetOptions.length > 0 && this.agentPresetCurrent
        ? { agentPreset: { options: this.agentPresetOptions, current: this.agentPresetCurrent } }
        : {}),
    }
  }

  /**
   * 中继服务端 running 位（SessionsStore.runningFor）。只更新字段、不自行
   * push——值随调用方的下一次快照带出（store 变更时 ChatViewProvider 会重推）。
   */
  setServerRunning(running: boolean | undefined): void {
    this.serverRunning = running
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

  /**
   * Set (or clear, rating null) the user's rating on one assistant message.
   * The put/delete values do not reliably carry the fresh optimistic-lock
   * version, so the local map is rebuilt from a fresh list afterwards.
   */
  async rateMessage(messageId: string, rating: 'positive' | 'negative' | null): Promise<void> {
    const existing = this.feedback.get(messageId)
    if (rating === null) {
      if (!existing) return
      await deleteMessageFeedback(this.url, this.sessionId, messageId, existing.version)
    } else {
      await putMessageFeedback(this.url, this.sessionId, messageId, rating, existing?.version ?? null)
    }
    await this.refreshFeedback()
  }

  /** Fork this session at a completed turn's last event seq; returns the child session id. */
  async fork(atSeq: number): Promise<string> {
    return forkSession(this.url, this.sessionId, atSeq)
  }

  /**
   * 「加载更早」：以窗口首事件 seq 为 beforeSeq 向前翻一页（对齐官方
   * loadOlder），拼到已折叠消息的前面。页与窗口衔接不上（日志有洞）就
   * 停止向前翻——硬拼会把断档两侧的内容接成错位对话。
   */
  async loadEarlier(): Promise<void> {
    const beforeSeq = this.historyCursor.earliestSeq
    if (!this.ready || this.loadingEarlier || !this.historyCursor.hasMore || beforeSeq === undefined) return
    this.loadingEarlier = true
    this.push(true)
    try {
      const page = await sessionHistory(this.url, this.sessionId, beforeSeq)
      if (this.disposed) return
      if (!pageMeetsWindow(page, this.historyCursor)) {
        this.logger.warn(`chat: history page of ${this.sessionId} discontinuous before seq ${beforeSeq}; stop paging`)
        this.historyCursor = { ...this.historyCursor, hasMore: false }
        return
      }
      this.folder.prependHistory(page.events)
      // 更早一页补入缺失的 run-start 时，WorkflowRunFolder 按完整事件列表整段重建该 run。
      this.workflowRuns.prependHistory(page.events)
      for (const entry of page.events) this.foldPresetMarkers(entry.event)
      this.historyCursor = extendWindowCursor(this.historyCursor, page)
      // 新拼进来的消息可能带着已存的评分（messageFeedback 基线早已拉过）。
      applyFeedbackRatings(this.folder.messages(), this.feedback)
    } catch (error) {
      this.logger.warn(`chat: load earlier history failed for ${this.sessionId}: ${errorText(error)}`)
    } finally {
      this.loadingEarlier = false
      this.push(true)
    }
  }

  /** Fetch messageFeedback/list and merge the ratings into the folded messages. */
  private async refreshFeedback(): Promise<void> {
    const items = await listMessageFeedback(this.url, this.sessionId)
    if (this.disposed) return
    this.feedback.clear()
    for (const item of items) {
      if (!item || typeof item.messageId !== 'string') continue
      if (item.rating !== 'positive' && item.rating !== 'negative') continue
      this.feedback.set(item.messageId, {
        rating: item.rating,
        version: typeof item.version === 'string' ? item.version : '',
      })
    }
    if (applyFeedbackRatings(this.folder.messages(), this.feedback)) this.push(true)
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
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    this.mux?.dispose()
    this.emitter.dispose()
  }

  /**
   * History + projection baseline. Used by init and by reconnect re-baseline:
   * a full reset, so callers must not hold folded state across it. 只拉尾部
   * 一个窗口（对齐官方 Session.doOpen 的 maxMessages 窗口），更早的历史由
   * loadEarlier 按需向前翻；重连 re-baseline 同样只回到尾窗（官方 resync
   * 也是 reset the window and rerun open）。
   */
  private async loadBaseline(): Promise<void> {
    const page = await sessionHistory(this.url, this.sessionId)
    const projections = page.projections
    const events: HistoryEntryLike[] = page.events
    this.historyCursor = windowCursorOf(page)
    this.folder.applyHistory(events)
    this.workflowRuns.applyHistory(events)
    // Preset picker 的两个判定都来自会话日志：任何 turn/start = 已启动
    // （preset 锁定），最后一条 agent-preset/selected = 当前 preset。
    for (const entry of events) this.foldPresetMarkers(entry.event)
    // 窗口可能把全部 turn/start 切到界外（turn 跨页）：窗口里已有对话内容
    // （user/assistant 消息）同样说明会话早已开跑，preset 已锁定。
    if (this.folder.messages().some((m) => m.kind === 'user' || m.kind === 'assistant')) this.turnStarted = true
    this.maxSeqFolded = events.reduce((max, entry) => Math.max(max, entry.event.seq), -1)
    if (projections) {
      this.titleSeq = projections.asOfSeq
      const title = projections.values.title
      this.sessionTitle = typeof title === 'string' && title ? title : undefined
      // Other projections share the baseline watermark and the same
      // higher-seq-wins rule as the title.
      this.permissionsSeq = projections.asOfSeq
      this.statsSeq = projections.asOfSeq
      this.pressureSeq = projections.asOfSeq
      this.breakdownSeq = projections.asOfSeq
      this.todosSeq = projections.asOfSeq
      this.applyPermissionsValue(projections.values.permissions)
      this.applyStatsValue(projections.values.sessionStats)
      this.applyTodosValue(projections.values.todos)
      const limits = asImageLimits(projections.values.imageLimits)
      if (limits) this.imageLimits = limits
      const pressure = asContextPressure(projections.values.contextPressure)
      if (pressure) this.contextPressure = pressure
      const breakdown = asContextBreakdown(projections.values.contextBreakdown)
      if (breakdown) this.contextBreakdown = breakdown
    }
  }

  /** Baseline: fold the full history window, then subscribe the mux stream. */
  private async init(): Promise<void> {
    try {
      await this.loadBaseline()
    } catch (error) {
      this.logger.warn(`chat: history baseline failed for ${this.sessionId}: ${errorText(error)}`)
    }
    try {
      // Ancillary baseline; a feedback outage must not sink the history above.
      await this.refreshFeedback()
    } catch (error) {
      this.logger.warn(`chat: feedback baseline failed for ${this.sessionId}: ${errorText(error)}`)
    }
    if (this.disposed) return
    this.attach()
    this.ready = true
    this.push(true)
    // Model label rides no projection; fetch it once the stream is attached.
    this.refreshModels().catch((error: unknown) => {
      this.logger.warn(`chat: session.models failed for ${this.sessionId}: ${errorText(error)}`)
    })
    // Preset roster：空会话的选择 chip 与已开跑会话的头部 preset 标签
    // （id → roster 显示名，见 agentPresetLabelFor）共用同一份，所以开没开跑
    // 都拉一次（官方 AgentPresetLabel 同样在 roster 就绪后按 id 查 name）。
    // 拉取失败只记日志。
    this.refreshAgentPresets().catch((error: unknown) => {
      this.logger.warn(`chat: agentPreset.list failed for ${this.sessionId}: ${errorText(error)}`)
    })
  }

  /** Attach the mux stream; the close callback drives reconnect. */
  private attach(): void {
    this.mux = subscribeMuxEvents(
      this.url,
      this.logger,
      (frame) => this.onFrame(frame),
      () => this.onMuxClose(),
    )
  }

  /**
   * Stream dropped (host restart, hot reload, network blip, sleep/wake).
   * Re-subscribe with 1s doubling backoff capped at RECONNECT_MAX_MS; the
   * next session/subscribed frame gap-checks lastSeq and re-baselines when
   * events were missed while we were blind.
   */
  private onMuxClose(): void {
    if (this.disposed) return
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, RECONNECT_MAX_MS)
    this.reconnectAttempts += 1
    this.logger.warn(`chat: mux stream for ${this.sessionId} closed; reconnecting in ${delay}ms`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      if (this.disposed) return
      this.awaitingRebaseline = true
      this.attach()
    }, delay)
  }

  /**
   * Re-fold the full history baseline after a reconnect gap, then drain live
   * events buffered during the fetch. Queue/jobs/pending snapshots are left
   * alone: they re-converge on the host's next whole-snapshot frames.
   */
  private async rebaseline(): Promise<void> {
    this.rebaselineInFlight = true
    try {
      await this.loadBaseline()
    } catch (error) {
      this.logger.warn(`chat: reconnect re-baseline failed for ${this.sessionId}: ${errorText(error)}`)
    }
    this.rebaselineInFlight = false
    const buffered = this.pendingLiveEvents
    this.pendingLiveEvents = []
    for (const { event, view } of buffered) {
      this.foldPresetMarkers(event)
      this.workflowRuns.applyEvent(event)
      this.folder.applyEvent(event, view)
    }
    this.push(true)
  }

  /** Fold the preset-relevant markers of one session event (history or live). */
  private foldPresetMarkers(event: SessionEventLike): void {    if (event.type === 'turn/start') {
      this.turnStarted = true
      return
    }
    if (event.type === 'agent-preset/selected') {
      // higher seq wins：loadEarlier 会把更早的页后补进来，旧选择不能覆盖新值。
      if (event.seq <= this.agentPresetSeq) return
      const id = (event.data as Record<string, unknown> | undefined)?.agentPreset
      if (typeof id === 'string' && id) {
        this.agentPresetCurrent = id
        this.agentPresetSeq = event.seq
      }
    }
  }

  /**
   * Fetch the preset roster. The pinned id (log marker or roster default) is
   * the blank-session picker's current value; the options double as the
   * id → display-name table for the started-session header label.
   */
  private async refreshAgentPresets(): Promise<void> {
    const { presets } = await listAgentPresets(this.url)
    if (this.disposed) return
    const options = resolveAgentPresets(presets)
    if (options.length === 0) return
    this.agentPresetOptions = options
    if (!this.turnStarted && !this.agentPresetCurrent) this.agentPresetCurrent = defaultAgentPresetId(presets)
    this.push(true)
  }

  /**
   * Preset id → 头部标签的显示名（官方 AgentPresetLabel 的映射：roster 里有
   * 的用 roster name —— user preset 由此显示中文名而非裸 id；roster 未就绪
   * 或未知 id 回退 agentPresetLabel：已知 system id 中文名，否则原样 id）。
   */
  agentPresetLabelFor(id: string): string {
    return this.agentPresetOptions.find((o) => o.id === id)?.label ?? agentPresetLabel(id)
  }

  /**
   * Preset id → 头部标签悬停 tooltip 的描述（官方 AgentPresetLabel 的
   * tooltip）：与 agentPresetLabelFor 同源——roster 选项的 description；
   * roster 未就绪或未知 id 回退已知 system id 的中文描述，user preset 在
   * roster 未就绪前没有描述。
   */
  agentPresetDescriptionFor(id: string): string | undefined {
    return this.agentPresetOptions.find((o) => o.id === id)?.description ?? agentPresetDescription(id)
  }

  /**
   * Pin an agent preset on this (blank) session. Throws on failure — the host
   * answers agent-preset-locked once a turn exists; the caller only logs it.
   * On success the host also appends an agent-preset/selected event, so the
   * stream confirms the same id shortly after.
   */
  async setAgentPreset(id: string): Promise<void> {
    const selected = await selectAgentPreset(this.url, this.sessionId, id)
    this.agentPresetCurrent = selected
    this.push(true)
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
    this.statsTurns = stats.turns
  }

  /**
   * Fold one `todos` projection value. null（turn/start 清空）和畸形值都归为
   * 无清单（undefined）；数组整表透传（可能为空数组——webview 不渲染）。
   */
  private applyTodosValue(value: unknown): void {
    if (value === null || value === undefined || !Array.isArray(value)) {
      this.todos = undefined
      return
    }
    this.todos = value.filter(
      (t): t is ChatTodoItem =>
        typeof t === 'object' &&
        t !== null &&
        typeof (t as { content?: unknown }).content === 'string' &&
        ((t as { status?: unknown }).status === 'pending' ||
          (t as { status?: unknown }).status === 'in_progress' ||
          (t as { status?: unknown }).status === 'completed'),
    )
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
      case 'session/subscribed': {
        this.logger.info(`chat: subscribed to ${this.sessionId} (lastSeq ${String(payload.lastSeq)})`)
        // A healthy subscription resets the backoff ladder.
        this.reconnectAttempts = 0
        if (!this.awaitingRebaseline) return
        this.awaitingRebaseline = false
        // Reconnected: events between maxSeqFolded and lastSeq are lost.
        // Only a gap justifies the full re-baseline.
        const lastSeq = typeof payload.lastSeq === 'number' ? payload.lastSeq : -1
        if (lastSeq > this.maxSeqFolded) void this.rebaseline()
        return
      }
      case 'session/event': {
        const event = payload.event as SessionEventLike
        const view = payload.view as ToolEventViewLike | undefined
        if (typeof event.seq === 'number' && event.seq > this.maxSeqFolded) this.maxSeqFolded = event.seq
        // A re-baseline fetch is in flight: buffer so the fresh baseline can
        // refold events that may postdate the fetch window.
        if (this.rebaselineInFlight) {
          this.pendingLiveEvents.push({ event, view })
          return
        }
        // turn/start 与 agent-preset/selected 不进对话流，但影响 preset chip
        // 的可见性与当前值——状态变了就补一次 push。tool-workflow/* 折叠成
        // workflow 运行卡片（workflowChanged），同样触发补推。
        const presetAffecting = event.type === 'turn/start' || event.type === 'agent-preset/selected'
        this.foldPresetMarkers(event)
        const workflowChanged = this.workflowRuns.applyEvent(event)
        // Chunk deltas stream-throttle; every other event is structural.
        if (this.folder.applyEvent(event, view) || presetAffecting || workflowChanged) this.push(event.type !== 'assistant/chunk')
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
          case 'contextPressure': {
            if (seq <= this.pressureSeq) return
            const pressure = asContextPressure(payload.value)
            if (!pressure) return
            this.pressureSeq = seq
            this.contextPressure = pressure
            this.push(true)
            return
          }
          case 'contextBreakdown': {
            if (seq <= this.breakdownSeq) return
            const breakdown = asContextBreakdown(payload.value)
            if (!breakdown) return
            this.breakdownSeq = seq
            this.contextBreakdown = breakdown
            this.push(true)
            return
          }
          case 'todos': {
            if (seq <= this.todosSeq) return
            this.todosSeq = seq
            this.applyTodosValue(payload.value)
            this.push(true)
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
