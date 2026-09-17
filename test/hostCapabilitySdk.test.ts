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
import { hostCapabilities, type CapabilityFailure } from '../packages/dsh-plugin-kit/src/hostCapabilities.ts'

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
    // #82：状态三件套（桥的实现 = 宿主半包里的同一份状态存储模块）。
    'state.read': { value: { version: 1, groups: [], membership: {}, activeGroupId: null } },
    'state.write': {},
    'state.delete': { deleted: true },
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

test('#82 有 VS Code 桥时：状态三件套也落桥（键与值原样过线，不落网关）', async () => {
  resetGlobals()
  const bridgeCalls: Array<{ name: string; args: unknown }> = []
  const groups = { version: 1, groups: [{ id: 'g-1', name: '工作' }], membership: {}, activeGroupId: null }
  installBridge(bridgeCalls, {
    'state.read': { value: groups },
    'state.write': {},
    'state.delete': { deleted: true },
  })
  // 给一个**能用的**网关 ctx：若状态被误路由到网关，下面的断言会看到端点调用而失败。
  const gatewayCallLog: Call[] = []
  const ctx = gatewayCtx({ 'dshOneHostCapabilities/stateRead': { ok: true, value: null } }, gatewayCallLog)
  const caps = hostCapabilities(ctx)
  assert.deepEqual(await caps.stateRead('groups'), groups)
  await caps.stateWrite('groups', groups)
  assert.equal(await caps.stateDelete('groups'), true)
  assert.deepEqual(
    bridgeCalls.map((c) => c.name),
    ['state.read', 'state.write', 'state.delete'],
  )
  assert.deepEqual(bridgeCalls[0].args, { key: 'groups' })
  assert.deepEqual(bridgeCalls[1].args, { key: 'groups', value: groups })
  assert.deepEqual(gatewayCallLog, [], '有桥时状态不落网关（同一份数据的写路径只有一条）')
  resetGlobals()
})

test('编辑器标签页（#72）：桥在时上报有能力，调用落到 bridge 的 session.openInNewTab', async () => {
  resetGlobals()
  const bridgeCalls: Array<{ name: string; args: unknown }> = []
  installBridge(bridgeCalls, { 'session.openInNewTab': null })
  const caps = hostCapabilities(undefined)
  assert.equal(caps.editorTabs, true)
  await caps.openSessionInNewTab('session-1')
  assert.deepEqual(bridgeCalls, [{ name: 'session.openInNewTab', args: { sessionId: 'session-1' } }])
  resetGlobals()
})

test('编辑器标签页（#72）：官方 web 侧如实上报缺席，调用被 unavailable 拒掉', async () => {
  resetGlobals()
  const calls: Call[] = []
  const caps = hostCapabilities(gatewayCtx({}, calls))
  assert.equal(caps.editorTabs, false, '没有宿主桥 = 没有编辑器标签页，菜单项据此不出现')
  await assert.rejects(
    () => caps.openSessionInNewTab('session-1'),
    (err: unknown) => (err as CapabilityFailure).code === 'unavailable',
  )
  assert.deepEqual(calls, [], '缺席的能力不该往网关上打任何请求')
  resetGlobals()
})

test('#121 宿主面板的会话：桥在时两条都落桥（查询回执照实读，动作发出会话 id）', async () => {
  resetGlobals()
  const bridgeCalls: Array<{ name: string; args: unknown }> = []
  installBridge(bridgeCalls, { 'session.inPanel': { open: true }, 'session.openPanel': null })
  const caps = hostCapabilities(undefined)
  assert.equal(await caps.isSessionInPanel('session-1'), true)
  assert.equal(await caps.isSessionInPanel('session-2'), true, '回执是宿主说了算（这里同一个假回执）')
  await caps.openSessionPanel('session-1')
  assert.deepEqual(bridgeCalls, [
    { name: 'session.inPanel', args: { sessionId: 'session-1' } },
    { name: 'session.inPanel', args: { sessionId: 'session-2' } },
    { name: 'session.openPanel', args: { sessionId: 'session-1' } },
  ])
  resetGlobals()
})

