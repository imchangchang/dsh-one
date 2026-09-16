/** 列表行（分组头行 / 会话行 / 搜索结果行）与行内小件，官方 rows 组件的同构复刻。 */
import { createElement as h, useState } from 'react'
import {
  HoverCard,
  IconArchiveOutline20,
  IconBranchOutline16,
  IconEditOutline16,
  IconEllipsisOutline16,
  IconFolderClose16,
  IconFolderOpen16,
  IconPlusOutline16,
  IconRightUpOutline16,
  IconTrashOutline16,
  IconTriangleRightFill14,
  Menu,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  sessionStatuses,
  showsStatusDot,
  type ActivityCounts,
  type GroupNode,
  type SessionNode,
} from '../../../../pure/workspaceTreeView.ts'
import type { WorkspaceGroupDef } from '../../../../pure/treeGroups.ts'
import { createdLabel, displayTitle, hoverTimeLabel, timeLabel } from './format.ts'
import { GROUP_MENU_PREFIX } from './groups.ts'
import { SelectMark } from './selection.ts'
import type { Translate } from './types.ts'

// ---------------------------------------------------------------------------
// 树的行组件（官方 rows/Rows.js 与 rows/WorkspaceBrowser.js 的同构复刻：
// DOM 结构与 class 语义一一对应，类名换成自有前缀）
// ---------------------------------------------------------------------------
/**
 * #81 功能 6：工作区内的会话**不折叠**。
 *
 * 官方 WorkspaceBrowser 对每个工作区最多渲染 5 条普通会话，其余塞进「Show N more」
 * 一行（官方 `collapsedSessionRows` + `COLLAPSED_SESSION_LIMIT`）。用户明确要求
 * 绕开这个截断：工作区展开就把它的会话全列出来。因此本件**不再调用**
 * `collapsedSessionRows`、也不再渲染那行「显示更多」——相关代码与常量一并删掉，
 * 免得留下「看着像还在用」的死代码。
 *
 * 工作区自身的折叠（分组头点一下收起整块）保留：那是「一次看几个工作区」的层级，
 * 与「一个工作区里看得见几条会话」是两件事。
 */
/** 主状态点 + 全部状态的读屏标签（官方 `SessionStatusDots`）。 */
function SessionStatusDots({ statuses, tr }: { statuses: ReturnType<typeof sessionStatuses>; tr: Translate }): unknown {
  const labels = statuses.map((status) =>
    h(
      'span',
      { className: 'dshOneTree_visuallyHidden', key: status.labelKey },
      status.labelCount === undefined ? tr(status.labelKey) : tr(status.labelKey, { n: status.labelCount }),
    ),
  )
  return h('span', { className: 'dshOneTree_slot' }, h(StateDot, { state: statuses[0].state, className: 'dshOneTree_dot' }), labels)
}

/** 会话行悬停卡（官方 `SessionHoverContent`）：标题 + 相对时间 + 每条活状态。 */
function SessionHoverContent({ node, now, tr }: { node: SessionNode; now: number; tr: Translate }): unknown {
  const statuses = sessionStatuses(node)
  return h(
    'div',
    { className: 'dshOneTree_hoverContent' },
    h('div', { className: 'dshOneTree_hoverTitle' }, displayTitle(node, tr)),
    node.blank ? null : h('div', { className: 'dshOneTree_hoverTime' }, hoverTimeLabel(node.updatedAt, now, tr)),
    statuses.map((status) =>
      h(
        'div',
        { className: 'dshOneTree_hoverStatus', key: status.labelKey },
        h(StateDot, { state: status.state }),
        h('span', null, status.labelCount === undefined ? tr(status.labelKey) : tr(status.labelKey, { n: status.labelCount })),
      ),
    ),
  )
}

