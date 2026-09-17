/** 列表行（分组头行 / 会话行 / 搜索结果行）与行内小件，官方 rows 组件的同构复刻。 */
import { createElement as h, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  HoverCard,
  IconAlarmClockOutline16,
  IconArchiveOutline20,
  IconBranchOutline16,
  IconCheckOutline16,
  IconChecklistOutline14,
  IconCopyOutline16,
  IconEditOutline16,
  IconEllipsisOutline16,
  IconFolderClose16,
  IconFolderOpen16,
  IconFolderOpenOutline16,
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

// ---------------------------------------------------------------------------
// #109 终端图标（工作区行 hover 的「终端打开」）
//
// 为什么是自绘 SVG：官方 primitives 0.1.6-alpha.1 的 79 个 `Icon*` 名字里**没有终端
// 图标**（逐个看过那一份导出表：有 IconBrowseOutline16 / IconCodeOutline16 /
// IconPanelLeftOutline16 等，没有任何 terminal/shell/console 字样的件）。所以这一枚
// 沿用旧侧栏自己那三条填充路径（`src/ui/shared/icons.ts` 的 `terminal`：外框 + 提示符
// `>_`），与 #102 的图钉/未读同一处置、同一份出处。
// ---------------------------------------------------------------------------
const TERMINAL_PATHS = [
  'M2 1.5h12A1.5 1.5 0 0 1 15.5 3v10A1.5 1.5 0 0 1 14 14.5H2A1.5 1.5 0 0 1 .5 13V3A1.5 1.5 0 0 1 2 1.5zm0 1.3a.2.2 0 0 0-.2.2v10c0 .11.09.2.2.2h12a.2.2 0 0 0 .2-.2V3a.2.2 0 0 0-.2-.2H2z',
  'M3.6 4.9l2.6 2.6-2.6 2.6.9.9 3.5-3.5L4.5 4z',
  'M7.2 10.6h4.6v1.3H7.2z',
]

/** 终端图标（填充路径，evenodd——旧侧栏同一份）。 */
function TerminalIcon(): unknown {
  return h(
    'svg',
    { viewBox: '0 0 16 16', width: 16, height: 16, fill: 'currentColor', 'fill-rule': 'evenodd', 'aria-hidden': true },
    ...TERMINAL_PATHS.map((d, index) => h('path', { key: String(index), d })),
  )
}

/**
 * 二级菜单的子项（#109 的「移到分组…」/「分组…」共用）：**勾选态画在图标槽上**。
 *
 * 为什么不用官方 Menu 的 `selectedIds` 勾选：读官方 Menu 的渲染（0.1.6-alpha.1 的
 * `lib/client.js` 里 `selectedIds` 那一支）——它只对**顶层项**画那个 ✓，`submenu` 子项
 * 只渲染 `icon` + `label` 两个槽，所以子项的勾选只能由我们放进 `icon` 槽（旧侧栏的
 * `.menu-item.checked` 也正是把勾画在图标位上）。`data-dshone-group-checked` 把状态写在
 * label 上，验证套件据此核对「勾选态 ↔ 归属 ↔ 就地翻转」。
 */
function submenuChild(options: {
  /** 选择回调收到的 id（`<前缀><组 id>`）。 */
  id: string
  /** 组 id（写给 DOM 的属性，验证套件据此认组）。 */
  target: string
  name: string
  checked: boolean
  /** label 上的 `data-dshone-tree-item` 标记（两个菜单各一枚）。 */
  marker: string
}): unknown {
  return {
    id: options.id,
    label: h(
      'span',
      {
        'data-dshone-tree-item': options.marker,
        'data-dshone-group-target': options.target,
        'data-dshone-group-checked': options.checked ? 'true' : 'false',
      },
      options.name,
    ),
    ...(options.checked ? { icon: h(IconCheckOutline16, { size: 12 }) } : {}),
  }
}

/**
 * 给二级菜单的子项加一层缩进（#126）：子项本体由树层拼好（#107 的标签组项），本件只做
 * 两件事——把 label 包一层带标记类的 span、给没有图标的项补一个空的图标槽。
 *
 * 缩进由样式落在**整行**上（styles.ts 里那条 `[role="menuitem"]:has(.dshOneTree_submenuItem)`）：
 * 官方 Menu 的项是一条「图标槽 + 文字 + 勾」的流水线，只把文字右推会让子项的图标与自己的
 * 文字脱开（色块贴在左边、文字隔 20px 远）；而官方项对象只认
 * `{id, label, icon, disabled, danger, type, submenu}` 这几个字段（0.1.6-alpha.1 的
 * `lib/client.js` 里渲染项的那一段：字段逐个取用、没有 className / style 这类口），
 * 所以缩进只能落在官方那个 `<button role="menuitem">` 盒子上——用 :has() 从我们自己的
 * 标记类去选它的祖先项，不依赖任何官方哈希类名。走的是第 4 层（CSS/DOM）机制：
 * 前三层都没有「给就地展开的子项缩进」这个口（官方 `submenu` 是右侧飞出的一层，
 * 窄侧栏里放不下，见 submenuChild 的说明）。
 *
 * 空图标槽是**为了让文字落进同一列**：有图标的子项（标签组的色块）比没图标的子项
 * （「不归入标签组」/「新建标签组」/ 未勾选的「分组…」子项）多占一个图标槽的宽
 * （紧凑档的图标位 14px + 项内间隙 6px），补上它，全部子项的文字左缘才落在同一个值上；
 * 顺带钉住「勾选态 ✓ 出现时文字不位移」——✓ 画在图标槽里（见 submenuChild 的说明），
 * 有了常驻的空槽，勾与不勾的文字位置一致。
 */
function indentSubmenuItem(item: unknown): unknown {
  if (typeof item !== 'object' || item === null) return item
  const record = item as { label?: unknown; icon?: unknown }
  return {
    ...record,
    // 官方项的图标槽是 flex:none 的 14×14 盒子（紧凑档 `._itemIcon_1nxmc_144`）：
    // 空 span 塞进去不画东西、只占位。
    icon: record.icon ?? h('span', { className: 'dshOneTree_submenuIconGap', 'aria-hidden': true }),
    label: h('span', { className: 'dshOneTree_submenuItem' }, record.label ?? null),
  }
}

/** 二级菜单的父项：点一下就地展开/收起（右端一个 ▸/▾ 指示），不关菜单。 */
function submenuParent(options: { id: string; label: string; open: boolean }): unknown {
  return {
    id: options.id,
    label: h(
      'span',
      { 'data-dshone-tree-item': options.id },
      options.label,
      h('span', { className: 'dshOneTree_submenuArrow', 'aria-hidden': true }, options.open ? '\u25be' : '\u25b8'),
    ),
    // 图标位取紧凑档的 14×14（官方 `._itemIcon_1nxmc_144`），见文件里各菜单项的同一处置。
    icon: h(IconFolderOpenOutline16, { size: 14 }),
  }
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

/**
 * 分组头行（官方 `ProjectRowItem` 的同构复刻）：文件夹 ⇄ 折叠箭头（悬停换位）+ 标题 +
 * 悬停操作。
 *
 * ## #109：hover 四按钮 + 右键菜单（两个菜单共用一份 items）
 * - **hover 四按钮**（顺序按用户给的截图）：＋ 新建会话 / 终端打开 / 在 VS Code 打开
 *   （**仅非当前工作区**时出现）/ 从列表移除。后三枚按能力口如实上报决定出不出现
 *   （官方 web 形态没有编辑器窗口与集成终端，那三枚就没有）；未分组桶只有 ＋（它没有
 *   路径，终端与打开文件夹无从谈起）。
 * - **右键七项**（#109 的六项 + 保留的「重命名工作区」，顺序见菜单里的 items 注释）。
 *   「分组…」是**就地展开**的二级菜单（父项点一下把子项追加到同一份 items 紧后面，
 *   子项点击不关菜单 = ✓ 就地翻转）。**不用官方 `Menu` 的 `submenu` 槽**：实测那一槽
 *   渲染出来的是右侧飞出的一层，窄侧栏里会被边缘裁掉（理由与截图见 submenuChild）。
 * - **⋯ 按钮撤掉**：它的三项内容（所属分组 / 重命名 / 删除工作区）现在是右键菜单里
 *   的子集，而截图要求的 hover 形态是四枚按钮——留着就是第五枚（旧侧栏的工作区行也
 *   只有这四枚，菜单走右键）。
 */

/** 分组头行（官方 `ProjectRowItem`）：文件夹 ⇄ 折叠箭头（悬停换位）+ 标题 + 悬停操作。 */
export function ProjectRow({
  group,
  tr,
  expanded,
  hoverCard,
  counts,
  groups,
  memberOf,
  shellName,
  canArchiveAll,
  onToggle,
  onCreate,
  onOpenTerminal,
  onOpenFolder,
  onArchiveAll,
  onCopyFolderRef,
  onCopyPath,
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
  /** 全部自定义分组（右键菜单里「分组…」二级菜单的条目）。 */
  groups: readonly WorkspaceGroupDef[]
  /** 本工作区已归属的分组 id。 */
  memberOf: readonly string[]
  /** 这套宿主是什么（`'vscode'` / `'web'`，写在当前工作区那枚胶囊上）。 */
  shellName: string
  /** 这个工作区里有没有够格归档的会话（菜单里的「归档全部会话」按它禁用）。 */
  canArchiveAll: boolean
  onToggle: () => void
  onCreate: () => void
  /** 在宿主里打开这个工作区的集成终端（能力缺席 = undefined，那一枚按钮不渲染）。 */
  onOpenTerminal?: (() => void) | undefined
  /** 在宿主编辑器窗口里打开这个文件夹（能力缺席 = undefined，两处入口都不渲染）。 */
  onOpenFolder?: ((options: { newWindow: boolean }) => void) | undefined
  /** 归档这个工作区里的全部会话（开确认弹窗，资格判定在树层）。 */
  onArchiveAll: () => void
  /** 复制这个工作区的文件夹引用 / 路径（拿不到路径的行不给这两项）。 */
  onCopyFolderRef: () => void
  onCopyPath: () => void
  onRename?: () => void
  onDelete?: () => void
  /** 勾选/取消勾选一个分组的归属（走宿主能力口落盘；二级菜单里就地翻转 ✓、不关菜单）。 */
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
  /** 「分组…」二级菜单展开着没有（就地展开，见 submenuParent 的说明；菜单关掉即收起）。 */
  const [submenuOpen, setSubmenuOpen] = useState(false)
  /** 行右键的指针位置：有值时菜单挂在指针处（官方 Menu 的 getAnchorRect 口）。 */
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const label = group.workspaceId === undefined ? tr('group.ungrouped') : group.label
  const active = expanded && group.containsCurrent
  const state: GroupSelectionState = checkState ?? 'none'
  const checkLabel =
    state === 'all'
      ? tr('select.group.all', { name: label })
      : state === 'some'
        ? tr('select.group.some', { name: label })
        : tr('select.group.none', { name: label })
  const ungrouped = group.workspaceId === undefined
  const hasPath = group.cwd !== undefined
  // 「分组…」二级菜单：有自定义分组、且本行是真实工作区时才出（未分组桶没有工作区身份，
  // 归不进任何工作区分组）。没有分组时**整项不出现**（#109 的口径，与「移到分组…」一致）。
  const groupChildren = groups.map((entry) =>
    submenuChild({
      id: `${GROUP_MENU_PREFIX}${entry.id}`,
      target: entry.id,
      name: entry.name,
      checked: memberOf.includes(entry.id),
      marker: 'workspace-group-item',
    }),
  )
  const menuItems: unknown[] = [
    // 标题行：操作对象显式化（瞄错行时点下去之前就能发现）。
    {
      type: 'label',
      id: 'workspace-title',
      text: h('span', { 'data-dshone-tree-item': 'menu-title' }, tr('menu.workspaceTitle', { name: label })),
    },
    // 未分组桶没有路径与工作区身份，能做的只有它自己那两件（新建会话 / 整桶归档）。
    ...(ungrouped
      ? [{ id: 'new-session', label: h('span', { 'data-dshone-tree-item': 'new-session' }, tr('menu.newSession')), icon: h(IconPlusOutline16, { size: 14 }) }]
      : []),
    ...(hasPath
      ? [
          {
            id: 'copy-folder-ref',
            label: h('span', { 'data-dshone-tree-item': 'copy-folder-ref' }, tr('menu.copyFolderReference')),
            icon: h(IconCopyOutline16, { size: 14 }),
          },
        ]
      : []),
    // 「分组…」二级菜单：父项点一下就地展开，子项紧跟在它后面（勾选态走 selectedIds 的 ✓）。
    ...(groupChildren.length > 0 && !ungrouped
      ? [
          submenuParent({ id: 'groups', label: tr('menu.groups'), open: submenuOpen }),
          ...(submenuOpen ? groupChildren.map((item) => indentSubmenuItem(item)) : []),
        ]
      : []),
    {
      id: 'archive-all',
      label: h(
        'span',
        {
          'data-dshone-tree-item': 'archive-all',
          'data-dshone-disabled-reason': canArchiveAll ? '' : 'no-eligible',
          ...(canArchiveAll ? {} : { title: tr('menu.archiveBlocked') }),
        },
        ungrouped ? tr('menu.archiveUngrouped') : tr('menu.archiveWorkspace'),
      ),
      icon: h(IconArchiveOutline20, { size: 14 }),
      disabled: !canArchiveAll,
    },
    ...(hasPath && onOpenFolder !== undefined
      ? [
          {
            id: 'open-new-window',
            label: h('span', { 'data-dshone-tree-item': 'open-new-window' }, tr('menu.openFolderInNewWindow')),
            icon: h(IconRightUpOutline16, { size: 14 }),
          },
        ]
      : []),
    ...(hasPath
      ? [
          {
            id: 'copy-path',
            label: h('span', { 'data-dshone-tree-item': 'copy-path' }, tr('menu.copyPath')),
            icon: h(IconCopyOutline16, { size: 14 }),
          },
        ]
      : []),
    ...(onRename === undefined
      ? []
      : [
          {
            id: 'rename',
            label: h('span', { 'data-dshone-tree-item': 'rename' }, tr('menu.renameWorkspace')),
            icon: h(IconEditOutline16, { size: 14 }),
          },
        ]),
    ...(onDelete === undefined
      ? []
      : [
          {
            id: 'remove',
            label: h('span', { 'data-dshone-tree-item': 'remove' }, tr('menu.removeWorkspace')),
            icon: h(IconTrashOutline16, { size: 14 }),
            danger: true,
          },
        ]),
  ]
  const iconButton = (options: {
    key: string
    action: string
    aria: string
    onClick: () => void
    marker?: string
    children: unknown
  }): unknown =>
    h(
      'button',
      {
        key: options.key,
        type: 'button',
        className: 'dshOneTree_rowIconButton',
        'aria-label': options.aria,
        'data-dshone-tree-action': options.action,
        ...(options.marker === undefined ? {} : { 'data-dshone-tree-item': options.marker }),
        onClick: (event: { stopPropagation(): void }) => {
          event.stopPropagation()
          options.onClick()
        },
      },
      options.children,
    )
  const actions = [
    iconButton({
      key: 'new',
      action: 'workspace-new-session',
      aria: tr('actions.newSession.aria', { name: label }),
      onClick: onCreate,
      marker: 'new-session-button',
      children: h(IconPlusOutline16, {}),
    }),
    ...(hasPath && onOpenTerminal !== undefined
      ? [
          iconButton({
            key: 'terminal',
            action: 'workspace-terminal',
            aria: tr('actions.workspace.terminal', { name: label }),
            onClick: onOpenTerminal,
            children: h(TerminalIcon, {}),
          }),
        ]
      : []),
    // 「在 VS Code 打开」只在**非当前工作区**时出现（E1）：当前工作区本来就在编辑器里，
    // 再给一个「打开它」的按钮没有意义。
    ...(hasPath && onOpenFolder !== undefined && !group.containsCurrent
      ? [
          iconButton({
            key: 'open',
            action: 'workspace-open',
            aria: tr('actions.workspace.open', { name: label }),
            onClick: () => onOpenFolder({ newWindow: false }),
            children: h(IconFolderOpenOutline16, {}),
          }),
        ]
      : []),
    ...(onDelete === undefined
      ? []
      : [
          iconButton({
            key: 'remove',
            action: 'workspace-remove',
            aria: tr('actions.workspace.remove', { name: label }),
            onClick: onDelete,
            children: h(IconTrashOutline16, {}),
          }),
        ]),
  ]
  // 未分组桶也开这个菜单（它至少有两项）：锚点没有 ⋯ 按钮可挂，给一个零尺寸占位
  // ——右键那一份用的是指针坐标（getAnchorRect），锚点元素只在这两种打开方式里当兜底。
  const anchor = h('span', { className: 'dshOneTree_menuAnchor', 'aria-hidden': true })
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
      ...(group.containsCurrent ? { 'data-dshone-tree-current': 'true' } : {}),
      onClick: onToggle,
      // 行右键开工作区菜单（#109 起工作区行有右键菜单；选择态由行本身的 onClick 接管，
      // 会话行的处置同此）。
      onContextMenu: (event: { preventDefault(): void; stopPropagation(): void; clientX: number; clientY: number }) => {
        event.preventDefault()
        event.stopPropagation()
        setMenuAt({ x: event.clientX, y: event.clientY })
        setMenuOpen(true)
      },
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
        // 行尾的绝对定位层（#109）：当前工作区那枚胶囊 + 活状态计数。**不能进正常流**：
        // 官方这一行没有它们，进流会把标题挤窄，而 F-04 PARITY 逐项比对标题的几何矩形
        // （同一处置见 ActivityBadge 的说明）。悬停时整层让位给四枚动作按钮。
        h(
          'span',
          { key: 'end', className: 'dshOneTree_rowEnd' },
          group.containsCurrent ? h('span', { className: 'dshOneTree_workspaceBadge', 'data-dshone-tree-badge': shellName, title: tr('badge.current') }, shellName) : null,
          counts === undefined ? null : h(ActivityBadge, { counts, tr }),
        ),
        h('span', {
          key: 'actions',
          className: 'dshOneTree_rowActions',
          children: [
            h(Menu, {
              key: 'menu',
              open: menuOpen,
              onClose: () => {
                setMenuAt(null)
                setMenuOpen(false)
              },
              items: menuItems,
              onSelect: (id: string) => {
                // 「分组…」父项：就地展开/收起，不关菜单。
                if (id === 'groups') {
                  setSubmenuOpen((open: boolean) => !open)
                  return
                }
                // 子项：就地翻转归属（写盘后重渲染，✓ 跟着翻转），**不关菜单**——用户可以
                // 连续勾几个组，与旧侧栏同款。
                if (id.startsWith(GROUP_MENU_PREFIX)) {
                  onToggleGroup(id.slice(GROUP_MENU_PREFIX.length))
                  return
                }
                setMenuAt(null)
                setMenuOpen(false)
                if (id === 'new-session') onCreate()
                if (id === 'copy-folder-ref') onCopyFolderRef()
                if (id === 'archive-all') onArchiveAll()
                if (id === 'open-new-window') onOpenFolder?.({ newWindow: true })
                if (id === 'copy-path') onCopyPath()
                if (id === 'rename') onRename?.()
                if (id === 'remove') onDelete?.()
              },
              // #113：官方紧凑档（项 26px 高 / 5px 圆角 / 12px 字号 / 14×14 图标位），
              // 与行内码右键菜单（shell/contextMenuPlugin.ts）同一档——侧栏里的菜单密度一致。
              compact: true,
              portal: true,
              closeOnPointerLeave: true,
              anchor,
              ...(menuAt === null ? {} : { getAnchorRect: () => new DOMRect(menuAt.x, menuAt.y, 0, 0) }),
            }),
            ...actions,
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

// ---------------------------------------------------------------------------
// #115 行内改名（会话行就地变输入框）的行内件
// ---------------------------------------------------------------------------

/**
 * 拖拽进行中（HTML5 拖拽的 dragstart → dragend 之间）。
 *
 * 为什么需要它：拖拽收尾那一下在部分浏览器/驱动上会补一个 `click`，而这一层的行点击
 * 语义是「当前会话 → 改名」——拖完顺手就进了编辑态不是用户要的。拖拽属性由树层拼好
 * 传进来（见 `dragProps` 的说明），所以这里在包一层的时候顺手记下拖拽窗口。
 */
let rowDragActive = false

/** 给树层拼好的拖拽属性外面包一层（记录拖拽窗口；原处理函数照常调用）。 */
function withDragGuard(dragProps: Record<string, unknown> | undefined): Record<string, unknown> {
  if (dragProps === undefined) return {}
  const wrapped: Record<string, unknown> = { ...dragProps }
  const start = wrapped.onDragStart
  const end = wrapped.onDragEnd
  wrapped.onDragStart = (event: unknown): void => {
    rowDragActive = true
    if (typeof start === 'function') (start as (e: unknown) => void)(event)
  }
  wrapped.onDragEnd = (event: unknown): void => {
    rowDragActive = false
    if (typeof end === 'function') (end as (e: unknown) => void)(event)
  }
  return wrapped
}

/**
 * 点行时命中的是不是「行内互斥件」（行尾状态点 / 图钉 / 定时标记 / 相对时间 / ⋯ 那一层）。
 *
 * 这些位置各有自己的含义（状态、时间、行菜单），点在它们上面**不算点行**——尤其不能
 * 把「当前会话 → 就地改名」触发了。判据用这些件自己的类名：它们都在本文件里渲染，
 * 是自有类名而不是官方哈希类。
 */
const ROW_META_SELECTOR = '.dshOneTree_rowActions,.dshOneTree_time,.dshOneTree_slot,.dshOneTree_pin,.dshOneTree_schedule'

/** 组件收到的行点击事件（只取用得到的那几个字段，与其它行内件的写法一致）。 */
interface RowClickEvent {
  target: unknown
}

/** 输入框事件（只取用得到的那几个字段）。 */
interface RenameInputEvent {
  target: { value: string; selectionStart: number | null; selectionEnd: number | null; isConnected: boolean }
  key?: string
  isComposing?: boolean
  preventDefault(): void
}

/**
 * 会话行（官方 `SessionNodeItem`）：状态点 + 标题 + （定时标记）+ 相对时间 + 悬停操作。
 *
 * #103 起行菜单里**两项分开**：「移入回收站」（本地可逆，只有置顶禁用）与「归档会话」
 * （走官方 `archiveSession`，**归档 = 删除**，置顶/运行中/有后代在跑/未读/待交互都禁用）。
 * 资格判定在纯模块 `pure/sessionEligibility.ts` 里（与勾选框、组头三态、批量动作同一份），
 * 这里只把原因翻成文案；`data-dshone-disabled-reason` 把判定结果写在菜单项上，验证套件
 * 按它核对「原因 ↔ 禁用 ↔ 原因提示」三者一致。
 *
 * #115 起行点击是**情境化**的：非当前会话 = 打开（原样），当前会话 = 就地改名（这一行
 * 变成输入框）。行这一侧只看 `isCurrent`（这一行是不是当前附着会话，与行可见性、「当前」
 * 标记同一份状态）——**它不等于「宿主真的开着这条会话」**（`list.current` 可能是启动时
 * 官方恢复的上次会话），所以「当前会话行被点」这件事本件只如实上报（`onCurrentRowClick`），
 * 由树层问过宿主之后再定「就地改名还是按打开处理」（#121，判定与理由见 tree.ts 的
 * `activateSessionRow`）。编辑态本身住在树层（`renaming` 进来、草稿与选区进来、进出编辑态
 * 的回调出去），这样列表重绘（会话状态推送）不会把编辑态一起丢掉。
 */
export function SessionRow({
  node,
  currentId,
  now,
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
  onSelectMultiple,
  onCopyReference,
  onOpenInNewTab,
  tagItems,
  tagSelectedIds,
  onTagSelect,
  dragProps,
  renaming,
  renameDraft,
  renameSelection,
  onCurrentRowClick,
  onRenameDraft,
  onRenameCommit,
  onRenameCancel,
}: {
  node: SessionNode
  currentId?: string
  now: number
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
   * #109「选择多个」：进入批量选择态。**调用点是这一枚回调**——批量选择那一套
   * （选择态、组头三态全选、操作条）由 #108 提供实现，菜单这一侧只负责把它接上。
   */
  onSelectMultiple: () => void
  /** #109「复制引用」：把这条会话的引用写进剪贴板（格式化与飘提示在树层）。 */
  onCopyReference: () => void
  /**
   * 「在新标签页打开」（#72 多开通道）。**undefined = 这个宿主没有编辑器标签页**
   * （官方 web 形态）：菜单项不出现（行右键照样接管——菜单里少这一项而已）。
   */
  onOpenInNewTab?: (() => void) | undefined
  /**
   * #107 标签组：「移到分组…」二级菜单里的那几项（本工作区的组 + 「不归入标签组」+
   * 「新建标签组…」）。由树层按这一行所属的工作区拼好——前缀判定走 `TAG_MENU_PREFIX`，
   * 本件不认标签组模型，只把它当一组菜单项渲染。
   *
   * **#109 起它们住在「移到分组…」这一项的就地展开里**（不再是菜单末尾的一节），所以树层
   * 给的那一份**不再带分隔线与小标题**（#109 的会话行菜单没有分隔线）。undefined = 这一行
   * 没有标签组入口（不在任何组块里，没有落点，拖拽与归组都没有意义）。
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
  /** #115：这一行正在就地改名（标题位换成输入框）。 */
  renaming?: boolean | undefined
  /** #115：编辑框里的草稿（受控；住树层所以跨重绘不丢）。 */
  renameDraft?: string | undefined
  /**
   * #115：编辑框的选区。**跨重绘恢复用**：列表重建把输入框换掉时（DOM 节点被重绘
   * 摘掉重挂），浏览器只在焦点落回来之后才有选区，所以要我们自己把这一段还回去。
   */
  renameSelection?: { start: number; end: number } | undefined
  /**
   * #115/#121：这一行**被判为当前**时收到的一次整行点击。本件只如实上报这件事——「是
   * 就地改名还是按打开处理」由树层定：它才持有当前附着会话（`list.current`），也只有它
   * 能问宿主「这条会话真的开在面板里吗」（#121 的真条件；本件只按行上的 `currentId` 判
   * `isCurrent`，不碰宿主）。
   */
  onCurrentRowClick?: (() => void) | undefined
  /** #115：草稿（含光标位置）变了；树层存下来，重绘后据此恢复。 */
  onRenameDraft?: ((draft: string, selection: { start: number; end: number }) => void) | undefined
  /** #115：Enter 提交（非空且改动过才真的发请求，判定在树层）。 */
  onRenameCommit?: (() => void) | undefined
  /** #115：Esc / 失焦取消。 */
  onRenameCancel?: (() => void) | undefined
}): unknown {
  const [menuOpen, setMenuOpen] = useState(false)
  /** 「移到分组…」二级菜单展开着没有（就地展开，见 submenuParent 的说明；菜单关掉即收起）。 */
  const [submenuOpen, setSubmenuOpen] = useState(false)
  /** 行右键的指针位置：有值时菜单挂在指针处（官方 Menu 的 getAnchorRect 口）。 */
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const title = displayTitle(node, tr)
  const isCurrent = node.id === currentId
  // ---- #115 行内改名：输入框、跨重绘的焦点/选区恢复、事件语义 ----
  const renameInput = useRef<HTMLInputElement | null>(null)
  /**
   * 列表重绘后把焦点与选区还给编辑框。
   *
   * 为什么要这一手：会话状态推送会让整棵树重画，输入框可能被重绘换掉（节点被摘掉
   * 重挂）——焦点落回 body、选区归零，用户打到一半的输入就「跳」了。这里在**每次
   * 渲染落定后**（`useLayoutEffect`，绘制之前）检查：焦点还在这一格就什么都不做
   * （用户正在打字/选词，动它反而会把光标弹走）；焦点掉了才补回焦点并把树层存下的
   * 选区还回去（进入编辑态时存的是「全选」）。
   */
  useLayoutEffect(() => {
    const input = renameInput.current
    if (input === null || document.activeElement === input) return
    input.focus()
    const selection = renameSelection ?? { start: 0, end: input.value.length }
    input.setSelectionRange(selection.start, selection.end)
  })
  /**
   * 编辑态与行菜单互斥：进入编辑态那一下，若这一行的菜单正开着就把它收掉（右键/⋯ 开
   * 着菜单时点行体进的编辑态）。
   */
  useEffect(() => {
    if (renaming !== true) return
    setMenuAt(null)
    setMenuOpen(false)
    setSubmenuOpen(false)
  }, [renaming])
  /**
   * IME 组合中：中文/日文输入法正在拼字。**两条判据都要看**——`compositionstart/end`
   * 这对事件（官方 WorkspaceBrowser 的改名输入框就是用它记的）与键盘事件自带的
   * `isComposing`（旧侧栏那条实现用它判）。任一说「正在组合」就不许把 Enter 当提交。
   */
  const composingRef = useRef(false)
  /**
   * 编辑期间持续把光标/选区报给树层：盯 `selectionchange`（在文档上，鼠标拖选、方向键
   * 移光标、在中间点一下都算），只认**本输入框在焦点里**的时候。
   *
   * 为什么光有输入事件不够：打字那一下的选区当然能拿到，但用户把光标停在中间再遇上
   * 一次列表重绘（会话状态推送），能还回去的就只有上一次打字时的位置——选区会跳。
   */
  useEffect(() => {
    if (renaming !== true) return
    const report = (): void => {
      const input = renameInput.current
      if (input === null || document.activeElement !== input) return
      reportDraft(input)
    }
    document.addEventListener('selectionchange', report)
    return () => document.removeEventListener('selectionchange', report)
  }, [renaming])
  /** 把草稿与光标位置报给树层（输入、移动光标、鼠标拖选都报）。 */
  const reportDraft = (element: HTMLInputElement): void => {
    onRenameDraft?.(element.value, {
      start: element.selectionStart ?? element.value.length,
      end: element.selectionEnd ?? element.value.length,
    })
  }
  const renameInputEvents = {
    value: renameDraft ?? '',
    'aria-label': tr('field.sessionName'),
    'data-dshone-tree-rename': 'input',
    autoComplete: 'off',
    // 两个事件接同一个处理函数：官方种子表里的 react 实现把 onChange 派到哪个原生
    // 事件上不由我们决定，接全了才在两种实现下都对（重复到达时值相同，树层的
    // setState 按同值短路，不会多渲染）。
    onChange: (event: RenameInputEvent) => reportDraft(event.target as unknown as HTMLInputElement),
    onInput: (event: RenameInputEvent) => reportDraft(event.target as unknown as HTMLInputElement),
    // 鼠标拖选、Shift+方向键这类「选区变了但没打字」的动作用 select 事件补上（光标来回
    // 移动那一路由上面那条 selectionchange 订阅兜着）。
    onSelect: (event: RenameInputEvent) => reportDraft(event.target as unknown as HTMLInputElement),
    onCompositionStart: () => {
      composingRef.current = true
    },
    onCompositionEnd: () => {
      composingRef.current = false
    },
    onKeyDown: (event: RenameInputEvent) => {
      if (event.key === 'Enter') {
        // IME 组合中的 Enter 确认的是候选词，不是改名——这一下必须让路。
        if (event.isComposing === true || composingRef.current) return
        event.preventDefault()
        onRenameCommit?.()
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        onRenameCancel?.()
      }
    },
    onBlur: (event: RenameInputEvent) => {
      // 失焦取消。**例外**：输入框自己已经不在文档里了（这次失焦是重绘把节点换掉
      // 造成的，不是用户点到别处）——那不算取消，重绘落定后上面那个 effect 会把
      // 焦点与选区还给新节点。
      if (event.target.isConnected === false) return
      onRenameCancel?.()
    },
  }
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
            // 同为 icon 槽位的次级色；尺寸按紧凑档的 14×14 图标位给（`{ size: 14 }`，
            // 官方 16 档图标塞进 14px 的盒子会溢出一圈）。
            icon: h(IconRightUpOutline16, { size: 14 }),
          },
        ]
  // 「移入回收站」与「归档」是两层语义，各自一份判定结果（同吃上面那份 facts）。
  const recycleBlocked = cannotRecycleReason(facts)
  // #107 标签组：「移到分组…」二级菜单里那一节（本工作区的组 + 「不归入标签组」+
  // 「新建标签组…」）。**项本体由树层拼好**（那一节要知道这一行属于哪个工作区），本件只
  // 负责把它放进「移到分组…」的**就地展开**里。undefined/空 = 这一行没有标签组入口
  //（不在任何组块里，没有落点，拖拽与归组都没有意义）：那就整项都不出现。
  const groupChildren = tagItems ?? []
  // #109：菜单凑齐 10 项，顺序按用户给的截图；标题行「会话: {label}」，**没有分隔线**。
  // 禁用的原因写在 label 节点的 title 上：官方 Menu 的项只有 label / icon / disabled /
  // danger / submenu 几个槽，没有独立的提示槽，所以提示只能挂在 label 元素上。
  const menuItems = [
    {
      type: 'label',
      id: 'session-title',
      text: h('span', { 'data-dshone-tree-item': 'menu-title' }, tr('menu.sessionTitle', { name: title })),
    },
    {
      id: 'selectMultiple',
      label: h('span', { 'data-dshone-tree-item': 'selectMultiple' }, tr('menu.selectMultiple')),
      // 图标取顶栏那个多选入口的同一枚（IconChecklistOutline14），两处是同一个动作。
      icon: h(IconChecklistOutline14, {}),
    },
    ...openInNewTabItem,
    {
      id: 'rename',
      label: h('span', { 'data-dshone-tree-item': 'rename' }, tr('rename')),
      icon: h(IconEditOutline16, { size: 14 }),
    },
    // #102 两项标记动作：文案随状态翻转，勾选态走官方 Menu 的 selectedIds（✓）。
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
    ...(groupChildren.length === 0 || onTagSelect === undefined
      ? []
      : [
          submenuParent({ id: 'moveToGroup', label: tr('menu.moveToGroup'), open: submenuOpen }),
          // 子项就是树层拼好的那一份（组 / 不归入 / 新建），只加一层缩进。
          ...(submenuOpen ? groupChildren.map((item) => indentSubmenuItem(item)) : []),
        ]),
    {
      id: 'fork',
      // 空白的「新会话」占位没有一个完成的轮次，官方 `sessions.fork` 在那种会话上必然
      // 失败（服务端回退到最后一个 turn/end 切点）——按旧侧栏的处置禁用。**只能按
      // `blank` 判**：会话快照里没有「有没有完成过轮次」这个事实（`SessionSummaryLike`
      // 没有对应字段，旧侧栏吃的 `sessionStatsTurns` 是它自己 store 里的统计）。
      label: h(
        'span',
        {
          'data-dshone-tree-item': 'fork',
          ...(node.blank ? { title: tr('menu.forkBlocked') } : {}),
        },
        tr('menu.fork'),
      ),
      icon: h(IconBranchOutline16, { size: 14 }),
      disabled: node.blank,
    },
    {
      id: 'copyReference',
      label: h('span', { 'data-dshone-tree-item': 'copyReference' }, tr('menu.copyReference')),
      icon: h(IconCopyOutline16, { size: 14 }),
    },
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
      icon: h(IconTrashOutline16, { size: 14 }),
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
      icon: h(IconArchiveOutline20, { size: 14 }),
      disabled: archiveBlocked !== null,
    },
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
  const renamingNow = renaming === true
  const row = h(
    'div',
    {
      className:
        `dshOneTree_sessionRow${(selectMode ? selected : isCurrent) ? ' dshOneTree_selected' : ''}${menuOpen ? ' dshOneTree_menuOpen' : ''}`,
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
      // 编辑态写在行上（验证套件与样式都按它认「这一行正在改名」）。
      ...(renamingNow ? { 'data-dshone-tree-renaming': 'true' } : {}),
      // #107：把这一行拖进/拖出标签组（拖拽属性由树层拼，见 dragProps 的说明）。
      // 选择态不给拖：那时候整行只有「勾选」一个动作；编辑态也不给拖（拖走正在改名的
      // 行只会把编辑态连同输入框一起晃没）。
      ...(selectMode || renamingNow ? {} : withDragGuard(dragProps)),
      // #115/#121 情境化点击：**非当前会话** = 打开（原样）；**当前会话** = 报到树层
      // （由它问过宿主再定就地改名还是按打开处理，见 onCurrentRowClick 的说明）。
      // 行内互斥件（行尾状态点/图钉/定时标记/时间/⋯ 那一层）点上去不算「点行」，
      // 按原来的打开处置走——它们各有自己的含义，不该把改名触发了。拖拽窗口里到达的
      // 点击同样吞掉（见 withDragGuard）。选择态照旧整行只有勾选。
      onClick: selectMode
        ? selectable
          ? onToggleSelect
          : () => {}
        : renamingNow
          ? // 编辑中：行内点哪儿都不再触发（点在输入框上是摆光标，由输入框自己处理）——
            // 这里若再走一遍「进入改名」，用户刚敲的字会被原样打回。
            () => {}
          : (event: RowClickEvent) => {
              // 读到就顺手复位：一份拖拽窗口只吞掉它收尾那一下；万一 dragend 没到（拖拽
              // 被宿主中途掐掉），这里也不会让行内改名从此失效。
              const dragging = rowDragActive
              rowDragActive = false
              const meta = event.target instanceof Element && event.target.closest(ROW_META_SELECTOR) !== null
              if (!meta && !dragging && isCurrent) onCurrentRowClick?.()
              else onOpen()
            },
      // 行右键开出同一份菜单（指针位置锚定）。**接管条件只剩「非选择态」**（#109）：
      // 以前还要「非空白会话 + 宿主有编辑器标签页」，于是多开不可用的宿主、空白会话行
      // 上右键都直接弹浏览器原生菜单——而这两类行**本来就有行菜单可给**（空白会话行
      // 只是官方不给显式的 ⋯ 按钮，菜单内容一样成立）。旧侧栏同样只按选择态让路。
      // 选择态下整行只有「勾选」一个动作（同上面 onClick 的处置）；编辑态下右键也让位
      //（同一份菜单，同一份互斥理由）。
      onContextMenu: selectMode || renamingNow
        ? undefined
        : (event: { preventDefault(): void; stopPropagation(): void; clientX: number; clientY: number }) => {
            event.preventDefault()
            event.stopPropagation()
            setMenuAt({ x: event.clientX, y: event.clientY })
            setMenuOpen(true)
          },
      children: [
        // #133：选择态的勾选框**缩进一层**——它落在工作区行那枚文件夹图标的列上
        //（行内边距 7 + 框宽 16 + 行内间隙 6 = 29），左边那 22px 留空。这一段空由下面
        // 那个 22px 的占位元素给出，它**是刻意的**（= 工作区行的「框宽 16 + 行内间隙 6」
        // 这一层缩进本身），不是没人要的死空间：#124 当时以死空间为由把框放在行首，
        // 用户实测后明确要旧侧栏那个形态（组头的框在最左、行的框缩进一层，左侧留出
        // 那一段空），本条按用户口径改回来。
        // #124 立下的 δ 照旧：会话行的整段插入量仍是 22px（#108 起两行在选中态下插入
        // 同样的量），标题落点因此不变——7 + 22 + 16 + 4 = 49，与工作区名的 51 相差 2。
        selectMode
          ? h('span', { key: 'checkIndent', className: 'dshOneTree_checkIndent' })
          : null,
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
          : null,
        // #133：选择态下**状态槽不渲染**——框左边那 22px 缩进就是它让出来的位置。
        // 为什么让它让位，而不是「保留在框的右侧」或「缩进之后紧跟槽」：本条的两个硬
        // 约束是「标题仍落在 49」与「δ 仍是 2」，任何一处把 16px 的槽留在框前或框后都
        // 会多出 16 + 4 = 20px、标题当场越过 49，δ 随之断掉；而用户口径要的就是框左侧
        // 那一段空，槽留着也把这 22px 填掉 16px 了。旧侧栏进多选后同样是这个处置——
        // 它那一行的第一个子元素就是复选框（`renderSessionRow` 在多选态下先挂复选框、
        // 再挂主区），行首不留状态槽，活状态画在行尾。
        // 状态事实没有丢：活状态照旧写在行上（`data-dshone-tree-status`，与这枚点同源
        // 的判定），组头三态、归档跳过数、回收站保护这些判定也都不看这颗点。
        !selectMode
          ? showStatus
            ? h(SessionStatusDots, { key: 'status', statuses, tr })
            : h('span', { key: 'status', className: 'dshOneTree_slot' })
          : null,
        pinned ? h(PinMark, { key: 'pin', sessionId: node.id }) : null,
        // #115 编辑态：标题位就地换成输入框（prefill + 全选由树层给初值与选区），
        // 行其余部分照旧——行结构与不编辑时完全一致，重绘才不会把输入框换掉。
        renamingNow
          ? h('input', { key: 'title', ref: renameInput, className: 'dshOneTree_inlineRenameInput', ...renameInputEvents })
          : h('span', { key: 'title', className: `dshOneTree_title${unread ? ' dshOneTree_unread' : ''}` }, title),
        // 活跃定时任务标记（#110，官方 `row.hasActiveSchedule &&` 同位置：标题后、时间前）。
        node.hasActiveSchedule ? h(ActiveScheduleIndicator, { key: 'schedule', tr }) : null,
        node.blank || selectMode
          ? null
          : h('span', {
              key: 'time',
              className: 'dshOneTree_time',
              children: timeLabel(node.updatedAt, now, tr),
            }),
        // 行菜单挂在 actions 里（选择态下整行让位）。**空白会话行也挂**（#109）：它的
        // ⋯ 按钮照官方不渲染（`node.blank` 那一支），但右键要能开出菜单——所以这里渲染
        // 的是一层「可能有按钮、一定有菜单」的容器，锚点按有没有按钮二选一。
        // #115 编辑中同样让位：编辑态与菜单互斥（菜单里也有「重命名」，两条路同时开着
        // 只会互相顶掉），要改名就先 Enter/Esc 收掉输入框。
        selectMode || renamingNow
          ? null
          : h('span', {
              key: 'actions',
              className: 'dshOneTree_rowActions',
              children: [
                h(Menu, {
                  key: 'menu',
                  open: menuOpen,
                  onClose: () => {
                    setMenuAt(null)
                    setMenuOpen(false)
                    setSubmenuOpen(false)
                  },
                  items: menuItems,
                  // 勾选态（官方 Menu 的 selectedIds：✓ 由官方渲染）：两项标记动作 +
                  // 本行的标签组归属（#107，现在住在「移到分组…」的就地展开里）。
                  selectedIds: [...(pinned ? ['pin'] : []), ...(unread ? ['unread'] : []), ...(tagSelectedIds ?? [])],
                  onSelect: (id: string) => {
                    // 「移到分组…」父项：就地展开/收起，不关菜单。
                    if (id === 'moveToGroup') {
                      setSubmenuOpen((open: boolean) => !open)
                      return
                    }
                    // 标签组子项：就地翻转归属、**不关菜单**（#109 的口径：勾完还能接着勾）。
                    // 只有「新建标签组…」例外：它要开一个输入弹窗，浮层叠浮层不好看，所以
                    // 先把菜单收掉（旧侧栏也是关菜单再开弹层）。
                    if (id.startsWith(TAG_MENU_PREFIX)) {
                      if (id.endsWith('__new')) {
                        setMenuAt(null)
                        setMenuOpen(false)
                        setSubmenuOpen(false)
                      }
                      onTagSelect?.(id.slice(TAG_MENU_PREFIX.length))
                      return
                    }
                    setMenuAt(null)
                    setMenuOpen(false)
                    if (id === 'selectMultiple') onSelectMultiple()
                    if (id === 'rename') onRename(node.title)
                    if (id === 'pin') onTogglePin()
                    if (id === 'unread') onToggleUnread()
                    if (id === 'fork') onFork()
                    if (id === 'openInNewTab') onOpenInNewTab?.()
                    if (id === 'copyReference') onCopyReference()
                    if (id === 'move-to-recycle-bin') onMoveToRecycleBin()
                    if (id === 'archive') onArchive()
                  },
                  // #113：官方紧凑档（与工作区行那一份、行内码右键菜单同一档）。
                  compact: true,
                  portal: true,
                  closeOnPointerLeave: true,
                  // 锚点：非空白行是那一枚 ⋯ 按钮（Menu 自己会把它渲染在自己的根节点里，
                  // 所以这里**只**传给 Menu、不再另渲染一份）；空白行没有按钮，给一个零尺寸
                  // 占位（右键那一份用指针坐标，锚点只是在别的打开方式下当兜底）。
                  anchor: node.blank ? h('span', { className: 'dshOneTree_menuAnchor', 'aria-hidden': true }) : anchor,
                  // 行右键开的那一份：菜单锚在指针处（官方 Menu 的 getAnchorRect
                  // 优先于 anchor 的矩形，官方自己的右键菜单也是这么用的）。
                  ...(menuAt === null ? {} : { getAnchorRect: () => new DOMRect(menuAt.x, menuAt.y, 0, 0) }),
                }),
              ],
            }),
      ],
    },
  )
  if (!hoverCard || selectMode) return row
  return h(HoverCard, {
    anchor: row,
    content: h(SessionHoverContent, { node, now, tr, unread }),
    // 改名编辑期间不出悬停卡（`disabled` 是官方 HoverCard 的既有口）：卡片会盖住输入框、
    // 也会在指针移动时重排行。**保留这层包装**（不改成直接返回 row）——结构与不编辑时
    // 一致，编辑态进出才不会把整行 DOM 换掉。
    disabled: menuOpen || renamingNow,
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
