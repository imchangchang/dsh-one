/**
 * 标签组的三个预设组（#213）：恒在场 / 不可删改 / 可归组 / 历史数据照常显示。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与 `tagRailSuites.ts` / `collapseAllIconSuites.ts`
 * 同一：那个文件是本批开发的合入热点，新套件放外面能少一半冲突面。注册方式是在
 * `suites.ts` 的 `SUITES` 末尾追加一项。
 *
 * 数据面（与其它侧栏套件一致）：实验室自起的隔离实例 + 假宿主，**网关全程只读**；
 * 「旧文件里的 `preset-*` 数据」与「页面写下的状态跨重开还在」这两件事都只写假宿主的
 * 状态表——它就是真机上 `~/.dsh/dsh-one/tags.json` 的替身（#82 的口径）。
 *
 * 「重开页面」在实验室里的做法（`keepTagsAcrossReload`）：假宿主的状态表每次导航都按
 * 初始化脚本重置（`fakeHost.ts` 的 `stateStore` 就建在注入脚本里），所以要把**页面自己
 * 写下**的那一份再装成初始化脚本、再重载一次——那就是真机上「重开时读回同一份文件」。
 * 装进去的是页面经宿主能力口写出来的值，不是套件手写的期望值。
 */
import * as fsp from 'node:fs/promises'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  deleteTagGroup,
  parseTagGroups,
  serializeTagGroups,
  tagBucketOf,
  withPresetTagGroups,
  withTagBucket,
  type TagGroupsFile,
} from '../../src/pure/sessionTagGroups.ts'
import { openTreePage, texts, withoutKnownNoise, type OpenedPage } from './harness.ts'
import { LAB_TREES, type LabTreeRoute } from './labServer.ts'
// 只取类型（编译后不留 import，运行期没有环）：套件接口定义在 suites.ts 里，它就是调用方。
import type { LabSuite } from './suites.ts'

const route = (name: string): LabTreeRoute => {
  const found = LAB_TREES.find((candidate) => candidate.route === name)
  if (found === undefined) throw new Error(`lab: unknown tree route ${name}`)
  return found
}

/** 三个预设组的 id（顺序 = 模型里的默认顺序，见 `pure/sessionTags.ts` 的 PRESET_TAGS）。 */
const PRESET_IDS = ['preset-todo', 'preset-doing', 'preset-done'] as const
/** 预设组的名字（写成词典里的中文；断言按 zh / en 两份都认，见 harness 的 `texts`）。 */
const PRESET_ZH_NAMES = ['待办', '进行中', '已完成']

/** 插件源码里那份标签色板（正本；解析办法与 tagRailSuites 的同一条理由：那个模块 import
 *  react 与官方私有包，node 进程里 import 不进来）。 */
function tagColorPalette(): Map<string, string> {
  const file = path.join(import.meta.dirname, '..', '..', 'packages', 'dsh-workspace-tree', 'src', 'workspaceTree', 'tagGroups.ts')
  const src = fs.readFileSync(file, 'utf8')
  const at = src.indexOf('export const TAG_COLOR_CSS')
  const end = src.indexOf('}', at)
  const pairs = [...src.slice(at, end).matchAll(/(\w+):\s*'(#[0-9a-fA-F]{6})'/g)]
  return new Map(pairs.map((match) => [match[1] ?? '', match[2] ?? '']))
}

const PALETTE = tagColorPalette()

/** `#f14c4c` → 浏览器 computed 出来的那种写法 `rgb(241, 76, 76)`。 */
function rgbOf(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16)
  return `rgb(${String((value >> 16) & 255)}, ${String((value >> 8) & 255)}, ${String(value & 255)})`
}

/** 假宿主状态表里的那一份 `tags`（真机上 = `~/.dsh/dsh-one/tags.json`）。 */
async function hostTags(page: OpenedPage['page']): Promise<TagGroupsFile | null> {
  const value = await page.evaluate(() => {
    const host = (globalThis as unknown as { __LAB_HOST__?: { stateStore?: Record<string, unknown> } }).__LAB_HOST__
    return host?.stateStore?.['tags'] ?? null
  })
  return value as TagGroupsFile | null
}

