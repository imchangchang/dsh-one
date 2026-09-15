/**
 * 「在工作区里找这条提交」的编排（#65 批 1 返修 2）：先查会话工作区根，落空再
 * 有界发现子目录仓库逐个查。宿主能力桥 `git.show` 调这里；本模块只依赖 node
 * （无 vscode），因此能用真 git + 临时目录做端到端单测。
 *
 * 候选根按序：
 * 1. **查询根**（会话工作区路径；git 自身会向上找仓库，工作区是仓库子目录时这步就中）；
 * 2. **工作区内发现的仓库**（深度/跳过目录/仓库数/时间四项有界，见 gitRepoDiscovery）；
 * 全部落空 → 维持「未找到该提交」（found=false），不报错。
 *
 * 时间预算：单次调用总预算（缺省 2s，可注入）——发现与逐仓库查询共用同一预算，
 * 超时即停、置 truncated 并回调 log（宿主把这条写进 DSH One 输出面板，UI 不阻塞）。
 *
 * 缓存（TTL 5 分钟，同 hostWorkspaceRoots 口径；失败不缓存）：
 * - `root → 发现的仓库表`：同一工作区反复悬停不同 hash 时只扫一次；
 * - `仓库 + sha → 结果`：同一 hash 在不同会话（同仓库）里不重复跑 git，
 *   未命中也缓存（避免每次都把整片仓库重扫一遍）。
 */
import * as path from 'node:path'
import type { CommitInfoResult } from './chatContract.ts'
import { commitNotFound } from './gitShow.ts'
import { runGitShow, type GitCommitInfo, type GitShowOptions } from './gitShowCommand.ts'
import { discoverGitRepos, type RepoDiscoveryOptions, type RepoDiscoveryResult } from './gitRepoDiscovery.ts'
import { createTtlCache, type TtlCache } from './ttlCache.ts'

/** 单次查询总预算（发现 + 逐仓库查询共用）。 */
export const DEFAULT_QUERY_BUDGET_MS = 2000
/** 缓存 TTL（与 hostWorkspaceRoots 的 5 分钟同口径）。 */
export const QUERY_CACHE_TTL_MS = 5 * 60 * 1000

/** 查询结果 = 提交信息（含远端推送状态）+ 命中仓库（供卡片展示上下文）。 */
export interface GitWorkspaceQueryResult extends GitCommitInfo {
  /** 命中提交的仓库绝对路径。 */
  repoPath?: string
  /** 仓库相对查询根的路径（仓库就是查询根时为 undefined，不展示）。 */
  repoRelative?: string
  /** 本次实际查询过的根数（查询根 + 发现的仓库，诊断/日志用）。 */
  scannedRoots?: number
  /** 是否因预算/上限提前结束。 */
  truncated?: boolean
}

export interface GitWorkspaceQueryOptions extends GitShowOptions, RepoDiscoveryOptions {
  /** 总预算（毫秒）。 */
  budgetMs?: number
  /** 诊断日志（宿主写输出面板）。 */
  log?: (line: string) => void
  /** 仓库表缓存（测试可注入）。 */
  repoCache?: TtlCache<RepoDiscoveryResult>
  /** (仓库, sha) 结果缓存（测试可注入）。 */
  commitCache?: TtlCache<GitWorkspaceQueryResult>
  /** 时钟注入。 */
  now?: () => number
}

/** 仓库表缓存（按查询根；模块级共享，三棵树共用一个宿主实例）。 */
const defaultRepoCache = createTtlCache<RepoDiscoveryResult>({ ttlMs: QUERY_CACHE_TTL_MS })
/** 提交结果缓存（按 仓库 + sha）。 */
const defaultCommitCache = createTtlCache<GitWorkspaceQueryResult>({ ttlMs: QUERY_CACHE_TTL_MS })

const cacheKey = (dir: string, hash: string): string => `${dir}\u0000${hash}`

