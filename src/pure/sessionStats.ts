import { enFallback, type L10nFn } from './sessionTree.ts'

/**
 * Host-side formatting of the `sessionStats` + `tokenUsage` projections
 * (dsh-session-stats / dsh-token-meter) into the one-line summary the chat
 * webview renders verbatim. Mirrors the official web client's StatsLine
 * (dsh-client-ui-chat/client/chat/StatsLine): counts / durations / speeds
 * groups from sessionStats (only when steps > 0), then a cache-hit group and
 * an input/output-token group from tokenUsage (only when tokens were billed),
 * joined by " | " like the official fragment separators. Segments with a zero
 * denominator are omitted.
 */

/** Loose mirror of SessionStatsProjection (all fields fold from zero). */
export interface SessionStatsLike {
  turns: number
  steps: number
  llmMs: number
  toolMs: number
  ttftMs: number
  ttftSteps: number
  decodeMs: number
  decodeTokens: number
}

/** Loose mirror of the tokenUsage projection's `totals` (dsh-token-meter). */
export interface TokenUsageLike {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** Compact duration: 45.2s under a minute, 2m42s from there on. */
export function formatDuration(ms: number, t: L10nFn = enFallback): string {
  const s = ms / 1000
  if (s < 60) return t('{0}s', Math.round(s * 10) / 10)
  const whole = Math.round(s)
  return t('{0}m{1}s', Math.floor(whole / 60), whole % 60)
}

/** Decode throughput: whole tokens from ten up, one decimal below. */
export function formatTokensPerSecond(tps: number): string {
  const clamped = Math.max(0, tps)
  return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10)
}

/** Sum the three disjoint prompt-side billing buckets (official billedInputTokens). */
export function billedInputTokens(usage: TokenUsageLike): number {
  return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}

/** 官方 formatTokens：整数 / 12.2K / 517K / 1.2M（≥100 取整，其余一位小数）。 */
export function formatCompactTokens(value: number, t: L10nFn = enFallback): string {
  const scaled = (candidate: number): string =>
    candidate >= 100 ? String(Math.round(candidate)) : String(Math.round(candidate * 10) / 10)
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return t('{0}K', scaled(value / 1_000))
  return t('{0}M', scaled(value / 1_000_000))
}

/** 官方 roundedPercentUnits：按百分比单位向上取整的精确比较。 */
function roundedPercentUnits(cacheReadTokens: number, denominator: number, decimalPlaces: number): number {
  const scale = (decimalPlaces === 0 ? 1 : 10) * 100
  const doubledScale = scale * 2
  const denominatorQuotient = Math.floor(denominator / doubledScale)
  const denominatorRemainder = denominator % doubledScale
  let lower = 0
  let upper = scale
  while (lower < upper) {
    const candidate = Math.floor((lower + upper + 1) / 2)
    const factor = candidate * 2 - 1
    if (cacheReadTokens >= factor * denominatorQuotient + Math.ceil((factor * denominatorRemainder) / doubledScale)) {
      lower = candidate
    } else {
      upper = candidate - 1
    }
  }
  return lower
}

function displayPercentUnits(units: number, decimalPlaces: number): string {
  if (decimalPlaces === 0) return String(units)
  const whole = Math.floor(units / 10)
  const tenths = units % 10
  return tenths === 0 ? String(whole) : `${whole}.${tenths}`
}

/**
 * 官方 formatCacheHitPercent：精确缓存命中百分比；部分命中要「诚实」——若
 * 一位小数会把它舍成 100%，自动提升位数直到能区分（99.9…）。无 prompt 输入
 * （分母 0）返回 null，UI 不显示。
 */
export function formatCacheHitPercent(cacheReadTokens: number, promptTokens: number, decimalPlaces = 0): string | null {
  if (promptTokens === 0) return null
  const missedInputTokens = promptTokens - cacheReadTokens
  if (missedInputTokens === 0) return '100'
  const roundedUnits = roundedPercentUnits(cacheReadTokens, promptTokens, decimalPlaces)
  if (roundedUnits < (decimalPlaces === 0 ? 100 : 1_000)) return displayPercentUnits(roundedUnits, decimalPlaces)
  let distinguishingPlaces = 1
  let scaledDoubleGap = missedInputTokens * 200
  const denominatorTens = Math.floor(promptTokens / 10)
  while (scaledDoubleGap <= denominatorTens) {
    scaledDoubleGap *= 10
    distinguishingPlaces += 1
  }
  const denominatorOnes = promptTokens % 10
  let roundedLoss = 5
  for (let loss = 1; loss < 5; loss += 1) {
    const factor = loss * 2 + 1
    const threshold = factor * denominatorTens + Math.floor((factor * denominatorOnes) / 10)
    if (scaledDoubleGap <= threshold) {
      roundedLoss = loss
      break
    }
  }
  return `99.${'9'.repeat(distinguishingPlaces - 1)}${10 - roundedLoss}`
}

/**
 * One-line session summary, e.g. "2 轮 · 16 步 | LLM 48.3秒 · 工具调用 26.9秒 |
 * 首 token 平均 0.8秒 · 33 tok/s | 缓存命中 99% | 输入 12.2K tok · 输出 1.2K tok".
 * Counts/durations/speeds are undefined until the first closed step — an
 * all-zero fold (fresh session) renders nothing, same as the web client. The
 * token groups come from `tokenUsage` and are omitted entirely when the host
 * has not reported a billed attempt (no 0% cache-hit fiction).
 */
export function formatStatsLine(
  stats: SessionStatsLike,
  usage?: TokenUsageLike,
  t: L10nFn = enFallback,
): string | undefined {
  const groups: string[] = []
  if (stats.steps > 0) {
    groups.push(t('{0} turns · {1} steps', stats.turns, stats.steps))
    const durations: string[] = []
    if (stats.llmMs > 0) durations.push(t('LLM {0}', formatDuration(stats.llmMs, t)))
    if (stats.toolMs > 0) durations.push(t('Tool call {0}', formatDuration(stats.toolMs, t)))
    if (durations.length > 0) groups.push(durations.join(' · '))
    const speeds: string[] = []
    if (stats.ttftSteps > 0) speeds.push(t('TTFT avg {0}', formatDuration(stats.ttftMs / stats.ttftSteps, t)))
    if (stats.decodeMs > 0) {
      speeds.push(t('{0} tok/s', formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1000))))
    }
    if (speeds.length > 0) groups.push(speeds.join(' · '))
  }
  if (usage !== undefined && (billedInputTokens(usage) > 0 || usage.outputTokens > 0)) {
    const cacheHit = formatCacheHitPercent(usage.cacheReadTokens, billedInputTokens(usage))
    if (cacheHit !== null) groups.push(t('Cache hit {0}%', cacheHit))
    groups.push(
      t(
        'Input {0} tok · Output {1} tok',
        formatCompactTokens(billedInputTokens(usage), t),
        formatCompactTokens(usage.outputTokens, t),
      ),
    )
  }
  return groups.length > 0 ? groups.join(' | ') : undefined
}
