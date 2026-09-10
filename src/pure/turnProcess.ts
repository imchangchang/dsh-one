/**
 * 回合过程（turn-process）折叠：官方 `@deepseek-ai/dsh-client-ui-chat` 的
 * turn-process 语义（client.js 6338-6545）按 dsh-one 的 loose 事件镜像口径
 * 移植成增量 fold。
 *
 * 官方把「一个回合里的过程」折成一条可点的折叠行（「5 次工具调用 · 4 条消息」），
 * 成员节点在折叠态隐藏，只留首条人类输入、折叠行、最终答案与 turn-tail。判定
 * 分三层：
 *
 * 1. **状态**（`TurnProcessFold`，按事件增量折）：每步第一条可见证据的 seq
 *    （`assistantStartByStep`）、有回复内容的 assistant/message 计数（总/分步）、
 *    tool/call 计数（subagent 单列）、首个「外部过程」证据的 seq（tool/call、
 *    tool/result、llm/retry），以及由上述证据 seq 取最小得到的控制锚
 *    `controlAnchorSeq`。
 * 2. **spec**（`TurnProcessFold.spec()`，回合收尾时算）：答案步是谁（最后一个
 *    有落盘消息、有回复内容、且不含工具调用的步）、过程窗口
 *    `[processStartSeq, answerAnchorSeq)`、计数（有答案时只数答案步之前的消息）、
 *    答案步是否带内联 reasoning。
 * 3. **presentation**（`turnProcessPresentation()`，需要回合的节点列表）：过程
 *    窗内有没有「外部过程」（非答案步的节点）、有没有插话把答案挤出去
 *    （`compactAnswer`）、首条人类输入的锚（折叠行排在它后面）。
 *
 * 与官方的一处结构性差异：官方 tool 是独立节点（有自己的 anchorSeq），我们的
 * tool 块挂在所属 step 的 assistant 消息里。所以成员判定用「步归属」（step 与
 * answerStep 比较）而不是 anchor 区间——顺序执行的回合里两者等价；跨 step 的
 * 杂类证据（tool/result、llm/retry）仍按 anchorSeq 参与 hasExternalProcess。
 */
import type { ChatTurnProcess } from './chatContract.ts'
import type { SessionEventLike } from './conversation.ts'

/** 官方 isSubagentDelegationTool（client.js 1360-1362）。 */
export function isSubagentDelegationTool(name: unknown): boolean {
  return typeof name === 'string' && (name === 'subagent' || name.startsWith('subagent_'))
}

/** 官方 hasAssistantReplyContent（client.js 6330-6336）：文本块非空即算回复内容。 */
export function hasAssistantReplyContent(blocks: readonly { type: string; text?: string }[]): boolean {
  return blocks.some((block) => {
    if (block.type === 'reasoning' || block.type === 'tool') return false
    if (block.type === 'text') return (block.text ?? '').trim() !== ''
    return true
  })
}

/**
 * 官方 visibleAssistantEvent 的事件级投影：这条事件是不是「可见的 assistant
 * 证据」。tool-call 相关的块（tool-call-delta、block-start/end 的 tool-call、
 * assistant/message 里只有工具调用的内容）不算——它们是过程里的杂类证据。
 */
function visibleAssistantEvidence(event: SessionEventLike): boolean {
  const data = (event.data ?? {}) as { step?: unknown; chunk?: { type?: unknown; blockType?: unknown; text?: unknown; block?: { type?: unknown; text?: unknown } }; message?: { content?: unknown } }
  if (event.type === 'assistant/chunk') {
    const chunk = data.chunk
    if (!chunk || typeof chunk.type !== 'string') return false
    if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
      return typeof chunk.text === 'string' && chunk.text.trim() !== ''
    }
    if (chunk.type === 'block-start') {
      return chunk.blockType !== 'text' && chunk.blockType !== 'reasoning' && chunk.blockType !== 'tool-call'
    }
    if (chunk.type !== 'block-end') return false
    const block = chunk.block
    if (!block || typeof block.type !== 'string') return false
    if (block.type === 'tool-call') return false
    if (block.type === 'text' || block.type === 'reasoning') {
      return typeof block.text === 'string' && block.text.trim() !== ''
    }
    return true
  }
  if (event.type !== 'assistant/message') return false
  const content = data.message?.content
  if (!Array.isArray(content)) return false
  return content.some((raw) => {
    const block = raw as { type?: unknown; text?: unknown }
    if (block?.type === 'tool-call') return false
    if (block?.type === 'text' || block?.type === 'reasoning') {
      return typeof block.text === 'string' && block.text.trim() !== ''
    }
    return typeof block?.type === 'string'
  })
}

