import { test } from 'node:test'
import assert from 'node:assert/strict'
import { statusActions, statusSummary } from '../src/pure/statusActions.ts'
import type { TooltipStatus } from '../src/pure/statusTooltip.ts'
import type { UpdateVerdict } from '../src/pure/dshUpdate.ts'

/** 恒等翻译：键即文案；带 {N} 的做最小替换（同 statusTooltip 测试的约定）。 */
const t = (message: string, ...args: Array<string | number | boolean>): string =>
  message.replace(/\{(\d+)\}/g, (_, i: string) => String(args[Number(i)] ?? `{${i}}`))

const run = (extra: Partial<TooltipStatus> = {}, update?: UpdateVerdict) =>
  statusActions({ state: 'running', url: 'http://127.0.0.1:3080', version: '0.1.5-rc.1', ...extra }, t, update)

test('running（自管实例）：打开浏览器 → 检查更新 → 重启 → 停止 → 显示日志', () => {
  const actions = run()
  assert.deepEqual(
    actions.map((a) => [a.id, a.command]),
    [
      ['openExternal', 'dshOne.openExternal'],
      ['checkUpdate', 'dshOne.checkUpdate'],
      ['copyLink', 'dshOne.copyLink'],
      ['restartLan', 'dshOne.restartLan'],
      ['restart', 'dshOne.restart'],
      ['stop', 'dshOne.stop'],
      ['showLogs', 'dshOne.showLogs'],
    ],
  )
  // 每个动作都有自己的 codicon，面板行与气泡链接都用它。
  for (const a of actions) assert.ok(a.icon.length > 0, `${a.id} 缺 icon`)
})

test('running：有新版本时「检查更新」换成「升级到 vX」', () => {
  const actions = run({}, { state: 'update', installed: '0.1.5-rc.1', latest: '0.1.5-rc.2' })
  assert.deepEqual(actions.map((a) => a.id), [
    'openExternal',
    'upgrade',
    'copyLink',
    'restartLan',
    'restart',
    'stop',
    'showLogs',
  ])
  assert.equal(actions[1].label, 'Upgrade to v0.1.5-rc.2')
  assert.equal(actions[1].command, 'dshOne.upgrade')
})

test('running：局域网开着时给「复制局域网链接」与「重启回仅本机」', () => {
  const status: TooltipStatus = {
    state: 'running',
    url: 'http://127.0.0.1:3080',
    version: '0.1.5-rc.1',
    lanIp: '192.168.1.23',
  }
  const actions = statusActions(status, t)
  assert.deepEqual(actions.map((a) => a.id), [
    'openExternal',
    'checkUpdate',
    'copyLink',
    'copyLanLink',
    'restart',
    'stop',
    'restartLocal',
    'showLogs',
  ])
  assert.equal(actions.find((a) => a.id === 'copyLanLink')?.command, 'dshOne.copyLanLink')
  assert.equal(actions.find((a) => a.id === 'restartLocal')?.command, 'dshOne.restartLocal')
  assert.ok(!actions.some((a) => a.id === 'restartLan'), '已开局域网就不该再有「重启为局域网」')
})

test('running：current / ahead / unknown 都保留「检查更新」（不冒充升级入口）', () => {
  for (const verdict of [
    { state: 'current', installed: '0.1.5-rc.1', latest: '0.1.5-rc.1' } as UpdateVerdict,
    { state: 'ahead', installed: '0.1.6-alpha.1', latest: '0.1.5-rc.1' } as UpdateVerdict,
    { state: 'unknown', installed: '0.1.5-rc.1' } as UpdateVerdict,
    undefined,
  ]) {
    const ids = run({}, verdict).map((a) => a.id)
    assert.ok(ids.includes('checkUpdate'), `verdict=${verdict?.state} 应有检查更新`)
    assert.ok(!ids.includes('upgrade'), `verdict=${verdict?.state} 不该有升级入口`)
  }
})

