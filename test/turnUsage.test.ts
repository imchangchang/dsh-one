import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TurnUsageFold } from '../src/pure/turnUsage.ts'
import { ConversationFolder, navigateAnchorOf } from '../src/pure/conversation.ts'
import type { SessionEventLike, StreamChunkData } from '../src/pure/conversation.ts'
import type { ChatAssistantMessage, ChatMessage } from '../src/pure/chatContract.ts'

let seq = 0

/** Build a SessionEvent-shaped fixture with a fresh seq. */
function ev(type: string, data: unknown): SessionEventLike {
  seq += 1
  return { type, seq, time: 1_700_000_000_000 + seq, data }
}

function chunkEv(turn: number, step: number, chunk: StreamChunkData): SessionEventLike {
  return ev('assistant/chunk', { turn, step, chunk })
}

/** Fold a list of events through a fresh fold; returns the result. */
function foldAll(events: Array<[string, unknown]>): ReturnType<TurnUsageFold['result']> {
  const fold = new TurnUsageFold()
  for (const [type, data] of events) fold.fold(ev(type, data))
  return fold.result()
}

/** One fully-proven usage sample (all buckets + total). */
const FULL_USAGE = {
  inputTokens: 100,
  outputTokens: 50,
  totalTokens: 200,
  cacheReadTokens: 40,
  cacheWriteTokens: 10,
  reasoningTokens: 20,
}
const FULL_ROUTE = { provider: 'deepseek', model: 'deepseek-v3.2' }

test('usage fold: 单次尝试完整生命周期给出精确聚合与路由', () => {
  const result = foldAll([
    ['turn/start', { turn: 1 }],
    ['step/start', { turn: 1, step: 1 }],
    ['assistant/message', { turn: 1, step: 1, message: { id: 'm1', source: { kind: 'model', ...FULL_ROUTE } }, usage: FULL_USAGE }],
    ['step/end', { turn: 1, step: 1 }],
    ['turn/end', { turn: 1, reason: { kind: 'stop' } }],
  ])
  assert.deepEqual(result, {
    uncachedInputTokens: 100,
    outputTokens: 50,
    totalTokens: 200,
    cacheReadTokens: 40,
    cacheWriteTokens: 10,
    reasoningTokens: 20,
    routes: [{ provider: 'deepseek', model: 'deepseek-v3.2' }],
  })
})

test('usage fold: 流式 usage 块被 assistant/message 样本替换（同一次尝试只计一份）', () => {
  const result = foldAll([
    ['turn/start', { turn: 1 }],
    ['step/start', { turn: 1, step: 1 }],
    ['assistant/chunk', { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 90, outputTokens: 40 } } }],
    ['assistant/message', { turn: 1, step: 1, message: { source: FULL_ROUTE }, usage: FULL_USAGE }],
    ['step/end', { turn: 1, step: 1 }],
    ['turn/end', { turn: 1, reason: { kind: 'stop' } }],
  ])
  assert.equal(result?.totalTokens, 200)
  assert.equal(result?.uncachedInputTokens, 100)
})

test('usage fold: 无 totalTokens 时需两个缓存桶都已知才能推导总量', () => {
  const result = foldAll([
    ['turn/start', { turn: 1 }],
    ['step/start', { turn: 1, step: 1 }],
    ['assistant/message', {
      turn: 1,
      step: 1,
      message: { source: FULL_ROUTE },
      usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 40, cacheWriteTokens: 10 },
    }],
    ['step/end', { turn: 1, step: 1 }],
    ['turn/end', { turn: 1 }],
  ])
  assert.deepEqual(result, {
    uncachedInputTokens: 100,
    outputTokens: 50,
    totalTokens: 200,
    cacheReadTokens: 40,
    cacheWriteTokens: 10,
    routes: [FULL_ROUTE],
  })
})

