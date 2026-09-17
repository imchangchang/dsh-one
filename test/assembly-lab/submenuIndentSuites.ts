/**
 * 二级菜单（就地展开的子项）的缩进与父项右端的指示器（#126 立、#143 收到 0、#167 按旧侧栏
 * 那一档取回一位、#171 取那一档的一半、#174 收到底 0 并保留空图标槽；#172 把父项那个 ▸/▾
 * 文字字形换成官方两枚 14 档 chevron 并右端对齐项的内容右缘）。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与 `driftSuites.ts` / `recycleEntrySuites.ts` /
 * `selectionBarSuites.ts` 同一条：那个文件是本批开发的合入热点，新套件放外面能少一半冲突面。
 * 注册方式是在 `suites.ts` 的 `SUITES` 末尾追加一项。
 *
 * 期望值**不硬编码**：子项那条左内边距与它带出来的两个关系量都从 `workspaceTree/styles.ts`
 * 的 `SCALE_TIERS.compact` 里读（`rowPaddingInline` / `iconSize` / `rowGap`）——档位表改了值，
 * 本套件跟着走。指示器那一组也一样：边长取 `iconSize`、与文字的间距取 `rowGap`，只有两枚
 * 官方 chevron 的**名字与 path 数据**是常量（它们是官方图标件的产物，档位表管不到，出处写在
 * {@link CHEVRON} 上方）。
 *
 * 断言的口径是**关系不变量**（#126 / #143 / #167 / #171 / #174 / #172 正文），而不是某个绝对坐标（绝对坐标会随
 * 菜单在屏幕上的位置变）：#174 起子项文字左缘 − 父项文字左缘 = **0**（子项整行的左内边距与父项
 * 同值 = 紧凑档的一个项内边距），并钉住「不许深过旧侧栏那一档」这条回归。同时钉住三件容易
 * 一起坏掉的观感：子项自己的图标与文字仍然相邻（不因为缩进脱开）、所有子项的文字落在同一列
 * （有没有图标都一样）、勾选态 ✓ 的几何不受影响，以及 **#172 的指示器**——官方那两枚（按渲染
 * 指纹核）、边长落在档位表那一档、**右缘对齐到项的内容右缘**、与文字之间留着一个项内间隙，
 * 两态（收起/展开）与三档宽度（260/340/500）各判一遍，窄档下再拿一条长标题压力夹具证明
 * 「该让位的是文字」。
 *
 * 数据面：真实网关**只读** + 假宿主 + 树层注入的分组状态（`groups`）与标签组状态（`tags`）。
 * 归档确认、新建会话这类会写网关的动作一律不碰。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { openTreePage, withoutKnownNoise, type Check, type OpenedPage } from './harness.ts'
import { LAB_TREES, type LabTreeRoute } from './labServer.ts'
import { SCALE_TIERS } from '../../packages/dsh-workspace-tree/src/workspaceTree/styles.ts'
// 只取类型（编译后不留 import，运行期没有环）：套件接口定义在 suites.ts 里。
import type { LabSuite } from './suites.ts'

const route = (name: string): LabTreeRoute => {
  const found = LAB_TREES.find((candidate) => candidate.route === name)
  if (found === undefined) throw new Error(`lab: unknown tree route ${name}`)
  return found
}

/** 紧凑档的项内边距（7px，官方 `._item_1nxmc_92{padding:3px 7px}`）。 */
const ROW_PADDING_INLINE = Number.parseFloat(SCALE_TIERS.compact.rowPaddingInline)

/**
 * 旧侧栏那一档的缩进（一个图标槽 = 紧凑档的 `iconSize` 14px）。本套件只拿它当**上界**用：
 * 回归钉子判「不许深过旧侧栏那一档」。
 *
 * 出处：旧侧栏（正本）实测的那条关系就是这一个数——它的子项比父项多让开一位，正好等于它
 * 自己那个 14px 的图标槽宽（读数见 `test/legacy-sidebar/` 台账的 `submenu-text-vs-parent-text`：
 * 旧 +14）。
 */
const LEGACY_TIER_INDENT = Number.parseFloat(SCALE_TIERS.compact.iconSize)

/**
 * 子项整行的左内边距（#174）= **紧凑档的一个项内边距**（`rowPaddingInline`，与父项整行同一个值，
 * 本身就是档位表里的那一个量）——也就是「不再额外缩进」；报告与诊断里用它。
 */
const SUBMENU_PADDING_INLINE = ROW_PADDING_INLINE

/**
 * 期望的缩进量（#174）：**0**——子项文字与父项文字落在同一条竖线上（「与父项严格对齐」）。
 *
 * 不写死：它是上面两个量的差（子项整行的左内边距 − 父项整行的左内边距），两个都从
 * `SCALE_TIERS.compact` 读。算式（每一项都出在官方紧凑档，出处见 styles.ts 那条规则上方）：
 *   子项文字左缘 = 子项左内边距 7 + 空图标槽 14 + 项内间隙 6 = 27
 *   父项文字左缘 = 父项左内边距 7 + 图标槽 14 + 项内间隙 6 = 27
 * 历史：#143 曾收到 0（用户看下来「层级没了」）、#167 取回旧侧栏那一档（一个图标槽 14px）、
 * #171 取那一档的一半（7px）而用户看着**仍觉得偏大**——真因是子项文字左边那段空白大半来自
 * rows.ts 补的**空图标槽**（14 + 项内间隙 6 = 20px），多让开的那半格只是最后一小步，
 * 所以 #174 收到底取 0，空图标槽**保留**（去掉它子项文字会跑到父项图标那一列）。
 */
const EXPECTED_INDENT = SUBMENU_PADDING_INLINE - ROW_PADDING_INLINE

/**
 * 二级菜单父项右端的指示器（#172）：**官方那两枚 14 档 chevron**，名字与路径数据取自官方
 * primitives 的导出与定义（本机官方前端 `index-C04Zg7TP.js` 里的 `IconChevronRightOutline14` /
 * `IconChevronDownOutline14`：`width/height` 默认 14、`viewBox="0 0 14 14"`、各一条 path）。
 *
 * 路径写在这里当**渲染指纹**用：官方组件渲染出来的 DOM 里只有 svg，认「用的是哪一枚」只能
 * 比这些字节。改官方版本导致路径变了，这两条先红——那时按官方新路径改这一处即可（图标件本身
 * 是官方承诺的导出，不会悄悄换形状）。
 */
const CHEVRON = {
  collapsed: {
    name: 'IconChevronRightOutline14',
    path:
      'M5.5 2.15137L5.92383 2.57617L8.65137 5.30273C8.90706 5.55843 9.13382 5.78438 9.29785 5.98828C9.46883 6.20088 9.61756 6.44405 9.66602 6.75C9.69222 6.91565 9.69222 7.08435 9.66602 7.25C9.61756 7.55595 9.46883 7.79912 9.29785 8.01172C9.13382 8.21561 8.90706 8.44157 8.65137 8.69727L5.92383 11.4238L5.5 11.8486L4.65137 11L5.07617 10.5762L7.80273 7.84863C8.07732 7.57405 8.24849 7.40124 8.3623 7.25977C8.46904 7.12709 8.47813 7.07728 8.48047 7.0625C8.48703 7.02105 8.48703 6.97895 8.48047 6.9375C8.47813 6.92272 8.46904 6.87291 8.3623 6.74023C8.24848 6.59876 8.07732 6.42595 7.80273 6.15137L5.07617 3.42383L4.65137 3L5.5 2.15137Z',
  },
  expanded: {
    name: 'IconChevronDownOutline14',
    path:
      'M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z',
  },
} as const

/** 指示器该有的边长 = **菜单项图标那一档**（紧凑档 `iconSize` 14px；期望值从档位表读）。 */
const INDICATOR_SIZE = Number.parseFloat(SCALE_TIERS.compact.iconSize)

