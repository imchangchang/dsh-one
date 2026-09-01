import { test } from 'node:test'
import assert from 'node:assert/strict'
import { subagentIdFromOutput, subagentInTree } from '../src/pure/subagentCard.ts'

test('subagentIdFromOutput reads the id from the rendered continuable text', () => {
  assert.equal(subagentIdFromOutput('started subagent session-abc'), 'session-abc')
  // Trailing content is tolerated.
  assert.equal(subagentIdFromOutput('started subagent session-abc done'), 'session-abc')
})

test('subagentIdFromOutput reads the id from a persisted raw result object', () => {
  assert.equal(
    subagentIdFromOutput('{"kind":"continuable","subagentId":"session-xyz"}'),
    'session-xyz',
  )
})

test('subagentIdFromOutput ignores background jobs and foreground results', () => {
  // Background job id is not a lineage session.
  assert.equal(subagentIdFromOutput('started background subagent job job-1'), undefined)
  // Foreground result text carries no id.
  assert.equal(subagentIdFromOutput('the task finished with output'), undefined)
  // Raw background/foreground result objects are not lineage sessions.
  assert.equal(subagentIdFromOutput('{"kind":"background","jobId":"job-1"}'), undefined)
})

test('subagentIdFromOutput returns undefined for empty or unparsable output', () => {
  assert.equal(subagentIdFromOutput(undefined), undefined)
  assert.equal(subagentIdFromOutput(''), undefined)
  assert.equal(subagentIdFromOutput('   '), undefined)
})

test('subagentInTree matches a session at any depth, and misses absent ids', () => {
  const tree = [
    { sessionId: 'sub-1', title: 'A', running: false, updatedAt: 1, children: [
      { sessionId: 'sub-2', title: 'B', running: false, updatedAt: 1 },
    ] },
    { sessionId: 'sub-3', title: 'C', running: true, updatedAt: 2 },
  ]
  assert.equal(subagentInTree(tree, 'sub-1'), true)
  assert.equal(subagentInTree(tree, 'sub-2'), true)
  assert.equal(subagentInTree(tree, 'sub-3'), true)
  assert.equal(subagentInTree(tree, 'sub-4'), false)
  assert.equal(subagentInTree(undefined, 'sub-1'), false)
})
