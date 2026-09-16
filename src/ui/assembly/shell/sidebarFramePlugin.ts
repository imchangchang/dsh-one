/**
 * @dsh-one/vscode-sidebar-shell——侧栏位 frame 插件（#70）：顶替下线的官方
 * ui-layout，官方侧栏（品牌位/工作区树/设置入口/底部动作条）原样进 VS Code
 * 侧栏 view。spike #69 题1 已验证裸 frame 里侧栏完整、数据正常。
 *
 * - root 槽注册：children 只声明 sidebar + shell.overlay（conversation/details
 *   等 chat 树槽位不声明，对应贡献静默缺席——chat 树有独立 frame）；同时经
 *   `ctx.slots.provideRoot` 提供官方 root 槽位钩子 panelInfo（接手官方外框
 *   契约的清单见 frameShared.ts 文件头）。
 * - 宽度形态（#70 VS Code 验收项 2）：WebviewView 宽度由 VS Code 拖拽决定
 *   （240~560+px 都可能），frame 不做固定 280/56 轨——侧栏列 100% 流体，
 *   ResizeObserver 量出容器实际宽度传给官方 SidebarRoot（官方壳按
 *   renderSlot 的 width 参数定列宽），恒展开；收起钮在此形态下隐藏（折叠
 *   归 VS Code chrome 管），frame CSS 按 aria-label 覆盖（官方便携类名是
 *   哈希的，aria-label 文案随官方词典稳定）。
 * - 设置入口 = **顶栏最右的齿轮**（#99 起由 workspace tree 插件渲染，经宿主能力口
 *   `openSettings` 触发——见 hostCapabilities.ts 的能力表与 settingsGearPlugin 的
 *   说明）；官方底部那一行（`sidebar.settings`，官方 SettingsRoot）由
 *   `@dsh-one/vscode-settings-gear` 影子渲染空件藏掉。设置页仍是独立编辑器页
 *   （@dsh-one/vscode-settings-shell）。
 * - 头部抛光（#70 VS Code 验收「很生硬」返修）：品牌位影子（brand.mark/name
 *   渲染空件 priority -1）+ logoRow 整行隐藏——VS Code 原生视图头已自报
 *   家门，官方 DeepSeek 品牌块重复且占 60px；折叠钮 aria-label 隐藏与
 *   logoRow 隐藏双保险；头部密度只微调（root 顶 padding 6→4px），官方
 *   其余默认不动。品牌块想换 DSH One 鲸鱼 logo 时，把两个
 *   空件换成渲染件即可（槽位贡献点不变）。
 * - 边缘贴齐（#70 验收「左右空条」返修）：官方根水平内边距 12px×2 是
 *   唯一布局级空条（左条 56–70px 实为树层级缩进：顶层行 28px、子代理行
 *   56–68px，是信息不是浪费）——root 选择器必须经插槽 wrapper（display:
 *   contents 的 div）下一级（> 直连选择器上一轮未命中即此因），把
 *   --dsh-sidebar-inline-padding 置 0：内容从左缘铺到右缘，滚动条贴右缘
 *   （Chrome 覆盖式滚动条，正常形态）。折叠钮/收起轨不是槽位贡献（钮是
 *   SidebarRoot 内部按钮、轨是 collapsed 态渲染，我们恒传 collapsed:false
 *   轨从不出现），CSS 隐藏即布局摘除，无列空间残留。
 * - 去掉官方「新会话」胶囊（#85 追加项，用户验收拍板）：官方把 New Session
 *   画在品牌行下面、工作区树上面，是**官方侧栏壳自己的按钮、不是槽位贡献**，
 *   我们只能按机制层 4 用 CSS 摘（官方无槽位/服务/seam 的举证写在 CSS 那条
 *   规则上方）。VS Code 形态下建会话由工作区行 hover 出的「+」与命令面板
 *   `dshOne.session.new` 承担，与 dsh-one 旧侧栏一致。**只在我们的 shell 里
 *   摘**：官方 web 形态（官方外框）胶囊照旧——这条差异是用户拍板的形态差异，
 *   不是对齐缺陷（护栏见 test/assemblyShellContract.test.ts）。
 *
 * 构建与打包约束同 clientEntry.ts（esbuild banner/footer 包自注册 IIFE，
 * externals 种子表满足）。
 */
