// verify-driver.mjs —— DSH One 沙盒 Playwright 确定性驱动脚本（CI/主线自动回归用）。
//
// 契约与用法见 test/sandbox/README.md「自动驱动（Playwright）」小节。
// 逐项执行 ledger 里带 `driver` 字段的条目：新建会话 → （按 driver 字段组合）发 prompt /
// 填草稿 / 点审批应答 / 点清空按钮 → 断 expectText / expectDraft → 截图 → 把该项 result
// 写回 ledger（done/fail）→ 写回 ledger 文件。不带 `driver` 的项跳过。
//
// driver 字段（除 prompt 外都可选，缺省走原有行为，向后兼容）：
//   prompt        发送给新会话的消息
//   expectText    等待 webview 中出现该文本（超时 120s）
//   afterSendFill 点发送后立刻把这段文本填进 composer（模拟发送后、pending 接管前
//                 正在输入：pending 帧接管时应把草稿暂存，应答后恢复）
//   approve       等待 pending 面板并点击按钮文本：字符串=单次（如审批 Allow once），
//                 数组=按序点击（如问答面板先选选项再点 Submit）
//   expectDraft   断言 composer textarea#input.value 包含该文本（草稿恢复检查）
//   fillAndClear  在新会话里填充这段文本并点击 .clear-all-button，断言输入框为空
//   hoverText     悬停含该文本的元素（如 commit chip），让悬浮卡弹出再截图
//   hoverSustainMs hoverText 之后继续轮询该时长（ms）：弹层 commit 卡必须全程在位
//                 （慢速流式回归——消息行每帧重建会摘掉 chip 锚点，卡片闪关=失败）
//
// 注意：本脚本在宿主侧用 Playwright 驱动 code-server 浏览器页面；沙盒内嵌的同源 webview
// iframe（`#active-frame`）会被宿主反复重建，所以对 frame 的操作必须**即时重新扫描**
// `page.frames()`，不能缓存 FrameHandle。
//
// 挂死防护（根因：Playwright 已知缺陷 microsoft/playwright#40511——对「挂起导航、尚无执行
// 上下文」的 iframe 调 evaluate()/locator.count() 永不返回，不 resolve 也不 reject，
// try/catch 与循环墙钟都兜不住；evaluate 的 {timeout} 选项实测被忽略）：
//   1. 所有帧扫描循环跳过空 URL 帧（isLiveFrame）——空 URL = 挂起导航帧；
//   2. 所有无超时调用（evaluate/count/isVisible）套 bounded() 竞速看门狗（默认 10s）；
//      watchdog 超时错误（err.watchdog=true）在扫描循环里重抛，由条目级 catch 转成
//      该项 fail + notes 记录帧快照诊断，不静默吞掉重试（吞掉会卡到外层边界且无诊断）；
//   3. 每项整体 5min 硬上限（ITEM_HARD_TIMEOUT）兜底——任何情况进程都会结束；
//   4. 首项前冒烟预热（耗掉 dsh 冷启动的挂起导航窗口）+ 有 fail 项时整轮自动重试一次。
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
const PENDING_TIMEOUT = 60_000
const ITEM_HARD_TIMEOUT = 300_000 // 每项整体硬上限 5min（全局兜底：保证进程永不结束不可能）

// 注：mock-LLM 匹配器已过滤 dsh 首轮注入（<system-reminder> 包裹的上下文不算 user
// prompt），所以首条 ledger prompt 直接命中规则，无需暖场消息（历史坑：首轮注入曾
// 成为「最后一条 user 消息」，导致回显注入文本、规则首轮不命中）。

// ── ledger ──────────────────────────────────────────────────────────────────
const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
const items = Array.isArray(ledger.items) ? ledger.items : []

const onlySet = only ? new Set(only.split(',').map((s) => s.trim()).filter(Boolean)) : null
const run = items.filter((it) => {
  const hasDriver = !!it.driver
  if (!hasDriver) return false // 无 driver 字段的项跳过
  if (onlySet && !onlySet.has(it.id)) return false
  return true
})

function saveLedger() {
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n', 'utf8')
}

// ── 通用工具 ────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** watchdog 超时错误（err.watchdog=true），扫描循环的 catch 靠 rethrowWatchdog 重抛它。 */
class WatchdogError extends Error {
  constructor(label, ms) {
    super(`watchdog: ${label} >${ms / 1000}s 无回应（疑似挂起导航帧，playwright#40511）`)
    this.name = 'WatchdogError'
    this.watchdog = true
  }
}

