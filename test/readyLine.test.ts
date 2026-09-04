import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseReadyLine, sanitizeReadyUrl } from '../src/pure/readyLine.ts'

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

test('parses the URL with the dsh 0.1.2 launch token', () => {
  const line = 'dsh web: http://127.0.0.1:62433/?token=NIUZqCBoSHIYS5B1ru-YjuqM7A2I6qwY2xtJ0cLcJxM\n'
  assert.deepEqual(parseReadyLine(line), {
    url: 'http://127.0.0.1:62433/',
    port: 62433,
    token: 'NIUZqCBoSHIYS5B1ru-YjuqM7A2I6qwY2xtJ0cLcJxM',
  })
  // trailing (LAN: …) 后缀不影响首个 URL 的解析。
  const withLan = `${line.trim()} (LAN: http://192.168.1.2:62433/?token=other-token)\n`
  assert.deepEqual(parseReadyLine(withLan), {
    url: 'http://127.0.0.1:62433/',
    port: 62433,
    token: 'NIUZqCBoSHIYS5B1ru-YjuqM7A2I6qwY2xtJ0cLcJxM',
  })
})

test('returns null for unrelated output', () => {
  assert.equal(parseReadyLine('listening on 3080'), null)
  assert.equal(parseReadyLine(''), null)
  // different host must not match — we only trust loopback URLs
  assert.equal(parseReadyLine('dsh web: http://0.0.0.0:3080'), null)
  assert.equal(parseReadyLine('dsh web: http://localhost:3080'), null)
})

test('sanitizeReadyUrl never leaks the token', () => {
  const url = 'http://127.0.0.1:62433/?token=SECRETTOKEN&x=1'
  assert.equal(sanitizeReadyUrl(url), 'http://127.0.0.1:62433/?token=***&x=1')
  assert.equal(sanitizeReadyUrl('http://127.0.0.1:3080'), 'http://127.0.0.1:3080')
  assert.ok(!sanitizeReadyUrl(url).includes('SECRETTOKEN'))
})
