/**
 * 二级菜单（就地展开的子项）的缩进（#126）。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与 `driftSuites.ts` / `recycleEntrySuites.ts` /
 * `selectionBarSuites.ts` 同一条：那个文件是本批开发的合入热点，新套件放外面能少一半冲突面。
 * 注册方式是在 `suites.ts` 的 `SUITES` 末尾追加一项。
 *
 * 期望值**不硬编码**：缩进量 = 紧凑档的图标槽 + 项内间隙，直接从 `workspaceTree/styles.ts`
 * 的 `SCALE_TIERS.compact` 里读（`iconSize` + `rowGap`）——档位表改了值，本套件跟着走。
 *
 * 断言的口径是**关系不变量**（#126 正文）：子项文字左缘 − 父项文字左缘 = 那个和（±1px），
 * 而不是某个绝对坐标（绝对坐标会随菜单在屏幕上的位置变）。同时钉住三件容易一起坏掉的观感：
 * 子项自己的图标与文字仍然相邻（不因为缩进脱开）、所有子项的文字落在同一列（有没有图标都一样）、
 * 勾选态 ✓ 与右端 ▸/▾ 的几何不受影响。
 *
 * 数据面：真实网关**只读** + 假宿主 + 树层注入的分组状态（`groups`）与标签组状态（`tags`）。
 * 归档确认、新建会话这类会写网关的动作一律不点。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { openTreePage, withoutKnownNoise, type OpenedPage } from './harness.ts'
import { LAB_TREES, type LabTreeRoute } from './labServer.ts'
import { SCALE_TIERS } from '../../src/ui/assembly/shell/workspaceTree/styles.ts'
// 只取类型（编译后不留 import，运行期没有环）：套件接口定义在 suites.ts 里。
import type { LabSuite } from './suites.ts'

const route = (name: string): LabTreeRoute => {
  const found = LAB_TREES.find((candidate) => candidate.route === name)
  if (found === undefined) throw new Error(`lab: unknown tree route ${name}`)
  return found
}

/** 期望的缩进量：紧凑档的图标槽 + 项内间隙（出处见 styles.ts 那条规则上方）。 */
const EXPECTED_INDENT = Number.parseFloat(SCALE_TIERS.compact.iconSize) + Number.parseFloat(SCALE_TIERS.compact.rowGap)

/** 菜单项的一条几何事实（页面侧一次量完，避免多次 round-trip 之间的抖动）。 */
interface ItemGeometry {
  marker: string
  text: string
  /** 项盒子（官方那个 `<button role="menuitem">`）的左缘 / 右缘 / 宽。 */
  itemLeft: number
  itemRight: number
  itemWidth: number
  /** 文字左缘（项里那个带自有标记的 span 的几何矩形）。 */
  labelLeft: number
  /** 图标槽的左缘与右缘（官方 14×14 的盒子；没有图标时是补上的空槽）。 */
  iconLeft: number | null
  iconRight: number | null
  /** 文字左缘 − 图标槽右缘（应当还是紧凑档的项内间隙 6px）。 */
  iconTextGap: number | null
  /** 右端勾（官方 selectedIds 或画在图标槽里的 ✓）的右缘；没有就是 null。 */
  checkRight: number | null
  /** 项里的子元素个数（官方渲染：图标槽 + 文字 + 可选勾）。 */
  childCount: number
  /** 文字外层是不是我们包的那一层（`.dshOneTree_submenuItem`）。 */
  indentWrapped: boolean
  /** 子项归属勾选态（`data-dshone-group-checked`，工作区菜单的子项才带）。 */
  checked: string | null
}

interface SubmenuGeometry {
  /** 页面上开着的菜单个数（就地展开不新增菜单，所以始终是 1）。 */
  menuCount: number
  parent: ItemGeometry | null
  children: ItemGeometry[]
  /** 父项右端那个 ▸/▾ 的几何与文字（量「指示不受影响」用）。 */
  arrow: { left: number; right: number; width: number; text: string } | null
}

/**
 * 量一次「父项 + 就地展开的子项」的几何。
 *
 * 只按自有标记取元素（`data-dshone-tree-item` / `.dshOneTree_submenuItem`），不认官方
 * css-module 的哈希类名；图标槽按「项里那个不含文字标记的 span」认（官方项的结构是
 * 「图标槽 span + 文字 span + 可选勾」，见 rows.ts 里 indentSubmenuItem 的说明）。
 */
