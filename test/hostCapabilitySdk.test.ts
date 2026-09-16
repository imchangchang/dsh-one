/**
 * 前端 SDK（#84）的单测：**路由与线形态**——
 * - 有 VS Code 能力桥时落到桥的白名单调用（VS Code 侧实现）；
 * - 没有桥时落到官方网关 RPC（`ctx.connection.rpc.call('/api', 'dshOneHostCapabilities/x', { args })`），
 *   参数键与宿主半形参名一致、错误按形态归类（失败体 / HTTP 404 = 宿主半没装）。
 *
 * 这两条是「同一份插件两端可用」的全部机制，路由错了插件就会在某一端静默失灵，
 * 所以在这里钉死。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hostCapabilities, type CapabilityFailure } from '../src/ui/assembly/shell/hostCapabilities.ts'

interface Call {
  channel: string
  endpoint: string
  payload: unknown
}

/** 假宿主桥：直接装到统一获取点 `__DSH_ONE_HOST__`（页面侧 SDK 的正式出口）。 */
function installBridge(
  bridge: Array<{ name: string; args: unknown }>,
  replies: Record<string, unknown>,
): void {
  const global = globalThis as unknown as { __DSH_ONE_HOST__?: { call(name: string, args?: unknown): Promise<unknown> } }
  global.__DSH_ONE_HOST__ = {
    call: async (name: string, args?: unknown) => {
      bridge.push({ name, args })
      if (!(name in replies)) {
        const error = new Error(`host call ${name} rejected`) as Error & { code?: string }
        error.code = 'unsupported'
        throw error
      }
      return replies[name]
    },
  }
}

/** 假网关 RPC：记录调用，按 endpoint 回体。 */
function gatewayCtx(replies: Record<string, unknown>, calls: Call[]): { get(name: string): unknown } {
  return {
    get: (name: string) =>
      name === 'connection'
        ? {
            rpc: {
              call: async (channel: string, endpoint: string, payload: unknown) => {
                calls.push({ channel, endpoint, payload })
                const reply = replies[endpoint]
                if (reply === undefined) return { ok: false, error: { code: 'gateway/internal', message: 'not claimed' } }
                return { ok: true, value: reply }
              },
            },
          }
        : undefined,
  }
}

/** 清掉上一条用例装的假件。 */
function resetGlobals(): void {
  const global = globalThis as unknown as Record<string, unknown>
  delete global.__DSH_ONE_HOST__
}

test('没有桥时：能力走官方网关 RPC，端点与参数键都按契约来', async () => {
  resetGlobals()
  const calls: Call[] = []
  const ctx = gatewayCtx(
    {
      'dshOneHostCapabilities/stateWrite': { ok: true },
      'dshOneHostCapabilities/stateRead': { ok: true, value: { sessionIds: ['s1'] } },
      'dshOneHostCapabilities/stateDelete': { ok: true, deleted: true },
      'dshOneHostCapabilities/gitShow': { ok: true, sha: 'abc1234', found: true },
      'dshOneHostCapabilities/saveContent': { ok: true, path: '/Users/x/Downloads/a.zip' },
    },
    calls,
  )
  const caps = hostCapabilities(ctx)
  await caps.stateWrite('sidebar.recycle-bin', { sessionIds: ['s1'] })
  assert.deepEqual(await caps.stateRead('sidebar.recycle-bin'), { sessionIds: ['s1'] })
  assert.equal(await caps.stateDelete('sidebar.recycle-bin'), true)
  assert.deepEqual(await caps.gitShow({ hash: 'abc1234' }), { ok: true, sha: 'abc1234', found: true })
  assert.deepEqual(await caps.saveContent({ suggestedName: 'a.zip', base64: 'aGk=' }), { path: '/Users/x/Downloads/a.zip' })

  assert.deepEqual(
    calls.map((c) => [c.channel, c.endpoint]),
    [
      ['/api', 'dshOneHostCapabilities/stateWrite'],
      ['/api', 'dshOneHostCapabilities/stateRead'],
      ['/api', 'dshOneHostCapabilities/stateDelete'],
      ['/api', 'dshOneHostCapabilities/gitShow'],
      ['/api', 'dshOneHostCapabilities/saveContent'],
    ],
  )
  // 参数键 = 宿主半的形参名（官方网关 assertExactArguments 校核，多余键直接拒）。
  assert.deepEqual(calls[0].payload, { args: { key: 'sidebar.recycle-bin', value: { sessionIds: ['s1'] } } })
  assert.deepEqual(calls[3].payload, { args: { hash: 'abc1234', cwd: undefined } })
})

test('没有桥时：宿主半的失败体变成带 code 的异常（不静默吞）', async () => {
  resetGlobals()
  const ctx = gatewayCtx({ 'dshOneHostCapabilities/stateRead': { ok: false, error: { code: 'invalid-args', message: 'bad key' } } }, [])
  const caps = hostCapabilities(ctx)
  await assert.rejects(
    () => caps.stateRead('../evil'),
    (err: unknown) => (err as CapabilityFailure).code === 'invalid-args',
  )
})

