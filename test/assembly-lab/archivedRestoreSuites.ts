/**
 * 归档之后的还原入口（#239，F-71）。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与 `tagRailSuites.ts` / `collapseAllIconSuites.ts`
 * 同一：那个文件是本批开发的合入热点，新套件放外面能少一半冲突面。注册方式是在
 * `suites.ts` 的 `SUITES` 末尾追加一项。
 *
 * ## 这一条要证的形状
 *
 * 官方两侧各有一代「取消归档」入口，而 dsh-one 的侧栏两代都够不着（背景与机制分层见
 * `packages/dsh-workspace-tree/src/workspaceTree/archivedSection.ts` 的文件头）：
 *
 * - **0.1.6 及以前**：入口是设置页里的一节（官方 `dsh-client-ui-settings-unarchive-sessions`，
 *   节名「已归档会话」/「Archived sessions」）。自有树**不该**多出第二个入口。
 * - **0.1.7 起**：那一件整件没了，官方把入口搬进官方侧栏的会话行菜单（新槽位
 *   `sidebar.workspaces.session.menu.item` / `...row.action`）——而 `sidebar.workspaces`
 *   被自有树遮蔽（shadow）。于是取消归档两截都断，自有树在**树底**补一节「已归档」
 *   （数据面是官方工作区快照的归档 id 集合，动作走官方 `uiWorkspace.unarchiveSession`）。
 *
 * 套件分两段：
 *
 * 1. **不装夹具的页面**（这一代真实的形状）：读树根上那一格观测值
 *    （`data-dshone-tree-unarchive-entry`：`inline` / `settings` / `none`），与设置页上
 *    「官方那一节在不在」对账（关系不变量），并判「归档的会话在树里翻不出来」。
 * 2. **装夹具把另一代的形状造出来**：0.1.7 那一代真正的样子（官方声明了那两个会话菜单
 *    槽位）在 0.1.6 上不存在，而本机上 0.1.7 的侧栏树整棵被 **#236**（官方把图标导出名
 *    从尺寸后缀改成字重后缀，我们 import 的 26 个名字全变 `undefined` → React #130）挡着、
 *    一条读数也拿不到。所以这一代形状由套件**就地声明一条同名槽位**造出来（走官方注册表
 *    的公开方法 `register`，注入点由 fiber 探针留下的 `ctx` 提供，与 F-63 同一做法），
 *    然后在同一页上把端到端走完：归档一条真会话 → 它在树里没有行、只出现在树底那一节里
 *    → 点「取消归档」→ 它回到列表里。
 *
 *    **这一档造的是形状、不是结果**：渲染、点击、网关返回全是真的，只有「官方这一代声明
 *    了那个槽位」这一件事是夹具摆出来的（在真 0.1.7 上它本来就是真的，夹具会看到槽位已
 *    声明而什么都不做）。#236 落地之后同一套断言直接跑在真 0.1.7 上，这一档届时退化成
 *    「与真形状逐条同值」的重复验证。
 *
 * ## 数据面与写操作
 *
 * 实验自起的隔离实例 + 假宿主。归档与取消归档**真的写这台实例**（播种本来就写它，
 * 见 `seed.ts` 的文件头）；用户那台实例全程不被碰（R-06 兜底）。这一条**必须**真写：
 * 「还原入口可用」的唯一可信证据就是会话真的回到列表里，页内夹具造不出这件事。
 *
 * ## 文案与判据的来源
 *
 * 期望文案一律从插件词典读（`harness.ts` 的 `texts` / `hasText`，两种页面语言都认）。
 * 只有一处例外：**官方设置页那一节的节名**——它属于官方件（官方词典 `nav`），我们那份
 * 词典里没有也不该有，所以那两个取值在本文件里逐字写着，出处见
 * {@link OFFICIAL_UNARCHIVE_SECTION_LABELS}。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import type { Page } from 'playwright'
import { callRpc, listSessions, sessionTitle } from '../../src/server/dshRpc.ts'
import { hasText, openTreePage, withoutKnownNoise, type OpenedPage } from './harness.ts'
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

/** 树根上那一格观测值（`data-dshone-tree-unarchive-entry`）。 */
const ENTRY_ATTR = 'data-dshone-tree-unarchive-entry'

