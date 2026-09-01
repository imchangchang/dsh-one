import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AT_BOTTOM_PX,
  SETTLE_IDLE_MS,
  archiveScrollPosition,
  distanceFromBottom,
  isAtBottom,
  isScrollKey,
  reconcileScrollPinning,
  restoreScrollTarget,
  shouldPinNow,
  shouldSettlePinNow,
} from '../src/pure/scrollFollow.ts'

test('distanceFromBottom 基本计算', () => {
  assert.equal(distanceFromBottom(1000, 500, 200), 300)
  assert.equal(distanceFromBottom(1000, 800, 200), 0)
})

test('distanceFromBottom 负值钳到 0（内容不足一屏 / 过滚动）', () => {
  assert.equal(distanceFromBottom(100, 0, 200), 0)
  assert.equal(distanceFromBottom(1000, 900, 200), 0)
})

test('isAtBottom 精确贴底：距底 ≤ AT_BOTTOM_PX（替代旧 40px 容差）', () => {
  assert.equal(isAtBottom(1000, 798, 200), true) // 距底 2
  assert.equal(isAtBottom(1000, 797, 200), false) // 距底 3 → 滚离，停跟随
  assert.equal(AT_BOTTOM_PX, 2)
  // 内容不足一屏恒为贴底
  assert.equal(isAtBottom(100, 0, 200), true)
})

test('isAtBottom 旧 40px 容差范围内的"滚离"不再算贴底（修流式抖动）', () => {
  // 用户滚离底部 20px（旧 isNearBottom 判定其为贴底）→ 现在精确判定为已滚离
  assert.equal(isAtBottom(1000, 780, 200), false) // 距底 20
})

test('archiveScrollPosition 用离开时跟随态记 atBottom（修切回位置错）', () => {
  // 跟随中离开：atBottom=true，滚动位置无意义（恢复时忽略）
  assert.deepEqual(archiveScrollPosition(761, true), { scrollTop: 761, atBottom: true })
  // 滚离底部（跟随态已置 false）：记当时位置，恢复时回去
  assert.deepEqual(archiveScrollPosition(761, false), { scrollTop: 761, atBottom: false })
})

test('reconcileScrollPinning 手势窗口内双向调整（修流式抖动）', () => {
  // 手势滚到底 → 跟随
  assert.equal(reconcileScrollPinning(false, true, true), true)
  // 手势滚离 20px → 停跟随
  assert.equal(reconcileScrollPinning(true, true, false), false)
})

test('reconcileScrollPinning 非手势只做单向修正（修「回到最新」误显）', () => {
  // 内容收缩/程序滚动把视图钳到贴底，但跟随态残留 false → 置 true
  assert.equal(reconcileScrollPinning(false, false, true), true)
  // 非手势滚离（此时跟随态已是 false，视口并不贴底）→ 维持 false，jump 显示
  assert.equal(reconcileScrollPinning(false, false, false), false)
  // 非手势滚动绝不主动把跟随态置 false（防程序滚动误判为滚离）
  assert.equal(reconcileScrollPinning(true, false, false), true)
})

test('restoreScrollTarget 无存档默认贴底', () => {
  assert.deepEqual(restoreScrollTarget(undefined), { stickToBottom: true, scrollTop: null })
})

test('restoreScrollTarget 贴底（跟随中离开）存档恢复跟随', () => {
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

test('shouldPinNow 跟随态 + 无意图 + 未贴底才写 scrollTop', () => {
  // 三条件同时满足：贴底跟随重滚底
  assert.equal(shouldPinNow(true, false, false), true)
})

test('shouldPinNow 意图活跃不写（不抢惯性动画，修贴底惯性抖动）', () => {
  // 跟随态但手势/动量未结束（wheel 仍持续到达）→ 不写
  assert.equal(shouldPinNow(true, true, false), false)
})

test('shouldPinNow 已贴底幂等跳过', () => {
  // 跟随态、无意图、但实际已贴底（内容不足一屏 / 已 pin 到位）→ 不写
  assert.equal(shouldPinNow(true, false, true), false)
})

test('shouldPinNow 非跟随态（用户已滚离读历史）决不写', () => {
  assert.equal(shouldPinNow(false, false, false), false)
  assert.equal(shouldPinNow(false, true, true), false)
})

test('SETTLE_IDLE_MS 是滚动空闲判定窗口（约 120ms）', () => {
  assert.equal(SETTLE_IDLE_MS, 120)
})

test('shouldSettlePinNow 滚动空闲且满足 shouldPinNow 才写（迭代 3）', () => {
  // 滚动真正停（scrollActive=false）+ 跟随 + 无意图 + 未贴底 → 写
  assert.equal(shouldSettlePinNow(true, false, false, false), true)
})

test('shouldSettlePinNow 滚动活动（回归动画）期间决不写', () => {
  // 回归动画期间 scroll 事件持续到达 → scrollActive=true，即使其它条件满足也禁止写
  assert.equal(shouldSettlePinNow(true, false, false, true), false)
})

test('shouldSettlePinNow 滚动活动优先于其它条件（无论意图/贴底）', () => {
  assert.equal(shouldSettlePinNow(true, true, false, true), false)
  assert.equal(shouldSettlePinNow(true, false, true, true), false)
})

test('shouldSettlePinNow 非跟随态（读历史）即使滚动停也不写', () => {
  assert.equal(shouldSettlePinNow(false, false, false, false), false)
})
