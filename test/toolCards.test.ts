import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cordisActionCardModel,
  cordisDefineCardModel,
  cordisRunCardModel,
  skillCardModel,
} from '../src/pure/toolCards.ts'
import type { ChatToolBlock } from '../src/pure/chatContract.ts'

function block(overrides: Partial<ChatToolBlock>): ChatToolBlock {
  return { type: 'tool', callId: 'call-1', name: 'skill', status: 'done', ...overrides }
}

test('skill card: name from args.name, output is the instructions text', () => {
  const card = skillCardModel(
    block({ args: JSON.stringify({ name: 'my-skill', something: 1 }), output: '第一条指令\n第二条指令' }),
  )
  assert.equal(card.name, 'my-skill')
  assert.equal(card.output, '第一条指令\n第二条指令')
  assert.equal(card.errorSummary, null)
  assert.equal(card.state, 'ok')
})

test('skill card: multiline name collapses to its first line', () => {
  const card = skillCardModel(block({ args: JSON.stringify({ name: 'line-one\nline-two' }) }))
  assert.equal(card.name, 'line-one')
})

test('skill card: malformed args fall back to raw first line, empty args to callId', () => {
  assert.equal(skillCardModel(block({ args: '{not json\nmore' })).name, '{not json')
  assert.equal(skillCardModel(block({ args: '' })).name, 'call-1')
  assert.equal(skillCardModel(block({ args: undefined })).name, 'call-1')
})

test('skill card: error state surfaces the output first line as summary', () => {
  const card = skillCardModel(
    block({ status: 'error', args: '{"name":"broken"}', output: 'boom: exploded\nstack' }),
  )
  assert.equal(card.state, 'error')
  assert.equal(card.errorSummary, 'boom: exploded')
})

test('skill card: running state has no output and is not expandable', () => {
  const card = skillCardModel(block({ status: 'running', args: '{"name":"x"}' }))
  assert.equal(card.state, 'running')
  assert.equal(card.output, null)
})

test('cordis_define card: meta supplies plugin/package ids, args the rest', () => {
  const card = cordisDefineCardModel(
    block({
      args: JSON.stringify({
        name: 'my-plugin',
        purpose: '测试用途',
        code: { host: 'module.exports = 1', client: 'export default 2' },
      }),
      meta: { pluginId: 'p-1', packageId: 'pkg-1' },
      output: 'defined ok',
    }),
  )
  assert.equal(card.pluginId, 'p-1')
  assert.equal(card.packageId, 'pkg-1')
  assert.equal(card.name, 'my-plugin')
  assert.equal(card.purpose, '测试用途')
  assert.equal(card.hostCode, 'module.exports = 1')
  assert.equal(card.clientCode, 'export default 2')
  assert.equal(card.output, 'defined ok')
})

test('cordis_define card: missing halves are null (no host/client code declared)', () => {
  const card = cordisDefineCardModel(
    block({ args: JSON.stringify({ name: 'n', code: { host: 'x' } }), meta: { pluginId: 'p' } }),
  )
  assert.equal(card.hostCode, 'x')
  assert.equal(card.clientCode, null)
  assert.equal(card.packageId, null)
})

test('cordis_define card: no meta and no args fall back to raw args first line', () => {
  const card = cordisDefineCardModel(block({ args: 'not json', output: 'oops' }))
  assert.equal(card.name, 'not json')
  assert.equal(card.pluginId, null)
  assert.equal(card.purpose, null)
})

test('cordis_run card: ids prefer meta, fall back to args; mode detected', () => {
  const base = { args: JSON.stringify({ pluginId: 'p-args', packageId: 'pkg-args', mode: 'update' }) }
  const withMeta = cordisRunCardModel(block({ ...base, meta: { pluginId: 'p-meta', pluginRunId: 'run-1' } }))
  assert.equal(withMeta.pluginId, 'p-meta')
  assert.equal(withMeta.packageId, 'pkg-args')
  assert.equal(withMeta.pluginRunId, 'run-1')
  assert.equal(withMeta.mode, 'update')
  const noMeta = cordisRunCardModel(block({ ...base, meta: undefined }))
  assert.equal(noMeta.pluginId, 'p-args')
  assert.equal(noMeta.pluginRunId, null)
  assert.equal(noMeta.mode, 'update')
  const runMode = cordisRunCardModel(block({ args: JSON.stringify({ mode: 'run' }) }))
  assert.equal(runMode.mode, 'run')
})

test('cordis_run card: unknown mode is null (rendered as run)', () => {
  const card = cordisRunCardModel(block({ args: JSON.stringify({ mode: 'restart' }) }))
  assert.equal(card.mode, null)
})

test('cordis_run card: error state surfaces output first line', () => {
  const card = cordisRunCardModel(
    block({ status: 'error', args: '{}', output: 'activation failed: nope\nmore' }),
  )
  assert.equal(card.state, 'error')
  assert.equal(card.errorSummary, 'activation failed: nope')
})

test('cordis action card: pluginId from args, id as fallback', () => {
  assert.equal(cordisActionCardModel(block({ args: '{"pluginId":"p-1"}' })).pluginId, 'p-1')
  assert.equal(cordisActionCardModel(block({ args: '{"id":"p-2"}' })).pluginId, 'p-2')
  assert.equal(cordisActionCardModel(block({ args: '{}' })).pluginId, null)
})

test('cordis action card: output and error summary flow through', () => {
  const card = cordisActionCardModel(
    block({ status: 'error', args: '{"pluginId":"p"}', output: 'undefine failed\nx' }),
  )
  assert.equal(card.output, 'undefine failed\nx')
  assert.equal(card.errorSummary, 'undefine failed')
})
