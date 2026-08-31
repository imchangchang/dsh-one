/**
 * Chat webview frontend: renders ChatState snapshots pushed by the host
 * (src/ui/chatView.ts) and posts user actions back (FromWebviewMessage).
 * Runs in the webview's browser context; esbuild bundles it (marked +
 * dompurify inlined) to dist/chatWebview.js. Rendering is a full rebuild per
 * snapshot — the host throttles pushes, so this stays cheap for a skeleton.
 */
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { MESSAGE_ACTION_ICONS, PANEL_ICONS, type IconDef } from './icons.ts'
import type {
  ChatAssistantMessage,
  ChatBlock,
  ChatFile,
  ChatImage,
  ChatMessage,
  ChatState,
  ChatToolBlock,
  FromWebviewMessage,
  ModelCatalog,
  OutgoingImage,
  PendingApproval,
  PendingQuestion,
  QueuedItem,
  SessionsSnapshot,
  StagedFile,
  ToWebviewMessage,
} from '../../pure/chatContract.ts'
import type { SessionNodeModel, SessionSortOrder, WorkspaceNodeModel } from '../../pure/sessionTree.ts'
import { formatRelativeTime, UNGROUPED_WORKSPACE_ID } from '../../pure/sessionTree.ts'
import { meterLevel } from '../../pure/contextMeter.ts'
import { isCommandTool, toolAction, truncateLines } from '../../pure/toolLine.ts'
import {
  formatJobDuration,
  isLiveJob,
  jobDotState,
  jobStatusLabel,
  jobsChipLabel,
  type ActivityJob,
} from '../../pure/activityTree.ts'
import { attachmentDataUrl, isImageMediaType } from '../../pure/composerAttachment.ts'
import { formatDuration } from '../../pure/sessionStats.ts'

interface VsCodeApi {
  postMessage(message: FromWebviewMessage): void
}
declare function acquireVsCodeApi(): VsCodeApi

const vscode = acquireVsCodeApi()
const app = document.getElementById('app') as HTMLElement

marked.setOptions({ gfm: true, breaks: true })

let state: ChatState | null = null
/** Auto-scroll only when the user is already near the bottom. */
let stickToBottom = true
/**
 * ScrollTop the last render left behind. Compared against the live position
 * at the next render to detect user scrolls synchronously — the scroll event
 * dispatches asynchronously and would otherwise race with streaming renders.
 */
let pinnedScrollTop: number | null = null
/** Signature of the composer-relevant state at the last render; see render(). */
let lastComposerSig: string | null = null
/** Images staged in the composer, sent with the next `send`. */
let pendingImages: OutgoingImage[] = []
/** Non-image files staged as chips; their paths join the prompt text on send. */
let pendingFiles: StagedFile[] = []
/** Session the staged images belong to; a switch drops them. */
let stagedForSession: string | null = null
/** Latest model catalog reply; dropped on session switch, refetched on menu open. */
let modelCatalog: ModelCatalog | null = null
/** Attachment id → data URL, filled by attachmentData replies; lives for the webview's lifetime. */
const attachmentCache = new Map<string, string>()
/** Attachment ids already requested, so re-renders don't repost while a fetch is in flight. */
const attachmentRequested = new Set<string>()
/** Half-answered pending questions: rpcId → question index → draft. */
const answerDrafts = new Map<string, Map<number, QuestionDraft>>()

/**
 * Static mirror of dsh's built-in slash commands (the host's commands/list RPC
 * serves the same six; `model` below is our own submenu entry — the host has
 * no /model command). Commands execute via commands/execute, not session.prompt.
 * `hint` mirrors the host's input hint and drives the composer's arg hints.
 */
const SLASH_COMMANDS: Array<{ name: string; description: string; hint?: string }> = [
  { name: 'compact', description: '压缩较早的会话历史' },
  { name: 'export', description: '导出本会话日志（ZIP）' },
  { name: 'feedback', description: '记录本会话反馈', hint: '<text>' },
  { name: 'goal', description: '设置或查看长任务目标', hint: '[<objective>|clear|edit <objective>|pause|resume]' },
  { name: 'permission', description: '切换权限预设', hint: '<preset>' },
  { name: 'plan', description: '进入或退出计划模式', hint: '[off|message]' },
  { name: 'model', description: '选择本会话使用的模型' },
]
/** Commands the composer's slash completion offers; `/model` is client-side (the send path intercepts it and opens the model menu, like the official web client). */
const COMPLETABLE_COMMANDS = SLASH_COMMANDS

/** Shield glyphs copied verbatim from dsh-client-ui-conversation's PermissionSelect. */
const SHIELD_OUTLINE =
  'M8.20554 0.899994L14.7901 3.36857V7.01026C14.7901 12 11.0466 14.2103 8.20554 15.3C5.36446 14.2103 1.62012 12 1.62012 7.01026V3.36857L8.20554 0.899994Z'
const PERMISSION_GLYPHS: Record<string, string> = {
  'read-only': `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="${SHIELD_OUTLINE}" stroke="currentColor" stroke-width="1.31831" stroke-linejoin="round"/><path d="M12.1654 5.7552L8.9447 9.41475C8.73044 9.65816 8.53628 9.8804 8.35774 10.0423C8.1713 10.2114 7.94235 10.3717 7.64016 10.4254C7.48207 10.4535 7.32 10.4552 7.16151 10.4294C6.85843 10.3801 6.62728 10.2223 6.43836 10.0559C6.25752 9.89653 6.06037 9.67732 5.84264 9.43705L4.72925 8.20897L5.63557 7.38707L6.74897 8.61594C6.98603 8.87755 7.12974 9.03533 7.24673 9.13839C7.31033 9.19443 7.34485 9.21476 7.35823 9.22122C7.38068 9.22484 7.40352 9.22515 7.42593 9.22122C7.40522 9.22502 7.42893 9.23294 7.53583 9.136C7.65132 9.03126 7.79316 8.87139 8.02643 8.60638L11.2479 4.94763L12.1654 5.7552Z" fill="currentColor"/></svg>`,
  'workspace-write': `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8.08887 0.251709C8.20479 0.23085 8.32486 0.241168 8.43652 0.282959L15.0215 2.75171C15.2787 2.84819 15.4492 3.09414 15.4492 3.3689V7.0105C15.4492 7.10986 15.4441 7.2081 15.4414 7.30542C15.0285 7.07175 14.5905 6.87695 14.1309 6.73022V3.82495L8.20508 1.60327L2.2793 3.82495V7.0105C2.27936 9.7171 3.4745 11.5379 5.02734 12.7947C5.01025 12.9942 5 13.1962 5 13.4001C5.00001 13.7617 5.02722 14.1169 5.08008 14.4636C2.91555 13.0393 0.961014 10.752 0.960938 7.0105V3.3689C0.960938 3.09417 1.13146 2.84821 1.38867 2.75171L7.97461 0.282959L8.08887 0.251709Z" fill="currentColor"/><path d="M11.3525 5.64688V6.85688H5V5.64688H11.3525Z" fill="currentColor"/><path d="M9.5824 8.29376V9.50376H5V8.29376H9.5824Z" fill="currentColor"/><path d="M14.6647 15.6852H10.0338C10.3878 15.3751 10.7567 15.0517 11.0772 14.7706C11.2531 14.6164 11.4144 14.4746 11.5511 14.3547H14.6647V15.6852Z" fill="currentColor"/><path d="M8.14852 14.1308L7.33925 15.4976C7.22458 15.6912 7.42245 15.9194 7.63037 15.8333L9.09785 15.2254L15.0399 10.0719L14.0905 8.97733L8.14852 14.1308Z" fill="currentColor"/></svg>`,
  'danger-full-access': `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="${SHIELD_OUTLINE}" stroke="currentColor" stroke-width="1.31831" stroke-linejoin="round"/><path d="M9.10094 4.5V8.75939H7.59888V4.5H9.10094Z" fill="currentColor"/><path d="M9.10094 9.8114V11.5H7.59888V9.8114H9.10094Z" fill="currentColor"/></svg>`,
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

/** Icon-only ghost button matching the dsh web UI's message action style. */
function iconButton(icon: IconDef, title: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'icon-action'
  b.title = title
  b.setAttribute('aria-label', title)
  b.appendChild(iconSvg(icon))
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

function md(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { async: false }))
}

// 布局骨架：左 sessions 面板 + 右聊天列（窄屏改上下，样式见 chatView.ts 的
// STYLE 媒体查询）。两个区域独立重建：聊天快照走 render()，会话快照走
// renderSessions()，互不打扰（面板重建不应打断 composer 的 IME 输入）。
const sessionsPanel = el('aside', 'sessions-panel')
const chatCol = el('div', 'chat-col')
app.appendChild(sessionsPanel)
app.appendChild(chatCol)

/** 最新 sessions 快照；null = 尚未收到（面板显示占位）。 */
let sessionsSnapshot: SessionsSnapshot | null = null
/** 搜索框草稿，跨面板重建保留（同 composer 的 draft 模式）。 */
let sessionsSearchDraft = ''
/** 搜索输入的防抖计时器。 */
let searchDebounce: ReturnType<typeof setTimeout> | null = null

window.addEventListener('message', (event) => {
  const msg = event.data as ToWebviewMessage
  if (msg?.type === 'state' && msg.state) {
    state = msg.state
    if (state.sessionId !== stagedForSession) {
      pendingImages = []
      pendingFiles = []
      modelCatalog = null
      commandNotices = []
      recall = null
      recallDraft = ''
      stagedForSession = state.sessionId
    }
    render()
  } else if (msg?.type === 'sessions' && msg.snapshot) {
    sessionsSnapshot = msg.snapshot
    renderSessions()
  } else if (msg?.type === 'commandResult' && typeof msg.text === 'string' && msg.text.trim()) {
    commandNotices = [...commandNotices, msg.text]
    render()
  } else if (msg?.type === 'imagesPicked' && Array.isArray(msg.images)) {
    pendingImages = [...pendingImages, ...msg.images]
    render()
  } else if (msg?.type === 'filesPicked' && Array.isArray(msg.files)) {
    pendingFiles = [...pendingFiles, ...msg.files]
    render()
  } else if (msg?.type === 'modelCatalog' && msg.catalog) {
    modelCatalog = msg.catalog
    if (modelMenuBody) renderModelMenuRoot(modelMenuBody, msg.catalog)
  } else if (msg?.type === 'attachmentData' && typeof msg.attachmentId === 'string') {
    const dataUrl = `data:${msg.mediaType};base64,${msg.data}`
    attachmentCache.set(msg.attachmentId, dataUrl)
    if (pendingPreview === msg.attachmentId) {
      pendingPreview = null
      openLightbox(dataUrl)
    }
  } else if (msg?.type === 'restoreDraft' && typeof msg.text === 'string') {
    // Texts of queue items drained by stop: back into the composer as drafts.
    const input = document.getElementById('input') as HTMLTextAreaElement | null
    if (input) {
      input.value = input.value.trim() ? `${input.value.trimEnd()}\n${msg.text}` : msg.text
      input.dispatchEvent(new Event('input'))
      input.focus()
    } else {
      stashedDraft = stashedDraft ? `${stashedDraft}\n${msg.text}` : msg.text
    }
  }
})

/**
 * Esc / Ctrl+C 打断当前 turn，等价于点「停止」按钮。优先级最低：
 * 弹层、图片预览（capture 阶段）与斜杠补全、草稿召回、重命名输入
 * （元素自身的 bubble 阶段）都先消费 Esc 并 preventDefault，这里靠
 * defaultPrevented 让路。本处理器挂在 document 的 bubble 阶段，
 * 保证最后执行。Ctrl+C 在有选区（输入框内或页面上）时保持复制语义。
 */
document.addEventListener('keydown', (e) => {
  if (!state?.running) return
  if (e.key === 'Escape') {
    if (e.defaultPrevented) return
    e.preventDefault()
    post({ type: 'stop' })
    return
  }
  if (e.key === 'c' && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    const active = document.activeElement
    const fieldSelection =
      (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) &&
      active.selectionStart !== null &&
      active.selectionStart !== active.selectionEnd
    const sel = window.getSelection()
    const pageSelection = !!sel && !sel.isCollapsed && sel.toString() !== ''
    if (fieldSelection || pageSelection) return
    post({ type: 'stop' })
  }
})

