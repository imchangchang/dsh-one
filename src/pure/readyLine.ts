/**
 * Parse the readiness line printed by `dsh web` on stdout,
 * e.g. `dsh web: http://127.0.0.1:3080`.
 * Pure logic — no `vscode` import.
 */

export interface ReadyInfo {
  url: string
  port: number
}

const READY_RE = /dsh web: (http:\/\/127\.0\.0\.1:(\d+))/

/** Extract the URL/port from a chunk of dsh stdout. Returns null when absent. */
export function parseReadyLine(chunk: string): ReadyInfo | null {
  const m = READY_RE.exec(chunk)
  if (!m) return null
  return { url: m[1], port: Number(m[2]) }
}
