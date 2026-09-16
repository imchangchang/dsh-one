/**
 * 会话行点击的「宿主真的开着它吗」（#121）。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与 `driftSuites.ts` / `recycleEntrySuites.ts`
 * 同一条：那个文件是本批开发的合入热点，新套件放外面能少一半冲突面。注册方式是在
 * `suites.ts` 的 `SUITES` 末尾追加一项。
 *
 * 本套件验的是**判据**，不是新的界面：起点是用户报的现场——刚启动时点一条会话行，它直接
 * 进了就地改名（说明侧栏认为它是「当前」），但右边对话区一直不出来（编辑器区还是
 * Welcome）。根因是两件事不同步：侧栏的「当前」判据是官方 sessions 服务的 `list.current`
 * （启动时可能是官方恢复的上次会话），而**宿主侧真的开着哪个对话面板**是另一回事；#115
 * 把「点当前会话 = 就地改名」定成语义之后，这个不同步就被固化成「再也点不出对话区」。
 *
 * 所以本套件用**假宿主**控制两种回执（`__LAB_HOST__.panelSession`：true = 宿主说这条会话
 * 开着，false = 宿主说没开），把四条路都走一遍：
 * ① 宿主说**未打开** + 点当前会话 → 发出打开请求、**不进**编辑态；
 * ② 宿主说**已打开** + 点当前会话 → 进编辑态（#115 的语义不变）；
 * ③ 宿主说**未打开** + 点**非当前**会话 → 打开（原样，且根本不问宿主这条能力）；
 * ④ 页面**没有宿主桥**（= 官方 web 那一侧的处境）→ 能力口返回 false、不抛错：当前会话行
 *    按打开处理、页面零报错。
 *
 * 数据面与其它套件一致（真网关**只读** + 假宿主）：本套件不提交改名、不点归档确认，
 * `session.openPanel` 只在假宿主里记录（真宿主那一步是开/聚焦对话面板）。④ 把页面上的
 * `__DSH_ONE_HOST__` 删掉来造「没有桥」的处境——**这一步在套件最后做**（删掉之后其余
 * 依赖宿主能力的断言就不成立了）。
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

/** 把收缩着的分组全展开（只动本地展开态，不写网关）。 */
async function expandAllGroups(page: OpenedPage['page']): Promise<void> {
  await page.evaluate(() => {
    for (const row of Array.from(document.querySelectorAll('[data-dshone-tree-row="workspace"]'))) {
      if (row.getAttribute('aria-expanded') !== 'true') (row as HTMLElement).click()
    }
  })
  await page.waitForTimeout(400)
}

/** 一行的现状（标题 / 当前标记 / 行内改名输入框）。 */
interface RowFacts {
  exists: boolean
  title: string
  current: boolean
  renaming: boolean
  hasInput: boolean
  value: string
  focused: boolean
}

async function rowFacts(page: OpenedPage['page'], sessionId: string): Promise<RowFacts> {
  return page.evaluate((id: string) => {
    const row = document.querySelector(`[data-dshone-tree-session="${id}"]`)
    const field = (row === null ? null : row.querySelector('[data-dshone-tree-rename="input"]')) as HTMLInputElement | null
    return {
      exists: row !== null,
      title: (row?.querySelector('.dshOneTree_title')?.textContent ?? '').trim(),
      current: row?.getAttribute('aria-selected') === 'true',
      renaming: row?.getAttribute('data-dshone-tree-renaming') === 'true',
      hasInput: field !== null,
      value: field?.value ?? '',
      focused: field !== null && document.activeElement === field,
    }
  }, sessionId)
}

/** 假宿主侧关于 #121 两条能力的观测值（查询了哪些会话、请宿主亮过哪些会话）。 */
interface PanelHostFacts {
  panelSession: unknown
  panelQueries: string[]
  panelsOpened: string[]
  /** 两条能力各被调用过几次（`session.inPanel` / `session.openPanel`）。 */
  inPanelCalls: number
  openPanelCalls: number
  /**
   * 选择桥（`sessionBridgePlugin`）上报过 `dshOne.sessionSelected` 的会话 id。
   * 那条消息就是**官方那条打开通路**（真宿主收到它才去开/切面板），本套件用它证明
   * 「非当前会话」那条路照旧有效，而在「已经是当前会话」时它根本不会发声——这正是
   * 用户报的 bug 的机制，也是必须新增 `session.openPanel` 这条能力的原因。
   */
  selectedReports: string[]
}

