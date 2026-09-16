/**
 * 顶栏 / 分组过滤条一带的纵向留白（#119）。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与 `recycleEntrySuites.ts` / `driftSuites.ts`
 * 同一条：那个文件是本批开发的合入热点，新套件放外面能少一半冲突面。注册方式是在
 * `suites.ts` 的 `SUITES` 末尾追加一项。
 *
 * 本套件量的是**实际缝隙**（两个盒子的边到边的距离，按几何矩形算，不靠截图看）：顶栏那一行
 * 与分组过滤条之间、分组过滤条与列表首行之间。判据分两半，正是 #119 确立的分工——
 * **纵向留白取官方节奏（4px）、横向仍取紧凑档（2px）**。横向那一半不能只看纵向变好就算数：
 * 这次改动只该动纵向，横向被顺手改宽同样是回归，所以两组数一起量、一起断言。
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

const TOP_BAR = '[data-dshone-tree="top-bar"]'
const FILTER_BAR = '.dshOneTree_filterBar'
const LIST = '.dshOneTree_list'
const FRAME = '[class*="dshOneSidebarShell_frame"]'

/** 密度变量在哪几处用上了（报告里要能一眼看出读数是不是真来自那套变量）。 */
const GAP_VARS = ['section-header-gap', 'group-gap', 'section-gap'] as const

interface RhythmReading {
  /** 顶栏那一行与分组过滤条之间的实际缝隙 = 过滤条上沿 − 顶栏下沿（纵向留白）。 */
  topBarToFilterBar: number
  /** 分组过滤条与列表首行之间的实际缝隙 = 首行上沿 − 过滤条下沿（纵向留白）。 */
  filterBarToFirstRow: number
  /** 顶栏那一行的行内横向间隙（= `--dsh-one-density-section-gap`，横向）。 */
  topBarColumnGap: number
  filterBarColumnGap: number
  /** frame 上那三个密度变量的当前取值（原文，含单位）。 */
  vars: Record<string, string>
}

/**
 * 量一次当前状态下的缝隙与行内间隙。元素不在（这一轮没有过滤条 / 列表空）就返回 null，
 * 由调用方按事实记一笔——本套件不把「网关这轮没数据」判成失败。
 */
async function readRhythm(page: OpenedPage['page']): Promise<RhythmReading | null> {
  return page.evaluate(
    ([topBarSelector, filterBarSelector, listSelector, frameSelector, vars]) => {
      const topBar = document.querySelector(topBarSelector)
      const filterBar = document.querySelector(filterBarSelector)
      const list = document.querySelector(listSelector)
      const firstRow = list?.firstElementChild ?? null
      const frame = document.querySelector(frameSelector)
      if (topBar === null || filterBar === null || firstRow === null || frame === null) return null
      const round = (value: number): number => Math.round(value * 100) / 100
      const frameVars: Record<string, string> = {}
      for (const key of vars) {
        frameVars[key] = getComputedStyle(frame).getPropertyValue(`--dsh-one-density-${key}`).trim()
      }
      return {
        topBarToFilterBar: round(filterBar.getBoundingClientRect().top - topBar.getBoundingClientRect().bottom),
        filterBarToFirstRow: round(firstRow.getBoundingClientRect().top - filterBar.getBoundingClientRect().bottom),
        topBarColumnGap: round(Number.parseFloat(getComputedStyle(topBar).columnGap)),
        filterBarColumnGap: round(Number.parseFloat(getComputedStyle(filterBar).columnGap)),
        vars: frameVars,
      }
    },
    [TOP_BAR, FILTER_BAR, LIST, FRAME, GAP_VARS as unknown as string[]] as const,
  )
}

/**
 * 把自有页的密度变量按树插件自己声明的官方兜底值内联回 frame（= 官方档）。与 F-13 的
 * `applyOfficialDensity` 同一处置、同一读法（`var(--dsh-one-density-x, <官方原值>)` 的第二个
 * 参数就是「没人给偏好」时的值）；这里另抄一份是因为两套件在两个文件里，直接互相 import 会在
 * `suites.ts` 与独立套件文件之间绕出一个运行期环（其它独立套件只 `import type`，正为此）。
 */
