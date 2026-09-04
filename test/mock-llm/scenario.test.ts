import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultScenario, type MockRule, type MockRuleContext } from './scenario.ts'

test('defaultScenario：声明模型 id + 规则集（回显/tool_calls/401/工具编排），顺序即优先级', () => {
  const sc = defaultScenario()
  assert.ok(sc.models.some((m) => m.id === 'mock-llm'))
  assert.ok(sc.models.some((m) => m.id === 'mock-flash'))
  // 顺序决定优先级：具体规则在前，兜底 '*' 一定在最后。
  assert.deepEqual(sc.rules[0].match, { contains: '查天气' })
  assert.equal(sc.rules[sc.rules.length - 1].match, '*')
  // 工具编排规则都在兜底之前。
  const has = (s: string) =>
    sc.rules.some((r) => typeof r.match === 'object' && (r.match as { contains?: string }).contains === s)
  for (const k of ['审批测试', '提个问题', '派个子代理', '开两个后台任务', '401']) {
    assert.ok(has(k), `缺少规则: ${k}`)
  }
})

test('defaultScenario：查天气规则返回 get_weather 工具调用（arguments 是 JSON 串）', () => {
  const rule = defaultScenario().rules[0]
  assert.ok(rule.respond.toolCalls)
  assert.equal(rule.respond.toolCalls![0].id, 'call-weather')
  assert.equal(rule.respond.toolCalls![0].name, 'get_weather')
  assert.equal(rule.respond.toolCalls![0].arguments, '{"city":"上海"}')
})

test('defaultScenario：401 规则注入 HTTP 错误', () => {
  const rule = defaultScenario().rules.find((r) => (r.match as { contains?: string }).contains === '401')!
  assert.deepEqual(rule.respond.error, { status: 401, message: 'invalid api key' })
})

test('defaultScenario：兜底回显规则把最后一条消息包进「收到：…」（content 函数求值）', () => {
  const echo = defaultScenario().rules.find((r) => r.match === '*') as MockRule
  assert.equal(typeof echo.respond.content, 'function')
  const out = (echo.respond.content as (ctx: MockRuleContext) => string[])({
    lastUserMessage: '你好',
    model: 'mock-llm',
    request: {},
  })
  assert.deepEqual(out, ['收到：', '你好'])
})
