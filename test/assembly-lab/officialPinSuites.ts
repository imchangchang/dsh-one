/**
 * 置顶这份状态在 dsh-one 与官方 web 之间是同一份（#240）：0.1.7 起读写官方注册表。
 *
 * ## 这一套件在钉什么
 *
 * 官方 0.1.7-alpha.1 给侧栏加了会话置顶，状态在**官方工作区注册表**里（工作区流的基线
 * 带 `pinnedSessionIds`，写口是服务上的 `pinSession` / `unpinSession`）。我们在
 * `sidebar.workspaces` 槽位上遮蔽官方侧栏，官方那套置顶 UI 在这棵树上不渲染——状态不
 * 合流就是**同一件事两份互不相干的集合**（用户在官方 web 里置顶的，在 dsh-one 的树里
 * 不算置顶，反过来也一样）。这一套件把「合流」钉成三种相互独立的读数：
 *
 * 1. **注册表（网关那一侧）**：往假宿主注入自有 `pinned` 键（旧代那份状态）后开页面，
 *    网关的工作区流里**出现这条 id**（基线与追加帧都算）——这说明我们的页面真的把置顶
 *    写进了官方状态，而不只是改了自己那份文件；套件收尾把它取消，注册表回到开场那份。
 * 2. **自有键**：官方这一代补写完**划成空集合**（一次性，此后以官方为准）；0.1.6 及
 *    以下（本机这一版没有官方置顶状态）反过来——原样保留、整轮零 pin 类 API 调用，
 *    这就是「旧代行为不变」的读数。
 * 3. **两端渲染**：官方那一页（`sidebar-official` 路由）上这条会话带官方自己的置顶标记
 *    并排到组内第一；自有树上那一行带图钉；在自有树上置顶另一条 → 官方那一页也置顶；
 *    在官方那一页取消置顶 → 自有树重载后不再置顶。
 *
 * ## 为什么第 3 组的夹具不从自有树里取、又为什么它可能整组跑不到
 *
 * 夹具（会话 id / 标题）从网关的 `session/list` 取，不从自有树里取——这样第 1、2 组
 * **不依赖任何页面渲染**：0.1.7-alpha.2 上自有树与官方浏览区都整片起不来（官方改了一代
 * 东西，另立 #232 / #236），从树里取夹具会让整条套件在那版上一读就停，而状态面那两组
 * 读数本来是验得出来的（实测：正是这个形态下读到「网关的 pin 类 RPC 被调用 1 次、
 * 注册表里出现这条 id、自有键被划空」）。第 3 组要页面渲染得出来才跑得到，跑不到时
 * **逐条留显式事实**（README 的「条件断言必须留痕」口径），不静默消失。
 *
 * ## 连外部实例时不写
 *
 * `--gateway <url>` 那一路对着**别人的实例**（用户的日常那台）跑，实验室按只读对待——
 * 所以那一路只做读的对照（自有树渲染出来的图钉集合 vs 网关注册表里那份集合），一条写
 * 都不发。
 *
 * ## 读数怎么来的
 *
 * 官方行上的置顶标记是它自己的 `pinIndicator`（类名后缀取法，与 `_sessionRow` /
 * `_projectRow` 同一套）；置顶按钮按**官方词典**的 aria-label 认，zh / en 两份都给
 * （页面语言是环境输入，见 README 的「套件判据不许依赖运行环境」）。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与 F-23 / F-24 / F-37 那几件同一条：那个
 * 文件是本批开发的合入热点，新套件放外面能少一半冲突面。注册方式是在 `suites.ts` 的
 * `SUITES` 末尾追加一项（F-70：F-01…F-69 已被占用）。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import type { Locator, Page } from 'playwright'
import { apiMethodCounts, openTreePage, withoutKnownNoise } from './harness.ts'
import { consoleLogger, LAB_TREES, type LabTreeRoute } from './labServer.ts'
import { callRpc, listSessions } from '../../src/server/dshRpc.ts'
import { subscribeWorkspaceStream } from '../../src/server/modernStreams.ts'
import type { Logger } from '../../src/log.ts'
// 只取类型（编译后不留 import，运行期没有环）：套件接口定义在 suites.ts 里。
import type { LabSuite } from './suites.ts'

const route = (name: LabTreeRoute['route']): LabTreeRoute => {
  const found = LAB_TREES.find((candidate) => candidate.route === name)
  if (found === undefined) throw new Error(`lab: unknown tree route ${name}`)
  return found
}

/** 自有树的会话行与分组容器（全部按自有标记取，不认官方哈希类名）。 */
const OWN_ROW = '[data-dshone-tree-session]'
const OWN_GROUP = '[data-dshone-group-key]'
const OWN_PIN = '[data-dshone-tree-pin]'
const OWN_SESSION_MENU = '[data-dshone-tree-action="session-menu"]'
const OWN_PIN_ITEM = '[data-dshone-tree-item="pin"]'

