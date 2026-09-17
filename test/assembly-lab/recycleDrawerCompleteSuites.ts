/**
 * 回收站抽屉补齐（#154，RECYCLE-DRAWER-COMPLETE 套件）：抽屉头三样（返回 / 清空 / 恢复全部）
 * + 行的右键入口 / 状态点 / 图钉。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与 `recycleDrawerRowSuites.ts`（F-45）/
 * `recycleEntryAlignSuites.ts`（F-38）同一条：那个文件是本批开发的合入热点，新套件放外面
 * 能少一半冲突面。注册方式是在 `suites.ts` 的 `SUITES` 末尾追加一项。
 *
 * **这一条与相邻套件的分工**：F-15 管回收站两层语义与抽屉的存在 / 分块 / 折叠，F-45 管块头
 * 与行尾两枚动作的几何，F-24 管抽屉开合的动效，F-38 管底部入口行那一行的几何。本条只管
 * **#154 这一轮补进来的四件事**：① 抽屉头的返回 / 清空 / 恢复全部（在场、形态、动作与出口），
 * ② 行的右键菜单（与行尾两枚动作同一份项），③ 行上的状态点，④ 行上的图钉。
 *
 * **官方有没有对应物（#154 的口径）**：官方 0.1.6-alpha.1 的
 * `@deepseek-ai/dsh-client-ui-settings-unarchive-sessions` 是一页**设置页 section**（已归档
 * 会话清单 + 每行一枚「取消归档」按钮），头部没有返回也没有批量动作、行上没有状态点也没有
 * 图钉——所以这四件事都照旧侧栏正本（`src/ui/sessionsWebview.ts` 的 `renderRecycleHeader` /
 * `renderRecycleSessionRow`）补，逐条理由写在 `recycleDrawer.ts` 的文件头。
 *
 * **动作顺序为什么这么排**：主树那一侧的交互（行菜单「移入回收站」/「标为未读」）必须在
 * **抽屉关着**的时候做——抽屉半高盖住列表下半块，盖住的那一行悬停不到、⋯ 按钮不会显形。
 * 所以本套件的顺序是：① 抽屉关着时读主树的点与图钉、用既有行菜单造现场 → ② 开抽屉量抽屉里
 * 的一切 → ③ 收尾（恢复全部、空集合那一页）。
 *
 * **判据为什么这么写**：
 * - 期望值一律从档位表（`SCALE_TIERS`）与插件 zh 词典（`ZH`）读，不硬编码；
 * - 「状态点与主树同一口径」要判的是**同一个会话**，所以夹具给的那条先让它在主树里跑起来
 *   （页内夹具翻 `session/list` 回执的 `running`，请求不落网关），读一次点，再用**既有的**
 *   行菜单「移入回收站」把它挪进抽屉，再读一次——两次读数必须逐项相同；
 * - 「图钉与主树同一枚」用两个会话并排判：一条在抽屉里（夹具注入的「已置顶 + 已在回收站」，
 *   这个组合界面本身造不出来——置顶的会话不许移入回收站，所以只能由夹具注入）、一条留在主树
 *   （夹具只把它置顶），比的是同一枚标记（类名 / `path@d` / 几何 / 与标题的左右关系）；
 * - 「未读」那一档同理：抽屉里那一条由夹具注入未读，主树那一条用**既有的**行菜单「标为未读」
 *   现场造出来，两侧比点的 `data-state`、读屏文案与标题字重。
 *
 * 全程只读真网关（只写假宿主的 `recycle-bin` / `pinned`——那两个状态本来就在 dsh 自己的
 * 目录里，不是网关的写面），零 pageerror；本套件**从不点归档确认**（那会写真实网关）。
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

const DRAWER = '[data-dshone-tree="recycle-drawer"]'
const HEADER = '.dshOneTree_drawerHeader'
const HEADING = '.dshOneTree_drawerHeading'
const TITLE = '.dshOneTree_drawerTitle'
const COUNT = '.dshOneTree_drawerCount'
const BACK = '[data-dshone-tree-action="recycle-close"]'
const HEADER_EMPTY = '[data-dshone-tree-action="recycle-drawer-empty-all"]'
const HEADER_RESTORE_ALL = '[data-dshone-tree-action="recycle-drawer-restore-all"]'
const ENTRY_EMPTY = '[data-dshone-tree-action="recycle-empty-all"]'
const ENTRY_RESTORE_ALL = '[data-dshone-tree-action="recycle-restore-all"]'
const ENTRY_MAIN = '[data-dshone-tree-action="recycle-toggle"]'
const DRAWER_ROWS = '[data-dshone-recycle-row]'
const MENU_RESTORE = '[data-dshone-tree-item="recycle-restore"]'
const MENU_ARCHIVE = '[data-dshone-tree-item="recycle-archive"]'
const CONFIRM = '[data-dshone-tree-action="archive-confirm"]'

/**
 * 写类 `/api/` 方法的判定（只读守卫用）。
 *
 * 为什么判「有没有写类方法」而不是「一个请求都没有」：页面自己会按它的节奏轮询读接口
 * （实测这些窗口里出现过 `session/list` / `settings/describe` / `dynamicCordisRunner/*`
 * 这些读类调用），拿别人的心跳判我们的动作会把套件变成看运气。写类方法一个都不许有，
 * 才是这几条要守的事。
 */
const WRITE_METHOD = /archive|delete|write|rename|create|fork/i

/** 关系量容差 1px；尺寸读数 0.5px。 */
const EPS = 1
const SIZE_EPS = 0.5

const px = (value: string | undefined): number => Number.parseFloat(value ?? 'NaN')

interface Box {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
}

/** 一枚图标渲染出来的形状指纹（`path/rect/circle` 的几何属性，不带尺寸与类名）。 */
interface IconFact {
  viewBox: string
  width: string
  height: string
  shapes: string[]
}

interface HeaderFacts {
  back: { box: Box; aria: string; title: string; icon: IconFact | null; name: string } | null
  empty: { box: Box; aria: string; disabled: boolean; color: string; icon: IconFact | null; radius: string } | null
  restoreAll: { box: Box; aria: string; disabled: boolean; color: string; icon: IconFact | null; radius: string } | null
  entryEmpty: { box: Box; aria: string; disabled: boolean; color: string; icon: IconFact | null; radius: string } | null
  entryRestoreAll: { box: Box; aria: string; disabled: boolean; color: string; icon: IconFact | null; radius: string } | null
  header: Box | null
  heading: Box | null
  headingGap: number
  title: Box | null
  titleText: string
  count: Box | null
  countText: string
  row: Box | null
  rowSlot: Box | null
  rowDot: { state: string; box: Box; color: string; viewBox: string; shapeCount: number } | null
  rowPin: Box | null
  rowPinIcon: IconFact | null
  rowTitle: Box | null
  /** 抽屉里此刻有几行（计数与行数的关系量）。 */
  rows: number
  /** 页面上还剩几枚常显的 ⋯ 入口（#144 退场后必须是 0）。 */
  explicitMenus: number
}

