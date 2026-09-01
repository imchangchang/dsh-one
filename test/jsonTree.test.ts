import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  JSON_TREE_MAX_LINES,
  JSON_TREE_ROOT_KEY,
  defaultJsonTreeExpanded,
  flattenJsonTree,
  isJsonTree,
  isOpenFromSet,
  jsonPathKey,
  jsonTreeCopyText,
  jsonTreeThresholdExceeded,
  jsonValueAtPath,
  tryParseJsonTree,
  type JsonTreeRow,
  type JsonValue,
} from '../src/pure/jsonTree.ts'

/** `key` is absent on close rows; type-safe field read for assertions. */
const keyOf = (r: JsonTreeRow) => ('key' in r ? r.key : undefined)

/* ---------------- 检测：只有对象/数组字面量才是树 ---------------- */

test('object and array literals are detected as JSON trees', () => {
  assert.equal(isJsonTree('{"a":1}'), true)
  assert.equal(isJsonTree('  [1,2,3]  '), true)
  assert.equal(isJsonTree('{"nested":{"x":true},"arr":[1,"two",null]}'), true)
  assert.equal(isJsonTree('{ "files": [ { "path": "a.txt" } ] }'), true)
})

test('primitive scalars are NOT JSON trees', () => {
  assert.equal(isJsonTree('"just a string"'), false)
  assert.equal(isJsonTree('42'), false)
  assert.equal(isJsonTree('true'), false)
  assert.equal(isJsonTree('null'), false)
})

test('prose and malformed JSON are not detected', () => {
  assert.equal(isJsonTree('7 passed, 0 failed'), false)
  assert.equal(isJsonTree('hello world'), false)
  assert.equal(isJsonTree('{not json'), false)
  assert.equal(isJsonTree('{ "a": }'), false)
  assert.equal(isJsonTree('[1, 2'), false)
  assert.equal(isJsonTree(''), false)
  assert.equal(isJsonTree('   '), false)
})

test('a whole-text json code fence is tolerated, prose with a trailing fence is not', () => {
  assert.equal(isJsonTree('```json\n{"a":1}\n```'), true)
  assert.equal(isJsonTree('```\n[1,2]\n```'), true)
  // 锚定到整段文本：普通 prose 以 code fence 结尾不算 JSON。
  const fence = '```json\n{"a":1}\n```'
  assert.equal(isJsonTree(`here is output:\n${fence}`), false)
  assert.equal(isJsonTree('```json\n42\n```'), false)
})

/* ---------------- 路径 key ---------------- */

test('path key is canonical and collision-free', () => {
  assert.equal(jsonPathKey([]), '$')
  assert.equal(jsonPathKey(['a']), '$.a')
  assert.equal(jsonPathKey(['a', 'b']), '$.a.b')
  assert.equal(jsonPathKey([0]), '$[0]')
  assert.equal(jsonPathKey(['a', 1]), '$.a[1]')
  assert.equal(jsonPathKey(['complex-key']), '$["complex-key"]')
  assert.equal(jsonPathKey(['a b']), '$["a b"]')
})

/* ---------------- 默认展开策略 ---------------- */

test('default expansion: root open, nested containers closed', () => {
  const value = { a: { b: 1 }, c: 2 }
  assert.deepEqual([...defaultJsonTreeExpanded(value)], ['$'])
  const open = isOpenFromSet(defaultJsonTreeExpanded(value))
  assert.equal(open('$'), true)
  assert.equal(open('$.a'), false)
})

test('an empty root has no default-expanded node', () => {
  assert.deepEqual([...defaultJsonTreeExpanded({})], [])
  assert.deepEqual([...defaultJsonTreeExpanded([])], [])
})

/* ---------------- 平铺行模型 + 嵌套层级 ---------------- */

test('flatten with default open: root expanded, children collapsed', () => {
  const rows = flattenJsonTree({ a: { b: 1 }, c: 2 }, isOpenFromSet(defaultJsonTreeExpanded({ a: { b: 1 }, c: 2 })))
  assert.deepEqual(
    rows.map((r) => [r.depth, r.type]),
    [
      [0, 'container'], // {  (root, open)
      [1, 'container'], // a: {…}  (closed)
      [1, 'primitive'], // c: 2
      [0, 'close'], // }
    ],
  )
})

