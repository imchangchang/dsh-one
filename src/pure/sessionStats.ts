/**
 * Host-side formatting of the `sessionStats` projection
 * (dsh-session-stats/lib/types/types.d.ts) into the one-line summary the chat
 * webview renders verbatim. Mirrors the official web client's StatsLine
 * (dsh-client-ui-conversation): counts / durations / speeds groups joined by
 * " ｜ ", segments with a zero denominator omitted.
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

/** Compact duration: 45.2s under a minute, 2m42s from there on. */
export function formatDuration(ms: number): string {
  const s = ms / 1000
  if (s < 60) return `${Math.round(s * 10) / 10}s`
  const whole = Math.round(s)
  return `${Math.floor(whole / 60)}m${whole % 60}s`
}

/** Decode throughput: whole tokens from ten up, one decimal below. */
export function formatTokensPerSecond(tps: number): string {
  const clamped = Math.max(0, tps)
  return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10)
}

/**
 * One-line session summary, e.g. "2 轮 · 16 步 ｜ LLM 48.3s · 工具调用 26.9s ｜
 * 首 token 平均 0.8s · 33 tok/s". Undefined until the first closed step — an
 * all-zero fold (fresh session) renders nothing, same as the web client.
 */
export function formatStatsLine(stats: SessionStatsLike): string | undefined {
  if (stats.steps <= 0) return undefined
  const groups: string[] = [`${stats.turns} 轮 · ${stats.steps} 步`]
  const durations: string[] = []
  if (stats.llmMs > 0) durations.push(`LLM ${formatDuration(stats.llmMs)}`)
  if (stats.toolMs > 0) durations.push(`工具调用 ${formatDuration(stats.toolMs)}`)
  if (durations.length > 0) groups.push(durations.join(' · '))
  const speeds: string[] = []
  if (stats.ttftSteps > 0) speeds.push(`首 token 平均 ${formatDuration(stats.ttftMs / stats.ttftSteps)}`)
  if (stats.decodeMs > 0) speeds.push(`${formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1000))} tok/s`)
  if (speeds.length > 0) groups.push(speeds.join(' · '))
  return groups.join(' ｜ ')
}
