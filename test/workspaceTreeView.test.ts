import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  UNGROUPED_KEY,
  deriveFlat,
  deriveGroups,
  indexSubagentDescendants,
  owningGroupKey,
  sessionStatuses,
  sessionVisible,
  showsStatusDot,
  type PendingInteractions,
  type SessionListLike,
  type SessionSummaryLike,
  type WorkspaceViewLike,
} from '../src/pure/workspaceTreeView.ts'

const NOW = 1_700_000_000_000

const summary = (id: string, over: Partial<SessionSummaryLike> = {}): SessionSummaryLike => ({
  id,
  displayTitle: `会话 ${id}`,
  running: false,
  blank: false,
  updatedAt: NOW,
  ...over,
})

const list = (
  items: readonly SessionSummaryLike[],
  over: Partial<SessionListLike> = {},
): SessionListLike => ({
  ids: items.map((s) => s.id),
  byId: Object.fromEntries(items.map((s) => [s.id, s])),
  ...over,
})

const workspace = (id: string, sessionIds: readonly string[], over: Partial<WorkspaceViewLike> = {}): WorkspaceViewLike => ({
  workspaceId: id,
  path: `/p/${id}`,
  title: id,
  sessionIds,
  createdAt: new Date(NOW).toISOString(),
  ...over,
})

const noPending: PendingInteractions = new Map()

// ---------------------------------------------------------------------------
// 可见性
// ---------------------------------------------------------------------------

test('sessionVisible：子代理来源、已归档都不进树；空白会话只在它就是当前选中时进树', () => {
  assert.equal(sessionVisible(summary('a'), undefined, new Set()), true)
  assert.equal(sessionVisible(summary('a', { origin: 'subagent' }), undefined, new Set()), false)
  assert.equal(sessionVisible(summary('a'), undefined, new Set(['a'])), false)
  assert.equal(sessionVisible(summary('a', { blank: true }), undefined, new Set()), false)
  assert.equal(sessionVisible(summary('a', { blank: true }), 'a', new Set()), true)
})

test('owningGroupKey：被工作区记账的会话归该工作区，其余落未分组', () => {
  const workspaces = [workspace('w1', ['a']), workspace('w2', ['b'])]
  assert.equal(owningGroupKey(workspaces, 'b'), 'w2')
  assert.equal(owningGroupKey(workspaces, 'z'), UNGROUPED_KEY)
})

// ---------------------------------------------------------------------------
// 分组推导（对齐官方 deriveGroups）
// ---------------------------------------------------------------------------

test('deriveGroups：按工作区注册顺序出分组，成员取工作区的手动顺序', () => {
  const sessions = list([summary('a'), summary('b'), summary('c')])
  const groups = deriveGroups(sessions, [workspace('w1', ['c', 'a']), workspace('w2', ['b'])], [], noPending, {
    expandedGroups: ['w1', 'w2'],
  })
  assert.deepEqual(
    groups.map((g) => [g.key, g.sessionCount, g.sessions.map((s) => s.id)]),
    [
      ['w1', 2, ['c', 'a']],
      ['w2', 1, ['b']],
    ],
  )
})

test('deriveGroups：折叠的分组不带成员行，但仍报会话数（与官方一致）', () => {
  const sessions = list([summary('a')])
  const groups = deriveGroups(sessions, [workspace('w1', ['a'])], [], noPending, { expandedGroups: [] })
  assert.equal(groups[0].sessionCount, 1)
  assert.deepEqual(groups[0].sessions, [])
})

test('deriveGroups：未被任何工作区记账的会话进未分组桶，按最近更新倒序', () => {
  const sessions = list([summary('old', { updatedAt: NOW - 5000 }), summary('new', { updatedAt: NOW })])
  const groups = deriveGroups(sessions, [workspace('w1', [])], [], noPending, { expandedGroups: [UNGROUPED_KEY] })
  const ungrouped = groups.find((g) => g.key === UNGROUPED_KEY)
  assert.notEqual(ungrouped, undefined)
  assert.deepEqual(ungrouped?.sessions.map((s) => s.id), ['new', 'old'])
  assert.equal(ungrouped?.workspaceId, undefined)
})

