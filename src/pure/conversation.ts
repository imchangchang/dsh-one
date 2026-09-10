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
  ChatContext,
  ChatFile,
  ChatImage,
  ChatMessage,
  ChatRetryBlock,
  ChatToolBlock,
  ChatTurnTiming,
  ContextForm,
} from './chatContract.ts'
import { attachmentBaseName, isImagePath, parseAttachmentLine } from './composerAttachment.ts'
import { TurnUsageFold } from './turnUsage.ts'

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
 * File attachments ride the prompt text as `@PATH` reference lines (dsh's
 * PromptContentPart only has text and image parts). Split them back out so the
 * UI renders chips instead of raw paths — `@path` is the shape both dsh-one and
 * the official web front-end already render as a file chip (历史里的私有
 * `<attachment>PATH</attachment>` 形态由 parseAttachmentLine 一并兼容).
 */
function splitAttachments(text: string): { text: string; files: ChatFile[] } {
  const files: ChatFile[] = []
  const kept: string[] = []
  for (const line of text.split('\n')) {
    const p = parseAttachmentLine(line)
    if (p !== null) {
      files.push({ name: attachmentBaseName(p), path: p, ...(isImagePath(p) ? { image: true } : {}) })
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

/** Loose mirror of dsh-llm's ContextFormed source payload (kind + declared form). */
interface LooseInjectSource {
  kind?: unknown
  form?: unknown
  changes?: unknown
  baseline?: unknown
  entries?: unknown
  update?: unknown
  sections?: unknown
  summary?: unknown
  senderSessionId?: unknown
  references?: unknown
}

const CONTEXT_FORMS: readonly ContextForm[] = ['instructions', 'catalog', 'snapshot', 'notice', 'relay', 'recall']

function strOf(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/** All-or-nothing instruction change list; undefined when any entry can't be read cleanly. */
function changesOf(v: unknown): ChatContext['changes'] | undefined {
  if (!Array.isArray(v)) return undefined
  const changes: NonNullable<ChatContext['changes']> = []
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') return undefined
    const item = raw as { path?: unknown; action?: unknown; digest?: unknown }
    const path = strOf(item.path)
    const action = item.action
    if (!path || (action !== 'set' && action !== 'replace' && action !== 'remove')) return undefined
    changes.push({ path, action, ...(strOf(item.digest) ? { digest: item.digest as string } : {}) })
  }
  return changes
}

/** All-or-nothing catalog entry list; undefined when any entry can't be read cleanly. */
function entriesOf(v: unknown): ChatContext['entries'] | undefined {
  if (!Array.isArray(v)) return undefined
  const entries: NonNullable<ChatContext['entries']> = []
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') return undefined
    const item = raw as { name?: unknown; description?: unknown }
    const name = strOf(item.name)
    const description = strOf(item.description)
    if (!name || !description) return undefined
    entries.push({ name, description })
  }
  return entries
}

/** All-or-nothing snapshot section list; undefined when any section can't be read cleanly. */
function sectionsOf(v: unknown): ChatContext['sections'] | undefined {
  if (!Array.isArray(v)) return undefined
  const sections: NonNullable<ChatContext['sections']> = []
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') return undefined
    const item = raw as { name?: unknown; text?: unknown }
    const name = strOf(item.name)
    const text = strOf(item.text)
    if (!name || !text) return undefined
    sections.push({ name, text })
  }
  return sections
}

/** recall references: drop entries without a readable label (they may carry only
 *  sessionId for the clickable-link attach — a separate concern). */
function recallReferencesOf(v: unknown): ChatContext['references'] | undefined {
  if (!Array.isArray(v)) return undefined
  const refs: NonNullable<ChatContext['references']> = []
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as {
      label?: unknown
      retainedMessages?: unknown
      omittedMessages?: unknown
      truncated?: unknown
    }
    const label = strOf(item.label)
    if (!label) continue
    refs.push({
      label,
      ...(typeof item.retainedMessages === 'number' ? { retainedMessages: item.retainedMessages } : {}),
      ...(typeof item.omittedMessages === 'number' ? { omittedMessages: item.omittedMessages } : {}),
      ...(typeof item.truncated === 'boolean' ? { truncated: item.truncated } : {}),
    })
  }
  return refs
}

