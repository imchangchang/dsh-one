/**
 * 「管理分组…」里的成员清单（#139）：点分组名进第二层——该组的**成员清单**（全部工作区
 * + 勾选 + 搜索 + 全选 / 清空 + 返回），勾选即时落盘。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与其它的独立套件文件同一条：那个文件是本批
 * 开发的合入热点（末尾只加一行注册）。
 *
 * 期望值**不硬编码**：几何读数直接与 `workspaceTree/styles.ts` 的 `SCALE_TIERS` 比
 * （出处判定复用 `scaleSuites.ts` 的 `sourceOf`，与 F-23 SCALE / F-34 MODAL-COMPACT 同口径），
 * 成员关系一律与**假宿主状态存储里的那一份**比（页面 ➜ 状态方向与状态 ➜ 页面方向都验）。
 *
 * 本套件**不动网关的写面**：只做渲染与页面内交互，另在收尾断言全程没有走任何写类 RPC
 * （`/api/` 的方法名逐个记下来过）。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { openTreePage, withoutKnownNoise, type Check, type OpenedPage, hasText } from './harness.ts'
import { LAB_TREES, type LabTreeRoute } from './labServer.ts'
import { SCALE_TIERS } from '../../src/ui/assembly/shell/workspaceTree/styles.ts'
import { EN, ZH } from '../../src/ui/assembly/shell/workspaceTree/locale.ts'
import { sourceOf } from './scaleSuites.ts'
import { SIDEBAR_DATASET } from './dataset.ts'
// 只取类型（编译后不留 import，运行期没有环）：套件接口定义在 suites.ts 里。
import type { LabSuite } from './suites.ts'

const route = (name: string): LabTreeRoute => {
  const found = LAB_TREES.find((candidate) => candidate.route === name)
  if (found === undefined) throw new Error(`lab: unknown tree route ${name}`)
  return found
}

/** 分组夹具：第一个工作区**同时在两个组里**（多对多的回显要它），第三个组一个成员都没有。 */
const GROUPS = [
  { id: 'g-lab-one', name: 'Lab One' },
  { id: 'g-lab-two', name: 'Lab Two' },
  { id: 'g-lab-empty', name: 'Lab Empty' },
]

/** 写类 RPC（改网关上的东西）：本套件全程都不许出现（网关只读）。 */
const WRITE_METHODS = [
  'session/create',
  'session/rename',
  'session/fork',
  'session/prompt',
  'session/cancel',
  'workspace/create',
  'workspace/delete',
  'workspace/archiveSession',
]

interface WorkspaceRow {
  id: string
  label: string
}

/** 树里当前渲染的工作区行（id + 标题，按页面顺序）。 */
async function treeWorkspaces(page: OpenedPage['page']): Promise<WorkspaceRow[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-dshone-tree-row="workspace"]'))
      .map((row) => ({
        id: row.getAttribute('data-dshone-tree-key') ?? '',
        label: row.querySelector('.dshOneTree_title')?.textContent ?? '',
      }))
      .filter((row) => row.id !== ''),
  )
}

interface HostGroupsFile {
  groups: { id: string; name: string }[]
  membership: Record<string, string[]>
}

/** 假宿主状态存储里的分组文件（套件只读它，不看界面自己算的那一份）。 */
async function hostGroups(page: OpenedPage['page']): Promise<HostGroupsFile | null> {
  return page.evaluate(() => {
    const host = (globalThis as unknown as { __LAB_HOST__?: { stateStore?: Record<string, unknown> } }).__LAB_HOST__
    const value = host?.stateStore?.['groups']
    if (value === undefined || value === null) return null
    const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value
    return parsed as { groups: { id: string; name: string }[]; membership: Record<string, string[]> }
  })
}

/** 宿主状态里某组的成员（工作区 id，排好序）。 */
function membersOf(file: HostGroupsFile | null, groupId: string): string[] {
  const out: string[] = []
  for (const [workspaceId, ids] of Object.entries(file?.membership ?? {})) {
    if (ids.includes(groupId)) out.push(workspaceId)
  }
  return out.sort()
}

interface ManageRow {
  id: string
  name: string
  count: number
  /** 名字那一格是不是进成员清单的入口（#139）。 */
  entry: boolean
}

/** 分组列表（管理框第一层）的读数。 */
async function manageList(page: OpenedPage['page']): Promise<ManageRow[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-dshone-manage-group]')).map((row) => ({
      id: row.getAttribute('data-dshone-manage-group') ?? '',
      name: row.querySelector('.dshOneTree_manageName')?.textContent ?? '',
      count: Number(row.querySelector('.dshOneTree_manageCount')?.textContent ?? ''),
      entry: row.querySelector('[data-dshone-tree-action="group-members"]') !== null,
    })),
  )
}

/** 分组列表里某一组的计数。 */
async function groupCount(page: OpenedPage['page'], groupId: string): Promise<number> {
  return page.evaluate((id: string) => {
    const row = document.querySelector(`[data-dshone-manage-group="${id}"]`)
    return Number(row?.querySelector('.dshOneTree_manageCount')?.textContent ?? '-1')
  }, groupId)
}

interface MemberRowFacts {
  id: string
  name: string
  /** 行上的状态标记（`data-dshone-member-state`）。 */
  state: string
  /** 行里有几枚勾选件（应当恒为 1）。 */
  marks: number
  /** 勾选件是不是选中态（渲染指纹：类名）。 */
  checkOn: boolean
}

interface MemberViewFacts {
  found: boolean
  groupId: string
  title: string
  countText: string
  emptyText: string
  rows: MemberRowFacts[]
  searchValue: string
}