test('running：复用（adopted）/外部实例的管理动作走 external.*', () => {
  for (const flag of [{ adopted: true }, { external: true }]) {
    const actions = run(flag)
    assert.deepEqual(
      actions.map((a) => a.id),
      ['openExternal', 'checkUpdate', 'copyLink', 'external.restart', 'external.stop', 'showLogs'],
    )
    assert.ok(!actions.some((a) => a.command === 'dshOne.restart'))
    assert.ok(!actions.some((a) => a.command === 'dshOne.stop'))
    // 局域网能力只对自管实例可判定：复用/外部不给局域网动作（显示上也不猜）。
    assert.ok(!actions.some((a) => a.id === 'restartLan' || a.id === 'copyLanLink'))
  }
})

test('starting：打开浏览器 + 显示日志（原状态栏点击可做的事不丢）', () => {
  assert.deepEqual(statusActions({ state: 'starting' }, t).map((a) => a.id), [
    'openExternal',
    'showLogs',
  ])
})

test('error dshNotFound：安装 dsh + 显示日志', () => {
  assert.deepEqual(
    statusActions({ state: 'error', reason: 'dshNotFound' }, t).map((a) => [a.id, a.command]),
    [
      ['install', 'dshOne.openSessions'],
      ['showLogs', 'dshOne.showLogs'],
    ],
  )
})

test('error authDshNoToken：粘贴 token / 复制模板 / 停止 / 重启 / 日志', () => {
  assert.deepEqual(
    statusActions({ state: 'error', reason: 'authDshNoToken', port: 3080 }, t).map((a) => [a.id, a.command]),
    [
      ['external.pasteToken', 'dshOne.external.pasteToken'],
      ['external.copyTokenTemplate', 'dshOne.external.copyTokenTemplate'],
      ['external.stop', 'dshOne.external.stop'],
      ['external.restart', 'dshOne.external.restart'],
      ['showLogs', 'dshOne.showLogs'],
    ],
  )
})

test('error 其他原因 / stopped：启动类动作 + 显示日志', () => {
  assert.deepEqual(
    statusActions({ state: 'error' }, t).map((a) => [a.id, a.label]),
    [
      ['start', 'Retry Starting'],
      ['showLogs', 'Show Logs'],
    ],
  )
  assert.deepEqual(
    statusActions({ state: 'stopped' }, t).map((a) => [a.id, a.label]),
    [
      ['start', 'Start Service'],
      ['showLogs', 'Show Logs'],
    ],
  )
})

test('动作清单与悬停气泡同源：每个动作都能渲染成一条 command 链接', () => {
  // 气泡侧是 `actions.map(...)` 拼链接（statusTooltip.actionRows），这里断言清单里的
  // command 都是合法命令名（dshOne.*），不会出现空命令行。
  for (const status of [
    { state: 'running', url: 'http://127.0.0.1:3080' },
    { state: 'starting' },
    { state: 'stopped' },
    { state: 'error', reason: 'dshNotFound' },
    { state: 'error' },
  ] as TooltipStatus[]) {
    for (const action of statusActions(status, t)) {
      assert.match(action.command, /^dshOne\./, `${status.state} 的动作 ${action.id} 命令不合法`)
      assert.ok(action.label.trim() !== '', `${status.state} 的动作 ${action.id} 缺文案`)
    }
  }
})

