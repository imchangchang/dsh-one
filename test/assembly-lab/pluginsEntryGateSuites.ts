/**
 * 「插件」入口按**官方这一代到底有没有插件页**出现（#253，F-76）。
 *
 * ## 现象与这一条要证的形状
 *
 * #252 把「插件」入口从官方那条整行挪进侧栏工具栏之后，那一枚**在所有版本上都渲染**，
 * 而官方插件页**最早只到 0.1.6-alpha.2**（`@deepseek-ai/dsh-client-ui-plugin-manager`
 * 这一件包最早的版本）⇒ 在 0.1.5-rc.2 / 0.1.5-rc.3（npm `latest` = `next`，也是版本门
 * 下界）与 0.1.6-alpha.1 上，用户看到一枚按钮、点开是空白页。
 *
 * 这一条判的是一条**关系**，不是在某一版上判「在场」或「不在场」——因为「该不该在场」
 * 正是版本相关的：**工具栏那一枚在不在场，必须等于这一代有没有那一页**。所以套件自己先读
 * 出两档事实里的哪一档，再按那一档判：
 *
 * - **这一代有**（0.1.6-alpha.2 起）：那一枚在场、点它 → 假宿主收到恰好一次开页调用；
 * - **这一代没有**（0.1.5 两版与 0.1.6-alpha.1）：那一枚**根本不在 DOM 里**（不是隐藏、
 *   不是禁用——没有可点的元素），宿主一次都没被要过、页面上零 pageerror。
 *
 * 于是同一份套件在每一代上都跑得出来结论，负向对照也判得死：把判据去掉（恒显示）之后，
 * 在「这一代没有」那一档上第一条关系式当场红（读数与做法记在 `README.md` 的累计记录里）。
 *
 * ## 判据用的是哪条读数（三条候选逐条实测过，比较写在 `src/pure/officialPluginsPage.ts` 文件头）
 *
 * 1. **本页 `__DSH_BOOT__` 清单里有没有官方那一件包**——这是生产判据（页面侧读本页清单，
 *    宿主侧读同一棵树 `filterWire()` 出来的清单），套件直接读页面里那份清单；
 * 2. **当天网关下发的官方 wire**（`ctx.lab.gatewayPluginIds()`，**未经我们过滤**的那一份）
 *    ——独立于生产代码的第二条读数，用来交叉核对第 1 条：我们那份过滤清单里没有它，
 *    究竟是因为这一代官方就没有，还是被我们自己的 block list 剥掉了。两者在这个 id 上
 *    必须一致（`sidebar` 树从来不挡它：官方那条面板入口那一行还要靠它注册）；
 * 3. **不按 dsh 版本号比较，也不按座判**：`sidebar.panellist` 这个座在 0.1.5-rc.3 与
 *    0.1.6-alpha.1 的官方 `dsh-client-ui-sidebar` 里**照样声明**（解开 npm 上那两份产物
 *    核过），座上没人只是「这一代没有那一件包」的结果；而侧栏 frame 自己往同一格
 *    （同 id `plugins`、priority −1）注册了遮蔽件，所以「座上有 id `plugins` 那个条目」
 *    这条读数恒定成立、等于没有判据。
 *
 * ## 与相邻套件的分工
 *
 * - **F-74**：那一页本身（plugins 树渲染出官方页本体与四张配置卡）+ 点那一枚之后那一趟
 *   到达宿主，含那一枚的文案。它在「这一代有」的那一档上是**正面判据**，在更老的版本上
 *   不适用（那一页本来就不存在）；本套件管的是**这一枚该不该在**这条关系。
 * - **F-75 / F-54**：壳座上那一格（`sidebar.panellist`）的形态与逐格规则，按 0.1.6-alpha.2
 *   的形状判。本套件只顺带记一条事实：那一格在页面上**没有可见的行**（两档都该是 0
 *   ——「这一代没有」时也不该因为我们自己的遮蔽件留出一个可见空行）。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import type { Page } from 'playwright'
import { OFFICIAL_PLUGINS_PAGE_PLUGIN_ID } from '../../src/pure/officialPluginsPage.ts'
import { contractGaps, openTreePage, type OpenedPage } from './harness.ts'
import { LAB_TREES, type LabTreeRoute } from './labServer.ts'
import type { LabSuite, SuiteContext } from './suites.ts'

const route = (name: string): LabTreeRoute => {
  const found = LAB_TREES.find((candidate) => candidate.route === name)
  if (found === undefined) throw new Error(`lab: unknown tree route ${name}`)
  return found
}

async function shot(ctx: SuiteContext, page: Page, name: string): Promise<string> {
  const file = path.join(ctx.shots, `${name}.png`)
  await fsp.mkdir(ctx.shots, { recursive: true })
  await page.screenshot({ path: file })
  return file
}

interface EntryFacts {
  /** 本页 `__DSH_BOOT__` 清单里有哪些 id（这一页真的拿到的装配来源）。 */
  manifestIds: string[]
  /** 工具栏那一枚插件图标在不在（`data-dshone-tree-action="plugins"`）。 */
  toolbarFound: boolean
  toolbarVisible: boolean
  toolbarLabel: string
  /** 官方那条「插件」整行在页面上还有几个**可见**的可点元素（两档都该是 0）。 */
  visibleRowButtons: number
  /** 假宿主收到的开页调用次数（-1 = 假宿主不在场）、那一页在宿主侧开着没有。 */
  opened: number
  pageOpen: boolean
}

