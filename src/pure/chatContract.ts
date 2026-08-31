/**
 * Contract between the extension host and the chat webview, plus the folded
 * conversation model both sides share. The host folds dsh session events into
 * ChatMessage[]; the webview renders ChatState snapshots verbatim. Treat this
 * file as an interface freeze: change it only when both sides change together.
 */
import type { SessionSortOrder, WorkspaceNodeModel } from './sessionTree.ts'
import type { ActivityJob } from './activityTree.ts'

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
  /**
   * 本 turn 的最后一条 assistant 消息（turn/end 时标记）。turn 中途注入的
   * user/message 会把一个 turn 切成多条消息，操作栏（复制/反馈/分支）只挂
   * 在 turnEnd 消息上，不再每条 complete 消息各出现一次。turn/end 落在
   * 历史窗口外的消息没有此标记（无操作栏，可接受——fork 点本来也不可靠）。
   */
  turnEnd?: boolean
  interrupted?: boolean
  /**
   * Turn-level failure from turn/end reason {kind:'error'} (e.g. a 401 from
   * the model provider). Rendered as an error row like the official web
   * client's TurnErrorItem; not marked interrupted.
   */
  turnError?: { message: string; code?: string }
  /**
   * Host-persisted message id (assistant/message's data.message.id), required
   * by the messageFeedback RPCs. Absent while streaming or when the host never
   * persisted one — the webview disables the feedback buttons then. On a
   * multi-step turn this is the LAST step's id, matching the fork rule
   * ("branch from the completed turn's last message").
   */
  messageId?: string
  /**
   * Seq of the last event folded into this message (turn/end once the turn
   * completed): the atSeq fork point for session.fork.
   */
  seq?: number
  /** The user's stored rating for this message (messageFeedback/list), if any. */
  feedbackRating?: 'positive' | 'negative'
}

/**
 * One slash-command lifecycle (dsh `command/run` + `command/done` pair),
 * rendered as a flow node like the official web client does.
 */
export interface ChatCommandMessage {
  kind: 'command'
  /** The host-minted commandId pairing run and done. */
  id: string
  name: string
  args?: string
  status: 'running' | 'success' | 'error'
  /** Handler receipt text from command/done, when the handler produced one. */
  text?: string
}

