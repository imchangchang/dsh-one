import type { Logger } from '../log.ts'
import { permissionDisplayName } from '../pure/permissionLabel.ts'
import type { ModelCatalogValue, SessionModelSelection } from './dshRpc.ts'

export type { ModelCatalogValue }

// ---- 目录数据（session.modelCatalog 的镜像，无 current——current 来自投影） ----

/** Observable lifecycle of the shared catalog. */
export interface ModelCatalogState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  value: ModelCatalogValue | null
  error: string | null
}

export type ModelCatalogListener = () => void

/**
 * 共享模型目录（对齐官方 ModelCatalogDirectory）：0.1.2 起 `session.models`
 * 是 Host 级 unary RPC，整个扩展只拉一次、in-flight 共享，连接重置/服务
 * 重启时失效重拉。controller 的模型 pill 与模型菜单都从这读——打开会话时
 * 目录通常已就绪，首帧即出模型名，不再等「打开后单独 RPC」（旧行为：打开
 * 会话后第一帧 modelLabel 还是 undefined，webview 渲染「选择模型」占位，
 * RPC 返回后才切换，每次打开必闪）。
 */
export class ModelCatalogDirectory {
  private state: ModelCatalogState = { status: 'idle', value: null, error: null }
  private inflight: Promise<ModelCatalogValue> | undefined
  private readonly listeners = new Set<ModelCatalogListener>()
  private url: string | undefined
  private readonly logger: Logger
  private readonly loadRemote: (url: string) => Promise<ModelCatalogValue>

  constructor(logger: Logger, loadRemote: (url: string) => Promise<ModelCatalogValue>) {
    this.logger = logger
    this.loadRemote = loadRemote
  }

  /** Current shared catalog state (plain read, no RPC). */
  read(): ModelCatalogState {
    return this.state
  }

  /** 订阅目录状态变化（ready/error/invalidate 都广播）；返回退订函数。 */
  onDidChange(listener: ModelCatalogListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Ensure the current generation's catalog, sharing one in-flight load.
   * @param url - the running host origin; a change invalidates cached state
   * (new host generation, e.g. restart on another port).
   */
  load(url: string): Promise<ModelCatalogValue> {
    if (this.url !== undefined && this.url !== url && this.state.status !== 'idle') {
      this.invalidate()
    }
    this.url = url
    const cached = this.state.value
    if (this.state.status === 'ready' && cached !== null) return Promise.resolve(cached)
    if (this.inflight !== undefined) return this.inflight
    this.setState({ status: 'loading', value: cached, error: null })
    const operation = this.loadRemote(url)
      .then((value) => {
        if (this.url === url) this.setState({ status: 'ready', value, error: null })
        return value
      })
      .catch((error: unknown) => {
        // 失败保留上次成功目录（stale-but-usable），status 置 error 供
        // webview 区分「加载中」与「确实拿不到」。
        if (this.url === url) {
          const message = error instanceof Error ? error.message : String(error)
          this.setState({ status: 'error', value: cached, error: message })
        }
        throw error
      })
      .finally(() => {
        if (this.inflight === operation) this.inflight = undefined
      })
    this.inflight = operation
    return operation
  }

  /** Invalidate the loaded catalog; the next load refetches (host reset/restart). */
  invalidate(): void {
    this.inflight = undefined
    this.url = undefined
    this.setState({ status: 'idle', value: null, error: null })
  }

  private setState(state: ModelCatalogState): void {
    this.state = state
    for (const listener of [...this.listeners]) listener()
  }
}

/**
 * Footer pill label for the current selection, web style "DeepSeek-V4-Flash
 * High": catalog display name + reasoning effort name, falling back to the
 * raw ids when the route is absent from the (advisory) catalog.
 */
export function modelLabelOf(selection: SessionModelSelection, catalog: ModelCatalogValue): string {
  const group = catalog.groups.find((g) => g.id === selection.provider)
  const model = group?.models.find((m) => m.id === selection.model)
  let label = model?.name ?? selection.model
  const effortId = selection.reasoningEffort ?? model?.reasoning?.defaultEffort
  if (effortId) {
    const effort = model?.reasoning?.efforts.find((e) => e.id === effortId)
    label += ` ${effort?.name ?? permissionDisplayName(effortId)}`
  }
  return label
}
