/** 分组过滤条（chip 与「＋」新建）。 */
import { createElement as h, useState } from 'react'
import {
  IconEditOutline16,
  IconEllipsisOutline16,
  IconPlusOutline16,
  IconTrashOutline16,
  Menu,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceGroupDef } from '../../../../pure/treeGroups.ts'
import type { Translate } from './types.ts'

// ---------------------------------------------------------------------------
// #81 功能 1/2：分组过滤条 + 工作区行尾的活状态计数
// ---------------------------------------------------------------------------

/**
 * 分组过滤条：一枚「全部」+ 每枚分组 + 一枚「＋」（新建分组）。
 *
 * 为什么是 chip 而不是官方 Menu 里的一节：过滤是一个**一直在的当前选择**（用户要
 * 一眼看出「我现在只看 dsn相关」），菜单里的一节藏起来就看不见了。外观语言仍按
 * 官方来——圆形胶囊、官方 token 颜色、尺寸走密度档（与搜索胶囊同源）。
 * 每枚 chip 悬停出「…」菜单（重命名/删除），走的还是官方 Menu 原语。
 */
/** 一枚过滤 chip（组件而不是 render 期函数：里面有 Menu 的 open 态，需要自己的 hook）。 */
function GroupChip({
  chipKey,
  label,
  active,
  aria,
  tr,
  onPick,
  onRename,
  onDelete,
}: {
  chipKey: string
  label: string
  active: boolean
  aria: string
  tr: Translate
  onPick: () => void
  onRename?: () => void
  onDelete?: () => void
}): unknown {
  const [menuOpen, setMenuOpen] = useState(false)
  const body = h(
    'button',
    {
      type: 'button',
      className: `dshOneTree_chip${active ? ' dshOneTree_chipActive' : ''}`,
      'aria-label': aria,
      'aria-pressed': active,
      'data-dshone-tree-chip': chipKey,
      onClick: onPick,
    },
    label,
  )
  if (onRename === undefined || onDelete === undefined) return h('span', { style: { display: 'inline-flex' } }, body)
  return h(
    'span',
    { style: { display: 'inline-flex', position: 'relative' } },
    body,
    h(Menu, {
      open: menuOpen,
      onClose: () => setMenuOpen(false),
      items: [
        { id: 'rename', label: tr('group.rename'), icon: h(IconEditOutline16, {}) },
        { id: 'delete', label: tr('group.delete'), icon: h(IconTrashOutline16, {}), danger: true },
      ],
      onSelect: (id: string) => {
        setMenuOpen(false)
        if (id === 'rename') onRename()
        if (id === 'delete') onDelete()
      },
      portal: true,
      closeOnPointerLeave: true,
      anchor: h(
        'button',
        {
          type: 'button',
          className: 'dshOneTree_chip dshOneTree_chipAdd',
          'aria-label': `${label} - ${tr('group.filter.aria')}`,
          'data-dshone-tree-chip-menu': chipKey,
          onClick: (event: { stopPropagation(): void }) => {
            event.stopPropagation()
            setMenuOpen((open: boolean) => !open)
          },
        },
        h(IconEllipsisOutline16, {}),
      ),
    }),
  )
}

export function GroupFilterBar({
  groups,
  activeGroupId,
  tr,
  onPick,
  onCreate,
  onRename,
  onDelete,
}: {
  groups: readonly WorkspaceGroupDef[]
  activeGroupId: string | null
  tr: Translate
  onPick: (groupId: string | null) => void
  onCreate: () => void
  onRename: (groupId: string, name: string) => void
  onDelete: (groupId: string, name: string) => void
}): unknown {
  return h(
    'div',
    { className: 'dshOneTree_filterBar', 'data-dshone-tree': 'group-filter', role: 'group', 'aria-label': tr('group.filter.aria') },
    h(GroupChip, {
      key: 'all',
      chipKey: 'all',
      label: tr('group.filter.all'),
      active: activeGroupId === null,
      aria: tr('group.filter.all'),
      tr,
      onPick: () => onPick(null),
    }),
    ...groups.map((group) =>
      h(GroupChip, {
        key: group.id,
        chipKey: group.id,
        label: group.name,
        active: activeGroupId === group.id,
        aria: tr('group.chip.aria', { name: group.name }),
        tr,
        onPick: () => onPick(activeGroupId === group.id ? null : group.id),
        onRename: () => onRename(group.id, group.name),
        onDelete: () => onDelete(group.id, group.name),
      }),
    ),
    h(Tooltip, {
      label: tr('group.new'),
      side: 'bottom',
      delayMs: 500,
      children: h(
        'button',
        {
          type: 'button',
          className: 'dshOneTree_chip dshOneTree_chipAdd',
          'aria-label': tr('group.new'),
          'data-dshone-tree-action': 'group-new',
          onClick: onCreate,
        },
        h(IconPlusOutline16, { size: 14 }),
      ),
    }),
  )
}
