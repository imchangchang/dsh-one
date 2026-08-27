import * as crypto from 'node:crypto'

export interface WorkspaceView {
  workspaceId: string
  path: string
  title: string
  sessionIds: string[]
  createdAt: string
  updatedAt: string
}

export interface SessionSummary {
  sessionId: string
  updatedAt: string
  running: boolean
  blank: boolean
  cwd?: string
}

interface RpcResponse<T> {
  rpcId?: string
  result?: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
}

/** Generic unary Gateway RPC call (same envelope as the host.describe probe). */
export async function callRpc<T>(baseUrl: string, method: string, payload: unknown): Promise<T> {
  const rpcId = crypto.randomUUID()
  const res = await fetch(`${baseUrl}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
    signal: AbortSignal.timeout(15_000),
  })
  const body = (await res.json()) as RpcResponse<T>
  if (!res.ok || body.rpcId !== rpcId || !body.result) {
    throw new Error(`${method}: bad gateway response (HTTP ${res.status})`)
  }
  if (!body.result.ok) {
    throw new Error(`${method} failed: ${body.result.error.code} ${body.result.error.message}`)
  }
  return body.result.value
}

/** Idempotently register `path` as a dsh workspace; returns the canonical entry. */
export async function ensureWorkspace(baseUrl: string, path: string): Promise<WorkspaceView> {
  const value = await callRpc<{ workspace: WorkspaceView; created: boolean }>(baseUrl, 'workspace.create', { path })
  return value.workspace
}

/**
 * Make sure the workspace has a session for the UI to land on. Reuses a blank
 * session when one exists (same rule as the official client), otherwise
 * creates a fresh one.
 */
export async function ensureSession(baseUrl: string, workspace: WorkspaceView): Promise<string> {
  const { items } = await callRpc<{ items: SessionSummary[] }>(baseUrl, 'session.list', {})
  const blank = items.find((s) => s.blank && workspace.sessionIds.includes(s.sessionId))
  const payload = blank ? { sessionId: blank.sessionId } : { workspaceId: workspace.workspaceId }
  const value = await callRpc<{ sessionId: string }>(baseUrl, 'session.create', payload)
  return value.sessionId
}
