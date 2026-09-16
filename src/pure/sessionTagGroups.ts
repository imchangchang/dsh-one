/**
 * 侧栏的**会话标签组**模型（#107 回归条目）：每个工作区一个桶，桶里是用户自建的
 * 标签组定义、会话归属与会话折叠态。纯函数、无 IO、无 `vscode` import
 * （`node --test` 直接测）。
 *
 * ## 语义（#98 定稿里标签组那一段，逐条落在这里）
 * - **一个会话最多属于一个标签组**（单组语义，归属就是 `sessionId → groupId` 的一张表）；
 * - **不预置任何内置组**：本模块不会凭空造出组——`emptyTagGroups()` 是一份空文件，
 *   组只在用户建的那一刻出现，且那一刻必然同时把某个会话归进去（见「组只与成员
 *   一起出现」一节）；
 * - **组顺序由用户拖拽决定**（`tags` 数组的顺序就是渲染顺序）；
 * - 组内顺序与工作区内顺序**不归本模块管**：官方顺序 + 置顶项排前由渲染层用
 *   `pinnedFirst` 处理，本模块只负责「谁在哪个组里」（见 {@link splitByTagGroups}）。
 *
 * ## 状态住哪
 * 宿主能力口的 `stateRead/stateWrite('tags')`，落 `~/.dsh/dsh-one/tags.json`
 * ——键名与旧侧栏那份文件逐字相同，所以**旧文件就是新状态**，没有数据搬家这一步
 * （与 `groups` / `pinned` / `unread` 同一处置，见 `pure/treeGroups.ts` 的说明）。
 *
 * ## 迁入（一次性读旧形状）
 * 旧文件的形状是 v2（`{version:2, workspaces:{<ws>:{tags, sessionTags, collapsed}}}`），
 * 与本文的 {@link TagGroupsFile} 同形，所以「迁」只有两件事，都在
 * {@link parseTagGroups} 里一次做完：
 * 1. **旧的内置组（`preset-todo` / `preset-doing` / `preset-done`）不再算组**：#98/#107
 *    定了「旧的 Todo/Doing/Done 那套不恢复」，所以这三个 id 的组定义与归属在迁入时
 *    丢弃——曾归在那三组里的会话变成「未归组」，会话本身一条不动。
 * 2. 未知组 id 的归属、坏颜色的组定义、空名字的组定义照旧清洗掉（与 `sanitizeTags`
 *    同一口径，只是不再补预设组）。
 *
 * `collapsed`（旧文件里记的折叠态）**不迁**：折叠是纯视图态，按 AGENTS.md 铁律第二类
 * 走客户端存储（`pure/workspaceTreePrefs.ts` 的 `tagCollapsed`），不进这份持久数据。
 *
 * ## 组只与成员一起出现（空组处理）
 * 建组的唯一入口是「把某个会话归进一个新建的组」，所以**不存在天生没成员的组**；
 * 反过来说，一个组如果连一个还活着的成员都没有了（组内会话被归档 / 从 dsh 侧消失），
 * 它留着就只是看不见也删不掉的垃圾——{@link pruneTagGroups} 会在基线就绪后把它连同
 * 归属一起清掉。**只进过回收站的会话仍算活着**：它还在 dsh 上，随时能还原回组里。
 */

import { TAG_COLORS, type TagColor } from './sessionTags.ts'
import { pinnedFirst } from './sessionMarks.ts'
import type { SessionNode } from './workspaceTreeView.ts'

/** 宿主能力口的键（= `~/.dsh/dsh-one/tags.json`）。 */
export const TAG_GROUPS_STATE_KEY = 'tags'

/**
 * 旧侧栏的三个内置组 id：迁入时按「不恢复内置组」丢弃（见文件头「迁入」一节）。
 * 只在 `parseTagGroups` 里用到，**不导出**——本模块在新模型里没有「内置组」这个概念，
 * 导出它等于给这个概念留后门。
 */
const LEGACY_PRESET_IDS: ReadonlySet<string> = new Set(['preset-todo', 'preset-doing', 'preset-done'])

/** 一个标签组定义（用户自建：名字与颜色都由用户定，都可改）。 */
export interface TagGroupDef {
  id: string
  name: string
  color: TagColor
}

/** 一个工作区的标签组桶（组定义按显示顺序 + 会话归属）。 */
export interface TagGroupBucket {
  tags: TagGroupDef[]
  sessionTags: Record<string, string>
}

/** 持久文件形状（与旧侧栏那份 v2 同形，只是不再有内置组与折叠字段）。 */
export interface TagGroupsFile {
  version: 2
  workspaces: Record<string, TagGroupBucket>
}

/** 空状态：一组都没有、一条归属都没有。 */
export function emptyTagGroups(): TagGroupsFile {
  return { version: 2, workspaces: {} }
}

