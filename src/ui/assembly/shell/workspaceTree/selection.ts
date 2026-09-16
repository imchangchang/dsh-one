/** 批量选择（勾选标记与动作条）。 */
import { createElement as h } from 'react'
import { Button, IconCheckOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from './types.ts'

// ---------------------------------------------------------------------------
// #81 功能 4：批量选择（选择态与批量动作条）
// ---------------------------------------------------------------------------

/**
 * 选中标记（官方圆角方框 + 官方对勾图标；不引第三方复选框件）。
 *
 * `disabled` = 这一行不够格勾选（#102：置顶会话不可勾选，因为它既不能进回收站、
 * 也不能归档）。灰态照旧画在同一枚标记里，点它也不切换（调用方不给切换回调）。
 */
export function SelectMark({ on, disabled }: { on: boolean; disabled?: boolean }): unknown {
  return h(
    'span',
    {
      className:
        `dshOneTree_checkBox${on ? ' dshOneTree_checkOn' : ''}${disabled === true ? ' dshOneTree_checkOff' : ''}`,
    },
    on ? h(IconCheckOutline16, { size: 12 }) : null,
  )
}

/**
 * 选择态的动作条：已选计数 + 两枚动作 + 退出。
 *
 * #103 把两枚动作按**两层语义分开**：移入回收站是本地可逆的（立即执行），归档是终点
 * 动作（先过确认弹窗）。两枚按钮都只是「请求」，执行在树层——同一个动作只有一个执行处。
 *
 * 勾选资格、组头三态全选与操作条的其余形态属另一条并行条目，本件不碰。
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
      h(Button, { variant: 'outline', disabled: busy, onClick: onExit, children: tr('select.exit') }),
    ),
    error === null ? null : h('div', { className: 'dshOneTree_selectionError', role: 'alert' }, error),
  )
}
