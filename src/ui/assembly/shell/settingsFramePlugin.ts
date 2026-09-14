/**
 * @dsh-one/vscode-settings-shell——settings 树 frame 插件（#70 设置独立成页，
 * VS Code 验收项 3）。设置页 = 第三棵装配树：
 * - block list 同 chat 树（layout + sidebar 都下线）：官方外框与官方侧栏壳
 *   不进页（ui-sidebar 的槽注册在无人声明 'sidebar' 时 loud throw，必须下线）。
 * - root 声明侧栏壳的 5 个子槽（品牌位/工作区树/设置入口/底部动作）——对应
 *   贡献照常注册但不渲染；另声明自有 'dshOne.settings.page' 座位并只渲染它。
 * - 整页宿主直接渲染官方 settings.* 座位（header/action/close/section 列表），
 *   官方 SettingsRoot（触发行 + modal）不进页——它经 settings-general 的
 *   inject("sidebar.settings") 注册，而 sidebar.settings 声明在 root children
 *   里、本页只渲染 dshOne.settings.page，官方 modal 壳自然缺席。
 *
 * 为什么不是「priority -1 影子 SettingsRoot」：单槽影子可行，但官方
 * SettingsRoot 的 children 表（settings.trigger/section/…）与本件重复声明
 * 会撞 registry 的「already declared」抛错（两个注册都会带 children 表）。
 * 绕过 SettingsRoot、直接占据 settings.* 座位则零冲突：settings-general 的
 * settings.section/settings.header/settings.action/settings.close 贡献经
 * inject 挂到本件的 children 声明上，General/Models/Plugins/Agent presets
 * 四节照常进页。
 */
import { createElement as h } from 'react'
import { createLayoutStore, LayoutController, ThemePresenter, type ThemeSnapshot } from './frameShared'

// ---------------------------------------------------------------------------
// 类型（本地最小面）
// ---------------------------------------------------------------------------

interface SettingsFrameProps {
  renderSlot: (name: string, params: Record<string, unknown>) => unknown
}

interface RootSlotEntry {
  name: 'root'
  children: Record<string, { kind: 'single' | 'list'; scope: 'root' | 'session' | 'session-maybe' }>
  store: () => unknown
  inject: (actions: { openDetails(): void; closeDetails(): void; toggleSidebar(): void }) => Record<string, never>
}

interface SettingsPageEntry {
  name: 'dshOne.settings.page'
  children: Record<string, { kind: 'single' | 'list'; scope: 'root' | 'session' | 'session-maybe' }>
}

interface ShellContext {
  effect(body: () => (() => void) | void, label?: string): void
  on(event: 'theme/change', listener: (snapshot: ThemeSnapshot) => void): () => void
  reflect: { provide(name: string, service: unknown): () => void }
  slots: { register(entry: unknown, component: unknown): () => void }
  theme: { getTheme(): ThemeSnapshot }
}

// ---------------------------------------------------------------------------
// 样式：整页宿主壳（导航位 + 分区滚动区；分区与行样式由官方各 section 自带）
// ---------------------------------------------------------------------------

