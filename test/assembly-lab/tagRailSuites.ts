/**
 * 标签组的竖线与组内缩进回到旧侧栏规格（#122）：**浅缩进 + 与标签同色的细竖线**。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与 `collapseAllIconSuites.ts` / `scaleSuites.ts`
 * / `recycleEntrySuites.ts` 同一条：那个文件是本批开发的合入热点，新套件放外面能少一半
 * 冲突面。注册方式是在 `suites.ts` 的 `SUITES` 末尾追加一项。
 *
 * 期望值**不硬编码**（与 F-25 同一做法）：
 * - 组色的正本是插件源码里那份色板（`tagGroups.ts` 的 `TAG_COLOR_CSS`）。本件按 F-23
 *   扫密度表同一套「读源码文本」的办法解析它——那个模块 import 了 react 与官方私有包，
 *   在 node 进程里 import 不进来（F-23 的文件头写了同一条理由）。
 * - 几何判据全部取自 `getBoundingClientRect`（真盒子），**不读 DOM 属性**：组内行的左
 *   内边距 = 行里第一个子元素的左缘 − 行盒左缘（行是 flex 且无边框，首个子元素就贴着
 *   内容盒）；竖线的左缘 / 上缘 / 下缘 / 宽度对块盒与 pill 盒比。
 *
 * 全程只读真网关：夹具只注假宿主的状态存储（`tags` 那一份，形状 = 旧侧栏那份 v2 文件），
 * 不写网关、不点归档确认，也不动 `~/.dsh`。
 */
import * as fsp from 'node:fs/promises'
import * as fs from 'node:fs'
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

/** 插件源码里那份标签色板（正本；解析办法的理由见文件头）。 */
function tagColorPalette(): Map<string, string> {
  const file = path.join(
    import.meta.dirname,
    '..',
    '..',
    'src',
    'ui',
    'assembly',
    'shell',
    'workspaceTree',
    'tagGroups.ts',
  )
  const src = fs.readFileSync(file, 'utf8')
  const at = src.indexOf('export const TAG_COLOR_CSS')
  const end = src.indexOf('}', at)
  const pairs = [...src.slice(at, end).matchAll(/(\w+):\s*'(#[0-9a-fA-F]{6})'/g)]
  return new Map(pairs.map((match) => [match[1] ?? '', match[2] ?? '']))
}

const PALETTE = tagColorPalette()

/** `#b180d7` → 浏览器 computed 出来的那种写法 `rgb(177, 128, 215)`。 */
function rgbOf(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16)
  return `rgb(${String((value >> 16) & 255)}, ${String((value >> 8) & 255)}, ${String(value & 255)})`
}

/** 夹具用的两个组色（色值取插件色板，见 PALETTE）。 */
const GROUP_A_COLOR = 'purple'
const GROUP_B_COLOR = 'blue'
const GROUP_A_NAME = '甲组'
const GROUP_B_NAME = '乙组'
/** 两个夹具组 id（注进假宿主 `tags` 的那份状态里用的就是这两个）。 */
const GROUP_A_ID = 'rail-a'
const GROUP_B_ID = 'rail-b'
const PILL_A = `[data-dshone-tree-tag-pill="${GROUP_A_ID}"]`
const PILL_B = `[data-dshone-tree-tag-pill="${GROUP_B_ID}"]`

interface Rect {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
}

interface RailFacts {
  blockFound: boolean
  collapsed: boolean
  block: Rect | null
  /** 块里竖线元素的个数（形态：块上一个，折叠时也在，只是 display:none）。 */
  railCount: number
  rail: Rect | null
  railDisplay: string
  railPosition: string
  railBackground: string
  /** 组色的两个既有消费方（自己的着色都取自 `--dshone-tag-color`），用来对「同色」。 */
  pillColor: string
  dotBackground: string
  /** 块上 `--dshone-tag-color` 的声明值（组件下发的那一份）。 */
  declaredColor: string
  pill: Rect | null
  /** 组内行容器（tagRows）：左缘与还画不画左边框（旧实现那条线要确认没了）。 */
  rowsContainer: { left: number; borderLeftStyle: string } | null
  rows: Array<{ id: string; box: Rect; inset: number | null }>
  /** 取不到行里第一个子元素的行数（取不到就没法量内边距，套件据此记事实）。 */
  rowsWithoutChild: number
}