test('usage fold: 同一步重试贡献两次计费尝试（llm/retry-started 重开）', () => {
  // 真实日志顺序：首次尝试流式 usage 后被 finish(error) 关闭 → llm/retry →
  // llm/retry-started 重开同一步（不再有 step/start）→ 第二次尝试成功。
  const result = foldAll([
    ['turn/start', { turn: 1 }],
    ['step/start', { turn: 1, step: 1 }],
    ['assistant/chunk', { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } } }],
    ['assistant/chunk', { turn: 1, step: 1, chunk: { type: 'finish', reason: { kind: 'error' } } }],
    ['llm/retry', { turn: 1, step: 1, retryId: 'r1', retry: 1, mode: 'normal', delayMs: 100, failure: { message: 'timeout' } }],
    ['llm/retry-started', { turn: 1, step: 1, retryId: 'r1', retry: 1 }],
    ['assistant/message', {
      turn: 1,
      step: 1,
      message: { source: FULL_ROUTE },
      usage: { inputTokens: 80, outputTokens: 30, totalTokens: 110 },
    }],
    ['step/end', { turn: 1, step: 1 }],
    ['turn/end', { turn: 1 }],
  ])
  assert.deepEqual(result, {
    uncachedInputTokens: 180,
    outputTokens: 80,
    totalTokens: 260,
    // 首次尝试经 finish(error) 关闭，无 assistant/message 可归属路由——routes 整项缺省。
  })
  assert.equal(result?.routes, undefined)
})

test('usage fold: 缺 turn/start（窗口从 turn 中间开始）不可证明', () => {
  const result = foldAll([
    ['step/start', { turn: 1, step: 1 }],
    ['assistant/message', { turn: 1, step: 1, message: { source: FULL_ROUTE }, usage: FULL_USAGE }],
    ['step/end', { turn: 1, step: 1 }],
    ['turn/end', { turn: 1 }],
  ])
  assert.equal(result, undefined)
})

test('usage fold: 缺 turn/end 或缺尝试关闭边界不可证明', () => {
  const missingEnd = foldAll([
    ['turn/start', { turn: 1 }],
    ['step/start', { turn: 1, step: 1 }],
    ['assistant/message', { turn: 1, step: 1, message: { source: FULL_ROUTE }, usage: FULL_USAGE }],
  ])
  assert.equal(missingEnd, undefined)
  const openAttempt = foldAll([
    ['turn/start', { turn: 1 }],
    ['step/start', { turn: 1, step: 1 }],
    ['assistant/chunk', { turn: 1, step: 1, chunk: { type: 'usage', usage: FULL_USAGE } }],
    ['turn/end', { turn: 1 }],
  ])
  assert.equal(openAttempt, undefined)
})

test('usage fold: 计数不安全（缺 inputTokens / 非整数）整项缺省', () => {
  const noInput = foldAll([
    ['turn/start', { turn: 1 }],
    ['step/start', { turn: 1, step: 1 }],
    // mock 场景常见形状：只有 outputTokens——不可证明，缺省。
    ['assistant/message', { turn: 1, step: 1, message: { source: FULL_ROUTE }, usage: { outputTokens: 320 } }],
    ['step/end', { turn: 1, step: 1 }],
    ['turn/end', { turn: 1 }],
  ])
  assert.equal(noInput, undefined)
  const fraction = foldAll([
    ['turn/start', { turn: 1 }],
    ['step/start', { turn: 1, step: 1 }],
    ['assistant/message', { turn: 1, step: 1, message: { source: FULL_ROUTE }, usage: { inputTokens: 1.5, outputTokens: 50, totalTokens: 200 } }],
    ['step/end', { turn: 1, step: 1 }],
    ['turn/end', { turn: 1 }],
  ])
  assert.equal(fraction, undefined)
})

test('usage fold: 总量矛盾（totalTokens 与缓存桶对不上）不可证明', () => {
  const result = foldAll([
    ['turn/start', { turn: 1 }],
    ['step/start', { turn: 1, step: 1 }],
    ['assistant/message', {
      turn: 1,
      step: 1,
      message: { source: FULL_ROUTE },
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 300, cacheReadTokens: 40, cacheWriteTokens: 10 },
    }],
    ['step/end', { turn: 1, step: 1 }],
    ['turn/end', { turn: 1 }],
  ])
  assert.equal(result, undefined)
})

