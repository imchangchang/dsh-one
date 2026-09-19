/**
 * git 卡片的工作目录取值：两路来源都必须留（#182，GIT-CARD-CWD 套件）。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与 `sidebarHScrollSuites.ts` /
 * `comboCacheKeySuites.ts` 同一条：那个文件是本批开发的合入热点，新套件放外面能少一半
 * 冲突面。注册方式是在 `suites.ts` 的 `SUITES` 末尾追加一项。
 *
 * ## 这一条抓的是什么
 *
 * #96 审计的 D7 给过一条收敛方向：git 卡片取会话工作目录时只留 `workspaces.list` 的
 * `path` 一路、去掉 `byId[current].cwd`。**#182 实测证明收不得**——工作区那一行的
 * `sessionIds` 只覆盖归属它的会话，另有两类会话根本不在册：
 *
 * - **子代理会话**（`parentId` 有值）：官方 `dsh-client-ui-subagent` 允许从会话头目录
 *   打开任一层子会话（它自己的读法就是「browse every subagent conversation beneath a
 *   parent session, open any descendant」），而它们绝大多数不在任何 `sessionIds` 里
 *   （本机 2026-09-18 只读普查：584 条子会话只有 25 条在册）；
 * - **未分组会话**：官方 `session/create` 用 `cwd`（而不是 `workspaceId`）建的会话按
 *   注册表的归属规则（ownership + cwd 事实）不属于任何工作区——我们侧栏「未分组」桶的
 *   ＋ 走的就是这条官方语义（`sessions.create({})`）。本机普查：107 条未分组会话
 *   （含 13 条 cwd 就是 dsh-one 仓库的）全部不在册。
 *
 * 这两类会话若只剩工作区一路，`git.show` 就不带 cwd，宿主回落到 VS Code 工作区目录。
 * 同一台临时 `DSH_HOME` 网关 + 真 git 的实测：未分组会话的提交在「会话自己那个目录」里
 * 查得到，收成一路后查询根变成 VS Code 打开的那个仓库、查不到。所以这一套件**钉住两路
 * 来源都在**：会话不属于任何工作区时，`git.show` 必须仍带会话自己的 cwd。
 *
 * ## 判据怎么做到不吃运行环境（#162 的硬约束）
 *
 * 四档现场全部由**页内数据集夹具**（`dataset.ts`，装的是页面收到的帧与回执）声明：
 * `session/list` 回执换成夹具会话、`workspace/follow` 基线帧换成夹具工作区。所以「会话
 * 属不属于某个工作区」「会话 cwd 与工作区 path 同不同值」这两件事由套件自己决定，日常
 * 实例整轮与 `--empty` 那一轮跑同一份判据（网关只读；夹具的会话不在网关上，官方客户端
 * 打不开它们时自己发的那条 `session/create` 由夹具就地回执）。
 *
 * 读数是**页面真的发给宿主的那条调用参数**（`__LAB_HOST__.gitShows`，假宿主按同一份协议
 * 记录），不是去猜插件内部状态——它正是决定宿主查询根与允许根的那一个值。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import type { Browser } from 'playwright'
import { openTreePage } from './harness.ts'
import { LAB_TREES, type LabServer, type LabTreeRoute } from './labServer.ts'
import type { LabDataset } from './dataset.ts'
// 只取类型（编译后不留 import，运行期没有环）：套件接口定义在 suites.ts 里。
import type { LabSuite } from './suites.ts'

const route = (name: string): LabTreeRoute => {
  const found = LAB_TREES.find((candidate) => candidate.route === name)
  if (found === undefined) throw new Error(`lab: unknown tree route ${name}`)
  return found
}

const CHAT_TREE = route('chat')

/** 正文夹具里的短 hash（扫描用的是同一个形状：7~40 位 hex）。 */
const FIXTURE_SHA = 'deadbee'

/** 夹具会话的更新时间（给官方列表一个稳定值，不参与判据）。 */
const UPDATED_AT = 1_700_000_000_000

/** 一档现场：会话 id + 数据集 + 该档期望的 cwd（以及「不是哪一路来源」）。 */
interface Scenario {
  /** 这一档的名字（进断言文案）。 */
  label: string
  /** 截图文件名后缀。 */
  slug: string
  sessionId: string
  dataset: LabDataset
  /** `git.show` 必须带的 cwd。 */
  expectCwd: string
  /** 另一路来源的值：断言「取的确实不是它」（没有另一路时省略）。 */
  otherSource?: string
}