/** 官方浏览区的会话行 / 工作区行 / 置顶标记（官方类名后缀，与 F-04/F-43 同一取法）。 */
const OFFICIAL_ROW = '[class*="_sessionRow"]'
const OFFICIAL_PROJECT_ROW = '[class*="_projectRow"]'
const OFFICIAL_PIN = '[class*="pinIndicator"]'

/**
 * 官方置顶动作按钮的 aria-label 取值（官方词典 `menu.pinSession` / `menu.unpinSession`
 * 的 zh / en 两份，出处 = 0.1.7-alpha.2 的 `@deepseek-ai/dsh-client-ui-workspace`
 * client bundle 里 `PinSessionRowButton` 那一段）。按钮按行上「此刻是哪种状态」换文案，
 * 所以四种取值一起拼选择器 = 认到那枚按钮本身，两种语言、两种状态都命中。
 */
const OFFICIAL_PIN_LABELS = ['置顶会话', '取消置顶', 'Pin session', 'Unpin session']

/** 官方那枚按钮的选择器（本页语言是 zh 或 en 都认得）。 */
const OFFICIAL_PIN_BUTTON = OFFICIAL_PIN_LABELS.map((label) => `button[aria-label="${label}"]`).join(', ')

interface OwnRow {
  id: string
  title: string
  pinned: boolean
  /** 它在自己那一组里的次序（0 = 组内第一行）。 */
  index: number
}

/** 我们那棵树里逐组的会话行（图钉标记 + 组内次序）；没有渲染时是空表。 */
async function ownRows(page: Page): Promise<{ key: string; sessions: OwnRow[] }[]> {
  return page.evaluate(
    ([groupSel, rowSel, pinSel]) =>
      Array.from(document.querySelectorAll(groupSel)).map((group) => ({
        key: group.getAttribute('data-dshone-group-key') ?? '',
        sessions: Array.from(group.querySelectorAll(rowSel)).map((row, index) => ({
          id: row.getAttribute('data-dshone-tree-session') ?? '',
          title: (row.querySelector('.dshOneTree_title')?.textContent ?? '').trim(),
          pinned: row.querySelector(pinSel) !== null,
          index,
        })),
      })),
    [OWN_GROUP, OWN_ROW, OWN_PIN] as const,
  )
}

interface OfficialRow {
  /** 官方行所属的工作区分组（按文档序里最近一个工作区行的文本推）。 */
  group: string
  title: string
  pinned: boolean
  pinLabel: string | null
  /** 它在自己那一组会话行里的次序。 */
  index: number
}

/**
 * 官方浏览区那一页的会话行读数。
 *
 * 分组怎么认：官方的工作区行与会话行在 DOM 里是「工作区行在前、它名下的会话行在后」的
 * 文档序，所以按文档序遍历、记下最近一个工作区行的文本即可（取法与 F-04/F-43 读官方行
 * 的类名后缀同源，都不依赖官方哈希前缀）。官方行上那枚置顶标记是它的 `pinIndicator`。
 */
