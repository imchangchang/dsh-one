/**
 * 顶栏「折叠 / 展开全部」那枚图标（#118）：从 chevron 换成**方框加减号**。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与 `recycleEntrySuites.ts` / `scaleSuites.ts`
 * 同一条：那个文件是本批开发的合入热点，新套件放外面能少一半冲突面。注册方式是在
 * `suites.ts` 的 `SUITES` 末尾追加一项。
 *
 * 期望值**不硬编码**：
 * - 图标路径数据直接 import 插件自己的 `collapseAllGlyph.ts`（零 import 的纯数据文件，
 *   所以能在这个 node 进程里 import），页面渲染出的 `path@d` 与它逐条比——「屏幕上那
 *   两枚就是插件里那两条路径」这件事因此有判据，而不是靠看截图；
 * - 文案取插件自己的 zh 词典（`toolbar.collapseAll` / `toolbar.expandAll`）。
 *
 * 全程只读真网关：本套件不写任何状态，只点那枚按钮（它只改本地视图态）与搜索框。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { openTreePage, withoutKnownNoise, type OpenedPage } from './harness.ts'
import { LAB_TREES, type LabTreeRoute } from './labServer.ts'
import { COLLAPSE_ALL_BOX, COLLAPSE_ALL_GLYPHS } from '../../src/ui/assembly/shell/workspaceTree/collapseAllGlyph.ts'
import { ZH } from '../../src/ui/assembly/shell/workspaceTree/locale.ts'
// 只取类型（编译后不留 import，运行期没有环）：套件接口定义在 suites.ts 里，它就是调用方。
import type { LabSuite } from './suites.ts'

const route = (name: string): LabTreeRoute => {
  const found = LAB_TREES.find((candidate) => candidate.route === name)
  if (found === undefined) throw new Error(`lab: unknown tree route ${name}`)
  return found
}

/** 那一枚按钮与它里面的图标（图标上的两条 `data-*` 是自有契约，见 toolbar.ts）。 */
const BUTTON = '[data-dshone-tree-action="collapse-all"]'
const ICON = '[data-dshone-tree-icon="collapse-all"]'
/** 顶栏动作区里所有图标按钮的渲染尺寸（「与同一行其它图标一致」的参照物）。 */
const SIDING_ICONS = '[data-dshone-tree="top-bar-actions"] [data-dshone-tree-action] > svg'

interface Rect {
  w: number
  h: number
  cx: number
  cy: number
}

interface BarFacts {
  buttonFound: boolean
  /** 图标当前是哪一态（`minus` = 折叠全部 / `plus` = 展开全部）。 */
  glyph: string
  /** 按钮上的既有标记：与 `allCollapsed` 同源。 */
  collapsedAttr: string
  ariaLabel: string
  viewBox: string
  width: string
  height: string
  /** 渲染出的每条 path 的 d / fill / fill-rule / clip-rule（按绘制顺序）。 */
  ds: string[]
  fills: string[]
  fillRules: string[]
  clipRules: string[]
  /** 按钮或图标里有没有 14 号视框（换下去那两枚 chevron 就是这个视框）。 */
  anyNarrowViewBox: boolean
  iconRect: Rect | null
  buttonRect: Rect | null
  siblingIconSizes: string[]
  /** 树里可见的工作区行数与其中展开着的行数。 */
  workspaceRows: number
  expandedRows: number
  /** 树里可见的会话行数（搜索结果行不算在内）。 */
  sessionRows: number
  /** 搜索态：结果行数 + 状态文案（两者都只在搜索态出现）。 */
  searchResults: number
  searchStatus: string
  /** 当前页面上所有官方 tooltip 的文案（`role="tooltip"`）。 */
  tooltips: string[]
}

