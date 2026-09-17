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
 * - **块头与侧栏的工作区行同一套折叠语言**（#144）：同一枚箭头图标与同一套展开标记、
 *   同一格箭头位、同一行高（见 `styles.ts` 那条规则上方的逐项取值）；
 * - 每行行尾**直接列出两枚动作**（#144：此前是「还原」文字按钮 + ⋯ 二级菜单）——
 *   「还原」（`IconRefreshOutline16`）与「永久归档」（`IconTrashOutline16`，按错误色），
 *   几何取侧栏行尾动作按钮同一档；永久归档是**终点动作**（走官方 `archiveSession`），
 *   所以这一枚只发请求、由树层的确认弹窗执行（本件不直接执行）。
 *
 * ## 开合都有动效（#117）
 * 滑入与滑出共用同一条 CSS 过渡（时长/缓动是官方 token，见 `styles.ts` 那段规则的出处注），
 * 所以两边天然对称。关闭时**不立刻卸载**：元素先进退场期把滑出演完，`transitionend` 一到
 * 再卸（兜底定时器防收不到事件）。选「退场期保留」而不是「常驻挂载」的理由：`closed` 时
 * 元素真的从 DOM 里消失是本件既有的对外形态（#114 的套件与几处回归都按「关闭 = DOM 里
 * 没有抽屉」判），常驻挂载要靠 `visibility` 之类的手段假装不在，反倒把「关上」这件事
 * 拆成两份判据；而退场期只是一个渲染相位，开合态仍只有 `recycleDrawerStore` 一份事实源。
 *
 * ## 为什么抽屉是自有渲染、不占官方槽位
 * 官方侧栏没有「抽屉」这样的座位，硬塞一个新槽会与官方布局插件争地盘；整块盖住自己
 * 渲染的树区域是自有渲染范围内的事（同 #81 的处置）。
 */
import { createElement as h, useEffect, useRef, useState } from 'react'
import {
  IconCloseFill14,
  IconRefreshOutline16,
  IconTrashOutline16,
  IconTriangleRightFill14,
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

/**
 * 抽屉在 DOM 里的相位（#117）。`closed` 完全不渲染；`entering` / `open` 是滑入的两个拍
 * （先挂上、等元素以收起位画过一帧再加展开类，否则 transition 不触发——#103 的入场动画也
 * 是这个路子）；`leaving` 是**退场期**：关闭之后元素还留在 DOM 里把滑出过渡演完。
 */
type DrawerPhase = 'closed' | 'entering' | 'open' | 'leaving'

/**
 * 退场期的兜底余量（毫秒）：正常情况下 `transitionend` 一到就收场，这个余量只用在
 * 「兜底定时器」上，避免它和过渡结束抢那几毫秒。定时器的时长本身不写死——读元素上真实
 * 的过渡时长（见 `transitionMsOf`），因为那是官方 token 算出来的值，可能与 200ms 不同。
 */
const DRAWER_EXIT_SLACK_MS = 60

/** 元素上真实的过渡时长（毫秒）；多条时取最长的一条（本件的过渡只有 transform 一条）。 */
function transitionMsOf(element: HTMLElement): number {
  const parts = getComputedStyle(element).transitionDuration.split(',')
  let longest = 0
  for (const part of parts) {
    const value = Number.parseFloat(part)
    if (!Number.isFinite(value)) continue
    const ms = part.trim().endsWith('ms') ? value : value * 1000
    longest = Math.max(longest, ms)
  }
  return longest
}

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
  /** 挂载相位（见 `DrawerPhase`）：滑入的入场拍 + 关闭后的退场期都住在它身上。 */
  const [phase, setPhase] = useState<DrawerPhase>('closed')
  /** 拖动中的高度（面板高比例）；null = 用档位值。 */
  const [dragHeight, setDragHeight] = useState<number | null>(null)
  /** 松手吸附后的档位；null = 默认半高（每次重新打开都回默认档，旧侧栏同此处置）。 */
  const [snapHeight, setSnapHeight] = useState<number | null>(null)

  // 开合态 → 相位。打开：先挂上（entering，元素在收起位、还没有展开类）。关闭：**不卸载**，
  // 先进 leaving 把滑出过渡演完（#117），收场交给下面那个 effect。开合态本身仍只有
  // `recycleDrawerStore` 一份事实源，本件只是按它决定元素在 DOM 里的相位。
  useEffect(() => {
    if (open) {
      setPhase('entering')
      return
    }
    setSnapHeight(null)
    setPhase((prev) => (prev === 'closed' ? 'closed' : 'leaving'))
  }, [open])

  // entering → open：加展开类这一下就是滑入的触发点，而过渡要成立，元素必须**先以收起位
  // 真的过了一帧**（挂载与加类落在同一帧的话，浏览器看不到「从哪来」，直接把它画在展开位、
  // 过渡不触发——#117 实测到的就是这个：加类那次提交赶上插入那次提交，滑入变成瞬移）。
  // 所以等两帧：第一帧元素以收起位落进画面，第二帧才加类。
  useEffect(() => {
    if (phase !== 'entering') return
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setPhase('open'))
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [phase])

  // 退场期的收场：过渡跑完（`transitionend`，且事件来自抽屉自己、属性是 transform）就卸载。
  // 另起一个兜底定时器，防两种收不到那个事件的情形——过渡被 `prefers-reduced-motion` 关掉
  // （没有过渡就没有结束事件）、或元素在过渡中途被浏览器判为不渲染。定时器时长 = 元素上
  // 真实的过渡时长（官方 token 算出来的值）+ 一小截余量，不写死。退场期里又打开时，这个
  // effect 先被清理、相位由上面那条改成 entering/open，退场期自然作废。
  useEffect(() => {
    if (phase !== 'leaving') return
    const drawer = drawerRef.current
    const finish = (): void => setPhase((prev) => (prev === 'leaving' ? 'closed' : prev))
    const onEnd = (event: TransitionEvent): void => {
      if (event.target === drawer && event.propertyName === 'transform') finish()
    }
    drawer?.addEventListener('transitionend', onEnd)
    const timer = setTimeout(finish, (drawer === null ? 0 : transitionMsOf(drawer)) + DRAWER_EXIT_SLACK_MS)
    return () => {
      drawer?.removeEventListener('transitionend', onEnd)
      clearTimeout(timer)
    }
  }, [phase])

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

  // Esc 收起：官方弹窗（归档确认那一层）自己处理 Esc（它会 preventDefault），让它先走。
  useEffect(() => {
    if (!open) return
    const onKey = (event: { key: string; defaultPrevented: boolean; preventDefault(): void }): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

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

  if (phase === 'closed') return null
  const total = recycleCount(groups)
  const height = dragHeight ?? snapHeight ?? DRAWER_HEIGHT_DEFAULT

  return h(
    'div',
    {
      className: `dshOneTree_drawer${phase === 'open' ? ' dshOneTree_drawerOpen' : ''}${phase === 'leaving' ? ' dshOneTree_drawerLeaving' : ''}`,
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
              onToggle: () => onToggleGroup(group.key),
              onOpen,
              onRestore,
              onArchive,
            }),
          ),
        ),
    error === null ? null : h('div', { className: 'dshOneTree_selectionError', role: 'alert' }, error),
  )
}

