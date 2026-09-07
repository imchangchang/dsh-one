import * as vscode from 'vscode'
import { randomUUID } from 'node:crypto'
import type { Logger } from '../log.ts'
import { subscribeHostEvents } from '../server/hostEvents.ts'
import { subscribeMuxEvents } from '../server/muxEvents.ts'
import type { MuxFrame } from '../server/muxEvents.ts'
import { isModern } from '../server/serverAuth.ts'
import { subscribeModernEvents, subscribeWorkspaceStream } from '../server/modernStreams.ts'
import { listSessions, listWorkspaces, searchSessions, sessionAgentPreset, sessionTitle, sessionTotalTokens, sessionCompletedTurns } from '../server/dshRpc.ts'
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
  type WorkspaceInput,
  type WorkspaceNodeModel,
} from '../pure/sessionTree.ts'
import {
  groupMembershipCount,
  groupNameError,
  removeGroupId,
  reorderGroups,
  setWorkspaceGroupIds,
  type WorkspaceGroupDef as GroupDef,
} from '../pure/workspaceGroups.ts'
import { pruneRecycleIds, resolveRecycleIds } from '../pure/recycleBinState.ts'
import {
  emptyCustomTagIds,
  invertSessionTagIds,
  isPresetTag,
  nextCustomColor,
  removeTagFromAll,
  reorderTags as reorderTagsPure,
  sanitizeTags as sanitizeTagsPure,
  setSessionTagId,
  TAG_COLORS,
  tagDisplayName,
  tagNameError,
  type SessionTagDef as TagDef,
  type TagColor,
} from '../pure/sessionTags.ts'
import { DshStateStore } from './dshStateStore.ts'
import {
  mergeGroupDefs,
  mergeIdList,
  mergeMembership,
  migrateTagFileV1ToV2,
  resolveGroupFile,
  resolveIdList,
  resolveTagFile,
  type DraftsFile,
  type TagFileV2,
  type WorkspaceTagState,
} from '../pure/dshStateFile.ts'

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
    // dsh 0.1.2 起 agentPreset 在 projections.values 里（sessionAgentPreset 含顶层回退）。
    ...(sessionAgentPreset(s) !== undefined ? { agentPreset: sessionAgentPreset(s) } : {}),
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

/* ---- UI 展示偏好：留在 Memento，不进 dsh 目录（条目拍板） ---- */
/** workspaceState key for collapsed workspaces（UI-only；dsh 无此概念）. */
const COLLAPSED_STATE_KEY = 'sessions.collapsed'
/** globalState key for recycle view collapsed workspaces（与主列表折叠互不影响；
 *  v1 同名 key 存 workspaceState，构造器里做一次性 Memento→Memento 迁移）。 */
const RECYCLE_COLLAPSED_STATE_KEY = 'sessions.recycleCollapsed'

/* ---- 旧版 Memento key：本版本起这五组状态迁到 ~/.dsh/dsh-one/ 文件（权威存储，
 *  跨窗口/重启共享），下列 key 只在 create() 迁移时回读，迁移成功后删除
 *  （防陈旧态复活）。pinned/unread 旧值在 workspaceState（per-workspace），
 *  迁文件后语义变为跨窗口全局共享（条目已拍板）。 ---- */
/** recycleBin 旧 key：v2 在 globalState，v1 同名 key 在 workspaceState（迁移链两级都查）。 */
const LEGACY_RECYCLE_BIN_KEY = 'sessions.recycleBin'
const LEGACY_GROUPS_KEY = 'sessions.groups'
const LEGACY_GROUP_MEMBERSHIP_KEY = 'sessions.groupMembership'
const LEGACY_ACTIVE_GROUP_KEY = 'sessions.activeGroup'
const LEGACY_TAGS_KEY = 'sessions.tags'
const LEGACY_SESSION_TAGS_KEY = 'sessions.sessionTags'
const LEGACY_PINNED_KEY = 'sessions.pinned'
const LEGACY_UNREAD_KEY = 'sessions.unread'

/** 迁移落定后删旧 Memento key（update(key, undefined) = 删除；fire-and-forget）。 */
function deleteLegacyKeys(memento: vscode.Memento, keys: readonly string[]): void {
  for (const key of keys) void memento.update(key, undefined)
}


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
  /** 会话标签组（有序；预设组名已按当前 locale 翻译；count = 当前基线中打组的会话数）。 */
  tags: Array<{ workspaceId: string; id: string; name: string; color: TagColor; preset: boolean; count: number }>
  /** 标签组 → 会话 id（单组倒排，全量未清洗；整组批量操作（归档/回收站）按此收集全集）。 */
  tagSessionIds: Record<string, string[]>
  /** 折叠的标签组块 id（per-workspace：wsId → 折叠的 tagId 列表；UI 偏好）。 */
  tagCollapsed: Record<string, string[]>
}

/**
 * create() 解析出的五组文件权威状态（已含旧 Memento 迁移结果），构造器直接采用。
 */
export interface SessionsBootstrap {
  recycleBin: string[]
  pinned: string[]
  unread: string[]
  groups: GroupDef[]
  groupMembership: Record<string, string[]>
  activeGroupId: string | null
  /** per-workspace 标签组（v2）：wsId → 组定义/归属/折叠。权威时直接采用。 */
  tags: Record<string, WorkspaceTagState>
  /**
   * v1 全局标签组（待迁移）。文件仍是 v1 全局模型时创建（此时基线未到无法拆桶），
   * 等第一次基线就绪后按 sessionId→workspace 拆分（见 migratePendingV1ToV2）。
   * null = 无待迁移数据（v2 权威，或全新安装）。
   */
  pendingV1: { tags: TagDef[]; sessionTags: Record<string, string> } | null
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
  /** Last fetched baseline, kept so search/filter rebuild locally without RPC. */
  private rawWorkspaces: WorkspaceInput[] = []
  private rawSessions: SessionInput[] = []
  private rawArchived: ReadonlySet<string> = new Set()
  private query: string | null = null
  /** 置顶会话 id（保持置顶顺序：数组越靠前置顶越早/越优先；dsh 无置顶 API，
   *  纯客户端状态，~/.dsh/dsh-one/pinned.json 持久化）。 */
  private pinned: string[] = []
  private collapsed = new Set<string>()
  private unread = new Set<string>()
  /** 回收站会话 id（与 pinned 同为纯客户端态：移入/恢复只改本地集合，不碰 dsh；
   *  recycle-bin.json 持久化）。 */
  private recycleBin: string[] = []
  /** 回收站视图的折叠组（独立于主列表 collapsed，互不影响；Memento UI 偏好）。 */
  private recycleCollapsed = new Set<string>()
  /** 工作区分组定义（groups.json 持久化；数组顺序 = 展示顺序）。 */
  private groups: GroupDef[] = []
  /** workspaceId → 组 id 列表（多对多，groups.json 持久化）。 */
  private groupMembership: Record<string, string[]> = {}
  /** 当前选中的分组 id；null = 全部工作区（groups.json 持久化）。 */
  private activeGroupId: string | null = null
  /** 会话标签组（per-workspace，v2）：wsId → 组定义/归属/折叠。 */
  private wsTags: Record<string, WorkspaceTagState> = {}
  /**
   * v1 全局标签组（待基线迁移）。null = 无待迁移数据。见 SessionsBootstrap.pendingV1。
   */
  private pendingV1: { tags: TagDef[]; sessionTags: Record<string, string> } | null = null
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
  /** 目录监视退订（create 接线；dispose 时调用）。 */
  private unwatchFiles: (() => void) | null = null
  private readonly stateSub: vscode.Disposable
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>()
  /** Fired after every model rebuild (refresh, filter, query, server down). */
  readonly onDidChange = this.onDidChangeEmitter.event

