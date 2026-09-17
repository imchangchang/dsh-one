/**
 * 行家族的尺寸档（#134）：工作区行 / 会话行 / 抽屉会话行取**官方标准档**。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与 `driftSuites.ts` / `selectionBarSuites.ts` 同一条：
 * 那个文件是本批开发的合入热点，新套件放外面能少一半冲突面；注册方式是在 `suites.ts` 的
 * `SUITES` 末尾追加一项。
 *
 * 期望值一律从 `workspaceTree/styles.ts` 的档位表读（`SCALE_TIERS.standard`），不硬编码——
 * 官方原值哪天跟着官方版本变，本套件跟着走；唯一的字面量是「垂直居中的容差 1px」这种判据参数。
 *
 * 判据对应 #134 的验收四条（第 ④ 条「与官方侧栏的几何对照」在 F-04，本套件不重复）：
 * ① 三档宽度（260/340/500）下工作区行 34px / 会话行 32px、行圆角 8px、行内边距 8px、标题 14px/20px；
 * ② 菜单项仍是紧凑档的 26px / 12px（#134 只放开了行家族，菜单没被顺手放开）；
 * ③ 行内图标位与状态槽在这些行盒里垂直居中、没有被行裁掉；
 * ④ 搜索结果行也是行家族一员，能出结果就按标准档量（出不来记一笔跳过）。
 *
 * 本套件**完全不碰网关的写面**：只开菜单、敲一次只读的搜索、悬停行，不提交任何写请求。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { openTreePage, withoutKnownNoise, type Check, type OpenedPage } from './harness.ts'
import { LAB_TREES, type LabTreeRoute } from './labServer.ts'
import { SCALE_TIERS } from '../../src/ui/assembly/shell/workspaceTree/styles.ts'
// 只取类型（编译后不留 import，运行期没有环）：套件接口定义在 suites.ts 里。
import type { LabSuite } from './suites.ts'

const route = (name: string): LabTreeRoute => {
  const found = LAB_TREES.find((candidate) => candidate.route === name)
  if (found === undefined) throw new Error(`lab: unknown tree route ${name}`)
  return found
}

/** 三档宽度（与 F-04 / F-13 / F-29 同一套：窄 / 用户侧栏 / 宽）。 */
const WIDTHS = [260, 340, 500] as const

/** 要量的行：自有标记 → 它该等于标准档里的哪一项行高量。 */
const ROW_PROBES: ReadonlyArray<{
  label: string
  selector: string
  rowMetric: 'projectRowHeight' | 'sessionRowHeight'
}> = [
  { label: '工作区行', selector: '.dshOneTree_projectRow', rowMetric: 'projectRowHeight' },
  { label: '会话行', selector: '.dshOneTree_sessionRow', rowMetric: 'sessionRowHeight' },
]

/** 行里一个**常规流**子件的读数（绝对定位层不算，单列一笔事实）。 */
interface ChildFacts {
  className: string
  /** 子件垂直中心 − 行垂直中心（px，正数 = 偏下）。 */
  centerOffset: number
  /** 子件矩形整个落在行矩形里。 */
  inside: boolean
  width: number
  height: number
}

interface RowFacts {
  label: string
  present: boolean
  /** 写下来的高度（`getComputedStyle`）。 */
  height: string
  borderRadius: string
  paddingLeft: string
  paddingRight: string
  /** 实测矩形高（应与写下来的高度一致 = 没被内容撑破）。 */
  boxHeight: number
  /** 内容超出行的盒子（`scrollHeight > clientHeight + 1`）= 有东西被裁。 */
  contentOverflow: boolean
  children: readonly ChildFacts[]
  /** 绝对定位层（行尾胶囊层那一类）：不参与居中判据，只记事实。 */
  absoluteLayers: readonly string[]
}

