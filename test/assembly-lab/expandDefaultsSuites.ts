/**
 * 展开态补齐（#151）：首开默认态、空工作区行的可收可展、以及「用户手动改过的态不许被
 * 自动展开顶回来」。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与 `recycleEntrySuites.ts` / `scaleSuites.ts`
 * 同一条：那个文件是本批开发的合入热点，新套件放外面能少一半冲突面。注册方式是在
 * `suites.ts` 的 `SUITES` 末尾追加一项。
 *
 * **口径来自官方实测**（#151 的原文要求先核官方，用户反复定过「跟官方一致」）：
 * - 官方侧栏（`dsh-client-ui-ui-workspace` 的 `WorkspaceBrowser`，正是我们在
 *   `sidebar.workspaces` 槽位 shadow 掉的那一件）**首开只展开当前会话所在那一组**，
 *   其余全折叠——store 的初值是 `groupExpansion: {}`，那条 effect 只在
 *   `Object.hasOwn(groupExpansion, currentGroup)` 为假时展开它。本套件第 ① 段因此
 *   判的不是「全展开」，而是「恰好一组展开、且是当前会话那一组」。
 * - 官方**空工作区行照常可收可展**：`ProjectRowItem` 的整行 `onClick: onToggle`
 *   没有任何「空就不响应」的分支，`aria-expanded` 也照挂。实测记录见 issue #151
 *   的 comment（隔离实例里注册一个零会话工作区，点一下 `aria-expanded` false → true，
 *   记录落 `groupExpansion: {<id>: true}`）。
 *
 * **空工作区这一段的构造**（#161 起自造，不再挑当天数据）：本套件跑在**只读**的真网关上，
 * 不能新建工作区（那会写真数据），所以改成页内夹具改写 `workspace/follow` 的基线帧、自己
 * 声明四棵合成工作区（与 F-21 / F-47 同一套做法）：一棵零会话、一棵的会话全在 `archived`、
 * 一棵的会话全在假宿主的本地回收站、一棵有可见会话作对照。四种状态都造得出来，判据一条都
 * 不吃当天数据。为什么必须自造：旧版挑「树里最后一个有会话的分组」去清空，而树里最后一行
 * 可能是**未分组桶**——散会话那一桶的键是空串，不是注册工作区，没有可见会话时整桶不渲染
 * （`deriveGroups` 只对注册工作区无条件出行，见 `src/pure/workspaceTreeView.ts`），于是夹具
 * 把「桶空了」误判成「树把空工作区丢了」。③ 段现在三档：真网关注册表与树里的行逐项对、
 * 合成夹具造四种状态、官方浏览区同一份数据下的行（判据的出处）。
 *
 * 全程只读真网关：只点工作区行（改本地视图态）、只读 localStorage。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { openTreePage, withoutKnownNoise, type OpenedPage } from './harness.ts'
import { LAB_TREES, consoleLogger, type LabTreeRoute } from './labServer.ts'
import { TREE_VIEW_PREF_KEY } from '../../src/pure/workspaceTreePrefs.ts'
import { listSessions } from '../../src/server/dshRpc.ts'
import { subscribeWorkspaceStream } from '../../src/server/modernStreams.ts'
import type { Logger } from '../../src/log.ts'
// 只取类型（编译后不留 import，运行期没有环）：套件接口定义在 suites.ts 里，它就是调用方。
import type { LabSuite } from './suites.ts'

const route = (name: string): LabTreeRoute => {
  const found = LAB_TREES.find((candidate) => candidate.route === name)
  if (found === undefined) throw new Error(`lab: unknown tree route ${name}`)
  return found
}

/** 三档宽度（与 F-04 / F-13 / F-29 / F-37 / F-39 同一套：窄 / 用户侧栏 / 宽）。 */
const WIDTHS = [260, 340, 500] as const

const WORKSPACE_ROW = '[data-dshone-tree-row="workspace"]'
const SESSION_ROW = '[data-dshone-tree-row="session"]'

interface GroupFacts {
  key: string
  count: string
  expanded: boolean
  current: boolean
  /** 这一组此刻渲染出的会话行 id（折叠时为空表）。 */
  sessions: string[]
}

interface TreeFacts {
  groups: GroupFacts[]
  /** 客户端存储里那份展开记录（`dsh.workspaceTree.view` 的 `groupExpansion`）。 */
  expansion: Record<string, boolean>
  /** 当前会话（`aria-selected="true"` 那一行）所在分组的键；没有当前会话行时为 null。 */
  currentGroupKey: string | null
}

