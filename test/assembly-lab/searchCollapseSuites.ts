/**
 * 顶栏搜索栏的收起 / 展开（#132）。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与 `topbarRhythmSuites.ts` / `driftSuites.ts`
 * 同一条：那个文件是本批开发的合入热点，新套件放外面能少一半冲突面。注册方式是在
 * `suites.ts` 的 `SUITES` 末尾追加一项。
 *
 * 判据的两条来源，都在运行期取、不写死数字：
 * - **官方标记**：类名语义（`search` / `searchSlot` / `searchButton` / `searchInput` /
 *   `clearButton` 与两个 Expanded 变体）、`aria-expanded`、输入框 / 清除钮在不在；
 * - **官方几何**：同一台机器上再开一页官方浏览区（`/sidebar-official`），把它的折叠态与
 *   展开态逐项量下来**和我们的对应态比**——官方改版这边跟着变，不相等才报（与 F-04
 *   同一套「不硬编码数值」的口径，F-04 管的是同一态下的逐项对齐，本条管的是两态的态机与
 *   几何都对着）。
 *
 * 量之前先把自有页的密度变量按树插件自己声明的官方兜底值内联回 frame（= 官方档），
 * 否则 VS Code 档的 26px 与官方的 28px 本来就不该相等——处置与 F-12 / F-26 同一份理由。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { openTreePage, withoutKnownNoise, type OpenedPage } from './harness.ts'
import { LAB_TREES, type LabTreeRoute } from './labServer.ts'
import { SCALE_TIERS } from '../../src/ui/assembly/shell/workspaceTree/styles.ts'
// 只取类型（编译后不留 import，运行期没有环）：套件接口定义在 suites.ts 里。
import type { LabSuite } from './suites.ts'

const route = (name: string): LabTreeRoute => {
  const found = LAB_TREES.find((candidate) => candidate.route === name)
  if (found === undefined) throw new Error(`lab: unknown tree route ${name}`)
  return found
}

async function shot(ctx: { shots: string }, page: OpenedPage['page'], name: string): Promise<string> {
  const file = path.join(ctx.shots, `${name}.png`)
  await fsp.mkdir(ctx.shots, { recursive: true })
  await page.screenshot({ path: file })
  return file
}

/** 自有树的搜索区（`data-dshone-tree` 是自有契约，与 F-12 用的是同一组标记）。 */
const SEARCH_BOX = '[data-dshone-tree="search-box"]'
const SEARCH_SLOT = '.dshOneTree_searchSlot'
const SEARCH_BUTTON = '[data-dshone-tree-action="search"]'
const SEARCH_INPUT = '[data-dshone-tree="search-input"]'
const SEARCH_CLEAR = '[data-dshone-tree="search-clear"]'
const TOP_BAR_ACTIONS = '[data-dshone-tree="top-bar-actions"]'
const LIST_AREA = '.dshOneTree_listArea'
const FRAME = '[class*="dshOneSidebarShell_frame"]'

interface BoxFacts {
  /** `data-dshone-tree-state`（自有标记：collapsed / expanded）。 */
  state: string | null
  boxClass: string
  slotClass: string
  inputPresent: boolean
  clearPresent: boolean
  ariaExpanded: string | null
  inputFocused: boolean
  inputValue: string
  /** 输入框的可交互性（收起态本来就不渲染它，展开态要真能打字）。 */
  inputOpacity: string
  inputPointerEvents: string
  boxHeight: number
  boxWidth: number
  boxRadius: string
  boxBorderWidth: string
  boxBorderStyle: string
  buttonWidth: number
  buttonHeight: number
  /** 放大镜图标自身渲染出来的边长（官方两态的图标档不同：折叠 14 / 展开 11）。 */
  iconSize: number
  /** 收起态里那枚放大镜与顶栏右侧动作组的左右关系（盒子的边到边距离）。 */
  boxToActions: number | null
  /** 树体是不是常态（列表行在场、搜索态的结果区不在场）。 */
  treeRows: number
  searchArea: boolean
}

