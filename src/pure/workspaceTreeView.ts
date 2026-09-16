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
  /**
   * 分组过滤（#81 功能 1）：只看这些工作区。缺省 = 全部。
   * 过滤生效时**未分组桶不出现在结果里**——散会话不属于任何工作区，也就无法归属
   * 任何分组，跟着一起收起才符合直觉（理由写在 treeGroups.workspaceMatchesGroup）。
   */
  readonly workspaceFilter?: (workspaceId: string) => boolean
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
    if (view.workspaceFilter !== undefined && !view.workspaceFilter(workspace.workspaceId)) continue
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
  if (stray.length > 0 && view.workspaceFilter === undefined) {
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

/**
 * 官方 `sessionStatuses`：主状态 + 全部无障碍标签（顺序即优先级）。
 *
 * `unread` 是**我们的**一项扩展（#102 手动未读）：官方没有手动未读，只有「跑完
 * 还没被打开」的完成提醒（`completed`）。规则与旧侧栏一行一致——手动未读在**空闲
 * 档**借官方 `done` 那颗绿点（旧侧栏就是复用「已完成」的绿点），标签换成「未读」；
 * 会话在跑或在等用户时，状态点让位给那两类（它们更该先说）。调用方要把未读并进
 * 第二参给 `showsStatusDot`（否则空闲档那颗点不渲染）。
 */
export function sessionStatuses(node: {
  running: boolean
  runningSubagentCount: number
  completed: boolean
  pendingInteraction?: string
  /** 会话在手动未读 id 集合里（缺省 = 没有，行为与官方一致）。 */
  unread?: boolean
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
  // 手动未读（我们的扩展，见函数头）：空闲档借官方 `done` 绿点，标签是「未读」。
  if (node.unread === true) return [{ state: 'done', labelKey: 'status.unread' }]
  return [{ state: 'done', labelKey: 'status.idle' }]
}

/**
 * 会话行是否需要渲染状态位（官方 `showStatus`）。
 *
 * 第二参官方给的是 `completed`（「跑完还没被打开」的绿点常显）；#102 起调用方要把
 * **手动未读**一并并进来（`completed || unread`）——两者共用官方 `done` 那颗绿点，
 * 空闲档没有这个并项就不会渲染。
 */
export function showsStatusDot(statuses: readonly SessionStatus[], completed: boolean): boolean {
  return statuses[0]?.state !== 'done' || completed
}

// ---------------------------------------------------------------------------
// #81 功能 2：工作区行尾的「运行中 / 等待交互」计数
//
// 两档的划分口径（互斥、相加 = 该工作区里正占着用户的会话数）：
// - **等待交互**：会话级 UI 正在等用户（approval / plan-review / question）——
//   就是行上会亮警示点的那三种（`visiblePendingKind`）。
// - **运行中**：会话在跑且**没有**在等用户。正在等用户批准的那条会话其实也
//   「在跑」，但它对用户的意义是「等你」，两处都数会让用户以为有两件事要处理。
// 计数覆盖的范围与树里看得见的会话**完全同源**（同一套 `sessionVisible`：
// 子代理不算、已归档不算、非当前选中的空白会话不算），否则行尾的数字会与展开
// 后看到的行数对不上。
// ---------------------------------------------------------------------------

/** 一个分组（工作区或未分组桶）的活状态计数。 */
export interface ActivityCounts {
  readonly running: number
  readonly waiting: number
}

/** 每个分组键的活状态计数（键与 `GroupNode.key` 同域：工作区 id / UNGROUPED_KEY）。 */
export function workspaceActivityCounts(
  list: SessionListLike,
  workspaces: readonly WorkspaceViewLike[],
  archivedSessionIds: readonly string[],
  pending: PendingInteractions,
): Map<string, ActivityCounts> {
  const archived = new Set(archivedSessionIds)
  const counts = new Map<string, { running: number; waiting: number }>()
  const bump = (key: string, running: boolean, waiting: boolean): void => {
    if (!running && !waiting) return
    const current = counts.get(key) ?? { running: 0, waiting: 0 }
    if (waiting) current.waiting += 1
    else current.running += 1
    counts.set(key, current)
  }
  const accounted = new Set<string>()
  for (const workspace of workspaces) {
    for (const id of workspace.sessionIds) {
      const summary = list.byId[id]
      if (summary === undefined) continue
      accounted.add(id)
      if (!sessionVisible(summary, list.current, archived)) continue
      const waiting = visiblePendingKind(pending.get(id)?.kind) !== undefined
      bump(workspace.workspaceId, summary.running, waiting)
    }
  }
  for (const id of list.ids) {
    const summary = list.byId[id]
    if (summary === undefined || accounted.has(id)) continue
    if (!sessionVisible(summary, list.current, archived)) continue
    const waiting = visiblePendingKind(pending.get(id)?.kind) !== undefined
    bump(UNGROUPED_KEY, summary.running, waiting)
  }
  return counts
}

// ---------------------------------------------------------------------------
// #81 功能 3/5：回收站（= 官方归档集合）按工作区组织
//
// 数据面是官方 `WorkspaceSnapshot.archivedSessionIds`（**不重复造**）：进回收站 =
// 官方 `uiWorkspace.archiveSession`，还原 = 官方 `uiWorkspace.unarchiveSession`
// （官方 navigation.d.ts 两条都在）。本模块只把那份 id 集合摊成抽屉要的形状：
// 按归属工作区分组、组内按最近更新倒序。
// 官方归档集合里可能有本项目已经不认识的 id（会话被删/日志清掉）：那种渲染不出
// 行，直接跳过，不占位。
// ---------------------------------------------------------------------------

/** 回收站抽屉里的一条会话。 */
export interface RecycleNode extends SessionNode {}

/** 回收站抽屉里的一个工作区块。 */
export interface RecycleGroup {
  /** 与树里的分组键同域（工作区 id / UNGROUPED_KEY）。 */
  readonly key: string
  readonly workspaceId?: string
  readonly label: string
  readonly sessions: readonly RecycleNode[]
}

/** 把官方归档集合摊成「按工作区组织」的抽屉数据（空工作区不出现在结果里）。 */
export function deriveRecycleGroups(
  list: SessionListLike,
  workspaces: readonly WorkspaceViewLike[],
  archivedSessionIds: readonly string[],
): RecycleGroup[] {
  const archived = new Set(archivedSessionIds)
  const descendants = indexSubagentDescendants(list.byId)
  const seen = new Set<string>()
  const byKey = new Map<string, SessionSummaryLike[]>()
  const push = (key: string, summary: SessionSummaryLike): void => {
    if (seen.has(summary.id)) return
    seen.add(summary.id)
    const bucket = byKey.get(key)
    if (bucket === undefined) byKey.set(key, [summary])
    else bucket.push(summary)
  }
  // 归属按官方工作区记账（`owningGroupKey`）判定，与树里的分组一致。
  for (const workspace of workspaces) {
    for (const id of workspace.sessionIds) {
      const summary = list.byId[id]
      if (summary === undefined || !archived.has(id)) continue
      if (summary.origin === 'subagent') continue
      push(workspace.workspaceId, summary)
    }
  }
  for (const id of list.ids) {
    const summary = list.byId[id]
    if (summary === undefined || !archived.has(id) || seen.has(id)) continue
    if (summary.origin === 'subagent') continue
    push(UNGROUPED_KEY, summary)
  }
  const groups: RecycleGroup[] = []
  for (const workspace of workspaces) {
    const members = byKey.get(workspace.workspaceId)
    if (members === undefined || members.length === 0) continue
    groups.push({
      key: workspace.workspaceId,
      workspaceId: workspace.workspaceId,
      label: workspace.title,
      sessions: orderByRecency(members.map((m) => m.id), list.byId).flatMap((id) => {
        const summary = list.byId[id]
        return summary === undefined ? [] : [sessionNode(summary, descendants, EMPTY_PENDING)]
      }),
    })
  }
  const stray = byKey.get(UNGROUPED_KEY)
  if (stray !== undefined && stray.length > 0) {
    groups.push({
      key: UNGROUPED_KEY,
      label: '',
      sessions: orderByRecency(stray.map((s) => s.id), list.byId).flatMap((id) => {
        const summary = list.byId[id]
        return summary === undefined ? [] : [sessionNode(summary, descendants, EMPTY_PENDING)]
      }),
    })
  }
  return groups
}

/** 回收站里的会话总数（抽屉入口的角标用）。 */
export function recycleCount(groups: readonly RecycleGroup[]): number {
  return groups.reduce((total, group) => total + group.sessions.length, 0)
}

const EMPTY_PENDING: PendingInteractions = new Map()