/** 读一次抽屉头 + 指定那一行的几何与关键读数（元素不在就记 null，不抛）。 */
async function readDrawer(
  page: OpenedPage['page'],
  rowId: string,
): Promise<HeaderFacts> {
  return page.evaluate(
    ([
      headerSelector,
      headingSelector,
      titleSelector,
      countSelector,
      backSelector,
      emptySelector,
      restoreSelector,
      entryEmptySelector,
      entryRestoreSelector,
      rowSelector,
    ]) => {
      const round = (value: number): number => Math.round(value * 100) / 100
      const box = (element: Element | null): Box | null => {
        if (element === null) return null
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
      const icon = (element: Element | null): IconFact | null => {
        const svg = element?.querySelector('svg') ?? null
        if (svg === null) return null
        return {
          viewBox: svg.getAttribute('viewBox') ?? '',
          width: svg.getAttribute('width') ?? '',
          height: svg.getAttribute('height') ?? '',
          shapes: Array.from(svg.querySelectorAll('path,rect,circle')).map(
            (shape) =>
              `${shape.tagName.toLowerCase()}|${shape.getAttribute('d') ?? ''}|${shape.getAttribute('cx') ?? ''}|${shape.getAttribute('x') ?? ''}`,
          ),
        }
      }
      const button = (
        selector: string,
      ): { box: Box; aria: string; disabled: boolean; color: string; icon: IconFact | null; radius: string } | null => {
        const element = document.querySelector(selector) as HTMLButtonElement | null
        const rect = box(element)
        if (element === null || rect === null) return null
        return {
          box: rect,
          aria: element.getAttribute('aria-label') ?? '',
          disabled: element.disabled,
          color: getComputedStyle(element).color,
          icon: icon(element),
          radius: getComputedStyle(element).borderTopLeftRadius,
        }
      }
      const header = document.querySelector(headerSelector)
      const back = document.querySelector(backSelector)
      const backBox = box(back)
      const heading = header?.querySelector(headingSelector) ?? null
      const title = header?.querySelector(titleSelector) ?? null
      const count = header?.querySelector(countSelector) ?? null
      const row = document.querySelector(rowSelector)
      const slot = row?.querySelector('.dshOneTree_slot') ?? null
      const dot = slot?.querySelector('[data-state]') ?? null
      const dotBox = box(dot)
      const pin = row?.querySelector('.dshOneTree_pin') ?? null
      return {
        back:
          back === null || backBox === null
            ? null
            : {
                box: backBox,
                aria: back.getAttribute('aria-label') ?? '',
                title: back.getAttribute('title') ?? '',
                icon: icon(back),
                name: back.getAttribute('data-dshone-tree-icon') ?? '',
              },
        empty: button(emptySelector),
        restoreAll: button(restoreSelector),
        entryEmpty: button(entryEmptySelector),
        entryRestoreAll: button(entryRestoreSelector),
        header: box(header),
        heading: box(heading),
        headingGap: heading === null ? -1 : Number.parseFloat(getComputedStyle(heading).columnGap) || 0,
        title: box(title),
        titleText: (title?.textContent ?? '').trim(),
        count: box(count),
        countText: (count?.textContent ?? '').trim(),
        row: box(row),
        rowSlot: box(slot),
        rowDot:
          dot === null || dotBox === null
            ? null
            : {
                state: dot.getAttribute('data-state') ?? '',
                box: dotBox,
                color: getComputedStyle(dot).color,
                viewBox: dot.getAttribute('viewBox') ?? '',
                shapeCount: dot.querySelectorAll('rect,path,circle').length,
              },
        rowPin: box(pin),
        rowPinIcon: icon(pin),
        rowTitle: box(row?.querySelector('.dshOneTree_title') ?? null),
        rows: document.querySelectorAll('[data-dshone-recycle-row]').length,
        explicitMenus: document.querySelectorAll('[data-dshone-recycle-menu]').length,
      }
    },
    [
      HEADER,
      HEADING,
      TITLE,
      COUNT,
      BACK,
      HEADER_EMPTY,
      HEADER_RESTORE_ALL,
      ENTRY_EMPTY,
      ENTRY_RESTORE_ALL,
      // 没给会话 id 时用一个必然匹配不到的选择器（空集合那一页量不到行）。
      rowId === '' ? '[data-dshone-recycle-row="__none__"]' : `[data-dshone-recycle-row="${rowId}"]`,
    ] as const,
  )
}

/** 一枚图标单独读一次（元素不在就是 null）。 */
async function readIcon(page: OpenedPage['page'], selector: string): Promise<IconFact | null> {
  return page.evaluate((sel) => {
    const svg = document.querySelector(sel)?.querySelector('svg') ?? null
    if (svg === null) return null
    return {
      viewBox: svg.getAttribute('viewBox') ?? '',
      width: svg.getAttribute('width') ?? '',
      height: svg.getAttribute('height') ?? '',
      shapes: Array.from(svg.querySelectorAll('path,rect,circle')).map(
        (shape) =>
          `${shape.tagName.toLowerCase()}|${shape.getAttribute('d') ?? ''}|${shape.getAttribute('cx') ?? ''}|${shape.getAttribute('x') ?? ''}`,
      ),
    }
  }, selector)
}

/** 主树一行的矩形（只用到这四项，与 `Box` 分开写免得要求 top/bottom）。 */
interface Rect {
  left: number
  right: number
  width: number
  height: number
}

/** 主树一行上的状态点与图钉（判「与主树同一口径」的那一侧）。 */
async function readTreeRow(
  page: OpenedPage['page'],
  sessionId: string,
): Promise<{
  dot: { state: string; viewBox: string; shapeCount: number; color: string } | null
  slot: Rect | null
  pin: Rect | null
  title: Rect | null
  titleWeight: string
  readLabels: string
}> {
  return page.evaluate((id) => {
    const round = (value: number): number => Math.round(value * 100) / 100
    const box = (element: Element | null): Rect | null => {
      if (element === null) return null
      const rect = element.getBoundingClientRect()
      return { left: round(rect.left), right: round(rect.right), width: round(rect.width), height: round(rect.height) }
    }
    const row = document.querySelector(`[data-dshone-tree-session="${id}"]`)
    const slot = row?.querySelector('.dshOneTree_slot') ?? null
    const dot = slot?.querySelector('[data-state]') ?? null
    const pin = row?.querySelector('.dshOneTree_pin') ?? null
    const title = row?.querySelector('.dshOneTree_title') ?? null
    return {
      dot:
        dot === null
          ? null
          : {
              state: dot.getAttribute('data-state') ?? '',
              viewBox: dot.getAttribute('viewBox') ?? '',
              shapeCount: dot.querySelectorAll('rect,path,circle').length,
              color: getComputedStyle(dot).color,
            },
      slot: box(slot),
      pin: box(pin),
      title: box(title),
      titleWeight: title === null ? '' : getComputedStyle(title).fontWeight,
      readLabels: Array.from(row?.querySelectorAll('.dshOneTree_visuallyHidden') ?? [])
        .map((node) => node.textContent ?? '')
        .join('|'),
    }
  }, sessionId)
}

/** 反色 token 的解析值（拿同一枚 token 挂探针元素上量，不写死色值）。 */
async function tokenValue(page: OpenedPage['page'], token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement('div')
    probe.style.color = `var(${name})`
    document.body.append(probe)
    const value = getComputedStyle(probe).color
    probe.remove()
    return value
  }, token)
}

