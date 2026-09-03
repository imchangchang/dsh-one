/**
 * mock dsh 场景数据模型 + 示例场景。
 *
 * 场景不是「假 dsh 内部的完整状态」，而是「扩展接管 mock 后能看到什么」的
 * 确定性编排：mock 只在被扩展调用时按场景返回数据，剩下全凭扩展自己折叠。
 * 所以这里类型的每一个字段都对应扩展某个解析器的读法——注释里标出来源。
 *
 * 生效路径（扩展侧，见 src/server/chatSession.ts + src/server/dshRpc.ts）：
 * - session.history：返回场景的 history + projections，ChatSessionController
 *   用 ConversationFolder 折叠成消息（src/pure/conversation.ts applyEvent）。
 * - session.list / workspace.list：场景的 sessions / workspaces 摘要基线。
 * - agentPreset.list：场景的 presets 花名册（空会话选择 chip + 头部标签）。
 * - session.prompt：场景的 onPrompt 时间线（或 mock 默认流）经 mux 推给扩展。
 * - mux 订阅：补发 session/subscribed（gap 检查用）与每个会话的 pendingRequests
 *   状态（approval/question 待批准，未应答就一直在）
 *   （approval/question 待批准态从这里进 pending）。
 *
 * 场景帧是「低层」的：字段直接对应 wire 帧，mock 只补 sessionId 和递增 seq，
 * 保证与扩展解析器（chatSession.ts onFrame / conversation.ts applyEvent /
 * chatContract.ts 各类）逐字段兼容。想编排更高层状态就再叠 helper。
 */
import type {
  SessionEventLike,
  HistoryEntryLike,
  ToolEventViewLike,
} from '../../src/pure/conversation.ts'
import type { SessionModels, SessionSummary, WorkspaceView } from '../../src/server/dshRpc.ts'
import type { AgentPresetLike } from '../../src/pure/agentPreset.ts'
import type { ChatTodoItem } from '../../src/pure/chatContract.ts'

/** 一帧要往 mux 流推的下行帧。payload 里 sessionId 可省，mock 自动补。 */
export interface MuxFrameSpec {
  /** 推这帧前等待 ms（默认 0，连续帧靠它模拟真实节奏）。 */
  delayMs?: number
  /** mux frame 的 method，如 session/event、session/projection、approval/requested。 */
  method: string
  payload: Record<string, unknown>
}

/**
 * 单个会话的场景。sessionId 是扩展用它开 ChatSessionController 的键——
 * 一个场景文件可以同时声明多个会话，扩展随便点哪个都行。
 */
export interface ScopedSession {
  sessionId: string
  /** session.list 摘要（局部字段即可，缺省部分 mock 填默认）。 */
  summary?: Partial<SessionSummary>
  /** session.history 尾页事件（折叠后即会话消息流）。 */
  history?: HistoryEntryLike[]
  /** session.history 附带的 projections 基线（title / sessionStats / todos …）。 */
  projections?: { asOfSeq: number; values: Record<string, unknown> }
  /** session.models 的响应覆写（缺省 mock 给一个通用目录）。 */
  models?: Partial<SessionModels>
  /**
   * 该会话的「未应答服务器请求」状态（approval/question 待批准态）。
   * 对齐真实 dsh 的行为：pending 是会话状态，任何 mux 连接进来都会带上、
   * rpcId 稳定不变、/api/respond 应答后消失——不是一次性事件。
   * payload 里可给 rpcId 固定值（稳定跨连接）；不给则 mock 注册时分配一次。
   */
  pendingRequests?: PendingRequestSpec[]
  /** session.prompt 后推送的编排时间线（缺省 mock 走默认流）。 */
  onPrompt?: MuxFrameSpec[]
}

/** 一个待批准请求的说明（approval/requested 或 question/requested 帧）。 */
export interface PendingRequestSpec {
  method: 'approval/requested' | 'question/requested'
  payload: Record<string, unknown>
}

/** 顶层场景：一次启动 mock 的完整「世界」。 */
export interface MockScenario {
  /** host-wide agentPreset.list 花名册（空会话选择 chip 用）。 */
  presets?: AgentPresetLike[]
  /** workspace.list 基线。 */
  workspaces: WorkspaceView[]
  /** session.list 摘要的来源（每个会话的 detail 在上面的 ScopedSession）。 */
  sessions: ScopedSession[]
}

