/**
 * dsh >= 0.1.3 Assistant 实时流（`session/follow` 的 `assistantStream: true`
 * opt-in 侧信道）到会话折叠事件流的翻译。
 *
 * 0.1.3 把 assistant 增量从持久化事件（0.1.2 的 `assistant/chunk` + `chunkrow/*`
 * 打包记录）移到进程本地「presentation」帧：跟随连接在 snapshot 后交织下发
 * `{type:'assistant-stream', frame}`（start → chunk* → end），末端带
 * committed/abandoned outcome，由端上的 `assistant/message` 或
 * `assistant/attempt` 结算。不传 `assistantStream: true` 的旧客户端能跑，
 * 但文本在每个 attempt 落盘前完全不出现（转圈→整段蹦出）。
 *
 * 本模块把 0.1.3 的 presentation 帧重新翻译回折叠层认识的 `assistant/chunk`
 * 事件（行词汇沿用 0.1.2 的 text-chunks/reasoning-chunks/tool-call-chunks，
 * 但行内无 seq），让既有的 ConversationFolder 增量折叠照常工作。
 * 纯逻辑——不 import `vscode`。
 */

import type { SessionEventLike, StreamChunkData } from './conversation.ts'

/** 0.1.3 `session/follow` snapshot 的 `assistantStream` 基线（进程本地 attempt 前缀）。 */
export interface AssistantStreamBaseline {
  readonly revision: number
  readonly activeAttempt?: {
    readonly attemptId: string
    readonly startedAfterSeq: number
    readonly turn: number
    readonly step: number
    readonly nextIndex: number
    readonly stream: readonly unknown[]
  }
}

/** `session/follow` 交织下发的 `assistant-stream` 帧（0.1.3 侧信道）。 */
export type AssistantStreamFrame =
  | { readonly type: 'start'; readonly attemptId: string; readonly revision: number; readonly startedAfterSeq: number; readonly turn: number; readonly step: number }
  | { readonly type: 'chunk'; readonly attemptId: string; readonly revision: number; readonly index: number; readonly time: number; readonly chunk: StreamChunkData }
  | {
      readonly type: 'end'
      readonly attemptId: string
      readonly revision: number
      readonly index: number
      readonly outcome:
        | { readonly kind: 'committed'; readonly eventType: 'assistant/message' | 'assistant/attempt'; readonly seq: number }
        | { readonly kind: 'abandoned' }
    }

interface ActiveAttempt {
  readonly attemptId: string
  readonly turn: number
  readonly step: number
  nextIndex: number
}

/** 一个紧凑流记录，展开成带时间戳的 chunk 增量。 */
export interface TimedChunk {
  readonly chunk: StreamChunkData
  readonly time: number
}

/**
 * 展开 0.1.3 的紧凑 attempt 流（`assistant/message`/`assistant/attempt` 的
 * `data.stream`、snapshot 基线的 `activeAttempt.stream`）回原始 chunk 增量。
 * 记录形状对齐上游 `@deepseek-ai/dsh-llm/assistant-stream` 的
 * `AssistantStreamRecord`（text-chunks / reasoning-chunks / tool-call-chunks /
 * chunk）。字段不改名；无法识别的记录整条跳过（不崩溃）。
 */
