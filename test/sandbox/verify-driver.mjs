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
//   expectDraft   断言 composer #input.value 包含该文本（草稿恢复检查）
//   expectPlaceholder 断言 composer 占位符文案包含该文本
//                 （占位符文案检查，如运行中的插话快捷键提示）
//   fillAndClear  在新会话里填充这段文本并点击 .clear-all-button，断言输入框为空
//   fillSlash     填充该文本但不发送（触发 slash 补全弹窗/参数 hint 行等纯输入态）
//   fillDraft     填充该文本但不发送，随后等防抖落盘（草稿持久化场景，配 reloadWindow）
//   fillAnswer    填充问答卡的自定义回答输入（pending 面板内，未提交；配 reloadWindow）
//   reloadWindow  true=整页重载（模拟重启：webview 内存全毁，草稿靠 drafts.json 恢复）；
//                 重载后 expectDraft/expectAnswerDraft 断言恢复结果
//   expectAnswerDraft 断言 pending 问答卡自定义输入框的值包含该文本（重启后半答恢复检查）
//   expectTextAfterReload 重载后断言 webview 中出现该文本（历史消息随状态重推仍在）
//   expectPopup   断言 webview 里出现这些文本（数组逐项断言，配 fillSlash 用；
//                 弹窗行文本/描述/hint 各算一条，超时 15s/条）
//   extraPrompts  第一条 prompt 之后的追加发送（数组；运行中第二条进队列，用于排队/插话场景）
//   extraPromptDelayMs 追加发送前的等待（默认 400ms；慢命令场景用来卡进运行态窗口）
//   expectSelector  断言任意 frame 里存在该元素（字符串=选择器；对象={selector,text} 再要求文本包含）
//   absentSelector  断言任意 frame 里都没有该选择器（如插话落地后排队行消失）
//   keys          在 composer 里按下的按键序列（如 ["Space"]、["Meta+Enter"]、["Tab"]），
//                 在 fillSlash 填入之后执行——用于空格认领、下钻、⌘/Ctrl+Enter 全插话等手势
//   dropFiles     往聊天 webview 里合成一次文件拖拽（dragenter + drop，模拟真实拖放）：
//                 [{ name, type, size }]。size ≤ 65536 造**真** File（FileReader 读得到字节，
//                 附件能真落盘成 chip）；size 更大时造只带 size/type/name 的**假**对象
//                 （闸在读字节之前就按元数据拒绝，不需要真分配几 MB）
//   hoverText     悬停含该文本的元素（如 commit chip），让悬浮卡弹出再截图
//   hoverSustainMs hoverText 之后继续轮询该时长（ms）：弹层 commit 卡必须全程在位
//                 （慢速流式回归——消息行每帧重建会摘掉 chip 锚点，卡片闪关=失败）
//   reconnect     断连横幅场景（对象，见 runReconnectScenario）：
//     container      沙盒容器名（并行实例用；默认 dsh-sandbox）
//     connectingText 横幅 connecting 相位断言文本（默认 "Connection lost, reconnecting"）
//     failedText     横幅 failed 相位断言文本（默认 "Reconnection failed"）
//     recoveredText  横幅 recovered 相位断言文本（默认 "Connection restored"）
//     buttonRecovery true = respawn 后点「立即重连」恢复（按钮路径）；
//                    false/缺省 = 自动退避自愈路径（respawn 后先发 blindPrompt 制造
//                    盲窗事件，靠自动重连 + re-baseline 补上，验证内容完整）
//     blindPrompt    自动路径下盲窗期间发送的消息（恢复后断言其回显完整出现）
//     afterPrompt    恢复后发送的消息（断言回显 = 消息流续上）
//     断言文本一律按「收到：<prompt>」的 mock 回显子串匹配。
//
// 注意：本脚本在宿主侧用 Playwright 驱动 code-server 浏览器页面；沙盒内嵌的同源 webview
// iframe（`#active-frame`）会被宿主反复重建，所以对 frame 的操作必须**即时重新扫描**
// `page.frames()`，不能缓存 FrameHandle。
//
// reconnect 场景的超时约定（verify-driver 挂死调查的教训，每个 await 阶段必须有界 +
// 超时杀掉子进程）：所有 docker exec/cp 走 execFile 的 timeout 选项（超时杀子进程），
// Playwright 等待全部沿用 bounded() 看门狗 + 显式 timeout，场景结尾幂等 cleanup
// （杀 holder、dsh 死了就重拉），后续条目不受残局影响。
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
import { execFile } from 'node:child_process'
import { createReadStream, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
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

/** 聊天 panel webview 帧（含 composer #input）。 */
function isChatFrame(f) {
  return f.evaluate(() => !!document.querySelector('#input')).catch(() => false)
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
  const ta = chat.locator('#input')
  await ta.waitFor({ state: 'visible', timeout: 30_000 })
  await ta.click()
  await ta.fill(text)
  await sleep(200)
  await chat.locator('.send-button').click({ timeout: 15_000 })
}

/** 填 composer 不发送（fillSlash 驱动字段）：触发 slash 补全弹窗/参数 hint 行等纯输入态。 */
async function fillComposer(page, text) {
  const chat = await findFrame(page, isChatFrame, 30_000)
  if (!chat) throw new Error('composer 帧未出现')
  const ta = chat.locator('#input')
  await ta.waitFor({ state: 'visible', timeout: 30_000 })
  await ta.click()
  await ta.fill(text)
  // 弹窗随 input 事件重渲染，留一拍再断言。
  await sleep(400)
}

/** 在 composer 里按一串键（keys 驱动字段）。先点输入框聚焦，再逐键 press。
 *  按键要落在 webview 的 #input 上才能被 composer 的键盘路径消费（capture 阶段的
 *  补全导航、Space 认领、⌘/Ctrl+Enter 手势都挂在它上面）。 */
async function pressComposerKeys(page, keys) {
  const chat = await findFrame(page, isChatFrame, 30_000)
  if (!chat) throw new Error('composer 帧未出现')
  const ta = chat.locator('#input')
  await ta.waitFor({ state: 'visible', timeout: 30_000 })
  await ta.click()
  for (const key of keys) {
    await page.keyboard.press(key)
    await sleep(250)
  }
  await sleep(300)
}

/**
 * 往聊天 webview 里合成一次文件拖拽（dropFiles 驱动字段）。
 *
 * 事件直接派发在 webview 自己的 document 上（我们的拖拽监听就挂在那里），
 * DataTransfer 由页面内构造：小文件造真 File（FileReader 读得到字节、附件能真
 * 落盘），大文件只造带 size 的假对象——闸在读字节之前就按元数据拒绝，没必要
 * 真的分配几 MB。返回实际派发的条目摘要，写进 notes 供人核对。
 */
async function dropFilesOnChat(page, entries, dragOnly) {
  const chat = await findFrame(page, isChatFrame, 30_000)
  if (!chat) throw new Error('composer 帧未出现')
  return bounded(
    chat.evaluate(({ list, dragOnly }) => {
      const real = []
      const fake = []
      for (const f of list) {
        const size = Number(f.size ?? 0)
        if (size > 65536) fake.push({ name: f.name, type: f.type ?? '', size })
        else real.push(new File([new Uint8Array(size)], f.name, { type: f.type ?? '' }))
      }
      // dataTransfer 是 DragEvent 原型上的只读访问器：实例上 defineProperty 一层
      // 自有属性即可换成我们自己的对象（假条目只能这样塞进去）。
      const synthetic = { types: ['Files'], files: [...real, ...fake], dropEffect: '' }
      window.__dshSyntheticDrag = synthetic
      for (const type of dragOnly === true ? ['dragenter'] : ['dragenter', 'drop']) {
        const ev = new DragEvent(type, { bubbles: true, cancelable: true })
        Object.defineProperty(ev, 'dataTransfer', { value: synthetic })
        document.dispatchEvent(ev)
      }
      return list.map((f) => `${f.name}(${f.size}B)`)
    }, { list: entries, dragOnly: dragOnly === true }),
    'dropFiles evaluate',
  )
}

/** 扫描全部 frame 等待 expectText 出现（每轮重扫，容忍宿主重建）。
 *  提问/审批面板会替换 composer（#input 消失），不能用 isChatFrame 定位，
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
    const ta = chat.locator('#input')
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
    const ta = chat.locator('#input')
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

/** 键盘双击清空 + 反悔（driver.keyClearUndo）：填文本 → 清空键第一次（提示小框
 *  .clear-confirm-hint 出现、文本原样不动）→ 第二次（清空）→ Ctrl+Z（恢复原文）。
 *  key 取 'Control+c'（默认）或 'Escape'（driver.keyClearUndoKey: 'escape'）。
 *  逐步断言，任一步不符返回 false。 */
async function keyClearUndo(page, text, key = 'Control+c') {
  const chat = await findFrame(page, isChatFrame, 30_000)
  if (!chat) return false
  try {
    const ta = chat.locator('#input')
    await ta.waitFor({ state: 'visible', timeout: 30_000 })
    await ta.click()
    await ta.fill(text)
    await sleep(300)
    await page.keyboard.press(key)
    await sleep(300)
    const armed = await bounded(
      chat.evaluate(() => ({
        hint: !!document.querySelector('.clear-confirm-hint'),
        value: document.getElementById('input')?.value ?? null,
      })),
      'keyClearUndo armed evaluate',
    )
    if (!armed.hint || armed.value !== text) return false
    await page.keyboard.press(key)
    await sleep(400)
    const cleared = await bounded(chat.evaluate(() => document.getElementById('input')?.value ?? null), 'keyClearUndo cleared evaluate')
    if (cleared !== '') return false
    await page.keyboard.press('Control+z')
    await sleep(400)
    const restored = await bounded(chat.evaluate(() => document.getElementById('input')?.value ?? null), 'keyClearUndo restored evaluate')
    return restored === text
  } catch (e) {
    rethrowWatchdog(e)
    return false
  }
}

/** 拖拽遮罩场景收尾：补一次 dragleave 把遮罩摘掉，免得残留到后面几项的截图里。 */
async function dragLeaveOnChat(page) {
  const chat = await findFrame(page, isChatFrame, 30_000)
  if (!chat) return
  await chat
    .evaluate(() => {
      const dt = window.__dshSyntheticDrag ?? { types: ['Files'], files: [] }
      const ev = new DragEvent('dragleave', { bubbles: true, cancelable: true })
      Object.defineProperty(ev, 'dataTransfer', { value: dt })
      document.dispatchEvent(ev)
    })
    .catch(() => {})
}

/** 扫描全部 frame 等待某个选择器出现（可选要求其文本包含 needle）。宿主重建帧
 *  期间查询会瞬时落空，所以是轮询式等待而不是一次性断言。 */
async function waitForSelectorAnywhere(page, selector, needle, timeoutMs) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    for (const f of page.frames()) {
      if (!isLiveFrame(f)) continue
      try {
        const found = await bounded(
          f.evaluate(
            ([sel, text]) => {
              for (const el of document.querySelectorAll(sel)) {
                if (text === null || (el.textContent ?? '').includes(text)) return true
              }
              return false
            },
            [selector, needle ?? null],
          ),
          'waitForSelectorAnywhere evaluate',
        )
        if (found) return true
      } catch (e) {
        rethrowWatchdog(e)
      }
    }
    await sleep(300)
  }
  return false
}

