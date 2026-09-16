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
import type { Browser } from 'playwright'
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
  type OpenedPage,
} from './harness.ts'
import { LAB_TREES, type LabServer, type LabTreeRoute } from './labServer.ts'
import { FIBER_SUITE, WIRE_LIVENESS_SUITE } from './driftSuites.ts'
import { listSessions } from '../../src/server/dshRpc.ts'

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
 * `'none'` = 不比矩形（宽度由两边的工具栏条目数决定，不是外观契约）。
 */
const PARITY_PAIRS: ReadonlyArray<{ suffix: string; props: readonly string[]; geometry?: 'width' | 'none' }> = [
  { suffix: 'sectionHeader', props: ['height', 'borderRadius', 'paddingLeft', 'marginTop', 'marginBottom', 'marginRight'] },
  // 搜索栏（#99）：自有树常驻官方那套 UI 的**展开态**（30px 高、10px 圆角、.5px 边框），
  // 官方对照档默认折叠（28px 圆胶囊），所以套件先把官方那份点开（见下面 run 里的说明），
  // 两侧同处展开态后逐项比样式。**矩形高度**可比（30px 对 30px），**宽度不可比**：
  // 自有树顶栏比官方多三枚图标（折叠展开全部 / 添加工作区 / 设置齿轮，另保留 #81 的
  // 视图选项与多选入口），搜索栏分到的可用宽度本来就不同——那是功能带来的差异。
  { suffix: 'search', props: ['height', 'borderRadius'], geometry: 'none' },
  { suffix: 'searchButton', props: ['width', 'height', 'borderRadius'] },
  { suffix: 'iconButton', props: ['width', 'height', 'borderRadius'] },
  { suffix: 'projectRow', props: ['height', 'paddingLeft', 'paddingRight', 'gap', 'borderRadius'] },
  { suffix: 'sessionRow', props: ['height', 'paddingLeft', 'paddingRight', 'gap', 'borderRadius'] },
  { suffix: 'title', props: ['fontSize', 'lineHeight', 'marginLeft', 'marginRight', 'marginTop', 'marginBottom'] },
  { suffix: 'time', props: ['fontSize', 'lineHeight'] },
  { suffix: 'slot', props: ['width', 'height'] },
  // 列表容器只比宽度：自有树在它上面多了一条分组过滤条（#81 功能 1），容器因此
  // 矮一行——那是**功能带来的**差异，不是外观偏差；宽度、内边距、滚动条槽这些
  // 样式契约仍逐项比对。
  { suffix: 'list', props: ['paddingBottom', 'paddingLeft', 'marginLeft', 'marginRight', 'scrollbarGutter'], geometry: 'width' },
]

interface ParitySample {
  found: boolean
  styles: Record<string, string>
  rect: { width: number; height: number }
}

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
      if (element === null) return { found: false, styles: {}, rect: { width: 0, height: 0 } }
      const computed = getComputedStyle(element)
      const styles: Record<string, string> = {}
      for (const prop of styleProps) styles[prop] = computed.getPropertyValue(prop)
      const rect = element.getBoundingClientRect()
      return { found: true, styles, rect: { width: Math.round(rect.width * 2) / 2, height: Math.round(rect.height * 2) / 2 } }
    },
    { suffix, props },
  )
}

