#!/usr/bin/env node
/**
 * 安装引导页的浏览器冒烟（#105）：`npm run verify:install-guide`。
 *
 * 验的是**宿主侧那一页**（`src/ui/installGuide.ts` + `src/pure/installGuidePage.ts`）：
 * 页面由真实宿主代码渲染（`vscode` 模块由 `vscodeStub.mjs` 顶上），宿主侧则用页内
 * 的假桥（`__DSH_ONE_VSCODE__`，与 #100 同一口径）记录消息、回复制结果——于是
 * 「按钮 / 下拉（含选中态与外链）/ 命令随平台更换 / 复制成功与失败反馈 / 分段切换 /
 * 明暗两态」都能自动断言，并留一组截图给人工看。
 *
 * 这一页不参与装配树（dsh 未安装时网关起不来），所以它不在装配实验室（`test/assembly-lab/`）
 * 里，用本目录这组轻量 harness 单跑；跑前不需要网关。
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
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { installGuideHtml } from '../../src/ui/installGuide.ts'
import { installCommandFor } from '../../src/pure/installScript.ts'
import { installPlatformItems } from '../../src/pure/installGuidePage.ts'
import { l10n } from './vscodeStub.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, 'out')
const LOCALE = process.env.SMOKE_LOCALE ?? 'en'
/** 渲染用的宿主平台（已映射成 `HostOs`：`darwin` → `macos`）——默认选中「macOS / Linux」。 */
const HOST_OS = 'macos'

/** 文案一律按当前 locale 取（en 是基线，zh-cn 是译文）——断言不写死中文或英文。 */
const T = (key) => l10n.t(key)

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

async function openPage(browser, theme, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 })
  await context.addInitScript({ content: BRIDGE })
  const page = await context.newPage()
  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.goto(pageUrl)
  await page.addStyleTag({ content: themeCss(theme) })
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

/* ---------- 主流程 ---------- */

async function main() {
  await fsp.mkdir(OUT, { recursive: true })
  await fsp.writeFile(pageFile, installGuideHtml(HOST_OS), 'utf8')
  const browser = await chromium.launch({ headless: process.env.SMOKE_HEADED !== '1' })
  try {
    for (const theme of ['light', 'dark']) {
      await runTheme(browser, theme)
      await runNarrow(browser, theme)
    }
  } finally {
    await browser.close()
  }

  const passed = checks.filter((c) => c.ok).length
  const ledger = {
    suite: 'INSTALL-GUIDE-SMOKE',
    locale: LOCALE,
    hostOs: HOST_OS,
    at: new Date().toISOString(),
    assertions: { total: checks.length, passed, failed: checks.length - passed },
    checks,
    facts,
    screenshots: (await fsp.readdir(OUT)).filter((f) => f.startsWith(`${LOCALE}-`) && f.endsWith('.png')).sort(),
  }
  await fsp.writeFile(path.join(OUT, `smoke.${LOCALE}.json`), `${JSON.stringify(ledger, null, 2)}\n`, 'utf8')

  for (const line of facts) console.log(`  · ${line}`)
  for (const failed of checks.filter((c) => !c.ok)) console.log(`  ✗ ${failed.label}${failed.detail === '' ? '' : `（${failed.detail}）`}`)
  console.log(
    `\n[install-guide-smoke] locale=${LOCALE} 断言 ${String(checks.length)} 条，通过 ${String(passed)} 条；` +
      `产物 ${path.relative(process.cwd(), OUT)}/{smoke.${LOCALE}.json, *.png}`,
  )
  if (passed !== checks.length) process.exitCode = 1
}

await main()
