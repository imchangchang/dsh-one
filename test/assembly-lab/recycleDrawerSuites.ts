/**
 * 回收站抽屉：收起也有动效（#117）。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与 `driftSuites.ts` / `recycleEntrySuites.ts`
 * 同一条：那个文件是本批开发的合入热点，新套件放外面能少一半冲突面。注册方式是在
 * `suites.ts` 的 `SUITES` 末尾追加一项。
 *
 * 「动效」这种东西眼睛一看就知道，问题是怎么让断言可判定。这里不去截图比像素，而是**逐帧
 * 采样**：在页面里点下收起/展开，然后用 `requestAnimationFrame` 一帧一帧读抽屉元素在不在
 * DOM、`transform` 的 translateY 是多少、className 是什么。一帧一帧的读数能同时证明三件事——
 * 过渡期间元素还在（不是瞬时移除）、它真的在动（有中间位置）、它滑到底/滑到位才收场。
 *
 * 数据面与 `recycleEntrySuites.ts` 同一处置：假宿主的 `recycle-bin` 状态存储由夹具注入，
 * 全程只读真网关。这里注入的是**空集合**——动效与抽屉里有几条内容无关，空集合让这一套
 * 不依赖当天网关的会话数据（#116 那类活数据抖动就进不来）。
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

const DRAWER = '[data-dshone-tree="recycle-drawer"]'
const ENTRY_MAIN = '[data-dshone-tree-action="recycle-toggle"]'
const EXPANDED_FLAG = 'data-dshone-tree-recycle-expanded'

/** 一帧的取样：抽屉在不在 DOM、滑到哪了（translateY，px）、身上挂着哪些自有类。 */
interface MotionSample {
  /** 从点下去算起的毫秒。 */
  t: number
  present: boolean
  openClass: boolean
  leavingClass: boolean
  /** 抽屉的 translateY（px）；不在 DOM 里时为 null。滑出到位 ≈ 抽屉自身高度。 */
  offset: number | null
  /** 抽屉自身高度（px）。 */
  height: number
}

/**
 * 点一下入口行主区，并**在页面内逐帧**采下抽屉的位置。
 *
 * 为什么要写进页面里：这套断言判的是「点下去之后每一帧长什么样」，采样与点击之间夹一次
 * CDP 往返就会把最早那几帧丢掉；采样与点击都在页内、同一个执行点起跑，读到的是页面的帧。
 */
async function clickEntryAndSample(
  page: OpenedPage['page'],
  budgetMs: number,
): Promise<MotionSample[]> {
  return page.evaluate(
    ([drawerSelector, actionSelector, budget]) =>
      new Promise<MotionSample[]>((resolve) => {
        const parseOffset = (transform: string): number => {
          if (transform === '' || transform === 'none') return 0
          const numbers = transform.slice(transform.indexOf('(') + 1, -1).split(',')
          return Number.parseFloat(numbers[numbers.length - 1] ?? '0') || 0
        }
        const samples: MotionSample[] = []
        const start = performance.now()
        const button = document.querySelector(actionSelector) as HTMLElement | null
        if (button === null) {
          resolve(samples)
          return
        }
        button.click()
        const tick = (): void => {
          const element = document.querySelector(drawerSelector)
          const style = element === null ? null : getComputedStyle(element)
          samples.push({
            t: Math.round(performance.now() - start),
            present: element !== null,
            openClass: element?.className.includes('dshOneTree_drawerOpen') ?? false,
            leavingClass: element?.className.includes('dshOneTree_drawerLeaving') ?? false,
            offset: style === null ? null : parseOffset(style.transform),
            height: element?.getBoundingClientRect().height ?? 0,
          })
          if (performance.now() - start < budget) requestAnimationFrame(tick)
          else resolve(samples)
        }
        requestAnimationFrame(tick)
      }),
    [DRAWER, ENTRY_MAIN, budgetMs] as const,
  )
}