async function submenuGeometry(
  page: OpenedPage['page'],
  spec: { parent: string; childPrefix: string },
): Promise<SubmenuGeometry> {
  return page.evaluate((s: { parent: string; childPrefix: string }) => {
    const menus = Array.from(document.querySelectorAll('[role="menu"]'))
    const menu: Element | null = menus.length === 0 ? null : (menus[menus.length - 1] ?? null)
    const read = (mark: Element | null): ItemGeometry | null => {
      if (mark === null) return null
      const button = mark.closest('button[role="menuitem"]')
      if (button === null) return null
      const item = button.getBoundingClientRect()
      const label = mark.getBoundingClientRect()
      const iconBox = Array.from(button.children).find((child) => child.tagName === 'SPAN' && !child.contains(mark)) ?? null
      const icon = iconBox === null ? null : iconBox.getBoundingClientRect()
      const check = Array.from(button.children).find((child) => child.tagName !== 'SPAN') ?? null
      return {
        marker: mark.getAttribute('data-dshone-tree-item') ?? '',
        text: (mark.textContent ?? '').trim(),
        itemLeft: item.left,
        itemRight: item.right,
        itemWidth: item.width,
        labelLeft: label.left,
        iconLeft: icon === null ? null : icon.left,
        iconRight: icon === null ? null : icon.right,
        iconTextGap: icon === null ? null : label.left - icon.right,
        checkRight: check === null ? null : check.getBoundingClientRect().right,
        childCount: button.children.length,
        indentWrapped: mark.closest('.dshOneTree_submenuItem') !== null,
        checked: mark.getAttribute('data-dshone-group-checked'),
      }
    }
    const parentMark = menu === null ? null : menu.querySelector(`[data-dshone-tree-item="${s.parent}"]`)
    const arrowElement = menu === null ? null : menu.querySelector('.dshOneTree_submenuArrow')
    const children =
      menu === null
        ? []
        : Array.from(menu.querySelectorAll('[data-dshone-tree-item]'))
            .filter((mark) => (mark.getAttribute('data-dshone-tree-item') ?? '').startsWith(s.childPrefix))
            .map((mark) => read(mark))
            .filter((entry): entry is ItemGeometry => entry !== null)
    return {
      menuCount: menus.length,
      parent: read(parentMark),
      children,
      arrow:
        arrowElement === null
          ? null
          : (() => {
              const box = arrowElement.getBoundingClientRect()
              return { left: box.left, right: box.right, width: box.width, text: (arrowElement.textContent ?? '').trim() }
            })(),
    }
  }, spec)
}

/** 当前最后一个菜单里顶层项的标记（子项与标题行不算，与 F-19 的口径一致）。 */
async function topLevelMarkers(page: OpenedPage['page']): Promise<string[]> {
  return page.evaluate(() => {
    const menus = Array.from(document.querySelectorAll('[role="menu"]'))
    const menu = menus.length === 0 ? null : (menus[menus.length - 1] ?? null)
    if (menu === null) return []
    return Array.from(menu.querySelectorAll('button[role="menuitem"]'))
      .map((button) => button.querySelector('[data-dshone-tree-item]'))
      .filter((mark): mark is Element => mark !== null)
      .map((mark) => mark.getAttribute('data-dshone-tree-item') ?? '')
      .filter((marker) => marker !== 'menu-title' && !marker.startsWith('tag:') && marker !== 'workspace-group-item')
  })
}

/** 当前开着几个 `[role="menu"]`（就地展开不该让它变多，也不该让它消失）。 */
async function menuCount(page: OpenedPage['page']): Promise<number> {
  return page.evaluate(() => document.querySelectorAll('[role="menu"]').length)
}

/** 树里第一条带 ⋯ 的会话行（及其所属工作区键）。 */
async function sessionFixture(page: OpenedPage['page']): Promise<{ key: string; id: string; members: string[] } | null> {
  return page.evaluate(() => {
    for (const section of Array.from(document.querySelectorAll('[data-dshone-group-key]'))) {
      const rows = Array.from(section.querySelectorAll('[data-dshone-tree-row="session"]')).filter(
        (row) => row.querySelector('[data-dshone-tree-action="session-menu"]') !== null,
      )
      if (rows.length >= 3) {
        const at = (index: number): string => rows[index]?.getAttribute('data-dshone-tree-session') ?? ''
        return { key: section.getAttribute('data-dshone-group-key') ?? '', id: at(0), members: [at(1), at(2)] }
      }
    }
    return null
  })
}

