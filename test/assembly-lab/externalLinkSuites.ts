/**
 * 外链锚点的捕获阶段兜底（#150）：插件里的 `<a href="https://…">` 在 VS Code 里点得开，
 * 而**不该被接管**的锚点一格不动。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与 `recycleEntrySuites.ts` / `driftSuites.ts`
 * 同一条：那个文件是本批开发的合入热点，新套件放外面能少一半冲突面。注册方式是在
 * `suites.ts` 的 `SUITES` 末尾追加一项。
 *
 * ## 这一套件为什么这样设计（三条前提）
 *
 * 1. **断言打在「可观测的因」上**：真 VS Code 里那次点击最后由宿主调系统浏览器，实验室页面
 *    是普通浏览器，看不到那一步。所以判据是**宿主能力口的调用**（`vscode.openExternal` 记进
 *    假宿主的 `openedUrls`、页面 `window.open` 记进 `openedByWindow`），外加页面自身的
 *    可观测事实（URL 有没有变、有没有开新页、控制台有没有违规）。
 * 2. **VS Code 自己那层链接拦截用替身复现**（`harness.ts` 的 `vscodeLinkLayerScript`，逐句
 *    抄官方 `pre/index.html` 的 `handleInnerClick`，把「postMessage 给宿主」换成「记一笔」）：
 *    那层是宿主装的，实验室复现不出真 webview 的多层结构。没有它，「兜底接管后宿主那层不会
 *    再开一次」这条断言就无从谈起。**替身不是真货**，真机那一步要人工验收（步骤写在 #150 的
 *    结论里）。
 * 3. **夹具锚点与插件同形**：`target="_blank"` + 点击路径上一个**冒泡阶段**的
 *    `stopPropagation`（插件里那是锚点自己的 React `onClick`；React 把它装在根容器上、冒泡
 *    阶段派发，夹具装在锚点自己身上，两者都在 window 那层之前截住事件）。设置树里另拿
 *    **真插件**（`@dsh-one/dsh-llm-provider` 的「打开官网 ↗」）点一次——它是用户报的现场，
 *    在就必点；插件没装时只记事实不判失败。
 *
 * 页面一共开了五个：设置树（不装拦截层替身，看兜底自己做了什么）、设置树（装替身，看兜底与宿主
 * 那层的关系；**相对路径与页内锚点也在这一页**，因为这一页正是 VS Code 的真实处境——那层今天就在
 * 管它们）、**没有宿主**的设置页（= 官方 web / 普通浏览器的处境，看真因长什么样、兜底按判据不装）、
 * chat 树与 sidebar 树（一层实现、三棵树共用）。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import {
  capturePage,
  linkLayerFacts,
  openTreePage,
  vscodeLinkLayerScript,
  withoutKnownNoise,
  type OpenedPage,
} from './harness.ts'
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

/** 假宿主里与「开外链」有关的两个记录（`openedUrls` = 能力桥；`openedByWindow` = 页面 window.open）。 */
interface LinkHostFacts {
  openedUrls: string[]
  openedByWindow: string[]
}

async function hostFacts(page: OpenedPage['page']): Promise<LinkHostFacts> {
  return page.evaluate(() => {
    const host = (globalThis as { __LAB_HOST__?: { openedUrls: string[]; openedByWindow: string[] } }).__LAB_HOST__
    return { openedUrls: host?.openedUrls ?? [], openedByWindow: host?.openedByWindow ?? [] }
  })
}

/** 一条夹具锚点。 */
interface LinkSpec {
  id: string
  /** 逐字写进 `href` 属性（`setAttribute`；与浏览器解析出来的绝对地址不是一回事）。 */
  href: string
  /** 报告里读这条时的称呼。 */
  label: string
  /** `target` 属性；缺省不写。 */
  target?: string
  /** 与插件同形：点击路径上在冒泡阶段 `stopPropagation`（见文件头第 3 条）。 */
  stopPropagation?: boolean
}

/** 夹具容器的标记（注入一次，之后按 `#<id>` 点）。 */
const FIXTURE_BOX = 'data-lab-links'
/** 页内锚点的落点（验「页内跳转照旧」）。 */
const HASH_TARGET = 'lab-link-target'

