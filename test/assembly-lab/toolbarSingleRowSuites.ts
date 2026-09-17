/**
 * 顶栏合并成一行（#135）：分组过滤胶囊与工具行同一行，搜索展开时输入框占整行。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与 `topbarRhythmSuites.ts` / `topbarInlineSuites.ts`
 * 同一条：那个文件是本批开发的合入热点，新套件放外面能少一半冲突面。注册方式是在
 * `suites.ts` 的 `SUITES` 末尾追加一项。
 *
 * 量的是**几何关系**，不是像素定值：
 * - 「同一行」的判据是**各控件顶边的极差 ≤ 1px**（不看谁写在哪个容器里），再加两条旁证——
 *   那一行的高度 = 单个控件的高度（没有第二行被塞进去）、分组过滤条不在列表区里
 *  （#135 之前它自己占列表区的第一行）；
 * - 「行内容基准」沿用 F-35 的可执行定义：**工作区行的内容左缘** = 行盒左缘 + 行的
 *   `padding-left`，再用「行里第一枚占位图标」的左缘做一次旁证；收起态的胶囊与展开态的
 *   输入框都要落在这一条竖线上（#125 定的那条线，#135 把胶囊并进来之后它成了这一行的
 *   行首）；
 * - 期望的高度/尺寸尽量从 `workspaceTree/styles.ts` 的档位表读（紧凑档 = VS Code 档、
 *   标准档 = 把密度变量对齐回官方兜底值之后的那一档），不在这里写死像素。
 *
 * 两档密度各量一遍（与 F-35 / F-26 同一处置：先把树自己声明的官方兜底值内联回 frame =
 * 官方档，量完撤销）——这样「量到的数来自那套密度变量」这件事本身也有判据。
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

const FRAME = '[class*="dshOneSidebarShell_frame"]'
const ROOT = '.dshOneTree_root'
const TOP_BAR = '[data-dshone-tree="top-bar"]'
const TOP_ACTIONS = '[data-dshone-tree="top-bar-actions"]'
const FILTER_BAR = '.dshOneTree_filterBar'
const PILL = '.dshOneTree_pill'
const PILL_LABEL = '.dshOneTree_pillLabel'
const SEARCH_SLOT = '.dshOneTree_searchSlot'
const SEARCH_BOX = '[data-dshone-tree="search-box"]'
const SEARCH_BUTTON = '[data-dshone-tree-action="search"]'
const SEARCH_INPUT = '[data-dshone-tree="search-input"]'
const LIST_AREA = '.dshOneTree_listArea'
const LIST = '.dshOneTree_list'
const PROJECT_ROW = '.dshOneTree_projectRow'

/** ① 的容差：±1px（与 F-35 同口径——半像素边框与亚像素舍入都可能差零点几像素）。 */
const ALIGN_TOLERANCE = 1

interface Box {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
}

interface RowReading {
  /** 那一行的盒子与它的内容盒（左内缩/右内缩各扣掉）。 */
  topBar: Box | null
  contentLeft: number | null
  contentRight: number | null
  /** 收起态的胶囊：盒子 + 它所在容器（过滤条）的可见性与宽度。 */
  pill: Box | null
  filterBar: Box | null
  searchSlot: Box | null
  filterVisible: boolean | null
  filterMarker: string | null
  searchBox: Box | null
  searchState: string | null
  input: Box | null
  actions: Box | null
  actionsVisible: boolean | null
  actionsMarker: string | null
  /** 四枚工具控件的盒子（按 DOM 顺序：折叠全部 / 添加工作区 / 设置 / 多选）。 */
  actionButtons: ReadonlyArray<{ name: string; box: Box }>
  /** 行内容基准（= 工作区行的内容左缘）与它的旁证（行里第一枚占位图标的左缘）。 */
  rowContentLeft: number | null
  rowIconLeft: number | null
  /** 收起的过滤条在列表区里的数量——#135 之后应当是 0。 */
  filterBarsInListArea: number
  /** 胶囊文字那一行是不是单行（`getClientRects().length`，不看高度）与它的宽对比。 */
  pillLabelLines: number
  pillLabelWhiteSpace: string
  pillLabelTextOverflow: string
  pillLabelWidth: number
  pillLabelTextWidth: number
  /** 胶囊挂在哪个元素里（官方 Menu 可能给锚点再包一层——这一层会影响收缩行为）。 */
  pillParent: { tag: string; cls: string; box: Box } | null
  /** 胶囊里那几件固定件（图标 / 计数 / ▾）都在场且非零——窄档下该被收的是名字，不是它们。 */
  pillFixedParts: ReadonlyArray<{ name: string; width: number; height: number; box: Box }>
  /** 横向溢出读数：scrollWidth / clientWidth。 */
  overflow: Record<string, readonly [number, number]>
}

