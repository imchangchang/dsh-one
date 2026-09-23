/**
 * 置顶这份状态在 dsh-one 与官方 web 之间是同一份（#240）：0.1.7 起读写官方注册表。
 *
 * ## 这一套件在钉什么
 *
 * 官方 0.1.7-alpha.1 给侧栏加了会话置顶，状态在**官方工作区注册表**里（快照的
 * `pinnedSessionIds` + 服务上的 `pinSession` / `unpinSession`）。我们在
 * `sidebar.workspaces` 槽位上遮蔽官方侧栏，官方那套置顶 UI 在这棵树上不渲染——
 * 状态不合流就是**同一件事两份互不相干的集合**（用户在官方 web 里置顶的，在 dsh-one
 * 的树里不算置顶，反过来也一样）。这一套件把「合流」钉成可观测的读数：
 *
 * 1. **补写迁移**（`watchLegacyPinAdoption`）：往假宿主注入自有 `pinned` 键（旧代那份
 *    状态），进页面之后①**官方那一页**也显示它置顶（补写真的进了注册表）、②自有键被
 *    划掉（一次性）。旧代（0.1.6 及以下，本机这一版没有官方置顶状态）反过来：自有键
 *    原样保留，这就是「0.1.6 及以下的行为不变」的读数。
 * 2. **幂等**：同一页重载（假宿主的状态被初始化脚本重置回注入值，等于「又一次开页」）
 *    时官方那条写口一次都不被调用——补写只发生在官方还没有的那些 id 上。
 * 3. **两个方向**（要自有树渲染得出来）：在 dsh-one 的树上置顶一条会话 → 官方那一页
 *    上它排到组内第一；在官方那一页上取消置顶 → dsh-one 重载后它不再置顶。
 *
 * ## 夹具为什么不从自有树里取
 *
 * 状态面这几条**不依赖自有树渲染**：会话 id / 标题从网关的 `session/list` 取，官方那
 * 一侧读官方浏览区那一页（`sidebar-official` 路由，不装自有树插件），自有那一侧读假宿主
 * 的状态存储与整轮的 API 方法表。这么写有一个现实理由：0.1.7-alpha.2 上自有树的侧栏
 * 槽位整片起不来（官方改图标名，#236 另立），从树里取夹具会让整条套件在那版上一读就停，
 * 而本条要验的「补写 + 官方状态一致」在那版上本来是验得出来的。第 ③ 组要自有树渲染得
 * 出来才跑得到，跑不到时**留一条显式事实**（README 的「条件断言必须留痕」口径）。
 *
 * ## 读数怎么来的
 *
 * 官方行上的置顶标记是它自己的 `pinIndicator`（类名后缀取法，与 `_sessionRow` /
 * `_projectRow` 同一套）；置顶按钮按**官方词典**的 aria-label 认，zh / en 两份都给
 * （页面语言是环境输入，见 README 的「套件判据不许依赖运行环境」）。
 *
 * 数据面：真网关只读（会话、工作区都是播种的真数据），写只写**置顶**这一件事——写的是
 * 隔离实例自己的注册表，收尾会把开场时的置顶状态还原（开场是空的，套件最后一条断言钉它）。
 * 夹具只注入假宿主的状态存储（自有 `pinned` 键的位置），不伪造官方那一侧的任何数据。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与 F-23 / F-24 / F-37 那几件同一条：那个
 * 文件是本批开发的合入热点，新套件放外面能少一半冲突面。注册方式是在 `suites.ts` 的
 * `SUITES` 末尾追加一项（F-70：F-01…F-69 已被占用）。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import type { Locator, Page } from 'playwright'
import { apiMethodCounts, openTreePage, withoutKnownNoise, type OpenedPage } from './harness.ts'
import { consoleLogger, LAB_TREES, type LabTreeRoute } from './labServer.ts'
import { listSessions } from '../../src/server/dshRpc.ts'
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

/**
 * 网关的工作区流基线里**有没有置顶集合这一格**（`null` = 没有）。
 *
 * 这是那条分叉的**外部判据**：0.1.7-alpha.1 起官方才在基线里带 `pinnedSessionIds`
 * （以及那对写口），0.1.6 及以下没有。为什么不拿「自有键有没有被划空」当代判定：补写
 * 失败时自有键也会留着原样，拿它当判据会把**失败**误判成**旧代**（那一档就永远绿）。
 */
