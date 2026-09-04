import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  GIT_INFO_FORMAT,
  commitInfoFromShowRecord,
  formatCommitDate,
  githubUrlFromRemoteUrl,
  parseGitShowOutput,
  parseShortStatText,
} from '../src/pure/commitGit.ts'

/**
 * 真实 git 输出夹具（od 实测形状）：每条记录 = 6 个 NUL 分隔字段 + 记录终止 NUL，
 * 随后「\n（format 终止符）+ \n 统计行 + \n」，再紧跟下一条记录，中间没有分隔符。
 */
const REC1 =
  '44ab2a07275e746a7d95a53ffbfb7ae82db0deee\x00A\x00a@b.c\x002026-09-04T23:03:22+08:00\x00second commit\x00\x00'
const STAT1 = '\n\n 1 file changed, 1 insertion(+)\n'
const REC2 =
  'cb1f933e15289a00e30865e8dd3963ba90a96780\x00Demo Author\x00demo@example.com\x002026-09-03T10:00:00+08:00\x00feat(demo): 初始提交\x00这是 body 第二行。\n\x00'
const STAT2 = '\n\n 1 file changed, 1 insertion(+)\n'

test('parseGitShowOutput：批量两条记录，字段与统计按记录对应（body 空/含换行）', () => {
  const records = parseGitShowOutput(REC1 + STAT1 + REC2 + STAT2)
  assert.equal(records.length, 2)
  assert.deepEqual(
    { ...records[0] },
    {
      hash: '44ab2a07275e746a7d95a53ffbfb7ae82db0deee',
      authorName: 'A',
      authorEmail: 'a@b.c',
      isoDate: '2026-09-04T23:03:22+08:00',
      subject: 'second commit',
      body: '',
      shortStat: { files: 1, insertions: 1, deletions: undefined },
    },
  )
  assert.equal(records[1].hash, 'cb1f933e15289a00e30865e8dd3963ba90a96780')
  assert.equal(records[1].subject, 'feat(demo): 初始提交')
  // %b 原样带回 message 尾部换行（git commit 存储的 body 带末尾 \n）
  assert.equal(records[1].body, '这是 body 第二行。\n')
  assert.equal(records[1].shortStat?.files, 1)
  assert.equal(records[1].shortStat?.insertions, 1)
})

test('parseGitShowOutput：无统计记录（如 merge）+ 末尾记录统计归属', () => {
  const out =
    REC1 + '\n\n 1 file changed, 1 insertion(+)\n' +
    REC2 + '\n'
  const records = parseGitShowOutput(out)
  assert.equal(records.length, 2)
  // 没有统计行 → shortStat 缺省（卡片不显示统计节）
  assert.equal(records[1].shortStat, undefined)
  assert.equal(records[0].shortStat?.files, 1)
})

test('parseGitShowOutput：空输出/无匹配文本 → 空数组', () => {
  assert.deepEqual(parseGitShowOutput(''), [])
  assert.deepEqual(parseGitShowOutput(' 1 file changed'), [])
})

test('parseShortStatText：纯删除无 insertions 段 / 千分位 / 无统计', () => {
  assert.deepEqual(parseShortStatText('\n\n 1 file changed, 2 deletions(-)\n'), {
    files: 1, insertions: undefined, deletions: 2,
  })
  assert.deepEqual(parseShortStatText(' 2 files changed, 1,234 insertions(+), 56 deletions(-)'), {
    files: 2, insertions: 1234, deletions: 56,
  })
  assert.deepEqual(parseShortStatText('\n\n'), undefined)
  assert.deepEqual(parseShortStatText(''), undefined)
})

test('githubUrlFromRemoteUrl：https/git@ 两种形状 + 非 GitHub 返回 undefined', () => {
  const sha = 'cb1f933e15289a00e30865e8dd3963ba90a96780'
  assert.equal(
    githubUrlFromRemoteUrl('https://github.com/imchangchang/dsh-one.git', sha),
    `https://github.com/imchangchang/dsh-one/commit/${sha}`,
  )
  assert.equal(
    githubUrlFromRemoteUrl('git@github.com:imchangchang/dsh-one.git', sha),
    `https://github.com/imchangchang/dsh-one/commit/${sha}`,
  )
  assert.equal(githubUrlFromRemoteUrl('https://gitlab.com/a/b.git', sha), undefined)
  assert.equal(githubUrlFromRemoteUrl('', sha), undefined)
  assert.equal(githubUrlFromRemoteUrl(undefined, sha), undefined)
  // CLI 兜底 origin 输出可能带尾部换行
  assert.equal(
    githubUrlFromRemoteUrl('https://github.com/a/b.git\n', sha),
    `https://github.com/a/b/commit/${sha}`,
  )
})

