import type { Logger } from '../log.ts'

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
  const auth: ServerAuth = { cookie, authority }
  registerAuth(origin, auth)
  logger.info(`dsh auth exchanged at ${origin}`)
  return auth
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

/** True when the port appears to run an **authenticated** dsh we lack a token for. */
export async function probeAuthRequired(origin: string, logger: Logger): Promise<boolean> {
  try {
    const res = await fetch(origin, { signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS) })
    return res.status === 401
  } catch {
    return false
  }
}
