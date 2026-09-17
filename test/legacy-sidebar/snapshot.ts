/**
 * 两侧要喂的**同一份数据**：从网关（只读）取一次，再按状态折成
 * ① 旧侧栏的 `SessionsSnapshot`（`postMessage({type:'sessions', snapshot})` 注入）
 * ② 现装配侧的状态（假宿主状态存储 + 官方客户端 localStorage 视图态）。
 *
 * 为什么两侧的构造方式不同：两边**各自怎么读数据是真的不一样**（旧侧栏由宿主 store
 * 组装整棵树推给页面；现装配侧走官方服务，树由官方客户端按官方顺序渲染），所以
 * harness 不能把同一份树硬塞给两边，只能把同一批事实（工作区、会话、置顶、未读、
 * 标签组、回收站）按各自的原生通道喂进去。事实一致、通道各自原生，比对上才有意义。
 *
 * 只读：本模块只调 `session/list` 与 `workspace/follow`（读），一个写类方法都没有。
 */
import type { Logger } from '../../src/log.ts'
import type { SessionsSnapshot } from '../../src/pure/chatContract.ts'
import { listSessions, sessionAgentPreset, sessionCompletedTurns, sessionTitle, sessionTotalTokens, type SessionSummary } from '../../src/server/dshRpc.ts'
import { subscribeWorkspaceStream } from '../../src/server/modernStreams.ts'
import { buildSessionTree, type SessionInput, type WorkspaceInput } from '../../src/pure/sessionTree.ts'
import type { TagColor } from '../../src/pure/sessionTags.ts'
import { vscodeL10nT } from './l10n.ts'

/** 网关上的事实（两侧共用的一份）。 */
export interface GatewayModel {
  workspaces: WorkspaceInput[]
  sessions: SessionInput[]
  archived: ReadonlySet<string>
  /** 工作区路径，按注册序（假宿主拿它当「VS Code 打开的文件夹」）。 */
  paths: string[]
}

/**
 * 从网关取一次工作区清单与会话清单（只读订阅，取到基线即退订）。
 *
 * 归档会话集合也取自这一帧的 `archivedSessionIds`：`session/list` 会把归档会话一起列出来，
 * 而**两侧都不该把它画出来**（现装配侧由官方快照的归档集合滤掉，旧侧栏由 `buildSessionTree`
 * 的同类输入滤掉）。以前这里恒给空集合，等于旧侧栏把归档会话当普通行渲染、两侧行数对不上。
 */
export async function fetchGatewayModel(gateway: string, logger: Logger): Promise<GatewayModel> {
  const baseline = await new Promise<{ workspaces: WorkspaceInput[]; archived: string[] }>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      subscription.dispose()
      reject(new Error('legacy-sidebar: workspace/follow baseline timeout (10s)'))
    }, 10_000)
    const subscription = subscribeWorkspaceStream(gateway, logger, (frame) => {
      if (settled || frame.type !== 'baseline') return
      settled = true
      clearTimeout(timer)
      subscription.dispose()
      resolve({
        workspaces: frame.items.filter(
          (item): item is WorkspaceInput =>
            typeof item === 'object' &&
            item !== null &&
            typeof (item as { workspaceId?: unknown }).workspaceId === 'string',
        ),
        archived: frame.archivedSessionIds,
      })
    })
  })
  const workspaces = baseline.workspaces
  const archived = new Set<string>(baseline.archived)
  const sessions = (await listSessions(gateway)).map(toSessionInput)
  const paths = workspaces.map((w) => w.path).filter((p) => typeof p === 'string' && p !== '')
  return { workspaces, sessions, archived, paths }
}

/** 与 `sessionsStore.toSessionInput` 同一口径（该函数是模块私有的，这里照抄一遍）。 */
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
    ...(sessionAgentPreset(s) !== undefined ? { agentPreset: sessionAgentPreset(s) } : {}),
    ...(s.cwd ? { cwd: s.cwd } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(completedTurns > 0 ? { sessionStatsTurns: completedTurns } : {}),
  }
}

/* ---------------------------------------------------------------------------
 * harness 自己的那一批「用户事实」（两侧同一份）
 * ------------------------------------------------------------------------ */

/** 一个标签组：定义 + 成员（两侧共用这一份定义）。 */
export interface TagGroupSeed {
  workspaceId: string
  id: string
  name: string
  color: TagColor
  sessionIds: string[]
}

/**
 * 这批事实 = 「用户此刻的置顶 / 未读 / 标签组 / 回收站 / 当前会话」，由网关上的真会话
 * 拼出来（会话 id 都是真的，所以两条侧栏渲染的都是真会话）。
 *
 * 挑会话的口径固定：按工作区与组内顺序取第 N 条——**不是**挑「看起来合适的那条」，
 * 这样两个宽度之间的成对截图内容一致，也不会因为网关数据漂移就换人（漂移见 #116）。
 */
