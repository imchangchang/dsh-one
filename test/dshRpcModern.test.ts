import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callRpc, sessionModels } from '../src/server/dshRpc.ts'
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
  assert.equal((call.init.headers as Record<string, string> | undefined)?.['cookie'], undefined)
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

/** 0.1.2 host 形状（与真实 session/modelCatalog + session/list projection 一致）。 */
const CATALOG_VALUE = {
  default: { provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp', reasoningEffort: 'max' },
  routableProviders: ['deepseek-official'],
  groups: [
    {
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        {
          id: 'deepseek-v4-flash-vision-exp',
          name: 'DeepSeek-V4-Flash-Vision-Exp',
          reasoning: { efforts: [{ id: 'max', name: 'Max' }], defaultEffort: 'high' },
        },
      ],
    },
  ],
  failures: [],
}
const SELECTED = { provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp', reasoningEffort: 'max' }

/** Stub fetch 按 URL 分派：modelCatalog 返回 CATALOG_VALUE，session/list 返回给定 modelSelection 的一行。 */
function stubSessionModels(modelSelection: unknown): void {
  captured.length = 0
  // @ts-expect-error test-only stubbing of the global fetch
  globalThis.fetch = (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { rpcId: string }
    const catalog = String(url).endsWith('/api/session/modelCatalog')
    const value = catalog
      ? CATALOG_VALUE
      : {
          items: [
            { sessionId: 's1', updatedAt: 1, running: false, blank: false, projections: { asOfSeq: 1, values: { modelSelection } } },
          ],
        }
    return Promise.resolve(
      new Response(JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value } })),
    )
  }
}

test('sessionModels (0.1.2): modelSelection is folded {lastUsed,next}; next wins', async () => {
  registerAuth('http://127.0.0.1:9999', { cookie: 'dsh-auth-x=v1.y.z', authority: '127.0.0.1:9999' })
  stubSessionModels({
    lastUsed: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
    next: SELECTED,
  })
  const models = await sessionModels('http://127.0.0.1:9999', 's1')
  // 0.1.2 旧解析（占位回归的根因）：把整个 {lastUsed,next} 当 SessionModelSelection，
  // current.provider/model 都是 undefined → modelLabelOf 拿不到 label。
  assert.deepEqual(models.current, SELECTED)
  clearAuth('http://127.0.0.1:9999')
})

test('sessionModels (0.1.2): falls back to lastUsed when next is absent, then catalog.default', async () => {
  registerAuth('http://127.0.0.1:9999', { cookie: 'dsh-auth-x=v1.y.z', authority: '127.0.0.1:9999' })

  stubSessionModels({ lastUsed: SELECTED, next: null })
  assert.deepEqual((await sessionModels('http://127.0.0.1:9999', 's1')).current, SELECTED)

  stubSessionModels({ lastUsed: null, next: null }) // blank 会话
  assert.deepEqual((await sessionModels('http://127.0.0.1:9999', 's1')).current, CATALOG_VALUE.default)

  stubSessionModels(undefined) // 老会话无该投影
  assert.deepEqual((await sessionModels('http://127.0.0.1:9999', 's1')).current, CATALOG_VALUE.default)

  stubSessionModels({ lastUsed: 'malformed', next: undefined }) // 防御：畸形值回退 default
  assert.deepEqual((await sessionModels('http://127.0.0.1:9999', 's1')).current, CATALOG_VALUE.default)
  clearAuth('http://127.0.0.1:9999')
})

test('sessionAgentPreset: dsh 0.1.2 从 projections.values 读，顶层字段作旧服务端回退', async () => {
  const { sessionAgentPreset } = await import('../src/server/dshRpc.ts')
  const base = { sessionId: 's1', updatedAt: 0, running: false, blank: false }
  // 0.1.2 形态：顶层缺省，投影里是字符串 id
  assert.equal(
    sessionAgentPreset({ ...base, projections: { asOfSeq: 1, values: { agentPreset: 'kimi' } } }),
    'kimi',
  )
  // 旧服务端形态：顶层字段
  assert.equal(sessionAgentPreset({ ...base, agentPreset: 'standard' }), 'standard')
  // 顶层优先（两源并存时与旧行为一致）
  assert.equal(
    sessionAgentPreset({ ...base, agentPreset: 'standard', projections: { asOfSeq: 1, values: { agentPreset: 'kimi' } } }),
    'standard',
  )
  // 都没有 / 非字符串 / 空串 → undefined（头部不渲染 chip）
  assert.equal(sessionAgentPreset(base), undefined)
  assert.equal(sessionAgentPreset({ ...base, projections: { asOfSeq: 1, values: { agentPreset: 3 } } }), undefined)
  assert.equal(sessionAgentPreset({ ...base, agentPreset: '' }), undefined)
})
