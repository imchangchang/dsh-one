#!/usr/bin/env node
/**
 * 宿主侧页面的浏览器冒烟（#105 起，`npm run verify:install-guide`）。
 *
 * 验的是**不参与装配树的那两页**（dsh 没装时网关起不来，装配页组装不了，它们由宿主
 * 直接出 HTML）：
 * - 安装引导 tab（`src/ui/installGuide.ts` + `src/pure/installGuidePage.ts`，#105 改版）；
 * - 侧栏状态页（`src/ui/sidebarStatusPage.ts` + `src/pure/sidebarStatus.ts`，#101 纳入覆盖）。
 *
 * 页面由真实宿主代码渲染（`vscode` 模块由 `vscodeStub.mjs` 顶上），宿主侧则用页内
 * 的假桥（`__DSH_ONE_VSCODE__`，与 #100 同一口径）记录消息、回复制结果——于是
 * 「按钮 / 下拉（含选中态与外链）/ 命令随平台更换 / 复制成功与失败反馈 / 分段切换 /
 * 状态页三态与装配失败 / 明暗两态」都能自动断言，并留一组截图给人工看。
 *
 * 这两页都不参与装配树，所以它们不在装配实验室（`test/assembly-lab/`）里，用本目录这组
 * 轻量 harness 跑；跑前不需要网关。
 *
 * 用法：
 *   npm run verify:install-guide                     # 英文基线，light + dark
 *   SMOKE_LOCALE=zh-cn npm run verify:install-guide  # 用真中文译文渲染（串更长）
 *   SMOKE_HEADED=1 npm run verify:install-guide      # 开有界面的浏览器看现场
 *
 * 产物（`test/install-guide/out/`，已 gitignore）：台账 JSON + 各态截图。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { installGuideHtml } from '../../src/ui/installGuide.ts'
import { sidebarStatusHtml } from '../../src/ui/sidebarStatusPage.ts'
import { decideSidebarStatus, assemblyFailureView } from '../../src/pure/sidebarStatus.ts'
import { installCommandFor } from '../../src/pure/installScript.ts'
import { installPlatformItems } from '../../src/pure/installGuidePage.ts'
import { l10n } from './vscodeStub.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, 'out')
const LOCALE = process.env.SMOKE_LOCALE ?? 'en'
/** 渲染用的宿主平台（已映射成 `HostOs`：`darwin` → `macos`）——默认选中「macOS / Linux」。 */
const HOST_OS = 'macos'

/** 文案一律按当前 locale 取（en 是基线，zh-cn 是译文）——断言不写死中文或英文。 */
const T = (key, ...args) => l10n.t(key, ...args)

/* ---------- 断言与观测收集 ---------- */

const checks = []
const facts = []
function check(label, ok, detail = '') {
  checks.push({ label, ok: Boolean(ok), detail: String(detail) })
  return Boolean(ok)
}
const eq = (label, actual, expected) =>
  check(label, JSON.stringify(actual) === JSON.stringify(expected), `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`)
const fact = (line) => facts.push(line)

/* ---------- 主题变量：VS Code 默认深色/浅色主题里这几个 token 的取值 ---------- */

const THEMES = {
  dark: {
    '--vscode-editor-background': '#1e1e1e',
    '--vscode-foreground': '#cccccc',
    '--vscode-descriptionForeground': '#9d9d9d',
    '--vscode-button-background': '#0e639c',
    '--vscode-button-foreground': '#ffffff',
    '--vscode-button-hoverBackground': '#1177bb',
    '--vscode-button-secondaryBackground': '#3a3d41',
    '--vscode-button-secondaryForeground': '#ffffff',
    '--vscode-button-secondaryHoverBackground': '#45494e',
    '--vscode-menu-background': '#1f1f1f',
    '--vscode-menu-foreground': '#cccccc',
    '--vscode-menu-selectionBackground': '#0078d4',
    '--vscode-menu-selectionForeground': '#ffffff',
    '--vscode-menu-border': '#454545',
    '--vscode-menu-separatorBackground': '#454545',
    '--vscode-editorWidget-background': '#202020',
    '--vscode-textCodeBlock-background': '#252526',
    '--vscode-widget-border': '#454545',
    '--vscode-focusBorder': '#0078d4',
    '--vscode-toolbar-hoverBackground': 'rgba(90,93,94,0.31)',
    '--vscode-badge-background': '#4d4d4d',
    '--vscode-badge-foreground': '#ffffff',
    '--vscode-charts-green': '#89d185',
    '--vscode-charts-red': '#f14c4c',
    '--vscode-widget-shadow': 'rgba(0,0,0,0.36)',
    '--vscode-editor-font-family': 'Menlo, Monaco, monospace',
  },
  light: {
    '--vscode-editor-background': '#ffffff',
    '--vscode-foreground': '#3b3b3b',
    '--vscode-descriptionForeground': '#717171',
    '--vscode-button-background': '#005fb8',
    '--vscode-button-foreground': '#ffffff',
    '--vscode-button-hoverBackground': '#0258a8',
    '--vscode-button-secondaryBackground': '#e5e5e5',
    '--vscode-button-secondaryForeground': '#3b3b3b',
    '--vscode-button-secondaryHoverBackground': '#cccccc',
    '--vscode-menu-background': '#ffffff',
    '--vscode-menu-foreground': '#3b3b3b',
    '--vscode-menu-selectionBackground': '#0060c0',
    '--vscode-menu-selectionForeground': '#ffffff',
    '--vscode-menu-border': '#cecece',
    '--vscode-menu-separatorBackground': '#d4d4d4',
    '--vscode-editorWidget-background': '#f8f8f8',
    '--vscode-textCodeBlock-background': '#f3f3f3',
    '--vscode-widget-border': '#cecece',
    '--vscode-focusBorder': '#005fb8',
    '--vscode-toolbar-hoverBackground': 'rgba(184,184,184,0.31)',
    '--vscode-badge-background': '#cccccc',
    '--vscode-badge-foreground': '#3b3b3b',
    '--vscode-charts-green': '#388a34',
    '--vscode-charts-red': '#e51400',
    '--vscode-widget-shadow': 'rgba(0,0,0,0.16)',
    '--vscode-editor-font-family': 'Menlo, Monaco, monospace',
  },
}

