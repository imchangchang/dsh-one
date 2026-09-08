import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  emptyCustomTagIds,
  isPresetTag,
  nextCustomColor,
  PRESET_TAGS,
  PRESET_TAG_IDS,
  presetTagSnapshots,
  removeTagFromAll,
  reorderTags,
  sanitizeSessionTagIds,
  sanitizeTags,
  setSessionTagId,
  tagDisplayName,
  tagNameError,
  type SessionTagDef,
} from '../src/pure/sessionTags.ts'

const en = (k: string): string => k

const UNGROUPED = '__ungrouped__'

const custom = (id: string, name: string, color: SessionTagDef['color'] = 'orange'): SessionTagDef => ({
  id,
  name,
  color,
})

test('sanitizeTags seeds the three presets when raw is missing', () => {
  assert.deepEqual(
    sanitizeTags(undefined).map((t) => t.id),
    [...PRESET_TAG_IDS],
  )
  assert.deepEqual(
    sanitizeTags(null).map((t) => t.id),
    [...PRESET_TAG_IDS],
  )
  // 预设组名都是 null（走 l10n），颜色为状态语义色。
  assert.deepEqual(
    sanitizeTags(undefined).map((t) => [t.id, t.name, t.color]),
    [
      ['preset-todo', null, 'yellow'],
      ['preset-doing', null, 'blue'],
      ['preset-done', null, 'green'],
    ],
  )
})

test('sanitizeTags keeps user order, appends missing presets, drops bad entries', () => {
  const raw = [
    { id: 't-1', name: ' 探索 ', color: 'orange' },
    { id: 'preset-done', name: null, color: 'green' },
    { id: '', name: 'x', color: 'orange' }, // 空 id 丢弃
    { id: 't-2', name: '  ', color: 'orange' }, // 空名丢弃
    { id: 't-3', name: 'x', color: 'nope' }, // 非法色回退 orange
    { id: 't-1', name: '重复', color: 'purple' }, // 重复 id 丢弃
    'garbage', // 非对象丢弃
  ]
  const tags = sanitizeTags(raw)
  assert.deepEqual(
    tags.map((t) => [t.id, t.name, t.color]),
    [
      ['t-1', '探索', 'orange'],
      ['preset-done', null, 'green'],
      ['t-3', 'x', 'orange'],
      ['preset-todo', null, 'yellow'],
      ['preset-doing', null, 'blue'],
    ],
  )
})

test('tagDisplayName: preset names come from l10n, custom names pass through', () => {
  assert.equal(tagDisplayName(PRESET_TAGS[0], en), 'Todo')
  assert.equal(tagDisplayName(custom('t-1', '探索'), en), '探索')
})

test('isPresetTag / nextCustomColor', () => {
  assert.equal(isPresetTag(PRESET_TAGS[0]), true)
  assert.equal(isPresetTag(custom('t-1', 'x')), false)
  const tags = sanitizeTags(undefined)
  assert.equal(nextCustomColor(tags), 'orange')
  // 三个自定义组后回到橙（palette 轮换：orange → purple → red → orange…）。
  assert.equal(nextCustomColor([...tags, custom('t-1', 'a'), custom('t-2', 'b'), custom('t-3', 'c')]), 'orange')
  assert.equal(nextCustomColor([...tags, custom('t-1', 'a'), custom('t-2', 'b')]), 'red')
})

test('sanitizeSessionTagIds keeps known ids only and drops empty keys', () => {
  const ids = new Set(['preset-todo', 't-1'])
  assert.deepEqual(
    sanitizeSessionTagIds(
      { s1: 'preset-todo', s2: 't-1', s3: 't-gone', '': 'preset-todo', s4: 42 },
      ids,
    ),
    { s1: 'preset-todo', s2: 't-1' },
  )
  assert.deepEqual(sanitizeSessionTagIds('nope', ids), {})
})

test('setSessionTagId is a single-membership assignment; null clears the key', () => {
  const known = new Set(['todo', 't-1'])
  const m = { s1: 'todo' }
  // 同值幂等：返回 null。
  assert.equal(setSessionTagId(m, 's1', 'todo', known), null)
  // 换组：s1 → t-1；s2 入组。
  const next = setSessionTagId(m, 's1', 't-1', known)!
  assert.deepEqual(next, { s1: 't-1' })
  const next2 = setSessionTagId(next, 's2', 'todo', known)!
  assert.deepEqual(next2, { s1: 't-1', s2: 'todo' })
  // 移出组（null）：键删除；未知组 id 拒绝。
  assert.deepEqual(setSessionTagId(next2, 's2', null, known), { s1: 't-1' })
  assert.equal(setSessionTagId(m, 's1', 't-gone', known), null)
})

