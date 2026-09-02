import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attachmentDataUrl, isImageMediaType, splitAttachmentLines } from '../src/pure/composerAttachment.ts'

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
    { name: 'b.png', path: '/tmp/a/b.png' },
    { name: 'y.txt', path: 'C:\\x\\y.txt' },
  ])
})

test('splitAttachmentLines leaves non-file text untouched', () => {
  const text = '见 <attachment>x</attachment> 部分\n<a href="x">link</a>'
  assert.deepEqual(splitAttachmentLines(text), { text, files: [] })
})
