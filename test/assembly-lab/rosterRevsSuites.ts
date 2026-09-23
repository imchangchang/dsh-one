/**
 * 名册基线参数的编码套件（#243，F-72）。
 *
 * ## 现场是什么
 *
 * dsh **0.1.7-alpha.2** 上四棵装配树整片红（F-01 CONTRACT 24/40、整轮 5 过 / 65 红），
 * 当头那条是启动期 `renderSlot('root') before any 'root' registration (boot order)`：
 * 页面**先渲染好了**（root 槽在、10 个槽位锚点都在），约 70 毫秒后被自己卸成空白。
 *
 * 时间线的实测形状（本套件钉的就是这条链路）：页面起来 → 页内 244ms 时 root 槽与 10 个
 * 锚点渲染完成 → 269ms 时官方那条 roster 事件流推来第一帧名册 → 279ms 时 root 槽与所有
 * 锚点一起消失 → 281ms 官方渲染器抛 boot-order 装配错、React 把整棵 root 卸掉。
 *
 * 根因在**我们自己这条参数**上：页面开事件流时带一份「本页 boot 那份清单的 `id → rev`」
 * 基线（#230，镜像拿它对名册的版本），而 0.1.7 起那份基线里**有一条 rev 真的带着分隔符**
 * ——自有条目的 rev 是整包缓存键 `appRev-localRev`，`appRev` 把每一个 application 批的 rev
 * 用逗号并起来（`wireFilter.applicationComboRev`），0.1.7 把 application 切成了**两个批**。
 * 改前的格式是 `id:rev,id:rev` 原样拼接，那个逗号被当成「下一对开始了」，自有条目的 rev
 * 被截成前一半（实测：`117817dcabda,0ec98e9bdd7b-694f1d2833d5` → `117817dcabda`）。镜像据此
 * 对齐，等于告诉客户端「这几条变了」→ 客户端先拆后建 → 拆掉自有 frame 插件那一条时 `root`
 * 槽的注册随之撤销 → React 重渲染撞上「没有任何 root 注册」→ 整页白。
 *
 * 0.1.6-alpha.2 上同一份代码零红（F-01 43/43）的原因也在这里：那一版 application 只有一个
 * 批，`appRev` 是一段没有逗号的 rev，原样拼接本来就没有歧义。**不是官方改了启动顺序**，
 * 是我们的编码格式在两批之下露出了歧义。
 *
 * 修法 = 把参数换成 JSON（`[[id, rev], …]` 再整体百分号转义，见 `wireFilter.ts` 的
 * `ROSTER_REVS_PARAM`）：结构由括号与引号自己带出来，值里出现什么都不影响。只给每半加
 * 一层百分号转义**修不了**——读端是 `url.searchParams.get`，URL 层已经把 `%2C` 解回 `,`。
 *
 * ## 三条读数
 *
 * ① **基线真的原样带上去了**：页面发出去的那条流的 `revs` 参数，用**生产那份解码端**
 *    （`wireFilter.parseRosterRevs`）解回来，逐条等于本页 `__DSH_BOOT__` 那份清单的 rev
 *    （转义之前那一版在这个形状下对不上——这就是负向对照）；同时记一条事实说明这一轮的
 *    清单里到底有没有「rev 带分隔符」的条目（没有就是单批那一版，本档的现场不成立）。
 * ② **推来的名册逐条同 rev**：镜像按基线对齐之后推给页面的那一帧里，每条的 rev 仍是本页
 *    boot 那份的值——客户端因此不会把任何条目读成「变了」。后果读数是 ③。
 * ③ **页面照常**：零 pageerror（尤其没有那条 boot-order 装配错）、槽位锚点有内容。
 *    负向对照（`?rosterRevs=raw`，同一页、同一份清单、只把编码换回改前那套）：① 那一档对
 *    不上，且页面照改前那样整块白——**这一条证明的是「红是这段编码造成的」，不是「碰巧」**。
 *    清单形状不成立（只有一个 application 批）时改记事实，并断言同一页在这一档**零**这条
 *    报错（原样拼接在这个形状下本来就无歧义）。
 */
import type { Page } from 'playwright'
import { openTreePage, type OpenedPage } from './harness.ts'
import { LAB_TREES, ROSTER_REVS_QUERY, ROSTER_REVS_RAW, type LabTreeRoute } from './labServer.ts'
import { parseRosterRevs, ROSTER_REVS_PARAM } from '../../src/ui/assembly/wireFilter.ts'
import type { LabSuite } from './suites.ts'

