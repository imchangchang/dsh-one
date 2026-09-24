/**
 * @dsh-one/vscode-settings-ui-layout——settings 树 frame 插件（#70 设置独立成页，
 * VS Code 验收返修 v2：官方双栏观感 + 提供方目录修复；#95 设置页改用官方 keyed
 * `main`）。设置页 = 第三棵装配树：
 * - block list 同 chat 树（layout + sidebar 都下线）：官方外框与官方侧栏壳
 *   不进页（ui-sidebar 的槽注册在无人声明 'sidebar' 时 loud throw）。
 * - root 声明侧栏壳 4 子槽（品牌位/工作区树/品牌名/底部动作，贡献注册不渲染）
 *   + keyed `main` + `shell.overlay`。`main` 既让官方 ui-conversation 的整棵
 *   对话子树注册得成立（#74，见 apply 内注释），也是设置页自己的槽位：设置页是
 *   `main` 上一条 key = `dshOne.settings` 的 keyed 条目，本页只渲染它（#95 之前
 *   这条槽位是自造槽位 `dshOne.settings.page`，只有我们认识那个名）。**有意不声明
 *   sidebar.settings**：声明会同步触发 settings-general 的 SettingsRoot inject，
 *   其 children 表与本页槽位撞 registry「already declared」（绕行而非 priority
 *   遮蔽，同 v1）。
 * - 整页宿主 = 官方 SettingsPanel 组合复刻：居中限宽内容列（官方 panel 宽
 *   800px，取同款 max-width:800px / calc(100vw - 32px)）+ 左侧分节导航
 *   （General/Models/Plugins/Agent presets，当前节高亮 aria-current，点击切节）
 *   + 内容区 renderSlot('settings.section', {}, { only: active }) 单节渲染——
 *   导航行来自官方同款推导（slots.entries('settings.section') 的 id/order/
 *   label，按槽版本 + locale 修订缓存，双订阅），与官方弹窗观感对齐。
 *   `settings.onboarding` 也在这页上渲染（#249）：与设置面板同级、一次只放
 *   官方游标选中的那一步，见 SettingsPage 上方那段。
 * - Models「settings are unavailable in this browser」根因修复在 pageHtml 的
 *   __DSH_TRANSPORT__.ownsHost（client-connection isLoopback 判定），此处消费。
 */
