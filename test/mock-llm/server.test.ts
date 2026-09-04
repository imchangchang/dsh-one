import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMockLlm, type MockLlm } from './server.ts'
import type { MockLlmScenario } from './scenario.ts'

let mock: MockLlm

test.before(async () => {
  mock = await createMockLlm()
  await mock.listen(0)
})

test.after(async () => {
  await mock.close()
})

async function postChat(m: MockLlm, body: Record<string, unknown>): Promise<Response> {
  return fetch(m.url + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

interface ParsedSse {
  chunks: any[]
  done: boolean
  finish: string | null
  content: string
  /** 按 index 还原后的工具参数 JSON 串。 */
  toolArgs: string[]
  /** 实际收到的 arguments 分片个数（证明分片确实发生了）。 */
  argFragments: number
}

/** 解析 SSE 文本：剥出 data 行，重组 content / tool_calls 参数 / finish_reason。 */
function parseSse(text: string): ParsedSse {
  const dataLines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('data: '))
    .map((l) => l.slice('data: '.length))
  const done = dataLines.some((l) => l.trim() === '[DONE]')
  const chunks = dataLines.filter((l) => l.trim() !== '[DONE]').map((l) => JSON.parse(l))

  let content = ''
  let finish: string | null = null
  const toolArgs: string[] = []
  let argFragments = 0
  for (const c of chunks) {
    const choice = c.choices?.[0]
    if (!choice) continue
    if (typeof choice.finish_reason === 'string') finish = choice.finish_reason
    const delta = choice.delta ?? {}
    if (typeof delta.content === 'string') content += delta.content
    const tcs = delta.tool_calls
    if (Array.isArray(tcs)) {
      for (const tc of tcs) {
        const idx = typeof tc.index === 'number' ? tc.index : 0
        const args = tc.function?.arguments
        if (typeof args === 'string') {
          argFragments++
          toolArgs[idx] = (toolArgs[idx] ?? '') + args
        }
      }
    }
  }
  return { chunks, done, finish, content, toolArgs, argFragments }
}

// ---------------------------------------------------------------------------
// stream:true —— SSE
// ---------------------------------------------------------------------------

test('stream:true 回显：两段 delta 拼成「收到：你好」，末尾 finish stop + data:[DONE]', async () => {
  const res = await postChat(mock, { model: 'mock-llm', messages: [{ role: 'user', content: '你好' }], stream: true })
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/)
  const parsed = parseSse(await res.text())
  assert.equal(parsed.done, true)
  assert.equal(parsed.finish, 'stop')
  assert.equal(parsed.content, '收到：你好')
  // 2 个 content delta + 1 个 finish 块（空 delta + stop）。
  assert.equal(parsed.chunks.length, 3)
  // 首个 delta 带 role，后续只带 content。
  assert.equal(parsed.chunks[0].choices[0].delta.role, 'assistant')
  assert.equal(parsed.chunks[0].choices[0].delta.content, '收到：')
  assert.equal(parsed.chunks[1].choices[0].delta.role, undefined)
  assert.equal(parsed.chunks[1].choices[0].delta.content, '你好')
})

test('stream:true tool_calls：arguments 分片拼接还原，finish tool_calls + [DONE]', async () => {
  const res = await postChat(mock, { model: 'mock-llm', messages: [{ role: 'user', content: '查天气' }], stream: true })
  assert.equal(res.status, 200)
  const parsed = parseSse(await res.text())
  assert.equal(parsed.done, true)
  assert.equal(parsed.finish, 'tool_calls')
  // 参数分片确实发生了（>1 段），且拼接后还原完整 JSON。
  assert.ok(parsed.argFragments > 1, `expected fragmented args, got ${parsed.argFragments} fragment(s)`)
  assert.equal(parsed.toolArgs[0], '{"city":"上海"}')
  // 首个 tool_call 块带 id/name；后续块只补 arguments。
  const firstTc = parsed.chunks[0].choices[0].delta.tool_calls[0]
  assert.equal(firstTc.id, 'call-weather')
  assert.equal(firstTc.function.name, 'get_weather')
  // 末尾 finish 块声明 usage（规则里带了 usage）。
  const last = parsed.chunks[parsed.chunks.length - 1]
  assert.equal(last.choices[0].finish_reason, 'tool_calls')
})

// ---------------------------------------------------------------------------
// stream:false —— JSON
// ---------------------------------------------------------------------------

test('stream:false 回显：整段 JSON content 直接返回', async () => {
  const res = await postChat(mock, { model: 'mock-llm', messages: [{ role: 'user', content: '你好' }] })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.object, 'chat.completion')
  assert.equal(body.choices[0].message.role, 'assistant')
  assert.equal(body.choices[0].message.content, '收到：你好')
  assert.equal(body.choices[0].finish_reason, 'stop')
})

test('stream:false tool_calls：message 带 tool_calls + content null + usage', async () => {
  const res = await postChat(mock, { model: 'mock-llm', messages: [{ role: 'user', content: '查天气' }] })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.choices[0].message.content, null)
  assert.equal(body.choices[0].finish_reason, 'tool_calls')
  const tc = body.choices[0].message.tool_calls[0]
  assert.equal(tc.id, 'call-weather')
  assert.equal(tc.type, 'function')
  assert.equal(tc.function.name, 'get_weather')
  assert.equal(tc.function.arguments, '{"city":"上海"}')
  assert.deepEqual(body.usage, { promptTokens: 10, completionTokens: 20, totalTokens: 30 })
})