/**
 * 往页面上注入一组夹具锚点：容器贴在视口左下角（固定定位，不遮页面自己的内容），文档末尾
 * 另放一个 1200px 高的占位块 + 一个 `#lab-link-target` 落点——验页内锚点照常跳时页面得够高。
 */
async function injectLinkFixture(page: OpenedPage['page'], specs: readonly LinkSpec[]): Promise<void> {
  await page.evaluate(
    ({ box, targetId, list }) => {
      document.querySelector(`[${box}]`)?.remove()
      document.querySelector('[data-lab-links-spacer]')?.remove()
      document.getElementById(targetId)?.remove()
      const container = document.createElement('div')
      container.setAttribute(box, '')
      container.style.cssText =
        'position:fixed;bottom:0;left:0;z-index:2147483647;background:#fff;color:#111;padding:6px;font:12px/1.6 monospace'
      for (const spec of list) {
        const anchor = document.createElement('a')
        anchor.id = spec.id
        anchor.setAttribute('href', spec.href)
        anchor.textContent = `${spec.id} `
        if (spec.target !== undefined) anchor.setAttribute('target', spec.target)
        if (spec.stopPropagation === true) {
          // 插件那个 onClick 的等价物（见文件头第 3 条）：冒泡阶段把事件截住。
          anchor.addEventListener('click', (event) => {
            event.stopPropagation()
          })
        }
        container.append(anchor)
      }
      const spacer = document.createElement('div')
      spacer.setAttribute('data-lab-links-spacer', '')
      spacer.style.height = '1200px'
      const target = document.createElement('div')
      target.id = targetId
      target.textContent = targetId
      document.body.append(container, spacer, target)
    },
    { box: FIXTURE_BOX, targetId: HASH_TARGET, list: specs },
  )
}

/** 撤掉夹具（切到别的地方看页面时不留干扰）。 */
async function clearLinkFixture(page: OpenedPage['page']): Promise<void> {
  await page.evaluate(
    ({ box, targetId }) => {
      document.querySelector(`[${box}]`)?.remove()
      document.querySelector('[data-lab-links-spacer]')?.remove()
      document.getElementById(targetId)?.remove()
    },
    { box: FIXTURE_BOX, targetId: HASH_TARGET },
  )
}

/** 一次点击的结果：这段窗口里新出现的宿主记录、拦截层替身的记录、页面 URL 前后值。 */
interface ClickFacts {
  /** 新出现的 `vscode.openExternal`（假宿主记的是 URL）。 */
  opened: string[]
  /** 新出现的页面 `window.open`。 */
  byWindow: string[]
  /** 新落进拦截层替身记录的点击（没装替身的页面恒为空表）。 */
  layer: ReadonlyArray<{ kind: string; href: string | null; url: string }>
  urlBefore: string
  urlAfter: string
}

/** 点一个夹具锚点，返回这次点击「多出来」的宿主记录与页面 URL 前后值。 */
async function clickFixture(page: OpenedPage['page'], id: string): Promise<ClickFacts> {
  const urlBefore = page.url()
  const hostBefore = await hostFacts(page)
  const layerBefore = (await linkLayerFacts(page)).hits.length
  await page.click(`#${id}`)
  await page.waitForTimeout(400)
  const hostAfter = await hostFacts(page)
  return {
    opened: hostAfter.openedUrls.slice(hostBefore.openedUrls.length),
    byWindow: hostAfter.openedByWindow.slice(hostBefore.openedByWindow.length),
    layer: (await linkLayerFacts(page)).hits.slice(layerBefore),
    urlBefore,
    urlAfter: page.url(),
  }
}

/** 与插件同形：`target="_blank"` + 冒泡阶段 stopPropagation。 */
const PLUGIN_SHAPE = {
  id: 'lab-ext-sp',
  href: 'https://platform.deepseek.com/api_keys?from=dsh-one&x=1#top',
  label: '与插件同形的锚点',
  target: '_blank',
  stopPropagation: true,
} satisfies LinkSpec

/** 官方 MarkdownText 那一类：`target="_blank"`、没人 stopPropagation。 */
const OFFICIAL_SHAPE = {
  id: 'lab-ext-plain',
  href: 'https://example.com/official-shape',
  label: '官方那类锚点',
  target: '_blank',
} satisfies LinkSpec

