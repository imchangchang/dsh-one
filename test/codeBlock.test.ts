import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CODE_BLOCK_MAX_LINES, codeBlockPreview } from '../src/pure/codeBlock.ts'

test('code within the fold limit passes through whole', () => {
  const text = 'a\nb\nc'
  assert.deepEqual(codeBlockPreview(text), { head: ['a', 'b', 'c'], tail: [], totalLines: 3, hidden: 0 })
  const exact = Array.from({ length: CODE_BLOCK_MAX_LINES }, (_, i) => `l${i}`).join('\n')
  assert.equal(codeBlockPreview(exact).hidden, 0)
})

test('longer code keeps a head + tail and counts hidden lines', () => {
  const lines = Array.from({ length: 20 }, (_, i) => `line${i}`)
  const r = codeBlockPreview(lines.join('\n'))
  assert.equal(r.totalLines, 20)
  assert.equal(r.hidden, 4)
  // 头部 Math.ceil(16/2)=8 行，尾部补满 16 行的剩余 8 行。
  assert.deepEqual(r.head, lines.slice(0, 8))
  assert.deepEqual(r.tail, lines.slice(12))
  // 折叠态拼接后正是「头 + 尾」，隐藏中间 4 行。
  assert.deepEqual([...r.head, ...r.tail].join('\n'), lines.filter((_, i) => i < 8 || i >= 12).join('\n'))
})

test('empty and single-line code never truncate', () => {
  assert.deepEqual(codeBlockPreview(''), { head: [''], tail: [], totalLines: 1, hidden: 0 })
  assert.equal(codeBlockPreview('one line').hidden, 0)
})

test('custom maxLines overrides the default threshold', () => {
  const r = codeBlockPreview('l0\nl1\nl2\nl3', 2)
  // 头部 Math.ceil(2/2)=1 行，尾部补满 2 行的剩余 1 行。
  assert.deepEqual(r.head, ['l0'])
  assert.deepEqual(r.tail, ['l3'])
  assert.equal(r.hidden, 2)
})
