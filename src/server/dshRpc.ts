import * as crypto from 'node:crypto'
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
 * Agent preset id from one session.list row. dsh 0.1.2 把该字段从行顶层迁入了
 * `projections.values.agentPreset`（字符串 id；实测 0.1.2-rc.1 行顶层已没有
 * agentPreset，679/679 缺省、116 行只在 projections 有值）——顶层读取保留作
 * 旧服务端回退。头部只读 preset chip 的数据源（sessionsStore.toSessionInput）。
 */
export function sessionAgentPreset(s: SessionSummary): string | undefined {
  if (typeof s.agentPreset === 'string' && s.agentPreset !== '') return s.agentPreset
  const proj = s.projections?.values.agentPreset
  return typeof proj === 'string' && proj !== '' ? proj : undefined
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

/**
 * All workspaces in display order, plus the global archived-session set.
 *
 * Legacy（0.1.1）专用：现代 dsh（0.1.2）**没有 `workspace/list` 端点**（实测返回
 * not found，与编造方法名同响应），服务端改用 `workspace/follow` 流式方法给清单。
 * 装配线（#65）因此不再用它取允许根，改从 `session/list` 的 cwd 集合推导
 * （见 src/pure/workspaceRoots.ts）；本函数保留给 legacy 路径与旧自研侧栏。
 */
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

/** Loose mirror of SessionModels (apiproxy sessions.d.ts). */
export interface SessionModels {
  current: SessionModelSelection
  routable: boolean
  groups: Array<{ id: string; name: string; models: SessionCatalogModel[] }>
  failures: Array<{ id: string; name: string; message: string }>
}

/** Host-generation model catalog (unary session/models): the catalog response
 *  plus which groups are routable. `current` lives in the session's
 *  `modelSelection` projection, not here. */
export type ModelCatalogValue = Omit<SessionModels, 'current'> & { default?: SessionModelSelection }

/**
 * 现代（0.1.2）unary 目录：`session.models` 不带 sessionId，Host 级一份
 * （对齐官方 ModelCatalogDirectory 的「Loads at most one model catalog for
 * the current Host generation」）。调用方（modelCatalog.ts 的共享缓存）
 * 负责 in-flight 合并与失效，这里只做一次 RPC 与形状归一。
 */
export async function fetchModelCatalog(baseUrl: string): Promise<ModelCatalogValue> {
  const value = await callRpc<{
    default?: SessionModelSelection
    groups?: Array<{ id: string; name: string; models: SessionCatalogModel[] }>
    failures?: Array<{ id: string; name: string; message: string }>
  }>(baseUrl, 'session.models', {})
  return {
    ...(value.default !== undefined ? { default: value.default } : {}),
    groups: value.groups ?? [],
    failures: value.failures ?? [],
    routable: (value.groups?.length ?? 0) > 0,
  }
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
      fetchModelCatalog(baseUrl),
      listSessions(baseUrl).catch(() => []),
    ])
    const current =
      activeModelSelection(
        sessions.find((s) => s.sessionId === sessionId)?.projections?.values.modelSelection,
      ) ?? catalog.default ?? { provider: '', model: '' }
    return {
      current,
      routable: catalog.routable,
      groups: catalog.groups,
      failures: catalog.failures,
    }
  }
  return callRpc(baseUrl, 'session.models', { sessionId })
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
