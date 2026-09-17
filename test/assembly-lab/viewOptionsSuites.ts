/**
 * 「视图选项」退役（#131）：顶栏那一枚（分组方式 / 排序方式）与它带出的平铺单列表模式
 * 一起下线，侧栏恒为「按工作区 + 官方顺序」。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与 `recycleEntrySuites.ts` / `driftSuites.ts`
 * 同一条：那个文件是本批开发的合入热点，新套件放外面能少一半冲突面。注册方式是在
 * `suites.ts` 的 `SUITES` 末尾追加一项。
 *
 * 本套件验的是**退役本身**这件事，分四层：
 * ① **入口不在**（按自有标记断言，不认官方图标类名）；
 * ② **没有任何能切到平铺模式的路径**——页面上没有平铺容器，侧栏能开的每一份菜单里也没有
 *    分组 / 排序那几项（`groupBy` / `orderBy` 之类标识符的源码层扫描在
 *    `test/workspaceTreeFeatures.test.ts` 的「视图选项退役」那一条）；
 * ③ **排序恒为官方顺序**——把旧版本留下的持久值（`{groupBy:'flat', orderBy:'updated'}`）
 *    注回 `localStorage` 再重载：树照旧是分组的、每组行序与干净态逐条相同（那一档没被应用），
 *    而且写回的记录里只剩仍在用的那几个字段（退役字段被顺手抹掉）；
 * ④ **其余四枚顶栏按钮与整树行为不变**（#131 的验收第 ④ 条）——搜索框、折叠/展开全部、
 *    ＋、多选入口与分组过滤条都还在。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { openTreePage, withoutKnownNoise, type OpenedPage } from './harness.ts'
import { LAB_TREES, type LabTreeRoute } from './labServer.ts'
// 只取类型（编译后不留 import，运行期没有环）：套件接口定义在 suites.ts 里。
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

const PREF_KEY = 'dsh.workspaceTree.view'

/** 退役的视图态键：写回的记录里不该再有它们。 */
const RETIRED_PREF_KEYS = new Set(['groupBy', 'orderBy'])

/**
 * 退役文案：分组 / 排序那两节里的每一个词。只扫**我们自己的界面文案**（顶栏与分组过滤条、
 * 以及每份菜单的项），不扫整页文本——用户给会话起的名字里真出现「最近更新」四个字时，
 * 那不该被判成退役没做干净。
 */
const RETIRED_TEXTS = ['视图选项', '分组方式', '按工作区', '单列表', '排序方式', '手动排序', '最近更新'] as const

/** 侧栏能开的每一份菜单：怎么打开它（悬停才显形 / 右键才出来的先做准备）+ 点哪个元素。 */
const MENU_TRIGGERS: ReadonlyArray<{ name: string; selector: string; open: 'click' | 'hover-row' | 'right-click-row' }> = [
  { name: '顶栏 ＋（添加工作区）', selector: '[data-dshone-tree-action="add-workspace"]', open: 'click' },
  { name: '分组胶囊', selector: '[data-dshone-tree-action="group-pill"]', open: 'click' },
  // 会话行的 ⋯ 按钮悬停才显形（`.dshOneTree_rowActions` 平时 `display:none`），所以先 hover
  // 那一行、再点按钮——点按钮本身也会把鼠标停进行里，悬停态不会掉。
  { name: '会话行 ⋯', selector: '[data-dshone-tree-action="session-menu"]', open: 'hover-row' },
  { name: '工作区行右键', selector: '[data-dshone-tree-row="workspace"]', open: 'right-click-row' },
]

/** 每个触发器要点/悬停在哪（`open: 'hover-row'` 时是**带 ⋯ 按钮的那一行**——空白行没有按钮）。 */
const OPEN_TARGET: Readonly<Record<'click' | 'hover-row' | 'right-click-row', string>> = {
  click: '',
  'hover-row': '[data-dshone-tree-row="session"]:has([data-dshone-tree-action="session-menu"])',
  'right-click-row': '[data-dshone-tree-row="workspace"]',
}

