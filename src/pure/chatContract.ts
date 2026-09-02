/**
 * Contract between the extension host and the chat webview, plus the folded
 * conversation model both sides share. The host folds dsh session events into
 * ChatMessage[]; the webview renders ChatState snapshots verbatim. Treat this
 * file as an interface freeze: change it only when both sides change together.
 */
import type { SessionSortOrder, WorkspaceNodeModel } from './sessionTree.ts'
import type { ActivityJob } from './activityTree.ts'
import type { FileRefCandidate } from './fileReference.ts'
import type { WorkflowRunView } from './workflowRun.ts'

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
  /**
   * Result text, kept in full — the folder does not truncate; the webview
   * previews the first lines and expands to the whole text on click.
   * Absent while running.
   */
  /** 该次调用的输入参数（tool/call 的 data.arguments 原始 JSON 字符串，未加工），
   * 供工具卡展开显示 IN。缺省 = 事件没带参数，或窗口外落地的 result 卡。 */
  args?: string
  output?: string
  /**
   * todo_write 调用的 planSummary，由该次调用 args 的 JSON 快照算出（对齐官方
   * dsh-client-ui-tool 的 TodoRow；与 ChatState.todos 投影是同一数据域的两个
   * 独立渲染，各算各的、不共享派生）。args 解析失败时缺省，退回落通用工具行。
   */
  todos?: { done: number; total: number; activeContent: string | null; activeExtra: number }
  /**
   * tool/result 事件的 `meta` 原样透传（dsh-session 契约里 tool 私有的可选
   * presentation 载荷；cordis_define/run 用它带 pluginId/packageId/pluginRunId）。
   * 缺省 = 事件没带 meta（skill 等工具不产生）。
   */
  meta?: unknown
}

/**
 * 模型请求重试行（dsh `llm/retry` + `llm/retry-started` 折叠）：一次延迟重试
 * 等待期的状态行，倒计时 + 失败原因 + 最大次数（对齐官方 ModelRetryItem）。
 * 同一 retryId 的多次尝试原地更新（retry 计数递增、回到 scheduled）；所属
 * turn/end 到达时仍未 started 的尝试标记 cancelled（对齐官方 isClosed 语义）。
 */
export interface ChatRetryBlock {
  type: 'retry'
  /** 第几次重试（从 1 起）。 */
  retry: number
  /** mode='always' 时无限重试（UI 显示 ∞），无上限字段。 */
  mode: 'normal' | 'always'
  /** mode='normal' 的重试上限。 */
  maxRetries?: number
  /** 本次尝试的等待时长（毫秒）。 */
  delayMs: number
  /** 触发重试的失败原因（provider 原始 message）。 */
  failure: { message: string }
  /**
   * 生命周期：scheduled（等待中，倒计时）→ started（llm/retry-started，
   * 已开始重试）／cancelled（所属 turn 先关闭）。历史里已收尾的尝试保持终态。
   */
  retryState: 'scheduled' | 'started' | 'cancelled'
  /** 该 llm/retry 事件的 epoch ms 时间戳；等待截止 = time + delayMs。 */
  time?: number
}

export type ChatBlock = ChatTextBlock | ChatReasoningBlock | ChatToolBlock | ChatRetryBlock

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
  /**
   * 本消息引用的会话（{sessionId, label}，按 mention 出现顺序）。host 解析
   * 引用后落盘的是可读 @label 文本，URI 信息只留在紧随其后的
   * session-reference 注入上下文 source.references 里，fold 时回挂到这条
   * 消息上，气泡据此把 @label 渲染成可点击链接。
   */
  references?: Array<{ sessionId: string; label: string }>
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
   * turn/end reason {kind:'max-tokens'}：至少一步触达输出 token 上限。渲染
   * 黄色提示行（对齐官方 TurnMaxTokensItem）；与 turnError 互斥。
   */
  maxTokens?: boolean
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
  /**
   * 本轮产出的文件路径（对齐官方 dsh web ProducedFiles：`turn/end` 时从本
   * turn 的 tool/call view 聚合——diff 卡或 generic+edit 卡的 locations，
   * 首次出现顺序、去重；只挂 turnEnd 消息）。webview 在 turn 尾部渲染成
   * 产物 chips 行。无产物或缺省。
   */
  producedFiles?: string[]
  /** The user's stored rating for this message (messageFeedback/list), if any. */
  feedbackRating?: 'positive' | 'negative'
  /**
   * Turn-level timing folded at turn/end (web parity: TurnTailNodeView's
   * 时钟 + 用时/首 token/吞吐). Only the turn's final message carries it;
   * the webview renders the present parts after the action icons.
   * Values are absent when the needed events fell outside the loaded window
   * (turn/start, step/start, first token delta, or assistant/message usage),
   * matching the official client's window-scoped derivation.
   */
  timing?: ChatTurnTiming
}