/** 读一组行的几何 + 每个常规流子件的居中/包含关系（页面侧一次算完）。 */
async function readRows(
  page: OpenedPage['page'],
  probes: ReadonlyArray<{ label: string; selector: string }>,
): Promise<RowFacts[]> {
  return page.evaluate((list) => {
    const round = (value: number): number => Math.round(value * 100) / 100
    const names = (element: Element): string =>
      (element.getAttribute('class') ?? '')
        .split(/\s+/)
        .filter((name) => name.startsWith('dshOneTree_'))
        .join('.')
    return list.map((probe) => {
      const element = document.querySelector(probe.selector)
      if (element === null) {
        return {
          label: probe.label,
          present: false,
          height: '',
          borderRadius: '',
          paddingLeft: '',
          paddingRight: '',
          boxHeight: 0,
          contentOverflow: false,
          children: [],
          absoluteLayers: [],
        }
      }
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      const center = rect.top + rect.height / 2
      const children: ChildFacts[] = []
      const absoluteLayers: string[] = []
      for (const child of Array.from(element.children)) {
        const childStyle = getComputedStyle(child)
        if (childStyle.display === 'none' || childStyle.visibility === 'hidden') continue
        const childRect = child.getBoundingClientRect()
        if (childRect.width < 0.5 || childRect.height < 0.5) continue
        if (childStyle.position === 'absolute' || childStyle.position === 'fixed') {
          absoluteLayers.push(names(child))
          continue
        }
        children.push({
          className: names(child),
          centerOffset: round(childRect.top + childRect.height / 2 - center),
          inside: childRect.top >= rect.top - 0.5 && childRect.bottom <= rect.bottom + 0.5,
          width: round(childRect.width),
          height: round(childRect.height),
        })
      }
      return {
        label: probe.label,
        present: true,
        height: style.height,
        borderRadius: style.borderRadius,
        paddingLeft: style.paddingLeft,
        paddingRight: style.paddingRight,
        boxHeight: round(rect.height),
        contentOverflow: element.scrollHeight > element.clientHeight + 1,
        children,
        absoluteLayers,
      }
    })
  }, probes)
}

/** 一条行读数的完整判据：高度 / 圆角 / 左右内边距 = 标准档，且子件都居中、都没被裁。 */
function expectRowTier(check: Check, scope: string, row: RowFacts, expectedHeight: string): void {
  if (!row.present) {
    check.ok(`${scope}：行在（量得到才谈得上尺寸）`, false, '这一轮页面上没有这一行')
    return
  }
  check.eq(`${scope}：行高 = 标准档 ${expectedHeight}`, row.height, expectedHeight)
  check.eq(`${scope}：行圆角 = 标准档 ${SCALE_TIERS.standard.rowRadius}`, row.borderRadius, SCALE_TIERS.standard.rowRadius)
  check.eq(`${scope}：左内边距 = 标准档 ${SCALE_TIERS.standard.rowPaddingInline}`, row.paddingLeft, SCALE_TIERS.standard.rowPaddingInline)
  check.eq(`${scope}：右内边距 = 标准档 ${SCALE_TIERS.standard.rowPaddingInline}`, row.paddingRight, SCALE_TIERS.standard.rowPaddingInline)
  check.ok(
    `${scope}：实测矩形高也等于标准档 ${expectedHeight}（没被内容撑高）`,
    row.boxHeight === Number.parseFloat(expectedHeight),
    `boxHeight=${String(row.boxHeight)}`,
  )
  check.ok(
    `${scope}：行里没有超出盒子的内容（scrollHeight ≤ clientHeight + 1 = 没有被裁）`,
    !row.contentOverflow,
    `contentOverflow=${String(row.contentOverflow)}`,
  )
  check.ok(
    `${scope}：行里的常规流子件都垂直居中（|中心偏差| ≤ 1px）`,
    row.children.length > 0 && row.children.every((child) => Math.abs(child.centerOffset) <= 1),
    JSON.stringify(row.children.map((child) => `${child.className} offset=${String(child.centerOffset)}`)),
  )
  check.ok(
    `${scope}：行里的常规流子件都整个落在行矩形里（无溢出 / 无裁切）`,
    row.children.length > 0 && row.children.every((child) => child.inside),
    JSON.stringify(row.children.map((child) => `${child.className} inside=${String(child.inside)} ${String(child.width)}×${String(child.height)}`)),
  )
  check.fact(
    `${scope}：行盒高 ${String(row.boxHeight)}；子件 ${row.children
      .map((child) => `${child.className} ${String(child.width)}×${String(child.height)} offset=${String(child.centerOffset)}`)
      .join('、')}${row.absoluteLayers.length > 0 ? `；绝对定位层 ${row.absoluteLayers.join('、')}（不参与居中判据）` : ''}`,
  )
  // ③ 点名的那一枚：行内**图标位 / 状态槽**（16×20 的那一格）真的在，且居中——它是
  // 「行变高之后图标位还居不居中」最直接的观测点。
  const slot = row.children.find((child) => child.className.includes('dshOneTree_slot'))
  check.ok(
    `${scope}：行内图标位 / 状态槽在（16×20 那一格）`,
    slot !== undefined,
    JSON.stringify(row.children.map((child) => child.className)),
  )
  if (slot !== undefined) {
    check.eq(
      `${scope}：图标位尺寸 = 标准档 ${SCALE_TIERS.standard.slotWidth}×${SCALE_TIERS.standard.slotHeight}`,
      [slot.width, slot.height],
      [Number.parseFloat(SCALE_TIERS.standard.slotWidth), Number.parseFloat(SCALE_TIERS.standard.slotHeight)],
    )
    check.ok(
      `${scope}：图标位在行盒里垂直居中（|中心偏差| ≤ 1px）且没被裁`,
      Math.abs(slot.centerOffset) <= 1 && slot.inside,
      `offset=${String(slot.centerOffset)} inside=${String(slot.inside)}`,
    )
  }
}

