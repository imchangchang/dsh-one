/**
 * 工作区行尾角标的第三项「未读」（#153）。
 *
 * ## 为什么单独一个套件
 *
 * 这枚角标是**自有功能**（官方工作区行没有这一层），而且第三项不是「再加一个数字」那么简单：
 * 它的数据源是另一份状态（客户端那份手动未读集合，不是官方「跑完还没被打开」的 `completed`），
 * 它的桶与另两枚**互斥**（每个会话只进一个桶，优先级 等待交互 > 运行中 > 未读——与旧侧栏
 * 的工作区组头 `appendWorkspaceCounts`、折叠标签组头的 `tagGroupCounts` 同一份规则），
 * 它还会把角标从两枚撑到三枚（宽度一变，标题那一行就多一分被挤的风险）。F-39 判的是「整枚
 * 角标跟不跟标题文字走」（那一套是按几何关系写的，与计数有几个无关），三档各自的口径与读数
 * 归本套件。
 *
 * ## 夹具为什么必须自控
 *
 * 本机网关当天的会话里有没有跑着的、有没有等着的，都不由我们决定；手动未读更是用户的东西。
 * 所以本套件**一条断言都不吃当天数据**：
 * - **空闲与运行中**用官方那条口子造——往页面的官方转发事件流投官方 `api-session/status` 帧
 *   （夹具在 `pendingDotSuites.ts` 里，F-43 写的，这里复用同一份），**不写网关**；
 * - **等待交互**用同一条口子上的一条官方 `approval/request` 瀑布帧（同一份夹具，注入的
 *   `eventId` 网关不知道，页面永远不会把结果回给网关）；
 * - **手动未读**用假宿主的状态存储直接注（`state: { unread: … }`，与 F-14 / F-46 同一套）；
 * - 目标工作区是**当天树上真有**的那个（挑「同一工作区里有 ≥2 条空闲会话」的那一组），
 *   找不到就记一条事实跳过——不为凑夹具去建会话（网关只读）。
 *
 * ## 计数口径的三条判据（读断言时先看这几条）
 *
 * - **同源**：角标数的是「展开后看得见的行」，判据是页面上的两个数直接比——这一组里带未读标记
 *   （`.dshOneTree_unread`）的**可见**行数 = 角标第三项。注进未读集合的 id 里，树里看不见的
 *   （当天的鬼 id、被挪进本地回收站的那一条）一个都不进这个数。
 * - **互斥**：同一个会话先标未读、再被推成运行中/等待交互，它就从「未读」那一格挪走——
 *   三个数字的和恒等于树上这批会话里「有事在身」的条数。
 * - **全零不渲染**：三档都为 0 时那个工作区的行上**整枚角标不在场**（不是渲染成空壳）。
 *
 * ## 悬停与读屏文案
 *
 * 三枚各自带 `title`（悬停给的就是它；无其它无障碍名时它同时就是这一项的无障碍名——
 * 与既有两枚、与折叠组头那三枚计数同一处置，本套件没有新造一套读屏机制）。文案从插件词典读
 * （`activity.running` / `activity.waiting` / `activity.unread`），**中英两份都断言存在**
 * 且都带 `{n}`；页面上那一枚的取值随页面语言（日常实例 zh、空的隔离网关 en），两种都收。
 *
 * 全程只读网关：注入的帧网关不知道、页面也不回执；本套件不点任何写类动作。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import type { Page } from 'playwright'
import { emit, installEventStreamInjector, openTreePage, waitForEventStream, withoutKnownNoise, type OpenedPage } from './harness.ts'
import { LAB_TREES, type LabTreeRoute } from './labServer.ts'
import { SCALE_TIERS } from '../../src/ui/assembly/shell/workspaceTree/styles.ts'
import { EN, ZH } from '../../src/ui/assembly/shell/workspaceTree/locale.ts'
import { expandAllWorkspaces, waterfall } from './pendingDotSuites.ts'
import { listSessions } from '../../src/server/dshRpc.ts'
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

/** 三档宽度（与 F-04 / F-13 / F-29 / F-37 / F-39 同一套：窄 / 用户侧栏 / 宽）。 */
const WIDTHS = [260, 340, 500] as const

/** 角标左缘与标题文字右缘之间那一格：档位表标准档的行内间隙（与 F-39 同源）。 */
const GAP = Number.parseFloat(SCALE_TIERS.standard.rowGap)

