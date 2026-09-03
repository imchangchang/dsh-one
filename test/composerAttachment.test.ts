import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  attachmentDataUrl,
  imageMediaTypeByExtension,
  isImageMediaType,
  isImagePath,
  snapshotFileName,
  splitAttachmentLines,
} from '../src/pure/composerAttachment.ts'

test('isImageMediaType matches image/* case-insensitively, tolerating whitespace', () => {
  assert.equal(isImageMediaType('image/png'), true)
  assert.equal(isImageMediaType('Image/JPEG'), true)
  assert.equal(isImageMediaType(' image/webp '), true)
  assert.equal(isImageMediaType('application/pdf'), false)
  assert.equal(isImageMediaType(''), false)
})

test('attachmentDataUrl normalizes the declared type, empty falls back to png', () => {
  assert.equal(attachmentDataUrl('image/png', 'QUJD'), 'data:image/png;base64,QUJD')
  assert.equal(attachmentDataUrl(' Image/JPEG ', 'QUJD'), 'data:image/jpeg;base64,QUJD')
  assert.equal(attachmentDataUrl('', 'QUJD'), 'data:image/png;base64,QUJD')
})

test('splitAttachmentLines pulls file lines back into chips, keeps user text', () => {
  const { text, files } = splitAttachmentLines(
    '看看这个\n<attachment>/tmp/a/b.png</attachment>\n顺便\n<attachment>C:\\x\\y.txt</attachment>',
  )
  assert.equal(text, '看看这个\n顺便')
  assert.deepEqual(files, [
    { name: 'b.png', path: '/tmp/a/b.png', image: true },
    { name: 'y.txt', path: 'C:\\x\\y.txt' },
  ])
})

test('splitAttachmentLines leaves non-file text untouched', () => {
  const text = '见 <attachment>x</attachment> 部分\n<a href="x">link</a>'
  assert.deepEqual(splitAttachmentLines(text), { text, files: [] })
})

test('isImagePath recognizes the four dsh raster extensions case-insensitively', () => {
  assert.equal(isImagePath('/a/b/截图-0903-153812.png'), true)
  assert.equal(isImagePath('C:\\x\\cover.JPG'), true)
  assert.equal(isImagePath('a/b/photo.webp'), true)
  assert.equal(isImagePath('a/b/photo.gif'), true)
  assert.equal(isImagePath('a/b/note.JPEG'), true)
  assert.equal(isImagePath('a/b/readme.md'), false)
  assert.equal(isImagePath('a/b/archive.tar'), false)
})

test('imageMediaTypeByExtension maps extensions to dsh media types', () => {
  assert.equal(imageMediaTypeByExtension('.png'), 'image/png')
  assert.equal(imageMediaTypeByExtension('.jpg'), 'image/jpeg')
  assert.equal(imageMediaTypeByExtension('.JPEG'), 'image/jpeg')
  assert.equal(imageMediaTypeByExtension('.webp'), 'image/webp')
  assert.equal(imageMediaTypeByExtension('.gif'), 'image/gif')
  assert.equal(imageMediaTypeByExtension('.md'), undefined)
})

test('snapshotFileName builds a short timestamp name with the media-type extension', () => {
  const now = new Date(2026, 8, 3, 15, 38, 12) // 本地时间 2026-09-03 15:38:12
  assert.equal(snapshotFileName('image/png', now, 0, '截图'), '截图-0903-153812.png')
  assert.equal(snapshotFileName('Image/JPEG', now, 0, '截图'), '截图-0903-153812.jpg')
  assert.equal(snapshotFileName('image/webp', now, 0, '截图'), '截图-0903-153812.webp')
  assert.equal(snapshotFileName('image/gif', now, 0, '截图'), '截图-0903-153812.gif')
})

test('snapshotFileName appends a clash index, pads stamps, and defaults the prefix', () => {
  const now = new Date(2026, 8, 3, 9, 5, 7)
  assert.equal(snapshotFileName('image/png', now, 0, '截图'), '截图-0903-090507.png')
  assert.equal(snapshotFileName('image/png', now, 1, '截图'), '截图-0903-090507-2.png')
  assert.equal(snapshotFileName('image/png', now, 2, '截图'), '截图-0903-090507-3.png')
  // 默认英文前缀（纯函数不落中文字面量）
  assert.equal(snapshotFileName('image/png', now), 'Screenshot-0903-090507.png')
})

test('snapshotFileName falls back to png for unknown media types', () => {
  assert.equal(snapshotFileName('application/octet-stream', new Date(2026, 0, 2, 3, 4, 5), 0, '截图'), '截图-0102-030405.png')
})
