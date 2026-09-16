/**
 * 漂移断言套件（#91）：官方改了东西导致我们的插件树不工作时，在实验室先红。
 *
 * 与既有两个检测面的分工：
 * - **每日上游探针**（`scripts/dsh-upstream-watch/` 的 `clientContract.mjs`）离线扫
 *   官方 combo，查的是**名字还在不在**（slot / root hook / 字段名 / combo 结构），
 *   CI 每天跑，红了自动建 issue。它不知道我们的三棵树装起来是什么样。
 * - **F-01 CONTRACT**（`suites.ts`）在浏览器里查**装起来的症状**：座位锚点、
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
  Check,
  fiberFacts,
  openTreePage,
  type FiberProbeFacts,
  type FiberScopeFact,
  type OpenedPage,
} from './harness.ts'
import { LAB_TREES, type LabServer, type LabTreeRoute } from './labServer.ts'
import { ASSEMBLY_TREES, type AssemblyTree } from '../../src/ui/assembly/trees.ts'
// 只取类型（编译后不留 import，运行期没有环）：套件接口定义在 suites.ts 里，
// 它就是本文件的调用方（SUITES 数组末尾追加这两个套件）。
import type { LabSuite } from './suites.ts'

// ---------------------------------------------------------------------------
// F-10 FIBER：四棵树里没有任何 cordis scope 进 FAILED
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

/**
 * 等 fiber 状态**静下来**再下结论。
 *
 * 为什么不能只睡一个固定时长：失败发生在会话级 scope 创建那一刻（#74 那条就是），
 * 而那一刻取决于会话数据什么时候到——睡短了会漏，睡长了每棵树白等。这里改成看
 * `internal/status` 事件的增长：连续 `quietMs` 没有新事件就当这棵树装完了，
 * 上限 `maxMs` 兜底（跑着的会话会持续推流，不能无限等）。
 */
async function waitForFiberQuiet(
  page: OpenedPage['page'],
  check: Check,
  label: string,
  options: { quietMs?: number; maxMs?: number } = {},
): Promise<FiberProbeFacts> {
  const quietMs = options.quietMs ?? 1500
  const maxMs = options.maxMs ?? 15_000
  const started = Date.now()
  let facts = await fiberFacts(page)
  let lastEvents = facts?.events ?? -1
  let quietSince = Date.now()
  while (Date.now() - started < maxMs) {
    await page.waitForTimeout(250)
    const next = await fiberFacts(page)
    if (next === null) break
    facts = next
    if (next.events !== lastEvents) {
      lastEvents = next.events
      quietSince = Date.now()
      continue
    }
    if (Date.now() - quietSince >= quietMs) break
  }
  check.fact(`${label}：fiber 探针等待 ${String(Date.now() - started)}ms 后静下来（事件数 ${String(facts?.events ?? -1)}）`)
  if (facts === null) throw new Error(`${label}: fiber 探针没装上（页面里没有 __LAB_FIBER__）`)
  return facts
}

/** 一条失败 scope 的人话描述（失败信息里直接点名插件、状态与原因）。 */
function describeFailure(fact: FiberScopeFact): string {
  const who = fact.plugin ?? `无主 scope（uid=${String(fact.uid)}${fact.name === '' ? '' : `, name=${fact.name}`}）`
  return `${who}: ${fact.error === '' ? `状态 ${fact.prev} → ${fact.state}` : fact.error}`
}

/** 各状态的 scope 数（报告里的观测行用）。 */
function stateCounts(facts: FiberProbeFacts): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const scope of facts.scopes) counts[scope.state] = (counts[scope.state] ?? 0) + 1
  return counts
}

