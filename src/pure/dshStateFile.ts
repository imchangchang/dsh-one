/**
 * ~/.dsh/dsh-one/ 客户端状态文件的纯模型（dsh 全局目录，跨窗口共享）：
 * 文件格式、宽松解析（坏文件降级为 null）、「文件权威 / 旧 Memento 回读」迁移
 * 决策、写前重读的字段级合并（多窗口 + 派生脚本并发时降低 last-writer-wins
 * 丢失）。
 *
 * No `vscode` import — unit-testable with node --test. 文件 IO 在
 * src/ui/dshStateStore.ts，Memento 迁移在 sessionsStore.create。
 */
import { sanitizeGroups, type WorkspaceGroupDef } from './workspaceGroups.ts'
import { sanitizeRecycleIds } from './recycleBinState.ts'
import { sanitizeSessionTagIds, sanitizeTags, type SessionTagDef } from './sessionTags.ts'

/** 回收站 id 集合（单值）。 */
export interface IdListFile {
  version: 1
  sessionIds: string[]
}

/** 工作区分组三件套同文件（一个功能一个文件：组定义/归属/选中组）。 */
export interface GroupFile {
  version: 1
  groups: WorkspaceGroupDef[]
  membership: Record<string, string[]>
  activeGroupId: string | null
}

/** 标签组：tag 定义 + 会话归属（派生脚本 --tag 直接写这里）。 */
export interface TagFile {
  version: 1
  tags: SessionTagDef[]
  sessionTags: Record<string, string>
}

export type DshModuleName = 'recycle-bin' | 'groups' | 'tags' | 'pinned' | 'unread'

export const DSH_MODULE_NAMES: readonly DshModuleName[] = [
  'recycle-bin',
  'groups',
  'tags',
  'pinned',
  'unread',
]

/** 模块 → 文件名（全部落在 ~/.dsh/dsh-one/ 下，原子写 tmp+rename）。 */
export function dshModuleFile(name: DshModuleName): string {
  return `${name}.json`
}

/* ---- 宽松解析：坏 JSON / version 不符 / 字段缺失 → null（触发旧值迁移） ---- */

function parseJson(raw: string): Record<string, unknown> | null {
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof obj !== 'object' || obj === null) return null
  return obj as Record<string, unknown>
}

function hasField(rec: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(rec, key)
}

export function parseIdListFile(raw: string): IdListFile | null {
  const rec = parseJson(raw)
  if (rec === null || rec.version !== 1 || !hasField(rec, 'sessionIds')) return null
  return { version: 1, sessionIds: sanitizeRecycleIds(rec.sessionIds) }
}

export function parseGroupFile(raw: string): GroupFile | null {
  const rec = parseJson(raw)
  if (
    rec === null ||
    rec.version !== 1 ||
    !hasField(rec, 'groups') ||
    !hasField(rec, 'membership') ||
    !hasField(rec, 'activeGroupId')
  ) {
    return null
  }
  const groups = sanitizeGroups(rec.groups)
  const membership = sanitizeMembershipRaw(rec.membership, groups.map((g) => g.id))
  const active = typeof rec.activeGroupId === 'string' ? rec.activeGroupId : null
  return {
    version: 1,
    groups,
    membership,
    activeGroupId: active !== null && groups.some((g) => g.id === active) ? active : null,
  }
}

export function parseTagFile(raw: string): TagFile | null {
  const rec = parseJson(raw)
  if (rec === null || rec.version !== 1 || !hasField(rec, 'tags') || !hasField(rec, 'sessionTags')) {
    return null
  }
  const tags = sanitizeTags(rec.tags)
  return {
    version: 1,
    tags,
    sessionTags: sanitizeSessionTagIds(rec.sessionTags, new Set(tags.map((t) => t.id))),
  }
}