/**
 * Parse host-injected context from a user/message source. Returns undefined for
 * genuine human input (kind 'user') and for a source-less message without the
 * legacy <system-reminder> prefix. `kind` is always kept (UI label + backward
 * compat); `form` is set only when the declared form's payload validates
 * all-or-nothing — otherwise the form is dropped and the body degrades to
 * opaque text rather than a half-complete list.
 */
function injectedContextOf(source: LooseInjectSource | undefined, text: string): ChatContext | undefined {
  const kind = strOf(source?.kind)
  if (kind && kind !== 'user') {
    const form = CONTEXT_FORMS.includes(source?.form as ContextForm) ? (source?.form as ContextForm) : undefined
    const ctx: ChatContext = { kind }
    if (form === 'instructions') {
      const changes = changesOf(source?.changes)
      if (changes) {
        ctx.form = form
        ctx.changes = changes
        const baseline = strOf(source?.baseline)
        if (baseline) ctx.baseline = baseline
      }
    } else if (form === 'catalog') {
      const entries = entriesOf(source?.entries)
      if (entries) {
        ctx.form = form
        ctx.entries = entries
        if (typeof source?.update === 'boolean') ctx.update = source.update
      }
    } else if (form === 'snapshot') {
      const sections = sectionsOf(source?.sections)
      if (sections) {
        ctx.form = form
        ctx.sections = sections
      }
    } else if (form === 'notice') {
      const summary = strOf(source?.summary)
      if (summary) {
        ctx.form = form
        ctx.summary = summary
      }
    } else if (form === 'relay') {
      const senderSessionId = strOf(source?.senderSessionId)
      if (senderSessionId) {
        ctx.form = form
        ctx.senderSessionId = senderSessionId
      }
    } else if (form === 'recall') {
      const refs = recallReferencesOf(source?.references)
      if (refs && refs.length > 0) {
        ctx.form = form
        ctx.references = refs
      }
    }
    return ctx
  }
  if (!kind && text.startsWith('<system-reminder>')) return { kind: 'legacy-instructions' }
  return undefined
}

/**
 * 按 event.seq 稳定排序（升序）后再 fold：host 基线/翻页下发的事件不保证数组序
 * == seq 序，而折叠层整条链（消息结构、tool 卡配对、steering 插排、回合定位
 * navigateAnchorOf）信赖「消息按 seq 升序」——乱序数组直接按数组序 fold 会让
 * 消息结构本身错。对齐官方 replaceWindow/prepend 的按 seq re-sort；稳定排序
 * 保证同 seq 事件保持下发相对顺序。
 */
function orderEntriesBySeq(entries: readonly HistoryEntryLike[]): HistoryEntryLike[] {
  return entries.slice().sort((a, b) => a.event.seq - b.event.seq)
}

/**
 * 回合收尾时这条 assistant 消息算不算「有节点」——官方 hasInterruptionEvidence
 * 同款判定（client.js 4209-4214）：文本/推理块要去掉空白后非空，其余块（tool、
 * retry 等）一律算证据。
 *
 * 另外把 `messageId` 也算证据：它是 assistant/message 事件的落盘 id，说明这一步
 * 有真实的 assistant/message（其 content 即使只有 tool-call 块，在官方那边也是
 * 非文本证据）。少了这一条，只调工具、没流式文本的回合会在收尾时被误判成空壳。
 */
function hasAssistantEvidence(msg: ChatAssistantMessage): boolean {
  if (msg.messageId !== undefined) return true
  return msg.blocks.some((block) =>
    block.type === 'text' || block.type === 'reasoning' ? (block as { text: string }).text.trim() !== '' : true,
  )
}

/**
 * 同一回合被页边界切开的旧段并入新段：`newer.blocks` = 旧段块 + 新段块（保持
 * 事件序）。边界恰好落在同一段流式文本中间（step 还没结束就被切开）时两段各留
 * 了半个文本块，拼回一块——否则一个回合的正文在流里断成两段独立段落。
 * 旧段自身的收尾标记（complete/turnEnd/messageId/用量）不动：那些属于新段
 * （turn/end、最后一步的 assistant/message 都落在新段一侧）。
 */
