/**
 * 回收站入口行的几何（#137）：右对齐 + 图标与尺寸按旧侧栏规格。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与 `recycleEntrySuites.ts`（F-20）同一条：那个
 * 文件是本批开发的合入热点，新套件放外面能少一半冲突面。注册方式是在 `suites.ts` 的
 * `SUITES` 末尾追加一项。
 *
 * **这一条与 F-20 的分工**：F-20 管的是「图标是垃圾桶 + 点击是开合开关」这些**行为**，
 * 本条管的是那一行的**几何**——用户实测报的是几何（清空 / 恢复两枚图标没有贴到行最右，
 * 而且交互图标的规格与旧 dsh-one 侧栏插件那一行不一样）。
 *
 * **为什么几何断言写成关系式**：这一行的高 / 内边距 / 按钮尺寸整套取自旧侧栏插件里的
 * 定值（用户点名的参照物，见 `styles.ts` 里那几条规则上方的逐条对应），所以「等于某个
 * 像素」本身说明不了什么；真正要钉的是**关系**：右缘落在行的内容区右缘上（不靠眼睛），
 * 计数紧贴动作组、标签吃满余量、空间不足时截断而不把右侧挤出去。期望值尽量从档位表读
 * （按钮 26px / 图标 14 / 16 / 行内间隙 2px / 右侧 8px 与标准档、紧凑档里同名量同值），
 * 只有旧规格才有的那几项（纵向内边距 7px、计数胶囊 10px / 圆角 8px）写成常量并注明出处。
 *
 * 本套件**不碰网关的写面**：假宿主的 `recycle-bin` 状态由夹具注入（空集合那一页用来验
 * 计数 0 的灰态与禁用），全程只读真网关。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { openTreePage, withoutKnownNoise, type Check, type OpenedPage } from './harness.ts'
import { LAB_TREES, type LabTreeRoute } from './labServer.ts'
// 期望值从档位表读（不硬编码）：这几个值与旧侧栏规格同值，见文件头那段。
import { SCALE_TIERS } from '../../src/ui/assembly/shell/workspaceTree/styles.ts'
// 只取类型（编译后不留 import，运行期没有环）：套件接口定义在 suites.ts 里。
import type { LabSuite } from './suites.ts'

const route = (name: string): LabTreeRoute => {
  const found = LAB_TREES.find((candidate) => candidate.route === name)
  if (found === undefined) throw new Error(`lab: unknown tree route ${name}`)
  return found
}

/**
 * 旧侧栏规格里这一行的取值（#137 的正本：`sessionsView.ts` 的 `.recycle-entry*` 与
 * `sessionsWebview.ts` 的 renderRecycleEntry）。带「档位」注释的几项在官方档位表里有同名量
 * 且同值（按钮 26px = 紧凑档的图标按钮、图标 16 / 14 = 标准档的图标位 / 紧凑档的图标位、
 * 行内间隙 2px = 标准档的行间距、右侧 8px = 标准档的行内边距），所以它们既能在档位表里
 * 查到出处，也就是用户要的那份旧规格；只有纵向内边距 7px 与计数胶囊那几项是旧规格独有，
 * 登记在 `styles.ts` 的 `SCALE_EXEMPT` 里。
 */
const ENTRY = {
  /** 行盒右侧留白（旧规格 `padding-right:8px`，= 标准档的行内边距 8px）。 */
  rowPaddingRight: 8,
  /** 主区纵向内边距（旧规格 `.recycle-entry-main{padding:7px 4px 7px 14px}` 的纵向那一对）。 */
  mainPaddingBlock: 7,
  /** 主区右内边距（同上，横向那一对的右半边）。 */
  mainPaddingRight: 4,
  /** 两枚动作按钮的边长（旧规格 `.recycle-entry .sessions-tool{width:26px;height:26px}`）。 */
  actionSize: 26,
  /** 动作按钮里的图标（旧规格渲染的 14 号图标）。 */
  actionIcon: 14,
  /** 主区图标（旧规格渲染的 16 号垃圾桶）。 */
  mainIcon: 16,
  /** 计数胶囊：10px 字 / 16px 行高 / 圆角 8px / 内边距 0 5px。 */
  countFontSize: 10,
  countLineHeight: 16,
  countRadius: 8,
  countPaddingInline: 5,
} as const

