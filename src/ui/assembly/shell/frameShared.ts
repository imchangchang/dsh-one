/**
 * 自有外框插件（frame plugin）族共享件（#64 chat / #70 sidebar 两个 cordis 树
 * 插件同源复用；逐字来自官方框架插件 ui-layout 的 client.js 实测源码）：
 * - createLayoutStore：自有 frame 的面板几何 store（sidebar/details/rightbar；
 *   0 = 收起；各树只读它用得上的维度，留着无害）
 * - computeColumns：官方 columns.ts 的列宽解算（官方数值规则，见函数注释）
 * - LayoutController：layout 服务面（ctx.layout）——官方 ILayout 语义，root 注册的
 *   inject 回调接线，未接线时调用照官方 throw
 * - ThemePresenter：主题快照落到 document（漏了它全站无主题色）
 * - PANEL_INFO_SOURCE：官方 root 槽位钩子 panelInfo 的源（官方框架插件
 *   ui-layout 被下线后，这份钩子由我们的外框插件补上，见下方说明）
 *
 * ## 官方框架插件 ui-layout 的契约清单（我们接手了什么、为什么、怎么核对）
 *
 * 三棵树的 block list 都下线了官方框架插件 `dsh-client-ui-layout`（官方 AppFrame
 * 自己画三列外框与拖拽把手，与 VS Code 外壳形态冲突）。代价是官方 root 槽位对
 * 插件下发的契约要由我们的底座接手——目前接手的全部四项：
 * 1. root 槽位注册（含子槽位声明表）：自有 ShellFrame/SidebarFrame/SettingsFrame；
 * 2. `ctx.layout` 服务（官方 LayoutController）：本文件的 LayoutController；
 * 3. 主题呈现（官方 ThemePresenter）：本文件的 ThemePresenter；
 * 4. root 槽位钩子 `panelInfo`（官方 `ctx.slots.provideRoot`）：本文件的
 *    PANEL_INFO_SOURCE。
 * 第 4 项是 0.1.6 才出现的：官方在 0.1.6 让 ui-workspace 的会话树与
 * ui-sidebar-right 的右侧栏消费这个钩子，缺了它槽位组件挂载即抛
 * `usePanelInfo is not a function`（#76 现场日志实锤）。官方版本继续演进时，
 * 核对办法：读 `dsh-client-ui-layout/lib/client.js` 的 `apply()`（看它还给
 * `ctx.slots.provideRoot` 与 `ctx.reflect.provide` 交了什么）与
 * `dsh-client-ui-layout/lib/types/client/*.d.ts`（契约签名），逐项对照本节清单；
 * `npm run verify:lab` 的 CONTRACT 套件是常驻核对（四棵树零未激活、零槽位崩溃、
 * 关键座位有内容、根条目声明表覆盖预期座位名）。
 *
 * ## 为什么不能「加载官方 ui-layout + 只遮蔽它的 root slot」（#77 实测结论）
 *
 * AGENTS 铁律的首选路径（加载官方件 + 遮蔽要改的那一个 slot）在 root 上不成立，
 * 2026-09-16 由 #77 的两项实验实测（浏览器验证 harness 跑真网关，实验脚本一次性）：
 * ① **子槽位声明是排他的**。官方 `SlotCore.register` 在登记时逐个检查
 *    `records.get(child)?.spec`，别的条目已声明就抛
 *    `slot "X" is already declared (by …)`；root 的四个子槽位
 *    （sidebar/main/rightbar/shell.overlay）由官方那条 root 条目声明
 *    （`dsh-client-ui-layout/lib/client.js` 的 `children` 表）。实测：我们先登记
 *    则官方 ui-layout 死（并拖垮 17 个注入它的插件），官方先登记则我们抛
 *    `slot "sidebar" is already declared`。
 * ② **渲染授权是按条目的**。renderer 的 `boundRenderSlot(host, entry)` 用
 *    `entry.children?.[key]` 判权（`dsh-client-ui-renderer/lib/client.js`），
 *    没有 children 声明的 root 条目渲染不出任何座位——遮蔽官方条目后契约全活着
 *    （实测：layout 服务在、子槽位声明在、别人的注册都在、零报错），但**没有任何
 *    人渲染那些座位**，页面是空白的。
 * ③ **服务提供点在同一隔离域唯一**。第二个 `ctx.provide('layout', …)` 抛
 *    `service "layout" has been registered at <fiber>`（cordis `src/reflect.ts`），
 *    而失败发生在 `apply` 的 effect 里 → 已收集的清理函数逆序回滚（官方那份
 *    layout 服务与 panelInfo 钩子一并消失）→ `web boot: N entries did not
 *    activate` → 整页停在「Failed to load plugins」，一个槽位都不渲染。
 * 官方自己也把 root 标成「不要在这里注册」（`SlotMap['root']` 的 doc：
 * `DO NOT register here`，遮蔽会让「every seat the frame declares gone」）。
 *
 * 结论：**框架层面不存在「契约由官方提供 + 外框由我们渲染」这个组合**。因此按
 * AGENTS 铁律的例外条款（官方件与目标形态不可调和时允许 block，但必须写明试过
 * 哪些共存路径、为何不可调和、接手了哪些契约、怎么随版本核对）继续 block
 * ui-layout，并把上面这份清单 + CONTRACT 套件当作版本核对的常驻手段。
 * 代价（如实记录）：官方 root 契约的现场提供方是我们，官方改 root 契约
 * （0.1.6 的 panelInfo 即一例）要靠 CONTRACT 套件先炸而不是用户撞见。
 */