test('commitInfoFromShowRecord：投影字段与 fullMessage 组装（subject + body）', () => {
  const info = commitInfoFromShowRecord('cb1f933', {
    hash: 'cb1f933e15289a00e30865e8dd3963ba90a96780',
    authorName: 'Demo Author',
    authorEmail: 'demo@example.com',
    isoDate: '2026-09-03T10:00:00+08:00',
    subject: 'feat(demo): 初始提交',
    body: '这是 body 第二行。\n',
    shortStat: { files: 1, insertions: 1, deletions: 0 },
  })
  assert.equal(info.sha, 'cb1f933')
  assert.equal(info.commitHash, 'cb1f933e15289a00e30865e8dd3963ba90a96780')
  assert.equal(info.found, true)
  assert.equal(info.message, 'feat(demo): 初始提交')
  assert.equal(info.fullMessage, 'feat(demo): 初始提交\n这是 body 第二行。')
  assert.equal(info.authorName, 'Demo Author')
  assert.equal(info.authorEmail, 'demo@example.com')
  assert.match(info.commitDate ?? '', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  assert.equal(info.files, 1)
  assert.equal(info.deletions, 0)
})

test('commitInfoFromShowRecord：空 body / 空 email 省略与兜底', () => {
  const info = commitInfoFromShowRecord('abc1234', {
    hash: 'abc1234abcdefabcdefabcdefabcdefabcdef',
    authorName: 'NoMail',
    authorEmail: '',
    isoDate: '2026-09-03T10:00:00+08:00',
    subject: 'no body',
    body: '',
  })
  assert.equal(info.fullMessage, 'no body')
  assert.equal(info.authorEmail, undefined)
  assert.equal(info.files, undefined)
})

test('formatCommitDate：本地时间渲染与无效日期', () => {
  assert.equal(formatCommitDate(new Date(2026, 8, 3, 10, 5)), '2026-09-03T10:05')
  assert.equal(formatCommitDate(new Date(Number.NaN)), '')
})

test('真实 git：git show -s 输出可被解析（跨 git 版本格式守卫，无 git 时跳过）', (t) => {
  try {
    execFileSync('git', ['--version'], { stdio: 'pipe' })
  } catch {
    t.skip('git 不可用')
    return
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-commit-git-'))
  try {
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: 'Demo Author',
      GIT_AUTHOR_EMAIL: 'demo@example.com',
      GIT_AUTHOR_DATE: '2026-09-03T10:00:00+08:00',
      GIT_COMMITTER_NAME: 'Demo Author',
      GIT_COMMITTER_EMAIL: 'demo@example.com',
      GIT_COMMITTER_DATE: '2026-09-03T10:00:00+08:00',
    }
    execFileSync('git', ['init', '-q'], { cwd: dir })
    fs.writeFileSync(path.join(dir, 'README.md'), 'demo content\n')
    execFileSync('git', ['add', 'README.md'], { cwd: dir })
    execFileSync(
      'git',
      ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'feat(demo): 初始提交', '-m', '这是 body 第二行。'],
      { cwd: dir, env },
    )
    // 批量：git log --no-walk 两个 sha（HEAD 与 HEAD~1 之外再补一个不存在的走 show 兜底由单测覆盖）
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
    const out = execFileSync('git', ['log', '--no-walk', `--format=${GIT_INFO_FORMAT}`, '--shortstat', sha], {
      cwd: dir, encoding: 'utf8',
    })
    const [rec] = parseGitShowOutput(out)
    assert.ok(rec, '真实 git 输出应解析出记录')
    assert.equal(rec.hash, sha)
    assert.equal(rec.authorName, 'Demo Author')
    assert.equal(rec.authorEmail, 'demo@example.com')
    assert.equal(rec.subject, 'feat(demo): 初始提交')
    assert.equal(rec.body.trim(), '这是 body 第二行。')
    assert.equal(rec.shortStat?.files, 1)
    assert.equal(rec.shortStat?.insertions, 1)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
