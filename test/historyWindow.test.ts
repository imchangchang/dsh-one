import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  HISTORY_WINDOW_MESSAGES,
  extendWindowCursor,
  historyWindowRequest,
  pageMeetsWindow,
  windowCursorOf,
} from '../src/pure/historyWindow.ts'
import type { HistoryEntryLike } from '../src/pure/conversation.ts'

/** 连续 seq 的事件页 fixture：seq 从 from 起递增。 */
function page(from: number, count: number, hasMore: boolean): { events: HistoryEntryLike[]; hasMore: boolean } {
  const events: HistoryEntryLike[] = []
  for (let i = 0; i < count; i += 1) {
    events.push({ event: { type: 'user/message', seq: from + i } })
  }
  return { events, hasMore }
}

test('historyWindowRequest: 尾页只带 maxMessages（对齐官方 doOpen）', () => {
  assert.deepEqual(historyWindowRequest('s1'), { sessionId: 's1', maxMessages: HISTORY_WINDOW_MESSAGES })
})

test('historyWindowRequest: 向前翻页带 beforeSeq（对齐官方 loadOlder）', () => {
  assert.deepEqual(historyWindowRequest('s1', 120), {
    sessionId: 's1',
    beforeSeq: 120,
    maxMessages: HISTORY_WINDOW_MESSAGES,
  })
})

test('windowCursorOf: 窗口首事件 seq 与 hasMore', () => {
  assert.deepEqual(windowCursorOf(page(10, 3, true)), { earliestSeq: 10, hasMore: true })
  assert.deepEqual(windowCursorOf(page(0, 0, false)), { earliestSeq: undefined, hasMore: false })
})

test('pageMeetsWindow: 页尾 seq + 1 等于窗口首 seq 才算衔接', () => {
  const cursor = { earliestSeq: 50, hasMore: true }
  assert.equal(pageMeetsWindow(page(40, 10, true), cursor), true)
  // 日志有洞（页尾到不了窗口首）或重叠（页尾越过窗口首）都算脱节。
  assert.equal(pageMeetsWindow(page(30, 10, true), cursor), false)
  assert.equal(pageMeetsWindow(page(45, 10, true), cursor), false)
  // 空页不算脱节；没有游标（空基线）时任何非空页都无从衔接。
  assert.equal(pageMeetsWindow(page(0, 0, true), cursor), true)
  assert.equal(pageMeetsWindow(page(1, 1, true), { earliestSeq: undefined, hasMore: true }), false)
})

test('extendWindowCursor: 窗口首 seq 前移，hasMore 取新页', () => {
  const cursor = { earliestSeq: 50, hasMore: true }
  assert.deepEqual(extendWindowCursor(cursor, page(20, 30, true)), { earliestSeq: 20, hasMore: true })
  assert.deepEqual(extendWindowCursor(cursor, page(0, 50, false)), { earliestSeq: 0, hasMore: false })
  // 空页：游标不动，只更新 hasMore。
  assert.deepEqual(extendWindowCursor(cursor, page(0, 0, false)), { earliestSeq: 50, hasMore: false })
})