/** 假宿主里 `recycle-bin` 的状态与它被写过的次数。 */
async function hostBin(page: OpenedPage['page']): Promise<{ ids: string[]; writes: number }> {
  return page.evaluate(() => {
    const host = (globalThis as unknown as {
      __LAB_HOST__?: {
        stateStore?: Record<string, { sessionIds?: string[] }>
        hostCalls?: { call: string; args?: { key?: string } }[]
      }
    }).__LAB_HOST__
    return {
      ids: host?.stateStore?.['recycle-bin']?.sessionIds ?? [],
      writes: (host?.hostCalls ?? []).filter((entry) => entry.call === 'state.write' && entry.args?.key === 'recycle-bin').length,
    }
  })
}

/**
 * 页内夹具：把 `session/list` 回执里**指定会话**的 `running` 翻成 true，并把走过的
 * `/api/` 方法名记一笔（只读守卫）。
 *
 * 为什么用夹具：状态点的数据源是官方会话列表投影，本机网关当天没有跑着的会话，而套件不许写
 * 网关（R-06 只读守卫）。夹具只改**页面收到的回执**、请求不落网关（与 F-39 的 `running` 夹具
 * 同一处置），装完要**重载页面**才生效。
 *
 * **认哪两个字段（#154：F-45 那处同类坑的修法在这里一次做对）**：会话 id 在 `id` 上
 * （`sessionId` 是旧字段，两种都认），只翻 `running` 一格；命中条数由调用方断言，夹具没接上
 * 就当场红，不会静默退化成「两边都没点」。
 */
async function installRunningFixture(
  page: OpenedPage['page'],
  sessionId: string,
  onApiCall?: (method: string) => void,
): Promise<{ calls: number; touched: number }> {
  const stats = { calls: 0, touched: 0 }
  await page.route('**/api/**', async (requestRoute) => {
    const request = requestRoute.request()
    const method = decodeURIComponent(request.url()).split('/api/')[1] ?? ''
    // 不是会话清单的请求交给更早注册的那条处理器（只读守卫的原样转发）：`fallback()` 而不是
    // `fetch()`——用 fetch 会绕过它，收尾那条「零写类请求」的断言就成了一句空话。
    if (!method.startsWith('session/list')) {
      await requestRoute.fallback()
      return
    }
    onApiCall?.(method)
    stats.calls += 1
    const response = await requestRoute.fetch()
    const body = await response.text()
    const parsed = JSON.parse(body) as {
      result?: { value?: { items?: { id?: string; sessionId?: string; running?: boolean }[] } }
    }
    for (const item of parsed.result?.value?.items ?? []) {
      if ((item.id ?? item.sessionId ?? '') !== sessionId) continue
      item.running = true
      stats.touched += 1
    }
    await requestRoute.fulfill({ response, body: JSON.stringify(parsed) })
  })
  return stats
}

/** 悬停某一行 → 点它那一枚 ⋯ → 点菜单里的一项（既有路径，与 F-15 同做法）。 */
async function clickRowMenuItem(page: OpenedPage['page'], sessionId: string, item: string): Promise<void> {
  const row = page.locator(`[data-dshone-tree-session="${sessionId}"]`)
  await row.hover()
  await row.locator('.dshOneTree_rowIconButton').click()
  await page.waitForTimeout(250)
  await page.click(`[data-dshone-tree-item="${item}"]`)
  await page.waitForTimeout(300)
}

/** 三档宽度下这一页有没有横向溢出（抽屉头 / 抽屉列表 / 行 / 列表 / 文档）。 */
async function overflowFacts(
  page: OpenedPage['page'],
): Promise<{ doc: number; list: number; header: number; row: number; drawer: number }> {
  return page.evaluate(
    ([headerSelector, rowSelector]) => {
      const over = (selector: string): number => {
        const element = document.querySelector(selector)
        return element === null ? 0 : element.scrollWidth - element.clientWidth
      }
      return {
        doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        list: over('.dshOneTree_list'),
        header: over(headerSelector),
        row: over(rowSelector),
        drawer: over('.dshOneTree_drawerList'),
      }
    },
    [HEADER, DRAWER_ROWS] as const,
  )
}

