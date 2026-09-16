/**
 * 安装引导页的单测（#105 改版）：
 * - 平台下拉项按 `installScript.ts` 的实际分叉生成（macOS / Linux 命令相同就合成一项，
 *   命令分岔就各自成项）——下拉项的措辞与数量直接决定用户跑哪条命令；
 * - 页面结构（hero / 主按钮 + 下拉 / 命令胶囊 + 复制 / 分段控件两段）；
 * - 注入进页面的命令表与默认平台（命令由宿主现算，页面只回平台名）；
 * - 文案过 HTML 转义、注入脚本里不留可闭合的 `</script>`。
 *
 * 页面的交互与明暗两态由浏览器冒烟覆盖（`test/install-guide/`，`npm run verify:install-guide`）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  INSTALL_SCRIPT_OS_ORDER,
  installCommandFor,
  type HostOs,
} from '../src/pure/installScript.ts'
import {
  installGuidePageHtml,
  installPlatformItems,
  type InstallGuideTexts,
} from '../src/pure/installGuidePage.ts'

const TEXTS: InstallGuideTexts = {
  heroTitle: 'Install dsh',
  heroLead: 'Pick your platform.',
  installButton: 'Install dsh',
  platformLabel: 'Platform',
  copy: 'Copy command',
  copied: 'Copied',
  copyFailed: 'Copy failed',
  docsLink: 'Official installation guide',
  terminalTab: 'Terminal install',
  editorTab: 'Editor setup',
  terminalSteps: ['First step', 'Second step', 'Third step'],
  unofficialNote: 'The script is maintained by dsh-one (unofficial).',
  editorLead: 'Back in VS Code.',
  editorNote: 'You can also use the web interface.',
  openWeb: 'Open dsh web',
}

const page = (hostOs: HostOs | undefined, texts: InstallGuideTexts = TEXTS): string =>
  installGuidePageHtml(hostOs, texts)

/* ---------- 平台项：按命令分叉合成 ---------- */

test('平台项：macOS 与 Linux 命令相同，合成一项；Windows 单独一项', () => {
  assert.deepEqual(installPlatformItems(), [
    { os: 'windows', label: 'Windows' },
    { os: 'macos', label: 'macOS / Linux' },
  ])
})

test('平台项的代表平台带头：合并项的 os 是组里第一个平台，其命令与同组其它平台一致', () => {
  for (const item of installPlatformItems()) {
    const sameCommand = INSTALL_SCRIPT_OS_ORDER.filter(
      (os) => installCommandFor(os) === installCommandFor(item.os),
    )
    assert.ok(sameCommand.includes(item.os), `${item.os} 的命令应能代表整项`)
  }
})

test('每个平台都能在下拉里选到（合并项之外不漏平台、不重平台）', () => {
  const covered = installPlatformItems().flatMap((item) =>
    INSTALL_SCRIPT_OS_ORDER.filter((os) => installCommandFor(os) === installCommandFor(item.os)),
  )
  assert.deepEqual([...new Set(covered)].sort(), [...INSTALL_SCRIPT_OS_ORDER].sort())
})

/* ---------- 页面结构 ---------- */

test('hero：大标题与副标题都在，且没有网站式顶部导航条', () => {
  const html = page('macos')
  assert.match(html, /<h1>Install dsh<\/h1>/)
  assert.match(html, /<p class="hero-lead">Pick your platform\.<\/p>/)
  assert.ok(!/<nav/.test(html), '引导页不该有网站式导航')
})

test('主按钮：一个带下拉箭头的按钮，点开前菜单是收起的', () => {
  const html = page('macos')
  assert.match(html, /<button id="picker" class="picker-btn" type="button" aria-haspopup="true" aria-expanded="false"/)
  assert.match(html, /<div id="menu" class="menu" role="menu"[^>]*hidden>/)
})

test('下拉：平台项是 menu 里的单选项，且只有默认平台带选中态', () => {
  const html = page('macos')
  const platformItem = /<button class="menu-item" type="button" role="menuitemradio" data-os="([a-z]+)" aria-checked="(true|false)">/g
  const items = [...html.matchAll(platformItem)].map((m) => ({ os: m[1], checked: m[2] === 'true' }))
  assert.deepEqual(items, [
    { os: 'windows', checked: false },
    { os: 'macos', checked: true },
  ])
})

test('下拉：外链项带 ↗ 图标与独立动作名（不与平台项混为一类）', () => {
  const html = page('macos')
  const link = /<button class="menu-item" type="button" role="menuitem" data-action="([a-z]+)">.*?<\/button>/
  const matched = link.exec(html)
  assert.ok(matched, '下拉里应有外链项')
  assert.equal(matched[1], 'docs')
  assert.equal((matched[0].match(/<svg/g) ?? []).length, 1, '外链项右侧应有一个 ↗ 图标')
  assert.ok(matched[0].includes(TEXTS.docsLink))
})

test('命令胶囊：等宽字体 + 单行省略 + 复制图标（复制结果另有朗读区）', () => {
  const html = page('macos')
  assert.match(html, /<code id="cmd"><\/code>/)
  assert.match(html, /font-family: var\(--vscode-editor-font-family, monospace\)/)
  assert.match(html, /text-overflow: ellipsis; white-space: nowrap/)
  assert.match(
    html,
    /<button id="copy" class="icon-btn" type="button" data-state="idle" aria-label="Copy command"/,
  )
  assert.match(html, /<span id="copy-status" class="sr-only" role="status" aria-live="polite">/)
})

