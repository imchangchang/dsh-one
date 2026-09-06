/**
 * Sessions 面板 webview 前端（侧栏 dshOne.chat 视图）：拆分后只渲染会话
 * 列表，不含 chat。交互与原合并 webview 的 sessions 面板逐项一致——头部
 * 工具栏（搜索框/排序/刷新/折叠全部/新建会话/新建 workspace）、workspace 行
 * hover 操作、会话行状态槽与 ⋯/右键菜单、未分组虚拟组、vscode/当前标签、
 * 空态引导。宿主（src/ui/sessionsView.ts 的 SessionsViewProvider）把
 * SessionsStore 快照推来，动作经 post() 回 host。
 * 会话高亮（active/has-active）由快照的 activeSessionId 驱动；@ 提及补全
 * 仍属 chat webview，与这里的 sessions 快照无关。
 */
import { COPY_ICON, PANEL_ICONS, MESSAGE_ACTION_ICONS, type IconDef } from './chat/icons.ts'
import type { FromWebviewMessage, SessionsSnapshot, ToWebviewMessage } from '../pure/chatContract.ts'
import type { SessionNodeModel, SessionSortOrder, WorkspaceNodeModel } from '../pure/sessionTree.ts'
import { UNGROUPED_WORKSPACE_ID } from '../pure/sessionTree.ts'
import { TAG_COLORS, type TagColor } from '../pure/sessionTags.ts'
import {
  INSTALL_SCRIPT_OS_ORDER,
  installCommandFor,
  type HostOs,
} from '../pure/installScript.ts'
import { reconcileChildren, type ReconcileItem } from './shared/reconcile.ts'
import { spinSvg } from './shared/animPhase.ts'
import { composingActive, initComposeGuard } from './shared/composeGuard.ts'

interface VsCodeApi {
  postMessage(message: FromWebviewMessage): void
}
declare function acquireVsCodeApi(): VsCodeApi

const vscode = acquireVsCodeApi()
const app = document.getElementById('app') as HTMLElement

// i18n：宿主把当前 locale 的译文 map 经 HTML 注入为 window.__DSH_L10N__
// （key = 英文默认串）。英文 locale 不注入，直接用 key 本身；缺 key 时同样
// 回退 key 本身。与 chat webview 同款机制（见 chat/chatViewHtml.ts）。
const L10N: Readonly<Record<string, string>> = (globalThis as { __DSH_L10N__?: Record<string, string> }).__DSH_L10N__ ?? {}

/** 取当前 locale 的文案；支持 vscode.l10n 同款 {0}/{name} 占位。 */
function t(template: string, ...args: Array<string | number | Record<string, unknown>>): string {
  const text = L10N[template] ?? template
  if (args.length === 0) return text
  return text.replace(
    /\{(\d+)\}|\{(\w+)\}/g,
    (m: string, num: string | undefined, name: string | undefined): string => {
      if (num !== undefined) {
        const v = args[Number(num)]
        return typeof v === 'string' || typeof v === 'number' ? String(v) : m
      }
      const argsObj = args.find((a): a is Record<string, unknown> => typeof a === 'object' && a !== null)
      if (name !== undefined && argsObj && typeof argsObj[name] === 'string') return argsObj[name] as string
      return m
    },
  )
}

function post(message: FromWebviewMessage): void {
  vscode.postMessage(message)
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const e = document.createElement(tag)
  if (className) e.className = className
  if (text !== undefined) e.textContent = text
  return e
}

function buttonEl(className: string | undefined, text: string): HTMLButtonElement {
  const b = document.createElement('button')
  if (className) b.className = className
  b.textContent = text
  return b
}

function iconSvg(icon: IconDef, size = 16): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('viewBox', icon.viewBox ?? '0 0 16 16')
  svg.setAttribute('fill', 'none')
  for (const p of icon.paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    if (typeof p === 'string') {
      path.setAttribute('d', p)
    } else {
      path.setAttribute('d', p.d)
      if (p.transform) path.setAttribute('transform', p.transform)
      if (p.opacity) path.setAttribute('opacity', p.opacity)
    }
    path.setAttribute('fill', 'currentColor')
    if (icon.fillRule) {
      path.setAttribute('fill-rule', icon.fillRule)
      path.setAttribute('clip-rule', icon.fillRule)
    }
    svg.appendChild(path)
  }
  return svg
}

/** 描边小图标（排序/置顶图钉等本地扩展图标保留描边风格）。 */
function strokeSvg(paths: string[], size = 14): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('fill', 'none')
  for (const d of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', d)
    path.setAttribute('stroke', 'currentColor')
    path.setAttribute('stroke-width', '1.3')
    path.setAttribute('stroke-linecap', 'round')
    path.setAttribute('stroke-linejoin', 'round')
    svg.appendChild(path)
  }
  return svg
}

/* ---- 会话面板状态 ---- */
let sessionsSnapshot: SessionsSnapshot | null = null
/** 搜索框草稿，跨面板重建保留（同 composer 的 draft 模式）。 */
let sessionsSearchDraft = ''
let searchDebounce: ReturnType<typeof setTimeout> | null = null
/** 当前附着/高亮会话 id（快照的 activeSessionId），驱动 active/has-active。 */
let currentSessionId: string | null = null
/* 行内重命名编辑态：跨列表重建保留（快照/60s tick 不销毁输入框）。 */
let editingSessionId: string | null = null
let editDraft = ''
let editOriginalLabel = ''
let editSelStart = 0
let editSelEnd = 0
/** 列表重建进行中：blur 不应把编辑当取消（重建销毁输入框触发的 blur 要忽略）。 */
let rebuildInProgress = false
/**
 * 列表保活对账的签名缓存与持久容器（对标 chat webview 的 reconcileFlow 模式）：
 * .sessions-list 只建一次、永不销毁——滚动位置随容器天然存活（折叠/快照不再
 * 跳顶，回归 sessions-list-scroll-position-lost）；行/组头按内容签名决定是否
 * 原位重建，未变行整体保活（hover/菜单锚/动画相位随元素留存）。
 */
const sessionRowSigs = new Map<string, string>()
const recycleRowSigs = new Map<string, string>()
const wsHeadSigs = new Map<string, string>()
const recycleHeadSigs = new Map<string, string>()
const tagHeadSigs = new Map<string, string>()
const snippetSigs = new Map<string, string>()
const topItemSigs = new Map<string, string>()
let sessionsListEl: HTMLElement | null = null
/** 上帧搜索词：变化时滚动复位到顶（新结果集从头看；对账不背这口锅）。 */
let lastSessionsQuery: string | null = null
/**
 * IME 组合守护（document 级跟踪 + compositionend 补帧）已由共享模块
 * ui/shared/composeGuard 承担（与 chat webview 同一份）。组合期间 renderSessions
 * 冻结列表重建、组管理弹层跳过快照重建——元素销毁会中止浏览器 composition
 * 会话（拼音组合直接断），重建后恢复焦点/选区救不了它。
 */
initComposeGuard(renderSessions)

/* ---- 多选归档模式（临时 UI 状态：不进 store、不持久化，退出即清空） ---- */
let selectionMode = false
const selectedSessionIds = new Set<string>()
/** 批量归档确认弹窗（挂 body，不随列表重建销毁）；busy = 归档请求已发出；
 *  ids = 弹窗打开时锁定的可归档子集（确认时原样提交，不随勾选变化）。 */
let selectionModal: { overlay: HTMLElement; busy: boolean; ids: string[] } | null = null

/* ---- 回收站（本地可逆缓冲层）：抽屉开关是纯 webview UI 态，内容来自快照 ---- */
let recycleView = false
/** 抽屉 DOM 节点（打开期间存在，收起动画结束后移除）。 */
let recycleDrawer: HTMLElement | null = null
/** 回收站归档确认弹窗（清空/单个共用）；busy = 归档请求已发出。 */
let recycleModal: { overlay: HTMLElement; busy: boolean; sessionIds: string[] } | null = null

const sessionsPanel = el('aside', 'sessions-panel')
app.appendChild(sessionsPanel)

/* ---- 弹层（坐标 & 锚点两用） ---- */
let popover: HTMLElement | null = null
let popoverAnchor: HTMLElement | null = null
let popoverPlacement: 'above' | 'below' = 'above'
/** 二级子菜单（叠在顶层菜单之上，如「分组…」的勾选组）：与顶层菜单并存、
 *  随顶层菜单一起关闭。锚点 = 触发它的菜单项（hover 收起判定用）。 */
let subPopover: HTMLElement | null = null
let subPopoverAnchor: HTMLElement | null = null
let subPopoverCloseTimer: ReturnType<typeof setTimeout> | null = null
/** 菜单打开期间保持 hover 背景的来源行（会话行 ⋯ 菜单/右键菜单）。 */
let menuOpenRow: HTMLElement | null = null
/**
 * 会话行菜单（右键/⋯）打开期间的列表重建冻结：true 时 renderSessions 跳过
 * 列表重建（保留现有 DOM，行/菜单锚不销毁），新快照仍存进 sessionsSnapshot，
 * 等 closePopover 解冻后用最新快照一次性渲染。只针对会话行菜单；排序/添加
 * 菜单锚在 header（header 不重建），不受影响。
 */
let menuFreezeActive = false

function markMenuRow(row: HTMLElement | null): void {
  menuOpenRow?.classList.remove('menu-open')
  menuOpenRow = row
  menuOpenRow?.classList.add('menu-open')
}

function onPopoverOutside(e: MouseEvent): void {
  const t = e.target as Node
  const inside =
    (popover !== null && popover.contains(t)) ||
    (subPopover !== null && subPopover.contains(t)) ||
    (popoverAnchor !== null && popoverAnchor.contains(t)) ||
    (subPopoverAnchor !== null && subPopoverAnchor.contains(t))
  if (!inside) closePopover()
}

function onPopoverKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    closePopover()
  }
}

// webview 文档失焦即关菜单：点击编辑器/其他面板时 mousedown 在另一个文档
// 派发，webview 收不到（onPopoverOutside 无效），只有 blur 可靠——自绘菜单
// 没有宿主菜单系统帮它全局关闭，靠这一个信号补上「点外面就关」的原生体验。
function onPopoverBlur(): void {
  closePopover()
}

/** 二级子菜单的延时关闭（hover 收起用，缓冲指针横穿两菜单间隙）。 */
function cancelSubPopoverClose(): void {
  if (subPopoverCloseTimer !== null) {
    clearTimeout(subPopoverCloseTimer)
    subPopoverCloseTimer = null
  }
}
function scheduleSubPopoverClose(ms: number): void {
  cancelSubPopoverClose()
  subPopoverCloseTimer = setTimeout(() => {
    subPopoverCloseTimer = null
    disposeSubPopover()
  }, ms)
}
/** 只清二级子菜单（顶层菜单保持打开：hover 离开「分组…」项/横穿到别处时收起）。 */
function disposeSubPopover(): void {
  cancelSubPopoverClose()
  subPopover?.remove()
  subPopover = null
  subPopoverAnchor = null
}
// hover 收起判定：指针落在子菜单或锚点项内则保持，否则延时收起（横穿 6px
// 间隙移入子菜单会在间隙里先触发一次「不在」——140ms 内回到子菜单就取消）。
document.addEventListener('pointerover', (e) => {
  if (subPopover === null) return
  const t = e.target as Node
  if (subPopover.contains(t) || (subPopoverAnchor !== null && subPopoverAnchor.contains(t))) {
    cancelSubPopoverClose()
  } else {
    scheduleSubPopoverClose(140)
  }
})

/** 只清弹层 DOM、锚与事件监听的内部清理（showPopover/showPopoverAt 换菜单时
 *  用——不清冻结、不补渲染，因为新菜单还要继续开着）。 */
function disposePopover(): void {
  disposeSubPopover()
  popover?.remove()
  popover = null
  popoverAnchor = null
  markMenuRow(null)
  document.removeEventListener('mousedown', onPopoverOutside, true)
  document.removeEventListener('keydown', onPopoverKey, true)
  window.removeEventListener('blur', onPopoverBlur)
}

/** 菜单真正关闭（Esc / 点击外部 / 菜单项点击）：解除冻结 + 用最新快照补一次渲染。 */
function closePopover(): void {
  menuFreezeActive = false
  disposePopover()
  renderSessions()
}

// 右键按下（button===2）且落在会话行/工作区行内即进入冻结窗口——contextmenu
// 随后打开菜单，期间列表不因快照重建而销毁该行，菜单锚/视觉锚保持稳定。解冻
// 由 closePopover 统一处理。左键 ⋯ 按钮走其 onClick 里置冻结。多选模式右键无菜单。
document.addEventListener('pointerdown', (e) => {
  if (
    e.button === 2 &&
    !selectionMode &&
    (e.target as HTMLElement | null)?.closest?.('.session-row, .workspace-row')
  ) {
    menuFreezeActive = true
  }
})

function positionPopover(): void {
  if (!popover || !popoverAnchor) return
  const rect = popoverAnchor.getBoundingClientRect()
  const left = Math.min(rect.left, window.innerWidth - popover.offsetWidth - 4)
  popover.style.left = `${Math.max(4, left)}px`
  if (popoverPlacement === 'below') {
    popover.style.top = `${rect.bottom + 6}px`
  } else {
    popover.style.bottom = `${window.innerHeight - rect.top + 6}px`
  }
}

function showPopover(anchor: HTMLElement, body: HTMLElement, placement: 'above' | 'below' = 'above'): void {
  disposePopover()
  const p = el('div', 'popover')
  p.appendChild(body)
  document.body.appendChild(p)
  popover = p
  popoverAnchor = anchor
  popoverPlacement = placement
  positionPopover()
  document.addEventListener('mousedown', onPopoverOutside, true)
  document.addEventListener('keydown', onPopoverKey, true)
  window.addEventListener('blur', onPopoverBlur)
}

function showPopoverAt(x: number, y: number, body: HTMLElement): void {
  disposePopover()
  const p = el('div', 'popover')
  p.appendChild(body)
  document.body.appendChild(p)
  popover = p
  popoverAnchor = null
  const left = Math.min(x, window.innerWidth - p.offsetWidth - 4)
  const top = Math.min(y, window.innerHeight - p.offsetHeight - 4)
  p.style.left = `${Math.max(4, left)}px`
  p.style.top = `${Math.max(4, top)}px`
  document.addEventListener('mousedown', onPopoverOutside, true)
  document.addEventListener('keydown', onPopoverKey, true)
  window.addEventListener('blur', onPopoverBlur)
}

/** 二级子菜单（不清顶层菜单，两菜单并存）：锚在其触发项右侧。mousedown/keydown/
 *  blur 监听由顶层菜单打开时统一挂着，点击/按键判定把两层都算「内部」。 */
function showSubPopoverAt(x: number, y: number, anchor: HTMLElement, body: HTMLElement): void {
  disposeSubPopover()
  const p = el('div', 'popover')
  p.appendChild(body)
  document.body.appendChild(p)
  subPopover = p
  subPopoverAnchor = anchor
  const left = Math.min(x, window.innerWidth - p.offsetWidth - 4)
  const top = Math.min(y, window.innerHeight - p.offsetHeight - 4)
  p.style.left = `${Math.max(4, left)}px`
  p.style.top = `${Math.max(4, top)}px`
}

