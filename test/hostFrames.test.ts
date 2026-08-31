import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyHostFrame, parseHostFrame, type SessionListState } from '../src/pure/hostFrames.ts'
import type { SessionInput, WorkspaceInput } from '../src/pure/sessionTree.ts'

const NOW = 1_700_000_000_000

const s = (sessionId: string, opts: Partial<SessionInput> = {}): SessionInput => ({
  sessionId,
  updatedAt: NOW,
  running: false,
  blank: false,
  ...opts,
})

const w = (workspaceId: string, sessionIds: string[] = [], opts: Partial<WorkspaceInput> = {}): WorkspaceInput => ({
  workspaceId,
  path: `/p/${workspaceId}`,
  title: workspaceId,
  sessionIds,
  updatedAt: new Date(NOW).toISOString(),
  ...opts,
})

const state = (opts: Partial<SessionListState> = {}): SessionListState => ({
  sessions: [],
  workspaces: [],
  archived: new Set(),
  ...opts,
})

// ---------- parseHostFrame ----------

test('parse: 各帧合法载荷解析出对应 HostFrame', () => {
  assert.deepEqual(
    parseHostFrame('host/session-added', {
      type: 'host/session-added',
      sessionId: 'a',
      blank: true,
      parentSessionId: 'p',
      origin: 'subagent',
      agentPreset: 'default',
    }),
    { type: 'host/session-added', sessionId: 'a', blank: true, parentSessionId: 'p', origin: 'subagent', agentPreset: 'default' },
  )
  assert.deepEqual(parseHostFrame('host/session-removed', { sessionId: 'a' }), {
    type: 'host/session-removed',
    sessionId: 'a',
  })
  assert.deepEqual(parseHostFrame('host/session-status', { sessionId: 'a', running: true }), {
    type: 'host/session-status',
    sessionId: 'a',
    running: true,
  })
  assert.deepEqual(parseHostFrame('host/workspace-removed', { workspaceId: 'w1' }), {
    type: 'host/workspace-removed',
    workspaceId: 'w1',
  })
  assert.deepEqual(parseHostFrame('host/workspace-order-changed', { workspaceIds: ['w2', 'w1'] }), {
    type: 'host/workspace-order-changed',
    workspaceIds: ['w2', 'w1'],
  })
  assert.deepEqual(parseHostFrame('host/archived-sessions-changed', { archivedSessionIds: ['a'] }), {
    type: 'host/archived-sessions-changed',
    archivedSessionIds: ['a'],
  })
  const changed = parseHostFrame('host/workspace-changed', {
    workspace: { workspaceId: 'w1', path: '/p/w1', title: 'W1', sessionIds: ['a'], createdAt: 'x', updatedAt: 'y' },
  })
  assert.deepEqual(changed, {
    type: 'host/workspace-changed',
    workspace: { workspaceId: 'w1', path: '/p/w1', title: 'W1', sessionIds: ['a'], updatedAt: 'y' },
  })
})

test('parse: 缺字段/类型不符/非对象载荷返回 null', () => {
  assert.equal(parseHostFrame('host/session-added', { sessionId: 'a' }), null)
  assert.equal(parseHostFrame('host/session-status', { sessionId: 'a', running: 'yes' }), null)
  assert.equal(parseHostFrame('host/session-removed', {}), null)
  assert.equal(parseHostFrame('host/workspace-changed', { workspace: { workspaceId: 'w1' } }), null)
  assert.equal(parseHostFrame('host/workspace-order-changed', { workspaceIds: ['w1', 2] }), null)
  assert.equal(parseHostFrame('host/session-status', null), null)
  assert.equal(parseHostFrame('host/session-status', 'running'), null)
})

test('parse: 列表无关的帧（agent-error/remote-event/stream/error）一律忽略', () => {
  assert.equal(parseHostFrame('host/agent-error', { sessionId: 'a', message: 'boom' }), null)
  assert.equal(parseHostFrame('host/remote-event', { event: 'x', args: [] }), null)
  assert.equal(parseHostFrame('stream/error', { error: { code: 'x', message: 'y' } }), null)
  assert.equal(parseHostFrame('totally/unknown', {}), null)
})

// ---------- session-added ----------

test('session-added: 新会话插入列表头部，updatedAt 取帧到达时刻', () => {
  const next = applyHostFrame(
    state({ sessions: [s('old')] }),
    { type: 'host/session-added', sessionId: 'new', blank: true, origin: 'subagent', parentSessionId: 'old' },
    NOW + 1000,
  )
  assert.ok(next)
  assert.deepEqual(next.sessions, [
    { sessionId: 'new', updatedAt: NOW + 1000, running: false, blank: true, parentSessionId: 'old', origin: 'subagent' },
    s('old'),
  ])
})

test('session-added: 已存在只补缺字段，blank 单调不回置', () => {
  const prev = state({ sessions: [s('a', { blank: false, origin: 'subagent' })] })
  // blank 取与：existing.blank(false) && frame.blank(true) = false
  const filled = applyHostFrame(prev, { type: 'host/session-added', sessionId: 'a', blank: true, parentSessionId: 'p' }, NOW)
  assert.deepEqual(filled?.sessions, [{ ...s('a', { blank: false, origin: 'subagent' }), parentSessionId: 'p' }])
  // 没有可补的字段 → null
  assert.equal(applyHostFrame(filled!, { type: 'host/session-added', sessionId: 'a', blank: true }, NOW), null)
})

