import { test } from 'node:test'
import assert from 'node:assert/strict'
import { producedBasename, producedFolderOf } from '../src/pure/producedFiles.ts'

test('producedBasename takes the trailing segment of either separator', () => {
  assert.equal(producedBasename('/repo/src/a.ts'), 'a.ts')
  assert.equal(producedBasename('C:\\repo\\src\\a.ts'), 'a.ts')
  assert.equal(producedBasename('a.ts'), 'a.ts')
})

test('producedFolderOf returns the deepest common parent directory', () => {
  assert.equal(producedFolderOf(['/repo/src/a.ts', '/repo/src/b.ts']), '/repo/src')
  assert.equal(producedFolderOf(['/repo/src/a.ts', '/repo/lib/b.ts']), '/repo')
  assert.equal(producedFolderOf(['C:\\repo\\src\\a.ts', 'C:\\repo\\src\\b.ts']), 'C:\\repo\\src')
  assert.equal(producedFolderOf(['/repo/a.ts']), '/repo')
})

test('producedFolderOf handles files in nested and sibling directories', () => {
  assert.equal(producedFolderOf(['/repo/src/deep/a.ts', '/repo/src/b.ts']), '/repo/src')
  assert.equal(producedFolderOf(['/repo/src/a.ts', '/repo/src/sub/b.ts']), '/repo/src')
  // 文件分布在互不相干的根（仓库与 /tmp）：没有可打开的公共文件夹，按钮隐藏。
  assert.equal(producedFolderOf(['/repo/src/a.ts', '/tmp/x.ts']), undefined)
})

test('producedFolderOf yields undefined when nothing has a parent', () => {
  assert.equal(producedFolderOf([]), undefined)
  assert.equal(producedFolderOf(['a.ts']), undefined)
  // 裸文件名没有父目录可开，其余绝对路径照常参与。
  assert.equal(producedFolderOf(['a.ts', '/repo/b.ts']), '/repo')
})
