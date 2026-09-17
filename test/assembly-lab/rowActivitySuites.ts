/**
 * 工作区行的活状态计数与「vscode」胶囊（#138；#153 起计数是三档「运行中 / 等待交互 / 未读」——
 * 本套件量的是**这一枚角标整体**跟不跟标题文字走，三档各自的口径与读数归 F-49）。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与 `rowTierSuites.ts` / `recycleEntryAlignSuites.ts`
 * 同一条：那个文件是本批开发的合入热点，新套件放外面能少一半冲突面；注册方式是在
 * `suites.ts` 的 `SUITES` 末尾追加一项。
 *
 * 期望值一律从 `workspaceTree/styles.ts` 的档位表读（`SCALE_TIERS`），不硬编码：
 * 计数与标题文字之间的那一格间距取 `standard.rowGap`，胶囊的高 / 字号 / 行高 / 内边距 /
 * 圆角逐项取它那条规则上方写明的档。唯一的字面量是「±1px」这类判据容差。
 *
 * ## 判据里的两个关键定义（读断言时先看这两条）
 *
 * - **「标题右缘」说的是标题文字那一段的右缘**（`.dshOneTree_titleText` 的矩形），不是
 *   `.dshOneTree_title` 盒子的右缘。原因写在 `rows.ts` 的 ActivityBadge 说明里：标题盒在
 *   `projectText`（`flex:1` 的列容器）里是**撑满**的，盒子的右缘就是行的内容右缘，与文字
 *   在哪儿结束无关——用户要的「紧跟标题文字」只能按文字那一截量。标题盒本身不动是另一条
 *   判据（②，由本套件与 F-04 共同守）。
 * - **数据两只手都要用**：活状态计数要真跑着的会话（夹具把 `session/list` 回执里目标会话的
 *   `running` 翻成 true，**请求不落网关**，F-18 同一套处置）；「当前工作区」胶囊要假宿主
 *   上报打开的文件夹（`workspaceFolders` = 目标会话的 cwd，F-21 同一套处置）。两件落在
 *   **同一行**上，所以一次量得到计数与胶囊的几何关系。
 *
 * ## 判据对应 #138 的验收五条
 *
 * ① 计数紧跟标题（左缘 − 文字右缘 = 档位表的行内间隙 ±1px、与标题同一行、行尾层里不再有它）；
 * ② 标题盒不变（仍是撑满 `projectText` 的那个矩形、高度 = 标题档行高；官方基准那一侧由
 *    F-04 PARITY 逐项比对）；
 * ③ 胶囊更紧凑（高 / 字号 / 行高 / 内边距 / 圆角逐项落在档位表里能指出出处的档上，且高严格
 *    小于它改前取的那一档 `standard.smallPillHeight`）；
 * ④ 三档宽度（260/340/500）不溢出、不压字（列表与标题都不横向溢出；窄到标题真被省略号截断
 *    时文字先让位、计数照常可见，且计数与行尾胶囊不重叠）；
 * ⑤ 回归（当前工作区标识与排序、计数的语义「运行中 > 0 才渲染」、悬停时计数留在原地而胶囊
 *    让位、四枚动作按钮与行菜单照旧、零 pageerror）。
 *
 * 本套件**完全不碰网关的写面**：只改页面收到的回执、只读地量几何与开菜单。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { openTreePage, withoutKnownNoise, type OpenedPage } from './harness.ts'
import { LAB_TREES, type LabTreeRoute } from './labServer.ts'
import { SCALE_TIERS } from '../../src/ui/assembly/shell/workspaceTree/styles.ts'
import { listSessions } from '../../src/server/dshRpc.ts'
// 只取类型（编译后不留 import，运行期没有环）：套件接口定义在 suites.ts 里。
import type { LabSuite } from './suites.ts'

const route = (name: string): LabTreeRoute => {
  const found = LAB_TREES.find((candidate) => candidate.route === name)
  if (found === undefined) throw new Error(`lab: unknown tree route ${name}`)
  return found
}

/** 截图（与其它独立套件文件里那份同一写法：产物落在本轮 `ctx.shots` 下）。 */
async function shot(ctx: { shots: string }, page: OpenedPage['page'], name: string): Promise<string> {
  const file = path.join(ctx.shots, `${name}.png`)
  await fsp.mkdir(ctx.shots, { recursive: true })
  await page.screenshot({ path: file })
  return file
}

