/**
 * 会话等待态的状态点（#140）：等提问 / 等审批的会话在侧栏显示**黄点**。
 *
 * 用户实测报的现象是「等提问卡片 / 审批的会话前面显示的是绿点，官方是黄点」。根因在
 * 数据源而不在映射：侧栏树的 `sessionStatuses`（官方同名函数的逐字移植）本来就把
 * `pendingInteraction` 映到 `warning`，但**等待态表在侧栏页里恒空**——官方往里发布
 * 条目只有一条口子（`uiSession.registerPendingInteraction`），而调用它的三件里，
 * `dsh-client-ui-approval` 与 `dsh-client-ui-user-questions` 都被侧栏树的 block list
 * 挡掉了（见 `src/ui/assembly/wireFilter.ts` 的 CHAT_FLOW）。
 *
 * 本套件怎么**确定性地**造出这一态（不能等用户当天恰好有等待会话，那种断言会偶红）：
 * 页面的官方客户端在一条 `$events` 逻辑流上收「转发过来的 Remote 事件」，其中
 * `waterfall` 帧就是 approval/request 与 user-questions/request 的原样投递
 *（`dsh-api-gateway` 客户端 `pumpEvents` 的帧解析；`answer()` 再按 `agentId` 解析出
 * 会话作用域后派发给插件）。所以夹具在页面与网关之间的那条 WebSocket 上做一层代理，
 * 等 `$events` 流就绪后**自己投一帧**——这就是官方那条链路的真实输入，走的是官方
 * 代码，不是我们另造的一套状态。同理，运行中与「跑完还没打开」两态用官方的
 * `api-session/status` 帧驱动（`prev && !running` 那条边会武装完成提醒，见
 * `dsh-api-session-controller` 的 `syncCompletedNotifications`）。
 *
 * 夹具只改**页面收到的帧**：注入的 `eventId` 是网关不知道的，因此页面永远不会把
 * 结果回给网关（取消帧一到，`answer()` 直接在 abort 分支返回，不发 RPC）。全程只读。
 *
 * 判据的两条来源，都在运行期取、不写死：
 * - **官方标记**：`StateDot` 渲染的 `data-state`（官方件原样：`ongoing` 是 8 格矩阵
 *   svg，其余是圆点 span）、行内的读屏文案；
 * - **官方 token**：点的解析色与「同一枚 CSS 变量挂在探针元素上」的解析色比
 *   （`--dsw-alias-state-warn-primary` / `--dsw-static-deepseek-450` /
 *   `--dsw-alias-state-success-primary`），并且与**同一台机器上另开的官方浏览区页**
 *   逐项对照——同一会话、同一种态，两边相等才过。
 *
 * ## 「计数」这一格的事实
 *
 * 等待态在界面上有**两处**看得到，一处官方一层、一处是我们自己加的，别混：
 * - **会话行那枚状态点不带计数**。官方 `SessionStatusDots`（`dsh-client-ui-workspace`）
 *   只渲染一个 `StateDot` + 每条状态一个视觉隐藏的读屏文案（「等待审批 / 等待回答 /
 *   计划待审 / 进行中 / 已完成」这类）；我们那行渲染的是**同一个官方件**、同一种形状。
 * - **工作区行尾的「点 + 计数」是自有功能**（官方工作区行没有这一层，见
 *   `workspaceTree/rows.ts` 的 ActivityBadge）：`data-dshone-tree-activity` 写的是
 *   `运行中/等待中/未读` 三个计数（第三项是 #153 补回来的）、点用官方 `StateDot`
 *   （`ongoing` / `warning` / `done`）、悬停给出「N 个会话运行中 / N 个会话等待交互 /
 *   N 个会话未读」；三个计数都为 0 时整枚角标不渲染（本套件不注未读集合，所以那一项
 *   恒为 0，读数里写出来的第三个 0 就是它）。
 *
 * 本文件末尾那几个夹具（`installEventStreamInjector` / `waitForEventStream` /
 * `waterfall` / `emit` / `expandAllWorkspaces` / `expandOfficialWorkspaces`）导出给
 * F-45（状态点逐案审计，#146）复用：同一份「往官方转发事件流投帧」的机制，两套件各写
 * 一份会漂。F-45 用它把同一种态同时造在自有页与官方对照页上做并排对照。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import type { Page } from 'playwright'
import { emit, installEventStreamInjector, openTreePage, waitForEventStream, type OpenedPage, isText } from './harness.ts'
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

/** 会话行的自有标记（与 F-07 / F-14 用的是同一组）。 */
const SESSION_ROW = '[data-dshone-tree-row="session"]'

