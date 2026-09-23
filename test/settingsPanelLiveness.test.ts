/**
 * #233 的宿主侧判据：**真跑宿主代码，只看用户看得见的结果**。
 *
 * 为什么要这一组（而不是只靠浏览器验证或静态扫描）：设置页的打开通路——侧栏齿轮 →
 * 宿主能力口 `vscode.openSettings` → 「已开则聚焦」这一步判活 → 命令全量新建
 * （`extension.ts` 的 `openAssembledSettings`）——以及共享 loopback mirror 的引用计数、
 * 「点了没反应」时落的那几行日志，**全都在扩展宿主侧**（`src/ui/assemblyView.ts` 的设置
 * 部分），浏览器验证（`test/assembly-lab/`）看不到，真窗验收只能人做。这里沿用
 * `test/chatPanelLiveness/` 那套 harness（假 `vscode` 模块 + 假网关 + 真宿主代码，做法与
 * `test/install-guide/`、`test/legacy-sidebar/` 同源），于是这些判据随 `npm test` 常驻。
 *
 * 覆盖的现场（用户 2.0.2 报告的形状，见 #233）：
 * - **面板被关掉之后再点齿轮**：必须建出新面板（不是默默失败）；
 * - **引用还在、webview 已经没了**（宿主收摊：webview 死了、dispose 事件没送到扩展这边）：
 *   点齿轮必须自愈（清坏引用 → 建出新面板）并落一条带现场的 warn，「已开则聚焦」那一步
 *   绝不能把异常抛给调用方（齿轮那条路不接异常）；
 * - **连点两次只建一个面板**（不增生）；
 * - **日志留痕**：一次打开一行（含选中的面板形态、走的分支、结果），创建 / 销毁各一条，
 *   销毁那条带存活时长与原因（我们自己替换 vs 用户关掉 vs 宿主收摊）；
 * - **共享 mirror 引用配平**：坏引用那一跳也要把死面板占的引用还掉，否则这个 loopback
 *   端口会一直开着；
 * - **命令那条路失败不静默**：建面板失败、清单拉不到都给用户一行可见反馈。
 *
 * 负向对照（拿掉守卫 → 对应判据必须红）的读数在 #233 的开发报告里逐条给出：这一组判据
 * 本身就是那些实验量出来的，摘掉守卫会在这里当场失败。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { loadSource, resolveSpecifier } from './chatPanelLiveness/vscodeHooks.ts'
import { portAnswers, startHarness } from './chatPanelLiveness/harness.ts'

// 装上模块钩子（`vscode` → 假模块；`.ts` 过 esbuild 的等价物）。必须在任何会 import
// src/** 的模块被求值之前执行，所以宿主模块一律在 startHarness() 里动态 import。
registerHooks({ resolve: resolveSpecifier, load: loadSource } as never)

/** 装配页真的写进 webview 了没有（页面上必须带官方 boot 注入）。 */
const ASSEMBLED = (panel: { webview: { html: string } }): boolean => panel.webview.html.includes('__DSH_BOOT__')

/** 把日志行里的存活时长换成定值（`age=37ms` 每次都不一样）。 */
const ageLess = (line: string): string => line.replace(/age=\d+ms/, 'age=<n>ms')

test('① 设置面板被关掉之后再点齿轮 → 建出新面板', async () => {
  const h = await startHarness()
  try {
    h.gearClick()
    await h.waitFor('第一个设置面板建出来', () => h.panels.length === 1)
    const first = h.panels[0]!
    await h.waitFor('第一个面板装上装配页', () => ASSEMBLED(first))

    // 用户点关闭（宿主会同步发 onDidDispose）。
    first.dispose()

    h.gearClick()
    await h.waitFor('关掉之后再点齿轮建出新面板', () => h.panels.length === 2)
    const second = h.panels[1]!
    await h.waitFor('新面板装上装配页', () => ASSEMBLED(second))

    assert.deepEqual(
      h.lines(/^settings open: panel=/).map((line) => line.replace(/^settings open: /, '')),
      ['panel=none branch=create result=ok', 'panel=none branch=create result=ok'],
      '两次打开各留一行：没有可用面板 → 走新建 → ok',
    )
    assert.equal(h.messages.length, 0, '这一路不该弹任何提示（用户看到的就是面板出来了）')
  } finally {
    await h.close()
  }
})