async function officialRows(page: Page): Promise<OfficialRow[]> {
  const flat = await page.evaluate(
    (suffixes: { row: string; project: string; pin: string }) => {
      const rows: { group: string; title: string; pinned: boolean; pinLabel: string | null }[] = []
      let group = ''
      const walk = (node: Element): void => {
        for (const child of Array.from(node.children)) {
          const cls = child.getAttribute('class') ?? ''
          if (cls.includes(suffixes.project)) group = (child.textContent ?? '').trim()
          if (cls.includes(suffixes.row)) {
            const pin = child.querySelector(`[class*="${suffixes.pin}"]`)
            rows.push({
              group,
              title: (child.querySelector('[class*="_title"]')?.textContent ?? '').trim(),
              pinned: pin !== null,
              pinLabel: pin?.getAttribute('aria-label') ?? null,
            })
          }
          walk(child)
        }
      }
      walk(document.body)
      return rows
    },
    { row: '_sessionRow', project: '_projectRow', pin: 'pinIndicator' },
  )
  // 组内次序在浏览器外面算（页面里那段只负责摊平文档序）。
  return flat.map((row) => ({ ...row, index: flat.filter((other) => other.group === row.group).indexOf(row) }))
}

/** 官方那一页里某条会话的置顶按钮（认官方词典的 aria-label；认不到给 null）。 */
async function officialPinButton(page: Page, title: string): Promise<Locator | null> {
  const rows = page.locator(OFFICIAL_ROW)
  const count = await rows.count()
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index)
    const text = (await row.textContent()) ?? ''
    if (!text.includes(title)) continue
    const button = row.locator(OFFICIAL_PIN_BUTTON)
    if ((await button.count()) > 0) return button.first()
  }
  return null
}

/** 展开官方浏览区的每个工作区（点收起态的工作区行；只改它自己的视图）。 */
async function expandOfficial(page: Page): Promise<number> {
  const toggled = await page.evaluate((projectSel: string) => {
    let count = 0
    for (const row of Array.from(document.querySelectorAll(projectSel))) {
      if (row.getAttribute('aria-expanded') === 'false') {
        ;(row as HTMLElement).click()
        count += 1
      }
    }
    return count
  }, OFFICIAL_PROJECT_ROW)
  if (toggled > 0) await page.waitForTimeout(400)
  return toggled
}

/** 展开我们自己那棵树的分组（只动本地展开态；树没渲染时什么也不发生）。 */
async function expandOwn(page: Page): Promise<void> {
  const clicked = await page.evaluate(() => {
    let count = 0
    for (const row of Array.from(document.querySelectorAll('[data-dshone-tree-row="workspace"]'))) {
      if (row.getAttribute('aria-expanded') !== 'true') {
        ;(row as HTMLElement).click()
        count += 1
      }
    }
    return count
  })
  if (clicked > 0) await page.waitForTimeout(400)
}

/** 假宿主状态存储里的一个键（自有 `pinned` 键的位置）。 */
async function hostState(page: Page, key: string): Promise<unknown> {
  return page.evaluate((name: string) => {
    const host = (globalThis as unknown as { __LAB_HOST__?: { stateStore?: Record<string, unknown> } }).__LAB_HOST__
    return host?.stateStore?.[name] ?? null
  }, key)
}

/** 等一个读数满足条件（写口 → 官方快照 → 重渲染是一条异步链）。 */
async function waitFor<T>(read: () => Promise<T>, predicate: (value: T) => boolean, timeoutMs = 8_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let value = await read()
  while (!predicate(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 150))
    value = await read()
  }
  return value
}

/** 走我们自己那棵树的 ⋯ 菜单置顶 / 取消置顶某一条会话。 */
async function toggleOwnPin(page: Page, sessionId: string): Promise<void> {
  const row = page.locator(`[data-dshone-tree-session="${sessionId}"]`)
  await row.hover()
  await row.locator(OWN_SESSION_MENU).click()
  await page.waitForTimeout(250)
  await page.click(OWN_PIN_ITEM)
  await page.waitForTimeout(400)
}

/** pin 类（置顶写口）的 API 方法名与调用次数——用来看「这一段到底发没发置顶请求」。 */
function pinCalls(counts: ReadonlyMap<string, number>): Record<string, number> {
  return Object.fromEntries([...counts].filter(([method]) => /pin/i.test(method)))
}