// ---------------------------------------------------------------------------
// 帧构造 helper：让手写场景少打字、且保证字段贴合 wire。
// ---------------------------------------------------------------------------

/** 一条 session/event 帧（扩展 ConversationFolder 消费 event）。 */
export function sessionEvent(event: SessionEventLike, view?: ToolEventViewLike, delayMs?: number): MuxFrameSpec {
  const payload: Record<string, unknown> = { event }
  if (view) payload.view = view
  return { method: 'session/event', payload, ...(delayMs !== undefined ? { delayMs } : {}) }
}

/** 一条 session/projection 帧（扩展 chatSession.ts session/projection case）。 */
export function projection(seq: number, key: string, value: unknown, delayMs?: number): MuxFrameSpec {
  return { method: 'session/projection', payload: { seq, key, value }, ...(delayMs !== undefined ? { delayMs } : {}) }
}

/** 一条 session/queue 整表快照帧（扩展 session/queue case）。 */
export function queue(items: unknown[], delayMs?: number): MuxFrameSpec {
  return { method: 'session/queue', payload: { items }, ...(delayMs !== undefined ? { delayMs } : {}) }
}

/** 一条 session/jobs 整表快照帧（扩展 session/jobs case）。 */
export function jobs(list: unknown[], delayMs?: number): MuxFrameSpec {
  return { method: 'session/jobs', payload: { jobs: list }, ...(delayMs !== undefined ? { delayMs } : {}) }
}

// ---------------------------------------------------------------------------
// 事件构造 helper（会话日志里的原始事件，src/pure/conversation.ts applyEvent）。
// ---------------------------------------------------------------------------

/** 通用事件骨架：type/seq/data 是 SessionEventLike 的最小数必需字段。 */
export function ev(type: string, seq: number, data: Record<string, unknown>, time?: number): SessionEventLike {
  return { type, seq, data, ...(time !== undefined ? { time } : {}) }
}

const T0 = 1_750_000_000_000

/**
 * 一条已完成 turn 的「正常对话」事件序列：用户消息 + 思考 + 文本 + 工具卡。
 * 返回 HistoryEntryLike[]（session.history 基线用），也拆出 onPrompt 时间线
 * 方便对它再发一条 prompt 看续写。seq 从 1 连续递增。
 */
export function completeTurnHistory(): HistoryEntryLike[] {
  const entries: HistoryEntryLike[] = [
    // 用户消息
    { event: ev('user/message', 1, {
      id: 'user-1',
      content: [{ type: 'text', text: '给这个仓库加一个 /greet 子命令' }],
    }) },
    // 开始一个 turn（reasoning + text + tool 全在这一步）
    { event: ev('turn/start', 2, { turn: 1 }, T0) },
    { event: ev('step/start', 3, { turn: 1, step: 1 }, T0 + 40) },
    // 思考块
    { event: ev('assistant/chunk', 4, {
      turn: 1, step: 1,
      chunk: { type: 'block-start', index: 0, blockType: 'reasoning' },
    }, T0 + 120) },
    { event: ev('assistant/chunk', 5, {
      turn: 1, step: 1,
      chunk: { type: 'reasoning-delta', index: 0, text: '用户想要一个新的斜杠命令。' },
    }, T0 + 140) },
    { event: ev('assistant/chunk', 6, {
      turn: 1, step: 1,
      chunk: { type: 'reasoning-delta', index: 0, text: '我先找到指令注册入口。' },
    }, T0 + 180) },
    { event: ev('assistant/chunk', 7, {
      turn: 1, step: 1,
      chunk: { type: 'block-end', index: 0, block: { type: 'reasoning', text: '用户想要一个新的斜杠命令。我先找到指令注册入口。' } },
    }, T0 + 220) },
    // 文本块
    { event: ev('assistant/chunk', 8, {
      turn: 1, step: 1,
      chunk: { type: 'block-start', index: 1, blockType: 'text' },
    }, T0 + 260) },
    { event: ev('assistant/chunk', 9, {
      turn: 1, step: 1,
      chunk: { type: 'text-delta', index: 1, text: '好的，我先看一下指令注册入口。' },
    }, T0 + 300) },
    // 工具调用卡（bash 跑 grep）
    { event: ev('tool/call', 10, {
      turn: 1, step: 1, callId: 'call-1', name: 'bash',
      arguments: '{\"command\":\"grep -rn slashCommand src\"}',
    }), view: { for: 'call', view: { card: 'terminal', title: 'bash', description: 'grep -rn slashCommand src', cwd: '/repo' } } },
    { event: ev('tool/result', 11, {
      turn: 1, step: 1,
      message: { content: [{ toolCallId: 'call-1', content: [{ type: 'text', text: 'src/components/A.ts\nsrc/components/B.ts' }] }] },
    }), view: { for: 'result', view: { card: 'terminal', title: 'bash', output: 'src/components/A.ts\nsrc/components/B.ts', exitCode: 0 } } },
    // 工具结果后的补白
    { event: ev('assistant/chunk', 12, {
      turn: 1, step: 1,
      chunk: { type: 'text-delta', index: 1, text: '注册入口在 src/pure/slashCommand.ts。' },
    }, T0 + 400) },
    { event: ev('assistant/chunk', 13, {
      turn: 1, step: 1,
      chunk: { type: 'block-end', index: 1, block: { type: 'text', text: '好的，我先看一下指令注册入口。注册入口在 src/pure/slashCommand.ts。' } },
    }, T0 + 440) },
    // 步骤落盘
    { event: ev('assistant/message', 14, {
      turn: 1, step: 1,
      message: { id: 'msg-1', content: [{ type: 'text', text: '好的，我先看一下指令注册入口。注册入口在 src/pure/slashCommand.ts。' }] },
      usage: { outputTokens: 320 },
    }, T0 + 500) },
    // turn 结束
    { event: ev('turn/end', 15, { turn: 1, reason: { kind: 'stop' } }, T0 + 560) },
  ]
  return entries
}