/** 选择器在全部 frame 里都不存在（断言消失：如插话落地后排队行不再有）。 */
async function selectorAbsentEverywhere(page, selector) {
  for (const f of page.frames()) {
    if (!isLiveFrame(f)) continue
    try {
      const any = await bounded(
        f.evaluate((sel) => document.querySelectorAll(sel).length > 0, selector),
        'selectorAbsentEverywhere evaluate',
      )
      if (any) return false
    } catch (e) {
      rethrowWatchdog(e)
      return false
    }
  }
  return true
}

/** 扫描全部 frame，断言 composer #input.value 包含 expectDraft。 */
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

/**
 * 填问答卡某题的自定义回答输入（fillAnswer 驱动字段）：pending 面板接管 composer，
 * 输入框在 .pending-panel 内。单选带选项的卡自定义行默认隐藏（跟随「Other」显隐），
 * 没有可见输入框就先点 Other 展开再填。
 */
async function fillQuestionAnswer(page, text) {
  const start = Date.now()
  while (Date.now() - start < 60_000) {
    for (const f of page.frames()) {
      if (!isLiveFrame(f)) continue
      try {
        const inputs = f.locator('.pending-panel .question-custom input')
        const n = await bounded(inputs.count(), 'fillQuestionAnswer count')
        for (let i = 0; i < n; i++) {
          const input = inputs.nth(i)
          if (await bounded(input.isVisible(), 'fillQuestionAnswer isVisible')) {
            await input.click()
            await input.fill(text)
            return true
          }
        }
        const other = f.locator('.pending-panel .option-btn', { hasText: 'Other' }).first()
        if ((await bounded(other.count(), 'fillQuestionAnswer other count')) > 0 && (await bounded(other.isVisible(), 'fillQuestionAnswer other visible'))) {
          await other.click()
          await sleep(300)
          continue // 展开后下一轮扫描再填
        }
      } catch (e) {
        rethrowWatchdog(e)
        // 帧重建瞬间忽略
      }
    }
    await sleep(500)
  }
  return false
}