  constructor(
    private readonly manager: ServerManager,
    private readonly logger: Logger,
    private readonly state: vscode.Memento,
    private readonly globalState: vscode.Memento,
    /** ~/.dsh/dsh-one/ 文件 IO（五组客户端状态的权威存储）；UI 偏好仍走 Memento。 */
    private readonly io: DshStateStore,
    bootstrap: SessionsBootstrap,
  ) {
    // UI 展示偏好（Memento，不搬）：折叠、回收站折叠、标签组折叠。（排序已移除）
    this.collapsed = new Set(state.get<string[]>(COLLAPSED_STATE_KEY) ?? [])
    // 清掉历史版本可能残留的「未分组」折叠键（虚拟组恒展开，不应进集合）。
    this.collapsed.delete(UNGROUPED_WORKSPACE_ID)
    // 回收站折叠的 v1→v2（workspaceState→globalState，Memento 内部迁移，原样保留）。
    const recycledCollapsed = resolveRecycleIds(
      globalState.get(RECYCLE_COLLAPSED_STATE_KEY),
      state.get(RECYCLE_COLLAPSED_STATE_KEY),
    )
    this.recycleCollapsed = new Set(recycledCollapsed.ids)
    if (recycledCollapsed.fromLegacy) {
      void this.globalState.update(RECYCLE_COLLAPSED_STATE_KEY, [...recycledCollapsed.ids])
    }
    void state.update(RECYCLE_COLLAPSED_STATE_KEY, undefined)
    this.recycleCollapsed.delete(UNGROUPED_WORKSPACE_ID)
    // 文件权威的五组状态：create 已完成读盘与旧 Memento 迁移，这里直接采用。
    // 标签组折叠状态已随 v2 迁进文件（per-workspace），不再走 Memento。
    this.recycleBin = [...bootstrap.recycleBin]
    this.pinned = [...bootstrap.pinned]
    this.unread = new Set(bootstrap.unread)
    this.groups = bootstrap.groups
    this.groupMembership = bootstrap.groupMembership
    this.activeGroupId = bootstrap.activeGroupId
    this.wsTags = bootstrap.tags
    this.pendingV1 = bootstrap.pendingV1
    this.stateSub = manager.onDidChangeState((status) => this.onStateChange(status))
    this.onStateChange(manager.getStatus())
  }

