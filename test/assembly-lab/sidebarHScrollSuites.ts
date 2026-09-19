/**
 * 侧栏树容器**不可横滚**（#130，SIDEBAR-NO-HSCROLL 套件）。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与 `topbarRhythmSuites.ts` /
 * `topbarRightInsetSuites.ts` 同一条：那个文件是本批开发的合入热点，新套件放外面能少一半
 * 冲突面。注册方式是在 `suites.ts` 的 `SUITES` 末尾追加一项。
 *
 * ## 这一条抓的是什么
 *
 * 用户实测（#130）：点过顶栏右侧那几枚按钮之后，整棵树（搜索框、分组胶囊、列表行）一起
 * 左移 4px，Esc、失焦都不回位。根因是**容器自己是个横向滚动容器**：顶栏那一行带官方分节头
 * 的 `margin-right:-4px`（右出血，盒子右缘比容器 content 右缘多 4px），于是
 * `.dshOneTree_root` 的 `scrollWidth/clientWidth` 是 343/339——`overflow:hidden` 只挡视觉、
 * 不消滚动范围。只要有什么东西把内容拖进那 4px 带（点击前的 `scrollIntoViewIfNeeded`、
 * 程序化 `scrollIntoView`、脚本赋值），最近的可滚动祖先（就是它）就滚 4px 去露出它。
 *
 * 修法是让这一层**不建立滚动容器**（`overflow:clip`，见 `styles.ts` 那条规则上方的推导），
 * 出血形态一分未动。所以本套件判的是三件事，一件都不能省：
 *
 * 1. **可滚范围真的是零**——把 `scrollLeft` 置 999 读回 0。这是**行为判据**，不是看
 *    `scrollWidth`：`overflow:clip` 下 Chromium 照旧报 `scrollWidth = clientWidth + 4`
 *    （实测），所以「量 scrollWidth」这条路判不出修没修好。
 * 2. **用户那几条路径读到的都是 0，且左缘读数一字不动**——逐枚顶栏控件拿焦点、
 *    「选择多个」进入 / 退出（点按钮退出、Esc 退出两条路）各量一遍，三档宽度 260/340/500
 *    各来一轮；左缘用分组胶囊与搜索框（这两件一定在）当见证，列表行在时一并量。
 * 3. **负向对照：把内容真正推过裁切边，可滚范围也不许回来**——页面侧把那一行的右内缩去掉
 *    （= #142 之前的形态），最右那枚控件于是越过裁切边（夹具自证：它的右缘 − 容器 content
 *    右缘 > 0），再点一次它：改前这一步 `root.scrollLeft` 实测 4，改后必须是 0。这一条让
 *    上面两条不至于「因为内容恰好都在里面」而空过——只要可滚范围还在，换个布局就会再犯。
 *
 * 「出血形态没变」也在这里正面钉一遍：那一行的**盒子**右缘 = 容器 content 右缘 + 它自己的
 * 右外边距（从 computed style 读，不写死 4px）。盒子那条口径的正主是 F-35 ④ / F-44 ③，
 * 本套件只做同一件事的自证，不改它们的期望。
 *
 * 只读边界：真网关**只读** + 假宿主，全程只点顶栏那几枚控件（点「设置」走宿主能力口、
 * 假宿主只记录），不点会话行（那会真的到网关开会话）。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { openTreePage, withoutKnownNoise, type OpenedPage } from './harness.ts'
import { LAB_TREES, type LabTreeRoute } from './labServer.ts'
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

const ROOT = '.dshOneTree_root'
const TOP_BAR = '[data-dshone-tree="top-bar"]'
const PILL = '.dshOneTree_filterBar'
const SEARCH_BOX = '[data-dshone-tree="search-box"]'
const PROJECT_ROW = '.dshOneTree_projectRow'
const SELECTION_BAR = '[data-dshone-tree="selection-bar"]'
/**
 * 顶栏右侧那几枚控件（量焦点路径时逐枚走一遍）。顺序 = 页面上从左到右，最右一枚是
 * 「选择多个」——#130 报的就是点它（用户报的另一枚「视图选项」已被 #131 退役）。
 */