async function entryFacts(page: Page): Promise<EntryFacts> {
  return page.evaluate(() => {
    const visible = (element: Element): boolean => {
      const box = element.getBoundingClientRect()
      if (box.width <= 0 || box.height <= 0) return false
      const style = getComputedStyle(element)
      return style.display !== 'none' && style.visibility !== 'hidden'
    }
    const wire = (globalThis as { __DSH_BOOT__?: { entries?: { id?: unknown }[] } }).__DSH_BOOT__
    const manifestIds = (wire?.entries ?? [])
      .map((entry) => (typeof entry?.id === 'string' ? entry.id : ''))
      .filter((id) => id !== '')
    const rowButtons = Array.from(document.querySelectorAll('[data-slot="sidebar.panellist"]'))
      .map((glyph) => glyph.closest('button'))
      .filter((button): button is HTMLButtonElement => button !== null)
    const toolbar = document.querySelector<HTMLElement>('[data-dshone-tree-action="plugins"]')
    const host = (globalThis as { __LAB_HOST__?: { pluginsOpened?: unknown[]; pluginsPageOpen?: boolean } }).__LAB_HOST__
    return {
      manifestIds,
      toolbarFound: toolbar !== null,
      toolbarVisible: toolbar !== null && visible(toolbar),
      toolbarLabel: toolbar?.getAttribute('aria-label') ?? '',
      visibleRowButtons: rowButtons.filter(visible).length,
      opened: host?.pluginsOpened?.length ?? -1,
      pageOpen: host?.pluginsPageOpen === true,
    }
  })
}

/** 点工具栏那一枚（这一代有插件页时才有它——所以调用前先判在场）。 */
async function clickToolbarPlugins(page: Page): Promise<void> {
  await page.click('[data-dshone-tree-action="plugins"]')
}

/** 等某一格读数到位（能力口 → 宿主回执是异步的），超时后返回最后一拍。 */
async function waitForEntry(
  page: Page,
  predicate: (facts: EntryFacts) => boolean,
  timeoutMs = 5_000,
): Promise<EntryFacts> {
  const deadline = Date.now() + timeoutMs
  let facts = await entryFacts(page)
  while (!predicate(facts) && Date.now() < deadline) {
    await page.waitForTimeout(100)
    facts = await entryFacts(page)
  }
  return facts
}

