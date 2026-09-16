import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  currentWorkspaceFirst,
  UNGROUPED_KEY,
  deriveFlat,
  deriveGroups,
  indexSubagentDescendants,
  owningGroupKey,
  sessionStatuses,
  sessionVisible,
  showsStatusDot,
  workspaceActivityCounts,
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
// #103 本地回收站：移进去的会话不进树（但 dsh 侧仍在，可还原）
// ---------------------------------------------------------------------------

test('sessionVisible：本地回收站集合里的会话不进树（第四参缺省时官方判据原样）', () => {
  assert.equal(sessionVisible(summary('a'), undefined, new Set(), new Set(['a'])), false)
  assert.equal(sessionVisible(summary('b'), undefined, new Set(), new Set(['a'])), true)
  assert.equal(sessionVisible(summary('a'), undefined, new Set()), true, '不传回收站集合 = 没有本地挪走任何东西')
})

test('deriveGroups / deriveFlat：移进回收站的会话从分组、计数与单列表里都消失', () => {
  const ws = [workspace('w1', ['a', 'b'])]
  const sessions = list([summary('a'), summary('b')])
  const recycled = new Set(['a'])
  const grouped = deriveGroups(sessions, ws, [], noPending, { expandedGroups: ['w1'], recycled })
  assert.equal(grouped[0]?.sessionCount, 1)
  assert.deepEqual(grouped[0]?.sessions.map((s) => s.id), ['b'])
  assert.deepEqual(deriveFlat(sessions, [], noPending, recycled).map((s) => s.id), ['b'])
  assert.deepEqual(deriveFlat(sessions, [], noPending).map((s) => s.id), ['a', 'b'], '不传回收站集合时两条都在')
})

test('workspaceActivityCounts：回收站里的会话不被数进行尾计数（计数与看得见的行同源）', () => {
  const ws = [workspace('w1', ['a', 'b'])]
  const sessions = list([summary('a', { running: true }), summary('b')])
  const counts = workspaceActivityCounts(sessions, ws, [], noPending, new Set(['a']))
  assert.equal(counts.get('w1'), undefined, '唯一在跑的那条被挪走了 → 该工作区没有角标')
  assert.equal(workspaceActivityCounts(sessions, ws, [], noPending).get('w1')?.running, 1)
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

// #102 手动未读（我们的扩展）：空闲档借官方 done 绿点，标签是「未读」；在跑/在等
// 用户时让位给那两类状态（它们更该先说）。
test('sessionStatuses + unread：空闲档的未读落到 done 档、标签是「未读」', () => {
  assert.deepEqual(sessionStatuses({ running: false, runningSubagentCount: 0, completed: false, unread: true }), [
    { state: 'done', labelKey: 'status.unread' },
  ])
  // 完成提醒优先于手动未读（两者共用同一颗绿点，官方那条先报）。
  assert.deepEqual(sessionStatuses({ running: false, runningSubagentCount: 0, completed: true, unread: true }), [
    { state: 'done', labelKey: 'status.completed' },
  ])
  // 运行中 / 等用户时未读不覆盖主状态。
  assert.deepEqual(sessionStatuses({ running: true, runningSubagentCount: 0, completed: false, unread: true })[0], {
    state: 'ongoing',
    labelKey: 'status.running',
  })
  assert.deepEqual(
    sessionStatuses({ running: false, runningSubagentCount: 0, completed: false, unread: true, pendingInteraction: 'approval' })[0],
    { state: 'warning', labelKey: 'status.waitingApproval' },
  )
})

test('showsStatusDot：手动未读要与 completed 一起并进第二参，否则空闲档那颗绿点不渲染', () => {
  const unreadIdle = sessionStatuses({ running: false, runningSubagentCount: 0, completed: false, unread: true })
  assert.equal(showsStatusDot(unreadIdle, true), true)
  assert.equal(showsStatusDot(unreadIdle, false), false)
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

/* ------------------------------------------------------------------ *
 * #109 E7：当前工作区那一组排最前
 * ------------------------------------------------------------------ */

/** 造一个够 `currentWorkspaceFirst` 用的分组（只带它读的两个字段）。 */
function groupLike(key: string, containsCurrent: boolean, ungrouped = false): { key: string; containsCurrent: boolean; workspaceId?: string } {
  return ungrouped ? { key, containsCurrent } : { key, containsCurrent, workspaceId: key }
}

test('currentWorkspaceFirst：当前工作区那组排最前，其余保持官方顺序', () => {
  const groups = [groupLike('a', false), groupLike('b', true), groupLike('c', false)]
  assert.deepEqual(currentWorkspaceFirst(groups).map((g) => g.key), ['b', 'a', 'c'])
})

test('currentWorkspaceFirst：没有当前工作区时顺序原样（返回新数组，不改入参）', () => {
  const groups = [groupLike('a', false), groupLike('b', false)]
  const ordered = currentWorkspaceFirst(groups)
  assert.deepEqual(ordered.map((g) => g.key), ['a', 'b'])
  assert.notEqual(ordered, groups)
})

test('currentWorkspaceFirst：未分组桶装着当前会话也不前移（它没有工作区身份，恒在最后）', () => {
  const groups = [groupLike('a', false), groupLike('', true, true)]
  assert.deepEqual(currentWorkspaceFirst(groups).map((g) => g.key), ['a', ''])
})