export const FIBER_SUITE: LabSuite = {
  id: 'F-10',
  phase: 'new-feature',
  name: 'fiber 级契约：四棵树里没有任何 cordis scope 进 FAILED（FIBER 套件）',
  expect:
    '实验室四棵树（自有 sidebar 树、官方浏览区对照档、chat 树、settings 树）在真实网关只读下打开，页面里装上 cordis fiber 探针（包 `__ModuleLoader__.load` 的 factory 记插件 id → 包 `@deepseek-ai/dsh-client-modules` 的 apply 拿 ctx → 监听 `internal/plugin` 与 `internal/status`，见 `fiberProbeScript`）：**没有任何 scope 进 FAILED**（官方 Fiber 状态枚举里的 3）。这条断言要抓的是 F-01 抓不到的那一类——cordis 插件 fiber 失败**不进浏览器控制台**（官方 client logger 没有 console exporter），#74 那条 `slot "conversation.hero.agentPreset" is not declared` 就是靠派生症状才被发现的；F-01 看的是装起来的症状（座位锚点、槽位崩溃、页面报错），这条看的是**装载本身**。同时钉住探针本身没瞎：接上了事件总线、登记到了该树的自有 frame 插件、真观察到 scope 状态变化、探针自身零异常——否则「零失败」是空的。',
  run: async (ctx, check) => {
    for (const name of ['sidebar', 'sidebar-official', 'chat', 'settings']) {
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
          `${name}：探针登记插件=${String(facts.plugins.length)} 事件总线=${String(facts.attached)} 状态事件=${String(facts.events)} scope=${String(facts.scopes.length)} 状态分布=${JSON.stringify(stateCounts(facts))}`,
        )
        check.ok(
          `${name}：fiber 探针接上了 cordis 事件总线（0 = 这条断言的证据链断了）`,
          facts.attached >= 1,
          `attached=${String(facts.attached)}`,
        )
        check.ok(
          `${name}：探针登记到该树的自有 frame 插件 ${tree.tree.shellPluginId}（确认探针装在这棵树上）`,
          facts.plugins.includes(tree.tree.shellPluginId),
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
          facts.failed.map(describeFailure),
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
 * 被检查的树 = 三棵生产树；标签取实验室的路由名（chat / sidebar / settings）。
 * 第四棵树 `sidebar-official` 是侧栏树的对照档（同一份 block list，只是不装自有
 * 树插件），按 `shellPluginId` 去重掉，避免同一条 block list 被报两遍。
 */
const AUDITED_TREES: ReadonlyArray<{ label: string; tree: AssemblyTree }> = ((): Array<{ label: string; tree: AssemblyTree }> => {
  const seen = new Set<string>()
  const audited: Array<{ label: string; tree: AssemblyTree }> = []
  for (const entry of LAB_TREES) {
    if (seen.has(entry.tree.shellPluginId)) continue
    seen.add(entry.tree.shellPluginId)
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
 * （今天的两条死条目正是后者：ui-settings-models 并进了 ui-settings、
 * ui-model-selection 并进了 ui-conversation），猜出来的邻居能让读报告的人立刻
 * 知道去哪里看，而不是对着一个不存在的 id 发呆。猜空就如实说猜空。
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

export const WIRE_LIVENESS_SUITE: LabSuite = {
  id: 'F-11',
  phase: 'new-feature',
  name: 'block list 存活性：三棵树 block 的每个官方插件 id 都能在当天网关 wire 里找到（WIRE-LIVENESS 套件）',
  expect:
    '拿**当天网关下发的官方 wire**（实验室各页面的装配来源，`lab.gatewayPluginIds()`）逐棵树核 block list：`chat` / `sidebar` / `settings` 三棵树引用的每个官方插件 id 都必须能在 wire 的 entries 里找到，一条都不能缺。红了就是清单与现实漂移了——官方把某个被 block 的插件**改名或并进别的插件**时，新 id 不会被剥掉，官方件会静默混进树里（`filterWire` 只会打一条 warn，不阻断装配），而这正是最难排查的那种「看着正常、其实多了个不该在的官方件」。失败信息带上「哪棵树 + 哪个 id + 当天 wire 里含同名词的邻近 id（可能改成了谁）」。红了怎么办：按官方 release notes 或官方源码确认它的新装载方式，把这条 block 改成新 id（内容搬进别的插件时通常是**摘除**这条，因为那个 id 已经不存在了），摘除要照 CHAT_FLOW / SETTINGS_PAGES 的写法写明为什么。三棵树都查（`sidebar-official` 对照档与 `sidebar` 同一份 block list，去重后不重复报）。',
  run: async (ctx, check) => {
    const wireIds = await ctx.lab.gatewayPluginIds()
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
    return []
  },
}