test('root row has no key and reports object kind + entry count', () => {
  const [root] = flattenJsonTree({ a: 1, b: 2 }, isOpenFromSet(defaultJsonTreeExpanded({ a: 1, b: 2 })))
  assert.deepEqual(root, {
    type: 'container',
    depth: 0,
    path: [],
    key: null,
    kind: 'object',
    open: true,
    entryCount: 2,
  })
})

test('expanding a nested container reveals its children and a close bracket', () => {
  const value = { a: { b: 1, c: [2, 3] }, d: 4 }
  const open = (p: string) => p === '$' || p === '$.a'
  const rows = flattenJsonTree(value, open)
  assert.deepEqual(
    rows.map((r) => [r.depth, r.type, keyOf(r)]),
    [
      [0, 'container', null], // {  (open)
      [1, 'container', 'a'], // a: {  (open)
      [2, 'primitive', 'b'], // b: 1
      [2, 'container', 'c'], // c: […]  (closed)
      [1, 'close', undefined], // }
      [1, 'primitive', 'd'], // d: 4
      [0, 'close', undefined], // }
    ],
  )
})

test('array children carry numeric index path and string-index key', () => {
  const rows = flattenJsonTree([{ x: 1 }, 2], isOpenFromSet(new Set(['$'])))
  assert.deepEqual(
    rows.map((r) => [r.depth, r.type, keyOf(r)]),
    [
      [0, 'container', null], // [  (open)
      [1, 'container', '0'], // 0: {…}  (closed)
      [1, 'primitive', '1'], // 1: 2
      [0, 'close', undefined], // ]
    ],
  )
  const firstChild = rows[1] as { path: Array<string | number> }
  assert.deepEqual(firstChild.path, [0])
  assert.equal(jsonPathKey(firstChild.path), '$[0]')
})

test('empty objects and arrays render as unexpandable container rows', () => {
  const rows = flattenJsonTree({ a: {} }, (p) => p === '$')
  assert.deepEqual(
    rows.map((r) => [r.depth, r.type, keyOf(r), 'entryCount' in r ? r.entryCount : null]),
    [
      [0, 'container', null, 1], // {  (root, open — it has child `a`)
      [1, 'container', 'a', 0], // a: {}  (empty, not expandable, no children)
      [0, 'close', undefined, null], // }
    ],
  )
  const empty = rows[1] as Extract<(typeof rows)[number], { type: 'container' }>
  assert.equal(empty.open, false)
})

/* ---------------- 原始值显示 ---------------- */

test('primitive rows get display kind and quoted string', () => {
  const rows = flattenJsonTree({ s: 'hi', n: 3, t: true, z: null }, (p) => p === '$')
  const prims = rows.filter((r) => r.type === 'primitive')
  assert.deepEqual(prims.map((r) => r.primitive), [
    { type: 'string', display: '"hi"' },
    { type: 'number', display: '3' },
    { type: 'boolean', display: 'true' },
    { type: 'null', display: 'null' },
  ])
})

test('tryParseJsonTree returns the parsed container for object and array', () => {
  assert.deepEqual(tryParseJsonTree('{"a":1}'), { a: 1 })
  assert.deepEqual(tryParseJsonTree('[1,2]'), [1, 2])
  assert.equal(tryParseJsonTree('not json'), null)
  assert.equal(tryParseJsonTree('"x"'), null)
})

/* ---------------- 折叠整个 root ---------------- */

test('closing the root collapses the whole tree to a single container row', () => {
  const rows = flattenJsonTree({ a: 1 }, () => false)
  assert.deepEqual(
    rows.map((r) => [r.depth, r.type]),
    [[0, 'container']],
  )
  const root = rows[0] as Extract<(typeof rows)[0], { type: 'container' }>
  assert.equal(root.open, false)
  assert.equal(root.entryCount, 1)
})

/* ---------------- 复制文本（整树 pretty JSON） ---------------- */

