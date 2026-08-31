/**
 * Pure model for the Sessions tree view: grouping, filtering, ordering and
 * labels. No `vscode` import — unit-testable with node --test.
 *
 * 注意：本文件也进聊天 webview 的浏览器 bundle（esbuild browser 平台），
 * 不能用 node: 内置模块——basename 语义用下面的 basenameOf 手写。
 */

import type { PendingInteraction } from './chatContract.ts'

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
  /** Parent session for continuable subagent sessions (session.list). */
  parentSessionId?: string
  /** Host-assigned origin marker (e.g. 'subagent'); informational only. */
  origin?: string
  /** Sum of the tokenUsage projection's buckets, when the host reports one. */
  totalTokens?: number
  /** Title projection resolved at fetch time (null when untitled). */
  title?: string | null
  /**
   * Host-assigned composition (session.list 的 agentPreset 字段，官方
   * sessionSummarySchema 同款；创建时即定，新旧会话都有）。显示树不用它，
   * rawList 消费方（聊天头部 preset 标签）用。
   */
  agentPreset?: string
}

export interface SessionNodeModel {
  sessionId: string
  label: string
  /** Relative time string, e.g. "3 小时前". */
  description: string
  running: boolean
  /** Client-side pin (dsh has no pin API); pinned sessions sort first. */
  pinned: boolean
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
  /** Client-side pinned ids; pinned sessions sort before unpinned within a workspace. */
  pinned?: ReadonlySet<string>
  /** Client-side unread ids; purely a display flag (bold title + dot). */
  unread?: ReadonlySet<string>
  /** Mux-tracked pending interaction per session; display-only yellow dot. */
  pendingInteractions?: ReadonlyMap<string, PendingInteraction>
}

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** "刚刚 / N 分钟前 / N 小时前 / N 天前" relative to `now` (epoch ms). */
export function formatRelativeTime(updatedAt: number, now: number): string {
  const diff = Math.max(0, now - updatedAt)
  if (diff < MINUTE_MS) return '刚刚'
  if (diff < HOUR_MS) return `${Math.floor(diff / MINUTE_MS)} 分钟前`
  if (diff < DAY_MS) return `${Math.floor(diff / HOUR_MS)} 小时前`
  return `${Math.floor(diff / DAY_MS)} 天前`
}

/**
 * Build the ordered tree model. Blank sessions (unstarted conversations the
 * client reuses for "new session") and archived ones are hidden. The
 * workspace matching `currentFolder` comes first (flagged isCurrent); the
 * rest follow their updatedAt descending. Sessions within a workspace put
 * `view.pinned` ids first, then follow `view.sort` (default updatedAt
 * descending). A non-empty `view.query`
 * keeps only sessions whose label or id contains it (case-insensitive) and
 * drops workspaces left without a match. Sessions not referenced by any
 * workspace's sessionIds form a synthetic「未分组」group (UNGROUPED_WORKSPACE_ID,
 * empty path) appended last — same as dsh web's ungrouped section. Lineage
 * children (parentSessionId set) never appear as rows; they only feed the
 * parent's descendantRunning busy flag.
 */
export function buildSessionTree(
  workspaces: WorkspaceInput[],
  sessions: SessionInput[],
  archivedSessionIds: ReadonlySet<string>,
  titleOf: (s: SessionInput) => string | null,
  currentFolder?: string,
  now: number = Date.now(),
  view: SessionTreeViewOptions = {},
): WorkspaceNodeModel[] {
  const byId = new Map(sessions.map((s) => [s.sessionId, s]))
  const query = view.query?.trim().toLowerCase() ?? ''
  const sort = view.sort ?? 'updatedDesc'

  // 血缘：parentSessionId 把子代理挂在父会话下。子代理行不进任何组
  // （workspace 不引用它们，也未分组组也不收——见下方 orphans 过滤），
  // 只在这里贡献「有运行中后代」的忙碌判定。
  const childrenOf = new Map<string, SessionInput[]>()
  for (const s of sessions) {
    if (!s.parentSessionId) continue
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

  // 会话行流水线：label 解析（query 匹配和 title 排序都要用，先算一次）→
  // 查询过滤 → pinned 优先 + view.sort。workspace 组与「未分组」组共用。
  const toSessionNodes = (list: SessionInput[]): SessionNodeModel[] =>
    list
      .map((s) => ({ session: s, label: titleOf(s) ?? `会话 ${s.sessionId.slice(0, 8)}` }))
      .filter(
        ({ session, label }) =>
          query === '' ||
          label.toLowerCase().includes(query) ||
          session.sessionId.toLowerCase().includes(query),
      )
      .sort((a, b) => {
        const aPinned = view.pinned?.has(a.session.sessionId) === true
        const bPinned = view.pinned?.has(b.session.sessionId) === true
        if (aPinned !== bPinned) return aPinned ? -1 : 1
        if (sort === 'updatedAsc') return a.session.updatedAt - b.session.updatedAt
        if (sort === 'title') return a.label.localeCompare(b.label)
        return b.session.updatedAt - a.session.updatedAt
      })
      .map(({ session, label }) => {
        const pendingInteraction = view.pendingInteractions?.get(session.sessionId)
        return {
          sessionId: session.sessionId,
          label,
          description: formatRelativeTime(session.updatedAt, now),
          running: session.running,
          pinned: view.pinned?.has(session.sessionId) === true,
          unread: view.unread?.has(session.sessionId) === true,
          descendantRunning: hasRunningDescendant(session.sessionId),
          ...(pendingInteraction !== undefined ? { pendingInteraction } : {}),
        }
      })

  const ordered = [...workspaces].sort((a, b) => {
    const aCurrent = currentFolder !== undefined && a.path === currentFolder
    const bCurrent = currentFolder !== undefined && b.path === currentFolder
    if (aCurrent !== bCurrent) return aCurrent ? -1 : 1
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
  })

  const nodes = ordered.map((w) => {
    const visible = w.sessionIds
      .map((id) => byId.get(id))
      .filter((s): s is SessionInput => !!s && !s.blank && !archivedSessionIds.has(s.sessionId))
    return {
      workspaceId: w.workspaceId,
      path: w.path,
      // 空 title 兜底（防御：dsh 侧 title 正常是 basename(path)，渲染层
      // 不赌它非空）；basename 为空（如根路径）时退回完整 path。
      label: w.title || basenameOf(w.path) || w.path,
      isCurrent: currentFolder !== undefined && w.path === currentFolder,
      sessions: toSessionNodes(visible),
    }
  })

  // 未被任何 workspace 引用的会话：合成「未分组」虚拟组排在最后。
  // 血缘子行（有 parentSessionId 的子代理）不算未分组——它们属于父会话，
  // 只参与忙碌聚合，不在面板单列。
  const referenced = new Set(workspaces.flatMap((w) => w.sessionIds))
  const orphans = sessions.filter(
    (s) =>
      !referenced.has(s.sessionId) && !s.parentSessionId && !s.blank && !archivedSessionIds.has(s.sessionId),
  )
  const orphanNodes = toSessionNodes(orphans)
  if (orphanNodes.length > 0) {
    nodes.push({
      workspaceId: UNGROUPED_WORKSPACE_ID,
      path: '',
      label: '未分组',
      isCurrent: false,
      sessions: orphanNodes,
    })
  }

  // Under an active query, a workspace with no matching session is noise.
  return query === '' ? nodes : nodes.filter((w) => w.sessions.length > 0)
}