async function gatewayPinSet(gateway: string): Promise<readonly string[] | null> {
  let subscription: ReturnType<typeof subscribeWorkspaceStream> | undefined
  let timer: NodeJS.Timeout | undefined
  // 这条流的 `logger` 形参类型是扩展侧的 `Logger` 类（构造要 vscode，实验室里没有），
  // 而它实际只用 `info/warn/error` 三件——用 `consoleLogger` 顶上（只做类型投影，
  // 与 F-21/F-51 读工作区清单同一处置）。
  const logger = consoleLogger(true) as unknown as Logger
  return await new Promise<readonly string[] | null>((resolve) => {
    const finish = (ids: readonly string[] | null): void => {
      if (timer !== undefined) clearTimeout(timer)
      subscription?.dispose()
      resolve(ids)
    }
    timer = setTimeout(() => finish(null), 10_000)
    subscription = subscribeWorkspaceStream(gateway, logger, (frame) => {
      if (frame.type !== 'baseline') return
      finish(frame.pinnedSessionIds ?? null)
    })
  })
}

export const OFFICIAL_PIN_SUITE: LabSuite = {
  id: 'F-70',
  phase: 'new-feature',
  name: '置顶在 dsh-one 与官方 web 之间是同一份（#240）：0.1.7 起读写官方注册表 + 旧代补写迁移 + 幂等',
  expect:
    '真网关（只读会话数据；夹具的会话 id / 标题从网关的 `session/list` 取，不从自有树取）+ 假宿主（状态存储只放我们注入的 `pinned` 键）。① **补写迁移**——往假宿主注入自有 `pinned` = 某条真会话（旧代那份状态）后开自有树那一页（0.1.7 及以上还要读官方那一页）：官方那一页上这条会话**带着官方自己的置顶标记**、并排到它所在组的第一行（说明补写真的写进了官方工作区注册表），同时自有键被划成空集合；0.1.6 及以下（本机这一版没有官方置顶状态）则反过来——自有键原样保留 `{version:1,sessionIds:[…]}`、整轮零 pin 类 API 调用，这就是「旧代行为不变」的读数。② **幂等**——同一页重载一次（假宿主状态被初始化脚本重置回注入值，等于又开一页）时 pin 类 API 调用**零新增**，自有键与置顶读数都不动。③ **两个方向**（要自有树渲染得出来才跑得到，0.1.7-alpha.2 上自有树因官方图标改名整片起不来、另立 #236，那时留一条显式事实）：在自有树上置顶一条真会话，官方那一页（重载）上它同样排到组内第一并带官方置顶标记；在官方那一页上取消置顶，自有树（重载）上它不再置顶。④ **收尾还原**：套件自己置顶过的会话全部取消（官方那一页不再有任何置顶标记），实例回到开场那份状态。全程零 pageerror。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const shot = async (page: Page, name: string): Promise<void> => {
      const file = path.join(ctx.shots, `${name}.png`)
      await fsp.mkdir(ctx.shots, { recursive: true })
      await page.screenshot({ path: file })
      screenshots.push(file)
    }

    // 一、夹具：从**网关**取真会话（不从自有树取，见文件头「夹具为什么不从自有树里取」）。
    // 要一组「同一个工作区里至少两条有标题的会话」——置顶前后能看出组内次序变化。
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

    // 这一代网关有没有官方置顶集合（外面看的那一条判据，见 `gatewayPinSet`）。
    const wirePinSet = await gatewayPinSet(ctx.lab.gateway)
    const registryGeneration = wirePinSet !== null
    check.fact(
      registryGeneration
        ? `网关的工作区流基线带着置顶集合（${String(wirePinSet.length)} 条）——这一代有官方置顶状态（0.1.7-alpha.1 起）`
        : '网关的工作区流基线里没有置顶集合这一格——这一代没有官方置顶状态（0.1.6 及以下）',
    )

    // 二、开三页：自有树那一页（带注入的自有 pinned 键）、官方那一页（读官方渲染）。
    const own = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), {
      width: 380,
      height: 900,
      state: { pinned: { version: 1, sessionIds: [migrateTarget.sessionId] } },
    })
    const official = await openTreePage(ctx.browser, ctx.lab, route('sidebar-official'), { width: 380, height: 900 })
    try {
      await expandOwn(own.page)
      await expandOfficial(official.page)

      // ---- ① 补写迁移 ----
      const officialAfterMigration = await waitFor(
        () => officialRows(official.page),
        (list) => list.some((row) => row.title === titleOf(migrateTarget) && row.pinned),
      )
      const migratedOfficialRow = officialAfterMigration.find((row) => row.title === titleOf(migrateTarget))
      // 补写成功后插件会把自有键划空（失败的留着下次再试），写回是异步的——等一拍。
      const expectedKey = registryGeneration
        ? { version: 1, sessionIds: [] }
        : { version: 1, sessionIds: [migrateTarget.sessionId] }
      const ownKey = await waitFor(
        () => hostState(own.page, 'pinned'),
        (value) => JSON.stringify(value) === JSON.stringify(expectedKey),
      )
      check.ok(
        registryGeneration
          ? '迁移：官方那一页显示这条会话置顶（补写真的进了官方工作区注册表，且官方自己的置顶标记出来了）'
          : '迁移：本机这一版没有官方置顶状态可核（0.1.6 及以下，这一档由 0.1.7-alpha.2 上的同一套件覆盖，按不适用通过）',
        registryGeneration ? migratedOfficialRow?.pinned === true : true,
        `官方读数=${JSON.stringify(migratedOfficialRow ?? null)} 自有键=${JSON.stringify(ownKey)}`,
      )
      check.ok(
        registryGeneration
          ? '迁移：补写之后它在自己那一组里排第一（官方那条前置规则生效）'
          : '迁移：旧代跳过官方那一页的排序对照（无官方置顶状态）',
        registryGeneration ? migratedOfficialRow?.index === 0 : true,
        `组内第 ${String(migratedOfficialRow?.index ?? -1)} 行（组=${migratedOfficialRow?.group ?? ''}）`,
      )
      check.ok(
        registryGeneration
          ? '迁移收尾：自有 pinned 键被划成空集合（一次性；此后以官方为准）'
          : '迁移收尾：旧代自有 pinned 键原样保留（自有键仍是权威，行为不变）',
        JSON.stringify(ownKey) === JSON.stringify(expectedKey),
        `pinned=${JSON.stringify(ownKey)} expected=${JSON.stringify(expectedKey)}`,
      )
      await shot(official.page, 'official-pin-migration')

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

      // ---- ③ 自有树那一侧（要树渲染得出来；0.1.7-alpha.2 上因 #236 不渲染，留显式事实）----
      const ownNow = await ownRows(own.page)
      const ownFlat = ownNow.flatMap((group) => group.sessions.map((row) => ({ ...row, key: group.key })))
      const ownMigratedRow = ownFlat.find((row) => row.id === migrateTarget.sessionId)
      check.fact(
        ownFlat.length === 0
          ? '自有树这一版没有渲染出任何会话行（侧栏槽位整片起不来）——第 ③ 组的三条没跑到'
          : `自有树渲染出 ${String(ownFlat.length)} 条会话行（${String(ownNow.length)} 个分组）`,
      )
      if (ownFlat.length === 0) {
        check.fact('③ 的方向一（自有树置顶 → 官方那一页）没跑到：这一版自有树不渲染')
        check.fact('③ 的方向二（官方那一页取消置顶 → 自有树）没跑到：这一版自有树不渲染')
        check.fact('③ 的「自有树那一行按官方状态显示图钉」没跑到：这一版自有树不渲染')
      } else {
        check.ok(
          '方向零：注入的自有置顶那一行在自有树上带图钉（两代都成立）',
          ownMigratedRow?.pinned === true,
          JSON.stringify(ownMigratedRow ?? null),
        )
        const ownGroup = ownNow.find((group) => group.sessions.some((row) => row.id === directionTarget.sessionId))
        if (ownGroup === undefined) {
          check.ok('③ 方向一：方向目标在自有树上找得到', false, JSON.stringify(ownFlat.map((row) => row.id.slice(0, 12))))
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
      }

      // ---- ④ 收尾：把套件自己置顶过的那条也取消，实例回到开场那份状态 ----
      if (registryGeneration) {
        const cleanupButton = await officialPinButton(official.page, titleOf(migrateTarget))
        if (cleanupButton !== null) {
          await cleanupButton.click()
          await official.page.waitForTimeout(600)
        }
      }
      const finalOfficial = await waitFor(
        () => officialRows(official.page),
        (list) => !registryGeneration || list.every((row) => !row.pinned),
      )
      check.ok(
        registryGeneration
          ? '收尾：官方那一页上已经没有置顶行（套件自己置顶过的都取消了，实例回到开场那份状态）'
          : '收尾：旧代没有官方置顶状态要还原（本机这一版只动过假宿主里的自有键）',
        registryGeneration ? finalOfficial.every((row) => !row.pinned) : true,
        `仍置顶=${JSON.stringify(finalOfficial.filter((row) => row.pinned).map((row) => row.title))}`,
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
