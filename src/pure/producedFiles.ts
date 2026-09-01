/**
 * Produced-files row helpers (official dsh web ProducedFiles parity):
 * path presentation for the chips and the folder target of the
 * 「在 VSCode 中打开」button. Pure string ops — no `vscode` import.
 */

/** Trailing path segment, the part that identifies the file at a glance
 * (slash- or backslash-separated; the whole string when separator-free). */
export function producedBasename(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}

/**
 * The folder a turn's produced files live in: the deepest common directory of
 * every produced path (each path's parent), so a turn whose files all sit in
 * one working directory opens exactly that directory. Files whose parents do
 * not share any common directory (spread across unrelated roots, or bare
 * names with no parent) yield undefined — the button then hides.
 */
export function producedFolderOf(paths: readonly string[]): string | undefined {
  const parents = paths.map((p) => parentOf(p)).filter((p): p is string => p !== undefined)
  if (parents.length === 0) return undefined
  let common = parents[0]
  for (const parent of parents.slice(1)) {
    while (!isParentOf(common, parent)) {
      const up = parentOf(common)
      if (up === undefined) return undefined
      common = up
    }
  }
  return common
}

function parentOf(path: string): string | undefined {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (at <= 0) return undefined
  // Windows 盘根（C:\ 或 C:/）：把盘符和分隔符一起保留。
  if (at === 2 && path[1] === ':' && (path[2] === '/' || path[2] === '\\')) return path.slice(0, 3)
  return path.slice(0, at)
}

/** Whether `dir` equals `candidate` or is one of its ancestor directories. */
function isParentOf(dir: string, candidate: string): boolean {
  if (dir === candidate) return true
  if (!candidate.startsWith(dir)) return false
  // 根目录（/ 或盘根）是所有绝对路径的祖先；其余目录要求候选以分隔符续接。
  if (dir === '/' || (dir.length === 3 && dir[1] === ':')) return true
  const rest = candidate.slice(dir.length)
  return rest.startsWith('/') || rest.startsWith('\\')
}