/**
 * 白名单外的三种（一次宿主调用都不许发）。**相对路径与页内锚点不在这张表里**：
 * 它们的原生行为是「页面自己走 / 滚」，在本页（没有 VS Code 那层拦截）点下去会真的把页面导航
 * 走——而这一页的 `<base>` 指向 mirror 源，`#frag` 这种写法也会解析成 mirror 上的地址、一样
 * 会导航。这两条都放在带拦截层替身的那一页验（那一页正是 VS Code 的真实处境：这层今天就在管
 * 它们）。
 */
const NOT_TAKEN_OVER: readonly LinkSpec[] = [
  { id: 'lab-js', href: 'javascript:void(0)', label: 'javascript:' },
  { id: 'lab-file', href: 'file:///etc/hosts', label: 'file:' },
  { id: 'lab-data', href: 'data:text/html,<h1>lab</h1>', label: 'data:' },
]

export const EXTERNAL_LINK_SUITE: LabSuite = {
  id: 'F-48',
  phase: 'new-feature',
  name: '外链锚点的捕获阶段兜底：插件那种 stopPropagation 的锚点在 VS Code 侧点得开，不接管的锚点一格不动（EXTERNAL-LINK 套件）',
  expect:
    '三棵树各装一层捕获阶段的文档级点击兜底（三棵共用一个实现）。① 与插件同形的锚点（`target="_blank"` + 冒泡阶段 `stopPropagation`）→ 恰好一次宿主 `vscode.openExternal`、URL 逐字相等、页面没导航也没开新页；② 官方 MarkdownText 那一类没 stopPropagation 的锚点 → 同样恰好一次（不与 VS Code 自己那层拦截叠加成双开）；③ `javascript:` / `file:` / `data:` / 相对路径 / 页内锚点一次调用都不发——相对路径仍由 VS Code 那层接管、页内锚点仍走那层自己的 hash 处置（都不被当外链开）；④ chat / sidebar / settings 三棵树各跑一遍（插件的界面在设置树里，另拿真插件锚点点一次）；⑤ 回归：官方那类锚点行为不变、零 CSP 违规、零 pageerror。没有宿主的页面上兜底按判据不装。',
  run: async (ctx, check) => {
    const screenshots: string[] = []

    // ── 页 A：设置树 + 假宿主（= VS Code 侧），不装拦截层替身 ────────────────
    // 这一页看的是「兜底把点击接过来之后发生了什么」：宿主调用次数、URL、导航、popup。
    const settings = await openTreePage(ctx.browser, ctx.lab, route('settings'), { width: 1200 })
    const popups: string[] = []
    settings.page.on('popup', (popup) => {
      popups.push(popup.url())
      void popup.close()
    })
    try {
      check.eq(
        '前置：这一页在 VS Code 侧（宿主注入的 acquireVsCodeApi 在）——兜底的安装判据成立',
        await settings.page.evaluate(() => typeof (globalThis as { acquireVsCodeApi?: unknown }).acquireVsCodeApi),
        'function',
      )
      await injectLinkFixture(settings.page, [
        PLUGIN_SHAPE,
        OFFICIAL_SHAPE,
        { id: 'lab-mail', href: 'mailto:lab@example.com', label: 'mailto:', stopPropagation: true },
        ...NOT_TAKEN_OVER,
      ])

      // ① 与插件同形：恰好一次、URL 逐字相等、页面没动。
      const pluginShape = await clickFixture(settings.page, PLUGIN_SHAPE.id)
      check.fact(`① 与插件同形的锚点（${PLUGIN_SHAPE.href}）：宿主收到 ${JSON.stringify(pluginShape.opened)}`)
      check.eq('① 与插件同形的锚点：宿主收到恰好一次外链打开，URL 逐字相等', pluginShape.opened, [PLUGIN_SHAPE.href])
      check.eq('① 与插件同形的锚点：页面没有发生导航', pluginShape.urlAfter, pluginShape.urlBefore)
      check.eq('① 与插件同形的锚点：页面没有开新页（点击被兜底接管，不再走原生 target）', popups, [])
      screenshots.push(await shot(ctx, settings.page, 'external-link-01-plugin-shape'))

      // ② 官方那类（没有 stopPropagation）：捕获层同样先接管，恰好一次、不叠加。
      const officialShape = await clickFixture(settings.page, OFFICIAL_SHAPE.id)
      check.fact(`② 官方那类锚点（${OFFICIAL_SHAPE.href}）：宿主收到 ${JSON.stringify(officialShape.opened)}`)
      check.eq('② 没 stopPropagation 的锚点：同样恰好一次宿主调用（不是两次）', officialShape.opened, [OFFICIAL_SHAPE.href])
      check.eq('② 没 stopPropagation 的锚点：页面没有发生导航', officialShape.urlAfter, officialShape.urlBefore)

      // 白名单里的 mailto：也算外链，照样接管。
      const mail = await clickFixture(settings.page, 'lab-mail')
      check.fact(`白名单含 mailto：mailto 锚点发出的宿主调用 ${JSON.stringify(mail.opened)}`)
      check.eq('白名单含 mailto：mailto 锚点同样交给宿主打开一次', mail.opened, ['mailto:lab@example.com'])
      check.eq(
        'VS Code 侧只走能力桥，没有顺手走页面 window.open（一次点击一个出口）',
        (await hostFacts(settings.page)).openedByWindow,
        [],
      )

      // ⑤ 控制台：做到这里为止（还没点下面那三种非白名单锚点）零 CSP 违规 / 零 error /
      // 零 pageerror——**顺序是有意的**：`javascript:` 那条锚点由浏览器按原生行为处置
      // （页面不再自带 CSP，所以它今天直接执行 `void(0)`，不再报一条 CSP 违规——#188 之前
      // 本页的 `script-src` 不给 `unsafe-inline`，那一下会留一条违规）。那三种的处置记在
      // 下面的事实里，都不是本次改动引入的。
      const consoleFacts = {
        csp: settings.capture.all.filter((line) => /content security policy/i.test(line)),
        errors: settings.capture.consoleErrors.filter((line) => !/content security policy/i.test(line)),
        pageErrors: withoutKnownNoise(settings.capture.pageErrors).real,
      }
      check.fact(
        `⑤ 设置页跑到这里为止的控制台：CSP 违规 ${String(consoleFacts.csp.length)} 条、其它 error ${String(consoleFacts.errors.length)} 条、pageerror ${String(consoleFacts.pageErrors.length)} 条`,
      )
      check.eq('⑤ 零 CSP 违规', consoleFacts.csp, [])
      check.eq('⑤ 零 console error', consoleFacts.errors, [])
      check.eq('⑤ 零 pageerror', consoleFacts.pageErrors, [])

      // ③ 不接管的三种：一次调用都不发、页面没有导航、页面按浏览器原生行为收场。
      const untouched: Record<string, ClickFacts> = {}
      for (const spec of NOT_TAKEN_OVER) {
        const click = await clickFixture(settings.page, spec.id)
        untouched[spec.id] = click
        check.eq(`③ ${spec.label} 的锚点：一次宿主调用都不发`, click.opened, [])
        check.eq(`③ ${spec.label} 的锚点：页面没有发生导航`, click.urlAfter, click.urlBefore)
      }
      check.fact(
        `③ 不接管的三种各自发出的宿主调用：${JSON.stringify(Object.fromEntries(Object.entries(untouched).map(([id, facts]) => [id, facts.opened])))}`,
      )
      check.fact(`③ 不接管的三种点击后页面新开的页：${JSON.stringify(popups)}`)
      check.eq('③ 不接管的三种点击都没有开新页', popups, [])
      const afterUntouched = settings.capture.all.filter((line) => /^(error|warning):/.test(line))
      check.fact(`③ 点完三种非白名单锚点后浏览器自己报的行（不判失败，兜底一次调用都没发）：${JSON.stringify(afterUntouched)}`)

      // ④ 真插件现场（设置页 → 模型服务）：装了插件就点它那枚「打开官网 ↗」。
      await clearLinkFixture(settings.page)
      const realAnchors = await switchToModelsSection(settings.page)
      check.fact(`④ 设置页「模型服务」节里的真插件锚点：${JSON.stringify(realAnchors.map((anchor) => anchor.href))}`)
      if (realAnchors.length === 0) {
        check.fact('④ 这一轮没看到插件锚点（`@dsh-one/dsh-llm-provider` 没装、或没有可开官网的账号）——不判失败，夹具那几条已覆盖同形锚点')
      } else {
        const before = await hostFacts(settings.page)
        await settings.page.click('a.pv_pcWeb')
        await settings.page.waitForTimeout(400)
        const opened = (await hostFacts(settings.page)).openedUrls.slice(before.openedUrls.length)
        check.fact(`④ 点真插件锚点（${realAnchors[0].href}）后宿主收到 ${JSON.stringify(opened)}`)
        check.eq('④ 真插件锚点（用户报的现场）：恰好一次宿主调用、URL 与锚点上的 href 逐字相等', opened, [realAnchors[0].href])
        screenshots.push(await shot(ctx, settings.page, 'external-link-02-real-plugin-anchor'))
      }
    } finally {
      await settings.context.close()
    }

    // ── 页 B：设置树 + 假宿主 + VS Code 链接拦截层替身 ─────────────────────
    // 这一页看的是「兜底与 VS Code 自己那层的关系」：接管时那层收不到（不叠加双开）、
    // 不接管时那层照旧收到（我们没伸手），外加真因复核（锚点自己 stopPropagation 就把点击
    // 从那层藏掉了）。先点相对路径那条：它证明替身**活着**（否则「没收到」是空的）。
    const layered = await openTreePage(ctx.browser, ctx.lab, route('settings'), { width: 1200, linkLayer: true })
    try {
      const relSpec: LinkSpec = { id: 'lab-rel-plain', href: '/settings?lab=relative', label: '相对路径（无 stopPropagation）' }
      const relSpSpec: LinkSpec = {
        id: 'lab-rel-sp',
        href: '/settings?lab=relative-sp',
        label: '相对路径（带 stopPropagation）',
        stopPropagation: true,
      }
      const spLayered = { ...PLUGIN_SHAPE, id: 'lab-ext-sp-layered' }
      const plainLayered = { ...OFFICIAL_SHAPE, id: 'lab-ext-plain-layered' }
      const hashSpec: LinkSpec = { id: 'lab-hash', href: `#${HASH_TARGET}`, label: '页内锚点' }
      await injectLinkFixture(layered.page, [relSpec, relSpSpec, hashSpec, spLayered, plainLayered])

      // 先点相对路径那条：它证明替身**活着**（否则后面「那层没收到」是空的）。
      const relClick = await clickFixture(layered.page, relSpec.id)
      check.fact(`③ 相对路径（无 stopPropagation）：拦截层收到 ${JSON.stringify(relClick.layer.map((hit) => hit.href))}`)
      check.ok(
        '③ 相对路径的锚点：兜底不接管，仍由 VS Code 那层接管（替身确实活着，今天的行为不变）',
        relClick.layer.length === 1 && relClick.layer[0].href === relSpec.href,
        JSON.stringify(relClick.layer),
      )
      check.eq('③ 相对路径的锚点：兜底一次宿主调用都不发', relClick.opened, [])
      check.eq('③ 相对路径的锚点：页面没有被谁导航走', relClick.urlAfter, relClick.urlBefore)

      // 页内锚点：VS Code 那层自己有一条 hash 分支（滚动到落点、不当链接开），我们不该插进去。
      const hashClick = await clickFixture(layered.page, hashSpec.id)
      check.fact(`③ 页内锚点：拦截层收到的「当链接开」记录 ${JSON.stringify(hashClick.layer.map((hit) => hit.href))}，页面 URL 有没有变 = ${String(hashClick.urlAfter !== hashClick.urlBefore)}`)
      check.eq('③ 页内锚点：兜底一次宿主调用都不发（不当外链开）', hashClick.opened, [])
      check.eq('③ 页内锚点：没有被当成外链交给宿主（VS Code 那层自己的 hash 处置照旧）', hashClick.layer, [])
      check.eq('③ 页内锚点：页面没有被导航走（那层拦下了这次点击）', hashClick.urlAfter, hashClick.urlBefore)

      const spClick = await clickFixture(layered.page, spLayered.id)
      check.fact(
        `② 有拦截层替身时，与插件同形的锚点：宿主收到 ${JSON.stringify(spClick.opened)}、拦截层收到 ${JSON.stringify(spClick.layer.map((hit) => hit.href))}`,
      )
      check.eq('② 与插件同形的锚点：宿主仍然恰好一次', spClick.opened, [PLUGIN_SHAPE.href])
      check.eq('② 兜底接管后 VS Code 那层不再收到这次点击（不与它叠加成双开）', spClick.layer, [])

      const plainClick = await clickFixture(layered.page, plainLayered.id)
      check.fact(
        `② 官方那类锚点：宿主收到 ${JSON.stringify(plainClick.opened)}、拦截层收到 ${JSON.stringify(plainClick.layer.map((hit) => hit.href))}`,
      )
      check.eq('② 官方那类锚点：宿主恰好一次（不会既走兜底又被那层开一次）', plainClick.opened, [OFFICIAL_SHAPE.href])
      check.eq('② 官方那类锚点：VS Code 那层同样不再收到（一次点击只开一次）', plainClick.layer, [])
      check.eq('设置页（带拦截层替身）零 pageerror', withoutKnownNoise(layered.capture.pageErrors).real, [])

      // ② 的反面 + 真因复核：**相对路径 + stopPropagation** 的锚点——兜底不管它（不在白名单里），
      // 而它自己的 stopPropagation 又把 VS Code 那层挡掉了，于是这次点击只有浏览器原生行为在顶
      // （这一页里就是「页面按相对地址走掉」：点完这一条页面会真的导航，所以它必须是本页最后一条）。
      // 现象与用户报的「点了没反应」是同一件事：那层收不到，就是没人替用户打开。
      const relSpClick = await clickFixture(layered.page, relSpSpec.id)
      check.eq(
        '真因复核：锚点自己 stopPropagation，VS Code 那层就再也收不到这次点击（#150 的现场；相对链接今天也只有那层在管，而兜底按白名单不接管）',
        relSpClick.layer,
        [],
      )
      check.eq('③ 相对路径（带 stopPropagation）：兜底同样不接管（不在白名单里）', relSpClick.opened, [])
      check.fact(`真因复核那一击之后页面 URL 变成 ${relSpClick.urlAfter}（原生导航，兜底没伸手）`)
    } finally {
      await layered.context.close()
    }

    // ── 页 C：没有宿主（= 官方 web / 普通浏览器的处境）+ 拦截层替身 ─────────
    // 这一页回答两件事：兜底按判据**不装**（判据是宿主注入的 acquireVsCodeApi），以及不装的
    // 时候真因长什么样——带 stopPropagation 的锚点那层收不到，浏览器原生行为顶上（VS Code 里
    // 沙箱不给开弹窗，用户看到的就是「点了没反应」）。
    const bareContext = await ctx.browser.newContext({ viewport: { width: 1200, height: 900 } })
    await bareContext.addInitScript({ content: vscodeLinkLayerScript() })
    const bare = await bareContext.newPage()
    const bareCapture = capturePage(bare)
    const barePopups: string[] = []
    bare.on('popup', (popup) => {
      barePopups.push(popup.url())
      void popup.close()
    })
    try {
      await bare.goto(`${ctx.lab.origin}/${route('settings').route}`, { waitUntil: 'domcontentloaded' })
      await bare.waitForSelector(route('settings').readySelector, { timeout: 40_000 })
      await bare.waitForTimeout(2_000)
      check.eq(
        '页 C：这个页面没有宿主（没有 acquireVsCodeApi）——兜底按判据不装',
        await bare.evaluate(() => typeof (globalThis as { acquireVsCodeApi?: unknown }).acquireVsCodeApi),
        'undefined',
      )
      check.fact(
        `页 C 旁证：即使没有 VS Code 宿主，页面侧 SDK 对象仍在（typeof __DSH_ONE_HOST__ = ${await bare.evaluate(() => typeof (globalThis as { __DSH_ONE_HOST__?: unknown }).__DSH_ONE_HOST__)}）——所以兜底的判据取 acquireVsCodeApi，不是它`,
      )
      const barePlain = { ...OFFICIAL_SHAPE, id: 'lab-bare-plain' }
      const bareSp = { ...PLUGIN_SHAPE, id: 'lab-bare-sp' }
      await injectLinkFixture(bare, [barePlain, bareSp])
      const barePlainClick = await clickFixture(bare, barePlain.id)
      const bareSpClick = await clickFixture(bare, bareSp.id)
      // 浏览器原生开页是**异步**的：`clickFixture` 只等 400ms，弹窗事件偶尔要更久才到
      // （headless 上尤其），读早了会得到空表、把「时序」记成「没开页」。这里给一个有界的
      // 等待，等不到照旧是空表、断言照旧红——判据一个字没放宽，只是别读半拍。
      for (let waited = 0; waited < 3_000 && barePopups.length === 0; waited += 150) {
        await bare.waitForTimeout(150)
      }
      check.fact(
        `页 C：没 stopPropagation 的锚点 → 拦截层收到 ${String(barePlainClick.layer.length)} 次；带 stopPropagation 的锚点 → 拦截层收到 ${String(bareSpClick.layer.length)} 次；页面按浏览器原生行为开的页 = ${JSON.stringify(barePopups)}`,
      )
      check.eq(
        '真因复核：没有兜底时，带 stopPropagation 的锚点 VS Code 那层收不到（这正是「点了没反应」）',
        bareSpClick.layer,
        [],
      )
      check.eq(
        '真因复核的对照：同一页里没 stopPropagation 的锚点那层收得到（所以官方 MarkdownText 的链接一直好）',
        barePlainClick.layer.length,
        1,
      )
      check.eq(
        '页 C：兜底不装 → 带 stopPropagation 的锚点只剩浏览器原生行为（实验室里开了新页；真 VS Code 的沙箱不给开弹窗，这就是用户看到的「点了没反应」）',
        barePopups,
        [bareSp.href],
      )
      check.eq(
        '页 C：兜底不装 → 控制台没有我们那条「外链打不开」的告警',
        bareCapture.all.filter((line) => /external link could not be opened/.test(line)),
        [],
      )
      check.eq('页 C 零 pageerror', withoutKnownNoise(bareCapture.pageErrors).real, [])
    } finally {
      await bareContext.close()
    }

    // ── 页 D / 页 E：chat 树与 sidebar 树各跑一遍（一层实现、三棵树共用）────
    // 这两棵树里没有 llm-provider 的界面，用同形夹具验「同一份实现照样装上了」。
    for (const [treeName, label] of [
      ['chat', 'chat 树'],
      ['sidebar', 'sidebar 树'],
    ] as const) {
      const opened = await openTreePage(ctx.browser, ctx.lab, route(treeName), { width: 1200 })
      try {
        const sp: LinkSpec = {
          ...PLUGIN_SHAPE,
          id: `lab-${treeName}-sp`,
          href: `https://example.com/${treeName}?from=dsh-one#top`,
        }
        const plain: LinkSpec = { ...OFFICIAL_SHAPE, id: `lab-${treeName}-plain`, href: `https://example.com/${treeName}-official` }
        await injectLinkFixture(opened.page, [sp, plain])
        const spClick = await clickFixture(opened.page, sp.id)
        const plainClick = await clickFixture(opened.page, plain.id)
        check.fact(`④ ${label}：与插件同形的锚点宿主收到 ${JSON.stringify(spClick.opened)}；官方那类锚点 ${JSON.stringify(plainClick.opened)}`)
        check.eq(`④ ${label}：与插件同形的锚点恰好一次宿主调用、URL 逐字相等`, spClick.opened, [sp.href])
        check.eq(`④ ${label}：官方那类锚点同样恰好一次`, plainClick.opened, [plain.href])
        check.eq(`④ ${label}：两次点击都没有让页面发生导航`, [spClick.urlAfter === spClick.urlBefore, plainClick.urlAfter === plainClick.urlBefore], [true, true])
        check.eq(`④ ${label}零 pageerror`, withoutKnownNoise(opened.capture.pageErrors).real, [])
        if (treeName === 'chat') screenshots.push(await shot(ctx, opened.page, 'external-link-03-chat-tree'))
      } finally {
        await opened.context.close()
      }
    }

    return screenshots
  },
}

/** 切到设置页的「模型服务」节，轮询等真插件把它的外链锚点渲染出来（没装则空表）。 */
async function switchToModelsSection(page: OpenedPage['page']): Promise<ReadonlyArray<{ href: string }>> {
  await page.evaluate(() => {
    const nav = Array.from(document.querySelectorAll('*')).find(
      (element) => (element.textContent ?? '').trim() === '模型服务' && element.children.length === 0,
    )
    if (nav instanceof HTMLElement) {
      nav.scrollIntoView()
      nav.click()
    }
  })
  for (let attempt = 0; attempt < 10; attempt++) {
    await page.waitForTimeout(800)
    const found = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a.pv_pcWeb[href]')).map((anchor) => ({ href: anchor.getAttribute('href') ?? '' })),
    )
    if (found.length > 0) return found
  }
  return []
}
