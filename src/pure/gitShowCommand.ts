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
): Promise<CommitInfoResult | undefined> {
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
  const githubUrl = remote.code === 0 ? githubUrlFromRemoteUrl(remote.stdout.trim(), record.hash) : undefined
  return commitInfoFromShowRecord(hash, record, githubUrl)
}