async function panelHostFacts(page: OpenedPage['page']): Promise<PanelHostFacts> {
  return page.evaluate(() => {
    const host = (globalThis as {
      __LAB_HOST__?: {
        panelSession?: unknown
        panelQueries: string[]
        panelsOpened: string[]
        hostCalls: { call: string }[]
        sent: { type?: unknown; sessionId?: unknown }[]
      }
    }).__LAB_HOST__
    if (host === undefined) {
      return { panelSession: null, panelQueries: [], panelsOpened: [], inPanelCalls: -1, openPanelCalls: -1, selectedReports: [] }
    }
    return {
      panelSession: host.panelSession,
      panelQueries: host.panelQueries.slice(),
      panelsOpened: host.panelsOpened.slice(),
      inPanelCalls: host.hostCalls.filter((call) => call.call === 'session.inPanel').length,
      openPanelCalls: host.hostCalls.filter((call) => call.call === 'session.openPanel').length,
      selectedReports: host.sent
        .filter((message) => message.type === 'dshOne.sessionSelected' && typeof message.sessionId === 'string')
        .map((message) => String(message.sessionId)),
    }
  })
}

/** 让假宿主如实回「这条会话没开在面板里」（#121 要造的现场）。 */
async function setHostPanelSession(page: OpenedPage['page'], open: boolean): Promise<void> {
  await page.evaluate((value: boolean) => {
    const host = (globalThis as { __LAB_HOST__?: { panelSession: unknown } }).__LAB_HOST__
    if (host !== undefined) host.panelSession = value
  }, open)
}

