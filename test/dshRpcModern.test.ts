import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callRpc } from '../src/server/dshRpc.ts'
import { registerAuth, clearAuth } from '../src/server/serverAuth.ts'

interface Captured {
  url: string
  init: RequestInit
  body: { type: string; rpcId: string; method: string; payload: unknown }
}

/** Stub fetch: echoes the rpcId (succeeds with {ok:true, value:null}) and records the wire. */
const captured: Captured[] = []
function stubFetch(): void {
  captured.length = 0
  // @ts-expect-error test-only stubbing of the global fetch
  globalThis.fetch = (url: string, init: RequestInit) => {
    captured.push({ url, init, body: JSON.parse(String(init.body)) as Captured['body'] })
    return Promise.resolve(
      new Response(
        JSON.stringify({ type: 'server-response', rpcId: captured[captured.length - 1].body.rpcId, result: { ok: true, value: null } }),
      ),
    )
  }
}

test('legacy (0.1.1) wire is unchanged without auth registration', async () => {
  stubFetch()
  await callRpc('http://127.0.0.1:9999', 'session.list', {})
  const call = captured[0]
  assert.equal(call.url, 'http://127.0.0.1:9999/api/session.list')
  assert.deepEqual(call.body.payload, {})
  assert.equal(call.init.headers?.['cookie'], undefined)
})

test('modern (0.1.2) wire translates dot-methods and sends the cookie', async () => {
  registerAuth('http://127.0.0.1:9999', { cookie: 'dsh-auth-x=v1.y.z', authority: '127.0.0.1:9999' })
  stubFetch()

  await callRpc('http://127.0.0.1:9999', 'session.list', {})
  let call = captured[0]
  assert.equal(call.url, 'http://127.0.0.1:9999/api/session/list')
  assert.deepEqual(call.body.payload, { args: { _request: {} } })
  assert.equal((call.init.headers as Record<string, string>)['cookie'], 'dsh-auth-x=v1.y.z')

  await callRpc('http://127.0.0.1:9999', 'session.prompt', { sessionId: 's1', mode: 'queue', content: [] })
  call = captured[1]
  assert.equal(call.url, 'http://127.0.0.1:9999/api/session/prompt')
  const request = (call.body.payload as { args: { request: Record<string, unknown> } }).args.request
  assert.equal(request.sessionId, 's1')
  assert.equal(typeof request.requestId, 'string')

  await callRpc('http://127.0.0.1:9999', 'agentPreset.select', { sessionId: 's1', agentPreset: 'p1' })
  call = captured[2]
  assert.equal(call.url, 'http://127.0.0.1:9999/api/agentPresets/select')
  assert.deepEqual(call.body.payload, { args: { agentId: 's1', agentPreset: 'p1' } })

  clearAuth('http://127.0.0.1:9999')
})

test('modern slash-methods pass through with their args payload', async () => {
  registerAuth('http://127.0.0.1:9999', { cookie: 'dsh-auth-x=v1.y.z', authority: '127.0.0.1:9999' })
  stubFetch()
  const payload = { args: { agentId: 's1', query: 'x' } }
  await callRpc('http://127.0.0.1:9999', 'fileReferences/list', payload)
  const call = captured[0]
  assert.equal(call.url, 'http://127.0.0.1:9999/api/fileReferences/list')
  assert.deepEqual(call.body.payload, payload)
  clearAuth('http://127.0.0.1:9999')
})

test('unmapped dot-methods fail loudly on the modern wire', async () => {
  registerAuth('http://127.0.0.1:9999', { cookie: 'c=v', authority: '127.0.0.1:9999' })
  stubFetch()
  await assert.rejects(() => callRpc('http://127.0.0.1:9999', 'session.history', {}), /no dsh 0\.1\.2 wire mapping/)
  clearAuth('http://127.0.0.1:9999')
})
