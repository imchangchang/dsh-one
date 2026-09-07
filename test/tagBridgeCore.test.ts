import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseTagBridgeRequest, parseTagBridgeRecord } from '../src/pure/tagBridgeCore.ts'

test('parseTagBridgeRequest: accepts the exact {group, sessionIds} shape and trims the group', () => {
  const r = parseTagBridgeRequest({ group: '  2026-09 批量  ', sessionIds: ['s-1', 's-2'] })
  assert.deepEqual(r, { ok: true, value: { group: '2026-09 批量', sessionIds: ['s-1', 's-2'] } })
})

test('parseTagBridgeRequest: rejects non-objects (null/array/string/number)', () => {
  for (const bad of [null, undefined, [], 'x', 7, true]) {
    assert.deepEqual(parseTagBridgeRequest(bad), { ok: false, error: 'bad-request' })
  }
})

test('parseTagBridgeRequest: rejects empty / non-string / untrimmed group', () => {
  assert.deepEqual(parseTagBridgeRequest({ group: '', sessionIds: ['a'] }), { ok: false, error: 'empty-group' })
  assert.deepEqual(parseTagBridgeRequest({ group: '   ', sessionIds: ['a'] }), { ok: false, error: 'empty-group' })
  assert.deepEqual(parseTagBridgeRequest({ sessionIds: ['a'] }), { ok: false, error: 'empty-group' })
  assert.deepEqual(parseTagBridgeRequest({ group: 5, sessionIds: ['a'] }), { ok: false, error: 'empty-group' })
})

test('parseTagBridgeRequest: rejects missing/loose sessionIds types', () => {
  assert.deepEqual(parseTagBridgeRequest({ group: 'g', sessionIds: ['a', 5] }), { ok: false, error: 'bad-session-ids' })
  assert.deepEqual(parseTagBridgeRequest({ group: 'g', sessionIds: ['a', ''] }), { ok: false, error: 'bad-session-ids' })
  assert.deepEqual(parseTagBridgeRequest({ group: 'g', sessionIds: 'a' }), { ok: false, error: 'bad-session-ids' })
  assert.deepEqual(parseTagBridgeRequest({ group: 'g' }), { ok: false, error: 'bad-session-ids' })
})

test('parseTagBridgeRequest: rejects empty sessionIds list', () => {
  assert.deepEqual(parseTagBridgeRequest({ group: 'g', sessionIds: [] }), { ok: false, error: 'no-sessions' })
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
