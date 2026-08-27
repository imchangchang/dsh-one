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
  /** Epoch milliseconds (later of creation and the latest human prompt). */
  updatedAt: number
  running: boolean
  blank: boolean
  parentSessionId?: string
  origin?: string
  cwd?: string
  agentPreset?: string
  /** Projection baseline; keys beyond `title` are left opaque on purpose. */
  projections?: {
    asOfSeq: number
    values: Record<string, unknown>
  }
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

/** Session display title from the `title` projection; null when untitled. */
export function sessionTitle(s: SessionSummary): string | null {
  const title = s.projections?.values.title
  return typeof title === 'string' && title.length > 0 ? title : null
}

/** All workspaces in display order, plus the global archived-session set. */
export async function listWorkspaces(
  baseUrl: string,
): Promise<{ items: WorkspaceView[]; archivedSessionIds: string[] }> {
  return callRpc(baseUrl, 'workspace.list', {})
}

/** Every session known to the host (attached and cold). */
export async function listSessions(baseUrl: string): Promise<SessionSummary[]> {
  const value = await callRpc<{ items: SessionSummary[] }>(baseUrl, 'session.list', {})
  return value.items
}

/** Create a fresh (blank) session under `workspaceId`; returns its id. */
export async function createSession(baseUrl: string, workspaceId: string): Promise<string> {
  const value = await callRpc<{ sessionId: string }>(baseUrl, 'session.create', { workspaceId })
  return value.sessionId
}

/** Pin a user-chosen title; an empty title fails host-side with title-invalid. */
export async function renameSession(baseUrl: string, sessionId: string, title: string): Promise<string> {
  const value = await callRpc<{ title: string; seq: number }>(baseUrl, 'session.rename', {
    sessionId,
    title,
  })
  return value.title
}

/** Hide a session from lists (idempotent host-side; reversible in dsh). */
export async function archiveSession(baseUrl: string, sessionId: string): Promise<void> {
  await callRpc<{ archivedSessionIds: string[] }>(baseUrl, 'workspace.archiveSession', { sessionId })
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
  const items = await listSessions(baseUrl)
  const blank = items.find((s) => s.blank && workspace.sessionIds.includes(s.sessionId))
  const payload = blank ? { sessionId: blank.sessionId } : { workspaceId: workspace.workspaceId }
  const value = await callRpc<{ sessionId: string }>(baseUrl, 'session.create', payload)
  return value.sessionId
}
