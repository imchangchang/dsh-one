/**
 * 顶部工具栏（#99 B 段，自绘）。一行四件（#98 布局规范）：
 *
 * - **左 = 官方搜索栏**：官方 ui-workspace 的搜索 UI **处于展开态**的那一份——同一组
 *   类名语义（search / searchButton / searchInput / clearButton）、同一批官方键
 *   （`search.placeholder` / `search.clear` / 结果区的 `search.pending` /
 *   `search.unavailable` / `search.noMatches` / `search.hasMore` 在树主组件里）与
 *   逐字取自官方 css-module 的几何（30px 高、10px 圆角、.5px 边框）。**折叠态的
 *   放大镜胶囊退役**：点一下才展开的那一态不再存在（#98「搜索」条），搜索框常显。
 * - **右 = 折叠/展开全部 · 添加工作区（＋）· 设置齿轮**：#99 新增的三件。折叠/展开全部
 *   按「全部工作区是否已折叠」显示对应图标（旧侧栏同款语义）；添加工作区是两项菜单
 *   （选已有文件夹 / 创建新工作区目录）；设置齿轮打开我们的设置页（宿主能力口
 *   `openSettings`，宿主没有独立设置页时不渲染——官方 web 侧设置归官方底部那一行）。
 * - 同一行末尾保留 #81 已有的**视图选项**与**多选入口**：本条不动它们的位置。#108 起
 *   这一枚走的是选择态的**唯一入口 API**（`selection.ts` 的 `selectionEntrySignal.enter()`），
 *   会话行菜单里那一项「选择多个」也调它（菜单项本体属「菜单补全」那条）。
 *
 * 为什么搜索栏不是渲染官方目录流子槽：官方那口子（`sidebar.workspaces.directoryFlow`）
 * 由官方 WorkspaceBrowser 条目在它自己的 `children` 里声明，而官方渲染器**只允许声明
 * 该槽的条目渲染它**（`dsh-client-ui-renderer/lib/client.js` 的 boundRenderSlot：
 * `entry.children?.[key] === undefined` 即抛 SlotOwnershipError），我们那条 entry 声明
 * 不了（同名槽二次声明注册表直接报错）。所以「选已有文件夹」走官方**服务**
 * （`uiWorkspace.pickDirectory`，第 2 层机制）——见 workspaceTreePlugin 的注入面。
 */
