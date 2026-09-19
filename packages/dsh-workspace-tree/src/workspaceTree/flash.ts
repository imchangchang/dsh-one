/**
 * 飘提示（#103）：动作完成/失败时在树区域底部飘一条短文案，几秒后自己消失。
 *
 * 为什么要有它：移入回收站是**立即执行**的（没有确认弹窗），用户需要一个当场可见的
 * 回执；旧侧栏的做法也是飘一条提示（`flashTip`）。这里用模块级信号 + 树里的一个宿主
 * 组件实现——入口行（另一个槽位）也能发提示。
 */
import { createElement as h, useEffect, useState } from 'react'

/** 提示停留时长（毫秒）。 */
const FLASH_MS = 2200

/** 一条提示：文案 + 停留时长（缺省 2.2 秒）。 */
interface FlashNotice {
  message: string
  ms: number
}

const listeners = new Set<(notice: FlashNotice) => void>()

/**
 * 飘一条提示（同一条文案连续发也各飘一次）。
 *
 * `ms` 只给需要读一回事的提示（#145 的「会话被另一个 dsh 占用」是一条要人行动的句子，
 * 2.2 秒读不完），缺省仍是 2.2 秒——动作回执那几条的时长被套件钉着，不能跟着变。
 */
export function flashTip(message: string, ms: number = FLASH_MS): void {
  for (const listener of [...listeners]) listener({ message, ms })
}

/**
 * 提示宿主：挂在树主组件的根节点里（绝对定位在底部）。没有提示时渲染 null。
 * 文案变化时重置计时（新的提示从零开始计时）。
 */
export function FlashHost(): unknown {
  const [state, setState] = useState<{ notice: FlashNotice; seq: number } | null>(null)
  useEffect(() => {
    let seq = 0
    const listener = (notice: FlashNotice): void => {
      seq += 1
      setState({ notice, seq })
    }
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])
  useEffect(() => {
    if (state === null) return
    const timer = setTimeout(() => setState(null), state.notice.ms)
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
    state.notice.message,
  )
}
