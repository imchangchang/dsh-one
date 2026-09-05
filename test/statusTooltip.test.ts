import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tooltipMarkdown, type TooltipStatus } from '../src/pure/statusTooltip.ts'

/** 恒等翻译：键即文案（本模块 keys 无占位符，identity 即等价于 l10n 兜底）。 */
const t = (message: string): string => message

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
  assert.ok(md.includes('Reusing an externally started instance; the extension will not stop it'))
  assert.ok(md.includes('[$(globe) Open in Browser](command:dshOne.openExternal)'))
  // 外部实例不提供 Restart/Stop 按钮（现有行为，回归确认）。
  assert.ok(!md.includes('Restart Service'))
  assert.ok(!md.includes('Stop Service'))
  assert.ok(md.includes('[$(output) Show Logs](command:dshOne.showLogs)'))
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
