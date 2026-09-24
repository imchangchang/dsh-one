/**
 * 漂移断言套件（#91）：官方改了东西导致我们的插件树不工作时，在实验室先红。
 *
 * 与既有两个检测面的分工：
 * - **每日上游探针**（`scripts/dsh-upstream-watch/` 的 `clientContract.mjs`）离线扫
 *   官方 combo，查的是**名字还在不在**（slot / root hook / 字段名 / combo 结构），
 *   CI 每天跑，红了自动建 issue。它不知道我们的三棵树装起来是什么样。
 * - **F-01 CONTRACT**（`suites.ts`）在浏览器里查**装起来的症状**：槽位锚点、
 *   槽位崩溃、装载未激活、页面报错。
 * - **本文件的 F-10 / F-11** 补的是这两者都盖不住的两块：
 *   F-10 查 **fiber 状态**（cordis scope 失败不进控制台，见 `fiberProbeScript`
 *   的机制说明），F-11 查**我们自己的 block list 与当天官方清单是否还对得上**
 *   （官方改名会让过滤静默失效）。
 *
 * 放在 `suites.ts` 外面的原因：那个文件是本批开发的合入热点（F-07/F-08/F-09 都在
 * 里面改），独立成文件能少一半冲突面。
 */
import {
  describeFiberFailure,
  fiberStateCounts,
  openTreePage,
  waitForFiberQuiet,
} from './harness.ts'
import { LAB_TREES, type LabTreeRoute } from './labServer.ts'
import { localBundleRev } from '../../src/server/localBundleRev.ts'
import { ASSEMBLY_TREES, type AssemblyTree } from '../../src/ui/assembly/trees.ts'
import { filterWire, type BootWire, type BootWireBatch } from '../../src/ui/assembly/wireFilter.ts'
// 只取类型（编译后不留 import，运行期没有环）：套件接口定义在 suites.ts 里，
// 它就是本文件的调用方（SUITES 数组末尾追加这两个套件）。
import type { LabSuite } from './suites.ts'

// ---------------------------------------------------------------------------
// F-10 FIBER：五棵树里没有任何 cordis scope 进 FAILED
// ---------------------------------------------------------------------------

const route = (name: string): LabTreeRoute => {
  const found = LAB_TREES.find((candidate) => candidate.route === name)
  if (found === undefined) throw new Error(`lab: unknown tree route ${name}`)
  return found
}

/** 各树的页面尺寸（与 F-01 同口径：侧栏窄、对话区与设置页宽）。 */
const FIBER_VIEWPORT: Readonly<Record<string, { width: number; height: number }>> = {
  sidebar: { width: 380, height: 900 },
  'sidebar-official': { width: 380, height: 900 },
}

