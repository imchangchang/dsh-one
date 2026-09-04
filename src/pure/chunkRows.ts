/**
 * dsh >= 0.1.2 history transport expands packed Assistant delta runs
 * (SessionChunkRun records: `chunkrow/text-chunks` / `reasoning-chunks` /
 * `tool-call-chunks`) back into the exact original `assistant/chunk` events —
 * the shape the legacy dsh host streamed and the extension folder folds.
 * Pure logic — no `vscode` import.
 */

import type { HistoryEntryLike, SessionEventLike } from './conversation.ts'

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

/** Narrow one history page/follow record to the entry list the folder folds. */
export function recordsToEntries(records: readonly HistoryRecordLike[]): HistoryEntryLike[] {
  const entries: HistoryEntryLike[] = []
  for (const record of records) {
    if (record.type === 'event') {
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
