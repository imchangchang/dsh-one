/**
 * 页内数据集夹具（#162）：给装配页喂一份**套件自己声明**的工作区与会话。
 *
 * 为什么要有这个东西：一批套件的判据原来吃的是「这台机器上碰巧有什么」——当天网关
 * 有几棵工作区、几个会话、它们叫什么、怎么分组。这类判据在开发者日常实例上绿，在一台
 * 从没用过的机器（全新 `DSH_HOME`，工作区与会话都是零）上红，而且红的是判据自己不是
 * 功能（#148 立、#162 普查）。把数据来源换成这份夹具之后，判据一个字不用改，红了就
 * 真的是功能坏了。
 *
 * 它改的是**页面收到的帧与回执**，请求照样打到网关（网关只读）：
 * - `workspace/follow` 的基线帧 → 夹具声明的工作区（其余工作区帧一律丢掉，免得真工作区
 *   从增量里回来，合成的那几棵就不是唯一的那几棵了）；
 * - `session/list` 的回执 → 夹具声明的会话。
 *
 * 装法是**装在浏览器上下文上**（`browserContext.route` / `browserContext.routeWebSocket`），
 * 在页面第一次导航之前就生效，所以套件不用为了夹具再重载一次页面；`openTreePage` 的
 * `dataset` 选项就是干这个的。宿主要自己造数据的套件（例如夹具要改写会话标题的 F-49）
 * 仍然可以用 `page.route` 覆盖这一层——Playwright 里页面级路由优先于上下文级路由。
 */
import type { BrowserContext } from 'playwright'

/** 一棵夹具工作区。`sessionIds` 决定哪些夹具会话挂在它下面（树按它分组）。 */
export interface LabWorkspaceSpec {
  workspaceId: string
  path: string
  title: string
  sessionIds: readonly string[]
}

/** 一条夹具会话。字段面按官方 `session/list` 回执里我们真正消费的那几项给。 */
export interface LabSessionSpec {
  sessionId: string
  title: string
  cwd: string
  /** 最近更新时刻（epoch ms）；相对时间的渲染拿它当输入。 */
  updatedAt: number
  blank?: boolean
  running?: boolean
  /** 定时任务标记（官方 `schedule` 投影）；缺省无。 */
  schedule?: readonly unknown[]
}

export interface LabDataset {
  readonly workspaces: readonly LabWorkspaceSpec[]
  readonly sessions: readonly LabSessionSpec[]
}

/** 夹具数据的来源说明（报告里能看到这一轮喂的是什么）。 */
export const DATASET_NOTE =
  '工作区与会话由页内夹具声明（#162）：`workspace/follow` 基线帧 + `session/list` 回执被换成夹具那一份，请求不落到网关，判据不再吃运行环境里的数据。'

/**
 * 侧栏套件通用的那一份：四棵工作区（名字两两不互为子串，搜索类断言才有「过滤外」那一侧），
 * 会话分布 4 / 3 / 3 / 2，够覆盖「≥2」「≥3」「≥4 条会话行」这几档前置。
 *
 * 标题里刻意不含 `lab` 之外的词，也不含各套件用的查询串（如 `zz-lab-no-match`），
 * 免得搜索类断言被夹具自己撞上。
 */
export const SIDEBAR_DATASET: LabDataset = buildSidebarDataset()

function buildSidebarDataset(): LabDataset {
  const workspaces: LabWorkspaceSpec[] = [
    { workspaceId: 'lab-ws-alpha', path: '/lab/alpha', title: 'Lab Alpha', sessionIds: [] },
    { workspaceId: 'lab-ws-beta', path: '/lab/beta', title: 'Lab Beta', sessionIds: [] },
    { workspaceId: 'lab-ws-gamma', path: '/lab/gamma', title: 'Lab Gamma', sessionIds: [] },
    { workspaceId: 'lab-ws-delta', path: '/lab/delta', title: 'Lab Delta', sessionIds: [] },
  ]
  const counts = [4, 3, 3, 2]
  const sessions: LabSessionSpec[] = []
  const base = Date.now()
  let index = 0
  workspaces.forEach((workspace, workspaceIndex) => {
    const ids: string[] = []
    for (let n = 0; n < (counts[workspaceIndex] ?? 0); n += 1) {
      index += 1
      const id = `lab-session-${String(index).padStart(2, '0')}`
      ids.push(id)
      sessions.push({
        sessionId: id,
        title: `${workspace.title} task ${String(n + 1)}`,
        cwd: workspace.path,
        // 越靠后越新：相对时间那一格有内容，排序也稳定。
        updatedAt: base - index * 600_000,
        blank: false,
        running: false,
      })
    }
    workspace.sessionIds = ids
  })
  return { workspaces, sessions }
}

/** 夹具会话 → 官方 `session/list` 回执里的条目（字段面按真回执收窄）。 */
export function datasetSessionItem(session: LabSessionSpec): Record<string, unknown> {
  return {
    sessionId: session.sessionId,
    updatedAt: session.updatedAt,
    running: session.running === true,
    blank: session.blank === true,
    cwd: session.cwd,
    projections: {
      // `asOfSeq` 是真回执里必带的一项（官方 `SessionSeq` 编解码器要求非负安全整数，
      // 缺了会在页面里抛 `SessionSeq must be a non-negative safe integer`，整份清单
      // 因此落不了地——实测踩过一次）。
      asOfSeq: 0,
      values: {
        title: session.title,
        ...(session.schedule === undefined ? {} : { schedule: session.schedule }),
        sessionListMetadata: { blank: session.blank === true, lastPromptAt: session.updatedAt },
      },
    },
  }
}

