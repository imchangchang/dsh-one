import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ConversationFolder } from '../src/pure/conversation.ts'
import type { SessionEventLike } from '../src/pure/conversation.ts'
import { hasAssistantReplyContent, isSubagentDelegationTool, TurnProcessFold, turnProcessPresentation } from '../src/pure/turnProcess.ts'

let seq = 0
function ev(type: string, data: unknown): SessionEventLike {
  seq += 1
  return { type, seq, time: 1_700_000_000_000 + seq, data }
}

function chunk(turn: number, step: number, c: unknown): SessionEventLike {
  return ev('assistant/chunk', { turn, step, chunk: c })
}

test('isSubagentDelegationTool：subagent 与 subagent_* 前缀', () => {
  assert.equal(isSubagentDelegationTool('subagent'), true)
  assert.equal(isSubagentDelegationTool('subagent_explore'), true)
  assert.equal(isSubagentDelegationTool('bash'), false)
  assert.equal(isSubagentDelegationTool(undefined), false)
})

test('hasAssistantReplyContent：文本非空算回复，推理与工具调用不算', () => {
  assert.equal(hasAssistantReplyContent([{ type: 'text', text: '答案' }]), true)
  assert.equal(hasAssistantReplyContent([{ type: 'text', text: '   ' }]), false)
  assert.equal(hasAssistantReplyContent([{ type: 'reasoning', text: '想一下' }]), false)
  assert.equal(hasAssistantReplyContent([{ type: 'tool', text: '' }]), false)
  assert.equal(hasAssistantReplyContent([]), false)
})

test('controlAnchorSeq 取第一条可见证据；空 delta 与 tool-call 块不算证据', () => {
  const fold = new TurnProcessFold(1)
  fold.fold(chunk(1, 0, { type: 'block-start', index: 0, blockType: 'text' }))
  fold.fold(chunk(1, 0, { type: 'text-delta', index: 0, text: '   ' }))
  fold.fold(chunk(1, 0, { type: 'block-start', index: 1, blockType: 'tool-call' }))
  assert.equal(fold.controlAnchorSeq, undefined, '文本块 start / 空白 delta / tool-call 块都不是证据')
  assert.equal(fold.assistantStartByStep.size, 0)

  const delta = chunk(1, 0, { type: 'text-delta', index: 0, text: '正文' })
  fold.fold(delta)
  assert.equal(fold.controlAnchorSeq, delta.seq)
  assert.equal(fold.assistantStartByStep.get(0), delta.seq)
  // 同一步的第二条证据不再改锚（官方 has() 命中就原样返回）。
  fold.fold(chunk(1, 0, { type: 'text-delta', index: 0, text: '更多' }))
  assert.equal(fold.controlAnchorSeq, delta.seq)
})

test('tool/call 计入工具数（subagent 单列），tool/result 与 llm/retry 只进过程锚', () => {
  const fold = new TurnProcessFold(2)
  fold.fold(ev('tool/call', { turn: 2, step: 0, callId: 'c1', name: 'read' }))
  fold.fold(ev('tool/call', { turn: 2, step: 0, callId: 'c2', name: 'subagent' }))
  fold.fold(ev('tool/call', { turn: 2, step: 0, callId: 'c3', name: 'subagent_pm' }))
  assert.equal(fold.toolCallCount, 1)
  assert.equal(fold.subagentCount, 2)
  assert.equal(typeof fold.otherStartSeq, 'number', '首个 tool/call 即 otherStartSeq')

  const spec = fold.spec(0, null)
  assert.equal(spec?.answerAnchorSeq, null)
  assert.equal(spec?.answerStep, null)
  assert.equal(spec?.toolCallCount, 1)
  assert.equal(spec?.subagentCount, 2)
})