/**
 * 量一次自有树搜索区当前那一态。搜索框容器还没有（页面没装配起来）时返回 null。
 * 收起态里输入框与清除钮都**不在场**（本实现的处置，见 toolbar.ts 的说明），
 * 所以这两个字段是「在不在」，不是「可不可见」。
 */
async function readOurSearch(page: OpenedPage['page']): Promise<BoxFacts | null> {
  return page.evaluate(
    ([boxSel, slotSel, buttonSel, inputSel, clearSel, actionsSel]) => {
      const round = (value: number): number => Math.round(value * 100) / 100
      const box = document.querySelector(boxSel)
      if (box === null) return null
      const style = getComputedStyle(box)
      const rect = box.getBoundingClientRect()
      const button = box.querySelector(buttonSel)
      const slot = document.querySelector(slotSel)
      const input = box.querySelector(inputSel)
      const inputStyle = input === null ? null : getComputedStyle(input)
      const actions = document.querySelector(actionsSel)
      const buttonRect = button?.getBoundingClientRect() ?? null
      const iconRect = button?.querySelector('svg')?.getBoundingClientRect() ?? null
      return {
        state: box.getAttribute('data-dshone-tree-state'),
        boxClass: box.className,
        slotClass: slot?.className ?? '',
        inputPresent: input !== null,
        clearPresent: box.querySelector(clearSel) !== null,
        ariaExpanded: button?.getAttribute('aria-expanded') ?? null,
        inputFocused: input !== null && document.activeElement === input,
        inputValue: input instanceof HTMLInputElement ? input.value : '',
        inputOpacity: inputStyle?.opacity ?? '',
        inputPointerEvents: inputStyle?.pointerEvents ?? '',
        boxHeight: round(rect.height),
        boxWidth: round(rect.width),
        boxRadius: style.borderRadius,
        boxBorderWidth: style.borderTopWidth,
        boxBorderStyle: style.borderTopStyle,
        buttonWidth: buttonRect === null ? 0 : round(buttonRect.width),
        buttonHeight: buttonRect === null ? 0 : round(buttonRect.height),
        iconSize: iconRect === null ? 0 : round(iconRect.width),
        boxToActions: actions === null ? null : round(actions.getBoundingClientRect().left - rect.right),
        treeRows: document.querySelectorAll('[data-dshone-group-key]').length,
        searchArea: document.querySelector('[data-dshone-tree="search"]') !== null,
      }
    },
    [SEARCH_BOX, SEARCH_SLOT, SEARCH_BUTTON, SEARCH_INPUT, SEARCH_CLEAR, TOP_BAR_ACTIONS] as const,
  )
}

interface OfficialSearchFacts {
  found: boolean
  ariaExpanded: string | null
  expandedClass: boolean
  slotExpandedClass: boolean
  inputPresent: boolean
  clearPresent: boolean
  boxHeight: number
  boxWidth: number
  boxRadius: string
  boxBorderWidth: string
  buttonWidth: number
  buttonHeight: number
}

/**
 * 量一次官方浏览区当前那一态（官方 CSS-module 的哈希类名一律按**类名后缀**取，
 * 与 F-04 的 `samplePair` 同一口径）：`_search` 容器是第一个类名以 `_search` 结尾的元素
 * （`_searchSlot` / `_searchTree` / `_searchStatus` 都不以它结尾）。
 */