function absorbAssistantSegment(older: ChatAssistantMessage, newer: ChatAssistantMessage): void {
  let absorbed = newer.blocks
  const left = older.blocks[older.blocks.length - 1]
  const right = newer.blocks[0]
  if (left && right && (left.type === 'text' || left.type === 'reasoning') && right.type === left.type) {
    const target = left as { text: string }
    target.text += (right as { text: string }).text
    absorbed = absorbed.slice(1)
  }
  // 两段可能各有一份同一个块：页边界切在 tool/call 与 tool/result 之间时，旧段
  // 折出那张卡，新段的 scratch folder 里没有 call 记录、按 result 兜底又建一张
  // 同 callId 的卡（F4 的同源现象）。并段后它们落在同一条消息里，块 key 相同
  // （tool 块 key = callId）→ 必须合一：留旧段的位置（调用发生处），状态/结果以
  // 后者为准，调用侧快照（工具名/标题/args）补回兜底卡缺的那部分。
  const merged: ChatBlock[] = []
  const at = new Map<string, number>()
  for (const block of [...older.blocks, ...absorbed]) {
    const id = block.id
    const index = id === undefined ? undefined : at.get(id)
    if (index !== undefined) {
      merged[index] = mergeSameBlock(merged[index], block)
      continue
    }
    if (id !== undefined) at.set(id, merged.length)
    merged.push(block)
  }
  newer.blocks = merged
}

/**
 * 同一块的两份合一（id 相同：页边界把它切在了两个 fold 里）。后者（新段）带状态
 * 与结果，优先；工具卡的 name/title 若后者只是「callId 兜底」（result 先到、call
 * 不在窗口），用前者的真实工具名/标题，避免卡上显示原始 callId。
 */
