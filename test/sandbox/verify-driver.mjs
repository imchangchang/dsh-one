// verify-driver.mjs —— DSH One 沙盒 Playwright 确定性驱动脚本（CI/主线自动回归用）。
//
// 契约与用法见 test/sandbox/README.md「自动驱动（Playwright）」小节。
// 逐项执行 ledger 里带 `driver` 字段的条目：新建会话 → 发 prompt → 断 expectText → 截图 →
// 把该项 result 写回 ledger（done/fail）→ 写回 ledger 文件。不带 `driver` 的项跳过。
//
// 注意：本脚本在宿主侧用 Playwright 驱动 code-server 浏览器页面；沙盒内嵌的同源 webview
// iframe（`#active-frame`）会被宿主反复重建，所以对 frame 的操作必须**即时重新扫描**
// `page.frames()`，不能缓存 FrameHandle。
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))

// ── CLI 参数 ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
function argValue(name) {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : undefined
}
const ledgerPath = resolve(argValue('ledger') ?? resolve(SCRIPT_DIR, 'verify.ledger.json'))
const baseUrl = argValue('url') ?? 'http://127.0.0.1:8080'
const outDir = resolve(argValue('out') ?? '/tmp/dsh-sandbox-shots/')
const only = argValue('only') // 逗号分隔的 id 列表，可选
const headed = args.includes('--headed')
const keepOpen = args.includes('--keep-open') // 调试：最后不关浏览器

const WORKBENCH_TIMEOUT = 30_000
const EXPECT_TEXT_TIMEOUT = 120_000

// 注：mock-LLM 匹配器已过滤 dsh 首轮注入（<system-reminder> 包裹的上下文不算 user
// prompt），所以首条 ledger prompt 直接命中规则，无需暖场消息（历史坑：首轮注入曾
// 成为「最后一条 user 消息」，导致回显注入文本、规则首轮不命中）。

// ── ledger ──────────────────────────────────────────────────────────────────
const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
const items = Array.isArray(ledger.items) ? ledger.items : []

const onlySet = only ? new Set(only.split(',').map((s) => s.trim()).filter(Boolean)) : null
const run = items.filter((it) => {
  const hasDriver = typeof it.driver?.prompt === 'string' && typeof it.driver?.expectText === 'string'
  if (!hasDriver) return false // 无 driver 字段的项跳过
  if (onlySet && !onlySet.has(it.id)) return false
  return true
})

function saveLedger() {
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n', 'utf8')
}

// ── 通用工具 ────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 每调用都重新扫描 page.frames() 找满足 predicate 的新鲜 frame（帧会被宿主重建）。 */
async function findFrame(page, predicate, timeoutMs = 10_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    for (const f of page.frames()) {
      try {
        if (await predicate(f)) return f
      } catch {
        // 帧重建间隙瞬间查空，忽略继续重试
      }
    }
    await sleep(250)
  }
  return null
}

/** 会话列表侧边栏 webview 帧（含 .sessions-panel）。 */function isSessionsFrame(f) {
  return f.evaluate(() => !!document.querySelector('.sessions-panel')).catch(() => false)
}

/** 聊天 panel webview 帧（含 composer textarea#input）。 */
function isChatFrame(f) {
  return f.evaluate(() => !!document.querySelector('textarea#input')).catch(() => false)
}

/**
 * 新建一个会话并返回聊天 webview 帧。
 * 主路径：侧边栏「New ungrouped session」——不受 workspace 注册表状态影响，稳定可靠。
 *   背景：本沙盒把宿主 ~/.dsh 挂进容器，workspace 注册表带的是宿主路径（/Users/cgeng/…），
 *   容器内 session.create 打在这些 workspace 上会 mkdir '/Users' EACCES；未分组会话走 /tmp
 *   （容器可写），故为确定性可靠路径。
 * 后备：命令面板「New Session」（DSH One 真实命令；契约写的「New Chat」会命中 VS Code 内置
 *   Chat 而非 DSH One）——在 workspace 可解析的干净环境才命中 composer。
 */
