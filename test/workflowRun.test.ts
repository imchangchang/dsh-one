import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  WorkflowRunFolder,
  advanceWorkflowDisclosure,
  workflowDotState,
  workflowPhaseFacts,
  workflowPhaseStatusSummary,
  workflowRunFacts,
  type WorkflowRunView,
} from '../src/pure/workflowRun.ts'
import type { HistoryEntryLike, SessionEventLike } from '../src/pure/conversation.ts'

let seq = 0

/** Build a SessionEvent-shaped fixture with a fresh seq. */
function ev(type: string, data: unknown): SessionEventLike {
  seq += 1
  return { type, seq, time: 1_700_000_000_000 + seq, data }
}

function entry(type: string, data: unknown): HistoryEntryLike {
  return { event: ev(type, data) }
}

function runStart(runId: string, name: string): HistoryEntryLike {
  return entry('tool-workflow/run-start', { runId, name })
}

function agentStart(runId: string, agentSeq: number, label: string, childId: string, phase?: string): HistoryEntryLike {
  return entry('tool-workflow/agent-start', { runId, seq: agentSeq, label, phase, childId })
}

function agentEnd(runId: string, agentSeq: number, outcome: string): HistoryEntryLike {
  return entry('tool-workflow/agent-end', { runId, seq: agentSeq, outcome })
}

function runEnd(runId: string, stopReason: string): HistoryEntryLike {
  return entry('tool-workflow/run-end', { runId, stopReason })
}

/** 一次完整 run：demo-parallel-workers，两个 phase（backlog 2 成员 + git 1 成员）。 */
function completedRun(): HistoryEntryLike[] {
  return [
    runStart('run-1', 'demo-parallel-workers'),
    agentStart('run-1', 1, 'member-a', 'sa-1', 'backlog'),
    agentStart('run-1', 2, 'member-b', 'sa-2', 'backlog'),
    agentStart('run-1', 3, 'member-c', 'sa-3', 'git'),
    agentEnd('run-1', 1, 'completed'),
    agentEnd('run-1', 2, 'completed'),
    agentEnd('run-1', 3, 'failed'),
    runEnd('run-1', 'completed'),
  ]
}

test('完整 run 折叠：phase 分组、成员序、状态推导', () => {
  const folder = new WorkflowRunFolder()
  folder.applyHistory(completedRun())
  const [run] = folder.view()
  assert.equal(run.runId, 'run-1')
  assert.equal(run.name, 'demo-parallel-workers')
  assert.equal(run.status, 'completed')
  assert.equal(run.anchorSeq, 8)
  // phase 按首次出现顺序分组，null/空串不混
  assert.deepEqual(
    run.phases.map((p) => p.phase),
    ['backlog', 'git'],
  )
  assert.deepEqual(
    run.phases[0].members.map((m) => m.seq),
    [1, 2],
  )
  assert.deepEqual(
    run.phases[1].members.map((m) => m.status),
    ['failed'],
  )
  assert.deepEqual(
    run.phases[0].members.map((m) => m.status),
    ['completed', 'completed'],
  )
})

test('status 推导：run-end stopReason → completed/cancelled/error→failed；缺失 → running', () => {
  const cancelled = new WorkflowRunFolder()
  cancelled.applyHistory([
    runStart('r-c', 'wf'),
    agentStart('r-c', 1, 'a', 'sa', 'p'),
    agentEnd('r-c', 1, 'cancelled'),
    runEnd('r-c', 'cancelled'),
  ])
  const [runC] = cancelled.view()
  assert.equal(runC.status, 'cancelled')
  assert.equal(runC.phases[0].members[0].status, 'cancelled')

  const failed = new WorkflowRunFolder()
  failed.applyHistory([
    runStart('r-f', 'wf'),
    agentStart('r-f', 1, 'a', 'sa', 'p'),
    agentEnd('r-f', 1, 'completed'),
    runEnd('r-f', 'error'),
  ])
  const [runF] = failed.view()
  assert.equal(runF.status, 'failed')

  const running = new WorkflowRunFolder()
  running.applyHistory([
    runStart('r-r', 'wf'),
    agentStart('r-r', 1, 'a', 'sa', 'p'),
  ])
  const [runR] = running.view()
  assert.equal(runR.status, 'running')
  assert.equal(runR.phases[0].members[0].status, 'running')
})

test('phase 分组：null 与空串是两种身份，成员按 seq 排序', () => {
  const folder = new WorkflowRunFolder()
  folder.applyHistory([
    runStart('r-1', 'wf'),
    agentStart('r-1', 1, 'no-phase', 'sa-1'),
    agentStart('r-1', 2, 'empty-phase', 'sa-2', ''),
    agentStart('r-1', 3, 'null-again', 'sa-3'),
    agentEnd('r-1', 1, 'completed'),
    agentEnd('r-1', 2, 'completed'),
    agentEnd('r-1', 3, 'completed'),
  ])
  const [run] = folder.view()
  assert.deepEqual(
    run.phases.map((p) => [p.key, p.phase]),
    [
      ['missing', null],
      ['value:0:', ''],
    ],
  )
  assert.deepEqual(
    run.phases[0].members.map((m) => m.seq),
    [1, 3],
  )
  // null 组内成员也保持 seq 序（agent-start 到达顺序）
  assert.deepEqual(
    run.phases[0].members.map((m) => m.label),
    ['no-phase', 'null-again'],
  )
})