/** Open composer popover; attached to document.body so it survives render(). */
let popover: HTMLElement | null = null
/** Anchor the open popover tracks; renders re-anchor or close on disconnect. */
let popoverAnchor: HTMLElement | null = null
let popoverPlacement: 'above' | 'below' = 'above'
/** Body of the open model menu awaiting the catalog reply. */
let modelMenuBody: HTMLElement | null = null
/** 菜单打开期间保持 hover 背景的来源行（会话行的 ⋯ 菜单/右键菜单）。 */
let menuOpenRow: HTMLElement | null = null
/** 后台任务下拉的耗时 tick（打开且有运行中行时挂上，关闭弹层时清理）。 */
let jobsTick: ReturnType<typeof setInterval> | null = null

function markMenuRow(row: HTMLElement | null): void {
  menuOpenRow?.classList.remove('menu-open')
  menuOpenRow = row
  menuOpenRow?.classList.add('menu-open')
}

function onPopoverOutside(e: MouseEvent): void {
  if (popover && !popover.contains(e.target as Node)) closePopover()
}

function onPopoverKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    // 消费掉这次 Esc：弹层优先于全局「Esc 打断 turn」（后者按 defaultPrevented 让路）。
    e.preventDefault()
    closePopover()
  }
}

function closePopover(): void {
  popover?.remove()
  popover = null
  popoverAnchor = null
  modelMenuBody = null
  markMenuRow(null)
  if (jobsTick !== null) {
    clearInterval(jobsTick)
    jobsTick = null
  }
  document.removeEventListener('mousedown', onPopoverOutside, true)
  document.removeEventListener('keydown', onPopoverKey, true)
}

/** (Re)position the open popover from its anchor's live rect. */
function positionPopover(): void {
  if (!popover || !popoverAnchor) return
  const rect = popoverAnchor.getBoundingClientRect()
  // Keep the popover inside the viewport: anchors near the right edge (e.g.
  // the context bar at the end of the stats row) would otherwise clip the
  // panel's right-hand figures off-screen.
  const left = Math.min(rect.left, window.innerWidth - popover.offsetWidth - 4)
  popover.style.left = `${Math.max(4, left)}px`
  // 锚点在面板顶部（sessions 头部的排序按钮）时向下展开，否则保持向上。
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

/**
 * 坐标定位的弹层（右键菜单）：固定在鼠标位置并钳制在视口内。
 * popoverAnchor 置为 null —— render()/renderSessions() 的存活检查
 * 对无锚点弹层保持不动（不关闭、不 reposition）。
 */
function showPopoverAt(x: number, y: number, body: HTMLElement): void {
  closePopover()
  const p = el('div', 'popover')
  p.appendChild(body)
  document.body.appendChild(p) // 先挂到 DOM 才能量尺寸
  popover = p
  popoverAnchor = null
  const left = Math.min(x, window.innerWidth - p.offsetWidth - 4)
  const top = Math.min(y, window.innerHeight - p.offsetHeight - 4)
  p.style.left = `${Math.max(4, left)}px`
  p.style.top = `${Math.max(4, top)}px`
  document.addEventListener('mousedown', onPopoverOutside, true)
  document.addEventListener('keydown', onPopoverKey, true)
}

/**
 * Slash-command completion popup (kimi-code / Claude Code style): while the
 * composer value starts with '/', lists matching commands above the input,
 * then argument completions (/permission presets) or the host's arg hint.
 * Distinct from the shared menu popover: it survives renders that keep the
 * composer and is refreshed by the input event instead of clicks.
 */
interface SlashRow {
  label: string
  right?: string
  /** Complete the line; absent on pure hint rows. */
  apply?: (input: HTMLTextAreaElement) => void
}

let slashPopupEl: HTMLElement | null = null
let slashRows: SlashRow[] = []
let slashIndex = 0

function hideSlashPopup(): void {
  slashPopupEl?.remove()
  slashPopupEl = null
  slashRows = []
  slashIndex = 0
}

function positionSlashPopup(input: HTMLTextAreaElement): void {
  if (!slashPopupEl) return
  const rect = input.getBoundingClientRect()
  slashPopupEl.style.left = `${Math.max(4, rect.left)}px`
  slashPopupEl.style.width = `${rect.width}px`
  slashPopupEl.style.bottom = `${window.innerHeight - rect.top + 6}px`
}

/** Recompute the rows from the current value; hide when nothing applies. */
function updateSlashPopup(input: HTMLTextAreaElement): void {
  slashRows = computeSlashRows(input)
  if (slashRows.length === 0) {
    hideSlashPopup()
    return
  }
  slashIndex = slashRows.findIndex((r) => r.apply !== undefined)
  if (!slashPopupEl) {
    slashPopupEl = el('div', 'popover slash-popup')
    document.body.appendChild(slashPopupEl)
  }
  slashPopupEl.textContent = ''
  slashRows.forEach((row, i) => {
    const item = el('div', i === slashIndex ? 'menu-item selected' : 'menu-item')
    item.appendChild(el('span', undefined, row.label))
    if (row.right) item.appendChild(el('span', 'menu-right', row.right))
    if (row.apply) {
      // mousedown + preventDefault: completing must not blur the textarea.
      item.addEventListener('mousedown', (e) => {
        e.preventDefault()
        row.apply?.(input)
      })
    } else {
      item.classList.add('hint-row')
    }
    slashPopupEl?.appendChild(item)
  })
  positionSlashPopup(input)
}

function moveSlashSelection(dir: number): void {
  if (!slashPopupEl || slashRows.length === 0) return
  const selectable = slashRows.map((r, i) => (r.apply ? i : -1)).filter((i) => i >= 0)
  if (selectable.length === 0) return
  const at = selectable.indexOf(slashIndex)
  slashIndex = selectable[(at + dir + selectable.length) % selectable.length]
  slashPopupEl.querySelectorAll('.menu-item').forEach((item, i) => {
    item.classList.toggle('selected', i === slashIndex)
  })
}

/** Rows for the current composer value: command names, preset args, or one hint row. */
function computeSlashRows(input: HTMLTextAreaElement): SlashRow[] {
  const value = input.value
  if (!value.startsWith('/') || value.includes('\n')) return []
  /** Filling the value and dispatching `input` re-enters updateSlashPopup. */
  const complete = (text: string) => () => {
    input.value = text
    input.focus()
    input.setSelectionRange(text.length, text.length)
    input.dispatchEvent(new Event('input'))
  }
  const sp = value.indexOf(' ')
  if (sp === -1) {
    const filter = value.slice(1).toLowerCase()
    if (filter.includes(' ')) return []
    return COMPLETABLE_COMMANDS.filter((c) => c.name.startsWith(filter)).map((c) => ({
      label: `/${c.name}`,
      right: c.description,
      apply: complete(`/${c.name} `),
    }))
  }
  const name = value.slice(1, sp)
  const argPrefix = value.slice(sp + 1)
  if (name === 'permission') {
    const options = state?.permissions?.options ?? []
    return options
      .filter((o) => o.value !== argPrefix && (o.value.startsWith(argPrefix) || o.label.toLowerCase().includes(argPrefix.toLowerCase())))
      .map((o) => ({ label: o.label, right: o.value, apply: complete(`/permission ${o.value}`) }))
  }
  const cmd = COMPLETABLE_COMMANDS.find((c) => c.name === name)
  if (cmd?.hint) return [{ label: `参数：${cmd.hint}` }]
  return []
}

/** Compact token count: 517 / 12.2K / 517K / 1.2M (dsh-web's formatTokens). */
function formatTokens(n: number): string {
  const scaled = (v: number): string => (v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10))
  if (n < 1e3) return String(n)
  if (n < 1e6) return `${scaled(n / 1e3)}K`
  return `${scaled(n / 1e6)}M`
}

/** Breakdown legend, in bar-segment order (dsh-web ContextMeter rows). */
const CONTEXT_ROWS: Array<{ key: 'systemTokens' | 'toolsTokens' | 'messageTokens'; label: string; color: string }> = [
  { key: 'systemTokens', label: '系统提示词', color: '#8b9bb4' },
  { key: 'toolsTokens', label: '工具', color: '#a78bfa' },
  { key: 'messageTokens', label: '对话消息', color: '#5a9cf8' },
]

/** Occupancy bar at the stats row's right end; hidden until the first sample. */
function contextBar(): HTMLElement {
  const bar = buttonEl('context-bar', '')
  const track = el('span', 'context-bar-track')
  track.appendChild(el('span', 'context-bar-fill'))
  bar.appendChild(track)
  bar.addEventListener('click', () => openContextPanel(bar))
  return bar
}

/** Patch the bar in place (both initial render and kept-composer updates). */
function patchContextBar(bar: HTMLElement, usage: ChatState['contextUsage']): void {
  bar.style.display = usage ? '' : 'none'
  if (!usage) return
  // 按剩余轮数分级变色（src/pure/contextMeter.ts）：充足绿 / <10 轮黄 / <5 轮红 / 超窗口红。
  const meter = meterLevel(usage.usedTokens, usage.contextWindow, usage.turns)
  bar.classList.remove('level-ok', 'level-warn', 'level-danger', 'level-overflow')
  bar.classList.add(`level-${meter.level}`)
  bar.title = `上下文已用 ${usage.percent}%（~${formatTokens(usage.usedTokens)} / ${formatTokens(usage.contextWindow)}）${
    meter.level === 'overflow' ? '；已超出当前模型窗口' : ''
  }`
  const fill = bar.querySelector<HTMLElement>('.context-bar-fill')
  if (fill) fill.style.width = `${usage.percent}%`
}

/** Stats row at the composer's foot: stats line left, occupancy bar right. */
function statsRow(statsLine: string | undefined, usage: ChatState['contextUsage']): HTMLElement {
  const row = el('div', 'stats-row')
  row.appendChild(el('div', 'input-stats', statsLine ?? ''))
  const bar = contextBar()
  patchContextBar(bar, usage)
  row.appendChild(bar)
  return row
}

/** In-place stats-row update for the kept-composer path (no rebuild). */
function patchStatsRow(composer: HTMLElement, statsLine: string | undefined, usage: ChatState['contextUsage']): void {
  let row = composer.querySelector<HTMLElement>('.stats-row')
  if (!statsLine && !usage) {
    row?.remove()
    return
  }
  if (!row) {
    row = statsRow(undefined, undefined)
    composer.appendChild(row)
  }
  const stats = row.querySelector<HTMLElement>('.input-stats')
  if (stats) stats.textContent = statsLine ?? ''
  const bar = row.querySelector<HTMLElement>('.context-bar')
  if (bar) patchContextBar(bar, usage)
}

/** Click-open panel next to the ring: occupancy figure plus the breakdown bars. */
function openContextPanel(anchor: HTMLElement): void {
  const usage = state?.contextUsage
  if (!usage) return
  const body = el('div', 'context-panel')
  const header = el('div', 'cp-header')
  header.appendChild(el('span', 'cp-percent', `上下文已用 ${usage.percent}%`))
  header.appendChild(
    el('span', 'cp-figures', `~${formatTokens(usage.usedTokens)} / ${formatTokens(usage.contextWindow)}`),
  )
  body.appendChild(header)
  const meter = meterLevel(usage.usedTokens, usage.contextWindow, usage.turns)
  if (meter.level === 'overflow') {
    body.appendChild(
      el('div', 'cp-overflow', '上下文已超出当前模型窗口：建议先切回之前的模型执行 /compact 压缩，再切换模型。'),
    )
  }
  const breakdown = usage.breakdown
  if (breakdown) {
    const bar = el('div', 'cp-bar')
    const rows = el('div', 'cp-rows')
    for (const rowDef of CONTEXT_ROWS) {
      const value = breakdown[rowDef.key]
      const segment = el('span', 'cp-seg')
      segment.style.background = rowDef.color
      segment.style.width = `${Math.min(100, (value / usage.contextWindow) * 100)}%`
      bar.appendChild(segment)
      const row = el('div', 'cp-row')
      const swatch = el('span', 'cp-swatch')
      swatch.style.background = rowDef.color
      row.appendChild(swatch)
      row.appendChild(el('span', undefined, rowDef.label))
      row.appendChild(el('span', 'cp-value', `~${formatTokens(value)}`))
      rows.appendChild(row)
    }
    body.appendChild(bar)
    body.appendChild(rows)
  }
  // 实时预估：平均每轮增长 usedTokens/turns，换算剩余轮数（口径见 contextMeter.ts）。
  if (meter.perTurn !== null && meter.turnsLeft !== null) {
    body.appendChild(
      el('div', 'cp-estimate', `预估 ≈${formatTokens(meter.perTurn)}/轮，约还可持续 ${meter.turnsLeft} 轮`),
    )
  }
  showPopover(anchor, body)
}

