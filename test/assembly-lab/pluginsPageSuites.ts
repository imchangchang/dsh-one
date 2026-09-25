/**
 * 官方「插件」页在 VS Code 侧有落点、入口在侧栏工具栏那一枚（#247 + #252，F-74）。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与 F-64…F-73 同一：那个文件是本批开发的
 * 合入热点，新套件放外面能少一半冲突面。注册方式是在 `suites.ts` 的 `SUITES` 末尾
 * 追加一项。
 *
 * ## 这一条要证的形状（改前 / 改后）
 *
 * 官方 web 的「插件」页是 **keyed `main` 上的全局面板**（key = `plugins`），由官方
 * 外框按选中态取键渲染。它的入口换过两次，**两次都在这条套件里**：
 *
 * - **#247 改前**：入口是官方侧栏 `sidebar.panellist` 上那一行，点它走官方
 *   `ctx.layout.selectPanel('plugins')` → 落到我们提供的 layout 服务的缺省判据
 *   `() => false` → 抛官方那句 `layout.selectPanel: main panel "plugins" is not
 *   registered`，页面上什么都不动；插件页本体与它自己声明那三个座上的四张官方配置卡
 *   在 VS Code 侧一个入口都没有。
 * - **#247 改后**：侧栏树的 layout 服务受理这个 id（机制层 2：官方通过服务契约调我们的
 *   服务）→ 经宿主能力口 `openPlugins` 请宿主开独立编辑器页（plugins 树）；页面上那一页
 *   真的渲染出官方内容（四张配置卡坐落在 `plugins.item` 上）。
 * - **#252 改后（今天）**：入口从官方那条整行挪到**我们侧栏工具栏那一枚插件图标**
 *   （紧挨设置齿轮左侧，与 #99 把设置入口收到齿轮是同一个先例）——官方那条整行按同 id +
 *   priority −1 遮蔽、行盒子另按 css-module 名后缀摘掉（见 `sidebarLayoutPlugin`），
 *   工具栏那一枚直接走**同一条能力口** `openPlugins()`。官方件照常装载（插件页本体靠它）。
 *
 * 所以本套件三段，**三段都要**：只验页面本身（页面装得起来）证不了「点入口能打开它」，
 * 只验点击（假宿主记了一笔）证不了「打开的那一页里真有官方内容」。
 *
 * ## 判据的三块与它们的来源
 *
 * 1. **plugins 树页面**（`/tree/plugins`）：官方页面本体在场、官方那两组的组名与计数
 *    对得上、四张配置卡都在（`plugins.item` 锚点 4 枚 + 四个卡名逐字在场）、零
 *    `slot entry crashed` / 零装载未激活 / 零 pageerror / 零 `data-slot-error`。
 * 2. **侧栏那一处**（#252）：官方那条整行**不再渲染**（那一行没有可见的可点元素）、
 *    `sidebar.panellist` 座上上位的是我们那条遮蔽件（priority −1）；工具栏那一枚在场、
 *    文案是我们词典里那条、紧挨设置齿轮左侧；点它 → 假宿主收到**恰好一次**开页调用、
 *    那一趟到达了宿主（独立编辑器页被标成开着）+ 整页零 pageerror。真宿主那一半
 *    （建/聚焦 `dshOne.assembledPlugins`）由 `test/hostCapabilityDeps.test.ts` 的 N-03 守着。
 * 3. **校验本身没被删**（同一页上的就地负向对照）：经 fiber 探针留下的 `ctx` 反射取
 *    `layout` 服务，直接调 `selectPanel('dshOne.no.such.panel')` **必须**照旧抛官方
 *    那句，调 `selectPanel('plugins')` 不许抛——后者同时是「官方哪天把那一行放回来，
 *    点它照旧能开页」的保证。
 *
 * **整轮改前/改后的负向对照不在套件里**（要换代码重建产物才跑得出来），读数与做法记在
 * `test/assembly-lab/README.md` 的累计记录里。今天这一版本的两条：
 *
 * - 去掉遮蔽（删掉 `sidebarLayoutPlugin` 里那条 `sidebar.panellist` 的 shadow 注册）→
 *   第 2 段的「那一行不再渲染」与「座上上位的是 priority −1 那条」转红；
 * - 去掉工具栏那一枚（`workspaceTreePlugin` 不再注入 `openPlugins`）→「那一枚在场」
 *   与点击那几条转红（点击前的读数为 `toolbarFound=false`）。
 *
 * ## 文案的出处（官方件的文案，我们那份词典里没有也不该有）
 *
 * 官方插件页与四张卡的文案属于官方件，逐字引用并把出处写在常量旁边（做法同
 * `archivedRestoreSuites.ts` 引用官方设置节名那一处）：组名 `officialTitle` /
 * `bundlesTitle`、四张卡的 `bashTitle` / `agentLoopTitle` / `subagentTitle` /
 * `webSearchTitle`（`@deepseek-ai/dsh-client-ui-settings-plugins` 的 locale 字典
 * `settings.plugins`）。zh / en 两份都认（页面语言由整轮跑法钉死，判据不该绑死语言）。
 *
 * **工具栏那一枚的文案不是官方文案**：它出自我们自己的词典
 * （`packages/dsh-workspace-tree/src/workspaceTree/locale.ts` 的 `toolbar.plugins`），
 * 所以它按 `ours` 那一档读（`TOOLBAR_PLUGINS_LABELS`，两份取值逐字对上那条键）。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import type { Page } from 'playwright'
import { contractGaps, openTreePage, slotFacts, type OpenedPage } from './harness.ts'
import { LAB_TREES, type LabTreeRoute } from './labServer.ts'
import { readSeatSnapshot } from './shellSeats.ts'
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

/**
 * 官方插件页两组的组名（`officialTitle` / `bundlesTitle`，zh / en 两份）。
 * 出处：`@deepseek-ai/dsh-client-ui-plugin-manager` 的 locale 字典 `pluginManager`
 * （0.1.6-alpha.2 的 combo 原文 `officialTitle: "官方"` / `"Official"`、
 * `bundlesTitle: "已安装"` / `"Installed"`）。
 */