test('usage fold: reasoningTokens 超出 output 不可证明', () => {
  const result = foldAll([
    ['turn/start', { turn: 1 }],
    ['step/start', { turn: 1, step: 1 }],
    ['assistant/message', {
      turn: 1,
      step: 1,
      message: { source: FULL_ROUTE },
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 200, reasoningTokens: 51 },
    }],
    ['step/end', { turn: 1, step: 1 }],
    ['turn/end', { turn: 1 }],
  ])
  assert.equal(result, undefined)
})

test('usage fold: 缓存桶/推理桶只在每次尝试都上报时出现；路由只在每次尝试都可归属时出现', () => {
  const partial = foldAll([
    ['turn/start', { turn: 1 }],
    ['step/start', { turn: 1, step: 1 }],
    // 没带 source：该尝试无路由，但计数仍有效。
    ['assistant/message', { turn: 1, step: 1, message: {}, usage: FULL_USAGE }],
    ['step/end', { turn: 1, step: 1 }],
    ['turn/end', { turn: 1 }],
  ])
  assert.equal(partial?.totalTokens, 200)
  assert.equal(partial?.cacheReadTokens, 40)
  assert.equal(partial?.routes, undefined)
  const bucketGap = foldAll([
    ['turn/start', { turn: 1 }],
    ['step/start', { turn: 1, step: 1 }],
    ['assistant/chunk', { turn: 1, step: 1, chunk: { type: 'usage', usage: FULL_USAGE } }],
    ['assistant/chunk', { turn: 1, step: 1, chunk: { type: 'finish', reason: { kind: 'error' } } }],
    // 第二次尝试没报缓存桶：聚合桶丢失，但总量仍在。
    ['llm/retry', { turn: 1, step: 1, retryId: 'r2', retry: 1, failure: { message: 'x' } }],
    ['llm/retry-started', { turn: 1, step: 1, retryId: 'r2', retry: 1 }],
    ['assistant/message', { turn: 1, step: 1, message: { source: FULL_ROUTE }, usage: { inputTokens: 60, outputTokens: 20, totalTokens: 80 } }],
    ['step/end', { turn: 1, step: 1 }],
    ['turn/end', { turn: 1 }],
  ])
  assert.equal(bucketGap?.totalTokens, 280)
  assert.equal(bucketGap?.cacheReadTokens, undefined)
  assert.equal(bucketGap?.reasoningTokens, undefined)
})

test('usage fold: 无任何计费尝试不可证明', () => {
  const result = foldAll([
    ['turn/start', { turn: 1 }],
    ['turn/end', { turn: 1 }],
  ])
  assert.equal(result, undefined)
})

test('usage fold: finish(error) 关闭尝试，随后 llm/retry 重开', () => {
  const result = foldAll([
    ['turn/start', { turn: 1 }],
    ['step/start', { turn: 1, step: 1 }],
    ['assistant/chunk', { turn: 1, step: 1, chunk: { type: 'usage', usage: FULL_USAGE } }],
    ['assistant/chunk', { turn: 1, step: 1, chunk: { type: 'finish', reason: { kind: 'error', error: { message: 'boom' } } } }],
    ['llm/retry', { turn: 1, step: 1, retryId: 'r1', retry: 1 }],
    ['llm/retry-started', { turn: 1, step: 1, retryId: 'r1', retry: 1 }],
    ['assistant/message', { turn: 1, step: 1, message: { source: FULL_ROUTE }, usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } }],
    ['step/end', { turn: 1, step: 1 }],
    ['turn/end', { turn: 1 }],
  ])
  assert.equal(result?.totalTokens, 260)
  assert.equal(result?.uncachedInputTokens, 150)
})

// ---- ConversationFolder 集成：窗口边界门控 ----