/** 三枚各自的标记属性名（DOM 顺序 = 渲染顺序）。 */
const MARKS = ['running', 'waiting', 'unread'] as const

/** 一枚计数的读数（数 + 悬停文案 + 里面那枚官方 `StateDot` 的事实）。 */
interface BadgeItemFacts {
  count: number
  title: string
  dotState: string
  dotColor: string
}

/** 一个分组区块的读数（角标 + 它的三枚 + 可看见的会话行）。 */
interface GroupFacts {
  key: string
  /** 角标读数（`运行中/等待/未读`）；三档全 0 时是 null（整枚不渲染）。 */
  activity: string | null
  /** 角标里实际渲染出来的枚数（按 DOM 顺序）。 */
  items: (typeof MARKS)[number][]
  /** 逐枚读数（没渲染的枚不出现在这里）。 */
  byMark: Partial<Record<(typeof MARKS)[number], BadgeItemFacts>>
  /** 区块里可见的会话行。 */
  sessions: { id: string; status: string; unread: boolean; dotColor: string }[]
}

/** 页面上每个分组区块的现状（一次 evaluate 里读全，避免多次读数之间页面漂移）。 */
async function readGroups(page: Page): Promise<GroupFacts[]> {
  const read = await page.evaluate(
    ({ marks }) => {
      return Array.from(document.querySelectorAll('[data-dshone-group-key]')).map((section) => {
        const row = section.querySelector('[data-dshone-tree-row="workspace"]')
        const badge = row?.querySelector('[data-dshone-tree-activity]') ?? null
        const items: string[] = []
        const byMark: Record<string, unknown> = {}
        for (const child of Array.from(badge?.children ?? [])) {
          const mark = marks.find((name) => child.hasAttribute(`data-dshone-tree-${name}`))
          if (mark === undefined) continue
          items.push(mark)
          const dot = child.querySelector('[data-state]')
          byMark[mark] = {
            count: Number(child.getAttribute(`data-dshone-tree-${mark}`) ?? '-1'),
            title: child.getAttribute('title') ?? '',
            dotState: dot?.getAttribute('data-state') ?? '',
            dotColor: dot === null ? '' : getComputedStyle(dot).color,
          }
        }
        const sessions = Array.from(section.querySelectorAll('[data-dshone-tree-row="session"]')).map((session) => {
          const title = session.querySelector('.dshOneTree_title')
          const dot = session.querySelector('[data-state]')
          return {
            id: session.getAttribute('data-dshone-tree-session') ?? '',
            status: session.getAttribute('data-dshone-tree-status') ?? '',
            unread: (title?.className ?? '').includes('dshOneTree_unread'),
            dotColor: dot === null ? '' : getComputedStyle(dot).color,
          }
        })
        return {
          key: row?.getAttribute('data-dshone-tree-key') ?? section.getAttribute('data-dshone-group-key') ?? '',
          activity: badge?.getAttribute('data-dshone-tree-activity') ?? null,
          items,
          byMark,
          sessions,
        }
      })
    },
    { marks: MARKS as unknown as string[] },
  )
  return read as GroupFacts[]
}

/** 某一组的读数（组 key 不在页面上时是 undefined）。 */
const groupOf = (groups: readonly GroupFacts[], key: string): GroupFacts | undefined =>
  groups.find((group) => group.key === key)

/** 等某一组的角标读数到期望值（帧 → 插件状态 → 快照 → 重渲染之间有一段异步链）。 */
async function waitForActivity(page: Page, key: string, expected: string, timeoutMs = 8_000): Promise<GroupFacts | undefined> {
  const deadline = Date.now() + timeoutMs
  let found = groupOf(await readGroups(page), key)
  while (found?.activity !== expected && Date.now() < deadline) {
    await page.waitForTimeout(150)
    found = groupOf(await readGroups(page), key)
  }
  return found
}

/** 一枚角标项的几何与它的上下文（三档宽度下逐档量）。 */
interface BadgeGeometry {
  badge: { x: number; y: number; w: number; h: number; right: number; bottom: number }
  title: { x: number; y: number; w: number; h: number; right: number }
  projectText: { x: number; w: number }
  text: { x: number; right: number; clipped: boolean }
  /** 三枚各自垂直中心（判「同一行」）。 */
  centers: number[]
  /** 行尾那一层里可见件的矩形（当前工作区胶囊；没有就是 null）。 */
  rowEnd: { x: number; y: number; w: number; h: number; right: number } | null
  listOverflow: { scrollWidth: number; clientWidth: number }
  docOverflow: { scrollWidth: number; clientWidth: number }
}