// ---------------------------------------------------------------------------
// 示例场景一：完整对话（已完成 turn，截图就绪）。
// ---------------------------------------------------------------------------

/** 完整对话：一条已完成 turn 的历史基线 + projections（标题/统计）。 */
export function completeConversationScenario(): ScopedSession {
  const history = completeTurnHistory()
  return {
    sessionId: 'scn-conversation',
    summary: {
      sessionId: 'scn-conversation',
      updatedAt: T0 + 560,
      running: false,
      blank: false,
      cwd: '/repo',
      projections: { asOfSeq: 15, values: { title: 'greet 子命令' } },
    },
    history,
    projections: {
      asOfSeq: 15,
      values: {
        title: 'greet 子命令',
        sessionStats: { turns: 1, steps: 1, llmMs: 460, toolMs: 120, ttftMs: 180, ttftSteps: 1, decodeMs: 240, decodeTokens: 320 },
        todos: [
          { content: '找到指令注册入口', status: 'completed' },
          { content: '实现 /greet 子命令', status: 'in_progress' } satisfies ChatTodoItem,
        ] as ChatTodoItem[],
      },
    },
    models: {
      current: { provider: 'deepseek', model: 'deepseek-v4-flash', reasoningEffort: 'high' },
      routable: true,
      groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' } }] }],
    },
    // 再发一条 prompt 走续写时间线（演示流式回复）。
    onPrompt: conversationContinueTimeline(),
  }
}

/** 完整对话再发一条 prompt 的续写时间线（演示流式回复 / 续写场景用）。 */
export function conversationContinueTimeline(): MuxFrameSpec[] {
  return [
    sessionEvent(ev('user/message', 16, { id: 'user-2', content: [{ type: 'text', text: '顺便加个帮助文档' }] }), undefined, 10),
    sessionEvent(ev('turn/start', 17, { turn: 2 }, T0 + 600), undefined, 20),
    sessionEvent(ev('step/start', 18, { turn: 2, step: 1 }, T0 + 640), undefined, 20),
    sessionEvent(ev('assistant/chunk', 19, { turn: 2, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'text' } }, T0 + 680), undefined, 20),
    sessionEvent(ev('assistant/chunk', 20, { turn: 2, step: 1, chunk: { type: 'text-delta', index: 0, text: '我来补充一份' } }, T0 + 720), undefined, 20),
    sessionEvent(ev('assistant/chunk', 21, { turn: 2, step: 1, chunk: { type: 'text-delta', index: 0, text: '使用说明文档。' } }, T0 + 760), undefined, 20),
    sessionEvent(ev('assistant/chunk', 22, { turn: 2, step: 1, chunk: { type: 'block-end', index: 0, block: { type: 'text', text: '我来补充一份使用说明文档。' } } }, T0 + 800), undefined, 20),
    sessionEvent(ev('assistant/message', 23, { turn: 2, step: 1, message: { id: 'msg-2', content: [{ type: 'text', text: '我来补充一份使用说明文档。' }] }, usage: { outputTokens: 90 } }, T0 + 860), undefined, 20),
    sessionEvent(ev('turn/end', 24, { turn: 2, reason: { kind: 'stop' } }, T0 + 900), undefined, 20),
  ]
}

