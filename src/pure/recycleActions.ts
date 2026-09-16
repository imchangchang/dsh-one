/**
 * 回收站/归档的**可复用批量动作**（#103 的第 6 条）：把「怎么执行」从界面里拿出来，
 * 任何入口（会话行菜单、回收站行菜单、抽屉底部、多选操作条）都调这里同一份实现。
 *
 * 三条动作与两层语义一一对应（#98 A1）：
 * | 动作 | 动谁 | 可逆吗 |
 * | --- | --- | --- |
 * | {@link moveSessionsToRecycleBin} | **只动我们自己的** `recycle-bin` 集合 | 可逆（还原即在树里重新出现） |
 * | {@link restoreSessionsFromRecycleBin} | 只动 `recycle-bin` 集合 | —— |
 * | {@link archiveSessionsPermanently} | 官方 `archiveSession`（**终点**） | 不可逆 |
 * `emptyRecycleBin` = 把回收站里每一条都永久归档（抽屉的「清空」就是它）。
 *
 * 纯逻辑：不碰 DOM、不认识 React，宿主能力口与官方服务都从参数 {@link RecycleBinSink}
 * 进来，所以 node --test 能拿假件把「移入不动 dsh」「归档逐个走官方、失败项如实报出」
 * 这些语义钉住（见 test/recycleActions.test.ts）。
 */
import { moveIntoRecycleBin, restoreFromRecycleBin, type RecycleBinFile } from './recycleBinState.ts'
import { canArchive, type SessionEligibilityFacts } from './sessionEligibility.ts'

/**
 * 动作要用到的三个口（实现在 recycleBinStore.ts 里对接到宿主能力口与官方服务）。
 */
export interface RecycleBinSink {
  /** 读回当前回收站状态（实现内部做「只加载一次」的缓存）。 */
  load(): Promise<RecycleBinFile>
  /** 落定新状态（实现负责持久化 + 通知订阅者）。 */
  commit(file: RecycleBinFile): Promise<void>
  /**
   * 官方归档：`uiWorkspace.archiveSession(id)`（官方 navigation.d.ts 里就有这条，
   * 不是我们自造）。**这是终点动作**，与本地的回收站集合无关。
   */
  archiveSession(sessionId: string): Promise<void>
}

/** 一次批量动作的结果：做成/失败各报了谁。 */
export interface ActionOutcome {
  /** 真正生效的会话 id（移入=新进集合的、还原=真移出的、归档=归档成功的）。 */
  readonly done: readonly string[]
  /** 没做成的会话 id（界面据此报错，不静默吞掉）。 */
  readonly failed: readonly string[]
}

const NOTHING: ActionOutcome = { done: [], failed: [] }

/**
 * 把会话移入回收站：**只写本地集合**（按给定顺序追加到移入顺序尾部），dsh 侧一个
 * 字节不动。已经在集合里的 id 不算失败、也不重复追加。
 */
export async function moveSessionsToRecycleBin(
  sessionIds: readonly string[],
  sink: RecycleBinSink,
): Promise<ActionOutcome> {
  const current = await sink.load()
  const next = moveIntoRecycleBin(current, sessionIds)
  if (next === null) return NOTHING
  const before = new Set(current.sessionIds)
  const done = next.sessionIds.filter((id) => !before.has(id))
  try {
    await sink.commit(next)
  } catch {
    return { done: [], failed: done }
  }
  return { done, failed: [] }
}

/** 从回收站还原：只写本地集合（移出），dsh 侧不动。 */
export async function restoreSessionsFromRecycleBin(
  sessionIds: readonly string[],
  sink: RecycleBinSink,
): Promise<ActionOutcome> {
  const current = await sink.load()
  const next = restoreFromRecycleBin(current, sessionIds)
  if (next === null) return NOTHING
  const remaining = new Set(next.sessionIds)
  const done = current.sessionIds.filter((id) => !remaining.has(id))
  try {
    await sink.commit(next)
  } catch {
    return { done: [], failed: done }
  }
  return { done, failed: [] }
}

/**
 * 永久归档：逐个走官方 `archiveSession`（**串行**：归档会更新官方工作区注册表，
 * 逐个落地才能精确报出失败项），成功的那几条同时从本地回收站集合里划掉——不靠
 * 下一轮清账兜底，用户点完就能看到它们从抽屉里消失。
 */
export async function archiveSessionsPermanently(
  sessionIds: readonly string[],
  sink: RecycleBinSink,
): Promise<ActionOutcome> {
  const done: string[] = []
  const failed: string[] = []
  for (const sessionId of sessionIds) {
    try {
      await sink.archiveSession(sessionId)
      done.push(sessionId)
    } catch {
      failed.push(sessionId)
    }
  }
  if (done.length > 0) {
    const current = await sink.load()
    const next = restoreFromRecycleBin(current, done)
    if (next !== null) {
      try {
        await sink.commit(next)
      } catch {
        // 本地集合没划掉不算动作失败：集合里的这些 id 会在下一次清账时被剔除
        //（它们此刻已是官方归档状态，清账口径正是「dsh 侧不认识的 id」）。
      }
    }
  }
  return { done, failed }
}

/**
 * 把一批会话切成「可以归档的」与「会被跳过的」，顺序按传入顺序原样保留。
 *
 * 判定用 `sessionEligibility.canArchive`（与行菜单的禁用态、勾选框的资格**同一份**
 * 判断，不另写一套）；批量归档的确认弹窗按它列明细并写明跳过数。
 */
export function partitionArchivable<T extends SessionEligibilityFacts>(
  sessions: readonly T[],
): { readonly ready: T[]; readonly skipped: T[] } {
  const ready: T[] = []
  const skipped: T[] = []
  for (const session of sessions) (canArchive(session) ? ready : skipped).push(session)
  return { ready, skipped }
}

/**
 * 清空回收站 = 把里面每一条都永久归档（不可逆，界面必须先用确认弹窗说清楚）。
 * 返回的 `failed` 是归档失败的那几条（它们会留在抽屉里，用户可以再试）。
 */
export async function emptyRecycleBin(sink: RecycleBinSink): Promise<ActionOutcome> {
  const current = await sink.load()
  if (current.sessionIds.length === 0) return NOTHING
  return await archiveSessionsPermanently(current.sessionIds, sink)
}
