import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSessionTree, buildSubagentTree, formatRelativeTime, subagentCatalogRoots, subagentTreeSignature, UNGROUPED_WORKSPACE_ID, type SessionInput, type WorkspaceInput } from '../src/pure/sessionTree.ts'

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
  opts: { updatedAt?: number; running?: boolean; blank?: boolean; parentSessionId?: string; origin?: string; title?: string | null; sessionStatsTurns?: number } = {},
): SessionInput => ({
  sessionId,
  updatedAt: opts.updatedAt ?? NOW,
  running: opts.running ?? false,
  blank: opts.blank ?? false,
  title: opts.title,
  ...(opts.parentSessionId ? { parentSessionId: opts.parentSessionId } : {}),
  ...(opts.origin ? { origin: opts.origin } : {}),
  ...(opts.sessionStatsTurns !== undefined ? { sessionStatsTurns: opts.sessionStatsTurns } : {}),
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
  assert.deepEqual(tree.map((n) => n.workspaceId), ['w1', UNGROUPED_WORKSPACE_ID])
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
  assert.deepEqual(tree.map((n) => n.workspaceId), ['cur', 'new', 'old', UNGROUPED_WORKSPACE_ID])
  assert.deepEqual(tree.map((n) => n.isCurrent), [true, false, false, false])
})

test('pathEqual normalizes Windows-style path differences for the vscode badge', () => {
  // Windows 场景：dsh 侧 path 为正斜杠大写盘符，VS Code fsPath 为反斜杠小写盘符。
  const norm = (p: string): string => p.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
  const tree = buildSessionTree(
    [ws('w1', [], { path: 'C:/Users/imcha/proj' })],
    [],
    new Set(),
    noTitles,
    'c:\\Users\\imcha\\proj',
    NOW,
    { pathEqual: (a, b) => norm(a) === norm(b) },
  )
  assert.equal(tree[0].isCurrent, true)
  // 默认严格比较（macOS/Linux）：大小写/斜杠不同视为不同目录。
  const strict = buildSessionTree(
    [ws('w1', [], { path: 'C:/Users/imcha/proj' })],
    [],
    new Set(),
    noTitles,
    'c:\\Users\\imcha\\proj',
    NOW,
  )
  assert.equal(strict[0].isCurrent, false)
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
  assert.equal(ungrouped.label, 'Ungrouped')
  assert.equal(ungrouped.path, '')
  assert.equal(ungrouped.isCurrent, false)
  assert.deepEqual(ungrouped.sessions.map((n) => n.sessionId), ['stray1', 'stray2'])
})

