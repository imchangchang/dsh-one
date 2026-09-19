/**
 * 侧栏的两种**用户标记**：置顶（pinned）与手动未读（unread）。纯函数、无 IO、
 * 无 `vscode` import（`node --test` 直接测）。
 *
 * ## 状态住哪（AGENTS.md 铁律「插件状态按官方惯例存储」）
 * 两份 id 集合都由**宿主半**拥有、经宿主能力口读写（`stateRead/stateWrite('pinned'
 * | 'unread')`），落在 dsh 自己的目录 `~/.dsh/dsh-one/<键>.json`（见宿主半
 * `packages/dsh-host-capabilities/src/stateStore.ts`）。扩展的 `globalStorage` /
 * `workspaceState` 一概不碰：官方 web 侧拿不到 VS Code 的存储，状态该在 dsh 里。
 *
 * 键名（`pinned` / `unread`）与旧侧栏的文件名逐字相同，所以**旧文件就是新状态**
 * ——与分组（`groups`）同一处置：不是「迁移得漂亮」，而是根本没有搬家这一步。
 *
 * ## 一次性迁入读取
 * 需要「迁」的只有**形状**：旧文件是 `{version:1, sessionIds:[…]}`
 * （`dshStateFile.parseIdListFile` 同一形状），再早的版本把裸 id 数组直接塞在
 * Memento 里。`migrateMarkIds` 两种都认——读到旧形状就采用它的 id，并让调用方按
 * 规范形状**写回一次**（`needsRewrite`）；此后读写只经过能力口，插件自己不碰文件
 * （插件里没有任何文件 IO，见 `workspaceTreePlugin.ts` 的注入面）。
 *
 * ## 置顶的语义（#98 定稿：本次不做排序体系）
 * 排序全按官方，**唯一例外 = 置顶项在它所在的那一层排最前**，其余保持官方顺序。
 * 这条落在下面的 `pinnedFirst`——标签组内的「组内置顶」也直接复用它。
 */

/** 宿主能力口的键（= `~/.dsh/dsh-one/pinned.json`）。 */
export const SESSION_PINNED_STATE_KEY = 'pinned'
/** 宿主能力口的键（= `~/.dsh/dsh-one/unread.json`）。 */
export const SESSION_UNREAD_STATE_KEY = 'unread'

/** 状态文件形状（与旧侧栏的 `pinned.json` / `unread.json` 逐字同形）。 */
export interface SessionMarkFile {
  version: 1
  sessionIds: string[]
}

/** 读回来的一份标记（id 集合，顺序 = 写入顺序）。 */
export interface SessionMarksState {
  readonly pinned: readonly string[]
  readonly unread: readonly string[]
}

/** 空状态。 */
export function emptySessionMarks(): SessionMarksState {
  return { pinned: [], unread: [] }
}

/**
 * 清洗一份 id 集合：只留非空字符串并去重（旧文件残留/手工改坏不崩）。
 * 与回收站 id 集合（`recycleBinState.sanitizeRecycleIds`）同一口径。
 */
export function sanitizeMarkIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of raw) {
    if (typeof id !== 'string' || id === '') continue
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/**
 * 旧文件的**一次性迁入读取**：把能力口读回的值 —— 无论它是规范形状
 * （`{version:1, sessionIds:[…]}`）、更早的裸 id 数组，还是坏值 —— 一律解成
 * 一份可用的 id 集合。
 *
 * @param value 能力口 `stateRead('pinned' | 'unread')` 返回的解析后值（没有文件时
 *        是 null）。
 * @returns `ids` = 采用（并已清洗）的 id；`needsRewrite` = true 表示读到的不是
 *          规范形状（旧形状或坏值），调用方应按 `markStateFile` 的规范形状写回一次，
 *          迁入就到此为止；此后只有能力口读写，不再碰旧文件。
 */
export function migrateMarkIds(value: unknown): { ids: string[]; needsRewrite: boolean } {
  if (value === null || value === undefined) return { ids: [], needsRewrite: false }
  if (Array.isArray(value)) return { ids: sanitizeMarkIds(value), needsRewrite: true }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (record.version === 1 && Array.isArray(record.sessionIds)) {
      return { ids: sanitizeMarkIds(record.sessionIds), needsRewrite: false }
    }
  }
  return { ids: [], needsRewrite: true }
}

/** 落盘用的规范形状（`stateWrite` 的第二个参数直接吃它）。 */
export function markStateFile(ids: readonly string[]): SessionMarkFile {
  return { version: 1, sessionIds: [...ids] }
}

/**
 * 两份标记一起迁入（插件装载时**唯一**一次读到旧值的地方）：
 * 逐键走 {@link migrateMarkIds}，并把「不是规范形状、需要按规范形状写回一次」的
 * 键列出来（`rewrite`）。写回由调用方做（它才有能力口），此后读写只走能力口。
 *
 * @param values 能力口 `stateRead('pinned')` / `stateRead('unread')` 的原始返回值。
 */
export function migrateSessionMarks(values: { pinned: unknown; unread: unknown }): {
  marks: SessionMarksState
  rewrite: readonly ('pinned' | 'unread')[]
} {
  const pinned = migrateMarkIds(values.pinned)
  const unread = migrateMarkIds(values.unread)
  const rewrite: ('pinned' | 'unread')[] = []
  if (pinned.needsRewrite) rewrite.push('pinned')
  if (unread.needsRewrite) rewrite.push('unread')
  return { marks: { pinned: pinned.ids, unread: unread.ids }, rewrite }
}

/**
 * 开/关一个 id：`on` = true 时把它加到末尾（已在则原样返回同一份数组引用，调用方
 * 据此跳过写盘），false 时把它摘掉。
 */
export function toggleMarkId(ids: readonly string[], id: string, on: boolean): readonly string[] {
  const has = ids.includes(id)
  if (on) return has ? ids : [...ids, id]
  return has ? ids.filter((value) => value !== id) : ids
}

/**
 * 「置顶项排在这一层最前，其余保持原顺序」——#98 定稿里排序的唯一例外。
 *
 * 输入：
 * - `items`：**一层**里的条目，顺序 = 官方顺序（工作区内的会话、标签组内的会话、
 *   平铺列表都适用；调用方先把官方顺序算好，本函数只做置顶的前排）；
 * - `isPinned(item)`：这一项是否置顶。
 *
 * 输出：新数组（不改入参）。置顶项按它们在入参里的相对顺序排在前，非置顶项按同样
 * 的相对顺序跟在后面——稳定排序，同层内不改变任一子集的相对次序。
 *
 * 标签组那条后续条目要用到的「组内置顶」= 对组内的 `SessionNode[]` 调本函数。
 */
export function pinnedFirst<T>(items: readonly T[], isPinned: (item: T) => boolean): T[] {
  const pinned: T[] = []
  const rest: T[] = []
  for (const item of items) (isPinned(item) ? pinned : rest).push(item)
  return [...pinned, ...rest]
}
