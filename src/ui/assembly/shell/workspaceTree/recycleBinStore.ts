/**
 * 回收站的 UI 侧状态与动作绑定（#103）。
 *
 * ## 为什么是一个模块级的 store，而不是一条组件的 state
 * 底部回收站入口行与树主组件属**两个不同的座位**（`sidebar.footer.action` 与
 * `sidebar.workspaces` 的 shadow），但它们是**同一个插件、同一份 bundle**——模块作用域
 * 天然共享。入口行的角标、主树的过滤、抽屉的内容说的必须是同一件事（「本地回收站里
 * 有谁」），所以状态住在这里，两侧都订阅它；不查 DOM、不新增槽位、不跨插件借状态。
 *
 * ## 家在哪
 * 用户可感知的持久状态 → 宿主能力口（`stateRead/stateWrite('recycle-bin')`），落
 * `~/.dsh/dsh-one/recycle-bin.json`，键名与文件形状沿用旧侧栏那份（见
 * `pure/recycleBinState.ts` 的说明）。这里只做三件事：读一次、缓存在内存、写回时通知
 * 订阅者；动作语义全在 `pure/recycleActions.ts` 里（纯函数，可单测）。
 *
 * ## 读失败为什么不拿空集合去写
 * 读失败（宿主半没装 / 能力口不可用）时保留错误、**拒绝后续写**：否则一次「移入回收站」
 * 就会把用户原有的集合覆盖成只剩这一条。动作因此如实报错，界面提示，数据一个字节没动。
 */
import { useEffect, useState } from 'react'
import {
  emptyRecycleBin as runEmptyRecycleBin,
  archiveSessionsPermanently,
  moveSessionsToRecycleBin,
  restoreSessionsFromRecycleBin,
  type ActionOutcome,
  type RecycleBinSink,
} from '../../../../pure/recycleActions.ts'
import {
  emptyRecycleBin,
  parseRecycleBin,
  pruneRecycleIds,
  serializeRecycleBin,
  type RecycleBinFile,
} from '../../../../pure/recycleBinState.ts'
import type { HostCapabilities } from '../hostCapabilities.ts'

/** 宿主能力口的键（= `~/.dsh/dsh-one/recycle-bin.json`）。 */
export const RECYCLE_BIN_STATE_KEY = 'recycle-bin'

/** 订阅者看到的快照。 */
export interface RecycleBinSnapshot {
  /** 本地回收站里的会话 id（**移入顺序**，最早移入的在最前）。 */
  readonly ids: readonly string[]
  /** true = 已经从宿主能力口读过一次（读失败也算读过，界面照常渲染空态）。 */
  readonly ready: boolean
  /** 读失败的原因；非 null 时所有写类动作都会如实失败，不用空集合覆盖用户数据。 */
  readonly error: string | null
}

interface RecycleBinPort {
  read: () => Promise<unknown>
  write: (file: RecycleBinFile) => Promise<void>
  /** 官方归档（终点动作）：`uiWorkspace.archiveSession`。 */
  archive: (sessionId: string) => Promise<void>
}

let port: RecycleBinPort | null = null
let snapshot: RecycleBinSnapshot = { ids: [], ready: false, error: null }
const listeners = new Set<() => void>()
let loading: Promise<void> | null = null

function publish(next: RecycleBinSnapshot): void {
  snapshot = next
  for (const listener of [...listeners]) listener()
}

/**
 * 接上三个口（插件 `apply` 时调一次）。读走宿主能力口、归档走官方 `uiWorkspace`
 * ——两侧都是官方机制（AGENTS.md 的机制优先序第 2 层）。
 */
export function configureRecycleBin(io: {
  capabilities: HostCapabilities
  archiveSession: (sessionId: string) => Promise<void>
}): void {
  port = {
    read: () => io.capabilities.stateRead(RECYCLE_BIN_STATE_KEY),
    write: (file) => io.capabilities.stateWrite(RECYCLE_BIN_STATE_KEY, serializeRecycleBin(file)),
    archive: io.archiveSession,
  }
  loading = null
}

