import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mergeGroupDefs,
  mergeIdList,
  mergeMembership,
  mergeSessionTags,
  mergeTagDefs,
  migrateTagFileV1ToV2,
  parseGroupFile,
  parseIdListFile,
  parseTagFile,
  resolveGroupFile,
  resolveIdList,
  resolveTagFile,
  serializeGroupFile,
  serializeIdListFile,
  serializeTagFile,
  serializeTagFileV2,
  type TagFileV2,
} from '../src/pure/dshStateFile.ts'
import { PRESET_TAGS } from '../src/pure/sessionTags.ts'

/* ---- 宽松解析：坏 JSON / version 不符 / 字段缺失 → null ---- */

test('parseIdListFile: bad json / wrong version / missing field → null', () => {
  assert.equal(parseIdListFile('not json'), null)
  assert.equal(parseIdListFile('{"version":2,"sessionIds":["a"]}'), null)
  assert.equal(parseIdListFile('{"version":1}'), null)
  assert.equal(parseIdListFile('[1,2]'), null)
})

test('parseIdListFile: valid file is sanitized (non-string/dup/empty dropped)', () => {
  const parsed = parseIdListFile('{"version":1,"sessionIds":["a","",1,"a","b"]}')
  assert.deepEqual(parsed, { version: 1, sessionIds: ['a', 'b'] })
})

test('parseIdListFile: empty list is authoritative (present, not null)', () => {
  assert.deepEqual(parseIdListFile('{"version":1,"sessionIds":[]}'), { version: 1, sessionIds: [] })
})

test('parseGroupFile: missing any of the three fields → null', () => {
  assert.equal(parseGroupFile('{"version":1,"groups":[],"membership":{}}'), null)
  assert.equal(parseGroupFile('{"version":1,"groups":[],"activeGroupId":null}'), null)
  assert.equal(parseGroupFile('{"version":1,"membership":{},"activeGroupId":null}'), null)
})

test('parseGroupFile: membership drops unknown group ids; activeGroupId falls back to null', () => {
  const raw = JSON.stringify({
    version: 1,
    groups: [{ id: 'g1', name: 'one' }],
    membership: { ws1: ['g1', 'gX'], ws2: ['gX'], ws3: 'nope' },
    activeGroupId: 'gX',
  })
  assert.deepEqual(parseGroupFile(raw), {
    version: 1,
    groups: [{ id: 'g1', name: 'one' }],
    membership: { ws1: ['g1'] },
    activeGroupId: null,
  })
})

test('parseTagFile v2: per-workspace buckets are sanitized; presets appended per bucket', () => {
  const raw = JSON.stringify({
    version: 2,
    workspaces: {
      ws1: {
        tags: [{ id: 't-1', name: 'task', color: 'orange' }],
        sessionTags: { s1: 't-1', s2: 't-gone' },
        collapsed: ['t-1', 't-unknown'],
      },
      ws2: { tags: [], sessionTags: { s3: 'preset-done' }, collapsed: [] },
      bad: 'nope',
    },
  })
  const parsed = parseTagFile(raw)
  assert.ok(parsed !== null && parsed.version === 2)
  const ws1 = parsed.workspaces.ws1
  assert.equal(ws1.sessionTags.s1, 't-1')
  assert.equal(ws1.sessionTags.s2, undefined)
  // 折叠 id 丢弃指向未知组的。
  assert.deepEqual(ws1.collapsed, ['t-1'])
  // 预设组补齐（文件里没写预设组也能渲染出 todo/doing/done）。
  for (const p of PRESET_TAGS) assert.ok(ws1.tags.some((t) => t.id === p.id))
  // 坏 bucket 丢弃。
  assert.equal(parsed.workspaces.bad, undefined)
  assert.deepEqual(parsed.workspaces.ws2.sessionTags, { s3: 'preset-done' })
})

