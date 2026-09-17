/**
 * 顶栏 / 分组过滤条的**横向基准**（#125，F-35 TOPBAR-INLINE）。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与 `topbarRhythmSuites.ts` / `recycleEntrySuites.ts`
 * 同一条：那个文件是本批开发的合入热点，新套件放外面能少一半冲突面。注册方式是在
 * `suites.ts` 的 `SUITES` 末尾追加一项。
 *
 * 量的是什么（#125）：侧栏里那三样东西的左缘要在**同一条竖线**上——
 * ① 顶栏那一行里的搜索框（官方搜索栏的展开态，用户一眼看到的那个圆角方框）；
 * ② 分组过滤条的胶囊；
 * ③ **列表行的内容左缘**（参照物，见下）。
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
  /** 抽屉头标题左缘、抽屉列表左缘、抽屉会话行的内容左缘（抽屉要有内容才量得到行）。 */
  drawerTitleLeft: number | null
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
        drawerTitleLeft: left(selectors.drawerTitle),
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
  name: '顶栏 / 过滤条的横向基准（#125）：搜索框、分组胶囊与行内容左缘同一条竖线（TOPBAR-INLINE 套件）',
  expect:
    '真实装配页上（真网关**只读** + 假宿主）、260/340/500 三档宽度 × 两种密度状态（宿主给的 VS Code 档 / 把密度变量对齐回树插件自己声明的官方兜底值 = 官方档）下量**几何矩形**（不靠截图）：① **三者左缘同一条竖线（±1px）**——搜索框左缘 = 分组胶囊左缘 = 列表行的内容左缘（= 工作区行行盒左缘 + 行的 `padding-left`，也就是文件夹图标那一格的左缘；两个读法必须互相印证）；搜索栏 #132 起是两态，**这一条按展开态判**（点开放大镜再量），收起态的放大镜（28px）只记事实并钉住「不与同一行动作组重叠」——它骑在工具行里、与过滤条不同列，两行并一行是 #135 的事；② **行出血不受影响**——行盒左缘仍在侧栏左缘（±1px）上（hover 底色因此通栏到两侧），且 hover 时底色真的出现（非透明）；③ **三者相对侧栏左缘都不低于下限**——下限 = 当页的 `row-padding-inline`（行内容基准本身）且不低于紧凑档的项内边距 7px（档位表 `SCALE_TIERS.compact.rowPaddingInline`，官方出处 `._item_1nxmc_92{padding:3px 7px}`），防止以后又被压回贴边；④ **右侧关系没被这次改动动过、也不产生横向溢出**——顶栏那一行的右缘仍在列表右缘之外（官方分节头的 `margin-right:-4px` 右出血保留）、过滤条右缘仍落在列表区右缘上、搜索框右缘不超过同一行动作组的左缘、列表 / 过滤条 / 顶栏 / 文档自身的 `scrollWidth ≤ clientWidth + 1`。另核两处「同基准」的顺带项（#125 要做的第 4 点）：底部回收站入口行的主区图标左缘、抽屉头标题左缘、抽屉会话行的内容左缘都落在同一条行内容基准上（抽屉要有内容才量得到行，用假宿主注入一条回收站记录，不写网关）。量之前先钉住 `root.scrollLeft = 0`（整棵树被横滚会让所有读数整体左移，那是另一件事）。全程零 pageerror。',
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

            // ---- ① 三者左缘同一条竖线（±1px）----
            check.ok(
              `w=${String(width)} ${label}：搜索框左缘 = 分组胶囊左缘（±${String(ALIGN_TOLERANCE)}px）`,
              Math.abs(reading.searchLeft - reading.pillLeft) <= ALIGN_TOLERANCE,
              `搜索=${String(reading.searchLeft)} 胶囊=${String(reading.pillLeft)}`,
            )
            check.ok(
              `w=${String(width)} ${label}：分组胶囊左缘 = 行内容左缘（±${String(ALIGN_TOLERANCE)}px）`,
              Math.abs(reading.pillLeft - (reading.rowContentLeft ?? Number.NaN)) <= ALIGN_TOLERANCE,
              `胶囊=${String(reading.pillLeft)} 行=${String(reading.rowContentLeft)}`,
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

            // ---- ③ 相对侧栏左缘的下限 ----
            for (const [name, value] of Object.entries(at)) {
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
            check.ok(
              `w=${String(width)} ${label}：顶栏那一行的右缘仍在列表右缘之外（官方分节头的 margin-right:-4px 右出血保留）`,
              reading.topBarRight > reading.listRight,
              `顶栏右缘=${String(reading.topBarRight)} 列表右缘=${String(reading.listRight)}`,
            )
            check.ok(
              `w=${String(width)} ${label}：过滤条的右缘仍落在列表区右缘上（没有因为改左内缩而缩进去或溢出去）`,
              Math.abs(reading.filterBarRight - reading.listAreaRight) <= 0.5,
              `过滤条右缘=${String(reading.filterBarRight)} 列表区右缘=${String(reading.listAreaRight)}`,
            )
            check.ok(
              `w=${String(width)} ${label}：搜索框的右缘仍不超过同一行动作组的左缘（左内缩没有把它挤出右边界）`,
              reading.searchRight <= reading.topActionsLeft + ALIGN_TOLERANCE,
              `搜索框右缘=${String(reading.searchRight)} 动作组左缘=${String(reading.topActionsLeft)}`,
            )
            check.ok(
              `w=${String(width)} ${label}：胶囊不横向溢出过滤条`,
              reading.pillRight <= reading.filterBarRight + ALIGN_TOLERANCE,
              `胶囊右缘=${String(reading.pillRight)} 过滤条右缘=${String(reading.filterBarRight)}`,
            )
            const overflowing = Object.entries(reading.overflow).filter(([, pair]) => pair[0] > pair[1] + 1)
            check.ok(
              `w=${String(width)} ${label}：列表 / 列表区 / 过滤条 / 顶栏 / 文档都没有横向溢出（scrollWidth ≤ clientWidth + 1）`,
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
          `抽屉 @340（当页 row-padding-inline=${String(drawer.rowPaddingInline)}px）：头标题左缘 ${String(drawer.drawerTitleLeft)}、列表左缘 ${String(drawer.drawerListLeft)}、` +
            `会话行内容左缘 ${String(drawer.drawerRowContentLeft)}（行数 ${String(drawer.drawerRowCount)}）、行内容基准 ${String(drawer.rowContentLeft)}`,
        )
        screenshots.push(await shot(ctx, page, 'topbar-inline-drawer-340'))
        check.ok(
          '抽屉头标题左缘 = 行内容基准（抽屉头也是骨架区，左内缩走行内容基准）',
          drawer.drawerTitleLeft !== null &&
            Math.abs(drawer.drawerTitleLeft - (drawer.rowContentLeft ?? Number.NaN)) <= ALIGN_TOLERANCE,
          `标题=${String(drawer.drawerTitleLeft)} 行内容=${String(drawer.rowContentLeft)}`,
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
            '抽屉会话行的内容左缘 = 行内容基准（与抽屉头标题同一条竖线）',
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
