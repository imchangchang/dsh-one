/**
 * 顶栏那一行的**右侧基准**（#142，F-44 TOPBAR-RIGHT-INSET）。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与 `topbarInlineSuites.ts` / `toolbarSingleRowSuites.ts`
 * 同一条：那个文件是本批开发的合入热点，新套件放外面能少一半冲突面。注册方式是在
 * `suites.ts` 的 `SUITES` 末尾追加一项。
 *
 * ## 量的是什么
 *
 * 用户实测（#142）：「工具图标与展开后的搜索框都顶到侧栏右缘，而列表行的内容却缩进 8px——
 * 顶栏那一行与列表行右缘不在同一条线上」。#125 管的是这一列的**左**缘（三条左缘同一条竖线），
 * 本条是它右侧的对称版：**顶栏那一行的内容右缘要落在「行内容右缘」那条竖线上**。
 *
 * 「行内容右缘」的可执行定义与 #125 的左侧同一条口径（**行盒的边 ± 行的内边距**）：
 * 行盒右缘 − 行的 `padding-right`，也就是工作区行行尾那枚角标 / 会话行时间文字结束的那条线；
 * 套件另外量一次「行里最后一枚占内容的子元素的右缘」做几何旁证（两者对不上就说明行的结构变了、
 * 参照物要重选）。
 *
 * 两个状态都要判（#135 起这一行是一行五件）：
 * - **收起态**：按**最右一枚工具控件**（多选入口）的右缘量；
 * - **展开态**：搜索框吃满整行，按**搜索框**的右缘量——这一刻动作组已让位成零宽，不比它。
 *   展开态还差官方 `searchExpanded` 自带的那一笔：它 `width:calc(100% + 4px)` 配
 *   `margin-inline:-2px`，向两侧各外突 2px，而它右端还有那一格行内间隙，所以它的右缘落在
 *   「行内容右缘 + 2px − 行内间隙」上（VS Code 档间隙 2px 时正好落在这条线上，官方档间隙
 *   4px 时短 2px——这正是 F-42 早就写下的「最多短 2px」）。套件按同一条算式算期望值，
 *   不写死像素。
 *
 * ## 右侧那条竖线是怎么来的（我们这一跳改的就是它）
 *
 * `#142` 给 `.dshOneTree_sectionHeader` 补了 `padding-right`，值 = **四个结构量的和**：
 * ① 这一行自己的 4px 出血（官方分节头 `margin-right:-4px` 的形态，不动）、② 列表的右外边距
 * `--dsh-session-list-scrollbar-offset`、③ 列表给滚动条留的车道 `--dsh-session-list-scrollbar-width`、
 * ④ 行的右内边距 `--dsh-one-density-row-padding-inline`。本套件**不重算这个和**，只判几何关系
 * （盒子右缘 − 内容右缘 = 那条竖线到盒子右缘的距离），所以算式哪天写错了这里会先红。
 *
 * 另外三条一起钉住：
 * - **出血没被动**：那一行的**盒子**右缘仍在列表右缘之外（`margin-right:-4px` 还在，
 *   F-35 ④ 有同名断言，这里按「盒子右缘 = 容器内容右缘 + 4px」正面量一遍）；
 * - **最右一枚图标的悬停圆底不被裁**：那一行是 `overflow:hidden`，盒子的右出血部分会被
 *   容器的 `overflow:hidden` 切掉——内容没往左收之前，最右一枚图标的圆底正好落在被切的那
 *   4px 里。这里断言那一枚整个落在**容器的裁切边界**（容器内容右缘）内。
 * - **胶囊那一侧的关系不变**：收起态里胶囊仍在行尾那一组控件的左边、两者不重叠，左缘
 *   那条竖线仍归 F-35 / F-42 判（本套件只记事实）。
 *
 * ## 官方页读数（#142 要做的第 1 点：先量官方页）
 *
 * 同一台机器上另开一页官方浏览区（`/sidebar-official`，同一 frame、同一网关数据），把官方那条
 * 线量下来。测出来的事实有两条，都写进报告：**官方自己也没有把顶栏内容与行内容对齐**——
 * 官方动作组最右一枚的右缘落在容器内容右缘上（比它的行内容右缘靠外一个行内边距 + 列表那两格），
 * 我们这一跳是用户点名要的、刻意往回收；**而官方的行内容右缘与我们的行内容右缘是同一个值**
 * （同一份行 CSS + 同一份列表容器几何），这也是「行内容右缘」能当两侧共同参照物的直接证据。
 * 两条都判成断言，不用写死的像素。
 *
 * 密度两档各量一遍（与 F-35 / F-26 / F-42 同一处置：把树自己声明的官方兜底值内联回 frame =
 * 官方档，量完撤销）——这条关系在两档下都应成立。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { openTreePage, withoutKnownNoise, type OpenedPage } from './harness.ts'
import { LAB_TREES, type LabTreeRoute } from './labServer.ts'
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

const FRAME = '[class*="dshOneSidebarShell_frame"]'
/** 官方侧栏根元素（官方页上没有我们那棵树的 `.dshOneTree_root`，容器内容右缘按它算）。 */
const SIDEBAR_ROOT = '.dshOneSidebarShell_side>div>[class*="root"]'
const ROOT = '.dshOneTree_root'
const TOP_BAR = '[data-dshone-tree="top-bar"]'
const TOP_ACTIONS = '[data-dshone-tree="top-bar-actions"]'
const SEARCH_BOX = '[data-dshone-tree="search-box"]'
const SEARCH_BUTTON = '[data-dshone-tree-action="search"]'
const SEARCH_SLOT = '.dshOneTree_searchSlot'
const FILTER_BAR = '.dshOneTree_filterBar'
const PILL = '.dshOneTree_pill'
const LIST_AREA = '.dshOneTree_listArea'
const LIST = '.dshOneTree_list'
const PROJECT_ROW = '.dshOneTree_projectRow'