/**
 * 竞速看门狗：p 超过 ms 不 settle 即 reject（带 label 诊断）。
 * 背景：对挂起导航 iframe 的 evaluate/count 永不返回且 evaluate 的 {timeout} 选项被忽略，
 * 唯一可靠办法是 Promise.race 竞速。竞速落败的 promise 挂在那儿之后若 reject，提前挂
 * 空 catch，避免 unhandled rejection 干扰后续条目。
 */
async function bounded(p, label, ms = 10_000) {
  let t
  try {
    return await Promise.race([
      p,
      new Promise((_, rej) => {
        t = setTimeout(() => {
          p.catch(() => {})
          rej(new WatchdogError(label, ms))
        }, ms)
      }),
    ])
  } finally { clearTimeout(t) }
}

/** 扫描循环共用 catch 判定：watchdog 超时重抛（交条目级转 fail + 诊断），其余错误忽略续扫。 */
function rethrowWatchdog(e) {
  if (e && e.watchdog) throw e
}

/** 挂起导航帧（url()==''）上的 evaluate/count 会永久挂死，扫描时直接跳过，下轮重扫。 */
function isLiveFrame(f) {
  return !!f.url()
}

/** 帧快照诊断：列出各帧 URL（空 URL 单独标记），挂死类问题再现时的关键现场。 */
function frameSnapshot(page) {
  const lines = page.frames().map((f, i) => {
    const url = f.url()
    return `  [${i}] ${url || '(空 URL = 挂起导航帧)'}${f === page.mainFrame() ? ' [main]' : ''}`
  })
  return `帧快照（${lines.length} 帧）：\n${lines.join('\n')}`
}