/** 一次读全：分组行、各自的会话行、展开记录、当前会话所在的组。 */
async function treeFacts(page: OpenedPage['page']): Promise<TreeFacts> {
  return page.evaluate(
    ([prefKey, rowSelector, sessionSelector]) => {
      const groups = Array.from(document.querySelectorAll(rowSelector)).map((row) => {
        const section = row.closest('[data-dshone-group-key]') ?? row.parentElement
        return {
          key: row.getAttribute('data-dshone-tree-key') ?? '',
          count: row.getAttribute('data-dshone-tree-count') ?? '',
          expanded: row.getAttribute('aria-expanded') === 'true',
          current: row.getAttribute('data-dshone-tree-current') === 'true',
          sessions:
            section === null
              ? []
              : Array.from(section.querySelectorAll(sessionSelector)).map(
                  (session) => session.getAttribute('data-dshone-tree-session') ?? '',
                ),
        }
      })
      let expansion: Record<string, boolean> = {}
      try {
        const parsed: unknown = JSON.parse(localStorage.getItem(prefKey) ?? 'null')
        if (typeof parsed === 'object' && parsed !== null) {
          const value = (parsed as Record<string, unknown>).groupExpansion
          if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            expansion = value as Record<string, boolean>
          }
        }
      } catch {
        expansion = {}
      }
      const selected = document.querySelector(`${sessionSelector}[aria-selected="true"]`)
      const owner = selected?.closest('[data-dshone-group-key]') ?? null
      return {
        groups,
        expansion,
        currentGroupKey:
          owner === null ? null : owner.querySelector(rowSelector)?.getAttribute('data-dshone-tree-key') ?? null,
      }
    },
    [TREE_VIEW_PREF_KEY, WORKSPACE_ROW, SESSION_ROW] as const,
  )
}

/** 展开态（记录里为 true 的键，按写入顺序）。 */
const expandedKeys = (facts: TreeFacts): string[] =>
  Object.entries(facts.expansion)
    .filter(([, expanded]) => expanded)
    .map(([key]) => key)

/**
 * 点一个分组行，等展开记录跟着变（写回是 effect，不是点击那一刻同步落的）。
 *
 * 为什么等记录而不等 DOM：这一套断言要的正是「点击的结果落在客户端存储里」这件事，
 * 只等 DOM 会把「点了但没写回去」判成通过。
 */
async function toggleGroupRow(page: OpenedPage['page'], key: string): Promise<void> {
  await page.locator(`${WORKSPACE_ROW}[data-dshone-tree-key="${key}"]`).click()
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.waitForTimeout(150)
    const facts = await treeFacts(page)
    const row = facts.groups.find((group) => group.key === key)
    if (row !== undefined && (facts.expansion[key] === true) === row.expanded) return
  }
}

/** 同上下文重载（localStorage 保留），等这一棵树重新挂起来。 */
async function reload(page: OpenedPage['page'], tree: LabTreeRoute): Promise<boolean> {
  await page.reload({ waitUntil: 'domcontentloaded' })
  let ready = true
  try {
    await page.waitForSelector(tree.readySelector, { timeout: 40_000 })
  } catch {
    ready = false
  }
  await page.waitForTimeout(2_500)
  return ready
}

/** 某一个分组行内部那一格折叠箭头的事实（悬停才显形那枚）。 */
async function arrowFacts(
  page: OpenedPage['page'],
  key: string,
): Promise<{ display: string; openClass: boolean; cursor: string; ariaExpanded: string }> {
  await page.locator(`${WORKSPACE_ROW}[data-dshone-tree-key="${key}"]`).hover()
  await page.waitForTimeout(300)
  return page.evaluate(
    ([rowSelector, groupKey]) => {
      const row = document.querySelector(`${rowSelector}[data-dshone-tree-key="${groupKey}"]`)
      const chevron = row?.querySelector('.dshOneTree_chevron') ?? null
      const arrow = chevron?.querySelector('svg') ?? null
      const rowStyle = row === null ? null : getComputedStyle(row)
      return {
        display: chevron === null ? 'missing' : getComputedStyle(chevron).display,
        openClass: (arrow?.getAttribute('class') ?? '').includes('dshOneTree_arrowOpen'),
        cursor: rowStyle?.cursor ?? '',
        ariaExpanded: row?.getAttribute('aria-expanded') ?? '',
      }
    },
    [WORKSPACE_ROW, key] as const,
  )
}

