/**
 * @dsh-one/vscode-settings-shell——settings 树 frame 插件（#70 设置独立成页，
 * VS Code 验收返修 v2：官方双栏观感 + 提供方目录修复）。设置页 = 第三棵装配树：
 * - block list 同 chat 树（layout + sidebar 都下线）：官方外框与官方侧栏壳
 *   不进页（ui-sidebar 的槽注册在无人声明 'sidebar' 时 loud throw）。
 * - root 声明侧栏壳 4 子槽（品牌位/工作区树/品牌名/底部动作，贡献注册不渲染）
 *   + 自有 'dshOne.settings.page' 槽位并只渲染它。**有意不声明 sidebar.settings**：
 *   声明会同步触发 settings-general 的 SettingsRoot inject，其 children 表与
 *   本页槽位撞 registry「already declared」（绕行而非 priority 影子，同 v1）。
 * - 整页宿主 = 官方 SettingsPanel 组合复刻：居中限宽内容列（官方 panel 宽
 *   800px，取同款 max-width:800px / calc(100vw - 32px)）+ 左侧分节导航
 *   （General/Models/Plugins/Agent presets，当前节高亮 aria-current，点击切节）
 *   + 内容区 renderSlot('settings.section', {}, { only: active }) 单节渲染——
 *   导航行来自官方同款推导（slots.entries('settings.section') 的 id/order/
 *   label，按槽版本 + locale 修订缓存，双订阅），与官方弹窗观感对齐。
 * - Models「settings are unavailable in this browser」根因修复在 pageHtml 的
 *   __DSH_TRANSPORT__.ownsHost（client-connection isLoopback 判定），此处消费。
 */