/** Build one closed-turn event list in dsh 0.1.2 order (turn/start before the prompt). */
function completeTurnEvents(turn: number, usage: unknown): SessionEventLike[] {
  return [
    ev('turn/start', { turn }),
    ev('user/message', { id: `user-${turn}`, content: [{ type: 'text', text: 'hello' }] }),
    ev('step/start', { turn, step: 1 }),
    ev('assistant/chunk', { turn, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'text' } }),
    ev('assistant/chunk', { turn, step: 1, chunk: { type: 'text-delta', index: 0, text: 'ok' } }),
    ev('assistant/message', {
      turn,
      step: 1,
      message: { id: `msg-${turn}`, content: [{ type: 'text', text: 'ok' }], source: { kind: 'model', provider: 'deepseek', model: 'm' } },
      usage,
    }),
    ev('step/end', { turn, step: 1 }),
    ev('turn/end', { turn, reason: { kind: 'stop' } }),
  ]
}

function assistantOf(msgs: ReturnType<ConversationFolder['messages']>): ChatAssistantMessage {
  const m = msgs.find((x) => x.kind === 'assistant')
  assert.ok(m && m.kind === 'assistant')
  return m
}

test('folder: turn/start 在窗口内 → 用量挂到 turnEnd 消息', () => {
  const folder = new ConversationFolder()
  for (const event of completeTurnEvents(1, FULL_USAGE)) folder.applyEvent(event)
  const msg = assistantOf(folder.messages())
  assert.equal(msg.turnEnd, true)
  assert.equal(msg.usage?.totalTokens, 200)
  assert.deepEqual(msg.usage?.routes, [{ provider: 'deepseek', model: 'm' }])
})

test('folder: turn/start 在窗口外（缺边界）→ 整项缺省', () => {
  const folder = new ConversationFolder()
  // 窗口从 turn 中间开始：只有 step/start 及之后的事件。
  for (const event of completeTurnEvents(1, FULL_USAGE).slice(2)) folder.applyEvent(event)
  const msg = assistantOf(folder.messages())
  assert.equal(msg.turnEnd, true)
  assert.equal(msg.usage, undefined)
})

test('folder: 样本不可证明（只有 outputTokens）→ 不渲染药丸的取值（usage 缺省）', () => {
  const folder = new ConversationFolder()
  for (const event of completeTurnEvents(1, { outputTokens: 320 })) folder.applyEvent(event)
  assert.equal(assistantOf(folder.messages()).usage, undefined)
})

// ---- 回合跳转定位锚（navigateAnchorOf） ----

test('navigateAnchor: 目标在窗口内 → 返回第一条 seq ≥ 目标的消息 id', () => {
  const msgs: ChatMessage[] = [
    { kind: 'user', id: 'u-1', text: 'a', seq: 100 },
    { kind: 'assistant', id: 'a-1', blocks: [], complete: true, seq: 120 },
    { kind: 'user', id: 'u-2', text: 'b', seq: 200 },
    { kind: 'assistant', id: 'a-2', blocks: [], complete: true, seq: 220 },
  ]
  assert.equal(navigateAnchorOf(msgs, 150), 'u-2')
  assert.equal(navigateAnchorOf(msgs, 100), 'u-1')
  assert.equal(navigateAnchorOf(msgs, 220), 'a-2')
  assert.equal(navigateAnchorOf(msgs, 221), null)
})

test('navigateAnchor: 目标在窗口首之前 → 返回窗口第一条消息（窗口头在回合中间）', () => {
  const msgs: ChatMessage[] = [
    { kind: 'assistant', id: 'a-tail', blocks: [], complete: true, seq: 130 },
    { kind: 'user', id: 'u-2', text: 'b', seq: 200 },
  ]
  assert.equal(navigateAnchorOf(msgs, 100), 'a-tail')
})

test('navigateAnchor: 无消息 / 目标超出所有消息 → null', () => {
  assert.equal(navigateAnchorOf([], 100), null)
  const msgs: ChatMessage[] = [{ kind: 'user', id: 'u-1', text: 'a', seq: 100 }]
  assert.equal(navigateAnchorOf(msgs, 101), null)
})
