/**
 * 实验室会话面读数与机器现场读数的单测（#203）。
 *
 * 这两块都是**诊断读数**（不判任何断言），但它们会被写进 issue comment 与报告抬头当结论
 * 依据，所以在纯函数这一层钉住：时间线读数的形状、汇总里「归零 / 失败」这两条会不会被漏掉、
 * `ps` 输出的数法、以及「并发 / 独占」的判定口径。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readingLine, surfaceSummary, unavailableLines, type SurfaceReading } from './assembly-lab/sessionSurface.ts'
import { concurrencyLabel, countProcesses, describeMachineLoad, type MachineLoad } from './assembly-lab/machineLoad.ts'

const gateway = (seconds: number, where: string, sessions: number, ok = true): SurfaceReading => ({
  seconds,
  where,
  gateway: { ok, sessions, blank: 0, running: 0, detail: ok ? '' : 'session/list failed: gateway/service-unavailable active Service "sessionController" is unavailable' },
})

const page = (seconds: number, where: string, sessionRows: number, workspaceRows = 5): SurfaceReading => ({
  seconds,
  where,
  page: { workspaceRows, sessionRows, officialRows: 0, slotErrors: 0, unavailable: 0 },
})

test('readingLine：网关侧通 / 不通两种形状都带上读数与出处', () => {
  assert.match(readingLine(gateway(12.3, 'suite:F-12', 22)), /^12\.3s suite:F-12 网关 session\.list 通：会话 22 条/)
  assert.match(readingLine(gateway(40.5, 'suite:F-13', -1, false)), /^40\.5s suite:F-13 网关 session\.list \*\*失败\*\*：session\/list failed/)
  assert.match(readingLine(page(90, 'page:F-52/sidebar', 0)), /^90\.0s page:F-52\/sidebar 页面：会话行 0、分组行 5/)
})

test('unavailableLines：只挑「服务不可用」那一类控制台行', () => {
  const lines = [
    'error: session/control: active Service "sessionController" is unavailable',
    'warning: something else',
    'error: another: active Service "sessions" is unavailable',
  ]
  assert.equal(unavailableLines(lines).length, 2)
})

test('surfaceSummary：读出「哪一步之前行数一直是 22、哪一步之后归零」', () => {
  const readings = [gateway(0, 'suite:F-01', 22), page(10, 'page:F-01/sidebar', 22), page(20, 'page:F-02/sidebar', 22), gateway(30, 'suite:F-60', 22), page(40, 'page:F-60/sidebar', 0)]
  const summary = surfaceSummary(readings).join('\n')
  assert.match(summary, /首个读数 22 条（suite:F-01）/)
  assert.match(summary, /末个读数 22 条（suite:F-60）/)
  assert.match(summary, /「分组行在、会话行归零」的页面读数 1 次：page:F-60\/sidebar@40s/)
  assert.match(summary, /网关侧 session\.list 整轮零失败/)
})

test('surfaceSummary：本来就该是 0 的页面（没分组 / 别的树）不算归零', () => {
  // chat / settings / 官方对照档那几页没有自有的会话行；空态页连分组都是 0。
  const readings = [
    page(10, 'page:F-02/chat', 0, 0),
    page(20, 'page:F-02/settings', 0, 0),
    page(30, 'page:F-20/sidebar-official', 0, 0),
    page(40, 'page:F-55/sidebar', 0, 0),
    page(50, 'page:F-12/sidebar', 5, 5),
  ]
  const summary = surfaceSummary(readings).join('\n')
  assert.match(summary, /整轮没有出现过「分组行在、会话行归零」的页面读数/)
  assert.match(summary, /共 5 个读数点，其中 1 个是「有分组行」的树页面/)
})

test('surfaceSummary：网关侧失败会把失败点与网关原话一并列出来', () => {
  const summary = surfaceSummary([gateway(0, 'suite:F-01', 22), gateway(50, 'suite:F-30', -1, false)]).join('\n')
  assert.match(summary, /session\.list 失败过 1 次/)
  assert.match(summary, /suite:F-30@50s/)
  assert.match(summary, /service-unavailable/)
  // 一条页面读数都没有时也要说清楚，而不是给一份空汇总。
  assert.match(surfaceSummary([]).join('\n'), /没记到任何会话面读数/)
})

test('countProcesses：数出别的实验室轮次 / 别的网关 / 别的浏览器，并排掉自己那两个 pid', () => {
  const table = [
    '  111 node /repo/test/assembly-lab/verify.ts',
    '  222 node /repo/test/assembly-lab/verify.ts',
    '  333 node /usr/local/bin/dsh web --host 127.0.0.1 --port 3080 --no-open',
    '  444 node /usr/local/bin/dsh web --host 127.0.0.1 --port 50066 --no-open',
    '  555 /Users/x/Library/Caches/ms-playwright/chromium-1234/chrome --headless',
    '  666 /Applications/Visual Studio Code.app/Contents/MacOS/Electron',
  ].join('\n')
  assert.deepEqual(countProcesses(table, { selfPid: 111, gatewayPid: 444 }), {
    otherLabRounds: 1,
    otherGateways: 1,
    otherBrowsers: 1,
    otherGatewayPorts: [3080],
  })
  // 自己那条轮次与自己那台网关都不算；没有别人时三项全 0。
  assert.deepEqual(countProcesses(table, { selfPid: 222, gatewayPid: 333 }), {
    otherLabRounds: 1,
    otherGateways: 1,
    otherBrowsers: 1,
    otherGatewayPorts: [50066],
  })
})

test('countProcesses：启动轮次的 shell 不算一条轮次（命令行里同样含那段路径）', () => {
  const table = [
    '  111 node test/assembly-lab/verify.ts --diag-surface',
    "  112 /bin/bash -c cd /repo && ( node test/assembly-lab/verify.ts --out /tmp/x )",
    "  113 bash -c for i in 1 2 3; do ( node test/assembly-lab/verify.ts --out /tmp/c$i ) & done",
  ].join('\n')
  assert.equal(countProcesses(table, { selfPid: 999 }).otherLabRounds, 1)
})

test('concurrencyLabel：别的轮次或负载压上去才算「并发」，用户日常那台网关不算依据', () => {
  const base: MachineLoad = { otherLabRounds: 0, otherGateways: 1, otherBrowsers: 0, otherGatewayPorts: [3080], load1: 0.2, cpus: 8, freeMemRatio: 0.5, detail: '' }
  assert.match(concurrencyLabel(base), /^独占（/)
  assert.match(concurrencyLabel({ ...base, otherLabRounds: 2 }), /^并发（同时有 2 条别的实验室轮次）$/)
  assert.match(concurrencyLabel({ ...base, load1: 6 }), /^并发（负载 6\.00\/8 核）/)
  assert.match(concurrencyLabel({ ...base, detail: 'ps 读不到（spawnSync ps ENOENT）' }), /^读不到/)
})

test('describeMachineLoad：读数取不到时如实说取不到，不写成「没有并发」', () => {
  const unreadable: MachineLoad = { otherLabRounds: -1, otherGateways: -1, otherBrowsers: -1, otherGatewayPorts: [], load1: 0, cpus: 8, freeMemRatio: 0.5, detail: 'ps 读不到（ENOENT）' }
  assert.match(describeMachineLoad(unreadable), /机器现场：ps 读不到/)
  const readable: MachineLoad = { otherLabRounds: 1, otherGateways: 2, otherBrowsers: 3, otherGatewayPorts: [3080, 50066], load1: 3.5, cpus: 8, freeMemRatio: 0.4, detail: '' }
  assert.match(describeMachineLoad(readable), /别的实验室轮次 1 条、别的 dsh 网关 2 台（端口 3080\/50066）、别的 chromium 3 个进程；负载 3\.50\/8 核/)
})
