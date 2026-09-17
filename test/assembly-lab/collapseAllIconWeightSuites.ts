/**
 * 顶栏「折叠 / 展开全部」那枚图标的**视觉重量**（#141）：把它放大的幅度与同一排官方
 * 图标的实际绘制范围对齐。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与 `collapseAllIconSuites.ts` / `recycleEntrySuites.ts`
 * 等同一条：那个文件是本批开发的合入热点，新套件放外面能少一半冲突面。注册方式是在
 * `suites.ts` 的 `SUITES` 末尾追加一项。
 *
 * 判据是**关系量**，不是某几个像素：本枚绘制范围的最小边与同排官方图标最小边的**中位数**
 * 之差 ≤ 1px。为什么取中位数，而不是 #141 里给的另一条路（「不小于最扁那一枚的 90%」）：
 * 同一排最扁的是「添加工作区」（15.17×12.46 的宽扁图标），拿它的短边 12.46 当基准，本枚
 * 只要放到 11.21（放大 1.02 倍）就算过——那个幅度根本改不掉用户看到的「小一圈」。中位数
 * （13.77）代表的是这一排的常见大小，也正是用户眼里「旁边那几枚」的大小。
 *
 * 量的是**画出来的东西的范围**（每条 path 的屏幕矩形取并集），不是 svg 的 width/height
 * ——那四枚官方的 `width` 都是 16，看不出差；官方「搜索」还把内容画满自己的 16 格画布、
 * 却只渲染成 14×14，只有量屏幕上的实际范围才和眼睛看到的一致。
 *
 * 期望值取自插件自己的 `collapseAllGlyph.ts`（零 import 的纯数据文件，能在 node 进程里
 * import）。全程只读真网关：只点这一枚按钮（它只改本地视图态），不写任何东西。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { openTreePage, withoutKnownNoise, type OpenedPage } from './harness.ts'
import { LAB_TREES, type LabTreeRoute } from './labServer.ts'
import {
  COLLAPSE_ALL_GLYPH_TRANSFORM,
  COLLAPSE_ALL_GLYPHS,
} from '../../src/ui/assembly/shell/workspaceTree/collapseAllGlyph.ts'
// 只取类型（编译后不留 import，运行期没有环）：套件接口定义在 suites.ts 里，它就是调用方。
import type { LabSuite } from './suites.ts'

const route = (name: string): LabTreeRoute => {
  const found = LAB_TREES.find((candidate) => candidate.route === name)
  if (found === undefined) throw new Error(`lab: unknown tree route ${name}`)
  return found
}

/** 那一枚按钮（点它切换两态时要用）。 */
const BUTTON = '[data-dshone-tree-action="collapse-all"]'

/** 同一排五枚：本枚 + 四枚官方（搜索 / 添加工作区 / 设置齿轮 / 多选）。 */
const OFFICIAL_KEYS = ['search', 'add-workspace', 'settings', 'select-mode'] as const

/**
 * 五枚的读取口径。搜索那一枚在顶栏左半边的搜索区里、其余三枚在右半边的动作区里，但
 * 它们是同一条 26px 高的行（用户说的「同一排」就是这一行），所以一起量。选择器的口径与
 * `collapseAllIconSuites.ts` 一致：动作区的图标是 `[data-*action]` 的直接子 svg。
 */
const TARGETS = [
  { key: 'collapse-all', selector: '[data-dshone-tree-icon="collapse-all"]' },
  { key: 'search', selector: '[data-dshone-tree-action="search"] > svg' },
  { key: 'add-workspace', selector: '[data-dshone-tree-action="add-workspace"] > svg' },
  { key: 'settings', selector: '[data-dshone-tree-action="settings"] > svg' },
  { key: 'select-mode', selector: '[data-dshone-tree-action="select-mode"] > svg' },
] as const

interface Drawn {
  key: string
  found: boolean
  /** 图标盒（svg 自己）在屏幕上的矩形，左上角与边长。 */
  box: { x: number; y: number; w: number; h: number }
  /** 画出来的东西的实际范围：每条 path 屏幕矩形的并集。 */
  drawn: { x: number; y: number; w: number; h: number }
  /** 短边（「最小边」）：正方形图标就是边长，宽扁图标就是高度。 */
  minEdge: number
  /** 绘制范围的中心相对图标盒中心的偏差。 */
  offset: { dx: number; dy: number }
  /** 绘制范围的四周离图标盒边界的余量（负数 = 溢出图标盒，会被 svg 裁掉）。 */
  margin: { left: number; right: number; top: number; bottom: number }
  viewBox: string
  /** 每条 path 的 d 与 transform（按绘制顺序）。 */
  ds: string[]
  transforms: string[]
}

