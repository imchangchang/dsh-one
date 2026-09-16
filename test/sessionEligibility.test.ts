/**
 * 会话资格判定（#102 保护规则）：勾选 / 移入回收站 / 归档三条线的口径。
 *
 * 断言的意义：置顶会话不能被顺手清掉（不可勾选、不可移入回收站、不可归档），
 * 而运行中 / 未读 / 等用户的会话**可以**移入回收站（可逆）但不可以归档（终点动作）
 * ——两条线的差别就在这一处，改错会让置顶失去意义或多锁掉能做的事。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canArchive,
  canRecycle,
  cannotArchiveReason,
  cannotRecycleReason,
  groupSelectionState,
  sessionBusy,
  type SessionEligibilityFacts,
} from '../src/pure/sessionEligibility.ts'

const facts = (over: Partial<SessionEligibilityFacts> = {}): SessionEligibilityFacts => ({
  pinned: false,
  running: false,
  unread: false,
  ...over,
})

// ---------------------------------------------------------------------------
// 移入回收站（可逆的一层）
// ---------------------------------------------------------------------------

test('canRecycle：只有置顶不允许，运行中/未读/等用户的会话都可以移入', () => {
  assert.equal(canRecycle(facts()), true)
  assert.equal(canRecycle(facts({ running: true })), true)
  assert.equal(canRecycle(facts({ runningSubagentCount: 2 })), true)
  assert.equal(canRecycle(facts({ unread: true })), true)
  assert.equal(canRecycle(facts({ pendingInteraction: 'approval' })), true)
  assert.equal(canRecycle(facts({ pinned: true })), false)
  assert.equal(cannotRecycleReason(facts({ pinned: true })), 'pinned')
  assert.equal(cannotRecycleReason(facts({ running: true })), null)
})

// ---------------------------------------------------------------------------
// 归档（终点动作）
// ---------------------------------------------------------------------------

test('canArchive：置顶与「状态还在动」的会话都不允许，原因按优先级给', () => {
  assert.equal(canArchive(facts()), true)
  assert.equal(cannotArchiveReason(facts()), null)
  assert.equal(cannotArchiveReason(facts({ pinned: true })), 'pinned')
  assert.equal(cannotArchiveReason(facts({ running: true })), 'running')
  // 后代子代理在跑 = 这一支也还在动（旧侧栏的 descendantRunning）。
  assert.equal(cannotArchiveReason(facts({ runningSubagentCount: 1 })), 'running')
  assert.equal(cannotArchiveReason(facts({ unread: true })), 'unread')
  assert.equal(cannotArchiveReason(facts({ pendingInteraction: 'question' })), 'pending')
})

test('canArchive：多个原因同时在时，先报置顶（用户自己加的锁），再报等用户/运行中/未读', () => {
  assert.equal(cannotArchiveReason(facts({ pinned: true, running: true, unread: true })), 'pinned')
  assert.equal(cannotArchiveReason(facts({ pendingInteraction: 'plan-review', running: true })), 'pending')
  assert.equal(cannotArchiveReason(facts({ running: true, unread: true })), 'running')
})

test('sessionBusy：自身运行或任一代子代理在跑都算「状态还在动」', () => {
  assert.equal(sessionBusy(facts()), false)
  assert.equal(sessionBusy(facts({ running: true })), true)
  assert.equal(sessionBusy(facts({ runningSubagentCount: 3 })), true)
  assert.equal(sessionBusy(facts({ runningSubagentCount: 0 })), false)
})

// ---------------------------------------------------------------------------
// 组头三态全选：有置顶这类不够格的成员时，最满也只能到 some
// ---------------------------------------------------------------------------

test('groupSelectionState：够格成员全选中且层里没有不够格的成员才是 all', () => {
  const members = ['a', 'b']
  const selected = new Set(['a', 'b'])
  assert.equal(groupSelectionState(members, () => true, (id) => selected.has(id)), 'all')
})

test('groupSelectionState：组内有一条置顶时，其余全选也只有 some（顶不到全选）', () => {
  const members = ['pinned', 'a', 'b']
  const selected = new Set(['a', 'b'])
  const state = groupSelectionState(
    members,
    (id) => id !== 'pinned',
    (id) => selected.has(id),
  )
  assert.equal(state, 'some')
  // 连置顶那条也「选中」了（不可能发生；万一发生也不该翻成全选）。
  selected.add('pinned')
  assert.equal(
    groupSelectionState(
      members,
      (id) => id !== 'pinned',
      (id) => selected.has(id),
    ),
    'some',
  )
})

test('groupSelectionState：一个都没选 = none；整个层都不够格 = none', () => {
  assert.equal(groupSelectionState(['a', 'b'], () => true, () => false), 'none')
  assert.equal(groupSelectionState(['pinned'], () => false, () => true), 'none')
  assert.equal(groupSelectionState([], () => true, () => true), 'none')
})

test('groupSelectionState：部分选中 = some', () => {
  const selected = new Set(['a'])
  assert.equal(groupSelectionState(['a', 'b', 'c'], () => true, (id) => selected.has(id)), 'some')
})