/** 量出来的读数允许的误差（亚像素布局 + 缩放）。关系式留 1px，尺寸留 0.5px。 */
const EPS = 1

interface Box {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
}

interface EntryGeometry {
  viewport: number
  /** 行盒。 */
  row: Box
  /** 行盒的布局容器（往上找第一个矩形宽非 0 的祖先——官方那个 list 槽是 display:contents，矩形是 0）。 */
  container: Box | null
  rowGap: number
  rowPaddingRight: number
  /** 主区按钮。 */
  main: Box
  mainPaddingTop: number
  mainPaddingRight: number
  mainPaddingLeft: number
  /** 主区图标（svg）。 */
  mainIcon: Box | null
  /** 标签。 */
  label: Box
  labelClipped: boolean
  labelStyle: { textOverflow: string; overflow: string; whiteSpace: string; minWidth: string }
  /** 计数胶囊。 */
  count: Box
  countText: string
  countStyle: { background: string; paddingLeft: string; paddingRight: string; fontSize: string; borderRadius: string; lineHeight: string }
  /** 两枚动作按钮（按 DOM 顺序：清空、恢复）。 */
  buttons: { name: string; box: Box; icon: Box | null; disabled: boolean; ariaLabel: string; radius: string }[]
  /** 行盒的子元素顺序（自有类名，用来钉「两枚动作在主区右侧」）。 */
  order: string[]
}

/** 页面侧读一次入口行的几何（矩形 + 关键 computed 样式）。 */
async function readEntry(page: OpenedPage['page']): Promise<EntryGeometry> {
  return page.evaluate(() => {
    const round = (value: number): number => Math.round(value * 100) / 100
    const box = (element: Element): {
      left: number
      right: number
      top: number
      bottom: number
      width: number
      height: number
    } => {
      const rect = element.getBoundingClientRect()
      return {
        left: round(rect.left),
        right: round(rect.right),
        top: round(rect.top),
        bottom: round(rect.bottom),
        width: round(rect.width),
        height: round(rect.height),
      }
    }
    const style = (element: Element): CSSStyleDeclaration => getComputedStyle(element)
    const row = document.querySelector('[data-dshone-tree="recycle-entry"]')
    const main = document.querySelector('[data-dshone-tree-action="recycle-toggle"]')
    const label = row?.querySelector('.dshOneTree_footerLabel') ?? null
    const count = row?.querySelector('.dshOneTree_footerCount') ?? null
    const mainIcon = main?.querySelector('.dshOneTree_footerIcon svg') ?? null
    const actionButton = (name: string): HTMLButtonElement | null =>
      document.querySelector(`[data-dshone-tree-action="${name}"]`)
    if (row === null || main === null || label === null || count === null) {
      throw new Error('lab: recycle entry row is not rendered (row / main / label / count)')
    }
    const rowStyle = style(row)
    const labelStyle = style(label)
    const countStyle = style(count)
    const buttons = ['recycle-empty-all', 'recycle-restore-all'].flatMap((name) => {
      const button = actionButton(name)
      if (button === null) return []
      const icon = button.querySelector('svg')
      return [
        {
          name,
          box: box(button),
          icon: icon === null ? null : box(icon),
          disabled: button.disabled,
          ariaLabel: button.getAttribute('aria-label') ?? '',
          radius: style(button).borderRadius,
        },
      ]
    })
    return {
      viewport: window.innerWidth,
      row: box(row),
      // 官方那个 list 槽（`[data-slot="sidebar.footer.action"]`）是 `display:contents`，
      // 它的矩形是 0×0——所以「行吃满容器」要比较的是**往上第一个矩形宽非 0 的祖先**。
      container: (() => {
        let node: Element | null = row.parentElement
        while (node !== null) {
          const rect = node.getBoundingClientRect()
          if (rect.width > 0) return box(node)
          node = node.parentElement
        }
        return null
      })(),
      rowGap: Number.parseFloat(rowStyle.columnGap) || 0,
      rowPaddingRight: Number.parseFloat(rowStyle.paddingRight) || 0,
      main: box(main),
      mainPaddingTop: Number.parseFloat(style(main).paddingTop) || 0,
      mainPaddingRight: Number.parseFloat(style(main).paddingRight) || 0,
      mainPaddingLeft: Number.parseFloat(style(main).paddingLeft) || 0,
      mainIcon: mainIcon === null ? null : box(mainIcon),
      label: box(label),
      labelClipped: label.scrollWidth > label.clientWidth,
      labelStyle: {
        textOverflow: labelStyle.textOverflow,
        overflow: labelStyle.overflowX,
        whiteSpace: labelStyle.whiteSpace,
        minWidth: labelStyle.minWidth,
      },
      count: box(count),
      countText: (count.textContent ?? '').trim(),
      countStyle: {
        background: countStyle.backgroundColor,
        paddingLeft: countStyle.paddingLeft,
        paddingRight: countStyle.paddingRight,
        fontSize: countStyle.fontSize,
        borderRadius: countStyle.borderRadius,
        lineHeight: countStyle.lineHeight,
      },
      buttons,
      order: Array.from(row.children).map((child) => `${child.tagName.toLowerCase()}.${child.className}`),
    }
  })
}