export const FIBER_SUITE: LabSuite = {
  id: 'F-10',
  phase: 'new-feature',
  name: 'fiber 级契约：五棵树里没有任何 cordis scope 进 FAILED（FIBER 套件）',
  expect:
    '实验室五棵树（自有 sidebar 树、官方浏览区对照档、chat 树、settings 树、plugins 树）在真实网关只读下打开，页面里装上 cordis fiber 探针（包 `__ModuleLoader__.load` 的 factory 记插件 id → 包 `@deepseek-ai/dsh-client-modules` 的 apply 拿 ctx → 监听 `internal/plugin` 与 `internal/status`，见 `fiberProbeScript`）：**没有任何 scope 进 FAILED**（官方 Fiber 状态枚举里的 3）。这条断言要抓的是 F-01 抓不到的那一类——cordis 插件 fiber 失败**不进浏览器控制台**（官方 client logger 没有 console exporter），#74 那条 `slot "conversation.hero.agentPreset" is not declared` 就是靠派生症状才被发现的；F-01 看的是装起来的症状（槽位锚点、槽位崩溃、页面报错），这条看的是**装载本身**。同时钉住探针本身没瞎：接上了事件总线、登记到了该树的自有 frame 插件、真观察到 scope 状态变化、探针自身零异常——否则「零失败」是空的。',
  run: async (ctx, check) => {
    // plugins 树（#248 跟到五棵）：它是 #247 开的第四棵装配树，与其余四棵同一套判据——
    // 那棵树同样是「官方全局面板 + 我们的 frame 接管根组合」，fiber 级失败一样不进控制台。
    for (const name of ['sidebar', 'sidebar-official', 'chat', 'settings', 'plugins']) {
      const tree = route(name)
      const viewport = FIBER_VIEWPORT[name] ?? { width: 1200, height: 900 }
      const opened = await openTreePage(ctx.browser, ctx.lab, tree, {
        ...viewport,
        fiberProbe: true,
        // 静下来由 waitForFiberQuiet 判定；这里只等首屏（失败现场可能连就绪
        // 选择器都不出现，所以给一个有限超时，别让一条红断言拖到 40 秒）。
        readyTimeoutMs: 20_000,
        settleMs: 500,
      })
      try {
        const facts = await waitForFiberQuiet(opened.page, check, name)
        check.fact(
          `${name}：探针登记插件=${String(facts.plugins.length)} 事件总线=${String(facts.attached)} 状态事件=${String(facts.events)} scope=${String(facts.scopes.length)} 状态分布=${JSON.stringify(fiberStateCounts(facts))}`,
        )
        check.ok(
          `${name}：fiber 探针接上了 cordis 事件总线（0 = 这条断言的证据链断了）`,
          facts.attached >= 1,
          `attached=${String(facts.attached)}`,
        )
        check.ok(
          `${name}：探针登记到该树的自有 frame 插件 ${tree.tree.framePluginId}（确认探针装在这棵树上）`,
          facts.plugins.includes(tree.tree.framePluginId),
          `登记到的自有插件=${facts.plugins.filter((id) => id.startsWith('@dsh-one/')).join(',')}`,
        )
        check.ok(
          `${name}：观察到 scope 状态变化（真看到 fiber 生命周期，不是没数据）`,
          facts.scopes.length > 0,
          `scopes=${String(facts.scopes.length)}`,
        )
        check.eq(`${name}：fiber 探针自身零异常`, facts.errors, [])
        check.eq(
          `${name}：零 scope 进 FAILED`,
          facts.failed.map(describeFiberFailure),
          [],
        )
      } finally {
        await opened.context.close()
      }
    }
    return []
  },
}

// ---------------------------------------------------------------------------
// F-11 WIRE-LIVENESS：block list 里的每个 id 都要在当天网关 wire 里找到
// ---------------------------------------------------------------------------

/**
 * 被检查的树 = 四棵生产树（chat / sidebar / settings / plugins，标签取实验室的路由名）。
 * 实验室第五条路由 `sidebar-official` 是侧栏树的对照档（同一份 block list，只是不装自有
 * 树插件），按 `framePluginId` 去重掉，避免同一条 block list 被报两遍（#248 起四棵都在表里
 * ——`LAB_TREES` 就是事实源，这支按 `ASSEMBLY_TREES` 的形状自己收敛）。
 */
const AUDITED_TREES: ReadonlyArray<{ label: string; tree: AssemblyTree }> = ((): Array<{ label: string; tree: AssemblyTree }> => {
  const seen = new Set<string>()
  const audited: Array<{ label: string; tree: AssemblyTree }> = []
  for (const entry of LAB_TREES) {
    if (seen.has(entry.tree.framePluginId)) continue
    seen.add(entry.tree.framePluginId)
    audited.push({ label: entry.route, tree: entry.tree })
  }
  return audited
})()

/** id 里有意义的词（去掉作用域与通用前缀），用来猜「可能被改名成谁」。 */
function distinctiveWords(id: string): string[] {
  const bare = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id
  return bare.split(/[.-]/).filter((word) => !['dsh', 'client', 'ui', 'api', 'one'].includes(word))
}