/** 读当前最后一份菜单里官方菜单项的几何（只取本套件要的几项，读法与 F-23 同源）。 */
async function readMenuItems(page: OpenedPage['page']): Promise<Record<string, string>[]> {
  return page.evaluate(() => {
    const list = Array.from(document.querySelectorAll('[role="menu"]')).pop() ?? null
    if (list === null) return []
    const px = (value: number): string => `${String(Math.round(value * 100) / 100)}px`
    return Array.from(list.querySelectorAll('button[role="menuitem"]')).map((item) => {
      const style = getComputedStyle(item)
      return {
        height: px(item.getBoundingClientRect().height),
        minHeight: style.minHeight,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        borderRadius: style.borderRadius,
        gap: style.columnGap,
        padding: `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`,
      }
    })
  })
}

/**
 * 悬停后读一颗行里的**动作图标**（`.dshOneTree_rowIconButton`）：它在 `.dshOneTree_rowActions`
 * 容器里（不是行的直接子元素），所以按后代查；同时报出「这一行到底有没有处于 hover 态」
 * 与动作容器的 display，免得「没量到」被当成「不居中」。
 */
async function readHoverIcons(
  page: OpenedPage['page'],
  selector: string,
): Promise<{
  hoveredCount: number
  found: boolean
  actionsDisplay: string
  buttons: readonly { centerOffset: number; inside: boolean; width: number; height: number }[]
  hiddenButtons: number
}> {
  return page.evaluate((rowSelector: string) => {
    const round = (value: number): number => Math.round(value * 100) / 100
    const rows = Array.from(document.querySelectorAll(rowSelector))
    const row = rows.find((candidate) => candidate.querySelector('.dshOneTree_rowIconButton') !== null) ?? rows[0] ?? null
    if (row === null) return { hoveredCount: 0, found: false, actionsDisplay: '', buttons: [], hiddenButtons: 0 }
    const rowRect = row.getBoundingClientRect()
    const center = rowRect.top + rowRect.height / 2
    const actions = row.querySelector('.dshOneTree_rowActions')
    let hiddenButtons = 0
    const buttons: { centerOffset: number; inside: boolean; width: number; height: number }[] = []
    for (const button of Array.from(row.querySelectorAll('.dshOneTree_rowIconButton'))) {
      const rect = button.getBoundingClientRect()
      // 零尺寸 = 没显示（官方 Menu 关闭时锚点落在隐藏容器里 / 空白行没有 ⋯ 按钮），
      // 不进读数——它是「这一格此刻不在」，不是「不居中」。
      if (rect.width < 0.5 || rect.height < 0.5) {
        hiddenButtons += 1
        continue
      }
      buttons.push({
        centerOffset: round(rect.top + rect.height / 2 - center),
        inside: rect.top >= rowRect.top - 0.5 && rect.bottom <= rowRect.bottom + 0.5,
        width: round(rect.width),
        height: round(rect.height),
      })
    }
    return {
      hoveredCount: document.querySelectorAll(`${rowSelector}:hover`).length,
      found: true,
      actionsDisplay: actions === null ? '（没有动作容器）' : getComputedStyle(actions).display,
      buttons,
      hiddenButtons,
    }
  }, selector)
}

