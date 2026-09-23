/**
 * 隔离实例的**播种**（#177）：整轮开始前，经官方 RPC 往实例里写入真数据。
 *
 * 为什么是「真造」而不是页内夹具（#177 的用户拍板）：以前的空实例跑法只能让套件在页面里
 * 自造帧，判据离真实差一层——自起的实例是可写的，所以正解是在实例里把数据造出来，
 * 套件面对的是真工作区、真会话、真状态。播种只写**本次运行的临时 `DSH_HOME`**
 * （见 `labGateway.ts` 的隔离保证），用户的 `~/.dsh` 一个字节都不动。
 *
 * 造什么（`seed` 这份账目会传给套件，套件按它找行，不再猜）：
 * - **工作区**：五棵真工作区（临时目录注册进实例），顺序即注册顺序。这些目录都建在
 *   **本次运行的临时 `DSH_HOME` 里面**（`<home>/lab-workspaces/<名字>`），所以收尾
 *   删 `DSH_HOME` 时它们一起没了——不会留下第二个临时目录要单独收（#177 的验收项
 *   「零临时目录」就是这一条）；
 * - **空闲会话**：四棵普通工作区按 4 / 3 / 3 / 2 条（与 `dataset.ts` 那份合成数据的
 *   形状对齐，判据的阅读习惯不变），每条都真跑过一轮对话——dsh 里 `blank: true` 的会话
 *   **不上树**，光 `session/create` 造不出行；
 * - **特殊状态**（都在最后一棵工作区，免得污染其它工作区的活状态计数）：运行中 / 等审批 /
 *   等回答 各一条，由假模型端点（`labLlm.ts`）按提示词编排真造出来；
 * - **归档**：一条真归档会话（`workspace.archiveSession`），归档语义是真的。它**在整轮播种里
 *   最先建**——`session/list` 是「新建在前」的倒序，最先建的排在最后，于是套件那些「取清单里
 *   第一条能用的会话」的动作不会挑到它（归档会话在页面上**打不开**：客户端渲染的是首屏空态，
 *   实测过），不会白白红一条与归档无关的判据；
 * - **空白会话**：每棵工作区一条（不上树）——官方客户端挂载时会去「最近的工作区」找一条
 *   空白会话落脚，没有现成的它会**自己新建一条**（那是往实例里写，且每开一页写一条）。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { archiveSession, createSession, ensureWorkspace, listSessions, promptSession, renameSession, type SessionSummary } from '../../src/server/dshRpc.ts'
import type { LogSink } from '../../src/log.ts'
import { LAB_PROMPTS } from './labLlm.ts'

/** 一条播种会话的状态（播种那一刻在实例上的真实状态）。 */
export type LabSessionState = 'blank' | 'idle' | 'running' | 'approval' | 'question' | 'archived'

export interface LabSeedSession {
  sessionId: string
  title: string
  workspaceId: string
  state: LabSessionState
}

export interface LabSeedWorkspace {
  workspaceId: string
  path: string
  title: string
  sessionIds: readonly string[]
}

export interface LabSeed {
  workspaces: readonly LabSeedWorkspace[]
  sessions: readonly LabSeedSession[]
  archivedSessionIds: readonly string[]
}

interface WorkspaceSpec {
  title: string
  /** 空闲会话的条数（0 = 只有特殊状态那几条）。 */
  idle: number
  /** 这条工作区里要造的特别状态（按顺序）。 */
  special?: readonly Exclude<LabSessionState, 'blank' | 'idle' | 'archived'>[]
  /** 这条工作区里真归档一条（归档的会话不上树；**在这一棵里最先建**，理由见文件头）。 */
  archived?: boolean
}

/**
 * 播种清单。**数组顺序 = 创建顺序**，而树里看到的是**倒序**（新建的工作区排在最前，
 * `workspace/follow` 的实测顺序是这样）——所以这里按倒序写，树里读起来才是
 * `Lab-Alpha → Lab-Beta → Lab-Gamma → Lab-Delta → Lab-States`。
 *
 * 两个刻意的位置：
 * - **特殊状态（运行中 / 等审批 / 等回答）放最后创建的那一棵**（= 树里的最后一行）：
 *   活状态计数是这些会话贡献的，「取树上第一行当夹具」的那些套件（F-16 / F-31 / F-34 /
 *    F-39 / F-43 / F-52…）才不会一上手就撞上一条跑着的会话（#177 实测：不放最后时
 *    F-16 / F-34 / F-39 / F-43 一起红）。
 * - **归档那条放最先创建的那一棵**：`session/list` 是新建在前的倒序，它因此排在清单
 *   最后，不会被「取清单里第一条能用的会话」的动作挑中（归档会话在页面上打不开）。
 */
const WORKSPACE_SPECS: readonly WorkspaceSpec[] = [
  { title: 'Lab-States', idle: 1, special: ['running', 'approval', 'question'], archived: true },
  { title: 'Lab-Delta', idle: 2 },
  { title: 'Lab-Gamma', idle: 3 },
  { title: 'Lab-Beta', idle: 3 },
  { title: 'Lab-Alpha', idle: 4 },
]

/** 一棵工作区里的会话标题（`<工作区名> task N`；与 `dataset.ts` 那份合成数据同形）。 */
function idleTitles(spec: WorkspaceSpec): string[] {
  return Array.from({ length: spec.idle }, (_, i) => `${spec.title} task ${String(i + 1)}`)
}

