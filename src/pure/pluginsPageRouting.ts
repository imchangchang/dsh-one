/**
 * 宿主 → 装配页：官方插件页（keyed `main` 的 key `plugins`）现在开着没有（#247）。
 *
 * 为什么要有这一条通道：那一页在 VS Code 侧是一个**独立编辑器页**（照设置页的先例），
 * 而它的入口是**侧栏 webview** 里官方侧栏渲染的那一行。两个 webview 互不相识，所以
 * 「这一页到底开着没有」这件事只有宿主知道，侧栏那一行的选中态要跟着它走：
 *
 * - 用户点那一行 → 侧栏树的 `layout` 服务受理 → 经宿主能力口请宿主开页 → 宿主建成
 *   之后推一条 `{ open: true }`（受理方在**宿主确认之后**才点亮选中态，见
 *   `sidebarLayoutPlugin` 的 openPanel 处置）；
 * - 用户把那个编辑器页关掉 → 宿主推一条 `{ open: false }`，选中态回落。
 *
 * 官方侧栏那一行自己的选中态读的是 root 槽位钩子 `panelInfo`（官方 PanelRow 的
 * `usePanelInfo((info) => info.activePanelId === id)`），所以这条消息的唯一消费方是
 * 我们那份可写快照（`frameShared.createPanelInfoSource`）。**官方 web 侧永远收不到
 * 这条消息**：那一端没有「宿主面板」这个概念，那一页就是官方外框自己渲染的全局面板。
 *
 * 形状与解析住在这里（宿主与页面共用一个事实源，免得两边各写一遍字符串），照 #147
 * 的 `sessionPanelRouting.ts` 同一套做法。
 */

/** 宿主 → 装配页的消息类型名（两侧共用这一处常量）。 */
export const PLUGINS_PAGE_MESSAGE = 'dshOne.pluginsPage'

/** 造一条「插件页开着没有」的宿主消息。 */
export function pluginsPageMessage(open: boolean): { type: string; open: boolean } {
  return { type: PLUGINS_PAGE_MESSAGE, open }
}

/**
 * 解析宿主下发的那条消息。形状不认识（不是这条消息 / `open` 不是布尔）一律返回
 * undefined——调用方按「没收到这条事实」处理，也就是什么都不改（不猜选中态）。
 */
export function parsePluginsPageMessage(data: unknown): boolean | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const raw = data as { type?: unknown; open?: unknown }
  if (raw.type !== PLUGINS_PAGE_MESSAGE || typeof raw.open !== 'boolean') return undefined
  return raw.open
}
