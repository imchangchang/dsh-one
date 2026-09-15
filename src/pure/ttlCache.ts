/**
 * 极小的 TTL 缓存（#65 批 1 返修 2）：宿主侧的查询缓存共用一份实现。
 *
 * 语义：
 * - 命中且未过期即返回；过期视同未命中；
 * - `load(key, loader)` 做**在途去重**：同一 key 的并发调用共享一次 loader；
 * - **失败不缓存**（loader 抛错 → 该 key 的槽位立刻放开，下次重试）。
 */
export interface TtlCacheOptions {
  /** 缓存时长（毫秒），缺省 5 分钟。 */
  ttlMs?: number
  /** 时钟注入（测试用）。 */
  now?: () => number
}

export interface TtlCache<V> {
  get(key: string): V | undefined
  set(key: string, value: V): void
  /** 命中即返回；未命中执行 loader 并缓存（并发共享同一次 loader）。 */
  load(key: string, loader: () => Promise<V>): Promise<V>
  /** 清空（测试用）。 */
  clear(): void
}

const DEFAULT_TTL_MS = 5 * 60 * 1000

/** 造一个 TTL 缓存。 */
export function createTtlCache<V>(options: TtlCacheOptions = {}): TtlCache<V> {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const now = options.now ?? (() => Date.now())
  const entries = new Map<string, { at: number; value: V }>()
  const inflight = new Map<string, Promise<V>>()

  return {
    get(key) {
      const entry = entries.get(key)
      if (entry === undefined) return undefined
      if (now() - entry.at >= ttlMs) {
        entries.delete(key)
        return undefined
      }
      return entry.value
    },
    set(key, value) {
      entries.set(key, { at: now(), value })
    },
    async load(key, loader) {
      const cached = this.get(key)
      if (cached !== undefined) return cached
      const pending = inflight.get(key)
      if (pending !== undefined) return pending
      const started = loader()
        .then((value) => {
          this.set(key, value)
          return value
        })
        .finally(() => {
          if (inflight.get(key) === started) inflight.delete(key)
        })
      inflight.set(key, started)
      return started
    },
    clear() {
      entries.clear()
      inflight.clear()
    },
  }
}
