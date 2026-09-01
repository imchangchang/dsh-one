import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  JSON_TREE_ROOT_KEY,
  defaultJsonTreeExpanded,
  flattenJsonTree,
  isJsonTree,
  isOpenFromSet,
  jsonPathKey,
  tryParseJsonTree,
  type JsonTreeRow,
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