import { createElement as h, useEffect, useRef, useState } from 'react'
import { createLayoutStore, LayoutController, PANEL_INFO_SOURCE, ThemePresenter, type PanelActions, type ThemeSnapshot } from './frameShared'

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
  inject: (actions: PanelActions) => Record<string, never>
}

interface ShellContext {
  effect(body: () => (() => void) | void, label?: string): void
  on(event: 'theme/change', listener: (snapshot: ThemeSnapshot) => void): () => void
  reflect: { provide(name: string, service: unknown): () => void }
  slots: {
    register(entry: unknown, component: unknown): () => void
    /** 等目标名被任一 entry 的 children 表声明后再注册（官方贡献的正规挂法）。 */
    inject(name: string, factory: () => unknown): () => void
    /** 官方 root 槽位钩子/数据发布口（官方 ui-layout 的 panelInfo 同款调用点）。 */
    provideRoot(contribution: { hooks: { panelInfo: typeof PANEL_INFO_SOURCE } }): () => void
  }
  theme: { getTheme(): ThemeSnapshot }
}

/** 品牌位空件：single 槽最低优先级（-1 < 官方默认 0）顶掉 ui-brand-official。 */
function Nothing(): null {
  return null
}

// ---------------------------------------------------------------------------
// 密度偏好（#85 A 项）：VS Code 侧栏外框给容器设一组 CSS 变量，树插件
// （@dsh-one/dsh-workspace-tree）按 `var(--dsh-one-density-x, <官方原值>)` 消费。
//
// **为什么是 CSS 变量而不是 cordis 服务**：这是一份「宿主容器对内容的排版
// 偏好」，值本身是 CSS 长度、消费点全在样式里；用变量则零 JS 契约、零注册
// 时序、任何插件（含官方件）都能按需读，未设的项各自回落官方值；改用服务
// 反而要发明一套跨插件 JS 接口和订阅生命周期，收益为负。变量挂在 frame 容器
// 上，靠继承下发给容器内所有内容（树插件只读，不参与写入）。
//
// 数值口径：官方原值逐字取自官方 css-module（ui-workspace 的 Rows.module.css /
// WorkspaceBrowser.module.css），VS Code 档按「VS Code 原生侧栏树观感」定
// （原生树行高 22px、13px 字号、行间 0 空隙的紧凑感）——官方按自己 264–420px
// 侧栏设计的松量在 VS Code 侧栏里偏松。每个键两边一致由 test/assemblyShellContract
// 的契约测试守着（表里的 official 必须等于树插件 CSS 的兜底字面量）。
// **观感语言（图标/颜色/圆角/字体族/动效）不在这张表里**——那些继续逐字沿用官方。
// ---------------------------------------------------------------------------

/** 密度档：键 = 变量后缀，official = 官方原值（与树插件 CSS 兜底同源），vscode = VS Code 档。 */
export const DENSITY_PROFILE: Readonly<Record<string, { official: string; vscode: string }>> = {
  'row-height': { official: '34px', vscode: '26px' },
  'session-row-height': { official: '32px', vscode: '24px' },
  'row-gap': { official: '2px', vscode: '1px' },
  'group-gap': { official: '4px', vscode: '3px' },
  'row-padding-inline': { official: '8px', vscode: '6px' },
  'section-header-height': { official: '36px', vscode: '30px' },
  'section-header-gap': { official: '4px', vscode: '2px' },
  'title-font-size': { official: '14px', vscode: '13px' },
  'title-line-height': { official: '20px', vscode: '18px' },
  'meta-font-size': { official: '12px', vscode: '11px' },
  'meta-line-height': { official: '20px', vscode: '16px' },
  'list-padding-bottom': { official: '16px', vscode: '12px' },
  'overflow-row-height': { official: '28px', vscode: '24px' },
  'icon-button-size': { official: '28px', vscode: '24px' },
  'search-height': { official: '28px', vscode: '24px' },
  'search-expanded-height': { official: '30px', vscode: '26px' },
  'search-row-min-height': { official: '48px', vscode: '40px' },
}

