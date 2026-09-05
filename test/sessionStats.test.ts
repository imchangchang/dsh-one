import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  billedInputTokens,
  formatCacheHitPercent,
  formatCompactTokens,
  formatDuration,
  formatStatsLine,
  formatTokensPerSecond,
  type SessionStatsLike,
  type TokenUsageLike,
} from '../src/pure/sessionStats.ts'

const zero: SessionStatsLike = { turns: 0, steps: 0, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 }
const zeroUsage: TokenUsageLike = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }

/** Minimal zh seat mirroring l10n/bundle.l10n.zh-cn.json for the stats-line keys. */
const zh = (template: string, ...args: Array<string | number>): string => {
  const dict: Record<string, string> = {
    '{0}s': '{0}秒',
    '{0}m{1}s': '{0}分{1}秒',
    '{0} turns · {1} steps': '{0} 轮 · {1} 步',
    'LLM {0}': 'LLM {0}',
    'Tool call {0}': '工具调用 {0}',
    'TTFT avg {0}': '首 token 平均 {0}',
    '{0} tok/s': '{0} tok/s',
    'Cache hit {0}%': '缓存命中 {0}%',
    'Input {0} tok · Output {1} tok': '输入 {0} tok · 输出 {1} tok',
    '{0}K': '{0}K',
    '{0}M': '{0}M',
  }
  const value = dict[template] ?? template
  return value.replace(/\{(\d+)\}/g, (_m, i: string) => String(args[Number(i)] ?? ''))
}

test('formatDuration: seconds with one decimal under a minute', () => {
  assert.equal(formatDuration(0), '0s')
  assert.equal(formatDuration(800), '0.8s')
  assert.equal(formatDuration(48300), '48.3s')
  assert.equal(formatDuration(59_960), '60s')
})

test('formatDuration: minutes and seconds from one minute up, localized', () => {
  assert.equal(formatDuration(60_000), '1m0s')
  assert.equal(formatDuration(162_000), '2m42s')
  assert.equal(formatDuration(162_000, zh), '2分42秒')
  assert.equal(formatDuration(998_126, zh), '16分38秒')
})

test('formatTokensPerSecond: whole tokens from ten up, one decimal below', () => {
  assert.equal(formatTokensPerSecond(33.4), '33')
  assert.equal(formatTokensPerSecond(9.96), '10')
  assert.equal(formatTokensPerSecond(5.25), '5.3')
  assert.equal(formatTokensPerSecond(0), '0')
})

test('formatCompactTokens: exact below a thousand, compact above', () => {
  assert.equal(formatCompactTokens(999), '999')
  assert.equal(formatCompactTokens(12_200), '12.2K')
  assert.equal(formatCompactTokens(517_000), '517K')
  assert.equal(formatCompactTokens(1_230_000), '1.2M')
  assert.equal(formatCompactTokens(33_036_094), '33M')
})

test('billedInputTokens sums the three prompt-side buckets', () => {
  assert.equal(
    billedInputTokens({ uncachedInputTokens: 183_358, outputTokens: 99_301, cacheReadTokens: 32_852_736, cacheWriteTokens: 0 }),
    33_036_094,
  )
})

test('formatCacheHitPercent: honest rounding', () => {
  assert.equal(formatCacheHitPercent(0, 0), null)
  assert.equal(formatCacheHitPercent(100, 100), '100')
  assert.equal(formatCacheHitPercent(99_445, 100_000), '99')
  // 部分命中舍入到 100 必须升位到能区分（99.9…）。
  assert.equal(formatCacheHitPercent(99_999, 100_000), '99.999')
})

test('formatStatsLine returns undefined for an all-zero fold', () => {
  assert.equal(formatStatsLine(zero), undefined)
  assert.equal(formatStatsLine({ ...zero, turns: 2 }), undefined)
})

