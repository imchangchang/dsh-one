/**
 * 顶栏 ＋ 菜单「添加/创建工作区」之后的收尾（#176）。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与其余套件同一条：那个文件是本批开发的
 * 合入热点，新套件放外面能少一半冲突面。注册方式是在 `suites.ts` 的 `SUITES` 末尾
 * 追加一项。
 *
 * ## 用户报的现场与两条路径各自的毛病（诊断实验的结论）
 *
 * 用户在侧栏顶栏的 ＋ 菜单里选完目录 / 输完名字之后「什么都不发生」。实测（诊断脚本
 * 跑在本机现起的临时 `DSH_HOME` 网关上，做法与结论写进 issue）：
 * - **注册是成功的**——`＋ → 选择已有文件夹…` 那一下真的走到了官方
 *   `uiWorkspace.pickDirectory()` → `workspaces.create({path})`，目录在网关的工作区
 *   注册表里出现（同一路径再 create 一次回 `created:false`），树里也立刻多出一行；
 * - **看不见的那一半是分组过滤**：`activeGroupId` 非空且新工作区不属于该组时，那一行
 *   整行不渲染（切回「全部工作区」立刻回来）；
 * - 另两处是「丢掉的东西」：两条路径都没接着开新会话，第一条路径的 `.catch(() => {})`
 *   连失败都吞掉（诊断脚本第一次把 pick 的回执写成坏形状时，页面**零**控制台输出、
 *   零 console error，症状与用户报的一模一样）。
 *
 * ## 本套件验什么（判据全部不吃当天数据）
 *
 * 数据面 = **真网关只读** + 假宿主 + **页内数据集夹具自己声明的工作区**（#162 的
 * `dataset.ts`），两条添加路径的写面（`directoryPicker/pick` 与 `workspace/create`）
 * 都由**页内夹具接住**——否则那两下会真的往用户网关上写工作区。断言：
 * ① 成功（选目录那条）：页面发出「在该工作区新建会话」的宿主调用、参数就是新工作区的
 *    id，新工作区的行出现在树里，零 pageerror；
 * ② 成功 + 过滤生效 + 新工作区不在该组：树里出现一条带「全部工作区」动作的提示、文案
 *    带新工作区的名字；点它之后过滤归零（`dsh.workspaceTree.view` 的 `activeGroupId`
 *    真的变 null）、那一行随之出现、提示消失；
 * ③ 过滤生效但新工作区就在该组（过滤没开那一档由 ① 覆盖）：提示不出现；
 * ④ 失败：两条路径各走一遍失败回执，页面上都有一行可见的错误反馈（不是只在控制台）；
 * ⑤ 官方 web 形态（删掉宿主桥那一份）：菜单第二项按既有口径不出现、第一项只添加不开
 *    会话、零 pageerror、控制台没有能力口那条失败告警。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import type { LabDataset } from './dataset.ts'
import { hasText, isText, openTreePage, texts, withoutKnownNoise, type OpenedPage } from './harness.ts'
import { LAB_TREES, type LabTreeRoute } from './labServer.ts'
// 只取类型（编译后不留 import，运行期没有环）：套件接口定义在 suites.ts 里。
import type { LabSuite } from './suites.ts'

const route = (name: string): LabTreeRoute => {
  const found = LAB_TREES.find((candidate) => candidate.route === name)
  if (found === undefined) throw new Error(`lab: unknown tree route ${name}`)
  return found
}

/** 夹具声明的三棵工作区（id / 路径 / 名字都由本套件说了算）。 */
const GROUP_ID = 'lab-g1'
const WS_ALPHA = 'lab-ws-alpha'
const WS_BETA = 'lab-ws-beta'
const WS_GAMMA = 'lab-ws-gamma'
/** 「选择已有文件夹…」那一条路径新建出来的工作区（由夹具的 `workspace/create` 回执声明）。 */
const WS_ADDED = 'lab-ws-added'
const ADDED_TITLE = 'Lab Added'