/** 三档宽度（与 F-04 / F-13 / F-29 / F-37 同一套：窄 / 用户侧栏 / 宽）。 */
const WIDTHS = [260, 340, 500] as const

/** ④ 的截断那一档：比三档都窄，标题文字一定装不下（判「文字让位、计数照常」）。 */
const NARROW_WIDTH = 200

/** 计数与标题文字之间的那一格间距：档位表标准档的行内间隙（官方 `…{gap:6px}`）。 */
const GAP = Number.parseFloat(SCALE_TIERS.standard.rowGap)

/** 胶囊「改前」取的那一档高度（容器档的小状态胶囊，官方 `.Nqubda_rowStatus{height:20px}`）。 */
const PREVIOUS_BADGE_HEIGHT = Number.parseFloat(SCALE_TIERS.standard.smallPillHeight)

interface Rect {
  x: number
  y: number
  w: number
  h: number
  right: number
  bottom: number
}

interface Overflow {
  scrollWidth: number
  clientWidth: number
}

/** 一行工作区行的读数（一次算完，避免多次 evaluate 之间页面状态漂移）。 */
interface RowReading {
  key: string
  current: boolean
  /** 这一行上有活状态计数（`[data-dshone-tree-activity]`）。 */
  hasActivity: boolean
  activityValue: string
  rowRect: Rect
  padLeft: number
  padRight: number
  projectTextRect: Rect
  titleRect: Rect
  titleFontSize: string
  titleLineHeight: string
  /** 标题**文字**那一段（`.dshOneTree_titleText`）。 */
  textRect: Rect
  /** 文字真被省略号截断（内容比盒子宽）。 */
  textClipped: boolean
  textOverflow: Overflow
  activityRect: Rect
  /** 计数装在标题盒里（`title.contains(activity)`）。 */
  activityInsideTitle: boolean
  /** 计数在行尾那一层里（改前的位置；断言要求 false）。 */
  activityInRowEnd: boolean
  /** 计数左边那 6px 的兄弟（文字那一段）确实是它的前一个兄弟。 */
  activityAfterText: boolean
  runningItems: number
  waitingItems: number
  /** #153 补的第三项（未读）。 */
  unreadItems: number
  activityLabel: string
  /** 行尾层里还剩什么（改后应当只有胶囊）。 */
  rowEndChildren: string[]
  rowEndDisplay: string
  /** 行尾胶囊（没有当前工作区时为 null）。 */
  badgeRect: Rect | null
  badgeHeight: string
  badgeFontSize: string
  badgeLineHeight: string
  badgePaddingInline: string
  badgeRadius: string
  badgeText: string
  /** 动作按钮（悬停才出现）里可见的枚数。 */
  actionButtons: number
  listOverflow: Overflow
  docOverflow: Overflow
}

