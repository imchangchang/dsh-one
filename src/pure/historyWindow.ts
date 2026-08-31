/**
 * session.history 的窗口分页（对齐官方 dsh-client-runtime 的 Session.doOpen /
 * loadOlder）：附着时只拉尾部 maxMessages 条消息的窗口，用户上翻时以窗口首
 * 事件的 seq 为 beforeSeq 向前翻一页。host 保证页边界按消息对齐（不切半条
 * 消息），且只有尾页（beforeSeq 缺省）携带 projections 基线。
 */
import type { HistoryEntryLike } from './conversation.ts'

/** 官方窗口大小（Session.doOpen 与 loadOlder 的 maxMessages）。 */
export const HISTORY_WINDOW_MESSAGES = 50

/**
 * 已加载历史窗口的游标：earliestSeq 是窗口内最早一条事件的 seq（下一页的
 * beforeSeq）；hasMore 表示日志里还有更早的内容。
 */
export interface HistoryWindowCursor {
  earliestSeq: number | undefined
  hasMore: boolean
}

/** session.history 的 payload：beforeSeq 缺省读尾页，否则读该 seq 之前的一页。 */
export function historyWindowRequest(
  sessionId: string,
  beforeSeq?: number,
): { sessionId: string; beforeSeq?: number; maxMessages: number } {
  return beforeSeq === undefined
    ? { sessionId, maxMessages: HISTORY_WINDOW_MESSAGES }
    : { sessionId, beforeSeq, maxMessages: HISTORY_WINDOW_MESSAGES }
}

/** 基线（尾页）落地后的初始游标；空页没有窗口首事件，earliestSeq 保持 undefined。 */
export function windowCursorOf(page: { events: readonly HistoryEntryLike[]; hasMore: boolean }): HistoryWindowCursor {
  return { earliestSeq: page.events[0]?.event.seq, hasMore: page.hasMore }
}

/**
 * 刚拉到的更早一页能否拼到当前窗口前面（官方 loadOlder 的衔接校验：页尾
 * 事件的 seq + 1 必须等于窗口首事件的 seq；对不上说明日志有洞，继续拼会
 * 错位）。空页没有新内容，不算脱节，由调用方按 hasMore 决定还能不能翻。
 */
export function pageMeetsWindow(
  page: { events: readonly HistoryEntryLike[] },
  cursor: HistoryWindowCursor,
): boolean {
  if (page.events.length === 0) return true
  const tail = page.events[page.events.length - 1].event.seq
  return cursor.earliestSeq !== undefined && tail + 1 === cursor.earliestSeq
}

/** 拼上一页后的新游标：窗口首 seq 前移（空页不动），hasMore 取新页的。 */
export function extendWindowCursor(
  cursor: HistoryWindowCursor,
  page: { events: readonly HistoryEntryLike[]; hasMore: boolean },
): HistoryWindowCursor {
  return {
    earliestSeq: page.events[0]?.event.seq ?? cursor.earliestSeq,
    hasMore: page.hasMore,
  }
}
