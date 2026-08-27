import * as vscode from 'vscode'
import type { Logger } from '../log.ts'
import { subscribeHostEvents } from '../server/hostEvents.ts'
import { listSessions, listWorkspaces, sessionTitle } from '../server/dshRpc.ts'
import type { ServerManager, ServerStatus } from '../server/manager.ts'
import {
  buildSessionTree,
  type SessionNodeModel,
  type WorkspaceNodeModel,
} from '../pure/sessionTree.ts'

/** Debounce window for host-event-driven refreshes. */
const REFRESH_DEBOUNCE_MS = 500

/** Host event methods that can change the tree; anything else is ignored. */
const REFRESH_METHODS = new Set([
  'host/session-added',
  'host/session-removed',
  'host/session-status',
  'host/workspace-changed',
  'host/workspace-removed',
  'host/workspace-order-changed',
  'host/archived-sessions-changed',
])

export class WorkspaceNode extends vscode.TreeItem {
  constructor(readonly model: WorkspaceNodeModel) {
    super(model.label, vscode.TreeItemCollapsibleState.Expanded)
    this.iconPath = new vscode.ThemeIcon('folder')
    this.contextValue = model.isCurrent ? 'dshWorkspace.current' : 'dshWorkspace.other'
    this.description = model.isCurrent ? '当前' : undefined
    this.tooltip = model.path
  }
}

export class SessionNode extends vscode.TreeItem {
  constructor(readonly model: SessionNodeModel) {
    super(model.label, vscode.TreeItemCollapsibleState.None)
    this.description = model.description
    // Running sessions get a colored icon so they stand out in the list.
    this.iconPath = model.running
      ? new vscode.ThemeIcon('comment-discussion', new vscode.ThemeColor('charts.green'))
      : new vscode.ThemeIcon('comment-discussion')
    this.contextValue = 'dshSession'
    // Clicking attaches the native chat view (dshOne.chat, roadmap phase 2);
    // the embedded dsh web UI still has no deep link to follow along.
    this.command = { command: 'dshOne.session.open', title: '打开会话', arguments: [this] }
  }
}

type TreeNode = WorkspaceNode | SessionNode

/**
 * Sessions tree (`dshOne.sessions`): workspaces with their visible sessions.
 * While the server runs it keeps a baseline from workspace.list +
 * session.list and re-fetches (debounced) on relevant host events; when the
 * server is down the tree is empty (a viewsWelcome hint takes over).
 */
export class SessionTreeProvider implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable {
  private workspaces: WorkspaceNodeModel[] = []
  /** Non-archived ids from the last successful session.list (blank included). */
  private knownSessionIds = new Set<string>()
  private url: string | null = null
  private hostEvents: vscode.Disposable | null = null
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private readonly stateSub: vscode.Disposable
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<TreeNode | undefined>()
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event

  constructor(
    private readonly manager: ServerManager,
    private readonly logger: Logger,
  ) {
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
      this.onDidChangeTreeDataEmitter.fire(undefined)
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
      this.workspaces = buildSessionTree(
        workspaceList.items,
        sessions,
        archived,
        sessionTitle,
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      )
    } catch (err) {
      this.logger.warn(`sessions tree: refresh failed — ${err instanceof Error ? err.message : err}`)
    }
    this.onDidChangeTreeDataEmitter.fire(undefined)
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) return this.workspaces.map((w) => new WorkspaceNode(w))
    if (element instanceof WorkspaceNode) return element.model.sessions.map((s) => new SessionNode(s))
    return []
  }

  dispose(): void {
    this.stateSub.dispose()
    this.hostEvents?.dispose()
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.onDidChangeTreeDataEmitter.dispose()
  }
}