/** 空桶（读不到某个工作区的桶时用它，不写回、不建键）。 */
export function emptyTagBucket(): TagGroupBucket {
  return { tags: [], sessionTags: {} }
}

/* -------------------------------------------------------------------------
 * 清洗：把宿主能力口读回的值（或旧文件的值）解成一份可用的状态
 * ---------------------------------------------------------------------- */

function sanitizeColor(raw: unknown): TagColor {
  return (TAG_COLORS as readonly unknown[]).includes(raw) ? (raw as TagColor) : 'orange'
}

/**
 * 清洗一个工作区的桶：组定义丢「旧内置组 / 空 id / 空名字 / 重复 id」并补默认色，
 * 归属丢掉指向未知组的项；`collapsed` 字段读过即弃（折叠态按铁律走客户端存储）。
 * 形状不对（不是对象）返回 null = 这个工作区没有可用数据。
 */
export function sanitizeTagBucket(raw: unknown): TagGroupBucket | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const tags: TagGroupDef[] = []
  const seen = new Set<string>()
  if (Array.isArray(record.tags)) {
    for (const item of record.tags) {
      if (typeof item !== 'object' || item === null) continue
      const { id, name, color } = item as Record<string, unknown>
      if (typeof id !== 'string' || id === '' || seen.has(id)) continue
      if (LEGACY_PRESET_IDS.has(id)) continue
      if (typeof name !== 'string' || name.trim() === '') continue
      seen.add(id)
      tags.push({ id, name: name.trim(), color: sanitizeColor(color) })
    }
  }
  const sessionTags: Record<string, string> = {}
  if (typeof record.sessionTags === 'object' && record.sessionTags !== null && !Array.isArray(record.sessionTags)) {
    for (const [sessionId, groupId] of Object.entries(record.sessionTags as Record<string, unknown>)) {
      if (sessionId === '') continue
      if (typeof groupId === 'string' && seen.has(groupId)) sessionTags[sessionId] = groupId
    }
  }
  return { tags, sessionTags }
}

/**
 * 校核宿主能力口读回的值（`stateRead('tags')` 给的是解析后的对象）。
 * 只认 v2；v1（旧全局模型）与坏值一律 null = 按空状态处理（不猜归属，见文件头）。
 */
export function parseTagGroups(value: unknown): TagGroupsFile | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.version !== 2) return null
  const raw = record.workspaces
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const workspaces: Record<string, TagGroupBucket> = {}
  for (const [workspaceId, bucket] of Object.entries(raw as Record<string, unknown>)) {
    if (workspaceId === '') continue
    const sanitized = sanitizeTagBucket(bucket)
    if (sanitized === null) continue
    workspaces[workspaceId] = sanitized
  }
  return { version: 2, workspaces }
}

/** 落盘用的文本（`stateWrite` 的第二个参数就是它 parse 回来的对象）。 */
export function serializeTagGroups(file: TagGroupsFile): string {
  return JSON.stringify(file)
}

/* -------------------------------------------------------------------------
 * 读写桶
 * ---------------------------------------------------------------------- */

/**
 * 取某个工作区的桶（键与树里的分组键同域：工作区 id，或未分组桶的空串）。
 * 读不到给空桶——调用方据此按「这个工作区还没有标签组」渲染，不会凭空建键。
 */
export function tagBucketOf(file: TagGroupsFile, workspaceId: string): TagGroupBucket {
  return file.workspaces[workspaceId] ?? emptyTagBucket()
}

/** 写回一个工作区的桶；空桶（没有组）不落盘，免得留一堆空气键。 */
export function withTagBucket(file: TagGroupsFile, workspaceId: string, bucket: TagGroupBucket): TagGroupsFile {
  const workspaces = { ...file.workspaces }
  if (bucket.tags.length === 0) delete workspaces[workspaceId]
  else workspaces[workspaceId] = bucket
  return { version: 2, workspaces }
}

/* -------------------------------------------------------------------------
 * 组定义：建 / 改名 / 换色 / 删 / 排序
 * ---------------------------------------------------------------------- */

/** 组名校验（新建与改名共用）：trim 后非空且与同桶内其它组不重名。 */
export function tagGroupNameError(bucket: TagGroupBucket, name: string, excludeId?: string): 'empty' | 'duplicate' | null {
  const trimmed = name.trim()
  if (trimmed === '') return 'empty'
  if (bucket.tags.some((tag) => tag.id !== excludeId && tag.name === trimmed)) return 'duplicate'
  return null
}

/** 新组的默认色：按已有组数在 6 色里轮换（建完随时可改，所以不必问）。 */
export function nextTagColor(bucket: TagGroupBucket): TagColor {
  return TAG_COLORS[bucket.tags.length % TAG_COLORS.length] ?? 'orange'
}

