/**
 * Loopback tag-bridge 的纯数据模型（No `vscode` import — unit-testable with node --test）。
 *
 * 派生脚本 `--tag` 不再由 agent 进程直接写 `~/.dsh/dsh-one/tags.json`（工作区外、
 * 被 dsh 文件沙箱拦），改为 POST 扩展起的 127.0.0.1 loopback 端点，由扩展进程
 * 代写。端点的能力**必须窄于被拦的动作**：只认 `{group, sessionIds}` 这一种形状，
 * 不做任何路径/内容写入。这里就是那条窄边界的校验逻辑——独立于 http 壳与 store,
 * 用纯函数钉死「什么请求会被接受、什么被拒绝」。
 *
 * 文件 IO 与 http 壳在 src/server/tagBridge.ts；store 的找/建组与批量归属在
 * sessionsStore.assignTagGroup。本模块只保留可离屏单测的部分。
 */

/** bridge.json 的共享记录：扩展每次激活起 127.0.0.1 随机端口 + 每进程随机 token。 */
export interface TagBridgeRecord {
  port: number
  token: string
}

/** 被接受（归一化后）的桥请求。 */
export interface TagBridgeRequest {
  /** 标签组名（对应侧栏一个自定义组）。 */
  group: string
  /** 要归入该组的 sessionId 列表。 */
  sessionIds: string[]
}

/** 校验失败的错误码（HTTP 层映射成 4xx + 对应 message）。 */
export type TagBridgeParseError =
  | 'bad-request' // 不是对象 / 数组 / 字段缺失或错型
  | 'empty-group' // 组名缺失或 trim 后为空
  | 'bad-session-ids' // sessionIds 不是数组，或含非字符串/空串
  | 'no-sessions' // sessionIds 为空

export type TagBridgeParseResult =
  | { ok: true; value: TagBridgeRequest }
  | { ok: false; error: TagBridgeParseError }

/**
 * 校验桥请求体：只接受 `{group: string, sessionIds: string[]}` 一种形状，其余一律
 * 拒绝。这是「能力必须窄」的落点——不接受任意路径/内容，防 agent 被注入时变成
 * 沙箱逃逸口。组名 trim 后返回；sessionIds 逐项校验非空字符串。
 */
export function parseTagBridgeRequest(raw: unknown): TagBridgeParseResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, error: 'bad-request' }
  const rec = raw as Record<string, unknown>
  const group = rec['group']
  if (typeof group !== 'string' || group.trim() === '') return { ok: false, error: 'empty-group' }
  const sessionIds = rec['sessionIds']
  if (
    !Array.isArray(sessionIds) ||
    sessionIds.some((s) => typeof s !== 'string' || s.trim() === '')
  ) {
    return { ok: false, error: 'bad-session-ids' }
  }
  if (sessionIds.length === 0) return { ok: false, error: 'no-sessions' }
  return { ok: true, value: { group: group.trim(), sessionIds: sessionIds as string[] } }
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