/** 假宿主的状态存储（与 F-19 的 `hostState` 同一读法，只是本文件自带一份，免动热点文件）。 */
async function hostState(page: OpenedPage['page'], key: string): Promise<unknown> {
  return page.evaluate((name: string) => {
    const host = (globalThis as unknown as { __LAB_HOST__?: { stateStore?: Record<string, unknown> } }).__LAB_HOST__
    const store = host?.stateStore ?? {}
    const readKey = Object.keys(store).find((candidate) => candidate === name || candidate.endsWith(`/${name}`)) ?? name
    const value = store[readKey]
    return typeof value === 'string' ? JSON.parse(value) : value
  }, key)
}

/** 展开一行的工作区（工作区行收起时里面的会话不渲染），点它一次即展开。 */
async function expandAllWorkspaces(page: OpenedPage['page']): Promise<void> {
  await page.evaluate(() => {
    for (const row of Array.from(document.querySelectorAll('[data-dshone-tree-row="workspace"]'))) {
      if (row.getAttribute('aria-expanded') !== 'true') (row as HTMLElement).click()
    }
  })
  await page.waitForTimeout(400)
}

/** 开某一行的 ⋯ 菜单（行操作悬停才显形，所以先 hover）。 */
async function openSessionMenu(page: OpenedPage['page'], sessionId: string): Promise<void> {
  const row = page.locator(`[data-dshone-tree-session="${sessionId}"]`)
  await row.hover()
  await row.locator('[data-dshone-tree-action="session-menu"]').click()
  await page.waitForTimeout(250)
}

/** 行右键开同一份菜单（工作区行没有 ⋯ 按钮，只能用右键那一份）。 */
async function openRowContextMenu(page: OpenedPage['page'], selector: string): Promise<boolean> {
  const row = page.locator(selector)
  const box = await row.boundingBox()
  if (box === null) return false
  await row.click({ button: 'right', position: { x: 80, y: Math.round(box.height / 2) } })
  await page.waitForTimeout(300)
  return true
}

/**
 * 二级菜单（就地展开的子项）的缩进（#126）。量的是**关系不变量**：子项文字左缘 −
 * 父项文字左缘 = 紧凑档的图标槽 14px + 项内间隙 6px（±1px），两个菜单各量一遍；
 * 另钉子项的图标与文字仍相邻、所有子项落在同一列、✓ 与 ▸/▾ 的几何不受影响，
 * 以及「没有标签组时的缺席」与「二级项点击不关菜单、✓ 就地翻转」两条既有行为。
 */
