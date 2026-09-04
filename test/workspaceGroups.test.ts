import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  sanitizeGroups,
  sanitizeMembership,
  groupMembershipCount,
  setWorkspaceGroupIds,
  removeGroupId,
  reorderGroups,
  groupNameError,
} from '../src/pure/workspaceGroups.ts'

const G = (id: string, name: string) => ({ id, name })

test('sanitizeGroups：丢弃缺 id/空名/重复 id，trim 名称，非数组返回空', () => {
  const raw = [
    { id: 'a', name: ' 演示 ' },
    { id: 'a', name: '重复 id' },
    { id: '', name: '空 id' },
    { id: 'b', name: '' },
    { id: 'b', name: '    ' },
    'junk',
    null,
    { id: 'c', name: '开发', extra: 1 },
  ]
  assert.deepEqual(sanitizeGroups(raw), [G('a', '演示'), G('c', '开发')])
  assert.deepEqual(sanitizeGroups(null), [])
  assert.deepEqual(sanitizeGroups('x'), [])
})

test('sanitizeMembership：未知组 id 剔除、去重、非数组跳过、空结果不保留', () => {
  const known = new Set(['a', 'b'])
  const raw = {
    ws1: ['a', 'b', 'a', 'c'],
    ws2: [1, 'a'],
    ws3: 'nope',
    ws4: [],
  }
  assert.deepEqual(sanitizeMembership(raw, known), { ws1: ['a', 'b'], ws2: ['a'] })
  assert.deepEqual(sanitizeMembership(null, known), {})
  assert.deepEqual(sanitizeMembership([], known), {})
})

test('groupMembershipCount：只数当前基线存在的 workspace', () => {
  const membership = { ws1: ['a'], ws2: ['a', 'b'], gone: ['a'] }
  assert.equal(groupMembershipCount(membership, 'a', new Set(['ws1', 'ws2', 'gone'])), 3)
  assert.equal(groupMembershipCount(membership, 'a', new Set(['ws1', 'ws2'])), 2)
  assert.equal(groupMembershipCount(membership, 'b', new Set(['ws1'])), 0)
  assert.equal(groupMembershipCount({}, 'a', new Set(['ws1'])), 0)
})

test('setWorkspaceGroupIds：未知组剔除、去重、无差异返回 null', () => {
  const known = new Set(['a', 'b'])
  const base = { ws1: ['a'] }
  assert.deepEqual(setWorkspaceGroupIds(base, 'ws1', ['a', 'b', 'a', 'nope'], known), { ws1: ['a', 'b'] })
  assert.equal(setWorkspaceGroupIds(base, 'ws1', ['a'], known), null)
  assert.deepEqual(setWorkspaceGroupIds(base, 'ws1', [], known), {})
  assert.deepEqual(setWorkspaceGroupIds({}, 'ws2', ['b'], known), { ws2: ['b'] })
})

test('removeGroupId：清掉所有 workspace 里的该组 id；无命中返回原映射', () => {
  const membership = { ws1: ['a', 'b'], ws2: ['b'], ws3: [] }
  assert.deepEqual(removeGroupId(membership, 'b'), { ws1: ['a'] })
  assert.equal(removeGroupId(membership, 'z'), membership)
})

test('reorderGroups：未知 id 丢弃、缺项/为空无效、与现序一致返回 null', () => {
  const groups = [G('a', 'A'), G('b', 'B'), G('c', 'C')]
  assert.deepEqual(reorderGroups(groups, ['c', 'a', 'b']), [G('c', 'C'), G('a', 'A'), G('b', 'B')])
  assert.equal(reorderGroups(groups, ['a', 'b', 'nope']), null)
  assert.equal(reorderGroups(groups, ['a', 'b']), null)
  assert.equal(reorderGroups(groups, []), null)
  assert.equal(reorderGroups(groups, ['a', 'b', 'c']), null)
})

test('groupNameError：空名/重名（可排除自身）', () => {
  const groups = [G('a', '演示'), G('b', '开发')]
  assert.equal(groupNameError('  ', groups), 'empty')
  assert.equal(groupNameError(' 演示 ', groups), 'duplicate')
  assert.equal(groupNameError(' 演示 ', groups, 'a'), null) // 改回自己的原名允许
  assert.equal(groupNameError('日常', groups), null)
})
