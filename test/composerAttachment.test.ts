import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  attachmentBaseName,
  attachmentDataUrl,
  imageMediaTypeByExtension,
  imgFileName,
  isImageMediaType,
  isImagePath,
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
  // Windows 盘符路径 + 目录里带点：basename 无扩展名时不算图片
  assert.equal(isImagePath('C:\\Users\\v1.2\\dsh-one-attachments\\shot.png'), true)
  assert.equal(isImagePath('C:\\Users\\v1.2\\dsh-one-attachments\\shot'), false)
})

test('attachmentBaseName handles posix, windows and bare names', () => {
  assert.equal(attachmentBaseName('/a/b/截图.png'), '截图.png')
  assert.equal(attachmentBaseName('C:\\Users\\x\\note.md'), 'note.md')
  assert.equal(attachmentBaseName('C:\\a\\b'), 'b')
  assert.equal(attachmentBaseName('plain.txt'), 'plain.txt')
  assert.equal(attachmentBaseName('C:\\a\\b\\'), '')
})

test('imageMediaTypeByExtension maps extensions to dsh media types', () => {
  assert.equal(imageMediaTypeByExtension('.png'), 'image/png')
  assert.equal(imageMediaTypeByExtension('.jpg'), 'image/jpeg')
  assert.equal(imageMediaTypeByExtension('.JPEG'), 'image/jpeg')
  assert.equal(imageMediaTypeByExtension('.webp'), 'image/webp')
  assert.equal(imageMediaTypeByExtension('.gif'), 'image/gif')
  assert.equal(imageMediaTypeByExtension('.md'), undefined)
})

test('imgFileName builds imgN.ext names with the media-type extension', () => {
  assert.equal(imgFileName('image/png', 1), 'img1.png')
  assert.equal(imgFileName('Image/JPEG', 2), 'img2.jpg')
  assert.equal(imgFileName('image/webp', 3), 'img3.webp')
  assert.equal(imgFileName('image/gif', 4), 'img4.gif')
})

test('imgFileName falls back to png for unknown media types', () => {
  assert.equal(imgFileName('application/octet-stream', 5), 'img5.png')
})


