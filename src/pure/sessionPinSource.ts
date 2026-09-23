/**
 * 「会话置顶」这份用户状态住哪（#240）——两代的取用与写入路径，单一事实源。
 *
 * 官方 0.1.7-alpha.1 起，侧栏自带会话置顶，状态在**官方工作区注册表**里（证据是
 * 0.1.7-alpha.2 的官方产物，逐条出处见下）：
 *
 * - **读**：工作区列表快照的 `pinnedSessionIds`。它与 `archivedSessionIds` 在同一份
 *   快照、同一个 `useWorkspaces` 钩子上（官方 `dsh-client-ui-workspace` 的浏览器源码
 *   原文 `const { items, pinnedSessionIds, archivedSessionIds } = this.workspaces.list
 *   .getSnapshot()`），类型注释原话「Complete registry-global pin set, most recently
 *   pinned first」——**全局一份**，不按工作区切（与归档集合同一口径）。
 * - **写**：官方 `uiWorkspace.pinSession(sessionId)` / `unpinSession(sessionId)`
 *   （`dsh-client-ui-workspace` 的 `UiWorkspace` 面）。前者注释原话「Pin a Session on
 *   the Host, then lead it in its accounts' saved orders」，后者「Unpin a Session on
 *   the Host; saved positions stay as they are」——语义与我们自有那套逐条相同
 *   （置顶 = 落在宿主注册表 + 在它所在那一层排最前）。
 *
 * 0.1.6-alpha.2 及以前没有这两样，我们自己的置顶住自有 `pinned` 键（见
 * `sessionMarks.ts` 的文件头）。两代的差别因此是**状态住哪儿**，判定按「这一页的官方
 * 产物里有没有那一格 / 那两个方法」——与等待态（`sessionPendingSource.ts`）同一处置：
 * 按在场与否分叉，不猜版本号（自定义 profile 换过插件时版本号也答不准）。
 *
 * 为什么必须合流（#240 的背景）：我们在 `sidebar.workspaces` 槽位上遮蔽官方侧栏，官方
 * 那套置顶 UI 在 dsh-one 里不渲染——状态不合流就是**同一件事两份互不相干的集合**：
 * 用户在官方 web 里置顶的会话，在 dsh-one 的树里不算置顶，反过来也一样。而同一件事的
 * 归档（`archiveSession`）我们早就走官方状态，两者口径本来就不一致。
 *
 * 探针（`scripts/dsh-upstream-watch/clientContract.mjs` 的 `IDENTIFIER_DEPENDENCIES`）
 * 读本模块导出的那几个名字常量，产品侧改了名字这里自动跟着查（与
 * `sessionPendingSource.ts` 的 `PENDING_SOURCES` 同一处置）。
 *
 * 纯逻辑：不 import react、不碰官方包、无副作用——探针是裸 node 脚本，靠 Node 的类型
 * 剥离直接 import 本文件（import 说明符要带 `.ts` 后缀）。
 */
import { sanitizeMarkIds } from './sessionMarks.ts'

/** 官方快照里那份置顶集合的字段名（探针按它在官方 combo 里查在场）。 */
export const PINNED_IDS_FIELD = 'pinnedSessionIds'

/** 官方那对写入方法的动词（探针按它们在官方 combo 里查在场）。 */
export const PIN_METHOD = 'pinSession'
export const UNPIN_METHOD = 'unpinSession'

/** 官方工作区快照里我们读的那一格（本模块不看快照的其它字段）。 */
export interface PinSnapshotLike {
  readonly pinnedSessionIds?: unknown
}

/** 官方那对写入方法所在的服务面（`uiWorkspace`），只认我们真调的两个方法名。 */
export interface PinWriteLike {
  readonly pinSession?: unknown
  readonly unpinSession?: unknown
}

/** 真调得动的那对方法（`isPinWrite` 判出来的形状）。 */
export interface PinWrite {
  readonly pinSession: (sessionId: string) => Promise<void>
  readonly unpinSession: (sessionId: string) => Promise<void>
}

/**
 * 从官方快照里读置顶集合：**不是这一代时给 `null`**（0.1.6 及以下快照里没有这一格）。
 *
 * 判据是「这一格是不是一个数组」——缺席、或上游哪天换了形状，都算「这一代不可用」，
 * 调用方退回自有 `pinned` 键。清洗沿用 id 集合那一套（非字符串、空串、重复丢掉）。
 *
 * 为什么这一格判据够用：官方那份快照的初值就是 `pinnedSessionIds = []` + `phase =
 * 'pending'`（0.1.7-alpha.2 的 `ClientWorkspaceModel` 逐字），所以「字段在不在」从第一
 * 帧起就是**这一代有没有**这个事实，不吃数据到没到；要判「官方集合读全了没有」看的是
 * `phase`，那是调用方的事（见 `workspaceTreePlugin.ts` 的 `adoptLegacyPins`）。
 */
export function registryPinnedIds(snapshot: PinSnapshotLike | undefined): readonly string[] | null {
  const raw = snapshot?.pinnedSessionIds
  return Array.isArray(raw) ? sanitizeMarkIds(raw) : null
}

/**
 * 这一页能不能走官方写入面：两个方法都在场才算。
 *
 * 按「是不是函数」判，与 {@link registryPinnedIds} 同一口径（在场即这一代）。两者同批
 * 发布，缺任何一个都说明这一页的官方产物不是我们认的那一版——那时候宁可如实报错，
 * 也不去调一个不存在的函数，更不静默落到自有键：那会让「界面读官方集合、写却进自有键」
 * 两下分叉，比报错难查得多。
 */
export function isPinWrite(service: PinWriteLike | undefined): service is PinWrite {
  return typeof service?.pinSession === 'function' && typeof service?.unpinSession === 'function'
}

/** 一次写入要发的两个动作（差量：只对变化的那些 id 调官方服务）。 */
export interface PinWrites {
  readonly pin: readonly string[]
  readonly unpin: readonly string[]
}

/**
 * 把「整份目标集合」翻成官方那两条方法的调用差量。
 *
 * 为什么我们的界面按**整份集合**写、而这里要算差量：自有那一代的状态形状就是「一份 id
 * 列表」，翻转一行就是交回一份新列表（`sessionMarks.toggleMarkId`）；官方那一代只有
 * 「按会话置顶 / 取消置顶」两条动作。多调一次虽然幂等（重发 pin 只把它再排到最前），
 * 但会多写一次官方注册表、也会动官方那份「手动顺序」记录，所以只对**差集**发动作。
 *
 * 顺序不参与比较：官方的置顶集合按「最近置顶的在前」自己排序，而渲染那一侧也不看集合
 * 内的顺序（`sessionMarks.pinnedFirst` 只按「在不在集合里」分流、层内保持官方顺序）。
 */
export function pinWrites(current: readonly string[], next: readonly string[]): PinWrites {
  const currentSet = new Set(current)
  const nextSet = new Set(next)
  return {
    pin: next.filter((id) => !currentSet.has(id)),
    unpin: current.filter((id) => !nextSet.has(id)),
  }
}
