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
 *
 * #230 起这份套件还多担一件事：**同端口重启这条现场是「名册版本对齐」的天然试验田**
 * ——网关一重启，条目与批的 `rev`（0.1.6-alpha.2 起是每进程随机值）全变，而官方客户端
 * 是按 `rev` 判「这一条变了没有」的：不对齐就会把每一条先拆后建、会话 scope 的对接件被
 * 撤销、官方渲染器抛 `SlotAssemblyError`（`scope 'session-maybe' rendered without an
 * installed adapter`）→ 官方 `SlotErrorBoundary` 故意不兜装配错 → React root 卸载 →
 * 整页白。所以本套件除了「断线那一刻有一行」，还断言**重启之后推来的那帧名册逐条 `rev`
 * 仍是本页 boot 那份的值**（帧由页内初始化脚本 `eventsRecorderScript` 记下来），并把
 * 「网关重启 + VS Code 交回重启前那份 HTML」（`?pageWire=pinned`，生产里 webview 重载
 * 那条路）的读数如实记进报告（第 ⑤ 段，只记事实不判断言）。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { capturePage, contractGaps, openTreePage, openTreePageAlongside, type OpenedPage } from './harness.ts'
import { fakeHostScript } from './fakeHost.ts'
import {
  consoleLogger,
  defaultPluginsDir,
  LAB_TREES,
  PAGE_WIRE_PINNED,
  PAGE_WIRE_QUERY,
  startLabServer,
  type LabTreeRoute,
} from './labServer.ts'
import { startFreshGateway } from './freshGateway.ts'
import { bootstrapUrlOf, extractBootWire } from '../../src/ui/assembly/wireFilter.ts'
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

/**
 * 页内簿记（#230）：把官方那条 roster 事件流**真的收到**的帧记下来（流 URL + 每帧原文）。
 *
 * 为什么要它：本套件的核心新读数不是「页面没崩」（那是后果），而是**推来的名册与这一页
 * boot 的那份逐条同 rev**（那是机制本身）。页内数得准，套件侧从网络事件数不出帧内容。
 *
 * 装在最前面（`OpenOptions.initScript`，页面任何脚本之前）：我们自己的传输层也在页面里包
 * 一层 `EventSource`（改道 + 带基线，见 `pageHtml.ts` 的 `transportJs`），它读的是
 * `globalThis.EventSource`——这里先包一层，两条包装串成一条链，两边都不改对方，记到的
 * `args[0]` 就是**真的发出去的那条 URL**（含基线参数）。
 */
function eventsRecorderScript(): string {
  return `(() => {
  const Native = globalThis.EventSource
  if (typeof Native !== "function") return
  globalThis.__F61_STREAMS__ = []
  globalThis.EventSource = new Proxy(Native, {
    construct(target, args, newTarget) {
      const instance = Reflect.construct(target, args, newTarget)
      const record = { url: String(args[0]), frames: [] }
      globalThis.__F61_STREAMS__.push(record)
      try { instance.addEventListener("message", (event) => { record.frames.push(String(event.data)) }) } catch (ignored) {}
      return instance
    },
  })
})()`
}

/** 一条记下来的事件流：URL + 每帧 graph 名册的 `[id, rev]` 对（非 graph 帧不记）。 */
interface RecordedStream {
  url: string
  graphs: ReadonlyArray<ReadonlyArray<readonly [string, string]>>
}

/** 读页内记下来的事件流（只留住 `/plugins-local/events` 这一条，别的 EventSource 不掺进来）。 */
async function recordedStreams(page: OpenedPage['page']): Promise<RecordedStream[]> {
  return page.evaluate(() => {
    const streams = (globalThis as { __F61_STREAMS__?: { url: string; frames: string[] }[] }).__F61_STREAMS__ ?? []
    const out: { url: string; graphs: [string, string][][] }[] = []
    for (const stream of streams) {
      if (!stream.url.includes("/plugins-local/events")) continue
      const graphs: [string, string][][] = []
      for (const frame of stream.frames) {
        try {
          const parsed = JSON.parse(frame) as { type?: string; graph?: { entries?: { id?: string; rev?: string }[] } }
          if (parsed.type !== "graph" || !Array.isArray(parsed.graph?.entries)) continue
          graphs.push(
            parsed.graph.entries
              .filter((entry) => typeof entry.id === "string" && typeof entry.rev === "string")
              .map((entry) => [entry.id as string, entry.rev as string]),
          )
        } catch (ignored) {}
      }
      out.push({ url: stream.url, graphs })
    }
    return out
  })
}

