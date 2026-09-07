import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseTagBridgeRequest, parseTagBridgeRecord } from '../src/pure/tagBridgeCore.ts'

test('assign: accepts {action, sessionIds, group} and trims the group', () => {
  const r = parseTagBridgeRequest({ action: 'assign', group: '  2026-09 批量  ', sessionIds: ['s-1', 's-2'] })
  assert.deepEqual(r, { ok: true, value: { action: 'assign', group: '2026-09 批量', sessionIds: ['s-1', 's-2'] } })
})

test('assign: accepts {action, sessionIds, tagId} and trims the tagId', () => {
  const r = parseTagBridgeRequest({ action: 'assign', tagId: ' t-9 ', sessionIds: ['s-1'] })
  assert.deepEqual(r, { ok: true, value: { action: 'assign', tagId: 't-9', sessionIds: ['s-1'] } })
})

test('assign: rejects both group and tagId, or neither (ambiguous-target)', () => {
  const both = { action: 'assign', group: 'g', tagId: 't', sessionIds: ['s'] }
  assert.deepEqual(parseTagBridgeRequest(both), { ok: false, error: 'ambiguous-target' })
  const neither = { action: 'assign', sessionIds: ['s'] }
  assert.deepEqual(parseTagBridgeRequest(neither), { ok: false, error: 'ambiguous-target' })
})

test('get: accepts {action, sessionId} and trims; rejects empty', () => {
  assert.deepEqual(parseTagBridgeRequest({ action: 'get', sessionId: ' s1 ' }), {
    ok: true,
    value: { action: 'get', sessionId: 's1' },
  })
  assert.deepEqual(parseTagBridgeRequest({ action: 'get', sessionId: '' }), { ok: false, error: 'empty-session-id' })
  assert.deepEqual(parseTagBridgeRequest({ action: 'get' }), { ok: false, error: 'empty-session-id' })
})

test('unassign: accepts {action, sessionIds}; rejects empty/non-array', () => {
  assert.deepEqual(parseTagBridgeRequest({ action: 'unassign', sessionIds: ['s1', 's2'] }), {
    ok: true,
    value: { action: 'unassign', sessionIds: ['s1', 's2'] },
  })
  assert.deepEqual(parseTagBridgeRequest({ action: 'unassign', sessionIds: [] }), { ok: false, error: 'no-sessions' })
  assert.deepEqual(parseTagBridgeRequest({ action: 'unassign', sessionIds: [1] }), { ok: false, error: 'bad-session-ids' })
})

test('rejects missing / unknown action', () => {
  assert.deepEqual(parseTagBridgeRequest({ group: 'g', sessionIds: ['s'] }), { ok: false, error: 'bad-action' })
  assert.deepEqual(parseTagBridgeRequest({ action: 'drop', sessionIds: ['s'] }), { ok: false, error: 'bad-action' })
  assert.deepEqual(parseTagBridgeRequest({ action: 5, sessionIds: ['s'] }), { ok: false, error: 'bad-action' })
})

test('rejects non-objects (null/array/string/number)', () => {
  for (const bad of [null, undefined, [], 'x', 7, true]) {
    assert.deepEqual(parseTagBridgeRequest(bad), { ok: false, error: 'bad-request' })
  }
})

test('rejects bad sessionIds across assign/unassign', () => {
  for (const action of ['assign', 'unassign'] as const) {
    assert.deepEqual(parseTagBridgeRequest({ action, group: 'g', sessionIds: ['a', 5] }), { ok: false, error: 'bad-session-ids' })
    assert.deepEqual(parseTagBridgeRequest({ action, group: 'g', sessionIds: ['a', ''] }), { ok: false, error: 'bad-session-ids' })
    assert.deepEqual(parseTagBridgeRequest({ action, group: 'g', sessionIds: 'a' }), { ok: false, error: 'bad-session-ids' })
    assert.deepEqual(parseTagBridgeRequest({ action, group: 'g' }), { ok: false, error: 'bad-session-ids' })
  }
})

test('parseTagBridgeRecord: roundtrip a valid {port, token}', () => {
  assert.deepEqual(parseTagBridgeRecord({ port: 47812, token: 'abc.def' }), { port: 47812, token: 'abc.def' })
})

test('parseTagBridgeRecord: rejects missing/invalid port/token', () => {
  assert.equal(parseTagBridgeRecord(null), null)
  assert.equal(parseTagBridgeRecord([]), null)
  assert.equal(parseTagBridgeRecord({ port: 0, token: 't' }), null)
  assert.equal(parseTagBridgeRecord({ port: -1, token: 't' }), null)
  assert.equal(parseTagBridgeRecord({ port: 70000, token: 't' }), null)
  assert.equal(parseTagBridgeRecord({ port: 47812, token: '' }), null)
  assert.equal(parseTagBridgeRecord({ port: 47812 }), null)
  assert.equal(parseTagBridgeRecord({ token: 't' }), null)
  assert.equal(parseTagBridgeRecord({ port: '47812', token: 't' }), null)
})
