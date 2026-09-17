/**
 * 拖拽补齐（#155）：**管理分组框里拖组行换顺序** + **拖动会话行时源行半透明**。
 *
 * 独立成一个文件、不写进 `suites.ts` 的理由与其它独立套件同一条：那个文件是本批开发的
 * 合入热点（末尾只加一行注册）。
 *
 * ## 期望值从哪来（都不硬编码）
 *
 * - **源行半透明的两个值**从**旧侧栏的正本 CSS** 里解析（`src/ui/sessionsView.ts` 的
 *   `.session-row.dragging{opacity:.45}` 与 `.wsg-row.dragging{opacity:.55}`）——本条的
 *   口径是「官方优先，官方没有才照旧侧栏补」（见 issue #155 与 `styles.ts` 那两条规则
 *   上方的说明），所以判据写成「我们实测的值 = 旧侧栏那一份的值」，而不是写死 0.45/0.55。
 * - **官方那一侧真的没有这一手**由本套件在**官方浏览区页**上实测：同一条路（会话行
 *   `dragstart` → 读源行 → `dragend`）走一遍，源行的解析 `opacity` 与类名串**一个字都不动**。
 *   这条既是「照旧侧栏补」的理由的可执行版本，也钉住「以后官方加了源行形态」的那一天
 *   （到时这条会红，提示我们回头对齐官方）。
 * - **抓手上的文案**从插件词典读（页面语言随网关实例，zh / en 两种取值都接受）。
 * - **顺序**一律与**假宿主状态存储里的那一份**对读（界面顺序 = 落盘顺序），写入次数数
 *   `__LAB_HOST__.hostCalls` 里的 `state.write`（键 `groups`）。
 *
 * ## 拖拽怎么造（与 F-16 同一手，但**分阶段**）
 *
 * 用真实 `DataTransfer` + `DragEvent` 造，走的是插件自己那套判定（`dragstart` 写自定义
 * MIME → `dragover` 定落点 → `drop` 读载荷），不绕过被验的代码。与 F-16 不同的一点：
 * 本套件要看**拖到一半的现场**（源行的透明度、落点标记），所以起手 / 悬停 / 落下 / 松手
 * 分成四次 `page.evaluate`，那一轮的 `DataTransfer` 挂在页面全局上跨阶段共用
 *（`dragstart` 与 `drop` 必须拿到同一个对象，`getData` 才读得到载荷）。
 *
 * 本套件**不写网关**：只做渲染与页面内交互（状态写只进假宿主的内存表），收尾按 F-41 的
 * 同一口径核一遍走过的 `/api/` 方法名里没有写类方法。
 */
import * as fsp from 'node:fs/promises'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { expandAllWorkspaces, expandOfficialWorkspaces } from './pendingDotSuites.ts'
import { openTreePage, withoutKnownNoise, type OpenedPage } from './harness.ts'
import { LAB_TREES, type LabTreeRoute } from './labServer.ts'
import { EN, ZH } from '../../src/ui/assembly/shell/workspaceTree/locale.ts'
import { GROUP_DRAG_MIME } from '../../src/ui/assembly/shell/workspaceTree/groups.ts'
// 只取类型（编译后不留 import，运行期没有环）：套件接口定义在 suites.ts 里。
import type { LabSuite } from './suites.ts'

const route = (name: string): LabTreeRoute => {
  const found = LAB_TREES.find((candidate) => candidate.route === name)
  if (found === undefined) throw new Error(`lab: unknown tree route ${name}`)
  return found
}

/** 夹具：三个自定义分组（名字照 F-41 的写法，便于人对着报告看）。 */
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

/* ---------------------------------------------------------------------------
 * 期望值：旧侧栏正本里的那两个透明度
 * ------------------------------------------------------------------------ */

/** 旧侧栏样式表（`src/ui/sessionsView.ts` 里的 CSS 字符串）。 */
function legacyStyles(): string {
  return fs.readFileSync(
    path.join(import.meta.dirname, '..', '..', 'src', 'ui', 'sessionsView.ts'),
    'utf8',
  )
}

/** 从旧侧栏 CSS 里读 `.x.dragging{opacity:…}` 的值（读不到就抛——正本没了要立刻知道）。 */
function legacyDragOpacity(selector: string): number {
  const literal = selector.split('.').join('\\.')
  const match = new RegExp(`${literal}\\.dragging\\s*\\{[^}]*opacity\\s*:\\s*([0-9.]+)`).exec(legacyStyles())
  if (match === null) throw new Error(`旧侧栏 CSS 里找不到 ${selector}.dragging 的 opacity（正本变了？）`)
  return Number(match[1])
}

