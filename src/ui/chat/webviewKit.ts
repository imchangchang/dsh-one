/**
 * Chat webview 前端基础工具（零共享状态）：DOM 构造、SVG 图标、markdown
 * 渲染。从 webview.ts 拆出——这些函数无模块级状态、不依赖渲染上下文，
 * 任何域模块都能引用。webview.ts 里剩余的渲染/交互逻辑按域拆到
 * webviewPopover / webviewSlash / webviewMenus 等。
 */
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { FromWebviewMessage } from '../../pure/chatContract.ts'
import { FISH_LOGO, type IconDef } from './icons.ts'

interface VsCodeApi {
  postMessage(message: FromWebviewMessage): void
}
declare function acquireVsCodeApi(): VsCodeApi

export const vscode = acquireVsCodeApi()

/** 向宿主 post 消息（webview 唯一出口；各域模块共用）。 */
export function post(message: FromWebviewMessage): void {
  vscode.postMessage(message)
}

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

/** 文档描边图标（待发送文件 chip 的类型小图标，本地扩展）。 */
export const FILE_ICON = ['M4.2 2h4.6L12 5.2V14H4.2z', 'M8.8 2v3.2H12']

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
export function presetIconSvg(): SVGSVGElement {
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

export function spinSvg(): SVGSVGElement {
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

/**
 * 品牌鱼标 svg：官方 FishLogo 组件（dsh-client-ui-primitives）的镜像——
 * 宽度 size、高度按 17.04/23.16 等比，className 调用方给。
 */
export function fishLogoSvg(size: number, className: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String((size * 17.04) / 23.16))
  svg.setAttribute('viewBox', FISH_LOGO.viewBox ?? '0 0 23.16 17.04')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('aria-hidden', 'true')
  svg.classList.add(className)
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', FISH_LOGO.paths[0] as string)
  path.setAttribute('fill', 'currentColor')
  svg.appendChild(path)
  return svg
}

export function md(text: string): string {
  // 默认 URI 白名单之外放行 dsh-session:，mention 链接才能活到 decorate 那步。
  return DOMPurify.sanitize(marked.parse(text, { async: false }), {
    ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|dsh-session):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
  })
}

/** 一个代码块主体（<pre><code>，文本走 textContent 防注入）。 */
export function mdCodeBody(text: string): HTMLPreElement {
  const pre = el('pre') as HTMLPreElement
  const code = el('code')
  code.textContent = text
  pre.appendChild(code)
  return pre
}