export const PLUGINS_ENTRY_GATE_SUITE: LabSuite = {
  id: 'F-76',
  phase: 'new-feature',
  name: '「插件」入口按官方这一代有没有插件页出现（#253 收掉 #252 的尾巴）',
  expect:
    '侧栏树（真网关只读 + 假宿主）上判一条**关系**：工具栏那一枚「插件」图标在不在场，必须等于**这一代官方有没有插件页**——' +
    '判据先读两份清单的一致性（本页 `__DSH_BOOT__` 与当天网关未经我们过滤的官方 wire，在这个 id 上必须一致）。' +
    '「这一代有」（0.1.6-alpha.2 起）：那一枚在场且可见、点它 → 假宿主收到**恰好一次**开页调用、那一趟到达了宿主（那一页在宿主侧被标成开着）；' +
    '「这一代没有」（0.1.5 两版与 0.1.6-alpha.1）：那一枚**根本不在 DOM 里**（点不了）、宿主一次都没被要过、整页零 pageerror；' +
    '两档共同：官方那条整行在页面上没有可见的可点元素、零槽位崩溃 / 零装载未激活 / 零 pageerror、侧栏树首屏就绪。',
  async run(ctx: SuiteContext, check): Promise<string[]> {
    const shots: string[] = []
    const sidebar: OpenedPage = await openTreePage(ctx.browser, ctx.lab, route('sidebar'))
    const page = sidebar.page
    try {
      const facts = await entryFacts(page)
      // 独立读数：当天网关下发的官方 wire（**没经过我们的 block list**）里有没有那一件包。
      // 拿它与本页清单交叉核对，才能把「这一代官方就没有」与「被我们自己剥掉了」分开。
      const gatewayIds = await ctx.lab.gatewayPluginIds()
      const gatewayHasPage = gatewayIds.has(OFFICIAL_PLUGINS_PAGE_PLUGIN_ID)
      const pageHasPage = facts.manifestIds.includes(OFFICIAL_PLUGINS_PAGE_PLUGIN_ID)

      check.fact(
        `侧栏树（dsh ${ctx.lab.dshVersion ?? '（版本未知）'}）：本页清单 ${String(facts.manifestIds.length)} 条、` +
          `含官方插件页那一件包=${String(pageHasPage)}；当天网关官方 wire ${String(gatewayIds.size)} 条、` +
          `含那一件包=${String(gatewayHasPage)}；工具栏那一枚 —— 在场=${String(facts.toolbarFound)} 可见=${String(facts.toolbarVisible)} ` +
          `aria-label=${JSON.stringify(facts.toolbarLabel)}；官方那条整行可见的可点元素=${String(facts.visibleRowButtons)}；开页调用=${String(facts.opened)}`,
      )

      // ① **两份清单在这个 id 上一致**：本页过滤清单里没有它，只能是这一代官方就没有
      //    （sidebar 树从来不挡它——官方那条面板入口那一行还要靠它注册）。
      check.eq(
        '这一代有没有插件页：本页清单与当天网关的官方 wire 在这个 id 上一致（排除「被我们自己 block 掉了」）',
        pageHasPage,
        gatewayHasPage,
      )

      // ② **这一枚该不该在**：与上面那条读数一致（这一条就是 #253 的判据本身）。
      check.eq('工具栏那一枚「插件」图标在场 ⟺ 这一代官方有插件页', facts.toolbarFound, gatewayHasPage)
      // 在场就必须真的看得见（`display:none` 式的「假在场」不算）；不在场时两个读数都该是假。
      check.eq('那一枚可见 ⟺ 这一代官方有插件页', facts.toolbarVisible, gatewayHasPage)

      // ③ 官方那条整行在两档上都不该可见（#252 的形态：「这一代有」时被遮蔽 + 行盒摘掉，
      //    「这一代没有」时根本不该因为我们自己的遮蔽件留出一个可见空行）。
      check.eq('官方那条「插件」整行在页面上没有可见的可点元素', facts.visibleRowButtons, 0)
      check.eq('点之前宿主没被要过开页', facts.opened, 0)

      if (gatewayHasPage) {
        // ④-a 「这一代有」这一档：那一枚在场，点它 → 恰好一次、真的到达宿主。
        check.ok('这一代有插件页：那一枚在场且可见', facts.toolbarFound && facts.toolbarVisible, JSON.stringify(facts))
        await clickToolbarPlugins(page)
        const clicked = await waitForEntry(page, (next) => next.opened === 1 && next.pageOpen)
        check.eq('点它之后假宿主收到恰好一次开页调用', clicked.opened, 1)
        check.ok('那一趟到达了宿主（独立编辑器页在宿主侧被标成开着）', clicked.pageOpen, JSON.stringify(clicked))
        shots.push(await shot(ctx, page, 'f-76-1-with-plugins-page'))
      } else {
        // ④-b 「这一代没有」这一档：那一枚**根本不在 DOM 里**（没有可点的元素，不是隐藏 /
        //     不是禁用），宿主一次都没被要过——这一档的判据就是「点不了、也不报错」。
        check.eq('这一代没有插件页：那一枚根本不在 DOM 里（没有可点的元素）', facts.toolbarFound, false)
        check.ok(
          '这一代没有插件页：宿主一次都没被要过开页',
          facts.opened === 0,
          `opened=${String(facts.opened)}`,
        )
        shots.push(await shot(ctx, page, 'f-76-2-without-plugins-page'))
      }

      // ⑤ 两档共同：整页干净（判据缺席时按「这一代没有」处置，不许在页面上留下错误）。
      const gaps = contractGaps(sidebar.capture)
      check.eq('整页零 pageerror', gaps.pageErrors, [])
      check.eq('零槽位崩溃日志（slot entry crashed）', gaps.crashes, [])
      check.eq('零装载未激活（缺服务 / 缺钩子）', gaps.bootFails, [])
      check.ok('侧栏树首屏就绪（自有树挂上了）', sidebar.ready, `ready=${String(sidebar.ready)}`)
    } finally {
      await sidebar.context.close()
    }
    return shots
  },
}
