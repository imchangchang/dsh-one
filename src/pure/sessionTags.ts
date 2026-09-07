/**
 * Pure model for session tag groups (Chrome vertical-tabs style): single
 * membership — one session belongs to at most one group（互斥，符合 todo/doing/
 * done 状态语义）. Preset tags are created on first run and keep l10n'd names;
 * custom tags carry the user's own name. No `vscode` import — unit-testable
 * with node --test. The store owns Memento persistence and snapshot wiring;
 * everything side-effect-free lives here so the semantics are pinned by tests.
 */

import type { L10nFn } from './sessionTree.ts'

/** Preset tag ids（固定 id，名字走 l10n；不可改名/删除，恒存在）. */
export const PRESET_TAG_IDS = ['preset-todo', 'preset-doing', 'preset-done'] as const

/** Preset 定义（颜色沿用 dsh 状态语义色：待办黄 / 进行中蓝 / 已完成绿）.
 *  数组顺序 = 首启时的默认展示顺序（之后由用户拖拽自由排序）. */
export const PRESET_TAGS: readonly SessionTagDef[] = [
  { id: 'preset-todo', name: null, color: 'yellow' },
  { id: 'preset-doing', name: null, color: 'blue' },
  { id: 'preset-done', name: null, color: 'green' },
]

/** preset id → l10n key（英文默认串即 key，webview 端 t() 同机制）. */
export const PRESET_TAG_L10N: Readonly<Record<string, string>> = {
  'preset-todo': 'Todo',
  'preset-doing': 'Doing',
  'preset-done': 'Done',
}

/** 标签颜色枚举：key 映射到 webview CSS 里的 vscode 主题色变量. */
export type TagColor = 'yellow' | 'blue' | 'green' | 'orange' | 'purple' | 'red'

export const TAG_COLORS: readonly TagColor[] = ['yellow', 'blue', 'green', 'orange', 'purple', 'red']

export interface SessionTagDef {
  id: string
  /** 显示名；null = 预设组（由调用方按 PRESET_TAG_L10N 翻译）. */
  name: string | null
  color: TagColor
}

export function isPresetTag(tag: SessionTagDef): boolean {
  return (PRESET_TAG_IDS as readonly string[]).includes(tag.id)
}

/** 组显示名：预设组走 l10n（key = PRESET_TAG_L10N[id]），自定义组用用户原文. */
export function tagDisplayName(tag: SessionTagDef, t: L10nFn): string {
  if (tag.name !== null) return tag.name
  return t(PRESET_TAG_L10N[tag.id] ?? tag.id)
}

function sanitizeColor(raw: unknown): TagColor {
  return (TAG_COLORS as readonly unknown[]).includes(raw) ? (raw as TagColor) : 'orange'
}

/**
 * 从持久化数据清洗标签定义：丢弃缺 id / 缺名（预设组除外）/ 非法颜色的项，
 * 名称 trim；补齐缺失的预设组（按标准序排在末尾——已有顺序是用户拖过/
 * 持久化序，不强行打乱）。非数组返回「仅预设组」（首启 seed 语义）。
 */
export function sanitizeTags(raw: unknown): SessionTagDef[] {
  const out: SessionTagDef[] = []
  const seen = new Set<string>()
  if (Array.isArray(raw)) {
    for (const t of raw) {
      if (typeof t !== 'object' || t === null) continue
      const { id, name, color } = t as Record<string, unknown>
      if (typeof id !== 'string' || !id || seen.has(id)) continue
      if (name !== null && (typeof name !== 'string' || !name.trim())) continue
      seen.add(id)
      out.push({ id, name: name === null ? null : name.trim(), color: sanitizeColor(color) })
    }
  }
  for (const p of PRESET_TAGS) {
    if (!seen.has(p.id)) out.push({ ...p })
  }
  return out
}