/** Turn-level timing metrics derived by the folder at turn/end (see ChatAssistantMessage.timing). */
export interface ChatTurnTiming {
  /** 本 turn 最后一条 assistant 消息的完成时间（epoch ms；无 assistant/message 时回退 turn/end 时间）。 */
  time: number
  /** Turn 总耗时 ms（turn/end − turn/start；turn/start 在窗口外时缺省）。 */
  runMs?: number
  /** 首 token 延迟 ms（turn 内第一步：首个非空 delta − step/start）。 */
  ttftMs?: number
  /** 解码吞吐 tok/s（各 step outputTokens 之和 ÷ 解码耗时之和）。 */
  tokensPerSecond?: number
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
  /**
   * 手动 /compact 的压缩摘要（对齐官方 CompactionCommandCard）：checkpoint
   * user/message 的 source.sourceCommandId 命中本命令卡时挂上来，命令卡就此
   * 渲染成折叠摘要卡。summary/items/tokens 来自配对的 compaction/summary
   * 事件；该事件落在窗口外时 summary 为 null（卡不可展开）、计数为 null。
   */
  compaction?: { summary: string | null; items: number | null; tokens: number | null }
}

/**
 * 自动压缩的独立标记卡（对齐官方 CompactionItem）：checkpoint user/message
 * 无 sourceCommandId（自动触发）或对应命令卡在窗口外时折叠成这条消息。折叠
 * 态标题「上下文已压缩」+ 计数摘要；有 summary 才可展开看摘要全文。
 */
export interface ChatCompactionMessage {
  kind: 'compaction'
  /** The checkpoint's compactionId (stable per compaction transaction). */
  id: string
  /** 摘要正文（compaction/summary 的 text 块拼接）；null = 不可展开。 */
  summary: string | null
  /** 被替换的 surface 节点数；summary 事件缺失或畸形时为 null。 */
  items: number | null
  /** 被替换内容的估计 token 数；同上。 */
  tokens: number | null
}

export type ChatMessage = ChatUserMessage | ChatAssistantMessage | ChatCommandMessage | ChatCompactionMessage

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

/** 会话列表行首的待交互状态（官方 dsh web PendingInteractionStatus 同款三态）。 */
export type PendingInteraction = 'approval' | 'question' | 'plan-review'

/**
 * question/requested 帧到列表状态的映射（官方 dsh-client-runtime
 * questionInteractionStatus 同款判定）：单问、带 detail、非多选、选项 ≤2
 * 且其中一个选项 label 命中 intent.approve 的 plan-review 才算「计划评审」，
 * 其余一律按普通「待回答」。
 */
export function questionInteractionStatus(
  questions: PendingQuestion['questions'],
): PendingInteraction {
  if (questions.length !== 1) return 'question'
  const q = questions[0]
  if (q.intent?.kind !== 'plan-review' || q.detail === undefined) return 'question'
  if (q.multiSelect === true) return 'question'
  const options = q.options ?? []
  if (options.length > 2) return 'question'
  return options.some((o) => o.label === q.intent?.approve) ? 'plan-review' : 'question'
}

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

/**
 * 头部「N 个子代理」chip 下拉里的一个子代理节点。递归的 `children` 承载
 * 血缘嵌套（子代理再开子代理）：顶层是当前会话的直接子代理，children 里
 * 再挂它们各自的后代。webview 按层级缩进渲染。
 */
export interface SubagentNode {
  sessionId: string
  title: string
  /** 运行中画像素环，已完成画灰点（对齐官方 activity 状态区分）。 */
  running: boolean
  totalTokens?: number
  /** Epoch milliseconds（session.list 的 updatedAt）。 */
  updatedAt: number
  /** 该子代理自己的子代理（血缘后代），递归；无则缺省。 */
  children?: SubagentNode[]
}

/** One item of the `todos` projection (dsh TodoItem): whole-list snapshot, no id. */
export interface ChatTodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

