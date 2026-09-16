/**
 * 侧栏风格档位表套件（#113，F-20）：**表驱动的运行期断言**。
 *
 * 与 test/sidebarStyleScale.test.ts（源码层，扫样式字符串）分工：那一条防的是「代码里写了个
 * 档位表没有的值」，本套件防的是「值写对了、但落到浏览器里不是那么回事」——官方 css-module
 * 的优先级、继承、`compact` 变体有没有真的生效，都只有在真页面里量才算数。
 *
 * 期望值不硬编码：直接从 `workspaceTree/styles.ts` 读那份档位表（`SCALE_TIERS`），
 * 页面读数逐项与它比。断言两块：
 * ① **侧栏几何**：行 / 胶囊 / 抽屉行 / 图标位 / 标题 / 顶栏的圆角、高度、字号、行高读数，
 *    逐项能在档位表里找到出处（按属性对得上那一组量）；
 * ② **菜单**：顶栏「视图选项」与分组胶囊两份菜单都开一遍，量官方 Menu 的项（高/字号/圆角/
 *    内边距/间隙）、项内图标盒、分组标题、分隔线、列表容器——逐项等于**官方紧凑档**，
 *    且两份菜单彼此一致（同一侧栏里不能有两种菜单密度）。
 *
 * 独立成文件的原因与 driftSuites.ts 同：suites.ts 是并行开发的合入热点，末尾只加一行注册。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { openTreePage, withoutKnownNoise, type Check, type OpenedPage } from './harness.ts'
import { LAB_TREES, type LabTreeRoute } from './labServer.ts'
import { SCALE_TIERS } from '../../src/ui/assembly/shell/workspaceTree/styles.ts'
// 只取类型（编译后不留 import，运行期没有环）：套件接口定义在 suites.ts 里，它就是调用方。
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

type TierName = keyof typeof SCALE_TIERS

const metrics = (tier: TierName): [string, string][] => Object.entries(SCALE_TIERS[tier] as Record<string, string>)

/**
 * 属性 → 它能引用的**量的名字**：与 test/sidebarStyleScale.test.ts 同一套口径（量名就是语义
 * 单位：*Radius 才有圆角、*Height/*Size 才有高度）。这里用它算出「这个读数出自哪一个量」，
 * 好在报告里写出出处，而不是只报一句「不在表里」。
 */
const PROP_METRIC: Readonly<Record<string, RegExp>> = {
  borderRadius: /radius$/i,
  // `(?<!line)`：文字行高（*LineHeight）不是「高度」——一个 20px 的盒子不能拿 20px 的
  // 文字行高当出处（否则报告里写出来的出处会张冠李戴）。口径与 test/sidebarStyleScale.test.ts
  // 的源码层扫描一致。
  height: /(?<!line)(height|size)$/i,
  width: /(?<!line)(width|size)$/i,
  fontSize: /fontsize$/i,
  lineHeight: /lineheight$/i,
}

/** 读数的出处（档位名 → 量名），找不到出处返回 null。 */
function sourceOf(prop: string, value: string): string | null {
  const pattern = PROP_METRIC[prop]
  if (pattern === undefined) return null
  for (const tier of ['compact', 'standard', 'container'] as TierName[]) {
    for (const [metric, candidate] of metrics(tier)) {
      if (pattern.test(metric) && candidate === value) return `${tier}.${metric}`
    }
  }
  return null
}

/** 要量的侧栏区域：区域名 → 选择器 + 要读的 computed 属性（值按 `px` 字符串比）。 */
const GEOMETRY_PROBES: ReadonlyArray<{ label: string; selector: string; props: readonly string[] }> = [
  { label: '会话行', selector: '.dshOneTree_sessionRow', props: ['borderRadius', 'height'] },
  { label: '工作区行', selector: '.dshOneTree_projectRow', props: ['borderRadius', 'height'] },
  { label: '行标题', selector: '.dshOneTree_title', props: ['fontSize', 'lineHeight'] },
  { label: '行时间', selector: '.dshOneTree_time', props: ['fontSize', 'lineHeight'] },
  { label: '行内图标位', selector: '.dshOneTree_slot', props: ['width', 'height'] },
  { label: '行内图标按钮', selector: '.dshOneTree_rowIconButton', props: ['width', 'height', 'borderRadius'] },
  { label: '顶栏（分节头）', selector: '.dshOneTree_sectionHeader', props: ['height', 'borderRadius'] },
  { label: '顶栏图标按钮', selector: '.dshOneTree_iconButton', props: ['width', 'height', 'borderRadius'] },
  { label: '搜索框', selector: '.dshOneTree_searchExpanded', props: ['height', 'borderRadius'] },
  { label: '分组胶囊', selector: '.dshOneTree_pill', props: ['height', 'fontSize', 'borderRadius'] },
  { label: '回收站入口主区', selector: '.dshOneTree_footerMain', props: ['height', 'borderRadius', 'fontSize'] },
  { label: '回收站入口动作按钮', selector: '.dshOneTree_footerIconButton', props: ['width', 'height', 'borderRadius'] },
  { label: '当前工作区胶囊', selector: '.dshOneTree_workspaceBadge', props: ['height', 'fontSize', 'borderRadius', 'lineHeight'] },
]