test('#121 宿主面板的会话：桥在、但这条调用被拒（老宿主/没实现）→ 查询回 false，不把异常漏给调用方', async () => {
  resetGlobals()
  const bridgeCalls: Array<{ name: string; args: unknown }> = []
  // replies 里不登记 `session.inPanel` = 假桥抛 unsupported（见 installBridge）。
  installBridge(bridgeCalls, {})
  const caps = hostCapabilities(undefined)
  assert.equal(await caps.isSessionInPanel('session-1'), false, '答不出来一律当「没开」= 按打开处理')
  resetGlobals()
})

test('#121 宿主面板的会话：官方 web 侧（无桥）查询回 false、动作静默——那一端没有宿主面板概念，也不打网关', async () => {
  resetGlobals()
  const calls: Call[] = []
  const caps = hostCapabilities(gatewayCtx({}, calls))
  assert.equal(await caps.isSessionInPanel('session-1'), false, '没有宿主面板 = 一律按打开处理')
  await caps.openSessionPanel('session-1')
  assert.deepEqual(calls, [], '这条能力没有宿主半端点，不该往网关上打任何请求')
  resetGlobals()
})

test('#99 设置齿轮：桥在时上报有独立设置页，调用落到 bridge 的 vscode.openSettings', async () => {
  resetGlobals()
  const bridgeCalls: Array<{ name: string; args: unknown }> = []
  installBridge(bridgeCalls, { 'vscode.openSettings': null })
  const caps = hostCapabilities(undefined)
  assert.equal(caps.settingsPage, true)
  await caps.openSettings()
  assert.deepEqual(bridgeCalls, [{ name: 'vscode.openSettings', args: {} }])
  resetGlobals()
})

test('#99 设置齿轮：官方 web 侧如实上报缺席，调用被 unavailable 拒掉', async () => {
  resetGlobals()
  const calls: Call[] = []
  const caps = hostCapabilities(gatewayCtx({}, calls))
  assert.equal(caps.settingsPage, false, '没有宿主桥 = 没有独立设置页，齿轮据此不渲染')
  await assert.rejects(
    () => caps.openSettings(),
    (err: unknown) => (err as CapabilityFailure).code === 'unavailable',
  )
  assert.deepEqual(calls, [], '缺席的能力不该往网关上打任何请求')
  resetGlobals()
})

test('#99 创建新工作区目录：桥在时上报有能力，调用落到 bridge 的 vscode.workspaceCreate', async () => {
  resetGlobals()
  const bridgeCalls: Array<{ name: string; args: unknown }> = []
  installBridge(bridgeCalls, { 'vscode.workspaceCreate': { workspaceId: 'ws-1', title: 'Ws One' } })
  const caps = hostCapabilities(undefined)
  assert.equal(caps.workspaceCreate, true)
  assert.deepEqual(await caps.createWorkspaceDirectory(), { workspaceId: 'ws-1', title: 'Ws One' })
  assert.deepEqual(bridgeCalls, [{ name: 'vscode.workspaceCreate', args: {} }])
  resetGlobals()
})

test('#176 创建新工作区目录：回执里的新工作区原样带给调用方；没建成（用户取消）给 workspaceId: null', async () => {
  resetGlobals()
  const bridgeCalls: Array<{ name: string; args: unknown }> = []
  installBridge(bridgeCalls, { 'vscode.workspaceCreate': { workspaceId: null } })
  const caps = hostCapabilities(undefined)
  assert.deepEqual(await caps.createWorkspaceDirectory(), { workspaceId: null }, '取消不是失败：调用方据此静默')
  resetGlobals()

  const second: Array<{ name: string; args: unknown }> = []
  installBridge(second, { 'vscode.workspaceCreate': { workspaceId: 'ws-2' } })
  assert.deepEqual(await hostCapabilities(undefined).createWorkspaceDirectory(), { workspaceId: 'ws-2' }, '宿主给不出名字时只带 id（界面从工作区快照里再找）')
  resetGlobals()
})

test('#99 创建新工作区目录：官方 web 侧如实上报缺席，调用被 unavailable 拒掉', async () => {
  resetGlobals()
  const calls: Call[] = []
  const caps = hostCapabilities(gatewayCtx({}, calls))
  assert.equal(caps.workspaceCreate, false, '没有宿主桥 = 建目录归官方目录流，那一项据此不出现')
  await assert.rejects(
    () => caps.createWorkspaceDirectory(),
    (err: unknown) => (err as CapabilityFailure).code === 'unavailable',
  )
  assert.deepEqual(calls, [], '缺席的能力不该往网关上打任何请求')
  resetGlobals()
})

