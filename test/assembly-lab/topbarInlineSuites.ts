/**
 * 顶栏 / 分组过滤条的**横向基准**（#125，F-35 TOPBAR-INLINE）。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与 `topbarRhythmSuites.ts` / `recycleEntrySuites.ts`
 * 同一条：那个文件是本批开发的合入热点，新套件放外面能少一半冲突面。注册方式是在
 * `suites.ts` 的 `SUITES` 末尾追加一项。
 *
 * 量的是什么（#125）：侧栏里那几样东西的左缘要在**同一条竖线**上——
 * ① 顶栏那一行里的搜索框（官方搜索栏的展开态，用户一眼看到的那个圆角方框）；
 * ② 分组过滤条的胶囊；
 * ③ **列表行的内容左缘**（参照物，见下）。
 *
 * **#135 按新形态改了 ① 怎么量**（分组胶囊从列表区那一行搬进了顶栏那一行、两行并一行）：
 * - 收起态（默认那一态）：那一行的行首是**分组胶囊**，所以「同一条竖线」这一条按**胶囊**
 *   量——胶囊左缘 = 行内容左缘；这一刻放大镜靠右挨着动作组（#132 的形态），不在那条竖线上，
 *   套件按事实记它的位置并钉住「不与动作组重叠」。
 * - 展开态：放大镜展开成占满整行的那只搜索框，**胶囊已让位**（零宽收起，`#135`），所以这一
 *   条按**搜索框**量——搜索框左缘 = 行内容左缘。原来那条「搜索框左缘 = 胶囊左缘」在展开态
 *   不再成立（胶囊这一刻是零宽、左缘没有意义），故删去；两态各自的「落在同一条竖线上」分别
 *   由正面的那一件来判，弱化的是**比对对象**、不是判据本身。
 *
 * 让位机制与出处（#135）见 `workspaceTree/toolbar.ts` 与 `workspaceTree/styles.ts`：
 * 官方搜索展开时给分节头的标题与动作组各挂一枚 Hidden 变体（`sectionLabelHidden` /
 * `headerActionsHidden`），我们照同一套把胶囊与动作组收成零宽。
 *
 * **参照物 = 工作区行的内容左缘**，可执行定义是「行盒左缘 + 行的 `padding-left`」，也就是
 * 工作区行里文件夹图标那一格（`.dshOneTree_slot`，宽 16px = 图标 16 档，图标贴着这一格
 * 的左缘）的左缘。两个读法都要量、都要相等：《#125 要做的》里点名的是「工作区行的文件夹
 * 图标左缘，或行内容左缘」，而**行内容左缘**是那一列所有行的共同基准（会话行、抽屉行、
 * 搜索结果行都从它起），所以套件把它当基准的数值定义，并另外用文件夹图标这个可见地标做
 * 一次几何旁证——两者对不上就说明行的第一个子元素不再贴着行的内容左缘（行的结构变了）。
 *
 * 为什么这个数字不是硬编码：行的内容左缘 = 密度档的 `row-padding-inline`（紧密档 7px /
 * 官方档 8px，出处见 styles.ts 文件头的档位表），顶栏那一行的左内缩走骨架基线
 * `section-padding-inline`（紧凑档 2px / 官方 4px）+ 搜索框自己那 2px 外突——两者都是密度
 * 变量，所以本套件在**两种密度状态**下都量一遍：宿主给的 VS Code 档，以及把密度变量按树插件
 * 自己声明的官方兜底值内联回 frame（= 官方档，与 F-04 / F-13 / F-26 同一处置）。关系在两档
 * 下都成立，才说明对齐是那组变量算出来的，不是碰巧量到了某个固定像素。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { openTreePage, withoutKnownNoise, type OpenedPage } from './harness.ts'
import { LAB_TREES, type LabTreeRoute } from './labServer.ts'
import { SCALE_TIERS } from '../../packages/dsh-workspace-tree/src/workspaceTree/styles.ts'
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
const SEARCH = '[data-dshone-tree="search-box"]'
const TOP_ACTIONS = '[data-dshone-tree="top-bar-actions"]'
const FILTER_BAR = '.dshOneTree_filterBar'
const PILL = '.dshOneTree_pill'
const LIST_AREA = '.dshOneTree_listArea'
const LIST = '.dshOneTree_list'
const PROJECT_ROW = '.dshOneTree_projectRow'
const ENTRY_ROW = '[data-dshone-tree="recycle-entry"]'
const ENTRY_MAIN = '.dshOneTree_footerMain'
const DRAWER_HEADER = '.dshOneTree_drawerHeader'
const DRAWER_TITLE = '.dshOneTree_drawerTitle'
const DRAWER_LIST = '.dshOneTree_drawerList'
const DRAWER_ROW = '.dshOneTree_drawerRow'

/**
 * ① 的容差：±1px（#125 给的口径）。半像素边框（搜索框 `.5px solid`、胶囊 `.5px solid`）与
 * 亚像素舍入都可能让三个读数差零点几像素，所以判的是「同一条竖线」而不是「逐字节相等」；
 * 报告里同时把三个实测值原样记下来，真要差出半像素也看得见。
 */