/** 抽屉内部（抽屉整块盖住树区，要开着才量得到）。 */
const DRAWER_PROBES: ReadonlyArray<{ label: string; selector: string; props: readonly string[] }> = [
  { label: '抽屉头', selector: '.dshOneTree_drawerHeader', props: ['height'] },
  { label: '抽屉分块块头', selector: '.dshOneTree_drawerGroupLabel', props: ['height', 'borderRadius', 'fontSize'] },
  { label: '抽屉会话行', selector: '.dshOneTree_drawerRow', props: ['height', 'borderRadius'] },
]

interface ProbeReading {
  label: string
  selector: string
  readings: Record<string, string>
}

/** 读一组区域的 computed 几何（元素不在或该属性不是写死的长度就不进表）。 */
async function readProbes(
  page: OpenedPage['page'],
  probes: readonly { label: string; selector: string; props: readonly string[] }[],
): Promise<ProbeReading[]> {
  return page.evaluate((list) => {
    const kebab = (prop: string): string => prop.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
    const out: { label: string; selector: string; readings: Record<string, string> }[] = []
    for (const probe of list) {
      const element = document.querySelector(probe.selector)
      if (element === null) continue
      const computed = getComputedStyle(element)
      const readings: Record<string, string> = {}
      for (const prop of probe.props) {
        const value = computed.getPropertyValue(kebab(prop)).trim()
        // 只收「写死的长度」：auto / 百分比 / calc 由布局决定，不是档位能管的东西。
        // （读 computed 而不是 getBoundingClientRect：档位表管的是写下来的值，隐藏元素
        // 的矩形是 0，读矩形会把「没渲染」误判成「0px 不在表里」。）
        if (!/^\d+(\.\d+)?px$/.test(value)) continue
        readings[prop] = value
      }
      if (Object.keys(readings).length > 0) out.push({ label: probe.label, selector: probe.selector, readings })
    }
    return out
  }, probes)
}

interface MenuFacts {
  /** 列表容器（`[role="menu"]`）上的几何。 */
  list: Record<string, string>
  /** 每一条菜单项的几何（项内图标盒单独量）。 */
  items: Record<string, string>[]
  /** 项内图标盒的宽高（没有图标的项不产出行）。 */
  icons: Record<string, string>[]
  /** 分组标题（官方 `_label`）的几何。 */
  labels: Record<string, string>[]
  /** 分隔线的几何。 */
  separators: Record<string, string>[]
}

/** 读当前最后一份菜单的项 / 图标 / 分组标题 / 分隔线 / 容器几何（认官方 role 与类名后缀）。 */
async function readMenuFacts(page: OpenedPage['page']): Promise<MenuFacts | null> {
  return page.evaluate(() => {
    const list = Array.from(document.querySelectorAll('[role="menu"]')).pop() ?? null
    if (list === null) return null
    const px = (value: number): string => `${String(Math.round(value * 100) / 100)}px`
    const box = (element: Element): { w: string; h: string } => {
      const rect = element.getBoundingClientRect()
      return { w: px(rect.width), h: px(rect.height) }
    }
    const listStyle = getComputedStyle(list)
    const items = Array.from(list.querySelectorAll('button[role="menuitem"]'))
    const itemFacts = items.map((item) => {
      const style = getComputedStyle(item)
      const rect = item.getBoundingClientRect()
      return {
        height: px(rect.height),
        minHeight: style.minHeight,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        borderRadius: style.borderRadius,
        gap: style.columnGap,
        padding: `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`,
      }
    })
    const icons = items
      .map((item) => item.querySelector('[class*="_itemIcon"]'))
      .filter((icon): icon is Element => icon !== null)
      .map((icon) => {
        const rect = icon.getBoundingClientRect()
        return { width: px(rect.width), height: px(rect.height) }
      })
    const labels = Array.from(list.querySelectorAll('[class*="_label"]'))
      .filter((element) => element.querySelector('button[role="menuitem"]') === null)
      .map((element) => {
        const style = getComputedStyle(element)
        return {
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
          padding: `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`,
        }
      })
    const separators = Array.from(list.querySelectorAll('[role="separator"]')).map((element) => {
      const style = getComputedStyle(element)
      return { margin: `${style.marginTop} ${style.marginBottom}`, height: style.height }
    })
    return {
      list: {
        padding: `${listStyle.paddingTop} ${listStyle.paddingRight} ${listStyle.paddingBottom} ${listStyle.paddingLeft}`,
        borderRadius: listStyle.borderRadius,
        minWidth: listStyle.minWidth,
      },
      items: itemFacts,
      icons,
      labels,
      separators,
    }
  })
}