/** 成员清单（管理框第二层）的读数。 */
async function memberView(page: OpenedPage['page']): Promise<MemberViewFacts> {
  return page.evaluate(() => {
    const root = document.querySelector('[data-dshone-tree="group-members"]')
    const dialog = document.querySelector('[role="dialog"]')
    const rows = Array.from(document.querySelectorAll('[data-dshone-member-row]')).map((row) => {
      const mark = row.querySelector('.dshOneTree_checkBox')
      return {
        id: row.getAttribute('data-dshone-member-row') ?? '',
        name: row.querySelector('.dshOneTree_memberName')?.textContent ?? '',
        state: row.getAttribute('data-dshone-member-state') ?? '',
        marks: row.querySelectorAll('.dshOneTree_checkBox').length,
        checkOn: mark === null ? false : mark.className.includes('dshOneTree_checkOn'),
      }
    })
    const search = document.querySelector('[data-dshone-tree="group-member-search"]') as HTMLInputElement | null
    return {
      found: root !== null,
      groupId: root?.getAttribute('data-dshone-group-target') ?? '',
      title: dialog?.querySelector('.dshOneTree_modalTitle')?.textContent ?? '',
      countText: dialog?.querySelector('[data-dshone-tree="group-member-count"]')?.textContent ?? '',
      emptyText: dialog?.querySelector('[data-dshone-tree="group-member-empty"]')?.textContent ?? '',
      rows,
      searchValue: search?.value ?? '',
    }
  })
}

/** 「已选」计数行里的第一个数字（过滤结果里的已选数）。 */
function selectedCount(view: MemberViewFacts): number {
  return Number(view.countText.match(/\d+/)?.[0] ?? '-1')
}

/**
 * 从插件词典取一条文案，把 `{n}` / `{m}` 这类占位换成具体值。
 *
 * 为什么要两份：页面语言随环境走（日常实例是 zh，全新 `DSH_HOME` 的空实例起来是 en），
 * 断言里的文案必须从词典读、两种语言都认，不能硬编码中文——硬编码就是「判据吃运行环境
 * 的输入」（#148 立的正是这一条）。
 */
function say(key: string, values: Record<string, string>): string[] {
  return [ZH, EN].map((dict) =>
    Object.entries(values).reduce((text, [name, value]) => text.replace(`{${name}}`, value), dict[key] ?? ''),
  )
}

/** 打开「管理分组…」对话框（第一层）。 */
async function openManage(page: OpenedPage['page']): Promise<void> {
  await page.click('[data-dshone-tree-action="group-pill"]')
  await page.waitForSelector('[data-dshone-tree-action="group-manage"]')
  await page.click('[data-dshone-tree-action="group-manage"]')
  await page.waitForSelector('[data-dshone-tree="group-manage-list"]')
  await page.waitForTimeout(200)
}

/** 点某一组进它的成员清单（第二层）。 */
async function openMembers(page: OpenedPage['page'], groupId: string): Promise<void> {
  await page.click(`[data-dshone-manage-group="${groupId}"] [data-dshone-tree-action="group-members"]`)
  await page.waitForSelector(`[data-dshone-tree="group-members"][data-dshone-group-target="${groupId}"]`)
  await page.waitForTimeout(200)
}

/** 从成员清单返回分组列表。 */
async function backToList(page: OpenedPage['page']): Promise<void> {
  await page.click('[data-dshone-tree-action="group-members-back"]')
  await page.waitForSelector('[data-dshone-tree="group-manage-list"]')
  await page.waitForTimeout(200)
}

/** 点成员清单里的一行（勾选 / 取消）。 */
async function clickMember(page: OpenedPage['page'], workspaceId: string): Promise<void> {
  await page.click(`[data-dshone-member-row="${workspaceId}"]`)
  await page.waitForTimeout(250)
}

/** 在成员清单里搜一个串（`''` = 清空搜索框）。 */
async function searchMembers(page: OpenedPage['page'], query: string): Promise<void> {
  await page.fill('[data-dshone-tree="group-member-search"]', query)
  await page.waitForTimeout(250)
}

/** 关掉当前的对话框（Esc）并等它卸载。 */
async function closeDialog(page: OpenedPage['page']): Promise<void> {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
}

interface MenuCheck {
  groupId: string
  checked: boolean
}

/** 工作区行右键菜单里「分组…」各子项当前的勾选态（行菜单那条等价路径）。 */
async function workspaceMenuChecks(page: OpenedPage['page'], workspaceId: string): Promise<MenuCheck[]> {
  await page
    .locator(`[data-dshone-tree-row="workspace"][data-dshone-tree-key="${workspaceId}"]`)
    .click({ button: 'right', position: { x: 60, y: 12 } })
  await page.waitForSelector('[data-dshone-tree-item="groups"]')
  await page.click('[data-dshone-tree-item="groups"]')
  await page.waitForSelector('[data-dshone-tree-item="workspace-group-item"]')
  const checks = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-dshone-tree-item="workspace-group-item"]')).map((item) => ({
      groupId: item.getAttribute('data-dshone-group-target') ?? '',
      checked: item.getAttribute('data-dshone-group-checked') === 'true',
    })),
  )
  await closeDialog(page)
  return checks
}

// ---------------------------------------------------------------------------
// ⑥ 几何：三档宽度下逐项量，读数必须能在官方档位表里按属性找到出处
// ---------------------------------------------------------------------------