export const PARITY_SUITE: LabSuite = {
  id: 'F-04',
  phase: 'new-feature',
  name: '侧栏树外观与几何对齐官方（PARITY 套件，260/340/500 三档宽度）',
  expect:
    '同一 frame、同一网关数据、同一宽度下，自有树的原生元素与官方浏览区同名元素（按类名后缀配对）的 computed style（分节头、搜索胶囊、图标按钮、分组行、会话行、标题、时间、图标位、列表容器）与几何矩形逐项相等；数值不硬编码——官方改版两边跟着变，不相等才报。两组例外都写明了理由：**列表容器只比宽度**（自有树多一条分组过滤条，容器矮一行是功能带来的），**两侧都没产生某元素时该组跳过**（例如当前会话是空白会话时没有相对时间可量；一侧有另一侧没有仍判失败）。**密度档（#85）的处置**：密度是有意的差异（VS Code 档比官方档紧），所以对齐断言先把自有页的密度变量按它自己声明的官方兜底值对齐（「没人给偏好时 = 官方档」正是这套变量承诺的语义），并同时钉住「VS Code 档真的更紧」与「对齐后 = 官方基准」两条。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const own = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { width: 380, height: 900 })
    const official = await openTreePage(ctx.browser, ctx.lab, route('sidebar-official'), { width: 380, height: 900 })
    try {
      // #99：自有树的搜索栏常驻**展开态**（折叠态的放大镜胶囊退役），官方对照档默认
      // 是折叠态——两侧要逐项可比，先把官方页的搜索点开：官方那套 UI 的展开态与自有树
      // 是同一份几何（30px 高、10px 圆角、放大镜按钮在展开态高 30px）。这一步只切官方
      // 页的呈现状态，不碰任何数据。
      await official.page.click('[class*="_searchButton"]')
      await official.page.waitForTimeout(200)
      check.fact(
        `对齐口径：自有树（.dshOneTree_*）对官方对照档（官方 hash 类名，按类名后缀配对），逐组比 computed style 各属性 + 几何矩形；共 ${String(PARITY_PAIRS.length)} 组元素 × 3 档宽度（260/340/500）`,
      )
      await own.page.setViewportSize({ width: 340, height: 900 })
      await official.page.setViewportSize({ width: 340, height: 900 })
      await own.page.waitForTimeout(300)
      await official.page.waitForTimeout(300)

      // ---- 密度档：先量 VS Code 档（现况），再把它对齐到官方兜底值 ----
      const vscodeDensity = await samplePair(own.page, 'projectRow', ['height'])
      const officialDensity = await samplePair(official.page, 'projectRow', ['height'])
      check.ok(
        '#85 密度档：VS Code 侧的分组行比官方档紧（同一个 frame 上真的下发了密度变量）',
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
      // #104 起键面从 17 项扩到 25 项（顶栏 / 分组过滤条 / 回收站入口行 / 抽屉），
      // 这里只守量级（精确键集与逐项官方原值由外壳契约套件的两条测试在源码层守）。
      check.ok(
        '密度档变量组 ≥ 20 项（#104 起 25 项；与契约测试同口径）',
        densityFix.applied >= 20,
        `applied=${String(densityFix.applied)}`,
      )
      await own.page.waitForTimeout(200)
      const alignedDensity = await samplePair(own.page, 'projectRow', ['height'])
      check.eq(
        '密度档：把变量对齐到官方兜底值后，自有树与官方基准逐项一致（官方档是无人给偏好时的兜底）',
        alignedDensity.styles.height,
        officialDensity.styles.height,
      )

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
              : a.rect.width === b.rect.width && a.rect.height === b.rect.height,
            pair.geometry === 'width'
              ? `own=${{ w: a.rect.width, h: a.rect.height }} official=${{ w: b.rect.width, h: b.rect.height }}（本组只比宽度）`
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
    '侧栏树（真实网关只读 + 假宿主）：**旧版 groups.json 的形状注进宿主状态存储就是可用数据**（分组 chip 按它渲染，过滤只留归属该分组的工作区）；分组由界面新建后按同一形状写回宿主状态存储（version 1、membership 在、旧字段 activeGroupId 不被抹掉）。**计数与行同源**：每个工作区行尾的「运行中/等待交互」角标数值 = 该工作区下会话行里 `data-dshone-tree-status` 的数（这同时证明工作区内会话没有被官方那 5 行截断，**不折叠**：不出现「显示更多」行，行数 = 该工作区的会话总数）。**回收站**：官方归档集合在抽屉里按工作区组织、每行有还原按钮；批量选择态出复选框与动作条，选中计数随点选变化，退出后动作条消失。**视图态**：当前过滤的分组写进官方惯例的 `dsh.workspaceTree.view`（localStorage），同上下文重载后仍然生效。全程零 pageerror（归档/还原**不被点击**——那会写真实网关）。',
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
          const statuses = Array.from(section.querySelectorAll('[data-dshone-tree-row="session"]')).map(
            (element) => element.getAttribute('data-dshone-tree-status') ?? '',
          )
          return {
            key,
            count: Number(row?.getAttribute('data-dshone-tree-count') ?? '-1'),
            badge,
            rows: statuses.length,
            running: statuses.filter((status) => status === 'running').length,
            waiting: statuses.filter((status) => status === 'waiting').length,
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
        if (section.badge === '') return section.running > 0 || section.waiting > 0
        const [running, waiting] = section.badge.split('/')
        return Number(running) !== section.running || Number(waiting) !== section.waiting
      })
      check.ok(
        '功能 2 计数：行尾角标（运行中/等待交互）= 该工作区会话行里的真实状态数',
        badgeMismatch.length === 0,
        badgeMismatch
          .map((section) => `${section.key.slice(0, 8)} badge=${section.badge} running=${String(section.running)} waiting=${String(section.waiting)}`)
          .join(' '),
      )
      screenshots.push(await shot(ctx, page, 'sidebar-activity-counts'))

      // ---- 功能 3/5：回收站抽屉（数据 = 官方归档集合；只读，不点还原） ----
      const recycleTotal = await page.getAttribute('[data-dshone-tree-action="recycle-open"]', 'data-dshone-tree-recycle-count')
      await page.click('[data-dshone-tree-action="recycle-open"]')
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
      await page.waitForTimeout(200)
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

      // 归属：工作区行的「…」菜单 → 勾一个分组 → 归属写回状态存储。
      // 行操作按钮平时是 display:none（悬停才出，官方同款），所以先 hover 行再点。
      const workspaceRow = page.locator('[data-dshone-tree-row="workspace"]').first()
      await workspaceRow.hover()
      await workspaceRow.locator('[data-dshone-tree-action="workspace-menu"]').click()
      await page.waitForTimeout(300)
      const menuText = await bodyText(page)
      check.ok('功能 1：工作区行菜单里有「所属分组」一节', created !== undefined && menuText.includes('Lab New'), menuText.slice(0, 160))
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

/** 假宿主记录的多开请求（`session.openInNewTab` 带过来的会话 id）。 */
async function sessionTabsOpened(page: OpenedPage['page']): Promise<string[]> {
  return page.evaluate(() => {
    const host = (globalThis as { __LAB_HOST__?: { sessionTabsOpened?: string[] } }).__LAB_HOST__
    return host?.sessionTabsOpened ?? []
  })
}

/**
 * 菜单现状：我们自己那一项（按自有标记属性取，不认官方哈希类名）与整份菜单
 * 的项文案（核对原有三项没被挤掉）。
 */
async function menuFacts(
  page: OpenedPage['page'],
): Promise<{ menus: number; item: string; allItems: string[]; anchored: { left: number; top: number } | null }> {
  return page.evaluate(() => {
    const lists = Array.from(document.querySelectorAll('[role="menu"]'))
    const last = lists[lists.length - 1]
    const marks = Array.from(document.querySelectorAll('[data-dshone-tree-item]'))
    const mark = marks[marks.length - 1]
    const rect = last?.getBoundingClientRect()
    return {
      menus: lists.length,
      item: mark?.textContent ?? '',
      allItems: last === undefined ? [] : Array.from(last.querySelectorAll('button[role="menuitem"]')).map((el) => el.textContent ?? ''),
      anchored: rect === undefined ? null : { left: Math.round(rect.left), top: Math.round(rect.top) },
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
    '侧栏树：会话行的 ⋯ 菜单里有「在新标签页打开」项（原有三项都在，每项都有文案），**行右键**弹出同一份菜单且菜单锚在指针处，Esc 关掉；点该项 → 页面经宿主能力口发出一次 `session.openInNewTab`，带的是**那一行**的真会话 id；点第二行得到第二个不同 id。chat 树：`?session=<id>` 的页面把该 id 注入 `__DSH_ONE_BOOT__` 并真的把它开成当前会话（boot-timing first-meta 等于该 id）；**同一个浏览器上下文（同一源、同一 localStorage，即真 VS Code 里多条 webview 的现场）里开第二个多开会话页**，两页各自开自己的会话、互不串；注入一个不存在的 id 时防闪帧遮罩在场（不闪官方空白态）。',
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
      // 只有非空白会话行才带行菜单（官方 SessionNodeItem：`!row.blank && (...)` 才渲染
      // 时间与行操作），多开入口同理——所以可点的行按「带行操作的会话行」挑。
      const rows = sidebar.page.locator('.dshOneTree_sessionRow').filter({ has: sidebar.page.locator('.dshOneTree_rowActions') })
      // 树默认只展开当前会话所在分组，其余分组收起、里面一条会话行都不渲染 —— 先展开
      // 几个分组，凑出 ≥2 条带行菜单的会话行（点分组头只是本地展开，不写网关）。
      const groupRows = sidebar.page.locator('.dshOneTree_projectRow')
      const groupCount = await groupRows.count()
      for (let index = 0; index < groupCount && (await rows.count()) < 2; index += 1) {
        const overflow = sidebar.page.locator('.dshOneTree_sessionOverflowButton')
        if ((await overflow.count()) > 0) {
          await overflow.first().click()
          await sidebar.page.waitForTimeout(200)
          continue
        }
        await groupRows.nth(index).click()
        await sidebar.page.waitForTimeout(250)
      }
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
        await row1.click({ button: 'right', position: at })
        await sidebar.page.waitForTimeout(300)
        const contextMenu = await menuFacts(sidebar.page)
        const expected = { left: Math.round(box.x) + at.x, top: Math.round(box.y) + at.y + 4 }
        check.fact(`行右键菜单：${JSON.stringify(contextMenu)} 期望锚点约 ${JSON.stringify(expected)}`)
        check.ok('行右键弹出同一份菜单（带多开项）', contextMenu.menus === 1 && contextMenu.item.trim() !== '', JSON.stringify(contextMenu))
        check.ok(
          '右键菜单锚在指针处（官方 Menu 的 getAnchorRect）',
          contextMenu.anchored !== null &&
            Math.abs(contextMenu.anchored.left - expected.left) <= 3 &&
            Math.abs(contextMenu.anchored.top - expected.top) <= 3,
          `anchored=${JSON.stringify(contextMenu.anchored)} expected=${JSON.stringify(expected)}`,
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
 * 侧栏骨架（#99 B 段）的四区断言：自绘顶栏（官方搜索栏展开态 + 折叠展开全部 +
 * 添加工作区两项菜单 + 设置齿轮）、单胶囊分组条、底部回收站入口行（官方
 * `sidebar.footer.action` 座位，与官方 cordis-panel 并存）、底部设置行隐藏。
 *
 * 数据面仍旧是真实网关只读 + 假宿主；分组状态注入到假宿主的状态存储里（与 F-07 同
 * 一套做法），这样单胶囊的下拉与管理对话框有确定的内容可断言。
 */
export const SKELETON_SUITE: LabSuite = {
  id: 'F-12',
  phase: 'new-feature',
  name: '侧栏骨架四区（#99）：顶栏四项 + 官方搜索栏 + 单胶囊分组条 + 底部回收站入口行（SIDEBAR-SKELETON 套件）',
  expect:
    '#99 定的四区骨架在真实装配页上成立：① 顶栏一行里搜索栏（官方那套 UI 的展开态，30px 高 / 10px 圆角）、折叠展开全部、添加工作区、设置齿轮四件都在，且折叠全部真的收起整棵树；② 添加工作区是两项菜单（选已有文件夹 / 创建新工作区目录），第二项经宿主能力口发出 `vscode.workspaceCreate`；③ 设置齿轮经宿主能力口发出 `vscode.openSettings`（假宿主只记录，真宿主开设置页），同时官方 `sidebar.settings` 那一行不再渲染；④ 分组过滤条是单胶囊 + 成员计数 + ▾，下拉含「全部工作区 / 各组 / 新建分组… / 管理分组…」，管理分组对话框列出全部组；⑤ 回收站入口行在官方 `sidebar.footer.action` 座位里、与官方 cordis-panel 条目并存、不在自有浏览区 DOM 内，点它开现有抽屉。全程零 pageerror。',
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
      // 密度档先对齐到官方兜底值（与 F-04 同一处置）：VS Code 档比官方档紧，而「搜索
      // 栏是不是官方那套几何」要按官方档量——把树自己声明的官方兜底值内联回 frame，
      // 页面就回到「没人给偏好」的状态。
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
      const bar = await page.evaluate(() => {
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
          },
          search: {
            found: searchBox !== null && input !== null,
            height: searchStyle?.height ?? '',
            radius: searchStyle?.borderRadius ?? '',
            borderWidth: searchStyle?.borderTopWidth ?? '',
            borderStyle: searchStyle?.borderTopStyle ?? '',
            placeholder: input?.placeholder ?? '',
            opacity: inputStyle?.opacity ?? '',
            tabIndex: input?.tabIndex ?? -1,
            /** #99：折叠态的放大镜胶囊退役——页面上不该再有那一枚。 */
            retiredPill: document.querySelector('[data-dshone-tree="search-pill"]') !== null,
          },
        }
      })
      check.ok('顶栏一行在（自绘 .dshOneTree_sectionHeader）', bar !== null)
      check.fact(`顶栏四件：${JSON.stringify(bar?.actions)} 搜索=${JSON.stringify(bar?.search)}`)
      check.ok('顶栏：折叠/展开全部在', bar?.actions.collapseAll === true)
      check.ok('顶栏：添加工作区（＋）在', bar?.actions.addWorkspace === true)
      check.ok('顶栏：设置齿轮在', bar?.actions.settings === true)
      check.ok(
        '搜索栏 = 官方那套 UI 的展开态（30px 高 / 10px 圆角 / token 实线边框）',
        bar?.search.height === '30px' &&
          bar?.search.radius === '10px' &&
          bar?.search.borderStyle === 'solid' &&
          bar?.search.borderWidth !== '0px',
        JSON.stringify(bar?.search),
      )
      check.ok(
        '搜索框常显可输入（退役的折叠胶囊不在，输入框不再 tabIndex=-1）',
        bar?.search.opacity === '1' && bar.search.tabIndex === 0 && bar.search.retiredPill === false,
        JSON.stringify(bar?.search),
      )
      check.ok('搜索框用官方词典的占位文案', (bar?.search.placeholder ?? '').includes('搜索会话'), String(bar?.search.placeholder))

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
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)
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

      // ---- ④ 单胶囊分组条 ----
      const pill = await page.evaluate(() => {
        const anchor = document.querySelector('[data-dshone-tree-action="group-pill"]')
        return {
          found: anchor !== null,
          label: anchor?.textContent ?? '',
          count: anchor?.getAttribute('data-dshone-tree-group-count') ?? '',
          active: anchor?.getAttribute('data-dshone-tree-group') ?? '',
          chips: document.querySelectorAll('[data-dshone-tree-chip]').length,
        }
      })
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
      await page.click('[data-dshone-tree-action="recycle-open"]')
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
  { region: '回收站入口行', where: 'tree', selector: '[data-dshone-tree="recycle-entry"]', props: ['paddingLeft', 'paddingRight'] },
  { region: '回收站入口主区', where: 'tree', selector: '.dshOneTree_footerMain', props: ['height', 'paddingLeft', 'paddingRight'] },
  { region: '回收站入口动作按钮', where: 'tree', selector: '.dshOneTree_footerIconButton', props: ['width', 'height'] },
  { region: '抽屉头', where: 'drawer', selector: '.dshOneTree_drawerHeader', props: ['height', 'paddingLeft', 'paddingRight', 'columnGap'] },
  { region: '抽屉分块块头', where: 'drawer', selector: '.dshOneTree_drawerGroupLabel', props: ['height', 'paddingLeft', 'paddingRight'] },
  { region: '抽屉会话行', where: 'drawer', selector: '.dshOneTree_drawerRow', props: ['height', 'paddingLeft', 'paddingRight'] },
  { region: '抽屉列表', where: 'drawer', selector: '.dshOneTree_drawerList', props: ['paddingLeft', 'paddingRight', 'paddingBottom'] },
]

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
 * 判据只有一条、但要求严格：**四区的每一项几何，紧凑档都必须严格小于官方原值**——
 * 「兜底 = 官方」由外壳契约套件在源码层守（键集 + 兜底字面量），这里守的是「这套变量
 * 真的把这几块变紧了」，而不是只在列表行上生效。
 */
export const DENSITY_SPREAD_SUITE: LabSuite = {
  id: 'F-13',
  phase: 'new-feature',
  name: '侧栏密度档扩散（#104）：顶栏 / 分组过滤条 / 回收站入口行 / 抽屉在三档宽度下都更紧凑（DENSITY-SPREAD 套件）',
  expect:
    '同一页、同一数据、260/340/500 三档宽度下，把自有树的密度变量从宿主给的 VS Code 档切到它自己声明的官方兜底值（= 官方档），四区的几何逐一比较：顶栏行（高/左内边距/行内间隙）、顶栏图标按钮（宽高）、顶栏动作组间隙、分组过滤条（左内边距/间隙）、分组胶囊（高/字号/间隙/左右内边距）、回收站入口行（左右内边距）、入口主区（高/左右内边距）、入口动作按钮（宽高）、抽屉头（高/左右内边距/间隙）、抽屉分块块头（高/左右内边距）、抽屉会话行（高/左右内边距）、抽屉列表（左右内边距/底部留白）——**每一项紧凑档都严格小于官方原值**，且同一区域在三档宽度下的紧凑读数一致（密度是容器给的，不随宽度漂）。同时钉住「对齐到官方兜底值后读数确实变大」（说明这两组读数真的来自那套变量，不是量到了别的东西）。全程零 pageerror。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const widths = [260, 340, 500] as const
    const opened = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { width: 380, height: 900 })
    const { page } = opened
    try {
      const treeRegions = DENSITY_REGIONS.filter((spec) => spec.where === 'tree')
      const drawerRegions = DENSITY_REGIONS.filter((spec) => spec.where === 'drawer')
      check.fact(
        `量法：同一页两种密度状态（宿主给的 VS Code 档 vs 内联官方兜底值），三档宽度 ${widths.join('/')}。` +
          `抽屉关着量 ${treeRegions.map((spec) => spec.region).join('、')}；抽屉开着量 ${drawerRegions.map((spec) => spec.region).join('、')}`,
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
          `内联项数=${String(aligned)}（#104 起键面 25 项；精确键集由外壳契约套件守）`,
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
          const rows = spec.props.map((prop) => ({
            prop,
            compact: owner[prop] ?? Number.NaN,
            official: base[prop] ?? Number.NaN,
          }))
          const loose = rows.filter((row) => !(row.compact < row.official))
          check.ok(
            `w=${String(width)} ${spec.region}：每一项紧凑档都严格小于官方原值`,
            loose.length === 0,
            rows.map((row) => `${row.prop} ${String(row.compact)}<${String(row.official)}`).join(' '),
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
      await page.click('[data-dshone-tree-action="recycle-open"]')
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
          const rows = spec.props.map((prop) => ({ prop, compact: owner[prop] ?? Number.NaN, official: base[prop] ?? Number.NaN }))
          const loose = rows.filter((row) => !(row.compact < row.official))
          check.ok(
            `w=${String(width)} ${spec.region}：每一项紧凑档都严格小于官方原值`,
            loose.length === 0,
            rows.map((row) => `${row.prop} ${String(row.compact)}<${String(row.official)}`).join(' '),
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
      screenshots.push(await shot(ctx, page, 'density-spread-drawer-340'))
      await page.click('[data-dshone-tree-action="recycle-close"]')
      await page.waitForTimeout(200)
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
// F-13 RECYCLE-TWO-LAYER：回收站两层语义（#103）
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
  const row = page.locator(`[data-dshone-session="${sessionId}"]`)
  await row.hover()
  await row.locator('.dshOneTree_rowIconButton').click()
  await page.waitForTimeout(250)
  await page.click('[data-dshone-tree-item="move-to-recycle-bin"]')
  await page.waitForTimeout(350)
}

export const RECYCLE_TWO_LAYER_SUITE: LabSuite = {
  id: 'F-13',
  phase: 'new-feature',
  name: '回收站两层语义（#103）：移入/还原是本地可逆、归档=删除带确认（RECYCLE-TWO-LAYER 套件）',
  expect:
    '#103 定的两层语义在真实装配页上成立（真网关**只读** + 假宿主 + 同一上下文里并排开官方浏览区对照档）：① **移入回收站只写本地状态**——行菜单「移入回收站」后会话从我们树里消失、入口角标 +1、假宿主状态存储里出现 `recycle-bin`（形状 `{version:1, sessionIds:[按移入顺序]}`），而**官方浏览区里的会话一条都没少**（同时刻对照，证明 dsh 侧一个字节没动）；② **抽屉形态**：点入口行从底部半高滑出（高度档 50）、提手上拉吸附到 90、按原工作区分块、块内按移入顺序倒序、块头可折叠且折叠态落 `dsh.workspaceTree.view`（重载后仍收起）；③ **还原**（行尾按钮与入口「全部还原」）同样只动本地状态，会话回到树里；④ **归档 = 删除**：入口「清空」先开确认弹窗（写明不可恢复、按工作区列出将归档的会话、写明跳过数），取消则什么都不发生；⑤ 回收站空时入口两枚动作图标禁用。全程零 pageerror，且本套件**从不点归档确认**（那会写真实网关）。',
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
          const rows = Array.from(section.querySelectorAll('[data-dshone-tree-row="session"]')).filter(
            (row) => row.querySelector('.dshOneTree_rowActions') !== null,
          )
          if (rows.length >= 2) {
            return {
              key: section.getAttribute('data-dshone-group-key') ?? '',
              ids: rows.slice(0, 2).map((row) => row.getAttribute('data-dshone-session') ?? ''),
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
              .join(' ')
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
        const row = page.locator(`[data-dshone-session="${first}"]`)
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
      check.eq('移入的会话从我们树里消失', await contentCount(page, `[data-dshone-session="${first}"]`), 0)
      const entryCount = async (): Promise<string | null> => page.getAttribute('[data-dshone-tree-action="recycle-open"]', 'data-dshone-tree-recycle-count')
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
      await page.click('[data-dshone-tree-action="recycle-open"]')
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
        }
      })
      check.fact(`抽屉：高度档=${String(drawer?.height)} 实测比例=${String(drawer?.ratio.toFixed(2))} 块=${JSON.stringify(drawer?.blocks)}`)
      check.ok('点入口行从底部滑出抽屉', drawer !== null)
      check.ok('默认半高（高度档 50，实测比例在 0.45~0.55）', drawer?.height === 50 && (drawer?.ratio ?? 0) > 0.45 && (drawer?.ratio ?? 0) < 0.55, JSON.stringify(drawer))
      check.eq('抽屉里的行数 = 本地集合的条数', drawer?.rows, 2)
      check.eq('每行行尾一枚「还原」', drawer?.restoreButtons, 2)
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
      await page.click('[data-dshone-tree-action="recycle-close"]')
      await page.waitForTimeout(250)
      check.eq('点关闭按钮收起抽屉', await contentCount(page, '[data-dshone-tree="recycle-drawer"]'), 0)
      await page.click('[data-dshone-tree-action="recycle-open"]')
      await page.waitForTimeout(350)
      check.eq('重新打开后折叠态仍在', await page.getAttribute(`[data-dshone-recycle-group-toggle="${collapsedKey}"]`, 'data-dshone-recycle-collapsed'), 'true')

      // ---- ⑥ 重载后仍生效（本地集合从宿主状态存储读回、折叠态从客户端存储读回） ----
      await page.addInitScript({
        content: `(() => { globalThis.__LAB_HOST__.stateStore['recycle-bin'] = ${JSON.stringify({ version: 1, sessionIds: [first, second] }) } })()`,
      })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector(route('sidebar').readySelector, { timeout: 40_000 })
      await page.waitForTimeout(2_500)
      const afterReload = (await hostRecycleBin(page)) as { sessionIds?: string[] } | null
      check.eq('重载后本地集合仍是那两条（旧文件形状读回来原样保留移入顺序）', afterReload?.sessionIds ?? [], [first, second])
      // 注入的就是旧侧栏那份文件的形状（`{version:1, sessionIds:[...]}`）：页面打开时
      // 原样读回 = 「旧 recycle-bin.json 一次性迁入」这件事的可执行口径（键名与文件形状
      // 都是同一份，没有搬运步骤，见 pure/recycleBinState.ts 的说明）。
      check.eq('重载后入口角标还是 2（旧文件形状的本地集合原样读回）', await entryCount(), '2')
      await page.click('[data-dshone-tree-action="recycle-open"]')
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
      check.eq('还原后会话回到我们树里', await contentCount(page, `[data-dshone-session="${first}"]`), 1)
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
      check.eq('全部还原后第二条也回到树里', await contentCount(page, `[data-dshone-session="${second}"]`), 1)
      await page.waitForTimeout(1_000)
      check.eq('全部还原不动 dsh 侧（官方浏览区会话数不变）', await officialRows(), officialBefore)
      screenshots.push(await shot(ctx, page, 'recycle-restored-all'))

      // ---- ⑩ 归档项的资格判定接在真实会话状态上（禁用 = 有原因 + 有原因提示） ----
      // 一条会话一个事实：把前若干行逐个开菜单读「归档项」的判定结果，验
      // 「原因 ↔ 禁用 ↔ 提示」三者一致（四种原因分别是哪条，取决于当天网关上的会话状态，
      // 所以这里钉的是接线与一致性，纯判定的四态在单测 test/sessionActions.test.ts 里）。
      const probeRows = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-dshone-tree-row="session"]'))
          .filter((row) => row.querySelector('.dshOneTree_rowActions') !== null)
          .slice(0, 6)
          .map((row) => row.getAttribute('data-dshone-session') ?? ''),
      )
      const archiveFacts: Array<{ id: string; reason: string; hint: string; disabled: boolean }> = []
      for (const id of probeRows) {
        const row = page.locator(`[data-dshone-session="${id}"]`)
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
        return chosen.map((row) => ({ id: row.getAttribute('data-dshone-session') ?? '', status: status(row) }))
      })
      await page.click('[data-dshone-tree-action="select-mode"]')
      await page.waitForTimeout(300)
      for (const entry of picked) {
        await page.locator(`[data-dshone-session="${entry.id}"]`).click()
        await page.waitForTimeout(80)
      }
      const selected = await page.evaluate((ids: string[]) => {
        const marks = Array.from(document.querySelectorAll('[data-dshone-tree-row="session"]'))
          .filter((row) => ids.includes(row.getAttribute('data-dshone-session') ?? ''))
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
]