// ---------------------------------------------------------------------------
// 错误注入 / 鉴权 / 模型目录
// ---------------------------------------------------------------------------

test('规则注入 401：HTTP 401 + OpenAI 风格 error 结构', async () => {
  const res = await postChat(mock, { model: 'mock-llm', messages: [{ role: 'user', content: '401' }] })
  assert.equal(res.status, 401)
  const body = await res.json()
  assert.equal(body.error.message, 'invalid api key')
  assert.equal(body.error.type, 'authentication_error')
  assert.equal(body.error.code, '401')
})

test('Authorization 头不校验：带了 key 也照常回', async () => {
  const res = await fetch(mock.url + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer secret-key' },
    body: JSON.stringify({ model: 'mock-llm', messages: [{ role: 'user', content: '你好' }] }),
  })
  assert.equal(res.status, 200)
  assert.equal((await res.json()).choices[0].message.content, '收到：你好')
})

test('GET /v1/models：列出场景声明的模型 id（object=list / data 每项 object=model）', async () => {
  const res = await fetch(mock.url + '/v1/models')
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.object, 'list')
  assert.ok(Array.isArray(body.data))
  const ids = body.data.map((m: { id: string }) => m.id)
  assert.ok(ids.includes('mock-flash'), '沙盒 settings.yaml 声明的模型必须在列表中')
  assert.ok(ids.includes('mock-llm'))
  assert.equal(body.data[0].object, 'model')
})

// ---------------------------------------------------------------------------
// 规则匹配优先级 / 兜底 / 未知请求
// ---------------------------------------------------------------------------

test('规则匹配优先级：具体规则先于兜底命中（查天气→tool_calls，普通→回显）', async () => {
  let res = await postChat(mock, { model: 'mock-llm', messages: [{ role: 'user', content: '查天气' }] })
  let body = await res.json()
  assert.ok(body.choices[0].message.tool_calls)
  assert.equal(body.choices[0].message.content, null)

  res = await postChat(mock, { model: 'mock-llm', messages: [{ role: 'user', content: '随便聊聊' }] })
  body = await res.json()
  assert.equal(body.choices[0].message.content, '收到：随便聊聊')
  assert.equal(body.choices[0].message.tool_calls, undefined)
})

test('首轮注入过滤：两类注入（<system-reminder> 标签 / 无标签 runtime context）都不作为匹配对象', async () => {
  const tagged = '<system-reminder>\nA skill is a reusable set...\n</system-reminder>'
  const runtime =
    'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\nCurrent DSH file policy: workspace-write. ...'
  // 无标签 runtime context 在最后（dsh 实际顺序不稳定）：应取真正的 prompt「查天气」。
  let res = await postChat(mock, {
    model: 'mock-llm',
    messages: [
      { role: 'user', content: '查天气' },
      { role: 'user', content: runtime },
    ],
    stream: false,
  })
  let body = await res.json()
  assert.ok(body.choices[0].message.tool_calls, 'runtime context 在最后时应忽略，命中真实 prompt 的规则')

  // 标签注入 + 无标签注入混排，prompt 居中：仍命中。
  res = await postChat(mock, {
    model: 'mock-llm',
    messages: [
      { role: 'user', content: [{ type: 'text', text: tagged }] },
      { role: 'user', content: '随便聊聊' },
      { role: 'user', content: runtime },
    ],
    stream: false,
  })
  body = await res.json()
  assert.equal(body.choices[0].message.content, '收到：随便聊聊')

  // 只有注入：返回空文本 → 兜底 '*' 命中空字符串（dsh 标题生成这类场景）。
  res = await postChat(mock, {
    model: 'mock-llm',
    messages: [{ role: 'user', content: runtime }],
    stream: false,
  })
  body = await res.json()
  assert.ok(typeof body.choices[0].message.content === 'string')
})

test('自定义场景：regex 规则按正则命中', async () => {
  const sc: MockLlmScenario = {
    models: [{ id: 'm' }],
    rules: [{ match: { regex: '^/greet' }, respond: { content: 'greet 命令' } }],
  }
  const m = await createMockLlm({ scenario: sc })
  await m.listen(0)
  try {
    let res = await postChat(m, { model: 'm', messages: [{ role: 'user', content: '/greet bob' }] })
    assert.equal(res.status, 200)
    assert.equal((await res.json()).choices[0].message.content, 'greet 命令')
    // 不命中正则 → 无兜底规则 → 404。
    res = await postChat(m, { model: 'm', messages: [{ role: 'user', content: '其他内容' }] })
    assert.equal(res.status, 404)
  } finally {
    await m.close()
  }
})

test('无匹配场景：规则都不命中 → 404（dsh 当错误）', async () => {
  const sc: MockLlmScenario = {
    models: [{ id: 'm' }],
    rules: [{ match: { contains: 'x' }, respond: { content: 'x' } }],
  }
  const m = await createMockLlm({ scenario: sc })
  await m.listen(0)
  try {
    const res = await postChat(m, { model: 'm', messages: [{ role: 'user', content: '没有命中' }] })
    assert.equal(res.status, 404)
    const body = await res.json()
    assert.equal(body.error.code, 'missing_rule')
  } finally {
    await m.close()
  }
})

test('未知路径 → 404', async () => {
  const res = await fetch(mock.url + '/v1/whatever', { method: 'POST' })
  assert.equal(res.status, 404)
})
