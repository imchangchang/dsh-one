/**
 * 壳座位（shell seat）这一层的共用读数（#248）——F-75 的「壳座位对账」套件与 F-54 的
 * 「壳上入口扫描」共用同一份读取与本表。
 *
 * ## 「壳座位」是什么
 *
 * 官方有些**页 / 弹层 / 全局面板**在官方 web 里住在某个「壳」里：`root` 的 keyed `main`
 * （对话区 / 插件页这两个全局面板）、`sidebar.panellist`（侧栏的全局面板行）、
 * `sidebar.settings`（设置入口行）、`sidebar.footer.action`（底部动作）、
 * `sidebar.workspaces`（浏览区 = 工作区树 / 会话树）、`settings.section`（设置页各节）、
 * `settings.action`（设置页动作行）、`settings.onboarding` / `settings.trigger`（官方设置
 * 弹层自己的两处座位）、`shell.overlay`（浮层）、`rightbar`（对话区右栏）、
 * `plugins.item`（插件页的条目列表 = 官方那四张配置卡）。
 *
 * 装配把某个壳换掉、或者某件载体插件被下线之后，**如果没给这些东西新的落点**，坏法有两种、
 * 都不报错（见 #248 的现场）：
 *
 * - **座没声明** ⇒ 官方 `slots.inject` 的回调永不跑（官方语义：目标名没被任何父条目的
 *   children 表声明就一直等，不抛错、不打日志）——能力静默消失；
 * - **座声明了但没人渲染** ⇒ 贡献注册成功、也占着座，页面上永远看不到。
 *
 * 两种都在 #248 里查实过实例（侧栏「插件」那一行是第一种的入口侧，#247 修；官方设置弹层的
 * 两条 onboarding 是第二种）。这一层判据要的是：**这两件事不能再靠用户点到才发现**。
 *
 * ## 这一份读的是什么
 *
 * 官方自己的槽位服务有一份可机读的座位快照（`ctx.slots.snapshot()`，实现
 * `@deepseek-ai/dsh-client-ui-slots/lib/index.js` 的 `snapshot`）：逐名给出 `kind` /
 * `scope` / `declaredBy` / 占位者（`id` / `key` / `priority` / `registrant`）与子座。
 * 这里读的就是它——**同一份读数在官方页（`/`，实验室那台网关的原始页面）与我们的每棵树
 * 各读一次**，然后按「座」对账。出处与调用点：官方页面与本树页面都经 fiber 探针留下的
 * `ctx`（`__LAB_FIBER__.ctx`）反射取 `slots` 服务——直接 `ctx.slots` 在没有 `inject` 声明的
 * ctx 上会抛（实测过，见 F-10 的注释），所以只走 `ctx.reflect.get('slots')`。
 *
 * `snapshot()` 的入参是「精确的座名或 `factory:<名>`」，**不给就返回全部活着的根**——
 * 这里不给参数，拿全量再自己拍平，因为对账要的是「这棵树声明了哪些壳座」，而不是逐个去问。
 *
 * ## 为什么不按插件 id 对账
 *
 * 官方可以不新增插件、只把页搬到另一个座里（0.1.7 把「取消归档」从设置节搬进
 * `sidebar.workspaces.session.menu.item`，而 `sidebar.workspaces` 正是被自有树 shadow 的座，
 * 见 #239）。按 id 盯的清单一条都不会红，按「座」对账才会。
 */
import type { Page } from 'playwright'

/** 一处壳座（对账的单位）。 */
export interface ShellSeat {
  /** 座名（官方槽位名，逐字）。 */
  name: string
  /** 官方 web 里它是什么（人读一行）。 */
  what: string
}

/**
 * 要对账的壳座全表。
 *
 * 收谁不收谁的口径：**「页 / 弹层 / 全局面板住在里面」的那种座**（#248 的定义），加上
 * 它们的直接容器座。不收纯装饰/纯品牌位（`sidebar.brand.mark` 等）：那里没有页可丢，
 * 而且对账表越长，每一条的理由越难写清——宁可少收几处、每条都说得清。
 */
export const SHELL_SEATS: readonly ShellSeat[] = [
  { name: 'main', what: 'keyed `main`：全局面板 / 页面本体（对话区、插件页、设置页都在它上面）' },
  { name: 'sidebar.panellist', what: '官方侧栏的全局面板行（今天只有「插件」一行）' },
  { name: 'sidebar.settings', what: '官方侧栏的设置入口行（设置弹层 `SettingsRoot` 挂在它下面）' },
  { name: 'sidebar.footer.action', what: '官方侧栏底部动作（cordis 面板 + 我们的回收站入口）' },
  { name: 'sidebar.workspaces', what: '官方侧栏的浏览区（工作区树 / 会话树所在）' },
  { name: 'settings.section', what: '设置页各节的内容座' },
  { name: 'settings.action', what: '设置页的动作行（打开配置文件）' },
  { name: 'settings.trigger', what: '官方设置弹层自己的触发条（官方齿轮那一条）' },
  { name: 'settings.onboarding', what: '官方设置弹层的两条 onboarding（首访声明 + 引导对话框）' },
  { name: 'shell.overlay', what: '浮层（终端浮层、自有右键菜单 / git 卡片）' },
  { name: 'rightbar', what: '对话区右栏（文件 / 终端 / 文档预览 / 浏览器）' },
  { name: 'plugins.item', what: '插件页的条目列表（官方那四张配置卡坐在这里）' },
]

/** 座名的集合（给页面侧脚本当入参）。 */
export const SHELL_SEAT_NAMES: readonly string[] = SHELL_SEATS.map((seat) => seat.name)

/** `what` 的查表（失败信息里点名「这是哪一处座」）。 */
export function describeSeat(name: string): string {
  return SHELL_SEATS.find((seat) => seat.name === name)?.what ?? '（不在壳座表里的名字）'
}

/**
 * 快照里的一处座（拍平后的形状）。
 *
 * `parent` 是被声明的父座名（根座为空串，`factory:<名>` 的子座记成 `factory:<名>`）——
 * 对账只看名字与占位者，「挂在谁下面」只写进事实给人看。
 */
