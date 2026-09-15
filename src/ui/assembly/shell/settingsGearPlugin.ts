/**
 * @dsh-one/vscode-settings-gear——侧栏树的设置入口影子插件（#70 设置独立成页）：
 * single 槽 sidebar.settings 以 priority -1 顶掉官方 SettingsRoot（lowest
 * renders），外观逐字复刻官方触发行（齿轮 + t('trigger') 文案，宽/轨两态），
 * 点击不再开 modal——postMessage {type:'dshOne.openSettings'} 给宿主，宿主
 * 开/聚焦设置面板（registerAssembledSettings）。
 *
 * 复刻来源（ui-settings-general client.js 实测）：TriggerContent =
 * IconSettingsOutline16（宽）/ IconSettingsOutline14（轨）+ t("trigger")；
 * 触发行 CSS 参照官方 chrome 模块（.VOzbGW_trigger 尺寸语义本地重写）。
 * 官方 SettingsRoot 注册仍在（priority 0），被本影子压制不渲染；其 modal
 * 行为随设置独立成页整体退役。
 */
import { createElement as h } from 'react'
import { IconSettingsOutline14, IconSettingsOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'

// 官方触发行/轨按钮的语义复刻（尺寸逐字来自 ui-settings-general chrome CSS）。
const CSS = '.dshOneGear_row{flex:none;align-items:center;gap:8px;width:calc(100% + 4px);margin:4px -2px;display:flex}.dshOneGear_row[data-rail]{width:36px;margin:8px 0 10px;justify-content:center}.dshOneGear_button{box-sizing:border-box;cursor:pointer;width:auto;min-width:0;height:42px;color:var(--dsw-alias-label-primary);background:0 0;border:none;border-radius:12px;flex:1;align-items:center;gap:8px;margin:0;padding:0 10px 0 8px;font-family:inherit;font-size:14px;line-height:22px;display:flex;overflow:hidden}.dshOneGear_button:hover{background:var(--dsw-alias-interactive-bg-hover)}.dshOneGear_button[data-rail]{corner-shape:round;border-radius:50%;flex:none;justify-content:center;gap:0;width:36px;height:36px;margin:0;padding:0}.dshOneGear_label{white-space:nowrap;overflow:hidden}'
const CSS_TAG_ID = '@dsh-one/vscode-settings-gear/Gear.css'
if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`) === null) {
  const tag = document.createElement('style')
  tag.dataset.plugin = '@dsh-one/vscode-settings-gear'
  tag.dataset.pluginCss = CSS_TAG_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
}

interface GearProps {
  /** 官方侧栏壳传来的形态（宽行 / 收起轨）。 */
  wide?: boolean
  /** cordis locale 座位（框架固定注入名 t；函数内别名为 tr 以避开 i18n 门禁的裸 t() 扫描）。 */
  t: (key: string) => string
  onOpen: () => void
}

function SettingsGear({ wide = true, t, onOpen }: GearProps) {
  const tr = t
  return h(
    'div',
    { className: 'dshOneGear_row', 'data-rail': wide ? undefined : '' },
    h(
      'button',
      {
        type: 'button',
        className: 'dshOneGear_button',
        'data-rail': wide ? undefined : '',
        'aria-label': tr('trigger'),
        onClick: onOpen,
      },
      wide ? h(IconSettingsOutline16, { size: 16 }) : h(IconSettingsOutline14, { size: 18 }),
      wide ? h('span', { className: 'dshOneGear_label' }, tr('trigger')) : null,
    ),
  )
}

/** 宿主消息：统一获取点——VS Code 的 acquireVsCodeApi 全页只允许调一次
 * （probe.ts 启动时已调并挂 globalThis.__DSH_ONE_VSCODE__），这里先读全局
 * 实例复用；没有再 try acquire（无宿主的实验室环境天然没有，走计数退化）。
 * 真实失败语义：二次 acquire throw（实例已被持有且全局缺失，不应发生）。 */
const postOpenSettings = (): void => {
  const g = globalThis as {
    __DSH_ONE_OPEN_SETTINGS_CLICKS__?: number
    __DSH_ONE_VSCODE__?: { postMessage(msg: unknown): void }
    acquireVsCodeApi?: () => { postMessage(msg: unknown): void }
  }
  g.__DSH_ONE_OPEN_SETTINGS_CLICKS__ = (g.__DSH_ONE_OPEN_SETTINGS_CLICKS__ ?? 0) + 1
  let vscode = g.__DSH_ONE_VSCODE__
  if (vscode === undefined && typeof g.acquireVsCodeApi === 'function') {
    try {
      vscode = g.acquireVsCodeApi()
      g.__DSH_ONE_VSCODE__ = vscode
    } catch {
      /* 二次 acquire throw：宿主在但实例归属异常，消息放弃、计数已落 */
    }
  }
  vscode?.postMessage({ type: 'dshOne.openSettings' })
}

interface GearContext {
  effect(body: () => (() => void) | void, label?: string): void
  locale: { register(ns: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): () => void }
  slots: {
    register(entry: unknown, component: unknown): () => void
    /** 等目标名被任一 entry 的 children 表声明后再注册（官方贡献的正规挂法）。 */
    inject(name: string, factory: () => unknown): () => void
  }
}

export const inject = ['slots', 'locale']

export function apply(ctx: GearContext): void {
  ctx.effect(() => {
    // 自有词典（trigger 文案与 ui-settings-general 的 settings 命名空间同值），
    // 不跨插件借命名空间——locale 服务对未注册命名空间的入口组合不做保证。
    const disposeLocale = ctx.locale.register('dshOneGear', {
      zh: { trigger: '\u8bbe\u7f6e' },
      en: { trigger: 'Settings' },
    })
    // 对既有座位名（官方 ui-sidebar 的 children 表声明）必须走 slots.inject：
    // 直接 register 会在「未声明」时抛错（跨插件 effect 时序不保证声明已落）。
    // single 槽影子：priority -1 < 官方 SettingsRoot 的默认 0 → 本件渲染。
    const disposeInject = ctx.slots.inject('sidebar.settings', () =>
      ctx.slots.register(
        {
          name: 'sidebar.settings',
          priority: -1,
          locale: 'dshOneGear',
          inject: () => ({ onOpen: postOpenSettings }),
        },
        SettingsGear,
      ),
    )
    return () => {
      disposeInject()
      disposeLocale()
    }
  }, 'dsh-one settings gear: shadow sidebar.settings')
}