test('分段控件：「终端安装 / 编辑器接入」两段，默认终端段，编辑器段收起', () => {
  const html = page('macos')
  assert.match(html, /id="tab-terminal" class="seg" type="button" role="tab" aria-selected="true" aria-controls="panel-terminal">Terminal install</)
  assert.match(html, /id="tab-editor" class="seg" type="button" role="tab" aria-selected="false" aria-controls="panel-editor">Editor setup</)
  assert.match(html, /<div id="panel-terminal" class="panel" role="tabpanel" aria-labelledby="tab-terminal">/)
  assert.match(html, /<div id="panel-editor" class="panel" role="tabpanel" aria-labelledby="tab-editor" hidden>/)
  assert.ok(!/href="#/.test(html), '分段切换不该是整页跳转（没有锚点链接）')
})

test('终端段：步骤逐条渲染（条数与文案一致）', () => {
  const html = page('macos')
  assert.deepEqual(
    [...html.matchAll(/<li>(.*?)<\/li>/g)].map((m) => m[1]),
    TEXTS.terminalSteps,
  )
})

test('编辑器段：官方 dsh web 入口是一个按钮（动作回宿主，不在页面拼 URL）', () => {
  const html = page('macos')
  assert.match(html, /<button id="open-web" class="btn-secondary" type="button">Open dsh web<svg/)
  assert.match(html, /installGuide:openWeb/)
})

/* ---------- 注入的数据与默认平台 ---------- */

test('命令表按平台现算后注入页面（页面自己不拼命令）', () => {
  const html = page('macos')
  const injected = /const COMMANDS = (\{.*?\})\n/.exec(html)
  assert.ok(injected, '页面里应有注入的命令表')
  const commands = JSON.parse(injected[1]) as Record<string, string>
  assert.deepEqual(Object.keys(commands).sort(), [...INSTALL_SCRIPT_OS_ORDER].sort())
  for (const os of INSTALL_SCRIPT_OS_ORDER) assert.equal(commands[os], installCommandFor(os))
})

test('默认平台：认得出宿主平台就用它，认不出回退第一项', () => {
  assert.match(page('windows'), /let selectedOs = "windows"\n/)
  assert.match(page(undefined), new RegExp(`let selectedOs = "${INSTALL_SCRIPT_OS_ORDER[0]}"`))
})

test('命令只出现在注入的命令表里：页面结构本身不写死任何命令', () => {
  const html = page('macos')
  const scriptAt = html.indexOf('<script nonce=')
  const markup = html.slice(0, scriptAt)
  const injected = html.slice(scriptAt)
  for (const os of INSTALL_SCRIPT_OS_ORDER) {
    const command = installCommandFor(os)
    assert.ok(!markup.includes(command), `结构里不该写死 ${os} 的命令`)
    assert.ok(injected.includes(command), `${os} 的命令应随命令表注入`)
    assert.equal(
      html.split(command).length,
      injected.split(command).length,
      `${os} 的命令不该出现在注入脚本之外`,
    )
  }
})

/* ---------- 转义与 CSP ---------- */

test('页面语言跟着界面语言（字体回退与读屏用），缺省英文', () => {
  assert.match(page('macos'), /<html lang="en">/)
  assert.match(installGuidePageHtml('macos', TEXTS, 'zh-cn'), /<html lang="zh-cn">/)
})

test('文案过 HTML 转义：配置里带着尖括号也进不了页面结构', () => {
  const html = page('macos', { ...TEXTS, heroLead: '<img src=x onerror=alert(1)>&', copy: '"quoted"' })
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;&amp;'))
  assert.ok(!html.includes('<img src=x'))
  assert.ok(html.includes('aria-label="&quot;quoted&quot;"'))
})

test('CSP nonce 与页内脚本的 nonce 一致，且脚本里不含可闭合的 </script>', () => {
  const html = page('macos', { ...TEXTS, copied: '</script><script>alert(1)</script>' })
  const nonce = /script-src 'nonce-([0-9a-f]+)'/.exec(html)
  assert.ok(nonce, 'CSP 里应有 nonce')
  assert.equal((html.match(/<script nonce="/g) ?? []).length, 1)
  assert.ok(html.includes(`<script nonce="${nonce[1]}">`))
  assert.ok(!html.includes('</script><script>alert(1)'))
})

test('每次渲染换一个 nonce', () => {
  const first = /script-src 'nonce-([0-9a-f]+)'/.exec(page('macos'))
  const second = /script-src 'nonce-([0-9a-f]+)'/.exec(page('macos'))
  assert.notEqual(first?.[1], second?.[1])
})

/* ---------- 主题 token ---------- */

test('颜色走 VS Code 主题 token：背景是编辑器主题色，不写死白底/黑字', () => {
  const html = page('macos')
  assert.match(html, /background: var\(--vscode-editor-background, transparent\)/)
  assert.ok(!/background:\s*#fff/i.test(html))
  for (const token of [
    '--vscode-button-background',
    '--vscode-button-foreground',
    '--vscode-menu-background',
    '--vscode-menu-selectionBackground',
    '--vscode-focusBorder',
    '--vscode-charts-green',
    '--vscode-charts-red',
  ]) {
    assert.ok(html.includes(`var(${token}`), `${token} 应带兜底值被用上`)
  }
})
