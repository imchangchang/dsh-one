/**
 * 「全新 `DSH_HOME`」上的 boot 契约套件（#164）。
 *
 * 日常那台网关带着用户 profile 的全部补丁，所以有些缺口在它上面**永远看不见**：
 * #164 的现场就是侧栏树把 `@deepseek-ai/dsh-client-ui-commands` 挡在门外，而官方
 * `ui-model-selection` 按服务名依赖它提供的 `commandUi`——boot 卡在这个条目上、
 * 整页抛错、侧栏树整个挂不上；可这台机器的日常 profile 里 `ui-model-selection`
 * 早被 `@dsh-one/dsh-llm-provider` 的 bundle patch 连带关掉了，没人去等那个服务，
 * 于是本地怎么跑都是绿的，只有**新装用户**会看到一片空白（2.0.0 发布前的阻塞项）。
 *
 * 所以这一条与 F-10/F-11 的差别不在判据，在**跑在哪台网关上**：它自己起一台
 * 全新 `DSH_HOME` 的网关（`freshGateway.ts`，跑完按 PID 收掉、临时目录删掉），
 * 把那台干净实例上「树到底挂不挂得上」变成常驻断言。
 *
 * 与 #162（「空实例整轮」门禁）的分工：那条做的是**整轮套件跑在空实例上**
 * （普查全部套件的判据自足性），本条只钉**装载这一层**（四棵树挂得上、零未激活、
 * 零 FAILED），跑在自己起的网关上、自足、不依赖 `--empty` 模式。#162 要复用这台
 * 网关时直接用 `freshGateway.ts` 的 `startFreshGateway()`。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import {
  contractGaps,
  describeFiberFailure,
  fiberStateCounts,
  openTreePage,
  waitForFiberQuiet,
  type OpenedPage,
} from './harness.ts'
import { defaultPluginsDir, LAB_TREES, startLabServer, consoleLogger, type LabTreeRoute } from './labServer.ts'
import { startFreshGateway } from './freshGateway.ts'
import { listSessions } from '../../src/server/dshRpc.ts'
// 只取类型（编译后不留 import，运行期没有环）：套件接口定义在 suites.ts 里。
import type { LabSuite } from './suites.ts'

const route = (name: string): LabTreeRoute => {
  const found = LAB_TREES.find((candidate) => candidate.route === name)
  if (found === undefined) throw new Error(`lab: unknown tree route ${name}`)
  return found
}

/**
 * 验的三棵生产树。
 *
 * 实验室那棵 `sidebar-official` 对照档不在列：它不是生产形态，且它的 block list
 * 与 sidebar 树是同一份（`SIDEBAR_OFFICIAL_TREE` 只少一个自有插件 id），
 * 真断也是同一处断——与其多花十几秒，不如让这条跑得紧一点。
 */
const TREES = ['sidebar', 'chat', 'settings'] as const

/** 各树的页面尺寸（与 F-01 / F-10 同口径：侧栏窄、对话区与设置页宽）。 */
const VIEWPORT: Readonly<Record<string, { width: number; height: number }>> = {
  sidebar: { width: 380, height: 900 },
}

/** 本次页面里出现过的 `/plugins-local/` combo 请求（插件真的进了装配清单的证据）。 */
async function combosRequested(page: OpenedPage['page']): Promise<string[]> {
  return page.evaluate(
    () =>
      (
        performance.getEntriesByType('resource') as PerformanceResourceTiming[]
      )
        .map((entry) => entry.name)
        .filter((name) => name.includes('/plugins-local/')),
  )
}