/* ---- 悬停 tooltip（VS Code webview 原生 title 不显示，自实现） ---- */
let tipEl: HTMLElement | null = null
function ensureTipEl(): HTMLElement {
  if (!tipEl) {
    tipEl = el('div', 'dsh-tooltip')
    document.body.appendChild(tipEl)
  }
  return tipEl
}
function hideTip(): void {
  if (tipEl) tipEl.style.display = 'none'
}
/** 瞬态提示（飘一下自动消失）：复用悬停气泡元素定位在锚点上方，2.2s 后隐藏。 */
let flashTipTimer: ReturnType<typeof setTimeout> | null = null
function flashTip(text: string, anchor: HTMLElement): void {
  if (flashTipTimer !== null) clearTimeout(flashTipTimer)
  const t = ensureTipEl()
  t.textContent = text
  const rect = anchor.getBoundingClientRect()
  t.style.display = 'block'
  const w = t.offsetWidth
  const left = Math.max(4, Math.min(rect.left + rect.width / 2 - w / 2, window.innerWidth - w - 4))
  t.style.left = `${left}px`
  const h = t.offsetHeight
  let top = rect.top - h - 6
  if (top < 4) top = rect.bottom + 6
  t.style.top = `${top}px`
  flashTipTimer = setTimeout(() => {
    flashTipTimer = null
    hideTip()
  }, 2200)
}
// 事件委托：任何带 [data-tip] 的元素（含重建后的按钮）悬停即显示文本气泡。
// 用 fixed 定位挂在 body 上，不随 .sessions-list 滚动裁剪，水平钳制不外溢。
document.addEventListener('pointerover', (e) => {
  const target = (e.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null
  if (!target) {
    hideTip()
    return
  }
  const tip = target.getAttribute('data-tip')
  if (!tip) {
    hideTip()
    return
  }
  const t = ensureTipEl()
  t.textContent = tip
  const rect = target.getBoundingClientRect()
  t.style.display = 'block'
  const w = t.offsetWidth
  const left = Math.max(4, Math.min(rect.left + rect.width / 2 - w / 2, window.innerWidth - w - 4))
  t.style.left = `${left}px`
  const h = t.offsetHeight
  let top = rect.top - h - 6
  if (top < 4) top = rect.bottom + 6
  t.style.top = `${top}px`
})
document.addEventListener('pointerout', (e) => {
  const target = (e.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null
  if (target) {
    const related = e.relatedTarget as Node | null
    if (related && target.contains(related)) return
  }
  hideTip()
})

function menuItem(
  label: string,
  opts: {
    right?: string
    checked?: boolean
    glyph?: string
    icon?: SVGSVGElement | HTMLElement
    /** 禁用态：加 .menu-item.disabled（置灰、不响应点击），onClick 不绑定。 */
    disabled?: boolean
    /** 禁用原因的悬停提示（data-tip）；仅 disabled 时设置。 */
    disabledTip?: string
    onClick: () => void
  },
): HTMLElement {
  const item = el('div', opts.checked ? 'menu-item checked' : 'menu-item')
  if (opts.disabled) item.classList.add('disabled')
  if (opts.disabled && opts.disabledTip) item.setAttribute('data-tip', opts.disabledTip)
  if (opts.glyph) {
    const g = el('span', 'glyph')
    g.innerHTML = opts.glyph // build-time constant strings, not user input
    item.appendChild(g)
  }
  if (opts.icon) {
    const ic = el('span', 'menu-item-icon')
    ic.appendChild(opts.icon)
    item.appendChild(ic)
  }
  item.appendChild(el('span', undefined, label))
  if (opts.right) item.appendChild(el('span', 'menu-right', opts.right))
  if (opts.checked) item.appendChild(el('span', 'check', '✓'))
  if (!opts.disabled) item.addEventListener('click', opts.onClick)
  return item
}

/* ---- 会话面板图标 ---- */
const SORT_ICON = ['M4.5 3v10', 'M4.5 13l-2.2-2.6', 'M4.5 13l2.2-2.6', 'M11.5 13V3', 'M11.5 3L9.3 5.6', 'M11.5 3l2.2 2.6']
const PIN_ICON = ['M5.9 2.5h4.2l.6 3.8 1.8 1.7v1.5h-9V8l1.8-1.7.6-3.8z', 'M8 9.5v4']
const UNREAD_ICON = ['M8 2.6a5.4 5.4 0 1 0 0 10.8 5.4 5.4 0 0 0 0-10.8z']
/** 垃圾桶描边图标（「从列表移除」，VS Code codicon trash 的简化线条画法：
 *  桶盖横线 + 提手 + 梯形桶身（上宽下窄）+ 三条竖线）。 */
const TRASH_ICON = [
  'M2.8 4.3h10.4',
  'M6.2 4.3v-1h3.6v1',
  'M4.1 4.3l.7 9.1h6.4l.7-9.1',
  'M6.3 6.7v4.6',
  'M8 6.7v4.6',
  'M9.7 6.7v4.6',
]
/** 一键清除 ✕ 描边图标（搜索框右侧按钮，与排序/置顶图钉同 stroke 风格）。 */
const CLEAR_ICON = ['M4 4l8 8', 'M12 4l-8 8']
/** 恢复（undo）描边图标：回收站行菜单「恢复」用。 */
const RESTORE_ICON = ['M10 3.5L7 6.5l3 3', 'M7 6.5h3.2a3.6 3.6 0 0 1 0 7.2H6.4']
/** 下拉箭头（▼，描边）：抽屉头「收起」用——抽屉向下滑出/收起，用下箭头指示。 */
const COLLAPSE_ICON = ['M3.5 5.5L8 10l4.5-4.5']

function makePinIcon(): SVGSVGElement {
  const svg = strokeSvg(PIN_ICON)
  svg.classList.add('pin-icon')
  return svg
}

/**
 * 运行中像素环：复刻官方 dsh web StateDot(ongoing)——10×10 画布上 8 个
 * 2×2 方块沿环排布，各自带负的 animationDelay 错相，配合 .session-spin 的
 * chase keyframes（SessionsViewProvider 的 STYLE）形成转圈追逐效果。
 */
/** 运行中像素环（spinSvg/SPIN_CELLS）已由共享模块 ui/shared/animPhase 承担
 * （此处原本是 chat webview 的逐字复制，注释自承「同款处理」）。 */

/** 排序菜单选项，与 store 持久化的 SessionSortOrder 一一对应。 */
const SORT_OPTIONS: Array<{ order: SessionSortOrder; label: string }> = [
  { order: 'updatedDesc', label: t('Most recent first') },
  { order: 'updatedAsc', label: t('Oldest first') },
  { order: 'title', label: t('Sort by title') },
]

function panelTool(icon: SVGSVGElement, title: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'sessions-tool'
  // 悬停提示走自实现 tooltip（webview 原生 title 不显示）；data-tip 供委托读取。
  b.setAttribute('data-tip', title)
  b.setAttribute('aria-label', title)
  b.appendChild(icon)
  return b
}

function rowAction(icon: SVGSVGElement, title: string, onClick: () => void): HTMLButtonElement {
  const b = panelTool(icon, title)
  b.className = 'row-action'
  b.addEventListener('click', (e) => {
    e.stopPropagation()
    onClick()
  })
  return b
}

function openSortMenu(anchor: HTMLElement): void {
  const snap = sessionsSnapshot
  if (!snap) return
  const body = el('div')
  for (const opt of SORT_OPTIONS) {
    body.appendChild(
      menuItem(opt.label, {
        checked: snap.sortOrder === opt.order,
        onClick: () => {
          closePopover()
          if (snap.sortOrder !== opt.order) post({ type: 'sessionsSort', order: opt.order })
        },
      }),
    )
  }
  showPopover(anchor, body, 'below')
}

/* ---- 面板渲染 ---- */
let sessionsHeaderEl: HTMLElement | null = null
let collapseAllBtn: HTMLButtonElement | null = null

/** 「折叠所有」按钮当前应显示的状态（搜索态恒为 false，即「折叠所有工作区」）。 */
function computeAllCollapsed(snap: SessionsSnapshot | null): boolean {
  if (!snap || (snap.query != null && snap.query !== '')) return false
  const expandable = snap.workspaces.filter((w) => w.sessions.length > 0)
  return expandable.length > 0 && expandable.every((w) => snap.collapsed.includes(w.workspaceId))
}

/** header（含搜索框）只建一次：搜索框 DOM 永不销毁，IME 输入不受快照重建打断。 */
function buildSessionsHeader(): HTMLElement {
  const header = el('div', 'sessions-header')
  const searchWrap = el('div', 'search-wrap')
  const search = document.createElement('input')
  search.className = 'sessions-search'
  search.placeholder = t('Search sessions')
  // 后端 session.search 只接受 1–500 字符；输入上限对齐，避免截断歧义。
  search.maxLength = 500
  search.value = sessionsSearchDraft
  // 一键清除 ✕：header 持久，按钮首建后只按 has-text toggle，不重建。
  const clearBtn = document.createElement('button')
  clearBtn.type = 'button'
  clearBtn.className = 'search-clear'
  clearBtn.setAttribute('aria-label', t('Clear search'))
  clearBtn.setAttribute('data-tip', t('Clear search'))
  clearBtn.appendChild(strokeSvg(CLEAR_ICON, 12))
  const updateClear = (): void => {
    searchWrap.classList.toggle('has-text', sessionsSearchDraft.trim() !== '')
  }
  updateClear()
  search.addEventListener('input', () => {
    sessionsSearchDraft = search.value
    updateClear()
    if (searchDebounce !== null) clearTimeout(searchDebounce)
    searchDebounce = setTimeout(() => {
      searchDebounce = null
      post({ type: 'sessionsSearch', query: sessionsSearchDraft.trim() === '' ? null : sessionsSearchDraft })
    }, 200)
  })
  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    sessionsSearchDraft = ''
    search.value = ''
    updateClear()
    search.focus()
    // 与手动清空输入一致：走现有路径关闭搜索过滤。
    post({ type: 'sessionsSearch', query: null })
    if (searchDebounce !== null) clearTimeout(searchDebounce)
  })
  searchWrap.appendChild(search)
  searchWrap.appendChild(clearBtn)
  header.appendChild(searchWrap)
  const sortBtn = panelTool(strokeSvg(SORT_ICON, 16), t('Sort by'))
  sortBtn.addEventListener('click', () => openSortMenu(sortBtn))
  header.appendChild(sortBtn)
  const refreshBtn = panelTool(iconSvg(PANEL_ICONS.refresh, 12), t('Refresh session list'))
  // 刷新视觉反馈：点击立即转圈 + 禁用，直至 ~450ms 后复位（header 持久，同一 DOM 节点）。
  refreshBtn.addEventListener('click', () => {
    refreshBtn.classList.add('refreshing')
    refreshBtn.disabled = true
    post({ type: 'sessionsRefresh' })
    window.setTimeout(() => {
      refreshBtn.classList.remove('refreshing')
      refreshBtn.disabled = false
    }, 450)
  })
  header.appendChild(refreshBtn)
  collapseAllBtn = panelTool(iconSvg(PANEL_ICONS.boxedMinus, 16), t('Collapse all workspaces'))
  collapseAllBtn.addEventListener('click', () => {
    post({ type: computeAllCollapsed(sessionsSnapshot) ? 'workspacesExpandAll' : 'workspacesCollapseAll' })
  })
  header.appendChild(collapseAllBtn)
  const addBtn = panelTool(iconSvg(PANEL_ICONS.plus, 14), t('Add workspace'))
  addBtn.addEventListener('click', () => {
    const body = el('div')
    body.appendChild(
      menuItem(t('Add existing folder…'), {
        icon: iconSvg(PANEL_ICONS.folderOpen),
        onClick: () => {
          closePopover()
          post({ type: 'workspaceAdd' })
        },
      }),
    )
    body.appendChild(
      menuItem(t('Create workspace…'), {
        icon: iconSvg(PANEL_ICONS.plus),
        onClick: () => {
          closePopover()
          post({ type: 'workspaceCreate' })
        },
      }),
    )
    showPopover(addBtn, body, 'below')
  })
  header.appendChild(addBtn)
  return header
}

/** 折叠全部按钮图标/title 随当前态更新（header 不重建时唯一需要动态更新的部分）。 */
function updateCollapseAllIcon(): void {
  if (!collapseAllBtn) return
  const allCollapsed = computeAllCollapsed(sessionsSnapshot)
  const tip = allCollapsed ? t('Expand all workspaces') : t('Collapse all workspaces')
  collapseAllBtn.replaceChildren(iconSvg(allCollapsed ? PANEL_ICONS.boxedPlus : PANEL_ICONS.boxedMinus, 16))
  collapseAllBtn.setAttribute('data-tip', tip)
  collapseAllBtn.setAttribute('aria-label', tip)
}

/* ---- 工作区分组（tag 多对多过滤 + 下拉选择器 + 管理视图） ---- */

/** 分组栏（搜索框下、列表上一行）：只建一次，选中态经 updateGroupBar 更新。 */
let groupBarEl: HTMLElement | null = null
/** 分组栏左按钮的标签（「全部工作区」或当前组名）。 */
let groupBarLabel: HTMLElement | null = null

/**
 * 管理视图弹层状态（null = 关闭）。open 后跨快照重建保留：选中组、改名/
 * 删除确认、新建输入草稿都在这里；快照到达时经 rebuildGroupManage 重建
 * 列表（勾选态/组列表随新快照刷新）。dragOrder 只在拖拽进行中有意义。
 */
let groupManage: {
  overlay: HTMLElement
  selectedGroupId: string | null
  renameGroupId: string | null
  renameDraft: string
  renameError: string | null
  confirmDeleteId: string | null
  newGroupDraft: string
  newGroupError: string | null
  dragOrder: string[] | null
  dragging: boolean
} | null = null

/** 管理分组… 菜单项的齿轮图标（codicon settings-gear 路径，MIT）。 */
const GEAR_ICON: IconDef = {
  viewBox: '0 0 16 16',
  paths: [
    'M13.9 8.5944l.9244-.5391.7423.1381c.4427.0824.7589.5166.7322.9547l-.118 1.8667c-.0288.455-.3939.8152-.8481.8402l-1.7734.0989-.657.7233.5132 1.7068c.1458.4853-.1646.9801-.6635 1.0521l-1.8334.2638c-.4738.0682-.9033-.0941-1.1708-.4356l-.9629-1.5233h-1.3375l-.9628 1.5233c-.2675.3415-.697.5038-1.1707.4356l-1.8335-.2638c-.4989-.072-.8093-.5668-.6634-1.0521l.5131-1.7068-.657-.7233-1.7734-.0989c-.4541-.025-.8193-.3852-.8481-.8402l-.118-1.8667c-.0267-.4381.2895-.8723.7321-.9547l.7423-.1381.9244-.5391-.5131-1.7069c-.1458-.4853.1646-.98.6635-1.0521l1.8334-.2638c.4738-.0682.9033.0941 1.1707.4356l.963 1.5234h1.3374l.9629-1.5234c.2674-.3415.6969-.5038 1.1707-.4356l1.8334.2638c.4989.072.8093.5668.6635 1.0521z',
    'M8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z',
  ],
}

/** 拖拽手柄的六点图标（管理视图组行排序用）。 */
function dragHandleSvg(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', '9')
  svg.setAttribute('height', '14')
  svg.setAttribute('viewBox', '0 0 9 14')
  svg.setAttribute('fill', 'currentColor')
  for (const cy of [1.5, 7, 12.5]) {
    for (const cx of [2, 7]) {
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      c.setAttribute('cx', String(cx))
      c.setAttribute('cy', String(cy))
      c.setAttribute('r', '1.4')
      svg.appendChild(c)
    }
  }
  return svg
}

/** 分组栏（含左选择器 + 右「+」新建）：只建一次，避免快照重建打断输入/点击。 */
function buildGroupBar(): HTMLElement {
  const bar = el('div', 'ws-group-bar')
  const select = buttonEl('ws-group-select', '')
  const label = el('span', 'ws-group-select-label', t('All workspaces'))
  const chevron = el('span', 'ws-group-select-chevron')
  chevron.appendChild(iconSvg(PANEL_ICONS.chevronDown, 12))
  select.appendChild(label)
  select.appendChild(chevron)
  select.addEventListener('click', () => openGroupMenu())
  groupBarLabel = label
  bar.appendChild(select)
  const add = buttonEl('ws-group-add', '')
  add.setAttribute('aria-label', t('New group'))
  add.setAttribute('data-tip', t('New group'))
  add.appendChild(iconSvg(PANEL_ICONS.plus, 14))
  add.addEventListener('click', () => openGroupCreate())
  bar.appendChild(add)
  return bar
}

/** 分组栏选中态随快照刷新（只改 label 文本，不重建 DOM）。 */
function updateGroupBar(): void {
  const snap = sessionsSnapshot
  if (!snap || !groupBarLabel) return
  const name = snap.activeGroupId !== null ? (snap.groups.find((g) => g.id === snap.activeGroupId)?.name ?? null) : null
  groupBarLabel.textContent = name ?? t('All workspaces')
}

/** 分组选择下拉：全部工作区 + 当前选中置顶 + 其余按持久化顺序 + 管理分组…。 */
function openGroupMenu(): void {
  const snap = sessionsSnapshot
  if (!snap || !groupBarEl) return
  const body = el('div')
  body.appendChild(
    menuItem(t('All workspaces'), {
      right: String(snap.workspaceDirectory.length),
      checked: snap.activeGroupId === null,
      onClick: () => {
        closePopover()
        if (snap.activeGroupId !== null) post({ type: 'workspaceGroupSelect', groupId: null })
      },
    }),
  )
  if (snap.activeGroupId !== null) {
    const current = snap.groups.find((g) => g.id === snap.activeGroupId)
    // 当前选中项置顶列出（长列表时选中态不被淹没），点它只收起菜单。
    if (current) {
      body.appendChild(
        menuItem(current.name, {
          right: String(current.count),
          checked: true,
          onClick: () => closePopover(),
        }),
      )
    }
  }
  for (const g of snap.groups) {
    if (g.id === snap.activeGroupId) continue
    body.appendChild(
      menuItem(g.name, {
        right: String(g.count),
        onClick: () => {
          closePopover()
          post({ type: 'workspaceGroupSelect', groupId: g.id })
        },
      }),
    )
  }
  body.appendChild(el('div', 'menu-sep'))
  body.appendChild(
    menuItem(t('Manage groups…'), {
      icon: iconSvg(GEAR_ICON, 14),
      onClick: () => {
        closePopover()
        openGroupManage()
      },
    }),
  )
  showPopover(groupBarEl.querySelector('.ws-group-select') ?? groupBarEl, body, 'below')
}

/** 「+」快速建组：内联输入（Enter/按钮提交），空名/重名就地提示。 */
function openGroupCreate(): void {
  const snap = sessionsSnapshot
  if (!snap || !groupBarEl) return
  const body = el('div', 'wsg-create')
  body.appendChild(el('div', 'wsg-create-title', t('New group')))
  const input = document.createElement('input')
  input.className = 'wsg-create-input'
  input.placeholder = t('Group name')
  input.maxLength = 100
  const error = el('div', 'wsg-error')
  const commit = (): void => {
    const name = input.value.trim()
    if (name === '') {
      error.textContent = t('Group name cannot be empty')
      return
    }
    if (snap.groups.some((g) => g.name === name)) {
      error.textContent = t('A group with this name already exists')
      return
    }
    post({ type: 'workspaceGroupCreate', name })
    closePopover()
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault()
      commit()
    }
  })
  const submit = buttonEl('wsg-create-submit', t('Create'))
  submit.addEventListener('click', commit)
  body.appendChild(input)
  body.appendChild(error)
  body.appendChild(submit)
  showPopover(groupBarEl.querySelector('.ws-group-add') ?? groupBarEl, body, 'below')
  // 弹层渲染后聚焦输入（IME 用户直接可输入）。
  window.setTimeout(() => input.focus(), 0)
}

/** 打开管理视图（弹层）：建组/重命名/删除 + 拖拽排序 + 视图内给 workspace 打标。 */
function openGroupManage(): void {
  const snap = sessionsSnapshot
  if (!snap || groupManage) return
  const overlay = el('div', 'wsg-manage-overlay')
  // 点遮罩（弹层卡片外）即关闭；卡片内点击不冒泡到遮罩判定。
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) closeGroupManage()
  })
  document.body.appendChild(overlay)
  groupManage = {
    overlay,
    selectedGroupId: snap.activeGroupId,
    renameGroupId: null,
    renameDraft: '',
    renameError: null,
    confirmDeleteId: null,
    newGroupDraft: '',
    newGroupError: null,
    dragOrder: null,
    dragging: false,
  }
  rebuildGroupManage()
  document.addEventListener('keydown', onGroupManageKey, true)
}

function closeGroupManage(): void {
  if (!groupManage) return
  groupManage.overlay.remove()
  groupManage = null
  document.removeEventListener('keydown', onGroupManageKey, true)
}

/** 管理视图 Esc：改名/新建输入框内的 Esc 由输入框自身处理（取消输入态），
 *  其余任意处 Esc 关闭整个弹层。 */
function onGroupManageKey(e: KeyboardEvent): void {
  const target = e.target as HTMLElement | null
  if (target?.closest?.('.wsg-manage input')) return
  if (e.key === 'Escape') {
    e.preventDefault()
    closeGroupManage()
  }
}

/** 管理视图内容整体重建（快照到达/本地动作后调用）；拖拽进行中跳过（不打断拖拽）。 */
function rebuildGroupManage(): void {
  const m = groupManage
  const snap = sessionsSnapshot
  if (!m || !snap || m.dragging) return
  // 弹层 body 是滚动容器（.wsg-manage-body）：整卡替换会丢滚动位置，
  // 重建前后存取（回归 sessions-list-scroll-position-lost 同款）。
  const body = m.overlay.querySelector<HTMLElement>('.wsg-manage-body')
  const savedScrollTop = body?.scrollTop ?? 0
  m.overlay.replaceChildren(buildGroupManageCard(snap))
  const newBody = m.overlay.querySelector<HTMLElement>('.wsg-manage-body')
  if (newBody) newBody.scrollTop = savedScrollTop
  // 改名输入框重建后恢复焦点与选区（快照刷新不打断正在输入的名字）。
  if (m.renameGroupId !== null) {
    const input = m.overlay.querySelector<HTMLInputElement>('.wsg-row-rename-input')
    if (input) {
      input.focus()
      input.setSelectionRange(input.value.length, input.value.length)
    }
  }
}

function buildGroupManageCard(snap: SessionsSnapshot): HTMLElement {
  const m = groupManage!
  const card = el('div', 'wsg-manage')
  const head = el('div', 'wsg-manage-head')
  head.appendChild(el('span', 'wsg-manage-title', t('Manage groups')))
  const closeBtn = buttonEl('wsg-manage-close', '')
  closeBtn.setAttribute('aria-label', t('Close'))
  closeBtn.appendChild(strokeSvg(CLEAR_ICON, 12))
  closeBtn.addEventListener('click', () => closeGroupManage())
  head.appendChild(closeBtn)
  card.appendChild(head)

  const body = el('div', 'wsg-manage-body')
  body.appendChild(buildGroupManageGroups(snap))
  body.appendChild(buildGroupManageMembers(snap))
  card.appendChild(body)
  return card
}

