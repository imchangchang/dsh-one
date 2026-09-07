/**
 * dsh >= 0.1.2 history transport expands packed Assistant delta runs
 * (SessionChunkRun records: `chunkrow/text-chunks` / `reasoning-chunks` /
 * `tool-call-chunks`) back into the exact original `assistant/chunk` events —
 * the shape the legacy dsh host streamed and the extension folder folds.
 * Pure logic — no `vscode` import.
 */

import type { HistoryEntryLike, SessionEventLike, StreamChunkData } from './conversation.ts'
import { expandAssistantStream } from './assistantStream.ts'

/** The record union of a 0.1.2 history page/follow snapshot. */
export interface HistoryRecordLike {
  type: 'event' | 'chunks'
  event: SessionEventLike
}

/** Expand one packed chunk row into its individual assistant/chunk events. */
export function expandChunkRow(event: SessionEventLike): SessionEventLike[] | null {
  const data = event.data as Record<string, unknown> | undefined
  if (typeof data !== 'object' || data === null) return null
  const seq0 = event.seq
  const time0 = event.time ?? 0
  const turn = data.turn
  const step = data.step
  const index = data.index
  const dt = Array.isArray(data.dt) ? (data.dt as number[]) : []
  const timeAt = (i: number): number => {
    let t = time0
    for (let k = 0; k < i; k++) t += typeof dt[k] === 'number' ? dt[k] : 0
    return t
  }
  if (event.type === 'chunkrow/text-chunks' || event.type === 'chunkrow/reasoning-chunks') {
    const texts = Array.isArray(data.texts) ? (data.texts as string[]) : []
    const chunkType = event.type === 'chunkrow/text-chunks' ? 'text-delta' : 'reasoning-delta'
    return texts.map((text, i) => ({
      type: 'assistant/chunk',
      seq: seq0 + i,
      time: timeAt(i),
      data: {
        turn,
        step,
        chunk: { type: chunkType, index, text },
      },
    }))
  }
  if (event.type === 'chunkrow/tool-call-chunks') {
    const args = Array.isArray(data.args) ? (data.args as string[]) : []
    return args.map((argumentsDelta, i) => ({
      type: 'assistant/chunk',
      seq: seq0 + i,
      time: timeAt(i),
      data: {
        turn,
        step,
        chunk: {
          type: 'tool-call-delta',
          index,
          id: typeof data.id === 'string' ? data.id : '',
          ...(typeof data.name === 'string' ? { name: data.name } : {}),
          argumentsDelta,
        },
      },
    }))
  }
  return null
}

/**
 * 0.1.3 被中断 attempt 的结算事件（`assistant/attempt`）：data 只有 `stream`
 * 紧凑流、无 `message.content`，折叠层不认。展开成 `assistant/chunk` 让部分文案
 * 渲染出来（turn/end 的 aborted reason 再标记 interrupted/complete）。
 */
export function expandAssistantAttempt(event: SessionEventLike): SessionEventLike[] | null {
  const data = event.data as Record<string, unknown> | undefined
  if (typeof data !== 'object' || data === null) return null
  const stream = data.stream
  if (!Array.isArray(stream)) return null
  const turn = data.turn
  const step = data.step
  if (typeof turn !== 'number' || typeof step !== 'number') return null
  const chunks = expandAssistantStream(stream)
  if (chunks.length === 0) return null
  const n = chunks.length
  return chunks.map((c, i) => ({
    type: 'assistant/chunk' as const,
    seq: event.seq + (i + 1) / (n + 1),
    time: c.time,
    data: { turn, step, chunk: c.chunk as StreamChunkData },
  }))
}

/** Narrow one history page/follow record to the entry list the folder folds. */
export function recordsToEntries(records: readonly HistoryRecordLike[]): HistoryEntryLike[] {
  const entries: HistoryEntryLike[] = []
  for (const record of records) {
    if (record.type === 'event') {
      if (record.event.type === 'assistant/attempt') {
        const expanded = expandAssistantAttempt(record.event)
        if (expanded !== null) {
          for (const event of expanded) entries.push({ event })
          continue
        }
      }
      entries.push({ event: record.event })
      continue
    }
    const expanded = expandChunkRow(record.event)
    if (expanded !== null) {
      for (const event of expanded) entries.push({ event })
      continue
    }
    // Unknown packed shape: keep the raw row out of the message stream rather
    // than dropping the record silently — the folder treats it as log-only.
    entries.push({ event: record.event })
  }
  return entries
}