async function applyOfficialDensity(page: OpenedPage['page']): Promise<number> {
  return page.evaluate(
    ([frameSelector]) => {
      const treeCss =
        Array.from(document.querySelectorAll('style[data-plugin]'))
          .find((element) => element.getAttribute('data-plugin') === '@dsh-one/dsh-workspace-tree')
          ?.textContent ?? ''
      const fallbacks = Array.from(treeCss.matchAll(/var\(--dsh-one-density-([a-z-]+),\s*([^)]+)\)/g))
      const frame = document.querySelector(frameSelector)
      if (frame === null) return -1
      frame.setAttribute('data-lab-density-backup', frame.getAttribute('style') ?? '')
      for (const match of fallbacks) {
        const inline = `${frame.getAttribute('style') ?? ''};--dsh-one-density-${match[1] ?? ''}:${(match[2] ?? '').trim()}`
        frame.setAttribute('style', inline)
      }
      return fallbacks.length
    },
    [FRAME] as const,
  )
}

/** 撤掉 {@link applyOfficialDensity} 的内联，让页面回到宿主给的 VS Code 档。 */
async function restoreDensity(page: OpenedPage['page']): Promise<void> {
  await page.evaluate(
    ([frameSelector]) => {
      const frame = document.querySelector(frameSelector)
      if (frame === null) return
      const backup = frame.getAttribute('data-lab-density-backup')
      if (backup === null) return
      frame.removeAttribute('data-lab-density-backup')
      if (backup === '') frame.removeAttribute('style')
      else frame.setAttribute('style', backup)
    },
    [FRAME] as const,
  )
}

