import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newWorkspacePaths } from '../src/pure/workspace.ts'

const w = (workspaceId: string, path = `/p/${workspaceId}`) => ({ workspaceId, path })

test('returns paths of ids not seen before', () => {
  const prev = [w('a'), w('b')]
  const next = [w('a'), w('b'), w('c')]
  assert.deepEqual(newWorkspacePaths(prev, next), ['/p/c'])
})

test('empty when nothing changed', () => {
  const prev = [w('a'), w('b')]
  assert.deepEqual(newWorkspacePaths(prev, prev), [])
})

test('everything is new against an empty baseline', () => {
  assert.deepEqual(newWorkspacePaths([], [w('a'), w('b')]), ['/p/a', '/p/b'])
})

test('renamed path with same id is not new', () => {
  const prev = [w('a', '/old')]
  const next = [w('a', '/new')]
  assert.deepEqual(newWorkspacePaths(prev, next), [])
})