function requirePort(): RecycleBinPort {
  if (port === null) throw new Error('recycle bin is not wired to this shell')
  return port
}

/** 读一次（幂等：并发调用共用同一个 promise，读到就进内存）。 */
export function ensureRecycleBinLoaded(): Promise<void> {
  if (loading !== null) return loading
  const io = port
  if (io === null) return Promise.resolve()
  loading = (async (): Promise<void> => {
    try {
      const file = parseRecycleBin(await io.read()) ?? emptyRecycleBin()
      publish({ ids: file.sessionIds, ready: true, error: null })
    } catch (reason) {
      publish({ ids: [], ready: true, error: reason instanceof Error ? reason.message : String(reason) })
    }
  })()
  return loading
}

export function recycleBinSnapshot(): RecycleBinSnapshot {
  return snapshot
}

export function subscribeRecycleBin(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * 订阅快照（两个组件各自调用；首次挂载时顺手触发一次读取）。返回的是不可变快照，
 * 任何变更都换对象，`setState` 因此总能触发重渲染。
 */
export function useRecycleBin(): RecycleBinSnapshot {
  const [state, setState] = useState<RecycleBinSnapshot>(snapshot)
  useEffect(() => {
    setState(snapshot)
    const unsubscribe = subscribeRecycleBin(() => setState(snapshot))
    void ensureRecycleBinLoaded()
    return unsubscribe
  }, [])
  return state
}

/** 动作侧要的口：读回当前值（读失败即抛），落定新值并通知订阅者。 */
const sink: RecycleBinSink = {
  load: async () => {
    await ensureRecycleBinLoaded()
    if (snapshot.error !== null) throw new Error(snapshot.error)
    return { version: 1, sessionIds: [...snapshot.ids] }
  },
  commit: async (file) => {
    const io = requirePort()
    await io.write(file)
    publish({ ids: file.sessionIds, ready: true, error: null })
  },
  archiveSession: async (sessionId) => {
    await requirePort().archive(sessionId)
  },
}

/**
 * 清账：剔除 dsh 侧已经不认识的 id（被归档 / 会话没了）。基线未就绪时什么都不做
 *（冷启动保护，见 `pure/recycleBinState.ts` 的 `pruneRecycleIds`）。
 *
 * 渲染不等它：主树与抽屉本来就用 `visibleRecycleIds` 过滤（认不出的 id 渲染不出行），
 * 清账只负责把这份结论写回文件，免得集合里越积越多。
 */
export async function pruneRecycleBin(knownSessionIds: ReadonlySet<string>, baselineReady: boolean): Promise<void> {
  await ensureRecycleBinLoaded()
  if (snapshot.error !== null) return
  const next = pruneRecycleIds(snapshot.ids, knownSessionIds, baselineReady)
  if (next === null) return
  try {
    await sink.commit({ version: 1, sessionIds: next })
  } catch {
    /* 落盘失败：内存态先按剔除后的集合走，下一次清账再试 */
    publish({ ids: next, ready: true, error: null })
  }
}

/** 四个可复用动作绑定到本 store 的口上（界面直接调这几个）。 */
export const recycleBinActions = {
  /** 移入回收站：只写本地集合（不动 dsh）。 */
  move: (sessionIds: readonly string[]): Promise<ActionOutcome> => moveSessionsToRecycleBin(sessionIds, sink),
  /** 还原：只写本地集合。 */
  restore: (sessionIds: readonly string[]): Promise<ActionOutcome> => restoreSessionsFromRecycleBin(sessionIds, sink),
  /** 永久归档：逐个走官方归档（终点动作），成功项同时划出本地集合。 */
  archive: (sessionIds: readonly string[]): Promise<ActionOutcome> => archiveSessionsPermanently(sessionIds, sink),
  /** 清空回收站 = 把里面每一条都永久归档。 */
  empty: (): Promise<ActionOutcome> => runEmptyRecycleBin(sink),
}
