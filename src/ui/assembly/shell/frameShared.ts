/**
 * 自有外框插件（frame plugin）族共享件（#64 chat / #70 sidebar 两个 cordis 树
 * 插件同源复用；逐字来自官方框架插件 ui-layout 的 client.js 实测源码）：
 * - createLayoutStore：官方完整 shape 的瞬态面板几何 store（sidebar/details/
 *   narrow/narrowExpanded，0 = 收起；chat 树不读 sidebar/narrow 维度，留着无害）
 * - LayoutController：layout 服务面（ctx.layout）——官方语义，root 注册的
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
 * `dsh-client-ui-layout/lib/types/client/*.d.ts`（契约签名），逐项对照本节清单。
 *
 * 长期方向（AGENTS 铁律「优先与官方插件共存，不顶替其角色」）：加载官方
 * ui-layout、只对 root 槽位做遮蔽（shadow），让上面四项契约由官方代码原样
 * 存活。当前未走这条路的原因是它与我们的外框插件争夺同一个 `ctx.layout`
 * 服务提供点（同一 cordis context 上两处 provide 同名服务的语义需先实测），
 * 另外被遮蔽的 root 条目声明的子槽位是否随之下线（官方 root 槽位文档原文
 * 「every seat the frame declares gone」）也需实测——两项都没验之前不做迁移，
 * 先按上表把契约逐项补齐（本文件即补齐记录）。
 */
import { defineStore } from '@deepseek-ai/dsh-client-store'

export interface ThemeSnapshot {
  active: {
    colorScheme: 'dark' | 'light'
    tokens: Record<string, string>
  }
  fontSize: number
}

export interface PanelActions {
  openDetails(): void
  closeDetails(): void
  toggleSidebar(): void
}

export interface ShellLayoutState {
  sidebar: number
  details: number
  narrow: boolean
  narrowExpanded: boolean
}

/** Clamp a panel width into its contract range（官方 columns.ts 同规则）。 */
const clampWidth = (px: number, min: number, max: number): number => Math.min(max, Math.max(min, Math.round(px)))

/**
 * 官方完整 shape 的 layout store。chat 树（vscode-shell）只用 details 维度；
 * sidebar 树（vscode-sidebar-shell）用 sidebar 维度驱动收起态（0 = 收起成
 * 56px 轨），narrow 维度在 VS Code 侧栏 view 里不参与（无 1024 自动收起概念）。
 */
export function createLayoutStore() {
  return defineStore({
    init: (): ShellLayoutState => ({ sidebar: 280, details: 0, narrow: false, narrowExpanded: false }),
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
   * 自有 frame 没有右列（VS Code 面板/侧栏视图里没有官方那条右侧栏），右侧栏
   * 槽位 `rightbar` 也没被任何树声明，因此没有轨道可让——记下即返回，不抛错
   * （官方这份上报是「状态广播」，不是「请求许可」）。
   */
  openRightbar(_track: boolean, _fullscreen: boolean): void {}

  /** 右侧栏隐藏上报（同 openRightbar：无可让轨道）。 */
  closeRightbar(): void {}

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