const DATASET: LabDataset = {
  workspaces: [
    { workspaceId: WS_ALPHA, path: '/lab/alpha', title: 'Lab Alpha', sessionIds: ['lab-session-01'] },
    { workspaceId: WS_BETA, path: '/lab/beta', title: 'Lab Beta', sessionIds: ['lab-session-02'] },
    { workspaceId: WS_GAMMA, path: '/lab/gamma', title: 'Lab Gamma', sessionIds: ['lab-session-03'] },
  ],
  sessions: [
    { sessionId: 'lab-session-01', title: 'Lab Alpha task 1', cwd: '/lab/alpha', updatedAt: Date.now() - 600_000 },
    { sessionId: 'lab-session-02', title: 'Lab Beta task 1', cwd: '/lab/beta', updatedAt: Date.now() - 1_200_000 },
    { sessionId: 'lab-session-03', title: 'Lab Gamma task 1', cwd: '/lab/gamma', updatedAt: Date.now() - 1_800_000 },
  ],
}

/**
 * 分组状态（宿主能力口的 `groups` 键，= 旧侧栏的 `groups.json`）：只把 alpha 放进
 * 组里，于是 beta / gamma 都是「不在当前分组里」的那些——②③ 两档判的正是它们。
 */
const GROUPS_STATE = {
  version: 1,
  groups: [{ id: GROUP_ID, name: 'Lab Group', color: null }],
  membership: { [WS_ALPHA]: [GROUP_ID] },
  activeGroupId: null,
}

/** 一棵夹具工作区在 `workspace/create` 回执里的形状（官方 strict 校验要的那几项）。 */
function workspaceView(workspaceId: string, dir: string, title: string): Record<string, unknown> {
  return {
    workspaceId,
    path: dir,
    title,
    sessionIds: [],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  }
}

/** 一条 RPC 回执信封（官方客户端只认 `type: "server-response"` + `result`）。 */
function rpcBody(rpcId: unknown, result: unknown): string {
  return JSON.stringify({ type: 'server-response', rpcId, result })
}

/** 这次添加/创建过程中页面用过的写面（读面不记：页面自己会按节奏轮询）。 */
interface PageFacts {
  apiCalls: string[]
}

/** 一行的现状（工作区行按分组键认）。 */
async function workspaceRows(page: OpenedPage['page']): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-dshone-group-key]')).map(
      (element) => element.getAttribute('data-dshone-group-key') ?? '',
    ),
  )
}

/** 假宿主侧关于 #176 的观测值（请宿主为哪个工作区开新会话、建目录调用过几次）。 */
async function hostFacts(
  page: OpenedPage['page'],
): Promise<{ newSessions: string[]; createCalls: number; sent: string[] }> {
  return page.evaluate(() => {
    const host = (globalThis as {
      __LAB_HOST__?: {
        newSessionsInWorkspace: string[]
        workspaceCreateCalls: unknown[]
        sent: { type?: unknown }[]
      }
    }).__LAB_HOST__
    return {
      newSessions: host?.newSessionsInWorkspace.slice() ?? [],
      createCalls: host?.workspaceCreateCalls.length ?? -1,
      sent: (host?.sent ?? [])
        .map((message) => (typeof message.type === 'string' ? message.type : ''))
        .filter((type) => type !== ''),
    }
  })
}

/** 树里那条「刚添加的工作区被分组过滤挡住」提示的现状。 */
interface NoticeFacts {
  present: boolean
  text: string
  action: string
  hasClose: boolean
  workspaceId: string
}

async function noticeFacts(page: OpenedPage['page']): Promise<NoticeFacts> {
  return page.evaluate(() => {
    const notice = document.querySelector('[data-dshone-tree="add-notice"]')
    if (notice === null) return { present: false, text: '', action: '', hasClose: false, workspaceId: '' }
    const action = notice.querySelector('[data-dshone-tree-action="show-all-workspaces"]')
    return {
      present: true,
      text: (notice.querySelector('.dshOneTree_addNoticeText')?.textContent ?? '').trim(),
      action: (action?.textContent ?? '').trim(),
      hasClose: notice.querySelector('[data-dshone-tree-action="dismiss-add-notice"]') !== null,
      workspaceId: notice.getAttribute('data-dshone-tree-added-workspace') ?? '',
    }
  })
}