/** 断言 pending 问答卡自定义输入框的值包含 expectAnswerDraft（重启后半答恢复检查）。 */
async function waitForAnswerDraft(page, text, timeoutMs) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    for (const f of page.frames()) {
      if (!isLiveFrame(f)) continue
      try {
        const v = await bounded(
          f.evaluate(() => [...document.querySelectorAll('.pending-panel .question-custom input')].map((el) => el.value).join('\n')),
          'waitForAnswerDraft evaluate',
        )
        if (typeof v === 'string' && v.includes(text)) return true
      } catch (e) {
        rethrowWatchdog(e)
        // 帧重建瞬间忽略
      }
    }
    await sleep(500)
  }
  return false
}

/** 整页重载（reloadWindow 驱动字段）：webview 内存全毁后靠面板恢复链（serializer →
 *  webview 重建 → ready → draftRestore 下发）还原，留足异步链余量。 */
async function reloadWorkbench(page) {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForSelector('.monaco-workbench', { timeout: WORKBENCH_TIMEOUT })
  await sleep(6000)
}

/** 扫描全部 frame，断言 composer 占位符文案包含 expectPlaceholder。 */
async function waitForPlaceholder(page, expectPlaceholder, timeoutMs) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    for (const f of page.frames()) {
      if (!isLiveFrame(f)) continue
      try {
        const v = await bounded(
          f.evaluate(
            () =>
              document.querySelector('#input ~ .lexical-placeholder, .lexical-placeholder')?.textContent ??
              document.getElementById('input')?.getAttribute('placeholder') ??
              null,
          ),
          'waitForPlaceholder evaluate',
        )
        if (typeof v === 'string' && v.includes(expectPlaceholder)) return true
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

// ── 断连横幅场景（driver.reconnect）─────────────────────────────────────────

/** 容器内执行命令：execFile 的 timeout 超时杀掉子进程（挂死调查约定——每个
 *  await 阶段必须有界，docker 子进程不允许裸等）。root=true 时以容器 root 跑
 *  （docker 的 -u 必须在 container 名之前，单独成参数避免顺序错误）。 */
function dockerExec(container, argv, timeoutMs = 30_000, root = false) {
  const dockerArgs = root ? ['exec', '-u', 'root', container, ...argv] : ['exec', container, ...argv]
  return new Promise((resolve, reject) => {
    execFile(
      'docker',
      dockerArgs,
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(
            new Error(
              `docker exec ${String(argv[0] ?? '')} 失败：${err.message}${stderr ? ` stderr=${String(stderr).trim()}` : ''}`,
            ),
          )
          return
        }
        resolve(String(stdout).trim())
      },
    )
  })
}

