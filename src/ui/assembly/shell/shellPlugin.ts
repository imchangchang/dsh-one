/**
 * @dsh-one/vscode-shell——自有 root 外框插件（#64 方案 A′）：顶替下线的官方
 * ui-layout（root 槽注册 + layout 服务 + ThemePresenter），只装配对话区，
 * 无官方侧栏。契约逐字来自调研结论（ui-layout client.js 实测源码，共享件
 * 见 frameShared.ts）：
 *
 * - root 槽注册：children 只声明 conversation / details / shell.overlay
 *   （不声明 sidebar——chat 树 block 了 ui-sidebar，其 sidebar.workspaces
 *   贡献不会注册；不带 locale 字段（不消费 t）。
 * - ShellFrame：主区 conversation + details 面板 + shell.overlay 层；切会话时
 *   关 details（官方 AppFrame 语义，无侧栏/拖拽维度）。
 *
 * 构建：esbuild 打成官方同格式自注册 IIFE（clientEntry.ts + banner/footer
 * 包出 window.__ModuleLoader__.load({id, factory})）；react / react/jsx-runtime /
 * @deepseek-ai/cordis / @deepseek-ai/dsh-client-store 必须 external（种子表满足，
 * 打进包会双重实例化）。
 */
import { createElement as h, useEffect, useLayoutEffect, useRef } from 'react'
import { createLayoutStore, LayoutController, ThemePresenter, type PanelActions, type ShellLayoutState, type ThemeSnapshot } from './frameShared'

// ---------------------------------------------------------------------------
// 类型（本地最小面；cordis ctx / 框架座位的真实形态在私有包里，不跨包引用）
// ---------------------------------------------------------------------------

interface SessionsSnapshot {
  current?: string
  byId: Record<string, { blank?: boolean; title?: string }>
}

interface ShellFrameProps {
  useStore: <R>(selector: (state: ShellLayoutState) => R) => R
  useSessions: <R>(selector: (state: SessionsSnapshot) => R) => R
  actions: Pick<PanelActions, 'openDetails' | 'closeDetails'>
  renderSlot: (name: string, params: Record<string, unknown>) => unknown
  SessionProvider: unknown
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
// 样式（官方 css-module 注入形态的本地版：data-plugin-css 防重）
// ---------------------------------------------------------------------------

const CSS = '.dshOneShell_frame{background:var(--dsw-alias-bg-base);height:100%;display:flex;flex-direction:column;overflow:hidden;position:relative}.dshOneShell_row{flex:1;min-height:0;display:flex}.dshOneShell_main{flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden}.dshOneShell_details{border-left:.5px solid var(--dsw-alias-border-l3);min-width:0;overflow:hidden;background:var(--dsw-alias-bg-base)}.dshOneShell_overlay{z-index:20;pointer-events:none;position:absolute;inset:0}'
// 注意：overlay 层语义逐字对齐官方 AppFrame.overlayLayer（pointer-events:none、
// 无子元素指针事件豁免）——官方 CSS 没有 `>*{pointer-events:auto}`；加豁免会让
// 任何渲染了尺寸内容的 overlay 贡献（portal 进该层的全屏容器）吃掉全页输入。
// 需要交互的 overlay 贡献应自行声明 pointer-events（与官方一致）。
const CSS_TAG_ID = '@dsh-one/vscode-shell/ShellFrame.css'
if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`) === null) {
  const tag = document.createElement('style')
  tag.dataset.plugin = '@dsh-one/vscode-shell'
  tag.dataset.pluginCss = CSS_TAG_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
}

// ---------------------------------------------------------------------------
// DocumentTitle（ui-layout client.js 逐字）：会话标题投影进浏览器标题
// ---------------------------------------------------------------------------

function DocumentTitle({ title, productTitle }: { title?: string; productTitle: string }): null {
  useEffect(() => {
    document.title = title === undefined ? productTitle : `${title} — ${productTitle}`
    return () => {
      document.title = productTitle
    }
  }, [productTitle, title])
  return null
}

// ---------------------------------------------------------------------------
// ShellFrame：框架注入座位的最小消费——主区 conversation + details 面板 +
// shell.overlay 层；切会话时关 details（官方 AppFrame 语义，无侧栏/拖拽维度）
// ---------------------------------------------------------------------------

function ShellFrame({ useStore, useSessions, actions, renderSlot, SessionProvider }: ShellFrameProps) {
  const panels = useStore((s) => s)
  const detailsSession = useSessions((s) => {
    const current = s.current
    return current !== undefined && s.byId[current]?.blank === false ? current : undefined
  })
  const documentTitle = useSessions((s) => {
    const current = s.current
    return current === undefined ? undefined : s.byId[current]?.title
  })
  const lastSession = useRef(detailsSession)
  useLayoutEffect(() => {
    if (detailsSession === undefined) return
    if (lastSession.current !== undefined && lastSession.current !== detailsSession) actions.closeDetails()
    lastSession.current = detailsSession
  }, [actions, detailsSession])
  const detailsOpen = detailsSession !== undefined && panels.details > 0
  return h(
    'div',
    { className: 'dshOneShell_frame', 'data-shell': 'dsh-one' },
    h(DocumentTitle, {
      productTitle: 'DeepSeek Harness',
      ...(documentTitle === undefined ? {} : { title: documentTitle }),
    }),
    h(
      'div',
      { className: 'dshOneShell_row' },
      h('div', { className: 'dshOneShell_main' }, renderSlot('conversation', {})),
      detailsOpen &&
        h(
          'div',
          { className: 'dshOneShell_details', style: { width: panels.details } },
          h(SessionProvider, null, renderSlot('details', {})),
        ),
    ),
    h('div', { className: 'dshOneShell_overlay', 'data-shell-overlay': true }, renderSlot('shell.overlay', {})),
  )
}

// ---------------------------------------------------------------------------
// cordis 插件面：inject ['slots','theme']；apply = layout 服务 + root 注册
// + ThemePresenter（均挂 ctx.effect，照抄官方两段的结构与 label 语义）
// ---------------------------------------------------------------------------

export const inject = ['slots', 'theme']

export function apply(ctx: ShellContext): void {
  const layout = new LayoutController()
  ctx.effect(() => {
    const disposeService = ctx.reflect.provide('layout', layout)
    const disposeRegistration = ctx.slots.register(
      {
        name: 'root',
        // 不声明 sidebar 子槽：chat 树 block 了 ui-sidebar，侧栏贡献整树缺席。
        children: {
          conversation: { kind: 'single', scope: 'session-maybe' },
          details: { kind: 'single', scope: 'session' },
          'shell.overlay': { kind: 'list', scope: 'root' },
        },
        store: createLayoutStore,
        inject: (actions: PanelActions) => {
          layout.attachPanels(actions)
          return {}
        },
      },
      ShellFrame,
    )
    return () => {
      disposeRegistration()
      disposeService()
    }
  }, 'dsh-one shell: layout service + root registration')
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
  }, 'dsh-one shell: theme presenter')
}
