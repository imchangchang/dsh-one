/**
 * 「已归档」一节（#239）：树里唯一的取消归档入口。
 *
 * ## 为什么要这一节（机制分层与它补的洞）
 *
 * 归档（`uiWorkspace.archiveSession`）是**终点动作**：会话从树里消失。取消归档在官方
 * 两侧各有一代入口，而 dsh-one 的侧栏两代都够不着：
 *
 * - **0.1.6 及以前**：官方把它做在**设置页的一节**里
 *   （`@deepseek-ai/dsh-client-ui-settings-unarchive-sessions` 注册 `settings.section`，
 *   节名「已归档会话」）。我们的设置页照常渲染它，所以那一代用户有路可走——这一节
 *   **不渲染**（判据住 `workspaceTree/archivedSectionStore.ts`）。
 * - **0.1.7 起**：那一件整件从官方产物里没了，官方把取消归档搬进**官方侧栏的会话行菜单**
 *   （新槽位 `sidebar.workspaces.session.menu.item` / `sidebar.workspaces.session.row.action`）。
 *   而 `sidebar.workspaces` 被自有树遮蔽（shadow），那套菜单在 dsh-one 的侧栏里一个都
 *   不渲染——**误归档之后没有任何还原入口**，这正是本条要补的洞。
 *
 * **走的是 AGENTS.md 机制优先序的第 2 层（官方服务 API）**：这里只渲染与点击，
 * 动作本体是官方 `uiWorkspace.unarchiveSession(sessionId)`（缺席时退回官方
 * `workspaces.unarchiveSession`），接线在 `workspaceTreePlugin.ts`。第 1 层（槽位机制）
 * 做不到这件事：官方那套会话菜单的槽位声明在官方条目自己的 `children` 表里，我们这条
 * shadow entry 声明不了同名槽（理由见 `workspaceTreePlugin.ts` 的注入面注释）——那一格
 * 已被官方条目占据，我们只能在自己渲染的树上补这一条。
 *
 * ## 为什么不借用回收站那一层
 *
 * 回收站（`recycle-bin` 键）是**我们自己的本地可逆集合**：移入 / 还原只写那一份 id 列表，
 * dsh 侧一个字节不动。而「归档会话」走的是官方 `archiveSession`（终点动作、会话从 dsh
 * 的列表里消失）。两者是两层语义，**不能混成一条路**——混了就会出现「点了还原，实际去
 * 动 dsh 侧」（或反过来：以为动的只是本地一份表，其实把 dsh 侧的归档记录改了）。所以
 * 这一节**只**列归档集合里的会话、只调官方那条 unarchive，一个字节都不碰回收站。
 *
 * ## 行与动作
 *
 * 行的形态照官方那一节（0.1.6 的 `ArchivedSessionsSection`）：标题 + 时间 + 一枚
 * `Button`（官方 `variant: outline` / `size: sm`，与官方同一档），动作是取消归档。
 * **按钮常显、不从悬停菜单里出**：这是误归档之后唯一的退路，藏起来就等于没有（这一个
 * 判断与「官方 web 侧那一端也要能看出这条路」是同一件事）。归档的会话在 dsh 侧打不开
 * （官方自己那句提示是「已归档对话暂时无法查看，请取消归档后查看」），所以行**不做
 * 点击打开**、也不参与多选与拖拽——它是一份「待还原清单」，不是列表里的会话行。
 */
import { createElement as h } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ArchivedSessionEntry } from '../../../../src/pure/workspaceTreeView.ts'
import { timeLabel } from './format.ts'
import type { Translate } from './types.ts'

/** 会话标题（空白会话显示「新会话」，与树里的行同一份口径）。 */
function titleOf(entry: ArchivedSessionEntry, tr: Translate): string {
  return entry.blank ? tr('session.new') : entry.title
}

export function ArchivedSection({
  entries,
  now,
  tr,
  busyId,
  onUnarchive,
}: {
  entries: readonly ArchivedSessionEntry[]
  now: number
  tr: Translate
  /** 正在取消归档的那一条（那次请求还没回来之前按钮禁用，防连点）。 */
  busyId: string | null
  onUnarchive: (sessionId: string) => void
}): unknown {
  return h(
    'div',
    {
      className: 'dshOneTree_archived',
      // 自有标记（验证套件按它认这一节与它列了几条，不认类名串）。
      'data-dshone-tree-section': 'archived',
      'data-dshone-archived-count': entries.length,
    },
    h(
      'div',
      { className: 'dshOneTree_archivedHead' },
      h('span', { 'data-dshone-tree-section-label': 'archived' }, tr('archived.section')),
      h('span', {}, String(entries.length)),
    ),
    h(
      'div',
      { className: 'dshOneTree_archivedRows' },
      ...entries.map((entry) => {
        const title = titleOf(entry, tr)
        return h(
          'div',
          {
            key: entry.id,
            className: 'dshOneTree_archivedRow',
            // 这一节的行不是树里的会话行（数据面不同、动作也不同），用自己的行种标记。
            'data-dshone-tree-row': 'archived',
            'data-dshone-tree-session': entry.id,
            // 与树里会话行同一处（归档集合里的会话），顺带把「它在归档里」写在行上。
            'data-dshone-tree-archived': 'true',
          },
          h('span', { className: 'dshOneTree_title' }, title),
          h('span', { className: 'dshOneTree_time' }, timeLabel(entry.updatedAt, now, tr)),
          h(
            'span',
            { className: 'dshOneTree_archivedActions' },
            h(
              Button,
              {
                size: 'sm',
                variant: 'outline',
                disabled: busyId === entry.id,
                'aria-label': tr('archived.unarchive.aria', { name: title }),
                'data-dshone-tree-action': 'unarchive',
                onClick: () => onUnarchive(entry.id),
              },
              tr('archived.unarchive'),
            ),
          ),
        )
      }),
    ),
  )
}