/** 三档状态的官方 token 名（颜色一律挂探针比，不写死色值）。 */
const WARN_TOKEN = '--dsw-alias-state-warn-primary'
const ONGOING_TOKEN = '--dsw-static-deepseek-450'
const DONE_TOKEN = '--dsw-alias-state-success-primary'

/** 一帧官方 `$events` 流上的瀑布事件（approval / user-questions 的原始投递）。 */
export function waterfall(event: string, eventId: string, agentId: string, request: Record<string, unknown>): Record<string, unknown> {
  return { type: 'waterfall', event, eventId, agentId, request }
}

// ---------------------------------------------------------------------------
// 观测
// ---------------------------------------------------------------------------

interface DotFacts {
  /** `StateDot` 渲染的 `data-state`（ongoing / warning / done / error / idle）。 */
  state: string | null
  /** 点的形态（官方件：ongoing 是 8 格矩阵 svg，其余是圆点 span）。 */
  tag: string
  /** 矩阵格数与视框（only ongoing）。 */
  cells: number
  viewBox: string | null
  /** 解析出来的 `color`（官方 CSS 就是 `color:var(--dsw-alias-state-*)`）。 */
  color: string
  width: number
  height: number
  /** 点旁边那些视觉隐藏的读屏文案（官方 `visuallyHidden`）。 */
  labels: string[]
}

interface RowFacts {
  id: string
  title: string
  /** 行上的活状态（自有标记：waiting / running / idle）。 */
  status: string
  current: boolean
  dot: DotFacts | null
  /** 行尾那枚自有活状态角标（`data-dshone-tree-activity`，格式 `运行中/等待中/未读`）。 */
  activity: string | null
}

/**
 * 读一页上所有会话行的事实（含状态点与它解析出来的颜色）。
 *
 * 探针元素与点同处一个容器（同一个 CSS 作用域），所以三枚 token 的解析结果就是
 * 点自己那个作用域里的值——不写死色值，也不依赖 token 定义在哪一层。
 */
/** 最近一次读行时顺带量到的 token 解析值（同一次读行里的探针读数，按页存）。 */
const probeCache = new WeakMap<Page, Record<string, string>>()

/** 某页上某枚 token 的解析值（读行时量的；没量过就是空串）。 */
const probeOf = (page: Page, token: string): string => probeCache.get(page)?.[token] ?? ''

