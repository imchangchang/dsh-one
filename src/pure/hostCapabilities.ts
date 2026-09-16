/**
 * 宿主能力口（#84）的**线协议契约**：调用名、参数形状、参数校核与错误口径。
 *
 * 「宿主能力口」= 前端插件向「宿主那一侧」要能力的唯一入口。两侧各有一份实现
 * （VS Code 侧 = 扩展宿主的能力桥；官方 web 侧 = **宿主半插件**，跑在 dsh 宿主
 * 进程里，经官方 RPC 机制暴露），前端插件只调抽象口、不碰宿主细节，所以同一份
 * 插件两端都能用（AGENTS.md 铁律「能移植的必须移植」）。
 *
 * 本模块是纯逻辑（不依赖 node / vscode / cordis），三处共用：
 * - 宿主半插件 `packages/dsh-host-capabilities/src/`（线协议的服务端）；
 * - 前端 SDK `src/ui/assembly/shell/hostCapabilities.ts`（线协议的客户端）；
 * - 扩展侧能力桥 `src/ui/assembly/hostBridge.ts`（VS Code 侧同一口的实现）。
 *
 * ## 走第几层机制（AGENTS.md「官方机制优先」）
 * 官方侧走**层 2（官方服务 API）**：宿主半是一个 cordis 插件，把能力注册成
 * `TypertRemoteService` 形态的 Remote 服务（官方 `@deepseek-ai/dsh-typert-protocol`
 * 的 `@Remote` 装饰器 + `bindTypertRemote`，出处该包 README「Exposing a Host method」），
 * 由官方 api-gateway 的 SRC 发现路径（`collectSrcClaims`，见
 * `dsh-api-gateway/lib/index.js`）挂上 `<namespace>/<method>` 端点；客户端用官方
 * Connection 的公开 RPC 口 `ctx.connection.rpc.call('/api', '<ns>/<method>', { args })`
 * 调用——与官方生成版客户端 `dsh-api-gateway/lib/client.js` 的调用形态逐字一致
 * （`connection.rpc.call("/api", endpoint, { args: prepared.args }, signal)`），
 * 只是省掉「生成 typert 描述文件」这一步，走官方给第三方预留的 SRC 回退。
 *
 * ## 错误回传形态（实测，见 #84 的验证记录）
 * SRC 模式下**抛出的异常一律折叠成 `gateway/internal`**（业务 code 不过线），
 * 所以能力方法一律**返回结构化结果**而不抛：
 *
 *   成功：{ ok: true, ... }        失败：{ ok: false, error: { code, message } }
 *
 * 另外两种失败由网关自己产生，SDK 按形态归类：参数键与描述符不符 →
 * `gateway/arguments-invalid`；端点无人认领（宿主半没装）→ HTTP 404（载体抛错）。
 */
import type { HostCallError, HostCallErrorCode } from './hostCallError.ts'
import { asRecord, isHostCallError } from './hostCallError.ts'

/**
 * 宿主半的 cordis 服务名，同时也是 Remote 的线命名空间（官方 `TypertRemoteService`
 * 默认「服务名 = 命名空间」）。端点全名 = `<服务名>/<方法名>`。
 */
export const HOST_CAPABILITY_SERVICE = 'dshOneHostCapabilities'

/** 能力方法名（线协议的 `<方法名>` 段，也是宿主半的实例方法名——SRC 按参数名取值）。 */
export const HOST_CAPABILITY_METHODS = {
  /** 读持久状态（键 → JSON 值）。 */
  stateRead: 'stateRead',
  /** 写持久状态。 */
  stateWrite: 'stateWrite',
  /** 删持久状态。 */
  stateDelete: 'stateDelete',
  /** 只读 git 提交查询（沿用能力桥的安全口径）。 */
  gitShow: 'gitShow',
  /** 把一段内容写到宿主的用户可见位置。 */
  saveContent: 'saveContent',
} as const

export type HostCapabilityMethod = keyof typeof HOST_CAPABILITY_METHODS

