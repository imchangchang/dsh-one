import { test } from 'node:test'
import assert from 'node:assert/strict'
import { meterLevel } from '../src/pure/contextMeter.ts'

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
