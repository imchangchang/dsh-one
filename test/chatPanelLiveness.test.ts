/**
 * #223 / #224 的宿主侧判据：**真跑宿主代码，只看用户看得见的结果**。
 *
 * 为什么需要这一组（而不是只靠浏览器验证或静态扫描）：`src/ui/assemblyView.ts` 是扩展
 * 宿主侧的代码——面板的创建 / 聚焦 / 替换 / 关闭、共享 loopback mirror 的引用计数、
 * 以及「点了没反应」时落的那几行日志，**全都不在装配页里**，浏览器验证（`test/assembly-lab/`）
 * 看不到；真窗验收只能人做。`test/chatPanelLiveness/` 用假 `vscode` 模块 + 假网关在 node
 * 里把真实宿主代码跑起来（做法与 `test/install-guide/`、`test/legacy-sidebar/` 同源），
 * 于是这些判据可以随 `npm test` 常驻。
 *
 * 覆盖的现场（用户 2.0.0 报告的形状，见 #223）：
 * - **面板被关掉之后再点会话**：必须建出新面板（不是默默失败）；
 * - **引用还在、面板已经没了**（宿主收摊：webview 死了、dispose 事件没送到扩展这边）：
 *   点会话必须自愈（清坏引用 → 只重试一次 → 建出新面板），并落一条带现场的 warn；
 * - **连点两次只建一个面板**（同一次点击不增生）；
 * - **#68 的两条既有行为不变**（已开则聚焦不新开、用户关过记在案）；
 * - **多开标签页不增生**（已开则聚焦）；
 * - **共享 mirror 引用配平**（面板全关掉之后 loopback 端口不再监听）；
 * - **兜底不再静默**（创建路径抛错时用户看到一行提示，日志带现场）。
 *
 * 负向对照（把守卫去掉 → 对应判据必须红）在开发报告里逐条给了读数：这一组判据本身
 * 就是那些实验量出来的，摘掉守卫会在这里当场失败。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { loadSource, resolveSpecifier } from './chatPanelLiveness/vscodeHooks.ts'
import { portAnswers, startHarness } from './chatPanelLiveness/harness.ts'

// 装上模块钩子（`vscode` → 假模块；`.ts` 过 esbuild）。必须在任何会 import src/**
// 的模块被求值之前执行，所以宿主模块一律在 startHarness() 里动态 import。
registerHooks({ resolve: resolveSpecifier, load: loadSource } as never)

/** 装配页真的写进 webview 了没有（页面上必须带官方 boot 注入）。 */
const ASSEMBLED = (panel: { webview: { html: string } }): boolean => panel.webview.html.includes('__DSH_BOOT__')

test('① 面板被关掉之后再点会话 → 建出新面板', async () => {
  const h = await startHarness()
  try {
    h.requestPanel('session-aaa')
    await h.waitFor('第一个面板建出来', () => h.panels.length === 1)
    const first = h.panels[0]!
    await h.waitFor('第一个面板装上装配页', () => ASSEMBLED(first))
    assert.equal(h.assembly.hasAssembledChatPanel(), true, '面板开着时 hasAssembledChatPanel 为真')

    // 用户点关闭（宿主会同步发 onDidDispose）。
    first.dispose()
    assert.equal(h.assembly.hasAssembledChatPanel(), false, '关掉之后引用清干净')

    h.requestPanel('session-bbb')
    await h.waitFor('关掉之后再点会话建出新面板', () => h.panels.length === 2)
    const second = h.panels[1]!
    await h.waitFor('新面板装上装配页', () => ASSEMBLED(second))

    assert.deepEqual(
      h.lines(/^chat open: session=session-bbb /).map((line) => line.replace(/^chat open: /, '')),
      ['session=session-bbb panel=none branch=create result=ok'],
      '请求留痕：没有可用面板 → 走 create → ok',
    )
    assert.equal(h.messages.length, 0, '这一路不该弹任何提示（用户看到的就是面板出来了）')
  } finally {
    await h.close()
  }
})