import { defineStore } from '@deepseek-ai/dsh-client-store'

export interface ThemeSnapshot {
  active: {
    colorScheme: 'dark' | 'light'
    tokens: Record<string, string>
  }
  fontSize: number
}

/**
 * root 条目 `inject` 面拿到的动作集 = 本 store 的 actions 绑定（框架按 entry
 * 实例化后注入），layout 服务与面板呈现上报都落到这里。官方 ILayout 的五个
 * 成员各有落点：toggleSidebar/openRightbar/closeRightbar 直接映到同名动作，
 * selectPanel 由 LayoutController 自己兜（三棵树没有 keyed `main` 全局面板）。
 */
export interface PanelActions {
  openDetails(): void
  closeDetails(): void
  toggleSidebar(): void
  /** 容器实测宽（官方 layoutInfo.viewportWidth 同义）：rightbar 宽度按它推导。 */
  setViewportWidth(width: number): void
  /** 右侧栏宽度偏好（px）；官方 setRightbar 语义（钳到 300..70% 视口）。 */
  setRightbar(px: number): void
  /** 右侧栏呈现上报（官方 ILayout.openRightbar：track = 占轨道、fullscreen = 盖满）。 */
  openRightbar(track: boolean, fullscreen: boolean): void
  /** 右侧栏隐藏上报（官方 ILayout.closeRightbar）。 */
  closeRightbar(): void
}

export interface ShellLayoutState {
  sidebar: number
  details: number
  narrow: boolean
  narrowExpanded: boolean
  /** 容器实测宽（px，0 = 还没量到）：rightbar 宽度偏好按它推导。 */
  viewportWidth: number
  /** 右侧栏宽度偏好（px，null = 还没开过）；官方 layoutInfo.rightbar 同义。 */
  rightbar: number | null
  /** 右侧栏是否正在呈现（官方 layoutInfo.rightbarShown）。 */
  rightbarShown: boolean
  /** 呈现形态是否要占一格轨道（官方 layoutInfo.rightbarTrack）。 */
  rightbarTrack: boolean
  /** 呈现形态是否盖满容器（官方 layoutInfo.rightbarFullscreen）。 */
  rightbarFullscreen: boolean
}

/** Clamp a panel width into its contract range（官方 columns.ts 同规则）。 */
const clampWidth = (px: number, min: number, max: number): number => Math.min(max, Math.max(min, Math.round(px)))

