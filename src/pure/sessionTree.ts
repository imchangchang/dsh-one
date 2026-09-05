/**
 * Pure model for the Sessions tree view: grouping, filtering, ordering and
 * labels. No `vscode` import — unit-testable with node --test.
 *
 * 注意：本文件也进聊天 webview 的浏览器 bundle（esbuild browser 平台），
 * 不能用 node: 内置模块——basename 语义用下面的 basenameOf 手写。
 */

import type { PendingInteraction, SubagentNode } from './chatContract.ts'

/** 末段路径名（同时认 '/' 和 '\\'，先剥尾部分隔符）；空路径/根路径返回 ''。 */
function basenameOf(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
}

export interface WorkspaceInput {
  workspaceId: string
  path: string
  title: string
  sessionIds: string[]
  /** ISO-8601 last-mutation instant. */
  updatedAt: string
}

export interface SessionInput {
  sessionId: string
  /** Epoch milliseconds. */
  updatedAt: number
  running: boolean
  blank: boolean
  /** Parent session for lineage/fork sessions (session.list). */
  parentSessionId?: string
  /**
   * Host-assigned origin marker：'subagent' 表示真子代理（spawn 时写入）。
   * 普通 fork 会话只写 parentSessionId、无此标记——血缘/子代理判定用
   * origin === 'subagent' 区分两者。
   */
  origin?: string
  /** Sum of the tokenUsage projection's buckets, when the host reports one. */
  totalTokens?: number
  /**
   * Closed-turn count from the `sessionStats` projection (session.list), when
   * the host reports a completed turn. Absent means no completed turn yet.
   * Feeds the fork menu's disabled state.
   */
  sessionStatsTurns?: number
  /** Title projection resolved at fetch time (null when untitled). */
  title?: string | null
  /**
   * Host-assigned composition（session.list 行的 agentPreset——dsh 0.1.2 起在
   * projections.values.agentPreset，由 sessionAgentPreset 窄化读入；创建时即定，
   * 未设置过的会话没有）。显示树不用它，rawList 消费方（聊天头部 preset 标签）用。
   */
  agentPreset?: string
  /** Session cwd（session.list 基线），聊天链接相对路径的解析基准。 */
  cwd?: string
}

export interface SessionNodeModel {
  sessionId: string
  label: string
  /** Relative time string, e.g. "3 小时前". */
  description: string
  running: boolean
  /** Client-side pin (dsh has no pin API); pinned sessions carry absolute priority. */
  pinned: boolean
  /**
   * Whether the session has at least one completed turn (sessionStats
   * projection). The list fork action gates on this: a session with no
   * completed turn has no `turn/end` boundary, so the server rejects a fork.
   */
  hasCompletedTurn: boolean
  /** Client-side unread marker (dsh has no unread API); display-only, no sort effect. */
  unread: boolean
  /**
   * 有运行中的血缘后代（子代理）——host 的 running 只管 agent 自身相位，
   * 父会话挂载等待子代理时是 idle；展示层用这个补忙碌指示（像素环）。
   */
  descendantRunning: boolean
  /**
   * 有待用户处理的交互（approval/question/plan-review）——mux 全局帧跟踪
   * 的活跃事实，行首黄色标记，展示优先级高于忙碌与未读（官方语义：
   * pending interaction is primary）。
   */
  pendingInteraction?: PendingInteraction
  /**
   * 内容命中的最佳匹配片段（session.search 返回，≤240 码点；纯层只透传，
   * 不负责高亮）。内容命中即作为 query 过滤的保留条件之一（不必标题/ID 命中）。
   */
  contentSnippet?: string
}

export interface WorkspaceNodeModel {
  workspaceId: string
  path: string
  label: string
  isCurrent: boolean
  sessions: SessionNodeModel[]
}

/** Sort orders offered by the Sessions view title menu. */
export type SessionSortOrder = 'updatedDesc' | 'updatedAsc' | 'title'

/**
 * Sentinel workspaceId of the synthetic「未分组」group: sessions no
 * registered workspace references (dsh CLI in unregistered dirs, direct-API
 * sessions, leftovers of removed workspaces). Collapse state persists under
 * this key like any real workspace id.
 */
