import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agentPresetDescription, agentPresetLabel, defaultAgentPresetId, resolveAgentPresets, type AgentPresetLike } from '../src/pure/agentPreset.ts'

const preset = (id: string, opts: Partial<AgentPresetLike> = {}): AgentPresetLike => ({ id, ...opts })

test('the four official system presets get localized labels and descriptions', () => {
  const options = resolveAgentPresets([
    preset('standard', { trust: 'system' }),
    preset('code', { trust: 'system' }),
    preset('minimal', { trust: 'system' }),
    preset('cordis', { trust: 'system' }),
  ])
  assert.deepEqual(
    options.map((o) => [o.id, o.label]),
    [
      ['standard', '标准模式'],
      ['code', 'PTC 模式'],
      ['minimal', '极简模式'],
      ['cordis', '创造模式'],
    ],
  )
  assert.equal(options[0].description?.includes('功能完整的编码 Agent'), true)
  assert.equal(options[1].description?.includes('Code Mode SDK'), true)
  assert.equal(options[2].description?.includes('str_replace_editor'), true)
  assert.equal(options[3].description?.includes('自定义 Agent preset'), true)
})

test('unknown system ids fall back to the roster name/description', () => {
  const options = resolveAgentPresets([
    preset('future-mode', { trust: 'system', name: 'Future Mode', description: 'roster 文案' }),
  ])
  assert.deepEqual(options, [{ id: 'future-mode', label: 'Future Mode', description: 'roster 文案' }])
})

test('user presets always use their own name/description', () => {
  const options = resolveAgentPresets([
    // user preset 的 id 撞了官方名也不套用本地化文案。
    preset('standard', { trust: 'user', name: '我的标准', description: '自定义' }),
    preset('mine', { trust: 'user' }),
  ])
  assert.deepEqual(options, [
    { id: 'standard', label: '我的标准', description: '自定义' },
    { id: 'mine', label: 'mine' },
  ])
})

test('broken rows and id-less entries drop out of the picker', () => {
  const options = resolveAgentPresets([
    preset('ok', { trust: 'user', name: 'OK' }),
    preset('bad', { trust: 'system', broken: true }),
    preset('', { trust: 'user' }),
  ])
  assert.deepEqual(options, [{ id: 'ok', label: 'OK' }])
  assert.deepEqual(resolveAgentPresets([]), [])
})

test('defaultAgentPresetId prefers the isDefault row, else the first usable one', () => {
  assert.equal(
    defaultAgentPresetId([preset('a'), preset('b', { isDefault: true }), preset('c')]),
    'b',
  )
  // broken 的 isDefault 行不算，落到第一个可用行。
  assert.equal(defaultAgentPresetId([preset('a'), preset('b', { isDefault: true, broken: true })]), 'a')
  assert.equal(defaultAgentPresetId([]), undefined)
})

test('agentPresetLabel localizes known system ids, passes others through', () => {
  assert.equal(agentPresetLabel('standard'), '标准模式')
  assert.equal(agentPresetLabel('code'), 'PTC 模式')
  assert.equal(agentPresetLabel('minimal'), '极简模式')
  assert.equal(agentPresetLabel('cordis'), '创造模式')
  assert.equal(agentPresetLabel('my-custom'), 'my-custom')
})

test('agentPresetDescription returns Chinese copy for known system ids, undefined otherwise', () => {
  assert.equal(agentPresetDescription('standard')?.includes('功能完整的编码 Agent'), true)
  assert.equal(agentPresetDescription('code')?.includes('Code Mode SDK'), true)
  assert.equal(agentPresetDescription('minimal')?.includes('str_replace_editor'), true)
  assert.equal(agentPresetDescription('cordis')?.includes('自定义 Agent preset'), true)
  assert.equal(agentPresetDescription('my-custom'), undefined)
})
