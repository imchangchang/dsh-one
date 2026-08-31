import * as crypto from 'node:crypto'
import type { HistoryEntryLike } from '../pure/conversation.ts'
import type { OutgoingImage } from '../pure/chatContract.ts'
import type { AgentPresetLike } from '../pure/agentPreset.ts'

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

/**
 * Generic unary Gateway RPC call (same envelope as the host.describe probe).
 * `timeoutMs` guards against a hung gateway; pass `null` for calls whose
 * duration is workload-bound (e.g. commands/execute awaits a whole
 * compaction), where a client-side deadline would abort real work.
 */
export async function callRpc<T>(
  baseUrl: string,
  method: string,
  payload: unknown,
  timeoutMs: number | null = 15_000,
): Promise<T> {
  const rpcId = crypto.randomUUID()
  const res = await fetch(`${baseUrl}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
    ...(timeoutMs === null ? {} : { signal: AbortSignal.timeout(timeoutMs) }),
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

/**
 * Total token usage from the `tokenUsage` projection (sum of its four
 * buckets); undefined when the host has not reported one. Loose on purpose:
 * any numeric bucket counts, so new bucket names are picked up for free.
 */
export function sessionTotalTokens(s: SessionSummary): number | undefined {
  const usage = s.projections?.values.tokenUsage
  if (typeof usage !== 'object' || usage === null) return undefined
  let total = 0
  let seen = false
  for (const value of Object.values(usage as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      total += value
      seen = true
    }
  }
  return seen ? total : undefined
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

/**
 * Agent preset roster (agentPreset.list). Entries are passed through loosely
 * (AgentPresetLike); broken rows are the picker's problem, not the RPC layer's.
 */
export async function listAgentPresets(baseUrl: string): Promise<{ presets: AgentPresetLike[] }> {
  const value = await callRpc<{ presets?: AgentPresetLike[] }>(baseUrl, 'agentPreset.list', {})
  return { presets: Array.isArray(value.presets) ? value.presets : [] }
}

/**
 * Pin an agent preset on a blank session; returns the applied id. Only valid
 * before the first turn — the host answers agent-preset-locked afterwards.
 */
export async function selectAgentPreset(baseUrl: string, sessionId: string, agentPreset: string): Promise<string> {
  const value = await callRpc<{ agentPreset: string }>(baseUrl, 'agentPreset.select', { sessionId, agentPreset })
  return value.agentPreset
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

/**
 * Send one prompt; images precede the text block. Note: this HTTP path treats
 * a leading-slash line as plain prompt text — slash commands must go through
 * {@link executeCommand} instead (same split as the official web client).
 */
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
  await callRpc<{ accepted: true }>(baseUrl, 'session.prompt', { sessionId, mode, content })
}

/** Admission outcome of one slash-command line (dsh-commands `commands/execute`). */
export interface CommandOutcome {
  /** False when the host did not recognize the line as a command at all. */
  matched: boolean
  kind?: 'success' | 'error'
  text?: string
}

/**
 * Execute one slash-command line against the session's agent via the generic
 * /api RPC channel — the channel the official web client's composer uses.
 * The host logs the lifecycle (command/run, command/done); the returned text
 * is the handler's receipt, which the web client renders as a flow node.
 */
export async function executeCommand(
  baseUrl: string,
  sessionId: string,
  line: string,
  images?: OutgoingImage[],
): Promise<CommandOutcome> {
  const value = await callRpc<
    { commandId: string; result: { kind: 'success'; text?: string } | { kind: 'error'; text: string } } | undefined
  >(
    baseUrl,
    'commands/execute',
    {
      args: {
        agentId: sessionId,
        line,
        images: (images ?? []).map((img) => ({
          mediaType: img.mediaType,
          data: img.data,
          ...(img.name ? { name: img.name } : {}),
        })),
      },
    },
    // The RPC settles only when the handler does — /compact awaits the whole
    // compaction — so no client-side deadline; the command/run flow node
    // already shows the work in progress.
    null,
  )
  if (value === undefined) return { matched: false }
  return { matched: true, kind: value.result.kind, text: value.result.text }
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

/** Mutate one still-pending queued inbox item (edit / remove / steer). */
export async function updateQueue(
  baseUrl: string,
  sessionId: string,
  itemId: string,
  action: { kind: 'edit'; content: unknown[] } | { kind: 'remove' } | { kind: 'steer' },
): Promise<void> {
  await callRpc(baseUrl, 'session.updateQueue', { sessionId, itemId, action })
}

/** One stored per-message rating (messageFeedback/list item). */
export interface MessageFeedbackItem {
  messageId: string
  rating: 'positive' | 'negative'
  note?: string
  version: string
}

/**
 * The messageFeedback/* methods proxy to a remote service, so inside the
 * gateway result (which callRpc already unwrapped) the value carries a second
 * {ok, value|error} envelope. This strips that inner layer.
 */
function unwrapRemote<T>(
  method: string,
  value: { ok?: boolean; value?: T; error?: { code?: string; message?: string } },
): T {
  if (!value || value.ok !== true || value.value === undefined) {
    throw new Error(`${method} failed: ${value?.error?.message ?? 'malformed response'}`)
  }
  return value.value
}

/** All stored feedback ratings of one session. */
export async function listMessageFeedback(baseUrl: string, sessionId: string): Promise<MessageFeedbackItem[]> {
  const value = unwrapRemote<{ items?: MessageFeedbackItem[] }>(
    'messageFeedback/list',
    await callRpc(baseUrl, 'messageFeedback/list', { args: { request: { sessionId } } }),
  )
  return Array.isArray(value.items) ? value.items : []
}

/**
 * Upsert one rating. `ifVersion` is the optimistic lock: the stored entry's
 * version when one exists, null for a first rating.
 */
export async function putMessageFeedback(
  baseUrl: string,
  sessionId: string,
  messageId: string,
  rating: 'positive' | 'negative',
  ifVersion: string | null,
): Promise<void> {
  unwrapRemote<unknown>(
    'messageFeedback/put',
    await callRpc(baseUrl, 'messageFeedback/put', { args: { request: { sessionId, messageId, rating, ifVersion } } }),
  )
}

/** Remove one rating; `ifVersion` must be the stored entry's version. */
export async function deleteMessageFeedback(
  baseUrl: string,
  sessionId: string,
  messageId: string,
  ifVersion: string,
): Promise<void> {
  unwrapRemote<unknown>(
    'messageFeedback/delete',
    await callRpc(baseUrl, 'messageFeedback/delete', { args: { request: { sessionId, messageId, ifVersion } } }),
  )
}

/**
 * Fork the session, keeping history up to `atSeq` (a completed turn's last
 * event seq; omitted forks at the tail). Returns the child session id.
 */
export async function forkSession(baseUrl: string, sessionId: string, atSeq?: number): Promise<string> {
  const value = await callRpc<{ sessionId: string }>(
    baseUrl,
    'session.fork',
    atSeq === undefined ? { sessionId } : { sessionId, atSeq },
  )
  return value.sessionId
}

/** Filename convention the host endpoint owns (same as the web client). */
export function sessionLogZipFilename(sessionId: string): string {
  return `dsh-session-${sessionId.replace(/[^A-Za-z0-9_-]/g, '_')}.zip`
}

/**
 * Download the session-log ZIP the `/export` command asks for. The command
 * handler only marks the request; the bytes come from this plain GET
 * endpoint (the official web client hands the same URL to the browser's
 * download manager).
 */
export async function exportSessionLog(baseUrl: string, sessionId: string): Promise<Uint8Array> {
  const url = new URL('/api/session.export', baseUrl)
  url.searchParams.set('sessionId', sessionId)
  url.searchParams.set('includeDescendants', 'true')
  const res = await fetch(url)
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`session.export: HTTP ${res.status}${detail ? ` ${detail}` : ''}`)
  }
  return new Uint8Array(await res.arrayBuffer())
}
