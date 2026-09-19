/**
 * 多选态下会话行的勾选框**缩进一层**（#133），同时保住 #124 立下的 δ 关系不变量。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与 `tagRailSuites.ts` / `scaleSuites.ts` /
 * `collapseAllIconSuites.ts` 同一条：那个文件是本批开发的合入热点，新套件放外面能少一半
 * 冲突面。注册方式是在 `suites.ts` 的 `SUITES` 末尾追加一项。
 *
 * 本套件的判据主要是**成对量出来的关系**，不是绝对像素：
 * - δ =「工作区名左缘 − 会话标题左缘」：正常态与选中态各量一遍，断言 |δ′ − δ| ≤ 1px
 *  （用户在意的是这个关系，不是某个具体数值）。#124 立下这条，本套件沿用、没重复造。
 * - 缩进一条同样按关系量：会话行框的左缘要对上**工作区行那枚文件夹图标的左缘**（同一个
 *   页面、同一档宽度下自己量出来的），而不是写死 29px；「缩进了一层」的另一半判据是
 *   「框左边留出的空 ≥ 一个框宽」。
 * - 期望值尽量从页面自己身上取：工作区行的插入量 =「它自己的勾选框宽 + 行的 flex gap」，
 *   会话行那一段缩进要与它相等（#133 的机制：选中态下框前面先空出一层）。
 * - 几何全部取自 `getBoundingClientRect`（真盒子），不读 DOM 属性；这些量在同一趟
 *   `evaluate` 里成对量，页面滚动与重排都影响不到差值。
 *
 * 全程只读真网关：夹具只注假宿主的状态存储（`tags` 与 `pinned` 两份），不写网关、
 * 不点归档确认，也不动 `~/.dsh`。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { openTreePage, withoutKnownNoise, type OpenedPage } from './harness.ts'
import { LAB_TREES, type LabTreeRoute } from './labServer.ts'
// 只取类型（编译后不留 import，运行期没有环）：套件接口定义在 suites.ts 里，它就是调用方。
import type { LabSuite } from './suites.ts'

const route = (name: string): LabTreeRoute => {
  const found = LAB_TREES.find((candidate) => candidate.route === name)
  if (found === undefined) throw new Error(`lab: unknown tree route ${name}`)
  return found
}

/** 夹具组（注进假宿主 `tags` 的那份 v2 状态里的组）。 */
const GROUP_ID = 'indent-a'
const GROUP_NAME = '刻度组'

/** 三档宽度（与 F-04 / F-29 同一套：窄 / 用户侧栏 / 宽）——几何关系在三档下都要成立。 */
const WIDTHS = [260, 340, 500] as const

const round1 = (value: number): number => Math.round(value * 10) / 10

/**
 * 一行量到的几何。**横向一律以行盒左缘为原点**（`*Inset`）。
 *
 * 为什么不用视口坐标：树根容器 `.dshOneTree_root` 里那一行带 4px 右出血（官方分节头的
 * `margin-right:-4px`），容器这一层是没有横向可滚范围的（#130 起裁切用 `overflow:clip`，
 * 容器根本不是滚动容器；在这之前是 `overflow:hidden`，那时点顶栏那枚「进入多选」按钮
 * 会让浏览器把它横向滚 4px——见 #130）。以行盒为原点量差值与这种绝对坐标平移无关
 * （`#122` 那套量缩进也是这个口径：首个子元素左缘 − 行盒左缘），报告里另记一笔滚过的
 * 祖先，免得把绝对坐标的平移当成回归。
 */
interface RowFacts {
  id: string
  /** 标题（`.dshOneTree_title`）左缘 − 行盒左缘——本件关心的就是它。 */
  titleInset: number | null
  /** 标题的视口左缘（只作观测记录；判定一律用 `titleInset`）。 */
  titleLeft: number | null
  /** 行盒左缘（组内行的 24px 缩进落在 `padding-left` 上，行盒本身不动）。 */
  rowLeft: number
  /** 行的左内边距（组内行的「内容基准」= 行盒左缘 + 它，缩进相对它算）。 */
  rowPaddingLeft: number
  /** 行里第一个子元素的类名（选择态下应当是那段缩进占位）。 */
  firstChild: string
  /** 勾选框现状（不在选择态时为 null）。 */
  check: {
    inset: number
    width: number
    height: number
    marginRight: number
    className: string
    opacity: string
    cursor: string
  } | null
  /** 选中态下框前面那段缩进占位（不在选择态时为 null）。 */
  indent: { inset: number; width: number; className: string } | null
  /** 状态槽现状（正常态在、选择态下让位 —— #133）。 */
  slot: { inset: number; width: number; children: number } | null
  /** 行上的活状态（选择态下不再画点，但这个事实照旧写在行上）。 */
  statusAttr: string | null
  /** 行的解析 flex gap（插入量的另一半在这一段上）。 */
  gap: string
  checked: string | null
  /** 行上方被横向滚过的祖先（诊断用：量的是行盒相对量，它滚多少都不影响判定）。 */
  scrolledAncestors: string[]
}

