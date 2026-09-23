/**
 * 启动自愈套件（#228，F-67）：官方启动审计报「某条目起不来」时，**页面自己**把点名的
 * 那条从本页清单里摘掉、把这一页重载**一次**；再失败就落到失败提示条（#201 那条）。
 *
 * ## 现场怎么造（详见 bootDrift.ts 的文件头）
 *
 * 实验室页面的 `?drift=` 参数往这一页的清单里加一条**没有任何 bundle 会注册**的条目，
 * 官方装载器取代码时找不到注册 → 官方启动审计报 `web boot: 1 entry did not activate`
 * 并点名那条 id（0.1.6-alpha.2 实测）。两条取值对应两件事：
 *
 * - `sick:<id>`：每次加载都加同一个 id → 自愈救得回来（摘掉它，重载后这一页正常）；
 * - `fresh:<前缀>`：每次加载换一个新 id → 自愈救不了（摘掉的那条下一轮不存在，
 *   新的一条又冒出来）→ 正好验「只试一次，不再接着摘」。
 *
 * `?selfHeal=off` 是**负向对照**那一档：同一个现场、把补救去掉（`pageHtml` 的实验开关，
 * 见 `AssemblyPageOptions.selfHeal`），页面照旧被官方那张失败卡挡住。
 *
 * ## 判据落在用户看到的东西上
 *
 * ① 负向对照：现场成立（`#root` 里是官方那句 `Failed to load plugins`、自有内容零枚、
 * 这一页只加载过一次）；② 自愈成功：首屏就绪、自有内容在、**这一页恰好加载了两次**、
 * 被摘的那条从本页清单三处（entries / 批 entries / 批 combo URL）都没了、页面上留了
 * 「摘了谁」的痕迹；③ 「只试一次」：`fresh:` 现场重载一次之后再失败——**加载次数停在
 * 2**（静置后仍不变，没有反复摘/反复重启），失败提示条落在页面上且原因里有官方那句
 * `did not activate`，本页清单第二次没有被再摘；④ **留痕**：摘的那一行日志里有 id 与
 * 「因为什么」（官方那段审计原文），原始审计错误照旧在控制台（这层只旁听、不吞）。
 *
 * ## 「只试一次」为什么能在页面上数清
 *
 * 加载次数由一条页内初始化脚本记进 `sessionStorage`（重载照样保留，见 `OpenOptions.initScript`）
 * ——这是「这一页被加载了几次」的直接读数，比套件侧听 Playwright 的导航事件准（`goto`
 * 那一次会漏）。次数为 2 = 自愈重载了一次；次数停在 2 = 没有第二次。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import type { Page } from 'playwright'
import { openTreePage, type OpenedPage } from './harness.ts'
import { LAB_TREES, type LabTreeRoute } from './labServer.ts'
import { FRESH_DRIFT, MANY_DRIFT, MANY_DRIFT_ID_PREFIX, STABLE_DRIFT } from './bootDrift.ts'
import { PAGE_FAILURE_MARK } from '../../src/ui/assembly/failureNotice.ts'
import { SELF_HEAL_MARK, SELF_HEAL_MAX_IDS, SELF_HEAL_STORAGE_KEY } from '../../src/ui/assembly/selfHeal.ts'
import type { LabSuite, SuiteContext } from './suites.ts'

const route = (name: string): LabTreeRoute => {
  const found = LAB_TREES.find((candidate) => candidate.route === name)
  if (found === undefined) throw new Error(`lab: unknown tree route ${name}`)
  return found
}

/** 页内簿记键：这一页被加载了几次（见文件头）。 */
const LOAD_COUNT_KEY = 'lab-self-heal-loads'

/** 记加载次数的那条初始化脚本（页面任何脚本之前跑）。 */
const LOAD_COUNT_SCRIPT = `(() => {
  try {
    var key = ${JSON.stringify(LOAD_COUNT_KEY)}
    sessionStorage.setItem(key, String(Number(sessionStorage.getItem(key) ?? "0") + 1))
  } catch (ignored) {}
})()`

