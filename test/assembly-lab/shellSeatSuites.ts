/**
 * 壳座位对账（#248，F-75）——把「官方页面住在某个壳里、我们接管了壳却没给落点」这一类
 * 静默失效变成一条常驻判据。
 *
 * ## 为什么要有这一条（#248 的现场）
 *
 * 官方有些页 / 弹层 / 全局面板住在某个「壳」里（`main` / `sidebar.panellist` /
 * `settings.section` / `shell.overlay` / `rightbar` / `plugins.item` 这一族，全表与出处见
 * `shellSeats.ts`）。装配换掉某个壳、或者某件载体插件被下线之后，坏法有两种、**两种都不报错**：
 *
 * - **座没声明**：官方 `slots.inject` 的回调永不跑（官方语义是等，不是抛），能力静默消失。
 *   现场实例：侧栏「插件」那一行点了什么都不发生、插件页本体与它三个子座上的四张官方配置卡
 *   在 VS Code 侧一个入口都没有（#247，已修）；官方设置弹层那条触发条同样停车。
 * - **座声明了但没人渲染**：贡献注册成功、也占着座，页面上永远看不到。现场实例：官方设置
 *   弹层那两条 onboarding（座上有人、页面上永远不出现）。
 *
 * 这两件事原来只能靠用户点到才发现（#247 就是用户报的）。F-01 CONTRACT 抓不到：它判的是
 * 「有没有崩溃 / 锚点在不在」——座没声明时锚点本来就不该在，它不红；F-10 FIBER 也抓不到
 * （停车不抛错、没有 fiber 失败）。所以这一条**按座对账**：官方页与四棵树各读一次
 * `ctx.slots.snapshot()`，逐座比「声明了没有 / 座上有没有人 / 页面上渲染出来了没有」。
 *
 * ## 三条判据（判的都是「有没有落点」，不是「长得对不对」）
 *
 * ① **官方页有、本树既没声明也没占位**的壳座，必须落在 `shellSeats.ts` 的白名单里
 *    （白名单每条带一句「为什么这是有意收敛」）。这一条抓的是「官方把页搬进 / 新增一处壳，
 *    而我们什么都不知道」——按 id 盯的清单抓不到这种形状（0.1.7 把取消归档搬进被 shadow 的
 *    `sidebar.workspaces`，一个插件都没新增）。
 * ② **本树声明了、座上也有人、页面上却零渲染节点**的壳座，同样必须落在白名单里。
 *    这一条抓的是「注册成功了但内容进不来」（c-ii 档）。
 * ③ **设置页 onboarding 的正面判据**（#249 起）：`settings.onboarding` 座上那两条官方
 *    onboarding 的形态是 **body 级 portal 的模态框**（官方 `OnboardingModal` 用官方 `Modal`
 *    原语 `createPortal(..., document.body)`），锚点里永远不会有节点——判 ② 那一份读数
 *    看不见它们，所以除了白名单那档 `lazy`，另有一段正面判据：座上就是那两条、锚点按壳
 *    自己的游标在场、游标非空时那一步真的画在 `document.body` 下且归属得上这个座
 *    （归属沿 React fiber 的 `return` 链读，见 `shellSeats.ts` 的 `readPortals`）。
 *    判的是机制，不是「这一轮必须出现某一条」——那两条显不显示由官方组件按自己的状态决定。
 *
 * 判 ② 时要「座上也有人」：一处空的 list 座本来就没内容可丢，那不是缺陷。渲染面按
 * **锚点 + 里面的元素或文字**读（官方插件页那四张卡的摘要是文字节点、不是元素，只数元素会
 * 误判成空座）。
 *
 * ## 不吃当天数据
 *
 * 只扫 `shellSeats.ts` 里那份**壳座表**（root 级的页 / 弹层 / 面板座）。会话级 / 数据级的
 * 座（`conversation.*` / `tool.call.*`：内容随当天有没有会话、有没有交付物变）不进判据，
 * 只作为事实记下——那类座的渲染面是「当天的活儿」决定的，拿它判红是假红。
 *
 * ## 同一条读数还喂 F-54 的壳上入口扫描（#248 的 P3）
 *
 * 「壳上渲染出来的条目有没有可点入口、点了有没有反应」由 F-54 判（`livenessSuites.ts` 的
 * 壳座扫描那一段用的是同一份 `markSeatEntries` 读数与同一份白名单）。本套件把每个座里
 * 渲染出来的条目与它们的第一枚可点元素逐条记进事实，两份读数对得上（同一套页内标记）。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import type { BrowserContext, Page } from 'playwright'
import { capturePage, fiberProbeScript, openTreePage, type Check } from './harness.ts'
import { LAB_TREES, type LabTreeRoute } from './labServer.ts'
import { cookieHeader } from '../../src/server/assemblyMirror.ts'
import {
  SHELL_SEATS,
  describePortal,
  describeSeat,
  hasRender,
  markSeatEntries,
  occupantId,
  readOnboardingCursor,
  readPortals,
  readTreeSeats,
  seatWaiver,
  unusedSeatWaivers,
  type PortalReading,
  type SeatEntryReading,
  type SeatReading,
  type SeatWaiver,
} from './shellSeats.ts'
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
 * 对账的四棵树（实验室路由名）：三棵生产树 + #247 的 plugins 树。
 *
 * 实验室还有第五个路由 `sidebar-official`（侧栏树的对照档：同一个 frame 不装自有工作区树
 * 插件，让官方浏览区渲染，供 PARITY 当基准）。它不进这份对账表：它不是一棵生产树，而它的
 * block list 与 sidebar 树**逐条相同**（只差一个 extraPluginIds），座位的声明面因此与
 * sidebar 树逐座相同、渲染面只在 `sidebar.workspaces` 一处不同——那是 PARITY 与 F-01 的
 * 覆盖面，重复对账只会把同一件事报两遍。
 */