  /**
   * 异步构造入口（extension activate 里 await）：读 ~/.dsh/dsh-one/ 全部模块 →
   * 文件缺失的模块从旧 Memento 一次性迁移（字段级合并写盘；写成功后删旧 key
   * 防陈旧态复活，写失败保留旧 key 下次启动重试）→ 建 store → watch 目录
   * （派生脚本/其它窗口写文件后热重载）。dir 仅测试用（覆盖默认目录）。
   */
  static async create(
    manager: ServerManager,
    logger: Logger,
    state: vscode.Memento,
    globalState: vscode.Memento,
    dir?: string,
  ): Promise<SessionsStore> {
    const io = new DshStateStore({ ...(dir !== undefined ? { dir } : {}), log: logger })
    const snap = await io.load()
    const warn = (what: string): void =>
      logger.warn(`sessions store: migrate ${what} to ${io.dir} failed; legacy Memento keys kept for next launch`)
    // 迁移/权威决策逐模块记 info——新旧版本切换的现场基本无法复现，只能靠日志定位。
    const note = (msg: string): void => logger.info(`sessions store: ${msg}`)
    note(`client-state dir: ${io.dir}`)

    // 回收站：文件权威；缺失时走 globalState(v2) → workspaceState(v1) 两级旧链。
    let recycleBin: string[]
    if (snap.recycleBin !== null) {
      recycleBin = snap.recycleBin.sessionIds
      deleteLegacyKeys(globalState, [LEGACY_RECYCLE_BIN_KEY])
      deleteLegacyKeys(state, [LEGACY_RECYCLE_BIN_KEY])
      note(`client-state[recycle-bin]: file authoritative (${recycleBin.length} ids); any legacy Memento keys cleared`)
    } else {
      const legacy = resolveRecycleIds(globalState.get(LEGACY_RECYCLE_BIN_KEY), state.get(LEGACY_RECYCLE_BIN_KEY))
      recycleBin = legacy.ids
      if (legacy.ids.length > 0) {
        const ids = legacy.ids
        // 合并而非覆盖：另一 user-data 的窗口可能同时在做自己的迁移。
        const ok = await io.updateRecycleBin((prev) => mergeIdList(prev, ids))
        if (!ok) warn('recycle-bin')
        else {
          deleteLegacyKeys(globalState, [LEGACY_RECYCLE_BIN_KEY])
          deleteLegacyKeys(state, [LEGACY_RECYCLE_BIN_KEY])
          note(`client-state[recycle-bin]: migrated ${ids.length} ids from legacy Memento to file; legacy keys deleted`)
        }
      } else {
        deleteLegacyKeys(globalState, [LEGACY_RECYCLE_BIN_KEY])
        deleteLegacyKeys(state, [LEGACY_RECYCLE_BIN_KEY])
        note('client-state[recycle-bin]: no file, no legacy data — fresh start')
      }
    }

    // 工作区分组三件套（定义/归属/选中组）：旧值全在 globalState。
    let groups: GroupDef[]
    let groupMembership: Record<string, string[]>
    let activeGroupId: string | null
    if (snap.groups !== null) {
      groups = snap.groups.groups
      groupMembership = snap.groups.membership
      activeGroupId = snap.groups.activeGroupId
      deleteLegacyKeys(globalState, [LEGACY_GROUPS_KEY, LEGACY_GROUP_MEMBERSHIP_KEY, LEGACY_ACTIVE_GROUP_KEY])
      note(
        `client-state[groups]: file authoritative (${groups.length} defs, ${Object.keys(groupMembership).length} workspaces, active=${activeGroupId}); any legacy Memento keys cleared`,
      )
    } else {
      const legacy = resolveGroupFile(
        null,
        globalState.get(LEGACY_GROUPS_KEY),
        globalState.get(LEGACY_GROUP_MEMBERSHIP_KEY),
        globalState.get(LEGACY_ACTIVE_GROUP_KEY),
      )
      groups = legacy.value.groups
      groupMembership = legacy.value.membership
      activeGroupId = legacy.value.activeGroupId
      const hasData =
        legacy.value.groups.length > 0 ||
        Object.keys(legacy.value.membership).length > 0 ||
        legacy.value.activeGroupId !== null
      if (legacy.fromLegacy && hasData) {
        const value = legacy.value
        const ok = await io.updateGroups((prev) => ({
          ...prev,
          groups: mergeGroupDefs(prev.groups, value.groups),
          membership: mergeMembership(prev.membership, value.membership),
          activeGroupId: prev.activeGroupId ?? value.activeGroupId,
        }))
        if (!ok) warn('groups')
        else {
          deleteLegacyKeys(globalState, [LEGACY_GROUPS_KEY, LEGACY_GROUP_MEMBERSHIP_KEY, LEGACY_ACTIVE_GROUP_KEY])
          note(
            `client-state[groups]: migrated from legacy Memento to file (${value.groups.length} defs, ${Object.keys(value.membership).length} workspaces, active=${value.activeGroupId}); legacy keys deleted`,
          )
        }
      } else {
        deleteLegacyKeys(globalState, [LEGACY_GROUPS_KEY, LEGACY_GROUP_MEMBERSHIP_KEY, LEGACY_ACTIVE_GROUP_KEY])
        note('client-state[groups]: no file, no legacy data — fresh start')
      }
    }

    // 会话标签组（per-workspace，v2）：文件权威采用 v2；v1 全局模型（无论来自
    // 文件还是旧 Memento）不在此处拆桶——缺 sessionId→workspace 映射，只能等
    // 基线就绪后迁移（记 pendingV1，见 migratePendingV1ToV2）。
    let tags: Record<string, WorkspaceTagState>
    let pendingV1: { tags: TagDef[]; sessionTags: Record<string, string> } | null = null
    if (snap.tags !== null && snap.tags.version === 2) {
      tags = snap.tags.workspaces
      deleteLegacyKeys(globalState, [LEGACY_TAGS_KEY, LEGACY_SESSION_TAGS_KEY])
      note(
        `client-state[tags]: file authoritative v2 (${Object.keys(tags).length} workspaces); any legacy Memento keys cleared`,
      )
    } else if (snap.tags !== null && snap.tags.version === 1) {
      // 文件是 v1 全局模型：暂存待迁移。文件本身是数据的持久副本，保留，下次
      // 启动仍可重读；Memento 里若有重复旧值此时已冗余，可清。
      tags = {}
      pendingV1 = { tags: snap.tags.tags, sessionTags: snap.tags.sessionTags }
      deleteLegacyKeys(globalState, [LEGACY_TAGS_KEY, LEGACY_SESSION_TAGS_KEY])
      note(
        `client-state[tags]: file is v1 legacy (${pendingV1.tags.length} defs, ${Object.keys(pendingV1.sessionTags).length} assignments) — pending baseline-driven migration`,
      )
    } else {
      const legacy = resolveTagFile(null, globalState.get(LEGACY_TAGS_KEY), globalState.get(LEGACY_SESSION_TAGS_KEY))
      if (legacy.fromLegacy) {
        // 旧 Memento 是唯一持久副本：暂存待迁移，但**不删 Memento key、不写文件**
        // ——迁移成功（写 v2 + 删 key）前绝不能丢。restart 时 Memento 仍可重读。
        pendingV1 = { tags: legacy.value.tags, sessionTags: legacy.value.sessionTags }
        note(
          `client-state[tags]: legacy Memento v1 pending (${pendingV1.tags.length} defs, ${Object.keys(pendingV1.sessionTags).length} assignments) — baseline-driven migration; legacy keys kept until it succeeds`,
        )
      } else {
        note('client-state[tags]: no file, no legacy data — fresh start')
      }
      tags = {}
    }

    // pinned/unread：旧值在 workspaceState（per-workspace），迁文件后全局共享。
    let pinned: string[]
    if (snap.pinned !== null) {
      pinned = snap.pinned.sessionIds
      deleteLegacyKeys(state, [LEGACY_PINNED_KEY])
      note(`client-state[pinned]: file authoritative (${pinned.length} ids); any legacy Memento keys cleared`)
    } else {
      const legacy = resolveIdList(null, state.get(LEGACY_PINNED_KEY))
      pinned = legacy.value
      if (legacy.value.length > 0) {
        const ids = legacy.value
        const ok = await io.updatePinned((prev) => mergeIdList(prev, ids))
        if (!ok) warn('pinned')
        else {
          deleteLegacyKeys(state, [LEGACY_PINNED_KEY])
          note(`client-state[pinned]: migrated ${ids.length} ids from legacy Memento to file; legacy keys deleted`)
        }
      } else {
        deleteLegacyKeys(state, [LEGACY_PINNED_KEY])
        note('client-state[pinned]: no file, no legacy data — fresh start')
      }
    }
    let unread: string[]
    if (snap.unread !== null) {
      unread = snap.unread.sessionIds
      deleteLegacyKeys(state, [LEGACY_UNREAD_KEY])
      note(`client-state[unread]: file authoritative (${unread.length} ids); any legacy Memento keys cleared`)
    } else {
      const legacy = resolveIdList(null, state.get(LEGACY_UNREAD_KEY))
      unread = legacy.value
      if (legacy.value.length > 0) {
        const ids = legacy.value
        const ok = await io.updateUnread((prev) => mergeIdList(prev, ids))
        if (!ok) warn('unread')
        else {
          deleteLegacyKeys(state, [LEGACY_UNREAD_KEY])
          note(`client-state[unread]: migrated ${ids.length} ids from legacy Memento to file; legacy keys deleted`)
        }
      } else {
        deleteLegacyKeys(state, [LEGACY_UNREAD_KEY])
        note('client-state[unread]: no file, no legacy data — fresh start')
      }
    }

    const store = new SessionsStore(manager, logger, state, globalState, io, {
      recycleBin,
      pinned,
      unread,
      groups,
      groupMembership,
      activeGroupId,
      tags,
      pendingV1,
    })
    store.unwatchFiles = io.watch(() => void store.reloadFromFiles())
    // 补上 load→watch 之间可能错过的外部写入；无变化时 reload 内部逐模块比对
    // 后跳过（不重建不通知），零成本。
    void store.reloadFromFiles()
    return store
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
      // 标签组：per-workspace 平铺（每项带 workspaceId，webview 在组内按 ws 解析）；
      // count 只认当前基线里真实存在的会话（成员残留旧 id 不计）。
      tags: collectTagSnapshots(this.wsTags, (t, wsId) => ({
        workspaceId: wsId,
        id: t.id,
        name: tagDisplayName(t, vscode.l10n.t),
        color: t.color,
        preset: isPresetTag(t),
        count: this.tagSessionCount(wsId, t.id),
      })),
      tagSessionIds: invertSessionTagIds(collectAllSessionTags(this.wsTags)),
      tagCollapsed: collectCollapsed(this.wsTags),
    }
  }

  /** 某 ws 某个组的会话计数（只数当前基线里的非归档会话；残留/已删 id 不计）。 */
  private tagSessionCount(workspaceId: string, tagId: string): number {
    const bucket = this.bucketOf(workspaceId)
    let n = 0
    for (const [sessionId, id] of Object.entries(bucket.sessionTags)) {
      if (id === tagId && this.knownSessionIds.has(sessionId)) n += 1
    }
    return n
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

  /* ---- 工作区分组（客户端状态，groups.json 持久化） ----
   * 持久化全部走「读文件 → 增量合并 → 原子写回」（io.update*，mutator 只表达
   * 本次意图的增量，作用于文件最新值而非内存态——另一窗口/派生脚本写进文件的
   * 条目不会被覆盖）；写失败只 warn，内存态照常（下次写/热重载会追平）。 */

  private persistAck(ok: Promise<boolean>, what: string): void {
    void ok.then((success) => {
      if (!success) this.logger.warn(`sessions store: persist ${what} to ${this.io.dir} failed`)
    })
  }

  /* ---- 输入草稿（drafts.json，chat tab 用；#14）----
   *  drafts 不在启动快照/热重载里（高频写）：ready 时现读，写走读-合-写。
   *  SessionsStore 只是 io 的唯一持有者，这里做透传，不维护内存镜像。 */

  /** webview ready 报到时现读全部持久化草稿（坏文件按空降级）。 */
  readDrafts(): Promise<DraftsFile> {
    return this.io.readDrafts()
  }

  /** 读-合-写 drafts.json；写失败只 warn（草稿落盘失败不打断输入）。 */
  updateDrafts(mutator: (prev: DraftsFile) => DraftsFile): void {
    this.persistAck(this.io.updateDrafts(mutator), 'drafts')
  }

  /** 新建分组：名称 trim 后非空且不重名；成功返回组定义，失败返回 null。
   *  webview 已做同款校验（空名/重名在输入处给出提示），这里兜底防竞态。 */
  createGroup(name: string): GroupDef | null {
    if (groupNameError(name, this.groups) !== null) return null
    const group: GroupDef = { id: `g-${randomUUID()}`, name: name.trim() }
    this.groups = [...this.groups, group]
    this.persistAck(
      this.io.updateGroups((prev) => {
        // 文件里可能已有另一窗口/脚本建的同名组——重名不追加（与内存校验同规则）。
        if (prev.groups.some((g) => g.id === group.id || g.name === group.name)) return prev
        return { ...prev, groups: [...prev.groups, group] }
      }),
      'groups',
    )
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
    this.persistAck(
      this.io.updateGroups((prev) => {
        if (!prev.groups.some((g) => g.id === groupId)) return prev
        return { ...prev, groups: prev.groups.map((g) => (g.id === groupId ? { ...g, name: trimmed } : g)) }
      }),
      'groups',
    )
    this.onDidChangeEmitter.fire()
    return true
  }

  /** 删除分组：组定义移除、归属清理；若删的是当前选中组，回落「全部工作区」。 */
  deleteGroup(groupId: string): void {
    if (!this.groups.some((g) => g.id === groupId)) return
    this.groups = this.groups.filter((g) => g.id !== groupId)
    const nextMembership = removeGroupId(this.groupMembership, groupId)
    if (nextMembership !== this.groupMembership) {
      this.groupMembership = nextMembership
    }
    if (this.activeGroupId === groupId) {
      this.activeGroupId = null
    }
    this.persistAck(
      this.io.updateGroups((prev) => {
        if (!prev.groups.some((g) => g.id === groupId)) return prev
        return {
          ...prev,
          groups: prev.groups.filter((g) => g.id !== groupId),
          membership: removeGroupId(prev.membership, groupId),
          activeGroupId: prev.activeGroupId === groupId ? null : prev.activeGroupId,
        }
      }),
      'groups',
    )
    this.onDidChangeEmitter.fire()
  }

  /** 设置一个 workspace 的分组归属（多对多全量替换，幂等；未知组 id 剔除）。 */
  setGroupMembership(workspaceId: string, groupIds: readonly string[]): void {
    const known = new Set(this.groups.map((g) => g.id))
    const next = setWorkspaceGroupIds(this.groupMembership, workspaceId, groupIds, known)
    if (next === null) return
    this.groupMembership = next
    this.persistAck(
      this.io.updateGroups((prev) => {
        const prevKnown = new Set(prev.groups.map((g) => g.id))
        const membership = setWorkspaceGroupIds(prev.membership, workspaceId, groupIds, prevKnown)
        return membership === null ? prev : { ...prev, membership }
      }),
      'groups',
    )
    this.onDidChangeEmitter.fire()
  }

  /** 切换当前选中分组（null = 全部工作区）；未知组 id 忽略（等价未选中）。 */
  setActiveGroup(groupId: string | null): void {
    const next = groupId !== null && this.groups.some((g) => g.id === groupId) ? groupId : null
    if (next === this.activeGroupId) return
    this.activeGroupId = next
    this.persistAck(
      this.io.updateGroups((prev) => (prev.activeGroupId === next ? prev : { ...prev, activeGroupId: next })),
      'groups',
    )
    this.onDidChangeEmitter.fire()
  }

  /** 持久化分组顺序（管理视图拖拽后提交全量顺序；缺失/未知 id 丢弃）。 */
  reorderGroups(groupIds: readonly string[]): void {
    const next = reorderGroups(this.groups, groupIds)
    if (next === null) return
    this.groups = next
    this.persistAck(
      this.io.updateGroups((prev) => {
        const groups = reorderGroups(prev.groups, groupIds)
        return groups === null ? prev : { ...prev, groups }
      }),
      'groups',
    )
    this.onDidChangeEmitter.fire()
  }

  /* ---- 会话标签组（客户端状态，tags.json v2 持久化；per-workspace、单组语义） ----
   * 每个 workspace 自带一套组定义 + 归属 + 折叠（bucket）。预设组（todo/doing/done）
   * 语义全局统一、在每个 workspace 各自 seed；自定义组只在该 workspace 存在。
   * 操作都带 workspaceId——webview 在某个 workspace 组内交互，天然带着它。 */

  /** 某 ws 的标签组 bucket；缺失时返回空骨架（不落盘，仅读），预设组 se seed。 */
  private bucketOf(workspaceId: string): WorkspaceTagState {
    return this.wsTags[workspaceId] ?? { tags: sanitizeTagsPure(undefined), sessionTags: {}, collapsed: [] }
  }

  /** 某 ws 的组定义数组（读用，不建桶）。 */
  private bucketTags(workspaceId: string): TagDef[] {
    return this.bucketOf(workspaceId).tags
  }

  /** 取（或建）某 ws 的标签组 bucket，返回可变的实际引用（新桶 seed 预设组）。 */
  private ensureBucket(workspaceId: string): WorkspaceTagState {
    let b = this.wsTags[workspaceId]
    if (!b) {
      b = { tags: sanitizeTagsPure(undefined), sessionTags: {}, collapsed: [] }
      this.wsTags[workspaceId] = b
    }
    return b
  }

  /** 会话 → workspace（基线反查：session.list 的 cwd 归属 workspace.list 的
   *  sessionIds）。基线未认识时回退 UNGROUPED——操作维度仍在，容器不同。 */
  private workspaceOfSession(sessionId: string): string {
    const owned = this.rawWorkspaces.find((w) => w.sessionIds.includes(sessionId))?.workspaceId
    return owned ?? UNGROUPED_WORKSPACE_ID
  }

  /** 新建自建组（per-workspace）：名称 trim 后非空且不与该 ws 自建组重名；颜色
   *  未指定时轮换。返回组定义；失败（空名/重名）返回 null。 */
  createTag(workspaceId: string, name: string, color?: TagColor): TagDef | null {
    const tags = this.bucketTags(workspaceId)
    if (tagNameError(name, tags) !== null) return null
    const tag: TagDef = { id: `t-${randomUUID()}`, name: name.trim(), color: color ?? nextCustomColor(tags) }
    const bucket = this.ensureBucket(workspaceId)
    bucket.tags = [...bucket.tags, tag]
    this.persistAck(
      this.io.updateTags((prev) => ({
        ...prev,
        workspaces: {
          ...prev.workspaces,
          [workspaceId]: withTagAppended(prev.workspaces[workspaceId] ?? emptyBucket(), tag),
        },
      })),
      'tags',
    )
    // 组顺序是树的重建输入（组块聚合序），新组立即参与显示。
    this.rebuildModel()
    this.onDidChangeEmitter.fire()
    return tag
  }

  /** 重命名标签组（per-workspace；预设组改名后覆盖 l10n 默认名，name 落为非 null）。 */
  renameTag(workspaceId: string, tagId: string, name: string): boolean {
    const tags = this.bucketTags(workspaceId)
    const tag = tags.find((t) => t.id === tagId)
    if (!tag) return false
    if (tagNameError(name, tags, tagId) !== null) return false
    const trimmed = name.trim()
    if (tag.name === trimmed) return true
    this.ensureBucket(workspaceId).tags = tags.map((t) => (t.id === tagId ? { ...t, name: trimmed } : t))
    this.persistAck(
      this.io.updateTags((prev) => ({
        ...prev,
        workspaces: {
          ...prev.workspaces,
          [workspaceId]: withTagsMapped(prev.workspaces[workspaceId] ?? emptyBucket(), (t) => (t.id === tagId ? { ...t, name: trimmed } : t)),
        },
      })),
      'tags',
    )
    this.rebuildModel()
    this.onDidChangeEmitter.fire()
    return true
  }

  /** 设置标签组颜色（per-workspace；非法颜色忽略；颜色不进树模型，无需重建）。 */
  setTagColor(workspaceId: string, tagId: string, color: TagColor): void {
    if (!(TAG_COLORS as readonly unknown[]).includes(color)) return
    const tags = this.bucketTags(workspaceId)
    const tag = tags.find((t) => t.id === tagId)
    if (!tag || tag.color === color) return
    this.ensureBucket(workspaceId).tags = tags.map((t) => (t.id === tagId ? { ...t, color } : t))
    this.persistAck(
      this.io.updateTags((prev) => ({
        ...prev,
        workspaces: {
          ...prev.workspaces,
          [workspaceId]: withTagsMapped(prev.workspaces[workspaceId] ?? emptyBucket(), (t) => (t.id === tagId ? { ...t, color } : t)),
        },
      })),
      'tags',
    )
    this.onDidChangeEmitter.fire()
  }

  /** 删除自建组（per-workspace）：组定义移除、成员打标清理（组内会话回未分组）；预设组拒绝。 */
  deleteTag(workspaceId: string, tagId: string): void {
    const tags = this.bucketTags(workspaceId)
    const tag = tags.find((t) => t.id === tagId)
    if (!tag || isPresetTag(tag)) return
    const bucket = this.ensureBucket(workspaceId)
    bucket.tags = tags.filter((t) => t.id !== tagId)
    bucket.sessionTags = removeTagFromAll(bucket.sessionTags, tagId)
    bucket.collapsed = bucket.collapsed.filter((id) => id !== tagId)
    this.persistAck(
      this.io.updateTags((prev) => ({
        ...prev,
        workspaces: {
          ...prev.workspaces,
          [workspaceId]: withTagRemoved(prev.workspaces[workspaceId] ?? emptyBucket(), tagId),
        },
      })),
      'tags',
    )
    this.rebuildModel()
    this.onDidChangeEmitter.fire()
  }

  /** 设置一个会话的组（tagId = null 移出组；未知组 id 忽略；幂等）。会话所属
   *  workspace 由基线反查；tag 打到该会话所属 ws 的 bucket。 */
  setSessionTag(sessionId: string, tagId: string | null): void {
    if (!sessionId) return
    const workspaceId = this.workspaceOfSession(sessionId)
    const bucket = this.ensureBucket(workspaceId)
    const known = new Set(bucket.tags.map((t) => t.id))
    const next = setSessionTagId(bucket.sessionTags, sessionId, tagId, known)
    if (next === null) return
    bucket.sessionTags = next
    this.persistAck(
      this.io.updateTags((prev) => {
        const pb = prev.workspaces[workspaceId] ?? emptyBucket()
        return {
          ...prev,
          workspaces: {
            ...prev.workspaces,
            [workspaceId]: { ...pb, sessionTags: (() => { const k = new Set(pb.tags.map((t) => t.id)); const s = setSessionTagId(pb.sessionTags, sessionId, tagId, k); return s ?? pb.sessionTags })() },
          },
        }
      }),
      'tags',
    )
    // 打组改变会话在树里的聚合（tagId/组块顺序），必须重建模型——只 fire
    // 通知会让快照推回旧模型（列表不刷新，等下一个 60s tick 才生效）。
    this.rebuildModel()
    this.onDidChangeEmitter.fire()
  }

  /** 批量设置（整组操作「移出分组」/拖拽后多行同组）：单次持久化 + 一次通知。 */
  setSessionTagMany(sessionIds: readonly string[], tagId: string | null): void {
    if (sessionIds.length === 0) return
    // 批量目标 = 这些会话各自所属 ws 的 bucket（逐个按会话归属写）。
    for (const id of sessionIds) this.setSessionTag(id, tagId)
  }

  /** 持久化标签组顺序（per-workspace；拖拽后提交全量顺序；缺失/未知 id 拒绝）。 */
  reorderSessionTags(workspaceId: string, tagIds: readonly string[]): void {
    const tags = this.bucketTags(workspaceId)
    const next = reorderTagsPure(tags, tagIds)
    if (next === null) return
    this.ensureBucket(workspaceId).tags = next
    this.persistAck(
      this.io.updateTags((prev) => ({
        ...prev,
        workspaces: {
          ...prev.workspaces,
          [workspaceId]: withTagsReordered(prev.workspaces[workspaceId] ?? emptyBucket(), tagIds),
        },
      })),
      'tags',
    )
    // 组顺序改变组块聚合顺序，同样需要重建模型。
    this.rebuildModel()
    this.onDidChangeEmitter.fire()
  }

  /** 折叠/展开一个标签组块（UI 偏好，per-workspace 存进 tags.json v2；幂等）。 */
  setTagCollapsed(workspaceId: string, tagId: string, collapsed: boolean): void {
    const bucket = this.ensureBucket(workspaceId)
    const set = new Set(bucket.collapsed)
    const changed = collapsed ? !set.has(tagId) : set.delete(tagId)
    if (collapsed) set.add(tagId)
    if (!changed) return
    bucket.collapsed = [...set]
    // 折叠是展示态（不动会话树模型），只需落盘 + 通知快照。
    this.persistAck(
      this.io.updateTags((prev) => ({ ...prev, workspaces: { ...prev.workspaces, [workspaceId]: { ...bucket } } })),
      'tags',
    )
    this.onDidChangeEmitter.fire()
  }

  /** 标签组名校验（host showInputBox 用的 validateInput）：合法返回 null。 */
  tagNameErrorFor(name: string, workspaceId: string): string | null {
    const tags = this.bucketTags(workspaceId)
    const err = tagNameError(name, tags)
    if (err === 'empty') return vscode.l10n.t('Group name cannot be empty')
    if (err === 'duplicate') return vscode.l10n.t('A group with this name already exists')
    return null
  }

  /** 单个标签组的快照形状（含翻译名/preset 标记）；未知 id / 无该 ws 的组返回 null。 */
  tagById(tagId: string, workspaceId: string): { id: string; name: string; preset: boolean } | null {
    const t = this.bucketTags(workspaceId).find((x) => x.id === tagId)
    if (!t) return null
    return { id: t.id, name: tagDisplayName(t, vscode.l10n.t), preset: isPresetTag(t) }
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
    this.persistAck(
      this.io.updatePinned((prev) => {
        const rest = prev.filter((id) => id !== sessionId)
        if (pin) {
          if (prev.length > 0 && prev[0] === sessionId) return prev
          return [sessionId, ...rest]
        }
        return rest.length === prev.length ? prev : rest
      }),
      'pinned',
    )
    this.rebuildModel()
    this.onDidChangeEmitter.fire()
  }

  /** Mark a session read/unread (client-side only); persists across reloads. */
  setUnread(sessionId: string, unread: boolean): void {
    const changed = unread ? !this.unread.has(sessionId) : this.unread.delete(sessionId)
    if (unread) this.unread.add(sessionId)
    if (!changed) return
    this.persistAck(
      this.io.updateUnread((prev) => {
        if (unread) return prev.includes(sessionId) ? prev : [...prev, sessionId]
        return prev.includes(sessionId) ? prev.filter((id) => id !== sessionId) : prev
      }),
      'unread',
    )
    this.rebuildModel()
    this.onDidChangeEmitter.fire()
  }

  /** 回收站视图折叠组持久化（globalState Memento，UI 偏好不搬）。 */
  private persistRecycleCollapsed(): void {
    void this.globalState.update(RECYCLE_COLLAPSED_STATE_KEY, [...this.recycleCollapsed])
  }

  /** 移入回收站（可逆本地操作，不碰 dsh）；幂等。 */
  moveToRecycleBin(sessionId: string): void {
    if (this.recycleBin.includes(sessionId)) return
    this.recycleBin.push(sessionId)
    this.persistAck(
      this.io.updateRecycleBin((prev) => (prev.includes(sessionId) ? prev : [...prev, sessionId])),
      'recycle-bin',
    )
    this.pruneEmptyCustomTags()
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
    this.persistAck(
      this.io.updateRecycleBin((prev) => {
        const missing = sessionIds.filter((id) => !prev.includes(id))
        return missing.length === 0 ? prev : [...prev, ...missing]
      }),
      'recycle-bin',
    )
    this.pruneEmptyCustomTags()
    this.rebuildModel()
    this.onDidChangeEmitter.fire()
  }

  /**
   * 移入回收站后清理「已无活跃成员」的自定义组：组内会话全部移入回收站（或已
   * 归档/消失）时，该自建组不再保留（预设组永不动）。新建尚未加入过会话的自建
   * 组不视为空——保留给用户立即加入。只改内存态 + 单次持久化，不 trigger 通知
   * （调用方随 moveToRecycleBin/many 的 rebuildModel + fire 一并落地）。
   */
  private pruneEmptyCustomTags(): void {
    // 基线未就绪（服务停了/重启后未重拉）时 knownSessionIds 为空集合，不得据此
    // 判定「无活跃成员」——否则会把所有自定义组误删。同 pruneRecycleBin 的保护。
    if (!this.baselineReady) return
    const recycleSet = new Set(this.recycleBin)
    // 活跃成员 = 当前基线里存在的会话（归档已排除）且不在回收站。
    const isActive = (sessionId: string): boolean =>
      this.knownSessionIds.has(sessionId) && !recycleSet.has(sessionId)

    // v2：per-workspace，逐桶修剪「已无活跃成员」的自定义组。两阶段——先收集
    // 各桶的变化，再一次性落盘（避免逐桶多次写）。
    const pruning: Array<{ workspaceId: string; bucket: WorkspaceTagState; emptyIds: string[] }> = []
    for (const [wsId, bucket] of Object.entries(this.wsTags)) {
      const emptyIds = emptyCustomTagIds(bucket.tags, bucket.sessionTags, isActive)
      if (emptyIds.length === 0) continue
      pruning.push({ workspaceId: wsId, bucket, emptyIds })
    }
    if (pruning.length === 0) return
    const emptySetById = new Map(pruning.map((p) => [p.workspaceId, new Set(p.emptyIds)]))
    // 内存态按桶落地。
    for (const p of pruning) {
      const emptySet = emptySetById.get(p.workspaceId)!
      p.bucket.tags = p.bucket.tags.filter((t) => !emptySet.has(t.id))
      for (const id of p.emptyIds) p.bucket.sessionTags = removeTagFromAll(p.bucket.sessionTags, id)
    }
    this.persistAck(
      this.io.updateTags((prev) => {
        const workspaces = { ...prev.workspaces }
        let changed = false
        for (const p of pruning) {
          const emptySet = emptySetById.get(p.workspaceId)!
          const existing = workspaces[p.workspaceId] ?? emptyBucket()
          const tags = existing.tags.filter((t) => !emptySet.has(t.id))
          let sessionTags = existing.sessionTags
          for (const id of p.emptyIds) sessionTags = removeTagFromAll(sessionTags, id)
          if (tags.length === existing.tags.length && sessionTags === existing.sessionTags) continue
          workspaces[p.workspaceId] = { ...existing, tags, sessionTags }
          changed = true
        }
        return changed ? { ...prev, workspaces } : prev
      }),
      'tags',
    )
  }

  /** 从回收站恢复单个会话（回原 workspace 组）；幂等。 */
  restoreFromRecycleBin(sessionId: string): void {
    const idx = this.recycleBin.indexOf(sessionId)
    if (idx === -1) return
    this.recycleBin.splice(idx, 1)
    this.persistAck(
      this.io.updateRecycleBin((prev) =>
        prev.includes(sessionId) ? prev.filter((id) => id !== sessionId) : prev,
      ),
      'recycle-bin',
    )
    this.rebuildModel()
    this.onDidChangeEmitter.fire()
  }

  /** 恢复全部（视图头部按钮）；空集合时无操作。 */
  restoreAllFromRecycleBin(): void {
    if (this.recycleBin.length === 0) return
    const removed = new Set(this.recycleBin)
    this.recycleBin = []
    this.persistAck(
      this.io.updateRecycleBin((prev) => {
        // 增量清空：只移除本窗口视野里的这批——其它窗口/脚本并发移入的条目保留。
        const filtered = prev.filter((id) => !removed.has(id))
        return filtered.length === prev.length ? prev : filtered
      }),
      'recycle-bin',
    )
    this.rebuildModel()
    this.onDidChangeEmitter.fire()
  }

  /**
   * 归档成功后的回收站清理（host 命令层调用）：从本地集合移除已归档 id——
   * 归档即终点，回收站会话只剩「恢复」与「归档」两条去路。非回收站 id 幂等无操作。
   */
  clearRecycleBinIds(ids: readonly string[]): void {
    if (ids.length === 0) return
    // 归档即终点：会话从基线消失，先清理「已无活跃成员」的自定义组（直接归档、
    // 未走回收站的会话也在此触发）。下面 if 提前返回只影响回收站集合，不影响本次清账。
    this.pruneEmptyCustomTags()
    const next = this.recycleBin.filter((id) => !ids.includes(id))
    if (next.length === this.recycleBin.length) return
    this.recycleBin = next
    this.persistAck(
      this.io.updateRecycleBin((prev) => {
        const filtered = prev.filter((id) => !ids.includes(id))
        return filtered.length === prev.length ? prev : filtered
      }),
      'recycle-bin',
    )
    this.rebuildModel()
    this.onDidChangeEmitter.fire()
  }

  /** 回收站视图的组折叠（独立于主列表 collapsed，互不影响，各自持久化）。 */
  setRecycleCollapsed(workspaceId: string, collapse: boolean): void {
    const changed = collapse ? !this.recycleCollapsed.has(workspaceId) : this.recycleCollapsed.delete(workspaceId)
    if (collapse) this.recycleCollapsed.add(workspaceId)
    if (!changed) return
    this.persistRecycleCollapsed()
    this.onDidChangeEmitter.fire()
  }

  /**
   * Chat view 打开/关闭 tab 时同步已打开会话集合（全量 tab，非仅可见 tab）。
   * 打开 = 已读（邮件语义，用户确认）：attach 瞬间同时清掉自动完成标记与手动
   * 未读。清除是事件而非持续约束——开着 tab 时手动标的未读不会被立即清掉，
   * 保留到下次打开才清（Gmail 式）。注意「tab 打开中」不再算活跃（用户拍板：
   * 打开只高亮不跳序），成员变化本身不影响排序，这里仅因清未读/完成标记可能
   * 改变显示而触发重建。
   */
  setAttachedSessions(sessionIds: Iterable<string>): void {
    const next = new Set(sessionIds)
    let changed = !sameStringSet(next, this.attachedIds)
    this.attachedIds = next
    let unreadChanged = false
    for (const id of next) {
      if (this.completed.delete(id)) changed = true
      if (this.unread.delete(id)) unreadChanged = true
    }
    if (unreadChanged) {
      this.persistAck(
        this.io.updateUnread((prev) => prev.filter((id) => !next.has(id))),
        'unread',
      )
    }
    if (changed || unreadChanged) {
      this.rebuildModel()
      this.onDidChangeEmitter.fire()
    }
  }

  /** Collapse/expand a workspace group; persists across reloads. */
  setCollapsed(workspaceId: string, collapse: boolean): void {
    const changed = collapse ? !this.collapsed.has(workspaceId) : this.collapsed.delete(workspaceId)
    if (collapse) this.collapsed.add(workspaceId)
    if (!changed) return
    void this.state.update(COLLAPSED_STATE_KEY, [...this.collapsed])
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
    void this.state.update(COLLAPSED_STATE_KEY, [...this.collapsed])
    this.onDidChangeEmitter.fire()
  }

  /** collapseAll 的反向操作：只展开当前可见的组，被搜索过滤掉的组保持原状。 */
  expandAll(): void {
    const ids = this.workspaces.map((w) => w.workspaceId)
    if (ids.every((id) => !this.collapsed.has(id))) return
    for (const id of ids) this.collapsed.delete(id)
    void this.state.update(COLLAPSED_STATE_KEY, [...this.collapsed])
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
      // 基线就绪才拿到 sessionId→workspace：若还有 v1 全局标签组待迁移，此时拆桶。
      this.migratePendingV1ToV2()
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

  /**
   * 基线就绪后的一次性 v1→v2 迁移：把 pendingV1（v1 全局 tags/sessionTags）按
   * sessionId→workspace（来自当前无线 baseline）拆成 per-workspace bucket，
   * 写 v2 文件，删旧 Memento key，清 pendingV1。拿不到归属的会话归 UNGROUPED。
   * dsh 未跑 / 基线从未就绪时不触发（pendingV1 保持，下次启动服务起来再迁）。
   * 迁移幂等：无 pendingV1 直接返回。
   */
  private migratePendingV1ToV2(): void {
    if (this.pendingV1 === null) return
    const pending = this.pendingV1
    this.pendingV1 = null
    const v2 = migrateTagFileV1ToV2(pending, (sessionId) => this.workspaceOfSession(sessionId), UNGROUPED_WORKSPACE_ID)
    // 先落盘再清 Memento：写失败绝不能丢 pending（保留 v1 数据，下轮重试）。
    this.persistAck(
      this.io.updateTags((prev) => ({ version: 2, workspaces: { ...prev.workspaces, ...v2.workspaces } })),
      'tags',
    )
    deleteLegacyKeys(this.globalState, [LEGACY_TAGS_KEY, LEGACY_SESSION_TAGS_KEY])
    this.wsTags = { ...this.wsTags, ...v2.workspaces }
    this.logger.info(
      `sessions store: [tags] migrated v1 global → v2 per-workspace (${Object.keys(v2.workspaces).length} workspace buckets, ${pending.sessionTags ? Object.keys(pending.sessionTags).length : 0} assignments)`,
    )
  }

  /** Rebuild the display model from the cached baseline + current filter/query. */
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
      pinned: this.pinned,
      unread: unreadDisplay,
      pendingInteractions: pendingDisplay,
      // 标签组聚合（Chrome 垂直标签式，per-workspace）：组定义/归属都按 ws 取。
      // 组块顺序 = 该 ws 桶的定义顺序；workspace 内非置顶会话按组块聚合，无组
      // 殿后（置顶会话保持绝对优先平铺）。
      tagOrderFor: (workspaceId: string): readonly string[] => this.bucketTags(workspaceId).map((t) => t.id),
      sessionTagForWs: (sessionId: string, workspaceId: string): string | undefined =>
        this.wsTags[workspaceId]?.sessionTags[sessionId],
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
    // 回收站平铺：不传 tag 聚合选项——回收站里不按标签组聚合，会话也
    // 不挂 tagId（组归属数据不动，恢复后回原组不变；纯层排序退化为
    // 活跃优先 + 入站顺序）。recycleOrder = 入站顺序（数组尾部 = 最新移入），
    // 组内按入站倒序排（最新入站最上），不再走主列表的 置顶/活跃/updatedAt 排序。
    const { tagOrderFor: _tagOrder, sessionTagForWs: _tagForWs, ...recycleBase } = baseViewOptions
    this.recycleWorkspaces = buildSessionTree(
      this.rawWorkspaces,
      this.rawSessions,
      this.rawArchived,
      (s) => s.title ?? null,
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      Date.now(),
      {
        ...recycleBase,
        onlySessionIds: recycleSet,
        recycleOrder: this.recycleBin,
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
    const next = pruneRecycleIds(this.recycleBin, this.knownSessionIds, this.baselineReady)
    if (next === null) return
    this.recycleBin = next
    this.persistAck(
      this.io.updateRecycleBin((prev) => {
        // 清账不变量针对文件内容执行（而不是内存镜像 keep 集）：其它窗口刚
        // 回收、本窗口还没热重载到的合法条目不能在这里被抹掉。
        const filtered = prev.filter((id) => this.knownSessionIds.has(id))
        return filtered.length === prev.length ? prev : filtered
      }),
      'recycle-bin',
    )
  }

  /**
   * 文件热重载（watch 触发：派生脚本/另一窗口写了 ~/.dsh/dsh-one/，或本窗口
   * 自己的写回响）。文件权威：快照逐模块替换内存态——与内存无差异的模块跳过，
   * 全部无差异则不重建不通知（自己的写占绝大多数事件）。文件缺失/损坏的模块
   * 保持内存态不动（下次事件再追平）。本窗口有在途写时跳过本次重载——写落定
   * 后会产生新的 watch 事件，避免读到写前旧值把内存态回退。
   */
  private async reloadFromFiles(): Promise<void> {
    if (this.disposed) return
    if (this.io.writePending) {
      // 读到写前旧值会把内存态回退，跳过；写落定后的 watch 事件会补一次。
      this.logger.info('sessions store: client-state reload skipped (own write in flight)')
      return
    }
    const snap = await this.io.load()
    if (this.disposed) return
    const reloaded: string[] = []
    if (snap.recycleBin !== null && !sameIdList(snap.recycleBin.sessionIds, this.recycleBin)) {
      this.recycleBin = [...snap.recycleBin.sessionIds]
      reloaded.push('recycle-bin')
    }
    if (snap.pinned !== null && !sameIdList(snap.pinned.sessionIds, this.pinned)) {
      this.pinned = [...snap.pinned.sessionIds]
      reloaded.push('pinned')
    }
    if (snap.unread !== null) {
      const next = new Set(snap.unread.sessionIds)
      if (!sameStringSet(next, this.unread)) {
        this.unread = next
        reloaded.push('unread')
      }
    }
    if (snap.groups !== null) {
      let groupsChanged = false
      if (!sameGroupDefs(snap.groups.groups, this.groups)) {
        this.groups = snap.groups.groups
        groupsChanged = true
      }
      if (!sameMembership(snap.groups.membership, this.groupMembership)) {
        this.groupMembership = snap.groups.membership
        groupsChanged = true
      }
      if (snap.groups.activeGroupId !== this.activeGroupId) {
        this.activeGroupId = snap.groups.activeGroupId
        groupsChanged = true
      }
      if (groupsChanged) reloaded.push('groups')
    }
    if (snap.tags !== null && snap.tags.version === 2) {
      let tagsChanged = false
      if (!sameWorkspaceTags(snap.tags.workspaces, this.wsTags)) {
        this.wsTags = snap.tags.workspaces
        tagsChanged = true
      }
      // v2 权威即视为已迁移，清掉待迁移态。
      if (this.pendingV1 !== null) {
        this.pendingV1 = null
        tagsChanged = true
      }
      if (tagsChanged) reloaded.push('tags')
    } else if (snap.tags !== null && snap.tags.version === 1) {
      // 文件仍是 v1：内存的 v2 数据不采纳（迁移会覆写），只把 v1 数据暂存待迁移。
      this.pendingV1 = { tags: snap.tags.tags, sessionTags: snap.tags.sessionTags }
      reloaded.push('tags')
    }
    if (reloaded.length === 0) return
    this.logger.info(`sessions store: client-state reloaded from files: ${reloaded.join(', ')}`)
    this.rebuildModel()
    this.onDidChangeEmitter.fire()
  }

  dispose(): void {
    this.disposed = true
    this.unwatchFiles?.()
    this.unwatchFiles = null
    this.io.dispose()
    this.stateSub.dispose()
    this.hostEvents?.dispose()
    this.mux?.dispose()
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.tickTimer) clearInterval(this.tickTimer)
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.onDidChangeEmitter.dispose()
  }
}

/* ---- reloadFromFiles 的相等判断：内容与内存一致就跳过替换+通知
 * （watch 事件里本窗口自己的写占绝大多数，不值得重复重建模型）。 ---- */

function sameIdList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

function sameStringSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false
  for (const v of a) if (!b.has(v)) return false
  return true
}