function mergeSameBlock(older: ChatBlock, newer: ChatBlock): ChatBlock {
  const merged: ChatBlock = { ...older, ...newer }
  if (merged.type === 'tool' && older.type === 'tool' && newer.type === 'tool') {
    if (newer.name === newer.callId && older.name !== older.callId) merged.name = older.name
    if (newer.title === newer.callId && older.title !== undefined && older.title !== older.callId) {
      merged.title = older.title
    }
  }
  return merged
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
  /**
   * turn → 本 fold 里该 turn 最后一条 assistant 消息。turn/end 要靠它找回
   * 「承载消息」——不能用 id 反查：一个 turn 可能折出多段 assistant 消息
   * （窗口头切在回合中间 / turn 中途注入 user/message 切断 current），id 按
   * 「turn + 段首 seq」命名后不再是 `assistant-t{turn}` 一条。
   */
  private turnAssistant = new Map<number, ChatAssistantMessage>()
  /** Chunk block index → position in current.blocks (per step). */
  private blockPos = new Map<number, number>()
  /**
   * `${turn}:${step}` → 本步的 assistant 消息（F2：官方 assistant-step 节点粒度）。
   * 同一步被 user/message 切开时，这条映射会被删掉——后续事件另起一段消息。
   */
  private stepMessages = new Map<string, ChatAssistantMessage>()
  /** `${turn}:${step}` of the step that streamed chunks, for dedupe. */
  private stepKey: string | null = null
  /** Whether the current step already contributed streamed/folded content. */
  private stepStreamed = false
  private openTurns = new Set<number>()
  private tools = new Map<string, ChatToolBlock>()
  /** callId → 该次调用所属的 (turn, step)。step/turn 关闭时据此把未结算的卡收边。 */
  private toolScope = new Map<string, { turn: number; step: number }>()
  /** turn → 当前打开的 step（step/start 推进；新 step 开始即认为上一个已关闭）。 */
  private openStep = new Map<number, number>()
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
  /**
   * Turn → 用量 fold（官方 deriveTurnTokenUsage 语义，见 src/pure/turnUsage.ts）：
   * 只在窗口内看到 turn/start 时才建（turn/start 不在窗口 = 缺边界，整项缺省），
   * turn/end 时取结果并删除。
   */
  private turnUsage = new Map<number, TurnUsageFold>()
  /**
   * next-step inbox 的 claim 重放（F5）：官方 chat 折叠层注册一条 next-step 的
   * inbox 状态，把 `agent/inbox/spliced` 按序重放（client.js 5675-5726），据此把
   * `user/message` 分成 context / steering / user 三类。我们照搬同一套重放：
   * `inboxPending` = 当前 next-step 收件箱里待插的 id 列表，`inboxClaimed` =
   * 上一次 splice「取走」的 id 集合（取走的那些就是被插进对话的插话）。
   * 分类只看折叠层自己的日志，不再依赖 webview 侧的 queue 快照——queue 项一消失
   * 身份就翻转。
   */
  private inboxPending: string[] = []
  private inboxClaimed = new Set<string>()

  /** Reset and fold a full history window (initial load / re-baseline). */
  applyHistory(entries: readonly HistoryEntryLike[]): void {
    this.msgs = []
    this.current = null
    this.turnAssistant.clear()
    this.stepMessages.clear()
    this.blockPos.clear()
    this.stepKey = null
    this.stepStreamed = false
    this.openTurns.clear()
    this.tools.clear()
    this.toolScope.clear()
    this.openStep.clear()
    this.callViews.clear()
    this.produced.clear()
    this.producedSeen.clear()
    this.compactions.clear()
    this.retries.clear()
    this.turnStart.clear()
    this.stepStart.clear()
    this.firstToken.clear()
    this.stepCompleted.clear()
    this.turnUsage.clear()
    this.inboxPending = []
    this.inboxClaimed.clear()
    for (const entry of orderEntriesBySeq(entries)) this.applyEvent(entry.event, entry.view)
  }

  /**
   * Prepend an older history page (「加载更早」). The host aligns page
   * boundaries to message boundaries, so the older page folds in a scratch
   * folder and its (complete) messages go in front of the current ones;
   * existing fold state (the open streaming turn, tool pairing) is untouched.
   *
   * 页边界切在回合中间时（官方按 step 出节点、我们按 turn 出一条消息，边界
   * 落在回合内部是常态），旧页尾段与本窗口首段同属一个 turn：两段并成一段
   * （旧段内容接在新段前面），一个回合不会裂成两条 assistant 消息。
   */
  prependHistory(entries: readonly HistoryEntryLike[]): void {
    if (entries.length === 0) return
    const older = new ConversationFolder()
    for (const entry of orderEntriesBySeq(entries)) older.applyEvent(entry.event, entry.view)
    const olderMsgs = older.messages()
    const tail = olderMsgs[olderMsgs.length - 1]
    const head = this.msgs[0]
    if (
      tail?.kind === 'assistant' &&
      head?.kind === 'assistant' &&
      head !== this.current &&
      tail.turn !== undefined &&
      tail.turn === head.turn
    ) {
      absorbAssistantSegment(tail, head)
      olderMsgs.pop()
    }
    this.msgs = [...olderMsgs, ...this.msgs]
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
        // 用量 fold：turn/start 在窗口内才建（缺边界 → 整项缺省）。
        if (typeof data.turn === 'number' && Number.isFinite(data.turn)) {
          const fold = new TurnUsageFold()
          fold.fold(event)
          this.turnUsage.set(data.turn, fold)
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
        // 只翻**最后一次**：官方 model-retry 节点只把末个 attempt 从 scheduled 翻
        // cancelled（client.js 5905-5918），多 attempt 链上把整串都翻会多出几条
        // 「已取消」行。
        const turn = Number(data.turn)
        if (Number.isFinite(turn)) {
          let last: { block: ChatRetryBlock } | undefined
          for (const entry of this.retries.values()) {
            if (entry.turn === turn) last = entry
          }
          if (last?.block.retryState === 'scheduled') last.block.retryState = 'cancelled'
          // 回合关闭：本 turn 仍未结算的 tool 卡不会再有 result（用户中断 / result
          // 落在窗口外 / 日志缺尾）——收边置错误态。官方同款语义：step/turn 关闭
          // 时把未结算的 tool 投影成 Interrupted 错误结果；不收边就永远转圈。
          this.closeToolScope(turn)
          this.openStep.delete(turn)
        }
        let msg = this.current
        if (!msg) {
          // current 可能已被 turn 中途注入的 user/message 切断为 null：找回本
          // turn 最后一条 assistant 消息（turn/end 落在历史窗口外时找不到，不标
          // 记 turnEnd）。
          if (Number.isFinite(turn)) msg = this.turnAssistant.get(turn) ?? null
        }
        // F7：官方只在「有 interruption evidence」时才投影中断的 assistant 节点
        // （client.js hasInterruptionEvidence，4209-4214）——文本/推理块全空、
        // 又没有别的块的回合直接**不出节点**（此时可见的 turn-tail 也因
        // closing === null 渲染成空）。我们原来无条件留一条空 assistant 消息，
        // 渲染成一条空行 + 「已中断」。这里对齐：无证据的空壳从消息流里摘掉。
        // turn-error / turn-max-tokens 是官方那套里的**独立节点**（
        // TURN_PROCESS_INDEPENDENT_KINDS，1336-1345），不受 evidence 约束，
        // 它们的承载消息仍然要建。
        if (msg && !hasAssistantEvidence(msg) && !turnError && !maxTokens) {
          const at = this.msgs.indexOf(msg)
          if (at >= 0) this.msgs.splice(at, 1)
          if (Number.isFinite(turn) && this.turnAssistant.get(turn) === msg) this.turnAssistant.delete(turn)
          msg = null
        }
        if (!msg && (turnError || maxTokens)) {
          // The turn failed / hit the token cap before any assistant content:
          // still surface an (empty) assistant message so the error row /
          // maxTokens notice has a home.
          msg = {
            kind: 'assistant',
            id: `assistant-s${event.seq}`,
            blocks: [],
            complete: true,
            seq: event.seq,
            ...(Number.isFinite(turn) ? { turn } : {}),
          }
          this.msgs.push(msg)
          if (Number.isFinite(turn)) this.turnAssistant.set(turn, msg)
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
          // 用量明细（官方 TurnUsagePanel 数据源）：fold 收边后取结果；不可证明
          // 时整项缺省（宁可不出，不虚报）。turn/end 无承载消息时丢弃。
          if (Number.isFinite(Number(data.turn))) {
            const fold = this.turnUsage.get(Number(data.turn))
            if (fold) {
              fold.fold(event)
              const usage = fold.result()
              if (usage) msg.usage = usage
              this.turnUsage.delete(Number(data.turn))
            }
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
            else this.msgs.push({ kind: 'compaction', id: checkpoint.compactionId, seq: event.seq, ...compaction })
          } else {
            this.msgs.push({ kind: 'compaction', id: checkpoint.compactionId, seq: event.seq, ...compaction })
          }
          // 与普通 user/message 一样切断当前 assistant 消息：checkpoint 之后
          // 的内容另起一条（官方按 seq 位置渲染成独立节点）。
          this.cutCurrent()
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
        const source = data.source as LooseInjectSource | undefined
        const sourceKind = source?.kind
        // session-reference 注入上下文紧跟在触发它的直接用户消息之后，其
        // source.references 带着 {sessionId, label}——直接消息落盘的是可读
        // @label 文本，回挂过去气泡才能把引用渲染成可点击链接。recall form
        // 的 references（{label, retainedMessages…}）不带 sessionId，会被自然
        // 过滤掉，不会误挂。
        if (sourceKind === 'session-reference') {
          const refs = source?.references
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
        const context = injectedContextOf(source, text)
        // F5：被 next-step inbox 取走并插进对话的这条是**插话**（steering），与
        // 人类直发（user）、宿主注入（context）是三种节点身份。身份由折叠层从
        // agent/inbox/spliced 的重放里给出（官方 client.js 5754 的
        // currentClaimed.has(event.data.id) 判定），不看 webview 侧的 queue 快照
        // ——queue 项落地后就被移除，身份跟着翻转会让那一行被重建。
        const steering = context === undefined && this.inboxClaimed.has(id)
        this.msgs.push({
          kind: 'user',
          id,
          text,
          seq: event.seq,
          ...(context ? { context } : {}),
          ...(steering ? { steering: true } : {}),
          ...(images.length > 0 ? { images } : {}),
          ...(files.length > 0 ? { files } : {}),
        })
        // turn 中途插入的 user/message（子代理完成通知等注入上下文）会切断
        // 当前 assistant 消息：之后的内容另起一条（官方按 seq 位置渲染成独立
        // 节点，注入上下文永远排在它后面）。被丢下的这条再也等不到
        // assistant/message 或 turn/end 来标 complete（tool/call 刚把它标回
        // false），不补一下 webview 会在它尾巴上永久挂流式光标。
        this.cutCurrent()
        this.stepKey = null
        return true
      }
      case 'step/start': {
        // TTFT baseline: stepStartTime of each step (window-scoped).
        if (typeof event.time === 'number' && typeof data.turn === 'number' && typeof data.step === 'number') {
          this.stepStart.set(`${data.turn}:${data.step}`, event.time)
        }
        this.feedUsageFold(event)
        // 上一步已关闭（step/end 可能因窗口/中断缺失）：它还没拿到结果的 tool
        // 调用不会再有 result 了，先收边。
        const turn = Number(data.turn)
        const step = Number(data.step)
        let closed = false
        if (Number.isFinite(turn) && Number.isFinite(step)) {
          const prev = this.openStep.get(turn)
          if (prev !== undefined && prev !== step) closed = this.closeToolScope(turn, prev)
          this.openStep.set(turn, step)
        }
        return closed
      }
      // step/end 不进对话流（无用消息副作用），但用量 fold 的尝试生命周期
      // 依赖它（官方 step/end 关闭 open attempt）。
      case 'step/end': {
        this.feedUsageFold(event)
        const turn = Number(data.turn)
        const step = Number(data.step)
        let closed = false
        if (Number.isFinite(turn)) {
          closed = this.closeToolScope(turn, Number.isFinite(step) ? step : undefined)
          if (Number.isFinite(step) && this.openStep.get(turn) === step) this.openStep.delete(turn)
        }
        return closed
      }
      case 'assistant/chunk':
        this.feedUsageFold(event)
        return this.applyChunk(event.data as ChunkEventData, event.seq, event.time)
      case 'assistant/message':
        this.feedUsageFold(event)
        return this.applyAssistantMessage(event.data as AssistantMessageEventData, event.seq, event.time)
      case 'tool/call':
        return this.applyToolCall(event.data as ToolCallEventData, view, event.seq)
      case 'tool/result':
        return this.applyToolResult(event.data as ToolResultEventData, view, event.seq)
      case 'command/run': {
        const commandId = typeof data.commandId === 'string' && data.commandId ? data.commandId : `command-${event.seq}`
        const name = typeof data.name === 'string' ? data.name : 'command'
        const args = typeof data.args === 'string' && data.args.trim() ? data.args.trim() : undefined
        this.msgs.push({ kind: 'command', id: commandId, name, seq: event.seq, ...(args ? { args } : {}), status: 'running' })
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
        this.feedUsageFold(event)
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
        const msg = this.ensureAssistant(Number(data.turn), event.seq, Number(data.step))
        const block: ChatRetryBlock = {
          type: 'retry',
          id: `retry:${r}`,
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
        this.feedUsageFold(event)
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
      case 'agent/inbox/spliced': {
        // F5：next-step 收件箱的一次变更。重放官方 applySplice（client.js
        // 5675-5700）：带 removedCount 且非 canceled 的一次 splice 把 start 处
        // 的 removedCount 条**取走**（这些 id 就是接下来要插进对话的插话），
        // 取走的成为 currentClaimed；其余情况只把 inserted 从 claimed 里摘掉并
        // 把这次 splice 应用到 pending 上。分类在 user/message 时读 claimed。
        // 只认 next-step：next-turn（排队等待，未插话）不参与 user 消息分类。
        if (data.target !== 'next-step') return false
        const inserted = Array.isArray(data.inserted)
          ? data.inserted.flatMap((raw) => {
              const identity = raw as { id?: unknown }
              return typeof identity?.id === 'string' && identity.id ? [identity.id] : []
            })
          : []
        const removedCount = Math.max(0, Math.trunc(Number(data.removedCount)) || 0)
        const offset = Math.trunc(Number(data.start))
        const start = Number.isNaN(offset) ? 0 : offset < 0 ? Math.max(this.inboxPending.length + offset, 0) : Math.min(offset, this.inboxPending.length)
        if (removedCount > 0 && data.outcome !== 'canceled') {
          this.inboxClaimed = new Set(this.inboxPending.splice(start, removedCount, ...inserted))
        } else {
          for (const id of inserted) this.inboxClaimed.delete(id)
          this.inboxPending.splice(start, removedCount, ...inserted)
        }
        // 这条事件本身不改消息（分类在随后的 user/message 上生效），但折叠层
        // 的状态变了：返回 false 让调用方按「消息未变」跳过重推。
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

  /** Feed a turn-scoped event to the open usage fold of the matching turn (if any). */
  private feedUsageFold(event: SessionEventLike): void {
    const data = (event.data ?? {}) as Record<string, unknown>
    const turn = Number(data.turn)
    if (!Number.isFinite(turn)) return
    const fold = this.turnUsage.get(turn)
    if (fold) fold.fold(event)
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

  /**
   * 把一个 (turn[, step]) 作用域内仍未结算（status='running'）的 tool 卡置成
   * 错误态。tool/result 是唯一能把卡从 running 翻走的路径，而调用它的 step/turn
   * 关闭后再也不会有 result 到达（用户 ESC 中断、result 落在加载窗口外、日志缺
   * 尾）——不收边那张卡就永远转圈（官方按 interruption 边界投影成 Interrupted
   * 错误结果）。返回是否真的改了状态。迟到的 result 仍会按 callId 找回这张卡并
   * 覆盖状态，所以误收边是可自愈的。
   */
  private closeToolScope(turn: number, step?: number): boolean {
    let changed = false
    for (const [callId, block] of this.tools) {
      if (block.status !== 'running') continue
      const scope = this.toolScope.get(callId)
      if (!scope || scope.turn !== turn) continue
      if (step !== undefined && scope.step !== step) continue
      block.status = 'error'
      changed = true
    }
    return changed
  }

  /**
   * 注入上下文（user/message、压缩 checkpoint）把当前正在长的那条 assistant
   * 消息切断：补 complete（它等不到 assistant/message 或 turn/end 了），并把
   * 本步的段映射删掉——同一步后续的事件会另起一段（id 带 seq 后缀），从而仍
   * 按 seq 排在注入上下文之后。
   */
  private cutCurrent(): void {
    const msg = this.current
    this.current = null
    if (!msg) return
    msg.complete = true
    if (msg.step !== undefined && Number.isFinite(msg.turn)) {
      const scope = `${msg.turn}:${msg.step}`
      if (this.stepMessages.get(scope) === msg) this.stepMessages.delete(scope)
    }
  }

  private ensureAssistant(turn: number, seq: number, step?: number): ChatAssistantMessage {
    // 窗口分页下 turn/start 可能落在窗口外（长 turn 的工具事件就能把页填满）；
    // 窗口是日志的连续后缀，内容事件的 turn 没有配对的 turn/end 就是还在跑。
    if (Number.isFinite(turn)) this.openTurns.add(turn)
    // F2：官方按 step 出 assistant 节点（id `${turn}:${step}`），我们按 step 出
    // 消息——同一个 turn 的每个 step 是一条独立消息，「回合过程折叠」（turn-process）
    // 才有「过程成员 / 答案步」的边界。step 缺省（窗口外 result 兜底、llm/retry
    // 缺 step）时退回挂到本 turn 的兜底消息上。
    const finiteStep = step !== undefined && Number.isFinite(step)
    const stepScope = Number.isFinite(turn) && finiteStep ? `${turn}:${step}` : null
    if (stepScope !== null) {
      const existing = this.stepMessages.get(stepScope)
      if (existing) {
        existing.seq = seq
        this.current = existing
        return existing
      }
    } else if (this.current && this.current.step === undefined) {
      this.current.seq = seq
      return this.current
    }
    // id 必须唯一且跨帧稳定：同一个 (turn, step) 可能折出多段消息（页边界切在
    // 步中间，或 turn 中途注入的 user/message 把一段切开）。按 (turn, step) 命名
    // 已能区分不同步；同一 (turn, step) 被切开后的第二段再带段首 seq 后缀——
    // 段首事件唯一 ⇒ id 唯一；同一段日志的折叠结果确定 ⇒ id 跨帧稳定（对齐官方
    // 节点身份带 sourceEventSeq 的做法）。
    const base = Number.isFinite(turn) ? (finiteStep ? `assistant-t${turn}s${step}` : `assistant-t${turn}`) : 'assistant'
    const msg: ChatAssistantMessage = {
      kind: 'assistant',
      id: stepScope !== null && this.stepMessages.has(stepScope) ? `${base}-x${seq}` : stepScope === null ? `${base}-x${seq}` : base,
      blocks: [],
      complete: false,
      seq,
      anchorSeq: seq,
      ...(Number.isFinite(turn) ? { turn } : {}),
      ...(finiteStep ? { step: Number(step) } : {}),
    }
    this.msgs.push(msg)
    this.current = msg
    if (stepScope !== null) this.stepMessages.set(stepScope, msg)
    if (Number.isFinite(turn)) this.turnAssistant.set(turn, msg)
    return msg
  }

  private applyChunk(data: ChunkEventData, seq: number, time?: number): boolean {
    const chunk = data?.chunk
    if (!chunk || typeof chunk.type !== 'string') return false
    const msg = this.ensureAssistant(Number(data.turn), seq, Number(data.step))
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
        msg.blocks.push({ type: chunk.blockType, text: '', id: `s${seq}` } as ChatBlock)
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
          msg.blocks.push({ type, text: '', id: `s${seq}` } as ChatBlock)
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
          msg.blocks.push({ type, text: text ?? '', id: `s${seq}` } as ChatBlock)
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
    const msg = this.ensureAssistant(Number(data?.turn), seq, Number(data?.step))
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
      let index = 0
      for (const block of data?.message?.content ?? []) {
        if ((block.type === 'text' || block.type === 'reasoning') && typeof block.text === 'string') {
          // 同一条 assistant/message 可能折出多块：用事件内序号前缀区分。
          msg.blocks.push({ type: block.type, text: block.text, id: `s${seq}.${index}` } as ChatBlock)
          index += 1
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
    const msg = this.ensureAssistant(Number(data.turn), seq, Number(data.step))
    const block: ChatToolBlock = {
      type: 'tool',
      id: data.callId,
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
    this.toolScope.set(data.callId, { turn: Number(data.turn), step: Number(data.step) })
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
      const msg = this.ensureAssistant(Number(data.turn), seq, Number(data.step))
      block = { type: 'tool', id: callId, callId, name: callId, status: 'running', title: callId }
      msg.blocks.push(block)
      this.tools.set(callId, block)
      this.toolScope.set(callId, { turn: Number(data.turn), step: Number(data.step) })
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
 * 回合跳转的定位锚：窗口里「第一条 seq ≥ 目标 seq」的消息 id（目标回合的
 * 首行）。消息按 seq 升序折叠，目标回合 turn/start 的 seq 落在其首行之前——
 * 首个越过它的消息就是该回合第一条可见行。没有可定位消息（空窗口/日志洞/
 * 目标在窗口外）返回 null。
 */
export function navigateAnchorOf(messages: readonly ChatMessage[], seq: number): string | null {
  for (const m of messages) {
    const s = (m as { seq?: unknown }).seq
    if (typeof s === 'number' && s >= seq) return m.id
  }
  return null
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
