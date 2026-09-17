/**
 * 会话被另一个 dsh 进程占着写句柄时的可见提示（#145）。
 *
 * ## 这一条修的是什么
 *
 * dsh 的会话日志是**单写者**：一个会话同一时刻只允许一个写句柄，这条约束**跨进程**生效
 * （官方 `dsh-session-persistence-jsonl` 在会话目录里落 `session.lock` 并 `flock` 独占）。
 * 用户同时开着两个 dsh 实例（VS Code 里扩展自己起的那个 + 浏览器里手工 `dsh web` 起的
 * 那个）时，**先在那边打开过的会话，在这边点它就会激活失败**——失败原文是官方那条通用
 * 错误：`resume failed for session …: SessionAlreadyOwnedError: …`（#145 诊断结论，实测
 * 复现见 issue）。
 *
 * 官方客户端对这条失败**没有界面**：`api-session/error` 只落到会话对象的 `lastAgentError`
 * 上（0.1.6-alpha.1 全仓只有写入方、没有读取方），用户当场看不到任何东西，要到发消息时
 * 才在输入条上弹一条原始吐司。侧栏树是用户点击的地方，所以 #145 让它在收到这条事件时
 * 飘一条能行动的提示（`workspaceTree/sessionOwnedNotice.ts` + `workspaceTreePlugin.ts`
 * 里那段订阅）。
 *
 * ## 怎么**确定性地**造出这一态
 *
 * 真造它要两个 dsh 进程抢同一个 `$DSH_HOME` 里的同一条会话——那是**写类**操作，而且要求
 * 本机跑着第二个实例，实验室里不能这么干（实验室是「真网关只读」，见 README 的 R-06 与
 * 前置条件）。所以这里走**帧注入**：官方客户端是从一条 `$events` 逻辑流上收转发事件
 * （`dsh-api-session-controller` 的客户端半自己就是 `ctx.remote.$on('api-session/error', …)`），
 * 夹具在页面与网关之间那条 mux WebSocket 上做一层代理，就绪后**自己投一帧**
 * `{type:'emit', event:'api-session/error', args:[sessionId, message]}`——这是官方那条链路的
 * 真实输入，走的是官方代码，不是我们另造的一套状态（同一套夹具 F-43 已经在用）。
 *
 * 投的那条 message **逐字取官方原文**（`dsh-session-persistence` 的
 * `SessionAlreadyOwnedError` 拼出来的那句，实测回执见 issue #145）；判定在插件里只认官方
 * 错误类名（`pure/sessionOwnership.ts`），不认前缀文案。
 *
 * 本套件**不写网关**：注入的帧网关不知道、页面也不会回执；唯一一次点击是回归项里那次
 * 「普通会话行照旧可点」，与 F-28 的点击走同一条路（打开会话，不改标题、不删不改）。
 */
import * as path from 'node:path'
import { emit, installEventStreamInjector, openTreePage, waitForEventStream, withoutKnownNoise, type Check, type OpenedPage } from './harness.ts'
import { LAB_TREES, type LabTreeRoute } from './labServer.ts'
// 期望文案从插件自己的词典读（不硬编码）：被测的就是「树上飘的是哪一句」。
import { ZH } from '../../src/ui/assembly/shell/workspaceTree/locale.ts'
// 只取类型（编译后不留 import，运行期没有环）：套件接口定义在 suites.ts 里。
import type { LabSuite } from './suites.ts'

const route = (name: string): LabTreeRoute => {
  const found = LAB_TREES.find((candidate) => candidate.route === name)
  if (found === undefined) throw new Error(`lab: unknown tree route ${name}`)
  return found
}

/** 官方原文（`resume failed for session …: SessionAlreadyOwnedError: …`，实测回执逐字）。 */
const ownedMessage = (sessionId: string): string =>
  `resume failed for session "${sessionId}": SessionAlreadyOwnedError: session "${sessionId}" is already owned by an active write handle`

/** 树上那枚飘提示的选择器（`flash.ts` 的自有标记）。 */
const FLASH = '[data-dshone-tree="flash"]'

/** 读当前飘着的提示文案（没有则空串）。 */
async function flashText(page: OpenedPage['page']): Promise<string> {
  const host = page.locator(FLASH)
  if ((await host.count()) === 0) return ''
  return ((await host.first().innerText()) ?? '').trim()
}

/** 轮询等飘提示出现（超时返回空串）。 */
async function waitForFlash(page: OpenedPage['page'], timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const text = await flashText(page)
    if (text !== '') return text
    if (Date.now() >= deadline) return ''
    await page.waitForTimeout(150)
  }
}

async function shot(page: OpenedPage['page'], file: string): Promise<string> {
  await page.screenshot({ path: file })
  return file
}

