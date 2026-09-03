import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ConversationFolder } from '../../src/pure/conversation.ts'
import {
  completeTurnHistory,
  completeConversationScenario,
  approvalScenario,
  emptyScenario,
} from './scenario.ts'

test('completeTurnHistory：折叠成 1 条用户消息 + 1 条完成态助手消息（思考/文本/工具卡）', () => {
  const folder = new ConversationFolder()
  folder.applyHistory(completeTurnHistory())
  const messages = folder.messages()
  assert.equal(messages.length, 2)
  assert.equal(messages[0].kind, 'user')
  assert.equal(messages[0].text, '给这个仓库加一个 /greet 子命令')

  const assistant = messages[1]
  assert.equal(assistant.kind, 'assistant')
  assert.equal(assistant.complete, true)
  assert.equal(assistant.turnEnd, true)
  assert.equal(assistant.seq, 15)
  assert.equal(assistant.messageId, 'msg-1')
  assert.equal(assistant.blocks.length, 3)
  assert.deepEqual(assistant.blocks[0], { type: 'reasoning', text: '用户想要一个新的斜杠命令。我先找到指令注册入口。' })
  assert.deepEqual(assistant.blocks[1], { type: 'text', text: '好的，我先看一下指令注册入口。注册入口在 src/pure/slashCommand.ts。' })
  assert.equal(assistant.blocks[2].type, 'tool')
  assert.equal(assistant.blocks[2].callId, 'call-1')
  assert.equal(assistant.blocks[2].name, 'bash')
  assert.equal(assistant.blocks[2].status, 'done')
  assert.equal(assistant.blocks[2].detail, 'grep -rn slashCommand src')
  assert.equal(assistant.blocks[2].output, 'src/components/A.ts\nsrc/components/B.ts')
})

test('approvalScenario：折叠成运行中的半截 turn（工具卡 running，无 turn/end）', () => {
  const folder = new ConversationFolder()
  folder.applyHistory(approvalScenario().history ?? [])
  const messages = folder.messages()
  assert.equal(messages.length, 2)
  assert.equal(messages[0].kind, 'user')
  assert.equal(messages[0].text, '删除所有临时文件')
  const assistant = messages[1]
  assert.equal(assistant.kind, 'assistant')
  assert.equal(assistant.complete, false)
  assert.equal(folder.hasOpenTurn(), true)
  const text = assistant.blocks.find((b) => b.type === 'text')
  assert.equal(text && text.type === 'text' && text.text, '需要你批准以下操作。')
  const tool = assistant.blocks.find((b) => b.type === 'tool')
  assert.ok(tool && tool.type === 'tool')
  assert.equal(tool.status, 'running')
  assert.equal(tool.name, 'bash')
})

test('emptyScenario：空历史 + blank 摘要，折叠后没有任何消息', () => {
  const folder = new ConversationFolder()
  folder.applyHistory(emptyScenario().history ?? [])
  assert.equal(folder.messages().length, 0)
  assert.equal(folder.hasOpenTurn(), false)

  const scenario = completeConversationScenario()
  assert.equal(typeof scenario.summary?.blank, 'boolean')
  assert.equal((scenario.projections?.values.todos as unknown[] | undefined)?.length, 2)
})
