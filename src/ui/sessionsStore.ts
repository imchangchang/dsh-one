import * as vscode from 'vscode'
import type { Logger } from '../log.ts'
import { subscribeHostEvents } from '../server/hostEvents.ts'
import { listSessions, listWorkspaces, sessionTitle } from '../server/dshRpc.ts'
import type { ServerManager, ServerStatus } from '../server/manager.ts'
import {
  buildSessionTree,
  type SessionInput,
  type SessionSortOrder,
  type WorkspaceInput,
  type WorkspaceNodeModel,
} from '../pure/sessionTree.ts'

/** Debounce window for host-event-driven refreshes. */
const REFRESH_DEBOUNCE_MS = 500

/** workspaceState key for the persisted sort preference (UI-only state). */
const SORT_STATE_KEY = 'sessions.sortOrder'
/** workspaceState keys for pinned sessions and collapsed workspaces (UI-only; dsh 无此概念）. */
const PINNED_STATE_KEY = 'sessions.pinned'
const COLLAPSED_STATE_KEY = 'sessions.collapsed'

/** Host event methods that can change the list; anything else is ignored. */
const REFRESH_METHODS = new Set([
  'host/session-added',
  'host/session-removed',
  'host/session-status',
  'host/workspace-changed',
  'host/workspace-removed',
  'host/workspace-order-changed',
  'host/archived-sessions-changed',
])

/** The sessions panel model as pushed to the chat webview (不含服务状态，由 ChatViewProvider 补充). */
export interface SessionsStoreSnapshot {
  workspaces: WorkspaceNodeModel[]
  query: string | null
  sortOrder: SessionSortOrder
  /** Client-pinned session ids (dsh 无置顶 API，纯本地 UI 状态）. */
  pinned: string[]
  /** Collapsed workspace ids. */
  collapsed: string[]
}

/**
 * Sessions 数据层：原 SessionTreeProvider 去掉 vscode TreeItem 后的纯数据部分。
 * 服务运行时以 workspace.list + session.list 为基线缓存，相关 host 事件
 * 500ms 防抖后重拉；消费方（Chat webview 的 sessions 面板）渲染 snapshot()，
 * 变更经 onDidChange 通知。
 */
export class SessionsStore implements vscode.Disposable {
  private workspaces: WorkspaceNodeModel[] = []
  /** Non-archived ids from the last successful session.list (blank included). */
  private knownSessionIds = new Set<string>()
  /** Last fetched baseline, kept so search/sort rebuild locally without RPC. */
  private rawWorkspaces: WorkspaceInput[] = []
  private rawSessions: SessionInput[] = []
  private rawArchived: ReadonlySet<string> = new Set()
  private sortOrder: SessionSortOrder = 'updatedDesc'
  private query: string | null = null
  private pinned = new Set<string>()
  private collapsed = new Set<string>()
  private url: string | null = null
  private hostEvents: vscode.Disposable | null = null
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private readonly stateSub: vscode.Disposable
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>()
  /** Fired after every model rebuild (refresh, sort, query, server down). */
  readonly onDidChange = this.onDidChangeEmitter.event

  constructor(
    private readonly manager: ServerManager,
    private readonly logger: Logger,
    private readonly state?: vscode.Memento,
  ) {
    const savedSort = state?.get<string>(SORT_STATE_KEY)
    if (savedSort === 'updatedDesc' || savedSort === 'updatedAsc' || savedSort === 'title') {
      this.sortOrder = savedSort
    }
    this.pinned = new Set(state?.get<string[]>(PINNED_STATE_KEY) ?? [])
    this.collapsed = new Set(state?.get<string[]>(COLLAPSED_STATE_KEY) ?? [])
    this.stateSub = manager.onDidChangeState((status) => this.onStateChange(status))
    this.onStateChange(manager.getStatus())
  }

  /** Base URL while running, else null — for the command handlers. */
  get runningUrl(): string | null {
    const status = this.manager.getStatus()
    return status.state === 'running' && status.url ? status.url : null
  }

  /** Workspace for title-area commands: the current folder's, else the first. */
  defaultWorkspaceId(): string | null {
    return this.workspaces.find((w) => w.isCurrent)?.workspaceId ?? this.workspaces[0]?.workspaceId ?? null
  }

  /** Whether the host still knows this (non-archived) session — chat fallback. */
  hasSession(sessionId: string): boolean {
    return this.knownSessionIds.has(sessionId)
  }