export type ChatMessage = ChatUserMessage | ChatAssistantMessage | ChatCommandMessage

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
    /** Supporting detail (e.g. the full plan markdown of a plan review), rendered but never answered back. */
    detail?: string
    options?: Array<{ label: string; description?: string }>
    multiSelect?: boolean
    /** Presentation intent; plan-review highlights the option named by `approve`. */
    intent?: { kind: string; approve?: string }
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
  /**
   * 历史基线（session.history 翻页）还在加载：webview 此时显示加载占位而不是
   * 空会话 hero，避免切换会话时 hero 闪一帧再被消息流替换。
   */
  loading?: boolean
  messages: ChatMessage[]
  pending: PendingRequest[]
  /** The attached agent is mid-turn. */
  running: boolean
  /** Server + session ready for input. */
  canSend: boolean
  /**
   * Set only in the no-session empty state when the server failed to start;
   * the webview replaces its placeholder with the matching guidance.
   */
  serverError?: 'dshNotFound'
  /** Footer model pill, host-computed from session.models ("DeepSeek-V4-Flash High" style). */
  modelLabel?: string
  /**
   * Agent preset picker for blank sessions（空会话 hero 区的选择 chip）：
   * roster options + the current id (last agent-preset/selected event,
   * else the roster default). Absent once any turn has started — the host
   * locks the preset then (agent-preset-locked).
   */
  agentPreset?: {
    options: Array<{ id: string; label: string; description?: string }>
    current: string
  }
  /**
   * 空会话 hero 区的 workspace 名 chip（官方空态的 workspace 触发器，我们只读
   * 展示）：附着会话所属 workspace 的 title，由 ChatViewProvider 从
   * SessionsStore 的 workspace.list 基线（含 blank 会话）合成。
   */
  workspaceLabel?: string
  /**
   * 头部 preset 只读标签（如「标准模式」）：渠道对齐官方 AgentPresetLabel——
   * ChatViewProvider 从 session.list 基线取附着会话的 agentPreset id（创建时
   * 即定，新旧会话都有），经 controller 的 roster 映射成显示名；与空会话
   * hero 的 agentPreset 选择 chip 互斥，不会同时出现。
   */
  presetLabel?: string
  /**
   * 头部 preset 标签的悬停 tooltip（官方 AgentPresetLabel 悬停显示 preset
   * 描述）：与 presetLabel 同源的 roster description；没有描述时缺省。
   */
  presetDescription?: string
  /**
   * 头部面包屑的父会话段（对齐官方 dsh web 的子代理进入逻辑：附着的是
   * 子代理会话时，标题区显示「父会话标题 / 子会话标题」，点父会话标题
   * 回到父会话内容）：附着会话在 session.list 基线里带 parentSessionId
   * 时由 ChatViewProvider 合成；普通会话缺省。
   */
  parentSession?: {
    sessionId: string
    title: string
  }
  /**
   * 头部「N 个子代理」chip 的下拉行：本会话的全部 continuable 子代理
   * （session.list 基线里 parentSessionId 指向本会话的会话，含已完成的），
   * 由 ChatViewProvider 从 SessionsStore 组合并按 运行中优先 + 新近优先
   * 排好；一个子代理都没有时缺省（chip 不渲染）。
   */
  subagents?: Array<{
    sessionId: string
    title: string
    /** 运行中画像素环，已完成画灰点（对齐官方 activity 状态区分）。 */
    running: boolean
    totalTokens?: number
    /** Epoch milliseconds（session.list 的 updatedAt）。 */
    updatedAt: number
  }>
  /**
   * 头部「N 个后台任务运行中」chip 的下拉行：本会话的全部后台 job（含
   * 已结束的），由 ChatViewProvider 从 JobsStore 的 mux 基线组合并按官方
   * JobListAction 行序排好；一个 job 都没有时缺省（chip 不渲染）。
   */
  backgroundJobs?: ActivityJob[]
  /** Permission preset select from the `permissions` projection; absent hides the control. */
  permissions?: {
    options: Array<{ value: string; label: string }>
    current: string
  }
  /** Footer session-stats line, host-formatted (src/pure/sessionStats.ts); rendered verbatim. */
  statsLine?: string
  /**
   * Still-pending queued/steering inbox items (session/queue frames). These
   * are not durable session events, so they never appear in `messages`;
   * the webview renders `queued` ones above the composer and `steering`
   * ones as pending bubbles at the transcript tail (official web parity).
   */
  queue?: QueuedItem[]
  /** Live background jobs (session/jobs frames); settled jobs drop out of the snapshot. */
  jobs?: JobItem[]
  /**
   * Context-occupancy meter data (dsh `contextPressure` + `contextBreakdown`
   * projections). Absent until the provider reports both a pressure sample
   * and the route's context window — the ring hides until then (web parity).
   */
  contextUsage?: {
    percent: number
    usedTokens: number
    contextWindow: number
    /** Heuristic composition (system prompt / tools / conversation). */
    breakdown?: { systemTokens: number; toolsTokens: number; messageTokens: number }
    /**
     * Closed-turn count from the `sessionStats` projection; the webview's
     * context meter (src/pure/contextMeter.ts) uses it for the per-turn
     * growth estimate. Absent until the first closed turn.
     */
    turns?: number
  }
}

/** One live background job (bash, subagent, …) shown above the composer. */
export interface JobItem {
  id: string
  kind: string
  label: string
  status: 'running' | 'stopping'
  detail?: string
}