/** 开一份菜单：点触发器 → 等它渲染出来。 */
async function openMenu(page: OpenedPage['page'], selector: string): Promise<void> {
  await page.click(selector)
  await page.waitForTimeout(300)
}

/**
 * 关掉当前菜单：Esc；官方不接 Esc 时**再点一次那个触发器**（它是 toggle，副作用只有开关）。
 * 不用「点别处」的兜底：侧栏那一带底下是行与行上的 `＋`，一次盲点可能真的建出一个会话
 * （R-06 守的是「整轮跑完网关会话数不变」，别让收尾动作去踩它）。
 */
async function closeMenu(page: OpenedPage['page'], trigger: string): Promise<void> {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  const left = await page.evaluate(() => document.querySelectorAll('[role="menu"]').length)
  if (left > 0) {
    await page.click(trigger)
    await page.waitForTimeout(200)
  }
}

/** 全部菜单项的某条属性是否同值（同一侧栏内菜单密度一致）。 */
function uniform(items: readonly Record<string, string>[], prop: string): { ok: boolean; seen: string } {
  const values = [...new Set(items.map((item) => item[prop] ?? ''))]
  return { ok: values.length <= 1, seen: values.join(' / ') }
}

/**
 * F-20：侧栏风格档位表（#113）。量的是**真装配页 + 真网关（只读）+ 假宿主**下的侧栏树几何。
 */
