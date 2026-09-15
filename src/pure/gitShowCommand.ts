/**
 * git CLI 查询的执行面（#65 批 1）：宿主能力桥 `git.show` 的实现体，刻意与
 * vscode 解耦（只依赖 node:child_process），这样真 git 二进制的端到端行为
 * （解析、短 hash、GitHub 链接、找不到的提交、cwd 限域）能在单测里用临时仓库
 * 直接跑；hostBridge 只负责参数校核与回执封装。
 */
import { execFile } from 'node:child_process'
import {
  GIT_INFO_FORMAT,
  commitInfoFromShowRecord,
  commitNotFound,
  githubUrlFromRemoteUrl,
  parseGitShowOutput,
} from './gitShow.ts'
import type { CommitInfoResult } from './chatContract.ts'

/**
 * 提交信息 + 远端推送状态（#65 收尾 5）：卡片据此决定要不要给「在 GitHub 打开」
 * 按钮——链接是远端语义的地址，本地独有（未 push）的提交点开必然 404。
 */
export interface GitCommitInfo extends CommitInfoResult {
  /**
   * 远端是否包含该提交（`git branch -r --contains <sha>` 有输出即 true）。
   * 仓库没有任何远端时缺省（没得比，卡片不提示）；有远端但未推送为 false。
   */
  pushedToRemote?: boolean
}

/** 查询选项（超时与 git 路径可注入，便于测试）。 */
export interface GitShowOptions {
  /** git 可执行文件（缺省 PATH 上的 git）。 */
  gitPath?: string
  /** 单条命令超时（毫秒）。 */
  timeoutMs?: number
}

const DEFAULT_GIT_TIMEOUT_MS = 10_000

/** execFile 的结果（不回显命令行；spawnFailed 表示 git 二进制起不来）。 */
interface ExecResult {
  code: number
  spawnFailed: boolean
  stdout: string
  stderr: string
}

function runGit(gitPath: string, args: readonly string[], cwd: string, timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(gitPath, [...args], { cwd, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      const rawCode = (error as { code?: unknown } | null)?.code
      const spawnFailed = error !== null && typeof rawCode === 'string'
      const code = error === null ? 0 : typeof rawCode === 'number' ? rawCode : 1
      resolve({ code, spawnFailed, stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

/**
 * 在一个目录里查一条提交：`git log --no-walk`（一条命令取 hash/作者/日期/
 * subject/body/--shortstat），再取 remote.origin.url 推导 GitHub 链接。
 *
 * hash 由调用方（hostBridge / 本模块测试）保证是 7-40 位 hex，因此不会被 git
 * 当成选项；这里不做 shell 拼接，argv 直接传给 execFile。
 *
 * @returns 提交信息（查不到时 found=false）；git 二进制起不来返回 undefined。
 */
export async function runGitShow(
  hash: string,
  dir: string,
  options: GitShowOptions = {},
): Promise<GitCommitInfo | undefined> {
  const gitPath = options.gitPath ?? 'git'
  const timeoutMs = options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS
  const log = await runGit(
    gitPath,
    ['log', '--no-walk', `--format=${GIT_INFO_FORMAT}`, '--shortstat', `${hash}^{commit}`],
    dir,
    timeoutMs,
  )
  if (log.spawnFailed) return undefined
  if (log.code !== 0) return commitNotFound(hash)
  const record = parseGitShowOutput(log.stdout)[0]
  if (record === undefined) return commitNotFound(hash)
  const remote = await runGit(gitPath, ['config', '--get', 'remote.origin.url'], dir, timeoutMs)
  const remoteUrl = remote.code === 0 ? remote.stdout.trim() : ''
  // GitHub 链接一律用**完整 40 位 hash**（短 hash 在远端可能歧义/查不到）。
  const githubUrl = githubUrlFromRemoteUrl(remoteUrl, record.hash)
  const pushedToRemote =
    remoteUrl === '' ? undefined : await remoteContainsCommit(dir, record.hash, { gitPath, timeoutMs })
  return {
    ...commitInfoFromShowRecord(hash, record, githubUrl),
    ...(pushedToRemote === undefined ? {} : { pushedToRemote }),
  }
}

/**
 * 远端是否包含该提交（只读）：`git branch -r --contains <sha>` 列出的远端跟踪分支
 * 非空即视为已推送。**只读命令**，不动远端、不 fetch（代价：本地远端跟踪引用若
 * 落后于真远端，可能把「其实已推送」判成未推送——宁可少给一个按钮，不给一个必 404
 * 的链接）。仓库没有远端时报 false（调用方按「无远端」处理）。
 * @param dir - 仓库目录（调用方已做过允许根判定）。
 * @param sha - 完整 40 位 hash 或短 hash（git 自己解析）。
 * @returns true = 远端跟踪分支包含该提交。
 */
export async function remoteContainsCommit(
  dir: string,
  sha: string,
  options: { gitPath?: string; timeoutMs?: number } = {},
): Promise<boolean> {
  const gitPath = options.gitPath ?? 'git'
  const timeoutMs = options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS
  const branches = await runGit(gitPath, ['branch', '-r', '--contains', sha], dir, timeoutMs)
  if (branches.spawnFailed) return false
  return branches.stdout.trim() !== ''
}