/**
 * 真网关的工作区注册表（`workspace/follow` 的基线帧，只读订阅、取到即退订）。
 *
 * 判据出处：树的每一行工作区都该对应注册表里的一棵（见 `pure/workspaceTreeView.ts` 的
 * `deriveGroups`——它对注册工作区**无条件**出行、不看有没有可见会话）。取不到（流打不开
 * 或超时）回空表，调用方据此记一条失败，不假装通过。
 *
 * 与 F-21 / F-19 那份 `gatewayWorkspaces` 同一套读法（只取 id，不取路径）；各自写一份是因为
 * 套件文件之间互相 import 会连出运行期的环（本文件头写了这条）。
 */
async function gatewayWorkspaceIds(gateway: string): Promise<string[]> {
  let subscription: ReturnType<typeof subscribeWorkspaceStream> | undefined
  let timer: NodeJS.Timeout | undefined
  // 这条流的 `logger` 形参是扩展侧的 `Logger` 类（构造要 vscode，实验室没有），而它实际
  // 只用 info/warn/error 三件——`consoleLogger` 顶上（只做类型投影，不进运行期）。
  const logger = consoleLogger(true) as unknown as Logger
  return await new Promise<string[]>((resolve) => {
    const finish = (ids: string[]): void => {
      if (timer !== undefined) clearTimeout(timer)
      subscription?.dispose()
      resolve(ids)
    }
    timer = setTimeout(() => {
      finish([])
    }, 10_000)
    subscription = subscribeWorkspaceStream(gateway, logger, (frame) => {
      if (frame.type !== 'baseline') return
      finish(
        frame.items.flatMap((item) => {
          const record = item as { workspaceId?: unknown }
          return typeof record.workspaceId === 'string' && record.workspaceId !== '' ? [record.workspaceId] : []
        }),
      )
    })
  })
}

/** 一棵合成工作区（页内夹具声明的那一份）。 */
interface LabWorkspaceSpec {
  workspaceId: string
  path: string
  title: string
  sessionIds: readonly string[]
}

/**
 * 把 `workspace/follow` 的基线帧换成 `workspaces` 声明的合成工作区，并顺带定下
 * `archivedSessionIds`（要造「会话全归档」那一棵）；其余工作区帧一律丢掉——留着真工作区的
 * 增量帧（upsert / order / remove），合成的那几棵就不是唯一的那几棵了。真网关只读。
 *
 * 与 F-21 / F-47 的两份同一套做法（F-47 那份是两棵、标题受控，所以各写各的）。
 */
async function installWorkspaceFixture(
  page: OpenedPage['page'],
  workspaces: readonly LabWorkspaceSpec[],
  archivedSessionIds: readonly string[],
): Promise<{ rewritten: number; dropped: number }> {
  const stats = { rewritten: 0, dropped: 0 }
  await page.routeWebSocket(/remote\.mux/, (socket) => {
    const upstream = socket.connectToServer()
    const endpoints = new Map<string, string>()
    socket.onMessage((message) => {
      try {
        const frame = JSON.parse(String(message)) as { type?: string; streamId?: string; endpoint?: string }
        if (frame.type === 'open' && frame.streamId !== undefined && frame.endpoint !== undefined) {
          endpoints.set(frame.streamId, frame.endpoint)
        }
      } catch {
        /* 客户端帧形状变了就原样转发（夹具不参与协议解读） */
      }
      upstream.send(message)
    })
    upstream.onMessage((message) => {
      const text = String(message)
      let frame:
        | { streamId?: string; type?: string; value?: { type?: string; value?: { items?: unknown[]; archivedSessionIds?: unknown } } }
        | undefined
      try {
        frame = JSON.parse(text) as typeof frame
      } catch {
        frame = undefined
      }
      const endpoint = frame?.streamId === undefined ? undefined : endpoints.get(frame.streamId)
      if (endpoint !== 'workspace/follow') {
        socket.send(message)
        return
      }
      const payload = frame?.value
      if (frame?.type === 'item' && payload?.type === 'baseline' && payload.value !== undefined) {
        // 借真 item 的字段面（官方还可能带别的字段），只覆写套件要控制的那四个 + 时间戳。
        const template = (payload.value.items ?? []).find((item) => typeof (item as { path?: unknown }).path === 'string')
        const base = typeof template === 'object' && template !== null ? template : { createdAt: new Date(0).toISOString() }
        payload.value.items = workspaces.map((workspace) => ({
          ...base,
          workspaceId: workspace.workspaceId,
          path: workspace.path,
          title: workspace.title,
          sessionIds: [...workspace.sessionIds],
          updatedAt: new Date(0).toISOString(),
        }))
        payload.value.archivedSessionIds = [...archivedSessionIds]
        stats.rewritten += 1
        socket.send(JSON.stringify(frame))
        return
      }
      stats.dropped += 1
    })
  })
  return stats
}