function menuItem(
  label: string,
  opts: { right?: string; checked?: boolean; glyph?: string; icon?: SVGSVGElement; onClick: () => void },
): HTMLElement {
  const item = el('div', opts.checked ? 'menu-item checked' : 'menu-item')
  if (opts.glyph) {
    const g = el('span', 'glyph')
    g.innerHTML = opts.glyph // build-time constant strings, not user input
    item.appendChild(g)
  }
  // 左侧图标位（dsh web 菜单模式）：调用方预先渲染好 SVG。
  if (opts.icon) {
    const ic = el('span', 'menu-item-icon')
    ic.appendChild(opts.icon)
    item.appendChild(ic)
  }
  item.appendChild(el('span', undefined, label))
  if (opts.right) item.appendChild(el('span', 'menu-right', opts.right))
  // 选中态 check 放尾部（dsh web 模式），未选中不渲染。
  if (opts.checked) item.appendChild(el('span', 'check', '✓'))
  item.addEventListener('click', opts.onClick)
  return item
}

function openPermissionMenu(anchor: HTMLElement): void {
  const perms = state?.permissions
  if (!perms) return
  const body = el('div')
  for (const o of perms.options) {
    body.appendChild(
      menuItem(o.label, {
        glyph: PERMISSION_GLYPHS[o.value],
        checked: o.value === perms.current,
        onClick: () => {
          closePopover()
          if (o.value !== perms.current) post({ type: 'setPermission', value: o.value })
        },
      }),
    )
  }
  showPopover(anchor, body)
}

function openModelMenu(anchor: HTMLElement): void {
  const body = el('div')
  showPopover(anchor, body)
  modelMenuBody = body
  if (modelCatalog) {
    renderModelMenuRoot(body, modelCatalog)
  } else {
    body.appendChild(el('div', 'menu-hint', '加载中…'))
  }
  // Always refetch so the menu reflects the server's current selection.
  post({ type: 'requestModels' })
}

function renderModelMenuRoot(body: HTMLElement, catalog: ModelCatalog): void {
  body.textContent = ''
  const model = catalog.groups
    .find((g) => g.id === catalog.current.provider)
    ?.models.find((m) => m.id === catalog.current.model)
  body.appendChild(
    menuItem('模型', {
      right: `${model?.name ?? catalog.current.model} ›`,
      onClick: () => renderModelMenuModels(body, catalog),
    }),
  )
  const efforts = model?.efforts ?? []
  if (efforts.length > 0) {
    const effortId = catalog.current.reasoningEffort ?? model?.defaultEffort
    const effort = efforts.find((e) => e.id === effortId)
    body.appendChild(
      menuItem('推理等级', {
        right: `${effort?.name ?? effortId ?? '默认'} ›`,
        onClick: () => renderModelMenuEfforts(body, catalog),
      }),
    )
  }
}

function renderModelMenuModels(body: HTMLElement, catalog: ModelCatalog): void {
  body.textContent = ''
  body.appendChild(menuItem('‹ 返回', { onClick: () => renderModelMenuRoot(body, catalog) }))
  for (const g of catalog.groups) {
    body.appendChild(el('div', 'menu-group', g.name))
    for (const m of g.models) {
      const isCurrent = catalog.current.provider === g.id && catalog.current.model === m.id
      body.appendChild(
        menuItem(m.name, {
          checked: isCurrent,
          onClick: () => {
            closePopover()
            if (isCurrent) return
            // Keep the current effort only when the new model supports it.
            const keep = m.efforts.some((e) => e.id === catalog.current.reasoningEffort)
            post({
              type: 'setModel',
              provider: g.id,
              model: m.id,
              reasoningEffort: keep ? catalog.current.reasoningEffort : undefined,
            })
          },
        }),
      )
    }
  }
}

function renderModelMenuEfforts(body: HTMLElement, catalog: ModelCatalog): void {
  body.textContent = ''
  body.appendChild(menuItem('‹ 返回', { onClick: () => renderModelMenuRoot(body, catalog) }))
  const model = catalog.groups
    .find((g) => g.id === catalog.current.provider)
    ?.models.find((m) => m.id === catalog.current.model)
  const effortId = catalog.current.reasoningEffort ?? model?.defaultEffort
  for (const e of model?.efforts ?? []) {
    body.appendChild(
      menuItem(e.name, {
        right: e.description,
        checked: e.id === effortId,
        onClick: () => {
          closePopover()
          if (e.id !== catalog.current.reasoningEffort) {
            post({
              type: 'setModel',
              provider: catalog.current.provider,
              model: catalog.current.model,
              reasoningEffort: e.id,
            })
          }
        },
      }),
    )
  }
}

/** 头部「N 个子代理」chip 的下拉：每行标题 + 第二行摘要（相对时间 · token 用量）。 */
function openSubagentMenu(anchor: HTMLElement): void {
  const subs = state?.runningSubagents
  if (!subs || subs.length === 0) return
  const body = el('div')
  for (const sub of subs) {
    const item = el('div', 'menu-item preset-item')
    const main = el('div', 'preset-item-main')
    main.appendChild(el('div', 'preset-item-name', sub.title))
    const summary = [
      formatRelativeTime(sub.updatedAt, Date.now()),
      sub.totalTokens !== undefined ? `${formatTokens(sub.totalTokens)} tok` : '',
    ]
      .filter(Boolean)
      .join(' · ')
    main.appendChild(el('div', 'preset-item-desc', summary))
    item.appendChild(main)
    item.addEventListener('click', () => {
      closePopover()
      post({ type: 'sessionOpen', sessionId: sub.sessionId })
    })
    body.appendChild(item)
  }
  // 锚点在头部，向下展开。
  showPopover(anchor, body, 'below')
}

/**
 * 头部「N 个后台任务运行中」chip 的下拉（对齐官方 JobListAction 菜单）：
 * 每行 状态点（运行中像素环/完成绿/取消琥珀/失败红）+ kind 徽标 + 命令摘要
 * + 状态文案（detail 优先，如 "exit code: 0"）+ 耗时；已结束行淡化。
 */
function openJobsMenu(anchor: HTMLElement): void {
  const jobs = state?.backgroundJobs
  if (!jobs || jobs.length === 0) return
  const now = Date.now()
  const body = el('div', 'jobs-menu')
  for (const job of jobs) body.appendChild(renderJobsMenuRow(job, now))
  showPopover(anchor, body, 'below')
  // 有运行中的行时挂 1s tick，只改写耗时文本节点（closePopover 统一清理）。
  if (jobs.some(isLiveJob)) {
    jobsTick = setInterval(() => {
      popover?.querySelectorAll<HTMLElement>('[data-job-live-start]').forEach((t) => {
        t.textContent = formatJobDuration(Date.now() - Number(t.dataset.jobLiveStart))
      })
    }, 1000)
  }
}

/** 下拉里的一行 job；now 由调用方取一次，保证同一帧渲染的行耗时一致。 */
function renderJobsMenuRow(job: ActivityJob, now: number): HTMLElement {
  const live = isLiveJob(job)
  const row = el('div', live ? 'jobs-menu-row' : 'jobs-menu-row settled')
  const slot = el('span', 'job-dot-slot')
  const dot = jobDotState(job.status)
  if (dot === 'ongoing') slot.appendChild(spinSvg())
  else slot.appendChild(el('span', `job-dot ${dot}`))
  row.appendChild(slot)
  row.appendChild(el('span', 'job-kind', job.kind))
  const label = el('span', 'job-label', job.label)
  label.title = job.label
  row.appendChild(label)
  const statusText = job.detail ?? jobStatusLabel(job.status)
  const status = el('span', 'job-status', statusText)
  status.title = statusText
  row.appendChild(status)
  const duration = el('span', 'job-duration')
  if (live) {
    duration.dataset.jobLiveStart = String(job.startedAt)
    duration.textContent = formatJobDuration(now - job.startedAt)
    duration.title = `已运行 ${duration.textContent}`
  } else {
    duration.textContent = formatJobDuration((job.finishedAt ?? job.startedAt) - job.startedAt)
    duration.title = `耗时 ${duration.textContent}`
  }
  row.appendChild(duration)
  return row
}

/** Agent preset 下拉：一行一个选项（名称 + 描述），当前选中打勾；风格沿用权限/模型选择器。 */
function openAgentPresetMenu(anchor: HTMLElement, placement: 'above' | 'below' = 'above'): void {
  const ap = state?.agentPreset
  if (!ap) return
  const body = el('div')
  for (const opt of ap.options) {
    const checked = opt.id === ap.current
    const item = el('div', checked ? 'menu-item checked preset-item' : 'menu-item preset-item')
    const main = el('div', 'preset-item-main')
    main.appendChild(el('div', 'preset-item-name', opt.label))
    if (opt.description) main.appendChild(el('div', 'preset-item-desc', opt.description))
    item.appendChild(main)
    // 选中态 check 放尾部（dsh web 模式），仅 checked 时渲染。
    if (checked) item.appendChild(el('span', 'check', '✓'))
    item.addEventListener('click', () => {
      closePopover()
      if (!checked) post({ type: 'setAgentPreset', id: opt.id })
    })
    body.appendChild(item)
  }
  showPopover(anchor, body, placement)
}

function openCommandMenu(anchor: HTMLElement): void {  const body = el('div')
  for (const c of SLASH_COMMANDS) {
    body.appendChild(
      menuItem(`/${c.name}`, {
        right: c.description,
        onClick: () => {
          if (c.name === 'model') {
            openModelMenu(anchor)
            return
          }
          if (c.name === 'permission') {
            openPermissionMenu(anchor)
            return
          }
          closePopover()
          if (c.hint) {
            // Takes arguments: seed the composer token (the completion popup
            // then shows the arg hint) instead of firing a bare line.
            insertSlashCommand(c.name)
          } else {
            // No-argument commands execute right away, like the web client's
            // menu picks. The send path routes leading-slash lines to the
            // command channel.
            post({ type: 'send', text: `/${c.name}` })
          }
        },
      }),
    )
  }
  showPopover(anchor, body)
}

function insertSlashCommand(name: string): void {
  const input = document.getElementById('input') as HTMLTextAreaElement | null
  if (!input || input.disabled) return
  // Slash commands must lead the prompt; prepend ahead of any draft (its args).
  input.value = `/${name} ` + input.value
  input.focus()
  input.setSelectionRange(input.value.length, input.value.length)
  // The input event refreshes the send button, auto-grow, and the arg hint popup.
  input.dispatchEvent(new Event('input'))
}

/** Inline rename: swap the header title for an input; Enter commits, Esc/blur cancels. */
function startInlineRename(header: HTMLElement): void {
  const titleEl = header.querySelector('.chat-title')
  if (!titleEl || !state?.sessionId) return
  const original = state.sessionTitle ?? ''
  const input = document.createElement('input')
  input.className = 'rename-input'
  input.value = original
  titleEl.replaceWith(input)
  header.querySelector('.rename-session')?.remove()
  input.focus()
  input.select()
  let settled = false
  const cancel = (): void => {
    if (settled) return
    settled = true
    render()
  }
  input.addEventListener('keydown', (e) => {
    // isComposing: Enter confirms an IME candidate, not the rename.
    if (e.key === 'Enter' && !e.isComposing) {
      const title = input.value.trim()
      if (title && title !== original) post({ type: 'renameSession', title })
      cancel()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    }
  })
  input.addEventListener('blur', cancel)
}

