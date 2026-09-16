/**
 * 底部回收站入口行（#99 B 段立的形态，#103 接上语义）：**在官方 `sidebar.footer.action`
 * 座位里**。
 *
 * ## 为什么在这里、长什么样
 * #98 的布局规范把回收站入口从顶栏挪到侧栏底部，座位用官方侧栏壳声明的
 * `sidebar.footer.action`（list 槽，owner share = `{ wide }`，与官方 ui-cordis 的
 * `cordis-panel` 那条**并存**——它同样是这个槽的注册者，谁也不顶掉谁）。形态按旧侧栏的
 * 那一行：🗑 + 文案 + 计数 + 右侧两枚动作图标；**计数 0 时整体灰态、两枚图标禁用**；
 * 点主区开抽屉。
 *
 * ## 计数从哪来（#103）
 * 本地回收站集合（宿主能力口键 `recycle-bin`）∩ 今天还认得出来的会话——见
 * `visibleRecycleIds`。抽屉里的行数用的是同一个函数，所以角标与拉开抽屉看到的永远一致。
 *
 * ## 两枚动作图标：清空 / 全部还原
 * 「清空」是**不可逆**的（= 把回收站里每一条都永久归档），所以它不在这里直接执行，而是
 * 把请求发给树主组件去开确认弹窗；「全部还原」是本地可逆动作，同样交给树主组件统一执行
 *（动作只有一个执行处，界面各处不会各写一套）。入口行只发请求。
 *
 * ## 抽屉怎么被这行打开（同一 bundle 内的模块级信号）
 * 抽屉与它的状态住在树主组件里（`sidebar.workspaces` 座位那条渲染），入口行在另一个
 * 座位（`sidebar.footer.action`）——两条 entry 属于**同一个插件、同一份 bundle**，
 * 于是用本模块里一个极小的订阅点（{@link recycleEntrySignal}）把请求传过去。
 * 不碰 DOM 查询、不新增槽位名、不跨插件借状态。
 */
import { createElement as h } from 'react'
import {
  IconArchiveOutline20,
  IconRefreshOutline16,
  IconTrashOutline16,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { visibleRecycleIds, type SessionListLike } from '../../../../pure/workspaceTreeView.ts'
import { useRecycleBin } from './recycleBinStore.ts'
import type { Translate } from './types.ts'

/** 入口行向树主组件发的请求。 */
export type RecycleRequest = 'open' | 'empty' | 'restoreAll'

const listeners = new Set<(request: RecycleRequest) => void>()

export const recycleEntrySignal = {
  /** 入口行发请求（开抽屉 / 清空 / 全部还原）。 */
  request(request: RecycleRequest): void {
    for (const listener of [...listeners]) listener(request)
  },
  /** 树主组件挂载时订阅（返回退订）。 */
  subscribe(listener: (request: RecycleRequest) => void): () => void {
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

/** 底部那行：主区（开抽屉）+ 两枚动作图标（清空 / 全部还原）。 */
export function RecycleEntry({ wide = true, t, useSessions, useWorkspaces }: RecycleEntryProps): unknown {
  const tr = t
  const list = useSessions((state) => state)
  const archivedSessionIds = useWorkspaces((state) => state.archivedSessionIds)
  // 本地回收站集合（#103 的两层语义第一层）+ 今天还认得出来的那些。
  const bin = useRecycleBin()
  const total = visibleRecycleIds(bin.ids, list, archivedSessionIds).length
  const action = (kind: 'empty' | 'restoreAll'): unknown => {
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
          // 计数 0（回收站空着）：两枚动作都禁用——没有东西可清、也没有东西可还原。
          disabled: total === 0,
          onClick: () => recycleEntrySignal.request(kind === 'empty' ? 'empty' : 'restoreAll'),
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
        onClick: () => recycleEntrySignal.request('open'),
      },
      h('span', { className: 'dshOneTree_footerIcon' }, h(IconArchiveOutline20, { size: 16 })),
      h('span', { className: 'dshOneTree_footerLabel' }, tr('recycle.open')),
      h('span', { className: 'dshOneTree_footerCount' }, String(total)),
    ),
    action('empty'),
    action('restoreAll'),
  )
}
