/**
 * #82 落地证据（单测层）：**插件状态的家与迁移**。
 *
 * 三件事在这里钉死，浏览器验证只管界面：
 * 1. **旧数据不需要搬家**——旧版 vanilla 侧栏写在 `~/.dsh/dsh-one/groups.json` 的
 *    内容，经宿主能力口的读回路径（`runStateCall('state.read')`，VS Code 侧扩展宿主
 *    代行、官方 web 侧宿主半自己跑，同一份实现）读出来就是新树认的那份状态；
 * 2. **写回形状一字不变**——连续多轮读-改-写（建组 / 归属 / 重命名 / 删组）之后，
 *    磁盘上仍是 `{version:1, groups, membership, activeGroupId}`，旧版本仍读得回去；
 * 3. **幂等**——同一操作重复执行、或把同内容再写一遍，文件内容不漂移、不损坏；
 *    写入是原子替换（同目录 tmp + rename），中途失败不会留下半截文件。
 *
 * 用临时 HOME（不碰用户真实的 `~/.dsh`）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { scratchDir } from './scratchDirs.ts'
import {
  createTreeGroup,
  deleteTreeGroup,
  emptyTreeGroups,
  parseTreeGroups,
  renameTreeGroup,
  serializeTreeGroups,
  toggleWorkspaceGroup,
  workspaceGroupIds,
} from '../src/pure/treeGroups.ts'
import { runStateCall } from '../src/pure/hostStateCalls.ts'
import type { HostCapabilityError } from '../src/pure/hostCapabilities.ts'
import type { GroupFile } from '../src/pure/dshStateFile.ts'

/** 一个临时 dsh 家目录。 */
async function tmpHome(): Promise<string> {
  return await scratchDir('dsh-one-state-')
}

/** 读一个键；失败体（结构化错误）直接抛，测试里只关心成功路径。 */
async function read(home: string, key: string): Promise<unknown> {
  const result = await runStateCall('state.read', { key }, home)
  if ('code' in result) throw new Error(`read ${key} failed: ${result.code} ${result.message}`)
  return result.value
}

async function write(home: string, key: string, value: unknown): Promise<void> {
  const result = await runStateCall('state.write', { key, value }, home)
  if ('code' in result) throw new Error(`write ${key} failed: ${result.code} ${result.message}`)
}

/** 状态文件路径（宿主半包的约定：`<home>/dsh-one/<键>.json`）。 */
function stateFile(home: string, key: string): string {
  return path.join(home, 'dsh-one', `${key}.json`)
}

const LEGACY_GROUPS =
  '{"version":1,"groups":[{"id":"g-e9890a30","name":"其他"},{"id":"g-81025469","name":"dsn相关"}],' +
  '"membership":{"09bd708b":["g-81025469"],"ef81e339":["g-e9890a30"]},"activeGroupId":"g-e9890a30"}'

test('#82 迁移：旧侧栏的 groups.json 原地就是新树的状态（宿主能力口读回同一份）', async () => {
  const home = await tmpHome()
  await fs.mkdir(path.dirname(stateFile(home, 'groups')), { recursive: true })
  await fs.writeFile(stateFile(home, 'groups'), LEGACY_GROUPS, 'utf8')

  const raw = await read(home, 'groups')
  const file = parseTreeGroups(raw)
  assert.deepEqual(file?.groups, [
    { id: 'g-e9890a30', name: '其他' },
    { id: 'g-81025469', name: 'dsn相关' },
  ])
  assert.deepEqual(workspaceGroupIds(file as GroupFile, '09bd708b'), ['g-81025469'])
  // 旧字段原样保留（新版本不写它、也不抹它）。
  assert.equal(file?.activeGroupId, 'g-e9890a30')
})