const ALIGN_TOLERANCE = 1

/**
 * ③ 的下限出处：**紧凑档的项内边距**（官方 primitives `Menu` compact 变体
 * `._item_1nxmc_92{padding:3px 7px}`，档位表 `SCALE_TIERS.compact.rowPaddingInline`）。
 * 行的内容左缘就是这个量给的，所以它同时是「行内容基准」的物理下限——顶栏与过滤条若被压到
 * 它以下，就是又贴回侧栏边了。数值从档位表读，不在这里写死 7。
 */
const ROW_CONTENT_FLOOR = Number.parseFloat(SCALE_TIERS.compact.rowPaddingInline)

interface InlineReading {
  /** 侧栏列（frame）左缘——③ 里「相对侧栏左缘」的零点。 */
  sidebarLeft: number
  /** 树容器左缘与它的横滚量（量之前必须先钉住没被横滚，见 suite 里的前置断言）。 */
  rootLeft: number
  rootScrollLeft: number
  searchLeft: number
  searchRight: number
  topActionsLeft: number
  pillLeft: number
  pillRight: number
  filterBarRight: number
  listAreaRight: number
  listRight: number
  topBarRight: number
  /** 工作区行：行盒左缘（= hover 底色的左缘）与行的内容左缘（= 行盒左缘 + padding-left）。 */
  rowBoxLeft: number | null
  rowContentLeft: number | null
  /** 行里第一枚可见图标（文件夹 / hover 时换上的箭头）的左缘——行内容左缘的几何旁证。 */
  rowIconLeft: number | null
  /** 行的 hover 底色（rgba 字符串）：② 要的是「底色在场且通栏」，所以先量到颜色再量左缘。 */
  rowBackground: string
  /** 底部回收站入口行：容器左缘 + 主区图标左缘。 */
  entryBoxLeft: number | null
  entryIconLeft: number | null
  /** 抽屉头：内容左缘（#154 起这一行最左是「返回」，它才是骨架基线的落点）+ 标题左缘 + 标题与返回之间的实测间隙；以及抽屉列表左缘、抽屉会话行的内容左缘（抽屉要有内容才量得到行）。 */
  drawerBackLeft: number | null
  drawerBackRight: number | null
  drawerTitleLeft: number | null
  drawerTitleGap: number | null
  /** 抽屉头这一行自己的列间隙（读 computed style，用来判「标题紧跟在返回之后」）。 */
  drawerHeaderGap: number | null
  drawerListLeft: number | null
  drawerRowContentLeft: number | null
  drawerRowCount: number
  /** 当页解析出来的两个密度变量（px 数），三档宽度下应当不变。 */
  rowPaddingInline: number
  sectionPaddingInline: number
  /** 横向溢出读数：scrollWidth / clientWidth。 */
  overflow: Record<string, readonly [number, number]>
}