/** 把页面**自己写下的**那一份 `tags` 装成初始化脚本，供下一次重载读回（= 重开页面）。 */
async function keepTagsAcrossReload(page: OpenedPage['page'], value: unknown): Promise<void> {
  await page.addInitScript({
    content: `(() => { globalThis.__LAB_HOST__.stateStore['tags'] = ${JSON.stringify(value)} })()`,
  })
}

/** 重载并等首屏就绪（页面会重新经能力口读一次状态）。 */
async function reopen(page: OpenedPage['page']): Promise<void> {
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector(route('sidebar').readySelector, { timeout: 40_000 })
  await page.waitForTimeout(2_500)
  await expandAllWorkspaces(page)
}

/** 把整棵树展开（要能看见分组里的会话行与组块）。 */
async function expandAllWorkspaces(page: OpenedPage['page']): Promise<void> {
  const state = async (): Promise<string | null> =>
    page.getAttribute('[data-dshone-tree-action="collapse-all"]', 'data-dshone-tree-collapsed')
  await page.click('[data-dshone-tree-action="collapse-all"]')
  await page.waitForTimeout(250)
  if ((await state()) === 'true') {
    await page.click('[data-dshone-tree-action="collapse-all"]')
    await page.waitForTimeout(250)
  }
}

interface SectionFact {
  key: string
  /** 区块里的组 pill（id + 显示名，顺序 = 渲染顺序）。 */
  pills: Array<{ id: string; name: string }>
  /** 区块里的组块（组 id + 块内会话行）。 */
  blocks: Array<{ tag: string; rows: string[] }>
}

/** 逐个工作区块读它的组 pill 与组块内容（判「恒在场」「谁在哪个组里」用）。 */
async function sectionFacts(page: OpenedPage['page']): Promise<SectionFact[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-dshone-group-key]')).map((section) => ({
      key: section.getAttribute('data-dshone-group-key') ?? '',
      pills: Array.from(section.querySelectorAll('[data-dshone-tree-tag-pill]')).map((pill) => ({
        id: pill.getAttribute('data-dshone-tree-tag-pill') ?? '',
        name: pill.querySelector('.dshOneTree_tagName')?.textContent ?? '',
      })),
      blocks: Array.from(section.querySelectorAll('[data-dshone-tree="tag-block"]')).map((block) => ({
        tag: block.getAttribute('data-dshone-tree-tag') ?? '',
        rows: Array.from(block.querySelectorAll('[data-dshone-tree-row="session"]')).map((row) => row.getAttribute('data-dshone-tree-session') ?? ''),
      })),
    })),
  )
}

/** 某一行的行菜单（hover 出行内操作区再点那枚 ⋯）。 */
async function openRowMenu(page: OpenedPage['page'], sessionId: string): Promise<void> {
  const row = page.locator(`[data-dshone-tree-session="${sessionId}"]`)
  await row.hover()
  await row.locator('.dshOneTree_rowIconButton').click()
  await page.waitForTimeout(250)
}

/** 打开某个组的 pill 菜单（组头那枚 ⋯ 悬停才显示，先 hover 组块再点）。 */
async function openTagMenu(page: OpenedPage['page'], tagId: string): Promise<void> {
  const block = page.locator(`[data-dshone-tree-tag="${tagId}"]`).first()
  await block.hover()
  await page.waitForTimeout(150)
  await block.locator('[data-dshone-tree-action="tag-menu"]').click()
  await page.waitForTimeout(250)
}