export interface UserFacts {
  /** 每棵工作区展开后可用的会话 id（顺序同官方 list 里的顺序，已剔除空白会话）。 */
  members: Map<string, string[]>
  /** 全部可显示会话 id，按工作区顺序铺平。 */
  flat: string[]
  pinned: string[]
  unread: string[]
  tags: TagGroupSeed[]
  recycleBin: string[]
  activeSessionId: string | null
  collapsedAll: string[]
}

/** 从网关事实折出这份 harness 事实（取不到就留空，不编造）。 */
export function userFacts(model: GatewayModel): UserFacts {
  const visible = model.sessions.filter((s) => !s.blank && !model.archived.has(s.sessionId))
  const byId = new Map(visible.map((s) => [s.sessionId, s]))
  const members = new Map<string, string[]>()
  const flat: string[] = []
  for (const workspace of model.workspaces) {
    const ids = (workspace.sessionIds ?? []).filter((id) => byId.has(id))
    members.set(workspace.workspaceId, ids)
    flat.push(...ids)
  }
  // 没有登记在 workspace.sessionIds 里的会话（未分组桶）也铺进去，避免「网关上有会话但
  // 两侧列表都空」时误判成渲染问题。
  const assigned = new Set(flat)
  for (const s of visible) if (!assigned.has(s.sessionId)) flat.push(s.sessionId)

  const first = flat[0]
  const second = flat[1]
  // 标签组的两条硬约束决定了怎么挑成员：
  // 1. **成员必须同属一棵工作区**（归属是 per-workspace 的 `sessionTagForWs`，跨工作区塞进去
  //    的成员在树里被降级成「未归组」，组块根本铺不出来）；
  // 2. **成员不能是置顶会话**（置顶的是绝对优先、平铺在会话区最前，不进任何组块）。
  // 所以挑「非置顶可见会话最多」的那棵工作区；挑不到够数的就只建一个组或干脆不建（如实记一笔）。
  const nonPinned = new Set(flat.filter((id) => id !== first))
  let tagWorkspace: WorkspaceInput | undefined
  let tagPool: string[] = []
  for (const workspace of model.workspaces) {
    const pool = (members.get(workspace.workspaceId) ?? []).filter((id) => nonPinned.has(id))
    if (pool.length > tagPool.length) {
      tagWorkspace = workspace
      tagPool = pool
    }
  }
  const tags: TagGroupSeed[] = []
  if (tagWorkspace !== undefined && tagPool.length >= 4) {
    tags.push({ workspaceId: tagWorkspace.workspaceId, id: 'lab-group-one', name: '实验组一', color: 'orange', sessionIds: tagPool.slice(0, 2) })
    tags.push({ workspaceId: tagWorkspace.workspaceId, id: 'lab-group-two', name: '实验组二', color: 'blue', sessionIds: tagPool.slice(2, 4) })
  } else if (tagWorkspace !== undefined && tagPool.length >= 2) {
    tags.push({ workspaceId: tagWorkspace.workspaceId, id: 'lab-group-one', name: '实验组一', color: 'orange', sessionIds: tagPool.slice(0, 2) })
  }
  const tagsTaken = new Set(tags.flatMap((t) => t.sessionIds))
  // 回收站要两条**不同工作区**的会话：抽屉按原工作区分块的形态才看得见（#103）。
  const recyclePool = flat.filter((id) => !tagsTaken.has(id))
  const recycleBin: string[] = []
  for (const workspace of model.workspaces) {
    const candidate = (members.get(workspace.workspaceId) ?? []).find(
      (id) => !tagsTaken.has(id) && !recycleBin.includes(id) && id !== first,
    )
    if (candidate !== undefined) recycleBin.push(candidate)
  }
  while (recycleBin.length < 2 && recyclePool.length > 0) {
    const next = recyclePool.shift()
    if (next !== undefined && !recycleBin.includes(next)) recycleBin.push(next)
  }

  return {
    members,
    flat,
    pinned: first === undefined ? [] : [first],
    unread: second === undefined ? [] : [second],
    tags,
    recycleBin,
    activeSessionId: first ?? null,
    collapsedAll: model.workspaces.map((w) => w.workspaceId),
  }
}

/* ---------------------------------------------------------------------------
 * ① 旧侧栏：SessionsSnapshot
 * ------------------------------------------------------------------------ */

export interface LegacySnapshotInput {
  model: GatewayModel
  /** 零工作区那一态：清单与会话都空。 */
  noWorkspaces?: boolean
  /**
   * 「当前工作区」的判据输入（VS Code 当前打开的文件夹路径）。缺省取网关第一棵工作区
   * 的路径——与现装配侧假宿主上报的那份相同，两侧对着同一棵工作区打「当前」标记。
   */
  currentFolder?: string
  collapsed: string[]
  pinned: string[]
  unread: string[]
  tags: TagGroupSeed[]
  recycleBin: string[]
  activeSessionId: string | null
  query?: string | null
}