/** 管理视图「分组」区：组行（拖拽手柄/名称/计数/改名/删除）+ 底部新建行。 */
function buildGroupManageGroups(snap: SessionsSnapshot): HTMLElement {
  const m = groupManage!
  const sec = el('div', 'wsg-groups')
  sec.appendChild(el('div', 'wsg-section-title', t('Groups')))
  if (snap.groups.length === 0) {
    sec.appendChild(el('div', 'wsg-groups-empty', t('No groups yet. Enter a name below to create one.')))
  } else {
    const order = m.dragOrder ?? snap.groups.map((g) => g.id)
    const byId = new Map(snap.groups.map((g) => [g.id, g]))
    for (const id of order) {
      const g = byId.get(id)
      if (g) sec.appendChild(buildGroupManageRow(g, snap))
    }
  }
  const newRow = el('div', 'wsg-new-row')
  const input = document.createElement('input')
  input.className = 'wsg-new-input'
  input.placeholder = t('Group name')
  input.maxLength = 100
  input.value = m.newGroupDraft
  const commit = (): void => {
    const name = input.value.trim()
    if (name === '') {
      m.newGroupDraft = input.value
      m.newGroupError = t('Group name cannot be empty')
      rebuildGroupManage()
      return
    }
    if (snap.groups.some((g) => g.name === name)) {
      m.newGroupDraft = input.value
      m.newGroupError = t('A group with this name already exists')
      rebuildGroupManage()
      return
    }
    post({ type: 'workspaceGroupCreate', name })
    m.newGroupDraft = ''
    m.newGroupError = null
    rebuildGroupManage()
  }
  input.addEventListener('input', () => {
    m.newGroupDraft = input.value
    m.newGroupError = null
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape' && !e.isComposing) {
      e.preventDefault()
      m.newGroupDraft = input.value
      m.newGroupError = null
      input.blur()
    }
  })
  const submit = buttonEl('wsg-new-add', t('Create'))
  submit.addEventListener('click', commit)
  newRow.appendChild(input)
  newRow.appendChild(submit)
  sec.appendChild(newRow)
  if (m.newGroupError) sec.appendChild(el('div', 'wsg-error', m.newGroupError))
  return sec
}

/** 管理视图的一行分组：行点击 = 选中（下方工作区打标区切换）；✎/🗑 行内操作。 */
function buildGroupManageRow(g: { id: string; name: string; count: number }, snap: SessionsSnapshot): HTMLElement {
  const m = groupManage!
  const renaming = m.renameGroupId === g.id
  const confirming = m.confirmDeleteId === g.id
  const row = el('div', `wsg-row${m.selectedGroupId === g.id ? ' selected' : ''}`)
  row.dataset.groupId = g.id
  const handle = el('span', 'wsg-row-handle')
  handle.setAttribute('aria-label', t('Drag to reorder'))
  handle.setAttribute('data-tip', t('Drag to reorder'))
  handle.appendChild(dragHandleSvg())
  handle.addEventListener('pointerdown', (e) => onGroupDragStart(e, g.id))
  row.appendChild(handle)
  if (confirming) {
    row.appendChild(el('span', 'wsg-row-confirm', t('Delete group "{0}"?', g.name)))
    const confirmBtn = buttonEl('wsg-row-delete', t('Delete'))
    confirmBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      post({ type: 'workspaceGroupDelete', groupId: g.id })
      m.confirmDeleteId = null
      rebuildGroupManage()
    })
    const cancelBtn = buttonEl('secondary', t('Cancel'))
    cancelBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      m.confirmDeleteId = null
      rebuildGroupManage()
    })
    row.appendChild(confirmBtn)
    row.appendChild(cancelBtn)
  } else if (renaming) {
    const input = document.createElement('input')
    input.className = 'wsg-row-rename-input'
    input.maxLength = 100
    input.value = m.renameDraft
    input.addEventListener('input', () => {
      m.renameDraft = input.value
      m.renameError = null
    })
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault()
        commitGroupRename(g.id)
      } else if (e.key === 'Escape' && !e.isComposing) {
        e.preventDefault()
        m.renameGroupId = null
        m.renameError = null
        rebuildGroupManage()
      }
    })
    row.appendChild(input)
    if (m.renameError) row.appendChild(el('span', 'wsg-error', m.renameError))
  } else {
    row.appendChild(el('span', 'wsg-row-name', g.name))
  }
  if (!confirming) {
    row.appendChild(el('span', 'wsg-row-count', String(g.count)))
    const renameBtn = buttonEl('wsg-row-btn', '')
    renameBtn.setAttribute('aria-label', t('Rename group'))
    renameBtn.setAttribute('data-tip', t('Rename group'))
    renameBtn.appendChild(iconSvg(PANEL_ICONS.edit, 12))
    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      m.renameGroupId = g.id
      m.renameDraft = g.name
      m.renameError = null
      rebuildGroupManage()
    })
    row.appendChild(renameBtn)
    const deleteBtn = buttonEl('wsg-row-btn', '')
    deleteBtn.setAttribute('aria-label', t('Delete group'))
    deleteBtn.setAttribute('data-tip', t('Delete group'))
    deleteBtn.appendChild(strokeSvg(TRASH_ICON, 12))
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      m.confirmDeleteId = g.id
      m.renameGroupId = null
      rebuildGroupManage()
    })
    row.appendChild(deleteBtn)
  }
  // 行点击 = 选该组（改名/确认态里点输入框不触发——重建会打断输入）。
  row.addEventListener('click', (e) => {
    if (renaming && (e.target as HTMLElement).closest('input')) return
    m.selectedGroupId = g.id
    rebuildGroupManage()
  })
  return row
}

/** 改名提交：非空、不重名（排除自身）才发；失败就地提示并保持编辑态。 */
function commitGroupRename(groupId: string): void {
  const m = groupManage
  const snap = sessionsSnapshot
  if (!m || !snap) return
  const name = m.renameDraft.trim()
  if (name === '') {
    m.renameError = t('Group name cannot be empty')
    rebuildGroupManage()
    return
  }
  if (snap.groups.some((g) => g.id !== groupId && g.name === name)) {
    m.renameError = t('A group with this name already exists')
    rebuildGroupManage()
    return
  }
  post({ type: 'workspaceGroupRename', groupId, name })
  m.renameGroupId = null
  m.renameError = null
  rebuildGroupManage()
}

/** 管理视图「工作区归组」区：选中某组后列出全部 workspace，勾选/取消归组。 */
function buildGroupManageMembers(snap: SessionsSnapshot): HTMLElement {
  const m = groupManage!
  const sec = el('div', 'wsg-members')
  const selected = snap.groups.find((g) => g.id === m.selectedGroupId)
  if (!selected) {
    sec.appendChild(el('div', 'wsg-section-title', t('Workspaces in group')))
    sec.appendChild(el('div', 'wsg-hint', t('Select a group above, then check the workspaces it contains.')))
    return sec
  }
  const title = el('div', 'wsg-members-title')
  title.appendChild(el('span', 'wsg-members-title-label', t('Workspaces in group: {0}', selected.name)))
  title.appendChild(el('span', 'wsg-row-count', String(selected.count)))
  sec.appendChild(title)
  if (snap.workspaceDirectory.length === 0) {
    sec.appendChild(el('div', 'wsg-hint', t('No workspaces yet. Add one from the panel first, then tag it here.')))
    return sec
  }
  for (const w of snap.workspaceDirectory) {
    const line = el('label', 'wsg-member')
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    // 勾选态随时取最新快照的归属（快速连点不依赖本次渲染时的旧值）。
    cb.checked = (sessionsSnapshot?.groupMembership[w.workspaceId] ?? []).includes(selected.id)
    cb.addEventListener('change', () => {
      const current = sessionsSnapshot?.groupMembership[w.workspaceId] ?? []
      const next = cb.checked ? [...current, selected.id] : current.filter((id) => id !== selected.id)
      post({ type: 'workspaceGroupSetMembership', workspaceId: w.workspaceId, groupIds: next })
    })
    line.appendChild(cb)
    line.appendChild(el('span', 'wsg-member-label', w.label))
    sec.appendChild(line)
  }
  return sec
}

/** 组行拖拽排序（pointer capture 跟随）：实时换位，松手把全量顺序提交宿主。 */
function onGroupDragStart(e: PointerEvent, groupId: string): void {
  const m = groupManage
  const snap = sessionsSnapshot
  if (!m || !snap || e.button !== 0) return
  const handle = e.currentTarget as HTMLElement
  const row = handle.closest<HTMLElement>('.wsg-row')
  const list = row?.parentElement
  if (!row || !list || row.dataset.groupId !== groupId) return
  e.preventDefault()
  m.dragging = true
  m.dragOrder = snap.groups.map((g) => g.id)
  row.classList.add('dragging')
  const move = (ev: PointerEvent): void => {
    // 扫描时排除被拖行本身：找到「中线已越过指针」的第一行 → 插到它前面；
    // 指针低于最后一行 → 插到末尾。双向都生效（旧实现向下拖时目标行
    // 恒为被拖行自身，insertBefore 原地不动，拖不下去）。
    const others = Array.from(list.querySelectorAll<HTMLElement>('.wsg-row')).filter((r) => r !== row)
    let target: HTMLElement | null = null
    for (const r of others) {
      const rect = r.getBoundingClientRect()
      if (ev.clientY < rect.top + rect.height / 2) {
        target = r
        break
      }
    }
    if (target !== null) list.insertBefore(row, target)
    else if (list.lastElementChild !== row) list.appendChild(row)
    m.dragOrder = Array.from(list.querySelectorAll<HTMLElement>('.wsg-row'))
      .map((r) => r.dataset.groupId)
      .filter((id): id is string => id !== undefined)
  }
  const up = (): void => {
    document.removeEventListener('pointermove', move, true)
    document.removeEventListener('pointerup', up, true)
    document.removeEventListener('pointercancel', up, true)
    row.classList.remove('dragging')
    const finalOrder = Array.from(list.querySelectorAll<HTMLElement>('.wsg-row'))
      .map((r) => r.dataset.groupId)
      .filter((id): id is string => id !== undefined)
    m.dragging = false
    m.dragOrder = null
    // 顺序没变就不发（store 侧同样有幂等判断，这里省一次往返）。
    if (finalOrder.length === snap.groups.length && finalOrder.every((id, i) => id === snap.groups[i].id)) {
      rebuildGroupManage()
      return
    }
    post({ type: 'workspaceGroupReorder', groupIds: finalOrder })
  }
  // 移动/抬起监听挂 document（捕获阶段）：指针划出手柄后仍能跟踪；拖拽是
  // 短暂交互，全局监听用完即摘。setPointerCapture 是优化项——合成事件
  // （自动化测试）或异常指针 id 下会抛 InvalidPointerId，降级为纯 document
  // 监听（指针仍在页面内移动即可），不影响功能。
  document.addEventListener('pointermove', move, true)
  document.addEventListener('pointerup', up, true)
  document.addEventListener('pointercancel', up, true)
  try {
    handle.setPointerCapture(e.pointerId)
  } catch {
    // 忽略：无捕获也行，document 监听已跟踪。
  }
}

function renderSessions(): void {
  const snap = sessionsSnapshot
  // 坐标定位的右键菜单锚在会话行上，列表重建会销毁锚 → 关闭；其余锚（如
  // header 排序/添加按钮）已持久，保持原样（header 不重建）。
  if (popover) {
    if (popoverAnchor === null) {
      // 坐标定位：不关闭、不 reposition。
    } else if (popoverAnchor.isConnected) positionPopover()
    else closePopover()
  }
  // header 只建一次（含搜索框），之后只更新折叠全部按钮；列表每次重建。
  if (!sessionsHeaderEl) {
    sessionsHeaderEl = buildSessionsHeader()
    sessionsPanel.appendChild(sessionsHeaderEl)
  }
  updateCollapseAllIcon()
  // 分组栏同样只建一次（选择器/「+」按钮不随快照重建；label 文本单独更新）。
  if (!groupBarEl) {
    groupBarEl = buildGroupBar()
    sessionsPanel.appendChild(groupBarEl)
  }
  updateGroupBar()
  // 会话行菜单（右键/⋯）打开期间的冻结：跳过列表重建，保留现有 DOM（行/菜单
  // 锚不销毁），新快照仍存进 sessionsSnapshot 等解冻后渲染。header 逻辑照旧
  // （header 本就不重建）。上面的 popover 锚处理段此时走 positionPopover（旧行
  // 还在、锚 isConnected 为 true），不会误关菜单。
  if (menuFreezeActive) return
  // 行内改名编辑态冻结（与菜单冻结同款）：列表重建会销毁 rename 输入框、中止
  // IME 组合——进入编辑态那帧旧列表还没有输入框，照常重建渲染；编辑期间快照
  // 到达一律跳过，退出编辑（commit/cancel）时用最新快照一次性重建。IME 组合
  // 中的其他输入点（搜索框常驻不重建，无碍）同样借 composingActive 冻结整列表，
  // compositionend 补帧落地。
  if (editingSessionId !== null) {
    const renameLive = sessionsPanel.querySelector('.session-main .rename-input') !== null
    if (renameLive) return
  }
  if (composingActive()) return
  // 列表重建期间，销毁在编输入框触发的 blur 不应把编辑当取消（rebuildGuard）。
  rebuildInProgress = true
  const oldBar = sessionsPanel.querySelector<HTMLElement>('.selection-bar')
  oldBar?.remove()
  const oldRecycleEntry = sessionsPanel.querySelector<HTMLElement>('.recycle-entry')
  oldRecycleEntry?.remove()
  // 主列表恒渲染；回收站改为从底部滑出的抽屉叠加在其上（不再整栏切换）。
  // 列表容器只建一次、永不销毁（滚动位置随容器存活）；内容按 key 对账。
  if (sessionsListEl === null) sessionsListEl = el('div', 'sessions-list')
  const list = sessionsListEl
  const items: ReconcileItem[] = []
  if (!snap) {
    items.push(topItem('empty:loading', 'loading', () => el('div', 'sessions-empty', t('Loading…'))))
  } else if (snap.serverState !== 'running') {
    items.push(topItem('empty:server', serverEmptySig(snap), () => renderServerEmpty(snap)))
  } else if (!snap.baselineReady) {
    // 服务已 running 但基线还没拉到（或代际切换后未重拉成功）：空基线会被
    // 恒渲染的「未分组」组误导成「没有 workspace」，未分组组头先于工作区组
    // 出现。等基线就绪再渲染列表，这里保持 Loading。
    items.push(topItem('empty:loading', 'loading-baseline', () => el('div', 'sessions-empty', t('Loading…'))))
  } else if (snap.activeGroupId !== null && snap.workspaces.length === 0 && snap.query === null) {
    // 选中分组下没有任何 workspace：专属空态（不是「没有 workspace」的添加入口，
    // 也不是搜索无命中——用户需要知道要先在管理视图里打标）。
    items.push(topItem('empty:group', snap.activeGroupId, () => {
      const box = el('div', 'sessions-empty')
      box.appendChild(
        el('div', 'empty-hint', t('This group has no workspaces yet. Tag workspaces in "Manage groups…" first.')),
      )
      box.appendChild(el('div', 'empty-hint-secondary', t('You can also create a new group from the row above.')))
      const manageBtn = buttonEl('secondary', t('Manage groups…'))
      manageBtn.addEventListener('click', () => openGroupManage())
      box.appendChild(manageBtn)
      return box
    }))
  } else if (snap.workspaces.every((w) => w.workspaceId === UNGROUPED_WORKSPACE_ID)) {
    // 没有真实 workspace：保留「添加工作区」引导，同时仍渲染「未分组」组
    // （空组头 + 新建按钮，「新建未分组对话」入口恒可达）。搜索态下未分组
    // 有命中时不显示提示（下方组即结果），无命中才显示「没有匹配」。
    if (snap.query === null) {
      items.push(topItem('empty:noworkspace', 'noworkspace', () => {
        const box = el('div', 'sessions-empty')
        box.appendChild(el('div', 'empty-hint', t('No workspaces yet. Add an existing folder or create one with the + button above.')))
        return box
      }))
    } else if (snap.workspaces.length === 0) {
      items.push(topItem('empty:nomatch', snap.query, () => {
        const box = el('div', 'sessions-empty')
        box.appendChild(el('div', 'empty-hint', t('No sessions match “{0}”.', snap.query ?? '')))
        return box
      }))
    }
    for (const w of snap.workspaces) items.push(wsGroupItem(w))
  } else {
    for (const w of snap.workspaces) items.push(wsGroupItem(w))
    if (snap.contentSearchHasMore) {
      items.push(topItem('search:more', 'more', () => el('div', 'sessions-search-more', t('More matching sessions; try a more precise keyword'))))
    }
  }
  // 内容搜索降级：后端索引未启用等导致全文搜索失败——给用户可见提示，不静默。
  if (snap && snap.query != null && snap.query !== '' && snap.contentSearchError) {
    items.push(topItem('search:degraded', String(snap.contentSearchError), () => {
      const degraded = el(
        'div',
        'sessions-search-more sessions-search-degraded',
        t('Full-text search unavailable; matching titles only (dsh search index not enabled)'),
      )
      // 悬停显示更详细的原因与启用索引的方法（复用自实现 tooltip）。
      // i18n 注：key 里 YAML 示例用双引号——单引号会让门禁的 t() 正则提前截断。
      degraded.setAttribute(
        'data-tip',
        t('dsh full-text search is opt-in by default: the session-query index has openAt: "never" (disabled), so session.search is unavailable.\nTo enable: edit ~/.dsh/profiles/web/cordis.patch.yml, append the following config, then restart the dsh service:\n- id: session-query-sqlite\n  config:\n    path: !!js dshHomePath("session-query.sqlite")\n    openAt: first-search'),
      )
      return degraded
    }))
  }
  reconcileChildren(list, items)
  // 组内容递归对账（仅在有有效组数据时；空态/加载态没有 ws 壳需要处理）。
  if (snap && snap.serverState === 'running' && snap.baselineReady) {
    for (const w of snap.workspaces) {
      const shell = list.querySelector<HTMLElement>(`:scope > .workspace-group[data-workspace-id="${CSS.escape(w.workspaceId)}"]`)
      if (shell) reconcileWorkspaceGroup(shell, w)
    }
  }
  pruneSessionSigs(snap)
  // 保活的容器绝不能重复 appendChild：对已挂载元素 append 是 remove+insert
  // 操作，重挂会把 scrollTop 重置为 0（无 scroll 事件、无 JS 写——探针实锤）。
  if (!list.isConnected) sessionsPanel.appendChild(list)
  // 多选模式：操作条插在搜索框（header）与列表之间。
  if (selectionMode) sessionsPanel.insertBefore(buildSelectionBar(), list)
  // 回收站入口：面板底部固定行（列表滚动区之外，不随滚动消失）；计数 0 灰态。
  sessionsPanel.appendChild(renderRecycleEntry())
  // 搜索词变化时滚动复位到顶（新结果集从头看；对账保持滚动不背这口锅）。
  const queryNow = snap?.query ?? null
  if (queryNow !== lastSessionsQuery) {
    lastSessionsQuery = queryNow
    list.scrollTop = 0
  }
  // 抽屉已打开：头部计数/列表/空态随快照刷新（行菜单冻结时上面已提前返回，
  // 抽屉内容与主列表同步冻结，菜单锚不销毁）。列表容器同样保活对账。
  if (recycleDrawer) {
    const oldHeader = recycleDrawer.querySelector<HTMLElement>('.recycle-header')
    oldHeader?.remove()
    let rlist = recycleDrawer.querySelector<HTMLElement>('.recycle-list')
    if (rlist === null) {
      rlist = el('div', 'recycle-list')
      recycleDrawer.appendChild(renderRecycleHeader())
      recycleDrawer.appendChild(rlist)
    } else {
      recycleDrawer.insertBefore(renderRecycleHeader(), rlist)
    }
    reconcileRecycleList(rlist)
  }
  rebuildInProgress = false
  // 行内改名跨重建保留：重建后恢复编辑输入框的焦点与选区。
  if (editingSessionId) {
    const input = sessionsPanel.querySelector<HTMLInputElement>('.session-main .rename-input')
    if (input) {
      input.focus()
      input.setSelectionRange(editSelStart, editSelEnd)
    }
  }
}

/* ===== 保活对账辅助（对标 chat webview reconcileFlow 模式） ===== */

/** 顶层空态/提示项（key 稳定，按签名决定是否原位重建）。 */
function topItem(key: string, sig: string, create: () => HTMLElement): ReconcileItem {
  const same = topItemSigs.get(key) === sig
  topItemSigs.set(key, sig)
  return { key, same, create }
}

