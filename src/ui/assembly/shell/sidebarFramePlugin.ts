/**
 * @dsh-one/vscode-sidebar-shell——侧栏位 frame 插件（#70）：顶替下线的官方
 * ui-layout，官方侧栏（品牌位/工作区树/设置入口/底部动作条）原样进 VS Code
 * 侧栏 view。spike #69 题1 已验证裸 frame 里侧栏完整、数据正常。
 *
 * - root 槽注册：children 只声明 sidebar + shell.overlay（conversation/details
 *   等 chat 树槽位不声明，对应贡献静默缺席——chat 树有独立 frame）。
 * - SidebarFrame：单列布局——侧栏槽（官方 SidebarRoot）+ shell.overlay 层；
 *   收起态跟官方 AppFrame 语义（store.sidebar 0 = 收起到 56px 轨，侧栏壳的
 *   收起按钮经 ctx.layout.toggleSidebar 打到 store）。
 * - 设置面板 = 官方 SettingsRoot modal（住在 sidebar.settings 槽内，零替换）。
 *
 * 构建与打包约束同 clientEntry.ts（esbuild banner/footer 包自注册 IIFE，
 * externals 种子表满足）。
 */
import { createElement as h } from 'react'
import { createLayoutStore, LayoutController, ThemePresenter, type PanelActions, type ShellLayoutState, type ThemeSnapshot } from './frameShared'

// ---------------------------------------------------------------------------
// 类型（本地最小面）
// ---------------------------------------------------------------------------

interface SidebarFrameProps {
  useStore: <R>(selector: (state: ShellLayoutState) => R) => R
  renderSlot: (name: string, params: Record<string, unknown>) => unknown
}

interface RootSlotEntry {
  name: 'root'
  children: Record<string, { kind: 'single' | 'list'; scope: 'root' | 'session' | 'session-maybe' }>
  store: () => unknown
  inject: (actions: PanelActions) => Record<string, never>
}

interface ShellContext {
  effect(body: () => (() => void) | void, label?: string): void
  on(event: 'theme/change', listener: (snapshot: ThemeSnapshot) => void): () => void
  reflect: { provide(name: string, service: unknown): () => void }
  slots: { register(entry: RootSlotEntry, component: unknown): () => void }
  theme: { getTheme(): ThemeSnapshot }
}

// ---------------------------------------------------------------------------
// 样式（官方 AppFrame 三列的侧栏列语义：独立列 + 右边线；overlay 同 shell 插件）
// ---------------------------------------------------------------------------

const CSS = '.dshOneSidebarShell_frame{background:var(--dsw-alias-bg-base);height:100%;display:flex;overflow:hidden;position:relative}.dshOneSidebarShell_side{flex:none;background:var(--dsw-specific-sidebar-fill);border-right:.5px solid var(--dsw-alias-border-l3);min-width:0;overflow:hidden}.dshOneSidebarShell_overlay{z-index:20;pointer-events:none;position:absolute;inset:0}'
const CSS_TAG_ID = '@dsh-one/vscode-sidebar-shell/SidebarFrame.css'
if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`) === null) {
  const tag = document.createElement('style')
  tag.dataset.plugin = '@dsh-one/vscode-sidebar-shell'
  tag.dataset.pluginCss = CSS_TAG_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
}

/** 收起后的轨宽（官方 AppFrame：sidebar 收起恒留 56px 轨）。 */
const RAIL_WIDTH = 56

/**
 * 侧栏位 frame：整列渲染官方侧栏槽。收起/展开经 store.sidebar（官方
 * AppFrame 语义：0 = 收起，值 = 展开宽度）；侧栏壳的收起按钮走
 * ctx.layout.toggleSidebar → store.toggleSidebar → 这里重渲染。
 */
function SidebarFrame({ useStore, renderSlot }: SidebarFrameProps) {
  const panels = useStore((s) => s)
  const collapsed = panels.sidebar === 0
  const width = collapsed ? RAIL_WIDTH : panels.sidebar
  return h(
    'div',
    { className: 'dshOneSidebarShell_frame', 'data-shell': 'dsh-one-sidebar' },
    h('div', { className: 'dshOneSidebarShell_side', style: { width } }, renderSlot('sidebar', { collapsed, width })),
    h('div', { className: 'dshOneSidebarShell_overlay', 'data-shell-overlay': true }, renderSlot('shell.overlay', {})),
  )
}

// ---------------------------------------------------------------------------
// cordis 插件面：inject ['slots','theme']；apply = layout 服务 + root 注册
// + ThemePresenter（结构与 label 照官方 ui-layout 两段）
// ---------------------------------------------------------------------------

export const inject = ['slots', 'theme']

export function apply(ctx: ShellContext): void {
  const layout = new LayoutController()
  ctx.effect(() => {
    const disposeService = ctx.reflect.provide('layout', layout)
    const disposeRegistration = ctx.slots.register(
      {
        name: 'root',
        children: {
          sidebar: { kind: 'single', scope: 'root' },
          'shell.overlay': { kind: 'list', scope: 'root' },
        },
        store: createLayoutStore,
        inject: (actions: PanelActions) => {
          layout.attachPanels(actions)
          return {}
        },
      },
      SidebarFrame,
    )
    return () => {
      disposeRegistration()
      disposeService()
    }
  }, 'dsh-one sidebar shell: layout service + root registration')
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
  }, 'dsh-one sidebar shell: theme presenter')
}
