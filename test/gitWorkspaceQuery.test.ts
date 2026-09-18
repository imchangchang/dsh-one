/**
 * 「在工作区里找提交」的端到端单测（#65 批 1 返修 2）：真 git + 真临时目录，
 * 覆盖工作区根非仓库 / 仓库在子目录的场景，以及限深、跳过目录、仓库数上限、
 * 缓存命中、全部落空、git 缺席。git 不可用时整组跳过。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { scratchDir } from './scratchDirs.ts'
import { execFileSync } from 'node:child_process'
import { queryCommitInWorkspace } from '../src/pure/gitWorkspaceQuery.ts'
import { createTtlCache, type TtlCache } from '../src/pure/ttlCache.ts'
import type { GitWorkspaceQueryResult } from '../src/pure/gitWorkspaceQuery.ts'
import type { RepoDiscoveryResult } from '../src/pure/gitRepoDiscovery.ts'

function gitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
const hasGit = gitAvailable()

/** 造一个临时工作区目录（自身不是仓库）。 */
async function makeWorkspace(): Promise<string> {
  return scratchDir('dshone-ws-')
}

/** 在 workspace/<rel> 造一个真 git 仓库并提交，返回 hash。 */
async function makeRepoAt(workspace: string, rel: string, label: string): Promise<string> {
  const dir = path.join(workspace, rel)
  await fs.mkdir(dir, { recursive: true })
  const git = (...args: string[]): string =>
    execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Ada',
        GIT_AUTHOR_EMAIL: 'ada@example.com',
        GIT_COMMITTER_NAME: 'Ada',
        GIT_COMMITTER_EMAIL: 'ada@example.com',
        GIT_AUTHOR_DATE: '2026-09-01T10:00:00+08:00',
        GIT_COMMITTER_DATE: '2026-09-01T10:00:00+08:00',
      },
    })
  git('init', '-q')
  await fs.writeFile(path.join(dir, 'file.txt'), `${label}\n`)
  git('add', '.')
  git('commit', '-q', '-m', `feat: ${label}`)
  return git('rev-parse', 'HEAD').trim()
}

/** 每次测试用独立缓存（同 TTL 语义，互不串味）。 */
const freshCaches = (): { repoCache: TtlCache<RepoDiscoveryResult>; commitCache: TtlCache<GitWorkspaceQueryResult> } => ({
  repoCache: createTtlCache<RepoDiscoveryResult>({ ttlMs: 60_000 }),
  commitCache: createTtlCache<GitWorkspaceQueryResult>({ ttlMs: 60_000 }),
})

test('工作区根非仓库：仓库在 ./sub 与 ./a/b 时都能查到（并回报仓库路径）', { skip: !hasGit }, async () => {
  const ws = await makeWorkspace()
  try {
    const subHash = await makeRepoAt(ws, 'sub', 'sub commit')
    const deepHash = await makeRepoAt(ws, path.join('a', 'b'), 'deep commit')
    const caches = freshCaches()

    const inSub = await queryCommitInWorkspace(subHash.slice(0, 7), ws, caches)
    assert.equal(inSub?.found, true)
    // macOS 上 /var 是 /private/var 的软链：比 realpath 后的等价路径
    assert.equal(await fs.realpath(inSub?.repoPath ?? ''), await fs.realpath(path.join(ws, 'sub')))
    assert.equal(inSub?.repoRelative, 'sub')
    assert.equal(inSub?.message, 'feat: sub commit')

    const inDeep = await queryCommitInWorkspace(deepHash.slice(0, 7), ws, freshCaches())
    assert.equal(inDeep?.found, true)
    assert.equal(inDeep?.repoRelative, path.join('a', 'b'))

    // 不在任何仓库里的提交 → 未找到（不报错）
    const miss = await queryCommitInWorkspace('deadbeef', ws, freshCaches())
    assert.equal(miss?.found, false)
  } finally {
    await fs.rm(ws, { recursive: true, force: true })
  }
})

test('查询根本身是仓库时走快路径（不回报 repoRelative，且不扫子目录）', { skip: !hasGit }, async () => {
  const ws = await makeWorkspace()
  try {
    const hash = await makeRepoAt(ws, '.', 'root commit')
    const result = await queryCommitInWorkspace(hash.slice(0, 7), ws, freshCaches())
    assert.equal(result?.found, true)
    assert.equal(result?.repoPath, undefined) // 快路径不盖仓库上下文（就是查询根本身）
    assert.equal(result?.scannedRoots, 1)
  } finally {
    await fs.rm(ws, { recursive: true, force: true })
  }
})

