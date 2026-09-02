import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isFilePathHref } from '../src/pure/linkPath.ts'

test('isFilePathHref: 绝对路径与 file: URI', () => {
  assert.equal(isFilePathHref('/Users/cgeng/Workspaces/POV/a.md'), true)
  assert.equal(isFilePathHref('/Users/cgeng/目录/文件 名.md'), true)
  assert.equal(isFilePathHref('file:///Users/cgeng/a%20b.md'), true)
  assert.equal(isFilePathHref('file:/Users/cgeng/a.md'), true)
})

test('isFilePathHref: Windows 绝对路径（含 marked 编码的 %5C）', () => {
  assert.equal(isFilePathHref('C:/Users/cgeng/a.md'), true)
  assert.equal(isFilePathHref('C:\\Users\\cgeng\\a.md'), true)
  assert.equal(isFilePathHref('C:%5CUsers%5Ccgeng%5Ca.md'), true)
  assert.equal(isFilePathHref('c:/a.md'), true)
})

test('isFilePathHref: 用户目录与相对路径', () => {
  assert.equal(isFilePathHref('~/home/a.md'), true)
  assert.equal(isFilePathHref('./docs/a.md'), true)
  assert.equal(isFilePathHref('../x/AGENTS.md'), true)
  assert.equal(isFilePathHref('docs/foo.md'), true)
  assert.equal(isFilePathHref('AGENTS.md'), true)
  assert.equal(isFilePathHref('foo bar.md'), true)
  assert.equal(isFilePathHref('hello%20world.md'), true)
})

test('isFilePathHref: 外链与危险 scheme 不是文件路径', () => {
  assert.equal(isFilePathHref('https://example.com/a.md'), false)
  assert.equal(isFilePathHref('http://example.com'), false)
  assert.equal(isFilePathHref('mailto:a@b.c'), false)
  assert.equal(isFilePathHref('javascript:alert(1)'), false)
  assert.equal(isFilePathHref('data:text/html,<script>'), false)
  assert.equal(isFilePathHref('vbscript:x'), false)
  assert.equal(isFilePathHref('vscode://file/a.md'), false)
  assert.equal(isFilePathHref('dsh-session:abc'), false)
})
