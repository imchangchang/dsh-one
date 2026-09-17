/**
 * commit 卡数据面（纯函数）+ 宿主能力桥参数校核的单测（#65 批 1）。
 * hostBridge 的 vscode 相关部分不可在 node 里跑，这里只覆盖纯函数：
 * 参数校核（hash / URL / 目录限域）与 git 输出解析。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  COMMIT_SHA_RE,
  GIT_INFO_FORMAT,
  commitInfoFromShowRecord,
  githubUrlFromRemoteUrl,
  parseGitShowOutput,
  parseShortStatText,
} from '../src/pure/gitShow.ts'

/** 造一段 git log --no-walk --format=... --shortstat 的真实形状输出。 */
function gitOutput(records: Array<{ hash: string; author: string; email: string; iso: string; subject: string; body: string; stat?: string }>): string {
  return records
    .map(
      (r) =>
        `${r.hash}\x00${r.author}\x00${r.email}\x00${r.iso}\x00${r.subject}\x00${r.body}\x00\n${r.stat ?? ''}`,
    )
    .join('')
}

test('GIT_INFO_FORMAT 是 6 个 NUL 分隔字段 + 记录终止符', () => {
  assert.equal(GIT_INFO_FORMAT, '%H%x00%an%x00%ae%x00%aI%x00%s%x00%b%x00')
})

test('parseGitShowOutput 解析单条记录与 --shortstat', () => {
  const hash = 'a'.repeat(40)
  const out = gitOutput([
    {
      hash,
      author: 'Ada',
      email: 'ada@example.com',
      iso: '2026-09-03T10:00:00+08:00',
      subject: 'feat: 标题',
      body: '正文第一行\n正文第二行',
      stat: ' 3 files changed, 12 insertions(+), 4 deletions(-)\n',
    },
  ])
  const [rec] = parseGitShowOutput(out)
  assert.equal(rec.hash, hash)
  assert.equal(rec.authorName, 'Ada')
  assert.equal(rec.authorEmail, 'ada@example.com')
  assert.equal(rec.isoDate, '2026-09-03T10:00:00+08:00')
  assert.equal(rec.subject, 'feat: 标题')
  assert.equal(rec.body, '正文第一行\n正文第二行')
  assert.deepEqual(rec.shortStat, { files: 3, insertions: 12, deletions: 4 })
})

test('parseGitShowOutput 解析多条记录（shortstat 归各自记录）', () => {
  const a = 'a'.repeat(40)
  const b = 'b'.repeat(40)
  const out = gitOutput([
    { hash: a, author: 'A', email: 'a@x', iso: '2026-09-01T00:00:00Z', subject: 'one', body: '', stat: ' 1 file changed, 2 insertions(+)\n' },
    { hash: b, author: 'B', email: 'b@x', iso: '2026-09-02T00:00:00Z', subject: 'two', body: '', stat: ' 2 files changed, 5 deletions(-)\n' },
  ])
  const records = parseGitShowOutput(out)
  assert.equal(records.length, 2)
  assert.deepEqual(records[0].shortStat, { files: 1, insertions: 2, deletions: undefined })
  assert.deepEqual(records[1].shortStat, { files: 2, insertions: undefined, deletions: 5 })
})

test('parseGitShowOutput merge 提交无 shortstat 时留空', () => {
  const hash = 'c'.repeat(40)
  const out = gitOutput([{ hash, author: 'A', email: '', iso: '2026-09-01T00:00:00Z', subject: 'merge', body: '' }])
  const [rec] = parseGitShowOutput(out)
  assert.equal(rec.shortStat, undefined)
})

test('parseShortStatText 支持千分位与纯删除', () => {
  assert.deepEqual(parseShortStatText(' 1,234 files changed, 5,678 insertions(+)\n'), {
    files: 1234,
    insertions: 5678,
    deletions: undefined,
  })
  assert.deepEqual(parseShortStatText(' 1 file changed, 2 deletions(-)\n'), { files: 1, insertions: undefined, deletions: 2 })
  assert.equal(parseShortStatText('\n\n'), undefined)
})

test('githubUrlFromRemoteUrl 认 https 与 ssh 两种形状，非 GitHub 返回 undefined', () => {
  const sha = 'd'.repeat(40)
  assert.equal(githubUrlFromRemoteUrl('https://github.com/o/r.git', sha), `https://github.com/o/r/commit/${sha}`)
  assert.equal(githubUrlFromRemoteUrl('git@github.com:o/r.git', sha), `https://github.com/o/r/commit/${sha}`)
  assert.equal(githubUrlFromRemoteUrl('https://gitlab.com/o/r.git', sha), undefined)
  assert.equal(githubUrlFromRemoteUrl(undefined, sha), undefined)
})

test('commitInfoFromShowRecord 投影成页面用的提交信息（含 GitHub 链接）', () => {
  const hash = 'e'.repeat(40)
  const info = commitInfoFromShowRecord('abc1234', {
    hash,
    authorName: 'Ada',
    authorEmail: '',
    isoDate: '2026-09-03T10:00:00+08:00',
    subject: 'feat: 标题',
    body: '正文',
    shortStat: { files: 1, insertions: 2 },
  }, 'https://github.com/o/r/commit/x')
  assert.equal(info.sha, 'abc1234')
  assert.equal(info.found, true)
  assert.equal(info.commitHash, hash)
  assert.equal(info.message, 'feat: 标题')
  assert.equal(info.fullMessage, 'feat: 标题\n正文')
  assert.equal(info.authorName, 'Ada')
  assert.equal(info.authorEmail, undefined)
  assert.equal(info.files, 1)
  assert.equal(info.githubUrl, 'https://github.com/o/r/commit/x')
  // commitDate 是本机时区的 ISO 分钟精度（同旧实现，供相对时间计算）
  assert.match(info.commitDate ?? '', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
})

test('COMMIT_SHA_RE 只认独立 hex 串（不切开长串/英文词）', () => {
  const matches = (text: string): string[] => {
    COMMIT_SHA_RE.lastIndex = 0
    return [...text.matchAll(COMMIT_SHA_RE)].map((m) => m[1])
  }
  assert.deepEqual(matches('见 abc1234 与 0123456789abcdef0123456789abcdef01234567'), [
    'abc1234',
    '0123456789abcdef0123456789abcdef01234567',
  ])
  assert.deepEqual(matches('deadbeefdeadbeefdeadbeefdeadbeefdeadbeef00'), [])
  assert.deepEqual(matches('abcdef'), [])
  // 两端只挡「相邻还是 hex」的字符：非 hex 字母不影响（与旧实现同口径）
  assert.deepEqual(matches('xabc1234y'), ['abc1234'])
})