function render(): void {
  // 当前附着会话的高亮跟随 ChatState，不走面板重建（避免打断悬停与搜索输入）。
  syncSessionHighlight()
  // The turn-status clock interval is owned by the row it updates; the rebuild
  // below discards that row, so drop the timer first and re-arm it later if
  // the turn is still open. Never leave an interval pointing at detached DOM.
  clearTurnStatusTimer()
  // <details> 展开状态按会话隔离：换会话时清空（key 是位置序号，跨会话无意义）。
  const detailsSid = state?.sessionId ?? null
  if (detailsSid !== detailsSession) {
    detailsOpen.clear()
    detailsSession = detailsSid
  }
  const oldInput = document.getElementById('input') as HTMLTextAreaElement | null
  const hadFocus = oldInput !== null && document.activeElement === oldInput
  const draft = oldInput?.value
  const inputSel = hadFocus ? { start: oldInput.selectionStart, end: oldInput.selectionEnd } : null
  // The rebuild wipes scroll state; remember it so a user reading history
  // mid-stream is not thrown back to the top. Also re-evaluate pinning from
  // the LIVE position whenever it moved away from where the last render left
  // it: scroll events dispatch asynchronously, so a streaming render running
  // on the stale stickToBottom would yank the view back to the bottom while
  // the user is scrolling up.
  const oldMessages = document.getElementById('messages')
  const prevScrollTop = oldMessages?.scrollTop ?? null
  if (oldMessages && (pinnedScrollTop === null || Math.abs(oldMessages.scrollTop - pinnedScrollTop) > 1)) {
    stickToBottom = oldMessages.scrollHeight - oldMessages.scrollTop - oldMessages.clientHeight < 40
  }
  // Same for the inline queue editor: it is rebuilt per snapshot, so keep
  // its focus and cursor across re-renders.
  const oldQueueEditor = document.querySelector<HTMLTextAreaElement>('.queue-editor')
  const queueFocus =
    oldQueueEditor && document.activeElement === oldQueueEditor
      ? { start: oldQueueEditor.selectionStart, end: oldQueueEditor.selectionEnd }
      : null
  // A recalled queue item claimed by the agent (or removed) drops the recall;
  // the text stays in the composer as a plain draft.
  const recallQueueId = recall?.kind === 'queue' ? recall.itemId : null
  if (recallQueueId && state && !(state.queue ?? []).some((q) => q.id === recallQueueId)) {
    recall = null
    recallDraft = ''
  }
  // Composer preservation: detaching the textarea (even re-appending it one
  // line later) aborts an in-flight IME composition and drops the caret, so
  // while the composer is focused we keep the live element in the DOM unless
  // composer-relevant state actually changed. The stats line is excluded from
  // the signature — it tracks the stream and is patched in place instead.
  const oldComposer = chatCol.querySelector<HTMLElement>('.input-area')
  const oldHero = chatCol.querySelector<HTMLElement>(':scope > .hero')
  // 空会话（无消息、无待办/队列/公告）按官方 dsh web 空态居中排版（hero 标题 +
  // workspace/preset chip 行 + 大圆角 composer 卡片）；开跑后回常规流式布局。
  const blankHero =
    state !== null &&
    state.sessionId !== null &&
    state.loading !== true &&
    state.messages.length === 0 &&
    !state.running &&
    state.pending.length === 0 &&
    (state.queue?.length ?? 0) === 0 &&
    (state.jobs?.length ?? 0) === 0 &&
    commandNotices.length === 0
  const composerSig = JSON.stringify([
    state?.sessionId ?? null,
    state?.canSend ?? false,
    state?.running ?? false,
    state?.permissions ?? null,
    state?.modelLabel ?? null,
    state?.agentPreset ?? null,
    state?.workspaceLabel ?? null,
    recall ? (recall.kind === 'queue' ? `queue:${recall.itemId}` : recall.kind) : null,
    pendingImages.map((i) => i.name ?? ''),
    pendingFiles.map((f) => f.path),
  ])
  // An open popover anchored inside the composer (permission/model menu) or the
  // hero chip row (blank-session preset picker) also pins the layout: rebuilding
  // would destroy the anchor and kill the menu mid-stream.
  const popoverInComposer =
    popover !== null &&
    popoverAnchor !== null &&
    ((oldComposer?.contains(popoverAnchor) ?? false) || (oldHero?.contains(popoverAnchor) ?? false))
  // 两种布局下 composer 的挂载位置不同（hero 内 / chatCol 直接子级），保留
  // 策略只在布局不变时生效，避免把已随旧布局拆除的 composer 当成存活锚点。
  const keepComposer =
    oldComposer !== null &&
    (hadFocus || popoverInComposer) &&
    stashedDraft === undefined &&
    composerSig === lastComposerSig &&
    (oldHero !== null && oldHero.contains(oldComposer)) === blankHero
  // A rebuilt composer gets fresh listeners; the popup re-opens below when the
  // draft still starts with '/'. With a kept composer it only re-anchors.
  if (!keepComposer) hideSlashPopup()
  // The scroller element also persists (whenever a session is on screen):
  // replacing it mid-gesture breaks a native scrollbar drag in flight, so
  // only its children are rebuilt below. (Scrollbar drags dispatch no
  // pointer events to the page, so there is no way to defer renders instead.)
  const keepMessages = oldMessages !== null && !!state?.sessionId && !blankHero
  for (const child of Array.from(chatCol.children)) {
    if (keepMessages && child === oldMessages) continue
    if (keepComposer && (child === oldComposer || (blankHero && child === oldHero))) continue
    child.remove()
  }
  // Menus anchored to surviving elements (kept composer, sessions header)
  // stay open across snapshot renders — re-anchor in case the layout shifted
  // under them; only close when the rebuild above actually removed the anchor.
  // popoverAnchor === null：坐标定位菜单（会话右键），没有锚点，保持原样。
  if (popover) {
    if (popoverAnchor === null) {
      // 坐标定位：不关闭、不 reposition。
    } else if (popoverAnchor.isConnected) positionPopover()
    else closePopover()
  }
  if (!state || !state.sessionId) {
    lastComposerSig = null
    turnStatusStart = null
    chatCol.appendChild(renderEmpty(state))
    return
  }
  // 历史基线加载中：只显示加载占位，hero 和消息流都等基线落地再渲染——
  // 否则切换会话时会先闪一帧空会话 hero（服务未就绪）再跳成消息流。
  if (state.loading === true) {
    turnStatusStart = null
    chatCol.appendChild(el('div', 'muted-hint loading-hint', '加载会话…'))
    return
  }
  if (blankHero) {
    turnStatusStart = null
    if (keepComposer && oldHero && oldComposer) {
      // 整个 hero（含 composer）保持不动：焦点、光标、进行中的 IME 组合都
      // 不中断；只有跟踪数据流的 stats 行就地修补。
      patchStatsRow(oldComposer, state.statsLine, state.contextUsage)
      if (slashPopupEl && oldInput) positionSlashPopup(oldInput)
    } else {
      chatCol.appendChild(renderHero(state, draft))
      const input = document.getElementById('input') as HTMLTextAreaElement
      autoGrow(input)
      if (hadFocus) {
        input.focus()
        // A rebuilt composer at least keeps the caret where it was.
        if (inputSel) input.setSelectionRange(inputSel.start, inputSel.end)
      }
      if (input.value.startsWith('/')) updateSlashPopup(input)
    }
    lastComposerSig = composerSig
    return
  }
  // Regions above the composer; insert before the preserved composer when kept.
  const anchor = keepComposer ? oldComposer : null
  const add = (node: HTMLElement): void => {
    if (anchor) chatCol.insertBefore(node, anchor)
    else chatCol.appendChild(node)
  }
  const jobsLabel = state.backgroundJobs ? jobsChipLabel(state.backgroundJobs) : null
  if (state.sessionTitle || state.presetLabel || (state.runningSubagents?.length ?? 0) > 0 || jobsLabel) {
    const header = el('div', 'chat-header')
    // 标题 ellipsis 截断但 hover 出完整标题（原生 title tooltip）。
    const titleSpan = el('span', 'chat-title', state.sessionTitle ?? '')
    if (state.sessionTitle) titleSpan.title = state.sessionTitle
    header.appendChild(titleSpan)
    // 重命名按钮紧跟标题（官方无此元素，本地增强）。
    if (state.sessionTitle) {
      const rename = buttonEl('rename-session', '✎')
      rename.title = '重命名会话'
      rename.addEventListener('click', () => startInlineRename(header))
      header.appendChild(rename)
    }
    // 「N 个子代理」chip（对齐官方 SubagentHeader trigger：透明底小字 + chevron）：
    // 点击弹下拉，行点击附着子会话。
    if (state.runningSubagents && state.runningSubagents.length > 0) {
      const chip = buttonEl('header-chip', '')
      chip.appendChild(el('span', undefined, `${state.runningSubagents.length} 个子代理`))
      chip.appendChild(iconSvg(PANEL_ICONS.chevronDown, 14))
      chip.title = '正在运行的子代理'
      chip.addEventListener('click', () => openSubagentMenu(chip))
      header.appendChild(chip)
    }
    // 「N 个后台任务运行中」chip（对齐官方 JobListAction）：有运行中 job
    // 时 chip 带像素环；点击弹下拉（状态点 + kind 徽标 + 摘要 + 状态/耗时）。
    if (state.backgroundJobs && jobsLabel) {
      const chip = buttonEl('header-chip', '')
      if (state.backgroundJobs.some(isLiveJob)) chip.appendChild(spinSvg())
      chip.appendChild(el('span', undefined, jobsLabel))
      chip.appendChild(iconSvg(PANEL_ICONS.chevronDown, 14))
      chip.title = '后台任务'
      chip.addEventListener('click', () => openJobsMenu(chip))
      header.appendChild(chip)
    }
    // 只读 preset 标签（对齐官方 AgentPresetLabel：浅底胶囊 + 14px 三环图标；
    // 空会话的选择 chip 在 hero，二者互斥）。
    if (state.presetLabel) {
      const chip = el('span', 'preset-chip')
      chip.appendChild(presetIconSvg())
      chip.appendChild(el('span', undefined, state.presetLabel))
      header.appendChild(chip)
    }
    const headerAnchor = keepMessages ? oldMessages : anchor
    if (headerAnchor) chatCol.insertBefore(header, headerAnchor)
    else chatCol.appendChild(header)
  }

  const messages = oldMessages ?? el('div', 'messages')
  if (!oldMessages) {
    messages.id = 'messages'
    messages.addEventListener('scroll', () => {
      stickToBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 40
      const jump = messages.querySelector<HTMLElement>('.jump-latest')
      if (jump) jump.style.display = stickToBottom ? 'none' : ''
    })
  }
  messages.textContent = ''
  state.messages.forEach((m, mi) => messages.appendChild(renderMessage(m, `m${mi}`)))
  for (const notice of commandNotices) messages.appendChild(el('div', 'command-notice', notice))
  if (state.messages.length === 0) {
    messages.appendChild(el('div', 'muted-hint', '会话还没有消息，在下方输入开始。'))
  }
  // Turn-status row: last item of the conversation flow while a turn is open
  // (official-client parity), gone the moment the turn ends.
  if (state.running) {
    messages.appendChild(renderTurnStatus())
  } else {
    turnStatusStart = null
  }
  // "Back to latest" floater: sticky at the scroller's bottom while the user
  // reads history; hidden while pinned to the tail.
  const jump = buttonEl('jump-latest', '↓ 回到最新')
  jump.style.display = stickToBottom ? 'none' : ''
  jump.addEventListener('click', () => {
    stickToBottom = true
    messages.scrollTop = messages.scrollHeight
    jump.style.display = 'none'
  })
  messages.appendChild(jump)
  if (!keepMessages) add(messages)

  if (state.pending.length > 0) {
    const pending = el('div', 'pending')
    for (const p of state.pending) {
      pending.appendChild(p.kind === 'approval' ? renderApproval(p) : renderQuestion(p))
    }
    add(pending)
  }

  if (state.queue && state.queue.length > 0) {
    if (editingQueueItem && !state.queue.some((item) => item.id === editingQueueItem)) editingQueueItem = null
    const queue = el('div', 'queue')
    for (const item of state.queue) queue.appendChild(renderQueueItem(item))
    add(queue)
  } else {
    editingQueueItem = null
  }

  if (state.jobs && state.jobs.length > 0) {
    const jobs = el('div', 'queue')
    for (const job of state.jobs) {
      const row = el('div', 'queue-item')
      const tag = el('span', 'queue-tag', job.kind)
      row.appendChild(tag)
      if (job.status === 'running') row.appendChild(el('span', 'spinner'))
      row.appendChild(
        el('span', 'queue-text', `${job.label}${job.detail ? `（${job.detail}）` : ''}${job.status === 'stopping' ? ' — 停止中' : ''}`),
      )
      jobs.appendChild(row)
    }
    add(jobs)
  }

  if (keepComposer && oldComposer) {
    // The composer element was never detached, so focus, caret, and any
    // in-flight IME composition survive; only patch the stats line in place.
    patchStatsRow(oldComposer, state.statsLine, state.contextUsage)
  } else {
    chatCol.appendChild(renderInput(draft))
  }
  lastComposerSig = composerSig
  if (stickToBottom) messages.scrollTop = messages.scrollHeight
  else if (prevScrollTop !== null) messages.scrollTop = prevScrollTop
  // Read back the clamped value: this is the position the next render compares
  // against to tell user scrolls apart from content growth.
  pinnedScrollTop = messages.scrollTop
  const queueEditor = document.querySelector<HTMLTextAreaElement>('.queue-editor')
  if (queueEditor && queueFocus) {
    queueEditor.focus()
    queueEditor.setSelectionRange(queueFocus.start, queueFocus.end)
  }
  if (!keepComposer) {
    const input = document.getElementById('input') as HTMLTextAreaElement
    autoGrow(input)
    if (hadFocus) {
      input.focus()
      // A rebuilt composer at least keeps the caret where it was.
      if (inputSel) input.setSelectionRange(inputSel.start, inputSel.end)
    }
    if (input.value.startsWith('/')) updateSlashPopup(input)
  } else if (slashPopupEl && oldInput) {
    positionSlashPopup(oldInput)
  }
}

