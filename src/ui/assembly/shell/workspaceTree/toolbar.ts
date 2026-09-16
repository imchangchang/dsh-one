/** 顶部工具栏（本条先搬视图选项菜单，骨架在 #99 B 段扩为四项）。 */
import { createElement as h, useState } from 'react'
import { IconPersonalizationOutline16, Menu, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from './types.ts'

/** 视图选项菜单（官方 `ViewOptionsMenu`）：分组方式 + 排序方式两节。 */
export function ViewOptionsMenu({
  groupBy,
  orderBy,
  tr,
  onGroupPick,
  onOrderPick,
}: {
  groupBy: 'workspace' | 'flat'
  orderBy: 'manual' | 'updated'
  tr: Translate
  onGroupPick: (mode: 'workspace' | 'flat') => void
  onOrderPick: (mode: 'manual' | 'updated') => void
}): unknown {
  const [open, setOpen] = useState(false)
  return h(Menu, {
    open,
    onClose: () => setOpen(false),
    items: [
      { type: 'label', id: 'group-by', text: tr('groupBy.label') },
      { id: 'workspace', label: tr('groupBy.workspace') },
      { id: 'flat', label: tr('groupBy.flat') },
      { type: 'separator', id: 'order-by-separator' },
      { type: 'label', id: 'order-by', text: tr('orderBy.label') },
      { id: 'manual', label: tr('orderBy.manual') },
      { id: 'updated', label: tr('orderBy.updated') },
    ],
    selectedIds: [groupBy, orderBy],
    onSelect: (id: string) => {
      if (id === 'workspace' || id === 'flat') onGroupPick(id)
      else if (id === 'manual' || id === 'updated') onOrderPick(id)
      setOpen(false)
    },
    align: 'end',
    dense: true,
    portal: true,
    anchor: h(Tooltip, {
      label: tr('viewOptions.label'),
      side: 'bottom',
      delayMs: 500,
      children: h(
        'button',
        {
          type: 'button',
          className: 'dshOneTree_iconButton',
          'aria-label': tr('viewOptions.label'),
          'data-dshone-tree-action': 'view-options',
          onClick: () => setOpen((v: boolean) => !v),
        },
        h(IconPersonalizationOutline16, {}),
      ),
    }),
  })
}