/** parseGroupFile 用的宽松 membership 清洗（去未知组 id / 非数组降级）。 */
function sanitizeMembershipRaw(
  raw: unknown,
  groupIds: readonly string[],
): Record<string, string[]> {
  if (typeof raw !== 'object' || raw === null) return {}
  const known = new Set(groupIds)
  const out: Record<string, string[]> = {}
  for (const [wsId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue
    const ids = value.filter((id): id is string => typeof id === 'string' && known.has(id))
    if (ids.length > 0) out[wsId] = [...new Set(ids)]
  }
  return out
}

/* ---- 序列化 ---- */

export function serializeIdListFile(value: IdListFile): string {
  return JSON.stringify(value)
}

export function serializeGroupFile(value: GroupFile): string {
  return JSON.stringify(value)
}

export function serializeTagFile(value: TagFile): string {
  return JSON.stringify(value)
}

/* ---- 迁移决策：文件 present（哪怕空数据）即权威；否则回读旧值 ---- */

export interface ModuleResolve<T> {
  /** 本次采用的值（已清洗）。 */
  value: T
  /** 文件缺失/坏 = 需要从旧 Memento 迁移（写了文件后旧 key 删除）。 */
  fromLegacy: boolean
}

export function resolveIdList(
  fileValue: IdListFile | null,
  legacyRaw: unknown,
): ModuleResolve<string[]> {
  if (fileValue !== null) {
    return { value: fileValue.sessionIds, fromLegacy: false }
  }
  const ids = sanitizeRecycleIds(legacyRaw)
  return { value: ids, fromLegacy: legacyRaw !== undefined }
}

export function resolveGroupFile(
  fileValue: GroupFile | null,
  legacyGroups: unknown,
  legacyMembership: unknown,
  legacyActive: unknown,
): ModuleResolve<Pick<GroupFile, 'groups' | 'membership' | 'activeGroupId'>> {
  if (fileValue !== null) {
    return { value: fileValue, fromLegacy: false }
  }
  const groups = sanitizeGroups(legacyGroups)
  const membership = sanitizeMembershipRaw(legacyMembership, groups.map((g) => g.id))
  const savedActive = typeof legacyActive === 'string' ? legacyActive : null
  return {
    value: {
      groups,
      membership,
      activeGroupId: savedActive !== null && groups.some((g) => g.id === savedActive) ? savedActive : null,
    },
    fromLegacy:
      legacyGroups !== undefined || legacyMembership !== undefined || legacyActive !== undefined,
  }
}

export function resolveTagFile(
  fileValue: TagFile | null,
  legacyTags: unknown,
  legacySessionTags: unknown,
): ModuleResolve<Pick<TagFile, 'tags' | 'sessionTags'>> {
  if (fileValue !== null) {
    return { value: fileValue, fromLegacy: false }
  }
  const tags = sanitizeTags(legacyTags)
  const sessionTags = sanitizeSessionTagIds(legacySessionTags, new Set(tags.map((t) => t.id)))
  return { value: { tags, sessionTags }, fromLegacy: legacyTags !== undefined || legacySessionTags !== undefined }
}

/* ---- 写前重读的字段级合并（顺序敏感的列表以「既有在前 + 新增追加」合并） ---- */

/** 集合类 id 列表有序并集：a 在前（既有顺序优先），追加 b 中不在 a 的。 */
export function mergeIdList(a: readonly string[], b: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of [...a, ...b]) {
    if (typeof id !== 'string' || !id) continue
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/** sessionId → tagId 联合（b 覆盖同 key）。 */
export function mergeSessionTags(
  a: Record<string, string>,
  b: Record<string, string>,
): Record<string, string> {
  return { ...a, ...b }
}

/** tag 定义联合：按 id 或 name 去重（派生脚本重跑不产生重复组），id 前缀优先。 */
export function mergeTagDefs(a: readonly SessionTagDef[], b: readonly SessionTagDef[]): SessionTagDef[] {
  const seen = new Set<string>()
  const names = new Set<string>()
  const out: SessionTagDef[] = []
  for (const t of [...a, ...b]) {
    if (seen.has(t.id) || names.has(t.name)) continue
    seen.add(t.id)
    names.add(t.name)
    out.push(t)
  }
  return out
}