/** 服务空态签名：影响 renderServerEmpty 输出的快照字段。 */
function serverEmptySig(snap: SessionsSnapshot): string {
  return JSON.stringify([snap.serverState, snap.dshNotFound, snap.hostOs])
}

/** 会话行签名：覆盖行渲染的全部输入（含选中态/编辑态/搜索高亮词/置顶/当前行）。 */
function sessionRowSig(s: SessionNodeModel): string {
  return JSON.stringify([
    s,
    currentSessionId === s.sessionId,
    sessionsSnapshot?.pinned.includes(s.sessionId) ?? false,
    selectionMode,
    selectionMode && selectedSessionIds.has(s.sessionId),
    editingSessionId === s.sessionId,
    sessionsSnapshot?.query ?? null,
  ])
}

/** 回收站行签名（无多选/改名态）。 */
function recycleRowSig(s: SessionNodeModel): string {
  return JSON.stringify([s, currentSessionId === s.sessionId])
}

function sessionRowItem(s: SessionNodeModel, tagged: boolean): ReconcileItem {
  const sig = sessionRowSig(s)
  const same = sessionRowSigs.get(s.sessionId) === sig
  sessionRowSigs.set(s.sessionId, sig)
  return {
    key: `s:${s.sessionId}`,
    same,
    create: () => {
      const row = renderSessionRow(s)
      if (tagged) row.classList.add('tagged')
      return row
    },
  }
}

function recycleRowItem(s: SessionNodeModel, tagged: boolean): ReconcileItem {
  const sig = recycleRowSig(s)
  const same = recycleRowSigs.get(s.sessionId) === sig
  recycleRowSigs.set(s.sessionId, sig)
  return {
    key: `s:${s.sessionId}`,
    same,
    create: () => {
      const row = renderRecycleSessionRow(s)
      if (tagged) row.classList.add('tagged')
      return row
    },
  }
}

/** 内容命中片段行（主列表/回收站共用渲染）。 */
function snippetItem(s: SessionNodeModel): ReconcileItem {
  const sig = JSON.stringify([s.sessionId, s.contentSnippet ?? '', sessionsSnapshot?.query ?? null])
  const same = snippetSigs.get(s.sessionId) === sig
  snippetSigs.set(s.sessionId, sig)
  return {
    key: `snip:${s.sessionId}`,
    same,
    create: () => renderContentSnippet(s.sessionId, s.contentSnippet ?? ''),
  }
}

/** 状态计数桶（待交互 > 运行中 > 未读，与组头角标/行首状态槽同优先级）。 */
function statusBuckets(sessions: SessionNodeModel[]): [number, number, number] {
  let pending = 0
  let running = 0
  let unread = 0
  for (const s of sessions) {
    if (s.pendingInteraction !== undefined) pending += 1
    else if (s.running || s.descendantRunning) running += 1
    else if (s.unread) unread += 1
  }
  return [pending, running, unread]
}

/** tag 组头签名：pill（名称/颜色）、toggle 提示、折叠态计数、组菜单可用域。 */
function tagHeadSig(tag: SnapshotTag, collapsed: boolean, rows: SessionNodeModel[]): string {
  return JSON.stringify([
    tag.id,
    tag.name,
    tag.color,
    collapsed,
    collapsed ? statusBuckets(rows) : null,
    selectionMode,
    recycleView,
  ])
}

/** tag 组壳（只建一次；className 随折叠态/颜色在校对时校正，不重建壳）。 */
function createTagShell(tag: SnapshotTag): HTMLElement {
  const block = el('div', 'tag-group')
  block.dataset.tagId = tag.id
  attachTagBlockDrop(block, tag.id)
  return block
}

/** tag 组递归对账：头按签名原位重建，行按会话 key 保活。 */
function reconcileTagGroup(
  shell: HTMLElement,
  tag: SnapshotTag,
  rows: SessionNodeModel[],
  collapsed: boolean,
  rowItemOf: (s: SessionNodeModel, tagged: boolean) => ReconcileItem,
): void {
  shell.className = `tag-group tag-${tag.color}${collapsed ? ' collapsed' : ''}`
  const sig = tagHeadSig(tag, collapsed, rows)
  const same = tagHeadSigs.get(tag.id) === sig
  tagHeadSigs.set(tag.id, sig)
  const items: ReconcileItem[] = [
    {
      key: 'tag-head',
      same,
      create: () => tagHeadEl(tag, collapsed, collapsed ? rows : []),
    },
  ]
  if (!collapsed) {
    items.push({ key: 'tag-line', same: true, create: () => el('div', 'tag-line') })
    for (const cur of rows) {
      items.push(rowItemOf(cur, true))
      if (cur.contentSnippet) items.push(snippetItem(cur))
    }
  }
  reconcileChildren(shell, items)
}

/**
 * 会话序列 → 对账项序列（沿用原 appendTagBlocks 的聚合语义）：
 * 置顶/无组会话平铺（key=`s:*`），同 tagId 的连续段聚成 tag 组壳
 * （key=`tag:*`，壳保活、内部递归对账）。主列表与回收站共用（行工厂不同）。
 */
function tagBlockItems(
  container: HTMLElement,
  sessions: SessionNodeModel[],
  rowItemOf: (s: SessionNodeModel, tagged: boolean) => ReconcileItem,
): ReconcileItem[] {
  const items: ReconcileItem[] = []
  const collapsedSet = new Set(sessionsSnapshot?.tagCollapsed ?? [])
  // 搜索态强制展开（与 workspace 组折叠同规则）：搜索结果被折叠块藏起来不可接受。
  const inSearch = sessionsSnapshot?.query != null && sessionsSnapshot.query !== ''
  let i = 0
  while (i < sessions.length) {
    const s = sessions[i]
    const tag = s.tagId !== undefined ? tagById(s.tagId) : undefined
    // 置顶/活跃（运行中/后代运行/未读/待交互）会话平铺，不进组块——否则
    // 活跃会话会被折叠组藏住、折叠计数也不对（sessions-active-over-tags 语义）。
    if (s.pinned || s.active || tag === undefined) {
      items.push(rowItemOf(s, false))
      if (s.contentSnippet) items.push(snippetItem(s))
      i += 1
      continue
    }
    // 组块 = 同 tagId 的连续空闲段落（纯层已聚合排序），一次收齐再按折叠态渲染。
    const rows: SessionNodeModel[] = []
    while (i < sessions.length) {
      const cur = sessions[i]
      if (cur.pinned || cur.active || cur.tagId !== tag.id) break
      rows.push(cur)
      i += 1
    }
    const collapsed = !inSearch && collapsedSet.has(tag.id)
    const tagRef = tag
    items.push({
      key: `tag:${tag.id}`,
      same: true, // 壳恒保活（内部递归对账）；create 只在首建时调用
      create: () => createTagShell(tagRef),
    })
    // 壳在本帧 reconcileChildren 落位后立即递归校正（同一帧内，无中间态绘制）。
    const existing = container.querySelector<HTMLElement>(`:scope > .tag-group[data-tag-id="${CSS.escape(tag.id)}"]`)
    if (existing) reconcileTagGroup(existing, tag, rows, collapsed, rowItemOf)
    else pendingTagReconciles.push({ tag, rows, collapsed, rowItemOf })
  }
  return items
}

/** tagBlockItems 里对「本帧新建壳」的延迟递归（壳要先由 reconcileChildren 挂载）。 */
const pendingTagReconciles: Array<{
  tag: SnapshotTag
  rows: SessionNodeModel[]
  collapsed: boolean
  rowItemOf: (s: SessionNodeModel, tagged: boolean) => ReconcileItem
}> = []

function flushTagReconciles(container: HTMLElement): void {
  for (const p of pendingTagReconciles.splice(0)) {
    const shell = container.querySelector<HTMLElement>(`:scope > .tag-group[data-tag-id="${CSS.escape(p.tag.id)}"]`)
    if (shell) reconcileTagGroup(shell, p.tag, p.rows, p.collapsed, p.rowItemOf)
  }
}

/** workspace 折叠态（与原 renderWorkspaceGroup 同规则：搜索/空组强制展开）。 */
function wsCollapsed(w: WorkspaceNodeModel): boolean {
  const inSearch = sessionsSnapshot?.query != null && sessionsSnapshot.query !== ''
  if (inSearch) return false
  if (w.sessions.length === 0) return true
  return sessionsSnapshot?.collapsed.includes(w.workspaceId) ?? false
}

/** workspace 组头签名：折叠态/计数/当前行/多选态/搜索高亮词等头渲染输入。 */
function wsHeadSig(w: WorkspaceNodeModel, collapsed: boolean): string {
  return JSON.stringify([
    w.workspaceId,
    w.label,
    w.path,
    w.isCurrent,
    collapsed,
    w.sessions.length === 0,
    statusBuckets(w.sessions),
    w.sessions.some((s) => s.sessionId === currentSessionId),
    selectionMode,
    selectionMode ? groupSelectionState(w) : null,
    sessionsSnapshot?.query ?? null,
  ])
}

/** workspace 组壳（只建一次；挂组级拖出事件，不随内容重建）。 */
function createWorkspaceShell(w: WorkspaceNodeModel): HTMLElement {
  const group = el('div', 'workspace-group')
  group.dataset.workspaceId = w.workspaceId
  // 拖出组：会话行拖到组块外的区域（组头/未分组行/组尾留白）= 移出分组。
  // 块容器的 dragover/drop 已 stopPropagation，这里只收组块外的事件。
  group.addEventListener('dragover', (e) => {
    if (dragCarriesSession(e)) e.preventDefault()
  })
  group.addEventListener('drop', (e) => {
    if (!dragCarriesSession(e)) return
    e.preventDefault()
    const sessionId = e.dataTransfer?.getData('text/dsh-session')
    if (sessionId) post({ type: 'sessionTagSet', sessionId, tagId: null })
  })
  return group
}

/** 顶层组项：壳恒保活（same:true），子级由 reconcileWorkspaceGroup 递归对账。 */
function wsGroupItem(w: WorkspaceNodeModel): ReconcileItem {
  return { key: `ws:${w.workspaceId}`, same: true, create: () => createWorkspaceShell(w) }
}

/** workspace 组递归对账：组头按签名原位重建，子级（tag 块/平铺行）按 key 保活。 */
function reconcileWorkspaceGroup(shell: HTMLElement, w: WorkspaceNodeModel): void {
  const collapsed = wsCollapsed(w)
  const sig = wsHeadSig(w, collapsed)
  const same = wsHeadSigs.get(w.workspaceId) === sig
  wsHeadSigs.set(w.workspaceId, sig)
  const items: ReconcileItem[] = [
    {
      key: 'ws-head',
      same,
      create: () => renderWorkspaceHead(w, collapsed),
    },
  ]
  if (!collapsed) items.push(...tagBlockItems(shell, w.sessions, sessionRowItem))
  reconcileChildren(shell, items)
  flushTagReconciles(shell)
}

/** 回收站顶层组项与递归对账（组头渲染与主列表不同，其余同款）。 */
function recycleWsGroupItem(w: WorkspaceNodeModel): ReconcileItem {
  return {
    key: `ws:${w.workspaceId}`,
    same: true,
    create: () => {
      const group = el('div', 'workspace-group')
      group.dataset.workspaceId = w.workspaceId
      return group
    },
  }
}

function recycleHeadSig(w: WorkspaceNodeModel, collapsed: boolean): string {
  return JSON.stringify([
    w.workspaceId,
    w.label,
    collapsed,
    w.sessions.length,
    w.sessions.some((s) => s.sessionId === currentSessionId),
  ])
}

function reconcileRecycleGroup(shell: HTMLElement, w: WorkspaceNodeModel): void {
  const collapsed = sessionsSnapshot?.recycleCollapsed.includes(w.workspaceId) ?? false
  const sig = recycleHeadSig(w, collapsed)
  const same = recycleHeadSigs.get(w.workspaceId) === sig
  recycleHeadSigs.set(w.workspaceId, sig)
  const items: ReconcileItem[] = [
    {
      key: 'ws-head',
      same,
      create: () => renderRecycleHead(w, collapsed),
    },
  ]
  if (!collapsed) items.push(...tagBlockItems(shell, w.sessions, recycleRowItem))
  reconcileChildren(shell, items)
  flushTagReconciles(shell)
}

/** 回收站顶层空态/提示项（与主列表分开的缓存，互不干扰保活判定）。 */
const recycleTopSigs = new Map<string, string>()

function recycleTopItem(key: string, sig: string, create: () => HTMLElement): ReconcileItem {
  const same = recycleTopSigs.get(key) === sig
  recycleTopSigs.set(key, sig)
  return { key, same, create }
}

/** 回收站列表对账（空态/组序列），容器由抽屉保活。 */
function reconcileRecycleList(list: HTMLElement): void {
  const snap = sessionsSnapshot
  const items: ReconcileItem[] = []
  if (!snap) {
    items.push(recycleTopItem('empty:loading', 'loading', () => el('div', 'sessions-empty', t('Loading…'))))
  } else if (snap.serverState !== 'running') {
    items.push(recycleTopItem('empty:server', serverEmptySig(snap), () => renderServerEmpty(snap)))
  } else if (!snap.baselineReady) {
    items.push(recycleTopItem('empty:loading', 'loading-baseline', () => el('div', 'sessions-empty', t('Loading…'))))
  } else if (snap.recycleWorkspaces.length === 0) {
    items.push(recycleTopItem('empty:recycle', 'recycle-empty', () => {
      const box = el('div', 'sessions-empty')
      box.appendChild(el('div', 'empty-hint', t('The recycle bin is empty')))
      box.appendChild(
        el('div', 'empty-hint-secondary', t('Move sessions here from the row menu or multi-select to keep them out of the list; they can be restored later, only archiving is final.')),
      )
      return box
    }))
  } else {
    for (const w of snap.recycleWorkspaces) items.push(recycleWsGroupItem(w))
  }
  reconcileChildren(list, items)
  if (snap && snap.serverState === 'running' && snap.baselineReady) {
    const seenRows = new Set<string>()
    for (const w of snap.recycleWorkspaces) {
      const shell = list.querySelector<HTMLElement>(`:scope > .workspace-group[data-workspace-id="${CSS.escape(w.workspaceId)}"]`)
      if (shell) reconcileRecycleGroup(shell, w)
      for (const s of w.sessions) seenRows.add(s.sessionId)
    }
    // 回收站签名随帧收敛（抽屉关闭期间保留，重开时按签名恢复保活判断）。
    const seenWs = new Set(snap.recycleWorkspaces.map((w) => w.workspaceId))
    for (const id of [...recycleHeadSigs.keys()]) if (!seenWs.has(id)) recycleHeadSigs.delete(id)
    for (const id of [...recycleRowSigs.keys()]) if (!seenRows.has(id)) recycleRowSigs.delete(id)
  }
}

/** 签名缓存收敛：删掉本帧不再出现的行/组，防 Map 跨会话累积。 */
function pruneSessionSigs(snap: SessionsSnapshot | null): void {
  const seenRows = new Set<string>()
  const seenWs = new Set<string>()
  const seenTags = new Set<string>()
  const seenSnippets = new Set<string>()
  const seenTop = new Set<string>()
  if (snap && snap.serverState === 'running' && snap.baselineReady) {
    const collect = (sessions: SessionNodeModel[]): void => {
      for (const s of sessions) {
        seenRows.add(s.sessionId)
        if (s.tagId !== undefined) seenTags.add(s.tagId)
        if (s.contentSnippet) seenSnippets.add(s.sessionId)
      }
    }
    for (const w of snap.workspaces) {
      seenWs.add(w.workspaceId)
      collect(w.sessions)
    }
    // 抽屉开着时回收站的 tag 头也吃同一份 tagHeadSigs 缓存：纳入 seen，
    // 防主列表渲染把回收站的 tag 头签名顶掉（来回重建）。
    if (recycleDrawer) {
      for (const w of snap.recycleWorkspaces) {
        for (const s of w.sessions) if (s.tagId !== undefined) seenTags.add(s.tagId)
      }
    }
  }
  // 顶层空态/提示项的 key 由本帧 items 决定——不在帧内出现的视为过期。
  const liveTopKeys = new Set(['empty:loading', 'empty:server', 'empty:group', 'empty:noworkspace', 'empty:nomatch', 'search:more', 'search:degraded', 'empty:loading-baseline'])
  for (const k of liveTopKeys) {
    if (sessionsListEl?.querySelector(`[data-flow-key="${k}"]`)) seenTop.add(k)
  }
  for (const id of [...sessionRowSigs.keys()]) if (!seenRows.has(id)) sessionRowSigs.delete(id)
  for (const id of [...snippetSigs.keys()]) if (!seenSnippets.has(id)) snippetSigs.delete(id)
  for (const id of [...wsHeadSigs.keys()]) if (!seenWs.has(id)) wsHeadSigs.delete(id)
  for (const id of [...tagHeadSigs.keys()]) if (!seenTags.has(id)) tagHeadSigs.delete(id)
  for (const k of [...topItemSigs.keys()]) if (!seenTop.has(k)) topItemSigs.delete(k)
}

/** 服务未运行时的面板空态：安装引导（dshNotFound）或启动按钮。 */
function renderServerEmpty(snap: SessionsSnapshot): HTMLElement {
  const box = el('div', 'sessions-empty')
  if (snap.dshNotFound) {
    box.appendChild(el('div', 'empty-title', t('dsh not found')))
    box.appendChild(el('div', 'empty-hint', t('Install it and come back here to start automatically.')))
    const btn = buttonEl(undefined, t('View install guide'))
    btn.addEventListener('click', () => post({ type: 'openInstallPage' }))
    box.appendChild(btn)
    box.appendChild(renderInstallScriptBlock(snap.hostOs))
    return box
  }
  if (snap.serverState === 'starting') {
    box.appendChild(el('div', 'empty-hint', t('Starting the dsh service…')))
    // 首次启动（刚装完 dsh）要初始化 profile/依赖，时间长——显式告诉用户是在
    // 准备而非卡死；进程实际在跑（状态栏 starting + 日志可查）。
    box.appendChild(
      el('div', 'empty-hint empty-hint-secondary', t('The first start may take a while (preparing profiles and dependencies).')),
    )
    return box
  }
  box.appendChild(el('div', 'empty-hint', t('The dsh service is not running; no sessions yet.')))
  const btn = buttonEl(undefined, t('Start the dsh service'))
  btn.addEventListener('click', () => post({ type: 'serverStart' }))
  box.appendChild(btn)
  return box
}

/* ---- 非官方一键安装脚本块（dshNotFound 空态，kimi 同款体验） ---- */

/** 用户手动选中的平台（跨面板重建保留；未选过 = 跟随宿主平台）。 */
let selectedInstallOs: HostOs | null = null

/**
 * kimi 式安装引导：平台下拉按钮 + 单行省略的命令条（无横向滚动）+ 复制按钮；
 * 平台按钮与命令条同排 flex-wrap——容器够宽左右排（kimi 一行），侧栏窄时
 * 命令条自动换到下一行上下排。默认选中宿主平台（hostOs 由 host 端
 * process.platform 映射），未知平台回退第一项；平台切换经全局 popover 弹层。
 */
