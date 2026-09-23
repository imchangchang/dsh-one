/**
 * 回收站入口行的图标与开合（#114）。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与 `driftSuites.ts` 同一条：那个文件是本批
 * 开发的合入热点（F-07…F-19 都在里面改），新套件放外面能少一半冲突面。注册方式是在
 * `suites.ts` 的 `SUITES` 末尾追加一项。
 *
 * 本套件**完全不碰网关的写面**：假宿主的 `recycle-bin` 状态存储由夹具注入（空集合那一页
 * 用来量计数 0 的灰态；第二页塞一条树里真实存在的会话 id，用来在「抽屉里真有内容」时验
 * 开合），全程只读真网关。
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

/** 入口行那枚主区按钮上「当前展开态」的自有标记（与 `aria-expanded` 同源）。 */
const EXPANDED_FLAG = 'data-dshone-tree-recycle-expanded'
const DRAWER = '[data-dshone-tree="recycle-drawer"]'
const ENTRY_MAIN = '[data-dshone-tree-action="recycle-toggle"]'

/** 页面侧读一次入口行 + 抽屉的当前形态（图标、计数、灰态、禁用、开合）。 */
async function entryFacts(page: OpenedPage['page']): Promise<{
  icon: string
  viewBox: string
  width: string
  height: string
  iconPaths: string
  iconPath: string
  emptyActionPath: string
  restoreActionPath: string
  count: string
  rowEmptyClass: boolean
  mainDisabled: boolean
  expandedFlag: string
  ariaExpanded: string
  emptyDisabled: boolean
  restoreDisabled: boolean
  drawer: number
  drawerRows: number
  drawerStatus: number
}> {
  return page.evaluate(
    ([drawerSelector, flag]) => {
      const row = document.querySelector('[data-dshone-tree="recycle-entry"]')
      const main = document.querySelector('[data-dshone-tree-action="recycle-toggle"]') as HTMLButtonElement | null
      const iconSpan = main?.querySelector('.dshOneTree_footerIcon') ?? null
      const svg = iconSpan?.querySelector('svg') ?? null
      const pathOf = (element: Element | null): string => element?.querySelector('path')?.getAttribute('d') ?? ''
      const actionButton = (name: string): HTMLButtonElement | null =>
        document.querySelector(`[data-dshone-tree-action="${name}"]`) as HTMLButtonElement | null
      const drawer = document.querySelector(drawerSelector)
      return {
        icon: iconSpan?.getAttribute('data-dshone-tree-icon') ?? '',
        viewBox: svg?.getAttribute('viewBox') ?? '',
        width: svg?.getAttribute('width') ?? '',
        height: svg?.getAttribute('height') ?? '',
        iconPaths: String(svg?.querySelectorAll('path').length ?? -1),
        iconPath: pathOf(svg),
        emptyActionPath: pathOf(actionButton('recycle-empty-all')),
        restoreActionPath: pathOf(actionButton('recycle-restore-all')),
        count: row?.getAttribute('data-dshone-tree-recycle-count') ?? '',
        rowEmptyClass: row?.className.includes('dshOneTree_footerRowEmpty') ?? false,
        mainDisabled: main?.disabled ?? true,
        expandedFlag: main?.getAttribute(flag) ?? '',
        ariaExpanded: main?.getAttribute('aria-expanded') ?? '',
        emptyDisabled: actionButton('recycle-empty-all')?.disabled ?? false,
        restoreDisabled: actionButton('recycle-restore-all')?.disabled ?? false,
        drawer: document.querySelectorAll(drawerSelector).length,
        drawerRows: drawer?.querySelectorAll('[data-dshone-recycle-row]').length ?? -1,
        drawerStatus: drawer?.querySelectorAll('.dshOneTree_drawerStatus').length ?? -1,
      }
    },
    [DRAWER, EXPANDED_FLAG] as const,
  )
}

/** 点一下主区，等抽屉的滑入/滑出过渡落定。 */
async function clickMain(page: OpenedPage['page']): Promise<void> {
  await page.click(ENTRY_MAIN)
  await page.waitForTimeout(350)
}