async function readRows(page: Page, rowSelector: string, titleSelector: string, tokenHost: string): Promise<RowFacts[]> {
  const value = await page.evaluate(
    ({ rowSel, titleSel, tokenHostSel, tokens }) => {
      const round = (value: number): number => Math.round(value * 100) / 100
      const host = document.querySelector(tokenHostSel)
      const probes = new Map<string, string>()
      if (host !== null) {
        for (const token of tokens) {
          const probe = document.createElement('span')
          probe.style.color = `var(${token})`
          host.appendChild(probe)
          probes.set(token, getComputedStyle(probe).color)
          probe.remove()
        }
      }
      const rows = Array.from(document.querySelectorAll(rowSel)).map((row) => {
        const dot = row.querySelector('[data-state]')
        const dotStyle = dot === null ? null : getComputedStyle(dot)
        const dotRect = dot?.getBoundingClientRect() ?? null
        const title = row.querySelector(titleSel)
        const scope = row.closest('[data-dshone-group-key]') ?? row.parentElement
        return {
          id: row.getAttribute('data-dshone-tree-session') ?? '',
          title: (title?.textContent ?? '').trim(),
          status: row.getAttribute('data-dshone-tree-status') ?? '',
          current: row.getAttribute('aria-selected') === 'true',
          dot:
            dot === null || dotStyle === null || dotRect === null
              ? null
              : {
                  state: dot.getAttribute('data-state'),
                  tag: dot.tagName.toLowerCase(),
                  cells: dot.querySelectorAll('rect').length,
                  viewBox: dot.getAttribute('viewBox'),
                  color: dotStyle.color,
                  width: round(dotRect.width),
                  height: round(dotRect.height),
                  labels: Array.from(row.querySelectorAll('[class*="visuallyHidden"], [class*="VisuallyHidden"]')).map(
                    (element) => (element.textContent ?? '').trim(),
                  ),
                },
          activity:
            scope === null
              ? null
              : (scope.querySelector('[data-dshone-tree-activity]')?.getAttribute('data-dshone-tree-activity') ?? null),
        }
      })
      return { rows, probes: Object.fromEntries(probes) }
    },
    {
      rowSel: rowSelector,
      titleSel: titleSelector,
      tokenHostSel: tokenHost,
      tokens: [WARN_TOKEN, ONGOING_TOKEN, DONE_TOKEN],
    },
  )
  probeCache.set(page, value.probes)
  return value.rows
}

/** 自有树的读行入口（自有标记 + 自有标题类）。 */
const readOwnRows = (page: Page): Promise<RowFacts[]> =>
  readRows(page, SESSION_ROW, '.dshOneTree_title', '[data-shell="dsh-one-sidebar"]')

/** 官方浏览区页的读行入口（官方 hash 类名按后缀配对，标题同样按后缀取）。 */
const readOfficialRows = (page: Page): Promise<RowFacts[]> =>
  readRows(page, '[class*="_sessionRow"]', '[class*="_title"]', '[data-shell="dsh-one-sidebar"]')

/** 等某个读数满足条件（注入帧到界面落定之间有一段异步链：帧 → 插件 → 快照 → 重渲染）。 */
async function waitFor<T>(page: Page, read: () => Promise<T>, predicate: (value: T) => boolean, timeoutMs = 6_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let value = await read()
  while (!predicate(value) && Date.now() < deadline) {
    await page.waitForTimeout(120)
    value = await read()
  }
  return value
}

/** 该行的状态点读数（没有点 = 空闲档不渲染点，与官方 `showsStatusDot` 一致）。 */
const dotOf = (rows: readonly RowFacts[], id: string): DotFacts | null => rows.find((row) => row.id === id)?.dot ?? null

/** 一个点的读数压成一行（报告「观测」里逐态记一条用）。 */
const describeDot = (dot: DotFacts | null): string =>
  dot === null
    ? '不渲染点'
    : `${String(dot.state)}（${dot.tag}${dot.cells > 0 ? ` ${String(dot.cells)} 格` : ''} ${String(dot.width)}×${String(dot.height)} ${dot.color} 文案=${dot.labels.join('|')}）`

/** 展开全部工作区（顶栏那枚折叠/展开全部按钮是纯视图态，不写任何持久状态）。 */
export async function expandAllWorkspaces(page: Page): Promise<void> {
  const collapsed = async (): Promise<string | null> =>
    page.getAttribute('[data-dshone-tree-action="collapse-all"]', 'data-dshone-tree-collapsed')
  await page.click('[data-dshone-tree-action="collapse-all"]')
  await page.waitForTimeout(250)
  if ((await collapsed()) === 'true') {
    await page.click('[data-dshone-tree-action="collapse-all"]')
    await page.waitForTimeout(250)
  }
}

