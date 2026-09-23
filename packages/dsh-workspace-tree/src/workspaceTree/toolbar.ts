/**
 * 顶部工具栏（#99 B 段，自绘）。**#135 起是「一行五件」**（原来分节头一行 + 分组过滤条
 * 一行，用户拍板并成一行）——从左到右：
 *
 * - **行首 = 分组过滤胶囊**（`GroupFilterBar`，原来自己在列表区占一行）：它落在行内容基准
 *   那条竖线上，也就是下面「官方搜索栏」展开时左缘落的那条线（#125 的口径，几何由
 *   F-35 / F-39 判）。
 * - **右 = 官方搜索栏 + 折叠/展开全部 + 添加工作区 + 设置齿轮 + 多选入口**：
 *   见下面两条。
 *
 * **搜索展开时其余控件让位，输入框独占整行**（#135，用户拍板）。让位方式 = **官方那套
 * 「收起来」**，不是另做「更多」菜单、也不是压成图标——举证：官方 ui-workspace 的
 * `WorkspaceBrowser` 在输出里给搜索区与动作组各带一枚变体类
 * （`bhn1Oq_sectionLabelHidden` / `bhn1Oq_headerActionsHidden`），搜索展开时**两枚一起
 * 挂上**（`lib/client.js`：`clsx(sectionLabel, wide && searchExpanded && sectionLabelHidden)`
 * 与 `clsx(headerActions, wide && searchExpanded && headerActionsHidden)`，同文件里的
 * css-module 给的两条规则是 `opacity:0;visibility:hidden;max-width:0;transform:translate(…)`
 * 配一段 `.18s` 过渡）。也就是说官方自己就是这么让位的：**分节头标题与右侧动作组一起收成
 * 零宽**，搜索槽（`searchSlotExpanded` 把 `max-width` 放到 100%）因此吃满整行。
 * 我们的分节头那一行的「行首那件」就是分组过滤胶囊，所以照官方两条变体各挂一枚：
 * `.dshOneTree_filterBarHidden`（对应 `sectionLabelHidden`）与
 * `.dshOneTree_headerActionsHidden`（对应 `headerActionsHidden`），见 styles.ts。
 *
 * 为什么不在展开态把四枚控件收进「更多」菜单：官方没有这个形态（它的动作组是收成零宽，
 * 不是折进菜单），而且收进菜单等于把「折叠全部 / 添加工作区 / 设置 / 多选」多藏一层，
 * 与「搜索完就想接着按原来那颗」的用法相悖——搜索是个临时态，Esc / 清除一下就回来
 * （那四枚的点击语义因此一字未改，见下面各自的说明）。
 *
 * - **官方搜索栏**：官方 ui-workspace 搜索 UI 的那一份，**两态都在**（#132）——
 *   平时是折叠态的放大镜按钮（28px 圆胶囊、圆形图标 14 档），点它（或点容器）才展开
 *   成官方展开态（输入框 + 清除钮、30px 高、10px 圆角、.5px 边框、图标 11 档）；
 *   按 Esc 或点清除收起并清空。类名语义（search / searchSlot / searchButton /
 *   searchInput / clearButton 与两个 Expanded 变体）、官方键
 *   （`search.placeholder` / `search.clear` / 结果区的 `search.pending` /
 *   `search.unavailable` / `search.noMatches` / `search.hasMore` 在树主组件里）
 *   与几何逐字取自官方 css-module（`bhn1Oq_search*`），所以两态都能与官方页逐项比对
 *   （F-04）。态机同样照官方那份实现：
 *   ① 点放大镜 / 点容器 → 展开并聚焦输入框；
 *   ② 输入框上 Esc → 清空 + 收起；
 *   ③ 清除钮（只在展开态渲染，同官方）→ 清空 + 收起；
 *   ④ 展开中点到搜索区外面 → 先让输入框失焦，**查询非空则保持展开**（用户还在看结果）、
 *      空查询才收起——出处：`dsh-client-ui-workspace/lib/client.js` 的 WorkspaceBrowser
 *      （展开中的 document click 监听里 `if (normalizedQuery !== "") return`）。
 *   与官方唯一的一处 DOM 差异：官方把输入框**常挂**在 DOM 里、靠 `tabIndex=-1` 与
 *   CSS（opacity 0 / width 0 / pointer-events none）藏起来，我们**收起时不渲染它**
 *   （可见与可交互的结果一样：收起态输入框既不可见也进不了 Tab 序，只是少了输入框
 *   那 0.12s 的透明度过渡）。
 * 这四枚在搜索展开时**跟着让位**（`dshOneTree_headerActionsHidden`，与官方
 * `headerActionsHidden` 同名同事；那一刻它们不可见也不接指针，Esc / 清除收起搜索后原样
 * 回来——见文件头让位那一节）。
 *
 * - **右 = 折叠/展开全部 · 添加工作区（＋）· 设置齿轮 · 多选入口**：前三件是 #99 新增的。
 *   折叠/展开全部按「全部工作区是否已折叠」显示对应图标——**方框加减号**（#118 起：还有
 *   展开着的就显示方框横杠 = 折叠全部，全折叠了就显示方框十字 = 展开全部；图标出处与
 *   官方为何没有这一枚见 `collapseAllGlyph.ts`）；添加工作区是两项菜单（选已有文件夹 /
 *   创建新工作区目录）；设置齿轮打开我们的设置页（宿主能力口 `openSettings`，宿主没有
 *   独立设置页时不渲染——官方 web 侧设置归官方底部那一行）。多选入口是 #81 已有的，
 *   #108 起走选择态的**唯一入口 API**（`selection.ts` 的 `selectionEntrySignal.enter()`），
 *   会话行菜单里那一项「选择多个」也调它（菜单项本体属「菜单补全」那条）。
 *
 *   #131 起这一行**只有上述四枚**：官方那枚视图选项菜单（分组方式 / 排序方式）与它带出的
 *   平铺单列表模式一起退役（用户实测：那两节照早先插件抄来、意义不大），
 *   侧栏恒为「按工作区 + 官方顺序」。
 *
 * 为什么搜索栏不是渲染官方目录流子槽：官方那口子（`sidebar.workspaces.directoryFlow`）
 * 由官方 WorkspaceBrowser 条目在它自己的 `children` 里声明，而官方渲染器**只允许声明
 * 该槽的条目渲染它**（`dsh-client-ui-renderer/lib/client.js` 的 boundRenderSlot：
 * `entry.children?.[key] === undefined` 即抛 SlotOwnershipError），我们那条 entry 声明
 * 不了（同名槽二次声明注册表直接报错）。所以「选已有文件夹」走官方**服务**
 * （`uiWorkspace.pickDirectory`，第 2 层机制）——见 workspaceTreePlugin 的注入面。
 */