/** 每调用都重新扫描 page.frames() 找满足 predicate 的新鲜 frame（帧会被宿主重建）。 */
async function findFrame(page, predicate, timeoutMs = 10_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    for (const f of page.frames()) {
      if (!isLiveFrame(f)) continue // 空 URL = 挂起导航帧，跳过
      try {
        if (await bounded(predicate(f), 'findFrame predicate')) return f
      } catch (e) {
        rethrowWatchdog(e)
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
    if (!root.url()) continue // 挂起导航帧跳过（page 自身 url 非空，不受影响）
    try {
      const newBtn = root.locator('[aria-label^="New Chat"]').locator('visible=true').first()
      if ((await bounded(newBtn.count(), 'newChat 头部按钮 count')) === 0) continue
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
      if (!isLiveFrame(f)) continue
      try {
        const n = await bounded(f.locator('body').filter({ hasText: expectText }).count(), `waitForText count（${expectText}）`)
        if (n > 0) return true
      } catch (e) {
        rethrowWatchdog(e)
        // 帧重建瞬间忽略
      }
    }
    await sleep(500)
  }
  return false
}

/** 在 webview 内嵌 frame 里悬停含指定文本的元素（commit chip 等）：等 chip
 *  状态类落地（commitInfo 回传：found 点亮 / unknown 灰显）再悬停，悬浮卡才弹。
 *  用于 hoverText 驱动字段——截图前把卡片弹出，让报告里能看到卡内容。 */
async function hoverTextInFrame(page, text) {
  for (const f of page.frames()) {
    if (!isLiveFrame(f)) continue
    try {
      const chip = f.locator('.commit-hash').filter({ hasText: text }).first()
      await chip.waitFor({ state: 'visible', timeout: 20_000 })
      await f.locator('.commit-hash-found, .commit-hash-unknown').first().waitFor({ state: 'visible', timeout: 20_000 })
      await chip.scrollIntoViewIfNeeded()
      await chip.hover({ timeout: 10_000 })
      await sleep(500)
      return true
    } catch {
      // 该 frame 没有/还没渲染出目标，试下一个（iframe 会被宿主重建，重扫）
    }
  }
  return false
}

/** 扫描全部 frame：弹层里的 commit 卡当前是否可见（hoverSustainMs 轮询用）。 */
async function popoverCommitCardVisible(page) {
  for (const f of page.frames()) {
    if (!isLiveFrame(f)) continue
    try {
      const n = await bounded(f.locator('.popover .commit-card').count(), 'popoverCommitCardVisible count')
      if (n > 0) return true
    } catch (e) {
      rethrowWatchdog(e)
      // 帧重建瞬间忽略
    }
  }
  return false
}

/** 点发送后立刻把 afterSendFill 填进 composer：发送清空输入后 composer 仍在，
 *  pending 帧到达前（mock-LLM 工具调用往返 ~百毫秒级）把草稿填进去。 */
async function fillAfterSend(page, text) {
  const chat = await findFrame(page, isChatFrame, 10_000)
  if (!chat) return false
  try {
    const ta = chat.locator('textarea#input')
    await ta.waitFor({ state: 'visible', timeout: 5_000 })
    await ta.fill(text)
    return true
  } catch {
    return false
  }
}

/** 等待 pending 面板出现并依次点击 `texts` 里列出的按钮文本（数组 = 按序点击，
 *  如问答面板先选选项再点 Submit；字符串 = 单次点击，如权限审批的 Allow once）。
 *  英文 locale。 */
async function approvePending(page, texts) {
  const list = Array.isArray(texts) ? [...texts] : [texts]
  for (const text of list) {
    const start = Date.now()
    let clicked = false
    while (Date.now() - start < PENDING_TIMEOUT) {
      for (const f of page.frames()) {
        if (!isLiveFrame(f)) continue
        try {
          const btn = f.locator('.pending-panel button', { hasText: text }).first()
          if ((await bounded(btn.count(), `approvePending count（${text}）`)) > 0 && (await bounded(btn.isVisible(), `approvePending isVisible（${text}）`))) {
            await btn.click()
            clicked = true
            break
          }
        } catch (e) {
          rethrowWatchdog(e)
          // 帧重建瞬间忽略
        }
      }
      if (clicked) break
      await sleep(500)
    }
    if (!clicked) return false
    await sleep(300)
  }
  return true
}

/** 在聊天帧里填充文本、点 .clear-all-button，断言输入框清空（返回 true/false）。 */
async function fillAndClickClear(page, text) {
  const chat = await findFrame(page, isChatFrame, 30_000)
  if (!chat) return false
  try {
    const ta = chat.locator('textarea#input')
    await ta.waitFor({ state: 'visible', timeout: 30_000 })
    await ta.fill(text)
    const clear = chat.locator('.clear-all-button')
    await clear.waitFor({ state: 'visible', timeout: 15_000 })
    await clear.click()
    await sleep(300)
    const value = await bounded(chat.evaluate(() => document.getElementById('input')?.value ?? null), 'fillAndClickClear evaluate')
    return value === ''
  } catch (e) {
    rethrowWatchdog(e)
    return false
  }
}

/** 扫描全部 frame，断言 composer textarea#input.value 包含 expectDraft。 */
async function waitForDraft(page, expectDraft, timeoutMs) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    for (const f of page.frames()) {
      if (!isLiveFrame(f)) continue
      try {
        const v = await bounded(f.evaluate(() => document.getElementById('input')?.value ?? null), 'waitForDraft evaluate')
        if (typeof v === 'string' && v.includes(expectDraft)) return true
      } catch (e) {
        rethrowWatchdog(e)
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

  // 3. 冒烟预热：新建会话 → composer 出现 → Meta+W 关闭。
  //    dsh 由插件按需冷启动，就绪轮询期间首个会话的 webview 内容帧处于挂起导航（1-3s
  //    窗口），先跑一轮冒烟把冷启动窗口耗掉，后续正式项不再撞窗。冒烟失败不阻断——
  //    正式项有看门狗兜底，会 fail-fast 并带帧快照诊断。
  console.log('\n=== 冒烟预热：新建会话 → composer → 关闭 ===')
  try {
    await bounded((async () => {
      const { source } = await newChatAndGetFrame(page)
      console.log(`冒烟通过（${source}），关闭冒烟 tab`)
      await closeEditorTab(page)
    })(), '冒烟预热', 120_000)
  } catch (e) {
    console.warn(`  [warn] 冒烟预热失败（不阻断正式项）：${e.message}`)
    console.warn(frameSnapshot(page))
  }

  // 单轮重试：有项 fail 时把 fail 项整轮自动重跑一次（冷启动/时序竞速类失败重跑即过）。
  let round = run
  for (let attempt = 1; attempt <= 2 && round.length; attempt++) {
    if (attempt > 1) console.log(`\n===== 第 ${attempt} 轮：重试 fail 项 ${round.map((i) => i.id).join(', ')} =====`)
    const failed = []
    for (const item of round) {
      const { id, driver } = item
      console.log(`\n=== ${id}: prompt「${driver.prompt ?? ''}」→ 期望「${driver.expectText ?? ''}」===${attempt > 1 ? '（重试）' : ''}`)
      let result = 'done'
      const notes = []
      try {
        // 每项整体 5min 硬上限（全局兜底）：任何未预见的挂起都在这里被斩断，
        // 转 fail + 帧快照诊断，保证「进程永不结束」不可能发生。
        await bounded((async () => {
          const { chat, source } = await newChatAndGetFrame(page)
          notes.push(`新建会话：${source}`)
          if (driver.prompt) {
            await sendPrompt(page, driver.prompt)
            // 发送后立刻填草稿：pending 接管（若本轮有审批）前 composer 还在。
            if (driver.afterSendFill) {
              const ok = await fillAfterSend(page, driver.afterSendFill)
              notes.push(ok ? `草稿已填入：${driver.afterSendFill}` : '草稿填入失败：pending 早于填补到达')
              if (!ok) {
                result = 'fail'
                notes.push('afterSendFill 未落上：composer 已被 pending 接管（时序竞速）')
              }
            }
          }
          if (driver.approve) {
            const ok = await approvePending(page, driver.approve)
            notes.push(ok ? `已点击面板按钮：${JSON.stringify(driver.approve)}` : `未等到面板按钮：${JSON.stringify(driver.approve)}`)
            if (!ok) {
              result = 'fail'
              notes.push(`等待 ${PENDING_TIMEOUT / 1000}s 面板按钮未出现`)
            }
          }
          if (driver.expectText) {
            const ok = await waitForText(page, driver.expectText, EXPECT_TEXT_TIMEOUT)
            if (!ok) {
              result = 'fail'
              notes.push(`断言超时（${EXPECT_TEXT_TIMEOUT / 1000}s）：预期文本「${driver.expectText}」未出现`)
            }
          }
          if (driver.hoverText) {
            // 悬停含该文本的元素（commit chip 等）让悬浮卡弹出，随后截图能拍到卡片。
            const ok = await hoverTextInFrame(page, driver.hoverText)
            notes.push(ok ? `已悬停：${driver.hoverText}` : `悬停失败：${driver.hoverText}`)
            if (!ok) {
              result = 'fail'
              notes.push('hoverText：未找到可悬停元素或状态未落地')
            } else if (driver.hoverSustainMs) {
              // 慢速流式回归：悬停后轮询 N ms，弹层 commit 卡必须持续在位（消息行每帧
              // 重建会摘掉 chip 锚点，重锚失败 = 卡片闪关）。结束前 500ms 内仍可见才过。
              const ms = Math.max(0, Number(driver.hoverSustainMs) || 0)
              const until = Date.now() + ms
              let lastSeen = -Infinity
              while (Date.now() < until) {
                if (await popoverCommitCardVisible(page)) lastSeen = Date.now()
                await sleep(300)
              }
              const sustained = Date.now() - lastSeen < 500
              notes.push(
                sustained
                  ? `悬停后 ${ms}ms 持续在位：commit 卡在流式重建期间未闪关`
                  : `悬停后 commit 卡中途消失（${ms}ms 内曾不可见）`,
              )
              if (!sustained) {
                result = 'fail'
                notes.push('hoverSustainMs：流式重建期间 commit 卡被弹层存活检查关掉（锚点未重锚）')
              }
            }
          }
          if (driver.fillAndClear) {
            const ok = await fillAndClickClear(page, driver.fillAndClear)
            notes.push(ok ? `已点击清空按钮，输入框为空` : '清空按钮未生效（找不到按钮或输入框未清空）')
            if (!ok) {
              result = 'fail'
              notes.push('fillAndClear：输入框未清空')
            }
          }
          if (driver.expectDraft) {
            const ok = await waitForDraft(page, driver.expectDraft, 30_000)
            notes.push(ok ? `草稿恢复：${driver.expectDraft}` : `草稿未恢复：${driver.expectDraft}`)
            if (!ok) {
              result = 'fail'
              notes.push('expectDraft：pending 应答后 composer 草稿丢失')
            }
          }
        })(), `条目 ${id} 整体执行`, ITEM_HARD_TIMEOUT)
      } catch (err) {
        result = 'fail'
        notes.push(`执行异常：${err.message}`)
        if (err.watchdog) notes.push(frameSnapshot(page))
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

      if (result !== 'done') failed.push(item)
      console.log(`${id} → ${result}${notes.length ? `（${item.notes}）` : ''}`)

      // 关闭当前 chat tab，避免串场
      await closeEditorTab(page)
    }
    round = failed
    if (round.length && attempt === 1) console.log(`\n${round.length} 项 fail，整轮自动重试一次：${round.map((i) => i.id).join(', ')}`)
  }

  // 汇总按 ledger 最终状态算（重试会覆盖首轮结果）
  summary.done = run.filter((it) => it.result === 'done').map((it) => it.id)
  summary.fail = run.filter((it) => it.result !== 'done').map((it) => it.id)
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
