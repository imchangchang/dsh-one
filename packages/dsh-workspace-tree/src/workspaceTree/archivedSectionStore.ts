/**
 * 「官方这一代还有没有自己的取消归档入口」——#239 那一节渲染与否的判据，一份模块级事实源。
 *
 * ## 这份事实是什么
 *
 * 官方两侧各有一代：
 * - **0.1.6 及以前**：取消归档是**设置页里的一节**（`@deepseek-ai/dsh-client-ui-settings-unarchive-sessions`
 *   注册进 `settings.section`，官方词典那句节名是「已归档会话」）。我们的设置页照常渲染
 *   那一节（设置树没有下线那件插件），所以误归档的用户有路可走，树里不必再出一个入口。
 * - **0.1.7 起**：那一节整件从官方产物里**没有了**，入口搬进官方侧栏的会话行菜单——
 *   官方 `ui-workspace` 在 `sidebar.workspaces.session.menu.item` / `...row.action` 两个
 *   新槽位里注册「归档会话 / 取消归档 / 置顶…」。而 `sidebar.workspaces` 被自有树遮蔽
 *   （shadow），那一整套菜单在 dsh-one 的侧栏里不渲染——于是取消归档在这两代上都断了路，
 *   这正是 #239 要补的洞。
 *
 * 判据因此取**槽位在不在**：`sidebar.workspaces.session.menu.item` 被声明了，
 * 说明这一代官方的取消归档住在侧栏会话菜单里（= 我们得自己补一条）；没被声明，
 * 说明这一代官方把它做在别处（0.1.6 的设置页那一节），那就不该多出第二个入口。
 * 选这个判据而不是版本号，是因为它**跟着机制走**：官方哪天再搬一次家（回到设置页、
 * 或另开一处），这一节会跟着消失或出现，不需要有人记得改版本比较。
 *
 * ## 为什么住模块级 store 而不是 props
 *
 * 事实来自注册表（`ctx.slots.inject` 的声明回调，接线在 `workspaceTreePlugin.ts`），
 * 而**用它的地方是树组件**：声明回调触发时，树可能早就渲染过了（谁先跑取决于插件
 * 装载顺序），所以两边要一个能互相通知的事实源——树订阅它，声明回调写它。
 */
import { useEffect, useState } from 'react'

let officialSessionMenu = false
const listeners = new Set<() => void>()

/**
 * 写「官方那一代的侧栏会话菜单槽位在不在」（`workspaceTreePlugin.ts` 的声明回调调它；
 * 槽位生命周期结束时**必须**写回 false——槽位没了这一节就不该继续渲染）。
 */
export function setOfficialSessionMenu(present: boolean): void {
  if (present === officialSessionMenu) return
  officialSessionMenu = present
  for (const listener of [...listeners]) listener()
}

/** 订阅这份事实（返回退订）。 */
export function subscribeOfficialSessionMenu(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 读这份事实并在它变化时重渲染（树主组件与归档确认弹窗各自调用）。 */
export function useOfficialSessionMenu(): boolean {
  const [state, setState] = useState(officialSessionMenu)
  useEffect(() => {
    setState(officialSessionMenu)
    return subscribeOfficialSessionMenu(() => setState(officialSessionMenu))
  }, [])
  return state
}
