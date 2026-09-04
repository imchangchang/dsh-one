/**
 * Parse the readiness line printed by `dsh web` on stdout,
 * e.g. `dsh web: http://127.0.0.1:3080`.
 * dsh >= 0.1.2-rc.1 prints the URL with the per-process launch token
 * (`?token=...`); the token is the only way to mint an auth cookie, so the
 * parser captures it separately from the clean URL.
 * Pure logic — no `vscode` import.
 */

export interface ReadyInfo {
  url: string
  port: number
  /** Per-process launch token from the `?token=` query, when the build prints one. */
  token?: string
}

const READY_RE = /dsh web: (http:\/\/127\.0\.0\.1:(\d+)(?:\/[^\s?]*)?)(?:\?token=([A-Za-z0-9_-]+))?/

/** Extract the URL/port/token from a chunk of dsh stdout. Returns null when absent. */
export function parseReadyLine(chunk: string): ReadyInfo | null {
  const m = READY_RE.exec(chunk)
  if (!m) return null
  return {
    url: m[1],
    port: Number(m[2]),
    ...(m[3] !== undefined ? { token: m[3] } : {}),
  }
}

/** Strip a token query from a URL for display/logging; never leaks the token. */
export function sanitizeReadyUrl(url: string): string {
  return url.replace(/([?&])token=[A-Za-z0-9_-]+/g, '$1token=***')
}