/** 要量的探针：选择器相对当前的 `[role="dialog"]`（`all: true` = 逐个匹配的元素都量）。 */
const GEOMETRY_PROBES: ReadonlyArray<{ label: string; selector: string; props: readonly string[]; all?: boolean }> = [
  { label: '对话框', selector: '', props: ['borderRadius'] },
  { label: '头行', selector: '.dshOneTree_modalHead', props: ['height'] },
  { label: '标题', selector: '.dshOneTree_modalTitle', props: ['fontSize', 'lineHeight'] },
  { label: '返回键', selector: '.dshOneTree_modalBack', props: ['width', 'height', 'borderRadius'] },
  { label: '搜索框', selector: '[data-dshone-tree="group-member-search"]', props: ['height', 'borderRadius', 'fontSize', 'lineHeight'] },
  { label: '批量按钮', selector: '.dshOneTree_memberTools button', props: ['height', 'borderRadius', 'fontSize', 'lineHeight'], all: true },
  { label: '计数行', selector: '.dshOneTree_memberCount', props: ['fontSize', 'lineHeight'] },
  { label: '成员行', selector: '.dshOneTree_memberRow', props: ['height', 'borderRadius'], all: true },
  { label: '成员行名字', selector: '.dshOneTree_memberName', props: ['fontSize', 'lineHeight'] },
  { label: '勾选件', selector: '.dshOneTree_checkBox', props: ['width', 'height', 'borderRadius'] },
  { label: '底部按钮', selector: '.dshOneTree_modalActions button', props: ['height', 'borderRadius', 'fontSize', 'lineHeight'], all: true },
]

interface ProbeReading {
  label: string
  readings: Record<string, string>[]
}

/** 量当前对话框（成员清单）的全部探针。 */
async function geometryProbes(page: OpenedPage['page']): Promise<ProbeReading[]> {
  return page.evaluate((list: ReadonlyArray<{ label: string; selector: string; props: readonly string[]; all?: boolean }>) => {
    const kebab = (prop: string): string => prop.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
    const dialog = document.querySelector('[role="dialog"]')
    if (dialog === null) return []
    const out: { label: string; readings: Record<string, string>[] }[] = []
    for (const probe of list) {
      const found = probe.selector === '' ? [dialog] : Array.from(dialog.querySelectorAll(probe.selector))
      const picked = probe.all === true ? found : found.slice(0, 1)
      if (picked.length === 0) continue
      const readings: Record<string, string>[] = []
      for (const element of picked) {
        const computed = getComputedStyle(element)
        const reading: Record<string, string> = {}
        for (const prop of probe.props) {
          const value = computed.getPropertyValue(kebab(prop)).trim()
          // 只收「写死的长度」：自动值 / 百分比 / calc 由布局决定，不是档位能管的东西
          //（口径与 F-23 SCALE / F-34 MODAL-COMPACT 一致：读 computed，不读矩形）。
          if (!/^\d+(\.\d+)?px$/.test(value)) continue
          reading[prop] = value
        }
        if (Object.keys(reading).length > 0) readings.push(reading)
      }
      if (readings.length > 0) out.push({ label: probe.label, readings })
    }
    return out
  }, GEOMETRY_PROBES)
}

interface WidthFacts {
  viewport: number
  dialogLeft: number
  dialogRight: number
  dialogScrollWidth: number
  dialogClientWidth: number
  pageScrollWidth: number
  pageClientWidth: number
  toolsScrollWidth: number
  toolsClientWidth: number
  /** 每一枚成员行：是否落在对话框之内、有没有被横向挤出。 */
  rows: ReadonlyArray<{ id: string; left: number; right: number; height: number; width: number; nameWidth: number }>
}

/** 某一档宽度下的溢出与裁切事实。 */
async function widthFacts(page: OpenedPage['page']): Promise<WidthFacts | null> {
  return page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement | null
    if (dialog === null) return null
    const box = dialog.getBoundingClientRect()
    const tools = dialog.querySelector('.dshOneTree_memberTools') as HTMLElement | null
    const rows = Array.from(dialog.querySelectorAll('[data-dshone-member-row]')).map((row) => {
      const rect = row.getBoundingClientRect()
      const name = row.querySelector('.dshOneTree_memberName') as HTMLElement | null
      return {
        id: row.getAttribute('data-dshone-member-row') ?? '',
        left: rect.left,
        right: rect.right,
        height: rect.height,
        width: rect.width,
        nameWidth: name === null ? -1 : name.getBoundingClientRect().width,
      }
    })
    return {
      viewport: window.innerWidth,
      dialogLeft: box.left,
      dialogRight: box.right,
      dialogScrollWidth: dialog.scrollWidth,
      dialogClientWidth: dialog.clientWidth,
      pageScrollWidth: document.documentElement.scrollWidth,
      pageClientWidth: document.documentElement.clientWidth,
      toolsScrollWidth: tools?.scrollWidth ?? -1,
      toolsClientWidth: tools?.clientWidth ?? -1,
      rows,
    }
  })
}

