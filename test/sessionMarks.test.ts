/**
 * 置顶 / 手动未读的**状态模型**（#102）：旧文件一次性迁入读取、清洗、开关、
 * 以及「置顶项排在这一层最前」的排序工具。
 *
 * 断言的意义：这份状态住宿主能力口（`~/.dsh`），读回来的东西可能是旧形状、坏值
 * 或没有；排序是 #98 定稿里唯一的排序例外，改了会让置顶失效且很难在界面上看出来。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SESSION_PINNED_STATE_KEY,
  SESSION_UNREAD_STATE_KEY,
  emptySessionMarks,
  markStateFile,
  migrateMarkIds,
  migrateSessionMarks,
  pinnedFirst,
  sanitizeMarkIds,
  toggleMarkId,
} from '../src/pure/sessionMarks.ts'

// ---------------------------------------------------------------------------
// 键名与旧文件同名：状态的家就是旧文件那个家（与分组同一处置，没有搬家这一步）
// ---------------------------------------------------------------------------

test('状态键 = 旧侧栏的文件名（pinned.json / unread.json）', () => {
  assert.equal(SESSION_PINNED_STATE_KEY, 'pinned')
  assert.equal(SESSION_UNREAD_STATE_KEY, 'unread')
  assert.deepEqual(emptySessionMarks(), { pinned: [], unread: [] })
})

// ---------------------------------------------------------------------------
// 一次性迁入读取
// ---------------------------------------------------------------------------

test('迁入：旧文件的规范形状（{version:1, sessionIds}）原样采用，不需要写回', () => {
  const legacy = { version: 1, sessionIds: ['s1', 's2', 's1', '', 7, null, 's3'] }
  assert.deepEqual(migrateMarkIds(legacy), { ids: ['s1', 's2', 's3'], needsRewrite: false })
})

test('迁入：更早的裸 id 数组也认（旧 Memento 值），并按规范形状写回一次', () => {
  assert.deepEqual(migrateMarkIds(['a', 'b', 'a']), { ids: ['a', 'b'], needsRewrite: true })
  assert.deepEqual(migrateMarkIds([]), { ids: [], needsRewrite: true })
})

test('迁入：没有文件时不写回（null / undefined 都是干净的空状态）', () => {
  assert.deepEqual(migrateMarkIds(null), { ids: [], needsRewrite: false })
  assert.deepEqual(migrateMarkIds(undefined), { ids: [], needsRewrite: false })
})

test('迁入：坏值（版本不符 / 字段缺失 / 非对象）不崩，按空状态处理并写回归一形状', () => {
  for (const junk of [{ version: 2, sessionIds: ['x'] }, { version: 1 }, 'pinned', 42, true, { sessionIds: ['x'] }]) {
    assert.deepEqual(migrateMarkIds(junk), { ids: [], needsRewrite: true }, JSON.stringify(junk))
  }
})

test('迁入：两份标记一起走（各自判定要不要写回）', () => {
  const loaded = migrateSessionMarks({
    pinned: { version: 1, sessionIds: ['s1'] },
    unread: ['s2', 's3'],
  })
  assert.deepEqual(loaded, { marks: { pinned: ['s1'], unread: ['s2', 's3'] }, rewrite: ['unread'] })
  assert.deepEqual(migrateSessionMarks({ pinned: null, unread: null }), {
    marks: { pinned: [], unread: [] },
    rewrite: [],
  })
  assert.deepEqual(migrateSessionMarks({ pinned: 'junk', unread: { version: 9 } }), {
    marks: { pinned: [], unread: [] },
    rewrite: ['pinned', 'unread'],
  })
})

test('迁入落定后的形状就是 dshStateFile 认识的 IdListFile（版本 1 + sessionIds）', () => {
  const file = markStateFile(['s1', 's2'])
  assert.deepEqual(file, { version: 1, sessionIds: ['s1', 's2'] })
  // 写回后再迁入一次 = 幂等（needsRewrite 假，不再重复写盘）。
  assert.deepEqual(migrateMarkIds(file), { ids: ['s1', 's2'], needsRewrite: false })
})

test('sanitizeMarkIds：非数组返回空，过滤非字符串/空串并去重', () => {
  assert.deepEqual(sanitizeMarkIds(null), [])
  assert.deepEqual(sanitizeMarkIds('x'), [])
  assert.deepEqual(sanitizeMarkIds([1, 'a', '', 'b', 'a', null, 'c']), ['a', 'b', 'c'])
})

// ---------------------------------------------------------------------------
// 开关（无变化返回同一份引用 = 调用方据此跳过写盘）
// ---------------------------------------------------------------------------

test('toggleMarkId：置顶加到末尾；已在集合里返回同一份引用（不触发写盘）', () => {
  const ids = ['a', 'b'] as readonly string[]
  assert.deepEqual(toggleMarkId(ids, 'c', true), ['a', 'b', 'c'])
  assert.equal(toggleMarkId(ids, 'a', true), ids)
})

test('toggleMarkId：取消置顶/标为已读就是摘掉这个 id；不在集合里返回同一份引用', () => {
  const ids = ['a', 'b'] as readonly string[]
  assert.deepEqual(toggleMarkId(ids, 'a', false), ['b'])
  assert.equal(toggleMarkId(ids, 'zz', false), ids)
})

// ---------------------------------------------------------------------------
// 排序工具：置顶项在它所在的那一层排最前，其余保持官方顺序
// ---------------------------------------------------------------------------

test('pinnedFirst：置顶项按原相对顺序排前，其余按原相对顺序跟上（不改入参）', () => {
  const items = [
    { id: 'a', pinned: false },
    { id: 'b', pinned: true },
    { id: 'c', pinned: false },
    { id: 'd', pinned: true },
  ]
  const sorted = pinnedFirst(items, (item) => item.pinned)
  assert.deepEqual(sorted.map((item) => item.id), ['b', 'd', 'a', 'c'])
  assert.deepEqual(items.map((item) => item.id), ['a', 'b', 'c', 'd'])
})

test('pinnedFirst：全置顶 / 全非置顶 / 空数组都返回同样的顺序', () => {
  const all = ['a', 'b']
  assert.deepEqual(pinnedFirst(all, () => true), ['a', 'b'])
  assert.deepEqual(pinnedFirst(all, () => false), ['a', 'b'])
  assert.deepEqual(pinnedFirst([], () => true), [])
})

test('pinnedFirst：对 id 数组同样适用（标签组内那层直接复用）', () => {
  const pinned = new Set(['s3'])
  const ids = ['s1', 's2', 's3', 's4']
  assert.deepEqual(pinnedFirst(ids, (id) => pinned.has(id)), ['s3', 's1', 's2', 's4'])
})