/** ① 的容差：±1px（与 F-35 同口径——半像素边框与亚像素舍入都可能差零点几像素）。 */
const ALIGN_TOLERANCE = 1

interface Box {
  left: number
  right: number
  width: number
  height: number
}

interface RightReading {
  /** 侧栏列（frame）右缘——所有「距侧栏右缘多远」的零点。 */
  sidebarRight: number
  /** 树容器的横滚量（量之前必须先钉住没被横滚，见套件里的前置断言）。 */
  rootScrollLeft: number
  /**
   * 容器的**内容右缘**（= 盒子右缘 − 右内边距）：顶栏那一行的出血以它为基准，
   * 「盒子右缘 = 内容右缘 + 4px」那一条按它判。
   */
  rootContentRight: number | null
  /** 顶栏那一行：盒子、内容盒（左 / 右内边距各扣掉）与行内间隙。 */
  topBar: Box | null
  topBarContentRight: number | null
  topBarGap: number
  topBarPaddingRight: number | null
  /** 动作组与它里面最右一枚工具控件（收起态量它）。 */
  actions: Box | null
  rightmostAction: { name: string; box: Box } | null
  /** 搜索框（两态都量）与搜索槽。 */
  searchBox: Box | null
  searchState: string | null
  searchSlot: Box | null
  /** 分组过滤条与胶囊（收起态量两者的关系）。 */
  filterBar: Box | null
  pill: Box | null
  /** 工作区行：行盒左右缘、行的左右内边距、行内容右缘、行里最后一枚占内容子元素的右缘（旁证）。 */
  rowBoxLeft: number | null
  rowBoxRight: number | null
  rowPaddingLeft: number | null
  rowPaddingRight: number | null
  rowContentLeft: number | null
  rowContentRight: number | null
  rowLastContentRight: number | null
  /** 列表与列表区：右缘 + 列表给滚动条留的车道（`offsetWidth − clientWidth`）。 */
  listRight: number | null
  listAreaRight: number | null
  scrollbarLane: number | null
  /** 当页解析出来的密度变量与列表的两格右偏移（报告的读数用）。 */
  rowPaddingInline: number
  sectionGap: number
  scrollbarWidthVar: number
  scrollbarOffsetVar: number
  /** 横向溢出读数：scrollWidth / clientWidth。 */
  overflow: Record<string, readonly [number, number]>
}