interface MarkerFacts {
  /** 全页（不只是顶栏）里视图选项入口标记的数量——#131 之后必须是 0。 */
  viewOptions: number
  /** 顶栏动作组里的动作名（按 DOM 顺序）。 */
  topBarActions: string[]
  /** 平铺容器（标记 / 类名）与分组容器各有多少。 */
  flatContainers: number
  groupedContainers: number
  /** 搜索框 / 折叠全部 / ＋ / 设置齿轮 / 多选入口 / 过滤条在不在。 */
  others: Record<string, boolean>
  /** 顶栏与分组过滤条的文案里出现的退役词。 */
  retiredTexts: string[]
}

async function readMarkers(page: OpenedPage['page']): Promise<MarkerFacts> {
  return page.evaluate((retired) => {
    const row = document.querySelector('[data-dshone-tree="top-bar"]')
    const has = (selector: string): boolean => document.querySelector(selector) !== null
    const uiText = [row, document.querySelector('.dshOneTree_filterBar')]
      .map((element) => element?.textContent ?? '')
      .join('\n')
    return {
      viewOptions: document.querySelectorAll('[data-dshone-tree-action="view-options"]').length,
      topBarActions: Array.from(row?.querySelectorAll('[data-dshone-tree-action]') ?? []).map(
        (element) => element.getAttribute('data-dshone-tree-action') ?? '',
      ),
      flatContainers:
        document.querySelectorAll('[data-dshone-tree="flat"]').length + document.querySelectorAll('.dshOneTree_flatList').length,
      groupedContainers: document.querySelectorAll('[data-dshone-tree="groups"]').length,
      others: {
        searchBox: has('[data-dshone-tree="search-box"]'),
        searchInput: has('[data-dshone-tree="search-input"]'),
        collapseAll: has('[data-dshone-tree-action="collapse-all"]'),
        addWorkspace: has('[data-dshone-tree-action="add-workspace"]'),
        settings: has('[data-dshone-tree-action="settings"]'),
        selectMode: has('[data-dshone-tree-action="select-mode"]'),
        filterBar: has('.dshOneTree_filterBar'),
      },
      retiredTexts: retired.filter((text) => uiText.includes(text)),
    }
  }, RETIRED_TEXTS as unknown as string[])
}

/** 每个分组里的会话行 id（按 DOM 顺序）——「排序是不是官方顺序」靠这两份序列比。 */
type GroupOrder = { key: string; ids: string[] }[]

async function readGroupOrder(page: OpenedPage['page']): Promise<GroupOrder> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-dshone-group-key]')).map((section) => ({
      key: section.getAttribute('data-dshone-group-key') ?? '',
      ids: Array.from(section.querySelectorAll('[data-dshone-tree-row="session"]')).map(
        (row) => row.getAttribute('data-dshone-tree-session') ?? '',
      ),
    })),
  )
}

/** 把每个工作区都展开（点行头与点顶栏那枚是同一件事，这里直接点行头更直白）。 */
async function expandAllGroups(page: OpenedPage['page']): Promise<void> {
  await page.evaluate(() => {
    for (const row of Array.from(document.querySelectorAll('[data-dshone-tree-row="workspace"]'))) {
      if (row.getAttribute('aria-expanded') !== 'true') (row as HTMLElement).click()
    }
  })
  await page.waitForTimeout(500)
}

/** 当前最后一份菜单里所有文案（分组标题 + 项文案；没开出来返回 null）。 */
async function menuTexts(page: OpenedPage['page']): Promise<string[] | null> {
  return page.evaluate(() => {
    const list = Array.from(document.querySelectorAll('[role="menu"]')).pop() ?? null
    if (list === null) return null
    const items = Array.from(list.querySelectorAll('button[role="menuitem"]')).map((item) => (item.textContent ?? '').trim())
    const labels = Array.from(list.querySelectorAll('[class*="_label"]')).map((label) => (label.textContent ?? '').trim())
    return [...labels, ...items]
  })
}