const RECONCILE_TREES: readonly string[] = ['sidebar', 'chat', 'settings', 'plugins']

interface TreeReading {
  route: string
  readings: Map<string, SeatReading>
  /** 这个页面读快照时的报错（非空 = 这一面没核实）。 */
  error: string
  /** 页面上渲染出来的条目与它们的入口（事实，同时是 F-54 扫描的现场证据）。 */
  entries: SeatEntryReading[]
  /** 页面上那一轮挂到 `document.body` 上的覆盖层（含归属的座）——座上的贡献 portal 出去时只有这一份读数看得见。 */
  portals: PortalReading[]
  /** 设置页壳自己的 onboarding 游标读数（`settings.onboarding` 这一轮渲染哪一步）。 */
  onboardingCursor: string
}

/** 打开官方页面（网关 origin = 实验室那台实例的原始页面）并装上 fiber 探针。 */
async function openOfficialPage(
  ctx: SuiteContext,
): Promise<{ context: BrowserContext; page: Page; capture: ReturnType<typeof capturePage> }> {
  const cookie = cookieHeader(ctx.lab.gateway)
  const context = await ctx.browser.newContext({ viewport: { width: 1400, height: 950 } })
  if (cookie !== undefined) {
    const at = cookie.indexOf('=')
    await context.addCookies([
      {
        name: cookie.slice(0, at),
        value: cookie.slice(at + 1),
        domain: new URL(ctx.lab.gateway).hostname,
        path: '/',
      },
    ])
  }
  // 快照要经 fiber 探针留下的 `ctx` 反射取 slots 服务（见 shellSeats.ts 的读取说明）。
  await context.addInitScript({ content: fiberProbeScript() })
  const page = await context.newPage()
  const capture = capturePage(page)
  await page.goto(`${ctx.lab.gateway}/`, { waitUntil: 'domcontentloaded' })
  // 官方页首屏：等根容器出现再静置（与 F-54 开官方页同一套等待）。
  await page.waitForSelector('[data-slot="root"]', { timeout: 40_000 }).catch(() => undefined)
  await page.waitForTimeout(6_000)
  return { context, page, capture }
}

/** 一处座在一棵树上的读数摘要（报告里的观测行）。 */
function describeReading(reading: SeatReading): string {
  if (!reading.declared) return '未声明'
  const occupants = reading.node?.occupants ?? []
  return `声明(${reading.node?.kind ?? '?'}/${reading.node?.scope ?? '?'}) 占位者 ${String(occupants.length)}${
    occupants.length === 0 ? '' : `〔${occupants.map((occupant) => occupantId(occupant)).join('、')}〕`
  } 渲染 ${String(reading.anchors)}锚点/${String(reading.elements)}元素/${reading.text ? '有文字' : '无文字'}`
}

