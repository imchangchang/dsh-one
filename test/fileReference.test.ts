import assert from 'node:assert/strict'
import { test } from 'node:test'
import { activeAtToken, fileMentionToken, formatFileMention } from '../src/pure/fileReference.ts'

test('activeAtToken：行首与空白后的 @query 触发，query 允许 / 与 @', () => {
  assert.deepEqual(activeAtToken('@rea'), { prefix: '@rea', query: 'rea', quoted: false })
  assert.deepEqual(activeAtToken('看看 @src/ut'), { prefix: '@src/ut', query: 'src/ut', quoted: false })
  assert.deepEqual(activeAtToken('a\n@x'), { prefix: '@x', query: 'x', quoted: false })
})

test('activeAtToken：邮箱等 token 内部的 @ 不触发', () => {
  assert.equal(activeAtToken('mail a@b'), undefined)
  assert.equal(activeAtToken(''), undefined)
  assert.equal(activeAtToken('没有 at'), undefined)
})

test('activeAtToken：未闭合引号 token 标记 quoted；闭合引号回落为 plain（与官方一致）', () => {
  assert.deepEqual(activeAtToken('@"path with'), { prefix: '@"path with', query: 'path with', quoted: true })
  assert.deepEqual(activeAtToken('x @"dir/'), { prefix: '@"dir/', query: 'dir/', quoted: true })
  // 官方行为：quoted 正则不匹配闭合引号，plain 正则把整个 @"closed" 当普通 token。
  assert.deepEqual(activeAtToken('@"closed"'), { prefix: '@"closed"', query: '"closed"', quoted: false })
})

test('formatFileMention：普通路径裸写，目录补尾部斜杠', () => {
  assert.equal(formatFileMention({ path: 'README.md', kind: 'file' }), '@README.md')
  assert.equal(formatFileMention({ path: 'src/ui', kind: 'directory' }), '@src/ui/')
})

test('formatFileMention：含空白走引号语法，目录保持引号敞开以下钻', () => {
  assert.equal(formatFileMention({ path: 'a b.txt', kind: 'file' }), '@"a b.txt"')
  assert.equal(formatFileMention({ path: 'my dir', kind: 'directory' }), '@"my dir/')
})

test('formatFileMention：preserveQuote 保留显式打开的引号', () => {
  assert.equal(formatFileMention({ path: 'a.txt', kind: 'file' }, true), '@"a.txt"')
  assert.equal(formatFileMention({ path: 'src', kind: 'directory' }, true), '@"src/')
})

test('formatFileMention：控制字符与内嵌引号无法安全表示', () => {
  assert.equal(formatFileMention({ path: 'a"b.txt', kind: 'file' }), undefined)
  assert.equal(formatFileMention({ path: 'a\tb.txt', kind: 'file' }), undefined)
})

test('fileMentionToken：首选 @短名，冲突时追加序号直到唯一', () => {
  const bindings = new Map<string, string>()
  const first = fileMentionToken('截图.png', '@/a/截图.png', bindings)
  assert.equal(first, '@截图.png')
  bindings.set(first, '@/a/截图.png')
  // 同名被别的绑定占用（不同 mention）→ 序号递增
  assert.equal(fileMentionToken('截图.png', '@/b/截图.png', bindings), '@截图.png (2)')
  // 同名同 mention（重复插入同一文件）→ 直接用 @短名 覆盖注册，不递增
  assert.equal(fileMentionToken('截图.png', '@/a/截图.png', bindings), '@截图.png')
})

test('activeAtToken：常见中英文标点后可触发（行间 @ 引用）', () => {
  assert.deepEqual(activeAtToken('第一张，@img'), { prefix: '@img', query: 'img', quoted: false })
  assert.deepEqual(activeAtToken('对比：@img1'), { prefix: '@img1', query: 'img1', quoted: false })
  // 引号 token 同样支持标点后触发（汉字前是内容边界，不误触）
  assert.deepEqual(activeAtToken('第一张，@"img 1.png'), { prefix: '@"img 1.png', query: 'img 1.png', quoted: true })
  assert.equal(activeAtToken('看@"img 1.png'), undefined)
  // 标点后不误触发（邮箱/普通字符边界不变）
  assert.equal(activeAtToken('foo.a@b'), undefined)
})
