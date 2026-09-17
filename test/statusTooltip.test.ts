import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tooltipMarkdown, type TooltipStatus } from '../src/pure/statusTooltip.ts'
import type { UpdateVerdict } from '../src/pure/dshUpdate.ts'

/** 恒等翻译：键即文案（无占位符时等价于 l10n 兜底）；带 {N} 的做最小替换。 */
const t = (message: string, ...args: Array<string | number | boolean>): string =>
  message.replace(/\{(\d+)\}/g, (_, i: string) => String(args[Number(i)] ?? `{${i}}`))

test('running: version line after the title (dsh 0.1.2-rc.1)', () => {
  const status: TooltipStatus = { state: 'running', url: 'http://127.0.0.1:3080', version: '0.1.2-rc.1' }
  assert.equal(
    tooltipMarkdown(status, t),
    '**DSH One** — http://127.0.0.1:3080\n\n' +
      'dsh v0.1.2-rc.1\n\n' +
      'LAN access is off (local only).\n\n' +
      '[$(globe) Open in Browser](command:dshOne.openExternal)\n\n' +
      '[$(cloud-download) Check for Updates](command:dshOne.checkUpdate)\n\n' +
      '[$(link) Copy local access link (with token)](command:dshOne.copyLink)\n\n' +
      '[$(broadcast) Restart for LAN access](command:dshOne.restartLan)\n\n' +
      '[$(refresh) Restart Service](command:dshOne.restart)\n\n' +
      '[$(debug-stop) Stop Service](command:dshOne.stop)\n\n' +
      '[$(output) Show Logs](command:dshOne.showLogs)',
  )
})

/** 气泡动作必须一行一个：每个段落里最多一个链接（#90 修的「拦腰折行」问题）。 */
test('动作布局：每段最多一个 command 链接（一行一个）', () => {
  const statuses: TooltipStatus[] = [
    { state: 'running', url: 'http://127.0.0.1:3080', version: '0.1.5-rc.1' },
    { state: 'running', url: 'http://127.0.0.1:3080', version: '0.1.5-rc.1', adopted: true },
    { state: 'running', url: 'http://127.0.0.1:3080', version: '0.1.5-rc.1', external: true },
    { state: 'running', url: 'http://127.0.0.1:3080', version: '0.1.5-rc.1' },
    { state: 'starting' },
    { state: 'stopped' },
    { state: 'error' },
    { state: 'error', reason: 'dshNotFound' },
    { state: 'error', reason: 'authDshNoToken', port: 3080 },
  ]
  for (const status of statuses) {
    const md = tooltipMarkdown(status, t, { state: 'update', installed: '0.1.5-rc.1', latest: '0.1.5-rc.2' })
    for (const paragraph of md.split('\n\n')) {
      const links = paragraph.match(/\]\(command:/g) ?? []
      assert.ok(links.length <= 1, `${status.state}/${status.reason ?? ''} 的段落里有 ${links.length} 个链接：${paragraph}`)
    }
  }
})

test('动作布局：动作行的数量与顺序 == statusActions 的清单', () => {
  const status: TooltipStatus = { state: 'running', url: 'http://127.0.0.1:3080', version: '0.1.5-rc.1' }
  const md = tooltipMarkdown(status, t)
  const commands = [...md.matchAll(/\]\(command:([^)]+)\)/g)].map((m) => m[1])
  assert.deepEqual(commands, [
    'dshOne.openExternal',
    'dshOne.checkUpdate',
    'dshOne.copyLink',
    'dshOne.restartLan',
    'dshOne.restart',
    'dshOne.stop',
    'dshOne.showLogs',
  ])
})

test('running: 有新版时多一行提示，动作行的「检查更新」换成「升级到 vX」', () => {
  const status: TooltipStatus = { state: 'running', url: 'http://127.0.0.1:3080', version: '0.1.5-rc.1' }
  const update: UpdateVerdict = { state: 'update', installed: '0.1.5-rc.1', latest: '0.1.5-rc.2' }
  const md = tooltipMarkdown(status, t, update)
  assert.ok(md.includes('dsh v0.1.5-rc.1\n\nA newer dsh is available: v0.1.5-rc.2\n\n'))
  assert.ok(md.includes('[$(arrow-up) Upgrade to v0.1.5-rc.2](command:dshOne.upgrade)'))
  assert.ok(!md.includes('Check for Updates'))
})

test('running: 已是最新时无一版本行，动作行仍是「检查更新」', () => {
  const status: TooltipStatus = { state: 'running', url: 'http://127.0.0.1:3080', version: '0.1.5-rc.1' }
  const md = tooltipMarkdown(status, t, { state: 'current', installed: '0.1.5-rc.1', latest: '0.1.5-rc.1' })
  assert.ok(!md.includes('A newer dsh is available'))
  assert.ok(md.includes('[$(cloud-download) Check for Updates](command:dshOne.checkUpdate)'))
  assert.ok(!md.includes('Upgrade to v'))
})

test('running: 装的比 latest 新（ahead）不提示升级、也不留检查失败痕迹', () => {
  const status: TooltipStatus = { state: 'running', url: 'http://127.0.0.1:3080', version: '0.1.6-alpha.1' }
  const md = tooltipMarkdown(status, t, { state: 'ahead', installed: '0.1.6-alpha.1', latest: '0.1.5-rc.1' })
  assert.ok(!md.includes('A newer dsh is available'))
  assert.ok(!md.includes('Upgrade to v'))
  assert.ok(md.includes('[$(cloud-download) Check for Updates](command:dshOne.checkUpdate)'))
})

