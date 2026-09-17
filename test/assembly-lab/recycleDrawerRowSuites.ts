/**
 * 回收站抽屉的行与块头（#144）：块头与侧栏工作区行收敛成**同一套折叠语言**，行尾**直接列出**
 * 「还原 / 永久归档」两枚动作（⋯ 二级菜单退场）。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与 `recycleEntryAlignSuites.ts`（F-38）/ `scaleSuites.ts`
 * （F-23）同一条：那个文件是本批开发的合入热点，新套件放外面能少一半冲突面。注册方式是在
 * `suites.ts` 的 `SUITES` 末尾追加一项。
 *
 * **这一条与相邻套件的分工**：F-15 管回收站两层语义（移入=本地可逆 / 归档=删除带确认）与抽屉的
 * 存在与分块，F-24 管抽屉开合的动效，F-23 管各件读数能不能在档位表里找到出处，本条管的是
 * **#144 这一轮的两件事**——① 块头与侧栏工作区行**并排量**出来的关系量（箭头那一格、行高、
 * 圆角、左右内边距、名字那一列、hover 底色），② 行尾两枚动作的**扇出、几何与行为**。
 *
 * 期望值**不硬编码**：几何一律从 `workspaceTree/styles.ts` 的档位表读（`SCALE_TIERS`）、文案从
 * 插件自己的 zh 词典读（`ZH`），回收站内容由夹具注入**真实会话 id** 的 `recycle-bin` 状态
 * （与 F-38 同一处置）——全程只读真网关，本套件不点归档确认（那会写真实网关）。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { openTreePage, withoutKnownNoise, type OpenedPage } from './harness.ts'
import { LAB_TREES, type LabTreeRoute } from './labServer.ts'
import { SCALE_TIERS } from '../../src/ui/assembly/shell/workspaceTree/styles.ts'
import { ZH } from '../../src/ui/assembly/shell/workspaceTree/locale.ts'
// 只取类型（编译后不留 import，运行期没有环）：套件接口定义在 suites.ts 里。
import type { LabSuite } from './suites.ts'

const route = (name: string): LabTreeRoute => {
  const found = LAB_TREES.find((candidate) => candidate.route === name)
  if (found === undefined) throw new Error(`lab: unknown tree route ${name}`)
  return found
}

const PROJECT_ROW = '.dshOneTree_projectRow'
const GROUP_HEADER = '.dshOneTree_drawerGroupLabel'
const DRAWER_ROW = '.dshOneTree_drawerRow'
const RESTORE = '[data-dshone-recycle-restore]'
const ARCHIVE = '[data-dshone-recycle-archive]'

/** 关系量允许的误差（亚像素布局）：1px；尺寸读数：0.5px。 */
const EPS = 1
const SIZE_EPS = 0.5
/** 官方行尾动作组两枚按钮之间那一格（`.YDXeBa_rowActions{gap:12px}`，主树同款）。 */
const ACTION_GAP = 12

const px = (value: string): number => Number.parseFloat(value)
/** 词典文案代入会话名（`{name}` 占位）。 */
const say = (key: string, name: string): string => (ZH[key] ?? '').replace('{name}', name)

interface Box {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
}

interface SideReading {
  /** 主树工作区行（已悬停：箭头那一格与行尾动作按钮此刻显形）。 */
  row: Box | null
  rowRadius: number
  rowPaddingLeft: number
  rowPaddingRight: number
  rowBackground: string
  rowName: Box | null
  rowNameFontSize: number
  rowNameColor: string
  rowArrowSlot: Box | null
  rowArrowPath: string
  rowArrowClass: string
  rowArrowColor: string
  rowArrowOpen: boolean
  rowAriaExpanded: string
  rowSvgCount: number
  rowAction: Box | null
  rowActionRadius: number
  rowActionIcon: Box | null
  /** 抽屉分块块头。 */
  header: Box | null
  headerRadius: number
  headerPaddingLeft: number
  headerPaddingRight: number
  headerGap: number
  headerBackground: string
  headerName: Box | null
  headerNameFontSize: number
  headerNameLineHeight: number
  headerNameColor: string
  headerArrowSlot: Box | null
  headerArrowPath: string
  headerArrowClass: string
  headerArrowColor: string
  headerArrowOpen: boolean
  headerAriaExpanded: string
  headerSvgCount: number
  headerCount: Box | null
  headerCountText: string
  headerCountFontSize: number
  /** 块头所在那一块里的会话行数（计数那一枚的关系量：计数 = 本块行数）。 */
  headerRows: number
  /** 抽屉会话行 + 它的标题与行尾动作。 */
  drawerRow: Box | null
  drawerRowScrollWidth: number
  drawerRowClientWidth: number
  drawerTitle: Box | null
  drawerTitleText: string
  drawerTitleScrollWidth: number
  drawerTitleClientWidth: number
  drawerTitleTextOverflow: string
  drawerTitleWhiteSpace: string
  drawerActions: Box | null
  drawerActionsGap: number
  drawerButtons: readonly {
    kind: string
    box: Box | null
    radius: number
    icon: Box | null
    ariaLabel: string
    disabled: boolean
    color: string
  }[]
  /** 页面上还剩几枚 ⋯ 那种二级菜单入口（#144 之后必须是 0）。 */
  menus: number
}

/**
 * 并排读两侧的几何（同一页：主树的工作区行 vs 抽屉里的块头）。
 *
 * 调用时机有要求：**先量抽屉、后量主树**——主树那一侧要先把鼠标悬到工作区行上（箭头那一格与
 * 行尾动作按钮都是悬停才显形），而悬停会把指针从别处带走；两处的 hover 底色各自在被悬停的
 * 那一刻读（同一时刻只有一个元素是 `:hover`）。
 */
