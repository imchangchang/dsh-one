import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { workspaceFileCandidates } from '../src/ui/workspaceScan.ts'

/** 建独立临时 cwd（每个测试一个，互不污染缓存键），测后清理。 */
async function tmpCwd(t: import('node:test').TestContext): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-ws-scan-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  return dir
}

async function paths(cwd: string | undefined, query = ''): Promise<string[]> {
  return (await workspaceFileCandidates(cwd, query)).map((c) => c.path)
}

// ---- 基本扫描：深度 1、绝对路径、排序 ----

test('workspaceScan: cwd 顶层与一层子目录文件进候选，按路径排序', async (t) => {
  const cwd = await tmpCwd(t)
  await fs.writeFile(path.join(cwd, 'b.txt'), '')
  await fs.writeFile(path.join(cwd, 'a.txt'), '')
  await fs.mkdir(path.join(cwd, 'sub'))
  await fs.writeFile(path.join(cwd, 'sub', 'c.txt'), '')
  // 二层子目录不进候选（深度维持 1 层）
  await fs.mkdir(path.join(cwd, 'sub', 'deep'))
  await fs.writeFile(path.join(cwd, 'sub', 'deep', 'd.txt'), '')

  assert.deepEqual(await paths(cwd), [
    path.join(cwd, 'a.txt'),
    path.join(cwd, 'b.txt'),
    path.join(cwd, 'sub', 'c.txt'),
  ])
  // 缺 cwd 返回空
  assert.deepEqual(await paths(undefined), [])
})

test('workspaceScan: 隐藏条目与排除目录（node_modules/dist 等）不进候选', async (t) => {
  const cwd = await tmpCwd(t)
  await fs.writeFile(path.join(cwd, '.dotfile'), '')
  await fs.writeFile(path.join(cwd, '.hidden.txt'), '')
  await fs.mkdir(path.join(cwd, '.git'))
  await fs.writeFile(path.join(cwd, '.git', 'config'), '')
  await fs.mkdir(path.join(cwd, 'node_modules'))
  await fs.writeFile(path.join(cwd, 'node_modules', 'pkg.js'), '')
  await fs.mkdir(path.join(cwd, 'dist'))
  await fs.writeFile(path.join(cwd, 'dist', 'app.js'), '')
  await fs.writeFile(path.join(cwd, 'ok.ts'), '')

  assert.deepEqual(await paths(cwd), [path.join(cwd, 'ok.ts')])
})

// ---- symlink：lstat 不跟随，链接条目直接跳过 ----

test('workspaceScan: symlink 条目（文件/目录链接）跳过，不跟随', async (t) => {
  const cwd = await tmpCwd(t)
  const outside = await tmpCwd(t)
  await fs.writeFile(path.join(outside, 'secret.txt'), '')
  await fs.mkdir(path.join(outside, 'outside-dir'))
  await fs.writeFile(path.join(outside, 'outside-dir', 'x.txt'), '')
  await fs.writeFile(path.join(cwd, 'real.txt'), '')
  try {
    await fs.symlink(path.join(outside, 'secret.txt'), path.join(cwd, 'link-file.txt'))
    await fs.symlink(path.join(outside, 'outside-dir'), path.join(cwd, 'link-dir'))
  } catch {
    t.skip('symlink 不可用（平台权限限制）')
    return
  }
  // 链接目标可能不存在（破损链接）也不影响：一律按条目直接跳过。
  await fs.symlink(path.join(outside, 'gone.txt'), path.join(cwd, 'link-broken.txt'))

  assert.deepEqual(await paths(cwd), [path.join(cwd, 'real.txt')])
})

// ---- 子目录数量上限 64 ----

test('workspaceScan: 子目录只扫排序后前 64 个', async (t) => {
  const cwd = await tmpCwd(t)
  for (let i = 0; i < 65; i += 1) {
    const d = path.join(cwd, `d${String(i).padStart(2, '0')}`)
    await fs.mkdir(d)
    await fs.writeFile(path.join(d, 'f.txt'), '')
  }
  const got = await paths(cwd)
  assert.equal(got.length, 64)
  // 前 64 个（按名字排序）的子目录文件都在，d64（第 65 个）被裁掉
  assert.ok(got.includes(path.join(cwd, 'd00', 'f.txt')))
  assert.ok(got.includes(path.join(cwd, 'd63', 'f.txt')))
  assert.ok(!got.includes(path.join(cwd, 'd64', 'f.txt')))
})

// ---- 候选总数上限 200 ----

test('workspaceScan: 候选总数上限 200', async (t) => {
  const cwd = await tmpCwd(t)
  for (let i = 0; i < 150; i += 1) {
    await fs.writeFile(path.join(cwd, `f${String(i).padStart(3, '0')}.txt`), '')
  }
  await fs.mkdir(path.join(cwd, 's1'))
  await fs.mkdir(path.join(cwd, 's2'))
  for (let i = 0; i < 60; i += 1) {
    await fs.writeFile(path.join(cwd, 's1', `a${String(i).padStart(2, '0')}.txt`), '')
    await fs.writeFile(path.join(cwd, 's2', `b${String(i).padStart(2, '0')}.txt`), '')
  }
  const got = await paths(cwd)
  assert.equal(got.length, 200)
  assert.ok(got.every((p) => p.startsWith(cwd)))
})

// ---- 候选池缓存：目录 mtime 指纹失效 ----