/** 合成漂移条目的 id（`sick:` 那一档每次加载都是它）。 */
const STABLE_ID = '@deepseek-ai/dsh-client-lab-drift'

/** `fresh:` 那一档的 id 前缀（每次加载带一个序号后缀，所以对不上任何固定 id）。 */
const FRESH_PREFIX = '@deepseek-ai/dsh-client-lab-drift-fresh'

/** 官方那句审计报错的头一行（F-01 的 `BOOT_FAIL_RE` 同一条口径）。 */
const AUDIT_LINE = 'web boot: 1 entry did not activate'

/** 自愈那一行日志的前缀（`selfHeal.ts` 的 report）。 */
const LOG_PREFIX = 'page self-heal:'

/** 官方失败卡上的文案（负向对照读的就是「用户看到的是它」）。 */
const OFFICIAL_CARD_TEXT = 'Failed to load plugins'

/** 页面上的读数（一次 evaluate 取全）。 */
interface HealReading {
  /** 这一页被加载了几次（页内簿记）。 */
  loads: number
  /** `<html>` 上那格「本页清单被页面自己摘过」的痕迹（没摘过时 null）。 */
  mark: string | null
  /** 此刻清单里还有没有漂移那条（按 id 前缀认，`fresh:` 一档对不上具体 id）。 */
  driftedInManifest: boolean
  /** 清单里还有几条以这个前缀开头的条目（三处：entries / 批 entries / 批 URL 文本）。 */
  driftCounts: { entries: number; batches: number; urls: number }
  /** 首屏就绪选择器在不在。 */
  ready: boolean
  /** 自有的那棵树的根在不在、里面有几个元素。 */
  treeRoot: number
  treeNodes: number
  /** `#root` 正文（压缩空白、截断）——负向对照读官方那张卡。 */
  rootText: string
  /** 失败提示条几枚、种类、可见盒、原因那一行的文字。 */
  notice: number
  noticeKind: string | null
  noticeBox: { width: number; height: number } | null
  noticeReason: string | null
  /** `sessionStorage` 里那份「上一轮摘了谁」的记录（#237：用完要清）。 */
  healRecord: string | null
}

async function readHeal(page: Page, prefix: string, readySelector: string): Promise<HealReading> {
  return page.evaluate(
    ({ loadKey, selfHealMark, failureMark, healKey, driftPrefix, readySelector: selector }) => {
      const squeeze = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim()
      const counts = { entries: 0, batches: 0, urls: 0 }
      const wire = (globalThis as { __DSH_BOOT__?: { entries?: { id?: unknown }[]; batches?: { entries?: unknown[]; url?: unknown }[] } }).__DSH_BOOT__
      if (wire !== undefined && wire !== null) {
        for (const row of wire.entries ?? []) {
          if (typeof row?.id === 'string' && row.id.startsWith(driftPrefix)) counts.entries += 1
        }
        for (const batch of wire.batches ?? []) {
          for (const id of batch.entries ?? []) if (typeof id === 'string' && id.startsWith(driftPrefix)) counts.batches += 1
          if (typeof batch.url === 'string') {
            const names = batch.url.split('/??')[1]?.split('&')[0]?.split(',') ?? []
            for (const name of names) if (name.startsWith(driftPrefix)) counts.urls += 1
          }
        }
      }
      const bar = document.querySelector(`[${failureMark}]`)
      const box = bar === null ? null : bar.getBoundingClientRect()
      const root = document.getElementById('root')
      const treeRoot = document.querySelectorAll('.dshOneTree_root')
      const treeNodes = treeRoot.length === 0 ? 0 : treeRoot[0].querySelectorAll('*').length
      return {
        loads: Number(sessionStorage.getItem(loadKey) ?? '0'),
        mark: document.documentElement.getAttribute(selfHealMark),
        driftedInManifest: counts.entries > 0 || counts.batches > 0,
        driftCounts: counts,
        ready: document.querySelectorAll(selector).length > 0,
        treeRoot: treeRoot.length,
        treeNodes,
        rootText: squeeze(root?.textContent).slice(0, 200),
        notice: document.querySelectorAll(`[${failureMark}]`).length,
        noticeKind: bar === null ? null : bar.getAttribute(failureMark),
        noticeBox: box === null ? null : { width: box.width, height: box.height },
        noticeReason: bar === null ? null : squeeze(bar.querySelector('[data-dshone-page-failure-reason]')?.textContent),
        healRecord: sessionStorage.getItem(healKey),
      }
    },
    {
      loadKey: LOAD_COUNT_KEY,
      selfHealMark: SELF_HEAL_MARK,
      failureMark: PAGE_FAILURE_MARK,
      healKey: SELF_HEAL_STORAGE_KEY,
      driftPrefix: prefix,
      readySelector,
    },
  )
}