/** 指示器与文字之间至少要留的那一格 = 紧凑档的项内间隙（`SCALE_TIERS.compact.rowGap` 6px）。 */
const INDICATOR_TEXT_GAP = Number.parseFloat(SCALE_TIERS.compact.rowGap)

/** 右端对齐的容差（±1px，与套件里其它几何关系同一条）。 */
const ALIGN_TOLERANCE = 1

/** 菜单项的一条几何事实（页面侧一次量完，避免多次 round-trip 之间的抖动）。 */
interface ItemGeometry {
  marker: string
  text: string
  /** 项盒子（官方那个 `<button role="menuitem">`）的左缘 / 右缘 / 宽。 */
  itemLeft: number
  itemRight: number
  itemWidth: number
  /** 文字左缘（项里那个带自有标记的 span 的几何矩形）。 */
  labelLeft: number
  /** 图标槽的左缘与右缘（官方 14×14 的盒子；没有图标时是补上的空槽）。 */
  iconLeft: number | null
  iconRight: number | null
  /** 文字左缘 − 图标槽右缘（应当还是紧凑档的项内间隙 6px）。 */
  iconTextGap: number | null
  /** 右端勾（官方 selectedIds 或画在图标槽里的 ✓）的右缘；没有就是 null。 */
  checkRight: number | null
  /** 项里的子元素个数（官方渲染：图标槽 + 文字 + 可选勾）。 */
  childCount: number
  /** 文字外层是不是我们包的那一层（`.dshOneTree_submenuItem`）。 */
  indentWrapped: boolean
  /** 项自己那条左内边距（解析后的值，如 `7px`）——子项的文字列就落在这里，靠它钉住取值（#174 起与父项同值）。 */
  paddingLeft: string
  /** 子项归属勾选态（`data-dshone-group-checked`，工作区菜单的子项才带）。 */
  checked: string | null
  /**
   * 项的内容右缘 = 官方 label 那一格（`._itemLabel_1nxmc_174`）的右缘（#172）。
   *
   * 为什么要它而不是「项盒右缘 − 右内边距」：官方项是一条「图标槽 + label + 可选勾」的
   * 流水线，带勾时 label 的右缘并不是项的内容右缘（勾占掉一格）。指示器该贴的那条线是
   * **label 的右缘**，所以直接量 label 那一格（按「button 的子 span 里含我们那个标记 span
   * 的那一个」认，不认官方哈希类名）。
   */
  contentRight: number | null
}

/** 父项右端指示器的几何与渲染指纹（#172：两个文字字形换成官方那两枚 14 档 chevron）。 */
interface IndicatorGeometry {
  left: number
  right: number
  width: number
  height: number
  /** `data-dshone-tree-icon` 标记（自有契约，写出用的是官方哪一枚）。 */
  name: string
  /** 渲染指纹：官方图标渲染出来的 svg（视框 / 画成多大 / 每条形状的 `path@d`）。 */
  fingerprint: { viewBox: string; width: string; height: string; shapes: string[] } | null
}

/** 父项文字那一格的几何（#172 量「指示器与文字之间留了多远」用）。 */
interface ParentTextGeometry {
  /** 文字**真实**的右缘（Range 取内容盒）。盒子右缘会因为吃满余量而贴在指示器上，量不出间距。 */
  textRight: number
  /** 文字那一格的盒子右缘（文字被截断时它就等于指示器的左缘）。 */
  boxRight: number
  /** 文字真的在走省略号（滚出来的宽 > 画得下的宽）——该让位的是文字，不是指示器。 */
  truncating: boolean
  /** 文字那一格的右内边距（被截断时，省略号与指示器之间的那一格就是它）。 */
  paddingRight: number
}

interface SubmenuGeometry {
  /** 页面上开着的菜单个数（就地展开不新增菜单，所以始终是 1）。 */
  menuCount: number
  parent: ItemGeometry | null
  children: ItemGeometry[]
  /** 父项右端那个指示器的几何与指纹（量「只换图标、几何不变」与「右端对齐」用）。 */
  arrow: IndicatorGeometry | null
  /** 父项文字那一格的几何（量「与文字的距离」用）。 */
  parentText: ParentTextGeometry | null
}

/**
 * 量一次「父项 + 就地展开的子项」的几何。
 *
 * 只按自有标记取元素（`data-dshone-tree-item` / `.dshOneTree_submenuItem`），不认官方
 * css-module 的哈希类名；图标槽按「项里那个不含文字标记的 span」认（官方项的结构是
 * 「图标槽 span + 文字 span + 可选勾」，见 rows.ts 里 indentSubmenuItem 的说明）。
 */
async function submenuGeometry(
  page: OpenedPage['page'],
  spec: { parent: string; childPrefix: string },
): Promise<SubmenuGeometry> {
  return page.evaluate((s: { parent: string; childPrefix: string }) => {
    const menus = Array.from(document.querySelectorAll('[role="menu"]'))
    const menu: Element | null = menus.length === 0 ? null : (menus[menus.length - 1] ?? null)
    const read = (mark: Element | null): ItemGeometry | null => {
      if (mark === null) return null
      const button = mark.closest('button[role="menuitem"]')
      if (button === null) return null
      const item = button.getBoundingClientRect()
      const label = mark.getBoundingClientRect()
      const iconBox = Array.from(button.children).find((child) => child.tagName === 'SPAN' && !child.contains(mark)) ?? null
      const icon = iconBox === null ? null : iconBox.getBoundingClientRect()
      const check = Array.from(button.children).find((child) => child.tagName !== 'SPAN') ?? null
      // 官方 label 那一格 = button 的子 span 里含我们那个标记 span 的那一个（不认官方哈希类名）。
      const labelWrap = Array.from(button.children).find((child) => child.tagName === 'SPAN' && child.contains(mark)) ?? null
      return {
        marker: mark.getAttribute('data-dshone-tree-item') ?? '',
        text: (mark.textContent ?? '').trim(),
        itemLeft: item.left,
        itemRight: item.right,
        itemWidth: item.width,
        labelLeft: label.left,
        iconLeft: icon === null ? null : icon.left,
        iconRight: icon === null ? null : icon.right,
        iconTextGap: icon === null ? null : label.left - icon.right,
        checkRight: check === null ? null : check.getBoundingClientRect().right,
        childCount: button.children.length,
        indentWrapped: mark.closest('.dshOneTree_submenuItem') !== null,
        paddingLeft: getComputedStyle(button).paddingLeft,
        checked: mark.getAttribute('data-dshone-group-checked'),
        contentRight: labelWrap === null ? null : labelWrap.getBoundingClientRect().right,
      }
    }
    const parentMark = menu === null ? null : menu.querySelector(`[data-dshone-tree-item="${s.parent}"]`)
    // 父项文字那一格：真实字末用 Range 取（盒子右缘吃满余量时会贴在指示器上，量不出间距）。
    const parentLabel = parentMark === null ? null : parentMark.querySelector('.dshOneTree_submenuParentLabel')
    const parentText =
      parentLabel === null
        ? null
        : (() => {
            const range = document.createRange()
            range.selectNodeContents(parentLabel)
            const textRect = range.getBoundingClientRect()
            const box = parentLabel.getBoundingClientRect()
            return {
              textRight: textRect.width === 0 ? box.right : textRect.right,
              boxRight: box.right,
              truncating: parentLabel.scrollWidth > parentLabel.clientWidth + 1,
              paddingRight: Number.parseFloat(getComputedStyle(parentLabel).paddingRight) || 0,
            }
          })()
    const arrowElement = menu === null ? null : menu.querySelector('.dshOneTree_submenuArrow')
    const children =
      menu === null
        ? []
        : Array.from(menu.querySelectorAll('[data-dshone-tree-item]'))
            .filter((mark) => (mark.getAttribute('data-dshone-tree-item') ?? '').startsWith(s.childPrefix))
            .map((mark) => read(mark))
            .filter((entry): entry is ItemGeometry => entry !== null)
    return {
      menuCount: menus.length,
      parent: read(parentMark),
      children,
      parentText,
      arrow:
        arrowElement === null
          ? null
          : (() => {
              const box = arrowElement.getBoundingClientRect()
              const svg = arrowElement.querySelector('svg')
              return {
                left: box.left,
                right: box.right,
                width: box.width,
                height: box.height,
                name: arrowElement.getAttribute('data-dshone-tree-icon') ?? '',
                fingerprint:
                  svg === null
                    ? null
                    : {
                        viewBox: svg.getAttribute('viewBox') ?? '',
                        width: svg.getAttribute('width') ?? '',
                        height: svg.getAttribute('height') ?? '',
                        shapes: Array.from(svg.querySelectorAll('path,rect,circle')).map((shape) => shape.getAttribute('d') ?? ''),
                      },
              }
            })(),
    }
  }, spec)
}

