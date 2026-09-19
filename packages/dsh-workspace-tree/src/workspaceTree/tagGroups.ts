/**
 * 会话标签组的**渲染与拖拽**（#107）：组块（pill 组头 + 贯穿竖线 + 组内缩进行）、
 * 折叠计数、拖会话入组的落点判定、拖 pill 换组序的插入位置判定。
 *
 * 数据与判定全在纯模块 `pure/sessionTagGroups.ts`（迁入、切块、空组清理、换序校核），
 * 本件只做「画出来 + 把拖拽翻译成一次请求」——判据不在这里重复。
 *
 * ## 形态与观感逐字沿用旧侧栏（#107 是回归条目）
 * pill（小圆角块 + 6px 色点 + 10px 粗体名）、pill 下沿到组尾的 2px 贯穿竖线、组内行
 * 24px 左缩进、折叠组头右侧的计数角标——数值与旧侧栏 `sessionsView.ts` 的
 * `.tag-*` 规则逐字一致，用户看到的是同一套东西。
 *
 * **#122 把竖线改回旧侧栏那一版**：先前它是组内行容器（`tagRows`）的 `border-left`，
 * 横向上又被外边距推到组内行外侧，于是同组只能靠缩进认出来；现在它是组块上一个
 * **绝对定位的细线元素**（几何见 styles.ts 的 `.dshOneTree_tagLine`），颜色是组色
 * **实色**，组内行的左内边距回到旧侧栏的 24px。组色变量因此挂在**组块**上：
 * 竖线与组内行都是 pill 的兄弟节点，只有从组块继承才拿得到色值。
 *
 * **颜色为什么是自造色板（本件唯一不引用官方 token 的地方）**：6 个标签色是用户
 * 自选的**标签色板**，官方 token 集里没有这一类（逐个看过
 * `dsh-client-ui-theme/lib/client.js` 导出的 `--dsw-*`：只有品牌 / 状态 / 文本 /
 * 边框 / 背景几族，没有 6 色图表色板）。旧侧栏用的是 VS Code 的 chart 色，那组变量
 * 官方 web 侧不存在（本插件要保持可移植），所以这里取**同一组色值的字面量**：
 * 观感与旧侧栏一字不差，且两端一致。
 *
 * ## 拖拽载荷（自定义 MIME，沿用旧侧栏那两个名字）
 * - `text/dsh-session`：会话行拖拽，落点是「某个标签组块」（入组）或「工作区块」
 *   （移出分组）；
 * - `text/dsh-tag`：组 pill 拖拽，落点是另一个 pill 的上/下半（插到它前/后）。
 * 用自定义 MIME 而不是 `text/plain`：拖拽过程中 `dataTransfer.types` 就能分辨载荷，
 * 不必等 drop 才读（外部拖进来的文本不会被误当成会话）。
 */
