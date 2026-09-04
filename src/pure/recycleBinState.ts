/**
 * Pure model for recycle-bin local state (dsh 无回收站概念，纯本地缓冲层).
 * No `vscode` import — unit-testable with node --test. The store owns Memento
 * persistence (`sessions.recycleBin` / `sessions.recycleCollapsed`) and snapshot
 * wiring; everything side-effect-free lives here so the semantics are pinned
 * by tests.
 *
 * v1 状态存 workspaceState（per-workspace：按当前打开的 workspace 隔离，
 * 新窗口——不同 workspace / untitled——读不到，回收站整集合丢失）。v2 迁到
 * globalState（独立于当前 workspace，跨窗口/重启共享，与分组功能同层）。
 * 旧 workspaceState 数据一次性迁移：globalState 有值就以它为准，否则回读
 * 旧值并由 store 写回新 key；两种路径都会删除旧 key，避免陈旧态复活。
 */

/** 从持久化数据清洗回收站 id 集合（旧版本残留/手工改坏不崩）：非数组返回空；
 *  只保留非空字符串并去重。 */
export function sanitizeRecycleIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of raw) {
    if (typeof id !== 'string' || !id) continue
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

export interface RecycleStateLoad {
  /** 本次载入（清洗后）的回收站 id 集合。 */
  ids: string[]
  /** true = 新 key（globalState）无数据、本次从旧 workspaceState 迁移而来；
   *  store 需把 ids 写入 globalState（旧 key 随后删除）。 */
  fromLegacy: boolean
}

/**
 * 新旧 key 并存时的载入决策：globalState 有值（哪怕空数组）就以它为准——
 * 升级后所有写入都只走 globalState，workspaceState 里只可能是旧版本遗留；
 * 只在 globalState 完全没有时回退到旧数据（fromLegacy=true 触发一次性迁移）。
 */
export function resolveRecycleIds(rawGlobal: unknown, rawLegacy: unknown): RecycleStateLoad {
  if (rawGlobal !== undefined) return { ids: sanitizeRecycleIds(rawGlobal), fromLegacy: false }
  return { ids: sanitizeRecycleIds(rawLegacy), fromLegacy: rawLegacy !== undefined }
}

/**
 * 回收站集合清账决策：剔除基线已不认识的 id（dsh 侧被归档/删除）。
 * 基线未就绪（服务停了/重启后未重拉）时 knownSessionIds 为空集合，据此清账
 * 会把回收站冷启动清空——这是必须保留的保护。无变化返回 null（调用方跳过
 * 持久化与通知）。
 */
export function pruneRecycleIds(
  recycleBin: readonly string[],
  knownSessionIds: ReadonlySet<string>,
  baselineReady: boolean,
): string[] | null {
  if (!baselineReady) return null
  const next = recycleBin.filter((id) => knownSessionIds.has(id))
  return next.length === recycleBin.length ? null : next
}
