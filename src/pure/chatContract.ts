/**
 * Contract between the extension host and the chat webview, plus the folded
 * conversation model both sides share. The host folds dsh session events into
 * ChatMessage[]; the webview renders ChatState snapshots verbatim. Treat this
 * file as an interface freeze: change it only when both sides change together.
 */

/** One renderable block inside an assistant message. */
export interface ChatTextBlock {
  type: 'text'
  text: string
}

export interface ChatReasoningBlock {
  type: 'reasoning'
  text: string
}

export interface ChatToolBlock {
  type: 'tool'
  callId: string
  name: string
  status: 'running' | 'done' | 'error'
  /** Short card title from the host-computed ToolEventView, when present. */
  title?: string
  /** Secondary detail line (command, file path, …) from the view. */
  detail?: string
  /** Inline diff payload from a diff view. */
  diff?: { oldText: string; newText: string }
  /** Result text, truncated by the folder. Absent while running. */
  output?: string
}

export type ChatBlock = ChatTextBlock | ChatReasoningBlock | ChatToolBlock

/** One image attached to a user message — a durable dsh attachment reference (bytes fetched lazily). */
export interface ChatImage {
  attachmentId: string
  mediaType: string
  name?: string
  width?: number
  height?: number
}

/** A non-image file attached to a user message (its on-disk path is the payload). */
export interface ChatFile {
  name: string
  path: string
}

export interface ChatUserMessage {
  kind: 'user'
  id: string
  text: string
  /** Images attached to this message, in content order. */
  images?: ChatImage[]
  /** Non-image files attached to this message (parsed back out of the prompt text). */
  files?: ChatFile[]
  /**
   * Host-injected context masquerading as a user message (source.kind from
   * the user/message event, e.g. 'agent-instructions' or a plugin snapshot).
   * Absent for genuine human input. The UI collapses these by default.
   */
  context?: string
}

export interface ChatAssistantMessage {
  kind: 'assistant'
  id: string
  blocks: ChatBlock[]
  /** false while the turn is still streaming. */
  complete: boolean
  interrupted?: boolean
}

export type ChatMessage = ChatUserMessage | ChatAssistantMessage

/** A host approval request awaiting the user's decision. */
export interface PendingApproval {
  kind: 'approval'
  rpcId: string
  sessionId: string
  approvalId: string
  toolName: string
  reason?: string
}

/** A tool-initiated question (AskUser) awaiting an answer. */
export interface PendingQuestion {
  kind: 'question'
  rpcId: string
  sessionId: string
  questions: Array<{
    question: string
    header?: string
    options?: Array<{ label: string; description?: string }>
    multiSelect?: boolean
  }>
}

export type PendingRequest = PendingApproval | PendingQuestion

/** One per-question answer draft the webview submits (mirrors AskUserQuestionAnswerItem minus the id). */
export interface QuestionAnswerInput {
  selected: string[]
  custom?: string
}

/** One base64 file the webview staged (picker) or pasted for the next prompt. */
export interface OutgoingImage {
  /** Declared MIME type; may be empty for clipboard file-promises — the host sniffs bytes. */
  mediaType: string
  data: string
  name?: string
}

/**
 * A non-image file staged in the composer as a chip. Bytes stay on disk
 * (picked in place, or a temp copy for pastes); the path joins the prompt
 * text on send so the agent can read the file itself.
 */
export interface StagedFile {
  name: string
  path: string
}

/** Whole-chat snapshot pushed host → webview (throttled; replaces state). */
export interface ChatState {
  sessionId: string | null
  sessionTitle?: string
  messages: ChatMessage[]
  pending: PendingRequest[]
  /** The attached agent is mid-turn. */
  running: boolean
  /** Server + session ready for input. */
  canSend: boolean
  /** Footer model pill, host-computed from session.models ("DeepSeek-V4-Flash High" style). */
  modelLabel?: string
  /** Permission preset select from the `permissions` projection; absent hides the control. */
  permissions?: {
    options: Array<{ value: string; label: string }>
    current: string
  }
  /** Footer session-stats line, host-formatted (src/pure/sessionStats.ts); rendered verbatim. */
  statsLine?: string
  /**
   * Still-pending queued/steering inbox items (session/queue frames). These
   * are not durable session events, so they never appear in `messages`.
   */
  queue?: QueuedItem[]
}

/** One queued prompt awaiting the agent, shown above the composer. */
export interface QueuedItem {
  id: string
  placement: 'queued' | 'steering'
  text: string
}

/** One selectable reasoning-effort tier of a catalog model. */
export interface ModelCatalogEffort {
  id: string
  name: string
  description?: string
}

/** One selectable model in a provider group. */
export interface ModelCatalogModel {
  id: string
  name: string
  description?: string
  efforts: ModelCatalogEffort[]
  defaultEffort?: string
}

/** Model catalog for one session, sent host → webview on `requestModels`. */
export interface ModelCatalog {
  current: { provider: string; model: string; reasoningEffort?: string }
  groups: Array<{ id: string; name: string; models: ModelCatalogModel[] }>
}

export type ToWebviewMessage =
  | { type: 'state'; state: ChatState }
  | { type: 'imagesPicked'; images: OutgoingImage[] }
  | { type: 'filesPicked'; files: StagedFile[] }
  | { type: 'modelCatalog'; catalog: ModelCatalog }
  | { type: 'attachmentData'; attachmentId: string; mediaType: string; data: string }

export type FromWebviewMessage =
  | { type: 'send'; text: string; images?: OutgoingImage[] }
  | { type: 'stop' }
  | { type: 'approval'; rpcId: string; outcome: 'allowed-once' | 'rejected' }
  | { type: 'answer'; rpcId: string; answers: QuestionAnswerInput[] }
  | { type: 'pickFiles' }
  | { type: 'filesPasted'; files: OutgoingImage[] }
  | { type: 'requestModels' }
  | { type: 'setModel'; provider: string; model: string; reasoningEffort?: string }
  | { type: 'setPermission'; value: string }
  | { type: 'renameSession'; title: string }
  | { type: 'requestAttachment'; attachmentId: string }