/** 每条可见 assistant/message 的回复内容判定（只数真正的回复，推理不算）。 */
function messageReplyContent(event: SessionEventLike): boolean {
  const content = ((event.data ?? {}) as { message?: { content?: unknown } }).message?.content
  if (!Array.isArray(content)) return false
  return hasAssistantReplyContent(
    content.flatMap((raw) => {
      const block = raw as { type?: unknown; text?: unknown }
      return typeof block?.type === 'string' ? [{ type: block.type, text: typeof block.text === 'string' ? block.text : '' }] : []
    }),
  )
}

/** One turn's folded process facts (官方 updateProcessState 的 state 形状)。 */
export class TurnProcessFold {
  readonly turn: number
  /** step → 该步第一条可见证据的 seq。 */
  readonly assistantStartByStep = new Map<number, number>()
  /** step → 有回复内容的 assistant/message 条数。 */
  readonly messageCountByStep = new Map<number, number>()
  /** step → 该步 assistant/message 事件的 seq（官方 finalNode.seq）。 */
  readonly finalSeqByStep = new Map<number, number>()
  messageCount = 0
  toolCallCount = 0
  subagentCount = 0
  otherStartSeq: number | undefined
  controlAnchorSeq: number | undefined

  constructor(turn: number) {
    this.turn = turn
  }

  /** Fold one turn-scoped event (官方 turn-process definition 的 update)。 */
  fold(event: SessionEventLike): void {
    const data = (event.data ?? {}) as { step?: unknown; name?: unknown }
    const step = Number(data.step)
    if (event.type === 'assistant/message' && messageReplyContent(event)) {
      if (Number.isFinite(step)) this.messageCountByStep.set(step, (this.messageCountByStep.get(step) ?? 0) + 1)
      this.messageCount += 1
      if (Number.isFinite(step)) this.finalSeqByStep.set(step, event.seq)
    }
    if (event.type === 'tool/call') {
      if (isSubagentDelegationTool(data.name)) this.subagentCount += 1
      else this.toolCallCount += 1
    }
    const evidenceStep = visibleAssistantEvidence(event) && Number.isFinite(step) ? step : null
    if (evidenceStep !== null) {
      // 该步已经有首条证据：官方原样返回 current（不改 controlAnchorSeq），
      // 因为 controlAnchorSeq 本就是所有证据 seq 的最小值，不会更小。
      if (this.assistantStartByStep.has(evidenceStep)) return
      this.assistantStartByStep.set(evidenceStep, event.seq)
      this.controlAnchorSeq = Math.min(this.controlAnchorSeq ?? Number.POSITIVE_INFINITY, event.seq)
      return
    }
    if (event.type === 'tool/call' || event.type === 'tool/result' || event.type === 'llm/retry') {
      if (this.otherStartSeq === undefined) this.otherStartSeq = event.seq
      this.controlAnchorSeq = Math.min(this.controlAnchorSeq ?? Number.POSITIVE_INFINITY, event.seq)
    }
  }

  /**
   * 回合收尾时的过程窗口 spec（官方 processSpec）。`answer` 是最后一步的
   * assistant 消息视图：`messageId` 存在（有 assistant/message 落盘）、有回复
   * 内容、且不含工具块，才算答案步——否则整个回合不折（官方 latestAnswer 返回
   * null 时 control 节点 data 的 answerAnchorSeq 也是 null，foldable 恒 false）。
   */
  spec(turnStartSeq: number | undefined, answer: TurnProcessAnswer | null): TurnProcessSpec | null {
    const controlAnchorSeq = this.controlAnchorSeq
    if (controlAnchorSeq === undefined) return null
    if (answer === null) {
      return {
        controlAnchorSeq,
        processStartSeq: controlAnchorSeq,
        answerAnchorSeq: null,
        answerStep: null,
        inlineReasoning: false,
        messageCount: this.messageCount,
        toolCallCount: this.toolCallCount,
        subagentCount: this.subagentCount,
      }
    }
    let messageCount = 0
    for (const [step, count] of this.messageCountByStep) if (step < answer.step) messageCount += count
    let earlierAssistantSeq = Number.POSITIVE_INFINITY
    for (const [step, seq] of this.assistantStartByStep) if (step < answer.step) earlierAssistantSeq = Math.min(earlierAssistantSeq, seq)
    const externalProcessSeq = Math.min(this.otherStartSeq ?? Number.POSITIVE_INFINITY, earlierAssistantSeq)
    return {
      controlAnchorSeq,
      processStartSeq:
        turnStartSeq ?? (Number.isFinite(externalProcessSeq) ? externalProcessSeq : this.finalSeqByStep.get(answer.step) ?? answer.seq),
      answerAnchorSeq: this.finalSeqByStep.get(answer.step) ?? answer.seq,
      answerStep: answer.step,
      inlineReasoning: answer.inlineReasoning,
      messageCount,
      toolCallCount: this.toolCallCount,
      subagentCount: this.subagentCount,
    }
  }
}

