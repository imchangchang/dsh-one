/**
 * Conversation folding: turns the raw dsh session-event stream (history pages
 * plus live mux increments) into the renderable ChatMessage[] of
 * src/pure/chatContract.ts. Pure logic — no `vscode` import.
 *
 * The wire types below are hand-written loose mirrors of the dsh contracts
 * (dsh-session SessionEvent, dsh-llm StreamChunk, dsh-tools presentation);
 * the extension does not depend on those packages, so the folder reads
 * payloads defensively and ignores what it does not know.
 */
import type {
  ChatAssistantMessage,
  ChatBlock,
  ChatCommandMessage,
  ChatCompactionMessage,
  ChatFile,
  ChatImage,
  ChatMessage,
  ChatRetryBlock,
  ChatToolBlock,
  ChatTurnTiming,
} from './chatContract.ts'

/** Subset of dsh-llm's StreamChunk the folder folds. */
export type StreamChunkData =
  | { type: 'block-start'; index: number; blockType: string }
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'reasoning-delta'; index: number; text: string }
  | { type: 'tool-call-delta'; index: number; id: string; name?: string; argumentsDelta: string }
  | { type: 'block-end'; index: number; block: { type: string; text?: unknown } }
  | { type: 'usage'; usage: unknown }
  | { type: 'finish'; reason: unknown }

/** Loose SessionEvent mirror; `data` is narrowed per `type` inside the folder. */
export interface SessionEventLike {
  type: string
  seq: number
  time?: number
  data?: unknown
  /**
   * Surface placement of surface events (user/message, assistant/message,
   * tool/result): 'append' 或 {op:'replace',…}。checkpoint user/message 靠
   * 它识别（替换型 + source.plugin='compact' 才是压缩检查点，不能当普通用户
   * 消息折叠）。非 surface 事件不带此字段。
   */
  surfaceOp?: unknown
}

/**
 * Loose ToolEventView mirror covering the fields the folder extracts
 * (generic title/rawInput/locations, terminal title/description/cwd/output,
 * diff title/diffs). Absent view means the generic fallback card.
 */
export interface ToolEventViewLike {
  for: 'call' | 'result'
  view: {
    card?: string
    kind?: string
    title?: string
    description?: string
    cwd?: string
    rawInput?: unknown
    output?: string
    exitCode?: number
    locations?: Array<{ path: string; line?: number }>
    diffs?: Array<{ path: string; oldText: string | null; newText: string }>
  }
}

/** One history page entry: the raw event plus its pagination-time view. */
export interface HistoryEntryLike {
  event: SessionEventLike
  view?: ToolEventViewLike
}

interface ChunkEventData {
  turn: number
  step: number
  chunk: StreamChunkData
}

interface AssistantMessageEventData {
  turn: number
  step: number
  message?: { id?: string; content?: Array<{ type: string; text?: unknown }> }
  interrupted?: true
  /** Token accounting from the model adapter; outputTokens feeds the tps figure. */
  usage?: unknown
}

interface ToolCallEventData {
  turn: number
  step: number
  callId: string
  name: string
  arguments?: string
}

interface ToolResultEventData {
  turn: number
  step: number
  message?: {
    content?: Array<{
      toolCallId?: string
      content?: Array<{ type: string; text?: unknown }>
      isError?: boolean
    }>
  }
  error?: { name: string; code: string }
  /** tool 私有的 presentation 载荷（dsh-session 契约可选字段），原样透传。 */
  meta?: unknown
}

