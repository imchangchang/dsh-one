import * as fs from 'node:fs/promises'
import * as path from 'node:path'

// Pure module convention: Node builtins only, no vscode imports — must stay
// runnable under plain `node --test`.

/**
 * Total size in bytes of all files under `root`; 0 when the directory does not
 * exist. Best-effort: entries that vanish mid-walk (a concurrent npm install
 * is constantly mutating the tree) are skipped instead of failing the walk.
 */
export async function dirSize(root: string): Promise<number> {
  let entries
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return 0
  }
  let total = 0
  for (const entry of entries) {
    const p = path.join(root, entry.name)
    if (entry.isDirectory()) {
      total += await dirSize(p)
    } else if (entry.isFile()) {
      try {
        total += (await fs.stat(p)).size
      } catch {
        // vanished between readdir and stat — skip
      }
    }
  }
  return total
}
