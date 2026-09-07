import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseMuxServerFrame,
  parseEventStreamReady,
  parseEventStreamFrame,
  parseControlStreamFrame,
  parseWorkspaceStreamFrame,
  parseFollowStreamFrame,
} from '../src/pure/remoteFrames.ts'

test('parses mux frames: item / end / error', () => {
  assert.deepEqual(parseMuxServerFrame('{"type":"item","streamId":"s1","value":{"a":1}}'), {
    type: 'item',
    streamId: 's1',
    value: { a: 1 },
  })
  assert.deepEqual(parseMuxServerFrame('{"type":"item","streamId":"s1"}'), { type: 'item', streamId: 's1' })
  assert.deepEqual(parseMuxServerFrame('{"type":"end","streamId":"s1"}'), { type: 'end', streamId: 's1' })
  assert.deepEqual(parseMuxServerFrame('{"type":"error","streamId":"s1","error":{"code":"x","message":"boom","details":{}}}'), {
    type: 'error',
    streamId: 's1',
    error: { code: 'x', message: 'boom', details: {} },
  })
  assert.equal(parseMuxServerFrame('not json'), null)
  assert.equal(parseMuxServerFrame('{"type":"unknown","streamId":"s1"}'), null)
})

test('$events ready frame carries clientId and host', () => {
  assert.deepEqual(
    parseEventStreamReady({ type: 'ready', clientId: 'c-1', host: { home: '/home/u' } }),
    { clientId: 'c-1', host: { home: '/home/u' } },
  )
  assert.equal(parseEventStreamReady({ type: 'ready' }), null)
})

test('$events frames: emit / waterfall / cancel', () => {
  assert.deepEqual(parseEventStreamFrame({ type: 'emit', event: 'api-session/status', args: ['s1', true] }), {
    type: 'emit',
    event: 'api-session/status',
    args: ['s1', true],
  })
  assert.deepEqual(
    parseEventStreamFrame({
      type: 'waterfall',
      event: 'approval/request',
      eventId: 'e1',
      agentId: 's1',
      request: { toolName: 'bash' },
    }),
    { type: 'waterfall', event: 'approval/request', eventId: 'e1', agentId: 's1', request: { toolName: 'bash' } },
  )
  assert.deepEqual(parseEventStreamFrame({ type: 'cancel', eventId: 'e1' }), { type: 'cancel', eventId: 'e1' })
})

test('session/control frames', () => {
  assert.deepEqual(parseControlStreamFrame({ type: 'jobs', sessionId: 's1', jobs: [{ id: 'j' }] }), {
    type: 'jobs',
    sessionId: 's1',
    jobs: [{ id: 'j' }],
  })
  assert.deepEqual(parseControlStreamFrame({ type: 'baseline', value: { queues: {}, jobs: {}, projections: {} } }), {
    type: 'baseline',
    value: { queues: {}, jobs: {}, projections: {} },
  })
  assert.deepEqual(parseControlStreamFrame({ type: 'projection', sessionId: 's1', key: 'title', value: 'x', seq: 9 }), {
    type: 'projection',
    sessionId: 's1',
    key: 'title',
    value: 'x',
    seq: 9,
  })
})

test('workspace/follow frames', () => {
  assert.deepEqual(parseWorkspaceStreamFrame({ type: 'baseline', value: { items: [{ workspaceId: 'w1' }], archivedSessionIds: ['s9'] } }), {
    type: 'baseline',
    items: [{ workspaceId: 'w1' }],
    archivedSessionIds: ['s9'],
  })
  assert.deepEqual(parseWorkspaceStreamFrame({ type: 'upsert', workspace: { workspaceId: 'w1' } }), {
    type: 'upsert',
    workspace: { workspaceId: 'w1' },
  })
  assert.deepEqual(parseWorkspaceStreamFrame({ type: 'remove', workspaceId: 'w1' }), { type: 'remove', workspaceId: 'w1' })
  assert.deepEqual(parseWorkspaceStreamFrame({ type: 'order', workspaceIds: ['w2', 'w1'] }), { type: 'order', workspaceIds: ['w2', 'w1'] })
  assert.deepEqual(parseWorkspaceStreamFrame({ type: 'archived', archivedSessionIds: ['s9'] }), { type: 'archived', archivedSessionIds: ['s9'] })
})

test('session/follow frames: snapshot and events', () => {
  const snapshot = parseFollowStreamFrame({
    type: 'snapshot',
    cursor: 42,
    records: [{ type: 'event', event: { type: 'user/message', seq: 1 } }],
    hasMore: true,
    header: { id: 's1' },
    projections: { asOfSeq: 42, values: {} },
  })
  assert.equal(snapshot?.type, 'snapshot')
  if (snapshot?.type === 'snapshot') {
    assert.equal(snapshot.cursor, 42)
    assert.equal(snapshot.hasMore, true)
  }
  assert.deepEqual(parseFollowStreamFrame({ type: 'event', event: { type: 'assistant/chunk', seq: 43 } }), {
    type: 'event',
    event: { type: 'assistant/chunk', seq: 43 },
  })
})

test('session/follow frames: 0.1.3 assistant-stream frame and snapshot assistantStream baseline', () => {
  const snap = parseFollowStreamFrame({
    type: 'snapshot',
    cursor: 9,
    records: [],
    hasMore: false,
    header: { version: 2, isSeeded: false },
    projections: { asOfSeq: 9, values: {} },
    assistantStream: { revision: 3, activeAttempt: { attemptId: 'a1', startedAfterSeq: 1, turn: 1, step: 1, nextIndex: 2, stream: [] } },
  })
  assert.equal(snap?.type, 'snapshot')
  if (snap?.type === 'snapshot') {
    assert.ok(snap.assistantStream && typeof snap.assistantStream.revision === 'number')
    assert.equal(snap.assistantStream.activeAttempt?.attemptId, 'a1')
  }
  // snapshot without assistantStream → field absent
  const plain = parseFollowStreamFrame({ type: 'snapshot', cursor: 0, records: [], hasMore: false, header: {}, projections: {} })
  if (plain?.type === 'snapshot') assert.equal(plain.assistantStream, undefined)

  const live = parseFollowStreamFrame({ type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'a1', revision: 3, index: 0, time: 11, chunk: { type: 'text-delta', index: 0, text: 'hi' } } })
  assert.equal(live?.type, 'assistant-stream')
  if (live?.type === 'assistant-stream') {
    assert.equal(live.frame.type, 'chunk')
  }
  assert.deepEqual(parseFollowStreamFrame({ type: 'assistant-stream', frame: { type: 'bogus' } }), null)
})