/** 把宿主文件经 stdin 写进容器（docker cp 会保留宿主 uid/权限，容器用户
 *  chmod 不了；exec -i cat > 以容器用户落盘，属主/权限天然正确）。 */
function dockerCp(container, hostPath, containerPath) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'docker',
      ['exec', '-i', container, 'sh', '-c', `cat > ${containerPath}`],
      { timeout: 30_000 },
      (err) => {
        if (err) reject(new Error(`docker cp ${hostPath} 失败：${err.message}`))
        else resolve()
      },
    )
    createReadStream(hostPath).pipe(child.stdin)
  })
}

/** 等重拉后的 dsh 就绪（容器内 describe 探测，30s 上限；探测脚本经 stdin 落盘，
 *  避免 inline node -e 的引号地狱）。 */
async function waitDshReady(container, timeoutMs = 30_000) {
  return dockerExec(
    container,
    ['sh', '-c', `node /tmp/dsh-probe.mjs ready "$(cat /tmp/dsh-reconnect/port)" ${timeoutMs}`],
    timeoutMs + 10_000,
  )
}

/**
 * 幂等残局恢复：holder 还在就杀；dsh 已死就按保存信息重拉；一切健康则无操作。
 * reconnect 场景结束（无论成败）后调用，保证后续回归条目不被残局拖垮。
 */
async function reconnectCleanup(container) {
  try {
    await dockerExec(container, ['sh', '-c', `
if [ ! -f /tmp/dsh-reconnect/port ]; then exit 0; fi
PORT=$(cat /tmp/dsh-reconnect/port)
HOLDER=$(cat /tmp/dsh-reconnect/holder.pid 2>/dev/null || true)
if [ -n "$HOLDER" ] && kill -0 "$HOLDER" 2>/dev/null; then kill "$HOLDER" 2>/dev/null || true; sleep 0.5; fi
if node /tmp/dsh-probe.mjs cleanup-chk "$PORT" 2000 2>/dev/null; then exit 0; fi
cd "$(cat /tmp/dsh-reconnect/cwd)"
set -a
. /tmp/dsh-reconnect/environ
set +a
nohup sh -c "$(cat /tmp/dsh-reconnect/cmdline)" > /tmp/dsh-reconnect/respawn.log 2>&1 &
`], 40_000)
  } catch (e) {
    console.warn(`  [warn] reconnect cleanup 未完成（人工注意沙盒状态）：${e.message}`)
  }
}

/**
 * capture dsh 进程（cmdline/env/cwd/port 落盘）→ kill -9 → 拉起端口占位器
 * （test/sandbox/dsh-port-holder.mjs）。占位器只做两件事：POST /api/host.describe
 * 回 rpcId 回显（扩展 10s 健康探测继续通过、manager 不 detach controller——
 * 隔离「探测最多 10s 后必然 detach」的竞态），其余请求 404 / WS 断连（mux 每次
 * attach 立即失败，重连退避按 1s 翻倍确定性演进，横幅 connecting→failed 按
 * 阈值出现）。
 */
async function captureDshAndHold(container) {
  return dockerExec(container, ['sh', '-c', `
set -e
mkdir -p /tmp/dsh-reconnect
SELF=$$
{
  echo "capture start self=$SELF"
  for P in $(pgrep -f 'web --host 127.0.0.1 --port'); do
    echo "match pid=$P comm=[$(cat /proc/$P/comm 2>/dev/null)] cmdline=[$(tr '\\0' '|' < /proc/$P/cmdline 2>/dev/null)]"
  done
} > /tmp/dsh-reconnect/capture-debug.log 2>&1 || true
PID=""
# pgrep -f 会匹配到本 sh 自身与 respawn 留下的 sh -c 包装层（cmdline 里都含
# 同一串模式）：先记录信息、最后再全部杀掉（包装层死了不影响其 dsh 子进程，
# 子进程下面单杀）。真实 dsh 进程的 comm 实测是 MainThread（dsh 运行时改名
# 线程），不能按 comm=node 认——反过来排除 sh 包装层，剩下的第一个就是 dsh。
for P in $(pgrep -f 'web --host 127.0.0.1 --port'); do
  [ "$P" = "$SELF" ] && continue
  COMM=$(cat /proc/$P/comm 2>/dev/null || true)
  if [ "$COMM" != "sh" ] && [ -z "$PID" ]; then PID=$P; fi
done
if [ -z "$PID" ]; then echo 'no dsh process found' >&2; cat /tmp/dsh-reconnect/capture-debug.log >&2; exit 1; fi
CMDLINE=$(tr '\\0' ' ' < /proc/$PID/cmdline)
PORT=$(printf '%s' "$CMDLINE" | sed -n 's/.*--port \\([0-9][0-9]*\\).*/\\1/p')
if [ -z "$PORT" ]; then
  echo "no --port in dsh cmdline (pid=$PID): $CMDLINE" >&2
  cat /tmp/dsh-reconnect/capture-debug.log >&2
  exit 1
fi
printf '%s' "$CMDLINE" > /tmp/dsh-reconnect/cmdline
printf '%s' "$PORT" > /tmp/dsh-reconnect/port
tr '\\0' '\\n' < /proc/$PID/environ > /tmp/dsh-reconnect/environ
readlink /proc/$PID/cwd > /tmp/dsh-reconnect/cwd
# 信息落盘完成后再杀：排除自身与包装层，其余全杀（含 dsh）。
for P in $(pgrep -f 'web --host 127.0.0.1 --port'); do
  [ "$P" = "$SELF" ] && continue
  kill -9 $P 2>/dev/null || true
done
sleep 0.2
nohup node /tmp/dsh-port-holder.mjs "$PORT" /tmp/dsh-reconnect/holder.pid > /tmp/dsh-reconnect/holder.log 2>&1 &
sleep 0.5
cat /tmp/dsh-reconnect/holder.pid
`], 20_000)
}