export const RECYCLE_ENTRY_TOGGLE_SUITE: LabSuite = {
  id: 'F-20',
  phase: 'new-feature',
  name: '回收站入口行：主区图标是垃圾桶 + 点击是「展开 / 收起」（#114，RECYCLE-ENTRY-TOGGLE 套件）',
  expect:
    '回收站入口行的两条改动在真实装配页上成立（真网关**只读** + 假宿主注入的 `recycle-bin`）：① **主区图标是垃圾桶**——按组件标记与渲染指纹核，不靠眼睛：图标位的 `data-dshone-tree-icon` 是 `IconTrashOutline`，渲染出的 svg 是官方那枚垃圾桶（它的 `path@d` 与同一行「清空」那枚**完全相同** = 同一枚官方图标、与「恢复全部」那枚不同；换下去的归档图标有可判定的不同指纹）。**注意渲染指纹（视框 / path 数）是 0.1.6 那代官方产物的形状**：0.1.7-alpha.2 起官方把这套图标重画了一遍（垃圾桶从 1 条实心 path 变成 5 条描边 path、视框不变），所以在 0.1.7 上跑这一套时那几条形状断言会红——那是判据钉在 0.1.6 形状上，不是功能坏了，见 issue #236；② **点击是开合开关**——主区点一下抽屉出现且按钮的 `aria-expanded` / 自有标记翻成展开，再点一下抽屉消失、标记翻回收起（连点两次 = 展开→收起）；③ **与「点外面 / Esc 关闭」是同一份状态**：抽屉开着时点树区（抽屉外）或按 Esc 都收起，之后**再点主区是展开**（不会「点了没反应」），按钮的标记与屏幕上抽屉的真实状态始终一致；④ **计数 0 的行为不变**——注入空集合时整行仍是灰态、右侧两枚动作图标仍禁用，主区仍可点且照常开合；另在「抽屉里真有内容」的那一页重验一遍开合，证明 toggle 不是只在空态成立。全程零 pageerror，本套件不点归档确认、不写网关。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const shot = async (page: OpenedPage['page'], name: string): Promise<string> => {
      const file = path.join(ctx.shots, `${name}.png`)
      await fsp.mkdir(ctx.shots, { recursive: true })
      await page.screenshot({ path: file })
      return file
    }

    // ---------------------------------------------------------------------
    // 第一页：空集合（计数 0）——图标记号、灰态与禁用、开合三态
    // ---------------------------------------------------------------------
    const empty = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), {
      width: 380,
      height: 900,
      state: { 'recycle-bin': { version: 1, sessionIds: [] } },
    })
    try {
      const { page } = empty
      const start = await entryFacts(page)
      check.fact(
        `入口行图标：标记=${start.icon} viewBox=${start.viewBox} 宽高=${start.width}×${start.height} path 数=${start.iconPaths}；计数=${start.count}`,
      )

      // ---- ① 主区图标是垃圾桶 ----
      check.eq('主区图标的标记是官方垃圾桶（IconTrashOutline）', start.icon, 'IconTrashOutline')
      check.ok(
        '渲染出来的是官方那枚垃圾桶（viewBox 0 0 16 16、宽高 16、单条 path —— path 数是 0.1.6 那代的形状）',
        start.viewBox === '0 0 16 16' && start.width === '16' && start.height === '16' && start.iconPaths === '1',
        `viewBox=${start.viewBox} ${start.width}×${start.height} paths=${start.iconPaths}`,
      )
      check.ok(
        '换下去的归档图标有可判定的不同指纹（0.1.6 那代是 viewBox 0 0 20 20）——主区不再是归档箱',
        start.viewBox !== '0 0 20 20',
        `viewBox=${start.viewBox}`,
      )
      check.ok(
        '主区图标与同一行「清空」那枚是同一枚官方图标（位图 d 完全相同）',
        start.iconPath !== '' && start.iconPath === start.emptyActionPath,
        `主区=${start.iconPath.slice(0, 48)}… 清空=${start.emptyActionPath.slice(0, 48)}…`,
      )
      check.ok(
        '主区图标与「恢复全部」那枚不是同一枚（d 不同）',
        start.iconPath !== start.restoreActionPath,
        `恢复全部=${start.restoreActionPath.slice(0, 48)}…`,
      )

      // ---- ④ 计数 0：灰态 + 两枚动作禁用（行为不变） ----
      check.eq('夹具的空集合真的被读到了（入口计数 0）', start.count, '0')
      check.ok('计数 0 时整行仍是灰态', start.rowEmptyClass, `className 含 dshOneTree_footerRowEmpty=${String(start.rowEmptyClass)}`)
      check.ok(
        '计数 0 时右侧两枚动作图标仍禁用',
        start.emptyDisabled && start.restoreDisabled,
        `清空=${String(start.emptyDisabled)} 恢复全部=${String(start.restoreDisabled)}`,
      )
      check.ok('计数 0 时主区仍可点（灰态不挡开关）', start.mainDisabled === false)
      check.eq('开局抽屉是关着的（起点）', start.drawer, 0)

      // ---- ② 两次点击 = 展开 → 收起 ----
      await clickMain(page)
      const opened = await entryFacts(page)
      check.eq('第一次点主区：抽屉展开', [opened.drawer, opened.expandedFlag, opened.ariaExpanded], [1, 'true', 'true'])
      // 空集合那一页抽屉里应当是空态行（自有类名，不看文案，免得跟页面语言绑死）。
      check.eq('展开的空回收站抽屉给的是空态行、没有会话行', [opened.drawerStatus, opened.drawerRows], [1, 0])
      const hostBin = await page.evaluate(
        () => (globalThis as unknown as { __LAB_HOST__?: { stateStore?: Record<string, unknown> } }).__LAB_HOST__?.stateStore?.['recycle-bin'] ?? null,
      )
      check.eq(
        '计数 0 是从注入的那份空集合读出来的（不是读失败降级）',
        hostBin,
        { version: 1, sessionIds: [] },
      )
      screenshots.push(await shot(page, 'recycle-entry-toggle-open'))
      await clickMain(page)
      const closed = await entryFacts(page)
      check.eq('第二次点主区：抽屉收起', [closed.drawer, closed.expandedFlag, closed.ariaExpanded], [0, 'false', 'false'])

      // ---- ③ 点抽屉外 / Esc 关掉之后，再点是展开 ----
      await clickMain(page)
      check.eq('再次点主区又是展开（连点是开合，不是只能开一次）', (await entryFacts(page)).drawer, 1)
      // 点抽屉外：抽屉是树区里的一块，所以「外面」= 树区里、抽屉上方的一处空白。点哪一
      // 像素由页面自己算（`elementFromPoint` 现场确认那一处在树区内且不在抽屉上），
      // 不写死坐标——抽屉高度是半高，屏幕尺寸变了也不会点到抽屉上去。
      const spot = await page.evaluate(
        ([drawerSelector]) => {
          const root = document.querySelector('[data-dshone-tree="root"]')
          const drawer = document.querySelector(drawerSelector)
          if (root === null || drawer === null) return null
          const rootBox = root.getBoundingClientRect()
          const drawerBox = drawer.getBoundingClientRect()
          const candidates: readonly (readonly [number, number])[] = [
            [rootBox.right - 2, rootBox.top + 1],
            [rootBox.left + 2, rootBox.top + 1],
            [rootBox.right - 2, drawerBox.top - 2],
            [rootBox.left + 2, drawerBox.top - 2],
            [rootBox.right - 2, (rootBox.top + drawerBox.top) / 2],
          ]
          for (const [x, y] of candidates) {
            const hit = document.elementFromPoint(x, y)
            if (hit !== null && root.contains(hit) && !drawer.contains(hit)) {
              return { x, y, hit: hit.tagName + '.' + String(hit.className) }
            }
          }
          return null
        },
        [DRAWER] as const,
      )
      check.ok('能在树区里找到一处「在树区内、不在抽屉上」的点（点外面要真的点得着）', spot !== null, JSON.stringify(spot))
      if (spot !== null) {
        await page.mouse.click(spot.x, spot.y)
        await page.waitForTimeout(300)
      }
      const afterOutside = await entryFacts(page)
      check.eq('点外面：抽屉收起、按钮标记跟着翻成收起', [afterOutside.drawer, afterOutside.expandedFlag], [0, 'false'])
      await clickMain(page)
      const afterOutsideReopen = await entryFacts(page)
      check.eq(
        '点外面关掉之后再点主区 = 展开（不会「点了没反应」）',
        [afterOutsideReopen.drawer, afterOutsideReopen.expandedFlag],
        [1, 'true'],
      )
      // Esc 同一条路：开着时按 Esc 收起。
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
      const afterEsc = await entryFacts(page)
      check.eq('Esc：抽屉收起、按钮标记跟着翻成收起', [afterEsc.drawer, afterEsc.expandedFlag], [0, 'false'])
      await clickMain(page)
      const afterEscReopen = await entryFacts(page)
      check.eq(
        'Esc 关掉之后再点主区 = 展开',
        [afterEscReopen.drawer, afterEscReopen.expandedFlag],
        [1, 'true'],
      )
      // 抽屉自己的关闭按钮也走同一份状态。
      await page.click('[data-dshone-tree-action="recycle-close"]')
      await page.waitForTimeout(300)
      check.eq(
        '抽屉上的关闭按钮同样把按钮标记翻回收起（两侧读的是同一份状态）',
        [(await entryFacts(page)).drawer, (await entryFacts(page)).expandedFlag],
        [0, 'false'],
      )
      check.eq('空集合那一页全程零 pageerror', withoutKnownNoise(empty.capture.pageErrors).real, [])
    } finally {
      await empty.context.close()
    }

    // ---------------------------------------------------------------------
    // 第二页：抽屉里真有内容（塞一条树里真实存在的会话 id）——再验一遍开合
    // ---------------------------------------------------------------------
    const seeded = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { width: 380, height: 900 })
    try {
      const { page } = seeded
      await page.waitForSelector(route('sidebar').readySelector)
      const sessionId = await page.evaluate(() => {
        const row = document.querySelector('[data-dshone-tree-row="session"]')
        return row?.getAttribute('data-dshone-tree-session') ?? ''
      })
      check.fact(`塞进回收站的那一条会话：${sessionId}`)
      if (sessionId === '') {
        check.ok('树里至少有一行会话可供夹具使用', false, '网关列表里没有会话行，本页的后半段无法验')
      } else {
        // 与 F-15 同一处置：注入的是**旧侧栏那份文件的形状**，页面打开时原样读回。
        await page.addInitScript({
          content: `(() => { globalThis.__LAB_HOST__.stateStore['recycle-bin'] = ${JSON.stringify({ version: 1, sessionIds: [sessionId] })} })()`,
        })
        await page.reload({ waitUntil: 'domcontentloaded' })
        await page.waitForSelector(route('sidebar').readySelector, { timeout: 40_000 })
        await page.waitForTimeout(2_500)
        const seededStart = await entryFacts(page)
        check.eq('夹具生效：入口计数 1（不是空态）', [seededStart.count, seededStart.rowEmptyClass], ['1', false])
        // 开合态是内存里的瞬态，重载后回到「关着」——这也是下面几次点击的方向前提。
        check.eq('重载后抽屉是关着的（开合态不落盘）', seededStart.drawer, 0)
        check.ok(
          '有内容时两枚动作图标不再禁用（与计数 0 的对照）',
          seededStart.emptyDisabled === false && seededStart.restoreDisabled === false,
          `清空=${String(seededStart.emptyDisabled)} 恢复全部=${String(seededStart.restoreDisabled)}`,
        )
        await clickMain(page)
        const withRows = await entryFacts(page)
        check.eq(
          '有内容时点主区：抽屉展开且真带着那一行',
          [withRows.drawer, withRows.drawerRows, withRows.expandedFlag],
          [1, 1, 'true'],
        )
        screenshots.push(await shot(page, 'recycle-entry-toggle-with-rows'))
        await clickMain(page)
        check.eq(
          '再点一下：抽屉收起（有内容时同样是开合）',
          [(await entryFacts(page)).drawer, (await entryFacts(page)).expandedFlag],
          [0, 'false'],
        )
        await clickMain(page)
        check.eq('第三次点：又展开', (await entryFacts(page)).drawer, 1)
        check.eq('重载后模块状态归零不会错位：标记与抽屉一致（开着）', (await entryFacts(page)).expandedFlag, 'true')
      }
      check.eq('有内容那一页全程零 pageerror', withoutKnownNoise(seeded.capture.pageErrors).real, [])
    } finally {
      await seeded.context.close()
    }
    return screenshots
  },
}