// ---------------------------------------------------------------------------
// #176：添加/创建工作区之后的「在该工作区开新会话」
// ---------------------------------------------------------------------------

test('#176 开新会话：桥在时上报有能力，调用落到 bridge 的 session.newInWorkspace（参数就是那个工作区 id）', async () => {
  resetGlobals()
  const bridgeCalls: Array<{ name: string; args: unknown }> = []
  installBridge(bridgeCalls, { 'session.newInWorkspace': null })
  const caps = hostCapabilities(undefined)
  assert.equal(caps.sessionNewInWorkspace, true)
  await caps.newSessionInWorkspace('ws-1')
  assert.deepEqual(bridgeCalls, [{ name: 'session.newInWorkspace', args: { workspaceId: 'ws-1' } }])
  resetGlobals()
})

test('#176 开新会话：官方 web 侧如实上报缺席（页面据此只添加、不开会话），调用被 unavailable 拒掉且不打网关', async () => {
  resetGlobals()
  const calls: Call[] = []
  const caps = hostCapabilities(gatewayCtx({}, calls))
  assert.equal(
    caps.sessionNewInWorkspace,
    false,
    '没有宿主桥 = 添加完建不建会话归官方自己的 directory-flow，页面据此少做这一步',
  )
  await assert.rejects(
    () => caps.newSessionInWorkspace('ws-1'),
    (err: unknown) => (err as CapabilityFailure).code === 'unavailable',
  )
  assert.deepEqual(calls, [], '缺席的能力不该往网关上打任何请求（这条连宿主半端点都没有）')
  resetGlobals()
})

// ---------------------------------------------------------------------------
// #112：当前打开的文件夹表（侧栏树「当前工作区」判定的输入）
// ---------------------------------------------------------------------------

test('#112 当前打开的文件夹：桥在时落到 bridge 的 vscode.workspaceFolders，原样回表', async () => {
  resetGlobals()
  const bridgeCalls: Array<{ name: string; args: unknown }> = []
  installBridge(bridgeCalls, { 'vscode.workspaceFolders': { paths: ['/repo/one', '/repo/two'] } })
  const caps = hostCapabilities(undefined)
  assert.deepEqual(await caps.currentWorkspaceFolders(), ['/repo/one', '/repo/two'])
  assert.deepEqual(bridgeCalls, [{ name: 'vscode.workspaceFolders', args: {} }])
  resetGlobals()
})

test('#112 当前打开的文件夹：官方 web 侧没有这个概念 → 空表（不是抛错），也不打网关', async () => {
  resetGlobals()
  const calls: Call[] = []
  const caps = hostCapabilities(gatewayCtx({}, calls))
  assert.deepEqual(await caps.currentWorkspaceFolders(), [], '空表 = 没有当前工作区（不显示徽标、不置顶）')
  assert.deepEqual(calls, [], '这条能力没有宿主半端点，缺席端不该往网关上打请求')
  resetGlobals()
})

test('#112 当前打开的文件夹：回执形状不对（没桥/坏载荷）一律收成空表，不把 undefined 漏给调用方', async () => {
  resetGlobals()
  const bridgeCalls: Array<{ name: string; args: unknown }> = []
  installBridge(bridgeCalls, { 'vscode.workspaceFolders': { paths: [1, '', '/repo/ok'] } })
  assert.deepEqual(await hostCapabilities(undefined).currentWorkspaceFolders(), ['/repo/ok'])
  installBridge(bridgeCalls, { 'vscode.workspaceFolders': {} })
  assert.deepEqual(await hostCapabilities(undefined).currentWorkspaceFolders(), [])
  resetGlobals()
})

/**
 * #147：宿主面板里开着哪些会话——订阅形态（一条快照读 + 此后每次变化一条广播）。
 *
 * 这里是页面侧那一半的全部机制：桥给了 `session.panelSessions` 的回执就是快照，此后
 * 每条 `dshOne.panelSessions` 消息就是变化。三条要钉住的事都是**时序**：
 * ① 订阅后要有当前值（页面起来之前就开着的面板，只靠推送会漏）；
 * ② 快照读不回来（拒绝）时按空集（= 不抑制任何提醒，安全方向），不抛；
 * ③ 广播先到、快照后到时，**旧快照不许盖回新值**（这条错了会让绿点闪一下又回来）。
 */
