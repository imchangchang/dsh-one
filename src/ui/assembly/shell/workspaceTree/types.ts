/** 本地最小类型面（官方私包的精确类型不在本仓库）。 */
import type { SessionListLike } from '../../../../pure/workspaceTreeView.ts'
import type { GroupFile } from '../../../../pure/dshStateFile.ts'

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

/** 等待态快照：官方 UiSession 暴露的 Map（会话 id → {kind}）。 */
export type PendingMap = ReadonlyMap<string, { readonly kind?: string }>

/** 一页宿主内容搜索结果（官方 `session.search` 的返回体）。 */
export interface SearchPage {
  readonly items: readonly { readonly id: string; readonly snippet?: string }[]
  readonly hasMore: boolean
}

/**
 * 组件 props：官方 WorkspaceBrowser 的同一组槽位（owner share `wide` +
 * 框架标准钩子 + entry 自己 inject 出来的动作 + locale 槽位）。命名与官方保持
 * 一致，便于对照源码阅读。
 */
export interface TreeProps {
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
  useSessionPendingInteraction: <R>(selector: (state: PendingMap) => R) => R
  /** 框架按 entry 的 hooks 槽位绑定的目录流占用探针（官方 WorkspaceBrowser 同款）。 */
  useDirectoryFlow?: <R>(selector: (occupied: boolean) => R) => R
  /** 官方 sessions 服务：选中会话。 */
  open: (sessionId: string) => void
  /** 在工作区里开新会话（复用空白会话或新建），见 apply 处对官方语义的说明。 */
  startSession: (workspaceId?: string) => void
  renameSession: (sessionId: string, title: string) => Promise<void>
  forkSession: (sessionId: string) => void
  archiveSession: (sessionId: string) => Promise<void>
  renameWorkspace: (workspaceId: string, title: string) => Promise<unknown>
  deleteWorkspace: (workspaceId: string) => Promise<void>
  addWorkspace: () => void
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
   * #81 功能 3/4：把会话移入回收站——官方 `uiWorkspace.archiveSession`（数据面就是
   * 官方归档集合，我们不自己记名单）。返回失败的那些 id（界面据此保留选中）。
   */
  recycleSessions: (sessionIds: readonly string[]) => Promise<{ failed: readonly string[] }>
  /** #81 功能 3/5：从回收站还原——官方 `uiWorkspace.unarchiveSession`。 */
  restoreSession: (sessionId: string) => Promise<void>
  /**
   * 「在新标签页打开」（#72 多开通道）：宿主有编辑器标签页时由 apply 注入，
   * 官方 web 形态（无此能力）不注入 = 菜单项与行右键都不出现。
   */
  openInNewTab?: (sessionId: string) => void
}
