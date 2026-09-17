/**
 * 列表给滚动条留的**真实车道**（#168）——把当页量到的占位写回 CSS 变量。
 *
 * 为什么要有这个模块：#142 给顶栏那一行算右内缩时，用了声明在 `.dshOneTree_root` 上的
 * 常量 `--dsh-session-list-scrollbar-width: 8px`（当时按「列表真的被滚动条吃掉一格」写死）。
 * 但**滚动条占不占宽是宿主平台的事**：macOS 的滚动条是浮层（不占宽，车道为 0），
 * Windows 上是实占（车道 8px）。常量在浮层那一侧多算 8px，顶栏的内容右缘于是比列表行的
 * 内容右缘多缩进 8px（用户实测到的偏差，见 #168）。
 *
 * 真值只有一个来源：**当页列表自己**。滚动条占的那一格就是 `offsetWidth − clientWidth`
 * （`offsetWidth` 含滚动条，`clientWidth` 不含），浮层滚动条下两者相等、差为 0。量到多少
 * 就写回变量，消费方（顶栏那一行、列表自己的右内边距）一个像素都不用改。
 *
 * 量与重量的时机：
 * - 每次提交后同步量一次（`useLayoutEffect`，在绘制前）——首次挂载就写对，不出现「先按
 *   8px 画一帧、再跳 8px」的闪动；列表内容变化引起的重排也顺手覆盖；
 * - 另外观察列表的**内容盒**（`ResizeObserver` 的 `content-box`）：容器被拖动、窗口变化、
 *   平台换了滚动条形态这些**不是 React 引起**的变化走这一路。观测必须选内容盒——滚动条
 *   占位变化时列表的边框盒宽一动不动，默认的 border-box 观察不到。
 */
import { useEffect, useLayoutEffect } from 'react'

/** 车道写在哪个变量上：`.dshOneTree_root` 声明、顶栏那一行与列表两处消费（见 styles.ts）。 */
const LANE_VARIABLE = '--dsh-session-list-scrollbar-width'
const LIST_SELECTOR = '.dshOneTree_list'

/** 量一次当页列表的真实车道并写回变量；量不到元素时什么都不做（保留声明值）。 */
function measureLane(root: HTMLElement): void {
  const list = root.querySelector(LIST_SELECTOR)
  if (!(list instanceof HTMLElement)) return
  const lane = list.offsetWidth - list.clientWidth
  const written = `${lane}px`
  if (root.style.getPropertyValue(LANE_VARIABLE) === written) return
  root.style.setProperty(LANE_VARIABLE, written)
}

/** 让整棵树（顶栏那一行与列表）跟着**当页滚动条的真实占位**走。 */
export function useScrollbarLane(rootRef: { current: HTMLDivElement | null }): void {
  useLayoutEffect(() => {
    const root = rootRef.current
    if (root !== null) measureLane(root)
  })
  useEffect(() => {
    const root = rootRef.current
    if (root === null) return
    const list = root.querySelector(LIST_SELECTOR)
    if (!(list instanceof HTMLElement) || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => measureLane(root))
    observer.observe(list, { box: 'content-box' })
    return () => observer.disconnect()
  }, [])
}