/** 会话在网关回执里的标题（`session/list` 的投影）。 */
const titleOf = (session: { projections?: { values?: Record<string, unknown> } }): string => {
  const title = session.projections?.values?.title
  return typeof title === 'string' ? title : ''
}

/** 这条流实际只用 `info/warn/error` 三件（实验室里拿 consoleLogger 顶上，只做类型投影）。 */
const labLogger = (): Logger => consoleLogger(true) as unknown as Logger

/**
 * 网关工作区流的基线里那份置顶集合（**开流就退订**的一次读数）。
 *
 * `null` = 这一代网关的工作区流里**没有这一格**（0.1.6 及以下没有官方置顶状态）。
 * 为什么不拿「自有键有没有被划空」当代判定：补写失败时自有键也会留着原样，拿它当判据
 * 会把**失败**误判成**旧代**（那一档就永远绿）。
 */
async function gatewayPinSet(gateway: string, timeoutMs = 10_000): Promise<readonly string[] | null> {
  let subscription: ReturnType<typeof subscribeWorkspaceStream> | undefined
  let timer: NodeJS.Timeout | undefined
  return await new Promise<readonly string[] | null>((resolve) => {
    const finish = (ids: readonly string[] | null): void => {
      if (timer !== undefined) clearTimeout(timer)
      subscription?.dispose()
      resolve(ids)
    }
    timer = setTimeout(() => finish(null), timeoutMs)
    subscription = subscribeWorkspaceStream(gateway, labLogger(), (frame) => {
      if (frame.type !== 'baseline') return
      finish(frame.pinnedSessionIds ?? null)
    })
  })
}

/**
 * 订阅一次工作区流，等「注册表里出现这条会话」——基线与追加帧（`pinned`）都算。
 *
 * 为什么订阅而不是轮询：官方推的是**完整的置顶集合**（每次变更推一份新集合），订阅读到
 * 的那一帧本身就是「注册表此刻是什么」的证据，比反复开流稳。
 */
async function awaitPinnedInRegistry(
  gateway: string,
  sessionId: string,
  timeoutMs = 8_000,
): Promise<readonly string[] | null> {
  let subscription: ReturnType<typeof subscribeWorkspaceStream> | undefined
  let timer: NodeJS.Timeout | undefined
  return await new Promise<readonly string[] | null>((resolve) => {
    const finish = (ids: readonly string[] | null): void => {
      if (timer !== undefined) clearTimeout(timer)
      subscription?.dispose()
      resolve(ids)
    }
    timer = setTimeout(() => finish(null), timeoutMs)
    subscription = subscribeWorkspaceStream(gateway, labLogger(), (frame) => {
      const pinned = frame.type === 'baseline' || frame.type === 'pinned' ? frame.pinnedSessionIds : undefined
      if (pinned?.includes(sessionId) === true) finish(pinned)
    })
  })
}

/**
 * 直接用官方那条 RPC 取消置顶（**收尾还原专用**）。
 *
 * 存在的理由：页面渲染不出来时（0.1.7-alpha.2 上自有树与官方浏览区都起不来），官方那一页
 * 那枚按钮点不到，但套件自己置顶过的东西必须还原——不然留下一份改过的注册表，后面的套件
 * 读到的是被本条污染过的顺序。走的是官方网关自己的写口（与页面上点一下同一个方法），
 * 只是不经过界面。
 */
async function unpinViaGateway(gateway: string, sessionId: string): Promise<void> {
  await callRpc<{ pinnedSessionIds: string[] }>(gateway, 'workspace/unpinSession', {
    args: { request: { sessionId } },
  })
}

