/**
 * @dsh-one/vscode-shell——自有 root 外框插件（#64 方案 A′）：顶替下线的官方
 * ui-layout（root 槽注册 + layout 服务 + ThemePresenter + panelInfo 槽位钩子），
 * 只装配对话区，无官方侧栏。接手官方框架插件 ui-layout 的契约清单、版本核对办法，
 * 以及「为什么不能改成加载官方 ui-layout + 只遮蔽它的 root slot」（#77 实测结论）
 * 见 frameShared.ts 文件头。
 *
 * - root 槽注册：children 声明 conversation / main / details / rightbar /
 *   shell.overlay（不声明 sidebar——chat 树 block 了 ui-sidebar，其
 *   sidebar.workspaces 贡献不会注册；不带 locale 字段（不消费 t））。会话面板
 *   槽位两版都声明：0.1.2 线登记 single `conversation`，0.1.6 线登记 keyed
 *   `main`（key = `conversation`），渲染哪个由注册表实际有贡献的那个决定。
 *   `rightbar` 是 #79 决策 B 的接入点：声明后官方 ui-sidebar-right 才注册它的
 *   座位，文件/终端/文档预览三个官方插件在这棵树上真正可用。
 * - ShellFrame：主区会话面板 + details 面板 + 官方右栏座位 + shell.overlay 层；
 *   切会话时关 details（官方 AppFrame 语义，无侧栏/拖拽维度）。右栏几何照官方
 *   AppFrame 的两步解算（frameShared.computeColumns），呈现上报走 ctx.layout。
 *
 * 构建：esbuild 打成官方同格式自注册 IIFE（clientEntry.ts + banner/footer
 * 包出 window.__ModuleLoader__.load({id, factory})）；react / react/jsx-runtime /
 * @deepseek-ai/cordis / @deepseek-ai/dsh-client-store 必须 external（种子表满足，
 * 打进包会双重实例化）。
 */
import { createElement as h, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  PANEL_INFO_SOURCE,
  computeColumns,
  createLayoutStore,
  LayoutController,
  rightbarPreference,
  ThemePresenter,
  type PanelActions,
  type PanelInfoSnapshot,
  type ShellLayoutState,
  type ThemeSnapshot,
} from './frameShared'
import { installExternalLinkShim } from './externalLinkShim'

// ---------------------------------------------------------------------------
// 类型（本地最小面；cordis ctx / 框架槽位的真实形态在私有包里，不跨包引用）
// ---------------------------------------------------------------------------

interface SessionsSnapshot {
  current?: string
  byId: Record<string, { blank?: boolean; title?: string }>
}

/**
 * 会话面板槽位名镜像：官方把「会话面板」这个槽位从 0.1.2 的 single `conversation`
 * 改成了 0.1.6 的 keyed `main`（key = `conversation`，见 ui-conversation 两版
 * client.js 的注册段）。两版都在版本门区间内，所以两版槽位都声明、按实际有贡献
 * 的那个渲染（查 registry 有无 `main` 条目 + 订阅其变化）。
 */
interface SeatMirror {
  getSnapshot(): 'main' | 'conversation'
  subscribe(listener: () => void): () => void
}

interface ShellFrameProps {
  useStore: <R>(selector: (state: ShellLayoutState) => R) => R
  useSessions: <R>(selector: (state: SessionsSnapshot) => R) => R
  /** 官方 root 槽位钩子（本插件经 ctx.slots.provideRoot 提供，见 frameShared）。 */
  usePanelInfo: <R>(selector: (info: PanelInfoSnapshot) => R) => R
  actions: Pick<PanelActions, 'openDetails' | 'closeDetails' | 'setViewportWidth'>
  renderSlot: (name: string, params: Record<string, unknown>, opts?: { entryKey?: string }) => unknown
  SessionProvider: unknown
  /** 框架按 entry 的 locale 注入的 t（函数内别名 tr 避开 i18n 门禁裸 t() 扫描）。 */
  t: (key: string) => string
  /** 会话面板槽位名（见 SeatMirror，root 注册的 inject 面注入）。 */
  conversationSeat: SeatMirror
}

interface RootSlotEntry {
  name: 'root'
  children: Record<string, { kind: 'single' | 'list' | 'keyed'; scope: 'root' | 'session' | 'session-maybe' }>
  store: () => unknown
  locale?: string
  inject: (actions: PanelActions) => { conversationSeat: SeatMirror }
}

interface SlotEntryLite {
  options: { key?: string }
}