/** 一趟量到的全局几何（工作区行 + 三行会话，横向同样以各自行盒为原点）。 */
interface IndentFacts {
  selectMode: boolean
  /** 工作区名的左缘 − 工作区行盒左缘。 */
  wsTitleInset: number | null
  /** 工作区行的解析 flex gap。 */
  wsRowGap: string
  /** 工作区行的左内边距。 */
  wsPaddingLeft: number
  /** 工作区行里那枚勾选框（不在选择态时为 null）。 */
  wsCheck: { inset: number; width: number; height: number; marginRight: number } | null
  /** 工作区行里那枚文件夹图标（#133 的参照物：会话行的框要对上它的左缘）。 */
  wsFolder: { inset: number; display: string } | null
  plain: RowFacts | null
  tagged: RowFacts | null
  pinned: RowFacts | null
  /** 侧栏列表容器的横向滚动现状（诊断用：判定不看它，看的是行盒相对量）。 */
  listScroll: { scrollLeft: number; scrollWidth: number; clientWidth: number } | null
  /** 树根那一层容器（`.dshOneTree_root`）的横向滚动现状，同上只作诊断。 */
  rootScroll: { scrollLeft: number; scrollWidth: number; clientWidth: number; overflowX: string } | null
}

/** 量一个工作区块的工作区行 + 三条会话行（未归组 / 组内 / 置顶）。 */
async function indentFacts(
  page: OpenedPage['page'],
  ids: { key: string; plain: string; tagged: string; pinned: string },
): Promise<IndentFacts> {
  return await page.evaluate((args: { key: string; plain: string; tagged: string; pinned: string }): IndentFacts => {
    const round = (value: number): number => Math.round(value * 10) / 10
    const leftOf = (element: Element | null): number | null =>
      element === null ? null : round(element.getBoundingClientRect().left)
    /** 元素左缘相对某个参照盒左缘的偏移（量缩进/插入量都用它）。 */
    const insetOf = (element: Element | null, origin: Element | null): number | null =>
      element === null || origin === null
        ? null
        : round(element.getBoundingClientRect().left - origin.getBoundingClientRect().left)
    const section = document.querySelector(`[data-dshone-group-key="${args.key}"]`)
    const wsRow = section === null ? null : section.querySelector('[data-dshone-tree-row="workspace"]')
    const rowOf = (id: string): Element | null =>
      id === '' ? null : document.querySelector(`[data-dshone-tree-session="${id}"]`)
    const factsOf = (row: Element | null): RowFacts | null => {
      if (row === null) return null
      const check = row.querySelector('.dshOneTree_check')
      const indent = row.querySelector('.dshOneTree_checkIndent')
      const slot = row.querySelector('.dshOneTree_slot')
      const box = check === null ? null : check.getBoundingClientRect()
      const style = check === null ? null : getComputedStyle(check)
      return {
        id: row.getAttribute('data-dshone-tree-session') ?? '',
        titleInset: insetOf(row.querySelector('.dshOneTree_title'), row),
        titleLeft: leftOf(row.querySelector('.dshOneTree_title')),
        rowLeft: round(row.getBoundingClientRect().left),
        rowPaddingLeft: Number.parseFloat(getComputedStyle(row).paddingLeft),
        firstChild: row.firstElementChild?.getAttribute('class') ?? '',
        check:
          check === null || box === null || style === null
            ? null
            : {
                inset: insetOf(check, row) ?? 0,
                width: round(box.width),
                height: round(box.height),
                marginRight: Number.parseFloat(style.marginRight),
                className: check.getAttribute('class') ?? '',
                opacity: style.opacity,
                cursor: style.cursor,
              },
        indent:
          indent === null
            ? null
            : {
                inset: insetOf(indent, row) ?? 0,
                width: round(indent.getBoundingClientRect().width),
                className: indent.getAttribute('class') ?? '',
              },
        slot:
          slot === null
            ? null
            : {
                inset: insetOf(slot, row) ?? 0,
                width: round(slot.getBoundingClientRect().width),
                children: slot.children.length,
              },
        statusAttr: row.getAttribute('data-dshone-tree-status'),
        gap: getComputedStyle(row).gap,
        checked: row.getAttribute('data-dshone-tree-checked'),
        scrolledAncestors: (() => {
          const out: string[] = []
          for (let node: Element | null = row; node !== null; node = node.parentElement) {
            if (node.scrollLeft !== 0) out.push(`${node.getAttribute('class') ?? node.tagName}@${String(node.scrollLeft)}`)
          }
          return out
        })(),
      }
    }
    const wsCheck = wsRow === null ? null : wsRow.querySelector('.dshOneTree_check')
    const wsBox = wsCheck === null ? null : wsCheck.getBoundingClientRect()
    // #133 的参照物：工作区行那枚文件夹图标（悬停时它会与折叠箭头互换，所以非悬停态量）。
    const wsFolder = wsRow === null ? null : wsRow.querySelector('.dshOneTree_folder')
    const wsFolderStyle = wsFolder === null ? null : getComputedStyle(wsFolder)
    const list = document.querySelector('.dshOneTree_list')
    const root = document.querySelector('.dshOneTree_root')
    return {
      selectMode: document.querySelector('[data-dshone-tree="selection-bar"]') !== null,
      wsTitleInset: insetOf(wsRow === null ? null : wsRow.querySelector('.dshOneTree_title'), wsRow),
      wsRowGap: wsRow === null ? '' : getComputedStyle(wsRow).gap,
      wsPaddingLeft: wsRow === null ? 0 : Number.parseFloat(getComputedStyle(wsRow).paddingLeft),
      wsCheck:
        wsCheck === null || wsBox === null
          ? null
          : {
              inset: insetOf(wsCheck, wsRow) ?? 0,
              width: round(wsBox.width),
              height: round(wsBox.height),
              marginRight: Number.parseFloat(getComputedStyle(wsCheck).marginRight),
            },
      wsFolder:
        wsFolder === null || wsFolderStyle === null
          ? null
          : { inset: insetOf(wsFolder, wsRow) ?? 0, display: wsFolderStyle.display },
      plain: factsOf(rowOf(args.plain)),
      tagged: factsOf(rowOf(args.tagged)),
      pinned: factsOf(rowOf(args.pinned)),
      listScroll:
        list === null
          ? null
          : { scrollLeft: round(list.scrollLeft), scrollWidth: list.scrollWidth, clientWidth: list.clientWidth },
      rootScroll:
        root === null
          ? null
          : {
              scrollLeft: round(root.scrollLeft),
              scrollWidth: root.scrollWidth,
              clientWidth: root.clientWidth,
              overflowX: getComputedStyle(root).overflowX,
            },
    }
  }, ids)
}

