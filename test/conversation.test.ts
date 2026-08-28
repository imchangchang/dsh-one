import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ConversationFolder } from '../src/pure/conversation.ts'
import type { SessionEventLike, StreamChunkData, ToolEventViewLike } from '../src/pure/conversation.ts'
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

test('tool output is truncated to the output limit', () => {
  const f = new ConversationFolder()
  f.applyEvent(ev('turn/start', { turn: 1 }))
  f.applyEvent(toolCallEv('c1', 'bash', '{}'))
  f.applyEvent(toolResultEv('c1', 'x'.repeat(5000)))

  const block = lastAssistant(f).blocks[0] as ChatToolBlock
  assert.equal(block.status, 'done')
  assert.equal(block.output?.length, 4002) // 4000 chars + '\n…'
  assert.ok(block.output?.endsWith('…'))
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