import { createElement as h, useRef, useState } from 'react'
import {
  IconChevronDownOutline14,
  IconChevronUpOutline14,
  IconChecklistOutline14,
  IconCloseFill14,
  IconFolderOpenOutline16,
  IconPersonalizationOutline16,
  IconPlusOutline16,
  IconProjectAddOutline16,
  IconSearchOutline16,
  IconSettingsOutline16,
  Menu,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { SEARCH_QUERY_MAX } from './search.ts'
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
    // #113：菜单统一走官方紧凑档（`compact: true`），与右键菜单（shell/contextMenuPlugin.ts）
    // 同一档，整个侧栏里的菜单密度一致。此前传的 `dense` 是官方另一档（项 34px），
    // 已按紧凑档替换——两个都传会让重叠属性取决于官方样式表里的先后顺序，不这么用。
    compact: true,
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

export interface TopBarProps {
  tr: Translate
  /** 搜索框当前值（输入即改；去抖后打官方 `sessions.search`，见树主组件）。 */
  query: string
  onQueryChange: (value: string) => void
  onQueryClear: () => void
  /** 「全部工作区都已折叠」——决定这一枚显示「展开全部」还是「折叠全部」。 */
  allCollapsed: boolean
  onToggleCollapseAll: () => void
  /** ＋ 菜单第一项：选已有文件夹（官方 `uiWorkspace.pickDirectory`）。 */
  onPickWorkspaceFolder: () => void
  /**
   * ＋ 菜单第二项：创建新工作区目录。宿主能力口没有这条能力（官方 web）时整项不出现。
   */
  onCreateWorkspaceFolder?: (() => void) | undefined
  /** 设置齿轮：宿主有独立设置页时才渲染（能力口 `settingsPage`）。 */
  onOpenSettings?: (() => void) | undefined
  groupBy: 'workspace' | 'flat'
  orderBy: 'manual' | 'updated'
  onGroupPick: (mode: 'workspace' | 'flat') => void
  onOrderPick: (mode: 'manual' | 'updated') => void
  selectMode: boolean
  onToggleSelectMode: () => void
}

/** 顶部工具栏一行。 */
export function TopBar(props: TopBarProps): unknown {
  const { tr, query, allCollapsed, selectMode } = props
  const [addOpen, setAddOpen] = useState(false)
  const searchInput = useRef<HTMLInputElement | null>(null)
  const addItems = [
    {
      id: 'pick-folder',
      label: h('span', { 'data-dshone-tree-item': 'workspace-pick' }, tr('workspace.pickFolder')),
      // 图标位 14×14：紧凑档的项内图标盒就是 14×14（官方 `._itemIcon_1nxmc_144`），
      // 官方 16 档图标塞进去会溢出一圈，所以按官方给的显式尺寸参数打 14（官方自己也这么用）。
      icon: h(IconFolderOpenOutline16, { size: 14 }),
    },
    ...(props.onCreateWorkspaceFolder === undefined
      ? []
      : [
          {
            id: 'create-folder',
            label: h('span', { 'data-dshone-tree-item': 'workspace-create' }, tr('workspace.create')),
            icon: h(IconPlusOutline16, { size: 14 }),
          },
        ]),
  ]
  return h(
    'div',
    { className: 'dshOneTree_sectionHeader', 'data-dshone-tree': 'top-bar' },
    // 官方搜索栏的**展开态**（search / searchSlot 两层都带 Expanded 变体，与官方
    // SidebarRoot 展开后的 DOM 同构）：折叠态不在（#99 退役放大镜胶囊）。
    h(
      'div',
      { className: 'dshOneTree_searchSlot dshOneTree_searchSlotExpanded' },
      h(
        'div',
        {
          className: 'dshOneTree_search dshOneTree_searchExpanded',
          'data-dshone-tree': 'search-box',
          onClick: () => searchInput.current?.focus(),
        },
        h(Tooltip, {
          label: tr('search'),
          side: 'bottom',
          delayMs: 500,
          children: h(
            'button',
            {
              type: 'button',
              className: 'dshOneTree_searchButton',
              'aria-label': tr('search.sessions.aria'),
              'aria-expanded': true,
              'data-dshone-tree-action': 'search',
              onClick: () => searchInput.current?.focus(),
            },
            h(IconSearchOutline16, { size: 11 }),
          ),
        }),
        h('input', {
          ref: searchInput,
          className: 'dshOneTree_searchInput',
          'data-dshone-tree': 'search-input',
          type: 'text',
          placeholder: tr('search.placeholder'),
          maxLength: SEARCH_QUERY_MAX,
          value: query,
          onChange: (event: { target: { value: string } }) => props.onQueryChange(event.target.value),
          onKeyDown: (event: { key: string }) => {
            if (event.key !== 'Escape') return
            props.onQueryClear()
          },
        }),
        h(
          'button',
          {
            type: 'button',
            className: 'dshOneTree_clearButton',
            'data-dshone-tree': 'search-clear',
            'aria-label': tr('search.clear'),
            onClick: (event: { stopPropagation(): void }) => {
              event.stopPropagation()
              props.onQueryClear()
            },
          },
          h(IconCloseFill14, {}),
        ),
      ),
    ),
    h(
      'div',
      { className: 'dshOneTree_headerActions', 'data-dshone-tree': 'top-bar-actions' },
      // 折叠 / 展开全部（#99）：图标与提示随当前态翻转，语义同旧侧栏。
      h(Tooltip, {
        label: allCollapsed ? tr('toolbar.expandAll') : tr('toolbar.collapseAll'),
        side: 'bottom',
        delayMs: 500,
        children: h(
          'button',
          {
            type: 'button',
            className: 'dshOneTree_iconButton',
            'aria-label': allCollapsed ? tr('toolbar.expandAll') : tr('toolbar.collapseAll'),
            'data-dshone-tree-action': 'collapse-all',
            'data-dshone-tree-collapsed': allCollapsed,
            onClick: props.onToggleCollapseAll,
          },
          allCollapsed ? h(IconChevronDownOutline14, {}) : h(IconChevronUpOutline14, {}),
        ),
      }),
      // 添加工作区（＋）：两项菜单（选已有文件夹 / 创建新工作区目录）。
      h(Menu, {
        open: addOpen,
        onClose: () => setAddOpen(false),
        items: addItems,
        onSelect: (id: string) => {
          setAddOpen(false)
          if (id === 'pick-folder') props.onPickWorkspaceFolder()
          if (id === 'create-folder') props.onCreateWorkspaceFolder?.()
        },
        align: 'end',
        // #113：官方紧凑档（与右键菜单、ViewOptionsMenu 同档，侧栏里菜单密度一致）。
        compact: true,
        portal: true,
        closeOnPointerLeave: true,
        anchor: h(Tooltip, {
          label: tr('workspace.add'),
          side: 'bottom',
          delayMs: 500,
          children: h(
            'button',
            {
              type: 'button',
              className: 'dshOneTree_iconButton',
              'aria-label': tr('workspace.add'),
              'data-dshone-tree-action': 'add-workspace',
              onClick: () => setAddOpen((open: boolean) => !open),
            },
            h(IconProjectAddOutline16, { size: 16 }),
          ),
        }),
      }),
      // 设置齿轮（#99）：宿主有独立设置页时才有这一枚（官方 web 侧设置归官方底部行）。
      props.onOpenSettings === undefined
        ? null
        : h(Tooltip, {
            label: tr('toolbar.settings'),
            side: 'bottom',
            delayMs: 500,
            children: h(
              'button',
              {
                type: 'button',
                className: 'dshOneTree_iconButton',
                'aria-label': tr('toolbar.settings'),
                'data-dshone-tree-action': 'settings',
                onClick: props.onOpenSettings,
              },
              h(IconSettingsOutline16, { size: 16 }),
            ),
          }),
      // #81 已有入口（位置本条不动）。
      h(ViewOptionsMenu, {
        groupBy: props.groupBy,
        orderBy: props.orderBy,
        tr,
        onGroupPick: props.onGroupPick,
        onOrderPick: props.onOrderPick,
      }),
      h(Tooltip, {
        label: selectMode ? tr('select.exit') : tr('select.enter'),
        side: 'bottom',
        delayMs: 500,
        children: h(
          'button',
          {
            type: 'button',
            className: `dshOneTree_iconButton${selectMode ? ' dshOneTree_menuOpen' : ''}`,
            'aria-label': selectMode ? tr('select.exit') : tr('select.enter'),
            'aria-pressed': selectMode,
            'data-dshone-tree-action': 'select-mode',
            onClick: props.onToggleSelectMode,
          },
          h(IconChecklistOutline14, { size: 16 }),
        ),
      }),
    ),
  )
}