export const OFFICIAL_PIN_SUITE: LabSuite = {
  id: 'F-70',
  phase: 'new-feature',
  name: '置顶在 dsh-one 与官方 web 之间是同一份（#240）：0.1.7 起读写官方注册表 + 旧代补写迁移 + 幂等',
  expect:
    '① **补写迁移（注册表那一侧）**——往假宿主注入自有 `pinned` = 某条真会话（旧代那份状态）后开自有树那一页：0.1.7 及以上，网关的工作区流里**出现这条 id**（官方注册表真的被写进去了），同时自有键被划成空集合；0.1.6 及以下（本机这一版的工作区流里没有置顶集合这一格）则反过来——自有键原样保留 `{version:1,sessionIds:[…]}`、整轮零 pin 类 API 调用，这就是「旧代行为不变」的读数。② **幂等**——同一页重载一次（假宿主状态被初始化脚本重置回注入值，等于又开一页）时 pin 类 API 调用**零新增**，自有键与注册表都不动。③ **两端渲染**（要页面渲染得出来才跑得到；0.1.7-alpha.2 上自有树与官方浏览区都整片起不来、另立 #232/#236，那时逐条留显式事实）：官方那一页上这条会话带官方自己的置顶标记并排到组内第一；自有树那一行带图钉；在自有树上置顶另一条真会话，官方那一页（重载）上它同样排到组内第一并带官方置顶标记；在官方那一页上取消置顶，自有树（重载）上它不再置顶。④ **收尾还原**：套件自己置顶过的会话全部取消（注册表回到开场那份集合），实例不留痕迹。全程零 pageerror。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const shot = async (page: Page, name: string): Promise<void> => {
      const file = path.join(ctx.shots, `${name}.png`)
      await fsp.mkdir(ctx.shots, { recursive: true })
      await page.screenshot({ path: file })
      screenshots.push(file)
    }

    // 一、夹具：从**网关**取真会话（不从自有树取，见文件头的理由）。要一组「同一个工作区
    // 里至少两条有标题的会话」——置顶前后能看出组内次序变化。
    const sessions = await listSessions(ctx.lab.gateway).catch(() => [])
    const usable = sessions.filter((session) => session.blank !== true && titleOf(session) !== '' && session.cwd !== undefined)
    const byCwd = new Map<string, typeof usable>()
    for (const session of usable) {
      const key = String(session.cwd)
      byCwd.set(key, [...(byCwd.get(key) ?? []), session])
    }
    const pair = [...byCwd.values()].find((group) => group.length >= 2) ?? []
    check.fact(
      `网关读数：${String(sessions.length)} 条会话（可用 ${String(usable.length)} 条、${String(byCwd.size)} 个工作区），选中的那一组 ${String(pair.length)} 条`,
    )
    const migrateTarget = pair[0]
    const directionTarget = pair[1]
    if (migrateTarget === undefined || directionTarget === undefined) {
      check.ok('网关上取到同一工作区里两条有标题的会话当夹具', false, `pair=${String(pair.length)}`)
      return screenshots
    }
    check.fact(
      `迁移目标=${migrateTarget.sessionId.slice(0, 13)}（${JSON.stringify(titleOf(migrateTarget))}）方向目标=${directionTarget.sessionId.slice(0, 13)}（${JSON.stringify(titleOf(directionTarget))}）`,
    )

    // 二、这一代网关有没有官方置顶状态（外面看的那一条判据，见 `gatewayPinSet`）。
    const wirePinSet = await gatewayPinSet(ctx.lab.gateway)
    const registryGeneration = wirePinSet !== null
    check.fact(
      registryGeneration
        ? `网关的工作区流里带着置顶集合这一格（开场 ${String(wirePinSet.length)} 条）——这一代有官方置顶状态（0.1.7-alpha.1 起）`
        : '网关的工作区流里没有置顶集合这一格——这一代没有官方置顶状态（0.1.6 及以下）',
    )

    // 三、连外部实例（别人的实例）时一条写都不发：只做读的对照。
    if (ctx.lab.external === true) {
      const external = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { width: 380, height: 900 })
      try {
        await expandOwn(external.page)
        const rendered = (await ownRows(external.page)).flatMap((group) => group.sessions)
        const renderedPinned = rendered.filter((row) => row.pinned).map((row) => row.id)
        check.fact(`外部实例（只读）：自有树渲染出 ${String(rendered.length)} 条会话行，其中带图钉 ${String(renderedPinned.length)} 条`)
        if (rendered.length === 0) {
          check.fact('外部实例（只读）这一页没有渲染出会话行，读的对照没跑到')
        } else if (!registryGeneration) {
          check.fact('外部实例这一版没有官方置顶状态可对照（这一条只在 0.1.7 及以上有意义）')
        } else {
          check.eq(
            '外部实例（只读）：自有树上带图钉的那些会话 = 网关注册表里那份置顶集合',
            [...renderedPinned].sort(),
            [...(wirePinSet ?? [])].filter((id) => rendered.some((row) => row.id === id)).sort(),
          )
        }
      } finally {
        await external.context.close()
      }
      return screenshots
    }

    // 四、开两页：自有树那一页（带注入的自有 pinned 键）、官方那一页（读官方渲染）。
    const own = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), {
      width: 380,
      height: 900,
      state: { pinned: { version: 1, sessionIds: [migrateTarget.sessionId] } },
    })
    const official = await openTreePage(ctx.browser, ctx.lab, route('sidebar-official'), { width: 380, height: 900 })
    let pinnedByThisSuite = false
    try {
      await expandOwn(own.page)
      await expandOfficial(official.page)
      check.fact(
        `官方那一页的会话行（分组|标题|置顶标记）：${JSON.stringify(
          (await officialRows(official.page)).map((row) => `${row.group}|${row.title}${row.pinned ? '|pin' : ''}`),
        )}`,
      )

      // ---- ① 补写迁移：先看注册表（不依赖任何页面渲染），再看自有键 ----
      const registryAfter = registryGeneration
        ? await awaitPinnedInRegistry(ctx.lab.gateway, migrateTarget.sessionId)
        : null
      pinnedByThisSuite = registryAfter !== null
      const expectedKey = registryGeneration
        ? { version: 1, sessionIds: [] }
        : { version: 1, sessionIds: [migrateTarget.sessionId] }
      const ownKey = await waitFor(
        () => hostState(own.page, 'pinned'),
        (value) => JSON.stringify(value) === JSON.stringify(expectedKey),
      )
      check.ok(
        registryGeneration
          ? '迁移：网关注册表里出现这条会话（自有键里那份旧置顶真的补写进了官方状态）'
          : '迁移：本机这一版没有官方置顶状态可核（0.1.6 及以下，这一档由 0.1.7-alpha.2 上的同一套件覆盖，按不适用通过）',
        registryGeneration ? registryAfter?.includes(migrateTarget.sessionId) === true : true,
        `注册表读数=${JSON.stringify(registryAfter)} 自有键=${JSON.stringify(ownKey)}`,
      )
      check.ok(
        registryGeneration
          ? '迁移收尾：自有 pinned 键被划成空集合（一次性；此后以官方为准）'
          : '迁移收尾：旧代自有 pinned 键原样保留（自有键仍是权威，行为不变）',
        JSON.stringify(ownKey) === JSON.stringify(expectedKey),
        `pinned=${JSON.stringify(ownKey)} expected=${JSON.stringify(expectedKey)}`,
      )

      // ---- ② 幂等：重载一次（假宿主状态被初始化脚本重置回注入值，等于又开一页）----
      const before = pinCalls(apiMethodCounts())
      await own.page.reload({ waitUntil: 'domcontentloaded' })
      await own.page.waitForTimeout(1_000)
      const pinMethodFacts = pinCalls(apiMethodCounts())
      const pinCallsInReload = Object.entries(pinMethodFacts).filter(([method, count]) => count > (before[method] ?? 0))
      check.fact(`整轮 pin 类 API 方法读数：${JSON.stringify(pinMethodFacts)}（重载这一段新增 ${JSON.stringify(Object.fromEntries(pinCallsInReload))}）`)
      check.ok(
        registryGeneration
          ? '幂等：再开一次页不再发任何置顶写口请求（官方注册表里已经有它了）'
          : '幂等：旧代本来就不发置顶写口请求（置顶只写自有键，按不适用通过）',
        pinCallsInReload.every(([, count]) => count === 0),
        `新增=${JSON.stringify(Object.fromEntries(pinCallsInReload))}`,
      )
      const reloadedKey = await hostState(own.page, 'pinned')
      check.ok(
        '幂等：重载后自有键与收尾结果一致（没有多写一次、也没有把置顶丢掉）',
        JSON.stringify(reloadedKey) === JSON.stringify(ownKey),
        `pinned=${JSON.stringify(reloadedKey)}`,
      )

      // ---- ③ 两端渲染（要页面渲染得出来；渲染不出来时逐条留显式事实）----
      const ownNow = await ownRows(own.page)
      const ownFlat = ownNow.flatMap((group) => group.sessions.map((row) => ({ ...row, key: group.key })))
      const officialNow = await officialRows(official.page)
      const ownRendered = ownFlat.length > 0
      const officialRendered = officialNow.length > 0
      check.fact(
        ownRendered
          ? `自有树渲染出 ${String(ownFlat.length)} 条会话行（${String(ownNow.length)} 个分组）`
          : '自有树这一版没有渲染出任何会话行（侧栏槽位整片起不来）',
      )
      check.fact(
        officialRendered
          ? `官方浏览区渲染出 ${String(officialNow.length)} 条会话行`
          : '官方浏览区这一版没有渲染出任何会话行（整页没起来）',
      )

      if (!officialRendered) {
        check.fact('③「官方那一页上这条会话带官方置顶标记、排组内第一」没跑到：官方浏览区这一版不渲染')
      } else {
        const migratedOfficialRow = officialNow.find((row) => row.title === titleOf(migrateTarget))
        check.ok(
          registryGeneration
            ? '③ 官方那一页上这条会话带官方自己的置顶标记（同一份状态在两端都看得见）'
            : '③ 旧代没有官方置顶状态可核（这一档由 0.1.7-alpha.2 上的同一套件覆盖，按不适用通过）',
          registryGeneration ? migratedOfficialRow?.pinned === true : true,
          `官方读数=${JSON.stringify(migratedOfficialRow ?? null)}`,
        )
        check.ok(
          registryGeneration
            ? '③ 官方那一页上它排在自己那一组第一（官方那条前置规则生效）'
            : '③ 旧代跳过官方那一页的排序对照（无官方置顶状态）',
          registryGeneration ? migratedOfficialRow?.index === 0 : true,
          `组内第 ${String(migratedOfficialRow?.index ?? -1)} 行（组=${migratedOfficialRow?.group ?? ''}）`,
        )
        await shot(official.page, 'official-pin-official-side')
      }

      if (!ownRendered) {
        check.fact('③「自有树那一行按官方状态显示图钉」没跑到：自有树这一版不渲染')
      } else {
        const ownMigratedRow = ownFlat.find((row) => row.id === migrateTarget.sessionId)
        check.ok('③ 自有树上这一行带图钉（置顶标记按那一代该读的那份状态渲染）', ownMigratedRow?.pinned === true, JSON.stringify(ownMigratedRow ?? null))
        await shot(own.page, 'official-pin-own-side')
      }

      // 两个方向（两边都渲染得出来才有意义）。
      const ownDirectionGroup = ownNow.find((group) => group.sessions.some((row) => row.id === directionTarget.sessionId))
      if (!ownRendered || !officialRendered || ownDirectionGroup === undefined) {
        check.fact('③ 方向一（自有树置顶 → 官方那一页）没跑到：两个前端这一版没能同时渲染出来')
        check.fact('③ 方向二（官方那一页取消置顶 → 自有树）没跑到：两个前端这一版没能同时渲染出来')
      } else {
        await toggleOwnPin(own.page, directionTarget.sessionId)
        const ownAfterPin = await waitFor(
          () => ownRows(own.page),
          (list) => list.some((group) => group.sessions.some((row) => row.id === directionTarget.sessionId && row.pinned)),
        )
        const pinnedGroup = ownAfterPin.find((group) => group.sessions.some((row) => row.id === directionTarget.sessionId))
        check.ok(
          '③ 方向一：在自有树上置顶之后，那一行带图钉并排到自己那一组第一',
          pinnedGroup?.sessions[0]?.id === directionTarget.sessionId,
          `组内=${JSON.stringify(pinnedGroup?.sessions.map((row) => row.id.slice(0, 12)) ?? [])}`,
        )
        await official.page.reload({ waitUntil: 'domcontentloaded' })
        await expandOfficial(official.page)
        const officialPinned = await waitFor(
          () => officialRows(official.page),
          (list) => !registryGeneration || list.some((row) => row.title === titleOf(directionTarget) && row.pinned),
        )
        const directionOfficial = officialPinned.find((row) => row.title === titleOf(directionTarget))
        check.ok(
          registryGeneration
            ? '③ 方向一：官方那一页同样显示它置顶、并排到组内第一（同一份状态）'
            : '③ 方向一：旧代官方那一页没有置顶这个概念可核（这一档由 0.1.7-alpha.2 上的同一套件覆盖）',
          registryGeneration ? directionOfficial?.pinned === true && directionOfficial.index === 0 : true,
          `官方读数=${JSON.stringify(directionOfficial ?? null)}`,
        )
        await shot(official.page, 'official-pin-direction-one')

        // 方向二：在官方那一页上取消置顶 → 自有树重载后不再置顶。
        const officialButton = registryGeneration ? await officialPinButton(official.page, titleOf(directionTarget)) : null
        if (officialButton !== null) {
          await officialButton.click()
          await official.page.waitForTimeout(600)
        }
        await own.page.reload({ waitUntil: 'domcontentloaded' })
        await expandOwn(own.page)
        const ownAfterUnpin = await waitFor(
          () => ownRows(own.page),
          (list) =>
            !registryGeneration ||
            list.every((group) => group.sessions.every((row) => row.id !== directionTarget.sessionId || !row.pinned)),
        )
        const unpinnedRow = ownAfterUnpin.flatMap((group) => group.sessions).find((row) => row.id === directionTarget.sessionId)
        check.ok(
          registryGeneration
            ? '③ 方向二：官方那一页取消置顶之后，自有树重载后那一行不再置顶（官方状态是权威）'
            : '③ 方向二：旧代自有键不受官方那一页影响（本机这一版两件事还没合流）',
          registryGeneration ? unpinnedRow?.pinned === false : true,
          `自有行=${JSON.stringify(unpinnedRow ?? null)} 官方按钮=${String(officialButton !== null)}`,
        )
        await shot(own.page, 'official-pin-direction-two')
      }

      // ---- ④ 收尾：套件自己置顶过的都取消，注册表回到开场那份集合 ----
      if (pinnedByThisSuite) {
        const cleanupButton = await officialPinButton(official.page, titleOf(migrateTarget))
        if (cleanupButton !== null) {
          await cleanupButton.click()
          await official.page.waitForTimeout(600)
        } else {
          // 渲染不出来时官方那枚按钮点不到：走官方那条写口（收尾专用，见 `unpinViaGateway`）。
          await unpinViaGateway(ctx.lab.gateway, migrateTarget.sessionId).catch(() => undefined)
        }
      }
      const finalPinSet = registryGeneration ? await gatewayPinSet(ctx.lab.gateway) : null
      check.ok(
        registryGeneration
          ? '收尾：网关注册表回到开场那份置顶集合（套件自己置顶过的都取消了，实例不留痕迹）'
          : '收尾：旧代没有官方置顶状态要还原（本机这一版只动过假宿主里的自有键）',
        registryGeneration ? JSON.stringify(finalPinSet) === JSON.stringify(wirePinSet) : true,
        `开场=${JSON.stringify(wirePinSet)} 收尾=${JSON.stringify(finalPinSet)}`,
      )

      check.fact(`自有树那一页的 pageerror：${JSON.stringify(withoutKnownNoise(own.capture.pageErrors).real)}`)
      check.eq('本套件全程零 pageerror', withoutKnownNoise(own.capture.pageErrors).real, [])
    } finally {
      await official.context.close()
      await own.context.close()
    }
    return screenshots
  },
}
