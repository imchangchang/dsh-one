/**
 * 单测 scratch 目录的常驻判据（#200）：跑完不留新目录。
 *
 * 为什么要单独一个文件：`node --test` 里一个文件一个子进程，没有任何一个用例能在自己
 * 跑完之后再数一遍「刚才那轮留下了什么」——只能从外面看。所以这里起一个**子进程**，
 * 在**隔离的 `$TMPDIR`** 里把它那一族真跑一遍（跑的是本仓真在用的那些单测文件），
 * 回来数那个临时根：命中小前缀的目录必须是 0。
 *
 * 隔离 `$TMPDIR` 有两个作用：① 外层的并发文件同时在建自己的目录，不隔离就数不准；
 * ② 数出来的是「这轮新建的」，不是历史上堆下来的（#200 前就堆了三万多）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import * as path from 'node:path'
import { SCRATCH_PREFIXES, scratchDirSync, scratchEntriesIn } from './scratchDirs.ts'

const ROOT = path.join(import.meta.dirname, '..')
const TEST_DIR = import.meta.dirname
const SELF = path.join(TEST_DIR, 'scratchDirs.test.ts')

/** `npm test` 认的测试文件（glob 展开后的同一批）。 */
function npmTestFiles(): string[] {
  const out: string[] = []
  for (const dir of [TEST_DIR, path.join(TEST_DIR, 'mock-dsh'), path.join(TEST_DIR, 'mock-llm')]) {
    for (const name of readdirSync(dir)) {
      if (name.endsWith('.test.ts')) out.push(path.join(dir, name))
    }
  }
  return out.sort()
}

/** 扫 `test/**`（跳过生成物目录与点开头目录），回调每个源码文件。 */
function eachTestSourceFile(visit: (file: string, source: string) => void): void {
  const skipDirs = new Set(['node_modules', 'out', 'out-empty', '.build-mock-llm'])
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name) && !entry.name.startsWith('.')) walk(full)
        continue
      }
      if (/\.(ts|mjs|js)$/.test(entry.name)) visit(full, readFileSync(full, 'utf8'))
    }
  }
  walk(TEST_DIR)
}

test('scratchDir / scratchDirSync：进程退出时删干净（子进程实测）', () => {
  const root = scratchDirSync('dsh-scratch-guard-')
  const code = `
    const mod = await import(process.env.DSH_SCRATCH_MODULE)
    await mod.scratchDir('dsh-state-test-')
    mod.scratchDirSync('dsh-owned-test-')
    console.log('made', process.env.TMPDIR)
  `
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, TMPDIR: root, DSH_SCRATCH_MODULE: path.join(TEST_DIR, 'scratchDirs.ts') },
  })
  assert.equal(r.status, 0, `子进程没跑成：\n${r.stdout}\n${r.stderr}`)
  assert.match(r.stdout, /made/)
  assert.deepEqual(readdirSync(root), [], '子进程正常退出后，它建的 scratch 目录必须已经删掉（#200）')
})

test('test/ 下的 scratch 目录一律出自 scratchDirs.ts，且前缀都登记在表里', () => {
  const naked: string[] = []
  const unregistered: string[] = []
  const helper = path.join(TEST_DIR, 'scratchDirs.ts')

  eachTestSourceFile((file, source) => {
    if (file === helper) return
    for (const re of [/mkdtemp(?:Sync)?\(/g, /\bscratchDir(?:Sync)?\(/g]) {
      for (const match of source.matchAll(re)) {
        const at = `${path.relative(ROOT, file)}:${String(source.slice(0, match.index).split('\n').length)}`
        const call = source.slice(match.index, match.index + 200)
        if (match[0].startsWith('mkdtemp')) {
          // 只管建在 `$TMPDIR` 下的那些：建在别人家目录里的随人家一起删，不归这里管。
          if (/tmpdir\(\)/.test(call)) naked.push(at)
          continue
        }
        const prefix = /['"]([a-z0-9-]+-)['"]/.exec(call)?.[1]
        if (prefix === undefined) unregistered.push(`${at}（读不出前缀字面量）`)
        else if (!SCRATCH_PREFIXES.includes(prefix)) unregistered.push(`${at}（${prefix} 没登记）`)
      }
    }
  })

  assert.deepEqual(
    naked,
    [],
    '这些地方绕过 scratchDirs 直接在 $TMPDIR 下建目录（#200 就是因此堆了三万多）：换成 scratchDir / scratchDirSync',
  )
  assert.deepEqual(unregistered, [], '用到的前缀要登记进 SCRATCH_PREFIXES，残留判据才数得到它')
})

test('跑完自检：隔离 $TMPDIR 里跑一遍建 scratch 的单测文件，新增残留 = 0', () => {
  const scratchUsers = npmTestFiles().filter(
    (file) => file !== SELF && readFileSync(file, 'utf8').includes('scratchDirs.ts'),
  )
  assert.ok(scratchUsers.length >= 10, `该有不少文件用 scratchDirs，只找到 ${String(scratchUsers.length)} 个`)

  const root = scratchDirSync('dsh-scratch-guard-')
  // 子进程必须脱掉 `NODE_TEST_CONTEXT`：带着它跑 `node --test` 会被判成「测试文件里递归
  // 再起测试运行器」，Node 直接跳过、静默 exit 0（什么都不跑，残留数就成了假绿）。
  const env: Record<string, string | undefined> = { ...process.env, TMPDIR: root }
  for (const key of Object.keys(env)) if (key.startsWith('NODE_TEST_')) delete env[key]
  const started = Date.now()
  const r = spawnSync(process.execPath, ['--test', ...scratchUsers], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 900_000,
    env,
  })
  const elapsed = Date.now() - started
  const left = scratchEntriesIn(root)
  const others = readdirSync(root).filter((name) => !left.includes(name))
  const passed = Number(/^ℹ pass (\d+)$/m.exec(r.stdout)?.[1] ?? -1)
  // 先看那轮跑成没：没跑成时残留数没有意义（子进程可能在建目录之前就死了）。
  assert.equal(r.status, 0, `子进程那轮没跑成（同样的文件在 npm test 里也会红）：\n${r.stdout}\n${r.stderr}`)
  assert.ok(passed > 100, `子进程那轮只跑了 ${String(passed)} 个用例（${String(elapsed)}ms），像是没真跑起来`)
  assert.deepEqual(
    left,
    [],
    `跑完还有 scratch 目录没删（隔离 $TMPDIR=${root}）：${left.join(' ')}\n同期新建的其它条目：${others.join(' ')}`,
  )
})
