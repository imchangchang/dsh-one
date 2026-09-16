/**
 * 宿主能力桥的「参数校核 + 错误形状」纯逻辑（#65 批 1）：不含 vscode 依赖，
 * 便于单测直接跑；宿主侧 src/ui/assembly/hostBridge.ts 消费这些函数。
 *
 * 校核是这个桥唯一的安全边界（页面送来的 args 是不可信输入），所以这里只做
 * 判断、不执行外部动作：
 * - 提交号：严格 7–40 位 hex（形状不对直接被拒，不进入 git 命令行）；
 * - URL：能被 URL 解析且协议限 http/https/mailto；
 * - 目录：绝对路径 + 真实存在 + realpath 后落在允许根（工作区目录 / ~/.dsh）内。
 *
 * 错误码与判定住在 hostCallError.ts（#84 拆出：能力口的前端 SDK 要用同一套码，
 * 但不能被这里的 node:fs 依赖拖进浏览器 bundle）；本模块 re-export 它们，宿主侧
 * 的消费方（hostBridge）仍只认这一个 import 源。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { asRecord, isHostCallError, type HostCallError, type HostCallErrorCode } from './hostCallError.ts'

export { asRecord, isHostCallError, type HostCallError, type HostCallErrorCode }
// 外链 URL 的校核与协议白名单挪到能力口的契约模块（#83「开外链」能力：前端 SDK 也要
// 用它，而本模块带 node 依赖、进不了浏览器 bundle）；这里转出口，宿主侧调用点不变。
export { ALLOWED_URL_PROTOCOLS, parseAllowedUrl } from './hostCapabilities.ts'

/** 提交号的严格形状（比正文扫描的 COMMIT_SHA_RE 严：不认两端邻接字符）。 */
export const COMMIT_SHA_ARG_RE = /^[0-9a-fA-F]{7,40}$/

/** 真实路径（不存在时返回 null）——包含判定前先解符号链接，防链接逃逸。 */
async function realPathOrNull(target: string): Promise<string | null> {
  try {
    return await fsp.realpath(target)
  } catch {
    return null
  }
}

/** 路径是否落在某个允许根之内（含根本身）。 */
export function isInside(child: string, root: string): boolean {
  if (child === root) return true
  return child.startsWith(root.endsWith(path.sep) ? root : `${root}${path.sep}`)
}

/**
 * 校核调用方给的目录：绝对路径、真实存在、realpath 后落在某个允许根之内。
 * @param dir - 调用方给的目录。
 * @param allowedRoots - 允许根（VS Code 工作区目录 / ~/.dsh）。
 * @returns 可用的绝对目录；越界/不存在返回 null。
 */
export async function resolveAllowedDir(dir: string, allowedRoots: readonly string[]): Promise<string | null> {
  if (!path.isAbsolute(dir) || dir.includes('\0')) return null
  const real = await realPathOrNull(dir)
  if (real === null) return null
  for (const root of allowedRoots) {
    const realRoot = await realPathOrNull(root)
    if (realRoot !== null && isInside(real, realRoot)) return real
  }
  return null
}

/**
 * 解析 git 的查询目录，分两级：
 * 1. 调用方给的 cwd（会话工作区路径）——**必须**落在允许根之内（realpath 后
 *    包含判定）才采用；
 * 2. 不合法/缺失时回落 `fallback`（宿主自己的 VS Code 工作区目录，它本身就是
 *    允许根）——回落是为了「拿不到会话工作区也能查」，不是放宽信任：越界路径
 *    一律不会被采用。
 * @returns `{dir, usedRequested}`；连回落都不可用（目录不存在/没开工作区）时 null。
 *          `usedRequested=false` 表示会话工作区被拒/缺失，调用方据此写一条诊断日志
 *          （否则「为什么查的是别的目录」在真窗里无从下手）。
 */
export async function resolveQueryDir(
  requested: string | undefined,
  fallback: string | undefined,
  allowedRoots: readonly string[],
): Promise<{ dir: string; usedRequested: boolean } | null> {
  if (requested !== undefined) {
    const resolved = await resolveAllowedDir(requested, allowedRoots)
    if (resolved !== null) return { dir: resolved, usedRequested: true }
  }
  if (fallback === undefined) return null
  const fallbackDir = await resolveAllowedDir(fallback, allowedRoots)
  return fallbackDir === null ? null : { dir: fallbackDir, usedRequested: false }
}

/**
 * 会话 id 的形状（#72）：gateway 生成的标识符（实际形态 `session-<uuid>`）。
 * 只做「标识符」级校核——非空、限长、限字符集（字母数字与 `-._:`），不接受
 * 路径分隔符、空白与控制字符：这个 id 会被宿主拿去查表、写进页面与面板标题，
 * 不该带着任何「路径/换行」味道的东西过来（页面送来的参数一律当不可信输入）。
 */
export const SESSION_ID_ARG_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

/** `session.openInNewTab` 的参数（多开通道，见 hostBridge 的 HOST_CALLS）。 */
export interface SessionTabArgs {
  sessionId: string
}

/** 校核 `session.openInNewTab` 的参数；不合法返回结构化错误。 */
export function parseSessionTabArgs(args: unknown): SessionTabArgs | HostCallError {
  const record = asRecord(args)
  if (record === undefined) {
    return { code: 'invalid-args', message: 'session.openInNewTab expects an object argument' }
  }
  const sessionId = record.sessionId
  if (typeof sessionId !== 'string' || !SESSION_ID_ARG_RE.test(sessionId)) {
    return { code: 'invalid-args', message: 'session.openInNewTab expects a plain session id string' }
  }
  return { sessionId }
}

/** git.show 的参数（hash 必填且形状严格；cwd 可选）。 */
export interface GitShowArgs {
  hash: string
  cwd?: string
}

/** 校核 git.show 的参数；不合法返回结构化错误。 */
export function parseGitShowArgs(args: unknown): GitShowArgs | HostCallError {
  const record = asRecord(args)
  if (record === undefined) return { code: 'invalid-args', message: 'git.show expects an object argument' }
  const hash = record.hash
  if (typeof hash !== 'string' || !COMMIT_SHA_ARG_RE.test(hash)) {
    return { code: 'invalid-args', message: 'git.show expects a 7-40 hex char commit hash' }
  }
  const cwd = record.cwd
  if (cwd !== undefined && typeof cwd !== 'string') {
    return { code: 'invalid-args', message: 'git.show expects cwd to be a string when present' }
  }
  return cwd === undefined ? { hash } : { hash, cwd }
}