/**
 * 等到 `probe` 说成了（或超时）。播种是**有依赖的**（要等真回合跑完会话才非 blank、
 * 才拿得到标题），所以不许用固定 sleep 猜时间。
 */
async function waitUntil(what: string, probe: () => Promise<boolean>, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await probe()) return
    if (Date.now() > deadline) throw new Error(`播种：等「${what}」超时（${String(timeoutMs / 1000)} 秒）`)
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

/** 按 id 取会话行（`session/list` 一次一取；播种是小数据，不值得做缓存）。 */
async function sessionById(gateway: string, sessionId: string): Promise<SessionSummary | undefined> {
  const items = await listSessions(gateway)
  return items.find((item) => item.sessionId === sessionId)
}

/** 这条会话已经跑过至少一轮（`blank` 落回 false = 会上树）。 */
function isLanded(session: SessionSummary | undefined): boolean {
  return session !== undefined && session.blank !== true
}

/**
 * 往隔离实例里播种（见文件头）。返回的账目交给套件。
 *
 * 每一步都用官方 RPC（与官方客户端同一条路）：`workspace/create`、`session/create`、
 * `session/prompt`、`session/rename`、`workspace/archiveSession`。
 *
 * `home` 是这台实例的临时 `DSH_HOME`：工作区目录建在它里面，收尾删 home 时一并消失。
 */
export async function seedLabInstance(gateway: string, home: string, log: LogSink): Promise<LabSeed> {
  const root = await fsp.mkdtemp(path.join(home, 'lab-workspaces-'))
  const workspaces: LabSeedWorkspace[] = []
  const sessions: LabSeedSession[] = []
  const archivedSessionIds: string[] = []

  for (const spec of WORKSPACE_SPECS) {
    const dir = path.join(root, spec.title)
    await fsp.mkdir(dir, { recursive: true })
    const workspace = await ensureWorkspace(gateway, dir)
    const workspaceId = workspace.workspaceId
    const made: LabSeedSession[] = []
    const prompt = async (text: string): Promise<string> => {
      const id = await createSession(gateway, { workspaceId })
      await promptSession(gateway, id, text)
      return id
    }

    // 归档那条**第一个建**（只落在第一棵工作区里）：`session/list` 是新建在前的倒序，
    // 于是它排在清单最后——归档会话在页面上打不开（客户端渲染首屏空态），排最后才不会
    // 被「取清单里第一条能用的会话」的动作挑中（#177 实测撞到过一次）。
    if (spec.archived === true) {
      const id = await prompt(LAB_PROMPTS.idle(99))
      // 归档前要等**这一轮真跑完**，不能只等「非 blank」。0.1.7-alpha.2 起官方拒绝归档
      // 正在跑一轮的会话：`workspace/session-active cannot archive session '…': the
      // session is active (turn)`——播种当场停在这第一步、整轮连页面都开不出来。
      // 0.1.6 及以前对活跃会话照收，所以这条前提一直没暴露（`blank` 落回 false 比这一轮
      // 结束早）。
      await waitUntil(`会话 ${String(id)} 跑完第一轮（非 blank 且不在跑）`, async () => {
        const row = await sessionById(gateway, id)
        return isLanded(row) && row?.running !== true
      })
      const title = await renameSession(gateway, id, `${spec.title} archived`)
      await archiveSession(gateway, id)
      archivedSessionIds.push(id)
      made.push({ sessionId: id, title, workspaceId, state: 'archived' })
    }

    // 空白会话：官方客户端挂载时找的就是它（见文件头最后一条）。
    const blank = await createSession(gateway, { workspaceId })
    sessions.push({ sessionId: blank, title: '', workspaceId, state: 'blank' })

    // 空闲会话：并行发提示词（同一台网关上互不相干），再逐条等它跑完第一轮。
    const idleIds = await Promise.all(
      idleTitles(spec).map(async (title, index) => ({ title, sessionId: await prompt(LAB_PROMPTS.idle(index + 1)) })),
    )
    for (const item of idleIds) {
      await waitUntil(`会话 ${item.sessionId} 跑完第一轮（非 blank）`, async () => isLanded(await sessionById(gateway, item.sessionId)))
      const title = await renameSession(gateway, item.sessionId, item.title)
      made.push({ sessionId: item.sessionId, title, workspaceId, state: 'idle' })
    }

    for (const state of spec.special ?? []) {
      const text =
        state === 'running' ? LAB_PROMPTS.running : state === 'approval' ? LAB_PROMPTS.approval : LAB_PROMPTS.question
      const id = await prompt(text)
      // 三条都会让这一轮一直挂着（这是播种的目的）：等实例自己报出运行中。
      await waitUntil(
        `会话 ${String(id)} 进「${state}」状态`,
        async () => (await sessionById(gateway, id))?.running === true,
      )
      const title = await renameSession(gateway, id, `${spec.title} ${state}`)
      made.push({ sessionId: id, title, workspaceId, state })
    }

    sessions.push(...made)
    workspaces.push({
      workspaceId,
      path: workspace.path,
      title: workspace.title,
      sessionIds: made.map((session) => session.sessionId),
    })
  }

  log.info(
    `隔离实例播种完成：${String(workspaces.length)} 棵工作区、${String(sessions.length)} 条会话` +
      `（其中 ${String(sessions.filter((s) => s.state !== 'blank' && s.state !== 'idle').length)} 条特殊状态、` +
      `${String(archivedSessionIds.length)} 条归档），工作区根目录 ${root}`,
  )
  return { workspaces, sessions, archivedSessionIds }
}
