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
 *   `sidebar.workspaces` 座位 shadow 掉的那一件）**首开只展开当前会话所在那一组**，
 *   其余全折叠——store 的初值是 `groupExpansion: {}`，那条 effect 只在
 *   `Object.hasOwn(groupExpansion, currentGroup)` 为假时展开它。本套件第 ① 段因此
 *   判的不是「全展开」，而是「恰好一组展开、且是当前会话那一组」。
 * - 官方**空工作区行照常可收可展**：`ProjectRowItem` 的整行 `onClick: onToggle`
 *   没有任何「空就不响应」的分支，`aria-expanded` 也照挂。实测记录见 issue #151
 *   的 comment（隔离实例里注册一个零会话工作区，点一下 `aria-expanded` false → true，
 *   记录落 `groupExpansion: {<id>: true}`）。
 *
 * **空工作区这一段的构造**：本套件跑在**只读**的真网关上，不能新建工作区（那会写真
 * 数据），所以用假宿主的 `recycle-bin` 夹具把某一个工作区的**全部会话**放进回收站——
 * 树里那一组于是恰好「一个会话都不剩」（`data-dshone-tree-count="0"`、展开后没有任何
 * 会话行），与「新加进来的空工作区」在行渲染上是同一条路（行不认空不空，见 ② 的判据）。
 *
 * 全程只读真网关：只点工作区行（改本地视图态）、只读 localStorage。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { openTreePage, withoutKnownNoise, type OpenedPage } from './harness.ts'
import { LAB_TREES, type LabTreeRoute } from './labServer.ts'
import { TREE_VIEW_PREF_KEY } from '../../src/pure/workspaceTreePrefs.ts'
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

