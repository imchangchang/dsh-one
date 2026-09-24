/**
 * @dsh-one/vscode-chat-ui-layout——自有 root 外框插件（#64 方案 A′）：顶替下线的官方
 * ui-layout（root 槽注册 + layout 服务 + ThemePresenter + panelInfo 槽位钩子），
 * 只装配对话区，无官方侧栏。接手官方框架插件 ui-layout 的契约清单、版本核对办法，
 * 以及「为什么不能改成加载官方 ui-layout + 只遮蔽它的 root slot」（#77 实测结论）
 * 见 frameShared.ts 文件头。
 *
 * - root 槽注册：children 声明 conversation / main / details / rightbar /
 *   shell.overlay（不声明 sidebar——chat 树 block 了 ui-sidebar，其
 *   sidebar.workspaces 贡献不会注册；不带 locale 字段（不消费 t））。会话面板
 *   槽位两版都声明：0.1.2 线登记 single `conversation`，0.1.6 线登记 keyed
 *   `main`（key = `conversation`），渲染哪个由注册表实际有贡献的那个决定。
 *   `rightbar` 是 #79 决策 B 的接入点：声明后官方 ui-sidebar-right 才注册它的
 *   槽位，文件/终端/文档预览三个官方插件在这棵树上真正可用。
 * - ShellFrame：主区会话面板 + details 面板 + 官方右栏槽位 + shell.overlay 层；
 *   切会话时关 details（官方 AppFrame 语义，无侧栏/拖拽维度）。右栏几何照官方
 *   AppFrame 的两步解算（frameShared.computeColumns），呈现上报走 ctx.layout。
 * - ConnectionHint（#202）：对话区底部那一行断线提示。官方那枚提示只有
 *   `ui-settings-general` 的 `SettingsRoot` 一个承载件，而那要 `sidebar.settings`
 *   槽位（chat 树没有官方侧栏壳 ⇒ 官方提示在这棵树上永不渲染），所以这一行由本插件
 *   自己出：读官方 `connection.state`（机制层 2），离开 `connected` 就显示一行、
 *   回来就消失。理由与判据见 ConnectionHint 上方的注释。
 *
 * 构建：esbuild 打成官方同格式自注册 IIFE（clientEntry.ts + banner/footer
 * 包出 window.__ModuleLoader__.load({id, factory})）；react / react/jsx-runtime /
 * @deepseek-ai/cordis / @deepseek-ai/dsh-client-store 必须 external（种子表满足，
 * 打进包会双重实例化）。
 */
import { createElement as h, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  PANEL_INFO_SOURCE,
  computeColumns,
  createLayoutStore,
  LayoutController,
  rightbarPreference,
  ThemePresenter,
  type PanelActions,
  type PanelInfoSnapshot,
  type ShellLayoutState,
  type ThemeSnapshot,
} from './frameShared'
import { installExternalLinkShim } from './externalLinkShim'
import { SHELL_LOCALE } from './shellLocale'
import { withCurrentSession, type SessionListLike } from '../../../pure/workspaceTreeView'

// ---------------------------------------------------------------------------
// 类型（本地最小面；cordis ctx / 框架槽位的真实形态在私有包里，不跨包引用）
// ---------------------------------------------------------------------------

/**
 * 会话列表快照：形状（`ids` / `byId` / `current`）见 `pure/workspaceTreeView.ts` 的
 * `SessionListLike`。**本文件一律不直接读 `current`**——0.1.6-alpha.2 起官方那张快照
 * 里已经没有这一格了（`dsh-api-session-controller` 的 `projectList` 不再写它），
 * 唯一的入口是 {@link currentIdOf}。
 */
type SessionsSnapshot = SessionListLike

/**
 * 「当前会话」的取用法：官方两代字段的**唯一分叉点**在共享函数 `withCurrentSession`
 * 里（老代直接下发 `current`；新代官方改成从行上的 `retainedBy.mainView` 推），这里
 * 只调用它，不自己再分一次版本。
 *
 * **为什么这个文件也必须过它**（#226）：本插件读 `current` 的地方有三处（details 面板
 * 的开合、文档标题、冷启动遮罩的「目标到位了没有」），在 0.1.6-alpha.2 上直接读快照
 * 会恒得 `undefined`——遮罩于是永远等不到「目标到位」那一刻，只能靠 5 秒兜底揭幕并打
 * 一句 `timed out`（实验室 F-62 实测红在这里，见 #226 的现场）。
 */
