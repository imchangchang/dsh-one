/** 本地最小类型面（官方私包的精确类型不在本仓库）。 */
import type { SessionListLike } from '../../../../src/pure/workspaceTreeView.ts'
import type { GroupFile } from '../../../../src/pure/dshStateFile.ts'
import type { SessionMarksState } from '../../../../src/pure/sessionMarks.ts'
import type { TagGroupsFile } from '../../../../src/pure/sessionTagGroups.ts'
import type { PendingHookProps } from '../../../../src/pure/sessionPendingSource.ts'

export type Translate = (key: string, params?: Record<string, string | number>) => string

export interface WorkspaceSnapshotLike {
  readonly items: readonly WorkspaceViewLike[]
  readonly archivedSessionIds: readonly string[]
  readonly phase: 'pending' | 'ready'
  readonly state: 'idle' | 'loading' | 'error'
}

export interface WorkspaceViewLike {
  readonly workspaceId: string
  readonly path: string
  readonly title: string
  readonly sessionIds: readonly string[]
  readonly createdAt: string
}

/**
 * 「刚刚添加/创建成功的工作区」（#176）：id 必给，名字尽力给。
 *
 * 名字为什么可以缺省：两条添加路径的来源不同——官方 `workspaces.create` 与扩展的
 * `dshOne.workspace.create` 命令都给 `WorkspaceView`（带 title），但页面不该把
 * 「名字」当成硬前提：拿不到时界面退回到工作区快照里找（名字的权威本来就是 dsh 的
 * 工作区注册表）。id 缺省则意味着「认不出刚加的是哪一个」，那一刻不动任何后续动作。
 */
export interface AddedWorkspace {
  readonly workspaceId: string
  readonly title?: string
}

/** 一页宿主内容搜索结果（官方 `session.search` 的返回体）。 */
export interface SearchPage {
  readonly items: readonly { readonly id: string; readonly snippet?: string }[]
  readonly hasMore: boolean
}

/**
 * 组件 props：官方 WorkspaceBrowser 的同一组槽位（owner share `wide` +
 * 框架标准钩子 + entry 自己 inject 出来的动作 + locale 槽位）。命名与官方保持
 * 一致，便于对照源码阅读。
 *
 * 官方标准钩子里的会话等待态那一对（老代 `useSessionPendingInteraction`、新代
 * `useSessionStatus`）从 `PendingHookProps` 继承——同一页只会有其中一条，取法与
 * 投影见 `src/pure/sessionPendingSource.ts`。
 */