/** 抽屉里的一个工作区块：块头（箭头 + 名 + 计数）+ 成员行（行尾还原 / 永久归档两枚动作）。 */
function RecycleBlock({
  group,
  collapsed,
  now,
  tr,
  busy,
  onToggle,
  onOpen,
  onRestore,
  onArchive,
}: {
  group: RecycleGroup
  collapsed: boolean
  now: number
  tr: Translate
  busy: boolean
  onToggle: () => void
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
          // #144：行尾直接列出两枚动作（此前「还原」旁边挂一枚 ⋯、归档藏在二级菜单里）。
          // 两枚都 `stopPropagation`——点动作不能顺带打开会话（行自己的 onClick 是打开）。
          // 归档这一枚只发请求：树层据此开确认弹窗（终点动作，见文件头）。
          return h(
            'div',
            {
              className: 'dshOneTree_drawerRow',
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
                    className: 'dshOneTree_drawerAction',
                    disabled: busy,
                    'aria-label': tr('recycle.restore.aria', { name: title }),
                    'data-dshone-recycle-restore': node.id,
                    onClick: (event: { stopPropagation(): void }) => {
                      event.stopPropagation()
                      onRestore(node.id)
                    },
                  },
                  h(IconRefreshOutline16, {}),
                ),
              }),
              h(Tooltip, {
                label: tr('menu.archiveForever'),
                side: 'top',
                delayMs: 500,
                children: h(
                  'button',
                  {
                    type: 'button',
                    className: 'dshOneTree_drawerAction dshOneTree_drawerActionDanger',
                    disabled: busy,
                    'aria-label': tr('recycle.archive.aria', { name: title }),
                    'data-dshone-recycle-archive': node.id,
                    onClick: (event: { stopPropagation(): void }) => {
                      event.stopPropagation()
                      onArchive(node.id)
                    },
                  },
                  h(IconTrashOutline16, {}),
                ),
              }),
            ),
          )
        }),
  )
}
