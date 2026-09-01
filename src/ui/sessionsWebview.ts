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
import { PANEL_ICONS, MESSAGE_ACTION_ICONS, type IconDef } from './chat/icons.ts'
import type { FromWebviewMessage, SessionsSnapshot, ToWebviewMessage } from '../pure/chatContract.ts'
import type { SessionNodeModel, SessionSortOrder, WorkspaceNodeModel } from '../pure/sessionTree.ts'
import { UNGROUPED_WORKSPACE_ID } from '../pure/sessionTree.ts'

interface VsCodeApi {
  postMessage(message: FromWebviewMessage): void
}
declare function acquireVsCodeApi(): VsCodeApi

const vscode = acquireVsCodeApi()
const app = document.getElementById('app') as HTMLElement

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

const sessionsPanel = el('aside', 'sessions-panel')
app.appendChild(sessionsPanel)

/* ---- 弹层（坐标 & 锚点两用） ---- */
let popover: HTMLElement | null = null
let popoverAnchor: HTMLElement | null = null
let popoverPlacement: 'above' | 'below' = 'above'
/** 菜单打开期间保持 hover 背景的来源行（会话行 ⋯ 菜单/右键菜单）。 */
let menuOpenRow: HTMLElement | null = null

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

function closePopover(): void {
  popover?.remove()
  popover = null
  popoverAnchor = null
  markMenuRow(null)
  document.removeEventListener('mousedown', onPopoverOutside, true)
  document.removeEventListener('keydown', onPopoverKey, true)
}

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
  closePopover()
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
  closePopover()
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
  SPIN_CELLS.forEach(([x, y], i) => {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    rect.setAttribute('x', String(x))
    rect.setAttribute('y', String(y))
    rect.setAttribute('width', '2')
    rect.setAttribute('height', '2')
    rect.style.animationDelay = `${(i - SPIN_CELLS.length) * 125}ms`
    svg.appendChild(rect)
  })
  return svg
}