/**
 * 判一遍父项右端那个指示器（#172）：用在两态、三档宽度、以及窄档的长标题压力夹具上，判据一处
 * 定义、多处跑。
 *
 * 五条：① 在场且用的是官方那一枚（`data-dshone-tree-icon` 写出的图标名）；② 渲染指纹是官方那枚
 * 14 号图标（视框 / 画成的尺寸 / 单条 path 且 `path@d` 与官方定义逐字相同）；③ 边长落在档位表的
 * 菜单项图标那一档；④ **右缘对齐到项的内容右缘**（官方 `alignEnd` 的语义，±1px）；⑤ 与文字之间
 * 留着至少一个项内间隙（用户报的「紧贴文字」不再成立）。另加一条「指示器整个落在项里」。
 */
function checkIndicator(
  check: Check,
  where: string,
  reading: SubmenuGeometry,
  expected: (typeof CHEVRON)[keyof typeof CHEVRON],
): void {
  const { arrow, parent, parentText } = reading
  const fingerprint = arrow?.fingerprint ?? null
  check.eq(`${where}：指示器用的是官方那一枚（自有标记写出的图标名）`, arrow?.name ?? '（指示器不在场）', expected.name)
  check.ok(
    `${where}：渲染指纹是官方那枚 14 号图标（视框 0 0 14 14、画成 14×14、单条 path 且 path@d 与官方定义逐字相同）`,
    fingerprint !== null &&
      fingerprint.viewBox === '0 0 14 14' &&
      fingerprint.width === '14' &&
      fingerprint.height === '14' &&
      fingerprint.shapes.length === 1 &&
      fingerprint.shapes[0] === expected.path,
    JSON.stringify(fingerprint),
  )
  check.ok(
    `${where}：指示器边长落在档位表的菜单项图标那一档（${String(INDICATOR_SIZE)}px，±${String(ALIGN_TOLERANCE)}）`,
    arrow !== null && Math.abs(arrow.width - INDICATOR_SIZE) <= ALIGN_TOLERANCE && Math.abs(arrow.height - INDICATOR_SIZE) <= ALIGN_TOLERANCE,
    arrow === null ? '指示器不在场' : `宽 ${arrow.width.toFixed(1)} 高 ${arrow.height.toFixed(1)}`,
  )
  check.ok(
    `${where}：指示器右缘对齐到菜单项的内容右缘（官方 alignEnd 的语义，±${String(ALIGN_TOLERANCE)}px）`,
    arrow !== null && parent !== null && parent.contentRight !== null && Math.abs(arrow.right - parent.contentRight) <= ALIGN_TOLERANCE,
    `指示器右缘=${arrow?.right.toFixed(1) ?? '无'} 内容右缘=${parent?.contentRight?.toFixed(1) ?? '无'} 项盒右缘=${parent?.itemRight.toFixed(1) ?? '无'}`,
  )
  // 「文字的右缘」在两种情形下不是同一个读数：文字装得下时取 Range 量到的**真实字末**（盒子
  // 右缘会因为吃满余量而贴在指示器上，量不出间距）；文字被截断时 Range 量到的仍是**溢出**出去
  // 的那一段（比可见的字末更靠右），可见的字末其实是文字那一格的内容右缘——也就是
  // 「盒子右缘 − 右内边距」（省略号画在那里）。
  const textEnd =
    parentText === null ? null : parentText.truncating ? parentText.boxRight - parentText.paddingRight : parentText.textRight
  check.ok(
    `${where}：指示器与文字之间留着至少一个项内间隙（${String(INDICATOR_TEXT_GAP)}px）——不再是紧贴文字`,
    arrow !== null && textEnd !== null && arrow.left - textEnd >= INDICATOR_TEXT_GAP - ALIGN_TOLERANCE,
    `指示器左缘=${arrow?.left.toFixed(1) ?? '无'} 可见字末=${textEnd?.toFixed(1) ?? '无'}` +
      `（Range 字末=${parentText?.textRight.toFixed(1) ?? '无'}，文字那一格${parentText?.truncating === true ? '在走省略号' : '没被截'}）`,
  )
  check.ok(
    `${where}：指示器整个落在项里（左缘不越出项盒、右缘不越出项盒）`,
    arrow !== null && parent !== null && arrow.left >= parent.itemLeft - 0.5 && arrow.right <= parent.itemRight + 0.5,
    arrow === null || parent === null
      ? '读数缺'
      : `指示器=${arrow.left.toFixed(1)}~${arrow.right.toFixed(1)} 项盒=${parent.itemLeft.toFixed(1)}~${parent.itemRight.toFixed(1)}`,
  )
}

/** 当前最后一个菜单里顶层项的标记（子项与标题行不算，与 F-19 的口径一致）。 */
async function topLevelMarkers(page: OpenedPage['page']): Promise<string[]> {
  return page.evaluate(() => {
    const menus = Array.from(document.querySelectorAll('[role="menu"]'))
    const menu = menus.length === 0 ? null : (menus[menus.length - 1] ?? null)
    if (menu === null) return []
    return Array.from(menu.querySelectorAll('button[role="menuitem"]'))
      .map((button) => button.querySelector('[data-dshone-tree-item]'))
      .filter((mark): mark is Element => mark !== null)
      .map((mark) => mark.getAttribute('data-dshone-tree-item') ?? '')
      .filter((marker) => marker !== 'menu-title' && !marker.startsWith('tag:') && marker !== 'workspace-group-item')
  })
}

/** 树里第一条带 ⋯ 的会话行（及其所属工作区键）。 */
async function sessionFixture(page: OpenedPage['page']): Promise<{ key: string; id: string; members: string[] } | null> {
  return page.evaluate(() => {
    for (const section of Array.from(document.querySelectorAll('[data-dshone-group-key]'))) {
      const rows = Array.from(section.querySelectorAll('[data-dshone-tree-row="session"]')).filter(
        (row) => row.querySelector('[data-dshone-tree-action="session-menu"]') !== null,
      )
      if (rows.length >= 3) {
        const at = (index: number): string => rows[index]?.getAttribute('data-dshone-tree-session') ?? ''
        return { key: section.getAttribute('data-dshone-group-key') ?? '', id: at(0), members: [at(1), at(2)] }
      }
    }
    return null
  })
}

/** 假宿主的状态存储（与 F-19 的 `hostState` 同一读法，只是本文件自带一份，免动热点文件）。 */
async function hostState(page: OpenedPage['page'], key: string): Promise<unknown> {
  return page.evaluate((name: string) => {
    const host = (globalThis as unknown as { __LAB_HOST__?: { stateStore?: Record<string, unknown> } }).__LAB_HOST__
    const store = host?.stateStore ?? {}
    const readKey = Object.keys(store).find((candidate) => candidate === name || candidate.endsWith(`/${name}`)) ?? name
    const value = store[readKey]
    return typeof value === 'string' ? JSON.parse(value) : value
  }, key)
}