function renderInstallScriptBlock(hostOs: HostOs | undefined): HTMLElement {
  const block = el('div', 'install-script')
  block.appendChild(
    el('div', 'install-script-hint', t('Or use the community one-liner script below (unofficial):')),
  )
  let active = selectedInstallOs ?? hostOs ?? INSTALL_SCRIPT_OS_ORDER[0]
  if (!INSTALL_SCRIPT_OS_ORDER.includes(active)) active = INSTALL_SCRIPT_OS_ORDER[0]

  const row = el('div', 'install-script-row')
  const platform = buttonEl('install-script-platform', '')
  const label = el('span', 'install-script-platform-label', INSTALL_SCRIPT_OS_LABEL[active])
  platform.appendChild(label)
  platform.appendChild(iconSvg(PANEL_ICONS.chevronDown, 12))
  const code = el('code', 'install-script-code')
  const apply = (os: HostOs): void => {
    selectedInstallOs = os
    active = os
    label.textContent = INSTALL_SCRIPT_OS_LABEL[os]
    const text = installCommandFor(os)
    code.textContent = text
    code.title = text
  }
  apply(active)
  platform.addEventListener('click', () => {
    const menu = el('div', 'install-script-menu')
    for (const os of INSTALL_SCRIPT_OS_ORDER) {
      const item = el('div', 'install-script-menu-item' + (os === active ? ' active' : ''), INSTALL_SCRIPT_OS_LABEL[os])
      item.addEventListener('click', () => {
        apply(os)
        closePopover()
      })
      menu.appendChild(item)
    }
    showPopover(platform, menu, 'below')
  })

  const copy = buttonEl('install-script-copy', '')
  copy.title = t('Copy')
  copy.appendChild(iconSvg(COPY_ICON, 14))
  copy.addEventListener('click', () => {
    void navigator.clipboard.writeText(code.textContent ?? '').then(
      () => flashCopyLabel(copy, t('Copied')),
      () => flashCopyLabel(copy, t('Copy failed')),
    )
  })
  const cmd = el('div', 'install-script-cmd')
  cmd.appendChild(code)
  cmd.appendChild(copy)
  row.appendChild(platform)
  row.appendChild(cmd)
  block.appendChild(row)
  return block
}

/** 复制反馈：按钮文字短暂替换为已复制状态，2s 后恢复（含 label 重置）。 */
function flashCopyLabel(button: HTMLButtonElement, label: string): void {
  const original = button.title
  button.title = label
  button.textContent = ''
  button.appendChild(el('span', undefined, label))
  setTimeout(() => {
    button.title = original
    button.textContent = ''
    button.appendChild(iconSvg(COPY_ICON, 14))
  }, 2000)
}

/** 平台名：不随 locale 翻译（对齐 kimi 的 Win/macOS/Linux）。 */
const INSTALL_SCRIPT_OS_LABEL: Record<HostOs, string> = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
}

/** 组名右侧角标：待交互（黄点）、运行中（像素环）、未读/已完成（绿点）三个独立计数。 */
function appendWorkspaceCounts(head: HTMLElement, sessions: SessionNodeModel[]): void {
  // 每会话只入一个桶，优先级与会话行首状态槽一致：待交互 > 运行中 > 未读。
  let pending = 0
  let running = 0
  let unread = 0
  for (const s of sessions) {
    if (s.pendingInteraction !== undefined) pending += 1
    else if (s.running || s.descendantRunning) running += 1
    else if (s.unread) unread += 1
  }
  if (pending === 0 && running === 0 && unread === 0) return
  const counts = el('span', 'ws-counts')
  if (pending > 0) appendCountBadge(counts, el('span', 'session-dot warning'), pending, t('Pending interaction'))
  if (running > 0) appendCountBadge(counts, spinSvg(), running, t('Running'))
  if (unread > 0) appendCountBadge(counts, el('span', 'session-dot completed'), unread, t('Unread'))
  head.appendChild(counts)
}

function appendCountBadge(container: HTMLElement, badge: HTMLElement | SVGSVGElement, count: number, label: string): void {
  const item = el('span', 'ws-count')
  item.setAttribute('data-tip', label)
  item.appendChild(badge)
  item.appendChild(el('span', undefined, String(count)))
  container.appendChild(item)
}

/* ===== 会话标签组（Chrome 垂直标签式单组）渲染与拖拽 ===== */

/** 标签色 → CSS 颜色值（与 sessionsView.ts 的 .tag-* 组色变量同映射）。 */
const TAG_COLOR_CSS: Record<TagColor, string> = {
  yellow: 'var(--vscode-charts-yellow, #e5c07b)',
  blue: 'var(--vscode-charts-blue, #5686fe)',
  green: 'var(--vscode-charts-green, #89d185)',
  orange: 'var(--vscode-charts-orange, #d18616)',
  purple: 'var(--vscode-charts-purple, #b180d7)',
  red: 'var(--vscode-charts-red, #f14c4c)',
}

/** 颜色显示名（l10n key）。 */
const TAG_COLOR_L10N: Record<TagColor, string> = {
  yellow: 'Yellow',
  blue: 'Blue',
  green: 'Green',
  orange: 'Orange',
  purple: 'Purple',
  red: 'Red',
}

type SnapshotTag = SessionsSnapshot['tags'][number]

/** 菜单里的组色小方块（移到分组/组操作菜单共用的图标位）。 */
function tagSwatchIcon(color: TagColor): HTMLElement {
  const s = el('span', 'tag-swatch')
  s.style.background = TAG_COLOR_CSS[color]
  return s
}

/** 「无分组」的空描边方块（行内移到分组菜单的移出项）。 */
function tagEmptySwatchIcon(): HTMLElement {
  const s = el('span', 'tag-swatch')
  s.style.border = '1px solid var(--vscode-descriptionForeground, #888)'
  return s
}

function tagsSnapshot(): SnapshotTag[] {
  return sessionsSnapshot?.tags ?? []
}

function tagById(tagId: string): SnapshotTag | undefined {
  return tagsSnapshot().find((t) => t.id === tagId)
}

/**
 * 当前可见列表（快照 workspaces，经当前 workspace 分组过滤）里该组的会话，
 * 按 workspace 分桶（组块可能跨 workspace 出现；整组操作只作用于可见集合）。
 */
function sessionsOfTagInView(tagId: string): Array<{ ws: WorkspaceNodeModel; sessions: SessionNodeModel[] }> {
  const out: Array<{ ws: WorkspaceNodeModel; sessions: SessionNodeModel[] }> = []
  for (const w of sessionsSnapshot?.workspaces ?? []) {
    const sessions = w.sessions.filter((s) => s.tagId === tagId)
    if (sessions.length > 0) out.push({ ws: w, sessions })
  }
  return out
}

/** 拖拽载荷判定：会话行拖拽 / 组 pill 拖拽（自定义 MIME，见下方 dragstart）。 */
function dragCarriesSession(e: DragEvent): boolean {
  return e.dataTransfer?.types.includes('text/dsh-session') === true
}
function dragCarriesTag(e: DragEvent): boolean {
  return e.dataTransfer?.types.includes('text/dsh-tag') === true
}

/**
 * workspace 会话区的组块渲染语义（置顶会话平铺绝对优先；活跃会话平铺——
 * 运行中/后代运行/未读/待交互，脱离组块不被折叠藏住；其余空闲会话按标签组
 * 切块，未分组平铺殿后）已由 tagBlockItems + reconcileTagGroup 承载（保活
 * 对账版，见上方「保活对账辅助」区块）。
 */

/**
 * 折叠组头角标：组内会话的待交互/运行中/未读计数（互斥优先级与 workspace
 * 组头一致：待交互 > 运行中 > 未读；每会话只入一个桶）。
 */
function appendTagCounts(head: HTMLElement, sessions: SessionNodeModel[]): void {
  let pending = 0
  let running = 0
  let unread = 0
  for (const s of sessions) {
    if (s.pendingInteraction !== undefined) pending += 1
    else if (s.running || s.descendantRunning) running += 1
    else if (s.unread) unread += 1
  }
  if (pending === 0 && running === 0 && unread === 0) return
  const counts = el('span', 'ws-counts tag-counts')
  if (pending > 0) appendCountBadge(counts, el('span', 'session-dot warning'), pending, t('Pending interaction'))
  if (running > 0) appendCountBadge(counts, spinSvg(), running, t('Running'))
  if (unread > 0) appendCountBadge(counts, el('span', 'session-dot completed'), unread, t('Unread'))
  head.appendChild(counts)
}

/** 组头：小 pill（组名 + 组色点，可拖排组序、右键整组菜单）+ 折叠/展开箭头；
 *  countSessions 非空时（折叠态）在箭头后显示组内待处理计数。块体收会话拖拽入组。 */
function tagHeadEl(
  tag: SnapshotTag,
  collapsed: boolean,
  countSessions: SessionNodeModel[] = [],
): HTMLElement {
  const head = el('div', 'tag-head')
  const pill = el('span', 'tag-pill')
  pill.setAttribute('data-tip', t('Group: {0}', tag.name))
  pill.appendChild(el('span', 'tag-pill-dot'))
  pill.appendChild(el('span', undefined, tag.name))
  head.appendChild(pill)
  // 折叠/展开箭头（用户要求的「标签页后面」交互）：小三角，点击切换。
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'tag-toggle'
  toggle.setAttribute('data-tip', collapsed ? t('Expand group') : t('Collapse group'))
  toggle.setAttribute('aria-label', toggle.getAttribute('data-tip')!)
  toggle.appendChild(iconSvg(PANEL_ICONS.triangle, 10))
  toggle.addEventListener('click', (e) => {
    e.stopPropagation()
    post({ type: 'sessionTagCollapse', tagId: tag.id, collapsed: !collapsed })
  })
  head.appendChild(toggle)
  // 折叠态计数（展开态不渲染）：靠右对齐，与 workspace 组头角标同款小号样式。
  if (countSessions.length > 0) appendTagCounts(head, countSessions)
  attachTagPillDrag(pill, tag.id)
  pill.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    // 多选模式点行 = 勾选；回收站视图的会话不在主列表（整组操作按主列表
    // 可见集合收集），两者都不提供组操作菜单。
    if (selectionMode || recycleView) return
    menuFreezeActive = true
    showPopoverAt(e.clientX, e.clientY, buildTagMenuBody(tag))
    markMenuRow(pill)
  })
  return head
}

/** 会话行拖入该组（块容器为 drop 目标；dragenter/dragover/drop 全程不冒泡，
 *  避免未分组 drop 区误收——见 renderWorkspaceGroup 的 group 级 drop）。 */
function attachTagBlockDrop(block: HTMLElement, tagId: string): void {
  let depth = 0
  const clear = (): void => {
    depth = 0
    block.classList.remove('drag-over')
  }
  block.addEventListener('dragenter', (e) => {
    if (!dragCarriesSession(e)) return
    e.stopPropagation()
    depth += 1
    block.classList.add('drag-over')
  })
  block.addEventListener('dragleave', () => {
    if (depth > 0) depth -= 1
    if (depth === 0) block.classList.remove('drag-over')
  })
  block.addEventListener('dragover', (e) => {
    if (!dragCarriesSession(e)) return
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  })
  block.addEventListener('drop', (e) => {
    if (!dragCarriesSession(e)) return
    e.preventDefault()
    e.stopPropagation()
    clear()
    const sessionId = e.dataTransfer?.getData('text/dsh-session')
    if (!sessionId) return
    post({ type: 'sessionTagSet', sessionId, tagId })
    // 拖入折叠块：自动展开该组（让用户看到刚拖进来的会话；折叠态是偏好，
    // 显式再次折叠才算用户意图）。
    if (block.classList.contains('collapsed')) {
      post({ type: 'sessionTagCollapse', tagId, collapsed: false })
    }
  })
}

/**
 * 组 pill 拖拽（组排序）：拖到其他 pill 的上/下半 = 插入其前/后；拖拽期间
 * 冻结列表重建（同菜单冻结），drop 后按新顺序 post，dragend 统一解冻重渲染。
 * pill 自身的 dragover 对会话拖拽不接管（让块容器高亮收 drop）。
 */
function attachTagPillDrag(pill: HTMLElement, tagId: string): void {
  pill.draggable = true
  pill.addEventListener('dragstart', (e) => {
    const dt = e.dataTransfer
    if (dt) {
      dt.setData('text/dsh-tag', tagId)
      dt.effectAllowed = 'move'
    }
    menuFreezeActive = true
  })
  pill.addEventListener('dragend', () => {
    menuFreezeActive = false
    renderSessions()
  })
  pill.addEventListener('dragenter', (e) => {
    if (dragCarriesTag(e)) e.stopPropagation()
  })
  pill.addEventListener('dragover', (e) => {
    if (!dragCarriesTag(e)) return
    e.preventDefault()
    e.stopPropagation()
    const rect = pill.getBoundingClientRect()
    const before = e.clientY < rect.top + rect.height / 2
    pill.classList.toggle('drop-before', before)
    pill.classList.toggle('drop-after', !before)
  })
  pill.addEventListener('dragleave', () => {
    pill.classList.remove('drop-before', 'drop-after')
  })
  pill.addEventListener('drop', (e) => {
    if (!dragCarriesTag(e)) return
    e.preventDefault()
    e.stopPropagation()
    pill.classList.remove('drop-before', 'drop-after')
    const srcId = e.dataTransfer?.getData('text/dsh-tag')
    if (!srcId || srcId === tagId) return
    const ids = tagsSnapshot().map((t) => t.id)
    const from = ids.indexOf(srcId)
    const to = ids.indexOf(tagId)
    if (from === -1 || to === -1) return
    const rect = pill.getBoundingClientRect()
    const before = e.clientY < rect.top + rect.height / 2
    // 先摘下源组，再在目标（位置可能因摘除前移）前/后插入。
    ids.splice(from, 1)
    const insertAt = ids.indexOf(tagId) + (before ? 0 : 1)
    ids.splice(insertAt, 0, srcId)
    post({ type: 'sessionTagReorder', tagIds: ids })
  })
}

/** 整组操作菜单（组头 pill 右键）：归档全部 / 移入回收站 / 移出分组；
 *  自建组额外提供重命名与删除（预设组名字走 l10n，不提供）。 */
function buildTagMenuBody(tag: SnapshotTag): HTMLElement {
  const body = el('div')
  body.appendChild(el('div', 'session-menu-title', t('Group: {0}', tag.name)))
  const grouped = sessionsOfTagInView(tag.id)
  const all = grouped.flatMap((g) => g.sessions)
  const archivable = all.filter(sessionArchiveSelectable)
  body.appendChild(
    menuItem(t('Archive {0} sessions', all.length), {
      icon: iconSvg(PANEL_ICONS.archive),
      // 与单项/多选归档同规则（置顶/运行中/未读/待处理跳过），全不可归档时置灰。
      disabled: archivable.length === 0,
      disabledTip: t('No archivable sessions in this group'),
      onClick: () => {
        closePopover()
        openTagArchiveModal(tag, grouped, archivable)
      },
    }),
  )
  body.appendChild(
    menuItem(t('Move {0} sessions to the recycle bin', all.length), {
      icon: strokeSvg(TRASH_ICON, 16),
      // 置顶会被 host 跳过并提示（同多选批量规则）；全置顶时禁用更诚实。
      disabled: all.length > 0 && all.every((s) => s.pinned),
      disabledTip: t('Pinned sessions cannot be moved to the recycle bin; unpin them first'),
      onClick: () => {
        const anchor = menuOpenRow
        if (anchor) flashTip(t('Moved to the recycle bin'), anchor)
        closePopover()
        post({ type: 'sessionMoveToRecycleMany', sessionIds: all.map((s) => s.sessionId) })
      },
    }),
  )
  body.appendChild(
    menuItem(t('Remove from group'), {
      icon: iconSvg(PANEL_ICONS.remove, 14),
      onClick: () => {
        closePopover()
        post({ type: 'sessionTagSetMany', sessionIds: all.map((s) => s.sessionId), tagId: null })
      },
    }),
  )
  // 重命名：所有组都可改名（预设组改名后覆盖 l10n 默认名）。
  body.appendChild(
    menuItem(t('Rename group…'), {
      icon: iconSvg(PANEL_ICONS.edit, 14),
      onClick: () => {
        closePopover()
        post({ type: 'sessionTagRenamePrompt', tagId: tag.id, name: tag.name })
      },
    }),
  )
  // 颜色：二级子菜单（6 色；选中态 = 当前色）。
  body.appendChild(buildTagColorMenuItem(tag))
  if (!tag.preset) {
    body.appendChild(
      menuItem(t('Delete group'), {
        icon: strokeSvg(TRASH_ICON, 16),
        onClick: () => {
          closePopover()
          post({ type: 'sessionTagDelete', tagId: tag.id })
        },
      }),
    )
  }
  return body
}

/** 「Color…」菜单项（带 › 子菜单指示）：hover 展开二级色板（VS Code submenu
 *  惯例），点击兜底；已展开时幂等不重建。 */
function buildTagColorMenuItem(tag: SnapshotTag): HTMLElement {
  const item = el('div', 'menu-item')
  const iconWrap = el('span', 'menu-item-icon')
  iconWrap.appendChild(tagSwatchIcon(tag.color))
  item.appendChild(iconWrap)
  item.appendChild(el('span', undefined, t('Color')))
  item.appendChild(el('span', 'menu-right', '›'))
  const open = (): void => {
    if (subPopover === null) showTagColorSubmenu(tag, item)
  }
  item.addEventListener('pointerover', open)
  item.addEventListener('click', open)
  return item
}

/** 颜色二级菜单：6 色选项（色块 + 名称），当前色打 ✓；选色后关闭两层菜单。 */
function showTagColorSubmenu(tag: SnapshotTag, anchor: HTMLElement): void {
  const body = el('div')
  body.appendChild(el('div', 'menu-group', t('Color')))
  for (const c of TAG_COLORS) {
    body.appendChild(
      menuItem(t(TAG_COLOR_L10N[c]), {
        icon: tagSwatchIcon(c),
        checked: tag.color === c,
        onClick: () => {
          closePopover()
          if (tag.color !== c) post({ type: 'sessionTagSetColor', tagId: tag.id, color: c })
        },
      }),
    )
  }
  const rect = anchor.getBoundingClientRect()
  showSubPopoverAt(Math.min(rect.right + 6, window.innerWidth - 4), rect.top, anchor, body)
}

/** 新建标签组弹层（行菜单「New group…」入口）：名字输入 + 6 色色板（默认
 *  轮换色，点击可选）+ 就地校验（空名/与现有组显示名重名）；创建后快照回流
 *  触发列表更新。复用 wsg-create 弹层样式（popover 内联，点外部关闭）。 */
function openTagCreatePopup(anchor: HTMLElement | null): void {
  const snap = sessionsSnapshot
  if (!snap) return
  const body = el('div', 'wsg-create')
  body.appendChild(el('div', 'wsg-create-title', t('New group')))
  const input = document.createElement('input')
  input.className = 'wsg-create-input'
  input.placeholder = t('Group name')
  input.maxLength = 100
  // 默认色 = 与 store 一致的轮换色（自定义组数 0/1/2 → 橙/紫/红）。
  const customCount = snap.tags.filter((t) => !t.preset).length
  const palette: TagColor[] = ['orange', 'purple', 'red']
  let selected: TagColor = palette[customCount % palette.length]
  const colors = el('div', 'tag-create-colors')
  const swatches = new Map<TagColor, HTMLElement>()
  for (const c of TAG_COLORS) {
    const sw = el('span', 'tag-color-swatch')
    sw.style.background = TAG_COLOR_CSS[c]
    sw.setAttribute('data-tip', t(TAG_COLOR_L10N[c]))
    sw.classList.toggle('selected', c === selected)
    sw.addEventListener('click', () => {
      selected = c
      for (const [cc, el2] of swatches) el2.classList.toggle('selected', cc === c)
    })
    swatches.set(c, sw)
    colors.appendChild(sw)
  }
  const error = el('div', 'wsg-error')
  const commit = (): void => {
    const name = input.value.trim()
    if (name === '') {
      error.textContent = t('Group name cannot be empty')
      return
    }
    if (snap.tags.some((g) => g.name === name)) {
      error.textContent = t('A group with this name already exists')
      return
    }
    closePopover()
    post({ type: 'sessionTagCreate', name, color: selected })
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault()
      commit()
    }
  })
  const submit = buttonEl('wsg-create-submit', t('Create'))
  submit.addEventListener('click', commit)
  body.appendChild(input)
  body.appendChild(colors)
  body.appendChild(error)
  body.appendChild(submit)
  showPopover(anchor ?? (menuOpenRow ?? document.body), body, 'below')
  // 弹层渲染后聚焦输入。
  window.setTimeout(() => input.focus(), 0)
}

