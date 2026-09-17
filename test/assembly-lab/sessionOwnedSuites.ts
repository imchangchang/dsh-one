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
 * ## 判据为什么写成这样（**不依赖运行环境**）
 *
 * 这台机器上**真有**别的 dsh 进程占着某条会话时（#145 的现场，本机实测常驻），页面一挂载
 * 就会自己飘一次提示——那是**真事件**。所以这一套的判据一律不假设「树上没有提示 / 树上
 * 只有一条会话 / 某条会话没被占用」：
 *
 * - **先等基线静下来**（没有任何提示在飘），再动手；基线飘过几次只记成观测。
 * - **注入的阳性面**认「现在飘着的那条提示的文案 = 插件词典那一句」；文案随页面语言
 *   （日常实例 zh、空的隔离网关 en），两种取值都从词典里读。注入前若已有提示在飘，先等它
 *   收掉——否则「新提示」和「旧提示」在 DOM 上是同一个元素，分不出来。
 * - **时长判据认元素本身**：① 里拿到那一刻那枚提示节点的 `JSHandle`，3 秒时它还在文档里、
 *   7 秒后它已断开——「它自己收掉了」与「旁边又飘了别的提示」互不干扰（环境里正好有真
 *   事件时也不会误判）。
 * - **④ 点击回归走「宿主说开着 + 点当前会话行」这条路**（= 进就地改名，#115/#121 的语义），
 *   官方这条路**一个网关调用都不发**（F-28 的 ② 已钉住「零打开请求」），所以点击在结构上
 *   不可能触发 `api-session/error`、也就不可能产生新提示——判据是「点击前后提示计数不变、
 *   且改名输入框真的出来了」。不去点「第一条非当前会话行」：那条会真的去打开会话，在这台
 *   机器上可能正好点到一条被别人占着的会话（那是**功能正常**的表现，不是回归），判据会跟着
 *   环境红。
 * - **提示计数**用页面侧一个 MutationObserver 数（`flash.ts` 的宿主节点从「没有」变成
 *   「在」算一次；同一个元素上换文案不算新的一次），配合「先等静」来用。
 *
 * 本套件**不写网关**：注入的帧网关不知道、页面也不回执；④ 那一次点击走的是零网关调用的
 * 改名路（Esc 取消，不提交）。
 */
import * as path from 'node:path'
import type { ElementHandle, Page } from 'playwright'
import { emit, installEventStreamInjector, openTreePage, waitForEventStream, withoutKnownNoise } from './harness.ts'
import { LAB_TREES, type LabTreeRoute } from './labServer.ts'
// 期望文案从插件自己的词典读（不硬编码）：被测的就是「树上飘的是哪一句」。
import { EN, ZH } from '../../src/ui/assembly/shell/workspaceTree/locale.ts'
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
/** 行内改名输入框的选择器（#115；F-28 用的是同一个）。 */
const RENAME_INPUT = '[data-dshone-tree-rename="input"]'
/** 提示计数探针（页面侧）：数「提示宿主节点从没有变成在」的次数。 */
const FLASH_COUNTER = '__LAB_FLASH_COUNT__'

/** 读当前飘着的提示文案（没有则空串）。 */
async function flashText(page: Page): Promise<string> {
  const host = page.locator(FLASH)
  if ((await host.count()) === 0) return ''
  return ((await host.first().innerText()) ?? '').trim()
}

/** 轮询等飘提示出现（超时返回空串）。 */
async function waitForFlash(page: Page, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const text = await flashText(page)
    if (text !== '') return text
    if (Date.now() >= deadline) return ''
    await page.waitForTimeout(150)
  }
}

/** 等提示收干净（超时返回 false）。 */
async function waitForQuiet(page: Page, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if ((await flashText(page)) === '') return true
    if (Date.now() >= deadline) return false
    await page.waitForTimeout(150)
  }
}

/**
 * 装提示计数探针：数「提示宿主节点从没有变成在」的次数。
 *
 * 为什么不在断言里直接数 `FLASH` 节点数就够：同一个元素上换文案（新的提示压着旧的）在 DOM
 * 上还是那一个节点，外加点之前机器上本来就飘着一条——所以配一个「先等静、再数增量」的读法。
 * 计数靠 MutationObserver 看 `document.body` 子树的插入；本页的提示宿主挂在树根里，插入即
 * 一次新提示（同一条提示在重绘里原地更新不产生插入）。
 */
