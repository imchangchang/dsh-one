/**
 * combo 的缓存键带上本地产物的内容版本（#173，COMBO-CACHE-KEY 套件）。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与 `sidebarHScrollSuites.ts` /
 * `topbarRightInsetSuites.ts` 同一条：那个文件是本批开发的合入热点，新套件放外面能少一半
 * 冲突面。注册方式是在 `suites.ts` 的 `SUITES` 末尾追加一项。
 *
 * ## 这一条抓的是什么
 *
 * 用户实测（#173）：改完侧栏样式、`npm run build` 重建 `dist/assembly/plugins/<id>/client.js`
 * 之后，reload 窗口看到的还是旧界面。根因不在样式值，而在**缓存键**：整包 URL 是
 * `/plugins-local/??<ids>&rev=<rev>`（镜像按 URL 原样回 24h `immutable`），而那个 rev 只
 * 取了**网关** application 批的版本（`appBatches[0].rev`）——本地那份产物改了，URL 与
 * 镜像的 ETag 都一字不变，webview 连条件请求都不发，吃满 24 小时的缓存。
 *
 * 修法：rev 拼上本地产物目录的内容版本（`localBundleRev`）。本套件在浏览器里把用户那
 * 一步走完整遍——**改本地产物的字节 → 重新打开页面 → 新的东西真的生效**——而不是只核
 * URL 字符串。为了不碰仓库里真正那份产物（别的套件与 `npm run build` 要用），临时目录里
 * 放一份拷贝当 pluginsDir，再拿**同一台网关**（只读）起一个姊妹实验室服务器：
 *
 * 1. **起点**：页面拿到的 combo rev = `<官方 application 批的 rev>-<现算的本地内容版本>`；
 *    这一份产物里没有下面那段探针代码，所以**探针此刻不当场**（= 页面跑的是改前的字节）。
 * 2. **镜像仍长缓存**：同一个 URL 取回来仍是 `max-age=86400, immutable`（#71 的初衷没被
 *    砍），ETag 里含那个 rev（缓存键跟着 URL 走），响应正文既有保留的官方段、也有本地段。
 * 3. **改本地产物 → 重载页面**（等价于用户「改一行 CSS → build → reload 窗口」）：新的
 *    combo URL 与旧的**不同**（本地那一半变了），而且新产物**真的执行了**（页面上出现探针
 *    ——这一步就是「reload 就能看到新样式」的可执行版本；没有 #173 那个修法时，重载会命中
 *    同一 URL 的 immutable 缓存、探针不会出现，本套件当场红）。
 * 4. **负向对照**：同一份产物再重载一次，rev 一字不变（键是内容派生的，不是每次都换），
 *    官方那一半（rev 的前缀）两次也一致——官方那半的长缓存没有被牵动。
 *
 * 只读边界：真网关**只读**（起的姊妹服务器对它做的也只有换票与 GET），不点会话行、不写
 * 任何状态；临时目录与姊妹服务器跑完自己收掉（按端口/对象回收，不用 `pkill`）。
 */
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { openTreePage, type OpenedPage } from './harness.ts'
import { consoleLogger, LAB_TREES, startLabServer, type LabServer, type LabTreeRoute } from './labServer.ts'
import { localBundleRev } from '../../src/server/localBundleRev.ts'
import { scratchDir } from '../scratchDirs.ts'
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

/** 侧栏树（本套件只开这一棵：它的自有 frame 插件就是我们要改的那份产物）。 */
const SIDEBAR_TREE = route('sidebar')
/** 被改的那份本地 bundle（侧栏树的 frame 插件，mirror 从 pluginsDir 读它）。 */
const MUTATED_ID = SIDEBAR_TREE.tree.framePluginId
/**
 * 追加进 bundle 的探针：它跑在整包的**顶层**（段末尾），所以只要浏览器真的执行了这份新
 * 产物，页面上就看得见它——比「URL 变了」更硬的那一跳（URL 变了但内容还是旧的也能过前者）。
 */
const PROBE_KEY = '__DSH_ONE_COMBO_PROBE_173'
const PROBE_CODE = `\ntry { globalThis.${PROBE_KEY} = 'v2' } catch (error) {}\n`

interface ComboReading {
  /** 整包请求的 URL（页面自己发出的那一条）。 */
  url: string
  /** 该 URL 上的 `rev`（= 缓存键）。 */
  rev: string
  /** 页面里那个探针的值（没执行过就是 null）。 */
  probe: string | null
}