/** 官方 columns.ts 的右列上限/首开比例（数值逐项对齐 ui-layout 0.1.6）。 */
const RIGHTBAR_MAX_RATIO = 0.7
const RIGHTBAR_DEFAULT_RATIO = 0.45
/** 中列最小宽：低于它就不给右列让轨道（官方 columns.ts 的 400 同值）。 */
const CENTER_MIN_WIDTH = 400

/**
 * 官方 columns.ts 的列宽解算（数值与规则逐项对齐 ui-layout 0.1.6）。
 *
 * 机制说明：这是纯几何解算，不是契约面——但官方把它放在被我们 block 的
 * ui-layout 包里，页内不存在该模块可复用，故逐值照抄。核对办法：读官方
 * `dsh-client-ui-layout/lib/client.js` 顶部的 `computeColumns`（三个常量
 * SIDEBAR_AUTO_COLLAPSE / RIGHTBAR_MAX_RATIO / RIGHTBAR_DEFAULT_RATIO 与
 * 400 这个中列底线），CONTRACT 套件里对右栏宽度有断言。
 *
 * @param viewport - 外框可用宽度（px）。
 * @param sidebar - 侧栏偏好宽（0 = 收起；本文件的自有 frame 里只有 sidebar 树用）。
 * @param rightbar - 右栏请求宽（0 = 不占轨道）。
 */
export function computeColumns(viewport: number, sidebar: number, rightbar: number): { sidebar: number; center: number; rightbar: number } {
  const s = sidebar === 0 ? 56 : clampWidth(sidebar, 264, 420)
  const available = viewport - s - CENTER_MIN_WIDTH
  const r = rightbar === 0 || available < 300 ? 0 : Math.min(available, clampWidth(rightbar, 300, viewport * RIGHTBAR_MAX_RATIO))
  return { sidebar: s, center: Math.max(0, viewport - s - r), rightbar: r }
}

/** 右栏请求宽偏好：官方 AppFrame 的 `layoutInfo.rightbar ?? viewport * 0.45`。 */
export function rightbarPreference(pref: number | null, viewport: number): number {
  return pref ?? viewport * RIGHTBAR_DEFAULT_RATIO
}

/**
 * 自有 frame 的 layout store。chat 树（vscode-shell）用 details 与 rightbar
 * 两个维度；sidebar 树（vscode-sidebar-shell）用 sidebar 维度驱动收起态
 * （0 = 收起成 56px 轨），narrow 维度在 VS Code 侧栏 view 里不参与（无 1024
 * 自动收起概念）。rightbar 三个动作照官方 0.1.6 的 store 语义：首次开启没
 * 有偏好时按视口 45% 定宽（保留下限 300），关掉只清呈现标记、宽度偏好留着。
 */
export function createLayoutStore() {
  return defineStore({
    init: (): ShellLayoutState => ({
      sidebar: 280,
      details: 0,
      narrow: false,
      narrowExpanded: false,
      viewportWidth: 0,
      rightbar: null,
      rightbarShown: false,
      rightbarTrack: false,
      rightbarFullscreen: false,
    }),
    actions: {
      setSidebar: (d, px: number) => {
        d.sidebar = clampWidth(px, 264, 420)
      },
      setDetails: (d, px: number) => {
        d.details = clampWidth(px, 300, 520)
      },
      toggleSidebar: (d) => {
        if (d.narrow) d.narrowExpanded = !d.narrowExpanded
        else d.sidebar = d.sidebar === 0 ? 280 : 0
      },
      setNarrow: (d, narrow: boolean) => {
        if (d.narrow === narrow) return
        d.narrow = narrow
        d.narrowExpanded = false
      },
      openDetails: (d) => {
        if (d.details === 0) d.details = 360
      },
      closeDetails: (d) => {
        d.details = 0
      },
      setViewportWidth: (d, width: number) => {
        if (d.viewportWidth === width) return
        d.viewportWidth = width
      },
      setRightbar: (d, px: number) => {
        d.rightbar = clampWidth(px, 300, Math.max(300, d.viewportWidth * RIGHTBAR_MAX_RATIO))
      },
      openRightbar: (d, track: boolean, fullscreen: boolean) => {
        if (d.rightbar === null) d.rightbar = Math.max(300, Math.round(d.viewportWidth * RIGHTBAR_DEFAULT_RATIO))
        d.rightbarShown = true
        d.rightbarTrack = track
        d.rightbarFullscreen = fullscreen
      },
      closeRightbar: (d) => {
        d.rightbarShown = false
        d.rightbarTrack = false
        d.rightbarFullscreen = false
      },
    },
  })
}