import { createElement as h, useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { createLayoutStore, LayoutController, PANEL_INFO_SOURCE, ThemePresenter, type PanelActions, type ThemeSnapshot } from './frameShared'

// ---------------------------------------------------------------------------
// 类型（本地最小面）
// ---------------------------------------------------------------------------

interface SectionRow {
  id: string
  order: number
  label: string
}

interface SectionsMirror {
  getSnapshot(): SectionRow[]
  subscribe(listener: () => void): () => void
}

interface SettingsFrameProps {
  renderSlot: (name: string, params: Record<string, unknown>, opts?: { only?: string }) => unknown
  sections: SectionsMirror
}

interface RootSlotEntry {
  name: 'root'
  children: Record<string, { kind: 'single' | 'list'; scope: 'root' | 'session' | 'session-maybe' }>
  store: () => unknown
  inject: (actions: PanelActions) => Record<string, never>
}

interface SlotEntryLite {
  options: { id?: string; order?: number; label?: unknown }
}

interface SlotsService {
  register(entry: unknown, component: unknown): () => void
  inject(name: string, factory: () => unknown): () => void
  entries(name: string): SlotEntryLite[]
  getVersion(name: string): number
  subscribe(name: string, listener: () => void): () => void
  /** 官方 root 槽位钩子/数据发布口（官方 ui-layout 的 panelInfo 同款调用点）。 */
  provideRoot(contribution: { hooks: { panelInfo: typeof PANEL_INFO_SOURCE } }): () => void
}

interface LocaleService {
  getSnapshot(): { revision: number }
  subscribe(listener: () => void): () => void
  /** 注册自有命名空间词典（ui-settings-general 同款 API，机制层 2）。 */
  register(ns: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): () => void
}

interface ShellContext {
  effect(body: () => (() => void) | void, label?: string): void
  on(event: 'theme/change', listener: (snapshot: ThemeSnapshot) => void): () => void
  reflect: { provide(name: string, service: unknown): () => void }
  slots: SlotsService
  locale: LocaleService
  theme: { getTheme(): ThemeSnapshot }
}

// ---------------------------------------------------------------------------
// 样式：官方 SettingsPanel 双栏观感——居中限宽列（panel 800px 同款）、左导航
// 188px、内容区滚动；窄视口整列自适应。
// ---------------------------------------------------------------------------

const CSS = '.dshOneSettingsShell_page{background:var(--dsw-alias-bg-base);height:100%;display:flex;justify-content:center;overflow:hidden}.dshOneSettingsShell_column{box-sizing:border-box;width:800px;max-width:calc(100vw - 32px);height:100%;display:flex;overflow:hidden}.dshOneSettingsShell_nav{flex:none;box-sizing:border-box;width:188px;flex-direction:column;gap:4px;border-right:.5px solid var(--dsw-alias-border-l3);padding:22px 12px 12px;display:flex}.dshOneSettingsShell_navTitle{padding:0 12px 14px;font-size:16px;font-weight:500;line-height:24px;color:var(--dsw-alias-label-primary)}.dshOneSettingsShell_navCell{box-sizing:border-box;cursor:pointer;height:40px;color:var(--dsw-alias-label-primary);text-align:left;background:0 0;border:none;border-radius:12px;align-items:center;gap:8px;padding:9px 16px 9px 12px;font-family:inherit;font-size:14px;line-height:22px;display:flex}.dshOneSettingsShell_navCell:hover{background:var(--dsw-specific-sidebar-nav-item-hover)}.dshOneSettingsShell_navCell[data-active]{background:var(--dsw-specific-sidebar-nav-item-active)}.dshOneSettingsShell_navLabel{white-space:nowrap;text-overflow:ellipsis;flex:1;min-width:0;overflow:hidden}.dshOneSettingsShell_content{flex:1;min-width:0;flex-direction:column;display:flex;overflow:hidden}.dshOneSettingsShell_actions{flex:none;box-sizing:border-box;height:54px;display:flex;justify-content:flex-end;align-items:flex-start;gap:8px;padding:20px 14px 8px 10px}.dshOneSettingsShell_sections{flex:1;min-height:0;overflow-y:auto;padding:0 24px 24px}.dshOneSettingsShell_sections [data-slot="settings.general.item"]>*:has(button[aria-pressed]){display:none}.dshOneSettingsShell_actions [data-slot="settings.action"]>*:not(:has([data-dshone-doc-action])){display:none}'
const CSS_TAG_ID = '@dsh-one/vscode-settings-shell/SettingsPage.css'
if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`) === null) {
  const tag = document.createElement('style')
  tag.dataset.plugin = '@dsh-one/vscode-settings-shell'
  tag.dataset.pluginCss = CSS_TAG_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
}

/** 官方同款 section 行推导（官方机制第 2 层：ctx.slots 服务公开 API——
 * entries/getVersion/subscribe，官方 SettingsRoot 的 shellInjected 同款）。
 * 槽版本 + locale 修订缓存。 */
function createSectionsMirror(ctx: ShellContext): SectionsMirror {
  let rowsVersion = -1
  let rowsRevision = -1
  let rows: SectionRow[] = []
  return {
    getSnapshot() {
      const version = ctx.slots.getVersion('settings.section')
      const revision = ctx.locale.getSnapshot().revision
      if (version !== rowsVersion || revision !== rowsRevision) {
        rowsVersion = version
        rowsRevision = revision
        rows = ctx.slots
          .entries('settings.section')
          .map((e) => ({
            id: e.options.id ?? '',
            order: e.options.order ?? 0,
            label: resolveSlotLabel(e.options.label) ?? '',
          }))
          .sort((a, b) => a.order - b.order)
      }
      return rows
    },
    subscribe(listener) {
      const offLedger = ctx.slots.subscribe('settings.section', listener)
      const offLocale = ctx.locale.subscribe(listener)
      return () => {
        offLedger()
        offLocale()
      }
    },
  }
}

function resolveSlotLabel(label: unknown): string | undefined {
  if (typeof label === 'function') return (label as () => string)()
  return typeof label === 'string' ? label : undefined
}

/**
 * 整页宿主（官方 SettingsPanel 组合复刻；官方机制第 1/2 层：renderSlot 的
 * list 槽位 only 过滤是框架原生选项，官方 SettingsPanel 同款）：
 * 左分节导航 + 右内容单节渲染（only:active），当前节高亮；
 * 导航行订阅槽/语言变化，节缺席自动回落首行。
 */
function SettingsPage({ renderSlot, sections }: SettingsFrameProps) {
  const rows = sections.getSnapshot()
  const [activeId, setActiveId] = useState<string | undefined>(rows[0]?.id)
  const [tick, setTick] = useState(0)
  useEffect(() => sections.subscribe(() => setTick(tick + 1)), [sections, tick])
  void tick // 订阅驱动重渲染（getSnapshot 在渲染期取新值）
  const latest = sections.getSnapshot()
  const active = latest.some((r) => r.id === activeId) ? activeId : latest[0]?.id
  return h(
    'div',
    { className: 'dshOneSettingsShell_page', 'data-shell': 'dsh-one-settings' },
    h(
      'div',
      { className: 'dshOneSettingsShell_column' },
      h(
        'nav',
        { className: 'dshOneSettingsShell_nav' },
        h('div', { className: 'dshOneSettingsShell_navTitle' }, renderSlot('settings.header', {})),
        ...latest.map((row) =>
          h(
            'button',
            {
              key: row.id,
              type: 'button',
              className: 'dshOneSettingsShell_navCell',
              'data-active': row.id === active ? '' : undefined,
              'aria-current': row.id === active ? 'true' : undefined,
              onClick: () => setActiveId(row.id),
            },
            h('span', { className: 'dshOneSettingsShell_navLabel' }, row.label),
          ),
        ),
      ),
      h(
        'div',
        { className: 'dshOneSettingsShell_content' },
        h('div', { className: 'dshOneSettingsShell_actions' }, renderSlot('settings.action', {})),
        active !== undefined
          ? h('div', { className: 'dshOneSettingsShell_sections' }, renderSlot('settings.section', {}, { only: active }))
          : null,
      ),
    ),
  )
}

/** 「打开配置文件」自有行动（机制层 1：settings.action 是 list 槽位，追加
 * id 'open-document-vscode' 贡献；外观用官方 Button 原语与官方
 * SettingsDocumentAction 同款，点击 postMessage 宿主走 VS Code 编辑器——
 * 官方实现是 remote.settings.openSettingsDocument RPC 由网关宿主打开，无
 * 客户端改道钩子（机制层 3 不存在：SettingsDocumentStore.open 直调 RPC）。 */
function OpenDocAction({ t }: { t: (key: string) => string }) {
  const tr = t
  return h(
    'div',
    { 'data-dshone-doc-action': '', style: { display: 'flex', gap: '8px', alignItems: 'center' } },
    h(Button, { variant: 'outline', size: 'sm', onClick: postOpenDocument }, tr('openDocument')),
  )
}

const postOpenDocument = (): void => {
  const g = globalThis as {
    __DSH_ONE_VSCODE__?: { postMessage(msg: unknown): void }
    acquireVsCodeApi?: () => { postMessage(msg: unknown): void }
  }
  let vscode = g.__DSH_ONE_VSCODE__
  if (vscode === undefined && typeof g.acquireVsCodeApi === 'function') {
    try {
      vscode = g.acquireVsCodeApi()
      g.__DSH_ONE_VSCODE__ = vscode
    } catch {
      /* 二次 acquire throw（probe 已持有且全局缺失，不应发生） */
    }
  }
  vscode?.postMessage({ type: 'dshOne.openSettingsDocument' })
}

/** 根组件：整页只渲染 settings page 槽位。 */
function SettingsFrame({ renderSlot }: { renderSlot: SettingsFrameProps['renderSlot'] }) {
  return h('div', { className: 'dshOneSettingsShell_root', style: { height: '100%' } }, renderSlot('dshOne.settings.page', {}))
}

// ---------------------------------------------------------------------------
// 外观行屏蔽（官方机制第 4 层 CSS——前 3 层经源码确认无机制，举证）：
// ①第 1 层槽位：settings.general.item 是 list 槽位（registry 对 list 只拒
//   同 id+同 priority 冲突，异 priority 并存渲染；client-runner 根槽文档明
//   说 list 是 additive）——影子只叠加不移除，无法屏蔽（ui-theme client.js
//   注册行实锤：id 'appearance' 的 list 贡献）；
// ②第 2 层服务：AppearanceRow 自持 store 直挂 theme/change（ui-theme
//   client.js AppearanceRow/createAppearanceRowStore），不经 settingsSchema/
//   settingsScope 字段表，无按 id 过滤的服务口（settingsSchema 只服务
//   settings-models 的提供方路径操作，见 ui-settings-models createSettings-
//   SchemaOperations 调用点）；
// ③第 3 层接缝：__DSH_TRANSPORT__/__DSH_BOOT__ 与行级呈现无关。
// 选择器稳定性：data-slot 是框架给 list 渲染容器的槽位名属性（实测本
// 框架把整组 list 项装进一个 display:contents 容器，故用 >* 逐行命中；
// 官方 GeneralSection CSS 同款消费该属性）；:has(button[aria-pressed])
// 结构伪类命中外观行三态方块（aria-pressed 是其选中态 a11y 契约，实测
// 六行中唯一）——字号步进器与其余三个下拉均无 aria-pressed 按钮；不依赖
// css-module 哈希（行根类 _group_<hash> 随版本变，弃用）。
// 作用域限本树（本 bundle 只进 settings 树），官方 web 零影响、设置数据
// 零改动；装配页主题跟随（theme-follow 覆写）与官方 web 外观设定各自
// 独立、互不回写。
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// cordis 插件面：layout 服务 + root 注册（4 子槽 + settings page + overlay）
// + SettingsPage 槽位（inject 供 sections 镜像）+ ThemePresenter
// ---------------------------------------------------------------------------

export const inject = ['slots', 'theme', 'locale']

export function apply(ctx: ShellContext): void {
  const layout = new LayoutController()
  const sections = createSectionsMirror(ctx)
  ctx.effect(() => {
    const disposeService = ctx.reflect.provide('layout', layout)
    // 官方 root 槽位钩子 panelInfo（机制层 1：官方槽位机制）：本页不渲染任何
    // 会话树，但设置页里的官方件（如「已归档会话」）同样经槽位拿标准 props，
    // 缺了这份钩子会在挂载时抛 `usePanelInfo is not a function`。见 frameShared。
    const disposePanelInfo = ctx.slots.provideRoot({ hooks: { panelInfo: PANEL_INFO_SOURCE } })
    // 先注册 root（children 声明同步落 ledger），同 effect 内紧接着注册
    // settings page 槽位。注意 root children 不声明 sidebar.settings——
    // 声明该名会同步触发 settings-general 的 SettingsRoot inject，其
    // children 表（settings.*）与本页槽位撞「already declared」抛错；
    // 不声明则该贡献 pending（chat 树 parked 语义），官方 modal 壳缺席。
    const disposeRoot = ctx.slots.register(
      {
        name: 'root',
        children: {
          'sidebar.brand.mark': { kind: 'single', scope: 'root' },
          'sidebar.brand.name': { kind: 'single', scope: 'root' },
          'sidebar.workspaces': { kind: 'single', scope: 'root' },
          'sidebar.footer.action': { kind: 'list', scope: 'root' },
          'dshOne.settings.page': { kind: 'single', scope: 'root' },
          'shell.overlay': { kind: 'list', scope: 'root' },
        },
        store: createLayoutStore,
        inject: (actions: PanelActions) => {
          layout.attachPanels(actions)
          return {}
        },
      },
      SettingsFrame,
    )
    // 自有「打开配置文件」行动（list 槽位追加贡献，机制层 1）。
    const disposeDocAction = ctx.slots.inject('settings.action', () =>
      ctx.slots.register(
        {
          name: 'settings.action',
          id: 'open-document-vscode',
          order: 1,
          locale: 'dshOneSettings',
          inject: () => ({}),
        },
        OpenDocAction,
      ),
    )
    const disposeLocale = ctx.locale.register('dshOneSettings', {
      zh: { openDocument: '\u6253\u5f00\u914d\u7f6e\u6587\u4ef6' },
      en: { openDocument: 'Open configuration file' },
    })
    const disposePage = ctx.slots.register(
      {
        name: 'dshOne.settings.page',
        // 官方 settings.* 槽位声明在这——settings-general/models/plugins
        // 的 section 贡献与行注入都挂这些名字。
        children: {
          'settings.header': { kind: 'single', scope: 'root' },
          'settings.action': { kind: 'list', scope: 'root' },
          'settings.close': { kind: 'single', scope: 'root' },
          'settings.section': { kind: 'list', scope: 'root' },
          'settings.onboarding': { kind: 'list', scope: 'root' },
        },
        inject: () => ({ sections }),
      },
      SettingsPage,
    )
    return () => {
      disposePage()
      disposeDocAction()
      disposeLocale()
      disposeRoot()
      disposePanelInfo()
      disposeService()
    }
  }, 'dsh-one settings shell: layout service + panel-info hook + root + settings page seat + doc action')
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