test('parseTagFile still reads v1 legacy (global) shape', () => {
  const raw = JSON.stringify({
    version: 1,
    tags: [{ id: 't-1', name: 'task', color: 'orange' }],
    sessionTags: { s1: 't-1', s2: 't-gone' },
  })
  const parsed = parseTagFile(raw)
  assert.ok(parsed !== null && parsed.version === 1)
  assert.equal(parsed.sessionTags.s1, 't-1')
  assert.equal(parsed.sessionTags.s2, undefined)
  // 预设组补齐。
  for (const p of PRESET_TAGS) assert.ok(parsed.tags.some((t) => t.id === p.id))
})

test('serialize → parse roundtrip', () => {
  assert.deepEqual(parseIdListFile(serializeIdListFile({ version: 1, sessionIds: ['a'] })), {
    version: 1,
    sessionIds: ['a'],
  })
  const group = { version: 1 as const, groups: [{ id: 'g1', name: 'one' }], membership: { ws: ['g1'] }, activeGroupId: 'g1' }
  assert.deepEqual(parseGroupFile(serializeGroupFile(group)), group)
  const tagV2: TagFileV2 = {
    version: 2,
    workspaces: {
      ws1: {
        tags: [{ id: 't-1', name: 'task', color: 'orange' as const }],
        sessionTags: { s1: 't-1' },
        collapsed: [],
      },
    },
  }
  const parsed = parseTagFile(serializeTagFileV2(tagV2))
  assert.ok(parsed !== null && parsed.version === 2)
  assert.deepEqual(parsed.workspaces.ws1.sessionTags, { s1: 't-1' })
  assert.ok(parsed.workspaces.ws1.tags.some((t) => t.id === 't-1'))
})

/* ---- 迁移决策：文件 present（哪怕空数据）即权威；否则回读旧值 ---- */

test('resolveIdList: file wins even when empty; legacy only when file absent', () => {
  assert.deepEqual(resolveIdList({ version: 1, sessionIds: [] }, ['legacy']), {
    value: [],
    fromLegacy: false,
  })
  assert.deepEqual(resolveIdList(null, ['legacy', 'legacy', 1]), { value: ['legacy'], fromLegacy: true })
  assert.deepEqual(resolveIdList(null, undefined), { value: [], fromLegacy: false })
})

test('resolveGroupFile: legacy values are sanitized the same way as file values', () => {
  const resolved = resolveGroupFile(
    null,
    [{ id: 'g1', name: ' one ' }],
    { ws1: ['g1', 'gX'] },
    'gX',
  )
  assert.deepEqual(resolved, {
    value: { groups: [{ id: 'g1', name: 'one' }], membership: { ws1: ['g1'] }, activeGroupId: null },
    fromLegacy: true,
  })
  assert.equal(resolveGroupFile(null, undefined, undefined, undefined).fromLegacy, false)
})

test('resolveTagFile: file authoritative; legacy flagged only when a legacy key exists', () => {
  const file = { version: 1 as const, tags: [], sessionTags: {} }
  assert.deepEqual(resolveTagFile(file, [{ id: 't-9', name: 'x', color: 'red' }], { s: 't-9' }), {
    value: file,
    fromLegacy: false,
  })
  const resolved = resolveTagFile(null, undefined, undefined)
  assert.equal(resolved.fromLegacy, false)
  // 全新安装也能拿到预设组（sanitizeTags 补齐）。
  assert.equal(resolved.value.tags.length, PRESET_TAGS.length)
})

/* ---- v1 全局 → v2 per-workspace 迁移 ---- */

test('migrateTagFileV1ToV2 splits a global tag file into per-workspace buckets', () => {
  const v1 = {
    version: 1 as const,
    tags: [
      { id: 'preset-todo', name: null, color: 'yellow' as const },
      { id: 't-1', name: 'Bug修复', color: 'orange' as const },
      { id: 't-2', name: '未引用', color: 'red' as const }, // 无会话引用 → 丢弃
    ],
    sessionTags: { s1: 'preset-todo', s2: 't-1', s3: 't-1' },
  }
  const wsOf: (id: string) => string | undefined = (id) => (id === 's3' ? undefined : 'wsA')
  const out = migrateTagFileV1ToV2(v1, wsOf, 'UNGROUPED')
  assert.equal(out.version, 2)
  // wsA：s1(todo) 与 s2(Bug修复) 归桶，preset + 被引用的自定义组都在。
  const wsA = out.workspaces.wsA
  assert.deepEqual(wsA.sessionTags, { s1: 'preset-todo', s2: 't-1' })
  assert.ok(wsA.tags.some((t) => t.id === 'preset-todo'))
  assert.ok(wsA.tags.some((t) => t.id === 't-1'))
  assert.ok(!wsA.tags.some((t) => t.id === 't-2'))
  // 未分组 s3 → UNGROUPED 桶，且该组必须能解析（t-1 定义随桶带过去）。
  const ungrouped = out.workspaces.UNGROUPED
  assert.deepEqual(ungrouped.sessionTags, { s3: 't-1' })
  assert.ok(ungrouped.tags.some((t) => t.id === 't-1'))
})

