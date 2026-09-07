/**
 * ~/.dsh/dsh-one/ 客户端状态文件的纯模型（dsh 全局目录，跨窗口共享）：
 * 文件格式、宽松解析（坏文件降级为 null）、「文件权威 / 旧 Memento 回读」迁移
 * 决策、写前重读的字段级合并（多窗口 + 派生脚本并发时降低 last-writer-wins
 * 丢失）。
 *
 * No `vscode` import — unit-testable with node --test. 文件 IO 在
 * src/ui/dshStateStore.ts，Memento 迁移在 sessionsStore.create。
 */
import { sanitizeGroups, sanitizeMembership, type WorkspaceGroupDef } from './workspaceGroups.ts'
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

/**
 * composer 草稿的一张暂存图片（粘贴的 base64 图）。与 OutgoingImage 同形；
 * 文件类附件只存路径引用（字节在磁盘），不进 drafts.json。
 */
export interface DraftImage {
  mediaType: string
  data: string
  name?: string
}

/** composer 草稿的一个文件 chip：只存显示名 + 路径（previewData 是内存态，恢复后经 fileThumb 重取）。 */
export interface DraftFileChip {
  name: string
  path: string
  image?: boolean
}

/** 一个会话（或空态 tab）的 composer 草稿：文本 + 暂存附件。 */
export interface ComposerDraftEntry {
  text: string
  images?: DraftImage[]
  files?: DraftFileChip[]
  /** 宿主落盘时戳的 epoch ms；超量条目按它淘旧的。 */
  updatedAt: number
}

/** 一道问答卡题的半答草稿：勾选项 label + 自定义输入 + 单选「其他」态。 */
export interface AnswerDraftEntry {
  selected: string[]
  custom: string
  other: boolean
}

/**
 * 输入草稿模块（drafts.json）：composer key = sessionId，空态 tab 用
 * `tab:<tabId>`（重启后 serializer 按 tabId 认回）；answers key = rpcId →
 * 题号（JSON 对象 key 为字符串）→ 半答草稿。发送/提交即删对应条目。
 */
export interface DraftsFile {
  version: 1
  composer: Record<string, ComposerDraftEntry>
  answers: Record<string, Record<string, AnswerDraftEntry>>
}

/** composer 条目数上限（防关闭 tab/归档会话留下的陈旧条目无限堆积；超出按 updatedAt 淘旧）。 */
export const DRAFTS_COMPOSER_CAP = 100
/** 问答草稿 rpcId 数上限（同上；正常路径提交即删，这里只兜被遗弃的）。 */
export const DRAFTS_ANSWERS_CAP = 100
/**
 * 单条 composer 草稿允许持久化的图片 base64 总字符数上限（≈6MB 二进制）：
 * 超出部分丢弃（文本/文件 chip 仍持久化）——drafts.json 是单文件原子写，
 * 无上限会让每次落盘都重写一个巨型 JSON。
 */
export const DRAFT_IMAGE_DATA_CAP = 8_000_000

export type DshModuleName = 'recycle-bin' | 'groups' | 'tags' | 'pinned' | 'unread' | 'drafts'

/**
 * 参与启动快照/热重载的模块。drafts 刻意不在列：它是高频写（打字防抖落盘）
 * 且读只在 webview ready 时现读（readDrafts），进快照会让每次击键落盘都
 * 触发 watch 重读整个 drafts.json。
 */
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
  const membership = sanitizeMembership(rec.membership, new Set(groups.map((g) => g.id)))
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

/* ---- drafts：逐字段宽松清洗（坏条目丢弃而不是整文件作废——草稿丢了不致命） ---- */

function sanitizeDraftImages(value: unknown): DraftImage[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: DraftImage[] = []
  let bytes = 0
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const rec = item as Record<string, unknown>
    if (typeof rec.mediaType !== 'string' || typeof rec.data !== 'string' || rec.data === '') continue
    if (bytes + rec.data.length > DRAFT_IMAGE_DATA_CAP) continue
    bytes += rec.data.length
    out.push({ mediaType: rec.mediaType, data: rec.data, ...(typeof rec.name === 'string' ? { name: rec.name } : {}) })
  }
  return out.length > 0 ? out : undefined
}

function sanitizeDraftFileChips(value: unknown): DraftFileChip[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: DraftFileChip[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const rec = item as Record<string, unknown>
    if (typeof rec.name !== 'string' || typeof rec.path !== 'string' || rec.path === '') continue
    out.push({ name: rec.name, path: rec.path, ...(rec.image === true ? { image: true } : {}) })
  }
  return out.length > 0 ? out : undefined
}

function sanitizeComposerDraft(value: unknown): ComposerDraftEntry | null {
  if (typeof value !== 'object' || value === null) return null
  const rec = value as Record<string, unknown>
  const text = typeof rec.text === 'string' ? rec.text : ''
  const images = sanitizeDraftImages(rec.images)
  const files = sanitizeDraftFileChips(rec.files)
  // 全空条目不复活（正常路径空即删，这里兜脏数据）。
  if (text === '' && !images && !files) return null
  return {
    text,
    ...(images ? { images } : {}),
    ...(files ? { files } : {}),
    updatedAt: typeof rec.updatedAt === 'number' && Number.isFinite(rec.updatedAt) ? rec.updatedAt : 0,
  }
}