function sameGroupDefs(a: readonly GroupDef[], b: readonly GroupDef[]): boolean {
  return a.length === b.length && a.every((g, i) => g.id === b[i].id && g.name === b[i].name)
}

function hasOwn(rec: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(rec, key)
}

function sameMembership(
  a: Readonly<Record<string, string[]>>,
  b: Readonly<Record<string, string[]>>,
): boolean {
  const aKeys = Object.keys(a)
  return aKeys.length === Object.keys(b).length && aKeys.every((k) => hasOwn(b, k) && sameIdList(a[k], b[k]))
}

function sameTagDefs(a: readonly TagDef[], b: readonly TagDef[]): boolean {
  return (
    a.length === b.length &&
    a.every((t, i) => t.id === b[i].id && t.name === b[i].name && t.color === b[i].color)
  )
}

function sameSessionTags(
  a: Readonly<Record<string, string>>,
  b: Readonly<Record<string, string>>,
): boolean {
  const aKeys = Object.keys(a)
  return aKeys.length === Object.keys(b).length && aKeys.every((k) => hasOwn(b, k) && b[k] === a[k])
}

/** v2 bucket 等同判断：逐 ws 比较组定义/归属/折叠。 */
function sameWorkspaceTags(a: Readonly<Record<string, WorkspaceTagState>>, b: Readonly<Record<string, WorkspaceTagState>>): boolean {
  const aKeys = Object.keys(a)
  if (aKeys.length !== Object.keys(b).length) return false
  return aKeys.every((k) => {
    const av = a[k]
    const bv = b[k]
    return (
      av !== undefined &&
      sameTagDefs(av.tags, bv.tags) &&
      sameSessionTags(av.sessionTags, bv.sessionTags) &&
      sameIdList(av.collapsed, bv.collapsed)
    )
  })
}

