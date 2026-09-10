import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyControlFrame,
  createControlSnapshot,
  replayControlSnapshot,
} from '../src/pure/controlSnapshot.ts'
import type { ControlStreamFrame } from '../src/pure/remoteFrames.ts'

test('snapshot: baseline replaces every domain wholesale (absent domain = empty)', () => {
  const snap = createControlSnapshot()
  applyControlFrame(snap, {
    type: 'baseline',
    value: { queues: { s1: [{ id: 'q1', placement: 'queued', text: 'a' }] }, jobs: { s1: [{ id: 'j1' }] } },
  })
  assert.deepEqual(snap.queues, { s1: [{ id: 'q1', placement: 'queued', text: 'a' }] })
  assert.deepEqual(snap.jobs, { s1: [{ id: 'j1' }] })
  assert.deepEqual(snap.projections, {})
})

test('snapshot: reconnect baseline drops keys it no longer carries', () => {
  const snap = createControlSnapshot()
  applyControlFrame(snap, {
    type: 'baseline',
    value: {
      queues: { s1: [{ id: 'q1' }], s2: [{ id: 'q2' }] },
      jobs: { s1: [{ id: 'j1' }] },
      projections: { s1: { asOfSeq: 3, values: { todos: [{ content: 'x' }], goal: { objective: 'g' } } } },
    },
  })
  // 重连后的新 baseline 只带 s2 的队列、没有 jobs、s2 的投影里只有 title：
  // 缺席的 s1 队列/jobs、s1 的投影块、s2 的 todos/goal 键都必须清掉（幽灵源）。
  applyControlFrame(snap, {
    type: 'baseline',
    value: {
      queues: { s2: [{ id: 'q2' }] },
      projections: { s2: { asOfSeq: 5, values: { title: 'T' } } },
    },
  })
  assert.deepEqual(snap.queues, { s2: [{ id: 'q2' }] })
  assert.deepEqual(snap.jobs, {})
  assert.deepEqual(snap.projections, { s2: { asOfSeq: 5, values: { title: 'T' } } })
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

test('snapshot: replay emits all three domains so absent keys can be cleared', () => {
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
  // jobs 域为空也必须显式带上（缺席与空同义，消费端据此清空幽灵任务）。
  assert.deepEqual(value.jobs, {})
  assert.deepEqual(value.projections, { s1: { asOfSeq: 5, values: { title: 'T' } } })
})

test('snapshot: only an all-empty snapshot replays null', () => {
  assert.equal(replayControlSnapshot(createControlSnapshot()), null)
  // 只有投影、没有排队/任务：仍要重放（消费端要靠它恢复 chip）。
  const projectionsOnly = createControlSnapshot()
  applyControlFrame(projectionsOnly, { type: 'projection', sessionId: 's1', key: 'title', value: 'T', seq: 1 })
  assert.notEqual(replayControlSnapshot(projectionsOnly), null)
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