/** 端点全名（`<命名空间>/<方法>`）。 */
export function capabilityEndpoint(method: HostCapabilityMethod): string {
  return `${HOST_CAPABILITY_SERVICE}/${method}`
}

/** 能力错误码：能力桥既有的码（`hostCalls.ts`，VS Code 侧与宿主半共用一套口径）
 * 加能力口自己的几个。 */
export type HostCapabilityErrorCode =
  | HostCallErrorCode
  /** 页面所在的 shell 既没有能力桥也没有可用宿主半（抽象口无实现）。 */
  | 'unavailable'
  /** 调用名不在能力表里。 */
  | 'unknown-capability'
  /** 状态值不是合法 JSON（不能过线）。 */
  | 'invalid-value'
  /** 用户在保存对话框里取消（不是失败，消费方通常静默）。 */
  | 'cancelled'

/** 能力错误体（码的集合比能力桥的错误码更宽，含能力口自己的四个码）。 */
export interface HostCapabilityError {
  code: HostCapabilityErrorCode
  message: string
}

/** 能力失败体（结构化，不解析 message）。 */
export interface HostCapabilityFailure {
  ok: false
  error: HostCapabilityError
}

/** 能力成功体（各能力自己的载荷展开在同层）。 */
export type HostCapabilitySuccess<T> = { ok: true } & T

/** 能力回执（宿主半方法的返回形状）。 */
export type HostCapabilityResult<T> = HostCapabilitySuccess<T> | HostCapabilityFailure

/** 只回「成功 / 失败」、不带载荷的能力回执。 */
export type HostCapabilityAck = { ok: true } | HostCapabilityFailure

/** 构造失败回执。 */
export function failure(code: HostCapabilityErrorCode, message: string): HostCapabilityFailure {
  return { ok: false, error: { code, message } }
}

/** 失败回执判定（成功回执里不会出现 `ok: false`）。 */
export function isCapabilityFailure(value: unknown): value is HostCapabilityFailure {
  if (typeof value !== 'object' || value === null) return false
  const record = value as { ok?: unknown; error?: unknown }
  return record.ok === false && isHostCallError(record.error)
}

/* ------------------------------------------------------------------ *
 * 参数校核——页面送来的 args 是不可信输入，宿主半先校核再动作。
 * ------------------------------------------------------------------ */

/**
 * 状态键：插件自有的键名（形如 `sidebar.recycle-bin`）。只允许小写字母数字与
 * `._-`，长度有界——键直接决定 `~/.dsh/dsh-one/<键>.json` 的文件名，所以这里
 * 同时是**路径穿越的唯一闸门**（不允许 `/`、`\`、`..`、空键）。
 */
export const STATE_KEY_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/

/** 校核状态键。 */
export function parseStateKey(value: unknown): string | HostCallError {
  if (typeof value !== 'string' || !STATE_KEY_RE.test(value) || value.includes('..')) {
    return { code: 'invalid-args', message: 'expected a state key matching [a-z0-9][a-z0-9._-]{0,63}' }
  }
  return value
}

/**
 * 校核「能过线的 JSON 值」：JSON.stringify 能序列化、且往返后形状不变
 * （undefined / 函数 / BigInt / 循环引用都过不了）。
 */
export function parseStateValue(value: unknown): string | HostCapabilityError {
  let text: string | undefined
  try {
    text = JSON.stringify(value)
  } catch {
    return { code: 'invalid-value', message: 'the state value is not JSON-serializable' }
  }
  if (text === undefined) return { code: 'invalid-value', message: 'the state value is not JSON-serializable' }
  return text
}

/**
 * 校核落盘用的文件名：只取基名，禁路径分隔符与 `..`，长度有界（防写穿目录）。
 * 返回规整后的文件名。
 */
export function parseSuggestedName(value: unknown): string | HostCallError {
  if (typeof value !== 'string' || value === '' || value.length > 128) {
    return { code: 'invalid-args', message: 'expected a file name of 1-128 characters' }
  }
  if (value.includes('/') || value.includes('\\') || value.includes('\0') || value === '.' || value.includes('..')) {
    return { code: 'invalid-args', message: 'the file name must not contain a path separator or ".."' }
  }
  return value
}

