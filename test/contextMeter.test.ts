import { test } from 'node:test'
import assert from 'node:assert/strict'
import { meterLevel, pressureWithContextWindow, contextUsageUnknown } from '../src/pure/contextMeter.ts'

test('ample headroom is ok with an estimate', () => {
  // perTurn 1K，剩余 90K → 90 轮。
  const m = meterLevel(10_000, 100_000, 10)
  assert.deepEqual(m, { level: 'ok', perTurn: 1000, turnsLeft: 90 })
})

test('warn boundary: turnsLeft exactly 10 stays ok, 9 turns warn', () => {
  // perTurn 10K，剩余 100K → 恰好 10 轮，不小于 10，仍是 ok。
  assert.equal(meterLevel(90_000, 190_000, 9).level, 'ok')
  assert.equal(meterLevel(90_000, 190_000, 9).turnsLeft, 10)
  // 剩余 90K → 9 轮 → warn。
  const m = meterLevel(100_000, 190_000, 10)
  assert.equal(m.level, 'warn')
  assert.equal(m.turnsLeft, 9)
})

test('danger boundary: turnsLeft exactly 5 stays warn, 4 turns danger', () => {
  // perTurn 10K，剩余 50K → 恰好 5 轮，仍是 warn。
  assert.equal(meterLevel(50_000, 100_000, 5).level, 'warn')
  // perTurn 10K，剩余 40K → 4 轮 → danger。
  const m = meterLevel(50_000, 90_000, 5)
  assert.equal(m.level, 'danger')
  assert.equal(m.turnsLeft, 4)
})

test('turnsLeft is floored (fractional headroom counts down)', () => {
  // perTurn 9.5K，剩余 5K → 0.52 轮，向下取整为 0 → danger。
  const m = meterLevel(95_000, 100_000, 10)
  assert.equal(m.turnsLeft, 0)
  assert.equal(m.level, 'danger')
})

test('overflow wins over turn estimates and drops them', () => {
  // 切了更小窗口的模型：已用量超限，不论 perTurn 多小都是 overflow。
  const m = meterLevel(120_000, 100_000, 1)
  assert.deepEqual(m, { level: 'overflow', perTurn: null, turnsLeft: null })
})

test('turns < 1 or missing is unestimable → ok', () => {
  assert.deepEqual(meterLevel(50_000, 100_000, 0), { level: 'ok', perTurn: null, turnsLeft: null })
  assert.deepEqual(meterLevel(50_000, 100_000, undefined), { level: 'ok', perTurn: null, turnsLeft: null })
})

test('perTurn 0 (no tokens used yet) is unestimable → ok', () => {
  assert.deepEqual(meterLevel(0, 100_000, 5), { level: 'ok', perTurn: null, turnsLeft: null })
})

test('pressureWithContextWindow 只覆写窗口，保留分子（切模型后重算输入）', () => {
  // 旧窗口 1M，切到 256K 的模型：分子（已用量）与模型无关，保持不变。
  const next = pressureWithContextWindow({ projectedTokens: 245_000, contextWindow: 1_000_000 }, 256_000)
  assert.deepEqual(next, { projectedTokens: 245_000, contextWindow: 256_000 })
  // 只带分子的投影同样可覆写（pressureTokens 兜底路径）。
  assert.deepEqual(
    pressureWithContextWindow({ pressureTokens: 12_000 }, 100_000),
    { pressureTokens: 12_000, contextWindow: 100_000 },
  )
})

test('切到更小窗口后立即用新窗口重算：未超限 → warn/danger，超限 → overflow', () => {
  // 从 1M 切到 256K，已用量 245K（未超）：turns=5 → perTurn 49K、剩余 11K → 0 轮 → danger。
  const m = meterLevel(245_000, 256_000, 5)
  assert.equal(m.level, 'danger')
  // 已用量 260K 超过 256K 新窗口 → overflow（不管轮数），这是"超新窗口"的显示。
  const o = meterLevel(260_000, 256_000, 5)
  assert.deepEqual(o, { level: 'overflow', perTurn: null, turnsLeft: null })
})

test('contextUsageUnknown：占位必须有已用量采样，无采样 = 无占位', () => {
  // 有已用量采样：占位带上 usedTokens（panel 仍能显示「已用 ~245K」）。
  assert.deepEqual(contextUsageUnknown(245_000), { windowUnknown: true, usedTokens: 245_000 })
  // 无采样（空白对话，从未有过压力）：不构成占位——无数据可标，调用方不显示。
  assert.equal(contextUsageUnknown(undefined), undefined)
})
