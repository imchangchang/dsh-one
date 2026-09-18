/**
 * 对话区断线提示套件（#202）。
 *
 * 验的是什么：**整段重启窗口里对话区页面上必须有一行可见的事实**——官方那枚提示
 * （`ConnectionIndicator`，「连接中断，正在重试，点击立即重连」那一条）在我们这棵
 * 树上**永不渲染**（它唯一的承载件是 `ui-settings-general` 的 `SettingsRoot`，而那
 * 是 `sidebar.settings` 槽位上的贡献；chat 树没有官方侧栏壳、那个槽位没人声明），
 * 所以这一行由 chat 树自己的 frame 插件出（见 chatLayoutPlugin.ts 的 ConnectionHint）。
 *
 * 为什么必须自起两台实例：断开方式是**同端口同 `DSH_HOME` 重启实例**（#202 定的
 * 口径）——同一份 `DSH_HOME` 才保得住 cookie 的签名密钥（`$DSH_HOME/.credentials.yaml`），
 * 同一个端口才让已经开着的那个页面重连得回来。所以本套件走 `freshGateway.ts` 起一台
 * 临时实例，观测完按 PID 收掉、换同一个端口同一份 HOME 再起一台收尾（用户日常那台
 * 3080 全程只被别的套件只读探测，这里一次都不碰）。
 *
 * 「改前零行」怎么钉在这份套件里：改前（没有任何提示行）与改后（断线那一刻一行）
 * 的差别是**行为**差别，套件跑的是改后那份代码，钉不出「改前」那一读数；但同一份
 * 读数在本套件里换了个角度钉死——断线**前**页面上零行（改前是全程零行，所以那一读数
 * 与改前等价），且**官方那枚提示在这棵树上根本不具备渲染条件**（`settings.trigger`
 * 等槽位锚点零枚 ⇒ 官方 SettingsRoot 挂不上 ⇒ 官方提示永不出现）。改前/改后的整轮
 * 实测读数写在 #202 的汇报里。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { contractGaps, openTreePage, type OpenedPage } from './harness.ts'
import { fakeHostScript } from './fakeHost.ts'
import { consoleLogger, defaultPluginsDir, LAB_TREES, startLabServer, type LabTreeRoute } from './labServer.ts'
import { startFreshGateway } from './freshGateway.ts'
import { SHELL_LOCALE } from '../../src/ui/assembly/shell/shellLocale.ts'
// 只取类型（编译后不留 import，运行期没有环）：套件接口定义在 suites.ts 里。
import type { LabSuite } from './suites.ts'

const route = (name: string): LabTreeRoute => {
  const found = LAB_TREES.find((candidate) => candidate.route === name)
  if (found === undefined) throw new Error(`lab: unknown tree route ${name}`)
  return found
}

/** 提示行的自有标记（官方那枚用的是 css-module 哈希类名，认不得，也不该认）。 */
const HINT = '[data-dshone-connection-hint]'

/** 官方 `ui-settings-general`（#202 放行的那件）的 id。 */
const SETTINGS_GENERAL = '@deepseek-ai/dsh-client-ui-settings-general'

/**
 * `ui-settings-general` 注册的那些槽位：chat 树**一个都没声明**，所以放行它之后
 * 这些锚点必须是零枚（挂不上 ≠ 渲染了空的），这就是「放行没把设置页面的东西带进来」
 * 的判据。槽位名逐个取自官方 `dsh-client-ui-settings-general/lib/client.js` 的
 * `apply`：`sidebar.settings` 是它自己注册的外层槽位，其余六处是它的 children。
 */
const SETTINGS_SEATS = [
  'sidebar.settings',
  'settings.trigger',
  'settings.header',
  'settings.action',
  'settings.close',
  'settings.section',
  'settings.onboarding',
] as const

/** 页面上这些槽位各有几枚锚点 + 提示行几枚（一次 evaluate 取全）。 */
async function seatAnchorCounts(page: OpenedPage['page']): Promise<Record<string, number>> {
  return page.evaluate(
    ({ seats, hint }) => {
      const out: Record<string, number> = {}
      for (const name of seats) out[name] = document.querySelectorAll(`[data-slot="${name}"]`).length
      out[hint] = document.querySelectorAll(hint).length
      return out
    },
    { seats: [...SETTINGS_SEATS], hint: HINT },
  )
}

