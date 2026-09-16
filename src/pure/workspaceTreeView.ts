/**
 * 侧栏自有工作区树的数据推导（#65 批 2）——纯函数，只吃官方 sessions /
 * workspaces 服务的**快照值**，不做任何 IO。
 *
 * 语义逐条对齐官方 ui-workspace 的推导（0.1.6-alpha.1 的
 * `lib/types/client/tree.js` 与 `rows/Rows.js` 实测源码），因为外观要「看不出
 * 差别」的前提是分组、可见性、排序、状态点这些事实与官方同源：
 *
 * - `deriveGroups`：按工作区注册顺序出分组，成员取 `workspace.sessionIds`
 *   （官方的手动顺序）；未被任何工作区记账的会话落进「未分组」桶（按最近
 *   更新排序，官方在无浏览器本地顺序时同此）。
 * - 可见性 `sessionVisible`：子代理来源的会话不进树；已归档不进树；空白会话
 *   只在它就是当前选中那一行时进树（「新会话」占位）。
 * - `deriveFlat`：单列表模式的平铺，所有可见会话按最近更新倒序。
 * - `sessionStatuses`：状态点的一条主状态 + 若干无障碍标签，优先级 =
 *   等待用户（批准/计划待审/等待回答）> 运行中 > 子代理运行中 > 完成提醒 >
 *   空闲——与官方 `sessionStatuses` 完全一致。
 * - `indexSubagentDescendants`：官方同名的子代理后代计数（只用于状态文案与
 *   悬停卡，不影响可见行）。
 */
// ---------------------------------------------------------------------------
// 输入形态（结构化最小面：官方私包的精确类型不在本仓库，按用到的字段收窄）
// ---------------------------------------------------------------------------

export interface SessionSummaryLike {
  readonly id: string
  readonly displayTitle?: string
  readonly title?: string
  readonly parentId?: string
  /** 会话工作目录（复用空白会话时按它比工作区路径）。 */
  readonly cwd?: string
  /** 会话来源；`subagent` 的会话不进侧栏树。 */
  readonly origin?: string
  readonly running: boolean
  /** 「跑完但还没被打开」的绿色提醒点。 */
  readonly completed?: boolean
  /** 空白会话（新建但没发过消息）。 */
  readonly blank: boolean
  readonly updatedAt: number
  /** 官方宿主投影值；`schedule` 有内容时行上带定时任务标记。 */
  readonly projectionValues?: { readonly schedule?: readonly unknown[] }
}

export interface SessionListLike {
  readonly ids: readonly string[]
  readonly byId: Readonly<Record<string, SessionSummaryLike>>
  readonly current?: string
}

export interface WorkspaceViewLike {
  readonly workspaceId: string
  readonly path: string
  readonly title: string
  readonly sessionIds: readonly string[]
  readonly createdAt: string
}

/** 会话级 UI 消费者正在等用户（官方 ui-session 的 kind 联合收窄）。 */
export interface PendingInteractionLike {
  readonly kind?: string
}

export type PendingInteractions = ReadonlyMap<string, PendingInteractionLike>

/** 状态点的三档（官方 StateDot 的 state 取值）。 */
export type SessionStatusState = 'ongoing' | 'warning' | 'done'

/** 一条状态：主状态点 + 无障碍/悬停文案的 i18n key（与官方 workspace 词典同键名）。 */
export interface SessionStatus {
  readonly state: SessionStatusState
  readonly labelKey: string
  readonly labelCount?: number
}

/** 会话行节点。 */
export interface SessionNode {
  readonly id: string
  /** 显示标题；空白会话为空串，渲染时替换成「新会话」。 */
  readonly title: string
  readonly blank: boolean
  readonly running: boolean
  readonly runningSubagentCount: number
  readonly completed: boolean
  readonly hasActiveSchedule: boolean
  readonly updatedAt: number
  readonly pendingInteraction?: string
}

/** 工作区分组节点。 */
export interface GroupNode {
  /** 分组键：工作区 id，或未分组桶的空串。 */
  readonly key: string
  /** 未分组桶没有工作区 id。 */
  readonly workspaceId?: string
  readonly cwd?: string
  /** 工作区创建时刻（epoch ms）；未分组桶没有。 */
  readonly createdAt?: number
  readonly label: string
  readonly sessionCount: number
  readonly containsCurrent: boolean
  readonly sessions: readonly SessionNode[]
}

/** 树视图状态（展开集合由渲染层持有）。 */
export interface TreeViewLike {
  readonly expandedGroups: readonly string[]
}