test('② 引用还在、webview 已经没了（宿主收摊形状）→ 清坏引用 + 建出新面板 + 带现场的 warn', async () => {
  const h = await startHarness()
  try {
    h.gearClick()
    await h.waitFor('设置面板建出来', () => h.panels.length === 1)
    const first = h.panels[0]!
    await h.waitFor('面板装上装配页', () => ASSEMBLED(first))

    // 宿主收摊的形状：webview 死了，但 dispose 事件没送到扩展这边——引用还留着。
    first.__killWebview()

    // 「已开则聚焦」这一步不能把 `Webview is disposed` 抛给调用方（齿轮那条路不接异常）：
    // 抛出去就是一个没人接的 rejection，用户侧「点了没反应」。
    assert.equal(h.assembly.revealAssembledSettings(), false, '死面板 → 按没开处理')
    const dead = h.lines(/^settings open: panel is already gone /)
    assert.equal(dead.length, 1, `发现死面板要落一条 warn（实际日志：${h.logs.map((line) => line.message).join(' | ')}）`)
    for (const field of ['panelDisposedAt=unobserved', 'creating=no', 'hostTeardown=no']) {
      assert.ok(dead[0]!.includes(field), `失败现场要带 ${field}：${dead[0]}`)
    }
    assert.equal(
      h.lines(/^settings open: panel=singleton:alive branch=reveal result=failed:Webview is disposed$/).length,
      1,
      '坏引用那一刻也要留一行（说明这次打开为什么没能直接聚焦）',
    )

    h.gearClick()
    await h.waitFor('自愈之后建出新面板', () => h.panels.length === 2)
    const second = h.panels[1]!
    await h.waitFor('新面板装上装配页', () => ASSEMBLED(second))

    assert.deepEqual(
      h.lines(/^settings open: panel=/).map((line) => line.replace(/^settings open: /, '')),
      [
        'panel=none branch=create result=ok',
        'panel=singleton:alive branch=reveal result=failed:Webview is disposed',
        'panel=none branch=create result=ok',
      ],
      '留痕读得出来：先建过一版 → 聚焦那一步撞上死面板 → 自愈又建一版',
    )
    assert.equal(h.messages.length, 0, '自愈成功时用户不该看到任何错误提示')

    // 这一跳也要把死面板占的 mirror 引用还掉（#233 判据⑤）：死面板自己不会再 dispose，
    // 漏下它的引用，窗口里这个 loopback 端口就一直开着。
    const origin = h.mirrorOriginOf(first)
    await h.close()
    await h.waitFor('坏引用那一跳不漏 mirror 引用（端口关掉）', async () => !(await portAnswers(origin)), 3_000)
  } finally {
    await h.close()
  }
})

test('③ 连点两次齿轮 → 只建出一个面板（不增生）', async () => {
  const h = await startHarness()
  try {
    // 还没有面板时连点两次（用户手快）：两次请求落在同一个创建上。
    h.gearClick()
    h.gearClick()
    await h.waitFor('面板建出来', () => h.panels.length === 1)
    await new Promise((resolve) => setTimeout(resolve, 400))
    assert.equal(h.panels.length, 1, `连点两次不该增生面板（实际 ${h.panels.length} 个）`)

    // 引用指着死面板时连点两次：同样只该建出一个新的（第一次点自愈，第二次点落在在途
    // 创建上）。
    h.panels[0]!.__killWebview()
    h.gearClick()
    h.gearClick()
    await h.waitFor('自愈后建出新面板', () => h.panels.length === 2)
    await new Promise((resolve) => setTimeout(resolve, 400))
    assert.equal(h.panels.length, 2, `连点两次不该增生面板（实际 ${h.panels.length} 个）`)
    assert.ok(
      h.lines(/^settings open: panel=/).length >= 4,
      `每一次点都要留痕（实际：${h.lines(/^settings open: panel=/).join(' | ')}）`,
    )
  } finally {
    await h.close()
  }
})

test('④ 日志留痕：打开一条、创建一条、销毁一条（带存活时长与原因）', async () => {
  const h = await startHarness()
  try {
    h.gearClick()
    await h.waitFor('设置面板建出来', () => h.panels.length === 1)
    const first = h.panels[0]!
    await h.waitFor('面板装上装配页', () => ASSEMBLED(first))

    const opened = h.lines(/^assembled settings: /)
    assert.equal(opened.length, 1, `装配页就位要留一行（实际：${opened.join(' | ')}）`)
    assert.ok(
      opened[0]!.includes(h.mirrorOriginOf(first)),
      `那一行要带这个面板的 mirror 源：${opened[0]} 对 ${h.mirrorOriginOf(first)}`,
    )
    assert.equal(h.lines(/^settings panel created$/).length, 1, '面板建起来要留一条')

    // 面板还活着时再开一次（命令那条路）：单例被**我们自己**替换掉。
    await h.runCommand('dshOne.assembledSettings')
    await h.waitFor('换出来的新面板', () => h.panels.length === 2)
    const second = h.panels[1]!
    await h.waitFor('新面板装上装配页', () => ASSEMBLED(second))
    assert.equal(h.lines(/^settings panel replaced$/).length, 1, '替换那一刻要留一条')
    assert.equal(h.lines(/^settings panel created$/).length, 2, '换出来的那一个也要留一条')

    // 用户点关闭（这一条与上面那条替换要分得开：`reason` 与 `hostTeardown`）。
    second.dispose()
    assert.deepEqual(
      h.lines(/^settings panel disposed: /).map(ageLess),
      [
        'settings panel disposed: reason=replace age=<n>ms hostTeardown=no',
        'settings panel disposed: reason=other age=<n>ms hostTeardown=no',
      ],
      `销毁各留一条并写得出原因与存活时长（实际：${h.lines(/^settings panel disposed: /).join(' | ')}）`,
    )
  } finally {
    await h.close()
  }
})

