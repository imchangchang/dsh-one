/**
 * 宿主侧「点侧栏会话 → 聊天面板」的路由判定（纯函数，便于单测）——#65 返修 7 修
 * 启动竞态的宿主半边。
 *
 * 现场：新窗口启动时侧栏一出来就点会话，面板不出现/不切。宿主的两个坑：
 * 1. **默认开一次（#68）与点击同时在建面板**：两边都走 openChatPanel，后完成的
 *    那个把先建的面板 dispose 掉——点击建的面板（带会话注入）就可能被默认面板
 *    （不带注入，走官方恢复）顶掉 → 用户看到「点了没反应」；
 * 2. **面板还没建好时的点击没地方落**：只能丢弃或重复创建。
 *
 * 判定规则（与 assemblyView 的实现一一对应）：
 * - 有面板且已是该会话 → reveal（**宿主去重**：同 id 不重复处理，桥不再猜）；
 * - 有面板、会话不同 → switch（就地切换）；
 * - 没面板 → create（冷启动注入该会话）。
 * 在途创建期间到来的请求记进 `pending`，创建完成后由 {@link drainAfterCreate}
 * 兑现（同 id 则什么都不做 = 去重）。
 */
export type SelectionRoute = 'create' | 'switch' | 'reveal'

/** 一次选中请求该走哪条路。 */
export function routeSelection(
  state: { hasPanel: boolean; panelSessionId?: string | undefined },
  sessionId: string,
): SelectionRoute {
  if (!state.hasPanel) return 'create'
  return state.panelSessionId === sessionId ? 'reveal' : 'switch'
}

/**
 * 面板创建完成后兑现等待中的请求。
 * @param panelSessionId - 新面板当前会话（创建时可能未注入 = undefined）。
 * @param pending - 等待期间累积的请求（后来者覆盖先来者）。
 * @returns 需要切到的会话；undefined = 不切（没等待 / 已经在该会话 = 去重）。
 */
export function drainAfterCreate(panelSessionId: string | undefined, pending: string | undefined): string | undefined {
  if (pending === undefined) return undefined
  return panelSessionId === pending ? undefined : pending
}