/**
 * 空会话 hero（官方 dsh web 空态 HeroShell）：整列水平居中——标题
 * 「探索未至之境」+「预览版」徽章，其下 workspace 名（只读）与 preset 选择
 * chip 行，再下是包成大圆角卡片的 composer（样式见 chatView.ts 的 .hero）。
 */
function renderHero(state: ChatState, draft: string | undefined): HTMLElement {
  const hero = el('div', 'hero')
  const stack = el('div', 'hero-stack')
  const headline = el('div', 'hero-headline')
  headline.appendChild(el('span', 'hero-headline-text', '探索未至之境'))
  headline.appendChild(el('span', 'hero-badge', '预览版'))
  stack.appendChild(headline)
  const chips = el('div', 'hero-chips')
  if (state.workspaceLabel) {
    // 官方此 chip 是 workspace 选择器；我们没有更换 blank 会话所属 workspace
    // 的链路，只做只读展示（文件夹图标 + 名称，无 chevron）。
    const ws = el('span', 'hero-chip')
    ws.appendChild(iconSvg(PANEL_ICONS.folder, 16))
    ws.appendChild(el('span', 'label', state.workspaceLabel))
    chips.appendChild(ws)
  }
  if (state.agentPreset) {
    // 从 composer 底部挪到 hero 的 preset 选择 chip（交互不变，仍弹下拉）。
    const ap = state.agentPreset
    const current = ap.options.find((o) => o.id === ap.current)
    const preset = buttonEl('hero-chip', '')
    preset.appendChild(presetIconSvg())
    preset.appendChild(el('span', 'label', current?.label ?? ap.current))
    const chev = iconSvg(PANEL_ICONS.chevronDown, 14)
    chev.classList.add('chevron')
    preset.appendChild(chev)
    preset.title = 'Agent 模式'
    preset.disabled = !state.canSend
    preset.addEventListener('click', () => openAgentPresetMenu(preset, 'below'))
    chips.appendChild(preset)
  }
  if (chips.hasChildNodes()) stack.appendChild(chips)
  stack.appendChild(renderInput(draft, true))
  hero.appendChild(stack)
  return hero
}

function renderEmpty(state: ChatState | null): HTMLElement {
  const wrap = el('div', 'empty')
  if (state?.serverError === 'dshNotFound') {
    wrap.appendChild(el('div', 'empty-title', '未检测到 dsh 安装'))
    wrap.appendChild(
      el('div', 'empty-hint', 'DSH One 需要本机安装 dsh 才能使用。安装完成后回到这里即可自动启动。'),
    )
    const btn = buttonEl(undefined, '查看安装指南')
    btn.addEventListener('click', () => post({ type: 'openInstallPage' }))
    wrap.appendChild(btn)
    return wrap
  }
  wrap.appendChild(el('div', 'empty-title', 'dsh 聊天'))
  wrap.appendChild(
    el('div', 'empty-hint', '在会话列表中点击一个会话开始聊天。若列表为空，请先启动 dsh 服务。'),
  )
  return wrap
}

/* ---------------- Sessions 面板（原 dshOne.sessions 树视图合并而来） ---------------- */

/** 描边小图标：dsh web 无对应物的本地扩展图标（排序、置顶图钉）保留描边风格。 */
function strokeSvg(paths: string[]): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', '14')
  svg.setAttribute('height', '14')
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

const SORT_ICON = ['M4.5 3v10', 'M4.5 13l-2.2-2.6', 'M4.5 13l2.2-2.6', 'M11.5 13V3', 'M11.5 3L9.3 5.6', 'M11.5 3l2.2 2.6']
/** 图钉描边图标（会话行的置顶标记与置顶菜单项）。 */
const PIN_ICON = ['M5.9 2.5h4.2l.6 3.8 1.8 1.7v1.5h-9V8l1.8-1.7.6-3.8z', 'M8 9.5v4']

/** 置顶图钉 svg（行首状态槽与标题前两种位置共用）。 */
function makePinIcon(): SVGSVGElement {
  const svg = strokeSvg(PIN_ICON)
  svg.classList.add('pin-icon')
  return svg
}
/** 圆点描边图标（「标为未读」菜单项；官方无未读概念，本地扩展图标）。 */
const UNREAD_ICON = ['M8 2.6a5.4 5.4 0 1 0 0 10.8 5.4 5.4 0 0 0 0-10.8z']
/** 文档描边图标（待发送文件 chip 的类型小图标，本地扩展）。 */
const FILE_ICON = ['M4.2 2h4.6L12 5.2V14H4.2z', 'M8.8 2v3.2H12']

/**
 * 运行中像素环：复刻官方 dsh web StateDot(ongoing)——10×10 画布上 8 个
 * 2×2 方块沿环排布，各自带负的 animationDelay 错相，配合 .session-spin 的
 * chase keyframes（chatView.ts）形成转圈追逐效果。
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

/**
 * 官方 IconAgentPresetOutline16（dsh-client-ui-primitives）的逐元素复刻：
 * 圆环路径用 mask 在三个节点处镂空。IconDef 不支持 mask，故单独构建。
 */
function presetIconSvg(): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('width', '14')
  svg.setAttribute('height', '14')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('fill', 'none')
  const mask = document.createElementNS(NS, 'mask')
  mask.setAttribute('id', 'preset-icon-mask')
  const bg = document.createElementNS(NS, 'rect')
  bg.setAttribute('width', '16')
  bg.setAttribute('height', '16')
  bg.setAttribute('fill', 'white')
  mask.appendChild(bg)
  for (const [cx, cy] of [
    ['7.9995', '3.28319'],
    ['3.51122', '11.3855'],
    ['12.4878', '11.3855'],
  ]) {
    const c = document.createElementNS(NS, 'circle')
    c.setAttribute('cx', cx)
    c.setAttribute('cy', cy)
    c.setAttribute('r', '1.712')
    c.setAttribute('fill', 'black')
    mask.appendChild(c)
  }
  svg.appendChild(mask)
  const ring = document.createElementNS(NS, 'path')
  ring.setAttribute('mask', 'url(#preset-icon-mask)')
  ring.setAttribute(
    'd',
    'M12.2881 11.0425C12.6002 11.3723 13.0413 11.5786 13.5312 11.5786L13.5342 11.5776C13.1476 12.3233 12.6119 12.9785 11.9639 13.5005C10.9327 14.3309 9.6199 14.8286 8.19336 14.8286C7.29864 14.8285 6.45056 14.6313 5.6875 14.2808C6.08309 14.0281 6.36707 13.6189 6.45215 13.1392C6.99022 13.3561 7.57767 13.476 8.19336 13.4761C9.30019 13.4761 10.3157 13.0915 11.1152 12.4478C11.5935 12.0626 11.9924 11.5848 12.2881 11.0425ZM4.14746 4.36475C4.25569 4.83228 4.55488 5.2247 4.95898 5.4585C4.07956 6.30639 3.53144 7.49605 3.53125 8.81396C3.53125 9.69534 3.77613 10.5202 4.20117 11.2231C3.74959 11.3817 3.38395 11.7232 3.19531 12.1597C2.5541 11.2032 2.17969 10.052 2.17969 8.81396C2.17989 7.05087 2.93868 5.4646 4.14746 4.36475ZM8.19336 2.80029C8.85717 2.80029 9.49784 2.90834 10.0967 3.10791C12.3237 3.85044 13.9725 5.86061 14.1846 8.28369C13.9832 8.20048 13.7627 8.15382 13.5312 8.15381C13.2802 8.15381 13.042 8.20907 12.8271 8.30615C12.6281 6.47264 11.3666 4.95616 9.66895 4.39014C9.2063 4.236 8.70989 4.15186 8.19336 4.15186C7.96112 4.15189 7.7329 4.16981 7.50977 4.20264C7.51947 4.12886 7.52637 4.05348 7.52637 3.97705C7.52628 3.56604 7.3811 3.18914 7.13965 2.89404C7.48183 2.83352 7.83381 2.80033 8.19336 2.80029Z',
  )
  ring.setAttribute('fill', 'currentColor')
  svg.appendChild(ring)
  return svg
}

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

/** 面板头部的图标按钮。 */
function panelTool(icon: SVGSVGElement, title: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'sessions-tool'
  b.title = title
  b.setAttribute('aria-label', title)
  b.appendChild(icon)
  return b
}

/** 行内悬停按钮；阻止冒泡，避免触发行点击（附着会话/折叠分组）。 */
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
  // 锚点在面板顶部，向下展开。
  showPopover(anchor, body, 'below')
}