/**
 * 官方「侧栏会话行菜单」那两个槽位里的第一个（0.1.7 起由官方 ui-workspace 声明；
 * 0.1.6 及以前的官方产物里查无此名）。它既是**产品里那道判据**的输入
 * （`packages/dsh-workspace-tree/src/workspaceTreePlugin.ts` 的 `OFFICIAL_SESSION_MENU_SLOT`），
 * 也是本套件夹具要就地声明的那条槽位。
 */
const OFFICIAL_SESSION_MENU_SLOT = 'sidebar.workspaces.session.menu.item'

/**
 * 官方设置页那一节的节名两份取值。**官方件的文案**，出处：`@deepseek-ai/dsh-client-ui-settings-unarchive-sessions`
 * 的 locale 字典 `nav`（0.1.6-alpha.2 的 combo 原文 `nav: "已归档会话"` / `nav: "Archived sessions"`）。
 * 它不在我们那份词典里（那是官方插件自己的命名空间），所以这里逐字引用而不是走 `texts()`。
 */
const OFFICIAL_UNARCHIVE_SECTION_LABELS = ['已归档会话', 'Archived sessions'] as const

/**
 * **0.1.7-alpha.2 上「整棵侧栏树渲染不出来」的签名**——只有命中其中一条才允许记事实跳过；
 * 一条都不命中就是未知原因，当场判红。两条都实测过（2026-09-23 本机、候选版本装到
 * 临时目录）：
 *
 * - `Minified React error #130`：官方把图标导出名从尺寸后缀改成字重后缀，我们取用的
 *   26 个名字全变 `undefined`，渲染时 React 抛它（`slot entry crashed in
 *   'sidebar.workspaces'` / `'sidebar.footer.action'`）。**这一条已随 #236 修掉**。
 * - `renderSlot('root') before any 'root' registration (boot order)`：0.1.7 上四棵树
 *   （含不装我们插件的官方对照页 `sidebar-official`）连 root 条目都没注册上，页面没装完
 *   ——**这一条还在**，是 0.1.7 上另一条独立的启动期问题（归因与读数见 #236 的报告 F-03
 *   那一项，尚未另立 issue）。
 *
 * **这条口子与 #239 无关**，判据是「改前改后逐字同值」：不带本改动的主线基线（`main`）
 * 与带本改动的分支，在 0.1.7-alpha.2 上跑同一个 F-01，读数都是 **21/40**、侧栏页
 * pageerror 都是上面第二条；而 0.1.6-alpha.2 上整轮 F-01 **43/43**、零 pageerror。
 * **那条启动期问题修掉之后这个口子要删掉**：那时 0.1.7 上侧栏树能渲染，本套件会直接跑
 * 真形状那一档（第 ② 段夹具看到槽位已声明、什么都不做），「记事实跳过」这条路径不再有意义。
 */
const BLOCKED_017_SIGNATURES: readonly RegExp[] = [
  /Minified React error #1(3|30)/,
  /renderSlot\('root'\) before any 'root' registration/,
]

interface ArchivedReading {
  /** 树底那一节在不在（节点数），列了几条。 */
  section: number
  count: string | null
  /** 那一节里列着的会话 id（渲染顺序）。 */
  ids: string[]
  /** 树里的会话行里有没有这条 id（归档时它不该在）。 */
  sessionRows: number
  /** 这条 id 在整页 DOM 里出现几次。 */
  idOccurrences: number
  /** 这条 id 是不是落在树底那一节里（出现几次）。 */
  idInsideSection: number
  /** 这一代取消归档的入口（观测值）。 */
  entry: string | null
}

/** 读侧栏页上「已归档」这一节与某条会话的关系（一次 evaluate，读数同拍）。 */
async function readArchived(page: Page, sessionId: string): Promise<ArchivedReading> {
  return page.evaluate(
    (args: { attr: string; id: string }) => {
      const section = document.querySelector('[data-dshone-tree-section="archived"]')
      const root = document.querySelector('[data-dshone-tree="root"]')
      return {
        section: document.querySelectorAll('[data-dshone-tree-section="archived"]').length,
        count: section?.getAttribute('data-dshone-archived-count') ?? null,
        ids: Array.from(document.querySelectorAll('[data-dshone-tree-row="archived"]')).map(
          (row) => row.getAttribute('data-dshone-tree-session') ?? '',
        ),
        sessionRows: document.querySelectorAll(
          `[data-dshone-tree-row="session"][data-dshone-tree-session="${args.id}"]`,
        ).length,
        idOccurrences: document.querySelectorAll(`[data-dshone-tree-session="${args.id}"]`).length,
        idInsideSection: Array.from(
          document.querySelectorAll('[data-dshone-tree-section="archived"] [data-dshone-tree-session]'),
        ).filter((row) => row.getAttribute('data-dshone-tree-session') === args.id).length,
        entry: root?.getAttribute(args.attr) ?? null,
      }
    },
    { attr: ENTRY_ATTR, id: sessionId },
  )
}

