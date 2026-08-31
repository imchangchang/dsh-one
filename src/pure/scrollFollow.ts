/**
 * 聊天消息列表的贴底跟随（scroll pinning）判定。
 * webview 侧据此区分"用户主动滚动"与"内容增长/程序贴底"，
 * 只在前者发生时重估跟随态，避免流式输出把视图钉在原处。
 */

/** 距底小于该值即视为"在底部"，输出期间应跟随。 */
export const NEAR_BOTTOM_PX = 40

/** wheel/touch/键盘手势后，scroll 事件在该窗口内仍算作用户滚动。 */
export const USER_SCROLL_INTENT_MS = 200

/** 距底距离；内容不足一屏（scrollHeight <= clientHeight）时为 0。 */
export function distanceFromBottom(scrollHeight: number, scrollTop: number, clientHeight: number): number {
  return Math.max(0, scrollHeight - scrollTop - clientHeight)
}

export function isNearBottom(scrollHeight: number, scrollTop: number, clientHeight: number): boolean {
  return distanceFromBottom(scrollHeight, scrollTop, clientHeight) < NEAR_BOTTOM_PX
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