/** 停掉占位器并按保存的 cmdline/env/cwd 重拉 dsh（端口沿用原值）。 */
async function respawnDsh(container) {
  return dockerExec(container, ['sh', '-c', `
set -e
HOLDER=$(cat /tmp/dsh-reconnect/holder.pid 2>/dev/null || true)
if [ -n "$HOLDER" ] && kill -0 "$HOLDER" 2>/dev/null; then kill "$HOLDER" 2>/dev/null || true; fi
sleep 0.5
cd "$(cat /tmp/dsh-reconnect/cwd)"
set -a
. /tmp/dsh-reconnect/environ
set +a
nohup sh -c "$(cat /tmp/dsh-reconnect/cmdline)" > /tmp/dsh-reconnect/respawn.log 2>&1 &
`], 20_000)
}

/** 断连横幅当前是否可见（任一 live frame 内 .reconnect-banner 非 display:none）。 */
async function reconnectBannerVisible(page) {
  for (const f of page.frames()) {
    if (!isLiveFrame(f)) continue
    try {
      const visible = await bounded(
        f.evaluate(() => {
          const b = document.querySelector('.reconnect-banner')
          return !!b && b.style.display !== 'none'
        }),
        'reconnectBannerVisible evaluate',
      )
      if (visible) return true
    } catch (e) {
      rethrowWatchdog(e)
      // 帧重建瞬间忽略
    }
  }
  return false
}

/** 等横幅消失（recovered 相位 ~3s 自动隐藏 / 空态复位）。 */
async function waitReconnectBannerGone(page, timeoutMs) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (!(await reconnectBannerVisible(page))) return true
    await sleep(300)
  }
  return false
}

/** 点横幅「Reconnect now」按钮；横幅已被自动恢复收掉时返回 false（竞速备注用）。 */
async function clickReconnectNow(page) {
  const start = Date.now()
  while (Date.now() - start < 10_000) {
    for (const f of page.frames()) {
      if (!isLiveFrame(f)) continue
      try {
        const btn = f.locator('.reconnect-banner-btn')
        if (
          (await bounded(btn.count(), 'reconnect btn count')) > 0 &&
          (await bounded(btn.isVisible(), 'reconnect btn isVisible'))
        ) {
          await btn.click({ timeout: 5_000 })
          return true
        }
      } catch (e) {
        rethrowWatchdog(e)
        // 帧重建瞬间忽略
      }
    }
    // 横幅已经没了 = 恢复已发生（自动重连赢在点击前）：返回 false 交调用方备注。
    if (!(await reconnectBannerVisible(page))) return false
    await sleep(250)
  }
  return false
}

/** 场景内截图（多阶段各一张，路径回传给 ledger 的 screenshots）。 */
let reconnectShotSeq = 0
async function takeReconnectShot(page, itemId, label) {
  reconnectShotSeq += 1
  const path = resolve(outDir, `${itemId}-${String(reconnectShotSeq).padStart(2, '0')}-${label}.png`)
  await page.screenshot({ path })
  return path
}

/**
 * 断连场景进行中的沙盒容器（SIGTERM 兜底清理用）：外部超时杀进程时 try/finally
 * 不执行，kill 后若把「holder 在跑 + dsh 已死」的残局留给沙盒，后续全部条目的
 * newChat 都打不开（扩展 10s 探测失败已 detach）——实测踩过。SIGTERM/SIGINT
 * 先跑幂等 cleanup（停 holder、重拉 dsh）再退出，进程被杀也收敛沙盒。
 */
let activeReconnectContainer = null
process.on('SIGTERM', () => {
  const container = activeReconnectContainer
  console.warn(`[warn] SIGTERM：${container ? `先清理断连残局（${container}）` : '无断连残局'}再退出`)
  const done = container ? reconnectCleanup(container) : Promise.resolve()
  void Promise.race([done, sleep(15_000)]).finally(() => process.exit(143))
})
process.on('SIGINT', () => {
  const container = activeReconnectContainer
  const done = container ? reconnectCleanup(container) : Promise.resolve()
  void Promise.race([done, sleep(15_000)]).finally(() => process.exit(130))
})

/**
 * 断连横幅场景主流程（driver.reconnect，见文件头字段说明）：
 *   kill dsh + 占位器 → 等 connecting 横幅 → 等 failed 横幅 → respawn dsh →
 *   [自动路径] 盲窗发 blindPrompt → 等 recovered（自动退避自愈）→ blindPrompt
 *     回显完整出现（盲窗事件经 re-baseline 补上）→ 横幅自动隐藏；
 *   [按钮路径] 点「立即重连」→ 等 recovered → 横幅自动隐藏；
 *   → 发 afterPrompt 断言回显（消息流续上）→ 首条消息回显仍在（内容完整）。
 * 每阶段截图一张；返回 { ok, shots }。
 */
