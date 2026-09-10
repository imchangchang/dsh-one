import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AT_BOTTOM_PX,
  anchoredScrollTop,
  SETTLE_IDLE_MS,
  archiveScrollPosition,
  distanceFromBottom,
  forwardedWheelDelta,
  isAtBottom,
  isReaderMoved,
  isScrollKey,
  nextStickToBottom,
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

test('AT_BOTTOM_PX 放宽到 25（对齐官方宽松阈值，治流式跳动）', () => {
  assert.equal(AT_BOTTOM_PX, 25)
  // 距底 25 → 贴底带内，继续跟随
  assert.equal(isAtBottom(1000, 775, 200), true)
  // 距底 26 → 已滚离，停跟随
  assert.equal(isAtBottom(1000, 774, 200), false)
  // 旧 2px 阈值下「距底 3~20px」算滚离的位置，现在仍在带内（治「顶出去→吸回」跳动）
  assert.equal(isAtBottom(1000, 780, 200), true) // 距底 20
  // 内容不足一屏恒为贴底
  assert.equal(isAtBottom(100, 0, 200), true)
})

test('archiveScrollPosition 用离开时跟随态记 atBottom（修切回位置错）', () => {
  // 跟随中离开：atBottom=true，滚动位置无意义（恢复时忽略）
  assert.deepEqual(archiveScrollPosition(761, true), { scrollTop: 761, atBottom: true })
  // 滚离底部（跟随态已置 false）：记当时位置，恢复时回去
  assert.deepEqual(archiveScrollPosition(761, false), { scrollTop: 761, atBottom: false })
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

test('archiveScrollPosition 带视口锚：有锚记锚、无锚不写空字段', () => {
  assert.deepEqual(archiveScrollPosition(761, false, { key: 'msg:m3', offset: -12 }), {
    scrollTop: 761,
    atBottom: false,
    anchor: { key: 'msg:m3', offset: -12 },
  })
  // null/缺省都不写 anchor 键（贴底存档与空会话存档保持原形）。
  assert.deepEqual(archiveScrollPosition(761, false, null), { scrollTop: 761, atBottom: false })
})

test('anchoredScrollTop 让锚行回到原来的屏幕位置（内容增长后不漂移）', () => {
  // 存档：msg:m3 行顶在视口上方 12px 处（负偏移），当时 scrollTop=500。
  const anchor = { key: 'msg:m3', offset: -12 }
  // 切回后重建容器 scrollTop=0，该行落在视口下方 900px → 要滚到 912 才回到原位。
  assert.equal(anchoredScrollTop(0, 900, anchor), 912)
  // 换会话保留的容器位置非 0 时同样按位移换算（不只是「行位置」）。
  assert.equal(anchoredScrollTop(100, 900, anchor), 1012)
  // 内容收缩到锚行在视口上方了：目标为负 → 钳到 0（滚过头的边界）。
  assert.equal(anchoredScrollTop(0, -40, anchor), 0)
  // 锚行正好与当时位置一致（offset 相同）：目标不动。
  assert.equal(anchoredScrollTop(300, -12, anchor), 300)
})

test('isScrollKey 识别会滚动容器的按键', () => {
  for (const key of ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']) {
    assert.equal(isScrollKey(key), true, key)
  }
  for (const key of ['Enter', 'Escape', 'a', 'Tab', 'ArrowLeft', 'ArrowRight']) {
    assert.equal(isScrollKey(key), false, key)
  }
})

test('isReaderMoved 位移 >0.5px 判为用户滚动（对齐官方 movedByReader）', () => {
  // observedTop=800, floor=1000 → min=800。实际滚到 785 位移 15 → 用户动
  assert.equal(isReaderMoved(785, 800, 1000), true)
  // 位移 ≤0.5 不判用户（程序自回声 / clamp / 内容增长）
  assert.equal(isReaderMoved(800, 800, 1000), false)
  assert.equal(isReaderMoved(800.4, 800, 1000), false)
  assert.equal(isReaderMoved(799.6, 800, 1000), false)
})

test('isReaderMoved 用 min(observedTop, floor) 对冲内容收缩 clamp', () => {
  // 内容收缩后 floor 变小，observedTop 超出 floor → min 取 floor；clamp 后 scrollTop=floor
  // → 位移 0 → 不误判为用户滚动
  assert.equal(isReaderMoved(400, 500, 400), false)
  // 用户真实滚到 300（<floor）→ 位移 100 → 用户动
  assert.equal(isReaderMoved(300, 500, 400), true)
})

test('isReaderMoved observedTop 为 0（顶部）时不误判', () => {
  // observedTop=0, floor=1000 → min=0。scrollTop=0 位移 0 → 非用户
  assert.equal(isReaderMoved(0, 0, 1000), false)
  // scrollTop=10 → 位移 10 → 用户动
  assert.equal(isReaderMoved(10, 0, 1000), true)
})

test('nextStickToBottom 用户滚动按是否在贴底带内重判', () => {
  // 用户滚到底（贴底带内）→ 进入跟随
  assert.equal(nextStickToBottom(false, true, true), true)
  // 用户滚离 → 停跟随
  assert.equal(nextStickToBottom(true, true, false), false)
})

test('nextStickToBottom 非用户滚动维持现态（程序 pin 不误置 false）', () => {
  // 程序自回声 / 内容 clamp（movedByReader=false）→ 维持现态，绝不主动置 false
  assert.equal(nextStickToBottom(true, false, true), true)
  assert.equal(nextStickToBottom(true, false, false), true)
  assert.equal(nextStickToBottom(false, false, true), false)
  assert.equal(nextStickToBottom(false, false, false), false)
})

test('shouldPinNow 跟随态 + 未贴底才写 scrollTop', () => {
  // 两条件同时满足：贴底跟随重滚底
  assert.equal(shouldPinNow(true, false), true)
})

test('shouldPinNow 已贴底幂等跳过', () => {
  // 跟随态但实际已贴底（内容不足一屏 / 已 pin 到位）→ 不写
  assert.equal(shouldPinNow(true, true), false)
})

test('shouldPinNow 非跟随态（用户已滚离读历史）决不写', () => {
  assert.equal(shouldPinNow(false, false), false)
  assert.equal(shouldPinNow(false, true), false)
})

test('SETTLE_IDLE_MS 是滚动空闲判定窗口（约 120ms，保留回归动画守卫）', () => {
  assert.equal(SETTLE_IDLE_MS, 120)
})

test('shouldSettlePinNow 滚动空闲且满足 shouldPinNow 才写（迭代 3）', () => {
  // 滚动真正停（scrollActive=false）+ 跟随 + 未贴底 → 写
  assert.equal(shouldSettlePinNow(true, false, false), true)
})

test('shouldSettlePinNow 滚动活动（回归动画）期间决不写', () => {
  // 回归动画期间 scroll 事件持续到达 → scrollActive=true，即使其它条件满足也禁止写
  assert.equal(shouldSettlePinNow(true, false, true), false)
})

test('shouldSettlePinNow 滚动活动优先于其它条件（无论贴底）', () => {
  assert.equal(shouldSettlePinNow(true, true, true), false)
})

test('shouldSettlePinNow 非跟随态（读历史）即使滚动停也不写', () => {
  assert.equal(shouldSettlePinNow(false, false, false), false)
})

test('forwarded wheel: inner scroller keeps its own scroll until an end is reached', () => {
  // 内层还能向上滚（不在顶）：不转发
  assert.equal(forwardedWheelDelta(-100, 40, 160, 900), null)
  // 内层还能向下滚（不在底）：不转发
  assert.equal(forwardedWheelDelta(100, 40, 160, 900), null)
})

test('forwarded wheel: at the top/bottom the delta goes to the outer scroller', () => {
  assert.equal(forwardedWheelDelta(-100, 0, 160, 900), -100)
  assert.equal(forwardedWheelDelta(100, 740, 160, 900), 100)
  // 1px 容差内的「贴底」同样算到底
  assert.equal(forwardedWheelDelta(100, 739, 160, 900), 100)
})

test('forwarded wheel: a non-scrolling composer forwards both directions', () => {
  assert.equal(forwardedWheelDelta(-50, 0, 160, 160), -50)
  assert.equal(forwardedWheelDelta(50, 0, 160, 160), 50)
})

test('forwarded wheel: zero delta is never forwarded', () => {
  assert.equal(forwardedWheelDelta(0, 0, 160, 900), null)
})