/** 官方浏览区里工作区行的文本（官方类名后缀 `_projectRow`，与 F-04 的配对取法同源）。 */
async function officialWorkspaceTexts(page: OpenedPage['page']): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[class*="_projectRow"]')).map((row) =>
      (row.textContent ?? '').replace(/\s+/g, ' ').trim(),
    ),
  )
}

/**
 * 等页面向假宿主**读过一次**某个状态键（`state.read`，最多 `timeoutMs`）。
 *
 * 为什么要等：用户可感知的持久状态（回收站、分组、标签、未读…）住在宿主侧（AGENTS.md
 * 的「插件状态按官方惯例存储」），页面挂载后要经宿主能力口**异步**读回来——读回来之前那
 * 一小段窗口里回收站集合还是空的，被本地挪走的会话看起来还在树里（实测出现过一次：
 * 重载后立刻读计数，回收站那一组的计数还是 1）。等的只是「这份夹具状态读回来了」，判据
 * 一个字没放宽：假宿主的调用记录每次导航重造，所以它只反映**当前这一份文档**。
 */
async function waitForStateRead(page: OpenedPage['page'], key: string, timeoutMs = 8_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const read = await page.evaluate((stateKey) => {
      const host = (globalThis as unknown as {
        __LAB_HOST__?: { hostCalls?: Array<{ call: string; args?: { key?: string } }> }
      }).__LAB_HOST__
      return (host?.hostCalls ?? []).some((call) => call.call === 'state.read' && call.args?.key === stateKey)
    }, key)
    if (read) {
      // 回执是异步送达的（假宿主按 setTimeout(0) 回）：再给一帧，页面侧快照才落定。
      await page.waitForTimeout(400)
      return true
    }
    if (Date.now() > deadline) return false
    await page.waitForTimeout(150)
  }
}