/**
 * 四档现场：属工作区的会话（两路同值）、属工作区但两路异值、未分组会话、
 * 一个工作区都没有的会话。后两档是本次要守住的那一类。
 */
const SCENARIOS: readonly Scenario[] = [
  {
    label: '① 齐活：会话 cwd == 所属工作区 path',
    slug: 'same',
    sessionId: 'lab-gitcwd-01',
    dataset: {
      workspaces: [{ workspaceId: 'lab-ws-01', path: '/lab/gitcwd/one', title: 'One', sessionIds: ['lab-gitcwd-01'] }],
      sessions: [{ sessionId: 'lab-gitcwd-01', title: 'One task', cwd: '/lab/gitcwd/one', updatedAt: UPDATED_AT }],
    },
    expectCwd: '/lab/gitcwd/one',
  },
  {
    label: '② 两路异值：会话 cwd != 所属工作区 path',
    slug: 'divergent',
    sessionId: 'lab-gitcwd-02',
    dataset: {
      workspaces: [{ workspaceId: 'lab-ws-02', path: '/lab/gitcwd/two-workspace', title: 'Two', sessionIds: ['lab-gitcwd-02'] }],
      sessions: [{ sessionId: 'lab-gitcwd-02', title: 'Two task', cwd: '/lab/gitcwd/two-subdir', updatedAt: UPDATED_AT }],
    },
    // 优先序 = 会话自己那一份优先（那是 agent 真正的工作目录；真实数据里成员会话两路
    // 必同值——官方建会话走 workspaceId 那条路时 cwd 直接取 workspace.path，见
    // src/pure/sessionWorkspace.ts 的文件头）。这一档是夹具造出来把优先序钉住的。
    expectCwd: '/lab/gitcwd/two-subdir',
    otherSource: '/lab/gitcwd/two-workspace',
  },
  {
    label: '③ 未分组：会话不属于任何工作区',
    slug: 'ungrouped',
    sessionId: 'lab-gitcwd-03',
    dataset: {
      workspaces: [{ workspaceId: 'lab-ws-03', path: '/lab/gitcwd/three', title: 'Three', sessionIds: [] }],
      sessions: [{ sessionId: 'lab-gitcwd-03', title: 'Three task', cwd: '/lab/gitcwd/three-ungrouped', updatedAt: UPDATED_AT }],
    },
    expectCwd: '/lab/gitcwd/three-ungrouped',
    otherSource: '/lab/gitcwd/three',
  },
  {
    label: '④ 工作区注册表为空',
    slug: 'no-workspace-row',
    sessionId: 'lab-gitcwd-04',
    dataset: {
      workspaces: [],
      sessions: [{ sessionId: 'lab-gitcwd-04', title: 'Four task', cwd: '/lab/gitcwd/four', updatedAt: UPDATED_AT }],
    },
    expectCwd: '/lab/gitcwd/four',
  },
]

/** 页面里 git 卡片发出的 `git.show` 参数（假宿主按协议记下来的那一份）。 */
interface GitShowReading {
  /** 装饰出的 hash 标记数（0 = 页面没走到可测状态）。 */
  decorated: number
  /** `git.show` 的调用次数。 */
  calls: number
  /** 最后一次调用的参数（没调用时 null）。 */
  last: { hash?: string; cwd?: string } | null
  /** 这一页的 pageerror 条数（夹具会话打不开时官方自己会有噪音，故只记事实）。 */
  pageErrors: number
}

/**
 * 开一档现场、把带 hash 的正文塞进官方对话区容器、悬停那枚 hash，读 `git.show` 参数，
 * 顺手出一张截图。
 *
 * 夹具正文必须落在官方容器（`[data-conversation-scroll]`）里：git 卡片的扫描与事件委托
 * 就挂在那个容器上，塞在别处测的是「夹具放错地方」。正文用夹具而不是真语料，理由与
 * `suites.ts` 的 F-03 同一条——真模型输出不可复现，而插件行为只依赖 DOM 形状。
 */