interface ShellContext {
  effect(body: () => (() => void) | void, label?: string): void
  on(event: 'theme/change', listener: (snapshot: ThemeSnapshot) => void): () => void
  reflect: { provide(name: string, service: unknown): () => void }
  slots: {
    register(entry: RootSlotEntry, component: unknown): () => void
    /** 官方 root 槽位钩子/数据发布口（ui-layout 的 panelInfo 同款调用点）。 */
    provideRoot(contribution: { hooks: { panelInfo: typeof PANEL_INFO_SOURCE } }): () => void
    /** 槽位条目快照（判会话面板用的是哪版槽位名）。 */
    entries(name: string): readonly SlotEntryLite[]
    /** 订阅某槽位的注册变化（官方 registry 同款）。 */
    subscribe(name: string, listener: () => void): () => void
  }
  locale: { register(ns: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): () => void }
  theme: { getTheme(): ThemeSnapshot }
}

/** 槽位名镜像（注册表里 keyed `main` 有贡献 = 0.1.6 线，否则 0.1.2 线的 single 槽位）。 */
function createConversationSeatMirror(ctx: ShellContext): SeatMirror {
  const read = (): 'main' | 'conversation' => (ctx.slots.entries('main').length > 0 ? 'main' : 'conversation')
  return {
    getSnapshot: read,
    subscribe(listener) {
      return ctx.slots.subscribe('main', listener)
    },
  }
}


// ---------------------------------------------------------------------------
// 样式（官方 css-module 注入形态的本地版：data-plugin-css 防重）
// ---------------------------------------------------------------------------

