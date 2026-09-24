/**
 * @dsh-one/vscode-plugins-ui-layout——plugins 树 frame 插件（#247 官方插件页独立成页）。
 * 页面 = 官方那个「插件」全局面板本身（`@deepseek-ai/dsh-client-ui-plugin-manager`，
 * keyed `main` 上的 key `plugins`），照设置页（#70 / #95）的先例单开一个 VS Code
 * 编辑器页。
 *
 * ## 为什么需要这一棵树
 *
 * 官方 web 里那一页住在 **keyed `main`** 上（key = `plugins`），由官方外框按
 * `panelInfo.activePanelId` 取键渲染。我们的 shell 不按选中态取键（三棵树的 frame
 * 都按 key 显式取），四个 webview 又各是一棵独立的树——所以「侧栏点那一行打开这一页」
 * 这件事在任何一棵既有树上都没有落点：它的入口在侧栏 webview、页面本体却在另一份
 * 装配里。这一棵树就是那个页面在 VS Code 侧的落点，与设置页同一个形状。
 *
 * ## 为什么不可移植（文件头按约定写明理由）
 *
 * 它渲染的是**我们自己的外框容器**，并且它的存在意义就是「把这一页放进 VS Code 的
 * 编辑器页」——两件事都是 VS Code 容器适配：官方 web 侧这一页本来就由官方外框渲染，
 * 不需要第二个 frame；官方也没有「编辑器页」这个容器。所以命名是 `vscode-*`
 * （AGENTS.md 的命名分两类），不进 `packages/`。
 *
 * ## root children 为什么只有两项
 *
 * `main`（keyed, root）是这一页的本体所在：我们声明它，官方 `ui-plugin-manager` 的
 * `slots.inject("main", …)` 回调才会跑、那条 key = `plugins` 的条目才会注册进来
 * （官方语义：槽名没被任何父条目的 children 表声明时，`slots.inject` 的回调永不跑
 * ——「停车」），它自己声明的那三个子座（`plugins.item` / `plugins.bundle.config` /
 * `plugins.row.config`）随之落下，官方那四张配置卡才有地方注册。
 *
 * `shell.overlay`（list, root）是官方 root 契约里的一项，与其余两棵 frame 树同一条
 * 理由：声明它，挂在这个名字上的官方贡献才不会因为「我们的 root 表缺一项」而停车
 * （接手官方 ui-layout 契约的清单见 frameShared.ts 文件头）。本页只渲染 `main`，
 * overlay 里没有入口（与设置页同一个形态）。
 *
 * **有意不声明 `settings.*` / `sidebar.*` / `rightbar`**：这一页不是设置页也不是
 * 侧栏位页，声明它们会把官方那些页面的贡献拉进来（`block list` 那边对应的理由写在
 * wireFilter.ts 的 `PLUGINS_BLOCK_LIST`）。
 */
import { createElement as h } from 'react'
import {
  LayoutController,
  PANEL_INFO_SOURCE,
  PLUGINS_PANEL_ID,
  ThemePresenter,
  createLayoutStore,
  type PanelActions,
  type ThemeSnapshot,
} from './frameShared'
import { installExternalLinkShim } from './externalLinkShim'

// ---------------------------------------------------------------------------
// 类型（本地最小面）
// ---------------------------------------------------------------------------

interface PluginsFrameProps {
  renderSlot: (name: string, params: Record<string, unknown>, opts?: { entryKey?: string }) => unknown
}

interface ShellContext {
  effect(body: () => (() => void) | void, label?: string): void
  on(event: 'theme/change', listener: (snapshot: ThemeSnapshot) => void): () => void
  reflect: { provide(name: string, service: unknown): () => void }
  slots: {
    register(entry: unknown, component: unknown): () => void
    /** 等目标名被任一 entry 的 children 表声明后再注册（官方贡献的正规挂法）。 */
    inject(name: string, factory: () => unknown): () => void
    entries(name: string): { options: { key?: string } }[]
    /** 官方 root 槽位钩子/数据发布口（官方 ui-layout 的 panelInfo 同款调用点）。 */
    provideRoot(contribution: { hooks: { panelInfo: typeof PANEL_INFO_SOURCE } }): () => void
  }
  theme: { getTheme(): ThemeSnapshot }
}