/** 排序菜单选项，与 store 持久化的 SessionSortOrder 一一对应。 */
const SORT_OPTIONS: Array<{ order: SessionSortOrder; label: string }> = [
  { order: 'updatedDesc', label: '最近更新优先' },
  { order: 'updatedAsc', label: '最早更新优先' },
  { order: 'title', label: '按标题排序' },
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
  search.placeholder = '搜索会话'
  // 后端 session.search 只接受 1–500 字符；输入上限对齐，避免截断歧义。
  search.maxLength = 500
  search.value = sessionsSearchDraft
  // 一键清除 ✕：header 持久，按钮首建后只按 has-text toggle，不重建。
  const clearBtn = document.createElement('button')
  clearBtn.type = 'button'
  clearBtn.className = 'search-clear'
  clearBtn.setAttribute('aria-label', '清除搜索')
  clearBtn.setAttribute('data-tip', '清除搜索')
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
  const sortBtn = panelTool(strokeSvg(SORT_ICON, 16), '排序方式')
  sortBtn.addEventListener('click', () => openSortMenu(sortBtn))
  header.appendChild(sortBtn)
  const refreshBtn = panelTool(iconSvg(PANEL_ICONS.refresh, 12), '刷新会话列表')
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
  collapseAllBtn = panelTool(iconSvg(PANEL_ICONS.boxedMinus, 16), '折叠所有工作区')
  collapseAllBtn.addEventListener('click', () => {
    post({ type: computeAllCollapsed(sessionsSnapshot) ? 'workspacesExpandAll' : 'workspacesCollapseAll' })
  })
  header.appendChild(collapseAllBtn)
  const addBtn = panelTool(iconSvg(PANEL_ICONS.plus, 14), '添加工作区')
  addBtn.addEventListener('click', () => {
    const body = el('div')
    body.appendChild(
      menuItem('添加已有文件夹…', {
        icon: iconSvg(PANEL_ICONS.folderOpen),
        onClick: () => {
          closePopover()
          post({ type: 'workspaceAdd' })
        },
      }),
    )
    body.appendChild(
      menuItem('创建工作区…', {
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
  const tip = allCollapsed ? '展开所有工作区' : '折叠所有工作区'
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
  // 列表重建期间，销毁在编输入框触发的 blur 不应把编辑当取消（rebuildGuard）。
  rebuildInProgress = true
  const oldList = sessionsPanel.querySelector<HTMLElement>('.sessions-list')
  oldList?.remove()
  const list = el('div', 'sessions-list')
  if (!snap) {
    list.appendChild(el('div', 'sessions-empty', '加载中…'))
  } else if (snap.serverState !== 'running') {
    list.appendChild(renderServerEmpty(snap))
  } else if (snap.workspaces.length === 0) {
    const hint = snap.query ? `没有匹配「${snap.query}」的会话。` : '暂无工作区。点击上方 + 添加已有文件夹或创建工作区。'
    const box = el('div', 'sessions-empty')
    box.appendChild(el('div', 'empty-hint', hint))
    list.appendChild(box)
  } else {
    for (const w of snap.workspaces) list.appendChild(renderWorkspaceGroup(w))
    if (snap.contentSearchHasMore) {
      list.appendChild(el('div', 'sessions-search-more', '还有更多匹配会话，可尝试更精确的关键词'))
    }
  }
  // 内容搜索降级：后端索引未启用等导致全文搜索失败——给用户可见提示，不静默。
  if (snap && snap.query != null && snap.query !== '' && snap.contentSearchError) {
    const degraded = el(
      'div',
      'sessions-search-more sessions-search-degraded',
      '全文搜索不可用，仅按标题匹配（dsh 搜索索引未启用）',
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
    box.appendChild(el('div', 'empty-title', '未检测到 dsh 安装'))
    box.appendChild(el('div', 'empty-hint', '安装完成后回到这里即可自动启动。'))
    const btn = buttonEl(undefined, '查看安装指南')
    btn.addEventListener('click', () => post({ type: 'openInstallPage' }))
    box.appendChild(btn)
    return box
  }
  if (snap.serverState === 'starting') {
    box.appendChild(el('div', 'empty-hint', '正在启动 dsh 服务…'))
    return box
  }
  box.appendChild(el('div', 'empty-hint', 'dsh 服务未运行，暂无会话。'))
  const btn = buttonEl(undefined, '启动 dsh 服务')
  btn.addEventListener('click', () => post({ type: 'serverStart' }))
  box.appendChild(btn)
  return box
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
  if (pending > 0) appendCountBadge(counts, el('span', 'session-dot warning'), pending, '待交互')
  if (running > 0) appendCountBadge(counts, spinSvg(), running, '运行中')
  if (unread > 0) appendCountBadge(counts, el('span', 'session-dot completed'), unread, '未读')
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
  head.title = ungrouped ? '不属于任何工作区的会话' : w.path
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
  if (!ungrouped) {
    const headActions = el('span', 'row-actions')
    headActions.appendChild(
      rowAction(iconSvg(PANEL_ICONS.plus), '新建会话', () => post({ type: 'sessionNew', workspaceId: w.workspaceId })),
    )
    headActions.appendChild(
      rowAction(iconSvg(PANEL_ICONS.terminal), '在终端中打开', () =>
        post({ type: 'workspaceOpenTerminal', path: w.path }),
      ),
    )
    if (!w.isCurrent) {
      headActions.appendChild(
        rowAction(iconSvg(PANEL_ICONS.folderOpen), '在 VSCode 中打开文件夹', () =>
          post({ type: 'workspaceOpenFolder', path: w.path }),
        ),
      )
    }
    headActions.appendChild(
      rowAction(strokeSvg(TRASH_ICON, 16), '从列表移除', () =>
        post({ type: 'workspaceRemove', workspaceId: w.workspaceId, label: w.label }),
      ),
    )
    head.appendChild(headActions)
  }
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
        ? '等待审批'
        : s.pendingInteraction === 'plan-review'
          ? '计划待审'
          : '等待回答'
    slot.appendChild(dot)
  } else if (busy) slot.appendChild(spinSvg())
  else if (s.unread) slot.appendChild(el('span', 'session-dot completed'))
  else if (pinned) slot.appendChild(makePinIcon())
  row.appendChild(slot)
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
  const actions = el('span', 'row-actions')
  const more = rowAction(iconSvg(PANEL_ICONS.ellipsis), '更多操作', () => {
    showPopover(more, buildSessionMenuBody(s), 'below')
    markMenuRow(row)
  })
  actions.appendChild(more)
  row.appendChild(actions)
  // 情境化点击：editor 面板真实附着（attachedSessionId，非仅高亮的待附着
  // 目标）的会话 → 行内重命名；其他 → 打开会话。编辑中忽略行点击。
  row.addEventListener('click', () => {
    if (s.sessionId === editingSessionId) return
    if (sessionsSnapshot?.attachedSessionId === s.sessionId) startRowRename(s.sessionId, s.label)
    else post({ type: 'sessionOpen', sessionId: s.sessionId })
  })
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault()
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
  block.addEventListener('click', () => post({ type: 'sessionOpen', sessionId }))
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

/** 会话菜单内容（⋯ 按钮与右键菜单共用）。 */
function buildSessionMenuBody(s: SessionNodeModel): HTMLElement {
  const pinned = sessionsSnapshot?.pinned.includes(s.sessionId) ?? false
  const body = el('div')
  body.appendChild(
    menuItem('重命名', {
      icon: iconSvg(PANEL_ICONS.edit),
      onClick: () => {
        closePopover()
        post({ type: 'sessionRename', sessionId: s.sessionId, title: s.label })
      },
    }),
  )
  body.appendChild(
    menuItem(pinned ? '取消置顶' : '置顶', {
      icon: strokeSvg(PIN_ICON),
      checked: pinned,
      onClick: () => {
        closePopover()
        post({ type: 'sessionPin', sessionId: s.sessionId, pin: !pinned })
      },
    }),
  )
  body.appendChild(
    menuItem(s.unread ? '标为已读' : '标为未读', {
      icon: strokeSvg(UNREAD_ICON),
      checked: s.unread,
      // 运行中会话的手动未读语义混乱，置灰禁用（与行首 busy 判定一致）。
      disabled: s.running || s.descendantRunning,
      disabledTip: '运行中的会话不支持手动标为已读/未读',
      onClick: () => {
        closePopover()
        post({ type: 'sessionUnread', sessionId: s.sessionId, unread: !s.unread })
      },
    }),
  )
  body.appendChild(
    menuItem('分叉会话', {
      icon: iconSvg(MESSAGE_ACTION_ICONS.branch),
      // 列表级 fork 不带 atSeq，服务端回退到最后一个 turn/end 切点；会话
      // 从未完成过任何轮次（无 turn/end）会返回 fork-unavailable。这里在无
      // 完成轮次的会话上禁用（对齐官方「轮次未结束不出现 fork」）。
      disabled: !s.hasCompletedTurn,
      disabledTip: '会话没有已完成轮次，无法分叉',
      onClick: () => {
        closePopover()
        post({ type: 'sessionFork', sessionId: s.sessionId })
      },
    }),
  )
  body.appendChild(
    menuItem('复制引用', {
      icon: iconSvg(MESSAGE_ACTION_ICONS.copy),
      onClick: () => {
        closePopover()
        post({ type: 'sessionCopyReference', sessionId: s.sessionId, title: s.label })
      },
    }),
  )
  body.appendChild(
    menuItem('归档会话', {
      icon: iconSvg(PANEL_ICONS.archive),
      // 运行中/未读/待处理的会话归档后状态难追踪，置灰禁用。
      disabled: s.running || s.descendantRunning || s.unread || s.pendingInteraction !== undefined,
      disabledTip:
        s.pendingInteraction !== undefined
          ? '待处理的会话不能归档'
          : s.running || s.descendantRunning
            ? '运行中的会话不能归档'
            : '未读的会话不能归档',
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
  }
})

renderSessions()