/** 展开一行的工作区（工作区行收起时里面的会话不渲染），点它一次即展开。 */
async function expandAllWorkspaces(page: OpenedPage['page']): Promise<void> {
  await page.evaluate(() => {
    for (const row of Array.from(document.querySelectorAll('[data-dshone-tree-row="workspace"]'))) {
      if (row.getAttribute('aria-expanded') !== 'true') (row as HTMLElement).click()
    }
  })
  await page.waitForTimeout(400)
}

/** 开某一行的 ⋯ 菜单（行操作悬停才显形，所以先 hover）。 */
async function openSessionMenu(page: OpenedPage['page'], sessionId: string): Promise<void> {
  const row = page.locator(`[data-dshone-tree-session="${sessionId}"]`)
  await row.hover()
  await row.locator('[data-dshone-tree-action="session-menu"]').click()
  await page.waitForTimeout(250)
}

/**
 * 页面上当前第一条能开 ⋯ 菜单的会话行（#172 的宽度那一段要用）。
 *
 * 为什么每次都重新找、不用夹具那一条：这一段的判据与「是哪一条会话」无关，而共享网关上有别的
 * session 在同时干活（会话可能被挪走 / 归档 / 换分组），盯死起手那一条会在别人动数据时红——
 * 那是环境噪，不是这一条要判的东西。找不到就退回夹具那一条（真的没有行时它会硬红）。
 */
async function anySessionRow(page: OpenedPage['page'], fallback: string): Promise<string> {
  const found = await page.evaluate(
    () =>
      document.querySelector('[data-dshone-tree-row="session"] [data-dshone-tree-action="session-menu"]')?.closest('[data-dshone-tree-row="session"]')?.getAttribute('data-dshone-tree-session') ?? '',
  )
  return found === '' ? fallback : found
}

/** 行右键开同一份菜单（工作区行没有 ⋯ 按钮，只能用右键那一份）。 */
async function openRowContextMenu(page: OpenedPage['page'], selector: string): Promise<boolean> {
  const row = page.locator(selector)
  const box = await row.boundingBox()
  if (box === null) return false
  await row.click({ button: 'right', position: { x: 80, y: Math.round(box.height / 2) } })
  await page.waitForTimeout(300)
  return true
}

/**
 * 二级菜单（就地展开的子项）的缩进与父项右端的指示器（#126 立 / #143 收到 0 / #167 取回一位 /
 * #171 取一半 / #174 收到底 0 / #172 换官方 chevron）。
 * 量的是**关系不变量**：子项文字左缘 − 父项文字左缘 = **0**（±1px；= 子项整行左内边距与父项同值），
 * 并钉住「不许深过旧侧栏那一档」这条回归——两个菜单各量一遍；
 * 另钉子项的图标与文字仍相邻、所有子项落在同一列、子项图标槽与父项同列、✓ 的几何不受影响，
 * 以及 #172 那一组（指示器用的是官方哪一枚、边长落档、右缘对齐项的内容右缘、与文字留着一个项内
 * 间隙，两态 × 三档宽度 + 窄档长标题），还有「没有标签组时的缺席」与「二级项点击不关菜单、
 * ✓ 就地翻转」两条既有行为。
 */
