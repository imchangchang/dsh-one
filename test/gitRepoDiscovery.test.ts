/**
 * 工作区内 git 仓库有界发现的单测（#65 批 1 返修 2）：限深、跳过目录、仓库数
 * 上限、时间预算、不跟符号链接。用真临时目录构造（git 二进制不参与）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { DEFAULT_SKIP_DIRS, discoverGitRepos } from '../src/pure/gitRepoDiscovery.ts'
import { scratchDir } from './scratchDirs.ts'

/** 造一个临时树：`{ 'sub/.git': true, 'a/b/.git': true }`。 */
async function makeTree(spec: Record<string, true>): Promise<string> {
  const root = await scratchDir('dshone-disc-')
  for (const rel of Object.keys(spec)) {
    const dir = path.join(root, path.dirname(rel))
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(root, rel), 'gitdir: /tmp/fake\n')
  }
  return root
}

test('限深 ≤3：第 1/2/3 层的仓库命中，第 4 层不扫', async () => {
  const root = await makeTree({ 'sub/.git': true, 'a/b/.git': true, 'x/y/z/deep/.git': true })
  try {
    const result = await discoverGitRepos(root)
    // 层序：第 1 层的 sub 在前，第 2 层的 a/b 在后（浅仓库优先，命中更快）
    assert.deepEqual(result.repos, [path.join(root, 'sub'), path.join(root, 'a', 'b')])
    assert.equal(result.truncated, false)
    // 放宽深度到 4 就能看到它（证明是「限深」而不是别的原因漏掉）
    const deeper = await discoverGitRepos(root, { maxDepth: 4 })
    assert.ok(deeper.repos.includes(path.join(root, 'x', 'y', 'z', 'deep')))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('跳过目录不扫（node_modules/.venv/dist/build/vendor…）', async () => {
  const root = await makeTree({
    'node_modules/pkg/.git': true,
    '.venv/lib/.git': true,
    'dist/.git': true,
    'vendor/.git': true,
    'src/.git': true,
  })
  try {
    const result = await discoverGitRepos(root)
    assert.deepEqual(result.repos, [path.join(root, 'src')])
    assert.ok(DEFAULT_SKIP_DIRS.includes('node_modules'))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('仓库数上限生效（命中上限即停并置 truncated）', async () => {
  const root = await makeTree({ 'r1/.git': true, 'r2/.git': true, 'r3/.git': true })
  try {
    const capped = await discoverGitRepos(root, { maxRepos: 2 })
    assert.equal(capped.repos.length, 2)
    assert.equal(capped.truncated, true)
    // 同层按名字升序，先拿 r1/r2
    assert.deepEqual(capped.repos, [path.join(root, 'r1'), path.join(root, 'r2')])
    const open = await discoverGitRepos(root, { maxRepos: 5 })
    assert.equal(open.repos.length, 3)
    assert.equal(open.truncated, false)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('时间预算耗尽即停（truncated）', async () => {
  const root = await makeTree({ 'sub/.git': true })
  try {
    let clock = 0
    const result = await discoverGitRepos(root, {
      budgetMs: 10,
      now: () => {
        clock += 100 // 每次读时间就前进，第一层就超预算
        return clock
      },
    })
    assert.deepEqual(result.repos, [])
    assert.equal(result.truncated, true)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('不跟符号链接（既防环，也保证发现结果落在根内）', async () => {
  const root = await makeTree({ 'real/.git': true })
  const outside = await makeTree({ '.git': true })
  try {
    await fs.symlink(outside, path.join(root, 'link'), 'dir')
    const result = await discoverGitRepos(root)
    assert.deepEqual(result.repos, [path.join(root, 'real')])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(outside, { recursive: true, force: true })
  }
})

test('isRepo 可注入（判定与遍历解耦）', async () => {
  const root = await makeTree({ 'a/.keep': true, 'b/.keep': true })
  try {
    const probes: string[] = []
    const result = await discoverGitRepos(root, {
      isRepo: async (dir) => {
        probes.push(path.basename(dir))
        return path.basename(dir) === 'b'
      },
    })
    assert.deepEqual(result.repos, [path.join(root, 'b')])
    assert.ok(probes.includes('a') && probes.includes('b'))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
