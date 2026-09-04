import * as vscode from 'vscode'
import { randomUUID } from 'node:crypto'
import type { Logger } from '../log.ts'
import { subscribeHostEvents } from '../server/hostEvents.ts'
import { subscribeMuxEvents } from '../server/muxEvents.ts'
import type { MuxFrame } from '../server/muxEvents.ts'
import { isModern } from '../server/serverAuth.ts'
import { subscribeModernEvents, subscribeWorkspaceStream } from '../server/modernStreams.ts'
import { listSessions, listWorkspaces, searchSessions, sessionTitle, sessionTotalTokens, sessionCompletedTurns } from '../server/dshRpc.ts'
import type { SessionSummary } from '../server/dshRpc.ts'
import type { ServerManager, ServerStatus } from '../server/manager.ts'
import { applyHostFrame, parseHostFrame } from '../pure/hostFrames.ts'
import type { HostFrame } from '../pure/hostFrames.ts'
import { questionInteractionStatus, type PendingInteraction } from '../pure/chatContract.ts'
import type { PendingQuestion } from '../pure/chatContract.ts'
import { parseWorkspaceStreamFrame } from '../pure/remoteFrames.ts'
import {
  buildSessionTree,
  UNGROUPED_WORKSPACE_ID,
  type SessionInput,
  type SessionSortOrder,
  type WorkspaceInput,
  type WorkspaceNodeModel,
} from '../pure/sessionTree.ts'
import {
  groupMembershipCount,
  groupNameError,
  removeGroupId,
  reorderGroups,
  sanitizeGroups,
  sanitizeMembership,
  setWorkspaceGroupIds,
  type WorkspaceGroupDef as GroupDef,
} from '../pure/workspaceGroups.ts'

/** Map one session.list entry onto the pure-layer SessionInput. */
function toSessionInput(s: SessionSummary): SessionInput {
  const totalTokens = sessionTotalTokens(s)
  const completedTurns = sessionCompletedTurns(s)
  return {
    sessionId: s.sessionId,
    updatedAt: s.updatedAt,
    running: s.running,
    blank: s.blank,
    title: sessionTitle(s),
    ...(s.parentSessionId ? { parentSessionId: s.parentSessionId } : {}),
    ...(s.origin ? { origin: s.origin } : {}),
    ...(s.agentPreset !== undefined ? { agentPreset: s.agentPreset } : {}),
    ...(s.cwd ? { cwd: s.cwd } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(completedTurns > 0 ? { sessionStatsTurns: completedTurns } : {}),
  }
}

/** Local tick for relative-time labels; rebuilds from the cached baseline, no RPC. */
const RELATIVE_TIME_TICK_MS = 60_000
/** Host-event reconnect backoff: 1s doubling up to this cap. */
const RECONNECT_MAX_MS = 30_000
/** 触发点去抖窗口：低频率事件（send 后 / 窗口聚焦 / 侧栏可见 / 会话状态翻转）
 *  常在同一批连发（如 send 后触发 + running 翻转触发），500ms 内只落地一次
 *  基线重拉，避免同一动作打多组全量 RPC。 */
const REFRESH_DEBOUNCE_MS = 500

/** workspaceState key for the persisted sort preference (UI-only state). */
const SORT_STATE_KEY = 'sessions.sortOrder'
/** workspaceState keys for pinned sessions and collapsed workspaces (UI-only; dsh 无此概念）. */
const PINNED_STATE_KEY = 'sessions.pinned'
const COLLAPSED_STATE_KEY = 'sessions.collapsed'
/** workspaceState key for manually unread-marked sessions (UI-only; dsh 无未读概念）. */
const UNREAD_STATE_KEY = 'sessions.unread'
/** workspaceState key for recycle-bin session ids (UI-only; dsh 无回收站概念）. */
const RECYCLE_BIN_STATE_KEY = 'sessions.recycleBin'
/** workspaceState key for recycle view collapsed workspaces (与主列表折叠互不影响）. */
const RECYCLE_COLLAPSED_STATE_KEY = 'sessions.recycleCollapsed'

/**
 * 工作区分组状态（globalState，跨窗口/重启共享）：分组定义与顺序、
 * workspace↔组 归属、当前选中组。与上面的 workspaceState 偏好键
 * （排序/折叠/置顶/未读/回收站）分区，扩展开多窗口时两边互不覆盖。
 * 归组是纯客户端状态（dsh 无分组概念），与 pinned/unread 同性质。
 */
const GROUPS_STATE_KEY = 'sessions.groups'
const GROUP_MEMBERSHIP_STATE_KEY = 'sessions.groupMembership'
const ACTIVE_GROUP_STATE_KEY = 'sessions.activeGroup'


/**
 * 面向 Windows 的 workspace 路径等价比较：大小写、斜杠与尾斜杠不敏感
 * （VS Code fsPath 返回小写盘符 + 反斜杠，dsh 服务端 path 未必一致）。
 */
function windowsPathEqual(a: string, b: string): boolean {
  const norm = (p: string): string => p.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
  return norm(a) === norm(b)
}

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
  /** 已移入回收站的会话 id（dsh 无回收站概念，纯本地缓冲层状态；归档即终点）。 */
  recycleBin: string[]
  /** 回收站视图的按原 workspace 分组模型（已按回收站 id 过滤、无搜索过滤）。 */
  recycleWorkspaces: WorkspaceNodeModel[]
  /** 回收站视图折叠的 workspace id（与主列表 collapsed 互不影响）。 */
  recycleCollapsed: string[]
  /** 内容搜索是否被 20 条上限截断（展示「还有更多匹配」轻提示用）。 */
  contentSearchHasMore: boolean
  /** 最近一次内容搜索是否失败（后端索引未启用等）；展示「仅按标题匹配」轻提示。 */
  contentSearchError: boolean
  /** 基线是否已成功加载；false 时面板应显示 Loading，未分组组头/空导向不渲染。 */
  baselineReady: boolean
  /** 工作区分组（有序定义 + 全量归组计数），见 SessionsSnapshot 对应字段。 */
  groups: Array<{ id: string; name: string; count: number }>
  /** 当前选中的分组 id；null = 全部工作区。 */
  activeGroupId: string | null
  /** workspaceId → 组 id 列表（多对多，全量）。 */
  groupMembership: Record<string, string[]>
  /** 管理视图的 workspace 目录（全量，排除「未分组」虚拟组）。 */
  workspaceDirectory: Array<{ workspaceId: string; label: string }>
}

