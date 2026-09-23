import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  currentWorkspaceFirst,
  UNGROUPED_KEY,
  deriveArchived,
  deriveFlat,
  deriveGroups,
  indexSubagentDescendants,
  owningGroupKey,
  sameWorkspacePath,
  sessionStatuses,
  sessionVisible,
  showsStatusDot,
  withCompletedIds,
  withCurrentSession,
  withoutPanelOpenCompleted,
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

test('deriveGroups：containsCurrent 只落在「当前文件夹」命中的分组上（不跟当前会话走，#112）', () => {
  const sessions = list([summary('a'), summary('b')], { current: 'b' })
  const groups = deriveGroups(sessions, [workspace('w1', ['a']), workspace('w2', ['b'])], [], noPending, {
    expandedGroups: [],
    currentFolders: ['/p/w2'],
  })
  assert.deepEqual(groups.map((g) => g.containsCurrent), [false, true])
  // 同一个当前会话（b）但当前文件夹是别的：谁都不披徽标——当前会话不参与这条判定。
  const elsewhere = deriveGroups(sessions, [workspace('w1', ['a']), workspace('w2', ['b'])], [], noPending, {
    expandedGroups: [],
    currentFolders: ['/p/w1'],
  })
  assert.deepEqual(elsewhere.map((g) => g.containsCurrent), [true, false])
  const noFolders = deriveGroups(sessions, [workspace('w1', ['a']), workspace('w2', ['b'])], [], noPending, {
    expandedGroups: [],
  })
  assert.deepEqual(noFolders.map((g) => g.containsCurrent), [false, false])
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
// #239：已归档清单（树底那一节的数据面）
// ---------------------------------------------------------------------------

test('deriveArchived：只列归档集合里的会话，按最近更新倒序（同一时刻按 id 稳定排序）', () => {
  const sessions = list([
    summary('live', { updatedAt: NOW }),
    summary('arch-old', { updatedAt: NOW - 9000 }),
    summary('arch-new', { updatedAt: NOW }),
    summary('arch-newer', { updatedAt: NOW + 5000 }),
    summary('recycled-live'),
  ])
  assert.deepEqual(
    deriveArchived(sessions, ['arch-old', 'arch-new', 'arch-newer']).map((row) => row.id),
    ['arch-newer', 'arch-new', 'arch-old'],
  )
})

test('deriveArchived：归档集合里的子代理不列；集合里有快照里不存在的 id 时跳过不占位', () => {
  const sessions = list([summary('a'), summary('sub', { origin: 'subagent', updatedAt: NOW + 1000 })])
  assert.deepEqual(
    deriveArchived(sessions, ['a', 'sub', 'gone']).map((row) => row.id),
    ['a'],
  )
})

test('deriveArchived：带上标题与时刻（空白会话标题为空串，渲染层替换成「新会话」）', () => {
  const sessions = list([
    summary('a', { displayTitle: '带标题的会话', updatedAt: NOW }),
    summary('b', { displayTitle: undefined, title: undefined, blank: true, updatedAt: NOW - 1000 }),
  ])
  assert.deepEqual(deriveArchived(sessions, ['a', 'b']), [
    { id: 'a', title: '带标题的会话', blank: false, updatedAt: NOW },
    // 空白会话的标题在纯层里就是空串（官方 sessionTitle 的口径：blank 一律给空串），
    // 渲染层才换成「新会话」。
    { id: 'b', title: '', blank: true, updatedAt: NOW - 1000 },
  ])
})

test('deriveArchived：归档集合为空 = 一条都不列（那一节整块不渲染）', () => {
  assert.deepEqual(deriveArchived(list([summary('a')]), []), [])
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

// #147：宿主面板里正开着的会话——官方那条完成提醒的武装条件（「这一页的 selected 不是
// 它」）在这一端不成立（侧栏页的 selected 与屏幕上开着的面板可以是两回事），所以把宿主
// 的这份事实并进渲染判据：集合里的会话，completed 一律按 false 渲染。
test('withoutPanelOpenCompleted：集合里的会话不再算「跑完还没被打开」', () => {
  const sessions = list([summary('a', { completed: true }), summary('b')])
  const hidden = withoutPanelOpenCompleted(sessions, new Set(['a']))
  const completed = hidden.byId['a']?.completed === true
  assert.equal(completed, false)
  // 判据的落点：这一条给 `showsStatusDot` 的第二参（`node.completed || unread`）从此是
  // false，空闲档那颗绿点不渲染——与官方「跑完还没被打开」的口径一致。
  const statuses = sessionStatuses({ running: false, runningSubagentCount: 0, completed })
  assert.equal(showsStatusDot(statuses, completed), false)
  assert.equal(hidden.byId['b']?.completed, undefined, '没开的会话一个字节不动')
})

test('withoutPanelOpenCompleted：集合外的会话照旧（只有真在提醒的那条被压住）', () => {
  const sessions = list([summary('a', { completed: true }), summary('b', { completed: true })])
  const hidden = withoutPanelOpenCompleted(sessions, new Set(['b']))
  assert.equal(hidden.byId['a']?.completed, true)
  assert.equal(hidden.byId['b']?.completed, false)
})

test('withoutPanelOpenCompleted：空集原样返回同一份 list（官方 web 侧 = 这条通道不存在）', () => {
  const sessions = list([summary('a', { completed: true })])
  assert.equal(withoutPanelOpenCompleted(sessions, new Set()), sessions)
  assert.equal(withoutPanelOpenCompleted(sessions, new Set(['b'])), sessions, '集合里没有一条在提醒时同样不重算')
})

test('withoutPanelOpenCompleted：不动别的字段，也不动 ids / current', () => {
  const sessions = list([summary('a', { completed: true, running: true, blank: true })], { current: 'a' })
  const hidden = withoutPanelOpenCompleted(sessions, new Set(['a']))
  assert.deepEqual(hidden.ids, ['a'])
  assert.equal(hidden.current, 'a')
  assert.equal(hidden.byId['a']?.running, true)
  assert.equal(hidden.byId['a']?.blank, true)
  assert.equal(hidden.byId['a']?.title, sessions.byId['a']?.title)
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

/* ------------------------------------------------------------------ *
 * #112：当前工作区 = VS Code 当前打开的文件夹（不是当前会话）
 * ------------------------------------------------------------------ */

test('sameWorkspacePath：分隔符与尾斜杠不算差异，Windows 形态的路径另不算大小写', () => {
  assert.equal(sameWorkspacePath('/p/w1', '/p/w1'), true)
  assert.equal(sameWorkspacePath('/p/w1/', '/p/w1'), true)
  assert.equal(sameWorkspacePath('/p/w1', '/p/w2'), false)
  // Windows：VS Code 的 fsPath 是小写盘符 + 反斜杠，dsh 侧注册路径未必同一写法。
  assert.equal(sameWorkspacePath('c:\\Work\\Demo', 'C:/Work/Demo'), true)
  assert.equal(sameWorkspacePath('\\\\srv\\share\\demo', '//srv/share/demo'), true)
  // 非 Windows 形态：大小写是差异（旧侧栏在 macOS/Linux 上就是严格比较）。
  assert.equal(sameWorkspacePath('/p/Demo', '/p/demo'), false)
})

test('#112：文件夹命中 → 那一组 containsCurrent（徽标的来源），其余不变', () => {
  const sessions = list([summary('a'), summary('b')])
  const workspaces = [workspace('w1', ['a']), workspace('w2', ['b'])]
  const groups = deriveGroups(sessions, workspaces, [], noPending, {
    expandedGroups: [],
    currentFolders: ['/p/w2'],
  })
  assert.deepEqual(groups.map((g) => [g.key, g.containsCurrent]), [
    ['w1', false],
    ['w2', true],
  ])
  assert.deepEqual(currentWorkspaceFirst(groups).map((g) => g.key), ['w2', 'w1'])
})

test('#112：切换当前会话不改变 containsCurrent，也不改变工作区顺序（用户报的现象）', () => {
  const sessions = list([summary('a'), summary('b'), summary('c')])
  const workspaces = [workspace('w1', ['a']), workspace('w2', ['b']), workspace('w3', ['c'])]
  const view = { expandedGroups: [], currentFolders: ['/p/w1'] }
  const before = currentWorkspaceFirst(deriveGroups(sessions, workspaces, [], noPending, view))
  // 打开 w3 里的会话（当前会话换了）、再切到 w2 里的会话：顺序与徽标都不许动。
  for (const current of ['c', 'b', 'a']) {
    const after = currentWorkspaceFirst(
      deriveGroups({ ...sessions, current }, workspaces, [], noPending, view),
    )
    assert.deepEqual(after.map((g) => g.key), ['w1', 'w2', 'w3'], `当前会话 = ${current} 时顺序应不变`)
    assert.deepEqual(after.map((g) => g.containsCurrent), [true, false, false])
  }
  assert.deepEqual(before.map((g) => g.key), ['w1', 'w2', 'w3'])
})

test('#112：文件夹表为空（官方 web 侧 / VS Code 空窗口）→ 无徽标、不置顶', () => {
  const sessions = list([summary('a'), summary('b')], { current: 'b' })
  const workspaces = [workspace('w1', ['a']), workspace('w2', ['b'])]
  for (const view of [{ expandedGroups: [] }, { expandedGroups: [], currentFolders: [] }]) {
    const groups = deriveGroups(sessions, workspaces, [], noPending, view)
    assert.deepEqual(groups.map((g) => g.containsCurrent), [false, false])
    assert.deepEqual(currentWorkspaceFirst(groups).map((g) => g.key), ['w1', 'w2'])
  }
})

test('#112：多根——命中任一即为当前（两个都命中则两个都前移，组间顺序不变）', () => {
  const sessions = list([summary('a'), summary('b'), summary('c')])
  const workspaces = [workspace('w1', ['a']), workspace('w2', ['b']), workspace('w3', ['c'])]
  const multi = deriveGroups(sessions, workspaces, [], noPending, {
    expandedGroups: [],
    currentFolders: ['/p/w3', '/p/w2'],
  })
  assert.deepEqual(multi.map((g) => [g.key, g.containsCurrent]), [
    ['w1', false],
    ['w2', true],
    ['w3', true],
  ])
  // 前移的那两组保持官方顺序（w2 在 w3 前），没命中的留在后面原序。
  assert.deepEqual(currentWorkspaceFirst(multi).map((g) => g.key), ['w2', 'w3', 'w1'])
  const none = deriveGroups(sessions, workspaces, [], noPending, {
    expandedGroups: [],
    currentFolders: ['/p/nope'],
  })
  assert.deepEqual(none.map((g) => g.containsCurrent), [false, false, false])
  assert.deepEqual(currentWorkspaceFirst(none).map((g) => g.key), ['w1', 'w2', 'w3'])
})

test('#112：未分组桶不因当前会话落在它里面而披徽标（它没有可比的路径）', () => {
  const sessions = list([summary('a'), summary('stray')], { current: 'stray' })
  const groups = deriveGroups(sessions, [workspace('w1', ['a'])], [], noPending, {
    expandedGroups: [UNGROUPED_KEY],
  })
  assert.deepEqual(groups.map((g) => [g.key, g.containsCurrent]), [
    ['w1', false],
    [UNGROUPED_KEY, false],
  ])
  assert.deepEqual(currentWorkspaceFirst(groups).map((g) => g.key), ['w1', UNGROUPED_KEY])
})

test('#112：路径写法差异（尾斜杠 / Windows 大小写）不影响命中', () => {
  const sessions = list([summary('a'), summary('b')])
  const workspaces = [workspace('w1', ['a'], { path: '/p/w1/' }), workspace('w2', ['b'], { path: 'C:/Work/Demo' })]
  const groups = deriveGroups(sessions, workspaces, [], noPending, {
    expandedGroups: [],
    currentFolders: ['/p/w1', 'c:\\Work\\Demo'],
  })
  assert.deepEqual(groups.map((g) => g.containsCurrent), [true, true])
})

// #191：会话列表快照里的「当前会话」两代字段的单一分叉点。0.1.6-alpha.1 及以前官方直接
// 下发 `current`；alpha.2 起没了，官方自己从行上的 `retainedBy.mainView` 推。
test('withCurrentSession：老版本原样用快照里的 current（不重算、引用不动）', () => {
  const sessions = list([summary('a'), summary('b', { retainedBy: { mainView: 1 } })], { current: 'a' })
  assert.equal(withCurrentSession(sessions), sessions)
})

test('withCurrentSession：新版本按 retainedBy.mainView 推出当前会话（#191 的判据）', () => {
  const sessions = list([summary('a'), summary('b', { retainedBy: { sidebar: 1 } }), summary('c', { retainedBy: { mainView: 1 } })])
  const current = withCurrentSession(sessions)
  assert.equal(current.current, 'c', '主对话区持有（mainView > 0）的那条才算当前')
  assert.equal(current.ids, sessions.ids, '只补一个字段，别的不动')
  assert.equal(current.byId, sessions.byId)
})

test('withCurrentSession：一条都没被主对话区持有时不造字段（与官方 undefined 同义）', () => {
  const sessions = list([summary('a'), summary('b', { retainedBy: { sidebar: 2 } })])
  assert.equal(withCurrentSession(sessions).current, undefined)
  assert.equal(withCurrentSession(sessions), sessions, '没什么可补时原样返回同一份 list')
})

// #191：0.1.6-alpha.2 把「跑完还没被打开」从会话列表行挪进了官方状态表
// （`sessionStatus` 的 completionUnread），行上不再有 completed。
test('withCompletedIds：按官方状态表补绿点的 completed（新代）', () => {
  const sessions = list([summary('a'), summary('b'), summary('c', { completed: true })])
  const filled = withCompletedIds(sessions, new Set(['a']))
  assert.equal(filled.byId['a']?.completed, true, '状态表里说没读过的补上')
  assert.equal(filled.byId['b']?.completed, undefined, '不在表里的保持原样（undefined 与 false 同义）')
  assert.equal(filled.byId['c']?.completed, false, '状态表没说的要明确置 false（行里可能还留着旧值）')
})

test('withCompletedIds：老代给 null 时一个字节不动（那一代的行自带 completed）', () => {
  const sessions = list([summary('a', { completed: true }), summary('b')])
  assert.equal(withCompletedIds(sessions, null), sessions, '引用不动，也不重算')
})

test('withCompletedIds：没有一条要改时原样返回同一份 list', () => {
  const sessions = list([summary('a', { completed: true }), summary('b')])
  assert.equal(withCompletedIds(sessions, new Set(['a'])), sessions)
})