/** 这一页请求过的 `/plugins-local/` combo（插件真的进了装配清单的证据）。 */
async function combosRequested(page: OpenedPage['page']): Promise<string[]> {
  return page.evaluate(() =>
    (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
      .map((entry) => entry.name)
      .filter((name) => name.includes('/plugins-local/')),
  )
}

/** 提示行此刻的读数：枚数、可见性、文案、是否带 `role=status`。 */
async function hintFacts(
  page: OpenedPage['page'],
): Promise<{ count: number; visible: boolean; text: string; status: boolean; height: number }> {
  return page.evaluate((hint) => {
    const nodes = Array.from(document.querySelectorAll(hint))
    const first = nodes[0] as HTMLElement | undefined
    const box = first?.getBoundingClientRect()
    return {
      count: nodes.length,
      visible: first === undefined ? false : first.checkVisibility?.() ?? true,
      text: first?.textContent ?? '',
      status: first?.getAttribute('role') === 'status',
      height: box?.height ?? 0,
    }
  }, HINT)
}

/** 等提示行出现 / 消失；返回等到的读数（超时返回最后一读，由调用方断言）。 */
async function waitForHintCount(page: OpenedPage['page'], want: 'present' | 'gone', timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const count = (await hintFacts(page)).count
    if ((want === 'present' && count > 0) || (want === 'gone' && count === 0)) return count
    if (Date.now() > deadline) return count
    await page.waitForTimeout(200)
  }
}

