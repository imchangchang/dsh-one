/**
 * 标签组的两条口径（#215 新建组的默认色 / #216 回收站里的会话不算活跃成员）。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与 `tagPresetSuites.ts` / `tagRailSuites.ts`
 * 同一：那个文件是本批开发的合入热点，新套件放外面能少一半冲突面。注册方式是在
 * `suites.ts` 的 `SUITES` 末尾追加两项。
 *
 * 数据面（与其它侧栏套件一致）：实验室自起的隔离实例 + 假宿主，**网关只读**；状态表就是
 * 真机上 `~/.dsh/dsh-one/tags.json` 与 `~/.dsh/dsh-one/recycle-bin.json` 的替身（`__LAB_HOST__`
 * 的 `stateStore`）。两条判据都走**真界面**：默认色读新建弹窗里那一枚选中的色块，
 * 回收站那一族走会话行菜单的「移入回收站 / 归档会话」与抽屉里的「还原」按钮。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { openTreePage, withoutKnownNoise, type OpenedPage } from './harness.ts'
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

const TAG_NAME_INPUT = '[data-dshone-tree="tag-name-input"]'
const TAG_CREATE_CONFIRM = '[data-dshone-tree-action="tag-create-confirm"]'
const RECYCLE_TOGGLE = '[data-dshone-tree-action="recycle-toggle"]'

/** 假宿主状态表里的那一份 `tags`（真机上 = `~/.dsh/dsh-one/tags.json`）。 */
async function hostTags(page: OpenedPage['page']): Promise<Record<string, unknown> | null> {
  const value = await page.evaluate(() => {
    const host = (globalThis as unknown as { __LAB_HOST__?: { stateStore?: Record<string, unknown> } }).__LAB_HOST__
    return host?.stateStore?.['tags'] ?? null
  })
  return value as Record<string, unknown> | null
}

/** 某个工作区块在状态表里的桶（没存过就是 null）。 */
async function hostBucket(page: OpenedPage['page'], key: string): Promise<Bucket | null> {
  const file = await hostTags(page)
  const workspaces = file?.['workspaces'] as Record<string, Bucket> | undefined
  return workspaces?.[key] ?? null
}

interface Bucket {
  tags?: Array<{ id: string; name: string | null; color: string }>
  sessionTags?: Record<string, string>
}

/** 把整棵树展开（要能看见会话行与组块）。 */
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

/** 把整棵树收起（只留工作区行）。 */
async function collapseAllWorkspaces(page: OpenedPage['page']): Promise<void> {
  if ((await page.getAttribute('[data-dshone-tree-action="collapse-all"]', 'data-dshone-tree-collapsed')) === 'true') return
  await page.click('[data-dshone-tree-action="collapse-all"]')
  await page.waitForTimeout(300)
}

/**
 * 只展开某一个工作区块、别的工作区一律收起。
 *
 * 为什么要收：会话行菜单从**行那一格**往下展开（「移到分组…」是**就地展开**的二级项，
 * #109），整棵树都展开时行一多，被点到的那一行就落到视口下方，整块菜单伸出视口——
 * Playwright 对「元素在视口外」的点击会一直重试到超时（本套件调试时实测过：点
 * `tag:__new` 报 `element is outside of the viewport`）。只留目标区块展开之后，它的行
 * 就在列表最上面，菜单整块稳稳落在视口里。
 */
async function focusSection(page: OpenedPage['page'], key: string): Promise<boolean> {
  if (key === '') return false
  await collapseAllWorkspaces(page)
  const row = page.locator(`[data-dshone-tree-row="workspace"][data-dshone-tree-key="${key}"]`)
  if ((await row.count()) === 0) return false
  if ((await row.getAttribute('aria-expanded')) !== 'true') {
    await row.click()
    await page.waitForTimeout(350)
  }
  return (await row.getAttribute('aria-expanded')) === 'true'
}

/** 把某一行滚到列表顶部（菜单往下展开，行越靠上越不容易把菜单顶出视口）。 */
async function scrollRowToTop(page: OpenedPage['page'], sessionId: string): Promise<void> {
  await page.evaluate((id: string) => {
    document.querySelector(`[data-dshone-tree-session="${id}"]`)?.scrollIntoView({ block: 'start' })
  }, sessionId)
  await page.waitForTimeout(120)
}