export interface SeatNode {
  name: string
  kind: string
  scope: string
  declaredBy: string
  parent: string
  occupants: SeatOccupant[]
  /** 直接从这份快照里读到的子座名（声明关系，不是渲染关系）。 */
  children: string[]
}

export interface SeatOccupant {
  /** 官方 `id`（没有则空串）。 */
  id: string
  /** 官方 `key`（keyed 座上的键，没有则空串）。 */
  key: string
  /** 注册方（官方 `registrant`，取不到时是它的类名或空串）。 */
  registrant: string
  priority: number
  /** 官方算出来的「这个占位者是不是当前上位的那一条」（priority 最小者）。 */
  active: boolean
}

/** 占位者的一条可读身份：`id` 优先、其次 `key`、再退到「谁 + 优先级」。 */
export function occupantId(occupant: SeatOccupant): string {
  if (occupant.id !== '') return occupant.id
  if (occupant.key !== '') return `key:${occupant.key}`
  return `${occupant.registrant === '' ? '?' : occupant.registrant}@${String(occupant.priority)}`
}

/** 一处座在某一棵树上的两个读数：声明面（快照）+ 渲染面（DOM）。 */
export interface SeatReading {
  /** 这棵树声明了这个座（快照里有它）。 */
  declared: boolean
  node?: SeatNode
  /** 页面上的 `[data-slot="<座名>"]` 锚点数。 */
  anchors: number
  /** 锚点里的元素总数（不含锚点自己）。 */
  elements: number
  /** 锚点里有没有非空文字（plugins.item 那四张卡的摘要就是文字节点）。 */
  text: boolean
}

/** 「这个座在页面上有没有渲染出东西」——有锚点、且里面有元素或有文字。 */
export function hasRender(reading: SeatReading): boolean {
  return reading.anchors > 0 && (reading.elements > 0 || reading.text)
}

/** 页面上读座位的 DOM 面（锚点数 / 元素数 / 有没有文字）。 */
export async function readSeatRender(
  page: Page,
  names: readonly string[],
): Promise<Record<string, { anchors: number; elements: number; text: boolean }>> {
  return page.evaluate((seatNames: string[]) => {
    const out: Record<string, { anchors: number; elements: number; text: boolean }> = {}
    for (const name of seatNames) {
      let anchors = 0
      let elements = 0
      let text = false
      for (const anchor of Array.from(document.querySelectorAll(`[data-slot="${name}"]`))) {
        anchors += 1
        elements += anchor.querySelectorAll('*').length
        if ((anchor.textContent ?? '').trim() !== '') text = true
      }
      out[name] = { anchors, elements, text }
    }
    return out
  }, [...names])
}

/**
 * 页面侧读槽位快照（`ctx.slots.snapshot()`）并拍平成一串座。
 *
 * 拿不到快照时返回 `{ error }`（**不抛**）：调用方按「这一面没核实」判红并点名是哪一种
 * 拿不到，而不是抛一个异常把整轮截掉。
 */
/** 一处 **body 级 portal 覆盖层**，以及它归属的那个座。 */
export interface PortalReading {
  /** 出这处覆盖层的座（沿 React fiber 的 `return` 链找到最近的那个 `[data-slot]` 宿主元素）；读不到 = 空串。 */
  seat: string
  /** 覆盖层根元素的 `role`（官方 `Modal` 的根是 `role="presentation"`）。 */
  role: string
  /** 里面那个 `[role="dialog"]` 的 `aria-label`（官方 `Modal` 拿 title 当 aria-label）。 */
  label: string
  /** 覆盖层里的正文（前 120 字，人读用）。 */
  text: string
}

/**
 * 读页面上的 **body 级 portal 覆盖层**，并归属到座。
 *
 * 为什么要这一份读数（#249）：官方有些座上的贡献**渲染到 `document.body`**，锚点里一个
 * 节点都没有——官方设置弹层那两条 onboarding 就是（`OnboardingModal` 用官方 `Modal` 原语，
 * `createPortal(..., document.body)`）。只看锚点会把它读成「零渲染」，而它其实真的画出来了。
 * {@link readSeatRender} 那一份读数保持原样（它读的是锚点里有没有节点，判据要用它），
 * 「portal 出来的那部分」由这一份单独读，两份合起来才是这个座完整的渲染面。
 *
 * **归属怎么来**：React 的 portal 会把 DOM 挂到容器（这里是 `document.body`）下，DOM 上却
 * 断开了与宿主树的父子链——所以从覆盖层根元素沿 React fiber 的 `return` 链往上走，找最近的
 * 那个「`stateNode` 是带 `data-slot` 属性的宿主元素」的 fiber，就是**渲染它的那个出口**。
 * 这是读 React 内部字段（宿主元素上的 `__reactFiber$<随机>`，React 18 起就有、devtools 也
 * 在用）；认不出时不抛，`seat` 记空串，由调用方把「有一处覆盖层没归属上」如实报出来
 * ——**归属探针断了要看得到**，不能静默当成零。
 *
 * 只认**不在任何锚点里**的 `[role="dialog"]`：锚点里的对话不是 portal，别混进来。
 */
export async function readPortals(page: Page): Promise<PortalReading[]> {
  return page.evaluate(() => {
    const fiberKeyOf = (element: Element): string | undefined =>
      Object.keys(element).find(
        (key) => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$'),
      )
    const ownerSeatOf = (element: Element): string => {
      const key = fiberKeyOf(element)
      if (key === undefined) return ''
      let fiber = (element as unknown as Record<string, unknown>)[key] as
        | { stateNode?: unknown; return?: unknown }
        | undefined
      for (let hop = 0; fiber !== undefined && fiber !== null && hop < 200; hop += 1) {
        const node = fiber.stateNode
        if (node instanceof Element) {
          const name = node.getAttribute('data-slot')
          if (name !== null) return name
        }
        fiber = fiber.return as { stateNode?: unknown; return?: unknown } | undefined
      }
      return ''
    }
    const out: { seat: string; role: string; label: string; text: string }[] = []
    for (const child of Array.from(document.body.children)) {
      if (!(child instanceof Element)) continue
      const dialog = child.matches('[role="dialog"]') ? child : child.querySelector('[role="dialog"]')
      if (dialog === null) continue
      // 锚点里的对话不是 portal（那是座自己在渲染），只认 body 这一层挂出来的。
      if (dialog.closest('[data-slot]') !== null) continue
      out.push({
        seat: ownerSeatOf(child),
        role: child.getAttribute('role') ?? '',
        label: dialog.getAttribute('aria-label') ?? '',
        text: (child.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),
      })
    }
    return out
  }) as Promise<PortalReading[]>
}

