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

export interface ChatUserMessage {
  kind: 'user'
  id: string
  text: string
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
}

export type ToWebviewMessage = { type: 'state'; state: ChatState }

export type FromWebviewMessage =
  | { type: 'send'; text: string }
  | { type: 'stop' }
  | { type: 'approval'; rpcId: string; outcome: 'allowed-once' | 'rejected' }
  | { type: 'answer'; rpcId: string; answer: string }