/** 读一行工作区行（`keySelector` 定位那一行；缺省取「有计数的那一行」）。 */
async function readRow(page: OpenedPage['page'], keySelector?: string): Promise<RowReading | null> {
  return page.evaluate((selector: string | undefined) => {
    const round = (value: number): number => Math.round(value * 100) / 100
    const rectOf = (element: Element | null): Rect => {
      if (element === null) return { x: 0, y: 0, w: 0, h: 0, right: 0, bottom: 0 }
      const rect = element.getBoundingClientRect()
      return {
        x: round(rect.x),
        y: round(rect.y),
        w: round(rect.width),
        h: round(rect.height),
        right: round(rect.right),
        bottom: round(rect.bottom),
      }
    }
    const row =
      selector === undefined
        ? document.querySelector('[data-dshone-tree-row="workspace"] [data-dshone-tree-activity]')?.closest('[data-dshone-tree-row="workspace"]') ?? null
        : document.querySelector(selector)
    if (row === null) return null
    const title = row.querySelector('.dshOneTree_title')
    const projectText = row.querySelector('.dshOneTree_projectText')
    const activity = row.querySelector('[data-dshone-tree-activity]')
    const text = row.querySelector('.dshOneTree_titleText')
    const rowEnd = row.querySelector('.dshOneTree_rowEnd')
    const badge = row.querySelector('.dshOneTree_workspaceBadge')
    const badgeStyle = badge === null ? null : getComputedStyle(badge)
    const rowStyle = getComputedStyle(row)
    const titleStyle = title === null ? null : getComputedStyle(title)
    const list = document.querySelector('.dshOneTree_list')
    const px = (value: string): number => round(Number.parseFloat(value) || 0)
    const overflowOf = (element: Element | null): Overflow =>
      element === null ? { scrollWidth: 0, clientWidth: 0 } : { scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }
    return {
      key: row.getAttribute('data-dshone-tree-key') ?? '',
      current: row.getAttribute('data-dshone-tree-current') === 'true',
      hasActivity: activity !== null,
      activityValue: activity?.getAttribute('data-dshone-tree-activity') ?? '',
      rowRect: rectOf(row),
      padLeft: px(rowStyle.paddingLeft),
      padRight: px(rowStyle.paddingRight),
      projectTextRect: rectOf(projectText),
      titleRect: rectOf(title),
      titleFontSize: titleStyle?.fontSize ?? '',
      titleLineHeight: titleStyle?.lineHeight ?? '',
      textRect: rectOf(text),
      textClipped: text !== null && text.scrollWidth > text.clientWidth + 1,
      textOverflow: overflowOf(text),
      activityRect: rectOf(activity),
      activityInsideTitle: activity !== null && title !== null && title.contains(activity),
      activityInRowEnd: activity !== null && activity.closest('.dshOneTree_rowEnd') !== null,
      activityAfterText: activity !== null && text !== null && activity.previousElementSibling === text,
      runningItems: activity?.querySelectorAll('[data-dshone-tree-running]').length ?? 0,
      waitingItems: activity?.querySelectorAll('[data-dshone-tree-waiting]').length ?? 0,
      unreadItems: activity?.querySelectorAll('[data-dshone-tree-unread]').length ?? 0,
      activityLabel: activity?.querySelector('[data-dshone-tree-running]')?.getAttribute('title') ?? '',
      rowEndChildren: rowEnd === null ? [] : Array.from(rowEnd.children).map((child) => (child.getAttribute('class') ?? '').split(/\s+/).filter((name) => name.startsWith('dshOneTree_')).join('.')),
      rowEndDisplay: rowEnd === null ? 'absent' : getComputedStyle(rowEnd).display,
      badgeRect: badge === null ? null : rectOf(badge),
      badgeHeight: badgeStyle?.height ?? '',
      badgeFontSize: badgeStyle?.fontSize ?? '',
      badgeLineHeight: badgeStyle?.lineHeight ?? '',
      badgePaddingInline: badgeStyle === null ? '' : `${px(badgeStyle.paddingLeft)}px`,
      badgeRadius: badgeStyle?.borderRadius ?? '',
      badgeText: badge?.textContent ?? '',
      actionButtons: Array.from(row.querySelectorAll('.dshOneTree_rowActions .dshOneTree_rowIconButton')).filter(
        (button) => getComputedStyle(button).display !== 'none' && button.getBoundingClientRect().width > 0,
      ).length,
      listOverflow: overflowOf(list),
      docOverflow: overflowOf(document.documentElement),
    }
  }, keySelector)
}

/**
 * 把 `session/list` 回执里**目标会话**的 `running` 翻成 true（页内夹具）。
 *
 * 为什么用夹具：活状态计数的数据源是官方会话列表投影，本机网关当天没有跑着的会话，
 * 而套件不许写网关（R-06 只读守卫）。夹具只改**页面收到的回执**，请求不落到网关——
 * 与 F-18 的 `schedule` 夹具同一处置（那里也证明了「回执层面改动足以驱动树上的渲染」）。
 * 必须**重载页面**才生效：会话清单在页面挂载时就取过一轮。
 */
