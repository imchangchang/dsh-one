import * as crypto from 'node:crypto'
import type { HistoryEntryLike } from '../pure/conversation.ts'
import type { OutgoingImage } from '../pure/chatContract.ts'

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

/** Loose mirror of one session.history page value (apiproxy sessions.d.ts). */
export interface SessionHistoryPage {
  events: HistoryEntryLike[]
  hasMore: boolean
  /** Projection baseline; only the tail page (beforeSeq omitted) carries it. */
  projections?: {
    asOfSeq: number
    values: Record<string, unknown>
  }
}

/**
 * Answer one pending server-request frame (approval/question) by echoing its
 * rpcId through POST /api/respond. Throws unless the host accepts; a repeated
 * or late answer comes back as not-pending.
 */
export async function respond(baseUrl: string, rpcId: string, value: unknown): Promise<void> {
  const res = await fetch(`${baseUrl}/api/respond`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-response', rpcId, result: { ok: true, value } }),
    signal: AbortSignal.timeout(15_000),
  })
  const body = (await res.json()) as { accepted?: boolean; reason?: string }
  if (!res.ok || body.accepted !== true) {
    throw new Error(`respond ${rpcId} rejected: ${body.reason ?? `HTTP ${res.status}`}`)
  }
}

/** Send one prompt; slash commands ride the same entry point. Images precede the text block. */
export async function promptSession(
  baseUrl: string,
  sessionId: string,
  text: string,
  mode: 'queue' | 'steer' = 'queue',
  images?: OutgoingImage[],
): Promise<void> {
  const content: unknown[] = (images ?? []).map((img) => ({
    type: 'image',
    mediaType: img.mediaType,
    data: img.data,
    ...(img.name ? { name: img.name } : {}),
  }))
  if (text) content.push({ type: 'text', text })
  await callRpc(baseUrl, 'session.prompt', { sessionId, mode, content })
}

/** Loose mirror of ModelSelection (apiproxy sessions.d.ts). */
export interface SessionModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

/** Loose mirror of ModelCatalogModel; only the fields the UI reads. */
export interface SessionCatalogModel {
  id: string
  name: string
  description?: string
  reasoning?: {
    efforts: Array<{ id: string; name: string; description?: string }>
    defaultEffort?: string
  }
}

/** Loose mirror of ImageAttachmentLimits (dsh-attachment types; `imageLimits` projection value). */
export interface ImageLimits {
  maxImageBytes: number
  maxImagesPerMessage: number
  maxMessageImageBytes: number
  mediaTypes: readonly string[]
}

/** Loose mirror of SessionModels (apiproxy sessions.d.ts). */
export interface SessionModels {
  current: SessionModelSelection
  routable: boolean
  groups: Array<{ id: string; name: string; models: SessionCatalogModel[] }>
  failures: Array<{ id: string; name: string; message: string }>
}

/** Advisory model directory for one session (session.models). */
export async function sessionModels(baseUrl: string, sessionId: string): Promise<SessionModels> {
  return callRpc(baseUrl, 'session.models', { sessionId })
}

/** Select provider/model(/effort) for the session's next step (session.selectModel). */
export async function selectModel(
  baseUrl: string,
  sessionId: string,
  selection: SessionModelSelection,
): Promise<SessionModelSelection> {
  const value = await callRpc<{ selected: SessionModelSelection }>(baseUrl, 'session.selectModel', {
    sessionId,
    provider: selection.provider,
    model: selection.model,
    ...(selection.reasoningEffort !== undefined ? { reasoningEffort: selection.reasoningEffort } : {}),
  })
  return value.selected
}

/** Stop the session's active turn; queued work survives the cancellation. */
export async function cancelSession(baseUrl: string, sessionId: string): Promise<void> {
  await callRpc(baseUrl, 'session.cancel', { sessionId })
}

/** Read one history page; omitting beforeSeq reads the tail page. */
export async function sessionHistory(
  baseUrl: string,
  sessionId: string,
  beforeSeq?: number,
): Promise<SessionHistoryPage> {
  return callRpc(baseUrl, 'session.history', beforeSeq === undefined ? { sessionId } : { sessionId, beforeSeq })
}

/** Fetch one attachment's bytes (base64) plus its reference metadata. */
export async function sessionAttachment(
  baseUrl: string,
  sessionId: string,
  attachmentId: string,
): Promise<{ mediaType: string; data: string }> {
  const value = await callRpc<{ attachment: { mediaType?: string }; data: string }>(baseUrl, 'session.attachment', {
    sessionId,
    attachmentId,
  })
  return { mediaType: value.attachment?.mediaType ?? 'application/octet-stream', data: value.data }
}