/** Join the text blocks of a message content array; other block kinds are skipped. */
function textOfBlocks(content: Array<{ type: string; text?: unknown }> | undefined): string {
  if (!Array.isArray(content)) return ''
  return content
    .filter((b) => b && (b.type === 'text' || b.type === 'reasoning') && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n')
}

/**
 * 一次调用 view 声明产出/改写的文件路径（对齐官方 dsh-client-ui-deliverables
 * 的 producedPaths，按渲染意图判定而非工具名）：diff 卡，或 card 为 generic
 * 且 kind 为 edit（str_replace_editor 的 insert 呈现形态）的 locations。
 * 其余卡片无产物可开——read 只是看了一眼，delete 已无文件可开，terminal 只是
 * 跑命令。root 调用 view 才进累积；嵌套 Code Mode 派发不独立贡献。
 */
function producedPathsOf(view: ToolEventViewLike['view'] | undefined): string[] {
  if (!view || typeof view.card !== 'string') return []
  if (view.card === 'diff') return (view.locations ?? []).map((l) => l.path).filter((p): p is string => typeof p === 'string')
  if (view.card === 'generic' && view.kind === 'edit') {
    return (view.locations ?? []).map((l) => l.path).filter((p): p is string => typeof p === 'string')
  }
  return []
}

/**
 * todo_write 调用 args 的 planSummary（对齐官方 dsh-client-ui-tool 的
 * planSummary/TodoRow）：解析该次调用 `data.arguments` 的 JSON 字符串
 * （`{todos:[{content,status}]}`），done=completed 数、total=条数、
 * activeContent=首个 in_progress 条目的 content（须非空字符串，否则 null）、
 * activeExtra=其余 in_progress 数。解析失败或缺 todos 数组时返回 undefined
 * （工具卡不渲染任务摘要，回落通用行）。
 */
function planSummaryOf(argumentsRaw: string | undefined): ChatToolBlock['todos'] | undefined {
  if (!argumentsRaw || !argumentsRaw.trim()) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(argumentsRaw)
  } catch {
    return undefined
  }
  const todos = (parsed as { todos?: unknown } | null | undefined)?.todos
  if (!Array.isArray(todos)) return undefined
  const items = todos.filter(
    (t): t is { content: unknown; status: unknown } =>
      typeof t === 'object' && t !== null && typeof (t as { content?: unknown }).content === 'string',
  )
  if (items.length === 0) return undefined
  const active = items.filter((t) => t.status === 'in_progress')
  const firstActive = active[0]
  return {
    done: items.filter((t) => t.status === 'completed').length,
    total: items.length,
    activeContent:
      typeof firstActive?.content === 'string' && firstActive.content.length > 0 ? firstActive.content : null,
    // 首个 in_progress 之外还有几个进行中；没有进行中项时为 0（web 侧同样
    // 只在 >0 时显示 +N，负值只是公式残渣）。
    activeExtra: Math.max(0, active.length - 1),
  }
}

/**
 * Extract image blocks of a message content array as durable attachment
 * references. dsh stores image bytes in its attachment store, so the content
 * part carries `{ attachment: { attachmentId, mediaType, ... } }` instead of
 * inline data; the UI fetches bytes lazily via session.attachment.
 */
export function imagesOfBlocks(content: unknown): ChatImage[] {
  if (!Array.isArray(content)) return []
  const images: ChatImage[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const b = block as { type?: unknown; attachment?: unknown }
    if (b.type !== 'image') continue
    const a = b.attachment as
      | { attachmentId?: unknown; mediaType?: unknown; name?: unknown; width?: unknown; height?: unknown }
      | undefined
    if (!a || typeof a.attachmentId !== 'string' || !a.attachmentId) continue
    images.push({
      attachmentId: a.attachmentId,
      mediaType: typeof a.mediaType === 'string' ? a.mediaType : 'image/png',
      ...(typeof a.name === 'string' ? { name: a.name } : {}),
      ...(typeof a.width === 'number' ? { width: a.width } : {}),
      ...(typeof a.height === 'number' ? { height: a.height } : {}),
    })
  }
  return images
}

/**
 * File attachments ride the prompt text as `<attachment>PATH</attachment>`
 * lines (dsh's PromptContentPart only has text and image parts). Split them
 * back out so the UI renders chips instead of raw paths; the wrapper stays
 * model-legible for the agent and in dsh's own web UI.
 */
const ATTACHMENT_LINE = /^<attachment>(.+)<\/attachment>$/

function splitAttachments(text: string): { text: string; files: ChatFile[] } {
  const files: ChatFile[] = []
  const kept: string[] = []
  for (const line of text.split('\n')) {
    const match = ATTACHMENT_LINE.exec(line.trim())
    if (match) {
      const p = match[1]
      files.push({ name: p.split('/').pop() ?? p, path: p })
    } else {
      kept.push(line)
    }
  }
  return { text: kept.join('\n').replace(/\n+$/, ''), files }
}

/**
 * 压缩 checkpoint 识别（对齐官方 client 的 isCompactionCheckpoint）：替换型
 * surface user/message（surfaceOp ≠ 'append'）+ source 带后端无关标记
 * {kind:'plugin', plugin:'compact', compactionId}。返回配对身份；非 checkpoint
 * 返回 undefined（继续按普通用户消息折叠）。
 */
function compactCheckpoint(event: SessionEventLike): { compactionId: string; sourceCommandId?: string } | undefined {
  if (event.type !== 'user/message' || event.surfaceOp === undefined || event.surfaceOp === 'append') return undefined
  const source = (event.data as { source?: unknown } | undefined)?.source as
    | { kind?: unknown; plugin?: unknown; compactionId?: unknown; sourceCommandId?: unknown }
    | undefined
  if (source?.kind !== 'plugin' || source.plugin !== 'compact') return undefined
  if (typeof source.compactionId !== 'string' || !source.compactionId) return undefined
  return {
    compactionId: source.compactionId,
    ...(typeof source.sourceCommandId === 'string' && source.sourceCommandId
      ? { sourceCommandId: source.sourceCommandId }
      : {}),
  }
}

/**
 * compaction/summary 事件 → 摘要与计数（对齐官方 compactSummary 的防御读取）：
 * summary = 全部 text 块的拼接（空串 → null），items = shadowedSeqs 长度，
 * tokens = shadowedTokenCount；字段缺失/畸形时对应 null。
 */
