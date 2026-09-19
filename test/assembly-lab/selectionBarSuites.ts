/**
 * 选择态动作条的布局与观感（#120）。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与 `driftSuites.ts` / `recycleEntrySuites.ts` 同一条：
 * 那个文件是本批开发的合入热点，新套件放外面能少一半冲突面。注册方式是在 `suites.ts` 的
 * `SUITES` 末尾追加一项。
 *
 * 期望值尽量**不硬编码**：几何里能对上档位表的（按钮高 28px = 标准档、按钮字号 12px =
 * 紧凑档）直接读 `workspaceTree/styles.ts` 的 `SCALE_TIERS` 比；上下缝隙比的是**当页解析
 * 出来的密度变量值**（`--dsh-one-density-group-gap`），这样 #119 把纵向节奏调回官方值之后
 * 本套件不需要跟着改数字（判据仍是「缝隙 = 密度档给的那一格」，不是某个固定像素）。
 *
 * 本套件**完全不碰网关的写面**：只进选择态、勾一行（勾选是纯视图态）、量几何，不点归档确认。
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

/** 三档宽度（与 F-04 / F-13 同一套：窄 / 用户侧栏 / 宽）。 */
const WIDTHS = [260, 340, 500] as const

/** 三枚动作按钮的自有标记（与 selection.ts 里给的一致）。 */
const ACTION_NAMES = ['selection-recycle', 'selection-archive', 'selection-exit'] as const

interface BarFacts {
  /** 计数文字这一行是不是**单行**：`getClientRects().length === 1`（硬判据，不看高度）。 */
  countLines: number
  countText: string
  countWhiteSpace: string
  /** 计数元素自己的宽 vs 它那段文字的实际宽（小于文字宽 = 被压缩了）。 */
  countWidth: number
  countTextWidth: number
  /** 计数有没有被裁切（内容宽 > 盒子宽）。 */
  countScrollWidth: number
  countClientWidth: number
  /** 上下相邻元素的缝隙（实测）。 */
  gapAbove: number
  gapBelow: number
  /** 当页解析出来的纵向节奏（密度变量），上、下两格各一格，缝隙要等于各自那一格。 */
  densityAboveGap: string
  densityBelowGap: string
  /** 上方邻居是不是顶栏那一行（#135 起分组过滤条并进了那一行）。 */
  aboveIsTopBar: boolean
  /** 条与它的容器：条是不是通栏（左缘在列表内容区的出血位，即 ≤ 0）。 */
  barLeft: number
  barRight: number
  barScrollWidth: number
  barClientWidth: number
  areaScrollWidth: number
  areaClientWidth: number
  /** 形态：上下发丝线 + 底色，与分组胶囊同一枚发丝线 token。 */
  borderTopWidth: string
  borderBottomWidth: string
  borderTopColor: string
  pillBorderTopColor: string
  background: string
  borderRadius: string
  /** 三枚按钮：几何 + 是否命中（`elementFromPoint` 打中心点）+ 是否可点（disabled）。 */
  buttons: ReadonlyArray<{
    name: string
    width: number
    height: number
    fontSize: string
    radius: string
    className: string
    disabled: boolean
    hit: boolean
    rightOverflow: number
    classList: string
  }>
}