/** 打开的菜单里有哪些项（按 `data-dshone-tree-item` 认我们那一份）+ 整份文本。 */
async function tagMenuFacts(page: OpenedPage['page']): Promise<{ open: boolean; ids: string[]; text: string }> {
  return page.evaluate(() => {
    const menus = Array.from(document.querySelectorAll('[role="menu"]'))
    const last = menus[menus.length - 1] ?? null
    return {
      open: last !== null,
      ids: Array.from(last?.querySelectorAll('[data-dshone-tree-item]') ?? []).map((el) => el.getAttribute('data-dshone-tree-item') ?? ''),
      text: (last?.textContent ?? '').replace(/\s+/g, ' '),
    }
  })
}

/**
 * 在页面里造一次 HTML5 拖拽（自定义 MIME + 真 `DragEvent`，与 F-16 / F-27 同一做法）：
 * 本插件判「拖的是什么」靠 `dataTransfer.types` 里的自定义 MIME，原生拖拽在 CDP 下带不带
 * 那个类型取决于浏览器实现，所以用真 `DataTransfer` 造事件——走的仍是插件自己的判定。
 */
async function labDrag(page: OpenedPage['page'], source: string, target: string, mime: string, payload: string): Promise<void> {
  await page.evaluate(
    (args: { source: string; target: string; mime: string; payload: string }) => {
      const from = document.querySelector(args.source)
      const to = document.querySelector(args.target)
      if (from === null) throw new Error(`drag source missing: ${args.source}`)
      if (to === null) throw new Error(`drag target missing: ${args.target}`)
      const dataTransfer = new DataTransfer()
      dataTransfer.setData(args.mime, args.payload)
      const fire = (node: Element, type: string): void => {
        node.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer, clientY: 0 }))
      }
      fire(from, 'dragstart')
      fire(to, 'dragenter')
      fire(to, 'dragover')
      fire(to, 'drop')
      fire(from, 'dragend')
    },
    { source, target, mime, payload },
  )
  await page.waitForTimeout(500)
}

/** 某个组块里有哪些会话行（重开页面后判「还在不在那个组里」）。 */
async function rowsInBlock(page: OpenedPage['page'], tagId: string): Promise<string[]> {
  return page.evaluate(
    (tag: string) =>
      Array.from(document.querySelectorAll(`[data-dshone-tree-tag="${tag}"] [data-dshone-tree-row="session"]`)).map(
        (row) => row.getAttribute('data-dshone-tree-session') ?? '',
      ),
    tagId,
  )
}