import { createElement as h, useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { createLayoutStore, LayoutController, PANEL_INFO_SOURCE, ThemePresenter, type PanelActions, type ThemeSnapshot } from './frameShared'
import { installExternalLinkShim } from './externalLinkShim'

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

/** `settings.onboarding` 座上的一条留步（官方游标要的是 id + order）。 */
interface OnboardingRow {
  id: string
  order: number
}

interface OnboardingMirror {
  getSnapshot(): OnboardingRow[]
  subscribe(listener: () => void): () => void
}

/**
 * 设置页在官方 keyed `main` 槽位上的 key（官方 `MainPanelId` 语义：条目注册时
 * 声明 `key`，渲染时 `renderSlot('main', {}, { entryKey })` 按它取条目，
 * `ctx.layout.selectPanel` 也用它选中）。
 */
const SETTINGS_MAIN_KEY = 'dshOne.settings'

interface SettingsFrameProps {
  renderSlot: (name: string, params: Record<string, unknown>, opts?: { only?: string; entryKey?: string }) => unknown
  sections: SectionsMirror
  onboarding: OnboardingMirror
}

interface SlotEntryLite {
  options: { id?: string; order?: number; label?: unknown; key?: string }
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

const CSS = '.dshOneSettingsShell_page{background:var(--dsw-alias-bg-base);height:100%;display:flex;justify-content:center;overflow:hidden}.dshOneSettingsShell_column{box-sizing:border-box;width:800px;max-width:calc(100vw - 32px);height:100%;display:flex;overflow:hidden}.dshOneSettingsShell_nav{flex:none;box-sizing:border-box;width:188px;flex-direction:column;gap:4px;border-right:.5px solid var(--dsw-alias-border-l3);padding:22px 12px 12px;display:flex}.dshOneSettingsShell_navTitle{padding:0 12px 14px;font-size:16px;font-weight:500;line-height:24px;color:var(--dsw-alias-label-primary)}.dshOneSettingsShell_navCell{box-sizing:border-box;cursor:pointer;height:40px;color:var(--dsw-alias-label-primary);text-align:left;background:0 0;border:none;border-radius:12px;align-items:center;gap:8px;padding:9px 16px 9px 12px;font-family:inherit;font-size:14px;line-height:22px;display:flex}.dshOneSettingsShell_navCell:hover{background:var(--dsw-specific-sidebar-nav-item-hover)}.dshOneSettingsShell_navCell[data-active]{background:var(--dsw-specific-sidebar-nav-item-active)}.dshOneSettingsShell_navLabel{white-space:nowrap;text-overflow:ellipsis;flex:1;min-width:0;overflow:hidden}.dshOneSettingsShell_content{flex:1;min-width:0;flex-direction:column;display:flex;overflow:hidden}.dshOneSettingsShell_actions{flex:none;box-sizing:border-box;height:54px;display:flex;justify-content:flex-end;align-items:flex-start;gap:8px;padding:20px 14px 8px 10px}.dshOneSettingsShell_sections{flex:1;min-height:0;overflow-y:auto;padding:0 24px 24px}'
const CSS_TAG_ID = '@dsh-one/vscode-settings-ui-layout/SettingsPage.css'
if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`) === null) {
  const tag = document.createElement('style')
  tag.dataset.plugin = '@dsh-one/vscode-settings-ui-layout'
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
 * `settings.onboarding` 座上的留步推导（与 section 行同一套读法：槽版本缓存 +
 * 按 order 排）。官方 `SettingsRoot` 就是拿 `ctx.slots.entries("settings.onboarding")`
 * 这一份当游标清单的（`dsh-client-ui-settings-general/lib/client.js:877-890`），
 * 所以这里读的是同一份公开读数，不猜官方内部状态。
 */
function createOnboardingMirror(ctx: ShellContext): OnboardingMirror {
  let rowsVersion = -1
  let rows: OnboardingRow[] = []
  return {
    getSnapshot() {
      const version = ctx.slots.getVersion('settings.onboarding')
      if (version !== rowsVersion) {
        rowsVersion = version
        rows = ctx.slots
          .entries('settings.onboarding')
          .map((e) => ({ id: e.options.id ?? '', order: e.options.order ?? 0 }))
          .sort((a, b) => a.order - b.order)
      }
      return rows
    },
    subscribe(listener) {
      return ctx.slots.subscribe('settings.onboarding', listener)
    },
  }
}

/**
 * 整页宿主（官方 SettingsPanel 组合复刻；官方机制第 1/2 层：renderSlot 的
 * list 槽位 only 过滤是框架原生选项，官方 SettingsPanel 同款）：
 * 左分节导航 + 右内容单节渲染（only:active），当前节高亮；
 * 导航行订阅槽/语言变化，节缺席自动回落首行。
 *
 * `settings.onboarding` 那一段是**官方设置弹层壳 `SettingsRoot` 的同款语义**
 * （2026-09-25，本座的渲染面此前一直缺席，见 #249）：官方在那里的写法是
 * `onboardingStep !== void 0 && renderSlot("settings.onboarding", { stepId, complete,
 * openSection }, { only: onboardingStep.id })`（`dsh-client-ui-settings-general/lib/client.js:438`），
 * 即**与设置面板同级、一次只渲染当前这一步**；游标由壳持有——取 `entries` 里
 * order 最小的那条还没完成过的（官方 `completedOnboarding` 集合，同文件 `:317` 与 `:344`），
 * 组件自查完成后回调 `complete()` 让游标前进。这里照抄的正是这两件事：
 * **壳只给座位与游标，显不显示由官方组件按自己的状态决定**（`welcome-notice` 看
 * `ui-onboarding` 里那个确认标记、`deepseek-official` 看有没有可用凭据），我们不写死
 * 任何显示条件。两条最终都是 body 级 portal 的模态框（官方 `Modal` 原语
 * `createPortal(..., document.body)`），所以渲染面不在本锚点里。
 *
 * `data-dshone-onboarding-step` 是本页自己的游标读数（F-75 的壳座位对账要拿它把
 * 「官方两条都挂上了」与「这一轮到底是哪一条在渲染」对上账，见 `test/assembly-lab/shellSeats.ts`）。
 */
/** 游标初值：一条都没完成。空集常量（本仓库的 react 环境声明没有 `useState` 的惰性初值重载）。 */
const NO_COMPLETED_STEPS: ReadonlySet<string> = new Set<string>()

function SettingsPage({ renderSlot, sections, onboarding }: SettingsFrameProps) {
  const rows = sections.getSnapshot()
  const [activeId, setActiveId] = useState<string | undefined>(rows[0]?.id)
  const [tick, setTick] = useState(0)
  const [completed, setCompleted] = useState<ReadonlySet<string>>(NO_COMPLETED_STEPS)
  const bump = (): void => setTick(tick + 1)
  useEffect(() => sections.subscribe(bump), [sections, tick])
  useEffect(() => onboarding.subscribe(bump), [onboarding, tick])
  void tick // 订阅驱动重渲染（getSnapshot 在渲染期取新值）
  const latest = sections.getSnapshot()
  const active = latest.some((r) => r.id === activeId) ? activeId : latest[0]?.id
  // 官方游标语义（见本函数上方那段）：order 最小的那条还没完成过的留步。
  const step = onboarding.getSnapshot().find((row) => !completed.has(row.id))
  const completeStep = (id: string): void => {
    setCompleted((previous) => (previous.has(id) ? previous : new Set([...previous, id])))
  }
  return h(
    'div',
    {
      className: 'dshOneSettingsShell_page',
      'data-shell': 'dsh-one-settings',
      'data-dshone-onboarding-step': step?.id ?? '',
    },
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
    // 当前这一步的官方 onboarding（与设置面板同级，官方 `SettingsRoot` 同款位置与
    // 过滤方式；见本函数上方那段说明）。没有当前步时这个座整段不渲染——官方也是
    // 「`onboardingStep !== void 0 &&` 才 renderSlot」。
    step === undefined
      ? null
      : renderSlot(
          'settings.onboarding',
          { stepId: step.id, complete: () => completeStep(step.id), openSection: setActiveId },
          { only: step.id },
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

/** 根组件：整页只渲染设置页那条 keyed `main` 条目（官方 AppFrame 的 MainPanel
 * 同款取键方式：`renderSlot(<槽位名>, <props>, { entryKey: <面板 key> })`）。 */
function SettingsFrame({ renderSlot }: { renderSlot: SettingsFrameProps['renderSlot'] }) {
  return h('div', { className: 'dshOneSettingsShell_root', style: { height: '100%' } }, renderSlot('main', {}, { entryKey: SETTINGS_MAIN_KEY }))
}

// ---------------------------------------------------------------------------
// 两处「官方件不进我们的设置页」按机制层 1 的**遮蔽（shadow）**做：同一个槽位、
// 同一个条目 id、priority −1 再注册一个空件。官方那条仍在注册表里（它自己的
// store、locale 词典、theme/change 订阅照常存活），只是不再进渲染位——官方
// 注册表的语义是「一个 cell 里只有优先号最小的那条进渲染位」（shadow）。
//
// - **外观行**：官方 @deepseek-ai/dsh-client-ui-theme 在 list 槽位
//   settings.general.item 注册的条目 id 是 'appearance'（0.1.6-alpha.1 的
//   lib/client.js 逐字：`ctx.slots.inject("settings.general.item", () =>
//   ctx.slots.register({ name: "settings.general.item", id: "appearance",
//   order: 10, …}, AppearanceRow))`）。摘它的理由（#70）：那一行是 Light /
//   Dark / System 三态，我们的设置页由 VS Code 主题跟随（vscode-theme-follow）
//   管主题，两边各管各的。字号行（id 'font-size'）不动。
// - **官方「打开配置文件」**：官方 @deepseek-ai/dsh-client-ui-settings-general
//   在 list 槽位 settings.action 注册的条目 id 是 'open-document'（同版本
//   lib/client.js 逐字），它的动作是网关宿主用系统默认应用打开
//   ~/.dsh/settings.yaml；我们要的是走 VS Code 编辑器的自有行动
//   （id 'open-document-vscode'，见下方注册），所以按 id 遮蔽官方那条。
//
// #178 之前这两处是第 4 层 CSS 结构规则（`>*:has(button[aria-pressed])` 摘外观行、
// `>*:not(:has([data-dshone-doc-action]))` 摘官方那条）。当时的判断是「list 槽位
// 同 id 无法遮蔽」，审计实测那是错的：list 槽位同 id 一样可以遮蔽。换成遮蔽之后
// 两处脆点一并消失——原来的规则按**结构**认件，外观行换个控件、或这个槽位将来多
// 出别的官方条目，规则都会误伤。#87 起「按 id 遮蔽而不是按位置/结构摘」是本仓库的
// 既定做法（同 sessionExportPlugin 对官方 session-log-download 的处理）。
//
// 作用域限本树（本 bundle 只进 settings 树），官方 web 零影响、设置数据零改动。
// ---------------------------------------------------------------------------

/** 空件：占据官方条目的 cell、什么也不渲染（遮蔽用，见上）。 */
function Nothing(): null {
  return null
}

// ---------------------------------------------------------------------------
// cordis 插件面：layout 服务 + root 注册（侧栏壳 4 子槽 + keyed main + overlay）
// + 设置页作为 keyed `main` 上的条目（inject 供 sections 镜像）+ ThemePresenter
// ---------------------------------------------------------------------------

export const inject = ['slots', 'theme', 'locale']

export function apply(ctx: ShellContext): void {
  // selectPanel 的合法性判据照官方取 keyed `main` 的实时注册表（官方 ui-layout
  // 同款构造点，见 frameShared.LayoutController）。
  const layout = new LayoutController({ hasMainPanel: (panelId) => ctx.slots.entries('main').some((entry) => entry.options.key === panelId) })
  const sections = createSectionsMirror(ctx)
  const onboarding = createOnboardingMirror(ctx)
  ctx.effect(() => {
    const disposeService = ctx.reflect.provide('layout', layout)
    // 官方 root 槽位钩子 panelInfo（机制层 1：官方槽位机制）：本页不渲染任何
    // 会话树，但设置页里的官方件（如「已归档会话」）同样经槽位拿标准 props，
    // 缺了这份钩子会在挂载时抛 `usePanelInfo is not a function`。见 frameShared。
    const disposePanelInfo = ctx.slots.provideRoot({ hooks: { panelInfo: PANEL_INFO_SOURCE } })
    // 先注册 root（children 声明同步落 ledger），再经官方 `slots.inject('main', …)`
    // 注册设置页那条 keyed 条目。注意 root children 不声明 sidebar.settings——
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
          // keyed `main`（官方 root 契约里的对话区槽位）**本页只渲染设置页那条
          // keyed 条目**（key = dshOne.settings，见下方注册与 SettingsFrame），
          // 但也必须声明：官方 ui-conversation 的整棵
          // 对话子树注册挂在 `slots.inject("main", …)` 上
          //（dsh-client-ui-conversation/lib/client.js:16917，该子树里声明了
          // conversation.hero.agentPreset 等槽位名），本页不声明它，这些槽位名
          // 就没人声明。官方 dsh-client-ui-agent-preset 的会话级 scope
          //（inject = slots/conversation/sessions/uiWorkspace，
          // dsh-client-ui-agent-preset/lib/client.js:1613）随后注册 hero chip 时
          // 撞官方的 `slot "conversation.hero.agentPreset" is not declared`
          //（同文件 :1654 那条 register），整个 scope fiber 进 FAILED、它先前
          // 注册的 sessions 订阅泄漏，于是会话列表每次更新都抛
          // `cannot get required service "sessions" in inactive context`
          //（#74 实测 6 条 pageerror）。
          // 机制层 1（官方槽位机制）：只补官方 root 契约里本页缺的这一项——官方
          // ui-layout 的 root children 表 = sidebar / main / rightbar /
          // shell.overlay（dsh-client-ui-layout/lib/client.js:525），声明之后由
          // 官方代码自己声明它的子树，无自有桩件、无 block list。
          main: { kind: 'keyed', scope: 'root' },
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
    // 两处遮蔽（机制层 1，见文件里 CSS 上方那段说明）：同 id + priority −1 注册空件，
    // 官方那条让出渲染位。都等槽位被声明出来再注册（官方 inject 语义）。
    const disposeAppearanceShadow = ctx.slots.inject('settings.general.item', () =>
      ctx.slots.register({ name: 'settings.general.item', id: 'appearance', priority: -1 }, Nothing),
    )
    const disposeOfficialDocShadow = ctx.slots.inject('settings.action', () =>
      ctx.slots.register({ name: 'settings.action', id: 'open-document', priority: -1 }, Nothing),
    )
    const disposeLocale = ctx.locale.register('dshOneSettings', {
      zh: { openDocument: '\u6253\u5f00\u914d\u7f6e\u6587\u4ef6' },
      en: { openDocument: 'Open configuration file' },
    })
    // 设置页 = 官方 keyed `main` 上的一条 keyed 条目（#95；机制层 1：官方槽位机制）。
    // 用官方 `slots.inject('main', …)` 等 `main` 被声明出来再注册——`main` 由上面
    // 我们自己的 root 条目声明，槽位已声明时官方 inject 会同步跑回调（官方
    // dsh-client-ui-renderer 的 slots.inject 文档：槽位已声明时同步 setup）。注册后
    // 用官方 ILayout 的 selectPanel 选中这个 key。
    const disposePage = ctx.slots.inject('main', () => {
      const disposeEntry = ctx.slots.register(
        {
          name: 'main',
          key: SETTINGS_MAIN_KEY,
          // 官方 settings.* 槽位声明在这——settings-general/models/plugins
          // 的 section 贡献与行注入都挂这些名字。
          children: {
            'settings.header': { kind: 'single', scope: 'root' },
            'settings.action': { kind: 'list', scope: 'root' },
            'settings.close': { kind: 'single', scope: 'root' },
            'settings.section': { kind: 'list', scope: 'root' },
            // 官方两条 onboarding（ui-settings-models 的 `welcome-notice` /
            // `deepseek-official`）的座。声明之后它们的 `slots.inject` 回调才会跑
            // （官方 inject 语义），本页由 SettingsPage 渲染它（#249）。
            'settings.onboarding': { kind: 'list', scope: 'root' },
          },
          inject: () => ({ sections, onboarding }),
        },
        SettingsPage,
      )
      layout.selectPanel(SETTINGS_MAIN_KEY)
      return disposeEntry
    })
    return () => {
      disposePage()
      disposeDocAction()
      disposeOfficialDocShadow()
      disposeAppearanceShadow()
      disposeLocale()
      disposeRoot()
      disposePanelInfo()
      disposeService()
    }
  }, 'dsh-one settings shell: layout service + panel-info hook + root + settings page as keyed main + doc action + two official-row shadows')
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
  // #150：外链锚点的捕获阶段兜底（四棵树共用同一份实现，见 externalLinkShim.ts）。
  ctx.effect(() => installExternalLinkShim(), 'dsh-one settings shell: external link takeover')
}