test('ungrouped group hides blank/archived orphans but persists with empty sessions', () => {
  const tree = buildSessionTree(
    [ws('w1', ['a'])],
    [s('a'), s('stray-blank', { blank: true }), s('stray-gone')],
    new Set(['stray-gone']),
    noTitles,
    undefined,
    NOW,
  )
  // 空未分组组仍保留（组头是「新建未分组对话」的入口）。
  assert.deepEqual(tree.map((n) => n.workspaceId), ['w1', UNGROUPED_WORKSPACE_ID])
  assert.deepEqual(tree[1].sessions, [])
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
  assert.equal(tree[0].sessions[1].label, 'Session plain123')
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
  assert.equal(tree[0].sessions[0].description, '2 hours ago')
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

test('query keeps content-hit sessions without a title/id match and passes the snippet', () => {
  const tree = buildSessionTree(
    [ws('w1', ['a', 'b']), ws('w2', ['c'])],
    [s('a'), s('b', { updatedAt: NOW - 1000 }), s('c')],
    new Set(),
    (x) => new Map([['a', '服务器问题排查'], ['b', '写周报'], ['c', '登录页']]).get(x.sessionId) ?? null,
    undefined,
    NOW,
    { query: '容器', contentHits: new Map([['a', 'k8s 容器崩溃 p0']]) },
  )
  // b（无标题/ID 命中、无内容命中）被过滤；w2 整组无命中被丢弃。
  assert.deepEqual(tree.map((n) => n.workspaceId), ['w1'])
  assert.deepEqual(tree[0].sessions.map((n) => n.sessionId), ['a'])
  assert.equal(tree[0].sessions[0].contentSnippet, 'k8s 容器崩溃 p0')
})

test('content-hit orphan sessions appear in ungrouped and carry the snippet', () => {
  const tree = buildSessionTree(
    [ws('w1', ['a'])],
    [s('a'), s('stray', { updatedAt: NOW - 1000 })],
    new Set(),
    noTitles,
    undefined,
    NOW,
    { query: 'k8s', contentHits: new Map([['stray', 'k8s 容器']]) },
  )
  // w1 的 'a' 无命中被丢弃；孤儿 'stray' 内容命中，进未分组。
  assert.deepEqual(tree.map((n) => n.workspaceId), [UNGROUPED_WORKSPACE_ID])
  assert.deepEqual(tree[0].sessions.map((n) => n.sessionId), ['stray'])
  assert.equal(tree[0].sessions[0].contentSnippet, 'k8s 容器')
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
  assert.deepEqual(tree.map((n) => n.workspaceId), ['w1', 'w2', UNGROUPED_WORKSPACE_ID])
})

test('pinned sessions sort first; group holds array order, the rest follow the sort order', () => {
  const tree = buildSessionTree(
    [ws('w1', ['a', 'b', 'c', 'd'])],
    [
      s('a', { updatedAt: NOW - 3000 }),
      s('b', { updatedAt: NOW - 1000 }),
      s('c', { updatedAt: NOW - 2000 }),
      s('d', { updatedAt: NOW - 500 }),
    ],
    new Set(),
    noTitles,
    undefined,
    NOW,
    { pinned: ['c', 'a'] },
  )
  // 置顶组内按数组顺序（c 前 a 后），不顾 updatedAt；非置顶 b/d 按默认
  // updatedDesc 排在其后（d 更新在前）。
  assert.deepEqual(tree[0].sessions.map((n) => n.sessionId), ['c', 'a', 'd', 'b'])
  assert.deepEqual(tree[0].sessions.map((n) => n.pinned), [true, true, false, false])
})

test('pinned group order is fixed and does not change when a pinned session becomes newest', () => {
  // a 的 updatedAt 最晚（最新），但置顶数组 ['b','a'] 决定组内顺序 b 在前——
  // 绝对优先使 updatedAt 不再参与置顶组内排序。
  const tree = buildSessionTree(
    [ws('w1', ['a', 'b', 'c'])],
    [
      s('a', { updatedAt: NOW }),
      s('b', { updatedAt: NOW - 1000 }),
      s('c', { updatedAt: NOW - 2000 }),
    ],
    new Set(),
    noTitles,
    undefined,
    NOW,
    { pinned: ['b', 'a'] },
  )
  assert.deepEqual(tree[0].sessions.map((n) => n.sessionId), ['b', 'a', 'c'])
})

test('re-pinning a session moves it to the pin-group front (unshift semantics)', () => {
  // 模拟 store 的 unshift：取消 b 再置顶 b ⇒ pinned 数组从 ['a'] 变为 ['b','a']，
  // b 跳到最前，且不受其较旧 updatedAt 影响。
  const tree = buildSessionTree(
    [ws('w1', ['a', 'b'])],
    [s('a', { updatedAt: NOW - 1000 }), s('b', { updatedAt: NOW - 3000 })],
    new Set(),
    noTitles,
    undefined,
    NOW,
    { pinned: ['b', 'a'] },
  )
  assert.deepEqual(tree[0].sessions.map((n) => n.sessionId), ['b', 'a'])
})

test('pinned group stays fixed even under title sort (absolute priority beats sort key)', () => {
  const tree = buildSessionTree(
    [ws('w1', ['a', 'b', 'c', 'd'])],
    [
      s('a', { title: 'zebra' }),
      s('b', { title: 'apple' }),
      s('c', { title: 'mango' }),
      s('d', { title: 'banana' }),
    ],
    new Set(),
    (x) => x.title ?? null,
    undefined,
    NOW,
    { sort: 'title', pinned: ['c', 'a'] },
  )
  // 置顶组 ['c','a'] 按数组顺序（忽略 title）；非置顶 b/d 按 title 升序排在其后。
  assert.deepEqual(tree[0].sessions.map((n) => n.sessionId), ['c', 'a', 'b', 'd'])
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

test('pendingInteractions flag matching nodes only, absent without the option', () => {
  const withPending = buildSessionTree(
    [ws('w1', ['a', 'b'])],
    [s('a'), s('b')],
    new Set(),
    noTitles,
    undefined,
    NOW,
    { pendingInteractions: new Map([['b', 'approval']]) },
  )
  assert.equal(withPending[0].sessions[0].pendingInteraction, undefined)
  assert.equal(withPending[0].sessions[1].pendingInteraction, 'approval')

  const without = buildSessionTree([ws('w1', ['a'])], [s('a')], new Set(), noTitles, undefined, NOW)
  assert.equal(without[0].sessions[0].pendingInteraction, undefined)
})

test('hasCompletedTurn derives from the sessionStats turns count (absent = false)', () => {
  const tree = buildSessionTree(
    [ws('w1', ['done', 'nodone', 'fresh'])],
    [
      s('done', { sessionStatsTurns: 3 }),
      s('nodone', { sessionStatsTurns: 0 }),
      s('fresh'), // absent projection → no completed turn
    ],
    new Set(),
    noTitles,
    undefined,
    NOW,
  )
  assert.equal(tree[0].sessions.find((n) => n.sessionId === 'done')?.hasCompletedTurn, true)
  assert.equal(tree[0].sessions.find((n) => n.sessionId === 'nodone')?.hasCompletedTurn, false)
  assert.equal(tree[0].sessions.find((n) => n.sessionId === 'fresh')?.hasCompletedTurn, false)
})

test('lineage children never appear as rows; a running one flags the parent descendantRunning', () => {
  const tree = buildSessionTree(
    [ws('w1', ['parent'])],
    [s('parent'), s('child', { running: true, parentSessionId: 'parent', origin: 'subagent' })],
    new Set(),
    noTitles,
    undefined,
    NOW,
  )
  // 真子代理行不进 workspace 组，也不进「未分组」组（该组仍存在但为空）。
  assert.deepEqual(tree.map((n) => n.workspaceId), ['w1', UNGROUPED_WORKSPACE_ID])
  assert.deepEqual(tree[0].sessions.map((n) => n.sessionId), ['parent'])
  assert.deepEqual(tree[1].sessions, [])
  assert.equal(tree[0].sessions[0].running, false)
  assert.equal(tree[0].sessions[0].descendantRunning, true)
})

test('descendantRunning is transitive and clears when all descendants are idle', () => {
  const tree = buildSessionTree(
    [ws('w1', ['p1', 'p2'])],
    [
      s('p1'),
      s('p2'),
      s('child', { parentSessionId: 'p1', origin: 'subagent' }),
      s('grandchild', { running: true, parentSessionId: 'child', origin: 'subagent' }),
      s('idle-child', { parentSessionId: 'p2', origin: 'subagent' }),
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

test('a plain fork (parentSessionId, no origin) appears as a row and does not busy-flag its parent', () => {
  const tree = buildSessionTree(
    [ws('w1', ['parent', 'fork'])],
    [s('parent'), s('fork', { running: true, parentSessionId: 'parent' })],
    new Set(),
    noTitles,
    undefined,
    NOW,
  )
  // fork 是普通会话行，出现在 workspace 组；父会话不被它标 descendantRunning。
  assert.deepEqual(tree[0].sessions.map((n) => n.sessionId), ['parent', 'fork'])
  assert.equal(tree[0].sessions.find((n) => n.sessionId === 'parent')?.descendantRunning, false)
  assert.equal(tree[0].sessions.find((n) => n.sessionId === 'fork')?.running, true)
})

test('a plain fork not referenced by any workspace lands in「未分组」', () => {
  const tree = buildSessionTree(
    [ws('w1', ['parent'])],
    [s('parent'), s('fork', { parentSessionId: 'parent', updatedAt: NOW - 1000 })],
    new Set(),
    noTitles,
    undefined,
    NOW,
  )
  assert.deepEqual(tree.map((n) => n.workspaceId), ['w1', UNGROUPED_WORKSPACE_ID])
  assert.deepEqual(tree[1].sessions.map((n) => n.sessionId), ['fork'])
})

test('buildSubagentTree excludes a plain fork and only counts real subagents', () => {
  const tree = buildSubagentTree(
    [
      s('root', { title: 'Root' }),
      s('fork', { parentSessionId: 'root', title: 'Fork 会话', updatedAt: NOW - 1000 }),
      s('sub', { parentSessionId: 'root', title: '子代理', origin: 'subagent' }),
    ],
    'root',
  )
  // 只有真子代理入树；普通 fork 不计入顶层项（chip 计数与下拉行）。
  assert.deepEqual(tree.map((n) => n.sessionId), ['sub'])

  // 全部为 fork（无真子代理）时返回空，chip 不渲染。
  const onlyFork = buildSubagentTree(
    [s('root', { title: 'Root' }), s('fork', { parentSessionId: 'root', title: 'Fork' })],
    'root',
  )
  assert.deepEqual(onlyFork, [])
})

test('formatRelativeTime covers every tier', () => {
  assert.equal(formatRelativeTime(NOW - 500, NOW), 'just now')
  assert.equal(formatRelativeTime(NOW - 59_000, NOW), 'just now')
  assert.equal(formatRelativeTime(NOW - 60_000, NOW), '1 minutes ago')
  assert.equal(formatRelativeTime(NOW - 45 * 60_000, NOW), '45 minutes ago')
  assert.equal(formatRelativeTime(NOW - 3_600_000, NOW), '1 hours ago')
  assert.equal(formatRelativeTime(NOW - 23 * 3_600_000, NOW), '23 hours ago')
  assert.equal(formatRelativeTime(NOW - 86_400_000, NOW), '1 days ago')
  assert.equal(formatRelativeTime(NOW - 30 * 86_400_000, NOW), '30 days ago')
  // Clock skew (updatedAt in the future) clamps to "刚刚".
  assert.equal(formatRelativeTime(NOW + 60_000, NOW), 'just now')
})

test('buildSubagentTree nests lineage children under their parent, top-level is direct children', () => {
  const tree = buildSubagentTree(
    [
      s('root', { title: 'Root' }),
      s('c1', { parentSessionId: 'root', running: true, title: 'Child 1', origin: 'subagent' }),
      s('c2', { parentSessionId: 'root', title: 'Child 2', origin: 'subagent' }),
      s('gc1', { parentSessionId: 'c1', title: 'Grandchild 1', origin: 'subagent' }),
      s('gc2', { parentSessionId: 'c1', running: true, title: 'Grandchild 2', origin: 'subagent' }),
    ],
    'root',
  )
  // 顶层仍是 root 的直接子代理（c1、c2），孙一辈挂进 c1.children，不进顶层。
  assert.deepEqual(tree.map((n) => n.sessionId), ['c1', 'c2'])
  // 运行中优先排序：c1 running 在前，c2 在后（都已按 updatedAt 相同）。
  assert.equal(tree[0].sessionId, 'c1')
  // c1 的 children 是孙一辈（gc1、gc2）。
  assert.deepEqual(tree[0].children?.map((n) => n.sessionId), ['gc2', 'gc1'])
  // gc2 running 排前，gc1 在后；gc2 标 running。
  assert.equal(tree[0].children?.[0].sessionId, 'gc2')
  assert.equal(tree[0].children?.[0].running, true)
  // c2 无后代，children 缺省。
  assert.equal(tree[1].children, undefined)
})

test('buildSubagentTree orders each layer running-first then newest-first', () => {
  const tree = buildSubagentTree(
    [
      s('root', { title: 'Root' }),
      s('idle-old', { parentSessionId: 'root', title: 'Idle Old', updatedAt: NOW - 10_000, origin: 'subagent' }),
      s('run-new', { parentSessionId: 'root', running: true, title: 'Run New', updatedAt: NOW, origin: 'subagent' }),
      s('idle-new', { parentSessionId: 'root', title: 'Idle New', updatedAt: NOW, origin: 'subagent' }),
    ],
    'root',
  )
  // 运行中优先：run-new 最前；剩余 idle 按 updatedAt 新近优先：idle-new 在 idle-old 前。
  assert.deepEqual(tree.map((n) => n.sessionId), ['run-new', 'idle-new', 'idle-old'])
})

test('buildSubagentTree breaks lineage cycles via the seen set', () => {
  // 人为构造环：c1 的 parent 是 root、c2 的 parent 是 c1、root 又成为 c2 的子代理
  // （sessionId 回指 root），构成 root→c1→c2→root 环。seen 集应截断，
  // 不无限递归、不把已在 seen 的祖先塞回后代 children。
  const tree = buildSubagentTree(
    [
      s('root', { title: 'Root' }),
      s('c1', { parentSessionId: 'root', title: 'C1', origin: 'subagent' }),
      s('c2', { parentSessionId: 'c1', title: 'C2', origin: 'subagent' }),
      s('root', { parentSessionId: 'c2', title: 'Root back', origin: 'subagent' }),
    ],
    'root',
  )
  assert.deepEqual(tree.map((n) => n.sessionId), ['c1'])
  assert.deepEqual(tree[0].children?.map((n) => n.sessionId), ['c2'])
  // c2 的子代理是 root（已在 seen），被过滤掉，不生成回指。
  assert.equal(tree[0].children?.[0].children, undefined)
})

test('buildSubagentTree falls back to a short id title when title is null', () => {
  const tree = buildSubagentTree(
    [s('root', { title: 'Root' }), s('abcdef12', { parentSessionId: 'root', title: null, origin: 'subagent' })],
    'root',
  )
  assert.equal(tree[0].title, 'Session abcdef12')
})

test('buildSubagentTree: labelOf wins, then falls back to title, then short id', () => {
  // label 优先：目录里有该子代理且带 descriptor label → 用 label（不再是异步 title）。
  const withLabel = buildSubagentTree(
    [s('root'), s('sub1', { parentSessionId: 'root', title: '自动标题', origin: 'subagent' })],
    'root',
    () => '开发 sidebar 树改造',
  )
  assert.equal(withLabel[0].title, '开发 sidebar 树改造')

  // label 缺失（目录里没有该子代理 / 没拉到）→ 回退既有 title 逻辑。
  const noEntryHasTitle = buildSubagentTree(
    [s('root'), s('sub2', { parentSessionId: 'root', title: '异步标题', origin: 'subagent' })],
    'root',
    () => null,
  )
  assert.equal(noEntryHasTitle[0].title, '异步标题')

  // 均缺失（无目录 label、也无 title）→ 回退「会话 xxxxxxxx」。
  const noEntryNoTitle = buildSubagentTree(
    [s('root'), s('sub3aaaa', { parentSessionId: 'root', title: null, origin: 'subagent' })],
    'root',
    () => null,
  )
  assert.equal(noEntryNoTitle[0].title, 'Session sub3aaaa')

  // labelOf 缺省（完全不接目录）也不降级。
  const noResolver = buildSubagentTree(
    [s('root'), s('sub4bbbb', { parentSessionId: 'root', title: null, origin: 'subagent' })],
    'root',
  )
  assert.equal(noResolver[0].title, 'Session sub4bbbb')
})

test('buildSubagentTree labelOf resolves per-node within a nested lineage', () => {
  const sessions = [
    s('root'),
    s('c1', { parentSessionId: 'root', origin: 'subagent' }),
    s('gc1', { parentSessionId: 'c1', origin: 'subagent' }),
  ]
  const labels = new Map([
    ['c1', '顶层子代理'],
    ['gc1', '孙代理'],
  ])
  const tree = buildSubagentTree(sessions, 'root', (x) => labels.get(x.sessionId) ?? null)
  assert.equal(tree[0].title, '顶层子代理')
  assert.equal(tree[0].children?.[0].title, '孙代理')
})

test('subagentCatalogRoots yields every parent that has a subagent child, rooted at rootId', () => {
  const line = (parent: string, child: string) => s(child, { parentSessionId: parent, origin: 'subagent' })
  const sessions = [
    s('root'),
    line('root', 'c1'),
    line('root', 'c2'),
    line('c1', 'gc1'),
    // c2 是叶子，不需要自己的目录；gc1 是叶子，也不需要。
    s('c2', { parentSessionId: 'root', origin: 'subagent' }),
  ]
  // root 与 c1 有子代理子节点 → 需要拉目录；c2/gc1 是叶子 → 不需。
  const roots = subagentCatalogRoots(sessions, 'root')
  assert.deepEqual([...roots].sort(), ['c1', 'root'])

  // root 没有子代理子节点时，一个目录都不用拉（不会空拉）。
  const empty = subagentCatalogRoots([s('root')], 'root')
  assert.equal(empty.size, 0)
})

test('subagentTreeSignature changes on membership change, stable otherwise', () => {
  const line = (parent: string, child: string) => s(child, { parentSessionId: parent, origin: 'subagent' })
  const a = [s('root'), line('root', 'c1')]
  const b = [s('root'), line('root', 'c1'), line('root', 'c2')]
  assert.notEqual(subagentTreeSignature(a, 'root'), subagentTreeSignature(b, 'root'))

  // 同构（相同的父子序列）签名稳定；换 root 会变。
  const a2 = [s('root'), line('root', 'c1')]
  assert.equal(subagentTreeSignature(a, 'root'), subagentTreeSignature(a2, 'root'))
  assert.notEqual(subagentTreeSignature(a, 'root'), subagentTreeSignature(a, 'other-root'))
})

test('subagentTreeSignature: a leaf becoming a parent changes the signature', () => {
  const line = (parent: string, child: string) => s(child, { parentSessionId: parent, origin: 'subagent' })
  const leaf = [s('root'), line('root', 'c1')]
  const parent = [s('root'), line('root', 'c1'), line('c1', 'gc1')]
  assert.notEqual(subagentTreeSignature(leaf, 'root'), subagentTreeSignature(parent, 'root'))
})