/** 重建 sessions 面板；搜索框内容与焦点跨重建保留（同 composer 的 draft 模式）。 */
function renderSessions(): void {
  const snap = sessionsSnapshot
  const oldSearch = sessionsPanel.querySelector<HTMLInputElement>('.sessions-search')
  const searchFocused = oldSearch !== null && document.activeElement === oldSearch
  const searchSel =
    searchFocused && oldSearch ? { start: oldSearch.selectionStart, end: oldSearch.selectionEnd } : null
  sessionsPanel.textContent = ''
  // 面板重建会带走锚点在其中的弹层（如排序菜单）：锚还在就重定位，没了才关。
  // popoverAnchor === null：坐标定位菜单（会话右键），保持原样不动。
  if (popover) {
    if (popoverAnchor === null) {
      // 坐标定位：不关闭、不 reposition。
    } else if (popoverAnchor.isConnected) positionPopover()
    else closePopover()
  }

  const header = el('div', 'sessions-header')
  const search = document.createElement('input')
  search.className = 'sessions-search'
  search.placeholder = '搜索会话'
  search.value = sessionsSearchDraft
  search.addEventListener('input', () => {
    sessionsSearchDraft = search.value
    // 输入防抖：不必每个字符都往返一次宿主（重建虽是本地的，消息却不是）。
    if (searchDebounce !== null) clearTimeout(searchDebounce)
    searchDebounce = setTimeout(() => {
      searchDebounce = null
      post({ type: 'sessionsSearch', query: sessionsSearchDraft.trim() === '' ? null : sessionsSearchDraft })
    }, 200)
  })
  header.appendChild(search)
  const sortBtn = panelTool(strokeSvg(SORT_ICON), '排序方式')
  sortBtn.addEventListener('click', () => openSortMenu(sortBtn))
  header.appendChild(sortBtn)
  const refreshBtn = panelTool(iconSvg(PANEL_ICONS.refresh), '刷新会话列表')
  refreshBtn.addEventListener('click', () => post({ type: 'sessionsRefresh' }))
  header.appendChild(refreshBtn)
  // 一键折叠所有 workspace 分组（最小版本只做折叠，不做折叠/展开切换）。
  const collapseAllBtn = panelTool(iconSvg(PANEL_ICONS.chevronsUp), '折叠所有工作区')
  collapseAllBtn.addEventListener('click', () => post({ type: 'workspacesCollapseAll' }))
  header.appendChild(collapseAllBtn)
  // + 号开菜单（dsh web 模式）：添加已有文件夹 / 创建工作区。
  const addBtn = panelTool(iconSvg(PANEL_ICONS.plus), '添加工作区')
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
  sessionsPanel.appendChild(header)

  const list = el('div', 'sessions-list')
  if (!snap) {
    list.appendChild(el('div', 'sessions-empty', '加载中…'))
  } else if (snap.serverState !== 'running') {
    list.appendChild(renderServerEmpty(snap))
  } else if (snap.workspaces.length === 0) {
    // 搜索激活时 buildSessionTree 会丢弃无匹配的 workspace，此时即"无结果"。
    const hint = snap.query ? `没有匹配「${snap.query}」的会话。` : '暂无工作区。点击上方 + 添加已有文件夹或创建工作区。'
    const box = el('div', 'sessions-empty')
    box.appendChild(el('div', 'empty-hint', hint))
    list.appendChild(box)
  } else {
    for (const w of snap.workspaces) list.appendChild(renderWorkspaceGroup(w))
  }
  sessionsPanel.appendChild(list)

  if (searchFocused) {
    search.focus()
    if (searchSel) search.setSelectionRange(searchSel.start, searchSel.end)
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

function renderWorkspaceGroup(w: WorkspaceNodeModel): HTMLElement {
  const group = el('div', 'workspace-group')
  // 「未分组」虚拟组：无路径、不能新建会话/打开终端与文件夹（对齐 dsh web，
  // 组头只有折叠交互），只保留折叠。
  const ungrouped = w.workspaceId === UNGROUPED_WORKSPACE_ID
  // 空组没有任何会话，恒按闭合态渲染：闭合文件夹图标、无 expanded 类，
  // hover 三角也不出现（.workspace-row.empty 的 CSS 规则），点击行头不响应。
  const empty = w.sessions.length === 0
  const collapsed = empty || (sessionsSnapshot?.collapsed.includes(w.workspaceId) ?? false)
  const head = el('div', collapsed ? 'workspace-row' : 'workspace-row expanded')
  if (empty) head.classList.add('empty')
  head.title = ungrouped ? '不属于任何工作区的会话' : w.path
  // 行首图标槽（dsh web 分组行模式）：默认文件夹（折叠=闭合/展开=打开），
  // hover 时 CSS 切换成实心三角，展开态三角 rotate(90deg)。
  const folderIcon = el('span', 'ws-folder')
  folderIcon.appendChild(iconSvg(collapsed ? PANEL_ICONS.folder : PANEL_ICONS.folderOpen))
  head.appendChild(folderIcon)
  const arrow = el('span', 'ws-arrow')
  arrow.appendChild(iconSvg(PANEL_ICONS.triangle))
  head.appendChild(arrow)
  head.appendChild(el('span', 'workspace-label', w.label))
  if (w.isCurrent) head.appendChild(el('span', 'workspace-badge', '当前'))
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
    // 当前文件夹已在 VSCode 里打开，只有其他 workspace 需要"打开文件夹"。
    if (!w.isCurrent) {
      headActions.appendChild(
        rowAction(iconSvg(PANEL_ICONS.folderOpen), '在 VSCode 中打开文件夹', () =>
          post({ type: 'workspaceOpenFolder', path: w.path }),
        ),
      )
    }
    head.appendChild(headActions)
  }
  // 整行点击 = 折叠/展开（行内按钮已 stopPropagation）；空组无可展开内容，不响应。
  if (!empty) {
    head.addEventListener('click', () =>
      post({ type: 'workspaceCollapse', workspaceId: w.workspaceId, collapsed: !collapsed }),
    )
  }
  group.appendChild(head)
  if (!collapsed) for (const s of w.sessions) group.appendChild(renderSessionRow(s))
  return group
}

function renderSessionRow(s: SessionNodeModel): HTMLElement {
  const row = el('div', 'session-row')
  row.dataset.sessionId = s.sessionId
  if (state?.sessionId === s.sessionId) row.classList.add('active')
  row.title = s.label
  const pinned = sessionsSnapshot?.pinned.includes(s.sessionId) ?? false
  // 行首状态槽对齐官方 dsh web：固定宽度，三种标记同一位置居中——
  // 运行中像素环 > 未读蓝点 > 置顶图钉；组合状态下被挤掉的图钉退到标题前。
  const slot = el('span', 'session-status')
  const slotTaken = s.running || s.unread
  if (s.running) slot.appendChild(spinSvg())
  else if (s.unread) slot.appendChild(el('span', 'session-dot'))
  else if (pinned) slot.appendChild(makePinIcon())
  row.appendChild(slot)
  const main = el('span', 'session-main')
  if (pinned && slotTaken) {
    const pin = el('span', 'session-pin')
    pin.appendChild(makePinIcon())
    main.appendChild(pin)
  }
  main.appendChild(el('span', s.unread ? 'session-title unread' : 'session-title', s.label))
  main.appendChild(el('span', 'session-time', s.description))
  row.appendChild(main)
  // dsh web 会话行模式：hover 只出一个 ⋯ 按钮，点击在按钮下方开会话菜单。
  const actions = el('span', 'row-actions')
  const more = rowAction(iconSvg(PANEL_ICONS.ellipsis), '更多操作', () => {
    showPopover(more, buildSessionMenuBody(s), 'below')
    markMenuRow(row)
  })
  actions.appendChild(more)
  row.appendChild(actions)
  row.addEventListener('click', () => post({ type: 'sessionOpen', sessionId: s.sessionId }))
  row.addEventListener('contextmenu', (e) => {
    // 拦掉浏览器原生 Cut/Copy/Paste 菜单，弹坐标定位的同一个会话菜单。
    e.preventDefault()
    showPopoverAt(e.clientX, e.clientY, buildSessionMenuBody(s))
    markMenuRow(row)
  })
  return row
}

/** 会话菜单内容（⋯ 按钮与右键菜单共用）：重命名 / 置顶 / 标为未读 / 分叉会话 / 归档会话。 */
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
      onClick: () => {
        closePopover()
        post({ type: 'sessionUnread', sessionId: s.sessionId, unread: !s.unread })
      },
    }),
  )
  body.appendChild(
    menuItem('分叉会话', {
      icon: iconSvg(MESSAGE_ACTION_ICONS.branch),
      onClick: () => {
        closePopover()
        post({ type: 'sessionFork', sessionId: s.sessionId })
      },
    }),
  )
  body.appendChild(
    menuItem('归档会话', {
      icon: iconSvg(PANEL_ICONS.archive),
      onClick: () => {
        closePopover()
        post({ type: 'sessionArchive', sessionId: s.sessionId, title: s.label })
      },
    }),
  )
  return body
}

/** 只切换 .active 高亮，不重建面板（render() 每次快照都会调用）。 */
function syncSessionHighlight(): void {
  const currentId = state?.sessionId ?? null
  sessionsPanel.querySelectorAll<HTMLElement>('.session-row').forEach((rowEl) => {
    rowEl.classList.toggle('active', rowEl.dataset.sessionId === currentId)
  })
}

renderSessions()

function contextLabel(kind: string): string {
  if (kind === 'agent-instructions' || kind === 'legacy-instructions') return '工作区指令'
  if (kind === 'plugin') return '运行时上下文'
  return '上下文注入'
}

/** Attachment id whose bytes are being fetched to open a preview on arrival. */
let pendingPreview: string | null = null
/** Queue item currently being edited inline, null when none. */
let editingQueueItem: string | null = null
/**
 * Composer recall mode entered by ArrowUp: 'queue' loads the last queued
 * message into the composer and send saves it back; 'history' recalls the
 * last genuine user message and send re-sends it as a new prompt.
 */
let recall: { kind: 'queue'; itemId: string } | { kind: 'history' } | null = null
/** Draft stashed when a recall replaced it; restored by Escape. */
let recallDraft = ''
/** Unsaved queue-editor text by item id; survives the rebuild-per-snapshot rendering. */
const queueEditDrafts = new Map<string, string>()
/** Composer draft arriving while no input element exists yet (restoreDraft before first render). */
let stashedDraft: string | undefined
/** Slash-command receipt texts shown at the message tail; cleared on session switch. */
let commandNotices: string[] = []

/** One queued inbox row: tag + preview, plus steer/edit/remove actions for queued items. */
function renderQueueItem(item: QueuedItem): HTMLElement {
  const row = el('div', 'queue-item')
  row.appendChild(el('span', 'queue-tag', item.placement === 'steering' ? '插话中' : '排队中'))

  if (editingQueueItem === item.id) {
    const editor = document.createElement('textarea')
    editor.className = 'queue-editor'
    editor.value = queueEditDrafts.get(item.id) ?? item.editText
    editor.rows = Math.min(6, Math.max(1, item.editText.split('\n').length))
    editor.addEventListener('input', () => queueEditDrafts.set(item.id, editor.value))
    editor.addEventListener('keydown', (e) => {
      // isComposing: don't save while an IME candidate window is open.
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault()
        save.click()
      } else if (e.key === 'Escape') {
        cancel.click()
      }
    })
    row.appendChild(editor)
    const actions = el('div', 'queue-actions')
    const save = buttonEl('', '保存')
    save.addEventListener('click', () => {
      const text = queueEditDrafts.get(item.id) ?? editor.value
      editingQueueItem = null
      queueEditDrafts.delete(item.id)
      post({ type: 'queueEdit', itemId: item.id, text })
    })
    const cancel = buttonEl('secondary', '取消')
    cancel.addEventListener('click', () => {
      editingQueueItem = null
      queueEditDrafts.delete(item.id)
      render()
    })
    actions.appendChild(save)
    actions.appendChild(cancel)
    row.appendChild(actions)
    return row
  }

  row.appendChild(el('span', 'queue-text', item.text || '（空消息）'))
  if (item.placement === 'queued') {
    const actions = el('div', 'queue-actions')
    const steer = buttonEl('link', '插话')
    steer.title = '立即打断当前轮，用这条消息插话'
    steer.addEventListener('click', () => post({ type: 'queueSteer', itemId: item.id }))
    const edit = buttonEl('link', '编辑')
    edit.addEventListener('click', () => {
      editingQueueItem = item.id
      render()
    })
    const remove = buttonEl('link', '删除')
    remove.addEventListener('click', () => post({ type: 'queueRemove', itemId: item.id }))
    actions.appendChild(steer)
    actions.appendChild(edit)
    actions.appendChild(remove)
    row.appendChild(actions)
  }
  return row
}

/** Compact chip for one attached image; click fetches bytes (once) and previews. */
function imageChip(image: ChatImage): HTMLElement {
  const chip = el('span', 'image-chip msg-image-chip')
  chip.appendChild(el('span', 'chip-name', image.name ?? '图片'))
  chip.title = '点击预览'
  chip.addEventListener('click', () => {
    const dataUrl = attachmentCache.get(image.attachmentId)
    if (dataUrl) {
      openLightbox(dataUrl)
      return
    }
    pendingPreview = image.attachmentId
    if (!attachmentRequested.has(image.attachmentId)) {
      attachmentRequested.add(image.attachmentId)
      post({ type: 'requestAttachment', attachmentId: image.attachmentId })
    }
  })
  return chip
}

/** Compact chip for one attached file; the path is the payload, no preview. */
function fileChip(file: ChatFile): HTMLElement {
  const chip = el('span', 'image-chip')
  const name = el('span', 'chip-name', file.name)
  name.title = file.path
  chip.appendChild(name)
  return chip
}

/** Full-screen preview overlay for one image; click or Escape closes. */
function openLightbox(dataUrl: string): void {
  const overlay = el('div', 'lightbox')
  const img = document.createElement('img')
  img.src = dataUrl
  overlay.appendChild(img)
  const close = (): void => {
    overlay.remove()
    document.removeEventListener('keydown', onKey, true)
  }
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      // 同弹层：消费掉 Esc，全局「Esc 打断 turn」按 defaultPrevented 让路。
      e.preventDefault()
      close()
    }
  }
  overlay.addEventListener('click', close)
  document.addEventListener('keydown', onKey, true)
  document.body.appendChild(overlay)
}

/**
 * Expanded state of <details> blocks, keyed by message/block position so
 * streaming snapshot rebuilds don't collapse what the user opened.
 * Cleared on session switch (keys are positional, only valid per session).
 */
const detailsOpen = new Map<string, boolean>()
let detailsSession: string | null = null

/** <details> whose open state persists across re-renders under `key`. */
function detailsEl(key: string, className: string, summaryText: string): HTMLDetailsElement {
  const det = el('details', className) as HTMLDetailsElement
  det.open = detailsOpen.get(key) ?? false
  det.addEventListener('toggle', () => detailsOpen.set(key, det.open))
  det.appendChild(el('summary', '', summaryText))
  return det
}

/**
 * Turn-status row, mirroring the official web client's TurnStatus: while a
 * turn is open, a shimmering "Deep diving..." sits at the tail of the message
 * flow; from 15s on, an elapsed clock ticks to its right. The clock's
 * interval rewrites only its own text node, so it never forces a list
 * re-render (which would disturb scroll/collapse state). The start timestamp
 * survives snapshot re-renders for the whole open turn; it is reset when
 * running flips back to false.
 */
let turnStatusStart: number | null = null
let turnStatusTimer: ReturnType<typeof setInterval> | null = null

/** Drop the clock interval; every render calls this before rebuilding. */
function clearTurnStatusTimer(): void {
  if (turnStatusTimer !== null) {
    clearInterval(turnStatusTimer)
    turnStatusTimer = null
  }
}

function renderTurnStatus(): HTMLElement {
  if (turnStatusStart === null) turnStatusStart = Date.now()
  const start = turnStatusStart
  const row = el('div', 'turn-status')
  row.setAttribute('role', 'status')
  row.setAttribute('aria-live', 'polite')
  row.appendChild(el('span', 'turn-status-text', 'Deep diving...'))
  const clock = el('span', 'turn-status-clock')
  const tick = (): void => {
    const elapsed = Date.now() - start
    clock.textContent = elapsed >= 15000 ? formatDuration(elapsed) : ''
  }
  tick()
  row.appendChild(clock)
  turnStatusTimer = setInterval(tick, 1000)
  return row
}