const OFFICIAL_GROUP_LABELS = { official: ['官方', 'Official'], bundles: ['已安装', 'Installed'] } as const

/**
 * 四张官方配置卡的卡名（`bashTitle` / `agentLoopTitle` / `subagentTitle` /
 * `webSearchTitle`，zh / en 两份）。出处：`@deepseek-ai/dsh-client-ui-settings-plugins`
 * 的 locale 字典 `settings.plugins`（同版本的 combo 原文）。
 *
 * 这四条就是 #247 里「跟着插件页一起消失的能力」：终端命令超时 / Agent 循环并行数 /
 * Subagent 递归上限与模型选择 / 网页搜索 Key 这四张卡。
 */
const OFFICIAL_CARD_LABELS: ReadonlyArray<readonly string[]> = [
  ['终端', 'Shell'],
  ['Agent 循环', 'Agent loop'],
  ['Subagent'],
  ['网页搜索', 'Web search'],
]

/**
 * 工具栏那一枚「插件」图标的文案（#252）：**不是官方文案**，出自我们自己的词典
 * `packages/dsh-workspace-tree/src/workspaceTree/locale.ts` 的 `toolbar.plugins`
 * （`\u63D2\u4EF6` / `Plugins`）——悬停提示与读屏标签共用那一对取值。
 *
 * 措辞跟着官方那一行（官方 plugin-manager 字典的 `panel` 也是「插件」/「Plugins」），
 * 同一件事在界面上只有一个名字；但取值来自我们的词典，所以是 `ours` 那一档。
 */
const TOOLBAR_PLUGINS_LABELS = ['插件', 'Plugins'] as const

/** 官方那句「未注册」错误的原句（官方 ui-layout 与我们那份判据同一句）。 */
const NOT_REGISTERED_RE = /is not registered/

interface GroupFact {
  id: string
  title: string
  count: number
}

