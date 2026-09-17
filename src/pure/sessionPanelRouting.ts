/**
 * 宿主侧「点侧栏会话 → 聊天面板」的两件事（纯函数，便于单测）：
 *
 * 1. **路由判定**（#65 返修 7 修启动竞态的宿主半边）。现场：新窗口启动时侧栏一出来
 *    就点会话，面板不出现/不切。宿主的两个坑：
 *    - **默认开一次（#68）与点击同时在建面板**：两边都走 openChatPanel，后完成的那个
 *      把先建的面板 dispose 掉——点击建的面板（带会话注入）就可能被默认面板（不带注入，
 *      走官方恢复）顶掉 → 用户看到「点了没反应」；
 *    - **面板还没建好时的点击没地方落**：只能丢弃或重复创建。
 *    判定规则（与 assemblyView 的实现一一对应）：
 *    - 有面板且已是该会话 → reveal（**宿主去重**：同 id 不重复处理，桥不再猜）；
 *    - 有面板、会话不同 → switch（就地切换）；
 *    - 没面板 → create（冷启动注入该会话）。
 *    在途创建期间到来的请求记进 `pending`，创建完成后由 {@link drainAfterCreate}
 *    兑现（同 id 则什么都不做 = 去重）。
 * 2. **「面板里开着哪些会话」这一份事实**（#121 起是单条查询、#147 起是整份集合加一条
 *    下发通道）：{@link panelOpenSessionIds} 是那份事实的唯一定义，
 *    {@link PANEL_SESSIONS_MESSAGE} 系列是宿主把它推给装配页的协议。
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

/**
 * 「宿主的面板里现在开着哪些会话」（#121 起是这条规则、#147 起以集合对外）。
 *
 * 两种形态都算「开着」：**单例面板**（它的当前会话就是这条会话）与**显式多开的
 * 标签页**（这条会话有自己专属的面板）——两种都是这条会话的对话区真的在屏幕上。
 * 面板上挂着别的会话、根本没有面板，都算没开。
 *
 * 与 {@link routeSelection} 的区别：那个回答「这次打开请求该 create / switch /
 * reveal」，这个回答「宿主现在到底有没有开着它」。**#121 的 bug 正是把两者混为一谈**：
 * 侧栏只按官方 sessions 服务的 `list.current` 判「当前」（启动时它可能是官方恢复的
 * 上次会话），就以为宿主开着它，于是点击进了改名、面板永远不出来。
 *
 * 同一份事实有两个消费方——侧栏会话行点击问「这一条开着吗」（单值查询），侧栏渲染
 * 「跑完还没被打开」那颗绿点时问「哪些会话开着」（整份集合，#147 修的现场，见下面
 * 的消息通道）。两者必须来自同一份事实，所以查询写成「集合里有没有它」，
 * `assemblyView` 的 `sessionInPanel` 与广播都调这一个函数，不各写一份判据。
 *
 * @param singletonSessionId - 宿主单例面板当前挂着的会话（无面板 = undefined）。
 * @param tabSessionIds - 全部多开标签页各自的会话 id。
 */
export function panelOpenSessionIds(
  singletonSessionId: string | undefined,
  tabSessionIds: Iterable<string>,
): ReadonlySet<string> {
  const ids = new Set<string>()
  // 空串不算一条会话（那不是 id）：宿主下发的集合与页面侧解析走的是同一口径。
  for (const id of tabSessionIds) if (id !== '') ids.add(id)
  if (singletonSessionId !== undefined && singletonSessionId !== '') ids.add(singletonSessionId)
  return ids
}

// ---------------------------------------------------------------------------
// #147 宿主 → 装配页：面板里正开着的会话集合
//
// 为什么要有这一条通道：官方「跑完还没被打开」的完成提醒（绿点）的武装条件是
// **这一页的 selected 不是它**——官方 web 只有一页，selected 就是屏幕上那一条，所以
// 判据成立。我们的 shell 有两个 webview（侧栏页 + 对话面板页各一份官方 session
// client），宿主把面板切到某条会话**不会**回写给侧栏页，于是侧栏页的 selected 与
// 屏幕上真正开着的会话可以是两回事：那条会话跑完，侧栏照旧给它亮一颗「跑完还没
// 被打开」的绿点（用户正在看它）。
//
// 所以宿主把自己那份事实（面板里开着哪些会话）推给装配页，侧栏树把它算进渲染绿点
// 的判据。消息形状与解析就住在这里（宿主与页面共用一个事实源，免得两边各写一遍
// 字符串）。**官方 web 侧永远收不到这条消息**：那一端没有「宿主面板」这个概念，
// 集合恒为空、行为与今天完全一致。
// ---------------------------------------------------------------------------

/** 宿主 → 装配页的消息类型名（两侧共用这一处常量）。 */
export const PANEL_SESSIONS_MESSAGE = 'dshOne.panelSessions'

/** 造一条「面板里正开着这些会话」的宿主消息（空集合也要发：它就是「一条都没开」）。 */
export function panelSessionsMessage(sessionIds: Iterable<string>): { type: string; sessionIds: string[] } {
  const ids = new Set<string>()
  for (const id of sessionIds) if (id !== '') ids.add(id)
  return { type: PANEL_SESSIONS_MESSAGE, sessionIds: [...ids] }
}

/**
 * 解析宿主下发的那条消息。形状不认识（不是这条消息 / 缺 `sessionIds` / 不是数组）
 * 一律返回 undefined——调用方按「没收到这条事实」处理，也就是空集合（不抑制任何
 * 提醒），与官方 web 侧同一个降级方向。空字符串 id 不算一条会话（那不是 id）。
 */
export function parsePanelSessionsMessage(data: unknown): string[] | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const raw = data as { type?: unknown; sessionIds?: unknown }
  if (raw.type !== PANEL_SESSIONS_MESSAGE || !Array.isArray(raw.sessionIds)) return undefined
  const ids = new Set<string>()
  for (const id of raw.sessionIds) if (typeof id === 'string' && id !== '') ids.add(id)
  return [...ids]
}