async function probeScenario(
  ctx: { browser: Browser; lab: LabServer; shots: string },
  scenario: Scenario,
): Promise<{ reading: GitShowReading; screenshot: string }> {
  const opened = await openTreePage(ctx.browser, ctx.lab, CHAT_TREE, {
    width: 1200,
    dataset: scenario.dataset,
    sessionId: scenario.sessionId,
  })
  try {
    const { page } = opened
    await page.evaluate((sha: string) => {
      const host = document.querySelector('[data-conversation-scroll]')
      if (host === null) return
      const box = document.createElement('div')
      box.setAttribute('data-lab-fixture', 'message')
      const paragraph = document.createElement('p')
      paragraph.append(`see commit ${sha} and run `)
      const code = document.createElement('code')
      code.textContent = 'lab inline code'
      paragraph.append(code, ' afterwards')
      box.append(paragraph)
      host.append(box)
    }, FIXTURE_SHA)
    // 扫描是 MutationObserver + 120ms 去抖；悬停之后 git.show 才是一次能力口调用。
    await page.waitForTimeout(600)
    const decorated = await page.evaluate(
      (sha: string) => document.querySelectorAll(`[data-dshone-commit="${sha}"]`).length,
      FIXTURE_SHA,
    )
    if (decorated > 0) {
      await page.hover(`[data-dshone-commit="${FIXTURE_SHA}"]`)
      await page.waitForTimeout(500)
    }
    const calls = await page.evaluate(() => {
      const host = (globalThis as { __LAB_HOST__?: { gitShows?: Array<{ hash?: string; cwd?: string }> } }).__LAB_HOST__
      const shows = host?.gitShows ?? []
      return { count: shows.length, last: (shows[shows.length - 1] ?? null) as { hash?: string; cwd?: string } | null }
    })
    const file = path.join(ctx.shots, `gitcard-cwd-${scenario.slug}.png`)
    await fsp.mkdir(ctx.shots, { recursive: true })
    await page.screenshot({ path: file })
    return {
      reading: { decorated, calls: calls.count, last: calls.last, pageErrors: opened.capture.pageErrors.length },
      screenshot: file,
    }
  } finally {
    await opened.context.close()
  }
}

export const GIT_CARD_CWD_SUITE: LabSuite = {
  id: 'F-60',
  phase: 'new-feature',
  name: 'git 卡片的工作目录取值：两路来源都必须留（GIT-CARD-CWD 套件）',
  expect:
    'chat 树四档现场（全部由页内数据集夹具声明，不吃当天数据）：① 会话 cwd == 所属工作区 path → `git.show` 带这个路径；② 会话 cwd != 所属工作区 path（会话仍在工作区名下）→ 带**会话自己那一份**（两路来源的优先序钉住）；③ 会话不属于任何工作区（官方 `session/create {cwd}` 那条语义 = 我们侧栏「未分组」桶的 ＋）→ **仍带会话自己的 cwd**（#182 的核心判据：把来源收成 `workspaces.list` 一路会让这一档丢 cwd，宿主随即回落到 VS Code 工作区目录）；④ 工作区注册表空 → 仍带会话自己的 cwd。四档都要真的发出过一次 `git.show`（hash 与被装饰的那一枚一致、次数恰好 1），截图各一张；每一页另记下 pageerror 条数作为事实（夹具会话不在网关上，官方客户端自己那条失败噪音不属本判据）。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    for (const scenario of SCENARIOS) {
      const { reading, screenshot } = await probeScenario(ctx, scenario)
      screenshots.push(screenshot)
      check.fact(
        `${scenario.label}：装饰标记=${String(reading.decorated)} git.show 次数=${String(reading.calls)} 参数=${JSON.stringify(reading.last)} pageerror=${String(reading.pageErrors)}`,
      )
      check.ok(
        `${scenario.label}：正文里的 hash 被装饰（页面进到可测状态）`,
        reading.decorated === 1,
        `decorated=${String(reading.decorated)}`,
      )
      const last = reading.last
      check.ok(
        `${scenario.label}：恰好一次 git.show，hash 就是被装饰的那一枚`,
        last !== null && reading.calls === 1 && last.hash === FIXTURE_SHA,
        `calls=${String(reading.calls)} last=${JSON.stringify(last)}`,
      )
      check.eq(`${scenario.label}：git.show 带的 cwd`, last?.cwd ?? null, scenario.expectCwd)
      if (scenario.otherSource !== undefined) {
        check.ok(
          `${scenario.label}：取的不是另一路来源`,
          last?.cwd !== scenario.otherSource,
          `cwd=${JSON.stringify(last?.cwd ?? null)} other=${scenario.otherSource}`,
        )
      }
    }
    return screenshots
  },
}