/** 设置页导航行里的节名（官方那一节在不在，按它判）。 */
async function settingsSectionLabels(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.dshOneSettingsShell_navCell')).map((cell) => cell.textContent ?? ''),
  )
}

/** 把整棵树展开（要能看见分组里的会话行）。 */
async function expandAll(page: Page): Promise<void> {
  const flag = async (): Promise<string | null> =>
    page.getAttribute('[data-dshone-tree-action="collapse-all"]', 'data-dshone-tree-collapsed')
  if ((await flag()) === 'true') {
    page.click('[data-dshone-tree-action="collapse-all"]').catch(() => {})
    await page.waitForTimeout(250)
  }
}

/**
 * 把 0.1.7 那一代的形状就地造出来（见文件头第 2 段）：经 fiber 探针留下的 `ctx` 调
 * 官方注册表的公开方法 `register`，在本页清单上**宣布**那条会话菜单槽位。
 *
 * 三条自守：
 * - 槽位**已经被声明**（真 0.1.7，或夹具跑第二遍）时什么都不做，返回 `already-declared`
 *   ——夹具不许把真形状改掉；
 * - 取服务不能用 `ctx.slots`（探针拿到的 ctx 没声明过 `inject`，cordis 会抛「cannot get
 *   property "slots" without inject」，F-63 实测过），走 `ctx.reflect.get('slots')`；
 * - 任何一步失手都把**人话**返回（进报告），不抛进 evaluate 让整条套件崩掉。
 *
 * 返回字符串是**给报告的事实**；判据在调用方按「声明结果不是失败」加一条。
 */
async function declareSessionMenuSlot(page: Page, slot: string): Promise<string> {
  return page.evaluate((name: string) => {
    const record = (globalThis as { __LAB_FIBER__?: { ctx?: unknown } }).__LAB_FIBER__
    const ctx = record?.ctx as { reflect?: { get?: (key: string) => unknown } } | undefined
    if (ctx === undefined) return '这个页面没给套件留下 ctx（fiber 探针没接上）'
    let slots: {
      specDynamic?: (key: string) => unknown
      register?: (options: unknown, component: unknown) => unknown
    } | undefined
    try {
      slots = ctx.reflect?.get?.('slots') as typeof slots
    } catch (error) {
      return `反射取 slots 抛了：${error instanceof Error ? error.message : String(error)}`
    }
    if (slots === undefined || typeof slots.register !== 'function') return '反射取到的 slots 上没有 register'
    if (typeof slots.specDynamic === 'function' && slots.specDynamic(name) !== undefined) return 'already-declared'
    try {
      slots.register(
        {
          name: 'sidebar.footer.action',
          id: 'lab-archived-restore-fixture',
          children: { [name]: { kind: 'list', scope: 'root' } },
        },
        () => null,
      )
      return 'declared'
    } catch (error) {
      return `register 抛了：${error instanceof Error ? error.message : String(error)}`
    }
  }, slot)
}

/** 等某一格条件成立（返回它成没成；不抛，让判据自己报红）。 */
async function waitFor(page: Page, probe: () => Promise<boolean>, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await probe()) return true
    if (Date.now() > deadline) return false
    await page.waitForTimeout(200)
  }
}

