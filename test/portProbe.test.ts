import { test } from 'node:test'
import assert from 'node:assert/strict'
import { probePort, probeDsh } from '../src/server/portProbe.ts'

const noopLogger = { info: () => {}, warn: () => {}, error: () => {} } as never

function stubFetch(impl: (url: string, init: RequestInit | undefined) => Response): void {
  // @ts-expect-error test-only stubbing of the global fetch
  globalThis.fetch = (url: string, init: RequestInit | undefined) => Promise.resolve(impl(url, init))
}

test('probePort: 401 + `unauthorized` body → authDsh (认证 dsh 无凭证指纹)', async () => {
  stubFetch(() => new Response('unauthorized', { status: 401 }))
  assert.equal(await probePort(3080, noopLogger), 'authDsh')
})

test('probePort: 401 with a foreign body (no dsh fingerprint) → foreign', async () => {
  stubFetch(() => new Response('Forbidden by nginx', { status: 401 }))
  assert.equal(await probePort(3080, noopLogger), 'foreign')
})

/** 响应体回显请求体里的 rpcId（probePort 内部生成随机 rpcId，测试无法预知）。 */
function echoBody(init: RequestInit | undefined): Response {
  const req = JSON.parse(init?.body as string) as { rpcId: string }
  return new Response(
    JSON.stringify({ type: 'server-response', rpcId: req.rpcId, result: { ok: true, value: {} } }),
    { status: 200 },
  )
}

test('probePort: rpcId echo → dsh; bad echo → foreign; no response → down', async () => {
  stubFetch((_url, init) => echoBody(init))
  assert.equal(await probePort(3080, noopLogger), 'dsh')
  stubFetch(() => new Response('{"rpcId":"other"}', { status: 200 }))
  assert.equal(await probePort(3080, noopLogger), 'foreign')
  stubFetch(() => {
    throw new TypeError('fetch failed')
  })
  assert.equal(await probePort(3080, noopLogger), 'down')
})

test('probePort sends the host.describe envelope as POST with a timeout signal', async () => {
  stubFetch((url, init) => {
    assert.equal(url, 'http://127.0.0.1:3080/api/host.describe')
    assert.equal(init?.method, 'POST')
    assert.equal(init?.headers && (init.headers as Record<string, string>)['content-type'], 'application/json')
    assert.ok(init?.signal)
    const body = JSON.parse(init?.body as string) as { type: string; method: string; payload: unknown }
    assert.equal(body.type, 'client-request')
    assert.equal(body.method, 'host.describe')
    return echoBody(init)
  })
  assert.equal(await probePort(3080, noopLogger), 'dsh')
})

test('probeDsh: returns the base URL only for an unauthenticated dsh', async () => {
  stubFetch((_url, init) => echoBody(init))
  assert.equal(await probeDsh(3080, noopLogger), 'http://127.0.0.1:3080')
  stubFetch(() => new Response('unauthorized', { status: 401 }))
  assert.equal(await probeDsh(3080, noopLogger), null)
})
