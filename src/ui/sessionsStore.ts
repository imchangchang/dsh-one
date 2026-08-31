import * as vscode from 'vscode'
import type { Logger } from '../log.ts'
import { subscribeHostEvents } from '../server/hostEvents.ts'
import { listSessions, listWorkspaces, sessionTitle, sessionTotalTokens } from '../server/dshRpc.ts'
import type { SessionSummary } from '../server/dshRpc.ts'
import type { ServerManager, ServerStatus } from '../server/manager.ts'
import { applyHostFrame, parseHostFrame } from '../pure/hostFrames.ts'
import type { HostFrame } from '../pure/hostFrames.ts'
import {
  buildSessionTree,
  UNGROUPED_WORKSPACE_ID,
  type SessionInput,
  type SessionSortOrder,
  type WorkspaceInput,
  type WorkspaceNodeModel,
} from '../pure/sessionTree.ts'

/** Map one session.list entry onto the pure-layer SessionInput. */
function toSessionInput(s: SessionSummary): SessionInput {
  const totalTokens = sessionTotalTokens(s)
  return {
    sessionId: s.sessionId,
    updatedAt: s.updatedAt,
    running: s.running,
    blank: s.blank,
    title: sessionTitle(s),
    ...(s.parentSessionId ? { parentSessionId: s.parentSessionId } : {}),
    ...(s.origin ? { origin: s.origin } : {}),
    ...(s.agentPreset !== undefined ? { agentPreset: s.agentPreset } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
  }
}

/** Local tick for relative-time labels; rebuilds from the cached baseline, no RPC. */
const RELATIVE_TIME_TICK_MS = 60_000

/** workspaceState key for the persisted sort preference (UI-only state). */
const SORT_STATE_KEY = 'sessions.sortOrder'
/** workspaceState keys for pinned sessions and collapsed workspaces (UI-only; dsh 无此概念）. */
const PINNED_STATE_KEY = 'sessions.pinned'
const COLLAPSED_STATE_KEY = 'sessions.collapsed'
/** workspaceState key for manually unread-marked sessions (UI-only; dsh 无未读概念）. */
const UNREAD_STATE_KEY = 'sessions.unread'

/** The sessions panel model as pushed to the chat webview (不含服务状态，由 ChatViewProvider 补充). */
export interface SessionsStoreSnapshot {
  workspaces: WorkspaceNodeModel[]
  query: string | null
  sortOrder: SessionSortOrder
  /** Client-pinned session ids (dsh 无置顶 API，纯本地 UI 状态）. */
  pinned: string[]
  /** Collapsed workspace ids. */
  collapsed: string[]
  /** Manually unread-marked session ids (dsh 无未读 API，纯本地 UI 状态）. */
  unread: string[]
}

/**
 * Sessions 数据层：原 SessionTreeProvider 去掉 vscode TreeItem 后的纯数据部分。
 * 服务运行时以 workspace.list + session.list 为基线缓存，host 事件逐帧增量
 * 维护（对齐官方 dsh-client-runtime：帧载荷自带增量所需的全部字段，不再
 * 防抖全量重拉）；另有 60s 本地 tick 纯重建模型（不发 RPC）刷新相对时间
 * 文案。消费方（Chat webview 的 sessions 面板）渲染 snapshot()，
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
  private unread = new Set<string>()
  /**
   * 自动「已完成」标记：观测到 running true→false 跳变且当时未附着的会话。
   * 对齐官方 dsh web 语义——纯内存、不持久化，刷新 VS Code 后消失；
   * 与手动未读（unread，持久化）分存，仅在展示层合并。
   */
  private completed = new Set<string>()
  /** 当前附着的会话（由 ChatViewProvider 告知）：完成标记排除它，附着即清除。 */
  private attachedId: string | null = null
  private url: string | null = null
  private hostEvents: vscode.Disposable | null = null
  private tickTimer: ReturnType<typeof setInterval> | null = null
  /**
   * refresh() 拉基线期间到达的 host 帧先缓冲、拉到后重放到新基线上——
   * 否则在途的旧快照会把已应用的增量盖掉（官方 listMutations 同款重放）。
   */
  private refreshInFlight = false
  private pendingHostFrames: HostFrame[] = []
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
    this.unread = new Set(state?.get<string[]>(UNREAD_STATE_KEY) ?? [])
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
    // 「未分组」虚拟组不是真 workspace，不能作为新建会话的目标。
    const real = this.workspaces.filter((w) => w.workspaceId !== UNGROUPED_WORKSPACE_ID)
    return real.find((w) => w.isCurrent)?.workspaceId ?? real[0]?.workspaceId ?? null
  }

  /** Whether the host still knows this (non-archived) session — chat fallback. */
  hasSession(sessionId: string): boolean {
    return this.knownSessionIds.has(sessionId)
  }

  /**
   * 服务端 running 位（session.list 基线 + host/session-status 增量），供附着
   * 会话的聊天态使用（对齐官方 handleRunning 的数据渠道）。基线还没有该会话
   * 时 undefined——调用方回退到本地折叠值。
   */
  runningFor(sessionId: string): boolean | undefined {
    return this.rawSessions.find((s) => s.sessionId === sessionId)?.running
  }

  /** Newest visible session of the current workspace, for default attach. */
  latestCurrentSessionId(): string | null {
    return this.workspaces.find((w) => w.isCurrent)?.sessions[0]?.sessionId ?? null
  }

  /** Current search query (null = unfiltered). */
  get currentQuery(): string | null {
    return this.query
  }

  /**
   * Cached session.list baseline (non-archived and archived alike, blank
   * included) — for the activity tree, which needs parentSessionId/origin/
   * totalTokens that the display model drops. No extra RPC.
   */
  rawList(): readonly SessionInput[] {
    return this.rawSessions
  }

  /**
   * Title of the workspace that owns `sessionId`, from the workspace.list
   * baseline (its sessionIds include blank sessions, unlike the display tree).
   * Sessions no workspace references report「未分组」——与面板的虚拟组同名；
   * undefined before the first refresh that knows the session.
   */
  workspaceLabelFor(sessionId: string): string | undefined {
    const owned = this.rawWorkspaces.find((w) => w.sessionIds.includes(sessionId))?.title
    return owned ?? (this.knownSessionIds.has(sessionId) ? '未分组' : undefined)
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
      unread: [...this.unread],
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

  /** Mark a session read/unread (client-side only); persists across reloads. */
  setUnread(sessionId: string, unread: boolean): void {
    const changed = unread ? !this.unread.has(sessionId) : this.unread.delete(sessionId)
    if (unread) this.unread.add(sessionId)
    if (!changed) return
    void this.state?.update(UNREAD_STATE_KEY, [...this.unread])
    this.rebuildModel()
    this.onDidChangeEmitter.fire()
  }

  /**
   * Chat view 附着/脱离会话时同步：附着中的会话不打完成标记（官方语义：
   * 当前选中的会话不标），且附着即清除其已有标记。
   */
  setAttachedSession(sessionId: string | null): void {
    this.attachedId = sessionId
    if (sessionId && this.completed.delete(sessionId)) {
      this.rebuildModel()
      this.onDidChangeEmitter.fire()
    }
  }

  /** Collapse/expand a workspace group; persists across reloads. */
  setCollapsed(workspaceId: string, collapse: boolean): void {
    const changed = collapse ? !this.collapsed.has(workspaceId) : this.collapsed.delete(workspaceId)
    if (collapse) this.collapsed.add(workspaceId)
    if (!changed) return
    void this.state?.update(COLLAPSED_STATE_KEY, [...this.collapsed])
    this.onDidChangeEmitter.fire()
  }

  /**
   * Collapse every workspace group of the current model at once —
   * one persistence write + one notification, not N × setCollapsed.
   * 搜索过滤时只折叠当前可见的组（workspaces 即过滤后的模型）。
   */
  collapseAll(): void {
    const ids = this.workspaces.map((w) => w.workspaceId)
    if (ids.every((id) => this.collapsed.has(id))) return
    for (const id of ids) this.collapsed.add(id)
    void this.state?.update(COLLAPSED_STATE_KEY, [...this.collapsed])
    this.onDidChangeEmitter.fire()
  }

  /** collapseAll 的反向操作：只展开当前可见的组，被搜索过滤掉的组保持原状。 */
  expandAll(): void {
    const ids = this.workspaces.map((w) => w.workspaceId)
    if (ids.every((id) => !this.collapsed.has(id))) return
    for (const id of ids) this.collapsed.delete(id)
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
    this.pendingHostFrames = []
    this.refreshInFlight = false
    if (this.tickTimer) {
      clearInterval(this.tickTimer)
      this.tickTimer = null
    }
    if (url) {
      this.hostEvents = subscribeHostEvents(url, this.logger, (method, payload) => this.onHostFrame(method, payload))
      // dsh web 的相对时间也只在渲染时取 Date.now()、不轮询；这里用本地
      // tick 纯重建模型（不发 RPC），让"N 分钟前"随时间走。
      this.tickTimer = setInterval(() => {
        if (this.rawSessions.length === 0) return
        this.rebuildModel()
        this.onDidChangeEmitter.fire()
      }, RELATIVE_TIME_TICK_MS)
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

  /**
   * Host 帧入口：解析后逐帧增量应用到缓存基线（对齐官方 host 帧的增量
   * 语义，见 src/pure/hostFrames.ts）。全量重拉只保留给基线场景：服务状态
   * 变化、手动刷新、聊天侧标题变化（title 走 mux 投影，host 流没有对应帧）。
   */
  private onHostFrame(method: string, payload: unknown): void {
    const frame = parseHostFrame(method, payload)
    if (!frame) return
    if (this.refreshInFlight) {
      this.pendingHostFrames.push(frame)
      return
    }
    this.applyFrame(frame)
  }

  /** Apply one parsed host frame; no-op frames（状态未变/未知 id）不触发重建。 */
  private applyFrame(frame: HostFrame): void {
    const prevRunning =
      frame.type === 'host/session-status'
        ? this.rawSessions.find((s) => s.sessionId === frame.sessionId)?.running
        : undefined
    const next = applyHostFrame(
      { sessions: this.rawSessions, workspaces: this.rawWorkspaces, archived: this.rawArchived },
      frame,
      Date.now(),
    )
    if (!next) return
    this.rawSessions = next.sessions
    this.rawWorkspaces = next.workspaces
    this.rawArchived = next.archived
    this.knownSessionIds = new Set(
      this.rawSessions.map((s) => s.sessionId).filter((id) => !this.rawArchived.has(id)),
    )
    if (frame.type === 'host/session-status') this.noteRunningFlip(frame.sessionId, prevRunning, frame.running)
    this.rebuildModel()
    this.onDidChangeEmitter.fire()
  }

  /**
   * 完成标记（官方语义）的单会话版：running 的 true→false 跳变入集（附着中的
   * 会话除外），重新开始运行出集。refresh() 的全量对比与 session-status 增量
   * 共用这一段。
   */
  private noteRunningFlip(sessionId: string, prev: boolean | undefined, running: boolean): void {
    if (running) this.completed.delete(sessionId)
    else if (prev === true && sessionId !== this.attachedId) this.completed.add(sessionId)
  }

  /** Re-fetch the baseline and rebuild the model. Failures only log. */
  async refresh(): Promise<void> {
    const url = this.runningUrl
    if (!url) return
    this.refreshInFlight = true
    try {
      const prevRunning = new Map(this.rawSessions.map((s) => [s.sessionId, s.running]))
      const [workspaceList, sessions] = await Promise.all([listWorkspaces(url), listSessions(url)])
      const archived = new Set(workspaceList.archivedSessionIds)
      this.rawWorkspaces = workspaceList.items
      this.rawSessions = sessions.map((s) => toSessionInput(s))
      this.rawArchived = archived
      this.knownSessionIds = new Set(
        this.rawSessions.map((s) => s.sessionId).filter((id) => !this.rawArchived.has(id)),
      )
      // 完成标记（官方语义）：首次刷新无旧基线，不会误标——VS Code 没开期间
      // 完成的会话不会有标记，与官方"页面没开期间不记"一致。
      for (const s of this.rawSessions) this.noteRunningFlip(s.sessionId, prevRunning.get(s.sessionId), s.running)
      this.rebuildModel()
    } catch (err) {
      this.logger.warn(`sessions store: refresh failed — ${err instanceof Error ? err.message : err}`)
    }
    this.refreshInFlight = false
    // 拉取期间缓冲的帧按到达顺序重放到（新或旧）基线上——成功时它们可能晚于
    // 响应快照；失败时基线没变，照常应用，避免与后续直应用的帧乱序。
    const buffered = this.pendingHostFrames
    this.pendingHostFrames = []
    for (const frame of buffered) this.applyFrame(frame)
    this.onDidChangeEmitter.fire()
  }

  /** Rebuild the display model from the cached baseline + current sort/query. */
  private rebuildModel(): void {
    // 展示层合流：手动未读（持久化）与自动完成标记（内存）共用同一蓝点，
    // 官方 dsh web 也是同一状态槽位的 done 圆点，视觉等价。
    const unreadDisplay = this.completed.size === 0 ? this.unread : new Set([...this.unread, ...this.completed])
    this.workspaces = buildSessionTree(
      this.rawWorkspaces,
      this.rawSessions,
      this.rawArchived,
      // 标题在 toSessionInput 里已从 title 投影解析好。
      (s) => s.title ?? null,
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      Date.now(),
      { sort: this.sortOrder, query: this.query ?? undefined, pinned: this.pinned, unread: unreadDisplay },
    )
  }

  dispose(): void {
    this.stateSub.dispose()
    this.hostEvents?.dispose()
    if (this.tickTimer) clearInterval(this.tickTimer)
    this.onDidChangeEmitter.dispose()
  }
}