/** 这一页 boot 那一刻那份清单的 `[id, rev]` 对（`__DSH_BOOT__` 就是页面装配时读的那一份）。 */
async function bootRoster(page: OpenedPage['page']): Promise<Array<readonly [string, string]>> {
  return page.evaluate(() => {
    const wire = (globalThis as { __DSH_BOOT__?: { entries?: { id?: string; rev?: string }[] } }).__DSH_BOOT__
    const entries = wire?.entries ?? []
    return entries
      .filter((entry) => typeof entry.id === "string" && typeof entry.rev === "string")
      .map((entry) => [entry.id as string, entry.rev as string] as [string, string])
  })
}

/**
 * 两份名册的对照读数：共有多少条、各自多出/缺了谁、哪些条目的 rev 不同。
 *
 * 分开数（而不是把两份清单整个丢进断言）是因为失败信息要读得懂：`rev` 不同的条数正是
 * 「客户端会拆掉重建多少条」这个量，也是改前/改后差别所在。
 */
function compareRosters(
  boot: ReadonlyArray<readonly [string, string]>,
  framed: ReadonlyArray<readonly [string, string]>,
): { bootCount: number; framedCount: number; revDiffers: string[]; missing: string[]; extra: string[] } {
  const bootMap = new Map(boot)
  const framedMap = new Map(framed)
  const revDiffers: string[] = []
  for (const [id, rev] of bootMap) {
    const other = framedMap.get(id)
    if (other === undefined) continue
    if (other !== rev) revDiffers.push(id)
  }
  return {
    bootCount: bootMap.size,
    framedCount: framedMap.size,
    revDiffers,
    missing: [...bootMap.keys()].filter((id) => !framedMap.has(id)),
    extra: [...framedMap.keys()].filter((id) => !bootMap.has(id)),
  }
}

/** 记下来的这些流一共收到多少帧 graph（官方 `dsh-client-hmr` 只建一条流、断线靠 EventSource 自己重连）。 */
function graphFrameCount(streams: readonly RecordedStream[]): number {
  return streams.reduce((sum, stream) => sum + stream.graphs.length, 0)
}