/** 量一次自有页当前状态下的右侧读数（元素不在的记 null，由调用方按事实处理）。 */
async function readRight(page: OpenedPage['page']): Promise<RightReading> {
  return page.evaluate(
    (selectors) => {
      const round = (value: number): number => Math.round(value * 100) / 100
      const element = (selector: string): HTMLElement | null => document.querySelector(selector)
      const boxOf = (node: Element | null): Box | null => {
        if (node === null) return null
        const rect = node.getBoundingClientRect()
        return { left: round(rect.left), right: round(rect.right), width: round(rect.width), height: round(rect.height) }
      }
      const px = (value: string): number => Number.parseFloat(value)
      const frame = element(selectors.frame)
      const root = element(selectors.root)
      const rootStyle = root === null ? null : getComputedStyle(root)
      const topBar = element(selectors.topBar)
      const topBarStyle = topBar === null ? null : getComputedStyle(topBar)
      const actions = element(selectors.actions)
      const buttons = Array.from(actions?.querySelectorAll('[data-dshone-tree-action]') ?? []).filter(
        (node) => node.getBoundingClientRect().width > 0,
      )
      const lastButton = buttons.at(-1) ?? null
      const row = element(selectors.projectRow)
      const rowStyle = row === null ? null : getComputedStyle(row)
      const rowBox = row?.getBoundingClientRect() ?? null
      // 旁证：行里最后一枚「真的占位」的子元素（行尾角标 / 时间）的右缘——它应当就是行内容右缘。
      let rowLastContentRight: number | null = null
      for (const child of Array.from(row?.children ?? [])) {
        const childBox = child.getBoundingClientRect()
        if (childBox.width > 0) rowLastContentRight = round(childBox.right)
      }
      const list = element(selectors.list)
      const scroll = (selector: string): readonly [number, number] | null => {
        const node = element(selector)
        return node === null ? null : [node.scrollWidth, node.clientWidth]
      }
      const overflowing: Record<string, readonly [number, number]> = {}
      for (const [name, selector] of Object.entries({
        document: 'html',
        topBar: selectors.topBar,
        listArea: selectors.listArea,
        list: selectors.list,
      })) {
        const pair = scroll(selector)
        if (pair !== null) overflowing[name] = pair
      }
      const variable = (name: string): number => (frame === null ? 0 : px(getComputedStyle(frame).getPropertyValue(name)))
      // 列表那两格右偏移（滚动条车道与列表自己的右外边距）声明在 `.dshOneTree_root` 上、
      // 不在 frame 上（与 `--dsh-one-density-*` 的挂载点不同），所以从 root 上读。
      const rootVariable = (name: string): number => (root === null ? 0 : px(getComputedStyle(root).getPropertyValue(name)))
      return {
        sidebarRight: round(frame?.getBoundingClientRect().right ?? Number.NaN),
        rootScrollLeft: root === null ? Number.NaN : round(root.scrollLeft),
        rootContentRight:
          root === null || rootStyle === null
            ? null
            : round(root.getBoundingClientRect().right - px(rootStyle.paddingRight)),
        topBar: boxOf(topBar),
        topBarContentRight:
          topBar === null || topBarStyle === null
            ? null
            : round(topBar.getBoundingClientRect().right - px(topBarStyle.paddingRight)),
        topBarGap: topBarStyle === null ? 0 : px(topBarStyle.columnGap),
        topBarPaddingRight: topBarStyle === null ? null : px(topBarStyle.paddingRight),
        actions: boxOf(actions),
        rightmostAction:
          lastButton === null
            ? null
            : { name: lastButton.getAttribute('data-dshone-tree-action') ?? '', box: boxOf(lastButton) as Box },
        searchBox: boxOf(element(selectors.searchBox)),
        searchState: element(selectors.searchBox)?.getAttribute('data-dshone-tree-state') ?? null,
        searchSlot: boxOf(element(selectors.searchSlot)),
        filterBar: boxOf(element(selectors.filterBar)),
        pill: boxOf(element(selectors.pill)),
        rowBoxLeft: rowBox === null ? null : round(rowBox.left),
        rowBoxRight: rowBox === null ? null : round(rowBox.right),
        rowPaddingLeft: rowStyle === null ? null : px(rowStyle.paddingLeft),
        rowPaddingRight: rowStyle === null ? null : px(rowStyle.paddingRight),
        rowContentLeft: rowBox === null || rowStyle === null ? null : round(rowBox.left + px(rowStyle.paddingLeft)),
        rowContentRight:
          rowBox === null || rowStyle === null ? null : round(rowBox.right - px(rowStyle.paddingRight)),
        rowLastContentRight,
        listRight: boxOf(list)?.right ?? null,
        listAreaRight: boxOf(element(selectors.listArea))?.right ?? null,
        scrollbarLane: list === null ? null : list.offsetWidth - list.clientWidth,
        rowPaddingInline: variable('--dsh-one-density-row-padding-inline'),
        sectionGap: variable('--dsh-one-density-section-gap'),
        scrollbarWidthVar: rootVariable('--dsh-session-list-scrollbar-width'),
        scrollbarOffsetVar: rootVariable('--dsh-session-list-scrollbar-offset'),
        overflow: overflowing,
      }
    },
    {
      frame: FRAME,
      root: ROOT,
      topBar: TOP_BAR,
      actions: TOP_ACTIONS,
      searchBox: SEARCH_BOX,
      searchSlot: SEARCH_SLOT,
      filterBar: FILTER_BAR,
      pill: PILL,
      listArea: LIST_AREA,
      list: LIST,
      projectRow: PROJECT_ROW,
    },
  )
}

/**
 * 官方对照页那一侧的读数（同一 frame、同一网关数据）：分节头与它的动作组、官方搜索框的展开态、
 * 官方行的内容右缘。官方类名按**后缀**配对（哈希前缀随官方构建变，与 F-04 / F-23 同一口径）。
 */
interface OfficialReading {
  sidebarRight: number
  /** 容器内容右缘（= 官方分节头出血的基准）。 */
  rootContentRight: number | null
  header: Box | null
  headerGap: number
  actionsRight: number | null
  rowContentRight: number | null
  searchBox: Box | null
}