import { createElement as h, useEffect, useRef, useState } from 'react'
import { Menu, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { officialIcon } from '@dsh-one/dsh-plugin-kit/officialIcons'
import { COLLAPSE_ALL_GLYPH_TRANSFORM, COLLAPSE_ALL_GLYPHS, type CollapseAllGlyph } from './collapseAllGlyph.ts'
import { GroupFilterBar } from './groupFilterBar.ts'
import { SEARCH_QUERY_MAX } from './search.ts'
import type { WorkspaceGroupDef } from '../../../../src/pure/treeGroups.ts'
import type { Translate } from './types.ts'

const IconChecklistOutline = officialIcon('IconChecklistOutline')
const IconCloseFill = officialIcon('IconCloseFill')
const IconFolderOpenOutline = officialIcon('IconFolderOpenOutline')
const IconPlusOutline = officialIcon('IconPlusOutline')
const IconProjectAddOutline = officialIcon('IconProjectAddOutline')
const IconSearchOutline = officialIcon('IconSearchOutline')
const IconSettingsOutline = officialIcon('IconSettingsOutline')

/**
 * 「折叠 / 展开全部」那枚图标（#118）：方框加减号，自绘 SVG。
 *
 * 路径数据与官方为何没有这一枚，见 `collapseAllGlyph.ts`（那边是不引任何模块的纯数据
 * 文件，装配实验室的套件直接 import 它拿期望值）。这里只负责渲染，**逐字复用旧侧栏
 * `sessionsWebview.ts` 的 `iconSvg` 画法**：`svg fill="none"` + 每条 path
 * `fill="currentColor"`、`fill-rule`/`clip-rule` = evenodd，颜色跟着按钮的 currentColor
 *（hover / 禁用态由样式表统一控制，与官方图标件同一套）。
 *
 * 尺寸 16：与同一行其它图标按钮一致（添加工作区 / 设置齿轮都是 16 档），
 * 26×26 的按钮用 flex 居中。旧侧栏这枚也是 16。
 *
 * 每条 path 还挂一条 `transform`（#141）：方框只占 16 格画布里的 11 格，画出来比同一排
 * 官方图标小一圈，所以按 `collapseAllGlyph.ts` 里量出来的倍数把它放大——只动画出来的
 * 大小，`d` 与 16×16 的渲染尺寸都不动（倍数怎么来的见那个文件）。
 *
 * 两条 `data-*` 是自有契约，与回收站入口行的 `data-dshone-tree-icon` 同一做法
 *（官方渲染出来的 DOM 里没有图标名，验证套件要认「是哪一态」只能靠标记，配合渲染出的
 * `path@d` 一起核）：`data-dshone-tree-icon="collapse-all"` 认这一枚是哪个按钮，
 * `data-dshone-tree-icon-value` 认当前是哪一态。
 */
function CollapseAllIcon({ glyph }: { glyph: CollapseAllGlyph }): unknown {
  return h(
    'svg',
    {
      viewBox: '0 0 16 16',
      width: 16,
      height: 16,
      fill: 'none',
      'aria-hidden': true,
      'data-dshone-tree-icon': 'collapse-all',
      'data-dshone-tree-icon-value': glyph,
    },
    ...COLLAPSE_ALL_GLYPHS[glyph].map((d, index) =>
      h('path', {
        key: String(index),
        d,
        fill: 'currentColor',
        'fill-rule': 'evenodd',
        'clip-rule': 'evenodd',
        transform: COLLAPSE_ALL_GLYPH_TRANSFORM,
      }),
    ),
  )
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
  selectMode: boolean
  onToggleSelectMode: () => void
  /**
   * 行首的分组过滤胶囊（#135 起并入这一行）——`GroupFilterBar` 的全部入参，
   * 由树主组件把分组状态与回调一起递进来；顶栏再按搜索展开与否补一个 `hidden`。
   * 拆成一个对象而不是七八个平铺的 props：它们属于同一个控件、只在这一处落地。
   */
  filter: {
    groups: readonly WorkspaceGroupDef[]
    activeGroupId: string | null
    groupCounts: ReadonlyMap<string, number>
    totalCount: number
    onPick: (groupId: string | null) => void
    onCreate: () => void
    onManage: () => void
  }
}

/** 顶部工具栏一行。 */
export function TopBar(props: TopBarProps): unknown {
  const { tr, query, allCollapsed, selectMode } = props
  const [addOpen, setAddOpen] = useState(false)
  // 折叠 / 展开态（#132）：官方那份实现就是组件里的一个 state（`searchExpanded`），
  // 初值 false = 平时一枚放大镜。查询本身住在树主组件里（去抖与 RPC 都在那边）。
  const [searchExpanded, setSearchExpanded] = useState(false)
  const searchRoot = useRef<HTMLDivElement | null>(null)
  const searchInput = useRef<HTMLInputElement | null>(null)
  const trimmedQuery = query.trim()

  // 展开后把焦点交给输入框（收起时不渲染它，所以焦点只能等它挂上来之后给）。
  useEffect(() => {
    if (searchExpanded) searchInput.current?.focus()
  }, [searchExpanded])

  // 官方口径（`dsh-client-ui-workspace/lib/client.js` 的 WorkspaceBrowser：展开中的
  // document click 监听里先 `blur()`，再 `if (normalizedQuery !== "") return`）：点到
  // 搜索区外面，**查询非空就保持展开**（结果还摊在列表里，收起会把用户正在看的东西抽走），
  // 空查询才收起。收起走的是这条，不清查询——空查询才收得起来，所以也没什么可清。
  useEffect(() => {
    if (!searchExpanded) return
    const onClick = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Node) || searchRoot.current?.contains(target) === true) return
      searchInput.current?.blur()
      if (trimmedQuery !== '') return
      setSearchExpanded(false)
    }
    document.addEventListener('click', onClick)
    return () => {
      document.removeEventListener('click', onClick)
    }
  }, [searchExpanded, trimmedQuery])

  /** 展开搜索栏：点放大镜、点容器都走这一条（官方那两处的 onClick 是同一件事）。 */
  const expandSearch = (): void => {
    setSearchExpanded(true)
  }
  const collapseSearch = (): void => {
    props.onQueryClear()
    setSearchExpanded(false)
  }

  const addItems = [
    {
      id: 'pick-folder',
      label: h('span', { 'data-dshone-tree-item': 'workspace-pick' }, tr('workspace.pickFolder')),
      // 图标位 14×14：紧凑档的项内图标盒就是 14×14（官方 `._itemIcon_1nxmc_144`），
      // 官方 16 档图标塞进去会溢出一圈，所以按官方给的显式尺寸参数打 14（官方自己也这么用）。
      icon: h(IconFolderOpenOutline, { size: 14 }),
    },
    ...(props.onCreateWorkspaceFolder === undefined
      ? []
      : [
          {
            id: 'create-folder',
            label: h('span', { 'data-dshone-tree-item': 'workspace-create' }, tr('workspace.create')),
            icon: h(IconPlusOutline, { size: 14 }),
          },
        ]),
  ]
  return h(
    'div',
    { className: 'dshOneTree_sectionHeader', 'data-dshone-tree': 'top-bar' },
    // 行首：分组过滤胶囊（#135 起并入这一行）。搜索展开时它让位（零宽收起，见文件头
    // 让位那一节）——组件照常挂载，`data-dshone-tree-visible` 让验证套件读得到这一刻。
    h(GroupFilterBar, { ...props.filter, tr, hidden: searchExpanded }),
    // 官方搜索栏（#132：两态都在，默认折叠）——search / searchSlot 两层各带一个
    // Expanded 变体，与官方侧栏的 DOM 同构；折叠态就是那枚 28px 的圆放大镜。
    // `data-dshone-tree-state` 是自有标记，让验证套件能直接读「现在是哪一态」，不必
    // 解析类名（与折叠全部那枚的 `data-dshone-tree-icon-value` 同一做法）。
    h(
      'div',
      {
        className: `dshOneTree_searchSlot${searchExpanded ? ' dshOneTree_searchSlotExpanded' : ''}`,
        ref: searchRoot,
      },
      h(
        'div',
        {
          className: `dshOneTree_search${searchExpanded ? ' dshOneTree_searchExpanded' : ''}`,
          'data-dshone-tree': 'search-box',
          'data-dshone-tree-state': searchExpanded ? 'expanded' : 'collapsed',
          onClick: expandSearch,
        },
        h(Tooltip, {
          label: tr('search'),
          side: 'bottom',
          delayMs: 500,
          // 官方：展开后不再出这一枚提示（`disabled: searchExpanded`）——这时按钮只是
          // 展开态图标位，提示没有意义。
          disabled: searchExpanded,
          children: h(
            'button',
            {
              type: 'button',
              className: 'dshOneTree_searchButton',
              'aria-label': tr('search.sessions.aria'),
              'aria-expanded': searchExpanded,
              'data-dshone-tree-action': 'search',
              onClick: expandSearch,
            },
            // 官方两态的图标尺寸不同：折叠 14、展开 11（`size: searchExpanded ? 11 : 14`）。
            h(IconSearchOutline, { size: searchExpanded ? 11 : 14 }),
          ),
        }),
        searchExpanded
          ? h('input', {
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
                collapseSearch()
              },
            })
          : null,
        // 清除钮只在展开态渲染（官方也是 `searchExpanded && …`）。
        searchExpanded
          ? h(
              'button',
              {
                type: 'button',
                className: 'dshOneTree_clearButton',
                'data-dshone-tree': 'search-clear',
                'aria-label': tr('search.clear'),
                onClick: (event: { stopPropagation(): void }) => {
                  event.stopPropagation()
                  collapseSearch()
                },
              },
              h(IconCloseFill, {}),
            )
          : null,
      ),
    ),
    h(
      'div',
      {
        // 搜索展开时让位（#135）：官方 `headerActionsHidden` 的同名同事——收成零宽、
        // 不可见也不接指针，收起搜索后原样回来（`data-dshone-tree-visible` 同胶囊那一枚）。
        className: `dshOneTree_headerActions${searchExpanded ? ' dshOneTree_headerActionsHidden' : ''}`,
        'data-dshone-tree': 'top-bar-actions',
        'data-dshone-tree-visible': searchExpanded ? 'false' : 'true',
      },
      // 折叠 / 展开全部（#99；图标 #118 起换成方框加减号）：图标与提示随当前态翻转，
      // 语义同旧侧栏——「还有展开着的」显示方框横杠（点了折叠全部），「全折叠了」
      // 显示方框十字（点了展开全部）。
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
          h(CollapseAllIcon, { glyph: allCollapsed ? 'plus' : 'minus' }),
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
        // #113：官方紧凑档（与右键菜单、分组胶囊菜单同档，侧栏里菜单密度一致）。
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
            h(IconProjectAddOutline, { size: 16 }),
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
              h(IconSettingsOutline, { size: 16 }),
            ),
          }),
      // #81 已有的多选入口（#131 起它前面那枚「视图选项」退役，这一枚位置不变）。
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
          h(IconChecklistOutline, { size: 16 }),
        ),
      }),
    ),
  )
}
