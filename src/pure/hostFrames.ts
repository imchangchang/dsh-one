/**
 * Host 事件流（WS /api/events.host）帧的解析与逐帧增量应用。
 * 帧结构是官方 HostFrame 的宽松镜像（dsh-host-apiproxy events.d.ts /
 * events.schema.js）；增量语义对齐官方 dsh-client-runtime 的 applyMutation
 * 与 workspace registry 的 upsert/installOrder：
 * - session-added 已存在时只补缺字段，blank 单调（一旦被清不会被旧帧重新置真）；
 * - session-status 只翻 running，running:true 顺带清 blank（blank 会话不会运行）；
 * - session-removed 对 origin=subagent 的会话降级为 running:false（durable
 *   subagent 规则），其余直接移出列表；
 * - workspace-changed 整体 upsert（updatedAt 更旧的帧丢弃），新 workspace 插到最前；
 * - workspace-order-changed 按完整序重排，未知名排尾（保持稳定）。
 * 无 vscode 依赖，node --test 可直接单测。
 */
import type { SessionInput, WorkspaceInput } from './sessionTree.ts'

/** Loose mirror of the official HostFrame union（只含列表维护用到的帧）。 */
export type HostFrame =
  | {
      type: 'host/session-added'
      sessionId: string
      blank: boolean
      parentSessionId?: string
      origin?: string
      agentPreset?: string
    }
  | { type: 'host/session-removed'; sessionId: string }
  | { type: 'host/session-status'; sessionId: string; running: boolean }
  | { type: 'host/workspace-changed'; workspace: WorkspaceInput }
  | { type: 'host/workspace-removed'; workspaceId: string }
  | { type: 'host/workspace-order-changed'; workspaceIds: string[] }
  | { type: 'host/archived-sessions-changed'; archivedSessionIds: string[] }

/** 列表增量作用的目标：session.list / workspace.list 基线的本地缓存。 */
export interface SessionListState {
  sessions: SessionInput[]
  workspaces: WorkspaceInput[]
  archived: ReadonlySet<string>
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) return null
  return value as string[]
}

/**
 * Narrow one wire frame (envelope method + payload) to a HostFrame; null when
 * malformed or not list-relevant（agent-error / remote-event / stream/error
 * 等由各自消费方处理，这里一律忽略）。
 */
export function parseHostFrame(method: string, payload: unknown): HostFrame | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as Record<string, unknown>
  switch (method) {
    case 'host/session-added': {
      if (typeof p.sessionId !== 'string' || typeof p.blank !== 'boolean') return null
      return {
        type: method,
        sessionId: p.sessionId,
        blank: p.blank,
        ...(typeof p.parentSessionId === 'string' ? { parentSessionId: p.parentSessionId } : {}),
        ...(typeof p.origin === 'string' ? { origin: p.origin } : {}),
        ...(typeof p.agentPreset === 'string' ? { agentPreset: p.agentPreset } : {}),
      }
    }
    case 'host/session-removed':
      return typeof p.sessionId === 'string' ? { type: method, sessionId: p.sessionId } : null
    case 'host/session-status':
      return typeof p.sessionId === 'string' && typeof p.running === 'boolean'
        ? { type: method, sessionId: p.sessionId, running: p.running }
        : null
    case 'host/workspace-changed': {
      const w = p.workspace as Record<string, unknown> | undefined
      if (!w || typeof w !== 'object') return null
      if (typeof w.workspaceId !== 'string' || typeof w.path !== 'string') return null
      if (typeof w.title !== 'string' || typeof w.updatedAt !== 'string') return null
      const sessionIds = asStringArray(w.sessionIds)
      if (!sessionIds) return null
      return {
        type: method,
        workspace: { workspaceId: w.workspaceId, path: w.path, title: w.title, sessionIds, updatedAt: w.updatedAt },
      }
    }
    case 'host/workspace-removed':
      return typeof p.workspaceId === 'string' ? { type: method, workspaceId: p.workspaceId } : null
    case 'host/workspace-order-changed': {
      const workspaceIds = asStringArray(p.workspaceIds)
      return workspaceIds ? { type: method, workspaceIds } : null
    }
    case 'host/archived-sessions-changed': {
      const archivedSessionIds = asStringArray(p.archivedSessionIds)
      return archivedSessionIds ? { type: method, archivedSessionIds } : null
    }
    default:
      return null
  }
}

