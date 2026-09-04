/**
 * Pure model for workspace group state (tag 多对多): sanitize, ordering and
 * membership algebra. No `vscode` import — unit-testable with node --test.
 * The store owns Memento persistence and snapshot wiring; everything
 * side-effect-free lives here so the semantics are pinned by tests.
 */

/** One workspace group definition; array order is the display order. */
export interface WorkspaceGroupDef {
  id: string
  name: string
}

/** 从持久化数据清洗分组定义（旧版本残留/手工改坏不崩）：丢弃缺 id/空名/
 *  重复 id 的项，名称 trim。非数组返回空列表。 */
export function sanitizeGroups(raw: unknown): WorkspaceGroupDef[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: WorkspaceGroupDef[] = []
  for (const g of raw) {
    if (typeof g !== 'object' || g === null) continue
    const { id, name } = g as Record<string, unknown>
    if (typeof id !== 'string' || !id || typeof name !== 'string' || !name.trim()) continue
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ id, name: name.trim() })
  }
  return out
}

/** 从持久化数据清洗归属映射：只保留已知组 id、去重；非数组项跳过。 */
export function sanitizeMembership(raw: unknown, groupIds: ReadonlySet<string>): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out
  for (const [wsId, ids] of Object.entries(raw)) {
    if (!Array.isArray(ids)) continue
    const cleaned = [...new Set(ids.filter((x): x is string => typeof x === 'string' && groupIds.has(x)))]
    if (cleaned.length > 0) out[wsId] = cleaned
  }
  return out
}

/**
 * 某组的归组计数：只数当前基线里真实存在的 workspace（成员残留旧 id
 * 不计入）。currentIds = 当前注册的 workspace id 集合。
 */
export function groupMembershipCount(
  membership: Readonly<Record<string, string[]>>,
  groupId: string,
  currentIds: ReadonlySet<string>,
): number {
  let n = 0
  for (const [wsId, ids] of Object.entries(membership)) {
    if (currentIds.has(wsId) && ids.includes(groupId)) n += 1
  }
  return n
}

/**
 * 设置一个 workspace 的归属（多对多全量替换，未知组 id 剔除、去重）。
 * 返回新映射；与旧值无差异时返回 null（调用方可以跳过持久化与通知）。
 */
export function setWorkspaceGroupIds(
  membership: Readonly<Record<string, string[]>>,
  workspaceId: string,
  groupIds: readonly string[],
  knownGroupIds: ReadonlySet<string>,
): Record<string, string[]> | null {
  const cleaned = [...new Set(groupIds.filter((id) => knownGroupIds.has(id)))]
  const prev = membership[workspaceId] ?? []
  if (prev.length === cleaned.length && prev.every((id, i) => id === cleaned[i])) return null
  const next = { ...membership }
  if (cleaned.length > 0) next[workspaceId] = cleaned
  else delete next[workspaceId]
  return next
}

/** 删除分组后的归属清理：所有 workspace 的该组 id 移除；返回新映射。 */
export function removeGroupId(
  membership: Readonly<Record<string, string[]>>,
  groupId: string,
): Record<string, string[]> {
  let changed = false
  const next: Record<string, string[]> = {}
  for (const [wsId, ids] of Object.entries(membership)) {
    const cleaned = ids.filter((id) => id !== groupId)
    if (cleaned.length !== ids.length) changed = true
    if (cleaned.length > 0) next[wsId] = cleaned
  }
  return changed ? next : membership
}

/**
 * 按新顺序重排分组（拖拽提交的全量顺序）：丢弃未知 id；列表缺失/为空
 * 视为无效请求，返回 null（调用方跳过）。与当前顺序一致也返回 null。
 */
export function reorderGroups(
  groups: readonly WorkspaceGroupDef[],
  groupIds: readonly string[],
): WorkspaceGroupDef[] | null {
  const byId = new Map(groups.map((g) => [g.id, g]))
  const next = groupIds.map((id) => byId.get(id)).filter((g): g is WorkspaceGroupDef => g !== undefined)
  if (next.length === 0 || next.length !== groups.length) return null
  if (next.every((g, i) => g.id === groups[i].id)) return null
  return next
}

/** 名称校验（建组/重命名共用）：trim 后非空、不重名（excludeId 排除自身）。 */
export function groupNameError(
  name: string,
  groups: readonly WorkspaceGroupDef[],
  excludeId?: string,
): 'empty' | 'duplicate' | null {
  const trimmed = name.trim()
  if (!trimmed) return 'empty'
  if (groups.some((g) => g.id !== excludeId && g.name === trimmed)) return 'duplicate'
  return null
}
