import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSessionTree, formatRelativeTime, UNGROUPED_WORKSPACE_ID, type SessionInput, type WorkspaceInput } from '../src/pure/sessionTree.ts'

const NOW = 1_700_000_000_000 // fixed epoch ms for deterministic tests

const ws = (
  workspaceId: string,
  sessionIds: string[],
  opts: { path?: string; title?: string; updatedAt?: string } = {},
): WorkspaceInput => ({
  workspaceId,
  path: opts.path ?? `/p/${workspaceId}`,
  title: opts.title ?? workspaceId,
  sessionIds,
  updatedAt: opts.updatedAt ?? new Date(NOW).toISOString(),
})

const s = (
  sessionId: string,
  opts: { updatedAt?: number; running?: boolean; blank?: boolean; parentSessionId?: string } = {},
): SessionInput => ({
  sessionId,
  updatedAt: opts.updatedAt ?? NOW,
  running: opts.running ?? false,
  blank: opts.blank ?? false,
  ...(opts.parentSessionId ? { parentSessionId: opts.parentSessionId } : {}),
})

const noTitles = () => null

test('groups sessions under their workspace, ordered by updatedAt desc', () => {
  const tree = buildSessionTree(
    [ws('w1', ['a', 'b', 'c'])],
    [s('a', { updatedAt: NOW - 3000 }), s('b', { updatedAt: NOW - 1000 }), s('c', { updatedAt: NOW - 2000 })],
    new Set(),
    noTitles,
    undefined,
    NOW,
  )
  assert.equal(tree.length, 1)
  assert.deepEqual(tree[0].sessions.map((n) => n.sessionId), ['b', 'c', 'a'])
})

test('current folder first and flagged; others by workspace updatedAt desc', () => {
  const tree = buildSessionTree(
    [
      ws('old', [], { updatedAt: new Date(NOW - 5000).toISOString() }),
      ws('cur', [], { path: '/repo' }),
      ws('new', [], { updatedAt: new Date(NOW - 1000).toISOString() }),
    ],
    [],
    new Set(),
    noTitles,
    '/repo',
    NOW,
  )
  assert.deepEqual(tree.map((n) => n.workspaceId), ['cur', 'new', 'old'])
  assert.deepEqual(tree.map((n) => n.isCurrent), [true, false, false])
})

test('hides archived and blank sessions', () => {
  const tree = buildSessionTree(
    [ws('w1', ['keep', 'gone', 'empty'])],
    [s('keep'), s('gone'), s('empty', { blank: true })],
    new Set(['gone']),
    noTitles,
    undefined,
    NOW,
  )
  assert.deepEqual(tree[0].sessions.map((n) => n.sessionId), ['keep'])
})

test('sessions not referenced by any workspace form a「未分组」group appended last', () => {
  const tree = buildSessionTree(
    [ws('w1', ['a'])],
    [s('a'), s('stray1', { updatedAt: NOW - 1000 }), s('stray2', { updatedAt: NOW - 2000 })],
    new Set(),
    noTitles,
    undefined,
    NOW,
  )
  assert.deepEqual(tree.map((n) => n.workspaceId), ['w1', UNGROUPED_WORKSPACE_ID])
  const ungrouped = tree[1]
  assert.equal(ungrouped.label, '未分组')
  assert.equal(ungrouped.path, '')
  assert.equal(ungrouped.isCurrent, false)
  assert.deepEqual(ungrouped.sessions.map((n) => n.sessionId), ['stray1', 'stray2'])
})

test('ungrouped group hides blank/archived orphans and vanishes when empty', () => {
  const tree = buildSessionTree(
    [ws('w1', ['a'])],
    [s('a'), s('stray-blank', { blank: true }), s('stray-gone')],
    new Set(['stray-gone']),
    noTitles,
    undefined,
    NOW,
  )
  assert.deepEqual(tree.map((n) => n.workspaceId), ['w1'])
})

test('query filters ungrouped sessions and drops the group without a match', () => {
  const tree = buildSessionTree(
    [ws('w1', ['a'])],
    [s('a'), s('stray1'), s('stray2')],
    new Set(),
    (x) => (x.sessionId === 'stray1' ? '未分组目标' : '其他'),
    undefined,
    NOW,
    { query: '未分组目标' },
  )
  assert.deepEqual(tree.map((n) => n.workspaceId), [UNGROUPED_WORKSPACE_ID])
  assert.deepEqual(tree[0].sessions.map((n) => n.sessionId), ['stray1'])
})

