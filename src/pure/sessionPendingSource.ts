/**
 * 官方「会话等待态」的取用路径（#184）——单一事实源 + 版本分叉。
 *
 * 等待态 = 这条会话正在等用户答复（等审批 / 等提问 / 等计划确认），侧栏会话行那枚黄点
 * 看它。官方客户端上有两代取法：
 *
 * - **0.1.6-alpha.1 及以前**：root 钩子 `sessionPendingInteraction`，它的快照**就是**
 *   一张等待态表（会话 id → `{key, kind, sessionId}`，只有等待中的会话在表里）；
 * - **0.1.6-alpha.2 起**：那条钩子没了，换成 root 钩子 `sessionStatus`，快照是「每条
 *   会话一行」的状态表（会话 id → `{running, pendingInteraction, completionUnread}`），
 *   等待态在 `pendingInteraction` 那一格；等待态在那代官方产物里的取值名也从
 *   `pendingInteractions`（服务上的字段）变成 `pendingInteraction`（状态对象的一格）。
 *   同一版本另有新增的 keyed 钩子 `sessionRetainInfo`（会话的本地引用计数，与等待态
 *   无关，我方不用）。
 *
 * 两代的**等待态值形状相同**（都是 `{key, kind, sessionId}`），差别只在外层那张表，
 * 所以这里按「钩子在不在场」分叉：有 `sessionStatus` 就取它并把等待态挑出来，没有就用
 * 老钩子；**两条都不在**时 `pendingSourceOf` 返回 `null`——调用方据此在页面上给一行
 * 可见的事实，而不是静默地不点亮（#184：等待态这条依赖不许是静默失效型）。
 * 注意「不在场」的后果不止是点不亮：组件解构出来的钩子是 `undefined`，直接调用会抛错，
 * 让整棵树的槽位条目崩掉——所以分叉必须发生在调用之前。
 *
 * 这份名字表同时是上游探针的输入（`scripts/dsh-upstream-watch/clientContract.mjs` import
 * 它，与 `src/pure/dshWire.ts` 同一处置，#37）：产品侧改了取用名，探针自动按新名去官方
 * `combo`（网关把全部前端插件拼成的那个大文件）里查在场。
 *
 * 纯逻辑：不 import react、不碰官方包、无副作用——探针是裸 node 脚本，靠 Node 的类型剥离
 * 直接 import 本文件（import 说明符要带 `.ts` 后缀）。
 */
import type { PendingInteractionLike, PendingInteractions } from './workspaceTreeView.ts'

/** 会话状态的一格（官方 0.1.6-alpha.2 起那条钩子的取值形状；我们取两格）。 */
export interface SessionStatusLike {
  /** 该会话上优先号最高的那条等待态请求；没有等待中的请求时为 undefined。 */
  readonly pendingInteraction?: PendingInteractionLike
  /**
   * 「跑完还没被打开」（侧栏行那枚绿色提醒点）。**这一格是 #191 才归到这条钩子上的**：
   * 0.1.6-alpha.1 及以前它在会话列表的行上（`byId[id].completed`，见
   * `dsh-api-session-controller` 的 projectList），alpha.2 起行上没有了，官方把它挪进
   * 这张状态表（官方 `dsh-client-ui-session` 维护它：会话跑起来就清掉，会话成为**主对话区
   * 当前会话**时也清掉）。
   */
  readonly completionUnread?: boolean
}

/**
 * 老代钩子的快照：会话 id → 等待态（只有等待中的会话在表里）。
 *
 * 与视图层的 `PendingInteractions` 是同一形状——投影的结果直接喂给视图层，不另造一套。
 */
export type PendingSnapshot = PendingInteractions

/** 新代钩子的快照：会话 id → 会话状态（每条会话都在表里）。 */
export type SessionStatusSnapshot = ReadonlyMap<string, SessionStatusLike>

/**
 * 组件从槽位 props 上拿到的两条钩子（官方框架按 `use<Name>` 映射下发的名字）。
 * 两个都是可选的：一条是旧版给的，一条是新版给的，同一页上只会有一条。
 */
export interface PendingHookProps {
  /** 0.1.6-alpha.1 及以前那条：快照就是等待态表。 */
  readonly useSessionPendingInteraction?: <R>(selector: (state: PendingSnapshot) => R) => R
  /** 0.1.6-alpha.2 起那条：快照是会话状态表，等待态在里面那一格。 */
  readonly useSessionStatus?: <R>(selector: (state: SessionStatusSnapshot) => R) => R
}

