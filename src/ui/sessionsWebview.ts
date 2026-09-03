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
import {
  INSTALL_SCRIPT_OS_ORDER,
  installCommandFor,
  type HostOs,
} from '../pure/installScript.ts'

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

/* ---- 多选归档模式（临时 UI 状态：不进 store、不持久化，退出即清空） ---- */
let selectionMode = false
const selectedSessionIds = new Set<string>()
/** 批量归档确认弹窗（挂 body，不随列表重建销毁）；busy = 归档请求已发出。 */
let selectionModal: { overlay: HTMLElement; busy: boolean } | null = null

const sessionsPanel = el('aside', 'sessions-panel')
app.appendChild(sessionsPanel)

/* ---- 弹层（坐标 & 锚点两用） ---- */
let popover: HTMLElement | null = null
let popoverAnchor: HTMLElement | null = null
let popoverPlacement: 'above' | 'below' = 'above'
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
  if (
    popover &&
    !popover.contains(e.target as Node) &&
    !(popoverAnchor !== null && popoverAnchor.contains(e.target as Node))
  ) {
    closePopover()
  }
}

function onPopoverKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    closePopover()
  }
}

/** 只清弹层 DOM、锚与事件监听的内部清理（showPopover/showPopoverAt 换菜单时
 *  用——不清冻结、不补渲染，因为新菜单还要继续开着）。 */
function disposePopover(): void {
  popover?.remove()
  popover = null
  popoverAnchor = null
  markMenuRow(null)
  document.removeEventListener('mousedown', onPopoverOutside, true)
  document.removeEventListener('keydown', onPopoverKey, true)
}

/** 菜单真正关闭（Esc / 点击外部 / 菜单项点击）：解除冻结 + 用最新快照补一次渲染。 */
function closePopover(): void {
  menuFreezeActive = false
  disposePopover()
  renderSessions()
}