test('statusSummary：状态 + 地址 + 版本，复用/外部实例有标注，有新版本补一句', () => {
  assert.equal(
    statusSummary({ state: 'running', url: 'http://127.0.0.1:3080', version: '0.1.5-rc.1' }, t),
    'Running — http://127.0.0.1:3080 · dsh v0.1.5-rc.1 · LAN access is off',
  )
  assert.equal(
    statusSummary(
      { state: 'running', url: 'http://127.0.0.1:3080', version: '0.1.5-rc.1', lanIp: '192.168.1.23' },
      t,
    ),
    'Running — http://127.0.0.1:3080 · dsh v0.1.5-rc.1 · LAN access is on: 192.168.1.23',
  )
  assert.equal(
    statusSummary(
      { state: 'running', url: 'http://127.0.0.1:3080', version: '0.1.5-rc.1', adopted: true },
      t,
    ),
    'Running — http://127.0.0.1:3080 · dsh v0.1.5-rc.1 · Reused from another window',
  )
  assert.equal(
    statusSummary(
      { state: 'running', url: 'http://127.0.0.1:3080', version: '0.1.5-rc.1', external: true },
      t,
      { state: 'update', installed: '0.1.5-rc.1', latest: '0.1.5-rc.2' },
    ),
    'Running — http://127.0.0.1:3080 · dsh v0.1.5-rc.1 · External instance · A newer dsh is available: v0.1.5-rc.2',
  )
  // 版本解析失败（unknown）不把「dsh vunknown」写进摘要。
  assert.equal(
    statusSummary({ state: 'running', url: 'http://127.0.0.1:3080', version: 'unknown' }, t),
    'Running — http://127.0.0.1:3080 · LAN access is off',
  )
  assert.equal(statusSummary({ state: 'stopped' }, t), 'Service Stopped')
  assert.equal(statusSummary({ state: 'starting' }, t), 'Service is starting…')
  assert.equal(statusSummary({ state: 'error', reason: 'dshNotFound' }, t), 'dsh is not installed')
  assert.equal(statusSummary({ state: 'error' }, t), 'Service Error')
  assert.equal(
    statusSummary({ state: 'error', reason: 'authDshNoToken', port: 3080 }, t),
    'Port 3080 is taken by another dsh',
  )
})

test('动作面板转发的命令都在 package.json 里声明过', async () => {
  // 面板点击后执行的是 action.command；命令名拼错会静默失败（VS Code 只在日志里报），
  // 所以在这里把「动作表用到的命令」与清单声明对齐。
  const { readFileSync } = await import('node:fs')
  const path = await import('node:path')
  const pkg = JSON.parse(
    readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf8'),
  ) as { contributes: { commands: Array<{ command: string }> } }
  const declared = new Set(pkg.contributes.commands.map((c) => c.command))
  const used = new Set<string>()
  for (const status of [
    { state: 'running', url: 'http://127.0.0.1:3080' },
    { state: 'running', url: 'http://127.0.0.1:3080', version: '0.1.5-rc.1' },
    { state: 'starting' },
    { state: 'stopped' },
    { state: 'error' },
    { state: 'error', reason: 'dshNotFound' },
    { state: 'error', reason: 'authDshNoToken', port: 3080 },
  ] as TooltipStatus[]) {
    for (const update of [
      { state: 'update', installed: '0.1.5-rc.1', latest: '0.1.5-rc.2' } as UpdateVerdict,
      undefined,
    ]) {
      for (const action of statusActions(status, t, update)) used.add(action.command)
    }
  }
  // 例外：openSessions 是「安装引导落点」（聚焦侧栏，那里是空态安装脚本），只在扩展内部
  // 被动作表调用，有意不进命令面板（面板里对应的是 openInstallPage）。豁免必须仍被注册，
  // 否则豁免会掩盖「命令被删掉」。
  const programmaticOnly = new Set(['dshOne.openSessions'])
  const extensionSource = readFileSync(
    path.join(import.meta.dirname, '..', 'src', 'extension.ts'),
    'utf8',
  )
  for (const command of programmaticOnly) {
    assert.ok(
      extensionSource.includes(`registerCommand('${command}'`),
      `豁免的命令 ${command} 在 src/extension.ts 里没有注册`,
    )
  }
  for (const command of used) {
    if (programmaticOnly.has(command)) continue
    assert.ok(declared.has(command), `动作表用了未在 package.json 声明的命令：${command}`)
  }
  // 状态栏项的点击命令自身也要在清单里（面板入口）。
  assert.ok(declared.has('dshOne.statusPanel'))
})
