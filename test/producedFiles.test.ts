import { test } from 'node:test'
import assert from 'node:assert/strict'
import { producedBasename } from '../src/pure/producedFiles.ts'

test('producedBasename takes the trailing segment of either separator', () => {
  assert.equal(producedBasename('/repo/src/a.ts'), 'a.ts')
  assert.equal(producedBasename('C:\\repo\\src\\a.ts'), 'a.ts')
  assert.equal(producedBasename('a.ts'), 'a.ts')
})