test('#82 迁移幂等：多轮读-改-写之后仍是旧格式，重复写同内容不漂移', async () => {
  const home = await tmpHome()
  await fs.mkdir(path.dirname(stateFile(home, 'groups')), { recursive: true })
  await fs.writeFile(stateFile(home, 'groups'), LEGACY_GROUPS, 'utf8')

  const load = async (): Promise<GroupFile> => parseTreeGroups(await read(home, 'groups')) ?? emptyTreeGroups()
  const save = async (file: GroupFile | null): Promise<void> => {
    if (file !== null) await write(home, 'groups', JSON.parse(serializeTreeGroups(file)) as unknown)
  }

  // 第 1 轮：建组 + 归属
  const created = createTreeGroup(await load(), '新组', 'g-lab')
  assert.equal(created.ok, true)
  if (!created.ok) return
  await save(created.file)
  await save(toggleWorkspaceGroup(await load(), '09bd708b', 'g-lab'))

  // 第 2 轮：重命名 + 再归属一个工作区
  await save(renameTreeGroup(await load(), 'g-lab', '新组改名'))
  await save(toggleWorkspaceGroup(await load(), 'ef81e339', 'g-lab'))

  // 第 3 轮：删掉一个旧组（归属连带清理）
  await save(deleteTreeGroup(await load(), 'g-e9890a30'))

  const text = await fs.readFile(stateFile(home, 'groups'), 'utf8')
  const shape = JSON.parse(text) as Record<string, unknown>
  assert.deepEqual(Object.keys(shape).sort(), ['activeGroupId', 'groups', 'membership', 'version'])
  assert.equal(shape.version, 1)
  assert.deepEqual(shape.groups, [{ id: 'g-81025469', name: 'dsn相关' }, { id: 'g-lab', name: '新组改名' }])
  assert.deepEqual(shape.membership, { '09bd708b': ['g-81025469', 'g-lab'], ef81e339: ['g-lab'] })
  assert.equal(shape.activeGroupId, 'g-e9890a30', '旧字段一直没被动过')

  // 幂等：同内容再写一遍、以及重复执行同一操作，字节完全一致。
  const before = text
  await write(home, 'groups', JSON.parse(before) as unknown)
  assert.equal(await fs.readFile(stateFile(home, 'groups'), 'utf8'), before)
  await save(deleteTreeGroup(await load(), 'g-nope'))
  assert.equal(await fs.readFile(stateFile(home, 'groups'), 'utf8'), before, '删不存在的组 = 无变化，不重写')
})

test('#82 状态存储：写-读-删往返、坏文件按空值降级、原子写不留临时文件', async () => {
  const home = await tmpHome()
  await write(home, 'pinned', { version: 1, sessionIds: ['s1', 's2'] })
  assert.deepEqual(await read(home, 'pinned'), { version: 1, sessionIds: ['s1', 's2'] })
  assert.deepEqual(await read(home, 'never-written'), null)

  // 原子写：写完目录里只剩目标文件（tmp 已被 rename 掉）。
  assert.deepEqual((await fs.readdir(path.join(home, 'dsh-one'))).sort(), ['pinned.json'])

  // 坏 JSON 按缺失降级（不为一个坏文件让插件崩）。
  await fs.writeFile(stateFile(home, 'unread'), '{ not json', 'utf8')
  assert.equal(await read(home, 'unread'), null)

  const deleted = await runStateCall('state.delete', { key: 'pinned' }, home)
  assert.deepEqual(deleted, { deleted: true })
  assert.deepEqual(await runStateCall('state.delete', { key: 'pinned' }, home), { deleted: false })
})

test('#82 状态存储：键是唯一的路径穿越闸门，非法键/非法值一律拒且不落盘', async () => {
  const home = await tmpHome()
  const cases: Array<Record<string, unknown>> = [
    { key: '../../etc/passwd' },
    { key: 'a/b' },
    { key: 'A-B' },
    { key: '' },
    { key: 42 },
    {},
  ]
  for (const args of cases) {
    const result = (await runStateCall('state.write', { ...args, value: 1 }, home)) as HostCapabilityError
    assert.equal(result.code, 'invalid-args', JSON.stringify(args))
  }
  // 键合法但值过不了 JSON 往返（函数/undefined）：拒，且不产生文件。
  const badValue = await runStateCall('state.write', { key: 'groups', value: undefined }, home)
  assert.equal((badValue as HostCapabilityError).code, 'invalid-value')
  await assert.rejects(() => fs.readdir(path.join(home, 'dsh-one')), /ENOENT/)
})