/** 量一次当前页面状态下的全部横向读数（元素不在的记 null，由调用方按事实处理）。 */
async function readInline(page: OpenedPage['page']): Promise<InlineReading> {
  return page.evaluate(
    (selectors) => {
      const round = (value: number): number => Math.round(value * 100) / 100
      const element = (selector: string): Element | null => document.querySelector(selector)
      const rect = (selector: string): DOMRect | null => element(selector)?.getBoundingClientRect() ?? null
      const left = (selector: string): number | null => {
        const box = rect(selector)
        return box === null ? null : round(box.left)
      }
      const right = (selector: string): number | null => {
        const box = rect(selector)
        return box === null ? null : round(box.right)
      }
      const px = (value: string): number => Number.parseFloat(value)

      const frame = element(selectors.frame)
      const root = element(selectors.root)
      const row = element(selectors.projectRow)
      const rowStyle = row === null ? null : getComputedStyle(row)
      const rowBox = row?.getBoundingClientRect() ?? null
      // 行的内容左缘 = 行盒左缘 + 行的左内边距（这就是「行内容基准」的数值定义）。
      const rowContentLeft =
        rowBox === null || rowStyle === null ? null : round(rowBox.left + px(rowStyle.paddingLeft))
      // 几何旁证：行里第一枚「真的占位」的子元素（工作区行是文件夹图标那一格/hover 时的箭头
      // 那一格）——它应当从行的内容左缘起。
      let rowIconLeft: number | null = null
      for (const child of Array.from(row?.children ?? [])) {
        const box = child.getBoundingClientRect()
        if (box.width > 0) {
          rowIconLeft = round(box.left)
          break
        }
      }
      // 底部入口行：容器（含两枚动作图标的框）与主区里第一枚图标。
      const entryMain = element(selectors.entryMain)
      let entryIconLeft: number | null = null
      for (const child of Array.from(entryMain?.children ?? [])) {
        const box = child.getBoundingClientRect()
        if (box.width > 0) {
          entryIconLeft = round(box.left)
          break
        }
      }
      // 抽屉头：#154 起这一行最左是「返回」（骨架基线的落点是它），标题跟在它后面。
      const drawerHeader = element(selectors.drawerHeader)
      const drawerBack = drawerHeader?.querySelector('[data-dshone-tree-action="recycle-close"]') ?? null
      const drawerBackBox = drawerBack?.getBoundingClientRect() ?? null
      const drawerTitle = element(selectors.drawerTitle)
      const drawerTitleBox = drawerTitle?.getBoundingClientRect() ?? null
      const drawerTitleGap =
        drawerBackBox === null || drawerTitleBox === null || drawerBackBox.width === 0
          ? null
          : round(drawerTitleBox.left - drawerBackBox.right)

      // 抽屉会话行：行盒左缘 + 行的左内边距（与列表行同一读法）。
      const drawerRow = element(selectors.drawerRow)
      const drawerRowBox = drawerRow?.getBoundingClientRect() ?? null
      const drawerRowContentLeft =
        drawerRowBox === null || drawerRow === null
          ? null
          : round(drawerRowBox.left + px(getComputedStyle(drawerRow).paddingLeft))

      const scroll = (selector: string): readonly [number, number] | null => {
        const node = element(selector)
        if (node === null) return null
        return [node.scrollWidth, node.clientWidth]
      }
      const overflowing: Record<string, readonly [number, number]> = {}
      for (const [name, selector] of Object.entries({
        document: 'html',
        list: selectors.list,
        listArea: selectors.listArea,
        filterBar: selectors.filterBar,
        topBar: selectors.topBar,
      })) {
        const pair = scroll(selector)
        if (pair !== null) overflowing[name] = pair
      }
      return {
        sidebarLeft: round(rect(selectors.frame)?.left ?? Number.NaN),
        rootLeft: round(rect(selectors.root)?.left ?? Number.NaN),
        rootScrollLeft: root === null ? Number.NaN : round((root as HTMLElement).scrollLeft),
        searchLeft: left(selectors.search) ?? Number.NaN,
        searchRight: right(selectors.search) ?? Number.NaN,
        topActionsLeft: left(selectors.topActions) ?? Number.NaN,
        pillLeft: left(selectors.pill) ?? Number.NaN,
        pillRight: right(selectors.pill) ?? Number.NaN,
        filterBarRight: right(selectors.filterBar) ?? Number.NaN,
        listAreaRight: right(selectors.listArea) ?? Number.NaN,
        listRight: right(selectors.list) ?? Number.NaN,
        topBarRight: right(selectors.topBar) ?? Number.NaN,
        rowBoxLeft: rowBox === null ? null : round(rowBox.left),
        rowContentLeft,
        rowIconLeft,
        rowBackground: rowStyle === null ? '' : rowStyle.backgroundColor,
        entryBoxLeft: left(selectors.entryRow),
        entryIconLeft,
        drawerBackLeft: drawerBackBox === null ? null : round(drawerBackBox.left),
        drawerBackRight: drawerBackBox === null ? null : round(drawerBackBox.right),
        drawerTitleLeft: left(selectors.drawerTitle),
        drawerTitleGap,
        drawerHeaderGap:
          drawerHeader === null ? null : round(px(getComputedStyle(drawerHeader).columnGap)),
        drawerListLeft: left(selectors.drawerList),
        drawerRowContentLeft,
        drawerRowCount: document.querySelectorAll(selectors.drawerRow).length,
        rowPaddingInline: px(frame === null ? '0' : getComputedStyle(frame).getPropertyValue('--dsh-one-density-row-padding-inline')),
        sectionPaddingInline: px(frame === null ? '0' : getComputedStyle(frame).getPropertyValue('--dsh-one-density-section-padding-inline')),
        overflow: overflowing,
      }
    },
    {
      frame: FRAME,
      root: ROOT,
      topBar: TOP_BAR,
      search: SEARCH,
      topActions: TOP_ACTIONS,
      filterBar: FILTER_BAR,
      pill: PILL,
      list: LIST,
      listArea: LIST_AREA,
      projectRow: PROJECT_ROW,
      entryRow: ENTRY_ROW,
      entryMain: ENTRY_MAIN,
      drawerHeader: DRAWER_HEADER,
      drawerTitle: DRAWER_TITLE,
      drawerList: DRAWER_LIST,
      drawerRow: DRAWER_ROW,
    },
  )
}

/**
 * 把自有页的密度变量按树插件自己声明的官方兜底值内联回 frame（= 官方档）。与 F-13 / F-26 的
 * `applyOfficialDensity` 同一处置、同一读法（`var(--dsh-one-density-x, <官方原值>)` 的第二个
 * 参数就是「没人给偏好」时的值）；这里另抄一份是因为两套件在两个文件里，直接互相 import 会在
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

/** 三者左缘与侧栏左缘的距离（③ 的读数）。 */
function insets(reading: InlineReading): { search: number; pill: number; row: number } {
  return {
    search: Math.round((reading.searchLeft - reading.sidebarLeft) * 100) / 100,
    pill: Math.round((reading.pillLeft - reading.sidebarLeft) * 100) / 100,
    row: Math.round(((reading.rowContentLeft ?? Number.NaN) - reading.sidebarLeft) * 100) / 100,
  }
}

