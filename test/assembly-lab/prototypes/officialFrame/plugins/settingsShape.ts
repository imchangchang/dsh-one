/**
 * `@dsh-one/proto-frame-settings`——官方 AppFrame 形态适配原型（settings 树，#89）。
 *
 * 形态目标：**设置页整页铺在官方中列里**（VS Code 的设置是独立编辑器页，没有侧栏、没有右栏）。
 *
 * 这里走的是官方机制的第 1 + 2 层，而不是 CSS：
 * - 官方外框的 `main` 是 **keyed 槽位**（`children: { main: { kind: 'keyed' } }`），渲染时
 *   `renderSlot('main', {}, { entryKey: activePanelId ?? 'conversation' })`；
 * - 官方服务 `ctx.layout.selectPanel(mainKey)` 就是「选中一个全局面板」的公开口
 *   （官方侧栏的面板行、官方 workspace 的 fork 都走它）。
 *
 * 所以设置页 = 往 `main` 注册一条 `key='dshOne.settings'` 的 keyed 条目 + `selectPanel`
 * 选中它：中列渲染设置页、右栏自动下线（官方 `RightbarRoot` 在 `activePanelId !== null`
 * 时返回 null）、页面标题交给官方 `DocumentTitle`。**内容侧一行 CSS 都不需要**。
 *
 * 页面本体（分节导航 + 单节渲染 + 官方 SettingsPanel 观感）是从生产件
 * `src/ui/assembly/shell/settingsLayoutPlugin.ts` 逐字复制的精简版（去掉「打开配置文件」
 * 自有行动）——原型不动生产代码，所以这份是拷贝而不是引用。
 *
 * 形态侧只需要一条 CSS：把侧栏列去掉（与 chat 树同一手段；该树右栏轨恒为 0，所以
 * 纯 CSS 覆盖整条 `grid-template-columns` 就够，不必改写内联属性）。
 */
import { createElement as h, useEffect, useState } from 'react'
import { hideSidebarColumnDecor, injectCss, reportShape, shapeFromLocation } from '../shape.ts'

const ID = '@dsh-one/proto-frame-settings'

/** 全局面板 key（官方 `MainPanelId` 语义：注册时声明、`selectPanel` 选它）。 */
const MAIN_KEY = 'dshOne.settings'

const CSS = [
  'div:has(> [data-shell-overlay]){grid-template-columns:0px minmax(0,1fr) 0px!important}',
  hideSidebarColumnDecor(),
  // 设置页外观：官方 SettingsPanel 组合复刻（与生产 settings 树同一份 CSS）。
  '.dshOneSettingsShell_page{background:var(--dsw-alias-bg-base);height:100%;display:flex;justify-content:center;overflow:hidden}',
  '.dshOneSettingsShell_column{box-sizing:border-box;width:800px;max-width:calc(100vw - 32px);height:100%;display:flex;overflow:hidden}',
  '.dshOneSettingsShell_nav{flex:none;box-sizing:border-box;width:188px;flex-direction:column;gap:4px;border-right:.5px solid var(--dsw-alias-border-l3);padding:22px 12px 12px;display:flex}',
  '.dshOneSettingsShell_navTitle{padding:0 12px 14px;font-size:16px;font-weight:500;line-height:24px;color:var(--dsw-alias-label-primary)}',
  '.dshOneSettingsShell_navCell{box-sizing:border-box;cursor:pointer;height:40px;color:var(--dsw-alias-label-primary);text-align:left;background:0 0;border:none;border-radius:12px;align-items:center;gap:8px;padding:9px 16px 9px 12px;font-family:inherit;font-size:14px;line-height:22px;display:flex}',
  '.dshOneSettingsShell_navCell:hover{background:var(--dsw-specific-sidebar-nav-item-hover)}',
  '.dshOneSettingsShell_navCell[data-active]{background:var(--dsw-specific-sidebar-nav-item-active)}',
  '.dshOneSettingsShell_navLabel{white-space:nowrap;text-overflow:ellipsis;flex:1;min-width:0;overflow:hidden}',
  '.dshOneSettingsShell_content{flex:1;min-width:0;flex-direction:column;display:flex;overflow:hidden}',
  '.dshOneSettingsShell_sections{flex:1;min-height:0;overflow-y:auto;padding:0 24px 24px}',
  '.dshOneSettingsShell_sections [data-slot="settings.general.item"]>*:has(button[aria-pressed]){display:none}',
].join('')