/** 把整棵树展开（要能看见分组里的会话行）。 */
async function expandAllWorkspaces(page: OpenedPage['page']): Promise<void> {
  const state = async (): Promise<string | null> =>
    page.getAttribute('[data-dshone-tree-action="collapse-all"]', 'data-dshone-tree-collapsed')
  await page.click('[data-dshone-tree-action="collapse-all"]')
  await page.waitForTimeout(250)
  if ((await state()) === 'true') {
    await page.click('[data-dshone-tree-action="collapse-all"]')
    await page.waitForTimeout(250)
  }
}

/**
 * 多选态下会话行的勾选框缩进一层（#133）：正常态与选中态**成对量**同一对元素的 δ
 *（工作区名左缘 − 会话标题左缘），断言两边相等（#124 立下的关系，本条继续用）；
 * 缩进一条量「会话行框左缘 = 工作区行文件夹图标左缘」与「框左边留出的空 ≥ 一个框宽」，
 * 组内会话（#122 的 24px 缩进）同口径各量一遍；顺带回归三态框的可点区域、点框只勾选
 * 不折叠、组头整行点击仍是展开/收起、置顶行不可勾的灰态。
 */
export const SELECT_MODE_INDENT_SUITE: LabSuite = {
  id: 'F-31',
  phase: 'new-feature',
  name: '多选态下会话行的勾选框缩进一层（#133，SELECT-MODE-INDENT 套件）',
  expect:
    '侧栏树（真实网关**只读** + 假宿主 + 真装配页，夹具是注进假宿主状态存储的 `tags` 与 `pinned`）：① **框缩进一层**——选中态下会话行框的左缘 = 同一条工作区行的**文件夹图标左缘**（±1px，260/340/500 三档宽度各量一遍）；框前面那一段空的宽 = 工作区行自己的「框宽 + 行内 gap」（期望值从页面盒子上取，不写死 22px），框左缘 = 行左内边距 + 那一段空；组内会话行同口径（相对组内行的内容基准 = 行盒左缘 + 行左内边距，缩进的量与组外那一条相同）。② **确实缩进了、不是贴边**——框左缘 − 行盒左缘 ≥ 一个框宽（三档宽度）。③ **δ 不变**（#124 立下的关系不变量）——正常态量 δ =「工作区名左缘 − 会话标题左缘」，进多选后量同一对元素的 δ′，断言 |δ′ − δ| ≤ 1px，未归组行与组内行各一条（两态标题都仍落在 49、δ = 2），且两边的位移量相同、等于工作区行自己的插入量。④ **状态槽的处置**（本条选的口径）——选择态下会话行**不留状态槽**（框左边那一段是空的，用户口径就是「左侧留出那一段空」），而活状态照旧写在行上（`data-dshone-tree-status` 与正常态同值）：正常态画点、选择态不画点，事实不丢。⑤ **置顶行仍是灰框**且点它不勾选。⑥ **悬停不参与这段关系**（工作区行 hover 时文件夹↔折叠箭头互换，两个 16px 的槽，δ 一分不动）。⑦ 回归——组头三态框的可点区域仍是 16×20、点它只勾选**不折叠**（组头的整行点击仍负责展开/收起）。⑧ **没有任何祖先被横滚**——正常态与选中态各断言一次「行到根这一条链上没有任何元素 `scrollLeft ≠ 0`」：#130 之前点顶栏那枚「进入多选」会让树根容器横滚 4px（整棵树左移），那条路现在由 F-56 正面守着，本套件按自己量行的那条链再钉一遍。全程零 pageerror。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const shot = async (page: OpenedPage['page'], name: string): Promise<string> => {
      const file = path.join(ctx.shots, `${name}.png`)
      await fsp.mkdir(ctx.shots, { recursive: true })
      await page.screenshot({ path: file })
      return file
    }

    // 一、先开一次页面摸清夹具：需要一个 ≥3 条可操作会话行的工作区块（一条留组外当
    // 「普通会话行」，两条归进一个标签组——组只有一条成员时块不一定会渲染，所以给两条）。
    const probe = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { width: 420, height: 900 })
    let fixture: null | { key: string; rows: string[] } = null
    let pinCandidate = ''
    try {
      await expandAllWorkspaces(probe.page)
      const found = await probe.page.evaluate((): { key: string; rows: string[]; others: string[] } => {
        const operable = (section: Element): string[] =>
          Array.from(section.querySelectorAll('[data-dshone-tree-row="session"]'))
            .filter((row) => row.querySelector('[data-dshone-tree-action="session-menu"]') !== null)
            .map((row) => row.getAttribute('data-dshone-tree-session') ?? '')
            .filter((id) => id !== '')
        let best: { key: string; rows: string[] } | null = null
        for (const section of Array.from(document.querySelectorAll('[data-dshone-group-key]'))) {
          const key = section.getAttribute('data-dshone-group-key') ?? ''
          const rows = operable(section)
          if (rows.length >= 3) {
            best = { key, rows }
            break
          }
        }
        const chosen = best === null ? new Set<string>() : new Set(best.rows.slice(0, 3))
        // 置顶候选要**挑到夹具那一组之外**：组里有一条置顶行时组头最满只能到 some
        // （置顶行不可勾，#17 的口径），⑦ 那条「点组头 = 全选」的期望就落不到 all——
        // 那是本套件自己的夹具挑错了行，不是功能问题（#177 在隔离实例上实测撞到）。
        const outside: string[] = []
        const inside: string[] = []
        for (const section of Array.from(document.querySelectorAll('[data-dshone-group-key]'))) {
          const key = section.getAttribute('data-dshone-group-key') ?? ''
          for (const id of operable(section)) {
            if (chosen.has(id)) continue
            if (key === best?.key) inside.push(id)
            else outside.push(id)
          }
        }
        return { key: best?.key ?? '', rows: best?.rows.slice(0, 3) ?? [], others: [...outside, ...inside] }
      })
      fixture = found.key === '' ? null : { key: found.key, rows: found.rows }
      pinCandidate = found.others[0] ?? ''
    } finally {
      await probe.context.close()
    }
    check.fact(`夹具：工作区块 ${fixture?.key.slice(0, 8) ?? '无'}，行 ${JSON.stringify(fixture?.rows ?? [])}，置顶候选 ${pinCandidate.slice(0, 13) || '无'}`)
    if (fixture === null || fixture.rows.length < 3 || pinCandidate === '') {
      check.ok('真网关上取到一个 ≥3 条可操作会话行的工作区块 + 一条置顶候选', false, JSON.stringify({ fixture, pinCandidate }))
      return screenshots
    }
    const [plain, taggedA, taggedB] = fixture.rows as [string, string, string]
    const ids = { key: fixture.key, plain, tagged: taggedA, pinned: pinCandidate }
    check.fact(`量的是 ${plain}（未归组）与 ${taggedA}（组内，参照物同一条工作区名），置顶夹具 ${pinCandidate.slice(0, 13)}`)

    // 二、带注入状态开页：一条会话归进标签组（v2 形状的 `tags`），另一条置顶（旧形状的
    // 裸 id 数组，插件会迁入并写回，与 F-14 同一做法）。
    const tags = {
      version: 2,
      workspaces: {
        [fixture.key]: {
          tags: [{ id: GROUP_ID, name: GROUP_NAME, color: 'blue' }],
          sessionTags: { [taggedA]: GROUP_ID, [taggedB]: GROUP_ID },
        },
      },
    }
    const opened = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), {
      width: 420,
      height: 900,
      state: { tags, pinned: [pinCandidate] },
    })
    const { page } = opened
    try {
      await expandAllWorkspaces(page)
      const blocks = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-dshone-tree="tag-block"]')).map(
          (block) => block.getAttribute('data-dshone-tree-tag') ?? '',
        ),
      )
      check.eq('夹具的标签组块渲染出来了', blocks.includes(GROUP_ID), true)

      // ---------------------------------------------------------------------
      // ① 正常态：量 δ = 工作区名左缘 − 会话标题左缘（未归组行与组内行各一条）——③ 的两态对照之一
      // ---------------------------------------------------------------------
      const normal = await indentFacts(page, ids)
      check.fact(`正常态：${JSON.stringify(normal)}`)
      check.ok(
        '正常态取到了工作区名与两条会话标题的盒子（否则下面的差值无从谈起）',
        normal.selectMode === false &&
          normal.wsTitleInset !== null &&
          normal.plain?.titleInset != null &&
          normal.tagged?.titleInset != null,
      )
      if (
        normal.selectMode ||
        normal.wsTitleInset === null ||
        normal.plain?.titleInset == null ||
        normal.tagged?.titleInset == null
      ) {
        screenshots.push(await shot(page, 'select-indent-normal-missing'))
        return screenshots
      }
      const offsetPlain = round1(normal.wsTitleInset - normal.plain.titleInset)
      const offsetTagged = round1(normal.wsTitleInset - normal.tagged.titleInset)
      check.fact(
        `正常态里被横向滚过的祖先：${JSON.stringify(normal.plain.scrolledAncestors)}；` +
          `树根容器 ${JSON.stringify(normal.rootScroll)}、列表容器 ${JSON.stringify(normal.listScroll)}` +
          '（量的是行盒相对量，它滚多少都不影响下面的差值）',
      )
      check.eq(
        '正常态：没有任何祖先被横滚（#130 起树根容器不是横向滚动容器）',
        normal.plain.scrolledAncestors,
        [],
      )
      check.fact(
        `正常态 δ（工作区名 − 未归组会话标题）= ${String(offsetPlain)}px；δ(组内) = ${String(offsetTagged)}px` +
          '（负数 = 组内标题比工作区名还靠右，#122 那 24px 缩进的必然结果）',
      )
      check.ok(
        '正常态：工作区名比未归组会话标题靠右那一点量到了（不是两个 0 相减）',
        offsetPlain > 0,
        JSON.stringify({ offsetPlain, offsetTagged }),
      )
      check.ok(
        '正常态：组内会话标题比未归组行更靠右（#122 的 24px 缩进在，参照物是同一条工作区名）',
        offsetTagged < offsetPlain,
        JSON.stringify({ offsetPlain, offsetTagged }),
      )
      screenshots.push(await shot(page, 'select-indent-normal'))

      // ---------------------------------------------------------------------
      // ② 进多选：同一对元素再量一遍（③ 的另一态），并量这一态才有的东西——①/② 的缩进、
      // ④ 的状态槽处置，都在这一段里。
      // ---------------------------------------------------------------------
      await page.click('[data-dshone-tree-action="select-mode"]')
      await page.waitForTimeout(350)
      const selected = await indentFacts(page, ids)
      check.fact(`选中态：${JSON.stringify(selected)}`)
      check.ok(
        '进多选了（动作条在）且工作区行与会话行都出了勾选框',
        selected.selectMode && selected.wsCheck !== null && selected.plain?.check != null && selected.tagged?.check != null,
      )
      const plainSelected = selected.plain
      const taggedSelected = selected.tagged
      const plainCheck = plainSelected === null ? null : plainSelected.check
      const taggedCheck = taggedSelected === null ? null : taggedSelected.check
      if (
        !selected.selectMode ||
        selected.wsCheck === null ||
        selected.wsTitleInset === null ||
        plainSelected === null ||
        taggedSelected === null ||
        plainSelected.titleInset === null ||
        taggedSelected.titleInset === null ||
        plainCheck === null ||
        taggedCheck === null
      ) {
        screenshots.push(await shot(page, 'select-indent-select-missing'))
        return screenshots
      }
      const offsetPlainSelected = round1(selected.wsTitleInset - plainSelected.titleInset)
      const offsetTaggedSelected = round1(selected.wsTitleInset - taggedSelected.titleInset)
      check.fact(
        `选中态 δ = ${String(offsetPlainSelected)}px；δ(组内) = ${String(offsetTaggedSelected)}px（正常态 ${String(offsetPlain)} / ${String(offsetTagged)}）`,
      )
      check.fact(
        `选中态里被横向滚过的祖先：${JSON.stringify(plainSelected.scrolledAncestors)}；树根容器 ${JSON.stringify(selected.rootScroll)}`,
      )
      check.eq(
        '选中态：点「进入多选」之后没有任何祖先被横滚（#130 的现场就是这一步把树滚了 4px）',
        plainSelected.scrolledAncestors,
        [],
      )
      // 核心不变量（#124 立下、#133 继续用）：δ 是关系量，不是绝对值断言（±1px 容差）。
      check.ok(
        '③ 关系不变量：|δ′ − δ| ≤ 1px（工作区名与会话标题的偏移进多选后不变）',
        Math.abs(offsetPlainSelected - offsetPlain) <= 1,
        JSON.stringify({ normal: offsetPlain, selected: offsetPlainSelected }),
      )
      check.ok(
        '③ 组内会话同样保持关系：|δ′(组内) − δ(组内)| ≤ 1px',
        Math.abs(offsetTaggedSelected - offsetTagged) <= 1,
        JSON.stringify({ normal: offsetTagged, selected: offsetTaggedSelected }),
      )
      // 两边同步位移：两条会话行各自右移的量相等（这才是「关系没丢」的机制本身）。
      const shiftPlain = round1(plainSelected.titleInset - (normal.plain?.titleInset ?? Number.NaN))
      const shiftTagged = round1(taggedSelected.titleInset - (normal.tagged?.titleInset ?? Number.NaN))
      const shiftWs = round1(selected.wsTitleInset - (normal.wsTitleInset ?? Number.NaN))
      check.ok(
        '两边位移相同：进多选后会话标题右移的量 = 工作区名右移的量（未归组行与组内行都一样）',
        Math.abs(shiftWs - shiftPlain) <= 1 && Math.abs(shiftWs - shiftTagged) <= 1,
        JSON.stringify({ ws: shiftWs, plain: shiftPlain, tagged: shiftTagged }),
      )
      check.ok(
        '进多选后两边确实都右移了（不是「谁都没动」也不是「只有一边动」）',
        shiftWs > 0 && shiftPlain > 0 && shiftTagged > 0,
        JSON.stringify({ ws: shiftWs, plain: shiftPlain, tagged: shiftTagged }),
      )
      // 插入量的正本从页面上取：工作区行自己的「勾选框宽 + 行内 gap」——不写死 22。
      const wsInsert = round1(selected.wsCheck.width + Number.parseFloat(selected.wsRowGap === '' ? '0' : selected.wsRowGap))
      const plainIndent = plainSelected.indent
      const taggedIndent = taggedSelected.indent
      const folderInset = selected.wsFolder === null ? null : selected.wsFolder.inset
      check.fact(
        `工作区行的插入量（框宽 ${String(selected.wsCheck.width)} + 行内 gap ${selected.wsRowGap}）= ${String(wsInsert)}px；` +
          `会话行框前面那段缩进占位：未归组 ${JSON.stringify(plainIndent)}、组内 ${JSON.stringify(taggedIndent)}；` +
          `工作区行的左内边距 ${String(selected.wsPaddingLeft)}px、会话行 ${String(plainSelected.rowPaddingLeft)}px（组内 ${String(taggedSelected.rowPaddingLeft)}px）；` +
          `工作区行文件夹图标 ${JSON.stringify(selected.wsFolder)}`,
      )
      check.ok(
        '① 框前面那段空的宽 = 工作区行自己的「框宽 + 行内 gap」（一层缩进，不靠猜的常量）',
        plainIndent !== null &&
          taggedIndent !== null &&
          Math.abs(plainIndent.width - wsInsert) <= 1 &&
          Math.abs(taggedIndent.width - wsInsert) <= 1,
        JSON.stringify({ wsInsert, plain: plainIndent, tagged: taggedIndent }),
      )
      check.ok(
        '① 框缩进一层：会话行框的左缘 = 行左内边距 + 那一段空（= 工作区行的插入量）',
        Math.abs(plainCheck.inset - (plainSelected.rowPaddingLeft + wsInsert)) <= 1,
        JSON.stringify({ checkInset: plainCheck.inset, padding: plainSelected.rowPaddingLeft, wsInsert }),
      )
      // #124 那条「两边插入同样的量」照旧成立——只是会话行这一份现在由占位给出，
      // 不再是勾选框自己的外边距（框右外边距为 0；标题那 4px 由标题自己的外边距给）。
      check.ok(
        '两行的插入量一致：会话标题（未归组 / 组内）位移的量 = 工作区名位移的量 = 工作区行自己的那份插入量',
        Math.abs(shiftWs - wsInsert) <= 1 && Math.abs(shiftPlain - wsInsert) <= 1 && Math.abs(shiftTagged - wsInsert) <= 1,
        JSON.stringify({ wsInsert, shiftWs, shiftPlain, shiftTagged, checkMarginRight: plainCheck.marginRight }),
      )
      check.ok(
        '① 会话行框的左缘 = 工作区行文件夹图标的左缘（±1px，这就是「对齐文件夹图标那一列」）',
        folderInset !== null && selected.wsFolder?.display !== 'none' && Math.abs(plainCheck.inset - folderInset) <= 1,
        JSON.stringify({ checkInset: plainCheck.inset, folder: selected.wsFolder }),
      )
      check.ok(
        '② 确实缩进了、不是贴边：框左缘 − 行盒左缘 ≥ 一个框宽',
        plainCheck.inset >= plainCheck.width,
        JSON.stringify({ inset: plainCheck.inset, width: plainCheck.width }),
      )
      check.ok(
        '① 组内会话行同口径：相对组内行的内容基准缩进同样一层（缩进的量与组外那一条相同）',
        Math.abs(taggedCheck.inset - taggedSelected.rowPaddingLeft - (plainCheck.inset - plainSelected.rowPaddingLeft)) <= 1 &&
          taggedCheck.inset - taggedSelected.rowPaddingLeft >= taggedCheck.width,
        JSON.stringify({
          plain: plainCheck.inset - plainSelected.rowPaddingLeft,
          tagged: taggedCheck.inset - taggedSelected.rowPaddingLeft,
          taggedWidth: taggedCheck.width,
        }),
      )
      // ④ 状态槽的处置（#133 的口径）：选择态下**不留**状态槽（框左边那一段是空的），
      // 正常态那颗槽照旧在；活状态没有因此丢掉——它同一份事实还写在行上（后续判定与
      // 断言都不看这颗点，看的是 `data-dshone-tree-status`）。
      check.ok(
        '④ 选择态下会话行不留状态槽（框左边那一段空着）——正常态那颗 16px 的槽在、选择态让位',
        plainSelected.slot === null &&
          taggedSelected.slot === null &&
          normal.plain?.slot != null &&
          normal.tagged?.slot != null,
        JSON.stringify({ selectedPlain: plainSelected.slot, selectedTagged: taggedSelected.slot, normalPlain: normal.plain?.slot }),
      )
      check.ok(
        '④ 状态事实没丢：选择态下行上照旧带着 data-dshone-tree-status（与正常态同一个值）',
        plainSelected.statusAttr !== null &&
          plainSelected.statusAttr !== '' &&
          plainSelected.statusAttr === (normal.plain?.statusAttr ?? null),
        JSON.stringify({ selected: plainSelected.statusAttr, normal: normal.plain?.statusAttr }),
      )

      // ---------------------------------------------------------------------
      // ①/② 在三档宽度下各量一遍：窄 / 用户侧栏 / 宽
      // ---------------------------------------------------------------------
      const perWidth: { width: number; facts: IndentFacts }[] = []
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 })
        await page.waitForTimeout(220)
        perWidth.push({ width, facts: await indentFacts(page, ids) })
      }
      for (const { width, facts } of perWidth) {
        const widthCheck = facts.plain?.check ?? null
        const widthFolder = facts.wsFolder
        check.fact(
          `${width}px：会话行框左缘 = ${String(widthCheck?.inset)}（框宽 ${String(widthCheck?.width)}）、` +
            `工作区行文件夹图标 ${JSON.stringify(widthFolder)}、行左内边距 ${String(facts.plain?.rowPaddingLeft)}`,
        )
        check.ok(
          `${width}px：① 会话行框的左缘 = 工作区行文件夹图标的左缘（±1px）`,
          widthCheck !== null &&
            widthFolder !== null &&
            widthFolder.display !== 'none' &&
            Math.abs(widthCheck.inset - widthFolder.inset) <= 1,
          JSON.stringify({ check: widthCheck?.inset, folder: widthFolder }),
        )
        check.ok(
          `${width}px：② 框确实缩进了一层（框左缘 − 行盒左缘 ≥ 一个框宽）`,
          widthCheck !== null && widthCheck.inset >= widthCheck.width,
          JSON.stringify(widthCheck),
        )
      }
      // 回到用户侧栏那一档（后面的悬停与回归都在这一档做）。
      await page.setViewportSize({ width: 420, height: 900 })
      await page.waitForTimeout(220)

      // ⑥ 悬停不参与这段关系：工作区行 hover 时文件夹与折叠箭头互换（两个 16px 的槽，
      // 官方那一行本来就是这个换法），会话行 hover 时时间与 ⋯ 互换——都在标题之后。
      // 两行各自换完，δ 要一分不动（用户从行菜单进多选时指针就停在行上）。
      await page.hover(`[data-dshone-group-key="${fixture.key}"] [data-dshone-tree-row="workspace"]`)
      await page.waitForTimeout(250)
      const hovered = await indentFacts(page, ids)
      check.fact(`悬停工作区行后：${JSON.stringify({ ws: hovered.wsTitleInset, plain: hovered.plain?.titleInset, tagged: hovered.tagged?.titleInset })}`)
      check.ok(
        '⑥ 悬停不改变关系：工作区行 hover（文件夹↔折叠箭头互换）后 δ 一分不动',
        hovered.wsTitleInset !== null &&
          hovered.plain?.titleInset != null &&
          Math.abs(hovered.wsTitleInset - hovered.plain.titleInset - offsetPlainSelected) <= 1,
        JSON.stringify({ ws: hovered.wsTitleInset, plain: hovered.plain?.titleInset, expected: offsetPlainSelected }),
      )

      screenshots.push(await shot(page, 'select-indent-selected'))

      // ---------------------------------------------------------------------
      // ⑦ 回归一：组头三态框的可点区域不变、点它只勾选不折叠
      // ---------------------------------------------------------------------
      const groupCheck = `[data-dshone-group-key="${fixture.key}"] [data-dshone-tree-action="group-select"]`
      const beforeGroup = await page.evaluate((key: string) => {
        const section = document.querySelector(`[data-dshone-group-key="${key}"]`)
        const head = section?.querySelector('[data-dshone-tree-row="workspace"]')
        return {
          expanded: head?.getAttribute('aria-expanded') ?? '',
          rows: section?.querySelectorAll('[data-dshone-tree-row="session"]').length ?? -1,
          eligible: Array.from(section?.querySelectorAll('[data-dshone-tree-row="session"]') ?? []).filter(
            (row) => row.getAttribute('data-dshone-tree-check') === 'eligible',
          ).length,
        }
      }, fixture.key)
      const box = await page.locator(groupCheck).boundingBox()
      check.ok(
        '⑦ 组头三态框的可点区域还是 16×20（与行内图标位同档）',
        box !== null && Math.abs(box.width - 16) <= 1 && Math.abs(box.height - 20) <= 1,
        JSON.stringify(box),
      )
      await page.click(groupCheck)
      await page.waitForTimeout(300)
      const afterGroup = await page.evaluate((key: string) => {
        const section = document.querySelector(`[data-dshone-group-key="${key}"]`)
        const head = section?.querySelector('[data-dshone-tree-row="workspace"]')
        return {
          expanded: head?.getAttribute('aria-expanded') ?? '',
          rows: section?.querySelectorAll('[data-dshone-tree-row="session"]').length ?? -1,
          checked: section?.querySelectorAll('[data-dshone-tree-checked="true"]').length ?? -1,
          rowState: head?.getAttribute('data-dshone-tree-check') ?? '',
        }
      }, fixture.key)
      check.fact(`组头框点一下：${JSON.stringify({ before: beforeGroup, after: afterGroup })}`)
      check.eq('⑦ 点组头框 = 勾上本组够格的成员（全选态）', afterGroup.checked, beforeGroup.eligible)
      check.eq('⑦ 点组头框不折叠：展开态没变、组内行照旧在', [afterGroup.expanded, afterGroup.rows], [beforeGroup.expanded, beforeGroup.rows])
      check.eq('⑦ 组头三态跟着翻成 all', afterGroup.rowState, 'all')
      await page.click(groupCheck)
      await page.waitForTimeout(300)
      const unchecked = await page.evaluate(
        (key: string) => document.querySelector(`[data-dshone-group-key="${key}"]`)?.querySelectorAll('[data-dshone-tree-checked="true"]').length ?? -1,
        fixture.key,
      )
      check.eq('⑦ 再点一下全取消（框仍只勾选，不含折叠）', unchecked, 0)
      screenshots.push(await shot(page, 'select-indent-group-check'))

      // ---------------------------------------------------------------------
      // ⑦ 回归二：组头整行点击仍是展开/收起
      // ---------------------------------------------------------------------
      const wsTitle = `[data-dshone-group-key="${fixture.key}"] [data-dshone-tree-row="workspace"] .dshOneTree_title`
      await page.locator(wsTitle).click()
      await page.waitForTimeout(350)
      const collapsed = await page.evaluate((key: string) => {
        const section = document.querySelector(`[data-dshone-group-key="${key}"]`)
        return {
          expanded: section?.querySelector('[data-dshone-tree-row="workspace"]')?.getAttribute('aria-expanded') ?? '',
          rows: section?.querySelectorAll('[data-dshone-tree-row="session"]').length ?? -1,
        }
      }, fixture.key)
      check.eq('⑦ 点组头整行（名字上）= 收起', [collapsed.expanded, collapsed.rows], ['false', 0])
      await page.locator(wsTitle).click()
      await page.waitForTimeout(350)
      const reExpanded = await page.evaluate((key: string) => {
        const section = document.querySelector(`[data-dshone-group-key="${key}"]`)
        return {
          expanded: section?.querySelector('[data-dshone-tree-row="workspace"]')?.getAttribute('aria-expanded') ?? '',
          rows: section?.querySelectorAll('[data-dshone-tree-row="session"]').length ?? -1,
        }
      }, fixture.key)
      check.eq('⑦ 再点一下 = 展开（组头整行的展开/收起照旧）', [reExpanded.expanded, reExpanded.rows > 0], ['true', true])

      // ---------------------------------------------------------------------
      // ⑤ 回归三：置顶行仍是灰框、点它不勾选
      // ---------------------------------------------------------------------
      const pinnedRow = `[data-dshone-tree-session="${pinCandidate}"]`
      const pinnedFacts = await page.evaluate((id: string) => {
        const row = document.querySelector(`[data-dshone-tree-session="${id}"]`)
        const check = row?.querySelector('.dshOneTree_check')
        // 灰态画在框里那枚方框上（`SelectMark` 的 `disabled` 支），不是外层那格 16×20
        // 的可点区域上——与 F-14 读 `.dshOneTree_checkOff` 同一份事实。
        const box = row?.querySelector('.dshOneTree_checkBox')
        const style = box === null || box === undefined ? null : getComputedStyle(box)
        return {
          rowState: row?.getAttribute('data-dshone-tree-check') ?? 'missing',
          gray: box?.classList.contains('dshOneTree_checkOff') ?? false,
          opacity: style?.opacity ?? '',
          cursor: style?.cursor ?? '',
          tip: check?.getAttribute('title') ?? '',
          checked: row?.getAttribute('data-dshone-tree-checked') ?? 'missing',
        }
      }, pinCandidate)
      check.fact(`置顶行：${JSON.stringify(pinnedFacts)}`)
      check.ok(
        '⑤ 置顶行不可勾选：行上标 blocked + 框里那枚方框是灰态（半透明、默认光标）+ 带原因提示',
        pinnedFacts.rowState === 'blocked' &&
          pinnedFacts.gray &&
          Math.abs(Number.parseFloat(pinnedFacts.opacity) - 0.35) <= 0.02 &&
          pinnedFacts.cursor === 'default' &&
          pinnedFacts.tip.length > 0,
        JSON.stringify(pinnedFacts),
      )
      await page.click(`${pinnedRow} .dshOneTree_check`)
      await page.waitForTimeout(250)
      const pinnedAfter = await page.evaluate((id: string) => {
        const row = document.querySelector(`[data-dshone-tree-session="${id}"]`)
        return {
          checked: row?.getAttribute('data-dshone-tree-checked') ?? 'missing',
          selected: row?.classList.contains('dshOneTree_selected') ?? false,
        }
      }, pinCandidate)
      check.ok(
        '⑤ 点置顶行的框不切换勾选（灰态还是那颗灰框）',
        pinnedAfter.checked !== 'true' && !pinnedAfter.selected,
        JSON.stringify(pinnedAfter),
      )
      screenshots.push(await shot(page, 'select-indent-pinned-blocked'))

      check.eq('进多选与上面这些交互全程零 pageerror', withoutKnownNoise(opened.capture.pageErrors).real, [])
    } finally {
      await opened.context.close()
    }
    return screenshots
  },
}