/** 抽屉当前的静态形态（过渡落定之后读）。 */
async function drawerFacts(
  page: OpenedPage['page'],
): Promise<{
  count: number
  openClass: boolean
  transform: string
  transitionProperty: string
  transitionDuration: string
  timingFunction: string
  /** 官方 token 值 + 用同一条 token 在探针元素上算出来的效果（比字面量更靠得住）。 */
  officialDurationToken: string
  officialEaseToken: string
  probeDuration: string
  probeTiming: string
  expandedFlag: string
  ariaExpanded: string
  height: number
}> {
  return page.evaluate(([drawerSelector, flag]) => {
    const element = document.querySelector(drawerSelector)
    const style = element === null ? null : getComputedStyle(element)
    const root = getComputedStyle(document.documentElement)
    // 探针：把官方 token 原样挂到一个临时元素上，量出它算出来的值——「我们用的是官方 token」
    // 这件事因此可以逐字比对，而不是拿 `.2s` 这种字面量去猜。
    const probeElement = document.createElement('div')
    probeElement.style.transitionDuration = 'var(--ds-transition-duration)'
    probeElement.style.transitionTimingFunction = 'var(--ds-ease-in-out)'
    ;(element ?? document.body).appendChild(probeElement)
    const probe = getComputedStyle(probeElement)
    const probeDuration = probe.transitionDuration
    const probeTiming = probe.transitionTimingFunction
    probeElement.remove()
    const button = document.querySelector('[data-dshone-tree-action="recycle-toggle"]')
    return {
      count: document.querySelectorAll(drawerSelector).length,
      openClass: element?.className.includes('dshOneTree_drawerOpen') ?? false,
      transform: style?.transform ?? '',
      transitionProperty: style?.transitionProperty ?? '',
      transitionDuration: style?.transitionDuration ?? '',
      timingFunction: style?.transitionTimingFunction ?? '',
      officialDurationToken: root.getPropertyValue('--ds-transition-duration').trim(),
      officialEaseToken: root.getPropertyValue('--ds-ease-in-out').trim(),
      probeDuration,
      probeTiming,
      expandedFlag: button?.getAttribute(flag) ?? '',
      ariaExpanded: button?.getAttribute('aria-expanded') ?? '',
      height: element?.getBoundingClientRect().height ?? 0,
    }
  }, [DRAWER, EXPANDED_FLAG] as const)
}

/** 过渡期里「正在动」的那些帧（在 DOM 里、且位置卡在两端之间）。 */
function movingFrames(samples: readonly MotionSample[]): MotionSample[] {
  return samples.filter(
    (sample) => sample.present && sample.offset !== null && sample.offset > 1 && sample.height > 1 && sample.offset < sample.height - 1,
  )
}

/** 在场的帧里位置只往下走（收起方向），不留回退（1px 容差，给子像素舍入）。 */
function monotoneDown(samples: readonly MotionSample[]): boolean {
  let previous = -1
  for (const sample of samples) {
    if (!sample.present || sample.offset === null) continue
    if (previous >= 0 && sample.offset < previous - 1) return false
    previous = sample.offset
  }
  return true
}

const firstIndexOf = (samples: readonly MotionSample[], predicate: (sample: MotionSample) => boolean): number =>
  samples.findIndex(predicate)

