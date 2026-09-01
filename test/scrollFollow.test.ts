import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  NEAR_BOTTOM_PX,
  archiveScrollPosition,
  distanceFromBottom,
  isNearBottom,
  isScrollKey,
  restoreScrollTarget,
} from '../src/pure/scrollFollow.ts'

test('distanceFromBottom 基本计算', () => {
  assert.equal(distanceFromBottom(1000, 500, 200), 300)
  assert.equal(distanceFromBottom(1000, 800, 200), 0)
})

test('distanceFromBottom 负值钳到 0（内容不足一屏 / 过滚动）', () => {
  assert.equal(distanceFromBottom(100, 0, 200), 0)
  assert.equal(distanceFromBottom(1000, 900, 200), 0)
})

test('isNearBottom 距底 <40px 即跟随', () => {
  assert.equal(isNearBottom(1000, 761, 200), true) // 距底 39
  assert.equal(isNearBottom(1000, 760, 200), false) // 距底 40
  assert.equal(isNearBottom(1000, 0, 200), false)
  // 内容不足一屏恒为跟随
  assert.equal(isNearBottom(100, 0, 200), true)
  // 阈值本身可调，测试与常量联动
  assert.equal(NEAR_BOTTOM_PX, 40)
})

test('archiveScrollPosition 按实时位置生成存档', () => {
  // 贴底：只记 atBottom，scrollTop 随内容增长会失效，恢复时不使用
  assert.deepEqual(archiveScrollPosition(1000, 761, 200), { scrollTop: 761, atBottom: true })
  // 翻历史：记当时位置
  assert.deepEqual(archiveScrollPosition(1000, 300, 200), { scrollTop: 300, atBottom: false })
  // 内容不足一屏视为贴底
  assert.deepEqual(archiveScrollPosition(100, 0, 200), { scrollTop: 0, atBottom: true })
})

test('restoreScrollTarget 无存档默认贴底', () => {
  assert.deepEqual(restoreScrollTarget(undefined), { stickToBottom: true, scrollTop: null })
})

test('restoreScrollTarget 贴底存档恢复跟随', () => {
  assert.deepEqual(restoreScrollTarget({ scrollTop: 760, atBottom: true }), {
    stickToBottom: true,
    scrollTop: null,
  })
})

test('restoreScrollTarget 翻历史存档恢复位置（含 scrollTop 0）', () => {
  assert.deepEqual(restoreScrollTarget({ scrollTop: 300, atBottom: false }), {
    stickToBottom: false,
    scrollTop: 300,
  })
  assert.deepEqual(restoreScrollTarget({ scrollTop: 0, atBottom: false }), {
    stickToBottom: false,
    scrollTop: 0,
  })
})

test('isScrollKey 识别会滚动容器的按键', () => {
  for (const key of ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']) {
    assert.equal(isScrollKey(key), true, key)
  }
  for (const key of ['Enter', 'Escape', 'a', 'Tab', 'ArrowLeft', 'ArrowRight']) {
    assert.equal(isScrollKey(key), false, key)
  }
})
