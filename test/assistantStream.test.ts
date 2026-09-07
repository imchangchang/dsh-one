import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  expandAssistantStream,
  AssistantStreamFold,
} from '../src/pure/assistantStream.ts'

test('expandAssistantStream: text/reasoning/tool-call compact records → chunk deltas', () => {
  const out = expandAssistantStream([
    { type: 'text-chunks', time0: 100, index: 0, dt: [5], texts: ['Hi', ' there'] },
    { type: 'reasoning-chunks', time0: 200, index: 1, dt: [], texts: ['think'] },
    { type: 'tool-call-chunks', time0: 300, index: 2, dt: [3], id: 'call-1', name: 'bash', args: ['{\"cmd\":', '\"ls\"}'] },
  ])
  assert.deepEqual(out, [
    { chunk: { type: 'text-delta', index: 0, text: 'Hi' }, time: 100 },
    { chunk: { type: 'text-delta', index: 0, text: ' there' }, time: 105 },
    { chunk: { type: 'reasoning-delta', index: 1, text: 'think' }, time: 200 },
    { chunk: { type: 'tool-call-delta', index: 2, id: 'call-1', name: 'bash', argumentsDelta: '{"cmd":' }, time: 300 },
    { chunk: { type: 'tool-call-delta', index: 2, id: 'call-1', name: 'bash', argumentsDelta: '"ls"}' }, time: 303 },
  ])
})

test('expandAssistantStream: raw chunk records and malformed entries', () => {
  const out = expandAssistantStream([
    { type: 'chunk', time: 400, chunk: { type: 'block-start', index: 3, blockType: 'text' } },
    { type: 'bogus', time0: 1 },
    null,
    42,
  ])
  assert.deepEqual(out, [
    { chunk: { type: 'block-start', index: 3, blockType: 'text' }, time: 400 },
  ])
})

test('AssistantStreamFold: start → chunk* → end folds contiguous chunks', () => {
  const fold = new AssistantStreamFold()
  fold.noteDurableSeq(10)
  assert.deepEqual(fold.acceptFrame({ type: 'start', attemptId: 'a1', revision: 1, startedAfterSeq: 10, turn: 2, step: 1 }), [])
  const [c1] = fold.acceptFrame({ type: 'chunk', attemptId: 'a1', revision: 1, index: 0, time: 11, chunk: { type: 'text-delta', index: 0, text: 'H' } })
  const [c2] = fold.acceptFrame({ type: 'chunk', attemptId: 'a1', revision: 1, index: 1, time: 12, chunk: { type: 'text-delta', index: 0, text: 'i' } })
  assert.equal(c1?.type, 'assistant/chunk')
  assert.deepEqual((c1?.data as { turn: number; step: number }).turn, 2)
  assert.deepEqual((c2?.data as { chunk: { text: string } }).chunk.text, 'i')
  // end clears active; no events.
  assert.deepEqual(fold.acceptFrame({ type: 'end', attemptId: 'a1', revision: 1, index: 2, outcome: { kind: 'committed', eventType: 'assistant/message', seq: 12 } }), [])
})

test('AssistantStreamFold: gap / attempt mismatch skipped (settlement supersedes)', () => {
  const fold = new AssistantStreamFold()
  fold.acceptFrame({ type: 'start', attemptId: 'a1', revision: 1, startedAfterSeq: 0, turn: 1, step: 1 })
  // gap: index 2 instead of expected 0
  assert.deepEqual(fold.acceptFrame({ type: 'chunk', attemptId: 'a1', revision: 1, index: 2, time: 1, chunk: { type: 'text-delta', index: 0, text: 'x' } }), [])
  // attempt mismatch
  assert.deepEqual(fold.acceptFrame({ type: 'chunk', attemptId: 'a9', revision: 1, index: 0, time: 1, chunk: { type: 'text-delta', index: 0, text: 'x' } }), [])
})

test('AssistantStreamFold: replace() expands the reconnect baseline prefix', () => {
  const fold = new AssistantStreamFold()
  fold.noteDurableSeq(5)
  const events = fold.replace({
    revision: 2,
    activeAttempt: {
      attemptId: 'a1',
      startedAfterSeq: 5,
      turn: 3,
      step: 2,
      nextIndex: 2,
      stream: [
        { type: 'text-chunks', time0: 50, index: 0, dt: [], texts: ['he'] },
        { type: 'text-chunks', time0: 51, index: 0, dt: [], texts: ['y'] },
      ],
    },
  })
  assert.equal(events.length, 2)
  assert.deepEqual((events[0]?.data as { turn: number }).turn, 3)
  assert.deepEqual((events[0]?.data as { chunk: { text: string } }).chunk.text, 'he')
  // nextIndex=2 means only the first two chunk records are represented; seqs fall between durable 5 and 6.
  const seq = events[0]?.seq as number
  assert.ok(seq > 5 && seq < 6, `synthetic seq should sit between durable seqs, got ${String(seq)}`)
  // no baseline → no events, fold reset.
  assert.deepEqual(fold.replace(undefined), [])
})

test('AssistantStreamFold: noteDurableSeq advances synthetic cursor past later durable seqs', () => {
  const fold = new AssistantStreamFold()
  fold.noteDurableSeq(5)
  fold.acceptFrame({ type: 'start', attemptId: 'a1', revision: 1, startedAfterSeq: 5, turn: 1, step: 1 })
  const [c1] = fold.acceptFrame({ type: 'chunk', attemptId: 'a1', revision: 1, index: 0, time: 6, chunk: { type: 'text-delta', index: 0, text: 'a' } })
  assert.ok(((c1?.seq as number) > 5) && ((c1?.seq as number) < 6))
  fold.noteDurableSeq(9)
  const [c2] = fold.acceptFrame({ type: 'chunk', attemptId: 'a1', revision: 1, index: 1, time: 10, chunk: { type: 'text-delta', index: 0, text: 'b' } })
  assert.ok(((c2?.seq as number) > 9) && ((c2?.seq as number) < 10))
})