/** 建组结果：成功给新桶与新组 id，失败给原因（界面按原因出文案）。 */
export type TagGroupCreate = { ok: true; bucket: TagGroupBucket; id: string } | { ok: false; error: 'empty' | 'duplicate' }

/** 建一个组（新组排在末尾；调用方紧接着把会话归进去，见文件头「空组处理」）。 */
export function createTagGroup(bucket: TagGroupBucket, name: string, id: string, color: TagColor): TagGroupCreate {
  const error = tagGroupNameError(bucket, name)
  if (error !== null) return { ok: false, error }
  return { ok: true, bucket: { ...bucket, tags: [...bucket.tags, { id, name: name.trim(), color }] }, id }
}

/**
 * 改一个组（名字与颜色共用）：没变化 / 名字非法 / 组不存在都返回 null
 * （调用方据此跳过落盘）。名字非法时调用方应先用{@link tagGroupNameError}出提示。
 */
export function updateTagGroup(
  bucket: TagGroupBucket,
  id: string,
  patch: { name?: string; color?: TagColor },
): TagGroupBucket | null {
  const index = bucket.tags.findIndex((tag) => tag.id === id)
  if (index === -1) return null
  const current = bucket.tags[index] as TagGroupDef
  const name = patch.name === undefined ? current.name : patch.name.trim()
  const color = patch.color ?? current.color
  if (name === '' || tagGroupNameError(bucket, name, id) !== null) return null
  if (name === current.name && color === current.color) return null
  const tags = [...bucket.tags]
  tags[index] = { id, name, color }
  return { ...bucket, tags }
}

/** 删组：组定义与全部归属一起删（归属残留指向不存在的组只会变成脏数据）。 */
export function deleteTagGroup(bucket: TagGroupBucket, id: string): TagGroupBucket | null {
  if (!bucket.tags.some((tag) => tag.id === id)) return null
  const sessionTags: Record<string, string> = {}
  for (const [sessionId, groupId] of Object.entries(bucket.sessionTags)) {
    if (groupId !== id) sessionTags[sessionId] = groupId
  }
  return { tags: bucket.tags.filter((tag) => tag.id !== id), sessionTags }
}

/**
 * 拖拽提交的整组新顺序：只接受与全集等长且无未知/重复 id 的顺序（相当于校验一个
 * 置换）；其余视为无效请求返回 null。与当前顺序一致也返回 null。
 */
export function reorderTagGroups(bucket: TagGroupBucket, ids: readonly string[]): TagGroupBucket | null {
  if (ids.length !== bucket.tags.length) return null
  const byId = new Map(bucket.tags.map((tag) => [tag.id, tag]))
  const seen = new Set<string>()
  const next: TagGroupDef[] = []
  for (const id of ids) {
    const tag = byId.get(id)
    if (tag === undefined || seen.has(id)) return null
    seen.add(id)
    next.push(tag)
  }
  if (next.every((tag, index) => tag.id === bucket.tags[index]?.id)) return null
  return { ...bucket, tags: next }
}

/* -------------------------------------------------------------------------
 * 归属：一个会话最多一个组
 * ---------------------------------------------------------------------- */

/**
 * 把一个会话归到某组（`groupId` = null 时移出分组，回到「未归组」）。
 * 未知组 id 拒绝；与旧值无差异返回 null（调用方跳过落盘）。
 */
export function setSessionTagGroup(
  bucket: TagGroupBucket,
  sessionId: string,
  groupId: string | null,
): TagGroupBucket | null {
  if (sessionId === '') return null
  if (groupId !== null && !bucket.tags.some((tag) => tag.id === groupId)) return null
  const current = bucket.sessionTags[sessionId]
  if ((current ?? null) === groupId) return null
  const sessionTags = { ...bucket.sessionTags }
  if (groupId === null) delete sessionTags[sessionId]
  else sessionTags[sessionId] = groupId
  return { ...bucket, sessionTags }
}

/** 一次把一批会话归到某组（整组「移出分组」用它）；一条都没变化返回 null。 */
export function setSessionsTagGroup(
  bucket: TagGroupBucket,
  sessionIds: readonly string[],
  groupId: string | null,
): TagGroupBucket | null {
  let current: TagGroupBucket | null = null
  for (const sessionId of sessionIds) {
    const next = setSessionTagGroup(current ?? bucket, sessionId, groupId)
    if (next !== null) current = next
  }
  return current
}

/** 桶里属于某组的会话 id（按归属表的插入顺序；整组动作按它收集全集）。 */
export function tagGroupSessionIds(bucket: TagGroupBucket, groupId: string): string[] {
  const ids: string[] = []
  for (const [sessionId, group] of Object.entries(bucket.sessionTags)) {
    if (group === groupId) ids.push(sessionId)
  }
  return ids
}