/** 读一次这一枚按钮 + 树的两三个计数（一次 evaluate 拿全，省往返）。 */
async function barFacts(page: OpenedPage['page']): Promise<BarFacts> {
  return page.evaluate(
    ([buttonSelector, iconSelector, siblingSelector]) => {
      const rectOf = (element: Element | null): Rect | null => {
        if (element === null) return null
        const box = element.getBoundingClientRect()
        return {
          w: Math.round(box.width * 10) / 10,
          h: Math.round(box.height * 10) / 10,
          cx: Math.round(box.left + box.width / 2),
          cy: Math.round(box.top + box.height / 2),
        }
      }
      const button = document.querySelector(buttonSelector)
      const icon = document.querySelector(iconSelector)
      const paths = Array.from(icon?.querySelectorAll('path') ?? [])
      const attr = (element: Element | null, name: string): string => element?.getAttribute(name) ?? ''
      return {
        buttonFound: button !== null && icon !== null,
        glyph: attr(icon, 'data-dshone-tree-icon-value'),
        collapsedAttr: attr(button, 'data-dshone-tree-collapsed'),
        ariaLabel: attr(button, 'aria-label'),
        viewBox: attr(icon, 'viewBox'),
        width: attr(icon, 'width'),
        height: attr(icon, 'height'),
        ds: paths.map((element) => attr(element, 'd')),
        fills: paths.map((element) => attr(element, 'fill')),
        fillRules: paths.map((element) => attr(element, 'fill-rule')),
        clipRules: paths.map((element) => attr(element, 'clip-rule')),
        anyNarrowViewBox:
          button !== null && button.querySelector('svg[viewBox="0 0 14 14"], svg[viewBox="0 0 12 12"]') !== null,
        iconRect: rectOf(icon),
        buttonRect: rectOf(button),
        siblingIconSizes: Array.from(document.querySelectorAll(siblingSelector)).map(
          (element) => element.getAttribute('width') ?? '',
        ),
        workspaceRows: document.querySelectorAll('[data-dshone-tree-row="workspace"]').length,
        expandedRows: document.querySelectorAll('[data-dshone-tree-row="workspace"][aria-expanded="true"]').length,
        sessionRows: document.querySelectorAll('[data-dshone-tree-row="session"]').length,
        searchResults: document.querySelectorAll('[data-dshone-tree="search"] [data-dshone-tree-row]').length,
        searchStatus: document.querySelector('.dshOneTree_searchStatus')?.textContent ?? '',
        tooltips: Array.from(document.querySelectorAll('[role="tooltip"]')).map((element) => element.textContent ?? ''),
      }
    },
    [BUTTON, ICON, SIDING_ICONS] as const,
  )
}

/** 点那枚按钮并等一帧（它只改本地视图态，不写网关）。 */
async function clickCollapseAll(page: OpenedPage['page']): Promise<void> {
  await page.click(BUTTON)
  await page.waitForTimeout(300)
}

/**
 * 悬停到按钮上读官方 Tooltip 的文案（`delayMs: 500`，所以等够 800ms）。
 * 读完把指针挪开——免得它盖住按钮、后面那一下点击被它挡住。
 */
async function hoverTooltip(page: OpenedPage['page']): Promise<string[]> {
  await page.hover(BUTTON)
  await page.waitForTimeout(800)
  const texts = (await barFacts(page)).tooltips
  await page.mouse.move(4, 4)
  await page.waitForTimeout(150)
  return texts
}

const collapseLabel = ZH['toolbar.collapseAll'] ?? ''
const expandLabel = ZH['toolbar.expandAll'] ?? ''