/** 答案步的视图（由 ConversationFolder 从最后一步的 assistant 消息给出）。 */
export interface TurnProcessAnswer {
  step: number
  seq: number
  inlineReasoning: boolean
}

/** 官方 processSpec 的产物（还没有 presentation 那层）。 */
export interface TurnProcessSpec {
  controlAnchorSeq: number
  processStartSeq: number
  answerAnchorSeq: number | null
  answerStep: number | null
  inlineReasoning: boolean
  messageCount: number
  toolCallCount: number
  subagentCount: number
}

/** 过程窗里一个候选节点的投影（presentation 只看这些字段）。 */
export interface TurnProcessNode {
  kind: 'assistant' | 'user' | 'steering' | 'context'
  /** 官方 anchorSeq。 */
  anchorSeq: number
  /** assistant 节点的步号（其余节点无）。 */
  step?: number
}

/**
 * presentation 层（官方 derivePresentation，client.js 4650-4672）：过程窗内
 * 有没有外部过程、答案能不能跟着一起折、折叠行排在谁后面。返回 null 表示这个
 * 回合没有可折的东西（answerAnchorSeq 为 null → 官方 foldable 恒 false）。
 */
export function turnProcessPresentation(
  turn: number,
  spec: TurnProcessSpec,
  nodes: readonly TurnProcessNode[],
): ChatTurnProcess | null {
  if (spec.answerAnchorSeq === null || spec.answerStep === null) return null
  const answerAnchorSeq = spec.answerAnchorSeq
  const answerStep = spec.answerStep
  // 折叠行前最近的一条人类输入（官方取 controlAnchorSeq 之前 user/steering 的
  // 最小 anchorSeq）。
  let openingHumanAnchor: number | undefined
  for (const node of nodes) {
    if (node.kind !== 'user' && node.kind !== 'steering') continue
    if (node.anchorSeq >= spec.controlAnchorSeq) continue
    openingHumanAnchor = Math.min(openingHumanAnchor ?? node.anchorSeq, node.anchorSeq)
  }
  let hasExternalProcess = false
  let compactAnswer = true
  let earliestProcessAnchor: number | undefined
  for (const node of nodes) {
    if (node.kind === 'user' || node.kind === 'steering') {
      // 过程锚之前的人类输入是「首条输入」（折叠行排在它后面），之后的是插话
      // （把答案挤出去，不跟着折）。官方对 user/steering 一律跳过、不进过程锚。
      if ((openingHumanAnchor === undefined || node.anchorSeq > openingHumanAnchor) && node.anchorSeq < answerAnchorSeq) {
        compactAnswer = false
      }
      continue
    }
    // 官方这里跳过的「独立节点」kind 是 system-prompt/user/steering/
    // turn-process/turn-error/turn-max-tokens/turn-tail；注意 context **不在**
    // 这个集合里——注入上下文也在过程窗内、会被折掉。
    earliestProcessAnchor = Math.min(earliestProcessAnchor ?? node.anchorSeq, node.anchorSeq)
    if (node.anchorSeq < spec.processStartSeq || node.anchorSeq >= answerAnchorSeq) continue
    // 答案步本身不算外部过程。
    if (node.kind === 'assistant' && node.step === answerStep) continue
    hasExternalProcess = true
  }
  const anchorSeq = openingHumanAnchor ?? earliestProcessAnchor ?? spec.controlAnchorSeq
  return {
    turn,
    anchorSeq,
    afterSeq: openingHumanAnchor ?? null,
    processStartSeq: spec.processStartSeq,
    answerAnchorSeq,
    answerStep,
    inlineReasoning: spec.inlineReasoning,
    hasExternalProcess,
    compactAnswer,
    messageCount: spec.messageCount,
    toolCallCount: spec.toolCallCount,
    subagentCount: spec.subagentCount,
  }
}
