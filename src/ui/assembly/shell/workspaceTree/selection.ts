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

/** 选择态的动作条：已选计数 + 移入回收站 + 退出。 */
export function SelectionBar({
  count,
  busy,
  error,
  tr,
  onArchive,
  onExit,
}: {
  count: number
  busy: boolean
  error: string | null
  tr: Translate
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
          onClick: onArchive,
          className: 'dshOneTree_selectionArchive',
          children: busy ? tr('select.archivePending') : tr('select.archive'),
        },
      ),
      h(
        Button,
        { variant: 'outline', disabled: busy, onClick: onExit, children: tr('select.exit') },
      ),
    ),
    error === null ? null : h('div', { className: 'dshOneTree_selectionError', role: 'alert' }, error),
  )
}