/* ---- 标签组 v2 bucket 的字段级合并（写前重读时对文件旧值应用同款变换） ---- */

/** 空 bucket（预设组作为 seed——v2 每个 ws 桶恒含 todo/doing/done）。 */
function emptyBucket(): WorkspaceTagState {
  return { tags: sanitizeTagsPure(undefined), sessionTags: {}, collapsed: [] }
}

/** 追加一个组定义（同 id / 同名（自定义）去重后追加；a 已有则不变）。 */
function withTagAppended(bucket: WorkspaceTagState, tag: TagDef): WorkspaceTagState {
  if (bucket.tags.some((t) => t.id === tag.id || (t.name !== null && t.name === tag.name))) return bucket
  return { ...bucket, tags: [...bucket.tags, tag] }
}

/** 对 bucket 的组定义做映射（含补种该桶缺失的预设组后映射）。 */
function withTagsMapped(bucket: WorkspaceTagState, fn: (t: TagDef) => TagDef): WorkspaceTagState {
  const tags = sanitizeTagsPure(bucket.tags)
  return { ...bucket, tags: tags.map(fn) }
}

/** 移除一个组定义 + 清其归属/折叠引用。 */
function withTagRemoved(bucket: WorkspaceTagState, tagId: string): WorkspaceTagState {
  return {
    ...bucket,
    tags: bucket.tags.filter((t) => t.id !== tagId),
    sessionTags: removeTagFromAll(bucket.sessionTags, tagId),
    collapsed: bucket.collapsed.filter((id) => id !== tagId),
  }
}

