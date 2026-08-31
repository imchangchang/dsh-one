import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NEAR_BOTTOM_PX, distanceFromBottom, isNearBottom, isScrollKey } from '../src/pure/scrollFollow.ts'

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

test('isScrollKey 识别会滚动容器的按键', () => {
  for (const key of ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']) {
    assert.equal(isScrollKey(key), true, key)
  }
  for (const key of ['Enter', 'Escape', 'a', 'Tab', 'ArrowLeft', 'ArrowRight']) {
    assert.equal(isScrollKey(key), false, key)
  }
})
