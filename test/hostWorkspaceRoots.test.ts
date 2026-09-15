/**
 * 网关注册工作区（追加允许根）的取数缓存单测（#65 批 1 返修）：TTL 命中、
 * 在途去重、失败降级（空表且不缓存失败）、过期后重取。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGatewayWorkspaceRoots } from '../src/ui/assembly/hostWorkspaceRoots.ts'
import { pickSessionWorkspacePath } from '../src/pure/sessionWorkspace.ts'
import { workspaceRootsOfSessionRows } from '../src/pure/workspaceRoots.ts'

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