/** 等待目录 mtime 超过 before：粗粒度文件系统（mtime 按秒跳动）下，触碰
 *  目录（写+删探针文件）并轮询直到时间戳可见，避免缓存测试偶发读到旧值。 */
async function waitMtimePast(dir: string, before: number): Promise<void> {
  const probe = path.join(dir, '.mtime-probe')
  for (let i = 0; i < 50; i += 1) {
    await fs.writeFile(probe, '')
    await fs.rm(probe, { force: true })
    if ((await fs.stat(dir)).mtimeMs > before) return
    await sleep(10)
  }
}

test('workspaceScan: 子目录内增删文件触发重扫（子目录 mtime 变化）', async (t) => {
  const cwd = await tmpCwd(t)
  await fs.mkdir(path.join(cwd, 'sub'))
  await fs.writeFile(path.join(cwd, 'sub', 'a.txt'), '')
  assert.deepEqual(await paths(cwd), [path.join(cwd, 'sub', 'a.txt')])

  let m0 = (await fs.stat(path.join(cwd, 'sub'))).mtimeMs
  await fs.writeFile(path.join(cwd, 'sub', 'b.txt'), '')
  await waitMtimePast(path.join(cwd, 'sub'), m0)
  // 子目录内容增删 → 目录 mtime 变化 → 指纹失效重扫
  assert.deepEqual(await paths(cwd), [
    path.join(cwd, 'sub', 'a.txt'),
    path.join(cwd, 'sub', 'b.txt'),
  ])

  m0 = (await fs.stat(path.join(cwd, 'sub'))).mtimeMs
  await fs.rm(path.join(cwd, 'sub', 'a.txt'))
  await waitMtimePast(path.join(cwd, 'sub'), m0)
  assert.deepEqual(await paths(cwd), [path.join(cwd, 'sub', 'b.txt')])
})

test('workspaceScan: cwd 顶层增删文件触发重扫', async (t) => {
  const cwd = await tmpCwd(t)
  await fs.writeFile(path.join(cwd, 'a.txt'), '')
  assert.deepEqual(await paths(cwd), [path.join(cwd, 'a.txt')])

  const m0 = (await fs.stat(cwd)).mtimeMs
  await fs.writeFile(path.join(cwd, 'b.txt'), '')
  await waitMtimePast(cwd, m0)
  assert.deepEqual(await paths(cwd), [
    path.join(cwd, 'a.txt'),
    path.join(cwd, 'b.txt'),
  ])
})

test('workspaceScan: 文件内容变化不触发重扫（候选只含路径，无内容依赖）', async (t) => {
  const cwd = await tmpCwd(t)
  await fs.writeFile(path.join(cwd, 'a.txt'), 'v1')
  const before = await paths(cwd)
  await sleep(15)
  await fs.writeFile(path.join(cwd, 'a.txt'), 'v2-longer')
  // 内容变了但目录 mtime 不变；候选列表不变即缓存仍有效
  assert.deepEqual(await paths(cwd), before)
})

// ---- 边界：工作区目录被删/被改名 ----

test('workspaceScan: cwd 被删后返回空，重建后自愈', async (t) => {
  const root = await tmpCwd(t)
  const cwd = path.join(root, 'ws')
  await fs.mkdir(cwd)
  await fs.writeFile(path.join(cwd, 'a.txt'), '')
  assert.deepEqual(await paths(cwd), [path.join(cwd, 'a.txt')])

  await sleep(15)
  await fs.rm(cwd, { recursive: true, force: true })
  assert.deepEqual(await paths(cwd), [])

  await sleep(15)
  await fs.mkdir(cwd)
  await fs.writeFile(path.join(cwd, 'b.txt'), '')
  assert.deepEqual(await paths(cwd), [path.join(cwd, 'b.txt')])
})

test('workspaceScan: cwd 被改名后旧路径空、新路径可扫', async (t) => {
  const root = await tmpCwd(t)
  const old = path.join(root, 'ws-old')
  await fs.mkdir(old)
  await fs.writeFile(path.join(old, 'a.txt'), '')
  assert.deepEqual(await paths(old), [path.join(old, 'a.txt')])

  await sleep(15)
  const moved = path.join(root, 'ws-new')
  await fs.rename(old, moved)
  assert.deepEqual(await paths(old), [])
  assert.deepEqual(await paths(moved), [path.join(moved, 'a.txt')])
})

// ---- query 过滤：池上内存过滤 ----

test('workspaceScan: query 按文件名包含过滤，大小写不敏感', async (t) => {
  const cwd = await tmpCwd(t)
  await fs.writeFile(path.join(cwd, 'Report.md'), '')
  await fs.writeFile(path.join(cwd, 'report-notes.txt'), '')
  await fs.writeFile(path.join(cwd, 'other.txt'), '')

  const reportMd = path.join(cwd, 'Report.md')
  const reportNotes = path.join(cwd, 'report-notes.txt')
  const other = path.join(cwd, 'other.txt')
  // 排序号与实现对 localeCompare；期望顺序按同一规则排（避免 locale 依赖）
  const lc = (...ps: string[]) => [...ps].sort((a, b) => a.localeCompare(b))

  assert.deepEqual(await paths(cwd, 'report'), lc(reportMd, reportNotes))
  assert.deepEqual(await paths(cwd, 'OTHER'), [other])
  assert.deepEqual(await paths(cwd, '  '), lc(reportMd, other, reportNotes))
  assert.deepEqual(await paths(cwd, 'nope'), [])
})

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
