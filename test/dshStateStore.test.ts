import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { DshStateStore } from '../src/ui/dshStateStore.ts'

async function tmpDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'dsh-state-test-'))
}

test('load on missing/empty dir: every module null (触发迁移), never throws', async () => {
  const io = new DshStateStore({ dir: path.join(await tmpDir(), 'nope') })
  const snap = await io.load()
  assert.deepEqual(snap, { recycleBin: null, groups: null, tags: null, pinned: null, unread: null })
})

test('writeModule + load roundtrip; atomic write leaves no tmp files', async () => {
  const dir = await tmpDir()
  const io = new DshStateStore({ dir })
  assert.equal(await io.writeModule('pinned', '{"version":1,"sessionIds":["a","b"]}'), true)
  const snap = await io.load()
  assert.deepEqual(snap.pinned, { version: 1, sessionIds: ['a', 'b'] })
  assert.deepEqual(await readdir(dir), ['pinned.json'])
})

test('corrupt file degrades to null; update treats it as empty and rewrites', async () => {
  const dir = await tmpDir()
  await writeFile(path.join(dir, 'unread.json'), '{broken', 'utf8')
  const io = new DshStateStore({ dir })
  assert.equal((await io.load()).unread, null)
  assert.equal(await io.updateUnread((prev) => [...prev, 's1']), true)
  assert.deepEqual((await io.load()).unread, { version: 1, sessionIds: ['s1'] })
})

test('update is read-merge-write: mutator sees the latest file content, not caller state', async () => {
  const dir = await tmpDir()
  const io = new DshStateStore({ dir })
  // 模拟另一窗口/脚本先写了一条。
  await io.writeModule('recycle-bin', '{"version":1,"sessionIds":["other"]}')
  await io.updateRecycleBin((prev) => [...prev, 'mine'])
  assert.deepEqual((await io.load()).recycleBin?.sessionIds, ['other', 'mine'])
})

test('concurrent updates from the same window are serialized (no lost update)', async () => {
  const dir = await tmpDir()
  const io = new DshStateStore({ dir })
  // 不等第一个落定就发第二个——串行队列保证第二个读到第一个的结果。
  const p1 = io.updatePinned((prev) => [...prev, 's1'])
  const p2 = io.updatePinned((prev) => [...prev, 's2'])
  assert.deepEqual(await Promise.all([p1, p2]), [true, true])
  assert.deepEqual((await io.load()).pinned?.sessionIds, ['s1', 's2'])
  assert.equal(io.writePending, false)
})

test('mutator returning prev unchanged skips the write (no file created)', async () => {
  const dir = await tmpDir()
  const io = new DshStateStore({ dir })
  assert.equal(await io.updatePinned((prev) => prev), true)
  assert.deepEqual(await readdir(dir), [])
})

test('corrupt file load warns via log sink (现场可定位)', async () => {
  const dir = await tmpDir()
  await writeFile(path.join(dir, 'unread.json'), '{broken', 'utf8')
  const logs: string[] = []
  const io = new DshStateStore({
    dir,
    log: { info: (m) => logs.push(`info:${m}`), warn: (m) => logs.push(`warn:${m}`) },
  })
  await io.load()
  assert.ok(
    logs.some((l) => l.startsWith('warn:client-state:') && l.includes('unread.json')),
    `expected corrupt-file warn, got ${JSON.stringify(logs)}`,
  )
})

test('missing tags file: prev still carries preset tags (fresh-install assign-to-preset persists)', async () => {
  const dir = await tmpDir()
  const io = new DshStateStore({ dir })
  // sessionsStore.setSessionTag 的 mutator 模式：以文件内 tag id 做 prevKnown
  // 校验——文件不存在时 prev 若缺预设组，这条写会被静默吞掉（评审发现的回归）。
  const ok = await io.updateTags((prev) => {
    const prevKnown = new Set(prev.tags.map((t) => t.id))
    if (!prevKnown.has('preset-todo')) throw new Error('preset tags missing from empty file prev')
    return { ...prev, sessionTags: { ...prev.sessionTags, s1: 'preset-todo' } }
  })
  assert.equal(ok, true)
  const tags = (await io.load()).tags
  assert.equal(tags?.sessionTags.s1, 'preset-todo')
})

test('updateGroups / updateTags merge onto existing file content field-wise', async () => {
  const dir = await tmpDir()
  const io = new DshStateStore({ dir })
  await io.updateGroups((prev) => ({
    ...prev,
    groups: [{ id: 'g1', name: 'one' }],
    activeGroupId: 'g1',
  }))
  // 第二个写只动 membership：groups/activeGroupId 必须原样保留。
  await io.updateGroups((prev) => ({ ...prev, membership: { ws1: ['g1'] } }))
  assert.deepEqual((await io.load()).groups, {
    version: 1,
    groups: [{ id: 'g1', name: 'one' }],
    membership: { ws1: ['g1'] },
    activeGroupId: 'g1',
  })
  await io.updateTags((prev) => ({ ...prev, sessionTags: { s1: 'preset-todo' } }))
  const tags = (await io.load()).tags
  assert.ok(tags !== null)
  assert.equal(tags.sessionTags.s1, 'preset-todo')
  // 预设组补齐后 sessionTags 指向的组存在（parseTagFile 清洗不丢这条归属）。
  assert.ok(tags.tags.some((t) => t.id === 'preset-todo'))
})
