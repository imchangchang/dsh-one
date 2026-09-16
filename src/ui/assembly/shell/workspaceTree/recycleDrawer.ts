/**
 * 回收站抽屉（#103）：本地可逆那一层的界面。
 *
 * ## 形态（对齐旧侧栏实测形态，见已摘钩的 `src/ui/sessionsWebview.ts`）
 * - 从侧栏**底部半高滑出**（默认占面板高的 50%），上面主列表还看得见、还能点；
 * - 顶部一根提手：上拉可到 90%（留一条主列表），松手吸附两档；下拉到底或**只是点一下**
 *   就收起（位移 < 4px 视为点击）；
 * - **点抽屉外**（点在主树区域上）或按 Esc 收起；
 * - 内容为**按原工作区分块**，块头可折叠（折叠态持久化在客户端存储，见
 *   `pure/workspaceTreePrefs.ts` 的 `recycleCollapsed`），块内**按移入顺序倒序**
 *   （最近挪进来的在最上）；
 * - 每行行尾一枚「还原」，行菜单「还原 / 永久归档」——永久归档是**终点动作**
 *   （走官方 `archiveSession`），所以交给树层的确认弹窗，本件只发请求。
 *
 * ## 为什么抽屉是自有渲染、不占官方槽位
 * 官方侧栏没有「抽屉」这样的座位，硬塞一个新槽会与官方布局插件争地盘；整块盖住自己
 * 渲染的树区域是自有渲染范围内的事（同 #81 的处置）。
 */