const CSS = '.dshOneShell_frame{background:var(--dsw-alias-bg-base);height:100%;display:flex;flex-direction:column;overflow:hidden;position:relative}.dshOneShell_row{flex:1;min-height:0;display:flex}.dshOneShell_main{flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden}.dshOneShell_details{border-left:.5px solid var(--dsw-alias-border-l3);min-width:0;overflow:hidden;background:var(--dsw-alias-bg-base)}.dshOneShell_rightbarCol{flex:none;position:relative;overflow:visible}.dshOneShell_openingMask{z-index:15;position:absolute;top:0;left:0;right:0;bottom:0;background:var(--dsw-alias-bg-base);align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:22px;display:flex}.dshOneShell_overlay{z-index:20;pointer-events:none;position:absolute;inset:0}'
// composer dock 统计行字号压小（#71 验收）：官方 StatsLine 字号取自官方变量
// --dsh-content-font-size-secondary（默认 13px，由 ui-theme 按字号设置推导，
// 五处消费——全局改会误伤 message-feedback/tool/workflow-run）。机制层 4 举证：
// ①StatsLine 是 conversation.composer.dock 的 list 贡献，list additive 无法
// 改样式（registry 同前举证）；②官方无字号服务设置口（theme 服务只出快照，
// 字号设置写网关 settings 不适用于本端 chrome 微调）；③__DSH_TRANSPORT__ 等
// 接缝与呈现无关。故在 seat 容器上覆写官方变量（官方变量接缝 + data-slot
// 槽位名选择器，均不依赖 css-module 哈希）：仅 dock 内的 StatsLine 生效，
// 其余四处消费者不受影响。数值 11px = 比内容次级（13px）小两档，对齐
// VS Code 面板 footer 惯例（11–12px）；line-height 同步 -2px 保视觉节奏。
// 注意：seat 容器是 display:contents（无盒），自定义属性无法穿透继承——
// 覆写给到其子项（StatsLine 根有盒）。
const CSS_DOCK_STATS = '[data-slot="conversation.composer.dock"]>*{--dsh-content-font-size-secondary:11px;--dsh-content-font-delta-secondary:-2px}'
const FULL_CSS = () => CSS + CSS_DOCK_STATS
// 注意：overlay 层语义逐字对齐官方 AppFrame.overlayLayer（pointer-events:none、
// 无子元素指针事件豁免）——官方 CSS 没有 `>*{pointer-events:auto}`；加豁免会让
// 任何渲染了尺寸内容的 overlay 贡献（portal 进该层的全屏容器）吃掉全页输入。
// 需要交互的 overlay 贡献应自行声明 pointer-events（与官方一致）。
const CSS_TAG_ID = '@dsh-one/vscode-shell/ShellFrame.css'
if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`) === null) {
  const tag = document.createElement('style')
  tag.dataset.plugin = '@dsh-one/vscode-shell'
  tag.dataset.pluginCss = CSS_TAG_ID
  tag.textContent = FULL_CSS()
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
// ShellFrame：框架注入槽位的最小消费——主区 conversation + details 面板 +
// shell.overlay 层；切会话时关 details（官方 AppFrame 语义，无侧栏/拖拽维度）
// ---------------------------------------------------------------------------

/** 遮罩兜底超时：目标会话迟迟未激活（id 无效/网络慢）也揭幕，绝不白屏死锁。 */
const OPENING_MASK_TIMEOUT_MS = 5000

/** 与 session-boot 插件的状态共享方式：各自读 __DSH_ONE_BOOT__ 全局（第 3 层接缝），
 * 无跨 bundle 模块作用域可共享，也不值得为单一布尔起 cordis 服务。 */
const bootSessionId = (): string | undefined => {
  const raw = (globalThis as { __DSH_ONE_BOOT__?: { sessionId?: unknown } }).__DSH_ONE_BOOT__?.sessionId
  return typeof raw === 'string' && raw !== '' ? raw : undefined
}

function ShellFrame({ useStore, useSessions, usePanelInfo, actions, renderSlot, SessionProvider, conversationSeat, t }: ShellFrameProps) {
  const panels = useStore((s) => s)
  // 容器实测宽（官方 AppFrame 同款：ResizeObserver + rAF 节流量自己的盒宽）——
  // 右栏宽度偏好按它推导，所以必须在座位挂载前尽量到位（首帧量一次）。
  const frameRef = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const el = frameRef.current
    if (el === null) return
    let raf: number | null = null
    let disposed = false
    const measure = (): void => {
      const width = el.getBoundingClientRect().width
      if (width > 0) actions.setViewportWidth(width)
    }
    measure()
    const observer = new ResizeObserver(() => {
      if (disposed) return
      raf ??= requestAnimationFrame(() => {
        raf = null
        measure()
      })
    })
    observer.observe(el)
    return () => {
      disposed = true
      observer.disconnect()
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [actions])
  // 会话面板槽位名（0.1.2 线 = single `conversation`，0.1.6 线 = keyed `main`）：
  // 注册在首渲之后，用订阅驱动重渲（官方槽位注册会 bump registry 版本）。
  const [, setSeatTick] = useState(0)
  useEffect(() => conversationSeat.subscribe(() => setSeatTick((n) => n + 1)), [conversationSeat])
  const activePanelId = usePanelInfo((info) => info.activePanelId)
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
  // 「正在打开会话…」遮罩（#71）：注入 tab 在目标会话激活前盖住对话区，
  // 杜绝官方默认态（空白会话 hero）闪帧；默认 tab 无注入永不罩（官方恢复
  // 行为不动）。激活 = current === bootId（机制层 2 订阅）；超时兜底揭幕。
  const bootId = bootSessionId()
  const currentSession = useSessions((s) => s.current)
  const [revealedByTimeout, setRevealedByTimeout] = useState(false)
  // 冷启动遮罩只服务「首次到达目标会话」：到位即永久揭幕（#65 批 1 回归套件
  // 抓出——原先只比 current !== bootId，运行时切到别的会话会让遮罩**重新罩上**
  // 直到 5s 兜底，表现为「切会话被白屏挡一下」）。
  const [bootReached, setBootReached] = useState(false)
  useEffect(() => {
    if (bootId !== undefined && currentSession === bootId) setBootReached(true)
  }, [bootId, currentSession])
  useEffect(() => {
    // 超时只按 bootId 起一次：活网关列表持续更新会反复触发 current 变化，
    // 若随 current 重置定时器，兜底永不降临（NO-FLASH 实测抓出）。
    if (bootId === undefined) return
    const timer = setTimeout(() => {
      console.warn(`[dsh-one] opening session ${bootId} timed out; revealing the shell anyway`)
      setRevealedByTimeout(true)
    }, OPENING_MASK_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [bootId])
  const tr = t
  const opening = bootId !== undefined && !bootReached && !revealedByTimeout && currentSession !== bootId
  // 会话面板渲染：0.1.6 线登记的是 keyed `main` 的 `conversation` 键（官方
  // AppFrame 的 MainPanel 同款取键方式：全局面板 id ?? 'conversation'）；
  // 0.1.2 线登记的是 single `conversation`。两版槽位都声明，实际渲染哪个由
  // 注册表里有贡献的那个决定（见 conversationSeat 镜像）。
  const conversation =
    conversationSeat.getSnapshot() === 'main'
      ? renderSlot('main', {}, { entryKey: activePanelId ?? 'conversation' })
      : renderSlot('conversation', {})
  // 右栏几何（官方 AppFrame 同款两步解算，数值规则见 frameShared.computeColumns）：
  // 座位拿到的是「正常态」宽度 `normal.rightbar`，占不占轨道看 `rightbarTrack`
  // （`cols.rightbar`）。没让轨道时官方座位自己贴着外框右缘悬在内容之上——
  // 这正是官方右栏「是一条轨道，不是一个盒子」的语义（窄容器下就是这么呈现的）。
  const rightbarPref = rightbarPreference(panels.rightbar, panels.viewportWidth)
  const rightbarNormal = computeColumns(panels.viewportWidth, 0, rightbarPref).rightbar
  const rightbarTrackWidth = computeColumns(panels.viewportWidth, 0, panels.rightbarTrack ? rightbarPref : 0).rightbar
  return h(
    'div',
    { className: 'dshOneShell_frame', 'data-shell': 'dsh-one', ref: frameRef },
    h(DocumentTitle, {
      productTitle: 'DeepSeek Harness',
      ...(documentTitle === undefined ? {} : { title: documentTitle }),
    }),
    h(
      'div',
      { className: 'dshOneShell_row' },
      h('div', { className: 'dshOneShell_main' }, conversation),
      detailsOpen &&
        h(
          'div',
          { className: 'dshOneShell_details', style: { width: panels.details } },
          h(SessionProvider, null, renderSlot('details', {})),
        ),
      // 官方右栏座位（#79 决策 B）：文件/终端/文档预览三个官方插件经
      // `ctx.slots.inject('rightbar', …)` 等这个座位被声明后自己注册进来
      // （ui-sidebar-right 的 RightbarRoot），呈现上报走 ctx.layout（见 frameShared
      // 的 openRightbar）。props 三个字段是官方契约（官方 AppFrame 同款）：
      // width = 正常态面板宽、viewportWidth = 外框宽、canShow = 容器装不装得下。
      h(
        'div',
        { className: 'dshOneShell_rightbarCol', style: { width: rightbarTrackWidth } },
        renderSlot('rightbar', {
          width: rightbarNormal,
          viewportWidth: panels.viewportWidth,
          canShow: rightbarNormal > 0,
        }),
      ),
    ),
    opening && h('div', { className: 'dshOneShell_openingMask', 'data-opening-mask': '' }, tr('opening')),
    h('div', { className: 'dshOneShell_overlay', 'data-shell-overlay': true }, renderSlot('shell.overlay', {})),
  )
}

// ---------------------------------------------------------------------------
// cordis 插件面：inject ['slots','theme']；apply = layout 服务 + root 注册
// + ThemePresenter（均挂 ctx.effect，照抄官方两段的结构与 label 语义）
// ---------------------------------------------------------------------------

export const inject = ['slots', 'theme', 'locale']

export function apply(ctx: ShellContext): void {
  // selectPanel 的合法性判据照官方取 keyed `main` 的实时注册表（本树里官方
  // ui-conversation 注册的 key 是 `conversation`；官方 ui-layout 同款构造点见
  // frameShared.LayoutController）。
  const layout = new LayoutController((panelId) => ctx.slots.entries('main').some((entry) => entry.options.key === panelId))
  const conversationSeat = createConversationSeatMirror(ctx)
  ctx.effect(() => {
    const disposeService = ctx.reflect.provide('layout', layout)
    // 官方 root 槽位钩子 panelInfo（机制层 1：官方槽位机制，调用点逐字对齐
    // 官方 ui-layout 的 `ctx.slots.provideRoot`）。官方框架插件 ui-layout 被下线后这份钩子
    // 无人提供，0.1.6 的会话树/右侧栏挂载即崩（#76）。
    const disposePanelInfo = ctx.slots.provideRoot({ hooks: { panelInfo: PANEL_INFO_SOURCE } })
    const disposeRegistration = ctx.slots.register(
      {
        name: 'root',
        // 不声明 sidebar 子槽：chat 树 block 了 ui-sidebar，侧栏贡献整树缺席。
        // 会话面板两版槽位都声明（0.1.2 的 single `conversation` / 0.1.6 的
        // keyed `main`），渲染哪个见 conversationSeat 镜像。
        // `rightbar`（#79 决策 B）声明后官方 ui-sidebar-right 才会注册它的座位
        // （官方件用 `ctx.slots.inject('rightbar', …)` 等声明），文件/终端/
        // 文档预览三个插件随之在这棵树上真正可用。
        children: {
          conversation: { kind: 'single', scope: 'session-maybe' },
          main: { kind: 'keyed', scope: 'root' },
          details: { kind: 'single', scope: 'session' },
          rightbar: { kind: 'single', scope: 'root' },
          'shell.overlay': { kind: 'list', scope: 'root' },
        },
        store: createLayoutStore,
        locale: 'dshOneShell',
        inject: (actions: PanelActions) => {
          layout.attachPanels(actions)
          return { conversationSeat }
        },
      },
      ShellFrame,
    )
    // 遮罩文案自有词典（zh 转义过 i18n 门禁的字面量扫描）。
    const disposeLocale = ctx.locale.register('dshOneShell', {
      zh: { opening: '\u6b63\u5728\u6253\u5f00\u4f1a\u8bdd…' },
      en: { opening: 'Opening session…' },
    })
    return () => {
      disposeRegistration()
      disposeLocale()
      disposePanelInfo()
      disposeService()
    }
  }, 'dsh-one shell: layout service + panel-info hook + root registration')
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
  // #150：外链锚点的捕获阶段兜底（三棵树共用同一份实现，见 externalLinkShim.ts）。
  ctx.effect(() => installExternalLinkShim(), 'dsh-one shell: external link takeover')
}
