/**
 * Workflow run folding: collapses the four durable `tool-workflow/*` session
 * events into renderable workflow-run cards (dsh web WorkflowRunPanel's
 * simplified projection, src/pure/chatContract.ts `ChatState.workflowRuns`).
 * Pure logic — no `vscode` import.
 *
 * Event shapes are loose mirrors of dsh-tool-workflow's types
 * (ToolWorkflowRunStartData / AgentStartData / AgentEndData / RunEndData),
 * read defensively like everything else in this repo:
 *   tool-workflow/run-start    { runId, name }
 *   tool-workflow/agent-start  { runId, seq, label, phase?, childId }
 *   tool-workflow/agent-end    { runId, seq, outcome }        // completed|cancelled|failed
 *   tool-workflow/run-end      { runId, stopReason }          // completed|cancelled|error
 *
 * The folder keeps the raw events per runId and projects on demand, so a
 * run-start that arrives later (「加载更早」 brings in an older page) rebuilds
 * the whole run from its full event list — the official client's "update 历史
 * 尾页 pending，直到更早页面补入唯一 start" semantics, without a durable node
 * engine.
 */
import type { HistoryEntryLike, SessionEventLike } from './conversation.ts'
import type { L10nFn } from './sessionTree.ts'
import { enFallback } from './sessionTree.ts'

/** Run / member status, five values like the official WorkflowRunStatus. */
export type WorkflowRunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
export type WorkflowMemberStatus = WorkflowRunStatus

export interface WorkflowRunMemberView {
  /** The member's seq within the run (agent-start's `seq`), not the session event seq. */
  seq: number
  label: string
  childId: string
  status: WorkflowMemberStatus
}

export interface WorkflowRunPhaseView {
  /** Stable identity (workflowPhaseKey), used by the disclosure machine and React-style keys. */
  key: string
  /** The phase string; null = the member carried no phase (a distinct identity from ""). */
  phase: string | null
  /** Members in agent-start (seq) order. */
  members: WorkflowRunMemberView[]
}

/** One workflow run card, projected from its folded events. */
export interface WorkflowRunView {
  /** The fold's runId: stable key for the webview's disclosure state. */
  runId: string
  name: string
  status: WorkflowRunStatus
  /**
   * Seq of the run's last folded session event. The webview interleaves the
   * card into the message flow after the first message whose seq ≥ this.
   */
  anchorSeq: number
  phases: WorkflowRunPhaseView[]
}

/** 状态 → 展示文案（key=英文默认串；宿主/webview 各自过 l10n）。 */
export const WORKFLOW_STATUS_TEXT: Record<WorkflowRunStatus, string> = {
  running: 'Running',
  completed: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
  interrupted: 'Interrupted',
}

/** 状态 → 徽标点语义（官方 dotState：completed 绿、failed 红、cancelled/interrupted 黄、running 动画矩阵）。 */
export type WorkflowDotState = 'ongoing' | 'done' | 'warning' | 'error'
export function workflowDotState(status: WorkflowRunStatus): WorkflowDotState {
  if (status === 'running') return 'ongoing'
  if (status === 'completed') return 'done'
  if (status === 'failed') return 'error'
  return 'warning'
}

function isAbnormalStatus(status: WorkflowRunStatus): boolean {
  return status === 'failed' || status === 'cancelled' || status === 'interrupted'
}

/**
 * Phase 聚合状态文案（官方 phaseStatusSummary）：挑有计数的状态按
 * 运行中/失败/已取消/已中断 排前、已完成垫底，用「 · 」连接；有 interrupted
 * 且也有 completed 时 completed 前置（「已完成 1 · 已中断 1」）。
 * 例：2 运行中 + 1 已完成 → 「运行中 2 · 已完成 1」；全部完成 → 「已完成 N」。
 */
export function workflowPhaseStatusSummary(
  members: readonly WorkflowRunMemberView[],
  t: L10nFn = enFallback,
): string {
  const counts: Record<WorkflowRunStatus, number> = { running: 0, completed: 0, failed: 0, cancelled: 0, interrupted: 0 }
  for (const m of members) counts[m.status] += 1
  const active: WorkflowRunStatus[] = ['running', 'failed', 'cancelled', 'interrupted']
  const order: WorkflowRunStatus[] =
    counts.interrupted > 0 && counts.completed > 0
      ? ['completed', ...active]
      : counts.completed > 0
        ? [...active, 'completed']
        : active
  return order
    .filter((s) => counts[s] > 0)
    .map((s) => `${t(WORKFLOW_STATUS_TEXT[s])} ${counts[s]}`)
    .join(' · ')
}