test('spec：答案步之前的消息计入 messageCount，答案步本身的推理决定 inlineReasoning', () => {
  const fold = new TurnProcessFold(3)
  const feed = (event: SessionEventLike): void => fold.fold(event)
  feed(chunk(3, 0, { type: 'text-delta', index: 0, text: '先看' }))
  feed(ev('assistant/message', { turn: 3, step: 0, message: { id: 'm0', content: [{ type: 'text', text: '看完了' }] } }))
  feed(chunk(3, 1, { type: 'text-delta', index: 0, text: '再改' }))
  const answerEv = ev('assistant/message', { turn: 3, step: 1, message: { id: 'm1', content: [{ type: 'text', text: '改完了' }] } })
  feed(answerEv)

  const spec = fold.spec(10, { step: 1, seq: answerEv.seq, inlineReasoning: true })
  assert.equal(spec?.answerStep, 1)
  assert.equal(spec?.answerAnchorSeq, answerEv.seq, '答案锚 = 该步 assistant/message 的 seq（官方 finalNode.seq）')
  assert.equal(spec?.inlineReasoning, true)
  assert.equal(spec?.messageCount, 1, '有答案步时只数答案步之前的消息')
  assert.equal(spec?.processStartSeq, 10, 'turn/start 在窗口内就用它')
})

test('spec：turn/start 不在窗口内时过程起点退化到最早的外部过程/助手证据', () => {
  const fold = new TurnProcessFold(4)
  const call = ev('tool/call', { turn: 4, step: 0, callId: 'c', name: 'read' })
  fold.fold(call)
  const answerEv = ev('assistant/message', { turn: 4, step: 1, message: { id: 'm1', content: [{ type: 'text', text: '答案' }] } })
  fold.fold(answerEv)
  const spec = fold.spec(undefined, { step: 1, seq: answerEv.seq, inlineReasoning: false })
  assert.equal(spec?.processStartSeq, call.seq, '退到 otherStartSeq')
  assert.equal(spec?.answerAnchorSeq, answerEv.seq)
})

test('presentation：首条人类输入当折叠行锚，答案步不算外部过程', () => {
  const spec = {
    controlAnchorSeq: 5,
    processStartSeq: 1,
    answerAnchorSeq: 30,
    answerStep: 2,
    inlineReasoning: false,
    messageCount: 1,
    toolCallCount: 2,
    subagentCount: 0,
  }
  const view = turnProcessPresentation(7, spec, [
    { kind: 'user', anchorSeq: 2 },
    { kind: 'assistant', anchorSeq: 5, step: 0 },
    { kind: 'assistant', anchorSeq: 12, step: 1 },
    { kind: 'assistant', anchorSeq: 30, step: 2 },
  ])
  assert.equal(view?.afterSeq, 2, '折叠行排在首条人类输入之后')
  assert.equal(view?.anchorSeq, 2)
  assert.equal(view?.hasExternalProcess, true)
  assert.equal(view?.compactAnswer, true)
})

test('presentation：过程窗里的插话让 compactAnswer 变 false', () => {
  const spec = {
    controlAnchorSeq: 5,
    processStartSeq: 1,
    answerAnchorSeq: 30,
    answerStep: 1,
    inlineReasoning: false,
    messageCount: 0,
    toolCallCount: 1,
    subagentCount: 0,
  }
  const view = turnProcessPresentation(8, spec, [
    { kind: 'user', anchorSeq: 2 },
    { kind: 'assistant', anchorSeq: 5, step: 0 },
    { kind: 'steering', anchorSeq: 9 },
    { kind: 'assistant', anchorSeq: 30, step: 1 },
  ])
  assert.equal(view?.compactAnswer, false)
})

test('presentation：只有答案步时没有外部过程（不折）', () => {
  const spec = {
    controlAnchorSeq: 5,
    processStartSeq: 1,
    answerAnchorSeq: 30,
    answerStep: 0,
    inlineReasoning: true,
    messageCount: 0,
    toolCallCount: 0,
    subagentCount: 0,
  }
  const view = turnProcessPresentation(9, spec, [
    { kind: 'user', anchorSeq: 2 },
    { kind: 'assistant', anchorSeq: 30, step: 0 },
  ])
  assert.equal(view?.hasExternalProcess, false)
})

test('presentation：没有答案步就整项不出（answerAnchorSeq null）', () => {
  const view = turnProcessPresentation(
    10,
    { controlAnchorSeq: 5, processStartSeq: 5, answerAnchorSeq: null, answerStep: null, inlineReasoning: false, messageCount: 0, toolCallCount: 3, subagentCount: 0 },
    [{ kind: 'user', anchorSeq: 2 }],
  )
  assert.equal(view, null)
})