import { createElement as h, useEffect, useRef, useState } from 'react'
import {
  IconArchiveOutline20,
  IconCloseFill14,
  IconEllipsisOutline16,
  IconRefreshOutline16,
  IconTriangleRightFill14,
  Menu,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { recycleCount, type RecycleGroup } from '../../../../pure/workspaceTreeView.ts'
import { displayTitle, timeLabel } from './format.ts'
import type { Translate } from './types.ts'

/** 抽屉档位（占面板高的比例）：默认半高；提手上拉到 90%。 */
const DRAWER_HEIGHT_DEFAULT = 0.5
const DRAWER_HEIGHT_EXPANDED = 0.9
/** 拖动范围夹取（下限留一点可见，上限不把面板盖满）。 */
const DRAWER_HEIGHT_MIN = 0.15
const DRAWER_HEIGHT_MAX = 0.97
/** 松手时低于此比例 = 收起抽屉（下拉到底关闭）。 */
const DRAWER_CLOSE_BELOW = 0.35
/** 位移小于此值（px）视为「点击提手」而不是拖动 = 收起抽屉。 */
const DRAWER_CLICK_SLOP = 4

export function RecycleDrawer({
  open,
  groups,
  collapsed,
  now,
  tr,
  busy,
  error,
  onClose,
  onToggleGroup,
  onOpen,
  onRestore,
  onArchive,
}: {
  open: boolean
  /** 抽屉内容（`deriveRecycleGroups` 按工作区分好块、块内按移入顺序倒序）。 */
  groups: readonly RecycleGroup[]
  /** 收起了的块键（持久化的纯视图态）。 */
  collapsed: readonly string[]
  now: number
  tr: Translate
  /** 有动作在飞（还原/归档中）：行上的动作先禁用，避免连点。 */
  busy: boolean
  error: string | null
  onClose: () => void
  onToggleGroup: (key: string) => void
  onOpen: (sessionId: string) => void
  onRestore: (sessionId: string) => void
  /** 永久归档（不可逆）：树层据此开确认弹窗，本件不直接执行。 */
  onArchive: (sessionId: string) => void
}): unknown {
  const drawerRef = useRef<HTMLDivElement | null>(null)
  /** 滑入动画的入场标记（挂载后下一帧再加 `.dshOneTree_drawerOpen`，否则 transition 不触发）。 */
  const [entered, setEntered] = useState(false)
  /** 拖动中的高度（面板高比例）；null = 用档位值。 */
  const [dragHeight, setDragHeight] = useState<number | null>(null)
  /** 松手吸附后的档位；null = 默认半高（每次重新打开都回默认档，旧侧栏同此处置）。 */
  const [snapHeight, setSnapHeight] = useState<number | null>(null)
  /** 开着行菜单的那一行（菜单开着时 Esc / 点外先让菜单走，不连动关抽屉）。 */
  const [menuFor, setMenuFor] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setEntered(false)
      setSnapHeight(null)
      setMenuFor(null)
      return
    }
    const frame = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [open])

  // 点抽屉外收起：判据是「点在自有树区域里、但不在抽屉上」。官方菜单 / 弹窗都 portal 到
  // document.body（不在树区域里），所以点它们不会把抽屉带走——不需要给浮层列白名单。
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: { target: EventTarget | null }): void => {
      const drawer = drawerRef.current
      const root = drawer?.parentElement ?? null
      const target = event.target
      if (drawer === null || root === null || !(target instanceof Node)) return
      if (drawer.contains(target) || !root.contains(target)) return
      onClose()
    }
    document.addEventListener('mousedown', onPointerDown, true)
    return () => document.removeEventListener('mousedown', onPointerDown, true)
  }, [open, onClose])

  // Esc 收起：官方菜单 / 弹窗自己处理 Esc（它们会 preventDefault），让它们先走。
  useEffect(() => {
    if (!open) return
    const onKey = (event: { key: string; defaultPrevented: boolean; preventDefault(): void }): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || menuFor !== null) return
      event.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, onClose, menuFor])

  /** 提手拖动：上拉扩大高度，松手吸附两档；位移 < 4px 视为点击 = 收起。 */
  const startDrag = (event: {
    button: number
    clientY: number
    pointerId: number
    preventDefault(): void
    currentTarget: EventTarget | null
  }): void => {
    if (event.button !== 0) return
    const drawer = drawerRef.current
    const panel = drawer?.parentElement ?? null
    if (drawer === null || panel === null) return
    event.preventDefault()
    const handle = event.currentTarget as HTMLElement | null
    const startY = event.clientY
    const panelHeight = Math.max(1, panel.offsetHeight)
    const baseRatio = drawer.offsetHeight / panelHeight
    let maxDelta = 0
    let lastRatio = baseRatio
    try {
      handle?.setPointerCapture(event.pointerId)
    } catch {
      /* 合成事件没有活动指针时捕获会抛：move/up 仍挂在提手上，点击语义不受影响 */
    }
    const move = (ev: PointerEvent): void => {
      maxDelta = Math.max(maxDelta, Math.abs(startY - ev.clientY))
      const ratio = baseRatio + (startY - ev.clientY) / panelHeight
      lastRatio = Math.min(DRAWER_HEIGHT_MAX, Math.max(DRAWER_HEIGHT_MIN, ratio))
      setDragHeight(lastRatio)
    }
    const up = (): void => {
      handle?.removeEventListener('pointermove', move)
      handle?.removeEventListener('pointerup', up)
      handle?.removeEventListener('pointercancel', up)
      setDragHeight(null)
      if (maxDelta < DRAWER_CLICK_SLOP || lastRatio < DRAWER_CLOSE_BELOW) {
        onClose()
        return
      }
      // 吸附：过半到 90%，否则回半高。
      setSnapHeight(
        lastRatio >= (DRAWER_HEIGHT_DEFAULT + DRAWER_HEIGHT_EXPANDED) / 2 ? DRAWER_HEIGHT_EXPANDED : DRAWER_HEIGHT_DEFAULT,
      )
    }
    handle?.addEventListener('pointermove', move)
    handle?.addEventListener('pointerup', up)
    handle?.addEventListener('pointercancel', up)
  }

  if (!open) return null
  const total = recycleCount(groups)
  const height = dragHeight ?? snapHeight ?? DRAWER_HEIGHT_DEFAULT

  return h(
    'div',
    {
      className: `dshOneTree_drawer${entered ? ' dshOneTree_drawerOpen' : ''}`,
      style: { height: `${String(height * 100)}%` },
      ref: drawerRef,
      'data-dshone-tree': 'recycle-drawer',
      'data-dshone-recycle-height': String(Math.round(height * 100)),
      role: 'region',
      'aria-label': tr('recycle.title'),
    },
    h(
      'div',
      {
        className: 'dshOneTree_drawerHandle',
        'data-dshone-tree-action': 'recycle-handle',
        title: tr('recycle.handle'),
        onPointerDown: startDrag,
      },
      h('span', { className: 'dshOneTree_drawerGrip' }),
    ),
    h(
      'div',
      { className: 'dshOneTree_drawerHeader' },
      h('span', { className: 'dshOneTree_drawerTitle' }, tr('recycle.title')),
      h('span', { className: 'dshOneTree_drawerCount', 'data-dshone-recycle-count': total }, String(total)),
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
            h(RecycleBlock, {
              key: group.key,
              group,
              collapsed: collapsed.includes(group.key),
              now,
              tr,
              busy,
              openMenuFor: menuFor,
              onToggle: () => onToggleGroup(group.key),
              onMenuToggle: (sessionId: string) => setMenuFor(menuFor === sessionId ? null : sessionId),
              onOpen,
              onRestore,
              onArchive,
            }),
          ),
        ),
    error === null ? null : h('div', { className: 'dshOneTree_selectionError', role: 'alert' }, error),
  )
}

