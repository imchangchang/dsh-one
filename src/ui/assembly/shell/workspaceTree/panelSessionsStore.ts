/**
 * 「宿主的面板里正开着哪些会话」的页内事实（#147）。
 *
 * ## 为什么是一份模块级的 store
 * 这份事实由**宿主**推来（装配页的能力口 `onPanelSessions` 订阅它：先一条快照、此后
 * 每次面板↔会话映射变化再推一条），而消费它的是**树主组件**的渲染判据（给
 * `withoutPanelOpenCompleted` 用）。插件本体（`workspaceTreePlugin.ts` 的 `apply`）
 * 只负责把订阅接上，树按这份状态重渲染——所以事实源住在这里，两边都不许另存一份。
 *
 * ## 默认值与降级
 * 初值是**空集**（一条都没开）：官方 web 侧永远收不到这条事实，空集就是那种处境下的
 * 正确答案（不抑制任何提醒，行为与这条通道不存在时逐字相同）；宿主答不出来（能力桥
 * 缺席、快照读失败）也按空集处理，同一个安全的降级方向。
 *
 * ## 只在内容真的变了才通知
 * 宿主每次变化都会推，但树的重渲染条件只是「这份集合的内容变了」——一份内容相同的
 * 新数组不通知（`setPanelOpenSessions` 里比一遍），否则每次面板来回切都让整棵树白画。
 */
import { useEffect, useState } from 'react'

const EMPTY: ReadonlySet<string> = new Set()

let open: ReadonlySet<string> = EMPTY
const listeners = new Set<() => void>()

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a === b) return true
  if (a.size !== b.size) return false
  for (const id of a) if (!b.has(id)) return false
  return true
}

/** 写入宿主报来的那份集合（插件订阅里调；树只读）。 */
export function setPanelOpenSessions(sessionIds: readonly string[]): void {
  const next: ReadonlySet<string> = sessionIds.length === 0 ? EMPTY : new Set(sessionIds)
  if (sameIds(next, open)) return
  open = next
  for (const listener of [...listeners]) listener()
}

/** 订阅变化（返回退订）。 */
export function subscribePanelOpenSessions(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 读这份集合并随它变化重渲染。 */
export function usePanelOpenSessions(): ReadonlySet<string> {
  const [state, setState] = useState(open)
  useEffect(() => {
    setState(open)
    return subscribePanelOpenSessions(() => setState(open))
  }, [])
  return state
}
