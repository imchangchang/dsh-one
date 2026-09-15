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
  resolveQueryDir,
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

test('resolveQueryDir：会话工作区路径在允许根内时优先用它', async () => {
  const vscodeFolder = mkdtempSync(path.join(os.tmpdir(), 'dshone-qdir-vscode-'))
  const gatewayWorkspace = mkdtempSync(path.join(os.tmpdir(), 'dshone-qdir-gateway-'))
  const outside = mkdtempSync(path.join(os.tmpdir(), 'dshone-qdir-out-'))
  try {
    // 「VS Code 工作区 + 网关会话工作区」两类根都算允许根
    const roots = [vscodeFolder, gatewayWorkspace]
    const used = (r: { dir: string } | null): string | null => (r === null ? null : r.dir)
    assert.equal(used(await resolveQueryDir(gatewayWorkspace, vscodeFolder, roots)), await fs.realpath(gatewayWorkspace))
    assert.equal((await resolveQueryDir(gatewayWorkspace, vscodeFolder, roots))?.usedRequested, true)
    // 会话工作区越界（不在任何允许根里）→ 回落到 VS Code 工作区，并标出「用的不是请求值」
    assert.equal(used(await resolveQueryDir(outside, vscodeFolder, roots)), await fs.realpath(vscodeFolder))
    assert.equal((await resolveQueryDir(outside, vscodeFolder, roots))?.usedRequested, false)
    // 越界且没有回落目录 → null（调用方给 no-workspace）
    assert.equal(await resolveQueryDir(outside, undefined, roots), null)
    // 没给会话工作区（空白会话/数据未就绪）→ 直接用回落目录（同样标 usedRequested=false）
    assert.equal(used(await resolveQueryDir(undefined, vscodeFolder, roots)), await fs.realpath(vscodeFolder))
    assert.equal((await resolveQueryDir(undefined, vscodeFolder, roots))?.usedRequested, false)
    // 回落目录本身也不可用（没开工作区）→ null
    assert.equal(await resolveQueryDir(undefined, undefined, roots), null)
    // 子目录：落在网关注册工作区之内即可用
    const sub = path.join(gatewayWorkspace, 'pkg')
    await fs.mkdir(sub)
    assert.equal(used(await resolveQueryDir(sub, vscodeFolder, roots)), await fs.realpath(sub))
  } finally {
    for (const dir of [vscodeFolder, gatewayWorkspace, outside]) await fs.rm(dir, { recursive: true, force: true })
  }
})