export function expandAssistantStream(stream: readonly unknown[]): TimedChunk[] {
  const out: TimedChunk[] = []
  for (const candidate of stream) {
    if (typeof candidate !== 'object' || candidate === null) continue
    const rec = candidate as Record<string, unknown>
    const time0 = typeof rec.time0 === 'number' ? rec.time0 : 0
    const index = typeof rec.index === 'number' ? rec.index : 0
    if (rec.type === 'text-chunks' || rec.type === 'reasoning-chunks') {
      const texts = Array.isArray(rec.texts) ? (rec.texts as unknown[]).filter((t): t is string => typeof t === 'string') : []
      const dt = Array.isArray(rec.dt) ? (rec.dt as unknown[]) : []
      let time = time0
      for (let i = 0; i < texts.length; i += 1) {
        if (i > 0) time += typeof dt[i - 1] === 'number' ? (dt[i - 1] as number) : 0
        out.push({
          chunk: { type: rec.type === 'text-chunks' ? 'text-delta' : 'reasoning-delta', index, text: texts[i] },
          time,
        })
      }
    } else if (rec.type === 'tool-call-chunks') {
      const args = Array.isArray(rec.args) ? (rec.args as unknown[]).filter((a): a is string => typeof a === 'string') : []
      const dt = Array.isArray(rec.dt) ? (rec.dt as unknown[]) : []
      const id = typeof rec.id === 'string' ? rec.id : ''
      let time = time0
      for (let i = 0; i < args.length; i += 1) {
        if (i > 0) time += typeof dt[i - 1] === 'number' ? (dt[i - 1] as number) : 0
        out.push({
          chunk: {
            type: 'tool-call-delta',
            index,
            id,
            ...(typeof rec.name === 'string' && rec.name ? { name: rec.name } : {}),
            argumentsDelta: args[i],
          },
          time,
        })
      }
    } else if (rec.type === 'chunk' && typeof rec.chunk === 'object' && rec.chunk !== null) {
      out.push({ chunk: rec.chunk as StreamChunkData, time: typeof rec.time === 'number' ? (rec.time as number) : time0 })
    }
  }
  return out
}

/** 一个带合成 seq 的 `assistant/chunk` 事件（行内无 seq 是 0.1.3 的语义）。 */
function chunkEvent(attempt: ActiveAttempt, timed: TimedChunk, seq: number): SessionEventLike {
  return {
    type: 'assistant/chunk',
    seq,
    time: timed.time,
    data: { turn: attempt.turn, step: attempt.step, chunk: timed.chunk },
  }
}

/**
 * 把 0.1.3 的 presentation 帧折叠成 `assistant/chunk` 事件序列。
 * 只跟踪单个在跑的 attempt；索引不连续、attempt 不匹配时静默跳过（罕见 gap），
 * 结算交给随后的 `assistant/message`/`assistant/attempt`。
 */
export class AssistantStreamFold {
  private active: ActiveAttempt | undefined
  /** 已折叠的最大 durable seq，合成 chunk seq 落在其与下一整数之间。 */
  private durableCursor = -1
  private transientInGap = 0

  /** 记录一条 durable 事件到达（重设 transient 计数，避免合成 seq 越界）。 */
  noteDurableSeq(seq: number): void {
    if (seq > this.durableCursor) this.durableCursor = seq
    this.transientInGap = 0
  }

  /** 用 follow snapshot 基线重建（重连/首次打开）；返回要折叠的前置 chunk 事件。 */
  replace(baseline: AssistantStreamBaseline | undefined): SessionEventLike[] {
    this.active = undefined
    this.transientInGap = 0
    const a = baseline?.activeAttempt
    if (a === undefined) return []
    this.active = { attemptId: a.attemptId, turn: a.turn, step: a.step, nextIndex: a.nextIndex }
    const out: SessionEventLike[] = []
    const chunks = expandAssistantStream(a.stream)
    for (let i = 0; i < chunks.length && i < a.nextIndex; i += 1) {
      this.transientInGap += 1
      out.push(chunkEvent(this.active, chunks[i], this.syntheticSeq()))
    }
    return out
  }

  /** 折叠一帧；返回要折叠的 `assistant/chunk` 事件（可能为空）。 */
  acceptFrame(frame: AssistantStreamFrame): SessionEventLike[] {
    switch (frame.type) {
      case 'start': {
        // 已在跑的新 start（原 attempt 未 end）：直接作废旧 attempt 换成新的。
        this.active = { attemptId: frame.attemptId, turn: frame.turn, step: frame.step, nextIndex: 0 }
        return []
      }
      case 'chunk': {
        const a = this.active
        if (a === undefined || a.attemptId !== frame.attemptId || frame.index !== a.nextIndex) return []
        a.nextIndex += 1
        this.transientInGap += 1
        return [chunkEvent(a, { chunk: frame.chunk, time: frame.time }, this.syntheticSeq())]
      }
      case 'end':
        if (this.active !== undefined && this.active.attemptId === frame.attemptId) this.active = undefined
        return []
    }
  }

  private syntheticSeq(): number {
    return this.durableCursor + 1 - 1 / (this.transientInGap + 1)
  }
}