/** 工作区行悬停卡（官方 `WorkspaceHoverContent`）：标题 + 路径 + 创建时刻。 */
function WorkspaceHoverContent({
  label,
  cwd,
  createdAt,
  tr,
}: {
  label: string
  cwd?: string
  createdAt?: number
  tr: Translate
}): unknown {
  return h(
    'div',
    { className: 'dshOneTree_hoverContent' },
    h('div', { className: 'dshOneTree_hoverTitle' }, label),
    cwd === undefined ? null : h('div', { className: 'dshOneTree_hoverPath' }, cwd),
    createdAt === undefined ? null : h('div', { className: 'dshOneTree_hoverTime' }, createdLabel(createdAt, tr)),
  )
}

/** 分组头行（官方 `ProjectRowItem`）：文件夹 ⇄ 折叠箭头（悬停换位）+ 标题 + 悬停操作。 */
export function ProjectRow({
  group,
  tr,
  expanded,
  hoverCard,
  counts,
  groups,
  memberOf,
  onToggle,
  onCreate,
  onRename,
  onDelete,
  onToggleGroup,
}: {
  group: GroupNode
  tr: Translate
  expanded: boolean
  /** 容器右侧有空处才渲染官方悬停卡（见 useHoverCardRoom 的取舍说明）。 */
  hoverCard: boolean
  /** 该工作区里「运行中 / 等待交互」的会话数（无则不渲染角标）。 */
  counts?: ActivityCounts
  /** 全部自定义分组（行菜单里的「所属分组」一节）。 */
  groups: readonly WorkspaceGroupDef[]
  /** 本工作区已归属的分组 id。 */
  memberOf: readonly string[]
  onToggle: () => void
  onCreate: () => void
  onRename?: () => void
  onDelete?: () => void
  /** 勾选/取消勾选一个分组的归属（走宿主能力口落盘）。 */
  onToggleGroup: (groupId: string) => void
}): unknown {
  const [menuOpen, setMenuOpen] = useState(false)
  const label = group.workspaceId === undefined ? tr('group.ungrouped') : group.label
  const active = expanded && group.containsCurrent
  // 行菜单 = 原有两项 + 「所属分组」一节（有自定义分组、且本行是真实工作区时才出）。
  // 勾选态走官方 Menu 的 selectedIds（官方 ViewOptionsMenu 同款机制）。
  const groupItems =
    groups.length === 0 || onRename === undefined
      ? []
      : [
          { type: 'separator', id: 'group-separator' },
          { type: 'label', id: 'group-label', text: tr('group.membership') },
          ...groups.map((entry) => ({ id: `${GROUP_MENU_PREFIX}${entry.id}`, label: entry.name })),
        ]
  const menuItems =
    onRename === undefined || onDelete === undefined
      ? null
      : [
          { id: 'rename', label: tr('rename'), icon: h(IconEditOutline16, {}) },
          { id: 'delete', label: tr('delete.workspace'), icon: h(IconTrashOutline16, {}), danger: true },
          ...groupItems,
        ]
  const anchor = h(
    'button',
    {
      type: 'button',
      className: 'dshOneTree_rowIconButton',
      'aria-label': tr('actions.workspace.aria', { name: label }),
      'data-dshone-tree-action': 'workspace-menu',
      onClick: (event: { stopPropagation(): void }) => {
        event.stopPropagation()
        setMenuOpen((open: boolean) => !open)
      },
    },
    h(IconEllipsisOutline16, {}),
  )
  const row = h(
    'div',
    {
      className: `dshOneTree_projectRow${menuOpen ? ' dshOneTree_menuOpen' : ''}`,
      role: 'treeitem',
      'aria-expanded': expanded,
      'data-dshone-tree-row': 'workspace',
      'data-dshone-tree-key': group.key,
      'data-dshone-tree-count': group.sessionCount,
      onClick: onToggle,
      children: [
        h(
          'span',
          {
            key: 'folder',
            className: `dshOneTree_slot dshOneTree_folder${active ? ' dshOneTree_folderActive' : ''}`,
            children: expanded ? h(IconFolderOpen16, {}) : h(IconFolderClose16, {}),
          },
        ),
        h('span', {
          key: 'chevron',
          className: 'dshOneTree_slot dshOneTree_chevron',
          children: h(IconTriangleRightFill14, {
            className: `dshOneTree_arrow${expanded ? ' dshOneTree_arrowOpen' : ''}`,
          }),
        }),
        h('span', {
          key: 'text',
          className: 'dshOneTree_projectText',
          children: h('span', { className: 'dshOneTree_title' }, label),
        }),
        counts === undefined ? null : h(ActivityBadge, { key: 'activity', counts, tr }),
        h('span', {
          key: 'actions',
          className: 'dshOneTree_rowActions',
          children: [
            menuItems === null
              ? null
              : h(Menu, {
                  key: 'menu',
                  open: menuOpen,
                  onClose: () => setMenuOpen(false),
                  items: menuItems,
                  selectedIds: memberOf.map((id) => `${GROUP_MENU_PREFIX}${id}`),
                  onSelect: (id: string) => {
                    if (id.startsWith(GROUP_MENU_PREFIX)) {
                      onToggleGroup(id.slice(GROUP_MENU_PREFIX.length))
                      return
                    }
                    setMenuOpen(false)
                    if (id === 'rename') onRename?.()
                    if (id === 'delete') onDelete?.()
                  },
                  portal: true,
                  closeOnPointerLeave: true,
                  anchor,
                }),
            h(
              'button',
              {
                key: 'new',
                type: 'button',
                className: 'dshOneTree_rowIconButton',
                'aria-label': tr('actions.newSession.aria', { name: label }),
                onClick: (event: { stopPropagation(): void }) => {
                  event.stopPropagation()
                  onCreate()
                },
              },
              h(IconPlusOutline16, {}),
            ),
          ],
        }),
      ],
    },
  )
  if (group.createdAt === undefined || !hoverCard) return row
  return h(HoverCard, {
    anchor: row,
    content: h(WorkspaceHoverContent, { label: group.label, cwd: group.cwd, createdAt: group.createdAt, tr }),
    disabled: menuOpen,
    copyText: group.cwd,
    copyLabel: tr('copy'),
    copiedLabel: tr('hover.copied'),
  })
}