/**
 * 打开一份菜单（悬停才显形的先 hover、右键才出来的先右键）；返回它有没有开出来——
 * 触发器这一轮不在（网关没数据）时返回 false，由调用方按事实记一笔。
 */
async function openMenu(page: OpenedPage['page'], target: (typeof MENU_TRIGGERS)[number]): Promise<boolean> {
  const exists = await page.evaluate((selector: string) => document.querySelectorAll(selector).length, target.selector)
  if (exists === 0) return false
  if (target.open === 'hover-row') {
    // 悬停**带 ⋯ 按钮的那一行**（空白会话行有菜单锚点、没有按钮），再点它自己那个按钮。
    const row = page.locator(OPEN_TARGET['hover-row']).first()
    await row.hover()
    await page.waitForTimeout(200)
    await row.locator('[data-dshone-tree-action="session-menu"]').click()
    await page.waitForTimeout(300)
    return (await menuTexts(page)) !== null
  }
  if (target.open === 'right-click-row') {
    await page.click(OPEN_TARGET['right-click-row'], { button: 'right', position: { x: 60, y: 12 } })
    await page.waitForTimeout(300)
  } else {
    await page.click(target.selector)
    await page.waitForTimeout(300)
  }
  return (await menuTexts(page)) !== null
}

/**
 * 关掉当前菜单：Esc（官方 `Menu` 认它）。官方那份 `closeOnPointerLeave` 的菜单万一不吃，
 * 再点一次触发器（它是 toggle，副作用只有开关）。不用「点别处」兜底——侧栏那一带底下
 * 是行与行上的 `＋`，一次盲点可能真的建出一个会话。
 */
async function closeMenu(page: OpenedPage['page'], target: (typeof MENU_TRIGGERS)[number]): Promise<void> {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  const left = await page.evaluate(() => document.querySelectorAll('[role="menu"]').length)
  if (left === 0 || target.open !== 'click') return
  await page.click(target.selector)
  await page.waitForTimeout(200)
}

/** 旧版本写下的那条视图态记录（含退役字段）+ 这一轮的展开集合，注入 `localStorage`。 */
async function seedRetiredPrefs(page: OpenedPage['page'], fallbackExpanded: readonly string[]): Promise<unknown> {
  return page.evaluate(
    ([key, expanded]) => {
      let current: Record<string, unknown> = {}
      try {
        const parsed: unknown = key === null ? null : JSON.parse(localStorage.getItem(key) ?? 'null')
        if (typeof parsed === 'object' && parsed !== null) current = parsed as Record<string, unknown>
      } catch {
        current = {}
      }
      const expandedGroups =
        Array.isArray(current.expandedGroups) && current.expandedGroups.length > 0 ? current.expandedGroups : expanded
      const seeded = { ...current, expandedGroups, groupBy: 'flat', orderBy: 'updated' }
      localStorage.setItem(key, JSON.stringify(seeded))
      return seeded
    },
    [PREF_KEY, fallbackExpanded as unknown as string[]] as const,
  )
}

/** 树写回之后持久记录里还剩哪些键（轮询到那次写回落定为止）。 */
async function readStoredPrefKeys(page: OpenedPage['page']): Promise<string[]> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const keys = await page.evaluate((key: string) => {
      try {
        const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
        if (typeof parsed !== 'object' || parsed === null) return null
        return Object.keys(parsed as Record<string, unknown>)
      } catch {
        return null
      }
    }, PREF_KEY)
    if (keys !== null && !keys.some((name) => RETIRED_PREF_KEYS.has(name))) return keys
    await page.waitForTimeout(200)
  }
  return [`（等不到一次干净写回）`]
}

