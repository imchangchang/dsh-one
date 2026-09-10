/**
 * 共享 `session/control` 流的合并快照：baseline 帧只在逻辑流创建时由服务端
 * 推给当时的订阅者，晚订阅者（如会话切换/服务重启后重建的 ChatSessionController）
 * 收不到当前状态，只接收后续增量帧——排队消息/任务/投影就此丢失。本模块在
 * 共享流单例里缓存「baseline 各域 + 后续增量帧」合并后的完整视图，晚订阅者
 * 注册时用它合成 baseline 帧重放。
 *
 * 合并语义与消费端（chatSession.ts / jobsStore.ts）一致，并按**缺席键清空**
 * 收敛（对齐官方 web 客户端 dsh-client-connection 的 replaceControlBaseline：
 * 先 queues.clear() / jobsBySession.clear()，再按 baseline 重建）：
 * - baseline 帧：整域替换。baseline 是全域快照（官方 host 的 baseline() 逐会话
 *   给 queues/jobs/projections），域缺失 = 该域为空、会话键缺失 = 该会话无内容
 *   ——旧实现只替换「存在的域」，缺席的排队消息/后台任务/投影键会永久滞留成幽灵；
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

/** 域值收敛成记录；非对象（缺失/畸形）按空域——baseline 缺席即无内容。 */
function asDomain(value: unknown): Record<string, unknown[]> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown[]>) : {}
}

/** projections 域收敛：逐会话归一 asOfSeq/values，数值缺失按 -1。 */
function asProjections(value: unknown): ControlSnapshot['projections'] {
  const out: ControlSnapshot['projections'] = {}
  if (typeof value !== 'object' || value === null) return out
  for (const [sessionId, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as { asOfSeq?: unknown; values?: unknown }
    out[sessionId] = {
      asOfSeq: typeof e.asOfSeq === 'number' ? e.asOfSeq : -1,
      values: (typeof e.values === 'object' && e.values !== null ? e.values : {}) as Record<string, unknown>,
    }
  }
  return out
}

/** 把一帧合并进快照（原地修改并返回，便于链式/单测）。 */
export function applyControlFrame(snapshot: ControlSnapshot, frame: ControlStreamFrame): ControlSnapshot {
  if (frame.type === 'baseline') {
    const value = frame.value
    // 整域替换：baseline 是权威全域快照，缺席键必须清掉（见文件头注释）。
    snapshot.queues = asDomain(value.queues)
    snapshot.jobs = asDomain(value.jobs)
    snapshot.projections = asProjections(value.projections)
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
 * 把合并快照重放成合成 baseline 帧；快照全空（尚未收到任何帧）时返回 null。
 * 非空时**域一定带全**（空域传空对象）：消费端按「缺席=无内容」清空，缺域
 * 与空域必须同义，否则晚订阅者拿到的重放帧会被当成「无信息」而留下幽灵旧值。
 * 浅拷贝：重放帧与单例快照解耦，消费端改写不会污染共享缓存。
 */
export function replayControlSnapshot(snapshot: ControlSnapshot): ControlStreamFrame | null {
  const empty =
    Object.keys(snapshot.queues).length === 0 &&
    Object.keys(snapshot.jobs).length === 0 &&
    Object.keys(snapshot.projections).length === 0
  if (empty) return null
  return {
    type: 'baseline',
    value: {
      queues: { ...snapshot.queues },
      jobs: { ...snapshot.jobs },
      projections: { ...snapshot.projections },
    },
  }
}
