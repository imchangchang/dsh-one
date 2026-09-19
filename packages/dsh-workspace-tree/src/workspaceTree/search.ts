/** 搜索：输入上限、去 NUL、状态形状（数据来自官方 `sessions.search`）。 */

export const SEARCH_DEBOUNCE_MS = 250
export const SEARCH_QUERY_MAX = 500
/** 官方 `sanitizeSearchQuery`：去掉 NUL 并截到 wire 上限。 */
export function sanitizeQuery(value: string): string {
  const withoutNul = value.replaceAll('\0', '')
  return withoutNul.length <= SEARCH_QUERY_MAX ? withoutNul : withoutNul.slice(0, SEARCH_QUERY_MAX)
}
export interface SearchState {
  items: readonly { id: string; snippet?: string }[]
  hasMore: boolean
  pending: boolean
  failed: boolean
}

export const EMPTY_SEARCH: SearchState = { items: [], hasMore: false, pending: false, failed: false }