/** 量一次条的全部事实（页面侧一次算完，避免多次 round-trip 之间的抖动）。 */
async function barFacts(page: OpenedPage['page']): Promise<BarFacts> {
  return page.evaluate((names: readonly string[]) => {
    const wrap = document.querySelector('[data-dshone-tree="selection-bar"]') as HTMLElement | null
    const bar = wrap?.querySelector('.dshOneTree_selectionBar') as HTMLElement | null
    const count = wrap?.querySelector('.dshOneTree_selectionCount') as HTMLElement | null
    const above = document.querySelector('[data-dshone-tree="top-bar"]') as HTMLElement | null
    const list = document.querySelector('.dshOneTree_list') as HTMLElement | null
    const area = document.querySelector('.dshOneTree_listArea') as HTMLElement | null
    const pill = document.querySelector('.dshOneTree_pill') as HTMLElement | null
    const frame = document.querySelector('.dshOneSidebarShell_frame') as HTMLElement | null
    /** 某一枚密度变量的当前取值（含单位；没人给偏好时是树插件声明的官方兜底值）。 */
    const density = (key: string): string =>
      getComputedStyle(frame ?? document.body).getPropertyValue(`--dsh-one-density-${key}`).trim()
    if (wrap === null || bar === null || count === null) throw new Error('lab: selection bar is not on the page')
    const rect = (element: HTMLElement | null): DOMRect | null => (element === null ? null : element.getBoundingClientRect())
    // 文字实际宽度：把计数内容的 Range 量一遍（比「盒子宽」更能证明没被压缩）。
    const range = document.createRange()
    range.selectNodeContents(count)
    const barRect = rect(bar) as DOMRect
    const wrapRect = rect(wrap) as DOMRect
    return {
      countLines: count.getClientRects().length,
      countText: count.textContent ?? '',
      countWhiteSpace: getComputedStyle(count).whiteSpace,
      countWidth: rect(count)?.width ?? -1,
      countTextWidth: range.getBoundingClientRect().width,
      countScrollWidth: count.scrollWidth,
      countClientWidth: count.clientWidth,
      gapAbove: wrapRect.top - (rect(above)?.bottom ?? wrapRect.top),
      gapBelow: (rect(list)?.top ?? wrapRect.bottom) - wrapRect.bottom,
      // 上下两格分别读当页那枚密度变量（#135 起上方邻居是顶栏那一行）：
      // - 上方那一格 = 那一行的下边距，`section-header-gap`（#119 起就是官方原值 4px）；
      // - 下方那一格 = 操作条自己的下边距，`group-gap`。
      // 两项目前同为 4px，但判据仍是「实测缝隙 = 当页那枚变量」，将来谁改了数字这里跟着走。
      densityAboveGap: density('section-header-gap'),
      densityBelowGap: density('group-gap'),
      aboveIsTopBar: above !== null,
      barLeft: barRect.left,
      barRight: barRect.right,
      barScrollWidth: bar.scrollWidth,
      barClientWidth: bar.clientWidth,
      areaScrollWidth: area?.scrollWidth ?? -1,
      areaClientWidth: area?.clientWidth ?? -1,
      borderTopWidth: getComputedStyle(wrap).borderTopWidth,
      borderBottomWidth: getComputedStyle(wrap).borderBottomWidth,
      borderTopColor: getComputedStyle(wrap).borderTopColor,
      pillBorderTopColor: pill === null ? '' : getComputedStyle(pill).borderTopColor,
      background: getComputedStyle(wrap).backgroundColor,
      borderRadius: getComputedStyle(wrap).borderRadius,
      buttons: names.map((name) => {
        const button = wrap.querySelector(`[data-dshone-tree-action="${name}"]`) as HTMLElement | null
        if (button === null) {
          return { name, width: -1, height: -1, fontSize: '', radius: '', className: '', disabled: true, hit: false, rightOverflow: -1, classList: '' }
        }
        const box = button.getBoundingClientRect()
        const center = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
        const style = getComputedStyle(button)
        return {
          name,
          width: box.width,
          height: box.height,
          fontSize: style.fontSize,
          radius: style.borderRadius,
          // 官方 Button 的 `sm` 变体在类名里带 `_sm_`（官方 css-module 的稳定片段）——
          // 只记事实，不拿它当判据（几何才是用户可见的后果）。
          className: button.className,
          disabled: (button as HTMLButtonElement).disabled,
          hit: center !== null && (center === button || button.contains(center)),
          rightOverflow: box.right - barRect.right,
          classList: button.className,
        }
      }),
    }
  }, [...ACTION_NAMES])
}