/**
 * layout 服务面（ctx.layout，官方 `ILayout` 成员逐项对齐——官方
 * `dsh-client-ui-layout/lib/types/client/service.d.ts`）：
 * - `toggleSidebar`：官方侧栏壳（ui-sidebar）的收起钮调用；
 * - `selectPanel`：官方工作区树（ui-workspace.openSession 返回会话面板）与
 *   官方侧栏的面板清单（ui-sidebar.selectPanel）调用；
 * - `beginNavigation`：官方工作区树开工作区/fork 时拿导航 signal，用于
 *   「上一次导航作废」的竞态判定；
 * - `openRightbar` / `closeRightbar`：官方右侧栏（ui-sidebar-right）上报呈现
 *   形态，供外框决定右侧轨道宽度；
 * - `openDetails` / `closeDetails`：自有 chat 树的 details 面板（官方 0.1.6
 *   已改用 rightbar，这两项是自有历史的延续）。
 *
 * 未接线（root 条目还没挂）时照官方 throw：装配错线要吵，不能静默降级。
 */
export class LayoutController {
  #panels: PanelActions | undefined
  #navigation = new AbortController()

  /** root 注册 inject 回调接线（官方 sanctioned side effect）。 */
  attachPanels(actions: PanelActions): void {
    this.#panels = actions
  }

  /** Toggle the sidebar panel（closed ⟷ contract default width）。 */
  toggleSidebar(): void {
    this.#require().toggleSidebar()
  }

  /**
   * 选中全局主面板（官方语义：null = 回到会话面板）。自有三棵树里没有任何
   * keyed `main` 全局面板注册（chat 树只有会话面板、sidebar 树没有主区），
   * 所以只有 null 是合法目标，非 null 照官方抛同一条错。
   */
  selectPanel(panelId: string | null): void {
    if (panelId === null) return
    throw new Error(`layout.selectPanel: main panel "${panelId}" is not registered`)
  }

  /** 开始一次导航：作废上一次未完成的导航（官方语义，调用方拿 signal 判定）。 */
  beginNavigation(): AbortSignal {
    this.#navigation.abort()
    this.#navigation = new AbortController()
    return this.#navigation.signal
  }

  /**
   * 官方右侧栏上报呈现形态（track = 是否占外框网格轨道、fullscreen = 是否盖满）。
   * 官方语义（`dsh-client-ui-layout/lib/types/client/service.d.ts` 的 ILayout）：
   * 这是**右侧栏占据者上报自己的呈现组成**，外框据此定轨道宽度与拖拽把手位置。
   * 官方 ui-sidebar-right 的座位在每次呈现变化时调它
   * （`dsh-client-ui-sidebar-right/lib/client.js` 的 `syncPresentation`：
   * `shown ? layout.openRightbar(track, fullscreen) : layout.closeRightbar()`）。
   * chat 树声明了 `rightbar` 座位并渲染它，所以这条上报要落进布局状态（见 store
   * 的 openRightbar）；sidebar/settings 树没声明该座位，座位自然 park、不会调到这里。
   */
  openRightbar(track: boolean, fullscreen: boolean): void {
    this.#require().openRightbar(track, fullscreen)
  }

  /** 右侧栏隐藏上报（同 openRightbar：清呈现标记，宽度偏好留着）。 */
  closeRightbar(): void {
    this.#require().closeRightbar()
  }

  /** 布局所有者卸载：作废进行中的导航（官方 dispose 语义）。 */
  dispose(): void {
    this.#navigation.abort()
  }

  #require(): PanelActions {
    if (this.#panels === undefined) throw new Error('layout: panel actions not wired (root entry not mounted)')
    return this.#panels
  }
}

