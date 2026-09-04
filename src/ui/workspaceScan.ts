/**
 * @ 补全的工作区候选扫描：会话 cwd 下浅层文件（顶层 + 一层子目录）的绝对路径。
 * 从 chatMessages.ts 拆出的独立模块（不引 vscode），node --test 可测。
 *
 * 性能策略（方案定案，2026-09-04）：lstat 替代 stat——不跟随 symlink，链接
 * 条目直接跳过；子目录数量上限 64；候选池按 cwd 缓存，以「已扫目录自身的
 * mtime」为指纹，失效时重扫——只 lstat 已扫目录本身（目录 mtime 在子项
 * 增删/改名时必变，覆盖工作区子项变更；文件内容变化不影响候选列表，无需
 * 重扫）；不用 fs.watch（跨平台递归不可靠、句柄难管）；query 过滤是候选池上
 * 的内存过滤；候选总数上限 200。webview 侧 250ms 防抖维持不变。
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { Stats } from 'node:fs'
import type { FileRefCandidate } from '../pure/fileReference.ts'

/** 排除的构建物/隐藏目录名（顶层目录不进候选池、也不下钻）。 */
export const WORKSPACE_EXCLUDED_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'out', 'build', 'coverage', '.next', '.idea', '.vscode', 'test-results',
])

/** 一层子目录扫描数量上限：只扫排序后前 64 个，绑定扫描成本并保持候选确定序。 */
export const MAX_WORKSPACE_SUBDIRS = 64

/** 候选总数上限（池与过滤结果均不超该值；webview 250ms 防抖不变）。 */
export const MAX_WORKSPACE_CANDIDATES = 200

interface WorkspaceCandidatePool {
  /** 指纹：已扫目录自身（cwd 在前，其后至多 64 个子目录）的 mtimeMs。
   *  任一项变化或缺失（目录被删/改名/移走）即失效重扫。 */
  fingerprint: Array<{ dir: string; mtimeMs: number }>
  /** 池内全部候选（绝对路径，≤MAX_WORKSPACE_CANDIDATES，按路径排序）。 */
  paths: string[]
}

/** 候选池按 cwd 缓存：同一工作区下 @ 补全反复触发时不重复全量扫描。 */
const poolCache = new Map<string, WorkspaceCandidatePool>()

/** 依次 lstat 目录取指纹；任一目录不可 stat（被删/改名/不可达）返回 null。 */
async function readFingerprint(dirs: string[]): Promise<Array<{ dir: string; mtimeMs: number }> | null> {
  const out: Array<{ dir: string; mtimeMs: number }> = []
  for (const dir of dirs) {
    try {
      out.push({ dir, mtimeMs: (await fs.lstat(dir)).mtimeMs })
    } catch {
      return null
    }
  }
  return out
}

function sameFingerprint(
  a: Array<{ dir: string; mtimeMs: number }>,
  b: Array<{ dir: string; mtimeMs: number }>,
): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].dir !== b[i].dir || a[i].mtimeMs !== b[i].mtimeMs) return false
  }
  return true
}

/** 扫一轮：cwd 顶层 + 一层子目录（排序后前 MAX_WORKSPACE_SUBDIRS 个）。
 *  lstat 判定类型（symlink 直接跳过），候选上限 MAX_WORKSPACE_CANDIDATES。
 *  cwd 不可 stat（被删/改名）返回 null，调用方应丢弃缓存。 */
async function scanPool(cwd: string): Promise<WorkspaceCandidatePool | null> {
  if (!(await fs.lstat(cwd).catch(() => null))) return null
  const paths: string[] = []
  const scanned: Array<{ dir: string; mtimeMs: number }> = []
  const subdirs: string[] = []

  const scanDir = async (dir: string, collectSubdirs: boolean): Promise<void> => {
    let st: Stats
    let names: string[]
    try {
      st = await fs.lstat(dir)
      names = await fs.readdir(dir)
    } catch {
      return // 不可读（权限/竞态消失）当无内容处理，目录自身仍入指纹
    }
    scanned.push({ dir, mtimeMs: st.mtimeMs })
    names.sort((a, b) => a.localeCompare(b))
    for (const name of names) {
      if (name.startsWith('.')) continue
      const full = path.join(dir, name)
      let entry: Stats
      try {
        entry = await fs.lstat(full)
      } catch {
        continue // 扫描中文件被删等竞态：当不存在处理
      }
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (collectSubdirs && !WORKSPACE_EXCLUDED_DIRS.has(name)) subdirs.push(full)
        continue
      }
      if (entry.isFile()) {
        paths.push(full)
        if (paths.length >= MAX_WORKSPACE_CANDIDATES) return
      }
    }
  }

  await scanDir(cwd, true)
  for (const dir of subdirs.slice(0, MAX_WORKSPACE_SUBDIRS)) {
    if (paths.length >= MAX_WORKSPACE_CANDIDATES) break
    await scanDir(dir, false)
  }
  paths.sort((a, b) => a.localeCompare(b))
  return { fingerprint: scanned, paths }
}

/** 取 cwd 候选池：缓存指纹未失效直接复用；失效（目录 mtime 变化/被删）重扫。 */
async function poolFor(cwd: string): Promise<WorkspaceCandidatePool | null> {
  const cached = poolCache.get(cwd)
  if (cached) {
    const fresh = await readFingerprint(cached.fingerprint.map((f) => f.dir))
    if (fresh !== null && sameFingerprint(cached.fingerprint, fresh)) return cached
    poolCache.delete(cwd)
  }
  const pool = await scanPool(cwd)
  if (pool) poolCache.set(cwd, pool)
  return pool
}

/**
 * @ 补全的工作区候选：cwd 浅层文件候选池上按 query 内存过滤（文件名包含、
 * 大小写不敏感、绝对路径返回、按路径排序）。cwd 缺失或不可读返回空列表。
 */
export async function workspaceFileCandidates(cwd: string | undefined, query: string): Promise<FileRefCandidate[]> {
  if (!cwd) return []
  const pool = await poolFor(cwd)
  if (!pool) return []
  const q = query.trim().toLowerCase()
  const out: FileRefCandidate[] = []
  for (const full of pool.paths) {
    if (q === '' || path.basename(full).toLowerCase().includes(q)) {
      out.push({ path: full, kind: 'file' })
      if (out.length >= MAX_WORKSPACE_CANDIDATES) return out
    }
  }
  return out
}