export const TOPBAR_RHYTHM_SUITE: LabSuite = {
  id: 'F-26',
  phase: 'new-feature',
  name: '顶栏 / 分组过滤条一带：纵向留白取官方节奏、横向仍紧凑（#119，TOPBAR-RHYTHM 套件）',
  expect:
    '真实装配页上（真网关**只读** + 假宿主）、260/340/500 三档宽度下量「实际缝隙」（两个盒子的几何矩形边到边的距离，不靠截图）：① **顶栏那一行与分组过滤条之间、分组过滤条与列表首行之间都是 4px**——按 #119 确立的分工，纵向留白取官方节奏（官方 `.bhn1Oq_sectionHeader{margin-bottom:4px}` 与 `.bhn1Oq_groupSection+.bhn1Oq_groupSection{margin-top:4px}`），#113 档位化时被跟着横向一起砍成 2px 的那两处要回到 4px；② **横向仍是紧凑档**：同一行里顶栏与过滤条的 `column-gap` 读数是 2px（紧凑档的容器内边距），不比官方原值宽——这次只恢复纵向，横向被顺手改宽同样是回归；③ 把密度变量对齐回树插件自己声明的官方兜底值后，**纵向缝隙仍是 4px**（纵向两项的 VS Code 档就是官方原值）、**横向间隙变成官方的 4px**（证明这组读数真的来自那套密度变量，不是量到了别的东西），对齐后撤销内联、页面回到 VS Code 档；④ frame 上 `--dsh-one-density-section-header-gap` / `--dsh-one-density-group-gap` 是 4px、`--dsh-one-density-section-gap` 是 2px，与上面三组读数一一对上。全程零 pageerror。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const widths = [260, 340, 500] as const
    const opened = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { width: 380, height: 900 })
    const { page } = opened
    try {
      const initial = await readRhythm(page)
      check.ok(
        '量法成立：顶栏那一行、分组过滤条、列表首行三个盒子都在（网关这一轮有工作区数据）',
        initial !== null,
        JSON.stringify(initial),
      )
      if (initial === null) {
        check.fact('这一轮网关数据里没有可量的列表首行——本套件的缝隙断言无法执行')
      } else {
        check.fact(
          `初始（w=380，VS Code 档）读数：顶栏→过滤条 ${String(initial.topBarToFilterBar)}px、过滤条→首行 ${String(initial.filterBarToFirstRow)}px；` +
            `顶栏行内间隙 ${String(initial.topBarColumnGap)}px、过滤条行内间隙 ${String(initial.filterBarColumnGap)}px`,
        )
        check.fact(
          `frame 上的密度变量：${GAP_VARS.map((key) => `${key}=${initial.vars[key] ?? ''}`).join(' ')}`,
        )

        // ---- ① + ② 三档宽度下：纵向 4px（官方节奏）、横向 2px（紧凑档） ----
        for (const width of widths) {
          await page.setViewportSize({ width, height: 900 })
          await page.waitForTimeout(300)
          const reading = await readRhythm(page)
          if (reading === null) {
            check.fact(`w=${String(width)}：这一轮没有可量的元素——跳过`)
            continue
          }
          check.eq(
            `w=${String(width)}：顶栏那一行与分组过滤条之间的实际缝隙 = 官方节奏 4px`,
            reading.topBarToFilterBar,
            4,
          )
          check.eq(
            `w=${String(width)}：分组过滤条与列表首行之间的实际缝隙 = 官方节奏 4px`,
            reading.filterBarToFirstRow,
            4,
          )
          check.eq(
            `w=${String(width)}：横向没被顺带改宽——顶栏行内间隙仍是紧凑档的 2px`,
            reading.topBarColumnGap,
            2,
          )
          check.eq(
            `w=${String(width)}：横向没被顺带改宽——过滤条行内间隙仍是紧凑档的 2px`,
            reading.filterBarColumnGap,
            2,
          )
        }

        // ---- ③ 对齐到官方兜底值：纵向不变（本来就是官方值）、横向变大（证明读数来自变量） ----
        await page.setViewportSize({ width: 380, height: 900 })
        await page.waitForTimeout(200)
        const compact = await readRhythm(page)
        screenshots.push(await shot(ctx, page, 'topbar-rhythm-compact-380'))
        const aligned = await applyOfficialDensity(page)
        check.ok(
          '密度变量对齐到官方兜底值（内联项数 > 0，页面确实在用那组变量）',
          aligned >= 20,
          `内联项数=${String(aligned)}`,
        )
        await page.waitForTimeout(200)
        const official = await readRhythm(page)
        screenshots.push(await shot(ctx, page, 'topbar-rhythm-official-380'))
        await restoreDensity(page)
        await page.waitForTimeout(150)
        const restored = await readRhythm(page)
        const compactFacts = { compact, official, restored }
        check.ok(
          '对齐与撤销两轮都量到了元素',
          compactFacts.compact !== null && compactFacts.official !== null && compactFacts.restored !== null,
          JSON.stringify(compactFacts),
        )
        if (compact !== null && official !== null && restored !== null) {
          check.eq(
            '对齐到官方档后纵向缝隙不变（纵向两项的 VS Code 档就是官方原值 4px）',
            [official.topBarToFilterBar, official.filterBarToFirstRow],
            [4, 4],
          )
          check.eq(
            '对齐到官方档后横向间隙变宽（2px → 官方的 4px）——说明这两组读数来自那套密度变量',
            [compact.topBarColumnGap, compact.filterBarColumnGap, official.topBarColumnGap, official.filterBarColumnGap],
            [2, 2, 4, 4],
          )
          check.eq(
            '撤销内联后页面回到 VS Code 档（横向间隙回到 2px、纵向仍是 4px）',
            [restored.topBarColumnGap, restored.topBarToFilterBar, restored.filterBarToFirstRow],
            [2, 4, 4],
          )
          // ---- ④ frame 上那三个变量：纵向 4px、横向 2px ----
          check.eq(
            'frame 上纵向两项的密度变量是官方原值 4px',
            [restored.vars['section-header-gap'], restored.vars['group-gap']],
            ['4px', '4px'],
          )
          check.eq('frame 上横向的密度变量仍是紧凑档 2px', restored.vars['section-gap'], '2px')
        }
      }

      check.eq('顶栏纵向留白套件全程零 pageerror', withoutKnownNoise(opened.capture.pageErrors).real, [])
    } finally {
      await opened.context.close()
    }
    return screenshots
  },
}