/** 等记到的 graph 帧数达到 `want`（等不到返回最后一读，由调用方断言）。 */
async function waitForGraphFrames(page: OpenedPage['page'], want: number, timeoutMs: number): Promise<RecordedStream[]> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const streams = await recordedStreams(page)
    if (graphFrameCount(streams) >= want || Date.now() > deadline) return streams
    await page.waitForTimeout(200)
  }
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
    '实验室自己起一台**全新 `DSH_HOME`** 的 dsh 网关（`--port 0` 随机端口、`--no-open`、临时目录当 HOME，收尾按 PID 收掉并删目录——不碰用户的 3080，也不写 `~/.dsh/dsh-owned.json`），在 chat 树上依次断言：① **断线前零行**——`[data-dshone-connection-hint]` 零枚（这就是改前那种「全程零行」的读数在改后代码上的对应位置），且官方 `ui-settings-general` 注册的七处槽位锚点（`sidebar.settings` / `settings.*`）**全部零枚**：该件确实进了本页的 combo（放行生效），但 chat 树一处槽位都没声明，官方那枚提示（`ConnectionIndicator`，唯一承载件是它的 `SettingsRoot`）在这棵树上挂不上——这正是「我们自己出一行」的理由（判据 1 的常驻断言）；①′ **机制对照（#230）**：这一页开着的时候那条 roster 事件流收到的第一帧名册，逐条 `rev` 与本页 `__DSH_BOOT__` 相同（同一进程内本来就该相同——它是下面那条对齐读数的对照基准；帧由页内初始化脚本记下来）；② **同端口同 `DSH_HOME` 重启实例**（先按 PID 收掉、`stop()` 保留 HOME 与端口，再起第二台），断线那一刻页面上**恰好一行**可见事实：`role=status`、带自有标记、盒高 > 0、文案逐字等于插件词典里那条（zh / en 任一份，期望值从 `shellLocale.ts` 读，不写死中文）；③ 第二台起来后那一行**自己消失**（回到零枚）；**③″′ 名册版本对齐（#230）**：重启之后那条事件流会再推一帧名册（官方 `dsh-client-hmr` 只建一条 `EventSource`、断线靠它自己重连，所以按**帧数**认这一帧），而镜像推给页面的这一帧里每条的 `rev` 仍是**本页 boot 那份清单**里的值（id 集合与 rev 逐条相同）——`rev` 是每进程随机值，不对齐就会被客户端读成「整份名册都变了」（每条先拆后建 → 会话 scope 的对接件被撤销 → 官方渲染器抛装配错 → 整页白），且页面带上去了正确的对齐基线（`revs` 查询参数 = 本页 boot 清单的 `id:rev` 对）；③′ 另一条分支：浏览器报离线（`context.setOffline`，官方恢复循环就是听 `offline` 事件的那一条路径）时那一行也在，文案换成词典里的「连接已断开」那条，网络恢复后同样自己消失；③″ **首屏从来就没连上过**那一档不显示（另开一个上下文把通往网关的 WebSocket 拦下来不接给服务端，事件流永远不 ready ⇒ 状态源从未 `connected`），挡住「每次打开面板都闪一行」那类误报；④ 整段过程零 `slot entry crashed` / 零装载未激活 / 零 pageerror（这一条就是 ③″′ 那个机制的**后果**读数：改前整页白那一次就带着 `scope `session-maybe` rendered without an installed adapter`）；⑤ **生产现场的读数（#230，只记事实不判断言）**：「网关重启 + VS Code 交回扩展早先写下的那份 HTML」这条路（实验室用 `?pageWire=pinned` 伺服重启前那一份装配页）在两种缓存处境下各是什么读数——同一上下文（缓存里还有那份 bootstrap 的字节）与新上下文（缓存空）；它是本条边界之外的未修项（bootstrap 那一跳仍直连网关、那份 HTML 里的 rev 已被重启作废），读数如实进报告供人工验收。',
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
      opened = await openTreePage(ctx.browser, lab, tree, {
        width: 1400,
        height: 900,
        readyTimeoutMs: 30_000,
        settleMs: 1_000,
        // 页内记帧（#230）：把这条 roster 事件流真的收到的帧记下来，供 ①′ / ③″′ 断言用。
        initScript: eventsRecorderScript(),
      })
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

      // ①′ 重启前先把两样东西留底（#230）：这一页**开着的时候**那条事件流收到的第一帧名册，
      //     以及这一页的 HTML 原文（= 生产里 VS Code 存下的那一份，第 ⑤ 段要用）。
      const streamsBefore = await recordedStreams(page)
      const bootBefore = await bootRoster(page)
      const framesBefore = graphFrameCount(streamsBefore)
      const sameProcessGap = compareRosters(bootBefore, streamsBefore[0]?.graphs[0] ?? [])
      check.fact(
        `重启前：事件流 ${String(streamsBefore.length)} 条、graph 帧 ${String(framesBefore)} 帧；` +
          `第一帧 ${String(sameProcessGap.framedCount)} 条与本页 boot 的 ${String(sameProcessGap.bootCount)} 条逐条对照：` +
          `rev 不同 ${String(sameProcessGap.revDiffers.length)} 条、缺 ${String(sameProcessGap.missing.length)}、多 ${String(sameProcessGap.extra.length)}`,
      )
      check.eq(
        'chat：同一进程内推来的名册本来就该与本页 boot 逐条同 rev（下面那条对齐读数的对照基准）',
        { revDiffers: sameProcessGap.revDiffers, missing: sameProcessGap.missing, extra: sameProcessGap.extra },
        { revDiffers: [], missing: [], extra: [] },
      )
      const staleHtml = await (await fetch(`${lab.origin}/${tree.route}`)).text()

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

      // ③″′ 名册版本对齐的机制读数（#230）：网关重启之后，那条事件流会再推来一帧名册
      //     （官方 `dsh-client-hmr` 只建**一条** `EventSource`、断线靠它自己的重连，所以按
      //     帧数而不是流数认这一帧），而镜像推给页面的这一帧里每条的 rev 必须还是**这一页
      //     boot 时**那份清单里的值。官方那帧里的 rev 是重启后新进程的每进程随机值；直接
      //     下发的话客户端会读成「整份名册都变了」（每一条先拆后建 → 会话 scope 的对接件被
      //     撤销 → 官方渲染器抛装配错 → 整页白），所以这一条钉的是**机制**，后果那条是 ④。
      const streamsAfter = await waitForGraphFrames(page, framesBefore + 1, 40_000)
      const framesAfter = graphFrameCount(streamsAfter)
      check.ok(
        'chat：重启之后那条事件流真的又推来了一帧名册（否则下面两条读数没有意义）',
        framesAfter > framesBefore,
        `重启前 ${String(framesBefore)} 帧，40 秒后仍是 ${String(framesAfter)} 帧`,
      )
      const lastStream = streamsAfter[0]
      const query = lastStream === undefined ? new URLSearchParams() : new URLSearchParams(lastStream.url.slice(lastStream.url.indexOf('?') + 1))
      const baselineRaw = query.get('revs')
      const baselinePairs = (baselineRaw ?? '')
        .split(',')
        .map((pair) => pair.split(':'))
        .filter((pair) => pair.length === 2 && pair[0] !== '' && pair[1] !== '')
        .map((pair) => [pair[0] as string, pair[1] as string] as [string, string])
      const baselineGap = compareRosters(bootBefore, baselinePairs)
      check.fact(
        `重启后那条流：URL ${String(lastStream?.url.length ?? 0)} 字符、带基线 ${baselineRaw === null ? '否' : `是（${String(baselinePairs.length)} 对）`}、` +
          `graph 帧 ${String(framesAfter)} 帧（重启前 ${String(framesBefore)} 帧）`,
      )
      check.eq(
        'chat：重启后那条事件流带着本页 boot 清单的 id→rev 基线（镜像拿它对名册版本）',
        { revDiffers: baselineGap.revDiffers, missing: baselineGap.missing, extra: baselineGap.extra },
        { revDiffers: [], missing: [], extra: [] },
      )
      const restored = compareRosters(bootBefore, lastStream?.graphs[lastStream.graphs.length - 1] ?? [])
      check.fact(
        `重启后那一帧名册 ${String(restored.framedCount)} 条：与本页 boot 的 ${String(restored.bootCount)} 条逐条对照——` +
          `rev 不同 ${String(restored.revDiffers.length)} 条、缺 ${String(restored.missing.length)}、多 ${String(restored.extra.length)}`,
      )
      check.eq(
        'chat：重启后镜像下发的名册里每条的 rev 仍是本页 boot 那份的值（客户端不会读成「整份名册都变了」）',
        { revDiffers: restored.revDiffers, missing: restored.missing, extra: restored.extra },
        { revDiffers: [], missing: [], extra: [] },
      )

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
        const blockedCapture = capturePage(blockedPage)
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
        if (!blockedReady) {
          // 起不来时把这一页自己的控制台读数如实记下（不然只看到「就绪=false」，
          // 不知道是模块系统没起来还是别的原因——#230 之前这条读数就是这么来的）。
          check.fact(`从未连上过那一页的控制台（前 3 条 error）＝${JSON.stringify(blockedCapture.consoleErrors.slice(0, 3))}`)
        }
        check.ok('chat：拦掉事件流的那一页本身是渲染出来了的（否则这条读数没有意义）', blockedReady, `就绪点没出现：${tree.readySelector}`)
        check.eq('chat：首屏从未连上过时不显示提示（只有「曾经连上过、现在断了」才显示）', cold.count, 0)
      } finally {
        await blockedContext.close()
      }

      // ⑤ 生产现场（#230）：**网关重启之后，VS Code 交回的是扩展早先写下的那份 HTML**
      //    （webview 重载 / 会话恢复就是这条路），那份 HTML 里的 bootstrap 批 URL 带着
      //    重启之前那台网关的 rev——0.1.6-alpha.2 里条目与批的 rev 都是每进程随机值，
      //    所以它在第二台网关上是作废值。实验室的等价造法：`?pageWire=pinned`（伺服的是
      //    实验室启动那一刻那份，= 重启前那一份，见 labServer 的 PAGE_WIRE_QUERY）。
      //    **实测结论（2026-09-23，0.1.6-alpha.2）**：两种缓存处境（同一上下文 / 新上下文）
      //    下那一跳都是 404、页面都起不来——但**都不是白页**：官方那张 `Failed to load
      //    plugins` 启动失败卡照常渲染在 `#root` 里、原因（`client-modules: HTML did not
      //    preload @deepseek-ai/dsh-client-modules/client.js`）逐字可见，用户看到的是「加载
      //    插件失败 + 为什么」，恢复路径是重载窗口（扩展会重新生成 HTML）。
      //    **这一档只读数、不判断言**：修它属于另一件事（bootstrap 那一跳改由镜像伺服，
      //    或面板重载时重发 HTML），读数如实进报告，供人工验收与新条目决定怎么修。
      //    两档一起量：**同一上下文**（缓存里还有那份 bootstrap 的字节，与真 webview 重载
      //    同处境）与**新上下文**（缓存是空的，例如缓存被清掉 / 换过分区）。
      const staleQuery = { [PAGE_WIRE_QUERY]: PAGE_WIRE_PINNED }
      /** 这一页的三样读数：`#root` 正文（前 120 字）、composer 锚点数、bootstrap 那一跳的取字节情况。 */
      const staleRead = async (
        page: OpenedPage['page'],
      ): Promise<{ rootText: string; composer: number; bootstrap: unknown }> =>
        page.evaluate(() => {
          const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[]
          const root = document.getElementById("root")
          return {
            rootText: (root?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
            composer: document.querySelectorAll('[data-slot="conversation.composer.bar"]').length,
            bootstrap: resources
              .filter((entry) => entry.name.includes("/plugins/"))
              .map((entry) => ({
                name: entry.name.replace(/^https?:\/\/[^/]+/, ""),
                transferSize: entry.transferSize,
                decodedBodySize: entry.decodedBodySize,
                responseStatus: (entry as unknown as { responseStatus?: number }).responseStatus ?? 0,
              })),
          }
        })
      const bootstrapRevOf = (html: string): string | undefined => /&rev=([^"&]+)/.exec(bootstrapUrlOf(extractBootWire(html)))?.[1]
      const pinnedHtml = await (await fetch(`${lab.origin}/${tree.route}?${PAGE_WIRE_QUERY}=${PAGE_WIRE_PINNED}`)).text()
      const staleRev = bootstrapRevOf(staleHtml)
      const pinnedRev = bootstrapRevOf(pinnedHtml)
      const liveRev = /&rev=([^"&]+)/.exec(bootstrapUrlOf(await lab.gatewayWire()))?.[1]
      check.ok(
        '⑤ 现场有效性：`?pageWire=pinned` 伺服的就是重启前那一份清单（bootstrap rev 与 ①′ 留底那份相同）',
        staleRev !== undefined && pinnedRev === staleRev,
        `stale=${String(staleRev)} pinned=${String(pinnedRev)}`,
      )
      check.ok(
        '⑤ 现场有效性：重启前那份的 bootstrap rev 与重启后网关下发的那个不同（否则没造出「HTML 过期」这个现场）',
        staleRev !== undefined && liveRev !== undefined && staleRev !== liveRev,
        `stale=${String(staleRev)} live=${String(liveRev)}`,
      )
      const warm = await openTreePageAlongside(opened, lab, tree, {
        readyTimeoutMs: 12_000,
        settleMs: 1_500,
        query: staleQuery,
      })
      const warmReadings = await staleRead(warm.page)
      check.fact(
        `⑤ 同一上下文（缓存里还有那份 bootstrap 的字节）用重启前那份 HTML 开页：就绪=${String(warm.ready)}、` +
          `#root 正文=${JSON.stringify(warmReadings.rootText)}、composer 锚点=${String(warmReadings.composer)}、` +
          `bootstrap 请求=${JSON.stringify(warmReadings.bootstrap)}、控制台 error=${JSON.stringify(warm.capture.consoleErrors.slice(0, 2))}`,
      )
      screenshots.push(await shotTo(ctx.shots, warm.page, 'reconnect-hint-stale-page-warm'))
      await warm.page.close()
      const cold = await openTreePage(ctx.browser, lab, tree, {
        readyTimeoutMs: 12_000,
        settleMs: 1_500,
        query: staleQuery,
      })
      const coldReadings = await staleRead(cold.page)
      check.fact(
        `⑤ 新上下文（缓存是空的）用同一份 HTML 开页：就绪=${String(cold.ready)}、` +
          `#root 正文=${JSON.stringify(coldReadings.rootText)}、composer 锚点=${String(coldReadings.composer)}、` +
          `bootstrap 请求=${JSON.stringify(coldReadings.bootstrap)}、控制台 error=${JSON.stringify(cold.capture.consoleErrors.slice(0, 2))}`,
      )
      screenshots.push(await shotTo(ctx.shots, cold.page, 'reconnect-hint-stale-page-cold'))
      await cold.context.close()

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