/** Whole-chat snapshot pushed host → webview (throttled; replaces state). */
export interface ChatState {
  sessionId: string | null
  sessionTitle?: string
  /**
   * 历史基线（session.history 尾部窗口）还在加载：webview 此时显示加载占位而不是
   * 空会话 hero，避免切换会话时 hero 闪一帧再被消息流替换。
   */
  loading?: boolean
  /**
   * 历史窗口之前还有更早的消息（session.history 的 hasMore；窗口分页，
   * 对齐官方 loadOlder）：webview 在消息列表顶部显示「加载更早」，点击或
   * 上翻到顶时发 loadEarlier。
   */
  hasEarlierHistory?: boolean
  /** 一页更早历史正在加载：按钮变加载态，webview 的滚动锚定也靠它配对。 */
  loadingEarlier?: boolean
  messages: ChatMessage[]
  pending: PendingRequest[]
  /**
   * 附着会话的运行位：服务端 running（session.list 摘要 + host/session-status
   * 帧，经 SessionsStore 中继）为权威值；基线未覆盖该会话前回退到 mux 事件
   * 折叠的 hasOpenTurn()。
   */
  running: boolean
  /** Server + session ready for input. */
  canSend: boolean
  /**
   * 当前模型是否可用（host 从 session.models 的 routable 存；未知/未拉取到
   * 视为可用，只有明确 routable=false 才为 false）：false 时输入区显示
   * 「当前模型不可用，请先选择模型」式阻塞文案，模型 pill 保持可点以便重选。
   */
  modelAvailable?: boolean
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
   * 空会话 hero 区的 workspace 名 chip（官方空态的 workspace 触发器，现在可
   * 点击弹选择器）：附着会话所属 workspace 的 title，由 ChatViewProvider 从
   * SessionsStore 的 workspace.list 基线（含 blank 会话）合成。
   */
  workspaceLabel?: string
  /**
   * 附着会话所属 workspace 的 id（选择器里当前项的选中对勾）。与
   * workspaceLabel 同源；会话不在任何 workspace 的 sessionIds 里时缺省
   * （label 的「未分组」兜底不产生 id）。
   */
  workspaceId?: string
  /**
   * 空会话 hero 的 workspace 选择器列表（官方 WorkspacePicker 的数据源）：
   * workspace.list 基线的轻量投影（id + path + title，path 供悬停 tooltip），
   * 由 ChatViewProvider 合成，随 store 基线刷新。列表为空时选择器只显示
   * 添加入口。
   */
  workspaces?: Array<{ workspaceId: string; path: string; title: string }>
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
   * 回到父会话内容）：附着会话在 session.list 基线里 origin === 'subagent'
   * 时由 ChatViewProvider 合成；普通 fork 会话虽有 parentSessionId 但不写
   * origin，不显示父标题。普通会话缺省。
   */
  parentSession?: {
    sessionId: string
    title: string
  }
  /**
   * 头部「N 个子代理」chip 的下拉行：本会话的全部 continuable 子代理
   * （session.list 基线里 origin === 'subagent' 且 parentSessionId 指向本
   * 会话的会话，含已完成的），由 ChatViewProvider 从 SessionsStore 递归
   * 组装成血缘树——直接子代理的
   * children 里再挂它们各自的后代（子代理再开子代理），每一层都按
   * 运行中优先 + 新近优先排好；一个子代理都没有时缺省（chip 不渲染）。
   * chip 上的计数只算直接子代理（顶层项数），下拉里各层缩进展示。
   */
  subagents?: SubagentNode[]
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
   * 任务清单（`todos` 投影，last-wins 整表、turn/start 清空）：缺省/null =
   * 无清单（首写前 / turn/start 后），[] = 空清单（webview 两种都不渲染）。
   * 非空时 webview 在输入区上方渲染可折叠卡（对齐官方 TodoPanel/TodoDock）。
   */
  todos?: ChatTodoItem[]
  /**
   * 会话日志里的 workflow 运行卡片（tool-workflow/* 事件按 runId 折叠，见
   * src/pure/workflowRun.ts）：webview 按 anchorSeq 插进消息流渲染成
   * run→phase→member 三层可展开卡片（对齐官方 WorkflowRunPanel）。无则缺省。
   */
  workflowRuns?: WorkflowRunView[]
  /**
   * Context-occupancy meter data (dsh `contextPressure` + `contextBreakdown`
   * projections). Absent until the provider reports both a pressure sample
   * and the route's context window — the ring hides until then (web parity).
   */
  contextUsage?: ContextUsage
}

/**
 * Context-occupancy meter value. Either a real ratio (the ring shows the
 * fraction), or a 「窗口未知」placeholder: the user switched to a model whose
 * context window we have never observed, so no honest ratio exists yet (the
 * payload can still carry the used-token count from the last sample). The
 * placeholder recovers to the real ratio once the next request/context for
 * that model arrives.
 */