/** Apply one host frame to the cached baselines; null when nothing changed. */
export function applyHostFrame(state: SessionListState, frame: HostFrame, now: number): SessionListState | null {
  switch (frame.type) {
    case 'host/session-added': {
      const existing = state.sessions.find((s) => s.sessionId === frame.sessionId)
      if (!existing) {
        const added: SessionInput = {
          sessionId: frame.sessionId,
          updatedAt: now,
          running: false,
          blank: frame.blank,
          ...(frame.parentSessionId !== undefined ? { parentSessionId: frame.parentSessionId } : {}),
          ...(frame.origin !== undefined ? { origin: frame.origin } : {}),
          ...(frame.agentPreset !== undefined ? { agentPreset: frame.agentPreset } : {}),
        }
        return { ...state, sessions: [added, ...state.sessions] }
      }
      // 已存在只补缺（官方 upsert 的 fill 规则）：标题/token 不在帧里，保持原值；
      // blank 取与，已开跑的会话不会被创建帧重新置空。
      const filled: SessionInput = {
        ...existing,
        blank: existing.blank && frame.blank,
        ...(existing.parentSessionId === undefined && frame.parentSessionId !== undefined
          ? { parentSessionId: frame.parentSessionId }
          : {}),
        ...(existing.origin === undefined && frame.origin !== undefined ? { origin: frame.origin } : {}),
        ...(frame.agentPreset !== undefined ? { agentPreset: frame.agentPreset } : {}),
      }
      if (
        filled.blank === existing.blank &&
        filled.parentSessionId === existing.parentSessionId &&
        filled.origin === existing.origin &&
        filled.agentPreset === existing.agentPreset
      ) {
        return null
      }
      return {
        ...state,
        sessions: state.sessions.map((s) => (s.sessionId === frame.sessionId ? filled : s)),
      }
    }
    case 'host/session-removed': {
      const existing = state.sessions.find((s) => s.sessionId === frame.sessionId)
      if (!existing) return null
      // durable subagent 规则：continuable 子代理移出列表会让父会话的「N 个子代理」
      // chip 丢行，官方降级为 running:false 保留行。
      if (existing.origin === 'subagent') {
        if (!existing.running) return null
        return {
          ...state,
          sessions: state.sessions.map((s) => (s.sessionId === frame.sessionId ? { ...s, running: false } : s)),
        }
      }
      return { ...state, sessions: state.sessions.filter((s) => s.sessionId !== frame.sessionId) }
    }
    case 'host/session-status': {
      const existing = state.sessions.find((s) => s.sessionId === frame.sessionId)
      if (!existing) return null
      // updatedAt 不动（官方 status mutation 不碰排序键）；running:true 清 blank。
      if (existing.running === frame.running && !(frame.running && existing.blank)) return null
      return {
        ...state,
        sessions: state.sessions.map((s) =>
          s.sessionId === frame.sessionId ? { ...s, running: frame.running, blank: s.blank && !frame.running } : s,
        ),
      }
    }
    case 'host/workspace-changed': {
      const view = frame.workspace
      const index = state.workspaces.findIndex((w) => w.workspaceId === view.workspaceId)
      if (index === -1) return { ...state, workspaces: [view, ...state.workspaces] }
      const installed = state.workspaces[index]
      // 旧帧丢弃（官方 upsert 的 updatedAt 守卫）；两边都可解析时才比较。
      const incoming = Date.parse(view.updatedAt)
      const current = Date.parse(installed.updatedAt)
      if (Number.isFinite(incoming) && Number.isFinite(current) && incoming < current) return null
      if (
        installed.path === view.path &&
        installed.title === view.title &&
        installed.updatedAt === view.updatedAt &&
        installed.sessionIds.length === view.sessionIds.length &&
        installed.sessionIds.every((id, i) => id === view.sessionIds[i])
      ) {
        return null
      }
      return { ...state, workspaces: state.workspaces.map((w, i) => (i === index ? view : w)) }
    }
    case 'host/workspace-removed': {
      const workspaces = state.workspaces.filter((w) => w.workspaceId !== frame.workspaceId)
      return workspaces.length === state.workspaces.length ? null : { ...state, workspaces }
    }
    case 'host/workspace-order-changed': {
      const rank = new Map(frame.workspaceIds.map((id, i) => [id, i]))
      const workspaces = [...state.workspaces].sort(
        (a, b) => (rank.get(a.workspaceId) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.workspaceId) ?? Number.MAX_SAFE_INTEGER),
      )
      return workspaces.every((w, i) => w === state.workspaces[i]) ? null : { ...state, workspaces }
    }
    case 'host/archived-sessions-changed': {
      const archived = new Set(frame.archivedSessionIds)
      if (archived.size === state.archived.size && frame.archivedSessionIds.every((id) => state.archived.has(id))) {
        return null
      }
      return { ...state, archived }
    }
  }
}
