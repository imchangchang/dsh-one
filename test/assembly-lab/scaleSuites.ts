/**
 * 侧栏风格档位表套件（#113，F-23）：**表驱动的运行期断言**。
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
 * F-23：侧栏风格档位表（#113）。量的是**真装配页 + 真网关（只读）+ 假宿主**下的侧栏树几何。
 * （编号从 F-20 改成 F-23：合到集成线时 F-20 已被 #114 的回收站入口套件、F-21 已被 #112 的
 * 当前工作区套件、F-22 已被 #115 的行内改名套件占用。）
 */
export const SCALE_SUITE: LabSuite = {
  id: 'F-23',
  phase: 'new-feature',
  name: '侧栏风格档位表（#113）：几何读数逐项落在官方档位表里，菜单统一官方紧凑档（SCALE 套件）',
  expect:
    '侧栏树在真实装配页上（真网关只读 + 假宿主）：① **几何读数逐项有出处**——会话行 / 工作区行 / 行标题 / 行时间 / 行内图标位 / 行内图标按钮 / 顶栏（分节头）/ 顶栏图标按钮 / 搜索框 / 分组胶囊 / 回收站入口行主区与动作按钮 / 当前工作区胶囊 / 抽屉头 / 抽屉分块块头 / 抽屉会话行的圆角、高度、字号、行高读数，每一条都能在 `styles.ts` 那份官方档位表（紧凑档 / 标准档 / 容器档）里按属性对上出处（期望值从档位表读，不硬编码）；单独钉住的关键值里，**行标题文字是标准档的 14px/20px**（#123 起标题文字取官方标题档，不再跟紧凑档的 12px/18px，完整断言在 F-30）。② **菜单统一官方紧凑档**：顶栏「视图选项」与分组胶囊两份菜单都开一遍，官方 Menu 的项（渲染高 26px / 最小高 26px / 字号 12px / 行高 18px / 圆角 5px / 间隙 6px / 内边距 3px 7px）、项内图标盒（14×14）、分组标题（11px / 16px / 内边距 4px 7px）、分隔线（外边距 2px）、列表容器（内边距 2px / 圆角 7px）逐项等于官方紧凑档实测值；两份菜单的项几何彼此一致（同一侧栏里只有一种菜单密度）。全程零 pageerror。',
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

      // 紧凑档真的落到浏览器里了（不是只在表里）：行圆角 5px、行高 26px。**行文字是例外**——
      // #123 起行 / 抽屉的标题文字取官方标题档（14px/20px，与官方侧栏标题同值），
      // 只有元信息（时间 / 计数）仍落紧凑档；这条口径的完整断言在 F-30。
      const row = treeProbes.find((probe) => probe.label === '会话行')
      check.eq('会话行圆角 = 紧凑档 5px', row?.readings.borderRadius, SCALE_TIERS.compact.rowRadius)
      check.eq('会话行高 = 紧凑档 26px', row?.readings.height, SCALE_TIERS.compact.rowHeight)
      const title = treeProbes.find((probe) => probe.label === '行标题')
      check.eq('行标题字号 = 标准档 14px（#123：标题文字取官方标题档）', title?.readings.fontSize, SCALE_TIERS.standard.titleFontSize)
      check.eq('行标题行高 = 标准档 20px（#123）', title?.readings.lineHeight, SCALE_TIERS.standard.titleLineHeight)
      const pill = treeProbes.find((probe) => probe.label === '分组胶囊')
      check.eq('分组胶囊高 = 紧凑档 26px（与菜单项同高）', pill?.readings.height, SCALE_TIERS.compact.rowHeight)
      check.eq('分组胶囊圆角 = 容器档 999px', pill?.readings.borderRadius, SCALE_TIERS.container.pillRadius)
      const slot = treeProbes.find((probe) => probe.label === '行内图标位')
      check.eq('行内图标位宽 = 标准档 16px', slot?.readings.width, SCALE_TIERS.standard.slotWidth)
      check.eq('行内图标位高 = 标准档 20px', slot?.readings.height, SCALE_TIERS.standard.slotHeight)
      screenshots.push(await shot(ctx, page, 'scale-tree-compact'))

      // ---- 抽屉内部（整块盖住树区，开着才量得到）----
      // 入口行的动作名是 `recycle-toggle`（#114 起点一下是开合开关）；这里此前写的是不存在的
      // `recycle-open`，于是抽屉那三件一直静默跳过——顺带修掉（读数因此真的跑起来了）。
      const drawerToggle = await page.evaluate(() => document.querySelectorAll('[data-dshone-tree-action="recycle-toggle"]').length)
      if (drawerToggle === 0) {
        check.fact('这一轮页面没有回收站入口（网关无归档入口按钮）——抽屉三件跳过')
      } else {
        await page.click('[data-dshone-tree-action="recycle-toggle"]')
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

// ---------------------------------------------------------------------------
// F-30 TITLE-TIER：标题文字回到官方标题档（#123）
// ---------------------------------------------------------------------------

/** 一处文字的读数：字号 / 行高，以及它所在的**行盒**有没有被文字撑破、文字有没有被裁掉。 */
type TitleReading =
  | { label: string; found: false }
  | {
      label: string
      found: true
      fontSize: string
      lineHeight: string
      /** 元素自身矩形高（单行文本就是它的行盒高）。 */
      boxHeight: number
      /** 行盒装不下：`scrollHeight` 超过 `clientHeight`（元素又是 `overflow:hidden`）就是被切了。 */
      verticalOverflow: boolean
      /** 元素矩形整个落在所在行矩形里。 */
      insideRow: boolean
      /** 所在行的 computed `height`（行高写的是紧凑档 26px，不该被文字撑破）。 */
      rowHeight: string
    }

interface TitleProbe {
  label: string
  selector: string
  /** 它所在的行（行盒高的来源）：`.closest()` 找最近的那一层。 */
  rowSelector: string
}

/** #123 的五处文字：工作区名与会话标题共用一个类（同一处消费点，两个位置各量一次）。 */
const TITLE_PROBES: ReadonlyArray<TitleProbe> = [
  { label: '工作区名', selector: '.dshOneTree_projectRow .dshOneTree_title', rowSelector: '.dshOneTree_projectRow' },
  { label: '会话标题', selector: '.dshOneTree_sessionRow .dshOneTree_title', rowSelector: '.dshOneTree_sessionRow' },
]

/** 读一组文字的读数（元素不在就记一条 `found: false`，由断言那边判是跳过还是失败）。 */
async function readTitles(page: OpenedPage['page'], probes: readonly TitleProbe[]): Promise<TitleReading[]> {
  return page.evaluate((list) => {
    const round = (value: number): number => Math.round(value * 100) / 100
    return list.map((probe) => {
      const element = document.querySelector(probe.selector)
      if (element === null) return { label: probe.label, found: false as const }
      const row = element.closest(probe.rowSelector)
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      const rowRect = row === null ? null : row.getBoundingClientRect()
      return {
        label: probe.label,
        found: true as const,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        boxHeight: round(rect.height),
        verticalOverflow: element.scrollHeight > element.clientHeight + 1,
        insideRow: rowRect !== null && rect.top >= rowRect.top - 0.5 && rect.bottom <= rowRect.bottom + 0.5,
        rowHeight: row === null ? '' : getComputedStyle(row).height,
      }
    })
  }, probes)
}

/**
 * 让假宿主答「这条会话开在面板里」（缺省就是 true；#121 的 F-28 会先把它翻成 false 验另一条路，
 * 这里显式钉住，免得同轮里别的套件留下的状态把「点当前会话行 = 就地改名」挡掉）。
 */
async function setHostPanelSession(page: OpenedPage['page'], open: boolean): Promise<void> {
  await page.evaluate((value: boolean) => {
    const host = (globalThis as { __LAB_HOST__?: { panelSession: unknown } }).__LAB_HOST__
    if (host !== undefined) host.panelSession = value
  }, open)
}

/**
 * 一条文字读数的完整判据（#123）：字号与行高都等于**官方标题档**（标准档的
 * `titleFontSize` / `titleLineHeight`，也就是官方侧栏标题 `.YDXeBa_title` 的原值），
 * 文字盒是单行的行盒（= 行高）、上下都没被裁，且它所在的行**仍是紧凑档的 26px**——
 * 行盒没被放大后的文字撑破（20px 行字 + 上下各 3px 的余量）。
 */
function expectTitleTier(check: Check, scope: string, reading: TitleReading, lineHeightKey: boolean): void {
  if (!reading.found) {
    check.ok(`${scope}：元素在（量得到才谈得上字号）`, false, '这一轮页面上没有这个元素')
    return
  }
  check.eq(`${scope}：字号 = 官方标题档 ${SCALE_TIERS.standard.titleFontSize}`, reading.fontSize, SCALE_TIERS.standard.titleFontSize)
  if (lineHeightKey) {
    check.eq(`${scope}：行高 = 官方标题档 ${SCALE_TIERS.standard.titleLineHeight}`, reading.lineHeight, SCALE_TIERS.standard.titleLineHeight)
  } else {
    // 抽屉标题 / 底部入口行只消费字号那一项（它们不声明行高，从容器继承），所以这里只记事实。
    check.fact(`${scope}：这一处不声明行高，实测继承值 ${reading.lineHeight}（不是本族的键）`)
  }
  check.ok(
    `${scope}：文字没有被竖向裁掉（scrollHeight ≤ clientHeight + 1）`,
    !reading.verticalOverflow,
    `verticalOverflow=${String(reading.verticalOverflow)}`,
  )
  check.ok(
    `${scope}：文字盒落在所在行里、且行高仍是紧凑档 ${SCALE_TIERS.compact.rowHeight}（行没被文字撑破）`,
    reading.insideRow && reading.rowHeight === SCALE_TIERS.compact.rowHeight,
    `insideRow=${String(reading.insideRow)} rowHeight=${reading.rowHeight}`,
  )
}

/**
 * F-30：侧栏标题文字回到官方标题档（#123）。用户实测工作区名与会话标题过于紧凑，
 * 要的是「标题与官方侧栏一致」——所以这一族（`title-font-size` / `title-line-height`）
 * 的 VS Code 档从紧凑档的 12px/18px 改回官方标题档的 14px/20px，几何（行高 26px /
 * 圆角 5px / 间距 / 图标位）仍取紧凑档。
 *
 * 套件量的是**同一页真装配页**下的四处消费点（外加行内改名输入框这条只在编辑态出现的路），
 * 并与菜单项对照，钉住「几何同档、文字不同档」这两件事同时成立。
 */
export const TITLE_TIER_SUITE: LabSuite = {
  id: 'F-30',
  phase: 'new-feature',
  name: '侧栏标题文字回到官方标题档（#123）：工作区名 / 会话标题 / 行内改名输入框 / 抽屉标题 / 入口行文字都是 14px/20px，行盒仍是 26px、菜单项仍是 12px（TITLE-TIER 套件）',
  expect:
    '侧栏树在真实装配页上（真网关只读 + 假宿主）：① **三档宽度（260/340/500）下工作区名与会话标题实测字号 = 官方标题档 14px、行高 = 20px**（期望值取自 `styles.ts` 档位表的标准档 `titleFontSize` / `titleLineHeight`，不硬编码）；② **行盒没被撑破**——两个位置所在行的 computed 高仍是紧凑档的 26px，文字盒整个落在行矩形里、`scrollHeight` 没有超过 `clientHeight`（20px 的行字在 26px 的行盒里上下各余 3px）；③ **行内改名输入框同步是 14px/20px**（点**当前**会话行进就地改名——#115/#121 那条真实路径，不是 ⋯ 菜单里的「重命名」：那一项开的是独立改名弹窗；假宿主答「这条会话开在面板里」，量 `.dshOneTree_inlineRenameInput` 的字号 / 行高 / 自身高，且它仍装在 26px 的行盒里）；④ **抽屉标题与底部回收站入口行文字同样是 14px**（这两处只消费字号那一项，行高从容器继承，套件按事实记录继承值）；⑤ **菜单项仍是紧凑档的 12px/18px**——顶栏「视图选项」菜单开一遍量官方 `Menu` 项的渲染高 26px / 字号 12px / 行高 18px，并显式钉住「会话行高 = 菜单项高（几何同档）而标题字号 ≠ 菜单项字号（文字不同档）」这两件事同时成立，证明这次只放开了文字、没顺带把几何也放开。全程零 pageerror；套件只开菜单、进一次改名编辑态再取消，不提交任何写请求。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const widths = [260, 340, 500] as const
    const opened = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { width: 380, height: 900 })
    const { page } = opened
    try {
      check.fact(
        `口径（#123）：标题文字族 = 标准档（官方标题档）${SCALE_TIERS.standard.titleFontSize} / ${SCALE_TIERS.standard.titleLineHeight}；` +
          `行盒与菜单仍是紧凑档 ${SCALE_TIERS.compact.rowHeight} / 字号 ${SCALE_TIERS.compact.fontSize}`,
      )

      // ---- ① + ② 三档宽度：工作区名与会话标题 ----
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 })
        await page.waitForTimeout(300)
        const readings = await readTitles(page, TITLE_PROBES)
        const seen = readings.map((reading) => `${reading.label}=${reading.found ? `${reading.fontSize}/${reading.lineHeight}（盒 ${String(reading.boxHeight)}，行 ${reading.rowHeight}）` : '缺'}`)
        check.fact(`w=${String(width)}：${seen.join('；')}`)
        for (const reading of readings) {
          const scope = `w=${String(width)} ${reading.label}`
          expectTitleTier(check, scope, reading, true)
          if (reading.found) {
            check.eq(
              `${scope}：文字盒高 = 行高 20px（单行，没有折行）`,
              reading.boxHeight,
              Number.parseFloat(SCALE_TIERS.standard.titleLineHeight),
            )
          }
        }
        if (width === 340) screenshots.push(await shot(ctx, page, 'title-tier-340'))
      }

      // ---- ④ 底部回收站入口行 + 抽屉标题（这两处只消费字号那一项）----
      await page.setViewportSize({ width: 340, height: 900 })
      await page.waitForTimeout(200)
      const footer = (await readTitles(page, [
        { label: '底部入口行文字', selector: '.dshOneTree_footerMain', rowSelector: '.dshOneTree_footerRow' },
      ]))[0]
      if (footer === undefined || !footer.found) {
        check.fact('这一轮页面没有回收站入口行（网关无归档入口按钮）——入口行与抽屉标题跳过')
      } else {
        check.eq(`底部入口行文字：字号 = 官方标题档 ${SCALE_TIERS.standard.titleFontSize}`, footer.fontSize, SCALE_TIERS.standard.titleFontSize)
        check.ok(
          `底部入口行文字：文字没被裁（行盒是紧凑档 ${SCALE_TIERS.compact.rowHeight} 高，14px 的字装得下）`,
          !footer.verticalOverflow && footer.insideRow,
          `verticalOverflow=${String(footer.verticalOverflow)} insideRow=${String(footer.insideRow)} rowHeight=${footer.rowHeight}`,
        )
        check.eq('底部入口行：行盒高仍 = 紧凑档 26px', footer.rowHeight, SCALE_TIERS.compact.rowHeight)

        await page.click('[data-dshone-tree-action="recycle-toggle"]')
        await page.waitForTimeout(400)
        const drawerTitle = (await readTitles(page, [
          { label: '抽屉标题', selector: '.dshOneTree_drawerTitle', rowSelector: '.dshOneTree_drawerHeader' },
        ]))[0]
        expectTitleTier(check, '抽屉标题', drawerTitle ?? { label: '抽屉标题', found: false }, false)
        if (drawerTitle !== undefined && drawerTitle.found) {
          check.eq('抽屉标题：字号 = 官方标题档 14px（#123）', drawerTitle.fontSize, SCALE_TIERS.standard.titleFontSize)
        }
        screenshots.push(await shot(ctx, page, 'title-tier-drawer'))
        await page.click('[data-dshone-tree-action="recycle-close"]')
        await page.waitForTimeout(300)
      }

      // ---- ③ 行内改名输入框：点**当前**会话行 = 就地改名（#115 / #121 那条真实路径）----
      // 注意**不要**走行 ⋯ 菜单里的「重命名」——那一项开的是独立的改名弹窗（官方 Dialog），
      // 不是行内输入框。这里走的是 #115 定的语义：点当前会话行就地变输入框；当前判据由
      // 假宿主答「这条会话开在面板里」（缺省 true）。
      await setHostPanelSession(page, true)
      const target = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('[data-dshone-tree-row="session"]'))
          .map((row) => ({
            id: row.getAttribute('data-dshone-tree-session') ?? '',
            title: (row.querySelector('.dshOneTree_title')?.textContent ?? '').trim(),
            current: row.getAttribute('aria-selected') === 'true',
          }))
          .filter((row) => row.id !== '' && row.title !== '')
        return rows.find((row) => row.current) ?? rows[0] ?? null
      })
      if (target === null) {
        check.fact('这一轮页面没有带标题的会话行 —— 行内改名输入框跳过')
      } else {
        const rowSel = `[data-dshone-tree-session="${target.id}"]`
        check.fact(`行内改名：夹具会话 ${JSON.stringify(target.id)}（点之前是当前会话=${String(target.current)}）`)
        // 非当前会话：点一下是「打开」（它变成当前），再点一下才是就地改名——所以最多点两次。
        await page.click(rowSel)
        await page.waitForTimeout(400)
        let input = (
          await readTitles(page, [
            { label: '行内改名输入框', selector: '.dshOneTree_inlineRenameInput', rowSelector: '.dshOneTree_sessionRow' },
          ])
        )[0]
        if (input === undefined || !input.found) {
          await page.click(rowSel)
          await page.waitForTimeout(400)
          input = (
            await readTitles(page, [
              { label: '行内改名输入框', selector: '.dshOneTree_inlineRenameInput', rowSelector: '.dshOneTree_sessionRow' },
            ])
          )[0]
        }
        check.ok('行内改名输入框：进到编辑态了（输入框在树上）', input?.found === true)
        if (input !== undefined && input.found) {
          check.eq(
            `行内改名输入框：字号 = 官方标题档 ${SCALE_TIERS.standard.titleFontSize}`,
            input.fontSize,
            SCALE_TIERS.standard.titleFontSize,
          )
          check.eq(
            `行内改名输入框：行高 = 官方标题档 ${SCALE_TIERS.standard.titleLineHeight}`,
            input.lineHeight,
            SCALE_TIERS.standard.titleLineHeight,
          )
          check.eq(
            '行内改名输入框：自身高 = 行高 20px（它按 title-line-height 取高，与文字同档）',
            input.boxHeight,
            Number.parseFloat(SCALE_TIERS.standard.titleLineHeight),
          )
          check.ok(
            `行内改名输入框：装在紧凑档 ${SCALE_TIERS.compact.rowHeight} 的行盒里（没把行撑破、也没被行裁掉）`,
            input.insideRow && input.rowHeight === SCALE_TIERS.compact.rowHeight,
            `insideRow=${String(input.insideRow)} rowHeight=${input.rowHeight}`,
          )
        }
        screenshots.push(await shot(ctx, page, 'title-tier-rename-input'))
        await page.keyboard.press('Escape')
        await page.waitForTimeout(250)
        check.eq(
          '行内改名输入框：Esc 取消后退出编辑态（套件不提交任何写请求）',
          await page.evaluate(() => document.querySelectorAll('[data-dshone-tree-rename="input"]').length),
          0,
        )
      }

      // ---- ⑤ 菜单项仍是紧凑档：几何同档、文字不同档 ----
      const trigger = await page.evaluate(() => {
        for (const selector of ['[data-dshone-tree-action="view-options"]', '[data-dshone-tree-action="group-pill"]']) {
          if (document.querySelectorAll(selector).length > 0) return selector
        }
        return null
      })
      if (trigger === null) {
        check.fact('这一轮页面上没有菜单触发器（网关数据里没有对应内容）——菜单对照跳过')
      } else {
        await openMenu(page, trigger)
        const facts = await readMenuFacts(page)
        check.ok(`菜单开出来了（触发器 ${trigger}）`, facts !== null)
        if (facts !== null) {
          const items = facts.items
          check.ok('菜单里有可量的项', items.length > 0, `项数=${String(items.length)}`)
          check.fact(`菜单第一批项：${JSON.stringify(items[0] ?? null)}`)
          check.ok(
            `菜单项字号仍 = 紧凑档 ${SCALE_TIERS.compact.fontSize}（#123 没动菜单文字）`,
            items.every((item) => item.fontSize === SCALE_TIERS.compact.fontSize),
            `实测 ${[...new Set(items.map((item) => item.fontSize))].join(' / ')}`,
          )
          check.ok(
            `菜单项行高仍 = 紧凑档 ${SCALE_TIERS.compact.lineHeight}`,
            items.every((item) => item.lineHeight === SCALE_TIERS.compact.lineHeight),
            `实测 ${[...new Set(items.map((item) => item.lineHeight))].join(' / ')}`,
          )
          check.ok(
            `菜单项渲染高仍 = 紧凑档 ${SCALE_TIERS.compact.rowHeight}`,
            items.every((item) => item.height === SCALE_TIERS.compact.rowHeight),
            `实测 ${[...new Set(items.map((item) => item.height))].join(' / ')}`,
          )
          const menuFont = items[0]?.fontSize ?? ''
          const menuHeight = items[0]?.height ?? ''
          const sessionRow = (await readTitles(page, [TITLE_PROBES[1] ?? { label: '会话标题', selector: '', rowSelector: '' }]))[0]
          // 「几何同档」：标题所在的行盒与菜单项一样高（都是紧凑档的 26px）。
          check.eq(
            `几何同档：会话行盒高（${SCALE_TIERS.compact.rowHeight}）= 菜单项渲染高`,
            sessionRow?.found === true ? sessionRow.rowHeight : '',
            menuHeight,
          )
          // 「文字不同档」：标题字号（官方标题档 14px）与菜单项字号（紧凑档 12px）不相等。
          check.ok(
            `文字不同档：标题字号（${SCALE_TIERS.standard.titleFontSize}）≠ 菜单项字号（${menuFont}）`,
            sessionRow?.found === true && sessionRow.fontSize !== menuFont,
            `标题=${sessionRow?.found === true ? sessionRow.fontSize : '缺'} 菜单项=${menuFont}`,
          )
          screenshots.push(await shot(ctx, page, 'title-tier-menu-compact'))
          await closeMenu(page, trigger)
        }
      }

      check.eq('标题档套件全程零 pageerror', withoutKnownNoise(opened.capture.pageErrors).real, [])
    } finally {
      await opened.context.close()
    }
    return screenshots
  },
}
