/**
 * Pure helpers for the session-header background-jobs chip（对齐官方
 * dsh-client-ui-jobs 的 JobListAction）：排序、状态呈现、耗时格式化。
 * No `vscode` import — unit-testable with node --test.
 *
 * Data source: mux `session/jobs` frames kept by src/ui/jobsStore.ts
 * （jobsBySession，含已 settled 的 job）。任务看板移除后，头部 chip 下拉
 * 是 jobs 数据的唯一消费方。
 */

/** One background job (bash command, one-shot subagent, …) from session/jobs. */
export interface ActivityJob {
  id: string
  kind: string
  label: string
  /** 'running' | 'stopping' while live; settled: completed/failed/killed. */
  status: string
  /** Host-supplied status detail (e.g. "exit code: 0")；优先于 statusLabel 展示。 */
  detail?: string
  /** Epoch milliseconds. */
  startedAt: number
  /** Epoch milliseconds; present once the job settled. */
  finishedAt?: number
}

/** Live jobs are the ones still doing work; everything else is settled history. */
export function isLiveJob(job: ActivityJob): boolean {
  return job.status === 'running' || job.status === 'stopping'
}

/**
 * 官方 JobListAction 的行序：运行中的在前（按开始时间升序），已结束的按
 * 完成时间降序（finishedAt 缺省回退 startedAt；同毫秒回退开始时间升序）。
 */
export function orderJobs(jobs: readonly ActivityJob[]): ActivityJob[] {
  return [...jobs].sort((a, b) => {
    const aLive = isLiveJob(a)
    if (aLive !== isLiveJob(b)) return aLive ? -1 : 1
    if (aLive) return a.startedAt - b.startedAt
    const finished = (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt)
    return finished !== 0 ? finished : a.startedAt - b.startedAt
  })
}

/**
 * 头部 chip 文案（官方 count.live / count.idle）：有运行中 →「N 个后台任务
 * 运行中」（N = 运行中数），全部已结束 →「N 个后台任务」（N = 总数）；
 * 一个 job 都没有 → null（官方此时不渲染 chip）。
 */
export function jobsChipLabel(jobs: readonly ActivityJob[]): string | null {
  if (jobs.length === 0) return null
  const live = jobs.filter(isLiveJob).length
  return live > 0 ? `${live} 个后台任务运行中` : `${jobs.length} 个后台任务`
}

/** 状态点语义（官方 dotState）：stopping/killed 同为警示色——都是"按请求结束"而非自然完成。 */
export type JobDotState = 'ongoing' | 'warning' | 'done' | 'error'

export function jobDotState(status: string): JobDotState {
  switch (status) {
    case 'running':
      return 'ongoing'
    case 'stopping':
    case 'killed':
      return 'warning'
    case 'failed':
      return 'error'
    // completed 与未知状态都按已结束处理（线网状态是宽松 string）。
    default:
      return 'done'
  }
}

/** 状态中文文案（官方 statusLabel）；未知状态原样返回。 */
export function jobStatusLabel(status: string): string {
  switch (status) {
    case 'running':
      return '运行中'
    case 'stopping':
      return '正在停止'
    case 'completed':
      return '已完成'
    case 'killed':
      return '已取消'
    case 'failed':
      return '已失败'
    default:
      return status
  }
}

/**
 * 耗时格式化（官方 formatDuration 的中文展开）：最多两个相邻单位——
 * 23秒 / 4分58秒 / 1小时2分；超过一小时仍停留在小时（不引入天/月词汇）。
 */
export function formatJobDuration(elapsedMs: number): string {
  const total = Math.max(0, Math.floor(elapsedMs / 1000))
  const seconds = total % 60
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3600)
  if (hours > 0) return `${hours}小时${minutes}分`
  if (minutes > 0) return `${minutes}分${seconds}秒`
  return `${seconds}秒`
}