/** 重排组定义；无效全量顺序（缺/未知/重复 id）原样返回（调用方跳过落盘）。 */
function withTagsReordered(bucket: WorkspaceTagState, tagIds: readonly string[]): WorkspaceTagState {
  const next = reorderTagsPure(bucket.tags, tagIds)
  return next === null ? bucket : { ...bucket, tags: next }
}

/* ---- 标签组 v2 快照聚合（flat snapshot helpers） ---- */

/** 收集全部 workspace bucket 的组定义快照，逐项回调（携带所属 workspaceId）。 */
function collectTagSnapshots<T>(
  wsTags: Readonly<Record<string, WorkspaceTagState>>,
  map: (t: TagDef, workspaceId: string) => T,
): T[] {
  const out: T[] = []
  for (const [wsId, bucket] of Object.entries(wsTags)) {
    for (const t of bucket.tags) out.push(map(t, wsId))
  }
  return out
}

/** 收集全部 bucket 的 sessionTags 合并（全局倒排用：sessionId→tagId，全局唯一）。 */
function collectAllSessionTags(wsTags: Readonly<Record<string, WorkspaceTagState>>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const bucket of Object.values(wsTags)) {
    for (const [sessionId, tagId] of Object.entries(bucket.sessionTags)) out[sessionId] = tagId
  }
  return out
}

/** 收集全部 bucket 的折叠 id（wsId → 折叠的 tagId 数组），供 webview 按 ws 查。 */
function collectCollapsed(wsTags: Readonly<Record<string, WorkspaceTagState>>): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [wsId, bucket] of Object.entries(wsTags)) {
    if (bucket.collapsed.length > 0) out[wsId] = [...bucket.collapsed]
  }
  return out
}