const currentIdOf = (snapshot: SessionsSnapshot): string | undefined => withCurrentSession(snapshot).current

/**
 * 会话面板槽位名镜像：官方把「会话面板」这个槽位从 0.1.2 的 single `conversation`
 * 改成了 0.1.6 的 keyed `main`（key = `conversation`，见 ui-conversation 两版
 * client.js 的注册段）。两版都在版本门区间内，所以两版槽位都声明、按实际有贡献
 * 的那个渲染（查 registry 有无 `main` 条目 + 订阅其变化）。
 */
interface SeatMirror {
  getSnapshot(): 'main' | 'conversation'
  subscribe(listener: () => void): () => void
}

/**
 * 连接状态（官方的 `ConnectionState`）与它的只读镜像。
 *
 * 机制分层：**第 2 层（官方服务 API）**——官方 `connection` 服务把恢复生命周期
 * 发布成 `state`（官方类型 `ConnectionStateSource`：`getSnapshot()` + `subscribe()`，
 * 出处官方 `@deepseek-ai/dsh-client-connection` 的
 * `lib/types/client/index.d.ts` 里 `readonly state: ConnectionStateSource`）。
 * 官方 ui-settings-general 的 `SettingsRoot` 读的就是这一份（它的
 * `useConnectionState` 钩子），我们照同一个口读，不碰 DOM、不猜官方内部状态。
 */
type ConnectionState = 'connected' | 'disconnected' | 'connecting'

interface ConnectionStateSource {
  getSnapshot(): ConnectionState | undefined
  subscribe(listener: () => void): () => void
}

interface ConnectionService {
  state: ConnectionStateSource
}

interface ShellFrameProps {
  useStore: <R>(selector: (state: ShellLayoutState) => R) => R
  useSessions: <R>(selector: (state: SessionsSnapshot) => R) => R
  /** 官方 root 槽位钩子（本插件经 ctx.slots.provideRoot 提供，见 frameShared）。 */
  usePanelInfo: <R>(selector: (info: PanelInfoSnapshot) => R) => R
  actions: Pick<PanelActions, 'openDetails' | 'closeDetails' | 'setViewportWidth'>
  renderSlot: (name: string, params: Record<string, unknown>, opts?: { entryKey?: string }) => unknown
  SessionProvider: unknown
  /** 框架按 entry 的 locale 注入的 t（函数内别名 tr 避开 i18n 门禁裸 t() 扫描）。 */
  t: (key: string) => string
  /** 会话面板槽位名（见 SeatMirror，root 注册的 inject 面注入）。 */
  conversationSeat: SeatMirror
  /** 官方连接状态源（见 ConnectionStateSource，root 注册的 inject 面注入）。 */
  connectionState: ConnectionStateSource
}

interface RootSlotEntry {
  name: 'root'
  children: Record<string, { kind: 'single' | 'list' | 'keyed'; scope: 'root' | 'session' | 'session-maybe' }>
  store: () => unknown
  locale?: string
  inject: (actions: PanelActions) => { conversationSeat: SeatMirror; connectionState: ConnectionStateSource }
}

interface SlotEntryLite {
  options: { key?: string }
}

interface ShellContext {
  effect(body: () => (() => void) | void, label?: string): void
  on(event: 'theme/change', listener: (snapshot: ThemeSnapshot) => void): () => void
  reflect: { provide(name: string, service: unknown): () => void }
  /** 官方服务取用（`inject` 里声明过的才取，见 sessionBridgePlugin 同款写法）。 */
  get(name: 'connection'): ConnectionService
  slots: {
    register(entry: RootSlotEntry, component: unknown): () => void
    /** 官方 root 槽位钩子/数据发布口（ui-layout 的 panelInfo 同款调用点）。 */
    provideRoot(contribution: { hooks: { panelInfo: typeof PANEL_INFO_SOURCE } }): () => void
    /** 槽位条目快照（判会话面板用的是哪版槽位名）。 */
    entries(name: string): readonly SlotEntryLite[]
    /** 订阅某槽位的注册变化（官方 registry 同款）。 */
    subscribe(name: string, listener: () => void): () => void
  }
  locale: { register(ns: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): () => void }
  theme: { getTheme(): ThemeSnapshot }
}

