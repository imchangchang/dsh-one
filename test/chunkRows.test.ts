import { test } from 'node:test'
import assert from 'node:assert/strict'
import { expandChunkRow, recordsToEntries } from '../src/pure/chunkRows.ts'
import type { HistoryRecordLike } from '../src/pure/chunkRows.ts'

test('expands chunkrow/text-chunks into assistant/chunk text deltas', () => {
  const expanded = expandChunkRow({
    type: 'chunkrow/text-chunks',
    seq: 40,
    time: 1000,
    data: { turn: 1, step: 0, index: 0, dt: [10, 12], texts: ['你', '好', '！'] },
  })
  assert.deepEqual(expanded, [
    { type: 'assistant/chunk', seq: 40, time: 1000, data: { turn: 1, step: 0, chunk: { type: 'text-delta', index: 0, text: '你' } } },
    { type: 'assistant/chunk', seq: 41, time: 1010, data: { turn: 1, step: 0, chunk: { type: 'text-delta', index: 0, text: '好' } } },
    { type: 'assistant/chunk', seq: 42, time: 1022, data: { turn: 1, step: 0, chunk: { type: 'text-delta', index: 0, text: '！' } } },
  ])
})

test('expands chunkrow/tool-call-chunks including name and id echo', () => {
  const expanded = expandChunkRow({
    type: 'chunkrow/tool-call-chunks',
    seq: 7,
    time: 500,
    data: { turn: 2, step: 1, index: 1, dt: [], id: 'call-1', name: 'bash', args: ['ls ', '-la'] },
  })
  assert.deepEqual(expanded?.map((e) => e.data), [
    { turn: 2, step: 1, chunk: { type: 'tool-call-delta', index: 1, id: 'call-1', name: 'bash', argumentsDelta: 'ls ' } },
    { turn: 2, step: 1, chunk: { type: 'tool-call-delta', index: 1, id: 'call-1', name: 'bash', argumentsDelta: '-la' } },
  ])
})

test('non-chunkrow events are not expanded', () => {
  assert.equal(expandChunkRow({ type: 'user/message', seq: 1, data: {} }), null)
})

test('recordsToEntries expands packed rows and passes scalar events', () => {
  const records: HistoryRecordLike[] = [
    { type: 'event', event: { type: 'user/message', seq: 1, data: {} } },
    { type: 'chunks', event: { type: 'chunkrow/text-chunks', seq: 2, time: 10, data: { turn: 0, step: 0, index: 0, dt: [1], texts: ['a', 'b'] } } },
  ]
  const entries = recordsToEntries(records)
  assert.equal(entries.length, 3)
  assert.equal(entries[0].event.type, 'user/message')
  assert.equal(entries[1].event.type, 'assistant/chunk')
  assert.equal(entries[1].event.seq, 2)
  assert.equal(entries[2].event.seq, 3)
})