/** 一处 portal 覆盖层的人读一行（报告的事实里点名用）。 */
export function describePortal(portal: PortalReading): string {
  const owner = portal.seat === '' ? '未归属上（fiber 归属探针没认出它）' : `归属 ${portal.seat}`
  return `${owner}：role=${portal.role} aria-label=${JSON.stringify(portal.label)} 正文=${JSON.stringify(portal.text)}`
}

/**
 * 设置页壳自己的 onboarding 游标读数（`settings.onboarding` 上这一轮要渲染哪一步）。
 *
 * 为什么读壳自己写下的这个属性、而不是去猜官方组件的内部状态：官方 `SettingsRoot` 的游标
 * 是**壳**持有的（`completedOnboarding` 集合 + `entries` 按 order 取第一条未完成的，
 * `dsh-client-ui-settings-general/lib/client.js:317`/`:344`），我们的设置页照抄了这条语义
 * （`settingsLayoutPlugin.ts` 的 SettingsPage），所以「这一轮是哪一步」这件事**只有壳知道**。
 * 读数取不到（属性不在 / 是空串）时返回空串——那是「座上没有当前步」，由调用方按语义解释。
 */
export async function readOnboardingCursor(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      document.querySelector('[data-shell="dsh-one-settings"]')?.getAttribute('data-dshone-onboarding-step') ?? '',
  )
}

export async function readSeatSnapshot(
  page: Page,
): Promise<{ seats: SeatNode[]; error: string }> {
  return page.evaluate(() => {
    const record = (globalThis as { __LAB_FIBER__?: { ctx?: unknown } }).__LAB_FIBER__
    if (record === undefined) return { seats: [], error: '这个页面没给套件留下 ctx（fiber 探针没接上）' }
    const ctx = record.ctx as { reflect?: { get?: (name: string) => unknown } } | undefined
    if (ctx === undefined) return { seats: [], error: 'fiber 探针的 ctx 是空的' }
    let slots: { snapshot?: () => unknown[] } | undefined
    try {
      slots = ctx.reflect?.get?.('slots') as { snapshot?: () => unknown[] } | undefined
    } catch (error) {
      return { seats: [], error: `反射取 slots 抛了：${error instanceof Error ? error.message : String(error)}` }
    }
    if (slots === undefined || typeof slots.snapshot !== 'function') {
      return { seats: [], error: '反射取到的 slots 上没有 snapshot()' }
    }
    const registrantName = (value: unknown): string => {
      if (value === undefined || value === null) return ''
      if (typeof value === 'string') return value
      if (typeof value === 'object') {
        const typed = value as { id?: unknown; name?: unknown }
        if (typeof typed.id === 'string') return typed.id
        if (typeof typed.name === 'string') return typed.name
        return 'object'
      }
      return String(value)
    }
    const seats: unknown[] = []
    const walk = (node: unknown, parent: string): void => {
      if (node === null || typeof node !== 'object') return
      const typed = node as {
        type?: string
        name?: string
        kind?: string
        scope?: string
        declaredBy?: unknown
        occupants?: unknown[]
        children?: unknown[]
      }
      if (typed.type !== 'slot') return
      const name = String(typed.name ?? '')
      const occupants = (typed.occupants ?? []).map((raw) => {
        const occupant = raw as { id?: unknown; key?: unknown; registrant?: unknown; priority?: unknown; active?: unknown }
        return {
          id: typeof occupant.id === 'string' ? occupant.id : '',
          key: typeof occupant.key === 'string' ? occupant.key : '',
          registrant: registrantName(occupant.registrant),
          priority: typeof occupant.priority === 'number' ? occupant.priority : 0,
          active: occupant.active === true,
        }
      })
      const children: string[] = []
      for (const child of typed.children ?? []) {
        const childName = (child as { name?: unknown }).name
        if (typeof childName === 'string') children.push(childName)
      }
      seats.push({
        name,
        kind: String(typed.kind ?? ''),
        scope: String(typed.scope ?? ''),
        declaredBy: registrantName(typed.declaredBy),
        parent,
        occupants,
        children,
      })
      for (const child of typed.children ?? []) walk(child, name)
    }
    let roots: unknown[]
    try {
      roots = slots.snapshot() as unknown[]
    } catch (error) {
      return { seats: [], error: `slot snapshot() 抛了：${error instanceof Error ? error.message : String(error)}` }
    }
    for (const root of roots) {
      const typed = root as { type?: string; name?: string; children?: unknown[] }
      if (typed.type === 'factory') {
        // factory 的子座（会话级 shape 定义出来的那些座）也拍平进来：它们同样是「声明了的座」，
        // 只是不属壳座表，对账时会按名字跳过。
        for (const child of typed.children ?? []) walk(child, `factory:${String(typed.name ?? '')}`)
        continue
      }
      walk(root, '')
    }
    return { seats: seats as never, error: '' }
  }) as Promise<{ seats: SeatNode[]; error: string }>
}

