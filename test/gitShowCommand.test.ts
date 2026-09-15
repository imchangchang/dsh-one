/**
 * git CLI 数据面的端到端测试（#65 批 1）：在临时仓库里真提交、真查（真 git
 * 二进制），覆盖宿主能力桥 `git.show` 的实现体——作者/时间/message/变更统计/
 * 短 hash、GitHub 链接推导、找不到的提交、非仓库目录、git 缺席。
 * git 不可用时整体跳过（不假装通过）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { runGitShow } from '../src/pure/gitShowCommand.ts'
import { resolveQueryDir } from '../src/pure/hostCalls.ts'

/** git 可用性探测（不可用则跳过整组）。 */
function gitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
const hasGit = gitAvailable()

/**
 * 造一个临时仓库：一次提交（2 个文件、含 body），remote 指向 GitHub。
 * @param label - 写进文件与提交信息（两个仓库要拿到不同哈希就必须内容不同）。
 */
async function makeRepo(label = 'a'): Promise<{ dir: string; hash: string; cleanup: () => Promise<void> }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dshone-git-'))
  const git = (...args: string[]): string =>
    execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Ada Lovelace',
        GIT_AUTHOR_EMAIL: 'ada@example.com',
        GIT_COMMITTER_NAME: 'Ada Lovelace',
        GIT_COMMITTER_EMAIL: 'ada@example.com',
        GIT_AUTHOR_DATE: '2026-09-01T10:00:00+08:00',
        GIT_COMMITTER_DATE: '2026-09-01T10:00:00+08:00',
      },
    })
  git('init', '-q')
  git('remote', 'add', 'origin', 'git@github.com:example/repo.git')
  await fs.writeFile(path.join(dir, 'a.txt'), `one ${label}\n`)
  await fs.writeFile(path.join(dir, 'b.txt'), `two ${label}\nthree\n`)
  git('add', '.')
  git('commit', '-q', '-m', `feat: add two files (${label})`, '-m', 'body line')
  const hash = git('rev-parse', 'HEAD').trim()
  return { dir, hash, cleanup: async () => fs.rm(dir, { recursive: true, force: true }) }
}

test('runGitShow 查得到提交：作者/日期/message/变更统计/完整 hash/GitHub 链接', { skip: !hasGit }, async () => {
  const repo = await makeRepo()
  try {
    const info = await runGitShow(repo.hash.slice(0, 7), repo.dir)
    assert.ok(info, 'should resolve')
    assert.equal(info.found, true)
    assert.equal(info.sha, repo.hash.slice(0, 7))
    assert.equal(info.commitHash, repo.hash)
    assert.equal(info.message, 'feat: add two files (a)')
    assert.equal(info.fullMessage, 'feat: add two files (a)\nbody line')
    assert.equal(info.authorName, 'Ada Lovelace')
    assert.equal(info.authorEmail, 'ada@example.com')
    assert.equal(info.files, 2)
    assert.equal(info.insertions, 3)
    assert.equal(info.githubUrl, `https://github.com/example/repo/commit/${repo.hash}`)
    assert.match(info.commitDate ?? '', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  } finally {
    await repo.cleanup()
  }
})

test('runGitShow 完整 hash 也能查（40 位）', { skip: !hasGit }, async () => {
  const repo = await makeRepo()
  try {
    const info = await runGitShow(repo.hash, repo.dir)
    assert.equal(info?.found, true)
    assert.equal(info?.commitHash, repo.hash)
  } finally {
    await repo.cleanup()
  }
})

test('runGitShow 找不到的提交回 found=false（不抛错）', { skip: !hasGit }, async () => {
  const repo = await makeRepo()
  try {
    const info = await runGitShow('deadbeef', repo.dir)
    assert.equal(info?.found, false)
    assert.equal(info?.sha, 'deadbeef')
  } finally {
    await repo.cleanup()
  }
})

test('runGitShow 在非仓库目录回 found=false；git 缺席回 undefined', { skip: !hasGit }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dshone-nogit-'))
  try {
    const info = await runGitShow('deadbeef', dir)
    assert.equal(info?.found, false)
    const missing = await runGitShow('deadbeef', dir, { gitPath: 'dsh-one-git-does-not-exist' })
    assert.equal(missing, undefined)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('会话属 B 工作区时以 B 路径查询（不是宿主自己的 A 目录）', { skip: !hasGit }, async () => {
  const repoA = await makeRepo('alpha')
  const repoB = await makeRepo('beta')
  try {
    // 宿主的「VS Code 工作区」是 A；当前会话的工作区路径是 B（两者都在允许根里）
    const allowedRoots = [repoA.dir, repoB.dir]
    const resolved = await resolveQueryDir(repoB.dir, repoA.dir, allowedRoots)
    const dir = resolved?.dir
    assert.equal(dir, await fs.realpath(repoB.dir))
    assert.equal(resolved?.usedRequested, true)
    // B 里的提交在 B 查得到
    const inB = await runGitShow(repoB.hash.slice(0, 7), dir ?? repoB.dir)
    assert.equal(inB?.found, true)
    assert.equal(inB?.commitHash, repoB.hash)
    // A 的提交拿去 B 查 → 查不到（证明确实走的是 B，而不是宿主自己的 A）
    const crossRepo = await runGitShow(repoA.hash.slice(0, 7), dir ?? repoB.dir)
    assert.equal(crossRepo?.found, false)
    // 会话工作区路径不在允许根里（域外）→ 回落到宿主的 A，不报错
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'dshone-outside-'))
    try {
      const fallbackResolved = await resolveQueryDir(outside, repoA.dir, allowedRoots)
      const fallback = fallbackResolved?.dir
      assert.equal(fallback, await fs.realpath(repoA.dir))
      assert.equal(fallbackResolved?.usedRequested, false)
      const inA = await runGitShow(repoA.hash.slice(0, 7), fallback ?? repoA.dir)
      assert.equal(inA?.found, true)
    } finally {
      await fs.rm(outside, { recursive: true, force: true })
    }
  } finally {
    await repoA.cleanup()
    await repoB.cleanup()
  }
})