/** 密度档 → 一条 CSS 规则（挂在 frame 上，容器内所有插件经继承拿到）。 */
export const DENSITY_CSS =
  '.dshOneSidebarShell_frame{' +
  Object.entries(DENSITY_PROFILE)
    .map(([key, value]) => `--dsh-one-density-${key}:${value.vscode}`)
    .join(';') +
  '}'

// ---------------------------------------------------------------------------
// 样式：侧栏列 100% 流体（右边线保留，与官方 sidebarCol 视觉一致）；收起钮/
// 收起轨隐藏——VS Code WebviewView 形态无「内页收起」概念，折叠由 VS Code
// chrome 负责。aria-label 选择器覆盖官方便携类（哈希类名不可依赖）。
// ---------------------------------------------------------------------------

// logoRow 隐藏用 [class*="logoRow"]（css-module 名后缀稳定、哈希前缀随版本变）；
// 折叠钮 aria-label 规则保留作双保险（zh/en 双词典，CSS 转义写中文）。
//
// 官方「新会话」胶囊的摘除（#85 追加项）为什么走机制层 4（CSS），逐层举证：
// - **层 1（官方槽位机制）没有这个槽**：读官方 `@deepseek-ai/dsh-client-ui-sidebar`
//   0.1.6-alpha.1 的 `lib/types/client/contract/slots.d.ts`——SlotMap 只声明六个
//   空位（sidebar.brand.mark / sidebar.brand.name / sidebar.panellist /
//   sidebar.workspaces / sidebar.settings / sidebar.footer.action），没有 New
//   Session；该文件原文也写明「The shell owns column geometry, the brand row,
//   New Session, and global panel rows」，即它归侧栏壳自己。同一包的
//   `lib/client.js` 里该按钮是 SidebarRoot 的无条件 JSX（紧跟 logoRow、className
//   取自 css-module 的 `newSession`），没有任何 prop 开关。
//   层 1 的「同名槽位遮蔽」在这里等于顶替官方侧栏壳的角色——品牌位、全局面板行、
//   工作区与设置两个座位、底部动作条、收起轨都得我们自己渲染，与 AGENTS.md 铁律
//   「优先与官方插件共存，不顶替其角色」相抵；为摘一个按钮不值得。
// - **层 2/3 没有对应服务 API 与 seam**：官方没有「隐藏 New Session」这类入口。
// - 于是只剩层 4：按 css-module 名后缀定位、display:none。稳定性风险与 logoRow
//   那条同源——哈希前缀（hHd-Xa_）随官方构建变，后缀 `newSession` 是源码里的
//   名字，上游改名时这条规则会静默失效（届时官方胶囊会重新出现），随官方版本
//   核对；规则只摘呈现，不碰官方组件与它注入的 startSession。
const CSS =
  '.dshOneSidebarShell_frame,.dshOneSidebarShell_side,.dshOneSidebarShell_side>div{padding-left:0!important;padding-right:0!important;margin-left:0!important;margin-right:0!important}.dshOneSidebarShell_frame{background:var(--dsw-alias-bg-base);height:100%;display:flex;overflow:hidden;position:relative}.dshOneSidebarShell_side{flex:1;min-width:0;background:var(--dsw-specific-sidebar-fill);border-right:.5px solid var(--dsw-alias-border-l3);overflow:hidden}.dshOneSidebarShell_side [class*="logoRow"]{display:none}.dshOneSidebarShell_side>div>[class*="root"]>[class*="newSession"]{display:none}.dshOneSidebarShell_side button[aria-label="Collapse sidebar"],.dshOneSidebarShell_side button[aria-label="\\6536\\8d77\\4fa7\\680f"]{display:none}.dshOneSidebarShell_side>div>[class*="root"]{--dsh-sidebar-inline-padding:0px;padding-top:4px;max-width:none!important;margin-left:0!important;margin-right:0!important}.dshOneSidebarShell_overlay{z-index:20;pointer-events:none;position:absolute;inset:0}' +
  DENSITY_CSS