// ---------------------------------------------------------------------------
// 样式：容器占满编辑器页；官方那一页自己负责滚动与留白
// （`PluginManagerPage` 的 `.page` 是 `height:100%;overflow:auto`，所以要一个
// 有确定高度的父容器）。`data-plugin` 标记同时是 CONTRACT 套件认「这个 frame
// 插件真的执行了」的锚点（官方插件不写这个属性）。
// ---------------------------------------------------------------------------

const CSS = '.dshOnePluginsShell_root{height:100%;background:var(--dsw-alias-bg-base);display:flex;flex-direction:column;min-height:0}.dshOnePluginsShell_root>*{flex:1;min-height:0}'
const CSS_TAG_ID = '@dsh-one/vscode-plugins-ui-layout/PluginsPage.css'
if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`) === null) {
  const tag = document.createElement('style')
  tag.dataset.plugin = '@dsh-one/vscode-plugins-ui-layout'
  tag.dataset.pluginCss = CSS_TAG_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
}

/**
 * 整页只渲染 keyed `main` 上 key = `plugins` 的那条条目（官方 AppFrame 的 MainPanel
 * 同款取键方式：`renderSlot(<槽位名>, <props>, { entryKey: <面板 key> })`；key 取自
 * 官方 `ui-plugin-manager` 的 `PANEL_ID`，见 frameShared.PLUGINS_PANEL_ID）。
 */
function PluginsFrame({ renderSlot }: PluginsFrameProps) {
  return h(
    'div',
    { className: 'dshOnePluginsShell_root', 'data-shell': 'dsh-one-plugins' },
    renderSlot('main', {}, { entryKey: PLUGINS_PANEL_ID }),
  )
}

// ---------------------------------------------------------------------------
// cordis 插件面：layout 服务 + root 注册（keyed main + overlay）+ ThemePresenter
// ---------------------------------------------------------------------------

export const inject = ['slots', 'theme']

export function apply(ctx: ShellContext): void {
  // selectPanel 的合法性判据照官方取 keyed `main` 的实时注册表——本树 `main` 上只有
  // 官方插件页那一条 keyed 条目（key = plugins），所以这里也是「本页选中自己的那个
  // 面板」这条语义的落点。没有 openPanel 处置：本树不承接任何跨 webview 的入口
  //（侧栏那一行由 **sidebar 树**的 layout 服务受理，见 sidebarLayoutPlugin）。
  const layout = new LayoutController({
    hasMainPanel: (panelId) => ctx.slots.entries('main').some((entry) => entry.options.key === panelId),
  })
  ctx.effect(() => {
    const disposeService = ctx.reflect.provide('layout', layout)
    // 官方 root 槽位钩子 panelInfo（机制层 1：官方槽位机制）。本页恒定 null：这一页
    // 只有一个面板、没有「会话面板 vs 全局面板」的切换，官方 web 里这一页自己也是
    // 靠外框传下来的 activePanelId 选中，我们直接按 key 取条目，不需要选中态
    //（理由与其余两棵树同，见 frameShared 的 PANEL_INFO_SOURCE）。
    const disposePanelInfo = ctx.slots.provideRoot({ hooks: { panelInfo: PANEL_INFO_SOURCE } })
    const disposeRoot = ctx.slots.register(
      {
        name: 'root',
        children: {
          main: { kind: 'keyed', scope: 'root' },
          'shell.overlay': { kind: 'list', scope: 'root' },
        },
        store: createLayoutStore,
        inject: (actions: PanelActions) => {
          layout.attachPanels(actions)
          return {}
        },
      },
      PluginsFrame,
    )
    return () => {
      disposeRoot()
      disposePanelInfo()
      disposeService()
    }
  }, 'dsh-one plugins shell: layout service + panel-info hook + root registration')
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
  }, 'dsh-one plugins shell: theme presenter')
  // #150：外链锚点的捕获阶段兜底（四棵树共用同一份实现，见 externalLinkShim.ts）。
  ctx.effect(() => installExternalLinkShim(), 'dsh-one plugins shell: external link takeover')
}
