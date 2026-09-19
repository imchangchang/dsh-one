/**
 * 分组过滤条（#99 B 段）：**单胶囊 + 成员计数 + ▾ 下拉**（替掉 #81 那排 chip）。
 *
 * 形态取自旧侧栏的分组栏（`src/ui/sessionsWebview.ts` 的 `buildGroupBar` +
 * `openGroupMenu`，用户给的截图也是这一枚）：胶囊里是「图标 + 当前分组名 + 计数 +
 * ▾」，点开是官方 `Menu` 原语的一份下拉——全部工作区 / 各组 / 新建分组… / 管理分组…。
 * 外观语言按官方：官方 token 颜色、官方 iconButton 同档高度、圆角 999px（胶囊），
 * 尺寸走密度档变量（与搜索栏同源）。
 *
 * 计数口径 = **成员工作区数**（旧侧栏同款：全部 = 工作区总数；某组 = 归属于该组的
 * 工作区数）。过滤本身仍然是「按工作区过滤」——`workspaceMatchesGroup` 那一套没变，
 * 本条只换呈现。
 *
 * **#135 起它住在顶栏那一行里**（原来自己在列表区占一行，用户拍板把两行并成一行）：
 * 胶囊在行首（左缘落在行内容基准上，见 styles.ts 那条 `margin-left` 的说明），右边
 * 依次是搜索栏与四枚工具控件。搜索展开时它**让位**（`hidden` = 收起成零宽，见下）。
 */
import { createElement as h, useState } from 'react'
import {
  IconChevronDownOutline14,
  IconFolderOpenOutline16,
  IconPlusOutline16,
  IconSettingsOutline16,
  Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceGroupDef } from '../../../../src/pure/treeGroups.ts'
import type { Translate } from './types.ts'

/** 下拉里的一行：名字 + 右对齐计数（官方 Menu 的 label 槽接受元素）。 */
function menuRow(name: string, count: number): unknown {
  return h(
    'span',
    { className: 'dshOneTree_menuRow' },
    h('span', { className: 'dshOneTree_menuRowLabel' }, name),
    h('span', { className: 'dshOneTree_menuRowCount' }, String(count)),
  )
}

export function GroupFilterBar({
  groups,
  activeGroupId,
  groupCounts,
  totalCount,
  tr,
  onPick,
  onCreate,
  onManage,
  hidden = false,
}: {
  groups: readonly WorkspaceGroupDef[]
  activeGroupId: string | null
  /** 每个分组的成员工作区数（组 id → 计数）。 */
  groupCounts: ReadonlyMap<string, number>
  /** 「全部工作区」的计数（工作区总数）。 */
  totalCount: number
  tr: Translate
  onPick: (groupId: string | null) => void
  onCreate: () => void
  onManage: () => void
  /**
   * 搜索展开时**让位**（#135）：加上 `dshOneTree_filterBarHidden`，由样式表把它收成
   * 零宽（官方 `bhn1Oq_sectionLabelHidden` 那套做法——官方搜索展开时就是把分节头那行
   * 标题与右侧动作组一起收掉的，出处见 styles.ts 那条规则上方）。组件本身照常挂载、
   * 下拉菜单的状态不动，只是这一刻不占位、看不见。
   *
   * 同一件事另写一个自有标记 `data-dshone-tree-visible`（`true`/`false`）：验证套件要判
   * 「这一刻胶囊让位了没有」，读标记比读类名或 `visibility` 稳（与搜索栏的
   * `data-dshone-tree-state` 同一做法）。
   */
  hidden?: boolean
}): unknown {
  const [open, setOpen] = useState(false)
  const active = activeGroupId === null ? null : (groups.find((group) => group.id === activeGroupId) ?? null)
  const count = active === null ? totalCount : (groupCounts.get(active.id) ?? 0)
  const label = active === null ? tr('group.allWorkspaces') : active.name
  return h(
    'div',
    {
      className: `dshOneTree_filterBar${hidden ? ' dshOneTree_filterBarHidden' : ''}`,
      'data-dshone-tree': 'group-filter',
      'data-dshone-tree-visible': hidden ? 'false' : 'true',
      role: 'group',
      'aria-label': tr('group.filter.aria'),
    },
    h(Menu, {
      open,
      onClose: () => setOpen(false),
      items: [
        {
          id: 'all',
          label: h(
            'span',
            { 'data-dshone-tree-pill-item': 'all' },
            menuRow(tr('group.allWorkspaces'), totalCount),
          ),
        },
        ...groups.map((group) => ({
          id: group.id,
          label: h(
            'span',
            { 'data-dshone-tree-pill-item': group.id },
            menuRow(group.name, groupCounts.get(group.id) ?? 0),
          ),
        })),
        { type: 'separator', id: 'group-menu-separator' },
        {
          id: 'new',
          label: h('span', { 'data-dshone-tree-action': 'group-new' }, tr('group.new')),
          icon: h(IconPlusOutline16, { size: 14 }),
        },
        {
          id: 'manage',
          label: h('span', { 'data-dshone-tree-action': 'group-manage' }, tr('group.manage')),
          icon: h(IconSettingsOutline16, { size: 14 }),
        },
      ],
      selectedIds: [activeGroupId ?? 'all'],
      onSelect: (id: string) => {
        setOpen(false)
        if (id === 'new') onCreate()
        else if (id === 'manage') onManage()
        else onPick(id === 'all' ? null : id)
      },
      align: 'start',
      // #113：官方紧凑档（菜单项 26px 高 / 12px 字号 / 图标位 14×14），与胶囊本身
      // （26px 高 / 12px 字号）同档；`separator` 与分组标题的间距也由官方该档给。
      compact: true,
      // #135：这一格是**胶囊在顶栏那一行里的落点**。官方 Menu 会把锚点包进它自己的根
      // `span`（`.bhn…` 那一层：官方 css-module `_root_1nxmc_1{position:relative;
      // display:inline-flex}`），所以真正作为那一行直接子元素的是那层 span，不是胶囊
      // 按钮——窄侧栏下要收得动胶囊，就得让这层收得动。走官方 Menu 公开的 `className`
      // prop（官方组件签名里有它，渲染时 `clsx(root, className)` 挂在根 span 上），
      // 不碰它的内部类名与哈希。
      className: 'dshOneTree_pillSlot',
      portal: true,
      closeOnPointerLeave: true,
      anchor: h(
        'button',
        {
          type: 'button',
          className: `dshOneTree_pill${active === null ? '' : ' dshOneTree_pillActive'}`,
          'aria-label': `${tr('group.filter.aria')} - ${label}`,
          'aria-haspopup': 'menu',
          'aria-expanded': open,
          'data-dshone-tree-action': 'group-pill',
          'data-dshone-tree-group': active?.id ?? 'all',
          'data-dshone-tree-group-count': count,
          onClick: () => setOpen((value: boolean) => !value),
        },
        h('span', { className: 'dshOneTree_pillTag' }, h(IconFolderOpenOutline16, { size: 12 })),
        h('span', { className: 'dshOneTree_pillLabel' }, label),
        h('span', { className: 'dshOneTree_pillCount' }, String(count)),
        h('span', { className: 'dshOneTree_pillChevron' }, h(IconChevronDownOutline14, {})),
      ),
    }),
  )
}