const rectOf = (element: Element | null): Rect | null => {
  if (element === null) return null
  const box = element.getBoundingClientRect()
  const round = (value: number): number => Math.round(value * 10) / 10
  return {
    left: round(box.left),
    right: round(box.right),
    top: round(box.top),
    bottom: round(box.bottom),
    width: round(box.width),
    height: round(box.height),
  }
}

/** 读一个标签组块的全部几何与颜色（一次 evaluate 拿全，省往返）。 */
async function railFacts(page: OpenedPage['page'], tagId: string): Promise<RailFacts> {
  return await page.evaluate((tag: string): RailFacts => {
    const round = (value: number): number => Math.round(value * 10) / 10
    const boxOf = (element: Element | null): null | {
      left: number
      right: number
      top: number
      bottom: number
      width: number
      height: number
    } => {
      if (element === null) return null
      const box = element.getBoundingClientRect()
      return {
        left: round(box.left),
        right: round(box.right),
        top: round(box.top),
        bottom: round(box.bottom),
        width: round(box.width),
        height: round(box.height),
      }
    }
    const block = document.querySelector(`[data-dshone-tree="tag-block"][data-dshone-tree-tag="${tag}"]`)
    if (block === null) {
      return {
        blockFound: false,
        collapsed: false,
        block: null,
        railCount: 0,
        rail: null,
        railDisplay: '',
        railPosition: '',
        railBackground: '',
        pillColor: '',
        dotBackground: '',
        declaredColor: '',
        pill: null,
        rowsContainer: null,
        rows: [],
        rowsWithoutChild: 0,
      }
    }
    const rail = block.querySelector('[data-dshone-tree="tag-line"]')
    const pill = block.querySelector(`[data-dshone-tree-tag-pill="${tag}"]`)
    const dot = block.querySelector('.dshOneTree_tagDot')
    const rowsContainer = block.querySelector('.dshOneTree_tagRows')
    const rows = Array.from(block.querySelectorAll('[data-dshone-tree-row="session"]'))
    let rowsWithoutChild = 0
    const rowFacts = rows.map((row) => {
      const rowBox = row.getBoundingClientRect()
      const first = row.firstElementChild
      if (first === null) rowsWithoutChild += 1
      const firstBox = first === null ? null : first.getBoundingClientRect()
      return {
        id: row.getAttribute('data-dshone-tree-session') ?? '',
        box: boxOf(row) as NonNullable<ReturnType<typeof boxOf>>,
        // 左内边距的几何实测：行里第一个子元素的左缘 − 行盒左缘（行无边框、flex 首个子元素
        // 贴内容盒左缘）。
        inset: firstBox === null ? null : round(firstBox.left - rowBox.left),
      }
    })
    return {
      blockFound: true,
      collapsed: block.getAttribute('data-dshone-tag-collapsed') === 'true',
      block: boxOf(block),
      railCount: block.querySelectorAll('[data-dshone-tree="tag-line"]').length,
      rail: boxOf(rail),
      railDisplay: rail === null ? '' : getComputedStyle(rail).display,
      railPosition: rail === null ? '' : getComputedStyle(rail).position,
      railBackground: rail === null ? '' : getComputedStyle(rail).backgroundColor,
      pillColor: pill === null ? '' : getComputedStyle(pill).color,
      dotBackground: dot === null ? '' : getComputedStyle(dot).backgroundColor,
      declaredColor: getComputedStyle(block).getPropertyValue('--dshone-tag-color').trim(),
      pill: boxOf(pill),
      rowsContainer:
        rowsContainer === null
          ? null
          : {
              left: round(rowsContainer.getBoundingClientRect().left),
              borderLeftStyle: getComputedStyle(rowsContainer).borderLeftStyle,
            },
      rows: rowFacts,
      rowsWithoutChild,
    }
  }, tagId)
}