const CSS = '.dshOneSettingsShell_page{background:var(--dsw-alias-bg-base);height:100%;display:flex;flex-direction:column;overflow:hidden}.dshOneSettingsShell_header{flex:none;box-sizing:border-box;height:54px;display:flex;align-items:center;gap:12px;padding:20px 14px 8px 10px}.dshOneSettingsShell_title{flex:1;min-width:0;font-size:16px;font-weight:500;line-height:24px;color:var(--dsw-alias-label-primary)}.dshOneSettingsShell_actions{flex:none;display:flex;align-items:center;gap:8px;min-width:0}.dshOneSettingsShell_sections{flex:1;min-height:0;overflow-y:auto;padding:0 24px 24px}'
const CSS_TAG_ID = '@dsh-one/vscode-settings-shell/SettingsPage.css'
if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`) === null) {
  const tag = document.createElement('style')
  tag.dataset.plugin = '@dsh-one/vscode-settings-shell'
  tag.dataset.pluginCss = CSS_TAG_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
}

/**
 * 整页宿主：标题（settings.header = 官方 "Settings" 文案）+ 动作
 * （settings.action = Open configuration file）+ 官方 settings.section 列表
 * 全量堆叠（无导航选中语义——官方 modal 用 only:active 单节渲染；整页形态
 * 全节铺开更符合 VS Code 设置页心智）。
 */
function SettingsPage({ renderSlot }: SettingsFrameProps) {
  return h(
    'div',
    { className: 'dshOneSettingsShell_page', 'data-shell': 'dsh-one-settings' },
    h(
      'div',
      { className: 'dshOneSettingsShell_header' },
      h('div', { className: 'dshOneSettingsShell_title' }, renderSlot('settings.header', {})),
      h('div', { className: 'dshOneSettingsShell_actions' }, renderSlot('settings.action', {})),
    ),
    h('div', { className: 'dshOneSettingsShell_sections' }, renderSlot('settings.section', {})),
  )
}

/** 根组件：整页只渲染 settings page 座位。 */
function SettingsFrame({ renderSlot }: SettingsFrameProps) {
  return h('div', { className: 'dshOneSettingsShell_root', style: { height: '100%' } }, renderSlot('dshOne.settings.page', {}))
}

// ---------------------------------------------------------------------------
// cordis 插件面：layout 服务 + root 注册（5 子槽 + settings page + overlay）
// + SettingsPage 座位 + ThemePresenter
// ---------------------------------------------------------------------------

export const inject = ['slots', 'theme']

export function apply(ctx: ShellContext): void {
  const layout = new LayoutController()
  ctx.effect(() => {
    const disposeService = ctx.reflect.provide('layout', layout)
    // 先注册 root（children 声明同步落 ledger），同 effect 内紧接着注册
    // settings page 座位（root 已声明该名，register 的声明检查通过）。
    const disposeRoot = ctx.slots.register(
      {
        name: 'root',
        children: {
          // 侧栏壳 5 子槽：贡献照常注册（ui-brand-official/ui-workspace/
          // ui-settings-general/ui-cordis 的 inject 挂上来），本页不渲染。
          'sidebar.brand.mark': { kind: 'single', scope: 'root' },
          'sidebar.brand.name': { kind: 'single', scope: 'root' },
          'sidebar.workspaces': { kind: 'single', scope: 'root' },
          'sidebar.settings': { kind: 'single', scope: 'root' },
          'sidebar.footer.action': { kind: 'list', scope: 'root' },
          // 自有整页座位：本页唯一渲染对象。
          'dshOne.settings.page': { kind: 'single', scope: 'root' },
          'shell.overlay': { kind: 'list', scope: 'root' },
        },
        store: createLayoutStore,
        inject: (actions: { openDetails(): void; closeDetails(): void; toggleSidebar(): void }) => {
          layout.attachPanels(actions)
          return {}
        },
      },
      SettingsFrame,
    )
    const disposePage = ctx.slots.register(
      {
        name: 'dshOne.settings.page',
        // 官方 settings.* 座位声明在这——settings-general 的 inject 与
        // settings-models/plugins 的 section 贡献都挂这些名字。
        children: {
          'settings.header': { kind: 'single', scope: 'root' },
          'settings.action': { kind: 'list', scope: 'root' },
          'settings.close': { kind: 'single', scope: 'root' },
          'settings.section': { kind: 'list', scope: 'root' },
          'settings.onboarding': { kind: 'list', scope: 'root' },
        },
      },
      SettingsPage,
    )
    return () => {
      disposePage()
      disposeRoot()
      disposeService()
    }
  }, 'dsh-one settings shell: layout service + root + settings page seat')
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
  }, 'dsh-one settings shell: theme presenter')
}