export const VIEW_OPTIONS_RETIRED_SUITE: LabSuite = {
  id: 'F-33',
  phase: 'new-feature',
  name: '视图选项退役（#131）：顶栏不再有那一枚、没有能切平铺 / 改排序的路径、排序恒为官方顺序（VIEW-OPTIONS-RETIRED 套件）',
  expect:
    '侧栏树在真实装配页上（真网关**只读** + 假宿主）：① **入口不在**——全页 `[data-dshone-tree-action="view-options"]` 数量为 0，顶栏那一行的动作恰好是「折叠/展开全部 + 添加工作区（＋）+ 设置齿轮 + 多选入口」，顶栏与分组过滤条的文案里不出现「视图选项 / 分组方式 / 按工作区 / 单列表 / 排序方式 / 手动排序 / 最近更新」任何一个词；② **没有任何能切到平铺模式的路径**——页面上既没有平铺容器（`data-dshone-tree="flat"` / `.dshOneTree_flatList`），分组容器也在；侧栏能开的每一份菜单（顶栏 ＋、分组胶囊、会话行 ⋯、工作区行右键）都开一遍，文案里一个退役词都没有；③ **排序恒为官方顺序**——把旧版本留下的记录（`{groupBy:"flat", orderBy:"updated"}`）注回 `localStorage` 再重载：树照旧是分组的（平铺容器仍不存在），每个分组的会话行 id 序列与干净态**逐条相同**（那一档没被应用，行的先后只来自官方会话服务），分组本身的先后也没变，并且树写回的记录里只剩 `activeGroupId / expandedGroups / recycleCollapsed / tagCollapsed` 四个仍在用的字段（退役那两个被顺手抹掉）；④ **其余四枚顶栏按钮与整树行为不变**——搜索框（展开态常驻）、折叠/展开全部、＋、多选入口仍在，分组过滤条仍在，注入旧记录并重载之后同样如此。全程零 pageerror。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const opened = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { width: 340, height: 900 })
    const { page } = opened
    try {
      // ---- ① 入口不在 ----
      const markers = await readMarkers(page)
      check.fact(`顶栏动作序列：${JSON.stringify(markers.topBarActions)}；其余几件：${JSON.stringify(markers.others)}`)
      check.eq('① 全页没有视图选项入口（按自有标记断言）', markers.viewOptions, 0)
      check.eq(
        '① 顶栏那一行的动作恰好是搜索 + 折叠/展开全部 + 添加工作区 + 多选入口（设置齿轮视宿主能力，可能缺席）',
        markers.topBarActions.filter((name) => name !== 'settings'),
        ['search', 'collapse-all', 'add-workspace', 'select-mode'],
      )
      check.eq('① 顶栏与分组过滤条的文案里不含任何一个退役词', markers.retiredTexts, [])
      check.ok('④ 搜索框（含输入框）仍在', markers.others.searchBox && markers.others.searchInput, JSON.stringify(markers.others))
      check.ok(
        '④ 折叠/展开全部 · 添加工作区 · 多选入口仍在',
        markers.others.collapseAll && markers.others.addWorkspace && markers.others.selectMode,
        JSON.stringify(markers.others),
      )
      check.ok('④ 分组过滤条仍在（侧栏恒为按工作区）', markers.others.filterBar, JSON.stringify(markers.others))

      // ---- ② 没有能切平铺的路径：先看形态，再逐份菜单扫文案 ----
      check.eq('② 页面上没有平铺容器（标记 / 类名各查一次）', markers.flatContainers, 0)
      check.ok('② 树是分组形态（一个工作区一块，正是「按工作区」）', markers.groupedContainers >= 1, `分组容器 ${String(markers.groupedContainers)} 个`)
      const scanned: { name: string; items: string[] }[] = []
      const skipped: string[] = []
      for (const target of MENU_TRIGGERS) {
        const menuOpened = await openMenu(page, target)
        if (!menuOpened) {
          skipped.push(target.name)
          continue
        }
        const texts = (await menuTexts(page)) ?? []
        scanned.push({ name: target.name, items: texts })
        const hits = texts.filter((text) => RETIRED_TEXTS.some((retired) => text.includes(retired)))
        check.eq(`② ${target.name}：文案里没有分组 / 排序那几项`, hits, [])
        await closeMenu(page, target)
      }
      check.fact(`② 扫过的菜单：${scanned.map((entry) => `${entry.name}（${String(entry.items.length)} 条文案）`).join('、') || '（无）'}`)
      if (skipped.length > 0) check.fact(`② 这一轮页面上没有这些触发器，跳过：${skipped.join('、')}`)
      check.ok('② 至少扫到过两份菜单（菜单文案这一路真的跑到了）', scanned.length >= 2, `扫到 ${String(scanned.length)} 份`)
      screenshots.push(await shot(ctx, page, 'view-options-retired-topbar'))

      // ---- ③ 排序恒为官方顺序：干净态行序 vs 注入旧记录后的行序 ----
      await expandAllGroups(page)
      const cleanOrder = await readGroupOrder(page)
      check.ok(
        '③ 前置：干净态量到了分组的会话行（网关这一轮有数据）',
        cleanOrder.length > 0 && cleanOrder.some((group) => group.ids.length > 0),
        JSON.stringify(cleanOrder).slice(0, 300),
      )
      const seeded = await seedRetiredPrefs(page, cleanOrder.map((group) => group.key))
      check.fact(
        `③ 行序比对覆盖 ${String(cleanOrder.length)} 个分组、${String(cleanOrder.reduce((sum, group) => sum + group.ids.length, 0))} 条会话行`,
      )
      check.fact(`③ 注入旧版本的视图态记录：${JSON.stringify(seeded)}`)
      await page.reload({ waitUntil: 'domcontentloaded' })
      let ready = true
      try {
        await page.waitForSelector(route('sidebar').readySelector, { timeout: 40_000 })
      } catch {
        ready = false
      }
      await page.waitForTimeout(2_500)
      check.ok('③ 重载后装配页起来了', ready)

      const afterSeeded = await readMarkers(page)
      const seededOrder = await readGroupOrder(page)
      check.eq('③ 注入旧记录之后仍然没有视图选项入口', afterSeeded.viewOptions, 0)
      check.eq('③ 注入旧记录之后仍然没有平铺容器（groupBy:"flat" 不被认）', afterSeeded.flatContainers, 0)
      check.eq(
        '③ 每个分组的会话行顺序与干净态逐条相同（orderBy:"updated" 不被认，先后只来自官方顺序）',
        seededOrder.map((group) => group.ids),
        cleanOrder.map((group) => group.ids),
      )
      check.eq(
        '③ 分组本身的先后也没变',
        seededOrder.map((group) => group.key),
        cleanOrder.map((group) => group.key),
      )
      const storedKeys = await readStoredPrefKeys(page)
      check.eq(
        '③ 树写回的记录里只剩仍在用的四个字段（退役的 groupBy / orderBy 被抹掉）',
        [...storedKeys].sort(),
        ['activeGroupId', 'expandedGroups', 'recycleCollapsed', 'tagCollapsed'],
      )
      check.eq(
        '③ 写回的记录里确实没有那两个退役键',
        storedKeys.filter((key) => RETIRED_PREF_KEYS.has(key)),
        [],
      )
      check.ok(
        '④ 注入旧记录并重载后，其余四件与分组树照旧',
        afterSeeded.others.searchInput &&
          afterSeeded.others.collapseAll &&
          afterSeeded.others.addWorkspace &&
          afterSeeded.others.selectMode &&
          afterSeeded.others.filterBar &&
          afterSeeded.groupedContainers >= 1,
        JSON.stringify(afterSeeded.others),
      )
      screenshots.push(await shot(ctx, page, 'view-options-retired-seeded-prefs'))

      check.eq('视图选项退役套件全程零 pageerror', withoutKnownNoise(opened.capture.pageErrors).real, [])
    } finally {
      await opened.context.close()
    }
    return screenshots
  },
}
