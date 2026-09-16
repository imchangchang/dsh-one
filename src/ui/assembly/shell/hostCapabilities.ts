/**
 * 宿主能力口的**前端 SDK**（#84）：自有插件调宿主能力的唯一入口。
 *
 * 插件只写 `const caps = hostCapabilities(ctx)` 然后调 `caps.gitShow(...)` /
 * `caps.stateWrite(...)`，**不直接碰 VS Code API、不直接 postMessage、也不直接
 * 拼网关 RPC**——两侧的实现按能力各自配好（见下），所以同一份插件代码在 VS Code
 * 与官方 web 都能跑（AGENTS.md 铁律「能移植的必须移植」）。
 *
 * ## 每个能力的实现在哪一侧
 *
 * | 能力 | VS Code 侧 | 官方 web 侧 |
 * | --- | --- | --- |
 * | `gitShow` | 扩展宿主能力桥（`hostCall('git.show')`，安全口径在宿主侧） | 宿主半插件（网关 RPC） |
 * | `stateRead/Write/Delete` | **宿主半插件** | **宿主半插件** |
 * | `saveContent` | 扩展宿主弹保存框写盘 | 宿主半插件写宿主磁盘 |
 * | `downloadGatewayFile` | 扩展宿主经 loopback 代理取内容 + 弹保存框 | 浏览器原生 `fetch` + `a[download]` |
 *
 * 三处刻意的取舍（写清楚免得后来人以为是漏配）：
 * 1. **状态两侧同一实现**（都走宿主半）：AGENTS.md 铁律「插件状态按官方惯例存储」
 *    ——同一份用户数据不能有两个家，否则必然漂移（#82 要清的就是这个）。
 * 2. **git 在 VS Code 侧仍走扩展宿主**：行为与今天逐字一致（同一份安全口径代码），
 *    官方侧由宿主半同一份安全口径实现，插件看不到差别；迁移 git-card 时不用动
 *    宿主侧（#83 表里 git-card 那一行的前置条件就是本件）。
 * 3. **`downloadGatewayFile` 官方侧走浏览器原生下载**：浏览器本来就能下载，走宿主
 *    反而绕远；宿主半的「写盘」能力（`saveContent`）管的是没有下载 UX 的场景。
 *
 * ## 调用形态（走第几层机制）
 * 官方侧走**层 2（官方服务 API）**：`ctx.connection.rpc.call('/api', '<ns>/<方法>',
 * { args })` ——官方 Connection 的公开 RPC 口（类型见 `dsh-client-connection` 的
 * `ClientConnectionRpc.call`），与官方生成版客户端
 * （`dsh-api-gateway/lib/client.js`：`connection.rpc.call("/api", endpoint, { args })`）
 * 逐字同形。参数键必须与宿主半的方法形参名完全一致（官方网关 `assertExactArguments`
 * 校核，多余键直接拒），这条靠本模块与宿主半共用 `src/pure/hostCapabilities.ts`
 * 的同一份契约保证。
 *
 * 每个插件各自打包一份本模块（各插件是独立 bundle，没有共享模块作用域）——与
 * 同目录的 hostClient.ts 同一取舍，不为此单起一个 cordis 服务。
 */
import {
  capabilityEndpoint,
  isCapabilityFailure,
  type HostCapabilityErrorCode,
  type HostCapabilityMethod,
} from '../../../pure/hostCapabilities.ts'
import type { CommitInfoResult } from '../../../pure/chatContract.ts'
import { hostCall, hostCallAvailable, type HostCallFailure } from './hostClient.ts'

/** 能力失败：`code` 是结构化错误码（消费方按 code 决定文案，不解析 message）。 */
export interface CapabilityFailure extends Error {
  code: HostCapabilityErrorCode
}

/** cordis ctx 在本模块用到的最小面（`ctx.get(name)` 读服务，无需 inject）。 */
export interface CapabilityContext {
  get(name: string): unknown
}