export const UNGROUPED_WORKSPACE_ID = '__ungrouped__'

export interface SessionTreeViewOptions {
  /** Session ordering within each workspace; workspaces themselves are unaffected. */
  sort?: SessionSortOrder
  /** Case-insensitive substring matched against the session label and id. */
  query?: string
  /**
   * Client-side pinned ids, in pin-time order (absolute priority). Pinned
   * sessions sort before any unpinned within a workspace; among pinned members
   * this array's order is authoritative and does NOT track updatedAt/title —
   * re-pinning (unshift, 取消后再置顶) moves a session to the group's front.
   */
  pinned?: readonly string[]
  /** Client-side unread ids; purely a display flag (bold title + dot). */
  unread?: ReadonlySet<string>
  /**
   * Workspace-path equality for the vscode badge (isCurrent). Default is
   * strict equality; on Windows callers pass a normalizing comparator
   * (case + separator folding) because vscode.workspace fsPath and the dsh
   * server's path often differ in drive-letter case / slash style.
   */
  pathEqual?: (a: string, b: string) => boolean
  /** Mux-tracked pending interaction per session; display-only yellow dot. */
  pendingInteractions?: ReadonlyMap<string, PendingInteraction>
  /**
   * 会话内容全文搜索命中（session.search）：sessionId → 最佳匹配片段。query
   * 过滤时除标题/ID 命中外，内容命中（此处有项）的会话也保留，snippet 随
   * 节点透传。纯层只用于过滤与透传，不做高亮。
   */
  contentHits?: ReadonlyMap<string, string>
  /**
   * 主列表排除这些 id（已在回收站的会话不出现在正常列表；dsh 侧无「已删除/
   * 已回收」区分，纯粹是本地 UI 过滤）。与只保留过滤互斥，两个都传时
   * excludedSessionIds 优先（排除后不再被 only 拉回）。
   */
  excludedSessionIds?: ReadonlySet<string>
  /**
   * 只保留这些 id（回收站视图用：按原 workspace 分组展示回收站会话）。与原
   * workspace 已软删的会话同现有 orphan 逻辑——自动归「未分组」。
   */
  onlySessionIds?: ReadonlySet<string>
}

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** Minimal l10n callback shared by pure label functions (host passes `vscode.l10n.t`, webview its injected `t`). */
export type L10nFn = (template: string, ...args: Array<string | number>) => string

/** Escape-hatch default: return the template (English keys are the default strings). */
export function enFallback(template: string, ...args: Array<string | number>): string {
  return template.replace(/\{(\d+)\}/g, (_m, i: string) => String(args[Number(i)] ?? ''))
}

/** "just now / N minutes ago / N hours ago / N days ago" relative to `now` (epoch ms). */
export function formatRelativeTime(updatedAt: number, now: number, t: L10nFn = enFallback): string {
  const diff = Math.max(0, now - updatedAt)
  if (diff < MINUTE_MS) return t('just now')
  if (diff < HOUR_MS) return t('{0} minutes ago', Math.floor(diff / MINUTE_MS))
  if (diff < DAY_MS) return t('{0} hours ago', Math.floor(diff / HOUR_MS))
  return t('{0} days ago', Math.floor(diff / DAY_MS))
}

/**
 * Build the ordered tree model. Blank sessions (unstarted conversations the
 * client reuses for "new session") and archived ones are hidden. The
 * workspace matching `currentFolder` comes first (flagged isCurrent); the
 * rest follow their updatedAt descending. Sessions within a workspace put
 * workspace put `view.pinned` ids first (absolute priority); pinned members
 * hold the order of `view.pinned` (置顶顺序，不随 updatedAt/title 调整), the
 * remaining unpinned ones follow `view.sort` (default updatedAt descending). A
 * non-empty `view.query`
 * keeps only sessions whose label or id contains it (case-insensitive) and
 * drops workspaces left without a match. Sessions not referenced by any
 * workspace's sessionIds form a synthetic「未分组」group (UNGROUPED_WORKSPACE_ID,
 * empty path) appended last — same as dsh web's ungrouped section. The
 *「未分组」group always renders (its sessions may be empty): the panel relies
 * on its header row as the "new ungrouped conversation" entry point. Under a
 * non-empty query the final empty-group filter drops it like any other group.
 * Lineage subagents (origin === 'subagent') never appear as rows; they only
 * feed the parent's descendantRunning busy flag. Plain forks (parentSessionId
 * set, no origin) are normal sessions and do appear as rows.
 */