function compactionSummaryOf(data: Record<string, unknown>): {
  summary: string | null
  items: number | null
  tokens: number | null
} {
  let summary: string | null = null
  if (Array.isArray(data.summary)) {
    const text = data.summary
      .filter(
        (b): b is { type: string; text: unknown } =>
          typeof b === 'object' && b !== null && (b as { type?: unknown }).type === 'text',
      )
      .map((b) => (typeof b.text === 'string' ? b.text : ''))
      .join('')
    summary = text.trim() === '' ? null : text
  }
  const seqs = data.shadowedSeqs
  const items =
    Array.isArray(seqs) && seqs.every((s) => Number.isSafeInteger(s) && (s as number) >= 0) ? seqs.length : null
  const rawTokens = data.shadowedTokenCount
  const tokens = Number.isSafeInteger(rawTokens) && (rawTokens as number) >= 0 ? (rawTokens as number) : null
  return { summary, items, tokens }
}

/**
 * Whether a stream chunk carries visible model output — the first-token
 * boundary the turn timing shares with the official `sessionStats` projection
 * (dsh-llm isTokenDelta). Empty deltas (heartbeats, empty tool-call frames)
 * do not count as a first token.
 */
function isTokenDeltaLike(chunk: StreamChunkData): boolean {
  if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') return chunk.text.length > 0
  if (chunk.type === 'tool-call-delta') return chunk.argumentsDelta.length > 0
  return false
}