/** 官方插件页的分组读数（`[data-plugin-group]` 的 id / 组名 / 计数）。 */
async function groupFacts(page: Page): Promise<GroupFact[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-plugin-group]')).map((element) => ({
      id: element.getAttribute('data-plugin-group') ?? '',
      title: (element.querySelector('h3')?.textContent ?? '').trim(),
      count: Number.parseInt(element.querySelector('[data-plugin-count]')?.textContent ?? '', 10),
    })),
  )
}

/**
 * 四张官方配置卡的**条目 id**（官方 `ui-settings-plugins` 注册进 `plugins.item` 的
 * `id` 逐字：`bash` / `agent-loop` / `subagent` / `web-search`，见该包 0.1.6-alpha.2
 * 的 `lib/client.js`）。官方插件页把每张卡渲染成 `<li data-plugin-item="<id>">`，
 * 所以这份 id 表就是「四张卡真的落座了」的可判据形态。
 */
const OFFICIAL_CARD_IDS = ['bash', 'agent-loop', 'subagent', 'web-search'] as const

interface PageFacts {
  groups: GroupFact[]
  /** `[data-plugin-item]` 卡：id 与它的正文（摘要一行的渲染结果）。 */
  cards: { id: string; text: string }[]
  /** `[data-slot="plugins.item"]` 锚点数与各自的子元素数。 */
  seats: number[]
}

async function pageFacts(page: Page): Promise<PageFacts> {
  return page.evaluate(() => ({
    groups: Array.from(document.querySelectorAll('[data-plugin-group]')).map((element) => ({
      id: element.getAttribute('data-plugin-group') ?? '',
      title: (element.querySelector('h3')?.textContent ?? '').trim(),
      count: Number.parseInt(element.querySelector('[data-plugin-count]')?.textContent ?? '', 10),
    })),
    cards: Array.from(document.querySelectorAll('[data-plugin-item]')).map((element) => ({
      id: element.getAttribute('data-plugin-item') ?? '',
      text: (element.textContent ?? '').trim(),
    })),
    seats: Array.from(document.querySelectorAll('[data-slot="plugins.item"]')).map((element) => element.children.length),
  }))
}

/**
 * 官方插件页的四张配置卡是**异步落座**的：页面先向宿主取设置命名空间清单，拿到之后
 * 才把那些配置页注册进 `plugins.item`（官方 `ui-settings-plugins` 的
 * `describeFace.ensure()` 那一轮），落座后还要一次重渲。所以这里等到四张卡都出现
 * 再读读数——早读会拿到「组计数还是 6、卡座是空的」那一帧。
 */
async function waitForCardFacts(page: Page, timeoutMs = 15_000): Promise<PageFacts> {
  const deadline = Date.now() + timeoutMs
  let facts = await pageFacts(page)
  while (facts.cards.length < OFFICIAL_CARD_IDS.length && Date.now() < deadline) {
    await page.waitForTimeout(200)
    facts = await pageFacts(page)
  }
  return facts
}

interface SidebarEntryFact {
  /** 官方那条「插件」整行：那一行在 DOM 里还有几个、其中几个是可见的（有非零盒子）。 */
  rowButtons: number
  visibleRowButtons: number
  rowLabel: string
  /** 工具栏那一枚插件图标（`data-dshone-tree-action="plugins"`）。 */
  toolbarFound: boolean
  toolbarLabel: string
  toolbarVisible: boolean
  /** 它在动作组里紧挨着设置齿轮吗（同一排、正好是齿轮前面那一个元素）。 */
  toolbarAdjacentToGear: boolean
  /** 假宿主收到的开页调用次数（-1 = 假宿主不在场）、那一页在宿主侧现在开着没有。 */
  opened: number
  pageOpen: boolean
}

/**
 * 侧栏两处的读数（#252）：官方那一行（应当只剩一个不可见的空壳）+ 工具栏那一枚（新的入口）。
 *
 * 为什么「官方那一行」按**可见盒子**读，而不是按它在不在 DOM 里：那一行由本树按同 id +
 * priority −1 遮蔽（层 1），行盒子另按 css-module 名后缀摘掉（层 4，见 sidebarLayoutPlugin
 * 的 CSS 举证）——两道里任何一道失效，那一行都会重新**看得见**，而 DOM 里它始终是同一个
 * `[data-slot="sidebar.panellist"]` 出口。所以判据读「有没有可见的那一行」。
 */
