import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ConversationFolder, applyFeedbackRatings } from '../src/pure/conversation.ts'
import type { HistoryEntryLike, SessionEventLike, StreamChunkData, ToolEventViewLike } from '../src/pure/conversation.ts'
import type { ChatAssistantMessage, ChatToolBlock } from '../src/pure/chatContract.ts'

let seq = 0

/** Build a SessionEvent-shaped fixture with a fresh seq. */
function ev(type: string, data: unknown): SessionEventLike {
  seq += 1
  return { type, seq, time: 1_700_000_000_000 + seq, data }
}

function chunkEv(turn: number, step: number, chunk: StreamChunkData): SessionEventLike {
  return ev('assistant/chunk', { turn, step, chunk })
}

function userEv(id: string, text: string): SessionEventLike {
  return ev('user/message', {
    id,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })
}

function toolCallEv(callId: string, name: string, args: string): SessionEventLike {
  return ev('tool/call', { turn: 1, step: 1, callId, name, arguments: args })
}

function toolResultEv(callId: string, text: string, isError = false): SessionEventLike {
  return ev('tool/result', {
    turn: 1,
    step: 1,
    message: {
      id: `tr-${callId}`,
      role: 'user',
      content: [{ type: 'tool-result', toolCallId: callId, content: [{ type: 'text', text }], isError }],
      source: { kind: 'tool', callId },
    },
  })
}

function lastAssistant(folder: ConversationFolder): ChatAssistantMessage {
  const msg = folder.messages().at(-1)
  assert.equal(msg?.kind, 'assistant')
  return msg as ChatAssistantMessage
}

test('text deltas across chunks append into one block', () => {
  const f = new ConversationFolder()
  f.applyEvent(ev('turn/start', { turn: 1 }))
  f.applyEvent(userEv('u1', 'hi'))
  f.applyEvent(chunkEv(1, 1, { type: 'block-start', index: 0, blockType: 'text' }))
  f.applyEvent(chunkEv(1, 1, { type: 'text-delta', index: 0, text: 'Hello, ' }))
  f.applyEvent(chunkEv(1, 1, { type: 'text-delta', index: 0, text: 'world' }))
  f.applyEvent(chunkEv(1, 1, { type: 'block-end', index: 0, block: { type: 'text', text: 'Hello, world' } }))

  const msg = lastAssistant(f)
  assert.deepEqual(msg.blocks, [{ type: 'text', text: 'Hello, world' }])
  assert.equal(msg.complete, false)
  assert.equal(f.hasOpenTurn(), true)
})

test('reasoning and text stream as separate blocks', () => {
  const f = new ConversationFolder()
  f.applyEvent(ev('turn/start', { turn: 1 }))
  f.applyEvent(chunkEv(1, 1, { type: 'block-start', index: 0, blockType: 'reasoning' }))
  f.applyEvent(chunkEv(1, 1, { type: 'reasoning-delta', index: 0, text: 'think' }))
  f.applyEvent(chunkEv(1, 1, { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'think' } }))
  f.applyEvent(chunkEv(1, 1, { type: 'block-start', index: 1, blockType: 'text' }))
  f.applyEvent(chunkEv(1, 1, { type: 'text-delta', index: 1, text: 'answer' }))
  f.applyEvent(chunkEv(1, 1, { type: 'block-end', index: 1, block: { type: 'text', text: 'answer' } }))

  assert.deepEqual(lastAssistant(f).blocks, [
    { type: 'reasoning', text: 'think' },
    { type: 'text', text: 'answer' },
  ])
})

test('interleaved block indexes fold into their own blocks', () => {
  const f = new ConversationFolder()
  f.applyEvent(ev('turn/start', { turn: 1 }))
  f.applyEvent(chunkEv(1, 1, { type: 'block-start', index: 0, blockType: 'text' }))
  f.applyEvent(chunkEv(1, 1, { type: 'block-start', index: 1, blockType: 'reasoning' }))
  f.applyEvent(chunkEv(1, 1, { type: 'text-delta', index: 0, text: 'a' }))
  f.applyEvent(chunkEv(1, 1, { type: 'reasoning-delta', index: 1, text: 'r1' }))
  f.applyEvent(chunkEv(1, 1, { type: 'text-delta', index: 0, text: 'b' }))
  f.applyEvent(chunkEv(1, 1, { type: 'reasoning-delta', index: 1, text: 'r2' }))

  assert.deepEqual(lastAssistant(f).blocks, [
    { type: 'text', text: 'ab' },
    { type: 'reasoning', text: 'r1r2' },
  ])
})

test('block-end reconciles divergent assembled text', () => {
  const f = new ConversationFolder()
  f.applyEvent(ev('turn/start', { turn: 1 }))
  f.applyEvent(chunkEv(1, 1, { type: 'block-start', index: 0, blockType: 'text' }))
  f.applyEvent(chunkEv(1, 1, { type: 'text-delta', index: 0, text: 'partial' }))
  f.applyEvent(chunkEv(1, 1, { type: 'block-end', index: 0, block: { type: 'text', text: 'full text' } }))

  assert.deepEqual(lastAssistant(f).blocks, [{ type: 'text', text: 'full text' }])
})

test('tool call/result pair through running, done and error', () => {
  const f = new ConversationFolder()
  f.applyEvent(ev('turn/start', { turn: 1 }))
  f.applyEvent(toolCallEv('c1', 'bash', '{"command":"ls"}'))
  f.applyEvent(toolCallEv('c2', 'read', '{"path":"a.ts"}'))

  let blocks = lastAssistant(f).blocks as ChatToolBlock[]
  assert.deepEqual(
    blocks.map((b) => [b.callId, b.status, b.title]),
    [
      ['c1', 'running', 'bash'],
      ['c2', 'running', 'read'],
    ],
  )

  f.applyEvent(toolResultEv('c1', 'file1\nfile2'))
  f.applyEvent(toolResultEv('c2', 'boom', true))

  blocks = lastAssistant(f).blocks as ChatToolBlock[]
  assert.equal(blocks[0].status, 'done')
  assert.equal(blocks[0].output, 'file1\nfile2')
  assert.equal(blocks[1].status, 'error')
  assert.equal(blocks[1].output, 'boom')
})