/** 槽位名镜像（注册表里 keyed `main` 有贡献 = 0.1.6 线，否则 0.1.2 线的 single 槽位）。 */
function createConversationSeatMirror(ctx: ShellContext): SeatMirror {
  const read = (): 'main' | 'conversation' => (ctx.slots.entries('main').length > 0 ? 'main' : 'conversation')
  return {
    getSnapshot: read,
    subscribe(listener) {
      return ctx.slots.subscribe('main', listener)
    },
  }
}

/**
 * 连接状态镜像：把官方 `connection.state` 原样转出去（同 conversationSeat 的做法，
 * 本文件不自己造状态）。`inject` 里声明过 `connection`，所以 apply 跑起来时它必然在场。
 */
function connectionStateOf(ctx: ShellContext): ConnectionStateSource {
  return ctx.get('connection').state
}


// ---------------------------------------------------------------------------
// 样式（官方 css-module 注入形态的本地版：data-plugin-css 防重）
// ---------------------------------------------------------------------------

const CSS = '.dshOneShell_frame{background:var(--dsw-alias-bg-base);height:100%;display:flex;flex-direction:column;overflow:hidden;position:relative}.dshOneShell_row{flex:1;min-height:0;display:flex}.dshOneShell_main{flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden}.dshOneShell_details{border-left:.5px solid var(--dsw-alias-border-l3);min-width:0;overflow:hidden;background:var(--dsw-alias-bg-base)}.dshOneShell_rightbarCol{flex:none;position:relative;overflow:visible}.dshOneShell_openingMask{z-index:15;position:absolute;top:0;left:0;right:0;bottom:0;background:var(--dsw-alias-bg-base);align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:22px;display:flex}.dshOneShell_overlay{z-index:20;pointer-events:none;position:absolute;inset:0}' +
  // 断线提示那一行（#202）：飘在对话区底部中间的浮条，样式与侧栏的飘提示
  // （dsh-workspace-tree 的 dshOneTree_flash）同款，只是字号取对话区这一档。
  // z-index 16 > 开场遮罩的 15：遮罩盖着的时候若正好断线，这行事实仍然看得见。
  '.dshOneShell_connectionHint{z-index:16;max-width:90%;background:var(--dsw-alias-bg-elevated,var(--dsw-alias-bg-base));color:var(--dsw-alias-label-primary);border:.5px solid var(--dsw-alias-border-l3);border-radius:8px;padding:6px 10px;font-size:13px;line-height:20px;position:absolute;bottom:8px;left:50%;transform:translateX(-50%)}'