async function readOfficial(page: OpenedPage['page']): Promise<OfficialReading> {
  return page.evaluate(
    (selectors) => {
      const round = (value: number): number => Math.round(value * 100) / 100
      const bySuffix = (suffix: string): HTMLElement | null => {
        const token = `_${suffix}`
        for (const candidate of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
          const className = candidate.getAttribute('class')
          if (className !== null && className.split(/\s+/).some((name) => name.endsWith(token))) return candidate
        }
        return null
      }
      const boxOf = (node: Element | null): Box | null => {
        if (node === null) return null
        const rect = node.getBoundingClientRect()
        return { left: round(rect.left), right: round(rect.right), width: round(rect.width), height: round(rect.height) }
      }
      const root = document.querySelector<HTMLElement>(selectors.root)
      const rootStyle = root === null ? null : getComputedStyle(root)
      const actions = bySuffix('headerActions')
      // 收起态量它；展开态官方把动作组收回去了，那时读数没有意义（套件里不拿它比）。
      const buttons = Array.from(actions?.children ?? []).filter((node) => node.getBoundingClientRect().width > 0)
      const lastButton = buttons.at(-1) ?? null
      const row = bySuffix('projectRow')
      const rowStyle = row === null ? null : getComputedStyle(row)
      const rowBox = row?.getBoundingClientRect() ?? null
      const header = bySuffix('sectionHeader')
      const sidebarRight = round(document.querySelector(selectors.frame)?.getBoundingClientRect().right ?? Number.NaN)
      return {
        sidebarRight,
        // 官方页没有我们那棵树的 `.dshOneTree_root`，容器内容右缘按官方侧栏根元素算
        //（`.dshOneSidebarShell_side>div>[class*="root"]`，见 sidebarFramePlugin 的 CSS）。
        rootContentRight:
          root === null || rootStyle === null
            ? null
            : round(root.getBoundingClientRect().right - Number.parseFloat(rootStyle.paddingRight)),
        header: boxOf(header),
        headerGap: header === null ? 0 : Number.parseFloat(getComputedStyle(header).columnGap),
        actionsRight: lastButton === null ? null : round(lastButton.getBoundingClientRect().right),
        rowContentRight:
          rowBox === null || rowStyle === null ? null : round(rowBox.right - Number.parseFloat(rowStyle.paddingRight)),
        searchBox: boxOf(bySuffix('searchExpanded')),
      }
    },
    { frame: FRAME, root: SIDEBAR_ROOT },
  )
}

/**
 * 把自有页的密度变量按树插件自己声明的官方兜底值内联回 frame（= 官方档）。与
 * F-13 / F-26 / F-35 / F-42 同一处置、同一读法（`var(--dsh-one-density-x, <官方原值>)` 的第二个
 * 参数就是「没人给偏好」时的值）；这里另抄一份是因为几套件分在几个文件里，直接互相 import
 * 会在 `suites.ts` 与独立套件文件之间绕出一个运行期环（其它独立套件只 `import type`，正为此）。
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
      frame.setAttribute('data-lab-density-backup', frame.getAttribute('style') ?? '')
      for (const match of fallbacks) {
        frame.setAttribute('style', `${frame.getAttribute('style') ?? ''};--dsh-one-density-${match[1] ?? ''}:${(match[2] ?? '').trim()}`)
      }
      return fallbacks.length
    },
    [FRAME] as const,
  )
}

/** 撤掉 {@link applyOfficialDensity} 的内联，让页面回到宿主给的 VS Code 档。 */
async function restoreDensity(page: OpenedPage['page']): Promise<void> {
  await page.evaluate(
    ([frameSelector]) => {
      const frame = document.querySelector(frameSelector)
      if (frame === null) return
      const backup = frame.getAttribute('data-lab-density-backup')
      if (backup === null) return
      frame.removeAttribute('data-lab-density-backup')
      if (backup === '') frame.removeAttribute('style')
      else frame.setAttribute('style', backup)
    },
    [FRAME] as const,
  )
}