test('tool/call folds raw arguments onto the block for IN display', () => {
  const f = new ConversationFolder()
  f.applyEvent(ev('turn/start', { turn: 1 }))
  f.applyEvent(toolCallEv('c1', 'bash', '{"command":"ls -la","cwd":"/tmp"}'))
  f.applyEvent(toolCallEv('c2', 'read', ''))

  const blocks = lastAssistant(f).blocks as ChatToolBlock[]
  assert.equal(blocks[0].args, '{"command":"ls -la","cwd":"/tmp"}')
  // 空 arguments 原样保留（webview 侧据此决定不渲染 IN 卡片）。
  assert.equal(blocks[1].args, '')
})

test('tool result with an error field marks the card error', () => {
  const f = new ConversationFolder()
  f.applyEvent(ev('turn/start', { turn: 1 }))
  f.applyEvent(toolCallEv('c1', 'bash', '{}'))
  const result = toolResultEv('c1', 'denied')
  const data = result.data as { error?: unknown }
  data.error = { name: 'ApprovalDenied', code: 'denied' }
  f.applyEvent(result)

  assert.equal((lastAssistant(f).blocks[0] as ChatToolBlock).status, 'error')
})

test('diff cards extract old/new text from call and result views', () => {
  const f = new ConversationFolder()
  const callView: ToolEventViewLike = {
    for: 'call',
    view: {
      card: 'diff',
      title: 'Edit src/a.ts',
      diffs: [{ path: 'src/a.ts', oldText: 'old', newText: 'new' }],
    },
  }
  f.applyEvent(ev('turn/start', { turn: 1 }))
  f.applyEvent(toolCallEv('c1', 'edit', '{}'), callView)

  let block = lastAssistant(f).blocks[0] as ChatToolBlock
  assert.equal(block.title, 'Edit src/a.ts')
  assert.deepEqual(block.diff, { oldText: 'old', newText: 'new' })

  const resultView: ToolEventViewLike = {
    for: 'result',
    view: {
      card: 'diff',
      title: 'Edited src/a.ts',
      diffs: [{ path: 'src/a.ts', oldText: null, newText: 'applied' }],
    },
  }
  f.applyEvent(toolResultEv('c1', 'ok'), resultView)

  block = lastAssistant(f).blocks[0] as ChatToolBlock
  assert.equal(block.status, 'done')
  assert.equal(block.title, 'Edited src/a.ts')
  assert.deepEqual(block.diff, { oldText: '', newText: 'applied' })
})

test('terminal view maps command to title and output to the card', () => {
  const f = new ConversationFolder()
  f.applyEvent(ev('turn/start', { turn: 1 }))
  f.applyEvent(toolCallEv('c1', 'bash', '{}'), {
    for: 'call',
    view: { card: 'terminal', title: 'npm test', description: '跑测试', cwd: '/repo' },
  })
  f.applyEvent(toolResultEv('c1', 'raw model text'), {
    for: 'result',
    view: { card: 'terminal', output: 'all green', exitCode: 0 },
  })

  const block = lastAssistant(f).blocks[0] as ChatToolBlock
  assert.equal(block.title, 'npm test')
  assert.equal(block.detail, '跑测试')
  assert.equal(block.output, 'all green')
})

test('history baseline folds a complete turn, then live chunks extend it', () => {
  const f = new ConversationFolder()
  f.applyHistory([
    { event: ev('turn/start', { turn: 1 }) },
    { event: userEv('u1', 'question') },
    { event: chunkEv(1, 1, { type: 'block-start', index: 0, blockType: 'text' }) },
    { event: chunkEv(1, 1, { type: 'text-delta', index: 0, text: 'answer' }) },
    {
      event: ev('assistant/message', {
        turn: 1,
        step: 1,
        message: { id: 'a1', content: [{ type: 'text', text: 'answer' }] },
      }),
    },
    { event: ev('turn/end', { turn: 1, reason: { kind: 'completed' } }) },
  ])

  assert.equal(f.messages().length, 2)
  const first = f.messages()[1] as ChatAssistantMessage
  assert.deepEqual(first.blocks, [{ type: 'text', text: 'answer' }])
  assert.equal(first.complete, true)
  assert.equal(first.interrupted, undefined)
  assert.equal(f.hasOpenTurn(), false)

  // Live increment: a second turn streams into a new assistant message.
  f.applyEvent(ev('turn/start', { turn: 2 }))
  f.applyEvent(userEv('u2', 'follow-up'))
  f.applyEvent(chunkEv(2, 1, { type: 'block-start', index: 0, blockType: 'text' }))
  f.applyEvent(chunkEv(2, 1, { type: 'text-delta', index: 0, text: 'more' }))

  assert.equal(f.messages().length, 4)
  const live = lastAssistant(f)
  assert.deepEqual(live.blocks, [{ type: 'text', text: 'more' }])
  assert.equal(live.complete, false)
  assert.equal(f.hasOpenTurn(), true)
})