export type ContextUsage =
  | { windowUnknown: true; usedTokens?: number }
  | {
      windowUnknown?: false
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
  /**
   * 高亮的会话 id（editor ChatViewProvider 的 activeSessionId）：面板开着且
   * 附着时为当前附着会话，否则是懒加载待附着目标。侧栏据此画 active 行高亮
   * 与所属 workspace 的蓝色文件夹。拆分后 chat 在 editor 面板，会话高亮归
   * 侧栏渲染，故由宿主下发。
   */
  activeSessionId: string | null
  /**
   * editor 面板当前真实附着的会话 id（面板未开或未附着为 null）。与
   * activeSessionId 不同，从不回退到懒加载 pending 目标——侧栏「已打开会话
   * 单击 = 行内重命名」的判定用它，避免 reload 等人面板没开但高亮时误入重命名。
   */
  attachedSessionId: string | null
  /** 内容全文搜索（session.search）是否被 20 条上限截断；面板据此显示轻提示。 */
  contentSearchHasMore: boolean
  /** 最近一次内容搜索是否失败（后端索引未启用等）；true 时面板显示「仅按标题匹配」提示。 */
  contentSearchError: boolean
}

export type ToWebviewMessage =
  | { type: 'state'; state: ChatState }
  | { type: 'sessions'; snapshot: SessionsSnapshot }
  | { type: 'imagesPicked'; images: OutgoingImage[] }
  | { type: 'filesPicked'; files: StagedFile[] }
  | { type: 'modelCatalog'; catalog: ModelCatalog }
  /**
   * 模型目录拉取失败（session.models RPC 出错）：webview 的模型菜单据此显示
   * error/Retry 行（有旧目录时保留旧数据，不打断）。
   */
  | { type: 'modelCatalogError' }
  | { type: 'attachmentData'; attachmentId: string; mediaType: string; data: string }
  | { type: 'restoreDraft'; text: string }
  | { type: 'commandResult'; text: string }
  /** @ 补全的文件/文件夹候选响应；requestId 回声，过期的响应由 webview 丢弃。 */
  | { type: 'fileRefList'; requestId: number; items: FileRefCandidate[] }

export type FromWebviewMessage =
  /** Webview 脚本加载完成（含 tab 切走后 VSCode 重载的场合）；宿主据此重推当前状态。 */
  | { type: 'ready' }
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
  /** 产物 chip 点击：在 VSCode 编辑器打开该文件（绝对路径，任意位置）。 */
  | { type: 'producedOpenFile'; path: string }
  /** 加载更早的一页历史（窗口分页；ChatState.hasEarlierHistory 为 true 时才有意义）。 */
  | { type: 'loadEarlier' }
  /** Open the official dsh install page in the system browser. */
  | { type: 'openInstallPage' }
  /** 对话里的外链（http/https/mailto 锚点）被点击；webview 已阻止自身导航。 */
  | { type: 'openExternal'; url: string }
  /** 外链右键菜单选了「VS Code 内置浏览器打开」（Simple Browser）。 */
  | { type: 'openInBuiltinBrowser'; url: string }
  /** Sessions 面板：附着一个会话（点击会话行）。 */
  | { type: 'sessionOpen'; sessionId: string }
  /** Sessions 面板：在指定 workspace 新建会话（缺省由宿主选默认 workspace）。 */
  | { type: 'sessionNew'; workspaceId?: string }
  /** Sessions 面板：新建不挂 workspace 的「未分组」会话（cwd 走宿主临时目录）。 */
  | { type: 'sessionNewUngrouped' }
  /** Sessions 面板：重命名会话；title 为当前标题，供宿主输入框预填。 */
  | { type: 'sessionRename'; sessionId: string; title: string }
  /** 行内重命名直接提交（不走 showInputBox 弹窗）：sessionId + 新标题，宿主直接 RPC。 */
  | { type: 'sessionRenameDirect'; sessionId: string; title: string }
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
  /** 空会话 hero 的 workspace 选择器：切到指定 workspace（宿主在该 workspace
   *  复用/新建 blank 会话并切换过去，对齐官方 connectWorkspace）。 */
  | { type: 'workspacePick'; workspaceId: string }
  /** 空会话 hero 的 workspace 选择器：「添加已有文件夹…」——VSCode 原生目录
   *  对话框注册新 workspace 后切过去（复用 dshOne.workspace.add 命令）。 */
  | { type: 'workspacePickAdd' }
  /** 空会话 hero 的 workspace 选择器：「创建工作区…」——在 dsh 全局目录下
   *  新建并注册后切过去（复用 dshOne.workspace.create 命令）。 */
  | { type: 'workspacePickCreate' }
  /** Sessions 面板：复制会话的 canonical 引用 mention（@[标题](dsh-session:...)）到剪贴板。 */
  | { type: 'sessionCopyReference'; sessionId: string; title: string }
  /** Sessions 面板空态：启动 dsh 服务。 */
  | { type: 'serverStart' }
  /** 输入框 @ 补全：请求当前会话 cwd 下的文件/文件夹候选（fileReferences/list）。 */
  | { type: 'fileRefList'; requestId: number; query: string }