test('⑤ 共享 mirror 引用配平：坏引用那一跳不漏，最后一个引用放开后端口不再监听', async () => {
  const h = await startHarness()
  try {
    h.gearClick()
    await h.waitFor('设置面板建出来', () => h.panels.length === 1)
    const first = h.panels[0]!
    await h.waitFor('面板装上装配页', () => ASSEMBLED(first))
    const origin = h.mirrorOriginOf(first)
    assert.equal(await portAnswers(origin), true, '有人拿着引用时端口在监听')

    // 宿主收摊形状 + 点齿轮自愈：这一跳要把死面板那份引用还掉。
    first.__killWebview()
    h.gearClick()
    await h.waitFor('自愈建出新面板', () => h.panels.length === 2)
    const second = h.panels[1]!
    await h.waitFor('新面板装上装配页', () => ASSEMBLED(second))
    assert.equal(h.mirrorOriginOf(second), origin, '同一窗口同一网关 = 同一个共享 mirror')
    assert.equal(await portAnswers(origin), true, '面板还开着，端口当然在监听')

    second.dispose()
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(await portAnswers(origin), true, '侧栏 view 还拿着一份引用')

    h.disposeSidebarView()
    // 死面板那一跳若漏下它的引用，这一条永远等不到：引用计数只减不增，端口会一直开着。
    await h.waitFor('引用归零后端口关掉', async () => !(await portAnswers(origin)), 3_000)
  } finally {
    await h.close()
  }
})

test('⑥ 命令那条路失败不静默：建面板失败时用户看到一行提示，留痕写明失败在哪一步', async () => {
  const h = await startHarness()
  try {
    h.setFailNextPanelCreate(true)
    h.gearClick()
    await h.waitFor('请求走完（留痕出现）', () => h.lines(/^settings open: panel=/).length === 1)
    assert.deepEqual(
      h.lines(/^settings open: panel=/).map((line) => line.replace(/^settings open: /, '')),
      ['panel=none branch=create result=failed:create:stub: createWebviewPanel failed on purpose'],
      `请求留痕（实际日志：${h.logs.map((line) => `${line.level}:${line.message}`).join(' | ')}）`,
    )
    assert.deepEqual(
      h.messages.filter((message) => message.level === 'error').map((message) => message.message),
      ['Failed to open the settings panel: stub: createWebviewPanel failed on purpose'],
      '用户看到一行可见反馈',
    )
  } finally {
    await h.close()
  }

  // 失败的那次创建不许漏下 mirror 引用（#223 判据⑤对 chat 的同一条，#233 判据⑤照办）——
  // 侧栏 view 的那一份在 close() 里已经还了，端口还不肯关就是漏了。
  const origin = /^assembly mirror: (http:\/\/\S+)\/?$/.exec(
    h.logs.map((line) => line.message).find((message) => message.startsWith('assembly mirror: ')) ?? '',
  )?.[1]
  assert.ok(origin !== undefined, `日志里要取得到 mirror 源：${h.logs.map((line) => line.message).join(' | ')}`)
  await h.waitFor('失败路径不漏 mirror 引用（端口关掉）', async () => !(await portAnswers(origin!)), 3_000)
})

test('⑦ 准备步骤失败：清单拉不到时既有的一行可见提示还在，留痕写明失败在 manifest', async () => {
  const h = await startHarness()
  try {
    await h.stopGateway() // 拉清单会失败（不是抛异常那条，是回执里那一步）
    h.gearClick()
    await h.waitFor('请求走完', () => h.lines(/^settings open: panel=/).length === 1)
    assert.deepEqual(
      h.lines(/^settings open: panel=/).map((line) => line.replace(/^settings open: /, '')),
      ['panel=none branch=create result=failed:manifest'],
      `请求留痕（实际日志：${h.logs.map((line) => `${line.level}:${line.message}`).join(' | ')}）`,
    )
    assert.equal(
      h.messages.filter((message) => message.level === 'error').length,
      1,
      '清单拉不到本来就有自己的一行提示，不该再多弹也不该没有',
    )
  } finally {
    await h.close()
  }
})

// ⚠️ 这条必须留在文件最后：`markHostDeactivating` 是单向开关（真宿主里 `deactivate`
// 一生只调一次），置位之后同进程后续任何 dispose 都按「宿主带走的」留痕。
test('⑧ 宿主收摊带走面板：销毁那条带 hostTeardown=yes（与用户点关闭分得开）', async () => {
  const h = await startHarness()
  try {
    h.gearClick()
    await h.waitFor('设置面板建出来', () => h.panels.length === 1)
    const panel = h.panels[0]!
    await h.waitFor('面板装上装配页', () => ASSEMBLED(panel))

    h.assembly.markHostDeactivating()
    panel.dispose()
    assert.deepEqual(
      h.lines(/^settings panel disposed: /).map(ageLess),
      ['settings panel disposed: reason=other age=<n>ms hostTeardown=yes'],
      `宿主收摊那条读得出来（实际：${h.lines(/^settings panel disposed: /).join(' | ')}）`,
    )
  } finally {
    await h.close()
  }
})