/** 某一行的行菜单（hover 出行内操作区再点那枚 ⋯）。 */
async function openRowMenu(page: OpenedPage['page'], sessionId: string): Promise<void> {
  await scrollRowToTop(page, sessionId)
  const row = page.locator(`[data-dshone-tree-session="${sessionId}"]`)
  await row.hover()
  await row.locator('.dshOneTree_rowIconButton').click()
  await page.waitForTimeout(250)
}

/** 行菜单里的某一项（先开菜单再点）。 */
async function rowMenuItem(page: OpenedPage['page'], sessionId: string, item: string): Promise<void> {
  await openRowMenu(page, sessionId)
  await page.waitForSelector(`[data-dshone-tree-item="${item}"]`)
  await page.click(`[data-dshone-tree-item="${item}"]`)
  await page.waitForTimeout(400)
}

/** 打开某条会话的「移到分组…」二级项。 */
async function openMoveToGroup(page: OpenedPage['page'], sessionId: string): Promise<void> {
  await openRowMenu(page, sessionId)
  await page.click('[data-dshone-tree-item="moveToGroup"]')
  await page.waitForTimeout(250)
}

/** 「新建标签组…」那一项的盒子 + 视口高（菜单伸出视口时点击会一直重试到超时）。 */
async function entryBox(page: OpenedPage['page']): Promise<{ top: number; bottom: number; viewport: number }> {
  return page.evaluate(() => {
    const item = document.querySelector('[data-dshone-tree-item="tag:__new"]')
    const rect = item?.getBoundingClientRect()
    return { top: Math.round(rect?.top ?? -1), bottom: Math.round(rect?.bottom ?? -1), viewport: window.innerHeight }
  })
}

/** 打开「新建标签组…」弹窗（入口 = 某条会话的行菜单 → 移到分组… → 新建标签组…）。 */
async function openCreateTagModal(
  page: OpenedPage['page'],
  sessionId: string,
): Promise<{ top: number; bottom: number; viewport: number }> {
  await openMoveToGroup(page, sessionId)
  await page.waitForSelector('[data-dshone-tree-item="tag:__new"]')
  const box = await entryBox(page)
  await page.click('[data-dshone-tree-item="tag:__new"]')
  await page.waitForSelector('[role="dialog"]')
  await page.waitForTimeout(250)
  return box
}

/** 弹窗里色板的读数：6 枚色块、哪一枚选中（类名 + aria-pressed 两处都读）。 */
async function colorPick(page: OpenedPage['page']): Promise<{ items: string[]; picked: string; pressed: string }> {
  return page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('[data-dshone-tag-color]'))
    const on = document.querySelector('.dshOneTree_tagColorPickOn')
    return {
      items: items.map((el) => el.getAttribute('data-dshone-tag-color') ?? ''),
      picked: on?.getAttribute('data-dshone-tag-color') ?? '',
      pressed: on?.getAttribute('aria-pressed') ?? '',
    }
  })
}

/** 关掉当前弹窗（Esc 与 F-34 那一套一致）。 */
async function closeModal(page: OpenedPage['page']): Promise<void> {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
}

/** 建一个自建组（把这条会话归进去）：`color` 给了就先手选那一色，不给就用默认色。 */
async function createTag(page: OpenedPage['page'], sessionId: string, name: string, color?: string): Promise<void> {
  await openCreateTagModal(page, sessionId)
  if (color !== undefined) {
    await page.click(`[data-dshone-tag-color="${color}"]`)
    await page.waitForTimeout(150)
  }
  await page.fill(TAG_NAME_INPUT, name)
  await page.click(TAG_CREATE_CONFIRM)
  await page.waitForTimeout(500)
}

/** 按组名认刚建的那个组的 id（组块上的组名；认不出来返回空串）。 */
async function tagIdByName(page: OpenedPage['page'], name: string): Promise<string> {
  return page.evaluate(
    (wanted: string) =>
      Array.from(document.querySelectorAll('[data-dshone-tree-tag]')).find(
        (block) => (block.querySelector('.dshOneTree_tagName')?.textContent ?? '') === wanted,
      )?.getAttribute('data-dshone-tree-tag') ?? '',
    name,
  )
}