/** 飘提示（失败反馈）的文案；没有提示时是空串。 */
async function flashText(page: OpenedPage['page']): Promise<string> {
  return page.evaluate(() => (document.querySelector('[data-dshone-tree="flash"]')?.textContent ?? '').trim())
}

/** 当前过滤的分组（读客户端存储里那份视图态，判据 = 树自己写下去的值）。 */
async function activeGroupId(page: OpenedPage['page']): Promise<string | null> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('dsh.workspaceTree.view')
    if (raw === null) return null
    try {
      const parsed = JSON.parse(raw) as { activeGroupId?: unknown }
      return typeof parsed.activeGroupId === 'string' ? parsed.activeGroupId : null
    } catch {
      return null
    }
  })
}

/** 点 ＋ 菜单里的哪一项（菜单先开出来）。 */
async function clickAddMenuItem(page: OpenedPage['page'], item: 'workspace-pick' | 'workspace-create'): Promise<void> {
  await page.click('[data-dshone-tree-action="add-workspace"]')
  await page.waitForTimeout(300)
  await page.click(`[data-dshone-tree-item="${item}"]`)
  await page.waitForTimeout(1500)
}

/** 用分组胶囊把过滤切到 `groupId`（真用户动作，不注 localStorage）。 */
async function filterTo(page: OpenedPage['page'], groupId: string): Promise<void> {
  await page.click('[data-dshone-tree-action="group-pill"]')
  await page.waitForTimeout(300)
  await page.click(`[data-dshone-tree-pill-item="${groupId}"]`)
  await page.waitForTimeout(800)
}

