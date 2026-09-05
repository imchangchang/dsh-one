import * as crypto from 'node:crypto'
import type { HistoryEntryLike } from '../pure/conversation.ts'
import { historyWindowRequest } from '../pure/historyWindow.ts'
import type { OutgoingImage } from '../pure/chatContract.ts'
import type { AgentPresetLike } from '../pure/agentPreset.ts'
import type { FileRefCandidate } from '../pure/fileReference.ts'
import { cookieHeader, isModern } from './serverAuth.ts'

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

/** Plain-record guard for legacy payloads wrapped into a `request` arg. */
function asRecord(payload: unknown): Record<string, unknown> {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {}
}

/**
 * dsh >= 0.1.2 rewrote the unary RPC wire: dot-method names became
 * namespace/method paths (`session.list` → `session/list`) and payloads are
 * wrapped per generated argument descriptors (`payload.args` with wire names
 * like `request`/`_request`/`agentId`). The legacy names/payloads stay for
 * 0.1.1; this table maps the legacy call surface onto the modern wire.
 * The value is `undefined` (never returned) — the OLD method is gone on the
 * modern server and any dot-method left unmapped is a caller bug.
 */
const MODERN_WIRE: Record<string, { method: string; args: (payload: unknown) => Record<string, unknown> }> = {
  'session.list': { method: 'session/list', args: () => ({ _request: {} }) },
  'session.create': { method: 'session/create', args: (p) => ({ request: asRecord(p) }) },
  'session.rename': { method: 'session/rename', args: (p) => ({ request: asRecord(p) }) },
  'session.fork': { method: 'session/fork', args: (p) => ({ request: asRecord(p) }) },
  // session.prompt 的现代描述子要求客户端 mint requestId（落进用户消息头）。
  'session.prompt': {
    method: 'session/prompt',
    args: (p) => ({ request: { requestId: crypto.randomUUID(), ...asRecord(p) } }),
  },
  'session.cancel': { method: 'session/cancel', args: (p) => ({ request: asRecord(p) }) },
  'session.search': { method: 'session/search', args: (p) => ({ request: asRecord(p) }) },
  'session.attachment': { method: 'session/attachment', args: (p) => ({ request: asRecord(p) }) },
  'session.updateQueue': { method: 'session/updateQueue', args: (p) => ({ request: asRecord(p) }) },
  'session.selectModel': { method: 'session/selectModel', args: (p) => ({ request: asRecord(p) }) },
  'session.models': { method: 'session/modelCatalog', args: () => ({}) },
  'workspace.create': { method: 'workspace/create', args: (p) => ({ request: asRecord(p) }) },
  'workspace.delete': { method: 'workspace/delete', args: (p) => ({ request: asRecord(p) }) },
  'workspace.archiveSession': {
    method: 'workspace/archiveSession',
    args: (p) => ({ request: { sessionId: asRecord(p).sessionId } }),
  },
  'subagent.list': {
    method: 'subagents/list',
    args: (p) => ({ parentSessionId: asRecord(p).parentSessionId }),
  },
  'agentPreset.list': { method: 'agentPresets/list', args: () => ({}) },
  'agentPreset.select': {
    method: 'agentPresets/select',
    args: (p) => ({ agentId: asRecord(p).sessionId, agentPreset: asRecord(p).agentPreset }),
  },
}

/**
 * Generic unary Gateway RPC call (same envelope as the host.describe probe).
 * `timeoutMs` guards against a hung gateway; pass `null` for calls whose
 * duration is workload-bound (e.g. commands/execute awaits a whole
 * compaction), where a client-side deadline would abort real work.
 *
 * The modern (0.1.2) server authenticates every /api/* call with the
 * authority-bound cookie registered by ServerManager; the legacy 0.1.1
 * server has no auth, so no cookie header is sent and the request is
 * byte-identical to the pre-0.1.2 extension.
 */