/** 把一条会话归进某个组（行菜单 → 移到分组… → 点的那个组）。 */
async function moveToTag(page: OpenedPage['page'], sessionId: string, tagId: string): Promise<void> {
  await openMoveToGroup(page, sessionId)
  await page.click(`[data-dshone-tree-item="tag:${tagId}"]`)
  await page.waitForTimeout(500)
}

/** 组 pill 菜单里的某一项（组头那枚 ⋯ 悬停才显示，先 hover 组块再点）。 */
async function tagMenuItem(page: OpenedPage['page'], tagId: string, item: string): Promise<void> {
  const block = page.locator(`[data-dshone-tree-tag="${tagId}"]`).first()
  await block.hover()
  await page.waitForTimeout(150)
  await block.locator('[data-dshone-tree-action="tag-menu"]').click()
  await page.waitForSelector(`[data-dshone-tree-item="${item}"]`)
  await page.click(`[data-dshone-tree-item="${item}"]`)
  await page.waitForTimeout(600)
}

interface SectionFact {
  key: string
  /** 组块（组 id + 块内会话行）。 */
  blocks: Array<{ tag: string; rows: string[] }>
  /** 这一区块里渲染出来的会话行（含组块内与未归组）。 */
  rows: string[]
}

/** 逐区块读它的组块与行（判「谁在哪个组里」「组还在不在」用）。 */
async function sectionFacts(page: OpenedPage['page']): Promise<SectionFact[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-dshone-group-key]')).map((section) => ({
      key: section.getAttribute('data-dshone-group-key') ?? '',
      blocks: Array.from(section.querySelectorAll('[data-dshone-tree="tag-block"]')).map((block) => ({
        tag: block.getAttribute('data-dshone-tree-tag') ?? '',
        rows: Array.from(block.querySelectorAll('[data-dshone-tree-row="session"]')).map(
          (row) => row.getAttribute('data-dshone-tree-session') ?? '',
        ),
      })),
      rows: Array.from(section.querySelectorAll('[data-dshone-tree-row="session"]')).map(
        (row) => row.getAttribute('data-dshone-tree-session') ?? '',
      ),
    })),
  )
}

/** 某一区块里未归组的那些行（不在任何组块里的）。 */
function ungroupedIn(section: SectionFact | undefined): string[] {
  if (section === undefined) return []
  const inBlocks = new Set(section.blocks.flatMap((block) => block.rows))
  return section.rows.filter((id) => !inBlocks.has(id))
}

/** 某条会话的行菜单里「移到分组…」那一节有哪些项（marker）。 */
async function rowTagMenuMarkers(page: OpenedPage['page'], sessionId: string): Promise<string[]> {
  await openMoveToGroup(page, sessionId)
  const markers = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-dshone-tree-item^="tag:"]')).map(
      (el) => el.getAttribute('data-dshone-tree-item') ?? '',
    ),
  )
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
  return markers
}

/** 夹具：区块 key + 它里面前 n 条可开行菜单的会话 id（`exclude` 用来挑另一区块）。 */
async function sectionFixture(
  page: OpenedPage['page'],
  min: number,
  exclude?: string,
): Promise<{ key: string; ids: string[] } | null> {
  return page.evaluate(
    (args: { need: number; skip: string }) => {
      for (const section of Array.from(document.querySelectorAll('[data-dshone-group-key]'))) {
        const key = section.getAttribute('data-dshone-group-key') ?? ''
        if (args.skip !== '' && key === args.skip) continue
        const ids = Array.from(section.querySelectorAll('[data-dshone-tree-row="session"]'))
          .filter((row) => row.querySelector('[data-dshone-tree-action="session-menu"]') !== null)
          .map((row) => row.getAttribute('data-dshone-tree-session') ?? '')
          .filter((id) => id !== '')
        if (ids.length >= args.need) return { key, ids }
      }
      return null
    },
    { need: min, skip: exclude ?? '' },
  )
}

