/**
 * 回收站抽屉的**开合态**（#114）。
 *
 * ## 为什么是一份模块级的 store
 * 抽屉的渲染与全部动作住在树主组件里（`sidebar.workspaces` 那条 shadow），而**开合它
 * 的按钮在另一个座位**（`sidebar.footer.action` 的入口行）。两边必须说同一件事：入口行
 * 要知道抽屉现在开着还是关着，才能把点击翻成「展开」或「收起」——否则它只能盲发一个
 * 「打开」，关掉之后再点就成了「点了没反应」。
 *
 * 于是开合态住在这里，两侧都订阅它：入口行**读**（决定这次点击是展开还是收起，并把
 * `aria-expanded` 写在按钮上），树主组件**写**（开抽屉时顺手清掉上一轮的错误提示，与关
 * 抽屉同处一个执行点）。事实源只有这一份，不复制、不镜像。
 *
 * 与回收站**内容**（`recycleBinStore.ts`）分开的理由：内容一旦被误清就是用户数据没了，
 * 所以它住宿主能力口、读失败时拒绝写；而开合态是本机这一屏的看法，丢了不影响任何功能，
 * 既不落盘也不进宿主状态。
 */
import { useEffect, useState } from 'react'

let open = false
const listeners = new Set<() => void>()

function publish(next: boolean): void {
  if (next === open) return
  open = next
  for (const listener of [...listeners]) listener()
}

/** 抽屉当前是否展开（模块级事实源；只有树主组件会写它）。 */
export function recycleDrawerOpen(): boolean {
  return open
}

/** 写开合态（树主组件调；入口行只读，请求经 `recycleEntrySignal` 转达）。 */
export function setRecycleDrawerOpen(next: boolean): void {
  publish(next)
}

/** 订阅开合态（两侧组件各自调用，返回退订）。 */
export function subscribeRecycleDrawer(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 读开合态并在它变化时重渲染。 */
export function useRecycleDrawerOpen(): boolean {
  const [state, setState] = useState(open)
  useEffect(() => {
    setState(open)
    return subscribeRecycleDrawer(() => setState(open))
  }, [])
  return state
}