/** 读一次同一排五枚的绘制范围（一次 evaluate 拿全，省往返）。 */
async function measureRow(page: OpenedPage['page']): Promise<Drawn[]> {
  return page.evaluate((targets) => {
    const round = (value: number): number => Math.round(value * 100) / 100
    return targets.map((target) => {
      const empty: Drawn = {
        key: target.key,
        found: false,
        box: { x: 0, y: 0, w: 0, h: 0 },
        drawn: { x: 0, y: 0, w: 0, h: 0 },
        minEdge: 0,
        offset: { dx: 0, dy: 0 },
        margin: { left: 0, right: 0, top: 0, bottom: 0 },
        viewBox: '',
        ds: [],
        transforms: [],
      }
      const svg = document.querySelector(target.selector)
      if (svg === null) return empty
      const box = svg.getBoundingClientRect()
      const paths = Array.from(svg.querySelectorAll('path'))
      // 求并集：空集合时用 svg 自己的矩形兜底（不该发生，但别让 0 参与比较）。
      let left = Number.POSITIVE_INFINITY
      let top = Number.POSITIVE_INFINITY
      let right = Number.NEGATIVE_INFINITY
      let bottom = Number.NEGATIVE_INFINITY
      for (const element of paths) {
        const rect = element.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) continue
        left = Math.min(left, rect.left)
        top = Math.min(top, rect.top)
        right = Math.max(right, rect.right)
        bottom = Math.max(bottom, rect.bottom)
      }
      const hasPainted = Number.isFinite(left) && Number.isFinite(top)
      const drawn = hasPainted
        ? { x: left, y: top, w: right - left, h: bottom - top }
        : { x: box.left, y: box.top, w: box.width, h: box.height }
      return {
        key: target.key,
        found: true,
        box: { x: round(box.left), y: round(box.top), w: round(box.width), h: round(box.height) },
        drawn: { x: round(drawn.x), y: round(drawn.y), w: round(drawn.w), h: round(drawn.h) },
        minEdge: round(Math.min(drawn.w, drawn.h)),
        offset: {
          dx: round(drawn.x + drawn.w / 2 - (box.left + box.width / 2)),
          dy: round(drawn.y + drawn.h / 2 - (box.top + box.height / 2)),
        },
        margin: {
          left: round(drawn.x - box.left),
          right: round(box.right - (drawn.x + drawn.w)),
          top: round(drawn.y - box.top),
          bottom: round(box.bottom - (drawn.y + drawn.h)),
        },
        viewBox: svg.getAttribute('viewBox') ?? '',
        ds: paths.map((element) => element.getAttribute('d') ?? ''),
        transforms: paths.map((element) => element.getAttribute('transform') ?? ''),
      }
    })
  }, TARGETS.map((target) => ({ key: target.key, selector: target.selector })))
}

/** 中位数（偶数个取中间两个的平均）。 */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length / 2
  if (sorted.length % 2 === 1) return sorted[Math.floor(middle)] ?? 0
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

const reading = (entry: Drawn): string =>
  `${entry.key} ${String(entry.drawn.w)}×${String(entry.drawn.h)}（最小边 ${String(entry.minEdge)}）`