test('ConversationFolder：多步回合折出过程规格（计数/答案步/过程窗）', () => {
  const f = new ConversationFolder()
  f.applyEvent(ev('turn/start', { turn: 5 }))
  f.applyEvent(ev('user/message', { id: 'u5', role: 'user', content: [{ type: 'text', text: '帮我改一下' }], source: { kind: 'user' } }))
  for (let step = 0; step < 2; step++) {
    f.applyEvent(ev('step/start', { turn: 5, step }))
    f.applyEvent(chunk(5, step, { type: 'text-delta', index: 0, text: `第 ${step} 步` }))
    f.applyEvent(ev('tool/call', { turn: 5, step, callId: `c${step}`, name: 'read' }))
    f.applyEvent(
      ev('tool/result', {
        turn: 5,
        step,
        message: { id: `tr${step}`, role: 'user', content: [{ type: 'tool-result', toolCallId: `c${step}`, content: [{ type: 'text', text: 'ok' }] }], source: { kind: 'tool' } },
      }),
    )
    f.applyEvent(ev('assistant/message', { turn: 5, step, message: { id: `am${step}`, content: [{ type: 'text', text: `第 ${step} 步说明` }] } }))
    f.applyEvent(ev('step/end', { turn: 5, step }))
  }
  f.applyEvent(ev('step/start', { turn: 5, step: 2 }))
  f.applyEvent(chunk(5, 2, { type: 'text-delta', index: 0, text: '改好了' }))
  f.applyEvent(ev('assistant/message', { turn: 5, step: 2, message: { id: 'am2', content: [{ type: 'text', text: '改好了' }] } }))
  f.applyEvent(ev('step/end', { turn: 5, step: 2 }))
  f.applyEvent(ev('turn/end', { turn: 5, reason: { kind: 'completed' } }))

  const [view] = f.turnProcessViews()
  assert.equal(view.turn, 5)
  assert.equal(view.answerStep, 2)
  assert.equal(view.toolCallCount, 2)
  assert.equal(view.messageCount, 2, '答案步之前的 assistant/message 计数')
  assert.equal(view.hasExternalProcess, true)
  assert.equal(view.afterSeq, view.anchorSeq, '折叠行锚 = 首条人类输入')
  const opening = f.messages().find((m) => m.kind === 'user')
  assert.equal(view.afterSeq, (opening as { seq: number }).seq)
})

test('ConversationFolder：一问一答的回合不出可折规格（hasExternalProcess=false）', () => {
  const f = new ConversationFolder()
  f.applyEvent(ev('turn/start', { turn: 1 }))
  f.applyEvent(ev('user/message', { id: 'u1', role: 'user', content: [{ type: 'text', text: '你好' }], source: { kind: 'user' } }))
  f.applyEvent(ev('step/start', { turn: 1, step: 0 }))
  f.applyEvent(chunk(1, 0, { type: 'text-delta', index: 0, text: '你好呀' }))
  f.applyEvent(ev('assistant/message', { turn: 1, step: 0, message: { id: 'am', content: [{ type: 'text', text: '你好呀' }] } }))
  f.applyEvent(ev('step/end', { turn: 1, step: 0 }))
  f.applyEvent(ev('turn/end', { turn: 1, reason: { kind: 'completed' } }))

  const [view] = f.turnProcessViews()
  assert.equal(view.hasExternalProcess, false)
  assert.equal(view.inlineReasoning, false)
  assert.equal(view.toolCallCount, 0)
})

test('ConversationFolder：没有答案步（工具跑完就中断）时整项不出', () => {
  const f = new ConversationFolder()
  f.applyEvent(ev('turn/start', { turn: 3 }))
  f.applyEvent(ev('user/message', { id: 'u3', role: 'user', content: [{ type: 'text', text: '跑一下' }], source: { kind: 'user' } }))
  f.applyEvent(ev('step/start', { turn: 3, step: 0 }))
  f.applyEvent(ev('tool/call', { turn: 3, step: 0, callId: 'c0', name: 'bash' }))
  f.applyEvent(ev('turn/end', { turn: 3, reason: { kind: 'aborted' } }))

  assert.deepEqual(f.turnProcessViews(), [])
})