test('migrateTagFileV1ToV2 keeps presets per bucket and yields empty workspaces when no assignments', () => {
  const v1 = {
    version: 1 as const,
    tags: [...PRESET_TAGS],
    sessionTags: {},
  }
  const out = migrateTagFileV1ToV2(v1, () => undefined, 'UNGROUPED')
  assert.equal(out.version, 2)
  assert.deepEqual(out.workspaces, {})
})

test('migrateTagFileV1ToV2: a workspace bucket never duplicates the same tag def', () => {
  const v1 = {
    version: 1 as const,
    tags: [
      { id: 'preset-todo', name: null, color: 'yellow' as const },
      { id: 't-1', name: 'x', color: 'orange' as const },
    ],
    sessionTags: { s1: 't-1', s2: 't-1' },
  }
  const out = migrateTagFileV1ToV2(v1, () => 'wsA', 'UNGROUPED')
  assert.equal(out.workspaces.wsA.tags.filter((t) => t.id === 't-1').length, 1)
})

/* ---- 字段级合并（写前重读/并发迁移用） ---- */

test('mergeIdList: ordered union, a first, dups dropped', () => {
  assert.deepEqual(mergeIdList(['a', 'b'], ['b', 'c']), ['a', 'b', 'c'])
  assert.deepEqual(mergeIdList([], []), [])
})

test('mergeSessionTags: union, b wins per key', () => {
  assert.deepEqual(mergeSessionTags({ s1: 't1', s2: 't2' }, { s2: 't3', s3: 't3' }), {
    s1: 't1',
    s2: 't3',
    s3: 't3',
  })
})

test('mergeTagDefs: dedup by id and by name, a wins', () => {
  const a = [{ id: 't-1', name: 'task', color: 'orange' as const }]
  const b = [
    { id: 't-1', name: 'renamed', color: 'red' as const }, // 同 id → 丢弃
    { id: 't-2', name: 'task', color: 'purple' as const }, // 同名 → 丢弃
    { id: 't-3', name: 'other', color: 'red' as const },
  ]
  assert.deepEqual(mergeTagDefs(a, b), [...a, b[2]])
})

test('mergeTagDefs: preset tags all have null name and must NOT collide with each other', () => {
  // 初版骨架的坑：name 去重没排除 null，三个预设组会因共享 null 名字只剩一个。
  const merged = mergeTagDefs(PRESET_TAGS, [])
  assert.equal(merged.length, PRESET_TAGS.length)
  // 文件侧与旧 Memento 侧各带一份预设组时也不翻倍。
  const twice = mergeTagDefs(PRESET_TAGS, PRESET_TAGS)
  assert.equal(twice.length, PRESET_TAGS.length)
})

test('mergeGroupDefs: dedup by id and name (group names are always strings)', () => {
  const a = [{ id: 'g1', name: 'one' }]
  const b = [
    { id: 'g1', name: 'uno' },
    { id: 'g2', name: 'one' },
    { id: 'g3', name: 'three' },
  ]
  assert.deepEqual(mergeGroupDefs(a, b), [...a, b[2]])
})

test('mergeMembership: per-workspace ordered union', () => {
  assert.deepEqual(
    mergeMembership({ ws1: ['g1'], ws2: ['g2'] }, { ws1: ['g2', 'g1'], ws3: ['g3'] }),
    { ws1: ['g1', 'g2'], ws2: ['g2'], ws3: ['g3'] },
  )
})