/** 量一次当前页面状态下的整行读数（元素不在的记 null，由调用方按事实处理）。 */
async function readRow(page: OpenedPage['page']): Promise<RowReading | null> {
  return page.evaluate(
    (selectors) => {
      const round = (value: number): number => Math.round(value * 100) / 100
      const element = (selector: string): Element | null => document.querySelector(selector)
      const boxOf = (node: Element | null): Box | null => {
        if (node === null) return null
        const rect = node.getBoundingClientRect()
        return {
          left: round(rect.left),
          right: round(rect.right),
          top: round(rect.top),
          bottom: round(rect.bottom),
          width: round(rect.width),
          height: round(rect.height),
        }
      }
      const visible = (node: Element | null): boolean | null => {
        if (node === null) return null
        const style = getComputedStyle(node)
        return style.visibility !== 'hidden' && style.display !== 'none' && style.pointerEvents !== 'none'
      }
      const topBar = element(selectors.topBar)
      if (topBar === null) return null
      const barStyle = getComputedStyle(topBar)
      const barBox = topBar.getBoundingClientRect()
      const filterBar = element(selectors.filterBar)
      const pill = element(selectors.pill)
      const pillLabel = element(selectors.pillLabel)
      const actions = element(selectors.topActions)
      const row = element(selectors.projectRow)
      const rowStyle = row === null ? null : getComputedStyle(row)
      const rowBox = row?.getBoundingClientRect() ?? null
      let rowIconLeft: number | null = null
      for (const child of Array.from(row?.children ?? [])) {
        const childBox = child.getBoundingClientRect()
        if (childBox.width > 0) {
          rowIconLeft = round(childBox.left)
          break
        }
      }
      let pillLabelTextWidth = -1
      if (pillLabel !== null) {
        const range = document.createRange()
        range.selectNodeContents(pillLabel)
        pillLabelTextWidth = round(range.getBoundingClientRect().width)
      }
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
      return {
        topBar: boxOf(topBar),
        contentLeft: round(barBox.left + Number.parseFloat(barStyle.paddingLeft)),
        contentRight: round(barBox.right - Number.parseFloat(barStyle.paddingRight)),
        pill: boxOf(pill),
        filterBar: boxOf(filterBar),
        searchSlot: boxOf(element(selectors.searchSlot)),
        filterVisible: visible(filterBar),
        filterMarker: filterBar?.getAttribute('data-dshone-tree-visible') ?? null,
        searchBox: boxOf(element(selectors.searchBox)),
        searchState: element(selectors.searchBox)?.getAttribute('data-dshone-tree-state') ?? null,
        input: boxOf(element(selectors.input)),
        actions: boxOf(actions),
        actionsVisible: visible(actions),
        actionsMarker: actions?.getAttribute('data-dshone-tree-visible') ?? null,
        actionButtons: Array.from(actions?.querySelectorAll('[data-dshone-tree-action]') ?? []).map((node) => ({
          name: node.getAttribute('data-dshone-tree-action') ?? '',
          box: boxOf(node) as Box,
        })),
        rowContentLeft:
          rowBox === null || rowStyle === null ? null : round(rowBox.left + Number.parseFloat(rowStyle.paddingLeft)),
        rowIconLeft,
        filterBarsInListArea: document.querySelectorAll(`${selectors.listArea} ${selectors.filterBar}`).length,
        pillLabelLines: pillLabel?.getClientRects().length ?? -1,
        pillLabelWhiteSpace: pillLabel === null ? '' : getComputedStyle(pillLabel).whiteSpace,
        pillLabelTextOverflow: pillLabel === null ? '' : getComputedStyle(pillLabel).textOverflow,
        pillLabelWidth: pillLabel === null ? -1 : round(pillLabel.getBoundingClientRect().width),
        pillLabelTextWidth,
        pillParent:
          pill?.parentElement == null
            ? null
            : {
                tag: pill.parentElement.tagName,
                cls: pill.parentElement.getAttribute('class') ?? '',
                box: boxOf(pill.parentElement) as Box,
              },
        pillFixedParts: ['.dshOneTree_pillTag', '.dshOneTree_pillCount', '.dshOneTree_pillChevron'].map((name) => {
          const node = pill?.querySelector(name) ?? null
          const box = node?.getBoundingClientRect() ?? null
          return {
            name,
            width: box === null ? -1 : round(box.width),
            height: box === null ? -1 : round(box.height),
            box: boxOf(node) as Box,
          }
        }),
        overflow: overflowing,
      }
    },
    {
      topBar: TOP_BAR,
      topActions: TOP_ACTIONS,
      filterBar: FILTER_BAR,
      searchSlot: SEARCH_SLOT,
      pill: PILL,
      pillLabel: PILL_LABEL,
      searchBox: SEARCH_BOX,
      input: SEARCH_INPUT,
      listArea: LIST_AREA,
      list: LIST,
      projectRow: PROJECT_ROW,
    },
  )
}