export const ADD_WORKSPACE_SUITE: LabSuite = {
  id: 'F-58',
  phase: 'new-feature',
  name: '顶栏 ＋ 菜单添加/创建工作区之后的收尾（#176，ADD-WORKSPACE 套件）',
  expect:
    '真网关**只读** + 假宿主 + 页内数据集夹具自己声明工作区（`dataset.ts`）与分组状态之后：① **成功（选择已有文件夹…）**——页面发出「在该工作区新建会话」的宿主调用（假宿主收到 `session.newInWorkspace`，参数就是新工作区的 id），新工作区的行出现在树里，过滤没开所以**没有**提示，零 pageerror；② **成功 + 过滤生效 + 新工作区不在该组**——树里出现一条页面内提示（`[data-dshone-tree="add-notice"]`），文案 = 插件词典那条并代入新工作区的名字、还带「全部工作区」这枚动作与关闭钮；点「全部工作区」之后 `dsh.workspaceTree.view` 的 `activeGroupId` 归零、那一行随之出现、提示消失；③ **成功 + 过滤生效但新工作区在该组**——提示不出现（这一档与「过滤没开」那一档合起来证明提示只在「真的看不见」时给）；④ **失败**——「创建新工作区目录」（宿主回失败回执）与「选择已有文件夹」（`workspace/create` 回失败）两条路都在页面上留一行可见的错误反馈（`[data-dshone-tree="flash"]` 的文案 = 词典那条 + 宿主给的失败原因），不再是静默吞掉；⑤ **官方 web 形态**（删掉页面上的宿主桥那一份）——菜单第二项按既有口径不出现、点第一项**只添加、不开会话**（零 `session.newInWorkspace` 调用）、零 pageerror、控制台没有能力口那条失败告警。全程写面（`directoryPicker/pick` 与 `workspace/create`）都由页内夹具接住，请求不落到网关；零 pageerror。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const shot = async (page: OpenedPage['page'], name: string): Promise<string> => {
      const file = path.join(ctx.shots, `${name}.png`)
      await fsp.mkdir(ctx.shots, { recursive: true })
      await page.screenshot({ path: file })
      return file
    }

    /**
     * 两条添加路径的写面夹具（参数由外面按档改）：
     * - `pick`：官方 `uiWorkspace.pickDirectory()` 的 RPC。**绝不能让它真的过去**——真网关
     *   那一侧是 dsh 进程自己的 OS 目录对话框，会直接在用户桌面上弹一个窗口（#163 的纪律）。
     * - `workspace/create`：官方的注册调用。真打过去就是往用户网关里写一棵工作区。
     */
    const installAddFixtures = async (
      page: OpenedPage['page'],
      state: {
        /** 「选择已有文件夹」选中的目录（pick 的回执）。 */
        pickPath: string
        /** `workspace/create` 回执里的新工作区。 */
        created: Record<string, unknown>
        /** 置 true 时 `workspace/create` 回失败（④ 那一档要的现场）。 */
        createFails: boolean
      },
      facts: PageFacts,
    ): Promise<{ pickHits: () => number; createHits: () => number }> => {
      let pickHits = 0
      let createHits = 0
      await page.route('**/api/directoryPicker/pick', async (r) => {
        pickHits += 1
        const body = r.request().postDataJSON() as { rpcId?: string } | null
        await r.fulfill({
          status: 200,
          contentType: 'application/json',
          body: rpcBody(body?.rpcId, { ok: true, value: state.pickPath }),
        })
      })
      await page.route('**/api/workspace/create', async (r) => {
        createHits += 1
        const body = r.request().postDataJSON() as { rpcId?: string } | null
        await r.fulfill({
          status: 200,
          contentType: 'application/json',
          body:
            state.createFails
              ? rpcBody(body?.rpcId, {
                  ok: false,
                  error: { code: 'gateway/internal', message: 'lab: forced workspace/create failure', details: {} },
                })
              : rpcBody(body?.rpcId, { ok: true, value: { created: true, workspace: state.created } }),
        })
      })
      // 只读守卫的记录器**最后装**（Playwright 里最后注册的先匹配）：它记一笔再
      // `fallback()`，请求继续交给上面两条夹具或数据集夹具处理——这样「这一趟走过哪些
      // 方法名」是真的，而不是被夹具绕过去的空话（#154 立的口径）。
      await page.route('**/api/**', async (r) => {
        facts.apiCalls.push(decodeURIComponent(r.request().url()).split('/api/')[1] ?? '')
        await r.fallback()
      })
      return { pickHits: () => pickHits, createHits: () => createHits }
    }

    const writeCalls = (calls: readonly string[]): string[] =>
      calls.filter((call) => /archive|delete|write|rename|create|fork|pick/i.test(call))

    // ---------------------------------------------------------------------
    // ①②③ 成功那三档（同一页按顺序走：先无过滤，再切过滤，再切回来）
    // ---------------------------------------------------------------------
    const main = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), {
      width: 380,
      height: 900,
      dataset: DATASET,
      state: { groups: GROUPS_STATE },
    })
    const { page } = main
    const facts: PageFacts = { apiCalls: [] }
    const fixtureState = {
      pickPath: '/lab/added',
      created: workspaceView(WS_ADDED, '/lab/added', ADDED_TITLE),
      createFails: false,
    }
    const fixtures = await installAddFixtures(page, fixtureState, facts)
    try {
      check.fact(`数据集夹具接上了没有：workspace/follow 基线被换成夹具 ${String(main.dataset?.workspaceFrames ?? -1)} 次、session/list ${String(main.dataset?.sessionList ?? -1)} 次`)
      check.ok(
        '夹具真的接上了（基线帧与清单回执都是本套件声明的那一份，判据不吃当天数据）',
        (main.dataset?.workspaceFrames ?? 0) > 0,
        JSON.stringify(main.dataset),
      )
      check.eq('起点：树里恰好是本套件声明的三棵工作区', (await workspaceRows(page)).sort(), [WS_ALPHA, WS_BETA, WS_GAMMA].sort())
      check.eq('起点：过滤没开（`activeGroupId` 是 null）', await activeGroupId(page), null)

      // ---- ① 选择已有文件夹…（成功）----
      const apiBeforePick = facts.apiCalls.length
      const beforePick = await hostFacts(page)
      const pickHitsBefore = fixtures.pickHits()
      await clickAddMenuItem(page, 'workspace-pick')
      const afterPick = await hostFacts(page)
      const pickRows = await workspaceRows(page)
      check.eq('① 页面发出「在该工作区新建会话」的宿主调用，参数就是刚加进来的工作区 id', afterPick.newSessions.slice(beforePick.newSessions.length), [WS_ADDED])
      check.ok('① 新工作区的行出现在树里（添加真的成功了，不是「什么都没发生」）', pickRows.includes(WS_ADDED), JSON.stringify(pickRows))
      check.ok(
        '① 新那一行显示的就是它的名字（夹具 `workspace/create` 回执里的 title 落进了树）',
        await page.evaluate((id: string) => {
          const row = document.querySelector(`[data-dshone-group-key="${id}"]`)
          return (row?.querySelector('.dshOneTree_title')?.textContent ?? '').trim()
        }, WS_ADDED) === ADDED_TITLE,
      )
      check.eq('① 过滤没开 → 那条提示不出现', (await noticeFacts(page)).present, false)
      check.eq(
        '① 这一步只有「选目录 + 注册」两次写面调用，且都被页内夹具接住（请求不落到网关）',
        writeCalls(facts.apiCalls.slice(apiBeforePick)).sort(),
        ['directoryPicker/pick', 'workspace/create'],
      )
      check.ok(
        '① 夹具确实接住了那两次：没在用户桌面上弹原生目录对话框、也没往用户网关里写一棵真工作区',
        fixtures.pickHits() > pickHitsBefore && fixtures.createHits() >= 1,
        JSON.stringify({ pickHits: fixtures.pickHits(), createHits: fixtures.createHits() }),
      )
      screenshots.push(await shot(page, 'add-workspace-01-picked'))

      // ---- ② 过滤生效 + 新工作区不在该组 → 提示 + 「查看全部」----
      await filterTo(page, GROUP_ID)
      check.eq('② 过滤切到夹具那一组（`activeGroupId` 落进客户端存储）', await activeGroupId(page), GROUP_ID)
      check.eq('② 该组只有 alpha 一棵（beta / gamma 都被过滤挡住）', await workspaceRows(page), [WS_ALPHA])

      // 「创建新工作区目录」这一档用宿主回执造：新工作区 = beta（不在该组）
      await page.evaluate((value: { workspaceId: string; title: string }) => {
        const host = (globalThis as { __LAB_HOST__?: { createdWorkspace: unknown } }).__LAB_HOST__
        if (host !== undefined) host.createdWorkspace = value
      }, { workspaceId: WS_BETA, title: 'Lab Beta' })
      const apiBeforeCreate = facts.apiCalls.length
      const pickHitsBeforeCreate = fixtures.pickHits()
      const beforeCreate = await hostFacts(page)
      await clickAddMenuItem(page, 'workspace-create')
      const afterCreate = await hostFacts(page)
      const notice = await noticeFacts(page)
      check.eq('② 「创建新工作区目录」经宿主能力口发出（页面拿到的是回执里的新工作区 id）', afterCreate.newSessions.slice(beforeCreate.newSessions.length), [WS_BETA])
      check.ok('② 树里出现那条页面内提示', notice.present, JSON.stringify(notice))
      check.ok(
        '② 提示文案 = 词典那条并代入新工作区的名字（zh / en 任一命中）',
        isText(notice.text, `\u201cLab Beta\u201d不在当前分组里，树里看不到它`),
        `actual=${JSON.stringify(notice.text)} expected=${JSON.stringify(texts('\u201cLab Beta\u201d不在当前分组里，树里看不到它'))}`,
      )
      check.ok('② 提示带「全部工作区」这枚动作（文案取自词典）', isText(notice.action, '全部工作区'), JSON.stringify(notice.action))
      check.ok('② 提示可关掉（有关闭钮）', notice.hasClose)
      check.eq('② 提示点名的是刚加的那一个工作区', notice.workspaceId, WS_BETA)
      const stepWrites = writeCalls(facts.apiCalls.slice(apiBeforeCreate))
      check.eq(
        '② 这一步一个写类 /api/ 调用都没有（「创建新工作区目录」走宿主能力口，页面这一侧不碰网关写面）',
        stepWrites,
        [],
      )
      check.eq('② 也没有原生目录选择器那一路（这一项根本不选目录）', fixtures.pickHits(), pickHitsBeforeCreate)
      screenshots.push(await shot(page, 'add-workspace-02-notice'))

      const apiBeforeShowAll = facts.apiCalls.length
      await page.click('[data-dshone-tree-action="show-all-workspaces"]')
      await page.waitForTimeout(800)
      check.eq('② 点「查看全部」→ 过滤归零（客户端存储里的 `activeGroupId` 真的变 null）', await activeGroupId(page), null)
      check.ok(
        '② 那一行随之出现（新工作区就在这三棵里，之前只是被过滤挡住）',
        (await workspaceRows(page)).includes(WS_BETA),
        JSON.stringify(await workspaceRows(page)),
      )
      check.eq('② 提示消失', (await noticeFacts(page)).present, false)
      check.eq('② 点「查看全部」这一趟零 /api/ 请求（切过滤是本地视图态）', facts.apiCalls.slice(apiBeforeShowAll), [])
      screenshots.push(await shot(page, 'add-workspace-03-show-all'))

      // ---- ③ 过滤生效但新工作区就在该组 → 提示不出现 ----
      await filterTo(page, GROUP_ID)
      await page.evaluate((value: { workspaceId: string; title: string }) => {
        const host = (globalThis as { __LAB_HOST__?: { createdWorkspace: unknown } }).__LAB_HOST__
        if (host !== undefined) host.createdWorkspace = value
      }, { workspaceId: WS_ALPHA, title: 'Lab Alpha' })
      const beforeInGroup = await hostFacts(page)
      await clickAddMenuItem(page, 'workspace-create')
      const afterInGroup = await hostFacts(page)
      check.eq('③ 新工作区在该组里 → 提示不出现（它本来就看得见，没什么要提示的）', (await noticeFacts(page)).present, false)
      check.eq(
        '③ 但「开它的新会话」这一步照旧（提示的有无与「要不要开会话」是两件事）',
        afterInGroup.newSessions.slice(beforeInGroup.newSessions.length),
        [WS_ALPHA],
      )

      check.eq('①②③ 全程零 pageerror', withoutKnownNoise(main.capture.pageErrors).real, [])
      check.eq('①②③ 零 console error', withoutKnownNoise(main.capture.consoleErrors).real, [])
    } finally {
      await main.context.close()
    }

    // ---------------------------------------------------------------------
    // ④ 失败两条路径都要有一行可见反馈（#110 的规矩；原来第一条是静默的）
    // ---------------------------------------------------------------------
    const failing = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), {
      width: 380,
      height: 900,
      dataset: DATASET,
      state: { groups: GROUPS_STATE },
      failCalls: ['vscode.workspaceCreate'],
    })
    const failPage = failing.page
    const failFacts: PageFacts = { apiCalls: [] }
    const failState = {
      pickPath: '/lab/added',
      created: workspaceView(WS_ADDED, '/lab/added', ADDED_TITLE),
      createFails: false,
    }
    await installAddFixtures(failPage, failState, failFacts)
    try {
      // 宿主那条路（＋ 菜单第二项）：假宿主对 `vscode.workspaceCreate` 一律回失败回执。
      await clickAddMenuItem(failPage, 'workspace-create')
      const hostFailure = await flashText(failPage)
      check.ok(
        '④「创建新工作区目录」失败时页面上有一行可见反馈（文案 = 词典那条 + 宿主给的原因，zh / en 任一命中）',
        hasText(hostFailure, '添加工作区失败：lab host: forced failure for vscode.workspaceCreate'),
        `actual=${JSON.stringify(hostFailure)} expected（zh / en 任一）=${JSON.stringify(texts('添加工作区失败：lab host: forced failure for vscode.workspaceCreate'))}`,
      )
      check.eq('④ 这一趟宿主侧一次都没有「请开新会话」（失败就不该往下走）', (await hostFacts(failPage)).newSessions, [])
      screenshots.push(await shot(failPage, 'add-workspace-04-create-failed'))

      // 「选择已有文件夹…」那条路（页面侧那次 `workspaces.create` 回失败）——#176 之前
      // 这里正是那个静默 `.catch(() => {})`。
      failState.createFails = true
      await clickAddMenuItem(failPage, 'workspace-pick')
      const pickFailure = await flashText(failPage)
      check.ok(
        '④「选择已有文件夹…」注册失败时同样有一行可见反馈（原来只会静默吞掉）',
        hasText(pickFailure, '添加工作区失败：'),
        `actual=${JSON.stringify(pickFailure)}`,
      )
      check.ok('④ 两条失败路径的反馈文案不是同一条（各自带上自己那次的原因）', pickFailure !== hostFailure, JSON.stringify({ pickFailure, hostFailure }))
      check.eq('④ 失败后也没有「请开新会话」的调用', (await hostFacts(failPage)).newSessions, [])
      check.eq('④ 零 pageerror（失败由界面接住，不是抛到页面）', withoutKnownNoise(failing.capture.pageErrors).real, [])
      screenshots.push(await shot(failPage, 'add-workspace-05-pick-failed'))
    } finally {
      await failing.context.close()
    }

    // ---------------------------------------------------------------------
    // ⑤ 官方 web 形态（删掉宿主桥那一份）：只添加、不开会话，且一声不响
    // ---------------------------------------------------------------------
    const web = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), {
      width: 380,
      height: 900,
      dataset: DATASET,
      state: { groups: GROUPS_STATE },
    })
    const webPage = web.page
    const webFacts: PageFacts = { apiCalls: [] }
    const webState = {
      pickPath: '/lab/added',
      created: workspaceView(WS_ADDED, '/lab/added', ADDED_TITLE),
      createFails: false,
    }
    await installAddFixtures(webPage, webState, webFacts)
    try {
      // 删掉页面上的宿主调用通道 SDK：`hostCallAvailable()` 读到的是这个全局，删掉之后能力口
      // 走的就是「这一端没有桥」那条路（= 官方 web 侧的处境）。**这一步在这一页最后做。**
      await webPage.evaluate(() => {
        delete (globalThis as { __DSH_ONE_HOST__?: unknown }).__DSH_ONE_HOST__
      })
      await clickAddMenuItem(webPage, 'workspace-pick')
      const webHost = await hostFacts(webPage)
      check.ok('⑤ 没有宿主桥时仍**只添加**：新工作区的行照旧出现在树里', (await workspaceRows(webPage)).includes(WS_ADDED))
      check.eq(
        '⑤ 且**不开会话**：一个 `session.newInWorkspace` 调用都没有（能力缺席 = 少做这一步，不是报错）',
        webHost.newSessions,
        [],
      )
      check.eq('⑤ 第二项「创建新工作区目录」按既有口径不出现（该宿主没有这条能力）', await webPage.evaluate(() => document.querySelectorAll('[data-dshone-tree-item="workspace-create"]').length), 0)
      const warnings = web.capture.consoleWarnings.filter((line) => /newInWorkspace|newSessionInWorkspace|not serve|capabilit/i.test(line))
      check.eq('⑤ 控制台没有能力口那条失败告警（缺席是正常形态，不是失败）', warnings, [])
      check.eq('⑤ 零 console error', withoutKnownNoise(web.capture.consoleErrors).real, [])
      check.eq('⑤ 零 pageerror', withoutKnownNoise(web.capture.pageErrors).real, [])
      check.fact(`⑤ 删桥后这一趟走过的 /api/ 方法：${JSON.stringify(webFacts.apiCalls.slice())}`)
      screenshots.push(await shot(webPage, 'add-workspace-06-no-bridge'))
    } finally {
      await web.context.close()
    }

    return screenshots
  },
}