/** 页面发过的 combo 请求里最长的那一条（application 整包，id 列表最全）+ 探针读数。 */
async function readCombo(page: OpenedPage['page']): Promise<ComboReading> {
  return page.evaluate((key: string) => {
    const urls = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => name.includes('/plugins-local/'))
    const longest = urls.reduce((best, candidate) => (candidate.length > best.length ? candidate : best), '')
    const probe = (globalThis as unknown as Record<string, unknown>)[key]
    return { url: longest, rev: new URL(longest).searchParams.get('rev') ?? '', probe: typeof probe === 'string' ? probe : null }
  }, PROBE_KEY)
}

/**
 * 从**进程侧**取一次那个 URL（不走浏览器：`ETag` 不是 CORS 白名单里的响应头，页面里
 * `fetch` 读不到它；进程侧读到的才是镜像原样回的头部）。
 */
async function fetchCombo(url: string): Promise<{ cacheControl: string | null; etag: string | null; body: string }> {
  const res = await fetch(url)
  return {
    cacheControl: res.headers.get('cache-control'),
    etag: res.headers.get('etag'),
    body: await res.text(),
  }
}

export const COMBO_CACHE_KEY_SUITE: LabSuite = {
  id: 'F-57',
  phase: 'new-feature',
  name: 'combo 的缓存键带上本地产物的内容版本：改了自己的 bundle、重新打开页面就生效（#173，COMBO-CACHE-KEY 套件）',
  expect:
    '临时目录里放一份**自有插件产物的拷贝**当 pluginsDir（不碰仓库里真正那份），拿同一台真网关（**只读**）起一个姊妹实验室服务器，然后开侧栏树页面走完用户那一步：① **起点的缓存键** = 页面发出的 combo 请求 rev 恰好是 `<当天网关 application 批的 rev>-<现算的 pluginsDir 内容版本>`（两半都由套件自己算：官方那半取 `lab.gatewayWire()`，本地那半取 `localBundleRev`），且这一份产物里还没有下面那段探针代码（探针此刻不当场 = 页面跑的确实是改前的字节）；② **镜像仍回长缓存**——把同一个 URL 取回来，`cache-control` 仍是 `max-age=86400, immutable`（#71 的初衷没被顺手砍），ETag 里含那个 rev（缓存键与 URL 同源），正文里既有保留的官方段、也有本地产物那一段；③ **改本地产物 → 重载页面**（= 用户「改一行 CSS → `npm run build` → reload 窗口」）：新的 combo URL 与旧的不同（本地那一半变了）、URL 前缀（官方那一半）不变，且**新产物真的执行了**（页面上出现那段探针 = 「reload 立刻看到新样式」的可执行版本；没有 #173 的修法时这一步会命中同一 URL 的 immutable 缓存，探针不出现，本套件当场红）；④ **负向对照**：同一份产物再重载一次，rev 一字不变——键是内容派生的，不是每次换个新值（否则 #71 的长缓存等于白设）。全程零 pageerror、真网关只读。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const pluginsDir = await scratchDir('dsh-one-lab-plugins-')
    let sibling: LabServer | undefined
    check.fact(`产物拷贝：${pluginsDir}（源 = ${ctx.lab.pluginsDir}；改的是这一份，仓库里那份一个字节没动）`)
    check.ok(
      `前提：产物目录里有 ${MUTATED_ID}/client.js（\`npm run verify:lab\` 会先 build）`,
      (await fsp.readdir(path.join(ctx.lab.pluginsDir, MUTATED_ID)).catch(() => null)) !== null,
      path.join(ctx.lab.pluginsDir, MUTATED_ID),
    )
    try {
      await fsp.cp(ctx.lab.pluginsDir, pluginsDir, { recursive: true })
      sibling = await startLabServer({
        gateway: ctx.lab.gateway,
        token: ctx.lab.token,
        log: consoleLogger(true),
        pluginsDir,
        // 随机端口：姊妹服务器不跟别的实验室抢端口。
        port: 0,
        // 姊妹服务器连的是同一台网关，跑法（外部实例 / 自起隔离实例）与母服务器一致。
        external: ctx.lab.external,
        ...(ctx.lab.dshVersion === undefined ? {} : { version: ctx.lab.dshVersion }),
      })
      const appRev = (await ctx.lab.gatewayWire()).batches.filter((batch) => batch.phase === 'application')[0].rev
      check.fact(`当天网关 ${ctx.lab.gateway} 的 application 批 rev=${appRev}；姊妹实验室 ${sibling.origin}`)

      const opened = await openTreePage(ctx.browser, sibling, SIDEBAR_TREE, { width: 380, height: 900 })
      const { page, capture } = opened
      try {
        // ---- ① 起点的缓存键：官方那半 + 本地那半 ----
        const before = await readCombo(page)
        const localRevBefore = await localBundleRev(pluginsDir)
        check.fact(`起点 combo rev=${before.rev}（现算的本地内容版本=${localRevBefore}）`)
        check.eq('① 页面发出的 combo rev = 官方那半 + 本地产物的内容版本', before.rev, `${appRev}-${localRevBefore}`)
        check.eq('① 这一份产物里还没有探针（跑的是改前的字节）', before.probe, null)

        // ---- ② 镜像仍回长缓存，ETag 与 URL 同一个键 ----
        const served = await fetchCombo(before.url)
        check.eq('② combo 响应仍是 immutable 长缓存（#71 没被砍）', served.cacheControl, 'max-age=86400, immutable')
        check.ok('② ETag 里含那个 rev（缓存键跟着 URL 走）', served.etag?.includes(before.rev) === true, served.etag)
        check.ok(
          `② 正文里本地那一段在（${MUTATED_ID}）`,
          served.body.includes(MUTATED_ID),
          `正文 ${String(served.body.length)} 字节`,
        )
        check.ok(
          '② 正文里官方保留段也在（整包是「官方剥段 + 本地拼尾」）',
          served.body.includes('__ModuleLoader__.load('),
          `正文 ${String(served.body.length)} 字节`,
        )

        // ---- ③ 改一个字节（= 改源码重建）→ 重载页面 → 新的真的生效 ----
        await fsp.appendFile(path.join(pluginsDir, MUTATED_ID, 'client.js'), PROBE_CODE)
        const localRevAfter = await localBundleRev(pluginsDir)
        check.ok('③ 改一个字节，本地产物的内容版本就变', localRevAfter !== localRevBefore, `${localRevBefore} → ${localRevAfter}`)
        await page.reload({ waitUntil: 'domcontentloaded' })
        await page.waitForSelector(SIDEBAR_TREE.readySelector, { timeout: 40_000 })
        await page.waitForTimeout(2_000)
        const after = await readCombo(page)
        check.fact(`重建后 combo rev=${after.rev}`)
        check.ok('③ 重载后页面拿到的是新 URL（缓存键变了）', after.url !== before.url, `旧 ${before.url}\n新 ${after.url}`)
        check.eq('③ 新的 rev = 官方那半（没变）+ 新的本地内容版本', after.rev, `${appRev}-${localRevAfter}`)
        check.ok(
          '③ 官方那一半没被牵动（前缀一致：官方没发新版，官方那半的长缓存照旧）',
          before.rev.startsWith(`${appRev}-`) && after.rev.startsWith(`${appRev}-`),
          `${before.rev} / ${after.rev}`,
        )
        check.eq('③ 新产物真的执行了（= reload 立刻看到新东西，用户现场那一步的可执行版本）', after.probe, 'v2')

        // ---- ④ 负向对照：内容没变时键也不许变 ----
        await page.reload({ waitUntil: 'domcontentloaded' })
        await page.waitForSelector(SIDEBAR_TREE.readySelector, { timeout: 40_000 })
        await page.waitForTimeout(1_500)
        const third = await readCombo(page)
        check.eq('④ 同一份产物再重载一次，rev 一字不变（键是内容派生的，不是每次换个新值）', third.rev, after.rev)
        check.eq('④ 探针照旧在（这一份产物一直在跑）', third.probe, 'v2')

        screenshots.push(await shot(ctx, page, 'combo-cache-key-sidebar'))
        const gaps = capture.consoleErrors.filter((line) => /did not activate|waiting for service|slot entry crashed/.test(line))
        check.eq('全程零装载未激活 / 零槽位崩溃（换了缓存键之后装配照旧）', gaps, [])
        check.eq('全程零 pageerror', capture.pageErrors, [])
      } finally {
        await opened.context.close()
      }
    } finally {
      sibling?.dispose()
      await fsp.rm(pluginsDir, { recursive: true, force: true })
    }
    return screenshots
  },
}
