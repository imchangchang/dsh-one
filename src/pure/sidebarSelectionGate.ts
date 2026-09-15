/**
 * 侧栏选中上报的门控（纯函数，便于单测）——#65 返修 7 修启动竞态用。
 *
 * 背景：官方 sessions 服务的 `list.current` 在启动期会由**官方自己**写入
 * （localStorage 恢复键 `dsh.sessions.current` 的恢复值、空列表时的自动选择），
 * 用户点击会话行也是写同一个值——两者在数据面上不可分辨。原先只按「首个非空
 * current」抑制，把用户启动后的**第一次点击**一起吞了（第二次点击才生效）。
 *
 * 现在的判别（两条独立证据，都不猜）：
 * 1. **恢复键参照**：页面加载最早期读到 `dsh.sessions.current`（本仓库在 pageHtml
 *    里注入读取，早于官方应用改写它）→ 首个非空 current 等于该值 = 官方恢复；
 * 2. **交互信号**：用户在侧栏容器上的 pointerdown（自有容器捕获监听，第 4 层）→
 *    之后到来的值一律视为用户驱动，不再抑制——这条补上「恢复值恰好等于用户点的
 *    那一行」的漏洞（那时值等于恢复键，但确实是用户点的）。
 *
 * 结果：启动期的官方值只登记不上报（默认面板仍走官方恢复 + #68 自动开一次）；
 * 用户的任何一次点击都上报（宿主再去重，见 assemblyView）。
 */
export interface SelectionGateState {
  /** 是否已处理过首个非空 current。 */
  started: boolean
  /** 上一次上报过的会话 id（去重基准）。 */
  lastReported?: string
}

/** 门控判定：给一个 current 值，答「要不要上报」并给出新状态。 */
export function decideSelectionReport(
  state: SelectionGateState,
  current: string,
  context: { restoreId?: string; userInteracted: boolean },
): { report: boolean; next: SelectionGateState } {
  const next: SelectionGateState = { started: state.started, lastReported: state.lastReported }
  if (!state.started) {
    next.started = true
    // 启动期：官方恢复值、或用户还没点过（官方自动选择）→ 只登记不上报
    if (!context.userInteracted) {
      next.lastReported = current
      return { report: false, next }
    }
  }
  if (current === state.lastReported) return { report: false, next }
  next.lastReported = current
  return { report: true, next }
}

/** 从官方恢复键的原始值里取 sessionId（实测形态：`{"sessionId":"session-…"}`）。 */
export function restoreSessionIdOf(raw: string | null | undefined): string | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined
  try {
    const parsed = JSON.parse(raw) as { sessionId?: unknown }
    const id = parsed?.sessionId
    return typeof id === 'string' && id !== '' ? id : undefined
  } catch {
    return undefined
  }
}