/* ---------------------------------------------------------------------------
 * 页面读数
 * ------------------------------------------------------------------------ */

interface ManageRowFacts {
  id: string
  name: string
  count: number
  /** 这一行解析出来的 opacity。 */
  opacity: number
  /** 这一行带着「被拖着」的自有类名（`dshOneTree_manageRowDragging`）。 */
  dragging: boolean
  /** 落点标记值（'' / 'before' / 'after'）。 */
  drop: string
  /** 行里的抓手套数。 */
  handles: number
}

/** 管理框第一层的每一行（按 DOM 顺序）。 */
async function manageRows(page: OpenedPage['page']): Promise<ManageRowFacts[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-dshone-manage-group]')).map((row) => {
      const element = row as HTMLElement
      return {
        id: element.getAttribute('data-dshone-manage-group') ?? '',
        name: element.querySelector('.dshOneTree_manageName')?.textContent ?? '',
        count: Number(element.querySelector('.dshOneTree_manageCount')?.textContent ?? '-1'),
        opacity: Number.parseFloat(getComputedStyle(element).opacity),
        dragging: element.className.includes('dshOneTree_manageRowDragging'),
        drop: element.getAttribute('data-dshone-group-drop') ?? '',
        handles: element.querySelectorAll('[data-dshone-tree-action="group-drag"]').length,
      }
    }),
  )
}

/** 抓手自己的事实（在不在场、是不是拖拽源、文案、几何）。 */
async function handleFacts(
  page: OpenedPage['page'],
  groupId: string,
): Promise<{ found: boolean; draggable: boolean; label: string; title: string; width: number; height: number; boxes: number; buttonsDraggable: number }> {
  return page.evaluate((id: string) => {
    const row = document.querySelector(`[data-dshone-manage-group="${id}"]`)
    const handle = row?.querySelector('[data-dshone-tree-action="group-drag"]') as HTMLElement | null
    const rect = handle?.getBoundingClientRect()
    return {
      found: handle !== null && handle !== undefined,
      draggable: handle?.draggable === true,
      label: handle?.getAttribute('aria-label') ?? '',
      title: handle?.getAttribute('title') ?? '',
      width: Math.round(rect?.width ?? -1),
      height: Math.round(rect?.height ?? -1),
      boxes: handle?.querySelectorAll('circle').length ?? -1,
      // 行里其余件（名字 / ✎ / 🗑）都不该是拖拽源——拖拽源只有抓手一枚。
      buttonsDraggable: Array.from(row?.querySelectorAll('button') ?? []).filter(
        (button) => (button as HTMLElement).draggable,
      ).length,
    }
  }, groupId)
}

interface HostFacts {
  /** 宿主状态存储里 groups 数组的 id 顺序。 */
  order: string[]
  /** 到目前为止对 `groups` 这个键的 state.write 次数。 */
  groupWrites: number
}

/** 假宿主那一侧的事实（落盘顺序与写入次数）。 */
async function hostFacts(page: OpenedPage['page']): Promise<HostFacts> {
  return page.evaluate(() => {
    const host = (globalThis as unknown as {
      __LAB_HOST__?: { stateStore?: Record<string, unknown>; hostCalls?: { call: string; args?: { key?: string } }[] }
    }).__LAB_HOST__
    const raw = host?.stateStore?.['groups']
    const parsed = typeof raw === 'string' ? (JSON.parse(raw) as { groups?: { id: string }[] }) : (raw as { groups?: { id: string }[] } | undefined)
    return {
      order: (parsed?.groups ?? []).map((group) => group.id),
      groupWrites: (host?.hostCalls ?? []).filter(
        (call) => call.call === 'state.write' && call.args?.key === 'groups',
      ).length,
    }
  })
}

/** 到目前为止**全部** `state.write` 的次数（会话行那一条用它证明「零写入」）。 */
async function stateWrites(page: OpenedPage['page']): Promise<number> {
  return page.evaluate(() => {
    const host = (globalThis as unknown as { __LAB_HOST__?: { hostCalls?: { call: string }[] } }).__LAB_HOST__
    return (host?.hostCalls ?? []).filter((call) => call.call === 'state.write').length
  })
}

interface RowDragFacts {
  opacity: number
  dragging: boolean
  className: string
  /** 这一行是不是拖拽源（官方那一侧也要它，用来证明那条拖拽路真的活着）。 */
  draggable: boolean
}