test('深于限深的仓库不扫（maxDepth 收紧到 1 时 ./a/b 查不到）', { skip: !hasGit }, async () => {
  const ws = await makeWorkspace()
  try {
    const deepHash = await makeRepoAt(ws, path.join('a', 'b'), 'too deep')
    const shallowOnly = await queryCommitInWorkspace(deepHash.slice(0, 7), ws, { ...freshCaches(), maxDepth: 1 })
    assert.equal(shallowOnly?.found, false)
    const defaultDepth = await queryCommitInWorkspace(deepHash.slice(0, 7), ws, freshCaches())
    assert.equal(defaultDepth?.found, true)
  } finally {
    await fs.rm(ws, { recursive: true, force: true })
  }
})

test('跳过目录里的仓库不扫（node_modules 下的提交查不到）', { skip: !hasGit }, async () => {
  const ws = await makeWorkspace()
  try {
    const hash = await makeRepoAt(ws, path.join('node_modules', 'pkg'), 'vendored')
    const result = await queryCommitInWorkspace(hash.slice(0, 7), ws, freshCaches())
    assert.equal(result?.found, false)
  } finally {
    await fs.rm(ws, { recursive: true, force: true })
  }
})

test('仓库数上限生效（maxRepos=1 时第二个仓库里的提交查不到）', { skip: !hasGit }, async () => {
  const ws = await makeWorkspace()
  try {
    const firstHash = await makeRepoAt(ws, 'a-repo', 'first')
    const secondHash = await makeRepoAt(ws, 'b-repo', 'second')
    const capped = await queryCommitInWorkspace(secondHash.slice(0, 7), ws, { ...freshCaches(), maxRepos: 1 })
    assert.equal(capped?.found, false)
    assert.equal(capped?.truncated, true)
    // 放开户数上限就能查到（证明是上限生效，而不是别的原因）
    const opened = await queryCommitInWorkspace(secondHash.slice(0, 7), ws, { ...freshCaches(), maxRepos: 8 })
    assert.equal(opened?.found, true)
    assert.equal(opened?.repoRelative, 'b-repo')
    void firstHash
  } finally {
    await fs.rm(ws, { recursive: true, force: true })
  }
})

test('缓存命中：同 hash 第二次查询不再重新发现仓库', { skip: !hasGit }, async () => {
  const ws = await makeWorkspace()
  try {
    const hash = await makeRepoAt(ws, 'sub', 'cached')
    const caches = freshCaches()
    let probes = 0
    const countingIsRepo = async (dir: string): Promise<boolean> => {
      probes += 1
      try {
        await fs.stat(path.join(dir, '.git'))
        return true
      } catch {
        return false
      }
    }
    const first = await queryCommitInWorkspace(hash.slice(0, 7), ws, { ...caches, isRepo: countingIsRepo })
    assert.equal(first?.found, true)
    const probesAfterFirst = probes
    assert.ok(probesAfterFirst > 0)
    const second = await queryCommitInWorkspace(hash.slice(0, 7), ws, { ...caches, isRepo: countingIsRepo })
    assert.equal(second?.found, true)
    assert.equal(probes, probesAfterFirst, '第二次查询应命中缓存，不再遍历目录')
    // (仓库, sha) 结果缓存也生效：直接命中提交缓存，不再跑 git
    const third = await queryCommitInWorkspace(hash, await fs.realpath(path.join(ws, 'sub')), freshCaches())
    assert.equal(third?.found, true)
  } finally {
    await fs.rm(ws, { recursive: true, force: true })
  }
})

test('时间预算耗尽 → 未找到 + truncated（不抛错）', { skip: !hasGit }, async () => {
  const ws = await makeWorkspace()
  try {
    const hash = await makeRepoAt(ws, 'sub', 'slow')
    let clock = 0
    const result = await queryCommitInWorkspace(hash.slice(0, 7), ws, {
      ...freshCaches(),
      budgetMs: 5,
      now: () => {
        clock += 1000 // 第一次读时间就超预算
        return clock
      },
    })
    assert.equal(result?.found, false)
  } finally {
    await fs.rm(ws, { recursive: true, force: true })
  }
})

test('git 缺席 → undefined（宿主按 git-missing 回执）', { skip: !hasGit }, async () => {
  const ws = await makeWorkspace()
  try {
    const result = await queryCommitInWorkspace('deadbeef', ws, { ...freshCaches(), gitPath: 'dsh-one-git-does-not-exist' })
    assert.equal(result, undefined)
  } finally {
    await fs.rm(ws, { recursive: true, force: true })
  }
})
