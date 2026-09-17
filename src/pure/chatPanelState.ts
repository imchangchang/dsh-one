/**
 * 对话面板的序列化状态（#169）：窗口重载 / 扩展宿主重启之后，VS Code 只恢复
 * 「注册了 serializer 的 view type」的编辑器标签页，而**每个标签页恢复成什么**
 * 由它上一次存下的 state 决定。
 *
 * 这条 state 只能由页面自己写：官方 API 里 `WebviewPanel` 没有 state 属性，状态
 * 是页面调 `acquireVsCodeApi().setState(obj)` 存下来的（vscode.d.ts 的
 * `WebviewPanelSerializer` 头注：restart 时保存「所有有 serializer 的 webview
 * 经 setState 存下的状态」，恢复时交给 `deserializeWebviewPanel`）。所以：
 * 页面侧（sessionBootPlugin）写，宿主侧（assemblyView）读。
 *
 * 本模块是这条约定唯一的一份：版本号、字段形状、以及「恢复时这个面板落到哪个
 * 角色」的判定。纯逻辑（不 import VS Code API），宿主与单测共用。
 */

/**
 * chat 面板的 view type（宿主 createWebviewPanel 用它，serializer 按它注册）。
 *
 * **package.json 的激活事件必须有一条 `onWebviewPanel:<它>`**：恢复发生在扩展
 * 激活之前，没有这条事件，扩展起不来、serializer 也就注册不上（官方文档的硬
 * 要求）。`test/chatPanelState.test.ts` 钉住了这两处一致。
 */
export const ASSEMBLED_CHAT_VIEW_TYPE = 'dshOne.assembledChat'

/** state 的形状版本：解码时不认识就当作「没有 state」，按默认面板恢复。 */
export const CHAT_PANEL_STATE_VERSION = 1

/** 存进页面的 state（JSON 可序列化，字段名短；页面与宿主共用）。 */
export interface ChatPanelState {
  v: number
  /** 面板当前会话 id；null = 没有（跟官方恢复值走）。 */
  sessionId: string | null
  /** true = 显式多开的标签页；false = 单例面板。 */
  tab: boolean
}

/** 恢复一个面板要知道的两件事（encode 的入参、decode 的产物）。 */
export interface ChatPanelTarget {
  sessionId: string | undefined
  tab: boolean
}

export function encodeChatPanelState(target: ChatPanelTarget): ChatPanelState {
  return {
    v: CHAT_PANEL_STATE_VERSION,
    sessionId: target.sessionId ?? null,
    tab: target.tab,
  }
}

/**
 * 解码页面存下的 state。看不懂（undefined / 不是对象 / 版本不认识 / 字段类型
 * 不对）一律返回 undefined——调用方按「老面板」处理：面板照样恢复出来，只是
 * 不带会话注入，跟官方恢复值走。
 */
export function decodeChatPanelState(state: unknown): ChatPanelTarget | undefined {
  if (typeof state !== 'object' || state === null) return undefined
  const raw = state as { v?: unknown; sessionId?: unknown; tab?: unknown }
  if (raw.v !== CHAT_PANEL_STATE_VERSION) return undefined
  if (raw.sessionId !== null && typeof raw.sessionId !== 'string') return undefined
  return {
    sessionId: typeof raw.sessionId === 'string' && raw.sessionId !== '' ? raw.sessionId : undefined,
    tab: raw.tab === true,
  }
}

/** 恢复时的现场：单例槽位是否已被别的面板占着。 */
export interface ChatPanelOccupancy {
  singletonOpen: boolean
}

/**
 * 这个恢复出来的面板占哪个角色。规则只有一条：**单例只允许一个**。
 * 恢复的标签页按老身份排队，若轮到它当单例时槽位已被占（它恢复得晚、或
 * 别处已经新建了单例），就降级成普通标签页——面板照常可用，只是不参与
 * 「侧栏点会话就地切换」那套单例路由。
 */
export function placeRestoredChatPanel(
  target: ChatPanelTarget,
  occupancy: ChatPanelOccupancy,
): 'singleton' | 'tab' {
  if (target.tab) return 'tab'
  return occupancy.singletonOpen ? 'tab' : 'singleton'
}