/**
 * Sessions 数据层：原 SessionTreeProvider 去掉 vscode TreeItem 后的纯数据部分。
 * 服务运行时以 workspace.list + session.list 为基线缓存，host 事件逐帧增量
 * 维护（对齐官方 dsh-client-runtime：帧载荷自带增量所需的全部字段，不再
 * 防抖全量重拉）；另有 60s 本地 tick 纯重建模型（不发 RPC）刷新相对时间
 * 文案。待交互状态（approval/question/plan-review 黄点）不走基线——由全局
 * mux 下行的 requested/resolved 帧实时跟踪（对齐官方 dsh web 侧栏）。
 * 消费方（Chat webview 的 sessions 面板）渲染 snapshot()，
 * 变更经 onDidChange 通知。会话标题除基线外还由 mux 的 session/projection
 * 推送帧实时更新（自动命名经此到达，host 事件流没有标题帧）。
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
  /** 置顶会话 id（保持置顶顺序：数组越靠前置顶越早/越优先；dsh 无置顶 API，纯本地 UI 状态）。 */
  private pinned: string[] = []
  private collapsed = new Set<string>()
  private unread = new Set<string>()
  /** 回收站会话 id（与 pinned 同为纯本地 UI 态：移入/恢复只改本地集合，不碰 dsh）。 */
  private recycleBin: string[] = []
  /** 回收站视图的折叠组（独立于主列表 collapsed，互不影响）。 */
  private recycleCollapsed = new Set<string>()
  /** 工作区分组定义（globalState 持久化；数组顺序 = 展示顺序）。 */
  private groups: GroupDef[] = []
  /** workspaceId → 组 id 列表（多对多，globalState 持久化）。 */
  private groupMembership: Record<string, string[]> = {}
  /** 当前选中的分组 id；null = 全部工作区。（globalState 持久化） */
  private activeGroupId: string | null = null
  /** 回收站视图的展示模型（只含回收站会话，无搜索过滤；基线与主列表同一份 raw 数据）。 */
  private recycleWorkspaces: WorkspaceNodeModel[] = []
  /** 内容搜索命中：sessionId → 最佳匹配片段（query 非空时由 session.search 填充）。 */
  private contentHits = new Map<string, string>()
  /** 最近一次内容搜索是否被 20 条上限截断。 */
  private contentSearchHasMore = false
  /** 最近一次内容搜索是否失败（后端索引未启用等）；true 时展示降级提示。 */
  private contentSearchError = false
  /**
   * 基线（workspace.list + session.list）是否成功加载过。首次连接/服务重启
   * 后为 false——期间增量帧（mux 重放/主机事件）会用空基线重建模型，恒渲染
   * 的「未分组」虚拟组会先于真实工作区组出现在面板上；webview 据此在基线未
   * 就绪时显示 Loading，而不是把空基线当成「没有 workspace」。
   */
  private baselineReady = false
  /** 内容搜索代际：每次 setQuery 递增，回调只认最新代际（丢弃过期响应）。 */
  private searchGeneration = 0
  /**
   * 自动「已完成」标记：观测到 running true→false 跳变且当时未附着的会话。
   * 对齐官方 dsh web 语义——纯内存、不持久化，刷新 VS Code 后消失；
   * 与手动未读（unread，持久化）分存，仅在展示层合并。
   */
  private completed = new Set<string>()
  /**
   * 待交互跟踪：sessionId →（稳定 key → 状态）。对齐官方 dsh-client-runtime
   * 的 pendingInteractions——session.list 不带审批/提问状态，该信息只从
   * 全局 mux 下行的 server-request 帧来（approval/question 的 requested/
   * resolved），连接时 host 会重放所有仍 pending 的请求。key 沿用官方：
   * `a:<approvalId>` / `q:<rpcId>`。
   */
  private pendingInteractions = new Map<string, Map<string, PendingInteraction>>()
  /**
   * 标题投影的 seq 水位（对齐官方 ProjectionValueStore：帧 seq 小于等于已见
   * 值丢弃，基线/推送乱序不会把新标题回退成旧的）。基线重拉用各行
   * projections.asOfSeq 播种，之后由 mux 的 session/projection 帧推进。
   */
  private titleSeqs = new Map<string, number>()
  /** 当前已打开的会话（由 ChatViewProvider 告知，多 tab 一个集合）：完成标记
   * 排除它们，打开即清除。 */
  private attachedIds = new Set<string>()
  private url: string | null = null
  private hostEvents: vscode.Disposable | null = null
  private mux: vscode.Disposable | null = null
  private tickTimer: ReturnType<typeof setInterval> | null = null
  /** refreshSoon() 的去抖定时器：非空表示已排程一次基线重拉，期间再调不重复。 */
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  /**
   * refresh() 拉基线期间到达的 host 帧先缓冲、拉到后重放到新基线上——
   * 否则在途的旧快照会把已应用的增量盖掉（官方 listMutations 同款重放）。
   */
  private refreshInFlight = false
  private pendingHostFrames: HostFrame[] = []
  /** Host 流重连状态：退避步数与待执行重连定时器；基线重拉成功即复位。 */
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private readonly stateSub: vscode.Disposable
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>()
  /** Fired after every model rebuild (refresh, sort, query, server down). */
  readonly onDidChange = this.onDidChangeEmitter.event

  constructor(
    private readonly manager: ServerManager,
    private readonly logger: Logger,
    private readonly state?: vscode.Memento,
    /** globalState（分组状态用，跨窗口共享；与 workspaceState 偏好键分区）。 */
    private readonly globalState?: vscode.Memento,
  ) {
    const savedSort = state?.get<string>(SORT_STATE_KEY)
    if (savedSort === 'updatedDesc' || savedSort === 'updatedAsc' || savedSort === 'title') {
      this.sortOrder = savedSort
    }
    this.pinned = state?.get<string[]>(PINNED_STATE_KEY) ?? []
    this.collapsed = new Set(state?.get<string[]>(COLLAPSED_STATE_KEY) ?? [])
    // 清掉历史版本可能残留的「未分组」折叠键（虚拟组恒展开，不应进集合）。
    this.collapsed.delete(UNGROUPED_WORKSPACE_ID)
    this.unread = new Set(state?.get<string[]>(UNREAD_STATE_KEY) ?? [])
    this.recycleBin = state?.get<string[]>(RECYCLE_BIN_STATE_KEY) ?? []
    this.recycleCollapsed = new Set(state?.get<string[]>(RECYCLE_COLLAPSED_STATE_KEY) ?? [])
    this.recycleCollapsed.delete(UNGROUPED_WORKSPACE_ID)
    // 分组状态从 globalState 载入（跨窗口共享）；activeGroup 落到未知组时
    // 回落「全部工作区」（组被删/数据残余的兜底，与删除时的回落同规则）。
    this.groups = sanitizeGroups(globalState?.get<unknown>(GROUPS_STATE_KEY))
    const groupIds = new Set(this.groups.map((g) => g.id))
    this.groupMembership = sanitizeMembership(globalState?.get<unknown>(GROUP_MEMBERSHIP_STATE_KEY), groupIds)
    const savedActive = globalState?.get<unknown>(ACTIVE_GROUP_STATE_KEY)
    this.activeGroupId = typeof savedActive === 'string' && groupIds.has(savedActive) ? savedActive : null
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
    return owned ?? (this.knownSessionIds.has(sessionId) ? vscode.l10n.t('Ungrouped') : undefined)
  }

  /**
   * workspace.list 基线（按注册表顺序，含 sessionIds 记账）：空会话 hero 的
   * workspace 选择器用它列全部 workspace 并定位当前项。只读引用，消费方不得
   * 修改；基线刷新时引用指向新数组（不原地改）。
   */
  get workspaceBaseline(): readonly WorkspaceInput[] {
    return this.rawWorkspaces
  }

  get currentSortOrder(): SessionSortOrder {
    return this.sortOrder
  }

  /**
   * Current panel model for the webview. 主列表 workspaces 按选中分组过滤
   * （先分组后搜索：buildSessionTree 已把搜索/排序/折叠应用到全量，这里从
   * 结果里剔除组外 workspace；「未分组」虚拟组在组过滤下也不显示——它不是
   * 任何组员，「全部工作区」才出现它）。
   */
  snapshot(): SessionsStoreSnapshot {
    const currentIds = new Set(this.rawWorkspaces.map((w) => w.workspaceId))
    return {
      workspaces: this.filteredWorkspaces(),
      query: this.query,
      sortOrder: this.sortOrder,
      pinned: [...this.pinned],
      collapsed: [...this.collapsed],
      unread: [...this.unread],
      recycleBin: [...this.recycleBin],
      recycleWorkspaces: this.recycleWorkspaces,
      recycleCollapsed: [...this.recycleCollapsed],
      contentSearchHasMore: this.contentSearchHasMore,
      contentSearchError: this.contentSearchError,
      baselineReady: this.baselineReady,
      groups: this.groups.map((g) => ({
        ...g,
        // 归组计数只认当前基线里真实存在的 workspace（成员残留旧 id 不计）。
        count: this.groupMembershipCount(g.id, currentIds),
      })),
      activeGroupId: this.activeGroupId,
      groupMembership: this.groupMembership,
      workspaceDirectory: this.workspaces
        .filter((w) => w.workspaceId !== UNGROUPED_WORKSPACE_ID)
        .map((w) => ({ workspaceId: w.workspaceId, label: w.label })),
    }
  }

  /** 选中分组下的可见 workspace（null = 全部，原样返回）。 */
  private filteredWorkspaces(): WorkspaceNodeModel[] {
    const groupId = this.activeGroupId
    if (groupId === null) return this.workspaces
    return this.workspaces.filter(
      (w) =>
        w.workspaceId !== UNGROUPED_WORKSPACE_ID &&
        (this.groupMembership[w.workspaceId] ?? []).includes(groupId),
    )
  }

  /** 某组的归组计数（只数当前基线里存在的 workspace）。 */
  private groupMembershipCount(groupId: string, currentIds: ReadonlySet<string>): number {
    return groupMembershipCount(this.groupMembership, groupId, currentIds)
  }

  /* ---- 工作区分组（客户端状态，globalState 持久化） ---- */

  private persistGroups(): void {
    void this.globalState?.update(GROUPS_STATE_KEY, this.groups)
  }

  private persistMembership(): void {
    void this.globalState?.update(GROUP_MEMBERSHIP_STATE_KEY, this.groupMembership)
  }

  private persistActiveGroup(): void {
    void this.globalState?.update(ACTIVE_GROUP_STATE_KEY, this.activeGroupId)
  }

  /** 新建分组：名称 trim 后非空且不重名；成功返回组定义，失败返回 null。
   *  webview 已做同款校验（空名/重名在输入处给出提示），这里兜底防竞态。 */
  createGroup(name: string): GroupDef | null {
    if (groupNameError(name, this.groups) !== null) return null
    const group: GroupDef = { id: `g-${randomUUID()}`, name: name.trim() }
    this.groups = [...this.groups, group]
    this.persistGroups()
    this.onDidChangeEmitter.fire()
    return group
  }

  /** 重命名分组（同名校验同 createGroup，排除自身）；无变化返回 true。 */
  renameGroup(groupId: string, name: string): boolean {
    if (!this.groups.some((g) => g.id === groupId)) return false
    if (groupNameError(name, this.groups, groupId) !== null) return false
    const trimmed = name.trim()
    if (this.groups.find((g) => g.id === groupId)!.name === trimmed) return true
    this.groups = this.groups.map((g) => (g.id === groupId ? { ...g, name: trimmed } : g))
    this.persistGroups()
    this.onDidChangeEmitter.fire()
    return true
  }

  /** 删除分组：组定义移除、归属清理；若删的是当前选中组，回落「全部工作区」。 */
  deleteGroup(groupId: string): void {
    if (!this.groups.some((g) => g.id === groupId)) return
    this.groups = this.groups.filter((g) => g.id !== groupId)
    this.persistGroups()
    const nextMembership = removeGroupId(this.groupMembership, groupId)
    if (nextMembership !== this.groupMembership) {
      this.groupMembership = nextMembership
      this.persistMembership()
    }
    if (this.activeGroupId === groupId) {
      this.activeGroupId = null
      this.persistActiveGroup()
    }
    this.onDidChangeEmitter.fire()
  }

  /** 设置一个 workspace 的分组归属（多对多全量替换，幂等；未知组 id 剔除）。 */
  setGroupMembership(workspaceId: string, groupIds: readonly string[]): void {
    const known = new Set(this.groups.map((g) => g.id))
    const next = setWorkspaceGroupIds(this.groupMembership, workspaceId, groupIds, known)
    if (next === null) return
    this.groupMembership = next
    this.persistMembership()
    this.onDidChangeEmitter.fire()
  }

  /** 切换当前选中分组（null = 全部工作区）；未知组 id 忽略（等价未选中）。 */
  setActiveGroup(groupId: string | null): void {
    const next = groupId !== null && this.groups.some((g) => g.id === groupId) ? groupId : null
    if (next === this.activeGroupId) return
    this.activeGroupId = next
    this.persistActiveGroup()
    this.onDidChangeEmitter.fire()
  }

  /** 持久化分组顺序（管理视图拖拽后提交全量顺序；缺失/未知 id 丢弃）。 */
  reorderGroups(groupIds: readonly string[]): void {
    const next = reorderGroups(this.groups, groupIds)
    if (next === null) return
    this.groups = next
    this.persistGroups()
    this.onDidChangeEmitter.fire()
  }

  /** Pin/unpin a session (client-side only); persists across reloads. */
  setPinned(sessionId: string, pin: boolean): void {
    const idx = this.pinned.indexOf(sessionId)
    if (pin) {
      // 置顶 = 绝对优先：新置顶放组内最前；已置顶的也移到最前（若其已是最前
      // 则无变化）。取消后再置顶同样跳到最前。
      if (idx === 0) return
      if (idx !== -1) this.pinned.splice(idx, 1)
      this.pinned.unshift(sessionId)
    } else {
      if (idx === -1) return
      this.pinned.splice(idx, 1)
    }
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

  /** 移入回收站（可逆本地操作，不碰 dsh）；幂等。 */
  moveToRecycleBin(sessionId: string): void {
    if (this.recycleBin.includes(sessionId)) return
    this.recycleBin.push(sessionId)
    void this.state?.update(RECYCLE_BIN_STATE_KEY, [...this.recycleBin])
    this.rebuildModel()
    this.onDidChangeEmitter.fire()
  }

  /** 批量移入回收站（多选操作条；单次持久化写入 + 一次通知）。 */
  moveToRecycleBinMany(sessionIds: readonly string[]): void {
    const next = [...this.recycleBin]
    let changed = false
    for (const id of sessionIds) {
      if (!next.includes(id)) {
        next.push(id)
        changed = true
      }
    }
    if (!changed) return
    this.recycleBin = next
    void this.state?.update(RECYCLE_BIN_STATE_KEY, [...next])
    this.rebuildModel()
    this.onDidChangeEmitter.fire()
  }

  /** 从回收站恢复单个会话（回原 workspace 组）；幂等。 */
  restoreFromRecycleBin(sessionId: string): void {
    const idx = this.recycleBin.indexOf(sessionId)
    if (idx === -1) return
    this.recycleBin.splice(idx, 1)
    void this.state?.update(RECYCLE_BIN_STATE_KEY, [...this.recycleBin])
    this.rebuildModel()
    this.onDidChangeEmitter.fire()
  }

  /** 恢复全部（视图头部按钮）；空集合时无操作。 */
  restoreAllFromRecycleBin(): void {
    if (this.recycleBin.length === 0) return
    this.recycleBin = []
    void this.state?.update(RECYCLE_BIN_STATE_KEY, [])
    this.rebuildModel()
    this.onDidChangeEmitter.fire()
  }

  /**
   * 归档成功后的回收站清理（host 命令层调用）：从本地集合移除已归档 id——
   * 归档即终点，回收站会话只剩「恢复」与「归档」两条去路。非回收站 id 幂等无操作。
   */
  clearRecycleBinIds(ids: readonly string[]): void {
    if (ids.length === 0) return
    const next = this.recycleBin.filter((id) => !ids.includes(id))
    if (next.length === this.recycleBin.length) return
    this.recycleBin = next
    void this.state?.update(RECYCLE_BIN_STATE_KEY, [...next])
    this.rebuildModel()
    this.onDidChangeEmitter.fire()
  }

  /** 回收站视图的组折叠（独立于主列表 collapsed，互不影响，各自持久化）。 */
  setRecycleCollapsed(workspaceId: string, collapse: boolean): void {
    const changed = collapse ? !this.recycleCollapsed.has(workspaceId) : this.recycleCollapsed.delete(workspaceId)
    if (collapse) this.recycleCollapsed.add(workspaceId)
    if (!changed) return
    void this.state?.update(RECYCLE_COLLAPSED_STATE_KEY, [...this.recycleCollapsed])
    this.onDidChangeEmitter.fire()
  }

  /**
   * Chat view 打开/关闭 tab 时同步已打开会话集合：已打开的会话不打完成标记
   * （官方语义：当前选中的会话不标），且打开即清除其已有标记。
   */
  setAttachedSessions(sessionIds: Iterable<string>): void {
    const next = new Set(sessionIds)
    this.attachedIds = next
    let changed = false
    for (const id of next) {
      if (this.completed.delete(id)) changed = true
    }
    if (changed) {
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
   * 「未分组」虚拟组参与统一折叠（与普通组一致）。
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
    // 每次 setQuery 先同步清算：清空内容命中 + 递增代际（废弃在途搜索），
    // 再即时 rebuild（标题/ID 命中），最后异步补内容搜索。
    this.searchGeneration += 1
    this.contentHits = new Map()
    this.contentSearchHasMore = false
    this.contentSearchError = false
    this.rebuildModel()
    this.onDidChangeEmitter.fire()
    void this.runContentSearch()
  }

  /**
   * 内容全文搜索（session.search，索引 user/assistant 消息）。
   * 降级：后端未挂索引/失败时回退为仅有标题/ID 匹配（已同步 rebuild 过），
   * 记录日志并置 contentSearchError=true（面板显示「仅按标题匹配」轻提示）；
   * 竞态：只接受当前代际的响应。
   */
  private async runContentSearch(): Promise<void> {
    const url = this.runningUrl
    const q = this.query
    if (!url || !q) return
    const generation = this.searchGeneration
    const query = q.length > 500 ? q.slice(0, 500) : q
    try {
      const result = await searchSessions(url, query)
      if (this.disposed || generation !== this.searchGeneration) return
      const hits = new Map<string, string>()
      for (const item of result.items) {
        if (item && typeof item.sessionId === 'string' && item.sessionId) {
          hits.set(item.sessionId, item.snippet ?? '')
        }
      }
      this.contentHits = hits
      this.contentSearchHasMore = result.hasMore === true
      this.contentSearchError = false
    } catch (err) {
      if (this.disposed || generation !== this.searchGeneration) return
      this.logger.warn(
        `sessions store: session.search(${JSON.stringify(query)}) failed — ${err instanceof Error ? err.message : err}`,
      )
      this.contentHits = new Map()
      this.contentSearchHasMore = false
      this.contentSearchError = true
    }
    this.rebuildModel()
    this.onDidChangeEmitter.fire()
  }

  private onStateChange(status: ServerStatus): void {
    const url = status.state === 'running' && status.url ? status.url : null
    if (url === this.url) return
    this.url = url
    // 订阅代际切换：旧代的重连状态作废，等新连接自行复位。
    this.reconnectAttempts = 0
    // 代际切换后旧基线不可信（服务可能已重启），等 refresh() 成功再就绪。
    this.baselineReady = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.hostEvents?.dispose()
    this.hostEvents = null
    this.pendingHostFrames = []
    this.refreshInFlight = false
    this.mux?.dispose()
    this.mux = null
    if (this.pendingInteractions.size > 0) {
      // 连接代际切换：旧代的 pending 状态不可信，清掉靠新连接的 mux 重放恢复。
      this.pendingInteractions = new Map()
    }
    if (this.tickTimer) {
      clearInterval(this.tickTimer)
      this.tickTimer = null
    }
    if (url) {
      if (isModern(url)) {
        // 0.1.2：$events 流（api-session/* 触发刷新 + approval/question
        // 水瀑布）+ workspace/follow 流（workspace 与 archived 的基线/增量）。
        this.hostEvents = subscribeModernEvents(url, this.logger, {
          onEvent: (event) => this.onModernEvent(event),
          onRequest: (request) => this.onModernRequest(request),
          onCancel: (eventId) => this.onModernCancel(eventId),
          onClose: () => {
            if (this.pendingInteractions.size === 0) return
            this.pendingInteractions = new Map()
            this.rebuildModel()
            this.onDidChangeEmitter.fire()
          },
        })
        this.mux = subscribeWorkspaceStream(url, this.logger, (frame) => this.onWorkspaceFrame(frame))
      } else {
        this.hostEvents = subscribeHostEvents(
          url,
          this.logger,
          (method, payload) => this.onHostFrame(method, payload),
          () => this.onHostClose(url),
        )
        // 全局 mux 下行：approval/question 的 requested/resolved 帧喂
        // pendingInteractions（官方 web 侧栏黄点的同一数据源）。此订阅不重连：
        // pending 是瞬时态，断流即清、不补恢复（黄点随下一次订阅代际由 host
        // 重放回来），避免断流盲区里的过期状态滞留。
        this.mux = subscribeMuxEvents(url, this.logger, (frame) => this.onMuxFrame(frame), () => {
          if (this.pendingInteractions.size === 0) return
          this.pendingInteractions = new Map()
          this.rebuildModel()
          this.onDidChangeEmitter.fire()
        })
      }
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
      // 回收站集合是本地状态（保留不丢）；视图模型是基线的投影——服务停了
      // 它就没有意义，清掉等下次基线刷新再重建（计数不应显示陈旧值）。
      this.recycleWorkspaces = []
      this.onDidChangeEmitter.fire()
    }
  }

  /**
   * Host 帧入口：解析后逐帧增量应用到缓存基线（对齐官方 host 帧的增量
   * 语义，见 src/pure/hostFrames.ts）。全量重拉只保留给基线场景：服务状态
   * 变化、手动刷新、host 流重连、聊天侧标题变化（title 走 mux 投影，host
   * 流没有对应帧）。
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

  /** 0.1.2 $events 的 emit 帧：api-session/* 语义 = 列表状态变了，重拉基线。 */
  private onModernEvent(event: string): void {
    if (
      event === 'api-session/added' ||
      event === 'api-session/removed' ||
      event === 'api-session/status' ||
      event === 'api-session/activity' ||
      event === 'api-session/error'
    ) {
      this.refreshSoon()
    }
  }

  /** 0.1.2 $events 水瀑布帧 → 侧栏 pending 黄点（复用旧 mux 帧的跟踪键）。 */
  private onModernRequest(request: {
    eventId: string
    agentId: string
    event: string
    req: Record<string, unknown>
  }): void {
    let changed = false
    let pendingChanged = false
    if (request.event === 'approval/request') {
      changed = this.trackPending(request.agentId, `a:${request.eventId}`, 'approval')
      pendingChanged = changed
    } else if (request.event === 'user-questions/request') {
      const questions = Array.isArray(request.req.questions)
        ? (request.req.questions as PendingQuestion['questions'])
        : []
      changed = this.trackPending(request.agentId, `q:${request.eventId}`, questionInteractionStatus(questions))
      pendingChanged = changed
    }
    if (!changed) return
    this.rebuildModel()
    this.onDidChangeEmitter.fire()
    if (pendingChanged) this.refreshSoon()
  }

  /** 0.1.2 宿主取消水瀑布（答复后由回答方本地清除）。 */
  private onModernCancel(eventId: string): void {
    let changed = false
    for (const [sessionId, interactions] of [...this.pendingInteractions]) {
      if (interactions.delete(`a:${eventId}`) || interactions.delete(`q:${eventId}`)) {
        if (interactions.size === 0) this.pendingInteractions.delete(sessionId)
        changed = true
      }
    }
    if (!changed) return
    this.rebuildModel()
    this.onDidChangeEmitter.fire()
  }

  /** 0.1.2 workspace/follow 帧 → 更新工作区与 archived 基线后重建模型。 */
  private onWorkspaceFrame(
    frame: NonNullable<ReturnType<typeof parseWorkspaceStreamFrame>>,
  ): void {
    switch (frame.type) {
      case 'baseline': {
        this.rawWorkspaces = (frame.items as WorkspaceInput[]).filter(
          (w) => typeof w?.workspaceId === 'string',
        )
        this.rawArchived = new Set(frame.archivedSessionIds)
        break
      }
      case 'upsert': {
        const workspace = frame.workspace as unknown as WorkspaceInput
        const index = this.rawWorkspaces.findIndex((w) => w.workspaceId === workspace.workspaceId)
        this.rawWorkspaces =
          index === -1
            ? [...this.rawWorkspaces, workspace]
            : this.rawWorkspaces.map((w, i) => (i === index ? workspace : w))
        break
      }
      case 'remove':
        this.rawWorkspaces = this.rawWorkspaces.filter((w) => w.workspaceId !== frame.workspaceId)
        break
      case 'order': {
        const byId = new Map(this.rawWorkspaces.map((w) => [w.workspaceId, w]))
        this.rawWorkspaces = frame.workspaceIds
          .map((id) => byId.get(id))
          .filter((w): w is WorkspaceInput => w !== undefined)
        break
      }
      case 'archived':
        this.rawArchived = new Set(frame.archivedSessionIds)
        break
      default:
        return
    }
    this.knownSessionIds = new Set(
      this.rawSessions.map((s) => s.sessionId).filter((id) => !this.rawArchived.has(id)),
    )
    this.rebuildModel()
    this.onDidChangeEmitter.fire()
  }

  /**
   * Host 事件流断开（host 重启、热重载、网络抖动、休眠唤醒）。流不重放，
   * 断流盲区里的增量帧无法补发，重连后必须重拉基线再增量。1s 翻倍退避
   * （上限 RECONNECT_MAX_MS）；refresh() 成功即视为恢复、重置退避。
   */
  private onHostClose(url: string): void {
    if (this.disposed) return
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, RECONNECT_MAX_MS)
    this.reconnectAttempts += 1
    this.logger.warn(`sessions store: host events stream closed; reconnecting in ${delay}ms`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.disposed || this.url !== url) return
      this.hostEvents?.dispose()
      this.hostEvents = subscribeHostEvents(
        url,
        this.logger,
        (method, payload) => this.onHostFrame(method, payload),
        () => this.onHostClose(url),
      )
      // 以全量基线为准，重新开始增量（拉取期间到达的帧由 refresh 缓冲重放）。
      void this.refresh()
    }, delay)
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
    if (frame.type === 'host/session-status') {
      this.noteRunningFlip(frame.sessionId, prevRunning, frame.running)
      // 排序键 updatedAt 在 host/session-status 帧里不更新（见 hostFrames 注释），
      // 但 running 实际翻转（开始/完成）时服务端往往更新了它——增量路径主动追平
      // 一次基线。仅"实际翻转"触发（prev 有定义且值变化）；refresh() 内部的全量
      // 对比也调 noteRunningFlip，那里不触发（prev 已是最新、不再翻转），防递归。
      if (prevRunning !== undefined && prevRunning !== frame.running) this.refreshSoon()
    }
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
    else if (prev === true && !this.attachedIds.has(sessionId)) this.completed.add(sessionId)
  }

  /**
   * 全局 mux 帧入口：approval/question 的 requested/resolved 喂
   * pendingInteractions，session/projection 的 title 帧实时更新基线标题
   * （子代理自动命名不再等下一次基线重拉——host 事件流没有标题帧，标题
   * 只走这条投影推送）。与 chatSession 的单会话过滤不同，这里按帧自带
   * sessionId 分桶跟踪所有会话——官方侧栏黄点对未实例化的会话也要亮，
   * 靠的就是这条全局流。
   */
  private onMuxFrame(frame: MuxFrame): void {
    const payload = (frame.payload ?? {}) as Record<string, unknown>
    const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : null
    if (!sessionId) return
    let changed = false
    let pendingChanged = false
    switch (frame.method) {
      case 'session/projection': {
        if (payload.key !== 'title' || typeof payload.seq !== 'number') return
        const existing = this.rawSessions.find((s) => s.sessionId === sessionId)
        if (!existing) return
        if (payload.seq <= (this.titleSeqs.get(sessionId) ?? -1)) return
        this.titleSeqs.set(sessionId, payload.seq)
        const title = typeof payload.value === 'string' && payload.value.length > 0 ? payload.value : null
        if (existing.title === title) return
        this.rawSessions = this.rawSessions.map((s) => (s.sessionId === sessionId ? { ...s, title } : s))
        changed = true
        break
      }
      case 'approval/requested':
        if (payload.approvalId !== undefined) {
          changed = this.trackPending(sessionId, `a:${String(payload.approvalId)}`, 'approval')
          pendingChanged = changed
        }
        break
      case 'approval/resolved':
        if (payload.approvalId !== undefined) {
          changed = this.resolvePending(sessionId, `a:${String(payload.approvalId)}`)
          pendingChanged = changed
        }
        break
      case 'question/requested': {
        if (typeof frame.rpcId !== 'string') return
        const questions = Array.isArray(payload.questions)
          ? (payload.questions as PendingQuestion['questions'])
          : []
        changed = this.trackPending(sessionId, `q:${frame.rpcId}`, questionInteractionStatus(questions))
        pendingChanged = changed
        break
      }
      case 'question/resolved':
        if (typeof payload.questionRpcId === 'string') {
          changed = this.resolvePending(sessionId, `q:${payload.questionRpcId}`)
          pendingChanged = changed
        }
        break
      default:
        return
    }
    if (!changed) return
    this.rebuildModel()
    this.onDidChangeEmitter.fire()
    // 待交互状态翻转（approval/question 请求/解决）时刻服务端很可能也更新了
    // updatedAt（排序键）——增量路径主动追平一次基线（去抖合并）。Session/
    // projection 的标题帧不在此列（标题变化由 chatView 的 refresh 兜底）。
    if (pendingChanged) this.refreshSoon()
  }

  /** Add or refresh one stable pending-interaction identity; true on change. */
  private trackPending(sessionId: string, key: string, status: PendingInteraction): boolean {
    let interactions = this.pendingInteractions.get(sessionId)
    if (!interactions) {
      interactions = new Map()
      this.pendingInteractions.set(sessionId, interactions)
    }
    if (interactions.get(key) === status) return false
    interactions.set(key, status)
    return true
  }

  /** Settle one pending-interaction identity; true on change. */
  private resolvePending(sessionId: string, key: string): boolean {
    const interactions = this.pendingInteractions.get(sessionId)
    if (!interactions?.delete(key)) return false
    if (interactions.size === 0) this.pendingInteractions.delete(sessionId)
    return true
  }

  /**
   * 统一去抖的基线重拉入口：低频率事件（发送后 / 窗口聚焦 / 侧栏可见 /
   * 会话状态翻转）常在同一批连发，500ms 内合并成一次 refresh()。
   * 直接调用 refresh() 的既有路径（手动刷新、命令动作后、标题变化等）不受影响。
   * 只在增量路径使用（applyFrame 的 running 翻转 / onMuxFrame 的 pending 变化），
   * refresh() 自身与它内部逻辑绝不调用——避免递归重拉。
   */
  refreshSoon(): void {
    if (this.refreshTimer !== null) return
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null
      void this.refresh()
    }, REFRESH_DEBOUNCE_MS)
  }

  /** Re-fetch the baseline and rebuild the model. Failures only log. */
  async refresh(): Promise<void> {
    const url = this.runningUrl
    if (!url) return
    this.refreshInFlight = true
    try {
      const prevRunning = new Map(this.rawSessions.map((s) => [s.sessionId, s.running]))
      // 0.1.2 没有 workspace.list：workspace/archived 由 workspace/follow 流
      // 维护（onWorkspaceFrame），这里只拉会话列表。
      let sessions: SessionSummary[]
      if (isModern(url)) {
        sessions = await listSessions(url)
      } else {
        const [workspaceList, sessionList] = await Promise.all([listWorkspaces(url), listSessions(url)])
        this.rawWorkspaces = workspaceList.items
        this.rawArchived = new Set(workspaceList.archivedSessionIds)
        sessions = sessionList
      }
      this.rawSessions = sessions.map((s) => toSessionInput(s))
      // 标题投影 seq 水位按基线切点播种：之后的 title 推送帧只认更新的 seq。
      for (const s of sessions) {
        if (typeof s.projections?.asOfSeq === 'number') this.titleSeqs.set(s.sessionId, s.projections.asOfSeq)
      }
      this.knownSessionIds = new Set(
        this.rawSessions.map((s) => s.sessionId).filter((id) => !this.rawArchived.has(id)),
      )
      // 完成标记（官方语义）：首次刷新无旧基线，不会误标——VS Code 没开期间
      // 完成的会话不会有标记，与官方"页面没开期间不记"一致。
      for (const s of this.rawSessions) this.noteRunningFlip(s.sessionId, prevRunning.get(s.sessionId), s.running)
      // 基线重拉成功：host 流已恢复（初始连接/手动刷新时本就是 0，无副作用）。
      this.reconnectAttempts = 0
      this.baselineReady = true
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
    // 展示层合流：手动未读（持久化）与自动完成标记（内存）共用同一绿点，
    // 官方 dsh web 也是同一状态槽位的 done 圆点，视觉等价。
    const unreadDisplay = this.completed.size === 0 ? this.unread : new Set([...this.unread, ...this.completed])
    // 一个会话可能同时挂着多个 pending（如审批+提问）：折叠成单状态时
    // 非 approval 优先（官方同规则——提问/计划评审比审批更需要用户输入）。
    const pendingDisplay = new Map<string, PendingInteraction>()
    for (const [sessionId, interactions] of this.pendingInteractions) {
      const statuses = [...interactions.values()]
      const status = statuses.find((c) => c !== 'approval') ?? statuses[0]
      if (status !== undefined) pendingDisplay.set(sessionId, status)
    }
    // 回收站清账：dsh 侧已归档/已消失的 id 从本地集合剔除（渲染本来就会过滤，
    // 这里把持久化状态也清干净——「下次刷新清理」语义）。
    this.pruneRecycleBin()
    const recycleSet = new Set(this.recycleBin)
    const baseViewOptions = {
      sort: this.sortOrder,
      pinned: this.pinned,
      unread: unreadDisplay,
      pendingInteractions: pendingDisplay,
      // VS Code 的 fsPath 在 Windows 返回小写盘符 + 反斜杠，dsh 服务端的
      // workspace path 可能是不同大小写/正斜杠/尾斜杠——严格全等会漏掉
      // 「vscode」标签（macOS/Linux 大小写敏感，维持严格比较）。
      ...(process.platform === 'win32' ? { pathEqual: windowsPathEqual } : {}),
    }
    this.workspaces = buildSessionTree(
      this.rawWorkspaces,
      this.rawSessions,
      this.rawArchived,
      // 标题在 toSessionInput 里已从 title 投影解析好。
      (s) => s.title ?? null,
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      Date.now(),
      {
        ...baseViewOptions,
        query: this.query ?? undefined,
        contentHits: this.contentHits,
        excludedSessionIds: recycleSet,
      },
      vscode.l10n.t,
    )
    // 回收站视图模型：只保留回收站 id（按原 workspace 分组），不套当前搜索
    // 过滤；空组不渲染（主列表「未分组」组头恒显的语义在回收站不适用）。
    this.recycleWorkspaces = buildSessionTree(
      this.rawWorkspaces,
      this.rawSessions,
      this.rawArchived,
      (s) => s.title ?? null,
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      Date.now(),
      {
        ...baseViewOptions,
        onlySessionIds: recycleSet,
      },
      vscode.l10n.t,
    ).filter((w) => w.sessions.length > 0)
  }

  /**
   * 回收站集合清账：剔除基线已不认识的 id（dsh 侧被归档/删除）。只随
   * rebuildModel 执行——knownSessionIds 只在基线刷新与增量帧后更新，所以
   * 这是「下一次基线刷新时清理」的语义；渲染层（onlySessionIds ∩ 非归档）
   * 在清账之前就已经不显示这些会话。基线未就绪（服务停了/重启后未重拉）时
   * knownSessionIds 为空集合，不得据此清账——否则回收站会被冷启动清空。
   */
  private pruneRecycleBin(): void {
    if (!this.baselineReady) return
    const next = this.recycleBin.filter((id) => this.knownSessionIds.has(id))
    if (next.length === this.recycleBin.length) return
    this.recycleBin = next
    void this.state?.update(RECYCLE_BIN_STATE_KEY, [...next])
  }

  dispose(): void {
    this.disposed = true
    this.stateSub.dispose()
    this.hostEvents?.dispose()
    this.mux?.dispose()
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.tickTimer) clearInterval(this.tickTimer)
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.onDidChangeEmitter.dispose()
  }
}