test('ungrouped group stays last even against the current folder', () => {
  const tree = buildSessionTree(
    [ws('w1', [], { path: '/repo' })],
    [s('stray')],
    new Set(),
    noTitles,
    '/repo',
    NOW,
  )
  assert.deepEqual(tree.map((n) => n.workspaceId), ['w1', UNGROUPED_WORKSPACE_ID])
})

test('label uses the title, falling back to a short id', () => {
  const tree = buildSessionTree(
    [ws('w1', ['titled123456', 'plain123456'])],
    [s('titled123456'), s('plain123456', { updatedAt: NOW - 1000 })],
    new Set(),
    (x) => (x.sessionId === 'titled123456' ? '修复登录页' : null),
    undefined,
    NOW,
  )
  assert.equal(tree[0].sessions[0].label, '修复登录页')
  assert.equal(tree[0].sessions[1].label, '会话 plain123')
})

test('workspace label falls back to basename(path), then to path', () => {
  const tree = buildSessionTree(
    [
      ws('named', ['a'], { title: '有名字', path: '/repo/named' }),
      ws('untitled', ['b'], { title: '', path: '/repo/untitled-dir' }),
      ws('rootish', ['c'], { title: '', path: '/' }),
    ],
    [s('a'), s('b'), s('c')],
    new Set(),
    noTitles,
    undefined,
    NOW,
  )
  assert.equal(tree[0].label, '有名字')
  assert.equal(tree[1].label, 'untitled-dir')
  assert.equal(tree[2].label, '/')
})

test('description carries the relative time; running flag passes through', () => {
  const tree = buildSessionTree(
    [ws('w1', ['a'])],
    [s('a', { updatedAt: NOW - 2 * 3_600_000, running: true })],
    new Set(),
    noTitles,
    undefined,
    NOW,
  )
  assert.equal(tree[0].sessions[0].description, '2 小时前')
  assert.equal(tree[0].sessions[0].running, true)
})

test('sort updatedAsc reverses the session order within a workspace', () => {
  const tree = buildSessionTree(
    [ws('w1', ['a', 'b', 'c'])],
    [s('a', { updatedAt: NOW - 3000 }), s('b', { updatedAt: NOW - 1000 }), s('c', { updatedAt: NOW - 2000 })],
    new Set(),
    noTitles,
    undefined,
    NOW,
    { sort: 'updatedAsc' },
  )
  assert.deepEqual(tree[0].sessions.map((n) => n.sessionId), ['a', 'c', 'b'])
})

test('sort title orders by label, not by recency', () => {
  const tree = buildSessionTree(
    [ws('w1', ['a', 'b', 'c'])],
    [s('a', { updatedAt: NOW }), s('b', { updatedAt: NOW - 2000 }), s('c', { updatedAt: NOW - 1000 })],
    new Set(),
    (x) => new Map([['a', 'zebra'], ['b', 'apple'], ['c', 'mango']]).get(x.sessionId) ?? null,
    undefined,
    NOW,
    { sort: 'title' },
  )
  assert.deepEqual(tree[0].sessions.map((n) => n.sessionId), ['b', 'c', 'a'])
})

test('query filters by title, case-insensitive, and drops empty workspaces', () => {
  const tree = buildSessionTree(
    [ws('w1', ['a', 'b']), ws('w2', ['c'])],
    [s('a'), s('b', { updatedAt: NOW - 1000 }), s('c')],
    new Set(),
    (x) => new Map([['a', '修复登录页'], ['b', 'Login hotfix'], ['c', '写周报']]).get(x.sessionId) ?? null,
    undefined,
    NOW,
    { query: 'LOGIN' },
  )
  assert.deepEqual(tree.map((n) => n.workspaceId), ['w1'])
  assert.deepEqual(tree[0].sessions.map((n) => n.sessionId), ['b'])
})

test('query also matches the session id', () => {
  const tree = buildSessionTree(
    [ws('w1', ['abc123def', 'zzz999yyy'])],
    [s('abc123def'), s('zzz999yyy', { updatedAt: NOW - 1000 })],
    new Set(),
    noTitles,
    undefined,
    NOW,
    { query: 'ABC123' },
  )
  assert.deepEqual(tree[0].sessions.map((n) => n.sessionId), ['abc123def'])
})