/**
 * 状态驱动展开/折叠状态机的 facts（官方 runDisclosureFacts / phaseDisclosureFacts）：
 * mode 三态 —— 有异常成员（failed/cancelled/interrupted）→ abnormal；否则有
 * running → running；否则 clean。activityCount = 本层成员总数。
 */
export interface WorkflowDisclosureFacts {
  mode: 'abnormal' | 'running' | 'clean'
  activityCount: number
}

export function workflowPhaseFacts(phase: WorkflowRunPhaseView): WorkflowDisclosureFacts {
  const count = phase.members.length
  if (phase.members.some((m) => isAbnormalStatus(m.status))) return { mode: 'abnormal', activityCount: count }
  if (phase.members.some((m) => m.status === 'running')) return { mode: 'running', activityCount: count }
  return { mode: 'clean', activityCount: count }
}

export function workflowRunFacts(run: WorkflowRunView): WorkflowDisclosureFacts {
  const count = run.phases.reduce((n, p) => n + p.members.length, 0)
  const phases = run.phases.map(workflowPhaseFacts)
  if (isAbnormalStatus(run.status) || phases.some((f) => f.mode === 'abnormal')) return { mode: 'abnormal', activityCount: count }
  if (run.status === 'running' || phases.some((f) => f.mode === 'running')) return { mode: 'running', activityCount: count }
  return { mode: 'clean', activityCount: count }
}

/** One layer's disclosure state, persisted across snapshot renders. */
export interface WorkflowDisclosureState {
  open: boolean
  mode: 'abnormal' | 'running' | 'clean'
  activityCount: number
}

/**
 * facts 变化时推进状态（官方 advanceDisclosureState 的简化版，dsh-one 卡片内
 * 无可聚焦内容，省去 pendingCleanCollapse 的延迟折叠；`prev` 缺省即初始状态，
 * 对应官方 initialDisclosureState 的「非 clean 默认展开」）：
 * - facts 没变 → 保持现状（用户手动选择优先）；
 * - 变 clean（全部完成）→ 收拢；
 * - 从 clean 变非 clean（新成员开始）或从非 abnormal 变 abnormal → 自动展开；
 * - 其他运行中更新 → 保持用户当前选择。
 */
export function advanceWorkflowDisclosure(
  prev: WorkflowDisclosureState | undefined,
  facts: WorkflowDisclosureFacts,
): WorkflowDisclosureState {
  if (prev && prev.mode === facts.mode && prev.activityCount === facts.activityCount) return prev
  let open: boolean
  if (facts.mode === 'clean') open = false
  else if (!prev || prev.mode === 'clean' || (prev.mode !== 'abnormal' && facts.mode === 'abnormal')) open = true
  else open = prev.open
  return { open, mode: facts.mode, activityCount: facts.activityCount }
}

/** 用户手动 toggle（清掉 pendingCollapse 语义在简化版里不存在，直接翻转）。 */
export function toggleWorkflowDisclosure(prev: WorkflowDisclosureState): WorkflowDisclosureState {
  return { ...prev, open: !prev.open }
}

/** 分组 key（官方 workflowPhaseKey）：null 与空字符串是两种身份，长度+内容防碰撞。 */
export function workflowPhaseKey(phase: string | null): string {
  return phase === null ? 'missing' : `value:${phase.length}:${phase}`
}

interface ToolWorkflowEvent {
  type: 'run-start' | 'agent-start' | 'agent-end' | 'run-end'
  /** The session event seq, used for chat-flow placement. */
  seq: number
  runId: string
  data: Record<string, unknown>
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined
}

/** Narrow a session event to the tool-workflow subset; null for anything else. */
function asWorkflowEvent(event: SessionEventLike): ToolWorkflowEvent | null {
  const type = event.type
  const kind =
    type === 'tool-workflow/run-start'
      ? 'run-start'
      : type === 'tool-workflow/agent-start'
        ? 'agent-start'
        : type === 'tool-workflow/agent-end'
          ? 'agent-end'
          : type === 'tool-workflow/run-end'
            ? 'run-end'
            : null
  if (!kind || typeof event.seq !== 'number') return null
  const data = (event.data ?? {}) as Record<string, unknown>
  if (typeof data.runId !== 'string' || !data.runId) return null
  return { type: kind, seq: event.seq, runId: data.runId, data }
}

interface MemberState {
  seq: number
  label: string
  childId: string
  phase: string | null
  outcome?: 'completed' | 'cancelled' | 'failed'
}

function outcomeOf(v: unknown): 'completed' | 'cancelled' | 'failed' | undefined {
  if (v === 'completed' || v === 'cancelled' || v === 'failed') return v
  return undefined
}

