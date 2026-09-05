import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isScheduleOverdue,
  orderScheduleRecords,
  scheduleEveryUnit,
  scheduleRelativeDelta,
} from '../src/pure/schedule.ts'
import type { ChatScheduleEntry } from '../src/pure/chatContract.ts'

const NOW = Date.parse('2026-09-11T12:00:00.000Z')

function record(partial: Partial<ChatScheduleEntry> & { id: string }): ChatScheduleEntry {
  return {
    kind: 'at',
    scheduledAt: '2026-09-11T12:00:00.000Z',
    prompt: `reminder ${partial.id}`,
    ...partial,
  }
}

test('schedule every 频率：取能整除的最大单位（90 秒不被 60 整除 → 秒档）', () => {
  assert.deepEqual(scheduleEveryUnit(86_400), { unit: 'day', value: 1 })
  assert.deepEqual(scheduleEveryUnit(172_800), { unit: 'day', value: 2 })
  assert.deepEqual(scheduleEveryUnit(7_200), { unit: 'hour', value: 2 })
  assert.deepEqual(scheduleEveryUnit(300), { unit: 'minute', value: 5 })
  assert.deepEqual(scheduleEveryUnit(90), { unit: 'second', value: 90 })
  assert.deepEqual(scheduleEveryUnit(45), { unit: 'second', value: 45 })
  assert.deepEqual(scheduleEveryUnit(60 * 60 * 24 * 3 + 1), { unit: 'second', value: 259_201 })
})

test('schedule 相对量：未来向上取整（带符号正）、逾期向下取整（带符号负）、现在=0', () => {
  assert.deepEqual(scheduleRelativeDelta('2026-09-12T12:00:00.000Z', NOW), { unit: 'day', value: 1 })
  assert.deepEqual(scheduleRelativeDelta('2026-09-10T12:00:00.000Z', NOW), { unit: 'day', value: -1 })
  // 边界：整秒整分钟整小时各取对应最大单位。
  assert.deepEqual(scheduleRelativeDelta('2026-09-11T13:00:00.000Z', NOW), { unit: 'hour', value: 1 })
  assert.deepEqual(scheduleRelativeDelta('2026-09-11T12:01:00.000Z', NOW), { unit: 'minute', value: 1 })
  // 51 秒 → 秒档（官方取「容纳得下」的最大单位，不跨级进分钟）；
  // 100 秒（>1 分钟）→ 分钟档 2 分钟（未来向上取整）；100 秒前过期 → 分钟档 -1。
  assert.deepEqual(scheduleRelativeDelta('2026-09-11T12:00:51.000Z', NOW), { unit: 'second', value: 51 })
  assert.deepEqual(scheduleRelativeDelta('2026-09-11T12:01:40.000Z', NOW), { unit: 'minute', value: 2 })
  assert.deepEqual(scheduleRelativeDelta('2026-09-11T11:58:20.000Z', NOW), { unit: 'minute', value: -1 })
  // 恰好现在到期。
  assert.deepEqual(scheduleRelativeDelta('2026-09-11T12:00:00.000Z', NOW), { unit: 'second', value: 0 })
})

test('schedule 逾期判定：目标时刻 <= now 即逾期', () => {
  assert.equal(isScheduleOverdue(record({ id: 'o1', scheduledAt: '2026-09-11T12:00:00.000Z' }), NOW), true)
  assert.equal(isScheduleOverdue(record({ id: 'o2', scheduledAt: '2026-09-11T11:59:59.999Z' }), NOW), true)
  assert.equal(isScheduleOverdue(record({ id: 'o3', scheduledAt: '2026-09-11T12:00:00.001Z' }), NOW), false)
})

test('schedule 行序：逾期在前（按目标时刻升序），其后 scheduled 升序，同刻保序', () => {
  const a = record({ id: 'a', scheduledAt: '2026-09-11T12:01:00.000Z' })
  const b = record({ id: 'b', scheduledAt: '2026-09-11T12:00:00.000Z' })
  const c = record({ id: 'c', scheduledAt: '2026-09-11T10:00:00.000Z' })
  const d = record({ id: 'd', scheduledAt: '2026-09-11T12:02:00.000Z' })
  const e = record({ id: 'e', scheduledAt: '2026-09-11T12:02:00.000Z' })
  const ordered = orderScheduleRecords([a, b, c, d, e], NOW).map((r) => r.id)
  // c（逾期）→ b（恰好到期，逾期）→ a → d → e（同刻保持原相对顺序）。
  assert.deepEqual(ordered, ['c', 'b', 'a', 'd', 'e'])
})