export const GROUP_MEMBERS_SUITE: LabSuite = {
  id: 'F-41',
  phase: 'new-feature',
  name: '管理分组里的成员清单：点分组名进第二层，全部工作区勾选 + 搜索 + 全选/清空，勾选即时落盘（#139，GROUP-MEMBERS 套件）',
  expect:
    '真实装配页上（真网关**只读** + 假宿主 + 页内夹具：四棵**合成**工作区［Lab Alpha / Beta / Gamma / Delta，两两不互为子串］+ 注入的分组状态：Lab One / Lab Two / Lab Empty 三组，**第一个工作区同时在两个组里**；工作区清单由夹具自造，不读当天网关那一份——判据不吃运行环境的输入），在「管理分组…」对话框里点某一组的名字进它的**成员清单**：① **成员清单在**——行数 = 当前工作区数、行的顺序与文字与树里逐条相同、每行**恰好一枚**勾选件（复用会话多选态那一枚 `SelectMark`），且行上的状态标记与勾选件的渲染指纹一致；搜索框、全选 / 清空、返回键都在场。② **回显与宿主状态逐条一致**——每行的勾选态 = 假宿主状态存储里该组 membership 里有没有它（含「一个工作区同时在两个组里」：两个组的清单里那一行都勾着；零成员组里每一行都不勾）。③ **点一下入组**——行变成勾选、宿主状态里出现该组 id、「已选」计数 +1；返回分组列表后该组的成员计数 = 原值 +1，且等于宿主状态里该组成员的工作区数（不是另一套算法）；其余两组的计数一点没动。④ **再点一下出组**——重进清单时上一次的勾选还在（状态来自宿主那一份），点一下：取消、宿主状态里移除、计数 −1 回到原值。⑤ **搜索与批量动作的作用域是「当前过滤结果」**——输入一个必然无匹配的串 → 一行都不渲染且给空态文案；输入一个子串 → 只剩匹配行（期望集合按同一条包含规则从工作区清单算出来，不写死）；在这一过滤态下点「全选」→ 宿主状态里该组成员 = 原有成员 ∪ 过滤结果（**过滤外的工作区一个都没被带上**），点「清空」→ 只剩过滤外的原有成员（过滤外的成员一行不动）；清掉搜索框后全部行回来。⑥ **三档宽度 260 / 340 / 500 下不横向溢出、不裁切**——对话框左右缘在视口内、`scrollWidth ≤ clientWidth + 1`、页面无横向溢出、顶部那一行不溢出、每一枚成员行都落在对话框之内且宽高 > 0；成员行高 26px / 圆角 5px、行文字 12px·18px、返回键 26×26 与圆角 5px、搜索框 26px / 圆角 5px / 12px·18px、批量按钮与底部按钮 = 官方 Button 的 `sm` 档（28px / 圆角 14px / 12px·18px）、勾选件 14×14 / 圆角 4px——**逐项在档位表里找到出处**（期望值从 `SCALE_TIERS` 读，不硬编码）。⑦ **回归与只读**——分组列表原先的三件事不变（改名 / 删除各开出自己那个对话框且取消后分组一条不动、新建分组的空名仍禁用确认钮、重名按一下出红字且分组一个都不多、合法名字建得出来且新组零成员），**成员清单里的写入与工作区行菜单那条路径等价**（关掉管理框后，同一工作区在工作区行菜单「分组…」里那一项也显示 ✓），全程零 pageerror、全程没有走任何写类 RPC（网关只读）。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const shot = async (page: OpenedPage['page'], name: string): Promise<string> => {
      const file = path.join(ctx.shots, `${name}.png`)
      await fsp.mkdir(ctx.shots, { recursive: true })
      await page.screenshot({ path: file })
      return file
    }
    const groupsState = { version: 1, groups: GROUPS, membership: {}, activeGroupId: null }
    check.fact(`档位表取值：compact=${JSON.stringify(SCALE_TIERS.compact)}；buttonSm=${JSON.stringify(SCALE_TIERS.buttonSm)}`)
    const opened = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), {
      width: 380,
      height: 900,
      state: { groups: groupsState },
    })
    const { page } = opened
    // 只读守卫（⑦）：把走过的 `/api/` 方法名逐个记下来，收尾断言写类方法一个都没出现。
    const apiCalls: string[] = []
    await page.route('**/api/**', async (r) => {
      apiCalls.push(decodeURIComponent(r.request().url()).split('/api/')[1] ?? '')
      await r.continue()
    })
    try {
      // ---- 夹具一：工作区清单由 harness 的**数据集夹具**给（侧栏那两棵树的缺省口径）----
      // 为什么必须自造：以前这条套件拿「网关上有几棵工作区、都叫什么」当判据的输入，于是
      // 判据跟着**这台机器碰巧有多少工作区、名字里有没有互相包含**走——日常实例上绿、
      // 全新 DSH_HOME 的空实例上直接红（#148 立、#162 普查）。工作区清单本来就是套件
      // 该控制的那一项，改成用夹具声明的那一份，判据一个字不用改。
      const expectedWorkspaceIds = SIDEBAR_DATASET.workspaces.map((workspace) => workspace.workspaceId)
      // ---- 夹具二：第一个工作区同时在 Lab One 与 Lab Two 里（多对多的回显要有它）----
      // 树层从假宿主的状态存储读分组（挂载时读一次），所以注入之后要重载页面。
      const multi = expectedWorkspaceIds[0] ?? ''
      const fixture: HostGroupsFile = {
        groups: GROUPS,
        membership: { [multi]: ['g-lab-one', 'g-lab-two'] },
      }
      await page.addInitScript({
        content: `(() => { globalThis.__LAB_HOST__.stateStore['groups'] = ${JSON.stringify({ version: 1, ...fixture, activeGroupId: null })} })()`,
      })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector(route('sidebar').readySelector, { timeout: 40_000 })
      await page.waitForTimeout(2_500)
      const workspaces = await treeWorkspaces(page)
      const ids = workspaces.map((row) => row.id)
      check.fact(`合成工作区进了树（树里顺序）：${JSON.stringify(workspaces.map((row) => row.label))}`)
      check.ok(
        '① 夹具生效：树里的工作区行 = 夹具声明的四棵（顺序逐条相同）',
        JSON.stringify(ids) === JSON.stringify(expectedWorkspaceIds),
        JSON.stringify(ids),
      )
      check.ok(
        '① 夹具生效：`workspace/follow` 的基线帧被换成了夹具声明的工作区',
        (opened.dataset?.workspaceFrames ?? 0) > 0,
        JSON.stringify(opened.dataset),
      )
      if (ids.length === 0) return screenshots

      // ---- ⑦ 列表层的第一眼：分组、计数与入口 ----
      await openManage(page)
      const list = await manageList(page)
      check.eq('⑦ 管理框仍列出全部三个分组（名字与顺序不变）', list.map((row) => row.name), GROUPS.map((group) => group.name))
      check.eq(
        '⑦ 每组计数 = 宿主状态里该组的成员工作区数（多对多的那个算两次，各归各组）',
        list.map((row) => row.count),
        GROUPS.map((group) => membersOf(fixture, group.id).length),
      )
      check.ok(
        '① 每组的名字都是一枚进成员清单的入口（行内 ✎/🗑 各点各的）',
        list.every((row) => row.entry),
        JSON.stringify(list.map((row) => ({ id: row.id, entry: row.entry }))),
      )
      screenshots.push(await shot(page, 'group-members-list'))

      // ---- ① 进 Lab One 的成员清单 ----
      await openMembers(page, 'g-lab-one')
      const view = await memberView(page)
      check.ok(
        '① 点分组名进了成员清单（标记在场、组目标对得上、标题就是组名）',
        view.found && view.groupId === 'g-lab-one' && view.title === 'Lab One',
        JSON.stringify({ found: view.found, groupId: view.groupId, title: view.title }),
      )
      check.eq('① 行数 = 当前工作区数', view.rows.length, workspaces.length)
      check.eq('① 行的 id 顺序与树里的工作区顺序逐条相同', view.rows.map((row) => row.id), ids)
      check.eq('① 行的文字与树里的工作区名逐条相同', view.rows.map((row) => row.name), workspaces.map((row) => row.label))
      check.ok('① 每行恰好一枚勾选件（会话多选态那一枚）', view.rows.every((row) => row.marks === 1), JSON.stringify(view.rows.map((row) => row.marks)))
      check.ok(
        '① 行上的状态标记与勾选件的渲染指纹一致（标记 vs 类名）',
        view.rows.every((row) => (row.state === 'on') === row.checkOn && (row.state === 'on' || row.state === 'off')),
        JSON.stringify(view.rows.map((row) => ({ id: row.id, state: row.state, checkOn: row.checkOn }))),
      )
      const controls = await page.evaluate(() => ({
        search: document.querySelectorAll('[data-dshone-tree="group-member-search"]').length,
        all: document.querySelectorAll('[data-dshone-tree-action="group-member-all"]').length,
        none: document.querySelectorAll('[data-dshone-tree-action="group-member-none"]').length,
        back: document.querySelectorAll('[data-dshone-tree-action="group-members-back"]').length,
      }))
      check.ok('① 搜索框 / 全选 / 清空 / 返回键各一枚，都在场', Object.values(controls).every((count) => count === 1), JSON.stringify(controls))
      screenshots.push(await shot(page, 'group-members-view'))

      // ---- ② 回显一致：逐行与宿主状态里那一份比 ----
      const hostAfterFixture = await hostGroups(page)
      check.eq(
        '② 第一个工作区确实同时在两个组里（夹具生效）',
        [membersOf(hostAfterFixture, 'g-lab-one').includes(multi), membersOf(hostAfterFixture, 'g-lab-two').includes(multi)],
        [true, true],
      )
      check.eq(
        '② Lab One 里每行的勾选态 = 宿主状态里该组 membership 里有没有它',
        view.rows.map((row) => row.checkOn),
        ids.map((id) => membersOf(hostAfterFixture, 'g-lab-one').includes(id)),
      )
      check.eq('② 回显不是「默认全勾」：既有勾着的行也有没勾的行', [...new Set(view.rows.map((row) => row.checkOn))].sort(), [false, true])

      // 同一个工作区在 Lab Two 的清单里也勾着（多对多：不是「搬过去」，是两边都在）。
      await backToList(page)
      await openMembers(page, 'g-lab-two')
      const viewTwo = await memberView(page)
      check.eq(
        '② Lab Two 的清单里每一行同样与宿主状态逐条对上（多对多的另一侧）',
        viewTwo.rows.map((row) => ({ id: row.id, on: row.checkOn })),
        ids.map((id) => ({ id, on: membersOf(hostAfterFixture, 'g-lab-two').includes(id) })),
      )
      check.ok(
        '② 多对多：同一个工作区在两个组的清单里都是勾上的',
        viewTwo.rows.some((row) => row.id === multi && row.checkOn),
        JSON.stringify(viewTwo.rows.map((row) => ({ id: row.id, on: row.checkOn }))),
      )

      // 零成员组：每一行都不勾。
      await backToList(page)
      await openMembers(page, 'g-lab-empty')
      const viewEmpty = await memberView(page)
      check.eq('② 零成员组的清单里一行都不勾', viewEmpty.rows.map((row) => row.checkOn), ids.map(() => false))
      check.ok(
        '② 零成员组的计数行写的是「已选 0 / 全部」（文案从词典读，zh / en 都认）',
        say('group.members.count', { n: '0', m: String(ids.length) }).includes(viewEmpty.countText.replace(/\s+/g, ' ')),
        `actual=${JSON.stringify(viewEmpty.countText.replace(/\s+/g, ' '))} expected=${JSON.stringify(say('group.members.count', { n: '0', m: String(ids.length) }))}`,
      )

      // ---- 进度基准：先把 Lab One 清成空组（用第二层的「清空」，也顺手走一遍那条路径）----
      await backToList(page)
      await openMembers(page, 'g-lab-one')
      await page.click('[data-dshone-tree-action="group-member-none"]')
      await page.waitForTimeout(300)
      await backToList(page)
      check.eq('基准：清空之后 Lab One 计数为 0（成员都在宿主状态里被移除）', await groupCount(page, 'g-lab-one'), 0)
      check.eq('基准：另一个组不受影响（多对多的那一份还在）', await groupCount(page, 'g-lab-two'), membersOf(fixture, 'g-lab-two').length)

      // ---- ③ 点一下入组 ----
      const target = ids[ids.length - 1] ?? ''
      await openMembers(page, 'g-lab-one')
      const beforeJoin = await memberView(page)
      check.eq('③ 入组前目标行是未勾选态', beforeJoin.rows.find((row) => row.id === target)?.checkOn, false)
      await clickMember(page, target)
      const joined = await memberView(page)
      const hostJoined = await hostGroups(page)
      check.ok('③ 点一下：那一行的框变成选中态', joined.rows.find((row) => row.id === target)?.checkOn === true, JSON.stringify(joined.rows.find((row) => row.id === target)))
      check.ok('③ 宿主状态里该组出现了这个工作区 id', membersOf(hostJoined, 'g-lab-one').includes(target), JSON.stringify(membersOf(hostJoined, 'g-lab-one')))
      check.eq('③ 「已选」计数跟着 +1（实时跟随）', selectedCount(joined), selectedCount(beforeJoin) + 1)
      await backToList(page)
      check.eq('③ 回到分组列表，该组计数 = 1（原值 0 + 1）', await groupCount(page, 'g-lab-one'), 1)
      check.eq('③ 计数 = 宿主状态里该组成员的工作区数（不是另一套算法）', await groupCount(page, 'g-lab-one'), membersOf(hostJoined, 'g-lab-one').length)
      check.eq(
        '③ 列表层其余两组的计数一点没动',
        (await manageList(page)).filter((row) => row.id !== 'g-lab-one').map((row) => row.count),
        list.filter((row) => row.id !== 'g-lab-one').map((row) => row.count),
      )

      // ---- 等价性钉子：成员清单里的写入 = 工作区行菜单那条路径 ----
      await closeDialog(page)
      const menuChecks = await workspaceMenuChecks(page, target)
      const hostForMenu = await hostGroups(page)
      check.eq(
        '等价性：关掉管理框后，工作区行菜单「分组…」里各组的 ✓ 与宿主状态逐条一致',
        menuChecks.map((entry) => ({ id: entry.groupId, checked: entry.checked })),
        GROUPS.map((group) => ({ id: group.id, checked: membersOf(hostForMenu, group.id).includes(target) })),
      )
      check.ok(
        '等价性：刚在成员清单里勾上的那一组，行菜单里那一项也显示 ✓（同一条写路径）',
        menuChecks.find((entry) => entry.groupId === 'g-lab-one')?.checked === true,
        JSON.stringify(menuChecks),
      )

      // ---- ④ 再点一下出组 ----
      await openManage(page)
      await openMembers(page, 'g-lab-one')
      const beforeLeave = await memberView(page)
      check.ok(
        '④ 重进清单：上一次的勾选还在（状态来自宿主那一份，不是本页临时态）',
        beforeLeave.rows.find((row) => row.id === target)?.checkOn === true,
        JSON.stringify(beforeLeave.rows.find((row) => row.id === target)),
      )
      await clickMember(page, target)
      const left = await memberView(page)
      const hostLeft = await hostGroups(page)
      check.ok('④ 再点一下：框灭掉', left.rows.find((row) => row.id === target)?.checkOn === false, JSON.stringify(left.rows.find((row) => row.id === target)))
      check.ok('④ 宿主状态里该组已移除这个工作区 id', !membersOf(hostLeft, 'g-lab-one').includes(target), JSON.stringify(membersOf(hostLeft, 'g-lab-one')))
      check.eq('④ 「已选」计数跟着 −1', selectedCount(left), selectedCount(beforeLeave) - 1)
      await backToList(page)
      check.eq('④ 回到分组列表，该组计数 −1（回到原值 0）', await groupCount(page, 'g-lab-one'), 0)

      // ---- ⑤ 搜索与批量动作（作用域 = 当前过滤结果）----
      await openMembers(page, 'g-lab-one')
      const query = 'zz-lab-139-no-match'
      await searchMembers(page, query)
      const noMatch = await memberView(page)
      check.eq('⑤ 搜一个必然无匹配的串：一行都不渲染', noMatch.rows.length, 0)
      check.ok(
        '⑤ 无匹配时给空态文案（搜索框里确实是我们输入的串）',
        noMatch.emptyText.trim() !== '' && noMatch.searchValue === query,
        JSON.stringify({ emptyText: noMatch.emptyText, searchValue: noMatch.searchValue }),
      )
      screenshots.push(await shot(page, 'group-members-search-empty'))

      // 过滤串用**最后那个工作区的完整名字**：匹配集合按同一条包含规则从工作区清单算出来。
      const needle = workspaces[workspaces.length - 1]?.label ?? ''
      check.ok('⑤ 拿到一个可用于过滤的工作区名', needle.trim() !== '', needle)
      if (needle.trim() === '') return screenshots
      await searchMembers(page, needle)
      const filtered = await memberView(page)
      const expected = workspaces.filter((row) => row.label.toLowerCase().includes(needle.toLowerCase()))
      const expectedIds = expected.map((row) => row.id)
      const outside = ids.filter((id) => !expectedIds.includes(id))
      check.fact(`⑤ 过滤串「${needle}」→ 匹配 ${String(expected.length)} 个 / 共 ${String(workspaces.length)} 个，过滤外 ${String(outside.length)} 个`)
      check.eq('⑤ 搜索后只剩匹配的行（期望集合按同一条包含规则算出，不写死）', filtered.rows.map((row) => row.id), expectedIds)
      check.ok(
        '⑤ 搜索真的在过滤（匹配集是全部工作区的真子集时，行数少于全部）',
        outside.length === 0 || filtered.rows.length < workspaces.length,
        `匹配 ${String(filtered.rows.length)} / 共 ${String(workspaces.length)}`,
      )
      screenshots.push(await shot(page, 'group-members-search'))

      // 让「过滤外」那一侧有一个真实的成员：先在无过滤态下把一个过滤外的工作区勾进来。
      if (outside.length > 0) {
        await searchMembers(page, '')
        await clickMember(page, outside[0] as string)
        await searchMembers(page, needle)
      }
      const membersBefore = membersOf(await hostGroups(page), 'g-lab-one')
      check.eq(
        '⑤ 全选前：该组已有的成员正是过滤外的那一个（另一侧有真成员可比）',
        membersBefore,
        outside.length > 0 ? [outside[0] as string].sort() : [],
      )

      await page.click('[data-dshone-tree-action="group-member-all"]')
      await page.waitForTimeout(300)
      const afterAll = membersOf(await hostGroups(page), 'g-lab-one')
      check.eq(
        '⑤ 「全选」的作用域 = 当前过滤结果（宿主状态里该组成员 = 原有成员 ∪ 过滤结果）',
        afterAll,
        [...new Set([...membersBefore, ...expectedIds])].sort(),
      )
      check.ok(
        '⑤ 过滤外的工作区一个都没被「全选」带上（该翻的翻了、不该翻的没动）',
        outside.every((id) => membersBefore.includes(id) === afterAll.includes(id)),
        JSON.stringify({ outside, before: membersBefore, after: afterAll }),
      )
      check.eq('⑤ 「全选」后过滤结果内每一行都是选中态', (await memberView(page)).rows.map((row) => row.checkOn), expected.map(() => true))

      await page.click('[data-dshone-tree-action="group-member-none"]')
      await page.waitForTimeout(300)
      const afterNone = membersOf(await hostGroups(page), 'g-lab-one')
      check.eq(
        '⑤ 「清空」同样只清当前过滤结果（剩下的正是过滤外的原有成员）',
        afterNone,
        membersBefore.filter((id) => !expectedIds.includes(id)),
      )
      check.eq('⑤ 「清空」后过滤结果内每一行都灭掉', (await memberView(page)).rows.map((row) => row.checkOn), expected.map(() => false))
      await searchMembers(page, '')
      const restored = await memberView(page)
      check.eq('⑤ 清掉搜索框：全部行回来', restored.rows.map((row) => row.id), ids)
      const restoredSelected = String(restored.rows.filter((row) => row.checkOn).length)
      check.ok(
        '⑤ 清掉搜索框后计数行按「全部工作区」的口径算（分母 = 工作区总数；文案从词典读，zh / en 都认）',
        say('group.members.count', { n: restoredSelected, m: String(ids.length) }).includes(restored.countText.replace(/\s+/g, ' ')),
        `actual=${JSON.stringify(restored.countText.replace(/\s+/g, ' '))} expected=${JSON.stringify(say('group.members.count', { n: restoredSelected, m: String(ids.length) }))}`,
      )

      // ---- ⑥ 三档宽度：不溢出、不裁切，几何逐项落在档位表里 ----
      for (const width of [260, 340, 500]) {
        await page.setViewportSize({ width, height: 900 })
        await page.waitForTimeout(300)
        const facts = await widthFacts(page)
        check.ok(`⑥ ${String(width)}px：量到了成员清单`, facts !== null, JSON.stringify(facts))
        if (facts === null) continue
        check.ok(`⑥ ${String(width)}px：对话框在视口内`, facts.dialogLeft >= -1 && facts.dialogRight <= facts.viewport + 1, JSON.stringify(facts))
        check.ok(
          `⑥ ${String(width)}px：对话框没有横向溢出（scrollWidth ≤ clientWidth + 1）`,
          facts.dialogScrollWidth <= facts.dialogClientWidth + 1,
          `${String(facts.dialogScrollWidth)} / ${String(facts.dialogClientWidth)}`,
        )
        check.ok(
          `⑥ ${String(width)}px：页面没有横向溢出`,
          facts.pageScrollWidth <= facts.pageClientWidth + 1,
          `${String(facts.pageScrollWidth)} / ${String(facts.pageClientWidth)}`,
        )
        check.ok(
          `⑥ ${String(width)}px：顶部那一行（搜索 + 全选 + 清空）不溢出（放不下就整组换行）`,
          facts.toolsScrollWidth <= facts.toolsClientWidth + 1,
          `${String(facts.toolsScrollWidth)} / ${String(facts.toolsClientWidth)}`,
        )
        check.ok(
          `⑥ ${String(width)}px：每一枚成员行都在对话框之内、有实际宽高、没有横向被挤出`,
          facts.rows.length > 0 &&
            facts.rows.every(
              (row) => row.left >= facts.dialogLeft - 1 && row.right <= facts.dialogRight + 1 && row.width > 0 && row.height > 0,
            ),
          JSON.stringify(facts.rows),
        )
        const probes = await geometryProbes(page)
        check.ok(`⑥ ${String(width)}px：量到了成员清单里的探针`, probes.length >= 5, `读到 ${String(probes.length)} 组探针`)
        check.fact(
          `⑥ ${String(width)}px 量到的几何：${probes
            .map((probe) => `${probe.label}=${JSON.stringify(probe.readings[0] ?? {})}`)
            .join('；')}`,
        )
        for (const probe of probes) {
          for (const prop of GEOMETRY_PROBES.find((item) => item.label === probe.label)?.props ?? []) {
            const values = [...new Set(probe.readings.map((reading) => reading[prop] ?? '').filter((value) => value !== ''))]
            if (values.length === 0) continue
            const seen = values.join(' / ')
            const source = values.length === 1 ? sourceOf(prop, values[0] as string) : null
            check.ok(
              `⑥ ${String(width)}px：${probe.label} 的 ${prop} = ${seen} 能在档位表里找到出处`,
              source !== null,
              `${source ?? '不在档位表里（自造值）'}${values.length === 1 ? '' : '（同一处控件取值不一致）'}`,
            )
          }
        }
        screenshots.push(await shot(page, `group-members-${String(width)}`))
      }
      await page.setViewportSize({ width: 380, height: 900 })
      await page.waitForTimeout(250)

      // ---- ⑦ 回归：分组列表原有的三件事 ----
      await backToList(page)
      const beforeRegression = JSON.stringify(await hostGroups(page))
      await page.click('[data-dshone-manage-group="g-lab-one"] [data-dshone-tree-action="group-rename"]')
      await page.waitForSelector('[role="dialog"]')
      await page.waitForTimeout(200)
      const rename = await page.evaluate(() => ({
        dialogs: document.querySelectorAll('[role="dialog"]').length,
        value: (document.querySelector('.dshOneTree_renameInput') as HTMLInputElement | null)?.value ?? '',
        title: document.querySelector('.dshOneTree_modalTitle')?.textContent ?? '',
      }))
      check.ok(
        '⑦ 改名：关掉管理框、开出「重命名分组」并带上原名字',
        rename.dialogs === 1 && rename.value === 'Lab One' && hasText(rename.title, '重命名'),
        JSON.stringify(rename),
      )
      await closeDialog(page)

      await openManage(page)
      await page.click('[data-dshone-manage-group="g-lab-one"] [data-dshone-tree-action="group-delete"]')
      await page.waitForSelector('[role="dialog"]')
      await page.waitForTimeout(200)
      const del = await page.evaluate(() => ({
        desc: document.querySelector('.dshOneTree_modalDesc')?.textContent ?? '',
        dialogs: document.querySelectorAll('[role="dialog"]').length,
      }))
      check.ok('⑦ 删除：只开出确认框、写明要删哪一个', del.dialogs === 1 && del.desc.includes('Lab One'), JSON.stringify(del))
      await closeDialog(page)
      check.eq('⑦ 改名与删除的取消都没有改到分组状态', JSON.stringify(await hostGroups(page)), beforeRegression)

      await openManage(page)
      const createForm = async (): Promise<{ error: string; disabled: boolean }> =>
        page.evaluate(() => {
          const dialog = document.querySelector('[role="dialog"]')
          const confirm = Array.from(dialog?.querySelectorAll('button') ?? []).find((button) => (button.textContent ?? '') === '新建分组')
          return {
            error: dialog?.querySelector('.dshOneTree_renameError')?.textContent ?? '',
            disabled: (confirm as HTMLButtonElement | undefined)?.disabled ?? true,
          }
        })
      await page.fill('[data-dshone-tree="group-manage-input"]', '   ')
      await page.waitForTimeout(200)
      const blank = await createForm()
      check.ok('⑦ 新建分组：空名 → 确认钮禁用（校验没变）', blank.disabled, JSON.stringify(blank))
      // 这一格的校核在**提交时**做（同一份纯函数），所以重名要按一下才见红字——按了也不落盘。
      await page.fill('[data-dshone-tree="group-manage-input"]', 'Lab One')
      await page.click('.dshOneTree_manageCreate button')
      await page.waitForTimeout(250)
      const dup = await createForm()
      check.ok('⑦ 新建分组：重名 → 出红字（校验没变，且没有落盘）', dup.error.trim() !== '', JSON.stringify(dup))
      check.eq('⑦ 新建分组：重名被拒时分组一个都没多', (await manageList(page)).length, GROUPS.length)
      await page.fill('[data-dshone-tree="group-manage-input"]', 'Lab Nine')
      await page.waitForTimeout(200)
      const fresh = await createForm()
      check.ok('⑦ 新建分组：合法名字可以建（确认钮不再禁用）', !fresh.disabled, JSON.stringify(fresh))
      await page.click('.dshOneTree_manageCreate button')
      await page.waitForTimeout(400)
      const hostAfterCreate = await hostGroups(page)
      check.eq(
        '⑦ 新建分组：列表里多了一组、且新组零成员（其余组的计数照旧）',
        (await manageList(page)).map((row) => ({ name: row.name, count: row.count })),
        [...GROUPS.map((group) => ({ name: group.name, count: membersOf(hostAfterCreate, group.id).length })), { name: 'Lab Nine', count: 0 }],
      )
      check.ok(
        '⑦ 新建分组落到了宿主状态里（不是只画在界面上）',
        (hostAfterCreate?.groups ?? []).some((group) => group.name === 'Lab Nine'),
        JSON.stringify(hostAfterCreate?.groups),
      )
      await closeDialog(page)
      check.eq('⑦ 关掉管理框后没有残留的对话框', await page.evaluate(() => document.querySelectorAll('[role="dialog"]').length), 0)

      // ---- ⑦ 只读：全程没有一个写类 RPC ----
      const writes = apiCalls.filter((method) => WRITE_METHODS.some((candidate) => method.startsWith(candidate)))
      check.eq('⑦ 全程没有走任何写类 RPC（网关只读）', writes, [])
      check.fact(`本套件走过的 RPC：${JSON.stringify([...new Set(apiCalls)].sort())}`)
      check.eq('全程零 pageerror', withoutKnownNoise(opened.capture.pageErrors).real, [])
    } finally {
      await opened.context.close()
    }
    return screenshots
  },
}