/** 会话行的拖拽态读数（自有树给选择器，官方页给官方行选择器）。 */
async function rowDragFacts(page: OpenedPage['page'], selector: string): Promise<RowDragFacts> {
  return page.evaluate((sel: string) => {
    const row = document.querySelector(sel) as HTMLElement | null
    if (row === null) throw new Error(`row missing: ${sel}`)
    return {
      opacity: Number.parseFloat(getComputedStyle(row).opacity),
      dragging: row.className.includes('dshOneTree_dragging'),
      className: row.className,
      draggable: row.draggable,
    }
  }, selector)
}

/* ---------------------------------------------------------------------------
 * 拖拽的四个阶段（分阶段是为了看「拖到一半」的现场）
 * ------------------------------------------------------------------------ */

/**
 * 起手：在拖拽源上派发 `dragstart`（把载荷写进这一轮的 `DataTransfer`，并挂到页面全局
 * 供后面三个阶段共用——`dragstart` 与 `drop` 必须拿到同一个对象才读得到载荷）。
 */
async function dragBegin(
  page: OpenedPage['page'],
  source: string,
  mime: string,
  payload: string,
): Promise<void> {
  await page.evaluate(
    (args: { source: string; mime: string; payload: string }) => {
      const from = document.querySelector(args.source)
      if (from === null) throw new Error(`drag source missing: ${args.source}`)
      const dataTransfer = new DataTransfer()
      dataTransfer.setData(args.mime, args.payload)
      ;(globalThis as unknown as { __labDragDT__?: DataTransfer }).__labDragDT__ = dataTransfer
      from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }))
    },
    { source, mime, payload },
  )
  await page.waitForTimeout(200)
}

/** 悬到目标行的上半 / 下半（`dragenter` + `dragover`，落点判定读的就是这两下）。 */
async function dragHover(
  page: OpenedPage['page'],
  target: string,
  mime: string,
  where: 'top' | 'bottom',
): Promise<void> {
  await page.evaluate(
    (args: { target: string; mime: string; where: string }) => {
      const to = document.querySelector(args.target)
      if (to === null) throw new Error(`drag target missing: ${args.target}`)
      const dataTransfer = (globalThis as unknown as { __labDragDT__?: DataTransfer }).__labDragDT__
      if (dataTransfer === undefined) throw new Error('dragBegin 还没跑（没有这一轮的 DataTransfer）')
      if (!dataTransfer.types.includes(args.mime)) throw new Error(`载荷里没有 ${args.mime}`)
      const rect = to.getBoundingClientRect()
      const y = args.where === 'top' ? rect.top + 1 : rect.bottom - 1
      for (const type of ['dragenter', 'dragover']) {
        to.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer, clientY: y }))
      }
    },
    { target, mime, where },
  )
  await page.waitForTimeout(200)
}

/** 落在目标行上。 */
async function dragDropAt(
  page: OpenedPage['page'],
  target: string,
  mime: string,
  where: 'top' | 'bottom',
): Promise<void> {
  await page.evaluate(
    (args: { target: string; mime: string; where: string }) => {
      const to = document.querySelector(args.target)
      if (to === null) throw new Error(`drag target missing: ${args.target}`)
      const dataTransfer = (globalThis as unknown as { __labDragDT__?: DataTransfer }).__labDragDT__
      if (dataTransfer === undefined) throw new Error('dragBegin 还没跑（没有这一轮的 DataTransfer）')
      const rect = to.getBoundingClientRect()
      const y = args.where === 'top' ? rect.top + 1 : rect.bottom - 1
      to.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, clientY: y }))
    },
    { target, mime, where },
  )
  await page.waitForTimeout(400)
}

/** 松手（不论落在哪，真实拖拽最后都会来这一下）。 */
async function dragRelease(page: OpenedPage['page'], source: string): Promise<void> {
  await page.evaluate((sel: string) => {
    const from = document.querySelector(sel)
    if (from === null) return
    const dataTransfer = (globalThis as unknown as { __labDragDT__?: DataTransfer }).__labDragDT__
    from.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dataTransfer ?? null }))
  }, source)
  await page.waitForTimeout(300)
}

/** 一次完整的拖拽（起手 → 悬停 → 落下 → 松手），落点用 `where` 定前 / 后。 */
async function dragGroupRow(
  page: OpenedPage['page'],
  fromId: string,
  toId: string,
  where: 'top' | 'bottom',
): Promise<void> {
  const handle = `[data-dshone-manage-group="${fromId}"] [data-dshone-tree-action="group-drag"]`
  const target = `[data-dshone-manage-group="${toId}"]`
  await dragBegin(page, handle, GROUP_DRAG_MIME, fromId)
  await dragHover(page, target, GROUP_DRAG_MIME, where)
  await dragDropAt(page, target, GROUP_DRAG_MIME, where)
  await dragRelease(page, handle)
}

