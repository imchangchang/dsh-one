/**
 * 无限周期 CSS 动画的「相位续播」（chat webview 与 sessions webview 共用）。
 *
 * 增量对账/快照重建会新建元素，新建节点让 CSS animation 从 0 重新开始——流式
 * 期间快照 ~100ms 一帧，转圈/闪烁动画每帧被打回起点，视觉上就是疯狂刷新。给
 * 新建元素补一个负 animation-delay（= 当前时刻在周期里的相位），新元素从旧
 * 元素的相位继续，观感即连续（周期 animation 相位对齐等价于节点保活，且能
 * 覆盖元素被重建的任意场景）。
 */
export function syncAnimPhase(el: HTMLElement | SVGElement, periodMs: number): void {
  el.style.animationDelay = `${-(performance.now() % periodMs)}ms`
}

/** 转圈 spinner（.spinner，0.9s/圈）：创建即对齐相位，见 syncAnimPhase。 */
export function spinnerEl(): HTMLSpanElement {
  const s = document.createElement('span')
  s.className = 'spinner'
  syncAnimPhase(s, 900)
  return s
}

/**
 * 运行中像素环：复刻官方 dsh web StateDot(ongoing)——10×10 画布上 8 个
 * 2×2 方块沿环排布，各自带负的 animationDelay 错相，配合 .session-spin 的
 * chase keyframes（各 bundle 的 CSS）形成转圈追逐效果。
 */
export const SPIN_CELLS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [4, 0],
  [8, 0],
  [8, 4],
  [8, 8],
  [4, 8],
  [0, 8],
  [0, 4],
]

export function spinSvg(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', '10')
  svg.setAttribute('height', '10')
  svg.setAttribute('viewBox', '0 0 10 10')
  svg.setAttribute('shape-rendering', 'crispEdges')
  svg.classList.add('session-spin')
  const phase = -(performance.now() % 1000)
  SPIN_CELLS.forEach(([x, y], i) => {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    rect.setAttribute('x', String(x))
    rect.setAttribute('y', String(y))
    rect.setAttribute('width', '2')
    rect.setAttribute('height', '2')
    // 原有错相（-N..-1 步 × 125ms）保留，叠加全局相位：每格从自己该在的
    // 相位续播（周期 1s），快照重建不再从头闪。
    rect.style.animationDelay = `${phase + (i - SPIN_CELLS.length) * 125}ms`
    svg.appendChild(rect)
  })
  return svg
}
