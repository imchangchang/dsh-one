import { test } from 'node:test'
import assert from 'node:assert/strict'
import { alignDiffLines } from '../src/pure/diffAlign.ts'

const kinds = (pairs: { kind: string }[]) => pairs.map((p) => p.kind)

test('identical texts align as all-equal pairs', () => {
  const pairs = alignDiffLines('a\nb\nc', 'a\nb\nc')
  assert.deepEqual(kinds(pairs), ['equal', 'equal', 'equal'])
  assert.deepEqual(pairs, [
    { kind: 'equal', oldLine: 'a', newLine: 'a' },
    { kind: 'equal', oldLine: 'b', newLine: 'b' },
    { kind: 'equal', oldLine: 'c', newLine: 'c' },
  ])
})

test('empty old text renders every new line as add', () => {
  const pairs = alignDiffLines('', 'x\ny')
  assert.deepEqual(kinds(pairs), ['add', 'add'])
  assert.equal(pairs[0].oldLine, null)
  assert.equal(pairs[0].newLine, 'x')
})

test('empty new text renders every old line as del', () => {
  const pairs = alignDiffLines('x\ny', '')
  assert.deepEqual(kinds(pairs), ['del', 'del'])
  assert.equal(pairs[0].newLine, null)
  assert.equal(pairs[0].oldLine, 'x')
})

test('single-line edit pairs as one modify row', () => {
  const pairs = alignDiffLines('a\nold\nc', 'a\nnew\nc')
  assert.deepEqual(kinds(pairs), ['equal', 'modify', 'equal'])
  assert.deepEqual(pairs[1], { kind: 'modify', oldLine: 'old', newLine: 'new' })
})

test('multi-line replacement pairs rows in order', () => {
  const pairs = alignDiffLines('l1\nl2', 'r1\nr2')
  assert.deepEqual(kinds(pairs), ['modify', 'modify'])
  assert.deepEqual(pairs[0], { kind: 'modify', oldLine: 'l1', newLine: 'r1' })
  assert.deepEqual(pairs[1], { kind: 'modify', oldLine: 'l2', newLine: 'r2' })
})

test('insertion in the middle keeps equal context and adds a row', () => {
  const pairs = alignDiffLines('a\nb\nc', 'a\nx\nb\nc')
  assert.deepEqual(kinds(pairs), ['equal', 'add', 'equal', 'equal'])
  assert.deepEqual(pairs[1], { kind: 'add', oldLine: null, newLine: 'x' })
})

test('deletion in the middle keeps equal context and removes a row', () => {
  const pairs = alignDiffLines('a\nx\nb', 'a\nb')
  assert.deepEqual(kinds(pairs), ['equal', 'del', 'equal'])
  assert.deepEqual(pairs[1], { kind: 'del', oldLine: 'x', newLine: null })
})

test('unbalanced del/add block pairs the common rows and keeps the rest', () => {
  // 删 2 行、加 3 行：前 2 对配对成 modify，剩 1 行 add。
  const pairs = alignDiffLines('o1\no2\ntail', 'n1\nn2\nn3\ntail')
  assert.deepEqual(kinds(pairs), ['modify', 'modify', 'add', 'equal'])
  assert.deepEqual(pairs[0], { kind: 'modify', oldLine: 'o1', newLine: 'n1' })
  assert.deepEqual(pairs[2], { kind: 'add', oldLine: null, newLine: 'n3' })
})

test('empty lines are real rows, not dropped', () => {
  const pairs = alignDiffLines('a\n\nb', 'a\n\nb')
  assert.deepEqual(kinds(pairs), ['equal', 'equal', 'equal'])
  assert.equal(pairs[1].oldLine, '')
  assert.equal(pairs[1].newLine, '')
})

test('huge inputs degrade to row alignment instead of LCS explosion', () => {
  // 1001 × 1001 行超过 LCS 表上限（1e6），走行号对齐，行数 = max(n, m)。
  const oldText = Array.from({ length: 1001 }, (_, i) => `o${i}`).join('\n')
  const newText = Array.from({ length: 1100 }, (_, i) => (i < 1001 ? `o${i}` : `extra${i}`)).join('\n')
  const pairs = alignDiffLines(oldText, newText)
  assert.equal(pairs.length, 1100)
  // 前 1001 对同号对齐（内容相同），多出的 99 行是 add。
  assert.deepEqual(kinds(pairs.slice(1001)), Array(99).fill('add'))
})