/* -------------------------------------------------------------------------
 * 空组清理
 * ---------------------------------------------------------------------- */

/**
 * 剔掉「一个活着的成员都没有」的组（连同它们的归属）：组只与成员一起出现，成员
 * 全没了（归档 / 从 dsh 侧消失）的组留着也看不见、删不掉。
 *
 * `isAlive(sessionId)` = 这个会话还在 dsh 侧（**进过回收站的仍算活着**——它随时能
 * 还原回组里，见文件头）。没有可清理的组返回 null（调用方跳过落盘）。
 */
export function pruneTagGroups(bucket: TagGroupBucket, isAlive: (sessionId: string) => boolean): TagGroupBucket | null {
  if (bucket.tags.length === 0) return null
  const alive = new Set<string>()
  for (const [sessionId, groupId] of Object.entries(bucket.sessionTags)) {
    if (isAlive(sessionId)) alive.add(groupId)
  }
  const tags = bucket.tags.filter((tag) => alive.has(tag.id))
  if (tags.length === bucket.tags.length) return null
  const kept = new Set(tags.map((tag) => tag.id))
  const sessionTags: Record<string, string> = {}
  for (const [sessionId, groupId] of Object.entries(bucket.sessionTags)) {
    if (kept.has(groupId)) sessionTags[sessionId] = groupId
  }
  return { tags, sessionTags }
}

/* -------------------------------------------------------------------------
 * 渲染用的推导（组内顺序仍归渲染层：这里只做「谁在哪个组里」）
 * ---------------------------------------------------------------------- */

/** 一个标签组块：组定义 + 组内会话（顺序已按「置顶项先」排好）。 */
export interface TagGroupBlock {
  readonly def: TagGroupDef
  readonly sessions: readonly SessionNode[]
}

/** 一个工作区切完块之后的样子。 */
export interface TagGroupSplit {
  /** 有会话的组，顺序 = 组定义顺序（空组不出现：没有成员的组不占位）。 */
  readonly blocks: readonly TagGroupBlock[]
  /** 没归组的会话（渲染在组块之后，与旧侧栏「未归组殿后」一致）。 */
  readonly ungrouped: readonly SessionNode[]
}

/**
 * 把**一层**里的会话按标签组切开。
 *
 * @param sessions 这一层的会话，顺序 = 官方顺序（含用户选的排序方式；调用方先算好）
 * @param bucket 这一层的标签组桶（没有组时结果是「零个块 + 原样的未归组行」）
 * @param isPinned 这一项是否置顶——**组内置顶 = 在该组内靠前**（#98 定稿），
 *   所以每个组（以及未归组那一段）各调一次 `pinnedFirst`，组与组之间的相对位置
 *   不受置顶影响（置顶是「在它所在的那一层排最前」，组这一层不参与）。
 */
export function splitByTagGroups(
  sessions: readonly SessionNode[],
  bucket: TagGroupBucket,
  isPinned: (node: SessionNode) => boolean,
): TagGroupSplit {
  const byGroup = new Map<string, SessionNode[]>()
  const ungrouped: SessionNode[] = []
  for (const node of sessions) {
    const groupId = bucket.sessionTags[node.id]
    if (groupId === undefined) {
      ungrouped.push(node)
      continue
    }
    const list = byGroup.get(groupId)
    if (list === undefined) byGroup.set(groupId, [node])
    else list.push(node)
  }
  const blocks: TagGroupBlock[] = []
  for (const def of bucket.tags) {
    const members = byGroup.get(def.id)
    if (members === undefined || members.length === 0) continue
    blocks.push({ def, sessions: pinnedFirst(members, isPinned) })
  }
  return { blocks, ungrouped: pinnedFirst(ungrouped, isPinned) }
}

/** 折叠组头上的三个计数（组内待交互 / 运行中 / 未读），互斥优先级与工作区组头一致。 */
export interface TagGroupCounts {
  readonly pending: number
  readonly running: number
  readonly unread: number
}

/**
 * 折叠态组头的计数：每个会话只进一个桶（待交互 > 运行中 > 未读），与工作区行尾
 * 角标、行内状态点同一份优先级口径。
 */
export function tagGroupCounts(sessions: readonly SessionNode[], isUnread: (sessionId: string) => boolean): TagGroupCounts {
  let pending = 0
  let running = 0
  let unread = 0
  for (const node of sessions) {
    if (node.pendingInteraction !== undefined) pending += 1
    else if (node.running || node.runningSubagentCount > 0) running += 1
    else if (isUnread(node.id)) unread += 1
  }
  return { pending, running, unread }
}