test('deriveGroups：containsCurrent 只落在当前会话所属分组上', () => {
  const sessions = list([summary('a'), summary('b')], { current: 'b' })
  const groups = deriveGroups(sessions, [workspace('w1', ['a']), workspace('w2', ['b'])], [], noPending, {
    expandedGroups: [],
  })
  assert.deepEqual(groups.map((g) => g.containsCurrent), [false, true])
})

test('deriveGroups：空白会话只在它就是当前会话时出现在分组里', () => {
  const sessions = list([summary('blank', { blank: true }), summary('real')], { current: 'blank' })
  const groups = deriveGroups(sessions, [workspace('w1', ['blank', 'real'])], [], noPending, { expandedGroups: ['w1'] })
  assert.deepEqual(groups[0].sessions.map((s) => s.id), ['blank', 'real'])
  const other = deriveGroups(list([summary('blank', { blank: true }), summary('real')]), [workspace('w1', ['blank', 'real'])], [], noPending, { expandedGroups: ['w1'] })
  assert.deepEqual(other[0].sessions.map((s) => s.id), ['real'])
})

test('deriveGroups：归档会话从分组与计数里都消失', () => {
  const sessions = list([summary('a'), summary('b')])
  const groups = deriveGroups(sessions, [workspace('w1', ['a', 'b'])], ['a'], noPending, { expandedGroups: ['w1'] })
  assert.equal(groups[0].sessionCount, 1)
  assert.deepEqual(groups[0].sessions.map((s) => s.id), ['b'])
})

test('deriveGroups：工作区记账里指向未知会话的 id 被跳过（列表还没到）', () => {
  const sessions = list([summary('a')])
  const groups = deriveGroups(sessions, [workspace('w1', ['a', 'ghost'])], [], noPending, { expandedGroups: ['w1'] })
  assert.deepEqual(groups[0].sessions.map((s) => s.id), ['a'])
})

// 零工作区、零可见会话：树走空态分支（组件按 groups.length === 0 渲染「暂无会话」，
// 正是「无工作区」那一档），不抛也不凭空造分组——#85 追加项去掉顶部「新会话」胶囊后，
// 这条路径仍由它自己兜（胶囊在树外面，没参与这条路）。
test('deriveGroups：零工作区且零会话时出空分组表（树走空态分支，不抛）', () => {
  assert.deepEqual(deriveGroups(list([]), [], [], noPending, { expandedGroups: [] }), [])
  // 一个工作区都没有、但有会话时，会话全部落「未分组」：树不上空态，仍出分组树。
  const stray = deriveGroups(list([summary('a')]), [], [], noPending, { expandedGroups: [UNGROUPED_KEY] })
  assert.deepEqual(stray.map((g) => g.key), [UNGROUPED_KEY])
})

// ---------------------------------------------------------------------------
// 平铺推导（对齐官方 deriveFlat）
// ---------------------------------------------------------------------------

test('deriveFlat：所有可见会话按最近更新倒序，同一时刻按 id 稳定排序', () => {
  const sessions = list([
    summary('b', { updatedAt: NOW }),
    summary('a', { updatedAt: NOW }),
    summary('old', { updatedAt: NOW - 9000 }),
  ])
  assert.deepEqual(
    deriveFlat(sessions, [], noPending).map((s) => s.id),
    ['a', 'b', 'old'],
  )
})

test('deriveFlat：归档与子代理会话都不出现', () => {
  const sessions = list([summary('a'), summary('sub', { origin: 'subagent' }), summary('arch')])
  assert.deepEqual(
    deriveFlat(sessions, ['arch'], noPending).map((s) => s.id),
    ['a'],
  )
})

// ---------------------------------------------------------------------------
// 状态点（对齐官方 sessionStatuses）
// ---------------------------------------------------------------------------

test('sessionStatuses：等待用户优先于一切，warning 档', () => {
  const statuses = sessionStatuses({
    running: true,
    runningSubagentCount: 3,
    completed: false,
    pendingInteraction: 'approval',
  })
  assert.deepEqual(statuses[0], { state: 'warning', labelKey: 'status.waitingApproval' })
  assert.deepEqual(statuses[1], { state: 'ongoing', labelKey: 'status.subagentsRunning.other', labelCount: 3 })
})