export const ARCHIVED_RESTORE_SUITE: LabSuite = {
  id: 'F-71',
  phase: 'new-feature',
  name: '归档之后的还原入口：树底「已归档」一节与官方设置页那一节的关系（#239）',
  expect:
    '实验室自起的隔离实例 + 假宿主 + 真装配页（归档与取消归档**真的写这台实例**——还原入口可用的唯一可信证据就是会话真的回到列表里；用户那台实例全程只被只读探测）。① **这一代真实的形状**（不装夹具的那一页）：归档之后那条会话在树里**没有任何会话行**（它从列表里消失）；树根上那一格观测值（`data-dshone-tree-unarchive-entry`）说 `settings` ⟺ 设置页导航行里真有官方那一节（节名取自官方词典 `nav`：「已归档会话」/「Archived sessions」）、且树底那一节一个节点都不渲染、这条 id 在整页一个节点都没有（官方入口还在设置页里，自有树不该多出第二个入口）；说 `inline` ⟺ 设置页上**已经没有**官方那一节、而树底那一节在场。② **端到端的还原**（这一代是 `inline` 时直接跑；否则由夹具就地声明那条会话菜单槽位、把 0.1.7 那一代的形状造出来再跑，理由与自守见本文件文件头）：树底那一节恰好一节、列着刚归档的那一条、这条 id 整页只出现一次且就落在这一节里（= 官方那套会话行菜单在 dsh-one 的侧栏里一条都不渲染，「翻不出它」的可执行版本）；那一行上的「取消归档」常显、可点、几何非零、读屏标签带着这条会话的标题（文案取自插件词典，两种页面语言都认）；点它之后这一条从那一节消失、**回到它所属工作区的会话行上**，并飘一条「已取消归档 {标题}」的回执。③ 全程零 pageerror、零槽位崩溃、零装载未激活；**从不点归档确认弹窗**（归档这一步经官方 RPC 直接做，弹窗那一路由 F-15 / F-16 / F-17 判）。本机 0.1.7-alpha.2 上侧栏树整棵渲染不出来（`Minified React error #130` 已随 #236 修掉；剩下的是同一版上另一条未修的启动期问题 `renderSlot(\'root\') before any \'root\' registration`，四棵树含官方对照页都有），那一版上本套件只记一条带签名的事实（见 `BLOCKED_017_SIGNATURES`），端到端由第 ② 段夹具承载。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const gateway = ctx.lab.gateway

    // ---------------------------------------------------------------------
    // 夹具：一条真会话（非空白、且不在跑——0.1.7 起官方拒绝归档「跑着一轮」的会话）
    // ---------------------------------------------------------------------
    const sessions = await listSessions(gateway)
    const target = sessions.find((row) => row.blank !== true && row.running !== true)
    if (target === undefined) {
      check.ok('隔离实例里有可归档的会话（非空白、不在跑）', false, `共 ${String(sessions.length)} 条`)
      return screenshots
    }
    const title = sessionTitle(target) ?? target.sessionId
    check.fact(`夹具会话 ${target.sessionId.slice(0, 13)}（标题 ${JSON.stringify(title)}）`)

    // 归档（官方 RPC，与页面上那一枚「归档会话」同一条服务）：回执给的就是归档集合。
    const archived = await callRpc<{ archivedSessionIds?: string[] }>(gateway, 'workspace.archiveSession', {
      sessionId: target.sessionId,
    })
    check.ok(
      '归档那条会话之后它在网关的归档集合里（夹具前提）',
      (archived.archivedSessionIds ?? []).includes(target.sessionId),
      JSON.stringify(archived).slice(0, 200),
    )

    // ---------------------------------------------------------------------
    // 侧栏页（装 fiber 探针：第 ② 段的夹具要经它拿 ctx）
    // ---------------------------------------------------------------------
    const sidebar = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), {
      width: 340,
      height: 900,
      fiberProbe: true,
    })
    const treeRoot = await sidebar.page.locator('[data-dshone-tree="root"]').count()
    try {
      if (treeRoot === 0) {
        // 这一版上自有树根本没渲染出来（0.1.7-alpha.2 的现状：一条**未修的启动期问题**，
        // `renderSlot('root') before any 'root' registration`——四棵树含官方的
        // `sidebar-official` 对照页都有它，改前也在，见 #236 的报告 F-03 那一项）。
        // 只认那两条签名——一条都不命中就是未知原因，当场判红，不当「这一版量不到」放过去。
        const blocked = sidebar.capture.pageErrors.filter((line) =>
          BLOCKED_017_SIGNATURES.some((pattern) => pattern.test(line)),
        )
        check.ok(
          '首屏没起来时，原因是已知的 0.1.7 签名（图标名整批改名 / root 条目没注册上）',
          blocked.length > 0,
          sidebar.capture.pageErrors.slice(0, 1).join(' | ').slice(0, 300),
        )
        check.eq('这一版上自有树根节点确实不在场（读数就是「量不到」）', treeRoot, 0)
        check.fact(
          '这一版上整个侧栏树渲染不出来（`Minified React error #130` 已随 #236 修掉；剩下这条 ' +
            '`renderSlot(\'root\') before any \'root\' registration` 是 0.1.7 上另一条未修的启动期问题，' +
            '官方对照页也有），本套件在这一版拿不到这一节的读数；机制与端到端由 0.1.6 上「就地声明那条槽位」的夹具承载' +
            '（见本文件文件头）。那条启动期问题修掉之后这一档自动变成真 0.1.7 上的验证，这个口子要删掉',
        )
        screenshots.push(await shot(ctx, sidebar.page, 'archived-restore-017-blocked-root-boot'))
        return screenshots
      }

      await expandAll(sidebar.page)
      const reading = await readArchived(sidebar.page, target.sessionId)
      check.fact(
        `侧栏页（不装夹具）：入口观测值=${String(reading.entry)}；树底那一节=${String(reading.section)}（列 ${String(reading.count)} 条：` +
          `${reading.ids.map((id) => id.slice(0, 13)).join(', ')}）；这一条在树里的会话行=${String(reading.sessionRows)}、整页出现=${String(reading.idOccurrences)} 次`,
      )
      check.ok(
        '入口观测值合法（inline / settings / none）',
        reading.entry === 'inline' || reading.entry === 'settings' || reading.entry === 'none',
        String(reading.entry),
      )
      // 两侧都成立的负向对照：**归档的会话在树里没有会话行**（它从列表里消失）。
      check.eq('归档之后这一条在树里没有会话行（它从列表里消失）', reading.sessionRows, 0)
      screenshots.push(await shot(ctx, sidebar.page, 'archived-restore-sidebar'))

      // -------------------------------------------------------------------
      // 这一代真实的形状：设置页上官方那一节在不在（关系不变量的另一半）
      // -------------------------------------------------------------------
      const settings = await openTreePage(ctx.browser, ctx.lab, route('settings'), { width: 1200, height: 900 })
      let officialSection = false
      try {
        const labels = await settingsSectionLabels(settings.page)
        officialSection = labels.some((label) =>
          OFFICIAL_UNARCHIVE_SECTION_LABELS.some((name) => label.includes(name)),
        )
        check.fact(
          `设置页导航行 ${String(labels.length)} 条；官方「已归档会话」那一节在场=${String(officialSection)}（${labels.map((l) => JSON.stringify(l)).join(', ')}）`,
        )
        screenshots.push(await shot(ctx, settings.page, 'archived-restore-settings'))
      } finally {
        await settings.context.close()
      }

      check.eq(
        '观测值说 settings ⟺ 官方设置页那一节在场（这一代真实形状的判据）',
        reading.entry === 'settings',
        officialSection,
      )

      if (reading.entry === 'settings' || reading.entry === 'none') {
        // 老一代（官方入口在设置页里）或两侧都没有：自有树不该多出第二个入口。
        check.eq('树底那一节一个节点都不渲染（这一代不由我们出这一节）', reading.section, 0)
        check.eq('这一条在整页一个节点都没有（归档的会话不翻出来）', reading.idOccurrences, 0)
        if (reading.entry === 'settings') {
          check.ok('这一代的官方入口确实在设置页那一节里（就是它，上面那条关系已判）', officialSection)
        } else {
          check.fact('这一代两侧都没有取消归档入口（观测值 none）——页面上确实没有退路，这一格把它记成事实')
        }
        screenshots.push(await shot(ctx, sidebar.page, 'archived-restore-before-fixture'))

        // -----------------------------------------------------------------
        // 夹具：把 0.1.7 那一代的形状造出来（详见文件头），然后走端到端
        // -----------------------------------------------------------------
        const declared = await declareSessionMenuSlot(sidebar.page, OFFICIAL_SESSION_MENU_SLOT)
        check.fact(`夹具声明那条会话菜单槽位：${declared}`)
        check.ok('夹具把那一代的形状摆出来了（或台上本来就声明着）', declared === 'declared' || declared === 'already-declared', declared)
        const flipped = await waitFor(sidebar.page, async () => {
          const now = await readArchived(sidebar.page, target.sessionId)
          return now.entry === 'inline' && now.section === 1
        })
        // 这一档的形状是夹具摆的（真 0.1.7 上它本来就是真的），所以只记事实 + 一条
        // 「判据对槽位声明有反应」的断言：声明之后那一节必须出现。
        check.ok('声明那条槽位之后，树底那一节当场出现（判据跟着注册表走，不是写死的版本号）', flipped)
      }

      // -------------------------------------------------------------------
      // 端到端的还原（这一代是 inline 时直接跑；老一代走上面那一段夹具）
      // -------------------------------------------------------------------
      const inline = await readArchived(sidebar.page, target.sessionId)
      check.eq('此刻这一页的入口是 inline（树底那一节由我们出）', inline.entry, 'inline')
      check.eq('树底「已归档」一节在场（恰好一节）', inline.section, 1)
      check.ok('这一节列着刚归档的那一条', inline.ids.includes(target.sessionId), JSON.stringify(inline.ids))
      check.ok(
        '这一条整页只出现一次、且就落在这一节里（官方那套菜单一条都没渲染）',
        inline.idOccurrences === 1 && inline.idInsideSection === 1,
        `出现 ${String(inline.idOccurrences)} 次、其中在那一节里 ${String(inline.idInsideSection)} 次`,
      )

      const button = `[data-dshone-tree-row="archived"][data-dshone-tree-session="${target.sessionId}"] [data-dshone-tree-action="unarchive"]`
      const ui = await sidebar.page.evaluate((sel: string) => {
        const el = document.querySelector(sel) as HTMLElement | null
        const box = el?.getBoundingClientRect()
        return {
          present: el !== null,
          text: el?.textContent ?? '',
          aria: el?.getAttribute('aria-label') ?? '',
          disabled: (el as HTMLButtonElement | null)?.disabled ?? null,
          width: box?.width ?? 0,
          height: box?.height ?? 0,
        }
      }, button)
      check.ok(
        '那一行上「取消归档」这一枚在场且可点（几何非零、不禁用）',
        ui.present && ui.width > 0 && ui.height > 0 && ui.disabled === false,
        JSON.stringify(ui),
      )
      check.ok('那一枚的文案取自插件词典（zh / en 任一份）', hasText(ui.text, '取消归档'), JSON.stringify(ui.text))
      check.ok('那一枚的读屏标签带着这条会话的标题', hasText(ui.aria, `取消归档 ${title}`), JSON.stringify(ui.aria))
      screenshots.push(await shot(ctx, sidebar.page, 'archived-restore-inline-section'))

      await sidebar.page.click(button)
      await sidebar.page.waitForTimeout(1_500)
      const after = await readArchived(sidebar.page, target.sessionId)
      const rowBack = await sidebar.page.evaluate(
        (sel: string) => document.querySelectorAll(sel).length,
        `[data-dshone-tree-row="session"][data-dshone-tree-session="${target.sessionId}"]`,
      )
      const flash = await sidebar.page.evaluate(
        () => document.querySelector('[data-dshone-tree="flash"]')?.textContent ?? '',
      )
      check.fact(
        `点过「取消归档」之后：这一节=${String(after.section)}（列 ${String(after.count)} 条）；这一条在树里的会话行=${String(rowBack)}、整页出现=${String(after.idOccurrences)} 次；飘提示=${JSON.stringify(flash)}`,
      )
      check.eq('这一条从「已归档」一节里消失了', after.ids.includes(target.sessionId), false)
      check.eq('这一条回到了树里的会话行上（还原真的可用）', rowBack, 1)
      check.ok('飘了一条「已取消归档」的回执', hasText(flash, `已取消归档 ${title}`), JSON.stringify(flash))
      screenshots.push(await shot(ctx, sidebar.page, 'archived-restore-after-unarchive'))

      // 收尾：这一页的日志也要干净（零崩溃 / 零未激活 / 零 pageerror）。
      const noisy = withoutKnownNoise(sidebar.capture.pageErrors)
      check.ok(
        '侧栏页零 pageerror（去掉已知噪音之后）',
        noisy.real.length === 0,
        noisy.real.slice(0, 3).join(' | ').slice(0, 300),
      )
    } finally {
      await sidebar.context.close()
    }

    return screenshots
  },
}