// 右键按下（button===2）且落在会话行内即进入冻结窗口——contextmenu 随后打开
// 菜单，期间列表不因快照重建而销毁该行，菜单锚/视觉锚保持稳定。解冻由
// closePopover 统一处理。左键 ⋯ 按钮走其 onClick 里置冻结。多选模式右键无菜单。
document.addEventListener('pointerdown', (e) => {
  if (e.button === 2 && !selectionMode && (e.target as HTMLElement | null)?.closest?.('.session-row')) {
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
    icon?: SVGSVGElement
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
const SPIN_CELLS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [4, 0],
  [8, 0],
  [8, 4],
  [8, 8],
  [4, 8],
  [0, 8],
  [0, 4],
]

function spinSvg(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', '10')
  svg.setAttribute('height', '10')
  svg.setAttribute('viewBox', '0 0 10 10')
  svg.setAttribute('shape-rendering', 'crispEdges')
  svg.classList.add('session-spin')
  // 全局相位（周期 1s）：快照重建会新建像素环，不叠加相位动画每帧从头闪
  // （与 chat webview 的 spinSvg 同款处理）。
  const phase = -(performance.now() % 1000)
  SPIN_CELLS.forEach(([x, y], i) => {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    rect.setAttribute('x', String(x))
    rect.setAttribute('y', String(y))
    rect.setAttribute('width', '2')
    rect.setAttribute('height', '2')
    rect.style.animationDelay = `${phase + (i - SPIN_CELLS.length) * 125}ms`
    svg.appendChild(rect)
  })
  return svg
}

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
  // 会话行菜单（右键/⋯）打开期间的冻结：跳过列表重建，保留现有 DOM（行/菜单
  // 锚不销毁），新快照仍存进 sessionsSnapshot 等解冻后渲染。header 逻辑照旧
  // （header 本就不重建）。上面的 popover 锚处理段此时走 positionPopover（旧行
  // 还在、锚 isConnected 为 true），不会误关菜单。
  if (menuFreezeActive) return
  // 列表重建期间，销毁在编输入框触发的 blur 不应把编辑当取消（rebuildGuard）。
  rebuildInProgress = true
  const oldList = sessionsPanel.querySelector<HTMLElement>('.sessions-list')
  oldList?.remove()
  const oldBar = sessionsPanel.querySelector<HTMLElement>('.selection-bar')
  oldBar?.remove()
  const list = el('div', 'sessions-list')
  if (!snap) {
    list.appendChild(el('div', 'sessions-empty', t('Loading…')))
  } else if (snap.serverState !== 'running') {
    list.appendChild(renderServerEmpty(snap))
  } else if (!snap.baselineReady) {
    // 服务已 running 但基线还没拉到（或代际切换后未重拉成功）：空基线会被
    // 恒渲染的「未分组」组误导成「没有 workspace」，未分组组头先于工作区组
    // 出现。等基线就绪再渲染列表，这里保持 Loading。
    list.appendChild(el('div', 'sessions-empty', t('Loading…')))
  } else if (snap.workspaces.every((w) => w.workspaceId === UNGROUPED_WORKSPACE_ID)) {
    // 没有真实 workspace：保留「添加工作区」引导，同时仍渲染「未分组」组
    // （空组头 + 新建按钮，「新建未分组对话」入口恒可达）。搜索态下未分组
    // 有命中时不显示提示（下方组即结果），无命中才显示「没有匹配」。
    if (snap.query === null) {
      const box = el('div', 'sessions-empty')
      box.appendChild(el('div', 'empty-hint', t('No workspaces yet. Add an existing folder or create one with the + button above.')))
      list.appendChild(box)
    } else if (snap.workspaces.length === 0) {
      const box = el('div', 'sessions-empty')
      box.appendChild(el('div', 'empty-hint', t('No sessions match “{0}”.', snap.query)))
      list.appendChild(box)
    }
    for (const w of snap.workspaces) list.appendChild(renderWorkspaceGroup(w))
  } else {
    for (const w of snap.workspaces) list.appendChild(renderWorkspaceGroup(w))
    if (snap.contentSearchHasMore) {
      list.appendChild(el('div', 'sessions-search-more', t('More matching sessions; try a more precise keyword')))
    }
  }
  // 内容搜索降级：后端索引未启用等导致全文搜索失败——给用户可见提示，不静默。
  if (snap && snap.query != null && snap.query !== '' && snap.contentSearchError) {
    const degraded = el(
      'div',
      'sessions-search-more sessions-search-degraded',
      t('Full-text search unavailable; matching titles only (dsh search index not enabled)'),
    )
    // 悬停显示更详细的原因与启用索引的方法（复用自实现 tooltip）。
    degraded.setAttribute(
      'data-tip',
      `dsh 全文搜索默认 opt-in：session-query 索引 openAt: "never"（未启用），session.search 被禁用。
启用：编辑 ~/.dsh/profiles/web/cordis.patch.yml，追加以下配置后重启 dsh 服务：
- id: session-query-sqlite
  config:
    path: !!js dshHomePath('session-query.sqlite')
    openAt: first-search`,
    )
    list.appendChild(degraded)
  }
  sessionsPanel.appendChild(list)
  // 多选模式：操作条插在搜索框（header）与列表之间。
  if (selectionMode) sessionsPanel.insertBefore(buildSelectionBar(), list)
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

function renderWorkspaceGroup(w: WorkspaceNodeModel): HTMLElement {
  const group = el('div', 'workspace-group')
  group.dataset.workspaceId = w.workspaceId
  const ungrouped = w.workspaceId === UNGROUPED_WORKSPACE_ID
  const empty = w.sessions.length === 0
  // 搜索态：命中组（buildSessionTree 已过滤掉无匹配的组）强制展开，忽略
  // collapsed 持久化；清空搜索后回到原折叠状态显示。
  const inSearch = sessionsSnapshot?.query != null && sessionsSnapshot.query !== ''
  const collapsed = inSearch ? false : empty || (sessionsSnapshot?.collapsed.includes(w.workspaceId) ?? false)
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
        tip: groupSelectTip(w, inSearch),
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
  group.appendChild(head)
  // 未分组恒展开（collapsed 恒 false），总会渲染会话行。
  if (!collapsed) {
    for (const s of w.sessions) {
      group.appendChild(renderSessionRow(s))
      if (s.contentSnippet) group.appendChild(renderContentSnippet(s.sessionId, s.contentSnippet))
    }
  }
  return group
}

function renderSessionRow(s: SessionNodeModel): HTMLElement {
  const row = el('div', 'session-row')
  row.dataset.sessionId = s.sessionId
  if (currentSessionId === s.sessionId) row.classList.add('active')
  row.title = s.label
  const pinned = sessionsSnapshot?.pinned.includes(s.sessionId) ?? false
  const busy = s.running || s.descendantRunning
  const slot = el('span', 'session-status')
  const slotTaken = s.pendingInteraction !== undefined || busy || s.unread
  if (s.pendingInteraction !== undefined) {
    const dot = el('span', 'session-dot warning')
    dot.title =
      s.pendingInteraction === 'approval'
        ? t('Waiting for approval')
        : s.pendingInteraction === 'plan-review'
          ? t('Plan review')
          : t('Waiting for answer')
    slot.appendChild(dot)
  } else if (busy) slot.appendChild(spinSvg())
  else if (s.unread) slot.appendChild(el('span', 'session-dot completed'))
  else if (pinned) slot.appendChild(makePinIcon())
  row.appendChild(slot)
  // 多选模式：复选框紧跟标题（状态槽右侧）——组头勾选框在最左，行勾选框
  // 缩进一层，形成清晰的树形层次。
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
  if (pinned && slotTaken) {
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
  main.appendChild(el('span', 'session-time', s.description))
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

/* ---- 多选归档模式 ---- */

/** 与单项归档一致：运行中/未读/待处理的会话不可勾选（归档后状态难追踪）。 */
function sessionSelectable(s: SessionNodeModel): boolean {
  return !(s.running || s.descendantRunning || s.unread || s.pendingInteraction !== undefined)
}

/** 不可勾选原因的悬停提示；可勾选返回 null。文案与单项归档禁用提示一致。 */
function sessionSelectTip(s: SessionNodeModel): string | null {
  if (s.pendingInteraction !== undefined) return t('Sessions with pending items cannot be archived')
  if (s.running || s.descendantRunning) return t('Running sessions cannot be archived')
  if (s.unread) return t('Unread sessions cannot be archived')
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
  // 选中方向（不是取消）且组内有不可归档会话：飘提示，说明没法真正全选。
  if (!allSelected && selectable.length < w.sessions.length) {
    const cb = document.querySelector<HTMLElement>(
      `.workspace-group[data-workspace-id="${CSS.escape?.(w.workspaceId) ?? w.workspaceId}"] .select-checkbox`,
    )
    if (cb) flashTip(t('Some sessions cannot be archived; this group cannot be fully selected'), cb)
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

/** 组头复选框悬停提示：组内有不可归档会话时说明数量；搜索态补充作用范围。 */
function groupSelectTip(w: WorkspaceNodeModel, inSearch: boolean): string | null {
  const parts: string[] = []
  const disabledCount = w.sessions.length - w.sessions.filter(sessionSelectable).length
  if (disabledCount > 0) parts.push(t('{0} session(s) in this group cannot be archived', disabledCount))
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

/** 顶部操作条：搜索框下、第一个工作区上，含「归档选中的 N 个」与「取消」。 */
function buildSelectionBar(): HTMLElement {
  const bar = el('div', 'selection-bar')
  const archiveBtn = buttonEl(undefined, t('Archive {0} selected', selectedSessionIds.size))
  archiveBtn.disabled = selectedSessionIds.size === 0
  archiveBtn.addEventListener('click', () => openSelectionModal())
  bar.appendChild(archiveBtn)
  const cancelBtn = buttonEl('secondary', t('Cancel'))
  cancelBtn.addEventListener('click', () => exitSelectionMode())
  bar.appendChild(cancelBtn)
  return bar
}

/** 确认弹窗：按工作区树形分组展示选中会话；过多默认折叠明细，展开不超屏。 */
function openSelectionModal(): void {
  const snap = sessionsSnapshot
  if (!snap || selectedSessionIds.size === 0) return
  const groups: Array<{ ws: WorkspaceNodeModel; sessions: SessionNodeModel[] }> = []
  const seen = new Set<string>()
  for (const ws of snap.workspaces) {
    const sels = ws.sessions.filter((s) => selectedSessionIds.has(s.sessionId))
    if (sels.length > 0) {
      groups.push({ ws, sessions: sels })
      for (const s of sels) seen.add(s.sessionId)
    }
  }
  // 勾选项可能因搜索过滤/别处归档而不在当前树里（组被整组过滤、行不渲染，
  // 但勾选保留）：兜底组列出，不静默丢弃也不归档不存在的 id。
  const leftover = [...selectedSessionIds].filter((id) => !seen.has(id))
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
  const total = groups.reduce((n, g) => n + g.sessions.length, 0)
  if (total === 0) return
  const overlay = el('div', 'selection-modal-overlay')
  const modal = el('div', 'selection-modal')
  const title =
    total === 1
      ? t('Archive {0} session?', total)
      : t('Archive {0} sessions?', total)
  modal.appendChild(el('div', 'selection-modal-title', title))
  modal.appendChild(el('div', 'selection-modal-desc', t('Archived sessions will be hidden from the list.')))
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
  selectionModal = { overlay, busy: false }
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

/** 确认归档：请求已发出 → busy（按钮禁用 + 标题“正在归档”），等 archiveManyDone。 */
function confirmArchive(): void {
  if (!selectionModal || selectionModal.busy) return
  const ids = [...selectedSessionIds]
  if (ids.length === 0) return
  selectionModal.busy = true
  selectionModal.overlay.querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = true))
  const title = selectionModal.overlay.querySelector<HTMLElement>('.selection-modal-title')
  if (title) title.textContent = t('Archiving…')
  post({ type: 'sessionArchiveMany', sessionIds: ids })
}

/** 批量归档结果回执：成功项清出勾选并退出模式；失败项保留可重试。 */
function onArchiveManyDone(failed: string[]): void {
  closeSelectionModal()
  if (failed.length > 0) {
    const failedSet = new Set(failed)
    for (const id of [...selectedSessionIds]) {
      if (!failedSet.has(id)) selectedSessionIds.delete(id)
    }
    renderSessions()
    return
  }
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
  body.appendChild(
    menuItem(t('Fork session'), {
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
  body.appendChild(
    menuItem(t('Archive session'), {
      icon: iconSvg(PANEL_ICONS.archive),
      // 运行中/未读/待处理的会话归档后状态难追踪，置灰禁用。
      disabled: s.running || s.descendantRunning || s.unread || s.pendingInteraction !== undefined,
      disabledTip:
        s.pendingInteraction !== undefined
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

window.addEventListener('message', (event) => {
  const msg = event.data as ToWebviewMessage
  if (msg?.type === 'sessions' && msg.snapshot) {
    sessionsSnapshot = msg.snapshot
    currentSessionId = msg.snapshot.activeSessionId ?? null
    renderSessions()
  } else if (msg?.type === 'archiveManyDone' && Array.isArray(msg.failed)) {
    onArchiveManyDone(msg.failed)
  }
})

renderSessions()