test('jsonTreeCopyText pretty-prints the whole tree with two-space indent', () => {
  assert.equal(jsonTreeCopyText({ a: 1, b: [1, 2], c: null }), '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ],\n  "c": null\n}')
  assert.equal(jsonTreeCopyText({ status: 'ok' }), '{\n  "status": "ok"\n}')
})

test('jsonTreeCopyText normalizes a fenced parse back to clean pretty JSON', () => {
  const value = tryParseJsonTree('```json\n{"a":1}\n```')
  assert.ok(value)
  assert.equal(jsonTreeCopyText(value!), '{\n  "a": 1\n}')
})

/* ---------------- 节点级复制：子值 pretty JSON + 路径解析 ---------------- */

test('jsonTreeCopyText works on primitive sub-values', () => {
  assert.equal(jsonTreeCopyText('hi'), '"hi"')
  assert.equal(jsonTreeCopyText(5), '5')
  assert.equal(jsonTreeCopyText(true), 'true')
  assert.equal(jsonTreeCopyText(null), 'null')
  assert.equal(jsonTreeCopyText([1, 2]), '[\n  1,\n  2\n]')
})

test('jsonValueAtPath resolves nested object/array paths', () => {
  const root = { a: { b: 1 }, c: [2, 3], d: null }
  assert.equal(jsonValueAtPath(root, []), root)
  assert.equal(jsonValueAtPath(root, ['a', 'b']), 1)
  assert.equal(jsonValueAtPath(root, ['c', 1]), 3)
  assert.equal(jsonValueAtPath(root, ['d']), null)
  assert.equal(jsonValueAtPath(root, ['missing']), undefined)
  assert.equal(jsonValueAtPath(root, ['a', 'missing']), undefined)
  assert.equal(jsonValueAtPath(root, ['c', 5]), undefined)
  assert.equal(jsonValueAtPath('scalar', ['x']), undefined)
})

test('flattened rows resolve to their sub-values via jsonValueAtPath', () => {
  const root = { checks: { gateway: { healthy: true } }, status: 'ok' } as const
  const rows = flattenJsonTree(root, isOpenFromSet(new Set(['$', '$.checks'])))
  const checksRow = rows.find((r) => 'key' in r && r.key === 'checks')
  const statusRow = rows.find((r) => 'key' in r && r.key === 'status')
  assert.ok(checksRow && 'path' in checksRow && statusRow && 'path' in statusRow)
  assert.deepEqual(jsonValueAtPath(root, checksRow.path), { gateway: { healthy: true } })
  assert.equal(jsonValueAtPath(root, statusRow.path), 'ok')
})

/* ---------------- 行数阈值（超大 JSON 回退 code block 折叠） ---------------- */

test('threshold uses the 2-space pretty-JSON line count (copyPrettyJson 口径)', () => {
  assert.equal(JSON_TREE_MAX_LINES, 300)
  // 一个 298 项的数组 → 2 空格序列化恰好 300 行（298 项 + [ 与 ]），等于阈值不超。
  const at300 = Array.from({ length: 298 }, (_, i) => i)
  assert.equal(jsonTreeCopyText(at300).split('\n').length, 300)
  assert.equal(jsonTreeThresholdExceeded(at300), false)
  // 299 项 → 301 行，超过阈值。
  const over = Array.from({ length: 299 }, (_, i) => i)
  assert.equal(jsonTreeCopyText(over).split('\n').length, 301)
  assert.equal(jsonTreeThresholdExceeded(over), true)
})

test('small values stay under the threshold; big nested objects exceed', () => {
  assert.equal(jsonTreeThresholdExceeded({ a: 1, b: [1, 2] }), false)
  assert.equal(jsonTreeThresholdExceeded('scalar'), false)
  const big: { rows: JsonValue[] } = { rows: [] }
  for (let i = 0; i < 160; i++) {
    // 每个对象 4 行（{ / "n" / "v" / }），160*4=640 行，远超阈值。
    big.rows.push({ n: i, v: `row-${i}` })
  }
  assert.ok(jsonTreeCopyText(big).split('\n').length > JSON_TREE_MAX_LINES)
  assert.equal(jsonTreeThresholdExceeded(big), true)
})
