import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  base64Bytes,
  formatBytes,
  imageIntakeRejection,
  isGatedImage,
  type ImageIntakeLimits,
} from '../src/pure/imageIntake.ts'

const LIMITS: ImageIntakeLimits = {
  maxImageBytes: 5 * 1024 * 1024,
  maxImagesPerMessage: 3,
  maxMessageImageBytes: 10 * 1024 * 1024,
  mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
}

const img = (name: string, bytes: number, mediaType = 'image/png') => ({ name, mediaType, bytes })

test('imageIntakeRejection passes when no limits are known (legacy sessions)', () => {
  assert.equal(imageIntakeRejection([img('a.png', 99 * 1024 * 1024)], 40, 0, undefined), null)
})

test('imageIntakeRejection ignores batches with no gated image in them', () => {
  assert.equal(imageIntakeRejection([{ name: 'a.pdf', mediaType: 'application/pdf', bytes: 90 * 1024 * 1024 }], 99, 0, LIMITS), null)
})

test('imageIntakeRejection counts images only, not the non-image files around them', () => {
  const batch = [img('a.png', 1000), { name: 'b.txt', mediaType: 'text/plain', bytes: 1 }, img('c.png', 1000)]
  assert.equal(imageIntakeRejection(batch, 1, 0, LIMITS), null)
  assert.deepEqual(imageIntakeRejection(batch, 2, 0, LIMITS), { reason: 'tooMany', max: 3 })
})

test('imageIntakeRejection applies count, per-file, then total in official order', () => {
  assert.deepEqual(imageIntakeRejection([img('a.png', 1)], 3, 0, LIMITS), { reason: 'tooMany', max: 3 })
  assert.deepEqual(imageIntakeRejection([img('big.png', LIMITS.maxImageBytes + 1)], 0, 0, LIMITS), {
    reason: 'fileTooLarge',
    name: 'big.png',
    maxBytes: LIMITS.maxImageBytes,
  })
  // 恰好等于上限放行（官方是 `>`，不是 `>=`）。
  assert.equal(imageIntakeRejection([img('a.png', LIMITS.maxImageBytes)], 0, 0, LIMITS), null)
  assert.deepEqual(imageIntakeRejection([img('a.png', 1024)], 0, LIMITS.maxMessageImageBytes, LIMITS), {
    reason: 'totalTooLarge',
    maxBytes: LIMITS.maxMessageImageBytes,
  })
  assert.equal(imageIntakeRejection([img('a.png', 1024)], 0, LIMITS.maxMessageImageBytes - 1024, LIMITS), null)
})

test('isGatedImage trusts the declared type, falls back to the extension when empty', () => {
  assert.equal(isGatedImage(img('a.png', 1), LIMITS.mediaTypes), true)
  assert.equal(isGatedImage({ name: 'x', mediaType: 'IMAGE/PNG', bytes: 1 }, LIMITS.mediaTypes), true)
  // file-promise：类型缺失时按扩展名兜底。
  assert.equal(isGatedImage({ name: 'shot.PNG', mediaType: '', bytes: 1 }, LIMITS.mediaTypes), true)
  assert.equal(isGatedImage({ name: 'notes.txt', mediaType: '', bytes: 1 }, LIMITS.mediaTypes), false)
  // 声明成别的图片类型（白名单外）仍受字节闸管。
  assert.equal(isGatedImage({ name: 'a.bmp', mediaType: 'image/bmp', bytes: 1 }, LIMITS.mediaTypes), true)
  assert.equal(isGatedImage({ name: 'a.bmp', mediaType: 'application/octet-stream', bytes: 1 }, LIMITS.mediaTypes), false)
})

test('base64Bytes matches the decoded length, padding included', () => {
  assert.equal(base64Bytes(''), 0)
  assert.equal(base64Bytes(Buffer.from('abc').toString('base64')), 3)
  assert.equal(base64Bytes(Buffer.from('a').toString('base64')), 1)
  assert.equal(base64Bytes(Buffer.from('ab').toString('base64')), 2)
  assert.equal(base64Bytes(Buffer.alloc(5000).toString('base64')), 5000)
})

test('formatBytes renders whole megabytes, kilobytes and bytes', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(800), '800 B')
  assert.equal(formatBytes(1024), '1 KB')
  assert.equal(formatBytes(5 * 1024 * 1024), '5 MB')
  assert.equal(formatBytes(1024 * 1024 + 512 * 1024), '1.5 MB')
  assert.equal(formatBytes(Number.NaN), '0 B')
})
