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
  ChatFile,
  ChatImage,
  ChatMessage,
  ChatToolBlock,
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
 */function imagesOfBlocks(content: unknown): ChatImage[] {
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

  /** Reset and fold a full history window (initial load / re-baseline). */
  applyHistory(entries: readonly HistoryEntryLike[]): void {
    this.msgs = []
    this.current = null
    this.blockPos.clear()
    this.stepKey = null
    this.stepStreamed = false
    this.openTurns.clear()
    this.tools.clear()
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
        let msg = this.current
        if (!msg) {
          // current 可能已被 turn 中途注入的 user/message 切断为 null：按
          // ensureAssistant 的 id 规则从尾部找回本 turn 最后一条 assistant
          // 消息（turn/end 落在历史窗口外时找不到，不标记 turnEnd）。
          const turn = Number(data.turn)
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
        if (!msg && (turnError || interrupted)) {
          // The turn failed / was cancelled before any assistant content:
          // still surface an (empty) assistant message so the error row /
          // 已中断 marker has somewhere to live.
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
        }
        this.current = null
        this.stepKey = null
        return true
      }
      case 'user/message': {
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
      case 'assistant/chunk':
        return this.applyChunk(event.data as ChunkEventData, event.seq)
      case 'assistant/message':
        return this.applyAssistantMessage(event.data as AssistantMessageEventData, event.seq)
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

  private applyChunk(data: ChunkEventData, seq: number): boolean {
    const chunk = data?.chunk
    if (!chunk || typeof chunk.type !== 'string') return false
    const msg = this.ensureAssistant(Number(data.turn), seq)
    const key = `${Number(data.turn)}:${Number(data.step)}`
    if (key !== this.stepKey) {
      this.stepKey = key
      this.stepStreamed = false
      this.blockPos.clear()
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

  private applyAssistantMessage(data: AssistantMessageEventData, seq: number): boolean {
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