async function shot(ctx: SuiteContext, page: Page, name: string): Promise<string> {
  const file = path.join(ctx.shots, `${name}.png`)
  await fsp.mkdir(ctx.shots, { recursive: true })
  await page.screenshot({ path: file })
  return file
}

/** 控制台里带某个串的行（留痕断言用）。 */
const linesWith = (opened: OpenedPage, needle: string): string[] => opened.capture.all.filter((line) => line.includes(needle))

export const SELF_HEAL_SUITE: LabSuite = {
  id: 'F-67',
  phase: 'new-feature',
  name: '启动自愈：官方启动审计点名某条目起不来时，页面自己摘掉那条并重载一次（一次为限，再失败落失败提示条）',
  expect:
    '装配页的启动自愈（#228，实现见 src/ui/assembly/selfHeal.ts）。现场由实验室的 `?drift=` 参数造：往本页清单里加一条没有任何 bundle 会注册的条目，官方启动审计照旧报 `web boot: 1 entry did not activate` 并点名那条 id。① **负向对照**（`?drift=sick:<id>&selfHeal=off`，同一现场、去掉补救）：`#root` 里是官方那句 `Failed to load plugins`、自有的树一个节点都没有、这一页只加载过一次——改前的样子就是它，必须红。② **自愈成功**（`?drift=sick:<id>`，每次加载都加同一条）：首屏就绪选择器出现、自有的树有内容、**这一页恰好加载了两次**、被摘的那条从本页清单三处（entries / 批的 entries / 批的 combo URL）一条不剩、`<html>` 上留下「摘了哪个 id」的痕迹、静置之后页面上零条失败提示条（救回来了就不该出现）、**那一份「上一轮摘了谁」的记录被清掉**（#237）。③ **只试一次**（`?drift=fresh:<前缀>`，每次加载换一个新 id，自愈救不了）：重载一次之后再失败——**加载次数停在 2**（再静置仍是 2，没有反复摘/反复重启），失败提示条落在页面上（可见盒非零、种类 assembly）、原因那一行里是官方那段审计原文（含 `did not activate`），本页清单**第二次没有被再摘**（痕迹是空的），而且**那份记录被清掉了**（#237：审计点名的是另一条 ⇒ 那次摘除不是解药，不再沿用到后面的加载；写清为什么清的那一行照旧进日志）。④ **规模阈值**（`?drift=many:<条数>`，条数取 `SELF_HEAL_MAX_IDS + 1`，一次点名这么多条 = 系统性故障的形状）：**这一页只加载过一次**（一条都不摘，也就没有重载）、点名的那些条目一条都没被摘（本页清单三处照旧）、`<html>` 上没有摘过的痕迹、`sessionStorage` 里没有写下任何记录、失败提示条落在页面上。⑤ **留痕**：四档里那一行日志都写明「摘了哪个 entry、因为什么」（含 id 与官方审计原文），且原始审计错误照旧出现在控制台（这层只旁听、不吞——否则 F-01 的「零装载未激活」就失去检测能力）。',
  run: async (ctx: SuiteContext, check): Promise<string[]> => {
    const sidebar = route('sidebar')
    const shots: string[] = []
    const open = (query: Record<string, string>, readyTimeoutMs: number): Promise<OpenedPage> =>
      openTreePage(ctx.browser, ctx.lab, sidebar, {
        width: 380,
        height: 900,
        readyTimeoutMs,
        settleMs: 2_000,
        initScript: LOAD_COUNT_SCRIPT,
        query,
      })

    // ----------------------------------------------------------------------
    // ① 负向对照：同一个现场把补救去掉 → 页面照旧被官方那张失败卡挡住
    // ----------------------------------------------------------------------
    const blocked = await open({ drift: `${STABLE_DRIFT}:${STABLE_ID}`, selfHeal: 'off' }, 12_000)
    const blockedRead = await readHeal(blocked.page, STABLE_ID, sidebar.readySelector)
    check.ok(
      '负向对照（`?selfHeal=off`）：同一现场下首屏没起来、自有的树一个节点都没有（页面被官方那张卡挡住）',
      !blocked.ready && blockedRead.treeRoot === 0,
      `ready=${String(blocked.ready)} treeRoot=${String(blockedRead.treeRoot)}`,
    )
    check.ok(
      '负向对照：`#root` 里就是官方那句 `Failed to load plugins`（用户看到的是官方失败卡）',
      blockedRead.rootText.includes(OFFICIAL_CARD_TEXT),
      `#root=${JSON.stringify(blockedRead.rootText)}`,
    )
    check.ok(
      '负向对照：这一页只加载过一次（没有补救就没有重载）',
      blockedRead.loads === 1,
      `loads=${String(blockedRead.loads)}`,
    )
    check.ok(
      '负向对照：清单里那条漂移条目仍在（没人摘它）',
      blockedRead.driftedInManifest,
      `entries=${String(blockedRead.driftCounts.entries)} 批=${String(blockedRead.driftCounts.batches)} url=${String(blockedRead.driftCounts.urls)}`,
    )
    check.fact(`负向对照 #root 正文：${blockedRead.rootText}`)
    shots.push(await shot(ctx, blocked.page, 'f-67-1-negative-control-blocked'))
    await blocked.context.close()

    // ----------------------------------------------------------------------
    // ② 自愈成功：摘掉点名的条目、重载一次、这一页正常渲染
    // ----------------------------------------------------------------------
    const healed = await open({ drift: `${STABLE_DRIFT}:${STABLE_ID}` }, 40_000)
    const healedRead = await readHeal(healed.page, STABLE_ID, sidebar.readySelector)
    check.ok(
      '自愈成功：首屏就绪选择器出现、自有的树有内容（该显示的都在）',
      healed.ready && healedRead.treeRoot > 0 && healedRead.treeNodes > 0,
      `ready=${String(healed.ready)} treeRoot=${String(healedRead.treeRoot)} treeNodes=${String(healedRead.treeNodes)}`,
    )
    check.ok(
      '自愈成功：这一页恰好加载了两次（自愈重载了一次，不是没重载也不是反复重载）',
      healedRead.loads === 2,
      `loads=${String(healedRead.loads)}`,
    )
    check.eq('自愈成功：被摘的那条从本页清单的 entries 里没了', healedRead.driftCounts.entries, 0)
    check.eq('自愈成功：被摘的那条从批的 entries 里没了', healedRead.driftCounts.batches, 0)
    check.eq('自愈成功：被摘的那条从批的 combo URL 里也没了', healedRead.driftCounts.urls, 0)
    check.eq(
      '自愈成功：`<html>` 上留下「这一页的清单被页面自己摘过」的痕迹，值就是那条 id',
      healedRead.mark,
      STABLE_ID,
    )
    check.ok(
      '自愈成功：页面上零条失败提示条（救回来了就不该出提示条）',
      healedRead.notice === 0,
      `notice=${String(healedRead.notice)}`,
    )
    // #237：记录用完要清——这一页真的起来了，那份「上一轮摘了谁」的记录就该没了。
    check.ok(
      '自愈成功：那份「上一轮摘了谁」的记录被清掉了（#237：根因消失后不再摘）',
      healedRead.healRecord === null,
      `记录=${JSON.stringify(healedRead.healRecord)}`,
    )
    // 留痕（①）：摘的那一行里有 id 与「因为什么」。
    const stripLines = linesWith(healed, `${LOG_PREFIX} the boot audit named [${STABLE_ID}]`)
    const stripLine = stripLines.find((line) => line.includes('reloading this page once')) ?? ''
    check.ok(
      '留痕：日志里有「摘了哪个 entry、因为什么」这一条（点名 id + 重载一次）',
      stripLine.includes(STABLE_ID) && stripLine.includes('did not activate'),
      `命中 ${String(stripLines.length)} 行；例如 ${JSON.stringify(stripLine.slice(0, 220))}`,
    )
    // 留痕（②）：原始审计错误没被吞——否则 F-01 的「零装载未激活」就瞎了。
    const rawAudit = healed.capture.consoleErrors.filter((line) => line.includes(AUDIT_LINE) && line.includes(STABLE_ID))
    check.ok(
      '留痕：官方那段审计错误照旧在控制台（这层只旁听、不吞——F-01 的检测能力因此还在）',
      rawAudit.length > 0,
      `命中 ${String(rawAudit.length)} 行；例如 ${JSON.stringify((rawAudit[0] ?? '').slice(0, 200))}`,
    )
    check.fact(
      `自愈成功的页面读数：loads=${String(healedRead.loads)} mark=${JSON.stringify(healedRead.mark)} 清单里的漂移=${JSON.stringify(healedRead.driftCounts)}`,
    )
    shots.push(await shot(ctx, healed.page, 'f-67-2-healed'))
    // 静置：救回来之后不该自己再重载（否则「只试一次」是假的）。
    await healed.page.waitForTimeout(2_500)
    const healedQuiet = await readHeal(healed.page, STABLE_ID, sidebar.readySelector)
    check.ok(
      '自愈成功：静置 2.5 秒后加载次数仍是 2（救回来就停手，不是反复重启）',
      healedQuiet.loads === 2,
      `loads=${String(healedQuiet.loads)}`,
    )
    await healed.context.close()

    // ----------------------------------------------------------------------
    // ③ 只试一次：重载之后再失败 → 落到失败提示条，不再摘、不再重载
    // ----------------------------------------------------------------------
    const stuck = await open({ drift: `${FRESH_DRIFT}:${FRESH_PREFIX}` }, 12_000)
    let noticeShown = true
    try {
      await stuck.page.waitForSelector(`[${PAGE_FAILURE_MARK}]`, { timeout: 15_000 })
    } catch {
      noticeShown = false
    }
    const stuckRead = await readHeal(stuck.page, FRESH_PREFIX, sidebar.readySelector)
    check.ok(
      '只试一次：重载之后仍然起不来（现场是救不了的那种，页面没起来）',
      !stuckRead.ready && stuckRead.treeRoot === 0,
      `ready=${String(stuckRead.ready)} treeRoot=${String(stuckRead.treeRoot)}`,
    )
    check.ok(
      '只试一次：这一页加载次数停在 2（重试一次为限，没有反复摘/反复重启）',
      stuckRead.loads === 2,
      `loads=${String(stuckRead.loads)}`,
    )
    check.ok(
      '只试一次：失败提示条落在页面上（一枚、可见盒非零、种类 assembly）',
      noticeShown && stuckRead.notice === 1 && stuckRead.noticeKind === 'assembly' && (stuckRead.noticeBox?.height ?? 0) > 0,
      `shown=${String(noticeShown)} notice=${String(stuckRead.notice)} kind=${JSON.stringify(stuckRead.noticeKind)} box=${JSON.stringify(stuckRead.noticeBox)}`,
    )
    check.ok(
      '只试一次：提示条把官方那段审计原文摆给用户（含 `did not activate`）',
      (stuckRead.noticeReason ?? '').includes('did not activate'),
      `reason=${JSON.stringify((stuckRead.noticeReason ?? '').slice(0, 220))}`,
    )
    check.ok(
      '只试一次：第二次没有再摘任何条目（本页清单的痕迹是空的）',
      stuckRead.mark === '',
      `mark=${JSON.stringify(stuckRead.mark)} 清单里的漂移=${JSON.stringify(stuckRead.driftCounts)}`,
    )
    // #237：这一页**没有**起来，而审计点名的是**另一条**（`fresh:` 每轮换 id）——那次摘除
    // 不是解药，记录不再沿用（两条路径都通向这里：审计先到走「点名的是别人」那条，内容先
    // 静一个窗口走「这一页渲染了、审计一直没报」那条）。
    check.ok(
      '只试一次：那份记录被清掉了（这次摘除不是解药，不再沿用到后面的加载）',
      stuckRead.healRecord === null,
      `记录=${JSON.stringify((stuckRead.healRecord ?? '').slice(0, 160))}`,
    )
    const forgetLines = linesWith(stuck, 'the retry record is cleared')
    check.ok(
      '留痕：清记录那一行写明为什么清（「点名的那几条都不是我们摘掉的」或「页面渲染了、审计静了一个窗口」）',
      forgetLines.some(
        (line) => line.includes('named none of the entries this page dropped') || line.includes('stayed quiet'),
      ),
      `命中 ${String(forgetLines.length)} 行；例如 ${JSON.stringify((forgetLines[0] ?? '').slice(0, 240))}`,
    )
    const reloadLines = linesWith(stuck, `${LOG_PREFIX} the boot audit named [`).filter((line) => line.includes('reloading this page once'))
    const stopLines = linesWith(stuck, 'failed again after the single retry')
    check.ok(
      '留痕：第一轮那行写明摘了谁（含 id 与官方审计原文）',
      reloadLines.some((line) => line.includes('did not activate')),
      `命中 ${String(reloadLines.length)} 行；例如 ${JSON.stringify((reloadLines[0] ?? '').slice(0, 220))}`,
    )
    check.ok(
      '留痕：第二轮那行写明不再摘（只试一次的那条日志）',
      stopLines.length === 1,
      `命中 ${String(stopLines.length)} 行；例如 ${JSON.stringify((stopLines[0] ?? '').slice(0, 220))}`,
    )
    // 两轮点名的 id 不是同一条（`fresh:` 现场的定义：每轮换一个）——这条钉住现场成立。
    // 两轮的 id 分别出现在两行里：第一轮那行在「摘了谁」的位置，第二轮那行在审计原文里
    // （第二轮不再摘，所以它的 id 只出现在「failed again」那行的原文中）。
    const auditSeqs = [
      ...new Set(
        (stuck.capture.all.join('\n').match(/dsh-client-lab-drift-fresh-\d+/g) ?? []),
      ),
    ]
    check.ok(
      '只试一次：两轮点名的 id 不是同一条（`fresh:` 现场按定义每轮换一个，这一条钉住现场成立）',
      auditSeqs.length >= 2,
      `读到的 id=${JSON.stringify(auditSeqs)}（第一轮在「摘了谁」那行、第二轮在审计原文里）`,
    )
    check.fact(`只试一次那一页 #root 正文：${stuckRead.rootText}`)
    // 诊断读数：这一拍页面上还抛出过什么（`Script error.` = 跨源经典脚本的错误被浏览器
    // 抹白——bootstrap 与 combo 都是跨源的经典 script）。被动捕获到的那一句可能比审计
    // 原文更早落进提示条，所以自愈显式交过去时带 force（见 failureNotice.ts 的 note）。
    check.fact(
      `只试一次那一页的未捕获错误：${JSON.stringify(stuck.capture.pageErrors.slice(0, 3))}；控制台错误里含 "Script error" 的 ${String(stuck.capture.consoleErrors.filter((line) => line.includes('Script error')).length)} 行`,
    )
    shots.push(await shot(ctx, stuck.page, 'f-67-3-retry-once-notice'))
    // 再静置一段：加载次数必须还是 2（「绝不循环」）。
    await stuck.page.waitForTimeout(3_000)
    const stuckQuiet = await readHeal(stuck.page, FRESH_PREFIX, sidebar.readySelector)
    check.ok(
      '只试一次：再静置 3 秒后加载次数仍是 2、提示条仍是一枚（没有第二次重载）',
      stuckQuiet.loads === 2 && stuckQuiet.notice === 1,
      `loads=${String(stuckQuiet.loads)} notice=${String(stuckQuiet.notice)}`,
    )
    await stuck.context.close()

    // ----------------------------------------------------------------------
    // ④ 规模阈值（#237）：一次点名太多 = 系统性故障 → 一条都不摘、不重载
    // ----------------------------------------------------------------------
    // 现场是「整批没到、几十条一起报」（用户那一页 49 条）。合成条目比阈值多一条，
    // 判据是**规模**：一次点名这么些条目时自愈收手，一条都不摘、把审计原文摆给用户。
    const manyCount = SELF_HEAL_MAX_IDS + 1
    const many = await open({ drift: `${MANY_DRIFT}:${String(manyCount)}` }, 12_000)
    let manyNoticeShown = true
    try {
      await many.page.waitForSelector(`[${PAGE_FAILURE_MARK}]`, { timeout: 20_000 })
    } catch {
      manyNoticeShown = false
    }
    const manyRead = await readHeal(many.page, MANY_DRIFT_ID_PREFIX, sidebar.readySelector)
    check.ok(
      '规模阈值：这一页没有起来（现场成立：条数超过阈值的系统性故障）',
      !manyRead.ready,
      `ready=${String(manyRead.ready)} 清单里的漂移=${JSON.stringify(manyRead.driftCounts)}`,
    )
    check.ok(
      `规模阈值：这一页只加载过一次（一次点名 ${String(manyCount)} 条 > 阈值 ${String(SELF_HEAL_MAX_IDS)}，自愈不摘、也就没有重载）`,
      manyRead.loads === 1,
      `loads=${String(manyRead.loads)}`,
    )
    check.eq(
      `规模阈值：点名的那 ${String(manyCount)} 条一条都没被摘（清单三处照旧）`,
      manyRead.driftCounts,
      { entries: manyCount, batches: manyCount, urls: 0 },
    )
    check.ok(
      '规模阈值：`<html>` 上没有任何「摘过谁」的痕迹',
      manyRead.mark === null,
      `mark=${JSON.stringify(manyRead.mark)}`,
    )
    check.ok(
      '规模阈值：失败提示条落在页面上（一枚、可见盒非零、原因里是官方审计原文）',
      manyNoticeShown && manyRead.notice === 1 && (manyRead.noticeBox?.height ?? 0) > 0,
      `shown=${String(manyNoticeShown)} notice=${String(manyRead.notice)} box=${JSON.stringify(manyRead.noticeBox)} reason=${JSON.stringify((manyRead.noticeReason ?? '').slice(0, 120))}`,
    )
    check.ok(
      '规模阈值：sessionStorage 里没有写下任何要摘的记录（一条都没摘）',
      manyRead.healRecord === null,
      `记录=${JSON.stringify(manyRead.healRecord)}`,
    )
    const manyLines = linesWith(many, 'which is a systematic failure rather than one broken entry')
    check.fact(
      `规模阈值读数：loads=${String(manyRead.loads)} 点名的条数=${String(manyCount)}（阈值 ${String(SELF_HEAL_MAX_IDS)}）清单三处=${JSON.stringify(manyRead.driftCounts)} ` +
        `痕迹=${JSON.stringify(manyRead.mark)} 记录=${JSON.stringify(manyRead.healRecord)} 提示条=${String(manyRead.notice)} 枚`,
    )
    check.ok(
      '留痕：日志里写明「这么多条一起报是系统性故障、一条都不摘」（含官方审计原文）',
      manyLines.some((line) => line.includes('did not activate')),
      `命中 ${String(manyLines.length)} 行；例如 ${JSON.stringify((manyLines[0] ?? '').slice(0, 240))}`,
    )
    shots.push(await shot(ctx, many.page, 'f-67-4-too-many-at-once'))
    await many.context.close()

    return shots
  },
}
