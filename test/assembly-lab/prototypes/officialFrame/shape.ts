/**
 * 原型形态适配的公共件（#89 评估原型：只做 VS Code 形态适配，不碰生产代码）。
 *
 * ## 官方 AppFrame 长什么样（0.1.6-alpha.1，读 `dsh-client-ui-layout/lib/client.js`）
 *
 * ```
 * <div class="<hash>_frame" style="grid-template-columns: <侧栏>px minmax(0,1fr) <右栏>px">
 *   <div class="<hash>_sidebarCol">…</div>            ← 轨 1：官方侧栏壳（ui-sidebar）
 *   <div class="<hash>_centerCol">…</div>             ← 轨 2：keyed `main`（会话面板 / 全局面板）
 *   <div class="<hash>_rightbarCol" data-rightbar-col>…</div>  ← 轨 3：右栏（面板自己绝对定位贴右缘）
 *   <div class="<hash>_overlayLayer" data-shell-overlay>…</div> ← 绝对定位，不占轨
 *   <div class="<hash>_handle" data-side="sidebar|rightbar">…</div> ← 绝对定位拖拽把手
 * </div>
 * ```
 *
 * 三条轨道的事实（决定形态适配能用什么手段）：
 * - 整条 `grid-template-columns` 由 AppFrame 写成**内联样式**，且侧栏轨 / 右栏轨都是
 *   运行时值（右栏轨 = `computeColumns()` 的解算结果，跟视口与面板宽走）；
 * - 列装饰（侧栏底色、`.5px` 右边缘）在 **css-module 哈希类名**上；
 * - 侧栏列**关不掉**：官方 `computeColumns()` 里 `sidebar === 0` 是「收起态 = 56px 轨道」，
 *   官方语义里最小就是这条 24px 图标列 + 两侧 16px 内边距。
 *
 * 因此「把某一列去掉 / 让某一列铺满」只能压内联样式：
 * - **纯 CSS** 只能整条改 `grid-template-columns`（`!important`），于是右栏轨一并变成常量；
 * - **要保住右栏轨的运行时值**，就得在 DOM 层改写这条内联属性的前两段——本原型两种都做了，
 *   量出来的差别见 README 与 #89 决策记录。
 *
 * 定位官方 frame 元素只用**官方语义属性** `[data-shell-overlay]`（AppFrame 给 overlay 层
 * 打的标记，官方 UI 里唯一稳定的锚点），不写死 css-module 哈希前缀；列元素按类名后缀匹配
 * （`[class*="_sidebarCol"]`），这是实验室既有约定。
 */

/** 官方 AppFrame 根元素（含 `data-shell-overlay` 子节点的那层）。 */
export const FRAME_SELECTOR = 'div:has(> [data-shell-overlay])'

/** 官方侧栏列元素（轨 1）。 */
const SIDEBAR_COL_SELECTOR = 'div:has(> [data-shell-overlay]) > [class*="_sidebarCol"]'

/** 形态档（URL `?shape=` 选）：raw = 不做适配（官方原样），其余见各插件注释。 */
export type ShapeMode = string

/** 从页面 URL 取形态档（缺省由调用方给）。 */
export function shapeFromLocation(fallback: ShapeMode): ShapeMode {
  const value = new URLSearchParams(globalThis.location.search).get('shape')
  return value === null || value === '' ? fallback : value
}

/** 把形态观测记在 `<html data-proto-shape>` 上（run.ts 读它，不引入全局变量）。 */
export function reportShape(id: string, payload: Record<string, unknown>): void {
  const merged = { plugin: id, ...payload }
  document.documentElement.dataset.protoShape = JSON.stringify(merged)
}

/** 注入一段插件 CSS（与自有插件的注入方式一致：`style[data-plugin-css]` 去重）。 */
export function injectCss(id: string, css: string): void {
  if (document.querySelector(`style[data-plugin-css="${id}"]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = id
  tag.dataset.pluginCss = id
  tag.textContent = css
  document.head.appendChild(tag)
}

/** 侧栏列去掉可见装饰（轨宽归零后只剩这半像素边线与底色会露出来）。 */
export function hideSidebarColumnDecor(): string {
  return `${SIDEBAR_COL_SELECTOR}{border-right:0!important;background:transparent!important}`
}

/**
 * 按括号配对切 `grid-template-columns` 的轨道（`minmax(0, 1fr)` 里有空格，
 * 不能按空白裸切）。
 */
export function splitTracks(value: string): string[] {
  const tracks: string[] = []
  let depth = 0
  let current = ''
  for (const char of value) {
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (depth === 0 && /\s/.test(char)) {
      if (current !== '') tracks.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current !== '') tracks.push(current)
  return tracks
}

/** 轨道改写结果（台账读它：改写几次、官方写的值是什么、我们写成什么）。 */
export interface TrackFixStats {
  /** 每次官方重渲染后重新改写都算一次——次数即「与 React 争写内联样式」的实测值。 */
  rewrites: number
  official: string
  applied: string
}

/**
 * 内联轨道改写器：官方每次重渲染写 `grid-template-columns`，我们按 `transform` 改写它。
 * 只对 `div:has(> [data-shell-overlay])` 生效；改写后 React 侧的值没变时不会再写回
 * （React 比对的是它自己的上一次 props），所以不是每帧争用。
 */
export function installTrackFix(
  transform: (official: string) => string | undefined,
  stats: TrackFixStats,
  onChange?: () => void,
): void {
  const fix = (element: HTMLElement): void => {
    const official = element.style.gridTemplateColumns
    if (official === '') return
    const next = transform(official)
    if (next === undefined || next === official) return
    stats.rewrites += 1
    stats.official = official
    stats.applied = next
    element.style.gridTemplateColumns = next
    onChange?.()
  }
  const observed = new WeakSet<Element>()
  const observe = (element: HTMLElement): void => {
    if (observed.has(element)) return
    observed.add(element)
    fix(element)
    new MutationObserver(() => fix(element)).observe(element, { attributes: true, attributeFilter: ['style'] })
  }
  const scan = (): number => {
    const frames = Array.from(document.querySelectorAll<HTMLElement>(FRAME_SELECTOR))
    for (const frame of frames) observe(frame)
    return frames.length
  }
  if (scan() > 0) return
  // frame 还没渲染出来：盯到第一个为止（AppFrame 一挂上就撤掉这个观察者）。
  const pending = new MutationObserver(() => {
    if (scan() > 0) pending.disconnect()
  })
  pending.observe(document.documentElement, { childList: true, subtree: true })
}
