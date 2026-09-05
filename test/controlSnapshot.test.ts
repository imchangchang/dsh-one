import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyControlFrame,
  createControlSnapshot,
  replayControlSnapshot,
} from '../src/pure/controlSnapshot.ts'
import type { ControlStreamFrame } from '../src/pure/remoteFrames.ts'

test('snapshot: baseline replaces the domains present, keeps absent ones', () => {
  const snap = createControlSnapshot()
  applyControlFrame(snap, {
    type: 'baseline',
    value: { queues: { s1: [{ id: 'q1', placement: 'queued', text: 'a' }] } },
  })
  // baseline 未带 jobs/projections：不创建空域（消费端对缺失域本就跳过）。
  assert.deepEqual(snap.queues, { s1: [{ id: 'q1', placement: 'queued', text: 'a' }] })
  assert.deepEqual(snap.jobs, {})
  assert.deepEqual(snap.projections, {})
})

test('snapshot: queue/jobs increments replace per session', () => {
  const snap = createControlSnapshot()
  applyControlFrame(snap, {
    type: 'baseline',
    value: { queues: { s1: [{ id: 'q1' }], s2: [{ id: 'q2' }] }, jobs: { s1: [{ id: 'j1' }] } },
  })
  applyControlFrame(snap, { type: 'queue', sessionId: 's1', items: [{ id: 'q1b' }] })
  assert.deepEqual(snap.queues.s1, [{ id: 'q1b' }])
  assert.deepEqual(snap.queues.s2, [{ id: 'q2' }])
  applyControlFrame(snap, { type: 'jobs', sessionId: 's2', jobs: [{ id: 'j2' }] })
  assert.deepEqual(snap.jobs.s2, [{ id: 'j2' }])
})

test('snapshot: projection increments merge per key, asOfSeq takes max', () => {
  const snap = createControlSnapshot()
  applyControlFrame(snap, {
    type: 'baseline',
    value: {
      projections: {
        s1: { asOfSeq: 10, values: { title: '旧标题', todos: [{ content: 'x', status: 'in_progress' }] } },
      },
    },
  })
  applyControlFrame(snap, { type: 'projection', sessionId: 's1', key: 'title', value: '新标题', seq: 12 })
  applyControlFrame(snap, { type: 'projection', sessionId: 's1', key: 'goal', value: { objective: 'g' }, seq: 14 })
  assert.deepEqual(snap.projections.s1, {
    asOfSeq: 14,
    values: { title: '新标题', todos: [{ content: 'x', status: 'in_progress' }], goal: { objective: 'g' } },
  })
  // 更低 seq 的旧增量不抬高 asOfSeq，但值仍按 key 覆盖（消费端 seq 守卫兜底）。
  applyControlFrame(snap, { type: 'projection', sessionId: 's1', key: 'title', value: '再新', seq: 13 })
  assert.equal(snap.projections.s1.asOfSeq, 14)
  assert.equal(snap.projections.s1.values.title, '再新')
})

test('snapshot: replay emits baseline frame with non-empty domains only', () => {
  const snap = createControlSnapshot()
  applyControlFrame(snap, {
    type: 'baseline',
    value: { queues: { s1: [{ id: 'q1' }] } },
  })
  applyControlFrame(snap, { type: 'projection', sessionId: 's1', key: 'title', value: 'T', seq: 5 })
  const frame = replayControlSnapshot(snap)
  assert.notEqual(frame, null)
  assert.equal(frame!.type, 'baseline')
  const value = (frame as Extract<ControlStreamFrame, { type: 'baseline' }>).value
  assert.deepEqual(value.queues, { s1: [{ id: 'q1' }] })
  assert.equal(Object.hasOwn(value, 'jobs'), false)
  assert.deepEqual(value.projections, { s1: { asOfSeq: 5, values: { title: 'T' } } })
})

test('snapshot: empty snapshot replays null', () => {
  assert.equal(replayControlSnapshot(createControlSnapshot()), null)
})

test('snapshot: replay is decoupled from shared cache (mutation-safe)', () => {
  const snap = createControlSnapshot()
  applyControlFrame(snap, { type: 'queue', sessionId: 's1', items: [{ id: 'q1' }] })
  const frame = replayControlSnapshot(snap)
  assert.notEqual(frame, null)
  // 消费端改写重放帧不应污染共享缓存。
  const value = (frame as Extract<ControlStreamFrame, { type: 'baseline' }>).value
  ;(value.queues as Record<string, unknown[]>).s1 = [{ id: 'mutated' }]
  assert.deepEqual(snap.queues.s1, [{ id: 'q1' }])
})
