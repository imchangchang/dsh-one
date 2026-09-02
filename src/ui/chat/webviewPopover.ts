/**
 * Chat webview 弹层（popover）系统：菜单/下拉的创建、定位、关闭与键盘/
 * 鼠标外部点击处理。状态（popover/popoverAnchor/popoverPlacement/
 * modelMenuBody/menuOpenRow/jobsTick）自包含在本模块，外部只通过
 * showPopover/showPopoverAt/closePopover/menuItem 交互。
 *
 * 拆分自 webview.ts（multi-tab 重构第二层）：弹层是前端高频扩展点
 * （每个菜单、每个下拉都走这里），独立成模块后新菜单不再动 webview.ts
 * 主文件。
 */
import { el } from './webviewKit.ts'

/** Open composer popover; attached to document.body so it survives render(). */
let popover: HTMLElement | null = null
/** Anchor the open popover tracks; renders re-anchor or close on disconnect. */
let popoverAnchor: HTMLElement | null = null
let popoverPlacement: 'above' | 'below' = 'above'
/** 菜单打开期间保持 hover 背景的来源行（会话行的 ⋯ 菜单/右键菜单）。 */
let menuOpenRow: HTMLElement | null = null
/** 后台任务下拉的耗时 tick（打开且有运行中行时挂上，关闭弹层时清理）。 */
let jobsTick: ReturnType<typeof setInterval> | null = null

function markMenuRow(row: HTMLElement | null): void {
  menuOpenRow?.classList.remove('menu-open')
  menuOpenRow = row
  menuOpenRow?.classList.add('menu-open')
}

/** 弹层打开期间标记来源行（右键菜单路径用），供菜单关闭后恢复。 */
export function markMenuRowFor(row: HTMLElement | null): void {
  markMenuRow(row)
}

function onPopoverOutside(e: MouseEvent): void {
  // 锚点（触发按钮）不算外部：官方 useDismissOnOutsidePointer 同样排除
  // trigger 子树——点已打开菜单的 trigger 应走自身的 toggle 逻辑，而不是
  // 先被 mousedown 关掉再被 click 重新打开。
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
    // 消费掉这次 Esc：弹层优先于全局「Esc 打断 turn」（后者按 defaultPrevented 让路）。
    e.preventDefault()
    closePopover()
  }
}

export function closePopover(): void {
  popover?.remove()
  popover = null
  popoverAnchor = null
  markMenuRow(null)
  if (jobsTick !== null) {
    clearInterval(jobsTick)
    jobsTick = null
  }
  document.removeEventListener('mousedown', onPopoverOutside, true)
  document.removeEventListener('keydown', onPopoverKey, true)
}

/** (Re)position the open popover from its anchor's live rect. */
export function positionPopover(): void {
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

export function showPopover(anchor: HTMLElement, body: HTMLElement, placement: 'above' | 'below' = 'above'): void {
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
 * popoverAnchor 置为 null —— render() 的存活检查
 * 对无锚点弹层保持不动（不关闭、不 reposition）。
 */
export function showPopoverAt(x: number, y: number, body: HTMLElement): void {
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

export function menuItem(
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

/** 后台任务下拉的耗时 tick 注册（menus 模块 openJobsMenu 用；closePopover 统一清理）。 */
export function setJobsTicker(t: ReturnType<typeof setInterval> | null): void {
  jobsTick = t
}

/** 弹层当前是否挂在这个锚点上（menus 模块的 trigger toggle 判断用）。 */
export function popoverOpenAt(anchor: HTMLElement): boolean {
  return popover !== null && popoverAnchor === anchor
}

/** 当前弹层元素（menus 模块的耗时 tick 改写文本节点用；无弹层为 null）。 */
export function getPopover(): HTMLElement | null {
  return popover
}

/** 当前弹层的锚点（webview.ts render() 的存活检查用；无锚点为 null）。 */
export function getPopoverAnchor(): HTMLElement | null {
  return popoverAnchor
}