export function buildSessionTree(
  workspaces: WorkspaceInput[],
  sessions: SessionInput[],
  archivedSessionIds: ReadonlySet<string>,
  titleOf: (s: SessionInput) => string | null,
  currentFolder?: string,
  now: number = Date.now(),
  view: SessionTreeViewOptions = {},
  t: L10nFn = enFallback,
): WorkspaceNodeModel[] {
  const byId = new Map(sessions.map((s) => [s.sessionId, s]))
  const query = view.query?.trim().toLowerCase() ?? ''
  const sort = view.sort ?? 'updatedDesc'
  const pathEqual = view.pathEqual ?? ((a: string, b: string): boolean => a === b)
  const isCurrentFolder = (path: string): boolean => currentFolder !== undefined && pathEqual(path, currentFolder)
  // 回收站过滤：主列表排除回收站会话；回收站视图只保留回收站会话。排除优先。
  const excluded = view.excludedSessionIds
  const only = view.onlySessionIds
  const inListScope = (s: SessionInput): boolean =>
    (excluded ? !excluded.has(s.sessionId) : true) && (only ? only.has(s.sessionId) : true)

  // 血缘：只有真子代理（origin === 'subagent'）挂在父会话下。子代理行不进
  // 任何组（workspace 不引用它们，也未分组组也不收——见下方 orphans 过滤），
  // 只在这里贡献「有运行中后代」的忙碌判定。普通 fork 会话虽有 parentSessionId
  // 但没有 origin，按普通会话处理（出现在列表，不把 running 传给父会话）。
  const childrenOf = new Map<string, SessionInput[]>()
  for (const s of sessions) {
    if (s.origin !== 'subagent' || !s.parentSessionId) continue
    const kids = childrenOf.get(s.parentSessionId) ?? []
    kids.push(s)
    childrenOf.set(s.parentSessionId, kids)
  }
  const hasRunningDescendant = (sessionId: string, seen: ReadonlySet<string> = new Set()): boolean => {
    if (seen.has(sessionId)) return false
    const nextSeen = new Set(seen).add(sessionId)
    return (childrenOf.get(sessionId) ?? []).some(
      (k) => k.running || hasRunningDescendant(k.sessionId, nextSeen),
    )
  }

  // 置顶顺序索引：sessionId → 在 view.pinned（数组）里的位置，越靠前置顶越前。
  // 置顶组内按此固定，不再比较 sort 键（updatedAt/title 只作用于非置顶成员）。
  const pinnedIndex = new Map<string, number>()
  view.pinned?.forEach((id, i) => {
    if (!pinnedIndex.has(id)) pinnedIndex.set(id, i)
  })

  // 会话行流水线：label 解析（query 匹配和 title 排序都要用，先算一次）→
  // 查询过滤（标题/ID 命中 或 内容命中）→ 置顶绝对优先（组内按置顶顺序）+
  // 非置顶成员按 view.sort。workspace 组与「未分组」组共用。
  const toSessionNodes = (list: SessionInput[]): SessionNodeModel[] =>
    list
      .map((s) => ({ session: s, label: titleOf(s) ?? t('Session {0}', s.sessionId.slice(0, 8)) }))
      .filter(
        ({ session, label }) =>
          query === '' ||
          label.toLowerCase().includes(query) ||
          session.sessionId.toLowerCase().includes(query) ||
          view.contentHits?.has(session.sessionId) === true,
      )
      .sort((a, b) => {
        const aPinned = pinnedIndex.has(a.session.sessionId)
        const bPinned = pinnedIndex.has(b.session.sessionId)
        if (aPinned !== bPinned) return aPinned ? -1 : 1
        // 置顶组内按置顶顺序固定；非置顶成员照常按 sort 键比较。
        if (aPinned) {
          return (pinnedIndex.get(a.session.sessionId) ?? 0) - (pinnedIndex.get(b.session.sessionId) ?? 0)
        }
        if (sort === 'updatedAsc') return a.session.updatedAt - b.session.updatedAt
        if (sort === 'title') return a.label.localeCompare(b.label)
        return b.session.updatedAt - a.session.updatedAt
      })
      .map(({ session, label }) => {
        const pendingInteraction = view.pendingInteractions?.get(session.sessionId)
        const snippet = view.contentHits?.get(session.sessionId)
        return {
          sessionId: session.sessionId,
          label,
          description: formatRelativeTime(session.updatedAt, now, t),
          running: session.running,
          pinned: pinnedIndex.has(session.sessionId),
          hasCompletedTurn: (session.sessionStatsTurns ?? 0) > 0,
          unread: view.unread?.has(session.sessionId) === true,
          descendantRunning: hasRunningDescendant(session.sessionId),
          ...(pendingInteraction !== undefined ? { pendingInteraction } : {}),
          ...(snippet !== undefined ? { contentSnippet: snippet } : {}),
        }
      })

  const ordered = [...workspaces].sort((a, b) => {
    const aCurrent = isCurrentFolder(a.path)
    const bCurrent = isCurrentFolder(b.path)
    if (aCurrent !== bCurrent) return aCurrent ? -1 : 1
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
  })

  const nodes = ordered.map((w) => {
    const visible = w.sessionIds
      .map((id) => byId.get(id))
      .filter((s): s is SessionInput => !!s && !s.blank && !archivedSessionIds.has(s.sessionId) && inListScope(s))
    return {
      workspaceId: w.workspaceId,
      path: w.path,
      // 空 title 兜底（防御：dsh 侧 title 正常是 basename(path)，渲染层
      // 不赌它非空）；basename 为空（如根路径）时退回完整 path。
      label: w.title || basenameOf(w.path) || w.path,
      isCurrent: isCurrentFolder(w.path),
      sessions: toSessionNodes(visible),
    }
  })

  // 未被任何 workspace 引用的会话：合成「未分组」虚拟组排在最后。该组
  // 恒渲染（无会话时也保留空组头）——面板靠它的行头按钮提供「新建未分组
  // 对话」入口；非空 query 下由末尾的空组过滤丢弃。真子代理
  // （origin === 'subagent'）不算未分组——它们属于父会话，只参与忙碌聚合，
  // 不在面板单列；普通 fork 会话是独立会话，无归属时进未分组。
  const referenced = new Set(workspaces.flatMap((w) => w.sessionIds))
  const orphans = sessions.filter(
    (s) =>
      !referenced.has(s.sessionId) &&
      s.origin !== 'subagent' &&
      !s.blank &&
      !archivedSessionIds.has(s.sessionId) &&
      inListScope(s),
  )
  nodes.push({
    workspaceId: UNGROUPED_WORKSPACE_ID,
    path: '',
    label: t('Ungrouped'),
    isCurrent: false,
    sessions: toSessionNodes(orphans),
  })

  // Under an active query, a workspace with no matching session is noise.
  return query === '' ? nodes : nodes.filter((w) => w.sessions.length > 0)
}

