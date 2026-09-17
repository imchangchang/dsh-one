/**
 * @dsh-one/dsh-workspace-tree——侧栏工作区/会话树的 **shadow 件**（#65 批 2）。
 *
 * ## 命名（AGENTS.md 铁律「自有插件命名分两类」）
 * 本件命名 `dsh-*` 而非 `vscode-*`，因为它不绑定 VS Code 宿主：只有自己写的 DOM
 * 标记（`dshOneTree_*` 类名与 `data-*`），不碰 `acquireVsCodeApi`、不 postMessage；
 * 数据全取官方 hooks、动作全走官方服务、样式全用官方 token。与宿主有关的动作
 * （#72 的「在新标签页打开」、#109 的工作区行宿主动作、#121 的「这个会话开在宿主
 * 面板里吗 / 把面板亮到它」、#147 的「宿主面板里开着哪些会话」订阅）一律走**宿主
 * 能力口**这个抽象口
 * （`./hostCapabilities.ts`，插件不直接碰宿主 API），并按能力口如实上报的
 * `editorTabs` / `workspaceOpen` / `isSessionInPanel` 决定入口出不出现或走哪条路
 * ——官方 web 侧没有那些宿主概念，那些入口就不显示、当前会话行一律按打开处理，
 * 插件其余行为一模一样。因此它不依赖我们的 shell 实现，官方 web 侧同样
 * 能装（#83 收尾要做的是把挂载点挪出我们的 frame 并打成独立 npm 包，本步先把命名
 * 与 id 对齐）。
 *
 * ## 文件结构（#99 拆文件）
 * 本文件只留**插件本体**：服务面类型、\`inject\` 与 \`apply\`（注册 + 注入动作的组装）。
 * 它注册两条 entry：`sidebar.workspaces` 的 shadow（浏览区，树主组件）与
 * `sidebar.footer.action` 的 list 条目（底部回收站入口行，与官方 cordis-panel 并存）。
 * 组件与样式拆到同目录的 \`workspaceTree/\`，各自一份职责，改哪块找哪个文件：
 * \`tree.ts\`（主组件：组合各件 + 状态与订阅）、\`rows.ts\`（分组头行 / 会话行 /
 * 搜索结果行）、\`toolbar.ts\`（顶部工具栏）、\`groupFilterBar.ts\`（分组过滤条）、
 * \`selection.ts\`（批量选择）、\`recycleDrawer.ts\`（回收站抽屉）、\`recycleEntry.ts\`
 * （底部回收站入口行）、\`recycleBinStore.ts\`（回收站状态与动作：两个座位共享的
 * 模块级 store）、\`recycleDrawerStore.ts\`（回收站抽屉的开合态：入口行与树主组件
 * 共享，见 #114）、\`tagGroups.ts\`（会话标签组的组头与拖拽：组 pill、折叠计数、
 * 落点判定与自定义 MIME）、\`flash.ts\`（飘提示）、\`modals.ts\`（对话框，含归档
 * 确认弹窗与新建标签组弹窗）、\`search.ts\` / \`groups.ts\` / \`format.ts\` /
 * \`hoverCard.ts\` / \`types.ts\`、\`styles.ts\`（全部样式）、\`locale.ts\`（词典）。
 *
 * ## 机制分层（按 AGENTS.md 的优先序逐层举证）
 *
 * **层 1（官方槽位机制）——遮蔽**：`sidebar.workspaces` 是官方 ui-sidebar
 * 声明的 single 槽位（`dsh-client-ui-sidebar/lib/types/client/contract/slots.d.ts`，
 * 语义 = 分节头 + 搜索 + 分组树 + 工作区对话框），官方 ui-workspace 的
 * WorkspaceBrowser 以默认优先号 0 注册。本插件同名单独注册、优先号 −1 顶掉它
 * （注册表原文「register at a different priority to shadow it (lowest renders)」，
 * spike #69 题 5 在浏览器实测过该机制）。
 *
 * `children` 必须留空表：官方 WorkspaceBrowser 那条 entry 自己声明了
 * `sidebar.workspaces.directoryFlow`（ui-workspace client.js 的 apply 逐字），
 * 槽名已被声明，再声明一次注册表会报错——这就是「不能重新声明已声明槽名」
 * 那条坑。留空表不影响官方子槽：槽声明在注册表里是全局事实，与哪条 entry
 * 渲染无关。
 *
 * **与官方插件共存（AGENTS.md 铁律「优先与官方插件共存，不顶替其角色」）**：
 * 本插件只遮蔽**槽位本身**，ui-workspace 插件照常装载——它的服务
 * （`uiWorkspace`）、它经 `ctx.slots.provideRoot` 下发的 `workspaces` 钩子、
 * 它注册的 `sidebar.workspaces.directoryFlow` 子槽声明、它的 locale 词典全部
 * 原样存活，自有树只是占用同一槽位的渲染位。我们消费的 `useWorkspaces` /
 * `useSessions` / `useSessionPendingInteraction` 三条钩子正是这么来的（见层 2）。
 *
 * **层 2（官方服务 API）——数据与动作**：本插件不做任何自己的取数 IO。
 * - 数据：框架注入的官方标准钩子 `useSessions`（官方 sessions 服务的 list
 *   快照，由 `@deepseek-ai/dsh-client-ui-session` 经
 *   `ctx.slots.provideRoot({hooks:{sessions}})` 提供）、`useWorkspaces`
 *   （workspaces 服务的 list 快照，ui-workspace 同法提供）、
 *   `useSessionPendingInteraction`（会话级等待态，同一 provideRoot 提供）。
 *   这三条都是 ui-session / ui-workspace 插件的必然产物（两插件在侧栏树的
 *   保留集里），自有 entry 直接消费，不自己订阅服务。
 * - 动作：全部走官方服务——`sessions.open` / `sessions.create` /
 *   `sessions.binding(id).session.rename` / `sessions.search` /
 *   `uiWorkspace.forkSession` / `uiWorkspace.archiveSession` /
 *   `workspaces.rename` / `workspaces.delete`（出处逐个标在代码处）。
 * - 图标与原语：全部取官方 primitives 种子表——`IconFolderOpen16` /
 *   `IconFolderClose16` / `IconFolderOpenOutline16` / `IconTriangleRightFill14` /
 *   `IconEllipsisOutline16` / `IconPlusOutline16` / `IconSearchOutline16` /
 *   `IconCloseFill14` / `IconPersonalizationOutline16` / `IconEditOutline16` /
 *   `IconTrashOutline16` / `IconBranchOutline16` / `IconArchiveOutline20` /
 *   `IconRightUpOutline16` / `IconCheckOutline16` / `IconChecklistOutline14` /
 *   `IconCopyOutline16` / `IconAlarmClockOutline16`（#110 活跃定时任务标记）/
 *   `StateDot` / `Menu` / `Tooltip` / `HoverCard` / `Modal` / `Button` /
 *   `relativeTime`。**终端图标是自绘 SVG**（官方 79 个 `Icon*` 里没有终端件，
 *   逐个看过导出表；出处与理由见 `workspaceTree/rows.ts`）。
 *
 * **多开入口（#72）**：会话行菜单（仍是官方 `Menu` 原语，`items` 多一项
 * `openInNewTab`）与**行右键**都能开出这个菜单，菜单项走宿主能力口。逐层举证：
 * 官方侧没有「往官方行菜单里加一项」的口（官方 `SessionNodeItem` 的
 * `sessionMenuItems` 是它自己的常量数组，无座位、无服务、无接缝），而本插件
 * 已经**整槽遮蔽**了 `sidebar.workspaces`（层 1）——行由我们渲染，菜单项就是
 * 我们自己的渲染内容，用的还是官方 `Menu` 原语（层 2 组件：`items` 形状、
 * 定位、外点关闭、Esc 关闭全按官方行为）。行右键同样落在自有渲染上：行是我们
 * 的元素，给它挂 `onContextMenu` 即我们自己的事件；官方 `Menu` 支持
 * `getAnchorRect` 就为这类「菜单跟着指针走」的用法（官方自己在 assets bundle 的
 * trajectory JSON 复制按钮上也是 `onContextMenu` + `getAnchorRect` 的组合），
 * 所以不需要任何 DOM 层 hack。**#109 起行右键的接管条件只剩「非选择态」**（多开
 * 不可用的宿主、空白会话行也照样弹我们这份菜单——那两类行本来就有菜单内容，
 * 抢掉原生右键菜单不再是添乱）；「在新标签页打开」这一项本身仍按能力口如实上报
 * 决定出不出现。
 *
 * **菜单补全（#109）**：会话行菜单 10 项（顺序与用户给的截图一致，标题行
 * 「会话: {label}」、无分隔线）、工作区行 hover 四按钮 + 右键七项、「移到分组…」与
 * 「分组…」两个二级菜单（官方 `Menu` 的 `submenu` 槽 = 挂在父项那一格里的内联子树，
 * 子项点击不关菜单 = 就地翻转 ✓）、当前工作区那枚蓝色胶囊。两个二级菜单的数据分别是
 * 标签组（#107 提供，未落地时该项不出现）与工作区分组（#99 已有）。工作区行的三个
 * 宿主动作（终端打开 / 在 VS Code 打开 / 在新窗口打开文件夹）走**宿主能力口**的
 * `openWorkspaceTerminal` / `openWorkspaceFolder`（官方 web 形态没有编辑器窗口与集成
 * 终端 → 能力缺席 → 那几枚入口不渲染）；「复制引用 / 复制路径 / 复制文件夹引用」用
 * **官方 primitives 的 `writeClipboard`**（两端浏览器本来就能写剪贴板，绕一趟宿主只会
 * 多一条会失败的路）。
 *
 * **样式 = 官方 token + 官方默认几何**：本插件不写自造颜色/尺寸。样式全在
 * `workspaceTree/styles.ts`，其中每个数值都逐字
 * 取自官方 css-module（`ui-workspace/src/client/rows/Rows.module.css` 与
 * `WorkspaceBrowser.module.css`，0.1.6-alpha.1 的 `lib/client.js` 内联副本；骨架四区
 * 另取同族组件——胶囊与分块块头取 ui-model-selection 的 `ModelSelection.module.css`、
 * 回收站入口行的行高取 ui-cordis 的 `CordisPanel.module.css`，逐条出处见
 * `styles.ts` 对应规则上方），
 * 颜色一律引用官方 token 变量（`--dsw-*`）。**不引用官方哈希类名**
 * （`YDXeBa_*` / `bhn1Oq_*` 随版本变），只用自有类名 + 官方 token：数值同源、
 * token 同源，只有类名是自己的。
 * **密度/间距（#85 A 项，键面 #104 扩到骨架四区）**：几何项写
 * `var(--dsh-one-density-<项>, <官方原值>)`
 * ——宿主（我们的 VS Code 侧栏外框）在容器上设这组变量时自动变紧凑，没人设时
 * 取官方原值，本件零宿主判断、保持可移植（见 `workspaceTree/styles.ts` 的密度偏好说明）。
 * **悬停卡（#85 B 项）**：官方 HoverCard 只在容器右侧放得下 244+8px 时渲染，
 * 否则不渲染（官方定位会落到视口外；取舍见 `workspaceTree/hoverCard.ts` 的说明）。
 *
 * **回收站的两层语义（#103）**：**回收站 = 本地可逆的一层**（只写我们自己的
 * `recycle-bin` 集合，见 `workspaceTree/recycleBinStore.ts`；移入/还原都不动 dsh
 * 侧），**归档 = 删除**（终点动作，走官方 `uiWorkspace.archiveSession`，UI 上一律
 * 先过确认弹窗）。两者在界面上是分开的两个入口（会话行菜单两项），不共用一条路。
 * 状态按 AGENTS.md 铁律住在宿主能力口（键 `recycle-bin`，与旧侧栏那份文件同名同形），
 * 两个座位（树主组件与底部入口行）共享同一个模块级 store。
 *
 * ## 已知取舍（下一步的差异化层处理）
 * - **视图偏好**（分组方式/排序方式/当前分组/展开集合/回收站块折叠）走官方客户端
 *   既有惯例的 `localStorage`（键 `dsh.workspaceTree.view`，见
 *   `pure/workspaceTreePrefs.ts`），不接官方 `store` 座位：那个座位是**注册期**声明，
 *   接入即改注册形状，与「只换渲染」的边界冲突。差别只在「谁能读到」——localStorage
 *   是这台机器这个浏览器的看法，而官方 store 座位会被框架托管；偏好本身不缺持久化。
 * - 「按最近更新」在组内按 updatedAt 倒序（官方是手动序 + 活动晋升，常见情况下
 *   结果一致）。
 * - 工作区/会话重命名与工作区删除走官方 Modal 原语自渲染（官方同款组件、同款
 *   文案）——官方那条 entry 的对话框随它一起被遮蔽，必须自己重做。
 *
 * ## 用户标记（#102：置顶 / 手动未读）
 * 两份 id 集合是**用户可感知的持久状态**，按铁律由宿主半拥有、经能力口读写：
 * `stateRead/stateWrite('pinned' | 'unread')`，落 `~/.dsh/dsh-one/<键>.json`——键名
 * 与旧侧栏的文件名逐字相同，所以**旧文件就是新状态**（和分组同一处置，没有搬家这
 * 一步）；唯一要「迁」的是形状（更早的裸 id 数组），由 `migrateSessionMarks` 认下并按
 * 规范形状写回一次，此后只有能力口读写。判定与排序是纯的、单独有单测：
 * `pure/sessionMarks.ts`（置顶/未读状态 + `pinnedFirst` 排序）、
 * `pure/sessionEligibility.ts`（`canRecycle` / `canArchive` / 组头三态）。
 * 视觉：置顶图钉与未读绿点是**旧侧栏那两条描边路径**（官方 primitives 的导出表里
 * 没有图钉与未读图标，逐个看过 0.1.6-alpha.1 的 80 个 `Icon*` 名字）。
 *
 * ## 会话标签组（#107：每个工作区一套用户自建的组）
 * 一个工作区里的会话可以归进一个**用户自建**的标签组（单组语义），组头是一枚可拖拽
 * 排序的 pill，组内行缩进在一条贯穿竖线下；拖会话入组 / 拖出组改归属，拖 pill 改
 * 组间顺序。**不预置任何内置组**（旧侧栏的 Todo/Doing/Done 不恢复），六色自选、
 * 可改名可删。组内顺序 = 官方顺序，**组内置顶 = 在该组内靠前**（复用 #102 的
 * `pinnedFirst`，与工作区那一层同一口径）。
 *
 * 状态与判定都在纯模块 `pure/sessionTagGroups.ts`（迁入、切块、空组清理、拖拽换序
 * 的校核全在那里，`node --test` 直接测）；视觉与拖拽交互在 `workspaceTree/tagGroups.ts`。
 * 持久态按铁律走宿主能力口（键 `tags`，= 旧侧栏那份 `tags.json`），折叠态是纯视图态、
 * 随视图偏好走客户端存储（`dsh.workspaceTree.view` 的 `tagCollapsed`）。
 */
