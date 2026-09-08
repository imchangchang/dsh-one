/**
 * Shared DOM helpers for the chat webview (#40). Only depends on `document` and
 * the `IconDef` model from `./icons.ts`, so both the legacy webview and Preact
 * components can import them without pulling in webview state.
 */
import { AGENT_PRESET_ICON, type IconDef } from './icons.ts'

export function el(tag: string, className?: string, text?: string): HTMLElement {
  const e = document.createElement(tag)
  if (className) e.className = className
  if (text !== undefined) e.textContent = text
  return e
}

export function buttonEl(className: string | undefined, text: string): HTMLButtonElement {
  const b = document.createElement('button')
  if (className) b.className = className
  b.textContent = text
  return b
}

/** Icon-only ghost button matching the dsh web UI's message action style. */
export function iconButton(icon: IconDef, title: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'icon-action'
  b.title = title
  b.setAttribute('aria-label', title)
  b.appendChild(iconSvg(icon))
  return b
}

export function iconSvg(icon: IconDef, size = 16): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('viewBox', icon.viewBox ?? '0 0 16 16')
  svg.setAttribute('fill', 'none')
  for (const p of icon.paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    if (typeof p === 'string') {
      path.setAttribute('d', p)
      path.setAttribute('fill', 'currentColor')
    } else {
      path.setAttribute('d', p.d)
      if (p.transform) path.setAttribute('transform', p.transform)
      if (p.opacity) path.setAttribute('opacity', p.opacity)
      // Stroke 型路径（如 AlarmClock）：描边渲染、不填色（fill 继承 svg 的
      // none）；未标 strokeWidth 的路径仍走填色（既有行为）。
      if (p.strokeWidth) {
        path.setAttribute('stroke', 'currentColor')
        path.setAttribute('stroke-width', p.strokeWidth)
        if (p.strokeLinecap) path.setAttribute('stroke-linecap', p.strokeLinecap)
        if (p.strokeLinejoin) path.setAttribute('stroke-linejoin', p.strokeLinejoin)
      } else {
        path.setAttribute('fill', 'currentColor')
      }
    }
    if (icon.fillRule) {
      path.setAttribute('fill-rule', icon.fillRule)
      path.setAttribute('clip-rule', icon.fillRule)
    }
    svg.appendChild(path)
  }
  return svg
}

/** 描边小图标：dsh web 无对应物的本地扩展图标保留描边风格。 */
export function strokeSvg(paths: string[], size = 14): SVGSVGElement {
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

/**
 * 官方 IconAgentPresetOutline16（dsh-client-ui-primitives）的逐元素复刻：
 * 圆环路径用 mask 在三个节点处镂空。IconDef 不支持 mask，故单独构建。
 */
/** Agent preset 三环图标（官方 IconAgentPresetOutline16，14px）。 */
export function presetIconSvg(): SVGSVGElement {
  return iconSvg(AGENT_PRESET_ICON, 14)
}