test('① 引用还在、面板已经没了（宿主收摊形状）→ 清坏引用 + 只重试一次 + 带现场的 warn', async () => {
  const h = await startHarness()
  try {
    h.requestPanel('session-aaa')
    await h.waitFor('第一个面板建出来', () => h.panels.length === 1)
    const first = h.panels[0]!
    await h.waitFor('第一个面板装上装配页', () => ASSEMBLED(first))

    // 宿主收摊的形状：webview 死了，但 dispose 事件没送到扩展这边——引用还留着。
    first.__killWebview()

    h.requestPanel('session-bbb')
    await h.waitFor('重试之后建出新面板', () => h.panels.length === 2)
    const second = h.panels[1]!
    await h.waitFor('新面板装上装配页', () => ASSEMBLED(second))

    assert.deepEqual(
      h.lines(/^chat open: session=session-bbb /).map((line) => line.replace(/^chat open: /, '')),
      ['session=session-bbb panel=singleton:disposed branch=retry result=ok'],
      '第一次递送失败 → 重试一次建新面板 → ok',
    )
    const dead = h.lines(/^chat open: panel is already gone /)
    assert.equal(dead.length, 1, '发现死面板要落一条 warn')
    for (const field of [
      'requested=session-bbb',
      'panelSession=session-aaa',
      'panelDisposedAt=unobserved',
      'creating=no',
      'hostTeardown=no',
    ]) {
      assert.ok(dead[0]!.includes(field), `失败现场要带 ${field}：${dead[0]}`)
    }
    assert.ok(dead[0]!.includes('Webview is disposed'), '现场里要有原始错误文字')
    assert.equal(h.messages.length, 0, '自愈成功时用户不该看到任何错误提示')
    assert.equal(h.assembly.hasAssembledChatPanel(), true, '坏引用清掉、新面板接上了')

    // 重建路径上的引用要成对（#223 判据⑤）：那个死面板自己已经不会再 dispose 了，
    // 它占的 mirror 引用必须在这一跳里还掉——否则窗口里这个 loopback 端口一直开着。
    const origin = h.mirrorOriginOf(first)
    await h.close()
    await h.waitFor('重建路径不漏 mirror 引用（端口关掉）', async () => !(await portAnswers(origin)), 3_000)
  } finally {
    await h.close()
  }
})

test('① 新建会话那条路（revealAssembledChat）遇到死面板：返回 false 而不是把异常抛给调用方', async () => {
  const h = await startHarness()
  try {
    h.requestPanel('session-aaa')
    await h.waitFor('面板建出来', () => h.panels.length === 1)
    const first = h.panels[0]!
    await h.waitFor('面板装上装配页', () => ASSEMBLED(first))

    // 新建会话 / fork / 默认打开都先问这一句「已开则聚焦」，死面板必须按「没开」处理：
    // 抛出去的话，调用方（extension.ts 那条 openAssembledChat）拿不到 false，
    // 也就不会去开一个新面板 —— 用户看到的还是「点了没反应」。
    first.__killWebview()
    assert.equal(h.assembly.revealAssembledChat(), false, '死面板 → 按没开处理')
    assert.equal(h.assembly.hasAssembledChatPanel(), false, '坏引用当场清掉')
    assert.equal(h.lines(/^chat open: panel is already gone /).length, 1, '留一条带现场的 warn')

    // 清干净之后调用方接着走命令那条路：必须真的建出一个新面板。
    await h.runCommand('dshOne.assembledChat')
    await h.waitFor('接着建出新面板', () => h.panels.length === 2)
    assert.deepEqual(
      h.lines(/^chat open: /).map((line) => line.replace(/^chat open: /, '')).slice(-1),
      ['session=none panel=none branch=create result=ok'],
      '命令那条路也留一行',
    )
  } finally {
    await h.close()
  }
})

test('② 死面板时连点两次 → 只建出一个面板（不增生）', async () => {
  const h = await startHarness()
  try {
    h.requestPanel('session-aaa')
    await h.waitFor('第一个面板建出来', () => h.panels.length === 1)
    const first = h.panels[0]!
    await h.waitFor('第一个面板装上装配页', () => ASSEMBLED(first))
    first.__killWebview()

    // 两次点击落在同一拍（用户连点）：都必须落在同一个新面板上。
    h.requestPanel('session-bbb')
    h.requestPanel('session-bbb')
    await h.waitFor('重试建出一个新面板', () => h.panels.length === 2)
    await new Promise((resolve) => setTimeout(resolve, 400))

    assert.equal(h.panels.length, 2, `连点两次不该增生面板（实际 ${h.panels.length} 个）`)
    const openLines = h.lines(/^chat open: session=/)
    assert.equal(openLines.length, 2, `一次点击一行留痕：${openLines.join(' | ')}`)
  } finally {
    await h.close()
  }
})

test('③ #68 既有行为不变：已开则聚焦（不新开）、用户关过记在案', async () => {
  const h = await startHarness()
  try {
    h.requestPanel('session-aaa')
    await h.waitFor('面板建出来', () => h.panels.length === 1)
    const first = h.panels[0]!
    await h.waitFor('面板装上装配页', () => ASSEMBLED(first))

    const revealedBefore = first.revealed
    assert.equal(h.assembly.revealAssembledChat(), true, '已开 → 聚焦并返回 true')
    assert.equal(first.revealed, revealedBefore + 1, '聚焦走的是 reveal')
    assert.equal(h.panels.length, 1, '聚焦不新开面板')

    first.dispose()
    assert.equal(h.assembly.hasAssembledChatPanel(), false, '关掉之后没有面板')
    // 「用户手动关过之后不再强开」吃的就是这一条（extension.ts 的默认打开读它）。
    assert.equal(h.assembly.wasAssembledChatClosedByUser(), true, '用户关过 = 记在案')
  } finally {
    await h.close()
  }
})

