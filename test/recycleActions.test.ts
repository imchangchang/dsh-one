/**
 * #103 的批量动作（`src/pure/recycleActions.ts`）：两层语义的可执行口径——
 * **移入/还原只写我们自己的集合（官方归档口一次都不许碰）**，**归档/清空才走官方**
 * 且逐个落地、失败项如实报出。用假件把这两条钉住，界面怎么接都跑不出这个范围。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  archiveSessionsPermanently,
  partitionArchivable,
  emptyRecycleBin,
  moveSessionsToRecycleBin,
  restoreSessionsFromRecycleBin,
  type RecycleBinSink,
} from '../src/pure/recycleActions.ts'
import { emptyRecycleBin as emptyFile, type RecycleBinFile } from '../src/pure/recycleBinState.ts'

interface Recorder extends RecycleBinSink {
  /** 归档口收到的调用（移入/还原一次都不该有）。 */
  readonly archived: string[]
  /** 落盘的调用序列（每次 commit 一条）。 */
  readonly commits: RecycleBinFile[]
}

const recorder = (initial: readonly string[] = [], failArchiveFor: readonly string[] = []): Recorder => {
  let file: RecycleBinFile = { version: 1, sessionIds: [...initial] }
  const archived: string[] = []
  const commits: RecycleBinFile[] = []
  return {
    archived,
    commits,
    load: async () => ({ version: 1, sessionIds: [...file.sessionIds] }),
    commit: async (next) => {
      file = { version: 1, sessionIds: [...next.sessionIds] }
      commits.push(file)
    },
    archiveSession: async (sessionId) => {
      archived.push(sessionId)
      if (failArchiveFor.includes(sessionId)) throw new Error('archive failed')
    },
  }
}

test('移入回收站：只追加本地集合与落盘，一次都不碰官方归档口', async () => {
  const sink = recorder()
  const outcome = await moveSessionsToRecycleBin(['a', 'b'], sink)
  assert.deepEqual(outcome, { done: ['a', 'b'], failed: [] })
  assert.deepEqual(sink.archived, [], '移入回收站绝不动 dsh 侧')
  assert.deepEqual(sink.commits.map((file) => file.sessionIds), [['a', 'b']])
})

test('移入回收站：追加在移入顺序尾部（越晚移入越靠后），重复移入不重复追加也不报失败', async () => {
  const sink = recorder(['a'])
  const outcome = await moveSessionsToRecycleBin(['a', 'b', 'b'], sink)
  assert.deepEqual(outcome.done, ['b'])
  assert.deepEqual(sink.commits[0]?.sessionIds, ['a', 'b'])
  assert.deepEqual(sink.archived, [])
  // 已经在集合里的幂等移入：无变化 → 不落盘、不报错。
  const again = await moveSessionsToRecycleBin(['a', 'b'], sink)
  assert.deepEqual(again, { done: [], failed: [] })
  assert.equal(sink.commits.length, 1)
})

test('还原：从本地集合移出，其余顺序不变，也不碰官方', async () => {
  const sink = recorder(['a', 'b', 'c'])
  const outcome = await restoreSessionsFromRecycleBin(['b'], sink)
  assert.deepEqual(outcome, { done: ['b'], failed: [] })
  assert.deepEqual(sink.commits[0]?.sessionIds, ['a', 'c'])
  assert.deepEqual(sink.archived, [])
})

test('还原：集合里没有的 id 不算失败（幂等）', async () => {
  const sink = recorder(['a'])
  assert.deepEqual(await restoreSessionsFromRecycleBin(['zz'], sink), { done: [], failed: [] })
  assert.equal(sink.commits.length, 0)
})

test('归档（= 删除）：逐个走官方口，成功项同时从本地集合划掉', async () => {
  const sink = recorder(['a', 'b'])
  const outcome = await archiveSessionsPermanently(['a', 'b'], sink)
  assert.deepEqual(sink.archived, ['a', 'b'], '串行逐个归档')
  assert.deepEqual(outcome, { done: ['a', 'b'], failed: [] })
  assert.deepEqual(sink.commits.map((file) => file.sessionIds), [[]], '归档成功后从本地集合里划掉')
})

test('归档：失败项如实报出且留在集合里（下一次还能重试）', async () => {
  const sink = recorder(['a', 'b'], ['b'])
  const outcome = await archiveSessionsPermanently(['a', 'b'], sink)
  assert.deepEqual(outcome, { done: ['a'], failed: ['b'] })
  assert.deepEqual(sink.commits[0]?.sessionIds, ['b'], '只划掉归档成功的那条，失败项留着可重试')
})

test('清空回收站 = 把集合里每一条都归档，并把成功项划掉', async () => {
  const sink = recorder(['a', 'b'])
  const outcome = await emptyRecycleBin(sink)
  assert.deepEqual(outcome, { done: ['a', 'b'], failed: [] })
  assert.deepEqual(sink.archived, ['a', 'b'])
  assert.deepEqual(sink.commits.map((file) => file.sessionIds), [[]])
})

test('清空：空集合时什么都不做（不碰官方、不落盘）', async () => {
  const sink = recorder()
  assert.deepEqual(await emptyRecycleBin(sink), { done: [], failed: [] })
  assert.deepEqual(sink.archived, [])
  assert.equal(sink.commits.length, 0)
})

test('落盘失败：报失败并保持内存态不变（不静默放行）', async () => {
  const sink: RecycleBinSink = {
    load: async () => emptyFile(),
    commit: async () => {
      throw new Error('state store unavailable')
    },
    archiveSession: async () => {},
  }
  assert.deepEqual(await moveSessionsToRecycleBin(['a'], sink), { done: [], failed: ['a'] })
})

// ---------------------------------------------------------------------------
// 批量归档的切分（与行菜单禁用态、勾选框资格同一份判定：sessionEligibility.canArchive）
// ---------------------------------------------------------------------------

test('partitionArchivable：可归档与被跳过切开，顺序原样保留（判定走 sessionEligibility 那一份）', () => {
  const items = [
    { id: 'a', pinned: false, running: false, unread: false },
    { id: 'b', pinned: true, running: false, unread: false },
    { id: 'c', pinned: false, running: true, unread: false },
    { id: 'd', pinned: false, running: false, unread: true },
    { id: 'e', pinned: false, running: false, unread: false, runningSubagentCount: 2 },
    { id: 'f', pinned: false, running: false, unread: false, pendingInteraction: 'approval' },
  ]
  const result = partitionArchivable(items)
  assert.deepEqual(result.ready.map((entry) => entry.id), ['a'])
  assert.deepEqual(result.skipped.map((entry) => entry.id), ['b', 'c', 'd', 'e', 'f'])
})

test('partitionArchivable：一条都不可归档时 ready 为空（界面据此不开弹窗）', () => {
  const result = partitionArchivable([
    { id: 'a', pinned: true, running: false, unread: false },
    { id: 'b', pinned: false, running: true, unread: false },
  ])
  assert.deepEqual(result.ready, [])
  assert.equal(result.skipped.length, 2)
})
