/**
 * 「profile 里的第三方插件 inject 了一个本树没有的服务」（#242，PROFILE-PLUGIN-SERVICE 套件）。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与 `thirdPartySuites.ts` 同一条：那个文件是本批
 * 开发的合入热点，新套件放外面能少一半冲突面。注册方式是在 `suites.ts` 的 `SUITES` 末尾追加一项。
 *
 * ## 这一条抓的是什么
 *
 * #242 的缺口在**离线**那一侧（算挡掉清单与漂移监控看不见 profile 里的第三方插件），
 * 修法也只动离线那一侧（`src/pure/blockListDerivation.ts` + `scripts/dsh-upstream-watch/blockListDrift.mjs`，
 * 判据见 `test/blockListDerivation.test.ts` / `test/blockListDrift.test.ts`）。那两件单测都只证明
 * 「算得出来」，证明不了**算出来的那句话是不是真的**：报的是「这件插件在这棵树里会停在 pending，
 * 官方启动审计点名它、页面自愈把它从本页清单里摘掉」——这一串运行期事实由本套件钉住。
 *
 * ## 现场怎么造（`thirdPartyPlugin.ts` 的 `services` 那一档）
 *
 * 同一个合成第三方插件（浏览器半的形状复刻现场那个包：一行、id 用模板字面量），只是把它的
 * `inject` 写成 `uiConversation`（{@link THIRD_PARTY_SERVICE}）：这个服务的提供方是官方
 * `dsh-client-ui-conversation`，而**侧栏树把它挡掉了**、对话区树里它在。于是同一台网关、
 * 同一个插件，两棵树的读数正好相反——这正是要看的东西：不是「插件坏了」，是「这棵树放不下它」。
 *
 * ## 判据
 *
 * ① **前提**：这一页的本页清单里带着那条第三方 id（entries / 它所在批的 entries / 批的
 *    combo URL 三处都在）——不是「网关没下发所以无关」。
 * ② **侧栏树**（这棵树没有它要的服务）：页面**照常起来**（就绪点出现、自有树有内容）、
 *    那个插件**没有**起来（它自己写的标记属性与全局都还是空）、控制台里官方那句启动审计
 *    点名它且写明 `waiting for service: uiConversation`、**页面自愈**把这一条从本页清单里
 *    摘掉（痕迹里是它的 id、这一页恰好加载了两次）。
 * ③ **对话区树**（同一台网关，这棵树有那个服务）：同一个插件**正常起来**（标记属性与全局
 *    都是它的 id）——按树判，不是一票否决。
 * ④ **负向对照**（`?selfHeal=off`，同一现场、去掉补救）：页面被官方那张失败卡挡住
 *    （首屏起不来、标记为空）——这就是「报出来的那句话」在运行期的分量：自愈不在，整页白。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { openTreePage, type OpenedPage } from './harness.ts'
import { LAB_TREES, startLabServer, type LabServer, type LabTreeRoute } from './labServer.ts'
import {
  readThirdParty,
  startGatewayWithThirdPartyPlugin,
  THIRD_PARTY_PLUGIN_ID,
  THIRD_PARTY_SERVICE,
} from './thirdPartyPlugin.ts'
import { SELF_HEAL_MARK } from '../../src/ui/assembly/selfHeal.ts'
import type { LogSink } from '../../src/log.ts'
// 只取类型（编译后不留 import，运行期没有环）：套件接口定义在 suites.ts 里。
import type { LabSuite } from './suites.ts'

const route = (name: string): LabTreeRoute => {
  const found = LAB_TREES.find((candidate) => candidate.route === name)
  if (found === undefined) throw new Error(`lab: unknown tree route ${name}`)
  return found
}

/** 这棵树没有 `uiConversation`（官方 ui-conversation 被它挡掉了）——#242 现场就在这一棵。 */
const SIDEBAR_TREE = route('sidebar')

/** 这棵树有 `uiConversation`：同一个插件在这里该正常起来（对照）。 */
const CHAT_TREE = route('chat')

/** 官方那句审计报错的头一行（与 F-01 / F-67 / F-69 同一条口径）。 */
const AUDIT_LINE = 'web boot:'

/** 页内簿记键：这一页被加载了几次（自愈重载过一次就是 2；与 F-67 同一套做法）。 */
const LOAD_COUNT_KEY = 'lab-profile-plugin-loads'

const LOAD_COUNT_SCRIPT = `(() => {
  try {
    var key = ${JSON.stringify(LOAD_COUNT_KEY)}
    sessionStorage.setItem(key, String(Number(sessionStorage.getItem(key) ?? "0") + 1))
  } catch (ignored) {}
})()`