async function readOfficialSearch(page: OpenedPage['page']): Promise<OfficialSearchFacts> {
  return page.evaluate(() => {
    const round = (value: number): number => Math.round(value * 100) / 100
    const all = Array.from(document.querySelectorAll('body *'))
    const suffix = (token: string): Element | null =>
      all.find((element) => (element.getAttribute('class') ?? '').split(/\s+/).some((name) => name.endsWith(`_${token}`))) ?? null
    const box = suffix('search')
    if (box === null) {
      return {
        found: false,
        ariaExpanded: null,
        expandedClass: false,
        slotExpandedClass: false,
        inputPresent: false,
        clearPresent: false,
        boxHeight: 0,
        boxWidth: 0,
        boxRadius: '',
        boxBorderWidth: '',
        buttonWidth: 0,
        buttonHeight: 0,
      }
    }
    const style = getComputedStyle(box)
    const rect = box.getBoundingClientRect()
    const button = suffix('searchButton')
    const buttonRect = button?.getBoundingClientRect() ?? null
    return {
      found: true,
      ariaExpanded: button?.getAttribute('aria-expanded') ?? null,
      expandedClass: (box.getAttribute('class') ?? '').split(/\s+/).some((name) => name.endsWith('_searchExpanded')),
      slotExpandedClass: (suffix('searchSlot')?.getAttribute('class') ?? '').split(/\s+/).some((name) => name.endsWith('_searchSlotExpanded')),
      inputPresent: suffix('searchInput') !== null,
      clearPresent: suffix('clearButton') !== null,
      boxHeight: round(rect.height),
      boxWidth: round(rect.width),
      boxRadius: style.borderRadius,
      boxBorderWidth: style.borderTopWidth,
      buttonWidth: buttonRect === null ? 0 : round(buttonRect.width),
      buttonHeight: buttonRect === null ? 0 : round(buttonRect.height),
    }
  })
}

/**
 * 把自有页的密度变量按树插件自己声明的官方兜底值内联回 frame（= 官方档）。与 F-12 /
 * F-26 同一处置、同一读法（`var(--dsh-one-density-x, <官方原值>)` 的第二个参数就是
 * 「没人给偏好」时的值）；这里另抄一份是因为两套件在两个文件里，直接互相 import 会在
 * `suites.ts` 与独立套件文件之间绕出一个运行期环（其它独立套件只 `import type`，正为此）。
 */
async function applyOfficialDensity(page: OpenedPage['page']): Promise<number> {
  return page.evaluate(
    ([frameSelector]) => {
      const treeCss =
        Array.from(document.querySelectorAll('style[data-plugin]'))
          .find((element) => element.getAttribute('data-plugin') === '@dsh-one/dsh-workspace-tree')
          ?.textContent ?? ''
      const fallbacks = Array.from(treeCss.matchAll(/var\(--dsh-one-density-([a-z-]+),\s*([^)]+)\)/g))
      const frame = document.querySelector(frameSelector)
      if (frame === null) return -1
      for (const match of fallbacks) {
        frame.setAttribute('style', `${frame.getAttribute('style') ?? ''};--dsh-one-density-${match[1] ?? ''}:${(match[2] ?? '').trim()}`)
      }
      return fallbacks.length
    },
    [FRAME] as const,
  )
}

/** 等网关对搜索的结论落定：官方那套结果区不再停在「正在搜索…」（超时也照旧判）。 */
async function settleSearch(page: OpenedPage['page']): Promise<void> {
  const deadline = Date.now() + 6_000
  for (;;) {
    const status = await page.evaluate(() => document.querySelector('.dshOneTree_searchStatus')?.textContent ?? '')
    if (!status.includes('正在搜索') || Date.now() > deadline) return
    await page.waitForTimeout(250)
  }
}

/** 点一处「别的地方」：列表区底部的空白（这一轮查询是必然无匹配的串，那里没有行可点）。 */
async function clickOutsideSearch(page: OpenedPage['page']): Promise<void> {
  const point = await page.evaluate(([selector]) => {
    const area = document.querySelector(selector)
    if (area === null) return null
    const rect = area.getBoundingClientRect()
    return { x: Math.round(rect.left + 8), y: Math.round(rect.bottom - 6) }
  }, [LIST_AREA] as const)
  if (point === null) throw new Error('lab: list area not found')
  await page.mouse.click(point.x, point.y)
  await page.waitForTimeout(250)
}