async function newChatAndGetFrame(page) {
  // 主路径：侧边栏面板头部「New Chat (⌘N)」（随时可见，不依赖 hover 行揭示）
  for (const root of [page, ...page.frames()]) {
    try {
      const newBtn = root.locator('[aria-label^="New Chat"]').locator('visible=true').first()
      if ((await newBtn.count()) === 0) continue
      await newBtn.click({ timeout: 5_000 })
      const chat = await findFrame(page, isChatFrame, 30_000)
      if (chat) return { chat, source: 'pane-header New Chat' }
    } catch (e) {
      console.warn(`  [warn] 头部 New Chat 失败：${e.message}`)
    }
  }

  // 后备 1：Ungrouped 行 hover 揭示「New ungrouped session」按钮
  const sessions = await findFrame(page, isSessionsFrame, 10_000)
  if (sessions) {
    try {
      const urow = sessions.locator('.workspace-group[data-workspace-id="__ungrouped__"] .workspace-row').first()
      await urow.hover({ timeout: 15_000 })
      await sleep(400)
      const newBtn = sessions.locator('button.row-action[aria-label="New ungrouped session"]').first()
      await newBtn.click({ timeout: 15_000 })
      const chat = await findFrame(page, isChatFrame, 30_000)
      if (chat) return { chat, source: 'sidebar-ungrouped' }
    } catch (e) {
      console.warn(`  [warn] 侧边栏新建失败：${e.message}`)
    }
  }

  // 后备 2：命令面板 New Session
  await page.keyboard.press('Meta+Shift+P')
  await sleep(1500)
  await page.keyboard.type('New Session', { delay: 50 })
  await sleep(1200)
  await page.keyboard.press('Enter')
  const chat = await findFrame(page, isChatFrame, 12_000)
  if (chat) return { chat, source: 'palette-New Session' }

  throw new Error('未能打开聊天 composer（头部/侧边栏/命令面板均失败）')
}

/** 在聊天帧里填充 composer 并点 .send-button（帧会被重建，先重扫一次拿新鲜帧）。 */
async function sendPrompt(page, text) {
  const chat = await findFrame(page, isChatFrame, 30_000)
  if (!chat) throw new Error('composer 帧未出现')
  const ta = chat.locator('textarea#input')
  await ta.waitFor({ state: 'visible', timeout: 30_000 })
  await ta.click()
  await ta.fill(text)
  await sleep(200)
  await chat.locator('.send-button').click({ timeout: 15_000 })
}

/** 扫描全部 frame 等待 expectText 出现（每轮重扫，容忍宿主重建）。
 *  提问/审批面板会替换 composer（textarea#input 消失），不能用 isChatFrame 定位，
 *  直接全文搜索所有 frame。 */
async function waitForText(page, expectText, timeoutMs) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    for (const f of page.frames()) {
      try {
        const n = await f.locator('body').filter({ hasText: expectText }).count()
        if (n > 0) return true
      } catch {
        // 帧重建瞬间忽略
      }
    }
    await sleep(500)
  }
  return false
}

async function closeEditorTab(page) {
  // 关闭当前编辑器的 chat tab（Meta+W），避免串场
  await page.keyboard.press('Meta+W')
  await sleep(800)
}

// ── 执行 ────────────────────────────────────────────────────────────────────
mkdirSync(outDir, { recursive: true })
const browser = await chromium.launch({ headless: !headed })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })

let summary = { done: [], fail: [], skipped: items.length - run.length }
try {
  // 1. 打开 workbench
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForSelector('.monaco-workbench', { timeout: WORKBENCH_TIMEOUT })
  await sleep(3000)

  // 2. 点活动栏 DSH One
  await page.locator('a.action-label[aria-label="DSH One"]').first().click({ timeout: 15_000 })
  await sleep(4000)

  for (const item of run) {
    const { id, driver } = item
    console.log(`\n=== ${id}: "${driver.prompt}" → 期望 "${driver.expectText}" ===`)
    let result = 'done'
    const notes = []
    try {
      const { chat, source } = await newChatAndGetFrame(page)
      notes.push(`新建会话：${source}`)
      await sendPrompt(page, driver.prompt)
      const ok = await waitForText(page, driver.expectText, EXPECT_TEXT_TIMEOUT)
      if (!ok) {
        result = 'fail'
        notes.push(`断言超时（${EXPECT_TEXT_TIMEOUT / 1000}s）：预期文本「${driver.expectText}」未出现`)
      }
    } catch (err) {
      result = 'fail'
      notes.push(`执行异常：${err.message}`)
    }

    // 截图（整页可见区域，保证 webview iframe 内容渲染进截图）
    const shotPath = resolve(outDir, `${id}.png`)
    try {
      await page.screenshot({ path: shotPath })
    } catch (e) {
      notes.push(`截图失败：${e.message}`)
    }

    // 写回 ledger
    item.result = result
    if (notes.length) item.notes = notes.join('；')
    item.screenshots = [shotPath]
    saveLedger()

    if (result === 'done') summary.done.push(id)
    else summary.fail.push(id)
    console.log(`${id} → ${result}${notes.length ? `（${item.notes}）` : ''}`)

    // 关闭当前 chat tab，避免串场
    await closeEditorTab(page)
  }
} finally {
  if (!keepOpen) await browser.close()
}

// ── 汇总 ────────────────────────────────────────────────────────────────────
console.log('\n===== 汇总 =====')
console.log(`ledger: ${ledgerPath}`)
console.log(`共 ${run.length} 项执行；done=${summary.done.length}，fail=${summary.fail.length}，跳过=${summary.skipped}`)
if (summary.done.length) console.log(`done: ${summary.done.join(', ')}`)
if (summary.fail.length) console.log(`fail: ${summary.fail.join(', ')}`)
console.log(`截图目录: ${outDir}`)