export function legacySnapshot(input: LegacySnapshotInput): SessionsSnapshot {
  const { model } = input
  const workspaces = input.noWorkspaces ? [] : model.workspaces
  const recycleSet = new Set(input.recycleBin)
  const tagOf = new Map<string, string>()
  for (const group of input.tags) for (const id of group.sessionIds) tagOf.set(id, group.id)
  const orderByWorkspace = new Map(input.tags.map((g) => [g.workspaceId, input.tags.filter((t) => t.workspaceId === g.workspaceId).map((t) => t.id)]))

  const view = {
    pinned: input.pinned,
    unread: new Set(input.unread),
    tagOrderFor: (workspaceId: string): readonly string[] => orderByWorkspace.get(workspaceId) ?? [],
    sessionTagForWs: (sessionId: string): string | undefined => tagOf.get(sessionId),
  }
  // 工作区清单为空时**照样**交给 `buildSessionTree`：它会把没被任何工作区引用的会话收进
  // 「未分组」桶（`sessionTree.ts:444-458`）——旧侧栏在「工作区全没了但会话还在」时的形态
  // 就是「引导文案 + 未分组桶」，与现装配侧把 `workspace/follow` 清空后的形态一致。
  const tree = buildSessionTree(
    workspaces,
    model.sessions,
    model.archived,
    (s) => s.title ?? null,
    // 旧侧栏在 VS Code 里拿的「当前工作区」判据就是这一步：`sessionsStore` 把
    // `vscode.workspace.workspaceFolders[0].uri.fsPath` 传给 `buildSessionTree`。
    // harness 给的是同一份（现装配侧的假宿主上报的也是它），两侧判据的**输入**一致。
    input.currentFolder,
    Date.now(),
    { ...view, excludedSessionIds: recycleSet },
    vscodeL10nT,
  )
  const recycleTree = input.recycleBin.length === 0
    ? []
    : buildSessionTree(
        model.workspaces,
        model.sessions,
        model.archived,
        (s) => s.title ?? null,
        undefined,
        Date.now(),
        { pinned: input.pinned, unread: new Set(input.unread), onlySessionIds: recycleSet, recycleOrder: input.recycleBin },
        vscodeL10nT,
      ).filter((w) => w.sessions.length > 0)

  const countTag = (workspaceId: string, tagId: string): number =>
    input.tags.find((t) => t.workspaceId === workspaceId && t.id === tagId)?.sessionIds.filter((id) => !recycleSet.has(id)).length ?? 0

  return {
    workspaces: tree,
    query: input.query ?? null,
    serverState: 'running',
    dshNotFound: false,
    pinned: [...input.pinned],
    collapsed: [...input.collapsed],
    unread: [...input.unread],
    recycleBin: [...input.recycleBin],
    recycleWorkspaces: recycleTree,
    recycleCollapsed: [],
    activeSessionId: input.activeSessionId,
    attachedSessionId: input.activeSessionId,
    contentSearchHasMore: false,
    contentSearchError: false,
    baselineReady: true,
    groups: [],
    activeGroupId: null,
    groupMembership: {},
    workspaceDirectory: workspaces.map((w) => ({ workspaceId: w.workspaceId, label: w.title })),
    tags: input.tags.map((group) => ({
      workspaceId: group.workspaceId,
      id: group.id,
      name: group.name,
      color: group.color,
      preset: false,
      count: countTag(group.workspaceId, group.id),
    })),
    tagSessionIds: Object.fromEntries(input.tags.map((group) => [group.id, [...group.sessionIds]])),
    tagCollapsed: {},
  }
}

/* ---------------------------------------------------------------------------
 * ② 现装配侧：假宿主状态存储 + 官方客户端 localStorage 视图态
 * ------------------------------------------------------------------------ */

/**
 * 假宿主 `stateRead` 的键 → 值。
 *
 * 键名与形状**必须**按官方惯例那一套（`~/.dsh/dsh-one/<键>.json`）：`pinned` /
 * `unread` 用规范形状 `{version:1, sessionIds:[…]}`，`tags` 用 v2（
 * `{version:2, workspaces:{…}}`），`recycle-bin` 用裸 id 数组——与旧侧栏那几份文件
 * 逐字同形，这也是「同一份数据」在现装配侧的原生入口。
 */
export function currentSideHostState(input: {
  pinned: string[]
  unread: string[]
  tags: TagGroupSeed[]
  recycleBin: string[]
}): Record<string, unknown> {
  const workspaces: Record<string, { tags: { id: string; name: string; color: TagColor }[]; sessionTags: Record<string, string> }> = {}
  for (const group of input.tags) {
    const bucket = (workspaces[group.workspaceId] ??= { tags: [], sessionTags: {} })
    bucket.tags.push({ id: group.id, name: group.name, color: group.color })
    for (const sessionId of group.sessionIds) bucket.sessionTags[sessionId] = group.id
  }
  return {
    pinned: { version: 1, sessionIds: [...input.pinned] },
    unread: { version: 1, sessionIds: [...input.unread] },
    tags: { version: 2, workspaces },
    'recycle-bin': [...input.recycleBin],
  }
}
