/**
 * 「profile 里装了一个第三方 dsh 插件」的回归夹具（#237，THIRD-PARTY-PLUGIN 套件）。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与 `comboCacheKeySuites.ts` 同一条：那个文件
 * 是本批开发的合入热点，新套件放外面能少一半冲突面。注册方式是在 `suites.ts` 的 `SUITES`
 * 末尾追加一项。
 *
 * ## 这一条抓的是什么
 *
 * 用户现场（#237）：装了第三方插件 `@changfenhuang/dsh-genui` 之后，dsh web 正常、
 * dsh-one 整页起不来。宿主日志里那句
 * `assembly mirror: rejected local combo ids @changfenhuang/dsh-genui,…` 就是根因的脚印：
 * 我们转发的整包被**整份拒绝**，页面那一批模块一条都拿不到（连官方件一起 `import failed`，
 * 第一条就是 `dsh-api-gateway`）。
 *
 * 为什么会判错：镜像当时按「这个 id 在不在我刚才读到的官方整包里」分类，而**认段首 id 的
 * 正则只认双引号**——第三方包的产物把自己那一行写成模板字面量
 * （`window.__ModuleLoader__.load({id:\`@changfenhuang/dsh-genui\`,…})`），于是它进了
 * 「不认识的本地件」那一桶，整份请求 404。
 *
 * ## 现场怎么造（`thirdPartyPlugin.ts`）
 *
 * 现造一个**合成的第三方插件包**（浏览器半写成那个包同样的形状：一行、id 用模板字面量），
 * 用官方那条命令 `dsh plugin --profile web add file:<目录>` 装进**隔离 profile**，再起一台
 * 实例。所以这条夹具验的是完整的那条链路：网关整包里真的有它 → 我们的 mirror 转发的整包里
 * 也得有它 → 页面上它的条目真的跑起来。
 *
 * ## 判据
 *
 * ① **前提**（现场成立）：这一页的本页清单里有那条第三方 id，而且它所在批的 entries 与
 *    combo URL 都带着它——也就是说，这一页**确实要取它**（不是「网关没下发所以无关」）。
 * ② **正面**（缺省口径 = 生产口径）：装配页照常起来（就绪点出现、自有的树有内容）、
 *    那个插件的条目**真的在页面上跑起来了**（它自己写的 `<html>` 标记属性与全局都到位）、
 *    零装载未激活 / 零槽位崩溃 / 零 pageerror、镜像日志里**没有**那句「rejected local combo
 *    ids」；再把这页发过的那条整包 URL 从进程侧取一次：**HTTP 200**，正文里含那条第三方
 *    插件的段（不是「被拒所以浏览器拿到 404」）。
 * ③ **负向对照**（把分类改回改前那一套，同一个现场）：同一台网关、同一棵树、同一个 URL
 *    ——整包回 **404**、镜像日志里正是现场那句 `rejected local combo ids …`、页面**起不来**
 *    （就绪点不出现、插件的标记属性为空、控制台里是官方报出来的那句失败——启动审计那句 `web boot: … did not activate`，或在 0.1.5 线那种「审计跑不到」的版本上的 `failed to import loader entry …`）。
 *    这一档存在的理由只有一个：证明上面那条正面判据真的抓得住这个 bug——分类一改回去就必须红。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { openTreePage, type OpenedPage } from './harness.ts'
import { LAB_TREES, startLabServer, type LabServer, type LabTreeRoute } from './labServer.ts'
import {
  readThirdParty,
  startGatewayWithThirdPartyPlugin,
  THIRD_PARTY_MARK,
  THIRD_PARTY_PLUGIN_ID,
} from './thirdPartyPlugin.ts'
import type { LogSink } from '../../src/log.ts'
// 只取类型（编译后不留 import，运行期没有环）：套件接口定义在 suites.ts 里。
import type { LabSuite } from './suites.ts'

const route = (name: string): LabTreeRoute => {
  const found = LAB_TREES.find((candidate) => candidate.route === name)
  if (found === undefined) throw new Error(`lab: unknown tree route ${name}`)
  return found
}

/** 这一条只开侧栏树：用户现场里被点名的那条自有插件正是它的 frame 插件。 */
const SIDEBAR_TREE = route('sidebar')

