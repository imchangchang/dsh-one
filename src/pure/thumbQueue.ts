/**
 * 消息图片懒加载（requestFileThumb / requestAttachment）的宿主侧节流纯逻辑。
 *
 * 背景：一次渲染 N 张图的会话消息时，webview 立即发 N 个请求；宿主每个请求
 * 读**完整**文件（大图单请求可达 MB 级 base64）或拉网络字节，同时开读 N 个
 * 会瞬间打满磁盘/网络并把 N 份 MB 级 base64 全推向 webview。
 *
 * 本模块解决两件事（与 vscode 零耦合，可单测）：
 * - `ThrottledQueue`：并发上限内排队执行，其余等待前面的槽位（跨消息、跨 tab
 *   共享一个队列实例，风暴被摊成「上限个同时干」）。
 * - `runAttempts`：单任务失败/超时最多尝试 `maxAttempts` 次后放弃（失败收敛）。
 *   宿主收敛后回传失败态（见 chatContract fileThumbFailed），webview 不再无限
 *   5s 重发——重发风暴从这里断掉，而不是等 webview 每 5 秒再砸一轮。
 */

/** 节流与重试参数。 */
export interface ThumbFetchOptions {
  /** 同时执行的任务数上限（任务内已含失败重试，槽位被一次尝试占满）。 */
  concurrency: number
  /** 单次尝试的超时；超时按失败计（卡死的读盘/网络不占队列槽位）。 */
  timeoutMs: number
  /** 单任务最大尝试次数（首次 + 重试，1-2 次后放弃）。 */
  maxAttempts: number
  /** 失败后的重试间隔。 */
  retryDelayMs: number
}

/** 默认参数：并发 4（「2-4」档），超时 15s，首次+1 次重试，重试间隔 300ms。 */
export const DEFAULT_THUMB_FETCH: ThumbFetchOptions = {
  concurrency: 4,
  timeoutMs: 15000,
  maxAttempts: 2,
  retryDelayMs: 300,
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 给 Promise 加超时：超时按失败处理（底层操作无法中止，槽位先让出来）。 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  if (ms <= 0) return p
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

/** 串行节流队列：并发上限内立即执行，超出排队；任务结束自动补位。 */
export class ThrottledQueue {
  private readonly limit: number
  private readonly waiting: Array<() => void> = []
  private slots = 0

  constructor(concurrency: number) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error(`ThrottledQueue: concurrency must be a positive integer, got ${concurrency}`)
    }
    this.limit = concurrency
  }

  /** 当前正在执行的任务数（测试/监控用）。 */
  get inFlight(): number {
    return this.slots
  }

  /** 当前排队等槽位的任务数（测试/监控用）。 */
  get queued(): number {
    return this.waiting.length
  }

  /** 排队执行一个任务；task 完成（或失败）时 resolve/reject。 */
  run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = (): void => {
        this.slots++
        task()
          .then(resolve, reject)
          .finally(() => {
            this.slots--
            const next = this.waiting.shift()
            if (next) next()
          })
      }
      if (this.slots < this.limit) {
        start()
      } else {
        this.waiting.push(start)
      }
    })
  }
}

/**
 * 单任务执行：每次尝试带超时；失败后最多重试到 `maxAttempts`（含首次）次，
 * 全部失败抛最后一次错误——调用方由此回传失败态。
 */
export async function runAttempts<T>(
  task: (attempt: number) => Promise<T>,
  opts: Pick<ThumbFetchOptions, 'timeoutMs' | 'maxAttempts' | 'retryDelayMs'>,
): Promise<T> {
  let last: unknown
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await withTimeout(task(attempt), opts.timeoutMs)
    } catch (err) {
      last = err
      if (attempt < opts.maxAttempts) await sleep(opts.retryDelayMs)
    }
  }
  throw last
}
