/**
 * Loopback tag-bridge 的纯数据模型（No `vscode` import — unit-testable with node --test）。
 *
 * 派生脚本 `--tag` 不再由 agent 进程直接写 `~/.dsh/dsh-one/tags.json`（工作区外、
 * 被 dsh 文件沙箱拦），改为 POST 扩展起的 127.0.0.1 loopback 端点，由扩展进程
 * 代写。端点对 **session 级标签归属** 做增删改查（CRUD）——一个 session 同一时刻
 * 只属于一个组，所以「增/改」是同一个操作（设它的组为 X），「删」= 清空所属组，
 * 「查」= 看它当前在哪个组。
 *
 * 语义明确：每个请求必须显式写 `action`，**无默认行为**。域收敛到「标签组/会话
 * 归属」，每种 action 单独校验，不接任意路径/内容——安全口径与 #18 一致（只绑
 * 127.0.0.1、随机端口、Bearer token）。
 *
 * 文件 IO 与 http 壳在 src/server/tagBridge.ts；store 的读写在 sessionsStore。
 * 本模块只保留可离屏单测的部分。
 */
import type { TagColor } from './sessionTags.ts'

/** bridge.json 的共享记录：扩展每次激活起 127.0.0.1 随机端口 + 每进程随机 token。 */
export interface TagBridgeRecord {
  port: number
  token: string
}

/** 桥支持的操作：assign（增/改，归组）、get（查）、unassign（删，清归属）。 */
export type TagBridgeAction = 'assign' | 'get' | 'unassign'

/** 一个标签组的引用（查/归组结果里标识组）。预设组 name 为 null（显示名走 l10n）。 */
export interface TagGroupRef {
  workspaceId: string
  id: string
  /** 显示名；null = 预设组（todo/doing/done），由调用方按 preset 翻译。 */
  name: string | null
  color: TagColor
  /** 是否预设组。 */
  preset: boolean
}

/** 归一化后的桥请求（已通过校验）。 */
export type TagBridgeRequest =
  | { action: 'assign'; sessionIds: string[]; group?: string; tagId?: string }
  | { action: 'get'; sessionId: string }
  | { action: 'unassign'; sessionIds: string[] }

/** 校验失败的错误码（HTTP 层映射成 4xx + 对应 message）。 */
export type TagBridgeParseError =
  | 'bad-request' // 不是对象 / 数组 / JSON 形态非法
  | 'bad-action' // action 缺失或不是 assign/get/unassign
  | 'empty-group' // assign：给了 group 但 trim 后为空
  | 'empty-tag-id' // assign：给了 tagId 但空
  | 'ambiguous-target' // assign：group 与 tagId 都给了或都没给
  | 'bad-session-ids' // sessionIds 不是数组，或含非字符串/空串
  | 'no-sessions' // sessionIds 为空
  | 'empty-session-id' // get：sessionId 缺失或空

export type TagBridgeParseResult =
  | { ok: true; value: TagBridgeRequest }
  | { ok: false; error: TagBridgeParseError }

/** 校验 sessionIds：非空字符串数组、逐项非空、整体非空。 */
function parseSessionIds(raw: unknown): { ok: true; value: string[] } | { ok: false; error: TagBridgeParseError } {
  if (!Array.isArray(raw) || raw.some((s) => typeof s !== 'string' || s.trim() === '')) {
    return { ok: false, error: 'bad-session-ids' }
  }
  if (raw.length === 0) return { ok: false, error: 'no-sessions' }
  return { ok: true, value: raw as string[] }
}

/**
 * 校验桥请求体：先看 `action` 分流到 assign/get/unassign，各自校验字段形状。
 * 语义明确、无默认——action 缺失或非法一律拒绝。这是「能力窄」的落点：只认标签
 * 组/会话归属相关字段，不接受任意路径/内容。
 */
export function parseTagBridgeRequest(raw: unknown): TagBridgeParseResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, error: 'bad-request' }
  const rec = raw as Record<string, unknown>
  const action = rec['action']
  if (action !== 'assign' && action !== 'get' && action !== 'unassign') return { ok: false, error: 'bad-action' }

  if (action === 'get') {
    const sessionId = rec['sessionId']
    if (typeof sessionId !== 'string' || sessionId.trim() === '') return { ok: false, error: 'empty-session-id' }
    return { ok: true, value: { action, sessionId: sessionId.trim() } }
  }

  // assign / unassign 公共：sessionIds
  const sids = parseSessionIds(rec['sessionIds'])
  if (!sids.ok) return sids
  if (action === 'unassign') {
    return { ok: true, value: { action, sessionIds: sids.value } }
  }

  // assign：恰好一个目标——group（按名找/建）或 tagId（必须存在）。
  const group = rec['group']
  const tagId = rec['tagId']
  const hasGroup = typeof group === 'string' && group.trim() !== ''
  const hasTagId = typeof tagId === 'string' && tagId.trim() !== ''
  if (hasGroup === hasTagId) return { ok: false, error: 'ambiguous-target' }
  if (hasTagId) return { ok: true, value: { action, sessionIds: sids.value, tagId: (tagId as string).trim() } }
  return { ok: true, value: { action, sessionIds: sids.value, group: (group as string).trim() } }
}

/**
 * 宽松解析 bridge.json（`~/.dsh/dsh-one/bridge.json`，扩展进程写）：坏 JSON / 字段
 * 缺失或错型 / 端口不合规 → null（当没有记录处理）。脚本读到 null 应报错指路
 * 「扩展未加载」，而不是静默——null 是「这是 stale/坏记录」的明确信号。
 */
export function parseTagBridgeRecord(raw: unknown): TagBridgeRecord | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const rec = raw as Record<string, unknown>
  const port = rec['port']
  const token = rec['token']
  if (typeof port !== 'number' || !Number.isInteger(port) || port <= 0 || port > 65535) return null
  if (typeof token !== 'string' || token === '') return null
  return { port, token }
}