/** parentSessionId → 该会话下所有 origin === 'subagent' 的子代理（血缘树共用）。 */
function subagentChildrenOf(sessions: readonly SessionInput[]): Map<string, SessionInput[]> {
  const childrenOf = new Map<string, SessionInput[]>()
  for (const s of sessions) {
    // 只有真子代理（origin === 'subagent'）进血缘树/目录；普通 fork 不计入。
    if (s.origin !== 'subagent' || !s.parentSessionId) continue
    const kids = childrenOf.get(s.parentSessionId) ?? []
    kids.push(s)
    childrenOf.set(s.parentSessionId, kids)
  }
  return childrenOf
}

/**
 * 需要拉取 subagent.list 目录的「父会话」集合，使 `rootId` 的子代理子树能
 * 完整取到每个节点的 descriptor label：每个至少有真子代理子节点、且在
 * rootId 子树内的节点（含 rootId 自身，当它有子代理子节点时）。叶子子代理
 * 不是任何子代理的父，不需要自己的目录——它的 label 在它父会话的目录里。
 * 这是 eager 一次性拉深层的简化（对齐官方按展开懒加载，见实现说明）。
 */
export function subagentCatalogRoots(sessions: readonly SessionInput[], rootId: string): Set<string> {
  const childrenOf = subagentChildrenOf(sessions)
  const roots = new Set<string>()
  const queue = [rootId]
  while (queue.length > 0) {
    const parent = queue.shift()!
    const kids = childrenOf.get(parent) ?? []
    if (kids.length === 0) continue
    roots.add(parent)
    for (const kid of kids) {
      if (childrenOf.has(kid.sessionId)) queue.push(kid.sessionId)
    }
  }
  return roots
}