export const SUBMENU_INDENT_SUITE: LabSuite = {
  id: 'F-32',
  phase: 'new-feature',
  name: '二级菜单的缩进与父项指示器（#126 立 / #143 收到 0 / #167 取回一位 / #171 取一半 / #174 收到底 0 / #172 换官方两枚 chevron 并右端对齐）：子项文字与父项文字严格对齐、不许深过旧侧栏那一档，父项右端的指示器右缘贴到项的内容右缘（会话菜单与工作区菜单同一口径，SUBMENU-INDENT 套件）',
  expect: `二级菜单（会话菜单的「移到分组…」与工作区菜单的「分组…」就地展开出来的子项）在真实装配页上（真网关**只读** + 假宿主 + 注入的分组状态与标签组状态）量关系不变量，不量绝对坐标：① **会话菜单**：子项文字左缘 − 父项文字左缘 = ${String(EXPECTED_INDENT)}px（±1px）——子项整行的左内边距 = 紧凑档的项内边距（${SCALE_TIERS.compact.rowPaddingInline}，**一个**，与父项整行同值），接着那个空图标槽与项内间隙（${SCALE_TIERS.compact.rowGap}）与父项自己那串逐项同值，所以子项文字与父项文字落在**同一条竖线**上（旧侧栏（正本）同一条关系实测是 +14px = 一个图标槽；#143 收到 0、#167 取回那一档、#171 取它的一半 = 7px 而用户看过仍觉得偏大——真因是子项文字左边那段空白大半来自空图标槽（14 + 6 = 20px），多让开的那半格只是最后一小步，读数见 legacy-sidebar 台账；期望值全从 styles.ts 的 SCALE_TIERS 读，不写死）；**回归钉子**：子项文字比父项文字深不超过**旧侧栏那一档**（一个图标槽 ${SCALE_TIERS.compact.iconSize}；#143 之前是深两个图标槽 = 20px，用户报的就是它），并且子项整行的左内边距实测就是档位表那一项；② **工作区菜单**同一 helper，量同一条关系（含同一枚回归钉子），读数与①一致；③ **父项右端的指示器（#172）**——收起态是官方的 ${CHEVRON.collapsed.name}、展开态是 ${CHEVRON.expanded.name}：按**渲染指纹**核（视框 \`0 0 14 14\`、画成 14×14、单条 path 且 \`path@d\` 与官方定义逐字相同）+ 自有标记 \`data-dshone-tree-icon\` 写出的图标名；边长落在档位表的**菜单项图标那一档**（紧凑档 \`iconSize\` ${SCALE_TIERS.compact.iconSize}，±1px）；**右缘对齐到菜单项的内容右缘**（官方 \`alignEnd\` 的语义，取「官方 label 那一格的右缘」这条线，±1px）；与文字之间留着**至少一个项内间隙**（紧凑档 ${SCALE_TIERS.compact.rowGap}）——用户报的「箭头太小、且紧贴文字」两条都在这里钉住；两态各判一遍，再在**三档宽度（260 / 340 / 500）**下各判一遍，最后在 260px 上挂一条**长标题压力夹具**（只改页面上那一处文字）：走省略号的是**文字那一格**（\`scrollWidth > clientWidth\`），指示器仍贴那条内容右缘、仍从文字那一格的右缘起算（那一格自带一个项内间隙的右内边距），没有被官方 label 的 \`overflow:hidden\` 切掉；④ **没有标签组 / 没有自定义分组时的缺席**——会话菜单的「移到分组…」恒在场（一个组都没有时也渲染，不然新建第一个组没有入口，出处是 tree.ts 里那一节的注释），所以这一侧断的是「标签组那几条子项一条都不出现、只剩两条固定入口（不归入标签组 / 新建标签组）」，而工作区菜单的「分组…」在没有自定义分组时**整项不渲染**；**有**组时父项点一下展开、再点一下收起、菜单两次都还开着（父项行为不变）；⑤ **二级项点击不关菜单、✓ 就地翻转**（回归）：工作区菜单的子项点一下就勾上（菜单仍开着、文字列一分不动），再点一下取消；会话菜单的子项点完后那一行会搬进对应标签组（行换父节点 → 菜单跟着收起，这是既有行为），重开菜单时该项带官方 ✓、文字仍落在它那个缩进位。另外钉住三件容易被缩进带坏的事：子项的图标槽与文字**仍然相邻**（间距还是紧凑档的 ${SCALE_TIERS.compact.rowGap}，不是把文字推远）、**所有**子项的文字落在同一个缩进位（有没有图标都一样）、子项的图标槽与父项的图标槽**同列**（缩进为 0 的直接含义）、父项右端的指示器**只换图标、几何不走位**（收起态与展开态的左右缘与边长一分不动）与子项的 ✓ 的几何不受影响（勾不把文字挤走）。全程零 pageerror，不点任何会写网关的动作。`,
  run: async (ctx, check) => {
    const screenshots: string[] = []
    /**
     * 拍一张**菜单局部**的截图：裁剪到当前开着的那份菜单（四边各留 8px），不是整页。
     * 本套件量的是项内那几像素的关系量（#174 起差值是 0），整页图上那一列文字在哪看不出来；
     * 报告里要对着看的就是这一块。量不到菜单就退回整页，不因为取景失败影响断言。
     */
    const shot = async (page: OpenedPage['page'], name: string): Promise<string> => {
      const file = path.join(ctx.shots, `${name}.png`)
      await fsp.mkdir(ctx.shots, { recursive: true })
      const clip = await page.evaluate(() => {
        const menus = Array.from(document.querySelectorAll('[role="menu"]'))
        const menu = menus.length === 0 ? undefined : menus[menus.length - 1]
        if (menu === undefined) return null
        const box = menu.getBoundingClientRect()
        const margin = 8
        const left = Math.max(0, box.left - margin)
        const top = Math.max(0, box.top - margin)
        const right = Math.min(window.innerWidth, box.right + margin)
        const bottom = Math.min(window.innerHeight, box.bottom + margin)
        return { x: left, y: top, width: right - left, height: bottom - top }
      })
      await page.screenshot(clip === null ? { path: file } : { path: file, clip })
      return file
    }

    const opened = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { width: 380, height: 900 })
    const { page } = opened
    try {
      await expandAllWorkspaces(page)

      // ---- ③ 前半：没有标签组 / 没有自定义分组时的两次缺席 ----
      // 会话菜单的「移到分组…」**恒在场**（tree.ts 的口径：#107 里一个组都没有时也渲染，
      // 不然新建第一个组没有入口——拖拽只能把会话拖进已经存在的组），所以这一侧要断的是
      // 「**标签组那几条子项**一条都不出现，只剩两条固定入口」；工作区菜单的「分组…」才是
      // 真缺席（`groups` 为空时整项不渲染）。
      const fixture = await sessionFixture(page)
      check.fact(`夹具会话：${JSON.stringify(fixture)}`)
      check.ok(
        '找到一条没归组的会话行（同区块另有两条可挂进标签组）',
        fixture !== null && fixture.id !== '' && fixture.members.every((id) => id !== ''),
      )
      if (fixture === null || fixture.id === '' || !fixture.members.every((id) => id !== '')) return screenshots

      await openSessionMenu(page, fixture.id)
      const bareSession = await topLevelMarkers(page)
      const bareCollapsed = await submenuGeometry(page, { parent: 'moveToGroup', childPrefix: 'tag:' })
      check.fact(`没有标签组时的会话菜单项序：${JSON.stringify(bareSession)}`)
      check.eq('没有标签组时「移到分组…」展开前一条子项都不渲染', bareCollapsed.children.length, 0)
      await page.click('[data-dshone-tree-item="moveToGroup"]')
      await page.waitForTimeout(300)
      const bareExpanded = await submenuGeometry(page, { parent: 'moveToGroup', childPrefix: 'tag:' })
      check.fact(
        `没有标签组时「移到分组…」展开后子项：${JSON.stringify(bareExpanded.children.map((child) => child.text))}`,
      )
      check.eqTexts('没有标签组时只剩两条固定入口（不归入标签组 / 新建标签组）', bareExpanded.children.map((child) => child.text), [
        '不归入标签组',
        '新建标签组',
      ])
      check.ok(
        '没有标签组时没有任何 `tag:` 子项（标签组那几条随数据缺席）',
        bareExpanded.children.every((child) => !child.marker.startsWith('tag:t-')),
        JSON.stringify(bareExpanded.children.map((child) => child.marker)),
      )
      check.eq('没有标签组时展开也不关菜单（父项行为不变）', bareExpanded.menuCount, 1)
      const bareParent = bareExpanded.parent
      if (bareParent !== null && bareExpanded.children.length === 2) {
        const bareRelations = bareExpanded.children.map((child) => child.labelLeft - bareParent.labelLeft)
        check.fact(`没有标签组时：子项文字左缘 − 父项文字左缘 = ${JSON.stringify(bareRelations.map((value) => Number(value.toFixed(2))))}`)
        check.ok(
          `两条固定入口都是无图标的子项，缩进与有图标的一样（${String(EXPECTED_INDENT)}px，空图标槽占位生效）`,
          bareRelations.every((value) => Math.abs(value - EXPECTED_INDENT) <= 1),
          JSON.stringify(bareRelations.map((value) => Number(value.toFixed(2)))),
        )
      }
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)

      const workspaceRowKeys = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-dshone-tree-row="workspace"]')).map(
          (row) => row.getAttribute('data-dshone-tree-key') ?? '',
        ),
      )
      const realWorkspaceKey = workspaceRowKeys.find((key) => key !== '') ?? ''
      check.ok('网关上有真实工作区行可比（工作区菜单要用它）', realWorkspaceKey !== '', JSON.stringify(workspaceRowKeys))
      if (realWorkspaceKey !== '') {
        const rowSelector = `[data-dshone-tree-row="workspace"][data-dshone-tree-key="${realWorkspaceKey}"]`
        const openedContextMenu = await openRowContextMenu(page, rowSelector)
        check.ok('工作区行右键开出菜单（工作区行没有 ⋯ 按钮）', openedContextMenu)
        const bareWorkspace = await topLevelMarkers(page)
        check.fact(`没有自定义分组时的工作区菜单项序：${JSON.stringify(bareWorkspace)}`)
        check.ok('没有自定义分组时「分组…」整项不出现', !bareWorkspace.includes('groups'))
        await page.keyboard.press('Escape')
        await page.waitForTimeout(200)
      }

      // ---- 注入分组与标签组（树层读的是假宿主的状态存储，所以要重载一次页面）----
      const groupsState = {
        version: 1,
        groups: [
          { id: 'g-lab-one', name: 'Lab One' },
          { id: 'g-lab-two', name: 'Lab Two' },
        ],
        membership: {},
        activeGroupId: null,
      }
      const tagState = {
        version: 2,
        workspaces: {
          [fixture.key]: {
            tags: [
              { id: 't-one', name: '组一', color: 'blue' },
              { id: 't-two', name: '组二', color: 'green' },
            ],
            // 每个组挂一条成员（#107 的空组会被清掉，不挂成员这一组就留不住）。
            sessionTags: { [fixture.members[0]]: 't-one', [fixture.members[1]]: 't-two' },
          },
        },
      }
      await page.addInitScript({
        content: `(() => { globalThis.__LAB_HOST__.stateStore['groups'] = ${JSON.stringify(groupsState)}; globalThis.__LAB_HOST__.stateStore['tags'] = ${JSON.stringify(tagState)} })()`,
      })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector(route('sidebar').readySelector, { timeout: 40_000 })
      await page.waitForTimeout(2_500)
      await expandAllWorkspaces(page)
      check.fact(`注入后宿主里的 tags：${JSON.stringify(await hostState(page, 'tags'))}`)

      const sessionId = fixture.id
      const stillThere = await page.evaluate(
        (id: string) => document.querySelector(`[data-dshone-tree-session="${id}"]`) !== null,
        sessionId,
      )
      check.ok('重载后夹具那一行还在（会话没被注入弄丢）', stillThere)

      // ---- ① 会话菜单：父项 + 四个子项的几何 ----
      await openSessionMenu(page, sessionId)
      const collapsed = await submenuGeometry(page, { parent: 'moveToGroup', childPrefix: 'tag:' })
      check.ok('会话菜单里有「移到分组…」父项', collapsed.parent !== null)
      check.eq('「移到分组…」展开前没有子项（二级菜单点一下才展开）', collapsed.children.length, 0)
      const collapsedArrow = collapsed.arrow
      await page.click('[data-dshone-tree-item="moveToGroup"]')
      await page.waitForTimeout(300)
      const expanded = await submenuGeometry(page, { parent: 'moveToGroup', childPrefix: 'tag:' })
      const parent = expanded.parent
      check.fact(
        `会话菜单「移到分组…」展开后：父项文字左缘=${parent?.labelLeft.toFixed(1) ?? '无'} 父项整行左内边距=${parent?.paddingLeft ?? '无'} 子项=${JSON.stringify(
          expanded.children.map((child) => ({
            t: child.text,
            labelLeft: child.labelLeft.toFixed(1),
            iconLeft: child.iconLeft?.toFixed(1) ?? null,
            rowPaddingLeft: child.paddingLeft,
          })),
        )}`,
      )
      check.eqTexts('展开出四个子项（组一 / 组二 / 不归入标签组 / 新建标签组）', expanded.children.map((child) => child.text), [
        '组一',
        '组二',
        '不归入标签组',
        '新建标签组',
      ])
      check.eq('展开后菜单没关（子项追加在同一份菜单里，就地展开）', expanded.menuCount, 1)
      check.ok(
        '每个子项的文字都带缩进标记类（`.dshOneTree_submenuItem`）',
        expanded.children.length > 0 && expanded.children.every((child) => child.indentWrapped),
        JSON.stringify(expanded.children.map((child) => child.indentWrapped)),
      )
      if (parent !== null && expanded.children.length === 4) {
        const relations = expanded.children.map((child) => child.labelLeft - parent.labelLeft)
        check.fact(`会话菜单：子项文字左缘 − 父项文字左缘 = ${JSON.stringify(relations.map((value) => Number(value.toFixed(2))))}`)
        check.eq(
          `① 会话菜单：子项的整行左内边距 = 紧凑档的项内边距 ${SCALE_TIERS.compact.rowPaddingInline}（一个，与父项整行同值）`,
          [...new Set(expanded.children.map((child) => child.paddingLeft))],
          [`${String(SUBMENU_PADDING_INLINE)}px`],
        )
        check.ok(
          `① 会话菜单：子项文字左缘 − 父项文字左缘 = ${String(EXPECTED_INDENT)}px（±1）——子项文字与父项文字落在同一条竖线上（#174 收到底；#167 是旧侧栏那一档、#171 是它的一半）`,
          relations.every((value) => Math.abs(value - EXPECTED_INDENT) <= 1),
          JSON.stringify(relations.map((value) => Number(value.toFixed(2)))),
        )
        check.ok(
          `回归钉子（#143 / #167 / #171 / #174）：子项文字比父项文字深不超过旧侧栏那一档（≤ ${String(LEGACY_TIER_INDENT + 1)}px = 一个图标槽 + 1px 容差）——#143 之前深两个图标槽（20px）`,
          relations.every((value) => value <= LEGACY_TIER_INDENT + 1),
          JSON.stringify(relations.map((value) => Number(value.toFixed(2)))),
        )
        check.ok(
          '所有子项的文字落在同一列（有没有图标都是同一个值）',
          Math.max(...relations) - Math.min(...relations) <= 1,
          JSON.stringify(relations.map((value) => Number(value.toFixed(2)))),
        )
        check.ok(
          '子项的行盒左缘与父项一致（缩进落在项内，不是把整行推进去）',
          expanded.children.every((child) => Math.abs(child.itemLeft - parent.itemLeft) <= 0.5 && Math.abs(child.itemWidth - parent.itemWidth) <= 0.5),
          JSON.stringify(expanded.children.map((child) => `${child.itemLeft.toFixed(1)}/${child.itemWidth.toFixed(1)}`)),
        )
        check.ok(
          '子项的图标槽与父项的图标槽同列（缩进为 0 的直接含义：整行没有位移，行盒本身没动）',
          expanded.children.every(
            (child) => child.iconLeft !== null && parent.iconLeft !== null && Math.abs(child.iconLeft - parent.iconLeft - EXPECTED_INDENT) <= 1,
          ),
          JSON.stringify(expanded.children.map((child) => `${child.iconLeft?.toFixed(1) ?? '无'}`)),
        )
        check.ok(
          '子项的图标与文字仍然相邻（间距还是紧凑档的项内间隙 6px，没被缩进推远）',
          expanded.children.every(
            (child) => child.iconTextGap !== null && Math.abs(child.iconTextGap - Number.parseFloat(SCALE_TIERS.compact.rowGap)) <= 1,
          ),
          JSON.stringify(expanded.children.map((child) => child.iconTextGap?.toFixed(2) ?? '无')),
        )
        check.ok(
          '没有图标的子项也占住图标槽（14px 的盒子在场，所以文字列不会塌回去）',
          expanded.children.every((child) => child.iconLeft !== null && child.iconRight !== null && Math.abs(child.iconRight - child.iconLeft) <= 0.5 + Number.parseFloat(SCALE_TIERS.compact.iconSize)),
          JSON.stringify(expanded.children.map((child) => (child.iconRight === null || child.iconLeft === null ? '无' : (child.iconRight - child.iconLeft).toFixed(1)))),
        )
      }
      // 右端指示器的两态：#172 起收起态是官方右向 chevron、展开态是官方下向 chevron，
      // **只换图标、几何不走位**（用户报的是「太小、紧贴文字」，位置与尺寸都不该被顺手带跑）。
      check.ok(
        '「移到分组…」的展开指示只换图标、几何不走位（收起 = 右向 chevron、展开 = 下向 chevron）',
        collapsedArrow !== null &&
          expanded.arrow !== null &&
          collapsedArrow.name === CHEVRON.collapsed.name &&
          expanded.arrow.name === CHEVRON.expanded.name &&
          Math.abs(collapsedArrow.left - expanded.arrow.left) <= 0.5 &&
          Math.abs(collapsedArrow.width - expanded.arrow.width) <= 0.5 &&
          Math.abs(collapsedArrow.height - expanded.arrow.height) <= 0.5,
        `展开前=${JSON.stringify(collapsedArrow)} 展开后=${JSON.stringify(expanded.arrow)}`,
      )
      checkIndicator(check, '收起态（会话菜单）', collapsed, CHEVRON.collapsed)
      checkIndicator(check, '展开态（会话菜单）', expanded, CHEVRON.expanded)
      check.ok(
        '展开指示仍在项内（没有越出项盒子）',
        parent !== null && expanded.arrow !== null && expanded.arrow.right <= parent.itemRight + 0.5,
        `arrowRight=${expanded.arrow?.right.toFixed(1) ?? '无'} itemRight=${parent?.itemRight.toFixed(1) ?? '无'}`,
      )
      screenshots.push(await shot(page, 'submenu-indent-session'))

      // ---- ③ 后半：父项再点一下收起，菜单仍然开着（父项行为不变）----
      await page.click('[data-dshone-tree-item="moveToGroup"]')
      await page.waitForTimeout(300)
      const afterCollapse = await submenuGeometry(page, { parent: 'moveToGroup', childPrefix: 'tag:' })
      check.eq('父项再点一下收起子项', afterCollapse.children.length, 0)
      check.eq('收起子项后菜单还开着（就地开合，不关菜单）', afterCollapse.menuCount, 1)

      // ---- ④ 会话菜单的子项：点一项就归组（那一行会搬进标签组，菜单跟着收起）；重开时 ✓ 落在组一上 ----
      // 这一侧「点击不关菜单」不成立（既有行为，见下）：子项一改归属，那一行就换父节点搬进
      // 组块、React 重挂，挂在行上的菜单跟着收起；所以这里断的是它的等价结果（归属写回 +
      // 重开菜单时 ✓ 落在组一上 + 文字仍落在它那个缩进位）。
      await page.click('[data-dshone-tree-item="moveToGroup"]')
      await page.waitForTimeout(300)
      await page.click('[data-dshone-tree-item="tag:t-one"]')
      await page.waitForTimeout(600)
      const tagsAfterPick = await hostState(page, 'tags')
      check.fact(`点「组一」后的宿主 tags：${JSON.stringify(tagsAfterPick)}`)
      check.ok(
        '点「组一」把这一行的归属写回宿主状态',
        JSON.stringify(tagsAfterPick ?? '').includes('t-one'),
        JSON.stringify(tagsAfterPick),
      )
      // 行搬进标签组后菜单可能已经收起（行换了父节点，React 重挂）——这里只用它当依据重开一次。
      await page.keyboard.press('Escape')
      await page.waitForTimeout(250)
      await expandAllWorkspaces(page)
      const grouped = await page.evaluate(
        (id: string) =>
          Array.from(document.querySelectorAll('[data-dshone-tree="tag-block"]')).some(
            (block) => block.querySelector(`[data-dshone-tree-session="${id}"]`) !== null,
          ),
        sessionId,
      )
      check.fact(`那一行是否落在某个标签组块里：${String(grouped)}`)
      await openSessionMenu(page, sessionId)
      const reopened = await submenuGeometry(page, { parent: 'moveToGroup', childPrefix: 'tag:' })
      check.eq('重开菜单时子项默认收起（与父项行为一致）', reopened.children.length, 0)
      await page.click('[data-dshone-tree-item="moveToGroup"]')
      await page.waitForTimeout(300)
      const checked = await submenuGeometry(page, { parent: 'moveToGroup', childPrefix: 'tag:' })
      const checkedChild = checked.children.find((child) => child.text === '组一') ?? null
      check.fact(
        `重开后「组一」子项：${JSON.stringify(checkedChild === null ? null : { checked: checkedChild.checked, childCount: checkedChild.childCount, labelLeft: checkedChild.labelLeft.toFixed(1) })}`,
      )
      check.eq('重开菜单时「组一」项带官方勾选态（selectedIds 的 ✓）', checkedChild?.childCount, 3)
      check.ok(
        '带勾的子项文字仍在它那个缩进位（勾不把文字挤走）',
        checkedChild !== null && checked.parent !== null && Math.abs(checkedChild.labelLeft - checked.parent.labelLeft - EXPECTED_INDENT) <= 1,
        `子项=${checkedChild?.labelLeft.toFixed(1) ?? '无'} 父项=${checked.parent?.labelLeft.toFixed(1) ?? '无'}`,
      )
      check.ok(
        '官方勾（✓）落在项的右端、不越过项盒',
        checkedChild !== null && checkedChild.checkRight !== null && checkedChild.checkRight <= checkedChild.itemRight + 0.5,
        `checkRight=${checkedChild?.checkRight?.toFixed(1) ?? '无'} itemRight=${checkedChild?.itemRight.toFixed(1) ?? '无'}`,
      )
      screenshots.push(await shot(page, 'submenu-indent-session-checked'))
      await page.keyboard.press('Escape')
      await page.waitForTimeout(250)

      // ---- ② / ④ 工作区菜单：同一条关系，且「点击不关菜单、✓ 就地翻转」在这里成立 ----
      const workspaceKey = await page.evaluate(() => {
        const row = document.querySelector('[data-dshone-tree-row="workspace"]')
        return row?.getAttribute('data-dshone-tree-key') ?? ''
      })
      const rowSelector = `[data-dshone-tree-row="workspace"][data-dshone-tree-key="${workspaceKey}"]`
      check.ok('找到一条真实工作区行（右键开「分组…」菜单）', workspaceKey !== '', workspaceKey)
      if (workspaceKey !== '') {
        const openedContextMenu = await openRowContextMenu(page, rowSelector)
        check.ok('工作区行右键开出菜单', openedContextMenu)
        // #172 的第二处：工作区菜单的「分组…」与上一处是**同一个** `submenuParent`，所以两态
        // 的指示器判据逐条重跑一遍——一处改、处处生效，两处都得证明。
        checkIndicator(check, '收起态（工作区菜单）', await submenuGeometry(page, { parent: 'groups', childPrefix: 'workspace-group-item' }), CHEVRON.collapsed)
        await page.click('[data-dshone-tree-item="groups"]')
        await page.waitForTimeout(300)
        const wsExpanded = await submenuGeometry(page, { parent: 'groups', childPrefix: 'workspace-group-item' })
        const wsParent = wsExpanded.parent
        checkIndicator(check, '展开态（工作区菜单）', wsExpanded, CHEVRON.expanded)
        check.fact(
          `工作区菜单「分组…」展开后：父项文字左缘=${wsParent?.labelLeft.toFixed(1) ?? '无'} 父项整行左内边距=${wsParent?.paddingLeft ?? '无'} 子项=${JSON.stringify(
            wsExpanded.children.map((child) => ({ t: child.text, labelLeft: child.labelLeft.toFixed(1), rowPaddingLeft: child.paddingLeft })),
          )}`,
        )
        check.eq('「分组…」展开出两个自定义分组', wsExpanded.children.map((child) => child.text), ['Lab One', 'Lab Two'])
        check.eq('「分组…」展开后菜单没关', wsExpanded.menuCount, 1)
        if (wsParent !== null && wsExpanded.children.length === 2) {
          const relations = wsExpanded.children.map((child) => child.labelLeft - wsParent.labelLeft)
          check.fact(`工作区菜单：子项文字左缘 − 父项文字左缘 = ${JSON.stringify(relations.map((value) => Number(value.toFixed(2))))}`)
          check.eq(
            `② 工作区菜单：子项的整行左内边距 = 紧凑档的项内边距 ${SCALE_TIERS.compact.rowPaddingInline}（一个，与父项整行同值）`,
            [...new Set(wsExpanded.children.map((child) => child.paddingLeft))],
            [`${String(SUBMENU_PADDING_INLINE)}px`],
          )
          check.ok(
            `② 工作区菜单：子项文字左缘 − 父项文字左缘 = ${String(EXPECTED_INDENT)}px（±1，与①同一个 helper、同一个值）`,
            relations.every((value) => Math.abs(value - EXPECTED_INDENT) <= 1),
            JSON.stringify(relations.map((value) => Number(value.toFixed(2)))),
          )
          check.ok(
            `回归钉子（#143 / #167 / #171 / #174）：工作区菜单的子项文字比父项文字深不超过旧侧栏那一档（≤ ${String(LEGACY_TIER_INDENT + 1)}px = 一个图标槽 + 1px 容差）`,
            relations.every((value) => value <= LEGACY_TIER_INDENT + 1),
            JSON.stringify(relations.map((value) => Number(value.toFixed(2)))),
          )
          check.ok(
            '所有子项的文字落在同一列（未勾选的子项也占住图标槽）',
            Math.max(...relations) - Math.min(...relations) <= 1,
            JSON.stringify(relations.map((value) => Number(value.toFixed(2)))),
          )
          check.ok(
            '子项的图标槽与父项的图标槽同列（缩进为 0 的直接含义：整行没有位移）',
            wsExpanded.children.every(
              (child) => child.iconLeft !== null && wsParent.iconLeft !== null && Math.abs(child.iconLeft - wsParent.iconLeft - EXPECTED_INDENT) <= 1,
            ),
            JSON.stringify(wsExpanded.children.map((child) => child.iconLeft?.toFixed(1) ?? '无')),
          )
        }
        screenshots.push(await shot(page, 'submenu-indent-workspace'))

        // ④ 点一项：菜单不关、✓ 就地翻转、文字列一分不动。
        const before = await submenuGeometry(page, { parent: 'groups', childPrefix: 'workspace-group-item' })
        await page.click('[data-dshone-tree-item="workspace-group-item"]')
        await page.waitForTimeout(400)
        const afterCheck = await submenuGeometry(page, { parent: 'groups', childPrefix: 'workspace-group-item' })
        const firstBefore = before.children[0] ?? null
        const firstAfter = afterCheck.children[0] ?? null
        const membership = (await hostState(page, 'groups')) as { membership?: Record<string, string[]> } | null
        check.fact(
          `勾选第一项后：子项=${JSON.stringify(firstAfter === null ? null : { checked: firstAfter.checked, childCount: firstAfter.childCount, labelLeft: firstAfter.labelLeft.toFixed(1) })} 宿主归属=${JSON.stringify(membership?.membership)}`,
        )
        check.eq('点一下子项就勾上（就地翻转 ✓）', firstAfter?.checked, 'true')
        check.eq('勾选后菜单仍然开着（连勾几个组不用重开）', afterCheck.menuCount, 1)
        check.ok(
          '✓ 出现没有把文字挤走（文字左缘一分不动）',
          firstBefore !== null && firstAfter !== null && Math.abs(firstAfter.labelLeft - firstBefore.labelLeft) <= 0.5,
          `勾前=${firstBefore?.labelLeft.toFixed(1) ?? '无'} 勾后=${firstAfter?.labelLeft.toFixed(1) ?? '无'}`,
        )
        check.ok(
          '勾选写回宿主状态（该工作区记上这个分组）',
          Object.values(membership?.membership ?? {}).some((ids) => Array.isArray(ids) && ids.includes('g-lab-one')),
          JSON.stringify(membership?.membership),
        )
        await page.click('[data-dshone-tree-item="workspace-group-item"]')
        await page.waitForTimeout(400)
        const afterUncheck = await submenuGeometry(page, { parent: 'groups', childPrefix: 'workspace-group-item' })
        check.eq('再点一次就地取消勾选（同一入口的开关语义）', afterUncheck.children[0]?.checked, 'false')
        check.eq('取消勾选后菜单还开着', afterUncheck.menuCount, 1)
        check.ok(
          '取消勾选后文字仍在它那个缩进位（与①同一条关系）',
          afterUncheck.children.length > 0 &&
            afterUncheck.parent !== null &&
            afterUncheck.children.every((child) => Math.abs(child.labelLeft - (afterUncheck.parent?.labelLeft ?? child.labelLeft) - EXPECTED_INDENT) <= 1),
          JSON.stringify(afterUncheck.children.map((child) => Number((child.labelLeft - (afterUncheck.parent?.labelLeft ?? 0)).toFixed(2)))),
        )
        screenshots.push(await shot(page, 'submenu-indent-workspace-checked'))
        await page.keyboard.press('Escape')
        await page.waitForTimeout(200)
      }

      // ---- #172：两态 × 三档宽度（260 / 340 / 500），外加一段「文字装不下」的让位 ----
      // 三档宽度是用户实际会遇到的侧栏宽度（260 是用户实测那一档）；指示器的右端对齐关系在每
      // 一档、每一态都必须成立。
      const widths = [260, 340, 500] as const
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 })
        await page.waitForTimeout(300)
        await expandAllWorkspaces(page)
        await openSessionMenu(page, await anySessionRow(page, sessionId))
        const atWidthCollapsed = await submenuGeometry(page, { parent: 'moveToGroup', childPrefix: 'tag:' })
        checkIndicator(check, `收起态（会话菜单，w=${String(width)}）`, atWidthCollapsed, CHEVRON.collapsed)
        await page.click('[data-dshone-tree-item="moveToGroup"]')
        await page.waitForTimeout(300)
        const atWidthExpanded = await submenuGeometry(page, { parent: 'moveToGroup', childPrefix: 'tag:' })
        checkIndicator(check, `展开态（会话菜单，w=${String(width)}）`, atWidthExpanded, CHEVRON.expanded)
        await page.keyboard.press('Escape')
        await page.waitForTimeout(200)
      }

      // 「文字装不下」时的让位（本套件最后一段；夹具只往页面上加一条我们自己类名的样式，不动插件
      // 状态）。父项的文字是固定短文案，真页面里不会长到装不下，所以这里把**文字那一格**压到比
      // 文字还窄，让「装不下」这个状态真的出现——量的是机制：走省略号的是文字那一格（而不是把
      // 指示器顶出项盒、或被官方 label 那一格的 `overflow:hidden` 切掉），指示器仍贴那条内容右缘、
      // 仍从文字那一格的右缘起算（那一格自带一个项内间隙的右内边距）。
      // 为什么不改成「把文字换成一长串」：菜单面板的宽是按内容撑的（官方紧凑档 min 164 / max 360），
      // 一长串文字会把面板撑到比 260px 的视口还宽，官方 Menu 的钳位在这种情形下也放不下它
      // （判据见 F-08 那一节）——那时指示器跑到视口外面，量出来的不是这一条机制的问题。
      await page.setViewportSize({ width: 260, height: 900 })
      await page.waitForTimeout(300)
      await expandAllWorkspaces(page)
      await openSessionMenu(page, await anySessionRow(page, sessionId))
      await page.addStyleTag({
        content: '[data-dshone-tree-item="moveToGroup"] .dshOneTree_submenuParentLabel{max-width:40px}',
      })
      await page.waitForTimeout(150)
      const narrow = await submenuGeometry(page, { parent: 'moveToGroup', childPrefix: 'tag:' })
      const narrowText = narrow.parentText
      check.fact(
        `w=260 文字被压窄时：文字那一格 scrollWidth${narrowText?.truncating === true ? ' >' : ' ≤'} clientWidth、` +
          `文字右内边距=${narrowText?.paddingRight.toFixed(1) ?? '无'}、指示器左缘=${narrow.arrow?.left.toFixed(1) ?? '无'}、` +
          `文字那一格右缘=${narrowText?.boxRight.toFixed(1) ?? '无'}、项的内容右缘=${narrow.parent?.contentRight?.toFixed(1) ?? '无'}`,
      )
      check.ok(
        'w=260 文字装不下时走省略号的是文字那一格（滚出来的宽 > 画得下的宽，而不是把指示器顶出项盒）',
        narrowText !== null && narrowText.truncating,
        `truncating=${String(narrowText?.truncating ?? false)}`,
      )
      check.ok(
        'w=260 文字装不下时指示器仍不压文字（它从文字那一格的右缘起算，文字那一格自带一个项内间隙的右内边距）',
        narrow.arrow !== null &&
          narrowText !== null &&
          narrow.arrow.left >= narrowText.boxRight - 0.5 &&
          narrowText.paddingRight >= INDICATOR_TEXT_GAP - 0.5,
        `指示器左缘=${narrow.arrow?.left.toFixed(1) ?? '无'} 文字那格右缘=${narrowText?.boxRight.toFixed(1) ?? '无'} 右内边距=${narrowText?.paddingRight.toFixed(1) ?? '无'}`,
      )
      check.ok(
        'w=260 文字装不下时指示器整个仍在视口里、仍在项内',
        narrow.arrow !== null && narrow.parent !== null && narrow.arrow.right <= narrow.parent.itemRight + 0.5 && narrow.arrow.right <= 260,
        `指示器右缘=${narrow.arrow?.right.toFixed(1) ?? '无'} 项盒右缘=${narrow.parent?.itemRight.toFixed(1) ?? '无'}`,
      )
      checkIndicator(check, '收起态（会话菜单，w=260，文字装不下）', narrow, CHEVRON.collapsed)
      screenshots.push(await shot(page, 'submenu-indicator-narrow-squeezed'))
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)

      check.eq('二级菜单缩进套件全程零 pageerror', withoutKnownNoise(opened.capture.pageErrors).real, [])
    } finally {
      await opened.context.close()
    }
    return screenshots
  },
}