test('没有桥时：HTTP 404（宿主半没装）归类 unavailable，消费方好降级', async () => {
  resetGlobals()
  const ctx = {
    get: (name: string) =>
      name === 'connection'
        ? { rpc: { call: async () => { throw new Error('transport failure for /api/x: HTTP 404') } } }
        : undefined,
  }
  const caps = hostCapabilities(ctx)
  await assert.rejects(
    () => caps.stateRead('pinned'),
    (err: unknown) => (err as CapabilityFailure).code === 'unavailable',
  )
})

test('没有桥时：连 Connection 服务都没有也报 unavailable', async () => {
  resetGlobals()
  const caps = hostCapabilities({ get: () => undefined })
  await assert.rejects(
    () => caps.stateRead('pinned'),
    (err: unknown) => (err as CapabilityFailure).code === 'unavailable',
  )
})

test('有 VS Code 桥时：git / 落盘 / 下载落到桥的白名单调用上', async () => {
  resetGlobals()
  const bridgeCalls: Array<{ name: string; args: unknown }> = []
  installBridge(bridgeCalls, {
    'git.show': { sha: 'abc1234', found: true },
    'file.save': { path: '/Users/x/a.zip' },
    'file.download': { path: '/Users/x/b.zip' },
  })
  const caps = hostCapabilities(undefined)
  assert.deepEqual(await caps.gitShow({ hash: 'abc1234', cwd: '/repo' }), { sha: 'abc1234', found: true })
  assert.deepEqual(await caps.saveContent({ suggestedName: 'a.zip', base64: 'aGk=' }), { path: '/Users/x/a.zip' })
  assert.deepEqual(await caps.downloadGatewayFile({ path: '/api/session.export?sessionId=s1', suggestedName: 'b.zip' }), {
    path: '/Users/x/b.zip',
  })
  assert.deepEqual(
    bridgeCalls.map((c) => c.name),
    ['git.show', 'file.save', 'file.download'],
  )
  assert.deepEqual(bridgeCalls[0].args, { hash: 'abc1234', cwd: '/repo' })
  assert.deepEqual(bridgeCalls[2].args, { path: '/api/session.export?sessionId=s1', suggestedName: 'b.zip' })
  resetGlobals()
})

/** 假页面窗口：官方 web 侧 `openExternal` 的出口（node 里没有 window，按需装上）。 */
function installWindow(): { opened: string[]; args: unknown[][] } {
  const opened: string[] = []
  const args: unknown[][] = []
  const global = globalThis as unknown as { window?: { open: (...callArgs: unknown[]) => unknown } }
  global.window = {
    open: (...callArgs: unknown[]) => {
      opened.push(String(callArgs[0]))
      args.push(callArgs)
      return null
    },
  }
  return { opened, args }
}

function resetWindow(): void {
  delete (globalThis as unknown as { window?: unknown }).window
}

test('#83 开外链（VS Code 侧）：有桥时落到 vscode.openExternal，页面不开窗', async () => {
  resetGlobals()
  const bridgeCalls: Array<{ name: string; args: unknown }> = []
  installBridge(bridgeCalls, { 'vscode.openExternal': null })
  const window = installWindow()
  const caps = hostCapabilities(undefined)
  await caps.openExternal('https://github.com/example/repo/commit/deadbee')
  assert.deepEqual(bridgeCalls, [{ name: 'vscode.openExternal', args: { url: 'https://github.com/example/repo/commit/deadbee' } }])
  assert.deepEqual(window.opened, [], '有宿主桥时不该再让页面开窗（webview 里开不动）')
  resetWindow()
  resetGlobals()
})

test('#83 开外链（官方 web 侧）：没有桥时用页面 window.open', async () => {
  resetGlobals()
  const window = installWindow()
  const caps = hostCapabilities(undefined)
  await caps.openExternal('mailto:someone@example.com')
  assert.deepEqual(window.opened, ['mailto:someone@example.com'])
  // 新标签 + noopener/noreferrer：把不可信 URL 掌住，别把 opener 交出去。
  assert.deepEqual(window.args[0]?.slice(1), ['_blank', 'noopener,noreferrer'])
  resetWindow()
})

test('#83 开外链：非 http/https/mailto 一律 invalid-args，两端都不动作', async () => {
  resetGlobals()
  const bridgeCalls: Array<{ name: string; args: unknown }> = []
  installBridge(bridgeCalls, { 'vscode.openExternal': null })
  const window = installWindow()
  const caps = hostCapabilities(undefined)
  for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'not a url', '']) {
    await assert.rejects(
      () => caps.openExternal(bad),
      (err: unknown) => (err as CapabilityFailure).code === 'invalid-args',
    )
  }
  assert.deepEqual(bridgeCalls, [], '校核在 SDK 这一处做完，桥不该收到非法 URL')
  assert.deepEqual(window.opened, [], '校核在 SDK 这一处做完，页面不该被开窗')
  resetWindow()
  resetGlobals()
})