/** 整组归档确认：复用多选归档的确认弹窗 + sessionArchiveMany → archiveManyDone
 *  链路（组内不可归档会话在 skips 里列明；回执退出即按快照重建）。 */
function openTagArchiveModal(
  _tag: SnapshotTag,
  grouped: Array<{ ws: WorkspaceNodeModel; sessions: SessionNodeModel[] }>,
  archivable: SessionNodeModel[],
): void {
  if (archivable.length === 0) return
  const skipped = grouped.reduce((n, g) => n + g.sessions.length, 0) - archivable.length
  openArchiveModal(
    archivable.map((s) => s.sessionId),
    grouped.map((g) => ({ ws: g.ws, sessions: g.sessions.filter(sessionArchiveSelectable) })),
    skipped,
    { skippedDesc: t('Archived sessions will be hidden from the list. {0} session(s) cannot be archived and were skipped.', skipped) },
  )
}

/** workspace 组头（组壳由 createWorkspaceShell 提供，子级按 key 对账）。 */
function renderWorkspaceHead(w: WorkspaceNodeModel, collapsed: boolean): HTMLElement {
  const ungrouped = w.workspaceId === UNGROUPED_WORKSPACE_ID
  const empty = w.sessions.length === 0
  const head = el('div', collapsed ? 'workspace-row' : 'workspace-row expanded')
  if (empty) head.classList.add('empty')
  head.classList.toggle('has-active', w.sessions.some((s) => s.sessionId === currentSessionId))
  head.title = ungrouped ? t('Sessions not in any workspace') : w.path
  // 多选模式：组头三态复选框（全选 = 组内所有会话都选中；有置灰项则只能
  // 部分态）。搜索态下组只含匹配会话，勾选作用范围在悬停提示里如实标注。
  if (selectionMode) {
    head.appendChild(
      makeSelectionCheckbox({
        state: groupSelectionState(w),
        tip: groupSelectTip(w, sessionsSnapshot?.query != null && sessionsSnapshot.query !== ''),
        onToggle: () => toggleGroupSelection(w),
      }),
    )
  }
  const folderIcon = el('span', 'ws-folder')
  folderIcon.appendChild(iconSvg(collapsed ? PANEL_ICONS.folder : PANEL_ICONS.folderOpen))
  head.appendChild(folderIcon)
  const arrow = el('span', 'ws-arrow')
  arrow.appendChild(iconSvg(PANEL_ICONS.triangle))
  head.appendChild(arrow)
  // 组名右侧角标：待交互 / 运行中 / 未读 计数（各自独立、互斥，有则显示）。
  // 用 .workspace-label-group 包住 label + counts，组占 flex:1（badge 仍右对齐），
  // 组内 counts 紧跟 label 文本，不被推到行右端。
  const labelGroup = el('span', 'workspace-label-group')
  labelGroup.appendChild(el('span', 'workspace-label')).appendChild(highlightText(w.label))
  appendWorkspaceCounts(labelGroup, w.sessions)
  head.appendChild(labelGroup)
  if (w.isCurrent) head.appendChild(el('span', 'workspace-badge', 'vscode'))
  const headActions = el('span', 'row-actions')
  // 未分组组也有「新建会话」：创建不挂 workspace 的会话（cwd 走宿主临时目录）。
  headActions.appendChild(
    rowAction(iconSvg(PANEL_ICONS.plus), ungrouped ? t('New ungrouped session') : t('New session'), () =>
      ungrouped ? post({ type: 'sessionNewUngrouped' }) : post({ type: 'sessionNew', workspaceId: w.workspaceId }),
    ),
  )
  if (!ungrouped) {
    headActions.appendChild(
      rowAction(iconSvg(PANEL_ICONS.terminal), t('Open in terminal'), () =>
        post({ type: 'workspaceOpenTerminal', path: w.path }),
      ),
    )
    if (!w.isCurrent) {
      headActions.appendChild(
        rowAction(iconSvg(PANEL_ICONS.folderOpen), t('Open folder in VS Code'), () =>
          post({ type: 'workspaceOpenFolder', path: w.path }),
        ),
      )
    }
    headActions.appendChild(
      rowAction(strokeSvg(TRASH_ICON, 16), t('Remove from list'), () =>
        post({ type: 'workspaceRemove', workspaceId: w.workspaceId, label: w.label }),
      ),
    )
  }
  head.appendChild(headActions)
  // 空组无可展开内容不响应点击；其余（含未分组）点击折叠/展开。
  if (!empty) {
    head.addEventListener('click', () =>
      post({ type: 'workspaceCollapse', workspaceId: w.workspaceId, collapsed: !collapsed }),
    )
  }
  // 工作区右键菜单（真实 workspace；未分组虚拟组无 path/标签语义，无菜单）：
  // 与会话行右键同款 popover + 冻结机制，多选模式右键无菜单。
  if (!ungrouped) {
    head.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      if (selectionMode) return
      menuFreezeActive = true
      showPopoverAt(e.clientX, e.clientY, buildWorkspaceMenuBody(w))
      markMenuRow(head)
    })
  }
  return head
}

/**
 * 行尾状态标记（按优先级）：待交互黄点 > 运行中像素环（含运行中后代）> 未读绿点；
 * 返回 null = 空闲（行尾渲染相对时间）。主列表与回收站行共用，标记与时间在
 * 行尾互斥显示（用户确认：行尾槽固定 16px、标记居中，绿点/黄点/像素环中心共线）。
 */
function sessionStatusMarker(s: SessionNodeModel): HTMLElement | SVGSVGElement | null {
  const busy = s.running || s.descendantRunning
  if (s.pendingInteraction !== undefined) {
    const dot = el('span', 'session-dot warning')
    dot.title =
      s.pendingInteraction === 'approval'
        ? t('Waiting for approval')
        : s.pendingInteraction === 'plan-review'
          ? t('Plan review')
          : t('Waiting for answer')
    return dot
  }
  if (busy) return spinSvg()
  if (s.unread) return el('span', 'session-dot completed')
  return null
}

function renderSessionRow(s: SessionNodeModel): HTMLElement {
  const row = el('div', 'session-row')
  row.dataset.sessionId = s.sessionId
  if (currentSessionId === s.sessionId) row.classList.add('active')
  row.title = s.label
  const pinned = sessionsSnapshot?.pinned.includes(s.sessionId) ?? false
  // 多选模式：复选框紧跟标题（组头勾选框在最左，行勾选框缩进一层）。
  if (selectionMode) {
    row.classList.add('selection-mode')
    const selectable = sessionSelectable(s)
    row.appendChild(
      makeSelectionCheckbox({
        state: selectedSessionIds.has(s.sessionId) ? 'all' : 'none',
        disabled: !selectable,
        disabledTip: selectable ? null : sessionSelectTip(s),
        onToggle: () => toggleSessionSelected(s),
      }),
    )
  }
  const main = el('span', 'session-main')
  // 置顶图钉放标题前（常驻；行首不再保留独立状态槽，缩进更紧凑）。
  if (pinned) {
    const pin = el('span', 'session-pin')
    pin.appendChild(makePinIcon())
    main.appendChild(pin)
  }
  // 行内重命名：编辑中的该行渲染为输入框（prefill 标题），保留跨重建。
  if (s.sessionId === editingSessionId) {
    main.appendChild(renderRenameInput(s))
  } else {
    main.appendChild(el('span', s.unread ? 'session-title unread' : 'session-title')).appendChild(highlightText(s.label))
  }
  const marker = sessionStatusMarker(s)
  if (marker === null) main.appendChild(el('span', 'session-time', s.description))
  else {
    const rear = el('span', 'session-rear')
    rear.appendChild(marker)
    main.appendChild(rear)
  }
  row.appendChild(main)
  // 多选模式：行内 hover 按钮隐藏（点行 = 勾选，避免误触）。
  if (!selectionMode) {
    const actions = el('span', 'row-actions')
    const more = rowAction(iconSvg(PANEL_ICONS.ellipsis), t('More actions'), () => {
      menuFreezeActive = true
      showPopover(more, buildSessionMenuBody(s), 'below')
      markMenuRow(row)
    })
    actions.appendChild(more)
    row.appendChild(actions)
  }
  // 情境化点击：editor 面板真实附着（attachedSessionId，非仅高亮的待附着
  // 目标）的会话 → 行内重命名；其他 → 打开会话。编辑中忽略行点击。
  // 多选模式：点行 = 勾选/取消勾选（复选框单独接管了点击，不冒泡到行）。
  row.addEventListener('click', () => {
    if (selectionMode) {
      toggleSessionSelected(s)
      return
    }
    if (s.sessionId === editingSessionId) return
    if (sessionsSnapshot?.attachedSessionId === s.sessionId) startRowRename(s.sessionId, s.label)
    else post({ type: 'sessionOpen', sessionId: s.sessionId })
  })
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    if (selectionMode) return
    menuFreezeActive = true
    showPopoverAt(e.clientX, e.clientY, buildSessionMenuBody(s))
    markMenuRow(row)
  })
  // 拖拽入组：拖到组块 = 加入该组，拖到组块外（未分组区）= 移出分组。
  // 多选模式点行 = 勾选、编辑态行有输入框，都不启用拖拽；拖拽期间冻结
  // 列表重建（防止快照把被拖行销毁），dragend 统一解冻。
  if (!selectionMode && editingSessionId !== s.sessionId) {
    row.draggable = true
    row.addEventListener('dragstart', (e) => {
      const dt = e.dataTransfer
      if (dt) {
        dt.setData('text/dsh-session', s.sessionId)
        dt.effectAllowed = 'move'
      }
      menuFreezeActive = true
      row.classList.add('dragging')
    })
    row.addEventListener('dragend', () => {
      menuFreezeActive = false
      renderSessions()
    })
  }
  return row
}

/** 行内重命名的输入框：Enter(Esc/失焦) 语义对齐 chat 内改名。 */
function renderRenameInput(s: SessionNodeModel): HTMLInputElement {
  const input = document.createElement('input')
  input.className = 'rename-input'
  input.value = editDraft
  input.addEventListener('input', () => {
    editDraft = input.value
    editSelStart = input.selectionStart ?? editDraft.length
    editSelEnd = input.selectionEnd ?? editDraft.length
  })
  input.addEventListener('keydown', (e) => {
    // isComposing: Enter 确认的是 IME 候选，不是改名。
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault()
      commitRowRename()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelRowRename()
    }
  })
  input.addEventListener('blur', () => {
    if (rebuildInProgress) return
    cancelRowRename()
  })
  return input
}

/** 进入行内重命名：记录编辑态并重建列表（渲染输入框 + 全选）。 */
function startRowRename(sessionId: string, label: string): void {
  editingSessionId = sessionId
  editDraft = label
  editOriginalLabel = label
  editSelStart = 0
  editSelEnd = label.length
  renderSessions()
}

/** Enter 提交：标题非空且变化才发 sessionRename；随后退出编辑态并重建。 */
function commitRowRename(): void {
  const sessionId = editingSessionId
  const title = editDraft.trim()
  editingSessionId = null
  editFocusedCleanup()
  // 与 chat 改名一致：空输入/未变化不发消息，恢复行渲染。
  if (sessionId && title && title !== editOriginalLabel) {
    post({ type: 'sessionRenameDirect', sessionId, title })
  }
  if (sessionId) renderSessions()
}

/** Esc / 失焦 取消：退出编辑态并重建行。 */
function cancelRowRename(): void {
  const sessionId = editingSessionId
  editingSessionId = null
  editFocusedCleanup()
  if (sessionId) renderSessions()
}

function editFocusedCleanup(): void {
  editDraft = ''
  editOriginalLabel = ''
  editSelStart = 0
  editSelEnd = 0
}

/**
 * 内容命中的会话片段块（跟在会话行下面）：整块点击与父行一致（打开会话）；
 * 命中关键词用 <mark class="dsh-mark"> 高亮（非浏览器默认黄），找不到就原样显示。
 */
function renderContentSnippet(sessionId: string, snippet: string): HTMLElement {
  const block = el('div', 'session-snippet')
  block.appendChild(highlightText(snippet))
  block.addEventListener('click', () => {
    // 多选模式：片段与父行一致，点击 = 勾选该会话。
    const s = findSessionModel(sessionId)
    if (selectionMode && s) toggleSessionSelected(s)
    else post({ type: 'sessionOpen', sessionId })
  })
  return block
}

/**
 * 用当前 query 定位 text 里的首个（大小写不敏感）命中词并包 <mark class="dsh-mark">
 * 高亮；query 为空或无命中则原样。返回一个无 class 的 span，供标题/组名/片段复用。
 */
function highlightText(text: string): HTMLElement {
  const span = el('span')
  const qRaw = sessionsSnapshot?.query
  const q = typeof qRaw === 'string' ? qRaw.trim().toLowerCase() : ''
  if (!q) {
    span.textContent = text
    return span
  }
  const idx = text.toLowerCase().indexOf(q)
  if (idx < 0) {
    span.textContent = text
    return span
  }
  if (idx > 0) span.appendChild(document.createTextNode(text.slice(0, idx)))
  const mark = el('mark', 'dsh-mark')
  mark.textContent = text.slice(idx, idx + q.length)
  span.appendChild(mark)
  if (idx + q.length < text.length) span.appendChild(document.createTextNode(text.slice(idx + q.length)))
  return span
}

/* ---- 回收站抽屉（本地可逆缓冲层：移入/恢复只改本地集合，不碰 dsh；归档即终点） ---- */

/** 抽屉档位（占 .sessions-panel 高度比例）：默认半高；提手上拉可到 90%（仍留主列表可见）。 */
const DRAWER_HEIGHT_DEFAULT = 0.5
const DRAWER_HEIGHT_EXPANDED = 0.9
/** 拖动松手时低于此比例 = 收起抽屉（下拉到底关闭）。 */
const DRAWER_CLOSE_BELOW = 0.35
/** 滑入/滑出动画时长（CSS transition 同步值，.recycle-drawer transition）。 */
const DRAWER_ANIM_MS = 200

/** 回收站可见会话数（分组模型 flat 计数；已按非归档/存在过滤）。 */
function recycleCount(snap: SessionsSnapshot | null): number {
  if (!snap) return 0
  return snap.recycleWorkspaces.reduce((n, w) => n + w.sessions.length, 0)
}

/** 回收站全部会话模型（清空回收站的确认弹窗用；flat 所有分组）。 */
function recycleSessionModels(): SessionNodeModel[] {
  return sessionsSnapshot?.recycleWorkspaces.flatMap((w) => w.sessions) ?? []
}

/** 主列表底部的回收站入口行：面板底部固定（不随列表滚动），计数 0 灰态仍可点入。
 *  右侧常驻快捷操作（清空 / 恢复全部，与抽屉头同一套动作）：收起态不用拉开抽屉。 */
function renderRecycleEntry(): HTMLElement {
  const count = recycleCount(sessionsSnapshot)
  // 外层 div（button 不能嵌套）：主区 button 点击打开抽屉，右侧两个独立图标按钮。
  const row = el('div', 'recycle-entry' + (count === 0 ? ' is-empty' : ''))
  const main = el('button', 'recycle-entry-main')
  main.setAttribute('aria-label', t('Recycle bin ({0})', count))
  const icon = el('span')
  icon.appendChild(strokeSvg(TRASH_ICON, 16))
  main.appendChild(icon)
  main.appendChild(el('span', 'recycle-entry-label', t('Recycle bin')))
  main.appendChild(el('span', 'recycle-entry-count', String(count)))
  main.addEventListener('click', () => openRecycleDrawer())
  row.appendChild(main)
  const emptyBtn = panelTool(strokeSvg(TRASH_ICON, 14), t('Empty recycle bin'))
  emptyBtn.classList.add('danger')
  emptyBtn.disabled = count === 0
  emptyBtn.addEventListener('click', () => openRecycleArchiveModal(recycleSessionModels()))
  row.appendChild(emptyBtn)
  const restoreBtn = panelTool(strokeSvg(RESTORE_ICON, 14), t('Restore all'))
  restoreBtn.disabled = count === 0
  restoreBtn.addEventListener('click', () => {
    closePopover()
    post({ type: 'sessionsRestoreAll' })
  })
  row.appendChild(restoreBtn)
  return row
}

/** 打开回收站抽屉：从面板底部滑出（默认半高），主列表上半部仍可见可交互。 */
function openRecycleDrawer(): void {
  if (recycleView) return
  closePopover() // mousedown 之外打开（如键盘 Enter）时残留弹层兜底
  recycleView = true
  const drawer = el('div', 'recycle-drawer')
  drawer.appendChild(renderDrawerHandle())
  drawer.appendChild(renderRecycleHeader())
  // 列表容器在抽屉存活期间保活（对账挂载，抽屉关闭时随抽屉整体移除）。
  const rlist = el('div', 'recycle-list')
  drawer.appendChild(rlist)
  sessionsPanel.appendChild(drawer)
  recycleDrawer = drawer
  reconcileRecycleList(rlist)
  // 先提交初始（translateY(100%)）样式，再加 .open 触发滑入过渡。
  void drawer.offsetHeight
  drawer.classList.add('open')
  document.addEventListener('mousedown', onDrawerOutside, true)
  document.addEventListener('keydown', onDrawerKey, true)
}

/** 收起抽屉（‹ 返回 / 点击抽屉外 / Esc / 拖到下拉到底）：滑出动画结束后移除节点。 */
function closeRecycleDrawer(): void {
  const drawer = recycleDrawer
  if (!drawer) return
  recycleDrawer = null
  recycleView = false
  document.removeEventListener('mousedown', onDrawerOutside, true)
  document.removeEventListener('keydown', onDrawerKey, true)
  drawer.classList.remove('open')
  setTimeout(() => drawer.remove(), DRAWER_ANIM_MS + 40)
}

/** 提手条：顶部居中横条 + 全宽可拖区（cursor: grab）。拖动 = 上拉扩大 / 下拉收起；
 *  点击（未实质拖动）= 收起抽屉——横条不再「点了没反应」。 */
function renderDrawerHandle(): HTMLElement {
  const handle = el('div', 'recycle-drawer-handle')
  handle.setAttribute('data-tip', t('Drag to resize; click to collapse'))
  handle.appendChild(el('div', 'recycle-drawer-grip'))
  handle.addEventListener('pointerdown', onDrawerDragStart)
  return handle
}

/**
 * 提手拖拽（pointer capture 全程跟随）：上拉扩大高度（半高 → 90%），下拉松手
 * 低于 DRAWER_CLOSE_BELOW 关闭抽屉。松手吸附两档：< 中值回半高，≥ 中值到 90%。
 * 未实质拖动（< 4px，含纯点击与微小抖动）= 点击语义：收起抽屉。
 */
