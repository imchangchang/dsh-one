/**
 * Pending steering 气泡与 durable 消息流按 seq 交叉插排的纯判定。
 *
 * 背景（#42 治 A）：宿主 queue 快照不保证 send order，且 pending steering 气泡此前
 * 被「无条件尾置」。为了让先发的插话不再排到后发消息之后，给 queue 项在 chatSession
 * 侧派发一个与消息 seq 同序空间的合成序号（QueuedItem.seq），此处按它把 pending
 * 气泡插到消息流里「它应当出现的位置」（对齐官方 durable 节点按 anchorSeq 排序语义）。
 *
 * 规则：
 * - messages 已按 seq 升序（conversation.ts「消息按 seq 升序折叠」）。
 * - 无 seq 的流式消息 = 正在生长的尾部（它只会是最后一条），插话总在其后，不往它前面插。
 * - 有 seq 的消息：在它前面插入所有 seq 严格小于它的 steering；seq 相等（插话恰在某
 *   消息折叠的同一水位出现）视为「之后」，不往它前面插——插话按发送时间总在新消息之后。
 * - 遍历完消息后剩余（比所有消息都新）的 steering 补到流末。
 */

/** 一条可插排的 pending steering（只关心参与排序的字段）。 */
export interface SteeringOrderItem {
  id: string
  seq?: number
}

/** 一条 durable 消息（只关心 seq；无 seq = 流式尾部）。 */
export interface SteeringOrderMessage {
  id: string
  seq?: number
}

/** 插排结果：既可能是消息，也可能是 pending steering 气泡。 */
export type FlowOrderEntry<M extends SteeringOrderMessage, S extends SteeringOrderItem> =
  | { kind: 'message'; message: M }
  | { kind: 'steer'; steer: S }

/**
 * 按 seq 稳定排序（升序；无 seq 排尾，保持相对顺序）。interleaveSteering 与
 * queue dock 的消费前提是「数组按 seq 升序」，host 快照/基线下发不保证该序，
 * 消费侧先过一次这里兜底（正常已升序输入下为 no-op）。
 */
export function orderBySeq<T extends { seq?: number }>(items: readonly T[]): T[] {
  return items.slice().sort((a, b) => (a.seq ?? Number.MAX_SAFE_INTEGER) - (b.seq ?? Number.MAX_SAFE_INTEGER))
}

/** 把 pending steering 按发送时间插排进已按 seq 升序的消息流。 */
export function interleaveSteering<M extends SteeringOrderMessage, S extends SteeringOrderItem>(
  messages: readonly M[],
  steers: readonly S[],
): FlowOrderEntry<M, S>[] {
  const out: FlowOrderEntry<M, S>[] = []
  // 已排序（seq 升序；无 seq 排最后）。没 seq 的交给调用方处理语义，这里兜底排尾。
  const sorted = steers.slice().sort((a, b) => (a.seq ?? Number.MAX_SAFE_INTEGER) - (b.seq ?? Number.MAX_SAFE_INTEGER))
  let si = 0
  for (const message of messages) {
    if (typeof message.seq === 'number') {
      while (si < sorted.length && (sorted[si].seq ?? Number.MAX_SAFE_INTEGER) < message.seq) {
        out.push({ kind: 'steer', steer: sorted[si] })
        si += 1
      }
    }
    out.push({ kind: 'message', message })
  }
  while (si < sorted.length) {
    out.push({ kind: 'steer', steer: sorted[si] })
    si += 1
  }
  return out
}

/** 一次插话（steer）的收敛态错误码：官方 steerQueue 遇到它们就地收手、静默。 */
export const STEER_CONVERGED_CODES = ['session/steer-unavailable', 'session/queue-item-not-found'] as const

/**
 * 逐条插话遇到的错误是不是「正常竞态」而非真失败：
 * - `session/steer-unavailable`：回合在这次批量插话中途关掉了（后面的行无处可插）；
 * - `session/queue-item-not-found`：那一行已被 agent 领走（排队消息落地成真消息）。
 * 两者都只说明「不用再插了」，不是错误（官方 steerQueue 同款判定，重复按
 * ⌘/Ctrl+Enter 也靠它收敛）。
 */
export function steerConverged(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error)
  return STEER_CONVERGED_CODES.some((code) => text.includes(code))
}