interface SectionRow {
  id: string
  order: number
  label: string
}

interface SectionsMirror {
  getSnapshot(): SectionRow[]
  subscribe(listener: () => void): () => void
}

interface SlotEntryLite {
  options: { id?: string; order?: number; label?: unknown }
}

interface SettingsPageProps {
  renderSlot: (name: string, params: Record<string, unknown>, opts?: { only?: string }) => unknown
  sections: SectionsMirror
}

interface SlotsService {
  register(entry: unknown, component: unknown): () => void
  inject(name: string, factory: () => unknown): () => void
  entries(name: string): SlotEntryLite[]
  getVersion(name: string): number
  subscribe(name: string, listener: () => void): () => void
}

interface LocaleService {
  getSnapshot(): { revision: number }
  subscribe(listener: () => void): () => void
}

interface ShellContext {
  effect(body: () => (() => void) | void, label?: string): void
  slots: SlotsService
  locale: LocaleService
  layout: { selectPanel(panelId: string | null): void }
}

export const inject = ['slots', 'locale', 'layout']

/** 官方同款 section 行推导（官方 SettingsRoot 的 shellInjected 同款：槽版本 + locale 修订缓存）。 */
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
          .map((entry) => ({
            id: entry.options.id ?? '',
            order: entry.options.order ?? 0,
            label: resolveSlotLabel(entry.options.label) ?? '',
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

/** 整页宿主：左分节导航 + 右内容单节渲染（官方 renderSlot 的 list `only` 选项）。 */
function SettingsPage({ renderSlot, sections }: SettingsPageProps): unknown {
  const rows = sections.getSnapshot()
  const [activeId, setActiveId] = useState<string | undefined>(rows[0]?.id)
  const [tick, setTick] = useState(0)
  useEffect(() => sections.subscribe(() => setTick(tick + 1)), [sections, tick])
  void tick
  const latest = sections.getSnapshot()
  const active = latest.some((row) => row.id === activeId) ? activeId : latest[0]?.id
  return h(
    'div',
    { className: 'dshOneSettingsShell_page', 'data-shell': 'proto-official-frame-settings' },
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
        active !== undefined
          ? h('div', { className: 'dshOneSettingsShell_sections' }, renderSlot('settings.section', {}, { only: active }))
          : null,
      ),
    ),
  )
}

export function apply(ctx: ShellContext): void {
  const shape = shapeFromLocation('page')
  reportShape(ID, { shape, mainKey: MAIN_KEY, css: shape === 'raw' ? '' : CSS })
  if (shape !== 'raw') injectCss(ID, CSS)
  ctx.effect(() => {
    const sections = createSectionsMirror(ctx)
    // `main` 由官方 AppFrame 在 root children 里声明为 keyed——用官方 `slots.inject`
    // 等它声明出来再注册（早注册会 throw「slot is not declared」）。
    const disposeInject = ctx.slots.inject('main', () => {
      const disposeEntry = ctx.slots.register(
        {
          name: 'main',
          key: MAIN_KEY,
          // 官方 settings.* 槽位声明在这（settings-general/models/plugins 的 section
          // 贡献与行注入都挂这些名字；官方模态壳缺席时它们本来就挂在这些名字上）。
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
      // 选中这个全局面板：中列渲染设置页（官方 `LayoutController.selectPanel` 语义）。
      ctx.layout.selectPanel(MAIN_KEY)
      return disposeEntry
    })
    return disposeInject
  }, 'proto official-frame settings: settings page as a keyed main panel')
}
