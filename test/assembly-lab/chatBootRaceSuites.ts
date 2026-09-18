/**
 * 对话面板启动注入套件（#205 / #211）。
 *
 * 验的是什么：**用户看到的东西**——宿主注入了哪条会话，那条会话的正文就真的渲染在页面上，
 * 而不是「外壳在、对话区停在官方空态」；并且页面上不该出现「目标没落定」那类行。
 * **目标开不了时**（#211 的用户拍板）：这一页要落到**官方新对话页**（hero 标题 + 可用的
 * composer），不许停在「没有当前会话」的那种空态，也不许回退到恢复键那条别的会话。
 *
 * 为什么这么写：#205 的现场日志里那句
 * `opening session … timed out; revealing the shell anyway` 被当成了「注入跟官方恢复
 * 抢选中值、抢输了」的判据。实验室实测把它推翻了——**那句 warn 当时不看到达状态**，
 * 凡是带注入的页面（哪怕一路正常）5 秒一到都会打；而恢复键写别的会话 / 写空 / 写一条
 * 不存在的 id，五种现场下页面全都正常渲染目标会话。真正的坏法是**目标压根没成为页面
 * 的当前会话**：`current` 只在本页会话清单里有这条时才成立（官方 `buildListSnapshot`
 * 的判据），于是「这条会话在这页开不了」（回收站里的、或这一页清单里没有的）会让对话区
 * 停在官方空态——**只有外壳、没有内容**——而旧写法把「一眼没看到目标」当成「已经定
 * 下来」，既不再喊也不再往宿主上报，日志里只剩下遮罩那句。所以本套件直接判「正文渲染
 * 出来了没有」与「有没有目标没落定的行」，并在第二、三档用**打不开的目标**把「正文
 * 判据确实判得出红」钉住（否则这条判据可能在空态上假绿）。
 *
 * #211 在第二、三档上加的那一半：目标开不了时**落点**必须是官方新对话页（判据落在
 * 用户看得见的两样东西上——hero 那句标题在对话区里、composer 的占位是官方 hero 那一条；
 * 并配一条机制证据 `boot-timing fallback-new-conversation`）。为什么另判「占位」这一格：
 * 官方那句空态的占位是另一条文案，实测那一档连 `data-placeholder` 都不写——只看「有标题、
 * 有输入框」会在空态上假绿（改前就是这样）。第三档再加一条「没有停在恢复键那条别的会话上」，
 * 对应用户拍板里那句「也不回退到上一个能开的会话」。
 *
 * 四档都用隔离实例里播种的真数据（不写死会话名；文案从词典取、zh / en 两份都认）：
 * 1. **恢复键抢同一个选中值**（用户现场的形状）：页面的官方恢复键先写成**另一条**会话，
 *    宿主再注入目标——对话区里必须是目标那条的正文，页面上零「没落定」的行；
 * 2. **真正的坏法（归档目标）**：目标会话在网关的归档名单里（客户端据此不认它是当前
 *    会话），页面开不了它——如实记下「对话区里没有它的正文」，判页面**说得出原因**，
 *    并判落点是新对话页；
 * 3. **负向对照（不存在的 id）**：同一套正文判据在这一档必须为假——证明它不是「外壳在
 *    就算过」；落点同样必须是新对话页，且不在恢复键那条会话上。文案是环境输入，所以
 *    原因那句只判「有这一句」，原因内容如实记成事实。
 * 4. **运行时就地切换**（侧栏点会话行打开对话面板走的就是这条路）：同一条「盯住目标」
 *    通路——切到一条开不了的会话时必须说得出原因（改前这条路一个字都不说），紧接着切到
 *    一条正常会话时对话区必须换成它的正文。**这条通路上不落新对话页**：用户点的是某一条
 *    具体的会话，说清「开不了它」比擅自换成新会话更贴他的意图（落点在 session-boot 的
 *    `fallbackEligible`）。
 *
 * 本套件会往隔离实例里真归档一条播种会话（第二档要的就是「打不开的目标」），实例在整轮
 * 跑完时按 PID 收掉、临时 `DSH_HOME` 一起删掉，所以这条写入不会留到下一次运行；它排在
 * 套件清单末尾（后面只有 R-06 那一条不读会话的收尾判据），也影响不到别的套件。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import type { Page } from 'playwright'
import { contractGaps, openTreePage, texts, type Check, type OpenedPage } from './harness.ts'
import { LAB_TREES, type LabTreeRoute } from './labServer.ts'
import { archiveSession, listSessions, type SessionSummary } from '../../src/server/dshRpc.ts'
import type { LabSuite, SuiteContext } from './suites.ts'

const route = (name: string): LabTreeRoute => {
  const found = LAB_TREES.find((candidate) => candidate.route === name)
  if (found === undefined) throw new Error(`lab: unknown tree route ${name}`)
  return found
}

async function shot(ctx: SuiteContext, page: Page, name: string): Promise<string> {
  const file = path.join(ctx.shots, `${name}.png`)
  await fsp.mkdir(ctx.shots, { recursive: true })
  await page.screenshot({ path: file })
  return file
}

const squeeze = (text: string): string => text.replace(/\s+/g, ' ').trim()

/**
 * 这条会话「只属于它」的那句正文：它第一轮用户话的开头（官方 `turnOutline` 投影里那一格，
 * 取证见 #205 的汇报）。拿不到时退回标题——两种字符串判「正文渲染出来了没有」都够用，
 * 取哪一种是事实，写进报告。
 */
