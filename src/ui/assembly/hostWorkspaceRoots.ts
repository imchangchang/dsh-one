/**
 * 宿主调用通道的「网关注册工作区」允许根（#65 批 1 返修）：git.show 的 cwd
 * 现在可以带**当前会话所属的 dsh 工作区路径**，而那个路径未必是 VS Code 打开的
 * 目录，所以宿主侧的允许根要再加上网关 `workspace/list` 注册的工作区路径。
 *
 * 取值链路是宿主已有的 RPC 通道（dshRpc.listSessions → gateway /api/session/list，
 * 带 serverAuth 的 cookie；取每行的 cwd 当工作区目录），因此不需要页面参与、也不
 * 给页面新增任何能力。
 *
 * 缓存策略：
 * - 成功结果按 `ttlMs`（缺省 5 分钟）缓存；期间每个 git.show 只读内存；
 * - 并发调用共享同一次在途请求（in-flight 去重，避免一屏 hash 悬挂时打爆网关）；
 * - 失败**不缓存**也不抛：返回空表（本次调用回落 VS Code 工作区），下次调用重试；
 * - 缓存的是「路径字符串表」，不缓存 realpath 结果——每个调用方路径仍要过
 *   resolveAllowedDir 的 realpath 包含判定（防 `../` 与符号链接逃逸）。
 */
export interface GatewayWorkspaceRootsOptions {
  /** 取一次网关工作区路径（失败请抛错；本模块会吞掉并返回空表）。 */
  fetchPaths: () => Promise<readonly string[]>
  /** 缓存时长（毫秒），缺省 5 分钟。 */
  ttlMs?: number
  /** 时钟注入（测试用）。 */
  now?: () => number
}

const DEFAULT_TTL_MS = 5 * 60 * 1000

/**
 * 造一个「取允许根」函数：带 TTL 缓存 + 在途去重 + 失败降级。
 * @returns 每次调用返回当前允许的工作区路径表（可能是缓存值或空表）。
 */
export function createGatewayWorkspaceRoots(
  options: GatewayWorkspaceRootsOptions,
): () => Promise<readonly string[]> {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const now = options.now ?? (() => Date.now())
  let cached: { at: number; paths: readonly string[] } | undefined
  let inflight: Promise<readonly string[]> | undefined

  return async (): Promise<readonly string[]> => {
    if (cached !== undefined && now() - cached.at < ttlMs) return cached.paths
    if (inflight !== undefined) return inflight
    const pending = options
      .fetchPaths()
      .then((paths) => {
        cached = { at: now(), paths }
        return paths
      })
      .catch(() => {
        // 取不到（网关没起/未登录/Host 无该能力）：本次空表，且不缓存失败
        return [] as readonly string[]
      })
      .finally(() => {
        if (inflight === pending) inflight = undefined
      })
    inflight = pending
    return pending
  }
}