async function installFlashCounter(page: Page): Promise<void> {
  await page.evaluate((key) => {
    const scope = globalThis as unknown as Record<string, unknown>
    scope[key] = 0
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of Array.from(record.addedNodes)) {
          if (!(node instanceof HTMLElement)) continue
          if (node.matches('[data-dshone-tree="flash"]') || node.querySelector('[data-dshone-tree="flash"]') !== null) {
            scope[key] = ((scope[key] as number | undefined) ?? 0) + 1
          }
        }
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
  }, FLASH_COUNTER)
}

async function flashCount(page: Page): Promise<number> {
  return await page.evaluate((key) => ((globalThis as unknown as Record<string, unknown>)[key] as number | undefined) ?? 0, FLASH_COUNTER)
}

/** 让假宿主如实回「这条会话开在面板里」（默认就是 true，这里显式写出来自证场景）。 */
async function setHostPanelSession(page: Page, open: boolean): Promise<void> {
  await page.evaluate((value: boolean) => {
    const host = (globalThis as { __LAB_HOST__?: { panelSession: unknown } }).__LAB_HOST__
    if (host !== undefined) host.panelSession = value
  }, open)
}

async function shot(page: Page, file: string): Promise<string> {
  await page.screenshot({ path: file })
  return file
}

/** 拿当前那枚提示节点的句柄（用来判「它自己收掉了」，与旁边冒出来的别的提示互不干扰）。 */
async function flashHandle(page: Page): Promise<ElementHandle<Element> | null> {
  const handle = await page.locator(FLASH).first().elementHandle()
  return handle
}

/** 句柄指向的节点是否还在文档里。 */
async function stillAttached(handle: ElementHandle<Element>): Promise<boolean> {
  return await handle.evaluate((node) => (node as Element).isConnected)
}