function renderMessage(m: ChatMessage, key: string): HTMLElement {
  if (m.kind === 'user') {
    // Host-injected context renders collapsed; only real human input bubbles.
    if (m.context) {
      const det = detailsEl(`${key}:ctx`, 'msg context', `📎 ${contextLabel(m.context)}（已随消息注入）`)
      det.appendChild(el('div', 'context-body', m.text))
      return det
    }
    const row = el('div', 'msg user')
    if (m.text) row.appendChild(el('div', 'bubble', m.text))
    const attachments = el('div', 'msg-images')
    if (m.images) for (const image of m.images) attachments.appendChild(imageChip(image))
    if (m.files) for (const file of m.files) attachments.appendChild(fileChip(file))
    if (attachments.childElementCount > 0) row.appendChild(attachments)
    return row
  }
  if (m.kind === 'command') {
    // Slash-command lifecycle flow node (dsh command/run + command/done).
    const row = el('div', `msg command-row ${m.status}`)
    row.appendChild(el('span', 'command-line', `/${m.name}${m.args ? ` ${m.args}` : ''}`))
    if (m.status === 'running') row.appendChild(el('span', 'spinner'))
    if (m.text) row.appendChild(el('span', 'command-text', m.text))
    return row
  }
  const row = el('div', 'msg assistant')
  m.blocks.forEach((block, bi) => row.appendChild(renderBlock(block, `${key}:b${bi}`)))
  if (!m.complete) row.appendChild(el('div', 'streaming', '▍'))
  if (m.interrupted) row.appendChild(el('div', 'interrupted', '已中断'))
  if (m.turnError) row.appendChild(renderTurnError(m.turnError))
  // Copy/feedback/fork are meaningless on an empty marker-only message
  // (turn failed or was interrupted before any content).
  if (m.complete && !(m.blocks.length === 0 && (m.turnError || m.interrupted))) {
    row.appendChild(renderAssistantActions(m))
  }
  return row
}

/** Turn failure row, mirroring the official web client's TurnErrorItem. */
function renderTurnError(err: { message: string; code?: string }): HTMLElement {
  const row = el('div', 'turn-error')
  row.appendChild(el('span', 'turn-error-dot'))
  row.appendChild(el('span', 'turn-error-title', '本轮运行失败'))
  row.appendChild(el('span', 'turn-error-message', err.message))
  if (err.code) row.appendChild(el('span', 'turn-error-code', err.code))
  return row
}

/** Plain-text content of one assistant message (text + reasoning blocks). */
function assistantText(m: ChatAssistantMessage): string {
  return m.blocks
    .filter((b) => b.type === 'text' || b.type === 'reasoning')
    .map((b) => (b as { text: string }).text)
    .filter(Boolean)
    .join('\n\n')
}

/** Action row under a completed assistant message: copy / feedback / fork. */
function renderAssistantActions(m: ChatAssistantMessage): HTMLElement {
  const actions = el('div', 'msg-actions')
  const copy = iconButton(MESSAGE_ACTION_ICONS.copy, '复制')
  const copyIcon = copy.firstChild as SVGSVGElement
  const checkIcon = iconSvg(MESSAGE_ACTION_ICONS.check)
  copy.addEventListener('click', () => {
    const text = assistantText(m)
    if (!text) return
    // Top-level document: the async clipboard API is available.
    void navigator.clipboard.writeText(text).then(
      () => {
        copy.replaceChild(checkIcon, copyIcon)
        copy.title = '已复制'
        setTimeout(() => {
          copy.replaceChild(copyIcon, checkIcon)
          copy.title = '复制'
        }, 1000)
      },
      () => {
        copy.title = '复制失败'
      },
    )
  })
  actions.appendChild(copy)

  const messageId = m.messageId
  const ratings: Array<{ rating: 'positive' | 'negative'; icon: IconDef; hint: string }> = [
    { rating: 'positive', icon: MESSAGE_ACTION_ICONS.like, hint: '有用' },
    { rating: 'negative', icon: MESSAGE_ACTION_ICONS.dislike, hint: '没用' },
  ]
  for (const { rating, icon, hint } of ratings) {
    const btn = iconButton(icon, hint)
    if (m.feedbackRating === rating) btn.classList.add('active')
    if (!messageId) {
      // The host never persisted an id for this message: feedback RPCs need it.
      btn.disabled = true
      btn.title = '这条消息暂不支持反馈'
    } else {
      btn.addEventListener('click', () => {
        btn.disabled = true
        // Clicking the active rating again clears it.
        post({ type: 'feedback', messageId, rating: m.feedbackRating === rating ? null : rating })
      })
    }
    actions.appendChild(btn)
  }

  // Fork rule (web parity): only from a completed, non-interrupted turn.
  if (m.seq !== undefined && !m.interrupted) {
    const atSeq = m.seq
    const fork = iconButton(MESSAGE_ACTION_ICONS.branch, '分支')
    fork.title = '从这条消息创建一个分支会话'
    fork.addEventListener('click', () => {
      fork.disabled = true
      post({ type: 'fork', atSeq })
    })
    actions.appendChild(fork)
  }
  return actions
}

function renderBlock(block: ChatBlock, key: string): HTMLElement {
  switch (block.type) {
    case 'text': {
      const div = el('div', 'md')
      div.innerHTML = md(block.text)
      return div
    }
    case 'reasoning': {
      const det = detailsEl(`${key}:reason`, 'reasoning', '思考过程')
      det.appendChild(el('div', 'reasoning-body', block.text))
      return det
    }
    case 'tool':
      return renderTool(block, key)
  }
}

/**
 * 工具调用行（kimi-cli / dsh web 行式排版）：状态图标 + 英文动作短语 +
 * host 计算的标题（如文件路径），命令类工具另起一行等宽预览（$ 前缀、
 * 截断省略）。不再是带边框的卡片容器。
 */
function renderTool(block: ChatToolBlock, key: string): HTMLElement {
  const row = el('div', `tool tool-${block.status}`)
  const line = el('div', 'tool-line')
  if (block.status === 'running') {
    line.appendChild(el('span', 'spinner'))
  } else {
    line.appendChild(
      el('span', block.status === 'done' ? 'tool-status-done' : 'tool-status-error',
        block.status === 'done' ? '✓' : '✕'),
    )
  }
  line.appendChild(el('span', 'tool-action', toolAction(block.name)))
  if (block.title) line.appendChild(el('span', 'tool-title', block.title))
  row.appendChild(line)
  if (block.detail) {
    row.appendChild(
      el('div', 'tool-detail', isCommandTool(block.name) ? `$ ${block.detail}` : block.detail),
    )
  }
  if (block.diff) row.appendChild(renderDiff(block.diff))
  if (block.output) row.appendChild(renderToolOutput(block.output, `${key}:out`))
  return row
}

/**
 * 工具输出：默认只渲染前 OUTPUT_PREVIEW_LINES 行 + 「… 共 N 行，点击展开」
 * 提示（kimi-cli 的 "… (N more lines)" 对应物），点击展开全部、再次点击收起。
 * 展开状态记在 detailsOpen（key 按消息/块位置），流式重建不冲掉——同
 * detailsEl 的持久化机制。
 */
function renderToolOutput(output: string, key: string): HTMLElement {
  const box = el('div', 'tool-output')
  const { preview, totalLines, truncated } = truncateLines(output)
  const open = detailsOpen.get(key) ?? false
  box.appendChild(el('pre', '', open ? output : preview))
  if (truncated) {
    const toggle = el('div', 'tool-output-toggle', open ? '收起输出' : `… 共 ${totalLines} 行，点击展开`)
    toggle.addEventListener('click', () => {
      detailsOpen.set(key, !open)
      render()
    })
    box.appendChild(toggle)
  }
  return box
}

function renderDiff(diff: { oldText: string; newText: string }): HTMLElement {
  const box = el('div', 'diff')
  for (const line of diff.oldText.split('\n')) box.appendChild(el('div', 'diff-line del', line))
  for (const line of diff.newText.split('\n')) box.appendChild(el('div', 'diff-line add', line))
  return box
}

function renderApproval(p: PendingApproval): HTMLElement {
  const card = el('div', 'pending-card')
  card.appendChild(el('div', 'pending-title', `权限请求：${p.toolName}`))
  if (p.reason) card.appendChild(el('div', 'pending-reason', p.reason))
  const actions = el('div', 'pending-actions')
  const allow = buttonEl('', '允许一次')
  const deny = buttonEl('secondary', '拒绝')
  // Disable both on click so a slow host can't be answered twice.
  allow.addEventListener('click', () => {
    allow.disabled = true
    deny.disabled = true
    post({ type: 'approval', rpcId: p.rpcId, outcome: 'allowed-once' })
  })
  deny.addEventListener('click', () => {
    allow.disabled = true
    deny.disabled = true
    post({ type: 'approval', rpcId: p.rpcId, outcome: 'rejected' })
  })
  actions.appendChild(allow)
  actions.appendChild(deny)
  card.appendChild(actions)
  return card
}

/** Per-question answer draft: picked option labels plus free-text custom input. */
interface QuestionDraft {
  selected: Set<string>
  custom: string
}

function questionDraft(rpcId: string): Map<number, QuestionDraft> {
  let d = answerDrafts.get(rpcId)
  if (!d) {
    d = new Map()
    answerDrafts.set(rpcId, d)
  }
  return d
}

function draftFor(rpcId: string, index: number): QuestionDraft {
  const d = questionDraft(rpcId)
  let v = d.get(index)
  if (!v) {
    v = { selected: new Set(), custom: '' }
    d.set(index, v)
  }
  return v
}

function submitAnswer(p: PendingQuestion): void {
  const d = answerDrafts.get(p.rpcId)
  // Same encoding as dsh's web QuestionComposer: a custom answer replaces the
  // selection for single-select questions, and accompanies it for multi-select.
  const answers = p.questions.map((q, i) => {
    const v = d?.get(i)
    const custom = v?.custom.trim() ?? ''
    const selected = [...(v?.selected ?? [])]
    return {
      selected: custom === '' || q.multiSelect ? selected : [],
      ...(custom ? { custom } : {}),
    }
  })
  answerDrafts.delete(p.rpcId)
  post({ type: 'answer', rpcId: p.rpcId, answers })
}

function renderQuestion(p: PendingQuestion): HTMLElement {
  const card = el('div', 'pending-card')
  const single = p.questions.length === 1
  p.questions.forEach((q, i) => {
    const wrap = el('div', 'question')
    if (q.header) wrap.appendChild(el('div', 'question-header', q.header))
    wrap.appendChild(el('div', 'question-text', q.question))
    if (q.detail) {
      // Plan reviews carry the full plan markdown here; keep it collapsible.
      const det = detailsEl(`q:${p.rpcId}:${i}`, 'question-detail', '查看详情')
      const body = el('div', 'md')
      body.innerHTML = md(q.detail)
      det.appendChild(body)
      wrap.appendChild(det)
    }
    const draft = draftFor(p.rpcId, i)
    if (q.options && q.options.length > 0) {
      if (q.multiSelect) {
        for (const opt of q.options) {
          const label = el('label', 'checkbox')
          const box = document.createElement('input')
          box.type = 'checkbox'
          box.checked = draft.selected.has(opt.label)
          box.addEventListener('change', () => {
            if (box.checked) draft.selected.add(opt.label)
            else draft.selected.delete(opt.label)
          })
          label.appendChild(box)
          label.appendChild(el('span', '', opt.description ? `${opt.label} — ${opt.description}` : opt.label))
          wrap.appendChild(label)
        }
      } else {
        const group = el('div', 'question-options')
        for (const opt of q.options) {
          // A plan-review intent names its approve option; render it primary.
          const isApprove = q.intent?.kind === 'plan-review' && q.intent.approve === opt.label
          const btn = buttonEl(isApprove ? 'option-btn' : 'secondary option-btn', opt.label)
          if (opt.description) btn.title = opt.description
          if (draft.custom === '' && draft.selected.has(opt.label)) btn.classList.add('selected')
          btn.addEventListener('click', () => {
            draft.selected = new Set([opt.label])
            draft.custom = ''
            // A lone single-select question answers immediately, Claude Code style.
            if (single) submitAnswer(p)
            else render()
          })
          group.appendChild(btn)
        }
        wrap.appendChild(group)
      }
    }
    // Every question also takes a free-text "Other" answer, like the web UI.
    const customRow = el('div', 'question-custom')
    const input = document.createElement('input')
    input.type = 'text'
    input.placeholder = q.options?.length ? '其他（自定义回答，Enter 提交）' : '输入回答，Enter 提交'
    input.value = draft.custom
    input.addEventListener('input', () => {
      draft.custom = input.value
      if (input.value && !q.multiSelect) draft.selected.clear()
    })
    input.addEventListener('keydown', (e) => {
      // isComposing: Enter confirms an IME candidate, not the answer.
      if (e.key === 'Enter' && !e.isComposing && single) {
        e.preventDefault()
        submitAnswer(p)
      }
    })
    customRow.appendChild(input)
    wrap.appendChild(customRow)
    card.appendChild(wrap)
  })
  // Multi-question asks and multi-select questions need an explicit confirm.
  const needsConfirm = !single || p.questions.some((q) => q.multiSelect)
  if (needsConfirm) {
    const actions = el('div', 'pending-actions')
    const ok = buttonEl('', '确认')
    ok.addEventListener('click', () => {
      ok.disabled = true
      submitAnswer(p)
    })
    actions.appendChild(ok)
    card.appendChild(actions)
  }
  return card
}