async function sidebarEntryFacts(page: Page): Promise<SidebarEntryFact> {
  return page.evaluate(() => {
    const visible = (element: Element): boolean => {
      const box = element.getBoundingClientRect()
      if (box.width <= 0 || box.height <= 0) return false
      const style = getComputedStyle(element)
      return style.display !== 'none' && style.visibility !== 'hidden'
    }
    const glyphs = Array.from(document.querySelectorAll('[data-slot="sidebar.panellist"]'))
    const buttons = glyphs
      .map((glyph) => glyph.closest('button'))
      .filter((button): button is HTMLButtonElement => button !== null)
    const toolbar = document.querySelector<HTMLElement>('[data-dshone-tree-action="plugins"]')
    const gear = document.querySelector<HTMLElement>('[data-dshone-tree-action="settings"]')
    const host = (globalThis as { __LAB_HOST__?: { pluginsOpened?: unknown[]; pluginsPageOpen?: boolean } }).__LAB_HOST__
    return {
      rowButtons: buttons.length,
      visibleRowButtons: buttons.filter(visible).length,
      rowLabel: buttons[0]?.getAttribute('aria-label') ?? '',
      toolbarFound: toolbar !== null,
      toolbarLabel: toolbar?.getAttribute('aria-label') ?? '',
      toolbarVisible: toolbar !== null && visible(toolbar),
      toolbarAdjacentToGear: toolbar !== null && gear !== null && gear.previousElementSibling === toolbar,
      opened: host?.pluginsOpened?.length ?? -1,
      pageOpen: host?.pluginsPageOpen === true,
    }
  })
}

/** 点工具栏那一枚（#252 起的入口：页面侧能力口 `openPlugins()` → 宿主）。 */
async function clickToolbarPlugins(page: Page): Promise<void> {
  await page.click('[data-dshone-tree-action="plugins"]')
}

/** 等某一格读数到位（异步链路：能力口 → 宿主回执），超时后返回最后一拍。 */
async function waitForEntry(
  page: Page,
  predicate: (facts: SidebarEntryFact) => boolean,
  timeoutMs = 5_000,
): Promise<SidebarEntryFact> {
  const deadline = Date.now() + timeoutMs
  let facts = await sidebarEntryFacts(page)
  while (!predicate(facts) && Date.now() < deadline) {
    await page.waitForTimeout(100)
    facts = await sidebarEntryFacts(page)
  }
  return facts
}

/** 经 fiber 探针的 ctx 反射取 layout 服务调一次 selectPanel，返回它抛没抛、抛的什么。 */
async function callSelectPanel(page: Page, panelId: string | null): Promise<{ threw: boolean; message: string }> {
  return page.evaluate((id: string | null) => {
    const record = (globalThis as { __LAB_FIBER__?: { ctx?: unknown } }).__LAB_FIBER__
    const ctx = record?.ctx as { reflect?: { get?: (name: string) => unknown } } | undefined
    if (ctx === undefined) return { threw: true, message: '这个页面没给套件留下 ctx（fiber 探针没接上）' }
    let layout: { selectPanel?: (value: string | null) => void } | undefined
    try {
      layout = ctx.reflect?.get?.('layout') as { selectPanel?: (value: string | null) => void } | undefined
    } catch (error) {
      return { threw: true, message: `反射取 layout 抛了：${error instanceof Error ? error.message : String(error)}` }
    }
    if (layout === undefined || typeof layout.selectPanel !== 'function') {
      return { threw: true, message: '反射取到的 layout 上没有 selectPanel' }
    }
    try {
      layout.selectPanel(id)
      return { threw: false, message: '' }
    } catch (error) {
      return { threw: true, message: error instanceof Error ? error.message : String(error) }
    }
  }, panelId)
}

