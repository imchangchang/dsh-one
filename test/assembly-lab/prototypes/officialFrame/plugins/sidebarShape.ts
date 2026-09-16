/**
 * `@dsh-one/proto-frame-sidebar`——官方 AppFrame 形态适配原型（sidebar 树，#89）。
 *
 * 形态目标：**只有侧栏、铺满容器**（VS Code 侧栏视图就是一条窄列）。官方 AppFrame 给
 * 侧栏的是一条 264–420px 的网格轨（`computeColumns()` 的 clamp），侧栏根还带一条内联
 * `width`（= 那条轨宽）。本原型用两条 CSS 把它改成「单列铺满」。
 *
 * 另外官方外框在视口 < 1024px 时把侧栏判为「自动收起」——轨道变 56px 图标列、宽内容
 * 整块卸载（`SidebarRoot` 的 `collapsed` 分支）。VS Code 的侧栏视图永远落在这个区间里，
 * 所以这一档必须用官方服务 API（机制层 2：`ctx.layout.toggleSidebar()`）把
 * `narrowExpanded` 打开，否则「铺满」铺的是那条 56px 图标列。
 */
import { injectCss, reportShape, shapeFromLocation } from '../shape.ts'

const ID = '@dsh-one/proto-frame-sidebar'

/** 官方外框的窄容器断点（SIDEBAR_AUTO_COLLAPSE，`columns.ts` 常量）。 */
const SIDEBAR_AUTO_COLLAPSE = 1024

/**
 * 单列铺满：
 * - `grid-template-columns:minmax(0,1fr) 0px 0px`（内联整条覆盖，故必须 `!important`）：
 *   侧栏列吃满宽度，中列与右栏列归零（侧栏树本来就没有主区与右栏）；
 * - 侧栏列去掉 `.5px` 右边线；
 * - 侧栏根的内联 `width`（官方 264–420 钳位值，来自 `renderSlot('sidebar',{width})`）
 *   覆盖成 100%，否则铺满的轨里只画 280px 一列。
 */
const CSS_FILL =
  `div:has(> [data-shell-overlay]){grid-template-columns:minmax(0,1fr) 0px 0px!important}\n` +
  `div:has(> [data-shell-overlay]) > [class*="_sidebarCol"]{border-right:0!important}\n` +
  `div:has(> [data-shell-overlay]) > [class*="_sidebarCol"] > *{width:100%!important}`

interface ShellContext {
  layout: { toggleSidebar(): void }
}

export const inject = ['layout']

export function apply(ctx: ShellContext): void {
  const shape = shapeFromLocation('fill')
  const narrow = window.innerWidth < SIDEBAR_AUTO_COLLAPSE
  // narrowExpanded 是官方 store 里的「窄容器下手动展开」开关：调一次等于用户点了
  // 那条 56px 图标列里的展开钮。
  const toggledNarrow = shape === 'raw' ? false : narrow
  if (toggledNarrow) ctx.layout.toggleSidebar()
  reportShape(ID, {
    shape,
    frameWidth: window.innerWidth,
    narrowAutoCollapse: narrow,
    calledToggleSidebar: toggledNarrow,
    css: shape === 'raw' ? '' : CSS_FILL,
  })
  if (shape === 'raw') return
  injectCss(ID, CSS_FILL)
}