function onDrawerDragStart(e: PointerEvent): void {
  if (e.button !== 0 || !recycleDrawer) return
  e.preventDefault()
  const drawer = recycleDrawer
  const handle = e.currentTarget as HTMLElement
  const startY = e.clientY
  const basePx = drawer.offsetHeight
  const panelPx = sessionsPanel.offsetHeight
  let maxDelta = 0
  // 合成事件/非常规指针环境下没有活动指针，setPointerCapture 会抛——兜底不拖垮点击语义。
  try {
    handle.setPointerCapture(e.pointerId)
  } catch {
    /* 无指针捕获时 move/up 监听仍挂在提手上，常规点击/小拖动不受影响。 */
  }
  const move = (ev: PointerEvent): void => {
    maxDelta = Math.max(maxDelta, Math.abs(startY - ev.clientY))
    const ratio = (basePx + (startY - ev.clientY)) / panelPx
    drawer.style.height = `${Math.min(0.97, Math.max(0.15, ratio)) * 100}%`
  }
  const up = (): void => {
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', up)
    handle.removeEventListener('pointercancel', up)
    const h = drawer.style.height
    drawer.style.height = ''
    if (maxDelta < 4) {
      closeRecycleDrawer()
      return
    }
    if (h === '') return
    const ratio = parseFloat(h) / 100
    if (ratio < DRAWER_CLOSE_BELOW) {
      closeRecycleDrawer()
      return
    }
    drawer.classList.toggle('expanded', ratio >= (DRAWER_HEIGHT_DEFAULT + DRAWER_HEIGHT_EXPANDED) / 2)
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', up)
  handle.addEventListener('pointercancel', up)
}

/** 点击抽屉外收起（无遮罩直接叠：主列表可交互，点击其上任一处即收起）。
 *  临时浮层（行菜单 popover / 归档确认弹窗）内的点击不收起——用户点的是浮层。 */
function onDrawerOutside(e: MouseEvent): void {
  const t = e.target
  if (!recycleDrawer || !(t instanceof Node) || recycleDrawer.contains(t)) return
  if (popover && popover.contains(t)) return
  if (selectionModal?.overlay.contains(t)) return
  if (recycleModal?.overlay.contains(t)) return
  closeRecycleDrawer()
}

/** Esc 收起：先关浮层（其 keydown 处理器已 preventDefault），再关抽屉。 */
function onDrawerKey(e: KeyboardEvent): void {
  if (e.defaultPrevented) return
  if (e.key === 'Escape' && !popover && !selectionModal && !recycleModal) {
    e.preventDefault()
    closeRecycleDrawer()
  }
}

/** 回收站抽屉头：▼ 收起 + 「回收站 (N)」（计数徽标紧跟标题）+ 清空回收站，右侧「恢复全部」。 */
function renderRecycleHeader(): HTMLElement {
  const count = recycleCount(sessionsSnapshot)
  const header = el('div', 'recycle-header')
  const back = el('button', 'recycle-back')
  back.appendChild(strokeSvg(COLLAPSE_ICON, 12))
  back.appendChild(el('span', undefined, t('Back')))
  back.addEventListener('click', () => closeRecycleDrawer())
  header.appendChild(back)
  const title = el('div', 'recycle-header-title')
  title.setAttribute('data-tip', t('Recycle bin ({0})', count))
  title.appendChild(el('span', undefined, t('Recycle bin')))
  // 计数徽标紧跟标题文本（同一内联组）：不占 flex 主位、不被省略号截掉，
  // 也不被标题挤到行尾和清空按钮挨着（用户实测反馈位置不对）。
  title.appendChild(el('span', 'recycle-header-count', String(count)))
  header.appendChild(title)
  const emptyBtn = panelTool(strokeSvg(TRASH_ICON, 22), t('Empty recycle bin'))
  emptyBtn.classList.add('danger')
  emptyBtn.disabled = count === 0
  emptyBtn.addEventListener('click', () => openRecycleArchiveModal(recycleSessionModels()))
  header.appendChild(emptyBtn)
  const restoreAllBtn = buttonEl('secondary', t('Restore all'))
  restoreAllBtn.disabled = count === 0
  restoreAllBtn.addEventListener('click', () => {
    closePopover()
    post({ type: 'sessionsRestoreAll' })
  })
  header.appendChild(restoreAllBtn)
  return header
}

/** 回收站列表：按原 workspace 分组（空态/服务未运行态与主列表空态同构）。 */
/** 回收站分组头：组头 = 原 workspace 名 + 计数 + 折叠箭头；折叠态独立持久化（互不影响主列表）。 */
function renderRecycleHead(w: WorkspaceNodeModel, collapsed: boolean): HTMLElement {
  const head = el('div', collapsed ? 'workspace-row' : 'workspace-row expanded')
  head.classList.toggle('has-active', w.sessions.some((s) => s.sessionId === currentSessionId))
  const folderIcon = el('span', 'ws-folder')
  folderIcon.appendChild(iconSvg(collapsed ? PANEL_ICONS.folder : PANEL_ICONS.folderOpen))
  head.appendChild(folderIcon)
  const arrow = el('span', 'ws-arrow')
  arrow.appendChild(iconSvg(PANEL_ICONS.triangle))
  head.appendChild(arrow)
  const labelGroup = el('span', 'workspace-label-group')
  labelGroup.appendChild(el('span', 'workspace-label', w.label))
  head.appendChild(labelGroup)
  head.appendChild(el('span', 'workspace-badge', String(w.sessions.length)))
  head.addEventListener('click', () =>
    post({ type: 'recycleGroupCollapse', workspaceId: w.workspaceId, collapsed: !collapsed }),
  )
  return head
}

/** 回收站会话行：状态点照常显示（运行中/未读/待处理可以移入，回收站可逆）；点击 = 打开会话。 */
function renderRecycleSessionRow(s: SessionNodeModel): HTMLElement {
  const row = el('div', 'session-row')
  row.dataset.sessionId = s.sessionId
  if (currentSessionId === s.sessionId) row.classList.add('active')
  row.title = s.label
  const main = el('span', 'session-main')
  // 置顶图钉放标题前（常驻；行首不再保留独立状态槽，与主列表一致）。
  if (s.pinned) {
    const pin = el('span', 'session-pin')
    pin.appendChild(makePinIcon())
    main.appendChild(pin)
  }
  main.appendChild(el('span', s.unread ? 'session-title unread' : 'session-title', s.label))
  const marker = sessionStatusMarker(s)
  if (marker === null) main.appendChild(el('span', 'session-time', s.description))
  else {
    const rear = el('span', 'session-rear')
    rear.appendChild(marker)
    main.appendChild(rear)
  }
  row.appendChild(main)
  const actions = el('span', 'row-actions')
  const more = rowAction(iconSvg(PANEL_ICONS.ellipsis), t('More actions'), () => {
    menuFreezeActive = true
    showPopover(more, buildRecycleSessionMenuBody(s), 'below')
    markMenuRow(row)
  })
  actions.appendChild(more)
  row.appendChild(actions)
  row.addEventListener('click', () => post({ type: 'sessionOpen', sessionId: s.sessionId }))
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    menuFreezeActive = true
    showPopoverAt(e.clientX, e.clientY, buildRecycleSessionMenuBody(s))
    markMenuRow(row)
  })
  return row
}

/** 回收站行菜单（⋯ 与右键共用）：恢复（可逆）/ 归档（终点动作，确认弹窗）。 */
function buildRecycleSessionMenuBody(s: SessionNodeModel): HTMLElement {
  const body = el('div')
  body.appendChild(el('div', 'session-menu-title', t('Session: {0}', s.label)))
  body.appendChild(
    menuItem(t('Restore'), {
      icon: strokeSvg(RESTORE_ICON),
      onClick: () => {
        closePopover()
        post({ type: 'sessionRestore', sessionId: s.sessionId })
      },
    }),
  )
  body.appendChild(
    menuItem(t('Archive (cannot be restored)'), {
      icon: iconSvg(PANEL_ICONS.archive),
      onClick: () => {
        closePopover()
        openRecycleArchiveModal([s])
      },
    }),
  )
  return body
}

/** 回收站归档确认弹窗（清空全部/单个归档共用）：归档是终点动作（复用 archiveMany 链路）。 */
function openRecycleArchiveModal(sessions: SessionNodeModel[]): void {
  if (recycleModal || sessions.length === 0) return
  const single = sessions.length === 1
  const title = single
    ? t('Archive session "{0}"?', sessions[0].label)
    : t('Empty the recycle bin ({0} sessions)?', sessions.length)
  const overlay = el('div', 'selection-modal-overlay')
  const modal = el('div', 'selection-modal')
  modal.appendChild(el('div', 'selection-modal-title', title))
  modal.appendChild(
    el('div', 'selection-modal-desc', t('Archiving cannot be undone here; the session records are still kept on dsh.')),
  )
  const tree = el('div', 'selection-modal-tree')
  if (single) {
    const s = sessions[0]
    tree.appendChild(
      renderModalGroup(
        { ws: { workspaceId: '', path: '', label: s.label, isCurrent: false, sessions }, sessions },
        false,
      ),
    )
  } else {
    const defaultCollapsed = sessions.length > 10
    for (const g of sessionsSnapshot?.recycleWorkspaces ?? []) {
      tree.appendChild(renderModalGroup({ ws: g, sessions: g.sessions }, defaultCollapsed))
    }
  }
  modal.appendChild(tree)
  const actions = el('div', 'selection-modal-actions')
  const cancelBtn = buttonEl('secondary', t('Cancel'))
  cancelBtn.addEventListener('click', () => {
    if (recycleModal?.busy) return
    closeRecycleModal()
  })
  actions.appendChild(cancelBtn)
  const archiveBtn = buttonEl(undefined, t('Archive'))
  archiveBtn.addEventListener('click', () => confirmRecycleArchive())
  actions.appendChild(archiveBtn)
  modal.appendChild(actions)
  overlay.appendChild(modal)
  document.body.appendChild(overlay)
  recycleModal = { overlay, busy: false, sessionIds: sessions.map((s) => s.sessionId) }
  document.addEventListener('keydown', onRecycleModalKey, true)
}

function confirmRecycleArchive(): void {
  if (!recycleModal || recycleModal.busy) return
  recycleModal.busy = true
  recycleModal.overlay.querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = true))
  const title = recycleModal.overlay.querySelector<HTMLElement>('.selection-modal-title')
  if (title) title.textContent = t('Archiving…')
  post({ type: 'sessionArchiveMany', sessionIds: recycleModal.sessionIds })
}

function closeRecycleModal(): void {
  if (!recycleModal) return
  recycleModal.overlay.remove()
  recycleModal = null
  document.removeEventListener('keydown', onRecycleModalKey, true)
}

function onRecycleModalKey(e: KeyboardEvent): void {
  // 归档请求已发出（busy）时 Esc 不关闭：避免用户以为取消了，实际仍在执行。
  if (e.key === 'Escape' && recycleModal && !recycleModal.busy) {
    e.preventDefault()
    closeRecycleModal()
  }
}

/** 回收站归档回执（archiveManyDone）：成功项随快照更新消失，失败项保留（宿主已弹提示）。 */
function onRecycleArchiveManyDone(): void {
  closeRecycleModal()
}

/* ---- 多选模式（操作条：「移入回收站」+「归档选中的 N 个」） ---- */

/**
 * 复选框可勾选条件：只有置顶不可勾选——置顶不能移入回收站、也不能归档
 * （清空回收站 = 归档，置顶入站会绕过置顶保护）。运行中/未读/待处理可以
 * 勾选（可移入回收站，回收站可逆），只是不能归档（归档侧再过滤一次，
 * 见 sessionArchiveSelectable）。
 */
function sessionSelectable(s: SessionNodeModel): boolean {
  return !s.pinned
}

/** 归档资格（与单项归档一致）：置顶（同 selectable）与运行中/未读/待处理都不可；后者可移入回收站。 */
function sessionArchiveSelectable(s: SessionNodeModel): boolean {
  return !(s.pinned || s.running || s.descendantRunning || s.unread || s.pendingInteraction !== undefined)
}

/** 不可勾选原因的悬停提示；可勾选返回 null。 */
function sessionSelectTip(s: SessionNodeModel): string | null {
  if (s.pinned) return t('Pinned sessions cannot be moved to the recycle bin or archived; unpin them first')
  return null
}

function findSessionModel(sessionId: string): SessionNodeModel | null {
  for (const ws of sessionsSnapshot?.workspaces ?? []) {
    const s = ws.sessions.find((x) => x.sessionId === sessionId)
    if (s) return s
  }
  return null
}

/** 勾选态三值：none（未选）/ some（部分，indeterminate）/ all（全选）。 */
type SelectState = 'none' | 'some' | 'all'

function setCheckboxState(input: HTMLInputElement, state: SelectState): void {
  input.checked = state === 'all'
  // indeterminate setter 后原生 click 不会再自动改 checked，我们用 click
  // preventDefault 全程接管；先清 indeterminate 再设，避免残留态串位。
  input.indeterminate = false
  input.indeterminate = state === 'some'
}

/**
 * 自绘复选框（行首/组头共用）：click 里 preventDefault 接管控勾，避免原生
 * 切换与 indeterminate 态冲突；stopPropagation 防止行/组头 click 连动。
 */
function makeSelectionCheckbox(opts: {
  state: SelectState
  onToggle: () => void
  disabled?: boolean
  disabledTip?: string | null
  tip?: string | null
}): HTMLElement {
  const wrap = el('span', 'select-checkbox')
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.tabIndex = -1 // 键盘走列表导航，checkbox 不单独抢焦点
  setCheckboxState(input, opts.state)
  if (opts.disabled) input.disabled = true
  const tip = opts.disabled ? opts.disabledTip : opts.tip
  if (tip) wrap.setAttribute('data-tip', tip)
  input.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (!input.disabled) opts.onToggle()
  })
  wrap.appendChild(input)
  return wrap
}

function toggleSessionSelected(s: SessionNodeModel): void {
  if (!sessionSelectable(s)) return
  if (selectedSessionIds.has(s.sessionId)) selectedSessionIds.delete(s.sessionId)
  else selectedSessionIds.add(s.sessionId)
  renderSessions()
}

function toggleGroupSelection(w: WorkspaceNodeModel): void {
  const selectable = w.sessions.filter(sessionSelectable)
  const allSelected = selectable.length > 0 && selectable.every((s) => selectedSessionIds.has(s.sessionId))
  for (const s of selectable) {
    if (allSelected) selectedSessionIds.delete(s.sessionId)
    else selectedSessionIds.add(s.sessionId)
  }
  // 选中方向（不是取消）且组内有置顶会话：飘提示，说明没法真正全选。
  if (!allSelected && selectable.length < w.sessions.length) {
    const cb = document.querySelector<HTMLElement>(
      `.workspace-group[data-workspace-id="${CSS.escape?.(w.workspaceId) ?? w.workspaceId}"] .select-checkbox`,
    )
    if (cb) flashTip(t('Pinned sessions cannot be moved to the recycle bin or archived; this group cannot be fully selected'), cb)
  }
  renderSessions()
}

/**
 * 组头三态语义 = 「组内全部选中」：只有组内所有会话都可选且全部被选中才是
 * 全选；组里有置灰（运行中/未读/待处理）会话时只能 none/some——避免用户
 * 误以为整组都会归档。
 */
function groupSelectionState(w: WorkspaceNodeModel): SelectState {
  const selectable = w.sessions.filter(sessionSelectable)
  if (selectable.length === 0) return 'none'
  let sel = 0
  for (const s of selectable) {
    if (selectedSessionIds.has(s.sessionId)) sel += 1
  }
  if (sel === 0) return 'none'
  if (sel === selectable.length && selectable.length === w.sessions.length) return 'all'
  return 'some'
}

/** 组头复选框悬停提示：置顶数（不可勾选，移入/归档都禁止）+ 非归档数（可勾选但归档会跳过）。 */
function groupSelectTip(w: WorkspaceNodeModel, inSearch: boolean): string | null {
  const parts: string[] = []
  const pinnedCount = w.sessions.filter((s) => !sessionSelectable(s)).length
  if (pinnedCount > 0) {
    parts.push(t('{0} pinned session(s) cannot be moved to the recycle bin or archived', pinnedCount))
  }
  const nonArchivable = w.sessions.filter((s) => sessionSelectable(s) && !sessionArchiveSelectable(s)).length
  if (nonArchivable > 0) parts.push(t('{0} session(s) cannot be archived', nonArchivable))
  if (inSearch) parts.push(t('Selection applies to current search results'))
  return parts.length > 0 ? parts.join(' · ') : null
}

/** 进入多选模式：清掉行内改名（编辑框与勾选语义冲突），清空上轮勾选。 */
function enterSelectionMode(): void {
  selectionMode = true
  if (editingSessionId) cancelRowRename()
  selectedSessionIds.clear()
  closePopover()
}

/** 退出多选模式并清空勾选（顶部条「取消」/归档完成）。 */
function exitSelectionMode(): void {
  selectionMode = false
  selectedSessionIds.clear()
  closeSelectionModal()
  renderSessions()
}

/** 顶部操作条：搜索框下、第一个工作区上，含「移入回收站」「归档选中的 N 个」与「取消」。 */
function buildSelectionBar(): HTMLElement {
  const bar = el('div', 'selection-bar')
  // 移入回收站：可勾选 = 非置顶，全部可移入（运行中/未读/待处理也允许，回收站可逆）。
  const moveBtn = buttonEl(undefined, t('Recycle bin ({0})', selectedSessionIds.size))
  moveBtn.disabled = selectedSessionIds.size === 0
  moveBtn.addEventListener('click', () => {
    const ids = [...selectedSessionIds]
    if (ids.length === 0) return
    closePopover()
    post({ type: 'sessionMoveToRecycleMany', sessionIds: ids })
    // 点击即退出多选（操作完成语义）。flashTip 挂在 body、定位在点击时已算好，
    // 操作条随退出消失不影响它飘完。
    flashTip(t('Moved to the recycle bin'), moveBtn)
    exitSelectionMode()
  })
  bar.appendChild(moveBtn)
  // 归档：勾选里可归档的子集（运行中/未读/待处理可勾选但不可归档——归档后
  // 状态难追踪；确认弹窗里会再过滤并列明跳过数）。按钮计数与之对齐。
  const archivableCount = [...selectedSessionIds].filter((id) => {
    const s = findSessionModel(id)
    return s ? sessionArchiveSelectable(s) : true
  }).length
  const archiveBtn = buttonEl(undefined, t('Archive ({0})', archivableCount))
  archiveBtn.disabled = archivableCount === 0
  archiveBtn.addEventListener('click', () => openSelectionModal())
  bar.appendChild(archiveBtn)
  const cancelBtn = buttonEl('secondary', t('Cancel'))
  cancelBtn.addEventListener('click', () => exitSelectionMode())
  bar.appendChild(cancelBtn)
  return bar
}

/** 确认弹窗：按工作区树形分组展示选中会话（只列可归档的；过多默认折叠明细，展开不超屏）。 */
function openSelectionModal(): void {
  const snap = sessionsSnapshot
  if (!snap || selectedSessionIds.size === 0) return
  // 勾选里可归档的子集：运行中/未读/待处理可以勾选（为了移入回收站）但不能
  // 归档，这里过滤掉并列明跳过数，不静默放行。
  const archivableIds = new Set(
    [...selectedSessionIds].filter((id) => {
      const s = findSessionModel(id)
      return s ? sessionArchiveSelectable(s) : true
    }),
  )
  const skipped = selectedSessionIds.size - archivableIds.size
  const groups: Array<{ ws: WorkspaceNodeModel; sessions: SessionNodeModel[] }> = []
  const seen = new Set<string>()
  for (const ws of snap.workspaces) {
    const sels = ws.sessions.filter((s) => archivableIds.has(s.sessionId))
    if (sels.length > 0) {
      groups.push({ ws, sessions: sels })
      for (const s of sels) seen.add(s.sessionId)
    }
  }
  // 勾选项可能因搜索过滤/别处归档而不在当前树里（组被整组过滤、行不渲染，
  // 但勾选保留）：兜底组列出，不静默丢弃也不归档不存在的 id。
  const leftover = [...archivableIds].filter((id) => !seen.has(id))
  if (leftover.length > 0) {
    const ws: WorkspaceNodeModel = {
      workspaceId: '',
      path: '',
      label: t('Other sessions'),
      isCurrent: false,
      sessions: leftover.map((id) => {
        const m = findSessionModel(id)
        return (
          m ?? {
            sessionId: id,
            label: id.slice(0, 8),
            description: '',
            running: false,
            active: false,
            pinned: false,
            hasCompletedTurn: false,
            unread: false,
            descendantRunning: false,
          }
        )
      }),
    }
    groups.push({ ws, sessions: ws.sessions })
  }
  openArchiveModal([...archivableIds], groups, skipped)
}