export const PLUGINS_PAGE_SUITE: LabSuite = {
  id: 'F-74',
  phase: 'new-feature',
  name: '官方「插件」页在 VS Code 侧有落点、入口在侧栏工具栏那一枚（plugins 树 + #252 的入口搬家）',
  expect:
    'plugins 树页面（`/tree/plugins`）在真实网关只读下渲染出官方插件页本体：官方那两组的组名与计数在场（官方组 ≥ 1）、' +
    '四张官方配置卡都在（`plugins.item` 锚点 4 枚 + 四个卡名逐字在场）、零 `slot entry crashed` / 零装载未激活 / 零 pageerror / 零 `data-slot-error`；' +
    '侧栏（#252）：官方那条「插件」整行**不再渲染**（那一行没有可见的可点元素）、`sidebar.panellist` 座上上位的是我们那条遮蔽件（priority −1）、' +
    '工具栏那一枚插件图标在场且紧挨设置齿轮左侧（文案取我们词典 `toolbar.plugins` 的 zh/en 两份）、' +
    '点它 → 假宿主收到**恰好一次**开页调用、那一趟到达了宿主（独立编辑器页被标成开着）、页面上不再出现 `layout.selectPanel: main panel "plugins" is not registered`；' +
    '并且校验本身还在（直接调 `selectPanel(<不存在的面板>)` 照旧抛官方那句原话、`selectPanel("plugins")` 不抛）。',
  async run(ctx: SuiteContext, check): Promise<string[]> {
    const shots: string[] = []

    // -------------------------------------------------------------------
    // 第 1 段：plugins 树页面本身（官方那一页在 VS Code 形态里整页渲染）
    // -------------------------------------------------------------------
    const pluginsTree = route('plugins')
    const opened: OpenedPage = await openTreePage(ctx.browser, ctx.lab, pluginsTree)
    const page = opened.page
    try {
      const gaps = contractGaps(opened.capture)
      const slots = await slotFacts(page)
      const facts = await waitForCardFacts(page)
      const groups = facts.groups
      const body = await page.evaluate(() => document.body.innerText)
      check.fact(
        `plugins 树：ready=${String(opened.ready)} 槽位锚点=${String(slots.slots.length)} 崩溃标记=${String(slots.errors.length)} 崩溃日志=${String(gaps.crashes.length)} 未激活=${String(gaps.bootFails.length)} pageerror=${String(gaps.pageErrors.length)} 已知噪音=${String(gaps.noise.length)}`,
      )
      check.fact(
        `plugins 树：分组 ${groups.map((group) => `${group.id}=${group.title}(${String(group.count)})`).join(' ') || '（一个都没有）'}`,
      )
      check.ok('plugins 树：官方插件页本体在场（[data-plugin-panel]）', opened.ready, `ready=${String(opened.ready)}`)
      check.ok(
        'plugins 树：四张官方配置卡的卡名逐字在场（终端 / Agent 循环 / Subagent / 网页搜索）',
        OFFICIAL_CARD_LABELS.every((labels) => labels.some((label) => body.includes(label))),
        OFFICIAL_CARD_LABELS.map((labels) => labels.find((label) => body.includes(label)) ?? `缺(${labels.join('|')})`).join(' / '),
      )
      // 官方那一组（官方可选包）必须真出来：它是这一页的主体，「官方 N」那个计数就在组头上。
      const official = groups.find((group) => OFFICIAL_GROUP_LABELS.official.some((label) => label === group.title))
      check.ok(
        'plugins 树：官方那一组在场且计数 ≥ 1（组名取官方词典，zh/en 任一份）',
        official !== undefined && official.count >= 1,
        `groups=${JSON.stringify(groups)}`,
      )
      // 「已安装」那一组在隔离实例上可以不在（那是 profile 里真装了什么），所以只记事实。
      check.fact(
        `plugins 树：已安装那一组 ${groups.some((group) => OFFICIAL_GROUP_LABELS.bundles.some((label) => label === group.title)) ? '在场' : '不在场'}（隔离实例的 profile 决定，不作判据）`,
      )
      // 四张配置卡坐落在 `plugins.item` 上：卡（按官方条目 id）+ 座（锚点数）两处对账。
      const seatCounts = facts.seats
      const cardIds = facts.cards.map((card) => card.id)
      check.fact(`plugins 树：plugins.item 锚点 ${String(seatCounts.length)} 枚，各自子元素数 ${JSON.stringify(seatCounts)}`)
      check.fact(`plugins 树：四张卡 ${JSON.stringify(facts.cards.map((card) => `${card.id}:${card.text.slice(0, 24)}`))}`)
      check.eq('plugins 树：四张官方配置卡的座都在（plugins.item 锚点 4 枚）', seatCounts.length, 4)
      check.eq(
        'plugins 树：四张卡按官方条目 id 逐张落座（bash / agent-loop / subagent / web-search）',
        cardIds,
        [...OFFICIAL_CARD_IDS],
      )
      // 卡的内容是官方摘要那一行（`renderSlot("plugins.item", {view:"summary"})` 的产物）：
      // 它是一段文本节点，**不是**元素子节点，所以判据读卡上的正文而不是 `children.length`。
      check.ok(
        'plugins 树：每张卡的摘要一行都渲染出来了（不是空壳）',
        facts.cards.length === OFFICIAL_CARD_IDS.length && facts.cards.every((card) => card.text.length > 0),
        JSON.stringify(facts.cards),
      )
      check.eq('plugins 树：零槽位崩溃标记（data-slot-error）', slots.errors, [])
      check.eq('plugins 树：零槽位崩溃日志（slot entry crashed）', gaps.crashes, [])
      check.eq('plugins 树：零装载未激活（缺服务/缺钩子）', gaps.bootFails, [])
      check.eq('plugins 树：零 pageerror', gaps.pageErrors, [])
      shots.push(await shot(ctx, page, 'f-74-1-plugins-tree'))
    } finally {
      await opened.context.close()
    }

    // -------------------------------------------------------------------
    // 第 2 段：侧栏——官方那一行不再渲染、入口是工具栏那一枚（#252 改的就是这一段）
    // -------------------------------------------------------------------
    const sidebar = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { fiberProbe: true })
    const sidebarPage = sidebar.page
    try {
      const before = await sidebarEntryFacts(sidebarPage)
      check.fact(
        `侧栏：官方那一行 —— DOM 里 ${String(before.rowButtons)} 个可点元素、其中可见 ${String(before.visibleRowButtons)} 个（aria-label=${JSON.stringify(before.rowLabel)}）；` +
          `工具栏那一枚 —— 在场=${String(before.toolbarFound)} 可见=${String(before.toolbarVisible)} aria-label=${JSON.stringify(before.toolbarLabel)} 紧挨齿轮=${String(before.toolbarAdjacentToGear)}；` +
          `开页调用=${String(before.opened)} 那一页在宿主侧开着=${String(before.pageOpen)}`,
      )
      // ① 官方那条整行不再渲染（#252 的第一半）。两道里任何一道失效那一行都会重新可见：
      //    层 1 遮蔽（同 id + priority −1 顶掉官方那条）、层 4 行盒子摘除（见 sidebarLayoutPlugin）。
      check.eq('侧栏：官方那条「插件」整行不再渲染（那一行没有可见的可点元素）', before.visibleRowButtons, 0)
      // ② 遮蔽确实发生在**注册表**里（不是碰巧没渲染）：`sidebar.panellist` 这个座上，
      //    上位的应当是 priority −1 那一条（我们那条空件），官方那条（priority 0）让出渲染位。
      const seatSnapshot = await readSeatSnapshot(sidebarPage)
      const panellist = seatSnapshot.seats.find((seat) => seat.name === 'sidebar.panellist')
      const occupants = panellist?.occupants ?? []
      const winner = occupants.find((occupant) => occupant.active)
      check.fact(
        `侧栏：\`sidebar.panellist\` 座上的占位者 —— ${occupants.map((occupant) => `${occupant.id || '(无 id)'}@${String(occupant.priority)}${occupant.active ? '(上位)' : ''}`).join('、') || '（一个都没有）'}`,
      )
      check.eq('侧栏：座上上位的是我们那条遮蔽件（id `plugins`、priority −1）', winner?.priority, -1)
      check.eq('侧栏：它的 id 就是官方那一行的 id（`plugins`）', winner?.id, 'plugins')
      // ③ 新的入口在工具栏，紧挨设置齿轮左侧，文案是我们词典里那条（zh/en 任一份）。
      check.ok('侧栏：工具栏那一枚插件图标在场且可见', before.toolbarFound && before.toolbarVisible, JSON.stringify(before))
      check.ok(
        '侧栏：那一枚的 aria-label 是我们词典里那条（zh/en 任一份）',
        TOOLBAR_PLUGINS_LABELS.some((label) => label === before.toolbarLabel),
        `label=${JSON.stringify(before.toolbarLabel)} 期望其一=${TOOLBAR_PLUGINS_LABELS.join(' / ')}`,
      )
      check.ok('侧栏：那一枚紧挨设置齿轮左侧（同一排动作组里正好是它前面那一个元素）', before.toolbarAdjacentToGear, JSON.stringify(before))
      check.eq('侧栏：点击前宿主没被要过开页', before.opened, 0)
      shots.push(await shot(ctx, sidebarPage, 'f-74-2-sidebar-before'))

      // 那一枚不在场时不硬点（在场那一条已经判红）：让失败信息停在「它不在场」，而不是
      // 一条 `page.click` 30 秒超时把整套件截断（#252 的 NC-2 实测过那种形态）。
      if (!before.toolbarFound) {
        check.fact('侧栏：工具栏那一枚不在场，跳过下面那几条点击判据（「在场且可见」那一条已经判红）')
      } else {
        await clickToolbarPlugins(sidebarPage)

        // ④ 宿主真的被要了一次，且那一趟到达了宿主（那一页在宿主侧被标成开着）。
        //    真宿主那一半（建/聚焦独立编辑器页 `dshOne.assembledPlugins`）由宿主侧判据
        //    `test/hostCapabilityDeps.test.ts` 的 N-03 守着（走真 deps 拼装，不经过假宿主）。
        const clicked = await waitForEntry(sidebarPage, (facts) => facts.opened === 1 && facts.pageOpen)
        check.eq('侧栏：点工具栏那一枚之后假宿主收到恰好一次开页调用', clicked.opened, 1)
        check.ok('侧栏：那一趟到达了宿主（独立编辑器页在宿主侧被标成开着）', clicked.pageOpen, JSON.stringify(clicked))
        shots.push(await shot(ctx, sidebarPage, 'f-74-3-sidebar-after-click'))
      }

      // ⑤ 整页干净（改前那一行点下去会抛 `is not registered`，这条一直在看着它）。
      const gaps = contractGaps(sidebar.capture)
      const notRegistered = gaps.pageErrors.filter((line) => NOT_REGISTERED_RE.test(line))
      check.eq('侧栏：零「未注册」pageerror（#247 改前这里恒有一条）', notRegistered, [])
      check.eq('侧栏：整页零 pageerror', gaps.pageErrors, [])
      check.eq('侧栏：零槽位崩溃日志', gaps.crashes, [])
      check.eq('侧栏：零装载未激活', gaps.bootFails, [])

      // ⑥ 校验本身没被删（就地负向对照）：不在本树 keyed `main` 上的面板 id 照旧抛官方那句。
      //    「受理 `plugins`」那条同时是**行若回来也仍然管用**的保证（见 sidebarLayoutPlugin
      //    的 openPluginsPage 说明）。
      const unknown = await callSelectPanel(sidebarPage, 'dshOne.no.such.panel')
      check.ok(
        '侧栏：直接调 selectPanel(<不存在的面板>) 照旧抛官方那句「未注册」（校验没被删）',
        unknown.threw && NOT_REGISTERED_RE.test(unknown.message),
        `threw=${String(unknown.threw)} message=${JSON.stringify(unknown.message)}`,
      )
      const accepted = await callSelectPanel(sidebarPage, 'plugins')
      check.ok(
        '侧栏：直接调 selectPanel("plugins") 不再抛（受理这条路是活的）',
        !accepted.threw,
        `threw=${String(accepted.threw)} message=${JSON.stringify(accepted.message)}`,
      )
    } finally {
      await sidebar.context.close()
    }

    return shots
  },
}