function ownTextOf(session: SessionSummary): { text: string; from: 'turnOutline' | 'title' } {
  const values = session.projections?.values ?? {}
  const outline = values.turnOutline
  if (Array.isArray(outline)) {
    const first = outline[0]
    if (typeof first === 'object' && first !== null) {
      const prompt = (first as { prompt?: unknown }).prompt
      if (typeof prompt === 'string' && prompt.trim() !== '') return { text: squeeze(prompt).slice(0, 24), from: 'turnOutline' }
    }
  }
  const title = values.title
  return { text: typeof title === 'string' ? squeeze(title).slice(0, 24) : '', from: 'title' }
}

/** 页面上「用户看得见的那块对话区」的读数。 */
interface BodyReading {
  /** 对话区（官方 `[data-conversation-scroll]`）里的正文，压缩空白后的前 400 字。 */
  scrollText: string
  /** 遮罩还在不在（`[data-opening-mask]`）。 */
  mask: number
  /** 会话头槽位里的文字（官方那枚显示当前会话标题）。 */
  header: string
  /** 输入框的占位/文字（官方空态与有会话时不同，只记事实）。 */
  composer: string
  /**
   * composer 上官方写的占位原文（`data-placeholder`；没这一格时 null）。
   *
   * 为什么单独取它：官方「新对话页」与「没有当前会话」的空态用的是**两条不同**的占位
   * （`placeholder.hero` vs `placeholder.workspace`），而实测空态那一档连 `data-placeholder`
   * 都不写（#211 的改前读数）——所以这一格是「composer 到底能不能用」的判据（见
   * `checkNewConversationLanding`）。
   */
  composerPlaceholder: string | null
}

async function readBody(page: Page): Promise<BodyReading> {
  return page.evaluate(() => {
    const scroll = document.querySelector('[data-conversation-scroll]')
    const composer = document.querySelector('[data-slot="conversation.composer.bar"]')
    const squeezeText = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim()
    return {
      scrollText: squeezeText(scroll?.textContent).slice(0, 400),
      mask: document.querySelectorAll('[data-opening-mask]').length,
      header: squeezeText(document.querySelector('[data-slot="conversation.session.header"]')?.textContent).slice(0, 120),
      composer: squeezeText(
        composer?.querySelector('[contenteditable="true"]')?.getAttribute('data-placeholder') ?? composer?.textContent,
      ).slice(0, 80),
      composerPlaceholder: composer?.querySelector('[contenteditable="true"]')?.getAttribute('data-placeholder') ?? null,
    }
  })
}

/**
 * 官方「新对话页」的两条可见元素（#211），期望值都从词典来（zh / en 两份都认）。
 *
 * 出处：`@deepseek-ai/dsh-client-ui-conversation` 的 `lib/client.js`——
 * `hero.headline`（hero 那句标题）与 `placeholder.hero`（hero 态 composer 的占位）。
 */