import {
  TREE_GROUPS_STATE_KEY,
  emptyTreeGroups,
  parseTreeGroups,
  serializeTreeGroups,
} from '../../../pure/treeGroups.ts'
import {
  SESSION_PINNED_STATE_KEY,
  SESSION_UNREAD_STATE_KEY,
  markStateFile,
  migrateSessionMarks,
  type SessionMarksState,
} from '../../../pure/sessionMarks.ts'
import {
  TAG_GROUPS_STATE_KEY,
  emptyTagGroups,
  parseTagGroups,
  serializeTagGroups,
  type TagGroupsFile,
} from '../../../pure/sessionTagGroups.ts'
import type { GroupFile } from '../../../pure/dshStateFile.ts'
import { isSessionAlreadyOwnedError } from '../../../pure/sessionOwnership.ts'
import type { SessionListLike } from '../../../pure/workspaceTreeView.ts'
import { hostCapabilities, type CapabilityContext } from './hostCapabilities.ts'
import { EN, LOCALE_NS, ZH } from './workspaceTree/locale.ts'
import { configureRecycleBin } from './workspaceTree/recycleBinStore.ts'
import { setPanelOpenSessions } from './workspaceTree/panelSessionsStore.ts'
import { RecycleEntry } from './workspaceTree/recycleEntry.ts'
import { reportSessionOwnedElsewhere } from './workspaceTree/sessionOwnedNotice.ts'
import { WorkspaceTree } from './workspaceTree/tree.ts'
import type { SearchPage, WorkspaceSnapshotLike } from './workspaceTree/types.ts'

