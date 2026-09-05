import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  acquireOwnedLock,
  clearOwnedRecord,
  migrateOwnedRecord,
  readOwnedRecord,
  resolveOwnership,
  writeOwnedRecord,
} from '../src/server/ownedRecord.ts'
import type { OwnedLock, OwnedRecord } from '../src/server/ownedRecord.ts'

const noopLogger = { info: () => {}, warn: () => {}, error: () => {} } as never

async function tmpDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'dsh-owned-test-'))
}

/** 一个确定已死的 pid：拉起一个即刻退出的子进程，用它的 pid。 */
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', ''])
  await new Promise((resolve) => child.once('exit', resolve))
  return child.pid ?? Number.MAX_SAFE_INTEGER
}

async function ownerFile(lockDir: string): Promise<{ pid: number }> {
  return JSON.parse(await readFile(path.join(lockDir, 'owner.json'), 'utf8')) as { pid: number }
}

async function pathGone(p: string): Promise<boolean> {
  return readFile(p).then(() => false).catch(() => true)
}

const record: OwnedRecord = { pid: 4242, port: 3080, token: 'tok123', version: '0.1.2-rc.1', owner: '/tmp/window-a' }

test('writeOwnedRecord + readOwnedRecord roundtrip keeps every field', async () => {
  const dir = await tmpDir()
  const file = path.join(dir, 'dsh-owned.json')
  assert.equal(await writeOwnedRecord(file, record, noopLogger), true)
  assert.deepEqual(await readOwnedRecord(file, noopLogger), record)
})

test('writeOwnedRecord overwrites atomically and leaves no tmp files', async () => {
  const dir = await tmpDir()
  const file = path.join(dir, 'dsh-owned.json')
  await writeOwnedRecord(file, record, noopLogger)
  await writeOwnedRecord(file, { ...record, pid: 9999 }, noopLogger)
  assert.equal(JSON.parse(await readFile(file, 'utf8')).pid, 9999)
  assert.deepEqual(await readdir(dir), ['dsh-owned.json'])
})

test('readOwnedRecord tolerates missing/invalid/incomplete files', async () => {
  const dir = await tmpDir()
  const file = path.join(dir, 'dsh-owned.json')
  assert.equal(await readOwnedRecord(file, noopLogger), null)
  await writeFile(file, 'not json')
  assert.equal(await readOwnedRecord(file, noopLogger), null)
  await writeFile(file, '{"pid":4242}')
  assert.equal(await readOwnedRecord(file, noopLogger), null)
})

test('clearOwnedRecord removes the file and tolerates absence', async () => {
  const dir = await tmpDir()
  const file = path.join(dir, 'dsh-owned.json')
  await writeOwnedRecord(file, record, noopLogger)
  await clearOwnedRecord(file)
  assert.equal(await readOwnedRecord(file, noopLogger), null)
  await clearOwnedRecord(file) // 不存在也要成功
  assert.deepEqual(await readdir(dir), [])
})

test('resolveOwnership: owner match → own, mismatch/missing → adopt, null → none', () => {
  assert.equal(resolveOwnership(null, '/tmp/window-a'), 'none')
  assert.equal(resolveOwnership(record, '/tmp/window-a'), 'own')
  assert.equal(resolveOwnership(record, '/tmp/window-b'), 'adopt')
  assert.equal(resolveOwnership({ pid: 1, port: 2 }, '/tmp/window-a'), 'adopt')
})

test('migrateOwnedRecord copies legacy to shared (owner filled) and deletes legacy', async () => {
  const dir = await tmpDir()
  const legacy = path.join(dir, 'legacy', 'dsh-owned.json')
  const shared = path.join(dir, 'shared', 'dsh-owned.json')
  await writeOwnedRecord(legacy, { pid: 4242, port: 3080, token: 'tok' }, noopLogger)
  await migrateOwnedRecord(legacy, shared, '/tmp/window-a', noopLogger)
  const migrated = await readOwnedRecord(shared, noopLogger)
  assert.equal(migrated?.owner, '/tmp/window-a')
  assert.equal(migrated?.token, 'tok')
  assert.equal(await pathGone(legacy), true)
})

test('migrateOwnedRecord does not overwrite an existing shared record', async () => {
  const dir = await tmpDir()
  const legacy = path.join(dir, 'legacy.json')
  const shared = path.join(dir, 'shared.json')
  await writeOwnedRecord(legacy, { pid: 1, port: 1 }, noopLogger)
  await writeOwnedRecord(shared, { pid: 2, port: 2, owner: '/tmp/existing' }, noopLogger)
  await migrateOwnedRecord(legacy, shared, '/tmp/window-a', noopLogger)
  assert.equal((await readOwnedRecord(shared, noopLogger))?.pid, 2)
  assert.equal(await pathGone(legacy), true)
})

test('migrateOwnedRecord is a no-op without a legacy record', async () => {
  const dir = await tmpDir()
  const legacy = path.join(dir, 'legacy.json')
  const shared = path.join(dir, 'shared.json')
  await migrateOwnedRecord(legacy, shared, '/tmp/window-a', noopLogger)
  assert.equal(await readOwnedRecord(shared, noopLogger), null)
})

test('lock: while held the lock dir exists; release removes it', async () => {
  const dir = await tmpDir()
  const file = path.join(dir, 'dsh-owned.json')
  const lock = await acquireOwnedLock(file, noopLogger, 2000)
  assert.equal((await ownerFile(`${file}.lock`)).pid, process.pid)
  await lock.release()
  assert.equal(await pathGone(path.join(`${file}.lock`, 'owner.json')), true)
})

test('lock: second acquirer waits and gets a real lock after release', async () => {
  const dir = await tmpDir()
  const file = path.join(dir, 'dsh-owned.json')
  const first = await acquireOwnedLock(file, noopLogger, 2000)
  let second: OwnedLock | null = null
  const pending = acquireOwnedLock(file, noopLogger, 5000).then((l) => {
    second = l
    return l
  })
  await new Promise((r) => setTimeout(r, 300))
  assert.equal(second, null) // 仍未拿到
  await first.release()
  await pending
  assert.notEqual(second, null)
  await second!.release()
  assert.equal(await pathGone(path.join(`${file}.lock`, 'owner.json')), true)
})

test('lock: recovers a stale lock whose holder pid is dead', async () => {
  const dir = await tmpDir()
  const file = path.join(dir, 'dsh-owned.json')
  const lockDir = `${file}.lock`
  const stale = await deadPid()
  await mkdir(lockDir)
  await writeFile(path.join(lockDir, 'owner.json'), JSON.stringify({ pid: stale, at: Date.now() }))
  const lock = await acquireOwnedLock(file, noopLogger, 2000)
  assert.equal((await ownerFile(lockDir)).pid, process.pid)
  await lock.release()
})

test('lock: degrades to a no-op after the timeout (does not block forever)', async () => {
  const dir = await tmpDir()
  const file = path.join(dir, 'dsh-owned.json')
  const holder = await acquireOwnedLock(file, noopLogger, 2000)
  const degraded = await acquireOwnedLock(file, noopLogger, 300)
  await degraded.release() // no-op：占锁方还在，锁目录仍在
  assert.equal((await ownerFile(`${file}.lock`)).pid, process.pid)
  await holder.release()
  await rm(dir, { recursive: true, force: true })
})
