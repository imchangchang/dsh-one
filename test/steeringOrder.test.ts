import { test } from 'node:test'
import assert from 'node:assert/strict'
import { interleaveSteering, orderBySeq, steerConverged } from '../src/pure/steeringOrder.ts'

test('orderBySeq：按 seq 升序排，无 seq 排尾，稳定保持相对顺序', () => {
  const items = [
    { id: 'c', seq: 103 },
    { id: 'no-seq-1' },
    { id: 'a', seq: 100 },
    { id: 'no-seq-2' },
    { id: 'b', seq: 100 }, // 与 a 同 seq：稳定排序保持 a 在前
  ]
  const out = orderBySeq(items)
  assert.deepEqual(out.map((i) => i.id), ['a', 'b', 'c', 'no-seq-1', 'no-seq-2'])
  // 不原地改调用方数组（消费侧保活对账依赖原序）。
  assert.deepEqual(items.map((i) => i.id), ['c', 'no-seq-1', 'a', 'no-seq-2', 'b'])
})

test('互斥插排：早发 steering（低 seq）插到后发消息（高 seq）之前，治乱序', () => {
  const messages = [
    { id: 'm1', seq: 100 },
    { id: 'm2', seq: 105 },
  ]
  // steering 先发（水位 100 时进队列），另一条用户消息 m2 后折叠（seq 105）。
  const steers = [{ id: 's1', seq: 101 }]
  const out = interleaveSteering(messages, steers)
  assert.deepEqual(out.map((e) => e.kind === 'message' ? e.message.id : e.steer.id), ['m1', 's1', 'm2'])
})

test('最新 steering（seq 高于所有消息）排在消息流末尾（tailSteers 语义）', () => {
  const messages = [
    { id: 'm1', seq: 100 },
    { id: 'm2', seq: 105 },
  ]
  const steers = [{ id: 's-latest', seq: 106 }]
  const out = interleaveSteering(messages, steers)
  assert.deepEqual(out.map((e) => e.kind === 'message' ? e.message.id : e.steer.id), ['m1', 'm2', 's-latest'])
})

test('无 seq 的 legacy/harness steering 按最新排尾（不往消息中间插）', () => {
  const messages = [
    { id: 'm1', seq: 100 },
    { id: 'm2', seq: 105 },
  ]
  const steers = [{ id: 's-no-seq' }]
  const out = interleaveSteering(messages, steers)
  assert.deepEqual(out.map((e) => e.kind === 'message' ? e.message.id : e.steer.id), ['m1', 'm2', 's-no-seq'])
})

test('多个 steering 按 seq 升序插排，且与多消息正确交叉', () => {
  const messages = [
    { id: 'm1', seq: 100 },
    { id: 'm2', seq: 106 },
  ]
  const steers = [
    { id: 's-late', seq: 108 },
    { id: 's-mid', seq: 103 },
    { id: 's-early', seq: 101 },
  ]
  const out = interleaveSteering(messages, steers)
  assert.deepEqual(out.map((e) => e.kind === 'message' ? e.message.id : e.steer.id), [
    'm1', 's-early', 's-mid', 'm2', 's-late',
  ])
})

test('流式消息（无 seq）是生长尾部：steering 不插到它前面', () => {
  const messages = [
    { id: 'm1', seq: 100 },
    { id: 'streaming', kind: 'assistant' }, // complete=false，无 seq
  ]
  const steers = [{ id: 's1', seq: 101 }]
  const out = interleaveSteering(messages, steers)
  assert.deepEqual(out.map((e) => e.kind === 'message' ? e.message.id : e.steer.id), [
    'm1', 'streaming', 's1',
  ])
})

test('空 messages + steering：steering 全走 tailSteers', () => {
  const out = interleaveSteering<{ id: string; seq?: number }, { id: string; seq?: number }>(
    [],
    [{ id: 's1', seq: 101 }],
  )
  assert.deepEqual(out.map((e) => e.kind === 'message' ? e.message.id : e.steer.id), ['s1'])
})

test('steerConverged：只认「回合已关 / 该行已被领走」这两个正常竞态', () => {
  assert.equal(steerConverged(new Error('session/updateQueue failed: session/steer-unavailable 当前回合已结束')), true)
  assert.equal(steerConverged(new Error('session/updateQueue failed: session/queue-item-not-found 行不存在')), true)
  assert.equal(steerConverged(new Error('session/updateQueue failed: gateway/internal 挂了')), false)
  assert.equal(steerConverged('some other failure'), false)
  assert.equal(steerConverged(undefined), false)
})