/** 会话行（官方 `SessionNodeItem`）：状态点 + 标题 + （定时标记）+ 相对时间 + 悬停操作。 */
export function SessionRow({
  node,
  currentId,
  now,
  flat,
  hoverCard,
  tr,
  selectMode,
  selected,
  onToggleSelect,
  onOpen,
  onRename,
  onFork,
  onArchive,
  onOpenInNewTab,
}: {
  node: SessionNode
  currentId?: string
  now: number
  flat: boolean
  /** 容器右侧有空处才渲染官方悬停卡（见 useHoverCardRoom 的取舍说明）。 */
  hoverCard: boolean
  tr: Translate
  /** #81 功能 4：批量选择态（点整行 = 勾选/取消，而不是打开会话）。 */
  selectMode: boolean
  selected: boolean
  onToggleSelect: () => void
  onOpen: () => void
  onRename: (title: string) => void
  onFork: () => void
  onArchive: () => void
  /**
   * 「在新标签页打开」（#72 多开通道）。**undefined = 这个宿主没有编辑器标签页**
   * （官方 web 形态）：菜单项不出现、行右键也不接管（不抢浏览器原生右键菜单）。
   */
  onOpenInNewTab?: (() => void) | undefined
}): unknown {
  const [menuOpen, setMenuOpen] = useState(false)
  /** 行右键的指针位置：有值时菜单挂在指针处（官方 Menu 的 getAnchorRect 口）。 */
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const title = displayTitle(node, tr)
  const isCurrent = node.id === currentId
  const statuses = sessionStatuses(node)
  const showStatus = showsStatusDot(statuses, node.completed)
  const openInNewTabItem =
    onOpenInNewTab === undefined
      ? []
      : [
          {
            id: 'openInNewTab',
            // 标记属性（自有契约）：菜单项类名是官方哈希，验证套件与样式都不该认它，
            // 按这个属性取「我们那一项」（与 contextMenuPlugin 的图标项同一做法）。
            label: h('span', { 'data-dshone-tree-item': 'openInNewTab' }, tr('menu.openInNewTab')),
            // 图标取官方 primitives 的 IconRightUpOutline16（向右上离开方框 = 到别处打开），
            // 与官方行菜单项同为 16 档、同为 icon 槽位的次级色。
            icon: h(IconRightUpOutline16, {}),
          },
        ]
  const menuItems = [
    { id: 'rename', label: tr('rename'), icon: h(IconEditOutline16, {}) },
    { id: 'fork', label: tr('menu.fork'), icon: h(IconBranchOutline16, {}) },
    ...openInNewTabItem,
    { id: 'archive', label: tr('menu.archiveSession'), icon: h(IconArchiveOutline20, { size: 16 }) },
  ]
  const anchor = h(
    'button',
    {
      type: 'button',
      className: 'dshOneTree_rowIconButton',
      'aria-label': tr('actions.session.aria', { name: title }),
      'data-dshone-tree-action': 'session-menu',
      onClick: (event: { stopPropagation(): void }) => {
        event.stopPropagation()
        setMenuAt(null)
        setMenuOpen((open: boolean) => !open)
      },
    },
    h(IconEllipsisOutline16, {}),
  )
  // 选择态下整行只有「勾选」一个动作：打开会话、行菜单都先让位（与官方进入选择态
  // 后的处置一致——动作条在底部集中给批量动作）。
  const row = h(
    'div',
    {
      className:
        `dshOneTree_sessionRow${(selectMode ? selected : isCurrent) ? ' dshOneTree_selected' : ''}${menuOpen ? ' dshOneTree_menuOpen' : ''}` +
        `${flat && !showStatus && !selectMode ? ' dshOneTree_flatRowWithoutStatus' : ''}`,
      role: 'treeitem',
      'aria-selected': selectMode ? selected : isCurrent,
      'data-dshone-tree-row': 'session',
      // 行上的活状态（供验证套件把「工作区行尾的计数」与「行内真实状态」对照）：
      // 等待交互 > 运行中 > 空闲，与状态点的优先级同源。
      'data-dshone-tree-status':
        node.pendingInteraction !== undefined ? 'waiting' : node.running ? 'running' : 'idle',
      ...(selectMode ? { 'data-dshone-tree-checked': selected } : {}),
      onClick: selectMode ? onToggleSelect : onOpen,
      // 行右键开出同一份菜单（指针位置锚定）。三条不接管的线：
      // - 多开不可用的宿主（官方 web）：那里没有这一项可给，抢掉原生右键菜单只是添乱；
      // - 空白会话行（`node.blank`）：官方对这类行整个不给行菜单（见下面 actions 的
      //   `node.blank ? null`），接了右键却没有菜单可弹，只会白白吃掉原生菜单；
      // - 选择态：整行只有「勾选」一个动作（同上面 onClick 的处置）。
      onContextMenu:
        node.blank || onOpenInNewTab === undefined || selectMode
          ? undefined
          : (event: { preventDefault(): void; stopPropagation(): void; clientX: number; clientY: number }) => {
              event.preventDefault()
              event.stopPropagation()
              setMenuAt({ x: event.clientX, y: event.clientY })
              setMenuOpen(true)
            },
      children: [
        selectMode
          ? h('span', { key: 'check', className: 'dshOneTree_check' }, h(SelectMark, { on: selected }))
          : !flat || showStatus
            ? showStatus
              ? h(SessionStatusDots, { key: 'status', statuses, tr })
              : h('span', { key: 'status', className: 'dshOneTree_slot' })
            : null,
        h('span', { key: 'title', className: 'dshOneTree_title' }, title),
        node.blank || selectMode
          ? null
          : h('span', {
              key: 'time',
              className: 'dshOneTree_time',
              children: timeLabel(node.updatedAt, now, tr),
            }),
        node.blank || selectMode
          ? null
          : h('span', {
              key: 'actions',
              className: 'dshOneTree_rowActions',
              children: h(Menu, {
                open: menuOpen,
                onClose: () => {
                  setMenuAt(null)
                  setMenuOpen(false)
                },
                items: menuItems,
                onSelect: (id: string) => {
                  setMenuAt(null)
                  setMenuOpen(false)
                  if (id === 'rename') onRename(node.title)
                  if (id === 'fork') onFork()
                  if (id === 'openInNewTab') onOpenInNewTab?.()
                  if (id === 'archive') onArchive()
                },
                portal: true,
                closeOnPointerLeave: true,
                anchor,
                // 行右键开的那一份：菜单锚在指针处（官方 Menu 的 getAnchorRect
                // 优先于 anchor 的矩形，官方自己的右键菜单也是这么用的）。
                ...(menuAt === null ? {} : { getAnchorRect: () => new DOMRect(menuAt.x, menuAt.y, 0, 0) }),
              }),
            }),
      ],
    },
  )
  if (!hoverCard || selectMode) return row
  return h(HoverCard, {
    anchor: row,
    content: h(SessionHoverContent, { node, now, tr }),
    disabled: menuOpen,
    copyText: node.blank ? undefined : node.title,
    copyLabel: tr('copy'),
    copiedLabel: tr('hover.copied'),
  })
}

