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
 * - 头部抛光（#70 VS Code 验收「很生硬」返修）：品牌位影子（brand.mark/name
 *   渲染空件 priority -1）+ logoRow 整行隐藏——VS Code 原生视图头已自报
 *   家门，官方 DeepSeek 品牌块重复且占 60px；折叠钮 aria-label 隐藏与
 *   logoRow 隐藏双保险；头部密度只微调（root 上内边距 12→8px、顶 padding
 *   6→4px），官方其余默认不动。品牌块想换 DSH One 鲸鱼 logo 时，把两个
 *   空件换成渲染件即可（座位贡献点不变）。
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
  slots: {
    register(entry: unknown, component: unknown): () => void
    /** 等目标名被任一 entry 的 children 表声明后再注册（官方贡献的正规挂法）。 */
    inject(name: string, factory: () => unknown): () => void
  }
  theme: { getTheme(): ThemeSnapshot }
}

/** 品牌位空件：single 槽最低优先级（-1 < 官方默认 0）顶掉 ui-brand-official。 */
function Nothing(): null {
  return null
}

// ---------------------------------------------------------------------------
// 样式：侧栏列 100% 流体（右边线保留，与官方 sidebarCol 视觉一致）；收起钮/
// 收起轨隐藏——VS Code WebviewView 形态无「内页收起」概念，折叠由 VS Code
// chrome 负责。aria-label 选择器覆盖官方便携类（哈希类名不可依赖）。
// ---------------------------------------------------------------------------

// logoRow 隐藏用 [class*="logoRow"]（css-module 名后缀稳定、哈希前缀随版本变）；
// 折叠钮 aria-label 规则保留作双保险（zh/en 双词典，CSS 转义写中文）。
const CSS = '.dshOneSidebarShell_frame{background:var(--dsw-alias-bg-base);height:100%;display:flex;overflow:hidden;position:relative}.dshOneSidebarShell_side{flex:1;min-width:0;background:var(--dsw-specific-sidebar-fill);border-right:.5px solid var(--dsw-alias-border-l3);overflow:hidden}.dshOneSidebarShell_side [class*="logoRow"]{display:none}.dshOneSidebarShell_side button[aria-label="Collapse sidebar"],.dshOneSidebarShell_side button[aria-label="\\6536\\8d77\\4fa7\\680f"]{display:none}.dshOneSidebarShell_side>[class*="root"]{--dsh-sidebar-inline-padding:8px;padding-top:4px}.dshOneSidebarShell_overlay{z-index:20;pointer-events:none;position:absolute;inset:0}'
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
    // 品牌位影子：藏掉官方 DeepSeek 品牌块（VS Code 原生视图头已自报家门，
    // 双重品牌头「很生硬」#70 验收返修）。想换自有品牌时把 Nothing 换成渲染件。
    const disposeBrandMark = ctx.slots.inject('sidebar.brand.mark', () =>
      ctx.slots.register({ name: 'sidebar.brand.mark', priority: -1 }, Nothing),
    )
    const disposeBrandName = ctx.slots.inject('sidebar.brand.name', () =>
      ctx.slots.register({ name: 'sidebar.brand.name', priority: -1 }, Nothing),
    )
    return () => {
      disposeBrandMark()
      disposeBrandName()
      disposeRegistration()
      disposeService()
    }
  }, 'dsh-one sidebar shell: layout service + root registration + brand shadow')
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