export const SESSION_OWNED_SUITE: LabSuite = {
  id: 'F-47',
  phase: 'new-feature',
  name: 'SESSION-OWNED-ELSEWHERE',
  expect:
    '会话被另一个 dsh 进程占着写句柄时（官方 `api-session/error` 上那句 `SessionAlreadyOwnedError`），' +
    '侧栏树飘一条能行动的提示（文案 = 插件词典里的 `session.ownedElsewhere`，停留明显长于动作回执的 2.2 秒，且到点自己收掉）；' +
    '同一条通道上别的会话错误不触发它；点击当前会话行走的是零网关调用的改名路，点击前后提示计数不变、改名输入框照旧出现。' +
    '夹具只往页面的 `$events` 流投帧，不写网关；这台机器上真有别的进程占着会话时页面会自己飘一次（真事件），判据先等基线静下来再看增量，不依赖「环境是干净的」',
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
    await installFlashCounter(opened.page)

    const sessionId = await opened.page.evaluate(() => {
      const row = document.querySelector('[data-dshone-tree-row="session"]')
      return row?.getAttribute('data-dshone-tree-session') ?? ''
    })
    check.fact(`命中用于注入的会话 id：${sessionId === '' ? '(当天树上没有会话行，用合成 id)' : sessionId}`)
    const target = sessionId === '' ? 'session-lab-owned-elsewhere' : sessionId

    // 基线：这台机器上若真有一个进程占着树上某条会话（#145 的现场），页面挂载时就会自己飘
    // 一次——那是**真事件**，不是夹具。等它收掉再注入（不假设它一定出现过、也不假设它没有）。
    const mountText = await flashText(opened.page)
    if (mountText !== '') {
      check.fact(`页面挂载时自己飘过一次（真事件：这台机器上确实有进程占着某条会话）：「${mountText}」`)
    }
    check.ok('注入之前页面会静下来（基线干净，后面的增量判据才有意义）', await waitForQuiet(opened.page, 14_000))

    // ① 官方那条「会话已被活跃写句柄占用」的事件一到，树上出提示。
    const message = ownedMessage(target)
    const beforeInject = await flashCount(opened.page)
    injector.push(emit('api-session/error', [target, message]))
    const text = await waitForFlash(opened.page, 8_000)
    // 页面语言随环境（日常实例是 zh；空的隔离网关会起来 en），两种取值都从插件词典里读——
    // 这一条验的是「飘的是插件词典那一句」，不是哪一国语言。
    const expected = [ZH['session.ownedElsewhere'], EN['session.ownedElsewhere']]
    check.ok(
      '① 会话被另一个 dsh 占用时树上飘出提示（文案 = 插件词典那一句）',
      text === expected[0] || text === expected[1],
      `actual=${JSON.stringify(text)} expected=${JSON.stringify(expected)}`,
    )
    check.ok('① 这一条是这次注入新起的（不是基线那条还没收）', (await flashCount(opened.page)) > beforeInject)
    check.eq('① 此刻树上只有一枚提示（同一时刻不给两行）', await opened.page.locator(FLASH).count(), 1)
    check.fact(`注入的帧：api-session/error ${message.slice(0, 120)}…`)
    screenshots.push(await shot(opened.page, path.join(ctx.shots, 'session-owned-flash.png')))

    // ② 停留时长明显长于动作回执（2.2 秒）：3 秒时**这一枚**还在，7 秒后**这一枚**已经收掉。
    // 认节点句柄而不是认「页面上有没有提示」：机器上正好又冒出一条真提示时也不会误判。
    const shown = await flashHandle(opened.page)
    check.ok('② 拿得到这一枚提示的节点', shown !== null)
    if (shown !== null) {
      await opened.page.waitForTimeout(3_000)
      check.ok('② 3 秒后这一枚仍在（要人行动的句子，不能被 2.2 秒那档时长收掉）', await stillAttached(shown))
      await opened.page.waitForTimeout(4_000)
      check.ok('② 约 6 秒后这一枚自己收掉（不会长期占着树底）', !(await stillAttached(shown)))
      await shown.dispose()
    }

    // ③ 别的会话错误（同一条通道、名字相近的另一条官方错误）不触发我们的提示。
    const beforeNoise = await flashCount(opened.page)
    injector.push(emit('api-session/error', [target, `session "${target}" not found`]))
    injector.push(
      emit('api-session/error', [
        target,
        `failed to create session "${target}": SessionAlreadyExistsError: session "x" already exists`,
      ]),
    )
    await opened.page.waitForTimeout(2_000)
    check.eq('③ 别的会话错误不飘我们的提示（只认 `SessionAlreadyOwnedError` 那一条）', await flashText(opened.page), '')
    check.eq('③ 而且一条新提示都没起（计数不动）', await flashCount(opened.page), beforeNoise)

    // ④ 回归：点击照旧、且**点击本身**不会平白多出提示。
    // 走「宿主说开着 + 点当前会话行」这条路（#115/#121 的语义 = 就地改名）：官方这条路一个
    // 网关调用都不发（F-28 的 ② 已钉住「零打开请求」），所以在结构上不可能触发
    // `api-session/error`。不点「第一条非当前会话行」：那条会真去打开会话，在这台机器上可能
    // 正好点到一条被别人占着的会话——那是**功能正常**的表现，判据会跟着环境红。
    await setHostPanelSession(opened.page, true)
    const current = opened.page.locator('[data-dshone-tree-row="session"][aria-selected="true"]').first()
    if ((await current.count()) > 0) {
      await waitForQuiet(opened.page, 12_000)
      const beforeClick = await flashCount(opened.page)
      await current.click()
      await opened.page.waitForTimeout(1_200)
      check.eq('④ 点当前会话行照旧进就地改名（改名输入框出现一枚）', await opened.page.locator(RENAME_INPUT).count(), 1)
      check.eq('④ 点击前后提示计数不变（这条路不发网关调用，不可能触发那条错误）', await flashCount(opened.page), beforeClick)
      check.eq('④ 点击之后树上没有飘提示', await flashText(opened.page), '')
      await opened.page.keyboard.press('Escape')
      await opened.page.waitForTimeout(400)
      check.eq('④ Esc 取消后改名输入框收起（编辑态不留给后面）', await opened.page.locator(RENAME_INPUT).count(), 0)
      check.ok(
        '④ 点完之后树上仍有会话行（树没被这次订阅弄坏）',
        (await opened.page.locator('[data-dshone-tree-row="session"]').count()) > 0,
      )
    } else {
      check.fact('当天树上没有「当前会话行」，④ 的点击回归跳过（四条点击路径的语义由 F-28 覆盖）')
    }
    check.eq('全程零 pageerror', withoutKnownNoise(opened.capture.pageErrors).real, [])
    await opened.context.close()
    return screenshots
  },
}
