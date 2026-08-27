import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { dirSize } from '../src/pure/dirSize.ts'

test('dirSize sums files recursively', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dirsize-'))
  try {
    await fs.writeFile(path.join(root, 'a.bin'), Buffer.alloc(100))
    await fs.mkdir(path.join(root, 'sub', 'deep'), { recursive: true })
    await fs.writeFile(path.join(root, 'sub', 'b.bin'), Buffer.alloc(200))
    await fs.writeFile(path.join(root, 'sub', 'deep', 'c.bin'), Buffer.alloc(50))
    assert.equal(await dirSize(root), 350)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('dirSize returns 0 for a missing directory', async () => {
  assert.equal(await dirSize(path.join(os.tmpdir(), 'dirsize-does-not-exist')), 0)
})

test('dirSize ignores symlinks', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dirsize-'))
  try {
    await fs.writeFile(path.join(root, 'real.bin'), Buffer.alloc(64))
    await fs.symlink(path.join(root, 'real.bin'), path.join(root, 'link.bin'))
    assert.equal(await dirSize(root), 64)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
