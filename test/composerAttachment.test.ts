import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attachmentDataUrl, isImageMediaType } from '../src/pure/composerAttachment.ts'

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