/** 分组键：未分组桶。 */
export const UNGROUPED_KEY = ''

// ---------------------------------------------------------------------------
// 推导
// ---------------------------------------------------------------------------

/** 官方 `indexSubagentDescendants`：把连续的子代理血缘后代记到每个祖先下。 */
export function indexSubagentDescendants(
  byId: Readonly<Record<string, SessionSummaryLike>>,
): ReadonlyMap<string, { count: number; runningCount: number }> {
  const indexed = new Map<string, { count: number; runningCount: number }>()
  for (const descendant of Object.values(byId)) {
    if (descendant.origin !== 'subagent') continue
    const seen = new Set<string>()
    let current: SessionSummaryLike | undefined = descendant
    while (current?.origin === 'subagent' && current.parentId !== undefined && !seen.has(current.id)) {
      seen.add(current.id)
      const aggregate = indexed.get(current.parentId)
      if (aggregate === undefined) {
        indexed.set(current.parentId, { count: 1, runningCount: descendant.running ? 1 : 0 })
      } else {
        aggregate.count += 1
        if (descendant.running) aggregate.runningCount += 1
      }
      current = byId[current.parentId]
    }
  }
  return indexed
}

/** 官方 `owningGroupKey`：会话被哪个工作区记账；没有则未分组桶。 */
export function owningGroupKey(workspaces: readonly WorkspaceViewLike[], sessionId: string): string {
  return workspaces.find((workspace) => workspace.sessionIds.includes(sessionId))?.workspaceId ?? UNGROUPED_KEY
}

/** 官方 `sessionVisible`：子代理/归档不进树；空白会话只在它就是当前选中时进树。 */
export function sessionVisible(
  session: SessionSummaryLike,
  current: string | undefined,
  archived: ReadonlySet<string>,
): boolean {
  return session.origin !== 'subagent' && !archived.has(session.id) && (!session.blank || session.id === current)
}

/** 官方 `sessionTitle`：空白会话标题为空串（渲染层替换成「新会话」）。 */
function sessionTitle(session: SessionSummaryLike): string {
  if (session.blank) return ''
  return session.displayTitle ?? session.title ?? session.id
}

/** 官方 `visiblePendingKind`：只认三种会改变行呈现的等待态。 */
function visiblePendingKind(kind: string | undefined): string | undefined {
  return kind === 'approval' || kind === 'plan-review' || kind === 'question' ? kind : undefined
}

/** 官方 `hasActiveSchedule`：宿主投影里还有活动定时任务。 */
function hasActiveSchedule(session: SessionSummaryLike): boolean {
  return (session.projectionValues?.schedule?.length ?? 0) > 0
}

/** 官方 `sessionNode`。 */
function sessionNode(
  session: SessionSummaryLike,
  descendants: ReadonlyMap<string, { count: number; runningCount: number }>,
  pending: PendingInteractions,
): SessionNode {
  const pendingInteraction = visiblePendingKind(pending.get(session.id)?.kind)
  return {
    id: session.id,
    title: sessionTitle(session),
    blank: session.blank,
    running: session.running,
    runningSubagentCount: descendants.get(session.id)?.runningCount ?? 0,
    completed: session.completed === true,
    hasActiveSchedule: hasActiveSchedule(session),
    updatedAt: session.updatedAt,
    ...(pendingInteraction === undefined ? {} : { pendingInteraction }),
  }
}

/** 官方 `orderByRecency`：最近更新倒序，同一时刻按 id 稳定排序。 */
function orderByRecency(ids: readonly string[], byId: Readonly<Record<string, SessionSummaryLike>>): string[] {
  return ids
    .flatMap((id) => {
      const summary = byId[id]
      return summary === undefined ? [] : [{ id, updatedAt: summary.updatedAt }]
    })
    .sort((a, b) => (a.updatedAt !== b.updatedAt ? b.updatedAt - a.updatedAt : a.id < b.id ? -1 : 1))
    .map((member) => member.id)
}

/**
 * 官方 `deriveGroups`：工作区分组（含未分组桶）。展开的分组才带成员行，
 * 未展开的只带计数——与官方一致（卡片/悬停信息不因折叠而消失）。
 */
