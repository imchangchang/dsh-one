import type { Logger } from '../log.ts'
import { parse as parseSemver } from '../pure/semver.ts'

/**
 * dsh >= 0.1.2-rc.1 browser-session auth: every process start mints a random
 * launch token (printed in the dsh web URL); GET /?token= exchanges it for a
 * signed HttpOnly cookie (`dsh-auth-*`) bound to the request Host authority.
 * Every /api/* RPC and WS upgrade after that needs the cookie — the token
 * itself cannot call APIs and loopback is not exempt.
 *
 * This module owns the per-origin auth state and the token→cookie exchange.
 * **Token and cookie values never reach the logger** — callers must pass rule
 * URLs/errors only.
 */

/** Cookie value for one origin; the raw string is used verbatim as a Cookie header. */
export interface ServerAuth {
  /** `dsh-auth-<hash>=v1....` (the Set-Cookie pair, attributes stripped). */
  cookie: string
  /** Request Host the cookie is bound to (`127.0.0.1:<port>`). */
  authority: string
  /** 本次进程的 launch token（浏览器首次打开需要用它的 URL 换 cookie）。 */
  token?: string
}

const EXCHANGE_TIMEOUT_MS = 5_000

const authByOrigin = new Map<string, ServerAuth>()

export function registerAuth(origin: string, auth: ServerAuth): void {
  authByOrigin.set(origin, auth)
}

export function clearAuth(origin: string): void {
  authByOrigin.delete(origin)
}

export function getAuth(origin: string): ServerAuth | null {
  return authByOrigin.get(origin) ?? null
}

/** Cookie header value for an origin; undefined when the server has no auth. */
export function cookieHeader(origin: string): string | undefined {
  return getAuth(origin)?.cookie
}

/** true when the origin runs dsh with browser-session auth (0.1.2+ protocol). */
export function isModern(origin: string): boolean {
  return authByOrigin.has(origin)
}

// ---- 每 origin 的 dsh 版本协议寄存器 ----
// dsh-one 同时服务 0.1.1（legacy）/0.1.2（modern）/0.1.3（modern + 侧信道/参数改名）。
// modern wire 之上还有一次 0.1.3 的协议分裂：commands/execute 的 args 键改名
// （images → submittedAttachments）、session/follow 的 assistantStream opt-in。
// 这两处分叉不能用参数宽容性赌老版本（0.1.2 的网关 assertExactArguments 会拒
// 未知键），必须按 dsh 版本隔离：老版本走原路径、新版本走新分支。
// 版本由 manager 在 setStatus 时以 origin 为键注册（来自 `dsh --version` 或
// 命令行探测），见 server/manager.ts。

const versionByOrigin = new Map<string, string>()

export function registerVersion(origin: string, version: string): void {
  versionByOrigin.set(origin, version)
}

export function clearVersion(origin: string): void {
  versionByOrigin.delete(origin)
}

/** dsh version reported for an origin; undefined when unknown. */
export function dshVersion(origin: string): string | undefined {
  return versionByOrigin.get(origin)
}

/**
 * true when the origin runs dsh on the 0.1.3+ wire. 0.1.3 (及其任意 prerelease /
 * 之后的 minor）才带 `submittedAttachments` 与 `assistantStream`；0.1.1/0.1.2
 * 一律 false（按老路径走，确保老版本零改动）。无法解析的版本保守返回 false。
 */
export function is013Wire(origin: string): boolean {
  const v = versionByOrigin.get(origin)
  if (v === undefined) return false
  const parsed = parseSemver(v)
  if (parsed === null) return false
  return parsed.major > 0 || parsed.minor > 1 || (parsed.minor === 1 && parsed.patch >= 3)
}

/** Parse the `name=value` pair out of a Set-Cookie header ("name=value; Attr=..."). */
function parseSetCookie(value: string): string | null {
  const pair = value.split(';', 1)[0]?.trim()
  return pair && pair.includes('=') ? pair : null
}

/** GET /?token=... and register the returned auth cookie. */
export async function exchangeToken(origin: string, token: string, logger: Logger): Promise<ServerAuth> {
  const res = await fetch(`${origin}/?token=${encodeURIComponent(token)}`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
  })
  if (res.status !== 303) {
    throw new Error(`dsh token exchange failed (HTTP ${res.status})`)
  }
  const setCookie = res.headers.get('set-cookie')
  const cookie = setCookie === null ? null : parseSetCookie(setCookie)
  if (!cookie) {
    throw new Error('dsh token exchange returned no auth cookie')
  }
  const authority = new URL(origin).host
  const auth: ServerAuth = { cookie, authority, token }
  registerAuth(origin, auth)
  logger.info(`dsh auth exchanged at ${origin}`)
  return auth
}

/**
 * 用户浏览器/扩展 webview 首次打开 dsh web GUI 的地址：认证服务器必须经
 * `?token=` 换票（打印 URL 即此形态）；0.1.1 无认证，直接给干净 URL。
 */
export function browserUrl(origin: string): string {
  const token = getAuth(origin)?.token
  return token === undefined ? origin : `${origin}/?token=${encodeURIComponent(token)}`
}

/**
 * Non-throwing probe used before adopting or re-owning: a 303 answers only
 * when the token was minted by the very process on that port.
 */
export async function probeToken(origin: string, token: string, logger: Logger): Promise<ServerAuth | null> {
  try {
    return await exchangeToken(origin, token, logger)
  } catch (err) {
    logger.info(`dsh token probe ${origin}: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}