/** 未归组的会话行（同一区块里那条），组内行的左边界要与它一致。 */
async function ungroupedRowFacts(
  page: OpenedPage['page'],
  groupKey: string,
): Promise<{ id: string; box: Rect; inset: number | null } | null> {
  return await page.evaluate((key: string): { id: string; box: Rect; inset: number | null } | null => {
    const round = (value: number): number => Math.round(value * 10) / 10
    const section = document.querySelector(`[data-dshone-group-key="${key}"]`)
    if (section === null) return null
    for (const row of Array.from(section.querySelectorAll('[data-dshone-tree-row="session"]'))) {
      if (row.closest('[data-dshone-tree="tag-block"]') !== null) continue
      const box = row.getBoundingClientRect()
      const first = row.firstElementChild
      const firstBox = first === null ? null : first.getBoundingClientRect()
      return {
        id: row.getAttribute('data-dshone-tree-session') ?? '',
        box: {
          left: round(box.left),
          right: round(box.right),
          top: round(box.top),
          bottom: round(box.bottom),
          width: round(box.width),
          height: round(box.height),
        },
        inset: firstBox === null ? null : round(firstBox.left - box.left),
      }
    }
    return null
  }, groupKey)
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
 * 造一次「拖着 pill 悬在另一个 pill 上」：只有 dragstart + dragenter/dragover，**不 drop**
 *（要看的就是悬停时那枚落点标记）。
 *
 * 为什么用合成事件而不是 Playwright 的原生拖拽：本插件判「拖的是什么」靠
 * `dataTransfer.types` 里的自定义 MIME（`text/dsh-tag`），与 F-16 同一条理由。
 */
async function hoverPill(
  page: OpenedPage['page'],
  fromPill: string,
  toPill: string,
  mime: string,
  payload: string,
  where: 'center' | 'top' = 'center',
): Promise<void> {
  await page.evaluate(
    (args: { fromPill: string; toPill: string; mime: string; payload: string; where: string }) => {
      const from = document.querySelector(args.fromPill)
      const to = document.querySelector(args.toPill)
      if (from === null) throw new Error(`drag source missing: ${args.fromPill}`)
      if (to === null) throw new Error(`drag target missing: ${args.toPill}`)
      const dataTransfer = new DataTransfer()
      dataTransfer.setData(args.mime, args.payload)
      const rect = to.getBoundingClientRect()
      const y = args.where === 'top' ? rect.top + 1 : rect.top + rect.height / 2
      const fire = (node: Element, type: string, useY: boolean): void => {
        node.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer, clientY: useY ? y : 0 }))
      }
      fire(from, 'dragstart', false)
      fire(to, 'dragenter', true)
      fire(to, 'dragover', true)
    },
    { fromPill, toPill, mime, payload, where },
  )
  await page.waitForTimeout(250)
}

/** 在 pill 上落下（载荷另造一份：组件只在 drop 那一下读它，见悬停那支的说明）。 */
async function dropPill(
  page: OpenedPage['page'],
  fromPill: string,
  toPill: string,
  mime: string,
  payload: string,
  where: 'center' | 'top' = 'center',
): Promise<void> {
  await page.evaluate(
    (args: { fromPill: string; toPill: string; mime: string; payload: string; where: string }) => {
      const from = document.querySelector(args.fromPill)
      const to = document.querySelector(args.toPill)
      if (from === null) throw new Error(`drag source missing: ${args.fromPill}`)
      if (to === null) throw new Error(`drag target missing: ${args.toPill}`)
      const dataTransfer = new DataTransfer()
      dataTransfer.setData(args.mime, args.payload)
      const rect = to.getBoundingClientRect()
      const y = args.where === 'top' ? rect.top + 1 : rect.top + rect.height / 2
      const fire = (node: Element, type: string, useY: boolean): void => {
        node.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer, clientY: useY ? y : 0 }))
      }
      fire(to, 'dragenter', true)
      fire(to, 'dragover', true)
      fire(to, 'drop', true)
      fire(from, 'dragend', false)
    },
    { fromPill, toPill, mime, payload, where },
  )
  await page.waitForTimeout(500)
}

/** pill 上的落点标记现状（属性 + 解析后的 box-shadow + 盒子）。 */
async function pillDropMark(
  page: OpenedPage['page'],
  tagId: string,
): Promise<{ mark: string; boxShadow: string; box: Rect | null }> {
  return await page.evaluate((tag: string): { mark: string; boxShadow: string; box: Rect | null } => {
    const pill = document.querySelector(`[data-dshone-tree-tag-pill="${tag}"]`)
    if (pill === null) return { mark: '', boxShadow: '', box: null }
    const box = pill.getBoundingClientRect()
    return {
      mark: pill.getAttribute('data-dshone-tag-drop') ?? '',
      boxShadow: getComputedStyle(pill).boxShadow,
      box: {
        left: Math.round(box.left * 10) / 10,
        right: Math.round(box.right * 10) / 10,
        top: Math.round(box.top * 10) / 10,
        bottom: Math.round(box.bottom * 10) / 10,
        width: Math.round(box.width * 10) / 10,
        height: Math.round(box.height * 10) / 10,
      },
    }
  }, tagId)
}