export const TAG_PRESETS_SUITE: LabSuite = {
  id: 'F-64',
  phase: 'new-feature',
  name: '标签组的三个预设组（#213）：恒在场 / 不可删改 / 可归组 / 历史数据照常显示（TAG-PRESETS 套件）',
  expect:
    '三个预设组（Todo / Doing / Done）在装配侧栏上真的回来了，语义与旧侧栏一致（隔离实例 + 假宿主 + 真装配页；网关只读，状态表就是 `~/.dsh/dsh-one/tags.json` 的替身）：① **恒在场**——**每个**工作区块里都有这三个组 pill（含一个自定义组都没有的 workspace），名字等于词典里那三条（zh / en 两份都认），三者的相对顺序就是模型里的 Todo → Doing → Done；把旧形状的 `tags`（含 `preset-todo` 的定义与归属）注进状态表再重开页面，**历史数据照常显示**（原先归在预设组里的那条会话仍在组里、旧文件里的自定义组也原样还在）；② **菜单里没有删除项**——预设组的 pill 菜单里 `tag-delete` 与 `tag-rename` 都不出现，而同一页面上自建组的菜单里这两项都在（正面对照，证明②不是「菜单压根没开」）；颜色那 6 项在（预设组可换色，照旧侧栏的口径）；③ **动作层真的拒**——直接对预设组发删除请求：按树里那两行真代码（`withPresetTagGroups` → `deleteTagGroup` → 非 null 才 `withTagBucket` 落盘）打，删除返回 `null`（= 调用方跳过落盘），状态表一个字节不变，重开页面三个预设组与组内会话照旧；**正面对照**是同一条代码路径对自建组**能删**（返回的新桶里没有那一组），把它写回状态表再重开页面，那个组块真的消失——证明③不是「什么都没测到」；④ **拖进/移进预设组能落盘、重开还在**——行菜单「移到分组…」里点一个预设组、以及把会话行拖到预设组块上，两条路都只写状态表；重开页面（把页面自己写下的那一份读回来）后两条会话仍在各自的预设组块里；⑤ **自定义组的删除行为不受影响**——行菜单新建一个自建组（会话同时归进去）→ 它的菜单里改名/删除都在 → 走确认弹窗删掉它 → 状态表里没有那一组、页面上那个块也没了、会话回落未归组，而三个预设组与此前归进预设组的那条会话一个字没动；⑥ **预设组换色**——菜单里点红色后状态表里那一组变成红色，重开页面 pill 上的色点就是那个颜色。全程零 pageerror。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const shot = async (page: OpenedPage['page'], name: string): Promise<string> => {
      const file = path.join(ctx.shots, `${name}.png`)
      await fsp.mkdir(ctx.shots, { recursive: true })
      await page.screenshot({ path: file })
      return file
    }

    check.ok('色板正本里有本套件要用的红色（色板解析没瞎）', PALETTE.get('red') !== undefined, JSON.stringify([...PALETTE]))

    const opened = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { width: 380, height: 900 })
    const { page } = opened
    try {
      await expandAllWorkspaces(page)

      // ---- 夹具：找一个有 ≥3 条可操作会话行的工作区块 ----
      const fixture = (await page.evaluate(() => {
        for (const section of Array.from(document.querySelectorAll('[data-dshone-group-key]'))) {
          const rows = Array.from(section.querySelectorAll('[data-dshone-tree-row="session"]'))
            .filter((row) => row.querySelector('[data-dshone-tree-action="session-menu"]') !== null)
            .map((row) => row.getAttribute('data-dshone-tree-session') ?? '')
            .filter((id) => id !== '')
          if (rows.length >= 3) return { key: section.getAttribute('data-dshone-group-key') ?? '', ids: rows.slice(0, 3) }
        }
        return null
      })) as null | { key: string; ids: string[] }
      check.fact(`夹具：${JSON.stringify(fixture)}`)
      check.ok(
        '找到一个有 ≥3 条可操作会话行的工作区块',
        fixture !== null && fixture.ids.length >= 3 && fixture.ids.every((id) => id !== ''),
      )
      if (fixture === null || fixture.ids.length < 3 || !fixture.ids.every((id) => id !== '')) return screenshots
      const [inPreset, inCustom, spare] = fixture.ids as [string, string, string]
      check.fact(`夹具会话：原先归在预设组里的 ${inPreset}、自建组里的 ${inCustom}、用来移动的 ${spare}（同在 ${fixture.key} 块）`)

      // ---- ③ 的动作层那一道按树里那两行真代码打（`applyTagBucket` 的判据 = 返回 null 就跳过落盘）----
      const writeBucket = (file: TagGroupsFile, workspaceId: string, bucket: Parameters<typeof withTagBucket>[2]): unknown =>
        JSON.parse(serializeTagGroups(withTagBucket(file, workspaceId, bucket)))

      // ---- ① 恒在场 + 历史数据：把旧形状的 tags 注进状态表再重开页面 ----
      const legacy = {
        version: 2,
        workspaces: {
          [fixture.key]: {
            tags: [
              { id: 'preset-todo', name: null, color: 'yellow' },
              { id: 't-lab', name: '实验室组', color: 'purple' },
            ],
            sessionTags: { [inPreset]: 'preset-todo', [inCustom]: 't-lab' },
          },
        },
      }
      await page.addInitScript({
        content: `(() => { globalThis.__LAB_HOST__.stateStore['tags'] = ${JSON.stringify(legacy)} })()`,
      })
      await reopen(page)

      const sections = await sectionFacts(page)
      check.fact(
        `各区块的组 pill：${JSON.stringify(sections.map((section) => ({ key: section.key, pills: section.pills.map((pill) => pill.id) })))}`,
      )
      check.ok('页面上有工作区块可判（恒在场那条要有区块才谈得上）', sections.length > 0, String(sections.length))

      // ① 之一：每个区块里三个预设组都在。
      const missing = sections
        .filter((section) => !PRESET_IDS.every((id) => section.pills.some((pill) => pill.id === id)))
        .map((section) => ({ key: section.key, pills: section.pills.map((pill) => pill.id) }))
      check.ok('每个工作区块里都有 Todo / Doing / Done 三个预设组（任何 workspace 桶）', missing.length === 0, JSON.stringify(missing))

      // ① 之二：含「一个自定义组都没有的 workspace」——这正是 #213 要的那一档（方案 A：不靠桶里存过预设组）。
      const bare = sections.filter((section) => !section.pills.some((pill) => !(PRESET_IDS as readonly string[]).includes(pill.id)))
      check.ok(
        '有「没有任何自定义组」的工作区块，且它里面照样是这三个预设组',
        bare.length > 0 && bare.every((section) => PRESET_IDS.every((id) => section.pills.some((pill) => pill.id === id))),
        JSON.stringify(bare.map((section) => ({ key: section.key, pills: section.pills.map((pill) => pill.id) }))),
      )

      // ① 之三：名字对词典（zh / en 两份），相对顺序照模型。
      const namesOf = (section: SectionFact): string[] =>
        PRESET_IDS.map((id) => section.pills.find((pill) => pill.id === id)?.name ?? '')
      const named = sections.find((section) => section.key === fixture.key) ?? sections[0]
      const presetNames = namesOf(named as SectionFact)
      check.fact(`预设组的名字（区块 ${named?.key ?? '?'}）：${JSON.stringify(presetNames)}`)
      check.ok(
        '三个预设组的名字就是词典里那三条（zh / en 两份都认）',
        presetNames.every((name, index) => texts(PRESET_ZH_NAMES[index] ?? '').includes(name)),
        JSON.stringify(presetNames),
      )
      const orderIn = (section: SectionFact): string[] =>
        section.pills.map((pill) => pill.id).filter((id) => (PRESET_IDS as readonly string[]).includes(id))
      check.ok(
        '三个预设组的先后顺序 = 模型里的 Todo → Doing → Done',
        sections.every((section) => JSON.stringify(orderIn(section)) === JSON.stringify([...PRESET_IDS])),
        JSON.stringify(sections.map((section) => orderIn(section))),
      )
      // 旧文件里的自定义组保住了它相对预设组的位置（补预设组不强行打乱已有顺序）。
      const fixtureSection = sections.find((section) => section.key === fixture.key)
      check.eq(
        '旧文件里存过的自定义组原样还在（照旧是一个块、成员也在）',
        fixtureSection?.blocks.find((block) => block.tag === 't-lab')?.rows ?? [],
        [inCustom],
      )
      check.eq(
        '历史数据：原先归在 preset-todo 里的那条会话照常显示在预设组里（会话没丢）',
        fixtureSection?.blocks.find((block) => block.tag === 'preset-todo')?.rows ?? [],
        [inPreset],
      )
      check.ok(
        '预设组的块与旧文件里的自定义组块都渲染出来了（不是只在 pill 上）',
        fixtureSection?.blocks.some((block) => block.tag === 'preset-todo') === true &&
          fixtureSection?.blocks.some((block) => block.tag === 't-lab') === true,
        JSON.stringify(fixtureSection?.blocks.map((block) => block.tag)),
      )
      check.eq(
        '补出来的两个预设组排在旧文件那份顺序之后（不强行打乱已有顺序）',
        fixtureSection?.pills.map((pill) => pill.id) ?? [],
        ['preset-todo', 't-lab', ...PRESET_IDS.filter((id) => id !== 'preset-todo')],
      )
      screenshots.push(await shot(page, 'tag-presets-blocks'))

      // ---- ② 预设组的菜单：没有删除项、没有改名项；颜色那 6 项在 ----
      await openTagMenu(page, 'preset-todo')
      const presetMenu = await tagMenuFacts(page)
      check.fact(`预设组（Todo）的菜单：${JSON.stringify(presetMenu)}`)
      // 正面对照：菜单真的开了（标题行写着是哪个组）——否则「没有删除项」可能只是没开出来。
      const menuHas = (needle: string): boolean =>
        texts(needle).some((variant) => presetMenu.text.includes(variant))
      check.ok('预设组的菜单真的开了（标题行写着这是哪个组）', presetMenu.open && menuHas('标签组：待办'), presetMenu.text)
      check.ok('预设组的菜单里有颜色那 6 项（可换色，照旧侧栏的口径）', ['yellow', 'blue', 'green', 'orange', 'purple', 'red'].every((color) => presetMenu.ids.includes(`tag-color-${color}`)), JSON.stringify(presetMenu.ids))
      check.ok('预设组的菜单里三项常用动作都在（新建会话 / 整组归档 / 整组移入回收站）', ['tag-new-session', 'tag-archive', 'tag-recycle', 'tag-ungroup'].every((id) => presetMenu.ids.includes(id)), JSON.stringify(presetMenu.ids))
      check.ok('预设组的菜单里**没有删除项**', !presetMenu.ids.includes('tag-delete'), JSON.stringify(presetMenu.ids))
      check.ok('预设组的菜单里也没有改名项（预设组不可改名）', !presetMenu.ids.includes('tag-rename'), JSON.stringify(presetMenu.ids))
      screenshots.push(await shot(page, 'tag-presets-menu'))
      await page.keyboard.press('Escape')
      await page.waitForTimeout(250)

      // ② 的正面对照：同一页面上自建组的菜单里这两项都在。
      await openTagMenu(page, 't-lab')
      const customMenu = await tagMenuFacts(page)
      check.fact(`自建组（实验室组）的菜单：${JSON.stringify(customMenu)}`)
      check.ok(
        '自建组的菜单里删除项与改名项都在（对照：预设组那两条不是因为菜单压根没渲染）',
        customMenu.ids.includes('tag-delete') && customMenu.ids.includes('tag-rename'),
        JSON.stringify(customMenu.ids),
      )
      await page.keyboard.press('Escape')
      await page.waitForTimeout(250)

      // ---- ③ 动作层真的拒删：状态与状态表都不变 ----
      const before = await hostTags(page)
      const fileBefore = parseTagGroups(before)
      check.ok('状态表里的 tags 解析得出来（判据要按真数据打）', fileBefore !== null, JSON.stringify(before))
      if (fileBefore === null) return screenshots
      const bucketBefore = tagBucketOf(fileBefore, fixture.key)
      // 这两行就是树里的动作层：`withPresetTagGroups(bucket)` → 纯动作 → 非 null 才落盘。
      const refused = deleteTagGroup(withPresetTagGroups(bucketBefore), 'preset-todo')
      check.eq('动作层拒删：对预设组发删除请求返回 null（= 调用方跳过落盘，一个字节都不改）', refused, null)
      check.eq('状态表一个字节没变（删除请求没落盘）', await hostTags(page), before)
      // 正面对照：同一条代码路径对自建组能删——证明上面那条不是「什么都没测到」。
      const removed = deleteTagGroup(withPresetTagGroups(bucketBefore), 't-lab')
      check.ok(
        '同一条代码路径对自建组是能删的（正面对照：返回的新桶里没有那一组）',
        removed !== null && !removed.tags.some((tag) => tag.id === 't-lab'),
        JSON.stringify(removed?.tags.map((tag) => tag.id)),
      )
      // 把正面对照的结果按树里的写法落盘（`applyTagBucket`）= 真写进状态表，再重开页面看它真的消失。
      await keepTagsAcrossReload(page, writeBucket(fileBefore, fixture.key, removed as never))
      await reopen(page)
      const afterCustomDelete = await sectionFacts(page)
      const afterSection = afterCustomDelete.find((section) => section.key === fixture.key)
      check.ok(
        '正面对照落盘生效：重开页面后自建组的块真的没了（这一条判据是能红的）',
        afterSection?.blocks.some((block) => block.tag === 't-lab') !== true,
        JSON.stringify(afterSection?.blocks.map((block) => block.tag)),
      )
      check.ok(
        '预设组在删除请求与正面对照之后照旧在、组内会话照旧在（恒存在没被这两下动摇）',
        PRESET_IDS.every((id) => afterSection?.pills.some((pill) => pill.id === id) === true) &&
          (await rowsInBlock(page, 'preset-todo')).includes(inPreset),
        JSON.stringify({ pills: afterSection?.pills.map((pill) => pill.id), rows: await rowsInBlock(page, 'preset-todo') }),
      )

      // ---- ④ 移进 / 拖进预设组：落盘 + 重开还在 ----
      // 菜单路径：把刚被解散的那个自建组的成员移进 Doing。
      await openRowMenu(page, inCustom)
      await page.click('[data-dshone-tree-item="moveToGroup"]')
      await page.waitForTimeout(250)
      await page.click('[data-dshone-tree-item="tag:preset-doing"]')
      await page.waitForTimeout(600)
      const afterMenuMove = await hostTags(page)
      check.eq(
        '菜单「移到分组…」里点预设组 = 归属写进状态表',
        afterMenuMove?.workspaces?.[fixture.key]?.sessionTags?.[inCustom],
        'preset-doing',
      )
      check.eq('那一行渲染在预设组的块里（渲染与状态同源）', await rowsInBlock(page, 'preset-doing'), [inCustom])
      // 拖拽路径：把 spare 拖到 Done 的块上。
      await labDrag(page, `[data-dshone-tree-session="${spare}"]`, '[data-dshone-tree-tag="preset-done"]', 'text/dsh-session', spare)
      const afterDrag = await hostTags(page)
      check.eq('把会话行拖到预设组块上 = 归属写进状态表', afterDrag?.workspaces?.[fixture.key]?.sessionTags?.[spare], 'preset-done')
      check.eq('拖进去的那一行渲染在预设组的块里', await rowsInBlock(page, 'preset-done'), [spare])
      screenshots.push(await shot(page, 'tag-presets-moved'))
      // 重开页面：把页面自己写下的那一份读回来（见文件头）。
      await keepTagsAcrossReload(page, afterDrag)
      await reopen(page)
      check.eq('重开页面后：菜单移进去的那条还在预设组里', await rowsInBlock(page, 'preset-doing'), [inCustom])
      check.eq('重开页面后：拖进去的那条还在预设组里', await rowsInBlock(page, 'preset-done'), [spare])
      check.eq('重开页面后：原先归在 Todo 里的那条也还在（历史数据贯穿重开）', await rowsInBlock(page, 'preset-todo'), [inPreset])
      check.ok(
        '三条会话都没有回到「未归组」（预设组的归属真的落盘了）',
        (await sectionFacts(page)).find((section) => section.key === fixture.key)?.blocks.length === 3,
        JSON.stringify((await sectionFacts(page)).find((section) => section.key === fixture.key)?.blocks),
      )

      // ---- ⑤ 自定义组的删除行为不受影响（回归）----
      // 把一条已经在预设组里的会话拿出来新建一个自建组：行菜单「移到分组…」→
      // 「新建标签组…」→ 填名字 → 确认（会话同时归进新组）。
      await openRowMenu(page, inCustom)
      await page.click('[data-dshone-tree-item="moveToGroup"]')
      await page.waitForTimeout(250)
      await page.click('[data-dshone-tree-item="tag:__new"]')
      await page.waitForSelector('[data-dshone-tree="tag-name-input"]')
      await page.fill('[data-dshone-tree="tag-name-input"]', '回归组')
      await page.click('[data-dshone-tree-action="tag-create-confirm"]')
      await page.waitForTimeout(600)
      const withCustom = await hostTags(page)
      const customBucket = withCustom?.workspaces?.[fixture.key]
      const createdId = customBucket?.tags?.find((tag) => tag.name === '回归组')?.id ?? ''
      check.ok('行菜单新建自建组：组落进状态表且会话同时归进去', createdId !== '' && customBucket?.sessionTags?.[inCustom] === createdId, JSON.stringify(customBucket))
      if (createdId === '') return screenshots
      check.ok('新建的自建组在页面上出块', (await sectionFacts(page)).some((section) => section.blocks.some((block) => block.tag === createdId)))
      await openTagMenu(page, createdId)
      const customMenuNow = await tagMenuFacts(page)
      check.ok('自建组的菜单里删除项在（这一档是 ⑤ 的前提）', customMenuNow.ids.includes('tag-delete'), JSON.stringify(customMenuNow.ids))
      await page.click('[data-dshone-tree-item="tag-delete"]')
      await page.waitForSelector('[data-dshone-tree-action="tag-delete-confirm"]')
      await page.click('[data-dshone-tree-action="tag-delete-confirm"]')
      await page.waitForTimeout(800)
      const afterDelete = await hostTags(page)
      check.ok(
        '删掉自建组：状态表里没有那一组了、归属也清掉了（自定义组的删除行为不受影响）',
        afterDelete?.workspaces?.[fixture.key]?.tags?.some((tag) => tag.id === createdId) !== true &&
          afterDelete?.workspaces?.[fixture.key]?.sessionTags?.[inCustom] === undefined,
        JSON.stringify(afterDelete?.workspaces?.[fixture.key]),
      )
      check.ok('删掉的自建组块也没了', !(await sectionFacts(page)).some((section) => section.blocks.some((block) => block.tag === createdId)))
      check.eq('预设组一个字没动：那条会话回到「未归组」而不是被挪进预设组', await rowsInBlock(page, 'preset-doing'), [])
      const afterCustomPills = (await sectionFacts(page)).find((section) => section.key === fixture.key)?.pills.map((pill) => pill.id) ?? []
      check.ok(
        '预设组照旧三个都在（自建组的存在与删除都不动摇它们）',
        PRESET_IDS.every((id) => afterCustomPills.includes(id)),
        JSON.stringify(afterCustomPills),
      )
      screenshots.push(await shot(page, 'tag-presets-custom-group-gone'))

      // ---- ⑥ 预设组换色（照旧侧栏：预设组可换色）----
      await openTagMenu(page, 'preset-todo')
      await page.click('[data-dshone-tree-item="tag-color-red"]')
      await page.waitForTimeout(600)
      const recolored = await hostTags(page)
      check.eq(
        '预设组换色：状态表里那一组变成红色（预设组可换色）',
        recolored?.workspaces?.[fixture.key]?.tags?.find((tag) => tag.id === 'preset-todo')?.color,
        'red',
      )
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)
      await keepTagsAcrossReload(page, recolored)
      await reopen(page)
      const dotColor = await page.evaluate(() => {
        const block = document.querySelector('[data-dshone-tree-tag="preset-todo"]')
        const dot = block?.querySelector('.dshOneTree_tagDot') ?? null
        return dot === null ? '' : getComputedStyle(dot).backgroundColor
      })
      check.eq('重开页面后预设组 pill 上的色点就是那个颜色', dotColor, rgbOf(PALETTE.get('red') ?? ''))
      screenshots.push(await shot(page, 'tag-presets-recolored'))

      check.eq('标签组预设组套件全程零 pageerror', withoutKnownNoise(opened.capture.pageErrors).real, [])
    } finally {
      await opened.context.close()
    }
    return screenshots
  },
}