/** 页面上的读数（一次 evaluate 取全）。 */
interface PageReading {
  /** 这一页被加载了几次（页内簿记）。 */
  loads: number
  /** `<html>` 上那格「本页清单被页面自己摘过」的痕迹（没摘过时 null）。 */
  healMark: string | null
  /** 这一页的清单里那条第三方 id 出现几处（entries / 它所在批 / 批的 combo URL）。 */
  counts: { entries: number; batches: number; urls: number }
  /** 首屏就绪点 `.dshOneTree_root` 在不在、里面几个元素。 */
  ready: boolean
  treeNodes: number
  /** `#root` 正文（压缩空白、截断）——负向对照读官方那张失败卡。 */
  rootText: string
}

async function readPage(page: OpenedPage['page'], readySelector: string): Promise<PageReading> {
  return page.evaluate(
    ({ loadKey, selfHealMark, wanted, selector }) => {
      const counts = { entries: 0, batches: 0, urls: 0 }
      const wire = (
        globalThis as {
          __DSH_BOOT__?: { entries?: { id?: unknown }[]; batches?: { entries?: unknown[]; url?: unknown }[] }
        }
      ).__DSH_BOOT__
      for (const row of wire?.entries ?? []) if (row?.id === wanted) counts.entries += 1
      for (const batch of wire?.batches ?? []) {
        for (const id of batch.entries ?? []) if (id === wanted) counts.batches += 1
        if (typeof batch.url === 'string' && batch.url.includes(`${wanted}/client.js`)) counts.urls += 1
      }
      const root = document.getElementById('root')
      return {
        loads: Number(sessionStorage.getItem(loadKey) ?? '0'),
        healMark: document.documentElement.getAttribute(selfHealMark),
        counts,
        ready: document.querySelector(selector) !== null,
        treeNodes: document.querySelectorAll(`${selector} *`).length,
        rootText: (root?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
      }
    },
    { loadKey: LOAD_COUNT_KEY, selfHealMark: SELF_HEAL_MARK, wanted: THIRD_PARTY_PLUGIN_ID, selector: readySelector },
  )
}

/** 官方那几类失败行（与 F-57 / F-67 / F-69 同一口径）。 */
const bootFailures = (capture: OpenedPage['capture']): string[] =>
  capture.consoleErrors.filter((line) => /did not activate|waiting for service|slot entry crashed/.test(line))

/** 把实验室服务器的日志收在内存里（诊断用）。 */
function recordingLogger(lines: string[]): LogSink {
  const push = (level: string, line: string): void => {
    lines.push(`${level} ${line}`)
  }
  return { info: (line) => push('info', line), warn: (line) => push('warn', line), error: (line) => push('error', line) }
}

async function shot(ctx: { shots: string }, page: OpenedPage['page'], name: string): Promise<string> {
  const file = path.join(ctx.shots, `${name}.png`)
  await fsp.mkdir(ctx.shots, { recursive: true })
  await page.screenshot({ path: file })
  return file
}

export const PROFILE_PLUGIN_SERVICE_SUITE: LabSuite = {
  id: 'F-70',
  phase: 'new-feature',
  name: 'profile 里的第三方插件等不到服务时：#242 离线算出来的那句话与运行期读数对得上',
  expect:
    '实验室自起一台实例，它的隔离 profile 里装着合成的第三方插件（浏览器半照现场那个包的形状写），这个插件 inject 了 `uiConversation`——提供方官方 `dsh-client-ui-conversation` 在**侧栏树**里被挡掉、在**对话区树**里在。① **前提**（`?selfHeal=off` 的那一页上读，那份清单是宿主下发的原样；缺省口径那一页的清单会被自愈自己改掉）：侧栏树的清单里带着那条第三方 id——entries / 它所在批的 entries / 批的 combo URL 三处各 1 次，这一页确实要取它。② **侧栏树**（缺省口径）：页面**照常起来**（就绪点 `.dshOneTree_root` 出现、自有树有内容），而那个插件**没有**起来（它自己写的 `data-lab-third-party` 与全局都为空）——控制台里是官方那句启动审计 `web boot: 1 entry did not activate` 且点名它、写明 `waiting for service: uiConversation`；**页面自愈**把这一条从本页清单里摘掉（`data-dshone-self-heal` 痕迹里是它的 id、这一页恰好加载了两次），并留一行日志写明摘了谁。③ **对话区树**（同一台网关、同一个插件、另一棵树）：插件**正常起来**（标记属性与全局都等于它的 id、零装载未激活）——按树判，不是一票否决。④ **负向对照**（就是①那一页：同一现场去掉补救）：页面被官方那张失败卡挡住（就绪点不出现、自有的树一个节点都没有、标记属性为空、`#root` 正文里是 `Failed to load plugins`）——这正说明②里报出来的那句话运行期的分量，也说明「不替用户挡掉、只报出来」这个处置是在自愈兜底之上的判断。',
  run: async (ctx, check): Promise<string[]> => {
    const shots: string[] = []
    const gatewayLines: string[] = []
    const fixedLog: string[] = []
    let server: LabServer | undefined
    const gateway = await startGatewayWithThirdPartyPlugin({
      services: [THIRD_PARTY_SERVICE],
      onLine: (line) => gatewayLines.push(line),
    })
    check.fact(
      `合成第三方插件（inject ${THIRD_PARTY_SERVICE}）的隔离 profile：HOME=${gateway.profileHome} DSH_HOME=${gateway.home} 实例=${gateway.origin} pid=${String(gateway.pid)} 版本=${gateway.version ?? '（读不到）'}`,
    )
    try {
      server = await startLabServer({
        gateway: gateway.origin,
        token: gateway.token,
        log: recordingLogger(fixedLog),
        pluginsDir: ctx.lab.pluginsDir,
        port: 0,
        external: ctx.lab.external,
        ...(gateway.version === undefined ? {} : { version: gateway.version }),
      })
      const open = (tree: LabTreeRoute, query: Record<string, string>, readyTimeoutMs: number): Promise<OpenedPage> =>
        openTreePage(ctx.browser, server as LabServer, tree, {
          width: 380,
          height: 900,
          readyTimeoutMs,
          settleMs: 2_000,
          initScript: LOAD_COUNT_SCRIPT,
          query,
        })

      // ----------------------------------------------------------------------
      // ① 前提 + ④ 负向对照：去掉自愈的那一页（这份清单是宿主下发的原样，没被自愈改过）
      // ----------------------------------------------------------------------
      // 前提为什么要读这一页：缺省口径那一页的清单会被**页面自愈自己**改掉（这正是②要验的
      // 事），所以「宿主确实下发了它」只能在没装自愈的那一页上读到原样。
      const bare = await open(SIDEBAR_TREE, { selfHeal: 'off' }, 12_000)
      try {
        const bareReading = await readPage(bare.page, '.dshOneTree_root')
        const bareMark = await readThirdParty(bare.page)
        check.fact(
          `① 前提（?selfHeal=off 那一页）：清单里那条第三方 id 出现 ${String(bareReading.counts.entries)} 次、所在批的 entries ${String(bareReading.counts.batches)} 次、批的 combo URL ${String(bareReading.counts.urls)} 次`,
        )
        check.ok(
          '① 前提：侧栏树的清单里带着那条第三方插件的 id（entries / 它所在批 / 批的 combo URL 三处各 1 次 —— 这一页确实要取它）',
          bareReading.counts.entries === 1 && bareReading.counts.batches === 1 && bareReading.counts.urls === 1,
          `entries=${String(bareReading.counts.entries)} 批 entries=${String(bareReading.counts.batches)} combo URL=${String(bareReading.counts.urls)}`,
        )
        check.ok(
          '④ 负向对照（?selfHeal=off）：页面起不来（就绪点不出现、自有的树一个节点都没有、那个插件也没起来）',
          !bare.ready && bareReading.treeNodes === 0 && bareMark.mark === null,
          `ready=${String(bare.ready)} 自有树节点=${String(bareReading.treeNodes)} 标记=${JSON.stringify(bareMark.mark)}`,
        )
        check.ok(
          '④ 负向对照：页面上是官方那张失败卡（`Failed to load plugins`）',
          bareReading.rootText.includes('Failed to load plugins'),
          `#root 正文=${JSON.stringify(bareReading.rootText)}`,
        )
        check.fact(
          `④ 负向对照读数：就绪=${String(bare.ready)}、加载次数=${String(bareReading.loads)}、标记属性=${JSON.stringify(bareMark.mark)}、#root 正文=${JSON.stringify(bareReading.rootText)}`,
        )
        shots.push(await shot(ctx, bare.page, 'f-70-1-negative-control-self-heal-off'))
      } finally {
        await bare.context.close()
      }

      // ----------------------------------------------------------------------
      // ② 侧栏树（缺省口径）：这棵树没有它要的服务 —— 插件起不来，页面自愈把它摘掉，页面照常起来
      // ----------------------------------------------------------------------
      const sidebar = await open(SIDEBAR_TREE, {}, 40_000)
      try {
        const reading = await readPage(sidebar.page, '.dshOneTree_root')
        const mark = await readThirdParty(sidebar.page)
        check.ok(
          '② 侧栏树：装配页照常起来（自有根出现、里面有内容）',
          sidebar.ready && reading.treeNodes > 0,
          `ready=${String(sidebar.ready)} 自有树节点=${String(reading.treeNodes)}`,
        )
        check.ok(
          '② 侧栏树：那个插件没有起来（它自己写的标记属性与全局都还是空）',
          mark.mark === null && mark.global === null,
          `[data-lab-third-party]=${JSON.stringify(mark.mark)} 全局=${JSON.stringify(mark.global)}`,
        )
        const failures = bootFailures(sidebar.capture)
        check.ok(
          '② 侧栏树：控制台里是官方那句启动审计、点名它并写明等的服务（与 #225 的现场同形）',
          failures.some((line) => line.includes(AUDIT_LINE) && line.includes(THIRD_PARTY_PLUGIN_ID) && line.includes(THIRD_PARTY_SERVICE)),
          `命中 ${String(failures.length)} 行；例如 ${JSON.stringify((failures[0] ?? '').slice(0, 200))}`,
        )
        check.ok(
          '② 侧栏树：页面自愈把这一条从本页清单里摘掉（痕迹里是它的 id、这一页恰好加载了两次）',
          reading.loads === 2 && (reading.healMark ?? '').split(',').includes(THIRD_PARTY_PLUGIN_ID),
          `加载次数=${String(reading.loads)} 自愈痕迹=${JSON.stringify(reading.healMark)} 摘后清单里它还剩 ${String(reading.counts.entries)} 条`,
        )
        check.ok(
          '② 侧栏树：自愈那一行日志留痕（写了摘了谁、因为什么）',
          sidebar.capture.consoleWarnings.some((line) => line.includes('page self-heal:') && line.includes(THIRD_PARTY_PLUGIN_ID)),
          sidebar.capture.consoleWarnings.filter((line) => line.includes('page self-heal:')).slice(0, 2).join(' | ') || '（没有自愈日志）',
        )
        check.fact(
          `② 侧栏树读数：就绪=${String(sidebar.ready)}、自有树节点 ${String(reading.treeNodes)} 个、标记属性=${JSON.stringify(mark.mark)}、全局=${JSON.stringify(mark.global)}、` +
            `加载次数=${String(reading.loads)}、装载未激活 ${String(failures.length)} 行、pageerror ${String(sidebar.capture.pageErrors.length)} 条、` +
            `审计原文=${JSON.stringify((failures[0] ?? '').slice(0, 200))}`,
        )
        shots.push(await shot(ctx, sidebar.page, 'f-70-2-sidebar-tree-plugin-cannot-activate'))
      } finally {
        await sidebar.context.close()
      }

      // ----------------------------------------------------------------------
      // ③ 对话区树：同一台网关、同一个插件，这棵树有那个服务 —— 插件正常起来
      // ----------------------------------------------------------------------
      const chat = await open(CHAT_TREE, {}, 40_000)
      try {
        const chatMark = await readThirdParty(chat.page)
        check.ok(
          '③ 对话区树：同一个插件在这棵树里正常起来了（标记属性与全局都是它的 id）',
          chatMark.mark === THIRD_PARTY_PLUGIN_ID && chatMark.global === THIRD_PARTY_PLUGIN_ID,
          `ready=${String(chat.ready)} [data-lab-third-party]=${JSON.stringify(chatMark.mark)} 全局=${JSON.stringify(chatMark.global)}`,
        )
        check.eq('③ 对话区树：零装载未激活 / 零 waiting for service', bootFailures(chat.capture), [])
        check.fact(
          `③ 对话区树读数：就绪=${String(chat.ready)}、标记属性=${JSON.stringify(chatMark.mark)}、` +
            `装载未激活 ${String(bootFailures(chat.capture).length)} 行、pageerror ${String(chat.capture.pageErrors.length)} 条`,
        )
        shots.push(await shot(ctx, chat.page, 'f-70-3-chat-tree-same-plugin-activates'))
      } finally {
        await chat.context.close()
      }

      check.fact(`实例启动输出（前 3 行）：${gatewayLines.join(' ').slice(0, 300)}`)
      check.fact(`实验室服务器日志 ${String(fixedLog.length)} 行（信息级 ${String(fixedLog.filter((line) => line.startsWith('info')).length)} 行）`)
    } finally {
      server?.dispose()
      await gateway.dispose()
    }
    return shots
  },
}