/** Non-negative finite outputTokens from an assistant/message usage payload; null when absent/malformed. */
function outputTokensOf(usage: unknown): number | null {
  if (!usage || typeof usage !== 'object') return null
  const value = (usage as { outputTokens?: unknown }).outputTokens
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * Stateful folder over one session's event log. Feed it a history window with
 * applyHistory (full reset — the reconnect baseline), then live events with
 * applyEvent. One turn folds into one assistant message whose blocks follow
 * event order: streamed text/reasoning (chunk block-index aware) and tool
 * cards paired by callId.
 */
export class ConversationFolder {
  private msgs: ChatMessage[] = []
  /** The open assistant message of the current turn, null between turns. */
  private current: ChatAssistantMessage | null = null
  /** Chunk block index → position in current.blocks (per step). */
  private blockPos = new Map<number, number>()
  /** `${turn}:${step}` of the step that streamed chunks, for dedupe. */
  private stepKey: string | null = null
  /** Whether the current step already contributed streamed/folded content. */
  private stepStreamed = false
  private openTurns = new Set<number>()
  private tools = new Map<string, ChatToolBlock>()
  /** tool/call 时的 call view（按 callId；无 view 存 undefined 占位，结果不再补）。 */
  private callViews = new Map<string, ToolEventViewLike['view'] | undefined>()
  /** 按 turn 累积的产物条目（{seq, path}，path 首次出现去重），turn/end 时挂到消息。 */
  private produced = new Map<number, Array<{ seq: number; path: string }>>()
  /** 每个 turn 已累积过的 path（首次出现去重）。 */
  private producedSeen = new Map<number, Set<string>>()
  /**
   * compactionId → compaction/summary 事件提取的摘要与计数（log-only 事件，
   * 不直接进消息流；由随后紧邻的 checkpoint user/message 消费。官方契约保证
   * 两者同页——prependHistory 的 scratch folder 也能配对）。
   */
  private compactions = new Map<string, { summary: string | null; items: number | null; tokens: number | null }>()
  /**
   * retryId → 重试行 + 所属 turn。同链多次尝试（llm/retry 递增 retry）原地
   * 更新；llm/retry-started 翻 started，turn/end 时仍未 started 的翻 cancelled。
   */
  private retries = new Map<string, { block: ChatRetryBlock; turn: number }>()
  /** Turn → turn/start event time (epoch ms); only window-covered turns present. */
  private turnStart = new Map<number, number>()
  /** `${turn}:${step}` → step/start event time. */
  private stepStart = new Map<string, number>()
  /** `${turn}:${step}` → time of the first non-empty token delta (isTokenDeltaLike). */
  private firstToken = new Map<string, number>()
  /** `${turn}:${step}` → assistant/message event time + its usage outputTokens. */
  private stepCompleted = new Map<string, { time: number; outputTokens: number | null }>()

  /** Reset and fold a full history window (initial load / re-baseline). */
  applyHistory(entries: readonly HistoryEntryLike[]): void {
    this.msgs = []
    this.current = null
    this.blockPos.clear()
    this.stepKey = null
    this.stepStreamed = false
    this.openTurns.clear()
    this.tools.clear()
    this.callViews.clear()
    this.produced.clear()
    this.producedSeen.clear()
    this.compactions.clear()
    this.retries.clear()
    this.turnStart.clear()
    this.stepStart.clear()
    this.firstToken.clear()
    this.stepCompleted.clear()
    for (const entry of entries) this.applyEvent(entry.event, entry.view)
  }

  /**
   * Prepend an older history page (「加载更早」). The host aligns page
   * boundaries to message boundaries, so the older page folds in a scratch
   * folder and its (complete) messages go in front of the current ones;
   * existing fold state (the open streaming turn, tool pairing) is untouched.
   */
  prependHistory(entries: readonly HistoryEntryLike[]): void {
    if (entries.length === 0) return
    const older = new ConversationFolder()
    for (const entry of entries) older.applyEvent(entry.event, entry.view)
    this.msgs = [...older.messages(), ...this.msgs]
  }

  /** Fold one event; returns true when the rendered messages changed. */
  applyEvent(event: SessionEventLike, view?: ToolEventViewLike): boolean {
    const data = (event.data ?? {}) as Record<string, unknown>
    switch (event.type) {
      case 'turn/start': {
        this.openTurns.add(Number(data.turn))
        this.current = null
        this.stepKey = null
        this.stepStreamed = false
        // Timing baseline: runMs needs the turn start inside the window.
        if (typeof event.time === 'number' && typeof data.turn === 'number') {
          this.turnStart.set(data.turn, event.time)
        }
        return true
      }
      case 'turn/end': {
        this.openTurns.delete(Number(data.turn))
        const kind = (data.reason as { kind?: string } | undefined)?.kind
        // Turn-level failure (e.g. model context overflow → 401): fold into a
        // turnError on the assistant message instead of dropping it, matching
        // the official web client's TurnErrorItem.
        const turnError =
          kind === 'error'
            ? ((): { message: string; code?: string } | undefined => {
                const err = (data.reason as { error?: unknown } | undefined)?.error as
                  | { message?: unknown; code?: unknown }
                  | undefined
                if (typeof err?.message !== 'string' || !err.message) return undefined
                return typeof err.code === 'string' && err.code
                  ? { message: err.message, code: err.code }
                  : { message: err.message }
              })()
            : undefined
        const interrupted = kind === 'aborted' || kind === 'interrupted'
        // At least one step reached its output-token ceiling (dsh turn/end
        // reason kind 'max-tokens'): rendered as the official TurnMaxTokensItem.
        const maxTokens = kind === 'max-tokens'
        // 所属 turn 关闭时，仍未 llm/retry-started 的重试等待被取消（对齐官方
        // isClosed 语义：scheduled attempt cancelled once the boundary closes）。
        const turn = Number(data.turn)
        if (Number.isFinite(turn)) {
          for (const entry of this.retries.values()) {
            if (entry.turn === turn && entry.block.retryState === 'scheduled') entry.block.retryState = 'cancelled'
          }
        }
        let msg = this.current
        if (!msg) {
          // current 可能已被 turn 中途注入的 user/message 切断为 null：按
          // ensureAssistant 的 id 规则从尾部找回本 turn 最后一条 assistant
          // 消息（turn/end 落在历史窗口外时找不到，不标记 turnEnd）。
          if (Number.isFinite(turn)) {
            const id = `assistant-t${turn}`
            for (let i = this.msgs.length - 1; i >= 0; i--) {
              const m = this.msgs[i]
              if (m.kind === 'assistant' && m.id === id) {
                msg = m
                break
              }
            }
          }
        }
        if (!msg && (turnError || interrupted || maxTokens)) {
          // The turn failed / was cancelled / hit the token cap before any
          // assistant content: still surface an (empty) assistant message so
          // the error row / 已中断 marker / maxTokens notice has a home.
          msg = {
            kind: 'assistant',
            id: `assistant-s${event.seq}`,
            blocks: [],
            complete: true,
            seq: event.seq,
          }
          this.msgs.push(msg)
        }
        if (msg) {
          msg.complete = true
          // The turn's final seq is the fork point for session.fork.
          msg.seq = event.seq
          msg.turnEnd = true
          if (interrupted) msg.interrupted = true
          if (turnError) msg.turnError = turnError
          if (maxTokens) msg.maxTokens = true
          // 产物（对齐官方 ProducedFiles）：本 turn 累积的路径，首次出现顺序，
          // 只挂 turnEnd 消息；seq 晚于 turn/end 的迟交 tool/result 不参与。
          const entries = this.produced.get(Number(data.turn))
          if (entries) {
            const paths = entries.filter((p) => p.seq <= event.seq).map((p) => p.path)
            if (paths.length > 0) msg.producedFiles = paths
          }
          // Turn-level timing rides the final message's action row (web parity).
          if (typeof event.time === 'number' && Number.isFinite(Number(data.turn))) {
            const timing = this.turnTimingOf(Number(data.turn), event.time)
            if (timing) msg.timing = timing
          }
        }
        this.current = null
        this.stepKey = null
        return true
      }
      case 'user/message': {
        // 压缩 checkpoint（替换型 user/message + source.plugin='compact'）：
        // 不渲染成用户气泡，折叠成压缩标记卡（对齐官方 CompactionItem）。
        // 手动 /compact（sourceCommandId 命中窗口内命令卡）合并进命令卡，
        // 命令卡在窗口外或自动压缩时独立成一条消息。
        const checkpoint = compactCheckpoint(event)
        if (checkpoint) {
          const info = this.compactions.get(checkpoint.compactionId)
          const compaction: { summary: string | null; items: number | null; tokens: number | null } = {
            summary: info?.summary ?? null,
            items: info?.items ?? null,
            tokens: info?.tokens ?? null,
          }
          if (checkpoint.sourceCommandId) {
            const cmd = this.msgs.find(
              (m): m is ChatCommandMessage => m.kind === 'command' && m.id === checkpoint.sourceCommandId,
            )
            if (cmd) cmd.compaction = compaction
            else this.msgs.push({ kind: 'compaction', id: checkpoint.compactionId, ...compaction })
          } else {
            this.msgs.push({ kind: 'compaction', id: checkpoint.compactionId, ...compaction })
          }
          // 与普通 user/message 一样切断当前 assistant 消息：checkpoint 之后
          // 的内容另起一条（官方按 seq 位置渲染成独立节点）。
          if (this.current) this.current.complete = true
          this.current = null
          this.stepKey = null
          return true
        }
        const rawText = textOfBlocks(data.content as Array<{ type: string; text?: unknown }> | undefined)
        const { text, files } = splitAttachments(rawText)
        const images = imagesOfBlocks(data.content)
        const id = typeof data.id === 'string' && data.id ? data.id : `user-${event.seq}`
        // Host-injected context (AGENTS.md instructions, runtime snapshots)
        // arrives as user/message too, tagged by data.source.kind. Genuine
        // human input is kind 'user'. Fallback: the <system-reminder> prefix.
        const sourceKind = (data.source as { kind?: string } | undefined)?.kind
        // session-reference 注入上下文紧跟在触发它的直接用户消息之后，其
        // source.references 带着 {sessionId, label}——直接消息落盘的是可读
        // @label 文本，回挂过去气泡才能把引用渲染成可点击链接。
        if (sourceKind === 'session-reference') {
          const refs = (data.source as { references?: unknown } | undefined)?.references
          const prev = this.msgs[this.msgs.length - 1]
          if (Array.isArray(refs) && prev?.kind === 'user' && prev.context === undefined) {
            prev.references = refs.flatMap((r) => {
              const item = r as { sessionId?: unknown; label?: unknown }
              return typeof item?.sessionId === 'string' && typeof item?.label === 'string'
                ? [{ sessionId: item.sessionId, label: item.label }]
                : []
            })
          }
        }
        const context =
          sourceKind && sourceKind !== 'user'
            ? sourceKind
            : !sourceKind && text.startsWith('<system-reminder>')
              ? 'legacy-instructions'
              : undefined
        this.msgs.push({
          kind: 'user',
          id,
          text,
          ...(context ? { context } : {}),
          ...(images.length > 0 ? { images } : {}),
          ...(files.length > 0 ? { files } : {}),
        })
        // turn 中途插入的 user/message（子代理完成通知等注入上下文）会切断
        // 当前 assistant 消息：下一步的 chunk 会另起一条，被丢下的这条再也
        // 等不到 assistant/message 或 turn/end 来标 complete（tool/call 刚把
        // 它标回 false），不补一下 webview 会在它尾巴上永久挂流式光标。
        if (this.current) this.current.complete = true
        this.current = null
        this.stepKey = null
        return true
      }
      case 'step/start': {
        // TTFT baseline: stepStartTime of each step (window-scoped).
        if (typeof event.time === 'number' && typeof data.turn === 'number' && typeof data.step === 'number') {
          this.stepStart.set(`${data.turn}:${data.step}`, event.time)
        }
        return false
      }
      case 'assistant/chunk':
        return this.applyChunk(event.data as ChunkEventData, event.seq, event.time)
      case 'assistant/message':
        return this.applyAssistantMessage(event.data as AssistantMessageEventData, event.seq, event.time)
      case 'tool/call':
        return this.applyToolCall(event.data as ToolCallEventData, view, event.seq)
      case 'tool/result':
        return this.applyToolResult(event.data as ToolResultEventData, view, event.seq)
      case 'command/run': {
        const commandId = typeof data.commandId === 'string' && data.commandId ? data.commandId : `command-${event.seq}`
        const name = typeof data.name === 'string' ? data.name : 'command'
        const args = typeof data.args === 'string' && data.args.trim() ? data.args.trim() : undefined
        this.msgs.push({ kind: 'command', id: commandId, name, ...(args ? { args } : {}), status: 'running' })
        return true
      }
      case 'command/done': {
        const commandId = typeof data.commandId === 'string' ? data.commandId : ''
        // Pair by id; a done without its run in the window folds to nothing.
        const msg = this.msgs.find((m): m is ChatCommandMessage => m.kind === 'command' && m.id === commandId)
        if (!msg) return false
        msg.status = data.kind === 'error' ? 'error' : 'success'
        if (typeof data.text === 'string' && data.text.trim()) msg.text = data.text
        return true
      }
      case 'llm/retry': {
        // Durable record of one provider-routed retry scheduled after a failed
        // request attempt. 折叠成承载 turn 的消息里的重试行（对齐官方
        // ModelRetryItem）；同 retryId 的后续尝试原地更新（保持首次位置）。
        const r = (data as { retryId?: unknown }).retryId
        if (typeof r !== 'string' || !r) return false
        const failure = (data as { failure?: unknown }).failure as { message?: unknown } | undefined
        if (typeof failure?.message !== 'string' || !failure.message) return false
        const entry = this.retries.get(r)
        if (entry) {
          const b = entry.block
          b.retry = Number(data.retry) || b.retry
          b.delayMs = Number(data.delayMs) || b.delayMs
          b.failure = { message: failure.message }
          if (b.retryState !== 'scheduled') b.retryState = 'scheduled'
          return true
        }
        // 只在新建链时确保承载消息；后续尝试原地更新，不再动消息结构。
        const msg = this.ensureAssistant(Number(data.turn), event.seq)
        const block: ChatRetryBlock = {
          type: 'retry',
          retry: Number(data.retry) || 1,
          mode: (data as { mode?: unknown }).mode === 'always' ? 'always' : 'normal',
          delayMs: Number(data.delayMs) || 0,
          failure: { message: failure.message },
          retryState: 'scheduled',
          ...(typeof event.time === 'number' ? { time: event.time } : {}),
        }
        if ((data as { mode?: unknown }).mode !== 'always') {
          const max = Number((data as { maxRetries?: unknown }).maxRetries)
          if (Number.isSafeInteger(max) && max >= 0) block.maxRetries = max
        }
        msg.blocks.push(block)
        this.retries.set(r, { block, turn: Number(data.turn) })
        return true
      }
      case 'llm/retry-started': {
        // Durable transition: the retry wait succeeded, the next attempt starts.
        const r = (data as { retryId?: unknown }).retryId
        if (typeof r !== 'string' || !r) return false
        const entry = this.retries.get(r)
        if (!entry) return false
        if (entry.block.retryState !== 'started') {
          entry.block.retryState = 'started'
          return true
        }
        return false
      }
      case 'compaction/summary': {
        // Log-only metering event: the summary content + shadow price of one
        // compaction. 不直接进消息流，交给随后紧邻的 checkpoint user/message。
        const compactionId = typeof data.compactionId === 'string' && data.compactionId ? data.compactionId : undefined
        if (!compactionId) return false
        this.compactions.set(compactionId, compactionSummaryOf(data))
        return true
      }
      default:
        return false
    }
  }

  /** Renderable snapshot. The live array is returned; postMessage serializes it. */
  messages(): ChatMessage[] {
    return this.msgs
  }

  /** A turn without its turn/end: the session is mid-turn. */
  hasOpenTurn(): boolean {
    return this.openTurns.size > 0
  }

  /**
   * Aggregate the recorded step timings of one closed turn (web parity:
   * dsh-client-ui-conversation deriveTurnMetrics). TTFT is the turn's
   * lowest-step request-dispatch-to-first-token reading; throughput divides
   * summed output tokens by summed decode wall time, counting only steps that
   * carry both. The clock anchor is the last assistant/message's event time,
   * falling back to the turn/end time when no step completed in-window.
   * Every figure degrades gracefully to absent when its events fell outside
   * the loaded window.
   */
  private turnTimingOf(turn: number, endTime: number): ChatTurnTiming | undefined {
    const prefix = `${turn}:`
    let firstStep: number | null = null
    let firstStepTtftMs: number | null = null
    let decodeMs = 0
    let outputTokens = 0
    let sampled = false
    let lastMessageTime: number | undefined
    let lastMessageStep = -1
    for (const [key, firstTokenTime] of this.firstToken) {
      if (!key.startsWith(prefix)) continue
      const step = Number(key.slice(prefix.length))
      const stepStart = this.stepStart.get(key)
      const ttftMs = stepStart === undefined ? null : Math.max(0, firstTokenTime - stepStart)
      if (firstStep === null || step < firstStep) {
        firstStep = step
        firstStepTtftMs = ttftMs
      }
      const completed = this.stepCompleted.get(key)
      if (!completed) continue
      const decode = Math.max(0, completed.time - firstTokenTime)
      if (completed.outputTokens !== null) {
        decodeMs += decode
        outputTokens += completed.outputTokens
        sampled = true
      }
      if (step > lastMessageStep) {
        lastMessageStep = step
        lastMessageTime = completed.time
      }
    }
    const startTime = this.turnStart.get(turn)
    const timing: ChatTurnTiming = { time: lastMessageTime ?? endTime }
    if (startTime !== undefined) timing.runMs = Math.max(0, endTime - startTime)
    if (firstStepTtftMs !== null) timing.ttftMs = firstStepTtftMs
    if (sampled && decodeMs > 0) timing.tokensPerSecond = outputTokens / (decodeMs / 1000)
    return timing
  }

  private ensureAssistant(turn: number, seq: number): ChatAssistantMessage {
    // 窗口分页下 turn/start 可能落在窗口外（长 turn 的工具事件就能把页填满）；
    // 窗口是日志的连续后缀，内容事件的 turn 没有配对的 turn/end 就是还在跑。
    if (Number.isFinite(turn)) this.openTurns.add(turn)
    if (this.current) {
      this.current.seq = seq
      return this.current
    }
    const msg: ChatAssistantMessage = {
      kind: 'assistant',
      id: Number.isFinite(turn) ? `assistant-t${turn}` : `assistant-s${seq}`,
      blocks: [],
      complete: false,
      seq,
    }
    this.msgs.push(msg)
    this.current = msg
    return msg
  }

  private applyChunk(data: ChunkEventData, seq: number, time?: number): boolean {
    const chunk = data?.chunk
    if (!chunk || typeof chunk.type !== 'string') return false
    const msg = this.ensureAssistant(Number(data.turn), seq)
    const key = `${Number(data.turn)}:${Number(data.step)}`
    if (key !== this.stepKey) {
      this.stepKey = key
      this.stepStreamed = false
      this.blockPos.clear()
    }
    // First-token boundary of the step: first non-empty delta's event time.
    if (time !== undefined && !this.firstToken.has(key) && isTokenDeltaLike(chunk)) {
      this.firstToken.set(key, time)
    }
    switch (chunk.type) {
      case 'block-start': {
        if (chunk.blockType !== 'text' && chunk.blockType !== 'reasoning') return false
        this.stepStreamed = true
        this.blockPos.set(chunk.index, msg.blocks.length)
        msg.blocks.push({ type: chunk.blockType, text: '' } as ChatBlock)
        msg.complete = false
        return true
      }
      case 'text-delta':
      case 'reasoning-delta': {
        const type = chunk.type === 'text-delta' ? 'text' : 'reasoning'
        this.stepStreamed = true
        let pos = this.blockPos.get(chunk.index)
        if (pos === undefined || msg.blocks[pos]?.type !== type) {
          // Tolerate a delta whose block-start fell outside the history window.
          pos = msg.blocks.length
          this.blockPos.set(chunk.index, pos)
          msg.blocks.push({ type, text: '' } as ChatBlock)
        }
        msg.complete = false
        if (!chunk.text) return false
        const block = msg.blocks[pos] as { text: string }
        block.text += chunk.text
        return true
      }
      case 'block-end': {
        const type = chunk.block?.type
        if (type !== 'text' && type !== 'reasoning') return false
        const text = typeof chunk.block?.text === 'string' ? chunk.block.text : undefined
        const pos = this.blockPos.get(chunk.index)
        if (pos === undefined) {
          msg.blocks.push({ type, text: text ?? '' } as ChatBlock)
          return true
        }
        // The assembled block is authoritative; adopt it when it disagrees.
        const block = msg.blocks[pos] as { text: string }
        if (text !== undefined && text !== block.text) {
          block.text = text
          return true
        }
        return false
      }
      default:
        // tool-call-delta / usage / finish: tool cards come from tool/call events.
        return false
    }
  }

  private applyAssistantMessage(data: AssistantMessageEventData, seq: number, time?: number): boolean {
    const msg = this.ensureAssistant(Number(data?.turn), seq)
    // The host-persisted id powers messageFeedback; on a multi-step turn the
    // last step's message is the one the web client's fork rule refers to.
    const messageId = data?.message?.id
    if (typeof messageId === 'string' && messageId) msg.messageId = messageId
    const key = `${Number(data?.turn)}:${Number(data?.step)}`
    if (key !== this.stepKey) {
      this.stepKey = key
      this.stepStreamed = false
    }
    // Step completion timing: decode end + output tokens for the tps figure.
    if (time !== undefined && typeof data?.turn === 'number' && typeof data?.step === 'number') {
      this.stepCompleted.set(key, { time, outputTokens: outputTokensOf(data?.usage) })
    }
    if (!this.stepStreamed) {
      // No chunk stream seen for this step (e.g. a compacted log): fold content.
      for (const block of data?.message?.content ?? []) {
        if ((block.type === 'text' || block.type === 'reasoning') && typeof block.text === 'string') {
          msg.blocks.push({ type: block.type, text: block.text } as ChatBlock)
        }
      }
      this.stepStreamed = true
    }
    msg.complete = true
    if (data?.interrupted) msg.interrupted = true
    return true
  }

  private applyToolCall(data: ToolCallEventData, view: ToolEventViewLike | undefined, seq: number): boolean {
    if (!data || typeof data.callId !== 'string') return false
    const msg = this.ensureAssistant(Number(data.turn), seq)
    const block: ChatToolBlock = {
      type: 'tool',
      callId: data.callId,
      name: data.name,
      status: 'running',
      title: data.name,
      // 输入参数原样快照（模型原始 JSON 字符串），供工具卡展开显示 IN。
      args: data.arguments,
    }
    // 产物累积的 call view 快照（对齐官方 deliverables 累积器：tool/result
    // 回读的是 tool/call 时带的 call view，不是 result view；无 view 存
    // undefined 占位，表示这次调用没有可开产物）。
    this.callViews.set(data.callId, view?.for === 'call' ? view.view : undefined)
    if (view?.for === 'call') this.applyCallView(block, view.view)
    // todo_write 的事件 arguments 是模型原始 JSON 字符串（整表快照），比 host
    // 渲染 view 的 rawInput 更可靠；解析出 planSummary 供 webview 渲染任务卡。
    if (data.name === 'todo_write') {
      const summary = planSummaryOf(data.arguments)
      if (summary) block.todos = summary
    }
    msg.blocks.push(block)
    this.tools.set(data.callId, block)
    msg.complete = false
    return true
  }

  private applyToolResult(data: ToolResultEventData, view: ToolEventViewLike | undefined, seq: number): boolean {
    const result = data?.message?.content?.[0]
    const callId = result?.toolCallId
    if (typeof callId !== 'string') return false
    let block = this.tools.get(callId)
    if (!block) {
      // Result whose call fell outside the window: materialize a generic card.
      const msg = this.ensureAssistant(Number(data.turn), seq)
      block = { type: 'tool', callId, name: callId, status: 'running', title: callId }
      msg.blocks.push(block)
      this.tools.set(callId, block)
    }
    block.status = data.error || result?.isError === true ? 'error' : 'done'
    const text = textOfBlocks(result?.content)
    if (text) block.output = text
    if (view?.for === 'result') this.applyResultView(block, view.view)
    // meta 原样透传（cordis_define/run 卡的 pluginId/packageId/pluginRunId 来源）。
    if (data.meta !== undefined) block.meta = data.meta
    // 产物累积（对齐官方 deliverables）：成功结果才贡献，路径来自 call 时
    // 快照的 view（diff / generic+edit 卡的 locations），按 turn 去重保序。
    if (block.status !== 'error') {
      const turn = Number(data.turn)
      if (Number.isFinite(turn)) {
        const paths = producedPathsOf(this.callViews.get(callId))
        if (paths.length > 0) {
          let entries = this.produced.get(turn)
          let seen = this.producedSeen.get(turn)
          if (!entries) {
            entries = []
            this.produced.set(turn, entries)
          }
          if (!seen) {
            seen = new Set()
            this.producedSeen.set(turn, seen)
          }
          for (const path of paths) {
            if (seen.has(path)) continue
            seen.add(path)
            entries.push({ seq, path })
          }
        }
      }
    }
    // A result paired to an earlier call skipped ensureAssistant; still bump seq.
    if (this.current) this.current.seq = seq
    return true
  }

  private applyCallView(block: ChatToolBlock, v: ToolEventViewLike['view']): void {
    if (!v) return
    if (typeof v.title === 'string' && v.title) block.title = v.title
    switch (v.card) {
      case 'generic':
        if (typeof v.rawInput === 'string' && v.rawInput) block.detail = v.rawInput
        else if (v.locations?.[0]) block.detail = v.locations[0].path
        break
      case 'terminal': {
        const detail = v.description ?? v.cwd
        if (detail) block.detail = detail
        break
      }
      case 'diff': {
        const d = v.diffs?.[0]
        if (d) block.diff = { oldText: d.oldText ?? '', newText: d.newText }
        break
      }
    }
  }

  private applyResultView(block: ChatToolBlock, v: ToolEventViewLike['view']): void {
    if (!v) return
    if (typeof v.title === 'string' && v.title) block.title = v.title
    switch (v.card) {
      case 'terminal':
        if (typeof v.output === 'string') block.output = v.output
        break
      case 'diff': {
        const d = v.diffs?.[0]
        if (d) block.diff = { oldText: d.oldText ?? '', newText: d.newText }
        break
      }
    }
  }
}

/**
 * Merge stored feedback ratings (messageFeedback/list, keyed by host
 * messageId) into folded assistant messages. Returns true when any message's
 * rating changed, so callers can skip a redundant snapshot push.
 */
export function applyFeedbackRatings(
  messages: ChatMessage[],
  ratings: ReadonlyMap<string, { rating: 'positive' | 'negative' }>,
): boolean {
  let changed = false
  for (const msg of messages) {
    if (msg.kind !== 'assistant') continue
    const rating = msg.messageId ? ratings.get(msg.messageId)?.rating : undefined
    if (msg.feedbackRating !== rating) {
      msg.feedbackRating = rating
      changed = true
    }
  }
  return changed
}