export const RECYCLE_DRAWER_COLLAPSE_SUITE: LabSuite = {
  id: 'F-24',
  phase: 'new-feature',
  name: '回收站抽屉：收起也有动效（#117，DRAWER-COLLAPSE 套件）',
  expect:
    '抽屉的开与合都走同一段过渡（真网关**只读** + 假宿主注入的空回收站）。断言靠**逐帧采样**而不是截图比像素：点下收起之后用 `requestAnimationFrame` 一帧一帧读抽屉在不在 DOM、`transform` 的 translateY 滑到哪、className 是什么。① **点收起后过渡期间抽屉仍在 DOM 且带过渡属性**——取样里有多帧（≥2）抽屉在 DOM 里、位置卡在收起位与展开位之间（真的在动，不是瞬时移除），并且在 DOM 里活够了整段过渡（首次移动帧到最后一帧在场的间隔 ≥100ms），最后一帧在场的取样已经滑到收起位（translateY ≈ 自身高度，滑到底才卸）；② **过渡结束后不可交互**——取样最后几帧确认它已从 DOM 卸载，且在它原来的矩形中心 `elementFromPoint` 命中的是树区里的东西、不在抽屉子树上；③ **再次展开仍从收起态正常滑入**——重新点入口行，第一帧在场的取样位置 ≈ 收起位（不是一上来就在展开位），中间有多帧在动，末帧 translateY 归零且带展开类，按钮标记与 `aria-expanded` 同步翻；④ **#114 的语义不变**——点外面 / 按 Esc 收起后**再点入口行必定是展开**，关掉这几种路径之后按钮标记与抽屉真实状态始终一致。另核**时长与缓动的出处**：抽屉的 `transition-duration` / `transition-timing-function` 与「把官方 token `--ds-transition-duration` / `--ds-ease-in-out` 原样挂到探针元素上算出来的值」逐字相同（本机官方 token 实测 `.2s` 与 `cubic-bezier(.4, 0, .2, 1)`），且开与合读的是同一条过渡（两边对称）；最后把页面切到 `prefers-reduced-motion: reduce` 再验一遍：过渡被官方那种写法关掉（时长 0s），收起是直接切换、不留动画。全程零 pageerror，本套件只写假宿主状态存储。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const shot = async (page: OpenedPage['page'], name: string): Promise<string> => {
      const file = path.join(ctx.shots, `${name}.png`)
      await fsp.mkdir(ctx.shots, { recursive: true })
      await page.screenshot({ path: file })
      return file
    }

    const opened = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), {
      width: 380,
      height: 900,
      state: { 'recycle-bin': { version: 1, sessionIds: [] } },
    })
    try {
      const { page } = opened
      await page.waitForSelector(route('sidebar').readySelector)

      // ---------------------------------------------------------------------
      // 开场：展开一次，读过渡的静态属性（时长/缓动 = 官方 token）
      // ---------------------------------------------------------------------
      await page.click(ENTRY_MAIN)
      await page.waitForTimeout(400)
      const shown = await drawerFacts(page)
      check.fact(
        `抽屉展开后：transition-property=${shown.transitionProperty} duration=${shown.transitionDuration} timing=${shown.timingFunction}（官方 token：--ds-transition-duration=${shown.officialDurationToken} --ds-ease-in-out=${shown.officialEaseToken}；探针算出来 duration=${shown.probeDuration} timing=${shown.probeTiming}）高度=${String(Math.round(shown.height))}px`,
      )
      check.eq('抽屉展开：元素在、带展开类', [shown.count, shown.openClass], [1, true])
      check.eq('展开到位：translateY 归零（transform none）', shown.transform, 'none')
      check.ok(
        '过渡属性盯着 transform（滑入滑出都走这一条）',
        shown.transitionProperty.split(',').map((part) => part.trim()).includes('transform'),
        shown.transitionProperty,
      )
      check.ok(
        '时长取自官方 token `--ds-transition-duration`：抽屉算出来的值与探针上同一条 token 的值逐字相同',
        shown.probeDuration !== '' && shown.transitionDuration === shown.probeDuration,
        `抽屉=${shown.transitionDuration} 探针=(${shown.probeDuration}) token=${shown.officialDurationToken}`,
      )
      check.ok(
        '缓动取自官方 token `--ds-ease-in-out`：抽屉算出来的曲线与探针上同一条 token 的曲线逐字相同',
        shown.probeTiming !== '' && shown.timingFunction === shown.probeTiming,
        `抽屉=${shown.timingFunction} 探针=(${shown.probeTiming}) token=${shown.officialEaseToken}`,
      )
      screenshots.push(await shot(page, 'drawer-collapse-open'))

      // ---------------------------------------------------------------------
      // ① / ② 收起：逐帧采样证明「过渡期间还在 DOM 且在动」，落定后不可交互
      // ---------------------------------------------------------------------
      const closing = await clickEntryAndSample(page, 600)
      check.fact(
        `收起取样 ${String(closing.length)} 帧：${closing
          .slice(0, 24)
          .map((sample) => `${String(sample.t)}ms:${sample.present ? String(Math.round(sample.offset ?? -1)) : 'gone'}${sample.openClass ? '/open' : ''}${sample.leavingClass ? '/leaving' : ''}`)
          .join(' ')}`,
      )
      const closingMoving = movingFrames(closing)
      const closingLastPresent = closing.reduce((last, sample, index) => (sample.present ? index : last), -1)
      const closingFirstMove = firstIndexOf(closing, (sample) => sample.present && sample.offset !== null && sample.offset > 1)
      check.ok(
        '取样里确实有「关掉之后」的帧（最后一帧在场的索引在中间之后，不是一开始就没了）',
        closingLastPresent > 0 && closingLastPresent < closing.length,
        `lastPresent=${String(closingLastPresent)} 总帧数=${String(closing.length)}`,
      )
      check.ok(
        '① 过渡期间抽屉仍在 DOM：关掉之后有多帧（≥2）抽屉还在文档里',
        closingFirstMove >= 0 && closing.filter((sample, index) => sample.present && index >= closingFirstMove).length >= 2,
        `在场帧数=${String(closing.filter((sample) => sample.present).length)} 首次移动帧=${String(closingFirstMove)}`,
      )
      check.ok(
        '① 它真的在动、不是瞬时移除：取样里有多帧位置卡在两端之间',
        closingMoving.length >= 2,
        closingMoving.map((sample) => `${String(sample.t)}ms:${String(Math.round(sample.offset ?? -1))}`).join(' '),
      )
      check.ok(
        '① 它在 DOM 里活够了整段过渡（首次移动帧 → 最后一帧在场，间隔 ≥100ms）',
        closingFirstMove >= 0 && closing[closingLastPresent] !== undefined && closing[closingLastPresent].t - closing[closingFirstMove].t >= 100,
        `首次移动=${String(closing[closingFirstMove]?.t ?? -1)}ms 最后在场=${String(closing[closingLastPresent]?.t ?? -1)}ms`,
      )
      check.ok(
        '① 滑到底才收场：最后一帧在场的取样已经到收起位（translateY ≥ 自身高度的 95%）',
        closingLastPresent >= 0 &&
          (closing[closingLastPresent].offset ?? 0) >= closing[closingLastPresent].height * 0.95,
        `最后一帧 offset=${String(Math.round(closing[closingLastPresent]?.offset ?? -1))} 高度=${String(Math.round(closing[closingLastPresent]?.height ?? -1))}`,
      )
      check.ok(
        '① 退场期带自有标记（`dshOneTree_drawerLeaving`）：这一趟只为动画、不接收指针',
        closing.some((sample) => sample.present && sample.leavingClass),
        `带 leaving 类的帧数=${String(closing.filter((sample) => sample.leavingClass).length)}`,
      )
      check.ok(
        '① 关掉之后没有一帧回到展开位（相位没有来回跳）：从开始移动那一帧起，位置单调往下、且不再带展开类',
        closingFirstMove >= 0 &&
          closing
            .slice(closingFirstMove)
            .filter((sample) => sample.present)
            .every((sample) => !sample.openClass) &&
          monotoneDown(closing.slice(closingFirstMove)),
        `带展开类且在动的帧数=${String(closing.slice(Math.max(0, closingFirstMove)).filter((sample) => sample.present && sample.openClass).length)}`,
      )
      check.eq('过渡结束后不再有展开类', closing.at(-1)?.openClass, false)
      const closed = await drawerFacts(page)
      check.eq('② 过渡结束后抽屉已从 DOM 卸载（关闭 = 文档里没有它）', closed.count, 0)
      check.eq('② 按钮标记跟着翻成收起', [closed.expandedFlag, closed.ariaExpanded], ['false', 'false'])
      screenshots.push(await shot(page, 'drawer-collapse-closed'))

      // 原来那块矩形上点一下，命中的不能是抽屉内容。抽屉已经卸载，所以这里读的是「那块
      // 区域现在归谁」——必须是树区里的东西，且不在抽屉子树里。
      const hit = await page.evaluate(([drawerSelector]) => {
        const root = document.querySelector('[data-dshone-tree="root"]')
        const drawer = document.querySelector(drawerSelector)
        if (root === null) return null
        const box = root.getBoundingClientRect()
        // 抽屉原来盖住的是树区下半块：取树区底部往上 1/4 处那一点（抽屉半高，必然在它的
        // 矩形里）；抽屉此刻已经卸载，所以坐标由树区自己算，不依赖它还在不在。
        const x = box.right - 4
        const y = box.bottom - box.height / 4
        const element = document.elementFromPoint(x, y)
        return {
          x,
          y,
          hit: element === null ? null : `${element.tagName}.${element.className}`,
          inRoot: element !== null && root.contains(element),
          inDrawer: element !== null && drawer !== null && drawer.contains(element),
        }
      }, [DRAWER] as const)
      check.ok(
        '② 抽屉原来的那块矩形上 `elementFromPoint` 命中树区里的东西、不在抽屉子树上',
        hit !== null && hit.hit !== null && hit.inRoot && !hit.inDrawer,
        JSON.stringify(hit),
      )

      // ---------------------------------------------------------------------
      // ③ 再次展开：从收起位滑入（不是一上来就在展开位）
      // ---------------------------------------------------------------------
      const opening = await clickEntryAndSample(page, 500)
      check.fact(
        `展开取样 ${String(opening.length)} 帧：${opening
          .slice(0, 24)
          .map((sample) => `${String(sample.t)}ms:${sample.present ? String(Math.round(sample.offset ?? -1)) : 'gone'}${sample.openClass ? '/open' : ''}`)
          .join(' ')}`,
      )
      const firstPresent = firstIndexOf(opening, (sample) => sample.present)
      const openingMoving = movingFrames(opening)
      const lastFrame = opening.at(-1)
      check.ok(
        '③ 第一帧在场的取样在收起位附近（≥ 自身高度的一半），是从收起态起跑的',
        firstPresent >= 0 && (opening[firstPresent].offset ?? 0) >= opening[firstPresent].height * 0.5,
        `首帧 offset=${String(Math.round(opening[firstPresent]?.offset ?? -1))} 高度=${String(Math.round(opening[firstPresent]?.height ?? -1))}`,
      )
      check.ok(
        '③ 滑入也有中间帧（≥2 帧卡在两端之间），不是瞬间出现',
        openingMoving.length >= 2,
        openingMoving.map((sample) => `${String(sample.t)}ms:${String(Math.round(sample.offset ?? -1))}`).join(' '),
      )
      check.ok(
        '③ 滑入到位：末帧在 DOM 里、translateY 归零、带展开类',
        lastFrame !== undefined && lastFrame.present && (lastFrame.offset ?? -1) === 0 && lastFrame.openClass,
        JSON.stringify(lastFrame),
      )
      const reopened = await drawerFacts(page)
      check.eq('③ 展开后按钮标记与 aria 同步翻成展开', [reopened.expandedFlag, reopened.ariaExpanded], ['true', 'true'])
      check.ok(
        '两边对称：展开与收起读的是同一条过渡（同一 duration、同一曲线）',
        reopened.transitionDuration === shown.transitionDuration && reopened.timingFunction === shown.timingFunction,
        `展开=${reopened.transitionDuration}/${reopened.timingFunction} 收起=${shown.transitionDuration}/${shown.timingFunction}`,
      )

      // ---------------------------------------------------------------------
      // ④ #114 的语义：点外面 / Esc 关掉之后，再点入口行必定是展开
      // ---------------------------------------------------------------------
      const spot = await page.evaluate(([drawerSelector]) => {
        const root = document.querySelector('[data-dshone-tree="root"]')
        const drawer = document.querySelector(drawerSelector)
        if (root === null || drawer === null) return null
        const rootBox = root.getBoundingClientRect()
        const drawerBox = drawer.getBoundingClientRect()
        const candidates: readonly (readonly [number, number])[] = [
          [rootBox.right - 2, rootBox.top + 1],
          [rootBox.left + 2, rootBox.top + 1],
          [rootBox.right - 2, drawerBox.top - 2],
        ]
        for (const [x, y] of candidates) {
          const element = document.elementFromPoint(x, y)
          if (element !== null && root.contains(element) && !drawer.contains(element)) return { x, y }
        }
        return null
      }, [DRAWER] as const)
      check.ok('能在树区里找到一处「在树区内、不在抽屉上」的点（点外面要真点得着）', spot !== null, JSON.stringify(spot))
      if (spot !== null) {
        await page.mouse.click(spot.x, spot.y)
        await page.waitForTimeout(450)
      }
      check.eq('④ 点外面：等退场过渡跑完，抽屉从 DOM 里消失', (await drawerFacts(page)).count, 0)
      await page.click(ENTRY_MAIN)
      await page.waitForTimeout(400)
      const afterOutside = await drawerFacts(page)
      check.eq(
        '④ 点外面关掉之后再点入口行 = 展开（不会「点了没反应」）',
        [afterOutside.count, afterOutside.expandedFlag, afterOutside.transform],
        [1, 'true', 'none'],
      )
      await page.keyboard.press('Escape')
      await page.waitForTimeout(450)
      check.eq('④ Esc：退场过渡跑完，抽屉从 DOM 里消失', (await drawerFacts(page)).count, 0)
      await page.click(ENTRY_MAIN)
      await page.waitForTimeout(400)
      check.eq(
        '④ Esc 关掉之后再点入口行 = 展开',
        [(await drawerFacts(page)).count, (await drawerFacts(page)).expandedFlag],
        [1, 'true'],
      )
      // 提手「点一下 = 收起」也走同一条路：退场过渡之后同样从 DOM 里消失。
      await page.click('[data-dshone-tree-action="recycle-handle"]')
      await page.waitForTimeout(450)
      check.eq('④ 点提手收起：退场过渡跑完同样从 DOM 里消失', (await drawerFacts(page)).count, 0)

      // ---------------------------------------------------------------------
      // 可选档：prefers-reduced-motion 下直接切换（跟随官方那种写法）
      // ---------------------------------------------------------------------
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.click(ENTRY_MAIN)
      await page.waitForTimeout(300)
      const reduced = await drawerFacts(page)
      check.fact(
        `reduced-motion 下抽屉的过渡：property=${reduced.transitionProperty} duration=${reduced.transitionDuration}`,
      )
      check.eq('reduced-motion：过渡被关掉（时长 0s），抽屉仍在展开位', [reduced.transitionDuration, reduced.transform], ['0s', 'none'])
      const reducedClosing = await clickEntryAndSample(page, 400)
      check.fact(
        `reduced-motion 收起取样：${reducedClosing
          .map((sample) => `${String(sample.t)}ms:${sample.present ? String(Math.round(sample.offset ?? -1)) : 'gone'}`)
          .join(' ')}`,
      )
      const reducedFirstAfterClick = reducedClosing.find((sample) => sample.present)
      check.ok(
        'reduced-motion：收起是直接切换——第一帧在场的取样就已经到收起位（没有中间帧）',
        reducedFirstAfterClick !== undefined &&
          (reducedFirstAfterClick.offset ?? 0) >= reducedFirstAfterClick.height * 0.95,
        JSON.stringify(reducedFirstAfterClick),
      )
      check.eq('reduced-motion：抽屉最终同样从 DOM 里消失（兜底定时器收场）', (await drawerFacts(page)).count, 0)
      await page.emulateMedia({ reducedMotion: null })

      check.eq('全程零 pageerror', withoutKnownNoise(opened.capture.pageErrors).real, [])
    } finally {
      await opened.context.close()
    }
    return screenshots
  },
}