const NEW_CONVERSATION_HEADLINE = '探索未至之境'
const NEW_CONVERSATION_COMPOSER = '描述你想要构建的内容, / 调用指令, @ 文件或对话'

/**
 * 判「这一页落在官方新对话页上」（#211 的判据，落在**用户看得见的东西**上）：
 *
 * 1. 对话区里出现 hero 那句标题 —— 对话区不是空的、也不停在别的东西上；
 * 2. composer 的占位是官方 hero 那一句 —— 输入框**可见可用**（官方「没有当前会话」的空态
 *    用的是另一条 `placeholder.workspace`「选择一个工作区开始」，实测那一档连
 *    `data-placeholder` 都不写：改前读数就是 null）；
 * 3. 落点是经官方那条「新会话」入口走的（`boot-timing fallback-new-conversation`）——
 *    这一条是我们这边的机制证据，与上面两条人看得见的事实配对。
 */
function checkNewConversationLanding(check: Check, body: BodyReading, trace: readonly string[], where: string): void {
  const headline = texts(NEW_CONVERSATION_HEADLINE)
  const composer = texts(NEW_CONVERSATION_COMPOSER)
  const placeholder = body.composerPlaceholder ?? ''
  check.ok(
    `${where} 落到官方新对话页：对话区里出现 hero 那句标题（不是空槽、也不是停在别的会话上）`,
    headline.some((text) => body.scrollText.includes(text)),
    `hero 标题（zh/en 两份）=${JSON.stringify(headline)}；对话区正文=${JSON.stringify(body.scrollText)}`,
  )
  check.ok(
    `${where} composer 可见可用（占位是官方 hero 那一句，不是「选择一个工作区开始」那种空态）`,
    composer.some((text) => placeholder.includes(text)),
    `hero 占位（zh/en 两份）=${JSON.stringify(composer)}；实测占位=${JSON.stringify(body.composerPlaceholder)}`,
  )
  check.ok(
    `${where} 落点走的是官方那条「新会话」入口（boot-timing fallback-new-conversation）`,
    trace.some((line) => line.includes('boot-timing fallback-new-conversation')),
    trace.filter((line) => line.includes('boot-timing')).join(' | '),
  )
}

/** 启动轨迹里出现过哪些 `boot-timing` 阶段。 */
function bootPhases(opened: OpenedPage): string[] {
  return opened.capture.all
    .filter((line) => line.includes('boot-timing'))
    .map((line) => line.match(/boot-timing ([a-z-]+)/)?.[1] ?? '?')
}

/** 页面上说「目标没落定」的行（我们按实际读数说的那句 + 遮罩那句）。 */
function notSettledLines(opened: OpenedPage): string[] {
  return opened.capture.consoleWarnings.filter(
    (line) =>
      line.includes('did not become current within') || line.includes('timed out; revealing the shell anyway'),
  )
}