/** 抽屉里的一个工作区块：块头（箭头 + 名 + 计数）+ 成员行。 */
function RecycleBlock({
  group,
  collapsed,
  now,
  tr,
  busy,
  openMenuFor,
  onToggle,
  onMenuToggle,
  onOpen,
  onRestore,
  onArchive,
}: {
  group: RecycleGroup
  collapsed: boolean
  now: number
  tr: Translate
  busy: boolean
  /** 当前开着行菜单的会话 id（同一时刻只开一个）。 */
  openMenuFor: string | null
  onToggle: () => void
  onMenuToggle: (sessionId: string) => void
  onOpen: (sessionId: string) => void
  onRestore: (sessionId: string) => void
  onArchive: (sessionId: string) => void
}): unknown {
  const label = group.workspaceId === undefined ? tr('group.ungrouped') : group.label
  return h(
    'div',
    { className: 'dshOneTree_drawerGroup', 'data-dshone-recycle-group': group.key },
    h(
      'button',
      {
        type: 'button',
        className: 'dshOneTree_drawerGroupLabel',
        'data-dshone-recycle-group-toggle': group.key,
        'data-dshone-recycle-collapsed': collapsed ? 'true' : 'false',
        'aria-expanded': !collapsed,
        onClick: onToggle,
      },
      h(
        'span',
        { className: 'dshOneTree_drawerGroupArrow' },
        h(IconTriangleRightFill14, { className: `dshOneTree_arrow${collapsed ? '' : ' dshOneTree_arrowOpen'}` }),
      ),
      h('span', { className: 'dshOneTree_drawerGroupLabelText' }, label),
      h('span', { className: 'dshOneTree_drawerGroupCount' }, String(group.sessions.length)),
    ),
    collapsed
      ? null
      : group.sessions.map((node) => {
          const title = displayTitle(node, tr)
          const menuOpen = openMenuFor === node.id
          const anchor = h(
            'button',
            {
              type: 'button',
              className: 'dshOneTree_rowIconButton',
              'aria-label': tr('actions.session.aria', { name: title }),
              'data-dshone-recycle-menu': node.id,
              onClick: (event: { stopPropagation(): void }) => {
                event.stopPropagation()
                onMenuToggle(node.id)
              },
            },
            h(IconEllipsisOutline16, {}),
          )
          return h(
            'div',
            {
              className: `dshOneTree_drawerRow${menuOpen ? ' dshOneTree_menuOpen' : ''}`,
              key: node.id,
              role: 'treeitem',
              'data-dshone-recycle-row': node.id,
              onClick: () => onOpen(node.id),
            },
            h('span', { className: 'dshOneTree_title' }, title),
            h('span', { className: 'dshOneTree_time' }, timeLabel(node.updatedAt, now, tr)),
            h(
              'span',
              { className: 'dshOneTree_drawerActions' },
              h(Tooltip, {
                label: tr('recycle.restore'),
                side: 'top',
                delayMs: 500,
                children: h(
                  'button',
                  {
                    type: 'button',
                    className: 'dshOneTree_drawerRestore',
                    disabled: busy,
                    'aria-label': tr('recycle.restore.aria', { name: title }),
                    'data-dshone-recycle-restore': node.id,
                    onClick: (event: { stopPropagation(): void }) => {
                      event.stopPropagation()
                      onRestore(node.id)
                    },
                  },
                  h(IconRefreshOutline16, { size: 14 }),
                  tr('recycle.restore'),
                ),
              }),
              h(Menu, {
                open: menuOpen,
                onClose: () => onMenuToggle(node.id),
                items: [
                  // #113：官方紧凑档的图标位是 14×14（官方 `._itemIcon_1nxmc_144`），
                  // 项内图标按它给尺寸（官方 16 档塞进 14px 的盒子会溢出一圈）。
                  { id: 'restore', label: tr('recycle.restore'), icon: h(IconRefreshOutline16, { size: 14 }) },
                  {
                    id: 'archive',
                    // 标记属性（自有契约，与 rows.ts 的菜单项同一做法）：官方菜单项的
                    // 类名是官方哈希，验证套件与样式都不该认它。
                    label: h('span', { 'data-dshone-recycle-item': 'archive' }, tr('menu.archiveForever')),
                    icon: h(IconArchiveOutline20, { size: 14 }),
                    danger: true,
                  },
                ],
                onSelect: (id: string) => {
                  onMenuToggle(node.id)
                  if (id === 'restore') onRestore(node.id)
                  if (id === 'archive') onArchive(node.id)
                },
                // #113：官方紧凑档（与行菜单、行内码右键菜单同一档）。
                compact: true,
                portal: true,
                closeOnPointerLeave: true,
                align: 'end',
                anchor,
              }),
            ),
          )
        }),
  )
}