export interface TreeProps extends PendingHookProps {
  /**
   * 侧栏壳给的宽度形态：宽列（true）渲染整块浏览区，rail（false）只渲染搜索/添加
   * 两个 36px 图标——**本步只做宽列**：自有侧栏外框恒传 `collapsed:false`，官方
   * SidebarRoot 遂恒取 wide=true（`wide = !collapsed || !settled`），rail 分支在
   * VS Code 形态下不可达；将来若要支持内页收起轨，按官方同款补 rail 分支即可。
   */
  wide?: boolean
  /** rail 态点图标请求展开（官方 owner share）；本步宽列形态不消费。 */
  expandSidebar?: () => void
  t: Translate
  useSessions: <R>(selector: (state: SessionListLike) => R) => R
  useWorkspaces: <R>(selector: (state: WorkspaceSnapshotLike) => R) => R
  /** 官方 sessions 服务：选中会话。 */
  open: (sessionId: string) => void
  /** 在工作区里开新会话（复用空白会话或新建），见 apply 处对官方语义的说明。 */
  startSession: (workspaceId?: string) => void
  renameSession: (sessionId: string, title: string) => Promise<void>
  /**
   * 分叉会话（官方 `uiWorkspace.forkSession` 的语义）。返回 Promise：失败由界面层
   * 如实报出来（#110），插件只负责把官方那条链路的成败原样交回，不再自己吞掉。
   */
  forkSession: (sessionId: string) => Promise<unknown>
  renameWorkspace: (workspaceId: string, title: string) => Promise<unknown>
  deleteWorkspace: (workspaceId: string) => Promise<void>
  /**
   * 顶栏 ＋ 菜单第一项「选择已有文件夹…」：官方 `uiWorkspace.pickDirectory` 选目录
   * 后按官方 `workspaces.create({path})` 注册。**为什么不是渲染官方
   * `sidebar.workspaces.directoryFlow` 子槽**：那口子由官方 WorkspaceBrowser 条目在
   * 它自己的 children 里声明，官方渲染器只允许声明者渲染（`boundRenderSlot` 对
   * `entry.children?.[key] === undefined` 抛 SlotOwnershipError），我们这条 shadow
   * entry 声明不了同名槽——举证与结论见 workspaceTreePlugin 的注入面注释。
   *
   * #176：**返回刚注册的工作区**（原来返回 void，于是「选完目录界面什么都不发生」）；
   * 失败以 Promise 拒绝的形式交回（模板同 #110 那一批：插件不吞失败，界面给一行可见
   * 反馈）。`null` = 用户取消了选择，不是失败。
   */
  pickWorkspaceFolder: () => Promise<AddedWorkspace | null>
  /**
   * ＋ 菜单第二项「创建新工作区目录…」：宿主能力口来的动作。**undefined = 这个宿主
   * 没有这条能力**（官方 web 侧建目录归官方目录流占用者），那一项就不出现。
   * 返回值与 {@link pickWorkspaceFolder} 同口径（#176：带回新工作区、取消给 null）。
   */
  createWorkspaceFolder?: (() => Promise<AddedWorkspace | null>) | undefined
  /**
   * #176：在一个工作区里新建会话并打开它（宿主能力口 `newSessionInWorkspace` 的封装）。
   * **undefined = 这个宿主没有这一步**（官方 web 侧「添加工作区之后建不建会话」归官方
   * 自己的 directory-flow）——那一刻页面只添加、不开会话，一声不响也不报错。
   */
  newSessionInWorkspace?: ((workspaceId: string) => Promise<unknown>) | undefined
  /**
   * 顶栏设置齿轮：宿主能力口来的动作。**undefined = 这个宿主没有独立设置页**
   * （官方 web 侧设置是官方侧栏底部那一行），齿轮就不渲染。
   */
  openSettings?: (() => void) | undefined
  searchSessions: (query: string, signal: AbortSignal) => Promise<SearchPage>
  searchResultLimit: number
  /**
   * #82：本插件自己的**持久状态**读回（宿主能力口 `stateRead('groups')` 的封装）。
   * 插件不碰 VS Code API、不拼网关 RPC——两侧的实现由能力口按壳子配好。
   */
  loadGroups: () => Promise<GroupFile>
  /** 写回分组状态（宿主能力口 `stateWrite`；失败静默，界面按内存态继续可用）。 */
  saveGroups: (file: GroupFile) => void
  /**
   * #102：本插件的两份**用户标记**读回（宿主能力口 `stateRead('pinned')` /
   * `stateRead('unread')` 的封装，见 `pure/sessionMarks.ts`）。读一次，此后只在
   * 变更时写回——旧文件（`~/.dsh/dsh-one/pinned.json` / `unread.json`）就是这两个
   * 键，没有任何第二份存储。
   */
  loadMarks: () => Promise<SessionMarksState>
  /** 写回置顶 id 集合（宿主能力口 `stateWrite('pinned')`；失败静默）。 */
  savePinned: (ids: readonly string[]) => void
  /** 写回手动未读 id 集合（宿主能力口 `stateWrite('unread')`；失败静默）。 */
  saveUnread: (ids: readonly string[]) => void
  /**
   * #107：会话标签组的持久状态读回（宿主能力口 `stateRead('tags')` 的封装，见
   * `pure/sessionTagGroups.ts`）。键名 `tags` 就是旧侧栏的文件名
   * （`~/.dsh/dsh-one/tags.json`），所以旧数据开箱即用——迁入的只有形状
   * （丢掉不再算组的旧内置组、丢掉折叠字段），读一次、变更时写回。
   */
  loadTagGroups: () => Promise<TagGroupsFile>
  /** 写回标签组状态（宿主能力口 `stateWrite('tags')`；失败静默，界面按内存态继续可用）。 */
  saveTagGroups: (file: TagGroupsFile) => void
  /**
   * 「在新标签页打开」（#72 多开通道）：宿主有编辑器标签页时由 apply 注入，
   * 官方 web 形态（无此能力）不注入 = 菜单项与行右键都不出现。返回 Promise：
   * 失败由界面层如实报出来（#110），插件不再只写一行日志。
   */
  openInNewTab?: ((sessionId: string) => Promise<unknown>) | undefined
  /**
   * #121：这个会话现在是不是正开在宿主的对话面板里（宿主能力口 `isSessionInPanel` 的
   * 封装）。树的会话行点击按它判「当前会话行」是就地改名还是按打开处理——`list.current`
   * （官方 sessions 服务的状态，启动时可能是官方恢复的上次会话）不等于「宿主真的开着
   * 它」，两者不同步时只按前者判，用户点那行只会进改名、面板永远不出来。
   *
   * 官方 web 形态（没有宿主调用通道）恒 false（那一端没有宿主面板这个概念）→ 当前会话行一律按
   * 打开处理。答不出来也回 false，是安全的降级方向。
   */
  isSessionInPanel: (sessionId: string) => Promise<boolean>
  /**
   * #121：把对话面板亮到这个会话（宿主能力口 `openSessionPanel` 的封装）。**必须是
   * 独立的一条**：会话已经是官方那条打开入口的「当前」时，再打开它不会让值
   * 变化、选择桥也就不会上报，光靠官方那条路面板永远不出来。
   *
   * 官方 web 形态（没有宿主调用通道）是静默空操作——那一端的「打开」就是官方那条入口，
   * 调用方已经先走过它了。
   */
  openSessionPanel: (sessionId: string) => Promise<void>
  /**
   * #109 工作区行：在编辑器窗口里打开这个工作区文件夹（`newWindow` = 另开一个窗口）。
   * **undefined = 这个宿主没有编辑器窗口**（官方 web 形态）：hover 的「在 VS Code 打开」
   * 与右键的「在新窗口打开文件夹」两项都不出现。
   */
  openWorkspaceFolder?: ((path: string, options: { newWindow: boolean }) => void) | undefined
  /**
   * #109 工作区行：在这个工作区目录上开一个集成终端。**undefined = 这个宿主没有集成
   * 终端**（官方 web 形态）：hover 的「终端打开」不出现。
   */
  openWorkspaceTerminal?: ((path: string) => void) | undefined
  /**
   * #109 当前工作区标识：这套宿主是什么（VS Code 侧 `'vscode'`，官方 web 侧 `'web'`），
   * 写在那枚胶囊上——旧侧栏把 `vscode` 写死在渲染里，官方 web 上会挂出一个不对的名字。
   */
  shellName: string
  /**
   * #112：**VS Code 当前打开的文件夹**路径表（宿主能力口 `currentWorkspaceFolders`
   * 的封装）。树的「当前工作区」判定按它：工作区 `path` 命中任一项 → 该组显示蓝色
   * 徽标并排最前。空表（官方 web 侧没有这个概念、VS Code 空窗口）= 没有当前工作区。
   *
   * 读一次（挂载时）——VS Code 换文件夹会重载窗口、webview 随之重建并重新读一次；
   * 同一窗口里多根目录的增删属罕见路径，本步不为它接宿主推送通道。
   */
  loadCurrentFolders: () => Promise<readonly string[]>
}
