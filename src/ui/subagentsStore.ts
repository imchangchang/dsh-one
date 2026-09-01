import * as vscode from 'vscode'
import type { Logger } from '../log.ts'
import type { ServerManager, ServerStatus } from '../server/manager.ts'
import { listSubagents, type SubagentCatalog } from '../server/dshRpc.ts'
import { subagentCatalogRoots, subagentTreeSignature, type SessionInput } from '../pure/sessionTree.ts'

/**
 * 子代理目录数据层（头部「N 个子代理」chip 下拉行的显示名数据源）：轮询
 * `subagent.list` RPC，按父会话逐个取「直接子代理目录」，用目录里每行的
 * `entry.label ?? entry.id` 作为菜单行显示名（对齐官方 dsh web 的 descriptor
 * label，而不是异步、可能不来的会话自动命名 title）。
 *
 * 血缘嵌套结构仍由 session.list 的 parentSessionId 拼出来（sessionTree 的
 * buildSubagentTree），这里只负责「显示名」这一层。目录按父会话缓存，靠
 * {@link subagentTreeSignature} 判定失效——附着的会话切换或 session.list 基线
 * 变化（新子代理 spawn / 子树重排）使签名变化时重拉相关父目录；60s 相对时间
 * tick 不会触发（签名不变），不会做死缓存也不会反复空拉。服务 url 变化/停止
 * 时清空缓存，等新连接重来。
 *
 * 与官方「按展开懒加载」不同，这里对当前子树的全部父会话一次性拉取（eager），
 * 因为 dsh-one 的下拉是一次性渲染整棵树，不是展开才取。取舍见 backlog 条目。
 */
export class SubagentCatalogStore implements vscode.Disposable {
  private catalogs = new Map<string, SubagentCatalog>()
  /** in-flight 去重家长：避免同一次重建里对同一父会话并发发多个请求。 */
  private inflight = new Map<string, Promise<void>>()
  private url: string | null = null
  /** 上一次已拉取的子树签名；signature 不变则跳过，避免重复拉取。 */
  private lastSignature: string | null = null
  private disposed = false
  private readonly stateSub: vscode.Disposable
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>()
  /** Fired after any catalog update (child label/activity change) or clear. */
  readonly onDidChange = this.onDidChangeEmitter.event

  constructor(
    private readonly manager: ServerManager,
    private readonly logger: Logger,
  ) {
    this.stateSub = manager.onDidChangeState((status) => this.onStateChange(status))
    this.onStateChange(manager.getStatus())
  }

  /**
   * 子代理节点显示名：从已拉取的目录里找该 session 的 entry——label 优先，
   * 缺失（one-shot 可空 label）退回 entry.id。目录里没有该 session（没拉到/
   * 不在目录）返回 null，由调用方回退既有的 title/短 id 逻辑，不降级。
   */
  labelFor(sessionId: string): string | null {
    for (const catalog of this.catalogs.values()) {
      const entry = catalog.entries.find((e) => e.kind === 'child' && e.id === sessionId)
      if (entry) return entry.label && entry.label.length > 0 ? entry.label : entry.id
    }
    return null
  }

  /**
   * 确保 `rootId` 子代理子树所需的父目录已拉取。签名（rootId + 各父会话的
   * 排好序子代理 id 集）不变则跳过——避免 60s 相对时间 tick 反复重拉。签名
   * 变化（附着的会话切换、新子代理 spawn、血缘树变化）时重拉该子树的全部
   * 父目录（eager 一次性取深层）。无子代理时 `subagentCatalogRoots` 为空，
   * 不发任何 RPC。
   */
  ensure(rootId: string, sessions: readonly SessionInput[]): void {
    const url = this.url
    if (!url || !rootId) return
    const signature = subagentTreeSignature(sessions, rootId)
    if (signature === this.lastSignature) return
    this.lastSignature = signature
    for (const parent of subagentCatalogRoots(sessions, rootId)) void this.fetch(url, parent)
  }

  private async fetch(url: string, parentSessionId: string): Promise<void> {
    const existing = this.inflight.get(parentSessionId)
    if (existing) return existing
    const operation = (async () => {
      try {
        const catalog = await listSubagents(url, parentSessionId)
        if (this.disposed || this.url !== url) return
        this.catalogs.set(parentSessionId, catalog)
        this.onDidChangeEmitter.fire()
      } catch (err) {
        // 目录拉取失败：保留既有缓存（若有），显示名回退由 labelFor 走 null
        // → 调用方 title/id。只记日志，不抛（头部显示名是可降级的）。
        this.logger.warn(
          `subagents: subagent.list(${parentSessionId}) failed — ${err instanceof Error ? err.message : err}`,
        )
      } finally {
        this.inflight.delete(parentSessionId)
      }
    })()
    this.inflight.set(parentSessionId, operation)
    return operation
  }

  private onStateChange(status: ServerStatus): void {
    const url = status.state === 'running' && status.url ? status.url : null
    if (url === this.url) return
    this.url = url
    // 连接代际 / 服务停止：旧目录不可信（可能属于别的 host 实例），清空重来。
    if (this.catalogs.size > 0 || this.lastSignature !== null) {
      this.catalogs = new Map()
      this.inflight = new Map()
      this.lastSignature = null
      this.onDidChangeEmitter.fire()
    }
  }

  dispose(): void {
    this.disposed = true
    this.stateSub.dispose()
    this.onDidChangeEmitter.dispose()
  }
}
