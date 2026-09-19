/** 官方 HoverCard 的渲染判据（容器右侧有没有 244+8px 空处）。 */
import { useEffect, useState } from 'react'

// ---------------------------------------------------------------------------
// 悬停卡（官方 HoverCard 原语）——#85 B 项：容器右侧真有空处时才渲染
//
// 官方几何（0.1.6-alpha.1 官方实现 + css-module，逐字核对）：
// 卡片是 `position:fixed` 的浮层、**固定 244px 宽**，定位 = `left = anchor.right + 8`、
// `top = anchor.top`（只在会超出视口底部时上移，水平方向不夹取、不翻转），
// portal 到 `document.body`。也就是说官方语义是**卡片浮在侧栏右侧的空处**：
// 官方 web 的页面比侧栏宽得多，卡片落在侧栏右边的主区上，压根不压树。
//
// VS Code 侧栏形态下容器**就是**视口（webview 宽度 = 侧栏宽度），行右缘到视口
// 右缘没有 244+8px 的空处，官方定位会落到视口外（被 webview 边界裁掉）。三种
// 处置里选「抑制」，理由：
// - 官方 HoverCard 没有 placement / 翻转 / 夹取入参（只有 anchor / content /
//   openDelayMs / disabled / copyText / copyLabel / copiedLabel），改不了它内部定位；
// - 卡片 244px 宽、约 72px 高的不透明浮层放进侧栏内，就不存在「不压住树」的位置
//   （官方 web 靠浮到侧栏外面避开树，侧栏本身宽度不够）；
// - 用 CSS 把它钉进容器（本仓库 shell 上一版的做法）等于把卡片压在行上——用户
//   验收反馈的「悬停卡遮挡内容」正是这个；
// - 按 #85 给的「窄宽度下降级形态或抑制」走**抑制**：行内仍有标题（超长省略）与
//   相对时间，卡片承载的补充信息（完整标题 / 工作区路径 / 创建时刻）在无空处的
//   宿主里放弃，换「悬停不遮挡任何内容」。
//
// 判据取**容器右缘**（比行右缘保守：行右缘还要让出滚动条槽）——量出余量 ≥ 卡宽 +
// 间隙才渲染浮层。两端同一份判据：官方 web 侧余量充足 → 官方行为原样；VS Code 侧栏
// 恒不足 → 不渲染。
// ---------------------------------------------------------------------------

const HOVER_CARD_WIDTH = 244
const HOVER_CARD_GAP = 8

/** 容器右侧是否有放得下官方悬停卡的空处（随容器尺寸变化重算）。 */
export function useHoverCardRoom(rootRef: { current: HTMLDivElement | null }): boolean {
  const [room, setRoom] = useState(false)
  useEffect(() => {
    const measure = (): void => {
      const el = rootRef.current
      if (el === null) return
      const available = document.documentElement.clientWidth - el.getBoundingClientRect().right
      setRoom(available >= HOVER_CARD_WIDTH + HOVER_CARD_GAP)
    }
    measure()
    const el = rootRef.current
    if (el === null) return
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])
  return room
}