test('formatStatsLine renders the full line with real 0.1.2 values', () => {
  const line = formatStatsLine(
    {
      turns: 4,
      steps: 197,
      llmMs: 998_126,
      toolMs: 227_883,
      ttftMs: 190_484,
      ttftSteps: 197,
      decodeMs: 802_470,
      decodeTokens: 99_301,
    },
    { uncachedInputTokens: 183_358, outputTokens: 99_301, cacheReadTokens: 32_852_736, cacheWriteTokens: 0 },
  )
  assert.equal(
    line,
    '4 turns · 197 steps | LLM 16m38s · Tool call 3m48s | TTFT avg 1s · 124 tok/s | Cache hit 99% | Input 33M tok · Output 99.3K tok',
  )
})

test('formatStatsLine renders the full line in Simplified Chinese', () => {
  const line = formatStatsLine(
    {
      turns: 4,
      steps: 197,
      llmMs: 998_126,
      toolMs: 227_883,
      ttftMs: 190_484,
      ttftSteps: 197,
      decodeMs: 802_470,
      decodeTokens: 99_301,
    },
    { uncachedInputTokens: 183_358, outputTokens: 99_301, cacheReadTokens: 32_852_736, cacheWriteTokens: 0 },
    zh,
  )
  assert.equal(
    line,
    '4 轮 · 197 步 | LLM 16分38秒 · 工具调用 3分48秒 | 首 token 平均 1秒 · 124 tok/s | 缓存命中 99% | 输入 33M tok · 输出 99.3K tok',
  )
})

test('formatStatsLine omits segments whose denominator is zero', () => {
  // Only LLM time recorded: no tool segment, no speeds group at all.
  assert.equal(formatStatsLine({ ...zero, turns: 1, steps: 1, llmMs: 1500 }), '1 turns · 1 steps | LLM 1.5s')
  // ttft without decode, and vice versa.
  assert.equal(formatStatsLine({ ...zero, turns: 1, steps: 2, ttftMs: 900, ttftSteps: 2 }), '1 turns · 2 steps | TTFT avg 0.5s')
  assert.equal(formatStatsLine({ ...zero, turns: 1, steps: 1, decodeMs: 2000, decodeTokens: 9 }), '1 turns · 1 steps | 4.5 tok/s')
  // Durations group collapses when both wall times are zero.
  assert.equal(formatStatsLine({ ...zero, turns: 3, steps: 4, decodeMs: 1000, decodeTokens: 500 }), '3 turns · 4 steps | 500 tok/s')
})

test('formatStatsLine omits ttft when no step recorded a first token', () => {
  assert.equal(formatStatsLine({ ...zero, turns: 1, steps: 1, ttftMs: 5000 }), '1 turns · 1 steps')
})

test('formatStatsLine token groups only from billed usage', () => {
  // All-zero tokenUsage: no cache-hit fiction and no token group at all.
  assert.equal(formatStatsLine({ ...zero, turns: 1, steps: 2 }, zeroUsage), '1 turns · 2 steps')
  // Output-only usage (no prompt input): no cache-hit segment, tokens group still shows.
  assert.equal(
    formatStatsLine({ ...zero, turns: 1, steps: 2 }, { ...zeroUsage, outputTokens: 363 }),
    '1 turns · 2 steps | Input 0 tok · Output 363 tok',
  )
  // Chinese label for the token group and cache hit.
  assert.equal(
    formatStatsLine(
      { ...zero, turns: 1, steps: 2 },
      { uncachedInputTokens: 2_176, outputTokens: 363, cacheReadTokens: 81_536, cacheWriteTokens: 0 },
      zh,
    ),
    '1 轮 · 2 步 | 缓存命中 97% | 输入 83.7K tok · 输出 363 tok',
  )
})

test('formatStatsLine shows token groups even before any closed step (official parity)', () => {
  // Official StatsLine renders usage groups independent of steps: a session that
  // billed tokens but has no closed step yet still gets cache-hit + token groups.
  const line = formatStatsLine(
    { ...zero, turns: 0, steps: 0 },
    { uncachedInputTokens: 100, outputTokens: 50, cacheReadTokens: 900, cacheWriteTokens: 0 },
  )
  assert.equal(line, 'Cache hit 90% | Input 1K tok · Output 50 tok')
})