// composer dock 的统计行**不再覆写字号**（#181 撤除；此前是 #71 验收时压到 11px 的）。
//
// 撤除的理由：那一处覆写依赖两个**官方内部 CSS 变量名**（--dsh-content-font-size-secondary /
// --dsh-content-font-delta-secondary）。这类依赖是「静默失效」型——官方改名不会报错，
// 只是这里悄悄不再生效，而我们对它的唯一线索就是这段注释本身；审计（#96 的 C12）把它
// 归在「可撤：撤掉即少两个官方内部变量名依赖，代价是 dock 统计行回到官方 13px」，
// 用户 2026-09-18 拍板按此撤除（宁可回官方观感，也不背这两个内部名字）。
//
// 撤除后的行为：统计行取官方 ui-theme 按字号设置推导出来的那一档（默认 13px），
// 与官方 web 端一致。若以后真要再压字号，请走「官方字号设置」那条路而不是覆写内部变量。
const FULL_CSS = () => CSS
// 注意：overlay 层语义逐字对齐官方 AppFrame.overlayLayer（pointer-events:none、
// 无子元素指针事件豁免）——官方 CSS 没有 `>*{pointer-events:auto}`；加豁免会让
// 任何渲染了尺寸内容的 overlay 贡献（portal 进该层的全屏容器）吃掉全页输入。
// 需要交互的 overlay 贡献应自行声明 pointer-events（与官方一致）。
const CSS_TAG_ID = '@dsh-one/vscode-chat-ui-layout/ShellFrame.css'
if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`) === null) {
  const tag = document.createElement('style')
  tag.dataset.plugin = '@dsh-one/vscode-chat-ui-layout'
  tag.dataset.pluginCss = CSS_TAG_ID
  tag.textContent = FULL_CSS()
  document.head.appendChild(tag)
}

// ---------------------------------------------------------------------------
// DocumentTitle（ui-layout client.js 逐字）：会话标题投影进浏览器标题
//
// 与宿主侧**标签页标题**的关系（#212）：两处**故意不统一**。VS Code 标签页上显示的是
// 宿主设的 `panel.title`（口径见 `src/pure/panelTab.ts`：短、`dsh · <主体>`），它不读
// 这里的 `document.title`；这里的 `document.title` 是页面自己的浏览器标题，逐字照官方
// ui-layout 的行为（官方 web 在浏览器标签上就写 `<会话标题> — dsh`）。要统一就得改官方
// 行为、而收益只是「两处字符串一样」，不划算，所以各自保持原样。
// ---------------------------------------------------------------------------

function DocumentTitle({ title, productTitle }: { title?: string; productTitle: string }): null {
  useEffect(() => {
    document.title = title === undefined ? productTitle : `${title} — ${productTitle}`
    return () => {
      document.title = productTitle
    }
  }, [productTitle, title])
  return null
}

// ---------------------------------------------------------------------------
// ConnectionHint（#202）：对话区那行断线提示
// ---------------------------------------------------------------------------

/**
 * 对话区为什么会需要我们自己的一行提示（#202）：
 *
 * 官方那枚断线提示（`ConnectionIndicator`，「连接中断，正在重试，点击立即重连」那一条）
 * 官方安装里**只有一个承载件**：`@deepseek-ai/dsh-client-ui-settings-general` 的
 * `SettingsRoot`（该包 `lib/client.js` 里 `ConnectionIndicator` 的唯一调用点，就在设置
 * 入口那一行的 triggerRow 里）。而 `SettingsRoot` 是 `sidebar.settings` 槽位上的贡献，
 * 那个槽位只有**官方侧栏壳**声明——chat 树没有官方侧栏壳，于是那枚提示在这棵树上
 * 永远不渲染（#202 实测：`settings.trigger` 槽位锚点零枚、放行 ui-settings-general 也
 * 一样）。后果是**整段重启窗口里页面上一条恢复提示都没有**：内容会自己回来，用户却
 * 不知道刚才断过（#10 诉求 2「别静默」）。
 *
 * 所以这一行由我们自己出，且只读官方状态、不自己维护连接状态：
 * - **官方服务 API（机制分层第 2 层）**：读 `connection.state`
 *   （`ConnectionStateSource`，见 ConnectionStateSource 的注释）；官方恢复生命周期
 *   本身就是 `connected` / `connecting` / `disconnected` 三态，我们只做呈现。
 * - **为什么不做成可移植的 `@dsh-one/dsh-*` 包**：官方 web 上这枚提示本来就有
 *   （官方侧栏壳在），带过去只会和官方那条重复；它的存在理由就是「我们这棵装配树
 *   没有官方侧栏壳」，属于我们自己这棵树上的适配，所以留在 chat 树自己的 frame 插件里。
 *
 * 显示条件（只显事实、不猜）：**曾经连上过**（`connected`）之后，状态离开 `connected`
 * 就显示，回到 `connected` 就消失。首屏从未连上过时不显示——那种情况下页面多半压根
 * 装不起来（整包与资产都从网关取），显示一行提示没有意义。
 */
function ConnectionHint({ connectionState, t }: { connectionState: ConnectionStateSource; t: (key: string) => string }): unknown {
  const tr = t
  const [, setTick] = useState(0)
  // 订阅驱动重渲（与 conversationSeat 同一种做法）：官方状态源没有 React 绑定。
  useEffect(() => connectionState.subscribe(() => setTick((n) => n + 1)), [connectionState])
  const state = connectionState.getSnapshot()
  const [everConnected, setEverConnected] = useState(false)
  useEffect(() => {
    if (state === 'connected') setEverConnected(true)
  }, [state])
  if (state === undefined || state === 'connected' || !everConnected) return null
  return h(
    'div',
    {
      className: 'dshOneShell_connectionHint',
      // role=status：这行是「页面自己报告的状态」，读屏走 live region（官方
      // ConnectionIndicator 的 recovered 那一档用的也是 role="status"）。
      role: 'status',
      // 自有标记：断言与截图上认它（官方那枚的类名是 css-module 哈希，认不得）。
      'data-dshone-connection-hint': state,
    },
    // 两种非连接态各自一句（官方那两档的文案见 ui-settings-general 的
    // connection.connecting / connection.error）：`disconnected` = 浏览器报离线、
    // 自动重试已挂起，此时说「正在重试」是假的。
    tr(state === 'disconnected' ? 'connectionOffline' : 'connectionLost'),
  )
}

// ---------------------------------------------------------------------------
// ShellFrame：框架注入槽位的最小消费——主区 conversation + details 面板 +
// shell.overlay 层；切会话时关 details（官方 AppFrame 语义，无侧栏/拖拽维度）
// ---------------------------------------------------------------------------

/** 遮罩兜底超时：目标会话迟迟未激活（id 无效/网络慢）也揭幕，绝不白屏死锁。 */
const OPENING_MASK_TIMEOUT_MS = 5000

/** 与 session-boot 插件的状态共享方式：各自读 __DSH_ONE_BOOT__ 全局（第 3 层 seam），
 * 无跨 bundle 模块作用域可共享，也不值得为单一布尔起 cordis 服务。 */
const bootSessionId = (): string | undefined => {
  const raw = (globalThis as { __DSH_ONE_BOOT__?: { sessionId?: unknown } }).__DSH_ONE_BOOT__?.sessionId
  return typeof raw === 'string' && raw !== '' ? raw : undefined
}

/**
 * 这一页已经落到「新对话页」了没有（#211，写哨的是 session-boot 插件：目标开不了时它经
 * 官方 `uiWorkspace.startSession` 把页面落到新对话页，见那边的 `landOnNewConversation`）。
 *
 * 遮罩据此揭幕：那一刻这一页已经有确定的落点（官方的新对话页），继续盖着只是白挡。
 *
 * **要事件、不只是这个全局**：全局只在渲染那一刻读得到，而「落到新对话页」这一下未必引起
 * 一次重渲（目标开不了时官方那条 watcher 往往已经把一条空白会话选成当前会话，我们再选中
 * 同一条，会话列表一个字节都不变）——只读全局的话遮罩会一直盖着（#211 实测踩到过）。
 * 所以 session-boot 那边另外 `dispatchEvent`，这里 `useEffect` 收下并提一个 state。
 * 全局仍然留着：ShellFrame 重新挂载时（React 卸载再挂）状态从它初始化，遮罩不会被盖回来。
 */
const bootLandedNewConversation = (): boolean =>
  (globalThis as { __DSH_ONE_BOOT_NEW_CONVERSATION__?: unknown }).__DSH_ONE_BOOT_NEW_CONVERSATION__ === true

/** 跨 bundle 的哨（session-boot 那边 `dispatchEvent`，见 bootLandedNewConversation）。 */
const BOOT_NEW_CONVERSATION_EVENT = 'dsh-one:boot-new-conversation'

function ShellFrame({ useStore, useSessions, usePanelInfo, actions, renderSlot, SessionProvider, conversationSeat, connectionState, t }: ShellFrameProps) {
  const panels = useStore((s) => s)
  // 容器实测宽（官方 AppFrame 同款：ResizeObserver + rAF 节流量自己的盒宽）——
  // 右栏宽度偏好按它推导，所以必须在槽位挂载前尽量到位（首帧量一次）。
  const frameRef = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const el = frameRef.current
    if (el === null) return
    let raf: number | null = null
    let disposed = false
    const measure = (): void => {
      const width = el.getBoundingClientRect().width
      if (width > 0) actions.setViewportWidth(width)
    }
    measure()
    const observer = new ResizeObserver(() => {
      if (disposed) return
      raf ??= requestAnimationFrame(() => {
        raf = null
        measure()
      })
    })
    observer.observe(el)
    return () => {
      disposed = true
      observer.disconnect()
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [actions])
  // 会话面板槽位名（0.1.2 线 = single `conversation`，0.1.6 线 = keyed `main`）：
  // 注册在首渲之后，用订阅驱动重渲（官方槽位注册会 bump registry 版本）。
  const [, setSeatTick] = useState(0)
  useEffect(() => conversationSeat.subscribe(() => setSeatTick((n) => n + 1)), [conversationSeat])
  const activePanelId = usePanelInfo((info) => info.activePanelId)
  // 「当前会话」三处读数都经 `currentIdOf`（版本分叉见那里的注释）：details 面板的
  // 开合、文档标题、冷启动遮罩的「到位了没有」。直接读 `s.current` 在 0.1.6-alpha.2
  // 上恒得 undefined（快照里没有这一格了）。
  const detailsSession = useSessions((s) => {
    const current = currentIdOf(s)
    return current !== undefined && s.byId[current]?.blank === false ? current : undefined
  })
  const documentTitle = useSessions((s) => {
    const current = currentIdOf(s)
    return current === undefined ? undefined : s.byId[current]?.title
  })
  const lastSession = useRef(detailsSession)
  useLayoutEffect(() => {
    if (detailsSession === undefined) return
    if (lastSession.current !== undefined && lastSession.current !== detailsSession) actions.closeDetails()
    lastSession.current = detailsSession
  }, [actions, detailsSession])
  const detailsOpen = detailsSession !== undefined && panels.details > 0
  // 「正在打开会话…」遮罩（#71）：注入 tab 在目标会话激活前盖住对话区，
  // 杜绝官方默认态（空白会话 hero）闪帧；默认 tab 无注入永不罩（官方恢复
  // 行为不动）。激活 = current === bootId（机制层 2 订阅）；超时兜底揭幕。
  const bootId = bootSessionId()
  const currentSession = useSessions(currentIdOf)
  const [revealedByTimeout, setRevealedByTimeout] = useState(false)
  // 冷启动遮罩只服务「首次到达目标会话」：到位即永久揭幕（#65 批 1 回归套件
  // 抓出——原先只比 current !== bootId，运行时切到别的会话会让遮罩**重新罩上**
  // 直到 5s 兜底，表现为「切会话被白屏挡一下」）。
  const [bootReached, setBootReached] = useState(false)
  // #211：目标开不了、这一页已经落到新对话页（state 初值从全局读，见
  // bootLandedNewConversation——后挂载的 ShellFrame 也读得到哨）。
  const [landedNewConversation, setLandedNewConversation] = useState<boolean>(bootLandedNewConversation())
  useEffect(() => {
    if (landedNewConversation) return
    const onLanded = (): void => setLandedNewConversation(true)
    window.addEventListener(BOOT_NEW_CONVERSATION_EVENT, onLanded)
    return () => window.removeEventListener(BOOT_NEW_CONVERSATION_EVENT, onLanded)
  }, [landedNewConversation])
  // 超时回调要读**当下**的到达状态（state 在回调闭包里是旧的），所以另存一份 ref。
  const bootReachedRef = useRef(false)
  useEffect(() => {
    if (bootId !== undefined && currentSession === bootId) {
      bootReachedRef.current = true
      setBootReached(true)
    }
  }, [bootId, currentSession])
  useEffect(() => {
    // 超时只按 bootId 起一次：活网关列表持续更新会反复触发 current 变化，
    // 若随 current 重置定时器，兜底永不降临（NO-FLASH 实测抓出）。
    if (bootId === undefined) return
    const timer = setTimeout(() => {
      // 只在**遮罩还盖着**的时候说话（#205）：旧写法不看到达状态，凡是带注入的页面
      // 5 秒一到都打这一行——一路正常的页面也打，于是这行看着像「抢值输了」，实际
      // 什么都说明不了（实验室实测：五种恢复键现场、页面全都正常渲染，五行 warn 一行
      // 不少）。目标为什么没落定由 session-boot 插件按实际读数另说一句。
      if (bootReachedRef.current) return
      // #211：已经落到新对话页的页面上遮罩早揭了（见 opening），这里再报一次「超时揭幕」
      // 是假的——那句话说的是「遮罩兜底到期」，而那一刻遮罩并不在。回调闭包里的 state 是
      // 旧的，所以读全局那份事实（两边同一个哨）。
      if (bootLandedNewConversation()) return
      console.warn(`[dsh-one] opening session ${bootId} timed out; revealing the shell anyway`)
      setRevealedByTimeout(true)
    }, OPENING_MASK_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [bootId])
  const tr = t
  // #211：目标开不了时 session-boot 插件会把这一页落到新对话页并吹哨，那一刻遮罩就该揭——
  // 继续盖着只会白挡一个已经能用的页面（遮罩原本要挡的是官方空态闪帧，而那时已经不是空态）。
  const opening =
    bootId !== undefined &&
    !bootReached &&
    !revealedByTimeout &&
    currentSession !== bootId &&
    !landedNewConversation
  // 会话面板渲染：0.1.6 线登记的是 keyed `main` 的 `conversation` 键（官方
  // AppFrame 的 MainPanel 同款取键方式：全局面板 id ?? 'conversation'）；
  // 0.1.2 线登记的是 single `conversation`。两版槽位都声明，实际渲染哪个由
  // 注册表里有贡献的那个决定（见 conversationSeat 镜像）。
  const conversation =
    conversationSeat.getSnapshot() === 'main'
      ? renderSlot('main', {}, { entryKey: activePanelId ?? 'conversation' })
      : renderSlot('conversation', {})
  // 右栏几何（官方 AppFrame 同款两步解算，数值规则见 frameShared.computeColumns）：
  // 槽位拿到的是「正常态」宽度 `normal.rightbar`，占不占轨道看 `rightbarTrack`
  // （`cols.rightbar`）。没让轨道时官方槽位自己贴着外框右缘悬在内容之上——
  // 这正是官方右栏「是一条轨道，不是一个盒子」的语义（窄容器下就是这么呈现的）。
  const rightbarPref = rightbarPreference(panels.rightbar, panels.viewportWidth)
  const rightbarNormal = computeColumns(panels.viewportWidth, 0, rightbarPref).rightbar
  const rightbarTrackWidth = computeColumns(panels.viewportWidth, 0, panels.rightbarTrack ? rightbarPref : 0).rightbar
  return h(
    'div',
    { className: 'dshOneShell_frame', 'data-shell': 'dsh-one', ref: frameRef },
    h(DocumentTitle, {
      productTitle: 'DeepSeek Harness',
      ...(documentTitle === undefined ? {} : { title: documentTitle }),
    }),
    h(
      'div',
      { className: 'dshOneShell_row' },
      h('div', { className: 'dshOneShell_main' }, conversation),
      detailsOpen &&
        h(
          'div',
          { className: 'dshOneShell_details', style: { width: panels.details } },
          h(SessionProvider, null, renderSlot('details', {})),
        ),
      // 官方右栏槽位（#79 决策 B）：文件/终端/文档预览三个官方插件经
      // `ctx.slots.inject('rightbar', …)` 等这个槽位被声明后自己注册进来
      // （ui-sidebar-right 的 RightbarRoot），呈现上报走 ctx.layout（见 frameShared
      // 的 openRightbar）。props 三个字段是官方契约（官方 AppFrame 同款）：
      // width = 正常态面板宽、viewportWidth = 外框宽、canShow = 容器装不装得下。
      h(
        'div',
        { className: 'dshOneShell_rightbarCol', style: { width: rightbarTrackWidth } },
        renderSlot('rightbar', {
          width: rightbarNormal,
          viewportWidth: panels.viewportWidth,
          canShow: rightbarNormal > 0,
        }),
      ),
    ),
    opening && h('div', { className: 'dshOneShell_openingMask', 'data-opening-mask': '' }, tr('opening')),
    h(ConnectionHint, { connectionState, t: tr }),
    h('div', { className: 'dshOneShell_overlay', 'data-shell-overlay': true }, renderSlot('shell.overlay', {})),
  )
}

// ---------------------------------------------------------------------------
// cordis 插件面：inject ['slots','theme','locale','connection']；apply = layout 服务
// + root 注册 + ThemePresenter（均挂 ctx.effect，照抄官方两段的结构与 label 语义）
// ---------------------------------------------------------------------------

export const inject = ['slots', 'theme', 'locale', 'connection']

export function apply(ctx: ShellContext): void {
  // selectPanel 的合法性判据照官方取 keyed `main` 的实时注册表（本树里官方
  // ui-conversation 注册的 key 是 `conversation`；官方 ui-layout 同款构造点见
  // frameShared.LayoutController）。
  const layout = new LayoutController({ hasMainPanel: (panelId) => ctx.slots.entries('main').some((entry) => entry.options.key === panelId) })
  const conversationSeat = createConversationSeatMirror(ctx)
  const connectionState = connectionStateOf(ctx)
  ctx.effect(() => {
    const disposeService = ctx.reflect.provide('layout', layout)
    // 官方 root 槽位钩子 panelInfo（机制层 1：官方槽位机制，调用点逐字对齐
    // 官方 ui-layout 的 `ctx.slots.provideRoot`）。官方框架插件 ui-layout 被下线后这份钩子
    // 无人提供，0.1.6 的会话树/右侧栏挂载即崩（#76）。
    const disposePanelInfo = ctx.slots.provideRoot({ hooks: { panelInfo: PANEL_INFO_SOURCE } })
    const disposeRegistration = ctx.slots.register(
      {
        name: 'root',
        // 不声明 sidebar 子槽：chat 树 block 了 ui-sidebar，侧栏贡献整树缺席。
        // 会话面板两版槽位都声明（0.1.2 的 single `conversation` / 0.1.6 的
        // keyed `main`），渲染哪个见 conversationSeat 镜像。
        // `rightbar`（#79 决策 B）声明后官方 ui-sidebar-right 才会注册它的槽位
        // （官方件用 `ctx.slots.inject('rightbar', …)` 等声明），文件/终端/
        // 文档预览三个插件随之在这棵树上真正可用。
        children: {
          conversation: { kind: 'single', scope: 'session-maybe' },
          main: { kind: 'keyed', scope: 'root' },
          details: { kind: 'single', scope: 'session' },
          rightbar: { kind: 'single', scope: 'root' },
          'shell.overlay': { kind: 'list', scope: 'root' },
        },
        store: createLayoutStore,
        locale: 'dshOneShell',
        inject: (actions: PanelActions) => {
          layout.attachPanels(actions)
          return { conversationSeat, connectionState }
        },
      },
      ShellFrame,
    )
    // 遮罩与断线提示的自有词典（zh 转义过 i18n 门禁的字面量扫描；词典本体在
    // shellLocale.ts——浏览器验证的套件要拿同一份值断言页面上那行文案）。
    const disposeLocale = ctx.locale.register('dshOneShell', SHELL_LOCALE)
    return () => {
      disposeRegistration()
      disposeLocale()
      disposePanelInfo()
      disposeService()
    }
  }, 'dsh-one shell: layout service + panel-info hook + root registration')
  ctx.effect(() => {
    const presenter = new ThemePresenter()
    presenter.apply(ctx.theme.getTheme())
    const off = ctx.on('theme/change', (snapshot) => {
      presenter.apply(snapshot)
    })
    return () => {
      off()
      presenter.dispose()
    }
  }, 'dsh-one shell: theme presenter')
  // #150：外链锚点的捕获阶段兜底（三棵树共用同一份实现，见 externalLinkShim.ts）。
  ctx.effect(() => installExternalLinkShim(), 'dsh-one shell: external link takeover')
}