export const COLLAPSE_ALL_ICON_WEIGHT_SUITE: LabSuite = {
  id: 'F-40',
  phase: 'new-feature',
  name: '顶栏「折叠 / 展开全部」图标的视觉重量与同一排官方图标可比（#141，COLLAPSE-ALL-ICON-WEIGHT 套件）',
  expect:
    '顶栏那一排五枚图标的**实际绘制范围**（真网关**只读** + 假宿主 + 真装配页）：① **先量**——同一排五枚（本枚 + 官方的搜索 / 添加工作区 / 设置齿轮 / 多选）各自的绘制范围都读出来（每条 path 的屏幕矩形取并集，不是看 svg 的 width/height），五枚都在场，读数写进报告。② **判据是关系量**：本枚绘制范围的最小边与同排四枚官方图标最小边的**中位数**之差 ≤ 1px（取中位数的理由写在文件头：另一条「不小于最扁那一枚的 90%」太松，最扁的添加工作区短边只有 12.46，1.02 倍就算过）。③ **放大走的机制是「只动画出来的大小」**：两条 path 的 `d` 逐字等于插件数据 `COLLAPSE_ALL_GLYPHS[minus]`（路径数据一个字节没动），两条 path 都挂着插件里那条 `COLLAPSE_ALL_GLYPH_TRANSFORM` 原文；渲染尺寸没变——图标盒仍是 16×16、绘制范围整个落在图标盒里（放大没有溢出被裁）、绘制范围的中心与图标盒中心之差 ≤ 1px（以图标中心为原点的等比缩放，没有偏移）。④ **两态一样重**：点一下这一枚切到另一态，方框那条没变、绘制范围与前一态相同（±0.5px），另一态的 `d` 同样等于插件数据。⑤ 截图：整页 + 顶栏那一行的裁切图（改前/改后对照用）。全程零 pageerror，只点这一枚按钮，不写网关。',
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
      const first = await measureRow(page)
      const ours = first.find((entry) => entry.key === 'collapse-all')
      const officialKeys = new Set<string>(OFFICIAL_KEYS)
      const officials = first.filter((entry) => officialKeys.has(entry.key) && entry.found)
      check.fact(`绘制范围（宽×高，CSS px）：${first.filter((entry) => entry.found).map(reading).join('；')}`)
      check.ok(
        '同一排五枚图标都在场上（对比不是空比）',
        ours?.found === true && officials.length === OFFICIAL_KEYS.length,
        JSON.stringify({
          ours: ours?.found ?? false,
          officials: officials.map((entry) => entry.key),
        }),
      )
      // 上面已如实记一条失败；少东西就没得比，不再往下编数。
      if (ours?.found !== true || officials.length === 0) return screenshots

      const officialMedian = median(officials.map((entry) => entry.minEdge))
      check.fact(
        `同排官方图标最小边：${officials.map((entry) => `${entry.key} ${String(entry.minEdge)}`).join(' / ')}；中位数 ${String(officialMedian)}px`,
      )
      check.ok(
        '本枚绘制范围的最小边与同排官方图标最小边的中位数差 ≤ 1px',
        Math.abs(ours.minEdge - officialMedian) <= 1,
        `本枚 ${String(ours.minEdge)}px，中位数 ${String(officialMedian)}px，差 ${String(Math.round(Math.abs(ours.minEdge - officialMedian) * 100) / 100)}px`,
      )

      // 放大只该动画出来的大小：图标盒、居中、以及「有没有溢出被裁」三条一起核。
      check.ok(
        '绘制范围整个落在图标盒里（放大没有溢出被裁）',
        Object.values(ours.margin).every((value) => value >= -0.5),
        JSON.stringify({ box: ours.box, drawn: ours.drawn, margin: ours.margin }),
      )
      check.ok(
        '绘制范围的中心与图标盒中心之差 ≤ 1px（以图标中心为原点放大，没有偏移）',
        Math.abs(ours.offset.dx) <= 1 && Math.abs(ours.offset.dy) <= 1,
        JSON.stringify(ours.offset),
      )
      check.ok(
        '两条 path 的 d 逐字等于插件数据（放大没动路径数据）',
        JSON.stringify(ours.ds) === JSON.stringify([...COLLAPSE_ALL_GLYPHS.minus]),
        JSON.stringify(ours.ds),
      )
      check.ok(
        '两条 path 都挂着插件里那条 transform 原文',
        ours.transforms.length === 2 && ours.transforms.every((value) => value === COLLAPSE_ALL_GLYPH_TRANSFORM),
        JSON.stringify({ transforms: ours.transforms, expected: COLLAPSE_ALL_GLYPH_TRANSFORM }),
      )
      screenshots.push(await shot(page, 'collapse-all-weight-minus'))
      const rowShot = path.join(ctx.shots, 'collapse-all-weight-topbar-row-minus.png')
      await fsp.mkdir(ctx.shots, { recursive: true })
      await page.locator('[data-dshone-tree="top-bar"]').screenshot({ path: rowShot })
      screenshots.push(rowShot)

      // 另一态（方框十字）：重量该与方框横杠那态一样——变的只有中间那一笔。
      await page.click(BUTTON)
      await page.waitForTimeout(300)
      const second = await measureRow(page)
      const otherState = second.find((entry) => entry.key === 'collapse-all')
      check.ok('点一下切到另一态后本枚仍在场上', otherState?.found === true, JSON.stringify({ found: otherState?.found ?? false }))
      if (otherState?.found === true) {
        check.fact(`切态后本枚绘制范围：${reading(otherState)}`)
        check.ok(
          '两态的绘制范围一样（放大的只是那个方框，方框两态共用）',
          Math.abs(otherState.minEdge - ours.minEdge) <= 0.5,
          `minus ${String(ours.minEdge)}px / plus ${String(otherState.minEdge)}px`,
        )
        check.ok(
          '另一态的 path@d 也逐字等于插件数据',
          JSON.stringify(otherState.ds) === JSON.stringify([...COLLAPSE_ALL_GLYPHS.plus]),
          JSON.stringify(otherState.ds),
        )
      }
      const rowShotPlus = path.join(ctx.shots, 'collapse-all-weight-topbar-row-plus.png')
      await page.locator('[data-dshone-tree="top-bar"]').screenshot({ path: rowShotPlus })
      screenshots.push(rowShotPlus)

      check.eq('本套件全程零 pageerror', withoutKnownNoise(opened.capture.pageErrors).real, [])
    } finally {
      await opened.context.close()
    }
    return screenshots
  },
}