export const RECYCLE_DRAWER_COMPLETE_SUITE: LabSuite = {
  id: 'F-53',
  phase: 'new-feature',
  name: '回收站抽屉补齐：抽屉头三样（返回 / 清空 / 恢复全部）+ 行的右键入口 / 状态点 / 图钉（#154，RECYCLE-DRAWER-COMPLETE 套件）',
  expect:
    '真装配页（真网关**只读** + 假宿主 + 页内夹具）上的四件事，期望值全部从 `workspaceTree/styles.ts` 的档位表与插件 zh 词典读、几何按关系量判（±1px）：**① 抽屉头三样**——最左是「返回」（标记 `data-dshone-tree-action="recycle-close"`：原来那枚 ✕ 由它接手，同一个动作同一个标记；`aria-label` / `title` = 词典 `recycle.back`；图标是官方的左向箭头 `IconChevronLeftOutline14`：16 视框 / 单条 `path`；方盒取紧凑档 `iconButtonSize`），点它抽屉收起且再点入口行仍能打开；「清空」与「恢复全部」在标题右侧、**与底部入口行那两枚同一形态**（尺寸 / 圆角 / 图标 `path@d` / 词典文案四项逐项相同，清空按官方错误色 `--dsw-alias-state-error-primary` 的解析值）——点「清空」开的是**既有的**归档确认弹窗、取消后弹窗关掉、回收站状态一条不少、这一趟没有任何写类 `/api/` 方法（页面自己轮询的读接口不算）；点「恢复全部」走**既有的**全部还原（恰好一条 `state.write`、没有任何写类 `/api/` 方法、抽屉里的行清空、入口角标归 0）；计数与标题在**同一内联组**里（计数左缘 − 标题右缘 = 那一组自己的 `column-gap`，±1px），且计数 = 抽屉里此刻的行数；三档宽度（260/340/500）下抽屉头 / 抽屉列表 / 行 / 列表 / 文档都不横向溢出、三样都还在框里、计数仍可见。**② 行的右键入口**——行上没有常显的 ⋯ 入口（`[data-dshone-recycle-menu]` 计数为 0），在行上右键（不点任何按钮）能开出一份菜单，里面**恰好两项**（`recycle-restore` / `recycle-archive`，顺序固定），文案 = 词典 `recycle.restore` / `menu.archiveForever`、图标 `path@d` 与行尾那两枚动作按钮里的图标**逐字相同**（同一份项的两个出口），开菜单时那一行带上 `menuOpen`；菜单里的「归档」开的是同一个确认弹窗（取消后没有任何写类 `/api/` 方法、状态不动）。**③ 状态点与主树同一口径**——夹具把某条会话的 `running` 翻成 true（页内夹具，请求不落网关；命中条数当场断言），先读它在**主树**行上的状态点（`data-state=ongoing`、官方 8 格矩阵：10×10 视框 / 8 个形状、颜色 = token `--dsw-static-deepseek-450` 的解析值、状态槽取标准档 16×20），再用**既有的**行菜单「移入回收站」把**同一条会话**挪进抽屉，读它在**抽屉**里的同一枚点——`data-state` / 形状指纹 / 解析色 / 状态槽几何逐项相同，且点整个落在行里、在标题之前；未读那一档另判：夹具注入一条未读的回收站会话，主树那一侧用行菜单「标为未读」现场造一条，两侧 `data-state`（done）、读屏文案（词典 `status.unread`）与标题字重（600）逐项相同。**④ 图钉**——夹具注入「已置顶 + 已在回收站」的那条（这个组合界面本身造不出来：置顶的会话不许移入回收站），抽屉行标题前出现图钉，且与主树里另一条置顶行的图钉是**同一枚标记**（形状指纹 / 视框 / 绘制尺寸逐项相同、几何 14×14、都在标题之前）；没置顶的那条行上图钉数为 0。**收尾**——计数 0 那一页（注入空集合）里「清空 / 恢复全部」两枚禁用且降透明度、返回仍能把抽屉关掉；全程零 pageerror、零写类 `/api/` 方法（本套件从不点归档确认）。',
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
      // ---- 夹具：从树上取 4 条真实会话，分四角 ----
      // E（running）：跑起来的那条（主树读一次 → 用既有行菜单挪进抽屉 → 抽屉里再读一次，
      //   判「同一会话同一口径」）；
      // A（pinnedInBin）：夹具注入「已置顶 + 已在回收站」的那条（抽屉里的图钉）；
      // B（pinnedInTree）：留在主树的置顶行（主树那一侧的图钉参照物，也是待会儿被「标为未读」的）；
      // C（unreadInBin）：夹具注入「已在回收站 + 未读」的那条（抽屉里的未读点）。
      const ids = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-dshone-tree-row="session"]'))
          .slice(0, 4)
          .map((row) => row.getAttribute('data-dshone-tree-session') ?? '')
          .filter((id) => id !== ''),
      )
      check.ok('树里至少有 4 条会话可供夹具使用（四个角各要一条）', ids.length >= 4, JSON.stringify(ids))
      if (ids.length < 4) return screenshots
      const [runningSession, pinnedInBin, pinnedInTree, unreadInBin] = ids as [string, string, string, string]
      check.fact(
        `夹具四条会话：跑着的=${runningSession} 置顶且在回收站=${pinnedInBin} 置顶在主树=${pinnedInTree} 未读且在回收站=${unreadInBin}`,
      )
      await page.addInitScript({
        content: `(() => {
          const host = globalThis.__LAB_HOST__
          host.stateStore['recycle-bin'] = ${JSON.stringify({ version: 1, sessionIds: [pinnedInBin, unreadInBin] })}
          host.stateStore['pinned'] = ${JSON.stringify({ version: 1, sessionIds: [pinnedInBin, pinnedInTree] })}
          host.stateStore['unread'] = ${JSON.stringify({ version: 1, sessionIds: [unreadInBin] })}
        })()`,
      })
      const runningFixture = await installRunningFixture(page, runningSession, (method) => apiCalls.push(method))
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector(route('sidebar').readySelector, { timeout: 40_000 })
      await page.waitForTimeout(2_500)
      check.fact(`running 夹具：session/list 被改 ${String(runningFixture.calls)} 次、命中目标会话 ${String(runningFixture.touched)} 次`)
      check.ok(
        'running 夹具接上了（没接上后面「同一会话逐项相同」会变成两边都没点，当场红）',
        runningFixture.touched >= 1,
        `命中 ${String(runningFixture.touched)} 次`,
      )

      // =====================================================================
      // ③-A 抽屉关着时先量主树：那条跑着的会话的状态点 / 那条置顶行的图钉
      // =====================================================================
      const treeDot = await readTreeRow(page, runningSession)
      check.fact(
        `主树里那条跑着的会话：data-state=${treeDot.dot?.state ?? '无点'} 视框=${treeDot.dot?.viewBox ?? ''} 形状数=${String(treeDot.dot?.shapeCount ?? -1)} 色=${treeDot.dot?.color ?? ''} 状态槽=${JSON.stringify(treeDot.slot)}`,
      )
      check.ok('主树里那条会话亮着状态点（夹具的 running 生效）', treeDot.dot !== null, JSON.stringify(treeDot.dot))
      check.eq('主树那一枚是「运行中」点', treeDot.dot?.state, 'ongoing')
      check.eq('主树那一枚是官方 8 格矩阵（10×10 视框 / 8 个形状）', [treeDot.dot?.viewBox, treeDot.dot?.shapeCount], ['0 0 10 10', 8])
      const ongoingToken = await tokenValue(page, '--dsw-static-deepseek-450')
      check.eq('主树那一枚的颜色 = 官方 token `--dsw-static-deepseek-450` 的解析值', treeDot.dot?.color, ongoingToken)
      check.ok(
        '主树那一枚的状态槽取标准档（16×20）',
        treeDot.slot !== null &&
          Math.abs(treeDot.slot.width - px(SCALE_TIERS.standard.slotWidth)) <= SIZE_EPS &&
          Math.abs(treeDot.slot.height - px(SCALE_TIERS.standard.slotHeight)) <= SIZE_EPS,
        JSON.stringify(treeDot.slot),
      )

      const treePin = await readTreeRow(page, pinnedInTree)
      const treePinIcon = await readIcon(page, `[data-dshone-tree-session="${pinnedInTree}"] .dshOneTree_pin`)
      check.ok('主树里那条置顶行有图钉（夹具注入的 `pinned` 被读到了）', treePin.pin !== null && treePinIcon !== null, JSON.stringify(treePin.pin))
      check.ok(
        '主树图钉几何 14×14（紧凑档 iconSize）',
        treePin.pin !== null &&
          Math.abs(treePin.pin.width - px(SCALE_TIERS.compact.iconSize)) <= SIZE_EPS &&
          Math.abs(treePin.pin.height - px(SCALE_TIERS.compact.iconSize)) <= SIZE_EPS,
        JSON.stringify(treePin.pin),
      )
      check.ok(
        '主树图钉在标题之前（左缘 ≤ 标题左缘）',
        treePin.pin !== null && treePin.title !== null && treePin.pin.left <= treePin.title.left,
        `图钉 ${String(treePin.pin?.left)} vs 标题 ${String(treePin.title?.left)}`,
      )

      // ---- 抽屉关着时用既有行菜单造现场：那条跑着的挪进回收站、那条置顶的标为未读 ----
      const writesBeforeMove = (await hostBin(page)).writes
      await clickRowMenuItem(page, runningSession, 'move-to-recycle-bin')
      const afterMove = await hostBin(page)
      check.eq('「移入回收站」只写本地集合（恰好一条 state.write）', afterMove.writes - writesBeforeMove, 1)
      check.ok('那条会话落进本地回收站集合', afterMove.ids.includes(runningSession), JSON.stringify(afterMove.ids))

      await clickRowMenuItem(page, pinnedInTree, 'unread')
      const treeUnread = await readTreeRow(page, pinnedInTree)
      check.fact(`主树那条标为未读之后：data-state=${treeUnread.dot?.state ?? '无点'} 读屏=${treeUnread.readLabels} 字重=${treeUnread.titleWeight}`)
      check.eq('未读那一档主树亮的是「未读」点（官方 done 那一档）', treeUnread.dot?.state, 'done')
      check.eq('未读的读屏文案 = 词典 `status.unread`', treeUnread.readLabels, ZH['status.unread'] ?? '')
      check.eq('未读的标题加粗（600，与主树既有口径一致）', treeUnread.titleWeight, '600')

      // =====================================================================
      // 打开抽屉：量抽屉里的同一枚点、图钉、未读
      // =====================================================================
      await page.click(ENTRY_MAIN)
      await page.waitForTimeout(500)
      check.eq('抽屉打开', await page.locator(DRAWER).count(), 1)
      screenshots.push(await shot(page, 'recycle-drawer-complete-open'))

      const drawerRow = await readDrawer(page, runningSession)
      check.ok('夹具生效：抽屉里有那条刚挪进来的会话行', drawerRow.row !== null, JSON.stringify(drawerRow.row))
      check.fact(
        `抽屉里同一会话：data-state=${drawerRow.rowDot?.state ?? '无点'} 视框=${drawerRow.rowDot?.viewBox ?? ''} 形状数=${String(drawerRow.rowDot?.shapeCount ?? -1)} 色=${drawerRow.rowDot?.color ?? ''} 状态槽=${JSON.stringify(drawerRow.rowSlot)}`,
      )
      check.eq('③ 同一会话：抽屉里那枚点与主树里那枚 `data-state` 相同', drawerRow.rowDot?.state, treeDot.dot?.state)
      check.eq(
        '③ 同一会话：形状指纹相同（同一枚官方 `StateDot`：10×10 视框 / 8 个形状）',
        [drawerRow.rowDot?.viewBox, drawerRow.rowDot?.shapeCount],
        [treeDot.dot?.viewBox, treeDot.dot?.shapeCount],
      )
      check.eq('③ 同一会话：解析色相同（同一枚 token 算出来的值）', drawerRow.rowDot?.color, treeDot.dot?.color)
      check.ok(
        '③ 状态点那一格取标准档（16×20，与主树同一格）',
        drawerRow.rowSlot !== null &&
          Math.abs(drawerRow.rowSlot.width - px(SCALE_TIERS.standard.slotWidth)) <= SIZE_EPS &&
          Math.abs(drawerRow.rowSlot.height - px(SCALE_TIERS.standard.slotHeight)) <= SIZE_EPS,
        JSON.stringify(drawerRow.rowSlot),
      )
      check.ok(
        '③ 状态点整个落在行里、在标题之前',
        drawerRow.rowDot !== null &&
          drawerRow.row !== null &&
          drawerRow.rowTitle !== null &&
          drawerRow.rowDot.box.left >= drawerRow.row.left &&
          drawerRow.rowDot.box.left <= drawerRow.rowTitle.left,
        `点 ${String(drawerRow.rowDot?.box.left)} 行 ${String(drawerRow.row?.left)} 标题 ${String(drawerRow.rowTitle?.left)}`,
      )

      // ④ 图钉：抽屉里那条「已置顶 + 已在回收站」的，与主树那一枚是同一枚标记。
      const pinnedRow = await readDrawer(page, pinnedInBin)
      check.ok('夹具生效：抽屉里那条置顶会话的行有图钉（界面上造不出的组合由夹具注入）', pinnedRow.rowPin !== null, JSON.stringify(pinnedRow.rowPin))
      check.eq('④ 图钉是同一枚标记：形状指纹逐字相同', pinnedRow.rowPinIcon?.shapes, treePinIcon?.shapes)
      check.eq(
        '④ 图钉的视框与绘制尺寸与主树那一枚相同',
        [pinnedRow.rowPinIcon?.viewBox, pinnedRow.rowPinIcon?.width, pinnedRow.rowPinIcon?.height],
        [treePinIcon?.viewBox, treePinIcon?.width, treePinIcon?.height],
      )
      check.ok(
        '④ 图钉几何 14×14（与主树那一枚同值）',
        pinnedRow.rowPin !== null &&
          treePin.pin !== null &&
          Math.abs(pinnedRow.rowPin.width - treePin.pin.width) <= SIZE_EPS &&
          Math.abs(pinnedRow.rowPin.height - treePin.pin.height) <= SIZE_EPS,
        `抽屉 ${JSON.stringify(pinnedRow.rowPin)} vs 主树 ${JSON.stringify(treePin.pin)}`,
      )
      check.ok(
        '④ 图钉在抽屉行的标题之前（与主树同一位置关系）',
        pinnedRow.rowPin !== null && pinnedRow.rowTitle !== null && pinnedRow.rowPin.left <= pinnedRow.rowTitle.left,
        `图钉 ${String(pinnedRow.rowPin?.left)} vs 标题 ${String(pinnedRow.rowTitle?.left)}`,
      )
      check.eq(
        '④ 没置顶的那条行上**没有**图钉（夹具只置顶了两条）',
        await page.locator(`${DRAWER_ROWS}[data-dshone-recycle-row="${runningSession}"] .dshOneTree_pin`).count(),
        0,
      )

      // ③-C 未读：抽屉里那条（夹具注入）与主树那条（现场造的）逐项比。
      const unreadRow = await readDrawer(page, unreadInBin)
      const unreadDrawer = await page.evaluate((selector) => {
        const row = document.querySelector(selector)
        const dot = row?.querySelector('.dshOneTree_slot [data-state]') ?? null
        const title = row?.querySelector('.dshOneTree_title') ?? null
        return {
          state: dot?.getAttribute('data-state') ?? '',
          label: Array.from(row?.querySelectorAll('.dshOneTree_visuallyHidden') ?? [])
            .map((node) => node.textContent ?? '')
            .join('|'),
          weight: title === null ? '' : getComputedStyle(title).fontWeight,
        }
      }, `${DRAWER_ROWS}[data-dshone-recycle-row="${unreadInBin}"]`)
      check.fact(
        `未读两侧读数：主树=${JSON.stringify({ state: treeUnread.dot?.state, label: treeUnread.readLabels, weight: treeUnread.titleWeight })} 抽屉=${JSON.stringify(unreadDrawer)}（抽屉行在场=${String(unreadRow.row !== null)}）`,
      )
      check.ok('夹具生效：抽屉里那条未读会话的行在场', unreadRow.row !== null, JSON.stringify(unreadRow.row))
      check.eq('③ 未读两侧的 `data-state` 相同', unreadDrawer.state, treeUnread.dot?.state)
      check.eq('③ 未读两侧的读屏文案相同', unreadDrawer.label, treeUnread.readLabels)
      check.eq('③ 未读两侧的标题字重相同', unreadDrawer.weight, treeUnread.titleWeight)

      // =====================================================================
      // ② 行的右键入口：与行尾那两枚动作同一份项
      // =====================================================================
      check.eq('行上没有常显的 ⋯ 入口（#144 那一枚退场；右键那一份只在右键后才渲染）', drawerRow.explicitMenus, 0)
      check.eq('还没右键时页面上没有行菜单的项', await page.locator(MENU_RESTORE).count(), 0)

      const targetRow = page.locator(`${DRAWER_ROWS}[data-dshone-recycle-row="${runningSession}"]`)
      const targetBox = await targetRow.boundingBox()
      check.ok('取到要点右键的那一行', targetBox !== null, JSON.stringify(targetBox))
      if (targetBox === null) return screenshots
      await page.mouse.click(targetBox.x + 40, targetBox.y + targetBox.height / 2, { button: 'right' })
      await page.waitForTimeout(400)
      const menuFacts = await page.evaluate(
        ([restoreSelector, archiveSelector, menuRestore, menuArchive, rowSelector]) => {
          const pathsOf = (element: Element | null): string[] =>
            Array.from(element?.querySelectorAll('path') ?? []).map((node) => node.getAttribute('d') ?? '')
          const menuButton = (selector: string): Element | null => document.querySelector(selector)?.closest('button') ?? null
          const row = document.querySelector(rowSelector)
          return {
            items: document.querySelectorAll('[role="menuitem"]').length,
            restorePath: pathsOf(menuButton(menuRestore)),
            archivePath: pathsOf(menuButton(menuArchive)),
            restoreText: (document.querySelector(menuRestore)?.textContent ?? '').trim(),
            archiveText: (document.querySelector(menuArchive)?.textContent ?? '').trim(),
            inlineRestorePath: pathsOf(row?.querySelector(restoreSelector) ?? null),
            inlineArchivePath: pathsOf(row?.querySelector(archiveSelector) ?? null),
            menuOpenRow: row?.className.includes('dshOneTree_menuOpen') ?? false,
          }
        },
        [
          '[data-dshone-recycle-restore]',
          '[data-dshone-recycle-archive]',
          MENU_RESTORE,
          MENU_ARCHIVE,
          `${DRAWER_ROWS}[data-dshone-recycle-row="${runningSession}"]`,
        ] as const,
      )
      check.fact(
        `右键菜单：项=${String(menuFacts.items)} 还原「${menuFacts.restoreText}」归档「${menuFacts.archiveText}」行带 menuOpen=${String(menuFacts.menuOpenRow)}`,
      )
      screenshots.push(await shot(page, 'recycle-drawer-complete-context-menu'))
      check.eq('行右键真的开出了菜单（恰好两项）', menuFacts.items, 2)
      check.eq('菜单项的文案 = 词典 recycle.restore（与行尾那一枚同一个动作）', menuFacts.restoreText, ZH['recycle.restore'] ?? '')
      check.eq('菜单项的文案 = 词典 menu.archiveForever（与行尾那一枚同一个动作）', menuFacts.archiveText, ZH['menu.archiveForever'] ?? '')
      check.ok(
        '菜单里「还原」的图标与行尾那一枚逐字相同（`path@d`）',
        menuFacts.restorePath.length > 0 && JSON.stringify(menuFacts.restorePath) === JSON.stringify(menuFacts.inlineRestorePath),
        `菜单 ${JSON.stringify(menuFacts.restorePath)} vs 行尾 ${JSON.stringify(menuFacts.inlineRestorePath)}`,
      )
      check.ok(
        '菜单里「永久归档」的图标与行尾那一枚逐字相同（`path@d`）',
        menuFacts.archivePath.length > 0 && JSON.stringify(menuFacts.archivePath) === JSON.stringify(menuFacts.inlineArchivePath),
        `菜单 ${JSON.stringify(menuFacts.archivePath)} vs 行尾 ${JSON.stringify(menuFacts.inlineArchivePath)}`,
      )
      check.ok('菜单开着时那一行带 menuOpen 标记（与主树行菜单同一处置）', menuFacts.menuOpenRow)

      // 菜单里的「归档」= 同一个终点动作：开既有的确认弹窗（取消 → 零请求、状态不动）。
      const apiBeforeMenuArchive = apiCalls.length
      const binBeforeMenuArchive = await hostBin(page)
      await page.click(MENU_ARCHIVE)
      await page.waitForTimeout(400)
      const confirmFromMenu = await page.evaluate(
        ([confirmSelector, rowSelector]) => ({
          button: document.querySelector(confirmSelector) !== null,
          rows: document.querySelectorAll(rowSelector).length,
        }),
        [CONFIRM, '[data-dshone-archive-row]'] as const,
      )
      check.ok('右键菜单里的「归档」开的是既有的归档确认弹窗（同一个终点动作）', confirmFromMenu.button && confirmFromMenu.rows >= 1, JSON.stringify(confirmFromMenu))
      screenshots.push(await shot(page, 'recycle-drawer-complete-menu-archive-confirm'))
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
      check.eq('取消确认 → 弹窗关掉', await page.locator(CONFIRM).count(), 0)
      check.eq('取消确认 → 回收站状态一条不少', (await hostBin(page)).ids, binBeforeMenuArchive.ids)
      check.fact(`右键菜单归档 + 取消这一趟走过的 /api/ 方法：${JSON.stringify(apiCalls.slice(apiBeforeMenuArchive))}`)
      check.eq(
        '右键菜单归档 + 取消这一趟：没有任何写类 /api/ 方法',
        apiCalls.slice(apiBeforeMenuArchive).filter((call) => WRITE_METHOD.test(call)),
        [],
      )
      // Esc 可能把抽屉也带走（抽屉自己的 Esc 与弹窗的 Esc 是两条独立路径），带走就重新打开。
      if ((await page.locator(DRAWER).count()) === 0) {
        check.fact('取消确认后抽屉跟着 Esc 一起关掉了（既有路径，与本次改动无关）——重新打开继续')
        await page.click(ENTRY_MAIN)
        await page.waitForTimeout(500)
      }

      // =====================================================================
      // ① 抽屉头三样：在场、形态（与底部入口行那两枚同一形态）、几何、文案
      // =====================================================================
      const head = await readDrawer(page, runningSession)
      check.ok('① 抽屉头最左是「返回」', head.back !== null, JSON.stringify(head.back))
      check.eq('① 返回的 aria-label = 词典 recycle.back', head.back?.aria, ZH['recycle.back'] ?? '')
      check.eq('① 返回的 title = 词典 recycle.back（悬停提示与读屏同一句）', head.back?.title, ZH['recycle.back'] ?? '')
      check.eq('① 返回用的就是官方左向箭头（组件标记）', head.back?.name, 'IconChevronLeftOutline14')
      check.ok(
        '① 返回的图标是官方 14 档图标的渲染（`viewBox="0 0 14 14"` / 画成 14×14 / 至少一条形状；`path@d` 记在事实里，截图看方向）',
        head.back?.icon != null &&
          head.back.icon.viewBox === '0 0 14 14' &&
          head.back.icon.width === '14' &&
          head.back.icon.height === '14' &&
          head.back.icon.shapes.length >= 1,
        JSON.stringify(head.back?.icon),
      )
      check.eq(
        '① 返回的按钮几何 = 紧凑档 iconButtonSize 的方盒（与顶栏那几枚同一条骨架语言）',
        [head.back?.box.width, head.back?.box.height],
        [px(SCALE_TIERS.compact.iconButtonSize), px(SCALE_TIERS.compact.iconButtonSize)],
      )
      check.ok('① 抽屉头里「清空」在场', head.empty !== null, JSON.stringify(head.empty))
      check.ok('① 抽屉头里「恢复全部」在场', head.restoreAll !== null, JSON.stringify(head.restoreAll))
      check.eq('① 清空的 aria-label = 词典 recycle.emptyAll（与入口行那枚同一句）', head.empty?.aria, ZH['recycle.emptyAll'] ?? '')
      check.eq('① 恢复全部的 aria-label = 词典 recycle.restoreAll（与入口行那枚同一句）', head.restoreAll?.aria, ZH['recycle.restoreAll'] ?? '')
      check.eq('① 入口行清空那一枚的 aria-label 也是同一句（两处同一份文案）', head.entryEmpty?.aria, head.empty?.aria)
      check.eq('① 入口行恢复全部那一枚的 aria-label 也是同一句', head.entryRestoreAll?.aria, head.restoreAll?.aria)
      check.eq(
        '① 清空这一枚与入口行那枚同一形态（尺寸 / 圆角 / 图标形状指纹）',
        [head.empty?.box.width, head.empty?.box.height, head.empty?.radius, JSON.stringify(head.empty?.icon?.shapes)],
        [head.entryEmpty?.box.width, head.entryEmpty?.box.height, head.entryEmpty?.radius, JSON.stringify(head.entryEmpty?.icon?.shapes)],
      )
      check.eq(
        '① 恢复全部这一枚与入口行那枚同一形态（尺寸 / 圆角 / 图标形状指纹）',
        [head.restoreAll?.box.width, head.restoreAll?.box.height, head.restoreAll?.radius, JSON.stringify(head.restoreAll?.icon?.shapes)],
        [
          head.entryRestoreAll?.box.width,
          head.entryRestoreAll?.box.height,
          head.entryRestoreAll?.radius,
          JSON.stringify(head.entryRestoreAll?.icon?.shapes),
        ],
      )
      check.ok(
        '① 两枚的尺寸 = 紧凑档 iconButtonSize（档位表里查得到出处）',
        [head.empty, head.restoreAll].every(
          (entry) =>
            entry !== null &&
            Math.abs(entry.box.width - px(SCALE_TIERS.compact.iconButtonSize)) <= SIZE_EPS &&
            Math.abs(entry.box.height - px(SCALE_TIERS.compact.iconButtonSize)) <= SIZE_EPS,
        ),
        JSON.stringify([head.empty?.box, head.restoreAll?.box]),
      )
      const errorToken = await tokenValue(page, '--dsw-alias-state-error-primary')
      check.eq('① 清空按危险色（官方错误 token 的解析值）', head.empty?.color, errorToken)
      check.ok(
        '① 恢复全部不是危险色（与清空分得开）',
        head.restoreAll?.color !== head.empty?.color,
        `${String(head.restoreAll?.color)} vs ${String(head.empty?.color)}`,
      )
      const headerOrder = [head.back?.box.left, head.count?.left, head.empty?.box.left, head.restoreAll?.box.left]
      check.ok(
        '① 头里的顺序：返回 → 标题/计数 → 清空 → 恢复全部',
        headerOrder.every((value) => typeof value === 'number') &&
          headerOrder.every((value, index) => index === 0 || (value as number) > (headerOrder[index - 1] as number)),
        JSON.stringify(headerOrder),
      )
      check.eq('① 标题文字 = 词典 recycle.title', head.titleText, ZH['recycle.title'] ?? '')
      check.eq('① 计数 = 抽屉里此刻的行数（关系量，不写死条数）', head.countText, String(head.rows))
      check.ok(
        '① 计数与标题在同一个内联组里（计数左缘 − 标题右缘 = 那一组自己的 column-gap，±1px）',
        head.heading !== null &&
          head.title !== null &&
          head.count !== null &&
          head.headingGap >= 0 &&
          Math.abs(head.count.left - head.title.right - head.headingGap) <= EPS &&
          head.count.left >= head.heading.left &&
          head.count.right <= head.heading.right + EPS,
        `标题右缘 ${String(head.title?.right)} 计数左缘 ${String(head.count?.left)} gap=${String(head.headingGap)} 组=${JSON.stringify(head.heading)}`,
      )
      check.ok(
        '① 三样都在抽屉头的框里（左缘 ≥ 头左缘、右缘 ≤ 头右缘）',
        head.header !== null &&
          head.back !== null &&
          head.restoreAll !== null &&
          head.back.box.left >= head.header.left &&
          head.restoreAll.box.right <= head.header.right + EPS + 1,
        `头 ${JSON.stringify(head.header)} 返回 ${JSON.stringify(head.back?.box)} 恢复 ${JSON.stringify(head.restoreAll?.box)}`,
      )

      // =====================================================================
      // ① 三档宽度：三样都还在框里、计数可见、四处都不横向溢出
      // =====================================================================
      for (const width of [260, 340, 500] as const) {
        await page.setViewportSize({ width, height: 900 })
        await page.waitForTimeout(350)
        const reading = await readDrawer(page, pinnedInBin)
        const overflow = await overflowFacts(page)
        check.fact(
          `@${String(width)}：头=${JSON.stringify(reading.header)} 返回=${JSON.stringify(reading.back?.box)} 清空=${JSON.stringify(reading.empty?.box)} 恢复全部=${JSON.stringify(reading.restoreAll?.box)} 计数「${reading.countText}」=${JSON.stringify(reading.count)}`,
        )
        check.ok(
          `@${String(width)} 抽屉头三样都还在框里（左缘 ≥ 头左缘、右缘 ≤ 头右缘 + 1）`,
          reading.header !== null &&
            reading.back !== null &&
            reading.empty !== null &&
            reading.restoreAll !== null &&
            reading.back.box.left >= reading.header.left &&
            reading.restoreAll.box.right <= reading.header.right + EPS + 1,
          JSON.stringify({ header: reading.header, back: reading.back?.box, restore: reading.restoreAll?.box }),
        )
        check.ok(
          `@${String(width)} 抽屉头 / 抽屉列表 / 行 / 列表 / 文档都不横向溢出`,
          overflow.header <= 1 && overflow.drawer <= 1 && overflow.row <= 1 && overflow.list <= 1 && overflow.doc <= 1,
          JSON.stringify(overflow),
        )
        check.ok(
          `@${String(width)} 计数仍可见（宽高非 0、右缘仍在框内）`,
          reading.count !== null && reading.count.width > 0 && reading.count.right <= (reading.header?.right ?? 0) + EPS + 1,
          JSON.stringify(reading.count),
        )
      }
      await page.setViewportSize({ width: 340, height: 900 })
      await page.waitForTimeout(300)

      // =====================================================================
      // ① 返回：点它抽屉收起（有滑出过渡，等得比过渡长），再点入口行仍能打开
      // =====================================================================
      await page.click(BACK)
      await page.waitForTimeout(600)
      check.eq('① 点「返回」抽屉收起', await page.locator(DRAWER).count(), 0)
      check.eq('① 收起后入口行的标记同步翻成收起', await page.getAttribute(ENTRY_MAIN, 'data-dshone-tree-recycle-expanded'), 'false')
      await page.click(ENTRY_MAIN)
      await page.waitForTimeout(500)
      check.eq('① 再点入口行仍能打开（返回没有把开合态弄坏）', await page.locator(DRAWER).count(), 1)

      // =====================================================================
      // ① 清空：开既有的确认弹窗；取消 → 零请求、状态不动
      // =====================================================================
      const apiBeforeEmpty = apiCalls.length
      const binBeforeEmpty = await hostBin(page)
      await page.click(HEADER_EMPTY)
      await page.waitForTimeout(400)
      const confirmFromHeader = await page.evaluate(
        ([confirmSelector, rowSelector]) => ({
          button: document.querySelector(confirmSelector) !== null,
          rows: document.querySelectorAll(rowSelector).length,
        }),
        [CONFIRM, '[data-dshone-archive-row]'] as const,
      )
      check.ok('① 点抽屉头的「清空」开的是既有的归档确认弹窗', confirmFromHeader.button && confirmFromHeader.rows >= 1, JSON.stringify(confirmFromHeader))
      screenshots.push(await shot(page, 'recycle-drawer-complete-header-empty-confirm'))
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
      check.eq('取消确认 → 弹窗关掉', await page.locator(CONFIRM).count(), 0)
      check.eq('取消确认 → 回收站状态一条不少', (await hostBin(page)).ids, binBeforeEmpty.ids)
      check.fact(`点清空 + 取消这一趟走过的 /api/ 方法：${JSON.stringify(apiCalls.slice(apiBeforeEmpty))}`)
      check.eq(
        '点清空 + 取消这一趟：没有任何写类 /api/ 方法（没有落到网关的写面）',
        apiCalls.slice(apiBeforeEmpty).filter((call) => WRITE_METHOD.test(call)),
        [],
      )
      if ((await page.locator(DRAWER).count()) === 0) {
        check.fact('取消确认后抽屉跟着 Esc 一起关掉了（既有路径）——重新打开继续')
        await page.click(ENTRY_MAIN)
        await page.waitForTimeout(500)
      }

      // =====================================================================
      // ① 恢复全部：本地可逆（一条 state.write、零 /api/、行清空、角标归 0）
      // =====================================================================
      const apiBeforeRestoreAll = apiCalls.length
      const writesBeforeRestoreAll = (await hostBin(page)).writes
      await page.click(HEADER_RESTORE_ALL)
      await page.waitForTimeout(700)
      const binAfterRestoreAll = await hostBin(page)
      check.eq('① 点「恢复全部」走既有的全部还原：本地集合清空', binAfterRestoreAll.ids, [])
      check.eq('① 全程只落一条本地写入（state.write 的 recycle-bin，不落网关）', binAfterRestoreAll.writes - writesBeforeRestoreAll, 1)
      check.eq('① 恢复全部后抽屉里的行清空', await page.locator(DRAWER_ROWS).count(), 0)
      check.eq('① 恢复全部后入口角标归 0', await page.getAttribute(ENTRY_MAIN, 'data-dshone-tree-recycle-count'), '0')
      check.fact(`恢复全部这一趟走过的 /api/ 方法：${JSON.stringify(apiCalls.slice(apiBeforeRestoreAll))}`)
      check.eq(
        '① 恢复全部这一趟：没有任何写类 /api/ 方法（本地可逆那一层不碰网关写面）',
        apiCalls.slice(apiBeforeRestoreAll).filter((call) => WRITE_METHOD.test(call)),
        [],
      )

      // =====================================================================
      // 第三页：计数 0 —— 两枚动作禁用且降透明度、返回仍可用
      // =====================================================================
      const emptyPage = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), {
        width: 340,
        height: 900,
        state: { 'recycle-bin': { version: 1, sessionIds: [] } },
      })
      try {
        const emptyDrawer = emptyPage.page
        await emptyDrawer.click(ENTRY_MAIN)
        await emptyDrawer.waitForTimeout(500)
        const emptyFacts = await readDrawer(emptyDrawer, '')
        check.fact(`计数 0 那一页：计数=${emptyFacts.countText} 行=${String(emptyFacts.rows)}`)
        check.eq('计数 0：抽屉头的计数是 0', emptyFacts.countText, '0')
        check.eq('计数 0：清空与恢复全部两枚都禁用', [emptyFacts.empty?.disabled, emptyFacts.restoreAll?.disabled], [true, true])
        const opacity = await emptyDrawer.evaluate(
          ([emptySelector, restoreSelector]) =>
            [emptySelector, restoreSelector].map((selector) =>
              Number.parseFloat(getComputedStyle(document.querySelector(selector) ?? document.body).opacity),
            ),
          [HEADER_EMPTY, HEADER_RESTORE_ALL] as const,
        )
        check.ok('计数 0：两枚都有灰态（opacity 降到 1 以下）', opacity.every((value) => value < 1), JSON.stringify(opacity))
        check.ok(
          '计数 0：返回仍可用（在场且没被禁用）',
          emptyFacts.back !== null && !(await emptyDrawer.isDisabled(BACK)),
          JSON.stringify(emptyFacts.back?.box),
        )
        await emptyDrawer.click(BACK)
        await emptyDrawer.waitForTimeout(600)
        check.eq('计数 0：点返回抽屉照样收起', await emptyDrawer.locator(DRAWER).count(), 0)
        screenshots.push(await shot(emptyDrawer, 'recycle-drawer-complete-empty'))
        check.eq('计数 0 那一页零 pageerror', withoutKnownNoise(emptyPage.capture.pageErrors).real, [])
      } finally {
        await emptyPage.context.close()
      }

      check.eq(
        '全程只读网关：没有任何写类 /api/ 方法',
        apiCalls.filter((call) => WRITE_METHOD.test(call)),
        [],
      )
      check.eq('本套件全程零 pageerror', withoutKnownNoise(opened.capture.pageErrors).real, [])
    } finally {
      await opened.context.close()
    }
    return screenshots
  },
}