/** 一处座在某棵树上的完整读数（声明面 + 渲染面合成一份）。 */
export async function readTreeSeats(
  page: Page,
): Promise<{ seats: Map<string, SeatNode>; readings: Map<string, SeatReading>; error: string }> {
  const snapshot = await readSeatSnapshot(page)
  const render = snapshot.error === '' ? await readSeatRender(page, SHELL_SEAT_NAMES) : {}
  const seats = new Map<string, SeatNode>()
  for (const node of snapshot.seats) {
    // 同名座理论上只有一条（官方 registry 一个名字一条记录）；真出现重复时保留第一条并
    // 由调用方的「名字集合」读法兜住——对账看的是声明面，重复本身不是本表能判的事。
    if (!seats.has(node.name)) seats.set(node.name, node)
  }
  const readings = new Map<string, SeatReading>()
  for (const name of SHELL_SEAT_NAMES) {
    const node = seats.get(name)
    const dom = render[name]
    readings.set(name, {
      declared: node !== undefined,
      ...(node === undefined ? {} : { node }),
      anchors: dom?.anchors ?? 0,
      elements: dom?.elements ?? 0,
      text: dom?.text ?? false,
    })
  }
  return { seats, readings, error: snapshot.error }
}

// ---------------------------------------------------------------------------
// 白名单（判据的一部分，不是跳过开关）
// ---------------------------------------------------------------------------

/**
 * 一处**有意**的缺席：某一棵树上某一处壳座「不声明」、「声明了但没有渲染节点」，或
 * 「声明了、座上的人都是按需渲染的」。
 *
 * 白名单是判据的一部分：条目要么在场（放行、理由写进事实）、要么本条判据红。**没有第三种
 * 状态**——「今天正好没红」不算理由。
 */
export interface SeatWaiver {
  /** 树（实验室路由名：`sidebar` / `chat` / `settings` / `plugins`）。 */
  tree: string
  /** 座名（壳座表里的名字）。 */
  seat: string
  /**
   * 是哪一种缺席：
   * - `absent`：这个座本树不声明；
   * - `unrendered`：声明了、座上有人，但页面上一个渲染节点都没有；
   * - `lazy`：声明了、座上有人、页面上一眼也确实没有渲染节点，但**座上每一个人都是按需渲染的**
   *   （要一个交互或一个数据前提才出现）——`occupants` 要逐个点名，名单不齐就判红，
   *   所以「座上多了一个不该按需渲染的人」不会被这条白名单一起放过。
   */
  verdict: 'absent' | 'unrendered' | 'lazy'
  /** 为什么这是有意收敛（人读的整句，别写「暂不适用」）。 */
  reason: string
  /** `lazy` 专用：这一轮在座上的、已知按需渲染的占位者名单（用 {@link occupantId} 的写法）。 */
  occupants?: readonly string[]
}

/** `absent`：这一族座不是这棵树的事（同一棵树里成族缺席时共用这一句，后半句点名那一族）。 */
const notThisTree = (family: string, why: string): string => `这不是这棵树的事：${family} 的落点在别的树（${why}）`

/**
 * 几条成族的常用理由（同一句话被多处引用，避免把同一条理由抄十遍而各自漂移）。
 */
const WHY = {
  settingsElsewhere: notThisTree('设置页', '设置独立成一棵 settings 树（#70），本树不渲染设置内容'),
  sidebarElsewhere: notThisTree('侧栏壳', '侧栏位由 sidebar 树承接（#70），本树的 block list 里没有官方侧栏件或本树不渲染侧栏'),
  conversationElsewhere: notThisTree('对话区 / 右栏', '对话区由 chat 树承接（#64），右栏也在那棵树上（#79 决策 B）'),
  pluginsElsewhere: notThisTree(
    '官方插件页',
    '官方插件页有自己的 plugins 树（#247），那一页的入口在侧栏那一行（经本树 layout 服务受理、转宿主开独立页）',
  ),
}

/**
 * 白名单全表（逐条带理由）。
 *
 * 分组读法：先按树、再按「为什么」。每一条都是**当下有意为之**的收敛，理由写到现在还成立
 * 的依据（哪条 issue 的哪一次决定）；将来若有条目不再成立（例如官方把某页搬进别的座），
 * 本表不动，判据会当场红出来。
 */