/** 给命中结果盖上「在哪个仓库」的上下文（相对查询根的路径便于展示）。 */
function stampRepo(info: GitWorkspaceQueryResult, repoPath: string, queryRoot: string): GitWorkspaceQueryResult {
  const relative = path.relative(queryRoot, repoPath)
  return {
    ...info,
    repoPath,
    ...(relative === '' || relative === '.' ? {} : { repoRelative: relative }),
  }
}

/**
 * 在工作区（查询根 + 其内的子目录仓库）里查一条提交。
 * @param hash - 提交号（调用方已校核 7–40 位 hex）。
 * @param queryRoot - 查询根（已 realpath、已过允许根判定）。
 * @returns 提交信息（含仓库上下文）；`undefined` = git 二进制起不来（宿主按 git-missing 回执）。
 */
export async function queryCommitInWorkspace(
  hash: string,
  queryRoot: string,
  options: GitWorkspaceQueryOptions = {},
): Promise<GitWorkspaceQueryResult | undefined> {
  const budgetMs = options.budgetMs ?? DEFAULT_QUERY_BUDGET_MS
  const now = options.now ?? (() => Date.now())
  const started = now()
  const deadline = started + budgetMs
  const elapsed = (): number => now() - started
  const repoCache = options.repoCache ?? defaultRepoCache
  const commitCache = options.commitCache ?? defaultCommitCache
  const remaining = (): number => Math.max(0, deadline - now())
  const gitOptions: GitShowOptions = {
    ...(options.gitPath === undefined ? {} : { gitPath: options.gitPath }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  }

  // ① 查询根（git 会向上找仓库：工作区是仓库子目录时这一步就中）
  const direct = await runGitShow(hash, queryRoot, { ...gitOptions, timeoutMs: Math.min(remaining() || budgetMs, gitOptions.timeoutMs ?? budgetMs) })
  if (direct === undefined) return undefined
  if (direct.found) {
    options.log?.(`[assembly] git.show hit at query root in ${String(elapsed())}ms`)
    return { ...direct, scannedRoots: 1 }
  }

  // ② 有界发现子目录仓库（仓库表按查询根缓存）
  const discovery = await repoCache.load(queryRoot, () =>
    discoverGitRepos(queryRoot, {
      ...(options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth }),
      ...(options.skipDirNames === undefined ? {} : { skipDirNames: options.skipDirNames }),
      ...(options.maxRepos === undefined ? {} : { maxRepos: options.maxRepos }),
      ...(options.isRepo === undefined ? {} : { isRepo: options.isRepo }),
      budgetMs: Math.max(1, remaining()),
      now,
    }),
  )
  let truncated = discovery.truncated
  let scanned = 1
  for (const repo of discovery.repos) {
    if (remaining() === 0) {
      truncated = true
      break
    }
    const cached = commitCache.get(cacheKey(repo, hash))
    if (cached !== undefined) {
      scanned += 1
      if (cached.found) return { ...stampRepo(cached, repo, queryRoot), scannedRoots: scanned, truncated }
      continue
    }
    const info = await runGitShow(hash, repo, { ...gitOptions, timeoutMs: Math.max(1, Math.min(remaining() || 1, gitOptions.timeoutMs ?? budgetMs)) })
    if (info === undefined) return undefined
    const stamped: GitWorkspaceQueryResult = { ...info }
    commitCache.set(cacheKey(repo, hash), stamped)
    scanned += 1
    if (info.found) {
      options.log?.(
        `[assembly] git.show hit in ${path.relative(queryRoot, repo) || '.'} after ${String(scanned)} roots in ${String(elapsed())}ms`,
      )
      return { ...stampRepo(stamped, repo, queryRoot), scannedRoots: scanned, truncated }
    }
  }
  options.log?.(
    `[assembly] git.show miss: scanned ${String(scanned)} roots (${String(discovery.repos.length)} repos) in ${String(elapsed())}ms${truncated ? ' (truncated)' : ''}`,
  )
  return { ...commitNotFound(hash), scannedRoots: scanned, truncated }
}