/** 夹具工作区 → `workspace/follow` 基线帧里的条目（借真 item 的字段面）。 */
function datasetWorkspaceItem(workspace: LabWorkspaceSpec, template: unknown): Record<string, unknown> {
  const base = typeof template === 'object' && template !== null ? (template as Record<string, unknown>) : {}
  return {
    ...base,
    workspaceId: workspace.workspaceId,
    path: workspace.path,
    title: workspace.title,
    sessionIds: [...workspace.sessionIds],
    createdAt: typeof base.createdAt === 'string' ? base.createdAt : new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  }
}

export interface DatasetStats {
  /** `workspace/follow` 基线帧被换成夹具工作区的次数。 */
  workspaceFrames: number
  /** `session/list` 回执被换成夹具会话的次数。 */
  sessionList: number
  /** 丢掉的非基线工作区帧数（>0 说明真工作区的增量确实被挡住了）。 */
  droppedWorkspaceFrames: number
}

/**
 * 页面上「看得到会话行」的两把钥匙（**两处都要**，实测过）：
 *
 * - 自有树按客户端惯例键 `dsh.workspaceTree.view` 里的展开集合渲染行：**没展开的分组一行
 *   都不渲染**，而缺省只展开「当前会话那一组」——夹具里没有「当前会话」，于是得由夹具把
 *   这几棵声明成展开态，套件才有行可量（这就是为什么数据集夹具必须连视图态一起给）。
 * - 官方浏览区（`sidebar-official` 对照档）按官方自己的恢复键 `dsh.sessions.current` 决定
 *   展开哪一棵，所以夹具还要把「当前会话」指到第一棵工作区的一条夹具会话上。
 *
 * 两处都设之后，自有树 12 行、官方侧 4 行（第一棵那一组），PARITY 这类「两侧各取一条
 * 会话行比一比」的套件两边都取得到。实测读数与排查过程见 #162 的结论。
 */
function datasetViewStateScript(dataset: LabDataset): string {
  const view = {
    activeGroupId: null,
    groupExpansion: Object.fromEntries(dataset.workspaces.map((workspace) => [workspace.workspaceId, true])),
    recycleCollapsed: [],
    tagCollapsed: [],
  }
  const current = dataset.workspaces[0]?.sessionIds[0]
  return `(() => {
  try {
    localStorage.setItem('dsh.workspaceTree.view', ${JSON.stringify(JSON.stringify(view))})
    ${
      current === undefined
        ? ''
        : `localStorage.setItem('dsh.sessions.current', ${JSON.stringify(JSON.stringify({ sessionId: current }))})`
    }
  } catch (err) { /* 隐私模式下 localStorage 不可用就跳过：夹具是尽力而为，判据会如实报出来 */ }
})()`
}

/**
 * 在浏览器上下文上装这份数据集夹具。**要在页面第一次导航之前调用**（`openTreePage`
 * 的 `dataset` 选项就是这么做的），这样首帧基线就已经是夹具那一份。
 */
export async function installLabDataset(context: BrowserContext, dataset: LabDataset): Promise<DatasetStats> {
  const stats: DatasetStats = { workspaceFrames: 0, sessionList: 0, droppedWorkspaceFrames: 0 }
  await context.addInitScript({ content: datasetViewStateScript(dataset) })
  await context.routeWebSocket(/remote\.mux/, (socket) => {
    const upstream = socket.connectToServer()
    const endpoints = new Map<string, string>()
    socket.onMessage((message) => {
      try {
        const frame = JSON.parse(String(message)) as { type?: string; streamId?: string; endpoint?: string }
        if (frame.type === 'open' && frame.streamId !== undefined && frame.endpoint !== undefined) {
          endpoints.set(frame.streamId, frame.endpoint)
        }
      } catch {
        /* 客户端帧形状变了就原样转发（夹具不参与协议解读） */
      }
      upstream.send(message)
    })
    upstream.onMessage((message) => {
      const text = String(message)
      let frame:
        | { streamId?: string; type?: string; value?: { type?: string; value?: { items?: unknown[]; archivedSessionIds?: unknown } } }
        | undefined
      try {
        frame = JSON.parse(text) as typeof frame
      } catch {
        frame = undefined
      }
      const endpoint = frame?.streamId === undefined ? undefined : endpoints.get(frame.streamId)
      if (endpoint !== 'workspace/follow') {
        socket.send(message)
        return
      }
      const payload = frame?.value
      if (frame?.type === 'item' && payload?.type === 'baseline' && payload.value !== undefined) {
        const template = (payload.value.items ?? []).find((item) => typeof (item as { path?: unknown }).path === 'string')
        payload.value.items = dataset.workspaces.map((workspace) => datasetWorkspaceItem(workspace, template))
        // 归档集合清空/fixture 声明的那几项：留着真归档集合只会让「哪个会话在树里」不确定。
        payload.value.archivedSessionIds = []
        stats.workspaceFrames += 1
        socket.send(JSON.stringify(frame))
        return
      }
      stats.droppedWorkspaceFrames += 1
    })
  })
  await context.route('**/api/**', async (route) => {
    const method = decodeURIComponent(route.request().url()).split('/api/')[1] ?? ''
    if (!method.startsWith('session/list')) {
      await route.continue()
      return
    }
    const response = await route.fetch()
    const body = await response.text()
    let parsed: { result?: { value?: { items?: unknown } } } | undefined
    try {
      parsed = JSON.parse(body) as typeof parsed
    } catch {
      parsed = undefined
    }
    const value = parsed?.result?.value
    if (value === undefined || !Array.isArray(value.items)) {
      await route.fulfill({ response, body })
      return
    }
    value.items = dataset.sessions.map((session) => datasetSessionItem(session))
    stats.sessionList += 1
    await route.fulfill({ response, body: JSON.stringify(parsed) })
  })
  return stats
}