test('removeTagFromAll clears every reference to a tag', () => {
  const m = { s1: 'todo', s2: 't-1', s3: 'todo' }
  const next = removeTagFromAll(m, 'todo')
  assert.deepEqual(next, { s2: 't-1' })
  // 无变化时返回原引用（调用方跳过持久化/通知）。
  assert.equal(removeTagFromAll(next, 'todo'), next)
})

test('emptyCustomTagIds prunes only custom groups with no active member', () => {
  const tags = sanitizeTags(undefined).concat(custom('t-1', '探索'))
  const membership = { s1: 't-1', s2: 't-1' }
  // 组内会话全部不活跃 → 命中（内容全移到回收站/失效）。
  assert.deepEqual(emptyCustomTagIds(tags, membership, () => false), ['t-1'])
  // 至少一个活跃成员 → 保留。
  assert.deepEqual(emptyCustomTagIds(tags, membership, (id) => id === 's1'), [])
  // 预设组即使无活跃成员也不删（恒存在）。
  const presetMembership = { s1: 'preset-todo' }
  assert.deepEqual(emptyCustomTagIds(tags, presetMembership, () => false), [])
  // 从未挂过会话的组（刚创建）不视为空——保留给用户新建后立即加入。
  assert.deepEqual(emptyCustomTagIds(tags, {}, () => false), [])
  // 无自定义组时恒空。
  assert.deepEqual(emptyCustomTagIds(sanitizeTags(undefined), membership, () => false), [])
})

test('reorderTags validates full-id submissions and no-ops', () => {
  const tags = sanitizeTags(undefined)
  const ids = ['preset-doing', 'preset-todo', 'preset-done']
  assert.deepEqual(reorderTags(tags, ids)!.map((t) => t.id), ids)
  // 缺 id / 未知 id / 空提交 → null。
  assert.equal(reorderTags(tags, ['preset-todo']), null)
  assert.equal(reorderTags(tags, [...ids, 't-x']), null)
  assert.equal(reorderTags(tags, []), null)
  // 顺序一致 → null。
  assert.equal(reorderTags(tags, [...PRESET_TAG_IDS]), null)
})

test('tagNameError checks non-empty unique names against custom tags only', () => {
  const tags = sanitizeTags(undefined).concat(custom('t-1', '探索'))
  assert.equal(tagNameError('', tags), 'empty')
  assert.equal(tagNameError('   ', tags), 'empty')
  assert.equal(tagNameError('探索', tags), 'duplicate')
  // 预设组名（Todo/Doing/Done）不与自定义组比较重名。
  assert.equal(tagNameError('Todo', tags), null)
  // excludeId 排除自身（重命名不改名）。
  assert.equal(tagNameError('探索', tags, 't-1'), null)
})

test('presetTagSnapshots emits the three presets for workspaces without a bucket', () => {
  // 无桶 workspace → 补齐 todo/doing/done（按 PRESET_TAGS 序、名字走 l10n、preset 恒 true）。
  const snap = presetTagSnapshots(new Set<string>([]), ['ws-a', UNGROUPED], en)
  assert.deepEqual(
    snap.map((x) => [x.workspaceId, x.id, x.name, x.color, x.preset]),
    [
      ['ws-a', 'preset-todo', 'Todo', 'yellow', true],
      ['ws-a', 'preset-doing', 'Doing', 'blue', true],
      ['ws-a', 'preset-done', 'Done', 'green', true],
      [UNGROUPED, 'preset-todo', 'Todo', 'yellow', true],
      [UNGROUPED, 'preset-doing', 'Doing', 'blue', true],
      [UNGROUPED, 'preset-done', 'Done', 'green', true],
    ],
  )
  // 有桶的 workspace 不再重复补（去除已存在的）。
  const withBucket = presetTagSnapshots(new Set(['ws-a']), ['ws-a', 'ws-b'], en)
  assert.deepEqual(
    withBucket.map((x) => x.workspaceId),
    ['ws-b', 'ws-b', 'ws-b'],
  )
  // 空 workspace 集 → 空输出；重复 workspace 也去重（Set 逐 id 一次）。
  assert.deepEqual(presetTagSnapshots(new Set<string>([]), [], en), [])
  assert.deepEqual(presetTagSnapshots(new Set<string>([]), ['ws-a', 'ws-a'], en).map((x) => [x.workspaceId, x.id]), [
    ['ws-a', 'preset-todo'],
    ['ws-a', 'preset-doing'],
    ['ws-a', 'preset-done'],
  ])
})