test('sessionStatuses：三种等待态各自的文案', () => {
  const kind = (pendingInteraction: string): string =>
    sessionStatuses({ running: false, runningSubagentCount: 0, completed: false, pendingInteraction })[0].labelKey
  assert.equal(kind('plan-review'), 'status.planReview')
  assert.equal(kind('question'), 'status.waitingAnswer')
})

test('sessionStatuses：未知等待态被忽略，退回自生活动判定', () => {
  const statuses = sessionStatuses({
    running: false,
    runningSubagentCount: 0,
    completed: false,
    pendingInteraction: 'something-else',
  })
  assert.deepEqual(statuses, [{ state: 'done', labelKey: 'status.idle' }])
})

test('sessionStatuses：运行中 → ongoing；子代理数用单数/复数两条文案', () => {
  assert.deepEqual(sessionStatuses({ running: true, runningSubagentCount: 0, completed: false }), [
    { state: 'ongoing', labelKey: 'status.running' },
  ])
  assert.deepEqual(sessionStatuses({ running: false, runningSubagentCount: 1, completed: false }), [
    { state: 'ongoing', labelKey: 'status.subagentsRunning.one', labelCount: 1 },
  ])
})

test('sessionStatuses：完成提醒与空闲都落到 done 档，文案不同', () => {
  assert.deepEqual(sessionStatuses({ running: false, runningSubagentCount: 0, completed: true }), [
    { state: 'done', labelKey: 'status.completed' },
  ])
  assert.deepEqual(sessionStatuses({ running: false, runningSubagentCount: 0, completed: false }), [
    { state: 'done', labelKey: 'status.idle' },
  ])
})

test('showsStatusDot：done 档且没有完成提醒时不画点（官方只在非 done 或 completed 时画）', () => {
  const idle = sessionStatuses({ running: false, runningSubagentCount: 0, completed: false })
  const done = sessionStatuses({ running: false, runningSubagentCount: 0, completed: true })
  const running = sessionStatuses({ running: true, runningSubagentCount: 0, completed: false })
  assert.equal(showsStatusDot(idle, false), false)
  assert.equal(showsStatusDot(done, true), true)
  assert.equal(showsStatusDot(running, false), true)
})

// ---------------------------------------------------------------------------
// 子代理后代计数（对齐官方 indexSubagentDescendants）
// ---------------------------------------------------------------------------

test('indexSubagentDescendants：连续子代理血缘逐级记到每个祖先下', () => {
  const byId: Record<string, SessionSummaryLike> = {
    root: summary('root'),
    child: summary('child', { origin: 'subagent', parentId: 'root', running: true }),
    grand: summary('grand', { origin: 'subagent', parentId: 'child', running: false }),
  }
  const indexed = indexSubagentDescendants(byId)
  assert.deepEqual(indexed.get('root'), { count: 2, runningCount: 1 })
  assert.deepEqual(indexed.get('child'), { count: 1, runningCount: 0 })
})

test('indexSubagentDescendants：非子代理来源的会话不计数', () => {
  const indexed = indexSubagentDescendants({ a: summary('a'), b: summary('b', { parentId: 'a' }) })
  assert.equal(indexed.size, 0)
})

test('indexSubagentDescendants：血缘成环时不死循环', () => {
  const byId: Record<string, SessionSummaryLike> = {
    x: summary('x', { origin: 'subagent', parentId: 'y' }),
    y: summary('y', { origin: 'subagent', parentId: 'x' }),
  }
  const indexed = indexSubagentDescendants(byId)
  assert.equal(indexed.size, 2)
})

test('deriveGroups：命中子代理后代计数的会话状态带子代理文案', () => {
  const sessions = list([
    summary('root', { running: true }),
    summary('child', { origin: 'subagent', parentId: 'root', running: true }),
  ])
  const groups = deriveGroups(sessions, [workspace('w1', ['root'])], [], noPending, { expandedGroups: ['w1'] })
  const root = groups[0].sessions[0]
  assert.equal(root.runningSubagentCount, 1)
  assert.deepEqual(
    sessionStatuses(root).map((s) => s.labelKey),
    ['status.running', 'status.subagentsRunning.one'],
  )
})