// ---------------------------------------------------------------------------
// cordis 插件面
// ---------------------------------------------------------------------------

interface SessionSummaryFace {
  rename(title: string): Promise<{ ok: boolean; error?: { message: string } }>
}

interface SessionsService {
  readonly list: { getSnapshot(): SessionListLike }
  readonly searchResultLimit: number
  open(id: string): void
  create(opts: { workspaceId?: string }): Promise<string>
  fork(opts: { sessionId: string; increaseTitle?: boolean }): Promise<string>
  binding(id: string): { session: SessionSummaryFace } | undefined
  search(query: string, signal: AbortSignal): Promise<{ ok: boolean; value?: SearchPage; error?: { message: string } }>
}

interface WorkspacesService {
  readonly list: { getSnapshot(): WorkspaceSnapshotLike }
  rename(workspaceId: string, title: string): Promise<unknown>
  delete(workspaceId: string): Promise<void>
  archiveSession(sessionId: string): Promise<void>
}

interface UiWorkspaceService {
  pickDirectory(): Promise<string | null>
  /**
   * 官方归档（官方 `dsh-client-ui-workspace` 的 navigation.d.ts 里就有这条）。
   * #103 明确它的语义是**终点**（归档 = 删除），走官方服务执行。
   *
   * 官方那条 `unarchiveSession`（「取消归档」）**我们刻意不用**：它属于官方自己的
   * 设置页（`dsh-client-ui-settings-unarchive-sessions`），是给误归档兜底的；我们的
   * 回收站是**本地可逆的那一层**（还原只写我们自己的集合），两者不能混成一条路——
   * 混了就会出现「点了还原，实际去动 dsh 侧」这样的两层语义错位。
   */
  archiveSession(sessionId: string): Promise<void>
}

