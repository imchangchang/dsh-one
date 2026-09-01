/**
 * Produced-files row helper (official dsh web ProducedFiles parity): the
 * chip label presentation for turn-tail produced paths. Pure string ops —
 * no `vscode` import.
 */

/** Trailing path segment, the part that identifies the file at a glance
 * (slash- or backslash-separated; the whole string when separator-free). */
export function producedBasename(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}