/** 打开「管理分组…」对话框（第一层）。 */
async function openManage(page: OpenedPage['page']): Promise<void> {
  await page.click('[data-dshone-tree-action="group-pill"]')
  await page.waitForSelector('[data-dshone-tree-action="group-manage"]')
  await page.click('[data-dshone-tree-action="group-manage"]')
  await page.waitForSelector('[data-dshone-tree="group-manage-list"]')
  await page.waitForTimeout(200)
}

/* ---------------------------------------------------------------------------
 * 套件
 * ------------------------------------------------------------------------ */

export const DRAG_PARITY_SUITE: LabSuite = {
  id: 'F-50',
  phase: 'new-feature',
  name: '拖拽补齐（#155）：管理分组框里拖组行换顺序（落盘一次）+ 拖动会话行时源行半透明（按旧侧栏那份值，官方页实测无此形态）',
  expect:
    '真实装配页上（真网关**只读** + 假宿主 + 注入的三个自定义分组：Lab One / Lab Two / Lab Empty）验两件事。**① 拖组行换顺序**（#155）：管理分组对话框第一层的每一行前面有一枚抓手（旧侧栏 `.wsg-row-handle` 那枚 6 点把手，16×24，`aria-label` = 插件词典 `group.drag`），**抓手是这一行唯一的拖拽源**（行里的名字 / ✎ / 🗑 三枚按钮都不是 `draggable`）；抓住它悬到另一行的**上半 = 插到它前面、下半 = 插到它后面**（与同页 pill 拖拽同一条判定），悬停时目标行上出现落点标记（`data-dshone-group-drop` = `before` / `after`，画法与本页 pill 拖拽的落点标记同一手）且**被拖的那一行半透明**（实测 opacity = 旧侧栏 `.wsg-row.dragging` 那一份值，从旧侧栏 CSS 源码解析出来、不写死）。落下之后：界面上的行顺序 = 按落点重排的顺序，**假宿主状态存储里 `groups` 数组的顺序与界面逐条一致**，并且这一下**只产生一次 `state.write`**；**拖到自身位置**（悬在自己那行的上半再落下）顺序不变、**一次写入都不产生**；松手（`dragend`）之后半透明与落点标记都恢复（opacity 回到 1、标记值为空）。两端的边界也在真页面上走一遍：最后一个组拖到第一个之前、重载页面后顺序仍是拖完的那一份（证明那次写入真的落进了宿主状态）。**只有一个组**的页面上，拖它自己（上半 / 下半）不崩、也不写入。**② 拖动会话行时源行半透明**：抓住会话行拖起来，这一行解析出来的 `opacity` = 旧侧栏 `.session-row.dragging` 那一份值、其余行不受影响；松手后回到 1。**官方优先的口径由本套件实测**：同一台机器上另开官方浏览区页（`/sidebar-official`），展开工作区后对官方会话行走同一条路（`dragstart` → 读源行 → `dragend`）——官方源行的解析 `opacity` 仍是 1、类名串一个字不变，即官方侧栏拖动时源行**没有任何形态**，所以本条按旧侧栏补（理由也写在 `styles.ts` 那两条规则上方）。全程零 pageerror、零槽位崩溃 / 零装载未激活、**零写类 RPC**（走过的 `/api/` 方法名逐个核过；状态写只进假宿主的内存表）。',
  run: async (ctx, check) => {
    const screenshots: string[] = []
    const shot = async (page: OpenedPage['page'], name: string): Promise<string> => {
      const file = path.join(ctx.shots, `${name}.png`)
      await fsp.mkdir(ctx.shots, { recursive: true })
      await page.screenshot({ path: file })
      return file
    }
    // 期望值：旧侧栏正本里的两份透明度（不写死）。
    const legacySessionOpacity = legacyDragOpacity('.session-row')
    const legacyGroupRowOpacity = legacyDragOpacity('.wsg-row')
    check.fact(
      `旧侧栏正本（src/ui/sessionsView.ts）：.session-row.dragging opacity=${String(legacySessionOpacity)}、.wsg-row.dragging opacity=${String(legacyGroupRowOpacity)}`,
    )
    check.fact(`本条的拖拽载荷：${GROUP_DRAG_MIME}（与 text/dsh-tag 分开的理由见 groups.ts 常量上方）`)
    const expectedLabel = [ZH['group.drag'] ?? '', EN['group.drag'] ?? '']
    check.fact(`抓手文案的期望值（插件词典）：${JSON.stringify(expectedLabel)}`)

    const apiCalls: string[] = []
    const watchApi = async (page: OpenedPage['page']): Promise<void> => {
      await page.route('**/api/**', async (r) => {
        apiCalls.push(decodeURIComponent(r.request().url()).split('/api/')[1] ?? '')
        await r.continue()
      })
    }

    // ---- 页面一：三个分组的侧栏页（组行换序的主角）----
    const own = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), {
      width: 420,
      height: 900,
      state: { groups: { version: 1, groups: GROUPS, membership: {}, activeGroupId: null } },
    })
    await watchApi(own.page)
    try {
      // 夹具用真工作区 id 造归属（两个组都有成员，计数才有得比）；分组状态是挂载时读一次的，
      // 所以注入之后要重载页面（与 F-41 同一手）。
      const workspaces = await own.page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-dshone-tree-row="workspace"]')).map(
          (row) => row.getAttribute('data-dshone-tree-key') ?? '',
        ),
      )
      check.ok('网关上有工作区行（归属夹具要有真 id，计数才有得比）', workspaces.length > 0, JSON.stringify(workspaces))
      if (workspaces.length === 0) return screenshots
      const first = workspaces[0] as string
      await own.page.addInitScript({
        content: `(() => { globalThis.__LAB_HOST__.stateStore['groups'] = ${JSON.stringify({
          version: 1,
          groups: GROUPS,
          membership: { [first]: ['g-lab-one', 'g-lab-two'] },
          activeGroupId: null,
        })} })()`,
      })
      await own.page.reload({ waitUntil: 'domcontentloaded' })
      await own.page.waitForSelector(route('sidebar').readySelector, { timeout: 40_000 })
      await own.page.waitForTimeout(2_500)
      // 会话行那条要看得见会话行（工作区默认可能是折叠的）。
      await expandAllWorkspaces(own.page)

      // ---- ① 抓手：在场、是唯一拖拽源、文案与几何 ----
      await openManage(own.page)
      const opened = await manageRows(own.page)
      check.eq(
        '① 管理框第一层仍列出全部三个分组（顺序 = 注入顺序）',
        opened.map((row) => row.id),
        GROUPS.map((group) => group.id),
      )
      check.ok(
        '① 每一行恰好一枚抓手',
        opened.every((row) => row.handles === 1),
        JSON.stringify(opened.map((row) => ({ id: row.id, handles: row.handles }))),
      )
      const handle = await handleFacts(own.page, 'g-lab-one')
      check.ok(
        '① 抓手真的是拖拽源（`draggable` 为真）',
        handle.found && handle.draggable,
        JSON.stringify(handle),
      )
      check.ok(
        '① 抓手的文案 = 插件词典 group.drag（读屏与悬停提示同一份）',
        expectedLabel.includes(handle.label) && expectedLabel.includes(handle.title),
        JSON.stringify({ label: handle.label, title: handle.title, expected: expectedLabel }),
      )
      check.ok(
        '① 行里的三枚按钮都不是拖拽源（拖拽源只有抓手一枚）',
        handle.buttonsDraggable === 0,
        `buttonsDraggable=${String(handle.buttonsDraggable)}`,
      )
      check.eq('① 抓手的盒子 = 旧侧栏那枚把手的 16×24', [handle.width, handle.height, handle.boxes], [16, 24, 6])
      screenshots.push(await shot(own.page, 'drag-parity-manage-handles'))

      // ---- ② 拖到一半的现场：源行半透明 + 落点标记 + 还不写入 ----
      const before = await hostFacts(own.page)
      const handleOne = '[data-dshone-manage-group="g-lab-one"] [data-dshone-tree-action="group-drag"]'
      const targetEmpty = '[data-dshone-manage-group="g-lab-empty"]'
      await dragBegin(own.page, handleOne, GROUP_DRAG_MIME, 'g-lab-one')
      const draggingMiddle = await manageRows(own.page)
      check.eq(
        '② 被拖的那一行实测 opacity = 旧侧栏 .wsg-row.dragging 那一份值',
        draggingMiddle.find((row) => row.id === 'g-lab-one')?.opacity,
        legacyGroupRowOpacity,
      )
      check.ok(
        '② 半透明只落在被拖的那一行（其余行照常不透明）',
        draggingMiddle.filter((row) => row.dragging).length === 1 && draggingMiddle.filter((row) => row.id !== 'g-lab-one').every((row) => row.opacity === 1),
        JSON.stringify(draggingMiddle.map((row) => ({ id: row.id, opacity: row.opacity, dragging: row.dragging }))),
      )
      await dragHover(own.page, targetEmpty, GROUP_DRAG_MIME, 'top')
      const hoverTop = await manageRows(own.page)
      check.eq(
        '② 悬在目标行的上半 = 落点标记 before',
        hoverTop.find((row) => row.id === 'g-lab-empty')?.drop,
        'before',
      )
      await dragHover(own.page, targetEmpty, GROUP_DRAG_MIME, 'bottom')
      const hoverBottom = await manageRows(own.page)
      check.eq(
        '② 悬在目标行的下半 = 落点标记 after（同一条判定，两个方向都生效）',
        hoverBottom.find((row) => row.id === 'g-lab-empty')?.drop,
        'after',
      )
      screenshots.push(await shot(own.page, 'drag-parity-manage-hover'))
      // 松手（这一轮的拖拽到此为止，什么都没落下）——半透明与标记都要恢复，顺序照旧。
      await dragRelease(own.page, handleOne)
      const released = await manageRows(own.page)
      const afterRelease = await hostFacts(own.page)
      check.ok(
        '② 松手后源行恢复不透明（opacity 回到 1、拖拽类名摘掉）',
        released.filter((row) => row.dragging).length === 0 && released.every((row) => row.opacity === 1),
        JSON.stringify(released.map((row) => ({ id: row.id, opacity: row.opacity, dragging: row.dragging }))),
      )
      check.eq('② 松手后落点标记全部清掉', released.filter((row) => row.drop !== '').length, 0)
      check.eq('② 松手（没有落下）= 顺序不变、零写入', [released.map((row) => row.id), afterRelease.groupWrites], [opened.map((row) => row.id), before.groupWrites])

      // ---- ③ 真落下：拖第一组到最后一组之前 ----
      await dragGroupRow(own.page, 'g-lab-one', 'g-lab-empty', 'top')
      const dropped = await manageRows(own.page)
      const hostAfterDrop = await hostFacts(own.page)
      const expectedOrder = ['g-lab-two', 'g-lab-one', 'g-lab-empty']
      check.eq(
        '③ 落下后界面顺序 = 按落点重排（Lab One 插到 Lab Empty 前面）',
        dropped.map((row) => row.id),
        expectedOrder,
      )
      check.eq(
        '③ 宿主状态存储里 groups 的顺序与界面逐条一致（落盘的正是眼前这一份）',
        hostAfterDrop.order,
        dropped.map((row) => row.id),
      )
      check.eq(
        '③ 这一下只产生一次写入（一次动作 = 一次落盘）',
        hostAfterDrop.groupWrites - before.groupWrites,
        1,
      )
      check.eq('③ 落下后落点标记与半透明都清掉', [dropped.filter((row) => row.drop !== '').length, dropped.filter((row) => row.dragging).length], [0, 0])
      screenshots.push(await shot(own.page, 'drag-parity-manage-after-drop'))

      // ---- ④ 拖到自身位置 = 零写入 ----
      const beforeSelf = await hostFacts(own.page)
      await dragGroupRow(own.page, 'g-lab-two', 'g-lab-two', 'bottom')
      const afterSelf = await manageRows(own.page)
      const hostAfterSelf = await hostFacts(own.page)
      check.eq(
        '④ 拖到自身位置：顺序不变、零写入',
        [afterSelf.map((row) => row.id), hostAfterSelf.groupWrites - beforeSelf.groupWrites],
        [expectedOrder, 0],
      )

      // ---- ⑤ 末 → 首（另一端）----
      await dragGroupRow(own.page, 'g-lab-empty', 'g-lab-two', 'top')
      const tailFirst = await manageRows(own.page)
      const hostTailFirst = await hostFacts(own.page)
      check.eq(
        '⑤ 最后一个组拖到第一个之前：顺序 = 末、首、中，且宿主状态跟着走',
        [tailFirst.map((row) => row.id), hostTailFirst.order],
        [
          ['g-lab-empty', 'g-lab-two', 'g-lab-one'],
          ['g-lab-empty', 'g-lab-two', 'g-lab-one'],
        ],
      )
      check.eq('⑤ 这一次同样只有一次写入', hostTailFirst.groupWrites - hostAfterSelf.groupWrites, 1)

      // ---- ⑥ 写下去的那一份状态能被原样读回来（重载后顺序仍是拖完的那一份）----
      //
      // 假宿主的状态表是**页面内的内存表**（每次导航都重来一份），所以这里把「写下去的那一份」
      // 取出来当下一次导航的初值——验的是**那份状态的形状**能被树原样读回（落盘格式没漂）。
      const persisted = await own.page.evaluate(
        () => (globalThis as unknown as { __LAB_HOST__: { stateStore: Record<string, unknown> } }).__LAB_HOST__.stateStore['groups'],
      )
      await own.page.addInitScript({
        content: `(() => { globalThis.__LAB_HOST__.stateStore['groups'] = ${JSON.stringify(persisted)} })()`,
      })
      await own.page.reload({ waitUntil: 'domcontentloaded' })
      await own.page.waitForSelector(route('sidebar').readySelector, { timeout: 40_000 })
      await own.page.waitForTimeout(2_500)
      await openManage(own.page)
      const reloaded = await manageRows(own.page)
      const hostReloaded = await hostFacts(own.page)
      check.eq(
        '⑥ 重载后管理框里的顺序 = 拖完的那一份（写下去的那份状态被原样读回来）',
        reloaded.map((row) => row.id),
        ['g-lab-empty', 'g-lab-two', 'g-lab-one'],
      )
      check.eq(
        '⑥ 只是读回那一份状态、不产生新的写入',
        hostReloaded.groupWrites,
        0,
      )
      // 关掉管理框，回到树体做会话行那一条。
      await own.page.keyboard.press('Escape')
      await own.page.waitForSelector('[data-dshone-tree="group-manage-list"]', { state: 'detached', timeout: 5_000 })
      await own.page.waitForTimeout(300)
      await expandAllWorkspaces(own.page)

      // ---- ⑦ 拖动会话行：源行半透明（照旧侧栏那一份值）----
      const sessionRows = await own.page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-dshone-tree-row="session"]'))
          .map((row) => row.getAttribute('data-dshone-tree-session') ?? '')
          .filter((id) => id !== ''),
      )
      check.ok('⑦ 树上有会话行可拖（折叠全部展开之后）', sessionRows.length > 0, JSON.stringify(sessionRows.slice(0, 3)))
      if (sessionRows.length === 0) return screenshots
      const draggingSession = sessionRows[0] as string
      const sessionSelector = `[data-dshone-tree-session="${draggingSession}"]`
      const sessionBefore = await rowDragFacts(own.page, sessionSelector)
      const writesBeforeSession = await stateWrites(own.page)
      await dragBegin(own.page, sessionSelector, 'text/dsh-session', draggingSession)
      const sessionDuring = await rowDragFacts(own.page, sessionSelector)
      const othersDuring = await own.page.evaluate((sel: string) => {
        const others = Array.from(document.querySelectorAll('[data-dshone-tree-row="session"]')).filter(
          (row) => `[data-dshone-tree-session="${row.getAttribute('data-dshone-tree-session') ?? ''}"]` !== sel,
        )
        return others.map((row) => Number.parseFloat(getComputedStyle(row as Element).opacity))
      }, sessionSelector)
      check.eq(
        '⑦ 拖动中的源行实测 opacity = 旧侧栏 .session-row.dragging 那一份值',
        sessionDuring.opacity,
        legacySessionOpacity,
      )
      check.ok(
        '⑦ 拖拽态只落在源行上（其余会话行照常不透明）',
        sessionDuring.dragging && othersDuring.every((value) => value === 1),
        JSON.stringify({ dragging: sessionDuring.dragging, others: othersDuring.slice(0, 5) }),
      )
      check.eq('⑦ 拖之前这一行是正常的（不透明、没有拖拽类名）', [sessionBefore.opacity, sessionBefore.dragging], [1, false])
      screenshots.push(await shot(own.page, 'drag-parity-session-dragging'))
      await dragRelease(own.page, sessionSelector)
      const sessionAfter = await rowDragFacts(own.page, sessionSelector)
      check.eq(
        '⑦ 松手后恢复（opacity 回到 1、拖拽类名摘掉）',
        [sessionAfter.opacity, sessionAfter.dragging],
        [1, false],
      )
      check.eq(
        '⑦ 会话行这一路一次状态写入都不产生（挂上 / 摘下拖拽态只是视图态）',
        await stateWrites(own.page),
        writesBeforeSession,
      )
      check.eq('⑦ 自有树零 pageerror', withoutKnownNoise(own.capture.pageErrors).real, [])

      // ---- ⑧ 只有一个组：拖它自己不崩、也不写入 ----
      const single = await openTreePage(ctx.browser, ctx.lab, route('sidebar'), {
        width: 420,
        height: 900,
        state: {
          groups: {
            version: 1,
            groups: [{ id: 'g-lab-only', name: 'Only One' }],
            membership: {},
            activeGroupId: null,
          },
        },
      })
      try {
        await single.page.waitForSelector(route('sidebar').readySelector, { timeout: 40_000 })
        await single.page.waitForTimeout(2_000)
        await openManage(single.page)
        const singleRows = await manageRows(single.page)
        check.eq('⑧ 只有一个组的页面上，管理框里就是那一行', singleRows.map((row) => row.id), ['g-lab-only'])
        const singleBefore = await hostFacts(single.page)
        await dragGroupRow(single.page, 'g-lab-only', 'g-lab-only', 'bottom')
        const singleAfter = await manageRows(single.page)
        const singleHost = await hostFacts(single.page)
        check.eq(
          '⑧ 拖这唯一的一行到自己下半：顺序不变、零写入、不崩',
          [singleAfter.map((row) => row.id), singleHost.groupWrites - singleBefore.groupWrites],
          [['g-lab-only'], 0],
        )
        check.eq('⑧ 这一页零 pageerror', withoutKnownNoise(single.capture.pageErrors).real, [])
      } finally {
        await single.context.close()
      }

      // ---- ⑨ 官方那一侧实测：拖动时源行没有任何形态 ----
      const official = await openTreePage(ctx.browser, ctx.lab, route('sidebar-official'), {
        width: 420,
        height: 900,
      })
      await watchApi(official.page)
      try {
        await official.page.waitForSelector(route('sidebar-official').readySelector, { timeout: 40_000 })
        await official.page.waitForTimeout(2_000)
        const expanded = await expandOfficialWorkspaces(official.page)
        const officialRows = await official.page.evaluate(() =>
          Array.from(document.querySelectorAll('[class*="_sessionRow"]')).map((row) => row.className),
        )
        check.fact(`⑨ 官方浏览区：展开 ${String(expanded)} 个工作区后渲染 ${String(officialRows.length)} 条会话行`)
        if (officialRows.length === 0) {
          check.fact('⑨ 官方页这一轮没有会话行可量（当天数据），源行形态这一条按「实测不到」记事实、不判失败')
        } else {
          const OFFICIAL_ROW = '[class*="_sessionRow"]'
          const officialBefore = await rowDragFacts(official.page, OFFICIAL_ROW)
          const sessionId = await official.page.evaluate(() => {
            const row = document.querySelector('[class*="_sessionRow"]')
            return row?.textContent ?? ''
          })
          // 官方这一行真的是拖拽源（官方确有那条拖拽路），否则「没有源行形态」这个结论是空的。
          check.ok('⑨ 官方那条会话行确实是拖拽源（官方的拖拽路活着，下面这条结论才有意义）', officialBefore.draggable, JSON.stringify(officialBefore))
          // 只走 dragstart → dragend，**不派发 dragover / drop**：官方那条路上 dragover 会
          // 记下落点、dragend 会据此提交一次会话重排（那是写类动作），本套件不碰它。
          await dragBegin(official.page, OFFICIAL_ROW, 'text/plain', sessionId)
          const officialDuring = await rowDragFacts(official.page, OFFICIAL_ROW)
          await dragRelease(official.page, OFFICIAL_ROW)
          const officialAfter = await rowDragFacts(official.page, OFFICIAL_ROW)
          check.eq(
            '⑨ 官方侧栏拖动时源行的 opacity 一点都不变（官方没有源行拖拽形态）',
            [officialDuring.opacity, officialAfter.opacity],
            [1, 1],
          )
          check.eq(
            '⑨ 官方源行的类名串也不变（它没有任何拖拽类名可加）',
            [officialDuring.className === officialBefore.className, officialAfter.className === officialBefore.className],
            [true, true],
          )
          check.fact(
            `⑨ 官方那一版的依据（读源码）：Rows.module.css 的 \`_dropBefore\` / \`_dropAfter\` 两个伪元素只画落点插入线，源行不带拖拽态；官方也没有 setDragImage——用户看到的是浏览器给原生拖拽画的那份拖影。所以本条按旧侧栏补（值 ${String(legacySessionOpacity)}）。`,
          )
        }
        check.eq('⑨ 官方页零 pageerror', withoutKnownNoise(official.capture.pageErrors).real, [])
      } finally {
        await official.context.close()
      }

      // ---- 只读守卫（与 F-41 同一口径）----
      const writes = apiCalls.filter((call) => WRITE_METHODS.some((method) => call.startsWith(method)))
      check.fact(`本轮走过的 /api/ 方法：${JSON.stringify([...new Set(apiCalls)])}`)
      check.eq('只读：没有走过任何写类 RPC', writes, [])
    } finally {
      await own.context.close()
    }
    return screenshots
  },
}
