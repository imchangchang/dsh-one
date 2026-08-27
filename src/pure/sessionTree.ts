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
}

export interface SessionNodeModel {
  sessionId: string
  label: string
  /** Relative time string, e.g. "3 小时前". */
  description: string
  running: boolean
}

export interface WorkspaceNodeModel {
  workspaceId: string
  path: string
  label: string
  isCurrent: boolean
  sessions: SessionNodeModel[]
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
 * rest follow their updatedAt descending, as do sessions within a workspace.
 * Sessions not referenced by any workspace's sessionIds are ignored.
 */
export function buildSessionTree(
  workspaces: WorkspaceInput[],
  sessions: SessionInput[],
  archivedSessionIds: ReadonlySet<string>,
  titleOf: (s: SessionInput) => string | null,
  currentFolder?: string,
  now: number = Date.now(),
): WorkspaceNodeModel[] {
  const byId = new Map(sessions.map((s) => [s.sessionId, s]))

  const ordered = [...workspaces].sort((a, b) => {
    const aCurrent = currentFolder !== undefined && a.path === currentFolder
    const bCurrent = currentFolder !== undefined && b.path === currentFolder
    if (aCurrent !== bCurrent) return aCurrent ? -1 : 1
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
  })

  return ordered.map((w) => {
    const visible = w.sessionIds
      .map((id) => byId.get(id))
      .filter((s): s is SessionInput => !!s && !s.blank && !archivedSessionIds.has(s.sessionId))
      .sort((a, b) => b.updatedAt - a.updatedAt)
    return {
      workspaceId: w.workspaceId,
      path: w.path,
      label: w.title,
      isCurrent: currentFolder !== undefined && w.path === currentFolder,
      sessions: visible.map((s) => ({
        sessionId: s.sessionId,
        label: titleOf(s) ?? `会话 ${s.sessionId.slice(0, 8)}`,
        description: formatRelativeTime(s.updatedAt, now),
        running: s.running,
      })),
    }
  })
}
