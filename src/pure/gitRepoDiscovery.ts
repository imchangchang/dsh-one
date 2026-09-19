/**
 * 工作区内的 git 仓库有界发现（#65 批 1 返修 2）。会话工作区根**不是** git
 * 仓库、仓库在子目录里时（例：工作区根 POV、提交在 POV/aibrain-app），只在
 * 根上跑 git 必然落空——按序在根之下有界地找仓库。
 *
 * 边界（全部可注入，默认值随代码）：
 * - **限深 ≤3**：根的直接子目录算第 1 层，只在第 1..3 层里找（更深的仓库不扫）；
 * - **跳过目录名**：依赖/构建/缓存类目录一律不进（node_modules、.venv、dist、
 *   build、vendor…，见 DEFAULT_SKIP_DIRS）；
 * - **仓库数上限 24**：找到 24 个就停（够用且不给磁盘/进程添乱）；
 * - **时间预算**：遍历总预算（缺省 1.5s），超时即停并置 truncated；
 * - **不跟符号链接**：既防目录环，也保证发现结果仍落在允许根之内（realpath
 *   包含判定的前提）；
 * - 找到仓库后**不再往里下钻**（仓库里再嵌仓库属罕见，交给下一个候选根）。
 *
 * 判定「是仓库」的默认实现 = 目录下存在 `.git`（目录或 worktree 的 `.git` 文件）；
 * 也可注入 `isRepo`（宿主侧另有 `git rev-parse --show-toplevel` 二次确认）。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'

/** 默认跳过的目录名（小写比较；依赖/构建/缓存/版本库元数据）。 */
export const DEFAULT_SKIP_DIRS: readonly string[] = [
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  '.venv',
  'venv',
  'env',
  'dist',
  'build',
  'out',
  'target',
  'vendor',
  'coverage',
  '__pycache__',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.idea',
  '.vscode-test',
]

export const DEFAULT_MAX_DEPTH = 3
export const DEFAULT_MAX_REPOS = 24
export const DEFAULT_DISCOVERY_BUDGET_MS = 1500

export interface RepoDiscoveryOptions {
  /** 最大深度（根的直接子目录为第 1 层）。 */
  maxDepth?: number
  /** 跳过的目录名（大小写不敏感）。 */
  skipDirNames?: readonly string[]
  /** 仓库数上限。 */
  maxRepos?: number
  /** 遍历时间预算（毫秒）。 */
  budgetMs?: number
  /** 判定一个目录是否是 git 仓库（缺省 = 存在 .git）。 */
  isRepo?: (dir: string) => Promise<boolean>
  /** 时钟注入（测试用）。 */
  now?: () => number
}

export interface RepoDiscoveryResult {
  /** 命中的仓库目录（绝对路径，**层序**：浅的在前，同层按名字升序）。 */
  repos: readonly string[]
  /** 是否因时间预算 / 仓库数上限提前结束。 */
  truncated: boolean
}

/** 缺省判定：目录下存在 `.git`（普通仓库是目录，worktree/submodule 是文件）。 */
async function hasGitMarker(dir: string): Promise<boolean> {
  try {
    await fsp.stat(path.join(dir, '.git'))
    return true
  } catch {
    return false
  }
}

/**
 * 在 root 之下有界发现 git 仓库（不含 root 自身——它由调用方先行查询）。
 * @param root - 工作区根（绝对路径，调用方已做过允许根判定）。
 * @param options - 边界与判定注入。
 * @returns 命中的仓库目录 + 是否被截断。
 */
export async function discoverGitRepos(root: string, options: RepoDiscoveryOptions = {}): Promise<RepoDiscoveryResult> {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH
  const skip = new Set((options.skipDirNames ?? DEFAULT_SKIP_DIRS).map((name) => name.toLowerCase()))
  const maxRepos = options.maxRepos ?? DEFAULT_MAX_REPOS
  const budgetMs = options.budgetMs ?? DEFAULT_DISCOVERY_BUDGET_MS
  const isRepo = options.isRepo ?? hasGitMarker
  const now = options.now ?? (() => Date.now())
  const deadline = now() + budgetMs

  const repos: string[] = []
  let truncated = false
  let frontier: string[] = [root]
  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
    const next: string[] = []
    for (const parent of frontier) {
      if (now() > deadline) {
        truncated = true
        break
      }
      let entries
      try {
        entries = await fsp.readdir(parent, { withFileTypes: true })
      } catch {
        continue // 读不动的目录（权限等）直接跳过
      }
      const names = entries
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .map((entry) => entry.name)
        .filter((name) => !skip.has(name.toLowerCase()))
        .sort()
      for (const name of names) {
        if (now() > deadline) {
          truncated = true
          break
        }
        const child = path.join(parent, name)
        if (await isRepo(child)) {
          repos.push(child)
          if (repos.length >= maxRepos) {
            truncated = true
            break
          }
          continue
        }
        next.push(child)
      }
      if (truncated) break
    }
    if (truncated) break
    frontier = next
  }
  return { repos, truncated }
}