export const SEAT_WAIVERS: readonly SeatWaiver[] = [
  // ---- sidebar 树：侧栏位这一页 ----
  {
    tree: 'sidebar',
    seat: 'main',
    verdict: 'absent',
    reason:
      '侧栏位这一页不承接任何全局面板：官方 keyed `main` 上那两条条目（`conversation` 对话区、`plugins` 插件页）各有自己的树——对话区在 chat 树（#64）、插件页在 plugins 树（#247），设置页在 settings 树（#70）。侧栏那一行点了要开的正是这一页，处置是经本树 layout 服务受理后转宿主开独立页（#247），所以本树不需要 `main`',
  },
  {
    tree: 'sidebar',
    seat: 'shell.overlay',
    verdict: 'lazy',
    occupants: ['@deepseek-ai/dsh-client-ui-sidebar-terminal'],
    reason:
      '座上的官方终端浮层（`ui-sidebar-terminal`）只在**终端面板打开着**的时候才渲染，页面刚开时座是空的——按需渲染，不是「内容进不来」',
  },
  { tree: 'sidebar', seat: 'settings.section', verdict: 'absent', reason: WHY.settingsElsewhere },
  { tree: 'sidebar', seat: 'settings.action', verdict: 'absent', reason: WHY.settingsElsewhere },
  { tree: 'sidebar', seat: 'settings.trigger', verdict: 'absent', reason: WHY.settingsElsewhere },
  { tree: 'sidebar', seat: 'settings.onboarding', verdict: 'absent', reason: WHY.settingsElsewhere },
  { tree: 'sidebar', seat: 'rightbar', verdict: 'absent', reason: WHY.conversationElsewhere },
  { tree: 'sidebar', seat: 'plugins.item', verdict: 'absent', reason: WHY.pluginsElsewhere },
  {
    tree: 'sidebar',
    seat: 'sidebar.settings',
    verdict: 'unrendered',
    reason:
      '设置改成 VS Code 侧独立编辑器页（#70）：官方那行设置入口在这棵树上由自有空件按同 id + priority −1 遮蔽（settingsGearPlugin），所以座上只剩一个不渲染的条目、页面上的锚点里零节点，是有意的——入口在工具栏齿轮与命令面板上',
  },
  {
    tree: 'sidebar',
    seat: 'sidebar.panellist',
    verdict: 'unrendered',
    reason:
      '官方侧栏那条「插件」整行在这棵树上由自有空件按同 id + priority −1 遮蔽（机制层 1，同 settingsGearPlugin 那一条的做法），行盒子另按 css-module 名后缀摘掉（机制层 4，举证见 sidebarLayoutPlugin 的 CSS 上方那段）——所以座上两个占位者（我们那条 priority −1 的空件 + 官方那条 priority 0）都不进渲染位，页面上的锚点里零节点，是有意的：入口改由侧栏工具栏那一枚插件图标承担（#252，紧挨设置齿轮左侧，走同一条能力口 `openPlugins`）。**不是「内容进不来」**：官方件照常装载（插件页本体在 plugins 树上），官方那条行若哪天回来（遮蔽或那条 CSS 被上游改名撞失效）也能照常点开那一页（见 sidebarLayoutPlugin 的 openPluginsPage）',
  },
  // ---- chat 树：对话区这一页 ----
  { tree: 'chat', seat: 'sidebar.panellist', verdict: 'absent', reason: WHY.sidebarElsewhere },
  { tree: 'chat', seat: 'sidebar.settings', verdict: 'absent', reason: WHY.sidebarElsewhere },
  { tree: 'chat', seat: 'sidebar.footer.action', verdict: 'absent', reason: WHY.sidebarElsewhere },
  { tree: 'chat', seat: 'sidebar.workspaces', verdict: 'absent', reason: WHY.sidebarElsewhere },
  { tree: 'chat', seat: 'settings.section', verdict: 'absent', reason: WHY.settingsElsewhere },
  { tree: 'chat', seat: 'settings.action', verdict: 'absent', reason: WHY.settingsElsewhere },
  { tree: 'chat', seat: 'settings.trigger', verdict: 'absent', reason: WHY.settingsElsewhere },
  { tree: 'chat', seat: 'settings.onboarding', verdict: 'absent', reason: WHY.settingsElsewhere },
  {
    tree: 'chat',
    seat: 'shell.overlay',
    verdict: 'lazy',
    occupants: ['dsh-one-context-menu', 'dsh-one-git-card', '@deepseek-ai/dsh-client-ui-sidebar-terminal'],
    reason:
      '座上的三件全是**按需渲染**的：自有右键菜单要一次行内右键、git 卡片要有提交记录（当天数据）、官方终端浮层要终端面板打开着——页面刚开时座是空的，这不是「内容进不来」',
  },
  {
    tree: 'chat',
    seat: 'plugins.item',
    verdict: 'unrendered',
    reason:
      '本树声明了 keyed `main`（官方 root 契约要求，缺它官方 ui-agent-preset 的会话级 scope 会抛 #74），官方插件页那条 keyed 条目因此连带注册进来、它自己声明的三个子座（含 plugins.item）随之成立，但本页按 key `conversation` 渲染，不渲染那条 `plugins` 条目——插件页的落点在自己的 plugins 树（#247）',
  },
  // ---- settings 树：设置这一页 ----
  { tree: 'settings', seat: 'sidebar.panellist', verdict: 'absent', reason: WHY.sidebarElsewhere },
  { tree: 'settings', seat: 'sidebar.settings', verdict: 'absent', reason: WHY.sidebarElsewhere },
  { tree: 'settings', seat: 'settings.trigger', verdict: 'absent', reason: WHY.settingsElsewhere },
  { tree: 'settings', seat: 'rightbar', verdict: 'absent', reason: WHY.conversationElsewhere },
  {
    tree: 'settings',
    seat: 'sidebar.workspaces',
    verdict: 'unrendered',
    reason:
      '声明这两个侧栏座与 footer.action 是**为了官方贡献有处可注册**：本树的 root children 表照官方 ui-layout 的 root 契约补齐（#74 那条缺声明会让官方整件停车），而 SettingsFrame 只渲染设置页本体，不画侧栏——这一页没有侧栏可看，属有意',
  },
  {
    tree: 'settings',
    seat: 'sidebar.footer.action',
    verdict: 'unrendered',
    reason:
      '同 sidebar.workspaces：声明它是为了让官方 root 契约完整（官方底部动作条有处注册），本页不渲染侧栏，所以零渲染节点',
  },
  {
    tree: 'settings',
    seat: 'shell.overlay',
    verdict: 'unrendered',
    reason:
      '官方 root 契约里的浮层座，声明它是为了官方贡献不停车；本页只渲染 keyed `main` 上自己那条条目（设置页本体），浮层里也没有入口（终端浮层是对话区的东西）',
  },
  {
    tree: 'settings',
    seat: 'settings.onboarding',
    verdict: 'lazy',
    occupants: ['welcome-notice', 'deepseek-official'],
    reason:
      '座上那两条官方 onboarding 直到 #249 之前是**声明了却零渲染**（本页从不渲染这个座）；#249 起设置页按官方 `SettingsRoot` 的语义渲染它（单步游标 + `only`，见 settingsLayoutPlugin 的 SettingsPage）。它们仍是**按需渲染**：`welcome-notice` 要一次没确认过的首访提示（`ui-onboarding` 里那个确认标记）、`deepseek-official` 要「没有任何可用凭据」这个前提，两条都由官方组件按自己的状态决定显不显示，而且形态是 **body 级 portal 的模态框**（官方 `Modal` 原语 `createPortal(..., document.body)`）——所以座上的锚点里永远不会有节点，这一格按「锚点里有没有节点」读就是零渲染。两份读数分开：本表的渲染面读锚点（不判 portal），「这一轮到底渲染出哪一条、有没有真的画出来」由本套件的「设置页 onboarding」那一段按 portal 读数逐条判（读不出当前步、或当前步没画出模态框都判红）',
  },
  {
    tree: 'settings',
    seat: 'plugins.item',
    verdict: 'unrendered',
    reason:
      '与 chat 树同形：本树声明 keyed `main` 是官方 root 契约要求，官方插件页那条 keyed 条目连带注册、三个子座随之成立，但本页只渲染自己那条 key（`dshOne.settings`）——插件页的落点在 plugins 树（#247）',
  },
  // ---- plugins 树：官方插件页这一页 ----
  { tree: 'plugins', seat: 'sidebar.panellist', verdict: 'absent', reason: WHY.sidebarElsewhere },
  { tree: 'plugins', seat: 'sidebar.settings', verdict: 'absent', reason: WHY.sidebarElsewhere },
  { tree: 'plugins', seat: 'sidebar.footer.action', verdict: 'absent', reason: WHY.sidebarElsewhere },
  { tree: 'plugins', seat: 'sidebar.workspaces', verdict: 'absent', reason: WHY.sidebarElsewhere },
  { tree: 'plugins', seat: 'settings.section', verdict: 'absent', reason: WHY.settingsElsewhere },
  { tree: 'plugins', seat: 'settings.action', verdict: 'absent', reason: WHY.settingsElsewhere },
  { tree: 'plugins', seat: 'settings.trigger', verdict: 'absent', reason: WHY.settingsElsewhere },
  { tree: 'plugins', seat: 'settings.onboarding', verdict: 'absent', reason: WHY.settingsElsewhere },
  { tree: 'plugins', seat: 'rightbar', verdict: 'absent', reason: WHY.conversationElsewhere },
  {
    tree: 'plugins',
    seat: 'shell.overlay',
    verdict: 'unrendered',
    reason:
      '官方 root 契约里的浮层座，声明它是为了官方贡献不停车（pluginsLayoutPlugin 的 root children 注释写全了理由）；本页只渲染 `main` 上那条 key = `plugins` 的条目，浮层里没有入口（与设置页同一个形态）',
  },
]

