/**
 * 聊天消息列表的贴底跟随（scroll pinning）判定。
 * webview 侧据此区分"用户主动滚动"与"内容增长/程序贴底"，
 * 只在前者发生时重估跟随态，避免流式输出把视图钉在原处。
 *
 * 判定模型对齐官方 dsh web（dsh-client-ui-chat/lib/client.js）：一条
 * movedByReader 位移比对区分用户/程序滚动，宽松 25px 阈值判贴底，
 * 跟随与否只看「自上次程序写/读位置起用户有没有动过」。相比旧实现
 * 删去了 200ms 意图窗、回声剔除与双向/单向 reconcile 三层防御——
 * 官方用一条位移比对就同时区分用户/程序滚动，且程序写后同步该位，
 * 自回声自然为 false，无需剔除锁。
 */

/**
 * 「贴底」的宽松阈值：距底 ≤ 该值即认为在底部。对齐官方 dsh web 的
 * 25px 阈值——流式输出很难把视口一次性推出这条带，只要还在带内就继续
 * 跟随，几乎不出现「顶出去→吸回→再顶」的来回跳动。25px 的余量同时
 * 抵消浏览器对 scrollTop 的取整与瞬态布局误差。
 */
export const AT_BOTTOM_PX = 25

/**
 * 滚动空闲 debounce 窗口：最后一次滚动活动（wheel/scroll/pointer 等）距今 ≤ 该值
 * 就认为滚动还在动（含原生弹性回归动画——回归期间 scroll 事件持续到达），此时不写
 * scrollTop；超过该值才认为滚动真正停，允许 settle 补 pin。回归动画通常发生在最后一个
 * wheel 事件之后（意图窗口已过期），以「滚动空闲」而非「意图过期」作为写时机，
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
 * 「用户滚动」位移判定（对齐官方 movedByReader）：实时位置与上次程序写/读位置之差
 * > 0.5px 即认为用户动了。observedTop 是上次程序写后读回的 clamp 落点
 * （pinnedScrollTop），floor 是内容当前最底可滚位置（max(0, scrollHeight-clientHeight)）。
 * - 内容增长只增大 scrollHeight、不动 scrollTop，不会产生位移；
 * - 程序 pin 后浏览器 clamp 到 floor 内，实时位置与该位一致（≤ 0.5）→ 不判用户滚动；
 * - 内容收缩把 scrollTop clamp 到新 floor，min(observedTop, floor) 同步到 floor，
 *   位移为 0 → 不误判；只有真实用户手势才会让实时位置偏离 up to floor 的比对基。
 */
export function isReaderMoved(scrollTop: number, observedTop: number, floor: number): boolean {
  return Math.abs(scrollTop - Math.min(observedTop, floor)) > 0.5
}

/**
 * scroll 事件重估跟随态（对齐官方 movedByReader ? floor-scrollTop<=25 : atBottomRef.current）：
 * 用户动了则按「是否仍在 25px 贴底带」重判；用户没动（程序 pin 的自我回声 / 内容增长
 * 的 clamp）则维持现态，绝不因程序滚动误把跟随态置 false。
 */
export function nextStickToBottom(stickToBottom: boolean, movedByReader: boolean, atBottomNow: boolean): boolean {
  return movedByReader ? atBottomNow : stickToBottom
}

/**
 * 渲染后重滚底的决策：是否该把视口写回底部（程序 pin）。
 * 两条件同时满足才写：
 * - stickToBottom：跟随态（用户未主动滚离，视口应留在尾部）。
 * - !atBottom：实际已贴底（距底 ≤ AT_BOTTOM_PX）则无需再写（幂等），避免
 *   内容不足一屏/已贴底时的无谓写。
 */
export function shouldPinNow(stickToBottom: boolean, atBottom: boolean): boolean {
  return stickToBottom && !atBottom
}

/**
 * settle（滚动空闲后）补 pin 的决策：在 shouldPinNow 基础上叠加「滚动必须有真正停」。
 * - scrollActive：最近 SETTLE_IDLE_MS 内还有滚动活动（含弹性回归动画的 scroll 事件流）。
 *   此时写 scrollTop 会打断回归动画（Set scrollTop 终止惯性 → 回弹被重置 → 再弹 → 连续
 *   碰撞），禁止写；等滚动真正停（debounce 到期、scrollActive 为假）才允许。
 * 滚动停后如果视口已贴底（atBottom）则 shouldPinNow 为假、不写（零打扰）；脱底漂移
 * （内容增长）的情况写一次吸回。
 */
export function shouldSettlePinNow(stickToBottom: boolean, atBottom: boolean, scrollActive: boolean): boolean {
  return shouldPinNow(stickToBottom, atBottom) && !scrollActive
}

/**
 * 视口锚：切走时视口顶部那条消息行的渲染键 + 它在视口内的偏移（行在视口上方
 * 时为负）。跨会话恢复靠它回到「同一条消息的同一位置」——内容在切走期间增长
 * 或收缩（后台流式、补页、行高变化）时，光有 scrollTop 会落到别的内容上。
 */
export interface ScrollAnchor {
  key: string
  offset: number
}

/**
 * 一个会话的滚动存档（对齐官方 dsh web 的 chatScrollPositions 语义）：
 * 贴底只记 atBottom，翻历史记当时的 scrollTop（外加视口锚）。
 */
export interface ScrollArchive {
  scrollTop: number
  atBottom: boolean
  /** 视口锚；存档时拿不到可见行（空会话）则为 undefined，恢复回退 scrollTop。 */
  anchor?: ScrollAnchor
}

/** 从"离开时是否跟随中"生成存档：贴底与否取决于离开时的跟随态（而非重测
 * 40px 距离）。用户滚离底部时跟随态已被手势重估置为 false，存档即记
 * atBottom=false + 当时的 scrollTop；正在跟随则记 atBottom=true，恢复时忽略
 * scrollTop、直接贴底。内容在切走期间变长/收缩，恢复后靠 clamp 落点同步。
 * anchor 见 ScrollAnchor（目标会话回填后由调用方给出）。 */
export function archiveScrollPosition(
  scrollTop: number,
  stickToBottom: boolean,
  anchor?: ScrollAnchor | null,
): ScrollArchive {
  return { scrollTop, atBottom: stickToBottom, ...(anchor ? { anchor } : {}) }
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

/**
 * 按视口锚换算恢复目标：锚行在**恢复时**的位置减去它在存档时的视口内偏移，
 * 即「让锚行回到原来的屏幕高度」所需的 scrollTop。
 * currentScrollTop 是重建容器当下的位置（重建后通常为 0），rowOffset 是锚行
 * 相对滚动容器视口顶部的当前位置。负值钳到 0（滚过头的边界）。
 */
export function anchoredScrollTop(
  currentScrollTop: number,
  rowOffset: number,
  anchor: ScrollAnchor,
): number {
  return Math.max(0, currentScrollTop + (rowOffset - anchor.offset))
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