const TOP_ACTIONS = ['collapse-all', 'add-workspace', 'settings', 'select-mode'] as const
const RIGHTMOST_ACTION = 'select-mode'

/** 三档宽度（与 F-29 / F-31 / F-35 / F-44 同一套：窄 / 用户侧栏 / 宽）。 */
const WIDTHS = [260, 340, 500] as const
/** 左缘「没动」的容差（半像素与亚像素舍入；被横滚时是整整 4px，差一个量级）。 */
const STILL_TOLERANCE = 0.5
/** `scrollLeft` 探针往这个值上推：推得动就说明这一层还是横向滚动容器。 */
const SCROLL_PROBE = 999

const round1 = (value: number): number => Math.round(value * 10) / 10

interface Reading {
  /** 容器的 content 右缘（= 盒子右缘 − 右内边距）：那一行的出血以它为基准。 */
  contentRight: number
  /** 顶栏那一行的盒子右缘。 */
  topBarRight: number
  /** 那一行的右外边距（负数 = 出血；「盒子右缘 − content 右缘」按它判）。 */
  topBarMarginRight: number
  /** 容器的横滚量（判定用读数之一）。 */
  scrollLeft: number
  /** 容器的解析 `overflow-x`（`clip` = 修好后的形态，`hidden` = 旧形态）。 */
  overflowX: string
  /** 分量：`scrollWidth` / `clientWidth`（只记事实——clip 下 Chromium 照旧报溢出）。 */
  scrollWidth: number
  clientWidth: number
  /** 三处左缘（搜索框与胶囊一定在；列表行在没有工作区数据时为 null）。 */
  searchLeft: number
  pillLeft: number
  rowLeft: number | null
  /** 这一刻在选择态吗（判「进出两条路径」用）。 */
  selectMode: boolean
}

/** 量一次当前状态（不改任何东西）。 */
async function readState(page: OpenedPage['page']): Promise<Reading> {
  return page.evaluate(
    ([rootSelector, topBarSelector, pillSelector, searchSelector, rowSelector, selectionBarSelector]) => {
      const round = (value: number): number => Math.round(value * 100) / 100
      const root = document.querySelector(rootSelector)
      const topBar = document.querySelector(topBarSelector)
      if (!(root instanceof HTMLElement) || !(topBar instanceof HTMLElement)) {
        throw new Error('lab: sidebar tree root / top bar missing')
      }
      const rootBox = root.getBoundingClientRect()
      const rootStyle = getComputedStyle(root)
      const leftOf = (selector: string): number | null => {
        const element = document.querySelector(selector)
        return element === null ? null : round(element.getBoundingClientRect().left)
      }
      return {
        contentRight: round(rootBox.right - Number.parseFloat(rootStyle.paddingRight)),
        topBarRight: round(topBar.getBoundingClientRect().right),
        topBarMarginRight: round(Number.parseFloat(getComputedStyle(topBar).marginRight)),
        scrollLeft: round(root.scrollLeft),
        overflowX: rootStyle.overflowX,
        scrollWidth: root.scrollWidth,
        clientWidth: root.clientWidth,
        searchLeft: leftOf(searchSelector) ?? Number.NaN,
        pillLeft: leftOf(pillSelector) ?? Number.NaN,
        rowLeft: leftOf(rowSelector),
        selectMode: document.querySelector(selectionBarSelector) !== null,
      }
    },
    [ROOT, TOP_BAR, PILL, SEARCH_BOX, PROJECT_ROW, SELECTION_BAR] as const,
  )
}

/** 把容器的 `scrollLeft` 往 {@link SCROLL_PROBE} 上推，读回它实际能到的量（推完复位）。 */
async function probeScrollability(page: OpenedPage['page']): Promise<number> {
  return page.evaluate(
    ([rootSelector, probe]) => {
      const root = document.querySelector(rootSelector)
      if (!(root instanceof HTMLElement)) throw new Error('lab: sidebar tree root missing')
      root.scrollLeft = probe
      const reached = Math.round(root.scrollLeft * 100) / 100
      root.scrollLeft = 0
      return reached
    },
    [ROOT, SCROLL_PROBE] as const,
  )
}