function installMessageWindow(): { emit(data: unknown): void; listeners: number } {
  const handlers = new Set<(event: { data: unknown }) => void>()
  const global = globalThis as unknown as {
    window?: { addEventListener(type: string, listener: (event: unknown) => void): void; removeEventListener(type: string, listener: (event: unknown) => void): void }
  }
  global.window = {
    addEventListener: (type, listener) => {
      if (type === 'message') handlers.add(listener as (event: { data: unknown }) => void)
    },
    removeEventListener: (type, listener) => {
      if (type === 'message') handlers.delete(listener as (event: { data: unknown }) => void)
    },
  }
  return {
    emit: (data) => {
      for (const handler of [...handlers]) handler({ data })
    },
    get listeners() {
      return handlers.size
    },
  }
}

test('#147 订阅：先交付快照，再交付每条广播；退订之后不再交付', async () => {
  resetGlobals()
  const bridgeCalls: Array<{ name: string; args: unknown }> = []
  installBridge(bridgeCalls, { 'session.panelSessions': { sessionIds: ['s1'] } })
  const w = installMessageWindow()
  const seen: string[][] = []
  const dispose = hostCapabilities(undefined).onPanelSessions((ids) => seen.push([...ids]))
  assert.deepEqual(bridgeCalls, [{ name: 'session.panelSessions', args: {} }], '订阅时读一次快照（页面可能比面板晚起来）')
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual(seen, [['s1']], '快照先交付')
  w.emit({ type: 'dshOne.panelSessions', sessionIds: ['s1', 's2'] })
  assert.deepEqual(seen, [['s1'], ['s1', 's2']], '此后每条广播都交付')
  w.emit({ type: 'dshOne.setTheme', theme: 'dark' })
  assert.deepEqual(seen.length, 2, '别的宿主消息不理（只认自己那一条）')
  dispose()
  assert.equal(w.listeners, 0, '退订摘掉监听')
  w.emit({ type: 'dshOne.panelSessions', sessionIds: [] })
  assert.deepEqual(seen.length, 2, '退订之后不再交付')
  resetWindow()
  resetGlobals()
})

test('#147 订阅：快照读不回来时按空集（不抑制任何提醒），不抛', async () => {
  resetGlobals()
  const bridgeCalls: Array<{ name: string; args: unknown }> = []
  installBridge(bridgeCalls, {})
  installMessageWindow()
  const seen: string[][] = []
  const dispose = hostCapabilities(undefined).onPanelSessions((ids) => seen.push([...ids]))
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual(seen, [[]], '读失败 = 空集（照官方规则渲染），不是抛错')
  dispose()
  resetWindow()
  resetGlobals()
})

test('#147 订阅：广播先到、慢快照后到——旧快照不许盖回新值', async () => {
  resetGlobals()
  let release: ((value: unknown) => void) | undefined
  const global = globalThis as unknown as { __DSH_ONE_HOST__?: { call(name: string, args?: unknown): Promise<unknown> } }
  global.__DSH_ONE_HOST__ = {
    call: async (name: string) =>
      name === 'session.panelSessions'
        ? await new Promise((resolve) => {
            release = resolve
          })
        : null,
  }
  const w = installMessageWindow()
  const seen: string[][] = []
  const dispose = hostCapabilities(undefined).onPanelSessions((ids) => seen.push([...ids]))
  w.emit({ type: 'dshOne.panelSessions', sessionIds: ['s2'] })
  assert.deepEqual(seen, [['s2']])
  release?.({ sessionIds: ['s1'] })
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual(seen, [['s2']], '快照是更早的事实，不许盖回广播')
  dispose()
  resetWindow()
  resetGlobals()
})

test('#147 订阅：官方 web 侧的处境（没有 window 消息源）——不抛、退订是空操作', async () => {
  resetGlobals()
  const calls: Call[] = []
  const caps = hostCapabilities(gatewayCtx({}, calls))
  const dispose = caps.onPanelSessions(() => {
    throw new Error('不该被交付：那一端没有宿主面板这件事实')
  })
  assert.equal(typeof dispose, 'function')
  dispose()
  assert.deepEqual(calls, [], '这条能力没有宿主半端点，缺席端不该往网关上打请求')
  resetGlobals()
})