/**
 * 把自有页的密度变量按树插件自己声明的官方兜底值内联回 frame（= 官方档）。与
 * F-13 / F-26 / F-35 同一处置、同一读法（`var(--dsh-one-density-x, <官方原值>)` 的第二个
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

/** 收起态里「同一行」的那几件：胶囊 + 搜索框 + 四枚工具按钮（顶边的极差就是「行数」）。 */
function collapsedRowTops(reading: RowReading): number[] {
  return [reading.pill?.top, reading.searchBox?.top, ...reading.actionButtons.map((button) => button.box.top)].filter(
    (value): value is number => typeof value === 'number',
  )
}

/** 一行里所有控件的顶边极差（≤ 容差 = 同一行）。 */
function spread(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN
  return Math.round((Math.max(...values) - Math.min(...values)) * 100) / 100
}

export const TOOLBAR_SINGLE_ROW_SUITE: LabSuite = {
  id: 'F-39',
  phase: 'new-feature',
  name: '顶栏合并成一行：分组过滤胶囊与工具行同排、搜索展开时输入框占整行（#135，TOOLBAR-SINGLE-ROW 套件）',
  expect:
    '真实装配页上（真网关**只读** + 假宿主）、260/340/500 三档宽度 × 两种密度状态（宿主给的 VS Code 档 / 把密度变量对齐回树自己声明的官方兜底值 = 官方档）下量**几何矩形**：① **收起态是一行**——胶囊、搜索框（放大镜）与四枚工具控件（折叠/展开全部、添加工作区、设置、多选）的**顶边互差 ≤ 1px**（「同一行」的可执行判据），那一行的高度 = 单个控件的高度（没有第二行被塞进去），且分组过滤条**不在列表区里**（#135 之前它自己占列表区的第一行，所以这条是「两行并一行」的直接证据）；胶囊左缘落在**行内容基准**上（= 工作区行的内容左缘，旁证 = 行里第一枚占位图标的左缘，#125 定的那条竖线）；② **展开态输入框占整行**——搜索框左缘仍在那条行内容基准上（±1px），右缘不越出那一行的内容右缘（且最多短 2px：官方 `searchExpanded` 自己带 2px 左右外突，右边那一格间隙吃掉的那部分允许差这点），而**其余控件让位**：分组过滤条与动作组都收成零宽、`visibility:hidden`、自有标记 `data-dshone-tree-visible=false`（让位方式 = 官方同一套 `sectionLabelHidden` / `headerActionsHidden` 的做法，出处见 toolbar.ts 与 styles.ts）；③ **三档宽度都不横向溢出、不压字**——那一行 / 列表区 / 列表 / 文档的 `scrollWidth ≤ clientWidth + 1`，胶囊文字**单行**（`getClientRects().length === 1`、`white-space:nowrap`）且盒子宽不小于文字宽（没被压扁），四枚工具按钮的右缘都在那一行内；④ **收起后回到多控件一行、点击语义不变**——Esc 收起搜索后胶囊与动作组重新可见、五件又同排，且那一刻点「折叠全部」仍收起整棵树、点「＋」仍开两项菜单、点「设置」仍经宿主能力口发 `vscode.openSettings`、点「多选」仍进选择态（各有判据）。全程零 pageerror。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const widths = [260, 340, 500] as const
    const opened = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { width: 340, height: 900 })
    const { page } = opened
    try {
      const initial = await readRow(page)
      check.ok('量法成立：顶栏那一行在（页面装配起来了）', initial !== null, JSON.stringify(initial))
      if (initial === null) throw new Error('lab: top bar not found')
      check.ok(
        '量法成立：顶栏那一行、分组过滤胶囊、搜索框、四枚工具控件、工作区行都在（这一轮网关有工作区数据）',
        initial.pill !== null &&
          initial.searchBox !== null &&
          initial.actionButtons.length >= 3 &&
          initial.rowContentLeft !== null,
        JSON.stringify({
          pill: initial.pill,
          search: initial.searchBox,
          actions: initial.actionButtons.map((button) => button.name),
          row: initial.rowContentLeft,
        }),
      )
      check.fact(
        `量法：三档宽度 ${widths.join('/')} × 两种密度状态；① 的容差 ±${String(ALIGN_TOLERANCE)}px；` +
          `行内容基准（工作区行的内容左缘）当页 = ${String(initial.rowContentLeft)}，旁证（行里第一枚图标）左缘 = ${String(initial.rowIconLeft)}`,
      )

      for (const density of ['vscode', 'official'] as const) {
        const label = density === 'vscode' ? 'VS Code 档' : '官方档'
        // 期望值按密度档取（紧凑档 = VS Code 档；标准档 = 官方档的兜底值），不写死像素。
        const expectedRowHeight =
          density === 'vscode'
            ? Number.parseFloat(SCALE_TIERS.compact.rowHeight)
            : Number.parseFloat(SCALE_TIERS.standard.sectionHeaderHeight)
        // 图标按钮那一档：VS Code 档取紧凑档 26px、官方档取标准档 28px（搜索框与四枚工具
        // 控件都吃这一档；两者在同一个密度下的取值相同，所以一个数够用）。
        const expectedIconButtonSize = Number.parseFloat(
          density === 'vscode' ? SCALE_TIERS.compact.iconButtonSize : SCALE_TIERS.standard.iconButtonSize,
        )
        if (density === 'official') {
          const aligned = await applyOfficialDensity(page)
          check.ok(`${label}：密度变量对齐到树自己声明的官方兜底值（内联项数 > 0）`, aligned >= 20, `内联项数=${String(aligned)}`)
          await page.waitForTimeout(200)
        }
        for (const width of widths) {
          await page.setViewportSize({ width, height: 900 })
          await page.waitForTimeout(300)
          // 顶栏那一行有 4px 的右出血（官方分节头的 `margin-right:-4px`），展开搜索时焦点
          // 落到输入框可能把整棵树横滚——量之前先钉住（与 F-35 同一处置）。
          await page.evaluate((selector: string) => {
            const root = document.querySelector(selector)
            if (root !== null) root.scrollLeft = 0
          }, ROOT)
          await page.waitForTimeout(120)
          const collapsed = await readRow(page)
          if (collapsed === null) {
            check.fact(`w=${String(width)} ${label}：页面取不到顶栏——跳过`)
            continue
          }
          const tops = collapsedRowTops(collapsed)
          check.fact(
            `w=${String(width)} ${label} 收起态：胶囊 ${JSON.stringify(collapsed.pill)}、过滤条 ${JSON.stringify(collapsed.filterBar)}、` +
              `搜索槽 ${JSON.stringify(collapsed.searchSlot)}、搜索 ${JSON.stringify(collapsed.searchBox)}、` +
              `动作组 ${JSON.stringify(collapsed.actions)}、五件顶边=${tops.join('/')}（极差 ${String(spread(tops))}）；` +
              `胶囊父层 ${JSON.stringify(collapsed.pillParent)}；` +
              `行盒 ${JSON.stringify(collapsed.topBar)}、行内容 ${String(collapsed.contentLeft)}→${String(collapsed.contentRight)}；` +
              `行内容基准 ${String(collapsed.rowContentLeft)}、旁证 ${String(collapsed.rowIconLeft)}`,
          )

          // ---- ① 收起态：五件同一行 + 行内容基准 ----
          check.eq(
            `w=${String(width)} ${label}：收起态五件的顶边极差 ≤ ${String(ALIGN_TOLERANCE)}px（同一行）`,
            spread(tops) <= ALIGN_TOLERANCE,
            true,
          )
          check.eq(
            `w=${String(width)} ${label}：行数 = 1——那一行的高度 = 单个控件的高度（${String(expectedRowHeight)}px）`,
            collapsed.topBar?.height,
            expectedRowHeight,
          )
          check.eq(
            `w=${String(width)} ${label}：分组过滤条不再占列表区的一行（并成一行的直接证据）`,
            collapsed.filterBarsInListArea,
            0,
          )
          check.ok(
            `w=${String(width)} ${label}：参照物自洽——行内容左缘 = 行里第一枚图标（文件夹那一格）的左缘`,
            collapsed.rowIconLeft !== null &&
              Math.abs(collapsed.rowIconLeft - (collapsed.rowContentLeft ?? Number.NaN)) <= 0.5,
            `图标=${String(collapsed.rowIconLeft)} 行内容=${String(collapsed.rowContentLeft)}`,
          )
          check.ok(
            `w=${String(width)} ${label}：收起态的胶囊左缘落在行内容基准上（±${String(ALIGN_TOLERANCE)}px，#125 那条竖线）`,
            collapsed.pill !== null &&
              Math.abs(collapsed.pill.left - (collapsed.rowContentLeft ?? Number.NaN)) <= ALIGN_TOLERANCE,
            `胶囊=${String(collapsed.pill?.left)} 行内容基准=${String(collapsed.rowContentLeft)}`,
          )
          check.ok(
            `w=${String(width)} ${label}：折叠的放大镜在动作组左边、不重叠（与 #132 的既有关系一致）`,
            collapsed.searchBox !== null &&
              collapsed.actions !== null &&
              collapsed.searchBox.right <= collapsed.actions.left + ALIGN_TOLERANCE,
            `搜索右缘=${String(collapsed.searchBox?.right)} 动作组左缘=${String(collapsed.actions?.left)}`,
          )

          // ---- ③ 收起态：不横向溢出、不压字 ----
          const overflowing = Object.entries(collapsed.overflow).filter(([, pair]) => pair[0] > pair[1] + 1)
          check.ok(
            `w=${String(width)} ${label}：那一行 / 列表区 / 列表 / 文档都没有横向溢出（scrollWidth ≤ clientWidth + 1）`,
            overflowing.length === 0,
            JSON.stringify(collapsed.overflow),
          )
          check.eq(
            `w=${String(width)} ${label}：胶囊文字是单行（getClientRects().length === 1）`,
            collapsed.pillLabelLines,
            1,
          )
          check.eq(
            `w=${String(width)} ${label}：胶囊文字不换行（white-space:nowrap）`,
            collapsed.pillLabelWhiteSpace,
            'nowrap',
          )
          // 窄档下这一行确实会紧：那时被收的是**分组名**（省略号截断），不是放大镜或工具
          // 控件。所以这里断的是「收的方式是省略号那条路」，另外两条是「放大镜与四枚工具
          // 的尺寸一分没动」（下面那两条按档位表判）。
          check.eq(
            `w=${String(width)} ${label}：胶囊文字被收时走的是省略号那条路（text-overflow:ellipsis）`,
            collapsed.pillLabelTextOverflow,
            'ellipsis',
          )
          check.ok(
            `w=${String(width)} ${label}：胶囊里那三件固定件（图标 / 计数 / ▾）都还在且非零（收的是名字，不是它们）`,
            collapsed.pillFixedParts.every((part) => part.width > 0 && part.height > 0),
            JSON.stringify(collapsed.pillFixedParts),
          )
          check.ok(
            `w=${String(width)} ${label}：那三件固定件整个落在胶囊盒内（窄档下被裁掉的是名字那一格，不是它们）`,
            collapsed.pill !== null &&
              collapsed.pillFixedParts.every((part) => part.box.right <= collapsed.pill!.right + 0.5),
            JSON.stringify({
              pill: collapsed.pill,
              parts: collapsed.pillFixedParts.map((part) => `${part.name}:${String(part.box.right)}`),
            }),
          )
          if (width !== 260) {
            check.ok(
              `w=${String(width)} ${label}：宽档下胶囊名字完整显示（盒子宽 ≥ 文字实际宽，没有被截）`,
              collapsed.pillLabelWidth + 0.5 >= collapsed.pillLabelTextWidth,
              `盒宽=${String(collapsed.pillLabelWidth)} 文字宽=${String(collapsed.pillLabelTextWidth)}`,
            )
          } else {
            check.fact(
              `w=260 ${label}：胶囊名字盒宽 ${String(collapsed.pillLabelWidth)} / 文字宽 ${String(collapsed.pillLabelTextWidth)}` +
                `（这一档一行本来就紧，短出来的一段走省略号；放大镜与工具控件的尺寸下面单判）`,
            )
          }
          check.eq(
            `w=${String(width)} ${label}：放大镜那一枚没被挤小（宽高都 = 档位表的图标按钮档）`,
            [collapsed.searchBox?.width, collapsed.searchBox?.height],
            [expectedIconButtonSize, expectedIconButtonSize],
          )
          check.ok(
            `w=${String(width)} ${label}：四枚工具控件都没被挤小（高 = 档位表的图标按钮档）`,
            collapsed.actionButtons.length > 0 &&
              collapsed.actionButtons.every((button) => Math.abs(button.box.height - expectedIconButtonSize) <= 0.5),
            JSON.stringify(collapsed.actionButtons.map((button) => `${button.name}:${String(button.box.height)}`)),
          )
          check.ok(
            `w=${String(width)} ${label}：四枚工具控件的右缘都在那一行内（不越界）`,
            collapsed.topBar !== null &&
              collapsed.actionButtons.every((button) => button.box.right <= collapsed.topBar!.right + ALIGN_TOLERANCE),
            JSON.stringify(collapsed.actionButtons.map((button) => `${button.name}:${String(button.box.right)}`)),
          )
          screenshots.push(await shot(ctx, page, `toolbar-single-row-collapsed-${density}-${String(width)}`))

          // ---- ② 展开态：输入框占整行，其余控件让位 ----
          await page.click(SEARCH_BUTTON)
          await page.waitForTimeout(350)
          await page.evaluate((selector: string) => {
            const root = document.querySelector(selector)
            if (root !== null) root.scrollLeft = 0
          }, ROOT)
          await page.waitForTimeout(150)
          const expanded = await readRow(page)
          if (expanded === null) {
            check.fact(`w=${String(width)} ${label}：展开后页面取不到顶栏——跳过`)
            continue
          }
          check.fact(
            `w=${String(width)} ${label} 展开态：输入框 ${JSON.stringify(expanded.input)}、搜索框 ${JSON.stringify(expanded.searchBox)}、` +
              `过滤条 ${JSON.stringify(expanded.filterBar)}（可见=${String(expanded.filterVisible)} 标记=${String(expanded.filterMarker)}）、` +
              `动作组 ${JSON.stringify(expanded.actions)}（可见=${String(expanded.actionsVisible)} 标记=${String(expanded.actionsMarker)}）；` +
              `行内容 ${String(expanded.contentLeft)}→${String(expanded.contentRight)}、行内容基准 ${String(expanded.rowContentLeft)}`,
          )
          check.eq(`w=${String(width)} ${label}：展开态（自查，先进了展开态才量）`, expanded.searchState, 'expanded')
          check.ok(
            `w=${String(width)} ${label}：展开态输入框就在场（它是「占整行」那一件）`,
            expanded.input !== null,
            JSON.stringify(expanded.input),
          )
          // 「占整行」量的是**搜索框**（那枚带边框的容器：放大镜图标位 + 输入框 + 清除钮
          // 都住在它里面）——它是用户眼里那一行上唯一的控件；里面的 `<input>` 只是文字位，
          // 左缘自然在放大镜图标位之后。
          check.ok(
            `w=${String(width)} ${label}：搜索框左缘 = 行内容基准（±${String(ALIGN_TOLERANCE)}px，与收起态的胶囊同一条竖线）`,
            expanded.searchBox !== null &&
              Math.abs(expanded.searchBox.left - (expanded.rowContentLeft ?? Number.NaN)) <= ALIGN_TOLERANCE,
            `搜索框=${String(expanded.searchBox?.left)} 行内容基准=${String(expanded.rowContentLeft)}`,
          )
          check.ok(
            `w=${String(width)} ${label}：搜索框右缘不越出那一行的内容右缘（不裁切；最多短 2px——官方 searchExpanded 自带 2px 外突与右边那一格间隙的差）`,
            expanded.searchBox !== null &&
              expanded.contentRight !== null &&
              expanded.searchBox.right <= expanded.contentRight + 0.5 &&
              expanded.searchBox.right >= expanded.contentRight - 2.5,
            `搜索框右缘=${String(expanded.searchBox?.right)} 行内容右缘=${String(expanded.contentRight)}`,
          )
          check.ok(
            `w=${String(width)} ${label}：搜索框占满整行（宽度 ≥ 行内容区宽 − 6px，其余控件都已让位）`,
            expanded.searchBox !== null &&
              expanded.contentLeft !== null &&
              expanded.contentRight !== null &&
              expanded.searchBox.width >= expanded.contentRight - expanded.contentLeft - 6,
            `搜索框宽=${String(expanded.searchBox?.width)} 行内容区宽=${String((expanded.contentRight ?? 0) - (expanded.contentLeft ?? 0))}`,
          )
          check.ok(
            `w=${String(width)} ${label}：分组过滤条让位（零宽 + 不可见 + 自有标记 false）`,
            expanded.filterVisible === false &&
              expanded.filterMarker === 'false' &&
              expanded.filterBar !== null &&
              expanded.filterBar.width <= 1,
            JSON.stringify({ visible: expanded.filterVisible, marker: expanded.filterMarker, box: expanded.filterBar }),
          )
          check.ok(
            `w=${String(width)} ${label}：动作组让位（零宽 + 不可见 + 自有标记 false）`,
            expanded.actionsVisible === false &&
              expanded.actionsMarker === 'false' &&
              expanded.actions !== null &&
              expanded.actions.width <= 1,
            JSON.stringify({ visible: expanded.actionsVisible, marker: expanded.actionsMarker, box: expanded.actions }),
          )
          const expandedOverflow = Object.entries(expanded.overflow).filter(([, pair]) => pair[0] > pair[1] + 1)
          check.ok(
            `w=${String(width)} ${label}：展开态那一行 / 列表区 / 列表 / 文档也都没有横向溢出`,
            expandedOverflow.length === 0,
            JSON.stringify(expanded.overflow),
          )
          screenshots.push(await shot(ctx, page, `toolbar-single-row-expanded-${density}-${String(width)}`))

          // ---- ④ 收起后回到多控件一行（下一轮的①会重量一遍；这里先钉住「回来了」）----
          await page.keyboard.press('Escape')
          await page.waitForTimeout(350)
          const back = await readRow(page)
          if (back === null) {
            check.fact(`w=${String(width)} ${label}：Esc 收起后取不到顶栏——跳过`)
            continue
          }
          check.eq(`w=${String(width)} ${label}：Esc 后回到收起态`, back.searchState, 'collapsed')
          check.ok(
            `w=${String(width)} ${label}：Esc 后胶囊与动作组重新可见（自有标记回到 true）`,
            back.filterMarker === 'true' && back.actionsMarker === 'true' && back.filterVisible === true && back.actionsVisible === true,
            JSON.stringify({ filter: back.filterMarker, actions: back.actionsMarker }),
          )
          check.eq(
            `w=${String(width)} ${label}：Esc 后五件又同排（顶边极差 ≤ ${String(ALIGN_TOLERANCE)}px）`,
            spread(collapsedRowTops(back)) <= ALIGN_TOLERANCE,
            true,
          )
        }
        if (density === 'official') await restoreDensity(page)
        await page.waitForTimeout(150)
      }

      // ---- ④ 点击语义不变（VS Code 档、340px 一档上走一遍真实路径）----
      await page.setViewportSize({ width: 340, height: 900 })
      await page.waitForTimeout(250)
      const beforeClicks = await readRow(page)
      check.ok(
        '点击语义的前置：四枚工具控件都在且可见（那一刻没有搜索在展开）',
        beforeClicks?.actionsVisible === true && beforeClicks.actionButtons.length >= 3,
        JSON.stringify(beforeClicks?.actionButtons.map((button) => button.name)),
      )

      // 折叠全部：先把树弄成「有展开着的分组」（首屏是哪个态取决于当天数据与本地视图态）。
      if (beforeClicks?.actionButtons.some((button) => button.name === 'collapse-all') === true) {
        const expandedRows = async (): Promise<number> =>
          page.evaluate(() => document.querySelectorAll('[data-dshone-tree-row="workspace"][aria-expanded="true"]').length)
        if ((await expandedRows()) === 0) {
          await page.click('[data-dshone-tree-action="collapse-all"]')
          await page.waitForTimeout(300)
        }
        await page.click('[data-dshone-tree-action="collapse-all"]')
        await page.waitForTimeout(300)
        check.eq('点击语义：点「折叠全部」仍把所有工作区行收起（可见会话行归零）', await expandedRows(), 0)
        check.eq(
          '点击语义：折叠全部后的图标翻成「展开全部」那一态',
          await page.getAttribute('[data-dshone-tree-action="collapse-all"]', 'data-dshone-tree-collapsed'),
          'true',
        )
        await page.click('[data-dshone-tree-action="collapse-all"]')
        await page.waitForTimeout(300)
        check.ok('点击语义：再点一次仍能展开全部（原先有会话的工作区行回来）', (await expandedRows()) > 0)
      } else {
        check.fact('这一轮页面里没有「折叠全部」那一枚——点击语义那一条跳过')
      }

      // 添加工作区：两项菜单仍开得出来（第二项 = 创建新工作区目录）。
      await page.click('[data-dshone-tree-action="add-workspace"]')
      await page.waitForTimeout(300)
      const addItems = await page.evaluate(() => ({
        pick: document.querySelector('[data-dshone-tree-item="workspace-pick"]') !== null,
        create: document.querySelector('[data-dshone-tree-item="workspace-create"]') !== null,
      }))
      check.eq('点击语义：点「＋」仍开两项菜单（选已有文件夹 / 创建新工作区目录）', addItems, { pick: true, create: true })
      await page.keyboard.press('Escape')
      await page.waitForTimeout(250)

      // 设置齿轮：仍经宿主能力口发一条（假宿主只记录）。
      const settingsButton = await page.$('[data-dshone-tree-action="settings"]')
      if (settingsButton === null) {
        check.fact('这一轮假宿主没有设置页——设置齿轮那一枚不在，点击语义那一条跳过')
      } else {
        const before = await page.evaluate(() => {
          const host = (globalThis as unknown as { __LAB_HOST__?: { settingsOpened: unknown[] } }).__LAB_HOST__
          return host?.settingsOpened.length ?? -1
        })
        await page.click('[data-dshone-tree-action="settings"]')
        await page.waitForTimeout(300)
        const after = await page.evaluate(() => {
          const host = (globalThis as unknown as { __LAB_HOST__?: { settingsOpened: unknown[] } }).__LAB_HOST__
          return host?.settingsOpened.length ?? -1
        })
        check.eq('点击语义：点设置齿轮仍经宿主能力口发一条 vscode.openSettings', after - before, 1)
      }

      // 多选入口：仍进选择态（选择态动作条出现），再点一次退出。
      await page.click('[data-dshone-tree-action="select-mode"]')
      await page.waitForTimeout(350)
      check.eq(
        '点击语义：点多选入口仍进选择态（选择态动作条出现）',
        await page.evaluate(() => document.querySelectorAll('[data-dshone-tree="selection-bar"]').length),
        1,
      )
      await page.click('[data-dshone-tree-action="select-mode"]')
      await page.waitForTimeout(300)
      check.eq(
        '点击语义：再点一次仍退出选择态（动作条收起）',
        await page.evaluate(() => document.querySelectorAll('[data-dshone-tree="selection-bar"]').length),
        0,
      )
      screenshots.push(await shot(ctx, page, 'toolbar-single-row-after-clicks-340'))

      // 收尾：把搜索放回收起态（用户平时看到的那个样子）。
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)
      check.ok(
        '收尾：页面回到收起态那一行（胶囊与动作组都可见）',
        (await readRow(page))?.filterMarker === 'true',
      )

      check.eq('顶栏合并成一行套件全程零 pageerror', withoutKnownNoise(opened.capture.pageErrors).real, [])
    } finally {
      await opened.context.close()
    }
    return screenshots
  },
}