/** 页面侧装上 / 撤掉一段样式（负向对照用；与 F-44 的浮层滚动条夹具同一处置）。 */
async function setFixtureStyle(page: OpenedPage['page'], css: string): Promise<void> {
  await page.evaluate((text) => {
    let tag = document.getElementById('dshone-lab-hscroll-fixture')
    if (tag === null) {
      tag = document.createElement('style')
      tag.id = 'dshone-lab-hscroll-fixture'
      document.head.appendChild(tag)
    }
    tag.textContent = text
  }, css)
}

/** 三处左缘是否一字没动（被横滚 4px 时它们会一起差 4px）。 */
function leftEdgesMoved(before: Reading, after: Reading): string[] {
  const moved: string[] = []
  const compare = (name: string, a: number | null, b: number | null): void => {
    if (a === null || b === null) return
    if (Math.abs(a - b) > STILL_TOLERANCE) moved.push(`${name}: ${String(a)} → ${String(b)}`)
  }
  compare('搜索框左缘', before.searchLeft, after.searchLeft)
  compare('分组胶囊左缘', before.pillLeft, after.pillLeft)
  compare('列表行盒左缘', before.rowLeft, after.rowLeft)
  return moved
}

export const SIDEBAR_NO_HSCROLL_SUITE: LabSuite = {
  id: 'F-56',
  phase: 'new-feature',
  name: '侧栏树容器不可横滚：点过顶栏右侧按钮后整棵树不再左移 4px（#130，SIDEBAR-NO-HSCROLL 套件）',
  expect:
    '真装配页（真网关**只读** + 假宿主）、260/340/500 三档宽度下判三件事。① **可滚范围为零**——把 `.dshOneTree_root` 的 `scrollLeft` 置 999 读回 0（`overflow:hidden` 只挡视觉、容器仍是滚动容器，改前实测能到 4）；同时把 `scrollWidth/clientWidth` 记进事实（`overflow:clip` 下 Chromium 照旧报 `clientWidth + 4`，所以**判定不能靠 `scrollWidth`**）。② **用户那几条路径读到的都是 0，且左缘一字没动**——顶栏右侧四枚控件（折叠全部 / 添加工作区 / 设置 / 选择多个）逐枚 `focus()` 后读一遍；「选择多个」进入选择态 → 退出（动作条上的「退出选择」、再点同一枚按钮切换，两条路）各读一遍；每次都比搜索框左缘、分组胶囊左缘、列表行盒左缘（行存在时）与基线是否一字不差（容差 ±0.5px，被横滚是整整 4px）。③ **负向对照：把内容真正推过裁切边，可滚范围也不许回来**——页面侧去掉那一行的右内缩（= #142 之前的形态），最右那枚控件的右缘于是越过容器 content 右缘（夹具先自证越过去了），此刻再点它一次：改前实测 `root.scrollLeft = 4`（并把整棵树左移 4px），改后必须是 0，且这一刻容器仍不可横滚。另外正面钉一遍**出血形态没变**：顶栏那一行的盒子右缘 − 容器 content 右缘 = 它自己的右外边距（从 computed style 读出的负值，不写死 4px）。**顺带一条回归钉子**：容器的裁切方式变了之后，列表自己的纵向滚动照旧（矮窗口下列表真的能滚，`scrollTop` 推得动）。全程零 pageerror。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const opened = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { width: 340, height: 900 })
    const { page } = opened
    try {
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 })
        await page.waitForTimeout(350)
        const base = await readState(page)
        check.fact(
          `w=${String(width)}：容器 ${base.overflowX}/解析后 clientWidth ${String(base.clientWidth)}、scrollWidth ${String(base.scrollWidth)}；` +
            `顶栏盒子右缘 ${String(base.topBarRight)}、容器 content 右缘 ${String(base.contentRight)}；` +
            `左缘基线 搜索框 ${String(base.searchLeft)} / 胶囊 ${String(base.pillLeft)} / 行盒 ${base.rowLeft === null ? '（这一轮没有工作区行）' : String(base.rowLeft)}`,
        )

        // ---- ① 出血形态没变（正面自证；正主是 F-35 ④ / F-44 ③） ----
        check.eq(
          `w=${String(width)}：出血形态没变——顶栏那一行的盒子右缘 − 容器 content 右缘 = 它自己的右外边距（${String(base.topBarMarginRight)}px，官方分节头的出血）`,
          round1(base.topBarRight - base.contentRight),
          round1(-base.topBarMarginRight),
        )

        // ---- ② 可滚范围为零（行为判据） ----
        const reachable = await probeScrollability(page)
        check.eq(
          `w=${String(width)}：容器不是横向滚动容器——把 scrollLeft 置 ${String(SCROLL_PROBE)} 读回 0`,
          reachable,
          0,
        )

        // ---- ③ 顶栏右侧逐枚控件拿到焦点 ----
        for (const action of TOP_ACTIONS) {
          const focused = await page.evaluate(
            ([rootSelector, name]) => {
              const root = document.querySelector(rootSelector)
              if (!(root instanceof HTMLElement)) return 'root missing'
              root.scrollLeft = 0
              const button = document.querySelector(`[data-dshone-tree-action="${name}"]`)
              if (!(button instanceof HTMLElement)) return 'button missing'
              button.focus()
              const active = document.activeElement
              return active === button ? 'ok' : 'focus refused'
            },
            [ROOT, action] as const,
          )
          await page.waitForTimeout(80)
          const after = await readState(page)
          check.ok(
            `w=${String(width)}：顶栏「${action}」拿到焦点（不是空转）`,
            focused === 'ok',
            focused,
          )
          check.eq(
            `w=${String(width)}：「${action}」获得焦点后容器没被横滚`,
            after.scrollLeft,
            0,
          )
          check.eq(
            `w=${String(width)}：「${action}」获得焦点后三处左缘没动`,
            leftEdgesMoved(base, after),
            [],
          )
        }
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())

        // ---- ④ 选择态：进入 → 从动作条退出 → 再进入 → 点同一枚按钮退出 ----
        // 退出有两条路（都走一遍）：顶栏那一枚按钮是切换开关，动作条右端那枚「退出选择」
        // 是就地退出；选择态**不认 Esc**（那一条不在这里判，免得把另一件事的期望塞进来）。
        const paths: { label: string; step: () => Promise<void>; expectSelect: boolean }[] = [
          {
            label: '点「选择多个」进入选择态',
            step: async () => {
              await page.click('[data-dshone-tree-action="select-mode"]')
            },
            expectSelect: true,
          },
          {
            label: '点动作条上的「退出选择」退出',
            step: async () => {
              await page.click('[data-dshone-tree-action="selection-exit"]')
            },
            expectSelect: false,
          },
          {
            label: '再次点「选择多个」进入选择态',
            step: async () => {
              await page.click('[data-dshone-tree-action="select-mode"]')
            },
            expectSelect: true,
          },
          {
            label: '再点同一枚按钮退出选择态',
            step: async () => {
              await page.click('[data-dshone-tree-action="select-mode"]')
            },
            expectSelect: false,
          },
        ]
        for (const path of paths) {
          await path.step()
          await page.waitForTimeout(300)
          const after = await readState(page)
          check.eq(`${width}px·${path.label}：选择态状态与预期一致`, after.selectMode, path.expectSelect)
          check.eq(`${width}px·${path.label}：容器没被横滚`, after.scrollLeft, 0)
          check.eq(`${width}px·${path.label}：搜索框 / 胶囊 / 行的左缘一字没动`, leftEdgesMoved(base, after), [])
        }
        screenshots.push(await shot(ctx, page, `sidebar-hscroll-select-${String(width)}`))

        // ---- ⑤ 负向对照：把内容真正推过裁切边，可滚范围也不许回来 ----
        await setFixtureStyle(page, '.dshOneTree_sectionHeader{padding-right:0 !important}')
        await page.waitForTimeout(200)
        const pushed = await page.evaluate(
          ([rootSelector, topBarSelector, name]) => {
            const root = document.querySelector(rootSelector)
            const topBar = document.querySelector(topBarSelector)
            if (!(root instanceof HTMLElement) || !(topBar instanceof HTMLElement)) return null
            root.scrollLeft = 0
            const button = document.querySelector(`[data-dshone-tree-action="${name}"]`)
            if (!(button instanceof HTMLElement)) return null
            const contentRight = root.getBoundingClientRect().right - Number.parseFloat(getComputedStyle(root).paddingRight)
            return {
              overhang: Math.round((button.getBoundingClientRect().right - contentRight) * 100) / 100,
              barOverhang: Math.round((topBar.getBoundingClientRect().right - contentRight) * 100) / 100,
            }
          },
          [ROOT, TOP_BAR, RIGHTMOST_ACTION] as const,
        )
        check.ok(
          `w=${String(width)}：负向对照的夹具真的把最右一枚控件推过了裁切边（否则这一条是空转）`,
          pushed !== null && pushed.overhang > 0,
          JSON.stringify(pushed),
        )
        if (width === 340) screenshots.push(await shot(ctx, page, 'sidebar-hscroll-pushed-340'))
        // 这一态的基线：夹具把那一行的右内缩去掉了，几处左缘会跟着变（搜索框往右挪一格），
        // 所以「没动」要与**这一刻**比，不能与夹具之前的读数比。
        const pushedBase = await readState(page)
        await page.click(`[data-dshone-tree-action="${RIGHTMOST_ACTION}"]`)
        await page.waitForTimeout(300)
        const pushedAfter = await readState(page)
        check.eq(
          `${width}px·把右内缩去掉（#142 之前的形态）后点最右一枚按钮：容器没被横滚（改前实测这里是 4）`,
          pushedAfter.scrollLeft,
          0,
        )
        check.eq(
          `${width}px·这一刻容器仍不可横滚（把 scrollLeft 置 ${String(SCROLL_PROBE)} 读回 0）`,
          await probeScrollability(page),
          0,
        )
        check.eq(
          `${width}px·这一刻三处左缘仍与这一态的基线一致（内容被推出裁切边也没换来 4px 左移）`,
          leftEdgesMoved(pushedBase, pushedAfter),
          [],
        )
        // 退出选择态（点同一枚按钮），再把夹具撤掉
        await page.click(`[data-dshone-tree-action="${RIGHTMOST_ACTION}"]`)
        await page.waitForTimeout(200)
        await setFixtureStyle(page, '')
        await page.waitForTimeout(200)
        const restored = await readState(page)
        check.eq(
          `${width}px·撤掉夹具后这一行回到带内缩的形态（盒子右缘仍在 content 右缘之外 4px）`,
          round1(restored.topBarRight - restored.contentRight),
          round1(-restored.topBarMarginRight),
        )
      }

      // ---- ⑥ 回归钉子：容器改成 clip 之后，列表自己的纵向滚动照旧 ----
      const tall = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { width: 340, height: 420 })
      try {
        const list = await tall.page.evaluate(() => {
          const element = document.querySelector('.dshOneTree_list')
          if (!(element instanceof HTMLElement)) return null
          element.scrollTop = 60
          return {
            scrollTop: Math.round(element.scrollTop),
            scrollHeight: element.scrollHeight,
            clientHeight: element.clientHeight,
          }
        })
        check.ok(
          '矮窗口下列表自己照旧能纵向滚（容器的裁切方式变了，但滚动容器仍是 .dshOneTree_list）',
          list !== null && list.scrollHeight > list.clientHeight && list.scrollTop > 0,
          JSON.stringify(list),
        )
        check.eq(
          '矮窗口下容器同样不可横滚',
          await probeScrollability(tall.page),
          0,
        )
        check.eq('侧栏不可横滚套件全程零 pageerror', withoutKnownNoise(tall.capture.pageErrors).real, [])
      } finally {
        await tall.context.close()
      }
    } finally {
      await opened.context.close()
    }
    return screenshots
  },
}