/**
 * 「这个 id 去哪了」的线索：在当天 wire 里找共享词的 id。
 *
 * 为什么值得猜：官方把插件**改名**或**并进别的插件**是这条断言最常见的两种红法
 * （2026-09-16 那轮的两条红就是这样读的：ui-settings-models 与 ui-model-selection
 * 当天不在 wire 里），猜出来的邻居能让读报告的人立刻知道去哪里看，而不是对着一个
 * 不存在的 id 发呆。猜空就如实说猜空。
 *
 * **#164 更正那两条红的原因**：它们不是「官方并进别的插件」，而是**这台机器的
 * 日常 profile 自己干掉了它们**——`@dsh-one/dsh-llm-provider`（另一仓）的 bundle
 * patch 里 `disabled: true` 禁掉了 `ui-model-selection` 与 `ui-settings-models`。
 * 换句话说这条断言的红有第三种原因：**wire 被我们自己的补丁改过**，而「官方改名」
 * 与「被自己补丁关掉」在 wire 上长得一样。要区分它们只能看**全新 `DSH_HOME`** 的
 * wire：那边才是官方的原样清单（F-55 走的就是这条）。
 */
function renameHint(id: string, wireIds: ReadonlySet<string>): string {
  const words = distinctiveWords(id)
  const candidates = [...wireIds].filter((candidate) => {
    const bare = candidate.slice(candidate.lastIndexOf('/') + 1)
    return words.some((word) => bare.split(/[.-]/).includes(word))
  })
  return candidates.length === 0
    ? '可能被改名或并进了别的插件（当天 wire 里没有含同名词的 id）'
    : `可能被改名/换装载方式，当天 wire 里含同名词的邻近 id：${candidates.slice(0, 4).join(', ')}`
}

/**
 * 合成「官方把 application 阶段切成两批」的形状（#165）。
 *
 * 为什么要合成：真实分批取决于 combo URL 的长度上限（官方 client-modules 的
 * partitionComboRecords，3KB），本机装着多少插件、谁排在最后决定谁被挤进第二批
 * ——干净 profile 上被挤出去的是 directory-picker-native（#165 现场）。口径要验的
 * 是「无论被挤出去的是谁，过滤都认」，所以把当天 wire 里**某个被我们 block 的**
 * 条目摘出来，单独放一个尾批：形状与官方分批一致（两个 application 批、各批
 * entries 与 URL 名字对得上），只是批 URL 是合成的——这条用例不发起请求，只跑
 * 过滤逻辑，mirror 那侧由装配页本身（各棵树的 CONTRACT 断言）覆盖。
 */
function splitApplicationBatch(wire: BootWire, moved: string): BootWire {
  const appEntries = wire.batches.filter((batch) => batch.phase === 'application').flatMap((batch) => batch.entries)
  const rest = appEntries.filter((id) => id !== moved)
  const comboUrl = (ids: readonly string[], rev: string): string =>
    `/plugins/??${ids.map((id) => `${id}/client.js`).join(',')}&rev=${rev}`
  const second: BootWireBatch = {
    phase: 'application',
    url: comboUrl([moved], 'synthetic-second'),
    rev: 'synthetic-second',
    entries: [moved],
  }
  return {
    rev: wire.rev,
    entries: wire.entries,
    batches: [
      ...wire.batches.filter((batch) => batch.phase === 'bootstrap'),
      { phase: 'application', url: comboUrl(rest, 'synthetic-first'), rev: 'synthetic-first', entries: rest },
      second,
    ],
  }
}

/** 把某个 id 从所有 application 批里摘掉、只留在 entries 里（#165 的另一半判据）。 */
function withoutApplicationBatch(wire: BootWire, moved: string): BootWire {
  return {
    ...wire,
    batches: wire.batches.map((batch) =>
      batch.phase === 'application' ? { ...batch, entries: batch.entries.filter((id) => id !== moved) } : batch,
    ),
  }
}