test('query keeps blank/archived hidden and combines with sort', () => {
  const tree = buildSessionTree(
    [ws('w1', ['keep1', 'gone', 'empty', 'keep2'])],
    [s('keep1', { updatedAt: NOW - 1000 }), s('gone'), s('empty', { blank: true }), s('keep2', { updatedAt: NOW - 2000 })],
    new Set(['gone']),
    (x) => (x.sessionId.startsWith('keep') ? '匹配目标' : null),
    undefined,
    NOW,
    { query: '匹配', sort: 'updatedAsc' },
  )
  assert.deepEqual(tree[0].sessions.map((n) => n.sessionId), ['keep2', 'keep1'])
})

test('a whitespace-only query behaves as no filter', () => {
  const tree = buildSessionTree(
    [ws('w1', ['a']), ws('w2', ['b'])],
    [s('a'), s('b')],
    new Set(),
    noTitles,
    undefined,
    NOW,
    { query: '   ' },
  )
  assert.deepEqual(tree.map((n) => n.workspaceId), ['w1', 'w2'])
})

test('pinned sessions sort first, then follow the chosen order', () => {
  const tree = buildSessionTree(
    [ws('w1', ['a', 'b', 'c'])],
    [s('a', { updatedAt: NOW - 3000 }), s('b', { updatedAt: NOW - 1000 }), s('c', { updatedAt: NOW - 2000 })],
    new Set(),
    noTitles,
    undefined,
    NOW,
    { pinned: new Set(['a']) },
  )
  assert.deepEqual(tree[0].sessions.map((n) => n.sessionId), ['a', 'b', 'c'])
  assert.deepEqual(tree[0].sessions.map((n) => n.pinned), [true, false, false])
})

test('unread marks nodes without affecting order', () => {
  const tree = buildSessionTree(
    [ws('w1', ['a', 'b'])],
    [s('a', { updatedAt: NOW - 1000 }), s('b', { updatedAt: NOW - 2000 })],
    new Set(),
    noTitles,
    undefined,
    NOW,
    { unread: new Set(['b']) },
  )
  // 未读只是展示标记，不参与排序（仍按 updatedAt 倒序）。
  assert.deepEqual(tree[0].sessions.map((n) => n.sessionId), ['a', 'b'])
  assert.deepEqual(tree[0].sessions.map((n) => n.unread), [false, true])
})

test('lineage children never appear as rows; a running one flags the parent descendantRunning', () => {
  const tree = buildSessionTree(
    [ws('w1', ['parent'])],
    [s('parent'), s('child', { running: true, parentSessionId: 'parent' })],
    new Set(),
    noTitles,
    undefined,
    NOW,
  )
  // 子代理行不进 workspace 组，也不进「未分组」组。
  assert.equal(tree.length, 1)
  assert.deepEqual(tree[0].sessions.map((n) => n.sessionId), ['parent'])
  assert.equal(tree[0].sessions[0].running, false)
  assert.equal(tree[0].sessions[0].descendantRunning, true)
})

test('descendantRunning is transitive and clears when all descendants are idle', () => {
  const tree = buildSessionTree(
    [ws('w1', ['p1', 'p2'])],
    [
      s('p1'),
      s('p2'),
      s('child', { parentSessionId: 'p1' }),
      s('grandchild', { running: true, parentSessionId: 'child' }),
      s('idle-child', { parentSessionId: 'p2' }),
    ],
    new Set(),
    noTitles,
    undefined,
    NOW,
  )
  // 孙子 running 也会沿血缘传导到 p1；p2 的子代理空闲则不标。
  assert.equal(tree[0].sessions.find((n) => n.sessionId === 'p1')?.descendantRunning, true)
  assert.equal(tree[0].sessions.find((n) => n.sessionId === 'p2')?.descendantRunning, false)
})

test('formatRelativeTime covers every tier', () => {
  assert.equal(formatRelativeTime(NOW - 500, NOW), '刚刚')
  assert.equal(formatRelativeTime(NOW - 59_000, NOW), '刚刚')
  assert.equal(formatRelativeTime(NOW - 60_000, NOW), '1 分钟前')
  assert.equal(formatRelativeTime(NOW - 45 * 60_000, NOW), '45 分钟前')
  assert.equal(formatRelativeTime(NOW - 3_600_000, NOW), '1 小时前')
  assert.equal(formatRelativeTime(NOW - 23 * 3_600_000, NOW), '23 小时前')
  assert.equal(formatRelativeTime(NOW - 86_400_000, NOW), '1 天前')
  assert.equal(formatRelativeTime(NOW - 30 * 86_400_000, NOW), '30 天前')
  // Clock skew (updatedAt in the future) clamps to "刚刚".
  assert.equal(formatRelativeTime(NOW + 60_000, NOW), '刚刚')
})