// ---------- session-removed ----------

test('session-removed: 普通会话移出列表，未知会话无操作', () => {
  const next = applyHostFrame(state({ sessions: [s('a'), s('b')] }), { type: 'host/session-removed', sessionId: 'a' }, NOW)
  assert.deepEqual(next?.sessions, [s('b')])
  assert.equal(applyHostFrame(state({ sessions: [s('a')] }), { type: 'host/session-removed', sessionId: 'x' }, NOW), null)
})

test('session-removed: durable subagent 降级为 running:false 而不是移除', () => {
  const running = state({ sessions: [s('sub', { origin: 'subagent', running: true })] })
  const next = applyHostFrame(running, { type: 'host/session-removed', sessionId: 'sub' }, NOW)
  assert.deepEqual(next?.sessions, [s('sub', { origin: 'subagent', running: false })])
  // 已经不 running 的 subagent 再收 removed → 无操作
  assert.equal(applyHostFrame(next!, { type: 'host/session-removed', sessionId: 'sub' }, NOW), null)
})

// ---------- session-status ----------

test('session-status: 翻 running，running:true 顺带清 blank，不动 updatedAt', () => {
  const prev = state({ sessions: [s('a', { blank: true, updatedAt: NOW - 5000 })] })
  const started = applyHostFrame(prev, { type: 'host/session-status', sessionId: 'a', running: true }, NOW)
  assert.deepEqual(started?.sessions, [{ ...s('a', { blank: false, running: true }), updatedAt: NOW - 5000 }])
  const stopped = applyHostFrame(started!, { type: 'host/session-status', sessionId: 'a', running: false }, NOW)
  assert.deepEqual(stopped?.sessions, [{ ...s('a', { blank: false, running: false }), updatedAt: NOW - 5000 }])
})

test('session-status: 状态未变或会话未知返回 null', () => {
  const prev = state({ sessions: [s('a'), s('b', { running: true })] })
  assert.equal(applyHostFrame(prev, { type: 'host/session-status', sessionId: 'a', running: false }, NOW), null)
  assert.equal(applyHostFrame(prev, { type: 'host/session-status', sessionId: 'b', running: true }, NOW), null)
  assert.equal(applyHostFrame(prev, { type: 'host/session-status', sessionId: 'x', running: true }, NOW), null)
})

// ---------- workspace 帧 ----------

test('workspace-changed: 新 workspace 插到最前，已存在整体替换', () => {
  const prev = state({ workspaces: [w('w1', ['a'])] })
  const added = applyHostFrame(prev, { type: 'host/workspace-changed', workspace: w('w2') }, NOW)
  assert.deepEqual(added?.workspaces, [w('w2'), w('w1', ['a'])])
  const replaced = applyHostFrame(added!, { type: 'host/workspace-changed', workspace: w('w1', ['a', 'b']) }, NOW)
  assert.deepEqual(replaced?.workspaces, [w('w2'), w('w1', ['a', 'b'])])
})

test('workspace-changed: updatedAt 更旧的帧丢弃，内容相同返回 null', () => {
  const newer = w('w1', ['a'], { updatedAt: new Date(NOW + 10_000).toISOString() })
  const prev = state({ workspaces: [newer] })
  const stale = w('w1', ['a', 'b'], { updatedAt: new Date(NOW).toISOString() })
  assert.equal(applyHostFrame(prev, { type: 'host/workspace-changed', workspace: stale }, NOW), null)
  assert.equal(applyHostFrame(prev, { type: 'host/workspace-changed', workspace: newer }, NOW), null)
})

test('workspace-removed: 移出已知 workspace，未知 id 无操作', () => {
  const prev = state({ workspaces: [w('w1'), w('w2')] })
  assert.deepEqual(applyHostFrame(prev, { type: 'host/workspace-removed', workspaceId: 'w1' }, NOW)?.workspaces, [w('w2')])
  assert.equal(applyHostFrame(prev, { type: 'host/workspace-removed', workspaceId: 'x' }, NOW), null)
})

test('workspace-order-changed: 按完整序重排，未列入的排尾且保持稳定', () => {
  const prev = state({ workspaces: [w('w1'), w('w2'), w('w3')] })
  const next = applyHostFrame(prev, { type: 'host/workspace-order-changed', workspaceIds: ['w3', 'w1'] }, NOW)
  assert.deepEqual(next?.workspaces.map((x) => x.workspaceId), ['w3', 'w1', 'w2'])
  assert.equal(
    applyHostFrame(prev, { type: 'host/workspace-order-changed', workspaceIds: ['w1', 'w2', 'w3'] }, NOW),
    null,
  )
})

test('archived-sessions-changed: 整体替换归档集合，相同返回 null', () => {
  const prev = state({ archived: new Set(['a']) })
  const next = applyHostFrame(prev, { type: 'host/archived-sessions-changed', archivedSessionIds: ['b', 'c'] }, NOW)
  assert.deepEqual([...next!.archived], ['b', 'c'])
  assert.equal(applyHostFrame(prev, { type: 'host/archived-sessions-changed', archivedSessionIds: ['a'] }, NOW), null)
})