test('缺 run-start：update 事件先挂起，补入 start 后整段重建', () => {
  const folder = new WorkflowRunFolder()
  // 窗口里只有 update 事件（run-start 落在更早页）
  folder.applyHistory([agentStart('run-x', 1, 'a', 'sa', 'p'), agentStart('run-x', 2, 'b', 'sa', 'p')])
  assert.equal(folder.view().length, 0)
  // 加载更早：run-start + 第一条 agent-start 补进来 → 整段重建（含成员序与结局）
  folder.prependHistory([runStart('run-x', 'late-start'), agentStart('run-x', 1, 'a', 'sa', 'p')])
  const [run] = folder.view()
  assert.equal(run.name, 'late-start')
  assert.equal(run.status, 'running')
  assert.deepEqual(
    run.phases[0].members.map((m) => [m.seq, m.status]),
    [
      [1, 'running'],
      [2, 'running'],
    ],
  )
  // 重建后 agent-end 照常回填
  folder.applyEvent(agentEnd('run-x', 1, 'completed').event)
  const [done] = folder.view()
  assert.equal(done.phases[0].members[0].status, 'completed')
})

test('applyHistory 全量重置；非 workflow 事件忽略', () => {
  const folder = new WorkflowRunFolder()
  folder.applyHistory(completedRun())
  assert.equal(folder.view().length, 1)
  assert.equal(folder.applyEvent(ev('turn/start', { turn: 1 })), false)
  assert.equal(folder.applyEvent(ev('user/message', { id: 'u', text: 'hi' })), false)
  folder.applyHistory([])
  assert.equal(folder.view().length, 0)
})

test('phaseStatusSummary 聚合文案', () => {
  const m = (s: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted', i: number) => ({
    seq: i,
    label: `m${i}`,
    childId: `s${i}`,
    status: s,
  })
  assert.equal(workflowPhaseStatusSummary([m('running', 0), m('running', 1), m('completed', 2)]), '运行中 2 · 已完成 1')
  assert.equal(workflowPhaseStatusSummary([m('completed', 0), m('completed', 1)]), '已完成 2')
  assert.equal(workflowPhaseStatusSummary([m('running', 0)]), '运行中 1')
  // interrupted + completed：completed 前置
  assert.equal(workflowPhaseStatusSummary([m('interrupted', 0), m('completed', 1)]), '已完成 1 · 已中断 1')
  assert.equal(workflowPhaseStatusSummary([m('failed', 0), m('completed', 1)]), '失败 1 · 已完成 1')
})

test('dotState 语义映射', () => {
  assert.equal(workflowDotState('running'), 'ongoing')
  assert.equal(workflowDotState('completed'), 'done')
  assert.equal(workflowDotState('failed'), 'error')
  assert.equal(workflowDotState('cancelled'), 'warning')
  assert.equal(workflowDotState('interrupted'), 'warning')
})

function runWithStatuses(statuses: WorkflowRunView['phases'][number]['members'][number]['status'][]): WorkflowRunView {
  const phases = statuses.map((s, i) => ({
    key: `value:1:p${i}`,
    phase: `p${i}`,
    members: [{ seq: i, label: `m${i}`, childId: `s${i}`, status: s }],
  }))
  return { runId: 'r', name: 'wf', status: 'completed', anchorSeq: 1, phases }
}

test('展开折叠状态机：非 clean 默认展开、全完成自动收拢、新活动自动展开、运行中保持用户选择', () => {
  const running = workflowRunFacts(runWithStatuses(['running']))
  const clean = workflowRunFacts(runWithStatuses(['completed']))
  const abnormal = workflowRunFacts(runWithStatuses(['failed']))

  // 初始：非 clean 展开
  const openRunning = advanceWorkflowDisclosure(undefined, running)
  assert.equal(openRunning.open, true)
  // 完成 → 自动收拢
  const collapsed = advanceWorkflowDisclosure(openRunning, clean)
  assert.equal(collapsed.open, false)
  // 全完成默认折叠
  assert.equal(advanceWorkflowDisclosure(undefined, clean).open, false)
  // 新活动（clean → running）→ 自动展开
  const reopened = advanceWorkflowDisclosure(collapsed, running)
  assert.equal(reopened.open, true)
  // 运行中更新（activityCount 变化）→ 保持用户选择
  const userCollapsed = { open: false, mode: 'running' as const, activityCount: 1 }
  const moreActive = { ...running, activityCount: 2 }
  assert.equal(advanceWorkflowDisclosure(userCollapsed, moreActive).open, false)
  // 变 abnormal → 自动展开（即使之前被用户收拢）
  assert.equal(advanceWorkflowDisclosure(userCollapsed, abnormal).open, true)
  // facts 没变 → 保持现状（返回同一对象）
  assert.equal(advanceWorkflowDisclosure(reopened, running), reopened)
})

test('phase facts：成员异常 → abnormal，全部完成 → clean', () => {
  const phase = (s: 'running' | 'completed' | 'cancelled') => ({
    key: 'k',
    phase: 'p',
    members: [{ seq: 1, label: 'm', childId: 's', status: s }],
  })
  assert.equal(workflowPhaseFacts(phase('running')).mode, 'running')
  assert.equal(workflowPhaseFacts(phase('completed')).mode, 'clean')
  assert.equal(workflowPhaseFacts(phase('cancelled')).mode, 'abnormal')
})