/** 搜索结果行（官方 `SearchResultItem`）：标题 + 工作区 + 内容片段。 */
export function SearchResultRow({
  node,
  workspaceLabel,
  snippet,
  selected,
  tr,
  onOpen,
}: {
  node: SessionNode
  workspaceLabel: string
  snippet?: string
  selected: boolean
  tr: Translate
  onOpen: () => void
}): unknown {
  const statuses = sessionStatuses(node)
  const showStatus = showsStatusDot(statuses, node.completed)
  return h(
    'button',
    {
      type: 'button',
      className: `dshOneTree_searchRow${selected ? ' dshOneTree_selected' : ''}`,
      role: 'treeitem',
      'aria-selected': selected,
      onClick: onOpen,
      children: [
        h('span', {
          key: 'heading',
          className: 'dshOneTree_searchRowHeading',
          children: [
            showStatus
              ? h(SessionStatusDots, { key: 'status', statuses, tr })
              : h('span', { key: 'status', className: 'dshOneTree_slot' }),
            h('span', { key: 'title', className: 'dshOneTree_searchRowTitle' }, displayTitle(node, tr)),
          ],
        }),
        h('span', {
          key: 'meta',
          className: 'dshOneTree_searchRowMeta',
          children: [
            h('span', { key: 'ws', className: 'dshOneTree_searchRowWorkspace' }, workspaceLabel || tr('group.ungrouped')),
            snippet === undefined || snippet === ''
              ? null
              : h('span', { key: 'snip', className: 'dshOneTree_searchRowSnippet' }, snippet),
          ],
        }),
      ],
    },
  )
}
/**
 * 工作区行尾的活状态计数（#81 功能 2）：运行中 / 等待交互。
 *
 * 绝对定位（不吃行的横向空间）：官方该行没有这个元素，正常流里插一个会把标题挤窄，
 * 而 F-04 PARITY 逐项比对标题的几何矩形——绝对定位让「官方有的东西」保持一致，
 * 我们新增的东西不改变它们；行悬停时让它消失（悬停位置留给官方那组行操作按钮，
 * 与官方会话行「悬停时时间让位」同一处置）。
 */
function ActivityBadge({ counts, tr }: { counts: ActivityCounts; tr: Translate }): unknown {
  return h(
    'span',
    {
      className: 'dshOneTree_activity',
      'data-dshone-tree-activity': `${String(counts.running)}/${String(counts.waiting)}`,
    },
    counts.running > 0
      ? h(
          'span',
          { className: 'dshOneTree_activityItem', 'data-dshone-tree-running': counts.running, title: tr('activity.running', { n: counts.running }) },
          h(StateDot, { state: 'ongoing' }),
          String(counts.running),
        )
      : null,
    counts.waiting > 0
      ? h(
          'span',
          { className: 'dshOneTree_activityItem', 'data-dshone-tree-waiting': counts.waiting, title: tr('activity.waiting', { n: counts.waiting }) },
          h(StateDot, { state: 'warning' }),
          String(counts.waiting),
        )
      : null,
  )
}