export const TOPBAR_RIGHT_INSET_SUITE: LabSuite = {
  id: 'F-44',
  phase: 'new-feature',
  name: '顶栏那一行的右侧基准：内容右缘落在行内容右缘那条竖线上（#142，TOPBAR-RIGHT-INSET 套件）',
  expect:
    '真实装配页上（真网关**只读** + 假宿主）、260/340/500 三档宽度 × 两种密度状态（宿主给的 VS Code 档 / 把密度变量对齐回树自己声明的官方兜底值 = 官方档）下量**几何矩形**，另开一页官方浏览区（`/sidebar-official`，同一 frame、同一网关数据）当基准：① **收起态：顶栏内容右缘 = 行内容右缘（±1px）**——「顶栏内容右缘」取最右一枚工具控件（多选入口）的右缘，「行内容右缘」取工作区行行盒右缘 − 行的 `padding-right`（也就是行尾角标 / 时间结束的那条线，#125 左侧口径的右侧对称版），另用「行里最后一枚占内容子元素的右缘」做几何旁证；这一行的内容右缘（盒子右缘 − 右内边距）也一并判在同一条线上。② **展开态：搜索框右缘同样落在那条线上**——期望值按官方 `searchExpanded` 自带的那一笔算（`width:calc(100% + 4px)` + `margin-inline:-2px` 的 2px 外突，再减掉它右端那一格行内间隙），所以 VS Code 档正好落在这条线上、官方档短 2px（= F-42 早就写下的「最多短 2px」），容差 ±1px；同时搜索框左缘仍落在行内容左缘那条线上（#125 的左侧口径没被这次改动带偏）。③ **出血没被动、图标不被裁**——那一行的**盒子**右缘仍等于容器内容右缘 + 4px（官方分节头的 `margin-right:-4px` 还在，也就是仍伸到列表右缘之外），而**内容**整个落在**容器能画出来的范围**内（那一行是 `overflow:hidden`，出血那 4px 会被容器的裁剪切掉——内容往左收之前，最右一枚图标的悬停圆底正好落在被切的那一段里）。④ **胶囊那一侧的关系不变**——收起态里胶囊仍在行尾那一组控件的左边、两者不重叠，且那一行 / 列表区 / 列表 / 文档都没有横向溢出（`scrollWidth ≤ clientWidth + 1`）。⑤ **官方页读数两条**（同为断言，不写死像素）：官方自己的行内容右缘与我们的行内容右缘是同一个值（同一份行 CSS 的直接证据，±1px），而我们这一行的内容右缘比官方那条线更靠内至少一个行内边距（官方把动作组贴到容器内容右缘上，我们这一跳是用户点名要的、刻意往回收）。全程零 pageerror。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const widths = [260, 340, 500] as const
    const own = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { width: 340, height: 900 })
    const official = await openTreePage(ctx.browser, ctx.lab, route('sidebar-official'), { width: 340, height: 900 })
    try {
      const initial = await readRight(own.page)
      check.eq(
        '量法成立：页面没有被横滚（root.scrollLeft = 0；被横滚时整棵树的右缘读数会整体偏移）',
        initial.rootScrollLeft,
        0,
      )
      check.ok(
        '量法成立：顶栏那一行、最右一枚工具控件、搜索框、分组胶囊、工作区行都在（这一轮网关有工作区数据）',
        initial.topBar !== null &&
          initial.rightmostAction !== null &&
          initial.searchBox !== null &&
          initial.pill !== null &&
          initial.rowContentRight !== null,
        JSON.stringify({
          topBar: initial.topBar,
          actions: initial.rightmostAction,
          search: initial.searchBox,
          row: initial.rowContentRight,
        }),
      )
      check.fact(
        `量法：三档宽度 ${widths.join('/')} × 两种密度状态；分节头的右内缩由四个结构量给出` +
          `——4px 出血 + 列表右外边距 ${String(initial.scrollbarOffsetVar)}px（--dsh-session-list-scrollbar-offset）` +
          ` + 滚动条车道 ${String(initial.scrollbarWidthVar)}px（--dsh-session-list-scrollbar-width，当页实测车道 ` +
          `${String(initial.scrollbarLane)}px） + 行右内边距 ${String(initial.rowPaddingInline)}px` +
          `（--dsh-one-density-row-padding-inline）；容差 ±${String(ALIGN_TOLERANCE)}px`,
      )

      for (const density of ['vscode', 'official'] as const) {
        const label = density === 'vscode' ? 'VS Code 档' : '官方档'
        // 密度状态在**这一个档的整个宽度循环**里保持不动（与 F-35 同一处踩过的坑：同一档里
        // 反复 apply 会把「带兜底值的样式」存成备份，restore 就成了空操作）。一次 apply、
        // 量三档、一次 restore。
        if (density === 'official') {
          const aligned = await applyOfficialDensity(own.page)
          check.ok(`${label}：密度变量对齐到树自己声明的官方兜底值（内联项数 > 0）`, aligned >= 20, `内联项数=${String(aligned)}`)
          await own.page.waitForTimeout(200)
        }
        for (const width of widths) {
          await own.page.setViewportSize({ width, height: 900 })
          await own.page.waitForTimeout(300)
          await own.page.evaluate((selector: string) => {
            const root = document.querySelector(selector)
            if (root !== null) root.scrollLeft = 0
          }, ROOT)
          await own.page.waitForTimeout(120)
          const collapsed = await readRight(own.page)
          check.eq(`w=${String(width)} ${label}：量之前没有被横滚`, collapsed.rootScrollLeft, 0)
          check.fact(
            `w=${String(width)} ${label} 收起态读数：顶栏盒子 ${String(collapsed.topBar?.left)}→${String(collapsed.topBar?.right)}` +
              `（内容右缘 ${String(collapsed.topBarContentRight)}，右内边距 ${String(collapsed.topBarPaddingRight)}、行内间隙 ${String(collapsed.topBarGap)}）、` +
              `动作组 ${String(collapsed.actions?.left)}→${String(collapsed.actions?.right)}、最右一枚（${String(collapsed.rightmostAction?.name)}）` +
              `${String(collapsed.rightmostAction?.box.left)}→${String(collapsed.rightmostAction?.box.right)}、` +
              `搜索框 ${String(collapsed.searchBox?.left)}→${String(collapsed.searchBox?.right)}、胶囊 ${String(collapsed.pill?.left)}→${String(collapsed.pill?.right)}；` +
              `行盒右缘 ${String(collapsed.rowBoxRight)} − 行右内边距 ${String(collapsed.rowPaddingRight)} = 行内容右缘 ${String(collapsed.rowContentRight)}` +
              `（旁证：行里最后一枚内容的右缘 ${String(collapsed.rowLastContentRight)}）；` +
              `列表右缘 ${String(collapsed.listRight)}、列表区右缘 ${String(collapsed.listAreaRight)}、容器内容右缘 ${String(collapsed.rootContentRight)}、侧栏右缘 ${String(collapsed.sidebarRight)}`,
          )

          // ---- ① 收起态：顶栏内容右缘 = 行内容右缘（±1px）----
          const action = collapsed.rightmostAction
          check.ok(
            `w=${String(width)} ${label}：收起态最右一枚工具控件的右缘 = 行内容右缘（±${String(ALIGN_TOLERANCE)}px，#142 那条竖线）`,
            action !== null &&
              collapsed.rowContentRight !== null &&
              Math.abs(action.box.right - collapsed.rowContentRight) <= ALIGN_TOLERANCE,
            `图标右缘=${String(action?.box.right)} 行内容右缘=${String(collapsed.rowContentRight)}`,
          )
          check.ok(
            `w=${String(width)} ${label}：收起态那一行的内容右缘也在同一条线上（盒子右缘 − 右内边距）`,
            collapsed.topBarContentRight !== null &&
              collapsed.rowContentRight !== null &&
              Math.abs(collapsed.topBarContentRight - collapsed.rowContentRight) <= ALIGN_TOLERANCE,
            `行内容右缘=${String(collapsed.topBarContentRight)} 行内容右缘=${String(collapsed.rowContentRight)}`,
          )
          // 参照物的两个读法互相印证：行内容右缘（行盒 − 内边距）必须等于行里最后一枚内容的
          // 右缘——不相等说明行的结构变了（参照物要重选）。
          check.ok(
            `w=${String(width)} ${label}：参照物自洽——行内容右缘 = 行里最后一枚内容（行尾角标 / 时间）的右缘`,
            collapsed.rowLastContentRight !== null &&
              collapsed.rowContentRight !== null &&
              Math.abs(collapsed.rowLastContentRight - collapsed.rowContentRight) <= 0.5,
            `行里最后一枚=${String(collapsed.rowLastContentRight)} 行内容右缘=${String(collapsed.rowContentRight)}`,
          )

          // ---- ③ 出血没被动 + 内容整个落在能画出来的范围里 ----
          check.ok(
            `w=${String(width)} ${label}：那一行的盒子右缘 = 容器内容右缘 + 4px（官方分节头的 margin-right:-4px 出血保留）`,
            collapsed.topBar !== null &&
              collapsed.rootContentRight !== null &&
              Math.abs(collapsed.topBar.right - collapsed.rootContentRight - 4) <= 0.5,
            `盒子右缘=${String(collapsed.topBar?.right)} 容器内容右缘=${String(collapsed.rootContentRight)}`,
          )
          check.ok(
            `w=${String(width)} ${label}：盒子右缘仍在列表右缘之外（#125 的 F-35 ④ 同名断言）`,
            collapsed.topBar !== null && collapsed.listRight !== null && collapsed.topBar.right > collapsed.listRight,
            `盒子右缘=${String(collapsed.topBar?.right)} 列表右缘=${String(collapsed.listRight)}`,
          )
          // 那一行是 overflow:hidden，出血出到容器内容右缘之外的那 4px 画不出来（被容器的
          // overflow:hidden 切掉）。内容往左收之前，最右一枚图标的悬停圆底正好压在这一段上
          // ——所以这条按**容器的裁切边界**（容器内容右缘）量，而不是按行的内容盒。
          check.ok(
            `w=${String(width)} ${label}：最右一枚图标的整枚按钮都落在容器的裁切边界内（悬停圆底不会被裁）`,
            action !== null && collapsed.rootContentRight !== null && action.box.right <= collapsed.rootContentRight + 0.5,
            `图标盒=${String(action?.box.left)}→${String(action?.box.right)} 容器内容右缘（裁切边界）=${String(collapsed.rootContentRight)}`,
          )

          // ---- ④ 胶囊那一侧的关系不变 + 不横向溢出 ----
          check.ok(
            `w=${String(width)} ${label}：收起态胶囊仍在行尾那一组控件的左边、不重叠（胶囊右缘 ≤ 搜索框左缘 − 行内间隙 + 1px）`,
            collapsed.pill !== null &&
              collapsed.searchBox !== null &&
              collapsed.pill.right <= collapsed.searchBox.left - collapsed.topBarGap + ALIGN_TOLERANCE,
            `胶囊右缘=${String(collapsed.pill?.right)} 搜索框左缘=${String(collapsed.searchBox?.left)} 行内间隙=${String(collapsed.topBarGap)}`,
          )
          const collapsedOverflow = Object.entries(collapsed.overflow).filter(([, pair]) => pair[0] > pair[1] + 1)
          check.ok(
            `w=${String(width)} ${label}：收起态那一行 / 列表区 / 列表 / 文档都没有横向溢出（scrollWidth ≤ clientWidth + 1）`,
            collapsedOverflow.length === 0,
            JSON.stringify(collapsed.overflow),
          )
          if (width === 340) {
            screenshots.push(await shot(ctx, own.page, `topbar-right-inset-collapsed-${density}-340`))
          }

          // ---- ② 展开态：搜索框右缘落在那条线上（左缘仍归 #125 的左侧口径）----
          await own.page.click(SEARCH_BUTTON)
          await own.page.waitForTimeout(350)
          await own.page.evaluate((selector: string) => {
            const root = document.querySelector(selector)
            if (root !== null) root.scrollLeft = 0
          }, ROOT)
          await own.page.waitForTimeout(150)
          const expanded = await readRight(own.page)
          check.eq(`w=${String(width)} ${label}：展开态（自查，先进了展开态才量）`, expanded.searchState, 'expanded')
          check.fact(
            `w=${String(width)} ${label} 展开态读数：搜索框 ${String(expanded.searchBox?.left)}→${String(expanded.searchBox?.right)}` +
              `（宽 ${String(expanded.searchBox?.width)}）、搜索槽 ${String(expanded.searchSlot?.left)}→${String(expanded.searchSlot?.right)}、` +
              `那一行内容盒右缘 ${String(expanded.topBarContentRight)}、行内容右缘 ${String(expanded.rowContentRight)}、` +
              `行内间隙 ${String(expanded.topBarGap)}px、动作组宽 ${String(expanded.actions?.width)}`,
          )
          // 期望值按官方 searchExpanded 自己那一笔算：`width:calc(100% + 4px)` + `margin-inline:-2px`
          // 让搜索框向两侧各外突 2px，而它右端还短着一格行内间隙 —— 所以期望 = 行内容右缘 + 2 − 间隙。
          const expectedSearchRight =
            (expanded.rowContentRight ?? Number.NaN) + 2 - expanded.topBarGap
          check.ok(
            `w=${String(width)} ${label}：展开态搜索框右缘 = 行内容右缘 + 2px − 行内间隙（±${String(ALIGN_TOLERANCE)}px；` +
              `2px = 官方 searchExpanded 自己的外突，间隙 = ${String(expanded.topBarGap)}px → VS Code 档正好落在那条线上、官方档短 2px）`,
            expanded.searchBox !== null && Math.abs(expanded.searchBox.right - expectedSearchRight) <= ALIGN_TOLERANCE,
            `搜索框右缘=${String(expanded.searchBox?.right)} 期望=${String(expectedSearchRight)} 行内容右缘=${String(expanded.rowContentRight)}`,
          )
          // 左侧那条竖线（#125）：本套件只**记事实**——它由 F-35 / F-42 正面判，这里记一笔是为了
          // 万一右侧的改动把左边带偏时报告里看得见。
          check.fact(
            `w=${String(width)} ${label}：展开态左缘对照（左缘口径归 F-35 / F-42 判）——搜索框左缘 ${String(expanded.searchBox?.left)}、` +
              `行内容左缘 ${String(expanded.rowContentLeft)}（行盒 ${String(expanded.rowBoxLeft)} + 行左内边距 ${String(expanded.rowPaddingLeft)}）`,
          )
          const overflowExpanded = Object.entries(expanded.overflow).filter(([, pair]) => pair[0] > pair[1] + 1)
          check.ok(
            `w=${String(width)} ${label}：展开态那一行 / 列表区 / 列表 / 文档也都没有横向溢出`,
            overflowExpanded.length === 0,
            JSON.stringify(expanded.overflow),
          )
          if (width === 340) {
            screenshots.push(await shot(ctx, own.page, `topbar-right-inset-expanded-${density}-340`))
          }
          await own.page.keyboard.press('Escape')
          await own.page.waitForTimeout(250)
        }
        if (density === 'official') await restoreDensity(own.page)
        await own.page.waitForTimeout(150)
      }

      // ---- ⑤ 官方对照页：那条线在官方页上是多少（#142 要做的第 1 点）----
      await own.page.setViewportSize({ width: 340, height: 900 })
      await official.page.setViewportSize({ width: 340, height: 900 })
      await own.page.waitForTimeout(250)
      await official.page.waitForTimeout(250)
      const ours340 = await readRight(own.page)
      const offCollapsed = await readOfficial(official.page)
      check.fact(
        `官方页 @340 收起态：侧栏右缘 ${String(offCollapsed.sidebarRight)}、容器内容右缘 ${String(offCollapsed.rootContentRight)}、` +
          `分节头盒子 ${String(offCollapsed.header?.left)}→${String(offCollapsed.header?.right)}、动作组最右一枚右缘 ${String(offCollapsed.actionsRight)}、` +
          `官方行内容右缘 ${String(offCollapsed.rowContentRight)}（我们同宽度 ${String(ours340.rowContentRight)}）、行内间隙 ${String(offCollapsed.headerGap)}px`,
      )
      check.ok(
        '官方页：官方自己的行内容右缘 = 我们的行内容右缘（±1px）——两侧同一份行 CSS 与列表容器的直接证据',
        offCollapsed.rowContentRight !== null &&
          ours340.rowContentRight !== null &&
          Math.abs(offCollapsed.rowContentRight - ours340.rowContentRight) <= ALIGN_TOLERANCE,
        `官方=${String(offCollapsed.rowContentRight)} 我们=${String(ours340.rowContentRight)}`,
      )
      check.ok(
        '官方页：我们的顶栏内容右缘比官方那条线更靠内至少一个行内边距（#142 是用户点名要的、刻意比官方更往回收）',
        offCollapsed.actionsRight !== null &&
          ours340.topBarContentRight !== null &&
          ours340.topBarContentRight <= offCollapsed.actionsRight - ours340.rowPaddingInline + ALIGN_TOLERANCE,
        `我们=${String(ours340.topBarContentRight)} 官方=${String(offCollapsed.actionsRight)} 行内边距=${String(ours340.rowPaddingInline)}`,
      )
      check.ok(
        '官方页：官方把动作组贴到容器内容右缘附近（它自己也没把顶栏内容与行内容对齐——这就是我们与官方刻意不同的那一条）',
        offCollapsed.actionsRight !== null &&
          offCollapsed.rowContentRight !== null &&
          offCollapsed.actionsRight > offCollapsed.rowContentRight + 8,
        `官方动作组右缘=${String(offCollapsed.actionsRight)} 官方行内容右缘=${String(offCollapsed.rowContentRight)}`,
      )
      screenshots.push(await shot(ctx, official.page, 'topbar-right-inset-official-340'))

      // 官方页展开态：官方搜索框展开态的右缘（读数，作对照组）。
      await official.page.click('[class*="_searchButton"]')
      await official.page.waitForTimeout(300)
      const offExpanded = await readOfficial(official.page)
      check.fact(
        `官方页 @340 展开态：搜索框 ${String(offExpanded.searchBox?.left)}→${String(offExpanded.searchBox?.right)}、` +
          `侧栏右缘 ${String(offExpanded.sidebarRight)}、官方行内容右缘 ${String(offExpanded.rowContentRight)}`,
      )
      check.ok(
        '官方页：官方搜索框展开态的右缘也在官方那条线附近（≤ 官方动作组那条线，且最多短一格行内间隙）',
        offExpanded.searchBox !== null &&
          offCollapsed.actionsRight !== null &&
          offExpanded.searchBox.right <= offCollapsed.actionsRight + ALIGN_TOLERANCE &&
          offExpanded.searchBox.right >= offCollapsed.actionsRight - offCollapsed.headerGap - ALIGN_TOLERANCE,
        `官方搜索框右缘=${String(offExpanded.searchBox?.right)} 官方收起态动作组右缘=${String(offCollapsed.actionsRight)} 间隙=${String(offCollapsed.headerGap)}`,
      )
      screenshots.push(await shot(ctx, official.page, 'topbar-right-inset-official-expanded-340'))

      check.eq('顶栏右侧基准套件全程零 pageerror', withoutKnownNoise(own.capture.pageErrors).real, [])
      check.eq('官方对照页全程零 pageerror', withoutKnownNoise(official.capture.pageErrors).real, [])
    } finally {
      await own.context.close()
      await official.context.close()
    }
    return screenshots
  },
}
