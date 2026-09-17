/**
 * #81 六项功能里属于纯推导/纯状态的部分：#82 的分组状态（宿主能力口读写的那份）、
 * 视图态（官方 localStorage 惯例）、工作区活状态计数、回收站抽屉数据、分组过滤。
 *
 * 这些断言的意义：把「数字怎么来的」「过滤留下谁」「旧文件读出来是什么」钉在
 * 单元测试里，浏览器验证只负责证明界面把它们显示对了。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  UNGROUPED_KEY,
  deriveGroups,
  deriveRecycleGroups,
  recycleCount,
  visibleRecycleIds,
  workspaceActivityCounts,
  type PendingInteractions,
  type SessionListLike,
  type SessionSummaryLike,
  type WorkspaceViewLike,
} from '../src/pure/workspaceTreeView.ts'
import {
  createTreeGroup,
  deleteTreeGroup,
  emptyTreeGroups,
  hasTreeGroup,
  parseTreeGroups,
  renameTreeGroup,
  serializeTreeGroups,
  toggleWorkspaceGroup,
  workspaceGroupIds,
  workspaceMatchesGroup,
} from '../src/pure/treeGroups.ts'
import {
  TREE_VIEW_PREF_KEY,
  defaultTreeViewPrefs,
  parseTreeViewPrefs,
  readTreeViewPrefs,
  writeTreeViewPrefs,
  type StorageLike,
} from '../src/pure/workspaceTreePrefs.ts'

const NOW = 1_700_000_000_000

const summary = (id: string, over: Partial<SessionSummaryLike> = {}): SessionSummaryLike => ({
  id,
  displayTitle: `会话 ${id}`,
  running: false,
  blank: false,
  updatedAt: NOW,
  ...over,
})

const list = (items: readonly SessionSummaryLike[], over: Partial<SessionListLike> = {}): SessionListLike => ({
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
// #82 分组状态：旧文件 → 新读写口（键名与格式都不变，所以「迁移」是零成本的）
// ---------------------------------------------------------------------------

test('parseTreeGroups：旧侧栏 groups.json 的原样值能读回（版本/字段齐全才算数）', () => {
  const legacy = {
    version: 1,
    groups: [{ id: 'g-1', name: 'dsn相关' }, { id: 'g-2', name: '其他' }],
    membership: { w1: ['g-1'], w2: ['g-1', 'g-2'] },
    activeGroupId: 'g-1',
  }
  const parsed = parseTreeGroups(legacy)
  assert.deepEqual(parsed, legacy)
  assert.equal(parsed?.groups.length, 2)
  // 旧值里的 activeGroupId 原样保留（不写坏别人的数据），但不再由本模块更新。
  assert.equal(parsed?.activeGroupId, 'g-1')
})

test('parseTreeGroups：坏值/缺字段/非对象一律给 null（调用方按空状态处理）', () => {
  assert.equal(parseTreeGroups(null), null)
  assert.equal(parseTreeGroups('groups'), null)
  assert.equal(parseTreeGroups([]), null)
  assert.equal(parseTreeGroups({ version: 2, groups: [], membership: {}, activeGroupId: null }), null)
  assert.equal(parseTreeGroups({ version: 1, groups: [], membership: {} }), null)
})

test('parseTreeGroups：脏数据被清洗（未知组归属丢弃、重名与空名丢弃）', () => {
  const parsed = parseTreeGroups({
    version: 1,
    groups: [{ id: 'g-1', name: ' A ' }, { id: 'g-1', name: 'dup' }, { id: 'g-2', name: '  ' }],
    membership: { w1: ['g-1', 'g-nope'], w2: 'not-an-array' },
    activeGroupId: 'g-nope',
  })
  assert.deepEqual(parsed?.groups, [{ id: 'g-1', name: 'A' }])
  assert.deepEqual(parsed?.membership, { w1: ['g-1'] })
  assert.equal(parsed?.activeGroupId, null)
})

test('分组增删改：建组/重命名/删组（含归属清理）都返回新状态，无变化给 null', () => {
  const empty = emptyTreeGroups()
  const created = createTreeGroup(empty, '工作', 'g-1')
  assert.equal(created.ok, true)
  if (!created.ok) return
  assert.deepEqual(created.file.groups, [{ id: 'g-1', name: '工作' }])
  // 空名/重名被拒
  assert.deepEqual(createTreeGroup(created.file, '   ', 'g-2'), { ok: false, error: 'empty' })
  assert.deepEqual(createTreeGroup(created.file, '工作', 'g-2'), { ok: false, error: 'duplicate' })

  const renamed = renameTreeGroup(created.file, 'g-1', '工作区')
  assert.deepEqual(renamed?.groups, [{ id: 'g-1', name: '工作区' }])
  assert.equal(renameTreeGroup(created.file, 'g-1', '工作'), null, '名字没变 = 无变化')
  assert.equal(renameTreeGroup(created.file, 'g-nope', 'x'), null, '未知组 = 无变化')

  const removed = deleteTreeGroup(created.file, 'g-1')
  assert.deepEqual(removed?.groups, [])
  assert.equal(deleteTreeGroup(created.file, 'g-nope'), null)
})

test('删组连带清掉归属：残留指向不存在组的归属只会变成脏数据', () => {
  const created = createTreeGroup(emptyTreeGroups(), '工作', 'g-1')
  if (!created.ok) throw new Error('unreachable')
  const assigned = toggleWorkspaceGroup(created.file, 'w1', 'g-1')
  assert.deepEqual(assigned?.membership, { w1: ['g-1'] })
  const removed = deleteTreeGroup(assigned as NonNullable<typeof assigned>, 'g-1')
  assert.deepEqual(removed?.membership, {})
  assert.deepEqual(removed?.groups, [])
})

test('工作区归属开关：加/移出/未知组，以及「已经在该组再点一次 = 移出」', () => {
  const created = createTreeGroup(emptyTreeGroups(), '工作', 'g-1')
  if (!created.ok) throw new Error('unreachable')
  const on = toggleWorkspaceGroup(created.file, 'w1', 'g-1')
  assert.deepEqual(workspaceGroupIds(on as NonNullable<typeof on>, 'w1'), ['g-1'])
  const off = toggleWorkspaceGroup(on as NonNullable<typeof on>, 'w1', 'g-1')
  assert.deepEqual(off?.membership, {})
  assert.equal(toggleWorkspaceGroup(created.file, 'w1', 'g-nope'), null, '未知组不落盘')
})

test('落盘文本与旧格式逐字同形（两端/旧版本读得回去）', () => {
  const created = createTreeGroup(emptyTreeGroups(), '工作', 'g-1')
  if (!created.ok) throw new Error('unreachable')
  const text = serializeTreeGroups(created.file)
  assert.equal(text, '{"version":1,"groups":[{"id":"g-1","name":"工作"}],"membership":{},"activeGroupId":null}')
  assert.deepEqual(parseTreeGroups(JSON.parse(text)), created.file, '写出去再读回来是同一个状态（幂等）')
})

test('过滤判定：activeGroupId=null 看全部；选中分组只看归属它的工作区；散会话桶不参与', () => {
  const created = createTreeGroup(emptyTreeGroups(), '工作', 'g-1')
  if (!created.ok) throw new Error('unreachable')
  const file = toggleWorkspaceGroup(created.file, 'w1', 'g-1') as NonNullable<ReturnType<typeof toggleWorkspaceGroup>>
  assert.equal(workspaceMatchesGroup(file, 'w1', null), true)
  assert.equal(workspaceMatchesGroup(file, 'w2', null), true)
  assert.equal(workspaceMatchesGroup(file, 'w1', 'g-1'), true)
  assert.equal(workspaceMatchesGroup(file, 'w2', 'g-1'), false)
  assert.equal(hasTreeGroup(file, 'g-1'), true)
  assert.equal(hasTreeGroup(file, 'g-nope'), false)
  assert.equal(hasTreeGroup(file, null), false)
})

test('deriveGroups 接过滤：只留命中的工作区，散会话桶跟着收起', () => {
  const ws = [workspace('w1', ['a']), workspace('w2', ['b'])]
  const sessions = list([summary('a'), summary('b'), summary('stray')])
  const all = deriveGroups(sessions, ws, [], noPending, { expandedGroups: ['w1', 'w2', UNGROUPED_KEY] })
  assert.deepEqual(all.map((g) => g.key), ['w1', 'w2', UNGROUPED_KEY])
  const filtered = deriveGroups(sessions, ws, [], noPending, {
    expandedGroups: ['w1', 'w2', UNGROUPED_KEY],
    workspaceFilter: (id) => id === 'w1',
  })
  assert.deepEqual(filtered.map((g) => g.key), ['w1'])
})

// ---------------------------------------------------------------------------
// #81 功能 2：工作区活状态计数
// ---------------------------------------------------------------------------

test('计数：运行中与等待交互互斥（正在等用户的会话只算「等待」，不重复计入运行）', () => {
  const ws = [workspace('w1', ['run', 'wait', 'both', 'idle'])]
  const sessions = list([
    summary('run', { running: true }),
    summary('wait', { running: true }),
    summary('both', { running: true }),
    summary('idle'),
  ])
  const pending: PendingInteractions = new Map([
    ['wait', { kind: 'approval' }],
    ['both', { kind: 'question' }],
  ])
  const counts = workspaceActivityCounts(sessions, ws, [], pending)
  assert.deepEqual(counts.get('w1'), { running: 1, waiting: 2 })
})

test('计数：与树里看得见的会话同源（子代理/已归档/非当前空白会话都不计）', () => {
  const ws = [workspace('w1', ['a', 'sub', 'archived', 'blank'])]
  const sessions = list([
    summary('a', { running: true }),
    summary('sub', { running: true, origin: 'subagent' }),
    summary('archived', { running: true }),
    summary('blank', { running: true, blank: true }),
  ])
  const counts = workspaceActivityCounts(sessions, ws, ['archived'], noPending)
  assert.deepEqual(counts.get('w1'), { running: 1, waiting: 0 })
  // 空白会话就是当前选中时进树 → 计数跟着进
  const withCurrent = workspaceActivityCounts({ ...sessions, current: 'blank' }, ws, ['archived'], noPending)
  assert.deepEqual(withCurrent.get('w1'), { running: 2, waiting: 0 })
})

test('计数：散会话归未分组桶，空闲工作区没有条目（不给行尾挂 0）', () => {
  const ws = [workspace('w1', ['a'])]
  const sessions = list([summary('a'), summary('stray', { running: true })])
  const counts = workspaceActivityCounts(sessions, ws, [], noPending)
  assert.equal(counts.get('w1'), undefined)
  assert.deepEqual(counts.get(UNGROUPED_KEY), { running: 1, waiting: 0 })
})

// ---------------------------------------------------------------------------
// #103 回收站（本地可逆那一层）：抽屉数据 = 我们自己的集合，块内按移入顺序倒序
// ---------------------------------------------------------------------------

test('回收站：按工作区组织、块内按移入顺序倒序（最近移入的在最上）、没内容的块不出现', () => {
  const ws = [workspace('w1', ['a1', 'a2']), workspace('w2', ['b1']), workspace('w3', ['c1'])]
  // 移入顺序：a1 → a2 → b1（越靠后 = 越晚移入，越该排在前面）
  const sessions = list([
    summary('a1', { updatedAt: NOW - 10 }),
    summary('a2', { updatedAt: NOW }),
    summary('b1'),
    summary('c1'),
  ])
  const groups = deriveRecycleGroups(sessions, ws, ['a1', 'a2', 'b1'])
  assert.deepEqual(groups.map((g) => g.key), ['w1', 'w2'], 'w3 里没有回收站会话 → 不出现')
  assert.deepEqual(groups[0]?.sessions.map((s) => s.id), ['a2', 'a1'], 'a2 比 a1 晚移入 → 排在前面')
  assert.equal(recycleCount(groups), 3)
})

test('回收站：顺序由移入顺序决定，与最近更新时间无关', () => {
  const ws = [workspace('w1', ['old', 'new'])]
  // `new` 的更新时间更新，但它更早移入——块内顺序仍按移入顺序倒序。
  const sessions = list([summary('old', { updatedAt: NOW }), summary('new', { updatedAt: NOW - 100_000 })])
  const groups = deriveRecycleGroups(sessions, ws, ['new', 'old'])
  assert.deepEqual(groups[0]?.sessions.map((s) => s.id), ['old', 'new'])
})

test('回收站：认不出的 id（会话被归档/删掉）跳过不占位；子代理不进抽屉', () => {
  const ws = [workspace('w1', ['a1'])]
  const sessions = list([summary('a1'), summary('sub', { origin: 'subagent' })])
  const groups = deriveRecycleGroups(sessions, ws, ['a1', 'gone', 'sub'])
  assert.deepEqual(groups.map((g) => g.key), ['w1'])
  assert.deepEqual(groups[0]?.sessions.map((s) => s.id), ['a1'])
  assert.equal(recycleCount(groups), 1)
})

test('回收站：不属于任何工作区的会话落未分组块（排在最后）', () => {
  const ws = [workspace('w1', ['a1'])]
  const sessions = list([summary('a1'), summary('stray')])
  const groups = deriveRecycleGroups(sessions, ws, ['a1', 'stray'])
  assert.deepEqual(groups.map((g) => g.key), ['w1', UNGROUPED_KEY])
  assert.deepEqual(groups[1]?.sessions.map((s) => s.id), ['stray'])
})

test('回收站：集合为空时抽屉是空的（入口显示 0，不渲染任何块）', () => {
  assert.deepEqual(deriveRecycleGroups(list([summary('a')]), [workspace('w1', ['a'])], []), [])
})

test('回收站：visibleRecycleIds 过滤掉认不出的与已归档的，并保留移入顺序', () => {
  const sessions = list([summary('a'), summary('b'), summary('c', { origin: 'subagent' })])
  assert.deepEqual(visibleRecycleIds(['a', 'gone', 'b', 'c'], sessions, []), ['a', 'b'])
  assert.deepEqual(visibleRecycleIds(['a', 'b'], sessions, ['a']), ['b'])
  assert.deepEqual(visibleRecycleIds([], sessions, []), [])
})

// ---------------------------------------------------------------------------
// #82 纯视图态：官方客户端存储惯例（dsh.<区>.<名>），坏值回落默认
// ---------------------------------------------------------------------------

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: (key) => (Object.hasOwn(data, key) ? (data[key] as string) : null),
    setItem: (key, value) => {
      data[key] = value
    },
  }
}

test('视图态：键名沿用官方惯例 dsh.<区>.<名>', () => {
  assert.equal(TREE_VIEW_PREF_KEY, 'dsh.workspaceTree.view')
})

test('视图态：写出去能读回来（当前分组/展开集合/抽屉与标签组的收起集合）', () => {
  const storage = memoryStorage()
  const prefs = {
    activeGroupId: 'g-1',
    expandedGroups: ['w1', ''],
    recycleCollapsed: ['w2'],
    tagCollapsed: ['w1\u0000t-1'],
  }
  writeTreeViewPrefs(storage, prefs)
  assert.deepEqual(readTreeViewPrefs(storage), prefs)
  assert.deepEqual(JSON.parse(storage.data[TREE_VIEW_PREF_KEY] as string), prefs)
})

test('视图态：无键/坏 JSON/未知取值一律回落默认（坏值不该让树打不开）', () => {
  assert.deepEqual(readTreeViewPrefs(memoryStorage()), defaultTreeViewPrefs())
  assert.deepEqual(readTreeViewPrefs(memoryStorage({ [TREE_VIEW_PREF_KEY]: '{' })), defaultTreeViewPrefs())
  assert.deepEqual(readTreeViewPrefs(memoryStorage({ [TREE_VIEW_PREF_KEY]: '"workspace"' })), defaultTreeViewPrefs())
  assert.deepEqual(readTreeViewPrefs(undefined), defaultTreeViewPrefs())
  assert.deepEqual(
    parseTreeViewPrefs({ activeGroupId: '', expandedGroups: ['a', 'a', 7] }),
    { activeGroupId: null, expandedGroups: ['a'], recycleCollapsed: [], tagCollapsed: [] },
  )
  // 旧版本的偏好里没有 recycleCollapsed / tagCollapsed：缺字段按空集合
  // （旧数据不该让抽屉、标签组乱收）
  assert.deepEqual(parseTreeViewPrefs({ expandedGroups: ['w1'], recycleCollapsed: 'nope' }).recycleCollapsed, [])
  assert.deepEqual(parseTreeViewPrefs({ expandedGroups: ['w1'], tagCollapsed: 'nope' }).tagCollapsed, [])
})

test('视图态：#131 退役的 groupBy / orderBy 从旧记录里读出来也不认（解析只产出仍在用的字段）', () => {
  // 用户在旧版本里选过「单列表 / 最近更新」，那条记录还在 localStorage 里：解析结果里
  // 不该再有这两个字段（写回时顺手把它们从记录里抹掉），其余视图态照原样读回。
  assert.deepEqual(
    parseTreeViewPrefs({ groupBy: 'flat', orderBy: 'updated', activeGroupId: 'g-1', expandedGroups: ['a'] }),
    { activeGroupId: 'g-1', expandedGroups: ['a'], recycleCollapsed: [], tagCollapsed: [] },
  )
  const storage = memoryStorage({ [TREE_VIEW_PREF_KEY]: JSON.stringify({ groupBy: 'flat', orderBy: 'updated', expandedGroups: ['w1'] }) })
  const readBack = readTreeViewPrefs(storage)
  assert.deepEqual(readBack, { activeGroupId: null, expandedGroups: ['w1'], recycleCollapsed: [], tagCollapsed: [] })
  writeTreeViewPrefs(storage, readBack)
  assert.deepEqual(Object.keys(JSON.parse(storage.data[TREE_VIEW_PREF_KEY] as string) as object).sort(), [
    'activeGroupId',
    'expandedGroups',
    'recycleCollapsed',
    'tagCollapsed',
  ])
})

test('视图态：存储不可用（隐私模式/配额满）不抛，静默降级', () => {
  const broken: StorageLike = {
    getItem: () => {
      throw new Error('denied')
    },
    setItem: () => {
      throw new Error('quota')
    },
  }
  assert.deepEqual(readTreeViewPrefs(broken), defaultTreeViewPrefs())
  writeTreeViewPrefs(broken, defaultTreeViewPrefs())
})

// ---------------------------------------------------------------------------
// #131 视图选项退役：源码层不留能切到平铺 / 改排序的路径
// ---------------------------------------------------------------------------

/**
 * 源码层的「grep 一次」：`#131` 宣布侧栏恒为「按工作区 + 官方顺序」，退役的不只是那枚
 * 按钮，还有它背后的两档取值与平铺那一支渲染。运行期那一次在浏览器套件 F-33。
 *
 * 口径是「不留**路径**」，不是「不许出现 flat 这个词」：下面这几个名字是**另一回事**，
 * 必须留着，所以匹配用的是有边界的标识符，而不是裸词——
 * - `deriveFlat` / `orderByRecency`：官方同名推导（全部可见会话 / 最近更新排序），
 *   前者仍被选择态的 id → 节点映射用着，后者是官方顺序本身的实现；
 * - `flatGroups`：**全部分组都展开**的那一份推导（名字里的 flat 是「摊平来看」）。
 */