test('running: 版本未知（检查失败/探测失败）时不显示任何更新行', () => {
  const status: TooltipStatus = { state: 'running', url: 'http://127.0.0.1:3080' }
  const md = tooltipMarkdown(status, t, { state: 'unknown', latest: '0.1.5-rc.1' })
  assert.ok(!md.includes('A newer dsh is available'))
  assert.ok(!md.includes('Upgrade to v'))
  assert.ok(!md.includes('dsh v'))
})

test('running: adopted（有探测到的版本）时同样能提示更新', () => {
  // adopted 实例的版本来自 shared 记录或命令行探测；有版本就能比，有新版照常提示。
  const md = tooltipMarkdown(
    { state: 'running', url: 'http://127.0.0.1:3080', adopted: true, version: '0.1.5-rc.1' },
    t,
    { state: 'update', installed: '0.1.5-rc.1', latest: '0.1.5-rc.2' },
  )
  assert.ok(md.includes('dsh v0.1.5-rc.1\n\nA newer dsh is available: v0.1.5-rc.2\n\n'))
  assert.ok(md.includes('[$(arrow-up) Upgrade to v0.1.5-rc.2](command:dshOne.upgrade)'))
  // 管理入口文案不变（adopted 不出现 Restart/Stop Service）。
  assert.ok(!md.includes('Restart Service'))
  assert.ok(!md.includes('Stop Service'))
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
  assert.ok(md.includes('This dsh was started in another window.'))
  assert.ok(md.includes('Stop / restart asks for confirmation.'))
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
  assert.ok(md.includes('External dsh instance (token connected).'))
  assert.ok(md.includes('Stop / restart asks for confirmation.'))
  // 外部实例可管理：停止/重启走 external 命令（确认弹窗在命令层），无版本行。
  assert.ok(md.includes('[$(refresh) Restart External Instance](command:dshOne.external.restart)'))
  assert.ok(md.includes('[$(debug-stop) Stop External Instance](command:dshOne.external.stop)'))
  assert.ok(!md.includes('Restart Service'))
  assert.ok(!md.includes('dsh v'))
})

test('error authDshNoToken: 防护说明 + 粘贴 token / 停止 / 重启入口（含端口定位）', () => {
  const md = tooltipMarkdown({ state: 'error', port: 3080, reason: 'authDshNoToken' }, t)
  assert.ok(md.includes('**DSH One** — Port 3080 is taken by another dsh'))
  assert.ok(md.includes('Another authenticated dsh is running there.'))
  assert.ok(md.includes('It was started outside the extension.'))
  assert.ok(md.includes('Paste the ?token= from its terminal URL,'))
  assert.ok(md.includes('or stop it to start your own.'))
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
  assert.ok(md.includes('The first start may take a while.'))
  assert.ok(md.includes('It prepares profiles and dependencies.'))
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
  assert.ok(md.includes('This dsh was started in another window.'))
  assert.ok(md.includes('Stop / restart asks for confirmation.'))
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

/**
 * 气泡宽度由最长一行决定（#136）：把链接语法剥成可见文字后，任何一段都不得超过
 * 48 个字符——超了就会又把气泡撑到 VS Code 的宽度上限。
 *
 * 口径说明：这是**近似代理**而不是硬契约——图标按 `$(name)` 的字面长度计、粗体
 * 标记不计宽、中文字符按 1 个字符算（实际比英文宽），也不覆盖点击弹出的 QuickPick
 * 面板（那个宽度由 VS Code 自己算）。它的用途是拦住「又写回长句把气泡撑宽」。
 */
test('气泡宽度：每段可见文字 ≤ 48 字符（防长句撑宽）', () => {
  const MAX_VISIBLE = 48
  const statuses: TooltipStatus[] = [
    { state: 'running', url: 'http://127.0.0.1:3080', version: '0.1.5-rc.1' },
    { state: 'running', url: 'http://127.0.0.1:3080', version: '0.1.5-rc.1', adopted: true },
    { state: 'running', url: 'http://127.0.0.1:3080', version: '0.1.5-rc.1', external: true },
    { state: 'running', url: 'http://127.0.0.1:3080', version: 'unknown', adopted: true },
    { state: 'starting' },
    { state: 'stopped' },
    { state: 'error' },
    { state: 'error', reason: 'dshNotFound' },
    { state: 'error', reason: 'authDshNoToken', port: 3080 },
  ]
  const updates: Array<UpdateVerdict | undefined> = [
    undefined,
    { state: 'update', installed: '0.1.5-rc.1', latest: '0.1.5-rc.2' },
    { state: 'ahead', installed: '0.1.6-alpha.1', latest: '0.1.5-rc.1' },
  ]
  for (const status of statuses) {
    for (const update of updates) {
      for (const paragraph of tooltipMarkdown(status, t, update).split('\n\n')) {
        // 链接按可见部分计宽：[$ (icon) 标签](command:…) → 图标 + 标签；粗体标记不占宽。
        const visible = paragraph
          .replace(/\[\$\(([a-z-]+)\) ([^\]]+)\]\(command:[^)]+\)/g, '$($1) $2')
          .replace(/\*\*/g, '')
        assert.ok(
          visible.length <= MAX_VISIBLE,
          `${status.state}/${status.reason ?? ''} 有 ${visible.length} 字符的段落：${visible}`,
        )
      }
    }
  }
})

test('气泡：局域网开着时显示地址行，动作给复制局域网链接', () => {
  const md = tooltipMarkdown(
    {
      state: 'running',
      url: 'http://127.0.0.1:3080',
      version: '0.1.5-rc.1',
      lanIp: '192.168.1.23',
    },
    t,
  )
  assert.ok(md.includes('LAN access is on: 192.168.1.23'))
  assert.ok(!md.includes('LAN access is off'))
  assert.ok(md.includes('[$(broadcast) Copy LAN access link (with token)](command:dshOne.copyLanLink)'))
  assert.ok(!md.includes('Restart for LAN access'))
})