/** 行内容区的右缘（行盒右缘 − 行的右内边距）。 */
const contentRight = (entry: EntryGeometry): number => entry.row.right - entry.rowPaddingRight

/** 读数的短写（报告里的观测行与失败明细都用它）。 */
const show = (entry: EntryGeometry): string =>
  `viewport=${entry.viewport} 行=[${entry.row.left},${entry.row.right}] 内容右缘=${String(contentRight(entry))} ` +
  `主区=[${entry.main.left},${entry.main.right}] 标签=[${entry.label.left},${entry.label.right}](截断=${String(entry.labelClipped)}) ` +
  `计数=[${entry.count.left},${entry.count.right}] ` +
  entry.buttons.map((button) => `${button.name}=[${button.box.left},${button.box.right}] ${button.box.width}×${button.box.height}`).join(' ')

/** 三条右侧关系（①与②）：两枚动作贴行内容区右缘、计数紧贴动作组左侧。 */
function checkRightEdges(check: Check, entry: EntryGeometry, scope: string): void {
  const empty = entry.buttons[0]
  const restore = entry.buttons[1]
  if (empty === undefined || restore === undefined) {
    check.ok(`${scope}：两枚动作按钮都在（清空 + 恢复）`, false, show(entry))
    return
  }
  check.ok(
    `${scope} ① 恢复（最右一枚）的右缘 = 行内容区右缘（±${String(EPS)}px）：${String(restore.box.right)} vs ${String(contentRight(entry))}`,
    Math.abs(restore.box.right - contentRight(entry)) <= EPS,
    show(entry),
  )
  check.ok(
    `${scope} ① 两枚动作彼此相邻、间距 = 行内 gap ${String(entry.rowGap)}px（清空右缘 → 恢复左缘）：${String(empty.box.right)} → ${String(restore.box.left)}`,
    Math.abs(restore.box.left - empty.box.right - entry.rowGap) <= EPS,
    show(entry),
  )
  check.ok(
    `${scope} ② 计数紧贴动作组左侧（间距 = 主区右内边距 ${String(entry.mainPaddingRight)}px + 行内 gap ${String(entry.rowGap)}px = ${String(entry.mainPaddingRight + entry.rowGap)}px，旧侧栏同此——计数在**主区里面**，所以中间还隔着主区自己那 4px）：${String(entry.count.right)} → ${String(empty.box.left)}`,
    Math.abs(empty.box.left - entry.count.right - (entry.mainPaddingRight + entry.rowGap)) <= EPS,
    show(entry),
  )
  check.ok(
    `${scope} ② 标签吃满余量（主区右缘 = 清空按钮左缘 − gap）——这一条就是「顶到最右」的成因`,
    Math.abs(empty.box.left - entry.main.right - entry.rowGap) <= EPS,
    show(entry),
  )
  check.ok(
    `${scope} 行盒吃满它所在容器的宽度（width:100% 真的生效；不声明时标签没有余量可吃、计数与图标紧跟文字）`,
    entry.container !== null &&
      Math.abs(entry.row.left - entry.container.left) <= 4 &&
      Math.abs(entry.row.right - entry.container.right) <= 4,
    `row=[${String(entry.row.left)},${String(entry.row.right)}] container=${entry.container === null ? '缺' : `[${String(entry.container.left)},${String(entry.container.right)}]`}`,
  )
}