export const SUBMENU_INDENT_SUITE: LabSuite = {
  id: 'F-32',
  phase: 'new-feature',
  name: '二级菜单的缩进（#126）：子项文字比父项深一个图标槽 + 项内间隙（会话菜单与工作区菜单同一口径，SUBMENU-INDENT 套件）',
  expect: `二级菜单（会话菜单的「移到分组…」与工作区菜单的「分组…」就地展开出来的子项）在真实装配页上（真网关**只读** + 假宿主 + 注入的分组状态与标签组状态）量关系不变量，不量绝对坐标：① **会话菜单**：子项文字左缘 − 父项文字左缘 = 紧凑档的图标槽 14px + 项内间隙 6px = ${String(EXPECTED_INDENT)}px（±1px，期望值从 styles.ts 的 SCALE_TIERS 读，不写死）；② **工作区菜单**同一 helper，量同一条关系，读数与①一致；③ **没有标签组 / 没有自定义分组时的缺席**——会话菜单的「移到分组…」恒在场（一个组都没有时也渲染，不然新建第一个组没有入口，出处是 tree.ts 里那一节的注释），所以这一侧断的是「标签组那几条子项一条都不出现、只剩两条固定入口（不归入标签组 / 新建标签组）」，而工作区菜单的「分组…」在没有自定义分组时**整项不渲染**；**有**组时父项点一下展开、再点一下收起、菜单两次都还开着（父项行为不变）；④ **二级项点击不关菜单、✓ 就地翻转**（回归）：工作区菜单的子项点一下就勾上（菜单仍开着、文字列一分不动），再点一下取消；会话菜单的子项点完后那一行会搬进对应标签组（行换父节点 → 菜单跟着收起，这是既有行为），重开菜单时该项带官方 ✓、文字仍在同一列。另外钉住三件容易被缩进带坏的事：子项的图标槽与文字**仍然相邻**（间距还是紧凑档的 6px，不是把文字推远）、**所有**子项的文字落在同一列（有没有图标都一样）、父项右端 ▸/▾ 与子项的 ✓ 的几何不受影响（▸→▾ 只是换字形，勾不把文字挤走）。全程零 pageerror，不点任何会写网关的动作。`,
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

      // ---- ③ 前半：没有标签组 / 没有自定义分组时的两次缺席 ----
      // 会话菜单的「移到分组…」**恒在场**（tree.ts 的口径：#107 里一个组都没有时也渲染，
      // 不然新建第一个组没有入口——拖拽只能把会话拖进已经存在的组），所以这一侧要断的是
      // 「**标签组那几条子项**一条都不出现，只剩两条固定入口」；工作区菜单的「分组…」才是
      // 真缺席（`groups` 为空时整项不渲染）。
      const fixture = await sessionFixture(page)
      check.fact(`夹具会话：${JSON.stringify(fixture)}`)
      check.ok(
        '找到一条没归组的会话行（同区块另有两条可挂进标签组）',
        fixture !== null && fixture.id !== '' && fixture.members.every((id) => id !== ''),
      )
      if (fixture === null || fixture.id === '' || !fixture.members.every((id) => id !== '')) return screenshots

      await openSessionMenu(page, fixture.id)
      const bareSession = await topLevelMarkers(page)
      const bareCollapsed = await submenuGeometry(page, { parent: 'moveToGroup', childPrefix: 'tag:' })
      check.fact(`没有标签组时的会话菜单项序：${JSON.stringify(bareSession)}`)
      check.eq('没有标签组时「移到分组…」展开前一条子项都不渲染', bareCollapsed.children.length, 0)
      await page.click('[data-dshone-tree-item="moveToGroup"]')
      await page.waitForTimeout(300)
      const bareExpanded = await submenuGeometry(page, { parent: 'moveToGroup', childPrefix: 'tag:' })
      check.fact(
        `没有标签组时「移到分组…」展开后子项：${JSON.stringify(bareExpanded.children.map((child) => child.text))}`,
      )
      check.eq('没有标签组时只剩两条固定入口（不归入标签组 / 新建标签组）', bareExpanded.children.map((child) => child.text), [
        '不归入标签组',
        '新建标签组',
      ])
      check.ok(
        '没有标签组时没有任何 `tag:` 子项（标签组那几条随数据缺席）',
        bareExpanded.children.every((child) => !child.marker.startsWith('tag:t-')),
        JSON.stringify(bareExpanded.children.map((child) => child.marker)),
      )
      check.eq('没有标签组时展开也不关菜单（父项行为不变）', bareExpanded.menuCount, 1)
      const bareParent = bareExpanded.parent
      if (bareParent !== null && bareExpanded.children.length === 2) {
        const bareRelations = bareExpanded.children.map((child) => child.labelLeft - bareParent.labelLeft)
        check.fact(`没有标签组时：子项文字左缘 − 父项文字左缘 = ${JSON.stringify(bareRelations.map((value) => Number(value.toFixed(2))))}`)
        check.ok(
          `两条固定入口都是无图标的子项，缩进仍是 ${String(EXPECTED_INDENT)}px（空图标槽占位生效）`,
          bareRelations.every((value) => Math.abs(value - EXPECTED_INDENT) <= 1),
          JSON.stringify(bareRelations.map((value) => Number(value.toFixed(2)))),
        )
      }
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)

      const workspaceRowKeys = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-dshone-tree-row="workspace"]')).map(
          (row) => row.getAttribute('data-dshone-tree-key') ?? '',
        ),
      )
      const realWorkspaceKey = workspaceRowKeys.find((key) => key !== '') ?? ''
      check.ok('网关上有真实工作区行可比（工作区菜单要用它）', realWorkspaceKey !== '', JSON.stringify(workspaceRowKeys))
      if (realWorkspaceKey !== '') {
        const rowSelector = `[data-dshone-tree-row="workspace"][data-dshone-tree-key="${realWorkspaceKey}"]`
        const openedContextMenu = await openRowContextMenu(page, rowSelector)
        check.ok('工作区行右键开出菜单（工作区行没有 ⋯ 按钮）', openedContextMenu)
        const bareWorkspace = await topLevelMarkers(page)
        check.fact(`没有自定义分组时的工作区菜单项序：${JSON.stringify(bareWorkspace)}`)
        check.ok('没有自定义分组时「分组…」整项不出现', !bareWorkspace.includes('groups'))
        await page.keyboard.press('Escape')
        await page.waitForTimeout(200)
      }

      // ---- 注入分组与标签组（树层读的是假宿主的状态存储，所以要重载一次页面）----
      const groupsState = {
        version: 1,
        groups: [
          { id: 'g-lab-one', name: 'Lab One' },
          { id: 'g-lab-two', name: 'Lab Two' },
        ],
        membership: {},
        activeGroupId: null,
      }
      const tagState = {
        version: 2,
        workspaces: {
          [fixture.key]: {
            tags: [
              { id: 't-one', name: '组一', color: 'blue' },
              { id: 't-two', name: '组二', color: 'green' },
            ],
            // 每个组挂一条成员（#107 的空组会被清掉，不挂成员这一组就留不住）。
            sessionTags: { [fixture.members[0]]: 't-one', [fixture.members[1]]: 't-two' },
          },
        },
      }
      await page.addInitScript({
        content: `(() => { globalThis.__LAB_HOST__.stateStore['groups'] = ${JSON.stringify(groupsState)}; globalThis.__LAB_HOST__.stateStore['tags'] = ${JSON.stringify(tagState)} })()`,
      })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector(route('sidebar').readySelector, { timeout: 40_000 })
      await page.waitForTimeout(2_500)
      await expandAllWorkspaces(page)
      check.fact(`注入后宿主里的 tags：${JSON.stringify(await hostState(page, 'tags'))}`)

      const sessionId = fixture.id
      const stillThere = await page.evaluate(
        (id: string) => document.querySelector(`[data-dshone-tree-session="${id}"]`) !== null,
        sessionId,
      )
      check.ok('重载后夹具那一行还在（会话没被注入弄丢）', stillThere)

      // ---- ① 会话菜单：父项 + 四个子项的几何 ----
      await openSessionMenu(page, sessionId)
      const collapsed = await submenuGeometry(page, { parent: 'moveToGroup', childPrefix: 'tag:' })
      check.ok('会话菜单里有「移到分组…」父项', collapsed.parent !== null)
      check.eq('「移到分组…」展开前没有子项（二级菜单点一下才展开）', collapsed.children.length, 0)
      const collapsedArrow = collapsed.arrow
      await page.click('[data-dshone-tree-item="moveToGroup"]')
      await page.waitForTimeout(300)
      const expanded = await submenuGeometry(page, { parent: 'moveToGroup', childPrefix: 'tag:' })
      const parent = expanded.parent
      check.fact(
        `会话菜单「移到分组…」展开后：父项文字左缘=${parent?.labelLeft.toFixed(1) ?? '无'} 子项=${JSON.stringify(
          expanded.children.map((child) => ({ t: child.text, labelLeft: child.labelLeft.toFixed(1), iconLeft: child.iconLeft?.toFixed(1) ?? null })),
        )}`,
      )
      check.eq('展开出四个子项（组一 / 组二 / 不归入标签组 / 新建标签组）', expanded.children.map((child) => child.text), [
        '组一',
        '组二',
        '不归入标签组',
        '新建标签组',
      ])
      check.eq('展开后菜单没关（子项追加在同一份菜单里，就地展开）', expanded.menuCount, 1)
      check.ok(
        '每个子项的文字都带缩进标记类（`.dshOneTree_submenuItem`）',
        expanded.children.length > 0 && expanded.children.every((child) => child.indentWrapped),
        JSON.stringify(expanded.children.map((child) => child.indentWrapped)),
      )
      if (parent !== null && expanded.children.length === 4) {
        const relations = expanded.children.map((child) => child.labelLeft - parent.labelLeft)
        check.fact(`会话菜单：子项文字左缘 − 父项文字左缘 = ${JSON.stringify(relations.map((value) => Number(value.toFixed(2))))}`)
        check.ok(
          `① 会话菜单：子项文字左缘 − 父项文字左缘 = 图标槽 ${SCALE_TIERS.compact.iconSize} + 项内间隙 ${SCALE_TIERS.compact.rowGap} = ${String(EXPECTED_INDENT)}px（±1）`,
          relations.every((value) => Math.abs(value - EXPECTED_INDENT) <= 1),
          JSON.stringify(relations.map((value) => Number(value.toFixed(2)))),
        )
        check.ok(
          '所有子项的文字落在同一列（有没有图标都是同一个值）',
          Math.max(...relations) - Math.min(...relations) <= 1,
          JSON.stringify(relations.map((value) => Number(value.toFixed(2)))),
        )
        check.ok(
          '子项的行盒左缘与父项一致（缩进落在项内，不是把整行推进去）',
          expanded.children.every((child) => Math.abs(child.itemLeft - parent.itemLeft) <= 0.5 && Math.abs(child.itemWidth - parent.itemWidth) <= 0.5),
          JSON.stringify(expanded.children.map((child) => `${child.itemLeft.toFixed(1)}/${child.itemWidth.toFixed(1)}`)),
        )
        check.ok(
          '子项的图标槽比父项的图标槽右移同一个缩进量（整行一起缩进）',
          expanded.children.every(
            (child) => child.iconLeft !== null && parent.iconLeft !== null && Math.abs(child.iconLeft - parent.iconLeft - EXPECTED_INDENT) <= 1,
          ),
          JSON.stringify(expanded.children.map((child) => `${child.iconLeft?.toFixed(1) ?? '无'}`)),
        )
        check.ok(
          '子项的图标与文字仍然相邻（间距还是紧凑档的项内间隙 6px，没被缩进推远）',
          expanded.children.every(
            (child) => child.iconTextGap !== null && Math.abs(child.iconTextGap - Number.parseFloat(SCALE_TIERS.compact.rowGap)) <= 1,
          ),
          JSON.stringify(expanded.children.map((child) => child.iconTextGap?.toFixed(2) ?? '无')),
        )
        check.ok(
          '没有图标的子项也占住图标槽（14px 的盒子在场，所以文字列不会塌回去）',
          expanded.children.every((child) => child.iconLeft !== null && child.iconRight !== null && Math.abs(child.iconRight - child.iconLeft) <= 0.5 + Number.parseFloat(SCALE_TIERS.compact.iconSize)),
          JSON.stringify(expanded.children.map((child) => (child.iconRight === null || child.iconLeft === null ? '无' : (child.iconRight - child.iconLeft).toFixed(1)))),
        )
      }
      // 右端 ▸ → ▾：只换字形，几何不走位（用户报的那一处「平」不能顺手把指示也动了）。
      check.ok(
        '「移到分组…」的展开指示从 ▸ 翻成 ▾，位置与宽度没变',
        collapsedArrow !== null &&
          expanded.arrow !== null &&
          collapsedArrow.text === '\u25b8' &&
          expanded.arrow.text === '\u25be' &&
          Math.abs(collapsedArrow.left - expanded.arrow.left) <= 0.5 &&
          Math.abs(collapsedArrow.width - expanded.arrow.width) <= 0.5,
        `展开前=${JSON.stringify(collapsedArrow)} 展开后=${JSON.stringify(expanded.arrow)}`,
      )
      check.ok(
        '展开指示仍在项内（没有越出项盒子）',
        parent !== null && expanded.arrow !== null && expanded.arrow.right <= parent.itemRight + 0.5,
        `arrowRight=${expanded.arrow?.right.toFixed(1) ?? '无'} itemRight=${parent?.itemRight.toFixed(1) ?? '无'}`,
      )
      screenshots.push(await shot(page, 'submenu-indent-session'))

      // ---- ③ 后半：父项再点一下收起，菜单仍然开着（父项行为不变）----
      await page.click('[data-dshone-tree-item="moveToGroup"]')
      await page.waitForTimeout(300)
      const afterCollapse = await submenuGeometry(page, { parent: 'moveToGroup', childPrefix: 'tag:' })
      check.eq('父项再点一下收起子项', afterCollapse.children.length, 0)
      check.eq('收起子项后菜单还开着（就地开合，不关菜单）', afterCollapse.menuCount, 1)

      // ---- ④ 会话菜单的子项：点一项就归组（那一行会搬进标签组，菜单跟着收起）；重开时 ✓ 落在组一上 ----
      // 这一侧「点击不关菜单」不成立（既有行为，见下）：子项一改归属，那一行就换父节点搬进
      // 组块、React 重挂，挂在行上的菜单跟着收起；所以这里断的是它的等价结果（归属写回 +
      // 重开菜单时 ✓ 落在组一上 + 文字仍在同一列）。
      await page.click('[data-dshone-tree-item="moveToGroup"]')
      await page.waitForTimeout(300)
      await page.click('[data-dshone-tree-item="tag:t-one"]')
      await page.waitForTimeout(600)
      const tagsAfterPick = await hostState(page, 'tags')
      check.fact(`点「组一」后的宿主 tags：${JSON.stringify(tagsAfterPick)}`)
      check.ok(
        '点「组一」把这一行的归属写回宿主状态',
        JSON.stringify(tagsAfterPick ?? '').includes('t-one'),
        JSON.stringify(tagsAfterPick),
      )
      // 行搬进标签组后菜单可能已经收起（行换了父节点，React 重挂）——这里只用它当依据重开一次。
      await page.keyboard.press('Escape')
      await page.waitForTimeout(250)
      await expandAllWorkspaces(page)
      const grouped = await page.evaluate(
        (id: string) =>
          Array.from(document.querySelectorAll('[data-dshone-tree="tag-block"]')).some(
            (block) => block.querySelector(`[data-dshone-tree-session="${id}"]`) !== null,
          ),
        sessionId,
      )
      check.fact(`那一行是否落在某个标签组块里：${String(grouped)}`)
      await openSessionMenu(page, sessionId)
      const reopened = await submenuGeometry(page, { parent: 'moveToGroup', childPrefix: 'tag:' })
      check.eq('重开菜单时子项默认收起（与父项行为一致）', reopened.children.length, 0)
      await page.click('[data-dshone-tree-item="moveToGroup"]')
      await page.waitForTimeout(300)
      const checked = await submenuGeometry(page, { parent: 'moveToGroup', childPrefix: 'tag:' })
      const checkedChild = checked.children.find((child) => child.text === '组一') ?? null
      check.fact(
        `重开后「组一」子项：${JSON.stringify(checkedChild === null ? null : { checked: checkedChild.checked, childCount: checkedChild.childCount, labelLeft: checkedChild.labelLeft.toFixed(1) })}`,
      )
      check.eq('重开菜单时「组一」项带官方勾选态（selectedIds 的 ✓）', checkedChild?.childCount, 3)
      check.ok(
        '带勾的子项文字仍在同一列（勾不把文字挤走）',
        checkedChild !== null && checked.parent !== null && Math.abs(checkedChild.labelLeft - checked.parent.labelLeft - EXPECTED_INDENT) <= 1,
        `子项=${checkedChild?.labelLeft.toFixed(1) ?? '无'} 父项=${checked.parent?.labelLeft.toFixed(1) ?? '无'}`,
      )
      check.ok(
        '官方勾（✓）落在项的右端、不越过项盒',
        checkedChild !== null && checkedChild.checkRight !== null && checkedChild.checkRight <= checkedChild.itemRight + 0.5,
        `checkRight=${checkedChild?.checkRight?.toFixed(1) ?? '无'} itemRight=${checkedChild?.itemRight.toFixed(1) ?? '无'}`,
      )
      screenshots.push(await shot(page, 'submenu-indent-session-checked'))
      await page.keyboard.press('Escape')
      await page.waitForTimeout(250)

      // ---- ② / ④ 工作区菜单：同一条关系，且「点击不关菜单、✓ 就地翻转」在这里成立 ----
      const workspaceKey = await page.evaluate(() => {
        const row = document.querySelector('[data-dshone-tree-row="workspace"]')
        return row?.getAttribute('data-dshone-tree-key') ?? ''
      })
      const rowSelector = `[data-dshone-tree-row="workspace"][data-dshone-tree-key="${workspaceKey}"]`
      check.ok('找到一条真实工作区行（右键开「分组…」菜单）', workspaceKey !== '', workspaceKey)
      if (workspaceKey !== '') {
        const openedContextMenu = await openRowContextMenu(page, rowSelector)
        check.ok('工作区行右键开出菜单', openedContextMenu)
        await page.click('[data-dshone-tree-item="groups"]')
        await page.waitForTimeout(300)
        const wsExpanded = await submenuGeometry(page, { parent: 'groups', childPrefix: 'workspace-group-item' })
        const wsParent = wsExpanded.parent
        check.fact(
          `工作区菜单「分组…」展开后：父项文字左缘=${wsParent?.labelLeft.toFixed(1) ?? '无'} 子项=${JSON.stringify(
            wsExpanded.children.map((child) => ({ t: child.text, labelLeft: child.labelLeft.toFixed(1) })),
          )}`,
        )
        check.eq('「分组…」展开出两个自定义分组', wsExpanded.children.map((child) => child.text), ['Lab One', 'Lab Two'])
        check.eq('「分组…」展开后菜单没关', wsExpanded.menuCount, 1)
        if (wsParent !== null && wsExpanded.children.length === 2) {
          const relations = wsExpanded.children.map((child) => child.labelLeft - wsParent.labelLeft)
          check.fact(`工作区菜单：子项文字左缘 − 父项文字左缘 = ${JSON.stringify(relations.map((value) => Number(value.toFixed(2))))}`)
          check.ok(
            `② 工作区菜单：子项文字左缘 − 父项文字左缘 = ${String(EXPECTED_INDENT)}px（±1，与①同一个 helper、同一个值）`,
            relations.every((value) => Math.abs(value - EXPECTED_INDENT) <= 1),
            JSON.stringify(relations.map((value) => Number(value.toFixed(2)))),
          )
          check.ok(
            '所有子项的文字落在同一列（未勾选的子项也占住图标槽）',
            Math.max(...relations) - Math.min(...relations) <= 1,
            JSON.stringify(relations.map((value) => Number(value.toFixed(2)))),
          )
          check.ok(
            '子项的图标槽比父项的图标槽右移同一个缩进量',
            wsExpanded.children.every(
              (child) => child.iconLeft !== null && wsParent.iconLeft !== null && Math.abs(child.iconLeft - wsParent.iconLeft - EXPECTED_INDENT) <= 1,
            ),
            JSON.stringify(wsExpanded.children.map((child) => child.iconLeft?.toFixed(1) ?? '无')),
          )
        }
        screenshots.push(await shot(page, 'submenu-indent-workspace'))

        // ④ 点一项：菜单不关、✓ 就地翻转、文字列一分不动。
        const before = await submenuGeometry(page, { parent: 'groups', childPrefix: 'workspace-group-item' })
        await page.click('[data-dshone-tree-item="workspace-group-item"]')
        await page.waitForTimeout(400)
        const afterCheck = await submenuGeometry(page, { parent: 'groups', childPrefix: 'workspace-group-item' })
        const firstBefore = before.children[0] ?? null
        const firstAfter = afterCheck.children[0] ?? null
        const membership = (await hostState(page, 'groups')) as { membership?: Record<string, string[]> } | null
        check.fact(
          `勾选第一项后：子项=${JSON.stringify(firstAfter === null ? null : { checked: firstAfter.checked, childCount: firstAfter.childCount, labelLeft: firstAfter.labelLeft.toFixed(1) })} 宿主归属=${JSON.stringify(membership?.membership)}`,
        )
        check.eq('点一下子项就勾上（就地翻转 ✓）', firstAfter?.checked, 'true')
        check.eq('勾选后菜单仍然开着（连勾几个组不用重开）', afterCheck.menuCount, 1)
        check.ok(
          '✓ 出现没有把文字挤走（文字左缘一分不动）',
          firstBefore !== null && firstAfter !== null && Math.abs(firstAfter.labelLeft - firstBefore.labelLeft) <= 0.5,
          `勾前=${firstBefore?.labelLeft.toFixed(1) ?? '无'} 勾后=${firstAfter?.labelLeft.toFixed(1) ?? '无'}`,
        )
        check.ok(
          '勾选写回宿主状态（该工作区记上这个分组）',
          Object.values(membership?.membership ?? {}).some((ids) => Array.isArray(ids) && ids.includes('g-lab-one')),
          JSON.stringify(membership?.membership),
        )
        await page.click('[data-dshone-tree-item="workspace-group-item"]')
        await page.waitForTimeout(400)
        const afterUncheck = await submenuGeometry(page, { parent: 'groups', childPrefix: 'workspace-group-item' })
        check.eq('再点一次就地取消勾选（同一入口的开关语义）', afterUncheck.children[0]?.checked, 'false')
        check.eq('取消勾选后菜单还开着', afterUncheck.menuCount, 1)
        check.ok(
          '取消勾选后文字仍在同一列（与①同一条关系）',
          afterUncheck.children.length > 0 &&
            afterUncheck.parent !== null &&
            afterUncheck.children.every((child) => Math.abs(child.labelLeft - (afterUncheck.parent?.labelLeft ?? child.labelLeft) - EXPECTED_INDENT) <= 1),
          JSON.stringify(afterUncheck.children.map((child) => Number((child.labelLeft - (afterUncheck.parent?.labelLeft ?? 0)).toFixed(2)))),
        )
        screenshots.push(await shot(page, 'submenu-indent-workspace-checked'))
        await page.keyboard.press('Escape')
        await page.waitForTimeout(200)
      }

      check.eq('二级菜单缩进套件全程零 pageerror', withoutKnownNoise(opened.capture.pageErrors).real, [])
    } finally {
      await opened.context.close()
    }
    return screenshots
  },
}
