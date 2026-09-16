/**
 * Pure model for recycle-bin local state (dsh 无回收站概念，纯本地缓冲层).
 * No `vscode` import — unit-testable with node --test. The store owns
 * persistence（本版本起 `sessions.recycleBin` 落 ~/.dsh/dsh-one/recycle-bin.json，
 * 见 sessionsStore.create；`sessions.recycleCollapsed` 是 UI 偏好留 Memento）and
 * snapshot wiring; everything side-effect-free lives here so the semantics are
 * pinned by tests.
 *
 * 历史：v1 状态存 workspaceState（per-workspace：按当前打开的 workspace 隔离，
 * 新窗口——不同 workspace / untitled——读不到，回收站整集合丢失）。v2 迁到
 * globalState（独立于当前 workspace，跨窗口/重启共享，与分组功能同层）。
 * v3（本版本）迁到 dsh 全局目录文件。resolveRecycleIds 仍服务于 v1→v2 的
 * Memento 内部迁移（recycleCollapsed 仍在用）与 create() 里 v2/v1 两级旧链回读。
 *
 * 文件下半部分（`#103` 一节起）是**装配树用的持久状态模型**：同一个键、同一个文件
 * 形状，只是换由宿主能力口读写（`stateRead/stateWrite('recycle-bin')`）。上面的
 * sanitize/resolve/prune 是两版共用的纯逻辑，没有第二套。
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

// ---------------------------------------------------------------------------
// #103：回收站的**持久状态模型**（装配树用的那一份）
//
// 两层语义（#98 A1）：
// - **回收站 = 本地可逆的一层**：只写这里这个集合，dsh 侧一个字节都不动，用来把
//   暂时没用的会话从树里挪走（随时能还原）；
// - **归档 = 删除**：终点动作，走官方 `archiveSession`，与我们这个集合无关。
// 所以这个模块只管「哪些会话被本地挪走了、按什么顺序挪的」，不碰官方归档集合。
//
// ## 家在哪（AGENTS.md 铁律「插件状态按官方惯例存储」）
// 用户可感知的持久状态 → 宿主半拥有，经宿主能力口读写，键 `recycle-bin`，
// 落 `~/.dsh/dsh-one/recycle-bin.json`。**键名与文件格式沿用旧侧栏那份**
// （`{version:1, sessionIds:[...]}`）：用户旧侧栏里收过的会话，新的装配树打开就在，
// 不需要任何搬家动作——与分组状态（`groups`）同一处置，见 pure/treeGroups.ts 的说明。
// 唯一的「一次性迁入」是对**裸数组**的容忍（有的宿主可能只存了 id 列表）：见
// {@link parseRecycleBin}。
// ---------------------------------------------------------------------------

/** 回收站持久状态（宿主能力口键 `recycle-bin`）。 */
export interface RecycleBinFile {
  version: 1
  /**
   * 移入顺序（**最早移入的在最前**，与旧侧栏的 push 顺序一致）。
   * 界面按它的倒序展示：抽屉块内「最近移入的在最上」（#98 H1 的形态要求）。
   */
  sessionIds: string[]
}

/** 空状态（与旧侧栏的初值同形：version 1 + 空列表）。 */
export function emptyRecycleBin(): RecycleBinFile {
  return { version: 1, sessionIds: [] }
}

/**
 * 校核宿主能力口读回的值（`stateRead('recycle-bin')` 给的是解析后的对象）。
 *
 * 两种可接受形态：旧文件那份 `{version:1, sessionIds:[...]}`（一次性迁入即
 * 「读进来就完事」，没有搬运步骤），以及直接给一个 id 数组的宿主。其余一律
 * null，调用方按空状态处理（绝不抛）。
 */
export function parseRecycleBin(raw: unknown): RecycleBinFile | null {
  if (Array.isArray(raw)) return { version: 1, sessionIds: sanitizeRecycleIds(raw) }
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  if (record.version !== 1 || !('sessionIds' in record)) return null
  return { version: 1, sessionIds: sanitizeRecycleIds(record.sessionIds) }
}

/** 落盘用的值（与旧文件的形状逐字同形，两端/旧版本读得回去）。 */
export function serializeRecycleBin(file: RecycleBinFile): RecycleBinFile {
  return { version: 1, sessionIds: [...file.sessionIds] }
}

/** 把会话移入回收站（按给定顺序**追加**到移入顺序尾部）。无变化返回 null。 */
export function moveIntoRecycleBin(file: RecycleBinFile, sessionIds: readonly string[]): RecycleBinFile | null {
  const present = new Set(file.sessionIds)
  const added: string[] = []
  for (const id of sessionIds) {
    if (typeof id !== 'string' || id === '' || present.has(id)) continue
    present.add(id)
    added.push(id)
  }
  if (added.length === 0) return null
  return { version: 1, sessionIds: [...file.sessionIds, ...added] }
}

/** 从回收站还原（移出集合，其余顺序不变）。无变化返回 null。 */
export function restoreFromRecycleBin(file: RecycleBinFile, sessionIds: readonly string[]): RecycleBinFile | null {
  const drop = new Set(sessionIds)
  const next = file.sessionIds.filter((id) => !drop.has(id))
  return next.length === file.sessionIds.length ? null : { version: 1, sessionIds: next }
}
