/**
 * 宿主能力桥参数校核的单测（#65 批 1）：把「不可信输入能做什么」钉死在
 * 纯函数层——提交号形状、URL 协议白名单、目录限域（工作区 / ~/.dsh 之内）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import {
  COMMIT_SHA_ARG_RE,
  isHostCallError,
  parseAllowedUrl,
  parseGitShowArgs,
  resolveAllowedDir,
} from '../src/pure/hostCalls.ts'

test('COMMIT_SHA_ARG_RE 只认 7–40 位 hex', () => {
  assert.equal(COMMIT_SHA_ARG_RE.test('abc1234'), true)
  assert.equal(COMMIT_SHA_ARG_RE.test('A'.repeat(40)), true)
  assert.equal(COMMIT_SHA_ARG_RE.test('abc123'), false)
  assert.equal(COMMIT_SHA_ARG_RE.test('abcd1234567890abcd1234567890abcd123456789'), false)
  assert.equal(COMMIT_SHA_ARG_RE.test('abc1234; rm -rf /'), false)
  assert.equal(COMMIT_SHA_ARG_RE.test('--upload-pack=evil'), false)
})

test('parseGitShowArgs 拒绝非对象 / 缺 hash / hash 形状不对 / cwd 非字符串', () => {
  for (const bad of [undefined, null, 'abc1234', [], {}, { hash: 123 }, { hash: 'zzzzzzz' }, { hash: 'abc1234', cwd: 7 }]) {
    const result = parseGitShowArgs(bad)
    assert.equal(isHostCallError(result), true, `should reject ${JSON.stringify(bad)}`)
    assert.equal((result as { code: string }).code, 'invalid-args')
  }
})

test('parseGitShowArgs 收下合法的 hash 与可选 cwd', () => {
  assert.deepEqual(parseGitShowArgs({ hash: 'abc1234' }), { hash: 'abc1234' })
  assert.deepEqual(parseGitShowArgs({ hash: 'abc1234', cwd: '/tmp' }), { hash: 'abc1234', cwd: '/tmp' })
})

test('parseAllowedUrl 只放行 http/https/mailto', () => {
  assert.equal(parseAllowedUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1')
  assert.equal(parseAllowedUrl('http://127.0.0.1:3080/'), 'http://127.0.0.1:3080/')
  assert.equal(parseAllowedUrl('mailto:a@b.c'), 'mailto:a@b.c')
  for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'vscode://x', 'data:text/html,<h1>', 'not a url', '', 7, undefined]) {
    assert.equal(parseAllowedUrl(bad), null, `should reject ${String(bad)}`)
  }
})

test('resolveAllowedDir 只认允许根之内的真实目录', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dshone-hostcall-'))
  const inside = path.join(root, 'work')
  const outside = mkdtempSync(path.join(os.tmpdir(), 'dshone-outside-'))
  await fs.mkdir(inside)
  try {
    assert.equal(await resolveAllowedDir(inside, [root]), await fs.realpath(inside))
    assert.equal(await resolveAllowedDir(root, [root]), await fs.realpath(root))
    // 相对路径、越界目录、不存在的目录、带 NUL 的路径一律拒绝
    assert.equal(await resolveAllowedDir('relative/dir', [root]), null)
    assert.equal(await resolveAllowedDir(outside, [root]), null)
    assert.equal(await resolveAllowedDir(path.join(root, 'nope'), [root]), null)
    assert.equal(await resolveAllowedDir(`${root}\0/x`, [root]), null)
    // `..` 逃逸：realpath 之后落在根外
    assert.equal(await resolveAllowedDir(path.join(root, '..'), [root]), null)
    // 允许根本身不存在（~/.dsh 未建）时不影响其它根
    assert.equal(await resolveAllowedDir(inside, [path.join(root, 'missing'), root]), await fs.realpath(inside))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(outside, { recursive: true, force: true })
  }
})

test('resolveAllowedDir 解符号链接后判定（链接指到根外即拒绝）', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dshone-link-root-'))
  const outside = mkdtempSync(path.join(os.tmpdir(), 'dshone-link-out-'))
  const link = path.join(root, 'escape')
  try {
    await fs.symlink(outside, link, 'dir')
    assert.equal(await resolveAllowedDir(link, [root]), null)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(outside, { recursive: true, force: true })
  }
})