test('④ 多开标签页不增生：已开则聚焦', async () => {
  const h = await startHarness()
  try {
    await h.assembly.openSessionInNewTab('session-tab')
    await h.waitFor('多开面板建出来', () => h.panels.length === 1)
    const tab = h.panels[0]!
    await h.waitFor('多开面板装上装配页', () => ASSEMBLED(tab))

    const revealedBefore = tab.revealed
    await h.assembly.openSessionInNewTab('session-tab')
    assert.equal(h.panels.length, 1, '同一个会话再点仍是那一个面板')
    assert.equal(tab.revealed, revealedBefore + 1, '已开 → 聚焦')

    // 面板没了之后（宿主收摊形状）再点：必须开一个新的，不能抛给调用方。
    tab.__killWebview()
    await h.assembly.openSessionInNewTab('session-tab')
    await h.waitFor('死面板之后重新开一个', () => h.panels.length === 2)
    assert.ok(h.lines(/^chat open: panel is already gone /).length >= 1, '死面板要留一条带现场的 warn')
  } finally {
    await h.close()
  }
})

test('⑤ 共享 mirror 引用配平：面板全关之后 loopback 端口不再监听', async () => {
  const h = await startHarness()
  try {
    h.requestPanel('session-aaa')
    await h.waitFor('单例面板建出来', () => h.panels.length === 1)
    const singleton = h.panels[0]!
    await h.waitFor('单例面板装上装配页', () => ASSEMBLED(singleton))
    const origin = h.mirrorOriginOf(singleton)

    await h.assembly.openSessionInNewTab('session-tab')
    await h.waitFor('多开面板建出来', () => h.panels.length === 2)
    const tab = h.panels[1]!
    await h.waitFor('多开面板装上装配页', () => ASSEMBLED(tab))
    assert.equal(h.mirrorOriginOf(tab), origin, '同一窗口同一网关 = 同一个共享 mirror')
    assert.equal(await portAnswers(origin), true, '有人拿着引用时端口在监听')

    tab.dispose()
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(await portAnswers(origin), true, '少一个引用不解散共享 mirror')

    singleton.dispose()
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(await portAnswers(origin), true, '侧栏 view 还拿着一份引用')

    h.disposeSidebarView()
    await h.waitFor('引用归零后端口关掉', async () => !(await portAnswers(origin)), 3_000)
    assert.equal(h.panels.every((panel) => panel.dead), true, '收尾时没有活着的面板')
  } finally {
    await h.close()
  }
})

test('③ 兜底不再静默：创建路径抛错时用户看到一行提示 + 日志带现场', async () => {
  const h = await startHarness()
  try {
    h.setFailNextPanelCreate(true)
    h.requestPanel('session-aaa')
    await h.waitFor('请求走完（留痕出现）', () => h.lines(/^chat open: session=/).length === 1)
    assert.deepEqual(
      h.lines(/^chat open: session=/).map((line) => line.replace(/^chat open: /, '')),
      ['session=session-aaa panel=none branch=create result=failed:stub: createWebviewPanel failed on purpose'],
      `请求留痕（失败现场：${h.logs.map((line) => `${line.level}:${line.message}`).join(' | ')}）`,
    )
    const failure = h.lines(/^assembled chat: opening /)
    assert.equal(failure.length, 1, `失败要留一条 warn（实际日志：${h.logs.map((line) => line.message).join(' | ')}）`)
    assert.ok(failure[0]!.includes('requested=session-aaa'), `失败行要带现场：${failure[0]}`)
    assert.ok(failure[0]!.includes('createWebviewPanel failed'), '失败行要带原始错误文字')
    assert.deepEqual(
      h.messages.filter((message) => message.level === 'error').map((message) => message.message),
      ['Failed to open the chat panel: stub: createWebviewPanel failed on purpose'],
      '用户看到一行可见反馈',
    )
  } finally {
    await h.close()
  }

  // 失败的那次创建不许漏下 mirror 引用（#223 判据⑤：整轮跑完没有泄漏）——
  // 侧栏 view 的那一份在 close() 里已经还了，端口还不肯关就是漏了。
  const origin = /^assembly mirror: (http:\/\/\S+)\/?$/.exec(
    h.logs.map((line) => line.message).find((message) => message.startsWith('assembly mirror: ')) ?? '',
  )?.[1]
  assert.ok(origin !== undefined, `日志里要取得到 mirror 源：${h.logs.map((line) => line.message).join(' | ')}`)
  await h.waitFor('失败路径不漏 mirror 引用（端口关掉）', async () => !(await portAnswers(origin!)), 3_000)
})
