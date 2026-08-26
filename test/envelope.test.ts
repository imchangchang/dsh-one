import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  makeDescribeRequest,
  isDshResponse,
  validateDescribeResponse,
} from '../src/pure/envelope.ts'

test('makeDescribeRequest builds the expected envelope', () => {
  assert.deepEqual(makeDescribeRequest('abc-123'), {
    type: 'client-request',
    rpcId: 'abc-123',
    method: 'host.describe',
    payload: {},
  })
})

test('isDshResponse requires the rpcId echo', () => {
  const rpcId = '11111111-2222-3333-4444-555555555555'
  assert.equal(isDshResponse({ type: 'server-response', rpcId, payload: {} }, rpcId), true)
  assert.equal(isDshResponse({ type: 'server-response', rpcId: 'other' }, rpcId), false)
  assert.equal(isDshResponse({ type: 'server-response' }, rpcId), false)
  assert.equal(isDshResponse(null, rpcId), false)
  assert.equal(isDshResponse('ok', rpcId), false)
  assert.equal(isDshResponse([{ rpcId }], rpcId), false)
})

test('validateDescribeResponse parses then validates', () => {
  const rpcId = 'r1'
  assert.equal(validateDescribeResponse(JSON.stringify({ rpcId }), rpcId), true)
  assert.equal(validateDescribeResponse(JSON.stringify({ rpcId: 'nope' }), rpcId), false)
  assert.equal(validateDescribeResponse('<html>not json</html>', rpcId), false)
  assert.equal(validateDescribeResponse('', rpcId), false)
})