export const SEARCH_COLLAPSE_SUITE: LabSuite = {
  id: 'F-36',
  phase: 'new-feature',
  name: '顶栏搜索栏的收起 / 展开（#132）：平时一枚放大镜，点开才展开成输入框（SEARCH-COLLAPSE 套件）',
  expect:
    '真实装配页上（真网关**只读** + 假宿主）、密度变量对齐到官方兜底值后：① **初始态是收起态**——放大镜按钮在场且 `aria-expanded=false`、搜索容器与槽位都**不带** Expanded 变体、输入框与清除钮都不在场（本实现收起时不渲染它们），几何是官方折叠态那一支（与官方浏览区同态的读数逐项相等：28px 圆胶囊、无边框），树体照常渲染；② **点放大镜 → 展开且输入框已聚焦**——两层 Expanded 变体都在、`aria-expanded=true`、输入框在 DOM 里且 `document.activeElement` 就是它、清除钮出现，几何是官方展开态那一支（30px 高 / 10px 圆角 / .5px 实线边框，与官方同态读数相等），图标从 14 档换成 11 档；随后输入一个必然无匹配的串，结果区照常出官方那套「无匹配 / 内容搜索不可用」文案；③ **Esc 与点清除都回到收起态并清空**——两路各走一遍（Esc 走输入框的 keydown、清除走清除钮），收起后输入框与清除钮都不在场、`aria-expanded=false`、树体回来，再展开读输入框的值是空串；④ **有查询时点别处保持展开**、空查询时点别处才收起（官方口径：`if (normalizedQuery !== "") return`），查询内容与结果不被那一下点击清掉；⑤ 官方标记语义一致（`aria-expanded`、两个 Expanded 变体、清除钮只在展开态渲染），**官方把输入框常挂在 DOM 里靠 CSS 藏起来这一点是唯一差异**，报告里按事实记一笔。全程零 pageerror。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const own = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { width: 380, height: 900 })
    const official = await openTreePage(ctx.browser, ctx.lab, route('sidebar-official'), { width: 380, height: 900 })
    try {
      // 官方对照档要横着放够宽，它才会渲染宽态（窄态是 rail，搜索是另一套 36px 件）。
      await official.page.setViewportSize({ width: 380, height: 900 })
      await official.page.waitForTimeout(300)
      const inlined = await applyOfficialDensity(own.page)
      check.ok('密度变量对齐到官方兜底值（两边同处官方档才可比）', inlined >= 20, `内联项数=${String(inlined)}`)
      await own.page.waitForTimeout(200)

      const collapsedOfficial = await readOfficialSearch(official.page)
      check.ok(
        '官方对照档取到了折叠态的搜索区（它是那一边的初态）',
        collapsedOfficial.found && collapsedOfficial.ariaExpanded === 'false',
        JSON.stringify(collapsedOfficial),
      )

      // ---- ① 初始态 = 收起态 ----
      const initial = await readOurSearch(own.page)
      check.ok('自有树的搜索区在（顶栏装配起来了）', initial !== null)
      if (initial === null) throw new Error('lab: search box not found')
      check.fact(`初始态读数：${JSON.stringify(initial)}`)
      check.eq('初始态：自有标记是 collapsed', initial.state, 'collapsed')
      check.ok(
        '初始态：容器与槽位都不带 Expanded 变体（官方折叠态那一支）',
        !initial.boxClass.split(/\s+/).includes('dshOneTree_searchExpanded') &&
          !initial.slotClass.split(/\s+/).includes('dshOneTree_searchSlotExpanded'),
        JSON.stringify({ box: initial.boxClass, slot: initial.slotClass }),
      )
      check.eq('初始态：放大镜按钮在，aria-expanded=false', initial.ariaExpanded, 'false')
      check.ok('初始态：输入框不在场', initial.inputPresent === false, `inputPresent=${String(initial.inputPresent)}`)
      check.ok('初始态：清除钮不在场（官方也是展开态才渲染它）', initial.clearPresent === false)
      check.ok('初始态：树体照常渲染（列表行在场、搜索结果区不在场）', initial.treeRows > 0 && !initial.searchArea, JSON.stringify({ rows: initial.treeRows, searchArea: initial.searchArea }))
      check.eq(
        '初始态：几何是官方折叠态那一支（高度 28px = 标准档 searchHeight）',
        initial.boxHeight,
        Number.parseFloat(SCALE_TIERS.standard.searchHeight),
      )
      check.ok('初始态：是圆胶囊（无边框、圆形圆角、宽=高）', initial.boxBorderWidth === '0px' && initial.boxRadius === '50%' && initial.boxWidth === initial.boxHeight, JSON.stringify(initial))
      check.eq('初始态：放大镜按钮是同一行图标按钮那一档（28×28）', [initial.buttonWidth, initial.buttonHeight], [Number.parseFloat(SCALE_TIERS.standard.iconButtonSize), Number.parseFloat(SCALE_TIERS.standard.iconButtonSize)])
      check.eq('初始态：图标用官方折叠态那一档（14）', initial.iconSize, 14)
      check.ok('初始态：折叠的放大镜挨着顶栏右侧动作组（在它左边）', initial.boxToActions !== null && initial.boxToActions >= 0, `边到边=${String(initial.boxToActions)}`)
      if (collapsedOfficial.found) {
        check.eq(
          '初始态几何 = 官方折叠态几何（逐项，运行时量官方页，不硬编码）',
          [initial.boxHeight, initial.boxWidth, initial.boxRadius, initial.boxBorderWidth, initial.buttonWidth, initial.buttonHeight],
          [collapsedOfficial.boxHeight, collapsedOfficial.boxWidth, collapsedOfficial.boxRadius, collapsedOfficial.boxBorderWidth, collapsedOfficial.buttonWidth, collapsedOfficial.buttonHeight],
        )
        check.fact(
          `官方折叠态读数：${JSON.stringify(collapsedOfficial)}（其中输入框常挂、清除钮不渲染——我们收起时不挂输入框，见下面的差异记录）`,
        )
      }
      screenshots.push(await shot(ctx, own.page, 'search-collapse-initial'))

      // ---- ② 点放大镜 → 展开 + 聚焦 ----
      await own.page.click(SEARCH_BUTTON)
      await own.page.waitForTimeout(300)
      const expanded = await readOurSearch(own.page)
      check.ok('点放大镜后：搜索区仍在', expanded !== null)
      if (expanded === null) throw new Error('lab: search box lost after expand')
      check.fact(`展开态读数：${JSON.stringify(expanded)}`)
      check.eq('展开态：自有标记是 expanded', expanded.state, 'expanded')
      check.eq('展开态：放大镜按钮 aria-expanded=true', expanded.ariaExpanded, 'true')
      check.ok(
        '展开态：容器与槽位都带上 Expanded 变体',
        expanded.boxClass.split(/\s+/).includes('dshOneTree_searchExpanded') &&
          expanded.slotClass.split(/\s+/).includes('dshOneTree_searchSlotExpanded'),
        JSON.stringify({ box: expanded.boxClass, slot: expanded.slotClass }),
      )
      check.ok('展开态：输入框在场', expanded.inputPresent)
      check.ok('展开态：清除钮在场', expanded.clearPresent)
      check.ok('展开态：焦点已经在输入框上', expanded.inputFocused, `activeElement=${String(expanded.inputFocused)}`)
      check.ok(
        '展开态：输入框真的可交互（opacity 1、不吃掉指针）',
        expanded.inputOpacity === '1' && expanded.inputPointerEvents !== 'none',
        JSON.stringify({ opacity: expanded.inputOpacity, pointerEvents: expanded.inputPointerEvents }),
      )
      check.eq(
        '展开态几何：高度 = 标准档 searchExpandedHeight（30px）',
        expanded.boxHeight,
        Number.parseFloat(SCALE_TIERS.standard.searchExpandedHeight),
      )
      check.eq('展开态几何：圆角 = 标准档 searchExpandedRadius（10px）', expanded.boxRadius, SCALE_TIERS.standard.searchExpandedRadius)
      check.ok(
        '展开态几何：实线边框（官方展开态那一支；具体 px 与官方页逐项比，见下面那一条）',
        expanded.boxBorderStyle === 'solid' && expanded.boxBorderWidth !== '0px',
        JSON.stringify({ width: expanded.boxBorderWidth, style: expanded.boxBorderStyle }),
      )
      check.eq('展开态：图标换成官方展开态那一档（11）', expanded.iconSize, 11)

      await official.page.click('[class*="_searchButton"]')
      await official.page.waitForTimeout(250)
      const expandedOfficial = await readOfficialSearch(official.page)
      check.ok('官方对照档也点开了（两边同处展开态才可比）', expandedOfficial.found && expandedOfficial.ariaExpanded === 'true', JSON.stringify(expandedOfficial))
      if (expandedOfficial.found) {
        check.eq(
          '展开态几何 = 官方展开态几何（逐项，运行时量官方页，不硬编码）',
          [expanded.boxHeight, expanded.boxRadius, expanded.boxBorderWidth, expanded.buttonHeight],
          [expandedOfficial.boxHeight, expandedOfficial.boxRadius, expandedOfficial.boxBorderWidth, expandedOfficial.buttonHeight],
        )
        check.eq(
          '两态的官方标记语义一致（Expanded 变体与清除钮都只在展开态）',
          [expandedOfficial.expandedClass, expandedOfficial.slotExpandedClass, expandedOfficial.clearPresent, collapsedOfficial.expandedClass, collapsedOfficial.clearPresent],
          [true, true, true, false, false],
        )
        check.fact(
          `两态的输入框处置差异：官方折叠态 _searchInput ${collapsedOfficial.inputPresent ? '常挂在 DOM 里（tabIndex=-1 + CSS 藏起来）' : '不在'}，我们折叠态不渲染它；可见与可交互的结果一致。`,
        )
      }
      screenshots.push(await shot(ctx, own.page, 'search-collapse-expanded'))

      // ② 之二：输入照常出结果区（必然无匹配的串，官方路径给「无匹配 / 内容搜索不可用」）
      await own.page.fill(SEARCH_INPUT, 'zzz-lab-no-such-session-zzz')
      await settleSearch(own.page)
      const searching = await own.page.evaluate(() => ({
        status: document.querySelector('.dshOneTree_searchStatus')?.textContent ?? '',
        rows: document.querySelectorAll('[data-dshone-tree="search"] [data-dshone-tree-row]').length,
        value: document.querySelector<HTMLInputElement>('[data-dshone-tree="search-input"]')?.value ?? '',
      }))
      check.fact(`搜索态：结果行=${String(searching.rows)} 状态文案=${JSON.stringify(searching.status)}`)
      check.ok(
        '展开态下输入照常走官方结果区（无匹配 / 内容搜索不可用）',
        searching.rows === 0 && (searching.status.includes('无匹配') || searching.status.includes('内容搜索')),
        JSON.stringify(searching),
      )
      screenshots.push(await shot(ctx, own.page, 'search-collapse-typing'))

      // ---- ④ 有查询时点别处：保持展开（官方口径） ----
      await clickOutsideSearch(own.page)
      const afterOutside = await readOurSearch(own.page)
      check.ok('有查询时点别处：仍然展开（输入框在场、Expanded 变体还在）', afterOutside?.state === 'expanded' && afterOutside.inputPresent === true, JSON.stringify(afterOutside))
      check.eq('有查询时点别处：查询没被清掉', afterOutside?.inputValue, 'zzz-lab-no-such-session-zzz')
      check.ok('有查询时点别处：输入框失焦（点了别处就该没焦点）', afterOutside?.inputFocused === false, `focused=${String(afterOutside?.inputFocused)}`)

      // ---- ③ 之一：Esc → 收起 + 清空 ----
      await own.page.click(SEARCH_INPUT)
      await own.page.waitForTimeout(150)
      await own.page.keyboard.press('Escape')
      await own.page.waitForTimeout(300)
      const afterEsc = await readOurSearch(own.page)
      check.eq('Esc 后：自有标记回到 collapsed', afterEsc?.state, 'collapsed')
      check.ok('Esc 后：输入框与清除钮都不在场', afterEsc?.inputPresent === false && afterEsc?.clearPresent === false, JSON.stringify(afterEsc))
      check.eq('Esc 后：aria-expanded 回到 false', afterEsc?.ariaExpanded, 'false')
      check.ok('Esc 后：树体回来（列表行在场、搜索区不在场）', (afterEsc?.treeRows ?? 0) > 0 && afterEsc?.searchArea === false, JSON.stringify(afterEsc))
      check.eq(
        'Esc 后几何回到折叠态那一支（28px 高 / 圆胶囊 / 无边框）',
        [afterEsc?.boxHeight, afterEsc?.boxBorderWidth, afterEsc?.iconSize],
        [Number.parseFloat(SCALE_TIERS.standard.searchHeight), '0px', 14],
      )
      // 再展开读值：查询确实被清空了（不是只收起）
      await own.page.click(SEARCH_BUTTON)
      await own.page.waitForTimeout(250)
      const afterEscReopen = await readOurSearch(own.page)
      check.eq('Esc 收起的查询真的清空了（再展开读输入框）', afterEscReopen?.inputValue, '')

      // ---- ④ 之二：空查询时点别处 → 收起（官方口径的另一半） ----
      await clickOutsideSearch(own.page)
      const emptyOutside = await readOurSearch(own.page)
      check.eq('空查询时点别处：收起', emptyOutside?.state, 'collapsed')

      // ---- ③ 之二：点清除 → 收起 + 清空 ----
      await own.page.click(SEARCH_BUTTON)
      await own.page.waitForTimeout(250)
      await own.page.fill(SEARCH_INPUT, 'zzz-lab-no-such-session-zzz')
      await settleSearch(own.page)
      const beforeClear = await readOurSearch(own.page)
      check.ok('清除钮这一路的前提成立（有查询、展开中）', beforeClear?.state === 'expanded' && beforeClear.inputValue !== '', JSON.stringify(beforeClear))
      await own.page.click(SEARCH_CLEAR)
      await own.page.waitForTimeout(300)
      const afterClear = await readOurSearch(own.page)
      check.eq('点清除后：自有标记回到 collapsed', afterClear?.state, 'collapsed')
      check.ok('点清除后：输入框与清除钮都不在场、树体回来', afterClear?.inputPresent === false && afterClear?.clearPresent === false && (afterClear?.treeRows ?? 0) > 0, JSON.stringify(afterClear))
      await own.page.click(SEARCH_BUTTON)
      await own.page.waitForTimeout(250)
      const afterClearReopen = await readOurSearch(own.page)
      check.eq('点清除收起的查询真的清空了（再展开读输入框）', afterClearReopen?.inputValue, '')
      screenshots.push(await shot(ctx, own.page, 'search-collapse-after-clear'))

      // 收尾：把两个页面都放回收起态（回到用户平时看到的那个样子）
      await own.page.keyboard.press('Escape')
      await own.page.waitForTimeout(200)

      check.eq('搜索栏收起 / 展开套件全程零 pageerror', withoutKnownNoise(own.capture.pageErrors).real, [])
      check.eq('官方对照页全程零 pageerror', withoutKnownNoise(official.capture.pageErrors).real, [])
    } finally {
      await own.context.close()
      await official.context.close()
    }
    return screenshots
  },
}
