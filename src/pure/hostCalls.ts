/**
 * 宿主能力桥的「参数校核 + 错误形状」纯逻辑（#65 批 1）：不含 vscode 依赖，
 * 便于单测直接跑；宿主侧 src/ui/assembly/hostBridge.ts 消费这些函数。
 *
 * 校核是这个桥唯一的安全边界（页面送来的 args 是不可信输入），所以这里只做
 * 判断、不执行外部动作：
 * - 提交号：严格 7–40 位 hex（形状不对直接被拒，不进入 git 命令行）；
 * - URL：能被 URL 解析且协议限 http/https/mailto；
 * - 目录：绝对路径 + 真实存在 + realpath 后落在允许根（工作区目录 / ~/.dsh）内。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'

/** 结构化错误码（页面按 code 决定提示文案，不解析 message）。 */
export type HostCallErrorCode =
  | 'unknown-call'
  | 'invalid-args'
  | 'no-workspace'
  | 'not-found'
  /** 目标能力的外部程序起不来（目前仅 git：未安装或不可执行）。 */
  | 'git-missing'
  | 'failed'
  | 'unsupported'

/** 宿主回执的错误体。 */
export interface HostCallError {
  code: HostCallErrorCode
  message: string
}

/** OPEN_URL 允许的协议白名单（外链动作只认这三种）。 */
export const ALLOWED_URL_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:'])

/** 提交号的严格形状（比正文扫描的 COMMIT_SHA_RE 严：不认两端邻接字符）。 */
export const COMMIT_SHA_ARG_RE = /^[0-9a-fA-F]{7,40}$/

/** 参数读取辅助：只接受普通对象。 */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/** 结构化错误判定（区分「回执数据」与「回执错误」）。 */
export function isHostCallError(value: unknown): value is HostCallError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as HostCallError).code === 'string' &&
    typeof (value as HostCallError).message === 'string'
  )
}

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

/** 校核 URL：能被 URL 解析且协议在白名单内。 */
export function parseAllowedUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }
  return ALLOWED_URL_PROTOCOLS.has(parsed.protocol) ? value : null
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