async function installRunningFixture(page: OpenedPage['page'], sessionId: string): Promise<{ calls: number; touched: number }> {
  const stats = { calls: 0, touched: 0 }
  await page.route('**/api/**', async (requestRoute) => {
    const request = requestRoute.request()
    const method = decodeURIComponent(request.url()).split('/api/')[1] ?? ''
    const response = await requestRoute.fetch()
    const body = await response.text()
    if (!method.startsWith('session/list')) {
      await requestRoute.fulfill({ response, body })
      return
    }
    stats.calls += 1
    const parsed = JSON.parse(body) as { result?: { value?: { items?: { sessionId?: string; running?: boolean }[] } } }
    for (const item of parsed.result?.value?.items ?? []) {
      if (item.sessionId !== sessionId) continue
      item.running = true
      stats.touched += 1
    }
    await requestRoute.fulfill({ response, body: JSON.stringify(parsed) })
  })
  return stats
}

export const ROW_ACTIVITY_SUITE: LabSuite = {
  id: 'F-39',
  phase: 'new-feature',
  name: '工作区行的活状态计数跟着标题文字走、vscode 胶囊收紧一档（ROW-ACTIVITY 套件）',
  expect:
    '#138：工作区行里「运行中 / 等待交互 / 未读」的计数从行尾那一层（绝对定位）挪到**工作区标题文字之后**（同一行），行尾那一层只剩「当前工作区」胶囊，且胶囊比改前更紧凑。真装配页 + 真网关**只读** + 假宿主 + 页内夹具（`session/list` 回执里把目标会话的 `running` 翻成 true，请求不落网关），量的是几何关系与档位取值：① **计数紧跟标题文字**——计数的左缘 − 标题**文字**那一段的右缘 = 档位表标准档的行内间隙（±1px），两者同一行（垂直中心差 ≤ 1px），计数装在标题盒里、不在行尾那一层里；② **标题盒不变**——`.dshOneTree_title` 仍是撑满 `projectText` 的那个矩形（宽 = `projectText` 的内容宽、高 = 标题档行高），没有因为计数而缩成文字宽（与官方基准的逐项比对在 F-04 PARITY）；③ **胶囊更紧凑**——`.dshOneTree_workspaceBadge` 的高 / 字号 / 行高 / 内边距 / 圆角逐项等于档位表里它那条规则上方写明的档（高 16px 严格小于改前那一档 `standard.smallPillHeight` 的 20px）；④ **三档宽度（260/340/500）不溢出、不压字**——列表与标题的 `scrollWidth ≤ clientWidth + 1`、计数整个落在标题盒里且不与行尾胶囊重叠；再压到 200px 让标题**真被省略号截断**（`scrollWidth > clientWidth + 1`）：文字先让位、计数照常可见、文字右缘仍不与胶囊重叠；⑤ **回归**——当前工作区标识（胶囊文案 = 宿主名、只有一个、排最前）、计数的语义（`1/0/0` 且只有运行中那一枚，等待交互与未读那两枚在没有对应会话时**不渲染**；三档各自的口径与读数归 F-49）、悬停时**计数留在原地不消失**而胶囊照旧让位、行尾动作按钮照旧出现、工作区行右键菜单照旧开出七项、全程零 pageerror。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    // 两道夹具都要落在**同一行**上：活状态计数的数据源是会话（把目标会话的 `running` 翻成
    // true），「当前工作区」胶囊的数据源是宿主上报的文件夹（目标会话的 cwd）。
    // 目标这么挑：先开一页读全部工作区行的标题文字宽，**取标题最长的那一棵**（④ 的「文字
    // 让位」那一段要有真会被截断的标题才量得出来），再从它里面挑一条真会话、拿它的 cwd。
    const sessions = await listSessions(ctx.lab.gateway).catch(() => [])
    const opening = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { width: 340, height: 900 })
    let picked: { key: string; title: string; textWidth: number; sessionId: string; cwd: string } | null = null
    try {
      const rows = await opening.page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-dshone-tree-row="workspace"]')).map((row) => {
          const text = row.querySelector('.dshOneTree_titleText')
          const range = document.createRange()
          let width = 0
          if (text !== null) {
            range.selectNodeContents(text)
            width = range.getBoundingClientRect().width
          }
          return {
            key: row.getAttribute('data-dshone-tree-key') ?? '',
            title: text?.textContent ?? '',
            textWidth: Math.round(width * 100) / 100,
            expanded: row.getAttribute('aria-expanded') === 'true',
          }
        }),
      )
      check.fact(`工作区行（按标题文字宽降序）：${JSON.stringify(rows.slice().sort((a, b) => b.textWidth - a.textWidth).slice(0, 5))}`)
      for (const candidate of rows.filter((row) => row.key !== '').sort((a, b) => b.textWidth - a.textWidth)) {
        if (!candidate.expanded) {
          await opening.page.click(`[data-dshone-tree-key="${candidate.key}"]`)
          await opening.page.waitForTimeout(400)
        }
        const sessionId = await opening.page.evaluate(
          (key: string) => document.querySelector(`[data-dshone-group-key="${key}"] [data-dshone-tree-row="session"]`)?.getAttribute('data-dshone-tree-session') ?? '',
          candidate.key,
        )
        if (sessionId === '') continue
        const cwd = sessions.find((session) => session.sessionId === sessionId)?.cwd ?? ''
        if (cwd === '') continue
        picked = { ...candidate, sessionId, cwd }
        break
      }
    } finally {
      await opening.context.close()
    }
    if (picked === null) {
      check.fact('网关上没有「带会话、且会话带 cwd」的工作区可用作夹具目标——本套件跳过（真网关只读，不为凑夹具去建会话）')
      return screenshots
    }
    const target = picked
    check.fact(
      `夹具目标：工作区「${target.title}」（标题文字宽 ${String(target.textWidth)}px、key ${target.key.slice(0, 8)}）、会话 ${target.sessionId.slice(0, 16)}、cwd=${target.cwd}`,
    )
    check.ok('挑到的工作区与它的一条会话（两道夹具落在同一行）', target.sessionId !== '' && target.cwd !== '', JSON.stringify(target))

    const opened = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), {
      width: 340,
      height: 900,
      workspaceFolders: [target.cwd],
    })
    const { page } = opened
    try {
      const fixture = await installRunningFixture(page, target.sessionId)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector(route('sidebar').readySelector, { timeout: 40_000 })
      await page.waitForTimeout(2_500)
      check.fact(`夹具：session/list 被改 ${String(fixture.calls)} 次、命中目标会话 ${String(fixture.touched)} 次`)
      check.ok('夹具生效（list 回执里改到了目标会话）', fixture.touched > 0, JSON.stringify(fixture))

      // 计数出现的那一行（= 跑着的会话所属工作区 = 假宿主上报的那个文件夹所在工作区）。
      const probe = await readRow(page)
      check.ok('工作区行上出现活状态计数（运行中 > 0 才渲染）', probe !== null && probe.hasActivity, JSON.stringify({ row: probe?.key ?? null, activity: probe?.hasActivity ?? null }))
      if (probe === null || !probe.hasActivity) return screenshots
      const key = probe.key

      // ---- ① 计数紧跟标题文字、不在行尾那一层 ----
      check.fact(`① 计数与标题：${JSON.stringify({ activityValue: probe.activityValue, title: probe.titleRect, text: probe.textRect, activity: probe.activityRect })}`)
      check.ok('① 计数装在标题盒里（不是行里的兄弟节点）', probe.activityInsideTitle, JSON.stringify({ insideTitle: probe.activityInsideTitle }))
      check.ok('① 计数是标题**文字**那一段的后一个兄弟', probe.activityAfterText, JSON.stringify({ afterText: probe.activityAfterText }))
      check.ok('① 计数不再住在行尾那一层里', !probe.activityInRowEnd, JSON.stringify({ inRowEnd: probe.activityInRowEnd }))
      check.ok(
        `① 计数左缘 − 标题文字右缘 = 档位表的行内间隙（${String(GAP)}px ±1）`,
        Math.abs(probe.activityRect.x - probe.textRect.right - GAP) <= 1,
        JSON.stringify({ gap: Math.round((probe.activityRect.x - probe.textRect.right) * 100) / 100, expected: GAP }),
      )
      check.ok(
        '① 计数与标题在同一行（垂直中心差 ≤ 1px）',
        Math.abs(probe.activityRect.y + probe.activityRect.h / 2 - (probe.titleRect.y + probe.titleRect.h / 2)) <= 1,
        JSON.stringify({ activityCenter: probe.activityRect.y + probe.activityRect.h / 2, titleCenter: probe.titleRect.y + probe.titleRect.h / 2 }),
      )

      // ---- ② 标题盒不变：仍是撑满 projectText 的那个矩形 ----
      check.fact(`② 标题盒：${JSON.stringify({ title: probe.titleRect, projectText: probe.projectTextRect, fontSize: probe.titleFontSize, lineHeight: probe.titleLineHeight })}`)
      check.ok(
        '② 标题盒仍撑满 projectText（没有缩成文字宽）',
        Math.abs(probe.titleRect.w - probe.projectTextRect.w) <= 1 && Math.abs(probe.titleRect.x - probe.projectTextRect.x) <= 1,
        JSON.stringify({ titleWidth: probe.titleRect.w, projectTextWidth: probe.projectTextRect.w }),
      )
      check.eq('② 标题高 = 标题档行高', probe.titleRect.h, Number.parseFloat(SCALE_TIERS.standard.titleLineHeight))
      check.eq('② 标题字号 = 标题档字号', probe.titleFontSize, SCALE_TIERS.standard.titleFontSize)
      check.ok(
        '② 标题盒整个落在行盒里',
        probe.titleRect.bottom <= probe.rowRect.bottom + 0.5 && probe.titleRect.y >= probe.rowRect.y - 0.5,
        JSON.stringify({ title: probe.titleRect, row: probe.rowRect }),
      )

      // ---- ③ 行尾层只剩胶囊，且胶囊比改前更紧凑 ----
      check.fact(`③ 行尾层：children=${JSON.stringify(probe.rowEndChildren)} display=${probe.rowEndDisplay}；胶囊=${JSON.stringify({ height: probe.badgeHeight, fontSize: probe.badgeFontSize, lineHeight: probe.badgeLineHeight, paddingInline: probe.badgePaddingInline, radius: probe.badgeRadius })}`)
      check.eq('③ 行尾层里只剩胶囊一件', probe.rowEndChildren, ['dshOneTree_workspaceBadge'])
      check.eq('③ 胶囊高 = 标准档行内图标按钮尺寸', probe.badgeHeight, SCALE_TIERS.standard.rowIconButtonSize)
      check.eq('③ 胶囊字号 = 标准档小胶囊字号', probe.badgeFontSize, SCALE_TIERS.standard.smallPillFontSize)
      check.eq('③ 胶囊行高 = 紧凑档分组标签行高', probe.badgeLineHeight, SCALE_TIERS.compact.groupLabelLineHeight)
      check.eq('③ 胶囊内边距 = 标准档胶囊触发器内边距', probe.badgePaddingInline, SCALE_TIERS.standard.pillPaddingEnd)
      check.eq('③ 胶囊圆角 = 容器档小胶囊圆角', probe.badgeRadius, SCALE_TIERS.standard.smallPillRadius)
      check.ok(
        `③ 胶囊比改前小（高 ${String(PREVIOUS_BADGE_HEIGHT)}px → ${probe.badgeHeight}）`,
        Number.parseFloat(probe.badgeHeight) < PREVIOUS_BADGE_HEIGHT,
        JSON.stringify({ now: probe.badgeHeight, before: `${String(PREVIOUS_BADGE_HEIGHT)}px` }),
      )
      check.ok('③ 胶囊里写的还是宿主名（vscode）', probe.badgeText === 'vscode', JSON.stringify({ text: probe.badgeText }))

      // ---- ④ 三档宽度：不溢出、不压字、计数与胶囊不重叠 ----
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 })
        await page.waitForTimeout(300)
        const reading = await readRow(page, `[data-dshone-tree-key="${key}"]`)
        if (reading === null) {
          check.ok(`④ w=${String(width)}：那一行还在`, false, 'row gone')
          continue
        }
        check.fact(
          `④ w=${String(width)} 几何：${JSON.stringify({ row: reading.rowRect, title: reading.titleRect, text: reading.textRect, activity: reading.activityRect, badge: reading.badgeRect, clipped: reading.textClipped })}`,
        )
        check.ok(
          `④ w=${String(width)}：列表不横向溢出`,
          reading.listOverflow.scrollWidth <= reading.listOverflow.clientWidth + 1 && reading.docOverflow.scrollWidth <= reading.docOverflow.clientWidth + 1,
          JSON.stringify({ list: reading.listOverflow, doc: reading.docOverflow }),
        )
        check.ok(
          `④ w=${String(width)}：标题不横向溢出`,
          reading.titleRect.w <= reading.projectTextRect.w + 1,
          JSON.stringify({ title: reading.titleRect.w, available: reading.projectTextRect.w }),
        )
        check.ok(
          `④ w=${String(width)}：计数整个落在标题盒里（没被行尾或行盒裁掉）`,
          reading.activityRect.right <= reading.titleRect.right + 1 && reading.activityRect.x >= reading.titleRect.x - 1,
          JSON.stringify({ activity: reading.activityRect, title: reading.titleRect }),
        )
        check.ok(
          `④ w=${String(width)}：计数与行尾胶囊不重叠`,
          reading.badgeRect === null || reading.activityRect.right <= reading.badgeRect.x + 0.5 || reading.activityRect.x >= reading.badgeRect.right - 0.5,
          JSON.stringify({ activity: reading.activityRect, badge: reading.badgeRect }),
        )
        if (width === 340) screenshots.push(await shot(ctx, page, 'row-activity-340'))
      }

      // ---- ④ 窄到标题真被截断：文字让位、计数照常 ----
      await page.setViewportSize({ width: NARROW_WIDTH, height: 900 })
      await page.waitForTimeout(300)
      const narrow = await readRow(page, `[data-dshone-tree-key="${key}"]`)
      if (narrow === null) {
        check.ok('④ 窄宽度下：那一行还在', false, 'row gone')
      } else {
        check.fact(`④ w=${String(NARROW_WIDTH)}（标题装不下）几何：${JSON.stringify({ title: narrow.titleRect, text: narrow.textRect, textOverflow: narrow.textOverflow, activity: narrow.activityRect, badge: narrow.badgeRect })}`)
        check.ok(
          `④ w=${String(NARROW_WIDTH)}：标题文字真被省略号截断（这一段是判「文字让位」的前提）`,
          narrow.textClipped,
          JSON.stringify(narrow.textOverflow),
        )
        check.ok(
          `④ w=${String(NARROW_WIDTH)}：文字被截断时计数照常可见、仍紧跟文字并且不与行尾胶囊重叠`,
          narrow.hasActivity &&
            narrow.activityRect.w > 0 &&
            Math.abs(narrow.activityRect.x - narrow.textRect.right - GAP) <= 1 &&
            (narrow.badgeRect === null || narrow.textRect.right <= narrow.badgeRect.x + 0.5),
          JSON.stringify({ activity: narrow.activityRect, text: narrow.textRect, badge: narrow.badgeRect }),
        )
        check.ok(
          `④ w=${String(NARROW_WIDTH)}：不横向溢出`,
          narrow.listOverflow.scrollWidth <= narrow.listOverflow.clientWidth + 1,
          JSON.stringify(narrow.listOverflow),
        )
      }
      await page.setViewportSize({ width: 340, height: 900 })
      await page.waitForTimeout(300)

      // ---- ⑤ 回归：计数的语义（#153 起读数写成三档「运行中/等待/未读」） ----
      check.eq('⑤ 计数读数 = 运行中/等待/未读（夹具那条是 1/0/0）', probe.activityValue, '1/0/0')
      check.eq('⑤ 运行中那一枚渲染（带数字）', probe.runningItems, 1)
      check.eq('⑤ 等待交互那一枚在没有等待态时不渲染', probe.waitingItems, 0)
      check.eq('⑤ 未读那一枚在没有未读会话时不渲染（夹具没有注未读集合）', probe.unreadItems, 0)
      check.ok('⑤ 计数那一枚带无障碍/悬停文案', probe.activityLabel.includes('1'), JSON.stringify({ label: probe.activityLabel }))

      // ---- ⑤ 回归：当前工作区标识与排序 ----
      const currentFacts = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('[data-dshone-tree-row="workspace"]'))
        return {
          keys: rows.map((row) => row.getAttribute('data-dshone-tree-key') ?? '').filter((value) => value !== ''),
          current: rows.filter((row) => row.getAttribute('data-dshone-tree-current') === 'true').map((row) => row.getAttribute('data-dshone-tree-key') ?? ''),
          capsules: rows.filter((row) => row.querySelector('[data-dshone-tree-badge]') !== null).length,
        }
      })
      check.fact(`⑤ 当前工作区：${JSON.stringify(currentFacts)}`)
      check.eq('⑤ 假宿主上报的文件夹只命中一行（当前工作区唯一）', currentFacts.current, [key])
      check.eq('⑤ 胶囊也只有那一枚', currentFacts.capsules, 1)
      check.eq('⑤ 当前工作区仍排在最前（#109 E7）', currentFacts.keys[0], key)

      // ---- ⑤ 回归：悬停时计数留在原地、胶囊照旧让位、动作按钮照常出现 ----
      const nonCurrent = currentFacts.keys.find((candidate) => candidate !== key)
      await page.hover(`[data-dshone-tree-key="${key}"]`)
      await page.waitForTimeout(250)
      const hovered = await readRow(page, `[data-dshone-tree-key="${key}"]`)
      check.fact(`⑤ 悬停当前工作区行：${JSON.stringify({ rowEndDisplay: hovered?.rowEndDisplay ?? null, activity: hovered?.activityRect ?? null, buttons: hovered?.actionButtons ?? null })}`)
      check.ok('⑤ 悬停时计数仍在场且位置不变（它不在行尾那一层里）', hovered !== null && hovered.activityRect.w > 0 && Math.abs(hovered.activityRect.x - probe.activityRect.x) <= 1, JSON.stringify({ rest: probe.activityRect.x, hover: hovered?.activityRect.x ?? null }))
      check.eq('⑤ 悬停时行尾层让位（胶囊那一层照旧隐藏）', hovered?.rowEndDisplay, 'none')
      check.ok(
        '⑤ 悬停时当前工作区行的动作按钮照常出现（当前工作区没有「在 VS Code 打开」那一枚，故为 3）',
        hovered !== null && hovered.actionButtons === 3,
        JSON.stringify({ buttons: hovered?.actionButtons ?? null }),
      )
      if (nonCurrent !== undefined) {
        await page.hover(`[data-dshone-tree-key="${nonCurrent}"]`)
        await page.waitForTimeout(250)
        const other = await readRow(page, `[data-dshone-tree-key="${nonCurrent}"]`)
        check.fact(`⑤ 悬停非当前工作区行（${nonCurrent.slice(0, 8)}）：${JSON.stringify({ buttons: other?.actionButtons ?? null, activity: other?.hasActivity ?? null })}`)
        check.ok('⑤ 非当前工作区行的动作按钮是四枚', other !== null && other.actionButtons === 4, JSON.stringify({ buttons: other?.actionButtons ?? null }))
        check.ok('⑤ 没有计数的行上不渲染计数（只跑着的那一行有）', other !== null && !other.hasActivity, JSON.stringify({ hasActivity: other?.hasActivity ?? null }))
      } else {
        check.fact('⑤ 网关上只有一棵工作区（没有非当前的行可量四枚按钮）——这一段跳过')
      }

      // ---- ⑤ 回归：工作区行右键菜单照旧 ----
      await page.hover(`[data-dshone-tree-key="${key}"]`)
      const rowBox = await page.locator(`[data-dshone-tree-key="${key}"]`).boundingBox()
      if (rowBox === null) {
        check.ok('⑤ 拿到工作区行的位置（右键菜单要用）', false, 'no bounding box')
      } else {
        await page.mouse.click(rowBox.x + rowBox.width / 2, rowBox.y + rowBox.height / 2, { button: 'right' })
        await page.waitForTimeout(300)
        const menuItems = await page.evaluate(() =>
          Array.from(document.querySelectorAll('[role="menu"]')).pop()?.querySelectorAll('[data-dshone-tree-item]').length ?? 0,
        )
        check.fact(`⑤ 工作区行右键菜单项数=${String(menuItems)}`)
        check.ok('⑤ 工作区行右键菜单照旧开出（含标题行在内的项都在）', menuItems >= 7, `items=${String(menuItems)}`)
        await page.keyboard.press('Escape')
        await page.waitForTimeout(200)
      }

      const errors = withoutKnownNoise(opened.capture.pageErrors)
      check.eq('⑤ 全程零 pageerror', errors.real, [])
    } finally {
      await opened.context.close()
    }
    return screenshots
  },
}
