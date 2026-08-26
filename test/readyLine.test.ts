import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseReadyLine } from '../src/pure/readyLine.ts'

test('parses the readiness line', () => {
  assert.deepEqual(parseReadyLine('dsh web: http://127.0.0.1:3080\n'), {
    url: 'http://127.0.0.1:3080',
    port: 3080,
  })
})

test('parses the line embedded in noisier output', () => {
  const chunk = '[info] starting gateway...\ndsh web: http://127.0.0.1:49152\n[info] done\n'
  assert.deepEqual(parseReadyLine(chunk), { url: 'http://127.0.0.1:49152', port: 49152 })
})

test('returns null for unrelated output', () => {
  assert.equal(parseReadyLine('listening on 3080'), null)
  assert.equal(parseReadyLine(''), null)
  // different host must not match — we only trust loopback URLs
  assert.equal(parseReadyLine('dsh web: http://0.0.0.0:3080'), null)
  assert.equal(parseReadyLine('dsh web: http://localhost:3080'), null)
})