/** 等一个页面侧条件成立（回收站写入与组清理是异步的，读数前先等它落定）。 */
async function waitUntil(page: OpenedPage['page'], probe: () => Promise<boolean>): Promise<boolean> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await probe()) return true
    await page.waitForTimeout(150)
  }
  return false
}

/** 打开回收站抽屉并等它渲染出「还原」按钮。 */
async function openDrawer(page: OpenedPage['page']): Promise<void> {
  await page.click(RECYCLE_TOGGLE)
  await page.waitForSelector('[data-dshone-recycle-restore]', { timeout: 10_000 })
  await page.waitForTimeout(250)
}

/** 抽屉里某一条会话的「还原」按钮。 */
async function restoreFromDrawer(page: OpenedPage['page'], sessionId: string): Promise<void> {
  await page.click(`[data-dshone-recycle-restore="${sessionId}"]`)
  await page.waitForTimeout(600)
}

/** 抽屉里有哪些行（还原之后判「那条真出去了」）。 */
async function drawerRows(page: OpenedPage['page']): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-dshone-recycle-row]')).map(
      (row) => row.getAttribute('data-dshone-recycle-row') ?? '',
    ),
  )
}

// ---------------------------------------------------------------------------
// F-65：新建标签组的默认色（#215）
// ---------------------------------------------------------------------------