export const SESSION_OWNED_SUITE: LabSuite = {
  id: 'F-44',
  phase: 'new-feature',
  name: 'SESSION-OWNED-ELSEWHERE',
  expect:
    '会话被另一个 dsh 进程占着写句柄时（官方 `api-session/error` 上那句 `SessionAlreadyOwnedError`），' +
    '侧栏树飘一条能行动的提示（文案 = 插件词典里的 `session.ownedElsewhere`，停留明显长于动作回执的 2.2 秒）；' +
    '别的会话错误不触发它；普通会话行照旧可点、树上不多出任何东西。夹具只往页面的 `$events` 流投帧，不写网关',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const opened = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { settleMs: 2_500 })
    // 夹具必须在页面的 socket 建立之前装上：装完重载一次，之后所有连接都过代理。
    const injector = await installEventStreamInjector(opened.page)
    await opened.page.reload({ waitUntil: 'domcontentloaded' })
    await opened.page
      .waitForSelector(route('sidebar').readySelector, { timeout: 40_000 })
      .catch(() => undefined)
    await opened.page.waitForTimeout(2_500)
    const streamReady = await waitForEventStream(injector, opened.page)
    check.ok('夹具的 `$events` 流出活（能往页面的官方客户端投帧）', streamReady, JSON.stringify(injector.stats()))

    const sessionId = await opened.page.evaluate(() => {
      const row = document.querySelector('[data-dshone-tree-row="session"]')
      return row?.getAttribute('data-dshone-tree-session') ?? ''
    })
    check.fact(`命中用于注入的会话 id：${sessionId === '' ? '(当天树上没有会话行，用合成 id)' : sessionId}`)
    const target = sessionId === '' ? 'session-lab-owned-elsewhere' : sessionId

    // 起手可能有提示：这台机器上若真有一个进程占着树上某条会话（#145 的现场），页面一挂载
    // 就会自己飘一次——那是**真事件**，不是夹具（本套件把它当观测记下来）。等它收掉再注入，
    // 后面的时长判据才不被它污染。
    const baseline = await flashText(opened.page)
    if (baseline !== '') {
      check.fact(`页面挂载时自己飘过一次（真事件：这台机器上确实有进程占着某条会话）：「${baseline}」`)
      const deadline = Date.now() + 12_000
      while (Date.now() < deadline && (await flashText(opened.page)) !== '') await opened.page.waitForTimeout(200)
    }
    check.eq('注入之前树上没有飘提示（基线空的，后面的判据才是这套夹具自己造出来的）', await flashText(opened.page), '')

    // ① 官方那条「会话已被活跃写句柄占用」的事件一到，树上出提示。
    const message = ownedMessage(target)
    injector.push(emit('api-session/error', [target, message]))
    const text = await waitForFlash(opened.page, 8_000)
    check.eq('① 会话被另一个 dsh 占用时树上飘出提示（文案 = 插件词典那一句）', text, ZH['session.ownedElsewhere'])
    check.fact(`注入的帧：api-session/error ${message.slice(0, 120)}…`)
    screenshots.push(await shot(opened.page, path.join(ctx.shots, 'session-owned-flash.png')))

    // ② 停留时长明显长于动作回执（2.2 秒）：3 秒时还在，7 秒时收掉。
    await opened.page.waitForTimeout(3_000)
    check.ok('② 3 秒后仍在（要人行动的句子，不能被 2.2 秒那档时长收掉）', (await flashText(opened.page)) !== '')
    await opened.page.waitForTimeout(4_500)
    check.eq('② 约 6 秒后自己收掉（不会长期占着树底）', await flashText(opened.page), '')

    // ③ 别的会话错误（同一条通道、名字相近的另一条官方错误）不触发我们的提示。
    injector.push(emit('api-session/error', [target, `session "${target}" not found`]))
    injector.push(emit('api-session/error', [target, `failed to create session "${target}": SessionAlreadyExistsError: session "x" already exists`]))
    await opened.page.waitForTimeout(2_000)
    check.eq('③ 别的会话错误不飘我们的提示（只认 `SessionAlreadyOwnedError` 那一条）', await flashText(opened.page), '')

    // ④ 回归：普通会话行照旧可点，且点击本身不产生这条提示（新订阅只认那条错误）。
    const clickable = opened.page.locator('[data-dshone-tree-row="session"]').first()
    const clicked = (await clickable.count()) > 0
    if (clicked) {
      await clickable.click()
      await opened.page.waitForTimeout(2_000)
      check.eq('④ 点普通会话行照旧（树上没有因此多出提示）', await flashText(opened.page), '')
      check.ok(
        '④ 点完之后树上仍有会话行（树没被这次订阅弄坏）',
        (await opened.page.locator('[data-dshone-tree-row="session"]').count()) > 0,
        String(await opened.page.locator('[data-dshone-tree-row="session"]').count()),
      )
    } else {
      check.fact('当天树上没有会话行，④ 的点击回归跳过（F-28 覆盖四条点击路径）')
    }
    check.eq('全程零 pageerror', withoutKnownNoise(opened.capture.pageErrors).real, [])
    await opened.context.close()
    return screenshots
  },
}