/** 查一条放行：命中即返回理由（报告里如实记下放行了什么、为什么）。 */
export function seatWaiver(
  tree: string,
  seat: string,
  verdict: SeatWaiver['verdict'],
): SeatWaiver | undefined {
  return SEAT_WAIVERS.find(
    (waiver) => waiver.tree === tree && waiver.seat === seat && waiver.verdict === verdict,
  )
}

/** 白名单里**没用上**的条目（读数是这个形状时，它们不再描述现状——报告里点名）。 */
export function unusedSeatWaivers(seen: ReadonlySet<string>): SeatWaiver[] {
  return SEAT_WAIVERS.filter((waiver) => !seen.has(`${waiver.tree}/${waiver.seat}/${waiver.verdict}`))
}

// ---------------------------------------------------------------------------
// 壳座里的「渲染出来的条目」与它们的可点元素（F-54 的壳上入口扫描用它）
// ---------------------------------------------------------------------------

/** 一处壳座里渲染出来的一个条目（`data-slot` 锚点是 `display:contents`，所以它的子元素就是条目的根元素）。 */
export interface SeatEntryReading {
  /** 座名。 */
  seat: string
  /** 这个条目在座里的序号（从 0 起，只看**渲染出来**的条目——没渲染的条目没有 DOM 节点）。 */
  index: number
  /** 页面上打的标记（`data-lab-seat-entry` 的值），用于失败信息点名与后续定位。 */
  marker: string
  /** 条目里挑出来的那枚可点元素；`null` = 这一格没有可点的入口。 */
  target: {
    /** 可点元素的身份：标签 + `aria-label` / 文字（报告里点名用）。 */
    label: string
    /** 是不是条目自己就是那枚可点元素（官方侧栏那种整行可点的行）。 */
    self: boolean
    /** 是不是锚点**外面**那个可点元素（官方侧栏的行：`<button><div data-slot="sidebar.panellist">…`）。 */
    ancestor: boolean
    /**
     * 挑中的这一枚是不是**已经处在选中 / 按下态**（`aria-current` / `aria-selected` /
     * `aria-pressed`）。这一档只在「这一格里的候选全是这个态」时才会出现，见下方挑选规则。
     */
    settled: boolean
  } | null
  /** `target === null` 的原因（人读的一行，写进事实）。 */
  noTarget?: string
}

/** 页面侧认「可点元素」的选择器（三种语义标记，别的一律不算）。 */
export const CLICKABLE_SELECTOR = 'button, [role="button"], [role="tab"], a[href]'

/**
 * 给每一处壳座里渲染出来的条目打标记，并报出每个条目里挑中的那枚可点元素。
 *
 * 为什么用「打标记 + 选择器」而不是直接拿着元素句柄点：F-54 的整条观测链（悬停 → 拍基线 →
 * 点 → 1200 毫秒 → 判六路）在 `probeClick(page, label, selector)` 里，给它一个稳定选择器
 * 就复用到同一套观测，不必另写一份量的代码。标记挂在页面上、跑完由
 * {@link clearSeatEntryMarks} 摘掉，不留在截图与后续断言里。
 *
 * 只认**条目这一层**：`sidebar.workspaces` / `settings.section` 这类大容器的子树里混着一堆
 * 控件，逐个点等于把整页点一遍（#248 明确不要这种噪声），所以一格座最多点「每个渲染出来的
 * 条目各一枚」。`data-slot` 锚点的 `display:contents` 让锚点的直系子元素就是条目的根元素，
 * 所以「条目」取直系子元素（一个都没有时取锚点自己）。
 *
 * 挑哪一枚（三条，都是实测撞出来的）：
 *
 * 1. **优先没选中态的**：跳过 `aria-current` / `aria-selected=true` / `aria-pressed=true` 的
 *    候选。现场：设置页 `main` 的条目里第一枚可点元素是**当前那一节**的导航格（`aria-current`
 *    在它身上），点它本来就不该有任何变化——不跳的话这一格恒判红，是假红。跳完还有候选时
 *    取没选中态的，一格全是被选中的候选才算「settled」（如实记进读数，不硬判）。
 * 2. **锚点被包在一个可点元素里时取那个祖先**：官方侧栏的行是
 *    `<button …><div data-slot="sidebar.panellist">图标 + 文字</div></button>`——按钮在锚点
 *    **外面**，`querySelectorAll` 找不到它（#252 起那一行被遮蔽 + 行盒摘掉，这个形态在今天的
 *    读数里不出现，但规则留着：同形的行随时可能回来）。本锚点里一条候选都没有时才退到
 *    `closest`，并且只认锚点外面那一枚（`ancestor: true`），免得把外层容器的某种可点元素当成入口。
 * 3. **可见且可用**：盒子非零、不是 `disabled` / `aria-disabled`。
 */