/* ---------- 页内的假桥（宿主半的替身） ---------- */

const BRIDGE = `
(() => {
  const state = { messages: [], copyOk: true }
  globalThis.__smoke = state
  globalThis.__DSH_ONE_VSCODE__ = {
    postMessage(message) {
      state.messages.push(message)
      if (message && message.type === 'installGuide:copy') {
        // 与真宿主同一路径：宿主算好命令写剪贴板，再把结果回给页面。
        setTimeout(() => {
          window.dispatchEvent(new MessageEvent('message', { data: { type: 'installGuide:copied', ok: state.copyOk } }))
        }, 10)
      }
    },
  }
})()
`

/* ---------- 颜色与对比度（只算，不引第三方） ---------- */

function rgb(text) {
  const value = (text ?? '').trim()
  const hex = /^#([0-9a-f]{6})$/i.exec(value)
  if (hex !== null) {
    const n = Number.parseInt(hex[1], 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(value)
  return m === null ? null : [Number(m[1]), Number(m[2]), Number(m[3])]
}
function luminance([r, g, b]) {
  const channel = (v) => {
    const x = v / 255
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}
function contrast(fg, bg) {
  const a = luminance(fg)
  const b = luminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/* ---------- 开页 ---------- */

const pageFile = path.join(OUT, `page.${LOCALE}.html`)
const pageUrl = `file://${pageFile}`

/**
 * VS Code 给 webview 的默认样式（内置 defaultStyles 里的那一条）：状态页自己不设
 * 背景色，靠宿主给的那块底——冒烟里补上，页面才跟真 webview 里长得一样。
 */
const WEBVIEW_BASE_CSS = 'body { background-color: var(--vscode-editor-background); }'

async function openPage(browser, theme, viewport, options = {}) {
  const { url = pageUrl, webviewBase = false } = options
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 })
  await context.addInitScript({ content: BRIDGE })
  const page = await context.newPage()
  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.goto(url)
  await page.addStyleTag({ content: themeCss(theme) })
  if (webviewBase) await page.addStyleTag({ content: WEBVIEW_BASE_CSS })
  return { context, page, errors }
}

function themeCss(theme) {
  const vars = Object.entries(THEMES[theme])
    .map(([name, value]) => `${name}: ${value};`)
    .join('\n  ')
  return `:root {\n  ${vars}\n}`
}

const screenshot = (page, name) => page.screenshot({ path: path.join(OUT, `${LOCALE}-${name}.png`) })

/* ---------- 一档主题的完整交互与外观断言 ---------- */

async function runTheme(browser, theme) {
  const { context, page, errors } = await openPage(browser, theme, { width: 900, height: 780 })
  const body = page.locator('body')
  const picker = page.locator('#picker')
  const menu = page.locator('#menu')
  const cmd = page.locator('#cmd')
  const copy = page.locator('#copy')
  const messages = () => page.evaluate(() => globalThis.__smoke.messages)
  const setCopyOk = (ok) => page.evaluate((value) => (globalThis.__smoke.copyOk = value), ok)

  /* hero：居中大标题 + 副标题，没有网站式导航 */
  const h1 = page.locator('h1')
  const heroBox = await h1.boundingBox()
  const pageBox = await page.locator('.page').boundingBox()
  const fontSize = Number.parseFloat(await h1.evaluate((el) => getComputedStyle(el).fontSize))
  check(`${theme}：hero 大标题是「${T('Install dsh')}」`, (await h1.textContent()).trim() === T('Install dsh'))
  check(`${theme}：hero 大字（>=22px）`, fontSize >= 22, `font-size=${fontSize}px`)
  check(
    `${theme}：hero 横向居中（标题中心与内容中心重合）`,
    Math.abs(heroBox.x + heroBox.width / 2 - (pageBox.x + pageBox.width / 2)) <= 8,
    `标题中心=${Math.round(heroBox.x + heroBox.width / 2)} 内容中心=${Math.round(pageBox.x + pageBox.width / 2)}`,
  )
  check(`${theme}：有副标题一行`, (await page.locator('.hero-lead').textContent()).trim().length > 0)
  check(`${theme}：没有网站式顶部导航`, (await page.locator('nav').count()) === 0)
  eq(`${theme}：<html lang> 跟界面语言一致（字体回退与读屏用）`, await page.evaluate(() => document.documentElement.lang), LOCALE)

  /* 安装一行：主按钮 + 下拉箭头（收起）+ 同行命令胶囊 */
  check(`${theme}：主按钮文案「${T('Install dsh')}」且带下拉箭头`, (await picker.locator('svg').count()) === 1 && (await picker.textContent()).includes(T('Install dsh')))
  check(`${theme}：下拉初始收起`, !(await menu.isVisible()) && (await picker.getAttribute('aria-expanded')) === 'false')
  eq(`${theme}：命令胶囊显示宿主平台的命令`, (await cmd.textContent()).trim(), installCommandFor('macos'))

  /* 命令胶囊的排版：等宽 + 单行省略 */
  const cmdStyle = await cmd.evaluate((el) => {
    const s = getComputedStyle(el)
    return { whiteSpace: s.whiteSpace, textOverflow: s.textOverflow, overflow: s.overflow, font: s.fontFamily }
  })
  check(
    `${theme}：命令等宽字体 + 单行省略`,
    cmdStyle.whiteSpace === 'nowrap' && cmdStyle.textOverflow === 'ellipsis' && cmdStyle.overflow === 'hidden' && /mono/i.test(cmdStyle.font),
    JSON.stringify(cmdStyle),
  )

  /* 下拉：平台项（命令相同的平台合成一项）+ 选中态 */
  await picker.click()
  check(`${theme}：点主按钮开出下拉`, (await menu.isVisible()) && (await picker.getAttribute('aria-expanded')) === 'true')
  const itemSelectors = 'button[role="menuitemradio"]'
  const labels = await page.locator(`${itemSelectors} .menu-label`).allTextContents()
  eq(`${theme}：平台项按命令分叉合成（${installPlatformItems().map((i) => i.label).join(' / ')}）`, labels, installPlatformItems().map((item) => item.label))
  const checked = await page.locator(`${itemSelectors}[aria-checked="true"]`).count()
  check(`${theme}：只有一项带 ✓ 选中态`, checked === 1, `aria-checked=true 的项数=${checked}`)
  check(
    `${theme}：✓ 落在宿主平台那一项上`,
    await page.locator(`${itemSelectors}[data-os="${installPlatformItems()[1].os}"][aria-checked="true"]`).isVisible(),
  )
  check(
    `${theme}：未选中项留出 ✓ 的空位（切换时文字不跳）`,
    !(await page.locator(`${itemSelectors}[aria-checked="false"] .tick`).first().isVisible()),
  )
  check(`${theme}：外链项带 ↗ 图标（右侧）`, await page.locator('button[data-action="docs"] svg.ext').isVisible())
  await screenshot(page, `${theme}-menu`)

  /* 选平台：命令即时更换（命令仍由宿主现算，页面只回平台名） */
  await page.locator(`${itemSelectors}[data-os="windows"]`).click()
  eq(`${theme}：选 Windows 后命令换成该平台的`, (await cmd.textContent()).trim(), installCommandFor('windows'))
  check(`${theme}：选完自动收起下拉并把焦点还给主按钮`, !(await menu.isVisible()) && (await page.evaluate(() => document.activeElement?.id)) === 'picker')
  check(
    `${theme}：✓ 跟着移到新平台`,
    (await page.locator(`${itemSelectors}[data-os="windows"][aria-checked="true"]`).count()) === 1,
  )
  const tickVisible = await page
    .locator(`${itemSelectors}[data-os="windows"] .tick`)
    .evaluate((el) => getComputedStyle(el).visibility)
  check(`${theme}：新平台的 ✓ 真的显示出来`, tickVisible === 'visible', `visibility=${tickVisible}`)

  /* 关闭方式：Esc 与点外部 */
  await picker.click()
  await page.keyboard.press('Escape')
  check(`${theme}：Esc 关闭下拉并把焦点还给主按钮`, !(await menu.isVisible()) && (await page.evaluate(() => document.activeElement?.id)) === 'picker')
  await picker.click()
  await page.locator('h1').click()
  check(`${theme}：点下拉外部关闭`, !(await menu.isVisible()))

  /* 复制：页面只回平台名，命令文本不出现在消息里；成功/失败都有反馈 */
  await copy.click()
  const copyMessages = (await messages()).filter((m) => m.type === 'installGuide:copy')
  eq(`${theme}：复制消息只有类型与平台名（命令不搬进页面）`, copyMessages, [{ type: 'installGuide:copy', os: 'windows' }])
  check(
    `${theme}：消息里不含任何命令文本`,
    !JSON.stringify(await messages()).includes('curl -fsSL') && !JSON.stringify(await messages()).includes('irm '),
  )
  await page.waitForFunction(() => document.getElementById('copy').dataset.state === 'ok')
  eq(`${theme}：复制成功 → ✓ 图标态`, await copy.getAttribute('data-state'), 'ok')
  eq(`${theme}：复制成功 → 朗读区报「${T('Copied')}」`, (await page.locator('#copy-status').textContent()).trim(), T('Copied'))
  await page.waitForFunction(() => document.getElementById('copy').dataset.state === 'idle', null, { timeout: 4000 })
  check(`${theme}：反馈过一会儿自动回到空闲态`, (await page.locator('#copy-status').textContent()).trim() === '')

  await setCopyOk(false)
  await copy.click()
  await page.waitForFunction(() => document.getElementById('copy').dataset.state === 'fail')
  eq(`${theme}：复制失败 → × 图标态`, await copy.getAttribute('data-state'), 'fail')
  eq(`${theme}：复制失败 → 朗读区报「${T('Copy failed')}」`, (await page.locator('#copy-status').textContent()).trim(), T('Copy failed'))
  await setCopyOk(true)
  await page.waitForFunction(() => document.getElementById('copy').dataset.state === 'idle', null, { timeout: 4000 })

  /* 下拉里的外链项：动作回宿主（页面不自己开窗口） */
  await picker.click()
  await page.locator('button[data-action="docs"]').click()
  check(`${theme}：点外链项发出打开文档的动作`, (await messages()).some((m) => m.type === 'installGuide:openDocs'))
  check(`${theme}：点外链项后下拉收起`, !(await menu.isVisible()))
  await screenshot(page, `${theme}-terminal`)

  /* 分段控件：两段页内切换，不整页跳转 */
  check(`${theme}：默认在「${T('Terminal install')}」段`, await page.locator('#panel-terminal').isVisible())
  check(`${theme}：「${T('Editor setup')}」段初始收起`, !(await page.locator('#panel-editor').isVisible()))
  const steps = await page.locator('#panel-terminal .steps li').allTextContents()
  check(`${theme}：终端段有安装步骤（${steps.length} 步）`, steps.length === 3, steps.join(' | '))
  await page.locator('#tab-editor').click()
  check(
    `${theme}：切到编辑器段（两段互斥、主按钮与命令条仍在）`,
    (await page.locator('#panel-editor').isVisible()) &&
      !(await page.locator('#panel-terminal').isVisible()) &&
      (await cmd.isVisible()),
  )
  eq(`${theme}：分段控件的选中态跟着切换`, await page.locator('#tab-editor').getAttribute('aria-selected'), 'true')
  await page.locator('#open-web').click()
  check(`${theme}：编辑器段的「${T('Open dsh web')}」入口发出打开动作`, (await messages()).some((m) => m.type === 'installGuide:openWeb'))
  await screenshot(page, `${theme}-editor`)

  /* 主题：背景是编辑器主题色，文字对比度按主题变量算得出来 */
  await page.locator('#tab-terminal').click()
  const palette = THEMES[theme]
  const bg = await body.evaluate((el) => getComputedStyle(el).backgroundColor)
  eq(`${theme}：页面背景＝编辑器主题背景`, rgb(bg), rgb(palette['--vscode-editor-background']))
  const pillBg = await page.locator('.cmd-pill').evaluate((el) => getComputedStyle(el).backgroundColor)
  check(`${theme}：命令胶囊是与背景可分辨的一块面`, rgb(pillBg) !== null && rgb(pillBg).join() !== rgb(bg).join(), `pill=${pillBg} body=${bg}`)
  const pairs = [
    ['hero 大标题', 'h1', 4.5],
    ['命令文本', '#cmd', 4.5],
    ['主按钮文字', '#picker', 4.5],
    ['编辑器段入口按钮', '#open-web', 4.5],
    ['副标题（次要文字）', '.hero-lead', 3],
    ['脚本来源说明（小字）', '.install .fine', 3],
  ]
  for (const [name, selector, min] of pairs) {
    const color = await page.locator(selector).evaluate((el) => getComputedStyle(el).color)
    const surface =
      selector === '#picker'
        ? await page.locator('#picker').evaluate((el) => getComputedStyle(el).backgroundColor)
        : selector === '#open-web'
          ? await page.locator('#open-web').evaluate((el) => getComputedStyle(el).backgroundColor)
          : bg
    const ratio = contrast(rgb(color), rgb(surface))
    check(`${theme}：${name} 对比度 >= ${min}`, ratio >= min, `${ratio.toFixed(2)}:1（${color} on ${surface}）`)
    fact(`${theme} ${name} 对比度 ${ratio.toFixed(2)}:1`)
  }
  fact(`${theme} 页面背景 ${bg}，命令胶囊 ${pillBg}`)

  check(`${theme}：控制台零 error`, errors.length === 0, errors.join(' | '))
  await context.close()
}

/* ---------- 窄面板（编辑器 tab 被拖窄）也要能用 ---------- */

async function runNarrow(browser, theme) {
  const { context, page } = await openPage(browser, theme, { width: 420, height: 780 })
  const pickerBox = await page.locator('#picker').boundingBox()
  const pillBox = await page.locator('.cmd-pill').boundingBox()
  check(
    `${theme} 窄面板：命令胶囊换到主按钮下一行（不挤成两条）`,
    pillBox.y >= pickerBox.y + pickerBox.height - 2,
    `picker.y=${Math.round(pickerBox.y)} pill.y=${Math.round(pillBox.y)}`,
  )
  check(
    `${theme} 窄面板：命令仍是单行（不折成两行）`,
    Math.abs(pillBox.height - pickerBox.height) < 12,
    `pill.h=${Math.round(pillBox.height)} picker.h=${Math.round(pickerBox.height)}`,
  )
  const copyVisible = await page.locator('#copy').isVisible()
  const copyBox = await page.locator('#copy').boundingBox()
  check(
    `${theme} 窄面板：复制图标仍在胶囊内可见`,
    copyVisible && copyBox.x + copyBox.width <= pillBox.x + pillBox.width + 1,
    `copy.right=${Math.round(copyBox.x + copyBox.width)} pill.right=${Math.round(pillBox.x + pillBox.width)}`,
  )
  await screenshot(page, `${theme}-narrow`)
  await context.close()
}

/* ---------- 侧栏状态页（#101 起纳入常驻覆盖）：三态各自画一遍 ---------- */

/** 详情样本：真实启动错误里可能出现尖括号与 &，页面必须当文本显示而不是当标签渲染。 */
const RAW_ERROR = 'Failed to launch dsh: <stdout> & <stderr> unreadable'

/** 装配失败的样本（拉清单失败）：它出现在那句说明里，不再单独一块。 */
const ASSEMBLY_ERROR = 'GET /: HTTP 500'

/**
 * 状态页要渲染的几态。前四条走真实的分流判定（`decideSidebarStatus`）——于是
 * 「三态分流没变」也跟着一起被钉住；最后一条「装配失败」不是分流判定的产物，
 * 是装配流程失败后的落点（`assemblyFailureView`），另给一条。
 *
 * 每条只写「当时宿主侧是什么状态」和「页面上该出现什么」；页面的 HTML 由
 * `sidebarStatusHtml()` 现出（真实宿主代码，文案走 `l10n.t`）。
 */
const STATUS_CASES = [
  {
    id: 'not-installed',
    name: '未安装',
    host: { state: 'error', reason: 'dshNotFound', error: 'dsh not found' },
    decision: { kind: 'notInstalled' },
    title: T('dsh is not installed'),
    hint: T('Install it and come back here to start automatically.'),
    button: { label: T('View install guide'), message: 'assembly:openInstallGuide' },
  },
  {
    id: 'starting',
    name: '服务启动中',
    host: { state: 'starting' },
    decision: { kind: 'serviceDown', starting: true },
    hint: T('Starting the dsh service…'),
    note: T('The first start may take a while (preparing profiles and dependencies).'),
  },
  {
    id: 'not-running',
    name: '服务未运行',
    host: { state: 'stopped' },
    decision: { kind: 'serviceDown', starting: false },
    hint: T('The dsh service is not running. Start it to load this sidebar.'),
    button: { label: T('Start the dsh service'), message: 'assembly:start' },
  },
  {
    id: 'start-failed',
    name: '服务启动失败（带详情）',
    host: { state: 'error', error: RAW_ERROR },
    decision: { kind: 'serviceDown', starting: false, detail: RAW_ERROR },
    hint: T('The dsh service is not running. Start it to load this sidebar.'),
    detail: RAW_ERROR,
    button: { label: T('Start the dsh service'), message: 'assembly:start' },
  },
  {
    id: 'assembly-failed',
    name: '装配失败',
    // 服务在跑却装不起来（清单拉取失败 / mirror 起不来）：不是分流判定的产物。
    view: () => assemblyFailureView({ state: 'running', url: 'http://127.0.0.1:3080' }, ASSEMBLY_ERROR),
    hint: T('DSH sidebar failed to load: {0}', ASSEMBLY_ERROR),
    button: { label: T('Retry'), message: 'assembly:retry' },
  },
  {
    id: 'chat-panel-not-running',
    name: '对话面板恢复·服务未运行',
    // #169：恢复出来的对话面板装不起来时画的是同一份状态页，只是文案按面板说
    // （`surface: 'chatPanel'`），且面板上给得出「启动服务」这一步。
    host: { state: 'stopped' },
    view: () => ({ kind: 'serviceDown', starting: false }),
    surface: 'chatPanel',
    hint: T('The dsh service is not running. Start it to load this chat panel.'),
    button: { label: T('Start the dsh service'), message: 'assembly:start' },
  },
  {
    id: 'chat-panel-assembly-failed',
    name: '对话面板恢复·装配失败',
    view: () => assemblyFailureView({ state: 'running', url: 'http://127.0.0.1:3080' }, ASSEMBLY_ERROR),
    surface: 'chatPanel',
    hint: T('DSH chat panel failed to load: {0}', ASSEMBLY_ERROR),
    button: { label: T('Retry'), message: 'assembly:retry' },
  },
]

const statusPageFile = (id) => path.join(OUT, `status.${LOCALE}.${id}.html`)
const statusPageUrl = (id) => `file://${statusPageFile(id)}`

/** 这一态要渲染的页面内容（装配失败那条直接给 `assemblyFailureView` 的产物）。 */
const statusViewOf = (entry) => (entry.view !== undefined ? entry.view() : decideSidebarStatus(entry.host))

/** 分流断言（与浏览器无关，跑一次）：每条宿主状态判到它该落的那一态。 */
function checkStatusDecisions() {
  for (const entry of STATUS_CASES) {
    if (entry.decision === undefined) continue
    eq(`状态页分流：${entry.name}`, decideSidebarStatus(entry.host), entry.decision)
  }
}

/** 一档主题下把一个状态画出来、逐项看它长什么样。 */
async function runStatusCase(browser, theme, entry) {
  const { context, page, errors } = await openPage(browser, theme, { width: 360, height: 420 }, {
    url: statusPageUrl(entry.id),
    webviewBase: true,
  })
  const palette = THEMES[theme]
  const label = `状态页 ${theme} ${entry.name}`
  const text = async (selector) => (await page.locator(selector).textContent()).trim()
  const count = (selector) => page.locator(selector).count()

  /* 文案：标题只有「未安装」有，说明每态都有，次要提示与详情各按该态给。 */
  check(`${label}：${entry.title === undefined ? '不出现标题' : `标题「${entry.title}」`}`, (await count('.title')) === (entry.title === undefined ? 0 : 1) && (entry.title === undefined || (await text('.title')) === entry.title))
  eq(`${label}：说明文案`, await text('.hint'), entry.hint)
  check(`${label}：${entry.note === undefined ? '没有多余的次要提示' : '次要提示是「首次启动较慢」那一句'}`, (await count('.note')) === (entry.note === undefined ? 0 : 1) && (entry.note === undefined || (await text('.note')) === entry.note))
  if (entry.detail === undefined) {
    check(`${label}：没有详情块`, (await count('.detail')) === 0)
  } else {
    // 详情来自错误字符串：原样显示（不是被吃掉的富文本），且只能当文本——注入不得生效。
    check(
      `${label}：详情原样显示且当文本渲染（尖括号与 & 不被当成标签）`,
      (await text('.detail')) === entry.detail && (await count('.detail *')) === 0,
      `text=${await text('.detail')}`,
    )
    check(`${label}：详情是等宽字体的独立块（眼能分辨出这是诊断输出）`, /mono/i.test(await page.locator('.detail').evaluate((el) => getComputedStyle(el).fontFamily)) && (await page.locator('.detail').evaluate((el) => getComputedStyle(el).borderLeftWidth)) === '2px')
  }

  /* 动作：能点的只有该态那一个（启动中/未安装等按内容给），消息回宿主。 */
  if (entry.button === undefined) {
    check(`${label}：不给动作按钮（这一态没有可点的下一步）`, (await count('#dsh-action')) === 0)
  } else {
    eq(`${label}：动作按钮文案`, await text('#dsh-action'), entry.button.label)
    await page.locator('#dsh-action').click()
    eq(`${label}：动作按钮把 ${entry.button.message} 发回宿主`, await page.evaluate(() => globalThis.__smoke.messages), [{ type: entry.button.message }])
  }

  /* 明暗两态：背景是编辑器主题色（页面自己不设背景，靠宿主那块底），文字看得清。 */
  const bg = await page.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor)
  eq(`状态页 ${theme} [${entry.id}]：整页背景＝编辑器主题背景`, rgb(bg), rgb(palette['--vscode-editor-background']))
  const pairs = [
    ['说明文字', '.hint', 4.5],
    ...(entry.title === undefined ? [] : [['标题', '.title', 4.5]]),
    ...(entry.note === undefined ? [] : [['次要提示（小字）', '.note', 3]]),
  ]
  for (const [name, selector, min] of pairs) {
    const color = await page.locator(selector).evaluate((el) => getComputedStyle(el).color)
    const ratio = contrast(rgb(color), rgb(bg))
    check(`状态页 ${theme} [${entry.id}]：${name}与背景的明暗差 >= ${min}`, ratio >= min, `${ratio.toFixed(2)}:1（${color} on ${bg}）`)
    fact(`状态页 ${theme} [${entry.id}] ${name} 明暗差 ${ratio.toFixed(2)}:1`)
  }
  if (entry.button !== undefined) {
    const surface = await page.locator('#dsh-action').evaluate((el) => getComputedStyle(el).backgroundColor)
    const color = await page.locator('#dsh-action').evaluate((el) => getComputedStyle(el).color)
    const ratio = contrast(rgb(color), rgb(surface))
    check(`状态页 ${theme} [${entry.id}]：动作按钮文字与按钮底色的明暗差 >= 4.5`, ratio >= 4.5, `${ratio.toFixed(2)}:1（${color} on ${surface}）`)
    fact(`状态页 ${theme} [${entry.id}] 动作按钮文字 明暗差 ${ratio.toFixed(2)}:1`)
  }

  check(`状态页 ${theme} [${entry.id}]：控制台干净（没有 error）`, errors.length === 0, errors.join(' | '))
  await screenshot(page, `${theme}-status-${entry.id}`)
  await context.close()
}

/* ---------- 报告条目：把逐条断言折成「人看截图能逐条对照」的几项 ---------- */

/**
 * 报告条目（合入门禁那份报告用的形状，见 `test/sandbox/report.mjs`）：每项给一段
 * 「看到什么」的期望 + 相关截图，人在报告里逐项对照。断言按标签里的关键词归到条目，
 * 归不掉的断言会单独列成一项并判失败——归类漏了不会静默。
 *
 * **顺序有讲究**：按序取第一个模式命中的条目，所以状态页那几项（SP-*，标签里一律
 * 带「状态页」）放在安装引导页（IG-*）前面——否则 IG 的通用模式（`/对比度/`、
 * `/主按钮/` 之类）会把状态页的断言抢走。报告里仍按阶段排序（新增在前，回归在后）。
 */
const ITEM_SPECS = [
  {
    id: 'SP-07',
    phase: 'regression',
    name: '对话面板恢复：装不起来时画的是状态页而不是空白',
    expect:
      '窗口重载后恢复出来的对话面板装不起来时（服务没在跑 / 装配失败），面板里是同一份状态页——文案按面板说（「dsh 服务没在运行。启动服务后这个对话面板才会加载。」/「DSH 对话面板装配失败：…」），按钮是「启动 dsh 服务」与「重试」，动作与侧栏那套同名。',
    // 这条必须排在 SP-01..SP-06 前面：那几项的模式（/未运行/、/装配失败/、/明暗差/…）
    // 是通用词，会先把它这几条断言抢走。
    patterns: [/对话面板恢复/],
    shots: ['-status-chat-panel-not-running', '-status-chat-panel-assembly-failed'],
  },
  {
    id: 'SP-01',
    phase: 'regression',
    name: '状态页「未安装」：标题 + 说明 + 查看安装指南',
    expect:
      'dsh 没装时侧栏位上是这一态：一行标题「dsh 尚未安装」，下面一行灰色说明（装完回来自动开始），再下面一个「查看安装指南」按钮；按钮回宿主的是打开安装引导 tab 的动作。',
    patterns: [/未安装/],
    shots: ['-status-not-installed'],
  },
  {
    id: 'SP-02',
    phase: 'regression',
    name: '状态页「服务启动中」：进度文案 + 首次启动提示，不给按钮',
    expect:
      '服务正在启动时是这一态：说明「正在启动 dsh 服务…」，下面一行小字说明第一次启动要准备 profile 与依赖、会慢一些；这一态没有可点的按钮（再点一次没有意义）。',
    patterns: [/启动中/],
    shots: ['-status-starting'],
  },
  {
    id: 'SP-03',
    phase: 'regression',
    name: '状态页「服务未运行」：说明 + 启动按钮',
    expect:
      '服务没在跑时是这一态：说明「dsh 服务没有运行，启动它才能加载这个侧栏」，下面一个「启动 dsh 服务」按钮；按钮回宿主的是启动动作。',
    patterns: [/未运行/],
    shots: ['-status-not-running'],
  },
  {
    id: 'SP-04',
    phase: 'regression',
    name: '状态页「服务启动失败」：错误详情原样显示且只当文本',
    expect:
      '启动失败（例如端口上是一个需要 token 的认证实例）时，除了启动按钮还给一段等宽的详情块，里面是原样的错误文字——错误里带尖括号或 & 也照原样显示成文字，不会被当成标签渲染。',
    patterns: [/启动失败/, /详情/],
    shots: ['-status-start-failed'],
  },
  {
    id: 'SP-05',
    phase: 'regression',
    name: '状态页「装配失败」：服务在跑却装不起来 + 重试',
    expect:
      '服务在跑但装配失败（拉清单/代理起不来）时是这一态：说明里带上失败原因，下面一个「重试」按钮；按钮回宿主的是重跑装配的动作。',
    patterns: [/装配失败/],
    shots: ['-status-assembly-failed'],
  },
  {
    id: 'SP-06',
    phase: 'regression',
    name: '状态页明暗两态：背景＝编辑器主题色、文字看得清',
    expect:
      '浅色与深色主题下各看一遍每个状态：整页背景是编辑器主题背景（状态页自己不设背景色，靠宿主那块底），说明文字/标题/小字/按钮在这块底上都看得清（正文 >=4.5:1，小字 >=3:1）。',
    patterns: [/主题背景/, /明暗差/, /控制台干净/],
    shots: [
      '-status-not-installed',
      '-status-starting',
      '-status-not-running',
      '-status-start-failed',
      '-status-assembly-failed',
    ],
  },
  {
    id: 'IG-01',
    phase: 'new-feature',
    name: 'hero：居中大标题 + 副标题，没有网站式导航',
    expect:
      '页面顶部是一行居中大标题「安装 dsh」，下面一行灰色副标题（两行内），四周留白充足；顶部没有会员权益/文档/控制台那一类网站导航条。',
    patterns: [/hero/, /副标题/, /顶部导航/, /<html lang>/],
    shots: ['-terminal'],
  },
  {
    id: 'IG-02',
    phase: 'new-feature',
    name: '一键安装命令行：主按钮 + 同行命令胶囊',
    expect:
      '一行里左侧是深色主按钮「安装 dsh ▾」（下拉收起时也带箭头），右侧同一行是命令胶囊：等宽字体、单行省略（长了出省略号，不折行），命令是宿主平台那一条。',
    patterns: [/主按钮/, /下拉初始收起/, /命令胶囊显示/, /命令等宽/],
    shots: ['-terminal'],
  },
  {
    id: 'IG-03',
    phase: 'new-feature',
    name: '下拉菜单：平台项（✓ 选中态）+ 外链项（↗）',
    expect:
      '点「安装 dsh ▾」开出一个浮层菜单：上面是平台项，命令相同的平台合成一项（macOS / Linux 一条、Windows 一条），当前平台左侧有 ✓ 且加粗，未选中项留着同宽空位；下面是分隔线与「官方安装文档 ↗」；点菜单外部、按 Esc 都能关掉，Esc 关闭后焦点回主按钮。',
    patterns: [/开出下拉/, /平台项按命令分叉合成/, /只有一项带/, /✓ 落在/, /未选中项留出/, /外链项带/, /Esc 关闭/, /点下拉外部/, /点外链项后下拉收起/, /点外链项发出/],
    shots: ['-menu'],
  },
  {
    id: 'IG-04',
    phase: 'new-feature',
    name: '换平台：命令即时更换、选中态跟着走',
    expect:
      '在菜单里选另一个平台后，菜单收起、右侧命令立刻换成该平台的命令（不用刷新页面），✓ 移到新平台那一项。',
    patterns: [/选 Windows 后命令/, /选完自动收起/, /✓ 跟着移到/, /新平台的 ✓/],
    shots: ['-terminal'],
  },
  {
    id: 'IG-05',
    phase: 'new-feature',
    name: '复制：命令不走页面，成功/失败都有反馈',
    expect:
      '点命令条右侧的复制图标：宿主把命令写进系统剪贴板，图标短暂变成 ✓（朗读区报「已复制」），约两秒后回到空闲；宿主复制失败时变成 ×（报「复制失败」）。发回宿主的消息里只有平台名，没有命令文本（命令始终由宿主现算）。',
    patterns: [/复制消息只有/, /消息里不含/, /复制成功/, /复制失败/, /反馈过一会儿/],
    shots: ['-terminal'],
  },
  {
    id: 'IG-06',
    phase: 'new-feature',
    name: '分段控件：终端安装 / 编辑器接入',
    expect:
      '安装行下面是一个胶囊式分段控件，默认选中「终端安装」，内容是该段的三步说明（同一页内切换，不整页跳转）；切到「编辑器接入」后换成「装完回侧栏即可用」的说明与「打开 dsh web ↗」入口，主按钮与命令条仍在。',
    patterns: [/默认在/, /段初始收起/, /终端段有安装步骤/, /切到编辑器段/, /分段控件的选中态/, /打开动作/],
    shots: ['-editor'],
  },
  {
    id: 'IG-07',
    phase: 'new-feature',
    name: '明暗两态：背景是编辑器主题色，文字对比度达标',
    expect:
      '浅色与深色主题下各看一遍：页面背景是编辑器主题背景（不是固定白底），命令胶囊是与背景可分辨的一块面，标题/命令/按钮/次要文字都看得清（正文对比度 >=4.5:1，次要小字 >=3:1）。',
    patterns: [/页面背景/, /命令胶囊是与背景/, /对比度/],
    shots: ['-terminal', '-editor'],
  },
  {
    id: 'IG-08',
    phase: 'new-feature',
    name: '窄面板：命令胶囊换行、仍是单行、复制图标不丢',
    expect:
      '把编辑器 tab 拖窄（420px）后，命令胶囊换到主按钮下一行，命令仍是单行省略不折行，复制图标仍在胶囊内可见。',
    patterns: [/窄面板/],
    shots: ['-narrow'],
  },
  {
    id: 'IG-09',
    phase: 'new-feature',
    name: '页面干净：控制台零 error',
    expect: '整轮交互（开合菜单、换平台、复制、切段）后控制台没有 error。',
    patterns: [/控制台零 error/],
    shots: [],
  },
]

/** 断言 → 报告条目；归不掉的单列一项并判失败（归类漏了不静默）。 */
function reportItems() {
  const buckets = ITEM_SPECS.map((spec) => ({ spec, own: [] }))
  const orphans = []
  for (const entry of checks) {
    const bucket = buckets.find(({ spec }) => spec.patterns.some((pattern) => pattern.test(entry.label)))
    if (bucket === undefined) orphans.push(entry)
    else bucket.own.push(entry)
  }
  const items = buckets.map(({ spec, own }) => ({
    id: spec.id,
    phase: spec.phase,
    name: spec.name,
    expect: spec.expect,
    result: own.every((entry) => entry.ok) ? 'pass' : 'fail',
    screenshots: ['light', 'dark'].flatMap((theme) =>
      spec.shots.map((suffix) => path.join(OUT, `${LOCALE}-${theme}${suffix}.png`)),
    ),
    notes: own
      .filter((entry) => !entry.ok)
      .map((entry) => `✗ ${entry.label}${entry.detail === '' ? '' : `（${entry.detail}）`}`)
      .join('\n'),
  }))
  if (orphans.length > 0) {
    items.push({
      id: 'IG-00',
      phase: 'new-feature',
      name: '未归类的断言（harness 归类漏了）',
      expect: '每条断言都该归到上面某一项；出现本项说明 smoke.mjs 的 ITEM_SPECS 要补。',
      result: 'fail',
      screenshots: [],
      notes: orphans.map((entry) => `- ${entry.label}`).join('\n'),
    })
  }
  // 报告里按阶段排（新增功能在前、现有功能回归在后）；ITEM_SPECS 的顺序另有讲究，见其注释。
  return items.sort((a, b) => (a.phase === b.phase ? 0 : a.phase === 'new-feature' ? -1 : 1))
}

/* ---------- 主流程 ---------- */

async function main() {
  await fsp.mkdir(OUT, { recursive: true })
  await fsp.writeFile(pageFile, installGuideHtml(HOST_OS), 'utf8')
  for (const entry of STATUS_CASES) {
    await fsp.writeFile(
      statusPageFile(entry.id),
      sidebarStatusHtml(statusViewOf(entry), { surface: entry.surface ?? 'sidebar' }),
      'utf8',
    )
  }
  checkStatusDecisions()
  const browser = await chromium.launch({ headless: process.env.SMOKE_HEADED !== '1' })
  try {
    for (const theme of ['light', 'dark']) {
      await runTheme(browser, theme)
      await runNarrow(browser, theme)
      for (const entry of STATUS_CASES) await runStatusCase(browser, theme, entry)
    }
  } finally {
    await browser.close()
  }

  const passed = checks.filter((c) => c.ok).length
  const shots = (await fsp.readdir(OUT)).filter((f) => f.startsWith(`${LOCALE}-`) && f.endsWith('.png')).sort()
  const ledger = {
    suite: 'HOST-PAGES-SMOKE',
    locale: LOCALE,
    hostOs: HOST_OS,
    at: new Date().toISOString(),
    assertions: { total: checks.length, passed, failed: checks.length - passed },
    checks,
    facts,
    screenshots: shots,
  }
  await fsp.writeFile(path.join(OUT, `smoke.${LOCALE}.json`), `${JSON.stringify(ledger, null, 2)}\n`, 'utf8')

  // 合入门禁那份报告：按 `test/sandbox/report.mjs` 的形状产出条目（新增功能项在前）。
  const report = {
    title: `宿主侧页面浏览器冒烟（安装引导页 #105 + 侧栏状态页 #101，locale=${LOCALE}）`,
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    commit: git(['rev-parse', '--short', 'HEAD']),
    command: `npm run verify:install-guide${LOCALE === 'en' ? '' : `（SMOKE_LOCALE=${LOCALE}）`}`,
    environment: {
      mode: '浏览器（Playwright chromium，页面由真实宿主代码渲染，宿主侧是页内假桥）',
      网关: '不需要（这两页都不参与装配树）',
      locale: LOCALE,
      'theme 档': 'light + dark（VS Code 默认浅色/深色主题的 token 取值）',
      viewport: '安装引导页 900×780（窄面板档 420×780）、状态页 360×420（侧栏宽度）',
      date: new Date().toISOString(),
      断言: `${String(passed)}/${String(checks.length)} 通过`,
    },
    coverageNote:
      '不覆盖：真 VS Code webview 宿主层（CSP 实际执行、真剪贴板、原生菜单、主题跟随）、真 dsh 安装过程本身。' +
      '状态页跟随服务状态变化（#101）是宿主侧逻辑，不在浏览器里验——订阅的起停与重绘看 npm test 的 sidebarStatusPage.test.ts。' +
      '这两页都不参与装配树，装配侧回归看 `npm run verify:lab` 的报告。',
    items: reportItems(),
  }
  await fsp.writeFile(path.join(OUT, 'verify.install-guide.ledger.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  for (const line of facts) console.log(`  · ${line}`)
  for (const failed of checks.filter((c) => !c.ok)) console.log(`  ✗ ${failed.label}${failed.detail === '' ? '' : `（${failed.detail}）`}`)
  console.log(
    `\n[host-pages-smoke] locale=${LOCALE} 断言 ${String(checks.length)} 条，通过 ${String(passed)} 条；` +
      `条目 ${String(report.items.length)} 项（失败 ${String(report.items.filter((i) => i.result === 'fail').length)} 项）；` +
      `产物 ${path.relative(process.cwd(), OUT)}/{smoke.${LOCALE}.json, verify.install-guide.ledger.json, *.png}`,
  )
  if (passed !== checks.length) process.exitCode = 1
}

/** 取一个 git 信息（拿不到就留空，不让报告生成失败）。 */
function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

await main()