const RETIRED_MARKERS: ReadonlyArray<{ pattern: RegExp; what: string }> = [
  { pattern: /\bgroupBy\b/, what: '分组方式（按工作区 / 单列表）' },
  { pattern: /\borderBy\b/, what: '排序方式（手动 / 最近更新）' },
  { pattern: /ViewOptionsMenu/, what: '视图选项菜单本体' },
  { pattern: /view-options/, what: '视图选项入口的标记' },
  { pattern: /group-by/, what: '分组方式那一节的菜单 id' },
  { pattern: /order-by/, what: '排序方式那一节的菜单 id' },
  { pattern: /dshOneTree_flatList/, what: '单列表容器类名' },
  { pattern: /dshOneTree_flatRowWithoutStatus/, what: '单列表行的类名' },
  { pattern: /data-dshone-tree['"]\s*:\s*['"]flat['"]/, what: '单列表容器的标记' },
]

/** 自有侧栏的源码与词典、以及这一族的样式表（宿主侧旧侧栏不在本条范围里）。 */
const RETIREMENT_SCOPE: readonly string[] = [
  'src/ui/assembly/shell/workspaceTree',
  'src/pure/workspaceTreePrefs.ts',
  'src/pure/workspaceTreeView.ts',
]

test('视图选项退役：源码里不再有能切到平铺 / 改排序的路径', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const files: string[] = []
  for (const entry of RETIREMENT_SCOPE) {
    const full = path.join(root, entry)
    if (statSync(full).isDirectory()) {
      for (const name of readdirSync(full)) {
        if (name.endsWith('.ts')) files.push(path.join(full, name))
      }
    } else {
      files.push(full)
    }
  }
  assert.ok(files.length >= 10, `扫描面太小（只扫到 ${String(files.length)} 个文件），路径写错了？`)
  const hits: string[] = []
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, index) => {
      for (const marker of RETIRED_MARKERS) {
        if (marker.pattern.test(line)) {
          hits.push(`${path.relative(root, file)}:${String(index + 1)} ${marker.what} → ${line.trim()}`)
        }
      }
    })
  }
  assert.deepEqual(hits, [], `退役的视图选项还在源码里：\n${hits.join('\n')}`)
})
