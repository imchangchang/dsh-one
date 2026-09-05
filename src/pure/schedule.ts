/**
 * 定时计划（`schedule` 投影）的纯计算：行序、`every` 频率的单位分解、
 * 剩余/逾期的相对量——与官方 dsh web ScheduleCatalogAction 的
 * formatScheduleFrequency / formatScheduleRelative / orderScheduleRecords
 * 同语义（数值部分抽出纯函数，本地化文案留给调用方）。
 */
import type { ChatScheduleEntry } from './chatContract.ts'

export type ScheduleTimeUnit = 'day' | 'hour' | 'minute' | 'second'

/** 从大到小的时间单位（官方 UNIT_SECONDS；选择用第一个整除的最大单位）。 */
export const SCHEDULE_UNIT_SECONDS: ReadonlyArray<Readonly<{ unit: ScheduleTimeUnit; seconds: number }>> = [
  { unit: 'day', seconds: 86_400 },
  { unit: 'hour', seconds: 3_600 },
  { unit: 'minute', seconds: 60 },
  { unit: 'second', seconds: 1 },
]

/**
 * `every` 记录的频率分解：取能整除 everySeconds 的最大单位，得到
 * {unit, value}（官方 formatScheduleFrequency 的数值部分）。任意正整数
 * 都能被 1 整除，所以总有 SECOND 兜底，value ≥ 1。
 */
export function scheduleEveryUnit(
  everySeconds: number,
): { unit: ScheduleTimeUnit; value: number } {
  for (const candidate of SCHEDULE_UNIT_SECONDS) {
    if (everySeconds % candidate.seconds !== 0) continue
    return { unit: candidate.unit, value: everySeconds / candidate.seconds }
  }
  return { unit: 'second', value: everySeconds }
}

/**
 * 距目标时刻的相对量（官方 formatScheduleRelative 的数值部分）：正数 =
 * 剩余（future），负数 = 已逾期（overdue），0 = 现在到期。单位取绝对值能
 * 容纳的最大单位；指定时刻的过期秒数整体取整（future 向上、overdue 向下，
 * 均为非零整数）——符号只在文案选择时使用，数值本身即相对量的量级。
 */
export function scheduleRelativeDelta(
  scheduledAt: string,
  now: number,
): { unit: ScheduleTimeUnit; value: number } {
  const difference = Date.parse(scheduledAt) - now
  if (difference === 0) return { unit: 'second', value: 0 }
  const absoluteMs = Math.abs(difference)
  const selected = SCHEDULE_UNIT_SECONDS.find((c) => absoluteMs >= c.seconds * 1000)
    ?? SCHEDULE_UNIT_SECONDS[SCHEDULE_UNIT_SECONDS.length - 1]
  const seconds = absoluteMs / 1000
  const rounded = difference > 0
    ? Math.ceil(seconds / selected.seconds)
    : Math.floor(seconds / selected.seconds)
  const magnitude = Math.max(1, rounded)
  return { unit: selected.unit, value: difference > 0 ? magnitude : -magnitude }
}

/**
 * 下拉行序（官方 orderScheduleRecords）：overdue 记录在前（都按
 * scheduledAt 升序），scheduled 按目标时刻升序；完全相同的时间保持原
 * 相对顺序（排序稳定）。
 */
export function orderScheduleRecords<T extends { scheduledAt: string }>(
  records: readonly T[],
  now: number,
): T[] {
  return records.map((record, index) => ({ record, index })).sort((left, right) => {
    const leftTime = Date.parse(left.record.scheduledAt)
    const rightTime = Date.parse(right.record.scheduledAt)
    const leftOverdue = leftTime <= now
    const rightOverdue = rightTime <= now
    if (leftOverdue !== rightOverdue) return Number(rightOverdue) - Number(leftOverdue)
    return leftTime - rightTime || left.index - right.index
  }).map(({ record }) => record)
}

/** 一条记录是否已逾期（官方判定：目标时刻 ≤ now）。 */
export function isScheduleOverdue(record: Pick<ChatScheduleEntry, 'scheduledAt'>, now: number): boolean {
  return Date.parse(record.scheduledAt) <= now
}