/**
 * 待发送图片：对齐官方 AttachmentRail 的圆角缩略图（点击放大预览，hover
 * 右上角出 × 移除）。字节已在 webview 内存里，直接用 data: URL 渲染（CSP
 * 已允许 img-src data:，无需 objectURL）；加载失败回退为文件名 chip。
 */
function pendingImageThumb(img: OutgoingImage, index: number): HTMLElement {
  const name = img.name ?? '图片'
  if (!isImageMediaType(img.mediaType)) return pendingImageFallback(img, index)
  const item = el('span', 'attach-thumb')
  item.title = `${name}（点击预览）`
  const dataUrl = attachmentDataUrl(img.mediaType, img.data)
  const image = document.createElement('img')
  image.src = dataUrl
  image.alt = name
  image.addEventListener('error', () => item.replaceWith(pendingImageFallback(img, index)))
  const remove = buttonEl('thumb-remove', '×')
  remove.title = '移除图片'
  remove.addEventListener('click', (e) => {
    e.stopPropagation()
    pendingImages.splice(index, 1)
    render()
  })
  item.addEventListener('click', () => openLightbox(dataUrl))
  item.appendChild(image)
  item.appendChild(remove)
  return item
}

/** 缩略图不可用时的回退：原来的文件名 chip（保留点击预览与移除）。 */
function pendingImageFallback(img: OutgoingImage, index: number): HTMLElement {
  const chip = el('span', 'image-chip')
  const name = el('span', 'chip-name', img.name ?? '图片')
  name.style.cursor = 'zoom-in'
  name.title = '点击预览'
  name.addEventListener('click', () => {
    openLightbox(attachmentDataUrl(img.mediaType, img.data))
  })
  chip.appendChild(name)
  const remove = buttonEl('chip-remove', '×')
  remove.title = '移除图片'
  remove.addEventListener('click', () => {
    pendingImages.splice(index, 1)
    render()
  })
  chip.appendChild(remove)
  return chip
}

/** 待发送文件：文件名 chip + 文档小图标；path 是 payload，无预览。 */
function pendingFileChip(file: StagedFile, index: number): HTMLElement {
  const chip = el('span', 'image-chip')
  const icon = el('span', 'file-chip-icon')
  icon.appendChild(strokeSvg(FILE_ICON))
  chip.appendChild(icon)
  const name = el('span', 'chip-name', file.name)
  name.title = file.path
  chip.appendChild(name)
  const remove = buttonEl('chip-remove', '×')
  remove.title = '移除文件'
  remove.addEventListener('click', () => {
    pendingFiles.splice(index, 1)
    render()
  })
  chip.appendChild(remove)
  return chip
}

function renderInput(draft: string | undefined, hero = false): HTMLElement {
  const wrap = el('div', 'input-area')
  const canSend = !!state?.canSend

  if (pendingImages.length > 0 || pendingFiles.length > 0) {
    const chips = el('div', 'image-chips')
    pendingImages.forEach((img, i) => chips.appendChild(pendingImageThumb(img, i)))
    pendingFiles.forEach((file, i) => chips.appendChild(pendingFileChip(file, i)))
    wrap.appendChild(chips)
  }

  const row = el('div', 'input-row')
  const input = document.createElement('textarea')
  input.id = 'input'
  input.rows = 1
  input.placeholder = !canSend
    ? '服务未就绪，暂时无法发送'
    : recall?.kind === 'queue'
      ? '正在修改排队消息，Enter 保存，Esc 取消'
      : state?.running
        ? '输入消息，Enter 排队发送，⌘Enter 立即插话，↑ 修改排队消息，Esc 打断'
        : hero
          ? '描述你想要构建的内容'
          : '输入消息，Enter 发送，Shift+Enter 换行，可粘贴图片/文件，↑ 召回上一条'
  input.disabled = !canSend
  if (stashedDraft) {
    input.value = draft?.trim() ? `${draft.trimEnd()}\n${stashedDraft}` : stashedDraft
    stashedDraft = undefined
  } else if (draft) {
    input.value = draft
  }

  const button = buttonEl('send-button', recall?.kind === 'queue' ? '保存' : '发送')
  const updateButton = (): void => {
    button.disabled =
      !canSend || (input.value.trim().length === 0 && pendingImages.length === 0 && pendingFiles.length === 0)
  }
  const sendCurrent = (steer = false): void => {
    if (!state || !state.canSend) return
    hideSlashPopup()
    // Staged file chips travel as <attachment> path lines appended to the
    // prompt text (dsh has no file content part); the folder parses them
    // back into chips for history rendering.
    const text = [input.value.trim(), ...pendingFiles.map((f) => `<attachment>${f.path}</attachment>`)]
      .filter(Boolean)
      .join('\n')
    if (!text && pendingImages.length === 0) return
    // `/model` is a client-side command (dsh-client-ui-model-selection): the
    // host has no such command, so open the model menu instead of sending.
    if (text === '/model' && !recall) {
      input.value = ''
      render()
      const pill = document.querySelector<HTMLElement>('.input-footer .pill[title="模型"]')
      if (pill) openModelMenu(pill)
      return
    }
    if (recall?.kind === 'queue') {
      // Queue edits carry text only (the host rejects non-text content), so
      // staged images stay staged and only the text goes to the queue item.
      const itemId = recall.itemId
      recall = null
      recallDraft = ''
      pendingFiles = []
      post({ type: 'queueEdit', itemId, text })
      input.value = ''
      render()
      return
    }
    recall = null
    recallDraft = ''
    const images = pendingImages
    pendingImages = []
    pendingFiles = []
    post({ type: 'send', text, ...(images.length > 0 ? { images } : {}), ...(steer ? { steer } : {}) })
    input.value = ''
    render()
  }
  button.addEventListener('click', () => sendCurrent())
  button.title = state?.running ? 'Enter 排队发送，⌘/Ctrl+Enter 立即插话' : ''
  input.addEventListener('keydown', (e) => {
    // Slash completion owns these keys while open: arrows navigate, Tab/Enter
    // complete, Escape dismisses (an Escape with no popup falls through).
    if (slashPopupEl && !e.isComposing) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        moveSlashSelection(1)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        moveSlashSelection(-1)
        return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        slashRows[slashIndex]?.apply?.(input)
        return
      }
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault()
        hideSlashPopup()
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        const apply = slashRows[slashIndex]?.apply
        if (apply) {
          e.preventDefault()
          apply(input)
          return
        }
        // Hint-only popup: Enter falls through and sends the line as-is.
      }
    }
    // isComposing: don't send while an IME candidate window is open.
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      // ⌘/Ctrl+Enter steers: interrupt the active turn instead of queueing.
      sendCurrent(e.metaKey || e.ctrlKey)
      return
    }
    if (e.key === 'Escape' && !e.defaultPrevented && recall) {
      // Cancel the recall: the recalled text goes away, the stashed draft returns.
      e.preventDefault()
      recall = null
      input.value = recallDraft
      recallDraft = ''
      render()
      return
    }
    // ArrowUp on the first line with no selection recalls: the last queued
    // message for editing when the inbox has one, else the last genuine user
    // message for re-sending. A recall in progress keeps ArrowUp as caret move.
    if (e.key === 'ArrowUp' && !e.isComposing && !recall && state?.canSend) {
      if (input.selectionStart !== input.selectionEnd) return
      if (input.value.slice(0, input.selectionStart).includes('\n')) return
      const lastQueued = [...(state.queue ?? [])].reverse().find((q) => q.placement === 'queued')
      const lastUser = lastQueued
        ? null
        : [...state.messages].reverse().find((m) => m.kind === 'user' && !m.context && m.text.trim())
      if (!lastQueued && !lastUser) return
      e.preventDefault()
      recallDraft = input.value
      if (lastQueued) {
        recall = { kind: 'queue', itemId: lastQueued.id }
        input.value = lastQueued.editText
      } else if (lastUser && lastUser.kind === 'user') {
        recall = { kind: 'history' }
        input.value = lastUser.text
      }
      render()
    }
  })
  input.addEventListener('input', () => {
    autoGrow(input)
    updateButton()
    updateSlashPopup(input)
  })
  input.addEventListener('blur', () => hideSlashPopup())
  input.addEventListener('paste', (e) => {
    // Every clipboard file becomes an attachment, images or not — the host
    // sniffs the bytes, so a missing declared type (macOS file promises) is fine.
    const items = Array.from(e.clipboardData?.items ?? []).filter((item) => item.kind === 'file')
    if (items.length === 0) return
    e.preventDefault()
    void (async () => {
      const files: OutgoingImage[] = []
      for (const [i, item] of items.entries()) {
        const file = item.getAsFile()
        if (!file) continue
        try {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result))
            reader.onerror = () => reject(reader.error)
            reader.readAsDataURL(file)
          })
          const comma = dataUrl.indexOf(',')
          files.push({
            mediaType: file.type || item.type,
            data: comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl,
            name: file.name || `pasted-${Date.now()}-${i + 1}`,
          })
        } catch {
          // Unreadable clipboard item: skip it, keep the rest.
        }
      }
      if (files.length > 0) post({ type: 'filesPasted', files })
    })()
  })
  updateButton()
  row.appendChild(input)
  // While a turn runs, stop gets its own button; send stays available and
  // queues the prompt (dsh mode 'queue').
  if (state?.running) {
    const stop = buttonEl('secondary stop-button', '停止')
    stop.addEventListener('click', () => post({ type: 'stop' }))
    row.appendChild(stop)
  }
  row.appendChild(button)
  wrap.appendChild(row)

  const footer = el('div', 'input-footer')
  const addImage = buttonEl('pill', '+')
  addImage.title = '添加附件（图片或文件）'
  addImage.disabled = !canSend
  addImage.addEventListener('click', () => post({ type: 'pickFiles' }))
  footer.appendChild(addImage)
  const commands = buttonEl('pill', '/')
  commands.title = '命令'
  commands.disabled = !canSend
  commands.addEventListener('click', () => openCommandMenu(commands))
  footer.appendChild(commands)
  if (state?.permissions) {
    const perms = state.permissions
    const current = perms.options.find((o) => o.value === perms.current)
    const perm = buttonEl('pill', '')
    const glyph = current ? PERMISSION_GLYPHS[current.value] : undefined
    if (glyph) {
      const g = el('span', 'glyph')
      g.innerHTML = glyph // build-time constant, not user input
      perm.appendChild(g)
    }
    perm.appendChild(el('span', undefined, current?.label ?? perms.current))
    perm.title = '权限模式'
    perm.disabled = !canSend
    perm.addEventListener('click', () => openPermissionMenu(perm))
    footer.appendChild(perm)
  }
  if (state?.agentPreset && !hero) {
    // Agent preset chip：只在空会话出现（state.agentPreset 由宿主按此条件透传）。
    // hero 布局里它挪到标题下的 chip 行（renderHero），footer 不再重复。
    const ap = state.agentPreset
    const current = ap.options.find((o) => o.id === ap.current)
    const preset = buttonEl('pill', '')
    preset.appendChild(presetIconSvg())
    preset.appendChild(el('span', 'label', current?.label ?? ap.current))
    preset.title = 'Agent 模式'
    preset.disabled = !canSend
    preset.addEventListener('click', () => openAgentPresetMenu(preset))
    footer.appendChild(preset)
  }
  const model = buttonEl('pill', state?.modelLabel ?? '选择模型')
  model.title = '模型'
  model.disabled = !canSend
  model.addEventListener('click', () => openModelMenu(model))
  footer.appendChild(model)
  wrap.appendChild(footer)

  if (state?.statsLine || state?.contextUsage) wrap.appendChild(statsRow(state?.statsLine, state?.contextUsage))
  return wrap
}

function autoGrow(input: HTMLTextAreaElement): void {
  input.style.height = 'auto'
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`
}
