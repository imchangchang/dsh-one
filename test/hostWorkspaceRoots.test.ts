/**
 * 网关注册工作区（追加允许根）的取数缓存单测（#65 批 1 返修）：TTL 命中、
 * 在途去重、失败降级（空表且不缓存失败）、过期后重取。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGatewayWorkspaceRoots } from '../src/ui/assembly/hostWorkspaceRoots.ts'
import { pickSessionWorkspacePath } from '../src/pure/sessionWorkspace.ts'
import { workspaceRootsOfSessionRows } from '../src/pure/workspaceRoots.ts'
import { routeSelection, drainAfterCreate } from '../src/pure/sessionPanelRouting.ts'
import { decideSelectionReport, restoreSessionIdOf } from '../src/pure/sidebarSelectionGate.ts'

/** 可控时钟 + 可控取数器。 */
function harness(paths: readonly string[] = ['/ws/a'], ttlMs = 1000) {
  let clock = 0
  let calls = 0
  let fail = false
  let resolveNext: (() => void) | undefined
  const roots = createGatewayWorkspaceRoots({
    ttlMs,
    now: () => clock,
    fetchPaths: () => {
      calls += 1
      if (fail) return Promise.reject(new Error('gateway down'))
      if (resolveNext !== undefined) {
        return new Promise<readonly string[]>((resolve) => {
          resolveNext = () => resolve(paths)
        })
      }
      return Promise.resolve(paths)
    },
  })
  return {
    roots,
    paths,
    advance: (ms: number) => {
      clock += ms
    },
    calls: () => calls,
    setFail: (value: boolean) => {
      fail = value
    },
    /** 让下一次取数挂起，直到 gate() 放行（用于在途去重断言）。 */
    hold: () => {
      resolveNext = () => {}
    },
    gate: () => {
      const release = resolveNext
      resolveNext = undefined
      release?.()
    },
  }
}

test('首次调用取一次，TTL 内复用缓存', async () => {
  const h = harness(['/ws/a', '/ws/b'])
  assert.deepEqual(await h.roots(), ['/ws/a', '/ws/b'])
  h.advance(999)
  assert.deepEqual(await h.roots(), ['/ws/a', '/ws/b'])
  assert.equal(h.calls(), 1)
})

test('TTL 过期后重新取数', async () => {
  const h = harness(['/ws/a'], 1000)
  await h.roots()
  h.advance(1001)
  await h.roots()
  assert.equal(h.calls(), 2)
})

test('并发调用共享一次在途请求（in-flight 去重）', async () => {
  const h = harness(['/ws/a'])
  h.hold()
  const first = h.roots()
  const second = h.roots()
  h.gate()
  assert.deepEqual(await first, ['/ws/a'])
  assert.deepEqual(await second, ['/ws/a'])
  assert.equal(h.calls(), 1)
})

test('取数失败返回空表且不缓存失败（下一次重试）', async () => {
  const h = harness(['/ws/a'])
  h.setFail(true)
  assert.deepEqual(await h.roots(), [])
  h.setFail(false)
  assert.deepEqual(await h.roots(), ['/ws/a'])
  assert.equal(h.calls(), 2)
})

test('pickSessionWorkspacePath：cwd 优先，其次工作区注册路径，都没有则 undefined', () => {
  assert.equal(pickSessionWorkspacePath({ sessionCwd: '/a', workspacePath: '/b' }), '/a')
  assert.equal(pickSessionWorkspacePath({ workspacePath: '/b' }), '/b')
  assert.equal(pickSessionWorkspacePath({ sessionCwd: '', workspacePath: '/b' }), '/b')
  assert.equal(pickSessionWorkspacePath({}), undefined)
})

test('workspaceRootsOfSessionRows：取会话 cwd 去重、剔空值、保序', () => {
  assert.deepEqual(
    workspaceRootsOfSessionRows([
      { cwd: '/ws/a' },
      { cwd: '/ws/b' },
      { cwd: '/ws/a' },
      {},
      { cwd: '' },
      { cwd: undefined },
    ]),
    ['/ws/a', '/ws/b'],
  )
  assert.deepEqual(workspaceRootsOfSessionRows([]), [])
})

test('routeSelection：无面板 → create；同 id → reveal（宿主去重）；不同 id → switch', () => {
  assert.equal(routeSelection({ hasPanel: false }, 's1'), 'create')
  assert.equal(routeSelection({ hasPanel: true, panelSessionId: 's1' }, 's1'), 'reveal')
  assert.equal(routeSelection({ hasPanel: true, panelSessionId: 's1' }, 's2'), 'switch')
  assert.equal(routeSelection({ hasPanel: true, panelSessionId: undefined }, 's1'), 'switch')
})

test('drainAfterCreate：等待期间同 id 不切（去重）、不同 id 要切、没等待不切', () => {
  assert.equal(drainAfterCreate('s1', undefined), undefined)
  assert.equal(drainAfterCreate('s1', 's1'), undefined)
  assert.equal(drainAfterCreate('s1', 's2'), 's2')
  assert.equal(drainAfterCreate(undefined, 's2'), 's2')
})

test('decideSelectionReport：启动期官方值不上报、用户点过后一律上报、同值去重', () => {
  // 启动期：官方恢复值（无交互）
  const boot = decideSelectionReport({ started: false }, 's1', { restoreId: 's1', userInteracted: false })
  assert.deepEqual(boot, { report: false, next: { started: true, lastReported: 's1' } })
  // 启动期：用户已经点过（值等于恢复键也放行——补「恢复值恰好等于用户点的那一行」的洞）
  const clicked = decideSelectionReport({ started: false }, 's1', { restoreId: 's1', userInteracted: true })
  assert.equal(clicked.report, true)
  // 之后：换会话要上报
  const next = decideSelectionReport({ started: true, lastReported: 's1' }, 's2', { userInteracted: true })
  assert.deepEqual(next, { report: true, next: { started: true, lastReported: 's2' } })
  // 同值（重复选择）不上报
  assert.equal(decideSelectionReport({ started: true, lastReported: 's2' }, 's2', { userInteracted: true }).report, false)
})

test('restoreSessionIdOf：解析官方恢复键（JSON），坏值/空值返回 undefined', () => {
  assert.equal(restoreSessionIdOf('{"sessionId":"session-abc"}'), 'session-abc')
  assert.equal(restoreSessionIdOf('{}'), undefined)
  assert.equal(restoreSessionIdOf('not json'), undefined)
  assert.equal(restoreSessionIdOf(null), undefined)
  assert.equal(restoreSessionIdOf('{"sessionId":123}'), undefined)
})