export function deriveGroups(
  list: SessionListLike,
  workspaces: readonly WorkspaceViewLike[],
  archivedSessionIds: readonly string[],
  pending: PendingInteractions,
  view: TreeViewLike,
): GroupNode[] {
  const archived = new Set(archivedSessionIds)
  const expanded = new Set(view.expandedGroups)
  const descendants = indexSubagentDescendants(list.byId)
  const currentGroup = list.current === undefined ? undefined : owningGroupKey(workspaces, list.current)
  const groups: GroupNode[] = []
  const accounted = new Set<string>()
  for (const workspace of workspaces) {
    const members: SessionSummaryLike[] = []
    for (const id of workspace.sessionIds) {
      const summary = list.byId[id]
      if (summary === undefined) continue
      accounted.add(id)
      if (!sessionVisible(summary, list.current, archived)) continue
      members.push(summary)
    }
    const createdAt = Date.parse(workspace.createdAt)
    groups.push({
      key: workspace.workspaceId,
      workspaceId: workspace.workspaceId,
      cwd: workspace.path,
      createdAt: Number.isNaN(createdAt) ? undefined : createdAt,
      label: workspace.title,
      sessionCount: members.length,
      containsCurrent: workspace.workspaceId === currentGroup,
      sessions: expanded.has(workspace.workspaceId) ? members.map((m) => sessionNode(m, descendants, pending)) : [],
    })
  }
  const stray = list.ids
    .map((id) => list.byId[id])
    .filter((s): s is SessionSummaryLike => s !== undefined && !accounted.has(s.id) && sessionVisible(s, list.current, archived))
  if (stray.length > 0) {
    const strayIds = new Set(stray.map((s) => s.id))
    const ordered = orderByRecency(
      stray.map((s) => s.id),
      list.byId,
    ).filter((id) => strayIds.has(id))
    groups.push({
      key: UNGROUPED_KEY,
      label: '',
      sessionCount: ordered.length,
      containsCurrent: currentGroup === UNGROUPED_KEY && list.current !== undefined,
      sessions: expanded.has(UNGROUPED_KEY)
        ? ordered.flatMap((id) => {
            const summary = list.byId[id]
            return summary === undefined ? [] : [sessionNode(summary, descendants, pending)]
          })
        : [],
    })
  }
  return groups
}

/** 官方 `deriveFlat`：单列表模式——所有可见会话按最近更新倒序。 */
export function deriveFlat(
  list: SessionListLike,
  archivedSessionIds: readonly string[],
  pending: PendingInteractions,
): SessionNode[] {
  const archived = new Set(archivedSessionIds)
  const descendants = indexSubagentDescendants(list.byId)
  const visible = list.ids
    .map((id) => list.byId[id])
    .filter((s): s is SessionSummaryLike => s !== undefined && sessionVisible(s, list.current, archived))
  return orderByRecency(
    visible.map((s) => s.id),
    list.byId,
  ).flatMap((id) => {
    const summary = list.byId[id]
    return summary === undefined ? [] : [sessionNode(summary, descendants, pending)]
  })
}

/** 官方 `sessionStatuses`：主状态 + 全部无障碍标签（顺序即优先级）。 */
export function sessionStatuses(node: {
  running: boolean
  runningSubagentCount: number
  completed: boolean
  pendingInteraction?: string
}): SessionStatus[] {
  const subagents: SessionStatus | undefined =
    node.runningSubagentCount === 0
      ? undefined
      : {
          state: 'ongoing',
          labelCount: node.runningSubagentCount,
          labelKey: node.runningSubagentCount === 1 ? 'status.subagentsRunning.one' : 'status.subagentsRunning.other',
        }
  let pending: SessionStatus | undefined
  switch (node.pendingInteraction) {
    case 'approval':
      pending = { state: 'warning', labelKey: 'status.waitingApproval' }
      break
    case 'plan-review':
      pending = { state: 'warning', labelKey: 'status.planReview' }
      break
    case 'question':
      pending = { state: 'warning', labelKey: 'status.waitingAnswer' }
      break
    default:
      break
  }
  if (pending !== undefined) return subagents === undefined ? [pending] : [pending, subagents]
  if (node.running) {
    const primary: SessionStatus = { state: 'ongoing', labelKey: 'status.running' }
    return subagents === undefined ? [primary] : [primary, subagents]
  }
  if (subagents !== undefined) return [subagents]
  if (node.completed) return [{ state: 'done', labelKey: 'status.completed' }]
  return [{ state: 'done', labelKey: 'status.idle' }]
}

/** 会话行是否需要渲染状态位（官方 `showStatus`）。 */
export function showsStatusDot(statuses: readonly SessionStatus[], completed: boolean): boolean {
  return statuses[0]?.state !== 'done' || completed
}
