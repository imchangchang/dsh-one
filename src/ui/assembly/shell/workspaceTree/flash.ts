/**
 * 飘提示（#103）：动作完成/失败时在树区域底部飘一条短文案，几秒后自己消失。
 *
 * 为什么要有它：移入回收站是**立即执行**的（没有确认弹窗），用户需要一个当场可见的
 * 回执；旧侧栏的做法也是飘一条提示（`flashTip`）。这里用模块级信号 + 树里的一个宿主
 * 组件实现——入口行（另一个座位）也能发提示。
 */
import { createElement as h, useEffect, useState } from 'react'

/** 提示停留时长（毫秒）。 */
const FLASH_MS = 2200

const listeners = new Set<(message: string) => void>()

/** 飘一条提示（同一条文案连续发也各飘一次）。 */
export function flashTip(message: string): void {
  for (const listener of [...listeners]) listener(message)
}

/**
 * 提示宿主：挂在树主组件的根节点里（绝对定位在底部）。没有提示时渲染 null。
 * 文案变化时重置计时（新的提示从零开始计时）。
 */
export function FlashHost(): unknown {
  const [state, setState] = useState<{ message: string; seq: number } | null>(null)
  useEffect(() => {
    let seq = 0
    const listener = (message: string): void => {
      seq += 1
      setState({ message, seq })
    }
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])
  useEffect(() => {
    if (state === null) return
    const timer = setTimeout(() => setState(null), FLASH_MS)
    return () => clearTimeout(timer)
  }, [state?.seq])
  if (state === null) return null
  return h(
    'div',
    {
      className: 'dshOneTree_flash',
      role: 'status',
      'data-dshone-tree': 'flash',
    },
    state.message,
  )
}
