/** 列表行（分组头行 / 会话行 / 搜索结果行）与行内小件，官方 rows 组件的同构复刻。 */
import { createElement as h, useState } from 'react'
import {
  HoverCard,
  IconAlarmClockOutline16,
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
import {
  canRecycle,
  cannotArchiveReason,
  cannotRecycleReason,
  sessionBusy,
  type GroupSelectionState,
  type SessionBlockReason,
  type SessionEligibilityFacts,
} from '../../../../pure/sessionEligibility.ts'
import { createdLabel, displayTitle, hoverTimeLabel, timeLabel } from './format.ts'
import { GROUP_MENU_PREFIX, TAG_MENU_PREFIX } from './groups.ts'
import { SelectMark } from './selection.ts'
import type { Translate } from './types.ts'

// ---------------------------------------------------------------------------
// #102 两种用户标记的行内呈现：图钉（置顶）与未读圆点
//
// 图标为什么是自绘 SVG 而不是官方图标件：官方 primitives 0.1.6-alpha.1 的导出表
// 里**没有图钉、也没有未读/已读**（逐个看过那一份 80 个 `Icon*` 名字），而 #98 的
// 需求是「回放旧侧栏的两个标记」。所以这里沿用旧侧栏自己的两条描边路径
// （`sessionsWebview.ts` 的 `PIN_ICON` / `UNREAD_ICON`，同 16 视框 / 1.3 描边 /
// round 端点），观感与旧侧栏逐字一致。
// ---------------------------------------------------------------------------
const PIN_PATHS = ['M5.9 2.5h4.2l.6 3.8 1.8 1.7v1.5h-9V8l1.8-1.7.6-3.8z', 'M8 9.5v4']
const UNREAD_PATHS = ['M8 2.6a5.4 5.4 0 1 0 0 10.8 5.4 5.4 0 0 0 0-10.8z']

function strokeIcon(paths: readonly string[]): unknown {
  return h(
    'svg',
    { viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', 'aria-hidden': true },
    ...paths.map((d, index) =>
      h('path', {
        key: String(index),
        d,
        stroke: 'currentColor',
        'stroke-width': '1.3',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      }),
    ),
  )
}

/** 置顶标记（标题前的常驻图钉）。 */
function PinMark({ sessionId }: { sessionId: string }): unknown {
  return h('span', { className: 'dshOneTree_pin', 'data-dshone-tree-pin': sessionId, 'aria-hidden': true }, strokeIcon(PIN_PATHS))
}

/** 手动未读标记（行尾绿点已在状态点那一档，这里只管菜单项与搜索行的图标）。 */
function UnreadIcon(): unknown {
  return strokeIcon(UNREAD_PATHS)
}

/**
 * 把行上看到的事实拼成资格判定要吃的那一份（置顶与未读住在插件状态里，不在官方
 * 会话快照里，所以要由这里并进来，见 `pure/sessionEligibility.ts`）。
 */
function eligibilityOf(node: SessionNode, pinned: boolean, unread: boolean): SessionEligibilityFacts {
  return {
    pinned,
    running: node.running,
    runningSubagentCount: node.runningSubagentCount,
    unread,
    ...(node.pendingInteraction === undefined ? {} : { pendingInteraction: node.pendingInteraction }),
  }
}

/** 归档被拦的原因 → 文案键（置顶 / 等用户 / 运行中 / 未读四种，旧侧栏同款文案）。 */
function archiveBlockKey(reason: SessionBlockReason): string {
  return `protect.archive.${reason}`
}

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
function SessionHoverContent({
  node,
  now,
  tr,
  unread,
}: {
  node: SessionNode
  now: number
  tr: Translate
  /** #102：与行上的状态点同口径（未读那条在悬停卡里也读作「未读」，不是「空闲」）。 */
  unread: boolean
}): unknown {
  const statuses = sessionStatuses({ ...node, unread })
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

/**
 * 活跃定时任务标记（官方 `ActiveScheduleIndicator`，#110 补渲染）：闹钟图标 +
 * 无障碍/悬停文案（`schedule.active`）。数据来自官方 list 投影
 * （`SessionNode.hasActiveSchedule`），只读展示；行本身仍是唯一动作。
 *
 * 位置也照官方：**标题之后、相对时间之前**（官方 rows 的 `row.hasActiveSchedule &&`）。
 * 搜索结果行用的是同一个件，只多一个 `searchScheduleIndicator` 变体类（贴标题、
 * 不留右外边距，官方 `Rows.module.css` 原值）。
 */
function ActiveScheduleIndicator({ tr, search = false }: { tr: Translate; search?: boolean }): unknown {
  const label = tr('schedule.active')
  return h(
    'span',
    {
      className: `dshOneTree_scheduleIndicator${search ? ' dshOneTree_searchScheduleIndicator' : ''}`,
      role: 'img',
      'aria-label': label,
      title: label,
      'data-dshone-tree-schedule': '',
    },
    h(IconAlarmClockOutline16, {}),
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
  selectMode,
  checkState,
  checkTip,
  checkDisabled,
  onToggleSelect,
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
  /**
   * #108：批量选择态。组头在文件夹图标前出一枚**三态全选框**（与旧侧栏同款：框在
   * 最前，文件夹与折叠箭头照常保留），行内其余动作（⋯ / ＋ / 悬停卡）不动它们——
   * 组头那几件与「选中哪些会话」是两件事，让位反而少了一条入口。
   */
  selectMode?: boolean
  /** #108：这一组的三态（`groupSelectionState` 的产物，组内有置顶时最满只能 some）。 */
  checkState?: GroupSelectionState
  /** #108：三态框的悬停提示（为什么这一组选不满）。 */
  checkTip?: string
  /** #108：这一组一条都勾不上（全被置顶挡住）时框画灰、点了也不动。 */
  checkDisabled?: boolean
  /** #108：点三态框（`none`/`some` → 补齐到本组最大值；`all` → 取消全选本组）。 */
  onToggleSelect?: () => void
}): unknown {
  const [menuOpen, setMenuOpen] = useState(false)
  const label = group.workspaceId === undefined ? tr('group.ungrouped') : group.label
  const active = expanded && group.containsCurrent
  const state: GroupSelectionState = checkState ?? 'none'
  const checkLabel =
    state === 'all'
      ? tr('select.group.all', { name: label })
      : state === 'some'
        ? tr('select.group.some', { name: label })
        : tr('select.group.none', { name: label })
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
      // #108：组头三态的当前值写在行上（验证套件按行读，不认官方哈希类名）。
      ...(selectMode === true ? { 'data-dshone-tree-check': state } : {}),
      onClick: onToggle,
      children: [
        // #108：三态全选框（旧侧栏的处置：框在最前，文件夹与折叠箭头照常保留）。
        // 点框只勾选、不折叠（stopPropagation），所以我们自己做一枚可点元素而不是
        // 让整行承接——组头的整行点击仍是「展开/收起」。
        selectMode !== true
          ? null
          : h(
              'span',
              {
                key: 'check',
                className: 'dshOneTree_check dshOneTree_groupCheck',
                role: 'checkbox',
                'aria-checked': state === 'all' ? 'true' : state === 'some' ? 'mixed' : 'false',
                'aria-label': checkLabel,
                'aria-disabled': checkDisabled === true,
                'data-dshone-tree-action': 'group-select',
                'data-dshone-tree-check': state,
                // 提示挂在框上（行上挂会让整行都冒出原生气泡）。
                ...(checkTip === undefined ? {} : { title: checkTip }),
                onClick: (event: { stopPropagation(): void }) => {
                  event.stopPropagation()
                  if (checkDisabled !== true) onToggleSelect?.()
                },
              },
              h(SelectMark, {
                on: state === 'all',
                partial: state === 'some',
                disabled: checkDisabled === true,
              }),
            ),
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
  if (group.createdAt === undefined || !hoverCard || selectMode === true) return row
  return h(HoverCard, {
    anchor: row,
    content: h(WorkspaceHoverContent, { label: group.label, cwd: group.cwd, createdAt: group.createdAt, tr }),
    disabled: menuOpen,
    copyText: group.cwd,
    copyLabel: tr('copy'),
    copiedLabel: tr('hover.copied'),
  })
}

/**
 * 会话行（官方 `SessionNodeItem`）：状态点 + 标题 + （定时标记）+ 相对时间 + 悬停操作。
 *
 * #103 起行菜单里**两项分开**：「移入回收站」（本地可逆，只有置顶禁用）与「归档会话」
 * （走官方 `archiveSession`，**归档 = 删除**，置顶/运行中/有后代在跑/未读/待交互都禁用）。
 * 资格判定在纯模块 `pure/sessionEligibility.ts` 里（与勾选框、组头三态、批量动作同一份），
 * 这里只把原因翻成文案；`data-dshone-disabled-reason` 把判定结果写在菜单项上，验证套件
 * 按它核对「原因 ↔ 禁用 ↔ 原因提示」三者一致。
 */
export function SessionRow({
  node,
  currentId,
  now,
  flat,
  hoverCard,
  tr,
  selectMode,
  selected,
  pinned,
  unread,
  onToggleSelect,
  onOpen,
  onRename,
  onFork,
  onMoveToRecycleBin,
  onArchive,
  onTogglePin,
  onToggleUnread,
  onOpenInNewTab,
  tagItems,
  tagSelectedIds,
  onTagSelect,
  dragProps,
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
  /** #102：这一行在置顶 id 集合里（标题前出常驻图钉、菜单项变「取消置顶」）。 */
  pinned: boolean
  /** #102：这一行在手动未读 id 集合里（绿点 + 标题加粗、菜单项变「标为已读」）。 */
  unread: boolean
  onToggleSelect: () => void
  onOpen: () => void
  onRename: (title: string) => void
  onFork: () => void
  /** 移入回收站（本地可逆，不动 dsh 侧）。 */
  onMoveToRecycleBin: () => void
  /** 归档会话（= 删除，不可逆）：树层据此开确认弹窗。 */
  onArchive: () => void
  /** #102：置顶 / 取消置顶（写宿主机能力口的 `pinned` 键）。 */
  onTogglePin: () => void
  /** #102：标为未读 / 标为已读（写宿主能力口的 `unread` 键）。 */
  onToggleUnread: () => void
  /**
   * 「在新标签页打开」（#72 多开通道）。**undefined = 这个宿主没有编辑器标签页**
   * （官方 web 形态）：菜单项不出现、行右键也不接管（不抢浏览器原生右键菜单）。
   */
  onOpenInNewTab?: (() => void) | undefined
  /**
   * #107 标签组一节（分隔线 + 小标题 + 本工作区的标签组 + 「不归入标签组」+
   * 「新建标签组…」）。由树层按这一行所属的工作区拼好——行的菜单里加一节与前缀
   * 判定都走 `TAG_MENU_PREFIX`，本件不认标签组模型，只把它当一组菜单项渲染。
   */
  tagItems?: readonly unknown[] | undefined
  /** 这一行的标签组项勾选态（官方 Menu 的 selectedIds）。 */
  tagSelectedIds?: readonly string[] | undefined
  /** 选中一个标签组项（id 已去掉 `TAG_MENU_PREFIX`）。 */
  onTagSelect?: ((id: string) => void) | undefined
  /**
   * 行上的拖拽属性（`draggable` + 往 DataTransfer 里写会话 id 的处理器）由树层拼好
   * ——MIME 常量的正本在 `tagGroups.ts`，本件不认识它，避免 rows ↔ tagGroups 互相 import。
   */
  dragProps?: Record<string, unknown> | undefined
}): unknown {
  const [menuOpen, setMenuOpen] = useState(false)
  /** 行右键的指针位置：有值时菜单挂在指针处（官方 Menu 的 getAnchorRect 口）。 */
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const title = displayTitle(node, tr)
  const isCurrent = node.id === currentId
  // 资格判定（#102）：勾选 / 移入回收站 / 归档三条线的口径都在 pure 模块里，这里只取结果。
  const facts = eligibilityOf(node, pinned, unread)
  const selectable = canRecycle(facts)
  const archiveBlocked = cannotArchiveReason(facts)
  // 运行中（或后代在跑）的会话不能手动改未读：读起来就矛盾（跑着跑着「标为未读」）。
  const unreadBlocked = sessionBusy(facts)
  const statuses = sessionStatuses({ ...node, unread })
  const showStatus = showsStatusDot(statuses, node.completed || unread)
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
  // 「移入回收站」与「归档」是两层语义，各自一份判定结果（同吃上面那份 facts）。
  const recycleBlocked = cannotRecycleReason(facts)
  const menuItems = [
    { id: 'rename', label: tr('rename'), icon: h(IconEditOutline16, {}) },
    // #102 两项标记动作：文案随状态翻转，勾选态走官方 Menu 的 selectedIds（✓）。
    // 禁用时的原因写在 label 节点的 title 上：官方 Menu 的项只有 label / icon /
    // disabled / danger / submenu 几个槽，没有独立的提示槽（项渲染见官方 primitives
    // 的 `Menu`），所以提示只能挂在 label 元素上。
    {
      id: 'pin',
      label: h('span', { 'data-dshone-tree-item': 'pin' }, pinned ? tr('menu.unpin') : tr('menu.pin')),
      icon: strokeIcon(PIN_PATHS),
    },
    {
      id: 'unread',
      label: h(
        'span',
        {
          'data-dshone-tree-item': 'unread',
          ...(unreadBlocked ? { title: tr('menu.unreadBlocked') } : {}),
        },
        unread ? tr('menu.markRead') : tr('menu.markUnread'),
      ),
      icon: h(UnreadIcon, {}),
      disabled: unreadBlocked,
    },
    { id: 'fork', label: h('span', { 'data-dshone-tree-item': 'fork' }, tr('menu.fork')), icon: h(IconBranchOutline16, {}) },
    ...openInNewTabItem,
    // 「移入回收站」= 本地可逆的一层（#103）：只有置顶被拦；运行中 / 未读 / 待交互都能移进去
    // （进去还能还原），所以它的判定结果与下面「归档」分开算。
    {
      id: 'move-to-recycle-bin',
      label: h(
        'span',
        {
          'data-dshone-tree-item': 'move-to-recycle-bin',
          'data-dshone-disabled-reason': recycleBlocked ?? '',
          ...(recycleBlocked === null ? {} : { title: tr(`protect.recycle.${recycleBlocked}`) }),
        },
        tr('menu.moveToRecycleBin'),
      ),
      icon: h(IconTrashOutline16, {}),
      disabled: recycleBlocked !== null,
    },
    // 「归档会话」= 终点动作（#103 的归档 = 删除）：置顶与「状态还在动」的都不许归档。
    {
      id: 'archive',
      label: h(
        'span',
        {
          'data-dshone-tree-item': 'archive',
          'data-dshone-disabled-reason': archiveBlocked ?? '',
          ...(archiveBlocked === null ? {} : { title: tr(archiveBlockKey(archiveBlocked)) }),
        },
        tr('menu.archiveSession'),
      ),
      icon: h(IconArchiveOutline20, { size: 16 }),
      disabled: archiveBlocked !== null,
    },
    // #107 标签组一节：列在本工作区的那几个组 + 「不归入标签组」+「新建标签组…」。
    // 与工作区行的「所属分组」一节同一形态（官方 Menu 的 separator + label + 勾选项），
    // 只是项 id 走另一个前缀（`TAG_MENU_PREFIX`）。
    ...(tagItems ?? []),
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
  // 后的处置一致——批量动作集中在分组过滤条下方那一条里给）。
  const row = h(
    'div',
    {
      className:
        `dshOneTree_sessionRow${(selectMode ? selected : isCurrent) ? ' dshOneTree_selected' : ''}${menuOpen ? ' dshOneTree_menuOpen' : ''}` +
        `${flat && !showStatus && !selectMode ? ' dshOneTree_flatRowWithoutStatus' : ''}`,
      role: 'treeitem',
      'aria-selected': selectMode ? selected : isCurrent,
      'data-dshone-tree-row': 'session',
      // 行上带的会话 id（与工作区行的 `data-dshone-tree-key` 同一个用途：验证套件据此
      // 认行，不用去猜 DOM 顺序；#103 的回收站套件也用它把「挪走的那条」与抽屉里的
      // 行、与宿主状态存储里的 id 对上）。
      'data-dshone-tree-session': node.id,
      // 行上的活状态（供验证套件把「工作区行尾的计数」与「行内真实状态」对照）：
      // 等待交互 > 运行中 > 空闲，与状态点的优先级同源。
      'data-dshone-tree-status':
        node.pendingInteraction !== undefined ? 'waiting' : node.running ? 'running' : 'idle',
      // 置顶行不可勾选（#102）：选择态下点它不切换勾选（勾选框本身也带提示）。
      // `data-dshone-tree-check` 把资格写在行上（验证套件按行读），提示在勾选框上。
      ...(selectMode
        ? { 'data-dshone-tree-checked': selected, 'data-dshone-tree-check': selectable ? 'eligible' : 'blocked' }
        : {}),
      // #107：把这一行拖进/拖出标签组（拖拽属性由树层拼，见 dragProps 的说明）。
      // 选择态不给拖：那时候整行只有「勾选」一个动作。
      ...(selectMode ? {} : (dragProps ?? {})),
      onClick: selectMode ? (selectable ? onToggleSelect : () => {}) : onOpen,
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
          ? h(
              'span',
              {
                key: 'check',
                className: 'dshOneTree_check',
                // 置顶会话不可勾选（#102 保护规则）：勾选是「批量移入回收站」的前置，
                // 而置顶不允许进回收站也不允许归档——所以最满也只勾得上它以外的行。
                // 原因提示挂在勾选框上（行上挂会让整行都冒出原生气泡）。
                ...(selectable ? {} : { title: tr('protect.recycle.pinned') }),
              },
              h(SelectMark, { on: selected, disabled: !selectable }),
            )
          : !flat || showStatus
            ? showStatus
              ? h(SessionStatusDots, { key: 'status', statuses, tr })
              : h('span', { key: 'status', className: 'dshOneTree_slot' })
            : null,
        pinned ? h(PinMark, { key: 'pin', sessionId: node.id }) : null,
        h('span', { key: 'title', className: `dshOneTree_title${unread ? ' dshOneTree_unread' : ''}` }, title),
        // 活跃定时任务标记（#110，官方 `row.hasActiveSchedule &&` 同位置：标题后、时间前）。
        node.hasActiveSchedule ? h(ActiveScheduleIndicator, { key: 'schedule', tr }) : null,
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
                // 勾选态（官方 Menu 的 selectedIds：✓ 由官方渲染）：两项标记动作 +
                // 本行的标签组归属（#107）。
                selectedIds: [...(pinned ? ['pin'] : []), ...(unread ? ['unread'] : []), ...(tagSelectedIds ?? [])],
                onSelect: (id: string) => {
                  setMenuAt(null)
                  setMenuOpen(false)
                  if (id.startsWith(TAG_MENU_PREFIX)) {
                    onTagSelect?.(id.slice(TAG_MENU_PREFIX.length))
                    return
                  }
                  if (id === 'rename') onRename(node.title)
                  if (id === 'pin') onTogglePin()
                  if (id === 'unread') onToggleUnread()
                  if (id === 'fork') onFork()
                  if (id === 'openInNewTab') onOpenInNewTab?.()
                  if (id === 'move-to-recycle-bin') onMoveToRecycleBin()
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
    content: h(SessionHoverContent, { node, now, tr, unread }),
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
  selectMode,
  selected,
  pinned,
  unread,
  tr,
  onOpen,
  onToggleSelect,
}: {
  node: SessionNode
  workspaceLabel: string
  snippet?: string
  /**
   * #108（C8）：选择态下的搜索结果行同样可勾选——点行 = 勾选，勾选资格与树里的会话行
   * 同一份判定（`canRecycle`）。搜索态是「在全部会话里找」，与分组视图是两个视图，
   * 所以这里按行算资格，不接组头那套三态（搜索结果没有分组头）。
   */
  selectMode: boolean
  /** 选择态下 = 是否被勾选；非选择态 = 是否是当前会话（与树里的会话行同一口径）。 */
  selected: boolean
  /** #102：与树里的会话行同一套标记呈现（图钉 + 未读绿点 + 加粗）。 */
  pinned: boolean
  unread: boolean
  tr: Translate
  onOpen: () => void
  /** 点整行 = 勾选/取消（与树里的会话行同一处置）。 */
  onToggleSelect: () => void
}): unknown {
  const statuses = sessionStatuses({ ...node, unread })
  const showStatus = showsStatusDot(statuses, node.completed || unread)
  const selectable = canRecycle(eligibilityOf(node, pinned, unread))
  return h(
    'button',
    {
      type: 'button',
      className: `dshOneTree_searchRow${selected ? ' dshOneTree_selected' : ''}`,
      role: 'treeitem',
      // 行标记（自有契约）：验证套件按它数「结果里有几行」——与树里的会话行
      // `data-dshone-tree-row="session"` 同一个用途（F-12/F-18 都读它）。
      'data-dshone-tree-row': 'search',
      'aria-selected': selected,
      // 行上带的会话 id 与勾选态（与树里的会话行同一套标记，验证套件据此认行）。
      'data-dshone-tree-session': node.id,
      ...(selectMode
        ? { 'data-dshone-tree-checked': selected, 'data-dshone-tree-check': selectable ? 'eligible' : 'blocked' }
        : {}),
      onClick: selectMode ? (selectable ? onToggleSelect : () => {}) : onOpen,
      children: [
        h('span', {
          key: 'heading',
          className: 'dshOneTree_searchRowHeading',
          children: [
            selectMode
              ? h(
                  'span',
                  {
                    key: 'check',
                    className: 'dshOneTree_check',
                    ...(selectable ? {} : { title: tr('protect.recycle.pinned') }),
                  },
                  h(SelectMark, { on: selected, disabled: !selectable }),
                )
              : showStatus
                ? h(SessionStatusDots, { key: 'status', statuses, tr })
                : h('span', { key: 'status', className: 'dshOneTree_slot' }),
            pinned ? h(PinMark, { key: 'pin', sessionId: node.id }) : null,
            h(
              'span',
              { key: 'title', className: `dshOneTree_searchRowTitle${unread ? ' dshOneTree_unread' : ''}` },
              displayTitle(node, tr),
            ),
            // 同样补上活跃定时任务标记（官方 `SearchResultItem` 的 `search: true` 变体）。
            node.hasActiveSchedule ? h(ActiveScheduleIndicator, { key: 'schedule', tr, search: true }) : null,
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