export async function markSeatEntries(page: Page, names: readonly string[]): Promise<SeatEntryReading[]> {
  return page.evaluate(
    ({ seatNames, clickable }: { seatNames: string[]; clickable: string }) => {
      const visible = (element: Element): boolean => {
        const box = element.getBoundingClientRect()
        if (box.width <= 0 || box.height <= 0) return false
        const style = getComputedStyle(element)
        return style.visibility !== 'hidden' && style.display !== 'none'
      }
      const usable = (element: Element): boolean =>
        visible(element) &&
        !(element as HTMLButtonElement).disabled &&
        element.getAttribute('aria-disabled') !== 'true'
      const settled = (element: Element): boolean =>
        element.getAttribute('aria-current') !== null ||
        element.getAttribute('aria-selected') === 'true' ||
        element.getAttribute('aria-pressed') === 'true'
      const describe = (element: Element): string => {
        const tag = element.tagName.toLowerCase()
        const aria = element.getAttribute('aria-label') ?? ''
        const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 24)
        return `${tag}[${aria === '' ? text : aria}]`
      }
      const out: unknown[] = []
      const counters: Record<string, number> = {}
      for (const name of seatNames) {
        for (const anchor of Array.from(document.querySelectorAll(`[data-slot="${name}"]`))) {
          const children = Array.from(anchor.children)
          // 一个元素子节点都没有时：锚点自己就是条目（官方插件页那四张卡的摘要是**文字节点**），
          // 但如果连文字都没有（这个座声明了、这一轮什么也没渲染），它就不是可点的条目。
          const rows = children.length === 0 ? ((anchor.textContent ?? '').trim() === '' ? [] : [anchor]) : children
          const ancestor = anchor.closest(clickable)
          for (const row of rows) {
            const index = counters[name] ?? 0
            counters[name] = index + 1
            const marker = `${name}#${String(index)}`
            row.setAttribute('data-lab-seat-entry', marker)
            const candidates = [
              ...(row.matches(clickable) ? [row] : []),
              ...Array.from(row.querySelectorAll(clickable)),
            ].filter(usable)
            const fresh = candidates.filter((candidate) => !settled(candidate))
            // 只有当这一格**一条候选都没有**时才退到锚点外面的那个可点元素。
            const fallback =
              candidates.length === 0 && ancestor !== null && ancestor !== anchor ? [ancestor] : []
            const found = fresh[0] ?? (fallback.length > 0 ? fallback[0] : candidates[0])
            if (found === undefined) {
              out.push({
                seat: name,
                index,
                marker,
                target: null,
                noTarget:
                  ancestor !== null && ancestor !== anchor
                    ? '这一格里没有可点元素（锚点外面的可点元素就是容器自己的，不当入口）'
                    : '这一格里没有可点元素',
              })
            } else {
              found.setAttribute('data-lab-seat-target', marker)
              out.push({
                seat: name,
                index,
                marker,
                target: {
                  label: describe(found),
                  self: found === row,
                  ancestor: found !== row && !row.contains(found),
                  settled: fresh[0] === undefined && candidates.length > 0,
                },
              })
            }
          }
        }
      }
      return out as never
    },
    { seatNames: [...names], clickable: CLICKABLE_SELECTOR },
  ) as Promise<SeatEntryReading[]>
}

/** 摘掉 {@link markSeatEntries} 打的标记（截图与后续断言里不该出现它们）。 */
export async function clearSeatEntryMarks(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const element of Array.from(document.querySelectorAll('[data-lab-seat-entry]'))) {
      element.removeAttribute('data-lab-seat-entry')
    }
    for (const element of Array.from(document.querySelectorAll('[data-lab-seat-target]'))) {
      element.removeAttribute('data-lab-seat-target')
    }
  })
}

// ---------------------------------------------------------------------------
// 壳上入口扫描的逐座规则（F-54 用；缺一格就判红）
// ---------------------------------------------------------------------------

/**
 * 一处壳座的**扫描规则**：这一格里渲染出来的条目要怎么处置。
 *
 * 为什么要这张表、而不是一份手写的交互点清单（#248 的现场）：F-54 原来那份交互点表是**手写
 * 的常量数组**，所以侧栏那一行「插件」从来没被点过——#247 是用户点出来的。这里反过来了：
 * **枚举**由读数给出（哪一格座、这一轮渲染出了几个条目、每个条目里的入口是哪一枚，全部来自
 * 运行期读数），表里只声明「这一格打算怎么处置」；一格座渲染出了条目却**没有**规则就当场
 * 判红——新长出来的壳座必须有人表态，而不是默默漏过。
 *
 * 两种处置：
 * - `click`：点条目里的入口（走 `probeClick` 的六路观测），**必须**有可观测反应；没反应时
 *   页面必须留下一行能指名道姓的说明（与 F-54 那条「＋ 没反应时页面必定留下一行失败」同一
 *   口径），否则判红。
 * - `waive`：**不点**，理由写清楚（会经网关写到用户机器上的动作走 #163 的只观察纪律；
 *   找不到入口的格子在理由里写清「入口在哪、由谁覆盖」）。
 */
export interface SeatClickRule {
  tree: string
  seat: string
  kind: 'click' | 'waive'
  /** `click`：期望的反应（人读一行，失败信息里点名）。 */
  expect?: string
  /** `waive`：为什么不点。 */
  reason?: string
}

/**
 * 逐格规则（`tree × seat`）。
 *
 * 哪几格需要规则：**这一轮渲染出了条目**的格（`markSeatEntries` 的读数）。逐棵树读数出来的
 * 是 sidebar 树 2 格（`sidebar.footer.action` / `sidebar.workspaces`；#252 起
 * `sidebar.panellist` 那一格渲染 0 个条目——官方那条行被遮蔽 + 行盒摘掉，见下面那条 `waive`）、
 * chat 树 2–3 格（`main` / `plugins.item`；右栏展开着时再加 `rightbar`）、settings 树 3 格
 * （`main` / `settings.section` / `settings.action`）、plugins 树 2 格（`main` /
 * `plugins.item`），本表按「这一格**可能**渲染出条目」逐格表态，多出来的表态不算漏项——
 * 少一格的表态当场判红。
 *
 * 条目数是**运行期**的：官方哪天在某个壳上多加一条（或把它搬进另一处壳），那一格的条目数就
 * 变了——`click` 的格子会照点新条目（新条目点了没反应即红），`waive` 的格子会在事实里多出
 * 一条待解释的条目（理由写在下面，读数逐条列在报告里）。
 */