const route = (name: string): LabTreeRoute => {
  const found = LAB_TREES.find((candidate) => candidate.route === name)
  if (found === undefined) throw new Error(`lab: unknown tree route ${name}`)
  return found
}

/** 官方那条 roster 事件流在页面上的路径（我们把它改道到镜像的过滤版）。 */
const EVENTS_PATH = '/plugins-local/events'

/** 启动期那条装配错的原文（判据认它，不认别的措辞）。 */
const BOOT_ORDER_ERROR = "renderSlot('root') before any 'root' registration (boot order)"

/**
 * 页内簿记：把那条事件流**真的收到**的 URL 与帧记下来。
 *
 * 装在最前面（`OpenOptions.initScript`，页面任何脚本之前）：我们自己的传输层也在页面里包
 * 一层 `EventSource`（改道 + 带基线），它读的是 `globalThis.EventSource`——这里先包一层，
 * 两条包装串成一条链，记到的就是**真的发出去的那条 URL**（含基线参数）与**真的收到的帧**。
 */
function rosterRecorderScript(): string {
  return `(() => {
  const Native = globalThis.EventSource
  if (typeof Native !== "function") return
  globalThis.__F71__ = { streams: [] }
  globalThis.EventSource = new Proxy(Native, {
    construct(target, args, newTarget) {
      const instance = Reflect.construct(target, args, newTarget)
      const record = { url: String(args[0]), frames: [] }
      globalThis.__F71__.streams.push(record)
      try { instance.addEventListener("message", (event) => { record.frames.push(String(event.data)) }) } catch (ignored) {}
      return instance
    },
  })
})()`
}

/** 一条记下来的事件流（URL + 每帧 graph 名册的 `[id, rev]` 对）。 */
interface RecordedStream {
  url: string
  graphs: ReadonlyArray<ReadonlyArray<readonly [string, string]>>
}

async function recordedStreams(page: Page): Promise<RecordedStream[]> {
  return page.evaluate((path) => {
    const streams = (globalThis as { __F71__?: { streams: { url: string; frames: string[] }[] } }).__F71__?.streams ?? []
    const out: { url: string; graphs: [string, string][][] }[] = []
    for (const stream of streams) {
      if (!stream.url.includes(path)) continue
      const graphs: [string, string][][] = []
      for (const frame of stream.frames) {
        try {
          const parsed = JSON.parse(frame) as { type?: string; graph?: { entries?: { id?: string; rev?: string }[] } }
          if (parsed.type !== 'graph' || !Array.isArray(parsed.graph?.entries)) continue
          graphs.push(
            parsed.graph.entries
              .filter((entry) => typeof entry.id === 'string' && typeof entry.rev === 'string')
              .map((entry) => [entry.id as string, entry.rev as string]),
          )
        } catch (ignored) {}
      }
      out.push({ url: stream.url, graphs })
    }
    return out
  }, EVENTS_PATH)
}

/** 这一页 boot 那一刻那份清单的 `[id, rev]` 对（`__DSH_BOOT__` 就是页面装配时读的那一份）。 */
async function bootRoster(page: Page): Promise<Array<readonly [string, string]>> {
  return page.evaluate(() => {
    const wire = (globalThis as { __DSH_BOOT__?: { entries?: { id?: string; rev?: string }[] } }).__DSH_BOOT__
    return (wire?.entries ?? [])
      .filter((entry) => typeof entry.id === 'string' && typeof entry.rev === 'string')
      .map((entry) => [entry.id as string, entry.rev as string] as [string, string])
  })
}

/** 两份名册的对照读数（分开数是为了失败信息读得懂：rev 不同的条数 = 客户端会拆掉重建的条数）。 */
function compareRosters(
  boot: ReadonlyArray<readonly [string, string]>,
  other: ReadonlyArray<readonly [string, string]>,
): { bootCount: number; otherCount: number; revDiffers: string[]; missing: string[]; extra: string[] } {
  const bootMap = new Map(boot)
  const otherMap = new Map(other)
  return {
    bootCount: bootMap.size,
    otherCount: otherMap.size,
    revDiffers: [...bootMap].filter(([id, rev]) => otherMap.has(id) && otherMap.get(id) !== rev).map(([id]) => id),
    missing: [...bootMap.keys()].filter((id) => !otherMap.has(id)),
    extra: [...otherMap.keys()].filter((id) => !bootMap.has(id)),
  }
}

