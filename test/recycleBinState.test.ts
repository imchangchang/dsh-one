import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  emptyRecycleBin,
  moveIntoRecycleBin,
  parseRecycleBin,
  pruneRecycleIds,
  resolveRecycleIds,
  restoreFromRecycleBin,
  sanitizeRecycleIds,
  serializeRecycleBin,
} from '../src/pure/recycleBinState.ts'

test('sanitizeRecycleIds：非数组返回空，过滤非字符串/空串并去重', () => {
  assert.deepEqual(sanitizeRecycleIds(null), [])
  assert.deepEqual(sanitizeRecycleIds('x'), [])
  assert.deepEqual(sanitizeRecycleIds(42), [])
  assert.deepEqual(sanitizeRecycleIds([1, 'a', '', 'b', 'a', null, 'c']), ['a', 'b', 'c'])
})

test('resolveRecycleIds：globalState 有值（哪怕空数组）就以它为准，不读旧值', () => {
  const res = resolveRecycleIds(['g1', 'g2'], ['legacy1'])
  assert.deepEqual(res, { ids: ['g1', 'g2'], fromLegacy: false })
  // 升级后某窗口恢复全部写成空数组：空即权威，旧 workspaceState 不再复活。
  const empty = resolveRecycleIds([], ['legacy1'])
  assert.deepEqual(empty, { ids: [], fromLegacy: false })
})

test('resolveRecycleIds：globalState 无值时回退旧 workspaceState 并标记迁移', () => {
  const res = resolveRecycleIds(undefined, ['legacy1', 'legacy2'])
  assert.deepEqual(res, { ids: ['legacy1', 'legacy2'], fromLegacy: true })
  const junk = resolveRecycleIds(undefined, 'not-an-array')
  assert.deepEqual(junk, { ids: [], fromLegacy: true })
  const none = resolveRecycleIds(undefined, undefined)
  assert.deepEqual(none, { ids: [], fromLegacy: false })
})

test('pruneRecycleIds：基线未就绪不清账（冷启动保护），什么都不剔除', () => {
  // 服务未运行/重启后未重拉时 knownSessionIds 为空集合，据其清账会把
  // 回收站冷启动清空——必须返回 null（调用方跳过持久化，集合原样保留）。
  assert.equal(pruneRecycleIds(['a', 'b'], new Set(), false), null)
  assert.equal(pruneRecycleIds(['a', 'b'], new Set(['a', 'b']), false), null)
})

test('pruneRecycleIds：基线就绪后剔除已不认识（归档/删除）的 id；无变化返回 null', () => {
  assert.deepEqual(pruneRecycleIds(['a', 'b', 'gone'], new Set(['a', 'b', 'c']), true), ['a', 'b'])
  assert.deepEqual(pruneRecycleIds(['gone'], new Set(['a']), true), [])
  assert.equal(pruneRecycleIds(['a', 'b'], new Set(['a', 'b']), true), null)
  assert.equal(pruneRecycleIds([], new Set(), true), null)
})

// ---------------------------------------------------------------------------
// #103 装配树用的那份持久状态模型（键 `recycle-bin`，落 ~/.dsh/dsh-one/recycle-bin.json）
// ---------------------------------------------------------------------------

test('parseRecycleBin：旧文件那份形状能读回（一次性迁入 = 读进来就完事）', () => {
  assert.deepEqual(parseRecycleBin({ version: 1, sessionIds: ['a', 'b'] }), { version: 1, sessionIds: ['a', 'b'] })
  // 脏数据按同一份清洗口径（非字符串/空串/重复都剔掉）
  assert.deepEqual(parseRecycleBin({ version: 1, sessionIds: ['a', '', 7, 'a', 'b'] }), {
    version: 1,
    sessionIds: ['a', 'b'],
  })
})

test('parseRecycleBin：宿主只存了一个 id 数组也认（第二种可接受形态）', () => {
  assert.deepEqual(parseRecycleBin(['x', 'y']), { version: 1, sessionIds: ['x', 'y'] })
  assert.deepEqual(parseRecycleBin([]), emptyRecycleBin())
})

test('parseRecycleBin：版本不符/缺字段/坏值一律 null（调用方按空状态处理）', () => {
  assert.equal(parseRecycleBin({ version: 2, sessionIds: ['a'] }), null)
  assert.equal(parseRecycleBin({ sessionIds: ['a'] }), null)
  assert.equal(parseRecycleBin({ version: 1 }), null)
  assert.equal(parseRecycleBin(null), null)
  assert.equal(parseRecycleBin('a'), null)
})

test('moveIntoRecycleBin：追加在移入顺序尾部、去重、无变化返回 null', () => {
  assert.deepEqual(moveIntoRecycleBin(emptyRecycleBin(), ['a', 'a', '']), { version: 1, sessionIds: ['a'] })
  assert.deepEqual(moveIntoRecycleBin({ version: 1, sessionIds: ['a'] }, ['b']), { version: 1, sessionIds: ['a', 'b'] })
  assert.equal(moveIntoRecycleBin({ version: 1, sessionIds: ['a'] }, ['a']), null)
  assert.equal(moveIntoRecycleBin(emptyRecycleBin(), []), null)
})

test('restoreFromRecycleBin：移出后其余顺序不变；没有一条命中时返回 null', () => {
  assert.deepEqual(restoreFromRecycleBin({ version: 1, sessionIds: ['a', 'b', 'c'] }, ['b']), {
    version: 1,
    sessionIds: ['a', 'c'],
  })
  assert.equal(restoreFromRecycleBin({ version: 1, sessionIds: ['a'] }, ['zz']), null)
})

test('serializeRecycleBin：写回的值与旧文件形状逐字同形，且不共享调用方的数组', () => {
  const source = { version: 1 as const, sessionIds: ['a'] }
  const written = serializeRecycleBin(source)
  assert.deepEqual(written, { version: 1, sessionIds: ['a'] })
  source.sessionIds.push('b')
  assert.deepEqual(written.sessionIds, ['a'])
})