export const SEAT_CLICK_RULES: readonly SeatClickRule[] = [
  {
    tree: 'sidebar',
    seat: 'sidebar.panellist',
    kind: 'waive',
    reason:
      '这一格的那一行已经不渲染了（#252）：官方那条「插件」行由本树按同 id + priority −1 遮蔽、行盒子另按 css-module 名后缀摘掉，所以这一轮它渲染出 0 个条目——**入口改由侧栏工具栏那一枚插件图标承担**（`SIDEBAR_POINTS` 的「侧栏 · 插件页」那一枚，走同一条能力口 `openPlugins`）。这一格不点：它的行若哪天回来（上游改名把那条 CSS 撞失效），点它是经本树 layout 服务转能力口开页（不是原地发生的事），而「那一行不再渲染」这件事由 F-74 的侧栏那一段正面判着（读那一行有没有可见盒子）',
  },
  {
    tree: 'sidebar',
    seat: 'sidebar.footer.action',
    kind: 'click',
    expect: '自有回收站入口行：开回收站抽屉（官方那条 cordis 面板在宿主 inventory 为空时不渲染，不在座里）',
  },
  {
    tree: 'sidebar',
    seat: 'sidebar.workspaces',
    kind: 'click',
    expect: '自有工作区树顶栏那一枚：弹出分组过滤菜单',
  },
  {
    tree: 'chat',
    seat: 'main',
    kind: 'waive',
    reason:
      '这一格是**整页**（对话区本体），「条目的第一枚可点元素」在这片区域里是一个**危险且不稳**的落点：实测两轮读数分别挑到「打开右侧边栏」与「**在访达中打开工作目录**」——挑到后者那一轮，点下去往真网关发了 `/open-in-app/open`，**R-06 的原生副作用守卫当场拦下并判红**；而测量与点击之间页面重渲过时落点还会飘到别的控件上（扫描为此另加了一条 `guardHit`：点之前复量落点，不在目标上就不点）。会话头那一排里既有右栏开关、也有会落到用户机器上的 open-in-app 分裂按钮，靠位置点第一枚等于把判据变成一个随机点。这一页的可点入口（composer 一排 / 对话区页签 / 右栏开关 / 助手动作 / 在访达中打开）都由本套件那份手工交互点表逐个覆盖',
  },
  {
    tree: 'chat',
    seat: 'rightbar',
    kind: 'waive',
    reason:
      '这一格的条目只在右栏**展开着**的时候才渲染（会话头那枚 ExpandButton 点开；展开前后条目数会从 0 变 1），内容是官方 ui-sidebar-right 那几件面板自己的；展开钮与面板几何由本套件与 F-01 判，按位置点面板头上那一枚判不出额外的东西',
  },
  {
    tree: 'chat',
    seat: 'plugins.item',
    kind: 'waive',
    reason:
      '这一格是插件页那四张官方配置卡的摘要面（`renderSlot("plugins.item", {view:"summary"})`）：卡的**入口**是同一张卡里与摘要是兄弟分支的 `button[aria-label="打开…详情"]`（官方 `CardHead` 的 `cardOpen`），不在「条目这一层」的可点元素里，所以本扫描按设计不点它；四张卡本身由 F-74 按官方条目 id 与卡名逐个覆盖',
  },
  {
    tree: 'settings',
    seat: 'main',
    kind: 'click',
    expect:
      '自有导航格里第一个**没选中**的那一节：切到该节内容（节名随实例上装着的插件变，所以判据只判「切过去了」，不看切到哪一节）',
  },
  {
    tree: 'settings',
    seat: 'settings.section',
    kind: 'click',
    expect: '当前那一节内容里的第一枚入口：开出这一节自己的交互面（本轮实测那两枚分别是「权限预设下拉」与模型节里某一行的「编辑 …」）',
  },
  {
    tree: 'settings',
    seat: 'settings.action',
    kind: 'waive',
    reason:
      '#163 的只观察纪律：这一格里官方那条 `open-document` 的动作是经**网关宿主**用系统默认应用打开设置文档（`remote.settings.openSettingsDocument`），我们那条（`open-document-vscode`）走宿主能力口——官方那条由 shell 按同 id + priority −1 遮蔽（#178 C10+C11），遮蔽一旦失效这一格里就会有官方的，所以整格不点；这一格的在不在与禁用态由 F-54 的「设置 · 打开配置文件」那一条只观察着',
  },
  {
    tree: 'plugins',
    seat: 'main',
    kind: 'waive',
    reason:
      '这一格是整页（官方插件页本体）。页头工具栏那枚第一枚可点元素是「刷新」（`remote.pluginManager.listBundles/listPlugins`，读），但它刷新之后**数据没变时页面一个字节都不改**（同一份清单重渲成同构的 DOM）——按「点下去要有可观测反应」判它是假红（实测：元素数 117→117、零 DOM 变动）。这一页的可点入口由 F-74 覆盖（四张官方配置卡按条目 id 与卡名逐个判）',
  },
  {
    tree: 'plugins',
    seat: 'plugins.item',
    kind: 'waive',
    reason: '与 chat 树同一条：这一格是四张卡的摘要面，卡的入口是兄弟分支上的 `cardOpen` 按钮；四张卡由 F-74 逐个覆盖',
  },
]

/** 查这一格的规则（没有就是「缺表态」，调用方判红）。 */
export function seatClickRule(tree: string, seat: string): SeatClickRule | undefined {
  return SEAT_CLICK_RULES.find((rule) => rule.tree === tree && rule.seat === seat)
}