test('assistant/message folds content when no chunks were seen', () => {
  const f = new ConversationFolder()
  f.applyHistory([
    { event: ev('turn/start', { turn: 1 }) },
    {
      event: ev('assistant/message', {
        turn: 1,
        step: 1,
        message: {
          id: 'a1',
          content: [
            { type: 'reasoning', text: 'thought' },
            { type: 'text', text: 'visible' },
            { type: 'tool-call', id: 'c9', name: 'bash', arguments: '{}' },
          ],
        },
      }),
    },
    { event: ev('turn/end', { turn: 1, reason: { kind: 'completed' } }) },
  ])

  // tool-call content blocks stay invisible; tool/call events own the cards.
  assert.deepEqual(lastAssistant(f).blocks, [
    { type: 'reasoning', text: 'thought' },
    { type: 'text', text: 'visible' },
  ])
})

test('assistant/message with interrupted marks the message', () => {
  const f = new ConversationFolder()
  f.applyEvent(ev('turn/start', { turn: 1 }))
  f.applyEvent(chunkEv(1, 1, { type: 'block-start', index: 0, blockType: 'text' }))
  f.applyEvent(chunkEv(1, 1, { type: 'text-delta', index: 0, text: 'cut off' }))
  f.applyEvent(
    ev('assistant/message', {
      turn: 1,
      step: 1,
      message: { id: 'a1', content: [{ type: 'text', text: 'cut off' }] },
      interrupted: true,
    }),
  )
  f.applyEvent(ev('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } }))

  const msg = lastAssistant(f)
  assert.equal(msg.complete, true)
  assert.equal(msg.interrupted, true)
  assert.equal(f.hasOpenTurn(), false)
})

test('turn/end with an aborted reason marks an unfinished message interrupted', () => {
  const f = new ConversationFolder()
  f.applyEvent(ev('turn/start', { turn: 1 }))
  f.applyEvent(chunkEv(1, 1, { type: 'block-start', index: 0, blockType: 'text' }))
  f.applyEvent(chunkEv(1, 1, { type: 'text-delta', index: 0, text: 'partial' }))
  f.applyEvent(ev('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } }))

  const msg = lastAssistant(f)
  assert.equal(msg.complete, true)
  assert.equal(msg.interrupted, true)
})

test('turn/end with an aborted reason and no content yields an empty assistant message marked interrupted', () => {
  const f = new ConversationFolder()
  f.applyEvent(ev('turn/start', { turn: 1 }))
  f.applyEvent(userEv('u1', 'hi'))
  // 用户刚发完就取消：turn/end 到达时还没有任何 assistant 内容，
  // 标记不能丢——补一条空 assistant 消息承载「已中断」。
  f.applyEvent(ev('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } }))

  const msg = lastAssistant(f)
  assert.deepEqual(msg.blocks, [])
  assert.equal(msg.complete, true)
  assert.equal(msg.interrupted, true)
  assert.equal(msg.turnError, undefined)
  assert.equal(f.hasOpenTurn(), false)
})

test('turn/end with an error reason and no content yields an empty assistant message with turnError', () => {
  const f = new ConversationFolder()
  f.applyEvent(ev('turn/start', { turn: 1 }))
  f.applyEvent(userEv('u1', 'hi'))
  f.applyEvent(
    ev('turn/end', {
      turn: 1,
      reason: { kind: 'error', error: { code: 'AUTH', message: '401 unauthorized' } },
    }),
  )

  const msg = lastAssistant(f)
  assert.deepEqual(msg.blocks, [])
  assert.equal(msg.complete, true)
  assert.deepEqual(msg.turnError, { message: '401 unauthorized', code: 'AUTH' })
  assert.equal(msg.interrupted, undefined)
  assert.equal(f.hasOpenTurn(), false)
})

test('turn/end with an error reason keeps partial content and marks turnError, not interrupted', () => {
  const f = new ConversationFolder()
  f.applyEvent(ev('turn/start', { turn: 1 }))
  f.applyEvent(chunkEv(1, 1, { type: 'block-start', index: 0, blockType: 'text' }))
  f.applyEvent(chunkEv(1, 1, { type: 'text-delta', index: 0, text: 'partial' }))
  f.applyEvent(
    ev('turn/end', { turn: 1, reason: { kind: 'error', error: { message: 'context length exceeded' } } }),
  )

  const msg = lastAssistant(f)
  assert.deepEqual(msg.blocks, [{ type: 'text', text: 'partial' }])
  assert.equal(msg.complete, true)
  assert.deepEqual(msg.turnError, { message: 'context length exceeded' })
  assert.equal(msg.interrupted, undefined)
})

test('applyHistory resets state for a re-baseline', () => {
  const f = new ConversationFolder()
  f.applyEvent(ev('turn/start', { turn: 1 }))
  f.applyEvent(chunkEv(1, 1, { type: 'block-start', index: 0, blockType: 'text' }))
  f.applyEvent(chunkEv(1, 1, { type: 'text-delta', index: 0, text: 'stale' }))
  assert.equal(f.hasOpenTurn(), true)

  f.applyHistory([{ event: userEv('u1', 'only user text') }])
  assert.equal(f.messages().length, 1)
  assert.equal(f.hasOpenTurn(), false)
  assert.deepEqual(f.messages()[0], { kind: 'user', id: 'u1', text: 'only user text' })
})

test('user messages keep image content parts as attachment references', () => {
  const f = new ConversationFolder()
  f.applyEvent(
    ev('user/message', {
      id: 'u1',
      role: 'user',
      content: [
        { type: 'text', text: '这个图片你能看么？' },
        {
          type: 'image',
          attachment: {
            attachmentId: 'sha256:abc123',
            mediaType: 'image/png',
            name: 'pasted.png',
            width: 800,
            height: 600,
            bytes: 12345,
          },
        },
      ],
      source: { kind: 'user' },
    }),
  )

  const msg = f.messages()[0]
  assert.equal(msg.kind, 'user')
  if (msg.kind !== 'user') return
  assert.equal(msg.text, '这个图片你能看么？')
  assert.deepEqual(msg.images, [
    { attachmentId: 'sha256:abc123', mediaType: 'image/png', name: 'pasted.png', width: 800, height: 600 },
  ])

  // Text-only messages carry no images field.
  f.applyEvent(userEv('u2', 'plain'))
  const plain = f.messages()[1]
  assert.equal(plain.kind, 'user')
  if (plain.kind !== 'user') return
  assert.equal(plain.images, undefined)
})

test('attachment lines in user text fold into file chips', () => {
  const f = new ConversationFolder()
  f.applyEvent(
    ev('user/message', {
      id: 'u1',
      role: 'user',
      content: [
        {
          type: 'text',
          text: '这个文件能读吗？\n<attachment>/Users/a/手册.xlsx</attachment>\n<attachment>/tmp/dsh-one-attachments/1-note.txt</attachment>',
        },
      ],
      source: { kind: 'user' },
    }),
  )

  const msg = f.messages()[0]
  assert.equal(msg.kind, 'user')
  if (msg.kind !== 'user') return
  assert.equal(msg.text, '这个文件能读吗？')
  assert.deepEqual(msg.files, [
    { name: '手册.xlsx', path: '/Users/a/手册.xlsx' },
    { name: '1-note.txt', path: '/tmp/dsh-one-attachments/1-note.txt' },
  ])
})

test('tool output is kept in full (no folding-layer truncation)', () => {
  const f = new ConversationFolder()
  f.applyEvent(ev('turn/start', { turn: 1 }))
  f.applyEvent(toolCallEv('c1', 'bash', '{}'))
  const text = 'x'.repeat(5000)
  f.applyEvent(toolResultEv('c1', text))

  const block = lastAssistant(f).blocks[0] as ChatToolBlock
  assert.equal(block.status, 'done')
  assert.equal(block.output, text) // 全文保留，截断只发生在展示层
})

test('host-injected context user messages are flagged, human input is not', () => {
  const f = new ConversationFolder()
  f.applyEvent(userEv('u1', 'real question'))
  f.applyEvent(
    ev('user/message', {
      id: 'ctx1',
      role: 'user',
      content: [{ type: 'text', text: '<system-reminder>\nworkspace instructions…' }],
      source: { kind: 'agent-instructions', form: 'instructions' },
    }),
  )
  f.applyEvent(
    ev('user/message', {
      id: 'ctx2',
      role: 'user',
      content: [{ type: 'text', text: 'Current runtime context…' }],
      source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' },
    }),
  )

  const [human, instructions, snapshot] = f.messages()
  assert.deepEqual(human, { kind: 'user', id: 'u1', text: 'real question' })
  assert.deepEqual(instructions, {
    kind: 'user',
    id: 'ctx1',
    text: '<system-reminder>\nworkspace instructions…',
    context: 'agent-instructions',
  })
  assert.equal(snapshot.kind, 'user')
  assert.equal((snapshot as { context?: string }).context, 'plugin')
})

test('user message without source falls back to the system-reminder prefix', () => {
  const f = new ConversationFolder()
  f.applyEvent(ev('user/message', { id: 'l1', role: 'user', content: [{ type: 'text', text: '<system-reminder>\nold style' }] }))
  f.applyEvent(ev('user/message', { id: 'l2', role: 'user', content: [{ type: 'text', text: 'plain' }] }))

  const [legacy, plain] = f.messages() as Array<{ context?: string }>
  assert.equal(legacy.context, 'legacy-instructions')
  assert.equal(plain.context, undefined)
})

test('session-reference context attaches its references to the triggering user message', () => {
  const f = new ConversationFolder()
  f.applyEvent(userEv('u1', '@会话甲 这个看下'))
  f.applyEvent(
    ev('user/message', {
      id: 'ref1',
      role: 'user',
      content: [{ type: 'text', text: '## Referenced sessions\n…snapshot…' }],
      source: {
        kind: 'session-reference',
        form: 'recall',
        version: 1,
        references: [
          { sessionId: 'id-1', label: '会话甲', capturedThroughSeq: 5, inputIndex: 0 },
          { sessionId: 42 }, // 畸形条目被丢弃
        ],
      },
    }),
  )

  const [human, ctx] = f.messages()
  assert.deepEqual(human, {
    kind: 'user',
    id: 'u1',
    text: '@会话甲 这个看下',
    references: [{ sessionId: 'id-1', label: '会话甲' }],
  })
  assert.equal((ctx as { context?: string }).context, 'session-reference')
  assert.equal((ctx as { references?: unknown }).references, undefined)
})

test('session-reference context with no preceding plain user message attaches nowhere', () => {
  const f = new ConversationFolder()
  f.applyEvent(
    ev('user/message', {
      id: 'ctx1',
      role: 'user',
      content: [{ type: 'text', text: '<system-reminder>\nworkspace instructions…' }],
      source: { kind: 'agent-instructions', form: 'instructions' },
    }),
  )
  f.applyEvent(
    ev('user/message', {
      id: 'ref1',
      role: 'user',
      content: [{ type: 'text', text: '## Referenced sessions\n…' }],
      source: { kind: 'session-reference', references: [{ sessionId: 'id-1', label: '会话甲' }] },
    }),
  )

  const [instructions, ctx] = f.messages()
  assert.equal((instructions as { references?: unknown }).references, undefined)
  assert.equal((ctx as { references?: unknown }).references, undefined)
})

test('mid-turn injected user message finalizes the split assistant message', () => {
  const f = new ConversationFolder()
  f.applyEvent(ev('turn/start', { turn: 1 }))
  f.applyEvent(chunkEv(1, 1, { type: 'block-start', index: 0, blockType: 'text' }))
  f.applyEvent(chunkEv(1, 1, { type: 'text-delta', index: 0, text: '先跑命令' }))
  f.applyEvent(
    ev('assistant/message', {
      turn: 1,
      step: 1,
      message: { id: 'a1', content: [{ type: 'text', text: '先跑命令' }] },
    }),
  )
  f.applyEvent(toolCallEv('c1', 'bash', '{}'))
  f.applyEvent(toolResultEv('c1', '25'))
  // 子代理完成通知以 user/message 插在 turn 中间，把 turn 切成两条
  // assistant 消息；前一条到此为止，不能一直挂着流式光标。
  f.applyEvent(userEv('ctx1', 'Background subagent reported: done'))
  f.applyEvent(chunkEv(1, 2, { type: 'block-start', index: 0, blockType: 'text' }))
  f.applyEvent(chunkEv(1, 2, { type: 'text-delta', index: 0, text: '继续' }))

  const split = f.messages()[0] as ChatAssistantMessage
  assert.equal(split.kind, 'assistant')
  assert.equal(split.complete, true)
  assert.equal(lastAssistant(f).complete, false)
})

test('turn 中途注入 user/message 切断后，turnEnd 只落在本 turn 最后一条消息', () => {
  const f = new ConversationFolder()
  f.applyEvent(ev('turn/start', { turn: 1 }))
  f.applyEvent(chunkEv(1, 1, { type: 'block-start', index: 0, blockType: 'text' }))
  f.applyEvent(chunkEv(1, 1, { type: 'text-delta', index: 0, text: '先跑命令' }))
  f.applyEvent(
    ev('assistant/message', {
      turn: 1,
      step: 1,
      message: { id: 'a1', content: [{ type: 'text', text: '先跑命令' }] },
    }),
  )
  // 子代理完成通知插在 turn 中间，把 turn 切成两条 assistant 消息。
  f.applyEvent(userEv('ctx1', 'Background subagent reported: done'))
  f.applyEvent(chunkEv(1, 2, { type: 'block-start', index: 0, blockType: 'text' }))
  f.applyEvent(chunkEv(1, 2, { type: 'text-delta', index: 0, text: '继续' }))
  f.applyEvent(
    ev('assistant/message', {
      turn: 1,
      step: 2,
      message: { id: 'a2', content: [{ type: 'text', text: '继续' }] },
    }),
  )
  const end = ev('turn/end', { turn: 1, reason: { kind: 'completed' } })
  f.applyEvent(end)

  const [first, , second] = f.messages() as ChatAssistantMessage[]
  // 前半截 complete 但不是 turnEnd：操作栏不再在它身上重复出现。
  assert.equal(first.complete, true)
  assert.equal(first.turnEnd, undefined)
  assert.equal(second.complete, true)
  assert.equal(second.turnEnd, true)
  assert.equal(second.seq, end.seq)
  assert.equal(second.messageId, 'a2')
})

test('turn/end 时 current 已被注入消息切断为 null：按 id 从尾部找回并标记 turnEnd', () => {
  const f = new ConversationFolder()
  f.applyEvent(ev('turn/start', { turn: 1 }))
  f.applyEvent(chunkEv(1, 1, { type: 'block-start', index: 0, blockType: 'text' }))
  f.applyEvent(chunkEv(1, 1, { type: 'text-delta', index: 0, text: '部分输出' }))
  // 注入的 user/message 把 current 置空；turn 随后直接结束，本 turn 再无
  // assistant 事件——找回路径要捞到被切断的那条（assistant-t1）。
  f.applyEvent(userEv('ctx1', 'injected context'))
  const end = ev('turn/end', { turn: 1, reason: { kind: 'completed' } })
  f.applyEvent(end)

  const msg = f.messages()[0] as ChatAssistantMessage
  assert.equal(msg.kind, 'assistant')
  assert.equal(msg.complete, true)
  assert.equal(msg.turnEnd, true)
  assert.equal(msg.seq, end.seq)
})

test('turn/end 落在历史窗口外（本 turn 无消息可找回）时不标记任何消息', () => {
  const f = new ConversationFolder()
  f.applyEvent(userEv('u1', 'hi'))
  // turn/start 与 assistant 内容都在窗口外，只剩一个孤儿 turn/end。
  f.applyEvent(ev('turn/end', { turn: 9, reason: { kind: 'completed' } }))

  assert.equal(f.messages().length, 1)
  assert.equal(f.messages()[0].kind, 'user')
})

test('command/run pushes a running flow node and command/done settles it', () => {
  const f = new ConversationFolder()
  f.applyEvent(ev('command/run', { commandId: 'cmd-1', name: 'compact', source: { kind: 'user' } }))
  f.applyEvent(ev('command/run', { commandId: 'cmd-2', name: 'permission', args: 'read-only', source: { kind: 'user' } }))
  f.applyEvent(ev('command/done', { commandId: 'cmd-1', kind: 'success', text: 'Compacted 12 history items (~900 tokens).' }))
  f.applyEvent(ev('command/done', { commandId: 'cmd-2', kind: 'error', text: 'unknown preset "x"' }))

  const [compact, permission] = f.messages()
  assert.deepEqual(compact, {
    kind: 'command',
    id: 'cmd-1',
    name: 'compact',
    status: 'success',
    text: 'Compacted 12 history items (~900 tokens).',
  })
  assert.deepEqual(permission, {
    kind: 'command',
    id: 'cmd-2',
    name: 'permission',
    args: 'read-only',
    status: 'error',
    text: 'unknown preset "x"',
  })
})

test('command/done without its run in the window folds to nothing', () => {
  const f = new ConversationFolder()
  assert.equal(f.applyEvent(ev('command/done', { commandId: 'cmd-x', kind: 'success' })), false)
  assert.equal(f.messages().length, 0)
})

test('assistant/message captures the host message id and turn/end the fork seq', () => {
  const f = new ConversationFolder()
  f.applyEvent(ev('turn/start', { turn: 1 }))
  f.applyEvent(chunkEv(1, 1, { type: 'block-start', index: 0, blockType: 'text' }))
  f.applyEvent(chunkEv(1, 1, { type: 'text-delta', index: 0, text: 'part one' }))
  f.applyEvent(
    ev('assistant/message', {
      turn: 1,
      step: 1,
      message: { id: 'a1', content: [{ type: 'text', text: 'part one' }] },
    }),
  )
  f.applyEvent(toolCallEv('c1', 'Bash', '{}'))
  f.applyEvent(toolResultEv('c1', 'ok'))
  f.applyEvent(chunkEv(1, 2, { type: 'block-start', index: 0, blockType: 'text' }))
  f.applyEvent(chunkEv(1, 2, { type: 'text-delta', index: 0, text: 'part two' }))
  const lastMsg = ev('assistant/message', {
    turn: 1,
    step: 2,
    message: { id: 'a2', content: [{ type: 'text', text: 'part two' }] },
  })
  f.applyEvent(lastMsg)
  const end = ev('turn/end', { turn: 1, reason: { kind: 'completed' } })
  f.applyEvent(end)

  const msg = lastAssistant(f)
  // Multi-step turn: the LAST step's id wins (the web client's fork rule
  // refers to the completed turn's last message).
  assert.equal(msg.messageId, 'a2')
  assert.equal(msg.seq, end.seq)
  assert.equal(msg.complete, true)
})

test('messageId stays unset when assistant/message carries no id', () => {
  const f = new ConversationFolder()
  f.applyEvent(ev('turn/start', { turn: 1 }))
  f.applyEvent(chunkEv(1, 1, { type: 'block-start', index: 0, blockType: 'text' }))
  f.applyEvent(chunkEv(1, 1, { type: 'text-delta', index: 0, text: 'hi' }))
  f.applyEvent(ev('turn/end', { turn: 1, reason: { kind: 'completed' } }))

  const msg = lastAssistant(f)
  assert.equal(msg.messageId, undefined)
  assert.equal(typeof msg.seq, 'number')
})

test('applyFeedbackRatings merges ratings by messageId and reports changes', () => {
  const f = new ConversationFolder()
  f.applyEvent(ev('turn/start', { turn: 1 }))
  f.applyEvent(
    ev('assistant/message', {
      turn: 1,
      step: 1,
      message: { id: 'a1', content: [{ type: 'text', text: 'one' }] },
    }),
  )
  f.applyEvent(ev('turn/end', { turn: 1, reason: { kind: 'completed' } }))
  f.applyEvent(ev('turn/start', { turn: 2 }))
  f.applyEvent(
    ev('assistant/message', {
      turn: 2,
      step: 1,
      message: { id: 'a2', content: [{ type: 'text', text: 'two' }] },
    }),
  )
  f.applyEvent(ev('turn/end', { turn: 2, reason: { kind: 'completed' } }))

  const ratings = new Map([['a2', { rating: 'positive' as const }]])
  assert.equal(applyFeedbackRatings(f.messages(), ratings), true)
  const [first, second] = f.messages() as ChatAssistantMessage[]
  assert.equal(first.feedbackRating, undefined)
  assert.equal(second.feedbackRating, 'positive')

  // A stable merge reports no change; a cleared rating does.
  assert.equal(applyFeedbackRatings(f.messages(), ratings), false)
  assert.equal(applyFeedbackRatings(f.messages(), new Map()), true)
  assert.equal(second.feedbackRating, undefined)
})

/** 一个完整 turn 的历史事件（turn/start → user/message → assistant/message → turn/end）。 */
function turnEntries(turn: number, userText: string, replyText: string): HistoryEntryLike[] {
  return [
    { event: ev('turn/start', { turn }) },
    { event: userEv(`u${turn}`, userText) },
    {
      event: ev('assistant/message', {
        turn,
        step: 1,
        message: { id: `a${turn}`, content: [{ type: 'text', text: replyText }] },
      }),
    },
    { event: ev('turn/end', { turn, reason: { kind: 'completed' } }) },
  ]
}

test('prependHistory folds an older page in front of the current window', () => {
  const f = new ConversationFolder()
  f.applyHistory(turnEntries(2, '第二问', '第二答'))
  f.prependHistory(turnEntries(1, '第一问', '第一答'))

  const msgs = f.messages()
  assert.deepEqual(
    msgs.map((m) => (m.kind === 'user' ? m.text : m.kind === 'assistant' ? (m.blocks[0] as { text: string }).text : m.name)),
    ['第一问', '第一答', '第二问', '第二答'],
  )
  assert.equal(f.hasOpenTurn(), false)
  // 旧页是完整消息：拼进来的 assistant 消息都是 complete。
  assert.equal((msgs[1] as ChatAssistantMessage).complete, true)
})

test('prependHistory does not disturb an open streaming turn', () => {
  const f = new ConversationFolder()
  f.applyEvent(ev('turn/start', { turn: 2 }))
  f.applyEvent(chunkEv(2, 1, { type: 'block-start', index: 0, blockType: 'text' }))
  f.applyEvent(chunkEv(2, 1, { type: 'text-delta', index: 0, text: '流式中' }))

  f.prependHistory(turnEntries(1, '旧问', '旧答'))

  // 旧消息在前，进行中的 turn 仍在尾部且保持未完成。
  assert.equal(f.messages().length, 3)
  const tail = lastAssistant(f)
  assert.deepEqual(tail.blocks, [{ type: 'text', text: '流式中' }])
  assert.equal(tail.complete, false)
  assert.equal(f.hasOpenTurn(), true)
  //  prepend 后仍能继续折叠进行中的流式增量。
  f.applyEvent(chunkEv(2, 1, { type: 'text-delta', index: 0, text: '……继续' }))
  assert.deepEqual(tail.blocks, [{ type: 'text', text: '流式中……继续' }])
})

test('prependHistory with an empty page is a no-op', () => {
  const f = new ConversationFolder()
  f.applyHistory(turnEntries(1, '问', '答'))
  f.prependHistory([])
  assert.equal(f.messages().length, 2)
})

test('tail window without turn/start still reports the unclosed turn as running', () => {
  // 窗口分页：长 turn 的 turn/start 落在窗口外，但窗口是连续后缀——内容事件
  // 的 turn 没有配对 turn/end 就是还在跑。
  const f = new ConversationFolder()
  f.applyEvent(userEv('u9', '问题'))
  f.applyEvent(chunkEv(9, 1, { type: 'block-start', index: 0, blockType: 'text' }))
  f.applyEvent(chunkEv(9, 1, { type: 'text-delta', index: 0, text: '回答中' }))
  assert.equal(f.hasOpenTurn(), true)
  f.applyEvent(ev('turn/end', { turn: 9, reason: { kind: 'completed' } }))
  assert.equal(f.hasOpenTurn(), false)
})

test('todo_write call folds a planSummary from its args snapshot', () => {
  const f = new ConversationFolder()
  f.applyEvent(ev('turn/start', { turn: 1 }))
  f.applyEvent(
    toolCallEv('c1', 'todo_write', JSON.stringify({ todos: [
      { content: 'a', status: 'completed' },
      { content: '启动后台 bash job（60s 模拟流水线）', status: 'in_progress' },
      { content: 'b', status: 'in_progress' },
      { content: 'c', status: 'pending' },
    ] })),
  )

  const block = lastAssistant(f).blocks[0] as ChatToolBlock
  assert.deepEqual(block.todos, {
    done: 1,
    total: 4,
    activeContent: '启动后台 bash job（60s 模拟流水线）',
    activeExtra: 1,
  })
})

test('todo_write with all completed yields no active content and no extra', () => {
  const f = new ConversationFolder()
  f.applyEvent(ev('turn/start', { turn: 1 }))
  f.applyEvent(toolCallEv('c1', 'todo_write', JSON.stringify({ todos: [
    { content: 'x', status: 'completed' },
    { content: 'y', status: 'completed' },
  ] })))

  const block = lastAssistant(f).blocks[0] as ChatToolBlock
  assert.deepEqual(block.todos, { done: 2, total: 2, activeContent: null, activeExtra: 0 })
})

test('todo_write with empty first in_progress content reports activeContent null', () => {
  const f = new ConversationFolder()
  f.applyEvent(ev('turn/start', { turn: 1 }))
  f.applyEvent(toolCallEv('c1', 'todo_write', JSON.stringify({ todos: [
    { content: '', status: 'in_progress' },
    { content: 'named', status: 'in_progress' },
  ] })))

  const block = lastAssistant(f).blocks[0] as ChatToolBlock
  assert.deepEqual(block.todos, { done: 0, total: 2, activeContent: null, activeExtra: 1 })
})

test('todo_write with malformed args falls back to the generic tool row', () => {
  const f = new ConversationFolder()
  f.applyEvent(ev('turn/start', { turn: 1 }))
  // 坏 JSON / 缺 todos 数组 / 空 todos：都不该挂 planSummary。
  f.applyEvent(toolCallEv('c1', 'todo_write', '{not json'))
  f.applyEvent(toolCallEv('c2', 'todo_write', JSON.stringify({ foo: 1 })))
  f.applyEvent(toolCallEv('c3', 'todo_write', JSON.stringify({ todos: [] })))

  const blocks = lastAssistant(f).blocks as ChatToolBlock[]
  for (const block of blocks) assert.equal(block.todos, undefined)
})

test('non-todo_write tools never carry a planSummary', () => {
  const f = new ConversationFolder()
  f.applyEvent(ev('turn/start', { turn: 1 }))
  f.applyEvent(toolCallEv('c1', 'bash', JSON.stringify({ command: 'echo hi', todos: [{ content: 'x', status: 'pending' }] })))

  const block = lastAssistant(f).blocks[0] as ChatToolBlock
  assert.equal(block.todos, undefined)
})

// ── produced files（对齐官方 dsh-client-ui-deliverables 的 turn 产物累积）──

function turnEndEv(turn: number): SessionEventLike {
  return ev('turn/end', { turn, reason: { kind: 'completed' } })
}

test('diff call views accumulate locations as produced files on the turn-end message', () => {
  const f = new ConversationFolder()
  f.applyEvent(ev('turn/start', { turn: 1 }))
  f.applyEvent(userEv('u1', '写两个文件'))
  f.applyEvent(toolCallEv('c1', 'edit', '{}'), {
    for: 'call',
    view: { card: 'diff', locations: [{ path: '/repo/src/a.ts' }, { path: '/repo/src/b.ts' }] },
  })
  f.applyEvent(toolResultEv('c1', 'ok'))
  f.applyEvent(toolCallEv('c2', 'edit', '{}'), {
    for: 'call',
    view: { card: 'diff', locations: [{ path: '/repo/src/c.ts' }] },
  })
  f.applyEvent(toolResultEv('c2', 'ok'))
  f.applyEvent(turnEndEv(1))

  const msg = lastAssistant(f)
  assert.deepEqual(msg.producedFiles, ['/repo/src/a.ts', '/repo/src/b.ts', '/repo/src/c.ts'])
})

test('generic card with kind edit contributes locations; other kinds do not', () => {
  const f = new ConversationFolder()
  f.applyEvent(ev('turn/start', { turn: 1 }))
  // str_replace_editor 的 insert 呈现为 generic + kind edit。
  f.applyEvent(toolCallEv('c1', 'str_replace_editor', '{}'), {
    for: 'call',
    view: { card: 'generic', kind: 'edit', locations: [{ path: '/repo/lib/x.ts' }] },
  })
  f.applyEvent(toolResultEv('c1', 'ok'))
  // read 看了文件不算产出，delete 没有可开文件，terminal 只是跑命令。
  f.applyEvent(toolCallEv('c2', 'read', '{}'), {
    for: 'call',
    view: { card: 'generic', kind: 'read', locations: [{ path: '/repo/lib/x.ts' }] },
  })
  f.applyEvent(toolResultEv('c2', 'ok'))
  f.applyEvent(toolCallEv('c3', 'bash', '{}'), {
    for: 'call',
    view: { card: 'terminal', cwd: '/repo', output: 'ok' },
  })
  f.applyEvent(toolResultEv('c3', 'ok'))
  f.applyEvent(turnEndEv(1))

  assert.deepEqual(lastAssistant(f).producedFiles, ['/repo/lib/x.ts'])
})

test('failed tool results contribute nothing to produced files', () => {
  const f = new ConversationFolder()
  f.applyEvent(ev('turn/start', { turn: 1 }))
  f.applyEvent(toolCallEv('c1', 'edit', '{}'), {
    for: 'call',
    view: { card: 'diff', locations: [{ path: '/repo/src/a.ts' }] },
  })
  f.applyEvent(toolResultEv('c1', 'boom', true))
  f.applyEvent(turnEndEv(1))

  assert.equal(lastAssistant(f).producedFiles, undefined)
})

test('produced paths dedupe first-seen across a turn, result without call view adds nothing', () => {
  const f = new ConversationFolder()
  f.applyEvent(ev('turn/start', { turn: 1 }))
  f.applyEvent(toolCallEv('c1', 'edit', '{}'), {
    for: 'call',
    view: { card: 'diff', locations: [{ path: '/repo/src/a.ts' }] },
  })
  f.applyEvent(toolResultEv('c1', 'ok'))
  // 同一文件再写一次：只保留首次出现。
  f.applyEvent(toolCallEv('c2', 'edit', '{}'), {
    for: 'call',
    view: { card: 'diff', locations: [{ path: '/repo/src/a.ts' }, { path: '/repo/src/b.ts' }] },
  })
  f.applyEvent(toolResultEv('c2', 'ok'))
  // call 落在窗口外 / 无 view：产物为空。
  f.applyEvent(toolResultEv('c99', 'ok'))
  f.applyEvent(turnEndEv(1))

  assert.deepEqual(lastAssistant(f).producedFiles, ['/repo/src/a.ts', '/repo/src/b.ts'])
})

test('produced files only attach to the turn-end message, and refold clears them', () => {
  const f = new ConversationFolder()
  f.applyHistory([
    { event: ev('turn/start', { turn: 1 }) },
    { event: toolCallEv('c1', 'edit', '{}'), view: { for: 'call', view: { card: 'diff', locations: [{ path: '/repo/a.ts' }] } } },
    { event: toolResultEv('c1', 'ok') },
    // turn 未结束：流式中间态没有 producedFiles。
  ])
  assert.equal(lastAssistant(f).producedFiles, undefined)
  f.applyEvent(turnEndEv(1))
  assert.deepEqual(lastAssistant(f).producedFiles, ['/repo/a.ts'])

  // re-baseline 全量重折：累积器清空，同一事件流重放结果一致。
  f.applyHistory([
    { event: ev('turn/start', { turn: 1 }) },
    { event: toolCallEv('c1', 'edit', '{}'), view: { for: 'call', view: { card: 'diff', locations: [{ path: '/repo/a.ts' }] } } },
    { event: toolResultEv('c1', 'ok') },
    { event: turnEndEv(1) },
  ])
  assert.deepEqual(lastAssistant(f).producedFiles, ['/repo/a.ts'])
})

test('turn split by an injected user/message still attaches produced files to the final message', () => {
  const f = new ConversationFolder()
  f.applyEvent(ev('turn/start', { turn: 1 }))
  f.applyEvent(userEv('u1', '任务'))
  f.applyEvent(toolCallEv('c1', 'edit', '{}'), {
    for: 'call',
    view: { card: 'generic', kind: 'edit', locations: [{ path: '/repo/a.ts' }] },
  })
  f.applyEvent(toolResultEv('c1', 'ok'))
  // 注入上下文切断当前 assistant 消息。
  f.applyEvent(ev('user/message', {
    id: 'injected',
    role: 'user',
    content: [{ type: 'text', text: '子代理完成' }],
    source: { kind: 'subagent-notify' },
  }))
  // 切断后再有内容：另起第二条 assistant 消息（同 turn 同 id）。
  f.applyEvent(toolCallEv('c2', 'edit', '{}'), {
    for: 'call',
    view: { card: 'generic', kind: 'edit', locations: [{ path: '/repo/b.ts' }] },
  })
  f.applyEvent(toolResultEv('c2', 'ok'))
  f.applyEvent(turnEndEv(1))

  const assistantMsgs = f.messages().filter((m): m is ChatAssistantMessage => m.kind === 'assistant')
  assert.equal(assistantMsgs.length, 2)
  // 被切断的前半截：complete 但不是 turnEnd，也不带产物。
  assert.equal(assistantMsgs[0].producedFiles, undefined)
  assert.equal(assistantMsgs[1].turnEnd, true)
  // 产物只挂本 turn 最后一条（turnEnd）消息，跨消息不重复。
  assert.deepEqual(assistantMsgs[1].producedFiles, ['/repo/a.ts', '/repo/b.ts'])
})