/** 官方 Connection 服务在本模块用到的最小面（公开 RPC 口）。 */
interface ConnectionRpc {
  call(
    channel: string,
    endpoint: string,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<{ ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }>
}

/** 文档里写的「浏览器原生下载」结果的形状：`path` 为 null 表示由浏览器下载。 */
export interface DownloadResult {
  /** 宿主写盘后的绝对路径；浏览器原生下载时为 null（文件在用户的下载目录）。 */
  path: string | null
}

/** 能力口（插件拿到的对象）。 */
export interface HostCapabilities {
  stateRead(key: string): Promise<unknown>
  stateWrite(key: string, value: unknown): Promise<void>
  stateDelete(key: string): Promise<boolean>
  /** 查一条提交；查不到用结果里的 `found: false` 表达（与能力桥同一形状，不抛错）。 */
  gitShow(args: { hash: string; cwd?: string }): Promise<CommitInfoResult>
  saveContent(args: { suggestedName: string; base64: string }): Promise<{ path: string }>
  downloadGatewayFile(args: { path: string; suggestedName: string }): Promise<DownloadResult>
}

function fail(code: HostCapabilityErrorCode, message: string): CapabilityFailure {
  const error = new Error(message) as CapabilityFailure
  error.code = code
  return error
}

/** 我们自己造的失败（用于区分「载体抛错」与「能力失败」）。 */
function isCapabilityFailureError(value: unknown): value is CapabilityFailure {
  return value instanceof Error && typeof (value as CapabilityFailure).code === 'string'
}

/** 从 cordis ctx 取官方 Connection 的 RPC 口；缺席时给 `unavailable`。 */
function connectionRpc(ctx: CapabilityContext | undefined): ConnectionRpc {
  const connection = ctx?.get('connection') as { rpc?: ConnectionRpc } | undefined
  const rpc = connection?.rpc
  if (rpc === undefined || typeof rpc.call !== 'function') {
    throw fail('unavailable', 'this shell provides no official Connection service')
  }
  return rpc
}

/**
 * 调宿主半的一次能力（官方侧通路）。返回宿主半的载荷（已确认 `ok: true`）。
 *
 * 载体（Connection）在非 2xx 时抛错：**HTTP 404 = 端点无人认领**，也就是宿主半
 * 没装进这个 dsh 实例——归类 `unavailable`，让消费方走降级而不是报「失败」。
 */
async function capabilityCall(
  ctx: CapabilityContext | undefined,
  method: HostCapabilityMethod,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const rpc = connectionRpc(ctx)
  const endpoint = capabilityEndpoint(method)
  let result: Awaited<ReturnType<ConnectionRpc['call']>>
  try {
    result = await rpc.call('/api', endpoint, { args })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/HTTP 404/.test(message)) {
      throw fail('unavailable', `the host half does not serve ${endpoint} in this dsh instance`)
    }
    throw fail('failed', `${endpoint} transport failure: ${message}`)
  }
  if (!result.ok) throw fail('failed', `${endpoint} failed: ${result.error.code}: ${result.error.message}`)
  const payload = result.value
  if (isCapabilityFailure(payload)) throw fail(payload.error.code, payload.error.message)
  if (typeof payload !== 'object' || payload === null || (payload as { ok?: unknown }).ok !== true) {
    throw fail('failed', `${endpoint} returned an unexpected shape`)
  }
  return payload as Record<string, unknown>
}

/** VS Code 侧能力桥调用（把桥的错误码原样透出，消费方两端看到同一套 code）。 */
async function bridgeCall(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  try {
    const data = await hostCall<unknown>(name, args)
    if (typeof data === 'object' && data !== null) return data as Record<string, unknown>
    return {}
  } catch (err) {
    const code = (err as HostCallFailure).code
    const message = err instanceof Error ? err.message : String(err)
    throw fail((code ?? 'failed') as HostCapabilityErrorCode, message)
  }
}

/** 浏览器原生下载（官方 web 侧 `downloadGatewayFile` 的实现）。 */
async function browserDownload(path: string, suggestedName: string): Promise<DownloadResult> {
  const response = await fetch(path)
  if (!response.ok) throw fail('failed', `HTTP ${response.status} while fetching ${path}`)
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = suggestedName
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    // 立刻 revoke 会让部分浏览器来不及取内容；下一轮宏任务回收。
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
  return { path: null }
}

/**
 * 造一个能力口。同一插件进程内可以反复造（无状态，全部状态在宿主侧）。
 * @param ctx - 插件 apply 拿到的 cordis ctx（读官方 Connection 服务用）。
 */
export function hostCapabilities(ctx?: CapabilityContext): HostCapabilities {
  // 每调用一次判一次（不缓存）：页面side SDK 的安装时机取决于外壳注入顺序，直接
  // 判「现在有没有」比在构造时刻定生死稳。
  const viaBridge = (): boolean => hostCallAvailable()
  return {
    async stateRead(key) {
      const payload = await capabilityCall(ctx, 'stateRead', { key })
      return payload.value ?? null
    },
    async stateWrite(key, value) {
      await capabilityCall(ctx, 'stateWrite', { key, value })
    },
    async stateDelete(key) {
      const payload = await capabilityCall(ctx, 'stateDelete', { key })
      return payload.deleted === true
    },
    async gitShow(args) {
      if (viaBridge()) {
        return (await bridgeCall('git.show', { hash: args.hash, cwd: args.cwd })) as unknown as CommitInfoResult
      }
      return (await capabilityCall(ctx, 'gitShow', { hash: args.hash, cwd: args.cwd })) as unknown as CommitInfoResult
    },
    async saveContent(args) {
      if (viaBridge()) {
        const data = await bridgeCall('file.save', { suggestedName: args.suggestedName, base64: args.base64 })
        return { path: String(data.path ?? '') }
      }
      const payload = await capabilityCall(ctx, 'saveContent', args)
      return { path: String(payload.path ?? '') }
    },
    async downloadGatewayFile(args) {
      if (viaBridge()) {
        const data = await bridgeCall('file.download', { path: args.path, suggestedName: args.suggestedName })
        return { path: String(data.path ?? '') }
      }
      return await browserDownload(args.path, args.suggestedName)
    },
  }
}
