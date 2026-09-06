import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inlineImageMediaType, inlineImageTooLarge, MAX_INLINE_IMAGE_BYTES } from '../src/pure/inlineImage.ts'

test('inlineImageMediaType：常见图片扩展名 → 对应 MIME（大小写容忍）', () => {
  assert.equal(inlineImageMediaType('/Users/me/x.png'), 'image/png')
  assert.equal(inlineImageMediaType('/Users/me/x.JPG'), 'image/jpeg')
  assert.equal(inlineImageMediaType('/tmp/shot.jpeg'), 'image/jpeg')
  assert.equal(inlineImageMediaType('/tmp/a.webp'), 'image/webp')
  assert.equal(inlineImageMediaType('/tmp/a.gif'), 'image/gif')
})

test('inlineImageMediaType：file: 前缀、URL 编码与 Windows 盘符都归一', () => {
  assert.equal(inlineImageMediaType('file:///Users/me/a%20b.png'), 'image/png')
  assert.equal(inlineImageMediaType('file:///tmp/x.JPG'), 'image/jpeg')
  assert.equal(inlineImageMediaType('C:/Users/me/x.png'), 'image/png')
  assert.equal(inlineImageMediaType('C:\\Users\\me\\x.png'), 'image/png')
  assert.equal(inlineImageMediaType('~/shot.png'), 'image/png')
  assert.equal(inlineImageMediaType('./x.png'), 'image/png')
  assert.equal(inlineImageMediaType('../docs/fig.webp'), 'image/webp')
  assert.equal(inlineImageMediaType('docs/foo.png'), 'image/png')
  // marked 把反斜杠编码成 %5C 的 Windows 路径同样命中。
  assert.equal(inlineImageMediaType('C:%5CUsers%5Cme%5Cx.png'), 'image/png')
})

test('inlineImageMediaType：目录里的点不误判扩展名', () => {
  // v1.2 是目录名的一部分：basename 后无扩展名 → 非图片。
  assert.equal(inlineImageMediaType('C:\\v1.2\\shot'), undefined)
  assert.equal(inlineImageMediaType('/a/b.png.d'), undefined)
})

test('inlineImageMediaType：非图片扩展名 / 无扩展名返回 undefined', () => {
  assert.equal(inlineImageMediaType('/tmp/report.pdf'), undefined)
  assert.equal(inlineImageMediaType('/tmp/icon.svg'), undefined)
  assert.equal(inlineImageMediaType('/etc/passwd'), undefined)
  assert.equal(inlineImageMediaType('/tmp/archive.tar.gz'), undefined)
  assert.equal(inlineImageMediaType('/tmp/noext'), undefined)
  assert.equal(inlineImageMediaType('file:///tmp/x.png;base64'), undefined)
})

test('inlineImageTooLarge：上限 10MB，边界值 10MB 放行、超 1 字节拒绝', () => {
  assert.equal(MAX_INLINE_IMAGE_BYTES, 10 * 1024 * 1024)
  assert.equal(inlineImageTooLarge(0), false)
  assert.equal(inlineImageTooLarge(MAX_INLINE_IMAGE_BYTES), false)
  assert.equal(inlineImageTooLarge(MAX_INLINE_IMAGE_BYTES + 1), true)
  assert.equal(inlineImageTooLarge(NaN), true)
  assert.equal(inlineImageTooLarge(-1), true)
})