async function readGeometry(page: Page, key: string): Promise<BadgeGeometry | null> {
  return page.evaluate((groupKey: string) => {
    const round = (value: number): number => Math.round(value * 100) / 100
    const rectOf = (element: Element | null): { x: number; y: number; w: number; h: number; right: number; bottom: number } => {
      if (element === null) return { x: 0, y: 0, w: 0, h: 0, right: 0, bottom: 0 }
      const rect = element.getBoundingClientRect()
      return {
        x: round(rect.x),
        y: round(rect.y),
        w: round(rect.width),
        h: round(rect.height),
        right: round(rect.right),
        bottom: round(rect.bottom),
      }
    }
    const row = document.querySelector(`[data-dshone-tree-key="${groupKey}"]`)
    if (row === null) return null
    const badge = row.querySelector('[data-dshone-tree-activity]')
    const title = row.querySelector('.dshOneTree_title')
    const projectText = row.querySelector('.dshOneTree_projectText')
    const text = row.querySelector('.dshOneTree_titleText')
    const rowEnd = row.querySelector('.dshOneTree_rowEnd')
    const list = document.querySelector('.dshOneTree_list')
    const overflowOf = (element: Element | null): { scrollWidth: number; clientWidth: number } =>
      element === null ? { scrollWidth: 0, clientWidth: 0 } : { scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }
    const centers = Array.from(badge?.children ?? []).map((child) => {
      const rect = child.getBoundingClientRect()
      return round(rect.y + rect.height / 2)
    })
    const endRect = rectOf(rowEnd)
    return {
      badge: rectOf(badge),
      title: rectOf(title),
      projectText: { x: round(projectText?.getBoundingClientRect().x ?? 0), w: round(projectText?.getBoundingClientRect().width ?? 0) },
      text: {
        x: round(text?.getBoundingClientRect().x ?? 0),
        right: round(text?.getBoundingClientRect().right ?? 0),
        clipped: text !== null && text.scrollWidth > text.clientWidth + 1,
      },
      centers,
      // 行尾那一层里**有东西**时（当前工作区胶囊）才拿来判不重叠；空层给 null。
      rowEnd: rowEnd === null || rowEnd.children.length === 0 ? null : endRect,
      listOverflow: overflowOf(list),
      docOverflow: overflowOf(document.documentElement),
    }
  }, key)
}

/** 词典里那一条文案（`{n}` 代入计数；中英两种取值都收，页面语言随环境）。 */
const activityTexts = (key: 'activity.running' | 'activity.waiting' | 'activity.unread', n: number): string[] =>
  [ZH[key], EN[key]].map((text) => (text ?? '').replace('{n}', String(n)))