/** 搜索结果行的读数（这一行是两行内容块，高度由内容撑出，所以量的是它写下来的那几项）。 */
interface SearchRowFacts {
  present: boolean
  minHeight: string
  borderRadius: string
  paddingLeft: string
  paddingRight: string
  titleFontSize: string
  titleLineHeight: string
  snippetLineHeight: string
}

async function readSearchRow(page: OpenedPage['page']): Promise<SearchRowFacts> {
  return page.evaluate(() => {
    const row = document.querySelector('.dshOneTree_searchRow')
    if (row === null) {
      return {
        present: false,
        minHeight: '',
        borderRadius: '',
        paddingLeft: '',
        paddingRight: '',
        titleFontSize: '',
        titleLineHeight: '',
        snippetLineHeight: '',
      }
    }
    const style = getComputedStyle(row)
    const title = row.querySelector('.dshOneTree_searchRowTitle')
    const snippet = row.querySelector('.dshOneTree_searchRowSnippet')
    return {
      present: true,
      minHeight: style.minHeight,
      borderRadius: style.borderRadius,
      paddingLeft: style.paddingLeft,
      paddingRight: style.paddingRight,
      titleFontSize: title === null ? '' : getComputedStyle(title).fontSize,
      titleLineHeight: title === null ? '' : getComputedStyle(title).lineHeight,
      snippetLineHeight: snippet === null ? '' : getComputedStyle(snippet).lineHeight,
    }
  })
}

/**
 * F-35 ROW-TIER：行家族取官方标准档（#134）。编号说明：F-01…F-32 与 R-06 已占用，F-33 / F-34
 * 已被在途的另外两个套件（#125 的顶栏左缘 / #127 的弹窗紧凑档）取用，按「从未占用的继续」顺延。
 */
