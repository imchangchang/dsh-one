/** 回收站抽屉（数据 = 官方归档集合）。 */
import { createElement as h } from 'react'
import { IconCloseFill14, IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { recycleCount, type RecycleGroup } from '../../../../pure/workspaceTreeView.ts'
import { displayTitle, timeLabel } from './format.ts'
import type { Translate } from './types.ts'

// ---------------------------------------------------------------------------
// #81 功能 3/5：回收站抽屉（数据 = 官方归档集合，见 deriveRecycleGroups）
// ---------------------------------------------------------------------------

/**
 * 回收站抽屉：整块盖住树区（自有渲染，不占官方槽位——官方侧栏没有「抽屉」这样的
 * 座位，硬塞一个新槽会与官方布局插件争地盘）。
 *
 * 内容按工作区组织（`deriveRecycleGroups`），每行一个「还原」——走官方
 * `uiWorkspace.unarchiveSession`（官方 navigation.d.ts 里就有这条，不是我们自造）。
 * 会话标题与时间仍按官方行的呈现（同样的状态点、相对时间）。
 */
export function RecycleDrawer({
  open,
  groups,
  now,
  tr,
  busyId,
  error,
  onClose,
  onOpen,
  onRestore,
}: {
  open: boolean
  groups: readonly RecycleGroup[]
  now: number
  tr: Translate
  busyId: string | null
  error: string | null
  onClose: () => void
  onOpen: (sessionId: string) => void
  onRestore: (sessionId: string) => void
}): unknown {
  if (!open) return null
  const total = recycleCount(groups)
  return h(
    'div',
    { className: 'dshOneTree_drawer', 'data-dshone-tree': 'recycle-drawer', role: 'region', 'aria-label': tr('recycle.title') },
    h(
      'div',
      { className: 'dshOneTree_drawerHeader' },
      h('span', { className: 'dshOneTree_drawerTitle' }, tr('recycle.title')),
      h(
        'button',
        {
          type: 'button',
          className: 'dshOneTree_iconButton',
          'aria-label': tr('recycle.close'),
          'data-dshone-tree-action': 'recycle-close',
          onClick: onClose,
        },
        h(IconCloseFill14, {}),
      ),
    ),
    total === 0
      ? h('div', { className: 'dshOneTree_drawerStatus' }, tr('recycle.empty'))
      : h(
          'div',
          { className: 'dshOneTree_drawerList' },
          groups.map((group) =>
            h(
              'div',
              { className: 'dshOneTree_drawerGroup', key: group.key, 'data-dshone-recycle-group': group.key },
              h('div', { className: 'dshOneTree_drawerGroupLabel' }, group.workspaceId === undefined ? tr('group.ungrouped') : group.label),
              group.sessions.map((node) => {
                const title = displayTitle(node, tr)
                return h(
                  'div',
                  {
                    className: 'dshOneTree_drawerRow',
                    key: node.id,
                    role: 'treeitem',
                    'data-dshone-recycle-row': node.id,
                    onClick: () => onOpen(node.id),
                  },
                  h(
                    'span',
                    { className: 'dshOneTree_title' },
                    title,
                  ),
                  h('span', { className: 'dshOneTree_time' }, timeLabel(node.updatedAt, now, tr)),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dshOneTree_drawerRestore',
                      disabled: busyId !== null,
                      'aria-label': tr('recycle.restore.aria', { name: title }),
                      'data-dshone-recycle-restore': node.id,
                      onClick: (event: { stopPropagation(): void }) => {
                        event.stopPropagation()
                        onRestore(node.id)
                      },
                    },
                    h(IconRefreshOutline16, { size: 14 }),
                    busyId === node.id ? tr('recycle.restoring') : tr('recycle.restore'),
                  ),
                )
              }),
            ),
          ),
        ),
    error === null ? null : h('div', { className: 'dshOneTree_selectionError', role: 'alert' }, error),
  )
}