export const FRESH_PROFILE_BOOT_SUITE: LabSuite = {
  id: 'F-55',
  phase: 'new-feature',
  name: '全新 DSH_HOME 上的 boot：三棵生产树都挂得上、零装载未激活、零 fiber FAILED（#164）',
  expect:
    '实验室自己起一台**全新 `DSH_HOME`** 的 dsh 网关（`--port 0` 随机端口、`--no-open`、临时目录当 HOME，跑完按 PID 收掉并删目录——不碰用户的 3080，也不写 `~/.dsh/dsh-owned.json`），再用实验室的四棵树定义对着它开 `sidebar` / `chat` / `settings` 三棵生产树：① **每棵树的就绪点都出现**（侧栏是自有 `.dshOneTree_root`，也就是说整棵树真的挂上了）；② **零装载未激活**（官方 `web boot: … did not activate` / `waiting for service`）——boot 的规矩是一个条目没激活就整页抛错，所以这一条就是「干净 profile 上能不能打开」的可执行判据；③ 零 `slot entry crashed` / `data-slot-error`、零 pageerror；④ 页面里的 cordis fiber 探针报**零 scope 进 FAILED**（探针自身接上了总线上、真观察到状态变化，否则「零失败」是空的）。另外钉住侧栏树的装配清单里**含** `ui-commands` 与 `ui-permission-presets` 两件（#164 放行的那两件，boot 卡住时它们不在 combo 里），以及这台网关**开局是零会话**（证明这一轮验的真是干净 profile）。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const fresh = await startFreshGateway()
    check.fact(
      `全新网关：DSH_HOME=${fresh.home} ${fresh.origin} pid=${String(fresh.pid)} 版本=${fresh.version ?? '（读不到）'}`,
    )
    let lab
    try {
      lab = await startLabServer({
        gateway: fresh.origin,
        token: fresh.token,
        log: consoleLogger(true),
        pluginsDir: defaultPluginsDir(),
        // 随机端口：实验室自己那台的端口不跟别人抢。
        port: 0,
        ...(fresh.version === undefined ? {} : { version: fresh.version }),
      })
      const sessionsAtStart = await listSessions(fresh.origin)
      check.fact(`全新网关上开局会话数=${String(sessionsAtStart.length)}`)
      check.eq('全新 DSH_HOME 的网关上开局零会话（这一轮验的真是干净 profile）', sessionsAtStart.length, 0)

      for (const name of TREES) {
        const tree = route(name)
        const opened = await openTreePage(ctx.browser, lab, tree, {
          ...(VIEWPORT[name] ?? { width: 1200, height: 900 }),
          fiberProbe: true,
          readyTimeoutMs: 25_000,
          settleMs: 800,
        })
        const { page, capture } = opened
        try {
          const gaps = contractGaps(capture)
          check.fact(
            `${name}：ready=${String(opened.ready)} 未激活=${String(gaps.bootFails.length)} 崩溃日志=${String(gaps.crashes.length)} pageerror=${String(gaps.pageErrors.length)}`,
          )
          check.ok(`${name}：首屏就绪（${tree.readySelector}）`, opened.ready, `就绪点没出现：${tree.readySelector}`)
          check.eq(`${name}：零装载未激活（缺服务/缺钩子）`, gaps.bootFails, [])
          check.eq(`${name}：零槽位崩溃日志（slot entry crashed）`, gaps.crashes, [])
          check.eq(`${name}：零 pageerror（已知噪音另计）`, gaps.pageErrors, [])

          const facts = await waitForFiberQuiet(page, check, name)
          check.fact(
            `${name}：探针登记插件=${String(facts.plugins.length)} 事件总线=${String(facts.attached)} scope=${String(facts.scopes.length)} 状态分布=${JSON.stringify(fiberStateCounts(facts))}`,
          )
          check.ok(`${name}：fiber 探针接上了 cordis 事件总线（0 = 这条断言的证据链断了）`, facts.attached >= 1, `attached=${String(facts.attached)}`)
          check.ok(`${name}：观察到 scope 状态变化（真看到 fiber 生命周期，不是没数据）`, facts.scopes.length > 0, `scopes=${String(facts.scopes.length)}`)
          check.eq(`${name}：fiber 探针自身零异常`, facts.errors, [])
          check.eq(`${name}：零 scope 进 FAILED`, facts.failed.map(describeFiberFailure), [])

          if (name === 'sidebar') {
            const combo = (await combosRequested(page)).join('\n')
            // #164 的两个放行件：boot 卡住时它们不在 combo 里（它们原先被挡在门外），
            // 所以这一条是「#164 修好了」最直接的证据，比只看页面挂没挂更早定位。
            for (const id of ['@deepseek-ai/dsh-client-ui-commands', '@deepseek-ai/dsh-client-ui-permission-presets']) {
              check.ok(`sidebar：combo 里有 ${id}（#164 放行的两件）`, combo.includes(`${id}/client.js`), '该插件不在本页的 /plugins-local 请求里')
            }
          }
          const file = path.join(ctx.shots, `fresh-profile-${name}.png`)
          await fsp.mkdir(ctx.shots, { recursive: true })
          await page.screenshot({ path: file })
          screenshots.push(file)
        } finally {
          await opened.context.close()
        }
      }

      // 干净实例是**一次性**的（process 收掉、目录删掉），所以这里不像 R-06 那样
      // 拿它当只读证据，只记一笔事实：三棵树开下来它自己长了多少会话。
      const sessionsAtEnd = await listSessions(fresh.origin).catch(() => null)
      check.fact(
        `全新网关上跑完会话数=${sessionsAtEnd === null ? '（读不到）' : String(sessionsAtEnd.length)}（开局 ${String(sessionsAtStart.length)}）`,
      )
    } finally {
      lab?.dispose()
      await fresh.dispose()
      const homeGone = await fsp.stat(fresh.home).then(() => false, () => true)
      check.fact(`收尾：临时 DSH_HOME 已删除=${String(homeGone)}`)
    }
    return screenshots
  },
}