/**
 * 归档确认弹窗本体（多选模式与工作区右键菜单「归档该工作区全部会话」共用）：
 * 确认 → sessionArchiveMany → archiveManyDone 分流。skippedDesc 供「归档某工作区
 * 全部」这类非勾选语境改写跳过说明（默认文案按「选中的」做）。
 */
function openArchiveModal(
  ids: string[],
  groups: Array<{ ws: WorkspaceNodeModel; sessions: SessionNodeModel[] }>,
  skipped: number,
  opts: { skippedDesc?: string } = {},
): void {
  const total = groups.reduce((n, g) => n + g.sessions.length, 0)
  if (total === 0) return
  const overlay = el('div', 'selection-modal-overlay')
  const modal = el('div', 'selection-modal')
  const title =
    total === 1
      ? t('Archive {0} session?', total)
      : t('Archive {0} sessions?', total)
  modal.appendChild(el('div', 'selection-modal-title', title))
  const desc =
    skipped > 0
      ? (opts.skippedDesc ??
        t('Archived sessions will be hidden from the list. {0} selected session(s) cannot be archived and were skipped.', skipped))
      : t('Archived sessions will be hidden from the list.')
  modal.appendChild(el('div', 'selection-modal-desc', desc))
  const tree = el('div', 'selection-modal-tree')
  // 过长（多组或大量会话）默认折叠明细，组头恒可见；展开后靠滚动不超屏。
  const defaultCollapsed = groups.length > 1 || total > 10
  for (const g of groups) tree.appendChild(renderModalGroup(g, defaultCollapsed))
  modal.appendChild(tree)
  const actions = el('div', 'selection-modal-actions')
  const cancelBtn = buttonEl('secondary', t('Cancel'))
  cancelBtn.addEventListener('click', () => closeSelectionModal())
  actions.appendChild(cancelBtn)
  const archiveBtn = buttonEl(undefined, t('Archive'))
  archiveBtn.addEventListener('click', () => confirmArchive())
  actions.appendChild(archiveBtn)
  modal.appendChild(actions)
  overlay.appendChild(modal)
  document.body.appendChild(overlay)
  selectionModal = { overlay, busy: false, ids }
  document.addEventListener('keydown', onSelectionModalKey, true)
}

function renderModalGroup(g: { ws: WorkspaceNodeModel; sessions: SessionNodeModel[] }, collapsed: boolean): HTMLElement {
  const box = el('div', collapsed ? 'modal-group collapsed' : 'modal-group')
  const head = el('div', 'modal-group-head')
  const arrow = el('span', 'modal-group-arrow')
  arrow.appendChild(iconSvg(PANEL_ICONS.triangle, 10))
  head.appendChild(arrow)
  head.appendChild(el('span', 'modal-group-label', g.ws.label))
  head.appendChild(el('span', 'modal-group-count', String(g.sessions.length)))
  head.addEventListener('click', () => box.classList.toggle('collapsed'))
  box.appendChild(head)
  const list = el('div', 'modal-group-list')
  for (const s of g.sessions) {
    const item = el('div', 'modal-session')
    item.appendChild(el('span', 'modal-session-name', s.label))
    item.appendChild(el('span', 'modal-session-time', s.description))
    list.appendChild(item)
  }
  box.appendChild(list)
  return box
}

function onSelectionModalKey(e: KeyboardEvent): void {
  // 归档请求已发出（busy）时 Esc 不关闭：避免用户以为取消了，实际仍在执行。
  if (e.key === 'Escape' && selectionModal && !selectionModal.busy) {
    e.preventDefault()
    closeSelectionModal()
  }
}

function closeSelectionModal(): void {
  if (!selectionModal) return
  selectionModal.overlay.remove()
  selectionModal = null
  document.removeEventListener('keydown', onSelectionModalKey, true)
}

/** 确认归档：请求已发出 → busy（按钮禁用 + 标题“正在归档”），等 archiveManyDone。
 *  提交弹窗打开时锁定的可归档子集（运行中/未读/待处理在弹窗里已列明跳过）。 */
function confirmArchive(): void {
  if (!selectionModal || selectionModal.busy) return
  const ids = selectionModal.ids
  if (ids.length === 0) return
  selectionModal.busy = true
  selectionModal.overlay.querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = true))
  const title = selectionModal.overlay.querySelector<HTMLElement>('.selection-modal-title')
  if (title) title.textContent = t('Archiving…')
  post({ type: 'sessionArchiveMany', sessionIds: ids })
}

/** 批量归档结果回执：无论成败都退出多选——失败项宿主已弹提示，会话仍在列表可重选。 */
function onArchiveManyDone(): void {
  closeSelectionModal()
  exitSelectionMode()
}

/** 会话菜单内容（⋯ 按钮与右键菜单共用）。 */
function buildSessionMenuBody(s: SessionNodeModel): HTMLElement {
  const pinned = sessionsSnapshot?.pinned.includes(s.sessionId) ?? false
  const body = el('div')
  // 菜单首行显示会话标题（操作对象显式化）：即使用户瞄错行也能立刻发现，点击前可收回。
  body.appendChild(el('div', 'session-menu-title', t('Session: {0}', s.label)))
  // 进入多选归档模式（开启后本菜单即关闭；行/组头出现复选框）。
  body.appendChild(
    menuItem(t('Select multiple'), {
      icon: iconSvg(MESSAGE_ACTION_ICONS.check),
      onClick: () => enterSelectionMode(),
    }),
  )
  // 默认点击会话行 = 在当前活动 chat tab 打开；这里显式提供「新开 tab」。
  body.appendChild(
    menuItem(t('Open in a new tab'), {
      icon: iconSvg(PANEL_ICONS.boxedPlus),
      onClick: () => {
        closePopover()
        post({ type: 'sessionOpenInNewTab', sessionId: s.sessionId })
      },
    }),
  )
  body.appendChild(
    menuItem(t('Rename'), {
      icon: iconSvg(PANEL_ICONS.edit),
      onClick: () => {
        closePopover()
        post({ type: 'sessionRename', sessionId: s.sessionId, title: s.label })
      },
    }),
  )
  body.appendChild(
    menuItem(pinned ? t('Unpin') : t('Pin'), {
      icon: strokeSvg(PIN_ICON),
      checked: pinned,
      onClick: () => {
        closePopover()
        post({ type: 'sessionPin', sessionId: s.sessionId, pin: !pinned })
      },
    }),
  )
  body.appendChild(
    menuItem(s.unread ? t('Mark as read') : t('Mark as unread'), {
      icon: strokeSvg(UNREAD_ICON),
      checked: s.unread,
      // 运行中会话的手动未读语义混乱，置灰禁用（与行首 busy 判定一致）。
      disabled: s.running || s.descendantRunning,
      disabledTip: t('Running sessions cannot be marked read/unread manually'),
      onClick: () => {
        closePopover()
        post({ type: 'sessionUnread', sessionId: s.sessionId, unread: !s.unread })
      },
    }),
  )
  // 移到分组（Chrome 垂直标签式单组）：菜单内上下展开的 accordion（侧栏窄，
  // 横排二级放不下——用户反馈）。点击「Move to group…」展开/收起组列表。
  const tagEntry = buildTagGroupsMenuItem(s)
  body.appendChild(tagEntry.item)
  body.appendChild(tagEntry.tagList)
  body.appendChild(    menuItem(t('Fork session'), {
      icon: iconSvg(MESSAGE_ACTION_ICONS.branch),
      // 列表级 fork 不带 atSeq，服务端回退到最后一个 turn/end 切点；会话
      // 从未完成过任何轮次（无 turn/end）会返回 fork-unavailable。这里在无
      // 完成轮次的会话上禁用（对齐官方「轮次未结束不出现 fork」）。
      disabled: !s.hasCompletedTurn,
      disabledTip: t('The session has no completed turn; cannot fork'),
      onClick: () => {
        closePopover()
        post({ type: 'sessionFork', sessionId: s.sessionId })
      },
    }),
  )
  body.appendChild(
    menuItem(t('Copy reference'), {
      icon: iconSvg(MESSAGE_ACTION_ICONS.copy),
      onClick: () => {
        closePopover()
        post({ type: 'sessionCopyReference', sessionId: s.sessionId, title: s.label })
      },
    }),
  )
  // 移入回收站（可逆缓冲层，无确认弹窗）：置顶不可移入（清空回收站 = 归档，
  // 置顶入站会绕过置顶保护）；运行中/未读/待处理可以移入（与归档限制不同）。
  body.appendChild(
    menuItem(t('Move to recycle bin'), {
      icon: strokeSvg(TRASH_ICON),
      disabled: pinned,
      disabledTip: t('Pinned sessions cannot be moved to the recycle bin; unpin them first'),
      onClick: () => {
        const anchor = menuOpenRow
        // 先飘提示（此时行还在 DOM 里能取到 rect），再关菜单/发消息。
        if (anchor) flashTip(t('Moved to the recycle bin'), anchor)
        closePopover()
        post({ type: 'sessionMoveToRecycle', sessionId: s.sessionId })
      },
    }),
  )
  body.appendChild(
    menuItem(t('Archive session'), {
      icon: iconSvg(PANEL_ICONS.archive),
      // 运行中/未读/待处理/置顶的会话归档后状态难追踪（置顶归档绕过置顶保护），置灰禁用。
      disabled: pinned || s.running || s.descendantRunning || s.unread || s.pendingInteraction !== undefined,
      disabledTip: pinned
        ? t('Pinned sessions cannot be archived; unpin them first')
        : s.pendingInteraction !== undefined
          ? t('Sessions with pending items cannot be archived')
          : s.running || s.descendantRunning
            ? t('Running sessions cannot be archived')
            : t('Unread sessions cannot be archived'),
      onClick: () => {
        closePopover()
        post({ type: 'sessionArchive', sessionId: s.sessionId, title: s.label })
      },
    }),
  )
  return body
}

/**
 * 「Move to group…」菜单项 + 组列表 accordion：点击在**菜单内部上下展开/收起**
 * 组列表（侧栏窄，横排二级弹层放不下）；项右端 ▸/▾ 指示展开态。子项点击走
 * 现有行为（选组 = 关菜单 + sessionTagSet；New group… = 关菜单 + 新建弹层）。
 */
function buildTagGroupsMenuItem(s: SessionNodeModel): { item: HTMLElement; tagList: HTMLElement } {
  const tagList = el('div', 'tag-submenu')
  tagList.style.display = 'none'
  let expanded = false
  const item = menuItem(t('Move to group…'), {
    icon: iconSvg(GEAR_ICON, 14),
    right: '▸',
    onClick: () => {
      expanded = !expanded
      tagList.style.display = expanded ? '' : 'none'
      const right = item.querySelector('.menu-right')
      if (right) right.textContent = expanded ? '▾' : '▸'
    },
  })
  for (const tag of tagsSnapshot()) {
    tagList.appendChild(
      menuItem(tag.name, {
        icon: tagSwatchIcon(tag.color),
        checked: s.tagId === tag.id,
        onClick: () => {
          closePopover()
          if (s.tagId !== tag.id) post({ type: 'sessionTagSet', sessionId: s.sessionId, tagId: tag.id })
        },
      }),
    )
  }
  tagList.appendChild(
    menuItem(t('No group'), {
      icon: tagEmptySwatchIcon(),
      checked: s.tagId === undefined,
      onClick: () => {
        closePopover()
        if (s.tagId !== undefined) post({ type: 'sessionTagSet', sessionId: s.sessionId, tagId: null })
      },
    }),
  )
  tagList.appendChild(
    menuItem(t('New group…'), {
      icon: iconSvg(PANEL_ICONS.plus, 14),
      onClick: () => {
        // closePopover 会清 menuOpenRow（markMenuRow(null)），先取锚再关。
        const rowAnchor = menuOpenRow
        closePopover()
        openTagCreatePopup(rowAnchor)
      },
    }),
  )
  return { item, tagList }
}

/* ---- 工作区右键菜单（仅真实 workspace；未分组虚拟组无菜单） ---- */

/** 工作区菜单内容（右键菜单，6 项定稿）：复制文件夹引用 / 分组… / 归档该工作区
 *  全部会话 / 在新窗口打开文件夹 / 复制路径 / 从列表移除。与会话行菜单共用
 *  popover + 冻结机制；hover 行内按钮全部保留，右键为并存入口。 */
function buildWorkspaceMenuBody(w: WorkspaceNodeModel): HTMLElement {
  const body = el('div')
  body.appendChild(el('div', 'session-menu-title', t('Workspace: {0}', w.label)))
  body.appendChild(
    menuItem(t('Copy folder reference'), {
      icon: iconSvg(MESSAGE_ACTION_ICONS.copy),
      onClick: () => {
        closePopover()
        post({ type: 'workspaceCopyFolderRef', path: w.path })
      },
    }),
  )
  body.appendChild(buildWorkspaceGroupsMenu(w))
  body.appendChild(
    menuItem(t('Archive all sessions in this workspace'), {
      icon: iconSvg(PANEL_ICONS.archive),
      // 与多选归档/单项归档同规则（置顶/运行中/未读/待处理跳过），全不可归档时置灰。
      disabled: !w.sessions.some(sessionArchiveSelectable),
      disabledTip: t('No archivable sessions in this workspace'),
      onClick: () => {
        closePopover()
        openWorkspaceArchiveModal(w)
      },
    }),
  )
  body.appendChild(
    menuItem(t('Open folder in a new window'), {
      icon: iconSvg(PANEL_ICONS.folderOpen),
      onClick: () => {
        closePopover()
        post({ type: 'workspaceOpenNewWindow', path: w.path })
      },
    }),
  )
  body.appendChild(
    menuItem(t('Copy path'), {
      icon: iconSvg(COPY_ICON, 14),
      onClick: () => {
        closePopover()
        post({ type: 'workspaceCopyPath', path: w.path })
      },
    }),
  )
  body.appendChild(
    menuItem(t('Remove from list'), {
      icon: strokeSvg(TRASH_ICON, 16),
      onClick: () => {
        closePopover()
        post({ type: 'workspaceRemove', workspaceId: w.workspaceId, label: w.label })
      },
    }),
  )
  return body
}

/** 「分组…」菜单项（带 › 子菜单指示）：hover 展开二级 popover（VS Code submenu
 *  惯例），点击兜底（触屏/键盘）；已展开时幂等不重建（勾选中途重建会闪）。 */
function buildWorkspaceGroupsMenu(w: WorkspaceNodeModel): HTMLElement {
  const item = el('div', 'menu-item')
  const iconWrap = el('span', 'menu-item-icon')
  iconWrap.appendChild(iconSvg(GEAR_ICON, 14))
  item.appendChild(iconWrap)
  item.appendChild(el('span', undefined, t('Groups…')))
  item.appendChild(el('span', 'menu-right', '›'))
  const open = (): void => {
    if (subPopover === null) showWorkspaceGroupsSubmenu(w, item)
  }
  item.addEventListener('pointerover', open)
  item.addEventListener('click', open)
  return item
}

/**
 * 「分组…」二级菜单：多选勾 tag（复用 workspaceGroupSetMembership 全量替换接口，
 * 与管理视图打标同源）。勾选 = 归组、点已勾 = 移除，勾完不关菜单可连续勾；
 * 提交后就地翻转该项自身的 ✓（不重建菜单——快照往返是异步的，重建会读到旧
 * 归属显示成未勾）。关闭（Esc / 点击外部）后 closePopover 解冻，重开菜单时
 * 从最新快照渲染勾选态。
 */
function showWorkspaceGroupsSubmenu(w: WorkspaceNodeModel, anchor: HTMLElement): void {
  const snap = sessionsSnapshot
  const body = el('div')
  if (!snap || snap.groups.length === 0) {
    body.appendChild(menuItem(t('No groups yet. Create one from the group bar above.'), { disabled: true, onClick: () => {} }))
  } else {
    for (const g of snap.groups) {
      const item = menuItem(g.name, {
        right: String(g.count),
        checked: (snap.groupMembership[w.workspaceId] ?? []).includes(g.id),
        onClick: () => {
          // 勾选态随时取最新快照的归属（快速连点不依赖本次渲染时的旧值），
          // 与管理视图 buildGroupManageMembers 的提交口径一致。
          const current = sessionsSnapshot?.groupMembership[w.workspaceId] ?? []
          const becameMember = !current.includes(g.id)
          const next = becameMember ? [...current, g.id] : current.filter((id) => id !== g.id)
          post({ type: 'workspaceGroupSetMembership', workspaceId: w.workspaceId, groupIds: next })
          item.classList.toggle('checked', becameMember)
          const chk = item.querySelector('.check')
          if (becameMember) {
            if (!chk) item.appendChild(el('span', 'check', '✓'))
          } else {
            chk?.remove()
          }
        },
      })
      body.appendChild(item)
    }
  }
  const rect = anchor.getBoundingClientRect()
  showSubPopoverAt(Math.min(rect.right + 6, window.innerWidth - 4), rect.top, anchor, body)
}

/** 「归档该工作区全部会话」：收集该工作区可归档会话（同多选归档规则，置顶/
 *  运行中/未读/待处理跳过），复用确认弹窗 + sessionArchiveMany → archiveManyDone 链路。 */
function openWorkspaceArchiveModal(w: WorkspaceNodeModel): void {
  const archivable = w.sessions.filter(sessionArchiveSelectable)
  if (archivable.length === 0) return
  const skipped = w.sessions.length - archivable.length
  openArchiveModal(
    archivable.map((s) => s.sessionId),
    [{ ws: w, sessions: archivable }],
    skipped,
    { skippedDesc: t('Archived sessions will be hidden from the list. {0} session(s) cannot be archived and were skipped.', skipped) },
  )
}

window.addEventListener('message', (event) => {
  const msg = event.data as ToWebviewMessage
  if (msg?.type === 'sessions' && msg.snapshot) {
    sessionsSnapshot = msg.snapshot
    currentSessionId = msg.snapshot.activeSessionId ?? null
    renderSessions()
    // 管理视图打开期间快照到达：内容整体刷新（组列表/勾选态随新数据更新）。
    // 焦点在弹层内（正在输入新建组名/重命名）时跳过：重建销毁输入框会断
    // IME/丢焦点，文本有 m.newGroupDraft/m.renameDraft 恢复但焦点不回来——
    // 焦点移出弹层后下次快照到达自然刷新；本地动作（选组/提交/删除）照常
    // 自行 rebuild。IME 组合中的弹层输入同样被焦点条件覆盖。
    if (groupManage && !groupManage.dragging && !groupManage.overlay.contains(document.activeElement)) {
      rebuildGroupManage()
    }
  } else if (msg?.type === 'archiveManyDone' && Array.isArray(msg.failed)) {
    // 回收站归档（清空/单个）与主列表批量归档共用 sessionArchiveMany 链路：
    // 按当前打开的确认弹窗分流回执。
    if (recycleModal) onRecycleArchiveManyDone()
    else onArchiveManyDone()
  }
})

renderSessions()