/** 从持久化数据清洗归属映射（sessionId → tagId 单组）：丢空键、未知组 id；非对象返回空. */
export function sanitizeSessionTagIds(raw: unknown, tagIds: ReadonlySet<string>): Record<string, string> {
  const out: Record<string, string> = {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out
  for (const [sessionId, tagId] of Object.entries(raw)) {
    if (!sessionId) continue
    if (typeof tagId === 'string' && tagId && tagIds.has(tagId)) out[sessionId] = tagId
  }
  return out
}

/**
 * 设置一个会话的组（单组全量替换）：tagId 为 null 时移出组；未知组 id 拒绝。
 * 返回新映射；与旧值无差异时返回 null（调用方可跳过持久化与通知）。
 */
export function setSessionTagId(
  membership: Readonly<Record<string, string>>,
  sessionId: string,
  tagId: string | null,
  knownTagIds: ReadonlySet<string>,
): Record<string, string> | null {
  if (tagId !== null && !knownTagIds.has(tagId)) return null
  const prev = membership[sessionId]
  if (prev === tagId) return null
  const next = { ...membership }
  if (tagId === null) delete next[sessionId]
  else next[sessionId] = tagId
  return next
}

/** 删除分组后的归属清理：所有引用该组的会话移出；返回新映射（无变化返回原引用）. */
export function removeTagFromAll(
  membership: Readonly<Record<string, string>>,
  tagId: string,
): Record<string, string> {
  let changed = false
  const next: Record<string, string> = {}
  for (const [sessionId, id] of Object.entries(membership)) {
    if (id === tagId) changed = true
    else next[sessionId] = id
  }
  return changed ? next : membership
}

/**
 * 找出「已无活跃成员」的自定义组：组内曾挂有会话，但当前基线里已不存在任何
 * 还在活跃（未归档/未入回收站）的成员——即内容全部移入回收站/消失。这样的组
 * 不再保留，返回其 id 列表（预设组恒不参与；从未挂过会话的自建组——刚创建
 * 尚未加入——不视为空，保留给用户新建后立即加入）。
 */
export function emptyCustomTagIds(
  tags: readonly SessionTagDef[],
  membership: Readonly<Record<string, string>>,
  isActive: (sessionId: string) => boolean,
): string[] {
  const customTags = tags.filter((t) => !isPresetTag(t))
  if (customTags.length === 0) return []
  const membersByTag = new Map<string, string[]>()
  for (const [sessionId, tagId] of Object.entries(membership)) {
    const list = membersByTag.get(tagId) ?? []
    list.push(sessionId)
    membersByTag.set(tagId, list)
  }
  const empty: string[] = []
  for (const tag of customTags) {
    const members = membersByTag.get(tag.id)
    // 从未挂过会话：保留（刚创建，等用户加入）。
    if (members === undefined) continue
    if (members.some((sessionId) => isActive(sessionId))) continue
    empty.push(tag.id)
  }
  return empty
}

/**
 * 按新顺序重排标签组（拖拽提交的全量顺序）：只接受与全集等长且无未知/重复
 * id 的顺序（frozenset 匹配）；其余视为无效请求返回 null（调用方跳过）。
 * 与当前顺序一致也返回 null。
 */
export function reorderTags(
  tags: readonly SessionTagDef[],
  tagIds: readonly string[],
): SessionTagDef[] | null {
  if (tagIds.length !== tags.length) return null
  const byId = new Map(tags.map((t) => [t.id, t]))
  const next = tagIds.map((id) => byId.get(id)).filter((t): t is SessionTagDef => t !== undefined)
  if (next.length === 0 || next.length !== tagIds.length) return null
  if (next.every((t, i) => t.id === tags[i].id)) return null
  return next
}

/** sessionId → tagId 单组映射的倒排：tagId → sessionId 列表（整组批量操作收集全集用）。 */
export function invertSessionTagIds(
  membership: Readonly<Record<string, string>>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [sessionId, tagId] of Object.entries(membership)) {
    const list = (out[tagId] ??= [])
    list.push(sessionId)
  }
  return out
}

/** 名称校验（自建组新建/重命名共用）：trim 后非空；只与自建组比较重名
 *  （预设组名由 l10n 出、不可改名，不参与——同显示名交由用户自己注意）。 */
export function tagNameError(
  name: string,
  tags: readonly SessionTagDef[],
  excludeId?: string,
): 'empty' | 'duplicate' | null {
  const trimmed = name.trim()
  if (!trimmed) return 'empty'
  if (tags.some((t) => t.id !== excludeId && t.name !== null && t.name === trimmed)) return 'duplicate'
  return null
}

/** 自建组的颜色轮换：按自定义组数量从「橙紫红」板循环（避让预设三色）。 */
export function nextCustomColor(tags: readonly SessionTagDef[]): TagColor {
  const customCount = tags.filter((t) => !isPresetTag(t)).length
  const palette: TagColor[] = ['orange', 'purple', 'red']
  return palette[customCount % palette.length]
}
