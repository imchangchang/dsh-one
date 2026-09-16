/** 批量选择：进入多选的入口 API、勾选标记（含组头三态）、动作条。 */
import { createElement as h } from 'react'
import { Button, IconCheckOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from './types.ts'

// ---------------------------------------------------------------------------
// #81 功能 4：批量选择（选择态与批量动作条）
// #108：入口收成一个可调用的 API、勾选标记扩出组头三态、动作条挪到分组过滤条下方
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 进入多选的**入口 API**
//
// 「进选择态」这件事有多个入口（顶部工具栏那一枚、会话行菜单的「选择多个」、将来的
// 行右键菜单），而选择态本身住在树主组件里。与底部回收站入口行同一处置（见
// `recycleEntry.ts` 的文件头）：同一个插件、同一份 bundle，用一个模块级的订阅点把
// 请求传过去——不查 DOM、不新增槽位、不跨插件借状态。
//
// 入口只有一个「进入」动作，**不要**再各写一份 setSelectMode：入口每次进入都清空上
// 一轮勾选（与旧侧栏 `enterSelectionMode` 同义），退出走树内的 `exitSelection`。
// ---------------------------------------------------------------------------
const listeners = new Set<() => void>()

export const selectionEntrySignal = {
  /** 进入多选（任何入口都调这一个；调用即清空上一轮勾选）。 */
  enter(): void {
    for (const listener of [...listeners]) listener()
  },
  /** 树主组件挂载时订阅入口请求（返回退订）。 */
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}

/**
 * 选中标记（官方圆角方框 + 官方对勾图标；不引第三方复选框件）。
 *
 * `disabled` = 这一行不够格勾选（#102：置顶会话不可勾选，因为它既不能进回收站、
 * 也不能归档）。灰态照旧画在同一枚标记里，点它也不切换（调用方不给切换回调）。
 *
 * `partial` = 组头的**部分选中**态（#108 的三态：none / some / all）。官方 primitives
 * 里没有减号类图标（按 0.1.6-alpha.1 的 combo 核实：`IconMinus*` / `IconRemove*` /
 * `IconSubtract*` 零命中），所以这一态画成同一枚方框里的短横线。
 */
export function SelectMark({
  on,
  partial,
  disabled,
}: {
  on: boolean
  /** 部分选中（`some`）：方框填色 + 一条短横线。`on` 为真时以 `on` 为准。 */
  partial?: boolean
  disabled?: boolean
}): unknown {
  const filled = on || partial === true
  return h(
    'span',
    {
      className:
        `dshOneTree_checkBox${filled ? ' dshOneTree_checkOn' : ''}${disabled === true ? ' dshOneTree_checkOff' : ''}`,
    },
    on ? h(IconCheckOutline16, { size: 12 }) : partial === true ? h('span', { className: 'dshOneTree_checkDash' }) : null,
  )
}

/**
 * 选择态的动作条：已选计数 + 两枚动作 + 退出。
 *
 * #103 把两枚动作按**两层语义分开**：移入回收站是本地可逆的（立即执行），归档是终点
 * 动作（先过确认弹窗）。两枚按钮都只是「请求」，执行在树层——同一个动作只有一个执行处。
 *
 * 位置由树主组件决定（#108：插在**分组过滤条下方**，见 `tree.ts` 的渲染顺序）。
 * 失败时的红字也在这条里（`error`），与勾选一起留在屏幕上（不静默、不清空勾选）。
 */
export function SelectionBar({
  count,
  busy,
  error,
  tr,
  onMoveToRecycleBin,
  onArchive,
  onExit,
}: {
  count: number
  busy: boolean
  error: string | null
  tr: Translate
  /** 批量移入回收站（本地可逆，立即执行 + 飘提示 + 结束选择态）。 */
  onMoveToRecycleBin: () => void
  /** 批量归档（不可逆）：开确认弹窗。 */
  onArchive: () => void
  onExit: () => void
}): unknown {
  return h(
    'div',
    { className: 'dshOneTree_selectionBarWrap', 'data-dshone-tree': 'selection-bar' },
    h(
      'div',
      { className: 'dshOneTree_selectionBar' },
      h('span', { className: 'dshOneTree_selectionCount' }, count === 0 ? tr('select.none') : tr('select.count', { n: count })),
      h(
        Button,
        {
          variant: 'outline',
          disabled: busy || count === 0,
          onClick: onMoveToRecycleBin,
          className: 'dshOneTree_selectionArchive',
          'data-dshone-tree-action': 'selection-recycle',
          children: tr('select.moveToRecycleBin'),
        },
      ),
      h(
        Button,
        {
          variant: 'outline',
          disabled: busy || count === 0,
          onClick: onArchive,
          'data-dshone-tree-action': 'selection-archive',
          children: tr('select.archivePermanent'),
        },
      ),
      h(Button, {
        variant: 'outline',
        disabled: busy,
        onClick: onExit,
        'data-dshone-tree-action': 'selection-exit',
        children: tr('select.exit'),
      }),
    ),
    error === null ? null : h('div', { className: 'dshOneTree_selectionError', role: 'alert' }, error),
  )
}
