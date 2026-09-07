import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { DshStateStore } from '../src/ui/dshStateStore.ts'
import {
  capDraftsFile,
  emptyDraftsFile,
  parseDraftsFile,
  DRAFTS_ANSWERS_CAP,
  DRAFTS_COMPOSER_CAP,
  DRAFT_IMAGE_DATA_CAP,
} from '../src/pure/dshStateFile.ts'

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

/* ---- drafts 模块（#14）：不进 load() 快照，readDrafts 现读、updateDrafts 读-合-写 ---- */

test('readDrafts on missing file: empty drafts, never throws; load() snapshot untouched', async () => {
  const dir = await tmpDir()
  const io = new DshStateStore({ dir })
  assert.deepEqual(await io.readDrafts(), { version: 1, composer: {}, answers: {} })
  // drafts 不在启动快照/热重载模块里（高频写，避免 watch 重读巨型 JSON）。
  const snap = await io.load()
  assert.ok(!('drafts' in snap))
})

test('updateDrafts write + readDrafts roundtrip; delete via mutator', async () => {
  const dir = await tmpDir()
  const io = new DshStateStore({ dir })
  await io.updateDrafts((prev) => ({
    ...prev,
    composer: { ...prev.composer, s1: { text: 'hello', files: [{ name: 'a.ts', path: '/w/a.ts' }], updatedAt: 1 } },
    answers: { ...prev.answers, r1: { '0': { selected: ['A'], custom: '', other: false } } },
  }))
  const drafts = await io.readDrafts()
  assert.equal(drafts.composer.s1?.text, 'hello')
  assert.deepEqual(drafts.composer.s1?.files, [{ name: 'a.ts', path: '/w/a.ts' }])
  assert.deepEqual(drafts.answers.r1?.['0'], { selected: ['A'], custom: '', other: false })
  // 发送/提交后删条目。
  await io.updateDrafts((prev) => {
    const composer = { ...prev.composer }
    delete composer.s1
    const answers = { ...prev.answers }
    delete answers.r1
    return { ...prev, composer, answers }
  })
  assert.deepEqual(await io.readDrafts(), { version: 1, composer: {}, answers: {} })
})

test('updateDrafts is read-merge-write: another window\'s entries survive my update', async () => {
  const dir = await tmpDir()
  const io = new DshStateStore({ dir })
  // 模拟另一窗口先写了一条 composer 草稿。
  await io.updateDrafts((prev) => ({ ...prev, composer: { ...prev.composer, other: { text: 'theirs', updatedAt: 1 } } }))
  await io.updateDrafts((prev) => ({ ...prev, composer: { ...prev.composer, mine: { text: 'mine', updatedAt: 2 } } }))
  const drafts = await io.readDrafts()
  assert.equal(drafts.composer.other?.text, 'theirs')
  assert.equal(drafts.composer.mine?.text, 'mine')
})

test('corrupt drafts.json: readDrafts degrades to empty + warns; update rewrites', async () => {
  const dir = await tmpDir()
  await writeFile(path.join(dir, 'drafts.json'), '{broken', 'utf8')
  const logs: string[] = []
  const io = new DshStateStore({ dir, log: { info: (m) => logs.push(`info:${m}`), warn: (m) => logs.push(`warn:${m}`) } })
  assert.deepEqual(await io.readDrafts(), emptyDraftsFile())
  assert.ok(logs.some((l) => l.startsWith('warn:client-state:') && l.includes('drafts.json')))
  assert.equal(await io.updateDrafts((prev) => ({ ...prev, composer: { s1: { text: 'x', updatedAt: 1 } } })), true)
  assert.equal((await io.readDrafts()).composer.s1?.text, 'x')
})

test('parseDraftsFile: 坏条目逐条丢弃（不整文件作废），全空条目不复活', async () => {
  const raw = JSON.stringify({
    version: 1,
    composer: {
      good: { text: 'keep', updatedAt: 3 },
      empty: { text: '' },
      bad: { text: 42 },
      filesOnly: { text: '', files: [{ name: 'a', path: '/a' }, { name: 'no-path' }] },
    },
    answers: {
      r1: { '0': { selected: ['A', 1], custom: 'x', other: false }, '1': { selected: [], custom: '', other: false } },
      rEmpty: { '0': {} },
    },
  })
  const parsed = parseDraftsFile(raw)
  assert.ok(parsed !== null)
  assert.deepEqual(Object.keys(parsed.composer).sort(), ['filesOnly', 'good'])
  assert.deepEqual(parsed.composer.filesOnly?.files, [{ name: 'a', path: '/a' }])
  // 空答案条目被丢；rEmpty 整个 rpcId 被丢。
  assert.deepEqual(parsed.answers, { r1: { '0': { selected: ['A'], custom: 'x', other: false } } })
  // 缺字段/坏 version → null。
  assert.equal(parseDraftsFile('{"version":2,"composer":{},"answers":{}}'), null)
  assert.equal(parseDraftsFile('{"version":1,"composer":{}}'), null)
})

test('capDraftsFile: composer 超量按 updatedAt 淘旧；answers 超量按插入序淘旧', () => {
  const composer: Record<string, { text: string; updatedAt: number }> = {}
  for (let i = 0; i < DRAFTS_COMPOSER_CAP + 5; i++) composer[`s${i}`] = { text: 'x', updatedAt: i }
  const answers: Record<string, Record<string, { selected: string[]; custom: string; other: boolean }>> = {}
  for (let i = 0; i < DRAFTS_ANSWERS_CAP + 3; i++) answers[`r${i}`] = { '0': { selected: ['A'], custom: '', other: false } }
  const capped = capDraftsFile({ version: 1, composer, answers })
  assert.equal(Object.keys(capped.composer).length, DRAFTS_COMPOSER_CAP)
  // 最旧的 s0..s4 被淘掉，最新的保留。
  assert.ok(!('s0' in capped.composer) && !('s4' in capped.composer))
  assert.ok(`s${DRAFTS_COMPOSER_CAP + 4}` in capped.composer)
  assert.equal(Object.keys(capped.answers).length, DRAFTS_ANSWERS_CAP)
  assert.ok(!('r0' in capped.answers))
})

test('parseDraftsFile: 单条草稿图片总量超上限时丢弃超限图片（文本/文件保留）', () => {
  const big = 'a'.repeat(DRAFT_IMAGE_DATA_CAP)
  const raw = JSON.stringify({
    version: 1,
    composer: {
      s1: {
        text: 'keep',
        images: [
          { mediaType: 'image/png', data: big },
          { mediaType: 'image/png', data: 'small' },
        ],
        updatedAt: 1,
      },
    },
    answers: {},
  })
  const parsed = parseDraftsFile(raw)
  assert.ok(parsed !== null)
  assert.equal(parsed.composer.s1?.text, 'keep')
  // 第一张图已顶满上限，第二张超限被丢。
  assert.equal(parsed.composer.s1?.images?.length, 1)
})