export const TOPBAR_INLINE_SUITE: LabSuite = {
  id: 'F-35',
  phase: 'new-feature',
  name: '顶栏 / 过滤条的横向基准（#125 立、#135 按并成一行的新形态重写）：收起看胶囊、展开看搜索框，都与行内容左缘同一条竖线（TOPBAR-INLINE 套件）',
  expect:
    '真实装配页上（真网关**只读** + 假宿主）、260/340/500 三档宽度 × 两种密度状态（宿主给的 VS Code 档 / 把密度变量对齐回树插件自己声明的官方兜底值 = 官方档）下量**几何矩形**（不靠截图）：① **左缘同一条竖线（±1px）**——#135 起分组胶囊与搜索框都在顶栏那一行里，所以**收起态按胶囊量**（胶囊左缘 = 列表行的内容左缘 = 工作区行行盒左缘 + 行的 `padding-left`，也就是文件夹图标那一格的左缘；两个读法必须互相印证），**展开态按搜索框量**（点开放大镜之后，搜索框左缘 = 同一条行内容左缘；这一刻胶囊已让位成零宽，不再拿它比）。收起态的放大镜靠右挨着动作组（#132 的形态），套件按事实记它的位置并钉住「不与动作组重叠」；② **行出血不受影响**——行盒左缘仍在侧栏左缘（±1px）上（hover 底色因此通栏到两侧），且 hover 时底色真的出现（非透明）；③ **相对侧栏左缘有下限**——量到的那个左缘不低于当页的 `row-padding-inline`（行内容基准本身）且不低于紧凑档的项内边距 7px（档位表 `SCALE_TIERS.compact.rowPaddingInline`，官方出处 `._item_1nxmc_92{padding:3px 7px}`），防止以后又被压回贴边；④ **右侧关系与横向溢出**——顶栏那一行的**盒子**右缘仍在列表右缘之外（官方分节头的 `margin-right:-4px` 右出血保留）、胶囊不横向溢出它所在的盒子、展开态搜索框的右缘不越出那一行的内容右缘、那一行 / 列表区 / 列表 / 文档自身的 `scrollWidth ≤ clientWidth + 1`。**#142 起这一行右侧的「内容内缩」另有专条**：那一行补了 `padding-right`（值 = 4px 出血 + 列表右外边距 + 滚动条车道 + 行右内边距，见 `styles.ts` 那条规则上方），把**内容**右缘收到「行内容右缘」那条竖线上——这条关系由 **F-44** 在真页面里判（三档宽度 × 两档密度、收起 / 展开两态），本套件只守**盒子**：这里管盒子右缘的出血与不溢出（上一条的四个判据一条没放宽，只是从此「盒子」与「内容」两条口径分工明确）。（#125 时的两条按新形态退场：过滤条不再自成一行、所以「过滤条右缘 = 列表区右缘」不成立；展开态的动作组已让位成零宽、所以不比「搜索框右缘 ≤ 动作组左缘」。）另核两处「同基准」的顺带项（#125 要做的第 4 点）：底部回收站入口行的主区图标左缘、抽屉头的内容左缘（#154 起这一行最左是「返回」那枚键）、抽屉会话行的内容左缘都落在同一条行内容基准上（抽屉要有内容才量得到行，用假宿主注入一条回收站记录，不写网关）。量之前先钉住 `root.scrollLeft = 0`（整棵树被横滚会让所有读数整体左移，那是另一件事）。全程零 pageerror。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const widths = [260, 340, 500] as const
    const opened = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { width: 340, height: 900 })
    const { page } = opened
    try {
      const initial = await readInline(page)
      check.fact(
        `量法：三档宽度 ${widths.join('/')} × 两种密度状态；① 的容差 ±${String(ALIGN_TOLERANCE)}px；③ 的下限 ` +
          `row-padding-inline（当页 ${String(initial.rowPaddingInline)}px，官方档 ${String(initial.sectionPaddingInline)}→` +
          `${String(initial.rowPaddingInline)} 之外的骨架基线）与紧凑档项内边距 ${String(ROW_CONTENT_FLOOR)}px`,
      )
      check.eq(
        '量法成立：页面没有被横滚（root.scrollLeft = 0；被横滚时整棵树的读数会整体左移，那是另一件事）',
        initial.rootScrollLeft,
        0,
      )
      check.ok(
        '量法成立：顶栏那一行、搜索框、分组胶囊、工作区行都在（这一轮网关有工作区数据）',
        Number.isFinite(initial.searchLeft) && Number.isFinite(initial.pillLeft) && initial.rowContentLeft !== null,
        JSON.stringify({ search: initial.searchLeft, pill: initial.pillLeft, row: initial.rowContentLeft }),
      )
      if (initial.rowContentLeft === null) {
        check.fact('这一轮网关数据里没有工作区行——本套件的对齐断言无法执行')
      } else {
        // ---- 两种密度状态 × 三档宽度：① ~ ④ ----
        for (const density of ['vscode', 'official'] as const) {
          const label = density === 'vscode' ? 'VS Code 档' : '官方档'
          // 密度状态在**这一个档的整个宽度循环**里保持不动：`applyOfficialDensity` 会把当前
          // 行内样式整体存进 `data-lab-density-backup` 再叠加官方兜底值，所以在同一档里反复
          // apply 会把「带兜底值的样式」存成备份，restore 就成了空操作（#125 首版实测踩到：
          // 循环结束后页面停在官方档，后面 hover / 抽屉的读数全变成 8px）。一次 apply、量三档、
          // 一次 restore。
          if (density === 'official') {
            const aligned = await applyOfficialDensity(page)
            check.ok(`${label}：密度变量对齐到树自己声明的官方兜底值（内联项数 > 0）`, aligned >= 20, `内联项数=${String(aligned)}`)
            await page.waitForTimeout(200)
          }
          for (const width of widths) {
            await page.setViewportSize({ width, height: 900 })
            await page.waitForTimeout(300)
            // #132 起搜索栏默认是**收起态**（一枚 28px 的放大镜，骑在工具行里），#125 那条
            // 「搜索框左缘 = 分组胶囊左缘」说的是**展开态**那个占满一行的搜索框——收起态压根
            // 没有能跟胶囊同列的搜索框（胶囊在下面那条过滤条上，两行并一行是 #135 的事）。
            // 所以这里先把收起态量下来记事实（含「不越界」一条），再点开、按原有口径量展开态。
            const collapsedReading = await readInline(page)
            check.eq(`w=${String(width)} ${label}：量之前没有被横滚`, collapsedReading.rootScrollLeft, 0)
            check.fact(
              `w=${String(width)} ${label}：搜索栏收起态（默认）——左缘 ${String(collapsedReading.searchLeft)}、` +
                `右缘 ${String(collapsedReading.searchRight)}、动作组左缘 ${String(collapsedReading.topActionsLeft)}`,
            )
            check.ok(
              `w=${String(width)} ${label}：收起态的放大镜不与同一行的动作组重叠（右缘 ≤ 动作组左缘 + ${String(ALIGN_TOLERANCE)}px）`,
              collapsedReading.searchRight <= collapsedReading.topActionsLeft + ALIGN_TOLERANCE,
              `搜索右缘=${String(collapsedReading.searchRight)} 动作组左缘=${String(collapsedReading.topActionsLeft)}`,
            )
            // #135：收起态占行首的是**分组胶囊**，所以「落在行内容基准那条竖线上」这一条
            // 按胶囊量（展开态才轮到搜索框——那时胶囊已让位成零宽、左缘没有意义）。
            check.ok(
              `w=${String(width)} ${label}：收起态的分组胶囊左缘 = 行内容左缘（±${String(ALIGN_TOLERANCE)}px，#125 那条竖线）`,
              Math.abs(collapsedReading.pillLeft - (collapsedReading.rowContentLeft ?? Number.NaN)) <= ALIGN_TOLERANCE,
              `胶囊=${String(collapsedReading.pillLeft)} 行内容=${String(collapsedReading.rowContentLeft)}`,
            )
            // 胶囊与它所在盒子（过滤条）的溢出关系只在**收起态**量：展开态那一刻过滤条已经被
            // 收成零宽、胶囊在它里面被裁掉（让位机制本身，见 #135），那个读数没有意义。
            check.ok(
              `w=${String(width)} ${label}：收起态胶囊不横向溢出它所在的盒子（过滤条）`,
              collapsedReading.pillRight <= collapsedReading.filterBarRight + ALIGN_TOLERANCE,
              `胶囊右缘=${String(collapsedReading.pillRight)} 过滤条右缘=${String(collapsedReading.filterBarRight)}`,
            )
            const collapsedOverflow = Object.entries(collapsedReading.overflow).filter(([, pair]) => pair[0] > pair[1] + 1)
            check.ok(
              `w=${String(width)} ${label}：收起态列表 / 列表区 / 过滤条 / 顶栏 / 文档都没有横向溢出（scrollWidth ≤ clientWidth + 1）`,
              collapsedOverflow.length === 0,
              JSON.stringify(collapsedReading.overflow),
            )
            if (width === 340) {
              screenshots.push(await shot(ctx, page, `topbar-inline-collapsed-${density}-340`))
            }
            await page.click('[data-dshone-tree-action="search"]')
            await page.waitForTimeout(300)
            // 点放大镜会把焦点挪到输入框上，而顶栏那一行有 4px 的右出血（见 #130）——焦点落到
            // 右侧控件时整棵树会被横滚，读数整体左移。量之前重新钉一次。
            await page.evaluate((selector: string) => {
              const root = document.querySelector(selector)
              if (root !== null) root.scrollLeft = 0
            }, ROOT)
            await page.waitForTimeout(150)
            const reading = await readInline(page)
            check.eq(`w=${String(width)} ${label}：展开搜索后重新钉住横滚再量`, reading.rootScrollLeft, 0)
            const at = insets(reading)
            check.fact(
              `w=${String(width)} ${label}：搜索框左缘 ${String(reading.searchLeft)}、胶囊左缘 ${String(reading.pillLeft)}、` +
                `行内容左缘 ${String(reading.rowContentLeft)}（行盒 ${String(reading.rowBoxLeft)} + 行内边距 ${String(reading.rowPaddingInline)}）、` +
                `旁证（行里第一枚图标）左缘 ${String(reading.rowIconLeft)}；相对侧栏左缘 = 搜索 ${String(at.search)} / 胶囊 ${String(at.pill)} / 行 ${String(at.row)}`,
            )

            // ---- ① 展开态：搜索框左缘 = 行内容左缘（±1px）----
            // #135 之前这里还有一条「搜索框左缘 = 分组胶囊左缘」：那时两件都在 DOM 里、
            // 胶囊在列表区那一行、也是可见的。并成一行之后展开态胶囊已让位成零宽，那条
            // 比对失去对象（零宽盒的左缘不代表任何东西），所以按新形态去掉——同一条竖线
            // 改由「搜索框 ↔ 行内容左缘」正面判，判据本身没放宽。
            check.ok(
              `w=${String(width)} ${label}：搜索框左缘 = 行内容左缘（±${String(ALIGN_TOLERANCE)}px）`,
              Math.abs(reading.searchLeft - (reading.rowContentLeft ?? Number.NaN)) <= ALIGN_TOLERANCE,
              `搜索=${String(reading.searchLeft)} 行=${String(reading.rowContentLeft)}`,
            )
            // 参照物的两个读法互相印证：行内容左缘（行盒 + padding）必须等于行里第一枚图标的左缘
            // ——不相等说明行的第一个子元素不再贴着行的内容左缘（行的结构变了，参照物要重选）。
            check.ok(
              `w=${String(width)} ${label}：参照物自洽——行内容左缘 = 行里第一枚图标（文件夹那一格）的左缘`,
              reading.rowIconLeft !== null && Math.abs(reading.rowIconLeft - (reading.rowContentLeft ?? Number.NaN)) <= 0.5,
              `图标=${String(reading.rowIconLeft)} 行内容=${String(reading.rowContentLeft)}`,
            )

            // ---- ② 行出血不受影响：行盒仍在侧栏左缘上，且 hover 底色真的出现 ----
            check.ok(
              `w=${String(width)} ${label}：行的底色仍通栏（行盒左缘 ≤ 侧栏左缘 + 1px）`,
              reading.rowBoxLeft !== null && reading.rowBoxLeft <= reading.sidebarLeft + 1,
              `行盒=${String(reading.rowBoxLeft)} 侧栏左缘=${String(reading.sidebarLeft)}`,
            )

            // ---- ③ 相对侧栏左缘的下限（展开态量到的那一条左缘）----
            for (const [name, value] of Object.entries({ search: at.search, row: at.row })) {
              check.ok(
                `w=${String(width)} ${label}：${name} 的左缘不低于行内容基准 ${String(reading.rowPaddingInline)}px（相对侧栏左缘 ${String(value)}px）`,
                value >= reading.rowPaddingInline - 0.5,
                `左缘=${String(value)} row-padding-inline=${String(reading.rowPaddingInline)}`,
              )
              check.ok(
                `w=${String(width)} ${label}：${name} 的左缘不低于紧凑档项内边距 ${String(ROW_CONTENT_FLOOR)}px（下限的出处：官方 ` +
                  `._item_1nxmc_92{padding:3px 7px}，档位表 SCALE_TIERS.compact.rowPaddingInline）`,
                value >= ROW_CONTENT_FLOOR - 0.5,
                `左缘=${String(value)} 下限=${String(ROW_CONTENT_FLOOR)}`,
              )
            }

            // ---- ④ 右侧关系不变 + 不产生横向溢出 ----
            // #142：这一行补了 `padding-right`（把**内容**往左收到行内容右缘那条线上），但
            // **盒子**的右出血一字未动——所以下面这条按盒子量（它守的正是「别为了收内容把
            // 出血也去掉」）。内容右缘那条关系由 F-44 判，这里只管盒子与不溢出。
            check.ok(
              `w=${String(width)} ${label}：顶栏那一行的右缘仍在列表右缘之外（官方分节头的 margin-right:-4px 右出血保留）`,
              reading.topBarRight > reading.listRight,
              `顶栏右缘=${String(reading.topBarRight)} 列表右缘=${String(reading.listRight)}`,
            )
            // #135 起过滤条是顶栏那一行里的一件、不再自成一行，所以原来那条「过滤条右缘 =
            // 列表区右缘」按新形态退场（它在列表区里才有那个右缘）；展开态的搜索框吃满整行，
            // 右缘自然也不该再与动作组左缘比（那一刻动作组已让位成零宽、贴在最右）。
            // 两条都换成正面判据：搜索框右缘不越出那一行的内容右缘、胶囊不溢出自己所在的盒子。
            check.fact(
              `w=${String(width)} ${label}：展开态右缘读数——搜索框右缘 ${String(reading.searchRight)}、那一行右缘 ${String(reading.topBarRight)}、` +
                `列表右缘 ${String(reading.listRight)}、过滤条右缘 ${String(reading.filterBarRight)}、列表区右缘 ${String(reading.listAreaRight)}`,
            )
            check.ok(
              `w=${String(width)} ${label}：展开态搜索框的右缘不越出那一行的右缘（占整行时没有被挤出边界）`,
              reading.searchRight <= reading.topBarRight + ALIGN_TOLERANCE,
              `搜索框右缘=${String(reading.searchRight)} 顶栏右缘=${String(reading.topBarRight)}`,
            )
            // 展开态这一条只看「还占着位的三个容器 + 文档」：过滤条这一刻是零宽盒（让位
            // 机制本身），它的 scrollWidth/clientWidth 读数没有意义（收起态那一遍已经量过）。
            const overflowing = Object.entries(reading.overflow).filter(
              ([name, pair]) => name !== 'filterBar' && pair[0] > pair[1] + 1,
            )
            check.ok(
              `w=${String(width)} ${label}：展开态列表 / 列表区 / 顶栏 / 文档都没有横向溢出（scrollWidth ≤ clientWidth + 1）`,
              overflowing.length === 0,
              JSON.stringify(reading.overflow),
            )

            if (width === 340) {
              screenshots.push(await shot(ctx, page, `topbar-inline-${density}-340`))
            }
            // 收起回默认态，下一档宽度 / 下一档密度从头开始（否则下一轮一进门就已经是展开态）。
            await page.keyboard.press('Escape')
            await page.waitForTimeout(250)
          }
          if (density === 'official') await restoreDensity(page)
          await page.waitForTimeout(150)
        }

        // ---- ② 的补充：hover 时底色真的出现（变了颜色）且行盒左缘不动 ----
        await page.setViewportSize({ width: 340, height: 900 })
        await page.waitForTimeout(250)
        const before = await readInline(page)
        await page.hover(PROJECT_ROW)
        await page.waitForTimeout(250)
        const hovered = await readInline(page)
        check.fact(
          `行 hover：底色 ${before.rowBackground} → ${hovered.rowBackground}；行盒左缘 ${String(hovered.rowBoxLeft)}；` +
            `当页 row-padding-inline=${String(hovered.rowPaddingInline)}px（回到 VS Code 档）`,
        )
        check.ok(
          '行 hover：底色变成非透明（底色在场），且行盒左缘仍在侧栏左缘上（通栏不断）',
          hovered.rowBackground !== before.rowBackground &&
            !hovered.rowBackground.includes('rgba(0, 0, 0, 0)') &&
            hovered.rowBoxLeft !== null &&
            hovered.rowBoxLeft <= hovered.sidebarLeft + 1,
          `before=${before.rowBackground} hover=${hovered.rowBackground} 行盒=${String(hovered.rowBoxLeft)}`,
        )
        screenshots.push(await shot(ctx, page, 'topbar-inline-row-hover-340'))

        // ---- 顺带项之一：底部回收站入口行（容器零左内缩、主区自己带行内边距） ----
        check.fact(
          `入口行 @340（当页 row-padding-inline=${String(hovered.rowPaddingInline)}px）：容器左缘 ${String(hovered.entryBoxLeft)}、主区图标左缘 ${String(hovered.entryIconLeft)}、` +
            `行内容基准 ${String(hovered.rowContentLeft)}`,
        )
        if (hovered.entryIconLeft === null) {
          check.fact('这一轮没有渲染出回收站入口行——顺带项的断言无法执行')
        } else {
          check.ok(
            '入口行：主区图标左缘 = 行内容基准（入口行也是行家族，容器不再加左内缩）',
            Math.abs(hovered.entryIconLeft - (hovered.rowContentLeft ?? Number.NaN)) <= ALIGN_TOLERANCE,
            `图标=${String(hovered.entryIconLeft)} 行内容=${String(hovered.rowContentLeft)}`,
          )
          check.ok(
            '入口行：行盒左缘仍在侧栏左缘上（底色通栏，与列表行同一处置）',
            hovered.entryBoxLeft !== null && hovered.entryBoxLeft <= hovered.sidebarLeft + 1,
            `容器左缘=${String(hovered.entryBoxLeft)} 侧栏左缘=${String(hovered.sidebarLeft)}`,
          )
        }

        // ---- 顺带项之二：抽屉头 / 抽屉列表 / 抽屉会话行 ----
        // 抽屉里要有行才量得到「抽屉行的内容左缘」。网关的回收站集合可能是空的（#116：依赖当天
        // 数据的断言会偶发量不到），所以用假宿主注入一条**真实会话 id** 的回收站记录——只写假宿主
        // 的状态存储，不碰网关（与 F-15 同一做法）。
        const sessionId = await page.evaluate(
          () => document.querySelector('[data-dshone-tree-session]')?.getAttribute('data-dshone-tree-session') ?? null,
        )
        if (sessionId === null) {
          check.fact('这一轮树上没有会话行——抽屉行的对齐断言无法执行（抽屉头的那两条仍量）')
        } else {
          await page.addInitScript({
            content: `(() => { globalThis.__LAB_HOST__.stateStore['recycle-bin'] = ${JSON.stringify({ version: 1, sessionIds: [sessionId] })} })()`,
          })
          await page.reload({ waitUntil: 'domcontentloaded' })
          await page.waitForSelector(route('sidebar').readySelector, { timeout: 40_000 })
          await page.waitForTimeout(2_000)
        }
        await page.click('[data-dshone-tree-action="recycle-toggle"]')
        await page.waitForTimeout(500)
        // 抽屉里的块头可能是收起的（视图态住在客户端存储里），展开一下才有行。
        await page.evaluate(() => {
          for (const node of Array.from(document.querySelectorAll('.dshOneTree_drawerGroupLabel'))) {
            if (node.getAttribute('aria-expanded') !== 'true') (node as HTMLElement).click()
          }
        })
        await page.waitForTimeout(400)
        const drawer = await readInline(page)
        check.fact(
          `抽屉 @340（当页 row-padding-inline=${String(drawer.rowPaddingInline)}px）：头里返回键 [${String(drawer.drawerBackLeft)},${String(drawer.drawerBackRight)}]、标题左缘 ${String(drawer.drawerTitleLeft)}（标题 − 返回右缘 = ${String(drawer.drawerTitleGap)}）、列表左缘 ${String(drawer.drawerListLeft)}、` +
            `会话行内容左缘 ${String(drawer.drawerRowContentLeft)}（行数 ${String(drawer.drawerRowCount)}）、行内容基准 ${String(drawer.rowContentLeft)}`,
        )
        screenshots.push(await shot(ctx, page, 'topbar-inline-drawer-340'))
        check.ok(
          '抽屉头的内容左缘（#154 起这一行最左是「返回」）= 行内容基准（抽屉头也是骨架区，左内缩走行内容基准）',
          drawer.drawerBackLeft !== null &&
            Math.abs(drawer.drawerBackLeft - (drawer.rowContentLeft ?? Number.NaN)) <= ALIGN_TOLERANCE,
          `返回键=${String(drawer.drawerBackLeft)} 行内容=${String(drawer.rowContentLeft)}`,
        )
        check.ok(
          '抽屉头标题紧跟返回之后（标题左缘 − 返回右缘 = 这一行自己的列间隙，±1px；#154 起标题不再是这一行的第一个元素，这条关系取代了原来那条「标题左缘 = 行内容基准」）',
          drawer.drawerTitleGap !== null &&
            drawer.drawerHeaderGap !== null &&
            Math.abs(drawer.drawerTitleGap - drawer.drawerHeaderGap) <= ALIGN_TOLERANCE,
          `标题−返回右缘=${String(drawer.drawerTitleGap)} 头列间隙=${String(drawer.drawerHeaderGap)}`,
        )
        check.ok(
          '抽屉列表左缘 = 容器自己的左缘（列表容器零左内缩，行自己带行内边距，与主列表同一处置）',
          drawer.drawerListLeft !== null && drawer.drawerListLeft <= drawer.sidebarLeft + 1,
          `列表左缘=${String(drawer.drawerListLeft)} 侧栏左缘=${String(drawer.sidebarLeft)}`,
        )
        if (drawer.drawerRowCount === 0 || drawer.drawerRowContentLeft === null) {
          check.fact('这一轮抽屉里没有会话行（假宿主注入的那条没被认出来）——抽屉行的对齐断言跳过')
        } else {
          check.ok(
            '抽屉会话行的内容左缘 = 行内容基准（与抽屉头那枚返回键同一条竖线；#154 起抽屉头的第一个元素是返回）',
            Math.abs(drawer.drawerRowContentLeft - (drawer.rowContentLeft ?? Number.NaN)) <= ALIGN_TOLERANCE,
            `抽屉行=${String(drawer.drawerRowContentLeft)} 行内容=${String(drawer.rowContentLeft)}`,
          )
        }
      }

      check.eq('顶栏横向基准套件全程零 pageerror', withoutKnownNoise(opened.capture.pageErrors).real, [])
    } finally {
      await opened.context.close()
    }
    return screenshots
  },
}