export const TAG_COLOR_UNUSED_SUITE: LabSuite = {
  id: 'F-65',
  phase: 'new-feature',
  name: '新建标签组的默认色优先取本工作区还没用过的颜色（#215：预设组的当前颜色算占用，6 色全占用才回落到按组数轮换）（TAG-COLOR-UNUSED 套件）',
  expect:
    '新建标签组时弹窗里默认选中的那一色，是**本工作区还没被任何组占用**的颜色（隔离实例 + 假宿主 + 真装配页；网关只读，状态表就是 `~/.dsh/dsh-one/tags.json` 的替身）：① **空桶**（三个预设组占着黄 / 蓝 / 绿）建第一个自建组 → 弹窗里选中的是橙（改前是按组数取 `TAG_COLORS[0]` = 黄，必然与「待办」撞色）；② 组里的色板照旧 6 枚、恰好一枚选中；设好之后建第一个组 → **下一个**新建弹窗默认色变成紫；再建 → 红（连着建的自建组默认色互不相同）；③ 六个颜色被占满（三个预设组 + 橙 / 紫 / 红三个自建组）之后再建 → 回落到按组数轮换（视图桶 6 个组 → 黄），这一档的读数在报告里写清——此刻选哪一色都必然与某个组同色，这是明知无解的兜底；④ **判的是颜色不是数量**：在另一个工作区块里把「待办」改成紫（走真菜单的换色项）→ 那个区块里新建组的默认色不再是紫（占用里的黄 / 蓝 / 绿由另两个预设组占着，第一个空色是黄）——按旧口径「数量 1 → `TAG_COLORS[1]`」会是蓝，这一条差值就是本条判据；⑤ **手选重复色照旧落盘**（「优先」不是「禁止」）：在默认色是黄的弹窗里手点已被占用的紫 → 确认后状态表里那一组的颜色就是紫。全程零 pageerror。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const shot = async (page: OpenedPage['page'], name: string): Promise<string> => {
      const file = path.join(ctx.shots, `${name}.png`)
      await fsp.mkdir(ctx.shots, { recursive: true })
      await page.screenshot({ path: file })
      return file
    }

    const opened = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { width: 380, height: 900 })
    const { page } = opened
    try {
      await expandAllWorkspaces(page)

      const fixture = await sectionFixture(page, 4)
      const other = await sectionFixture(page, 1, fixture?.key)
      check.fact(`夹具（第一个区块）：${JSON.stringify(fixture)}；第二个区块：${JSON.stringify(other)}`)
      if (fixture === null || fixture.ids.length < 4 || other === null) {
        check.ok('找到两个工作区块（主夹具 ≥4 条可操作会话行、另一块 ≥1 条）', false, JSON.stringify({ fixture, other }))
        return screenshots
      }
      check.ok('找到两个工作区块（主夹具 ≥4 条可操作会话行、另一块 ≥1 条）', true)
      const [s1, s2, s3, s4] = fixture.ids as [string, string, string, string]
      check.fact(`夹具会话：${JSON.stringify({ s1, s2, s3, s4 })}（同在 ${fixture.key} 块）`)
      const focused = await focusSection(page, fixture.key)
      check.ok('只展开主夹具那一个工作区块（行在列表最上面，行菜单整块落在视口里）', focused, fixture.key)

      // ---- ① 空桶（三个预设组占黄蓝绿）→ 默认橙 ----
      const firstBox = await openCreateTagModal(page, s1)
      check.ok(
        '① 行菜单露出视口的那一处（「新建标签组…」）整块在视口里（行靠下时菜单会伸出视口、点击一直重试到超时）',
        firstBox.bottom > 0 && firstBox.bottom <= firstBox.viewport,
        JSON.stringify(firstBox),
      )
      const first = await colorPick(page)
      check.fact(`① 色板读数：${JSON.stringify(first)}`)
      check.eq('① 色板 6 枚一枚不少', first.items.length, 6)
      check.eq('① 默认色 = 橙（黄 / 蓝 / 绿被三个预设组占着，改前这里按组数取黄、与「待办」撞色）', first.picked, 'orange')
      check.eq('① 选中的那一枚自己也说得出它是选中的（aria-pressed）', first.pressed, 'true')
      screenshots.push(await shot(page, 'tag-color-default-first'))

      // 把第一个组建出来（不动默认色）——它是 ② 的起点。
      await page.fill(TAG_NAME_INPUT, '色 A')
      await page.click(TAG_CREATE_CONFIRM)
      await page.waitForTimeout(600)
      const tagA = await tagIdByName(page, '色 A')
      check.ok('① 确认后真的建出来了（组块出现）', tagA !== '', tagA)

      // ---- ② 连着建：第二个默认紫、第三个默认红（互不相同） ----
      await openCreateTagModal(page, s2)
      const second = await colorPick(page)
      check.eq('② 已有橙组 → 下一个默认色是紫', second.picked, 'purple')
      await page.fill(TAG_NAME_INPUT, '色 B')
      await page.click(TAG_CREATE_CONFIRM)
      await page.waitForTimeout(600)

      await openCreateTagModal(page, s3)
      const third = await colorPick(page)
      check.eq('② 再有紫组 → 再下一个默认色是红（连着建的两个互不相同）', third.picked, 'red')
      check.ok('② 三个色各不相同', new Set([first.picked, second.picked, third.picked]).size === 3, JSON.stringify([first.picked, second.picked, third.picked]))
      await page.fill(TAG_NAME_INPUT, '色 C')
      await page.click(TAG_CREATE_CONFIRM)
      await page.waitForTimeout(600)

      // ---- ③ 六色占满 → 回落读数 ----
      await openCreateTagModal(page, s4)
      const fallback = await colorPick(page)
      check.fact(
        `③ 六色占满时的回落读数：${fallback.picked}（视图桶 6 个组 → TAG_COLORS[6 % 6]；此刻每一色都有组在用，无解）`,
      )
      check.eq('③ 六色全被占用 → 回落按组数轮换取到黄（读数写清：黄此刻已被「待办」占用，这是明知无解的兜底）', fallback.picked, 'yellow')

      // ---- ⑤ 手选一个已经在用的颜色照旧落盘（「优先」不是「禁止」） ----
      await page.click('[data-dshone-tag-color="purple"]')
      await page.waitForTimeout(150)
      const handPicked = await colorPick(page)
      check.eq('⑤ 手点紫色之后选中的就是紫（色板 6 色都能手选）', handPicked.picked, 'purple')
      await page.fill(TAG_NAME_INPUT, '色 D')
      await page.click(TAG_CREATE_CONFIRM)
      await page.waitForTimeout(600)
      const afterHandPick = await hostBucket(page, fixture.key)
      check.eq(
        '⑤ 手选一个已经在用的颜色照旧落盘（状态表里那一组就是紫）',
        afterHandPick?.tags?.find((tag) => tag.name === '色 D')?.color,
        'purple',
      )
      check.fact(`此时这个区块的组定义：${JSON.stringify(afterHandPick?.tags ?? [])}`)
      screenshots.push(await shot(page, 'tag-color-groups-created'))

      // ---- ④ 预设组换色的占用：另一个区块里把「待办」改成紫 ----
      const otherKey = other.key
      const moveIn = other.ids[0] as string
      const otherFocused = await focusSection(page, otherKey)
      check.ok('切到第二个工作区块（预设组换色那一条要在还没建过自建组的桶里判）', otherFocused, otherKey)
      await moveToTag(page, moveIn, 'preset-todo')
      await tagMenuItem(page, 'preset-todo', 'tag-color-purple')
      const otherBucket = await hostBucket(page, otherKey)
      check.eq(
        '④ 预设组换色落盘：「待办」在这个区块里已经是紫的（换色走真菜单，与 #213 同一路径）',
        otherBucket?.tags?.find((tag) => tag.id === 'preset-todo')?.color,
        'purple',
      )
      await openCreateTagModal(page, moveIn)
      const afterRecolor = await colorPick(page)
      check.fact(`④ 预设组改成紫之后再新建：默认色 ${afterRecolor.picked}`)
      check.ok(
        '④ 默认色不再是预设组刚换上的那个颜色（预设组的当前颜色算占用）',
        afterRecolor.picked !== 'purple' && afterRecolor.picked !== '',
        afterRecolor.picked,
      )
      check.eq('④ 第一个空色是黄（紫 / 蓝 / 绿被占，黄空着）', afterRecolor.picked, 'yellow')
      check.ok(
        '④ 不是按数量取的那一个（旧口径「桶里 1 个组 → TAG_COLORS[1]」会是蓝）',
        afterRecolor.picked !== 'blue',
        afterRecolor.picked,
      )
      screenshots.push(await shot(page, 'tag-color-preset-recolored'))

      check.eq('标签组默认色套件全程零 pageerror', withoutKnownNoise(opened.capture.pageErrors).real, [])
    } finally {
      await opened.context.close()
    }
    return screenshots
  },
}