export const RECYCLE_ENTRY_ALIGN_SUITE: LabSuite = {
  id: 'F-38',
  phase: 'new-feature',
  name: '回收站入口行：清空 / 恢复贴到行最右 + 图标与尺寸按旧侧栏规格（#137，RECYCLE-ENTRY-ALIGN 套件）',
  expect:
    '真装配页（真网关**只读** + 假宿主）下的几何关系（不靠截图、不写死像素）：① **两枚动作贴到行最右**——最右一枚（恢复）的右缘 = 行盒右缘 − 行右内边距（±1px），清空紧接在它左边、间距 = 行内 gap；主区右缘 = 清空左缘 − gap，标签吃满余量；行盒吃满它所在容器（不声明 `width:100%` 时标签没有余量可吃，就是用户截图里「计数与图标紧跟文字」那一幕）。② **计数紧贴动作组左侧**——间距 = 主区右内边距 4px + 行内 gap 2px（计数在主区里面，中间隔着主区自己那 4px，旧侧栏同此）。③ **空间不足时标签用省略号截断、且不把右侧元素挤出去**——260 / 200 / 140 三档宽度下，两枚动作的右缘仍在行内容区右缘上、计数与动作组仍贴在一起；140px 下标签真被截断（`scrollWidth > clientWidth`）而右侧那一组位置不变，标签自己的右缘不超过计数左缘。④ **尺寸按旧侧栏规格**：动作按钮 26×26、按钮里的图标 14×14、主区图标 16×16、计数胶囊 10px 字 / 16px 行高 / 圆角 8px / 内边距 0 5px，行盒高 = 纵向内边距 7px + 标题档行高 20px + 7px = 34px（高度由内边距撑出，不写死），行内顺序是主区 → 清空 → 恢复。⑤ **计数 0 的灰态与禁用回归**：注入空集合时整行仍是灰态（自有类名 + 颜色降级）、计数胶囊按旧规格去掉底色与内边距、两枚动作仍禁用且仍是 `aria-label` 齐全的可聚焦按钮、主区仍可点（灰态不挡开关），右侧关系与尺寸照旧成立。全程零 pageerror，本套件不写网关。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const shot = async (page: OpenedPage['page'], name: string, clip?: { x: number; y: number; width: number; height: number }): Promise<string> => {
      const file = path.join(ctx.shots, `${name}.png`)
      await fsp.mkdir(ctx.shots, { recursive: true })
      await page.screenshot(clip === undefined ? { path: file } : { path: file, clip })
      return file
    }
    /** 只拍入口行那一块（整页截图里那一行只有十几像素高，对比时看不出关系）。 */
    const rowClip = async (page: OpenedPage['page']): Promise<{ x: number; y: number; width: number; height: number }> => {
      const box = await page.evaluate(() => {
        const row = document.querySelector('[data-dshone-tree="recycle-entry"]')
        if (row === null) return null
        const rect = row.getBoundingClientRect()
        // 官方那个 list 槽是 display:contents、矩形是 0×0，所以往上找第一个宽非 0 的祖先
        // 当横向范围（找不到就退回行自己的矩形）。
        let node: Element | null = row.parentElement
        let container: DOMRect | null = null
        while (node !== null) {
          const candidate = node.getBoundingClientRect()
          if (candidate.width > 0) {
            container = candidate
            break
          }
          node = node.parentElement
        }
        const left = container?.left ?? rect.left
        const width = container?.width ?? rect.width
        return {
          x: Math.max(0, left),
          y: Math.max(0, rect.top - 6),
          width: Math.min(window.innerWidth - Math.max(0, left), width),
          height: Math.min(window.innerHeight - Math.max(0, rect.top - 6), rect.height + 12),
        }
      })
      if (box === null) throw new Error('lab: recycle entry row is not rendered (screenshot clip)')
      return box
    }

    // ---------------------------------------------------------------------
    // 第一页：回收站有内容（网关真实会话 id 注入假宿主的 recycle-bin）——右对齐与尺寸
    // ---------------------------------------------------------------------
    const filled = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { width: 380, height: 900 })
    try {
      const { page } = filled
      await page.waitForSelector(route('sidebar').readySelector)
      const sessionId = await page.evaluate(() => {
        const row = document.querySelector('[data-dshone-tree-row="session"]')
        return row?.getAttribute('data-dshone-tree-session') ?? ''
      })
      if (sessionId === '') {
        check.ok('树里至少有一行会话可供夹具使用', false, '网关列表里没有会话行，本页的「有内容」前提不成立')
      } else {
        // 与 F-20 同一处置：注入的是旧侧栏那份文件的形状，页面打开时原样读回。
        await page.addInitScript({
          content: `(() => { globalThis.__LAB_HOST__.stateStore['recycle-bin'] = ${JSON.stringify({ version: 1, sessionIds: [sessionId] })} })()`,
        })
        await page.reload({ waitUntil: 'domcontentloaded' })
        await page.waitForSelector(route('sidebar').readySelector, { timeout: 40_000 })
        await page.waitForTimeout(2_500)
        const entry = await readEntry(page)
        check.eq('夹具生效：入口计数 1（回收站有内容那一页）', entry.countText, '1')
        check.fact(`@380：${show(entry)}`)
        check.fact(
          `@380 样式：行 gap=${String(entry.rowGap)} 行右内边距=${String(entry.rowPaddingRight)} 主区左内边距=${String(entry.mainPaddingLeft)}（= 当页行内容基准）` +
            ` 计数=${entry.countStyle.fontSize}/${entry.countStyle.lineHeight} 内边距 ${entry.countStyle.paddingLeft}/${entry.countStyle.paddingRight} 圆角 ${entry.countStyle.borderRadius}` +
            ` 按钮圆角=${entry.buttons[0]?.radius ?? ''} 子元素顺序=${entry.order.join(' | ')}`,
        )

        // ---- ① 右对齐 + ② 计数紧贴动作组 ----
        checkRightEdges(check, entry, '@380 有内容')

        // ---- ④ 尺寸按旧侧栏规格 ----
        for (const button of entry.buttons) {
          check.ok(
            `@380 ④ ${button.name}：按钮 ${String(ENTRY.actionSize)}×${String(ENTRY.actionSize)}（旧规格，= 紧凑档图标按钮 ${SCALE_TIERS.compact.iconButtonSize}），实测 ${String(button.box.width)}×${String(button.box.height)}`,
            Math.abs(button.box.width - ENTRY.actionSize) <= 0.5 && Math.abs(button.box.height - ENTRY.actionSize) <= 0.5,
            show(entry),
          )
          check.ok(
            `@380 ④ ${button.name}：按钮里的图标 ${String(ENTRY.actionIcon)}×${String(ENTRY.actionIcon)}（旧规格，= 紧凑档图标位 ${SCALE_TIERS.compact.iconSize}），实测 ${button.icon === null ? '缺' : `${String(button.icon.width)}×${String(button.icon.height)}`}`,
            button.icon !== null && Math.abs(button.icon.width - ENTRY.actionIcon) <= 0.5 && Math.abs(button.icon.height - ENTRY.actionIcon) <= 0.5,
            show(entry),
          )
          check.ok(`@380 ④ ${button.name}：有 aria-label（行为不变，读屏仍认得出）`, button.ariaLabel.trim() !== '', button.ariaLabel)
        }
        check.ok(
          `@380 ④ 主区图标 ${String(ENTRY.mainIcon)}×${String(ENTRY.mainIcon)}（旧规格，= 标准档图标位 ${SCALE_TIERS.standard.slotWidth}），实测 ${entry.mainIcon === null ? '缺' : `${String(entry.mainIcon.width)}×${String(entry.mainIcon.height)}`}`,
          entry.mainIcon !== null &&
            Math.abs(entry.mainIcon.width - ENTRY.mainIcon) <= 0.5 &&
            Math.abs(entry.mainIcon.height - ENTRY.mainIcon) <= 0.5,
          show(entry),
        )
        check.ok(
          `④ 计数胶囊 ${String(ENTRY.countFontSize)}px 字 / ${String(ENTRY.countLineHeight)}px 行高 / 圆角 ${String(ENTRY.countRadius)}px / 内边距 0 ${String(ENTRY.countPaddingInline)}px（旧规格）：实测 ${entry.countStyle.fontSize} / ${entry.countStyle.lineHeight} / ${entry.countStyle.borderRadius} / ${entry.countStyle.paddingLeft}`,
          Math.abs(Number.parseFloat(entry.countStyle.fontSize) - ENTRY.countFontSize) <= 0.5 &&
            Math.abs(Number.parseFloat(entry.countStyle.lineHeight) - ENTRY.countLineHeight) <= 0.5 &&
            Math.abs(Number.parseFloat(entry.countStyle.borderRadius) - ENTRY.countRadius) <= 0.5 &&
            Math.abs(Number.parseFloat(entry.countStyle.paddingLeft) - ENTRY.countPaddingInline) <= 0.5,
          JSON.stringify(entry.countStyle),
        )
        check.ok(
          `④ 行盒高 = 纵向内边距 ${String(ENTRY.mainPaddingBlock)}px + 标题档行高 ${SCALE_TIERS.standard.titleLineHeight} + ${String(ENTRY.mainPaddingBlock)}px = ${String(2 * ENTRY.mainPaddingBlock + Number.parseFloat(SCALE_TIERS.standard.titleLineHeight))}px（旧规格撑出来的，不写死）：实测 ${String(entry.row.height)}`,
          Math.abs(entry.row.height - (2 * ENTRY.mainPaddingBlock + Number.parseFloat(SCALE_TIERS.standard.titleLineHeight))) <= EPS,
          show(entry),
        )
        check.ok(
          `④ 主区纵向内边距 ${String(ENTRY.mainPaddingBlock)}px / 右 ${String(ENTRY.mainPaddingRight)}px（旧规格 ` +
            '`7px 4px 7px <行内容基准>`）：实测 ' +
            `${String(entry.mainPaddingTop)} / ${String(entry.mainPaddingRight)}；左内边距 ${String(entry.mainPaddingLeft)}px 走行内容基准（#125 的竖线，由 F-30 钉）`,
          Math.abs(entry.mainPaddingTop - ENTRY.mainPaddingBlock) <= 0.5 &&
            Math.abs(entry.mainPaddingRight - ENTRY.mainPaddingRight) <= 0.5,
          show(entry),
        )
        check.ok(
          '④ 行内顺序 = 主区 → 清空 → 恢复（两枚动作在主区右侧，不是插在文字后面）',
          entry.order.length === 3 &&
            entry.order[0]?.includes('dshOneTree_footerMain') === true &&
            entry.buttons[0]?.name === 'recycle-empty-all' &&
            entry.buttons[1]?.name === 'recycle-restore-all' &&
            (entry.buttons[0]?.box.left ?? 0) >= (entry.main.right ?? 0) &&
            (entry.buttons[1]?.box.left ?? 0) >= (entry.buttons[0]?.box.right ?? 0),
          entry.order.join(' | '),
        )
        check.fact(
          '④ 与档位表同值的几项（旧规格值 = 档位表里的同名量）：按钮 26px = 紧凑档图标按钮、图标 14px = 紧凑档图标位、主区图标 16px = 标准档图标位、行内间隙 2px = 标准档行间距、行右内边距 8px = 标准档行内边距',
        )
        screenshots.push(await shot(page, 'recycle-entry-align-filled-380', await rowClip(page)))

        // ---- ③ 窄宽度：标签截断但不把右侧挤出去 ----
        for (const width of [260, 200, 140]) {
          await page.setViewportSize({ width, height: 900 })
          await page.waitForTimeout(300)
          const narrow = await readEntry(page)
          const empty = narrow.buttons[0]
          const restore = narrow.buttons[1]
          check.fact(`w=${String(width)}：${show(narrow)}`)
          checkRightEdges(check, narrow, `w=${String(width)}`)
          check.ok(
            `w=${String(width)} ③ 标签在空间不足时用省略号截断的机制在（text-overflow=ellipsis / overflow=hidden / white-space=nowrap / min-width=0）`,
            narrow.labelStyle.textOverflow === 'ellipsis' &&
              narrow.labelStyle.overflow === 'hidden' &&
              narrow.labelStyle.whiteSpace === 'nowrap' &&
              narrow.labelStyle.minWidth === '0px',
            JSON.stringify(narrow.labelStyle),
          )
          if (narrow.labelClipped && empty !== undefined && restore !== undefined) {
            check.ok(
              `w=${String(width)} ③ 标签真被截断（scrollWidth > clientWidth），且右侧那一组没被挤出：标签右缘 ${String(narrow.label.right)} ≤ 计数左缘 ${String(narrow.count.left)}`,
              narrow.label.right <= narrow.count.left + EPS,
              show(narrow),
            )
            check.ok(
              `w=${String(width)} ③ 截断时两枚动作仍在行内容区右缘上（不因标签被挤而位移）`,
              Math.abs(restore.box.right - contentRight(narrow)) <= EPS,
              show(narrow),
            )
            screenshots.push(await shot(page, `recycle-entry-align-narrow-${String(width)}`, await rowClip(page)))
          } else if (width === 260) {
            // 260px 下标签还没到要截断的程度（入口文案只有三个字）：如实记一笔，机制那一条
            // 已经钉住；真截断的情形由更窄的那两档覆盖。
            check.fact(`w=${String(width)} ③ 这一档宽度下标签没到截断的程度（文案短），实测未截断`)
          }
        }
      }
      check.eq('有内容那一页全程零 pageerror', withoutKnownNoise(filled.capture.pageErrors).real, [])
    } finally {
      await filled.context.close()
    }

    // ---------------------------------------------------------------------
    // 第二页：空集合（计数 0）——灰态、禁用、胶囊去底色（旧规格的 is-empty），右侧关系照旧
    // ---------------------------------------------------------------------
    const empty = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), {
      width: 340,
      height: 900,
      state: { 'recycle-bin': { version: 1, sessionIds: [] } },
    })
    try {
      const { page } = empty
      const entry = await readEntry(page)
      check.eq('夹具的空集合真的被读到了（入口计数 0）', entry.countText, '0')
      check.fact(`@340 计数 0：${show(entry)}；胶囊底色=${entry.countStyle.background} 内边距=${entry.countStyle.paddingLeft}/${entry.countStyle.paddingRight}`)
      const rowEmptyClass = await page.evaluate(
        () => document.querySelector('[data-dshone-tree="recycle-entry"]')?.className ?? '',
      )
      check.ok(
        '⑤ 计数 0 时整行仍是灰态（自有类名 dshOneTree_footerRowEmpty 在，颜色降级也在这条规则里）',
        rowEmptyClass.includes('dshOneTree_footerRowEmpty'),
        rowEmptyClass,
      )
      check.ok(
        '⑤ 计数 0 时两枚动作仍禁用（没有东西可清、也没有东西可还原）',
        entry.buttons.length === 2 && entry.buttons.every((button) => button.disabled),
        entry.buttons.map((button) => `${button.name}=${String(button.disabled)}`).join(' '),
      )
      check.ok(
        '⑤ 计数 0 时计数胶囊按旧规格去掉底色与内边距（`is-empty` 的写法）',
        entry.countStyle.background === 'rgba(0, 0, 0, 0)' && entry.countStyle.paddingLeft === '0px' && entry.countStyle.paddingRight === '0px',
        JSON.stringify(entry.countStyle),
      )
      check.ok(
        '⑤ 计数 0 时主区仍可点（灰态不挡开关）',
        await page.evaluate(() => {
          const main = document.querySelector('[data-dshone-tree-action="recycle-toggle"]') as HTMLButtonElement | null
          return main !== null && !main.disabled && (main.getAttribute('aria-label') ?? '').trim() !== ''
        }),
      )
      // 灰态下右侧关系照旧（灰态不是另一套布局）。
      checkRightEdges(check, entry, '@340 计数 0')
      check.ok(
        '⑤ 计数 0 时尺寸不变（按钮仍 26×26，胶囊仍 10px/16px）',
        entry.buttons.every((button) => Math.abs(button.box.width - ENTRY.actionSize) <= 0.5) &&
          Math.abs(Number.parseFloat(entry.countStyle.fontSize) - ENTRY.countFontSize) <= 0.5,
        show(entry),
      )
      screenshots.push(await shot(page, 'recycle-entry-align-empty-340', await rowClip(page)))
      check.eq('计数 0 那一页全程零 pageerror', withoutKnownNoise(empty.capture.pageErrors).real, [])
    } finally {
      await empty.context.close()
    }
    return screenshots
  },
}
