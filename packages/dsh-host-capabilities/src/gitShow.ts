/**
 * 宿主半的只读 git 查询（#84 能力②）：**沿用宿主调用通道同一套安全口径**——hash 形状
 * 严格校核、cwd 经 realpath 限域、git 一律 execFile（argv 数组，不拼 shell）。
 * 这些校核函数直接复用扩展侧那一份（`src/pure/hostCalls.ts` + `gitWorkspaceQuery.ts`），
 * 不是复制：口径只有一处，两侧不可能漂。
 *
 * 与扩展侧唯一的差别是**允许根从哪来**：VS Code 侧是「VS Code 工作区目录 + ~/.dsh
 * + 网关注册的工作区」；宿主半跑在 dsh 宿主进程里，天然能看到 dsh 自己注册的工作区
 * 表（`ctx.workspaceRegistry`），所以允许根 = 「dsh 注册的工作区路径 + ~/.dsh」。
 * 越界路径不被采用，回落「第一个允许根」（注册表为空时回落 dsh 家目录）。
 */
import { resolveQueryDir, type HostCallError } from '../../../src/pure/hostCalls.ts'
import { queryCommitInWorkspace, type GitWorkspaceQueryResult } from '../../../src/pure/gitWorkspaceQuery.ts'
import { dshHomeDir } from './stateStore.ts'

/** 查询依赖（测试注入用；生产走缺省）。 */
export interface GitShowDeps {
  /** 允许根（dsh 注册的工作区路径），调用方按当前注册表取。 */
  allowedRoots: () => Promise<readonly string[]>
  /** dsh 家目录（~/.dsh），路径限域的另一半。 */
  home?: string
  /** git 可执行文件（测试注入假路径）。 */
  gitPath?: string
  /** 单次查询时间预算。 */
  budgetMs?: number
}

/**
 * 查一条提交。找不到不是错误（结果里 `found: false`），只有参数非法才是错误。
 * @param args - `{ hash, cwd? }`（已由 `parseGitShowArgs` 校核）。
 * @param deps - 允许根与可执行文件来源。
 * @param log - 诊断日志（宿主半写自己的日志，会话里看不到）。
 */
export async function gitShowInHost(
  args: { hash: string; cwd?: string },
  deps: GitShowDeps,
  log?: (line: string) => void,
): Promise<GitWorkspaceQueryResult | null | HostCallError> {
  const registered = await deps.allowedRoots()
  const home = deps.home ?? dshHomeDir()
  const allowedRoots = [...registered, home]
  const resolved = await resolveQueryDir(args.cwd, registered[0] ?? home, allowedRoots)
  if (resolved === null) {
    return { code: 'no-workspace', message: 'no usable directory: no dsh workspace is registered and the dsh home is unavailable' }
  }
  if (!resolved.usedRequested && args.cwd !== undefined && args.cwd !== '') {
    log?.(`[host-capabilities] gitShow: ${args.cwd} is not inside a registered workspace; querying ${resolved.dir}`)
  }
  const info = await queryCommitInWorkspace(args.hash, resolved.dir, {
    ...(deps.gitPath === undefined ? {} : { gitPath: deps.gitPath }),
    ...(deps.budgetMs === undefined ? {} : { budgetMs: deps.budgetMs }),
    ...(log === undefined ? {} : { log }),
  })
  if (info === undefined) return { code: 'git-missing', message: 'the git executable could not be started' }
  return info
}