/** 官方那句审计报错的头一行（与 F-01 / F-67 同一条口径）。 */
const AUDIT_LINE = 'web boot:'

/**
 * 0.1.5 线那一代的失败文本头（那一代审计跑不到，见 `harness.ts` 的 `BOOT_FAIL_RE`）。
 * 负向对照在那一代报的就是它。
 */
const LEGACY_ENTRY_FAIL = 'failed to import loader entry'

/** 镜像那句「整份拒绝」的日志（现场日志里逐字如此）。 */
const REJECT_LOG = 'rejected local combo ids'

/** 把实验室服务器的日志收在内存里（诊断与断言都要它，见文件头的判据②③）。 */
function recordingLogger(lines: string[]): LogSink {
  const push = (level: string, line: string): void => {
    lines.push(`${level} ${line}`)
  }
  return { info: (line) => push('info', line), warn: (line) => push('warn', line), error: (line) => push('error', line) }
}

/** 页面发过的整包请求里最长的那一条（application 整包，id 列表最全）。 */
async function comboUrlOf(page: OpenedPage['page']): Promise<string> {
  return page.evaluate(() => {
    const urls = (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
      .map((entry) => entry.name)
      .filter((name) => name.includes('/plugins-local/'))
    return urls.reduce((best, candidate) => (candidate.length > best.length ? candidate : best), '')
  })
}

/** 页面这份清单里那条第三方插件的位置（前提判据：这一页确实要取它）。 */
interface ManifestReading {
  entries: number
  batchEntries: number
  comboUrls: number
  comboUrl: string
}

async function readManifest(page: OpenedPage['page'], id: string): Promise<ManifestReading> {
  return page.evaluate((wanted: string) => {
    const wire = (globalThis as { __DSH_BOOT__?: { entries?: { id?: unknown }[]; batches?: { phase?: string; entries?: unknown[]; url?: unknown }[] } }).__DSH_BOOT__
    let entries = 0
    let batchEntries = 0
    let comboUrls = 0
    let comboUrl = ''
    for (const row of wire?.entries ?? []) if (row?.id === wanted) entries += 1
    for (const batch of wire?.batches ?? []) {
      if (batch?.phase !== 'application') continue
      for (const entry of batch.entries ?? []) if (entry === wanted) batchEntries += 1
      if (typeof batch.url === 'string' && batch.url.includes(`${wanted}/client.js`)) {
        comboUrls += 1
        comboUrl = batch.url
      }
    }
    return { entries, batchEntries, comboUrls, comboUrl }
  }, id)
}

/**
 * 官方那几类失败行（与 F-57 / F-67 同一口径）：启动审计那一句、0.1.5 线的 loader entry 那一句、
 * 缺服务、槽位崩溃。**两种失败文本都算**（理由见 `harness.ts` 的 `BOOT_FAIL_RE`）——不认
 * 0.1.5 线那一种的话，负向对照在这一代就「控制台里读不到官方那句」而假红。
 */
const bootFailures = (capture: OpenedPage['capture']): string[] =>
  capture.consoleErrors.filter((line) => /did not activate|waiting for service|failed to (?:import|apply) loader entry|slot entry crashed/.test(line))

async function shot(ctx: { shots: string }, page: OpenedPage['page'], name: string): Promise<string> {
  const file = path.join(ctx.shots, `${name}.png`)
  await fsp.mkdir(ctx.shots, { recursive: true })
  await page.screenshot({ path: file })
  return file
}

export const THIRD_PARTY_PLUGIN_SUITE: LabSuite = {
  id: 'F-69',
  phase: 'new-feature',
  name: 'profile 里的第三方插件不再让整页起不来（#237）：整包分类按来源、单点不认识只丢那一条',
  expect:
    '实验室自起一台实例，它的**隔离 profile 里装着一个合成的第三方插件**（浏览器半的形状复刻现场那一个包：一行、id 写成模板字面量，装包走官方命令 `dsh plugin --profile web add file:<目录>`，见 `thirdPartyPlugin.ts` 的文件头），再用**缺省口径**（= 生产口径）的实验室服务器开侧栏树页面。① **前提**：这一页的本页清单里有那条第三方 id，而且它所在 application 批的 entries 与批的 combo URL 都带着它（这一页确实要取它）；② **正面**：装配页**照常起来**（就绪点 `.dshOneTree_root` 出现、自有的树有内容）、那个插件的条目**真的在页面上跑起来了**（它自己往 `<html>` 写的 `data-lab-third-party` 与那个全局都等于它的 id）、零装载未激活 / 零槽位崩溃 / 零 pageerror、镜像日志里**没有** `rejected local combo ids` 那一句，再把这页发过的那条整包 URL 从进程侧取一次：**HTTP 200** 且正文里含它的段（不是被拒之后的 404）；③ **负向对照**（同一台网关、同一棵树、同一个 URL，把分类换回改前那一套：只认双引号的 id + 不认识就整份 404）：整包回 **404**、镜像日志里正是现场那句 `rejected local combo ids …@dsh-external/dsh-lab-third-party`、页面**起不来**（就绪点不出现、插件的标记属性为空、控制台里是官方报出来的那句失败——启动审计那句 `web boot: … did not activate` 加点名那条 id，或在 0.1.5 线那种「审计跑不到」的版本上的 `failed to import loader entry <entryId> (<id>): …`）。三档读数都要有：缺了负向对照就说明不了「这条夹具真的抓得住这个 bug」。',
  run: async (ctx, check): Promise<string[]> => {
    const shots: string[] = []
    const gatewayLines: string[] = []
    const fixedLog: string[] = []
    const legacyLog: string[] = []
    let fixed: LabServer | undefined
    let legacy: LabServer | undefined
    const gateway = await startGatewayWithThirdPartyPlugin({ onLine: (line) => gatewayLines.push(line) })
    check.fact(
      `合成第三方插件的隔离 profile：HOME=${gateway.profileHome} DSH_HOME=${gateway.home} 实例=${gateway.origin} pid=${String(gateway.pid)} 版本=${gateway.version ?? '（读不到）'}`,
    )
    try {
      // ----------------------------------------------------------------------
      // ② 正面：缺省口径（生产口径）—— 装配页照常起来、那个插件的条目在页面上
      // ----------------------------------------------------------------------
      fixed = await startLabServer({
        gateway: gateway.origin,
        token: gateway.token,
        log: recordingLogger(fixedLog),
        pluginsDir: ctx.lab.pluginsDir,
        port: 0,
        external: ctx.lab.external,
        ...(gateway.version === undefined ? {} : { version: gateway.version }),
      })
      const healthy = await openTreePage(ctx.browser, fixed, SIDEBAR_TREE, {
        width: 380,
        height: 900,
        readyTimeoutMs: 40_000,
        settleMs: 2_000,
      })
      try {
        const manifest = await readManifest(healthy.page, THIRD_PARTY_PLUGIN_ID)
        check.fact(
          `① 前提：本页清单里那条第三方 id 出现 ${String(manifest.entries)} 次、所在批的 entries ${String(manifest.batchEntries)} 次、批的 combo URL ${String(manifest.comboUrls)} 次`,
        )
        check.ok(
          '① 前提：这一页的本页清单里带着那条第三方插件的 id，它所在批的 entries 与批的 combo URL 也带着它（这一页确实要取它）',
          manifest.entries === 1 && manifest.batchEntries === 1 && manifest.comboUrls === 1,
          `entries=${String(manifest.entries)} 批 entries=${String(manifest.batchEntries)} combo URL=${String(manifest.comboUrls)}`,
        )
        check.fact(`① 这一页请求的整包 URL（清单里那一份是相对的）：${manifest.comboUrl}`)
        // 页面实际发出的那一条（performance 里是绝对 URL）：进程侧取它，看到的就是镜像原样回的。
        const comboUrl = await comboUrlOf(healthy.page)
        check.ok(
          '② 正面：这一页真的去取了那条第三方插件的整包（请求 URL 里带着它）',
          comboUrl.includes(THIRD_PARTY_PLUGIN_ID),
          comboUrl.slice(0, 200),
        )
        const mark = await readThirdParty(healthy.page)
        check.ok(
          '② 正面：装配页照常起来（侧栏树的自有根出现了，而且里面有内容）',
          healthy.ready &&
            (await healthy.page.evaluate(() => document.querySelectorAll('.dshOneTree_root *').length)) > 0,
          `ready=${String(healthy.ready)}`,
        )
        check.ok(
          '② 正面：第三方插件的条目真的在页面上跑起来了（它自己写的标记属性 + 那个全局都是它的 id）',
          mark.mark === THIRD_PARTY_PLUGIN_ID && mark.global === THIRD_PARTY_PLUGIN_ID,
          `[${THIRD_PARTY_MARK}]=${JSON.stringify(mark.mark)} 全局=${JSON.stringify(mark.global)}`,
        )
        check.eq('② 正面：零装载未激活 / 零槽位崩溃 / 零 waiting for service', bootFailures(healthy.capture), [])
        check.eq('② 正面：零 pageerror', healthy.capture.pageErrors, [])
        check.ok(
          '② 正面：镜像日志里没有「整份拒绝」那一句（整包按来源分类，那条第三方 id 不再被当成不认识的本地件）',
          fixedLog.every((line) => !line.includes(REJECT_LOG)),
          fixedLog.filter((line) => line.includes('rejected') || line.includes('combo')).slice(0, 3).join(' | ') || '（镜像日志里没有相关行）',
        )
        const served = await fetch(comboUrl)
        const body = await served.text()
        check.eq('② 正面：这条整包从进程侧取回来是 HTTP 200', served.status, 200)
        const treeNodes = await healthy.page.evaluate(() => document.querySelectorAll('.dshOneTree_root *').length)
        check.fact(
          `② 正面：就绪=${String(healthy.ready)}、自有树节点 ${String(treeNodes)} 个、标记属性=${JSON.stringify(mark.mark)}、全局=${JSON.stringify(mark.global)}、` +
            `整包 HTTP ${String(served.status)}、正文 ${String(body.length)} 字节（含那条第三方 id = ${String(body.includes(THIRD_PARTY_PLUGIN_ID))}）、` +
            `装载未激活 ${String(bootFailures(healthy.capture).length)} 行、pageerror ${String(healthy.capture.pageErrors.length)} 条`,
        )
        check.ok(
          '② 正面：整包正文里含那条第三方插件的 id（它的段真的被伺服了，不是被拒之后的 404）',
          body.includes(THIRD_PARTY_PLUGIN_ID),
          `正文 ${String(body.length)} 字节，含 ${THIRD_PARTY_PLUGIN_ID} = ${String(body.includes(THIRD_PARTY_PLUGIN_ID))}`,
        )
        check.ok(
          '② 正面：整包正文里也含官方保留段（这一份是「网关那份原样 + 我们自己的拼尾」）',
          body.includes('window.__ModuleLoader__.load('),
          `正文 ${String(body.length)} 字节`,
        )
        shots.push(await shot(ctx, healthy.page, 'f-69-1-third-party-in-profile-boots'))
      } finally {
        await healthy.context.close()
      }

      // ----------------------------------------------------------------------
      // ③ 负向对照：把分类改回改前那一套 —— 同一个现场必须红
      // ----------------------------------------------------------------------
      legacy = await startLabServer({
        gateway: gateway.origin,
        token: gateway.token,
        log: recordingLogger(legacyLog),
        pluginsDir: ctx.lab.pluginsDir,
        port: 0,
        external: ctx.lab.external,
        legacyLocalClassification: true,
        ...(gateway.version === undefined ? {} : { version: gateway.version }),
      })
      const broken = await openTreePage(ctx.browser, legacy, SIDEBAR_TREE, {
        width: 380,
        height: 900,
        readyTimeoutMs: 12_000,
        settleMs: 2_000,
      })
      try {
        const legacyUrl = await comboUrlOf(broken.page)
        check.ok('③ 负向对照：这一页照样发出了整包请求（现场成立，不是「没请求所以没红」）', legacyUrl.includes(THIRD_PARTY_PLUGIN_ID), legacyUrl.slice(0, 160))
        const rejected = await fetch(legacyUrl)
        check.eq('③ 负向对照：同一条整包 URL 在新口径下是 200、在改前那套分类下回 404', rejected.status, 404)
        check.ok(
          '③ 负向对照：镜像日志里正是现场那句「rejected local combo ids …」（点名那条第三方 id）',
          legacyLog.some((line) => line.includes(REJECT_LOG) && line.includes(THIRD_PARTY_PLUGIN_ID)),
          legacyLog.filter((line) => line.includes(REJECT_LOG)).slice(0, 2).join(' | ') || '（镜像日志里没有那一句）',
        )
        const brokenMark = await readThirdParty(broken.page)
        check.ok(
          '③ 负向对照：页面起不来（侧栏树的自有根没出现、那个插件的标记属性是空的）',
          !broken.ready && brokenMark.mark === null && brokenMark.global === null,
          `ready=${String(broken.ready)} 标记=${JSON.stringify(brokenMark.mark)} 全局=${JSON.stringify(brokenMark.global)}`,
        )
        const failures = bootFailures(broken.capture)
        check.fact(
          `③ 负向对照：整包 HTTP ${String(rejected.status)}、页面就绪=${String(broken.ready)}、标记属性=${JSON.stringify(brokenMark.mark)}、` +
            `装载未激活 ${String(failures.length)} 行（首行：${JSON.stringify((failures[0] ?? '').slice(0, 120))}）`,
        )
        check.ok(
          '③ 负向对照：控制台里是官方报出来的那句失败（启动审计那一句，或 0.1.5 线的 loader entry 那一句），与用户现场同形',
          failures.some((line) => line.includes(AUDIT_LINE) || line.includes(LEGACY_ENTRY_FAIL)) &&
            failures.some((line) => line.includes(THIRD_PARTY_PLUGIN_ID)),
          `命中 ${String(failures.length)} 行；例如 ${JSON.stringify((failures[0] ?? '').slice(0, 200))}`,
        )
        check.fact(`③ 负向对照的审计原文：${failures.slice(0, 3).join(' / ').slice(0, 400)}`)
        shots.push(await shot(ctx, broken.page, 'f-69-2-negative-control-legacy-classification'))
      } finally {
        await broken.context.close()
      }
      check.fact(
        `镜像日志（缺省口径）${String(fixedLog.length)} 行、含「整份拒绝」${String(fixedLog.filter((line) => line.includes(REJECT_LOG)).length)} 行；` +
          `（改前那套分类）${String(legacyLog.length)} 行、含「整份拒绝」${String(legacyLog.filter((line) => line.includes(REJECT_LOG)).length)} 行`,
      )
      check.fact(`实例启动输出（前 3 行）：${gatewayLines.join(' ').slice(0, 300)}`)
    } finally {
      legacy?.dispose()
      fixed?.dispose()
      await gateway.dispose()
    }
    return shots
  },
}