export const CHAT_BOOT_RACE_SUITE: LabSuite = {
  id: 'F-62',
  phase: 'new-feature',
  name: '对话面板启动注入：注入哪条会话，那条的正文就真的渲染出来；目标开不了时落到官方新对话页（#205/#211）',
  expect:
    '实验室自起的隔离实例 + 播种的真数据（不碰用户那台；会话名不写死，文案从词典取、zh / en 两份都认）。① **恢复键抢同一个选中值**（用户现场的形状）：一页 chat 树，官方恢复键（`dsh.sessions.current`）先写成**另一条**真会话，页面再带 `?session=<目标>` 注入目标——判「对话区里渲染的是**目标**那条的正文」（对话区正文里出现目标那条自己那句话、会话头写着它的标题：判的是用户看得见的那块区域，不是「外壳在」），且页面上**零**「目标没落定」的行（遮罩那句与按实际读数说的那句都不许有），`boot-timing` 里 `first-meta` 报的必须是目标会话（宿主拿得到这一页的身份）；同页零 pageerror、零崩溃、零装载未激活。② **真正的坏法（归档目标）**：目标会话只能在网关的归档名单里，页面不认它是当前会话——如实记下对话区里**没有**它的正文，判页面上说得出目标为什么没落定（`did not become current within …`，原因如实记成事实），并判**落点是官方新对话页**（#211 用户拍板：对话区里出现 hero 那句标题、composer 的占位是官方 hero 那一条＝输入框可见可用，且启动轨迹里有 `fallback-new-conversation`）；**同一套正文判据在这一档为假**，等于给①那条判据配了负向对照。③ **负向对照（不存在的 id）**：正文判据同样为假、页面照样说得出原因，落点同样必须是新对话页，并且**没有停在恢复键那条别的会话上**（用户拍板里「也不回退到上一个能开的会话」那一句）——改前这一档正是用那条会话的正文兜住的。④ **运行时就地切换**（侧栏点会话行打开对话面板走的就是这条路）：同一页上按宿主的方式发出 `dshOne.switchSession`——先切到那条开不了的会话，页面必须说得出原因（改前这条路一个字都不说；这条通路**不**落新对话页：用户点的是某一条具体的会话）；再切到一条正常会话，对话区必须换成它的正文（切换的既有行为没被这条通路带坏）；全程零 pageerror。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const sessions = await listSessions(ctx.lab.gateway)
    const usable = sessions.filter((row) => row.blank !== true)
    check.fact(`隔离实例会话 ${String(sessions.length)} 条（非 blank ${String(usable.length)} 条）`)
    if (usable.length < 3) {
      check.ok('隔离实例至少有 3 条非 blank 会话可供注入', false, `usable=${String(usable.length)}`)
      return screenshots
    }
    const target = usable[0]
    const archived = usable[1]
    const restoreKey = usable[2]
    const own = ownTextOf(target)
    const archivedOwn = ownTextOf(archived)
    check.fact(
      `注入目标=${target.sessionId.slice(0, 13)}（自证正文来自 ${own.from}：${JSON.stringify(own.text)}）；` +
        `恢复键写=${restoreKey.sessionId.slice(0, 13)}；归档目标=${archived.sessionId.slice(0, 13)}（${JSON.stringify(archivedOwn.text)}）`,
    )
    if (own.text === '') {
      check.ok('目标会话能取到一句自证正文（正文判据的输入）', false, JSON.stringify(target.projections?.values ?? {}))
      return screenshots
    }
    await archiveSession(ctx.lab.gateway, archived.sessionId)

    /** 一页的共用装置：宿主注入 `sessionId`，页面官方恢复键写成 `restore`，重载后读末态。 */
    const openWithRestoreKey = async (
      sessionId: string,
      restore: string,
    ): Promise<{ opened: OpenedPage; body: BodyReading }> => {
      const opened = await openTreePage(ctx.browser, ctx.lab, route('chat'), {
        width: 1200,
        height: 900,
        sessionId,
      })
      await opened.context.addInitScript({
        content: `try { localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: ${JSON.stringify(restore)} })) } catch {}`,
      })
      opened.capture.all.length = 0
      opened.capture.consoleWarnings.length = 0
      await opened.page.reload({ waitUntil: 'domcontentloaded' })
      await opened.page.waitForSelector(route('chat').readySelector, { timeout: 40_000 })
      // 6 秒：跨过遮罩那 5 秒的兜底点，没有「没落定」这件事才有资格说没有。
      await opened.page.waitForTimeout(6_000)
      return { opened, body: await readBody(opened.page) }
    }

    // ---------------------------------------------------------------------
    // 一、恢复键抢同一个选中值：目标正文必须真的渲染出来
    // ---------------------------------------------------------------------
    let first: OpenedPage | undefined
    try {
      const { opened, body } = await openWithRestoreKey(target.sessionId, restoreKey.sessionId)
      first = opened
      const stored = await first.page.evaluate(() => localStorage.getItem('dsh.sessions.current'))
      check.fact(
        `① 页面读数：遮罩=${String(body.mask)} 会话头=${JSON.stringify(body.header)} 输入框=${JSON.stringify(body.composer)} ` +
          `对话区正文=${JSON.stringify(body.scrollText)}`,
      )
      check.fact(`① boot-timing 阶段=${JSON.stringify(bootPhases(first))} 恢复键末值=${JSON.stringify(stored)}`)
      check.ok(
        '① 对话区里渲染的是**注入目标**那条会话的正文（不是停在官方空态、也不是恢复键那条）',
        body.scrollText.includes(own.text),
        `目标自证正文=${JSON.stringify(own.text)}（来自 ${own.from}）；对话区正文=${JSON.stringify(body.scrollText)}`,
      )
      check.ok(
        '① 会话头写着目标那只会话的标题（用户看得出开的是哪条）',
        (target.projections?.values?.title ?? '') !== '' && body.header.includes(String(target.projections?.values?.title)),
        `会话头=${JSON.stringify(body.header)}`,
      )
      check.ok(
        '① 页面上零「目标没落定」的行（遮罩那句 + 按实际读数说的那句都不许有）',
        notSettledLines(first).length === 0,
        JSON.stringify(notSettledLines(first)),
      )
      check.ok(
        '① 启动轨迹里 first-meta 报的就是目标会话（宿主拿得到这一页的身份）',
        first.capture.all.some(
          (line) => line.includes('boot-timing first-meta') && line.includes(target.sessionId.slice(0, 13)),
        ),
        first.capture.all.filter((line) => line.includes('boot-timing')).join(' | '),
      )
      const gaps = contractGaps(first.capture)
      check.eq('① 零 slot entry crashed / 零装载未激活', [...gaps.crashes, ...gaps.bootFails], [])
      check.eq('① 零 pageerror', gaps.pageErrors, [])
      screenshots.push(await shot(ctx, first.page, 'chat-boot-restorekey-other'))
    } finally {
      await first?.context.close()
    }

    // ---------------------------------------------------------------------
    // 二、真正的坏法：目标这一页开不了（在网关的归档名单里）——#211 起还要落到新对话页
    // ---------------------------------------------------------------------
    let second: OpenedPage | undefined
    try {
      const { opened, body } = await openWithRestoreKey(archived.sessionId, restoreKey.sessionId)
      second = opened
      const lines = notSettledLines(second)
      check.fact(
        `② 页面读数：遮罩=${String(body.mask)} 会话头=${JSON.stringify(body.header)} 输入框=${JSON.stringify(body.composer)} ` +
          `占位=${JSON.stringify(body.composerPlaceholder)} 对话区正文=${JSON.stringify(body.scrollText)}`,
      )
      check.fact(`② 没落定的行=${JSON.stringify(lines)} boot-timing 阶段=${JSON.stringify(bootPhases(second))}`)
      check.ok(
        '② 归档目标：对话区里**没有**它的正文（#205 那一档的旧读数就是用户看到的「只有外壳」）',
        archivedOwn.text === '' || !body.scrollText.includes(archivedOwn.text),
        `归档目标自证正文=${JSON.stringify(archivedOwn.text)}；对话区正文=${JSON.stringify(body.scrollText)}`,
      )
      check.ok(
        '② 归档目标：页面上说得出目标为什么没落定（这一档也是①那条正文判据的负向对照）',
        lines.some((line) => line.includes('did not become current within')),
        JSON.stringify(lines),
      )
      // #211（用户拍板）：目标开不了时对话面板落到「新对话页」，不停在官方那句没有当前会话
      // 的空态上。**改前这一档读到的是"某个会话的正文 / 空态"**，所以这三条就是负向对照。
      checkNewConversationLanding(check, body, second.capture.all, '② 归档目标：')
      check.eq('② 零 pageerror', contractGaps(second.capture).pageErrors, [])
      screenshots.push(await shot(ctx, second.page, 'chat-boot-target-unopenable'))
    } finally {
      await second?.context.close()
    }

    // ---------------------------------------------------------------------
    // 三、负向对照：一条不存在的会话在页面上同样判不出正文；#211 起还要落到新对话页，
    //     而且**不许**停在恢复键那条「上一个能开的会话」上
    // ---------------------------------------------------------------------
    let third: OpenedPage | undefined
    try {
      const ghost = 'session-lab-missing-000'
      const restoreOwn = ownTextOf(restoreKey)
      const { opened, body } = await openWithRestoreKey(ghost, restoreKey.sessionId)
      third = opened
      check.fact(
        `③ 页面读数：遮罩=${String(body.mask)} 会话头=${JSON.stringify(body.header)} 对话区正文=${JSON.stringify(body.scrollText)}`,
      )
      check.fact(`③ 没落定的行=${JSON.stringify(notSettledLines(third))}`)
      check.ok(
        '③ 注入一条不存在的会话：正文判据为假（对话区里没有它的正文）——判据不是「外壳在就算过」',
        !body.scrollText.includes(own.text) && !body.scrollText.includes(ghost),
        `目标自证正文=${JSON.stringify(own.text)}；对话区正文=${JSON.stringify(body.scrollText)}`,
      )
      check.ok(
        '③ 同一档里页面也说得出原因（这条不在这一页的会话清单里）',
        notSettledLines(third).some((line) => line.includes('did not become current within')),
        JSON.stringify(notSettledLines(third)),
      )
      checkNewConversationLanding(check, body, third.capture.all, '③ 不存在的 id：')
      // 用户拍板里那一句「也**不**回退到上一个能开的会话」：这一档的官方恢复键指着**另一条
      // 真会话**（打开得开、也有正文），改前页面就是用它的正文兜住的。
      check.ok(
        '③ 注入不存在的 id：页面没有停在恢复键那条别的会话上（用户拍板：不回退到「上一个能开的会话」）',
        restoreOwn.text === '' || !body.scrollText.includes(restoreOwn.text),
        `恢复键会话自证正文=${JSON.stringify(restoreOwn.text)}（来自 ${restoreOwn.from}）；对话区正文=${JSON.stringify(body.scrollText)}`,
      )
      check.eq('③ 零 pageerror', contractGaps(third.capture).pageErrors, [])
      screenshots.push(await shot(ctx, third.page, 'chat-boot-ghost-target'))
    } finally {
      await third?.context.close()
    }

    // ---------------------------------------------------------------------
    // 四、运行时就地切换（侧栏点会话行走的就是这条路）：同一条「盯住目标」
    // ---------------------------------------------------------------------
    let fourth: OpenedPage | undefined
    try {
      const other = usable[3] ?? usable[0]
      const otherOwn = ownTextOf(other)
      const { opened } = await openWithRestoreKey(target.sessionId, restoreKey.sessionId)
      fourth = opened
      const switchTo = async (sessionId: string): Promise<void> => {
        await fourth?.page.evaluate((id) => {
          window.postMessage({ type: 'dshOne.switchSession', sessionId: id }, '*')
        }, sessionId)
      }
      // ① 切到一条**开不了**的会话（在回收站里）：页面必须说得出原因。改前这条路一个字
      //    都不说（抛出的错被吞掉、也不重试），用户看到的是「点了没反应」。
      await switchTo(archived.sessionId)
      await fourth.page.waitForTimeout(2_500)
      const afterBad = await readBody(fourth.page)
      const badLines = fourth.capture.consoleWarnings.filter((line) => line.includes('did not become current within'))
      check.fact(
        `④ 切到开不了的会话后：会话头=${JSON.stringify(afterBad.header)} 输入框=${JSON.stringify(afterBad.composer)} ` +
          `对话区正文=${JSON.stringify(afterBad.scrollText.slice(0, 120))} 行=${JSON.stringify(badLines)}`,
      )
      check.ok(
        '④ 切换目标开不了时页面说得出原因（改前这条路一个字都不说）',
        badLines.length >= 1,
        JSON.stringify(fourth.capture.consoleWarnings),
      )
      // ② 再切到一条正常会话：对话区换成它的正文——同一条通路换成正常目标不许被带坏。
      await switchTo(other.sessionId)
      await fourth.page.waitForTimeout(2_500)
      const afterGood = await readBody(fourth.page)
      check.fact(
        `④ 切到正常会话后：会话头=${JSON.stringify(afterGood.header)} 对话区正文=${JSON.stringify(afterGood.scrollText.slice(0, 120))}`,
      )
      check.ok(
        '④ 切到正常会话后对话区渲染的是它的正文',
        otherOwn.text !== '' && afterGood.scrollText.includes(otherOwn.text),
        `目标自证正文=${JSON.stringify(otherOwn.text)}（来自 ${otherOwn.from}）；对话区正文=${JSON.stringify(afterGood.scrollText)}`,
      )
      check.eq('④ 零 pageerror', contractGaps(fourth.capture).pageErrors, [])
      screenshots.push(await shot(ctx, fourth.page, 'chat-switch-session'))
    } finally {
      await fourth?.context.close()
    }

    return screenshots
  },
}
