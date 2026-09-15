/**
 * 自有 frame 插件族共享件（#64 shell / #70 sidebar frame 两个 cordis 树插件
 * 同源复用；逐字来自官方 ui-layout client.js 实测源码）：
 * - createLayoutStore：官方完整 shape 的瞬态面板几何 store（sidebar/details/
 *   narrow/narrowExpanded，0 = 收起；chat 树不读 sidebar/narrow 维度，留着无害）
 * - LayoutController：layout 服务面（ctx.layout）——官方语义，root 注册的
 *   inject 回调接线，未接线时调用照官方 throw
 * - ThemePresenter：主题快照落到 document（漏了它全站无主题色）
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

/** layout 服务桩（Cross-plugin panel-action face，官方 LayoutController 语义）。 */
export class LayoutController {
  #panels: PanelActions | undefined

  /** root 注册 inject 回调接线（官方 sanctioned side effect）。 */
  attachPanels(actions: PanelActions): void {
    this.#panels = actions
  }

  /** Toggle the sidebar panel（closed ⟷ contract default width）。 */
  toggleSidebar(): void {
    this.#require().toggleSidebar()
  }

  /** Open the details panel（no-op when already open）。 */
  openDetails(): void {
    this.#require().openDetails()
  }

  /** Close the details panel。 */
  closeDetails(): void {
    this.#require().closeDetails()
  }

  #require(): PanelActions {
    if (this.#panels === undefined) throw new Error('layout: panel actions not wired (root entry not mounted)')
    return this.#panels
  }
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
