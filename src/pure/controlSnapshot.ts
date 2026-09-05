/**
 * 共享 `session/control` 流的合并快照：baseline 帧只在逻辑流创建时由服务端
 * 推给当时的订阅者，晚订阅者（如会话切换/服务重启后重建的 ChatSessionController）
 * 收不到当前状态，只接收后续增量帧——排队消息/任务/投影就此丢失。本模块在
 * 共享流单例里缓存「baseline 各域 + 后续增量帧」合并后的完整视图，晚订阅者
 * 注册时用它合成 baseline 帧重放。
 *
 * 合并语义与消费端（chatSession.ts / jobsStore.ts）一致：
 * - baseline 帧：只替换帧里**存在**的域（缺失域保留原值——消费端对缺失域
 *   本来就跳过，语义对齐）；
 * - queue / jobs 帧：按会话整体替换（消费端 whole-snapshot replacement）；
 * - projection 帧：按 key 合并（seq 取 max，消费端以 seq 守卫）。
 *
 * Pure logic — no `vscode` import.
 */
import type { ControlStreamFrame } from './remoteFrames.ts'

/** Control 流三域的合并视图（键结构与 baseline 帧同形）。 */
export interface ControlSnapshot {
  queues: Record<string, unknown[]>
  jobs: Record<string, unknown[]>
  projections: Record<string, { asOfSeq: number; values: Record<string, unknown> }>
}

/** 空快照（尚未收到任何帧时晚订阅者无内容可重放）。 */
export function createControlSnapshot(): ControlSnapshot {
  return { queues: {}, jobs: {}, projections: {} }
}

/** 把一帧合并进快照（原地修改并返回，便于链式/单测）。 */
export function applyControlFrame(snapshot: ControlSnapshot, frame: ControlStreamFrame): ControlSnapshot {
  if (frame.type === 'baseline') {
    const value = frame.value
    if (typeof value.queues === 'object' && value.queues !== null) {
      snapshot.queues = value.queues as Record<string, unknown[]>
    }
    if (typeof value.jobs === 'object' && value.jobs !== null) {
      snapshot.jobs = value.jobs as Record<string, unknown[]>
    }
    if (typeof value.projections === 'object' && value.projections !== null) {
      const raw = value.projections as Record<string, { asOfSeq?: number; values?: Record<string, unknown> }>
      const projections: ControlSnapshot['projections'] = {}
      for (const [sessionId, entry] of Object.entries(raw)) {
        projections[sessionId] = {
          asOfSeq: typeof entry.asOfSeq === 'number' ? entry.asOfSeq : -1,
          values: (entry.values ?? {}) as Record<string, unknown>,
        }
      }
      snapshot.projections = projections
    }
    return snapshot
  }
  if (frame.type === 'queue') {
    snapshot.queues[frame.sessionId] = frame.items
    return snapshot
  }
  if (frame.type === 'jobs') {
    snapshot.jobs[frame.sessionId] = frame.jobs
    return snapshot
  }
  // projection 增量：按 key 覆盖，asOfSeq 取 max（重放后真实增量 seq 更大，
  // 消费端的 `seq <= xxxSeq` 守卫不会误挡）。
  const entry = snapshot.projections[frame.sessionId] ?? { asOfSeq: -1, values: {} }
  entry.values[frame.key] = frame.value
  if (frame.seq > entry.asOfSeq) entry.asOfSeq = frame.seq
  snapshot.projections[frame.sessionId] = entry
  return snapshot
}

/**
 * 把合并快照重放成合成 baseline 帧；快照为空（尚未收到任何帧）时返回 null。
 * 只带**非空**域——消费端对缺失域本就跳过，不传空对象也不丢语义。
 * 浅拷贝：重放帧与单例快照解耦，消费端改写不会污染共享缓存。
 */
export function replayControlSnapshot(snapshot: ControlSnapshot): ControlStreamFrame | null {
  const value: Record<string, unknown> = {}
  if (Object.keys(snapshot.queues).length > 0) value.queues = { ...snapshot.queues }
  if (Object.keys(snapshot.jobs).length > 0) value.jobs = { ...snapshot.jobs }
  if (Object.keys(snapshot.projections).length > 0) value.projections = { ...snapshot.projections }
  return Object.keys(value).length === 0 ? null : { type: 'baseline', value }
}