/** 页面上还有多少槽位锚点（整块白时是 0）。 */
async function slotAnchors(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelectorAll('[data-slot]').length)
}

/** 一条流的 URL 上的查询参数。 */
function queryOf(url: string): URLSearchParams {
  const at = url.indexOf('?')
  return new URLSearchParams(at === -1 ? '' : url.slice(at + 1))
}

export const ROSTER_REVS_SUITE: LabSuite = {
  id: 'F-72',
  phase: 'new-feature',
  name: '名册基线的编码（#243）：页面带上去的 id→rev 基线逐条成对，推来的名册因此逐条同 rev、页面不被自己拆空',
  expect:
    'chat 树在真实网关只读下打开（同一台隔离实例，与别的套件同一份现场）：① **基线原样带上去**——页面开的 `/plugins-local/events` 那条流 URL 上的 `revs` 参数，用生产那份解码端（`parseRosterRevs`）解回来，逐条等于本页 `__DSH_BOOT__` 那份清单的 rev（多出/缺失/rev 不同三项都必须是空），并记一条事实说明这一轮清单里有没有「rev 带分隔符 `,`」的条目（0.1.7 起有：自有条目的 rev = `applicationComboRev` + `-` + 本地内容哈希，而官方把 application 切成了两个批）；② **推来的名册逐条同 rev**——镜像按基线对齐后推给页面的那一帧，每条的 rev 仍是本页 boot 那份的值（否则客户端会先拆后建，拆掉自有 frame 插件时随 `root` 槽的注册一起把整页卸空）；③ **页面照常**——零 pageerror（尤其没有那条 `renderSlot(\'root\') before any \'root\' registration (boot order)`）、槽位锚点有内容。④ **负向对照**（`?rosterRevs=raw`：同一页、同一份清单，只把编码换回改前那套原样拼接）——清单里真有带分隔符的 rev 时，这一档的基线必然对不上（① 那一档的解回来是截断值），页面照改前那样整块白（槽位锚点 0 枚 + 那条 boot-order 装配错在场）；清单形状不成立（只有一个 application 批、rev 里没有分隔符）时本档记事实，并断言同一页在这一档零 boot-order 报错（原样拼接在这个形状下本来就无歧义）。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const tree = route('chat')

    // --- 现场形状（独立于页面读数：官方这一版把 application 切了几个批）---
    const gatewayWire = await ctx.lab.gatewayWire()
    const applicationBatches = gatewayWire.batches.filter((batch) => batch.phase === 'application').length

    // --- 正向：缺省编码那一页 ---
    const opened: OpenedPage = await openTreePage(ctx.browser, ctx.lab, tree, {
      initScript: rosterRecorderScript(),
      // 这一条要等的是「事件流真的推来一帧之后页面还活着」，所以静置够一帧的时间。
      settleMs: 6_000,
    })
    try {
      const boot = await bootRoster(opened.page)
      const commaRevs = boot.filter(([, rev]) => rev.includes(','))
      const streams = await recordedStreams(opened.page)
      const stream = streams[0]
      const graphs = stream?.graphs ?? []
      check.fact(
        `chat：本页清单 ${String(boot.length)} 条、其中 rev 含「,」的 ${String(commaRevs.length)} 条（官方 application 批数 ${String(applicationBatches)}）；` +
          `事件流 ${String(streams.length)} 条、graph 帧 ${String(graphs.length)} 帧${stream === undefined ? '' : `、流 URL ${String(stream.url.length)} 字符`}`,
      )
      for (const [id, rev] of commaRevs) check.fact(`chat：rev 含「,」的条目 ${id}（${rev}）`)

      // ① 基线：页面真的带上去了、而且是逐条成对的。
      const baselinePairs = [...parseRosterRevs(queryOf(stream?.url ?? '').get(ROSTER_REVS_PARAM) ?? '')]
      const baselineGap = compareRosters(boot, baselinePairs)
      check.eq(
        'chat：页面带上去的基线逐条 = 本页 boot 那份清单的 id→rev（含 rev 里带分隔符的那几条）',
        { revDiffers: baselineGap.revDiffers, missing: baselineGap.missing, extra: baselineGap.extra },
        { revDiffers: [], missing: [], extra: [] },
      )

      // ② 推来的名册：镜像按基线对齐之后，客户端看到的 rev 仍是 boot 那份。
      const framed = graphs[graphs.length - 1] ?? []
      const framedGap = compareRosters(boot, framed)
      check.eq(
        'chat：镜像推给页面的名册逐条 rev 仍是本页 boot 那份的值（客户端不会把条目先拆后建）',
        { revDiffers: framedGap.revDiffers, missing: framedGap.missing, extra: framedGap.extra },
        { revDiffers: [], missing: [], extra: [] },
      )

      // ③ 后果：页面还活着。
      const anchors = await slotAnchors(opened.page)
      const errors = opened.capture.pageErrors
      check.ok('chat：首屏就绪（composer 槽位）', opened.ready, '就绪点没出现')
      check.ok(`chat：页面上槽位锚点还在（${String(anchors)} 枚）`, anchors > 0, `anchors=${String(anchors)}`)
      check.eq('chat：零 pageerror', errors, [])
      check.ok(
        'chat：没有那条 boot-order 装配错（整页白那一次的报错原文）',
        !errors.some((line) => line.includes(BOOT_ORDER_ERROR)),
        errors.join(' | '),
      )
      screenshots.push(await shot(ctx.shots, opened.page, 'roster-revs-default'))
    } finally {
      await opened.context.close()
    }

    // --- ④ 负向对照：把编码换回改前那套（同一页、同一份清单）---
    const legacy = await openTreePage(ctx.browser, ctx.lab, tree, {
      query: { [ROSTER_REVS_QUERY]: ROSTER_REVS_RAW },
      initScript: rosterRecorderScript(),
      // 这一档页面要么照常起来、要么整块白；整块白时别把 40 秒首屏超时等满。
      readyTimeoutMs: 8_000,
      settleMs: 3_000,
    })
    try {
      const legacyBoot = await bootRoster(legacy.page)
      const legacyStreams = await recordedStreams(legacy.page)
      const legacyGap = compareRosters(legacyBoot, [...parseRosterRevs(queryOf(legacyStreams[0]?.url ?? '').get(ROSTER_REVS_PARAM) ?? '')])
      const legacyErrors = legacy.capture.pageErrors
      const legacyAnchors = await slotAnchors(legacy.page)
      check.fact(
        `chat（负向对照 ?rosterRevs=raw）：清单 ${String(legacyBoot.length)} 条、基线对不上 ${String(legacyGap.revDiffers.length)} 条（rev 不同 ${JSON.stringify(legacyGap.revDiffers.slice(0, 8))}）、` +
          `槽位锚点 ${String(legacyAnchors)} 枚、pageerror ${JSON.stringify(legacyErrors.map((line) => line.split('\n')[0] ?? ''))}`,
      )
      if (legacyBoot.some(([, rev]) => rev.includes(','))) {
        check.ok(
          'chat（负向对照）：原样拼接在这份清单上真的对不上（带分隔符的 rev 被截断）',
          legacyGap.revDiffers.length > 0,
          `rev 不同 ${String(legacyGap.revDiffers.length)} 条`,
        )
        check.ok(
          'chat（负向对照）：页面整块白（官方渲染器抛 boot-order 装配错）',
          legacyErrors.some((line) => line.includes(BOOT_ORDER_ERROR)),
          JSON.stringify(legacyErrors.map((line) => line.split('\n')[0] ?? '')),
        )
        check.ok(
          `chat（负向对照）：一个槽位锚点都不剩（${String(legacyAnchors)} 枚）`,
          legacyAnchors === 0,
          `anchors=${String(legacyAnchors)}`,
        )
        screenshots.push(await shot(ctx.shots, legacy.page, 'roster-revs-raw'))
      } else {
        // 单批那一版（0.1.6 及更早）：原样拼接没有歧义，本档的现场不成立——如实记一条，
        // 并断言这一档在这个形状下零那条报错（换个原因把这条判据打红时看得见）。
        check.fact(
          'chat（负向对照）：这一版只有一个 application 批、清单里没有 rev 带分隔符的条目——原样拼接在这个形状下本来就无歧义，负向对照不成立',
        )
        check.ok(
          'chat（负向对照）：这个形状下原样拼接也零 boot-order 报错',
          !legacyErrors.some((line) => line.includes(BOOT_ORDER_ERROR)),
          JSON.stringify(legacyErrors.map((line) => line.split('\n')[0] ?? '')),
        )
      }
    } finally {
      await legacy.context.close()
    }
    return screenshots
  },
}

/** 截图（各套件自己的小工具，见 suites.ts 的同名函数）。 */
async function shot(dir: string, page: Page, name: string): Promise<string> {
  const file = `${dir}/${name}.png`
  await page.screenshot({ path: file })
  return file
}
