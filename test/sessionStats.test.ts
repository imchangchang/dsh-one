import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatDuration, formatStatsLine, formatTokensPerSecond } from '../src/pure/sessionStats.ts'

const zero = { turns: 0, steps: 0, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 }

test('formatDuration: seconds with one decimal under a minute', () => {
  assert.equal(formatDuration(0), '0s')
  assert.equal(formatDuration(800), '0.8s')
  assert.equal(formatDuration(48300), '48.3s')
  assert.equal(formatDuration(59_960), '60s')
})

test('formatDuration: minutes and seconds from one minute up', () => {
  assert.equal(formatDuration(60_000), '1m0s')
  assert.equal(formatDuration(162_000), '2m42s')
})

test('formatTokensPerSecond: whole tokens from ten up, one decimal below', () => {
  assert.equal(formatTokensPerSecond(33.4), '33')
  assert.equal(formatTokensPerSecond(9.96), '10')
  assert.equal(formatTokensPerSecond(5.25), '5.3')
  assert.equal(formatTokensPerSecond(0), '0')
})

test('formatStatsLine returns undefined for an all-zero fold', () => {
  assert.equal(formatStatsLine(zero), undefined)
  assert.equal(formatStatsLine({ ...zero, turns: 2 }), undefined)
})

test('formatStatsLine renders the full line', () => {
  const line = formatStatsLine({
    turns: 2,
    steps: 16,
    llmMs: 48_300,
    toolMs: 26_900,
    ttftMs: 12_800,
    ttftSteps: 16,
    decodeMs: 30_000,
    decodeTokens: 990,
  })
  assert.equal(line, '2 轮 · 16 步 ｜ LLM 48.3s · 工具调用 26.9s ｜ 首 token 平均 0.8s · 33 tok/s')
})

test('formatStatsLine omits segments whose denominator is zero', () => {
  // Only LLM time recorded: no tool segment, no speeds group at all.
  assert.equal(
    formatStatsLine({ ...zero, turns: 1, steps: 1, llmMs: 1500 }),
    '1 轮 · 1 步 ｜ LLM 1.5s',
  )
  // ttft without decode, and vice versa.
  assert.equal(
    formatStatsLine({ ...zero, turns: 1, steps: 2, ttftMs: 900, ttftSteps: 2 }),
    '1 轮 · 2 步 ｜ 首 token 平均 0.5s',
  )
  assert.equal(
    formatStatsLine({ ...zero, turns: 1, steps: 1, decodeMs: 2000, decodeTokens: 9 }),
    '1 轮 · 1 步 ｜ 4.5 tok/s',
  )
  // Durations group collapses when both wall times are zero.
  assert.equal(
    formatStatsLine({ ...zero, turns: 3, steps: 4, decodeMs: 1000, decodeTokens: 500 }),
    '3 轮 · 4 步 ｜ 500 tok/s',
  )
})

test('formatStatsLine omits ttft when no step recorded a first token', () => {
  assert.equal(
    formatStatsLine({ ...zero, turns: 1, steps: 1, ttftMs: 5000 }),
    '1 轮 · 1 步',
  )
})