export const UNREAD_COUNT_SUITE: LabSuite = {
  id: 'F-52',
  phase: 'new-feature',
  name: '工作区行尾角标的第三项「未读」（#153）：三档口径、互斥、全零不渲染与三档宽度下的几何（UNREAD-COUNT 套件）',
  expect:
    '#153：工作区行尾那枚**自有**角标从两项（运行中 / 等待交互）补回旧侧栏就有的第三项「未读」，三枚同一枚官方 `StateDot`、同一档字号与间隙、同一个容器。真装配页 + 真网关**只读** + 假宿主 + 官方那条口子的帧（`api-session/status` 造运行中、`approval/request` 瀑布帧造等待交互，复用 F-43 的夹具）+ 假宿主状态存储注手动未读集合（F-14 同一套），**一条判据都不吃当天数据**（只挑当天树上真有「同一工作区 ≥2 条空闲会话」的那一组当夹具）：① **三档读数与注入的集合逐项一致**——只注未读集合时读数是 `0/0/N`（只有未读那一枚渲染），推一条成运行中后是 `1/0/N-1`（那条从「未读」挪进「运行中」= 互斥优先级，与旧侧栏组头同一份规则），再对另一条投等待帧后是 `1/1/N-2`；三枚的 DOM 顺序恒为 运行中 → 等待交互 → 未读（既有两枚不动、新的一枚接在最后）；② **同源**——这一组里带未读标记（`.dshOneTree_unread`）的**可见**行数 = 角标第三项，注进集合但树里看不见的 id（当天的鬼 id、被夹具挪进本地回收站的那一条）一个都不进这个数；③ **某枚为 0 时它自己不渲染而别的照常**（等待帧取消后未读那一枚还在、运行中那一枚照旧；未读归零的那一态里它不渲染而另两枚照常）；④ **三档全 0 时整枚角标不在场**（另一个当天全空闲的工作区的行上 `data-dshone-tree-activity` 根本不存在）；⑤ **悬停/读屏文案**——三枚各自的 `title` = 插件词典那一句（页面语言随环境，zh/en 都收），且词典的中英两份都在、都带 `{n}`；⑥ **三枚与状态点同形**——角标里未读那一枚的点与那条会话行自己的绿点是同一个 `data-state` 与同一个解析色（同一枚官方 `StateDot`，不写死色值）；⑦ **三档宽度（260/340/500）下不挤坏标题、不溢出**——角标整个落在标题盒里、角标左缘 − 标题文字右缘 = 档位表标准档的行内间隙（±1px）、三枚垂直中心一致（±1px，同一行）、标题盒仍撑满 `projectText`（三枚没能把它挤窄）、列表与文档 `scrollWidth ≤ clientWidth + 1`，且角标不与行尾那枚「当前工作区」胶囊重叠。全程零 pageerror；本套件不点任何写类动作、不写网关。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    // ---- 页面一：只读地摸清当天树上的行，挑夹具目标 ----
    // 挑法：同一工作区里**至少两条空闲会话**（一条留给「运行中」、一条留给「等待交互」；
    // 第三条留给「未读」那一格不被挪走；再多一条用来验「挪进回收站的不计」）。
    // 为什么按空闲挑：这个套件要证的是「三档各自的计数 = 注入的集合」，起点必须是三档全 0，
    // 否则读数会被当天真跑着的会话污染。
    const probe = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { width: 340, height: 900 })
    let groups: GroupFacts[] = []
    try {
      await expandAllWorkspaces(probe.page)
      groups = await readGroups(probe.page)
    } finally {
      await probe.context.close()
    }
    check.fact(
      `当天树上的分组：${JSON.stringify(
        groups.map((group) => ({
          key: group.key.slice(0, 8),
          rows: group.sessions.length,
          idle: group.sessions.filter((session) => session.status === 'idle').length,
          activity: group.activity,
        })),
      )}`,
    )
    const candidates = groups
      .map((group) => ({ group, idle: group.sessions.filter((session) => session.status === 'idle') }))
      .filter((entry) => entry.idle.length >= 2)
      .sort((left, right) => right.idle.length - left.idle.length)
    const target = candidates[0]
    check.ok(
      '当天树上有「同一工作区里 ≥2 条空闲会话」的分组（未读这一项的夹具要有行可标）',
      target !== undefined,
      `candidates=${String(candidates.length)} groups=${String(groups.length)}`,
    )
    if (target === undefined) {
      check.fact('没有可用于夹具的干净分组——本套件跳过（真网关只读，不为凑夹具去造会话）')
      return screenshots
    }
    // 参考物：另一个**当天全空闲、此刻也没有角标**的分组（验「三档全 0 时整枚角标不在场」）。
    const cleanRef = groups.find((group) => group.activity === null && group.sessions.length > 0 && group.key !== target.group.key)
    /** 标为未读的三条（第一条留给「运行中」、第二条留给「等待交互」、第三条一直留在「未读」）。 */
    const marked = target.idle.slice(0, 3).map((session) => session.id)
    const [firstMarked, secondMarked] = marked
    const spare = target.idle[3]?.id ?? null
    /** 注进未读集合的 id：真有、树里也看得见的那些 + 一个树里绝不会有的鬼 id。 */
    const ghostId = 'lab-ghost-unread-session'
    const injectedUnread = [...marked, ...(spare === null ? [] : [spare]), ghostId]
    check.fact(
      `夹具目标：工作区「${target.group.key}」（${String(target.group.sessions.length)} 行、${String(target.idle.length)} 条空闲）；标未读 ${JSON.stringify(marked.map((id) => id.slice(0, 8)))}、` +
        `另注鬼 id 一个${spare === null ? '' : `、第 ${String(marked.length + 1)} 条空闲会话挪进回收站`}；对照组工作区 ${cleanRef?.key.slice(0, 8) ?? '（当天没有全空闲的分组）'}`,
    )
    check.ok(
      '夹具：未读集合注的是当天树上真有的空闲会话（≥2 条）',
      marked.length >= 2,
      `marked=${JSON.stringify(marked)}`,
    )

    // 让假宿主把这一组报成「当前工作区」（`workspaceFolders` = 那一条会话的 cwd，与 F-39
    // 同一处置）：行尾多一枚胶囊 = 标题那一格最挤的现场，第三枚进来之后还挤不挤得坏，
    // 只有在这个现场里量才算数。
    const sessions = await listSessions(ctx.lab.gateway).catch(() => [])
    const cwd = sessions.find((session) => session.sessionId === firstMarked)?.cwd ?? ''
    check.fact(`夹具：假宿主上报的「打开的文件夹」= ${cwd === '' ? '（拿不到 cwd，这一组不当当前工作区）' : cwd}`)

    const opened = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), {
      width: 340,
      height: 900,
      ...(cwd === '' ? {} : { workspaceFolders: [cwd] }),
      state: {
        unread: { version: 1, sessionIds: injectedUnread },
        ...(spare === null ? {} : { 'recycle-bin': { version: 1, sessionIds: [spare] } }),
      },
    })
    const { page } = opened
    try {
      // 官方那条口子的注入夹具要在页面连网关**之前**装好，所以装完重载一次。
      const injector = await installEventStreamInjector(page)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector(route('sidebar').readySelector, { timeout: 40_000 })
      await page.waitForTimeout(2_000)
      check.ok('官方转发事件流（`$events`）就绪（运行中 / 等待交互两档靠它造）', await waitForEventStream(injector, page), JSON.stringify(injector.stats()))
      await expandAllWorkspaces(page)

      const key = target.group.key
      // ---- ① 只注了未读集合：三档里只有未读 > 0 ----
      const baseline = await waitForActivity(page, key, `0/0/${String(marked.length)}`)
      const baselineItems = baseline?.items ?? []
      check.fact(`① 基线：${key.slice(0, 8)} 角标=${baseline?.activity ?? '无'} 枚=${baselineItems.join(',')} 逐枚=${JSON.stringify(baseline?.byMark)}`)
      check.eq('① 只注未读集合时读数是 运行中 0 / 等待 0 / 未读 = 注入条数', baseline?.activity, `0/0/${String(marked.length)}`)
      check.eq('① 只渲染未读那一枚（另两枚为 0 → 它们自己不渲染）', baselineItems, ['unread'])
      check.eq('① 未读那一枚的读数是注入的可见条数（集合里的鬼 id 不算）', baseline?.byMark.unread?.count, marked.length)
      // 悬停 / 读屏文案：三枚共用一套（这里是未读那一枚）。
      check.ok(
        '① 未读那一枚的悬停文案 = 插件词典那一句（N 代入）',
        activityTexts('activity.unread', marked.length).includes(baseline?.byMark.unread?.title ?? ''),
        `title=${JSON.stringify(baseline?.byMark.unread?.title ?? '')} expected=${JSON.stringify(activityTexts('activity.unread', marked.length))}`,
      )
      check.ok(
        '① 词典的中英两份都在、都带 {n}（文案不漏一国）',
        MARKS.every((mark) => [ZH, EN].every((dict) => (dict[`activity.${mark}`] ?? '').includes('{n}'))),
        JSON.stringify(MARKS.map((mark) => [mark, ZH[`activity.${mark}`], EN[`activity.${mark}`]])),
      )
      // 与那条会话行自己的绿点同形（同一枚官方 `StateDot`，颜色不写死、直接比）。
      const boldRows = baseline?.sessions.filter((session) => session.unread) ?? []
      const boldDotColor = boldRows.map((session) => session.dotColor).find((color) => color !== '') ?? ''
      check.eq(
        '① 同源：这一组里带未读标记的可见行数 = 角标第三项（回收站里那条与会话行都数不到鬼 id）',
        boldRows.length,
        marked.length,
      )
      check.ok(
        `① 未读那一枚用的是官方 done 绿点，且与那条会话行自己的绿点同色（同一枚 \`StateDot\`）`,
        baseline?.byMark.unread?.dotState === 'done' && baseline.byMark.unread.dotColor === boldDotColor && boldDotColor !== '',
        JSON.stringify({ badge: baseline?.byMark.unread ?? null, row: boldDotColor, bold: boldRows.map((session) => session.id.slice(0, 8)) }),
      )
      screenshots.push(await shot(ctx, page, 'unread-count-baseline'))

      // ---- ④ 三档全 0 的行上整枚角标不在场 ----
      if (cleanRef === undefined) {
        check.fact('④ 当天没有「全空闲且没有角标」的第二个分组可供对照——这一段跳过')
      } else {
        const clean = groupOf(await readGroups(page), cleanRef.key)
        check.fact(`④ 对照组：${cleanRef.key.slice(0, 8)} 角标=${clean?.activity ?? '无'} 行=${String(clean?.sessions.length ?? -1)}`)
        check.eq('④ 三档全 0 的工作区行上整枚角标不渲染（不是空壳）', clean?.activity ?? null, null)
      }

      // ---- ② 一条转运行中：它从「未读」挪进「运行中」 ----
      if (firstMarked === undefined || secondMarked === undefined) throw new Error('lab: fixture needs two idle sessions')
      injector.push(emit('api-session/status', [firstMarked, true]))
      const running = await waitForActivity(page, key, `1/0/${String(marked.length - 1)}`)
      check.fact(`② 推一条成运行中：角标=${running?.activity ?? '无'} 枚=${(running?.items ?? []).join(',')}`)
      check.eq('② 一条转运行中后读数是 1/0/N-1（那条从「未读」挪走 = 互斥优先级）', running?.activity, `1/0/${String(marked.length - 1)}`)
      check.eq('② 运行中那一枚接在未读那一枚前面（既有两枚的顺序不动）', running?.items ?? [], ['running', 'unread'])
      check.ok(
        '② 运行中那一枚的悬停文案 = 词典那一句',
        activityTexts('activity.running', 1).includes(running?.byMark.running?.title ?? ''),
        `title=${JSON.stringify(running?.byMark.running?.title ?? '')}`,
      )
      check.eq(
        '② 同源：带未读标记的行少了「已经在跑的那一条」那一枚（角标把互斥算对了）',
        (running?.sessions.filter((session) => session.unread) ?? []).length,
        marked.length,
      )

      // ---- ③ 再投一条等待帧：等待交互那一枚也进来 ----
      const approvalId = 'lab-unread-approval-1'
      const expectedWaiting = `1/1/${String(marked.length - 2)}`
      injector.push(
        waterfall('approval/request', approvalId, secondMarked, {
          toolName: 'bash',
          callId: 'lab-unread-call-1',
          reason: 'lab fixture',
        }),
      )
      const waiting = await waitForActivity(page, key, expectedWaiting)
      check.fact(`③ 再投一条等待帧：角标=${waiting?.activity ?? '无'} 枚=${(waiting?.items ?? []).join(',')} 逐枚=${JSON.stringify(waiting?.byMark)}`)
      check.eq('③ 读数是 1/1/N-2（等待那一枚进来、对应会话从「未读」挪走）', waiting?.activity, expectedWaiting)
      check.ok(
        '③ 三枚的 DOM 顺序恒为 运行中 → 等待交互 → 未读',
        JSON.stringify(waiting?.items ?? []) === JSON.stringify(['running', 'waiting', 'unread'].slice(0, waiting?.items.length ?? 0)),
        JSON.stringify(waiting?.items ?? []),
      )
      check.ok(
        '③ 等待交互那一枚的悬停文案 = 词典那一句',
        activityTexts('activity.waiting', 1).includes(waiting?.byMark.waiting?.title ?? ''),
        `title=${JSON.stringify(waiting?.byMark.waiting?.title ?? '')}`,
      )
      if (marked.length >= 3) {
        check.eq('③ 注入量够时三枚同时在场（运行中 / 等待交互 / 未读各 1）', waiting?.items ?? [], ['running', 'waiting', 'unread'])
      } else {
        check.eq('③ 未读归零时那一枚不渲染、另两枚照常（某枚为 0 只影响它自己）', waiting?.items ?? [], ['running', 'waiting'])
      }

      // ---- ⑤ 三档宽度：三枚同时在场的这一态下量几何 ----
      // 先钉住这一轮确实是最挤的现场（行尾有「当前工作区」胶囊），否则「不压字」那两条
      // 判得比现场的紧张度松。
      if (cwd === '') {
        check.fact('⑤ 假宿主没上报文件夹（拿不到 cwd）→ 这一轮行尾没有胶囊，最挤的现场没造出来；「不与胶囊重叠」那一条按无胶囊处理')
      } else {
        const capsule = (await readGeometry(page, key))?.rowEnd ?? null
        check.ok(
          '⑤ 假宿主上报的文件夹让这一行成了「当前工作区」（行尾那枚胶囊在场 = 第三枚进来后最挤的现场）',
          capsule !== null,
          JSON.stringify(capsule),
        )
      }
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 })
        await page.waitForTimeout(300)
        const geometry = await readGeometry(page, key)
        if (geometry === null) {
          check.ok(`⑤ w=${String(width)}：那一行还在`, false, 'row gone')
          continue
        }
        check.fact(`⑤ w=${String(width)} 几何：${JSON.stringify(geometry)}`)
        check.ok(
          `⑤ w=${String(width)}：角标整个落在标题盒里（没被行尾或行盒裁掉）`,
          geometry.badge.right <= geometry.title.right + 1 && geometry.badge.x >= geometry.title.x - 1,
          JSON.stringify({ badge: geometry.badge, title: geometry.title }),
        )
        check.ok(
          `⑤ w=${String(width)}：角标左缘 − 标题文字右缘 = 档位表的行内间隙（${String(GAP)}px ±1）`,
          Math.abs(geometry.badge.x - geometry.text.right - GAP) <= 1,
          JSON.stringify({ gap: Math.round((geometry.badge.x - geometry.text.right) * 100) / 100, expected: GAP }),
        )
        check.ok(
          `⑤ w=${String(width)}：三枚在同一行（垂直中心极差 ≤ 1px）`,
          geometry.centers.length >= 2 && Math.max(...geometry.centers) - Math.min(...geometry.centers) <= 1,
          JSON.stringify(geometry.centers),
        )
        check.ok(
          `⑤ w=${String(width)}：标题盒仍撑满 projectText（三枚没有把它挤窄）`,
          Math.abs(geometry.title.w - geometry.projectText.w) <= 1 && Math.abs(geometry.title.x - geometry.projectText.x) <= 1,
          JSON.stringify({ title: geometry.title.w, projectText: geometry.projectText.w }),
        )
        check.ok(
          `⑤ w=${String(width)}：角标不与行尾那枚「当前工作区」胶囊重叠`,
          geometry.rowEnd === null ||
            geometry.badge.right <= geometry.rowEnd.x + 0.5 ||
            geometry.badge.x >= geometry.rowEnd.right - 0.5,
          JSON.stringify({ badge: geometry.badge, rowEnd: geometry.rowEnd }),
        )
        check.ok(
          `⑤ w=${String(width)}：不横向溢出`,
          geometry.listOverflow.scrollWidth <= geometry.listOverflow.clientWidth + 1 &&
            geometry.docOverflow.scrollWidth <= geometry.docOverflow.clientWidth + 1,
          JSON.stringify({ list: geometry.listOverflow, doc: geometry.docOverflow }),
        )
        if (width === 340) screenshots.push(await shot(ctx, page, 'unread-count-three-items-340'))
        if (width === 260) screenshots.push(await shot(ctx, page, 'unread-count-three-items-260'))
      }
      await page.setViewportSize({ width: 340, height: 900 })
      await page.waitForTimeout(300)

      // ---- ③（收尾）取消帧一到就回到上一态：不留假计数 ----
      injector.push({ type: 'cancel', eventId: approvalId })
      const afterCancel = await waitForActivity(page, key, `1/0/${String(marked.length - 1)}`)
      check.fact(`③ 取消等待帧后：角标=${afterCancel?.activity ?? '无'} 枚=${(afterCancel?.items ?? []).join(',')}`)
      check.eq('③ 取消帧一到就回到上一态（等待那一枚消失、未读那一枚回来）', afterCancel?.activity, `1/0/${String(marked.length - 1)}`)
      check.eq('③ 取消之后未读那一枚照常渲染（某枚为 0 只影响它自己）', afterCancel?.items ?? [], ['running', 'unread'])

      const errors = withoutKnownNoise(opened.capture.pageErrors)
      check.eq('全程零 pageerror', errors.real, [])
      if (errors.noise.length > 0) check.fact(`（已知噪音 ${String(errors.noise.length)} 条，见 KNOWN_NOISE）`)
    } finally {
      await opened.context.close()
    }
    return screenshots
  },
}