// ---------------------------------------------------------------------------
// F-66：回收站里的会话不算标签组的活跃成员（#216）
// ---------------------------------------------------------------------------

export const TAG_GROUP_RECYCLE_SUITE: LabSuite = {
  id: 'F-66',
  phase: 'new-feature',
  name: '会话移入回收站后不再算标签组的成员：组与归属当场清掉（#216：与旧侧栏同一口径，不再等到归档）（TAG-GROUP-RECYCLE 套件）',
  expect:
    '标签组的空组清理把**回收站里的会话**当成不活跃成员（隔离实例 + 假宿主 + 真装配页；网关只读，状态表 = `~/.dsh/dsh-one/tags.json` 与 `recycle-bin.json` 的替身），判据全走真界面（行菜单「移入回收站 / 归档会话」+ 抽屉里的「还原」）：① **唯一成员被移进回收站 → 组当场消失**——组块没了、组 pill 没了、别条会话的行菜单「移到分组…」清单里也没有它、状态表里那一组与它那行归属都没了；② **正面照（负向对照）**——组里还有第二条活跃会话时，回收其中一条 → 那个组照旧在（块还在、块里还是另一条、清单里还有它），被回收那条的归属也留着；③ **可逆那一条**——从抽屉还原 ② 里那条 → 它**回到原组**（组块里又出现它）；还原 ① 里那条（组已经被清掉）→ 它落在「未归组」（组块之外），组也不会被它带回来；④ **归档那一步的清理是另一条路**（不经过回收站）：把一个只有唯一成员的自建组的那条会话直接归档 → 组与归属同样清掉（独立读数，不靠回收站这一步）；全程零 pageerror。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const shot = async (page: OpenedPage['page'], name: string): Promise<string> => {
      const file = path.join(ctx.shots, `${name}.png`)
      await fsp.mkdir(ctx.shots, { recursive: true })
      await page.screenshot({ path: file })
      return file
    }

    const opened = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), { width: 380, height: 900 })
    const { page } = opened
    try {
      await expandAllWorkspaces(page)

      const fixture = await sectionFixture(page, 4)
      check.fact(`夹具：${JSON.stringify(fixture)}`)
      if (fixture === null || fixture.ids.length < 4) {
        check.ok('找到一个有 ≥4 条可操作会话行的工作区块', false, JSON.stringify(fixture))
        return screenshots
      }
      check.ok('找到一个有 ≥4 条可操作会话行的工作区块', true)
      const [only, keepA, keepB, archived] = fixture.ids as [string, string, string, string]
      check.fact(`夹具会话：${JSON.stringify({ only, keepA, keepB, archived })}（同在 ${fixture.key} 块）`)
      const focused = await focusSection(page, fixture.key)
      check.ok('只展开夹具那一个工作区块（行在列表最上面，行菜单整块落在视口里）', focused, fixture.key)

      // ---- 夹具：两个自建组 —— 「独苗组」只有一条会话，「双人组」有两条 ----
      await createTag(page, only, '独苗组')
      const onlyTag = await tagIdByName(page, '独苗组')
      check.ok('夹具：「独苗组」建出来了（唯一成员一条）', onlyTag !== '', onlyTag)

      await createTag(page, keepA, '双人组')
      const keepTag = await tagIdByName(page, '双人组')
      check.ok('夹具：「双人组」建出来了（成员一条）', keepTag !== '', keepTag)
      if (onlyTag === '' || keepTag === '') return screenshots
      await moveToTag(page, keepB, keepTag)
      const planted = await hostBucket(page, fixture.key)
      check.eq(
        '夹具：状态表里「双人组」有两条成员、「独苗组」一条',
        [planted?.sessionTags?.[keepA], planted?.sessionTags?.[keepB], planted?.sessionTags?.[only]],
        [keepTag, keepTag, onlyTag],
      )

      // ---- ② 正面照：组里还有别的活跃成员 → 组照旧在，归属留着 ----
      await rowMenuItem(page, keepA, 'move-to-recycle-bin')
      const afterFirst = await hostBucket(page, fixture.key)
      const sectionAfterFirst = (await sectionFacts(page)).find((section) => section.key === fixture.key)
      check.eq(
        '② 组里还有第二条活跃会话 → 那个组照旧在（块还在，块里就是另一条）',
        sectionAfterFirst?.blocks.find((block) => block.tag === keepTag)?.rows ?? [],
        [keepB],
      )
      check.eq(
        '② 被回收那条的归属也留着（组没死，归属就不清——还原才回得到原组）',
        afterFirst?.sessionTags?.[keepA],
        keepTag,
      )
      check.ok(
        '② 清单里还有那个组（组还在，行菜单就照旧列它）',
        (await rowTagMenuMarkers(page, keepB)).includes(`tag:${keepTag}`),
      )
      screenshots.push(await shot(page, 'tag-group-recycle-kept'))

      // ---- ① 唯一成员被移进回收站 → 组与归属当场清掉 ----
      await rowMenuItem(page, only, 'move-to-recycle-bin')
      const pruned = await waitUntil(page, async () => (await hostBucket(page, fixture.key))?.tags?.every((tag) => tag.name !== '独苗组') === true)
      check.ok('① 移入回收站那一刻组就被清掉（不是等到归档才清）', pruned, JSON.stringify(await hostBucket(page, fixture.key)))
      const afterOnly = await hostBucket(page, fixture.key)
      check.ok(
        '① 状态表里那一组没有了、它那行归属也没了（tags.json 里一个字节不留）',
        afterOnly?.tags?.some((tag) => tag.name === '独苗组') !== true && afterOnly?.sessionTags?.[only] === undefined,
        JSON.stringify(afterOnly),
      )
      const sectionAfterOnly = (await sectionFacts(page)).find((section) => section.key === fixture.key)
      check.ok(
        '① 页面上那个组块也没了',
        !(sectionAfterOnly?.blocks ?? []).some((block) => block.tag === onlyTag),
        JSON.stringify(sectionAfterOnly?.blocks),
      )
      const menuAfterPrune = await rowTagMenuMarkers(page, keepB)
      check.ok(
        '① 别条会话的行菜单「移到分组…」里也没有它了',
        !menuAfterPrune.includes(`tag:${onlyTag}`),
        JSON.stringify(menuAfterPrune),
      )
      screenshots.push(await shot(page, 'tag-group-recycle-pruned'))

      // ---- ③ 可逆：还原 ② 里那条 → 回原组；还原 ① 里那条 → 未归组 ----
      await openDrawer(page)
      const inDrawer = await drawerRows(page)
      check.ok('③ 两条都在回收站抽屉里（还原那一条要有入口）', inDrawer.includes(keepA) && inDrawer.includes(only), JSON.stringify(inDrawer))
      await restoreFromDrawer(page, keepA)
      await waitUntil(page, async () => (await sectionFacts(page)).some((s) => s.rows.includes(keepA)))
      const sectionAfterRestore = (await sectionFacts(page)).find((section) => section.key === fixture.key)
      check.eq(
        '③ 还原 ② 里那条 → 它回到原组（组里又出现它）',
        (sectionAfterRestore?.blocks.find((block) => block.tag === keepTag)?.rows ?? []).slice().sort(),
        [keepA, keepB].sort(),
      )

      // 抽屉还开着（还原一条之后抽屉不关），接着还原 ① 里那条（组已经被清掉）。
      check.ok('③ 还原之后抽屉还开着（同一个抽屉里接着还原第二条）', (await drawerRows(page)).includes(only))
      await restoreFromDrawer(page, only)
      await page.click(RECYCLE_TOGGLE)
      await page.waitForTimeout(400)
      const sectionAfterSecond = (await sectionFacts(page)).find((section) => section.key === fixture.key)
      check.ok('③ 还原 ① 里那条 → 它回到树里（组已被清掉，会话本身照旧回来）', (sectionAfterSecond?.rows ?? []).includes(only), JSON.stringify(sectionAfterSecond?.rows))
      check.ok(
        '③ 它落在「未归组」（组块之外），组也没有被它带回来',
        ungroupedIn(sectionAfterSecond).includes(only) && !(sectionAfterSecond?.blocks ?? []).some((block) => block.tag === onlyTag),
        JSON.stringify({ ungrouped: ungroupedIn(sectionAfterSecond), blocks: sectionAfterSecond?.blocks.map((block) => block.tag) }),
      )
      const afterRestore = await hostBucket(page, fixture.key)
      check.ok(
        '③ 状态表里那一组也没有借着还原回来（归属没被重写）',
        afterRestore?.tags?.some((tag) => tag.name === '独苗组') !== true && afterRestore?.sessionTags?.[only] === undefined,
        JSON.stringify(afterRestore),
      )
      screenshots.push(await shot(page, 'tag-group-recycle-restored'))

      // ---- ④ 归档那一步的清理（另一条路，独立读数） ----
      await createTag(page, archived, '归档组')
      const archiveTag = await tagIdByName(page, '归档组')
      check.ok('④ 夹具：「归档组」建出来了（唯一成员一条）', archiveTag !== '', archiveTag)
      await openRowMenu(page, archived)
      await page.click('[data-dshone-tree-item="archive"]')
      await page.waitForSelector('[data-dshone-tree-action="archive-confirm"]')
      await page.waitForTimeout(200)
      await page.click('[data-dshone-tree-action="archive-confirm"]')
      await page.waitForTimeout(1_200)
      const afterArchive = await hostBucket(page, fixture.key)
      check.ok(
        '④ 直接归档（不经过回收站）也让那个组与归属一起清掉——归档那一步的清理照旧在',
        afterArchive?.tags?.some((tag) => tag.name === '归档组') !== true && afterArchive?.sessionTags?.[archived] === undefined,
        JSON.stringify(afterArchive),
      )
      const sectionAfterArchive = (await sectionFacts(page)).find((section) => section.key === fixture.key)
      check.ok(
        '④ 页面上那个组块与那条会话都没了（归档 = 终点）',
        !(sectionAfterArchive?.blocks ?? []).some((block) => block.tag === archiveTag) && !(sectionAfterArchive?.rows ?? []).includes(archived),
        JSON.stringify(sectionAfterArchive),
      )
      screenshots.push(await shot(page, 'tag-group-archive-pruned'))

      check.eq('标签组回收站套件全程零 pageerror', withoutKnownNoise(opened.capture.pageErrors).real, [])
    } finally {
      await opened.context.close()
    }
    return screenshots
  },
}