export const ROW_TIER_SUITE: LabSuite = {
  id: 'F-35',
  phase: 'new-feature',
  name: '行家族取官方标准档（#134）：工作区行 34px / 会话行 32px / 行圆角 8px / 行内边距 8px / 标题 14px·20px，图标位与状态槽在行盒里居中，菜单项仍是紧凑档（ROW-TIER 套件）',
  expect:
    '侧栏树在真实装配页上（真网关**只读** + 假宿主）：① **三档宽度（260/340/500）下逐项量行家族**——工作区行高 = 标准档 `projectRowHeight` 34px、会话行高 = `sessionRowHeight` 32px、两个行种的圆角 = `rowRadius` 8px、左右内边距 = `rowPaddingInline` 8px（期望值全部从 `workspaceTree/styles.ts` 的档位表读，不硬编码），且行的**实测矩形高**与写下来的高度一致（没被内容撑高）；工作区名与会话标题的字号 / 行高 = 标准档的 `titleFontSize` 14px / `titleLineHeight` 20px。② **菜单项仍是紧凑档**——顶栏「视图选项」或分组胶囊的菜单开一遍，官方 `Menu` 项的渲染高 26px / 最小高 26px / 字号 12px / 行高 18px / 圆角 5px / 间隙 6px / 内边距 3px 7px 逐项等于 `SCALE_TIERS.compact`（#134 只把行家族放到了标准档，菜单没被顺手放开）。③ **行内件不被行高带坏**——每一行里的**常规流**子件（图标位 / 状态槽 / 标题 / 时间 / 勾选框…）垂直中心与行中心之差 ≤ 1px、矩形整个落在行矩形里、行自身 `scrollHeight ≤ clientHeight + 1`（无裁切）；**行内图标位（16×20 那一格）单独点名**——它必须在、尺寸等于标准档的 `slotWidth`×`slotHeight`、且在行盒里居中（悬停出一排 16×16 动作图标时再量一遍，确认它们同样居中）。绝对定位层（行尾胶囊层）不参与居中判据，只记事实。④ **抽屉会话行同档**——点开回收站抽屉量一遍：高 32px / 圆角 8px / 行内边距 8px，与主树会话行一致。⑤ **搜索结果行**（行家族一员）能出结果就量：最小高 = 标准档 48px / 圆角 8px / 左右内边距 8px / 标题 14px·20px / 摘要行高 17px；这一轮出不来结果行（内容搜索不可用或查询无匹配）就记一笔事实跳过——搜索打的是真网关的只读路径。全程零 pageerror。',
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
      check.fact(
        `口径（#134）：行家族取标准档——工作区行 ${SCALE_TIERS.standard.projectRowHeight} / 会话行 ${SCALE_TIERS.standard.sessionRowHeight} / ` +
          `圆角 ${SCALE_TIERS.standard.rowRadius} / 行内边距 ${SCALE_TIERS.standard.rowPaddingInline} / 标题 ${SCALE_TIERS.standard.titleFontSize}·${SCALE_TIERS.standard.titleLineHeight}；` +
          `菜单一侧仍是紧凑档 ${SCALE_TIERS.compact.rowHeight} / ${SCALE_TIERS.compact.fontSize}`,
      )

      // ---- ① 三档宽度：行的几何 + 标题文字 ----
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 })
        await page.waitForTimeout(300)
        const rows = await readRows(page, ROW_PROBES)
        for (const [index, row] of rows.entries()) {
          const probe = ROW_PROBES[index]
          const metric = probe?.rowMetric ?? 'sessionRowHeight'
          expectRowTier(check, `w=${String(width)} ${row.label}`, row, SCALE_TIERS.standard[metric])
        }
        const titles = await page.evaluate(() =>
          Array.from(document.querySelectorAll('.dshOneTree_projectRow .dshOneTree_title, .dshOneTree_sessionRow .dshOneTree_title'))
            .slice(0, 2)
            .map((element) => {
              const style = getComputedStyle(element)
              return { text: (element.textContent ?? '').slice(0, 16), fontSize: style.fontSize, lineHeight: style.lineHeight }
            }),
        )
        check.ok(`w=${String(width)}：量到了行标题（工作区名 / 会话标题）`, titles.length > 0, JSON.stringify(titles))
        for (const title of titles) {
          check.eq(`w=${String(width)} 行标题「${title.text}」：字号 = 标准档 ${SCALE_TIERS.standard.titleFontSize}`, title.fontSize, SCALE_TIERS.standard.titleFontSize)
          check.eq(`w=${String(width)} 行标题「${title.text}」：行高 = 标准档 ${SCALE_TIERS.standard.titleLineHeight}`, title.lineHeight, SCALE_TIERS.standard.titleLineHeight)
        }
        if (width === 340) screenshots.push(await shot(page, 'row-tier-340'))
      }

      // ---- ③ 后半：悬停出一排 16×16 动作图标，确认它们同样居中、同样没被裁 ----
      // 注意两件事：动作图标在 `.dshOneTree_rowActions` **里面**（不是行的直接子元素），
      // 所以这一段用后代查询；而且**悬停的那一行与量到的那一行必须是同一行**——行集合里第一行
      // 可能是不带 ⋯ 按钮的空白会话行，所以先按「行里有没有动作图标」挑一行、拿到它自己的锚点
      // 属性（会话 id / 工作区 key），再按同一个锚点悬停并量它。
      await page.setViewportSize({ width: 340, height: 900 })
      await page.waitForTimeout(250)
      const pickRowWithIcons = async (rowSelector: string, anchorAttribute: string): Promise<string | null> =>
        page.evaluate(
          ({ rowSelector: selector, anchorAttribute: attribute }) => {
            const row = Array.from(document.querySelectorAll(selector)).find(
              (candidate) => candidate.querySelector('.dshOneTree_rowIconButton') !== null,
            )
            if (row === null || row === undefined) return null
            const anchor = row.getAttribute(attribute) ?? ''
            return anchor === '' ? null : `[${attribute}="${anchor}"]`
          },
          { rowSelector, anchorAttribute } as const,
        )
      for (const target of [
        { label: '会话行（悬停出动作图标）', row: '[data-dshone-tree-row="session"]', anchor: 'data-dshone-tree-session' },
        { label: '工作区行（悬停出动作图标）', row: '[data-dshone-tree-row="workspace"]', anchor: 'data-dshone-tree-key' },
      ]) {
        const rowSelector = await pickRowWithIcons(target.row, target.anchor)
        if (rowSelector === null) {
          check.fact(`${target.label}：这一轮页面上没有带动作图标的行——跳过`)
          continue
        }
        await page.hover(rowSelector)
        await page.waitForTimeout(250)
        const icons = await readHoverIcons(page, rowSelector)
        check.fact(
          `${target.label}（${rowSelector}）：处于 hover 态的行数=${String(icons.hoveredCount)}、动作容器 display=${icons.actionsDisplay}、` +
            `量到的动作图标 ${icons.buttons.map((button) => `${String(button.width)}×${String(button.height)} offset=${String(button.centerOffset)}`).join('、') || '（无）'}` +
            `（零尺寸 / 未显示的动作图标 ${String(icons.hiddenButtons)} 枚，不计入读数）`,
        )
        check.ok(`${target.label}：悬停时这一行真的处于 hover 态（否则下面的读数没有意义）`, icons.hoveredCount > 0, `hoveredCount=${String(icons.hoveredCount)}`)
        check.ok(
          `${target.label}：悬停时动作图标在行里（.dshOneTree_rowIconButton 在 .dshOneTree_rowActions 里）`,
          icons.buttons.length > 0,
          `动作容器 display=${icons.actionsDisplay}`,
        )
        for (const button of icons.buttons) {
          check.eq(
            `${target.label}：动作图标尺寸 = 标准档 ${SCALE_TIERS.standard.rowIconButtonSize}×${SCALE_TIERS.standard.rowIconButtonSize}`,
            [button.width, button.height],
            [
              Number.parseFloat(SCALE_TIERS.standard.rowIconButtonSize),
              Number.parseFloat(SCALE_TIERS.standard.rowIconButtonSize),
            ],
          )
          check.ok(
            `${target.label}：动作图标在行盒里垂直居中（|中心偏差| ≤ 1px）且没被裁`,
            Math.abs(button.centerOffset) <= 1 && button.inside,
            `offset=${String(button.centerOffset)} inside=${String(button.inside)}`,
          )
        }
        // 悬停态下常规流子件（图标位 / 标题 / 动作容器）也要仍居中、仍没被裁。
        const hovered = (await readRows(page, [{ label: target.label, selector: rowSelector }]))[0]
        if (hovered !== undefined && hovered.present) {
          check.ok(
            `${target.label}：悬停态下常规流子件仍全部居中、仍都在行矩形里`,
            hovered.children.every((child) => Math.abs(child.centerOffset) <= 1 && child.inside),
            JSON.stringify(hovered.children.map((child) => `${child.className} offset=${String(child.centerOffset)} inside=${String(child.inside)}`)),
          )
          check.fact(`${target.label} 悬停态子件：${hovered.children.map((child) => `${child.className} ${String(child.width)}×${String(child.height)}`).join('、')}`)
        }
      }
      screenshots.push(await shot(page, 'row-tier-hover-actions'))

      // ---- ④ 抽屉会话行（与主树会话行同一档）----
      const drawerToggle = await page.evaluate(() => document.querySelectorAll('[data-dshone-tree-action="recycle-toggle"]').length)
      if (drawerToggle === 0) {
        check.fact('这一轮页面没有回收站入口（网关无归档入口按钮）——抽屉会话行跳过')
      } else {
        await page.click('[data-dshone-tree-action="recycle-toggle"]')
        await page.waitForTimeout(400)
        const drawerRows = await readRows(page, [{ label: '抽屉会话行', selector: '.dshOneTree_drawerRow' }])
        const drawerRow = drawerRows[0]
        if (drawerRow === undefined || !drawerRow.present) {
          check.fact('抽屉里这一轮没有会话行（归档集合为空时只出状态行）——跳过')
        } else {
          expectRowTier(check, '抽屉会话行', drawerRow, SCALE_TIERS.standard.sessionRowHeight)
          screenshots.push(await shot(page, 'row-tier-drawer'))
        }
        await page.click('[data-dshone-tree-action="recycle-close"]')
        await page.waitForTimeout(400)
      }

      // ---- ② 菜单项仍是紧凑档（#134 的另一句话）----
      const trigger = await page.evaluate(() => {
        for (const selector of ['[data-dshone-tree-action="view-options"]', '[data-dshone-tree-action="group-pill"]']) {
          if (document.querySelectorAll(selector).length > 0) return selector
        }
        return null
      })
      if (trigger === null) {
        check.fact('这一轮页面上没有菜单触发器（网关数据里没有对应内容）——菜单对照跳过')
      } else {
        await page.click(trigger)
        await page.waitForTimeout(300)
        const items = await readMenuItems(page)
        check.ok(`菜单开出来了（触发器 ${trigger}）`, items.length > 0, `项数=${String(items.length)}`)
        check.fact(`菜单第一批项：${JSON.stringify(items[0] ?? null)}`)
        const compactItem: Readonly<Record<string, string>> = {
          height: SCALE_TIERS.compact.rowHeight,
          minHeight: SCALE_TIERS.compact.rowHeight,
          fontSize: SCALE_TIERS.compact.fontSize,
          lineHeight: SCALE_TIERS.compact.lineHeight,
          borderRadius: SCALE_TIERS.compact.rowRadius,
          gap: SCALE_TIERS.compact.rowGap,
          padding: `${SCALE_TIERS.compact.rowPaddingBlock} ${SCALE_TIERS.compact.rowPaddingInline} ${SCALE_TIERS.compact.rowPaddingBlock} ${SCALE_TIERS.compact.rowPaddingInline}`,
        }
        for (const [prop, expected] of Object.entries(compactItem)) {
          check.ok(
            `菜单项 ${prop} 仍是紧凑档 ${expected}（#134 没被顺手放开）`,
            items.every((item) => item[prop] === expected),
            `实测 ${[...new Set(items.map((item) => item[prop] ?? ''))].join(' / ')}`,
          )
        }
        await page.keyboard.press('Escape')
        await page.waitForTimeout(200)
        const left = await page.evaluate(() => document.querySelectorAll('[role="menu"]').length)
        if (left > 0) {
          await page.click(trigger)
          await page.waitForTimeout(200)
        }
        check.eq('菜单关掉了', await page.evaluate(() => document.querySelectorAll('[role="menu"]').length), 0)
      }

      // ---- ④ 搜索结果行：行家族一员，出得来结果就按标准档量 ----
      // 查询词取一条**当天真会话标题**的前 6 个字（网关只读：搜索不改任何数据）。出不来结果
      // （内容搜索不可用 / 无匹配）就记一笔事实跳过——这一块的期望值仍是档位表的标准档。
      const query = await page.evaluate(() => {
        const title = document.querySelector('.dshOneTree_sessionRow .dshOneTree_title')?.textContent ?? ''
        return title.trim().slice(0, 6)
      })
      const searchInput = await page.evaluate(() => document.querySelectorAll('[data-dshone-tree="search-input"]').length)
      if (query.length < 2 || searchInput === 0) {
        check.fact('这一轮拿不到可用的查询词 / 搜索框不在——搜索结果行跳过')
      } else {
        await page.fill('[data-dshone-tree="search-input"]', query)
        const deadline = Date.now() + 6000
        let searchRow = await readSearchRow(page)
        while (!searchRow.present && Date.now() < deadline) {
          await page.waitForTimeout(250)
          searchRow = await readSearchRow(page)
        }
        if (!searchRow.present) {
          check.fact(`搜索结果行：这一轮查询「${query}」没出结果行（内容搜索不可用或无匹配）——跳过`)
        } else {
          check.eq('搜索结果行：最小高 = 标准档 48px', searchRow.minHeight, SCALE_TIERS.standard.searchRowMinHeight)
          check.eq('搜索结果行：圆角 = 标准档 8px', searchRow.borderRadius, SCALE_TIERS.standard.rowRadius)
          check.eq('搜索结果行：左内边距 = 标准档 8px', searchRow.paddingLeft, SCALE_TIERS.standard.rowPaddingInline)
          check.eq('搜索结果行：右内边距 = 标准档 8px', searchRow.paddingRight, SCALE_TIERS.standard.rowPaddingInline)
          check.eq('搜索结果行标题：字号 = 标准档 14px', searchRow.titleFontSize, SCALE_TIERS.standard.titleFontSize)
          check.eq('搜索结果行标题：行高 = 标准档 20px', searchRow.titleLineHeight, SCALE_TIERS.standard.titleLineHeight)
          check.eq('搜索结果行摘要：行高 = 标准档 17px（官方 _searchResultSnippet 自己的行高）', searchRow.snippetLineHeight, SCALE_TIERS.standard.searchRowMetaLineHeight)
          screenshots.push(await shot(page, 'row-tier-search'))
        }
        await page.keyboard.press('Escape')
        await page.waitForTimeout(250)
        check.eq('Esc 清空搜索并回到树（本套件不在搜索态收尾）', await page.evaluate(() => document.querySelectorAll('[data-dshone-group-key]').length > 0), true)
      }

      check.eq('行家族档位套件全程零 pageerror', withoutKnownNoise(opened.capture.pageErrors).real, [])
    } finally {
      await opened.context.close()
    }
    return screenshots
  },
}