/** 内容上限（base64 文本长度，约 48MB 原字节）：线协议一次调用能带的量级。 */
export const SAVE_CONTENT_MAX_BASE64 = 64 * 1024 * 1024

/** base64 文本的基本形状校核（严格解码交给消费方，避免在这里做一次 48MB 的解码）。 */
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/

/** 校核落盘内容的 base64 文本。 */
export function parseBase64(value: unknown): string | HostCallError {
  if (typeof value !== 'string') return { code: 'invalid-args', message: 'expected base64 text' }
  if (value.length === 0 || value.length > SAVE_CONTENT_MAX_BASE64 || value.length % 4 !== 0 || !BASE64_RE.test(value)) {
    return { code: 'invalid-args', message: 'expected non-empty base64 text within the size cap' }
  }
  return value
}

/* ------------------------------------------------------------------ *
 * 「取网关上的一条内容并交给用户」与「把一段内容落盘」两项宿主能力的参数。
 * 两边（VS Code 能力桥 / 宿主半）共用同一份校核，口径不会漂。
 * ------------------------------------------------------------------ */

/** `file.download` 的参数：网关上的一条路径 + 建议文件名。 */
export interface DownloadArgs {
  /** 网关同源的绝对路径（如 `/api/session.export?sessionId=…`）。 */
  path: string
  /** 建议文件名（保存对话框的默认名）。 */
  suggestedName: string
}

/** `file.save` 的参数：建议文件名 + 内容。 */
export interface SaveFileArgs {
  suggestedName: string
  base64: string
}

/** 路径长度上限（够放下导出等网关路径）。 */
export const DOWNLOAD_PATH_MAX = 2048

/**
 * 校核 `file.download` 的路径：必须是**本站绝对路径**——以 `/` 开头、不以 `//`
 * 开头（协议相对 URL 会跳到别的源）、不含 `..` 段、不含反斜杠与控制字符。
 * 页面送来的路径是外部输入，这里是唯一闸门；宿主再用 `new URL(path, origin)`
 * 复核一次落点仍是同一个源。
 */
export function parseDownloadPath(value: unknown): string | HostCallError {
  if (typeof value !== 'string' || value === '' || value.length > DOWNLOAD_PATH_MAX) {
    return { code: 'invalid-args', message: 'expected a same-origin absolute path' }
  }
  if (!value.startsWith('/') || value.startsWith('//')) {
    return { code: 'invalid-args', message: 'the download path must be an absolute path on the connected gateway' }
  }
  // eslint-disable-next-line no-control-regex -- 控制字符必须拒（路径要进 HTTP 请求与日志）
  if (/[\\\u0000-\u001f\u007f]/.test(value) || value.split('/').includes('..')) {
    return { code: 'invalid-args', message: 'the download path must not contain backslashes, control characters, or ".."' }
  }
  return value
}

/** 校核 `file.download` 的参数。 */
export function parseDownloadArgs(args: unknown): DownloadArgs | HostCallError {
  const record = asRecord(args)
  if (record === undefined) return { code: 'invalid-args', message: 'expected an object argument' }
  const path = parseDownloadPath(record.path)
  if (typeof path !== 'string') return path
  const suggestedName = parseSuggestedName(record.suggestedName)
  if (typeof suggestedName !== 'string') return suggestedName
  return { path, suggestedName }
}

/** 校核 `file.save` 的参数。 */
export function parseSaveFileArgs(args: unknown): SaveFileArgs | HostCallError {
  const record = asRecord(args)
  if (record === undefined) return { code: 'invalid-args', message: 'expected an object argument' }
  const suggestedName = parseSuggestedName(record.suggestedName)
  if (typeof suggestedName !== 'string') return suggestedName
  const base64 = parseBase64(record.base64)
  if (typeof base64 !== 'string') return base64
  return { suggestedName, base64 }
}
