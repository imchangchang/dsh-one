/**
 * Gateway RPC envelope helpers for the host.describe probe.
 * Pure logic — no `vscode` import.
 */

export interface DescribeRequest {
  type: 'client-request'
  rpcId: string
  method: 'host.describe'
  payload: Record<string, never>
}

/** Build the JSON body for a host.describe probe. */
export function makeDescribeRequest(rpcId: string): DescribeRequest {
  return { type: 'client-request', rpcId, method: 'host.describe', payload: {} }
}

/**
 * A response "is dsh" only when it is a JSON object echoing the rpcId we sent.
 * Anything else (proxy error pages, other web servers, echoed garbage) is rejected.
 */
export function isDshResponse(body: unknown, rpcId: string): boolean {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return false
  const obj = body as Record<string, unknown>
  return obj.rpcId === rpcId
}

/** Parse a response body and validate the rpcId echo in one step. */
export function validateDescribeResponse(text: string, rpcId: string): boolean {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return false
  }
  return isDshResponse(parsed, rpcId)
}