export const COLLAPSE_ALL_ICON_SUITE: LabSuite = {
  id: 'F-25',
  phase: 'new-feature',
  name: '顶栏「折叠 / 展开全部」的方框加减号图标（#118，COLLAPSE-ALL-ICON 套件）',
  expect:
    '顶栏那一枚的图标与态映射（真网关**只读** + 假宿主 + 真装配页）：① **图标按标记与渲染指纹核**——图标位带 `data-dshone-tree-icon="collapse-all"`，值随态是 `minus` / `plus`；渲染出的是 16 号视框（`0 0 16 16`、宽高 16、两条 path、两态共用的方框那一条逐字等于插件里的 `COLLAPSE_ALL_BOX`），**不再有一丝 chevron**（按钮子树里没有 14 号视框的 svg，path 数也从 1 变 2）；两态各自的 `path@d` 与插件数据 `COLLAPSE_ALL_GLYPHS[minus|plus]` 逐条相同，方框那一笔两态相同、中间那一笔两态不同；尺寸与同一行其它图标按钮一致（都是 16，按钮 26×26、图标居中）。② **提示随态翻转**：`aria-label` 与官方 Tooltip 的文案两态分别是「折叠所有工作区」与「展开所有工作区」（取插件 zh 词典比对，不硬编码），且与图标值、`data-dshone-tree-collapsed` 四者同源。③ **点击语义不变**：当前有展开着的分组时点一下 = 折叠全部（可见工作区行全部 `aria-expanded="false"`、可见会话行归零），此时图标变 `plus`、提示变「展开所有工作区」；再点一下 = 展开全部（原先有会话的工作区行重新展开、会话行回来）；两次点击之间工作区行的**行数不变**（只动展开态，不动行集合）。④ **搜索态恒为折叠全部**：先把树折到全收起（此刻图标是 `plus`），再在搜索框里敲字——搜索态下（结果行或搜索状态原文在场）图标立刻回到 `minus`、提示回到「折叠所有工作区」，点它发的也是折叠；Esc 清空搜索后回到全收起态、图标又是 `plus`（搜索态这一条不污染持久状态）。全程零 pageerror，只点这一枚按钮与搜索框，不写网关。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const shot = async (page: OpenedPage['page'], name: string): Promise<string> => {
      const file = path.join(ctx.shots, `${name}.png`)
      await fsp.mkdir(ctx.shots, { recursive: true })
      await page.screenshot({ path: file })
      return file
    }

    const opened = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { width: 380, height: 900 })
    const { page } = opened
    try {
      const start = await barFacts(page)
      check.fact(
        `首屏：图标值=${start.glyph} collapsed=${JSON.stringify(start.collapsedAttr)} 工作区行=${String(start.workspaceRows)} 展开着=${String(start.expandedRows)} 会话行=${String(start.sessionRows)}`,
      )
      check.ok('顶栏那一枚在，且图标带 self-describing 标记', start.buttonFound, JSON.stringify({ glyph: start.glyph }))
      if (start.workspaceRows === 0) {
        // 一个工作区都没有的话，这一枚恒为「折叠全部」、③ 也无从验——如实记一条失败，
        // 不假装通过（本机网关平时都有工作区）。
        check.ok('网关上有工作区行可供本套件验证', false, '当天网关上没有工作区行')
        return screenshots
      }

      // ---------------------------------------------------------------------
      // ① 图标本体：标记、渲染指纹、数据出处、尺寸对齐
      // ---------------------------------------------------------------------
      // 先把树弄成「有展开着的分组」那一态（首屏是哪个态取决于当天数据与本地视图态，
      // 不能假定）。此刻按钮显示方框横杠。
      if (start.glyph === 'plus') await clickCollapseAll(page)
      const expandedState = await barFacts(page)
      check.eq('「有展开着的分组」时图标值 = minus', expandedState.glyph, 'minus')
      check.eq('同一态下按钮标记不是「全折叠」', expandedState.collapsedAttr, 'false')
      check.ok('图标位就在那一枚按钮里', expandedState.buttonFound, JSON.stringify({ glyph: expandedState.glyph }))
      check.eq('图标是 16 号视框（换下去的 chevron 是 14）', expandedState.viewBox, '0 0 16 16')
      check.eq('图标尺寸 16×16', [expandedState.width, expandedState.height], ['16', '16'])
      check.eq('两态都是「方框 + 中间一笔」两条 path', expandedState.ds.length, 2)
      check.ok(
        '按钮子树里没有任何 14 号视框的 svg（chevron 确实换掉了）',
        expandedState.anyNarrowViewBox === false,
        `anyNarrowViewBox=${String(expandedState.anyNarrowViewBox)}`,
      )
      check.ok(
        '两条 path 都是 currentColor + evenodd 填色（与官方图标件同一套画法）',
        expandedState.fills.every((value) => value === 'currentColor') &&
          expandedState.fillRules.every((value) => value === 'evenodd') &&
          expandedState.clipRules.every((value) => value === 'evenodd'),
        JSON.stringify({ fills: expandedState.fills, fillRules: expandedState.fillRules, clipRules: expandedState.clipRules }),
      )
      check.ok(
        '两态的 path@d 与插件数据逐条相同（屏幕上那两枚就是插件里的那两条路径）',
        JSON.stringify(expandedState.ds) === JSON.stringify([...COLLAPSE_ALL_GLYPHS.minus]),
        JSON.stringify(expandedState.ds),
      )
      check.ok(
        '方框那一笔出自插件里的 COLLAPSE_ALL_BOX（不是另画的）',
        expandedState.ds[0] === COLLAPSE_ALL_BOX,
        String(expandedState.ds[0] ?? '').slice(0, 60),
      )
      // 尺寸对齐：同一行里的图标按钮都渲染成同一档，这枚也一样。
      check.ok(
        '尺寸与同一行其它图标按钮一致',
        expandedState.siblingIconSizes.length > 0 && expandedState.siblingIconSizes.every((size) => size === '16'),
        JSON.stringify(expandedState.siblingIconSizes),
      )
      check.ok(
        '图标在按钮里视觉居中（中心差 ≤ 1px）',
        expandedState.iconRect !== null &&
          expandedState.buttonRect !== null &&
          Math.abs(expandedState.iconRect.cx - expandedState.buttonRect.cx) <= 1 &&
          Math.abs(expandedState.iconRect.cy - expandedState.buttonRect.cy) <= 1,
        JSON.stringify({ icon: expandedState.iconRect, button: expandedState.buttonRect }),
      )
      screenshots.push(await shot(page, 'collapse-all-icon-minus'))

      // ---------------------------------------------------------------------
      // ② 提示与 aria 随态翻转（与图标值、collapsed 标记四者同源）
      // ---------------------------------------------------------------------
      check.eq('展开态下 aria-label = 折叠所有工作区', expandedState.ariaLabel, collapseLabel)
      const expandedTooltip = await hoverTooltip(page)
      check.ok(
        '展开态下 Tooltip 文案 = 折叠所有工作区',
        expandedTooltip.includes(collapseLabel),
        JSON.stringify(expandedTooltip),
      )

      await clickCollapseAll(page)
      const collapsedState = await barFacts(page)
      check.eq('点一下 = 折叠全部：所有可见工作区行都收起', collapsedState.expandedRows, 0)
      check.eq('折叠全部后可见会话行归零（真的收干净了）', collapsedState.sessionRows, 0)
      check.eq(
        '折叠态下图标值 = plus、按钮标记 = 全折叠',
        [collapsedState.glyph, collapsedState.collapsedAttr],
        ['plus', 'true'],
      )
      check.eq('折叠态下 aria-label = 展开所有工作区', collapsedState.ariaLabel, expandLabel)
      check.ok(
        '全折叠态下 path@d 与插件数据逐条相同（第二笔换成了十字）',
        JSON.stringify(collapsedState.ds) === JSON.stringify([...COLLAPSE_ALL_GLYPHS.plus]),
        JSON.stringify(collapsedState.ds),
      )
      check.eq('两态共用的方框那一笔没变', collapsedState.ds[0], expandedState.ds[0])
      check.ok('两态中间那一笔不同', collapsedState.ds[1] !== expandedState.ds[1])
      const collapsedTooltip = await hoverTooltip(page)
      check.ok(
        '折叠态下 Tooltip 文案 = 展开所有工作区',
        collapsedTooltip.includes(expandLabel),
        JSON.stringify(collapsedTooltip),
      )
      check.ok(
        '两态的提示文案不是同一个（真的在翻）',
        collapseLabel !== expandLabel && !expandedTooltip.includes(expandLabel),
        JSON.stringify({ collapseLabel, expandLabel }),
      )
      screenshots.push(await shot(page, 'collapse-all-icon-plus'))

      // ---------------------------------------------------------------------
      // ④ 搜索态恒为折叠全部（此刻树正好是全收起）
      // ---------------------------------------------------------------------
      // 搜索打真实网关（官方 `sessions.search`），敲一个几乎不可能命中的串就够——本条
      // 要的是**态**，与结果条数无关；结果行会等官方回执落定后再看一眼。
      const rowCountBeforeSearch = (await barFacts(page)).workspaceRows
      await page.fill('[data-dshone-tree="search-input"]', 'zzz-lab-no-such-session-zzz')
      await page.waitForTimeout(1_200)
      const searching = await barFacts(page)
      check.fact(
        `搜索态：结果行=${String(searching.searchResults)} 状态原文=${JSON.stringify(searching.searchStatus)} 图标值=${searching.glyph}`,
      )
      check.ok(
        '确实进了搜索态（结果行或搜索状态原文在场——两者都只在搜索态出现）',
        searching.searchResults > 0 || searching.searchStatus !== '',
        JSON.stringify({ results: searching.searchResults, status: searching.searchStatus }),
      )
      check.eq(
        '搜索态下图标恒为 minus（不看那一堆工作区此刻收没收起）',
        [searching.glyph, searching.collapsedAttr, searching.ariaLabel],
        ['minus', 'false', collapseLabel],
      )
      await page.click(BUTTON)
      await page.waitForTimeout(300)
      const afterSearchClick = await barFacts(page)
      check.eq('搜索态下点它是「折叠全部」（图标与提示不翻）', [afterSearchClick.glyph, afterSearchClick.ariaLabel], [
        'minus',
        collapseLabel,
      ])
      // Esc 清空搜索框——它挂在搜索输入框的 keydown 上，而刚才那一下点击把焦点挪到了
      // 按钮上，所以先点回输入框再按 Esc（走的是用户真实路径，不是直接清 React 状态）。
      await page.click('[data-dshone-tree="search-input"]')
      await page.waitForTimeout(150)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
      const afterSearch = await barFacts(page)
      check.eq(
        'Esc 清空搜索后回到树：工作区行数不变（搜索没动行集合）',
        afterSearch.workspaceRows,
        rowCountBeforeSearch,
      )
      check.eq(
        'Esc 后「全收起」这个状态本身还在（图标回到 plus）',
        [afterSearch.glyph, afterSearch.collapsedAttr, afterSearch.ariaLabel],
        ['plus', 'true', expandLabel],
      )

      // ---------------------------------------------------------------------
      // ③ 再点一下 = 展开全部（点击语义没变，只动展开态不动行集合）
      // ---------------------------------------------------------------------
      const beforeExpand = await barFacts(page)
      await clickCollapseAll(page)
      const reExpanded = await barFacts(page)
      check.ok(
        '再点一下 = 展开全部：原先有会话的工作区行重新展开',
        reExpanded.expandedRows > 0 && reExpanded.sessionRows > 0,
        JSON.stringify({ expandedRows: reExpanded.expandedRows, sessionRows: reExpanded.sessionRows }),
      )
      check.eq('展开后图标回到 minus、提示回到「折叠所有工作区」', [reExpanded.glyph, reExpanded.ariaLabel], [
        'minus',
        collapseLabel,
      ])
      check.eq(
        '两次点击之间工作区行的行数不变（只动展开态，不动行集合）',
        [reExpanded.workspaceRows, beforeExpand.workspaceRows],
        [beforeExpand.workspaceRows, beforeExpand.workspaceRows],
      )
      screenshots.push(await shot(page, 'collapse-all-icon-round-trip'))

      check.eq('本套件全程零 pageerror', withoutKnownNoise(opened.capture.pageErrors).real, [])
    } finally {
      await opened.context.close()
    }
    return screenshots
  },
}