/** 点一次选择态入口（顶栏那一枚），等操作条出来。 */
async function enterSelection(page: OpenedPage['page']): Promise<void> {
  await page.click('[data-dshone-tree-action="select-mode"]')
  await page.waitForTimeout(300)
}

/** 勾一行**够格**的会话行（计数变成「已选 1 项」、两枚动作按钮才启用）。 */
async function selectOneRow(page: OpenedPage['page']): Promise<boolean> {
  const target = await page.evaluate(
    () =>
      document.querySelector('[data-dshone-tree-row="session"][data-dshone-tree-check="eligible"]')?.getAttribute('data-dshone-tree-session') ?? null,
  )
  if (target === null) return false
  await page.locator(`[data-dshone-tree-session="${target}"]`).click()
  await page.waitForTimeout(200)
  return true
}

export const SELECTION_BAR_SUITE: LabSuite = {
  id: 'F-29',
  phase: 'new-feature',
  name: '选择态动作条：计数不压缩 + 三档宽度下的排布 + 通栏横带形态（#120，SELECTION-BAR 套件）',
  expect:
    '侧栏在真实装配页上（真网关**只读** + 假宿主）进选择态后，动作条的四件事各有用硬判据的断言：① **计数不许被压成一字一行**——260 / 340 / 500 三档宽度下，计数那一行的 `getClientRects().length` 恒为 1（不是「看高度猜」），`white-space` 是 `nowrap`，盒子宽不小于它那段文字的实际宽（Range 量出来的），内容也没有被裁切（`scrollWidth ≤ clientWidth`）；**最长的文案「未选任何会话」单独在 260px 那一档量一遍**（那是用户实测的现场）。② **三枚动作按钮与退出入口都可见且可点**——每一枚的 `elementFromPoint`（打矩形中心）命中它自己或其后代，宽高非 0，且右缘不越出动作条；勾一行之后两枚动作按钮真的启用（`disabled=false`）。③ **上下缝隙符合密度档的纵向节奏**——条与**顶栏那一行**之间（#135 起分组过滤条并进那一行，上方邻居就是它）的实测缝隙等于当页那枚 `--dsh-one-density-section-header-gap`、条与列表首行之间等于 `--dsh-one-density-group-gap`（两项都是 #119 定的官方节奏 4px；判据是「缝隙 = 当页那枚密度变量」，所以调数字时本套件不用跟着改）。④ **三档宽度下都不出现横向溢出 / 裁切**——动作条自己的 `scrollWidth ≤ clientWidth + 1`，列表区同理，且每枚按钮的右缘都在条内。⑤ **形态是通栏横带**：上下各一条发丝线（宽度非 0，颜色与分组胶囊的描边同一枚 token）、有一层非透明底色、左缘落在列表内容区的出血位（≤ 0，即通栏），所以它与列表行分得开（用户报的第三点）。⑥ 三枚按钮的几何是**官方 Button 的 `sm` 档**（高 28px = 档位表标准档、字号 12px = 紧凑档、圆角 14px），不是自造的尺寸。全程零 pageerror，不点归档确认。',
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
      await enterSelection(page)

      // ---- ① / ③ / ④：空选态（计数文案最长的那一态）在三档宽度下逐档量 ----
      const empty: BarFacts[] = []
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 })
        await page.waitForTimeout(220)
        const facts = await barFacts(page)
        empty.push(facts)
        check.fact(
          `${width}px（未选）：计数「${facts.countText}」行数=${String(facts.countLines)} 盒宽=${facts.countWidth.toFixed(1)} 文字宽=${facts.countTextWidth.toFixed(1)}；上缝=${facts.gapAbove.toFixed(1)} 下缝=${facts.gapBelow.toFixed(1)}（上 ${facts.densityAboveGap} / 下 ${facts.densityBelowGap}）；条=${
            facts.barScrollWidth
          }/${facts.barClientWidth} 区=${String(facts.areaScrollWidth)}/${String(facts.areaClientWidth)}；按钮高=${facts.buttons.map((b) => b.height).join('/')}`,
        )
        check.eqText(`${width}px：计数文案是「未选任何会话」（用户实测的那一条）`, facts.countText, '未选任何会话')
        check.eq(`${width}px：计数是单行（getClientRects().length === 1）`, facts.countLines, 1)
        check.ok(
          `${width}px：计数不收缩（盒子宽 ≥ 文字宽）`,
          facts.countWidth + 0.5 >= facts.countTextWidth,
          `盒宽=${facts.countWidth.toFixed(1)} 文字宽=${facts.countTextWidth.toFixed(1)}`,
        )
        check.ok(
          `${width}px：计数没有被裁切（scrollWidth ≤ clientWidth）`,
          facts.countScrollWidth <= facts.countClientWidth + 1,
          `${String(facts.countScrollWidth)} > ${String(facts.countClientWidth)}`,
        )
        screenshots.push(await shot(page, `selection-bar-${String(width)}-empty`))
      }

      // ② / ④：三枚按钮可见、可点（`elementFromPoint` 命中），且不越界。
      const emptyFacts = empty[0] as BarFacts
      for (const button of emptyFacts.buttons) {
        check.ok(
          `260px：${button.name} 可见且可点（elementFromPoint 命中自己）`,
          button.width > 0 && button.height > 0 && button.hit,
          `w=${String(button.width)} h=${String(button.height)} hit=${String(button.hit)}`,
        )
      }
      for (const [index, width] of WIDTHS.entries()) {
        const facts = empty[index] as BarFacts
        check.ok(
          `${width}px：动作条没有横向溢出（scrollWidth ≤ clientWidth + 1）`,
          facts.barScrollWidth <= facts.barClientWidth + 1,
          `${String(facts.barScrollWidth)} > ${String(facts.barClientWidth)}`,
        )
        check.ok(
          `${width}px：列表区没有横向溢出（scrollWidth ≤ clientWidth + 1）`,
          facts.areaScrollWidth <= facts.areaClientWidth + 1,
          `${String(facts.areaScrollWidth)} > ${String(facts.areaClientWidth)}`,
        )
        check.ok(
          `${width}px：三枚按钮的右缘都在动作条内（不越界、不被裁切）`,
          facts.buttons.every((button) => button.rightOverflow <= 1),
          JSON.stringify(facts.buttons.map((button) => `${button.name}:${button.rightOverflow.toFixed(1)}`)),
        )
        // ③ 缝隙 = 密度档的纵向节奏（#119 口径），两处都量。
        const expectedAbove = Number.parseFloat(facts.densityAboveGap)
        const expectedBelow = Number.parseFloat(facts.densityBelowGap)
        check.ok(
          `${width}px：条与顶栏那一行的缝隙 = 密度档纵向节奏（${facts.densityAboveGap}）`,
          Math.abs(facts.gapAbove - expectedAbove) <= 1,
          `实测 ${facts.gapAbove.toFixed(1)}，期望 ${String(expectedAbove)}`,
        )
        check.ok(
          `${width}px：上方邻居确实是顶栏那一行（#135 起分组过滤条并进去了）`,
          facts.aboveIsTopBar,
          JSON.stringify({ aboveIsTopBar: facts.aboveIsTopBar }),
        )
        check.ok(
          `${width}px：条与列表首行的缝隙 = 密度档纵向节奏（${facts.densityBelowGap}）`,
          Math.abs(facts.gapBelow - expectedBelow) <= 1,
          `实测 ${facts.gapBelow.toFixed(1)}，期望 ${String(expectedBelow)}`,
        )
      }

      // ---- ⑤ 形态：通栏横带（上下发丝线 + 底色，与分组胶囊同一枚发丝线 token）----
      const shape = empty[1] as BarFacts
      check.ok(
        '形态：上下各有一条发丝线（宽度非 0）',
        Number.parseFloat(shape.borderTopWidth) > 0 && Number.parseFloat(shape.borderBottomWidth) > 0,
        `top=${shape.borderTopWidth} bottom=${shape.borderBottomWidth}`,
      )
      check.eq('形态：发丝线与分组胶囊同一枚 token（描边颜色一致）', shape.borderTopColor, shape.pillBorderTopColor)
      check.ok('形态：有一层非透明底色（与列表行分得开）', shape.background !== 'rgba(0, 0, 0, 0)' && shape.background !== 'transparent', shape.background)
      check.ok(
        '形态：是通栏横带（左缘落在列表内容区的出血位，≤ 0）',
        shape.barLeft <= 0,
        `barLeft=${shape.barLeft.toFixed(1)}`,
      )
      check.ok('形态：不是圆角盒子（通栏横带不带圆角）', shape.borderRadius === '0px', shape.borderRadius)

      // ---- ⑥ 按钮几何 = 官方 Button 的 sm 档（28px / 12px / 14px 圆角）----
      for (const button of emptyFacts.buttons) {
        check.eq(`${button.name}：高 = 标准档 28px（官方 Button sm 档的高）`, `${button.height}px`, SCALE_TIERS.standard.iconButtonSize)
        check.eq(`${button.name}：字号 = 紧凑档 12px`, button.fontSize, SCALE_TIERS.compact.fontSize)
        check.eq(`${button.name}：圆角 = 官方 Button sm 档的 14px`, button.radius, '14px')
      }
      check.fact(
        `按钮的官方类名（sm 变体）：${emptyFacts.buttons
          .map((button) => `${button.name}=${button.classList.split(' ').filter((name) => name.includes('_sm_')).join('')}`)
          .join('；')}`,
      )

      // ---- ② 后半：勾一行之后计数文案变短、两枚动作按钮启用、按钮仍可点 ----
      const selected = await selectOneRow(page)
      check.ok('页面上找到一行「够格勾选」的会话行（勾选之后动作按钮才启用）', selected)
      if (selected) {
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 900 })
          await page.waitForTimeout(220)
          const facts = await barFacts(page)
          check.fact(
            `${width}px（已选 1 项）：计数「${facts.countText}」行数=${String(facts.countLines)} 盒宽=${facts.countWidth.toFixed(1)} 文字宽=${facts.countTextWidth.toFixed(1)}；按钮禁用=${facts.buttons.map((button) => String(button.disabled)).join('/')}`,
          )
          check.eq(`${width}px：计数是单行（已选 1 项）`, facts.countLines, 1)
          check.ok(
            `${width}px：计数不收缩（已选 1 项）`,
            facts.countWidth + 0.5 >= facts.countTextWidth,
            `盒宽=${facts.countWidth.toFixed(1)} 文字宽=${facts.countTextWidth.toFixed(1)}`,
          )
          check.ok(
            `${width}px：三枚按钮仍可见且可点（已选 1 项）`,
            facts.buttons.every((button) => button.width > 0 && button.height > 0 && button.hit),
            JSON.stringify(facts.buttons.map((button) => `${button.name}:hit=${String(button.hit)}`)),
          )
          check.eq(
            `${width}px：两枚动作按钮已启用（勾了一行）、退出入口也启用`,
            facts.buttons.map((button) => button.disabled),
            [false, false, false],
          )
          check.ok(
            `${width}px：仍无横向溢出（已选 1 项）`,
            facts.barScrollWidth <= facts.barClientWidth + 1 && facts.areaScrollWidth <= facts.areaClientWidth + 1,
            `条=${String(facts.barScrollWidth)}/${String(facts.barClientWidth)} 区=${String(facts.areaScrollWidth)}/${String(facts.areaClientWidth)}`,
          )
          screenshots.push(await shot(page, `selection-bar-${String(width)}-selected`))
        }
      }

      check.eq('动作条套件全程零 pageerror', withoutKnownNoise(opened.capture.pageErrors).real, [])
    } finally {
      await opened.context.close()
    }
    return screenshots
  },
}
