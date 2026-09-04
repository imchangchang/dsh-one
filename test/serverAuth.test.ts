import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  exchangeToken,
  probeToken,
  registerAuth,
  clearAuth,
  getAuth,
  cookieHeader,
  isModern,
} from '../src/server/serverAuth.ts'

function stubFetch(
  impl: (url: string, init: RequestInit | undefined) => Response,
): void {
  // @ts-expect-error test-only stubbing of the global fetch
  globalThis.fetch = (url: string, init: RequestInit | undefined) => Promise.resolve(impl(url, init))
}

const noopLogger = { info: () => {}, warn: () => {}, error: () => {} } as never

test('exchangeToken registers the cookie from the 303 Set-Cookie', async () => {
  clearAuth('http://127.0.0.1:62433')
  stubFetch((url, init) => {
    assert.equal(url, 'http://127.0.0.1:62433/?token=TOKEN')
    assert.equal(init?.redirect, 'manual')
    return new Response(null, {
      status: 303,
      headers: {
        location: '/',
        'set-cookie':
          'dsh-auth-abc=v1.pay.load; Max-Age=2592000; Path=/; HttpOnly; SameSite=Strict',
      },
    })
  })
  const auth = await exchangeToken('http://127.0.0.1:62433', 'TOKEN', noopLogger)
  assert.deepEqual(auth, { cookie: 'dsh-auth-abc=v1.pay.load', authority: '127.0.0.1:62433', token: 'TOKEN' })
  assert.equal(isModern('http://127.0.0.1:62433'), true)
  assert.equal(cookieHeader('http://127.0.0.1:62433'), 'dsh-auth-abc=v1.pay.load')
})

test('exchangeToken rejects a 401 (wrong token) and a plain 200', async () => {
  clearAuth('http://127.0.0.1:62434')
  stubFetch(() => new Response('unauthorized', { status: 401 }))
  await assert.rejects(() => exchangeToken('http://127.0.0.1:62434', 'WRONG', noopLogger), /HTTP 401/)
  stubFetch(() => new Response('index html', { status: 200 }))
  await assert.rejects(() => exchangeToken('http://127.0.0.1:62434', 'X', noopLogger), /HTTP 200/)
  assert.equal(isModern('http://127.0.0.1:62434'), false)
})

test('probeToken returns null instead of throwing', async () => {
  stubFetch(() => new Response('unauthorized', { status: 401 }))
  const auth = await probeToken('http://127.0.0.1:62435', 'WRONG', noopLogger)
  assert.equal(auth, null)
})

test('registerAuth/getAuth/clearAuth lifecycle', () => {
  registerAuth('http://127.0.0.1:62436', { cookie: 'c=v', authority: '127.0.0.1:62436' })
  assert.deepEqual(getAuth('http://127.0.0.1:62436'), { cookie: 'c=v', authority: '127.0.0.1:62436' })
  clearAuth('http://127.0.0.1:62436')
  assert.equal(getAuth('http://127.0.0.1:62436'), null)
  assert.equal(isModern('http://127.0.0.1:62436'), false)
})
