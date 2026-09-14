/**
 * @dsh-one/vscode-sidebar-shell——侧栏位 frame 插件（#70）：顶替下线的官方
 * ui-layout，官方侧栏（品牌位/工作区树/设置入口/底部动作条）原样进 VS Code
 * 侧栏 view。spike #69 题1 已验证裸 frame 里侧栏完整、数据正常。
 *
 * - root 槽注册：children 只声明 sidebar + shell.overlay（conversation/details
 *   等 chat 树槽位不声明，对应贡献静默缺席——chat 树有独立 frame）。
 * - 宽度形态（#70 VS Code 验收项 2）：WebviewView 宽度由 VS Code 拖拽决定
 *   （240~560+px 都可能），frame 不做固定 280/56 轨——侧栏列 100% 流体，
 *   ResizeObserver 量出容器实际宽度传给官方 SidebarRoot（官方壳按
 *   renderSlot 的 width 参数定列宽），恒展开；收起钮在此形态下隐藏（折叠
 *   归 VS Code chrome 管），frame CSS 按 aria-label 覆盖（官方便携类名是
 *   哈希的，aria-label 文案随官方词典稳定）。
 * - 设置入口 = 齿轮影子（@dsh-one/vscode-settings-gear，priority -1），
 *   点击 postMessage 宿主开设置面板（设置独立成页，见
 *   @dsh-one/vscode-settings-shell）。
 *
 * 构建与打包约束同 clientEntry.ts（esbuild banner/footer 包自注册 IIFE，
 * externals 种子表满足）。
 */
import { createElement as h, useEffect, useRef, useState } from 'react'
import { createLayoutStore, LayoutController, ThemePresenter, type ThemeSnapshot } from './frameShared'

// ---------------------------------------------------------------------------
// 类型（本地最小面）
// ---------------------------------------------------------------------------

interface SidebarFrameProps {
  renderSlot: (name: string, params: Record<string, unknown>) => unknown
}

interface RootSlotEntry {
  name: 'root'
  children: Record<string, { kind: 'single' | 'list'; scope: 'root' | 'session' | 'session-maybe' }>
  store: () => unknown
  inject: (actions: { openDetails(): void; closeDetails(): void; toggleSidebar(): void }) => Record<string, never>
}

interface ShellContext {
  effect(body: () => (() => void) | void, label?: string): void
  on(event: 'theme/change', listener: (snapshot: ThemeSnapshot) => void): () => void
  reflect: { provide(name: string, service: unknown): () => void }
  slots: { register(entry: unknown, component: unknown): () => void }
  theme: { getTheme(): ThemeSnapshot }
}

// ---------------------------------------------------------------------------
// 样式：侧栏列 100% 流体（右边线保留，与官方 sidebarCol 视觉一致）；收起钮/
// 收起轨隐藏——VS Code WebviewView 形态无「内页收起」概念，折叠由 VS Code
// chrome 负责。aria-label 选择器覆盖官方便携类（哈希类名不可依赖）。
// ---------------------------------------------------------------------------

const CSS = '.dshOneSidebarShell_frame{background:var(--dsw-alias-bg-base);height:100%;display:flex;overflow:hidden;position:relative}.dshOneSidebarShell_side{flex:1;min-width:0;background:var(--dsw-specific-sidebar-fill);border-right:.5px solid var(--dsw-alias-border-l3);overflow:hidden}.dshOneSidebarShell_side button[aria-label="Collapse sidebar"],.dshOneSidebarShell_side button[aria-label="收起侧栏"]{display:none}.dshOneSidebarShell_overlay{z-index:20;pointer-events:none;position:absolute;inset:0}'
const CSS_TAG_ID = '@dsh-one/vscode-sidebar-shell/SidebarFrame.css'
if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`) === null) {
  const tag = document.createElement('style')
  tag.dataset.plugin = '@dsh-one/vscode-sidebar-shell'
  tag.dataset.pluginCss = CSS_TAG_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
}

/**
 * 侧栏位 frame：整列渲染官方侧栏槽。宽度 = 容器实测宽（ResizeObserver），
 * 恒展开传 collapsed:false——官方 SidebarRoot 按 width 参数定列宽，240px
 * 窄宽也完整（内容区自适应，不闪现收起轨）。
 */
function SidebarFrame({ renderSlot }: SidebarFrameProps) {
  const sideRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(320)
  useEffect(() => {
    const el = sideRef.current
    if (el === null) return
    const measure = (): void => {
      const next = el.clientWidth
      if (next > 0) setWidth(next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return h(
    'div',
    { className: 'dshOneSidebarShell_frame', 'data-shell': 'dsh-one-sidebar' },
    h('div', { className: 'dshOneSidebarShell_side', ref: sideRef }, renderSlot('sidebar', { collapsed: false, width })),
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
        inject: (actions: { openDetails(): void; closeDetails(): void; toggleSidebar(): void }) => {
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