export async function callRpc<T>(
  baseUrl: string,
  method: string,
  payload: unknown,
  timeoutMs: number | null = 15_000,
): Promise<T> {
  const rpcId = crypto.randomUUID()
  const cookie = cookieHeader(baseUrl)
  const modern = isModern(baseUrl)
  let wireMethod = method
  let wirePayload = payload
  if (modern) {
    if (method.includes('.')) {
      const mapped = MODERN_WIRE[method]
      if (!mapped) throw new Error(`${method}: no dsh 0.1.2 wire mapping (dot-method removed)`)
      wireMethod = mapped.method
      wirePayload = { args: mapped.args(payload) }
    }
    // slash methods already use the modern args form; pass through unchanged.
  }
  const res = await fetch(`${baseUrl}/api/${wireMethod}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie !== undefined ? { cookie } : {}),
    },
    body: JSON.stringify({ type: 'client-request', rpcId, method: wireMethod, payload: wirePayload }),
    ...(timeoutMs === null ? {} : { signal: AbortSignal.timeout(timeoutMs) }),
  })
  const body = (await res.json()) as RpcResponse<T>
  if (!res.ok || body.rpcId !== rpcId || !body.result) {
    throw new Error(`${wireMethod}: bad gateway response (HTTP ${res.status})`)
  }
  if (!body.result.ok) {
    throw new Error(`${wireMethod} failed: ${body.result.error.code} ${body.result.error.message}`)
  }
  return body.result.value
}

/** Session display title from the `title` projection; null when untitled. */
export function sessionTitle(s: SessionSummary): string | null {
  const title = s.projections?.values.title
  return typeof title === 'string' && title.length > 0 ? title : null
}

/**
 * Closed-turn count from the `sessionStats` projection of one session.list row
 * (the host's `sessionProjections` registry; dsh-session-stats folds a
 * completed turn into `turns` at its first `step/end`). 0 when the projection
 * is absent or reports none — a session that has never completed a turn.
 *
 * The list sidebar only shows non-blank sessions, so `blank` cannot distinguish
 * "has a completed turn"; this count closes that gap. The fork menu disables
 * when it is 0 (no `turn/end` boundary, so the server rejects the fork). It is
 * a step-completion proxy rather than a literal `turn/end` flag (the wire view
 * excludes the live `openStep`/`lastTurn`), so an in-flight first turn that has
 * produced a step can still read >0; the fork command's existing error toast
 * covers that residual window.
 */
export function sessionCompletedTurns(s: SessionSummary): number {
  const stats = s.projections?.values.sessionStats
  if (typeof stats !== 'object' || stats === null) return 0
  const turns = (stats as Record<string, unknown>).turns
  return typeof turns === 'number' && Number.isFinite(turns) && turns > 0 ? Math.floor(turns) : 0
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

/**
 * Loose mirror of one `subagent.list` durable direct-child catalog row
 * (apiproxy subagents.d.ts SubagentListEntry). `label` is required for
 * continuable children, optional for one-shot; diagnostic rows carry no label.
 */
export interface SubagentListEntry {
  kind: 'child' | 'diagnostic'
  /** SessionId of the child subagent（diagnostic 行也带，便于 UI 定位）。 */
  id: string
  activity?: 'running' | 'inactive'
  hasChildren?: boolean
  mode?: 'one-shot' | 'continuable'
  label?: string
  reason?: 'corrupt' | 'unsupported' | 'unavailable'
}

/** Loose mirror of SubagentCatalog (apiproxy subagents.d.ts). */
export interface SubagentCatalog {
  entries: SubagentListEntry[]
  parentAvailable: boolean
}

/**
 * List the direct-subagent catalog of one parent session (`subagent.list`).
 * The host keeps this catalog durable — it is the source of the menu row label
 * (`entry.label ?? entry.id`), unlike the async session title. `parentSessionId`
 * is the parent; nested levels are fetched per parent by the caller.
 */
export async function listSubagents(baseUrl: string, parentSessionId: string): Promise<SubagentCatalog> {
  return callRpc<SubagentCatalog>(baseUrl, 'subagent.list', { parentSessionId })
}

/**
 * Create a fresh (blank) session; returns its id. `workspaceId` attaches the
 * session to a registered workspace; `cwd`（与 workspaceId 二选一，host 拒绝
 * 同时给出）把会话放到给定目录而不注册 workspace——无归属会话在列表里归入
 * 「未分组」。两者都不给时 host 回退默认 cwd（dsh 服务进程的启动目录）。
 * `sessionId` 由调用方预分配时 host 原样采用（如临时目录名与会话 id 对齐）。
 */
export async function createSession(
  baseUrl: string,
  opts: { workspaceId?: string; cwd?: string; sessionId?: string } = {},
): Promise<string> {
  const payload: Record<string, string> = {}
  if (opts.workspaceId !== undefined) payload.workspaceId = opts.workspaceId
  else if (opts.cwd !== undefined) payload.cwd = opts.cwd
  if (opts.sessionId !== undefined) payload.sessionId = opts.sessionId
  const value = await callRpc<{ sessionId: string }>(baseUrl, 'session.create', payload)
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
 * Soft-remove a workspace: only the registry record goes away — the folder
 * on disk and its session logs are kept, and its sessions fall back to
 * ungrouped (dsh web's delete semantics; dsh 本来就没有彻底删除能力）。
 */
export async function deleteWorkspace(baseUrl: string, workspaceId: string): Promise<void> {
  await callRpc(baseUrl, 'workspace.delete', { workspaceId })
}

/**
 * Make sure the workspace has a session for the UI to land on. Reuses a blank
 * session when one exists (same rule as the official client), otherwise
 * creates a fresh one. The `workspaceId + sessionIds + path` shape lets callers
 * hand over the store's workspace baseline rows directly.
 *
 * Reuse rule mirrors the official `WorkspaceRuntime.connectWorkspace`: a blank
 * session qualifies only when its own cwd equals the workspace path, and the
 * reuse is a plain client-side pick — no session.create RPC. (session.create
 * with a `sessionId` payload is host-side *resume* semantics: it validates the
 * session against a resolved cwd of `workspaceId ?? cwd ?? defaults.cwd`, so
 * reusing a blank session whose cwd differs from the host default would fail
 * with `session-conflict` — the official client never takes that path.)
 */
export async function ensureSession(
  baseUrl: string,
  workspace: Pick<WorkspaceView, 'workspaceId' | 'sessionIds' | 'path'>,
): Promise<string> {
  const items = await listSessions(baseUrl)
  const blank = items.find(
    (s) => s.blank && s.cwd === workspace.path && workspace.sessionIds.includes(s.sessionId),
  )
  if (blank) return blank.sessionId
  const value = await callRpc<{ sessionId: string }>(baseUrl, 'session.create', {
    workspaceId: workspace.workspaceId,
  })
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
  // clientTimeZone：官方 prompt 的可选字段，服务端相对时间类文案会用到用户时区。
  await callRpc<{ accepted: true }>(baseUrl, 'session.prompt', {
    sessionId,
    mode,
    content,
    clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  })
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

/** Loose mirror of dsh-goal's GoalRef: the CAS token every goals/* mutation echoes. */
export interface GoalRef {
  id: string
  revision: number
}

/** Loose mirror of dsh-goal's GoalState (mutation result; the `goal` projection value's inner object). */
export interface GoalStateLike {
  id: string
  revision: number
  objective: string
  phase: 'active' | 'paused' | 'blocked' | 'complete'
  blockedReason?: { code: string; message: string }
  maxGoalRounds: number
}

/**
 * Goal mutations over the generic /api RPC channel (dsh-goal service, same
 * envelope as commands/execute: `agentId` + CAS `ref` in `args`). The host
 * pushes the next `goal` projection after each committed change; the returned
 * state is only used to surface immediate errors.
 */
export async function pauseGoal(baseUrl: string, sessionId: string, ref: GoalRef): Promise<GoalStateLike> {
  return callRpc<GoalStateLike>(baseUrl, 'goals/pause', { args: { agentId: sessionId, ref } })
}

export async function resumeGoal(baseUrl: string, sessionId: string, ref: GoalRef): Promise<GoalStateLike> {
  return callRpc<GoalStateLike>(baseUrl, 'goals/resume', { args: { agentId: sessionId, ref } })
}

export async function editGoal(
  baseUrl: string,
  sessionId: string,
  ref: GoalRef,
  objective: string,
): Promise<GoalStateLike> {
  return callRpc<GoalStateLike>(baseUrl, 'goals/edit', {
    args: { agentId: sessionId, ref, request: { objective } },
  })
}

export async function clearGoal(baseUrl: string, sessionId: string, ref: GoalRef): Promise<GoalRef> {
  return callRpc<GoalRef>(baseUrl, 'goals/clear', { args: { agentId: sessionId, ref } })
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

/**
 * Narrow a `modelSelection` projection value to the session's active selection.
 * 0.1.2 folds it as { lastUsed, next } where either side may be null (a blank
 * session has both null); the web client resolves `next ?? catalog.default`
 * (dsh-client-ui-model-selection syncInputs), lastUsed only backs it up when
 * the host has not projected `next` yet.
 */
export function activeModelSelection(value: unknown): SessionModelSelection | undefined {
  if (!value || typeof value !== 'object') return undefined
  const wrapped = value as { next?: unknown; lastUsed?: unknown }
  for (const candidate of [wrapped.next, wrapped.lastUsed]) {
    if (
      typeof candidate === 'object' &&
      candidate !== null &&
      typeof (candidate as SessionModelSelection).provider === 'string' &&
      typeof (candidate as SessionModelSelection).model === 'string'
    ) {
      return candidate as SessionModelSelection
    }
  }
  return undefined
}

/** Advisory model directory for one session (session.models). */
export async function sessionModels(baseUrl: string, sessionId: string): Promise<SessionModels> {
  if (isModern(baseUrl)) {
    // 0.1.2: per-session selection lives in the session.list projections
    // (modelSelection); the catalog itself is the unary modelCatalog.
    const [catalog, sessions] = await Promise.all([
      callRpc<{
        default?: SessionModelSelection
        groups?: Array<{ id: string; name: string; models: SessionCatalogModel[] }>
        failures?: Array<{ id: string; name: string; message: string }>
      }>(baseUrl, 'session.models', {}),
      listSessions(baseUrl).catch(() => []),
    ])
    const current =
      activeModelSelection(
        sessions.find((s) => s.sessionId === sessionId)?.projections?.values.modelSelection,
      ) ?? catalog.default ?? { provider: '', model: '' }
    return {
      current,
      routable: (catalog.groups?.length ?? 0) > 0,
      groups: catalog.groups ?? [],
      failures: catalog.failures ?? [],
    }
  }
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

/** Read one history window; omitting beforeSeq reads the tail page. */
export async function sessionHistory(
  baseUrl: string,
  sessionId: string,
  beforeSeq?: number,
): Promise<SessionHistoryPage> {
  return callRpc(baseUrl, 'session.history', historyWindowRequest(sessionId, beforeSeq))
}

/** One session.search hit: the session plus its single best-match snippet. */
export interface SessionSearchHit {
  sessionId: string
  snippet: string
}

/** session.search result: ≤20 sessions, snippet ≤240 code points each. */
export interface SessionSearchResult {
  items: SessionSearchHit[]
  hasMore: boolean
}

/**
 * Full-text session search over user/assistant messages (index-backed).
 * On a backend without the index mounted this throws (dsh `internal` error);
 * callers must degrade to title/ID-only matching.
 */
export async function searchSessions(baseUrl: string, query: string): Promise<SessionSearchResult> {
  return callRpc<SessionSearchResult>(baseUrl, 'session.search', { query })
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
 * @ 补全的文件/文件夹候选（fileReferences/list Remote，与 dsh web 同一个
 * 端点）。路径相对会话 cwd；query 是 @ 后的原文，空串或带 / 时按目录层级
 * 列举，否则全局排名搜索（host 侧上限 20 条）。注意：与 messageFeedback/*
 * 不同，这个 Remote 的结果**没有**第二层 {ok, value} envelope——网关
 * result.value 直接就是候选数组（已对真实 host 验证）。
 */
export async function listFileReferences(baseUrl: string, sessionId: string, query: string): Promise<FileRefCandidate[]> {
  const value = await callRpc<FileRefCandidate[]>(baseUrl, 'fileReferences/list', {
    args: { agentId: sessionId, query },
  })
  return Array.isArray(value) ? value : []
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
  const cookie = cookieHeader(baseUrl)
  const res = await fetch(url, {
    ...(cookie === undefined ? {} : { headers: { cookie } }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`session.export: HTTP ${res.status}${detail ? ` ${detail}` : ''}`)
  }
  return new Uint8Array(await res.arrayBuffer())
}

/**
 * dsh >= 0.1.2 live history page (session/page). The modern stream model
 * replaces the legacy unary window: `throughSeq` comes from the follow
 * stream's snapshot cursor (inclusive cut); `beforeSeq`/`maxMessages` page
 * backwards from it.
 */
export interface ModernSessionPage {
  records: unknown[]
  hasMore: boolean
}

export async function sessionPage(
  baseUrl: string,
  sessionId: string,
  throughSeq: number,
  beforeSeq?: number,
  maxMessages?: number,
): Promise<ModernSessionPage> {
  return callRpc<ModernSessionPage>(baseUrl, 'session/page', {
    args: {
      request: {
        address: { kind: 'session', sessionId },
        throughSeq,
        ...(beforeSeq === undefined ? {} : { beforeSeq }),
        ...(maxMessages === undefined ? {} : { maxMessages }),
      },
    },
  })
}

/**
 * dsh >= 0.1.2 waterfall answer (`$events/result`): one approval/question
 * request delivered on the $events stream is answered by correlating the
 * stream's clientId with the frame eventId. `outcome.value` is the raw
 * listener result ('allowed-once'/'rejected', the question answer object…).
 */
export async function sendWaterfallResult(
  baseUrl: string,
  clientId: string,
  eventId: string,
  value: unknown,
): Promise<void> {
  const cookie = cookieHeader(baseUrl)
  const res = await fetch(`${baseUrl}/api/$events/result`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie === undefined ? {} : { cookie }),
    },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: crypto.randomUUID(),
      method: '$events/result',
      payload: { args: { clientId, eventId, outcome: { kind: 'result', value } } },
    }),
    signal: AbortSignal.timeout(15_000),
  })
  const body = (await res.json().catch(() => null)) as { result?: { ok: boolean; error?: { message?: string } } } | null
  if (!res.ok || body?.result?.ok !== true) {
    throw new Error(`$events/result rejected: ${body?.result?.error?.message ?? `HTTP ${res.status}`}`)
  }
}