/** 一条可用的取用路径：哪一代、props 上是哪个名字、怎么读、怎么投影成等待态表。 */
export interface PendingSource {
  /** 官方 root 钩子名（探针按它查 `provideRoot` 有没有下发）。 */
  readonly hook: string
  /** 该钩子映射出的槽位 props 名（组件解构的就是它）。 */
  readonly prop: string
  /** 从 props 上读一次快照（内部就是调用那一条钩子）。 */
  readonly read: (props: PendingHookProps) => unknown
  /** 把快照投影成等待态表（只留等待中的会话；老代原样返回同一份）。 */
  readonly project: (snapshot: unknown) => PendingSnapshot
  /**
   * 「跑完还没被打开」在这一代有没有第二个来源（#191）：新代从状态表里挑出 `completionUnread`
   * 的那些会话 id；**老代给 `undefined`**——那一代这一格在会话列表的行上、行里带着 `completed`，
   * 不需要也不该覆盖它（覆盖成空表会把绿点全灭掉）。
   */
  readonly completedIds?: (snapshot: unknown) => ReadonlySet<string>
}

/**
 * 两代取用路径，**新→旧**（`pendingSourceOf` 按这个顺序挑；探针从这里取名字）。
 *
 * `field` 是该代官方产物里等待态（表 / 那一格）的取值名，探针按它在官方 `combo` 里查
 * 在场——名字消失就意味着我们这条取用路径在该版本上失效。
 */
export const PENDING_SOURCES: readonly { readonly hook: string; readonly prop: string; readonly field: string }[] = [
  { hook: 'sessionStatus', prop: 'useSessionStatus', field: 'pendingInteraction' },
  { hook: 'sessionPendingInteraction', prop: 'useSessionPendingInteraction', field: 'pendingInteractions' },
]

/** 没有等待态的表（两条钩子都不在时用它，界面照常渲染，只是没有等待态）。 */
export const NO_PENDING: PendingSnapshot = new Map()

/** 按钩子名取一条路径（表里没登记的名字返回 undefined）。 */
const SOURCES: ReadonlyMap<string, PendingSource> = new Map<string, PendingSource>([
  [
    'sessionStatus',
    {
      hook: 'sessionStatus',
      prop: 'useSessionStatus',
      read: (props) => props.useSessionStatus?.((state) => state),
      /** 新版：同一张表里的另一格。 */
      completedIds: (snapshot) => {
        const ids = new Set<string>()
        for (const [sessionId, status] of snapshot as SessionStatusSnapshot) {
          if (status.completionUnread === true) ids.add(sessionId)
        }
        return ids
      },
      /** 新版：从每条会话的状态里挑出有等待态的那些，表形状与视图层那份一致。 */
      project: (snapshot) => {
        const table = new Map<string, PendingInteractionLike>()
        for (const [sessionId, status] of snapshot as SessionStatusSnapshot) {
          const pending = status.pendingInteraction
          if (pending !== undefined) table.set(sessionId, pending)
        }
        return table
      },
    },
  ],
  [
    'sessionPendingInteraction',
    {
      hook: 'sessionPendingInteraction',
      prop: 'useSessionPendingInteraction',
      read: (props) => props.useSessionPendingInteraction?.((state) => state),
      /** 老版：快照本身就是等待态表，原样交出去（同一份引用，不多一次遍历）。 */
      project: (snapshot) => snapshot as PendingSnapshot,
    },
  ],
])

/**
 * 挑一条可用路径：新版优先、老版兜底，**两条都不在返回 `null`**。
 *
 * 按 props 上「有没有这个函数」判，而不是按 dsh 版本号判：钩子是官方框架按各插件注册
 * 的 `provideRoot` 下发的，在场与否就是这一页真实的契约面（引用当前版本号的还得多一条
 * 「版本号从哪来」的猜测，也不覆盖自定义 profile 换过插件的情形）。
 */
export function pendingSourceOf(props: PendingHookProps): PendingSource | null {
  for (const { hook, prop } of PENDING_SOURCES) {
    if (typeof (props as Record<string, unknown>)[prop] !== 'function') continue
    const source = SOURCES.get(hook)
    if (source !== undefined) return source
  }
  return null
}