/** 块的出现顺序（拖 pill 换组序的判据）。 */
async function blockOrder(page: OpenedPage['page']): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-dshone-tree="tag-block"]')).map(
      (block) => block.getAttribute('data-dshone-tree-tag') ?? '',
    ),
  )
}

export const TAG_GROUP_RAIL_SUITE: LabSuite = {
  id: 'F-27',
  phase: 'new-feature',
  name: '标签组的竖线与组内缩进回到旧侧栏规格（#122，TAG-GROUP-RAIL 套件）',
  expect:
    '标签组回到旧侧栏的「浅缩进 + 组色细竖线」形态（真网关**只读** + 假宿主 + 真装配页，夹具是注进假宿主状态存储的 `tags`）：① **组内会话行的左内边距实测 = 24px**——行盒左缘与普通行一致（不再叠外边距）、行里第一个子元素的左缘比行盒左缘右移 24px（几何实测，不读 DOM 属性），竖线整段落在这 24px 里（不压文字），组内行容器上不再有那条 `border-left`；② **竖线是块上一个绝对定位的细线元素**——块里恰好一个，左缘距块左缘 16px（与 pill 左缘同列）、宽 2px，起点是旧侧栏那个 19px（贴 pill 下沿那一带）、终点收在块底上方 2px，一路贯到组内最后一行；**颜色解析后就是组色**（与块上声明的 `--dshone-tag-color`、与同一组的色点及 pill 文字色三处同一份，且是实色不带透明度——不是被 55% 淡化过的那种线），两个组各自的线颜色不同；③ **折叠态无线**——点收起后组内行不渲染、竖线的解析 `display` 是 none 且盒子实测为 0，再展开时线与行一起回来；④ **pill 拖拽落点标记行为不变**——拖 pill 悬在另一个 pill 上半 / 下半时，目标 pill 上出现 `data-dshone-tag-drop="before"/"after"`，解析出的 box-shadow 是沿上/下沿的 2px 实线且**颜色是目标组的组色**、pill 盒子一分不动（box-shadow 不占布局）；落下后标记清掉、组序按落点重排（真的换位，不是本来就那个顺序），重排后两组的竖线几何与颜色照旧。全程零 pageerror。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const shot = async (page: OpenedPage['page'], name: string): Promise<string> => {
      const file = path.join(ctx.shots, `${name}.png`)
      await fsp.mkdir(ctx.shots, { recursive: true })
      await page.screenshot({ path: file })
      return file
    }

    check.ok(
      '套件读到的组色正本里有夹具要用的两个色（色板解析没瞎）',
      PALETTE.get(GROUP_A_COLOR) !== undefined && PALETTE.get(GROUP_B_COLOR) !== undefined,
      JSON.stringify([...PALETTE]),
    )

    const opened = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { width: 380, height: 900 })
    const { page } = opened
    try {
      await expandAllWorkspaces(page)
      // 夹具：同一区块里 ≥4 条带行菜单的会话——三条归进两个组（甲组一条、乙组两条），
      // 剩下那条留在组外当「普通会话行」的参照物（量左边界用）。当天数据没有 ≥4 条的
      // 区块时退到 ≥3 条（参照物缺失只记事实，不判失败）。
      const fixture = (await page.evaluate(() => {
        let fallback: null | { key: string; ids: string[] } = null
        for (const section of Array.from(document.querySelectorAll('[data-dshone-group-key]'))) {
          const rows = Array.from(section.querySelectorAll('[data-dshone-tree-row="session"]')).filter(
            (row) => row.querySelector('[data-dshone-tree-action="session-menu"]') !== null,
          )
          const key = section.getAttribute('data-dshone-group-key') ?? ''
          const ids = rows.map((row) => row.getAttribute('data-dshone-tree-session') ?? '')
          // 优先找能多留一条在组外的区块（量「组内行与普通行同一个左边界」要用它）。
          if (ids.length >= 4) return { key, ids: ids.slice(0, 4) }
          if (fallback === null && ids.length >= 3) fallback = { key, ids: ids.slice(0, 3) }
        }
        return fallback
      })) as null | { key: string; ids: string[] }
      check.fact(`夹具：${JSON.stringify(fixture)}`)
      check.ok(
        '找到一个有 ≥3 条可操作会话行的工作区块',
        fixture !== null && fixture.ids.length >= 3 && fixture.ids.every((id) => id !== ''),
      )
      if (fixture === null || fixture.ids.length < 3 || !fixture.ids.every((id) => id !== '')) return screenshots
      const [inA, inB1, inB2] = fixture.ids as [string, string, string]
      const hasReference = fixture.ids.length >= 4
      check.fact(
        `甲组 ${inA}（${GROUP_A_COLOR}）/ 乙组 ${inB1}, ${inB2}（${GROUP_B_COLOR}），同在工作区块 ${fixture.key}${hasReference ? `；另外 ${String(fixture.ids[3])} 留在组外当参照` : ''}`,
      )

      // ---- 夹具就位：把两个组与三条归属注进假宿主的状态存储，重载页面 ----
      const legacy = {
        version: 2,
        workspaces: {
          [fixture.key]: {
            tags: [
              { id: GROUP_A_ID, name: GROUP_A_NAME, color: GROUP_A_COLOR },
              { id: GROUP_B_ID, name: GROUP_B_NAME, color: GROUP_B_COLOR },
            ],
            sessionTags: { [inA]: GROUP_A_ID, [inB1]: GROUP_B_ID, [inB2]: GROUP_B_ID },
          },
        },
      }
      await page.addInitScript({
        content: `(() => { globalThis.__LAB_HOST__.stateStore['tags'] = ${JSON.stringify(legacy)} })()`,
      })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector(route('sidebar').readySelector, { timeout: 40_000 })
      await page.waitForTimeout(2_500)
      await expandAllWorkspaces(page)

      const blockIds = await blockOrder(page)
      check.fact(`页面上的标签组块：${JSON.stringify(blockIds)}`)
      if (!blockIds.includes(GROUP_A_ID) || !blockIds.includes(GROUP_B_ID)) {
        check.ok('两个夹具组块都渲染出来了', false, JSON.stringify(blockIds))
        return screenshots
      }

      // ---------------------------------------------------------------------
      // ① 组内会话行的左内边距 = 24px（几何实测），且行本身不加外边距
      // ---------------------------------------------------------------------
      const twoRows = await railFacts(page, GROUP_B_ID)
      check.fact(`乙组几何：${JSON.stringify(twoRows)}`)
      check.eq('乙组块里就是两条夹具会话', twoRows.rows.map((row) => row.id).sort(), [inB1, inB2].sort())
      if (twoRows.block === null || twoRows.rowsContainer === null) {
        check.ok('乙组的块盒与组内行容器都取得到', false, JSON.stringify(twoRows))
        return screenshots
      }
      const blockBox = twoRows.block
      const rowsContainer = twoRows.rowsContainer
      check.eq('每一行都量到了左内边距（行里有子元素）', twoRows.rowsWithoutChild, 0)
      const insets = twoRows.rows.map((row) => row.inset)
      check.ok(
        '组内会话行的左内边距实测 = 24px（首个子元素左缘 − 行盒左缘）',
        insets.length > 0 && insets.every((inset) => inset !== null && Math.abs(inset - 24) <= 0.5),
        JSON.stringify(insets),
      )
      check.ok(
        '组内行的行盒与普通行同一个左边界（不再叠外边距/额外的 padding-left）',
        twoRows.rows.every((row) => Math.abs(row.box.left - rowsContainer.left) <= 0.5) &&
          Math.abs(rowsContainer.left - blockBox.left) <= 0.5,
        JSON.stringify({ rows: twoRows.rows.map((row) => row.box.left), rowsContainer: rowsContainer.left, block: blockBox.left }),
      )
      check.eq('旧实现那条左边框没了（组内行容器不再自己画线）', rowsContainer.borderLeftStyle, 'none')
      const reference = hasReference ? await ungroupedRowFacts(page, fixture.key) : null
      if (reference === null) {
        check.fact('当天这个区块里没有组外的会话行可当参照（左边界那条按组内行容器自己实测）')
      } else {
        check.ok(
          '未归组行的行盒左缘与组内行完全一致（缩进只落在内边距上）',
          Math.abs(reference.box.left - (twoRows.rows[0]?.box.left ?? Number.NaN)) <= 0.5,
          JSON.stringify({ ungrouped: reference.box.left, tagged: twoRows.rows[0]?.box.left }),
        )
        check.ok(
          '组内行比未归组行多出的那一段就是缩进（内容起点更靠右）',
          reference.inset !== null && (twoRows.rows[0]?.inset ?? 0) > reference.inset,
          JSON.stringify({ ungrouped: reference.inset, tagged: twoRows.rows[0]?.inset }),
        )
      }

      // ---------------------------------------------------------------------
      // ② 竖线：块上一个绝对定位的细线元素，几何覆盖 pill 行到块底，颜色 = 组色实色
      // ---------------------------------------------------------------------
      const single = await railFacts(page, GROUP_A_ID)
      check.fact(`甲组几何：${JSON.stringify(single)}`)
      check.eq('每个组块里恰好一个竖线元素', [single.railCount, twoRows.railCount], [1, 1])
      check.ok(
        '竖线元素在（几何非零）',
        single.rail !== null && single.rail.width > 0 && single.rail.height > 0,
        JSON.stringify(single.rail),
      )
      if (single.rail === null || single.block === null || single.pill === null) {
        check.ok('甲组的竖线 / 块盒 / pill 都取得到', false, JSON.stringify(single))
        return screenshots
      }
      check.eq('竖线是绝对定位的（旧侧栏那支细线元素，不是容器的边框）', single.railPosition, 'absolute')
      check.ok(
        '竖线左缘距块左缘 16px、宽 2px（与 pill 左缘同列）',
        Math.abs(single.rail.left - single.block.left - 16) <= 0.5 && Math.abs(single.rail.width - 2) <= 0.5,
        JSON.stringify({ railLeft: single.rail.left, blockLeft: single.block.left, width: single.rail.width }),
      )
      check.ok(
        'pill 左缘与竖线同列（线就长在标签下面）',
        single.pill !== null && Math.abs(single.pill.left - single.rail.left) <= 0.5,
        JSON.stringify({ pillLeft: single.pill.left, railLeft: single.rail.left }),
      )
      check.ok(
        '竖线起点就是旧侧栏那个 19px（22px 组头里 pill 下沿所在的那一档）',
        Math.abs(single.rail.top - single.block.top - 19) <= 0.5,
        JSON.stringify({ railTop: single.rail.top, blockTop: single.block.top }),
      )
      // pill 是 16px 高 + 1px 描边（18px 的盒子，22px 组头里居中 → 盒子下沿在 20px），
      // 旧侧栏的 top:19px 因此落在描边那 1px 上——线从这里接出去，与标签是连着的。
      check.ok(
        '竖线上缘就在 pill 下沿那一带（差 ≤ 1px，从描边那一下接出去，不越到标签旁边）',
        Math.abs(single.rail.top - single.pill.bottom) <= 1.5,
        JSON.stringify({ railTop: single.rail.top, pillBottom: single.pill.bottom }),
      )
      check.ok(
        '竖线下缘收在组块底部上方 2px（贯穿到最后一行）',
        Math.abs(single.rail.bottom - (single.block.bottom - 2)) <= 0.5,
        JSON.stringify({ railBottom: single.rail.bottom, blockBottom: single.block.bottom }),
      )
      const lastRow = single.rows[single.rows.length - 1]
      check.ok(
        '竖线一直贯到组内最后一行（离最后一行下沿只差那条 2px 收线，没越过组块）',
        lastRow !== undefined &&
          single.rail.bottom >= lastRow.box.bottom - 2.5 &&
          single.rail.bottom <= single.block.bottom + 0.5,
        JSON.stringify({ railBottom: single.rail.bottom, lastRowBottom: lastRow?.box.bottom, blockBottom: single.block.bottom }),
      )
      check.ok(
        '竖线整段落在组内行的左内边距里（16 + 2 ≤ 24，不压文字）',
        single.rail.right <= (single.rows[0]?.inset ?? 0) + 0.5,
        JSON.stringify({ railRight: single.rail.right, contentLeft: single.rows[0]?.inset }),
      )
      // 颜色：正本是插件色板，同时与块上声明的变量、同组的色点与 pill 文字色三处对照。
      const expectedA = rgbOf(PALETTE.get(GROUP_A_COLOR) ?? '')
      check.eq('块上声明的组色就是夹具点名的那个颜色', single.declaredColor.toLowerCase(), (PALETTE.get(GROUP_A_COLOR) ?? '').toLowerCase())
      check.eq('竖线颜色解析后 = 组色', single.railBackground, expectedA)
      check.ok(
        '竖线是实色（不是被 55% 淡化过的那条线）',
        !single.railBackground.startsWith('rgba(') && single.railBackground !== 'transparent',
        single.railBackground,
      )
      check.eq('与同一组的色点同色', single.dotBackground, expectedA)
      check.eq('与标签文字色同色', single.pillColor, expectedA)
      check.ok(
        '两个组各自的竖线颜色不同（真的是各自的组色，不是写死的一种）',
        rgbOf(PALETTE.get(GROUP_B_COLOR) ?? '') !== expectedA && twoRows.railBackground !== single.railBackground,
        JSON.stringify({ a: single.railBackground, b: twoRows.railBackground }),
      )
      check.eq('乙组块上声明的也是夹具点名的组色', twoRows.declaredColor.toLowerCase(), (PALETTE.get(GROUP_B_COLOR) ?? '').toLowerCase())
      check.eq('乙组竖线同样解析成乙组组色', twoRows.railBackground, rgbOf(PALETTE.get(GROUP_B_COLOR) ?? ''))
      screenshots.push(await shot(page, 'tag-group-rail'))

      // ---------------------------------------------------------------------
      // ③ 折叠态无线（收起 → 线不显示；再展开 → 线回来）
      // ---------------------------------------------------------------------
      await page.click(`[data-dshone-tree-tag="rail-b"] [data-dshone-tree-action="tag-toggle"]`)
      await page.waitForTimeout(350)
      const collapsed = await railFacts(page, GROUP_B_ID)
      check.fact(`乙组折叠后：${JSON.stringify({ collapsed: collapsed.collapsed, railCount: collapsed.railCount, display: collapsed.railDisplay, rail: collapsed.rail })}`)
      check.eq('折叠标记写在块上', collapsed.collapsed, true)
      check.eq('折叠后组内行不渲染', collapsed.rows.length, 0)
      check.eq('折叠后竖线的解析 display 是 none', collapsed.railDisplay, 'none')
      check.ok(
        '折叠后竖线的盒子实测为 0（真的一点都不画）',
        collapsed.rail !== null && collapsed.rail.width === 0 && collapsed.rail.height === 0,
        JSON.stringify(collapsed.rail),
      )
      screenshots.push(await shot(page, 'tag-group-rail-collapsed'))
      await page.click(`[data-dshone-tree-tag="rail-b"] [data-dshone-tree-action="tag-toggle"]`)
      await page.waitForTimeout(350)
      const reExpanded = await railFacts(page, GROUP_B_ID)
      check.ok(
        '再展开：行与竖线都回来（宽度 2px、display 不是 none）',
        reExpanded.rows.length === 2 && reExpanded.railDisplay !== 'none' && reExpanded.rail?.width === 2,
        JSON.stringify({ rows: reExpanded.rows.length, display: reExpanded.railDisplay, rail: reExpanded.rail }),
      )

      // ---------------------------------------------------------------------
      // ④ pill 拖拽落点标记：上/下半的属性、颜色、不占布局；落下后组序按落点重排
      // ---------------------------------------------------------------------
      check.fact(`拖 pill 前的组块顺序：${JSON.stringify(await blockOrder(page))}`)
      // 上半：拖乙组 pill 悬到甲组 pill 的上半 → 目标是甲组（紫），标记应落在目标 pill 上沿。
      const pillABefore = await pillDropMark(page, GROUP_A_ID)
      await hoverPill(page, PILL_B, PILL_A, 'text/dsh-tag', GROUP_B_ID, 'top')
      const hoveringTop = await pillDropMark(page, GROUP_A_ID)
      check.fact(`悬在甲组 pill 上半时的落点标记：${JSON.stringify(hoveringTop)}`)
      check.eq('拖 pill 悬到另一个 pill 上半：目标 pill 上的标记为 before', hoveringTop.mark, 'before')
      check.eq(
        '落点标记是目标组组色、沿上沿的 2px 实线（box-shadow 原样）',
        hoveringTop.boxShadow,
        `${rgbOf(PALETTE.get(GROUP_A_COLOR) ?? '')} 0px -2px 0px 0px`,
      )
      check.ok(
        '落点标记不占布局（pill 盒子一分不动）',
        pillABefore.box !== null &&
          hoveringTop.box !== null &&
          JSON.stringify(pillABefore.box) === JSON.stringify(hoveringTop.box),
        JSON.stringify({ before: pillABefore.box, hovering: hoveringTop.box }),
      )
      screenshots.push(await shot(page, 'tag-group-pill-drop-before'))
      await dropPill(page, PILL_B, PILL_A, 'text/dsh-tag', GROUP_B_ID, 'top')
      const afterTopDrop = await pillDropMark(page, GROUP_A_ID)
      check.eq('落下后标记清掉', afterTopDrop.mark, '')
      check.eq('落下后 box-shadow 恢复（标记真的撤了）', afterTopDrop.boxShadow, pillABefore.boxShadow)
      check.eq(
        '按落点重排：乙组插到了甲组前面（组序真的换了，不是本来就这个顺序）',
        (await blockOrder(page)).filter((id) => id.startsWith('rail-')),
        [GROUP_B_ID, GROUP_A_ID],
      )
      // 下半：拖甲组 pill 悬到乙组 pill 的中轴（= 下半）→ 目标是乙组（蓝），标记落在下沿。
      const pillBBefore = await pillDropMark(page, GROUP_B_ID)
      await hoverPill(page, PILL_A, PILL_B, 'text/dsh-tag', GROUP_A_ID, 'center')
      const hoveringBottom = await pillDropMark(page, GROUP_B_ID)
      check.fact(`悬在乙组 pill 下半时的落点标记：${JSON.stringify(hoveringBottom)}`)
      check.eq('悬在下半：目标 pill 上的标记为 after', hoveringBottom.mark, 'after')
      check.eq(
        'after 的 box-shadow 沿下沿、颜色是目标组组色',
        hoveringBottom.boxShadow,
        `${rgbOf(PALETTE.get(GROUP_B_COLOR) ?? '')} 0px 2px 0px 0px`,
      )
      check.ok(
        '下半的标记同样不占布局（pill 盒子一分不动）',
        pillBBefore.box !== null &&
          hoveringBottom.box !== null &&
          JSON.stringify(pillBBefore.box) === JSON.stringify(hoveringBottom.box),
        JSON.stringify({ before: pillBBefore.box, hovering: hoveringBottom.box }),
      )
      screenshots.push(await shot(page, 'tag-group-pill-drop-after'))
      await dropPill(page, PILL_A, PILL_B, 'text/dsh-tag', GROUP_A_ID, 'center')
      const afterBottomDrop = await pillDropMark(page, GROUP_B_ID)
      check.eq('下半落下后标记同样清掉', afterBottomDrop.mark, '')
      check.eq(
        '插到乙组之后 = 甲组仍排在它后面（与落点一致）',
        (await blockOrder(page)).filter((id) => id.startsWith('rail-')),
        [GROUP_B_ID, GROUP_A_ID],
      )
      const afterReorder = await railFacts(page, GROUP_B_ID)
      check.ok(
        '重排之后两组的竖线几何与颜色照旧（换序没动形态）',
        afterReorder.rail !== null &&
          Math.abs(afterReorder.rail.width - 2) <= 0.5 &&
          afterReorder.railBackground === rgbOf(PALETTE.get(GROUP_B_COLOR) ?? '') &&
          Math.abs((afterReorder.rows[0]?.inset ?? 0) - 24) <= 0.5,
        JSON.stringify({ rail: afterReorder.rail, background: afterReorder.railBackground, inset: afterReorder.rows[0]?.inset }),
      )
      screenshots.push(await shot(page, 'tag-group-rail-after-reorder'))

      check.eq('标签组竖线套件全程零 pageerror', withoutKnownNoise(opened.capture.pageErrors).real, [])
    } finally {
      await opened.context.close()
    }
    return screenshots
  },
}