export const EXPAND_DEFAULTS_SUITE: LabSuite = {
  id: 'F-51',
  phase: 'new-feature',
  name: '展开态的默认值与空工作区（#151）：首开恰好展开当前会话那一组、空工作区行照样能收能展、手动改过的态重开不丢（EXPAND-DEFAULTS 套件）',
  expect:
    '侧栏树在真实装配页上（真网关**只读** + 假宿主，期望值不硬编码、按关系量判）：① **首开默认态（三档宽度 260 / 340 / 500 各开一个干净上下文）**——`localStorage`（官方惯例键 `dsh.workspaceTree.view`）里那份展开记录恰好有一个 `true`，DOM 里也恰好一行 `aria-expanded="true"`，两者**是同一个分组键**；其余工作区行全部折叠、连带它们底下的会话行一个都不渲染；那一刻展开的就是**当前会话所在的那一组**（当前会话行 `aria-selected="true"` 向上找到的分组），其余分组键在记录里压根不出现（= 没被碰过）。这一档判的是官方口径（官方 `WorkspaceBrowser` 首开只展开当前组、其余全折叠），不是「全展开」。② **手动收起当前那一组 → 重开仍收起**——点那一行：行变折叠、记录里该键变 `false`（**不是删键**，官方 `Object.hasOwn` 靠这条把「用户收起过」与「没碰过」分开）；同上下文重载（localStorage 保留）后它**还是折叠**，记录里还是 `false`，没有任何一组被自动展开；接着展开另一组、再重载：那一组照旧展开着，当前那一组照旧折叠（用户手动改过的两个方向都不被覆盖）。③ **空工作区行照样能收能展**——用假宿主的 `recycle-bin` 夹具把某一个工作区的全部会话放进回收站，树里那一组于是零会话（`data-dshone-tree-count="0"`、展开也没有任何会话行，与「新加进来的空工作区」共用同一条行渲染路径）：那一行仍可点（`cursor: pointer`）、悬停时箭头那一格照常显形（computed `display` 不是 `none`）、点一下行变 `aria-expanded="true"`、箭头挂上 `dshOneTree_arrowOpen`、记录里写 `true`、展开后该组底下仍然零会话行；同上下文重载后**仍是展开态**（空工作区的展开态同样进客户端存储）；再点一下收起、重载后又仍是折叠。全程零 pageerror，只点工作区行与悬停，任何写类请求都不发（网关只读）。',
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
      // ③ 空工作区行：照样能收能展、箭头随态翻转、态进客户端存储
      // ---------------------------------------------------------------------
      // 造一个「零会话的工作区」：把那一个工作区的全部会话放进假宿主的回收站。
      // 本套件在只读的真网关上跑，不能新建工作区；回收站是纯客户端状态（夹具里那份
      // 就是宿主状态存储），树里那一组于是与「新加进来的空工作区」同形：count=0、
      // 展开后没有会话行。挑**最后**一个有会话的工作区，避开当前会话那一组。
      const groupsNow = (await treeFacts(page)).groups
      const target = [...groupsNow].reverse().find((group) => group.count !== '0') ?? null
      check.ok('③ 找到一个有会话的工作区来做「空工作区」夹具', target !== null, JSON.stringify(groupsNow.map((group) => group.count)))
      if (target === null) return screenshots
      if (!target.expanded) await toggleGroupRow(page, target.key)
      const harvested = await treeFacts(page)
      const seedIds = harvested.groups.find((group) => group.key === target.key)?.sessions ?? []
      check.ok(
        '③ 收到该工作区的全部会话 id（夹具要按真实 id 注入回收站）',
        seedIds.length > 0,
        JSON.stringify(seedIds.slice(0, 3)),
      )
      if (seedIds.length === 0) return screenshots

      const empty = await openTreePage(ctx.browser, ctx.lab, tree, {
        width: 340,
        height: 900,
        state: { 'recycle-bin': { version: 1, sessionIds: [...seedIds] } },
      })
      try {
        const emptyFacts = await treeFacts(empty.page)
        const row = emptyFacts.groups.find((group) => group.key === target.key) ?? null
        check.ok('③ 「空工作区」那一组还在树里（工作区不因为没会话就消失）', row !== null, JSON.stringify(emptyFacts.groups.map((group) => group.key)))
        if (row === null) return screenshots
        check.eq('③ 它的会话计数是 0', row.count, '0')
        check.eq('③ 展开后它底下没有任何会话行（真的是空组）', row.sessions, [])
        // 夹具只动了那一个工作区：其余分组的计数（与折叠态无关的那一项）与上一页逐条相同。
        const baselineCounts = Object.fromEntries(
          harvested.groups.filter((group) => group.key !== target.key).map((group) => [group.key, group.count]),
        )
        const emptyCounts = Object.fromEntries(
          emptyFacts.groups.filter((group) => group.key !== target.key).map((group) => [group.key, group.count]),
        )
        check.eq('③ 其余工作区的会话计数一个都没动（夹具只回收了那一个工作区的会话）', emptyCounts, baselineCounts)

        const closed = await arrowFacts(empty.page, target.key)
        check.eq('③ 折叠态下那一行仍可点（cursor: pointer）', closed.cursor, 'pointer')
        check.ok(
          '③ 折叠态下悬停即显形那枚箭头（空组不特殊对待）',
          closed.display !== 'none' && closed.display !== 'missing',
          JSON.stringify(closed),
        )
        check.eq('③ 折叠态下箭头不带展开标记', closed.openClass, false)

        await toggleGroupRow(empty.page, target.key)
        const openedEmpty = await treeFacts(empty.page)
        check.eq(
          '③ 点一下：空工作区行变展开态（aria-expanded=true）',
          openedEmpty.groups.find((group) => group.key === target.key)?.expanded,
          true,
        )
        check.eq('③ 展开态写进客户端存储', openedEmpty.expansion[target.key], true)
        const openArrow = await arrowFacts(empty.page, target.key)
        check.eq('③ 展开态下箭头挂上 dshOneTree_arrowOpen', openArrow.openClass, true)
        check.eq('③ 展开后它底下仍然零会话行', openedEmpty.groups.find((group) => group.key === target.key)?.sessions, [])
        screenshots.push(await shot(empty.page, 'F-49-03-empty-workspace-expanded'))

        check.ok('③ 重载后页面照旧起来', await reload(empty.page, tree))
        const emptyAfterReload = await treeFacts(empty.page)
        check.eq(
          '③ 重载后空工作区仍是展开态（空组的展开态同样进客户端存储）',
          emptyAfterReload.groups.find((group) => group.key === target.key)?.expanded,
          true,
        )
        check.eq('③ 重载后它的计数仍是 0', emptyAfterReload.groups.find((group) => group.key === target.key)?.count, '0')

        await toggleGroupRow(empty.page, target.key)
        check.eq(
          '③ 再点一下收起：行回到折叠、记录写 false',
          (await treeFacts(empty.page)).expansion[target.key],
          false,
        )
        check.ok('③ 再重载一次页面照旧起来', await reload(empty.page, tree))
        check.eq(
          '③ 重载后仍是折叠（空组的收起同样是显式记录）',
          (await treeFacts(empty.page)).groups.find((group) => group.key === target.key)?.expanded,
          false,
        )
        check.eq('③ 空工作区那一页全程零 pageerror', withoutKnownNoise(empty.capture.pageErrors).real, [])
      } finally {
        await empty.context.close()
      }
    } finally {
      await persistent.context.close()
    }

    return screenshots
  },
}