export const EXPAND_DEFAULTS_SUITE: LabSuite = {
  id: 'F-51',
  phase: 'new-feature',
  name: '展开态的默认值与空工作区（#151）：首开恰好展开当前会话那一组、空工作区行照样能收能展、手动改过的态重开不丢（EXPAND-DEFAULTS 套件）',
  expect:
    '侧栏树在真实装配页上（真网关**只读** + 假宿主，期望值不硬编码、按关系量判）：① **首开默认态（三档宽度 260 / 340 / 500 各开一个干净上下文）**——`localStorage`（官方惯例键 `dsh.workspaceTree.view`）里那份展开记录恰好有一个 `true`，DOM 里也恰好一行 `aria-expanded="true"`，两者**是同一个分组键**；其余工作区行全部折叠、连带它们底下的会话行一个都不渲染；那一刻展开的就是**当前会话所在的那一组**（当前会话行 `aria-selected="true"` 向上找到的分组），其余分组键在记录里压根不出现（= 没被碰过）。这一档判的是官方口径（官方 `WorkspaceBrowser` 首开只展开当前组、其余全折叠），不是「全展开」。② **手动收起当前那一组 → 重开仍收起**——点那一行：行变折叠、记录里该键变 `false`（**不是删键**，官方 `Object.hasOwn` 靠这条把「用户收起过」与「没碰过」分开）；同上下文重载（localStorage 保留）后它**还是折叠**，记录里还是 `false`，没有任何一组被自动展开；接着展开另一组、再重载：那一组照旧展开着，当前那一组照旧折叠（用户手动改过的两个方向都不被覆盖）。③ **空工作区行照样能收能展，且工作区行只取决于工作区注册表**（#161 起夹具自造，不再挑当天数据）——**③-a 真网关数据**：把网关的工作区注册表（`workspace/follow` 基线帧，只读订阅）与树里的行逐项对，**每一棵注册工作区都有一行**，树里多出来的行只有未分组桶（散会话那一桶，键是空串）；**③-b 页内夹具自己声明四棵合成工作区**（与 ①② 同一张页面上之外的独立一页）：会话**全空**、会话**全归档**（夹具定 `archivedSessionIds`）、会话**全进本地回收站**（假宿主 `recycle-bin`）、以及一棵**有可见会话的对照**——四行都在、顺序 = 注册顺序，前三棵计数都是 `0`、对照那棵是 `1`（证明那三个 0 是夹具造出来的，不是整棵树都没会话）；在「全空」那一棵上验交互：那一行仍可点（`cursor: pointer`）、悬停时箭头那一格照常显形（computed `display` 不是 `none`）、点一下行变 `aria-expanded="true"`、箭头挂上 `dshOneTree_arrowOpen`、记录里写 `true`、展开后该组底下仍然零会话行；同上下文重载后**仍是展开态**、另两棵零会话的行也还在；再点一下收起、重载后又仍是折叠。**③-c 官方浏览区同一份数据**：同样四棵、零会话那三棵**官方也各出一行**（这就是本段判据的出处）。全程零 pageerror，只点工作区行与悬停，任何写类请求都不发（网关只读）。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const shot = async (page: OpenedPage['page'], name: string): Promise<string> => {
      const file = path.join(ctx.shots, `${name}.png`)
      await fsp.mkdir(ctx.shots, { recursive: true })
      await page.screenshot({ path: file })
      return file
    }
    const tree = route('sidebar')

    // -----------------------------------------------------------------------
    // ① 首开默认态：三档宽度各开一个干净上下文（新上下文 = 新 localStorage）
    // -----------------------------------------------------------------------
    let sawWorkspaces = false
    for (const width of WIDTHS) {
      const opened = await openTreePage(ctx.browser, ctx.lab, tree, { width, height: 900 })
      try {
        const facts = await treeFacts(opened.page)
        const opened1 = facts.groups.filter((group) => group.expanded).map((group) => group.key)
        const truthy = expandedKeys(facts)
        check.fact(
          `w=${String(width)} 首开：工作区行 ${String(facts.groups.length)} 行（展开着 ${JSON.stringify(opened1)}）、记录 = ${JSON.stringify(facts.expansion)}、当前会话所在组 = ${JSON.stringify(facts.currentGroupKey)}`,
        )
        if (!opened.ready || facts.groups.length === 0) {
          // 一个工作区都没有就无从判展开态；如实记一条失败，不假装通过（本机网关平时都有）。
          check.ok(`w=${String(width)} ① 网关上有工作区分组可供验证`, false, `rows=${String(facts.groups.length)} ready=${String(opened.ready)}`)
          continue
        }
        sawWorkspaces = true
        check.eq(`w=${String(width)} ① 记录里恰好一组展开着`, truthy.length, 1)
        check.eq(`w=${String(width)} ① DOM 里展开的正是记录里那一组（不多不少）`, opened1, truthy)
        check.eq(
          `w=${String(width)} ① 其余工作区行全部折叠`,
          facts.groups.filter((group) => group.expanded).length,
          1,
        )
        check.eq(
          `w=${String(width)} ① 折叠的分组一个会话行都不渲染`,
          facts.groups.filter((group) => !group.expanded && group.sessions.length > 0).length,
          0,
        )
        check.ok(
          `w=${String(width)} ① 展开的就是当前会话所在的那一组`,
          facts.currentGroupKey !== null && truthy[0] === facts.currentGroupKey,
          `展开=${JSON.stringify(truthy)} 当前组=${JSON.stringify(facts.currentGroupKey)}`,
        )
        check.ok(
          `w=${String(width)} ① 没被碰过的分组在记录里一个键都不占（清一色的 true 才是被碰过）`,
          Object.entries(facts.expansion).every(([, expanded]) => expanded === true),
          JSON.stringify(facts.expansion),
        )
        if (width === 340) screenshots.push(await shot(opened.page, 'F-49-01-first-open'))
      } finally {
        await opened.context.close()
      }
    }
    if (!sawWorkspaces) return screenshots

    // -----------------------------------------------------------------------
    // ② 手动改过的态不许被自动展开顶回来（同上下文重载）
    // -----------------------------------------------------------------------
    const persistent = await openTreePage(ctx.browser, ctx.lab, tree, { width: 340, height: 900 })
    const { page } = persistent
    try {
      const first = await treeFacts(page)
      const currentKey = first.currentGroupKey ?? expandedKeys(first)[0] ?? ''
      check.ok('② 首开能定位到「当前会话所在那一组」', currentKey !== '', JSON.stringify(first.expansion))
      if (currentKey === '') return screenshots

      await toggleGroupRow(page, currentKey)
      const collapsed = await treeFacts(page)
      check.eq('② 点一下当前那一组：行变折叠', collapsed.groups.find((group) => group.key === currentKey)?.expanded, false)
      check.eq('② 收起的结果写进客户端存储（显式 false，不是删键）', collapsed.expansion[currentKey], false)
      check.eq('② 收起后没有任何一组是展开的', expandedKeys(collapsed), [])

      check.ok('② 重载后页面照样起来', await reload(page, tree))
      const afterReload = await treeFacts(page)
      check.eq(
        '② 重载后那一组仍然折叠（不被首开规则自动展开）',
        afterReload.groups.find((group) => group.key === currentKey)?.expanded,
        false,
      )
      check.eq('② 重载后记录里仍是显式 false', afterReload.expansion[currentKey], false)
      check.eq('② 重载后没有任何一组被自动展开', expandedKeys(afterReload), [])
      screenshots.push(await shot(page, 'F-49-02-collapsed-after-reload'))

      // 另一个方向：用户手动展开别的组，重载后同样保留（且不影响刚才收起的那一组）
      const other = afterReload.groups.find((group) => group.key !== currentKey)
      check.ok('② 网关上有第二个工作区分组可供对照', other !== undefined, JSON.stringify(afterReload.groups.map((group) => group.key)))
      if (other !== undefined) {
        await toggleGroupRow(page, other.key)
        const opened2 = await treeFacts(page)
        check.eq('② 手动展开另一组：那一组展开着', opened2.groups.find((group) => group.key === other.key)?.expanded, true)
        check.ok('② 重载后页面照旧起来', await reload(page, tree))
        const afterReload2 = await treeFacts(page)
        check.eq(
          '② 重载后手动展开的那一组仍是展开态',
          afterReload2.groups.find((group) => group.key === other.key)?.expanded,
          true,
        )
        check.eq(
          '② 重载后手动收起的那一组仍是折叠态（两个方向都保留）',
          afterReload2.groups.find((group) => group.key === currentKey)?.expanded,
          false,
        )
        check.eq('② 记录与 DOM 依旧一致', expandedKeys(afterReload2).sort(), [other.key].sort())
      }

      // ---------------------------------------------------------------------
      // ③ 空工作区行：工作区行只取决于工作区注册表，不取决于有没有会话
      // ---------------------------------------------------------------------
      // 判据出处：`pure/workspaceTreeView.ts` 的 `deriveGroups` 对**注册工作区**无条件出行
      // （成员只影响计数与子行），而未分组桶（散会话那一桶，键是空串）只在真有散会话时才
      // 出现。所以「工作区一个可见会话都没有 → 行没了」是 bug，「未分组桶空了 → 桶没了」
      // 是设计。③-a 在真网关数据上把注册表与树里的行逐项对；③-b 用页内夹具自造四种状态
      // （会话全空 / 全归档 / 全进本地回收站 / 有会话对照），一条判据都不吃当天数据；
      // ③-c 把同一份数据喂给官方浏览区，核官方也为这四棵各出一行（这一段判据的出处）。
      const registered = await gatewayWorkspaceIds(ctx.lab.gateway)
      const liveRows = (await treeFacts(page)).groups
      check.ok(
        '③ 真网关答上了工作区注册表（下面两条的前提）',
        registered.length > 0,
        `注册 ${String(registered.length)} 棵`,
      )
      const missing = registered.filter((id) => !liveRows.some((group) => group.key === id))
      check.ok(
        '③ 真网关数据：注册表里每一棵工作区在树里都有一行',
        missing.length === 0,
        `注册 ${String(registered.length)} 棵、树里 ${String(liveRows.length)} 行、缺 ${JSON.stringify(missing)}`,
      )
      const extra = liveRows.map((group) => group.key).filter((key) => !registered.includes(key))
      check.ok(
        '③ 树里多出来的行只有未分组桶（散会话那一桶，键是空串），不是工作区',
        extra.every((key) => key === ''),
        `多出来 ${JSON.stringify(extra)}`,
      )
      check.fact(
        `③ 真网关注册表 ${String(registered.length)} 棵、树里 ${String(liveRows.length)} 行；多出来的行 ${extra.length === 0 ? '没有（本页无散会话）' : `= ${JSON.stringify(extra)}（未分组桶）`}`,
      )

      // ③-b 自造夹具：四棵合成工作区，覆盖「一个可见会话都没有」的三种来路。
      const sessions = await listSessions(ctx.lab.gateway).catch(() => [])
      const usable = sessions
        .filter((session) => session.blank !== true && session.origin !== 'subagent')
        .map((session) => session.sessionId)
      check.ok(
        '③ 网关上够造夹具的可见会话（回收站 / 归档 / 对照各要一条）',
        usable.length >= 3,
        `可用 ${String(usable.length)} 条`,
      )
      if (usable.length < 3) return screenshots
      const recycledId = usable[0]
      const archivedId = usable[1]
      const liveId = usable[2]
      const SPECS: readonly LabWorkspaceSpec[] = [
        { workspaceId: 'lab-ws-empty', path: '/lab/ws-empty', title: 'Lab Empty', sessionIds: [] },
        { workspaceId: 'lab-ws-archived', path: '/lab/ws-archived', title: 'Lab Archived', sessionIds: [archivedId] },
        { workspaceId: 'lab-ws-recycled', path: '/lab/ws-recycled', title: 'Lab Recycled', sessionIds: [recycledId] },
        { workspaceId: 'lab-ws-live', path: '/lab/ws-live', title: 'Lab Live', sessionIds: [liveId] },
      ]
      /** 夹具里那棵「一个可见会话都没有」的合成工作区（③ 的交互都在它身上验）。 */
      const EMPTY_WORKSPACE = 'lab-ws-empty'
      const syntheticKeys = SPECS.map((spec) => spec.workspaceId)

      const empty = await openTreePage(ctx.browser, ctx.lab, tree, {
        width: 340,
        height: 900,
        state: { 'recycle-bin': { version: 1, sessionIds: [recycledId] } },
      })
      try {
        const stats = await installWorkspaceFixture(empty.page, SPECS, [archivedId])
        check.ok('③ 重载后装上了合成工作区夹具', await reload(empty.page, tree))
        check.ok('③ 夹具生效（基线帧被换成四棵合成工作区）', stats.rewritten > 0, JSON.stringify(stats))
        check.ok('③ 重载后的页面读回了宿主侧的回收站状态（夹具状态落定）', await waitForStateRead(empty.page, 'recycle-bin'))
        check.fact(
          `③ 夹具：基线帧换掉 ${String(stats.rewritten)} 次、丢掉非基线帧 ${String(stats.dropped)} 帧；四棵合成工作区 = 空 / 全归档 / 全进回收站 / 有会话对照`,
        )

        const facts = await treeFacts(empty.page)
        const rowOf = (key: string): GroupFacts | null => facts.groups.find((group) => group.key === key) ?? null
        const ungrouped = facts.groups.filter((group) => group.key === '')
        check.fact(
          `③ 未分组桶（散会话那一桶）也是一条「工作区行」：${ungrouped.length === 0 ? '本页没有（一个散会话都没有）' : `键是空串、计数 ${String(ungrouped[0]?.count)}`}——它**不是注册工作区**，可见会话归零时整桶不渲染（#161 的旧夹具挑「树里最后一个有会话的行」就会挑到它）`,
        )
        const leftovers = facts.groups.filter((group) => group.key !== '' && !syntheticKeys.includes(group.key))
        check.eq(
          '③ 树里只剩夹具声明的四棵（没有当天真工作区混进来）',
          leftovers.map((group) => group.key),
          [],
        )
        check.eq('③ 四棵注册工作区都在树里，顺序 = 注册顺序', facts.groups.filter((group) => group.key !== '').map((group) => group.key), syntheticKeys)
        check.eq('③ 「会话全空」那一棵：行在、计数 0（会话一个都没有也不消失）', rowOf(EMPTY_WORKSPACE)?.count, '0')
        check.eq('③ 「会话全归档」那一棵：行在、计数 0', rowOf('lab-ws-archived')?.count, '0')
        check.eq('③ 「全进本地回收站」那一棵：行在、计数 0', rowOf('lab-ws-recycled')?.count, '0')
        check.eq(
          '③ 有会话那一棵对照：计数 1（证明上面三个 0 是夹具造出来的，不是整棵树都没有会话）',
          rowOf('lab-ws-live')?.count,
          '1',
        )

        const closed = await arrowFacts(empty.page, EMPTY_WORKSPACE)
        check.eq('③ 折叠态下那一行仍可点（cursor: pointer）', closed.cursor, 'pointer')
        check.ok(
          '③ 折叠态下悬停即显形那枚箭头（空组不特殊对待）',
          closed.display !== 'none' && closed.display !== 'missing',
          JSON.stringify(closed),
        )
        check.eq('③ 折叠态下箭头不带展开标记', closed.openClass, false)

        await toggleGroupRow(empty.page, EMPTY_WORKSPACE)
        const openedEmpty = await treeFacts(empty.page)
        check.eq(
          '③ 点一下：空工作区行变展开态（aria-expanded=true）',
          openedEmpty.groups.find((group) => group.key === EMPTY_WORKSPACE)?.expanded,
          true,
        )
        check.eq('③ 展开态写进客户端存储', openedEmpty.expansion[EMPTY_WORKSPACE], true)
        const openArrow = await arrowFacts(empty.page, EMPTY_WORKSPACE)
        check.eq('③ 展开态下箭头挂上 dshOneTree_arrowOpen', openArrow.openClass, true)
        check.eq(
          '③ 展开后它底下仍然零会话行',
          openedEmpty.groups.find((group) => group.key === EMPTY_WORKSPACE)?.sessions,
          [],
        )
        screenshots.push(await shot(empty.page, 'F-49-03-empty-workspace-expanded'))

        check.ok('③ 重载后页面照旧起来', await reload(empty.page, tree))
        check.ok('③ 重载后又读回一次回收站状态（夹具状态落定）', await waitForStateRead(empty.page, 'recycle-bin'))
        const emptyAfterReload = await treeFacts(empty.page)
        check.eq(
          '③ 重载后空工作区仍是展开态（空组的展开态同样进客户端存储）',
          emptyAfterReload.groups.find((group) => group.key === EMPTY_WORKSPACE)?.expanded,
          true,
        )
        check.eq('③ 重载后它的计数仍是 0', emptyAfterReload.groups.find((group) => group.key === EMPTY_WORKSPACE)?.count, '0')
        check.eq(
          '③ 重载后另外两棵零会话的行也还在（全归档 / 全进回收站不因重载消失）',
          ['lab-ws-archived', 'lab-ws-recycled'].map(
            (key) => emptyAfterReload.groups.find((group) => group.key === key)?.count,
          ),
          ['0', '0'],
        )

        await toggleGroupRow(empty.page, EMPTY_WORKSPACE)
        check.eq('③ 再点一下收起：行回到折叠、记录写 false', (await treeFacts(empty.page)).expansion[EMPTY_WORKSPACE], false)
        check.ok('③ 再重载一次页面照旧起来', await reload(empty.page, tree))
        check.eq(
          '③ 重载后仍是折叠（空组的收起同样是显式记录）',
          (await treeFacts(empty.page)).groups.find((group) => group.key === EMPTY_WORKSPACE)?.expanded,
          false,
        )
        check.eq('③ 空工作区那一页全程零 pageerror', withoutKnownNoise(empty.capture.pageErrors).real, [])
      } finally {
        await empty.context.close()
      }

      // ③-c 同一份数据下的官方浏览区：每个注册工作区一行（含零会话的那三棵）。
      const officialTree = route('sidebar-official')
      const official = await openTreePage(ctx.browser, ctx.lab, officialTree, { width: 340, height: 900 })
      try {
        await installWorkspaceFixture(official.page, SPECS, [archivedId])
        check.ok('③ 官方浏览区那一页照旧起来', await reload(official.page, officialTree))
        const titles = await officialWorkspaceTexts(official.page)
        check.fact(`③ 官方浏览区同一份数据下的工作区行文本：${JSON.stringify(titles)}`)
        check.ok(
          '③ 官方浏览区为这四棵注册工作区各出一行（含零会话的那三棵）——本段判据的出处',
          SPECS.every((spec) => titles.some((text) => text.includes(spec.title))),
          JSON.stringify(titles),
        )
        check.eq('③ 官方浏览区那一页零 pageerror', withoutKnownNoise(official.capture.pageErrors).real, [])
      } finally {
        await official.context.close()
      }
    } finally {
      await persistent.context.close()
    }

    return screenshots
  },
}
