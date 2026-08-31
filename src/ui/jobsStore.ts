import * as vscode from 'vscode'
import type { Logger } from '../log.ts'
import type { ServerManager, ServerStatus } from '../server/manager.ts'
import { subscribeMuxEvents } from '../server/muxEvents.ts'
import type { ActivityJob } from '../pure/activityTree.ts'

/** Debounce window for mux-driven change notifications. */
const JOBS_DEBOUNCE_MS = 200

/**
 * Loose mirror of JobView (apiproxy jobs.d.ts), keeping every status — unlike
 * ChatSessionController, which drops settled jobs for the composer strip.
 */
interface JobViewLike {
  id: string
  kind: string
  label: string
  status: string
  detail?: string
  startedAt?: number
  finishedAt?: number
}

/**
 * 后台任务数据层（头部「N 个后台任务」chip 的下拉数据源）：WS /api/events.mux
 * 是全局广播——连接时 host 重放所有会话的 session/jobs 基线（含已 settled 的
 * job），之后增量推送；这里不过滤 sessionId，把帧按 owner 会话折叠成
 * jobsBySession（空 jobs 数组 = 该会话任务清空，删除 key）。这条通道就是官方
 * web 客户端的正规渠道：dsh-client-connection 的 WebApiClient.openMux 打开同一
 * 个 /api/events.mux 下行（MUX_EVENTS_PATH），dsh-client-ui-jobs 的
 * JobListAction 读的 jobsBySession 正是由 session/jobs 帧喂出来的。
 * 生命周期对齐 SessionsStore：跟随 manager.onDidChangeState 的 url 订阅/退订。
 * 已知限制：mux 无重连（docs/backlog/mux-reconnect.md），断流后任务列表随之停滞。
 */
export class JobsStore implements vscode.Disposable {
  private jobsBySession = new Map<string, ActivityJob[]>()
  private url: string | null = null
  private mux: vscode.Disposable | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private readonly stateSub: vscode.Disposable
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>()
  /** Fired (debounced) after any jobs snapshot changed, including server down. */
  readonly onDidChange = this.onDidChangeEmitter.event

  constructor(
    private readonly manager: ServerManager,
    private readonly logger: Logger,
  ) {
    this.stateSub = manager.onDidChangeState((status) => this.onStateChange(status))
    this.onStateChange(manager.getStatus())
  }

  /** Current jobs baseline keyed by owner session id, for buildActivityTree. */
  jobs(): ReadonlyMap<string, readonly ActivityJob[]> {
    return this.jobsBySession
  }

  private onStateChange(status: ServerStatus): void {
    const url = status.state === 'running' && status.url ? status.url : null
    if (url === this.url) return
    this.url = url
    this.mux?.dispose()
    this.mux = null
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    if (url) {
      this.mux = subscribeMuxEvents(url, this.logger, (frame) => this.onFrame(frame.method, frame.payload))
    } else if (this.jobsBySession.size > 0) {
      this.jobsBySession = new Map()
      this.onDidChangeEmitter.fire()
    }
  }

  private onFrame(method: string, payload: unknown): void {
    if (method !== 'session/jobs') return
    const p = (payload ?? {}) as Record<string, unknown>
    const sessionId = typeof p.sessionId === 'string' ? p.sessionId : null
    if (!sessionId) return
    // Whole-snapshot replacement per session; an empty array clears the key.
    const jobs = Array.isArray(p.jobs) ? (p.jobs as JobViewLike[]) : []
    if (jobs.length === 0) {
      if (!this.jobsBySession.delete(sessionId)) return
    } else {
      this.jobsBySession.set(
        sessionId,
        jobs.map((j) => ({
          id: String(j.id),
          kind: String(j.kind),
          label: String(j.label),
          status: String(j.status),
          startedAt: typeof j.startedAt === 'number' ? j.startedAt : Date.now(),
          ...(j.detail ? { detail: String(j.detail) } : {}),
          ...(typeof j.finishedAt === 'number' ? { finishedAt: j.finishedAt } : {}),
        })),
      )
    }
    this.scheduleFire()
  }

  private scheduleFire(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      this.onDidChangeEmitter.fire()
    }, JOBS_DEBOUNCE_MS)
  }

  dispose(): void {
    this.stateSub.dispose()
    this.mux?.dispose()
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.onDidChangeEmitter.dispose()
  }
}
