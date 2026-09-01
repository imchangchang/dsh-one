/**
 * 聊天消息列表的贴底跟随（scroll pinning）判定。
 * webview 侧据此区分"用户主动滚动"与"内容增长/程序贴底"，
 * 只在前者发生时重估跟随态，避免流式输出把视图钉在原处。
 */

/**
 * 「贴底」的精确阈值：距底 ≤ 该值才认为在底部。
 * 用户手势滚动用它替代旧 40px 近底容差——距底超过它即视为用户已滚离，
 * 立即停跟随并显示「回到最新」，避免下一帧流式渲染把视图从「离底 20px」
 * 拽回绝对底部（视觉抖动）。2px 的余量抵消浏览器对 scrollTop 的取整：把
 * scrollTop 设为 scrollHeight 后，clamp 落点距底可能残留 0~1px 的取整差。
 */
export const AT_BOTTOM_PX = 2

/** wheel/touch/键盘手势后，scroll 事件在该窗口内仍算作用户滚动。 */
export const USER_SCROLL_INTENT_MS = 200

/**
 * 滚动空闲 debounce 窗口：最后一次滚动活动（wheel/scroll/pointer 等）距今 ≤ 该值
 * 就认为滚动还在动（含原生弹性回归动画——回归期间 scroll 事件持续到达），此时不写
 * scrollTop；超过该值才认为滚动真正停，允许 settle 补 pin。回归动画通常发生在最后一个
 * wheel 事件 200ms 之后（意图窗口已过期），以「滚动空闲」而非「意图过期」作为写时机，
 * 避免在回归动画中途写 scrollTop 打断动画（迭代 2 的碰撞主犯）。
 */
export const SETTLE_IDLE_MS = 120

/** 距底距离；内容不足一屏（scrollHeight <= clientHeight）时为 0。 */
export function distanceFromBottom(scrollHeight: number, scrollTop: number, clientHeight: number): number {
  return Math.max(0, scrollHeight - scrollTop - clientHeight)
}

/** 精确贴底判定：距底 ≤ AT_BOTTOM_PX（而非旧 40px 近底容差）。 */
export function isAtBottom(scrollHeight: number, scrollTop: number, clientHeight: number): boolean {
  return distanceFromBottom(scrollHeight, scrollTop, clientHeight) <= AT_BOTTOM_PX
}

/**
 * 渲染后重滚底的决策：是否该把视口写回底部（程序 pin）。
 * 三条件同时满足才写：
 * - stickToBottom：跟随态（用户未主动滚离，视口应留在尾部）。
 * - !intentActive：无用户手势/动量（wheel/touch 事件仍持续到达 = 意图仍在）。
 *   此时写 scrollTop 会打断浏览器原生惯性动画（WebKit bug 255193 承认设
 *   scrollTop 终止惯性），正是「贴底惯性下滑反复回弹抖动」的碰撞源，跳过。
 * - !atBottom：实际已贴底（距底 ≤ AT_BOTTOM_PX）则无需再写（幂等），避免
 *   内容不足一屏/已贴底时的无谓写。
 */
export function shouldPinNow(stickToBottom: boolean, intentActive: boolean, atBottom: boolean): boolean {
  return stickToBottom && !intentActive && !atBottom
}

/**
 * settle（滚动空闲后）补 pin 的决策：在 shouldPinNow 基础上叠加「滚动必须有真正停」。
 * - scrollActive：最近 SETTLE_IDLE_MS 内还有滚动活动（含弹性回归动画的 scroll 事件流）。
 *   此时写 scrollTop 会打断回归动画（Set scrollTop 终止惯性 → 回弹被重置 → 再弹 → 连续
 *   碰撞），禁止写；等滚动真正停（debounce 到期、scrollActive 为假）才允许。
 * 滚动停后如果视口已贴底（atBottom）则 shouldPinNow 为假、不写（零打扰）；脱底漂移
 * （内容增长）的情况写一次吸回。
 */
export function shouldSettlePinNow(
  stickToBottom: boolean,
  intentActive: boolean,
  atBottom: boolean,
  scrollActive: boolean,
): boolean {
  return shouldPinNow(stickToBottom, intentActive, atBottom) && !scrollActive
}

/**
 * 一个会话的滚动存档（对齐官方 dsh web 的 chatScrollPositions 语义）：
 * 贴底只记 atBottom，翻历史记当时的 scrollTop。
 */
export interface ScrollArchive {
  scrollTop: number
  atBottom: boolean
}

/** 从"离开时是否跟随中"生成存档：贴底与否取决于离开时的跟随态（而非重测
 * 40px 距离）。用户滚离底部时跟随态已被手势重估置为 false，存档即记
 * atBottom=false + 当时的 scrollTop；正在跟随则记 atBottom=true，恢复时忽略
 * scrollTop、直接贴底。内容在切走期间变长/收缩，恢复后靠 clamp 落点同步。 */
export function archiveScrollPosition(scrollTop: number, stickToBottom: boolean): ScrollArchive {
  return { scrollTop, atBottom: stickToBottom }
}

/**
 * scroll 事件重估跟随态：手势窗口内双向调整（按实际是否贴底）；非手势
 * scroll（clamp/内容变化/程序滚动）只做单向修正——实测已贴底且当前没在跟随时
 * 进入跟随（修「回到最新」误显），但绝不主动置 false（防程序滚动被误判为
 * 用户滚离）。
 */
export function reconcileScrollPinning(stickToBottom: boolean, gestureActive: boolean, atBottom: boolean): boolean {
  if (gestureActive) return atBottom
  return stickToBottom || atBottom
}

/**
 * 换会话时的恢复目标：无存档默认贴底；贴底存档恢复跟随；翻历史存档
 * 恢复当时位置（scrollTop 为 0 也是合法目标，故用 null 表示"贴底"）。
 */
export function restoreScrollTarget(saved: ScrollArchive | undefined): {
  stickToBottom: boolean
  scrollTop: number | null
} {
  if (!saved || saved.atBottom) return { stickToBottom: true, scrollTop: null }
  return { stickToBottom: false, scrollTop: saved.scrollTop }
}

/** 会滚动容器的按键（焦点落在消息列表内时）。Space 同时可能是按钮激活，但无害：不滚动就不产生 scroll 事件。 */
export function isScrollKey(key: string): boolean {
  return (
    key === 'ArrowUp' ||
    key === 'ArrowDown' ||
    key === 'PageUp' ||
    key === 'PageDown' ||
    key === 'Home' ||
    key === 'End' ||
    key === ' '
  )
}