const CSS_TAG_ID = '@dsh-one/vscode-sidebar-shell/SidebarFrame.css'
if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`) === null) {
  const tag = document.createElement('style')
  tag.dataset.plugin = '@dsh-one/vscode-sidebar-shell'
  tag.dataset.pluginCss = CSS_TAG_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
}

// ---------------------------------------------------------------------------
// 骨架链几何快照（#70 自诊断构建）：实验室与真实 webview 出现「同文档不同
// 结果」（用户侧左侧 ~15-20px 空条 + 细竖线，实验室任何宽度 padL/R=0 贴缘）——
// 停止猜测，把 body→frame→side→wrapper→官方根 每层的 left/right/padding/
// margin/border 打出来：浏览器直接 console.log，webview 经诊断探针
// __DSH_ONE_PROBE__ 转给宿主输出面板（[assembly] 前缀频道）。只打一次，
// 首拍等不到骨架（官方根挂载晚）就再试两拍。
// ---------------------------------------------------------------------------

const GEOMETRY_LAYERS = [
  { label: 'body', selector: 'body' },
  { label: 'frame', selector: '.dshOneSidebarShell_frame' },
  { label: 'side', selector: '.dshOneSidebarShell_side' },
  { label: 'wrapper', selector: '.dshOneSidebarShell_side>div' },
  { label: 'official-root', selector: '.dshOneSidebarShell_side>div>[class*="root"]' },
] as const

function reportGeometry(): void {
  const emit = (line: string): void => {
    console.log(line)
    const probe = (globalThis as { __DSH_ONE_PROBE__?: { log(level: string, text: string): void } }).__DSH_ONE_PROBE__
    if (probe) probe.log('info', line)
  }
  const vw = document.documentElement.clientWidth
  emit(`[assembly] geometry viewport width=${vw}`)
  for (const layer of GEOMETRY_LAYERS) {
    const el = document.querySelector(layer.selector)
    if (el === null) {
      emit(`[assembly] geometry ${layer.label} MISSING (selector ${layer.selector})`)
      continue
    }
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    emit(
      `[assembly] geometry ${layer.selector} l=${Math.round(r.left)} r=${Math.round(r.right)} w=${Math.round(r.width)}` +
        ` padL=${cs.paddingLeft} padR=${cs.paddingRight} mL=${cs.marginLeft} mR=${cs.marginRight}` +
        ` bL=${cs.borderLeftWidth} bR=${cs.borderRightWidth} disp=${cs.display}`,
    )
  }
}

function scheduleGeometrySnapshot(): void {
  let tries = 0
  const attempt = (): void => {
    tries += 1
    if (document.querySelector('.dshOneSidebarShell_side>div>[class*="root"]') !== null || tries >= 3) {
      reportGeometry()
      return
    }
    setTimeout(attempt, 900)
  }
  setTimeout(attempt, 1800)
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
  scheduleGeometrySnapshot()
  const layout = new LayoutController()
  ctx.effect(() => {
    const disposeService = ctx.reflect.provide('layout', layout)
    // 官方 root 槽位钩子 panelInfo（机制层 1：官方槽位机制）。0.1.6 的官方
    // 会话树（ui-workspace 的 SessionTree/FlatList/SearchResults）以
    // `usePanelInfo((info) => info.activePanelId !== null)` 判定当前会话行是否
    // 高亮；官方框架插件 ui-layout 被下线后无人提供这份钩子，槽位挂载即抛
    // `usePanelInfo is not a function`，会话列表整块消失（#76 现场实锤）。
    const disposePanelInfo = ctx.slots.provideRoot({ hooks: { panelInfo: PANEL_INFO_SOURCE } })
    const disposeRegistration = ctx.slots.register(
      {
        name: 'root',
        children: {
          sidebar: { kind: 'single', scope: 'root' },
          'shell.overlay': { kind: 'list', scope: 'root' },
        },
        store: createLayoutStore,
        inject: (actions: PanelActions) => {
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
      disposePanelInfo()
      disposeService()
    }
  }, 'dsh-one sidebar shell: layout service + panel-info hook + root registration + brand shadow')
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
