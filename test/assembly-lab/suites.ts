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
  slotFacts,
  slotChildren,
  withoutKnownNoise,
  type OpenedPage,
} from './harness.ts'
import { LAB_TREES, type LabServer, type LabTreeRoute } from './labServer.ts'

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

const CONTRACT_TREES: ReadonlyArray<{ route: string; content: { label: string; selector: string } }> = [
  { route: 'sidebar', content: { label: '自有工作区树的会话行', selector: '.dshOneTree_sessionRow' } },
  { route: 'sidebar-official', content: { label: '官方浏览区的会话行', selector: '[class*="_sessionRow"]' } },
  { route: 'chat', content: { label: '对话区 composer 座位', selector: '[data-slot="conversation.composer.bar"] > *' } },
  { route: 'settings', content: { label: '设置内容区', selector: '[data-slot="settings.section"] > *' } },
]

export const CONTRACT_SUITE: LabSuite = {
  id: 'F-01',
  phase: 'new-feature',
  name: '底座契约完备性：四棵树在真实网关上零崩溃、零缺失契约（CONTRACT 套件）',
  expect:
    '实验室四棵树（自有 sidebar 树、官方浏览区对照档、chat 树、settings 树）各自在真实网关只读下打开：**零 `slot entry crashed`**（官方渲染层崩溃 + 页面无 `data-slot-error` 元素）、**零 pageerror**、**零装载未激活**（官方 `web boot: … did not activate` / `waiting for service`，即缺服务/缺钩子那类底座缺口）；且该树自己的关键座位**有内容**（不是空壳）、该树的 frame 插件 bundle 真的装进了页面（combo 请求里有它的 id、页面上有它的 CSS 标记）。',
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
        screenshots.push(await shot(ctx, page, `contract-${entry.route}`))
      } finally {
        await opened.context.close()
      }
    }
    return screenshots
  },
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
 */
const PARITY_PAIRS: ReadonlyArray<{ suffix: string; props: readonly string[]; geometry?: 'width' }> = [
  { suffix: 'sectionHeader', props: ['height', 'borderRadius', 'paddingLeft', 'marginTop', 'marginBottom', 'marginRight'] },
  { suffix: 'search', props: ['height', 'borderRadius'] },
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
      check.ok('密度档变量组 ≥ 10 项（与契约测试同口径）', densityFix.applied >= 10, `applied=${String(densityFix.applied)}`)
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
      const chips = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-dshone-tree-chip]')).map((element) => element.getAttribute('data-dshone-tree-chip') ?? ''),
      )
      check.fact(`分组 chip：${chips.join(',')}`)
      check.eq('分组 chip 按旧 groups.json 渲染（全部 + 两个分组）', chips, ['all', 'g-lab-one', 'g-lab-two'])
      // 旧文件里的 activeGroupId 是**旧版**的「当前分组」；本版它是纯视图态（住
      // localStorage），所以初值应当是「全部」——文件里那个字段原样保留不动。
      const allVisible = await workspaceKeys(page)
      check.eq('旧 activeGroupId 不被当作视图态（初始仍是「全部」）', allVisible.length, keys.length)

      // ---- 功能 1：过滤 ----
      await page.click('[data-dshone-tree-chip="g-lab-one"]')
      await page.waitForTimeout(200)
      check.eq('点分组 chip 后只留归属该分组的工作区', await workspaceKeys(page), [keys[0]])
      const storedPrefs = await page.evaluate(() => localStorage.getItem('dsh.workspaceTree.view'))
      check.ok('当前过滤的分组写进官方惯例的 localStorage 键', storedPrefs !== null && storedPrefs.includes('g-lab-one'), String(storedPrefs))
      screenshots.push(await shot(ctx, page, 'sidebar-group-filter'))

      // ---- 功能 6 + 功能 2：不折叠与计数 ----
      await page.click('[data-dshone-tree-chip="all"]')
      await page.waitForTimeout(200)
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
      const chipsAfter = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-dshone-tree-chip]')).map((element) => element.getAttribute('data-dshone-tree-chip') ?? ''),
      )
      check.ok('功能 1：新分组立刻出现在过滤条里', chipsAfter.includes(created?.id ?? 'none'), chipsAfter.join(','))

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
      await page.click('[data-dshone-tree-chip="g-lab-two"]')
      await page.waitForTimeout(200)
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

export const SUITES: ReadonlyArray<LabSuite> = [
  CONTRACT_SUITE,
  SMOKE_SUITE,
  INTERACT_SUITE,
  PARITY_SUITE,
  BRIDGE_SUITE,
  PORTABLE_SUITE,
  SIDEBAR_SUITE,
]