async function readSide(page: OpenedPage['page']): Promise<SideReading> {
  return page.evaluate(
    ([projectRowSelector, headerSelector, rowSelector, restoreSelector, archiveSelector]) => {
      const round = (value: number): number => Math.round(value * 100) / 100
      const box = (element: Element | null | undefined): Box | null => {
        if (element === null || element === undefined) return null
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
      /** 只认「真的画出来」的那一枚（行尾动作按钮平时 display:none，矩形为 0）。 */
      const visible = (selector: string): Element | null =>
        Array.from(document.querySelectorAll(selector)).find((element) => element.getBoundingClientRect().width > 0) ?? null
      const pathOf = (element: Element | null): string => element?.querySelector('path')?.getAttribute('d') ?? ''
      const svgCount = (element: Element | null): number => element?.querySelectorAll('svg').length ?? 0
      const num = (value: string): number => {
        const parsed = Number.parseFloat(value)
        return Number.isFinite(parsed) ? round(parsed) : -1
      }

      const projectRow = document.querySelector(projectRowSelector)
      const projectStyle = projectRow === null ? null : getComputedStyle(projectRow)
      const rowArrowSlot = document.querySelector(`${projectRowSelector} .dshOneTree_chevron`)
      const rowArrow = rowArrowSlot?.querySelector('svg') ?? null
      const rowName = document.querySelector(`${projectRowSelector} .dshOneTree_titleText`)
      const rowNameStyle = rowName === null ? null : getComputedStyle(rowName)
      const rowAction = visible(`${projectRowSelector} .dshOneTree_rowActions .dshOneTree_rowIconButton`)
      const rowActionStyle = rowAction === null ? null : getComputedStyle(rowAction)

      const header = document.querySelector(headerSelector)
      const headerStyle = header === null ? null : getComputedStyle(header)
      const headerArrowSlot = header?.querySelector('.dshOneTree_drawerGroupArrow') ?? null
      const headerArrow = headerArrowSlot?.querySelector('svg') ?? null
      const headerName = header?.querySelector('.dshOneTree_drawerGroupLabelText') ?? null
      const headerNameStyle = headerName === null ? null : getComputedStyle(headerName)
      const headerCount = header?.querySelector('.dshOneTree_drawerGroupCount') ?? null
      const headerCountStyle = headerCount === null ? null : getComputedStyle(headerCount)

      const row = document.querySelector(rowSelector)
      const title = row?.querySelector('.dshOneTree_title') ?? null
      const titleStyle = title === null ? null : getComputedStyle(title)
      const actions = row?.querySelector('.dshOneTree_drawerActions') ?? null
      const actionsStyle = actions === null ? null : getComputedStyle(actions)
      const button = (selector: string, kind: string): {
        kind: string
        box: Box | null
        radius: number
        icon: Box | null
        ariaLabel: string
        disabled: boolean
        color: string
      } | null => {
        const element = row?.querySelector(selector) ?? null
        if (element === null) return null
        const style = getComputedStyle(element)
        return {
          kind,
          box: box(element),
          radius: num(style.borderTopLeftRadius),
          icon: box(element.querySelector('svg')),
          ariaLabel: element.getAttribute('aria-label') ?? '',
          disabled: (element as HTMLButtonElement).disabled,
          color: style.color,
        }
      }
      return {
        row: box(projectRow),
        rowRadius: projectStyle === null ? -1 : num(projectStyle.borderTopLeftRadius),
        rowPaddingLeft: projectStyle === null ? -1 : num(projectStyle.paddingLeft),
        rowPaddingRight: projectStyle === null ? -1 : num(projectStyle.paddingRight),
        rowBackground: projectStyle?.backgroundColor ?? '',
        rowName: box(rowName),
        rowNameFontSize: rowNameStyle === null ? -1 : num(rowNameStyle.fontSize),
        rowNameColor: rowNameStyle?.color ?? '',
        rowArrowSlot: box(rowArrowSlot),
        rowArrowPath: pathOf(rowArrow),
        rowArrowClass: rowArrow?.getAttribute('class') ?? '',
        rowArrowColor: rowArrow === null ? '' : getComputedStyle(rowArrow).color,
        rowArrowOpen: (rowArrow?.getAttribute('class') ?? '').includes('dshOneTree_arrowOpen'),
        rowAriaExpanded: projectRow?.getAttribute('aria-expanded') ?? '',
        rowSvgCount: svgCount(projectRow),
        rowAction: box(rowAction),
        rowActionRadius: rowActionStyle === null ? -1 : num(rowActionStyle.borderTopLeftRadius),
        rowActionIcon: box(rowAction?.querySelector('svg')),
        header: box(header),
        headerRadius: headerStyle === null ? -1 : num(headerStyle.borderTopLeftRadius),
        headerPaddingLeft: headerStyle === null ? -1 : num(headerStyle.paddingLeft),
        headerPaddingRight: headerStyle === null ? -1 : num(headerStyle.paddingRight),
        headerGap: headerStyle === null ? -1 : num(headerStyle.columnGap),
        headerBackground: headerStyle?.backgroundColor ?? '',
        headerName: box(headerName),
        headerNameFontSize: headerNameStyle === null ? -1 : num(headerNameStyle.fontSize),
        headerNameLineHeight: headerNameStyle === null ? -1 : num(headerNameStyle.lineHeight),
        headerNameColor: headerNameStyle?.color ?? '',
        headerArrowSlot: box(headerArrowSlot),
        headerArrowPath: pathOf(headerArrow),
        headerArrowClass: headerArrow?.getAttribute('class') ?? '',
        headerArrowColor: headerArrow === null ? '' : getComputedStyle(headerArrow).color,
        headerArrowOpen: (headerArrow?.getAttribute('class') ?? '').includes('dshOneTree_arrowOpen'),
        headerAriaExpanded: header?.getAttribute('aria-expanded') ?? '',
        headerSvgCount: svgCount(header),
        headerCount: box(headerCount),
        headerCountText: (headerCount?.textContent ?? '').trim(),
        headerCountFontSize: headerCountStyle === null ? -1 : num(headerCountStyle.fontSize),
        headerRows: header?.parentElement?.querySelectorAll('[data-dshone-recycle-row]').length ?? -1,
        drawerRow: box(row),
        drawerRowScrollWidth: row?.scrollWidth ?? -1,
        drawerRowClientWidth: row?.clientWidth ?? -1,
        drawerTitle: box(title),
        drawerTitleText: (title?.textContent ?? '').trim(),
        drawerTitleScrollWidth: title?.scrollWidth ?? -1,
        drawerTitleClientWidth: title?.clientWidth ?? -1,
        drawerTitleTextOverflow: titleStyle?.textOverflow ?? '',
        drawerTitleWhiteSpace: titleStyle?.whiteSpace ?? '',
        drawerActions: box(actions),
        drawerActionsGap: actionsStyle === null ? -1 : num(actionsStyle.columnGap),
        drawerButtons: [button(restoreSelector, 'restore'), button(archiveSelector, 'archive')].filter(
          (entry): entry is NonNullable<typeof entry> => entry !== null,
        ),
        menus: document.querySelectorAll('[data-dshone-recycle-menu]').length,
      }
    },
    [PROJECT_ROW, GROUP_HEADER, DRAWER_ROW, RESTORE, ARCHIVE] as const,
  )
}

/** 页面上所有官方 tooltip 的文案（`role="tooltip"`）。 */
async function tooltips(page: OpenedPage['page']): Promise<string[]> {
  return page.evaluate(() => Array.from(document.querySelectorAll('[role="tooltip"]')).map((element) => element.textContent ?? ''))
}

/** 悬停到某个元素上、等官方 Tooltip（`delayMs: 500`）出来，返回当前 tooltip 文案。 */
async function hoverTooltip(page: OpenedPage['page'], selector: string): Promise<string[]> {
  await page.hover(selector)
  await page.waitForTimeout(800)
  return tooltips(page)
}

/** 给 `--dsw-alias-state-error-primary` 量一个解析值（拿同一枚 token 挂探针元素上比）。 */
async function errorTokenValue(page: OpenedPage['page']): Promise<string> {
  return page.evaluate(() => {
    const probe = document.createElement('div')
    probe.style.color = 'var(--dsw-alias-state-error-primary)'
    document.body.append(probe)
    const value = getComputedStyle(probe).color
    probe.remove()
    return value
  })
}

/** 假宿主里 `recycle-bin` 的状态与它被写过的次数（还原 = 只写这一份，不落网关）。 */
async function hostBin(page: OpenedPage['page']): Promise<{ ids: string[]; writes: number }> {
  return page.evaluate(() => {
    const host = (globalThis as unknown as {
      __LAB_HOST__?: { stateStore?: Record<string, { sessionIds?: string[] }>; hostCalls?: { call: string; args?: { key?: string } }[] }
    }).__LAB_HOST__
    return {
      ids: host?.stateStore?.['recycle-bin']?.sessionIds ?? [],
      writes: (host?.hostCalls ?? []).filter((entry) => entry.call === 'state.write' && entry.args?.key === 'recycle-bin').length,
    }
  })
}

/**
 * 夹具给注入的那几条会话盖上的**长标题**（#144）。
 *
 * 为什么必须有它：本套件要判「窄宽度下标题被省略号截断、让位给行尾那两枚动作」，而「当天
 * 网关上的标题有多长」是**当天数据**——标题恰好短到装得下时那条断言就红（#116 记的就是
 * 这一类抖动）。夹具把这几条会话的标题换成一份**必然装不下**的固定长文案，判据因此不依赖
 * 当天数据。文案里点明用途，报告截图上一眼能看出这是夹具给的。
 */
const LONG_TITLE = '这是一条刻意写得很长的会话标题：用来把抽屉行里标题与行尾两枚动作的让位关系量准（#144 夹具）'

/**
 * 把 `session/list` 回执里**指定会话**的标题换成一份长文案（页内夹具）。
 *
 * 为什么用夹具：见 {@link LONG_TITLE}。夹具只改**页面收到的回执**、请求不落网关（与 F-39
 * 的 `running` 夹具、F-18 的 `schedule` 夹具同一处置）。会话清单是页面挂载时取的，所以
 * 装完要**重载页面**才生效；树行与抽屉行读的是同一份清单，所以两处都显示这份长标题——套件
 * 随后断言抽屉行真的显示了它（夹具没接上就当场红，不会静默变成「标题本来就短」）。
 * `blank` 一并翻成 false：空白会话的标题渲染成「新会话」兜底文案，长标题会被它盖掉（这条
 * 只是把夹具那几条钉成非空白，不改任何界面的判定口径）。
 *
 * ## 改的是哪个字段（#154 实测修正，就是本条此前在共享实例上红的原因）
 *
 * 先量了 `session/list` 回执每一项的真实形状（本机实测，一次诊断脚本的输出）：
 *
 * ```
 * {"sessionId":"session-…","updatedAt":1789635150056,"running":false,"blank":false,
 *  "cwd":"/Users/cgeng/Workspaces/dsh-one","projections":{"asOfSeq":206,
 *  "values":{"title":"Kimi Code 子代理任务分配","goal":null,…}}}
 * ```
 *
 * **顶层根本没有 `title` 字段**——标题住在 `projections.values.title`。此前这里改的是不存在的
 * `item.title`（还按同样不存在的 `item.sessionId`…那个倒是有的）来认会话，于是「改了但读不回来」，
 * 判据读到的是当天真实标题（#116 记的那类抖动）。改成写 `projections.values.title` 之后实测
 * 生效（诊断脚本里抽屉行的标题变成了夹具那份长文案）。会话 id 认 `sessionId`（0.1.6 实测字段名），
 * `id` 也一并认（形状换代时的兜底）。
 */
async function installLongTitleFixture(
  page: OpenedPage['page'],
  sessionIds: readonly string[],
  /** 记一笔走过的 `/api/` 方法名（只读守卫：本套件收尾要断言没有任何写类方法）。 */
  onApiCall?: (method: string) => void,
): Promise<{ calls: number; touched: number }> {
  const stats = { calls: 0, touched: 0 }
  await page.route('**/api/**', async (requestRoute) => {
    const request = requestRoute.request()
    const method = decodeURIComponent(request.url()).split('/api/')[1] ?? ''
    // 不是会话清单的请求交给**更早注册**的那一条处理器（只读守卫 / 原样转发）：
    // `fallback()` 而不是 `fetch()`——用 fetch 会绕过它，收尾那条「没有写类请求」的断言
    // 就会变成一句空话（本套件此前正是这么漏的）。
    if (!method.startsWith('session/list')) {
      await requestRoute.fallback()
      return
    }
    onApiCall?.(method)
    stats.calls += 1
    const response = await requestRoute.fetch()
    const body = await response.text()
    const parsed = JSON.parse(body) as {
      result?: {
        value?: {
          items?: {
            id?: string
            sessionId?: string
            blank?: boolean
            projections?: { asOfSeq?: number; values?: { title?: string } }
          }[]
        }
      }
    }
    for (const item of parsed.result?.value?.items ?? []) {
      const id = item.id ?? item.sessionId ?? ''
      if (id === '' || !sessionIds.includes(id)) continue
      if (item.projections?.values !== undefined) {
        item.projections.values.title = LONG_TITLE
        // **把 `asOfSeq` 抬到远高于网关的值**：投影值是「按序号取新」的（官方投影存储
        // `seed`/`apply` 只在序号更大时才覆盖，同一序号不改），而页面的 mux 流常常比这次
        // `session/list` 回执先到——那一刻真标题已经以网关那个序号落进存储，我们只换值不换
        // 序号就会被原样忽略（#154 实测：同一台机器上一轮生效、下一轮不生效的抖动就是这个）。
        // 序号抬大之后，无论谁先到，夹具这份都算更新的那一份。
        item.projections.asOfSeq = Math.max(item.projections.asOfSeq ?? 0, 0) + 1_000_000
      }
      item.blank = false
      stats.touched += 1
    }
    await requestRoute.fulfill({ response, body: JSON.stringify(parsed) })
  })
  return stats
}

/** 一行里那一组动作的短写（报告用）。 */
const showButtons = (reading: SideReading): string =>
  reading.drawerButtons
    .map(
      (button) =>
        `${button.kind}=[${button.box === null ? '缺' : String(button.box.left)},${button.box === null ? '' : String(button.box.right)}]` +
        `${button.box === null ? '' : ` ${String(button.box.width)}×${String(button.box.height)}`}` +
        `${button.icon === null ? ' 图标缺' : ` 图标 ${String(button.icon.width)}×${String(button.icon.height)}`}` +
        `${button.disabled ? ' 禁用' : ''}`,
    )
    .join(' | ')

export const RECYCLE_DRAWER_ROW_SUITE: LabSuite = {
  id: 'F-45',
  phase: 'new-feature',
  name: '回收站抽屉的块头与行尾动作（#144，RECYCLE-DRAWER-ROW 套件）：块头与侧栏工作区行并排对齐、行尾直接列出还原 / 归档两枚动作',
  expect:
    '真装配页（真网关**只读** + 假宿主 + 夹具注入**真实会话 id** 的 `recycle-bin` 与**一份长标题**）上的两件事（几何期望值全部从 `workspaceTree/styles.ts` 的档位表读、文案从插件 zh 词典读，不硬编码）：**A 块头与侧栏工作区行并排量**——把鼠标悬到主树的工作区行上（箭头那一格与行尾动作按钮都是悬停才显形）再与抽屉块头逐项比：① **关系量逐条对齐（±1px）**——块头行高 = 工作区行行高（= 标准档 `projectRowHeight` 34px）、圆角与左右内边距取行族那一档（`rowRadius` / `rowPaddingInline`）、**箭头那一格**宽与工作区行折叠箭头同宽（标准档 `slotWidth` 16px）且左缘同一条竖线、**名字那一列**与工作区行名字同一条左缘、名字字号与颜色一致（`titleFontSize` 14px、行文字色）、hover 底色与工作区行是同一枚 token（解析值逐字相同），箭头是**同一枚图标**（`path@d` 逐字相同）且都挂着同一套展开标记 `dshOneTree_arrowOpen`；块头的计数按行内元信息档（`metaFontSize` 12px）读、并按**关系量**判（计数 = 它这一块里的行数，不写死条数）；② **块头不补文件夹图标**（并排读数下来它恒显箭头 = 工作区行的悬停形态，再补一枚会把名字列推右 22px）：块头子树里只有一枚 svg、工作区行有文件夹与箭头两枚，这一条按事实记并钉住；③ **折叠语义一字未改**——点块头收起（标记 `true`、`aria-expanded=false`、该块的行不再渲染、折叠键落 `dsh.workspaceTree.view`、箭头不再挂 `arrowOpen`），重载后仍收起，再点一下展开回来。**B 行尾两枚动作**——④ **恰好两枚**：每行行尾是「还原」+「永久归档」（`data-dshone-recycle-restore` / `-archive`，顺序固定），各带 `aria-label`（词典 `recycle.restore.aria` / `recycle.archive.aria` 代入会话名）与官方 Tooltip（悬停读 `role="tooltip"` 的文案 = 词典 `recycle.restore` / `menu.archiveForever`）；**行尾没有常显的 ⋯ 入口**（`[data-dshone-recycle-menu]` 计数为 0；#154 起右键能开出一份同项菜单，那一份由 F-49 判）；⑤ **几何取侧栏行尾动作按钮同一档**：两枚各自 16×16、圆角 4px（标准档 `rowIconButtonSize` / `rowIconButtonRadius`）、行内图标 16×16，**与同一页里主树工作区行的行尾动作按钮逐项相等**（±0.5px——那一枚是悬停显形的参照物），两枚之间的间距 = 官方行尾动作组那一格 12px（容器 `column-gap` 与实际盒子间隙两处都量）；⑥ **归档按错误色**（终点动作）：解析值 = 同一枚官方 token `--dsw-alias-state-error-primary` 的解析值，且与「还原」不同色；⑦ **三档宽度（260/340/500）不溢出**：抽屉行与页面都 `scrollWidth ≤ clientWidth + 1`、两枚动作整个落在行内、最右一枚的右缘 = 行的内容右缘（±1px）、标题走省略号那条路；压到 140px 时标题**真的**被截断（文字让位、两枚动作位置与尺寸一分不动、标题右缘不超过动作组左缘——标题由夹具换成一份**必然装不下**的长文案（标题写在 `session/list` 回执的 `projections.values.title` 上——顶层没有 `title` 字段，见 `installLongTitleFixture` 的实测记录），这条判据因此不跟当天数据走）；⑧ **点动作不顺带打开会话**（两枚都 `stopPropagation`）：点任一枚都没有任何 `session.*` 宿主调用；⑨ **归档 = 先确认**：点归档开的是既有的归档确认弹窗，取消后弹窗关掉、回收站状态一条不少、**这一趟没有任何写类 `/api/` 方法**（页面自己按节奏轮询的读接口不算——记录器 #154 起不再被夹具绕过，这条断言这才真的看得到东西）（本套件从不点确认——那会写真实网关）；⑩ **还原 = 一条本地请求**：busy（有动作在飞，夹具把宿主对 `recycle-bin` 的写入按住）期间两枚动作都禁用且都降透明度，放行后假宿主状态里那条会话被移出回收站（恰好一条 `state.write`，不落网关）、那一行从抽屉消失、会话回到树里。收尾另核全程**没有任何写类 `/api/` 方法**、零 pageerror。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const shot = async (page: OpenedPage['page'], name: string): Promise<string> => {
      const file = path.join(ctx.shots, `${name}.png`)
      await fsp.mkdir(ctx.shots, { recursive: true })
      await page.screenshot({ path: file })
      return file
    }
    const opened = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { width: 340, height: 900 })
    const { page } = opened
    // 只读守卫：把走过的 `/api/` 方法名逐个记下来，收尾断言写类请求一个都没有。
    const apiCalls: string[] = []
    await page.route('**/api/**', async (r) => {
      apiCalls.push(decodeURIComponent(r.request().url()).split('/api/')[1] ?? '')
      await r.continue()
    })
    try {
      await page.waitForSelector(route('sidebar').readySelector)
      // ---- 夹具：把树上**真实会话 id** 注入假宿主的 recycle-bin（旧侧栏那份形状）----
      // 取两条（树上只剩一条时用一条）：本套件不按「恰好两条」判任何事，行数、块内的计数、
      // 还原后的剩余集合全部**按注入的这份算**，所以当天网关上有多少会话都不改判据。
      const ids = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-dshone-tree-row="session"]'))
          .slice(0, 2)
          .map((row) => row.getAttribute('data-dshone-tree-session') ?? '')
          .filter((id) => id !== ''),
      )
      check.ok('树里至少有 1 条会话可供夹具使用（抽屉要有行才量得到）', ids.length >= 1, JSON.stringify(ids))
      if (ids.length === 0) return screenshots
      await page.addInitScript({
        content: `(() => { globalThis.__LAB_HOST__.stateStore['recycle-bin'] = ${JSON.stringify({ version: 1, sessionIds: ids })} })()`,
      })
      // 标题夹具（见 LONG_TITLE / installLongTitleFixture）：必须在 reload 之前装好。
      // 它接管 `session/list` 的转发，所以只读守卫的方法名也由它一并记（否则那几条会被
      // 它的 `fetch()` 绕过，收尾的「零写类请求」就成了一句空话）。
      const titleFixture = await installLongTitleFixture(page, ids, (method) => apiCalls.push(method))
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector(route('sidebar').readySelector, { timeout: 40_000 })
      await page.waitForTimeout(2_500)
      check.fact(`标题夹具：session/list 被改 ${String(titleFixture.calls)} 次、命中目标会话 ${String(titleFixture.touched)} 次`)
      await page.click('[data-dshone-tree-action="recycle-toggle"]')
      await page.waitForTimeout(400)
      check.eq('夹具生效：抽屉开着且行数 = 注入的条数（回收站里有内容）', await page.locator(DRAWER_ROW).count(), ids.length)
      check.ok(
        '标题夹具接上了：抽屉里的行显示的就是夹具那份长标题（没接上会当场红，不会静默退化成「标题本来就短」）',
        titleFixture.touched >= ids.length,
        `命中 ${String(titleFixture.touched)} / 注入 ${String(ids.length)}`,
      )

      // =====================================================================
      // ① 块头 vs 侧栏工作区行：先量抽屉（不用悬停），再把指针移到主树行上量另一侧
      // =====================================================================
      const beforeHover = await readSide(page)
      check.fact(
        `@340 块头读数：盒=${JSON.stringify(beforeHover.header)} 圆角=${String(beforeHover.headerRadius)} ` +
          `左右内边距=${String(beforeHover.headerPaddingLeft)}/${String(beforeHover.headerPaddingRight)} 行内间隙=${String(beforeHover.headerGap)} ` +
          `箭头格=${JSON.stringify(beforeHover.headerArrowSlot)} 名字盒=${JSON.stringify(beforeHover.headerName)} ` +
          `名字 ${String(beforeHover.headerNameFontSize)}px/${String(beforeHover.headerNameLineHeight)}px ${beforeHover.headerNameColor} ` +
          `计数「${beforeHover.headerCountText}」=${JSON.stringify(beforeHover.headerCount)} ${String(beforeHover.headerCountFontSize)}px`,
      )
      check.fact(
        `@340 抽屉行读数：行=${JSON.stringify(beforeHover.drawerRow)} 标题=[${String(beforeHover.drawerTitle?.left)},${String(beforeHover.drawerTitle?.right)}]「${beforeHover.drawerTitleText}」` +
          `（scrollWidth ${String(beforeHover.drawerTitleScrollWidth)} / clientWidth ${String(beforeHover.drawerTitleClientWidth)}）` +
          ` 动作组=${JSON.stringify(beforeHover.drawerActions)} 间距=${String(beforeHover.drawerActionsGap)} ${showButtons(beforeHover)}`,
      )
      check.eq('夹具生效：抽屉行显示的就是夹具那份长标题（标题长度由本套件控制，不跟当天数据走）', beforeHover.drawerTitleText, LONG_TITLE)
      check.eq('块头行高 = 标准档 projectRowHeight（与侧栏工作区行同高）', beforeHover.header?.height, px(SCALE_TIERS.standard.projectRowHeight))
      check.eq('块头圆角 = 标准档 rowRadius', beforeHover.headerRadius, px(SCALE_TIERS.standard.rowRadius))
      check.eq('块头左内边距 = 标准档 rowPaddingInline（行内容基准）', beforeHover.headerPaddingLeft, px(SCALE_TIERS.standard.rowPaddingInline))
      check.eq('块头右内边距 = 标准档 rowPaddingInline', beforeHover.headerPaddingRight, px(SCALE_TIERS.standard.rowPaddingInline))
      check.eq('块头箭头那一格宽 = 标准档 slotWidth（与工作区行折叠箭头同宽）', beforeHover.headerArrowSlot?.width, px(SCALE_TIERS.standard.slotWidth))
      check.eq('块头箭头那一格高 = 标准档 slotHeight', beforeHover.headerArrowSlot?.height, px(SCALE_TIERS.standard.slotHeight))
      check.eq('块头名字字号 = 标准档 titleFontSize（行标题档）', beforeHover.headerNameFontSize, px(SCALE_TIERS.standard.titleFontSize))
      check.eq('块头名字行高 = 标准档 titleLineHeight', beforeHover.headerNameLineHeight, px(SCALE_TIERS.standard.titleLineHeight))
      check.eq('块头计数（本组几条）字号 = 标准档 metaFontSize（行内元信息档）', beforeHover.headerCountFontSize, px(SCALE_TIERS.standard.metaFontSize))
      // 计数那一枚是**关系量**：它必须等于自己这一块里的行数（不写死条数——当天网关上有
      // 几条会话、两条夹具会话落在同一个工作区块里还是两个块里，都不该改判据）。
      check.eq(
        '块头计数 = 它这一块里的行数（关系量，不写死条数）',
        beforeHover.headerCountText,
        String(beforeHover.headerRows),
      )
      check.fact(`抽屉结构：块头所在块里的行数=${String(beforeHover.headerRows)}，页面上共 ${String(await page.locator('[data-dshone-recycle-group]').count())} 块 / ${String(await page.locator(DRAWER_ROW).count())} 行`)
      check.eq('块头未悬停时底色透明（底色只在悬停时来）', beforeHover.headerBackground, 'rgba(0, 0, 0, 0)')

      // 悬停块头 → 读底色；再把指针移到主树工作区行 → 读另一侧（含悬停底色）。
      await page.hover(GROUP_HEADER)
      await page.waitForTimeout(200)
      const headerHoverBackground = await page.evaluate(
        (selector) => getComputedStyle(document.querySelector(selector) ?? document.body).backgroundColor,
        GROUP_HEADER,
      )
      screenshots.push(await shot(page, 'recycle-drawer-block-header-hover'))
      await page.hover(PROJECT_ROW)
      await page.waitForTimeout(250)
      const side = await readSide(page)
      screenshots.push(await shot(page, 'recycle-drawer-row-parity-side'))

      check.fact(
        `@340 工作区行读数（已悬停）：盒=${JSON.stringify(side.row)} 圆角=${String(side.rowRadius)} 左右内边距=${String(side.rowPaddingLeft)}/${String(side.rowPaddingRight)} ` +
          `悬停底色=${side.rowBackground} 名字盒=${JSON.stringify(side.rowName)} ${String(side.rowNameFontSize)}px ${side.rowNameColor}`,
      )
      check.fact(
        `@340 工作区行的箭头那一格（悬停显形）=${JSON.stringify(side.rowArrowSlot)} 颜色=${side.rowArrowColor}；` +
          `行尾动作按钮（悬停显形）=${JSON.stringify(side.rowAction)} 圆角=${String(side.rowActionRadius)} 图标=${JSON.stringify(side.rowActionIcon)}；` +
          `块头悬停底色=${headerHoverBackground}`,
      )
      check.ok(
        '工作区行那一侧都量到了（行 / 名字 / 箭头那一格 / 行尾动作按钮）',
        side.row !== null && side.rowName !== null && side.rowArrowSlot !== null && side.rowAction !== null,
      )
      check.ok(
        '块头与工作区行同高（±1px）',
        side.row !== null && Math.abs((side.header?.height ?? 0) - side.row.height) <= EPS,
        `块头 ${String(side.header?.height)} vs 行 ${String(side.row?.height)}`,
      )
      check.ok('块头与工作区行圆角同档（±1px）', Math.abs(side.headerRadius - side.rowRadius) <= EPS, `${String(side.headerRadius)} vs ${String(side.rowRadius)}`)
      check.ok(
        '块头与工作区行左右内边距同档（±1px）',
        Math.abs(side.headerPaddingLeft - side.rowPaddingLeft) <= EPS && Math.abs(side.headerPaddingRight - side.rowPaddingRight) <= EPS,
        `块头 ${String(side.headerPaddingLeft)}/${String(side.headerPaddingRight)} vs 行 ${String(side.rowPaddingLeft)}/${String(side.rowPaddingRight)}`,
      )
      check.ok(
        '箭头那一格：左缘与工作区行的折叠箭头同一条竖线（±1px）',
        side.rowArrowSlot !== null && side.headerArrowSlot !== null && Math.abs(side.headerArrowSlot.left - side.rowArrowSlot.left) <= EPS,
        `块头 ${String(side.headerArrowSlot?.left)} vs 行 ${String(side.rowArrowSlot?.left)}`,
      )
      check.ok(
        '箭头那一格：宽与工作区行的折叠箭头同宽（±1px）',
        side.rowArrowSlot !== null && side.headerArrowSlot !== null && Math.abs(side.headerArrowSlot.width - side.rowArrowSlot.width) <= EPS,
        `块头 ${String(side.headerArrowSlot?.width)} vs 行 ${String(side.rowArrowSlot?.width)}`,
      )
      check.ok(
        '箭头是同一枚图标（渲染出的 path@d 逐字相同）',
        side.rowArrowPath !== '' && side.headerArrowPath === side.rowArrowPath,
        `块头 ${side.headerArrowPath === '' ? '缺' : '有'} vs 行 ${side.rowArrowPath === '' ? '缺' : '有'}`,
      )
      check.ok(
        '箭头颜色一致（工作区行折叠箭头的同一枚 token）',
        side.rowArrowColor !== '' && side.headerArrowColor === side.rowArrowColor,
        `块头 ${side.headerArrowColor} vs 行 ${side.rowArrowColor}`,
      )
      // 「同一套展开标记」而不是「此刻同态」：树里工作区行的展开态由视图偏好决定（可能是收起的），
      // 所以判据是**两处用同一套类名写法**、且各自的 `arrowOpen` 与自己的展开态一致。
      const arrowBase = (className: string): string =>
        className
          .split(/\s+/)
          .filter((token) => token !== '' && token !== 'dshOneTree_arrowOpen')
          .join(' ')
      check.eq('两处箭头的基础类名相同（同一套类名写法：dshOneTree_arrow）', arrowBase(side.headerArrowClass), arrowBase(side.rowArrowClass))
      check.eq(
        '两处箭头挂着同一枚展开标记 dshOneTree_arrowOpen，且各自与自己的展开态一致（块头 ← aria-expanded，工作区行 ← aria-expanded）',
        [side.headerArrowClass.includes('dshOneTree_arrowOpen'), side.rowArrowClass.includes('dshOneTree_arrowOpen')],
        [side.headerAriaExpanded === 'true', side.rowAriaExpanded === 'true'],
      )
      check.fact(
        `两处的展开态（各自按自己的 aria-expanded 记）：块头=${side.headerAriaExpanded}（arrowOpen=${String(side.headerArrowOpen)}）` +
          ` 工作区行=${side.rowAriaExpanded}（arrowOpen=${String(side.rowArrowOpen)}；树里工作区行的展开态由视图偏好决定，与块头不必同态）`,
      )
      check.ok(
        '名字那一列：块头名字左缘与工作区行名字同一条竖线（±1px）',
        side.rowName !== null && side.headerName !== null && Math.abs(side.headerName.left - side.rowName.left) <= EPS,
        `块头 ${String(side.headerName?.left)} vs 行 ${String(side.rowName?.left)}`,
      )
      check.ok(
        '名字字号与颜色一致（同一档）',
        side.headerNameFontSize === side.rowNameFontSize && side.headerNameColor === side.rowNameColor,
        `块头 ${String(side.headerNameFontSize)}px ${side.headerNameColor} vs 行 ${String(side.rowNameFontSize)}px ${side.rowNameColor}`,
      )
      check.ok(
        'hover 底色：块头与工作区行是同一枚 token（解析值逐字相同、且非透明）',
        headerHoverBackground === side.rowBackground && headerHoverBackground !== 'rgba(0, 0, 0, 0)',
        `块头 ${headerHoverBackground} vs 行 ${side.rowBackground}`,
      )
      // 「块头不补文件夹图标」按事实记 + 钉住：块头子树里只有箭头一枚 svg，工作区行有文件夹与箭头两枚。
      check.fact(
        `块头子树里的 svg 数=${String(side.headerSvgCount)}（只有箭头那一枚）；工作区行子树里的 svg 数=${String(side.rowSvgCount)}（文件夹 + 悬停显形的箭头）`,
      )
      check.eq('块头子树里只有箭头那一枚图标（不补文件夹图标——补了名字列会被推右 22px）', side.headerSvgCount, 1)
      check.ok('工作区行有文件夹与箭头两枚（两侧的形态差异按事实记）', side.rowSvgCount >= 2, String(side.rowSvgCount))

      // =====================================================================
      // ② 行尾两枚动作：扇出、几何（与主树行尾动作按钮同一档）、文案、危险色
      // =====================================================================
      check.eq('行尾恰好两枚动作（还原 + 永久归档）', side.drawerButtons.length, 2)
      check.eq('两枚动作的标记与顺序（还原在前、归档在后）', side.drawerButtons.map((button) => button.kind), ['restore', 'archive'])
      check.eq(
        '行尾没有常显的 ⋯ 入口（#144 那一枚退场；#154 补的右键那一份只在右键后才渲染，它自己由 F-49 判）',
        side.menus,
        0,
      )
      check.eq('行尾动作组的 column-gap = 官方行尾动作组那一格 12px', side.drawerActionsGap, ACTION_GAP)
      check.ok(
        '两枚之间的实际间隙 = 12px（盒子边到边，±1px）',
        side.drawerButtons[0]?.box != null && side.drawerButtons[1]?.box != null &&
          Math.abs(side.drawerButtons[1].box.left - side.drawerButtons[0].box.right - ACTION_GAP) <= EPS,
        `还原右缘 ${String(side.drawerButtons[0]?.box?.right)} → 归档左缘 ${String(side.drawerButtons[1]?.box?.left)}`,
      )
      for (const entry of side.drawerButtons) {
        check.ok(
          `${entry.kind}：按钮 ${SCALE_TIERS.standard.rowIconButtonSize}×${SCALE_TIERS.standard.rowIconButtonSize}（标准档 rowIconButtonSize，与主树行尾动作按钮同一档），` +
            `实测 ${entry.box === null ? '缺' : `${String(entry.box.width)}×${String(entry.box.height)}`}`,
          entry.box !== null &&
            Math.abs(entry.box.width - px(SCALE_TIERS.standard.rowIconButtonSize)) <= SIZE_EPS &&
            Math.abs(entry.box.height - px(SCALE_TIERS.standard.rowIconButtonSize)) <= SIZE_EPS,
          showButtons(side),
        )
        check.eq(`${entry.kind}：圆角 = 标准档 rowIconButtonRadius`, entry.radius, px(SCALE_TIERS.standard.rowIconButtonRadius))
        check.ok(
          `${entry.kind}：行内图标 = 16（16 档图标画在自己的格里）`,
          entry.icon !== null &&
            Math.abs(entry.icon.width - px(SCALE_TIERS.standard.rowIconButtonSize)) <= SIZE_EPS &&
            Math.abs(entry.icon.height - px(SCALE_TIERS.standard.rowIconButtonSize)) <= SIZE_EPS,
          entry.icon === null ? '图标缺' : `${String(entry.icon.width)}×${String(entry.icon.height)}`,
        )
        check.ok(
          `${entry.kind}：aria-label 在场（可及名不靠图标猜）`,
          entry.ariaLabel !== '',
          entry.ariaLabel,
        )
      }
      check.ok(
        '两枚的几何与主树工作区行的行尾动作按钮逐项相等（同一档：尺寸 / 圆角）',
        side.rowAction !== null &&
          side.drawerButtons.every(
            (entry) =>
              entry.box !== null &&
              Math.abs(entry.box.width - side.rowAction!.width) <= SIZE_EPS &&
              Math.abs(entry.box.height - side.rowAction!.height) <= SIZE_EPS,
          ),
        `抽屉 ${showButtons(side)}；主树行尾动作按钮 ${JSON.stringify(side.rowAction)}（圆角 ${String(side.rowActionRadius)}）`,
      )
      check.eq('抽屉动作按钮的圆角与主树行尾动作按钮相同', side.drawerButtons[0]?.radius, side.rowActionRadius)
      // 文案：aria-label 与 Tooltip（词典代入会话名）。
      check.eq('还原的 aria-label = 词典 recycle.restore.aria（代入会话名）', side.drawerButtons[0]?.ariaLabel, say('recycle.restore.aria', side.drawerTitleText))
      check.eq('归档的 aria-label = 词典 recycle.archive.aria（代入会话名）', side.drawerButtons[1]?.ariaLabel, say('recycle.archive.aria', side.drawerTitleText))
      const restoreTooltip = await hoverTooltip(page, RESTORE)
      check.ok('还原带官方 Tooltip 且文案 = 词典 recycle.restore', restoreTooltip.includes(ZH['recycle.restore'] ?? ''), JSON.stringify(restoreTooltip))
      const archiveTooltip = await hoverTooltip(page, ARCHIVE)
      check.ok(
        '归档带官方 Tooltip 且文案 = 词典 menu.archiveForever（永久归档）',
        archiveTooltip.includes(ZH['menu.archiveForever'] ?? ''),
        JSON.stringify(archiveTooltip),
      )
      // 危险色：与同一枚官方 token 的解析值逐字相同，且与「还原」不同色。
      const errorToken = await errorTokenValue(page)
      check.ok(
        '归档按错误色（终点动作）：解析值 = 官方 token --dsw-alias-state-error-primary 的解析值',
        side.drawerButtons[1]?.color === errorToken,
        `归档 ${String(side.drawerButtons[1]?.color)} token ${errorToken}`,
      )
      check.ok(
        '归档与还原不同色（危险动作在行上分得开）',
        side.drawerButtons[0]?.color !== side.drawerButtons[1]?.color,
        `还原 ${String(side.drawerButtons[0]?.color)} 归档 ${String(side.drawerButtons[1]?.color)}`,
      )
      screenshots.push(await shot(page, 'recycle-drawer-row-actions'))

      // =====================================================================
      // ③ 三档宽度不溢出；140px 让标题真被省略号截断
      // =====================================================================
      for (const width of [260, 340, 500] as const) {
        await page.setViewportSize({ width, height: 900 })
        await page.waitForTimeout(300)
        const reading = await readSide(page)
        check.fact(
          `@${String(width)}：行=${JSON.stringify(reading.drawerRow)} 标题=[${String(reading.drawerTitle?.left)},${String(reading.drawerTitle?.right)}] ` +
            `动作组=[${String(reading.drawerActions?.left)},${String(reading.drawerActions?.right)}] ${showButtons(reading)}`,
        )
        const overflow = await page.evaluate(() => ({
          doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          row: (document.querySelector('.dshOneTree_drawerRow')?.scrollWidth ?? 0) - (document.querySelector('.dshOneTree_drawerRow')?.clientWidth ?? 0),
          list: (document.querySelector('.dshOneTree_drawerList')?.scrollWidth ?? 0) - (document.querySelector('.dshOneTree_drawerList')?.clientWidth ?? 0),
        }))
        check.ok(
          `@${String(width)} 行 / 列表 / 文档都不横向溢出（scrollWidth ≤ clientWidth + 1）`,
          reading.drawerRow !== null && reading.drawerRowScrollWidth <= reading.drawerRowClientWidth + 1 && overflow.list <= 1 && overflow.doc <= 1,
          JSON.stringify(overflow),
        )
        check.ok(
          `@${String(width)} 最右一枚（归档）的右缘 = 行的内容右缘（±1px）`,
          reading.drawerRow !== null &&
            reading.drawerButtons[1]?.box != null &&
            Math.abs(reading.drawerButtons[1].box.right - (reading.drawerRow.right - px(SCALE_TIERS.standard.rowPaddingInline))) <= EPS,
          `归档右缘 ${String(reading.drawerButtons[1]?.box?.right)} vs 行内容右缘 ${String((reading.drawerRow?.right ?? 0) - px(SCALE_TIERS.standard.rowPaddingInline))}`,
        )
        check.ok(
          `@${String(width)} 两枚动作整个落在行里、都不为 0`,
          reading.drawerRow !== null &&
            reading.drawerButtons.length === 2 &&
            reading.drawerButtons.every(
              (entry) =>
                entry.box !== null && entry.box.width > 0 && entry.box.left >= reading.drawerRow!.left && entry.box.right <= reading.drawerRow!.right,
            ),
          showButtons(reading),
        )
        check.eq(
          `@${String(width)} 标题走省略号那条路（text-overflow ellipsis + nowrap；min-width:0 让它能缩）`,
          [reading.drawerTitleTextOverflow, reading.drawerTitleWhiteSpace],
          ['ellipsis', 'nowrap'],
        )
      }
      // 140px：标题**真的**被省略号截断（文字让位），两枚动作的位置与尺寸一分不动。
      // 两件事保证这条判据不依赖当天数据：① 压到 140px（行里的固定件——时间 + 两枚动作 +
      // 间隙——加起来约 100px，200px 下标题那一格还有 100px 出头、够装标题，量不到截断，
      // 这一条曾经就是这么软掉的）；② 标题是 {@link LONG_TITLE} 那份夹具给的长文案
      //（装不下是设计出来的，不是碰运气），前面已经断言抽屉行显示的就是它。
      await page.setViewportSize({ width: 140, height: 900 })
      await page.waitForTimeout(300)
      const narrow = await readSide(page)
      check.fact(
        `@140：行=[${String(narrow.drawerRow?.left)},${String(narrow.drawerRow?.right)}] 标题「${narrow.drawerTitleText}」scrollWidth ${String(narrow.drawerTitleScrollWidth)} / clientWidth ${String(narrow.drawerTitleClientWidth)} 动作组=${JSON.stringify(narrow.drawerActions)} ${showButtons(narrow)}`,
      )
      check.ok(
        '@140 标题真被省略号截断（文字让位给行尾那两枚动作；标题是夹具给的长文案，必然装不下）',
        narrow.drawerTitleScrollWidth > narrow.drawerTitleClientWidth && narrow.drawerTitleText === LONG_TITLE,
        `scrollWidth ${String(narrow.drawerTitleScrollWidth)} / clientWidth ${String(narrow.drawerTitleClientWidth)} 标题「${narrow.drawerTitleText.slice(0, 12)}…」`,
      )
      check.ok(
        '@140 两枚动作仍在行里、宽度没被挤小',
        narrow.drawerButtons.length === 2 &&
          narrow.drawerButtons.every((entry) => entry.box !== null && Math.abs(entry.box.width - px(SCALE_TIERS.standard.rowIconButtonSize)) <= SIZE_EPS),
        showButtons(narrow),
      )
      check.ok(
        '@140 标题右缘不超过动作组左缘（让位的就是文字）',
        narrow.drawerTitle !== null && narrow.drawerActions !== null && narrow.drawerTitle.right <= narrow.drawerActions.left + EPS,
        `标题右缘 ${String(narrow.drawerTitle?.right)} vs 动作组左缘 ${String(narrow.drawerActions?.left)}`,
      )
      check.ok(
        '@140 行自身仍不横向溢出（scrollWidth ≤ clientWidth + 1）',
        narrow.drawerRowScrollWidth <= narrow.drawerRowClientWidth + 1,
        `scrollWidth ${String(narrow.drawerRowScrollWidth)} / clientWidth ${String(narrow.drawerRowClientWidth)}`,
      )
      screenshots.push(await shot(page, 'recycle-drawer-row-narrow-140'))
      await page.setViewportSize({ width: 340, height: 900 })
      await page.waitForTimeout(300)

      // =====================================================================
      // ④ 点动作不顺带打开会话；归档开的是确认弹窗、取消后零请求
      // =====================================================================
      const hostCalls = async (): Promise<string[]> =>
        page.evaluate(() =>
          ((globalThis as unknown as { __LAB_HOST__?: { hostCalls?: { call: string }[] } }).__LAB_HOST__?.hostCalls ?? []).map((entry) => entry.call),
        )
      const apiBefore = apiCalls.length
      const callsBefore = await hostCalls()
      await page.click(ARCHIVE)
      await page.waitForTimeout(400)
      const callsAfterArchive = await hostCalls()
      check.eq(
        '点「归档」不打开会话（新增的宿主调用里没有任何 session.*）',
        callsAfterArchive.slice(callsBefore.length).filter((call) => call.startsWith('session.')),
        [],
      )
      const confirm = await page.evaluate(() => ({
        button: document.querySelector('[data-dshone-tree-action="archive-confirm"]') !== null,
        rows: document.querySelectorAll('[data-dshone-archive-row]').length,
      }))
      check.fact(`归档确认弹窗：${JSON.stringify(confirm)}`)
      check.ok('点「归档」开的是既有的归档确认弹窗（终点动作先过确认）', confirm.button && confirm.rows >= 1, JSON.stringify(confirm))
      screenshots.push(await shot(page, 'recycle-drawer-row-archive-confirm'))
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
      check.eq('取消确认 → 弹窗关掉', await page.locator('[data-dshone-tree-action="archive-confirm"]').count(), 0)
      const binAfterCancel = await hostBin(page)
      check.eq('取消确认 → 回收站状态一条不少', binAfterCancel.ids, ids)
      // 这一趟的只读守卫：判「没有写类方法」而不是「一个请求都没有」——页面自己会按它的
      // 节奏轮询读接口（实测这一趟里出现过 `session/list` / `settings/describe` /
      // `dynamicCordisRunner/*` 这些读类调用，与点不点归档无关）；把那些算成失败等于拿
      // 别人的心跳判我们的动作。写类方法一个都不许有才是这条要守的事（#154 起记录器不再
      // 被夹具的 fetch 绕过，这条断言这才真的看得到东西）。
      check.fact(`点归档 + 取消这一趟走过的 /api/ 方法：${JSON.stringify(apiCalls.slice(apiBefore))}`)
      check.eq(
        '点归档 + 取消这一趟：没有任何写类 /api/ 方法（没有落到网关的写面）',
        apiCalls.slice(apiBefore).filter((call) => /archive|delete|write|rename|create|fork/i.test(call)),
        [],
      )
      // 若 Esc 也把抽屉带走了（抽屉的 Esc 与弹窗的 Esc 是两条独立路径），把它重新打开再继续。
      if ((await page.locator(DRAWER_ROW).count()) === 0) {
        check.fact('取消确认后抽屉跟着 Esc 一起关掉了（既有路径，与本次改动无关）——重新打开继续')
        await page.click('[data-dshone-tree-action="recycle-toggle"]')
        await page.waitForTimeout(400)
      }

      // =====================================================================
      // ⑤ 折叠语义一字未改：点击开合、折叠态持久化、aria-expanded 跟着翻（放在还原之前——
      // 还原会把夹具那几条会话移出回收站，块空了之后这一段的「点块头开合」就没有对象了）
      // =====================================================================
      const blockKey = await page.getAttribute(GROUP_HEADER, 'data-dshone-recycle-group-toggle')
      check.ok('块头带块键标记（折叠态落客户端存储要用它）', (blockKey ?? '') !== '', String(blockKey))
      await page.click(GROUP_HEADER)
      await page.waitForTimeout(300)
      const collapsed = await page.evaluate((key: string) => {
        const toggle = document.querySelector(`[data-dshone-recycle-group-toggle="${key}"]`)
        const block = document.querySelector(`[data-dshone-recycle-group="${key}"]`)
        return {
          flag: toggle?.getAttribute('data-dshone-recycle-collapsed') ?? '',
          aria: toggle?.getAttribute('aria-expanded') ?? '',
          rows: block?.querySelectorAll('[data-dshone-recycle-row]').length ?? -1,
          arrowOpen: (document.querySelector(`${'.dshOneTree_drawerGroupLabel'} .dshOneTree_drawerGroupArrow svg`)?.getAttribute('class') ?? '').includes(
            'dshOneTree_arrowOpen',
          ),
          prefs: localStorage.getItem('dsh.workspaceTree.view') ?? '',
        }
      }, blockKey ?? '')
      check.fact(`收起后：flag=${collapsed.flag} aria=${collapsed.aria} rows=${String(collapsed.rows)} prefs=${collapsed.prefs}`)
      check.eq('点块头收起：标记翻成 true 且 aria-expanded=false', [collapsed.flag, collapsed.aria], ['true', 'false'])
      check.eq('收起后该块的行不再渲染', collapsed.rows, 0)
      check.eq('收起后箭头转成「收起」那一态（不再挂 arrowOpen）', collapsed.arrowOpen, false)
      check.ok('折叠态落客户端存储（recycleCollapsed + 块键）', collapsed.prefs.includes('recycleCollapsed') && collapsed.prefs.includes(blockKey ?? ''))
      // 重载：折叠态从客户端存储读回。
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector(route('sidebar').readySelector, { timeout: 40_000 })
      await page.waitForTimeout(2_500)
      await page.click('[data-dshone-tree-action="recycle-toggle"]')
      await page.waitForTimeout(400)
      check.eq('重载后折叠态仍在（aria-expanded=false）', await page.getAttribute(`[data-dshone-recycle-group-toggle="${blockKey ?? ''}"]`, 'aria-expanded'), 'false')
      await page.click(GROUP_HEADER)
      await page.waitForTimeout(300)
      const expanded = await page.evaluate((key: string) => {
        const toggle = document.querySelector(`[data-dshone-recycle-group-toggle="${key}"]`)
        const block = document.querySelector(`[data-dshone-recycle-group="${key}"]`)
        return {
          flag: toggle?.getAttribute('data-dshone-recycle-collapsed') ?? '',
          aria: toggle?.getAttribute('aria-expanded') ?? '',
          rows: block?.querySelectorAll('[data-dshone-recycle-row]').length ?? -1,
        }
      }, blockKey ?? '')
      check.eq('再点一下展开回来（标记 false / aria-expanded=true / 行回来）', [expanded.flag, expanded.aria, expanded.rows > 0], ['false', 'true', true])

      // =====================================================================
      // ⑥ 还原：busy（有动作在飞）时两枚都禁用 → 一条本地请求（不落网关）
      // =====================================================================
      // 抽屉里块内按移入顺序**倒序**，所以第一行是夹具里后注入的那条——要认准**点的是哪一行**，
      // 别按 ids[0] 猜（这一条曾经就是这么错的：点了 ids[1] 的还原、却去数 ids[0] 的行）。
      const target = await page.getAttribute(RESTORE, 'data-dshone-recycle-restore')
      check.ok('取到要点还原的那一行（行尾按钮带它的会话 id）', (target ?? '') !== '', String(target))
      if (target === null || target === '') return screenshots
      const writesBefore = (await hostBin(page)).writes
      // 「有动作在飞」不是瞬间：把假宿主对 `recycle-bin` 的写入按住不放行（#144 的注入点），
      // busy 态因此可以被稳定读出来——不按的话这一拍短得读不到（实测点下去那一刻已经回执了）。
      await page.evaluate(() => {
        const host = (globalThis as unknown as { __LAB_HOST__: { holdStateWrite: string | null } }).__LAB_HOST__
        host.holdStateWrite = 'recycle-bin'
      })
      await page.click(RESTORE)
      await page.waitForTimeout(400)
      const busyProbe = await page.evaluate(([restoreSelector, archiveSelector]) => {
        const read = (selector: string): { disabled: boolean; opacity: string } | null => {
          const element = document.querySelector(selector) as HTMLButtonElement | null
          return element === null ? null : { disabled: element.disabled, opacity: getComputedStyle(element).opacity }
        }
        return { restore: read(restoreSelector), archive: read(archiveSelector) }
      }, [RESTORE, ARCHIVE] as const)
      check.fact(`按住写入期间的 busy 读数：${JSON.stringify(busyProbe)}`)
      check.eq('busy（有动作在飞）时两枚动作都禁用', [busyProbe.restore?.disabled, busyProbe.archive?.disabled], [true, true])
      check.ok(
        'busy 时两枚都有灰态（`opacity` 降到 1 以下）',
        px(busyProbe.restore?.opacity ?? '1') < 1 && px(busyProbe.archive?.opacity ?? '1') < 1,
        JSON.stringify(busyProbe),
      )
      screenshots.push(await shot(page, 'recycle-drawer-row-busy'))
      // 放行：写入落定，回执回来，busy 结束。
      await page.evaluate(() => {
        const host = (globalThis as unknown as { __LAB_HOST__: { holdStateWrite: string | null; releaseHeld(): void } }).__LAB_HOST__
        host.holdStateWrite = null
        host.releaseHeld()
      })
      await page.waitForTimeout(900)
      const binAfterRestore = await hostBin(page)
      check.eq('还原只把点的那一条移出本地集合（其余条目原样）', binAfterRestore.ids, ids.filter((id) => id !== target))
      check.eq('还原落一条本地状态写入（state.write 的 recycle-bin，不落网关）', binAfterRestore.writes - writesBefore, 1)
      check.eq('还原后那一行从抽屉里消失', await page.locator(`${DRAWER_ROW}[data-dshone-recycle-row="${target}"]`).count(), 0)
      check.fact(`还原这一趟走过的 /api/ 方法：${JSON.stringify(apiCalls.slice(apiBefore))}`)
      check.eq(
        '还原这一趟同样没有任何写类 /api/ 方法（本地可逆那一层不碰网关写面）',
        apiCalls.slice(apiBefore).filter((call) => /archive|delete|write|rename|create|fork/i.test(call)),
        [],
      )
      await page.click('[data-dshone-tree-action="recycle-close"]')
      await page.waitForTimeout(400)
      // 「回到树里」不能直接数行：那一条会话所在的工作区分组可能是收起的（展开态是视图偏好，
      // 与当天数据无关但与本套件无关）——先把整棵树展开再数，判据才只看「会话在不在树里」。
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if ((await page.getAttribute('[data-dshone-tree-action="collapse-all"]', 'data-dshone-tree-collapsed')) === 'false') break
        await page.click('[data-dshone-tree-action="collapse-all"]')
        await page.waitForTimeout(300)
      }
      check.eq('还原后会话回到树里（先把树展开，免得量到的是「那一组恰好收起」）', await page.locator(`[data-dshone-tree-session="${target}"]`).count(), 1)
      await page.click('[data-dshone-tree-action="recycle-toggle"]')
      await page.waitForTimeout(400)

      check.eq(
        '全程只读网关：没有任何写类 /api/ 方法',
        apiCalls.filter((call) => /archive|delete|write|rename|create|fork/i.test(call)),
        [],
      )
      check.eq('抽屉行与块头套件全程零 pageerror', withoutKnownNoise(opened.capture.pageErrors).real, [])
    } finally {
      await opened.context.close()
    }
    return screenshots
  },
}