function statusFromOutcome(outcome: MemberState['outcome']): WorkflowMemberStatus {
  if (outcome === 'completed' || outcome === 'cancelled' || outcome === 'failed') return outcome
  return 'running'
}

function statusFromStopReason(stopReason: string | undefined): WorkflowRunStatus {
  if (stopReason === 'completed' || stopReason === 'cancelled') return stopReason
  if (stopReason === 'error') return 'failed'
  return 'running'
}

/** Project one run's raw events into the renderable view; null until a run-start is known. */
function projectRun(runId: string, events: readonly ToolWorkflowEvent[]): WorkflowRunView | null {
  let started = false
  let name = ''
  let stopReason: string | undefined
  let anchorSeq = -1
  const members = new Map<number, MemberState>()
  for (const ev of events) {
    if (ev.seq > anchorSeq) anchorSeq = ev.seq
    switch (ev.type) {
      case 'run-start':
        started = true
        name = str(ev.data.name) ?? ''
        break
      case 'agent-start': {
        const seq = typeof ev.data.seq === 'number' ? ev.data.seq : undefined
        if (seq === undefined || members.has(seq)) break
        members.set(seq, {
          seq,
          label: str(ev.data.label) ?? '',
          childId: str(ev.data.childId) ?? '',
          phase: typeof ev.data.phase === 'string' ? ev.data.phase : null,
        })
        break
      }
      case 'agent-end': {
        const seq = typeof ev.data.seq === 'number' ? ev.data.seq : undefined
        const member = seq !== undefined ? members.get(seq) : undefined
        if (member) member.outcome = outcomeOf(ev.data.outcome)
        break
      }
      case 'run-end':
        stopReason = str(ev.data.stopReason) ?? undefined
        break
    }
  }
  if (!started) return null
  const byKey = new Map<string, WorkflowRunPhaseView>()
  for (const m of members.values()) {
    const key = workflowPhaseKey(m.phase)
    let phase = byKey.get(key)
    if (!phase) {
      phase = { key, phase: m.phase, members: [] }
      byKey.set(key, phase)
    }
    phase.members.push({ seq: m.seq, label: m.label, childId: m.childId, status: statusFromOutcome(m.outcome) })
  }
  return {
    runId,
    name,
    status: statusFromStopReason(stopReason),
    anchorSeq,
    phases: [...byKey.values()],
  }
}

/**
 * Stateful folder over one session's tool-workflow events. Feed it a history
 * window with applyHistory (full reset — the reconnect baseline), older pages
 * with prependHistory, and live events with applyEvent. Raw events are kept
 * per runId; view() projects on demand, so paging in a missing run-start
 * rebuilds the whole run automatically.
 */
export class WorkflowRunFolder {
  private runs = new Map<string, ToolWorkflowEvent[]>()

  /** Reset and fold a full history window (initial load / re-baseline). */
  applyHistory(entries: readonly HistoryEntryLike[]): void {
    this.runs.clear()
    for (const entry of entries) this.applyEvent(entry.event)
  }

  /**
   * Prepend an older history page (「加载更早」). The host guarantees the page
   * connects to the current window (pageMeetsWindow), so every older event
   * precedes every already-folded one: per run the older events go in front,
   * and the projected view rebuilds from the full list (missing run-start
   * 补入后整段重建).
   */
  prependHistory(entries: readonly HistoryEntryLike[]): void {
    if (entries.length === 0) return
    const older = new Map<string, ToolWorkflowEvent[]>()
    for (const entry of entries) {
      const ev = asWorkflowEvent(entry.event)
      if (!ev) continue
      let list = older.get(ev.runId)
      if (!list) {
        list = []
        older.set(ev.runId, list)
      }
      list.push(ev)
    }
    for (const [runId, pageEvents] of older) {
      const existing = this.runs.get(runId) ?? []
      this.runs.set(runId, [...pageEvents, ...existing])
    }
  }

  /** Fold one live/baseline event; returns true when it was a tool-workflow event. */
  applyEvent(event: SessionEventLike): boolean {
    const ev = asWorkflowEvent(event)
    if (!ev) return false
    let list = this.runs.get(ev.runId)
    if (!list) {
      list = []
      this.runs.set(ev.runId, list)
    }
    list.push(ev)
    return true
  }

  /** Projected runs (only those with a run-start), sorted by anchorSeq ascending. */
  view(): WorkflowRunView[] {
    const out: WorkflowRunView[] = []
    for (const [runId, events] of this.runs) {
      const run = projectRun(runId, events)
      if (run) out.push(run)
    }
    out.sort((a, b) => a.anchorSeq - b.anchorSeq)
    return out
  }
}