async function runReconnectScenario(page, cfg, itemId, firstEcho, notes) {
  const shots = []
  const container = typeof cfg.container === 'string' && cfg.container ? cfg.container : 'dsh-sandbox'
  const connectingText = typeof cfg.connectingText === 'string' && cfg.connectingText ? cfg.connectingText : 'Connection lost, reconnecting'
  const failedText = typeof cfg.failedText === 'string' && cfg.failedText ? cfg.failedText : 'Reconnection failed'
  const recoveredText = typeof cfg.recoveredText === 'string' && cfg.recoveredText ? cfg.recoveredText : 'Connection restored'
  const buttonRecovery = cfg.buttonRecovery === true
  let ok = true
  const step = (cond, passNote, failNote) => {
    notes.push(cond ? passNote : failNote)
    if (!cond) ok = false
  }

  try {
    // 1) holder/probe 脚本进容器（stdin 管道以容器用户落盘）+ capture dsh。
    //    先以 root 清掉可能残留的旧文件（docker cp 时代的 600/uid501 残留
    //    在粘滞 /tmp 里容器用户删不掉）。
    activeReconnectContainer = container
    await dockerExec(container, ['rm', '-f', '/tmp/dsh-port-holder.mjs', '/tmp/dsh-probe.mjs'], 10_000, true)
    await dockerCp(container, resolve(SCRIPT_DIR, 'dsh-port-holder.mjs'), '/tmp/dsh-port-holder.mjs')
    await dockerCp(container, resolve(SCRIPT_DIR, 'dsh-probe.mjs'), '/tmp/dsh-probe.mjs')
    await captureDshAndHold(container)

    // 2) connecting 横幅（mux close 后第一条 chatReconnect，~1s 内到达）。
    const connecting = await waitForText(page, connectingText, 15_000)
    step(connecting, `断连横幅 connecting 出现：「${connectingText}」`, `断连横幅 connecting 未出现：「${connectingText}」`)
    if (connecting) shots.push(await takeReconnectShot(page, itemId, 'banner-connecting'))
    if (!ok) return { ok, shots }

    // 3) failed 相位（第 3 次失败 ≈ kill+3.5s；占位器下每次 attach 立即失败）。
    const failed = await waitForText(page, failedText, 20_000)
    step(failed, `断连横幅 failed 出现：「${failedText}」`, `断连横幅 failed 未出现：「${failedText}」`)
    if (failed) shots.push(await takeReconnectShot(page, itemId, 'banner-failed'))

    // 4) respawn dsh 并等就绪。
    await respawnDsh(container)
    await waitDshReady(container, 30_000)
    notes.push('dsh 已 respawn 并确认就绪（describe 探测通过）')

    let afterSentBeforeRecovery = false
    if (buttonRecovery) {
      // 5a) 按钮路径：dsh 就绪后立即点「立即重连」（failed 相位后的自动 tick
      //     至少 4s 后才来；forceReconnect 同时取消退避定时器，不会双 attach）。
      const clicked = await clickReconnectNow(page)
      if (!clicked) {
        // 自动重连先一步赢下竞速（罕见）：恢复已发生，按钮路径按自动路径备注。
        notes.push('点击立即重连时横幅已消失——自动退避先于点击完成恢复（竞速，断言不失效）')
      } else {
        notes.push('已点击横幅「立即重连」按钮')
      }
      // 点击后立即发一条消息：实测 dsh 0.1.1 重连后若会话无 pending 事件，
      // mux 不发 subscribed、静默挂住 socket，但事件照常流动——host 把
      // 「本会话任意帧」当恢复信号，这条消息的事件帧就是确定性的恢复信号。
      if (typeof cfg.afterPrompt === 'string' && cfg.afterPrompt) {
        try {
          await sendPrompt(page, cfg.afterPrompt)
          notes.push(`点击后已发送：${cfg.afterPrompt}（其事件帧作为恢复信号）`)
          afterSentBeforeRecovery = true
        } catch (e) {
          step(false, '', `点击后发送失败：${e.message}`)
          return { ok, shots }
        }
      }
    } else {
      // 5b) 自动路径：盲窗内发 blindPrompt——事件在扩展「失明」期间被 dsh 记录，
      //     自动重连成功后 dsh 发 subscribed(lastSeq) + 事件，经 gap-check →
      //     re-baseline 补回，验证内容完整。
      if (typeof cfg.blindPrompt === 'string' && cfg.blindPrompt) {
        try {
          await sendPrompt(page, cfg.blindPrompt)
          notes.push(`盲窗内已发送：${cfg.blindPrompt}`)
        } catch (e) {
          step(false, '', `盲窗内发送失败：${e.message}`)
          return { ok, shots }
        }
      }
    }

    // 6) recovered（自动退避最迟 ~30s；按钮路径等 afterPrompt 事件帧）。
    const recovered = await waitForText(page, recoveredText, 45_000)
    step(recovered, `恢复横幅出现：「${recoveredText}」`, `恢复横幅未出现：「${recoveredText}」`)
    if (recovered) shots.push(await takeReconnectShot(page, itemId, 'banner-recovered'))

    // 7) 横幅自动隐藏（recovered ~3s 后收起 = 恢复信号不常驻打扰）。
    const gone = await waitReconnectBannerGone(page, 15_000)
    step(gone, '恢复横幅短暂显示后自动隐藏', '恢复横幅 15s 内未隐藏')

    // 8) 自动路径的盲窗消息：re-baseline 后完整出现。
    if (!buttonRecovery && typeof cfg.blindPrompt === 'string' && cfg.blindPrompt) {
      const blindOk = await waitForText(page, `收到：${cfg.blindPrompt}`, 45_000)
      step(
        blindOk,
        `盲窗消息经重连补齐：「收到：${cfg.blindPrompt}」`,
        `盲窗消息未补齐：「收到：${cfg.blindPrompt}」`,
      )
    }

    // 9) 恢复后新消息续上（消息流自愈的直接证明）。自动路径在这步发；按钮路径
    //    已在恢复前发出（它的回显断言复用同一条消息）。
    if (typeof cfg.afterPrompt === 'string' && cfg.afterPrompt && !afterSentBeforeRecovery) {
      try {
        await sendPrompt(page, cfg.afterPrompt)
      } catch (e) {
        step(false, '', `恢复后发送失败：${e.message}`)
      }
    }
    if (typeof cfg.afterPrompt === 'string' && cfg.afterPrompt) {
      const afterOk = await waitForText(page, `收到：${cfg.afterPrompt}`, 60_000)
      step(afterOk, `恢复后新消息回显：「收到：${cfg.afterPrompt}」`, `恢复后新消息无回显：「收到：${cfg.afterPrompt}」`)
    }

    // 10) 断线前的内容仍在（历史未丢）。
    if (firstEcho) {
      const intact = await waitForText(page, firstEcho, 5_000)
      step(intact, `断线前内容仍在：「${firstEcho}」`, `断线前内容丢失：「${firstEcho}」`)
    }
  } catch (e) {
    ok = false
    notes.push(`reconnect 场景异常：${e.message}`)
    if (e.watchdog) notes.push(frameSnapshot(page))
  } finally {
    // 幂等残局恢复（场景失败也不把沙盒留给后续条目）。
    await reconnectCleanup(container)
    activeReconnectContainer = null
  }
  return { ok, shots }
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

  /** 上一项是「只 dragenter」的遮罩场景：截图后补一次 dragleave 收尾。 */
  let dragLeavePending = false

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
      const extraShots = []
      try {
        // 每项整体 5min 硬上限（全局兜底）：任何未预见的挂起都在这里被斩断，
        // 转 fail + 帧快照诊断，保证「进程永不结束」不可能发生。
        await bounded((async () => {
          const { chat, source } = await newChatAndGetFrame(page)
          notes.push(`新建会话：${source}`)
          if (driver.fillSlash !== undefined) {
            // 填入但不发送：触发 slash 补全弹窗，供 expectPopup 断言弹窗内容。
            await fillComposer(page, driver.fillSlash)
            notes.push(`composer 已填入（未发送）：${JSON.stringify(driver.fillSlash)}`)
          }
          if (driver.expectPopup) {
            for (const text of [].concat(driver.expectPopup)) {
              const ok = await waitForText(page, text, 15_000)
              notes.push(ok ? `弹窗文本命中：${text}` : `弹窗文本未命中：${text}`)
              if (!ok) {
                result = 'fail'
                notes.push(`expectPopup：「${text}」15s 内未出现`)
              }
            }
          }
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
          // 追加发送（extraPrompts）：第一条 prompt 之后接着发的消息——运行中的
          // 回合里第二条会进队列，用于排队/插话类场景。
          for (const extra of [].concat(driver.extraPrompts ?? [])) {
            await sleep(Number(driver.extraPromptDelayMs ?? 400))
            await sendPrompt(page, extra)
            notes.push(`追加发送：${JSON.stringify(extra)}`)
          }
          // 手势键（keys）与合成拖拽（dropFiles）都放在发送之后：这样它们既能在
          // 「只填不发」的场景里作用于 composer，也能落在「跑起来之后」的时机上。
          if (driver.keys) {
            await pressComposerKeys(page, [].concat(driver.keys))
            notes.push(`composer 按键：${[].concat(driver.keys).join(' + ')}`)
          }
          if (driver.dropFiles) {
            const dropped = await dropFilesOnChat(page, driver.dropFiles, driver.dropFilesDragOnly)
            notes.push(`合成拖拽${driver.dropFilesDragOnly ? '（只 dragenter，不 drop）' : ''}：${dropped.join('、')}`)
            // 附件链路是 webview → 宿主落盘 → 回投 chips，等一拍再断言。
            await sleep(1500)
          }
          if (driver.expectSelector) {
            const spec = driver.expectSelector
            const selector = typeof spec === 'string' ? spec : spec.selector
            const needle = typeof spec === 'string' ? null : (spec.text ?? null)
            const ok = await waitForSelectorAnywhere(page, selector, needle, 30_000)
            notes.push(
              ok
                ? `选择器命中：${selector}${needle === null ? '' : `（含「${needle}」）`}`
                : `选择器未命中：${selector}${needle === null ? '' : `（含「${needle}」）`}`,
            )
            if (!ok) {
              result = 'fail'
              notes.push(`expectSelector 断言失败：${selector}`)
            }
          }
          if (driver.absentSelector) {
            const ok = await selectorAbsentEverywhere(page, driver.absentSelector)
            notes.push(ok ? `选择器已消失：${driver.absentSelector}` : `选择器仍在：${driver.absentSelector}`)
            if (!ok) {
              result = 'fail'
              notes.push(`absentSelector 断言失败：${driver.absentSelector}`)
            }
          }
          if (driver.expectText) {
            const ok = await waitForText(page, driver.expectText, EXPECT_TEXT_TIMEOUT)
            if (!ok) {
              result = 'fail'
              notes.push(`断言超时（${EXPECT_TEXT_TIMEOUT / 1000}s）：预期文本「${driver.expectText}」未出现`)
            }
          }
          if (driver.fillDraft) {
            await fillComposer(page, driver.fillDraft)
            notes.push(`composer 草稿已填入（未发送）：${JSON.stringify(driver.fillDraft)}`)
            // 防抖 400ms + webview→宿主→落盘链路余量。
            await sleep(1500)
          }
          if (driver.fillAnswer) {
            const ok = await fillQuestionAnswer(page, driver.fillAnswer)
            notes.push(ok ? `问答卡半答已填入：${JSON.stringify(driver.fillAnswer)}` : '问答卡自定义输入未找到/不可见')
            if (!ok) {
              result = 'fail'
              notes.push('fillAnswer：60s 内问答卡输入框不可填')
            }
            await sleep(1500)
          }
          if (driver.reloadWindow) {
            await reloadWorkbench(page)
            notes.push('已整页重载（模拟重启：webview 内存全毁，草稿靠 drafts.json 恢复）')
          }
          if (driver.expectTextAfterReload) {
            const ok = await waitForText(page, driver.expectTextAfterReload, EXPECT_TEXT_TIMEOUT)
            notes.push(ok ? `重载后历史文本命中：${driver.expectTextAfterReload}` : `重载后历史文本未命中：${driver.expectTextAfterReload}`)
            if (!ok) {
              result = 'fail'
              notes.push(`expectTextAfterReload：重载后「${driver.expectTextAfterReload}」未出现`)
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
          if (driver.keyClearUndo) {
            const key = driver.keyClearUndoKey === 'escape' ? 'Escape' : 'Control+c'
            const ok = await keyClearUndo(page, driver.keyClearUndo, key)
            notes.push(ok ? `双击清空（${key}）+Ctrl+Z 反悔链路通过：${driver.keyClearUndo}` : `keyClearUndo（${key}）链路失败：${driver.keyClearUndo}`)
            if (!ok) {
              result = 'fail'
              notes.push('keyClearUndo：武装提示/双击清空/Ctrl+Z 恢复 某一步断言未过')
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
          if (driver.expectAnswerDraft) {
            const ok = await waitForAnswerDraft(page, driver.expectAnswerDraft, 30_000)
            notes.push(ok ? `问答卡半答恢复：${driver.expectAnswerDraft}` : `问答卡半答未恢复：${driver.expectAnswerDraft}`)
            if (!ok) {
              result = 'fail'
              notes.push('expectAnswerDraft：重载后问答卡已填内容丢失')
            }
          }
          if (driver.expectPlaceholder) {
            const ok = await waitForPlaceholder(page, driver.expectPlaceholder, 30_000)
            notes.push(ok ? `占位符命中：${driver.expectPlaceholder}` : `占位符不含：${driver.expectPlaceholder}`)
            if (!ok) {
              result = 'fail'
              notes.push('expectPlaceholder：composer 占位符断言失败')
            }
          }
          // 断连横幅场景：前置 prompt/expectText 已断（会话有内容），这里进入
          // kill → 横幅 → respawn → 恢复 → 消息流续上的多阶段流程（自带幂等
          // cleanup，失败也不把沙盒残局留给后续条目）。
          if (driver.reconnect) {
            const rc = await runReconnectScenario(page, driver.reconnect, id, driver.expectText ?? '', notes)
            extraShots.push(...rc.shots)
            if (!rc.ok) result = 'fail'
          }
          // 拖拽遮罩项收尾：断言都在遮罩还在时做完，截图也留在遮罩态；截完这一项
          // 由调用方补一次 dragleave，免得遮罩残到后面几项的画面里。
          if (driver.dropFiles && driver.dropFilesDragOnly) dragLeavePending = true
        })(), `条目 ${id} 整体执行`, ITEM_HARD_TIMEOUT)
      } catch (err) {
        result = 'fail'
        notes.push(`执行异常：${err.message}`)
        if (err.watchdog) notes.push(frameSnapshot(page))
      }

      // 截图（整页可见区域，保证 webview iframe 内容渲染进截图；场景内多阶段
      // 截图在前、最终状态图在后）
      const shotPath = resolve(outDir, `${id}.png`)
      try {
        await page.screenshot({ path: shotPath })
      } catch (e) {
        notes.push(`截图失败：${e.message}`)
      }

      if (dragLeavePending) {
        await dragLeaveOnChat(page)
        dragLeavePending = false
      }

      // 写回 ledger
      item.result = result
      if (notes.length) item.notes = notes.join('；')
      item.screenshots = [...extraShots, shotPath]
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