/** 条目读数的人读一行（F-54 的扫描与这里共用同一份标记读数）。 */
function describeEntry(entry: SeatEntryReading): string {
  if (entry.target === null) return `${entry.marker}=（无可点元素：${entry.noTarget ?? '这一格没有可点的入口'}）`
  const marks = [entry.target.self ? '条目自己' : '', entry.target.ancestor ? '锚点外的祖先' : '', entry.target.settled ? '已选中态' : '']
    .filter((mark) => mark !== '')
    .join('+')
  return `${entry.marker}=${entry.target.label}${marks === '' ? '' : `（${marks}）`}`
}

export const SHELL_SEAT_SUITE: LabSuite = {
  id: 'F-75',
  phase: 'new-feature',
  name: '壳座位对账：官方页有的壳座，每棵树要么声明并渲染、要么在白名单里带理由（SHELL-SEATS 套件）',
  expect:
    '官方页面（网关 origin 的原始页面）与四棵树（sidebar / chat / settings / plugins）各读一次槽位快照 `ctx.slots.snapshot()`（经 fiber 探针留下的 ctx 反射取 slots 服务），**逐座对账 `shellSeats.ts` 里那份壳座表**（`main` / `sidebar.panellist` / `sidebar.settings` / `sidebar.footer.action` / `sidebar.workspaces` / `settings.section` / `settings.action` / `settings.trigger` / `settings.onboarding` / `shell.overlay` / `rightbar` / `plugins.item`）。① **官方页有、本树既没声明也没占位**的座必须落在白名单里（每条带「为什么这是有意收敛」的整句理由），否则判红——这一档就是 #248 里那两种静默坏法中的「座没声明 ⇒ 官方 `slots.inject` 停车、能力静默消失」（侧栏「插件」那一行与它连带的三处子座、官方设置弹层那条触发条都是它）；② **本树声明了、座上也有人、页面上却零渲染节点**的座同样必须在白名单里——这一档是「座声明了但没人渲染 ⇒ 内容进不来」（官方设置弹层那两条 onboarding 在 #249 之前是它）。判 ② 要求座上有占位者（空 list 座没内容可丢）；渲染面按「锚点 + 里面的元素或文字」读（官方插件页那四张卡的摘要是文字节点）。**不吃当天数据**：只扫这份壳座表（root 级的页 / 弹层 / 面板座），会话级 / 数据级的座只记事实不判。③ **设置页 onboarding 的正面判据**（#249 起）：`settings.onboarding` 座上那两条官方 onboarding 是**按需渲染 + body 级 portal** 的模态框，锚点里永远不会有节点——所以除了白名单那档 `lazy`，还要正面判「座上就是这两条」「锚点按壳自己的游标在场（游标非空 ⇒ 锚点在场）」「游标非空时那一步真的画在 `document.body` 下、且沿 React fiber 的 `return` 链归属得上这个座」，并把两条各自的读数（谁在座上、谁是当前这一步、另一条为什么不出现）逐条记进事实。另外逐座记下渲染出来的条目与它们的第一枚可点元素（F-54 的壳上入口扫描用同一份读数与同一份白名单），并核对白名单里没有**用不上**的条目（读数形状变了、理由不再描述现状时点名）。全程只读：只读快照与 DOM，一个字节都不写网关、不点任何控件。',
  async run(ctx: SuiteContext, check): Promise<string[]> {
    const screenshots: string[] = []

    // -------------------------------------------------------------------
    // 基准：官方页面自己的座位表
    // -------------------------------------------------------------------
    const official = await openOfficialPage(ctx)
    let officialDeclares = new Set<string>()
    let officialError = ''
    try {
      const read = await readTreeSeats(official.page)
      officialError = read.error
      officialDeclares = new Set([...read.seats.keys()])
      check.ok(
        '官方页：槽位快照读到了（这一条是本套件的基准——读不到就没有可对账的东西）',
        read.error === '',
        read.error === '' ? `座 ${String(read.seats.size)} 个、壳座表命中 ${String(SHELL_SEATS.filter((seat) => officialDeclares.has(seat.name)).length)} 个` : read.error,
      )
      const shellHits = SHELL_SEATS.map((seat) => {
        const reading = read.readings.get(seat.name)
        return `${seat.name}=${describeReading(reading ?? { declared: false, anchors: 0, elements: 0, text: false })}`
      })
      check.fact(`官方页：壳座表逐座读数 —— ${shellHits.join('；')}`)
      const missing = SHELL_SEATS.filter((seat) => !officialDeclares.has(seat.name)).map((seat) => seat.name)
      // 官方页一个壳座都没有 = 这份壳座表已经与官方脱节（官方改名 / 搬走了），那时两条判据
      // 都会变成「没什么可比」的空转，所以这一条单独判死。
      check.ok(
        '官方页：壳座表里的座绝大多数在场（表没与官方产物脱节）',
        missing.length <= 1,
        missing.length === 0 ? '全部在场' : `官方页上没有：${missing.join('、')}`,
      )
      const renderFacts = await markSeatEntries(official.page, SHELL_SEATS.map((seat) => seat.name))
      check.fact(
        `官方页：壳座上渲染出来的条目与它们的入口 —— ${renderFacts.map(describeEntry).join('；') || '（一个都没有）'}`,
      )
      screenshots.push(await shot(ctx, official.page, 'f-75-0-official'))
    } finally {
      await official.context.close()
    }

    // -------------------------------------------------------------------
    // 逐棵树对账
    // -------------------------------------------------------------------
    const usedWaivers = new Set<string>()
    const trees: TreeReading[] = []
    for (const name of RECONCILE_TREES) {
      const tree = route(name)
      const opened = await openTreePage(ctx.browser, ctx.lab, tree, { fiberProbe: true })
      try {
        const read = await readTreeSeats(opened.page)
        const entries = await markSeatEntries(opened.page, SHELL_SEATS.map((seat) => seat.name))
        const portals = await readPortals(opened.page)
        const onboardingCursor = await readOnboardingCursor(opened.page)
        trees.push({ route: name, readings: read.readings, error: read.error, entries, portals, onboardingCursor })
        check.ok(
          `${name} 树：槽位快照读到了（这是这一棵树的声明面读数）`,
          read.error === '',
          read.error === '' ? `座 ${String(read.seats.size)} 个` : read.error,
        )
        if (portals.length > 0) {
          check.fact(`${name} 树：body 级 portal 覆盖层 —— ${portals.map(describePortal).join('；')}`)
        }
        check.fact(
          `${name} 树：壳座表逐座读数 —— ${SHELL_SEATS.map((seat) => {
            const reading = read.readings.get(seat.name)
            return `${seat.name}=${describeReading(reading ?? { declared: false, anchors: 0, elements: 0, text: false })}`
          }).join('；')}`,
        )
        check.fact(
          `${name} 树：壳座上渲染出来的条目与它们的入口 —— ${entries.map(describeEntry).join('；') || '（一个都没有）'}`,
        )
        screenshots.push(await shot(ctx, opened.page, `f-75-${name}`))
      } finally {
        await opened.context.close()
      }
    }

    const verdicts: string[] = []
    for (const tree of trees) {
      for (const seat of SHELL_SEATS) {
        const reading = tree.readings.get(seat.name)
        if (reading === undefined) continue
        const occupants = reading.node?.occupants.length ?? 0
        // ① 官方有、本树既没声明也没占位。
        if (officialDeclares.has(seat.name) && !reading.declared) {
          const waiver = seatWaiver(tree.route, seat.name, 'absent')
          if (waiver === undefined) {
            check.ok(
              `${tree.route} 树：官方页有壳座 \`${seat.name}\`，本树既没声明也没占位 —— 必须落在白名单里`,
              false,
              `${describeSeat(seat.name)}；官方页上这个座在（对账基准），本树快照里没有这个名字，页面上也没有它的锚点。要么补上声明（并让页面渲染它），要么在 shellSeats.ts 的 SEAT_WAIVERS 里写清为什么有意收敛`,
            )
          } else {
            usedWaivers.add(`${tree.route}/${seat.name}/absent`)
            check.fact(`[白名单] ${tree.route} 树 · ${seat.name} 不声明：${waiver.reason}`)
          }
          continue
        }
        // ② 本树声明了、座上也有人、页面上零渲染节点。
        if (reading.declared && occupants > 0 && !hasRender(reading)) {
          const names = (reading.node?.occupants ?? []).map(occupantId)
          const waiver = seatWaiver(tree.route, seat.name, 'unrendered')
          const lazy = seatWaiver(tree.route, seat.name, 'lazy')
          const lazyCovers = lazy?.occupants !== undefined && names.every((name) => lazy.occupants?.includes(name) === true)
          if (waiver !== undefined) {
            usedWaivers.add(`${tree.route}/${seat.name}/unrendered`)
            check.fact(`[白名单] ${tree.route} 树 · ${seat.name} 声明了但不渲染：${waiver.reason}`)
          } else if (lazy !== undefined && lazyCovers) {
            usedWaivers.add(`${tree.route}/${seat.name}/lazy`)
            check.fact(
              `[白名单·按需渲染] ${tree.route} 树 · ${seat.name}：座上的人（${names.join('、')}）都是按需渲染的，所以这一格现在零渲染节点 —— ${lazy.reason}`,
            )
          } else {
            const uncovered = lazy?.occupants === undefined ? names : names.filter((name) => lazy.occupants?.includes(name) !== true)
            check.ok(
              `${tree.route} 树：声明了 \`${seat.name}\`、座上有 ${String(occupants)} 个占位者，页面上零渲染节点 —— 必须落在白名单里`,
              false,
              `${describeSeat(seat.name)}；座上的人：${names.join('、')}${uncovered.length === 0 ? '' : `（其中没被任何一条白名单覆盖的：${uncovered.join('、')}）`}；渲染读数：锚点 ${String(reading.anchors)}、元素 ${String(reading.elements)}、文字 ${String(reading.text)}。这一档就是「贡献注册进来了、页面上永远看不到」，要么给这个座一个渲染面，要么在 shellSeats.ts 的 SEAT_WAIVERS 里写清为什么有意（按需渲染的写 \`lazy\` 并逐个点名座上的占位者）`,
            )
          }
        }
      }
      verdicts.push(
        `${tree.route}：壳座 ${String(
          SHELL_SEATS.filter((seat) => {
            const reading = tree.readings.get(seat.name)
            return reading?.declared === true && hasRender(reading)
          }).length,
        )} 个声明且渲染`,
      )
    }

    // 白名单不是只增不减的清单：读数形状变了（例如某处补上了渲染面）时，那条理由就不再
    // 描述现状——点名出来，免得白名单慢慢变成一份没人读的旧账。
    const unused = unusedSeatWaivers(usedWaivers)
    check.ok(
      `白名单里的条目都在描述现状（用不上的条目 ${String(unused.length)} 条）`,
      unused.length === 0,
      unused.map((waiver: SeatWaiver) => `${waiver.tree}/${waiver.seat}/${waiver.verdict}`).join('、'),
    )
    // 判据不许空转：这次真的按「树 × 座」逐格比过（4 棵树 × 12 座 = 48 格）。
    const cells = trees.length * SHELL_SEATS.length
    check.ok(
      `这次对账逐格比过（${String(trees.length)} 棵树 × ${String(SHELL_SEATS.length)} 座 = ${String(cells)} 格）`,
      cells >= 40,
      `cells=${String(cells)}`,
    )
    check.ok(
      '四棵树的快照都读到了（对账的输入齐了）',
      trees.every((tree) => tree.error === ''),
      trees.map((tree) => `${tree.route}:${tree.error === '' ? 'ok' : tree.error}`).join(' | '),
    )
    check.fact(`对账结论：${verdicts.join('；')}`)
    check.ok(
      '官方页那份基准也读到了（没有它，两条判据都无从比对）',
      officialError === '',
      officialError === '' ? `官方页上壳座表命中 ${String(officialDeclares.size)} 个座名` : officialError,
    )

    // -------------------------------------------------------------------
    // 设置页的 `settings.onboarding`：座上那两条官方 onboarding 到底渲染出来没有
    // -------------------------------------------------------------------
    //
    // 为什么单独一段（#249）：这个座上的贡献是**按需渲染 + body 级 portal**（官方
    // `OnboardingModal` 用官方 `Modal` 原语 `createPortal(..., document.body)`），
    // 上面那条通用判据按「锚点里有没有节点」读，对它永远是零——所以既要有白名单那档
    // `lazy`（不许把「锚点里没节点」直接当红），也要有**这一档正面判据**：壳这一轮
    // 渲染的是哪一步（我们自己的游标读数）与页面上真的画出来的那个模态框，必须对得上。
    //
    // 判的是机制而不是某一条的显示状态：`welcome-notice` 会不会显示由官方的首访确认
    // 状态决定、`deepseek-official` 由有没有可用凭据决定（两条都由官方组件自己判），
    // 所以这里不写死「必须出现 welcome-notice」，写死的是「**当前这一步必须真的画出来**」
    // 与「两条各自为什么不出现要能读出原因」。
    const settingsTree = trees.find((tree) => tree.route === 'settings')
    if (settingsTree === undefined) {
      check.ok('设置树读数在场（这一段的前提）', false, '四棵树里没有 settings')
    } else {
      const seat = settingsTree.readings.get('settings.onboarding')
      const occupants = (seat?.node?.occupants ?? []).map(occupantId)
      const ONBOARDING_STEPS = ['welcome-notice', 'deepseek-official'] as const
      const cursor = settingsTree.onboardingCursor
      const onboardingPortals = settingsTree.portals.filter((portal) => portal.seat === 'settings.onboarding')
      check.eq(
        '设置页：`settings.onboarding` 座上就是官方那两条（welcome-notice / deepseek-official）——座在、贡献也注册进来了',
        [...occupants].sort(),
        [...ONBOARDING_STEPS].sort(),
      )
      check.ok(
        '设置页：这个座由设置页渲染（`[data-slot="settings.onboarding"]` 锚点在场；官方语义是「有当前这一步才渲染这个座」）',
        cursor === '' ? (seat?.anchors ?? 0) === 0 : (seat?.anchors ?? 0) >= 1,
        `锚点 ${String(seat?.anchors ?? 0)} 枚、游标=${JSON.stringify(cursor)}；座上的人：${occupants.join('、') || '（一个都没有）'}`,
      )
      check.ok(
        '设置页：游标读数要么空、要么是座上的一条（`data-dshone-onboarding-step`；空 = 两条都由官方状态判定完成）',
        cursor === '' || ONBOARDING_STEPS.some((id) => id === cursor),
        `游标=${JSON.stringify(cursor)} 座上的 id=${occupants.join('、')}`,
      )
      if (cursor === '') {
        check.fact(
          '设置页 onboarding：游标空 —— 座上那两条这一轮都由官方状态判定为「不需要显示」（`welcome-notice` 的确认标记已写过 / `deepseek-official` 那一路没有需要介入的凭据状态），所以这一轮没有模态框；这不是「我们没渲染」',
        )
      } else {
        check.ok(
          `设置页 onboarding：游标指着的这一步（${cursor}）真的画出来了（body 级 portal 的模态框、归属这个座）`,
          onboardingPortals.length >= 1,
          `body 上读到 ${String(settingsTree.portals.length)} 处 portal 覆盖层：${
            settingsTree.portals.map(describePortal).join('；') || '（一处都没有）'
          }——归属探针没认出／这一页没画出来都会落到这里`,
        )
        check.ok(
          '设置页 onboarding：这一页的 portal 覆盖层都归属得上一个座（归属探针断了要在这里现形，免得「零渲染」是假绿）',
          settingsTree.portals.every((portal) => portal.seat !== ''),
          settingsTree.portals.map(describePortal).join('；') || '（一处都没有）',
        )
      }
      // 两条各自的读数（「两项都要给读数」）：谁在座上、谁是当前这一步、官方那边为什么不出现。
      check.fact(
        `设置页 onboarding 逐条读数 —— ${ONBOARDING_STEPS.map((id) => {
          const onSeat = occupants.includes(id)
          const isCursor = cursor === id
          const drawn = onboardingPortals.length > 0
          const why = !onSeat
            ? '不在座上（官方没注册它，或本 dsh 版本里没有这一条）'
            : isCursor
              ? `它是壳这一轮选中的那一步，页面上画出来了=${String(drawn)}（${onboardingPortals.map(describePortal).join('；') || '没有 portal 覆盖层'}）`
              : cursor === ''
                ? '座上有人、但壳这一轮没有当前步（两条都已被官方状态判定完成）'
                : `壳这一轮选中的是 ${cursor}——官方设置弹层一次只放当前那一步（\`SettingsRoot\` 的 \`renderSlot("settings.onboarding", …, { only: onboardingStep.id })\`，dsh-client-ui-settings-general/lib/client.js:438），所以它这一轮不渲染，不是我们没给它座位`
          return `${id}: ${why}`
        }).join('；')}`,
      )
    }

    return screenshots
  },
}