function sanitizeAnswerDraft(value: unknown): AnswerDraftEntry | null {
  if (typeof value !== 'object' || value === null) return null
  const rec = value as Record<string, unknown>
  const selected = Array.isArray(rec.selected) ? rec.selected.filter((s): s is string => typeof s === 'string') : []
  const custom = typeof rec.custom === 'string' ? rec.custom : ''
  const other = rec.other === true
  if (selected.length === 0 && custom === '' && !other) return null
  return { selected, custom, other }
}

export function parseDraftsFile(raw: string): DraftsFile | null {
  const rec = parseJson(raw)
  if (rec === null || rec.version !== 1 || !hasField(rec, 'composer') || !hasField(rec, 'answers')) return null
  const composer: Record<string, ComposerDraftEntry> = {}
  if (typeof rec.composer === 'object' && rec.composer !== null) {
    for (const [key, value] of Object.entries(rec.composer)) {
      const entry = sanitizeComposerDraft(value)
      if (entry) composer[key] = entry
    }
  }
  const answers: Record<string, Record<string, AnswerDraftEntry>> = {}
  if (typeof rec.answers === 'object' && rec.answers !== null) {
    for (const [rpcId, perQuestion] of Object.entries(rec.answers)) {
      if (typeof perQuestion !== 'object' || perQuestion === null) continue
      const map: Record<string, AnswerDraftEntry> = {}
      for (const [index, value] of Object.entries(perQuestion)) {
        const entry = sanitizeAnswerDraft(value)
        if (entry) map[index] = entry
      }
      if (Object.keys(map).length > 0) answers[rpcId] = map
    }
  }
  return capDraftsFile({ version: 1, composer, answers })
}

/** 超量淘旧：composer 按 updatedAt 升序删到上限内；answers 无时间戳，按插入序删最旧。 */
export function capDraftsFile(file: DraftsFile): DraftsFile {
  const composerKeys = Object.keys(file.composer)
  if (composerKeys.length > DRAFTS_COMPOSER_CAP) {
    const sorted = composerKeys.sort((a, b) => (file.composer[a]?.updatedAt ?? 0) - (file.composer[b]?.updatedAt ?? 0))
    const next = { ...file.composer }
    for (const key of sorted.slice(0, composerKeys.length - DRAFTS_COMPOSER_CAP)) delete next[key]
    file = { ...file, composer: next }
  }
  const answerKeys = Object.keys(file.answers)
  if (answerKeys.length > DRAFTS_ANSWERS_CAP) {
    const next = { ...file.answers }
    for (const key of answerKeys.slice(0, answerKeys.length - DRAFTS_ANSWERS_CAP)) delete next[key]
    file = { ...file, answers: next }
  }
  return file
}

export function emptyDraftsFile(): DraftsFile {
  return { version: 1, composer: {}, answers: {} }
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

export function serializeDraftsFile(value: DraftsFile): string {
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
  const membership = sanitizeMembership(legacyMembership, new Set(groups.map((g) => g.id)))
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

/**
 * tag 定义联合：按 id 去重，再按 name 去重（派生脚本/另一窗口重跑不产生
 * 重复组）；a 在前（既有顺序与既有定义优先，同名/同 id 时 b 的被丢弃）。
 * 预设组 name 全为 null——name 去重只对非 null 生效，否则三个预设组会
 * 因共享 null 名字互相撞掉（初版骨架的坑）。
 */
export function mergeTagDefs(a: readonly SessionTagDef[], b: readonly SessionTagDef[]): SessionTagDef[] {
  const seen = new Set<string>()
  const names = new Set<string>()
  const out: SessionTagDef[] = []
  for (const t of [...a, ...b]) {
    if (seen.has(t.id)) continue
    if (t.name !== null && names.has(t.name)) continue
    seen.add(t.id)
    if (t.name !== null) names.add(t.name)
    out.push(t)
  }
  return out
}

/** 分组定义联合：按 id 去重，再按 name 去重（分组 name 恒为 string），a 优先。 */
export function mergeGroupDefs(
  a: readonly WorkspaceGroupDef[],
  b: readonly WorkspaceGroupDef[],
): WorkspaceGroupDef[] {
  const seen = new Set<string>()
  const names = new Set<string>()
  const out: WorkspaceGroupDef[] = []
  for (const g of [...a, ...b]) {
    if (seen.has(g.id) || names.has(g.name)) continue
    seen.add(g.id)
    names.add(g.name)
    out.push(g)
  }
  return out
}

/** 分组归属联合：逐 workspace 并集（a 的顺序优先，追加 b 中不在 a 的组 id）。 */
export function mergeMembership(
  a: Readonly<Record<string, string[]>>,
  b: Readonly<Record<string, string[]>>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const wsId of new Set([...Object.keys(a), ...Object.keys(b)])) {
    out[wsId] = mergeIdList(a[wsId] ?? [], b[wsId] ?? [])
  }
  return out
}