export const RECONNECT_HINT_SUITE: LabSuite = {
  id: 'F-61',
  phase: 'new-feature',
  name: '对话区断线提示：同端口同 DSH_HOME 重启实例期间页面上有一行可见的事实（#202）',
  expect:
    '实验室自己起一台**全新 `DSH_HOME`** 的 dsh 网关（`--port 0` 随机端口、`--no-open`、临时目录当 HOME，收尾按 PID 收掉并删目录——不碰用户的 3080，也不写 `~/.dsh/dsh-owned.json`），在 chat 树上依次断言：① **断线前零行**——`[data-dshone-connection-hint]` 零枚（这就是改前那种「全程零行」的读数在改后代码上的对应位置），且官方 `ui-settings-general` 注册的七处槽位锚点（`sidebar.settings` / `settings.*`）**全部零枚**：该件确实进了本页的 combo（放行生效），但 chat 树一处槽位都没声明，官方那枚提示（`ConnectionIndicator`，唯一承载件是它的 `SettingsRoot`）在这棵树上挂不上——这正是「我们自己出一行」的理由（判据 1 的常驻断言）；② **同端口同 `DSH_HOME` 重启实例**（先按 PID 收掉、`stop()` 保留 HOME 与端口，再起第二台），断线那一刻页面上**恰好一行**可见事实：`role=status`、带自有标记、盒高 > 0、文案逐字等于插件词典里那条（zh / en 任一份，期望值从 `shellLocale.ts` 读，不写死中文）；③ 第二台起来后那一行**自己消失**（回到零枚）；③′ 另一条分支：浏览器报离线（`context.setOffline`，官方恢复循环就是听 `offline` 事件的那一条路径）时那一行也在，文案换成词典里的「连接已断开」那条，网络恢复后同样自己消失；③″ **首屏从来就没连上过**那一档不显示（另开一个上下文把通往网关的 WebSocket 拦下来不接给服务端，事件流永远不 ready ⇒ 状态源从未 `connected`），挡住「每次打开面板都闪一行」那类误报；④ 整段过程零 `slot entry crashed` / 零装载未激活 / 零 pageerror。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const tree = route('chat')
    const first = await startFreshGateway()
    const port = Number(new URL(first.origin).port)
    check.fact(`第一台实例：DSH_HOME=${first.home} ${first.origin} pid=${String(first.pid)} 版本=${first.version ?? '（读不到）'}`)
    let opened: OpenedPage | undefined
    let second: Awaited<ReturnType<typeof startFreshGateway>> | undefined
    let lab: Awaited<ReturnType<typeof startLabServer>> | undefined
    try {
      lab = await startLabServer({
        gateway: first.origin,
        token: first.token,
        log: consoleLogger(true),
        pluginsDir: defaultPluginsDir(),
        port: 0,
        ...(first.version === undefined ? {} : { version: first.version }),
      })
      opened = await openTreePage(ctx.browser, lab, tree, { width: 1400, height: 900, readyTimeoutMs: 30_000, settleMs: 1_000 })
      const { page, capture } = opened
      check.ok(`chat：首屏就绪（${tree.readySelector}）`, opened.ready, `就绪点没出现：${tree.readySelector}`)

      // ① 断线前：零行 + 官方那件进了 combo 却零槽位锚点。
      const before = await seatAnchorCounts(page)
      const comboBefore = (await combosRequested(page)).join('\n')
      check.fact(`断线前读数：提示行=${String(before[HINT])} 槽位锚点=${SETTINGS_SEATS.map((name) => `${name}=${String(before[name])}`).join(' ')}`)
      check.ok(
        `chat：放行 ui-settings-general 之后它真的进了本页 combo（放行生效，不是没装载）`,
        comboBefore.includes(`${SETTINGS_GENERAL}/client.js`),
        '/plugins-local 请求里没有它的 client.js',
      )
      const declaredSeats = SETTINGS_SEATS.filter((name) => (before[name] ?? 0) > 0)
      check.eq(
        'chat：官方设置件注册的七处槽位在这棵树上零声明（官方断线提示因此永不渲染，这一行只能我们自己出）',
        declaredSeats,
        [],
      )
      check.eq('chat：断线前页面上零行连接提示（改前是全程零行）', before[HINT], 0)
      screenshots.push(await shotTo(ctx.shots, page, 'reconnect-hint-connected'))

      // ② 同端口同 DSH_HOME 重启实例：先收进程（保留 HOME 与端口）。
      const killedAt = Date.now()
      await first.stop()
      check.fact(`已按 PID 收掉第一台实例（pid=${String(first.pid)}），端口 ${String(port)} 与 DSH_HOME 保留`)
      const seen = await waitForHintCount(page, 'present', 15_000)
      const facts = await hintFacts(page)
      check.fact(`断线后 ${String(Date.now() - killedAt)}ms 内读数：提示行=${String(seen)} 文案=${JSON.stringify(facts.text)}`)
      check.eq('chat：断线那一刻页面上恰好一行可见的事实', facts.count, 1)
      check.ok('chat：那一行真的渲染出来（盒高 > 0，不是零高隐藏件）', facts.height > 0 && facts.visible, `height=${String(facts.height)} visible=${String(facts.visible)}`)
      check.ok('chat：那一行带 role=status（读屏走 live region）', facts.status)
      const allowed = [SHELL_LOCALE.zh.connectionLost, SHELL_LOCALE.en.connectionLost]
      check.ok(
        'chat：那一行的文案逐字等于插件词典里那条（zh / en 任一份）',
        allowed.includes(facts.text),
        `actual=${JSON.stringify(facts.text)} expected=${JSON.stringify(allowed)}`,
      )
      screenshots.push(await shotTo(ctx.shots, page, 'reconnect-hint-disconnected'))

      // ③ 同一个端口、同一份 DSH_HOME 再起一台：那一行该自己消失。
      second = await startFreshGateway({ home: first.home, port })
      check.fact(`第二台实例：${second.origin} pid=${String(second.pid)}（与第一台同端口 ${String(port)} 同 HOME）`)
      const gone = await waitForHintCount(page, 'gone', 60_000)
      check.eq('chat：重连成功后那一行自己消失（回到零枚）', gone, 0)
      screenshots.push(await shotTo(ctx.shots, page, 'reconnect-hint-recovered'))

      // ③′ 另一条分支：浏览器报离线（`ConnectionState` 的 `disconnected`）。
      // 官方恢复循环只在浏览器报离线时停掉自动重试，所以这一档只能这么造——
      // `context.setOffline` 正是 Chromium 上 navigator.onLine / offline 事件的
      // 真实来源（官方 dsh-client-connection 的 client 半就是听这两个事件）。
      await opened.context.setOffline(true)
      const offlineSeen = await waitForHintCount(page, 'present', 20_000)
      const offlineFacts = await hintFacts(page)
      check.fact(`报离线后读数：提示行=${String(offlineSeen)} 文案=${JSON.stringify(offlineFacts.text)}`)
      check.eq('chat：浏览器报离线时页面上仍然有一行（不是只在连得上网时才给提示）', offlineFacts.count, 1)
      check.ok(
        'chat：离线那一行的文案逐字等于词典里的「连接已断开」那条（zh / en 任一份）',
        [SHELL_LOCALE.zh.connectionOffline, SHELL_LOCALE.en.connectionOffline].includes(offlineFacts.text),
        `actual=${JSON.stringify(offlineFacts.text)}`,
      )
      await opened.context.setOffline(false)
      const backOnline = await waitForHintCount(page, 'gone', 60_000)
      check.eq('chat：网络恢复后那一行也自己消失', backOnline, 0)

      // ③″ 首屏「从来就没连上过」这一档：不显示。挡住的是「每次打开面板都闪一行
      // 连接中断」那类误报——提示只该讲「刚才断过」，不该讲「还没连上」。
      // 造法：另开一个上下文，把通往网关的 WebSocket 拦下来**不接给服务端**
      // （Playwright 的语义：handler 里不调 `connectToServer()` 就是纯 mock，
      // 页面那头连得上、服务端一个字节都收不到）——官方 connection 的 generation
      // 因此永远不 ready，状态源停在「还没有结果」/「正在重连」而从未 `connected`。
      const blockedContext = await ctx.browser.newContext({ viewport: { width: 1400, height: 900 } })
      try {
        await blockedContext.addInitScript({ content: fakeHostScript() })
        await blockedContext.routeWebSocket('**/api/**', () => {
          /* 不 connectToServer：这条流永远不 ready */
        })
        const blockedPage = await blockedContext.newPage()
        await blockedPage.goto(`${lab.origin}/${tree.route}`, { waitUntil: 'domcontentloaded' })
        let blockedReady = true
        try {
          await blockedPage.waitForSelector(tree.readySelector, { timeout: 30_000 })
        } catch {
          blockedReady = false
        }
        await blockedPage.waitForTimeout(2_000)
        const cold = await hintFacts(blockedPage)
        check.fact(`从未连上过那一页：就绪=${String(blockedReady)} 提示行=${String(cold.count)} 文案=${JSON.stringify(cold.text)}`)
        check.ok('chat：拦掉事件流的那一页本身是渲染出来了的（否则这条读数没有意义）', blockedReady, `就绪点没出现：${tree.readySelector}`)
        check.eq('chat：首屏从未连上过时不显示提示（只有「曾经连上过、现在断了」才显示）', cold.count, 0)
      } finally {
        await blockedContext.close()
      }

      // ④ 崩溃/未激活与 pageerror：整段下来都不许有。
      const gaps = contractGaps(capture)
      check.eq('chat：整段过程零槽位崩溃日志（slot entry crashed）', gaps.crashes, [])
      check.eq('chat：整段过程零装载未激活（缺服务/缺钩子）', gaps.bootFails, [])
      check.fact(`整段过程已知噪音 ${String(gaps.noise.length)} 条`)
      check.eq('chat：整段过程零 pageerror（已知噪音另计）', gaps.pageErrors, [])
    } finally {
      await opened?.context.close()
      lab?.dispose()
      await second?.dispose()
      await first.dispose()
      const homeGone = await fsp.stat(first.home).then(() => false, () => true)
      check.fact(`收尾：临时 DSH_HOME 已删除=${String(homeGone)} 实例进程已按 PID 收掉`)
    }
    return screenshots
  },
}

/** 一张截图（各套件自己的小工具，见 suites.ts 的同名函数）。 */
async function shotTo(shots: string, page: OpenedPage['page'], name: string): Promise<string> {
  const file = path.join(shots, `${name}.png`)
  await fsp.mkdir(shots, { recursive: true })
  await page.screenshot({ path: file })
  return file
}