/** 展开官方浏览区的每个工作区（官方行自带 `aria-expanded`，点收起态的行即展开）。 */
export async function expandOfficialWorkspaces(page: Page): Promise<number> {
  const toggled = await page.evaluate(() => {
    let count = 0
    for (const row of Array.from(document.querySelectorAll('[class*="_projectRow"]'))) {
      if (row.getAttribute('aria-expanded') === 'false') {
        ;(row as HTMLElement).click()
        count += 1
      }
    }
    return count
  })
  if (toggled > 0) await page.waitForTimeout(400)
  return toggled
}

// ---------------------------------------------------------------------------
// F-42：会话等待态的状态点
// ---------------------------------------------------------------------------

export const PENDING_DOT_SUITE: LabSuite = {
  id: 'F-43',
  phase: 'new-feature',
  name: '会话等待态的状态点（#140）：等提问 / 等审批 / 计划待审 = 黄点，运行中 = 矩阵，完成 = 绿点',
  expect:
    '侧栏树的等待态**真的由官方那条口子发布**（#140）：往页面的官方转发事件流（`$events`）投官方 `approval/request` / `user-questions/request` 瀑布帧（页面上真出现一条等待中的 interaction），会话行立刻亮**黄点**，`data-state=warning`、解析色 = `--dsw-alias-state-warn-primary`（同一枚 token 挂探针比，不写死色值）、读屏文案是官方那三档（等待审批 / 等待回答 / 计划待审，`plan-review` 由 ui-user-questions 发布、不是 ui-plan）；与**同一台机器上另开的官方浏览区页**投同一条帧，两边同一会话同一种态的 `data-state`、解析色、点几何逐项相等。**取消帧一到就清**（用户在对话区答复之后不会留一个假黄点）。回归三态：空闲档不渲染点（官方 `showsStatusDot` 的口径）、运行中 = 矩阵 svg（颜色 `--dsw-static-deepseek-450`）、跑完还没打开 = `data-state=done`（颜色 `--dsw-alias-state-success-primary`）。另外钉住工作区行尾那枚**自有**活状态角标的两态（#153 起读数写成三档，本套件不注未读集合、所以第三档恒为 0）：等待中 1 个 = `0/1/0`、运行中 1 个 = `1/0/0`（官方工作区行没有这一层）。另有一条 #184 的取用路径断言：根节点写出的 `data-dshone-tree-pending-source`（这一页实际取的是哪一代官方钩子）与页面上那行「等待交互不可用」的可见事实**必居其一**——官方改了钩子名之后页面的表现只是「没有黄点」，与「今天没有等待中的会话」分不出来，没有这条断言就没人发现取用路径断了。全程零 pageerror、零 `slot entry crashed`，夹具只改页面收到的帧（注入的 eventId 网关不知道，页面不回任何结果），网关只读。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const own = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { width: 380, height: 900 })
    const injector = await installEventStreamInjector(own.page)
    const official = await openTreePage(ctx.browser, ctx.lab, route('sidebar-official'), { width: 380, height: 900 })
    const officialInjector = await installEventStreamInjector(official.page)
    try {
      for (const [page, treeRoute] of [
        [own.page, route('sidebar')],
        [official.page, route('sidebar-official')],
      ] as const) {
        await page.reload({ waitUntil: 'domcontentloaded' })
        await page.waitForSelector(treeRoute.readySelector, { timeout: 40_000 })
        await page.waitForTimeout(1_500)
      }
      await expandAllWorkspaces(own.page)
      const expandedOfficial = await expandOfficialWorkspaces(official.page)

      check.ok(
        '注入通道就绪：页面的官方转发事件流（`$events`）连上并收到 ready 帧',
        await waitForEventStream(injector, own.page),
        JSON.stringify(injector.stats()),
      )
      check.fact(`夹具见过的 mux 端点：${injector.stats().endpoints.join(', ')}`)
      const baselineConnections = injector.stats().connections
      check.ok(
        '官方对照档的注入通道同样就绪',
        await waitForEventStream(officialInjector, official.page),
        JSON.stringify(officialInjector.stats()),
      )

      // ---- 挑目标行 ----
      // 三条约束：① 不是当前会话（官方完成提醒那条 run→idle 边只在非当前会话上武装）；
      // ② 基线上没有状态点（空闲档官方就不渲染点，「黄点凭空出现」是最干净的信号）；
      // ③ **官方对照档里也看得见同一行**（官方件不写任何 data 属性，只能按标题认，
      //    所以标题必须在官方页里唯一）——并排对照要成立，这一条不能松。
      const officialRows0 = await readOfficialRows(official.page)
      check.fact(`官方对照档：展开 ${String(expandedOfficial)} 个工作区后渲染 ${String(officialRows0.length)} 条会话行`)
      const baseline = await readOwnRows(own.page)
      check.ok('侧栏树渲染出会话行（挑目标行才有意义）', baseline.length > 0, `rows=${String(baseline.length)}`)
      /**
       * #184：等待态这条依赖的取用路径必须有交代——要么按官方的名字取到（根节点写出
       * 是哪一代钩子），要么页面上有那行「等待交互不可用」的可见事实。两者**必居其一、
       * 不许都无**：官方改了钩子名之后，页面的表现只是「没有黄点」，与「今天没有等待中
       * 的会话」长得一模一样，没有这条断言就没人发现取用路径已经断了。
       */
      const pendingWiring = await own.page.evaluate(() => {
        const root = document.querySelector('[data-dshone-tree="root"]')
        return {
          source: root?.getAttribute('data-dshone-tree-pending-source') ?? null,
          notice: root?.querySelector('[data-dshone-tree="pending-unavailable"]') !== null,
        }
      })
      const sourceNames = ['sessionStatus', 'sessionPendingInteraction']
      check.ok(
        '等待交互取用路径有交代：按官方名字取到，或页面上有那行可见事实（#184，不许静默）',
        sourceNames.includes(pendingWiring.source ?? '') !== pendingWiring.notice,
        `data-dshone-tree-pending-source=${String(pendingWiring.source)} 通知行=${String(pendingWiring.notice)}`,
      )
      const uniqueOfficialTitles = new Set(
        officialRows0.filter((row) => row.title !== '' && officialRows0.filter((other) => other.title === row.title).length === 1).map((row) => row.title),
      )
      const candidates = baseline.filter(
        (row) => !row.current && row.id !== '' && row.title !== '' && uniqueOfficialTitles.has(row.title),
      )
      check.ok(
        '两侧都看得见、标题在官方页里唯一的非当前会话行存在（并排对照与完成提醒都需要它）',
        candidates.length > 0,
        `candidates=${String(candidates.length)} ownRows=${String(baseline.length)} officialRows=${String(officialRows0.length)}`,
      )
      const target = candidates.find((row) => row.dot === null) ?? candidates[0]
      if (target === undefined) throw new Error('lab: no candidate session row')
      check.fact(`目标会话：${target.id.slice(0, 8)}「${target.title}」基线的点=${JSON.stringify(target.dot)} 行状态=${target.status}`)
      check.eq('空闲档不渲染状态点（官方 `showsStatusDot`：done 且没有完成提醒就没有点）', target.dot, null)
      /** 官方对照档里同一会话那一行（按标题认，见上面第三条约束）。 */
      const officialTarget = (): Promise<RowFacts | undefined> =>
        readOfficialRows(official.page).then((rows) => rows.find((row) => row.title === target.title))

      // ---- ① 等审批 → 黄点 ----
      const approvalId = 'lab-approval-1'
      injector.push(
        waterfall('approval/request', approvalId, target.id, { toolName: 'bash', callId: 'lab-call-1', reason: 'lab fixture' }),
      )
      const afterApproval = await waitFor(
        own.page,
        () => readOwnRows(own.page),
        (rows) => dotOf(rows, target.id)?.state === 'warning',
      )
      const approvalRow = afterApproval.find((row) => row.id === target.id)
      const approvalDot = dotOf(afterApproval, target.id)
      check.fact(`等审批：${JSON.stringify(approvalDot)} 行状态=${approvalRow?.status ?? ''} 角标=${approvalRow?.activity ?? '无'}`)
      check.eq('等审批：行的活状态是 waiting', approvalRow?.status, 'waiting')
      check.eq('等审批：状态点 data-state=warning', approvalDot?.state, 'warning')
      check.eqTexts('等审批：点旁边那条读屏文案是官方那一档（等待审批）', approvalDot?.labels, ['等待审批'])
      const warnProbe = probeOf(own.page, WARN_TOKEN)
      check.ok('等审批：解析色 = 官方 `--dsw-alias-state-warn-primary`（同一枚 token 挂探针比）', approvalDot?.color === warnProbe && warnProbe !== '', `dot=${String(approvalDot?.color)} probe=${warnProbe}`)
      screenshots.push(await shot(ctx, own.page, 'pending-dot-approval'))

      // ---- ② 取消帧一到就清（用户在对话区答复之后不留假黄点） ----
      injector.push({ type: 'cancel', eventId: approvalId })
      const afterCancel = await waitFor(
        own.page,
        () => readOwnRows(own.page),
        (rows) => dotOf(rows, target.id)?.state !== 'warning',
      )
      check.eq('答复/取消之后点就清掉（不留假黄点）', dotOf(afterCancel, target.id)?.state ?? null, null)

      // ---- ③ 等提问 → 黄点（同一枚 token，另一档文案） ----
      const questionId = 'lab-question-1'
      injector.push(
        waterfall('user-questions/request', questionId, target.id, {
          questions: [{ question: 'lab fixture question', header: 'lab', options: [{ label: 'yes' }, { label: 'no' }, { label: 'other' }] }],
        }),
      )
      const afterQuestion = await waitFor(
        own.page,
        () => readOwnRows(own.page),
        (rows) => dotOf(rows, target.id)?.state === 'warning',
      )
      check.eq('等提问：状态点 data-state=warning', dotOf(afterQuestion, target.id)?.state, 'warning')
      check.eqTexts('等提问：读屏文案是官方那一档（等待回答）', dotOf(afterQuestion, target.id)?.labels, ['等待回答'])
      check.ok(
        '等提问：解析色同样是 `--dsw-alias-state-warn-primary`（四个状态点共用同一档色）',
        dotOf(afterQuestion, target.id)?.color === warnProbe,
        `dot=${String(dotOf(afterQuestion, target.id)?.color)}`,
      )
      check.eq('等提问：工作区行尾的自有角标是「等待中 1」= 0/1/0', afterQuestion.find((row) => row.id === target.id)?.activity, '0/1/0')

      // ---- ④ 计划待审（plan-review 是 user-questions 发的第二档，不是 ui-plan） ----
      injector.push({ type: 'cancel', eventId: questionId })
      await waitFor(
        own.page,
        () => readOwnRows(own.page),
        (rows) => dotOf(rows, target.id)?.state !== 'warning',
      )
      injector.push(
        waterfall('user-questions/request', 'lab-question-plan', target.id, {
          questions: [
            {
              question: 'lab fixture plan review',
              detail: 'lab fixture plan body',
              multiSelect: false,
              options: [{ label: 'approve' }, { label: 'decline' }],
              intent: { kind: 'plan-review', approve: 'approve' },
            },
          ],
        }),
      )
      const afterPlan = await waitFor(
        own.page,
        () => readOwnRows(own.page),
        (rows) => dotOf(rows, target.id)?.state === 'warning',
      )
      check.eq('计划待审：状态点 data-state=warning', dotOf(afterPlan, target.id)?.state, 'warning')
      check.eqTexts('计划待审：读屏文案是官方那一档（计划待审）', dotOf(afterPlan, target.id)?.labels, ['计划待审'])
      check.ok(
        '计划待审：解析色仍是 `--dsw-alias-state-warn-primary`（三档等待态共用同一档色）',
        dotOf(afterPlan, target.id)?.color === probeOf(own.page, WARN_TOKEN),
        `dot=${String(dotOf(afterPlan, target.id)?.color)}`,
      )
      // 「materialize 一个会话 scope 不会顺手给侧栏页拉起会话级流」这条只记事实、不判：
      // 页面的 mux 在连接抖动时也会多发一条 socket，判死会偶红；注入等待态这件事本身
      // 有没有副作用，看这条读数即可（本机实测注入前后都是四条连接、四类端点）。
      check.fact(
        `注入等待态前后的 mux 连接数：${String(baselineConnections)} → ${String(injector.stats().connections)}；端点种类 ${injector.stats().endpoints.join(', ')}`,
      )
      injector.push({ type: 'cancel', eventId: 'lab-question-plan' })
      await waitFor(
        own.page,
        () => readOwnRows(own.page),
        (rows) => dotOf(rows, target.id)?.state !== 'warning',
      )

      // ---- ⑤ 运行中 → 矩阵（官方件：8 格 svg + 一格一格追的动画） ----
      injector.push(emit('api-session/status', [target.id, true]))
      const afterRunning = await waitFor(
        own.page,
        () => readOwnRows(own.page),
        (rows) => dotOf(rows, target.id)?.state === 'ongoing',
      )
      const runningDot = dotOf(afterRunning, target.id)
      check.eq('开启会话运行：行的活状态是 running', afterRunning.find((row) => row.id === target.id)?.status, 'running')
      check.eq('运行中：状态点 data-state=ongoing', runningDot?.state, 'ongoing')
      check.eq('运行中：渲染的是官方矩阵件（svg / 8 格 / 10×10 视框）', [runningDot?.tag, runningDot?.cells, runningDot?.viewBox], ['svg', 8, '0 0 10 10'])
      const ongoingProbe = probeOf(own.page, ONGOING_TOKEN)
      check.ok(
        '运行中：解析色 = `--dsw-static-deepseek-450`（同一枚 token 挂探针比）',
        runningDot?.color === ongoingProbe && ongoingProbe !== '',
        `dot=${String(runningDot?.color)} probe=${ongoingProbe}`,
      )
      check.eq('运行中：工作区行尾的自有角标是「运行中 1」= 1/0/0', afterRunning.find((row) => row.id === target.id)?.activity, '1/0/0')
      screenshots.push(await shot(ctx, own.page, 'pending-dot-running'))

      // ---- ⑥ 跑完还没打开 → 绿点（官方完成提醒：run→idle 那条边只在非当前会话上武装） ----
      injector.push(emit('api-session/status', [target.id, false]))
      const afterDone = await waitFor(
        own.page,
        () => readOwnRows(own.page),
        (rows) => dotOf(rows, target.id)?.state === 'done',
      )
      const doneDot = dotOf(afterDone, target.id)
      check.fact(`跑完还没打开：${JSON.stringify(doneDot)} 角标=${afterDone.find((row) => row.id === target.id)?.activity ?? '无'}`)
      check.eq('跑完还没打开：状态点 data-state=done', doneDot?.state, 'done')
      const doneProbe = probeOf(own.page, DONE_TOKEN)
      check.ok(
        '跑完还没打开：解析色 = `--dsw-alias-state-success-primary`（同一枚 token 挂探针比）',
        doneDot?.color === doneProbe && doneProbe !== '',
        `dot=${String(doneDot?.color)} probe=${doneProbe}`,
      )
      check.ok(
        '跑完还没打开：读屏文案是官方那一档（已完成）',isText(doneDot?.labels[0], '已完成'),
        JSON.stringify(doneDot?.labels),
      )
      check.eq('跑完还没打开：三个计数都归零时那枚角标整枚不渲染（与「等待中 1」那一态对照）', afterDone.find((row) => row.id === target.id)?.activity ?? null, null)
      screenshots.push(await shot(ctx, own.page, 'pending-dot-done'))

      // 六个读数压成一组观测（报告是给人看的：这里的每一条都是界面上的实测值）。
      check.fact('同一行六态实测（`state` 属性 / 形态 / 尺寸 / 解析色 / 读屏文案）——')
      check.fact(`　空闲（基线）：${describeDot(target.dot)}`)
      check.fact(`　等审批：${describeDot(approvalDot)}；行状态 waiting；工作区行尾角标 ${approvalRow?.activity ?? '无'}`)
      check.fact(`　等提问：${describeDot(dotOf(afterQuestion, target.id))}；工作区行尾角标 ${afterQuestion.find((row) => row.id === target.id)?.activity ?? '无'}`)
      check.fact(`　计划待审：${describeDot(dotOf(afterPlan, target.id))}`)
      check.fact(`　运行中：${describeDot(runningDot)}；行状态 running；工作区行尾角标 ${afterRunning.find((row) => row.id === target.id)?.activity ?? '无'}`)
      check.fact(`　跑完还没打开：${describeDot(doneDot)}；工作区行尾角标 ${afterDone.find((row) => row.id === target.id)?.activity ?? '无（三个计数都归零，整枚角标不渲染）'}`)

      // ---- ⑦ 与官方浏览区页并排：同一会话、同一种态 ----
      {
        const before = await officialTarget()
        check.fact(`官方对照档目标行（未注入）：${JSON.stringify(before === undefined ? null : { title: before.title, status: before.status, dot: before.dot })}`)
        const sideId = 'lab-approval-side-by-side'
        injector.push(waterfall('approval/request', sideId, target.id, { toolName: 'bash', reason: 'lab fixture side by side' }))
        officialInjector.push(waterfall('approval/request', sideId, target.id, { toolName: 'bash', reason: 'lab fixture side by side' }))
        const ownSide = await waitFor(
          own.page,
          () => readOwnRows(own.page),
          (rows) => dotOf(rows, target.id)?.state === 'warning',
        )
        const officialSide = await waitFor(
          official.page,
          () => readOfficialRows(official.page),
          (rows) => (rows.find((row) => row.title === target.title)?.dot?.state ?? null) === 'warning',
        )
        const ownDot = dotOf(ownSide, target.id)
        const officialDot = officialSide.find((row) => row.title === target.title)?.dot ?? null
        check.ok('并排：官方页的同一会话也亮了黄点（证明这是官方那条链路，不是我们另造的）', officialDot !== null, JSON.stringify(officialDot))
        check.eq('并排：两侧 `data-state` 相等', ownDot?.state, officialDot?.state)
        check.eq('并排：两侧解析色相等（同一种态同一种色）', ownDot?.color, officialDot?.color)
        check.eq('并排：两侧点的几何相等（官方同一个 StateDot 件）', [ownDot?.width, ownDot?.height], [officialDot?.width, officialDot?.height])
        check.eq('并排：两侧读屏文案相等', ownDot?.labels, officialDot?.labels)
        screenshots.push(await shot(ctx, own.page, 'pending-dot-side-by-side-own'))
        screenshots.push(await shot(ctx, official.page, 'pending-dot-side-by-side-official'))
        check.eq('对照档零 pageerror', official.capture.pageErrors, [])
      }

      check.eq('自有页零 pageerror', own.capture.pageErrors, [])
      const crashed = [...own.capture.consoleErrors, ...own.capture.consoleWarnings].filter((line) => /slot entry crashed|chain selector crashed|did not activate/.test(line))
      check.eq('自有页零槽位崩溃 / 零装载未激活（放行官方两件没带出契约缺口）', crashed, [])
    } finally {
      await official.context.close()
      await own.context.close()
    }
    return screenshots
  },
}
