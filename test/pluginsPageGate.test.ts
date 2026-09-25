/**
 * 「插件页这一代到底在不在」这条判据的常驻判据（#253）。
 *
 * 现象：0.1.5 两版与 0.1.6-alpha.1 上，侧栏工具栏那枚「插件」图标照样渲染、命令面板里
 * 「打开插件页」照样执行，点开却是**一片空白**——那些版本里官方根本没有插件页
 * （官方那一件包 `@deepseek-ai/dsh-client-ui-plugin-manager` 最早的版本是 0.1.6-alpha.2），
 * 而「宿主有没有独立插件页」这条能力口在 VS Code 上恒为真。修法 = 按**机制读数**决定去留：
 * 这一份插件清单里有没有官方那一件包（`src/pure/officialPluginsPage.ts`，为什么是这条读数、
 * 为什么不是版本号或座判，那个文件的文件头逐条写了）。
 *
 * 两个消费点各占一半，这一组判据也分两半：
 * 1. **页面侧**（工具栏那一枚在不在）由浏览器验证的 F-76 判（`test/assembly-lab/`）。
 * 2. **宿主侧**（命令面板那一条：不许开出一个空白页签）在这里判——真跑宿主那份建面板流程
 *    （`src/ui/assemblyView.ts` 的 `createPluginsPanel`），假 `vscode` 模块 + 假网关，
 *    只不过这个假网关的清单可以**按这一代有没有插件页**换两档（`HarnessOptions`，
 *    见 `test/chatPanelLiveness/harness.ts`）。
 *
 * 两档读数（缺一档这组判据都证不了这件事）：
 * - **有**（缺省档 = 0.1.6-alpha.2 的形状）：执行命令 → 真的建出插件页面板、装的是装配页，
 *   一行提示都不弹；
 * - **没有**（`officialPluginsPage: false` = 更老那一代的形状）：执行命令 → **不建面板**、
 *   给用户**恰好一行**说明（而不是开一个空白页签），日志留一行说明是为什么。
 *
 * 判据自己那一半（清单形状对不上时按「这一代没有」处置）用纯函数用例钉住：宁可少一枚入口，
 * 也不要给用户一枚点开是空白的按钮。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { loadSource, resolveSpecifier } from './chatPanelLiveness/vscodeHooks.ts'
import { startHarness } from './chatPanelLiveness/harness.ts'
import { OFFICIAL_PLUGINS_PAGE_PLUGIN_ID, hasOfficialPluginsPage } from '../src/pure/officialPluginsPage.ts'

registerHooks({ resolve: resolveSpecifier, load: loadSource } as never)

/** 装配页真的写进 webview 了没有（页面上必须带官方 boot 注入）。 */
const ASSEMBLED = (panel: { webview: { html: string } }): boolean => panel.webview.html.includes('__DSH_BOOT__')

test('判据：清单里有官方插件页那一件包 ⇒ 真的有；没有 / 形状对不上 ⇒ 没有（宁可少一枚入口）', () => {
  const entry = { id: OFFICIAL_PLUGINS_PAGE_PLUGIN_ID, url: '/plugins/??x/client.js&rev=r', rev: 'r' }
  // 正面：官方清单那种形状（entries 一栏里逐条 id）。
  assert.equal(hasOfficialPluginsPage({ rev: 'r', entries: [{ id: 'client-modules' }, entry], batches: [] }), true)
  // 反面：清单里只有别的条目（0.1.5 两版与 0.1.6-alpha.1 的形状）。
  assert.equal(hasOfficialPluginsPage({ rev: 'r', entries: [{ id: 'client-modules' }], batches: [] }), false)
  // 形状对不上：一律按「这一代没有」处置（不许抛，也不许当成有）。
  for (const wire of [undefined, null, 'wire', 42, {}, { entries: null }, { entries: 'client-modules' }, { entries: [null, 7] }]) {
    assert.equal(hasOfficialPluginsPage(wire), false, `形状对不上时必须是 false：${JSON.stringify(wire)}`)
  }
})

test('宿主侧：清单里有官方插件页 ⇒ 命令建出插件页面板，一行提示都不弹', async () => {
  const h = await startHarness()
  try {
    await h.runCommand('dshOne.assembledPlugins')
    await h.waitFor('插件页面板建出来', () => h.panels.some((panel) => panel.viewType === 'dshOne.assembledPlugins'))
    const panel = h.panels.find((entry) => entry.viewType === 'dshOne.assembledPlugins')!
    await h.waitFor('面板装上装配页', () => ASSEMBLED(panel))
    assert.equal(h.messages.length, 0, '这一路不该弹任何提示（用户看到的就是那一页开出来了）')
    assert.deepEqual(h.lines(/^plugins panel created$/), ['plugins panel created'], '宿主侧的建面板留痕')
  } finally {
    await h.close()
  }
})

test('宿主侧：清单里没有官方插件页（更老的 dsh）⇒ 不建面板，给一行说明', async () => {
  const h = await startHarness({ officialPluginsPage: false })
  try {
    await h.runCommand('dshOne.assembledPlugins')
    // 这一路是「不建面板」：先让异步的那两拍落定再读，免得拿第一帧当结论。
    await h.waitFor('给用户一行说明', () => h.messages.length === 1)
    await h.waitFor('失败留痕', () => h.lines(/^plugins open: /).length === 1)

    assert.equal(
      h.panels.filter((panel) => panel.viewType === 'dshOne.assembledPlugins').length,
      0,
      '这一代没有插件页：不许开出一个空白页签',
    )
    assert.deepEqual(
      h.messages.map((message) => message.level),
      ['info'],
      '给的是说明，不是错误（用户没做错什么，只是这一代没有那一页）',
    )
    assert.equal(
      h.messages[0]?.message,
      'The connected dsh has no plugins page, so there is nothing to open',
      '文案取 l10n 里那一条（英文基线；中文由 bundle.l10n.zh-cn.json 提供）',
    )
    assert.deepEqual(
      h.lines(/^plugins open: /),
      ['plugins open: this dsh has no plugins page (its manifest has no plugin-manager entry)'],
      '日志要说清是「这一代的清单里没有官方那一件包」',
    )
  } finally {
    await h.close()
  }
})
