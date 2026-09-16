/**
 * 多开会话标签页映射的单测（#72）：钉的是一条现场踩过的语义——「关掉 A 面板不会
 * 连带清掉 B 面板的映射」（旧实现按会话 id 直接删，两面板映射交叉时互相踩）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assignSessionTab, hasSessionTab, releaseSessionTab, sessionTabOf } from '../src/pure/sessionTabs.ts'

/** 面板句柄用字符串替身（宿主里是真 WebviewPanel，这里只验映射规则）。 */
type Panel = string

test('登记后按会话名查得到面板；没开的会话查不到', () => {
  const table = new Map<string, Panel>()
  assignSessionTab(table, 'panel-a', 'session-1')
  assert.equal(sessionTabOf(table, 'session-1'), 'panel-a')
  assert.equal(sessionTabOf(table, 'session-2'), undefined)
})

test('同一面板换会话：旧格子被清掉，表里只剩它自己那一格', () => {
  const table = new Map<string, Panel>()
  assignSessionTab(table, 'panel-a', 'session-1')
  assignSessionTab(table, 'panel-a', 'session-2')
  assert.equal(sessionTabOf(table, 'session-1'), undefined)
  assert.equal(sessionTabOf(table, 'session-2'), 'panel-a')
  assert.equal(table.size, 1)
})

test('两面板映射交叉后，关掉一个不动另一个（旧实现在这里删错格子）', () => {
  const table = new Map<string, Panel>()
  assignSessionTab(table, 'panel-a', 'session-1')
  assignSessionTab(table, 'panel-b', 'session-2')
  // A 切到 2 的会话、B 切到 1 的会话：两边都不再持有原来的格子
  assignSessionTab(table, 'panel-a', 'session-2')
  assignSessionTab(table, 'panel-b', 'session-1')
  assert.deepEqual([...table], [
    ['session-2', 'panel-a'],
    ['session-1', 'panel-b'],
  ])

  releaseSessionTab(table, 'panel-a')
  assert.equal(sessionTabOf(table, 'session-2'), undefined)
  assert.equal(sessionTabOf(table, 'session-1'), 'panel-b', 'B 的映射必须还在')
})

test('关面板只清自己的格子，且可以重复调用（幂等）', () => {
  const table = new Map<string, Panel>()
  assignSessionTab(table, 'panel-a', 'session-1')
  assignSessionTab(table, 'panel-b', 'session-2')
  releaseSessionTab(table, 'panel-b')
  releaseSessionTab(table, 'panel-b')
  assert.deepEqual([...table], [['session-1', 'panel-a']])
  // 从未登记过的面板（单例面板）关掉时，多开表一格都不动
  releaseSessionTab(table, 'singleton')
  assert.deepEqual([...table], [['session-1', 'panel-a']])
})

test('已有判定把「在途创建」也算上（连点两次不开两个面板）', () => {
  const table = new Map<string, Panel>()
  const creating = new Set<string>(['session-9'])
  assert.equal(hasSessionTab(table, creating, 'session-9'), true)
  assert.equal(hasSessionTab(table, creating, 'session-8'), false)
  assignSessionTab(table, 'panel-a', 'session-8')
  assert.equal(hasSessionTab(table, creating, 'session-8'), true)
})

test('在途集合用 Map 也认（宿主按会话 id 记创建中任务）', () => {
  const table = new Map<string, Panel>()
  const creating = new Map<string, Promise<void>>([['session-9', Promise.resolve()]])
  assert.equal(hasSessionTab(table, creating, 'session-9'), true)
  assert.equal(hasSessionTab(table, creating, 'session-1'), false)
})
