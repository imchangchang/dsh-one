/**
 * 底部回收站入口行（#99 B 段）：**搬进官方 `sidebar.footer.action` 座位**。
 *
 * ## 为什么在这里、长什么样
 * #98 的布局规范把回收站入口从顶栏挪到侧栏底部，座位用官方侧栏壳声明的
 * `sidebar.footer.action`（list 槽，owner share = `{ wide }`，与官方 ui-cordis 的
 * `cordis-panel` 那条**并存**——它同样是这个槽的注册者，谁也不顶掉谁）。形态按旧侧栏的
 * 那一行：🗑 + 文案 + 计数 + 右侧两枚动作图标，计数 0 时整体灰态；点主区开抽屉。
 *
 * ## 两枚动作图标为什么是「不可用」
 * 「清空」与「恢复全部」的语义属回收站两层语义（#98 的 H1：清空 = 永久归档、全部
 * 还原、都要确认弹窗），本条（#99）明确不碰那层语义，只把入口行的**形态**立起来、
 * 保证点得开现有抽屉。所以两枚图标渲染为不可用（`disabled` + 说明性 title），
 * 免得给出一个与最终语义不符的动作；H1 条目接手时把它们接上真实动作即可。
 *
 * ## 抽屉怎么被这行打开（同一 bundle 内的模块级订阅）
 * 抽屉与它的状态住在树主组件里（`sidebar.workspaces` 座位那条渲染），入口行在另一个
 * 座位（`sidebar.footer.action`）——两条 entry 属于**同一个插件、同一份 bundle**，
 * 于是用本模块里一个极小的订阅点（{@link recycleEntrySignal}）把「请求开抽屉」传过去：
 * 入口行发信号，树主组件收到就开抽屉。不碰 DOM 查询、不新增槽位名、不跨插件借状态。
 */
import { createElement as h } from 'react'
import {
  IconArchiveOutline20,
  IconRefreshOutline16,
  IconTrashOutline16,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  deriveRecycleGroups,
  recycleCount,
  type SessionListLike,
} from '../../../../pure/workspaceTreeView.ts'
import type { Translate } from './types.ts'

/**
 * 「请求打开回收站抽屉」的模块级信号（同一插件 bundle 内共享，见文件头）。
 * 树主组件订阅它；入口行触发它。信号只表达「请求」，抽屉由树主组件自己开关。
 */
const listeners = new Set<() => void>()

export const recycleEntrySignal = {
  /** 入口行点了主区：请求开抽屉。 */
  requestOpen(): void {
    for (const listener of [...listeners]) listener()
  },
  /** 树主组件挂载时订阅（返回退订）。 */
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}

/** 官方全局钩子的最小面（框架给每条 entry 的标准座位）。 */
interface RecycleEntryProps {
  /** 官方侧栏壳给的形态（宽行 / 收起轨）；本件两态都渲染，轨态收成图标一行。 */
  wide?: boolean
  t: Translate
  useSessions: <R>(selector: (state: SessionListLike) => R) => R
  useWorkspaces: <R>(
    selector: (state: {
      readonly items: readonly {
        readonly workspaceId: string
        readonly path: string
        readonly title: string
        readonly sessionIds: readonly string[]
        readonly createdAt: string
      }[]
      readonly archivedSessionIds: readonly string[]
    }) => R,
  ) => R
}

/** 底部那行：主区（开抽屉）+ 两枚动作图标（形态占位，见文件头）。 */
export function RecycleEntry({ wide = true, t, useSessions, useWorkspaces }: RecycleEntryProps): unknown {
  const tr = t
  const list = useSessions((state) => state)
  const workspaces = useWorkspaces((state) => state.items)
  const archivedSessionIds = useWorkspaces((state) => state.archivedSessionIds)
  const total = recycleCount(deriveRecycleGroups(list, workspaces, archivedSessionIds))
  const action = (kind: 'empty' | 'restore'): unknown => {
    const label = kind === 'empty' ? tr('recycle.emptyAll') : tr('recycle.restoreAll')
    return h(Tooltip, {
      label,
      side: 'top',
      delayMs: 500,
      children: h(
        'button',
        {
          type: 'button',
          className: `dshOneTree_footerIconButton${kind === 'empty' ? ' dshOneTree_footerIconDanger' : ''}`,
          'aria-label': label,
          'data-dshone-tree-action': kind === 'empty' ? 'recycle-empty-all' : 'recycle-restore-all',
          // 形态占位：动作语义属 #98 的 H1（回收站两层语义），本条只立入口行。
          disabled: true,
        },
        kind === 'empty' ? h(IconTrashOutline16, { size: 14 }) : h(IconRefreshOutline16, { size: 14 }),
      ),
    })
  }
  return h(
    'div',
    {
      className: `dshOneTree_footerRow${total === 0 ? ' dshOneTree_footerRowEmpty' : ''}`,
      'data-dshone-tree': 'recycle-entry',
      'data-dshone-tree-recycle-count': total,
      'data-rail': wide ? undefined : '',
    },
    h(
      'button',
      {
        type: 'button',
        className: 'dshOneTree_footerMain',
        'aria-label': `${tr('recycle.open')} (${String(total)})`,
        'data-dshone-tree-action': 'recycle-open',
        'data-dshone-tree-recycle-count': total,
        onClick: () => recycleEntrySignal.requestOpen(),
      },
      h('span', { className: 'dshOneTree_footerIcon' }, h(IconArchiveOutline20, { size: 16 })),
      h('span', { className: 'dshOneTree_footerLabel' }, tr('recycle.open')),
      h('span', { className: 'dshOneTree_footerCount' }, String(total)),
    ),
    action('empty'),
    action('restore'),
  )
}
