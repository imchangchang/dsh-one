/**
 * Pure model for the Sessions tree view: grouping, filtering, ordering and
 * labels. No `vscode` import — unit-testable with node --test.
 */

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
 * empty path) appended last — same as dsh web's ungrouped section.
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
      .map(({ session, label }) => ({
        sessionId: session.sessionId,
        label,
        description: formatRelativeTime(session.updatedAt, now),
        running: session.running,
        pinned: view.pinned?.has(session.sessionId) === true,
        unread: view.unread?.has(session.sessionId) === true,
      }))

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
      label: w.title,
      isCurrent: currentFolder !== undefined && w.path === currentFolder,
      sessions: toSessionNodes(visible),
    }
  })

  // 未被任何 workspace 引用的会话：合成「未分组」虚拟组排在最后。
  const referenced = new Set(workspaces.flatMap((w) => w.sessionIds))
  const orphans = sessions.filter(
    (s) => !referenced.has(s.sessionId) && !s.blank && !archivedSessionIds.has(s.sessionId),
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