interface TreeContext {
  effect(body: () => (() => void) | void, label?: string): void
  get(name: string): unknown
  slots: {
    register(entry: unknown, component: unknown): () => void
    /** 等目标名被任一 entry 的 children 表声明后再注册（官方贡献的正规挂法）。 */
    inject(name: string, factory: () => unknown): () => void
    entries?(name: string): readonly unknown[]
    subscribe?(name: string, listener: () => void): () => void
  }
  locale: { register(ns: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): () => void }
}

export const inject = ['slots', 'locale', 'sessions', 'workspaces']

export function apply(ctx: TreeContext): void {
  const sessions = ctx.get('sessions') as SessionsService
  const workspaces = ctx.get('workspaces') as WorkspacesService
  // 宿主能力口（#72 多开入口用它；`editorTabs` 是读时判定，注入面按它决定动作给不给）。
  const caps = hostCapabilities(ctx)

  /**
   * 官方 uiWorkspace 服务（归档与选目录用它；缺席时退回官方 workspaces 服务）。
   *
   * 取法必须用 `ctx.get('uiWorkspace')`：官方把「可选服务」的正规取法定死为
   * `ctx.get(key)` + undefined 判定（官方服务目录里那条 `access.optional.expression`
   * 原文就是 `ctx.get("…")`，并标着 `requiresUndefinedCheck`），而**属性访问**
   * `ctx.uiWorkspace` 是硬依赖的取法——没在 `inject` 里声明就抛
   * `cannot get property "uiWorkspace" without inject`。本条原来写成属性访问，
   * 于是归档与「选择已有文件夹…」在装配页上**必然失败**（#110 浏览器验证实测到的那条
   * 报错），改成官方给的可选取法之后，缺席就真的回落到 `workspaces.archiveSession`，
   * 在的时候走 uiWorkspace——两种情形都成立，插件也不必硬依赖这个服务。
   */
  const uiWorkspace = (): UiWorkspaceService | undefined =>
    ctx.get('uiWorkspace') as UiWorkspaceService | undefined

  /**
   * #145：会话被**另一个 dsh 进程**占着写句柄时（官方会话日志是单写者，见
   * `pure/sessionOwnership.ts`），用户在树上点它当场什么都看不到——官方把这条失败只
   * 落进会话对象的 `lastAgentError`（客户端没有界面读它），要到用户发消息时才在输入条
   * 上弹一条原始吐司（`resume failed for session …: SessionAlreadyOwnedError …`）。
   * 侧栏树是用户点击的地方，所以在这条失败到达时给一条能行动的提示。
   *
   * 机制层 2（官方服务 API）：官方客户端服务 `remote` 的转发事件通道 `$on`——官方
   * `dsh-api-session-controller` 的客户端半自己就是
   * `ctx.remote.$on('api-session/error', (sessionId, message) => …)`（出处：
   * `lib/types/client/index.js` 的 apply），我们只是同一个事件的另一个订阅方。
   * 取法是官方的可选取法 `ctx.get('remote')`（与上面 `uiWorkspace` 同一处置）：官方
   * web 与 VS Code 两侧都装了这个服务，但它不是本插件成立的前提，缺席就不订阅
   *（本插件其余行为一字不变）。
   */
  ctx.effect(() => {
    const remote = ctx.get('remote') as
      | { $on?: (event: string, listener: (...args: unknown[]) => void) => (() => void) | void }
      | undefined
    const off = remote?.$on?.('api-session/error', (sessionId, message) => {
      if (typeof sessionId !== 'string' || sessionId === '') return
      if (!isSessionAlreadyOwnedError(message)) return
      reportSessionOwnedElsewhere(sessionId)
    })
    return () => {
      off?.()
    }
  }, 'dsh-one workspace tree: session write-handle conflicts')

  /**
   * #103：回收站（本地集合）与归档动作接进模块级 store——树主组件与底部入口行是
   * **两个座位、同一份 bundle**，状态与动作必须只有一份（见 recycleBinStore.ts 的文件头）。
   * 本地集合走宿主能力口（键 `recycle-bin`），归档走官方 `uiWorkspace.archiveSession`
   *（缺席时退回 `workspaces.archiveSession`，与 #81 的处置一致）。
   */
  configureRecycleBin({
    capabilities: caps,
    archiveSession: async (sessionId: string): Promise<void> => {
      const service = uiWorkspace()
      if (service === undefined) await workspaces.archiveSession(sessionId)
      else await service.archiveSession(sessionId)
    },
  })

  /** 工作区里「复用空白会话，否则新建」再打开（官方 connectWorkspace + open 的语义）。 */
  const startSessionIn = async (workspaceId: string): Promise<string> => {
    const snapshot = workspaces.list.getSnapshot()
    const workspace = snapshot.items.find((item) => item.workspaceId === workspaceId)
    if (workspace === undefined) throw new Error(`workspace tree: unknown workspace ${workspaceId}`)
    const list = sessions.list.getSnapshot()
    for (const id of list.ids) {
      const summary = list.byId[id]
      if (
        summary !== undefined &&
        summary.blank &&
        summary.cwd === workspace.path &&
        workspace.sessionIds.includes(summary.id) &&
        !snapshot.archivedSessionIds.includes(summary.id)
      ) {
        return summary.id
      }
    }
    return await sessions.create({ workspaceId })
  }

  const buildInjected = (): Record<string, unknown> => {
    return {
      // 「在新标签页打开」（#72 多开通道）：走宿主能力口（抽象口，插件不碰宿主 API）。
      // 能力口如实上报 `editorTabs`：没有编辑器标签页的宿主（官方 web 形态）不注入
      // 这个动作，菜单项与行右键都不出现——那是同一份插件在另一端的正确形态。
      // 失败不再在这里吞掉（#110）：把 Promise 交回树组件，由界面给一行可见反馈。
      ...(caps.editorTabs
        ? {
            openInNewTab: (sessionId: string): Promise<unknown> => caps.openSessionInNewTab(sessionId),
          }
        : {}),
      // #99 顶栏 ＋ 菜单第二项「创建新工作区目录…」：宿主能力口，宿主没有这条能力
      // （官方 web 形态）时不注入 = 那一项不出现。
      ...(caps.workspaceCreate
        ? {
            createWorkspaceFolder: (): void => {
              caps.createWorkspaceDirectory().catch((reason: unknown) => {
                console.warn('[dsh-one] create workspace directory failed:', reason)
              })
            },
          }
        : {}),
      // #99 顶栏最右的设置齿轮：宿主能力口，宿主没有独立设置页（官方 web 形态）时
      // 不注入 = 齿轮不渲染（那一端设置归官方侧栏底部那一行）。
      ...(caps.settingsPage
        ? {
            openSettings: (): void => {
              caps.openSettings().catch((reason: unknown) => {
                console.warn('[dsh-one] open settings failed:', reason)
              })
            },
          }
        : {}),
      // #109 工作区行的工作区动作（hover 的「在 VS Code 打开」与右键的「在新窗口打开
      // 文件夹」共用这一条）：能力口如实上报，官方 web 形态没有编辑器窗口 → 不注入 =
      // 两个入口都不出现。
      ...(caps.workspaceOpen
        ? {
            openWorkspaceFolder: (path: string, options: { newWindow: boolean }): void => {
              caps.openWorkspaceFolder(path, { newWindow: options.newWindow }).catch((reason: unknown) => {
                console.warn('[dsh-one] open workspace folder failed:', reason)
              })
            },
          }
        : {}),
      // #109 hover 的「终端打开」：同样是宿主能力（VS Code 侧是集成终端），官方 web 形态
      // 没有 → 不注入 = 那一枚按钮不渲染。
      ...(caps.workspaceTerminal
        ? {
            openWorkspaceTerminal: (path: string): void => {
              caps.openWorkspaceTerminal(path).catch((reason: unknown) => {
                console.warn('[dsh-one] open workspace terminal failed:', reason)
              })
            },
          }
        : {}),
      // #109 当前工作区那枚胶囊上的容器名（读时判定，与 editorTabs 同一形态）。
      shellName: caps.shellName,
      // #112「当前工作区」判定的输入：VS Code 当前打开的文件夹路径表（宿主能力口）。
      // 官方 web 侧能力口如实回空表 → 树按「没有当前工作区」渲染（不显示徽标、不置顶），
      // 插件不做任何宿主判断（可移植件：两端同一份代码）。
      loadCurrentFolders: (): Promise<readonly string[]> => caps.currentWorkspaceFolders(),
      // #121 会话行点击的两条（都走宿主能力口，插件不碰宿主 API）：查询某会话是否正开在
      // 宿主面板里（改名判据的真条件），以及请宿主把面板亮到某会话（会话已是 current 时
      // 官方 sessions.open 不会让它变化、选择桥也就不会上报，必须单独请一次）。
      // 官方 web 侧：前者恒 false、后者静默空操作——那一端没有「宿主面板」这个概念，
      // 插件的点击逻辑照常跑（一律按打开处理），两端同一份代码。
      isSessionInPanel: (sessionId: string): Promise<boolean> => caps.isSessionInPanel(sessionId),
      openSessionPanel: (sessionId: string): Promise<void> => caps.openSessionPanel(sessionId),
      // 官方 sessions 服务：选中会话（镜像官方 ui-workspace 的 openSession，
      // 不调 layout.selectPanel——自有侧栏树没有主面板概念）。
      open: (sessionId: string): void => {
        sessions.open(sessionId)
      },
      // 工作区行的「+」：官方 uiWorkspace.startSession 的语义（它依赖 layout 服务的
      // beginNavigation/selectPanel，自有 layout 桩没有这两件，故按同一语义直接
      // 用 sessions 服务实现）。
      // #109：未分组桶的 ＋ 也走这里（`workspaceId === undefined`）——建一条**不属于
      // 任何工作区**的会话。旧侧栏的 `sessionNewUngrouped` 就是这条语义；官方
      // `sessions.create` 的 workspaceId 是可选的，省略即散会话（它会落在未分组桶里）。
      startSession: (workspaceId?: string): void => {
        void (workspaceId === undefined
          ? sessions.create({})
          : startSessionIn(workspaceId)
        )
          .then((id) => sessions.open(id))
          .catch((reason: unknown) => console.warn('[dsh-one] new session failed:', reason))
      },
      // 官方 ui-workspace 的 renameSession：binding → session.rename。
      renameSession: async (sessionId: string, title: string): Promise<void> => {
        const session = sessions.binding(sessionId)?.session
        if (session === undefined) throw new Error(`unknown session "${sessionId}"`)
        const result = await session.rename(title)
        if (!result.ok) throw new Error(result.error?.message ?? 'rename failed')
      },
      // 官方 uiWorkspace.forkSession：sessions.fork(increaseTitle) 后打开子会话。
      // 失败不再静默吞掉（#110）：Promise 交回树组件，由界面给一行可见反馈。
      forkSession: (sessionId: string): Promise<unknown> =>
        sessions.fork({ sessionId, increaseTitle: true }).then((childId) => sessions.open(childId)),
      renameWorkspace: (workspaceId: string, title: string): Promise<unknown> => workspaces.rename(workspaceId, title),
      deleteWorkspace: (workspaceId: string): Promise<void> => workspaces.delete(workspaceId),
      // 官方 uiWorkspace.pickDirectory：宿主原生选择器。**为什么直调服务而不是渲染
      // 官方 `sidebar.workspaces.directoryFlow` 子槽**（#99 B 段原本要求渲染子槽）：
      // 那口子由官方 WorkspaceBrowser 条目在它自己的 `children` 里声明，而官方渲染器
      // **只允许声明该槽的条目渲染它**——`dsh-client-ui-renderer/lib/client.js` 的
      // boundRenderSlot 原文：
      //   `const declared = entry.children?.[key]; if (declared === void 0) throw new
      //    SlotOwnershipError("slot '<key>' is not declared by this entry's children")`
      // 我们这条 shadow entry 声明不了同名槽（同名二次声明注册表直接报错，本文件头
      // 已举证），所以「渲染官方子槽」在当前架构下不可达：官方那口的占用者（browse
      // picker）也只在 ui-conversation 在场时才注册（它把 sidebar 那半嵌在 hero 那半的
      // inject 里）。走官方服务是第 2 层机制、语义一致（同一个宿主原生选择器），
      // 且不接手任何隐式契约。
      pickWorkspaceFolder: (): void => {
        const service = uiWorkspace()
        if (service === undefined) return
        void service
          .pickDirectory()
          .then((path) => (path === null ? undefined : (workspaces as unknown as { create(input: { path: string }): Promise<unknown> }).create({ path })))
          .catch(() => {})
      },
      searchSessions: async (
        query: string,
        signal: AbortSignal,
      ): Promise<{ items: readonly { id: string; snippet?: string }[]; hasMore: boolean }> => {
        const result = await sessions.search(query, signal)
        if (!result.ok || result.value === undefined) throw new Error(result.error?.message ?? 'search failed')
        return result.value
      },
      searchResultLimit: sessions.searchResultLimit,
      // #82：本插件的持久状态走**宿主能力口**（`stateRead/stateWrite`）——VS Code 侧
      // 落到扩展宿主的能力桥，官方 web 侧落到宿主半的网关 RPC，插件代码两端一样。
      // 键 `groups` 与 `~/.dsh/dsh-one/groups.json` 同名同形：旧侧栏建的分组开箱即见，
      // 不需要任何数据搬家（理由写在 pure/treeGroups.ts 的头注释里）。
      loadGroups: async (): Promise<GroupFile> => {
        const value = await hostCapabilities(ctx as unknown as CapabilityContext).stateRead(TREE_GROUPS_STATE_KEY)
        return parseTreeGroups(value) ?? emptyTreeGroups()
      },
      saveGroups: (file: GroupFile): void => {
        void hostCapabilities(ctx as unknown as CapabilityContext)
          .stateWrite(TREE_GROUPS_STATE_KEY, JSON.parse(serializeTreeGroups(file)) as unknown)
          .catch((reason: unknown) => {
            // 状态写失败（能力口不可用/宿主半没装）：界面按内存态继续可用，日志留痕。
            console.warn('[dsh-one] workspace groups not persisted:', reason)
          })
      },
      // #102：置顶与手动未读两份 id 集合——与分组同一条路（宿主能力口的
      // `stateRead/stateWrite`），键名 `pinned` / `unread` **就是旧侧栏的文件名**
      // （`~/.dsh/dsh-one/pinned.json` / `unread.json`），所以旧数据开箱即用：读到的
      // 若是规范形状直接采用；若是更早的裸 id 数组或坏值，采用清洗后的 id 并按规范
      // 形状写回一次（`migrateSessionMarks` 的 `rewrite`）——那次写回就是「迁入落定」，
      // 此后只有能力口读写，插件自己不碰任何文件（它本来也没有文件 IO 的能力）。
      loadMarks: async (): Promise<SessionMarksState> => {
        const port = hostCapabilities(ctx as unknown as CapabilityContext)
        const loaded = migrateSessionMarks({
          pinned: await port.stateRead(SESSION_PINNED_STATE_KEY),
          unread: await port.stateRead(SESSION_UNREAD_STATE_KEY),
        })
        for (const key of loaded.rewrite) {
          const ids = key === 'pinned' ? loaded.marks.pinned : loaded.marks.unread
          void port
            .stateWrite(key === 'pinned' ? SESSION_PINNED_STATE_KEY : SESSION_UNREAD_STATE_KEY, markStateFile(ids))
            .then(
              () => console.warn(`[dsh-one] session marks[${key}]: migrated legacy shape, rewritten in canonical form`),
              (reason: unknown) => console.warn(`[dsh-one] session marks[${key}] migation not persisted:`, reason),
            )
        }
        return loaded.marks
      },
      savePinned: (ids: readonly string[]): void => {
        void hostCapabilities(ctx as unknown as CapabilityContext)
          .stateWrite(SESSION_PINNED_STATE_KEY, markStateFile(ids))
          .catch((reason: unknown) => {
            console.warn('[dsh-one] pinned sessions not persisted:', reason)
          })
      },
      saveUnread: (ids: readonly string[]): void => {
        void hostCapabilities(ctx as unknown as CapabilityContext)
          .stateWrite(SESSION_UNREAD_STATE_KEY, markStateFile(ids))
          .catch((reason: unknown) => {
            console.warn('[dsh-one] unread sessions not persisted:', reason)
          })
      },
      // #107：会话标签组——与分组、置顶/未读同一条路（宿主能力口的 `stateRead/stateWrite`），
      // 键名 `tags` **就是旧侧栏的文件名**（`~/.dsh/dsh-one/tags.json`），所以旧数据
      // 开箱即用；要「迁」的只有形状：不再算组的旧内置组（Todo/Doing/Done）与折叠字段
      // 在 `parseTagGroups` 里读一次就丢掉（理由写在 pure/sessionTagGroups.ts 的文件头）。
      loadTagGroups: async (): Promise<TagGroupsFile> => {
        const value = await hostCapabilities(ctx as unknown as CapabilityContext).stateRead(TAG_GROUPS_STATE_KEY)
        return parseTagGroups(value) ?? emptyTagGroups()
      },
      saveTagGroups: (file: TagGroupsFile): void => {
        void hostCapabilities(ctx as unknown as CapabilityContext)
          .stateWrite(TAG_GROUPS_STATE_KEY, JSON.parse(serializeTagGroups(file)) as unknown)
          .catch((reason: unknown) => {
            console.warn('[dsh-one] session tag groups not persisted:', reason)
          })
      },
    }
  }

  ctx.effect(() => {
    const disposeLocale = ctx.locale.register(LOCALE_NS, { zh: ZH, en: EN })
    // #147：宿主面板里开着哪些会话——订阅一次（快照 + 变化推送都从这条订阅进来），
    // 写进页内 store（`workspaceTree/panelSessionsStore.ts`）供树主组件渲染时消费。
    //
    // 为什么订阅挂在这里而不是 `buildInjected` 里：那个函数每次渲染都会被调，订阅会被
    // 反复建/拆；这份事实源只该订阅一次、跟着插件 fiber 一起收。**官方 web 侧这条订阅
    // 永不推送**（能力口的如实形态），集合恒为空 = 不抑制任何提醒，与这条通道不存在时
    // 逐字相同。
    const disposePanelSessions = caps.onPanelSessions((sessionIds) => setPanelOpenSessions(sessionIds))
    // 对既有槽位名（官方 ui-sidebar 的 children 表声明）必须走 slots.inject：
    // 直接 register 会在「未声明」时抛错。single 槽影子：priority −1 < 官方
    // WorkspaceBrowser 的默认 0 → 本件渲染。
    const disposeInject = ctx.slots.inject('sidebar.workspaces', () =>
      ctx.slots.register(
        {
          name: 'sidebar.workspaces',
          priority: -1,
          children: {},
          locale: LOCALE_NS,
          inject: buildInjected,
        },
        WorkspaceTree,
      ),
    )
    // #99 B 段：底部回收站入口行——官方 `sidebar.footer.action`（list 槽，官方侧栏壳
    // 声明；官方 ui-cordis 的 `cordis-panel` 那条**并存**，这里只是再注册一条自己的）。
    // list 条目按 `id` 认领位置（官方那条的 id 是 'cordis-panel'），order 不给 =
    // 排在它后面（官方侧栏壳按 order + 注册序渲染）。
    const disposeFooterEntry = ctx.slots.inject('sidebar.footer.action', () =>
      ctx.slots.register(
        {
          name: 'sidebar.footer.action',
          id: 'dsh-one-recycle-bin',
          locale: LOCALE_NS,
        },
        RecycleEntry,
      ),
    )
    return () => {
      disposePanelSessions()
      disposeFooterEntry()
      disposeInject()
      disposeLocale()
    }
  }, 'dsh-one workspace tree: shadow sidebar.workspaces')
}
