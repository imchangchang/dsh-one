/**
 * `@dsh-one/proto-frame-chat`——官方 AppFrame 形态适配原型（chat 树，#89）。
 *
 * 形态目标：**零侧栏列**（VS Code 的对话面板没有侧栏），中列 + 官方右栏列照官方语义。
 * 官方侧栏列关不掉（`computeColumns()` 里收起态 = 56px 轨道），所以适配手段按
 * `?shape=` 分三档，量出来的差别就是本原型要回答的问题：
 *
 * - `js`（缺省）：内联轨道改写——只把第一轨归零，第二、三轨原样保留（右栏轨的运行时值
 *   因此活着：右栏打开时中列让出同宽，把手与轨道都在）；
 * - `css0`：纯 CSS `grid-template-columns:0px minmax(0,1fr) 0px!important`——侧栏列确实
 *   没了，但右栏轨也被写成常量 0（右栏面板改成「浮在中列上方」的形态）；
 * - `raw`：什么都不做（官方 AppFrame 原样：侧栏列 280px、窄容器 56px 轨道）。
 */
import { hideSidebarColumnDecor, injectCss, installTrackFix, reportShape, shapeFromLocation, splitTracks, type TrackFixStats } from '../shape.ts'

const ID = '@dsh-one/proto-frame-chat'

/** 纯 CSS 档：三轨全写成常量（第一轨 0 = 去侧栏，第三轨 0 = 右栏不让轨）。 */
const CSS_ZERO = `div:has(> [data-shell-overlay]){grid-template-columns:0px minmax(0,1fr) 0px!important}\n${hideSidebarColumnDecor()}`

/** chat 树形态插件不需要任何服务：只动页面 CSS 与官方 frame 的内联轨道。 */
export const inject: string[] = []

export function apply(): void {
  const shape = shapeFromLocation('js')
  const stats: TrackFixStats = { rewrites: 0, official: '', applied: '' }
  const report = (): void =>
    reportShape(ID, {
      shape,
      jsTrackRewrites: stats.rewrites,
      officialTrack: stats.official,
      appliedTrack: stats.applied,
      css: shape === 'css0' ? CSS_ZERO : shape === 'js' ? hideSidebarColumnDecor() : '',
    })
  report()
  if (shape === 'raw') return
  if (shape === 'css0') {
    injectCss(ID, CSS_ZERO)
    return
  }
  injectCss(ID, hideSidebarColumnDecor())
  installTrackFix(
    (official) => {
      const tracks = splitTracks(official)
      // 官方三轨：<侧栏>px minmax(0,1fr) <右栏>px → 侧栏轨归零，其余照抄。
      return tracks.length === 3 ? `0px ${tracks[1]} ${tracks[2]}` : undefined
    },
    stats,
    report,
  )
}