/** One pending inbox prompt: `queued` shows above the composer, `steering` at the transcript tail. */
export interface QueuedItem {
  id: string
  placement: 'queued' | 'steering'
  /** Short preview: attachment lines stripped, image/file counts prefixed. */
  text: string
  /** Full original text (attachment lines included) for the inline editor. */
  editText: string
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

/**
 * Sessions 面板快照（host → webview）：store 的会话树模型加上服务状态，
 * 供面板自身渲染空态（启动服务 / 安装引导），不再依赖 viewsWelcome。
 */
export interface SessionsSnapshot {
  workspaces: WorkspaceNodeModel[]
  /** 当前搜索词（null = 未过滤）。 */
  query: string | null
  sortOrder: SessionSortOrder
  /** ServerStatus.state 的拷贝（pure 层不 import server 模块）。 */
  serverState: 'stopped' | 'starting' | 'running' | 'error'
  /** 启动失败原因是未找到 dsh 可执行文件。 */
  dshNotFound: boolean
  /** 本地置顶的会话 id（dsh 无置顶 API，纯客户端状态）。 */
  pinned: string[]
  /** 折叠的 workspace id。 */
  collapsed: string[]
  /** 手动标记未读的会话 id（dsh 无未读 API，纯客户端状态）。 */
  unread: string[]
}

export type ToWebviewMessage =
  | { type: 'state'; state: ChatState }
  | { type: 'sessions'; snapshot: SessionsSnapshot }
  | { type: 'imagesPicked'; images: OutgoingImage[] }
  | { type: 'filesPicked'; files: StagedFile[] }
  | { type: 'modelCatalog'; catalog: ModelCatalog }
  | { type: 'attachmentData'; attachmentId: string; mediaType: string; data: string }
  | { type: 'restoreDraft'; text: string }
  | { type: 'commandResult'; text: string }

export type FromWebviewMessage =
  | { type: 'send'; text: string; images?: OutgoingImage[]; steer?: boolean }
  | { type: 'stop' }
  | { type: 'approval'; rpcId: string; outcome: 'allowed-once' | 'rejected' }
  | { type: 'answer'; rpcId: string; answers: QuestionAnswerInput[] }
  | { type: 'pickFiles' }
  | { type: 'filesPasted'; files: OutgoingImage[] }
  | { type: 'requestModels' }
  | { type: 'setModel'; provider: string; model: string; reasoningEffort?: string }
  | { type: 'setPermission'; value: string }
  /** Pick an agent preset on a blank session (composer chip dropdown). */
  | { type: 'setAgentPreset'; id: string }
  | { type: 'renameSession'; title: string }
  | { type: 'queueEdit'; itemId: string; text: string }
  | { type: 'queueSteer'; itemId: string }
  | { type: 'queueRemove'; itemId: string }
  | { type: 'requestAttachment'; attachmentId: string }
  /** Set/clear the user's rating on one assistant message (null clears). */
  | { type: 'feedback'; messageId: string; rating: 'positive' | 'negative' | null }
  /** Fork the session at a completed turn's last event seq (ChatAssistantMessage.seq). */
  | { type: 'fork'; atSeq: number }
  /** Open the official dsh install page in the system browser. */
  | { type: 'openInstallPage' }
  /** Sessions 面板：附着一个会话（点击会话行）。 */
  | { type: 'sessionOpen'; sessionId: string }
  /** Sessions 面板：在指定 workspace 新建会话（缺省由宿主选默认 workspace）。 */
  | { type: 'sessionNew'; workspaceId?: string }
  /** Sessions 面板：重命名会话；title 为当前标题，供宿主输入框预填。 */
  | { type: 'sessionRename'; sessionId: string; title: string }
  /** Sessions 面板：归档会话；title 供宿主确认框展示。 */
  | { type: 'sessionArchive'; sessionId: string; title: string }
  /** Sessions 面板：选文件夹注册新 workspace。 */
  | { type: 'workspaceAdd' }
  /** Sessions 面板：在 dsh 全局目录（~/.dsh/workspaces/）下新建目录并注册为 workspace。 */
  | { type: 'workspaceCreate' }
  /** Sessions 面板：在 VSCode 中打开该 workspace 的文件夹。 */
  | { type: 'workspaceOpenFolder'; path: string }
  /** Sessions 面板：在 VSCode 终端中打开该 workspace 的文件夹。 */
  | { type: 'workspaceOpenTerminal'; path: string }
  /** Sessions 面板：手动刷新列表。 */
  | { type: 'sessionsRefresh' }
  /** Sessions 面板：设置/清除搜索词。 */
  | { type: 'sessionsSearch'; query: string | null }
  /** Sessions 面板：切换排序方式。 */
  | { type: 'sessionsSort'; order: SessionSortOrder }
  /** Sessions 面板：置顶/取消置顶会话（本地状态）。 */
  | { type: 'sessionPin'; sessionId: string; pin: boolean }
  /** Sessions 面板：标记未读/已读会话（本地状态）。 */
  | { type: 'sessionUnread'; sessionId: string; unread: boolean }
  /** Sessions 面板：折叠/展开一个 workspace 分组。 */
  | { type: 'workspaceCollapse'; workspaceId: string; collapsed: boolean }
  /** Sessions 面板：一键折叠当前列表里的所有 workspace 分组。 */
  | { type: 'workspacesCollapseAll' }
  /** Sessions 面板：一键展开当前列表里的所有 workspace 分组。 */
  | { type: 'workspacesExpandAll' }
  /** Sessions 面板：从列表软移除 workspace（文件夹与会话保留，会话归入未分组）。 */
  | { type: 'workspaceRemove'; workspaceId: string; label: string }
  /** Sessions 面板：从会话尾部创建分支会话并附着。 */
  | { type: 'sessionFork'; sessionId: string }
  /** Sessions 面板：复制会话的 canonical 引用 mention（@[标题](dsh-session:...)）到剪贴板。 */
  | { type: 'sessionCopyReference'; sessionId: string; title: string }
  /** Sessions 面板：复制会话 ID 到剪贴板。 */
  | { type: 'sessionCopyId'; sessionId: string }
  /** Sessions 面板空态：启动 dsh 服务。 */
  | { type: 'serverStart' }