import { createElement as h, useState } from 'react'
import {
  IconArchiveOutline20,
  IconEditOutline16,
  IconEllipsisOutline16,
  IconPlusOutline16,
  IconTrashOutline16,
  IconTriangleRightFill14,
  Menu,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { tagGroupCounts, tagGroupDisplayName, type TagGroupDef } from '../../../../src/pure/sessionTagGroups.ts'
import type { SessionNode } from '../../../../src/pure/workspaceTreeView.ts'
import { TAG_COLORS, isPresetTagId, type TagColor } from '../../../../src/pure/sessionTags.ts'
import type { Translate } from './types.ts'

/** 会话行拖拽的载荷类型（旧侧栏同名）。 */
export const SESSION_DRAG_MIME = 'text/dsh-session'
/** 组 pill 拖拽的载荷类型（旧侧栏同名）。 */
export const TAG_DRAG_MIME = 'text/dsh-tag'

/**
 * 标签色板（色值逐字取自旧侧栏 `sessionsView.ts` 的 `.tag-*` 规则，出处与理由见
 * 文件头）。观感语言不参与密度档。
 */
export const TAG_COLOR_CSS: Record<TagColor, string> = {
  yellow: '#e5c07b',
  blue: '#5686fe',
  green: '#89d185',
  orange: '#d18616',
  purple: '#b180d7',
  red: '#f14c4c',
}

/** 颜色的文案键（菜单里选色用）。 */
export const TAG_COLOR_LABEL: Record<TagColor, string> = {
  yellow: 'tag.color.yellow',
  blue: 'tag.color.blue',
  green: 'tag.color.green',
  orange: 'tag.color.orange',
  purple: 'tag.color.purple',
  red: 'tag.color.red',
}

/**
 * 折叠态的存储键：`<分组键>\u0000<组 id>`。标签组 id 只在**一个工作区的桶内**唯一
 * （两个工作区各有一套自己的组），折叠集合是全局一份，所以键里必须带工作区那一半。
 * 用 NUL 作分隔符：分组键（工作区 id / 未分组桶的空串）与组 id 里都不会出现它。
 */
export function tagCollapseKey(groupKey: string, tagId: string): string {
  return `${groupKey}\u0000${tagId}`
}

/**
 * 组 pill 的菜单（#107 定稿的八项：标题行 + 组内新建会话 / 整组归档 / 整组移入回收站 /
 * 移出标签组 / 改名 / 颜色 / 删除组）。
 *
 * **预设组少两项**（#213）：预设组不可改名、不可删除（`pure/sessionTags.ts` 写明的固定
 * id 语义，动作层也各拒一道），所以「改名」与「删除组」那一节都不出现——菜单是
 * 标题行 + 组内新建会话 / 整组归档 / 整组移入回收站 / 移出标签组 / 颜色。**颜色照旧
 * 可改**：旧侧栏对预设组的选色没有门槛（`sessionsStore.ts` 的 `setTagColor` 只查组
 * 存不存在），照它的口径。
 *
 * 为什么是「一条小标题 + 一节颜色」而不是二级子菜单：官方 `Menu` 的项**有** `submenu` 这一档
 * （#172 读官方源码核过），但它是**右侧飞出的一层**（官方 `._submenu_1nxmc_9` 绝对定位在
 * `left:calc(100% + 10px)`），窄侧栏（260px）里放不下——我们自己的二级菜单因此改成「就地展开」
 * 并给父项配了一枚右端指示器（形态见 rows.ts 的 `submenuParent`，#172 把那枚指示器换成了官方
 * 两枚 chevron）。颜色那 6 项不必占「飞出一层」这个形态，所以按工作区行菜单「所属分组」同一
 * 形态摊成一节（标题「颜色」+ 6 个色块项），当前色走官方 `selectedIds` 打勾；`separator` /
 * `label` 两种类型项在本插件的行菜单里也已经在用。菜单项只在菜单里出现，不做常驻占位。
 *
 * @param id 组 id（预设组按它认出来）
 * @param counts 组内会话的三个数（菜单要写「整组（N 个会话）」并据此禁用）
 * @param counts.archivable 够格归档的条数，0 = 整组都不可归档 → 那一项禁用
 * @param counts.recyclable 够格移入回收站的条数，0 = 整组都置顶 → 那一项禁用
 */
export function tagGroupMenuItems(opts: {
  id: string
  name: string
  color: TagColor
  total: number
  archivable: number
  recyclable: number
  tr: Translate
}): unknown[] {
  const { tr, name, total, archivable, recyclable } = opts
  const preset = isPresetTagId(opts.id)
  // 每项的文案包一层带 `data-dshone-tree-item` 的 span：菜单项的类名是官方哈希，
  // 验证套件与样式都不该认它（与行菜单同一做法，见 rows.ts 的 sessionMenuItem）。
  // #113：菜单项图标按官方紧凑档的图标位给尺寸——14×14 是官方该档的项内图标盒
  // （`._compactList_1nxmc_128 ._itemIcon_1nxmc_144{width:14px;height:14px}`），
  // 官方 16 档图标塞进去会溢出一圈，所以用官方图标件自己的显式尺寸参数打 14。
  const label = (id: string, text: string): unknown => h('span', { 'data-dshone-tree-item': id }, text)
  return [
    { type: 'label', id: 'tag-menu-title', text: tr('tag.menu.title', { name }) },
    { id: 'tag-new-session', label: label('tag-new-session', tr('tag.newSession')), icon: h(IconPlusOutline16, { size: 14 }) },
    {
      id: 'tag-archive',
      label: label('tag-archive', tr('tag.archive', { n: total })),
      icon: h(IconArchiveOutline20, { size: 14 }),
      disabled: archivable === 0,
      ...(archivable === 0 ? { title: tr('tag.archive.none') } : {}),
    },
    {
      id: 'tag-recycle',
      label: label('tag-recycle', tr('tag.recycle', { n: total })),
      icon: h(IconTrashOutline16, { size: 14 }),
      disabled: recyclable === 0,
      ...(recyclable === 0 ? { title: tr('tag.recycle.blocked') } : {}),
    },
    { id: 'tag-ungroup', label: label('tag-ungroup', tr('tag.ungroup')) },
    // 预设组不可改名：这一项整个不出现（动作层也拒，见 tree.ts 的 onTagMenuSelect）。
    ...(preset
      ? []
      : [{ id: 'tag-rename', label: label('tag-rename', tr('tag.rename')), icon: h(IconEditOutline16, { size: 14 }) }]),
    { type: 'separator', id: 'tag-color-separator' },
    { type: 'label', id: 'tag-color-label', text: tr('tag.color') },
    ...TAG_COLORS.map((candidate) => ({
      id: `tag-color-${candidate}`,
      label: label(`tag-color-${candidate}`, tr(TAG_COLOR_LABEL[candidate])),
      icon: h(TagColorSwatch, { color: candidate }),
    })),
    // 预设组删不掉：分隔线与那一项都不出现（动作层也拒，见 deleteTagGroup）。
    ...(preset
      ? []
      : [
          { type: 'separator', id: 'tag-delete-separator' },
          {
            id: 'tag-delete',
            label: label('tag-delete', tr('tag.delete')),
            icon: h(IconTrashOutline16, { size: 14 }),
            danger: true,
          },
        ]),
  ]
}

/** 最小拖拽事件面（React 的合成事件与原生事件都满足它）。**与「管理分组…」的组行拖拽
 *  共用**（#155）：那个对话框里拖组行的判定就是这一套，不另写一份。 */
export interface DragLike {
  dataTransfer: { types: readonly string[]; getData(type: string): string; setData(type: string, value: string): void; dropEffect?: string; effectAllowed?: string } | null
  clientY: number
  /** 拖出时指针要去的地方：用它区分「真的离开这块」与「只是从子元素间穿过」。 */
  relatedTarget?: Node | null
  currentTarget: HTMLElement
  preventDefault(): void
  stopPropagation(): void
}

/**
 * 这一下 `dragleave` 是不是真的离开了容器。
 *
 * `dragenter`/`dragleave` 会在**子元素之间**反复触发（指针从组头移到组内行也算一次
 * 离开），直接照单全收会让高亮闪个不停；所以指针要去的地方还在容器里就当没离开。
 */
export function leavingContainer(event: DragLike): boolean {
  const related = event.relatedTarget ?? null
  return related === null || !event.currentTarget.contains(related)
}

/** 这一下拖拽带的是不是某种我们自己的载荷（`dataTransfer.types` 就能分辨）。 */
export function carries(event: DragLike, mime: string): boolean {
  return event.dataTransfer?.types.includes(mime) === true
}

/** 会话行的拖拽属性（`draggable` + 把会话 id 写进载荷）。 */
export function sessionDragProps(sessionId: string): Record<string, unknown> {
  return {
    draggable: true,
    onDragStart: (event: DragLike) => {
      if (event.dataTransfer === null) return
      event.dataTransfer.setData(SESSION_DRAG_MIME, sessionId)
      event.dataTransfer.effectAllowed = 'move'
    },
  }
}

/**
 * 「拖到组外 = 移出分组」的落点（工作区块那一层）：只接会话拖拽，接到就清归属。
 * 标签组块的 drop 会 `stopPropagation`，所以拖进组里的那一下不会又跑到这里来。
 */
export function ungroupDropZone(onDrop: (sessionId: string) => void): Record<string, unknown> {
  return {
    'data-dshone-tree-drop': 'ungroup',
    onDragOver: (event: DragLike) => {
      if (!carries(event, SESSION_DRAG_MIME)) return
      event.preventDefault()
      event.stopPropagation()
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move'
    },
    onDrop: (event: DragLike) => {
      if (!carries(event, SESSION_DRAG_MIME)) return
      event.preventDefault()
      event.stopPropagation()
      const sessionId = event.dataTransfer?.getData(SESSION_DRAG_MIME) ?? ''
      if (sessionId !== '') onDrop(sessionId)
    },
  }
}

/** 组色小色块（选色菜单与 pill 上的圆点共用同一份色值）。 */
export function TagColorSwatch({ color }: { color: TagColor }): unknown {
  return h('span', { className: 'dshOneTree_tagSwatch', style: { background: TAG_COLOR_CSS[color] }, 'aria-hidden': true })
}

/**
 * 一个标签组块：组头（pill + 折叠三角 + 折叠计数 + 组菜单）+ 组内会话行。
 *
 * 组内行由调用方渲染好传进来（`children`）——行组件是树共用的那一枚
 * （`SessionRow`，拖拽属性由树层拼），组块只负责它的容器、缩进与贯穿竖线。
 */
export function TagGroupBlock({
  groupKey,
  def,
  collapsed,
  sessions,
  isUnread,
  menuItems,
  menuSelectedIds,
  onMenuSelect,
  onToggleCollapse,
  onDropSession,
  onDropTag,
  tr,
  children,
}: {
  /** 分组键（工作区 id / 未分组桶的空串）：本块属于谁。 */
  groupKey: string
  def: TagGroupDef
  collapsed: boolean
  /** 组内**全部**会话（折叠计数按它数；行由 children 给）。 */
  sessions: readonly SessionNode[]
  isUnread: (sessionId: string) => boolean
  menuItems: readonly unknown[]
  menuSelectedIds: readonly string[]
  onMenuSelect: (id: string) => void
  onToggleCollapse: () => void
  /** 会话被拖进本组。 */
  onDropSession: (sessionId: string) => void
  /** 别组的 pill 被拖到本 pill 的上/下半：插到它前 / 后。 */
  onDropTag: (sourceTagId: string, before: boolean) => void
  tr: Translate
  children?: unknown
}): unknown {
  const [menuOpen, setMenuOpen] = useState(false)
  const [dropActive, setDropActive] = useState(false)
  const [pillDrop, setPillDrop] = useState<'before' | 'after' | null>(null)
  const counts = tagGroupCounts(sessions, isUnread)
  const hasCounts = counts.pending + counts.running + counts.unread > 0
  // #213：组名在这一处解析——预设组的 `name` 是 null（名字走 l10n，见纯模型），
  // 自建组就是用户原文；块里所有写名字的地方（pill、aria、提示）都用这一个。
  const name = tagGroupDisplayName(def, tr)

  const anchor = h(
    'button',
    {
      type: 'button',
      className: 'dshOneTree_rowIconButton',
      'aria-label': tr('actions.tag.aria', { name }),
      'data-dshone-tree-action': 'tag-menu',
      'data-dshone-tree-tag-target': def.id,
      onClick: (event: { stopPropagation(): void }) => {
        event.stopPropagation()
        setMenuOpen((open: boolean) => !open)
      },
    },
    h(IconEllipsisOutline16, {}),
  )

  const head = h(
    'div',
    { className: 'dshOneTree_tagHead' },
    h(
      'span',
      {
        className: 'dshOneTree_tagPill',
        draggable: true,
        title: tr('tag.pill.aria', { name }),
        'data-dshone-tree-tag-pill': def.id,
        'data-dshone-tag-drop': pillDrop ?? '',
        onDragStart: (event: DragLike) => {
          if (event.dataTransfer === null) return
          event.dataTransfer.setData(TAG_DRAG_MIME, def.id)
          event.dataTransfer.effectAllowed = 'move'
        },
        onDragEnd: () => setPillDrop(null),
        onDragOver: (event: DragLike) => {
          if (!carries(event, TAG_DRAG_MIME)) return
          event.preventDefault()
          event.stopPropagation()
          // 落点 = 指针在 pill 中轴的哪一半（旧侧栏同款判定）。
          const rect = event.currentTarget.getBoundingClientRect()
          setPillDrop(event.clientY < rect.top + rect.height / 2 ? 'before' : 'after')
        },
        onDragLeave: (event: DragLike) => {
          if (!carries(event, TAG_DRAG_MIME)) return
          if (!leavingContainer(event)) return
          setPillDrop(null)
        },
        onDrop: (event: DragLike) => {
          if (!carries(event, TAG_DRAG_MIME)) return
          event.preventDefault()
          event.stopPropagation()
          const sourceId = event.dataTransfer?.getData(TAG_DRAG_MIME) ?? ''
          const rect = event.currentTarget.getBoundingClientRect()
          const before = event.clientY < rect.top + rect.height / 2
          setPillDrop(null)
          if (sourceId === '' || sourceId === def.id) return
          onDropTag(sourceId, before)
        },
      },
      h('span', { className: 'dshOneTree_tagDot' }),
      h('span', { className: 'dshOneTree_tagName' }, name),
    ),
    h(
      'button',
      {
        type: 'button',
        className: 'dshOneTree_tagToggle',
        'data-dshone-tree-action': 'tag-toggle',
        'data-dshone-tree-tag-target': def.id,
        'aria-expanded': !collapsed,
        'aria-label': collapsed ? tr('tag.expand', { name }) : tr('tag.collapse', { name }),
        onClick: (event: { stopPropagation(): void }) => {
          event.stopPropagation()
          onToggleCollapse()
        },
      },
      h(IconTriangleRightFill14, { className: `dshOneTree_tagArrow${collapsed ? '' : ' dshOneTree_tagArrowOpen'}` }),
    ),
    // 折叠态才出计数（展开时每行自己带状态点，再数一遍是噪音）。
    collapsed && hasCounts
      ? h(
          'span',
          {
            className: 'dshOneTree_tagCounts',
            'data-dshone-tree-tag-counts': `${String(counts.pending)}/${String(counts.running)}/${String(counts.unread)}`,
          },
          counts.pending > 0
            ? h(
                'span',
                { className: 'dshOneTree_tagCount', key: 'pending', title: tr('tag.count.pending', { n: counts.pending }) },
                h(StateDot, { state: 'warning' }),
                String(counts.pending),
              )
            : null,
          counts.running > 0
            ? h(
                'span',
                { className: 'dshOneTree_tagCount', key: 'running', title: tr('tag.count.running', { n: counts.running }) },
                h(StateDot, { state: 'ongoing' }),
                String(counts.running),
              )
            : null,
          counts.unread > 0
            ? h(
                'span',
                { className: 'dshOneTree_tagCount', key: 'unread', title: tr('tag.count.unread', { n: counts.unread }) },
                h(StateDot, { state: 'done' }),
                String(counts.unread),
              )
            : null,
        )
      : null,
    h(
      'span',
      { className: 'dshOneTree_rowActions' },
      h(Menu, {
        open: menuOpen,
        onClose: () => setMenuOpen(false),
        items: menuItems,
        selectedIds: menuSelectedIds,
        onSelect: (id: string) => {
          setMenuOpen(false)
          onMenuSelect(id)
        },
        portal: true,
        closeOnPointerLeave: true,
        // #113：官方紧凑档（与行菜单、行内码右键菜单同一档）——分组菜单带 `separator`
        // 与两条分组标题，紧凑档下它们的间距由官方该档给（`._separator{margin:2px}`、
        // `._label{padding:4px 7px;font-size:11px;line-height:16px}`），我们不加样式。
        compact: true,
        anchor,
      }),
    ),
  )

  return h(
    'div',
    {
      className:
        `dshOneTree_tagBlock${dropActive ? ' dshOneTree_tagDropActive' : ''}` +
        `${collapsed ? ' dshOneTree_tagCollapsed' : ''}${menuOpen ? ' dshOneTree_menuOpen' : ''}`,
      // 组色经 CSS 变量下发到**组块**这一层，颜色的用法（pill 的底/边、竖线段、组内行缩进的
      // 参照）全在 styles.ts 里。挂在组块而不是 pill 上：#122 的竖线与组内行都是 pill 的
      // 兄弟节点，变量只有从共同的祖先把色值继承下去才到得了它们。
      style: { '--dshone-tag-color': TAG_COLOR_CSS[def.color] },
      'data-dshone-tree': 'tag-block',
      'data-dshone-tree-tag': def.id,
      'data-dshone-tree-key': groupKey,
      'data-dshone-tag-collapsed': collapsed,
      // 会话拖到本块 = 归进本组（拖到块外的工作区行上才是移出分组）。
      onDragEnter: (event: DragLike) => {
        if (!carries(event, SESSION_DRAG_MIME)) return
        event.stopPropagation()
        setDropActive(true)
      },
      onDragOver: (event: DragLike) => {
        if (!carries(event, SESSION_DRAG_MIME)) return
        event.preventDefault()
        event.stopPropagation()
        if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move'
        setDropActive(true)
      },
      onDragLeave: (event: DragLike) => {
        if (!carries(event, SESSION_DRAG_MIME)) return
        if (!leavingContainer(event)) return
        setDropActive(false)
      },
      onDrop: (event: DragLike) => {
        if (!carries(event, SESSION_DRAG_MIME)) return
        event.preventDefault()
        event.stopPropagation()
        setDropActive(false)
        const sessionId = event.dataTransfer?.getData(SESSION_DRAG_MIME) ?? ''
        if (sessionId !== '') onDropSession(sessionId)
      },
    },
    head,
    // 贯穿竖线（#122）：从 pill 下沿画到组块底部的一条组色细线，几何与颜色全在 styles.ts
    // 的那条规则里（本件只放元素与自描述标记）。折叠态由 CSS 隐藏——所以这里不按折叠条件
    // 决定渲染与否，态只有一处（`.dshOneTree_tagCollapsed .dshOneTree_tagLine`）。
    h('div', { className: 'dshOneTree_tagLine', 'data-dshone-tree': 'tag-line' }),
    collapsed
      ? null
      : h('div', { className: 'dshOneTree_tagRows', 'data-dshone-tree-tag-rows': def.id }, children as never),
  )
}