export const SCALE_SUITE: LabSuite = {
  id: 'F-20',
  phase: 'new-feature',
  name: '侧栏风格档位表（#113）：几何读数逐项落在官方档位表里，菜单统一官方紧凑档（SCALE 套件）',
  expect:
    '侧栏树在真实装配页上（真网关只读 + 假宿主）：① **几何读数逐项有出处**——会话行 / 工作区行 / 行标题 / 行时间 / 行内图标位 / 行内图标按钮 / 顶栏（分节头）/ 顶栏图标按钮 / 搜索框 / 分组胶囊 / 回收站入口行主区与动作按钮 / 当前工作区胶囊 / 抽屉头 / 抽屉分块块头 / 抽屉会话行的圆角、高度、字号、行高读数，每一条都能在 `styles.ts` 那份官方档位表（紧凑档 / 标准档 / 容器档）里按属性对上出处（期望值从档位表读，不硬编码）。② **菜单统一官方紧凑档**：顶栏「视图选项」与分组胶囊两份菜单都开一遍，官方 Menu 的项（渲染高 26px / 最小高 26px / 字号 12px / 行高 18px / 圆角 5px / 间隙 6px / 内边距 3px 7px）、项内图标盒（14×14）、分组标题（11px / 16px / 内边距 4px 7px）、分隔线（外边距 2px）、列表容器（内边距 2px / 圆角 7px）逐项等于官方紧凑档实测值；两份菜单的项几何彼此一致（同一侧栏里只有一种菜单密度）。全程零 pageerror。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const opened = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { width: 380, height: 900 })
    const { page } = opened
    try {
      check.fact(
        `档位表（紧凑档 / 标准档 / 容器档）取自 workspaceTree/styles.ts：` +
          `compact=${JSON.stringify(SCALE_TIERS.compact)}；container=${JSON.stringify(SCALE_TIERS.container)}`,
      )

      // ---- ① 树区几何：逐项找出处 ----
      const treeProbes = await readProbes(page, GEOMETRY_PROBES)
      check.fact(`量到的树区区域：${treeProbes.map((probe) => probe.label).join('、')}`)
      check.ok('树区量到的区域数 ≥ 10（量法没漏掉整块）', treeProbes.length >= 10, `量到 ${String(treeProbes.length)} 块`)
      const uncovered: string[] = []
      for (const probe of treeProbes) {
        for (const [prop, value] of Object.entries(probe.readings)) {
          const source = sourceOf(prop, value)
          check.ok(
            `${probe.label}：${prop} = ${value} 能在档位表里找到出处`,
            source !== null,
            source === null ? '不在档位表里（自造值）' : `出处 ${source}`,
          )
          if (source === null) uncovered.push(`${probe.label}.${prop}=${value}`)
        }
      }
      check.fact(`树区读数里没有出处的项：${uncovered.join('、') || '（无）'}`)
      check.fact(
        `树区读数 → 出处：${treeProbes
          .flatMap((probe) =>
            Object.entries(probe.readings).map(([prop, value]) => `${probe.label}.${prop}=${value}(${sourceOf(prop, value) ?? '无出处'})`),
          )
          .join('；')}`,
      )

      // 紧凑档真的落到浏览器里了（不是只在表里）：行圆角 5px、行高 26px、字号 12px。
      const row = treeProbes.find((probe) => probe.label === '会话行')
      check.eq('会话行圆角 = 紧凑档 5px', row?.readings.borderRadius, SCALE_TIERS.compact.rowRadius)
      check.eq('会话行高 = 紧凑档 26px', row?.readings.height, SCALE_TIERS.compact.rowHeight)
      const title = treeProbes.find((probe) => probe.label === '行标题')
      check.eq('行标题字号 = 紧凑档 12px', title?.readings.fontSize, SCALE_TIERS.compact.fontSize)
      check.eq('行标题行高 = 紧凑档 18px', title?.readings.lineHeight, SCALE_TIERS.compact.lineHeight)
      const pill = treeProbes.find((probe) => probe.label === '分组胶囊')
      check.eq('分组胶囊高 = 紧凑档 26px（与菜单项同高）', pill?.readings.height, SCALE_TIERS.compact.rowHeight)
      check.eq('分组胶囊圆角 = 容器档 999px', pill?.readings.borderRadius, SCALE_TIERS.container.pillRadius)
      const slot = treeProbes.find((probe) => probe.label === '行内图标位')
      check.eq('行内图标位宽 = 标准档 16px', slot?.readings.width, SCALE_TIERS.standard.slotWidth)
      check.eq('行内图标位高 = 标准档 20px', slot?.readings.height, SCALE_TIERS.standard.slotHeight)
      screenshots.push(await shot(ctx, page, 'scale-tree-compact'))

      // ---- 抽屉内部（整块盖住树区，开着才量得到）----
      const drawerOpen = await page.evaluate(() => document.querySelectorAll('[data-dshone-tree-action="recycle-open"]').length)
      if (drawerOpen === 0) {
        check.fact('这一轮页面没有回收站入口（网关无归档入口按钮）——抽屉三件跳过')
      } else {
        await page.click('[data-dshone-tree-action="recycle-open"]')
        await page.waitForTimeout(400)
        const drawerProbes = await readProbes(page, DRAWER_PROBES)
        check.fact(`量到的抽屉区域：${drawerProbes.map((probe) => probe.label).join('、')}`)
        for (const probe of drawerProbes) {
          for (const [prop, value] of Object.entries(probe.readings)) {
            const source = sourceOf(prop, value)
            check.ok(`${probe.label}：${prop} = ${value} 能在档位表里找到出处`, source !== null, source ?? '不在档位表里')
          }
        }
        const drawerRow = drawerProbes.find((probe) => probe.label === '抽屉会话行')
        if (drawerRow !== undefined) {
          check.eq('抽屉会话行高 = 紧凑档 26px', drawerRow.readings.height, SCALE_TIERS.compact.rowHeight)
          check.eq('抽屉会话行圆角 = 紧凑档 5px', drawerRow.readings.borderRadius, SCALE_TIERS.compact.rowRadius)
        }
        screenshots.push(await shot(ctx, page, 'scale-drawer-compact'))
        await page.click('[data-dshone-tree-action="recycle-close"]')
        await page.waitForTimeout(250)
      }

      // ---- ② 菜单统一官方紧凑档 ----
      const compactItem = {
        height: SCALE_TIERS.compact.rowHeight,
        minHeight: SCALE_TIERS.compact.rowHeight,
        fontSize: SCALE_TIERS.compact.fontSize,
        lineHeight: SCALE_TIERS.compact.lineHeight,
        borderRadius: SCALE_TIERS.compact.rowRadius,
        gap: SCALE_TIERS.compact.rowGap,
        padding: `${SCALE_TIERS.compact.rowPaddingBlock} ${SCALE_TIERS.compact.rowPaddingInline} ${SCALE_TIERS.compact.rowPaddingBlock} ${SCALE_TIERS.compact.rowPaddingInline}`,
      }
      const menus: { name: string; trigger: string; facts: MenuFacts }[] = []
      for (const target of [
        { name: '视图选项菜单', trigger: '[data-dshone-tree-action="view-options"]' },
        { name: '分组胶囊菜单', trigger: '[data-dshone-tree-action="group-pill"]' },
      ]) {
        const exists = await page.evaluate((selector: string) => document.querySelectorAll(selector).length, target.trigger)
        if (exists === 0) {
          check.fact(`${target.name}：这一轮页面上没有这个触发器（网关数据里没有对应内容）——跳过`)
          continue
        }
        await openMenu(page, target.trigger)
        const facts = await readMenuFacts(page)
        check.ok(`${target.name}：菜单开出来了`, facts !== null)
        if (facts === null) continue
        menus.push({ name: target.name, trigger: target.trigger, facts })
        check.fact(
          `${target.name}：项数=${String(facts.items.length)}、图标项=${String(facts.icons.length)}、分组标题=${String(facts.labels.length)}、分隔线=${String(facts.separators.length)}；` +
            `第一项=${JSON.stringify(facts.items[0] ?? null)}；容器=${JSON.stringify(facts.list)}`,
        )
        for (const [prop, expected] of Object.entries(compactItem)) {
          const seen = uniform(facts.items, prop)
          check.ok(
            `${target.name}：所有菜单项的 ${prop} = ${expected}（官方紧凑档）`,
            seen.ok && seen.seen === expected,
            `实测 ${seen.seen}`,
          )
        }
        const iconSizes = [...new Set(facts.icons.map((icon) => `${icon.width}×${icon.height}`))]
        check.ok(
          `${target.name}：项内图标盒 = 14×14（官方紧凑档的图标位）`,
          iconSizes.every((size) => size === `${SCALE_TIERS.compact.iconSize}×${SCALE_TIERS.compact.iconSize}`),
          `实测 ${iconSizes.join(' / ') || '没有图标项'}`,
        )
        for (const label of facts.labels) {
          check.eq(
            `${target.name}：分组标题字号 = 紧凑档 11px`,
            label.fontSize,
            SCALE_TIERS.compact.groupLabelFontSize,
          )
          check.eq(
            `${target.name}：分组标题行高 = 紧凑档 16px`,
            label.lineHeight,
            SCALE_TIERS.compact.groupLabelLineHeight,
          )
          check.eq(
            `${target.name}：分组标题内边距 = 紧凑档 4px 7px`,
            label.padding,
            `${SCALE_TIERS.compact.groupLabelPaddingBlock} ${SCALE_TIERS.compact.rowPaddingInline} ${SCALE_TIERS.compact.groupLabelPaddingBlock} ${SCALE_TIERS.compact.rowPaddingInline}`,
          )
        }
        for (const separator of facts.separators) {
          check.eq(
            `${target.name}：分隔线外边距 = 紧凑档 2px`,
            separator.margin,
            `${SCALE_TIERS.compact.separatorMargin} ${SCALE_TIERS.compact.separatorMargin}`,
          )
        }
        check.eq(
          `${target.name}：列表容器内边距 = 紧凑档 2px`,
          facts.list.padding,
          `${SCALE_TIERS.compact.listPadding} ${SCALE_TIERS.compact.listPadding} ${SCALE_TIERS.compact.listPadding} ${SCALE_TIERS.compact.listPadding}`,
        )
        check.eq(
          `${target.name}：列表容器圆角 = 容器档 7px`,
          facts.list.borderRadius,
          SCALE_TIERS.container.listRadius,
        )
        screenshots.push(await shot(ctx, page, `scale-menu-${target.name === '视图选项菜单' ? 'view-options' : 'group-pill'}`))
        await closeMenu(page, target.trigger)
        check.eq(`${target.name}：关掉了`, await page.evaluate(() => document.querySelectorAll('[role="menu"]').length), 0)
      }
      check.ok('至少开出过一份菜单（菜单紧凑档断言真的跑到了）', menus.length >= 1, `开出 ${String(menus.length)} 份`)
      if (menus.length >= 2) {
        for (const prop of Object.keys(compactItem)) {
          const first = menus[0]?.facts.items ?? []
          const second = menus[1]?.facts.items ?? []
          check.eq(
            `同一侧栏内菜单密度一致：两份菜单的 ${prop} 读数相同`,
            [...new Set(second.map((item) => item[prop] ?? ''))].join(','),
            [...new Set(first.map((item) => item[prop] ?? ''))].join(','),
          )
        }
      }

      check.eq('档位表套件全程零 pageerror', withoutKnownNoise(opened.capture.pageErrors).real, [])
    } finally {
      await opened.context.close()
    }
    return screenshots
  },
}
