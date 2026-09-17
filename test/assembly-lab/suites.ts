/**
 * 装配实验室的验证套件（#78）。
 *
 * 每套 = 一个 ledger 条目：`run()` 里开页、观测、`check.ok/eq` 逐条断言，返回
 * 截图路径（进报告）。套件按「先新增、后回归」排，与 dev-finish 报告口径一致。
 *
 * 数据面说明：所有页面都跑在**本机真实 dsh 网关只读**之上（会话列表、设置文档
 * 都是真数据），宿主侧由假宿主（fakeHost.ts）按同一协议应答；交互套件里的
 * 「消息正文」是页内注入的固定夹具——真模型输出不可复现，而插件的行为只依赖
 * DOM 形状（`code` 标签 / 文本里的 hash），夹具与真实语料在这一点上等价。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import type { Browser, Locator } from 'playwright'
import {
  Check,
  bodyText,
  contractGaps,
  knownNoise,
  openTreePage,
  openTreePageAlongside,
  slotFacts,
  slotChildren,
  withoutKnownNoise,
  setLabWorkspaceFolders,
  type OpenedPage,
} from './harness.ts'
import { consoleLogger, LAB_TREES, type LabServer, type LabTreeRoute } from './labServer.ts'
import { FIBER_SUITE, WIRE_LIVENESS_SUITE } from './driftSuites.ts'
import { RECYCLE_ENTRY_TOGGLE_SUITE } from './recycleEntrySuites.ts'
import { SCALE_SUITE, TITLE_TIER_SUITE } from './scaleSuites.ts'
import { COLLAPSE_ALL_ICON_SUITE } from './collapseAllIconSuites.ts'
import { TAG_GROUP_RAIL_SUITE } from './tagRailSuites.ts'
import { RECYCLE_DRAWER_COLLAPSE_SUITE } from './recycleDrawerSuites.ts'
import { TOPBAR_RHYTHM_SUITE } from './topbarRhythmSuites.ts'
import { RENAME_OPEN_SYNC_SUITE } from './renameOpenSyncSuites.ts'
import { SELECTION_BAR_SUITE } from './selectionBarSuites.ts'
import { SELECT_MODE_INDENT_SUITE } from './selectModeIndentSuites.ts'
import { SUBMENU_INDENT_SUITE } from './submenuIndentSuites.ts'
import { MODAL_COMPACT_SUITE } from './modalCompactSuites.ts'
import { VIEW_OPTIONS_RETIRED_SUITE } from './viewOptionsSuites.ts'
import { TOPBAR_INLINE_SUITE } from './topbarInlineSuites.ts'
import { SEARCH_COLLAPSE_SUITE } from './searchCollapseSuites.ts'
import { ROW_TIER_SUITE } from './rowTierSuites.ts'
import { RECYCLE_ENTRY_ALIGN_SUITE } from './recycleEntryAlignSuites.ts'
import { ROW_ACTIVITY_SUITE } from './rowActivitySuites.ts'
import { COLLAPSE_ALL_ICON_WEIGHT_SUITE } from './collapseAllIconWeightSuites.ts'
import { GROUP_MEMBERS_SUITE } from './groupMembersSuites.ts'
import { TOOLBAR_SINGLE_ROW_SUITE } from './toolbarSingleRowSuites.ts'
import { PENDING_DOT_SUITE } from './pendingDotSuites.ts'
import { TOPBAR_RIGHT_INSET_SUITE } from './topbarRightInsetSuites.ts'
import { STATUS_DOT_SUITE } from './statusDotSuites.ts'
import { RECYCLE_DRAWER_ROW_SUITE } from './recycleDrawerRowSuites.ts'
import { SESSION_OWNED_SUITE } from './sessionOwnedSuites.ts'
import { EXTERNAL_LINK_SUITE } from './externalLinkSuites.ts'
import { SEARCH_HIT_HIGHLIGHT_SUITE } from './searchHitHighlightSuites.ts'
import { DRAG_PARITY_SUITE } from './dragParitySuites.ts'
import { EXPAND_DEFAULTS_SUITE } from './expandDefaultsSuites.ts'
import { UNREAD_COUNT_SUITE } from './unreadCountSuites.ts'
import { LIVENESS_SUITE } from './livenessSuites.ts'
import { RECYCLE_DRAWER_COMPLETE_SUITE } from './recycleDrawerCompleteSuites.ts'
import { FRESH_PROFILE_BOOT_SUITE } from './freshProfileSuites.ts'
import { SIDEBAR_NO_HSCROLL_SUITE } from './sidebarHScrollSuites.ts'
import { COMBO_CACHE_KEY_SUITE } from './comboCacheKeySuites.ts'
import { listSessions } from '../../src/server/dshRpc.ts'
import { subscribeWorkspaceStream } from '../../src/server/modernStreams.ts'
import type { Logger } from '../../src/log.ts'

export interface SuiteContext {
  browser: Browser
  lab: LabServer
  /** 截图输出目录（调用方保证存在）。 */
  shots: string
}

export interface LabSuite {
  id: string
  phase: 'new-feature' | 'regression'
  name: string
  expect: string
  run: (ctx: SuiteContext, check: Check) => Promise<string[]>
}

const route = (name: string): LabTreeRoute => {
  const found = LAB_TREES.find((candidate) => candidate.route === name)
  if (found === undefined) throw new Error(`lab: unknown tree route ${name}`)
  return found
}

async function shot(ctx: SuiteContext, page: OpenedPage['page'], name: string): Promise<string> {
  const file = path.join(ctx.shots, `${name}.png`)
  await fsp.mkdir(ctx.shots, { recursive: true })
  await page.screenshot({ path: file })
  return file
}

/** 一棵树在页面上「有内容」的判据（各树最关键的那块用户可见区域）。 */
async function contentCount(page: OpenedPage['page'], selector: string): Promise<number> {
  return page.evaluate((sel: string) => document.querySelectorAll(sel).length, selector)
}

// ---------------------------------------------------------------------------
// F-01 CONTRACT：底座契约完备性（AGENTS.md 铁律要求的常驻断言）
// ---------------------------------------------------------------------------

const CONTRACT_TREES: ReadonlyArray<{
  route: string
  content: { label: string; selector: string }
  /**
   * 该树必须出现的座位锚点（`[data-slot="<名>"]` 只有「被声明 + 真渲染」才会在
   * DOM 里：声明来自该树 root 条目的 children 表，渲染来自该树的 frame）。
   * 官方改座位名/改归属（`details` → `rightbar` 那一类漂移）时这里先红。
   */
  seats: readonly string[]
}> = [
  { route: 'sidebar', content: { label: '自有工作区树的会话行', selector: '.dshOneTree_sessionRow' }, seats: ['sidebar', 'sidebar.workspaces', 'sidebar.settings'] },
  { route: 'sidebar-official', content: { label: '官方浏览区的会话行', selector: '[class*="_sessionRow"]' }, seats: ['sidebar', 'sidebar.workspaces'] },
  { route: 'chat', content: { label: '对话区 composer 座位', selector: '[data-slot="conversation.composer.bar"] > *' }, seats: ['main', 'conversation.composer.bar', 'rightbar'] },
  { route: 'settings', content: { label: '设置内容区', selector: '[data-slot="settings.section"] > *' }, seats: ['main', 'settings.section'] },
]

export const CONTRACT_SUITE: LabSuite = {
  id: 'F-01',
  phase: 'new-feature',
  name: '底座契约完备性：四棵树在真实网关上零崩溃、零缺失契约（CONTRACT 套件）',
  expect:
    '实验室四棵树（自有 sidebar 树、官方浏览区对照档、chat 树、settings 树）各自在真实网关只读下打开：**零 `slot entry crashed`**（官方渲染层崩溃 + 页面无 `data-slot-error` 元素）、**零 pageerror**、**零装载未激活**（官方 `web boot: … did not activate` / `waiting for service`，即缺服务/缺钩子那类底座缺口）；该树自己的关键座位**有内容**（不是空壳）、**预期座位锚点都在**（官方改座位名/改归属时这里先红）、该树的 frame 插件 bundle 真的装进了页面（combo 请求里有它的 id、页面上有它的 CSS 标记）；chat 树额外核官方右栏座位（声明 + 官方 ui-sidebar-right 的座位已注册 + 面板几何在官方钳位区间内）。缺 hook 与缺服务在页面上的表现就是 `slot entry crashed` / `did not activate`，所以这两条断言即 hook/服务的完备性断言。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    for (const entry of CONTRACT_TREES) {
      const tree = route(entry.route)
      const opened = await openTreePage(ctx.browser, ctx.lab, tree)
      const { page, capture } = opened
      try {
        const gaps = contractGaps(capture)
        const slots = await slotFacts(page)
        const content = await contentCount(page, entry.content.selector)
        check.fact(
          `${entry.route}：ready=${String(opened.ready)} 槽位锚点=${String(slots.slots.length)} 崩溃标记=${String(slots.errors.length)} 崩溃日志=${String(gaps.crashes.length)} 未激活=${String(gaps.bootFails.length)} 真实 pageerror=${String(gaps.pageErrors.length)} 已知噪音=${String(gaps.noise.length)} ${entry.content.label}=${String(content)}`,
        )
        check.ok(`${entry.route}：首屏就绪（${tree.readySelector}）`, opened.ready)
        check.ok(`${entry.route}：${entry.content.label}有内容（${entry.content.selector}）`, content > 0)
        // 座位锚点：声明 + 渲染都在才会有锚点。官方改座位名/改归属时，
        // 命中的官方贡献会 park 或换名，这里立刻红（不用等用户撞见空面板）。
        const seatCounts = await seatFacts(page, entry.seats)
        const missingSeats = entry.seats.filter((name) => (seatCounts[name] ?? -1) < 0)
        check.fact(`${entry.route}：座位锚点 ${entry.seats.map((name) => `${name}=${String(seatCounts[name] ?? -1)}`).join(' ')}`)
        check.ok(`${entry.route}：预期座位锚点都在（${entry.seats.join(' / ')}）`, missingSeats.length === 0, missingSeats.join(','))
        check.eq(`${entry.route}：零槽位崩溃标记（data-slot-error）`, slots.errors, [])
        check.eq(`${entry.route}：零槽位崩溃日志（slot entry crashed）`, gaps.crashes, [])
        check.eq(`${entry.route}：零装载未激活（缺服务/缺钩子）`, gaps.bootFails, [])
        check.eq(`${entry.route}：零 pageerror（已知噪音另计）`, gaps.pageErrors, [])
        if (gaps.noise.length > 0) check.fact(`${entry.route}：放行已知噪音 ${String(gaps.noise.length)} 条（${knownNoise(gaps.noise[0] ?? '') ?? ''}）`)
        // 该树该装的插件（自有 frame + 该树追加件）必须都进了 combo 请求：
        // 这条挡住「插件没进清单但页面看着正常」的静默退化（例如 block list
        // 把自有 id 也剥掉的误配）。
        const combos = await combosRequested(page)
        const comboUrl = combos.find((url) => url.includes(`${tree.tree.shellPluginId}/client.js`))
        const missingPlugins = [tree.tree.shellPluginId, ...tree.tree.extraPluginIds].filter(
          (id) => comboUrl === undefined || !comboUrl.includes(`${id}/client.js`),
        )
        check.ok(`${entry.route}：该树全部自有插件进了 combo 请求`, missingPlugins.length === 0, missingPlugins.join(','))
        // frame 插件真的执行了（它注入的样式标记在页面上；官方插件没有这个标记）。
        const cssTags = await page.evaluate(() =>
          Array.from(document.querySelectorAll('style[data-plugin]')).map((el) => el.getAttribute('data-plugin') ?? ''),
        )
        check.ok(
          `${entry.route}：frame 插件 ${tree.tree.shellPluginId} 已在页面上执行（CSS 标记）`,
          cssTags.includes(tree.tree.shellPluginId),
          cssTags.filter((tag) => tag.startsWith('@dsh-one/')).join(','),
        )
        // chat 树的官方右栏座位（#79 决策 B）：座位声明在我们这里、贡献来自官方
        // ui-sidebar-right，所以「官方真注册进来了 + 面板几何在官方钳位区间内」
        // 就是这条链路活着的证据。
        if (entry.route === 'chat') {
          const rightbar = await rightbarFacts(page)
          check.fact(
            `chat：官方右栏 面板元素=${String(rightbar.panel)} 面板宽=${String(rightbar.panelWidth)} 外框宽=${String(rightbar.frameWidth)} 会话座位=${String(rightbar.sessionSeat)}`,
          )
          check.ok('chat：官方 ui-sidebar-right 的座位已注册进 rightbar（有子项）', (seatCounts.rightbar ?? -1) > 0, `rightbar=${String(seatCounts.rightbar ?? -1)}`)
          check.ok('chat：官方右栏面板元素在（[data-sidebar-right-panel]）', rightbar.panel)
          check.ok(
            'chat：官方右栏面板宽 > 0 且 ≤ 外框 70%（官方钳位区间，见 frameShared.computeColumns）',
            rightbar.panelWidth > 0 && rightbar.panelWidth <= Math.round(rightbar.frameWidth * 0.7) + 1,
            `panel=${String(rightbar.panelWidth)} frame=${String(rightbar.frameWidth)}`,
          )
        }
        screenshots.push(await shot(ctx, page, `contract-${entry.route}`))
      } finally {
        await opened.context.close()
      }
    }
    screenshots.push(...(await rightbarOpenChecks(ctx, check)))
    return screenshots
  },
}

/**
 * chat 树官方右栏的**用户路径**：官方把展开钮放在会话头右侧角
 * （`conversation.session.header.corner` 的 ExpandButton，只有非空白会话才有会话头），
 * 点它 → 官方座位经 `ctx.layout.openRightbar(track, fullscreen)` 上报 → 我们的外框
 * 让出轨道。这条链路跨「官方座位 → 我们的 layout 服务 → 我们的外框几何」三层，
 * 静态断言看不出来，所以这里真点一次。
 *
 * 网关上一个非空白会话都没有时（全新网关）只记观测、不断言——这不是底座缺陷。
 */
async function rightbarOpenChecks(ctx: SuiteContext, check: Check): Promise<string[]> {
  const sessions = await listSessions(ctx.lab.gateway).catch(() => [])
  const candidate = sessions.find((session) => session.blank === false && session.running !== true)
  if (candidate === undefined) {
    check.fact('chat：网关上没有非空白会话可用来试官方右栏展开路径（跳过该段断言）')
    return []
  }
  const opened = await openTreePage(ctx.browser, ctx.lab, route('chat'), { sessionId: candidate.sessionId, width: 1280, height: 860 })
  try {
    const before = await rightbarFacts(opened.page)
    const cornerButtons = await opened.page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-slot="conversation.session.header.corner"] button')).map((button) => button.getAttribute('aria-label') ?? ''),
    )
    check.fact(`chat（会话 ${candidate.sessionId.slice(0, 16)}）：会话头右侧角按钮=${JSON.stringify(cornerButtons)} 展开前轨道宽=${String(before.trackWidth)}`)
    if (cornerButtons.length === 0) {
      check.ok('chat：非空白会话的会话头出现官方右栏展开钮（ExpandButton 座位）', false, '会话头右侧角没有按钮')
      return [await shot(ctx, opened.page, 'contract-chat-rightbar')]
    }
    await opened.page.click('[data-slot="conversation.session.header.corner"] button')
    await opened.page.waitForTimeout(2000)
    const after = await rightbarFacts(opened.page)
    const tabs = await opened.page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="tab"]')).map((tab) => (tab.textContent ?? '').trim().slice(0, 12)),
    )
    check.fact(`chat：点开后 面板开=${String(after.panelOpen)} 轨道宽=${String(after.trackWidth)} 面板宽=${String(after.panelWidth)} 面板左缘=${String(after.panelLeft)} 页签=${JSON.stringify(tabs)}`)
    check.ok('chat：点官方展开钮后面板打开', after.panelOpen)
    check.ok('chat：面板贴右缘（左缘 + 面板宽 ≈ 外框宽）', Math.abs(after.panelLeft + after.panelWidth - after.frameWidth) <= 2, `${String(after.panelLeft)}+${String(after.panelWidth)} vs ${String(after.frameWidth)}`)
    check.ok('chat：外框为展开的面板让出同宽轨道', after.trackWidth > 0 && Math.abs(after.trackWidth - after.panelWidth) <= 1, `track=${String(after.trackWidth)} panel=${String(after.panelWidth)}`)
    check.ok('chat：展开前没有轨道（默认收起）', before.trackWidth === 0, `track=${String(before.trackWidth)}`)
    return [await shot(ctx, opened.page, 'contract-chat-rightbar')]
  } finally {
    await opened.context.close()
  }
}

/** 本次页面里出现过的 /plugins-local/ 请求（combo 装载证据）。 */
async function combosRequested(page: OpenedPage['page']): Promise<string[]> {
  return page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => name.includes('/plugins-local/')),
  )
}

/**
 * 座位锚点的子项数：`-1` = 锚点不在（该座位没被声明，或声明了但该树的 frame 没渲染它）。
 * `[data-slot]` 锚点由框架渲染器在渲染座位时生成，所以它同时证明「声明」与「渲染」两件事。
 */
async function seatFacts(page: OpenedPage['page'], names: readonly string[]): Promise<Record<string, number>> {
  return page.evaluate((keys: string[]) => {
    const out: Record<string, number> = {}
    for (const key of keys) {
      const element = document.querySelector(`[data-slot="${key}"]`)
      out[key] = element === null ? -1 : element.children.length
    }
    return out
  }, [...names])
}

/** chat 树官方右栏的观测：面板元素、面板宽（官方座位自己写的 inline width）、外框宽、轨道宽、会话座位数。 */
async function rightbarFacts(
  page: OpenedPage['page'],
): Promise<{ panel: boolean; panelOpen: boolean; panelWidth: number; panelLeft: number; frameWidth: number; trackWidth: number; sessionSeat: number }> {
  return page.evaluate(() => {
    const panel = document.querySelector('[data-sidebar-right-panel]') as HTMLElement | null
    const frame = document.querySelector('.dshOneShell_frame') as HTMLElement | null
    const column = document.querySelector('.dshOneShell_rightbarCol') as HTMLElement | null
    const px = (value: string | null | undefined): number => {
      const parsed = Number.parseFloat(value ?? '')
      return Number.isFinite(parsed) ? Math.round(parsed) : -1
    }
    const rect = panel?.getBoundingClientRect()
    return {
      panel: panel !== null,
      panelOpen: panel?.hasAttribute('data-sidebar-right-open') ?? false,
      panelWidth: panel === null ? -1 : px(panel.style.width),
      panelLeft: rect === undefined ? -1 : Math.round(rect.left),
      frameWidth: frame === null ? -1 : Math.round(frame.getBoundingClientRect().width),
      trackWidth: column === null ? -1 : Math.round(column.getBoundingClientRect().width),
      sessionSeat: document.querySelectorAll('[data-slot="rightbar.session"]').length,
    }
  })
}

// ---------------------------------------------------------------------------
// F-02 SMOKE：三棵树冒烟渲染
// ---------------------------------------------------------------------------

export const SMOKE_SUITE: LabSuite = {
  id: 'F-02',
  phase: 'new-feature',
  name: '三棵树冒烟渲染：侧栏会话树 / 对话区 / 设置页都出真内容（SMOKE 套件）',
  expect:
    '侧栏树：真实网关的会话行（自有树插件渲染）与分组行都在，行上有标题文本，侧栏壳的新建会话按钮在。对话区：composer 座位里有可编辑输入框。设置页：设置内容区渲染出多行设置项。三棵树控制台零 error。',
  run: async (ctx, check) => {
    const screenshots: string[] = []

    const sidebar = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { width: 380, height: 900 })
    try {
      const rows = await contentCount(sidebar.page, '.dshOneTree_sessionRow')
      const groups = await contentCount(sidebar.page, '.dshOneTree_projectRow')
      const text = await bodyText(sidebar.page)
      check.fact(`sidebar：分组行=${String(groups)} 会话行=${String(rows)} 文本长度=${String(text.length)}`)
      check.ok('sidebar：会话行 ≥ 1', rows >= 1, `rows=${String(rows)}`)
      check.ok('sidebar：分组行 ≥ 1', groups >= 1, `groups=${String(groups)}`)
      check.ok('sidebar：行上有标题文本', text.length > 20)
      check.eq('sidebar：零 console error', sidebar.capture.consoleErrors, [])
      screenshots.push(await shot(ctx, sidebar.page, 'smoke-sidebar'))
    } finally {
      await sidebar.context.close()
    }

    const chat = await openTreePage(ctx.browser, ctx.lab, route('chat'), { width: 1200 })
    try {
      const editable = await contentCount(chat.page, '[data-slot="conversation.composer.bar"] [contenteditable="true"]')
      const shellRoot = await contentCount(chat.page, '.dshOneShell_main')
      const mainPanel = await slotChildren(chat.page, 'main')
      const conversation = await slotChildren(chat.page, 'main.conversation', 'main')
      const composerSlot = await slotChildren(chat.page, 'conversation.composer.bar')
      check.fact(
        `chat：composer 可编辑元素=${String(editable)} 自有对话容器=${String(shellRoot)} main 槽位子项=${String(mainPanel)} main 下的会话面板=${String(conversation)} composer.bar 座位子项=${String(composerSlot)}`,
      )
      check.ok('chat：composer 里有可编辑输入框', editable >= 1, `editable=${String(editable)}`)
      check.ok('chat：自有对话容器在（.dshOneShell_main）', shellRoot >= 1)
      check.ok('chat：会话面板挂在 keyed main 槽位上（有子项）', mainPanel > 0, `main=${String(mainPanel)}`)
      check.ok('chat：会话面板在 main 槽位之内（嵌套从属）', conversation > 0, `main 下的会话面板=${String(conversation)}`)
      check.ok('chat：composer.bar 座位有内容', composerSlot > 0, `composer.bar=${String(composerSlot)}`)
      check.eq('chat：零 console error', chat.capture.consoleErrors, [])
      screenshots.push(await shot(ctx, chat.page, 'smoke-chat'))
    } finally {
      await chat.context.close()
    }

    const settings = await openTreePage(ctx.browser, ctx.lab, route('settings'), { width: 1200 })
    try {
      const rows = await contentCount(settings.page, '[data-slot="settings.general.item"] > *')
      const nav = await contentCount(settings.page, '[data-slot="settings.section"] *')
      const items = await contentCount(settings.page, '[data-slot="settings.general.item"]')
      check.fact(`settings：通用设置行=${String(items)} 行内容元素=${String(rows)} 内容区后代=${String(nav)}`)
      check.ok('settings：内容区渲染出设置项', rows >= 1, `rows=${String(rows)}`)
      check.eq('settings：零 console error', settings.capture.consoleErrors, [])
      check.eq('settings：零 pageerror（已知噪音另计）', withoutKnownNoise(settings.capture.pageErrors).real, [])
      screenshots.push(await shot(ctx, settings.page, 'smoke-settings'))
    } finally {
      await settings.context.close()
    }

    return screenshots
  },
}

// ---------------------------------------------------------------------------
// F-03 INTERACT：关键交互（右键菜单 / 清空 / git 卡片）
// ---------------------------------------------------------------------------

/**
 * 交互夹具：往对话区塞一段带行内码与 commit hash 的正文（真模型输出不可复现）。
 *
 * 塞进**官方对话区容器**（`[data-conversation-scroll]`）而不是自有 frame 的
 * `.dshOneShell_main`：三个 dsh-* 插件的挂载点就在那个容器上（#83），夹具必须落在
 * 插件真正工作的范围里——否则这里测的是「夹具放错地方」而不是插件行为。
 */
const FIXTURE_SHA = 'deadbee'

async function injectMessageFixture(page: OpenedPage['page']): Promise<void> {
  await page.evaluate((sha: string) => {
    const host = document.querySelector('[data-conversation-scroll]')
    if (host === null) return
    const box = document.createElement('div')
    box.setAttribute('data-lab-fixture', 'message')
    const paragraph = document.createElement('p')
    paragraph.append(`see commit ${sha} and run `)
    const code = document.createElement('code')
    code.textContent = 'lab inline code'
    paragraph.append(code, ' afterwards')
    box.append(paragraph)
    host.append(box)
  }, FIXTURE_SHA)
  // 扫描是 MutationObserver + 120ms 去抖（gitCardPlugin）。
  await page.waitForTimeout(400)
}

const editorSelector = '[data-slot="conversation.composer.bar"] [contenteditable="true"]'

export const INTERACT_SUITE: LabSuite = {
  id: 'F-03',
  phase: 'new-feature',
  name: '关键交互：行内码右键菜单、清空（Esc ×2）+ 反悔（Ctrl+Z）、commit 卡片（INTERACT 套件）',
  expect:
    'chat 树：给消息正文里的行内码点右键 → 弹出官方 Menu（role=menu）承载的单图标项，行内码被高亮标记，Esc 后菜单与高亮都撤掉。正文里的 7 位 hash → 悬停出提交卡片，卡片内容来自宿主能力口（假宿主回执），点卡片上的 GitHub 按钮 → 页面发出一次 vscode.openExternal。composer 里输入文字后按 Esc → 出「再按一次」提示；再按 Esc → 草稿清空且出撤销入口；Ctrl+Z → 草稿复原。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const opened = await openTreePage(ctx.browser, ctx.lab, route('chat'), { width: 1200 })
    const { page } = opened
    try {
      await injectMessageFixture(page)

      // --- 行内码右键菜单 ---
      const codeSelector = '[data-lab-fixture="message"] code'
      await page.click(codeSelector, { button: 'right' })
      await page.waitForTimeout(300)
      const menu = await page.evaluate(() => {
        const list = document.querySelector('[data-dshone-menu]')
        return {
          marked: document.querySelectorAll('code[data-dshone-menu-target]').length,
          menuPresent: list !== null,
          role: list?.getAttribute('role') ?? '',
          items: list === null ? 0 : list.querySelectorAll('button[role="menuitem"]').length,
          iconItems: list === null ? 0 : list.querySelectorAll('[data-dshone-icon-item]').length,
        }
      })
      check.fact(`右键菜单：${JSON.stringify(menu)}`)
      check.ok('行内码右键：菜单出现且标记在官方 Menu 上', menu.menuPresent && menu.role === 'menu', JSON.stringify(menu))
      check.eq('行内码右键：目标行内码被高亮标记', menu.marked, 1)
      check.ok('行内码右键：单图标项菜单（1 项、图标项 1）', menu.items === 1 && menu.iconItems === 1, JSON.stringify(menu))
      screenshots.push(await shot(ctx, page, 'interact-menu'))
      await page.keyboard.press('Escape')
      await page.waitForTimeout(250)
      const afterClose = await page.evaluate(() => ({
        marked: document.querySelectorAll('code[data-dshone-menu-target]').length,
        menu: document.querySelectorAll('[data-dshone-menu]').length,
      }))
      check.ok(
        '行内码右键：Esc 后菜单与高亮一并撤掉',
        afterClose.marked === 0 && afterClose.menu === 0,
        JSON.stringify(afterClose),
      )

      // --- commit 卡片（走宿主能力口） ---
      await page.hover(`[data-dshone-commit="${FIXTURE_SHA}"]`)
      await page.waitForTimeout(400)
      const card = await page.evaluate(() => {
        const element = document.querySelector('[data-dshone-git-card]')
        return {
          present: element !== null,
          text: element === null ? '' : (element.textContent ?? '').slice(0, 200),
          buttons: document.querySelectorAll('[data-dshone-git-card] .dshOneGitCard_cmd').length,
        }
      })
      check.fact(`git 卡片：${JSON.stringify(card)}`)
      check.ok('commit hash 被包成可点标记', (await contentCount(page, `[data-dshone-commit="${FIXTURE_SHA}"]`)) === 1)
      check.ok('悬停出提交卡片且内容来自宿主回执', card.present && card.text.includes('Lab Bot'), card.text)
      check.ok('卡片带动作按钮（复制 hash / 开 GitHub）', card.buttons === 2, `buttons=${String(card.buttons)}`)
      screenshots.push(await shot(ctx, page, 'interact-gitcard'))
      const openedUrls = await page.evaluate(() => {
        const host = (globalThis as { __LAB_HOST__?: { openedUrls?: string[] } }).__LAB_HOST__
        return host?.openedUrls ?? []
      })
      if (card.buttons === 2) {
        await page.click('[data-dshone-git-card] .dshOneGitCard_cmd:last-of-type')
        await page.waitForTimeout(300)
      }
      const openedAfter = await page.evaluate(() => {
        const host = (globalThis as { __LAB_HOST__?: { openedUrls?: string[] } }).__LAB_HOST__
        return host?.openedUrls ?? []
      })
      check.fact(`GitHub 按钮发出的 openExternal：${JSON.stringify(openedAfter)}`)
      check.ok(
        '卡片 GitHub 按钮发出一次 vscode.openExternal（带提交链接）',
        openedAfter.length === openedUrls.length + 1 && openedAfter[openedAfter.length - 1].includes(FIXTURE_SHA),
        JSON.stringify(openedAfter),
      )

      // --- 清空（Esc ×2）+ 反悔（Ctrl+Z） ---
      await page.click(editorSelector)
      await page.keyboard.type('lab clear test')
      await page.waitForTimeout(300)
      const typed = await page.evaluate((sel: string) => document.querySelector(sel)?.textContent ?? '', editorSelector)
      check.ok('composer 输入生效', typed.includes('lab clear test'), typed)

      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
      const armed = await contentCount(page, '.dshOneClear_hint')
      check.fact(`第一次 Esc 后的提示元素=${String(armed)}`)
      check.ok('第一次 Esc：进入武装态并出提示', armed >= 1, `hint=${String(armed)}`)
      screenshots.push(await shot(ctx, page, 'interact-clear-arm'))

      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
      const cleared = await page.evaluate((sel: string) => document.querySelector(sel)?.textContent ?? '', editorSelector)
      const undoOffered = await contentCount(page, '.dshOneClear_undo')
      check.fact(`第二次 Esc 后的草稿=${JSON.stringify(cleared)} 撤销入口=${String(undoOffered)}`)
      check.ok('第二次 Esc：草稿被清空', !cleared.includes('lab clear test'), cleared)
      check.ok('第二次 Esc：出撤销入口', undoOffered >= 1, `undo=${String(undoOffered)}`)
      screenshots.push(await shot(ctx, page, 'interact-clear-done'))

      await page.keyboard.press('Control+z')
      await page.waitForTimeout(400)
      const restored = await page.evaluate((sel: string) => document.querySelector(sel)?.textContent ?? '', editorSelector)
      check.fact(`Ctrl+Z 后的草稿=${JSON.stringify(restored)}`)
      check.ok('Ctrl+Z：草稿复原', restored.includes('lab clear test'), restored)
      screenshots.push(await shot(ctx, page, 'interact-clear-undo'))

      check.eq('交互全程零 pageerror', opened.capture.pageErrors, [])
    } finally {
      await opened.context.close()
    }
    return screenshots
  },
}

// ---------------------------------------------------------------------------
// F-04 PARITY：侧栏树外观与几何对齐官方
// ---------------------------------------------------------------------------

/**
 * 对齐断言 = 同一 frame、同一网关数据、同一宽度下，两侧同名元素（自有树
 * `dshOneTree_<name>` vs 官方 `<hash>_<name>`，按类名**后缀**取）的 computed
 * style 与几何矩形逐项相等。数值不硬编码：官方改版后这边跟着变，不相等才报。
 *
 * `geometry`：缺省 = 宽高都比；`'width'` = 只比宽度（矮一截是功能带来的差异）；
 * `'height'` = 只比高度（宽度由取到的那一行文本决定）；`'none'` = 不比矩形（宽度由两边
 * 的工具栏条目数决定，不是外观契约）。
 */
const PARITY_PAIRS: ReadonlyArray<{ suffix: string; props: readonly string[]; geometry?: 'width' | 'height' | 'none' }> = [
  { suffix: 'sectionHeader', props: ['height', 'borderRadius', 'paddingLeft', 'marginTop', 'marginBottom', 'marginRight'] },
  // 搜索栏（#99 立骨架、#132 起两态）：自有树与官方页**默认都是收起态**（28px 圆胶囊），
  // 点开后都是展开态（30px 高 / 10px 圆角）。所以这一组两态各比一遍：先在两侧的默认
  // 折叠态下比（下面 run 里的 collapsed 块），再把两侧都点开、同处展开态后比（主循环）。
  // **矩形宽度不比**（geometry 'none'）：自有树顶栏比官方多几枚图标（折叠展开全部 /
  // 添加工作区 / 设置齿轮，另有多选入口；#131 起视图选项那一枚已退役），搜索栏分到的
  // 可用宽度本来就不同——那是功能带来的差异。
  { suffix: 'search', props: ['height', 'borderRadius'], geometry: 'none' },
  { suffix: 'searchButton', props: ['width', 'height', 'borderRadius'] },
  { suffix: 'iconButton', props: ['width', 'height', 'borderRadius'] },
  { suffix: 'projectRow', props: ['height', 'paddingLeft', 'paddingRight', 'gap', 'borderRadius'] },
  { suffix: 'sessionRow', props: ['height', 'paddingLeft', 'paddingRight', 'gap', 'borderRadius'] },
  { suffix: 'title', props: ['fontSize', 'lineHeight', 'marginLeft', 'marginRight', 'marginTop', 'marginBottom'] },
  // #109 起自有树把**当前工作区那一组排到最前**（E7），官方页仍按工作区注册顺序——两侧
  // 取到的「第一个时间」因此可能是不同会话的相对时间（实测 own="1小时" vs official="11分钟"），
  // 而宽度正是被文本撑出来的。所以这一组只比高度（20px 行高）与样式，不比宽度。
  { suffix: 'time', props: ['fontSize', 'lineHeight'], geometry: 'height' },
  { suffix: 'slot', props: ['width', 'height'] },
  // 列表容器只比宽度：两侧的可用高度本来就不一样——自有树在列表之上还有顶栏那一行
  // （#135 起它里面除分节头还住着分组过滤胶囊与四枚工具控件）、选择态时还会插一条操作条
  // （#108），两侧的行数与折叠态也不一致；宽度、内边距、滚动条槽这些样式契约仍逐项比对。
  // （#135 之前这条例外写的成因是「过滤条让容器矮一行」——过滤条并进顶栏那一行之后那句话
  // 不再成立，但「容器高矮不可比」这件事本身没变。）
  { suffix: 'list', props: ['paddingBottom', 'paddingLeft', 'marginLeft', 'marginRight', 'scrollbarGutter'], geometry: 'width' },
]

interface ParitySample {
  found: boolean
  styles: Record<string, string>
  rect: { width: number; height: number }
  /** 取到的那个元素的文本（比较失败时能一眼看出「是不是同一行」）。 */
  text: string
}

/**
 * 读一对同名元素里的一个（按类名后缀取第一个）。
 *
 * **属性名要转 kebab-case 再读**：`getPropertyValue` 只认 CSS 属性名，写成 camelCase
 * （`paddingLeft` / `borderRadius`）一律读回空串——两侧都读空串，断言就成了「'' === ''」这种
 * 永远为真的橡皮图章。`PARITY_PAIRS` 与调用点写的都是 camelCase（可读），所以统一在这里转
 * （与 F-13 的 `readDensity`、F-29 的读法同一处置）。
 */
async function samplePair(page: OpenedPage['page'], suffix: string, props: readonly string[]): Promise<ParitySample> {
  return page.evaluate(
    ({ suffix: wanted, props: styleProps }) => {
      const token = `_${wanted}`
      let element: Element | null = null
      for (const candidate of Array.from(document.querySelectorAll('body *'))) {
        const className = candidate.getAttribute('class')
        if (className === null) continue
        if (className.split(/\s+/).some((name) => name.endsWith(token))) {
          element = candidate
          break
        }
      }
      if (element === null) return { found: false, styles: {}, rect: { width: 0, height: 0 }, text: '' }
      const computed = getComputedStyle(element)
      const kebab = (prop: string): string => prop.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
      const styles: Record<string, string> = {}
      for (const prop of styleProps) styles[prop] = computed.getPropertyValue(kebab(prop))
      const rect = element.getBoundingClientRect()
      return {
        found: true,
        styles,
        rect: { width: Math.round(rect.width * 2) / 2, height: Math.round(rect.height * 2) / 2 },
        text: (element.textContent ?? '').slice(0, 40),
      }
    },
    { suffix, props },
  )
}

export const PARITY_SUITE: LabSuite = {
  id: 'F-04',
  phase: 'new-feature',
  name: '侧栏树外观与几何对齐官方（PARITY 套件，260/340/500 三档宽度）',
  expect:
    '同一 frame、同一网关数据、同一宽度下，自有树的原生元素与官方浏览区同名元素（按类名后缀配对）的 computed style（分节头、搜索栏两态、图标按钮、分组行、会话行、标题、时间、图标位、列表容器）与几何矩形逐项相等；数值不硬编码——官方改版两边跟着变，不相等才报。**搜索栏（#132 起两态）**：两侧默认都是折叠态，所以先在默认的折叠态下比一遍（28px 圆胶囊那一支），再把两侧各自点开、同处展开态后进主循环（30px / 10px 圆角那一支）——两态都覆盖，不是只比一态。四组例外都写明了理由：**列表容器只比宽度**（两侧可用高度本来就不同：自有树在列表之上还有顶栏那一行与选择态操作条，行数与折叠态也不一致）、**相对时间只比高度**（#109 的 E7 把当前工作区那一组排到最前，官方页仍按注册顺序，两侧取到的可能是不同会话的相对时间，而宽度正是被文本撑出来的）、**搜索栏只比样式不比矩形**（自有树顶栏比官方多几枚图标，可用宽度本来就不同）、**两侧都没产生某元素时该组跳过**（例如当前会话是空白会话时没有相对时间可量；一侧有另一侧没有仍判失败）。**密度档（#85）的处置**：密度是有意的差异（菜单一侧的 VS Code 档比官方档紧），所以对齐断言先把自有页的密度变量按它自己声明的官方兜底值对齐（「没人给偏好时 = 官方档」正是这套变量承诺的语义），并同时钉住「VS Code 档真的更紧」与「对齐后 = 官方基准」两条。**#134 起还多一条更强的口径**：行家族（工作区行 / 会话行）本来就是官方标准档，所以**不用对齐密度变量**就该与官方基准逐项相等（行高 / 圆角 / 左右内边距四项）——这条把「行回到官方几何」钉在真页面上，也让 PARITY 的对照从「对齐后才可比」收紧成「行这一族直接可比」。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const own = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { width: 380, height: 900 })
    const official = await openTreePage(ctx.browser, ctx.lab, route('sidebar-official'), { width: 380, height: 900 })
    try {
      // #132 起自有树的搜索栏与官方页一样是**两态的**、默认都收起：下面先把两侧的默认
      // 折叠态比一遍（同一份「都还没点开」的现场），再各自点开、同处展开态后进主循环
      // 逐项比（原来那条流程）。两边都只切呈现状态，不碰任何数据。
      check.fact(
        `对齐口径：自有树（.dshOneTree_*）对官方对照档（官方 hash 类名，按类名后缀配对），逐组比 computed style 各属性 + 几何矩形；共 ${String(PARITY_PAIRS.length)} 组元素 × 3 档宽度（260/340/500）；属性名在读取时统一转 kebab-case（camelCase 直接喂 getPropertyValue 会读回空串，两侧都空 = 断言永远为真）`,
      )
      await own.page.setViewportSize({ width: 340, height: 900 })
      await official.page.setViewportSize({ width: 340, height: 900 })
      await own.page.waitForTimeout(300)
      await official.page.waitForTimeout(300)

      // ---- #134：行家族默认即官方档（不必先对齐密度变量）----
      // 这一组是本套件比 #134 之前更强的地方：行高 / 圆角 / 左右内边距四项在**未对齐**的
      // VS Code 档下就与官方基准逐项相等（行家族取官方标准档的直接后果）。#134 之前行在
      // VS Code 档是 26px / 5px / 7px，这些比对必须先对齐变量才成立。
      const rowProps = ['height', 'borderRadius', 'paddingLeft', 'paddingRight'] as const
      const ownRows = {
        projectRow: await samplePair(own.page, 'projectRow', rowProps),
        sessionRow: await samplePair(own.page, 'sessionRow', rowProps),
      }
      const officialRows = {
        projectRow: await samplePair(official.page, 'projectRow', rowProps),
        sessionRow: await samplePair(official.page, 'sessionRow', rowProps),
      }
      for (const suffix of ['projectRow', 'sessionRow'] as const) {
        const a = ownRows[suffix]
        const b = officialRows[suffix]
        check.ok(`#134 行家族：两侧都取到 ${suffix} 元素`, a.found && b.found, `own=${String(a.found)} official=${String(b.found)}`)
        if (!a.found || !b.found) continue
        check.fact(`#134 ${suffix}（未对齐密度变量）：own=${JSON.stringify(a.styles)} official=${JSON.stringify(b.styles)}`)
        for (const prop of rowProps) {
          check.eq(
            `#134 行家族默认即官方档：${suffix} 的 ${prop} 未对齐密度变量就与官方相等`,
            a.styles[prop],
            b.styles[prop],
          )
        }
      }

      // ---- 密度档：先量 VS Code 档（现况），再把它对齐到官方兜底值 ----
      // 探针用**顶栏那一行**（分节头）：它仍是紧凑档（VS Code 侧 26px vs 官方 36px），
      // 所以「密度变量真的下发了」还量得出来。#134 之前这里用的是行高——行家族回标准档后
      // 两边同值，那个探针已经量不出差异了。
      const vscodeDensity = await samplePair(own.page, 'sectionHeader', ['height'])
      const officialDensity = await samplePair(official.page, 'sectionHeader', ['height'])
      check.ok(
        '#85 密度档：VS Code 侧的顶栏那一行比官方档紧（同一个 frame 上真的下发了密度变量）',
        Number.parseFloat(vscodeDensity.styles.height ?? '0') < Number.parseFloat(officialDensity.styles.height ?? '0'),
        `own=${vscodeDensity.styles.height} official=${officialDensity.styles.height}`,
      )
      const densityFix = await own.page.evaluate(() => {
        // 从自有树的 CSS 里读出每项的官方兜底值（`var(--dsh-one-density-x, <官方原值>)`
        // 的第二参数），把它们内联设到 frame 元素上（内联胜过样式表里的 VS Code 档）
        // ——于是自有页回到「没人给偏好」的官方档，与官方基准可逐项比对。
        const treeCss =
          Array.from(document.querySelectorAll('style[data-plugin]'))
            .find((element) => element.getAttribute('data-plugin') === '@dsh-one/dsh-workspace-tree')
            ?.textContent ?? ''
        const fallbacks = Array.from(treeCss.matchAll(/var\(--dsh-one-density-([a-z-]+),\s*([^)]+)\)/g)).map(
          (match) => [match[1] ?? '', (match[2] ?? '').trim()] as const,
        )
        const frame = document.querySelector('[class*="dshOneSidebarShell_frame"]')
        if (frame === null) return { applied: 0, officialFallbacks: [] as string[] }
        for (const [key, value] of fallbacks) frame.setAttribute('style', `${frame.getAttribute('style') ?? ''};--dsh-one-density-${key}:${value}`)
        return { applied: fallbacks.length, officialFallbacks: fallbacks.map(([key, value]) => `${key}=${value}`) }
      })
      check.fact(`密度档兜底值（自作树 CSS 读出并回填到 frame）：${densityFix.officialFallbacks.join(' ')}`)
      // #104 起键面从 17 项扩到 25 项（顶栏 / 分组过滤条 / 回收站入口行 / 抽屉），#113 再加
      // 行圆角一项（26 项），#137 又减掉一项（回收站入口行整套改取旧侧栏规格，`footer-row-height`
      // 退场 → 25 项）；这里只守量级（精确键集与逐项官方原值由外壳契约套件的两条测试
      // 在源码层守）。
      check.ok(
        '密度档变量组 ≥ 20 项（#104 起 25 项，#113 的 26 项到 #137 减回 25 项；与契约测试同口径）',
        densityFix.applied >= 20,
        `applied=${String(densityFix.applied)}`,
      )
      await own.page.waitForTimeout(200)
      const alignedDensity = await samplePair(own.page, 'projectRow', ['height'])
      check.eq(
        '密度档：把变量对齐到官方兜底值后，自有树与官方基准逐项一致（官方档是无人给偏好时的兜底）',
        alignedDensity.styles.height,
        officialRows.projectRow.styles.height,
      )

      // ---- 搜索栏：两侧默认折叠态先比一遍（#132 起两边都默认收起，这是同一份现场） ----
      // 折叠态的读数与展开态取值不同（28px 圆胶囊 vs 30px 圆角框），所以这一遍不是主循环
      // 的重复：主循环在两侧点开之后跑，比的是展开态。
      for (const pair of PARITY_PAIRS.filter((candidate) => candidate.suffix === 'search' || candidate.suffix === 'searchButton')) {
        const a = await samplePair(own.page, pair.suffix, pair.props)
        const b = await samplePair(official.page, pair.suffix, pair.props)
        const label = `折叠态 w=340 ${pair.suffix}`
        if (!check.ok(`${label}：两侧都取到元素`, a.found && b.found, `own=${String(a.found)} official=${String(b.found)}`)) continue
        check.fact(`${label}：own=${JSON.stringify(a.styles)} (${String(a.rect.width)}×${String(a.rect.height)}) official=${JSON.stringify(b.styles)} (${String(b.rect.width)}×${String(b.rect.height)})`)
        for (const prop of pair.props) {
          check.ok(`${label}：${prop} 一致`, a.styles[prop] === b.styles[prop], `own=${a.styles[prop]} official=${b.styles[prop]}`)
        }
        if (pair.suffix === 'searchButton') {
          check.ok(
            `${label}：几何矩形一致（折叠态两侧都是同一枚图标按钮）`,
            a.rect.width === b.rect.width && a.rect.height === b.rect.height,
            `own=${String(a.rect.width)}×${String(a.rect.height)} official=${String(b.rect.width)}×${String(b.rect.height)}`,
          )
        }
      }
      // 各自点开，同处展开态进主循环（自有树点它自己的放大镜，官方点官方那一枚）。
      await own.page.click('[data-dshone-tree-action="search"]')
      await official.page.click('[class*="_searchButton"]')
      await own.page.waitForTimeout(250)
      await official.page.waitForTimeout(250)

      for (const width of [260, 340, 500]) {
        await own.page.setViewportSize({ width, height: 900 })
        await official.page.setViewportSize({ width, height: 900 })
        await own.page.waitForTimeout(300)
        await official.page.waitForTimeout(300)
        for (const pair of PARITY_PAIRS) {
          const a = await samplePair(own.page, pair.suffix, pair.props)
          const b = await samplePair(official.page, pair.suffix, pair.props)
          const label = `w=${String(width)} ${pair.suffix}`
          // 两侧都没有这个元素 = 当前数据里没产生它（例如网关的当前会话是空白会话
          // 时，会话行不渲染相对时间）——「没有可比的东西」不是外观不一致，记一笔
          // 观测跳过；只有**一侧有、一侧没有**才是真的偏差，判失败。
          if (!a.found && !b.found) {
            check.fact(`${label}：两侧都没有该元素（当前数据没产生它）——该组跳过比较`)
            continue
          }
          if (!check.ok(`${label}：两侧都取到元素`, a.found && b.found, `own=${String(a.found)} official=${String(b.found)}`)) continue
          // 矩形与文本一起记：宽度差往往只是「两侧取到的是不同行」（例如 #109 起自有树把当前
          // 工作区那一组排到最前，官方页仍按注册顺序），有文本才看得出一眼。
          check.fact(`${label}：own=${JSON.stringify(a.text)} (${String(a.rect.width)}) official=${JSON.stringify(b.text)} (${String(b.rect.width)})`)
          for (const prop of pair.props) {
            check.ok(`${label}：${prop} 一致`, a.styles[prop] === b.styles[prop], `own=${a.styles[prop]} official=${b.styles[prop]}`)
          }
          // 矩形：缺省宽高都比；'width' = 只比宽度（矮一截是功能带来的）；
          // 'none' = 不比（宽度由两边工具栏条目数决定，不是外观契约）。
          if (pair.geometry === 'none') {
            check.fact(`${label}：本组只比样式，不比矩形（宽度由两边工具栏条目数决定）`)
            continue
          }
          check.ok(
            `${label}：几何矩形一致`,
            pair.geometry === 'width'
              ? a.rect.width === b.rect.width
              : pair.geometry === 'height'
                ? a.rect.height === b.rect.height
                : a.rect.width === b.rect.width && a.rect.height === b.rect.height,
            pair.geometry === 'width'
              ? `own=${{ w: a.rect.width, h: a.rect.height }} official=${{ w: b.rect.width, h: b.rect.height }}（本组只比宽度）`
              : pair.geometry === 'height'
                ? `own=${{ w: a.rect.width, h: a.rect.height }} official=${{ w: b.rect.width, h: b.rect.height }}（本组只比高度：宽度由取到的那一行文本决定）`
                : `own=${JSON.stringify(a.rect)} official=${JSON.stringify(b.rect)}`,
          )
        }
        if (width === 340) {
          screenshots.push(await shot(ctx, own.page, 'parity-own-340'))
          screenshots.push(await shot(ctx, official.page, 'parity-official-340'))
        }
      }
      check.eq('对齐套件：两侧零 pageerror', [...own.capture.pageErrors, ...official.capture.pageErrors], [])
    } finally {
      await own.context.close()
      await official.context.close()
    }
    return screenshots
  },
}

// ---------------------------------------------------------------------------
// F-05 BRIDGE：宿主能力口的页面侧语义
// ---------------------------------------------------------------------------

export const BRIDGE_SUITE: LabSuite = {
  id: 'F-05',
  phase: 'new-feature',
  name: '宿主能力口页面侧：统一获取点、id 配对、结构化错误（BRIDGE 套件）',
  expect:
    '装配页注入的 `__DSH_ONE_HOST__.call` 是函数；全页 `acquireVsCodeApi` **只被调用一次**（统一获取点约束，第二次会 throw）；并发调用按各自 id 兑现自己的回执；宿主拒绝时抛带 code 的结构化错误；上行消息形状是 {type:dshOne.hostCall,call,args,id} 且 id 各不相同。',
  run: async (ctx, check) => {
    const opened = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { width: 380, height: 900 })
    try {
      const probe = await opened.page.evaluate(async () => {
        const host = (globalThis as unknown as {
          __DSH_ONE_HOST__?: { call: (name: string, args?: unknown) => Promise<unknown> }
          __LAB_HOST__?: { acquireCalls: number; sent: { type?: string; call?: string; args?: unknown; id?: string }[] }
        })
        const sdk = host.__DSH_ONE_HOST__
        const fake = host.__LAB_HOST__
        const empty = {
          missing: true,
          callType: 'undefined',
          acquireCalls: -1,
          shas: [] as string[],
          codes: [] as string[],
          rejected: {} as { code?: string; message?: string },
          ids: [] as string[],
          shapeOk: false,
        }
        if (sdk === undefined || fake === undefined) return empty
        const concurrent = await Promise.all([
          sdk.call('git.show', { hash: 'aaaaaaa' }),
          sdk.call('git.show', { hash: 'bbbbbbb' }),
        ])
        let rejected: { code?: string; message?: string } = {}
        try {
          await sdk.call('lab.unknown', {})
        } catch (error) {
          // 取字段而不是把 Error 实例本身带出去：Playwright 只序列化 Error 的
          // name/message/stack，自定义的 code 会在过桥时丢掉。
          const thrown = error as { code?: string; message?: string }
          rejected = { code: thrown.code, message: thrown.message }
        }
        const calls = fake.sent.filter((message) => message.type === 'dshOne.hostCall')
        return {
          missing: false,
          callType: typeof sdk.call,
          acquireCalls: fake.acquireCalls,
          shas: concurrent.map((entry) => (entry as { sha?: string }).sha ?? ''),
          codes: concurrent.map((entry) => (entry as { message?: string }).message ?? ''),
          rejected,
          ids: calls.map((message) => message.id ?? ''),
          shapeOk: calls.every(
            (message) =>
              message.type === 'dshOne.hostCall' && typeof message.call === 'string' && 'args' in message && typeof message.id === 'string',
          ),
        }
      })
      check.fact(`桥：${JSON.stringify(probe)}`)
      if (probe.missing) {
        check.ok('装配页注入了页面侧宿主 SDK（__DSH_ONE_HOST__）', false, 'missing')
        return []
      }
      check.ok('装配页注入了 `__DSH_ONE_HOST__.call`', probe.callType === 'function', String(probe.callType))
      check.eq('全页 acquireVsCodeApi 只调用一次', probe.acquireCalls, 1)
      check.eq('并发调用按 id 各归各的 Promise', probe.shas, ['aaaaaaa', 'bbbbbbb'])
      check.ok('并发调用的回执各自带自己的数据', probe.codes[0]?.includes('aaaaaaa') === true && probe.codes[1]?.includes('bbbbbbb') === true, JSON.stringify(probe.codes))
      check.ok('宿主拒绝时抛带 code 的结构化错误', probe.rejected.code === 'unknown-call', JSON.stringify(probe.rejected))
      check.ok('上行消息形状 {type,call,args,id}', probe.shapeOk === true)
      check.eq('每次调用的 id 各不相同', new Set(probe.ids).size, probe.ids.length)
      return []
    } finally {
      await opened.context.close()
    }
  },
}

// ---------------------------------------------------------------------------
// F-06 PORTABLE：可移植挂载点 / 官方侧外链（#83）
// ---------------------------------------------------------------------------

/** 假宿主在两个方向上的记录（VS Code 侧桥 / 官方 web 侧 window.open）。 */
type LabHostRecorder = { openedUrls: string[]; openedByWindow: string[] }

export const PORTABLE_SUITE: LabSuite = {
  id: 'F-06',
  phase: 'new-feature',
  name: '可移植性：页面上没有自有 frame 标记时，三个 dsh-* 插件照常工作（PORTABLE 套件）',
  expect:
    'chat 树在**抹掉自有 frame 标记**的页面上（`data-shell*` 属性一律不落进 DOM，等于官方 web 那种「没有我们的 shell frame」的处境）照常可用：官方对话区容器仍在；夹具正文被 git 卡片装饰、悬停出提交卡片；行内码右键出菜单、Esc 撤掉；GitHub 按钮有宿主桥时走 `vscode.openExternal`，把宿主桥撤掉后改走页面 `window.open`（官方 web 侧那条路）；composer 里 Esc ×2 清空、Ctrl+Z 复原。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const opened = await openTreePage(ctx.browser, ctx.lab, route('chat'), { width: 1200, stripFrameMarkers: true })
    const { page } = opened
    try {
      const markers = await page.evaluate(() => ({
        shell: document.querySelectorAll('[data-shell]').length,
        overlay: document.querySelectorAll('[data-shell-overlay]').length,
        conversation: document.querySelectorAll('[data-conversation-scroll]').length,
      }))
      check.fact(
        `抹掉 frame 标记后的页面：data-shell=${String(markers.shell)} data-shell-overlay=${String(markers.overlay)} 官方对话区容器=${String(markers.conversation)}`,
      )
      check.eq(
        '页面上没有任何自有 frame 标记（data-shell / data-shell-overlay）',
        [markers.shell, markers.overlay],
        [0, 0],
      )
      check.ok('官方对话区容器在页面上（插件的挂载点就在它上面）', markers.conversation >= 1, `container=${String(markers.conversation)}`)

      await injectMessageFixture(page)
      check.ok(
        '无 frame 标记：夹具正文仍被 git 卡片装饰（扫描挂官方容器）',
        (await contentCount(page, `[data-dshone-commit="${FIXTURE_SHA}"]`)) === 1,
      )

      // --- 行内码右键菜单（委托挂官方容器）---
      await page.click('[data-lab-fixture="message"] code', { button: 'right' })
      await page.waitForTimeout(300)
      const menu = await page.evaluate(() => ({
        menu: document.querySelector('[data-dshone-menu]') !== null,
        items: document.querySelectorAll('[data-dshone-menu] button[role="menuitem"]').length,
        marked: document.querySelectorAll('code[data-dshone-menu-target]').length,
      }))
      check.fact(`无 frame 标记时的右键菜单：${JSON.stringify(menu)}`)
      check.ok('无 frame 标记：行内码右键仍出菜单（1 项、目标高亮）', menu.menu && menu.items === 1 && menu.marked === 1, JSON.stringify(menu))
      screenshots.push(await shot(ctx, page, 'portable-menu'))
      await page.keyboard.press('Escape')
      await page.waitForTimeout(250)

      // --- 提交卡片（数据走宿主能力口）---
      await page.hover(`[data-dshone-commit="${FIXTURE_SHA}"]`)
      await page.waitForTimeout(400)
      const card = await page.evaluate(() => {
        const element = document.querySelector('[data-dshone-git-card]')
        return {
          present: element !== null,
          text: element === null ? '' : (element.textContent ?? '').slice(0, 200),
          buttons: element?.querySelectorAll('.dshOneGitCard_cmd').length ?? 0,
        }
      })
      check.fact(`无 frame 标记时的提交卡片：${JSON.stringify(card)}`)
      check.ok('无 frame 标记：悬停出提交卡片且内容来自宿主回执', card.present && card.text.includes('Lab Bot'), card.text)
      screenshots.push(await shot(ctx, page, 'portable-gitcard'))

      // --- 外链：VS Code 侧（有宿主桥）→ 官方 web 侧（撤掉桥）---
      if (card.buttons === 2) {
        await page.click('[data-dshone-git-card] .dshOneGitCard_cmd:last-of-type')
        await page.waitForTimeout(300)
      }
      const viaBridge = await page.evaluate(
        () => ((globalThis as { __LAB_HOST__?: LabHostRecorder }).__LAB_HOST__?.openedUrls ?? []),
      )
      check.fact(`有宿主桥时的外链出口：${JSON.stringify(viaBridge)}`)
      check.ok(
        '无 frame 标记：GitHub 按钮走 vscode.openExternal（VS Code 侧那条路）',
        viaBridge.length === 1 && viaBridge[0].includes(FIXTURE_SHA),
        JSON.stringify(viaBridge),
      )

      await page.evaluate(() => {
        // 撤掉宿主桥 = 官方 web 那种「页面里没有宿主对象」的处境；能力口每次调用现判通路。
        ;(globalThis as { __DSH_ONE_HOST__?: unknown }).__DSH_ONE_HOST__ = undefined
      })
      if ((await contentCount(page, '[data-dshone-git-card] .dshOneGitCard_cmd')) === 2) {
        await page.click('[data-dshone-git-card] .dshOneGitCard_cmd:last-of-type')
        await page.waitForTimeout(300)
      }
      const viaWindow = await page.evaluate(
        () => ((globalThis as { __LAB_HOST__?: LabHostRecorder }).__LAB_HOST__?.openedByWindow ?? []),
      )
      check.fact(`撤掉宿主桥后的外链出口：${JSON.stringify(viaWindow)}`)
      check.ok(
        '撤掉宿主桥后：GitHub 按钮改走页面 window.open（官方 web 侧那条路）',
        viaWindow.length === 1 && viaWindow[0].includes(FIXTURE_SHA),
        JSON.stringify(viaWindow),
      )

      // --- 清空 / 反悔（键位监听挂官方容器）---
      await page.click(editorSelector)
      await page.keyboard.type('portable clear test')
      await page.waitForTimeout(300)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
      const armed = await contentCount(page, '.dshOneClear_hint')
      check.ok('无 frame 标记：第一次 Esc 进入武装态并出提示', armed >= 1, `hint=${String(armed)}`)
      screenshots.push(await shot(ctx, page, 'portable-clear-arm'))
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
      const cleared = await page.evaluate((sel: string) => document.querySelector(sel)?.textContent ?? '', editorSelector)
      check.ok('无 frame 标记：第二次 Esc 草稿被清空', !cleared.includes('portable clear test'), cleared)
      await page.keyboard.press('Control+z')
      await page.waitForTimeout(400)
      const restored = await page.evaluate((sel: string) => document.querySelector(sel)?.textContent ?? '', editorSelector)
      check.ok('无 frame 标记：Ctrl+Z 草稿复原', restored.includes('portable clear test'), restored)
      screenshots.push(await shot(ctx, page, 'portable-clear-undo'))

      check.eq('可移植页面上零 pageerror', opened.capture.pageErrors, [])
    } finally {
      await opened.context.close()
    }
    return screenshots
  },
}

// ---------------------------------------------------------------------------
// F-07 SIDEBAR：#81 六项侧栏核心功能 + #82 的状态读写与视图态持久化
// ---------------------------------------------------------------------------

/** 页面上所有工作区分组键（行的 `data-dshone-tree-key`）。 */
async function workspaceKeys(page: OpenedPage['page']): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-dshone-tree-row="workspace"]')).map(
      (element) => element.getAttribute('data-dshone-tree-key') ?? '',
    ),
  )
}

/**
 * 分组过滤条的单胶囊下拉（#99 起形态）：先点开胶囊再点其中一项。
 * 下拉由官方 `Menu` 渲染（portal 到 body），所以项要等它挂出来再点。
 */
async function openPillMenu(page: OpenedPage['page']): Promise<void> {
  await page.click('[data-dshone-tree-action="group-pill"]')
  await page.waitForTimeout(150)
}

async function pickPillItem(page: OpenedPage['page'], id: string): Promise<void> {
  await openPillMenu(page)
  await page.click(`[data-dshone-tree-pill-item="${id}"]`)
  await page.waitForTimeout(200)
}

/** 假宿主状态存储里当前的分组状态（未写回时为注入的初值）。 */
async function hostGroups(page: OpenedPage['page']): Promise<unknown> {
  return page.evaluate(() => {
    const host = (globalThis as unknown as { __LAB_HOST__?: { stateStore?: Record<string, unknown> } }).__LAB_HOST__
    return host?.stateStore?.groups ?? null
  })
}

export const SIDEBAR_SUITE: LabSuite = {
  id: 'F-07',
  phase: 'new-feature',
  name: '侧栏六项核心功能（#81）：分组过滤、活状态计数、回收站抽屉、批量选择、不折叠、状态读写与视图态持久化',
  expect:
    '侧栏树（真实网关只读 + 假宿主）：**旧版 groups.json 的形状注进宿主状态存储就是可用数据**（分组 chip 按它渲染，过滤只留归属该分组的工作区）；分组由界面新建后按同一形状写回宿主状态存储（version 1、membership 在、旧字段 activeGroupId 不被抹掉）。**计数与行同源**：每个工作区行尾的「运行中/等待交互/未读」角标数值 = 该工作区下会话行里 `data-dshone-tree-status` 的数与行上那个 `dshOneTree_unread` 标记的数（#153 起角标是三项）（这同时证明工作区内会话没有被官方那 5 行截断，**不折叠**：不出现「显示更多」行，行数 = 该工作区的会话总数）。**回收站**：官方归档集合在抽屉里按工作区组织、每行有还原按钮；批量选择态出复选框与动作条，选中计数随点选变化，退出后动作条消失。**视图态**：当前过滤的分组写进官方惯例的 `dsh.workspaceTree.view`（localStorage），同上下文重载后仍然生效。全程零 pageerror（归档/还原**不被点击**——那会写真实网关）。',
  run: async (ctx, check) => {
    const screenshots: string[] = []

    // 第一步：先开一次页面，取真实网关上的工作区键——分组归属要按真实 id 造夹具
    // （夹具里的 id 必须是页面上真有的工作区，否则过滤断言无从观察）。
    const probe = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { width: 380, height: 900 })
    let keys: string[] = []
    try {
      keys = await workspaceKeys(probe.page)
    } finally {
      await probe.context.close()
    }
    check.fact(`真实网关上的工作区分组键：${keys.slice(0, 4).join(', ')}（共 ${String(keys.length)} 个）`)
    check.ok('侧栏有 ≥ 2 个真实工作区分组（才能验证过滤）', keys.length >= 2, `keys=${String(keys.length)}`)
    if (keys.length < 2) return []

    // 夹具 = 旧侧栏 groups.json 的**原样形状**（version 1 + groups + membership +
    // activeGroupId）。这正是 #82 要证明的一点：键名与格式沿用旧文件，所以没有
    // 「迁移」这一步——旧数据直接就是新数据。
    const legacyGroups = {
      version: 1,
      groups: [
        { id: 'g-lab-one', name: 'Lab One' },
        { id: 'g-lab-two', name: 'Lab Two' },
      ],
      membership: { [keys[0]]: ['g-lab-one'], [keys[1]]: ['g-lab-two'] },
      activeGroupId: 'g-lab-one',
    }

    const opened = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), {
      width: 380,
      height: 900,
      state: { groups: legacyGroups },
    })
    const { page, capture } = opened
    try {
      const initialPill = await (async () => {
        await page.click('[data-dshone-tree-action="group-pill"]')
        await page.waitForTimeout(150)
        const items = await page.evaluate(() =>
          Array.from(document.querySelectorAll('[data-dshone-tree-pill-item]')).map((element) => element.getAttribute('data-dshone-tree-pill-item') ?? ''),
        )
        const label = (await page.textContent('[data-dshone-tree-action="group-pill"]')) ?? ''
        const count = await page.getAttribute('[data-dshone-tree-action="group-pill"]', 'data-dshone-tree-group-count')
        await page.keyboard.press('Escape')
        await page.waitForTimeout(150)
        return { items, label, count }
      })()
      check.fact(`分组胶囊：label=${JSON.stringify(initialPill.label)} 计数=${String(initialPill.count)} 下拉项=${initialPill.items.join(',')}`)
      check.eq('分组胶囊的下拉按旧 groups.json 渲染（全部 + 两个分组）', initialPill.items, ['all', 'g-lab-one', 'g-lab-two'])
      check.ok(
        '分组胶囊默认显示「全部工作区」+ 成员工作区数（#99 单胶囊口径：只数工作区，不含未分组桶）',
        initialPill.label.includes('全部工作区') && initialPill.count === String(keys.filter((key) => key !== '').length),
        `label=${initialPill.label} count=${String(initialPill.count)} 工作区行=${String(keys.filter((key) => key !== '').length)}`,
      )
      // 旧文件里的 activeGroupId 是**旧版**的「当前分组」；本版它是纯视图态（住
      // localStorage），所以初值应当是「全部」——文件里那个字段原样保留不动。
      const allVisible = await workspaceKeys(page)
      check.eq('旧 activeGroupId 不被当作视图态（初始仍是「全部」）', allVisible.length, keys.length)

      // ---- 功能 1：过滤（#99 起入口是单胶囊的下拉项，不再是那排 chip） ----
      await pickPillItem(page, 'g-lab-one')
      check.eq('在下拉里选分组后只留归属该分组的工作区', await workspaceKeys(page), [keys[0]])
      const storedPrefs = await page.evaluate(() => localStorage.getItem('dsh.workspaceTree.view'))
      check.ok('当前过滤的分组写进官方惯例的 localStorage 键', storedPrefs !== null && storedPrefs.includes('g-lab-one'), String(storedPrefs))
      screenshots.push(await shot(ctx, page, 'sidebar-group-filter'))

      // ---- 功能 6 + 功能 2：不折叠与计数 ----
      await pickPillItem(page, 'all')
      await page.evaluate(() => {
        for (const row of Array.from(document.querySelectorAll('[data-dshone-tree-row="workspace"]'))) {
          if (row.getAttribute('aria-expanded') !== 'true') (row as HTMLElement).click()
        }
      })
      await page.waitForTimeout(400)
      const sections = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-dshone-group-key]')).map((section) => {
          const key = section.getAttribute('data-dshone-group-key') ?? ''
          const row = section.querySelector('[data-dshone-tree-row="workspace"]')
          const badge = row?.querySelector('[data-dshone-tree-activity]')?.getAttribute('data-dshone-tree-activity') ?? ''
          const sessionRows = Array.from(section.querySelectorAll('[data-dshone-tree-row="session"]'))
          const statuses = sessionRows.map((element) => element.getAttribute('data-dshone-tree-status') ?? '')
          return {
            key,
            count: Number(row?.getAttribute('data-dshone-tree-count') ?? '-1'),
            badge,
            rows: statuses.length,
            running: statuses.filter((status) => status === 'running').length,
            waiting: statuses.filter((status) => status === 'waiting').length,
            // #153 起角标有第三项（未读，数据源是行上那个 `dshOneTree_unread` 加粗标记）。
            unread: sessionRows.filter((element) => (element.querySelector('.dshOneTree_title')?.className ?? '').includes('dshOneTree_unread')).length,
            overflow: section.querySelectorAll('.dshOneTree_sessionOverflowButton').length,
          }
        }),
      )
      const withSessions = sections.filter((section) => section.rows > 0)
      check.fact(
        `展开了 ${String(sections.length)} 个分组：${withSessions
          .slice(0, 5)
          .map((section) => `${section.key.slice(0, 8)}=${String(section.count)}行(角标${section.badge === '' ? '无' : section.badge})`)
          .join(' ')}`,
      )
      check.ok('展开后有工作区渲染出会话行（计数才有对照）', withSessions.length >= 1, `sections=${String(sections.length)}`)
      check.eq(
        '功能 6 不折叠：全树不出现「显示更多」行',
        sections.reduce((total, section) => total + section.overflow, 0),
        0,
      )
      check.ok(
        '功能 6 不折叠：每个展开工作区的会话行数 = 它的会话总数（官方会截到 5 行）',
        sections.every((section) => section.rows === section.count),
        sections
          .filter((section) => section.rows !== section.count)
          .map((section) => `${section.key.slice(0, 8)} rows=${String(section.rows)} count=${String(section.count)}`)
          .join(' '),
      )
      const badgeMismatch = sections.filter((section) => {
        if (section.badge === '') return section.running > 0 || section.waiting > 0 || section.unread > 0
        const [running, waiting, unread] = section.badge.split('/')
        return (
          Number(running) !== section.running ||
          Number(waiting) !== section.waiting ||
          Number(unread) !== section.unread
        )
      })
      check.ok(
        '功能 2 计数：行尾角标（运行中/等待交互/未读）= 该工作区会话行里的真实状态数',
        badgeMismatch.length === 0,
        badgeMismatch
          .map((section) => `${section.key.slice(0, 8)} badge=${section.badge} running=${String(section.running)} waiting=${String(section.waiting)} unread=${String(section.unread)}`)
          .join(' '),
      )
      screenshots.push(await shot(ctx, page, 'sidebar-activity-counts'))

      // ---- 功能 3/5：回收站抽屉（数据 = 官方归档集合；只读，不点还原） ----
      const recycleTotal = await page.getAttribute('[data-dshone-tree-action="recycle-toggle"]', 'data-dshone-tree-recycle-count')
      await page.click('[data-dshone-tree-action="recycle-toggle"]')
      await page.waitForTimeout(300)
      const drawer = await page.evaluate(() => {
        const root = document.querySelector('[data-dshone-tree="recycle-drawer"]')
        if (root === null) return null
        return {
          groups: Array.from(root.querySelectorAll('[data-dshone-recycle-group]')).map(
            (element) => element.getAttribute('data-dshone-recycle-group') ?? '',
          ),
          rows: root.querySelectorAll('[data-dshone-recycle-row]').length,
          restores: root.querySelectorAll('[data-dshone-recycle-restore]').length,
          empty: root.textContent?.includes('recycle') ?? false,
          status: root.querySelector('.dshOneTree_drawerStatus') !== null,
        }
      })
      check.fact(`回收站入口角标=${String(recycleTotal)} 抽屉=${JSON.stringify(drawer)}`)
      check.ok('功能 5：点回收站入口开抽屉', drawer !== null)
      check.ok('功能 3：抽屉内容与入口角标同源（角标 = 抽屉里的会话数）', drawer !== null && String(drawer.rows) === String(recycleTotal), `rows=${String(drawer?.rows)} badge=${String(recycleTotal)}`)
      check.ok(
        '功能 3/5：抽屉里的会话按工作区组织（每个块一条还原）',
        drawer !== null && (drawer.rows === 0 ? drawer.status : drawer.restores === drawer.rows && drawer.groups.length >= 1),
        JSON.stringify(drawer),
      )
      screenshots.push(await shot(ctx, page, 'sidebar-recycle-drawer'))
      await page.click('[data-dshone-tree-action="recycle-close"]')
      // 收起有滑出过渡（#117）：等过渡跑完抽屉才从 DOM 里消失，所以这里等得比过渡长。
      await page.waitForTimeout(400)
      check.eq('功能 5：抽屉可以关掉', await contentCount(page, '[data-dshone-tree="recycle-drawer"]'), 0)

      // ---- 功能 4：批量选择（只验选择与动作条，不点「移入回收站」——那会写真实网关） ----
      await page.click('[data-dshone-tree-action="select-mode"]')
      await page.waitForTimeout(300)
      const marks = await contentCount(page, '.dshOneTree_check')
      check.ok('功能 4：进入选择态后每行出勾选框', marks >= 1, `checks=${String(marks)}`)
      const firstRows = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('[data-dshone-tree-row="session"]'))
        const first = rows[0]
        const second = rows[1]
        if (first instanceof HTMLElement) first.click()
        if (second instanceof HTMLElement) second.click()
        return rows.length
      })
      await page.waitForTimeout(200)
      const selection = await page.evaluate(() => {
        const host = (globalThis as unknown as { __LAB_HOST__?: { hostCalls: { call: string }[] } }).__LAB_HOST__
        return {
          checked: document.querySelectorAll('[data-dshone-tree-checked="true"]').length,
          bar: document.querySelector('[data-dshone-tree="selection-bar"]')?.textContent ?? '',
          archiveCalls: (host?.hostCalls ?? []).filter((entry) => entry.call === 'state.write').length,
        }
      })
      check.fact(`可勾选会话行=${String(firstRows)} 已勾选=${String(selection.checked)} 动作条=${JSON.stringify(selection.bar)}`)
      check.eq('功能 4：点两行即勾选两行', selection.checked, 2)
      check.ok('功能 4：动作条显示已选计数', /\b2\b/.test(selection.bar), selection.bar)
      check.ok('功能 4：动作条带「移入回收站」按钮（未被点击，零网关写入）', selection.bar.length > 0)
      screenshots.push(await shot(ctx, page, 'sidebar-multi-select'))
      await page.click('[data-dshone-tree-action="select-mode"]')
      await page.waitForTimeout(200)
      check.eq('功能 4：退出选择态后动作条消失', await contentCount(page, '[data-dshone-tree="selection-bar"]'), 0)

      // ---- 功能 1 的写路径 + #82 的迁移/幂等：建组 → 归属 → 落盘形状 ----
      // #99：入口在单胶囊的下拉里（先开下拉再点「新建分组…」）。
      await openPillMenu(page)
      await page.click('[data-dshone-tree-action="group-new"]')
      await page.waitForTimeout(200)
      await page.fill('.dshOneTree_renameInput', 'Lab New')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(300)
      const afterCreate = (await hostGroups(page)) as { version?: number; groups?: { id: string; name: string }[]; membership?: unknown; activeGroupId?: unknown } | null
      const created = afterCreate?.groups?.find((group) => group.name === 'Lab New')
      check.ok('功能 1：新建的分组按同一形状写回宿主状态存储（version 1 + groups + membership）',
        afterCreate?.version === 1 && created !== undefined && typeof afterCreate.membership === 'object', JSON.stringify(afterCreate).slice(0, 200))
      check.eq('#82：写回时旧字段 activeGroupId 原样保留（不抹掉别人的数据）', afterCreate?.activeGroupId, 'g-lab-one')
      const pillAfter = await (async () => {
        await openPillMenu(page)
        const items = await page.evaluate(() =>
          Array.from(document.querySelectorAll('[data-dshone-tree-pill-item]')).map((element) => element.getAttribute('data-dshone-tree-pill-item') ?? ''),
        )
        await page.keyboard.press('Escape')
        await page.waitForTimeout(150)
        return items
      })()
      check.ok('功能 1：新分组立刻出现在胶囊的下拉里', pillAfter.includes(created?.id ?? 'none'), pillAfter.join(','))

      // 归属：工作区行的**右键**菜单 →（#109 起「所属分组」改成）「分组…」二级菜单 →
      // 勾一个分组 → 归属写回状态存储。
      // #109 起工作区行不再有「…」按钮（hover 是四枚动作：＋/终端/在 VS Code 打开/从列表
      // 移除），菜单走右键；「分组…」是就地展开的二级菜单，点父项只展开、点子项才提交。
      const workspaceRow = page.locator('[data-dshone-tree-row="workspace"]').first()
      await workspaceRow.click({ button: 'right', position: { x: 60, y: 16 } })
      await page.waitForTimeout(300)
      check.ok('功能 1：工作区行右键弹出菜单（带标题行）', (await bodyText(page)).includes('工作区:'), (await bodyText(page)).slice(0, 120))
      await page.click('[data-dshone-tree-item="groups"]')
      await page.waitForTimeout(250)
      const menuText = await bodyText(page)
      check.ok('功能 1：工作区行菜单的「分组…」二级菜单里能看到新建的分组', created !== undefined && menuText.includes('Lab New'), menuText.slice(0, 160))
      await page.click(`[role="menuitem"]:has-text("Lab New")`)
      await page.waitForTimeout(300)
      const afterAssign = (await hostGroups(page)) as { membership?: Record<string, string[]> } | null
      const membership = afterAssign?.membership ?? {}
      check.ok(
        '功能 1：勾选后归属写回状态存储（该工作区记上新分组）',
        Object.values(membership).some((ids) => Array.isArray(ids) && ids.includes(created?.id ?? 'none')),
        JSON.stringify(membership).slice(0, 200),
      )
      // 再勾一次 = 移出（同一入口的开关语义）。
      await page.click(`[role="menuitem"]:has-text("Lab New")`)
      await page.waitForTimeout(300)
      const afterUnassign = (await hostGroups(page)) as { membership?: Record<string, string[]> } | null
      check.ok(
        '功能 1：再勾一次即移出该分组',
        !Object.values(afterUnassign?.membership ?? {}).some((ids) => Array.isArray(ids) && ids.includes(created?.id ?? 'none')),
        JSON.stringify(afterUnassign?.membership ?? {}).slice(0, 200),
      )
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)

      // ---- #82 视图态持久化：同上下文重载后过滤仍然生效 ----
      await pickPillItem(page, 'g-lab-two')
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.dshOneTree_projectRow', { timeout: 40_000 })
      await page.waitForTimeout(1_500)
      const afterReload = await page.evaluate(() => ({
        keys: Array.from(document.querySelectorAll('[data-dshone-tree-row="workspace"]')).map((el) => el.getAttribute('data-dshone-tree-key')),
        prefs: localStorage.getItem('dsh.workspaceTree.view'),
      }))
      check.ok(
        '#82 视图态：重载后过滤分组仍然生效（localStorage 官方惯例）',
        afterReload.keys.length === 1 && afterReload.keys[0] === keys[1],
        JSON.stringify(afterReload),
      )
      check.ok('视图态只存我们自己的一个键（没另起第二套）', (afterReload.prefs ?? '').includes('g-lab-two'), String(afterReload.prefs))

      check.eq('侧栏功能套件全程零 pageerror', withoutKnownNoise(capture.pageErrors).real, [])
      return screenshots
    } finally {
      await opened.context.close()
    }
  },
}

// ---------------------------------------------------------------------------
// F-09 HEADER-UTILITIES：对话区会话头 utilities 座位的条目集合（#87）
// ---------------------------------------------------------------------------

/**
 * 真实会话（页内要开一个会话，会话头与它的 utilities 座位才存在；数据来自真网关，
 * 只读——只判读会话摘要，不做任何写动作）。
 * 挑选口径：优先**没在跑、非空白**的最近一个带 cwd 的会话——跑着的会话会把整段
 * 流式内容渲进页面，让这一套件慢且不稳；cwd 是 open-in-app 按钮的渲染前提之一
 * （官方 `useSessions(state => state.byId[id]?.cwd)`）。
 */
async function pickSessionId(gateway: string): Promise<{ id: string; cwd: string; candidates: number } | null> {
  const sessions = await listSessions(gateway)
  const usable = sessions.filter((s) => typeof s.cwd === 'string' && s.cwd !== '')
  const idle = usable.filter((s) => !s.running && !s.blank)
  const picked = idle[0] ?? usable[0]
  if (picked === undefined) return null
  return { id: picked.sessionId, cwd: picked.cwd ?? '', candidates: usable.length }
}

export const HEADER_UTILITIES_SUITE: LabSuite = {
  id: 'F-09',
  phase: 'new-feature',
  name: '对话区会话头 utilities 座位的条目集合：官方 open-in-app 与自有导出都在且都可见（HEADER-UTILITIES 套件）',
  expect:
    'chat 树在**真实会话**下打开：`conversation.session.header.utilities` 座位里官方 `@deepseek-ai/dsh-client-ui-open-in-app` 的贡献在（DOM 有它的 split button，取 /open-in-app/icon/* 的应用图标）且**可见**（该条目矩形非 0、没有被 display:none 摘掉呈现）；自有 `@dsh-one/dsh-session-export` 的导出按钮同样在且可见；座位里没有任何一个条目被自有 CSS 摘掉呈现（#87 的缺席就是「该座位上一切非自有条目一律 display:none」造成的，这里按条目逐个盯住）；官方 `dsh-session-log-export` 的同 id 条目被本插件的 shadow（priority −1）顶掉、不再渲染（防止两个导出入口并存）。另：官方宿主路由（应用清单 `/open-in-app/apps`）在页面里可达——一条取官方内部基址 `http://dsh.internal`、一条取页面自身源，两条都要 200 且带应用清单（webview 里页面源不是网关，这类按 location.origin 寻址的裸 fetch 由页面传输接缝改写到 loopback）。',
  run: async (ctx, check) => {
    const picked = await pickSessionId(ctx.lab.gateway)
    if (picked === null) {
      check.ok('网关上有带 cwd 的会话可供打开（会话头才有 utilities 座位）', false, '真网关上没有带 cwd 的会话')
      return []
    }
    check.fact(`选中会话 ${picked.id}（cwd=${picked.cwd}，候选 ${String(picked.candidates)} 个）`)

    const opened = await openTreePage(ctx.browser, ctx.lab, route('chat'), {
      width: 1200,
      sessionId: picked.id,
      settleMs: 6_000,
    })
    const { page } = opened
    const screenshots: string[] = []
    try {
      const S = '[data-slot="conversation.session.header.utilities"]'
      const probe = await page.evaluate((slotSel: string) => {
        const slot = document.querySelector(slotSel)
        if (slot === null) return { present: false, entries: [] as unknown[] }
        // 一条贡献 = 座位的一个直属子元素（框架按条目挂载，见官方 outlet 的 renderSlot）。
        // 「可见」按几何判定：display:none / 祖先被摘 → 矩形为 0（#87 就是 display:none）。
        const entries = Array.from(slot.children).map((child) => {
          const rect = child.getBoundingClientRect()
          // 自有标记可能就挂在条目的根元素上（querySelectorAll 只查后代，故两个口径都算）。
          const ownMarkers = (child.matches('[data-dshone-export]') ? 1 : 0) + child.querySelectorAll('[data-dshone-export]').length
          return {
            tag: child.tagName.toLowerCase(),
            className: (child.getAttribute('class') ?? '').slice(0, 60),
            display: getComputedStyle(child).display,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            ariaLabel: child.querySelector('[aria-label]')?.getAttribute('aria-label') ?? '',
            openInAppIcons: child.querySelectorAll('img[src*="/open-in-app/icon/"]').length,
            exportMarkers: ownMarkers,
            officialExportButtons: child.querySelectorAll('[class*="_moreButton"]').length,
          }
        })
        const icon = slot.querySelector<HTMLImageElement>('img[src*="/open-in-app/icon/"]')
        return {
          present: true,
          entries,
          iconLoaded: icon !== null && icon.complete && icon.naturalWidth > 0,
          splitButton: slot.querySelectorAll('[class*="_split"]').length,
        }
      }, S)

      check.ok('chat 树会话头有 utilities 座位（真实会话下）', probe.present === true, S)
      if (probe.present !== true) return screenshots
      check.fact(`座位条目：${JSON.stringify(probe.entries)}`)

      const entries = probe.entries as Array<{
        display: string
        width: number
        height: number
        ariaLabel: string
        openInAppIcons: number
        exportMarkers: number
        officialExportButtons: number
      }>
      const openInApp = entries.filter((e) => e.openInAppIcons > 0)
      const ownExport = entries.filter((e) => e.exportMarkers > 0)
      const officialExport = entries.filter((e) => e.officialExportButtons > 0)
      const visible = entries.filter((e) => e.display !== 'none' && e.width > 0)

      check.eq('座位里官方 open-in-app 的贡献恰有一条（应用图标哨兵）', openInApp.length, 1)
      check.ok(
        'open-in-app 条目可见（矩形非 0，未被自有 CSS 摘掉）',
        openInApp[0] !== undefined && openInApp[0].display !== 'none' && openInApp[0].width > 0,
        JSON.stringify(openInApp[0] ?? null),
      )
      check.ok(
        'open-in-app 的应用图标真的取到了（/open-in-app/icon/* 已加载）',
        probe.iconLoaded === true,
        `iconLoaded=${String(probe.iconLoaded)} splitButton=${String(probe.splitButton)}`,
      )
      check.eq('座位里自有导出按钮恰有一条', ownExport.length, 1)
      check.ok(
        '自有导出按钮可见',
        ownExport[0] !== undefined && ownExport[0].display !== 'none' && ownExport[0].width > 0,
        JSON.stringify(ownExport[0] ?? null),
      )
      check.eq(
        '座位的每个条目都可见（没有任何条目被自有 CSS 摘掉——#87 的缺席形态）',
        entries.length - visible.length,
        0,
      )
      check.eq(
        '官方同 id 的导出条目被 shadow 顶掉、不再渲染（不留两个导出入口）',
        officialExport.length,
        0,
      )
      check.eq('chat 树：零 console error', opened.capture.consoleErrors, [])

      // 宿主路由可达（webview 形态的第二个根因）：官方 open-in-app 用裸 fetch 取
      // 应用清单，按 location.origin / 官方内部基址 http://dsh.internal 寻址。
      // 页面传输接缝把这两类「宿主寻址」URL 改写到 loopback —— 这里逐条实测。
      const origin = await page.evaluate(() => globalThis.location.origin)
      const routes = await page.evaluate(async () => {
        const read = async (label: string, url: string): Promise<{ label: string; url: string; status: number; apps: string[]; error?: string }> => {
          try {
            const res = await fetch(url, { headers: { accept: 'application/json' } })
            const payload = (await res.json()) as { apps?: unknown }
            return { label, url, status: res.status, apps: Array.isArray(payload.apps) ? (payload.apps as string[]) : [] }
          } catch (err) {
            return { label, url, status: 0, apps: [], error: String(err) }
          }
        }
        const internal = await read('internal', 'http://dsh.internal/open-in-app/apps')
        const sameOrigin =
          globalThis.location.origin.startsWith('http://') || globalThis.location.origin.startsWith('https://')
            ? await read('page-origin', `${globalThis.location.origin}/open-in-app/apps`)
            : undefined
        const requested = performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .filter((name) => name.includes('/open-in-app/apps'))
        return { internal, sameOrigin, requested }
      })
      check.fact(`宿主路由观测：origin=${origin} ${JSON.stringify(routes)}`)
      check.eq('官方内部基址（http://dsh.internal）读到应用清单：HTTP 200', routes.internal.status, 200)
      check.ok('官方内部基址返回的应用清单非空', routes.internal.apps.length > 0, JSON.stringify(routes.internal))
      if (routes.sameOrigin !== undefined) {
        check.eq('页面自身源的宿主路由读到应用清单：HTTP 200', routes.sameOrigin.status, 200)
      }
      check.ok(
        '两条宿主路由都落在 loopback（改写生效，不是打到页面自身的源）',
        routes.requested.length >= 2 &&
          routes.requested.every((url) => url.startsWith(`${ctx.lab.mirrorOrigin}/open-in-app/apps`)),
        JSON.stringify(routes.requested),
      )

      screenshots.push(await shot(ctx, page, 'header-utilities-chat'))
    } finally {
      await opened.context.close()
    }
    return screenshots
  },
}

// ---------------------------------------------------------------------------
// F-08 MULTIOPEN：会话多开通道（#72）——行菜单入口 + 多开 tab 的启动注入
// ---------------------------------------------------------------------------

/**
 * 展开分组直到页面上出现 `wanted` 条带行菜单的会话行，返回那组行。
 *
 * 只有非空白会话行才带行菜单（官方 SessionNodeItem：`!row.blank && (...)` 才渲染时间与
 * 行操作），多开入口同理——所以可点的行按「有 ⋯ 按钮」挑（#109 起空白会话行也有行操作
 * 容器，但它只为挂菜单，官方不给显式 ⋯）。树默认只展开当前会话所在分组，其余分组收起、
 * 里面一条会话行都不渲染，所以先展开几个分组（点分组头只是本地展开，不写网关）。
 */
async function expandUntilSessionRows(page: OpenedPage['page'], wanted: number): Promise<Locator> {
  const rows = page.locator('.dshOneTree_sessionRow').filter({ has: page.locator('[data-dshone-tree-action="session-menu"]') })
  const groupRows = page.locator('.dshOneTree_projectRow')
  const groupCount = await groupRows.count()
  for (let index = 0; index < groupCount && (await rows.count()) < wanted; index += 1) {
    const overflow = page.locator('.dshOneTree_sessionOverflowButton')
    if ((await overflow.count()) > 0) {
      await overflow.first().click()
      await page.waitForTimeout(200)
      continue
    }
    await groupRows.nth(index).click()
    await page.waitForTimeout(250)
  }
  return rows
}

/** 假宿主记录的多开请求（`session.openInNewTab` 带过来的会话 id）。 */
async function sessionTabsOpened(page: OpenedPage['page']): Promise<string[]> {
  return page.evaluate(() => {
    const host = (globalThis as { __LAB_HOST__?: { sessionTabsOpened?: string[] } }).__LAB_HOST__
    return host?.sessionTabsOpened ?? []
  })
}

/**
 * 官方 `Menu` 给菜单算落点的规则（#159）。源码出处：官方前端 bundle
 * `@deepseek-ai/dsh-web-frontend` 的 `dist/assets/index-<hash>.js`（本机 0.1.6-alpha.1
 * 是 `index-C04Zg7TP.js`，组件被压缩成 `function U6(...)`；在文件里搜 `getAnchorRect`
 * 就能落到那段 `useLayoutEffect` 上），逐字抄下来是这样：
 *
 * ```js
 * const ie = 12, ue = window.innerWidth, he = window.innerHeight,
 *       Q = F.current, le = Q?.offsetWidth ?? 0, X = Q?.offsetHeight ?? 0;
 * let E, V;
 * m === 'right' ? (E = K.right + 4, V = K.top)
 *   : p === 'start' ? (E = K.left, V = m === 'bottom' ? K.bottom + 4 : K.top - X - 4)
 *   : (E = K.right - le, V = m === 'bottom' ? K.bottom + 4 : K.top - X - 4);
 * le > 0 && (E = Math.min(Math.max(E, ie), ue - le - ie));
 * X > 0 && (V = Math.min(Math.max(V, ie), he - X - ie));
 * ```
 *
 * 说人话：先按锚点与方向算一个落点（`K` = 锚点矩形，`F` = 菜单面板，`le`/`X` = 面板的
 * `offsetWidth`/`offsetHeight`），**再整份钳进视口、四周各留 12px**——横向
 * `min(max(E, 12), 视口宽 − 菜单宽 − 12)`、纵向 `min(max(V, 12), 视口高 − 菜单高 − 12)`。
 * 我们的行右键菜单走的是 `align:"start"` + `side:"bottom"`（`rows.ts` 里没传这两个 prop，
 * 官方缺省值就是它俩），所以 `E = 指针 x`、`V = 指针 y + 4`。
 *
 * **官方只有钳位、没有翻转**：越界时菜单往回收，不会翻到锚点另一侧（#159 顺带核过，
 * 水平与垂直都是这一条，源码里也确实没有分支）。
 *
 * 这就是 #159 那条红的真因：判据原先只算 `指针 y + 4`，没建模钳位；锚点落在钳位线以下
 * （`指针 y + 4 > 视口高 − 菜单高 − 12`）时菜单顶其实是那条钳位线（实测：菜单 10 项
 * 紧凑档 `offsetHeight = 288px`，900px 高的视口钳位线 = 600，正是 #154 报告里那个数）。
 */
const MENU_VIEWPORT_MARGIN = 12
const MENU_ANCHOR_GAP = 4

/** 按上面那条官方规则算 portal 菜单的落点（`align:"start"` + `side:"bottom"`）。 */
function officialMenuPoint(
  anchor: { x: number; y: number },
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  let left = anchor.x
  let top = anchor.y + MENU_ANCHOR_GAP
  // 官方那两句 `le > 0 && …` / `X > 0 && …`：面板还没量到尺寸时（宽或高为 0）不钳。
  if (menu.width > 0) left = Math.min(Math.max(left, MENU_VIEWPORT_MARGIN), viewport.width - menu.width - MENU_VIEWPORT_MARGIN)
  if (menu.height > 0) top = Math.min(Math.max(top, MENU_VIEWPORT_MARGIN), viewport.height - menu.height - MENU_VIEWPORT_MARGIN)
  return { left: Math.round(left), top: Math.round(top) }
}

/**
 * 这一次右键的指针位置。为什么要单独记：官方拿它当锚点（我们传的 `getAnchorRect` 给回的
 * 零尺寸 `DOMRect`，坐标就是处理函数里的 `event.clientX/clientY`），而 `boundingBox()` 带
 * 小数、按行盒 + 偏移自己算会差 0~1px——想让锚点判据**精确判等**，输入端就得取同一个整数。
 */
const MENU_POINTER_KEY = '__dshOneLabContextMenuPointer'

/** 装一次捕获阶段的 `contextmenu` 监听，把指针位置记在页面上（每次右键都会覆盖）。 */
async function armMenuPointerCapture(page: OpenedPage['page']): Promise<void> {
  await page.evaluate((key) => {
    const store = globalThis as unknown as Record<string, unknown>
    store[key] = null
    document.addEventListener(
      'contextmenu',
      (event) => {
        store[key] = { x: event.clientX, y: event.clientY }
      },
      true,
    )
  }, MENU_POINTER_KEY)
}

/** 读最后一次右键的指针位置（没右键过就是 null）。 */
async function lastMenuPointer(page: OpenedPage['page']): Promise<{ x: number; y: number } | null> {
  return page.evaluate((key) => {
    const value = (globalThis as unknown as Record<string, unknown>)[key]
    return value == null ? null : (value as { x: number; y: number })
  }, MENU_POINTER_KEY)
}

/**
 * 菜单现状：我们自己那一项（按自有标记属性取，不认官方哈希类名）与整份菜单
 * 的项文案（核对原有三项没被挤掉）；另外带上判落点要用的事实——面板自己的矩形、
 * **面板的 `offsetWidth`/`offsetHeight`**（官方钳位用的就是这两个数，不是 `getBoundingClientRect`
 * 的宽高）与当页视口尺寸。
 */
async function menuFacts(page: OpenedPage['page']): Promise<{
  menus: number
  item: string
  allItems: string[]
  anchored: { left: number; top: number } | null
  size: { width: number; height: number } | null
  viewport: { width: number; height: number }
}> {
  return page.evaluate(() => {
    const lists = Array.from(document.querySelectorAll<HTMLElement>('[role="menu"]'))
    // 面板 = 官方 Menu portal 出去的那一份（直接挂在 body 下）。二级菜单是面板里的内联
    // 子树（`role="menu"` 也在它身上），不能在它上面量落点与尺寸——官方钳位用的也是面板。
    const panel = lists.find((element) => element.parentElement === document.body) ?? lists[lists.length - 1]
    const marks = Array.from(document.querySelectorAll('[data-dshone-tree-item]'))
    const mark = marks[marks.length - 1]
    const rect = panel?.getBoundingClientRect()
    return {
      menus: lists.length,
      item: mark?.textContent ?? '',
      allItems: panel === undefined ? [] : Array.from(panel.querySelectorAll('button[role="menuitem"]')).map((el) => el.textContent ?? ''),
      anchored: rect === undefined ? null : { left: Math.round(rect.left), top: Math.round(rect.top) },
      size: panel === undefined ? null : { width: panel.offsetWidth, height: panel.offsetHeight },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    }
  })
}

/** 官方钳位要用的输入：当前面板的 `offsetWidth`/`offsetHeight` 与当页视口尺寸。 */
async function menuPanelBox(
  page: OpenedPage['page'],
): Promise<{ size: { width: number; height: number } | null; viewport: { width: number; height: number } }> {
  return page.evaluate(() => {
    const panel = Array.from(document.querySelectorAll<HTMLElement>('[role="menu"]')).find((element) => element.parentElement === document.body) ?? null
    return {
      size: panel === null ? null : { width: panel.offsetWidth, height: panel.offsetHeight },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    }
  })
}

/** 等一条 boot-timing 日志（启动注入是异步的：等它出现，别用固定睡眠硬拍）。 */
async function waitForLog(opened: OpenedPage, needle: string, timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (opened.capture.all.some((line) => line.includes(needle))) return true
    await opened.page.waitForTimeout(250)
  }
  return false
}

/** 页面注入的启动会话 id（`__DSH_ONE_BOOT__.sessionId`）。 */
async function bootSessionIdOf(page: OpenedPage['page']): Promise<string | null> {
  return page.evaluate(() => {
    const value = (globalThis as { __DSH_ONE_BOOT__?: { sessionId?: unknown } }).__DSH_ONE_BOOT__
    return typeof value?.sessionId === 'string' ? value.sessionId : null
  })
}

export const MULTIOPEN_SUITE: LabSuite = {
  id: 'F-08',
  phase: 'new-feature',
  name: '会话多开：会话行菜单「在新标签页打开」+ 多开 tab 的启动注入（MULTIOPEN 套件）',
  expect:
    '侧栏树：会话行的 ⋯ 菜单里有「在新标签页打开」项（原有三项都在，每项都有文案），**行右键**弹出同一份菜单且菜单落点逐像素等于官方 `Menu` 自己的规则（锚在指针处 + 官方那套视口钳位，两种落点都判：900px 高的视口走「锚点 top + 4」，矮视口下走「视口高 − 菜单高 − 12」那条钳位线），Esc 关掉；点该项 → 页面经宿主能力口发出一次 `session.openInNewTab`，带的是**那一行**的真会话 id；点第二行得到第二个不同 id。chat 树：`?session=<id>` 的页面把该 id 注入 `__DSH_ONE_BOOT__` 并真的把它开成当前会话（boot-timing first-meta 等于该 id）；**同一个浏览器上下文（同一源、同一 localStorage，即真 VS Code 里多条 webview 的现场）里开第二个多开会话页**，两页各自开自己的会话、互不串；注入一个不存在的 id 时防闪帧遮罩在场（不闪官方空白态）。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    // 真网关的会话清单（只读）：核对「记录下来的 id 是真会话」，并挑注入用的 id。
    const sessions = await listSessions(ctx.lab.gateway)
    const knownIds = new Set(sessions.map((row) => row.sessionId))
    const targets = sessions.slice(0, 2).map((row) => row.sessionId)
    check.fact(`网关会话数=${String(sessions.length)}；注入用会话=${targets.map((id) => id.slice(0, 13)).join(', ')}`)
    if (targets.length < 2) {
      check.ok('网关至少有 2 个会话可供验证多开', false, `count=${String(sessions.length)}`)
      return screenshots
    }

    // ---------------------------------------------------------------------
    // 一、入口：⋯ 菜单与行右键
    // ---------------------------------------------------------------------
    const sidebar = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { width: 380, height: 900 })
    try {
      const rows = await expandUntilSessionRows(sidebar.page, 2)
      const groupCount = await sidebar.page.locator('.dshOneTree_projectRow').count()
      const rowCount = await rows.count()
      check.fact(
        `侧栏分组=${String(groupCount)} 会话行=${String(await contentCount(sidebar.page, '.dshOneTree_sessionRow'))}（其中带行菜单的=${String(rowCount)}）`,
      )
      check.ok('侧栏有 ≥2 条带行菜单的会话行', rowCount >= 2, `rows=${String(rowCount)}`)
      const row0 = rows.nth(0)
      const row1 = rows.nth(1)

      await row0.hover()
      await row0.locator('.dshOneTree_rowIconButton').click()
      await sidebar.page.waitForTimeout(300)
      const menu = await menuFacts(sidebar.page)
      check.fact(`⋯ 菜单：${JSON.stringify(menu)}`)
      check.ok('⋯ 菜单弹出且带「在新标签页打开」项', menu.menus === 1 && menu.item.trim() !== '', JSON.stringify(menu))
      // #103 起行菜单多一项「移入回收站」（与「归档会话」分开的两层语义）：五项都有
      // 文案才算原三项没被挤掉。
      check.ok(
        // #102/#103 起菜单里多了「置顶」「标为未读」「移入回收站」几项，所以这里不再钉死项数，
        // 改成「原有几项都还在且每一项都有文案」——钉死会让共享热点上每加一项都要改这里。
        '原有五项都还在且每项都有文案（重命名 / 分叉 / 在新标签页打开 / 移入回收站 / 归档）',
        menu.allItems.every((label) => label.trim() !== '') &&
          ['重命名', '分叉会话', '在新标签页打开', '移入回收站', '归档会话'].every((label) =>
            menu.allItems.some((text) => text.includes(label)),
          ),
        JSON.stringify(menu.allItems),
      )
      screenshots.push(await shot(ctx, sidebar.page, 'multiopen-menu'))

      await sidebar.page.click('[data-dshone-tree-item="openInNewTab"]')
      await sidebar.page.waitForTimeout(500)
      const openedFirst = await sessionTabsOpened(sidebar.page)
      check.fact(`⋯ 菜单点「在新标签页打开」后宿主收到=${JSON.stringify(openedFirst)}`)
      check.eq('点菜单项 → 宿主收到一次多开请求', openedFirst.length, 1)
      check.ok('多开请求带的是真会话 id', openedFirst.length === 1 && knownIds.has(openedFirst[0] ?? ''), openedFirst.join(','))
      check.eq('菜单收起（点完不留浮层）', (await menuFacts(sidebar.page)).menus, 0)

      // --- 行右键：同一份菜单、锚在指针处 ---
      const box = await row1.boundingBox()
      check.ok('第二行取到几何（右键落点已知）', box !== null, JSON.stringify(box))
      if (box !== null) {
        const at = { x: 90, y: Math.round(box.height / 2) }
        await armMenuPointerCapture(sidebar.page)
        await row1.click({ button: 'right', position: at })
        await sidebar.page.waitForTimeout(300)
        const contextMenu = await menuFacts(sidebar.page)
        const pointer = await lastMenuPointer(sidebar.page)
        const expected =
          pointer === null || contextMenu.size === null
            ? null
            : officialMenuPoint(pointer, contextMenu.size, contextMenu.viewport)
        check.fact(
          `行右键菜单：${JSON.stringify(contextMenu)} 指针=${JSON.stringify(pointer)}` +
            ` 期望锚点=${JSON.stringify(expected)}（官方钳位线=视口高 ${String(contextMenu.viewport.height)} − 菜单高 ${String(contextMenu.size?.height)} − 12）`,
        )
        check.ok('行右键弹出同一份菜单（带多开项）', contextMenu.menus === 1 && contextMenu.item.trim() !== '', JSON.stringify(contextMenu))
        check.ok(
          '这一次右键的指针与菜单几何都取到了（锚点判据的输入端）',
          pointer !== null && expected !== null,
          `pointer=${JSON.stringify(pointer)} size=${JSON.stringify(contextMenu.size)}`,
        )
        check.eq(
          '右键菜单锚在指针处（官方 Menu 的 getAnchorRect + 官方自己的视口钳位）',
          contextMenu.anchored,
          expected,
        )
        screenshots.push(await shot(ctx, sidebar.page, 'multiopen-rightclick'))

        await sidebar.page.keyboard.press('Escape')
        await sidebar.page.waitForTimeout(300)
        check.eq('Esc 关掉行右键菜单', (await menuFacts(sidebar.page)).menus, 0)

        // 第二行右键 → 多开：得到第二个不同 id（每行认自己的会话）
        await row1.click({ button: 'right', position: at })
        await sidebar.page.waitForTimeout(250)
        await sidebar.page.click('[data-dshone-tree-item="openInNewTab"]')
        await sidebar.page.waitForTimeout(500)
        const openedSecond = await sessionTabsOpened(sidebar.page)
        check.fact(`两行各点多开后宿主收到的全部请求=${JSON.stringify(openedSecond)}`)
        check.eq('两次操作共两次多开请求', openedSecond.length, 2)
        check.ok('两次开的是两个不同会话', openedSecond.length === 2 && openedSecond[0] !== openedSecond[1], JSON.stringify(openedSecond))
        check.ok('两次开的都是真会话', openedSecond.every((id) => knownIds.has(id)), JSON.stringify(openedSecond))
      }
      check.eq('多开入口全程零 console error', sidebar.capture.consoleErrors, [])
    } finally {
      await sidebar.context.close()
    }

    // ---------------------------------------------------------------------
    // 一之二、矮视口：同一条锚点判据的**钳位那一支**
    // ---------------------------------------------------------------------
    // 上面那一档（900px 高）走的是「锚点 top + 4」那一支——今天的行落点在钳位线
    // （900 − 菜单高 288 − 12 = 600）以上。#159 报的那条红正是另一支：行排得靠下、落点越过
    // 钳位线，菜单被往上钳（#154 实测 668 → 600）。这一档把视口压矮，让**两支都被判过**——
    // 否则模型里那条 `Math.min` 又只会在「当天数据恰好不越线」时没人走，与 #159 之前一样。
    //
    // 指针位置是这一档**唯一要控制**的东西：官方 `Menu` 只认指针坐标（我们的处理函数读
    // `event.clientX/clientY`），行落在哪儿则看当天数据——今天这个 480px 高的视口里行落在
    // y≈88、钳位线却在 180，照着真实指针点反而走不到钳位那一支。所以这里派发一次锚点在低位
    // 的右键（落点 474 必然越过钳位线 180）：考的是「给官方一个靠下的锚点，菜单落点对不对」，
    // 与行自身的高度无关，因此不被当天数据牵着走。
    const SHORT_VIEWPORT_HEIGHT = 480
    const SHORT_POINTER = { x: 90, y: 470 }
    const short = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), {
      width: 380,
      height: SHORT_VIEWPORT_HEIGHT,
    })
    try {
      const shortRows = await expandUntilSessionRows(short.page, 1)
      const shortRow = shortRows.nth(0)
      check.ok('矮视口：取到要右键的会话行', (await shortRow.count()) === 1, `rows=${String(await shortRows.count())}`)
      await armMenuPointerCapture(short.page)
      // 用 `evaluate` 里手搓的 `MouseEvent` 派发（`locator.dispatchEvent` 对 `contextmenu`
      // 这类不在它白名单里的类型会造一个通用 Event，`clientX/clientY` 会丢）。
      await shortRow.evaluate((row, pointer) => {
        row.dispatchEvent(
          new MouseEvent('contextmenu', {
            clientX: pointer.x,
            clientY: pointer.y,
            button: 2,
            bubbles: true,
            cancelable: true,
          }),
        )
      }, SHORT_POINTER)
      await short.page.waitForTimeout(300)
      const shortMenu = await menuFacts(short.page)
      const shortPointer = await lastMenuPointer(short.page)
      const line = shortMenu.size === null ? null : shortMenu.viewport.height - shortMenu.size.height - MENU_VIEWPORT_MARGIN
      const shortExpected =
        shortPointer === null || shortMenu.size === null
          ? null
          : officialMenuPoint(shortPointer, shortMenu.size, shortMenu.viewport)
      check.fact(
        `矮视口行右键菜单：${JSON.stringify(shortMenu)} 指针=${JSON.stringify(shortPointer)}` +
          ` 期望锚点=${JSON.stringify(shortExpected)}（官方钳位线=${String(line)}）`,
      )
      check.ok(
        '矮视口：这次落点确实在钳位线以下（这一档考的就是钳位那一支）',
        shortPointer !== null && line !== null && shortExpected !== null && shortPointer.y + MENU_ANCHOR_GAP > line,
        `指针 y=${String(shortPointer?.y)} 钳位线=${String(line)}`,
      )
      check.eq('矮视口下菜单顶就落在官方钳位线上（= 视口高 − 菜单高 − 12）', shortMenu.anchored?.top, line)
      check.eq('矮视口下菜单落点仍逐像素等于官方规则（钳位算进去之后精确判等）', shortMenu.anchored, shortExpected)
      screenshots.push(await shot(ctx, short.page, 'multiopen-rightclick-short-viewport'))
    } finally {
      await short.context.close()
    }

    // ---------------------------------------------------------------------
    // 二、多开 tab 的启动注入：同一源（共 localStorage）两页，各开自己的会话
    // ---------------------------------------------------------------------
    const first = await openTreePage(ctx.browser, ctx.lab, route('chat'), { width: 1200, sessionId: targets[0] })
    let second: OpenedPage | undefined
    try {
      check.ok('第一个多开会话页起来了', first.ready)
      await waitForLog(first, 'boot-timing first-meta')
      check.eq('多开页 1：__DSH_ONE_BOOT__.sessionId = 目标会话', await bootSessionIdOf(first.page), targets[0])
      check.ok(
        '多开页 1：目标会话真被打开（boot-timing first-meta）',
        first.capture.all.some((line) => line.includes('boot-timing first-meta') && line.includes(targets[0].slice(0, 13))),
        first.capture.all.filter((line) => line.includes('boot-timing')).join(' | '),
      )
      screenshots.push(await shot(ctx, first.page, 'multiopen-tab-1'))

      // 同一上下文（同源、同 localStorage）再开一个：真 VS Code 里多 webview 的现场。
      second = await openTreePageAlongside(first, ctx.lab, route('chat'), { sessionId: targets[1] })
      check.ok('第二个多开会话页起来了（与第一个同源）', second.ready)
      await waitForLog(second, 'boot-timing first-meta')
      check.eq('多开页 2：__DSH_ONE_BOOT__.sessionId = 另一个会话', await bootSessionIdOf(second.page), targets[1])
      check.ok(
        '多开页 2：在共享 localStorage 下仍落到自己的会话（注入胜过恢复键）',
        second.capture.all.some((line) => line.includes('boot-timing first-meta') && line.includes(targets[1].slice(0, 13))),
        second.capture.all.filter((line) => line.includes('boot-timing')).join(' | '),
      )
      // 互不串：任一侧的控制台都不该出现另一侧的会话 id
      const firstLog = first.capture.all.filter((line) => line.includes(targets[1].slice(0, 13)))
      const secondLog = second.capture.all.filter((line) => line.includes(targets[0].slice(0, 13)))
      check.fact(`多开页 1 提到页 2 会话的日志=${JSON.stringify(firstLog)}；页 2 提到页 1 会话的日志=${JSON.stringify(secondLog)}`)
      check.eq('多开页 1 没被第二个页带走（零交叉日志）', firstLog, [])
      check.eq('多开页 2 没被恢复键带到第一个会话（零交叉日志）', secondLog, [])
      check.eq('两个多开页各自零 pageerror', [...withoutKnownNoise(first.capture.pageErrors).real, ...withoutKnownNoise(second.capture.pageErrors).real], [])
      const secondLogs = (second.capture.all.filter((line) => line.includes('boot-timing')).join(' | '))
      check.ok(
        '多开页 2 的启动轨迹是它自己的（first-meta = 它，页 1 的 id 只可能作为恢复值出现）',
        secondLogs.includes(targets[1].slice(0, 13)),
        secondLogs,
      )
      screenshots.push(await shot(ctx, second.page, 'multiopen-tab-2'))
    } finally {
      await second?.page.close()
      await first.context.close()
    }

    // ---------------------------------------------------------------------
    // 三、注入一个不存在的会话：防闪帧遮罩在场（不闪官方空白态）
    // ---------------------------------------------------------------------
    const ghost = 'session-lab-missing-000'
    const opened = await openTreePage(ctx.browser, ctx.lab, route('chat'), { width: 1200, sessionId: ghost })
    try {
      const mask = await contentCount(opened.page, '[data-opening-mask]')
      check.fact(`不存在会话的注入：boot=${JSON.stringify(await bootSessionIdOf(opened.page))} 遮罩=${String(mask)} consoleError=${JSON.stringify(opened.capture.consoleErrors.slice(0, 2))}`)
      check.eq('不存在的会话 id 照原样注入（注入通道不替页面判断存在性）', await bootSessionIdOf(opened.page), ghost)
      check.ok('目标会话没到位时防闪帧遮罩在场', mask === 1, `mask=${String(mask)}`)
      screenshots.push(await shot(ctx, opened.page, 'multiopen-opening-mask'))
    } finally {
      await opened.context.close()
    }

    return screenshots
  },
}

// ---------------------------------------------------------------------------
// F-12 SIDEBAR-SKELETON：侧栏骨架四区（#99）
// ---------------------------------------------------------------------------

/**
 * 侧栏骨架（#99 B 段）的四区断言：自绘顶栏（官方搜索栏 + 折叠展开全部 + 添加工作区两项
 * 菜单 + 设置齿轮）、单胶囊分组条、底部回收站入口行（官方 `sidebar.footer.action` 座位，
 * 与官方 cordis-panel 并存）、底部设置行隐藏。搜索栏按 **#132** 的新口径测**两态**：
 * 初始是收起态（一枚 28px 放大镜），点开才展开成官方展开态（30px / 10px 圆角），
 * Esc 收起并清空——两态各自的断言都在下面，不留「只看一态」的空档。
 *
 * 数据面仍旧是真实网关只读 + 假宿主；分组状态注入到假宿主的状态存储里（与 F-07 同
 * 一套做法），这样单胶囊的下拉与管理对话框有确定的内容可断言。
 */
export const SKELETON_SUITE: LabSuite = {
  id: 'F-12',
  phase: 'new-feature',
  name: '侧栏骨架四区（#99 立、#135 起顶栏那一行是「胶囊 + 四项」）：官方搜索栏两态 + 单胶囊分组条 + 底部回收站入口行（SIDEBAR-SKELETON 套件）',
  expect:
    '#99 定的四区骨架在真实装配页上成立：① 顶栏那一行（#135 起**五行并一行**：行首是分组过滤胶囊，右边依次是搜索栏、折叠展开全部、添加工作区、设置齿轮）——搜索栏 #132 起是**两态**（初始收起态 28px 圆胶囊 + 放大镜、点开后展开态 30px 高 / 10px 圆角 / .5px 实线边框且有输入框与清除钮，Esc 收起并清空）、四枚工具控件都在，胶囊与它们**同在这一行里**（几何关系由 F-39 判），且折叠全部真的收起整棵树；② 添加工作区是两项菜单（选已有文件夹 / 创建新工作区目录），第二项经宿主能力口发出 `vscode.workspaceCreate`；③ 设置齿轮经宿主能力口发出 `vscode.openSettings`（假宿主只记录，真宿主开设置页），同时官方 `sidebar.settings` 那一行不再渲染；④ 分组过滤条是单胶囊 + 成员计数 + ▾（#135 起它住在顶栏那一行里、不在列表区），下拉含「全部工作区 / 各组 / 新建分组… / 管理分组…」，管理分组对话框列出全部组；⑤ 回收站入口行在官方 `sidebar.footer.action` 座位里、与官方 cordis-panel 条目并存、不在自有浏览区 DOM 内，点它开现有抽屉。全程零 pageerror。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const groupsState = {
      version: 1,
      groups: [
        { id: 'g-lab-one', name: 'Lab One' },
        { id: 'g-lab-two', name: 'Lab Two' },
      ],
      membership: {},
      activeGroupId: null,
    }
    const opened = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), {
      width: 380,
      height: 900,
      state: { groups: groupsState },
    })
    const { page } = opened
    try {
      // 密度档先对齐到官方兜底值（与 F-04 同一处置）：搜索栏 / 图标按钮这些骨架件在 VS Code
      // 档下比官方档紧，而「搜索栏是不是官方那套几何」要按官方档量——把树自己声明的官方兜底值
      // 内联回 frame，页面就回到「没人给偏好」的状态。（#134 起**行家族**两个档同值，本套件
      // 不量行几何，所以这一处对齐只管骨架件。）
      const densityFix = await page.evaluate(() => {
        const treeCss =
          Array.from(document.querySelectorAll('style[data-plugin]'))
            .find((element) => element.getAttribute('data-plugin') === '@dsh-one/dsh-workspace-tree')
            ?.textContent ?? ''
        const fallbacks = Array.from(treeCss.matchAll(/var\(--dsh-one-density-([a-z-]+),\s*([^)]+)\)/g))
        const frame = document.querySelector('[class*="dshOneSidebarShell_frame"]')
        if (frame === null) return 0
        for (const match of fallbacks) frame.setAttribute('style', `${frame.getAttribute('style') ?? ''};--dsh-one-density-${match[1] ?? ''}:${(match[2] ?? '').trim()}`)
        return fallbacks.length
      })
      check.fact(`密度档兜底值回填项数=${String(densityFix)}（与 F-04 同一口径：先把 VS Code 档对齐到官方档再量几何）`)
      await page.waitForTimeout(200)

      // ---- ① 顶栏一行四件 ----
      // 搜索栏是**两态**的（#132：平时一枚放大镜，点开才展开成输入框），所以这里两态各
      // 量一遍：收起态按官方折叠态那一支（28px 圆胶囊、无边框、输入框与清除钮不在场），
      // 展开态按官方展开态那一支（30px 高 / 10px 圆角 / .5px 实线边框、输入框 + 清除钮）。
      const readBar = async (): Promise<{
        actions: { collapseAll: boolean; addWorkspace: boolean; settings: boolean; viewOptions: boolean }
        search: {
          state: string
          height: string
          radius: string
          borderWidth: string
          borderStyle: string
          inputPresent: boolean
          clearPresent: boolean
          ariaExpanded: string
          placeholder: string
          opacity: string
          tabIndex: number
        }
      } | null> =>
        page.evaluate(() => {
          const row = document.querySelector('[data-dshone-tree="top-bar"]')
          if (row === null) return null
          const action = (name: string): boolean => row.querySelector(`[data-dshone-tree-action="${name}"]`) !== null
          const input = row.querySelector<HTMLInputElement>('[data-dshone-tree="search-input"]')
          const searchBox = row.querySelector('[data-dshone-tree="search-box"]')
          const searchStyle = searchBox === null ? null : getComputedStyle(searchBox)
          const inputStyle = input === null ? null : getComputedStyle(input)
          return {
            actions: {
              collapseAll: action('collapse-all'),
              addWorkspace: action('add-workspace'),
              settings: action('settings'),
            /** #131：视图选项那一枚退役了，顶栏这一行只剩四件。 */
            viewOptions: action('view-options'),
            },
            search: {
              state: searchBox?.getAttribute('data-dshone-tree-state') ?? '',
              height: searchStyle?.height ?? '',
              radius: searchStyle?.borderRadius ?? '',
              borderWidth: searchStyle?.borderTopWidth ?? '',
              borderStyle: searchStyle?.borderTopStyle ?? '',
              inputPresent: input !== null,
              clearPresent: row.querySelector('[data-dshone-tree="search-clear"]') !== null,
              ariaExpanded: row.querySelector('[data-dshone-tree-action="search"]')?.getAttribute('aria-expanded') ?? '',
              placeholder: input?.placeholder ?? '',
              opacity: inputStyle?.opacity ?? '',
              tabIndex: input?.tabIndex ?? -1,
            },
          }
        })
      const bar = await readBar()
      check.ok('顶栏一行在（自绘 .dshOneTree_sectionHeader）', bar !== null)
      check.fact(`顶栏四件：${JSON.stringify(bar?.actions)} 搜索（初始）=${JSON.stringify(bar?.search)}`)
      check.ok('顶栏：折叠/展开全部在', bar?.actions.collapseAll === true)
      check.ok('顶栏：添加工作区（＋）在', bar?.actions.addWorkspace === true)
      check.ok('顶栏：设置齿轮在', bar?.actions.settings === true)
      // #131 的正向断言：那一行只剩四件——视图选项那一枚（含它后面的分组方式 / 排序方式两节）
      // 已退役，标记在整页都不该存在（完整的三条退役断言在 F-33）。
      check.ok(
        '顶栏：视图选项入口不在（#131 退役，顶栏只剩搜索栏 + 折叠全部 + 添加工作区 + 设置齿轮 + 多选）',
        bar?.actions.viewOptions === false,
        JSON.stringify(bar?.actions),
      )
      // #132：初始态是**收起态**——官方折叠态那一支（放大镜在场、输入框与清除钮不在场）。
      check.eq(
        '搜索栏初始是收起态（放大镜在场、输入框与清除钮不在场、aria-expanded=false）',
        [bar?.search.state, bar?.search.inputPresent, bar?.search.clearPresent, bar?.search.ariaExpanded],
        ['collapsed', false, false, 'false'],
      )
      check.ok(
        '收起态几何 = 官方折叠态那一支（28px 高、圆胶囊、无边框）',
        bar?.search.height === '28px' && bar?.search.radius === '50%' && bar?.search.borderWidth === '0px',
        JSON.stringify(bar?.search),
      )
      // 点开才展开成输入框。
      await page.click('[data-dshone-tree-action="search"]')
      await page.waitForTimeout(250)
      const barExpanded = await readBar()
      check.fact(`搜索（点开后）=${JSON.stringify(barExpanded?.search)}`)
      check.eq(
        '点放大镜后是展开态（输入框与清除钮都在场、aria-expanded=true）',
        [barExpanded?.search.state, barExpanded?.search.inputPresent, barExpanded?.search.clearPresent, barExpanded?.search.ariaExpanded],
        ['expanded', true, true, 'true'],
      )
      check.ok(
        '展开态几何 = 官方展开态那一支（30px 高 / 10px 圆角 / token 实线边框）',
        barExpanded?.search.height === '30px' &&
          barExpanded?.search.radius === '10px' &&
          barExpanded?.search.borderStyle === 'solid' &&
          barExpanded?.search.borderWidth !== '0px',
        JSON.stringify(barExpanded?.search),
      )
      check.ok(
        '展开态输入框可输入（opacity 1、进得了 Tab 序）',
        barExpanded?.search.opacity === '1' && barExpanded?.search.tabIndex === 0,
        JSON.stringify(barExpanded?.search),
      )
      check.ok('搜索框用官方词典的占位文案', (barExpanded?.search.placeholder ?? '').includes('搜索会话'), String(barExpanded?.search.placeholder))

      // 搜索走官方 `sessions.search`（结果区文案也是官方那套键）：敲一个几乎不可能
      // 命中的串，官方路径必然给出「无匹配 / 内容搜索不可用」之一。
      await page.fill('[data-dshone-tree="search-input"]', 'zzz-lab-no-such-session-zzz')
      // 等的是**官方 RPC 的最终结论**，不是固定的一段时长：搜索打真实网关，延迟随语料
      // 与机器负载变（整轮跑时前面十几套件刚把网关轮过一遍，实测有「等 900ms 仍停在
      // 「正在搜索会话历史…」」的情况——那时读到的是中间态，断言会假红）。所以轮询到
      // 中间态过去为止，6 秒兜底；判据仍是最终文案（超时也照旧判）。
      const readSearchState = async (): Promise<{ results: number; status: string }> =>
        page.evaluate(() => ({
          results: document.querySelectorAll('[data-dshone-tree="search"] [data-dshone-tree-row]').length,
          status: document.querySelector('.dshOneTree_searchStatus')?.textContent ?? '',
        }))
      const searchDeadline = Date.now() + 6000
      let searchState = await readSearchState()
      while (searchState.status.includes('正在搜索') && Date.now() < searchDeadline) {
        await page.waitForTimeout(250)
        searchState = await readSearchState()
      }
      check.fact(`搜索态：结果行=${String(searchState.results)} 状态文案=${JSON.stringify(searchState.status)}`)
      check.ok(
        '搜索走官方那套结果/降级文案（无匹配 · 内容搜索不可用）',
        searchState.results === 0 && (searchState.status.includes('无匹配') || searchState.status.includes('内容搜索')),
        JSON.stringify(searchState),
      )
      // #132：Esc 这一路 = 收起 + 清空（两件事都要有断言——只收起不清空会留着结果区）。
      await page.keyboard.press('Escape')
      await page.waitForTimeout(250)
      const barAfterEsc = await readBar()
      check.eq(
        'Esc 收起搜索（回到放大镜、输入框与清除钮不在场）',
        [barAfterEsc?.search.state, barAfterEsc?.search.inputPresent, barAfterEsc?.search.clearPresent],
        ['collapsed', false, false],
      )
      check.eq('Esc 清空搜索并回到树', await contentCount(page, '[data-dshone-group-key]') > 0, true)

      // ---- ② 添加工作区：两项菜单 + 主动创建走宿主能力口 ----
      await page.click('[data-dshone-tree-action="add-workspace"]')
      await page.waitForTimeout(250)
      const addItems = await page.evaluate(() => ({
        pick: document.querySelector('[data-dshone-tree-item="workspace-pick"]') !== null,
        create: document.querySelector('[data-dshone-tree-item="workspace-create"]') !== null,
        text: document.querySelector('[data-dshone-tree-item="workspace-pick"]')?.textContent ?? '',
      }))
      check.ok('添加工作区是两项菜单（选已有文件夹 / 创建新工作区目录）', addItems.pick && addItems.create, JSON.stringify(addItems))
      check.ok('菜单项文案是「选择已有文件夹…」', addItems.text.includes('选择已有文件夹'), addItems.text)
      await page.click('[data-dshone-tree-item="workspace-create"]')
      await page.waitForTimeout(400)
      const createCalls = await page.evaluate(() => {
        const host = (globalThis as unknown as { __LAB_HOST__?: { workspaceCreateCalls: unknown[] } }).__LAB_HOST__
        return host?.workspaceCreateCalls.length ?? -1
      })
      check.eq('「创建新工作区目录」经宿主能力口发出（vscode.workspaceCreate）', createCalls, 1)

      // ---- ③ 设置齿轮经能力口开设置页；底部设置行不再渲染 ----
      await page.click('[data-dshone-tree-action="settings"]')
      await page.waitForTimeout(300)
      const settingsFacts = await page.evaluate(() => {
        const host = (globalThis as unknown as { __LAB_HOST__?: { settingsOpened: unknown[] } }).__LAB_HOST__
        const row = document.querySelector('[data-slot="sidebar.settings"]')
        const buttons = row === null ? 0 : row.querySelectorAll('button').length
        const text = row?.textContent ?? ''
        return { opened: host?.settingsOpened.length ?? -1, buttons, text }
      })
      check.eq('设置齿轮经宿主能力口开设置页（vscode.openSettings）', settingsFacts.opened, 1)
      check.ok(
        '底部设置行不再渲染（官方 sidebar.settings 里没有按钮/文案）',
        settingsFacts.buttons === 0 && settingsFacts.text.trim() === '',
        JSON.stringify(settingsFacts),
      )

      // ---- ④ 单胶囊分组条（#135 起它是顶栏那一行的行首）----
      const pill = await page.evaluate(() => {
        const anchor = document.querySelector('[data-dshone-tree-action="group-pill"]')
        const row = document.querySelector('[data-dshone-tree="top-bar"]')
        const filter = document.querySelector('.dshOneTree_filterBar')
        return {
          found: anchor !== null,
          label: anchor?.textContent ?? '',
          count: anchor?.getAttribute('data-dshone-tree-group-count') ?? '',
          active: anchor?.getAttribute('data-dshone-tree-group') ?? '',
          chips: document.querySelectorAll('[data-dshone-tree-chip]').length,
          // #135：胶囊与那一行是同一行——它整个落在顶栏那一行的盒子里（几何关系见 F-39）。
          inTopBar: row !== null && filter !== null && row.contains(filter),
          inListArea: document.querySelector('.dshOneTree_listArea .dshOneTree_filterBar') !== null,
        }
      })
      check.ok(
        '分组过滤条在顶栏那一行里（#135：不再自己在列表区占一行）',
        pill.inTopBar && !pill.inListArea,
        JSON.stringify({ inTopBar: pill.inTopBar, inListArea: pill.inListArea }),
      )
      check.ok('分组过滤条是一枚胶囊（旧的那排 chip 已不在）', pill.found && pill.chips === 0, JSON.stringify(pill))
      check.ok('胶囊带成员计数与「全部工作区」初值', pill.label.includes('全部工作区') && Number(pill.count) > 0 && pill.active === 'all', JSON.stringify(pill))
      await openPillMenu(page)
      const pillItems = await page.evaluate(() => ({
        all: document.querySelector('[data-dshone-tree-pill-item="all"]') !== null,
        groups: Array.from(document.querySelectorAll('[data-dshone-tree-pill-item]')).filter((element) =>
          (element.getAttribute('data-dshone-tree-pill-item') ?? '').startsWith('g-lab-'),
        ).length,
        newGroup: document.querySelector('[data-dshone-tree-action="group-new"]') !== null,
        manage: document.querySelector('[data-dshone-tree-action="group-manage"]') !== null,
        counts: Array.from(document.querySelectorAll('.dshOneTree_menuRowCount')).map((element) => element.textContent ?? ''),
      }))
      check.ok(
        '胶囊下拉含「全部工作区 / 各组 / 新建分组… / 管理分组…」四类',
        pillItems.all && pillItems.groups === 2 && pillItems.newGroup && pillItems.manage,
        JSON.stringify(pillItems),
      )
      screenshots.push(await shot(ctx, page, 'skeleton-group-pill'))
      // 管理分组对话框列出全部组（行上有 data-dshone-manage-group）。
      await page.click('[data-dshone-tree-action="group-manage"]')
      await page.waitForTimeout(300)
      const manage = await page.evaluate(() => ({
        rows: Array.from(document.querySelectorAll('[data-dshone-manage-group]')).map((element) => element.getAttribute('data-dshone-manage-group') ?? ''),
        hasCreate: document.querySelector('[data-dshone-tree="group-manage-input"]') !== null,
      }))
      check.ok('「管理分组…」对话框列出全部组 + 一行建新组', manage.rows.length === 2 && manage.hasCreate, JSON.stringify(manage))
      screenshots.push(await shot(ctx, page, 'skeleton-manage-groups'))
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)

      // ---- ⑤ 折叠/展开全部 ----
      const expandedCount = async (): Promise<number> =>
        page.evaluate(() => document.querySelectorAll('[data-dshone-tree-row="workspace"][aria-expanded="true"]').length)
      await page.click('[data-dshone-tree-action="collapse-all"]')
      await page.waitForTimeout(300)
      const collapsed = await expandedCount()
      const collapseState = await page.getAttribute('[data-dshone-tree-action="collapse-all"]', 'data-dshone-tree-collapsed')
      check.eq('折叠全部：所有工作区行都收起', collapsed, 0)
      check.eq('折叠态下按钮翻成「展开全部」', collapseState, 'true')
      await page.click('[data-dshone-tree-action="collapse-all"]')
      await page.waitForTimeout(300)
      const reExpanded = await expandedCount()
      check.ok('再点一次 = 展开全部（所有有会话的工作区重新展开）', reExpanded > 0, `expanded=${String(reExpanded)}`)

      // ---- ⑥ 底部回收站入口行（官方 sidebar.footer.action 座位） ----
      const entry = await page.evaluate(() => {
        const slot = document.querySelector('[data-slot="sidebar.footer.action"]')
        const row = document.querySelector('[data-dshone-tree="recycle-entry"]')
        return {
          slotFound: slot !== null,
          inSlot: slot !== null && row !== null && slot.contains(row),
          insideBrowseArea: document.querySelector('[data-dshone-tree="root"] [data-dshone-tree="recycle-entry"]') !== null,
          rowFound: row !== null,
          label: row?.querySelector('.dshOneTree_footerLabel')?.textContent ?? '',
          count: row?.querySelector('.dshOneTree_footerCount')?.textContent ?? '',
          actions: Array.from(row?.querySelectorAll('[data-dshone-tree-action]') ?? []).map(
            (element) => element.getAttribute('data-dshone-tree-action') ?? '',
          ),
        }
      })
      check.ok('底部回收站入口行在官方 sidebar.footer.action 座位里', entry.slotFound && entry.rowFound && entry.inSlot, JSON.stringify(entry))
      check.ok('它不在自有浏览区 DOM 里（确实从顶栏搬走了）', entry.insideBrowseArea === false)
      // 与官方条目并存：官方那条 `cordis-panel` 属于 ui-cordis 插件，它在**没有动态
      // 插件时渲染 null**（官方 CordisPanel 的 `if (all.length === 0) return null`），
      // 所以「槽里有几条 DOM」量不出并存——能实测的是「我们没有顶掉它的角色」：
      // 官方 ui-cordis 仍在这棵树的 combo 里（它照常注册那个 list 条目），我们也只是
      // 往同一个 list 槽再注册一条自有 id 的条目。
      const combos = await combosRequested(page)
      const sidebarCombo = combos.find((url) => url.includes('@dsh-one/vscode-sidebar-shell/client.js'))
      check.ok(
        '座位里与官方条目并存（官方 ui-cordis 仍在这棵树的清单里，我们只往 list 槽加了一条自有 id 的条目）',
        sidebarCombo !== undefined && sidebarCombo.includes('@deepseek-ai/dsh-client-ui-cordis/client.js'),
        `combo=${String(sidebarCombo?.slice(0, 120))}`,
      )
      check.ok('入口行形态：🗑 + 文案 + 计数', entry.label.includes('回收站') && Number(entry.count) >= 0, JSON.stringify(entry))
      check.ok(
        '入口行右侧两枚动作图标在（清空 / 恢复全部）',
        entry.actions.includes('recycle-empty-all') && entry.actions.includes('recycle-restore-all'),
        entry.actions.join(','),
      )
      screenshots.push(await shot(ctx, page, 'skeleton-footer-recycle-entry'))
      await page.click('[data-dshone-tree-action="recycle-toggle"]')
      await page.waitForTimeout(300)
      const drawerOpened = await contentCount(page, '[data-dshone-tree="recycle-drawer"]')
      check.eq('点入口行开现有抽屉', drawerOpened, 1)
      await page.click('[data-dshone-tree-action="recycle-close"]')
      await page.waitForTimeout(200)

      check.eq('骨架套件全程零 pageerror', withoutKnownNoise(opened.capture.pageErrors).real, [])
    } finally {
      await opened.context.close()
    }
    return screenshots
  },
}

// ---------------------------------------------------------------------------
// F-13 DENSITY-SPREAD：密度档扩到侧栏骨架四区（#104）
// ---------------------------------------------------------------------------

/**
 * 要量的区域：区域名 → 选择器 + 要读的 CSS 属性（px 数值，直接比大小）。
 * `where` 区分量它的时候抽屉开没开：抽屉整块盖住树区（`.dshOneTree_drawer` 是
 * `position:absolute;inset:0`），所以树区四件在抽屉关着时量、抽屉内部开着时量。
 */
const DENSITY_REGIONS: ReadonlyArray<{
  region: string
  where: 'tree' | 'drawer'
  selector: string
  props: readonly string[]
}> = [
  { region: '顶栏行', where: 'tree', selector: '[data-dshone-tree="top-bar"]', props: ['height', 'paddingLeft', 'columnGap'] },
  { region: '顶栏图标按钮', where: 'tree', selector: '[data-dshone-tree="top-bar"] .dshOneTree_iconButton', props: ['width', 'height'] },
  { region: '顶栏动作组', where: 'tree', selector: '[data-dshone-tree="top-bar-actions"]', props: ['columnGap'] },
  { region: '分组过滤条', where: 'tree', selector: '.dshOneTree_filterBar', props: ['paddingLeft', 'columnGap'] },
  { region: '分组胶囊', where: 'tree', selector: '.dshOneTree_pill', props: ['height', 'fontSize', 'columnGap', 'paddingLeft', 'paddingRight'] },
  // 回收站入口行（#137 起**退出这张表**）：那一行整套改取旧侧栏规格的定值——行盒右侧 8px、
  // 主区纵向 7px 与右侧 4px、动作按钮 26×26——两种密度下读数相同，不再是「紧凑档更小」的
  // 一员，所以三行合成一行：只有主区的**左**内边距仍取行内容基准 `row-padding-inline`
  // （#125 定的那条竖线），留着继续量。入口行自己的几何（右对齐、按钮尺寸）由 F-35 钉。
  { region: '回收站入口主区', where: 'tree', selector: '.dshOneTree_footerMain', props: ['paddingLeft'] },
  { region: '抽屉头', where: 'drawer', selector: '.dshOneTree_drawerHeader', props: ['height', 'paddingLeft', 'paddingRight', 'columnGap'] },
  { region: '抽屉分块块头', where: 'drawer', selector: '.dshOneTree_drawerGroupLabel', props: ['height', 'paddingLeft', 'paddingRight'] },
  { region: '抽屉会话行', where: 'drawer', selector: '.dshOneTree_drawerRow', props: ['height', 'paddingLeft', 'paddingRight'] },
  // 同上：抽屉列表的左内缩归 0（#125），左边那一列的内缩由抽屉会话行自己承担。
  { region: '抽屉列表', where: 'drawer', selector: '.dshOneTree_drawerList', props: ['paddingRight', 'paddingBottom'] },
]

/**
 * #134 起「行家族取官方标准档」落到这四区里的**测量点**：这些属性两个档同值（回标准档了），
 * 不能再按「紧凑档严格更小」判。名单是按**密度键**推出来的（见 sidebarFramePlugin.ts 的密度表）：
 * - `抽屉会话行`：行高吃 `session-row-height`、左右内边距吃 `row-padding-inline`——两个键都是
 *   行家族键，#134 起两边同值（32px / 8px）；
 * - `抽屉分块块头` / `抽屉头` 的左内边距与 `回收站入口主区` 的左右内边距：吃的是**行内容基准**
 *   `row-padding-inline`（它们要与行的文字左缘对齐），跟着行一起回官方 8px；
 * - **#144 起 `抽屉分块块头` 的高度也进这份名单**：块头与侧栏工作区行收敛成同一套折叠语言，
 *   高度改吃行族的 `row-height`（标准档 = 官方 34px，两档同值），原来那个独立的块头高键
 *   `drawer-block-header-height` 随条目退场；
 * - 抽屉头与入口主区的**高度**仍不在这份名单里：它们的行高键（`section-header-height` /
 *   入口行自己那套定值）仍是紧凑档，照样得严格更紧——这正是「只放开了行，其他控件没被
 *   顺带放开」那条口径的落地。
 * 名单里没有的区域（顶栏 / 图标按钮 / 过滤条 / 胶囊 / 入口动作按钮 / 抽屉列表）每一项都仍按
 * 「紧凑档严格更小」判。
 */
const ROW_FAMILY_SAME: Readonly<Record<string, readonly string[]>> = {
  抽屉会话行: ['height', 'paddingLeft', 'paddingRight'],
  // #144：块头的**高度**也进这份名单（改吃行族的 `row-height`，与工作区行同高 34px）。
  抽屉分块块头: ['height', 'paddingLeft', 'paddingRight'],
  抽屉头: ['paddingLeft'],
  回收站入口主区: ['paddingLeft', 'paddingRight'],
  // #125 起分组过滤条的左内缩也吃「行内容基准」（里面的胶囊要与列表行的内容左缘同一条竖线），
  // 而这一项 #134 起两档同值（官方原值 8px）——所以它跟着行族一起判「两边同值」。
  // #135 起它并进顶栏那一行、还多了一手 `margin-left`（-1 × 骨架基线）把自己拉到容器左缘，
  // 但**这一项仍是行内容基准**（`margin` 那一手是补骨架基线的差），所以这一条照旧成立。
  分组过滤条: ['paddingLeft'],
}

type DensityReading = Record<string, Record<string, number>>

/** 读一组区域的几何（元素不在就不进表——报告里会作为事实记一笔）。 */
async function readDensity(page: OpenedPage['page'], where: 'tree' | 'drawer'): Promise<DensityReading> {
  const specs = DENSITY_REGIONS.filter((spec) => spec.where === where).map(({ region, selector, props }) => ({
    region,
    selector,
    props,
  }))
  return page.evaluate((list) => {
    const out: Record<string, Record<string, number>> = {}
    // getPropertyValue 只认 kebab-case（`paddingLeft` 会读成空串，height 这种同名属性
    // 才恰好能读）——这里把 camelCase 的属性名转过去。
    const kebab = (prop: string): string => prop.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
    for (const spec of list) {
      const element = document.querySelector(spec.selector)
      if (element === null) continue
      const computed = getComputedStyle(element)
      const values: Record<string, number> = {}
      for (const prop of spec.props) values[prop] = Number.parseFloat(computed.getPropertyValue(kebab(prop)))
      out[spec.region] = values
    }
    return out
  }, specs)
}

/**
 * 把自有页的密度变量按树插件自己声明的官方兜底值内联回 frame（= 官方档，与 F-04
 * 同一处置：`var(--dsh-one-density-x, <官方原值>)` 的第二参数就是「没人给偏好」时
 * 的值），返回内联的项数。恢复用 {@link restoreDensity}。
 */
async function applyOfficialDensity(page: OpenedPage['page']): Promise<number> {
  return page.evaluate(() => {
    const treeCss =
      Array.from(document.querySelectorAll('style[data-plugin]'))
        .find((element) => element.getAttribute('data-plugin') === '@dsh-one/dsh-workspace-tree')
        ?.textContent ?? ''
    const fallbacks = Array.from(treeCss.matchAll(/var\(--dsh-one-density-([a-z-]+),\s*([^)]+)\)/g))
    const frame = document.querySelector('[class*="dshOneSidebarShell_frame"]')
    if (frame === null) return -1
    frame.setAttribute('data-lab-density-backup', frame.getAttribute('style') ?? '')
    for (const match of fallbacks) {
      frame.setAttribute('style', `${frame.getAttribute('style') ?? ''};--dsh-one-density-${match[1] ?? ''}:${(match[2] ?? '').trim()}`)
    }
    return fallbacks.length
  })
}

/** 撤掉 {@link applyOfficialDensity} 的内联，让页面回到宿主给的 VS Code 档。 */
async function restoreDensity(page: OpenedPage['page']): Promise<void> {
  await page.evaluate(() => {
    const frame = document.querySelector('[class*="dshOneSidebarShell_frame"]')
    if (frame === null) return
    const backup = frame.getAttribute('data-lab-density-backup')
    if (backup === null) return
    frame.removeAttribute('data-lab-density-backup')
    if (backup === '') frame.removeAttribute('style')
    else frame.setAttribute('style', backup)
  })
}

/**
 * #104：把 #85 立的密度档从「列表行」扩到骨架四区（顶栏 / 分组过滤条 / 回收站入口行 /
 * 抽屉）。这条套件量的是**同一页、同一数据、三档宽度**下两种密度状态的几何差：
 * 宿主给的 VS Code 档 vs 把变量对齐回官方兜底值（= 官方档）。
 *
 * 判据两条（#134 起口径重写）：**行家族回标准档的那几处测量点两个档同值**（`ROW_FAMILY_SAME`
 * 名单，行高 / 行内容基准跟着行回官方原值），**其余每一项紧凑档仍必须严格小于官方原值**——
 * 「兜底 = 官方」由外壳契约套件在源码层守（键集 + 兜底字面量），这里守的是「这套变量真的把
 * 这几块变紧了」，而不是只在列表行上生效。
 */
export const DENSITY_SPREAD_SUITE: LabSuite = {
  id: 'F-13',
  phase: 'new-feature',
  name: '侧栏密度档扩散（#104，口径按 #134 重写）：顶栏 / 分组过滤条 / 抽屉在三档宽度下的密度对照（DENSITY-SPREAD 套件；回收站入口行 #137 起退出这张表）',
  expect:
    '同一页、同一数据、260/340/500 三档宽度下，把自有树的密度变量从宿主给的 VS Code 档切到它自己声明的官方兜底值（= 官方档），四区的几何逐一比较：顶栏行（高/左内边距/行内间隙）、顶栏图标按钮（宽高）、顶栏动作组间隙、分组过滤条（左内边距/间隙）、分组胶囊（高/字号/间隙/左右内边距）、入口主区（左内边距，其余项 #137 起退出这张表）、抽屉头（高/左右内边距/间隙）、抽屉分块块头（高/左右内边距）、抽屉会话行（高/左右内边距）、抽屉列表（左右内边距/底部留白）。判据分两类（#134 行家族取官方标准档、#144 抽屉块头并入行族之后的口径）：① **回标准档的那些测量点两个档同值**——抽屉会话行（高 32px / 左右内边距 8px）、**抽屉分块块头（高 34px / 左右内边距 8px，与侧栏工作区行同高**：它 #144 起与工作区行收敛成同一套折叠语言，吃行族的 `row-height` 键）、抽屉头与抽屉分块块头的左内边距、回收站入口主区的左右内边距、分组过滤条的左内边距（这几处吃的是「行内容基准」，跟着行一起回 8px；过滤条那一条是 #125 把胶囊对齐到行内容基准带来的）；② **其余每一项紧凑档仍严格小于官方原值**（含抽屉头的高度与入口主区的高度——它们自己的行高键仍是紧凑档，不能跟着放开）。另钉住三件：**行族同值那几项真的量到了**（名单至少覆盖 6 项，否则说明这一轮改动没跑到）、**判「严格更紧」的项仍足够多**（至少 15 项，否则套件等于空跑）、同一区域在三档宽度下的紧凑读数一致（密度是容器给的，不随宽度漂）。全程零 pageerror。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const widths = [260, 340, 500] as const
    const opened = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { width: 380, height: 900 })
    const { page } = opened
    try {
      const treeRegions = DENSITY_REGIONS.filter((spec) => spec.where === 'tree')
      const drawerRegions = DENSITY_REGIONS.filter((spec) => spec.where === 'drawer')
      // #134 之后的两类判据各自量到多少项：末了用它守住「口径重写没把套件改空」。
      let tighterChecks = 0
      let sameChecks = 0
      check.fact(
        `量法：同一页两种密度状态（宿主给的 VS Code 档 vs 内联官方兜底值），三档宽度 ${widths.join('/')}。` +
          `抽屉关着量 ${treeRegions.map((spec) => spec.region).join('、')}；抽屉开着量 ${drawerRegions.map((spec) => spec.region).join('、')}`,
      )
      check.fact(
        `#134 行家族回标准档的测量点（判「两边同值」而不是「更紧」）：` +
          Object.entries(ROW_FAMILY_SAME)
            .map(([region, props]) => `${region}.${props.join('/')}`)
            .join('；'),
      )

      // ---- 树区四件：三档宽度 × 两种密度状态 ----
      const compactByWidth = new Map<number, DensityReading>()
      const officialByWidth = new Map<number, DensityReading>()
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 })
        await page.waitForTimeout(300)
        const compact = await readDensity(page, 'tree')
        const aligned = await applyOfficialDensity(page)
        check.ok(
          `w=${String(width)}：密度变量对齐到官方兜底值（内联项数 > 0）`,
          aligned >= 20,
          `内联项数=${String(aligned)}（#104 起键面 25 项、#113 加行圆角到 26 项、#137 减回 25 项（入口行退出密度档）、#144 再减到 24 项（抽屉块头改吃行族的 row-height）；精确键集由外壳契约套件守）`,
        )
        await page.waitForTimeout(200)
        const official = await readDensity(page, 'tree')
        if (width === 340) {
          screenshots.push(await shot(ctx, page, 'density-spread-compact-340'))
        }
        await restoreDensity(page)
        await page.waitForTimeout(150)
        compactByWidth.set(width, compact)
        officialByWidth.set(width, official)
        if (width === 340) {
          screenshots.push(await shot(ctx, page, 'density-spread-official-340'))
        }
        for (const spec of treeRegions) {
          const owner = compact[spec.region]
          const base = official[spec.region]
          check.ok(
            `w=${String(width)} ${spec.region}：元素在（两种状态都量到）`,
            owner !== undefined && base !== undefined,
            `compact=${String(owner !== undefined)} official=${String(base !== undefined)}`,
          )
          if (owner === undefined || base === undefined) continue
          const same = ROW_FAMILY_SAME[spec.region] ?? []
          const rows = spec.props.map((prop) => ({
            prop,
            compact: owner[prop] ?? Number.NaN,
            official: base[prop] ?? Number.NaN,
            relation: same.includes(prop) ? ('same' as const) : ('tighter' as const),
          }))
          for (const row of rows) {
            if (row.relation === 'same') sameChecks += 1
            else tighterChecks += 1
          }
          const wrong = rows.filter((row) =>
            row.relation === 'same' ? row.compact !== row.official : !(row.compact < row.official),
          )
          check.ok(
            `w=${String(width)} ${spec.region}：行家族回标准档的那几项两边同值（=）、其余每一项紧凑档仍严格更小（<）`,
            wrong.length === 0,
            rows.map((row) => `${row.prop} ${String(row.compact)}${row.relation === 'same' ? '=' : '<'}${String(row.official)}`).join(' '),
          )
        }
      }
      check.fact(
        `顶栏/过滤条/回收站入口行 @340（紧凑 → 官方）：${treeRegions
          .flatMap((spec) => {
            const owner = compactByWidth.get(340)?.[spec.region] ?? {}
            const base = officialByWidth.get(340)?.[spec.region] ?? {}
            return spec.props.map((prop) => `${spec.region}.${prop} ${String(owner[prop])}→${String(base[prop])}`)
          })
          .join('；')}`,
      )
      // 密度是容器给的、不是宽度给的：同一区域在三档宽度下的紧凑读数必须一致。
      for (const spec of treeRegions) {
        const samples = widths.map((width) => compactByWidth.get(width)?.[spec.region]).filter((value) => value !== undefined)
        const first = samples[0] ?? {}
        const drifted = samples.filter((value) => spec.props.some((prop) => value[prop] !== first[prop]))
        check.ok(
          `${spec.region}：三档宽度下紧凑读数一致（密度不随宽度漂）`,
          samples.length === widths.length && drifted.length === 0,
          drifted.length === 0
            ? spec.props.map((prop) => `${prop}=${String(first[prop])}`).join(' ')
            : JSON.stringify(drifted),
        )
      }

      // ---- 抽屉：整块盖住树区，点开再量 ----
      await page.setViewportSize({ width: 340, height: 900 })
      await page.click('[data-dshone-tree-action="recycle-toggle"]')
      await page.waitForTimeout(400)
      const drawerOpen = await contentCount(page, '[data-dshone-tree="recycle-drawer"]')
      check.eq('抽屉打开（四区里最后一块要量的区域）', drawerOpen, 1)
      const drawerCompactByWidth = new Map<number, DensityReading>()
      const drawerOfficialByWidth = new Map<number, DensityReading>()
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 })
        await page.waitForTimeout(300)
        const compact = await readDensity(page, 'drawer')
        await applyOfficialDensity(page)
        await page.waitForTimeout(200)
        const official = await readDensity(page, 'drawer')
        await restoreDensity(page)
        await page.waitForTimeout(150)
        drawerCompactByWidth.set(width, compact)
        drawerOfficialByWidth.set(width, official)
        for (const spec of drawerRegions) {
          const owner = compact[spec.region]
          const base = official[spec.region]
          // 抽屉内容 = 网关的归档集合：当前网关上有内容（F-07 同款断言），但仍按
          // F-04 的口径处理「这一轮真没有」——没有可比的东西就记一笔跳过。
          if (owner === undefined || base === undefined) {
            check.fact(`w=${String(width)} ${spec.region}：这一轮没有这个元素（网关归档集合为空时抽屉只出状态行）——跳过`)
            continue
          }
          const same = ROW_FAMILY_SAME[spec.region] ?? []
          const rows = spec.props.map((prop) => ({
            prop,
            compact: owner[prop] ?? Number.NaN,
            official: base[prop] ?? Number.NaN,
            relation: same.includes(prop) ? ('same' as const) : ('tighter' as const),
          }))
          for (const row of rows) {
            if (row.relation === 'same') sameChecks += 1
            else tighterChecks += 1
          }
          const wrong = rows.filter((row) =>
            row.relation === 'same' ? row.compact !== row.official : !(row.compact < row.official),
          )
          check.ok(
            `w=${String(width)} ${spec.region}：行家族回标准档的那几项两边同值（=）、其余每一项紧凑档仍严格更小（<）`,
            wrong.length === 0,
            rows.map((row) => `${row.prop} ${String(row.compact)}${row.relation === 'same' ? '=' : '<'}${String(row.official)}`).join(' '),
          )
        }
      }
      check.fact(
        `抽屉四件 @340（紧凑 → 官方）：${drawerRegions
          .flatMap((spec) => {
            const owner = drawerCompactByWidth.get(340)?.[spec.region] ?? {}
            const base = drawerOfficialByWidth.get(340)?.[spec.region] ?? {}
            return spec.props.map((prop) => `${spec.region}.${prop} ${String(owner[prop])}→${String(base[prop])}`)
          })
          .join('；')}`,
      )
      // 口径重写（#134）之后守住这套件没被改空：两类判据各自都要量到足够多的项。
      // 「两边同值」那一类至少 6 项（行族那几处测量点）、「严格更紧」那一类至少 15 项
      // （#134 只放开了行家族，四区其余几何仍必须由密度变量压紧）。
      check.ok('行家族回标准档的测量点真的量到了（两类判据里的「同值」一类 ≥ 6 项）', sameChecks >= 6, `项数=${String(sameChecks)}`)
      check.ok('仍按「紧凑档严格更紧」判的项足够多（≥ 15 项，套件没被改空）', tighterChecks >= 15, `项数=${String(tighterChecks)}`)
      screenshots.push(await shot(ctx, page, 'density-spread-drawer-340'))
      await page.click('[data-dshone-tree-action="recycle-close"]')
      // 收起有滑出过渡（#117）：等过渡跑完抽屉才从 DOM 里消失，所以这里等得比过渡长。
      await page.waitForTimeout(400)
      check.eq('抽屉关掉', await contentCount(page, '[data-dshone-tree="recycle-drawer"]'), 0)

      check.eq('密度套件全程零 pageerror', withoutKnownNoise(opened.capture.pageErrors).real, [])
    } finally {
      await opened.context.close()
    }
    return screenshots
  },
}

// ---------------------------------------------------------------------------
// F-14 PIN-UNREAD：置顶与手动未读（#102）
// ---------------------------------------------------------------------------

/** 树里一个分组区块的会话行现状（F-14 的行级夹具）。 */
interface LabSessionRow {
  id: string
  /** 行上的活状态（`data-dshone-tree-status`）：waiting / running / idle。 */
  status: string
  pinned: boolean
  unread: boolean
  /** 状态位里真画了东西（未读的绿点就落在这里；空闲行是空槽）。 */
  dot: boolean
  /** 这一行有行操作（非空白会话才有 ⋯ 菜单）。 */
  menu: boolean
  /** 选择态下的勾选资格（`data-dshone-tree-check`）：eligible / blocked。 */
  check: string | null
  /** 勾选框上的原因提示（不可勾选时才有）。 */
  checkTip: string
  /** 标题的 font-weight（未读加粗 = 600）。 */
  weight: string
}

interface LabSection {
  key: string
  sessions: LabSessionRow[]
}

/** 逐个分组读会话行现状（含行内的置顶图钉与未读加粗）。 */
async function sectionRows(page: OpenedPage['page']): Promise<LabSection[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-dshone-group-key]')).map((section) => ({
      key: section.getAttribute('data-dshone-group-key') ?? '',
      sessions: Array.from(section.querySelectorAll('[data-dshone-tree-row="session"]')).map((row) => {
        const title = row.querySelector('.dshOneTree_title')
        const check = row.querySelector('.dshOneTree_check')
        return {
          id: row.getAttribute('data-dshone-tree-session') ?? '',
          status: row.getAttribute('data-dshone-tree-status') ?? '',
          pinned: row.querySelector('[data-dshone-tree-pin]') !== null,
          unread: (title?.className ?? '').includes('dshOneTree_unread'),
          dot: (row.querySelector('.dshOneTree_slot')?.children.length ?? 0) > 0,
          menu: row.querySelector('[data-dshone-tree-action="session-menu"]') !== null,
          check: row.getAttribute('data-dshone-tree-check'),
          checkTip: check?.getAttribute('title') ?? '',
          weight: title === null ? '' : getComputedStyle(title).fontWeight,
        }
      }),
    })),
  )
}

/** 把收缩着的分组全展开（只动本地展开态，不写网关）。 */
async function expandAllGroups(page: OpenedPage['page']): Promise<void> {
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

/** 当前菜单里我们那几项的状态（按自有标记属性取项，不认官方哈希类名）。 */
async function sessionMenuItemFacts(page: OpenedPage['page']): Promise<
  Record<'pin' | 'unread' | 'archive', { text: string; disabled: boolean; tip: string; children: number } | null>
> {
  return page.evaluate(() => {
    const menu = Array.from(document.querySelectorAll('[role="menu"]')).pop()
    const read = (name: string): { text: string; disabled: boolean; tip: string; children: number } | null => {
      const mark = menu?.querySelector(`[data-dshone-tree-item="${name}"]`)
      const button = mark?.closest('button') ?? null
      if (mark === null || mark === undefined || button === null) return null
      return {
        text: (mark.textContent ?? '').trim(),
        disabled: button.disabled === true,
        tip: mark.getAttribute('title') ?? '',
        // 官方 Menu 的勾选态（selectedIds）会多渲染一个 check 图标子元素：有 ✓ 时
        // 子元素数比没有时多 1（图标槽 + 文案槽 [+ check]）。
        children: button.childElementCount,
      }
    }
    return { pin: read('pin'), unread: read('unread'), archive: read('archive') }
  })
}

/** 假宿主状态存储里的一个键。 */
async function hostState(page: OpenedPage['page'], key: string): Promise<unknown> {
  return page.evaluate((name: string) => {
    const host = (globalThis as unknown as { __LAB_HOST__?: { stateStore?: Record<string, unknown> } }).__LAB_HOST__
    return host?.stateStore?.[name] ?? null
  }, key)
}

/**
 * 置顶与手动未读（#102）：状态迁入、置顶排最前、未读的标/清/禁用、保护规则三处禁用。
 *
 * 数据面与其它套件一致：真实网关只读 + 假宿主；两份标记注进假宿主的状态存储
 * （`pinned` 注**旧形状**的裸 id 数组，用来验一次性迁入与写回；`unread` 注规范形状，
 * 用来验「规范形状不重写」）。
 */
export const PIN_UNREAD_SUITE: LabSuite = {
  id: 'F-14',
  phase: 'new-feature',
  name: '置顶与手动未读（#102）：旧值迁入 + 置顶排最前 + 未读标/清/禁用 + 保护规则（PIN-UNREAD 套件）',
  expect:
    '侧栏树（真实网关只读 + 假宿主）：① **迁入**——注入旧形状（裸 id 数组）的 `pinned` 与规范形状的 `unread`，两者都被采用（行上出图钉 / 出未读加粗），且只有旧形状那一份被按规范形状 `{version:1, sessionIds:[…]}` 写回一次、规范形状那一份原样不重写；② **置顶排最前**——置顶行的位置在它所在分组里排第一（其余行保持官方顺序）；③ **手动未读**——菜单「标为未读」把行变成绿点 + 标题加粗并写进 `unread` 键，再点「标为已读」清掉；**打开会话即清未读**；运行中（或后代在跑）的那一行该项禁用并给出原因；④ **保护规则**——置顶行在选择态下不可勾选（勾选框灰、带原因、点它不切换）、「归档会话」项禁用并给出置顶原因，未读行的归档项禁用并给出未读原因（归档许可的口径 = `canArchive`）。全程零 pageerror。',
  run: async (ctx, check) => {
    const screenshots: string[] = []

    // 一、先开一次页面摸清真网关上真有的行——夹具必须用页面里真有的会话 id，
    // 否则断言无从观察（与 F-07 同一做法）。
    const probe = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { width: 380, height: 900 })
    let before: LabSection[] = []
    try {
      await expandAllGroups(probe.page)
      before = await sectionRows(probe.page)
    } finally {
      await probe.context.close()
    }
    const allRows = before.flatMap((section) => section.sessions.map((row, index) => ({ ...row, key: section.key, index })))
    check.fact(
      `真实网关的行：${String(allRows.length)} 条（分组 ${String(before.length)} 个，其中带行菜单的 ${String(allRows.filter((row) => row.menu).length)} 条）`,
    )

    // 置顶目标：挑一个「分组里至少两行、且它不是第一行」的会话——置顶后它要挪到第一，
    // 位置变化才看得出来。
    const pinTarget = allRows.find((row) => row.menu && row.index > 0)
    // 未读目标：另挑一条空闲行（与置顶那条不同），未读项对它是可用的。
    const unreadTarget = allRows.find((row) => row.menu && row.status === 'idle' && row.id !== pinTarget?.id)
    // 运行中样本：真网关上通常有（跑这个套件的会话自己就在跑），没有时下面按无样本记。
    const runningTarget = allRows.find((row) => row.status === 'running')
    check.fact(
      `夹具：置顶=${pinTarget?.id.slice(0, 13) ?? '无'}（分组 ${pinTarget?.key.slice(0, 8) ?? '无'} 第 ${String(pinTarget?.index ?? -1)} 行） 未读=${unreadTarget?.id.slice(0, 13) ?? '无'} 运行中样本=${runningTarget?.id.slice(0, 13) ?? '无'}`,
    )
    if (pinTarget === undefined || unreadTarget === undefined) {
      check.ok('真网关上取到置顶与未读各一个夹具会话', false, `pin=${String(pinTarget !== undefined)} unread=${String(unreadTarget !== undefined)}`)
      return screenshots
    }

    // 二、带注入状态开页：`pinned` 注**旧形状**（裸 id 数组，迁入后应被写回规范形状），
    // `unread` 注**规范形状**并故意多带一个字段（不重写的话它会原样留着）。
    const injectedUnread = { version: 1, sessionIds: [unreadTarget.id], keep: 'untouched' }
    const opened = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), {
      width: 380,
      height: 900,
      state: { pinned: [pinTarget.id], unread: injectedUnread },
    })
    const { page } = opened
    try {
      await expandAllGroups(page)
      const after = await sectionRows(page)
      const rows = after.flatMap((section) => section.sessions.map((row, index) => ({ ...row, key: section.key, index })))
      const pinnedRow = rows.find((row) => row.id === pinTarget.id)
      const unreadRow = rows.find((row) => row.id === unreadTarget.id)
      const pinnedSection = after.find((section) => section.key === pinTarget.key)

      // ---- ① 迁入读取：两份旧值都被采用 ----
      check.ok('迁入：旧形状的 pinned 被采用（那一行出图钉）', pinnedRow?.pinned === true, JSON.stringify(pinnedRow))
      check.ok('迁入：规范形状的 unread 被采用（那一行标题加粗）', unreadRow?.unread === true, JSON.stringify(unreadRow))
      check.eq('未读行标题加粗（600）', unreadRow?.weight, '600')
      check.ok('未读行画出状态位（空闲行本来是个空槽）', unreadRow?.dot === true, JSON.stringify(unreadRow))

      // ---- ② 置顶排最前（它所在的那一层）----
      check.ok(
        '置顶排最前：置顶行在它所在分组里是第一行（其余保持官方顺序）',
        pinnedSection?.sessions[0]?.id === pinTarget.id,
        `组内顺序=${JSON.stringify(pinnedSection?.sessions.map((row) => row.id.slice(0, 14)))}`,
      )
      // 「其余保持官方顺序」的对照口径：置顶前的顺序**去掉置顶那条**，应当与置顶后
      // 去掉第一行完全一致。
      const beforeRest = (before.find((section) => section.key === pinTarget.key)?.sessions ?? [])
        .map((row) => row.id)
        .filter((id) => id !== pinTarget.id)
      check.ok(
        '其余行保持官方顺序（去掉置顶行后与置顶前的顺序一致）',
        JSON.stringify((pinnedSection?.sessions ?? []).slice(1).map((row) => row.id)) === JSON.stringify(beforeRest),
        `after=${JSON.stringify((pinnedSection?.sessions ?? []).slice(1).map((row) => row.id.slice(0, 14)))} before=${JSON.stringify(beforeRest.map((id) => id.slice(0, 14)))}`,
      )

      // ---- ① 迁入写回：旧形状写回规范形状；规范形状原样不重写 ----
      check.eq('迁入写回：旧形状的 pinned 被按规范形状写回一次', await hostState(page, 'pinned'), {
        version: 1,
        sessionIds: [pinTarget.id],
      })
      check.eq('规范形状的 unread 不被重写（注入的多余字段原样留着）', await hostState(page, 'unread'), injectedUnread)

      // ---- ③ 菜单：文案随状态翻转 + 勾选态 ----
      await openSessionMenu(page, pinTarget.id)
      const pinnedMenu = await sessionMenuItemFacts(page)
      check.fact(`置顶行菜单：${JSON.stringify(pinnedMenu)}`)
      check.ok('已置顶时文案是「取消置顶」', pinnedMenu.pin?.text === '取消置顶', JSON.stringify(pinnedMenu.pin))
      screenshots.push(await shot(ctx, page, 'pin-unread-menu-pinned'))
      // ---- ④ 保护规则：归档项对置顶行禁用并给出置顶原因 ----
      check.ok(
        '保护规则：置顶行的「归档会话」禁用并给出置顶原因',
        pinnedMenu.archive?.disabled === true && pinnedMenu.archive.tip.includes('置顶会话不能归档'),
        JSON.stringify(pinnedMenu.archive),
      )
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)

      await openSessionMenu(page, unreadTarget.id)
      const unreadMenu = await sessionMenuItemFacts(page)
      check.fact(`未读行菜单：${JSON.stringify(unreadMenu)}`)
      check.ok('已未读时文案是「标为已读」', unreadMenu.unread?.text === '标为已读', JSON.stringify(unreadMenu.unread))
      check.ok(
        '保护规则：未读行的「归档会话」禁用并给出未读原因（归档许可的口径见 canArchive）',
        unreadMenu.archive?.disabled === true && unreadMenu.archive.tip.includes('未读的会话不能归档'),
        JSON.stringify(unreadMenu.archive),
      )
      // 未置顶的行：pin 项文案是「置顶」、没有 ✓（与置顶行比，子元素少一个）。
      check.ok('未置顶时文案是「置顶」', unreadMenu.pin?.text === '置顶', JSON.stringify(unreadMenu.pin))
      check.ok(
        '未置顶的行菜单里 pin 项没有 ✓（子元素比置顶行少一个：官方 Menu 的 check 槽）',
        unreadMenu.pin !== null && pinnedMenu.pin !== null && unreadMenu.pin.children === pinnedMenu.pin.children - 1,
        `unpinned=${String(unreadMenu.pin?.children)} pinned=${String(pinnedMenu.pin?.children)}`,
      )
      screenshots.push(await shot(ctx, page, 'pin-unread-menu-unread'))
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)

      // ---- ③ 运行中：该项禁用并给出原因 ----
      // 真网关上跑这个套件的会话自己通常就在跑，所以一般都有样本；万一这轮没有
      // （跑完那一刻刚结束），这条按「无样本」通过，并把规则本身交给单测钉住
      // （test/sessionEligibility.test.ts 的 canArchive/sessionBusy）。断言条数恒定。
      let runningBlocked = true
      let runningDetail = '本轮真网关上没有运行中的会话（无样本）'
      if (runningTarget !== undefined) {
        await openSessionMenu(page, runningTarget.id)
        const runningMenu = await sessionMenuItemFacts(page)
        runningDetail = JSON.stringify(runningMenu.unread)
        runningBlocked =
          runningMenu.unread?.disabled === true && runningMenu.unread.tip.includes('运行中的会话不支持手动标为已读/未读')
        await page.keyboard.press('Escape')
        await page.waitForTimeout(200)
      }
      check.ok('运行中的会话：未读项禁用并给出原因（无运行样本的一轮按无样本通过）', runningBlocked, runningDetail)

      // ---- ③ 标为未读 / 标为已读：走菜单，写回 unread 键 ----
      await openSessionMenu(page, unreadTarget.id)
      await page.click('[data-dshone-tree-item="unread"]')
      await page.waitForTimeout(350)
      const markedRead = (await sectionRows(page)).flatMap((section) => section.sessions).find((row) => row.id === unreadTarget.id)
      check.eq('「标为已读」后行上不再加粗', markedRead?.unread, false)
      check.eq('「标为已读」写回 unread 键（那一行被摘掉，其余保留）', await hostState(page, 'unread'), {
        version: 1,
        sessionIds: [],
      })

      // 再标一次未读（这次是为了验「打开会话即清未读」）。
      await openSessionMenu(page, unreadTarget.id)
      await page.click('[data-dshone-tree-item="unread"]')
      await page.waitForTimeout(350)
      const reMarked = (await sectionRows(page)).flatMap((section) => section.sessions).find((row) => row.id === unreadTarget.id)
      check.eq('「标为未读」后行上加粗', reMarked?.unread, true)
      check.eq('「标为未读」写回 unread 键', await hostState(page, 'unread'), {
        version: 1,
        sessionIds: [unreadTarget.id],
      })

      // ---- ③ 打开会话即清未读 ----
      await page.click(`[data-dshone-tree-session="${unreadTarget.id}"]`)
      await page.waitForTimeout(400)
      const openedRow = (await sectionRows(page)).flatMap((section) => section.sessions).find((row) => row.id === unreadTarget.id)
      check.eq('打开会话即清未读：行上不再加粗', openedRow?.unread, false)
      check.eq('打开会话即清未读：unread 键里没有它了', await hostState(page, 'unread'), { version: 1, sessionIds: [] })

      // ---- ④ 保护规则：置顶行不可勾选（组头三态遇置顶只能 none/some，判定见 pure 工具）----
      await page.click('[data-dshone-tree-action="select-mode"]')
      await page.waitForTimeout(300)
      const selectRows = await page.evaluate((pinnedId: string) => {
        const read = (id: string): { check: string | null; tip: string; checked: string | null } => {
          const row = document.querySelector(`[data-dshone-tree-session="${id}"]`)
          return {
            check: row?.getAttribute('data-dshone-tree-check') ?? null,
            tip: row?.querySelector('.dshOneTree_check')?.getAttribute('title') ?? '',
            checked: row?.getAttribute('data-dshone-tree-checked') ?? null,
          }
        }
        return { pinned: read(pinnedId), other: read(document.querySelector('[data-dshone-tree-session]:not([data-dshone-tree-session="' + pinnedId + '"])')?.getAttribute('data-dshone-tree-session') ?? '') }
      }, pinTarget.id)
      check.ok(
        '保护规则：置顶行在选择态下不可勾选（带原因提示）',
        selectRows.pinned.check === 'blocked' && selectRows.pinned.tip.includes('置顶会话不能移入回收站或归档'),
        JSON.stringify(selectRows.pinned),
      )
      // 点它不切换勾选（不可勾选的行整行点下去也不该被选中）。
      await page.click(`[data-dshone-tree-session="${pinTarget.id}"]`)
      await page.waitForTimeout(200)
      const afterClick = await page.getAttribute(`[data-dshone-tree-session="${pinTarget.id}"]`, 'data-dshone-tree-checked')
      check.eq('点置顶行不切换勾选（仍未被选中）', afterClick, 'false')
      check.ok('非置顶行照旧可勾选（对照组）', selectRows.other.check === 'eligible', JSON.stringify(selectRows.other))
      screenshots.push(await shot(ctx, page, 'pin-unread-protect-select'))
      await page.click('[data-dshone-tree-action="select-mode"]')
      await page.waitForTimeout(250)

      // ---- 取消置顶：图钉消失、状态清空 ----
      await openSessionMenu(page, pinTarget.id)
      await page.click('[data-dshone-tree-item="pin"]')
      await page.waitForTimeout(350)
      const unpinnedRow = (await sectionRows(page)).flatMap((section) => section.sessions).find((row) => row.id === pinTarget.id)
      check.eq('取消置顶：行上不再有图钉', unpinnedRow?.pinned, false)
      check.eq('取消置顶写回 pinned 键（空集合）', await hostState(page, 'pinned'), { version: 1, sessionIds: [] })

      check.eq('置顶与未读套件全程零 pageerror', withoutKnownNoise(opened.capture.pageErrors).real, [])
    } finally {
      await opened.context.close()
    }
    return screenshots
  },
}
// ---------------------------------------------------------------------------
// F-15 RECYCLE-TWO-LAYER：回收站两层语义（#103）
// ---------------------------------------------------------------------------

/** 假宿主状态存储里当前的回收站状态（未写过时为 null）。 */
async function hostRecycleBin(page: OpenedPage['page']): Promise<unknown> {
  return page.evaluate(() => {
    const host = (globalThis as unknown as { __LAB_HOST__?: { stateStore?: Record<string, unknown> } }).__LAB_HOST__
    return host?.stateStore?.['recycle-bin'] ?? null
  })
}

/**
 * 把官方浏览区（对照档）的所有工作区展开：官方那棵树默认只展开当前会话所在分组，
 * 其余收起时它的会话行根本不渲染——「会话数变没变」就量不准。展开只改它自己的视图，
 * 不写网关。
 */
async function expandOfficialWorkspaces(page: OpenedPage['page']): Promise<void> {
  await page.evaluate(() => {
    for (const row of Array.from(document.querySelectorAll('[class*="_projectRow"]'))) {
      if (row.getAttribute('aria-expanded') !== 'true') (row as HTMLElement).click()
    }
  })
  await page.waitForTimeout(800)
}

/** 把整棵树展开（顶栏那个按钮是开关：点一次若变成「已全收起」再点一次）。 */
async function expandAllWorkspaces(page: OpenedPage['page']): Promise<void> {
  const state = async (): Promise<string | null> =>
    page.getAttribute('[data-dshone-tree-action="collapse-all"]', 'data-dshone-tree-collapsed')
  await page.click('[data-dshone-tree-action="collapse-all"]')
  await page.waitForTimeout(250)
  if ((await state()) === 'true') {
    await page.click('[data-dshone-tree-action="collapse-all"]')
    await page.waitForTimeout(250)
  }
}

/** 把某一行（按会话 id 认）通过 ⋯ 菜单移入回收站。 */
async function moveRowToRecycleBin(page: OpenedPage['page'], sessionId: string): Promise<void> {
  const row = page.locator(`[data-dshone-tree-session="${sessionId}"]`)
  await row.hover()
  await row.locator('.dshOneTree_rowIconButton').click()
  await page.waitForTimeout(250)
  await page.click('[data-dshone-tree-item="move-to-recycle-bin"]')
  await page.waitForTimeout(350)
}

export const RECYCLE_TWO_LAYER_SUITE: LabSuite = {
  id: 'F-15',
  phase: 'new-feature',
  name: '回收站两层语义（#103）：移入/还原是本地可逆、归档=删除带确认（RECYCLE-TWO-LAYER 套件）',
  expect:
    '#103 定的两层语义在真实装配页上成立（真网关**只读** + 假宿主 + 同一上下文里并排开官方浏览区对照档）：① **移入回收站只写本地状态**——行菜单「移入回收站」后会话从我们树里消失、入口角标 +1、假宿主状态存储里出现 `recycle-bin`（形状 `{version:1, sessionIds:[按移入顺序]}`），而**官方浏览区里的会话一条都没少**（同时刻对照，证明 dsh 侧一个字节没动）；② **抽屉形态**：点入口行从底部半高滑出（高度档 50）、提手上拉吸附到 90、按原工作区分块、块内按移入顺序倒序、块头可折叠且折叠态落 `dsh.workspaceTree.view`（重载后仍收起；#144 起块头与侧栏工作区行同一套折叠语言，每行行尾直接列出「还原」与「永久归档」两枚图标按钮、⋯ 二级菜单退场——两枚的几何与行为由 F-45 钉）；③ 状态按旧侧栏那份文件的键名与形状读回（**旧 recycle-bin.json 原样迁入**），并在基线就绪时**清账**——集合里 dsh 侧已不存在的 id 被剔掉、真的那几条原样保留；④ **还原**（行尾那两枚动作里的「还原」，与入口「全部还原」）同样只动本地状态，会话回到树里；⑤ **归档 = 删除**：入口「清空」与多选操作条的「归档」都先开同一个确认弹窗（写明不可恢复、按工作区列出将归档的会话、写明跳过数），取消则什么都不发生；⑥ 多选操作条的「移入回收站」复用同一套本地动作（立即执行 + 飘提示 + 退出选择态）；⑦ 回收站空时入口两枚动作图标禁用。全程零 pageerror，且本套件**从不点归档确认**（那会写真实网关）。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const opened = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { width: 380, height: 900 })
    const { page } = opened
    let official: OpenedPage | null = null
    try {
      await expandAllWorkspaces(page)
      // 夹具：**同一个工作区块里**两条带行菜单的会话（空白会话行没有行菜单）。挑同一块
      // 是为了让「块内按移入顺序倒序」这条断言真的有两行可比（跨块的各一条看不出顺序）。
      const fixture = await page.evaluate(() => {
        for (const section of Array.from(document.querySelectorAll('[data-dshone-group-key]'))) {
          // #109 起空白会话行也挂着菜单容器（右键要能开出菜单，见 rows.ts），所以夹具按
          // 「有 ⋯ 按钮」认「带行菜单的会话行」——这一档要的是能用 ⋯ 走一遍菜单的行。
          const rows = Array.from(section.querySelectorAll('[data-dshone-tree-row="session"]')).filter(
            (row) => row.querySelector('[data-dshone-tree-action="session-menu"]') !== null,
          )
          if (rows.length >= 2) {
            return {
              key: section.getAttribute('data-dshone-group-key') ?? '',
              ids: rows.slice(0, 2).map((row) => row.getAttribute('data-dshone-tree-session') ?? ''),
              titles: rows.slice(0, 2).map((row) => row.querySelector('.dshOneTree_title')?.textContent ?? ''),
              siblingRows: rows.length,
            }
          }
        }
        return null
      })
      check.fact(`夹具：同一工作区块里带行菜单的会话行=${JSON.stringify(fixture)}`)
      check.ok('找到一个有 ≥2 条可操作会话行的工作区块（移入/还原要有对象）', fixture !== null && fixture.ids.every((id) => id !== ''))
      if (fixture === null || !fixture.ids.every((id) => id !== '')) return screenshots
      const first = fixture.ids[0] ?? ''
      const second = fixture.ids[1] ?? ''
      const firstTitle = fixture.titles[0] ?? ''
      const secondTitle = fixture.titles[1] ?? ''
      check.fact(`夹具会话：${first}（${firstTitle}）与 ${second}（同在 ${fixture.key} 块）`)

      // 官方浏览区对照档：同一上下文（同一 localStorage、同一个假宿主），只读地看
      // 「dsh 侧到底有没有变」——归档会让官方那边少一行，本地挪走不会。
      official = await openTreePageAlongside(opened, ctx.lab, route('sidebar-official'), { width: 380, height: 900 })
      const officialPage = official
      const officialRows = async (): Promise<number> => contentCount(officialPage.page, '[class*="_sessionRow"]')
      const officialHasTitles = async (titles: readonly string[]): Promise<boolean> =>
        officialPage.page.evaluate(
          (needles: string[]) => {
            const text = Array.from(document.querySelectorAll('[class*="_sessionRow"]'))
              .map((row) => row.textContent ?? '')
              .join('\u0000')
            return needles.every((needle) => needle !== '' && text.includes(needle))
          },
          [...titles],
        )
      await expandOfficialWorkspaces(officialPage.page)
      const officialBefore = await officialRows()
      const officialHasFirst = await officialHasTitles([firstTitle])
      check.fact(`官方浏览区对照档（工作区全展开）：会话行=${String(officialBefore)} 含首条夹具标题=${String(officialHasFirst)}`)
      check.ok('对照档里能看到首条夹具（后面用它证明我们没动 dsh 侧）', officialBefore > 0 && officialHasFirst)

      // ---- ① 移入回收站：本地可逆层 ----
      await (async (): Promise<void> => {
        const row = page.locator(`[data-dshone-tree-session="${first}"]`)
        await row.hover()
        await row.locator('.dshOneTree_rowIconButton').click()
        await page.waitForTimeout(250)
        const facts = await page.evaluate(() => {
          const pick = (id: string): HTMLElement | null => document.querySelector(`[data-dshone-tree-item="${id}"]`)
          const item = (id: string): { text: string; reason: string; hint: string; disabled: boolean } => {
            const mark = pick(id)
            const button = mark?.closest('button') as HTMLButtonElement | null
            return {
              text: mark?.textContent ?? '',
              reason: mark?.getAttribute('data-dshone-disabled-reason') ?? 'missing',
              hint: mark?.getAttribute('title') ?? '',
              disabled: button?.disabled ?? false,
            }
          }
          return { recycle: item('move-to-recycle-bin'), archive: item('archive'), items: document.querySelectorAll('[data-dshone-tree-item]').length }
        })
        check.fact(
          `行菜单两项：移入回收站=${JSON.stringify(facts.recycle.text)}（原因 ${facts.recycle.reason} 禁用 ${String(facts.recycle.disabled)}）` +
            ` 归档会话=${JSON.stringify(facts.archive.text)}（原因 ${facts.archive.reason} 禁用 ${String(facts.archive.disabled)} 提示 ${JSON.stringify(facts.archive.hint)}）`,
        )
        check.ok(
          '行菜单里「移入回收站」与「归档会话」是两项分开的（各自一份文案、各自一条判定结果）',
          facts.recycle.text.includes('移入回收站') && facts.archive.text.includes('归档会话') && facts.recycle.text !== facts.archive.text,
        )
        check.ok(
          '两枚菜单项各自的禁用态与判定原因一致（有原因 = 禁用且带原因提示；没原因 = 可选）',
          (facts.recycle.reason === '' ? !facts.recycle.disabled : facts.recycle.disabled && facts.recycle.hint !== '') &&
            (facts.archive.reason === '' ? !facts.archive.disabled : facts.archive.disabled && facts.archive.hint !== ''),
          JSON.stringify({ recycle: facts.recycle, archive: facts.archive }),
        )
        check.eq('移入回收站这一枚按「只拦置顶」判（本条没置顶 → 可选）', facts.recycle.reason, '')
        await page.click('[data-dshone-tree-item="move-to-recycle-bin"]')
        await page.waitForTimeout(400)
      })()
      const flashText = await page.textContent('[data-dshone-tree="flash"]')
      check.ok('移入后飘一条回执提示', (flashText ?? '').includes('回收站'), String(flashText))
      check.eq('移入的会话从我们树里消失', await contentCount(page, `[data-dshone-tree-session="${first}"]`), 0)
      const entryCount = async (): Promise<string | null> => page.getAttribute('[data-dshone-tree-action="recycle-toggle"]', 'data-dshone-tree-recycle-count')
      const afterFirstMoveState = (await hostRecycleBin(page)) as { version?: number; sessionIds?: string[] } | null
      check.fact(`移入一条后：入口角标=${String(await entryCount())} 宿主状态=${JSON.stringify(afterFirstMoveState)}`)
      check.eq('入口角标 +1（本地集合的计数）', await entryCount(), '1')
      check.ok('宿主状态存储里的 `recycle-bin` 是旧文件那份形状（version 1 + sessionIds）', afterFirstMoveState?.version === 1 && Array.isArray(afterFirstMoveState.sessionIds))
      check.eq('本地集合里恰好是那一条（移入顺序）', afterFirstMoveState?.sessionIds ?? [], [first])
      screenshots.push(await shot(ctx, page, 'recycle-moved-first'))

      // 第二条同样移入：移入顺序 = [first, second]（抽屉里倒序展示的第二条在前）。
      await moveRowToRecycleBin(page, second)
      const afterSecondMove = (await hostRecycleBin(page)) as { sessionIds?: string[] } | null
      check.eq('第二条接在移入顺序尾部（越晚移入越靠后）', afterSecondMove?.sessionIds ?? [], [first, second])
      check.eq('入口角标 = 本地集合的条数', await entryCount(), '2')

      // ---- ② 不动 dsh：官方浏览区一条都没少 ----
      await page.waitForTimeout(1_500)
      const officialAfter = await officialRows()
      const officialStillHasFirst = await officialHasTitles([firstTitle, secondTitle])
      check.fact(`移入两条后官方浏览区：会话行=${String(officialAfter)}（移入前 ${String(officialBefore)}）含首条夹具=${String(officialStillHasFirst)}`)
      check.eq('移入回收站不动 dsh 侧：官方浏览区会话数不变', officialAfter, officialBefore)
      check.ok('移入回收站不动 dsh 侧：那条会话在官方浏览区还在', officialStillHasFirst)

      // ---- ③ 抽屉：半高滑出 + 分块 + 块内移入顺序倒序 ----
      await page.click('[data-dshone-tree-action="recycle-toggle"]')
      await page.waitForTimeout(400)
      const drawer = await page.evaluate(() => {
        const root = document.querySelector('[data-dshone-tree="recycle-drawer"]')
        if (root === null) return null
        const blocks = Array.from(root.querySelectorAll('[data-dshone-recycle-group]')).map((block) => ({
          key: block.getAttribute('data-dshone-recycle-group') ?? '',
          rows: Array.from(block.querySelectorAll('[data-dshone-recycle-row]')).map((row) => row.getAttribute('data-dshone-recycle-row') ?? ''),
        }))
        const parent = root.parentElement
        return {
          height: Number(root.getAttribute('data-dshone-recycle-height')),
          ratio: parent === null ? 0 : root.getBoundingClientRect().height / parent.getBoundingClientRect().height,
          blocks,
          rows: blocks.reduce((total, block) => total + block.rows.length, 0),
          restoreButtons: root.querySelectorAll('[data-dshone-recycle-restore]').length,
          // #144：行尾直接列出两枚动作，⋯ 那一枚（`data-dshone-recycle-menu`）退场。
          archiveButtons: root.querySelectorAll('[data-dshone-recycle-archive]').length,
          rowMenus: root.querySelectorAll('[data-dshone-recycle-menu]').length,
        }
      })
      check.fact(`抽屉：高度档=${String(drawer?.height)} 实测比例=${String(drawer?.ratio.toFixed(2))} 块=${JSON.stringify(drawer?.blocks)}`)
      check.ok('点入口行从底部滑出抽屉', drawer !== null)
      check.ok('默认半高（高度档 50，实测比例在 0.45~0.55）', drawer?.height === 50 && (drawer?.ratio ?? 0) > 0.45 && (drawer?.ratio ?? 0) < 0.55, JSON.stringify(drawer))
      check.eq('抽屉里的行数 = 本地集合的条数', drawer?.rows, 2)
      check.eq('每行行尾一枚「还原」', drawer?.restoreButtons, 2)
      // #144：两枚动作都在行尾直接摆开，二级菜单（⋯）不在——这一条比改前更强（改前只数还原）。
      check.eq('每行行尾另一枚「永久归档」也在（#144：两枚动作都直接摆在行上）', drawer?.archiveButtons, 2)
      check.eq('行尾不再有 ⋯ 二级菜单（#144：归档不再藏进菜单）', drawer?.rowMenus, 0)
      const fixtureBlock = (drawer?.blocks ?? []).find((block) => block.rows.includes(second))
      check.fact(`夹具两条所在块：${JSON.stringify(fixtureBlock)}（工作区块键 ${fixture.key}）`)
      check.eq('按原工作区分块：两条同工作区的会话落在同一个块里', fixtureBlock?.key, fixture.key)
      check.eq(
        '块内按移入顺序倒序（先移入的在下面）：后移入的那条排在前',
        fixtureBlock?.rows ?? [],
        [second, first],
      )
      check.eq('本地集合的顺序与展示顺序互为倒序（集合按移入顺序记）', afterSecondMove?.sessionIds ?? [], [first, second])
      screenshots.push(await shot(ctx, page, 'recycle-drawer-half'))

      // ---- ④ 提手：上拉吸附到 90% ----
      const handle = page.locator('[data-dshone-tree-action="recycle-handle"]')
      const handleBox = await handle.boundingBox()
      check.ok('提手在（可拖）', handleBox !== null, JSON.stringify(handleBox))
      if (handleBox !== null) {
        await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
        await page.mouse.down()
        await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y - 220, { steps: 12 })
        await page.mouse.up()
        await page.waitForTimeout(300)
        const dragged = await page.getAttribute('[data-dshone-tree="recycle-drawer"]', 'data-dshone-recycle-height')
        check.eq('上拉松手后吸附到 90% 档', dragged, '90')
        screenshots.push(await shot(ctx, page, 'recycle-drawer-expanded'))
      }

      // ---- ⑤ 块头折叠 + 折叠态持久化（客户端存储） ----
      const blockKeys = (drawer?.blocks ?? []).map((block) => block.key)
      const collapsedKey = blockKeys[0] ?? ''
      const rowsInBlock = (drawer?.blocks.find((block) => block.key === collapsedKey)?.rows.length ?? 0)
      await page.click(`[data-dshone-recycle-group-toggle="${collapsedKey}"]`)
      await page.waitForTimeout(250)
      const collapsedFacts = await page.evaluate((key: string) => {
        const toggle = document.querySelector(`[data-dshone-recycle-group-toggle="${key}"]`)
        const block = document.querySelector(`[data-dshone-recycle-group="${key}"]`)
        const prefs = localStorage.getItem('dsh.workspaceTree.view') ?? ''
        return {
          flag: toggle?.getAttribute('data-dshone-recycle-collapsed') ?? '',
          rows: block?.querySelectorAll('[data-dshone-recycle-row]').length ?? -1,
          prefs,
        }
      }, collapsedKey)
      check.fact(`折叠块 ${collapsedKey}：flag=${collapsedFacts.flag} 行数=${String(collapsedFacts.rows)} prefs=${collapsedFacts.prefs}`)
      check.eq('块头点一下收起（标记翻成 true）', collapsedFacts.flag, 'true')
      check.eq('收起后该块的行不再渲染', collapsedFacts.rows, 0)
      check.ok('折叠态落进官方惯例的客户端存储键（recycleCollapsed）', collapsedFacts.prefs.includes('recycleCollapsed') && collapsedFacts.prefs.includes(collapsedKey))
      check.ok('收起的块里本来是有行的（不是空块的自欺欺人）', rowsInBlock > 0, `rows=${String(rowsInBlock)}`)

      // 关掉再开：折叠态还在（视图态住在树组件里，随 prefs 走）。
      // 这一枚从 #154 起是抽屉头最左那枚「返回」（同一个动作、同一个标记，原来的 ✕ 由它接手）。
      await page.click('[data-dshone-tree-action="recycle-close"]')
      // 收起有滑出过渡（#117）：等过渡跑完抽屉才从 DOM 里消失，所以这里等得比过渡长。
      await page.waitForTimeout(400)
      check.eq('点抽屉头的返回收起抽屉', await contentCount(page, '[data-dshone-tree="recycle-drawer"]'), 0)
      await page.click('[data-dshone-tree-action="recycle-toggle"]')
      await page.waitForTimeout(350)
      check.eq('重新打开后折叠态仍在', await page.getAttribute(`[data-dshone-recycle-group-toggle="${collapsedKey}"]`, 'data-dshone-recycle-collapsed'), 'true')

      // ---- ⑥ 重载后仍生效（本地集合从宿主状态存储读回、折叠态从客户端存储读回） ----
      // 注入的就是旧侧栏那份文件的形状（`{version:1, sessionIds:[...]}`），并且故意多带
      // 一条 dsh 侧早已不存在的 id：清账（基线就绪时剔除认不出的 id）应当把它剔掉。
      const GHOST = 'session-lab-not-in-dsh'
      await page.addInitScript({
        content: `(() => { globalThis.__LAB_HOST__.stateStore['recycle-bin'] = ${JSON.stringify({ version: 1, sessionIds: [first, second, 'session-lab-not-in-dsh'] }) } })()`,
      })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector(route('sidebar').readySelector, { timeout: 40_000 })
      await page.waitForTimeout(2_500)
      const afterReload = (await hostRecycleBin(page)) as { sessionIds?: string[] } | null
      check.eq('重载后本地集合仍是那两条（旧文件形状读回来原样保留移入顺序）', afterReload?.sessionIds ?? [], [first, second])
      // 页面打开时原样读回 = 「旧 recycle-bin.json 一次性迁入」这件事的可执行口径
      //（键名与文件形状都是同一份，没有搬运步骤，见 pure/recycleBinState.ts 的说明）。
      check.eq('重载后入口角标 ≤2 且不含认不出的那条（角标与抽屉同源）', await entryCount(), '2')
      await page.waitForTimeout(1_200)
      const pruned = ((await hostRecycleBin(page)) as { sessionIds?: string[] } | null)?.sessionIds ?? []
      check.fact(`清账后宿主状态=${JSON.stringify(pruned)}（注入时多带了一条 ${GHOST}）`)
      check.eq('清账：dsh 侧已不存在的 id 被剔出本地集合，其余原样保留', pruned, [first, second])
      check.eq('清账不误伤：两条真的还在集合里（角标 2、抽屉里也有两行）', pruned.length, 2)
      await page.click('[data-dshone-tree-action="recycle-toggle"]')
      await page.waitForTimeout(350)
      const reloadedDrawer = await page.evaluate(() => {
        const root = document.querySelector('[data-dshone-tree="recycle-drawer"]')
        return {
          rows: root?.querySelectorAll('[data-dshone-recycle-row]').length ?? -1,
          collapsed: Array.from(root?.querySelectorAll('[data-dshone-recycle-group-toggle]') ?? []).map(
            (el) => `${el.getAttribute('data-dshone-recycle-group-toggle') ?? ''}=${el.getAttribute('data-dshone-recycle-collapsed') ?? ''}`,
          ),
        }
      })
      check.fact(`重载后抽屉：${JSON.stringify(reloadedDrawer)}`)
      check.ok(
        '重载后折叠态从客户端存储读回（那个块仍是收起）',
        reloadedDrawer.collapsed.includes(`${collapsedKey}=true`),
        JSON.stringify(reloadedDrawer.collapsed),
      )

      // ---- ⑦ 还原：只动本地状态，会话回到树里 ----
      // 先把上一步收起的块展开（被收起的块里没有行可点——这正是折叠生效的证据）。
      await page.click(`[data-dshone-recycle-group-toggle="${collapsedKey}"]`)
      await page.waitForTimeout(250)
      check.eq('再点一下块头 = 展开回来', await page.getAttribute(`[data-dshone-recycle-group-toggle="${collapsedKey}"]`, 'data-dshone-recycle-collapsed'), 'false')
      await page.click(`[data-dshone-recycle-restore="${first}"]`)
      await page.waitForTimeout(500)
      const afterRestore = (await hostRecycleBin(page)) as { sessionIds?: string[] } | null
      check.eq('还原只把这一条移出本地集合', afterRestore?.sessionIds ?? [], [second])
      await page.click('[data-dshone-tree-action="recycle-close"]')
      await page.waitForTimeout(250)
      check.eq('还原后会话回到我们树里', await contentCount(page, `[data-dshone-tree-session="${first}"]`), 1)
      await page.waitForTimeout(1_000)
      check.eq('还原也不动 dsh 侧（官方浏览区同样没变）', await officialRows(), officialBefore)

      // ---- ⑧ 清空 = 归档（= 删除）：先确认弹窗，取消则什么都不发生 ----
      await page.click('[data-dshone-tree-action="recycle-empty-all"]')
      await page.waitForTimeout(400)
      const confirm = await page.evaluate(() => {
        const root = document.querySelector('[data-dshone-tree-action="archive-confirm"]')?.closest('[role="dialog"], .dshOneTree_root, body')
        return {
          button: document.querySelector('[data-dshone-tree-action="archive-confirm"]') !== null,
          blocks: document.querySelectorAll('[data-dshone-archive-block]').length,
          rows: document.querySelectorAll('[data-dshone-archive-row]').length,
          text: root?.textContent ?? '',
        }
      })
      check.fact(`清空确认弹窗：按钮=${String(confirm.button)} 工作区块=${String(confirm.blocks)} 明细行=${String(confirm.rows)} 文案=${JSON.stringify(confirm.text.slice(0, 120))}`)
      check.ok('清空先开确认弹窗（不是直接执行）', confirm.button)
      check.ok('弹窗按工作区树形列明细（块 + 行都在）', confirm.blocks >= 1 && confirm.rows === 1)
      check.ok('弹窗写明不可恢复（归档 = 删除）', confirm.text.includes('不能在这里恢复') || confirm.text.includes('删除'), confirm.text.slice(0, 120))
      screenshots.push(await shot(ctx, page, 'recycle-empty-confirm'))
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
      const afterCancel = (await hostRecycleBin(page)) as { sessionIds?: string[] } | null
      check.eq('取消确认 → 本地集合一条不少', afterCancel?.sessionIds ?? [], [second])
      check.eq('取消确认 → 弹窗关掉', await contentCount(page, '[data-dshone-tree-action="archive-confirm"]'), 0)

      // ---- ⑨ 全部还原：入口行那一枚，同样只动本地状态 ----
      const restoreAllDisabled = await page.evaluate(
        () =>
          (document.querySelector('[data-dshone-tree-action="recycle-restore-all"]') as HTMLButtonElement | null)?.disabled ?? null,
      )
      check.eq('清空前「全部还原」可用', restoreAllDisabled, false)
      await page.click('[data-dshone-tree-action="recycle-restore-all"]')
      await page.waitForTimeout(500)
      const afterRestoreAll = (await hostRecycleBin(page)) as { sessionIds?: string[] } | null
      check.eq('全部还原后本地集合清空', afterRestoreAll?.sessionIds ?? [], [])
      check.eq('全部还原后入口角标归零', await entryCount(), '0')
      const disabledActions = await page.evaluate(() =>
        ['recycle-empty-all', 'recycle-restore-all'].map((action) => {
          const button = document.querySelector(`[data-dshone-tree-action="${action}"]`) as HTMLButtonElement | null
          return `${action}=${String(button?.disabled)}`
        }),
      )
      check.eq('计数 0 时两枚动作图标禁用（灰态）', disabledActions, ['recycle-empty-all=true', 'recycle-restore-all=true'])
      check.eq('全部还原后第二条也回到树里', await contentCount(page, `[data-dshone-tree-session="${second}"]`), 1)
      await page.waitForTimeout(1_000)
      check.eq('全部还原不动 dsh 侧（官方浏览区会话数不变）', await officialRows(), officialBefore)
      screenshots.push(await shot(ctx, page, 'recycle-restored-all'))

      // ---- ⑩ 归档项的资格判定接在真实会话状态上（禁用 = 有原因 + 有原因提示） ----
      // 一条会话一个事实：把前若干行逐个开菜单读「归档项」的判定结果，验
      // 「原因 ↔ 禁用 ↔ 提示」三者一致（四种原因分别是哪条，取决于当天网关上的会话状态，
      // 所以这里钉的是接线与一致性，纯判定的四态在单测 test/sessionActions.test.ts 里）。
      // 这一圈要逐个开 ⋯ 菜单读归档项，所以按「有 ⋯ 按钮」挑行（#109 起空白会话行也有
      // 行操作容器，只是没有按钮）。
      const probeRows = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-dshone-tree-row="session"]'))
          .filter((row) => row.querySelector('[data-dshone-tree-action="session-menu"]') !== null)
          .slice(0, 6)
          .map((row) => row.getAttribute('data-dshone-tree-session') ?? ''),
      )
      const archiveFacts: Array<{ id: string; reason: string; hint: string; disabled: boolean }> = []
      for (const id of probeRows) {
        const row = page.locator(`[data-dshone-tree-session="${id}"]`)
        await row.hover()
        await row.locator('.dshOneTree_rowIconButton').click()
        await page.waitForTimeout(200)
        archiveFacts.push(
          await page.evaluate((sessionId: string) => {
            const mark = document.querySelector('[data-dshone-tree-item="archive"]')
            const button = mark?.closest('button') as HTMLButtonElement | null
            return {
              id: sessionId,
              reason: mark?.getAttribute('data-dshone-disabled-reason') ?? 'missing',
              hint: mark?.getAttribute('title') ?? '',
              disabled: button?.disabled ?? false,
            }
          }, id),
        )
        await page.keyboard.press('Escape')
        await page.waitForTimeout(150)
      }
      check.fact(
        `归档项判定逐行实测：${archiveFacts.map((entry) => `${entry.reason || 'ok'}(禁用${String(entry.disabled)})`).join(' ')}`,
      )
      check.ok('每一条会话的归档项都带着判定结果（原因字段在场）', archiveFacts.length > 0 && archiveFacts.every((entry) => entry.reason !== 'missing'))
      check.ok(
        '判定结果与禁用态一致：有原因就禁用且给原因提示，没原因就可选',
        archiveFacts.every((entry) =>
          entry.reason === '' ? !entry.disabled && entry.hint === '' : entry.disabled && entry.hint !== '',
        ),
        JSON.stringify(archiveFacts),
      )
      check.ok(
        '原因取值只可能是判定里那几种（pinned / pending / running / descendantRunning / unread / 空）',
        archiveFacts.every((entry) => ['', 'pinned', 'pending', 'running', 'descendantRunning', 'unread'].includes(entry.reason)),
        archiveFacts.map((entry) => entry.reason).join(','),
      )
      const blocked = archiveFacts.filter((entry) => entry.reason !== '')
      if (blocked.length > 0) {
        screenshots.push(await shot(ctx, page, 'recycle-archive-blocked-hint'))
        check.fact(`被拦住的会话示例：${JSON.stringify(blocked[0])}`)
      }

      // ---- ⑪ 多选语境复用同一套动作与同一个弹窗（#103 第 6 条） ----
      // 先挑行（选择态下行内操作区不渲染，得在进入选择态之前挑），再进选择态点它们。
      // 挑法：优先带上状态不是 idle 的那些（它们按判定不能归档 → 才是「写明跳过数」
      // 那条断言的观察对象），再补几条空闲的。
      const picked = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('[data-dshone-tree-row="session"]')).filter(
          (row) => row.querySelector('.dshOneTree_rowActions') !== null,
        )
        const status = (row: Element): string => row.getAttribute('data-dshone-tree-status') ?? ''
        const chosen = [...rows.filter((row) => status(row) !== 'idle').slice(0, 2), ...rows.filter((row) => status(row) === 'idle').slice(0, 2)]
        return chosen.map((row) => ({ id: row.getAttribute('data-dshone-tree-session') ?? '', status: status(row) }))
      })
      await page.click('[data-dshone-tree-action="select-mode"]')
      await page.waitForTimeout(300)
      for (const entry of picked) {
        await page.locator(`[data-dshone-tree-session="${entry.id}"]`).click()
        await page.waitForTimeout(80)
      }
      const selected = await page.evaluate((ids: string[]) => {
        const marks = Array.from(document.querySelectorAll('[data-dshone-tree-row="session"]'))
          .filter((row) => ids.includes(row.getAttribute('data-dshone-tree-session') ?? ''))
          .map((row) => row.getAttribute('data-dshone-tree-checked') ?? '')
        return marks
      }, picked.map((entry) => entry.id))
      // 归档资格：状态不是 idle 的（运行中 / 等待交互）按判定会被跳过——这正是
      // 弹窗要「写明跳过数」的原因（置顶/未读那两个事实还没落地，见 sessionActions 说明）。
      const expectedSkipped = picked.filter((entry) => entry.status !== 'idle').length
      check.fact(`选择态选中 ${String(selected.length)} 行：${picked.map((entry) => `${entry.status || '?'}`).join(',')}（预期跳过 ${String(expectedSkipped)}）`)
      check.ok('进入选择态后点行 = 勾选（选中标记带上）', selected.length === picked.length && selected.every((value) => value === 'true'))
      check.ok('挑到的行里有可归档的（否则归档按钮本来就该禁用）', picked.length > expectedSkipped, JSON.stringify(picked))
      if (picked.length === 0 || picked.length === expectedSkipped) return screenshots
      await page.click('[data-dshone-tree-action="selection-archive"]')
      await page.waitForTimeout(400)
      const batchModal = await page.evaluate(() => ({
        button: document.querySelector('[data-dshone-tree-action="archive-confirm"]') !== null,
        rows: document.querySelectorAll('[data-dshone-archive-row]').length,
        blocks: document.querySelectorAll('[data-dshone-archive-block]').length,
        skipped: document.querySelector('[data-dshone-archive-skipped]')?.textContent ?? '',
      }))
      check.fact(`批量归档弹窗：${JSON.stringify(batchModal)}`)
      check.ok('多选操作条「归档」复用同一个确认弹窗（按工作区树形列明细）', batchModal.button && batchModal.blocks >= 1 && batchModal.rows >= 1)
      check.ok(
        '弹窗写明跳过数（与资格判定算出来的一致：有跳过就写明条数，没有就不出现这行）',
        expectedSkipped === 0 ? batchModal.skipped === '' : batchModal.skipped.includes(`另有 ${String(expectedSkipped)} 个`),
        `skipped=${JSON.stringify(batchModal.skipped)} expected=${String(expectedSkipped)}`,
      )
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
      check.eq('取消批量归档 → 弹窗关掉、本地集合没变（还是空）', (await hostRecycleBin(page) as { sessionIds?: string[] } | null)?.sessionIds ?? [], [])
      screenshots.push(await shot(ctx, page, 'recycle-batch-archive'))

      // 多选操作条「移入回收站」：立即执行 + 飘提示 + 退出选择态（本地可逆，无确认）。
      await page.click('[data-dshone-tree-action="selection-recycle"]')
      await page.waitForTimeout(600)
      const batchMoveFlash = await page.textContent('[data-dshone-tree="flash"]')
      const batchMoveState = (await hostRecycleBin(page)) as { sessionIds?: string[] } | null
      check.ok('批量移入回收站：飘一条回执', (batchMoveFlash ?? '').includes('回收站'), String(batchMoveFlash))
      check.eq('批量移入回收站：选中的都进了本地集合（按勾选顺序）', batchMoveState?.sessionIds ?? [], picked.map((entry) => entry.id))
      check.eq('批量移入回收站：动作完退出选择态（动作条消失）', await contentCount(page, '[data-dshone-tree="selection-bar"]'), 0)
      await page.waitForTimeout(1_200)
      check.eq('批量移入同样不动 dsh 侧（官方浏览区会话数不变）', await officialRows(), officialBefore)

      // 收尾：全部还原（本地可逆），让页面回到干净状态。
      await page.click('[data-dshone-tree-action="recycle-restore-all"]')
      await page.waitForTimeout(500)
      check.eq('批量移入的那些也能一次全部还原', (await hostRecycleBin(page) as { sessionIds?: string[] } | null)?.sessionIds ?? [], [])

      check.eq('两层语义套件全程零 pageerror', withoutKnownNoise(opened.capture.pageErrors).real, [])
    } finally {
      await official?.context.close()
      await opened.context.close()
    }
    return screenshots
  },
}

// ---------------------------------------------------------------------------
// F-16 TAG-GROUPS：会话标签组（#107）
// ---------------------------------------------------------------------------

/**
 * 在页面里造一次 HTML5 拖拽：自定义 MIME + `DragEvent`（落点可按 target 的中轴或上沿）。
 *
 * 为什么用合成事件而不是 Playwright 的 `dragAndDrop`：本插件判「拖的是什么」靠
 * `dataTransfer.types` 里的自定义 MIME（`text/dsh-session` / `text/dsh-tag`），
 * 原生拖拽在 CDP 下是否带上自定义类型取决于浏览器实现；这里用真实 `DataTransfer`
 * 造事件，走的仍是插件自己的那套判定（`dragstart` 写载荷 → `dragenter`/`dragover`
 * 高亮 → `drop` 读载荷），不绕过被验的代码。
 */
async function labDrag(
  page: OpenedPage['page'],
  source: string,
  target: string,
  mime: string,
  payload: string,
  where: 'center' | 'top' = 'center',
): Promise<void> {
  await page.evaluate(
    (args: { source: string; target: string; mime: string; payload: string; where: string }) => {
      const from = document.querySelector(args.source)
      const to = document.querySelector(args.target)
      if (from === null) throw new Error(`drag source missing: ${args.source}`)
      if (to === null) throw new Error(`drag target missing: ${args.target}`)
      const dataTransfer = new DataTransfer()
      dataTransfer.setData(args.mime, args.payload)
      const rect = to.getBoundingClientRect()
      const y = args.where === 'top' ? rect.top + 1 : rect.top + rect.height / 2
      const fire = (node: Element, type: string, useY: boolean): void => {
        node.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer, clientY: useY ? y : 0 }))
      }
      fire(from, 'dragstart', false)
      fire(to, 'dragenter', true)
      fire(to, 'dragover', true)
      fire(to, 'drop', true)
      fire(from, 'dragend', false)
    },
    { source, target, mime, payload, where },
  )
  await page.waitForTimeout(400)
}

/** 页面上所有标签组块的事实（块属于哪个分组键/哪个组、折叠标记、组内行、折叠计数）。 */
async function tagBlockFacts(
  page: OpenedPage['page'],
): Promise<Array<{ key: string; tag: string; collapsed: boolean; rows: string[]; counts: string }>> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-dshone-tree="tag-block"]')).map((block) => ({
      key: block.getAttribute('data-dshone-tree-key') ?? '',
      tag: block.getAttribute('data-dshone-tree-tag') ?? '',
      collapsed: block.getAttribute('data-dshone-tag-collapsed') === 'true',
      rows: Array.from(block.querySelectorAll('[data-dshone-tree-row="session"]')).map(
        (row) => row.getAttribute('data-dshone-tree-session') ?? '',
      ),
      counts: block.querySelector('[data-dshone-tree-tag-counts]')?.getAttribute('data-dshone-tree-tag-counts') ?? '',
    })),
  )
}

/** 打开某一行的 ⋯ 菜单（行菜单里的「标签组」一节与两项标记动作都从这里进）。 */
async function openRowMenu(page: OpenedPage['page'], sessionId: string): Promise<void> {
  const row = page.locator(`[data-dshone-tree-session="${sessionId}"]`)
  await row.hover()
  await row.locator('.dshOneTree_rowIconButton').click()
  await page.waitForTimeout(250)
}

/**
 * 打开某个标签组的 pill 菜单。
 *
 * 先 hover 组块再点：组头那枚 ⋯ 与工作区行/会话行的动作按钮同一处置——**悬停才显示**
 *（常显会一直在组名旁边晃）。所以必须先让指针落到组块上，按钮才有几何可点。
 */
async function openTagMenu(page: OpenedPage['page'], tagId: string): Promise<void> {
  const block = page.locator(`[data-dshone-tree-tag="${tagId}"]`)
  await block.hover()
  await page.waitForTimeout(150)
  await block.locator('[data-dshone-tree-action="tag-menu"]').click()
  await page.waitForTimeout(250)
}

/**
 * 页面上的标签组菜单项文案（按 `data-dshone-tree-item` 认我们那一份），外加整份菜单的
 * 文本。标题那一行是官方 Menu 的 `label` 类型项（只吃 text，挂不上标记属性），所以它
 * 只在整份文本里读到。
 */
async function tagMenuFacts(page: OpenedPage['page']): Promise<{ items: string[]; text: string }> {
  return page.evaluate(() => {
    const menus = Array.from(document.querySelectorAll('[role="menu"]'))
    const last = menus[menus.length - 1]
    return {
      items: Array.from(document.querySelectorAll('[data-dshone-tree-item^="tag-"]')).map((el) => el.textContent ?? ''),
      text: (last?.textContent ?? '').replace(/\s+/g, ' '),
    }
  })
}

interface LabTagBucket {
  tags?: Array<{ id: string; name: string; color: string }>
  sessionTags?: Record<string, string>
}

interface LabTagFile {
  version?: number
  workspaces?: Record<string, LabTagBucket>
}

export const TAG_GROUPS_SUITE: LabSuite = {
  id: 'F-16',
  phase: 'new-feature',
  name: '会话标签组（#107）：迁入 / 拖入拖出 / 组间拖拽换位 / 组内置顶 / 折叠计数 / 组菜单（TAG-GROUPS 套件）',
  expect:
    '#107 定的标签组语义在真实装配页上成立（真网关**只读** + 假宿主）：① **迁入**——把旧侧栏那份 `tags.json`（v2 形状，含内置组 Todo/Doing/Done 与一个从没成员的空气组）注进假宿主状态存储后，自建组与它的归属原样迁入，**旧内置组不再算组**（它们的会话回落「未归组」，会话说到底一条不动），空气组被清掉，写回的 `tags` 里**不再有 `collapsed` 字段**（折叠是纯视图态，走客户端存储）；② **拖入/拖出**——把一条会话拖到组块上就归进该组、拖到组外（工作区层）就移出分组，两次都只改我们自己的 `tags` 状态；③ **组间拖拽换位**——拖 pill 到另一个 pill 的上半 = 插到它前面，新顺序落回状态；④ **组内置顶**——菜单里置顶一条组内会话后，它排到**该组内**最前（组与组之间的相对位置不受影响）；⑤ **折叠 + 折叠计数**——点 pill 右侧三角收起组内行，组头右侧出现组内「待交互/运行中/未读」计数（每会话只进一个桶），折叠态落 `dsh.workspaceTree.view` 而不是 `tags.json`；⑥ **pill 菜单八项**（标题行 + 组内新建会话 / 整组归档 / 整组移入回收站 / 移出标签组 / 改名 / 颜色 / 删除组）全在，其中**两项危险动作走确认弹窗**（整组归档开 #103 那个归档确认弹窗并写明跳过数、删除组开删除确认弹窗），弹窗取消则什么都不发生；⑦ **整组移入回收站**是本地可逆那一层（立即执行 + 飘提示，不动 dsh 侧）；⑧ **空组处理**——组内成员走了、清了之后，组定义与归属一起被清掉（组只与成员一起出现，不留看不见也删不掉的空壳）。全程零 pageerror。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const opened = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { width: 380, height: 900 })
    const { page } = opened
    const tags = async (): Promise<LabTagFile | null> => (await hostState(page, 'tags')) as LabTagFile | null
    const bucketOf = async (key: string): Promise<LabTagBucket> => (await tags())?.workspaces?.[key] ?? {}
    try {
      await expandAllWorkspaces(page)
      // 夹具：同一工作区块里 ≥3 条带行菜单的会话（按「有 ⋯ 按钮」认——#109 起空白会话行也
      // 挂行操作容器，但它没有按钮可点）。
      // 三条各有去处：一条原本在旧内置组里（迁入后该回落未归组）、一条在自建组里、
      // 一条用来拖来拖去。
      const fixture = await page.evaluate(() => {
        for (const section of Array.from(document.querySelectorAll('[data-dshone-group-key]'))) {
          const rows = Array.from(section.querySelectorAll('[data-dshone-tree-row="session"]')).filter(
            (row) => row.querySelector('[data-dshone-tree-action="session-menu"]') !== null,
          )
          if (rows.length >= 3) {
            return {
              key: section.getAttribute('data-dshone-group-key') ?? '',
              ids: rows.slice(0, 3).map((row) => row.getAttribute('data-dshone-tree-session') ?? ''),
            }
          }
        }
        return null
      })
      check.fact(`夹具：${JSON.stringify(fixture)}`)
      check.ok('找到一个有 ≥3 条可操作会话行的工作区块', fixture !== null && fixture.ids.every((id) => id !== ''))
      if (fixture === null || !fixture.ids.every((id) => id !== '')) return screenshots
      const inPreset = fixture.ids[0] as string
      const inGroup = fixture.ids[1] as string
      const spare = fixture.ids[2] as string
      check.fact(`夹具会话：旧内置组里的 ${inPreset}、自建组里的 ${inGroup}、用来拖的 ${spare}（同在 ${fixture.key} 块）`)

      // ---- ① 迁入：旧 tags.json（v2 形状）注进假宿主状态存储，重载后应由新树接手 ----
      // 三样东西各验一条：自建组原样迁入、旧内置组不再算组、空气组被清掉。
      const legacy = {
        version: 2,
        workspaces: {
          [fixture.key]: {
            tags: [
              { id: 'preset-todo', name: null, color: 'yellow' },
              { id: 't-lab', name: '实验室组', color: 'purple' },
              { id: 't-empty', name: '空组', color: 'red' },
            ],
            sessionTags: { [inPreset]: 'preset-todo', [inGroup]: 't-lab' },
            collapsed: ['preset-todo'],
          },
        },
      }
      await page.addInitScript({
        content: `(() => { globalThis.__LAB_HOST__.stateStore['tags'] = ${JSON.stringify(legacy)} })()`,
      })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector(route('sidebar').readySelector, { timeout: 40_000 })
      await page.waitForTimeout(2_500)
      await expandAllWorkspaces(page)
      const migratedBlocks = await tagBlockFacts(page)
      check.fact(`迁入后页面上的标签组块：${JSON.stringify(migratedBlocks)}`)
      check.eq('旧内置组不再算组：一个块都不渲染', migratedBlocks.filter((block) => block.tag === 'preset-todo').length, 0)
      check.eq('自建组原样迁入并渲染成块', migratedBlocks.filter((block) => block.tag === 't-lab').length, 1)
      check.ok(
        '块内就是原来归在那组的会话',
        migratedBlocks.find((block) => block.tag === 't-lab')?.rows.includes(inGroup) === true,
        JSON.stringify(migratedBlocks),
      )
      check.ok(
        '旧内置组里的会话回落「未归组」（会话本身一条不动）',
        !migratedBlocks.some((block) => block.rows.includes(inPreset)),
        JSON.stringify(migratedBlocks),
      )
      check.eq('从没成员的空气组被清掉（空组处理）', migratedBlocks.filter((block) => block.tag === 't-empty').length, 0)
      await page.waitForTimeout(1_200)
      const migrated = await bucketOf(fixture.key)
      check.fact(`迁入后宿主状态存储里的桶=${JSON.stringify(migrated)}`)
      check.eq('写回的组只剩自建的那一个（旧内置组与空气组的定义都没了）', (migrated.tags ?? []).map((tag) => tag.id), ['t-lab'])
      check.eq('归属只留指向已知组的（旧内置组的归属一并清掉）', migrated.sessionTags ?? {}, { [inGroup]: 't-lab' })
      check.ok('折叠字段不再进 tags.json（纯视图态走客户端存储）', JSON.stringify(await tags()).includes('collapsed') === false)
      screenshots.push(await shot(ctx, page, 'tag-groups-migrated'))

      // ---- ② 拖入组 / 拖出组 ----
      await labDrag(page, `[data-dshone-tree-session="${spare}"]`, `[data-dshone-tree-tag="t-lab"]`, 'text/dsh-session', spare)
      check.eq('拖一条会话进组：归属写进宿主状态存储', (await bucketOf(fixture.key)).sessionTags?.[spare], 't-lab')
      check.ok(
        '块内的行跟着变多（渲染与状态同源）',
        (await tagBlockFacts(page)).find((block) => block.tag === 't-lab')?.rows.includes(spare) === true,
      )
      screenshots.push(await shot(ctx, page, 'tag-groups-drag-in'))

      await labDrag(
        page,
        `[data-dshone-tree-session="${spare}"]`,
        `[data-dshone-group-key="${fixture.key}"][data-dshone-tree-drop="ungroup"]`,
        'text/dsh-session',
        spare,
      )
      check.ok(
        '拖到组外 = 移出分组（归属被清掉）',
        (await bucketOf(fixture.key)).sessionTags?.[spare] === undefined,
        JSON.stringify((await bucketOf(fixture.key)).sessionTags),
      )
      check.ok(
        '移出后这一行回到未归组（不再落在任何组块里）',
        !(await tagBlockFacts(page)).some((block) => block.rows.includes(spare)),
      )

      // ---- ③ 新建第二个组（会话行 ⋯ → 「移到分组…」二级菜单 → 新建标签组…）----
      // #109 起这一节住在「移到分组…」的就地展开里（不再是菜单末尾的一节），先点开父项。
      await openRowMenu(page, spare)
      await page.click('[data-dshone-tree-item="moveToGroup"]')
      await page.waitForTimeout(250)
      const rowTagSection = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-dshone-tree-item^="tag:"]')).map((el) => el.textContent ?? ''),
      )
      check.fact(`行菜单「移到分组…」里的项：${JSON.stringify(rowTagSection)}`)
      check.ok('会话行菜单里有「新建标签组…」与「不归入标签组」', rowTagSection.includes('新建标签组') && rowTagSection.includes('不归入标签组'))
      check.ok('菜单里列出了本工作区已有的组', rowTagSection.includes('实验室组'))
      await page.click('[data-dshone-tree-item="tag:__new"]')
      await page.waitForTimeout(300)
      check.eq('「新建标签组…」开出新建弹窗（名字 + 6 色）', await contentCount(page, '[data-dshone-tree="tag-name-input"]'), 1)
      await page.fill('[data-dshone-tree="tag-name-input"]', '乙组')
      await page.click('[data-dshone-tag-color="green"]')
      await page.click('[data-dshone-tree-action="tag-create-confirm"]')
      await page.waitForTimeout(500)
      const afterCreate = await bucketOf(fixture.key)
      const createdTag = (afterCreate.tags ?? []).find((tag) => tag.name === '乙组')
      check.fact(`新建后的桶：${JSON.stringify(afterCreate)}`)
      check.ok('新建的组落进宿主状态存储（颜色取点的那一枚绿）', createdTag !== undefined && createdTag.color === 'green')
      check.ok('新建组同时把触发它的那条会话归进去（组只与成员一起出现）', createdTag !== undefined && afterCreate.sessionTags?.[spare] === createdTag.id)
      screenshots.push(await shot(ctx, page, 'tag-groups-created'))

      // ---- ④ 组间拖拽换位：把新组拖到第一个 pill 的上半 = 插到它前面 ----
      const createdId = createdTag?.id ?? ''
      const orderBefore = (await tagBlockFacts(page)).filter((block) => block.key === fixture.key).map((block) => block.tag)
      check.fact(`换位前组顺序=${JSON.stringify(orderBefore)}`)
      await labDrag(page, `[data-dshone-tree-tag-pill="${createdId}"]`, '[data-dshone-tree-tag-pill="t-lab"]', 'text/dsh-tag', createdId, 'top')
      const orderAfter = (await tagBlockFacts(page)).filter((block) => block.key === fixture.key).map((block) => block.tag)
      check.fact(`换位后组顺序=${JSON.stringify(orderAfter)}`)
      check.eq('拖 pill 到另一个 pill 的上半 = 插到它前面', orderAfter, [createdId, 't-lab'])
      check.eq('新顺序落回宿主状态存储', (await bucketOf(fixture.key)).tags?.map((tag) => tag.id) ?? [], [createdId, 't-lab'])
      screenshots.push(await shot(ctx, page, 'tag-groups-reorder'))

      // ---- ⑤ 组内置顶：把一条会话拖回实验室组，再置顶组内另一条 ----
      await labDrag(page, `[data-dshone-tree-session="${inPreset}"]`, `[data-dshone-tree-tag="t-lab"]`, 'text/dsh-session', inPreset)
      const labBefore = (await tagBlockFacts(page)).find((block) => block.tag === 't-lab')
      check.eq('实验室组里现在有两条会话', labBefore?.rows.length, 2)
      const second = labBefore?.rows[1] ?? ''
      check.fact(`置顶前实验室组内顺序=${JSON.stringify(labBefore?.rows)}`)
      await openRowMenu(page, second)
      await page.click('[data-dshone-tree-item="pin"]')
      await page.waitForTimeout(500)
      const labAfter = (await tagBlockFacts(page)).find((block) => block.tag === 't-lab')
      check.eq('组内置顶：被置顶的那条排到该组最前（其余保持官方顺序）', labAfter?.rows ?? [], [second, labBefore?.rows[0] ?? ''])
      check.eq('组与组之间的相对位置不受组内置顶影响', (await tagBlockFacts(page)).filter((block) => block.key === fixture.key).map((block) => block.tag), [createdId, 't-lab'])
      screenshots.push(await shot(ctx, page, 'tag-groups-pin'))

      // ---- ⑥ 折叠 + 折叠计数（用只有一个成员的乙组，计数好数） ----
      // 「标为未读」在运行中（或后代在跑）的会话上是禁用的（#102 的保护规则），而网关数据是
      // 活的（别的 session 随时在跑回合）：先看这一行现在能不能标，不能就记事实跳过这一步；
      // 计数断言改成跟组内成员的真实状态对照，不赌数据。
      await openRowMenu(page, spare)
      const unreadEnabled = await page.evaluate(() => {
        const button = document.querySelector('[data-dshone-tree-item="unread"]')?.closest('button') ?? null
        return button !== null && !(button as HTMLButtonElement).disabled
      })
      if (unreadEnabled) {
        await page.click('[data-dshone-tree-item="unread"]')
        await page.waitForTimeout(400)
      } else {
        await page.keyboard.press('Escape')
        await page.waitForTimeout(200)
        check.fact('乙组那一条这会儿跑着（或后代在跑）→ 「标为未读」按 #102 的规则禁用，跳过「标未读」这一步')
      }
      // 折叠前记下组内每一条的真实状态（折叠后行就不渲染了，量不到）。
      const memberStates = await page.evaluate(
        (tag: string) =>
          Array.from(document.querySelectorAll(`[data-dshone-tree-tag="${tag}"] [data-dshone-tree-row="session"]`)).map((row) => ({
            status: row.getAttribute('data-dshone-tree-status') ?? '',
            unread: (row.querySelector('.dshOneTree_title')?.className ?? '').includes('dshOneTree_unread'),
          })),
        createdId,
      )
      const expectedCounts = [
        memberStates.filter((m) => m.status === 'waiting').length,
        memberStates.filter((m) => m.status !== 'waiting' && m.status === 'running').length,
        memberStates.filter((m) => m.status !== 'waiting' && m.status !== 'running' && m.unread).length,
      ].join('/')
      await page.click(`[data-dshone-tree-tag="${createdId}"] [data-dshone-tree-action="tag-toggle"]`)
      await page.waitForTimeout(350)
      const collapsed = (await tagBlockFacts(page)).find((block) => block.tag === createdId)
      check.fact(`折叠后的乙组=${JSON.stringify(collapsed)}（折叠前成员状态=${JSON.stringify(memberStates)}）`)
      check.eq('点三角收起：组内行不再渲染', collapsed?.rows.length, 0)
      check.eq('折叠标记写在块上', collapsed?.collapsed, true)
      check.eq('折叠时组头出「待交互/运行中/未读」计数，且与组内成员的真实状态同源', collapsed?.counts, expectedCounts)
      check.eq(
        '三个桶相加 = 组内成员数（每会话只进一个桶）',
        (collapsed?.counts ?? '').split('/').reduce((sum, n) => sum + Number(n), 0),
        memberStates.length,
      )
      const prefsText = await page.evaluate(() => localStorage.getItem('dsh.workspaceTree.view') ?? '')
      check.ok('折叠态落客户端存储（官方惯例的 dsh.workspaceTree.view，不是 tags.json）', prefsText.includes('tagCollapsed'))
      check.ok('折叠态没写进持久状态（tags.json 里没有折叠字段）', JSON.stringify(await tags()).includes('collapsed') === false)
      await page.click(`[data-dshone-tree-tag="${createdId}"] [data-dshone-tree-action="tag-toggle"]`)
      await page.waitForTimeout(350)
      check.eq('再点一下 = 展开回来', (await tagBlockFacts(page)).find((block) => block.tag === createdId)?.rows.length, 1)

      // ---- ⑦ pill 菜单八项 ----
      await openTagMenu(page, 't-lab')
      const menu = await tagMenuFacts(page)
      check.fact(`标签组菜单：${JSON.stringify(menu)}`)
      const menuHas = (needle: string): boolean =>
        menu.items.some((text) => text.includes(needle)) || menu.text.includes(needle)
      check.ok('八项之一：标题行（写着这是哪个组）', menuHas('标签组：实验室组'))
      check.ok('八项之二：组内新建会话', menuHas('在此标签组中新建会话'))
      check.ok('八项之三：整组归档（带条数）', menuHas('归档整组（2 个会话）'))
      check.ok('八项之四：整组移入回收站（带条数）', menuHas('整组移入回收站（2 个会话）'))
      check.ok('八项之五：移出标签组', menuHas('移出标签组'))
      check.ok('八项之六：改名', menuHas('重命名标签组'))
      check.ok('八项之七：颜色（6 色各一项）', ['黄色', '蓝色', '绿色', '橙色', '紫色', '红色'].every((name) => menuHas(name)))
      check.ok('八项之八：删除组', menuHas('删除标签组'))
      screenshots.push(await shot(ctx, page, 'tag-groups-menu'))

      // ---- ⑧ 危险动作一：删除组 → 确认弹窗；取消则什么都不发生 ----
      await page.click('[data-dshone-tree-item="tag-delete"]')
      await page.waitForTimeout(300)
      check.eq('「删除标签组」开出确认弹窗', await contentCount(page, '[data-dshone-tree-action="tag-delete-confirm"]'), 1)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
      check.eq('弹窗关掉', await contentCount(page, '[data-dshone-tree-action="tag-delete-confirm"]'), 0)
      check.ok(
        '取消删除后组还在（弹窗只是确认，不是删除动作本身）',
        (await bucketOf(fixture.key)).tags?.some((tag) => tag.id === 't-lab') === true,
      )

      // ---- ⑨ 危险动作二：整组归档 → #103 那个归档确认弹窗（含跳过数）；取消则什么都不发生 ----
      await openTagMenu(page, 't-lab')
      await page.click('[data-dshone-tree-item="tag-archive"]')
      await page.waitForTimeout(350)
      check.eq('「整组归档」开的是 #103 的归档确认弹窗', await contentCount(page, '[data-dshone-tree-action="archive-confirm"]'), 1)
      const archiveModal = await page.evaluate(() => {
        const blocks = document.querySelector('[data-dshone-archive-blocks]')
        return {
          total: blocks?.getAttribute('data-dshone-archive-blocks') ?? '',
          rows: blocks?.querySelectorAll('[data-dshone-archive-row]').length ?? 0,
          skipped: document.querySelector('[data-dshone-archive-skipped]')?.getAttribute('data-dshone-archive-skipped') ?? '',
        }
      })
      check.fact(`归档确认弹窗：${JSON.stringify(archiveModal)}`)
      check.eq('弹窗列出整组里够格归档的那条', archiveModal.rows, 1)
      check.eq('被置顶那条写明跳过了（资格判定不由整组动作绕过）', archiveModal.skipped, '1')
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
      check.eq('取消后弹窗关掉', await contentCount(page, '[data-dshone-tree-action="archive-confirm"]'), 0)
      check.eq('取消归档后组里还是两条（一个字节没动）', (await tagBlockFacts(page)).find((block) => block.tag === 't-lab')?.rows.length, 2)

      // ---- ⑩ 整组移入回收站（本地可逆那一层）：立即执行，只动我们自己的集合 ----
      await openTagMenu(page, createdId)
      await page.click('[data-dshone-tree-item="tag-recycle"]')
      await page.waitForTimeout(800)
      check.eq('整组移入回收站：成员进了本地回收站集合', (await hostState(page, 'recycle-bin') as { sessionIds?: string[] } | null)?.sessionIds ?? [], [spare])
      check.ok('挪走的会话不再在树里渲染（组块里也没有它）', !(await tagBlockFacts(page)).some((block) => block.rows.includes(spare)))
      const afterRecycle = await bucketOf(fixture.key)
      check.fact(`整组移入回收站后的桶=${JSON.stringify(afterRecycle)}`)
      check.ok(
        '回收站里的会话仍算组员：组与归属都留着（还原回来还在这个组里，不被顺手解散）',
        afterRecycle.tags?.some((tag) => tag.id === createdId) === true && afterRecycle.sessionTags?.[spare] === createdId,
        JSON.stringify(afterRecycle),
      )
      screenshots.push(await shot(ctx, page, 'tag-groups-recycle-keeps-group'))

      // ---- ⑪ 移出标签组：整组成员一起离开 ----
      await openTagMenu(page, 't-lab')
      await page.click('[data-dshone-tree-item="tag-ungroup"]')
      await page.waitForTimeout(800)
      const afterUngroup = await bucketOf(fixture.key)
      check.fact(`整组移出后宿主状态存储里的桶=${JSON.stringify(afterUngroup)}`)
      check.ok(
        '整组移出：这一组的归属全清掉了',
        afterUngroup.sessionTags?.[inPreset] === undefined && afterUngroup.sessionTags?.[inGroup] === undefined,
        JSON.stringify(afterUngroup.sessionTags),
      )
      check.eq('移出的会话仍留在树里（行还在，只是不归组）', await contentCount(page, `[data-dshone-tree-session="${inPreset}"]`), 1)

      // ---- ⑫ 空组处理：成员走光的组，定义与归属一起清掉 ----
      check.ok(
        '空组处理：成员走光后组定义也没了（不留看不见也删不掉的空壳）',
        afterUngroup.tags?.some((tag) => tag.id === 't-lab') !== true,
        JSON.stringify(afterUngroup),
      )
      check.ok(
        '清理只针对空掉的那个组（另一组原样保留）',
        afterUngroup.tags?.some((tag) => tag.id === createdId) === true,
        JSON.stringify(afterUngroup),
      )
      check.ok('那个组的块也不再渲染', !(await tagBlockFacts(page)).some((block) => block.tag === 't-lab'))
      screenshots.push(await shot(ctx, page, 'tag-groups-empty-pruned'))

      check.eq('标签组套件全程零 pageerror', withoutKnownNoise(opened.capture.pageErrors).real, [])
    } finally {
      await opened.context.close()
    }
    return screenshots
  },
}

// ---------------------------------------------------------------------------
// F-17 SIDEBAR-MULTI-SELECT：侧栏多选与批量（#108：F-16 已被 #107 的标签组套件占用）
// ---------------------------------------------------------------------------

/** 一个分组的组头三态现状（行上的态 + 框上画的态）。 */
interface GroupCheckFact {
  key: string
  /** 行上的 `data-dshone-tree-check`：none / some / all；不在选择态时是 missing。 */
  row: string
  /** 框自己的 `data-dshone-tree-check`（同一个值，从框上读一遍防两处漂移）。 */
  box: string
  aria: string
  tip: string
  /** 框里画的是短横线（部分选中）。 */
  dash: boolean
  /** 框里有几个子元素（全选时是官方对勾图标 = 1，空态 = 0，短横线 = 1）。 */
  glyph: number
  /** 组里的会话数（行上带的 `data-dshone-tree-count`）。 */
  count: number
}

/** 逐个分组读组头三态。 */
async function groupCheckFacts(page: OpenedPage['page']): Promise<GroupCheckFact[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-dshone-group-key]')).map((section) => {
      const head = section.querySelector('[data-dshone-tree-row="workspace"]')
      const box = head?.querySelector('[data-dshone-tree-action="group-select"]') ?? null
      return {
        key: section.getAttribute('data-dshone-group-key') ?? '',
        row: head?.getAttribute('data-dshone-tree-check') ?? 'missing',
        box: box?.getAttribute('data-dshone-tree-check') ?? 'missing',
        aria: box?.getAttribute('aria-checked') ?? '',
        tip: box?.getAttribute('title') ?? '',
        dash: box?.querySelector('.dshOneTree_checkDash') !== null,
        glyph: box?.querySelector('.dshOneTree_checkBox')?.childElementCount ?? -1,
        count: Number(head?.getAttribute('data-dshone-tree-count') ?? '-1'),
      }
    }),
  )
}

/** 选择态下的现状：勾了哪些行、动作条计数、红字、飘提示。 */
async function selectionFacts(page: OpenedPage['page']): Promise<{
  checked: readonly string[]
  count: string
  error: string
  bar: boolean
  flash: string
}> {
  return page.evaluate(() => {
    const bar = document.querySelector('[data-dshone-tree="selection-bar"]')
    return {
      checked: Array.from(document.querySelectorAll('[data-dshone-tree-checked="true"]')).map(
        (row) => row.getAttribute('data-dshone-tree-session') ?? '',
      ),
      count: bar?.querySelector('.dshOneTree_selectionCount')?.textContent ?? '',
      error: bar?.querySelector('.dshOneTree_selectionError')?.textContent ?? '',
      bar: bar !== null,
      flash: document.querySelector('[data-dshone-tree="flash"]')?.textContent ?? '',
    }
  })
}

/** 某一个工作区块里会话行的 id 与活状态（挑夹具用）。 */
async function groupRowIds(
  page: OpenedPage['page'],
  key: string,
): Promise<readonly { id: string; status: string; menu: boolean }[]> {
  return page.evaluate((groupKey: string) => {
    const section = document.querySelector(`[data-dshone-group-key="${groupKey}"]`)
    return Array.from(section?.querySelectorAll('[data-dshone-tree-row="session"]') ?? []).map((row) => ({
      id: row.getAttribute('data-dshone-tree-session') ?? '',
      status: row.getAttribute('data-dshone-tree-status') ?? '',
      menu: row.querySelector('[data-dshone-tree-action="session-menu"]') !== null,
    }))
  }, key)
}

/**
 * 侧栏多选与批量（#108）：入口 API、组头三态全选、分组条下方那条操作条、批量两个
 * 动作分开（移入回收站立即执行 / 归档走确认弹窗）、失败留选中、飘提示出现与消失、
 * 搜索结果行可勾选。
 *
 * 数据面与其它侧栏套件一致：真实网关只读 + 假宿主。本套件**从不点归档确认**
 *（那会写真实网关），归档这条验的是「先开确认弹窗 + 弹窗里的跳过数」这条前置链路；
 * 批量移入回收站只动本地状态，所以可以真点（结尾全部还原）。
 */
export const MULTI_SELECT_SUITE: LabSuite = {
  id: 'F-17',
  phase: 'new-feature',
  name: '侧栏多选与批量（#108）：入口 API + 组头三态全选 + 分组条下方的操作条 + 批量两动作 + 失败留选中（MULTI-SELECT 套件）',
  expect:
    '真实装配页（真网关只读 + 假宿主）：① **入口 API**——选择态只有一个入口（`selectionEntrySignal.enter()`），顶部工具栏那一枚就是它（本套件每一次「进选择态」都点这一枚 = 每一次都在走这个 API）；② **组头三态全选**——进选择态后每个工作区组头出一枚三态框，`none → some/all` 随勾选翻转，点一下把本组**够格**的成员一次勾上、再点一下取消；**组内有置顶会话时最满只能 some**（框里画短横线而不是对勾），悬停给出原因；收起着的工作区也能一次勾满（成员按整组数，不看折叠态）；③ **资格**——置顶行不可勾选（灰框 + 原因 + 点了不切换），运行中/未读/待交互可勾；④ **操作条位置**——分组过滤条在选择态下**不收起**（#135 起它住在顶栏那一行里），操作条排在它之后（文档顺序可证），条上是「已选 N 项 + 移入回收站 + 归档 + 取消」；⑤ **批量两个动作分开**——「移入回收站」立即执行、不开弹窗、飘一条回执、动作完退出选择态、只写本地集合；「归档」开同一个确认弹窗（按工作区列明细 + 写明跳过数），Esc 取消则什么都不发生；⑥ **失败不静默**——注入一次 state.write 失败后批量移入，失败项**留在勾选里**、动作条不消失、红字写明确条数；⑦ **飘提示**——出现后约 2.2 秒自己消失；⑧ **搜索结果行可勾选**（C8）——搜索态下点结果行 = 勾选，资格与树里的行同一份判定；⑨ 选择态下会话行的时间 / ⋯ 菜单 / 右键菜单 / 悬停卡都让位。全程零 pageerror，且**从不点归档确认**。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const selectButton = '[data-dshone-tree-action="select-mode"]'
    const checkOf = async (page: OpenedPage['page'], id: string): Promise<string | null> =>
      page.getAttribute(`[data-dshone-tree-session="${id}"]`, 'data-dshone-tree-checked')

    // 一、先开一次页面摸清夹具：需要一个「≥2 条带行菜单的会话行」的工作区块（一条拿
    // 去置顶，另一条用来验组头 some），另需一个**不含置顶**的组验 all。
    const probe = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { width: 380, height: 900 })
    let sections: LabSection[] = []
    try {
      await expandAllGroups(probe.page)
      sections = await sectionRows(probe.page)
    } finally {
      await probe.context.close()
    }
    const menuRows = sections
      .map((section) => ({ key: section.key, rows: section.sessions.filter((row) => row.menu) }))
      .filter((entry) => entry.rows.length >= 2)
    const fixture = menuRows[0]
    const pinnedTarget = fixture?.rows[0]?.id
    const freeTarget = fixture?.rows[1]?.id
    const otherGroup = sections.find(
      (section) => section.key !== fixture?.key && section.sessions.some((row) => row.menu),
    )
    check.fact(
      `夹具：分组 ${String(sections.length)} 个；带 ≥2 条行菜单的分组=${fixture?.key.slice(0, 10) ?? '无'}（置顶 ${pinnedTarget?.slice(0, 13) ?? '无'} / 空闲 ${freeTarget?.slice(0, 13) ?? '无'}）；另一组=${otherGroup?.key.slice(0, 10) ?? '无'}`,
    )
    if (fixture === undefined || pinnedTarget === undefined || freeTarget === undefined || otherGroup === undefined) {
      check.ok('真网关上找到两组夹具（一组 ≥2 条可操作行、另有一组无置顶）', false, '夹具不足')
      return screenshots
    }

    // 二、带注入态开页：置顶注入旧形状（裸 id 数组），组头三态的置顶约束才有观察对象。
    const opened = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), {
      width: 380,
      height: 900,
      state: { pinned: [pinnedTarget] },
    })
    const { page } = opened
    try {
      await expandAllGroups(page)
      const fixtureRows = await groupRowIds(page, fixture.key)
      const pinnedHere = fixtureRows.filter((row) => row.id === pinnedTarget).length
      check.fact(`置顶组 ${fixture.key.slice(0, 10)}：行=${JSON.stringify(fixtureRows.map((row) => `${row.id.slice(0, 11)}:${row.status}`))}`)
      check.ok('夹具成立：置顶那条在所选分组里（组头三态的置顶约束才有对象）', pinnedHere === 1)

      // ---- ① 进选择态（走的就是入口 API：工具栏那一枚 → selectionEntrySignal.enter）----
      const beforeSelect = await groupCheckFacts(page)
      check.ok(
        '未进选择态时组头没有三态框（`data-dshone-tree-check` 不在行上）',
        beforeSelect.every((entry) => entry.row === 'missing' && entry.box === 'missing'),
        JSON.stringify(beforeSelect.slice(0, 2)),
      )
      await page.click(selectButton)
      await page.waitForTimeout(300)
      const entered = await selectionFacts(page)
      check.eq('进选择态：动作条出现', entered.bar, true)
      check.eq('进选择态：勾选是空的（入口 API 每次进入都清空上一轮）', entered.checked, [])
      check.eq('动作条文案 = 未选任何会话', entered.count, '未选任何会话')
      check.eq('进选择态：工具栏那枚按钮按下去（aria-pressed）', await page.getAttribute(selectButton, 'aria-pressed'), 'true')

      // ---- ③ 资格：置顶行不可勾（灰框 + 原因 + 点了不切换）----
      const pinnedEligibility = await page.evaluate((id: string) => {
        const row = document.querySelector(`[data-dshone-tree-session="${id}"]`)
        return {
          check: row?.getAttribute('data-dshone-tree-check') ?? 'missing',
          tip: row?.querySelector('.dshOneTree_check')?.getAttribute('title') ?? '',
          dotted: row?.querySelector('.dshOneTree_checkOff') !== null,
        }
      }, pinnedTarget)
      check.fact(`置顶行的勾选资格：${JSON.stringify(pinnedEligibility)}`)
      check.ok(
        '置顶行不可勾选（行上标 blocked + 框画灰 + 带原因提示）',
        pinnedEligibility.check === 'blocked' && pinnedEligibility.dotted && pinnedEligibility.tip.includes('置顶会话不能移入回收站或归档'),
        JSON.stringify(pinnedEligibility),
      )
      await page.locator(`[data-dshone-tree-session="${pinnedTarget}"]`).click()
      await page.waitForTimeout(200)
      check.eq('点置顶行也不切换勾选（仍未被勾上）', await checkOf(page, pinnedTarget), 'false')
      check.eq('点置顶行不改变勾选数（还是空）', (await selectionFacts(page)).checked, [])

      // ---- ④ 操作条在分组过滤条下方（且过滤条不收起）----
      const order = await page.evaluate(() => {
        const area = document.querySelector('.dshOneTree_listArea')
        const filter = document.querySelector('[data-dshone-tree="group-filter"]')
        const bar = document.querySelector('[data-dshone-tree="selection-bar"]')
        const list = document.querySelector('.dshOneTree_list')
        const position = (a: Element | null, b: Element | null): number => {
          if (a === null || b === null) return -2
          const rel = a.compareDocumentPosition(b)
          return (rel & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 ? 1 : -1
        }
        return {
          inArea: bar !== null && area !== null && area.contains(bar),
          // #135：分组过滤条已并进顶栏那一行，不再住在列表区——它仍在场、只是换了位置。
          inTopBar: filter !== null && document.querySelector('[data-dshone-tree="top-bar"]')?.contains(filter) === true,
          filterBeforeBar: position(filter, bar),
          barBeforeList: position(bar, list),
          // 分组过滤条在选择态下仍在（#108 改掉了「选择态收起过滤条」）。
          filterVisible: filter !== null && (filter as HTMLElement).offsetParent !== null,
        }
      })
      check.fact(`选择态的条序：${JSON.stringify(order)}`)
      check.ok('选择态动作条在列表区里', order.inArea)
      check.ok(
        '分组过滤条在选择态下**不收起**（#108 起它常驻；#135 起它住在顶栏那一行里）',
        order.filterVisible && order.inTopBar,
        JSON.stringify(order),
      )
      check.ok('操作条排在分组过滤条**之后**（文档顺序：顶栏那一行在前、操作条在后）', order.filterBeforeBar === 1, JSON.stringify(order))
      check.ok('操作条在会话列表**上方**', order.barBeforeList === 1, JSON.stringify(order))

      // ---- ② 组头三态：none →（点一下）some（组内有置顶） ----
      const atNone = (await groupCheckFacts(page)).find((entry) => entry.key === fixture.key)
      check.fact(`置顶组组头（未勾）：${JSON.stringify(atNone)}`)
      check.eq('置顶组初始态 = none', atNone?.row, 'none')
      check.eq('none 态：框上 aria-checked = false、没有短横线', `${String(atNone?.aria)}/${String(atNone?.dash)}`, 'false/false')
      check.ok(
        '组内有置顶 → 框上写明原因（悬停提示说的是置顶挡住的条数）',
        (atNone?.tip ?? '').includes('置顶') && (atNone?.tip ?? '').includes('1'),
        JSON.stringify(atNone?.tip),
      )
      const eligibleInFixture = fixtureRows.filter((row) => row.id !== pinnedTarget)
      await page.click(`[data-dshone-group-key="${fixture.key}"] [data-dshone-tree-action="group-select"]`)
      await page.waitForTimeout(300)
      const atSome = (await groupCheckFacts(page)).find((entry) => entry.key === fixture.key)
      const afterGroupSelect = await selectionFacts(page)
      check.fact(`置顶组组头（点一下后）：${JSON.stringify(atSome)} 已勾=${JSON.stringify(afterGroupSelect.checked.map((id) => id.slice(0, 11)))}`)
      check.eq('点一下组头三态框：本组够格的成员全被勾上', afterGroupSelect.checked.length, eligibleInFixture.length)
      check.eq(
        '组内有置顶 → 最满只能 some（不是 all）',
        atSome?.row,
        'some',
      )
      check.eq('some 态：框里画的是短横线（不是对勾）', `${String(atSome?.aria)}/${String(atSome?.dash)}`, 'mixed/true')
      check.eq('置顶那条**没被**勾上（资格判定挡住了它）', await checkOf(page, pinnedTarget), 'false')
      check.eq('动作条计数跟上了（已选 N 项）', afterGroupSelect.count, `已选 ${String(eligibleInFixture.length)} 项`)
      screenshots.push(await shot(ctx, page, 'multi-select-group-some'))

      await page.click(`[data-dshone-group-key="${fixture.key}"] [data-dshone-tree-action="group-select"]`)
      await page.waitForTimeout(300)
      const backToNone = (await groupCheckFacts(page)).find((entry) => entry.key === fixture.key)
      check.eq('再点一下：取消全选本组（回到 none）', backToNone?.row, 'none')
      check.eq('取消后勾选清空', (await selectionFacts(page)).checked, [])

      // ---- ② 另一组（无置顶）：点一下 = all ----
      await page.click(`[data-dshone-group-key="${otherGroup.key}"] [data-dshone-tree-action="group-select"]`)
      await page.waitForTimeout(300)
      const atAll = (await groupCheckFacts(page)).find((entry) => entry.key === otherGroup.key)
      const otherChecked = (await selectionFacts(page)).checked.length
      check.fact(`无置顶组组头（点一下后）：${JSON.stringify(atAll)} 已勾 ${String(otherChecked)}`)
      check.eq('无置顶的组：点一下 = 全选（all）', atAll?.row, 'all')
      check.eq('all 态：框里是对勾、没有短横线', `${String(atAll?.aria)}/${String(atAll?.dash)}/${String(atAll?.glyph)}`, 'true/false/1')
      check.eq('all 态：组里勾上的条数 = 组里的会话数', otherChecked, atAll?.count)
      screenshots.push(await shot(ctx, page, 'multi-select-group-all'))
      await page.click(`[data-dshone-group-key="${otherGroup.key}"] [data-dshone-tree-action="group-select"]`)
      await page.waitForTimeout(300)
      check.eq('再点一下取消全选（回到 none）', (await groupCheckFacts(page)).find((entry) => entry.key === otherGroup.key)?.row, 'none')

      // ---- ② 收起着的工作区也能一次勾满（成员按整组数，不看折叠态）----
      await page.click(`[data-dshone-group-key="${otherGroup.key}"] [data-dshone-tree-row="workspace"]`)
      await page.waitForTimeout(250)
      const collapsedRows = await contentCount(page, `[data-dshone-group-key="${otherGroup.key}"] [data-dshone-tree-row="session"]`)
      const collapsedState = (await groupCheckFacts(page)).find((entry) => entry.key === otherGroup.key)
      check.fact(`收起后的组：块内行=${String(collapsedRows)} 组头态=${String(collapsedState?.row)} 组规模=${String(collapsedState?.count)}`)
      check.eq('组收起后块内没有行（折叠真的生效）', collapsedRows, 0)
      check.ok('收起着的组组头仍有让三态框可数的规模（成员按整组数）', (collapsedState?.count ?? 0) > 0)
      await page.click(`[data-dshone-group-key="${otherGroup.key}"] [data-dshone-tree-action="group-select"]`)
      await page.waitForTimeout(300)
      // 组收起时它的会话行根本不渲染，所以「勾了几条」读不到行属性——读动作条计数
      //（计数与勾选同源，正是「整组被勾满」这条断言的观察面）。
      const collapsedPicked = (await selectionFacts(page)).count
      const collapsedAfter = (await groupCheckFacts(page)).find((entry) => entry.key === otherGroup.key)
      await page.click(`[data-dshone-group-key="${otherGroup.key}"] [data-dshone-tree-row="workspace"]`)
      await page.waitForTimeout(250)
      check.eq('收起着的组也能一次勾满（动作条计数 = 组规模，与展开时一致）', collapsedPicked, `已选 ${String(collapsedState?.count)} 项`)
      check.eq('收起着的组：组头三态同样翻到 all', collapsedAfter?.row, 'all')
      await page.click(`[data-dshone-group-key="${otherGroup.key}"] [data-dshone-tree-action="group-select"]`)
      await page.waitForTimeout(250)
      check.eq('收起态下再点一次同样能取消（勾选清空）', (await selectionFacts(page)).count, '未选任何会话')

      // ---- ⑨ 选择态下的行：时间 / ⋯ 菜单 / 右键菜单 / 悬停卡让位 ----
      const rowAffordances = await page.evaluate((id: string) => {
        const row = document.querySelector(`[data-dshone-tree-session="${id}"]`)
        return {
          time: row?.querySelector('.dshOneTree_time') !== null,
          menu: row?.querySelector('[data-dshone-tree-action="session-menu"]') !== null,
          check: row?.querySelector('.dshOneTree_checkBox') !== null,
        }
      }, freeTarget)
      check.eq('选择态下的会话行：时间让位、⋯ 菜单让位、勾选框在场', rowAffordances, { time: false, menu: false, check: true })
      await page.locator(`[data-dshone-tree-session="${freeTarget}"]`).click({ button: 'right' })
      await page.waitForTimeout(250)
      const menuInSelectMode = await contentCount(page, '[role="menu"]')
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)
      check.eq('选择态下行右键不弹菜单（原生菜单也不被接管）', menuInSelectMode, 0)
      await page.locator(`[data-dshone-tree-session="${freeTarget}"]`).hover()
      await page.waitForTimeout(900)
      const hoverInSelectMode = await contentCount(page, '.dshOneTree_hoverContent')
      // 对照：退出选择态后同一行右键**会**弹菜单（这条断言才有内容）。
      await page.click('[data-dshone-tree-action="selection-exit"]')
      await page.waitForTimeout(250)
      await page.locator(`[data-dshone-tree-session="${freeTarget}"]`).click({ button: 'right' })
      await page.waitForTimeout(300)
      const menuOutside = await contentCount(page, '[role="menu"]')
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)
      await page.locator(`[data-dshone-tree-session="${freeTarget}"]`).hover()
      await page.waitForTimeout(900)
      const hoverOutside = await contentCount(page, '.dshOneTree_hoverContent')
      await page.mouse.move(4, 4)
      await page.waitForTimeout(200)
      check.fact(
        `行右键与悬停卡的对照：选择态内 菜单数=${String(menuInSelectMode)} 悬停卡=${String(hoverInSelectMode)}；选择态外 菜单数=${String(menuOutside)} 悬停卡=${String(hoverOutside)}（悬停卡对照为 0 = 这个宽度下官方本来就没出卡，本条按「选择态内不给」判）`,
      )
      check.ok('对照成立：选择态之外行右键确实会弹菜单（说明上面那条「不弹」是真的让位）', menuOutside > 0, String(menuOutside))
      check.eq('选择态下悬停不出会话悬停卡', hoverInSelectMode, 0)
      await page.click(selectButton)
      await page.waitForTimeout(300)
      check.eq('重新进选择态：勾选是空的', (await selectionFacts(page)).checked, [])

      // ---- ⑤ 批量归档：独立动作 + 确认弹窗（明确跳过数）----
      // 勾选前先把整棵树展开（折叠着的组不渲染行），再在**全部**够格的行里挑：
      // 优先挑状态不是 idle 的（它们按资格会被跳过 → 弹窗「写明跳过数」才有对象），
      // 再补 idle 的。挑「够格」用的就是行上那个标记（与资格判定同源）。
      check.eq('批量勾选前：勾选是空的（上一步已清干净）', (await selectionFacts(page)).checked, [])
      await expandAllGroups(page)
      const pickOrder = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('[data-dshone-tree-row="session"]'))
          .filter((row) => row.getAttribute('data-dshone-tree-check') === 'eligible')
          .map((row) => ({
            id: row.getAttribute('data-dshone-tree-session') ?? '',
            status: row.getAttribute('data-dshone-tree-status') ?? '',
          }))
          .filter((row) => row.id !== '')
        return [...rows.filter((row) => row.status !== 'idle').slice(0, 2), ...rows.filter((row) => row.status === 'idle').slice(0, 2)]
      })
      check.fact(`批量夹具：${pickOrder.map((row) => `${row.id.slice(0, 11)}:${row.status}`).join(' ')}`)
      const expectedSkipped = pickOrder.filter((row) => row.status !== 'idle').length
      check.ok('批量夹具里有可归档的行（否则「归档」本来就该禁用）', pickOrder.length > expectedSkipped, JSON.stringify(pickOrder))
      if (pickOrder.length === 0 || pickOrder.length === expectedSkipped) return screenshots
      for (const entry of pickOrder) {
        await page.locator(`[data-dshone-tree-session="${entry.id}"]`).click()
        await page.waitForTimeout(80)
      }
      check.eq('逐行点选：已勾上的条数 = 点的次数', (await selectionFacts(page)).checked.length, pickOrder.length)
      await page.click('[data-dshone-tree-action="selection-archive"]')
      await page.waitForTimeout(400)
      const batchModal = await page.evaluate(() => ({
        confirm: document.querySelector('[data-dshone-tree-action="archive-confirm"]') !== null,
        rows: document.querySelectorAll('[data-dshone-archive-row]').length,
        blocks: document.querySelectorAll('[data-dshone-archive-block]').length,
        skipped: document.querySelector('[data-dshone-archive-skipped]')?.textContent ?? '',
        bar: document.querySelector('[data-dshone-tree="selection-bar"]') !== null,
      }))
      check.fact(`批量归档弹窗：${JSON.stringify(batchModal)}（预期跳过 ${String(expectedSkipped)}）`)
      check.ok('「归档」是独立动作：开确认弹窗（不是立即执行）', batchModal.confirm && batchModal.blocks >= 1 && batchModal.rows >= 1)
      check.ok(
        '弹窗写明跳过数（与资格判定算出来的一致）',
        expectedSkipped === 0 ? batchModal.skipped === '' : batchModal.skipped.includes(`另有 ${String(expectedSkipped)} 个`),
        `skipped=${JSON.stringify(batchModal.skipped)} expected=${String(expectedSkipped)}`,
      )
      screenshots.push(await shot(ctx, page, 'multi-select-batch-archive'))
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
      check.eq('取消归档：弹窗关掉', await contentCount(page, '[data-dshone-tree-action="archive-confirm"]'), 0)
      check.eq('取消归档：勾选一条不少（留在选中里）', (await selectionFacts(page)).checked.length, pickOrder.length)
      check.eq('取消归档：本地集合没变（什么都没发生）', await hostRecycleBin(page), null)

      // ---- ⑦ 失败不静默：注入一次 state.write 失败，批量移入回收站 ----
      await page.evaluate(() => {
        ;(globalThis as unknown as { __LAB_HOST__: { failStateWrite: string | null } }).__LAB_HOST__.failStateWrite = 'recycle-bin'
      })
      await page.click('[data-dshone-tree-action="selection-recycle"]')
      await page.waitForTimeout(600)
      const failed = await selectionFacts(page)
      check.fact(`注入写失败后的动作条：${JSON.stringify(failed)}`)
      check.ok('失败：动作条不消失', failed.bar)
      check.ok('失败：红字写明没移成的条数（不静默）', failed.error.includes('没能移入回收站') && failed.error.includes(String(pickOrder.length)), JSON.stringify(failed.error))
      check.eq('失败：失败项留在选中里（勾选一条不少）', failed.checked.length, pickOrder.length)
      check.ok('失败：飘提示也报了同一件事', failed.flash.includes('没能移入回收站'), JSON.stringify(failed.flash))
      check.eq('失败：什么都没写进宿主（数据一个字节没动）', await hostRecycleBin(page), null)
      screenshots.push(await shot(ctx, page, 'multi-select-move-failed'))
      await page.evaluate(() => {
        ;(globalThis as unknown as { __LAB_HOST__: { failStateWrite: string | null } }).__LAB_HOST__.failStateWrite = null
      })
      check.eq('失败后仍在选择态（可以直接重试）', await page.getAttribute(selectButton, 'aria-pressed'), 'true')

      // ---- ⑤ 批量移入回收站：立即执行 + 飘提示 + 退出选择态 ----
      await page.click('[data-dshone-tree-action="selection-recycle"]')
      await page.waitForTimeout(500)
      const moved = await selectionFacts(page)
      const movedState = (await hostRecycleBin(page)) as { version?: number; sessionIds?: string[] } | null
      check.fact(`批量移入后：动作条在=${String(moved.bar)} 飘提示=${JSON.stringify(moved.flash)} 本地集合=${JSON.stringify((movedState?.sessionIds ?? []).map((id) => id.slice(0, 11)))}`)
      check.eq('「移入回收站」立即执行：不开归档确认弹窗', await contentCount(page, '[data-dshone-tree-action="archive-confirm"]'), 0)
      check.eq('批量移入：选中的都进了本地集合（按勾选顺序）', movedState?.sessionIds ?? [], pickOrder.map((entry) => entry.id))
      check.ok('批量移入：飘一条回执', moved.flash.includes('回收站'), JSON.stringify(moved.flash))
      check.eq('批量移入：动作完退出选择态（动作条消失）', moved.bar, false)
      screenshots.push(await shot(ctx, page, 'multi-select-batch-moved'))

      // ---- ⑦ 飘提示 2.2 秒后自己消失 ----
      // 重新制造一条提示（「全部还原」也飘），出现 → 消失两头都断言。
      await page.click('[data-dshone-tree-action="recycle-restore-all"]')
      await page.waitForTimeout(250)
      const flashShown = await contentCount(page, '[data-dshone-tree="flash"]')
      await page.waitForTimeout(2_600)
      const flashGone = await contentCount(page, '[data-dshone-tree="flash"]')
      check.eq('飘提示出现', flashShown, 1)
      check.eq('飘提示约 2.2 秒后自己消失', flashGone, 0)
      check.eq('收尾：本地集合清空（回到干净状态）', await hostRecycleBin(page), { version: 1, sessionIds: [] })
      check.eq('收尾：被移走的那几条回到树里', await contentCount(page, `[data-dshone-tree-session="${pickOrder[0]?.id ?? ''}"]`), 1)

      // ---- ⑧ 搜索结果行可勾选（C8）----
      // 上一步「批量移入」结束时已退出选择态，这里重新进一次再验搜索态下的勾选。
      await page.click(selectButton)
      await page.waitForTimeout(300)
      const titleNeedle = (await page.textContent(`[data-dshone-tree-session="${freeTarget}"] .dshOneTree_title`)) ?? ''
      const query = titleNeedle.trim().slice(0, 6)
      check.fact(`搜索夹具：用标题前 6 字 ${JSON.stringify(query)} 搜（命中行含 ${freeTarget.slice(0, 13)}）`)
      // #132：搜索栏默认是收起态的放大镜，先点开再打字。
      await page.click('[data-dshone-tree-action="search"]')
      await page.waitForTimeout(250)
      await page.fill('[data-dshone-tree="search-input"]', query)
      await page.waitForTimeout(700)
      const searchRows = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-dshone-tree="search"] [data-dshone-tree-session]')).map((row) => ({
          id: row.getAttribute('data-dshone-tree-session') ?? '',
          check: row.getAttribute('data-dshone-tree-check') ?? 'missing',
          selected: row.getAttribute('data-dshone-tree-checked') ?? 'missing',
        })),
      )
      check.fact(`搜索态下的结果行（前 3）：${JSON.stringify(searchRows.slice(0, 3))}`)
      check.ok('搜索态下仍然出结果行', searchRows.length > 0, JSON.stringify(searchRows.length))
      check.ok(
        '搜索结果行带着选择资格标记（与树里的行同一份判定）',
        searchRows.length > 0 && searchRows.every((row) => row.check === 'eligible' || row.check === 'blocked'),
        JSON.stringify(searchRows.slice(0, 3)),
      )
      check.ok('搜索结果行还没被勾', searchRows.every((row) => row.selected === 'false'))
      const hitFree = searchRows.find((row) => row.id === freeTarget) ?? searchRows[0]
      await page.locator(`[data-dshone-tree="search"] [data-dshone-tree-session="${hitFree?.id ?? ''}"]`).click()
      await page.waitForTimeout(250)
      const searchSelected = await selectionFacts(page)
      check.fact(`点搜索结果行后：已勾=${JSON.stringify(searchSelected.checked)} 计数=${JSON.stringify(searchSelected.count)}`)
      check.ok(
        '点搜索结果行 = 勾选（C8：选择态下搜索结果行同样可勾）',
        searchSelected.checked.includes(hitFree?.id ?? ''),
        JSON.stringify(searchSelected),
      )
      check.eq('搜索结果行勾上后动作条计数跟上', searchSelected.count, '已选 1 项')
      check.eq('搜索态下行上带的勾选标记也翻成 true', await checkOf(page, hitFree?.id ?? ''), 'true')
      screenshots.push(await shot(ctx, page, 'multi-select-search-row'))
      await page.click('[data-dshone-tree="search-clear"]')
      await page.waitForTimeout(500)
      check.eq('清掉搜索后勾选仍在（选择态是跨视图的）', (await selectionFacts(page)).checked, [hitFree?.id ?? ''])
      await page.click('[data-dshone-tree-action="selection-exit"]')
      await page.waitForTimeout(300)
      const exited = await selectionFacts(page)
      check.eq('「取消」退出选择态：动作条消失', exited.bar, false)
      check.eq('退出选择态：勾选清空', exited.checked, [])
      check.eq('退出选择态：工具栏那枚按钮弹起', await page.getAttribute(selectButton, 'aria-pressed'), 'false')

      check.eq('多选与批量套件全程零 pageerror', withoutKnownNoise(opened.capture.pageErrors).real, [])
    } finally {
      await opened.context.close()
    }
    return screenshots
  },
}

// ---------------------------------------------------------------------------
// F-18 SIDEBAR-EMPTY-FEEDBACK：空态、加载态与失败可见（#110）
// ---------------------------------------------------------------------------

/**
 * 假据开关（#110）：**一条都不写网关**，只改「页面收到的东西」——
 * - `session/list` 回执里给每条会话补一个 `schedule` 投影（真网关的 list 回执里
 *   根本没有 `schedule` 键，见下面 expect 的说明），用来验行上那枚定时任务标记；
 * - `session/search` 回执换成一条命中 + `hasMore: true`（真网关的内容搜索索引在
 *   本机是坏的，返回 `ok:false`，走不出「结果上限」那一支），验搜索上限提示；
 * - `session/fork` 与 `workspace/archiveSession` 回执换成失败，验两条动作失败路径的
 *   可见反馈——**回执在页面侧就被换掉，请求不落到网关**，所以既跑到了真失败路径，
 *   也仍然只读；
 * - `workspace/follow` 是流：把它的工作区清单改成空（并可选延时），验零工作区空态
 *   与加载态。
 */
interface EmptyStateFixtures {
  injectSchedule: boolean
  searchHasMore: boolean
  failFork: boolean
  failArchive: boolean
  emptyWorkspaces: boolean
  /** 把 `workspace/follow` 的帧推迟这么久再转给页面（验加载态用）。 */
  delayWorkspaceFollowMs: number
}

/** 夹具回执里给每条会话补的定时任务（只求 `schedule` 非空，形状与官方投影同形）。 */
const SCHEDULE_FIXTURE = [{ id: 'lab-schedule-fixture', kind: 'reminder', prompt: 'lab fixture', scheduledAt: 4_102_444_800_000 }]

interface EmptyStateStats {
  /** 被夹具换过的 `session/search` 请求数。 */
  searchCalls: number
  /** 被夹具换过的 `session/fork` 请求数（>0 = 真的走到了那条 RPC）。 */
  forkCalls: number
  /** 被夹具换过的 `workspace/archiveSession` 请求数。 */
  archiveCalls: number
  /** 被补了 `schedule` 投影的会话数（夹具实际改了谁：list 回执一处、控制流基线一处）。 */
  scheduledSessions: number
  /** 夹具在 `session/list` 回执里见过的会话 id（后面的「谁该有标记」判据）。 */
  listIds: Set<string>
  /** 控制流基线里被补了 `schedule` 的会话数（0 = 那份帧里没有 projections 一节）。 */
  controlScheduledSessions: number
  /** 会话级 follow 流的快照里被补了 `schedule` 的帧数（当前会话那条）。 */
  followScheduledSessions: number
  /** 被改空的工作区清单帧数（baseline + 增量）。 */
  emptiedFollowFrames: number
  /** 搜索夹具要用的那条真会话 id（从页面上真行的 id 取，见套件里怎么挑）。 */
  fixtureSessionId: string
}

/** 装 HTTP 侧夹具：只改回执，不写网关。 */
async function installApiFixtures(
  page: OpenedPage['page'],
  fixtures: EmptyStateFixtures,
  stats: EmptyStateStats,
): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const method = decodeURIComponent(request.url()).split('/api/')[1] ?? ''
    let rpcId = ''
    try {
      rpcId = (JSON.parse(request.postData() ?? '{}') as { rpcId?: string }).rpcId ?? ''
    } catch {
      /* 形状不对就空 rpcId——下面 reply 只在夹具分支用，正常请求走 route.fetch 原样透传 */
    }
    const reply = async (result: unknown): Promise<void> => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ type: 'server-response', rpcId, result }),
      })
    }
    if (fixtures.searchHasMore && method.startsWith('session/search')) {
      stats.searchCalls += 1
      await reply({
        ok: true,
        value: { items: [{ id: stats.fixtureSessionId, snippet: 'lab fixture snippet' }], hasMore: true },
      })
      return
    }
    if (fixtures.failFork && method.startsWith('session/fork')) {
      stats.forkCalls += 1
      // `details` 是官方信封校验的必填字段（缺它客户端会报 invalid server-response failure）。
      await reply({ ok: false, error: { code: 'lab/forced', message: 'lab: fork rejected (fixture)', details: {} } })
      return
    }
    if (fixtures.failArchive && method.startsWith('workspace/archiveSession')) {
      stats.archiveCalls += 1
      await reply({ ok: false, error: { code: 'lab/forced', message: 'lab: archive rejected (fixture)', details: {} } })
      return
    }
    const response = await route.fetch()
    const text = await response.text()
    if (!fixtures.injectSchedule || !method.startsWith('session/list')) {
      await route.fulfill({ response, body: text })
      return
    }
    const parsed = JSON.parse(text) as {
      result?: { value?: { items?: { sessionId?: string; id?: string; projections?: { values?: Record<string, unknown> } }[] } }
    }
    for (const item of parsed.result?.value?.items ?? []) {
      const values = item.projections?.values
      // 没有 projections 一节的条目无处可补（宿主还没给它投影），不算夹具覆盖到的会话。
      if (values === undefined) continue
      values.schedule = SCHEDULE_FIXTURE
      stats.scheduledSessions += 1
      const id = item.sessionId ?? item.id
      if (typeof id === 'string' && id !== '') stats.listIds.add(id)
    }
    await route.fulfill({ response, body: JSON.stringify(parsed) })
  })
}

/** mux 帧的最小面（夹具只读这几层，形状变了就不再改、原样透传）。 */
type MuxFrame = { streamId?: string; type?: string; value?: { value?: Record<string, unknown> } }

/** 装流侧夹具：`workspace/follow` 的工作区清单改成空（可选延时），控制流基线补 schedule。 */
async function installFollowFixtures(
  page: OpenedPage['page'],
  fixtures: EmptyStateFixtures,
  stats: EmptyStateStats,
): Promise<void> {
  await page.routeWebSocket(/remote\.mux/, (socket) => {
    const upstream = socket.connectToServer()
    const endpoints = new Map<string, string>()
    socket.onMessage((message) => {
      try {
        const frame = JSON.parse(String(message)) as { type?: string; streamId?: string; endpoint?: string }
        if (frame.type === 'open' && frame.streamId !== undefined && frame.endpoint !== undefined) {
          endpoints.set(frame.streamId, frame.endpoint)
        }
      } catch {
        /* 客户端帧形状变了就原样转发，夹具自身不参与协议解读 */
      }
      upstream.send(message)
    })
    upstream.onMessage((message) => {
      const text = String(message)
      let frame: MuxFrame | undefined
      try {
        frame = JSON.parse(text) as MuxFrame
      } catch {
        frame = undefined
      }
      const endpoint = frame?.streamId === undefined ? undefined : endpoints.get(frame.streamId)
      // 控制流基线也带 projections（键为会话 id）：`replaceControlBaseline` 会
      // truncate + seed 投影存储，晚到就把 list 回执里补的 schedule 抹掉。两处一起补，
      // 夹具结果与两个流的到达顺序无关。
      if (fixtures.injectSchedule && endpoint === 'session/control') {
        const blocks = frame?.value?.value?.projections as Record<string, { values?: Record<string, unknown> }> | undefined
        if (blocks === undefined) {
          socket.send(message)
          return
        }
        for (const block of Object.values(blocks)) {
          // 控制流基线的 seed 会把该会话的投影存储重置回这份 values，所以这里必须
          // **每一块都补上** schedule（缺 values 的块也要建出来，否则那条会话的标记
          // 会被这次种子化抹掉）。
          block.values = { ...(block.values ?? {}), schedule: SCHEDULE_FIXTURE }
          stats.controlScheduledSessions += 1
        }
        socket.send(JSON.stringify(frame))
        return
      }
      // 会话级 follow 流也带 projections 一节（当前会话就是这条流喂的）：它到的时候
      // `seed` 会把该会话的投影存储整块换掉，所以同一处也得补上 schedule，否则当前
      // 会话那一行会掉标记。
      if (fixtures.injectSchedule && endpoint === 'session/follow') {
        const snapshot = frame?.value?.value as { projections?: { values?: Record<string, unknown> } } | undefined
        if (snapshot?.projections?.values !== undefined) {
          snapshot.projections.values.schedule = SCHEDULE_FIXTURE
          stats.followScheduledSessions += 1
          socket.send(JSON.stringify(frame))
          return
        }
      }
      if (endpoint !== 'workspace/follow' || !fixtures.emptyWorkspaces) {
        socket.send(message)
        return
      }
      stats.emptiedFollowFrames += 1
      // 夹具期间工作区清单恒空：baseline 的 items 清掉；其余帧（都是「又加了谁」这类
      // 增量）一律不转发——两种处置合起来保证页面上冒不出工作区。解析不了的帧同样丢掉。
      const items = frame?.value?.value?.items
      if (frame === undefined || frame.type !== 'item' || !Array.isArray(items)) return
      ;(frame.value?.value as { items: unknown[] }).items = []
      const out = JSON.stringify(frame)
      if (fixtures.delayWorkspaceFollowMs > 0) setTimeout(() => socket.send(out), fixtures.delayWorkspaceFollowMs)
      else socket.send(out)
    })
  })
}

export const SIDEBAR_EMPTY_FEEDBACK_SUITE: LabSuite = {
  id: 'F-18',
  phase: 'new-feature',
  name: '侧栏空态、加载态与失败可见（#110）：零工作区 / 分组无成员 / 加载中 / 三类失败 / 定时任务标记 / 搜索上限',
  expect:
    '#110 的空态与反馈在真实装配页上成立（真网关**只读** + 假宿主 + 页内夹具）：① **分组无成员空态**——选中一个没有成员工作区的分组时，列表出专属文案与「管理分组…」入口按钮（点它真的打开管理分组对话框），分组块一个不渲染；切回「全部工作区」分组块照常回来；② **加载态**——工作区快照还（被夹具推迟）没到时，列表区出「加载中…」而不是整块空白，快照到了就换成正常内容；③ **零工作区空态**——工作区清单为空时出「还没有工作区…用上方的 ＋…」文案，且上方的 ＋ 入口在场（文案指的是它）；④ **三类失败都有可见反馈**——分叉（`session/fork` 回执被换成失败）、归档（`workspace/archiveSession` 回执被换成失败，弹窗内联红字 + 飘提示各一条）、多开（宿主能力口回 `lab/forced` 失败）：三条都飘出一行说明，不再静默吞掉或只写日志；⑤ **官方自带但此前没渲染的两项**（#98 L6）——活跃定时任务标记按官方位置（标题后、时间前）与官方件（`role=img` + `schedule.active` 文案 + 闹钟图标）渲染，搜索结果行同样带上它；搜索回执带 `hasMore` 时出官方那套「仅显示前 N 条结果」上限提示。夹具只改**页面收到的回执**（HTTP 回执与 `workspace/follow` 流的帧），请求不落到网关，所以全程仍然只读。全程零 pageerror。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const groupsState = {
      version: 1,
      groups: [
        { id: 'g-lab-empty', name: 'Lab Empty' },
        { id: 'g-lab-other', name: 'Lab Other' },
      ],
      membership: {},
      activeGroupId: null,
    }
    const opened = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), {
      width: 380,
      height: 900,
      state: { groups: groupsState },
      // #110：宿主能力口点名失败的那条（多开）。失败回执是真回执，界面照常收到错误。
      failCalls: ['session.openInNewTab'],
    })
    const { page } = opened
    const fixtures: EmptyStateFixtures = {
      injectSchedule: false,
      searchHasMore: false,
      failFork: false,
      failArchive: false,
      emptyWorkspaces: false,
      delayWorkspaceFollowMs: 0,
    }
    const stats: EmptyStateStats = {
      searchCalls: 0,
      forkCalls: 0,
      archiveCalls: 0,
      scheduledSessions: 0,
      listIds: new Set<string>(),
      controlScheduledSessions: 0,
      followScheduledSessions: 0,
      emptiedFollowFrames: 0,
      fixtureSessionId: '',
    }
    try {
      await expandAllWorkspaces(page)

      // ---- ① 分组无成员空态（真数据，不装任何夹具） ----
      await page.click('[data-dshone-tree-action="group-pill"]')
      await page.waitForTimeout(250)
      await page.click('[data-dshone-tree-pill-item="g-lab-empty"]')
      await page.waitForTimeout(400)
      const groupEmpty = await page.evaluate(() => {
        const notice = document.querySelector('[data-dshone-tree-empty="group-members"]')
        const action = notice?.querySelector('[data-dshone-tree-action="group-manage-empty"]')
        return {
          found: notice !== null,
          text: notice?.textContent ?? '',
          lines: notice?.querySelectorAll('.dshOneTree_emptyLine').length ?? 0,
          action: action?.textContent ?? '',
          sections: document.querySelectorAll('[data-dshone-group-key]').length,
        }
      })
      check.fact(`分组空态：${JSON.stringify(groupEmpty)}`)
      check.ok('选中没有成员工作区的分组 → 出专属空态', groupEmpty.found, JSON.stringify(groupEmpty))
      check.ok(
        '空态文案写明「这个分组里还没有工作区」与下一步去哪',
        groupEmpty.text.includes('该分组还没有工作区') && groupEmpty.text.includes('管理分组'),
        groupEmpty.text,
      )
      check.ok('空态带「管理分组…」入口按钮', groupEmpty.action.includes('管理分组'), groupEmpty.action)
      check.eq('分组空态下不渲染任何分组块（不是「找不到就显示全部」）', groupEmpty.sections, 0)
      screenshots.push(await shot(ctx, page, 'empty-group-members'))
      await page.click('[data-dshone-tree-action="group-manage-empty"]')
      await page.waitForTimeout(350)
      const manageOpened = await page.evaluate(() => ({
        rows: Array.from(document.querySelectorAll('[data-dshone-manage-group]')).map((el) => el.getAttribute('data-dshone-manage-group') ?? ''),
        input: document.querySelector('[data-dshone-tree="group-manage-input"]') !== null,
      }))
      check.ok(
        '空态的入口按钮真的打开「管理分组…」对话框（列出全部分组）',
        manageOpened.rows.length === 2 && manageOpened.input,
        JSON.stringify(manageOpened),
      )
      await page.keyboard.press('Escape')
      await page.waitForTimeout(250)
      // 切回「全部工作区」：分组块照常渲染（空态只在选中空分组时出现）。
      await page.click('[data-dshone-tree-action="group-pill"]')
      await page.waitForTimeout(250)
      await page.click('[data-dshone-tree-pill-item="all"]')
      await page.waitForTimeout(500)
      const sectionsBack = await contentCount(page, '[data-dshone-group-key]')
      check.ok('切回「全部工作区」→ 分组块照常渲染（空态不是常驻）', sectionsBack > 0, `sections=${String(sectionsBack)}`)

      // ---- ①b 分组名错误提示（#110 第 6 条：与旧侧栏核对一致） ----
      // 旧侧栏的两条文案就地判定、就地提示（不落盘才报错）：空名「分组名称不能为空」、
      // 重名「已存在同名分组」。这里按同一份判定逐态核对。
      await page.click('[data-dshone-tree-action="group-pill"]')
      await page.waitForTimeout(250)
      await page.click('[data-dshone-tree-action="group-new"]')
      await page.waitForTimeout(350)
      const groupName = async (draft: string): Promise<{ error: string; disabled: boolean }> => {
        await page.fill('.dshOneTree_renameInput', draft)
        await page.waitForTimeout(200)
        return await page.evaluate(() => {
          const input = document.querySelector('.dshOneTree_renameInput')
          const dialog = input?.closest('[role="dialog"]') ?? document.body
          const buttons = Array.from(dialog.querySelectorAll('button'))
          const submit = buttons[buttons.length - 1] as HTMLButtonElement | undefined
          return { error: dialog.querySelector('[role="alert"]')?.textContent ?? '', disabled: submit?.disabled ?? false }
        })
      }
      const emptyName = await groupName('')
      const duplicateName = await groupName('Lab Empty')
      const freshName = await groupName('Lab Fresh')
      check.fact(`分组名校验：空名=${JSON.stringify(emptyName)} 重名=${JSON.stringify(duplicateName)} 新名=${JSON.stringify(freshName)}`)
      check.ok('空名就地提示「分组名称不能为空」且提交禁用', emptyName.error === '分组名称不能为空' && emptyName.disabled, JSON.stringify(emptyName))
      check.ok('重名就地提示「已存在同名分组」且提交禁用', duplicateName.error === '已存在同名分组' && duplicateName.disabled, JSON.stringify(duplicateName))
      check.ok('换个没被占用的名字 → 提示消失、提交可用', freshName.error === '' && !freshName.disabled, JSON.stringify(freshName))
      await page.keyboard.press('Escape')
      await page.waitForTimeout(250)

      // 挑一条真会话当搜索夹具的目标（有 ⋯ 按钮的行才有完整行菜单；#109 起空白会话行也有
      // 行操作容器，只是没有按钮，所以按「有 ⋯」认，别按容器认）。
      const probe = await page.evaluate(() => {
        const row = Array.from(document.querySelectorAll('[data-dshone-tree-row="session"]')).find(
          (candidate) =>
            candidate.querySelector('[data-dshone-tree-action="session-menu"]') !== null &&
            candidate.getAttribute('data-dshone-tree-status') === 'idle',
        )
        return {
          id: row?.getAttribute('data-dshone-tree-session') ?? '',
          title: row?.querySelector('.dshOneTree_title')?.textContent ?? '',
        }
      })
      stats.fixtureSessionId = probe.id
      check.fact(`夹具目标会话：${probe.id}（${probe.title}）`)
      check.ok('找得到一条可操作的真会话（后面的搜索/失败断言都要点它）', probe.id !== '')

      // ---- ② 装上页内夹具后重载：定时任务标记 + 搜索上限 + 三类失败 ----
      await installApiFixtures(page, fixtures, stats)
      await installFollowFixtures(page, fixtures, stats)
      fixtures.injectSchedule = true
      fixtures.searchHasMore = true
      fixtures.failFork = true
      fixtures.failArchive = true
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector(route('sidebar').readySelector, { timeout: 40_000 })
      await page.waitForTimeout(2_500)
      await expandAllWorkspaces(page)
      const fixtureRow = await contentCount(page, `[data-dshone-tree-session="${stats.fixtureSessionId}"]`)
      check.fact(`夹具目标会话在重载后的树里：行数=${String(fixtureRow)}（id=${stats.fixtureSessionId}）`)

      // L6 之一：活跃定时任务标记（官方的行内呈现：标题后、时间前）。
      const schedule = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('[data-dshone-tree-row="session"]'))
        const marks = Array.from(document.querySelectorAll('[data-dshone-tree-schedule]'))
        const first = marks[0]
        const row = first?.closest('[data-dshone-tree-row="session"]')
        const children = row === undefined || row === null ? [] : Array.from(row.children).map((child) => child.getAttribute('class') ?? '')
        const style = first === undefined ? null : getComputedStyle(first)
        return {
          rows: rows.length,
          marks: marks.length,
          unmarked: rows
            .filter((candidate) => candidate.querySelector('[data-dshone-tree-schedule]') === null)
            .map((candidate) => ({
              id: candidate.getAttribute('data-dshone-tree-session') ?? '',
              status: candidate.getAttribute('data-dshone-tree-status') ?? '',
              hasActions: candidate.querySelector('[data-dshone-tree-action="session-menu"]') !== null,
              // 空白会话行（当前那条临时「新会话」占位）没有 ⋯ 按钮、也没有相对时间。
              // #109 起它**也挂行操作容器**（只为让右键能开出菜单），所以这里按「没有 ⋯ 按钮」判。
              blankLike:
                candidate.querySelector('[data-dshone-tree-action="session-menu"]') === null &&
                candidate.querySelector('.dshOneTree_time') === null,
              group: candidate.closest('[data-dshone-group-key]')?.getAttribute('data-dshone-group-key') ?? '(none)',
            })),
          role: first?.getAttribute('role') ?? '',
          label: first?.getAttribute('aria-label') ?? '',
          title: first?.getAttribute('title') ?? '',
          width: style?.width ?? '',
          height: style?.height ?? '',
          marginRight: style?.marginRight ?? '',
          titleIndex: children.findIndex((name) => name.includes('dshOneTree_title')),
          markIndex: children.findIndex((name) => name.includes('dshOneTree_scheduleIndicator')),
          svg: first?.querySelector('svg') !== null,
        }
      })
      check.fact(
        `定时任务标记：会话行=${String(schedule.rows)} 标记=${String(schedule.marks)} 未标记的行=${JSON.stringify(schedule.unmarked)}（夹具补了 ${String(stats.scheduledSessions)} 条 list 投影 + ${String(stats.controlScheduledSessions)} 条控制流投影）role=${schedule.role} 文案=${JSON.stringify(schedule.label)} 几何=${schedule.width}×${schedule.height} margin-right=${schedule.marginRight}`,
      )
      check.ok('夹具真的给会话补了 schedule 投影（否则下面这条是空的）', stats.scheduledSessions > 0, String(stats.scheduledSessions))
      // 「谁该有标记」的判据 = 夹具在 list 回执里补过 schedule 的那些会话（它们全都会
      // 进投影存储）。回执之外新到的会话（宿主经 `$on` 事件补发、我们没给它们造数据）
      // 不算在内——这也是「标记跟着数据走、不是常亮」的那一半证据。
      const missedMarks = schedule.unmarked.filter((row) => stats.listIds.has(row.id) && !row.blankLike)
      check.ok(
        '夹具覆盖到的会话行（当前那条空白占位行除外）全都渲染出活跃定时任务标记',
        schedule.marks > 0 && missedMarks.length === 0,
        JSON.stringify(missedMarks),
      )
      check.fact(
        `标记覆盖：list 回执里的会话 ${String(stats.listIds.size)} 条，行 ${String(schedule.rows)} 枚标记 ${String(schedule.marks)}`,
      )
      check.ok(
        '标记是官方件的形状（role=img + schedule.active 文案 + 图标）',
        schedule.role === 'img' && schedule.label === '有活动定时任务' && schedule.title === '有活动定时任务' && schedule.svg,
        JSON.stringify(schedule),
      )
      check.ok(
        '标记几何取自官方那条规则（16×20、右外边距 6px）',
        schedule.width === '16px' && schedule.height === '20px' && schedule.marginRight === '6px',
        `${schedule.width}×${schedule.height} margin-right=${schedule.marginRight}`,
      )
      check.ok(
        '位置与官方一致（标题之后、相对时间之前）',
        schedule.titleIndex >= 0 && schedule.markIndex === schedule.titleIndex + 1,
        JSON.stringify({ title: schedule.titleIndex, mark: schedule.markIndex, children: schedule.marks }),
      )
      screenshots.push(await shot(ctx, page, 'empty-schedule-mark'))

      // L6 之二：搜索上限提示（官方 search.hasMore 键，此前没有使用点）。
      // #132：搜索栏默认收起，先点开放大镜再打字。
      await page.click('[data-dshone-tree-action="search"]')
      await page.waitForTimeout(250)
      await page.fill('[data-dshone-tree="search-input"]', 'lab-has-more-fixture')
      await page.waitForSelector('[data-dshone-tree="search-more"]', { timeout: 8_000 }).catch(() => undefined)
      const search = await page.evaluate(() => {
        const more = document.querySelector('[data-dshone-tree="search-more"]')
        const rows = Array.from(document.querySelectorAll('[data-dshone-tree="search"] [data-dshone-tree-row]'))
        return {
          more: more?.textContent ?? '',
          results: rows.length,
          rowSchedule: rows[0]?.querySelector('[data-dshone-tree-schedule]') !== null,
          status: Array.from(document.querySelectorAll('.dshOneTree_searchStatus')).map((el) => el.textContent ?? ''),
        }
      })
      check.fact(
        `搜索夹具：结果行=${String(search.results)} 上限提示=${JSON.stringify(search.more)} 状态行=${JSON.stringify(search.status)}（夹具回执调用 ${String(stats.searchCalls)} 次）`,
      )
      check.ok('搜索回执带 hasMore 时出上限提示（官方 search.hasMore 键）', search.more.includes('仅显示前') && search.more.includes('条结果'), search.more)
      check.ok(
        '提示里带上限条数（数值来自官方 searchResultLimit）',
        /仅显示前 (\d+) 条结果/.test(search.more) && Number(/仅显示前 (\d+) 条结果/.exec(search.more)?.[1] ?? '0') > 0,
        search.more,
      )
      check.ok('夹具那条结果按真会话渲染（行在）', search.results >= 1, String(search.results))
      check.ok('搜索结果行也带上定时任务标记（官方 search 变体）', search.rowSchedule, JSON.stringify(search))
      screenshots.push(await shot(ctx, page, 'empty-search-has-more'))
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)

      // ---- ③ 三类失败的可见反馈 ----
      const rowMenu = async (id: string, item: string): Promise<void> => {
        const row = page.locator(`[data-dshone-tree-session="${id}"]`)
        await row.hover()
        await row.locator('.dshOneTree_rowIconButton').click()
        await page.waitForTimeout(250)
        await page.click(`[data-dshone-tree-item="${item}"]`)
      }
      const flashText = async (): Promise<string> => (await page.textContent('[data-dshone-tree="flash"]')) ?? ''

      // (a) 分叉失败：`session/fork` 的回执被夹具换成失败（请求不落到网关）。
      await rowMenu(probe.id, 'fork')
      await page.waitForTimeout(900)
      const forkFlash = await flashText()
      check.fact(`分叉失败：夹具拦到的 fork 请求=${String(stats.forkCalls)} 飘提示=${JSON.stringify(forkFlash)}`)
      check.ok('分叉失败真的走过了那条 RPC（夹具拦到请求 = 没落到网关）', stats.forkCalls === 1, String(stats.forkCalls))
      check.ok(
        '分叉失败有一行可见反馈（原来静默吞掉）',
        forkFlash.includes('分叉会话失败') && forkFlash.includes('fork rejected'),
        forkFlash,
      )
      screenshots.push(await shot(ctx, page, 'empty-fork-failed'))

      // (b) 多开失败：宿主能力口回 `lab/forced`（见 openTreePage 的 failCalls）。
      await rowMenu(probe.id, 'openInNewTab')
      await page.waitForTimeout(900)
      const tabFlash = await flashText()
      const forcedCalls = await page.evaluate(
        () => (globalThis as unknown as { __LAB_HOST__?: { hostCalls: { call: string }[] } }).__LAB_HOST__?.hostCalls.filter((entry) => entry.call === 'session.openInNewTab').length ?? -1,
      )
      check.fact(`多开失败：宿主收到的调用=${String(forcedCalls)} 飘提示=${JSON.stringify(tabFlash)}`)
      check.ok('多开真的走过了宿主能力口', forcedCalls === 1, String(forcedCalls))
      check.ok(
        '多开失败有一行可见反馈（原来只往控制台写一行）',
        tabFlash.includes('在新标签页打开失败'),
        tabFlash,
      )
      screenshots.push(await shot(ctx, page, 'empty-multitab-failed'))

      // (c) 归档失败：`workspace/archiveSession` 的回执被夹具换成失败。
      // 挑一条归档项可用的行（资格判定见 pure/sessionEligibility.ts）：逐行开菜单读判定，
      // 与 F-15 同一做法——菜单走 portal，打开后要等它渲染出来才读得到。
      // 候选按「有 ⋯ 按钮」挑（#109 起空白会话行也挂行操作容器，但它没有按钮可点）。
      const archiveCandidates = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-dshone-tree-row="session"]'))
          .filter((row) => row.querySelector('[data-dshone-tree-action="session-menu"]') !== null)
          .slice(0, 8)
          .map((row) => row.getAttribute('data-dshone-tree-session') ?? ''),
      )
      let archivable = ''
      for (const id of archiveCandidates) {
        const row = page.locator(`[data-dshone-tree-session="${id}"]`)
        await row.hover()
        await row.locator('.dshOneTree_rowIconButton').click()
        await page.waitForTimeout(200)
        const reason = await page
          .getAttribute('[data-dshone-tree-item="archive"]', 'data-dshone-disabled-reason')
          .catch(() => null)
        await page.keyboard.press('Escape')
        await page.waitForTimeout(150)
        if (reason === '') {
          archivable = id
          break
        }
      }
      check.fact(`归档夹具：候选 ${String(archiveCandidates.length)} 行，可归档的那一行=${archivable === '' ? '(没有可归档的行)' : archivable}`)
      await page.waitForTimeout(300)
      if (archivable !== '') {
        await rowMenu(archivable, 'archive')
        await page.waitForTimeout(400)
        const confirmOpen = await contentCount(page, '[data-dshone-tree-action="archive-confirm"]')
        check.ok('归档仍先开确认弹窗（失败反馈不改变这条语义）', confirmOpen === 1, String(confirmOpen))
        await page.click('[data-dshone-tree-action="archive-confirm"]')
        await page.waitForTimeout(1_200)
        const archive = await page.evaluate(() => ({
          alert: document.querySelector('[role="alert"]')?.textContent ?? '',
          flash: document.querySelector('[data-dshone-tree="flash"]')?.textContent ?? '',
        }))
        check.fact(`归档失败：夹具拦到的归档请求=${String(stats.archiveCalls)} 弹窗内联=${JSON.stringify(archive.alert)} 飘提示=${JSON.stringify(archive.flash)}`)
        check.ok('归档失败真的走过了那条 RPC（夹具拦到请求 = 没落到网关）', stats.archiveCalls === 1, String(stats.archiveCalls))
        check.ok('归档失败在弹窗里有一行红字（原本只有这一处）', archive.alert.includes('归档失败'), archive.alert)
        check.ok('归档失败另外飘一条可见反馈（关掉弹窗也看得到）', archive.flash.includes('归档失败'), archive.flash)
        screenshots.push(await shot(ctx, page, 'empty-archive-failed'))
        await page.keyboard.press('Escape')
        await page.waitForTimeout(300)
      }

      // ---- ④ 加载态 + 零工作区空态（夹具把工作区清单改成空并推迟 2.5 秒） ----
      fixtures.emptyWorkspaces = true
      fixtures.delayWorkspaceFollowMs = 2_500
      await page.reload({ waitUntil: 'domcontentloaded' })
      const loadingSeen = await page
        .waitForSelector('[data-dshone-tree-empty="loading"]', { timeout: 10_000 })
        .then(() => true)
        .catch(() => false)
      const loadingText = await page.textContent('[data-dshone-tree-empty="loading"]').catch(() => null)
      check.fact(`加载态：出现=${String(loadingSeen)} 文案=${JSON.stringify(loadingText)}`)
      check.ok('工作区快照没到时列表区出加载文案（原来整块空白）', loadingSeen && (loadingText ?? '').includes('加载中'), String(loadingText))
      if (loadingSeen) screenshots.push(await shot(ctx, page, 'empty-loading'))
      await page.waitForSelector('[data-dshone-tree-empty="no-workspaces"]', { timeout: 15_000 })
      await page.waitForTimeout(600)
      const zero = await page.evaluate(() => {
        const notice = document.querySelector('[data-dshone-tree-empty="no-workspaces"]')
        return {
          text: notice?.textContent ?? '',
          loadingGone: document.querySelector('[data-dshone-tree-empty="loading"]') === null,
          addButton: document.querySelector('[data-dshone-tree-action="add-workspace"]') !== null,
          sections: Array.from(document.querySelectorAll('[data-dshone-group-key]')).map((el) => el.getAttribute('data-dshone-group-key') ?? ''),
          emptiedFrames: 0,
        }
      })
      check.fact(
        `零工作区：文案=${JSON.stringify(zero.text)} 分组块键=${JSON.stringify(zero.sections)} 夹具改空的 follow 帧=${String(stats.emptiedFollowFrames)}`,
      )
      check.ok('夹具真的改空了工作区清单的帧（否则这条空态无从谈起）', stats.emptiedFollowFrames > 0, String(stats.emptiedFollowFrames))
      check.ok(
        '零工作区空态文案写明用上方的 ＋（旧侧栏同款说法）',
        zero.text.includes('还没有工作区') && zero.text.includes('＋'),
        zero.text,
      )
      check.ok('文案指的入口真在场（顶栏的添加工作区）', zero.addButton)
      check.ok('加载态已被零工作区空态取代（不是一直转圈）', zero.loadingGone)
      check.ok(
        '真没有工作区块了（剩下的分组块只有「未分组」那一桶）',
        zero.sections.every((key) => key === ''),
        JSON.stringify(zero.sections),
      )
      screenshots.push(await shot(ctx, page, 'empty-no-workspaces'))

      check.eq('空态与反馈套件全程零 pageerror', withoutKnownNoise(opened.capture.pageErrors).real, [])
    } finally {
      await opened.context.close()
    }
    return screenshots
  },
}

// F-19 SIDEBAR-MENUS：菜单补全（#109）
// ---------------------------------------------------------------------------

/**
 * 从网关取一份**工作区清单**（`workspace/follow` 的基线帧，只读订阅，取到即退订）。
 *
 * 为什么套件需要它：侧栏树的「当前工作区」按 **VS Code 当前打开的文件夹路径**判定
 * （#112），而实验室的假宿主没有「用户开了哪个文件夹」这件真事——套件把网关上的真实
 * 工作区路径喂给假宿主（`openTreePage(..., { workspaceFolders })`），等价于「VS Code
 * 里正开着这个文件夹」。取不到（流打不开/超时）回空表，调用方据此记事实并跳过相关断言。
 */
async function gatewayWorkspaces(gateway: string): Promise<readonly { workspaceId: string; path: string }[]> {
  let subscription: ReturnType<typeof subscribeWorkspaceStream> | undefined
  let timer: NodeJS.Timeout | undefined
  // 这条流的 `logger` 形参类型是扩展侧的 `Logger` 类（构造要 vscode，实验室里没有），
  // 而它实际只用 `info/warn/error` 三件——`log.ts` 的 `LogSink` 注释就是这么写的，
  // 所以这里用 `consoleLogger` 顶上（类型只做投影，不进运行期）。
  const logger = consoleLogger(true) as unknown as Logger
  return await new Promise<readonly { workspaceId: string; path: string }[]>((resolve) => {
    const finish = (items: readonly { workspaceId: string; path: string }[]): void => {
      if (timer !== undefined) clearTimeout(timer)
      subscription?.dispose()
      resolve(items)
    }
    timer = setTimeout(() => finish([]), 10_000)
    subscription = subscribeWorkspaceStream(gateway, logger, (frame) => {
      if (frame.type !== 'baseline') return
      finish(
        frame.items.flatMap((item) => {
          const record = item as { workspaceId?: unknown; path?: unknown }
          return typeof record.workspaceId === 'string' && typeof record.path === 'string' && record.path !== ''
            ? [{ workspaceId: record.workspaceId, path: record.path }]
            : []
        }),
      )
    })
  })
}

/** 当前菜单（DOM 里最后一个 `[role="menu"]`）的项：标记、文案、禁用态，按 DOM 顺序。 */
interface SidebarMenuItem {
  marker: string
  text: string
  disabled: boolean
  reason: string
  tip: string
  /** 二级菜单的子项（就地展开出来的那些：标记以 `-group-item` 结尾）。 */
  inSubmenu: boolean
  checked: string | null
}

async function sidebarMenuItems(
  page: OpenedPage['page'],
): Promise<{ items: SidebarMenuItem[]; separators: number; title: string }> {
  return page.evaluate(() => {
    // 名字里的「当前菜单」= DOM 里最后一个 `[role="menu"]`：二级菜单也是 `role="menu"`
    // （官方 Menu 的 submenu 内联子树），展开后它就是最后一个。
    const menu = Array.from(document.querySelectorAll('[role="menu"]')).pop() ?? null
    if (menu === null) return { items: [], separators: 0, title: '' }
    const title = (menu.querySelector('[data-dshone-tree-item="menu-title"]')?.textContent ?? '').trim()
    const items = Array.from(menu.querySelectorAll('button[role="menuitem"]')).map((node) => {
      const button = node as HTMLButtonElement
      const mark = button.querySelector('[data-dshone-tree-item]')
      const marker = mark?.getAttribute('data-dshone-tree-item') ?? ''
      return {
        marker,
        text: (mark?.textContent ?? button.textContent ?? '').trim(),
        disabled: button.disabled === true,
        reason: mark?.getAttribute('data-dshone-disabled-reason') ?? 'missing',
        tip: mark?.getAttribute('title') ?? '',
        // 二级菜单的子项就是同一份 items 里排在父项后面的普通项（就地展开，见 rows.ts 的
        // submenuChild——官方 submenu 槽是右侧飞出的一层，窄侧栏里会被裁掉），按标记认。
        inSubmenu: marker.endsWith('-group-item'),
        checked: mark?.getAttribute('data-dshone-group-checked') ?? null,
      }
    })
    return { items, separators: menu.querySelectorAll('[role="separator"]').length, title }
  })
}

/** 菜单里顶层项的标记顺序（二级子项与标题行不算）。 */
function topLevelMarkers(facts: { items: readonly SidebarMenuItem[] }): string[] {
  return facts.items.filter((item) => !item.inSubmenu && item.marker !== 'menu-title').map((item) => item.marker)
}

/** 树里全部工作区行的键（`data-dshone-tree-key`，未分组桶是空串）。 */
async function workspaceRowKeys(page: OpenedPage['page']): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-dshone-tree-row="workspace"]')).map(
      (row) => row.getAttribute('data-dshone-tree-key') ?? '',
    ),
  )
}

/** hover 某个工作区行之后，行上那几枚动作按钮的 `data-dshone-tree-action`（按 DOM 顺序）。 */
async function workspaceRowActions(page: OpenedPage['page'], key: string): Promise<string[]> {
  const row = page.locator(`[data-dshone-tree-row="workspace"][data-dshone-tree-key="${key}"]`)
  await row.hover()
  await page.waitForTimeout(200)
  return row
    .locator('.dshOneTree_rowActions button')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-dshone-tree-action') ?? ''))
}

/** 假宿主记下的工作区打开 / 终端动作（#109 的两条新能力）。 */
async function hostWorkspaceActions(
  page: OpenedPage['page'],
): Promise<{ folders: { path: string; newWindow: boolean }[]; terminals: { path: string }[] }> {
  return page.evaluate(() => {
    const host = (globalThis as unknown as {
      __LAB_HOST__?: { openedFolders?: { path: string; newWindow: boolean }[]; terminalsOpened?: { path: string }[] }
    }).__LAB_HOST__
    return { folders: host?.openedFolders ?? [], terminals: host?.terminalsOpened ?? [] }
  })
}

/**
 * 菜单补全（#109）：会话行十项、接管条件放宽为「仅非选择态」、工作区行 hover 四按钮与
 * 右键七项、二级菜单就地翻转、当前工作区标识。
 *
 * 数据面与其它套件一致（真实网关**只读** + 假宿主 + 注入的分组状态）：本套件**不点**
 * 任何会写网关的项（归档确认、从列表移除确认、新建会话），只验菜单的项序、禁用条件与
 * 就地反馈；「复制」走官方 primitives 的 `writeClipboard`，只写浏览器剪贴板。
 */
export const SIDEBAR_MENUS_SUITE: LabSuite = {
  id: 'F-19',
  phase: 'new-feature',
  name: '侧栏菜单补全（#109）：会话行十项 + 接管条件 + 工作区行 hover 四按钮与右键七项 + 二级菜单 + 当前工作区标识（SIDEBAR-MENUS 套件）',
  expect:
    '侧栏树在真实装配页上（真网关只读 + 假宿主 + 注入的分组状态与标签组状态）：① **会话行菜单**按截图顺序凑齐十项（选择多个 / 在新标签页打开 / 重命名 / 置顶·取消置顶 / 标为未读·已读 / 移到分组… / 分叉会话 / 复制引用 / 移入回收站 / 归档会话），标题行「会话: {label}」、**无分隔线**；「移到分组…」是二级菜单（**就地展开**，子项 = 本工作区的标签组 + 不归入 + 新建）：点一项就归组并写回 `tags`、重开菜单时该项带官方 ✓；两项危险动作的禁用态与其判定原因一致；「置顶」按状态就地翻转并写宿主状态；「复制引用」写剪贴板并给飘提示；「选择多个」进选择态。② **接管条件只剩「非选择态」**：行右键开出同一份菜单（横向锚在指针处——活数据页面上行会在测量与点击之间移动，纵向逐像素那一条由 F-08 钉），Esc 关掉；空白会话行也挂着菜单容器（官方不给显式 ⋯，右键仍接管）。③ **工作区行 hover 四按钮**＝＋ / 终端打开 / 在 VS Code 打开（**仅非当前工作区**）/ 从列表移除；终端与打开文件夹经能力口发出带该工作区路径的调用。④ **工作区行右键七项**（复制文件夹引用 / 分组… / 归档该工作区全部会话 / 在新窗口打开文件夹 / 复制路径 / 重命名工作区 / 从列表移除），「分组…」展开后子项就地翻转 ✓ 且**不关菜单**（归属写回宿主状态），「归档全部会话」开的是 #103 那个确认弹窗（本套件只取消、不确认）。⑤ **当前工作区标识**：蓝色胶囊写宿主名（`vscode`）、该组排在最前、文件夹图标染色——假宿主上报的「打开的文件夹」= **网关上的第一个真实工作区路径**（#112 起判定按文件夹，不再按当前会话；这一条的口径细节与顺序稳定性由 F-21 钉）。全程零 pageerror。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const groupsState = {
      version: 1,
      groups: [
        { id: 'g-lab-one', name: 'Lab One' },
        { id: 'g-lab-two', name: 'Lab Two' },
      ],
      membership: {},
      activeGroupId: null,
    }
    // #112：当前工作区 = VS Code 打开的文件夹。实验室里由套件喂路径，取网关上第一个
    // 真实工作区（它必然出现在树里，于是「这一组是当前工作区」有确定的目标）。
    const gatewayPaths = await gatewayWorkspaces(ctx.lab.gateway)
    const currentFolder = gatewayPaths[0]?.path ?? ''
    check.fact(`网关工作区（假宿主「打开的文件夹」取第一个）：${JSON.stringify(gatewayPaths.map((w) => w.path))}`)
    check.ok('网关上有工作区可当「当前工作区」', currentFolder !== '', JSON.stringify(gatewayPaths))
    const opened = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), {
      width: 380,
      height: 900,
      state: { groups: groupsState },
      ...(currentFolder === '' ? {} : { workspaceFolders: [currentFolder] }),
    })
    const { page } = opened
    try {
      // 剪贴板要显式授权（否则 navigator.clipboard 会以权限拒绝收场）。
      await opened.context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await expandAllGroups(page)

      // ---- ① 会话行菜单：项序、标题行、分隔线 ----
      // 夹具要三样东西：一条**没归组**的会话行（菜单断言都用它）、以及同一个工作区里
      // 另外两条会话——标签组只与成员一起存在（#107 的空组会被清掉），所以要给两个组各
      // 挂一条成员，注进去的组才留得住。
      const fixture = await page.evaluate(() => {
        for (const section of Array.from(document.querySelectorAll('[data-dshone-group-key]'))) {
          const rows = Array.from(section.querySelectorAll('[data-dshone-tree-row="session"]')).filter(
            (row) => row.querySelector('[data-dshone-tree-action="session-menu"]') !== null,
          )
          if (rows.length >= 3) {
            const at = (index: number): string => rows[index]?.getAttribute('data-dshone-tree-session') ?? ''
            return {
              key: section.getAttribute('data-dshone-group-key') ?? '',
              id: at(0),
              title: rows[0]?.querySelector('.dshOneTree_title')?.textContent ?? '',
              members: [at(1), at(2)],
            }
          }
        }
        return null
      })
      check.fact(`夹具会话：${JSON.stringify(fixture)}`)
      check.ok('找到一条没归组的会话行（同区块另有两条可挂进标签组）', fixture !== null && fixture.id !== '' && fixture.members.every((id) => id !== ''))
      if (fixture === null || fixture.id === '' || !fixture.members.every((id) => id !== '')) return screenshots
      let sessionId = fixture.id
      let sessionTitle = fixture.title

      // 「移到分组…」这一项的数据来自 #107 的标签组（状态在假宿主里，键 `tags`）：给**每个**
      // 工作区都注两个组（默认网关数据里一个组都没有），重载后那一项才有组可列。
      // 注给每个工作区而不是只注夹具那一个：重载后树的分组顺序可能变（当前会话变了），
      // 只注一个的话夹具那一行可能落在没注过的工作区里，断言就观察不到东西了。
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
      check.fact(`标签组夹具：在夹具那个工作区注两个组（各挂一条成员）${JSON.stringify(tagState.workspaces[fixture.key].sessionTags)}`)
      await page.addInitScript({
        content: `(() => { globalThis.__LAB_HOST__.stateStore['tags'] = ${JSON.stringify(tagState)} })()`,
      })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector(route('sidebar').readySelector, { timeout: 40_000 })
      await page.waitForTimeout(2_500)
      await expandAllGroups(page)
      check.fact(`注入后宿主里的 tags 键=${JSON.stringify(Object.keys(((await hostState(page, 'tags')) as { workspaces?: Record<string, unknown> } | null)?.workspaces ?? {}).length)}`)

      // 重载后仍用那一条夹具（它是没归组的那一条）：行在不在、标题是什么都重新读一遍。
      const afterReload = await page.evaluate((id: string) => {
        const row = document.querySelector(`[data-dshone-tree-session="${id}"]`)
        if (row === null) return null
        return {
          id,
          title: row.querySelector('.dshOneTree_title')?.textContent ?? '',
          hasMenu: row.querySelector('[data-dshone-tree-action="session-menu"]') !== null,
        }
      }, sessionId)
      check.ok('重载后夹具那一行还在（带 ⋯ 可开菜单）', afterReload !== null && afterReload.hasMenu)
      if (afterReload === null) return screenshots
      sessionTitle = afterReload.title
      check.fact(`重载后的夹具会话：${JSON.stringify(afterReload)}`)

      await openSessionMenu(page, sessionId)
      const sessionMenu = await sidebarMenuItems(page)
      const sessionMarkers = topLevelMarkers(sessionMenu)
      // #107 标签组未落地 → 没有分组 → 「移到分组…」整项不出现（#109 的口径）。
      const tagGroupsAvailable = sessionMarkers.includes('moveToGroup')
      const expectedSessionItems = [
        'selectMultiple',
        'openInNewTab',
        'rename',
        'pin',
        'unread',
        ...(tagGroupsAvailable ? ['moveToGroup'] : []),
        'fork',
        'copyReference',
        'move-to-recycle-bin',
        'archive',
      ]
      check.fact(
        `会话行菜单项序：${JSON.stringify(sessionMarkers)}（文案：${JSON.stringify(sessionMenu.items.filter((i) => !i.inSubmenu && i.marker !== 'menu-title').map((i) => i.text))}）`,
      )
      check.fact(
        tagGroupsAvailable
          ? '标签组能力在场：菜单里含「移到分组…」二级项'
          : '标签组能力缺席（#107 未落地）：按 #109 的口径「没有分组就不显示该项」，「移到分组…」不出现，其余九项齐备',
      )
      check.eq('会话行菜单的项序与截图一致（十项；标签组未落地时九项 + 缺的正是「移到分组…」）', sessionMarkers, expectedSessionItems)
      check.eq('标题行是「会话: {label}」', sessionMenu.title, `会话: ${sessionTitle}`)
      check.eq('菜单里没有分隔线', sessionMenu.separators, 0)
      screenshots.push(await shot(ctx, page, 'menus-session'))

      // 「移到分组…」二级菜单（#107 的标签组）：原地展开、子项就地翻转 ✓、不关菜单。
      if (tagGroupsAvailable) {
        check.eq('展开前没有子项（二级菜单要点了才展开）', sessionMenu.items.filter((item) => item.marker.startsWith('tag:')).length, 0)
        await page.click('[data-dshone-tree-item="moveToGroup"]')
        await page.waitForTimeout(250)
        const expandedGroups = await sidebarMenuItems(page)
        const tagChildren = expandedGroups.items.filter((item) => item.marker.startsWith('tag:'))
        check.fact(`「移到分组…」展开后子项：${JSON.stringify(tagChildren.map((item) => ({ m: item.marker, t: item.text })))}`)
        check.eq('展开出本工作区的两个标签组（+ 不归入 + 新建）', tagChildren.map((item) => item.text), [
          '组一',
          '组二',
          '不归入标签组',
          '新建标签组',
        ])
        check.eq('展开后菜单没关（子项追加在同一份菜单里，就地展开）', await contentCount(page, '[role="menu"]'), 1)
        const indented = await page.evaluate(() =>
          Array.from(document.querySelectorAll('[data-dshone-tree-item^="tag:"]')).every(
            (mark) => mark.closest('.dshOneTree_submenuItem') !== null,
          ),
        )
        check.ok('子项带二级标记类（`.dshOneTree_submenuItem`，层级由父项的文字列 + 右端那枚 chevron 呈现）', indented)
        screenshots.push(await shot(ctx, page, 'menus-session-group-submenu'))
        await page.click('[data-dshone-tree-item="tag:t-one"]')
        await page.waitForTimeout(500)
        const tagsState = (await hostState(page, 'tags')) as { workspaces?: Record<string, { sessionTags?: Record<string, string> }> } | null
        check.fact(`点「组一」后：宿主 tags=${JSON.stringify(tagsState?.workspaces?.[fixture.key]?.sessionTags)}`)
        check.eq(
          '点标签组项 = 就地归组（写回宿主状态）',
          tagsState?.workspaces?.[fixture.key]?.sessionTags?.[sessionId] ?? '',
          't-one',
        )
        // 归组后这一行会被搬到「组一」的块里（#107 的块渲染）：行换了父节点 → React 重挂
        // → 挂在行上的菜单跟着收起。所以「不关菜单」这一条对**会搬家**的会话项不成立，
        // 这里改验它的等价结果：那一行确实进了「组一」的块，且重开菜单时 ✓ 已经落在组一上。
        const blocks = await tagBlockFacts(page)
        const inGroup = blocks.find((block) => block.tag === 't-one')
        check.fact(`归组后页面上的标签组块：${JSON.stringify(blocks.map((b) => ({ t: b.tag, rows: b.rows.length })))}`)
        check.ok('归组后那一行搬进了「组一」的块（行换了位置）', inGroup !== undefined && inGroup.rows.includes(sessionId), JSON.stringify(inGroup))
        await page.keyboard.press('Escape')
        await page.waitForTimeout(250)
        await openSessionMenu(page, sessionId)
        await page.click('[data-dshone-tree-item="moveToGroup"]')
        await page.waitForTimeout(250)
        const rechecked = await page.evaluate(
          (marker: string) => {
            const button = document.querySelector(`[data-dshone-tree-item="${marker}"]`)?.closest('button') ?? null
            return {
              children: button?.childElementCount ?? 0,
              text: button?.textContent?.trim() ?? '',
            }
          },
          `tag:t-one`,
        )
        check.fact(`重开菜单后「组一」项：${JSON.stringify(rechecked)}`)
        check.eq('重开菜单时「组一」项带官方勾选态（selectedIds 的 ✓）', rechecked.children, 3)
        await page.click('[data-dshone-tree-item="tag:__none"]')
        await page.waitForTimeout(500)
        const unassignedTags = (await hostState(page, 'tags')) as { workspaces?: Record<string, { sessionTags?: Record<string, string> }> } | null
        check.fact(`点「不归入标签组」后宿主 tags=${JSON.stringify(unassignedTags?.workspaces?.[fixture.key]?.sessionTags)}`)
        check.ok(
          '「不归入标签组」即取消归组（同一入口的开关语义）',
          (unassignedTags?.workspaces?.[fixture.key]?.sessionTags?.[sessionId] ?? '') === '',
          JSON.stringify(unassignedTags?.workspaces?.[fixture.key]?.sessionTags),
        )
        await page.keyboard.press('Escape')
        await page.waitForTimeout(250)
        check.eq('Esc 关掉菜单', await contentCount(page, '[role="menu"]'), 0)
      } else {
        check.fact('标签组那一节不在这一行的菜单里（这一行不在任何组块里，或标签组能力缺席）—— 跳过二级菜单断言')
      }

      // 禁用条件：判定原因 ↔ 禁用 ↔ 原因提示三者一致（与 F-15 同一口径）。
      const recycle = sessionMenu.items.find((item) => item.marker === 'move-to-recycle-bin')
      const archive = sessionMenu.items.find((item) => item.marker === 'archive')
      check.fact(`危险两项：移入回收站=${JSON.stringify(recycle)} 归档会话=${JSON.stringify(archive)}`)
      check.ok(
        '「移入回收站」的禁用态与判定原因一致（有原因 = 禁用 + 带提示）',
        recycle !== undefined && (recycle.reason === '' ? !recycle.disabled : recycle.disabled && recycle.tip !== ''),
        JSON.stringify(recycle),
      )
      check.ok(
        '「归档会话」的禁用态与判定原因一致（有原因 = 禁用 + 带提示）',
        archive !== undefined && (archive.reason === '' ? !archive.disabled : archive.disabled && archive.tip !== ''),
        JSON.stringify(archive),
      )

      // ---- ② 复制引用：写剪贴板 + 飘提示 ----
      // 上一节收尾把菜单关掉了（归组后那一行搬过家），这里重新开一次。
      await openSessionMenu(page, sessionId)
      await page.click('[data-dshone-tree-item="copyReference"]')
      await page.waitForTimeout(400)
      const clipboard = await page
        .evaluate(() => navigator.clipboard.readText().catch(() => ''))
        .catch(() => '')
      const copyFlash = await page.textContent('[data-dshone-tree="flash"]').catch(() => '')
      check.fact(`复制引用：剪贴板=${JSON.stringify(clipboard.slice(0, 80))} 飘提示=${JSON.stringify(copyFlash)}`)
      // 会话引用的 id 段是 base64url 编码（`encodeSessionReferenceUri` 的 URI 形态），
      // 所以断言按 mention 的形状认，不去比明文 id。
      check.ok(
        '「复制引用」写的是这条会话的 mention 文本（`@[标题](dsh-session:…)`）',
        /^@\[[^\]]+\]\(dsh-session:[A-Za-z0-9_-]+\)$/.test(clipboard),
        clipboard.slice(0, 120),
      )
      check.ok('「复制引用」给了一条飘提示', (copyFlash ?? '').includes('复制'), String(copyFlash))

      // ---- ③ 置顶：就地翻转 + 写宿主状态（点两次回到原状） ----
      await openSessionMenu(page, sessionId)
      await page.click('[data-dshone-tree-item="pin"]')
      await page.waitForTimeout(400)
      const pinnedState = (await hostState(page, 'pinned')) as { sessionIds?: string[] } | null
      check.ok('「置顶」写进宿主状态存储', (pinnedState?.sessionIds ?? []).includes(sessionId), JSON.stringify(pinnedState))
      await openSessionMenu(page, sessionId)
      const pinnedMenu = await sidebarMenuItems(page)
      check.eq('已置顶时该项文案翻成「取消置顶」', pinnedMenu.items.find((item) => item.marker === 'pin')?.text ?? '', '取消置顶')
      await page.click('[data-dshone-tree-item="pin"]')
      await page.waitForTimeout(400)
      check.eq(
        '再点一次取消置顶（状态回到空集合）',
        (await hostState(page, 'pinned')) as { sessionIds?: string[] } | null,
        { version: 1, sessionIds: [] },
      )

      // ---- ④ 选择多个：菜单项把树带进选择态 ----
      await openSessionMenu(page, sessionId)
      await page.click('[data-dshone-tree-item="selectMultiple"]')
      await page.waitForTimeout(400)
      check.eq('「选择多个」进选择态（操作条出现）', await contentCount(page, '[data-dshone-tree="selection-bar"]'), 1)
      await page.click('[data-dshone-tree-action="select-mode"]')
      await page.waitForTimeout(300)
      check.eq('再点顶栏那枚开关退出选择态', await contentCount(page, '[data-dshone-tree="selection-bar"]'), 0)

      // ---- ⑤ 接管条件：行右键开出同一份菜单（锚在指针处），Esc 关掉 ----
      const row = page.locator(`[data-dshone-tree-session="${sessionId}"]`)
      const box = await row.boundingBox()
      check.ok('会话行取到几何（右键落点已知）', box !== null, JSON.stringify(box))
      if (box !== null) {
        const at = { x: 80, y: Math.round(box.height / 2) }
        // Playwright 的 click 会先把行滚进视野（行会动），所以点击**之后**再量一次几何，
        // 拿它跟菜单锚点比。
        await row.click({ button: 'right', position: at })
        await page.waitForTimeout(300)
        const boxAt = await row.boundingBox()
        const contextMenu = await sidebarMenuItems(page)
        check.fact(`行右键菜单：${JSON.stringify(topLevelMarkers(contextMenu))}`)
        check.eq('行右键开出同一份菜单（非选择态就接管）', topLevelMarkers(contextMenu), expectedSessionItems)
        const anchored = await page.evaluate(() => {
          const menu = Array.from(document.querySelectorAll('[role="menu"]')).pop() ?? null
          const rect = menu?.getBoundingClientRect() ?? null
          return rect === null ? null : { left: Math.round(rect.left), top: Math.round(rect.top) }
        })
        // 横向偏移就是指针锚定的证据（`getAnchorRect` 给的是零尺寸锚点 = 指针位置）。
        // **纵向只记事实不钉数值**：这是活数据页面（网关上的会话在别的 session 手里增删），
        // 行会在点击与测量之间移动，绝对坐标天生不稳——逐像素的那一条在 F-08（专门的
        // 多开套件，页面状态静止）里钉着。
        check.fact(`右键菜单锚点：${JSON.stringify(anchored)} 行(点击后)=${JSON.stringify(boxAt)}`)
        check.ok(
          '右键菜单锚在指针的横坐标上（官方 Menu 的 getAnchorRect；纵坐标由 F-08 钉）',
          anchored !== null && boxAt !== null && Math.abs(anchored.left - (Math.round(boxAt.x) + at.x)) <= 6,
          `anchored=${JSON.stringify(anchored)} 行(点击后)=${JSON.stringify(boxAt)}`,
        )
        screenshots.push(await shot(ctx, page, 'menus-session-rightclick'))
        await page.keyboard.press('Escape')
        await page.waitForTimeout(250)
        check.eq('Esc 关掉行右键菜单', await contentCount(page, '[role="menu"]'), 0)
      }
      // 空白会话行（官方不给显式 ⋯）也挂着菜单容器——右键接管的前提。这一条按 DOM 观察，
      // 网关数据里没有空白行时按 0=0 通过（真网关只读，不造会话去凑它）。
      const blankRows = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('[data-dshone-tree-row="session"]'))
        const blank = rows.filter((row) => row.querySelector('[data-dshone-tree-action="session-menu"]') === null)
        return {
          total: rows.length,
          blank: blank.length,
          blankWithMenuContainer: blank.filter((row) => row.querySelector('.dshOneTree_rowActions') !== null).length,
        }
      })
      check.fact(
        `会话行：共 ${String(blankRows.total)}，其中无 ⋯ 按钮（空白会话）=${String(blankRows.blank)}，它们里有菜单容器的=${String(blankRows.blankWithMenuContainer)}`,
      )
      check.ok(
        '空白会话行也挂着菜单容器（右键能开出菜单）',
        blankRows.blank === blankRows.blankWithMenuContainer,
        JSON.stringify(blankRows),
      )

      // ---- ⑥ 工作区行：hover 四按钮 ----
      const keys = await workspaceRowKeys(page)
      check.fact(`工作区行键：${JSON.stringify(keys.slice(0, 4))}（共 ${String(keys.length)}）`)
      const currentKey = await page.getAttribute('[data-dshone-tree-current="true"]', 'data-dshone-tree-key')
      check.ok('当前工作区那一行带标识属性', currentKey !== null && currentKey !== '', String(currentKey))
      check.eq('当前工作区那一组排在最前（E7 置顶）', keys[0] ?? '', currentKey ?? 'x')
      if (currentKey !== null) {
        const currentActions = await workspaceRowActions(page, currentKey)
        check.fact(`当前工作区行的动作按钮：${JSON.stringify(currentActions)}`)
        check.eq('当前工作区行没有「在 VS Code 打开」（它本来就在编辑器里）', currentActions, [
          'workspace-new-session',
          'workspace-terminal',
          'workspace-remove',
        ])
      }
      const otherKey = keys.find((key) => key !== '' && key !== currentKey) ?? ''
      check.ok('网关上有另一个工作区行可比', otherKey !== '', otherKey)
      if (otherKey !== '') {
        const actions = await workspaceRowActions(page, otherKey)
        check.fact(`非当前工作区行的动作按钮：${JSON.stringify(actions)}`)
        check.eq('非当前工作区行是四枚（＋ / 终端 / 在 VS Code 打开 / 从列表移除）', actions, [
          'workspace-new-session',
          'workspace-terminal',
          'workspace-open',
          'workspace-remove',
        ])
        screenshots.push(await shot(ctx, page, 'menus-workspace-hover'))

        // 终端与打开文件夹：经能力口发出，带的是这个工作区的路径。
        await page.click(
          `[data-dshone-tree-row="workspace"][data-dshone-tree-key="${otherKey}"] [data-dshone-tree-action="workspace-terminal"]`,
        )
        await page.waitForTimeout(400)
        await page.click(
          `[data-dshone-tree-row="workspace"][data-dshone-tree-key="${otherKey}"] [data-dshone-tree-action="workspace-open"]`,
        )
        await page.waitForTimeout(400)
        const actionsSent = await hostWorkspaceActions(page)
        check.fact(`宿主收到的动作：${JSON.stringify(actionsSent)}`)
        check.ok(
          '「终端打开」经能力口发出一次带路径的调用',
          actionsSent.terminals.length === 1 && actionsSent.terminals[0].path !== '',
          JSON.stringify(actionsSent.terminals),
        )
        check.ok(
          '「在 VS Code 打开」经能力口发出一次当前窗口打开（newWindow=false）',
          actionsSent.folders.length === 1 && actionsSent.folders[0].newWindow === false,
          JSON.stringify(actionsSent.folders),
        )
        check.ok(
          '两处用的是同一个工作区路径（页面只送路径，Uri 与终端名在宿主侧定）',
          actionsSent.terminals[0]?.path === actionsSent.folders[0]?.path && (actionsSent.folders[0]?.path ?? '').startsWith('/'),
          JSON.stringify(actionsSent),
        )
      }

      // ---- ⑦ 工作区行右键：七项 + 二级菜单就地翻转 ----
      const menuKey = otherKey === '' ? (keys[0] ?? '') : otherKey
      const workspaceRow = page.locator(`[data-dshone-tree-row="workspace"][data-dshone-tree-key="${menuKey}"]`)
      const wsBox = await workspaceRow.boundingBox()
      check.ok('工作区行取到几何（右键落点已知）', wsBox !== null, JSON.stringify(wsBox))
      if (wsBox !== null) {
        // Playwright 的 click 会先把行滚进视野（行会动），所以在点击**之后**量它的几何，
        // 再拿它跟菜单锚点比——比的是「菜单锚没锚在这次点击的指针处」。
        await workspaceRow.click({ button: 'right', position: { x: 80, y: Math.round(wsBox.height / 2) } })
        await page.waitForTimeout(300)
        const wsBoxAt = await workspaceRow.boundingBox()
        const wsMenu = await sidebarMenuItems(page)
        check.fact(
          `工作区行菜单：${JSON.stringify(topLevelMarkers(wsMenu))}（文案：${JSON.stringify(wsMenu.items.filter((i) => !i.inSubmenu && i.marker !== 'menu-title').map((i) => i.text))}）`,
        )
        check.eq('工作区行右键七项（顺序按截图 + 保留的「重命名工作区」）', topLevelMarkers(wsMenu), [
          'copy-folder-ref',
          'groups',
          'archive-all',
          'open-new-window',
          'copy-path',
          'rename',
          'remove',
        ])
        check.eq(
          '标题行是「工作区: {label}」',
          wsMenu.title,
          `工作区: ${(await workspaceRow.locator('.dshOneTree_title').textContent()) ?? ''}`,
        )
        const anchoredAt = await page.evaluate(() => {
          const menu = Array.from(document.querySelectorAll('[role="menu"]')).pop() ?? null
          const rect = menu?.getBoundingClientRect() ?? null
          return rect === null ? null : { left: Math.round(rect.left), top: Math.round(rect.top) }
        })
        // 期望值按官方规则算（`officialMenuPoint`：锚点 + 4px，再整份钳进视口）——不建模钳位
        // 的话，行一靠下（落点越过 `视口高 − 菜单高 − 12`）这条就会像 F-08 那样平白变红（#159）。
        // 容差保持原样：这一页是活数据，行会在点击与测量之间挪，逐像素的那一条在 F-08。
        const wsPanel = await menuPanelBox(page)
        const wsExpected =
          wsBoxAt === null || wsPanel.size === null
            ? null
            : officialMenuPoint(
                { x: Math.round(wsBoxAt.x) + 80, y: Math.round(wsBoxAt.y) + Math.round(wsBoxAt.height / 2) },
                wsPanel.size,
                wsPanel.viewport,
              )
        check.fact(
          `工作区行右键菜单锚点：${JSON.stringify(anchoredAt)} 期望=${JSON.stringify(wsExpected)}` +
            `（官方钳位线=视口高 ${String(wsPanel.viewport.height)} − 菜单高 ${String(wsPanel.size?.height)} − 12）`,
        )
        check.ok(
          '右键菜单锚在这次点击的指针处（官方 Menu 的 getAnchorRect + 官方自己的视口钳位）',
          anchoredAt !== null &&
            wsExpected !== null &&
            Math.abs(anchoredAt.left - wsExpected.left) <= 3 &&
            Math.abs(anchoredAt.top - wsExpected.top) <= 3,
          `anchored=${JSON.stringify(anchoredAt)} 期望=${JSON.stringify(wsExpected)} 行(点击后)=${JSON.stringify(wsBoxAt)}`,
        )
        const archiveAll = wsMenu.items.find((item) => item.marker === 'archive-all')
        check.ok(
          '「归档该工作区全部会话」的禁用态与判定原因一致',
          archiveAll !== undefined &&
            (archiveAll.reason === '' ? !archiveAll.disabled : archiveAll.disabled && archiveAll.tip !== ''),
          JSON.stringify(archiveAll),
        )
        screenshots.push(await shot(ctx, page, 'menus-workspace-rightclick'))

        // 「分组…」二级菜单：原地展开、子项就地翻转 ✓、不关菜单。
        check.eq('「分组…」展开前没有子项（二级菜单要点了才展开）', wsMenu.items.filter((item) => item.inSubmenu).length, 0)
        await page.click('[data-dshone-tree-item="groups"]')
        await page.waitForTimeout(300)
        const expanded = await sidebarMenuItems(page)
        const children = expanded.items.filter((item) => item.inSubmenu)
        check.fact(`「分组…」展开后子项：${JSON.stringify(children)}`)
        check.ok('「分组…」就地展开出分组列表（二级菜单挂在父项里）', children.length === 2, JSON.stringify(children.map((c) => c.text)))
        check.eq('展开后菜单没关（子项追加在同一份菜单里，就地展开）', await contentCount(page, '[role="menu"]'), 1)
        check.eq('子项初始都是未勾选', children.map((c) => c.checked), ['false', 'false'])
        screenshots.push(await shot(ctx, page, 'menus-workspace-submenu'))
        const firstChild = page.locator('[role="menuitem"]:has-text("Lab One")').first()
        await firstChild.click()
        await page.waitForTimeout(300)
        const assigned = await sidebarMenuItems(page)
        const assignedChild = assigned.items.filter((item) => item.inSubmenu).find((item) => item.text === 'Lab One')
        const assignedState = (await hostState(page, 'groups')) as { membership?: Record<string, string[]> } | null
        check.fact(`勾选一项后：子项=${JSON.stringify(assignedChild)} 宿主归属=${JSON.stringify(assignedState?.membership)}`)
        check.eq('勾选后子项就地翻转 ✓（不重建菜单）', assignedChild?.checked, 'true')
        check.eq('勾选后菜单仍然开着（连勾几个组不用重开）', await contentCount(page, '[role="menu"]'), 1)
        check.ok(
          '勾选写回宿主状态（该工作区记上这个分组）',
          Object.values(assignedState?.membership ?? {}).some((ids) => Array.isArray(ids) && ids.includes('g-lab-one')),
          JSON.stringify(assignedState?.membership),
        )
        await firstChild.click()
        await page.waitForTimeout(300)
        const unassigned = await sidebarMenuItems(page)
        const unassignedState = (await hostState(page, 'groups')) as { membership?: Record<string, string[]> } | null
        check.eq(
          '再点一次就地取消勾选（同一入口的开关语义）',
          unassigned.items.filter((item) => item.inSubmenu).find((item) => item.text === 'Lab One')?.checked,
          'false',
        )
        check.ok(
          '取消勾选同样写回宿主状态',
          !Object.values(unassignedState?.membership ?? {}).some((ids) => Array.isArray(ids) && ids.includes('g-lab-one')),
          JSON.stringify(unassignedState?.membership),
        )

        // 「归档该工作区全部会话」开的是 #103 那个确认弹窗（本套件只取消、从不确认）。
        if (archiveAll !== undefined && !archiveAll.disabled) {
          await page.click('[data-dshone-tree-item="archive-all"]')
          await page.waitForTimeout(400)
          const confirm = await page.evaluate(() => {
            const root = document.querySelector('[data-dshone-tree-action="archive-confirm"]')?.closest('[role="dialog"], body')
            return {
              button: document.querySelector('[data-dshone-tree-action="archive-confirm"]') !== null,
              blocks: document.querySelectorAll('[data-dshone-archive-block]').length,
              text: root?.textContent ?? '',
            }
          })
          check.fact(`工作区归档确认弹窗：${JSON.stringify({ button: confirm.button, blocks: confirm.blocks })}`)
          check.ok('「归档该工作区全部会话」先开确认弹窗（不是直接执行）', confirm.button && confirm.blocks >= 1)
          screenshots.push(await shot(ctx, page, 'menus-workspace-archive-confirm'))
          await page.keyboard.press('Escape')
          await page.waitForTimeout(300)
          check.eq('取消确认 → 弹窗关掉（本套件不确认，绝不写网关）', await contentCount(page, '[data-dshone-tree-action="archive-confirm"]'), 0)
        } else {
          check.fact('这一个工作区里没有够格归档的会话 → 该项禁用，跳过弹窗断言（网关只读，不为此写数据）')
        }

        // 「从列表移除」是危险动作：只开到确认弹窗，然后取消。
        await workspaceRow.hover()
        await page.click(
          `[data-dshone-tree-row="workspace"][data-dshone-tree-key="${menuKey}"] [data-dshone-tree-action="workspace-remove"]`,
        )
        await page.waitForTimeout(400)
        const removeDialog = await page.evaluate(() => document.body.textContent?.includes('从工作区列表中移除') ?? false)
        check.ok('「从列表移除」先过确认弹窗（与旧侧栏同一处置）', removeDialog)
        await page.keyboard.press('Escape')
        await page.waitForTimeout(300)
      }

      // ---- ⑧ 当前工作区标识（E7） ----
      const badge = await page.evaluate(() => {
        const row = document.querySelector('[data-dshone-tree-current="true"]')
        if (row === null) return null
        const pill = row.querySelector('[data-dshone-tree-badge]')
        const folder = row.querySelector('.dshOneTree_folder')
        return {
          shell: pill?.getAttribute('data-dshone-tree-badge') ?? '',
          text: (pill?.textContent ?? '').trim(),
          folderActive: (folder?.className ?? '').includes('dshOneTree_folderActive'),
          first: document.querySelector('[data-dshone-tree-row="workspace"]') === row,
        }
      })
      check.fact(`当前工作区标识：${JSON.stringify(badge)}`)
      check.ok(
        '当前工作区行有那一枚胶囊，写的是宿主名（VS Code 侧 = vscode）',
        badge?.shell === 'vscode' && badge.text === 'vscode',
        JSON.stringify(badge),
      )
      check.ok('当前工作区的文件夹图标染色（与官方同款 folderActive）', badge?.folderActive === true, JSON.stringify(badge))
      check.ok('当前工作区那一组排在最前', badge?.first === true, JSON.stringify(badge))

      // ---- ⑨ 未分组桶：网关数据里有它才断言（只读，不造数据） ----
      const ungroupedRow = await page.evaluate(() => {
        const row = document.querySelector('[data-dshone-tree-row="workspace"][data-dshone-tree-key=""]')
        if (row === null) return null
        return {
          actions: Array.from(row.querySelectorAll('.dshOneTree_rowActions button')).map(
            (node) => node.getAttribute('data-dshone-tree-action') ?? '',
          ),
          hasMenuContainer: row.querySelector('.dshOneTree_rowActions') !== null,
        }
      })
      check.fact(
        `未分组行：${JSON.stringify(ungroupedRow)}（网关当前**没有**未分组桶时为空——真网关只读，不造会话去凑它；未分组行的 ＋ 走的是与工作区行同一个 startSession，源码契约测试 test/assemblyShellContract.test.ts 钉着它不再对 workspaceId === undefined 直接 return）`,
      )
      if (ungroupedRow !== null) {
        check.eq('未分组行 hover 只有 ＋（它没有路径，终端/打开文件夹无从谈起）', ungroupedRow.actions, ['workspace-new-session'])
        check.ok('未分组行也挂着菜单容器（右键能开出菜单）', ungroupedRow.hasMenuContainer)
        await page
          .locator('[data-dshone-tree-row="workspace"][data-dshone-tree-key=""]')
          .click({ button: 'right', position: { x: 80, y: 16 } })
        await page.waitForTimeout(300)
        const ungroupedMenu = await sidebarMenuItems(page)
        check.fact(`未分组行右键菜单：${JSON.stringify(topLevelMarkers(ungroupedMenu))}`)
        check.eq('未分组行菜单 = 新建会话 + 整桶归档（其余项都要路径或工作区身份）', topLevelMarkers(ungroupedMenu), [
          'new-session',
          'archive-all',
        ])
        await page.keyboard.press('Escape')
        await page.waitForTimeout(250)
      }

      check.eq('菜单补全套件全程零 pageerror', withoutKnownNoise(opened.capture.pageErrors).real, [])
    } finally {
      await opened.context.close()
    }
    return screenshots
  },
}

// ---------------------------------------------------------------------------
// F-21 CURRENT-WORKSPACE-FOLDER：当前工作区按 VS Code 打开的文件夹判定（#112）
// ---------------------------------------------------------------------------

/**
 * 三棵**合成**工作区：为什么不用真网关上的工作区——多根、命中、没命中这几档要有
 * **可控的路径**，而真网关有几棵、路径是什么都不由套件决定。会话 id 挂的是真会话
 * （挑非空白、非子代理的），所以行是真的、点得动；只改页面收到的帧，网关仍只读。
 */
const LAB_WORKSPACES: ReadonlyArray<{ workspaceId: string; path: string; title: string }> = [
  { workspaceId: 'lab-ws-one', path: '/lab/ws-one', title: 'Lab One' },
  { workspaceId: 'lab-ws-two', path: '/lab/ws-two', title: 'Lab Two' },
  { workspaceId: 'lab-ws-three', path: '/lab/ws-three', title: 'Lab Three' },
]

/** 把 `workspace/follow` 的基线帧换成 `synthesize(items)` 的产物，其余工作区帧一律丢掉。 */
async function installWorkspaceFixture(
  page: OpenedPage['page'],
  synthesize: (items: readonly unknown[]) => readonly unknown[],
): Promise<{ rewritten: number; dropped: number }> {
  const stats = { rewritten: 0, dropped: 0 }
  await page.routeWebSocket(/remote\.mux/, (socket) => {
    const upstream = socket.connectToServer()
    const endpoints = new Map<string, string>()
    socket.onMessage((message) => {
      try {
        const frame = JSON.parse(String(message)) as { type?: string; streamId?: string; endpoint?: string }
        if (frame.type === 'open' && frame.streamId !== undefined && frame.endpoint !== undefined) {
          endpoints.set(frame.streamId, frame.endpoint)
        }
      } catch {
        /* 客户端帧形状变了就原样转发（夹具不参与协议解读） */
      }
      upstream.send(message)
    })
    upstream.onMessage((message) => {
      const text = String(message)
      let frame: { streamId?: string; type?: string; value?: { type?: string; value?: { items?: unknown[]; archivedSessionIds?: unknown } } } | undefined
      try {
        frame = JSON.parse(text) as typeof frame
      } catch {
        frame = undefined
      }
      const endpoint = frame?.streamId === undefined ? undefined : endpoints.get(frame.streamId)
      if (endpoint !== 'workspace/follow') {
        socket.send(message)
        return
      }
      const payload = frame?.value
      if (frame?.type === 'item' && payload?.type === 'baseline' && payload.value !== undefined) {
        payload.value.items = [...synthesize(Array.isArray(payload.value.items) ? payload.value.items : [])]
        // 归档集合清空：合成工作区引用的都是套件挑的可见会话，留着真归档集合只会让
        // 「哪个会话在树里」变得不确定（真网关只读，这里只改页面收到的帧）。
        payload.value.archivedSessionIds = []
        stats.rewritten += 1
        socket.send(JSON.stringify(frame))
        return
      }
      // 非基线帧（upsert / order / remove / archived）：夹具期间一律不转发——否则真工作区
      // 会从增量里回到树里，合成的那三棵就不确定是唯一的三棵了。
      stats.dropped += 1
    })
  })
  return stats
}

/** 工作区行的面：键序（不含未分组桶）、哪些行是「当前工作区」、哪些行带胶囊。 */
async function workspaceRowFacts(page: OpenedPage['page']): Promise<{
  keys: string[]
  current: string[]
  badged: Array<{ key: string; shell: string; text: string; folderActive: boolean }>
}> {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-dshone-tree-row="workspace"]'))
    const keyOf = (row: Element): string => row.getAttribute('data-dshone-tree-key') ?? ''
    return {
      // 未分组桶（键空串）不参与「工作区顺序」——它恒在最后，见 currentWorkspaceFirst 的口径。
      keys: rows.map(keyOf).filter((key) => key !== ''),
      current: rows.filter((row) => row.getAttribute('data-dshone-tree-current') === 'true').map(keyOf),
      badged: rows.flatMap((row) => {
        const pill = row.querySelector('[data-dshone-tree-badge]')
        if (pill === null) return []
        return [
          {
            key: keyOf(row),
            shell: pill.getAttribute('data-dshone-tree-badge') ?? '',
            text: (pill.textContent ?? '').trim(),
            folderActive: (row.querySelector('.dshOneTree_folder')?.className ?? '').includes('dshOneTree_folderActive'),
          },
        ]
      }),
    }
  })
}

/** 假宿主收到的某条能力调用的次数（本套件用它钉「树确实问过宿主打开了哪些文件夹」）。 */
async function workspaceFolderCalls(page: OpenedPage['page']): Promise<Array<{ args: unknown }>> {
  return page.evaluate(() => {
    const host = (globalThis as unknown as { __LAB_HOST__?: { hostCalls?: Array<{ call: string; args: unknown }> } })
      .__LAB_HOST__
    return (host?.hostCalls ?? []).filter((call) => call.call === 'vscode.workspaceFolders').map((call) => ({ args: call.args }))
  })
}

export const CURRENT_WORKSPACE_FOLDER_SUITE: LabSuite = {
  id: 'F-21',
  phase: 'new-feature',
  name: '当前工作区按 VS Code 打开的文件夹判定（#112）：命中置顶、切换会话不改顺序、空表不置顶、多根（CURRENT-WORKSPACE-FOLDER 套件）',
  expect:
    '侧栏树在真实装配页上（真网关**只读** + 假宿主 + 把 `workspace/follow` 的基线帧换成三棵**合成**工作区的页内夹具；合成工作区的成员是真会话行）：① **文件夹命中 → 徽标 + 置顶**：假宿主上报「打开的文件夹」= 某一棵工作区的路径时，**只有那一棵**带当前工作区标识与蓝色胶囊（写宿主名 `vscode`）、文件夹图标染色，并且**只有它**排到最前（其余保持官方工作区顺序）；② **切换会话不改变工作区顺序**（用户报的现象）：点开另一个工作区里的一条会话行之后，工作区顺序与徽标纹丝不动，新选中的会话所属工作区**不会**因此被标成当前；③ **文件夹表为空 → 无徽标、不置顶**（官方 web 侧没有「VS Code 打开的文件夹」这个概念，能力口在那里回的就是空表；VS Code 空窗口同形）：一个胶囊都没有、顺序 = 官方工作区顺序（同时断言树确实问过宿主这条能力，证明这是「问过、答案是空」而不是没调）；④ **多根**：假宿主上报两个文件夹（三棵合成工作区里命中两棵）时，命中的那两棵**都**是当前（都带徽标、都排到最前，两棵之间保持官方相对顺序），没命中的那棵留在后面；上报一个都不命中的路径时没有徽标、顺序回到官方顺序。全程零 pageerror。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    // 合成工作区的成员：真会话里挑「非空白、非子代理」的（空白会话只在它是当前行时可见，
    // 子代理不进树）。挑不满就按能断言的断言（真网关只读，不为凑夹具去建会话）。
    const sessions = await listSessions(ctx.lab.gateway).catch(() => [])
    const usable = sessions.filter((s) => s.blank !== true && s.origin !== 'subagent').map((s) => s.sessionId)
    const members: readonly (readonly string[])[] = [usable.slice(0, 1), usable.slice(1, 2), usable.slice(2, 4)]
    const sessionsOf = new Map(LAB_WORKSPACES.map((workspace, index) => [workspace.workspaceId, members[index] ?? []]))
    const pathOf = new Map(LAB_WORKSPACES.map((workspace) => [workspace.workspaceId, workspace.path]))
    check.fact(`网关可用会话（非空白、非子代理）：${String(usable.length)} 条；合成三棵工作区各挂 ${JSON.stringify(members.map((m) => m.length))} 条`)

    const opened = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { width: 380, height: 900 })
    const { page } = opened
    try {
      // ① 装夹具并重载：之后树里的工作区就固定是三棵合成的（路径可控）。
      const stats = await installWorkspaceFixture(page, (items) => {
        // 借真 item 的字段面（官方还可能带别的字段），只覆写套件要控制的四个 + 时间戳；
        // 真网关一棵工作区都没有时退化成最小字面量。
        const template = items.find((item) => typeof (item as { path?: unknown }).path === 'string')
        const base = typeof template === 'object' && template !== null ? template : { createdAt: new Date(0).toISOString() }
        return LAB_WORKSPACES.map((workspace, index) => ({
          ...base,
          workspaceId: workspace.workspaceId,
          path: workspace.path,
          title: workspace.title,
          sessionIds: [...(members[index] ?? [])],
          updatedAt: new Date(0).toISOString(),
        }))
      })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector(route('sidebar').readySelector, { timeout: 40_000 })
      await page.waitForTimeout(2_500)
      check.fact(`夹具：workspace/follow 基线帧已换 ${String(stats.rewritten)} 次，丢掉的非基线帧 ${String(stats.dropped)} 帧`)
      check.ok('夹具生效（基线帧被换成合成工作区）', stats.rewritten > 0, JSON.stringify(stats))

      // ---- ③ 文件夹表为空（默认：假宿主没打开任何文件夹）→ 无徽标、不置顶 ----
      const empty = await workspaceRowFacts(page)
      const officialOrder = empty.keys
      check.fact(`官方工作区顺序（合成三棵）：${JSON.stringify(officialOrder)}；空表下面=${JSON.stringify(empty)}`)
      check.eq('三棵合成工作区都在树里（夹具生效）', officialOrder.length, 3)
      check.eq('假宿主上报空文件夹表 → 一个当前工作区都没有', empty.current, [])
      check.eq('空表 → 一个蓝色胶囊都不显示', empty.badged, [])
      check.eq('空表 → 一组都不前移（顺序 = 官方工作区顺序）', empty.keys, officialOrder)
      const emptyCalls = await workspaceFolderCalls(page)
      check.ok(
        '树确实问了宿主「打开了哪些文件夹」（不是没调这条能力就跳过）',
        emptyCalls.length > 0 && JSON.stringify(emptyCalls[0]?.args) === '{}',
        JSON.stringify(emptyCalls),
      )
      screenshots.push(await shot(ctx, page, 'current-workspace-empty'))

      // ---- ① 文件夹命中 → 徽标 + 置顶（拿官方顺序的**最后一棵**当当前，置顶才看得出来）----
      const pinnedKey = officialOrder[officialOrder.length - 1] ?? ''
      const pinnedPath = pathOf.get(pinnedKey) ?? ''
      check.ok('合成工作区里有可当「当前文件夹」的路径', pinnedPath !== '', `${pinnedKey} → ${pinnedPath}`)
      await setLabWorkspaceFolders(opened.context, [pinnedPath])
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector(route('sidebar').readySelector, { timeout: 40_000 })
      await page.waitForTimeout(2_000)
      // 展开分组后再读：文件夹图标染色（`folderActive`）的前提是这一组是展开的——
      // 那是官方行的呈现口径（`active = expanded && containsCurrent`，见 rows.ts）。
      await expandAllGroups(page)
      const hit = await workspaceRowFacts(page)
      const expectedHitOrder = [pinnedKey, ...officialOrder.filter((key) => key !== pinnedKey)]
      check.fact(`命中 ${pinnedPath} 时：顺序=${JSON.stringify(hit.keys)} 当前=${JSON.stringify(hit.current)} 胶囊=${JSON.stringify(hit.badged)}`)
      check.eq('命中的那一棵是唯一的当前工作区', hit.current, [pinnedKey])
      check.eq('命中的那一棵带蓝色胶囊（写宿主名 vscode）', hit.badged, [
        { key: pinnedKey, shell: 'vscode', text: 'vscode', folderActive: true },
      ])
      check.eq('命中的那一棵排最前，其余保持官方顺序', hit.keys, expectedHitOrder)
      screenshots.push(await shot(ctx, page, 'current-workspace-hit'))

      // ---- ② 切换会话不改变工作区顺序（用户报的现象）----
      const clickKey = officialOrder.find((key) => key !== pinnedKey && (sessionsOf.get(key) ?? []).length > 0) ?? ''
      if (clickKey === '') {
        check.fact('没有「非当前工作区 + 有可见会话行」的合成工作区可点（网关可用会话太少），跳过切换会话那一段')
      } else {
        const target = sessionsOf.get(clickKey)?.[0] ?? ''
        const before = await workspaceRowFacts(page)
        await page.locator(`[data-dshone-group-key="${clickKey}"] [data-dshone-tree-row="session"]`).first().click()
        await page.waitForTimeout(600)
        const after = await workspaceRowFacts(page)
        const selected = await page.getAttribute(
          `[data-dshone-tree-row="session"][data-dshone-tree-session="${target}"]`,
          'aria-selected',
        )
        check.fact(
          `点开 ${clickKey} 里的会话 ${target}：顺序 ${JSON.stringify(before.keys)} → ${JSON.stringify(after.keys)}；当前 ${JSON.stringify(before.current)} → ${JSON.stringify(after.current)}`,
        )
        check.eq('确实切到了那条会话（行上 aria-selected）', selected, 'true')
        check.eq('切换会话后工作区顺序不变（用户报的「点开会话就被挪到最前」）', after.keys, before.keys)
        check.eq('切换会话后徽标还留在原来那一棵（当前工作区不跟会话走）', after.current, before.current)
        check.eq('切换会话后胶囊还留在原来那一棵', after.badged, before.badged)
        screenshots.push(await shot(ctx, page, 'current-workspace-session-switch'))
      }

      // ---- ④ 多根的行为（三棵里命中两棵：命中的排最前、没命中的留在后面）----
      const second = officialOrder.find((key) => key !== pinnedKey) ?? ''
      const secondPath = pathOf.get(second) ?? ''
      const hits = officialOrder.filter((key) => key === pinnedKey || key === second)
      const misses = officialOrder.filter((key) => key !== pinnedKey && key !== second)
      await setLabWorkspaceFolders(opened.context, [pinnedPath, secondPath])
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector(route('sidebar').readySelector, { timeout: 40_000 })
      await page.waitForTimeout(2_000)
      const multiHit = await workspaceRowFacts(page)
      check.fact(
        `多根（${pinnedPath} + ${secondPath}）命中两棵时：顺序=${JSON.stringify(multiHit.keys)} 当前=${JSON.stringify(multiHit.current)}`,
      )
      check.eq('多根命中 → 命中的两棵都是当前工作区', multiHit.current, hits)
      check.eq('多根命中 → 两棵都带胶囊', multiHit.badged.map((entry) => entry.key), hits)
      check.eq('多根命中 → 命中的两棵排最前（彼此保持官方相对顺序），没命中的留在后面', multiHit.keys, [
        ...hits,
        ...misses,
      ])

      await setLabWorkspaceFolders(opened.context, ['/lab/not-a-workspace'])
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector(route('sidebar').readySelector, { timeout: 40_000 })
      await page.waitForTimeout(2_000)
      const noHit = await workspaceRowFacts(page)
      check.fact(`多根/单根都没命中时：顺序=${JSON.stringify(noHit.keys)} 当前=${JSON.stringify(noHit.current)}`)
      check.eq('打开的文件夹一个都不命中 → 没有当前工作区（无徽标）', noHit.current, [])
      check.eq('打开的文件夹一个都不命中 → 一组都不前移', noHit.keys, officialOrder)
      screenshots.push(await shot(ctx, page, 'current-workspace-multiroot'))

      check.eq('当前工作区套件全程零 pageerror', withoutKnownNoise(opened.capture.pageErrors).real, [])
    } finally {
      await opened.context.close()
    }
    return screenshots
  },
}

// ---------------------------------------------------------------------------
// F-22 SESSION-ROW-RENAME：会话行点击逻辑 + 行内改名（#115）
// ---------------------------------------------------------------------------

/** 一行的现状（标题 / 当前标记 / 行内改名输入框的取值、选区与焦点）。 */
interface RowRenameFacts {
  exists: boolean
  title: string
  /** 这一行是当前附着会话（`aria-selected`，非选择态下 = `list.current`）。 */
  current: boolean
  /** 这一行在编辑态（`data-dshone-tree-renaming`）。 */
  renaming: boolean
  hasInput: boolean
  value: string
  selStart: number
  selEnd: number
  focused: boolean
  ariaLabel: string
}

async function rowRenameFacts(page: OpenedPage['page'], sessionId: string): Promise<RowRenameFacts> {
  return page.evaluate((id: string) => {
    const row = document.querySelector(`[data-dshone-tree-session="${id}"]`)
    const input = row === null ? null : row.querySelector('[data-dshone-tree-rename="input"]')
    const field = input as HTMLInputElement | null
    return {
      exists: row !== null,
      title: (row?.querySelector('.dshOneTree_title')?.textContent ?? '').trim(),
      current: row?.getAttribute('aria-selected') === 'true',
      renaming: row?.getAttribute('data-dshone-tree-renaming') === 'true',
      hasInput: field !== null,
      value: field?.value ?? '',
      selStart: field?.selectionStart ?? -1,
      selEnd: field?.selectionEnd ?? -1,
      focused: field !== null && document.activeElement === field,
      ariaLabel: field?.getAttribute('aria-label') ?? '',
    }
  }, sessionId)
}

/**
 * 会话行点击逻辑与行内改名（#115）：非当前会话点击 = 打开、当前已打开的会话点击 = 就地
 * 改名，提交沿用既有改名通路。
 *
 * 数据面与其它套件一致（真实网关**只读** + 假宿主）。改会话名是写操作，所以本套件把
 * `session/rename` 的**回执**在页面侧换掉（请求一个都不落网关）：回执按官方 remote 的
 * 契约给 `{ok:true, value:{title, seq}}`，官方客户端拿到它会把标题落进 title 投影
 * （出处：`dsh-api-session-controller` 的 `session.rename` 实现与 `buildListSnapshot`），
 * 于是「标题更新」这一条能在页面上真的看到——行标题跟着变，且全程零写入。
 */
export const SESSION_ROW_RENAME_SUITE: LabSuite = {
  id: 'F-22',
  phase: 'new-feature',
  name: '会话行点击逻辑与行内改名（#115）：非当前行点击=打开、当前行点击=就地改名（Enter 提交 / Esc·失焦取消 / 空与未改动不发请求 / IME 守护 / 重绘保焦点与选区）',
  expect:
    '侧栏树在真实装配页上（真网关只读 + 假宿主 + 页面侧换掉 `session/rename` 的回执）：① **非当前会话行点击 = 打开**——它变成当前会话行（`aria-selected` 移过来），且**不进编辑态**（树上没有任何行内改名输入框）；② **当前会话行再点一下 = 就地改名**——这一行的标题位换成输入框，prefill = 原标题、**整段全选**、焦点已经在输入框上（可以直接打字），输入框有 `aria-label`（词典里的「会话名称」）；③ **Enter 提交走既有通路**——恰好一条 `session/rename`（会话 id = 这一行、标题 = 输入框里的新标题，即官方 `sessions.binding(id).session.rename`），提交后退出编辑态，且回执里的标题落回这一行（**标题更新**在页面上可见）；④ **Esc 取消 / 失焦取消**都退出编辑态、标题不变、**零请求**；IME 组合期间的 Enter 不提交（`compositionstart/end` 与键盘事件自带的 `isComposing` 两条判据各验一次）；⑤ **空串 / 未改动（含全空白）不发请求**——都是直接退出编辑态；⑥ **多选态下点行仍只勾选**——当前行也一样（勾上/取消，不进改名）；⑦ **重绘后输入框的焦点与选区保持**——编辑中折叠全部再展开全部（会话行连同输入框先被摘掉、再重挂回来，是重绘里最硬的一种），焦点、`selectionStart/End` 与草稿都原样还在，且整段没有触发提交。全程零 pageerror。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const opened = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { width: 380, height: 900 })
    const { page } = opened
    try {
      await expandAllGroups(page)

      // ---- 夹一：`session/rename` 的回执在页面侧换成功回执（请求不落网关）----
      // seq 用安全整数上限：官方客户端的投影按 seq 比大小（`seq <= row.seq` 就丢），给上限
      // 才能保证这条标题一定盖过页面上已有的那一版。实验室不写网关，这里就是唯一的标题来源。
      const renameCalls: { sessionId: string; title: string }[] = []
      await page.route('**/api/**', async (r) => {
        const request = r.request()
        const method = decodeURIComponent(request.url()).split('/api/')[1] ?? ''
        if (!method.startsWith('session/rename')) {
          await r.fulfill({ response: await r.fetch() })
          return
        }
        const envelope = JSON.parse(request.postData() ?? '{}') as {
          rpcId?: string
          payload?: { args?: { request?: { sessionId?: string; title?: string } } }
        }
        const call = envelope.payload?.args?.request ?? {}
        renameCalls.push({ sessionId: call.sessionId ?? '', title: call.title ?? '' })
        await r.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            type: 'server-response',
            rpcId: envelope.rpcId ?? '',
            result: { ok: true, value: { title: call.title ?? '', seq: Number.MAX_SAFE_INTEGER } },
          }),
        })
      })

      // ---- 夹二：一行拿来点的会话行（有标题、有 ⋯ 菜单）----
      // 页面刚打开时这一页**可能还没有当前会话**（点开任意一行才会有），所以「当前会话行」
      // 不当作前置条件——本条套件要验的正是「先点开、再点一下改名」这条真实路径。
      const fixture = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('[data-dshone-tree-row="session"]'))
          .map((row) => ({
            id: row.getAttribute('data-dshone-tree-session') ?? '',
            title: (row.querySelector('.dshOneTree_title')?.textContent ?? '').trim(),
            current: row.getAttribute('aria-selected') === 'true',
            menu: row.querySelector('[data-dshone-tree-action="session-menu"]') !== null,
          }))
          .filter((row) => row.id !== '' && row.title !== '' && row.menu)
        return {
          current: rows.find((row) => row.current) ?? null,
          other: rows.find((row) => !row.current) ?? null,
          total: rows.length,
        }
      })
      check.fact(
        `夹具：有标题有 ⋯ 的会话行 ${String(fixture.total)} 条；打开时已有当前会话=${JSON.stringify(fixture.current?.id ?? null)}；拿来点的非当前会话行=${JSON.stringify(fixture.other?.id ?? null)}（${JSON.stringify(fixture.other?.title ?? null)}）`,
      )
      check.ok(
        '页面上有一条**非当前**的会话行可点（有标题、有 ⋯ 菜单）',
        fixture.total > 0 && fixture.other !== null,
      )
      if (fixture.other === null) return screenshots
      const otherId = fixture.other.id
      const otherTitle = fixture.other.title
      const rowSel = `[data-dshone-tree-session="${otherId}"]`
      const inputSel = `${rowSel} [data-dshone-tree-rename="input"]`

      // ---- ① 非当前会话点击 → 打开（且不进编辑态）----
      const currentBefore = fixture.current
      await page.click(rowSel)
      await page.waitForTimeout(500)
      const afterOpen = await rowRenameFacts(page, otherId)
      check.ok('① 非当前会话点击 → 打开：这一行变成当前会话行（当前标记落到它身上）', afterOpen.current)
      check.eq(
        '① 且不进编辑态：树上没有任何行内改名输入框',
        await contentCount(page, '[data-dshone-tree-rename="input"]'),
        0,
      )
      check.eq(
        '① 全树当前标记恰好一行（打开 = 切当前会话，不是多标一行）',
        await contentCount(page, '[data-dshone-tree-row="session"][aria-selected="true"]'),
        1,
      )
      check.ok(
        currentBefore === null
          ? '① 点击前这一页还没有当前会话，点击后当前会话就是刚点的那条（打开真的生效）'
          : '① 点击前已有一条当前会话，点击后原来那条不再标为当前（当前真的切了）',
        currentBefore === null || (await rowRenameFacts(page, currentBefore.id)).current === false,
      )
      screenshots.push(await shot(ctx, page, 'rowrename-01-open'))

      // ---- ② 当前会话行点击 → 就地改名（prefill + 全选 + 焦点）----
      await page.click(rowSel)
      await page.waitForTimeout(400)
      const editing = await rowRenameFacts(page, otherId)
      check.ok('② 当前会话行点击 → 这一行就地变成输入框（编辑态写在行上）', editing.hasInput && editing.renaming)
      check.eq('② prefill = 这一行的原标题', editing.value, otherTitle)
      check.ok(
        `② 整段全选（selectionStart=0 / selectionEnd=${String(otherTitle.length)}）`,
        editing.selStart === 0 && editing.selEnd === otherTitle.length,
        JSON.stringify([editing.selStart, editing.selEnd]),
      )
      check.ok('② 输入框已经拿到焦点（点完就能直接打字）', editing.focused)
      check.eq('⑤ 无障碍：输入框有 aria-label（词典里的「会话名称」）', editing.ariaLabel, '会话名称')
      screenshots.push(await shot(ctx, page, 'rowrename-02-edit'))

      // ---- IME 守护：组合期间的 Enter 不提交（两条判据各一次）----
      const imeDraft = `${otherTitle} 组合中`
      const imeProbe = await page.evaluate(
        ({ id, draft }: { id: string; draft: string }) => {
          const input = document.querySelector(`[data-dshone-tree-session="${id}"] [data-dshone-tree-rename="input"]`)
          const field = input as HTMLInputElement | null
          if (field === null) return null
          field.focus()
          field.value = draft
          field.dispatchEvent(new Event('input', { bubbles: true }))
          // 判据一：compositionstart 之后（官方 WorkspaceBrowser 的改名输入框记的就是这个）。
          field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
          const bareEnter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
          field.dispatchEvent(bareEnter)
          // 判据二：键盘事件自带 isComposing（旧侧栏那条实现用它判）。
          const composingEnter = new KeyboardEvent('keydown', {
            key: 'Enter',
            isComposing: true,
            bubbles: true,
            cancelable: true,
          })
          field.dispatchEvent(composingEnter)
          field.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
          return {
            edited: field.value,
            barePrevented: bareEnter.defaultPrevented,
            composingPrevented: composingEnter.defaultPrevented,
            stillEditing: document.querySelector(`[data-dshone-tree-session="${id}"]`)?.getAttribute('data-dshone-tree-renaming') === 'true',
          }
        },
        { id: otherId, draft: imeDraft },
      )
      check.fact(`IME 探测：${JSON.stringify(imeProbe)}`)
      check.ok(
        '④ IME 组合期间的 Enter 不提交（两下都没被 preventDefault 掉、编辑态还在）',
        imeProbe !== null && !imeProbe.barePrevented && !imeProbe.composingPrevented && imeProbe.stillEditing,
        JSON.stringify(imeProbe),
      )
      check.eq('④ IME 组合期间没有发出任何改名请求', renameCalls.length, 0)

      // ---- ③ Enter 提交 → 既有改名通路 + 标题更新 ----
      const newTitle = `实验室改名-${Date.now().toString(36)}`
      await page.focus(inputSel)
      await page.fill(inputSel, newTitle)
      await page.keyboard.press('Enter')
      await page.waitForTimeout(800)
      check.eq(
        '③ Enter 提交：恰好一条 session/rename，会话 id 是这一行（官方 sessions.binding(id).session.rename 那条通路）',
        renameCalls.map((call) => call.sessionId),
        [otherId],
      )
      check.eq('③ 请求里带的标题就是输入框里的新标题', renameCalls[0]?.title, newTitle)
      const committed = await rowRenameFacts(page, otherId)
      check.ok('③ 提交后退出编辑态（输入框收起、行回到标题渲染）', !committed.hasInput && !committed.renaming)
      check.eq('③ 标题更新：回执里的标题落到这一行（行上的标题换成新标题）', committed.title, newTitle)
      screenshots.push(await shot(ctx, page, 'rowrename-03-committed'))
      const callsAfterCommit = renameCalls.length

      // ---- ④ Esc 取消 / 失焦取消：都不发请求 ----
      await page.click(rowSel)
      await page.waitForTimeout(300)
      await page.fill(inputSel, 'lab-esc-丢弃')
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
      const afterEsc = await rowRenameFacts(page, otherId)
      check.ok('④ Esc 取消：退出编辑态', !afterEsc.hasInput && !afterEsc.renaming)
      check.eq('④ Esc 取消：标题没变（还是提交后的那个）', afterEsc.title, newTitle)
      check.eq('④ Esc 取消：零请求', renameCalls.length, callsAfterCommit)

      await page.click(rowSel)
      await page.waitForTimeout(300)
      await page.fill(inputSel, 'lab-blur-丢弃')
      // #132：搜索栏默认是收起态的放大镜，点它会展开并把焦点交给搜索输入框——改名输入框
      // 因此失焦（本条要验的就是「点到别的地方就放弃改名」）。
      await page.click('[data-dshone-tree-action="search"]')
      await page.waitForTimeout(400)
      const afterBlur = await rowRenameFacts(page, otherId)
      check.ok('④ 失焦（点到顶栏搜索）取消：退出编辑态', !afterBlur.hasInput && !afterBlur.renaming)
      check.eq('④ 失焦取消：标题没变', afterBlur.title, newTitle)
      check.eq('④ 失焦取消：零请求', renameCalls.length, callsAfterCommit)
      // 把搜索收回折叠态，后面的步骤不该带着一个展开的搜索框跑。
      await page.keyboard.press('Escape')
      await page.waitForTimeout(250)

      // ---- ⑤ 空串 / 未改动 → 不发请求 ----
      // 未改动：进编辑态后直接 Enter（草稿还是原标题）。
      await page.click(rowSel)
      await page.waitForTimeout(300)
      await page.keyboard.press('Enter')
      await page.waitForTimeout(300)
      check.ok('⑤ 未改动 + Enter：直接退出编辑态', !(await rowRenameFacts(page, otherId)).renaming)
      check.eq('⑤ 未改动 + Enter：零请求', renameCalls.length, callsAfterCommit)

      // 空串：清空输入框再 Enter。
      await page.click(rowSel)
      await page.waitForTimeout(300)
      await page.fill(inputSel, '')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(300)
      check.ok('⑤ 空串 + Enter：直接退出编辑态', !(await rowRenameFacts(page, otherId)).renaming)
      check.eq('⑤ 空串 + Enter：零请求', renameCalls.length, callsAfterCommit)

      // 全空白：与空串同一条判据（提交前 trim）。
      await page.click(rowSel)
      await page.waitForTimeout(300)
      await page.fill(inputSel, '   ')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(300)
      check.eq('⑤ 全空白 + Enter：零请求', renameCalls.length, callsAfterCommit)

      // ---- ④ 的两条边界：行尾收纳件与拖拽窗口里的点击都不触发改名 ----
      // 两次探测都在页内等一拍再读 DOM：行内编辑态是 React 状态，点完同步读会读早（还没重渲染）。
      const boundaries = await page.evaluate(async (selector: string) => {
        const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 150))
        const hasInput = (): boolean => document.querySelector('[data-dshone-tree-rename="input"]') !== null
        const row = document.querySelector(selector) as HTMLElement | null
        if (row === null) return null
        // ① 行尾状态点（会话状态那一格）不是「点行」：点在它上面不该把编辑态点出来。
        //（行尾相对时间在 hover 时隐藏——悬停给四枚动作让位——所以这里点的是状态点。）
        const slot = row.querySelector('.dshOneTree_slot')
        if (slot === null) return null
        ;(slot as HTMLElement).click()
        await tick()
        const statusTap = hasInput()
        // ② 拖拽窗口里到达的点击不触发改名（HTML5 拖拽的收尾在部分浏览器/驱动上会补一个
        // click）；dragend 之后正常的点击照旧进编辑态。
        row.dispatchEvent(new DragEvent('dragstart', { bubbles: true }))
        row.click()
        await tick()
        const duringDrag = hasInput()
        row.dispatchEvent(new DragEvent('dragend', { bubbles: true }))
        row.click()
        await tick()
        const afterDrag = hasInput()
        return { statusTap, duringDrag, afterDrag }
      }, rowSel)
      check.fact(`④ 边界探测（点状态点 / 拖拽中点击 / 拖拽后点击）=${JSON.stringify(boundaries)}`)
      check.ok(
        '④ 点行尾状态点（当前会话行）不触发就地改名',
        boundaries !== null && !boundaries.statusTap,
        JSON.stringify(boundaries),
      )
      check.ok(
        '④ 拖拽期间到达的点击不触发改名；dragend 之后正常的点击照旧进编辑态',
        boundaries !== null && !boundaries.duringDrag && boundaries.afterDrag,
        JSON.stringify(boundaries),
      )
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
      check.eq('④ 边界探测没留下编辑态、也没多发包', [
        (await rowRenameFacts(page, otherId)).renaming,
        renameCalls.length,
      ], [false, callsAfterCommit])

      // ---- ⑥ 多选态下点击 = 勾选（当前行也一样，不进改名）----
      await page.click('[data-dshone-tree-action="select-mode"]')
      await page.waitForTimeout(300)
      const eligible = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-dshone-tree-row="session"]'))
          .filter((row) => row.getAttribute('data-dshone-tree-check') === 'eligible')
          .map((row) => row.getAttribute('data-dshone-tree-session') ?? '')
          .filter((id) => id !== ''),
      )
      check.fact(`多选态下可勾选的会话行：${JSON.stringify(eligible.slice(0, 5))}（共 ${String(eligible.length)} 条）`)
      await page.click(rowSel)
      await page.waitForTimeout(300)
      const selectedCurrent = await page.evaluate(() => ({
        inputs: document.querySelectorAll('[data-dshone-tree-rename="input"]').length,
        checked: Array.from(document.querySelectorAll('[data-dshone-tree-checked="true"]')).map(
          (row) => row.getAttribute('data-dshone-tree-session') ?? '',
        ),
      }))
      check.eq('⑥ 多选态下点「当前会话行」：没有出现行内改名输入框（不进改名）', selectedCurrent.inputs, 0)
      check.eq(
        '⑥ 多选态下点行 = 勾选（只有这一行被勾上）',
        selectedCurrent.checked,
        eligible.includes(otherId) ? [otherId] : [],
      )
      await page.click(rowSel)
      await page.waitForTimeout(300)
      check.eq(
        '⑥ 再点一下取消勾选（点多选态下的行是勾选语义，不是改名）',
        await contentCount(page, '[data-dshone-tree-checked="true"]'),
        0,
      )
      await page.click('[data-dshone-tree-action="select-mode"]')
      await page.waitForTimeout(300)
      check.eq('⑥ 退出多选态后行内也没有输入框（整段没进过改名）', await contentCount(page, '[data-dshone-tree-rename="input"]'), 0)

      // ---- ⑦ 重绘（行被摘掉重挂）后输入框的焦点与选区保持 ----
      await page.click(rowSel)
      await page.waitForTimeout(300)
      const draft = `${newTitle} 续写`
      const placed = await page.evaluate(
        ({ id, next }: { id: string; next: string }) => {
          const input = document.querySelector(`[data-dshone-tree-session="${id}"] [data-dshone-tree-rename="input"]`)
          const field = input as HTMLInputElement | null
          if (field === null) return null
          field.focus()
          field.value = next
          field.dispatchEvent(new Event('input', { bubbles: true }))
          // 造一个「只选后半段」的选区，并让树层记下它（真拖选同样会发 select）。
          field.setSelectionRange(2, next.length)
          field.dispatchEvent(new Event('select', { bubbles: true }))
          ;(globalThis as { __LAB_EDIT_INPUT__?: HTMLInputElement }).__LAB_EDIT_INPUT__ = field
          return { sel: [field.selectionStart, field.selectionEnd] }
        },
        { id: otherId, next: draft },
      )
      check.ok(
        '⑦ 前置：编辑态里造好一个「2..N」的选区',
        placed !== null && placed.sel[0] === 2 && placed.sel[1] === draft.length,
        JSON.stringify(placed),
      )
      // 触发整棵树的 DOM 重挂：**折叠全部 → 展开全部**（收起时每个工作区的会话行都被摘掉，
      // 展开时再挂回来），走的是「节点被摘掉重挂」这条最硬的路。**用合成点击**
      // （`element.click()`）而不是真实鼠标点击——真实点击会先把输入框 blur 掉，那是
      // 「失焦取消」那条正在验的语义，不是这里要造的现场。
      //
      // #131 起这里不再靠「切到单列表再切回来」造重绘：侧栏没有可切的分组方式了，
      // 而折叠/展开全部既在、又是更彻底的一次重挂（行不是被换掉，是先离场再回来）。
      const clickCollapseAll = async (): Promise<void> => {
        await page.evaluate(() => {
          ;(document.querySelector('[data-dshone-tree-action="collapse-all"]') as HTMLElement | null)?.click()
        })
        await page.waitForTimeout(600)
      }
      await clickCollapseAll()
      const collapsed = await rowRenameFacts(page, otherId)
      check.ok(
        '⑦ 前置：折叠全部之后这一行连同输入框真的从 DOM 上摘掉了（最硬的一种重绘）',
        !collapsed.exists && (await contentCount(page, '[data-dshone-tree-rename="input"]')) === 0,
        JSON.stringify(collapsed),
      )
      await clickCollapseAll()
      const afterRepaint = await rowRenameFacts(page, otherId)
      const replaced = await page.evaluate(() => {
        const previous = (globalThis as { __LAB_EDIT_INPUT__?: Element }).__LAB_EDIT_INPUT__
        const now = document.querySelector('[data-dshone-tree-rename="input"]')
        return now !== null && now !== previous
      })
      check.fact(`⑦ 这次重绘把输入框节点换掉了没有：${String(replaced)}（换掉 = 走的是「节点被摘掉重挂」这条最硬的路）`)
      check.ok('⑦ 行重挂回来之后输入框还在（编辑态没跟着重绘丢）', afterRepaint.hasInput && afterRepaint.renaming)
      check.ok('⑦ 重绘后焦点仍在输入框上', afterRepaint.focused)
      check.eq('⑦ 重绘后选区保持（2..N）', [afterRepaint.selStart, afterRepaint.selEnd], [2, draft.length])
      check.eq('⑦ 重绘后草稿保持', afterRepaint.value, draft)
      screenshots.push(await shot(ctx, page, 'rowrename-04-after-repaint'))
      // 再来一轮折叠/展开，核一遍同三项（第二次重挂，编辑态同样不该丢）。
      await clickCollapseAll()
      await clickCollapseAll()
      const afterSecond = await rowRenameFacts(page, otherId)
      check.ok('⑦ 第二次重挂后焦点与编辑器仍然在场', afterSecond.focused && afterSecond.hasInput)
      check.eq('⑦ 第二次重挂后选区与草稿同样没丢', [afterSecond.selStart, afterSecond.selEnd, afterSecond.value], [
        2,
        draft.length,
        draft,
      ])
      check.eq('⑦ 两次重绘都没有触发提交（零新增 session/rename）', renameCalls.length, callsAfterCommit)
      // 收尾：Esc 退出编辑态（不留半开的输入框给后面的断言看）。
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
      check.eq('⑦ 收尾：Esc 之后编辑态收掉、仍然零新增请求', [
        (await rowRenameFacts(page, otherId)).renaming,
        renameCalls.length,
      ], [false, callsAfterCommit])

      check.eq('行内改名套件全程零 pageerror', withoutKnownNoise(opened.capture.pageErrors).real, [])
    } finally {
      await opened.context.close()
    }
    return screenshots
  },
}

export const SUITES: ReadonlyArray<LabSuite> = [
  CONTRACT_SUITE,
  SMOKE_SUITE,
  INTERACT_SUITE,
  PARITY_SUITE,
  BRIDGE_SUITE,
  PORTABLE_SUITE,
  SIDEBAR_SUITE,
  HEADER_UTILITIES_SUITE,
  MULTIOPEN_SUITE,
  // #91 漂移断言（独立文件，见 driftSuites.ts 文件头的分工说明）。追加在末尾，
  // 避免与本批其它新套件（F-07/F-08/F-09）争同一个热点区。
  FIBER_SUITE,
  WIRE_LIVENESS_SUITE,
  // #99 侧栏骨架（F-12：F-10/F-11 已被 #91 的漂移断言占用）。
  SKELETON_SUITE,
  // #104 密度档扩散（F-13）。
  DENSITY_SPREAD_SUITE,
  // #102 置顶与手动未读（F-14：F-13 已被 #104 的密度套件占用）。
  PIN_UNREAD_SUITE,
  // #103 回收站两层语义（F-15：F-13/F-14 已被 #104/#102 占用）。
  RECYCLE_TWO_LAYER_SUITE,
  // #107 会话标签组（F-16）。
  TAG_GROUPS_SUITE,
  // #108 侧栏多选与批量（F-17：F-16 已被 #107 的标签组套件占用）。
  MULTI_SELECT_SUITE,
  // #110 空态、加载态与失败可见（F-18：F-16 已被 #107 的标签组套件、F-17 已被 #108 的多选套件占用）。
  SIDEBAR_EMPTY_FEEDBACK_SUITE,
  // #109 侧栏菜单补全（F-19：F-01…F-18 与 R-06 已被占用）。
  SIDEBAR_MENUS_SUITE,
  // #114 回收站入口行的图标与开合（F-20：F-01…F-19 与 R-06 已被占用）。
  // 独立文件，见 recycleEntrySuites.ts 文件头的理由。
  RECYCLE_ENTRY_TOGGLE_SUITE,
  // #112 当前工作区按 VS Code 打开的文件夹判定（F-21：#114 已占用 F-20）。
  CURRENT_WORKSPACE_FOLDER_SUITE,
  // #115 会话行点击逻辑与行内改名（F-22：F-20 已被 #114 的回收站入口套件、F-21 已被 #112 的当前工作区套件占用）。
  SESSION_ROW_RENAME_SUITE,
  // #113 侧栏风格档位表（F-23：F-20/F-21/F-22 已被 #114/#112/#115 占用；套件本体在
  // scaleSuites.ts，与 driftSuites.ts 同为独立文件，少一处合入热点）。
  SCALE_SUITE,
  // #117 回收站抽屉收起也有动效（F-24：F-23 已被 #113 的档位表套件占用）。
  // 独立文件，见 recycleDrawerSuites.ts 文件头的理由。
  RECYCLE_DRAWER_COLLAPSE_SUITE,
  // #118 顶栏折叠/展开全部的方框加减号图标（F-25：F-20…F-23 已被 #114/#112/#115/#113
  // 占用，F-24 归 #117 的抽屉收起动效；套件本体在 collapseAllIconSuites.ts，同为独立文件）。
  COLLAPSE_ALL_ICON_SUITE,
  // #122 标签组竖线与组内缩进回到旧侧栏规格（F-27：F-24 归 #117 的抽屉收起动效、
  // F-25 归 #118 的折叠全部图标、F-26 归 #119 的顶栏纵向节奏；
  // 套件本体在 tagRailSuites.ts，同为独立文件，少一处合入热点）。
  TAG_GROUP_RAIL_SUITE,
  // #119 顶栏 / 分组过滤条一带的纵向留白（F-26：#117 归 F-24、#118 已占 F-25——两边并行
  // 开发撞了号，按「从未占用的继续」顺延；套件本体在 topbarRhythmSuites.ts，同为独立文件）。
  TOPBAR_RHYTHM_SUITE,
  // #121 会话行点击的「宿主真的开着它吗」（F-28：F-26 归 #119、F-27 归 #122；
  // 套件本体在 renameOpenSyncSuites.ts，同为独立文件）。
  RENAME_OPEN_SYNC_SUITE,
  // #120 选择态动作条的布局与观感（F-29：F-24…F-28 已被 #117/#118/#119/#122/#121 占用；套件本体在
  // selectionBarSuites.ts，同上为独立文件）。
  SELECTION_BAR_SUITE,
  // #123 侧栏标题文字回到官方标题档（F-30：F-24…F-29 已被 #117/#118/#119/#122/#121/#120 占用；
  // 套件本体在 scaleSuites.ts，与 F-23 同一份档位表口径）。
  TITLE_TIER_SUITE,
  // #124 进入多选后会话与工作区的缩进关系（F-31：F-30 已被 #123 的标题字号套件占用；套件本体在
  // selectModeIndentSuites.ts，同上为独立文件）。
  SELECT_MODE_INDENT_SUITE,
  // #126 二级菜单的缩进（F-32：F-30 归 #123、F-31 归 #124；套件本体在 submenuIndentSuites.ts，
  // 同为独立文件，少一处合入热点）。
  SUBMENU_INDENT_SUITE,
  // #127 弹窗的紧凑档（F-34：F-30 归 #123 的标题档、F-31 归 #124 的多选缩进、F-32 归 #126 的
  // 二级菜单缩进，按「从未占用的继续」取 F-34——F-33 归 #131 的视图选项退役，#125 的顶栏套件
  // 合入时顺延到 F-35；
  // 套件本体在 modalCompactSuites.ts，同上为独立文件）。
  MODAL_COMPACT_SUITE,
  // #131 视图选项退役（F-33：F-01…F-32 与 R-06 已被占用，F-34 归 #127 的弹窗紧凑档；
  // 套件本体在 viewOptionsSuites.ts，
  // 同为独立文件，少一处合入热点）。
  VIEW_OPTIONS_RETIRED_SUITE,
  // #125 顶栏 / 过滤条的横向基准（F-35：F-30…F-34 已被 #123/#124/#126/#131/#127 占走，
  // 按「从未占用的继续」顺延；
  // 套件本体在 topbarInlineSuites.ts，同上为独立文件，少一处合入热点）。
  TOPBAR_INLINE_SUITE,
  // #132 顶栏搜索栏改回收起 / 展开两态（F-36：F-30…F-35 已被 #123/#124/#126/#131/#127/#125 占走，
  // 按「从未占用的继续」顺延；套件本体在 searchCollapseSuites.ts，同为独立文件，少一处合入热点）。
  SEARCH_COLLAPSE_SUITE,
  // #134 行家族取官方标准档（F-37：F-33 归 #131、F-34 归 #127、F-35 归 #125、F-36 归 #132，
  // 按「从未占用的继续」顺延；套件本体在 rowTierSuites.ts，同为独立文件）。
  ROW_TIER_SUITE,
  // #137 回收站入口行的几何（F-38：F-33 归 #131、F-34 归 #127、F-35 归 #125、F-36 归 #132、
  // F-37 归 #134，按「从未占用的继续」顺延；套件本体在 recycleEntryAlignSuites.ts，
  // 同为独立文件，少一处合入热点）。
  RECYCLE_ENTRY_ALIGN_SUITE,
  // #138 工作区行的活状态计数跟着标题文字走 + vscode 胶囊收紧一档（F-39：F-01…F-38 与 R-06
  // 已被占用，按「从未占用的继续」取当时最小的未占用号；套件本体在 rowActivitySuites.ts，
  // 同为独立文件，少一处合入热点）。
  ROW_ACTIVITY_SUITE,
  // #141 折叠/展开全部那枚图标的视觉重量（F-40：F-01…F-39 与 R-06 已占，
  // 按「从未占用的继续」取当时最小的未占用号；套件本体在 collapseAllIconWeightSuites.ts，
  // 同为独立文件，少一处合入热点）。
  COLLAPSE_ALL_ICON_WEIGHT_SUITE,
  // #139 管理分组里的成员清单（F-41：F-01…F-40 与 R-06 已占，按「从未占用的继续」顺延；
  // 套件本体在 groupMembersSuites.ts，同为独立文件，少一处合入热点）。
  GROUP_MEMBERS_SUITE,
  // #135 顶栏合并成一行（F-42：F-01…F-41 与 R-06 已占，按「从未占用的继续」顺延；
  // 套件本体在 toolbarSingleRowSuites.ts，同为独立文件，少一处合入热点）。
  TOOLBAR_SINGLE_ROW_SUITE,
  // #140 会话等待态的状态点（F-43：F-01…F-42 与 R-06 已占，按「从未占用的继续」顺延；
  // 套件本体在 pendingDotSuites.ts，同上为独立文件，少一处合入热点）。
  PENDING_DOT_SUITE,
  // #142 顶栏那一行右侧收进一档（F-44：F-01…F-43 与 R-06 已占，按「从未占用的继续」
  // 取当时最小的未占用号；套件本体在 topbarRightInsetSuites.ts，同为独立文件，
  // 少一处合入热点）。
  TOPBAR_RIGHT_INSET_SUITE,
  // #146 会话行状态点逐案审计（F-46：F-44 归 #142、F-45 归 #144，按「从未占用的继续」顺延；
  // 套件本体在 statusDotSuites.ts，同上为独立文件，少一处合入热点）。
  STATUS_DOT_SUITE,
  // #144 回收站抽屉的块头与行尾动作（F-45：F-01…F-44 与 R-06 已占，F-46 归 #146，
  // 按「从未占用的继续」顺延；套件本体在 recycleDrawerRowSuites.ts，同为独立文件）。
  RECYCLE_DRAWER_ROW_SUITE,
  // #145 会话被另一个 dsh 进程占着写句柄时的可见提示（F-47：F-44 归 #142、F-45 归 #144、
  // F-46 归 #146，按「从未占用的继续」顺延；套件本体在 sessionOwnedSuites.ts，同为独立文件）。
  SESSION_OWNED_SUITE,
  // #150 外链锚点的捕获阶段兜底（F-48：F-01…F-47 与 R-06 已占，
  // 按「从未占用的继续」顺延；套件本体在 externalLinkSuites.ts，同为独立文件）。
  EXTERNAL_LINK_SUITE,
  // #152 搜索命中高亮（F-49：F-01…F-48 与 R-06 已占，按「从未占用的继续」取当时最小的
  // 未占用号；套件本体在 searchHitHighlightSuites.ts，同为独立文件，少一处合入热点）。
  SEARCH_HIT_HIGHLIGHT_SUITE,
  // #155 拖拽补齐：管理框里拖组行换序 + 拖动中的源行半透明（F-50：F-01…F-48 与 R-06 已占，
  // F-49 归并行开发中的 #153（`unreadCountSuites.ts`），按「从未占用的继续」取 F-50；
  // 套件本体在 dragParitySuites.ts，同为独立文件）。
  DRAG_PARITY_SUITE,
  // #151 展开态的默认值与空工作区（F-51：F-49 归 #152、F-50 归 #155，
  // 按「从未占用的继续」顺延；套件本体在 expandDefaultsSuites.ts，同为独立文件）。
  EXPAND_DEFAULTS_SUITE,
  // #153 工作区行尾角标补回「未读」一项（F-52：F-49 归 #152、F-50 归 #155、F-51 归 #151，
  // 按「从未占用的继续」顺延；套件本体在 unreadCountSuites.ts，同为独立文件）。
  UNREAD_COUNT_SUITE,
  // #156 交互活性探针（F-54：F-49…#158 前占、F-53 归 #154，按「从未占用的继续」顺延；
  // 套件本体在 livenessSuites.ts，同为独立文件，少一处合入热点）。
  LIVENESS_SUITE,
  // #154 回收站抽屉补齐（F-53：F-49…#152、F-50 #155、F-51 #151、F-52 #153、F-54 #156 已占，
  // 按「从未占用的继续」顺延；套件本体在 recycleDrawerCompleteSuites.ts，同为独立文件）。
  RECYCLE_DRAWER_COMPLETE_SUITE,
  // #164 全新 DSH_HOME 上的 boot（F-55：F-01…F-54 与 R-06 已占，按「从未占用的继续」
  // 顺延；套件本体在 freshProfileSuites.ts，同为独立文件，少一处合入热点。
  // 它自己起一台临时 DSH_HOME 的网关，见那个文件头。
  FRESH_PROFILE_BOOT_SUITE,
  // #130 侧栏树容器不可横滚（F-56：F-01…F-55 与 R-06 已占，按「从未占用的继续」顺延；
  // 套件本体在 sidebarHScrollSuites.ts，同为独立文件，少一处合入热点）。
  SIDEBAR_NO_HSCROLL_SUITE,
  // #173 combo 缓存键带本地产物版本（F-57：F-01…F-56 与 R-06 已占，按「从未占用的继续」
  // 顺延；套件本体在 comboCacheKeySuites.ts，同为独立文件，少一处合入热点）。
  COMBO_CACHE_KEY_SUITE,
]