export const WIRE_LIVENESS_SUITE: LabSuite = {
  id: 'F-11',
  phase: 'new-feature',
  name: 'block list 存活性（三棵树 block 的每个官方插件 id 都能在当天网关 wire 里找到）+ 分批口径（落在第二个 application 批也照旧剥掉）（WIRE-LIVENESS 套件）',
  expect:
    '两部分。**第一部分（存活性）**：拿**当天网关下发的官方 wire**（实验室各页面的装配来源，`lab.gatewayPluginIds()`）逐棵树核 block list：`chat` / `sidebar` / `settings` 三棵树引用的每个官方插件 id 都必须能在 wire 的 entries 里找到，一条都不能缺。红了就是清单与现实漂移了——官方把某个被 block 的插件**改名或并进别的插件**时，新 id 不会被剥掉，官方件会静默混进树里（`filterWire` 只会打一条 warn，不阻断装配），而这正是最难排查的那种「看着正常、其实多了个不该在的官方件」。失败信息带上「哪棵树 + 哪个 id + 当天 wire 里含同名词的邻近 id（可能改成了谁）」。红了怎么办：按官方 release notes 或官方源码确认它的新装载方式，把这条 block 改成新 id（内容搬进别的插件时通常是**摘除**这条，因为那个 id 已经不存在了），摘除要照 `FLOW_BOTH_TREES` / `FLOW_SETTINGS_TREE` / `SETTINGS_PAGES` 的写法写明为什么。三棵树都查（`sidebar-official` 对照档与 `sidebar` 同一份 block list，去重后不重复报）。**第二部分（分批口径，#165）**：官方按 combo URL 的长度上限把 application 阶段切成若干批，被 block 的条目可能落在**第二批**——拿当天真实 wire 合成那个形状（把某棵树 block 的某个条目摘出来单独放尾批）后跑过滤，三棵树都必须照旧把它剥掉（entries、批、combo URL 三处都不能留），而不是抛「清单对不上」；同时钉住判据没被放宽：某个被 block 的 id 在 wire 里、却不在**任何** application 批里时仍然硬抛（过滤管道够不着它），报错文案点名是哪一种情形。',
  run: async (ctx, check) => {
    const wireIds = await ctx.lab.gatewayPluginIds()
    // 本地产物的内容版本（combo 缓存键里我们自己那一半）：与实验室装配页现算的
    // 是同一个目录、同一个函数，所以这里算出来的 rev 就是页面该拿到的那一个（#173）。
    const localRev = await localBundleRev(ctx.lab.pluginsDir)
    check.fact(
      `当天网关 ${ctx.lab.gateway}（dsh ${ctx.lab.dshVersion ?? '（未知）'}）的官方 wire：${String(wireIds.size)} 个条目；被检查的树 ${AUDITED_TREES.map((entry) => entry.label).join(' / ')}`,
    )
    check.eq('三棵生产树都在被检查（标签去重没吃掉哪一棵）', AUDITED_TREES.length, ASSEMBLY_TREES.length)
    for (const { label, tree } of AUDITED_TREES) {
      const blocked = tree.blockList.map((entry) => entry.id)
      const missing = blocked.filter((id) => !wireIds.has(id))
      check.fact(`${label}：block list ${String(blocked.length)} 项，在当天 wire 里命中 ${String(blocked.length - missing.length)} 项`)
      check.eq(
        `${label}：block list 的每一项都能在当天网关 wire 里找到`,
        missing.map((id) => `${id} —— ${renameHint(id, wireIds)}`),
        [],
      )
    }

    // 第二部分（#165）：被 block 的条目落在第二个 application 批时，过滤照旧认。
    const wire = await ctx.lab.gatewayWire()
    const appBatchCount = wire.batches.filter((batch) => batch.phase === 'application').length
    check.fact(`当天 wire 的批构成：${wire.batches.map((batch) => `${batch.phase}(${String(batch.entries.length)})`).join(' + ')}`)
    for (const { label, tree } of AUDITED_TREES) {
      // 用这棵树**自己** block 的、当天 wire 里真有的那个条目来合成第二批。
      const moved = tree.blockList.map((entry) => entry.id).find((id) => wireIds.has(id))
      if (moved === undefined) {
        check.ok(`${label}：能挑出一个「被 block 且当天 wire 里真有」的条目来合成第二批`, false, '当天 wire 里一条都没命中')
        continue
      }
      const split = splitApplicationBatch(wire, moved)
      const secondBatch = split.batches[split.batches.length - 1]
      check.ok(
        `${label}：合成形状成立（${moved} 落在第二个 application 批，当天真实批数 ${String(appBatchCount)}）`,
        split.batches.filter((batch) => batch.phase === 'application').length === 2 && secondBatch.entries.join() === moved,
        `合成分批：${split.batches.map((batch) => `${batch.phase}(${batch.entries.length})`).join(' + ')}`,
      )
      const warnings: string[] = []
      let filtered: BootWire | undefined
      let thrown = ''
      try {
        filtered = filterWire(split, tree.blockList, tree.framePluginId, tree.extraPluginIds, localRev, (line) =>
          warnings.push(line),
        )
      } catch (err) {
        thrown = err instanceof Error ? err.message : String(err)
      }
      check.eq(`${label}：block 的条目落在第二个批时过滤不抛错（#165 现场是抛 inconsistent）`, thrown, '')
      if (filtered === undefined) continue
      const app = filtered.batches.find((batch) => batch.phase === 'application')
      check.ok(
        `${label}：落在第二批的那条（${moved}）被剥干净——entries / 批 / combo URL 三处都没有`,
        !filtered.entries.some((entry) => entry.id === moved) &&
          app !== undefined &&
          !app.entries.includes(moved) &&
          !app.url.includes(moved),
        `entries 有=${String(filtered.entries.some((entry) => entry.id === moved))} 批有=${String(app?.entries.includes(moved) ?? true)} url 有=${String(app?.url.includes(moved) ?? true)}`,
      )
      check.ok(
        `${label}：第二批里没被 block 的官方件没被连坐丢掉（过滤只摘 block 的段）`,
        app !== undefined && app.entries.some((id) => wireIds.has(id) && !tree.blockList.some((entry) => entry.id === id)),
        `合并后的 application 批 ${String(app?.entries.length ?? 0)} 条`,
      )
      check.ok(
        `${label}：落在第二批的那条不该出现在「清单里没有」的报告里（它是真实存在、只是换了批）`,
        !warnings.some((line) => line.includes(moved)),
        warnings.join(' | ') || '（无报告）',
      )
    }
    // 判据没放宽：在 wire 里、却不在任何 application 批里时仍然硬抛（文案点名情形）。
    const unfilterable = AUDITED_TREES[0]
    const moved = unfilterable.tree.blockList.map((entry) => entry.id).find((id) => wireIds.has(id)) ?? ''
    if (moved !== '') {
      let message = ''
      try {
        filterWire(
          withoutApplicationBatch(wire, moved),
          unfilterable.tree.blockList,
          unfilterable.tree.framePluginId,
          unfilterable.tree.extraPluginIds,
          localRev,
        )
      } catch (err) {
        message = err instanceof Error ? err.message : String(err)
      }
      check.ok(
        `${unfilterable.label}：被 block 的条目在 wire 里却不在任何 application 批 → 仍然抛错（判据没放宽）`,
        message.includes('in no application batch') && message.includes(moved),
        message === '' ? '没抛错（判据被放宽了）' : message,
      )
    }
    return []
  },
}