/**
 * rootId 子代理子树的确定性签名：入树的每个「父会话」一行 `父id:排好序的子id列表`。
 * session.list 基线变化（新子代理 spawn / 子树重排）会使签名变化，用来判定
 * 已缓存的 subagent.list 目录是否失效——签名不变就说明子树没变，目录里的
 * label 仍然有效。这避免了 60s 相对时间 tick 对目录反复重拉。带回环保护。
 */
export function subagentTreeSignature(sessions: readonly SessionInput[], rootId: string): string {
  const childrenOf = subagentChildrenOf(sessions)
  const parts: string[] = []
  const visit = (parent: string, seen: ReadonlySet<string>): void => {
    if (seen.has(parent)) return
    const nextSeen = new Set(seen).add(parent)
    const kids = childrenOf.get(parent) ?? []
    if (kids.length === 0) return
    parts.push(`${parent}:${kids.map((k) => k.sessionId).sort().join(',')}`)
    for (const kid of kids) visit(kid.sessionId, nextSeen)
  }
  visit(rootId, new Set())
  return parts.join('|')
}

/**
 * 组装头部「N 个子代理」chip 下拉的血缘树：`rootId` 的直接子代理为顶层项，
 * 每项的 `children` 递归挂它们各自的后代（子代理再开子代理）。每一层按
 * 运行中优先 + 新近优先 排序。带回环保护：血缘链断/环时靠 `seen` 截断，
 * 避免无限递归。只有 origin === 'subagent' 的会话算子代理，普通 fork
 * 不入树（chip 计数与下拉行都不含它）。`children` 为空时缺省。
 *
 * 行显示名 = `labelOf(s)`（descriptor label，来自 subagent.list 目录，label
 * 缺失时退回 entry.id）→ 会话 title（异步自动命名/用户重命名）→ 「会话 xxxxxxxx」。
 * `labelOf` 缺省或返回 null（目录没拉到 / 该会话不在目录里）时回退既有的
 * title/id 逻辑，不降级。
 */
export function buildSubagentTree(
  sessions: readonly SessionInput[],
  rootId: string,
  labelOf?: (s: SessionInput) => string | null,
  t: L10nFn = enFallback,
): SubagentNode[] {
  const childrenOf = subagentChildrenOf(sessions)

  const sortLayer = (list: SessionInput[]): SessionInput[] =>
    [...list].sort((a, b) => Number(b.running) - Number(a.running) || b.updatedAt - a.updatedAt)

  const toNode = (s: SessionInput, seen: ReadonlySet<string>): SubagentNode => {
    const nextSeen = new Set(seen).add(s.sessionId)
    const kids = (childrenOf.get(s.sessionId) ?? []).filter((k) => !nextSeen.has(k.sessionId))
    const children = kids.length > 0 ? sortLayer(kids).map((k) => toNode(k, nextSeen)) : undefined
    return {
      sessionId: s.sessionId,
      title: (labelOf?.(s) ?? s.title) ?? t('Session {0}', s.sessionId.slice(0, 8)),
      running: s.running,
      ...(s.totalTokens !== undefined ? { totalTokens: s.totalTokens } : {}),
      updatedAt: s.updatedAt,
      ...(children !== undefined ? { children } : {}),
    }
  }

  return sortLayer(childrenOf.get(rootId) ?? []).map((s) => toNode(s, new Set([rootId])))
}
