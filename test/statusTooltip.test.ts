import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tooltipMarkdown, type TooltipStatus } from '../src/pure/statusTooltip.ts'

/** 恒等翻译：键即文案（无占位符时等价于 l10n 兜底）；带 {N} 的做最小替换。 */
const t = (message: string, ...args: Array<string | number | boolean>): string =>
  message.replace(/\{(\d+)\}/g, (_, i: string) => String(args[Number(i)] ?? `{${i}}`))

test('running: version line after the title (dsh 0.1.2-rc.1)', () => {
  const status: TooltipStatus = { state: 'running', url: 'http://127.0.0.1:3080', version: '0.1.2-rc.1' }
  assert.equal(
    tooltipMarkdown(status, t),
    '**DSH One** — http://127.0.0.1:3080\n' +
      'dsh v0.1.2-rc.1\n\n' +
      '[$(globe) Open in Browser](command:dshOne.openExternal)　' +
      '[$(refresh) Restart Service](command:dshOne.restart)　' +
      '[$(debug-stop) Stop Service](command:dshOne.stop)　' +
      '[$(output) Show Logs](command:dshOne.showLogs)',
  )
})

test('running: 0.1.1 stable version renders the same line', () => {
  const md = tooltipMarkdown({ state: 'running', url: 'http://127.0.0.1:3080', version: '0.1.1' }, t)
  assert.ok(md.includes('dsh v0.1.1\n'))
})

test('running: adopted external instance shows no version line (would mislead)', () => {
  const md = tooltipMarkdown(
    { state: 'running', url: 'http://127.0.0.1:3080', adopted: true },
    t,
  )
  assert.ok(!md.includes('dsh v'))
  assert.ok(md.includes('Reusing a dsh started in another window; stopping or restarting it asks for confirmation and may affect that window'))
  assert.ok(md.includes('[$(globe) Open in Browser](command:dshOne.openExternal)'))
  // 外部实例不提供 Restart/Stop 按钮（现有行为，回归确认）。
  assert.ok(!md.includes('Restart Service'))
  assert.ok(!md.includes('Stop Service'))
  assert.ok(md.includes('[$(output) Show Logs](command:dshOne.showLogs)'))
})

test('running: externally-started authenticated instance (token pasted) offers managed stop/restart', () => {
  const md = tooltipMarkdown(
    { state: 'running', url: 'http://127.0.0.1:3080', port: 3080, external: true },
    t,
  )
  assert.ok(md.includes('Connected to an externally started dsh instance (launch token pasted); stopping or restarting it asks for confirmation'))
  // 外部实例可管理：停止/重启走 external 命令（确认弹窗在命令层），无版本行。
  assert.ok(md.includes('[$(refresh) Restart External Instance](command:dshOne.external.restart)'))
  assert.ok(md.includes('[$(debug-stop) Stop External Instance](command:dshOne.external.stop)'))
  assert.ok(!md.includes('Restart Service'))
  assert.ok(!md.includes('dsh v'))
})

test('error authDshNoToken: 防护说明 + 粘贴 token / 停止 / 重启入口（含端口定位）', () => {
  const md = tooltipMarkdown({ state: 'error', port: 3080, reason: 'authDshNoToken' }, t)
  assert.ok(md.includes('**DSH One** — Authenticated dsh instance is already running on port 3080'))
  assert.ok(md.includes('This dsh was started outside the extension and needs its launch token to connect. Paste the token printed in its terminal URL after ?token=, or stop the instance to start your own.'))
  assert.ok(md.includes('[$(key) Paste Launch Token](command:dshOne.external.pasteToken)'))
  assert.ok(md.includes('[$(copy) Copy URL Template](command:dshOne.external.copyTokenTemplate)'))
  assert.ok(md.includes('[$(debug-stop) Stop External Instance](command:dshOne.external.stop)'))
  assert.ok(md.includes('[$(refresh) Restart Service](command:dshOne.external.restart)'))
  // 不是「未安装 dsh」也不是普通错误态
  assert.ok(!md.includes('dsh is not installed'))
  assert.ok(!md.includes('[$(refresh) Retry Starting](command:dshOne.start)'))
})

test('running: unknown version (parse failure) renders no version line', () => {
  const md = tooltipMarkdown({ state: 'running', url: 'http://127.0.0.1:3080', version: 'unknown' }, t)
  assert.ok(!md.includes('dsh v'))
})

test('running: missing version field renders no version line', () => {
  const md = tooltipMarkdown({ state: 'running', url: 'http://127.0.0.1:3080' }, t)
  assert.ok(!md.includes('dsh v'))
})

test('starting: content unchanged, no version line', () => {
  const md = tooltipMarkdown({ state: 'starting' }, t)
  assert.ok(!md.includes('dsh v'))
  assert.ok(md.includes('**DSH One** — Service is starting…'))
  assert.ok(md.includes('The first start may take a while (preparing profiles and dependencies).'))
})

test('error dshNotFound: install link, no version line', () => {
  const md = tooltipMarkdown({ state: 'error', reason: 'dshNotFound' }, t)
  assert.ok(!md.includes('dsh v'))
  assert.ok(md.includes('**DSH One** — dsh is not installed'))
  assert.ok(md.includes('[$(cloud-download) Install dsh](command:dshOne.openSessions)'))
})

test('error generic: retry link, no version line', () => {
  const md = tooltipMarkdown({ state: 'error' }, t)
  assert.ok(!md.includes('dsh v'))
  assert.ok(md.includes('**DSH One** — Service Error'))
  assert.ok(md.includes('[$(refresh) Retry Starting](command:dshOne.start)'))
})

test('stopped: start link, no version line', () => {
  const md = tooltipMarkdown({ state: 'stopped' }, t)
  assert.ok(!md.includes('dsh v'))
  assert.ok(md.includes('**DSH One** — Service Stopped'))
  assert.ok(md.includes('[$(play) Start Service](command:dshOne.start)'))
})

test('running: adopted with recorded/probed version shows the version line', () => {
  const md = tooltipMarkdown(
    { state: 'running', url: 'http://127.0.0.1:3080', adopted: true, version: '0.1.2-rc.1' },
    t,
  )
  assert.ok(md.includes('dsh v0.1.2-rc.1\n'))
  // adopted 分支文案与管理入口不变（无 Restart/Stop Service）。
  assert.ok(md.includes('Reusing a dsh started in another window; stopping or restarting it asks for confirmation and may affect that window'))
  assert.ok(!md.includes('Restart Service'))
  assert.ok(!md.includes('Stop Service'))
})

test('running: external (token-pasted) instance with probed version shows it', () => {
  const md = tooltipMarkdown(
    { state: 'running', url: 'http://127.0.0.1:3080', external: true, version: '0.1.1' },
    t,
  )
  assert.ok(md.includes('dsh v0.1.1\n'))
  assert.ok(md.includes('Restart External Instance'))
  assert.ok(md.includes('Stop External Instance'))
})

test('running: adopted with unknown version still hides the line (probe failed)', () => {
  const md = tooltipMarkdown(
    { state: 'running', url: 'http://127.0.0.1:3080', adopted: true, version: 'unknown' },
    t,
  )
  assert.ok(!md.includes('dsh v'))
})
