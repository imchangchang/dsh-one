import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pruneRecycleIds, resolveRecycleIds, sanitizeRecycleIds } from '../src/pure/recycleBinState.ts'

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
