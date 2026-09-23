/**
 * 「置顶这份状态住哪儿」的两代取用（#240）：官方注册表（0.1.7 起）与自有 `pinned`
 * 键（0.1.6 及以下）之间的分叉判据、读取清洗，以及「整份集合 → 官方那两条方法」的
 * 写入差量。
 *
 * 断言的意义：这一层判错了不会有报错，只会**静默分叉**——界面读官方集合、写入却进
 * 自有键（或反过来），用户在两个前端看到的置顶集合就对不上，而这在页面上看不出来，
 * 只有把两端的读数摆在一起才发现。所以每一条都在钉「按什么判、写什么」。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PINNED_IDS_FIELD,
  PIN_METHOD,
  UNPIN_METHOD,
  isPinWrite,
  pinWrites,
  registryPinnedIds,
} from '../src/pure/sessionPinSource.ts'

// ---------------------------------------------------------------------------
// 名字常量：探针按它们查官方 combo（改了这个名字，探针要跟着查新名）
// ---------------------------------------------------------------------------

test('三个名字常量就是官方产物里的原词（探针按它们查在场）', () => {
  assert.equal(PINNED_IDS_FIELD, 'pinnedSessionIds')
  assert.equal(PIN_METHOD, 'pinSession')
  assert.equal(UNPIN_METHOD, 'unpinSession')
})

// ---------------------------------------------------------------------------
// 读：官方那一格在不在 = 这一页是不是「置顶归官方」那一代
// ---------------------------------------------------------------------------

test('读：官方快照有那一格时给出清洗后的 id 集合（非字符串/空串/重复丢掉）', () => {
  assert.deepEqual(registryPinnedIds({ pinnedSessionIds: ['s2', 's1', 's2', '', 7, null] }), ['s2', 's1'])
  // 顺序保留原样：官方那份按「最近置顶的在前」自己排序，渲染那一侧不看集合内顺序。
  assert.deepEqual(registryPinnedIds({ pinnedSessionIds: [] }), [])
})

test('读：没有那一格（0.1.6 及以下）给 null —— 调用方据此退回自有 pinned 键', () => {
  assert.equal(registryPinnedIds({}), null)
  assert.equal(registryPinnedIds(undefined), null)
  // 形状变了（不是数组）也算「这一代不可用」：宁可用自有键，也不拿半份官方数据当权威。
  assert.equal(registryPinnedIds({ pinnedSessionIds: 's1' as unknown }), null)
  assert.equal(registryPinnedIds({ pinnedSessionIds: null as unknown }), null)
})

test('读：快照初值（[] + phase pending）也算这一代在场——「字段在不在」不吃数据到没到', () => {
  assert.deepEqual(registryPinnedIds({ pinnedSessionIds: [] }), [])
})

// ---------------------------------------------------------------------------
// 写：两个方法都在场才算官方写入面
// ---------------------------------------------------------------------------

test('写：两个方法都是函数才算可用；缺一个都不算（宁可报错也不调不存在的函数）', () => {
  const both = { pinSession: () => Promise.resolve(), unpinSession: () => Promise.resolve() }
  assert.equal(isPinWrite(both), true)
  assert.equal(isPinWrite(undefined), false)
  assert.equal(isPinWrite({}), false)
  assert.equal(isPinWrite({ pinSession: both.pinSession }), false)
  assert.equal(isPinWrite({ unpinSession: both.unpinSession }), false)
  assert.equal(isPinWrite({ pinSession: 'pin', unpinSession: 'unpin' }), false)
})

// ---------------------------------------------------------------------------
// 差量：整份目标集合 → 官方那两条方法
// ---------------------------------------------------------------------------

test('差量：只对变化的 id 发动作（新加的 pin、去掉的 unpin，其余一个字不发）', () => {
  assert.deepEqual(pinWrites(['a', 'b'], ['b', 'c']), { pin: ['c'], unpin: ['a'] })
})

test('差量：没有变化时两条都是空——界面按整份集合写，官方那一代不该白写注册表', () => {
  assert.deepEqual(pinWrites(['a', 'b'], ['a', 'b']), { pin: [], unpin: [] })
  // 顺序不算变化：官方那份集合按「最近置顶的在前」自己排，我们的差量不看顺序。
  assert.deepEqual(pinWrites(['a', 'b'], ['b', 'a']), { pin: [], unpin: [] })
})

test('差量：从空到有 / 从有到空（一次置顶、一次全部取消）', () => {
  assert.deepEqual(pinWrites([], ['a']), { pin: ['a'], unpin: [] })
  assert.deepEqual(pinWrites(['a'], []), { pin: [], unpin: ['a'] })
})

test('差量：同一份目标集合重复交回是幂等的（第二次两条都空，不会重复发动作）', () => {
  const first = pinWrites([], ['a', 'b'])
  assert.deepEqual(first, { pin: ['a', 'b'], unpin: [] })
  assert.deepEqual(pinWrites(['a', 'b'], ['a', 'b']), { pin: [], unpin: [] })
})