export const RENAME_OPEN_SYNC_SUITE: LabSuite = {
  id: 'F-28',
  phase: 'new-feature',
  name: '会话行点击的「宿主真的开着它吗」（#121，RENAME-OPEN-SYNC 套件）',
  expect:
    '侧栏树在真实装配页上（真网关**只读** + 假宿主控制「宿主说开了 / 没开」两种回执）：① 宿主说**未打开**时点**当前**会话行 → 树**发出打开请求**（假宿主收到一条 `session.openPanel`，会话 id 就是这一行；此前树还问过一次 `session.inPanel`，问的也是这一行），且**不进编辑态**（树上没有任何行内改名输入框）——这正是用户报的现场修好之后的样子；② 宿主说**已打开**时点**当前**会话行 → **进编辑态**（行变输入框、prefill = 原标题、焦点在输入框上），#115 的「点当前会话 = 就地改名」语义原样保留；③ 宿主说**未打开**时点**非当前**会话行 → 照旧是**打开**（当前标记落到它身上、不进编辑态），且这条路**根本不问**宿主这条能力（`session.inPanel` / `session.openPanel` 的调用次数都不动）；④ 页面**没有宿主桥**（= 官方 web 那一侧的处境，删掉页面上的 `__DSH_ONE_HOST__` 造出来）→ 能力口返回 false、**不抛错**：当前会话行按打开处理（不进编辑态）、不发出任何宿主调用、控制台没有那条失败告警、零 pageerror。全程零 pageerror，本套件不写网关（`session.openPanel` 只在假宿主里记录，不提交改名）。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const shot = async (page: OpenedPage['page'], name: string): Promise<string> => {
      const file = path.join(ctx.shots, `${name}.png`)
      await fsp.mkdir(ctx.shots, { recursive: true })
      await page.screenshot({ path: file })
      return file
    }

    const opened = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { width: 380, height: 900 })
    const { page } = opened
    try {
      await expandAllGroups(page)

      // ---- 夹具：一条**非当前**、有标题的会话行（拿来点；点一次就变成当前）----
      const fixture = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('[data-dshone-tree-row="session"]'))
          .map((row) => ({
            id: row.getAttribute('data-dshone-tree-session') ?? '',
            title: (row.querySelector('.dshOneTree_title')?.textContent ?? '').trim(),
            current: row.getAttribute('aria-selected') === 'true',
          }))
          .filter((row) => row.id !== '' && row.title !== '')
        return {
          total: rows.length,
          current: rows.find((row) => row.current)?.id ?? null,
          other: rows.find((row) => !row.current) ?? null,
        }
      })
      check.fact(
        `夹具：有标题的会话行 ${String(fixture.total)} 条；打开时已有当前会话=${JSON.stringify(fixture.current)}；拿来点的非当前会话行=${JSON.stringify(fixture.other?.id ?? null)}（${JSON.stringify(fixture.other?.title ?? null)}）`,
      )
      check.ok('页面上有一条**非当前**的会话行可点（有标题）', fixture.total > 0 && fixture.other !== null)
      if (fixture.other === null) return screenshots
      const targetId = fixture.other.id
      const targetTitle = fixture.other.title
      const rowSel = `[data-dshone-tree-session="${targetId}"]`

      // 「宿主说这条会话没开在面板里」——用户报的现场就是这个形状：侧栏认为它是当前
      //（或即将成为当前），宿主侧却没有它的面板。
      await setHostPanelSession(page, false)

      // ---- ③ 宿主说未打开 + 点非当前会话 → 打开（原样；这条路不问宿主这条能力）----
      const beforeOpen = await panelHostFacts(page)
      await page.click(rowSel)
      await page.waitForTimeout(500)
      const afterOpenRow = await rowFacts(page, targetId)
      const afterOpenHost = await panelHostFacts(page)
      check.ok('③ 非当前会话点击 → 打开：这一行变成当前会话行', afterOpenRow.current)
      check.eq('③ 且不进编辑态（树上没有任何行内改名输入框）', await page.evaluate(() => document.querySelectorAll('[data-dshone-tree-rename="input"]').length), 0)
      check.eq('③ 全树当前标记恰好一行', await page.evaluate(() => document.querySelectorAll('[data-dshone-tree-row="session"][aria-selected="true"]').length), 1)
      check.eq(
        '③ 这条路不问宿主「开在面板里吗」（非当前会话的打开通路原样：走官方 sessions.open）',
        [afterOpenHost.inPanelCalls - beforeOpen.inPanelCalls, afterOpenHost.openPanelCalls - beforeOpen.openPanelCalls],
        [0, 0],
      )
      check.eq(
        '③ 官方那条通路真的报了「打开这条会话」（选择桥发出 `dshOne.sessionSelected`，真宿主据此开/切面板）',
        afterOpenHost.selectedReports.slice(beforeOpen.selectedReports.length),
        [targetId],
      )
      screenshots.push(await shot(page, 'rename-open-03-noncurrent-open'))

      // ---- ① 宿主说未打开 + 点当前会话 → 发打开请求、不进编辑态（本 bug 的正面）----
      const beforeAsking = await panelHostFacts(page)
      await page.click(rowSel)
      await page.waitForTimeout(500)
      const afterAskRow = await rowFacts(page, targetId)
      const afterAskHost = await panelHostFacts(page)
      check.ok(
        '① 宿主说未打开 + 点当前会话 → 树确实问了宿主（`session.inPanel` 被调一次，问的就是这一行）',
        afterAskHost.inPanelCalls - beforeAsking.inPanelCalls === 1 && afterAskHost.panelQueries.at(-1) === targetId,
        JSON.stringify({ delta: afterAskHost.inPanelCalls - beforeAsking.inPanelCalls, asked: afterAskHost.panelQueries.at(-1) }),
      )
      check.eq(
        '① 发出打开请求：假宿主收到恰好一条 `session.openPanel`，会话 id 就是这一行',
        afterAskHost.panelsOpened.slice(beforeAsking.panelsOpened.length),
        [targetId],
      )
      check.ok('① 不进编辑态：这一行没有变成输入框（行上也没有 renaming 标记）', !afterAskRow.hasInput && !afterAskRow.renaming)
      check.eq('① 全树没有任何行内改名输入框（整棵树都没进编辑态）', await page.evaluate(() => document.querySelectorAll('[data-dshone-tree-rename="input"]').length), 0)
      check.ok('① 这一行仍是当前会话行（打开请求发的是「这条会话」，没有顺手切走）', afterAskRow.current)
      check.eq(
        '① 根因证据：这条会话已经是「当前」，官方 sessions.open 不会让值变化，选择桥因此一声不响（零新增 `dshOne.sessionSelected`）——面板出不来的机制就在这里，也正是必须新增 `session.openPanel` 的原因',
        afterAskHost.selectedReports.slice(beforeAsking.selectedReports.length),
        [],
      )
      check.fact(`① 假宿主的面板状态被打开请求翻成：${JSON.stringify(afterAskHost.panelSession)}（真宿主做完这件事之后确实如此）`)
      screenshots.push(await shot(page, 'rename-open-01-open-not-in-panel'))

      // ---- ② 宿主说已打开 + 点当前会话 → 进编辑态（#115 的语义不变）----
      await setHostPanelSession(page, true)
      const beforeRename = await panelHostFacts(page)
      await page.click(rowSel)
      await page.waitForTimeout(400)
      const editing = await rowFacts(page, targetId)
      check.ok('② 宿主说已打开 + 点当前会话 → 这一行就地变成输入框（#115 的语义不变）', editing.hasInput && editing.renaming)
      check.eq('② prefill = 这一行的原标题', editing.value, targetTitle)
      check.ok('② 输入框已经拿到焦点（点完就能直接打字）', editing.focused)
      check.eq(
        '② 进编辑态这一路没有发出任何打开请求（宿主说开着，就不该再开）',
        (await panelHostFacts(page)).openPanelCalls - beforeRename.openPanelCalls,
        0,
      )
      screenshots.push(await shot(page, 'rename-open-02-edit-in-panel'))
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
      check.ok('② 收尾：Esc 退出编辑态（不留半开的输入框给后面看）', !(await rowFacts(page, targetId)).renaming)

      // ---- ④ 没有宿主桥（官方 web 那一侧的处境）→ 返回 false、不抛错 ----
      // 删掉页面上的能力桥 SDK：`hostCallAvailable()` 读到的是这个全局，删掉之后能力口
      // 走的就是「这一端没有桥」那条路（= 官方 web 侧）。这一步在套件最后做。
      const beforeNoBridge = await panelHostFacts(page)
      await page.evaluate(() => {
        delete (globalThis as { __DSH_ONE_HOST__?: unknown }).__DSH_ONE_HOST__
      })
      await page.click(rowSel)
      await page.waitForTimeout(500)
      const noBridgeRow = await rowFacts(page, targetId)
      const afterNoBridge = await panelHostFacts(page)
      check.ok('④ 没有桥时点当前会话 → 按打开处理（不进编辑态），不是抛错也不是没反应', !noBridgeRow.hasInput && !noBridgeRow.renaming)
      check.eq(
        '④ 没有桥时一个宿主调用都不发（能力口在那一端直接短路，不去打一条必然失败的路）',
        [afterNoBridge.inPanelCalls - beforeNoBridge.inPanelCalls, afterNoBridge.openPanelCalls - beforeNoBridge.openPanelCalls],
        [0, 0],
      )
      const panelWarnings = opened.capture.consoleWarnings.filter((line) => /session panel state/.test(line))
      check.eq(
        '④ 没有桥不算「失败」：控制台没有能力口那条「问不到面板状态」的告警（真抛错才会留它）',
        panelWarnings,
        [],
      )
      check.eq(
        '④ 没有桥时也不抛错到控制台：零 console error',
        withoutKnownNoise(opened.capture.consoleErrors).real,
        [],
      )
      check.fact(`④ 删桥前后的页面告警数：${String(opened.capture.consoleWarnings.length)}（其中面板状态告警 ${String(panelWarnings.length)} 条）`)

      check.eq('本套件全程零 pageerror', withoutKnownNoise(opened.capture.pageErrors).real, [])
    } finally {
      await opened.context.close()
    }
    return screenshots
  },
}
