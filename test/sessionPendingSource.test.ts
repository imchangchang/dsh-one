/**
 * 会话等待态取用路径（#184）的单测。
 *
 * 这条依赖是**静默失效型**的典型：官方换了钩子名之后，页面上只是「没有黄点」，与
 * 「今天没有等待中的会话」长得一模一样。所以这里把三件事钉死：
 *
 * 1. 两代命名各投影一次（新版 `sessionStatus` 的状态表要挑出等待态那一格、老版
 *    `sessionPendingInteraction` 原样交出去），形状与视图层要的一致；
 * 2. **两条都不在时返回 `null`**——那是「页面上给一行可见事实」那个分支的判据，
 *    不许退化成空表悄悄过去；
 * 3. 产品侧的名字表与上游探针的清单**同源**（探针从 `src/pure/sessionPendingSource.ts`
 *    import 名字）：产品改了取用名，探针自动查新名，两边不会漂。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { NO_PENDING, PENDING_SOURCES, pendingSourceOf, type PendingHookProps } from '../src/pure/sessionPendingSource.ts'
import { EN, ZH } from '../packages/dsh-workspace-tree/src/workspaceTree/locale.ts'

const ROOT = path.join(import.meta.dirname, '..')
const contract = (await import(path.join(ROOT, 'scripts', 'dsh-upstream-watch', 'clientContract.mjs'))) as {
  ROOT_HOOK_DEPENDENCIES: { names: string[]; props: string[]; where: string }[]
  IDENTIFIER_DEPENDENCIES: { names: string[]; where: string }[]
}

/** 一条钩子的最小实现：按 selector 取值（官方框架下发的就是这种快照选择钩子）。 */
const hookOf = (snapshot: unknown) => <R>(selector: (state: never) => R): R => selector(snapshot as never)

test('新版（0.1.6-alpha.2 起）`sessionStatus`：从会话状态表里挑出等待态那一格', () => {
  const snapshot = new Map<string, { pendingInteraction?: { kind?: string } }>([
    ['s-busy', { pendingInteraction: { kind: 'approval' } }],
    ['s-question', { pendingInteraction: { kind: 'question' } }],
    ['s-idle', {}],
    ['s-running', { pendingInteraction: undefined }],
  ])
  const props: PendingHookProps = { useSessionStatus: hookOf(snapshot) }
  const source = pendingSourceOf(props)
  assert.ok(source !== null, '新版那条钩子在场时必须挑得到')
  assert.equal(source.hook, 'sessionStatus')
  assert.equal(source.prop, 'useSessionStatus')
  const pending = source.project(source.read(props))
  assert.deepEqual([...pending.keys()], ['s-busy', 's-question'], '只有带等待态的会话在表里')
  assert.equal(pending.get('s-busy')?.kind, 'approval', '等待态的取值原样透传（视图层按 kind 判档）')
})

test('老版（0.1.6-alpha.1 及以前）`sessionPendingInteraction`：快照本身就是等待态表', () => {
  const snapshot = new Map([['s-busy', { kind: 'approval' }]])
  const props: PendingHookProps = { useSessionPendingInteraction: hookOf(snapshot) }
  const source = pendingSourceOf(props)
  assert.ok(source !== null)
  assert.equal(source.hook, 'sessionPendingInteraction')
  assert.equal(source.project(source.read(props)), snapshot, '老版原样交出去，不多一次遍历也不换引用')
})

test('两条钩子都在场时取新版（表里新代在前）', () => {
  const newer = new Map([['s-new', { pendingInteraction: { kind: 'plan-review' } }]])
  const older = new Map([['s-old', { kind: 'approval' }]])
  const source = pendingSourceOf({ useSessionStatus: hookOf(newer), useSessionPendingInteraction: hookOf(older) })
  assert.equal(source?.hook, 'sessionStatus')
  assert.deepEqual([...source!.project(source!.read({ useSessionStatus: hookOf(newer) })).keys()], ['s-new'])
})

test('两条钩子都不在时返回 null——页面据此给一行可见事实，而不是静默不点亮', () => {
  assert.equal(pendingSourceOf({}), null)
  // 官方给别的东西（比如会话列表钩子）不算数：只认这两条钩子上有函数。
  assert.equal(pendingSourceOf({ useSessions: hookOf(new Map()) } as PendingHookProps), null)
  assert.equal(NO_PENDING.size, 0, '空表常数恒为空（两条都不在时按它渲染）')
})

test('那行可见事实的文案两份词典都有（zh/en 同键集）', () => {
  assert.equal(typeof ZH['pending.unavailable'], 'string')
  assert.equal(typeof EN['pending.unavailable'], 'string')
  assert.ok(ZH['pending.unavailable'].includes('sessionStatus'), '文案要写出是哪个官方名字缺失，便于直接报给上游')
})

test('名字表与上游探针清单同源：探针查的就是产品侧这两个名字', () => {
  const hookDep = contract.ROOT_HOOK_DEPENDENCIES.find((dep) => dep.names.length > 1)
  assert.ok(hookDep !== undefined, '探针清单里要有那条两代命名的依赖')
  assert.deepEqual(hookDep.names, PENDING_SOURCES.map((source) => source.hook))
  assert.deepEqual(hookDep.props, PENDING_SOURCES.map((source) => source.prop))
  assert.ok(hookDep.where.includes('sessionPendingSource.ts'), `探针失败信息要指到产品侧取用点：${hookDep.where}`)

  const idDep = contract.IDENTIFIER_DEPENDENCIES.find((dep) => dep.names.includes('pendingInteractions'))
  assert.ok(idDep !== undefined, '探针清单里要有等待态取值名那条')
  assert.deepEqual(idDep.names, PENDING_SOURCES.map((source) => source.field))
})

test('探针查的那个取值名，就是投影函数真的读的那一格', () => {
  // 光有「名字表与探针同源」还不够：探针在官方 combo 里查的是表里的 `field`，
  // 而投影函数是自己写死的属性名——两边不一致时探针会绿着，取用却是空的。
  const text = fs.readFileSync(path.join(ROOT, 'src', 'pure', 'sessionPendingSource.ts'), 'utf8')
  const newest = PENDING_SOURCES[0]
  assert.ok(text.includes(`.${newest.field}`), `新版投影要读表里那个名字（${newest.field}）`)
  assert.ok(text.includes('sessionPendingInteraction'), '老版那条路径也要在（原样交出快照）')
})

test('#191：新版同一条状态表还带「跑完还没被打开」那一格（行上的 completed 已经没了）', () => {
  const snapshot = new Map<string, { completionUnread?: boolean }>([
    ['s-done', { completionUnread: true }],
    ['s-seen', { completionUnread: false }],
    ['s-running', {}],
  ])
  const source = pendingSourceOf({ useSessionStatus: hookOf(snapshot) })
  assert.ok(source?.completedIds !== undefined, '新版这条路径要给得出这份 id 集合')
  assert.deepEqual([...(source.completedIds(snapshot) as ReadonlySet<string>)], ['s-done'])
})

test('#191：老版那条路径不给这份集合（那一代的绿点在会话列表的行上，别动它）', () => {
  const source = pendingSourceOf({ useSessionPendingInteraction: hookOf(new Map()) })
  assert.equal(source?.completedIds, undefined)
})