  /** Newest visible session of the current workspace, for default attach. */
  latestCurrentSessionId(): string | null {
    return this.workspaces.find((w) => w.isCurrent)?.sessions[0]?.sessionId ?? null
  }

  /** Current search query (null = unfiltered). */
  get currentQuery(): string | null {
    return this.query
  }

  get currentSortOrder(): SessionSortOrder {
    return this.sortOrder
  }

  /** Current panel model for the webview. */
  snapshot(): SessionsStoreSnapshot {
    return {
      workspaces: this.workspaces,
      query: this.query,
      sortOrder: this.sortOrder,
      pinned: [...this.pinned],
      collapsed: [...this.collapsed],
    }
  }

  /** Pin/unpin a session (client-side only); persists across reloads. */
  setPinned(sessionId: string, pin: boolean): void {
    const changed = pin ? !this.pinned.has(sessionId) : this.pinned.delete(sessionId)
    if (pin) this.pinned.add(sessionId)
    if (!changed) return
    void this.state?.update(PINNED_STATE_KEY, [...this.pinned])
    this.rebuildModel()
    this.onDidChangeEmitter.fire()
  }

  /** Collapse/expand a workspace group; persists across reloads. */
  setCollapsed(workspaceId: string, collapse: boolean): void {
    const changed = collapse ? !this.collapsed.has(workspaceId) : this.collapsed.delete(workspaceId)
    if (collapse) this.collapsed.add(workspaceId)
    if (!changed) return
    void this.state?.update(COLLAPSED_STATE_KEY, [...this.collapsed])
    this.onDidChangeEmitter.fire()
  }

  /** Rebuild with a new sort order; the preference survives reloads. */
  setSortOrder(order: SessionSortOrder): void {
    if (order === this.sortOrder) return
    this.sortOrder = order
    void this.state?.update(SORT_STATE_KEY, order)
    this.rebuildModel()
    this.onDidChangeEmitter.fire()
  }

  /** Set (or clear with null/empty) the search query. */
  setQuery(query: string | null): void {
    const trimmed = query?.trim() ?? ''
    this.query = trimmed === '' ? null : trimmed
    this.rebuildModel()
    this.onDidChangeEmitter.fire()
  }

  private onStateChange(status: ServerStatus): void {
    const url = status.state === 'running' && status.url ? status.url : null
    if (url === this.url) return
    this.url = url
    this.hostEvents?.dispose()
    this.hostEvents = null
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
    if (url) {
      this.hostEvents = subscribeHostEvents(url, this.logger, (method) => {
        if (REFRESH_METHODS.has(method)) this.scheduleRefresh()
      })
      void this.refresh()
    } else {
      this.workspaces = []
      this.knownSessionIds = new Set()
      this.rawWorkspaces = []
      this.rawSessions = []
      this.rawArchived = new Set()
      this.onDidChangeEmitter.fire()
    }
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null
      void this.refresh()
    }, REFRESH_DEBOUNCE_MS)
  }

  /** Re-fetch the baseline and rebuild the model. Failures only log. */
  async refresh(): Promise<void> {
    const url = this.runningUrl
    if (!url) return
    try {
      const [workspaceList, sessions] = await Promise.all([listWorkspaces(url), listSessions(url)])
      const archived = new Set(workspaceList.archivedSessionIds)
      this.knownSessionIds = new Set(
        sessions.map((s) => s.sessionId).filter((id) => !archived.has(id)),
      )
      this.rawWorkspaces = workspaceList.items
      this.rawSessions = sessions
      this.rawArchived = archived
      this.rebuildModel()
    } catch (err) {
      this.logger.warn(`sessions store: refresh failed — ${err instanceof Error ? err.message : err}`)
    }
    this.onDidChangeEmitter.fire()
  }

  /** Rebuild the display model from the cached baseline + current sort/query. */
  private rebuildModel(): void {
    this.workspaces = buildSessionTree(
      this.rawWorkspaces,
      this.rawSessions,
      this.rawArchived,
      sessionTitle,
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      Date.now(),
      { sort: this.sortOrder, query: this.query ?? undefined, pinned: this.pinned },
    )
  }

  dispose(): void {
    this.stateSub.dispose()
    this.hostEvents?.dispose()
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.onDidChangeEmitter.dispose()
  }
}