// ---------------------------------------------------------------------------
// 示例场景二：approval 待批准态。
// ---------------------------------------------------------------------------

/** approval 场景：已完成一半的 turn（tool 卡 running）+ 待批准的审批帧。 */
export function approvalScenario(): ScopedSession {
  return {
    sessionId: 'scn-approval',
    summary: {
      sessionId: 'scn-approval',
      updatedAt: T0 + 300,
      running: true,
      blank: false,
      cwd: '/repo',
    },
    // 历史基线：用户消息 → turn 开始 → 工具卡 running（还没 result）。
    history: [
      { event: ev('user/message', 1, { id: 'user-1', content: [{ type: 'text', text: '删除所有临时文件' }] }) },
      { event: ev('turn/start', 2, { turn: 1 }, T0) },
      { event: ev('step/start', 3, { turn: 1, step: 1 }, T0 + 40) },
      { event: ev('assistant/chunk', 4, {
        turn: 1, step: 1,
        chunk: { type: 'block-start', index: 0, blockType: 'text' },
      }, T0 + 80) },
      { event: ev('assistant/chunk', 5, {
        turn: 1, step: 1,
        chunk: { type: 'text-delta', index: 0, text: '需要你批准以下操作。' },
      }, T0 + 120) },
      { event: ev('tool/call', 6, {
        turn: 1, step: 1, callId: 'call-1', name: 'bash',
        arguments: '{\"command\":\"rm -rf ./tmp\"}',
      }), view: { for: 'call', view: { card: 'terminal', title: 'bash', description: 'rm -rf ./tmp', cwd: '/repo' } } },
      // turn 未结束（pending approval 中）。
    ],
    // pending 状态：未应答的 approval，任何 mux 连接进来都会带上（对齐真实 dsh）。
    pendingRequests: [
      { method: 'approval/requested', payload: { approvalId: 'ap-1', toolName: 'bash', reason: 'rm -rf ./tmp 需要批准' } },
    ],
  }
}

// ---------------------------------------------------------------------------
// 示例场景三：空会话。
// ---------------------------------------------------------------------------

/** 空会话：blank 摘要 + 空历史 + preset 花名册（选择 chip 可见）。 */
export function emptyScenario(): ScopedSession {
  return {
    sessionId: 'scn-empty',
    summary: {
      sessionId: 'scn-empty',
      updatedAt: T0,
      running: false,
      blank: true,
      cwd: '/repo',
    },
    history: [],
    projections: { asOfSeq: 0, values: { title: '' } },
    models: {
      current: { provider: 'deepseek', model: 'deepseek-v4-flash' },
      routable: true,
      groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' }] }],
    },
  }
}

/** 默认 preset 花名册（空场景的选择 chip 与已开跑会话头部标签共用）。 */
export function defaultPresets(): AgentPresetLike[] {
  return [
    { id: 'standard', trust: 'system', name: '标准模式', description: '全功能编码代理：文件编辑、shell、搜索、plan、goals、subagents。', isDefault: true },
    { id: 'code', trust: 'system', name: 'PTC 模式', description: '全部标准能力，工具通过 Code Mode SDK 暴露。' },
    { id: 'minimal', trust: 'system', name: 'Minimal 模式', description: '仅持久 bash 与 str_replace_editor 的双工具代理。' },
  ]
}

/** 顶层完整场景：一个 workspace + 上述三个会话 + 默认 preset 花名册。 */
export function defaultScenario(): MockScenario {
  return {
    presets: defaultPresets(),
    workspaces: [
      { workspaceId: 'ws-1', path: '/repo', title: 'repo', sessionIds: ['scn-conversation', 'scn-approval', 'scn-empty'], createdAt: new Date(T0).toISOString(), updatedAt: new Date(T0 + 900).toISOString() },
    ],
    sessions: [completeConversationScenario(), approvalScenario(), emptyScenario()],
  }
}
