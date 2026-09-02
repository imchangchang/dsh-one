/**
 * 上下文容量指示的分级与实时预估（对话框右下角的 contextBar）。纯函数，
 * 无 vscode 依赖，node --test 可测。
 *
 * 口径：
 * - perTurn = usedTokens / turns（turns 来自 sessionStats 投影）；
 *   turns < 1 或 usedTokens ≤ 0 时无法估计，perTurn/turnsLeft 均为 null。
 * - turnsLeft = floor((contextWindow - usedTokens) / perTurn)——向下取整，
 *   阈值判断也用这个整数（9.9 轮按 9 轮算，进 warn）。
 * - 分级：used > window → overflow（超限优先，与轮数无关，turnsLeft 置 null）；
 *   turnsLeft < 5 → danger；< 10 → warn；其余（含无法估计）→ ok。
 */
export type MeterLevel = 'ok' | 'warn' | 'danger' | 'overflow'

export interface MeterEstimate {
  level: MeterLevel
  /** 平均每轮对话增长的上下文 token 数；无法估计时为 null。 */
  perTurn: number | null
  /** 按当前 perTurn 估算的剩余轮数（向下取整）；无法估计或已超限时为 null。 */
  turnsLeft: number | null
}

/** 剩余轮数阈值：低于 WARN_TURNS 转黄，低于 DANGER_TURNS 转红。 */
export const WARN_TURNS = 10
export const DANGER_TURNS = 5

/** Loose mirror of the `contextPressure` projection value (dsh-token-meter). */
export interface ContextPressureLike {
  pressureTokens?: number
  projectedTokens?: number
  contextWindow?: number
}

/** 「窗口未知」占位值：切到从未观察过窗口的模型时，无诚实比例可给。
 *  占位必须带最后一次采样的已用量（usedTokens）——有采样才值得标示未知；
 *  从未有过采样（`used === undefined`，如空白对话）时**不构成占位**，
 *  由 `contextUsageUnknown` 返回 undefined，调用方不显示任何指示。 */
export interface ContextUsageUnknown {
  windowUnknown: true
  usedTokens: number
}

/**
 * 构成「窗口未知」占位：保留最后一次压力采样的已用量，窗口与比例置为
 * 「未知」。用于切到映射无记录的模型时，明确标示非误报的未知状态。
 * 没有任何采样（空白对话，从未观察过该会话的已用量）时返回 undefined——
 * 无数据可标，不显示占位。拿到窗口（下一条消息的 request/context）后由
 * `pressureWithContextWindow` 恢复成正常比例。
 */
export function contextUsageUnknown(used: number | undefined): ContextUsageUnknown | undefined {
  return used === undefined ? undefined : { windowUnknown: true, usedTokens: used }
}

/**
 * 切换模型后立即用新模型窗口重算压力值：只覆写 `contextWindow`，保留
 * 分子（pressureTokens/projectedTokens，与模型无关）。contextBar 的
 * percent/分级（`meterLevel`）随后按新窗口算出——若已用量超新窗口，
 * `meterLevel` 直接进 `overflow`，panel 的红色提示自动生效。
 */
export function pressureWithContextWindow(pressure: ContextPressureLike, contextWindow: number): ContextPressureLike {
  return { ...pressure, contextWindow }
}

export function meterLevel(used: number, window: number, turns: number | undefined): MeterEstimate {
  // 切到更小窗口的模型会让已用量超限：直接 overflow，不论轮数。
  if (window > 0 && used > window) return { level: 'overflow', perTurn: null, turnsLeft: null }
  if (window <= 0 || turns === undefined || turns < 1 || used <= 0) {
    return { level: 'ok', perTurn: null, turnsLeft: null }
  }
  const perTurn = used / turns
  if (perTurn <= 0) return { level: 'ok', perTurn: null, turnsLeft: null }
  const turnsLeft = Math.floor((window - used) / perTurn)
  const level: MeterLevel = turnsLeft < DANGER_TURNS ? 'danger' : turnsLeft < WARN_TURNS ? 'warn' : 'ok'
  return { level, perTurn, turnsLeft }
}