/**
 * root 槽位钩子 `panelInfo` 的快照（官方 stores.d.ts 的 `PanelInfo`）。
 * `activePanelId !== null` 表示当前显示的是某个全局主面板（不是会话面板），
 * 官方会话树据此把当前会话行压暗、并停止跟随高亮。
 */
export interface PanelInfoSnapshot {
  readonly activePanelId: string | null
}

/**
 * 官方 root 槽位钩子 `panelInfo` 的源（机制层 1：官方槽位机制）。
 *
 * 官方 ui-layout 在 `apply()` 里用
 * `ctx.slots.provideRoot({ hooks: { panelInfo: { getSnapshot, subscribe } } })`
 * （官方 `dsh-client-ui-layout/lib/client.js` 的 root 注册段）把「当前选中的
 * 全局主面板」下发给**所有**槽位——官方 renderer 把钩子名 panelInfo 映射成
 * 槽位 props 上的 `usePanelInfo`（`standardHookPropName`）。0.1.6 起官方树组件
 * 依赖它：ui-workspace 的 SessionTree/FlatList/SearchResults 与 ui-sidebar-right
 * 的 RightbarRoot 都写 `usePanelInfo((info) => info.activePanelId !== null)`；
 * 官方框架插件 ui-layout 被下线后没人再提供这份钩子，树组件挂载即抛
 * `usePanelInfo is not a function`，会话行整块消失（#76 现场日志实锤）。
 *
 * 取舍：自有三棵树没有全局主面板（chat 树只有会话面板、sidebar 树只有侧栏、
 * settings 树只有设置页），所以 `activePanelId` 恒为 null——与官方默认态
 * （未选全局面板）语义一致，会话行照常高亮。快照对象必须引用稳定：官方把它
 * 交给 useSyncExternalStoreWithSelector，每次返回新对象会导致无限重渲。
 */
const PANEL_INFO_SNAPSHOT: PanelInfoSnapshot = { activePanelId: null }

export const PANEL_INFO_SOURCE = {
  getSnapshot: (): PanelInfoSnapshot => PANEL_INFO_SNAPSHOT,
  subscribe: (_listener: () => void): (() => void) => () => {},
}

const DARK_ATTRIBUTE = 'data-ds-dark-theme'
const CONTENT_FONT_SIZE_VARIABLE = '--dsh-content-font-size'

/** ThemePresenter（ui-layout theme-presenter.js 逐字：初始化 + theme/change 订阅 + apply/dispose 全撤回）。 */
export class ThemePresenter {
  /** 上次 apply 写入的 token 名（撤回集）。 */
  appliedTokens: string[] = []
  /** 本 presenter 专属的唯一 meta 节点。 */
  themeColorMeta: HTMLMetaElement

  constructor() {
    this.themeColorMeta = document.createElement('meta')
    this.themeColorMeta.name = 'theme-color'
  }

  apply(snapshot: ThemeSnapshot): void {
    const scheme = snapshot.active.colorScheme
    document.documentElement.style.colorScheme = scheme
    const body = document.body
    if (scheme === 'dark') body.setAttribute(DARK_ATTRIBUTE, '')
    else body.removeAttribute(DARK_ATTRIBUTE)
    body.style.setProperty(CONTENT_FONT_SIZE_VARIABLE, `${snapshot.fontSize}px`)
    for (const name of this.appliedTokens) body.style.removeProperty(name)
    this.appliedTokens = []
    for (const [name, value] of Object.entries(snapshot.active.tokens)) {
      body.style.setProperty(name, value)
      this.appliedTokens.push(name)
    }
    this.themeColorMeta.content = getComputedStyle(body).backgroundColor
    if (!this.themeColorMeta.isConnected) document.head.append(this.themeColorMeta)
  }

  dispose(): void {
    document.documentElement.style.removeProperty('color-scheme')
    const body = document.body
    body.removeAttribute(DARK_ATTRIBUTE)
    body.style.removeProperty(CONTENT_FONT_SIZE_VARIABLE)
    for (const name of this.appliedTokens) body.style.removeProperty(name)
    this.appliedTokens = []
    this.themeColorMeta.remove()
  }
}
