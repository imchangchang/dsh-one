/** 树主组件（官方 WorkspaceBrowser 的同构复刻）：组合上面各件 + 状态与订阅。 */
import { createElement as h, useEffect, useMemo, useRef, useState } from 'react'
import { IconCloseFill14, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { NO_PENDING, pendingSourceOf } from '../../../../src/pure/sessionPendingSource.ts'
import { currentWorkspaceFirst, deriveFlat, deriveGroups, deriveRecycleGroups, groupSessionNodes, indexSubagentDescendants, owningGroupKey, sessionNode, UNGROUPED_KEY, visibleRecycleIds, withoutPanelOpenCompleted, workspaceActivityCounts, type ActivityCounts, type GroupNode, type SessionNode } from '../../../../src/pure/workspaceTreeView.ts'
import { formatFileMention } from '../../../../src/pure/fileReference.ts'
import { formatSessionMention } from '../../../../src/pure/sessionMention.ts'
import {
  canRecycle,
  cannotArchiveReason,
  cannotRecycleReason,
  groupSelectionState,
  groupSelectionToggle,
  type GroupSelectionState,
  type SessionEligibilityFacts,
} from '../../../../src/pure/sessionEligibility.ts'
import {
  createTreeGroup,
  deleteTreeGroup,
  emptyTreeGroups,
  hasTreeGroup,
  renameTreeGroup,
  reorderTreeGroups,
  setWorkspacesGroupMembership,
  toggleWorkspaceGroup,
  treeGroupDefs,
  workspaceGroupIds,
  workspaceMatchesGroup,
} from '../../../../src/pure/treeGroups.ts'
import {
  autoExpandGroup,
  expandedGroupKeys,
  pageStorage,
  readTreeViewPrefs,
  setGroupExpansion,
  toggleGroupExpansion,
  writeTreeViewPrefs,
  type TreeViewPrefs,
} from '../../../../src/pure/workspaceTreePrefs.ts'
import { emptySessionMarks, pinnedFirst, toggleMarkId, type SessionMarksState } from '../../../../src/pure/sessionMarks.ts'
import {
  createTagGroup,
  deleteTagGroup,
  emptyTagBucket,
  emptyTagGroups,
  nextTagColor,
  pruneTagGroups,
  reorderTagGroups,
  setSessionTagGroup,
  setSessionsTagGroup,
  splitByTagGroups,
  tagBucketOf,
  tagGroupNameError,
  tagGroupSessionIds,
  updateTagGroup,
  withTagBucket,
  type TagGroupBucket,
  type TagGroupDef,
  type TagGroupsFile,
} from '../../../../src/pure/sessionTagGroups.ts'
import type { TagColor } from '../../../../src/pure/sessionTags.ts'
import type { GroupFile } from '../../../../src/pure/dshStateFile.ts'
import { FlashHost, flashTip } from './flash.ts'
import { onSessionOwnedElsewhere } from './sessionOwnedNotice.ts'
import { usePanelOpenSessions } from './panelSessionsStore.ts'
import { displayTitle } from './format.ts'
import { TAG_MENU_PREFIX, newGroupId, newTagGroupId } from './groups.ts'
import { useHoverCardRoom } from './hoverCard.ts'
import {
  ArchiveSessionsModal,
  DeleteWorkspaceModal,
  GroupModal,
  ManageGroupsModal,
  RenameModal,
  TagGroupCreateModal,
  TagGroupDeleteModal,
  type ArchiveRequest,
} from './modals.ts'
import { partitionArchivable } from '../../../../src/pure/recycleActions.ts'
import { pruneRecycleBin, recycleBinActions, useRecycleBin } from './recycleBinStore.ts'
import { RecycleDrawer } from './recycleDrawer.ts'
import { setRecycleDrawerOpen, useRecycleDrawerOpen } from './recycleDrawerStore.ts'
import { recycleEntrySignal } from './recycleEntry.ts'
import { ProjectRow, SearchResultRow, SessionRow } from './rows.ts'
import { useScrollbarLane } from './scrollbarLane.ts'
import { EMPTY_SEARCH, SEARCH_DEBOUNCE_MS, sanitizeQuery, type SearchState } from './search.ts'
import { SelectionBar, selectionEntrySignal } from './selection.ts'
import './styles.ts'
import {
  TagGroupBlock,
  TagColorSwatch,
  sessionDragProps,
  tagCollapseKey,
  tagGroupMenuItems,
  ungroupDropZone,
} from './tagGroups.ts'
import { TopBar } from './toolbar.ts'
import type { AddedWorkspace, TreeProps } from './types.ts'

// ---------------------------------------------------------------------------
// 主组件（官方 `WorkspaceBrowser` 的同构复刻）
// ---------------------------------------------------------------------------
export function WorkspaceTree(props: TreeProps): unknown {
  const {
    t,
    useSessions,
    useWorkspaces,
    open: openSession,
    startSession,
    renameSession,
    forkSession,
    renameWorkspace,
    deleteWorkspace,
    pickWorkspaceFolder,
    createWorkspaceFolder,
    newSessionInWorkspace,
    openSettings,
    searchSessions,
    searchResultLimit,
    loadGroups,
    saveGroups,
    loadMarks,
    savePinned,
    saveUnread,
    loadTagGroups,
    saveTagGroups,
    openInNewTab,
    openWorkspaceFolder,
    openWorkspaceTerminal,
    shellName,
    loadCurrentFolders,
    isSessionInPanel,
    openSessionPanel,
  } = props
  const tr = t
  const now = Date.now()
  const sessionsState = useSessions((state) => state)
  /**
   * #147：宿主的面板里正开着哪些会话（宿主推来的事实，官方 web 侧恒为空集）。
   *
   * 它只并进**渲染判据**（`withoutPanelOpenCompleted` 把这份集合里那些会话的
   * `completed` 按 false 渲染），不动官方 client 的 selected——为什么不走官方
   * selected、以及这条判据有意留下的边界，逐条写在 `pure/workspaceTreeView.ts` 的
   * `withoutPanelOpenCompleted` 上面。
   *
   * 集合为空时 `withoutPanelOpenCompleted` 原样返回同一份 list：官方 web 侧（收不到这条
   * 事实）的行为与这条通道不存在时逐字相同，也不多一次重算。
   */
  const openInPanel = usePanelOpenSessions()
  const list = useMemo(() => withoutPanelOpenCompleted(sessionsState, openInPanel), [sessionsState, openInPanel])
  const workspaces = useWorkspaces((state) => state.items)
  const workspacePhase = useWorkspaces((state) => state.phase)
  const archivedSessionIds = useWorkspaces((state) => state.archivedSessionIds)
  /**
   * 官方会话等待态（#184）：两代各一条 root 钩子——0.1.6-alpha.2 起是 `sessionStatus`
   * （会话状态表，等待态在 `status.pendingInteraction` 那一格），此前是
   * `sessionPendingInteraction`（快照本身就是等待态表）。挑哪一条、怎么投影，全部在
   * `pure/sessionPendingSource.ts` 里（单一事实源，上游探针也读它那份名字表）。
   *
   * **必须先在调用之前分叉**：官方框架只下发在场的那条钩子，缺的那条 props 上是
   * `undefined`，直接调用会抛错并让整棵树的槽位条目崩掉（不是「点不亮」那么轻）。
   * 两条都不在（`pendingSource === null`）时按空表渲染，并在列表上方给一行可见的事实。
   *
   * 钩子在不在场是**这一页启动时就有的事实**（官方 `provideRoot` 只在启动时下发一次，
   * 不会中途换名字），所以这里的「有则调用」不会在两个渲染之间改变调用顺序。
   */
  const pendingSource = pendingSourceOf(props)
  const pendingSnapshot = pendingSource === null ? null : pendingSource.read(props)
  const pending = useMemo(
    () => (pendingSource === null || pendingSnapshot === null ? NO_PENDING : pendingSource.project(pendingSnapshot)),
    [pendingSource, pendingSnapshot],
  )

  // 视图态（当前过滤的分组 / 展开集合 / 抽屉与标签组各自的收起集合）住官方客户端惯例的
  // localStorage，初值在挂载时读一次；此后每次变更都写回（见下面的写回 effect）。
  // #131 起分组方式与排序方式不再存在（「按工作区 + 官方顺序」是唯一形态），见
  // `pure/workspaceTreePrefs.ts` 的文件头。
  const [prefs, setPrefs] = useState<TreeViewPrefs>(readTreeViewPrefs(pageStorage()))
  const activeGroupId = prefs.activeGroupId
  // 展开集合从官方那份记录里派生（官方同此：`SessionTree` 里 `Object.entries(groupExpansion)`
  // 过滤出 true 的键，再喂给 `deriveGroups`）。
  const groupExpansion = expandedGroupKeys(prefs)
  const [searchText, setSearchText] = useState('')
  const [content, setContent] = useState<SearchState>(EMPTY_SEARCH)
  const [renameTarget, setRenameTarget] = useState<{ workspaceId: string; title: string } | null>(null)
  const [sessionRenameTarget, setSessionRenameTarget] = useState<{ id: string; title: string } | null>(null)
  /**
   * #115 行内改名（当前会话行点一下就地变输入框）：正在改名的会话 id、草稿、进入编辑
   * 时的原标题（「没改动就不发请求」按它判）。
   *
   * 为什么编辑态住在这里而不是行组件里：会话状态推送会让整棵树重画，行组件可能被重建
   * ——状态住行里就会被一起丢掉（用户打到一半的标题没了）。住树层后行只是「按这份状态
   * 渲染」，重画多少次都还是同一个编辑态。
   */
  const [sessionEdit, setSessionEdit] = useState<{ id: string; draft: string; title: string } | null>(null)
  /**
   * 编辑框的光标/选区（跨重绘恢复用）。放 ref 不放 state：每次移动光标都触发一次整棵树
   * 重渲染没有意义，而重绘恢复只发生在「下一次渲染」那一刻，读到最新的值就够。
   */
  const editSelection = useRef<{ start: number; end: number }>({ start: 0, end: 0 })
  const [deleteTarget, setDeleteTarget] = useState<{ workspaceId: string; title: string } | null>(null)
  // 分组状态：持久态住宿主能力口（`stateRead/stateWrite('groups')`），读是异步的，
  // 读回前先按空状态渲染（不阻塞首屏）。
  const [groupsFile, setGroupsFile] = useState<GroupFile>(emptyTreeGroups())
  const [groupDialog, setGroupDialog] = useState<
    | { kind: 'create' }
    | { kind: 'rename'; id: string; name: string }
    | { kind: 'delete'; id: string; name: string }
    | null
  >(null)
  const [groupError, setGroupError] = useState<string | null>(null)
  // #102：两份用户标记（置顶 / 手动未读）的 id 集合。与分组同一处置：住宿主能力口
  // （`stateRead('pinned' | 'unread')`，键名 = 旧侧栏的文件名），读一次、变更时写回。
  const [marks, setMarks] = useState<SessionMarksState>(emptySessionMarks())
  // 「管理分组…」对话框（#99 B 段，单胶囊下拉里的一项）。
  const [manageGroupsOpen, setManageGroupsOpen] = useState(false)
  // 批量选择（纯视图态，不持久化）+ 回收站抽屉 + 归档确认弹窗。
  const [selectMode, setSelectMode] = useState(false)
  const [selection, setSelection] = useState<readonly string[]>([])
  const [busy, setBusy] = useState(false)
  const [selectionError, setSelectionError] = useState<string | null>(null)
  // 回收站抽屉的开合态住模块级 store（#114：入口行在另一个座位，它也要读到同一份，
  // 才能把点击翻成展开还是收起——见 `recycleDrawerStore.ts`）。本组件是**唯一写它的人**。
  const drawerOpen = useRecycleDrawerOpen()
  const [recycleError, setRecycleError] = useState<string | null>(null)
  const [archiveRequest, setArchiveRequest] = useState<ArchiveRequest | null>(null)
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  // #107 会话标签组：持久态（组定义 + 归属）住宿主能力口 `tags` 键；对话框与
  // 「刚开的新会话该归到哪个组」是纯界面状态。
  const [tagFile, setTagFile] = useState<TagGroupsFile>(emptyTagGroups())
  // #112「当前工作区」判定用的文件夹表（VS Code 当前打开的文件夹）。挂载时从宿主
  // 能力口读一次；读回前是空表 = 没有当前工作区（不显示徽标、不置顶），读回后按路径
  // 命中重算——**当前会话（`list.current`）不参与这条判定**，它只管行的可见性。
  const [currentFolders, setCurrentFolders] = useState<readonly string[]>([])
  const [tagCreate, setTagCreate] = useState<{ groupKey: string; sessionId: string } | null>(null)
  const [tagRename, setTagRename] = useState<{ groupKey: string; id: string; name: string } | null>(null)
  const [tagDelete, setTagDelete] = useState<{ groupKey: string; id: string; name: string } | null>(null)
  const [tagNewSession, setTagNewSession] = useState<{ groupKey: string; tagId: string } | null>(null)
  /**
   * #176：刚添加/创建成功的工作区（只记 id 与名字，**不写任何持久状态**）。它只服务
   * 一件事——当分组过滤把那一行挡住时，在树里给一条能行动的提示（见下面的 `addNoticeFor`）。
   * 用户点「全部工作区」、点关闭、或下一次添加就重新赋值/清掉。
   */
  const [addNotice, setAddNotice] = useState<{ workspaceId: string; title?: string } | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const hoverCard = useHoverCardRoom(rootRef)
  // #168：列表给滚动条留的那一格**按当页实测**写回变量（浮层滚动条下是 0，实占时是滚动条
  // 自身的宽），顶栏那一行的右内缩与列表自己的右内边距都读它——见 scrollbarLane.ts 的文件头。
  useScrollbarLane(rootRef)

  // 本地回收站（#103 的两层语义第一层）：状态住 recycleBinStore（同一 bundle 内共享，
  // 入口行与这里看到的是同一份）。`recycledIds` = 还认得出来的那些；主树过滤、抽屉内容、
  // 入口角标与批量动作**都用这一份**，不会出现「角标数与抽屉行数对不上」。
  const bin = useRecycleBin()
  const archived = new Set(archivedSessionIds)
  const recycledIds = visibleRecycleIds(bin.ids, list, archivedSessionIds)
  const recycled = new Set(recycledIds)

  // 视图态写回（每次变更落一次；写失败静默——视图态不是数据）。
  useEffect(() => {
    writeTreeViewPrefs(pageStorage(), prefs)
  }, [prefs])

  // 分组状态读（宿主能力口）。只读一次（ref 守门，不靠 loadGroups 的引用稳定——
  // 注入的 props 每次渲染可能都是新函数，按依赖重跑会变成无限循环）。失败
  // （能力口没实现/宿主半没装）时保持空状态并降级：树照常可用，只是没有分组可
  // 过滤——不弹错、不白屏。
  const groupsLoaded = useRef(false)
  useEffect(() => {
    if (groupsLoaded.current) return
    groupsLoaded.current = true
    let cancelled = false
    loadGroups().then(
      (file) => {
        if (!cancelled) setGroupsFile(file)
      },
      (reason: unknown) => {
        if (!cancelled) console.warn('[dsh-one] workspace groups unavailable:', reason)
      },
    )
    return () => {
      cancelled = true
    }
  }, [loadGroups])

  const writeGroups = (next: GroupFile | null): void => {
    if (next === null) return
    setGroupsFile(next)
    saveGroups(next)
  }

  // 置顶 / 手动未读（#102）：同样读一次（ref 守门，理由与分组那段一致——注入的
  // props 每次渲染都可能是新函数）。读失败（能力口没实现/宿主半没装）保持空集合：
  // 树照常可用，只是没有置顶与未读标记，不弹错、不白屏。
  const marksLoaded = useRef(false)
  useEffect(() => {
    if (marksLoaded.current) return
    marksLoaded.current = true
    let cancelled = false
    loadMarks().then(
      (state) => {
        if (!cancelled) setMarks(state)
      },
      (reason: unknown) => {
        if (!cancelled) console.warn('[dsh-one] session marks unavailable:', reason)
      },
    )
    return () => {
      cancelled = true
    }
  }, [loadMarks])

  // 标签组（#107）：与分组同一条路（宿主能力口 `tags` 键，= 旧侧栏的 tags.json 文件）。
  // 读一次（ref 守门，理由同上）；读失败保持空状态——树照常可用，只是没有标签组，
  // 不弹错、不白屏（与分组、标记的降级口径一致）。
  const tagsLoaded = useRef(false)
  useEffect(() => {
    if (tagsLoaded.current) return
    tagsLoaded.current = true
    let cancelled = false
    loadTagGroups().then(
      (file) => {
        if (!cancelled) setTagFile(file)
      },
      (reason: unknown) => {
        if (!cancelled) console.warn('[dsh-one] session tag groups unavailable:', reason)
      },
    )
    return () => {
      cancelled = true
    }
  }, [loadTagGroups])

  // #112：当前打开的文件夹表（宿主能力口 `currentWorkspaceFolders`）。与上面三份持久
  // 状态同一处置：读一次、ref 守门（注入的 props 每次渲染都可能是新函数）；读失败保持
  // 空表——「没有当前工作区」是一个正常的呈现形态（不显示徽标、不置顶），不弹错、不白屏。
  //
  // 只读一次的理由：VS Code 里换一个文件夹会重载窗口、webview 跟着重建并重新读；同一
  // 窗口内多根目录的增删（罕见路径）本步不为它接宿主推送通道——见 types.ts 的同名说明。
  const foldersLoaded = useRef(false)
  useEffect(() => {
    if (foldersLoaded.current) return
    foldersLoaded.current = true
    let cancelled = false
    loadCurrentFolders().then(
      (folders) => {
        if (!cancelled) setCurrentFolders(folders)
      },
      (reason: unknown) => {
        if (!cancelled) console.warn('[dsh-one] workspace folders unavailable:', reason)
      },
    )
    return () => {
      cancelled = true
    }
  }, [loadCurrentFolders])

  /** 写回标签组状态（先落界面、再落宿主能力口；失败静默，与分组同一处置）。 */
  const writeTags = (next: TagGroupsFile): void => {
    setTagFile(next)
    saveTagGroups(next)
  }
  /** 某个分组键（工作区 id / 未分组桶）名下的标签组桶；没有就是空桶（不建键）。 */
  const tagBucket = (groupKey: string): TagGroupBucket => tagBucketOf(tagFile, groupKey)
  /** 把一个桶写回去；`null` = 没变化，跳过落盘。 */
  const applyTagBucket = (groupKey: string, next: TagGroupBucket | null): void => {
    if (next === null) return
    writeTags(withTagBucket(tagFile, groupKey, next))
  }
  /** 一行会话所属的分组键（与树里的分组键同域；认不出就是未分组桶）。 */
  const groupKeyOfSession = (sessionId: string): string =>
    workspaces.find((workspace) => workspace.sessionIds.includes(sessionId))?.workspaceId ?? UNGROUPED_KEY

  const pinnedIds = new Set(marks.pinned)
  const unreadIds = new Set(marks.unread)
  /** 写回一份标记（先落界面、再落宿主能力口；失败静默，与分组同一处置）。 */
  const persistPinned = (ids: readonly string[]): void => {
    setMarks((prev) => ({ ...prev, pinned: ids }))
    savePinned(ids)
  }
  const persistUnread = (ids: readonly string[]): void => {
    setMarks((prev) => ({ ...prev, unread: ids }))
    saveUnread(ids)
  }
  /** 翻一下某一行的置顶/未读（无变化时 `toggleMarkId` 回同一份引用 = 不写盘）。 */
  const togglePin = (sessionId: string): void => {
    persistPinned(toggleMarkId(marks.pinned, sessionId, !pinnedIds.has(sessionId)))
  }
  const toggleUnread = (sessionId: string): void => {
    persistUnread(toggleMarkId(marks.unread, sessionId, !unreadIds.has(sessionId)))
  }
  /**
   * #102：打开会话即清未读——手动未读的意义就是「还没看」，看过了就不再是未读。
   * 树里三处打开入口（分组行、平铺行、搜索结果行）与抽屉里的行都走这里。
   */
  const openSessionClearingUnread = (sessionId: string): void => {
    if (unreadIds.has(sessionId)) persistUnread(toggleMarkId(marks.unread, sessionId, false))
    openSession(sessionId)
  }

  // ---- #115 行内改名：进入 / 改草稿 / 提交 / 取消 ----

  /**
   * 进入某一行的就地改名：草稿 = 这一行的原标题（`node.title`，与菜单那条 Modal 同一份
   * 取值），选区 = 整段全选。**不用行上显示的标题**：空白会话显示的是「新会话」这个
   * 占位词，拿它当草稿会把占位词真的提交成标题。
   */
  const startRowRename = (row: SessionNode): void => {
    editSelection.current = { start: 0, end: row.title.length }
    setSessionEdit({ id: row.id, draft: row.title, title: row.title })
    // 编辑态与弹层互斥：行内编辑开始时，把可能开着的「重命名会话」Modal 收掉。
    setSessionRenameTarget(null)
  }

  /** 草稿与光标位置（同值时短路，移动光标不会白重绘整棵树）。 */
  const updateRowRenameDraft = (draft: string, selection: { start: number; end: number }): void => {
    editSelection.current = selection
    setSessionEdit((prev) => (prev === null || prev.draft === draft ? prev : { ...prev, draft }))
  }

  /**
   * Enter 提交：**空串或没改动直接退出编辑态、不发请求**（与菜单 Modal 那条通路同一口径），
   * 有改动才走现成的 `renameSession`（官方 `sessions.binding(id).session.rename`）。
   * 失败按 #110 的口径飘一行可见反馈——行内这条路没有弹窗可以写红字。
   */
  const commitRowRename = (): void => {
    const edit = sessionEdit
    if (edit === null) return
    setSessionEdit(null)
    const title = edit.draft.trim()
    if (title === '' || title === edit.title) return
    void renameSession(edit.id, title).catch((reason: unknown) => reportFailure('rename.failed', reason))
  }

  /** Esc / 失焦取消：退出编辑态，什么都不发。 */
  const cancelRowRename = (): void => {
    setSessionEdit(null)
  }

  /**
   * 问宿主：这个会话现在开在对话面板里吗（契约上不抛——能力口把答不出来收成 false）。
   * 真抛了也按「没开」处置，与能力口的降级方向一致：最坏的错法不能是「用户点不出
   * 对话区」。
   */
  const sessionOpenInPanel = async (sessionId: string): Promise<boolean> => {
    try {
      return await isSessionInPanel(sessionId)
    } catch (reason) {
      console.warn('[dsh-one] session panel state failed:', reason)
      return false
    }
  }

  /**
   * 点「当前会话」那一行（#115 的语义、#121 修的判据）：**宿主确实正开着它**才就地
   * 改名，否则按打开处理。
   *
   * 为什么要多这一条真条件：「当前」的判据是官方 sessions 服务的 `list.current`，它
   * 可能是启动时官方恢复的上次会话，**不等于宿主侧真的开着这条会话的对话面板**。两者
   * 不同步时只按 `list.current` 判就会进改名，而改名这条路永远不会把面板打开——用户
   * 于是再也点不出对话区（#121 报的正是这个现场：刚启动点一条会话，右边还是 Welcome）。
   *
   * 两条分支：
   * - 宿主说开着 → 就地改名（#115 的语义原样保留，没有改回「点当前会话 = 打开」）；
   * - 宿主说没开 → 按打开处理：先走官方 `sessions.open`（官方 web 侧的「打开」就是它；
   *   在 VS Code 侧它顺带清掉手动未读），**再请宿主把面板亮到这个会话**。后一步是必须
   *   的：这条会话已经是「当前」，`sessions.open` 不会让值变化、选择桥也就不会上报，
   *   光靠官方那条路面板永远不出来。
   *
   * **点击那一刻问一次宿主**（而不是挂载时问一次缓存住）：面板可能被用户从对话区那一侧
   * 关掉或切走，缓存下来的「开着」会变成假话——而假话恰好就是本 bug 的形态。问一次是
   * 一次 webview↔宿主的往返（毫秒级），点击到进编辑态的延迟用户感知不到。
   *
   * **启动期不主动开面板**（#121 第 2 点让实现者判断，理由在此）：侧栏一挂载就把面板
   * 顶出来是打扰（#68 的「默认开一次」已经承担了这件事，且它尊重「用户手动关过」这个
   * 选择）；这里修的是判据——用户点了那条会话就是明确说了「我要看它」，此时打开不打扰。
   * 启动期的不同步因此在点击那一刻被如实判掉，不需要额外的动作。
   */
  const activateSessionRow = (row: SessionNode): void => {
    void sessionOpenInPanel(row.id).then((openInPanel) => {
      if (openInPanel) {
        startRowRename(row)
        return
      }
      openSessionClearingUnread(row.id)
      void openSessionPanel(row.id).catch((reason: unknown) => {
        // 面板这条失败只落一条日志：官方那条已经走了，用户至少拿到了会话切换；面板本身
        // 起不来时宿主已经弹过错误（prepareChatPanel）。
        console.warn('[dsh-one] show session panel failed:', reason)
      })
    })
  }

  // 编辑态跟着那条会话走：它在 dsh 侧没了（归档/删除）就把编辑态收掉，免得列表稍后
  // 渲染出这一行时带着一个没人要的输入框。列表为空（基线还没就绪）时不动。
  useEffect(() => {
    if (sessionEdit === null || list.ids.length === 0) return
    if (!list.ids.includes(sessionEdit.id)) setSessionEdit(null)
  }, [sessionEdit, list.ids])

  // 当前会话所在分组默认展开（官方同款：只在一条分组从未被显式收/展过时自动展开——用户
  // 手动收起过它就不动，规则与出处见 `pure/workspaceTreePrefs.ts` 的 `autoExpandGroup`）。
  useEffect(() => {
    if (list.current === undefined || workspacePhase !== 'ready') return
    const key = owningGroupKey(workspaces, list.current)
    setPrefs((prev) => autoExpandGroup(prev, key))
  }, [list.current, workspaces, workspacePhase])

  // 回收站清账（#103）：会话在 dsh 侧被归档/删掉之后，本地集合里那条就是垃圾数据。
  // 基线未就绪（会话服务还没重拉、列表为空）时 `pruneRecycleBin` 什么都不做——否则
  // 冷启动会把整个回收站清空。
  useEffect(() => {
    const known = new Set(list.ids.filter((id) => !archived.has(id)))
    const baselineReady = workspacePhase === 'ready' && list.ids.length > 0
    if (!baselineReady) return
    void pruneRecycleBin(known, true)
  }, [bin.ids, list.ids, workspacePhase, archivedSessionIds])

  // 搜索：输入住手 250ms 后打官方 `sessions.search`（宿主内容索引），失败降级为本地匹配。
  const trimmedQuery = searchText.trim()
  useEffect(() => {
    if (trimmedQuery === '') {
      setContent(EMPTY_SEARCH)
      return
    }
    const controller = new AbortController()
    setContent((prev) => ({ ...prev, pending: true, failed: false }))
    const timer = setTimeout(() => {
      searchSessions(trimmedQuery, controller.signal).then(
        (page) => setContent({ items: page.items, hasMore: page.hasMore, pending: false, failed: false }),
        () => {
          if (controller.signal.aborted) return
          setContent({ items: [], hasMore: false, pending: false, failed: true })
        },
      )
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [trimmedQuery, searchSessions])

  // 标签组的「组内新建会话」（#107）：菜单点完先记下目标组，等那个新会话被会话服务
  // 选中（`startSession` 内部会 `open` 它）再归组——`startSession` 只回 void，拿不到 id，
  // 所以认「当前会话 + 它确实落在目标工作区」这两个事实。工作区对不上就放弃（不猜）。
  useEffect(() => {
    if (tagNewSession === null) return
    const current = list.current
    if (current === undefined) return
    if (groupKeyOfSession(current) !== tagNewSession.groupKey) return
    applyTagBucket(tagNewSession.groupKey, setSessionTagGroup(tagBucket(tagNewSession.groupKey), current, tagNewSession.tagId))
    setTagNewSession(null)
  }, [tagNewSession, list.current, workspaces, tagFile])

  // 标签组的空组清理（#107）：组只与成员一起出现，成员全没了（归档 / 从 dsh 侧消失）
  // 的组连归属一起剔掉。与回收站清账同一道闸——基线未就绪（列表空）时什么都不做，
  // 否则冷启动会把用户全部的标签组当成空组清光。**进过回收站的会话仍算活着**：它还在
  // dsh 上，随时能还原回组里（判据写在 pure/sessionTagGroups.ts 的 pruneTagGroups）。
  useEffect(() => {
    const baselineReady = workspacePhase === 'ready' && list.ids.length > 0
    if (!baselineReady) return
    const alive = new Set(list.ids.filter((id) => !archived.has(id)))
    let next: TagGroupsFile | null = null
    for (const [workspaceId, bucket] of Object.entries(tagFile.workspaces)) {
      const pruned = pruneTagGroups(bucket, (sessionId) => alive.has(sessionId))
      if (pruned !== null) next = withTagBucket(next ?? tagFile, workspaceId, pruned)
    }
    if (next !== null) {
      setTagFile(next)
      saveTagGroups(next)
    }
  }, [tagFile, list.ids, workspacePhase, archivedSessionIds])

  // 排序 = 官方顺序，**唯一例外**是置顶项在这一层排最前（#98 定稿，`pinnedFirst`）。
  // #131 起这里不再有「最近更新」那一档：顺序只来自官方会话服务给的那一份。
  const withOrder = (sessions: readonly SessionNode[]): readonly SessionNode[] =>
    pinnedFirst(sessions, (node) => pinnedIds.has(node.id))
  // 分组过滤（只留归属该组的工作区）——侧栏恒为「按工作区」，所以这一条恒有意义。
  const filterActive = activeGroupId !== null && hasTreeGroup(groupsFile, activeGroupId)
  const groups = deriveGroups(list, workspaces, archivedSessionIds, pending, {
    expandedGroups: groupExpansion,
    recycled,
    currentFolders,
    ...(filterActive && activeGroupId !== null
      ? { workspaceFilter: (workspaceId: string) => workspaceMatchesGroup(groupsFile, workspaceId, activeGroupId) }
      : {}),
  })
  // #153：行尾计数第三项「未读」吃的是**客户端那份手动未读集合**（`unread` 键，与行首状态点、
  // 菜单里的「标为已读」同一份），不是官方「跑完还没被打开」的 `completed` 提醒。
  const activity = workspaceActivityCounts(list, workspaces, archivedSessionIds, pending, recycled, unreadIds)
  // 全部可见会话（官方顺序）。#131 起它不再喂「单列表」那一支渲染，只留给选择态的
  // id → 节点映射（见下面的 requestArchiveSelection）。
  const visibleNodes = deriveFlat(list, archivedSessionIds, pending, recycled)
  const recycleGroups = deriveRecycleGroups(list, workspaces, recycledIds)
  const selectedSet = new Set(selection)
  // #109 E7：当前工作区那一组排最前（其余保持官方顺序；未分组桶恒在最后）。
  const orderedGroups = currentWorkspaceFirst(groups)

  // #99 顶栏「折叠/展开全部」：可展开的分组 = 有会话的分组（工作区 / 未分组桶）。
  // 键集取**不过滤**的那一份推导（过滤态下也要能一次收起/展开全部工作区，与旧侧栏
  // 「折叠所有工作区」同义）。
  //
  // #108：这一次推导同时给出**每个分组的全部成员**（`expandedGroups` 给全量 = 折叠态
  // 不回灌进 `sessions`），组头三态全选要吃整组成员——收起着的工作区也得能一次勾满
  //（那正是「快速清走一个工作区里没用的会话」的用法），所以不能拿渲染用的 `groups`
  //（收起时 `sessions` 是空的）来数。
  // #109 复用同一份：菜单里的「归档该工作区全部会话」也要这个工作区的**全部**可见会话
  //（收起的分组照样能整块归档），所以 `recycled` 一并在这一份里给出来。
  // 这一份推导与「平铺」（#131 已退役的单列表模式）无关：它指的是**全部分组都展开**的
  // 那一份（名字里的 flat 是「摊平来看」，不是视图形态）。
  const flatGroups = deriveGroups(list, workspaces, archivedSessionIds, pending, {
    expandedGroups: [...workspaces.map((workspace) => workspace.workspaceId), UNGROUPED_KEY],
    recycled,
    currentFolders,
  })
  const expandableKeys = flatGroups.filter((group) => group.sessionCount > 0).map((group) => group.key)
  const groupMembers = new Map(flatGroups.map((group) => [group.key, group.sessions]))
  /** #109：某个分组（按树里的键）的全部可见会话——归档入口按它算资格与明细。 */
  const sessionsOfGroup = (key: string): readonly SessionNode[] => groupMembers.get(key) ?? []
  /**
   * 全部有会话的分组都收起了吗——决定顶栏那一枚显示方框横杠（折叠全部）还是方框十字
   * （展开全部）。
   *
   * **搜索态恒为 false**（#118 补的一刀，与旧侧栏 `computeAllCollapsed` 同一口径）：
   * 搜索把树体换成结果行、一个分组都不渲染，此刻分组各自的展开态既看不见、也不该由
   * 那一枚代言——它这一刻能发的只有「折叠所有工作区」。搜索之前正好全收起时，若不认
   * 这一条，按钮会显示方框十字（提示「展开所有工作区」），点下去却什么都没发生（结果
   * 区不因展开而变化），是个说不通的态。
   */
  const allCollapsed =
    trimmedQuery === '' && expandableKeys.length > 0 && expandableKeys.every((key) => !groupExpansion.includes(key))
  /** 已全收起 → 展开全部；否则收起全部（图标与提示在顶栏里随 `allCollapsed` 翻转）。 */
  const toggleCollapseAll = (): void => {
    setPrefs((prev) =>
      allCollapsed
        ? // 展开全部：有会话的分组一并展开；用户自己展开过的空分组照旧留在展开态
          //（旧写法的 `[...expandedGroups, ...expandableKeys]` 就是这个意思）。
          setGroupExpansion(prev, Object.fromEntries(expandableKeys.map((key) => [key, true])))
        : // 收起全部：整棵树的每一个分组都写成「显式收起」——不留旧记录（已消失的分组下次
          // 回来不该自己展开），也不给首开规则留把当前会话那一组重新展开的余地。
          { ...prev, groupExpansion: Object.fromEntries(flatGroups.map((group) => [group.key, false])) },
    )
  }

  // #99 单胶囊的计数口径 = **成员工作区数**（旧侧栏同款）：全部 = 工作区总数；
  // 某组 = 归属该组的工作区数。
  const groupDefs = treeGroupDefs(groupsFile)
  const groupCounts = new Map(
    groupDefs.map((def) => [def.id, workspaces.filter((workspace) => workspaceMatchesGroup(groupsFile, workspace.workspaceId, def.id)).length]),
  )

  // #139 成员清单的名单：**全部工作区**、顺序沿用树里的官方顺序（与树体同一份推导
  // `flatGroups`——它对全部工作区摊平、不带分组过滤，所以「当前正过滤着某个分组」时
  // 管理框里照样能看到并勾选全部工作区；未分组桶不是工作区，剔掉）。
  const memberRows = currentWorkspaceFirst(flatGroups)
    .filter((group) => group.workspaceId !== undefined)
    .map((group) => ({ id: group.workspaceId as string, label: group.label }))
  /** 某组当前的成员工作区 id——判定与上面的计数、列表过滤同一份 `workspaceMatchesGroup`。 */
  const groupMemberIds = (groupId: string): readonly string[] =>
    memberRows.filter((row) => workspaceMatchesGroup(groupsFile, row.id, groupId)).map((row) => row.id)

  // 建组 / 改名 / 删除的**唯一**落盘路径：两个入口（单胶囊下拉的「新建分组…」与
  // 「管理分组…」对话框）都走这里，校核是同一份纯函数（`treeGroups`），不会出现
  // 「界面放过、落盘被拒」的第二套判断。
  const applyGroupCreate = (name: string): 'empty' | 'duplicate' | null => {
    const result = createTreeGroup(groupsFile, name, newGroupId())
    if (!result.ok) return result.error
    // 刻意**不**把过滤切到新分组：刚建的分组还没有成员，切过去等于把树清空，
    // 用户接下来要做的「把工作区归到这个组」反而没地方点了。新分组出现在
    // 过滤条里，用户自己点它即可。
    writeGroups(result.file)
    return null
  }
  const applyGroupRename = (groupId: string, name: string): 'duplicate' | null => {
    const next = renameTreeGroup(groupsFile, groupId, name)
    if (next === null) return 'duplicate'
    writeGroups(next)
    return null
  }
  const applyGroupDelete = (groupId: string): void => {
    const next = deleteTreeGroup(groupsFile, groupId)
    if (next !== null) writeGroups(next)
    // 删掉的正是当前过滤的分组 → 过滤回落「全部」。
    setPrefs((prev) => (prev.activeGroupId === groupId ? { ...prev, activeGroupId: null } : prev))
  }

  /**
   * #155 拖组行换顺序：管理框交出的一份**完整顺序**在这里落盘。判定（未知 id、缺项、
   * 与现序一致）全在纯函数里（`reorderGroups`），所以「拖回原位」走不到 `writeGroups`
   * ——一次写入都不会发生。这条与前三条共用同一个落盘口（`writeGroups`），不多一条。
   */
  const applyGroupReorder = (groupIds: readonly string[]): void => {
    const next = reorderTreeGroups(groupsFile, groupIds)
    if (next !== null) writeGroups(next)
  }

  /**
   * 归属的增删：**唯一**的一条（工作区行菜单「分组…」的二级项与 #139 成员清单里的
   * 勾选都走它）。判定与落盘各只有一份：{@link toggleWorkspaceGroup} + `writeGroups`。
   */
  const toggleWorkspaceInGroup = (workspaceId: string, groupId: string): void => {
    writeGroups(toggleWorkspaceGroup(groupsFile, workspaceId, groupId))
  }
  /** 批量勾选 / 取消（成员清单的「全选 / 清空」）：折叠同一个纯函数，一次落盘。 */
  const setWorkspacesInGroup = (groupId: string, workspaceIds: readonly string[], member: boolean): void => {
    const next = setWorkspacesGroupMembership(groupsFile, workspaceIds, groupId, member)
    if (next !== null) writeGroups(next)
  }

  const toggleSelected = (sessionId: string): void => {
    setSelectionError(null)
    setSelection((prev) =>
      prev.includes(sessionId) ? prev.filter((id) => id !== sessionId) : [...prev, sessionId],
    )
  }

  /**
   * 进入选择态（#108 的入口 API 的落地）：清空上一轮勾选与错误。
   *
   * 只碰三个 setter（引用恒定的），所以订阅回调里调它不会随渲染换身份——订阅只在挂载
   * 时登记一次（见下面那个 effect）。
   */
  const enterSelection = (): void => {
    // #115：多选态下点行 = 勾选（不进改名），所以进多选时把行内编辑态收掉——
    // 两套「点行」语义不能同时挂着。
    setSessionEdit(null)
    setSelectMode(true)
    setSelection([])
    setSelectionError(null)
  }

  /** 退出选择态：清空选择与错误（选择态本身是纯视图态，不落盘）。 */
  const exitSelection = (): void => {
    setSelectMode(false)
    setSelection([])
    setSelectionError(null)
  }

  // 进入多选的入口 API（`selection.ts` 的 `selectionEntrySignal`）：顶部工具栏那一枚与
  // 会话行菜单的「选择多个」（本体在「菜单补全」那条）都调它，选择态只有这一个入口。
  useEffect(() => selectionEntrySignal.subscribe(() => enterSelection()), [])

  // #145：会话被另一个 dsh 进程占着写句柄时给一条能行动的提示（判据与订阅装在插件 apply 里，
  // 见 `workspaceTreePlugin.ts` 的 `watchOpenFailure`；这里只负责显示）。停留时长比动作回执长：
  // 这是一句要人行动的完整话，2.2 秒读不完。
  useEffect(() => onSessionOwnedElsewhere(() => flashTip(tr('session.ownedElsewhere'), 6000)), [tr])

  const errorText = (reason: unknown): string => (reason instanceof Error ? reason.message : String(reason))

  /**
   * #110：动作失败的**可见反馈**。归档 / 分叉 / 多开三条线原来或不声不响地吞掉、
   * 或只往控制台写一行（用户看不见）；统一飘一条提示——工具就是 #103 立起的
   * `flashTip`（可复用、2.2 秒自动消失，任何座位都能发），所以这里只把原因并进
   * 文案键，不另造一套反馈通道。
   */
  const reportFailure = (key: string, reason: unknown): void => {
    flashTip(tr(key, { message: errorText(reason) }))
  }
  /** 分叉一行：成功后插件自己会打开子会话，这里只管失败的可见反馈。 */
  const forkRow = (sessionId: string): void => {
    void forkSession(sessionId).catch((reason: unknown) => reportFailure('fork.failed', reason))
  }

  /**
   * #176：添加/创建工作区（＋ 菜单两项）在树这一层的收尾——两条入口共用这一份，
   * 所以「添加成功之后要发生什么」只有一个地方写着。
   *
   * 三件事：
   * 1. **开这个工作区的新会话**（用户拍板的新行为）。走宿主能力口
   *    `newSessionInWorkspace`；`undefined` = 这个宿主没有这一步（官方 web 侧，
   *    那一端「添加完之后建不建会话」归官方自己的 directory-flow）——那就只添加、
   *    不开会话，**一声不响也不报错**（这正是不注入它的含义）。
   * 2. **记下刚加的是哪一个**：分组过滤把那一行挡住时树里要有一条能行动的提示
   *    （提示本身在渲染那一步按当前过滤态决定出不出，见 `addNoticeFor`）。
   * 3. **失败要说出来**（#110 的规矩）：`.catch(() => {})` 那种静默是这次要清掉的东西
   *    ——用户点完「选择已有文件夹…」什么都没发生，连失败都看不见（#176 的现场）。
   *    取消（`null`）不算失败：用户自己关掉的原生对话框，静默即可。
   */
  const addWorkspace = (run: () => Promise<AddedWorkspace | null>): void => {
    setAddNotice(null)
    void run().then(
      (added) => {
        if (added === null) return
        setAddNotice({ workspaceId: added.workspaceId, ...(added.title === undefined ? {} : { title: added.title }) })
        if (newSessionInWorkspace === undefined) return
        void newSessionInWorkspace(added.workspaceId).catch((reason: unknown) => reportFailure('workspace.newSessionFailed', reason))
      },
      (reason: unknown) => reportFailure('workspace.addFailed', reason),
    )
  }
  /** 「在新标签页打开」一行；宿主没有这条能力时整个动作不注入（菜单项也不出现）。 */
  const openRowInNewTab =
    openInNewTab === undefined
      ? undefined
      : (sessionId: string): void => {
          void openInNewTab(sessionId).catch((reason: unknown) => reportFailure('openInNewTab.failed', reason))
        }

  /**
   * #109：把一段文本写进剪贴板 + 飘一条回执。
   *
   * 剪贴板用**官方 primitives 的 `writeClipboard`**（带 execCommand 回退，webview 里比裸
   * `navigator.clipboard` 稳），不走宿主能力口——两端（VS Code 侧与官方 web 侧）浏览器
   * 本来就能写剪贴板，绕一趟宿主反而多一条会失败的路；回执用我们自己的飘提示，两端一致
   * （旧侧栏用的是宿主消息框，官方 web 侧没有那种消息框）。
   */
  const copyText = (text: string, done: string): void => {
    writeClipboard(text).then(
      (ok) => flashTip(ok ? done : tr('copy.failed')),
      () => flashTip(tr('copy.failed')),
    )
  }

  /** 「复制引用」：会话 mention 文本（`pure/sessionMention` 的官方语法，粘贴进输入框即成为引用）。 */
  const copySessionReference = (node: SessionNode): void => {
    copyText(formatSessionMention(displayTitle(node, tr), node.id), tr('copied.sessionRef'))
  }

  /** 「复制路径」：目录路径原样。 */
  const copyWorkspacePath = (group: GroupNode): void => {
    if (group.cwd === undefined) return
    copyText(group.cwd, tr('copied.path'))
  }

  /**
   * 「复制文件夹引用」：`@路径` 的提示词语法。格式化走 `pure/fileReference` 的
   * `formatFileMention`（官方 dsh-file-reference grammar 的移植件，含空格时自动加引号），
   * 不另写一份拼接；返回 undefined = 这个路径没法安全表示成引用（内嵌引号/控制字符），
   * 那就什么都不复制（旧侧栏的 inline 版本在那种路径上会产出坏 token）。
   */
  const copyWorkspaceFolderReference = (group: GroupNode): void => {
    if (group.cwd === undefined) return
    const text = formatFileMention({ path: group.cwd, kind: 'directory' })
    if (text === undefined) return
    copyText(text, tr('copied.folderRef'))
  }

  /** #109：在宿主编辑器窗口里打开这个工作区（hover 的「在 VS Code 打开」/ 右键的「在新窗口打开」）。 */
  const openWorkspaceInEditor = (group: GroupNode, newWindow: boolean): void => {
    if (group.cwd === undefined) return
    openWorkspaceFolder?.(group.cwd, { newWindow })
  }

  /** #109：在这个工作区目录上开一个集成终端。 */
  const openWorkspaceInTerminal = (group: GroupNode): void => {
    if (group.cwd === undefined) return
    openWorkspaceTerminal?.(group.cwd)
  }


  /** 一条会话的资格事实（会话快照 + 置顶/未读两份 id 集合，见 pure/sessionEligibility.ts）。 */
  const eligibilityOf = (node: SessionNode): SessionEligibilityFacts => ({
    pinned: pinnedIds.has(node.id),
    unread: unreadIds.has(node.id),
    running: node.running,
    runningSubagentCount: node.runningSubagentCount,
    ...(node.pendingInteraction === undefined ? {} : { pendingInteraction: node.pendingInteraction }),
  })

  // -------------------------------------------------------------------------
  // 组头三态全选（#108）
  //
  // 判定与方向都在纯模块里（`groupSelectionState` / `groupSelectionToggle`），这里只把
  // 「这一组是谁」和「勾/清」接上——行内勾选框、行菜单的两项动作、批量动作吃的是**同一份**
  // 资格判定（`canRecycle`），所以组头勾上的那些正好是批量动作真会动的那些。
  // -------------------------------------------------------------------------
  /** 这一组能否被勾选（置顶的被挡住——它既不能进回收站也不能归档）。 */
  const isSelectableNode = (node: SessionNode): boolean => canRecycle(eligibilityOf(node))
  const isSelectedNode = (node: SessionNode): boolean => selectedSet.has(node.id)
  /** 这一组的三态（`fallback` = 渲染用的那一份，折叠态下是空数组）。 */
  const groupStateOf = (members: readonly SessionNode[]): GroupSelectionState =>
    groupSelectionState(members, isSelectableNode, isSelectedNode)
  /**
   * 组头三态框的全部输入，一次算好（渲染里不再重复查表）。
   *
   * 成员取**整组**（`groupMembers`，不看折叠态）：收起着的工作区也得能一次勾满，那正是
   * 「快速清走一个工作区里没用的会话」的用法。
   */
  const groupCheck = (
    key: string,
    fallback: readonly SessionNode[],
  ): {
    state: GroupSelectionState
    tip: string | undefined
    disabled: boolean
    onToggleSelect: () => void
  } => {
    const members = groupMembers.get(key) ?? fallback
    return {
      state: groupStateOf(members),
      tip: groupCheckTip(members),
      // 一条都勾不上（整组都是置顶）：框画灰，点了也不动。
      disabled: members.every((node) => !isSelectableNode(node)),
      onToggleSelect: () => toggleGroupSelected(members),
    }
  }
  /** 点组头三态框：`none` / `some` → 补齐到本组最大值；`all` → 取消全选本组。 */
  const toggleGroupSelected = (members: readonly SessionNode[]): void => {
    if (busy) return
    const next = groupSelectionToggle(members, isSelectableNode, isSelectedNode, (node) => node.id)
    if (next.ids.length === 0) return
    setSelectionError(null)
    setSelection((prev) => {
      const chosen = new Set(prev)
      for (const id of next.ids) {
        if (next.select) chosen.add(id)
        else chosen.delete(id)
      }
      return [...chosen]
    })
  }
  /**
   * 组头三态框的悬停原因：为什么这一组选不满（有置顶成员时最满只能 `some`）。
   * 没有置顶成员时不给提示——框的行为与眼睛看到的一致，不需要解释。
   */
  const groupCheckTip = (members: readonly SessionNode[]): string | undefined => {
    const blocked = members.filter((node) => !isSelectableNode(node)).length
    return blocked === 0 ? undefined : tr('select.group.pinned', { n: blocked })
  }

  /**
   * 移入回收站（#103）：**只写我们自己的集合**，不动 dsh 侧，所以立即执行 + 飘一条
   * 回执；批量语境（选择态）下顺带结束选择态。
   */
  const moveToRecycleBin = (sessionIds: readonly string[], options: { exitSelection?: boolean } = {}): void => {
    if (busy || sessionIds.length === 0) return
    setBusy(true)
    setSelectionError(null)
    setRecycleError(null)
    recycleBinActions.move(sessionIds).then(
      (outcome) => {
        setBusy(false)
        if (outcome.failed.length > 0) {
          setSelectionError(tr('recycle.moveFailed', { n: outcome.failed.length }))
          flashTip(tr('recycle.moveFailed', { n: outcome.failed.length }))
          return
        }
        flashTip(tr('recycle.moved', { n: outcome.done.length }))
        if (options.exitSelection === true) exitSelection()
      },
      (reason: unknown) => {
        setBusy(false)
        setSelectionError(errorText(reason))
        flashTip(errorText(reason))
      },
    )
  }

  /** 还原（单个或全部）：本地可逆动作，同样只写我们自己的集合。 */
  const restoreFromRecycle = (sessionIds: readonly string[]): void => {
    if (busy || sessionIds.length === 0) return
    setBusy(true)
    setRecycleError(null)
    recycleBinActions.restore(sessionIds).then(
      (outcome) => {
        setBusy(false)
        if (outcome.failed.length > 0) setRecycleError(tr('recycle.restoreFailed', { n: outcome.failed.length }))
        else flashTip(tr('recycle.restored', { n: outcome.done.length }))
      },
      (reason: unknown) => {
        setBusy(false)
        setRecycleError(tr('recycle.failed', { message: errorText(reason) }))
      },
    )
  }

  /** 打开归档确认弹窗（归档 = 删除，不可逆，所以任何入口都先过它）。 */
  const openArchive = (request: ArchiveRequest): void => {
    setArchiveError(null)
    setArchiveRequest(request)
  }

  /** 确认归档：逐个走官方 `archiveSession`（动作本体在纯模块里，见 recycleActions.ts）。 */
  const confirmArchive = (): void => {
    const target = archiveRequest
    if (target === null || archiveBusy) return
    const sessionIds = target.blocks.flatMap((block) => block.sessions.map((node) => node.id))
    setArchiveBusy(true)
    setArchiveError(null)
    recycleBinActions.archive(sessionIds).then(
      (outcome) => {
        setArchiveBusy(false)
        // #108：归档成功的那几条从勾选里划掉——弹窗后面留着的是**没做成的**那些，
        // 用户直接再点一次「确认」就是重试失败项，不会把已归档的再送一遍。
        const done = new Set(outcome.done)
        if (done.size > 0) setSelection((prev) => prev.filter((id) => !done.has(id)))
        if (outcome.failed.length > 0) {
          const message = tr('archive.failed', { n: outcome.failed.length })
          setArchiveError(message)
          // #110：弹窗里那一行之外再飘一条——关掉弹窗之后就只剩日志了，用户看不见。
          flashTip(message)
          return
        }
        setArchiveRequest(null)
        flashTip(tr('archive.done', { n: outcome.done.length }))
      },
      (reason: unknown) => {
        setArchiveBusy(false)
        setArchiveError(errorText(reason))
        // #110：归档失败必须可见（原来只有弹窗内联红字）。
        reportFailure('archive.failed.reason', reason)
      },
    )
  }

  /** 一行会话的归档请求：资格判定先过滤（判定见 pure/sessionEligibility.ts），不合格就不开弹窗。 */
  const requestArchiveSession = (node: SessionNode): void => {
    if (cannotArchiveReason(eligibilityOf(node)) !== null) return
    openArchive({ blocks: groupSessionNodes(list, workspaces, [node.id]), skipped: 0, kind: 'archive' })
  }

  /** 回收站里某一条的「永久归档」。 */
  const requestArchiveFromBin = (sessionId: string): void => {
    openArchive({ blocks: groupSessionNodes(list, workspaces, [sessionId]), skipped: 0, kind: 'archive' })
  }

  /**
   * #109：归档**一整个工作区**（或未分组桶）的全部会话。
   *
   * 复用 #103 那份资格判定与确认弹窗（`partitionArchivable` + `ArchiveSessionsModal`）：
   * 置顶 / 运行中 / 未读 / 待交互的那些进 `skipped`（弹窗里写明跳过数），一条都不可归档
   * 时不开弹窗（菜单项本身按同一个数禁用）。会话列表取**全部展开**的那一份推导——分组
   * 收起时 `sessions` 是空的，用收起态那份会让收起的工作区「一条都归档不了」。
   */
  const requestArchiveGroup = (key: string): void => {
    const nodes = sessionsOfGroup(key)
    const partition = partitionArchivable(nodes.map((node) => ({ node, ...eligibilityOf(node) })))
    if (partition.ready.length === 0) return
    openArchive({
      blocks: groupSessionNodes(list, workspaces, partition.ready.map((entry) => entry.node.id)),
      skipped: partition.skipped.length,
      kind: 'archive',
    })
  }

  /** 某个分组里有没有够格归档的会话（工作区行菜单那一项的禁用态）。 */
  const hasArchivable = (key: string): boolean =>
    sessionsOfGroup(key).some((node) => cannotArchiveReason(eligibilityOf(node)) === null)

  /** 清空回收站 = 把里面每一条都永久归档（不可逆，先过确认弹窗）。 */
  const requestEmptyBin = (): void => {
    if (recycledIds.length === 0) return
    openArchive({ blocks: recycleGroups, skipped: 0, kind: 'emptyBin' })
  }

  /**
   * 一批会话的归档请求：资格判定先切一遍，可归档的进明细、其余的进跳过数；一条都
   * 不可归档时不开弹窗（调用方的菜单项也按同一个数禁用）。两个入口共用它——选择态
   * 的「批量归档」与标签组的「整组归档」（#107）——所以「哪些会被跳过」两边口径一致。
   */
  const requestArchiveNodes = (nodes: readonly SessionNode[]): void => {
    if (nodes.length === 0) return
    const partition = partitionArchivable(nodes.map((node) => ({ node, ...eligibilityOf(node) })))
    if (partition.ready.length === 0) return
    openArchive({
      blocks: groupSessionNodes(list, workspaces, partition.ready.map((entry) => entry.node.id)),
      skipped: partition.skipped.length,
      kind: 'archive',
    })
  }

  /** 批量归档（选择态操作条）。 */
  const requestArchiveSelection = (): void => {
    if (selection.length === 0) return
    requestArchiveNodes(
      selection.flatMap((id) => {
        const node = visibleNodes.find((candidate) => candidate.id === id)
        return node === undefined ? [] : [node]
      }),
    )
  }

  // -------------------------------------------------------------------------
  // #107 会话标签组：动作（判定与状态变更全走 pure/sessionTagGroups.ts）
  // -------------------------------------------------------------------------

  /** 翻一个组的折叠态（纯视图态 → 随视图偏好落客户端存储，不进 tags.json）。 */
  const toggleTagCollapsed = (groupKey: string, tagId: string): void => {
    const key = tagCollapseKey(groupKey, tagId)
    setPrefs((prev) => ({
      ...prev,
      tagCollapsed: prev.tagCollapsed.includes(key)
        ? prev.tagCollapsed.filter((candidate) => candidate !== key)
        : [...prev.tagCollapsed, key],
    }))
  }

  const expandTag = (groupKey: string, tagId: string): void => {
    const key = tagCollapseKey(groupKey, tagId)
    setPrefs((prev) =>
      prev.tagCollapsed.includes(key) ? { ...prev, tagCollapsed: prev.tagCollapsed.filter((candidate) => candidate !== key) } : prev,
    )
  }

  /**
   * 把一条会话归到某组（拖进组块走这里）。**只接同一个工作区里的会话**：桶是
   * per-workspace 的，把别的工作区的会话拖进来会把归属写进另一个桶，那条会话在
   * 自己的工作区里就看不见了。拖进折叠的组顺带把它展开——让用户看到刚拖进来的那条
   *（折叠是偏好，要再折叠一次才算用户的显式意图）。
   */
  const assignTagGroup = (groupKey: string, sessionId: string, tagId: string): void => {
    if (groupKeyOfSession(sessionId) !== groupKey) return
    applyTagBucket(groupKey, setSessionTagGroup(tagBucket(groupKey), sessionId, tagId))
    expandTag(groupKey, tagId)
  }

  /** 拖到组外 = 移出标签组（本来就没归组则什么都不做）。 */
  const moveOutOfTag = (groupKey: string, sessionId: string): void => {
    const bucket = tagBucket(groupKey)
    if (bucket.sessionTags[sessionId] === undefined) return
    applyTagBucket(groupKey, setSessionTagGroup(bucket, sessionId, null))
  }

  /** 拖 pill 换组序：先摘下源组，再插到目标组的前/后（旧侧栏同一算法）。 */
  const reorderTag = (groupKey: string, sourceId: string, targetId: string, before: boolean): void => {
    const bucket = tagBucket(groupKey)
    const ids = bucket.tags.map((tag) => tag.id)
    if (!ids.includes(sourceId) || !ids.includes(targetId)) return
    ids.splice(ids.indexOf(sourceId), 1)
    ids.splice(ids.indexOf(targetId) + (before ? 0 : 1), 0, sourceId)
    applyTagBucket(groupKey, reorderTagGroups(bucket, ids))
  }

  /** 组 pill 菜单的动作（菜单项由 `tagGroupMenuItems` 树出，这里只按 id 派发）。 */
  const onTagMenuSelect = (groupKey: string, def: TagGroupDef, members: readonly SessionNode[], id: string): void => {
    if (id === 'tag-new-session') {
      // 未分组桶没有工作区，开不出会话（那一桶里的会话来自已删除的工作区）。
      if (groupKey === UNGROUPED_KEY) return
      // 先记下「这个新会话该归哪个组」，会话开出来（`startSession` 会把它选中）之后
      // 由下面那个 effect 归组——`startSession` 只回 void，拿不到 id。
      setTagNewSession({ groupKey, tagId: def.id })
      startSession(groupKey)
      return
    }
    if (id === 'tag-archive') {
      requestArchiveNodes(members)
      return
    }
    if (id === 'tag-recycle') {
      // 整组移入回收站：本地可逆，立即执行；置顶的不够格（判定与行菜单同一份）。
      const eligible = members
        .filter((node) => cannotRecycleReason(eligibilityOf(node)) === null)
        .map((node) => node.id)
      moveToRecycleBin(eligible)
      return
    }
    if (id === 'tag-ungroup') {
      applyTagBucket(groupKey, setSessionsTagGroup(tagBucket(groupKey), members.map((node) => node.id), null))
      return
    }
    if (id === 'tag-rename') {
      setTagRename({ groupKey, id: def.id, name: def.name })
      return
    }
    if (id === 'tag-delete') {
      setTagDelete({ groupKey, id: def.id, name: def.name })
      return
    }
    if (id.startsWith('tag-color-')) {
      applyTagBucket(groupKey, updateTagGroup(tagBucket(groupKey), def.id, { color: id.slice('tag-color-'.length) as TagColor }))
    }
  }

  /**
   * 行菜单「标签组」一节的项（#107）：本工作区的组 + 「不归入标签组」+「新建标签组…」。
   * 恒渲染这一节（一个组都没有时也渲染）：不然新建第一个组没有入口——拖拽只能把会话
   * 拖进**已经存在**的组。
   */
  const tagItemsFor = (sessionId: string): { items: unknown[]; selectedIds: string[] } => {
    const groupKey = groupKeyOfSession(sessionId)
    const bucket = tagBucket(groupKey)
    const current = bucket.sessionTags[sessionId]
    // 文案包一层带标记的 span：菜单项的类名是官方哈希，验证套件与样式都不该认它
    //（与行菜单其它项同一做法，见 rows.ts 的 sessionMenuItem）。
    // #109：这一节的项住在会话行菜单「移到分组…」的**就地展开**里（不再是菜单末尾的一节），
    // 所以**不带分隔线与小标题**（#109 的会话行菜单没有分隔线）；文字列由 rows.ts 的
    // `.dshOneTree_submenuItem` 标记 + styles.ts 那条规则一起定（#174 起与父项文字严格对齐，
    // 即不再额外缩进）。`data-dshone-tree-item` 标记照旧（验证套件按它认项）。
    const label = (suffix: string, text: string): unknown =>
      h('span', { 'data-dshone-tree-item': `${TAG_MENU_PREFIX}${suffix}` }, text)
    return {
      items: [
        ...bucket.tags.map((tag) => ({
          id: `${TAG_MENU_PREFIX}${tag.id}`,
          label: label(tag.id, tag.name),
          icon: h(TagColorSwatch, { color: tag.color }),
        })),
        { id: `${TAG_MENU_PREFIX}__none`, label: label('__none', tr('tag.none')) },
        { id: `${TAG_MENU_PREFIX}__new`, label: label('__new', tr('tag.new')) },
      ],
      selectedIds: [current === undefined ? `${TAG_MENU_PREFIX}__none` : `${TAG_MENU_PREFIX}${current}`],
    }
  }

  /** 行菜单里选中一个标签组项。 */
  const onRowTagSelect = (sessionId: string, id: string): void => {
    const groupKey = groupKeyOfSession(sessionId)
    if (id === '__new') {
      setTagCreate({ groupKey, sessionId })
      return
    }
    applyTagBucket(groupKey, setSessionTagGroup(tagBucket(groupKey), sessionId, id === '__none' ? null : id))
  }

  /**
   * 新建标签组：建完立刻把触发它的那条会话归进去——组只与成员一起出现，先建一个
   * 空组等于给用户一个看不见、也点不到的空壳（空组处理见 pure/sessionTagGroups.ts）。
   */
  const createTagFrom = (target: { groupKey: string; sessionId: string }, name: string, color: TagColor): void => {
    const created = createTagGroup(tagBucket(target.groupKey), name, newTagGroupId(), color)
    if (!created.ok) return
    const assigned = setSessionTagGroup(created.bucket, target.sessionId, created.id) ?? created.bucket
    writeTags(withTagBucket(tagFile, target.groupKey, assigned))
    setTagCreate(null)
    flashTip(tr('tag.created', { name: name.trim() }))
  }

  // 底部回收站入口行发来的请求（同一 bundle 内的模块级信号，见 recycleEntry.ts 的文件头）：
  // 开 / 关抽屉、清空（不可逆，走确认弹窗）、全部还原（本地可逆，直接执行）。
  useEffect(() => {
    return recycleEntrySignal.subscribe((request) => {
      if (request === 'open') {
        setRecycleDrawerOpen(true)
        setRecycleError(null)
        return
      }
      if (request === 'close') {
        setRecycleDrawerOpen(false)
        return
      }
      if (request === 'restoreAll') {
        restoreFromRecycle(recycledIds)
        return
      }
      requestEmptyBin()
    })
  }, [recycledIds, recycleGroups, busy])

  // 选择态操作条：批量移入回收站（立即执行 + 飘提示 + 结束选择态）/ 批量归档（确认弹窗）。
  const moveSelectedToRecycleBin = (): void => moveToRecycleBin(selection, { exitSelection: true })


  const workspaceLabelOf = (sessionId: string): string => {
    const owner = workspaces.find((workspace) => workspace.sessionIds.includes(sessionId))
    return owner === undefined ? '' : owner.title
  }
  const searchRows = ((): readonly SessionNode[] => {
    if (trimmedQuery === '') return []
    const needle = trimmedQuery.toLowerCase()
    // 官方 `deriveSearchResults` 与分组那一支共用同一个 `sessionNode`（见
    // pure/workspaceTreeView.ts 的说明），所以这里也必须走它——自己拼节点会漏掉
    // `pendingInteraction` 与 `runningSubagentCount` 两格，搜索结果行的状态点于是
    // 与树里的对不上（#146 审计查出来的「官方有点、我们没有」）。
    const searchDescendants = indexSubagentDescendants(list.byId)
    const nodeOf = (id: string): SessionNode | undefined => {
      const summary = list.byId[id]
      return summary === undefined ? undefined : sessionNode(summary, searchDescendants, pending)
    }
    const local = list.ids
      .flatMap((id) => {
        const summary = list.byId[id]
        if (summary === undefined || summary.origin === 'subagent' || archived.has(id)) return []
        if (summary.blank && id !== list.current) return []
        const matches = `${summary.displayTitle ?? summary.title ?? ''} ${workspaceLabelOf(id)}`.toLowerCase().includes(needle)
        const node = matches ? nodeOf(id) : undefined
        return node === undefined ? [] : [node]
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
    const seen = new Set(local.map((row) => row.id))
    const extra: SessionNode[] = []
    for (const item of content.items) {
      if (seen.has(item.id)) continue
      const node = nodeOf(item.id)
      if (node === undefined) continue
      seen.add(item.id)
      extra.push(node)
    }
    return [...local, ...extra].slice(0, searchResultLimit)
  })()
  const snippetOf = (sessionId: string): string | undefined =>
    content.items.find((item) => item.id === sessionId)?.snippet

  /**
   * #110：空态 / 加载态一块——同一外形（`.dshOneTree_empty`），`data-dshone-tree-empty`
   * 写明是哪一种，验证套件与样式都按它认。`lines` 每项自成一行（块级），可选入口按钮
   * 跟在最后一行下面。
   */
  const emptyNotice = (kind: string, lines: readonly unknown[], action?: unknown): unknown =>
    h(
      'div',
      { className: 'dshOneTree_empty', 'data-dshone-tree': 'empty', 'data-dshone-tree-empty': kind },
      ...lines.map((line, index) => h('div', { className: 'dshOneTree_emptyLine', key: `line-${String(index)}` }, line)),
      ...(action === undefined ? [] : [action]),
    )
  /** 零工作区空态：文案指向上方的 ＋（旧侧栏同款说法），不改任何入口位置。 */
  const noWorkspacesNotice = emptyNotice('no-workspaces', [tr('empty.noWorkspaces')])
  /** 分组无成员空态：专属文案 + 「管理分组…」入口（去那儿给工作区打标/建组）。 */
  const groupMembersNotice = emptyNotice(
    'group-members',
    [tr('empty.groupMembers'), tr('empty.groupMembers.hint')],
    h(
      'button',
      {
        type: 'button',
        className: 'dshOneTree_emptyAction',
        'data-dshone-tree-action': 'group-manage-empty',
        onClick: () => setManageGroupsOpen(true),
      },
      tr('group.manage'),
    ),
  )

  /**
   * #176：刚添加的工作区**被分组过滤挡住**时要在树里给的那条提示（用户原话：
   * 「可能后面找不到这个工作区也不太好，最好是创建的时候就提示」）。
   *
   * 为什么在渲染这一步判、而不是在添加成功那一刻判：挡不挡得住是**当前过滤态**的事
   * ——用户在提示里点「查看全部」（`activeGroupId` 归 null）或自己切到别的分组之后，
   * 这条提示该自己消失；把它钉在「添加那一刻的过滤态」上就会留下一条已经过期的提示。
   * 所以这里只由 `addNotice`（加了哪个）+ 现成的过滤判据（`filterActive` 与
   * `workspaceMatchesGroup`，与树体过滤同一份纯函数）算出来，**不写任何持久状态**。
   *
   * 名字的取法：添加时带回的名字优先，其次从工作区快照里找（名字的权威是 dsh 的
   * 工作区注册表），最后退回 id——文案里永远有东西可指。
   */
  const addNoticeFor = ((): { workspaceId: string; name: string } | null => {
    if (addNotice === null || !filterActive || activeGroupId === null) return null
    if (workspaceMatchesGroup(groupsFile, addNotice.workspaceId, activeGroupId)) return null
    const name =
      addNotice.title ??
      workspaces.find((workspace) => workspace.workspaceId === addNotice.workspaceId)?.title ??
      addNotice.workspaceId
    return { workspaceId: addNotice.workspaceId, name }
  })()

  /**
   * #115 行内改名：这一行在编辑态时要多吃的 props（不在编辑态就一个都不给）。
   *
   * 编辑态是**一行的事**（`sessionEdit.id`），所以按 id 判；会话行那一侧只有这一个
   * 调用点，不留第二套接线。
   */
  const rowRenameProps = (row: SessionNode): Record<string, unknown> =>
    sessionEdit !== null && sessionEdit.id === row.id
      ? {
          renaming: true,
          renameDraft: sessionEdit.draft,
          renameSelection: editSelection.current,
          onRenameDraft: updateRowRenameDraft,
          onRenameCommit: commitRowRename,
          onRenameCancel: cancelRowRename,
        }
      : {}

  /**
   * #107：树里一条会话行的 props（组内行与未归组行共用同一份）。
   *
   * 与「搜索结果行」那一份的差别都在标签组上：行**可拖**（拖进组块入组、拖到组外移出），
   * 行菜单多一节「标签组」（选组 / 不归入 / 新建）。搜索结果行不在任何组块里，没有落点，
   * 拖拽也就没有意义。
   *
   * #110 起分叉与多开都走 `forkRow` / `openRowInNewTab`（失败要飘一行可见反馈），
   * 两条路径共用同一份包装。
   */
  const groupedRowProps = (row: SessionNode): Record<string, unknown> => {
    const section = tagItemsFor(row.id)
    return {
      node: row,
      ...(list.current === undefined ? {} : { currentId: list.current }),
      now,
      hoverCard,
      tr,
      selectMode,
      selected: selectedSet.has(row.id),
      pinned: pinnedIds.has(row.id),
      unread: unreadIds.has(row.id),
      tagItems: section.items,
      tagSelectedIds: section.selectedIds,
      onTagSelect: (id: string) => onRowTagSelect(row.id, id),
      dragProps: sessionDragProps(row.id),
      onToggleSelect: () => toggleSelected(row.id),
      onOpen: () => openSessionClearingUnread(row.id),
      // #115/#121：点「当前会话」那一行 = 请求就地改名；树层先问宿主这条会话是不是真的
      // 开在面板里（开着就地改名，没开按打开处理，见 activateSessionRow）。
      onCurrentRowClick: () => activateSessionRow(row),
      ...rowRenameProps(row),
      onRename: (title: string) => setSessionRenameTarget({ id: row.id, title }),
      onFork: () => forkRow(row.id),
      onMoveToRecycleBin: () => moveToRecycleBin([row.id]),
      onArchive: () => requestArchiveSession(row),
      onTogglePin: () => togglePin(row.id),
      onToggleUnread: () => toggleUnread(row.id),
      // #109：菜单里的「选择多个」与「复制引用」（两枚都只在这一层接线，动作本体在树层）。
      onSelectMultiple: enterSelection,
      onCopyReference: () => copySessionReference(row),
      onOpenInNewTab: openRowInNewTab === undefined ? undefined : () => openRowInNewTab(row.id),
    }
  }

  const treeBody =
    trimmedQuery !== ''
      ? searchRows.length > 0
        ? h(
            'div',
            { className: 'dshOneTree_searchTree', role: 'tree', 'aria-label': tr('search.results.aria'), 'data-dshone-tree': 'search' },
            searchRows.map((row) =>
              h(SearchResultRow, {
                key: row.id,
                node: row,
                workspaceLabel: workspaceLabelOf(row.id),
                ...(snippetOf(row.id) === undefined ? {} : { snippet: snippetOf(row.id) }),
                // #152：命中高亮按当前查询串标（标题 / 工作区名 / 片段三处）。
                query: trimmedQuery,
                // #108（C8）：选择态下搜索结果行同样可勾选——`selected` 随态换义
                //（非选择态 = 当前会话，选择态 = 已勾选），与树里的会话行同一口径。
                selectMode,
                selected: selectMode ? selectedSet.has(row.id) : row.id === list.current,
                pinned: pinnedIds.has(row.id),
                unread: unreadIds.has(row.id),
                tr,
                onOpen: () => openSessionClearingUnread(row.id),
                onToggleSelect: () => toggleSelected(row.id),
              }),
            ),
          )
        : content.pending
          ? h('div', { className: 'dshOneTree_searchStatus' }, tr('search.pending'))
          : h(
              'div',
              { className: 'dshOneTree_searchStatus' },
              content.failed ? tr('search.unavailable') : tr('search.noMatches'),
            )
      : h(
            'div',
            { role: 'tree', 'data-dshone-tree': 'groups' },
            orderedGroups.map((group) => {
              const split = splitByTagGroups(
                group.sessions,
                tagBucket(group.key),
                (node) => pinnedIds.has(node.id),
              )
              // #108：组头三态全选（成员取整组，不看折叠态——收着的组也能一次勾满）。
              const check = groupCheck(group.key, group.sessions)
              return h(
                'div',
                {
                  className: 'dshOneTree_groupSection',
                  key: group.key,
                  'data-dshone-group-key': group.key,
                  // #107：拖到组外（工作区行 / 未归组的空处）= 移出标签组。
                  ...ungroupDropZone((sessionId: string) => moveOutOfTag(group.key, sessionId)),
                },
                h(ProjectRow, {
                  group,
                  tr,
                  expanded: groupExpansion.includes(group.key),
                  hoverCard,
                  ...(activity.get(group.key) === undefined ? {} : { counts: activity.get(group.key) as ActivityCounts }),
                  groups: treeGroupDefs(groupsFile),
                  memberOf: group.workspaceId === undefined ? [] : workspaceGroupIds(groupsFile, group.workspaceId),
                  selectMode,
                  checkState: check.state,
                  ...(check.tip === undefined ? {} : { checkTip: check.tip }),
                  checkDisabled: check.disabled,
                  onToggleSelect: check.onToggleSelect,
                  shellName,
                  canArchiveAll: hasArchivable(group.key),
                  onToggle: () => setPrefs((prev) => toggleGroupExpansion(prev, group.key)),
                  onCreate: () => startSession(group.workspaceId),
                  // #109 工作区行的三个宿主动作（能力口缺哪条哪枚按钮/菜单项就不出现）。
                  onOpenTerminal: openWorkspaceTerminal === undefined ? undefined : () => openWorkspaceInTerminal(group),
                  onOpenFolder: openWorkspaceFolder === undefined ? undefined : (options: { newWindow: boolean }) => openWorkspaceInEditor(group, options.newWindow),
                  onArchiveAll: () => requestArchiveGroup(group.key),
                  onCopyFolderRef: () => copyWorkspaceFolderReference(group),
                  onCopyPath: () => copyWorkspacePath(group),
                  onToggleGroup: (groupId: string) => {
                    if (group.workspaceId === undefined) return
                    toggleWorkspaceInGroup(group.workspaceId, groupId)
                  },
                  ...(group.workspaceId === undefined
                    ? {}
                    : {
                        onRename: () => setRenameTarget({ workspaceId: group.workspaceId as string, title: group.label }),
                        onDelete: () => setDeleteTarget({ workspaceId: group.workspaceId as string, title: group.label }),
                      }),
                }),
                // #81 功能 6：展开的分组把它的会话全列出来，不再截到 5 行。
                // #107：先按标签组切块（组内 = 组内置顶项先、其余官方顺序），每个组块
                // 是一段「pill 组头 + 贯穿竖线 + 缩进行」，没归组的行殿后、平铺。
                ...split.blocks.map((block) =>
                  h(TagGroupBlock, {
                    key: `tag:${block.def.id}`,
                    groupKey: group.key,
                    def: block.def,
                    collapsed: prefs.tagCollapsed.includes(tagCollapseKey(group.key, block.def.id)),
                    // 折叠计数按组内全部会话数（折叠时行不渲染，但计数还得准）。
                    sessions: block.sessions,
                    isUnread: (sessionId: string) => unreadIds.has(sessionId),
                    menuItems: tagGroupMenuItems({
                      name: block.def.name,
                      color: block.def.color,
                      total: block.sessions.length,
                      archivable: block.sessions.filter((node) => cannotArchiveReason(eligibilityOf(node)) === null).length,
                      recyclable: block.sessions.filter((node) => cannotRecycleReason(eligibilityOf(node)) === null).length,
                      tr,
                    }),
                    menuSelectedIds: [`tag-color-${block.def.color}`],
                    onMenuSelect: (id: string) => onTagMenuSelect(group.key, block.def, block.sessions, id),
                    onToggleCollapse: () => toggleTagCollapsed(group.key, block.def.id),
                    onDropSession: (sessionId: string) => assignTagGroup(group.key, sessionId, block.def.id),
                    onDropTag: (sourceId: string, before: boolean) => reorderTag(group.key, sourceId, block.def.id, before),
                    tr,
                    children: block.sessions.map((row) => h(SessionRow, { key: row.id, ...groupedRowProps(row) })),
                  }),
                ),
                ...split.ungrouped.map((row) => h(SessionRow, { key: row.id, ...groupedRowProps(row) })),
              )
            }),
          )

  /**
   * 列表区的内容（#110 把加载态与两种空态接在这里；原来加载中是整块空白）：
   * 加载中（工作区快照还没到）→ 加载文案；选中分组里没有工作区 → 分组空态 + 入口；
   * 一个工作区都没有 → 提示贴在列表最前（未分组块 / 平铺行照旧跟在后面）；
   * 其余情况照旧渲染 `treeBody`，搜索态额外补一行官方那套「结果上限」提示。
   */
  const listChildren: readonly unknown[] = ((): readonly unknown[] => {
    if (workspacePhase !== 'ready') return [emptyNotice('loading', [tr('empty.loading')])]
    if (trimmedQuery !== '') {
      return content.hasMore
        ? [
            treeBody,
            h(
              'div',
              { className: 'dshOneTree_searchStatus', key: 'search-more', role: 'status', 'data-dshone-tree': 'search-more' },
              tr('search.hasMore', { n: searchResultLimit }),
            ),
          ]
        : [treeBody]
    }
    if (filterActive && groups.length === 0) return [groupMembersNotice]
    if (workspaces.length > 0) return groups.length === 0 ? [emptyNotice('none', [tr('empty.none')])] : [treeBody]
    return groups.length === 0 ? [noWorkspacesNotice] : [noWorkspacesNotice, treeBody]
  })()

  return h(
    'div',
    {
      className: 'dshOneTree_root',
      ref: rootRef,
      'data-shell': 'dsh-one-tree',
      'data-dshone-tree': 'root',
      /**
       * 这一页实际取到的是哪一代官方等待态钩子（观测点，取值 = 钩子名或 `none`）。
       *
       * 为什么把这件事写在 DOM 上：等待态取不到时页面上的表现只是「没有黄点」，与
       * 「今天没有等待中的会话」长得一模一样——浏览器验证据此断言「按官方名字取到了」
       * 而不是「什么都没发生」（#184 的常驻断言之一，见 test/assembly-lab/pendingDotSuites.ts）。
       */
      'data-dshone-tree-pending-source': pendingSource?.hook ?? 'none',
    },
    // 顶部工具栏（#99 B 段；#135 起**一行五件**）：行首是分组过滤胶囊（原来自己在列表区
    // 占一行），右边依次是官方搜索栏（#132 起默认折叠，点开才展开）+ 折叠/展开全部 +
    // 添加工作区 + 设置齿轮 + 多选入口（#131 起搜索栏之后只有这四件，视图选项已退役）。
    // 搜索展开时除输入框外一律让位，让位规则与官方出处见 toolbar.ts 文件头。
    //
    // 分组胶囊的状态与回调仍由这里拥有（分组定义、计数、选择态、建组/管理对话框都在
    // 这个组件里），只是交给顶栏渲染——它现在是那一行的行首那一件。
    // #108 起它**选择态下不收起**：那一刻操作条要在它下方接着出现（#98 的布局规范），
    // 收起它一切换状态就跳一下，且「先按分组过滤、再整组勾选」正是常用路径；#135 之后
    // 它在搜索态下也不再从 DOM 里摘掉，而是由顶栏按搜索展开与否给它让位（零宽收起）。
    h(TopBar, {
      tr,
      query: searchText,
      onQueryChange: (value: string) => setSearchText(sanitizeQuery(value)),
      onQueryClear: () => setSearchText(''),
      allCollapsed,
      onToggleCollapseAll: toggleCollapseAll,
      onPickWorkspaceFolder: () => addWorkspace(pickWorkspaceFolder),
      ...(createWorkspaceFolder === undefined
        ? {}
        : { onCreateWorkspaceFolder: () => addWorkspace(createWorkspaceFolder) }),
      ...(openSettings === undefined ? {} : { onOpenSettings: openSettings }),
      selectMode,
      onToggleSelectMode: () => (selectMode ? exitSelection() : selectionEntrySignal.enter()),
      filter: {
        groups: groupDefs,
        activeGroupId: filterActive ? activeGroupId : null,
        groupCounts,
        totalCount: workspaces.length,
        onPick: (groupId: string | null) => setPrefs((prev) => ({ ...prev, activeGroupId: groupId })),
        onCreate: () => {
          setGroupError(null)
          setGroupDialog({ kind: 'create' })
        },
        onManage: () => setManageGroupsOpen(true),
      },
    }),
    /**
     * 两条官方等待态钩子都不在场时的那行可见事实（#184）。
     *
     * 为什么必须有这一行：取不到钩子时页面上原本什么都不会说——等待态的黄点本来就不是
     * 每条会话都有，所以「点不亮」与「今天没有等待中的会话」在界面上分不出来，用户与
     * 我们都无从发现取用路径已经断了。这行字把「取不到」变成看得见的事实（正常情况下
     * 永远不渲染；官方在两代之间换名字时由这一行当场报出来）。
     */
    pendingSource === null
      ? h(
          'div',
          {
            className: 'dshOneTree_noticeLine',
            key: 'pending-unavailable',
            role: 'status',
            'data-dshone-tree': 'pending-unavailable',
          },
          tr('pending.unavailable'),
        )
      : null,
    h(
      'div',
      { className: 'dshOneTree_listArea' },
      // #81 功能 4 的选择态动作条，动作按 #103 的两层语义接线：移入回收站（本地可逆，
      // 立即执行 + 飘提示 + 结束选择态）与批量归档（不可逆，先过确认弹窗）。
      selectMode
        ? h(SelectionBar, {
            count: selection.length,
            busy,
            error: selectionError,
            tr,
            onMoveToRecycleBin: moveSelectedToRecycleBin,
            onArchive: requestArchiveSelection,
            onExit: exitSelection,
          })
        : null,
      // #176：刚添加的工作区被分组过滤挡住时的页面内提示（只在「挡着」的那一刻渲染，
      // 判据见上面 `addNoticeFor`）。它与宿主通知无关——能力口里根本没有「弹通知」
      // 这条，而且官方 web 那一端也要有同样的表现，所以提示落在页面里。
      addNoticeFor === null
        ? null
        : h(
            'div',
            {
              className: 'dshOneTree_addNotice',
              role: 'status',
              'data-dshone-tree': 'add-notice',
              'data-dshone-tree-added-workspace': addNoticeFor.workspaceId,
            },
            h('span', { className: 'dshOneTree_addNoticeText' }, tr('addNotice.filtered', { name: addNoticeFor.name })),
            h(
              'button',
              {
                type: 'button',
                className: 'dshOneTree_addNoticeAction',
                'data-dshone-tree-action': 'show-all-workspaces',
                onClick: () => {
                  setPrefs((prev) => ({ ...prev, activeGroupId: null }))
                  setAddNotice(null)
                },
              },
              tr('group.allWorkspaces'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dshOneTree_addNoticeClose',
                'aria-label': tr('addNotice.dismiss'),
                'data-dshone-tree-action': 'dismiss-add-notice',
                onClick: () => setAddNotice(null),
              },
              h(IconCloseFill14, {}),
            ),
          ),
      h(
        'div',
        { className: 'dshOneTree_list' },
        ...listChildren,
      ),
    ),
    // 回收站抽屉（#103）：本地可逆那一层。块头折叠态是纯视图态，随视图偏好一起落
    // 客户端存储（`recycleCollapsed`）。
    h(RecycleDrawer, {
      open: drawerOpen,
      groups: recycleGroups,
      collapsed: prefs.recycleCollapsed,
      now,
      tr,
      busy,
      error: recycleError,
      pinned: pinnedIds,
      unread: unreadIds,
      onClose: () => {
        setRecycleDrawerOpen(false)
        setRecycleError(null)
      },
      onToggleGroup: (key: string) =>
        setPrefs((prev) => ({
          ...prev,
          recycleCollapsed: prev.recycleCollapsed.includes(key)
            ? prev.recycleCollapsed.filter((candidate) => candidate !== key)
            : [...prev.recycleCollapsed, key],
        })),
      onOpen: (sessionId: string) => openSessionClearingUnread(sessionId),
      onRestore: (sessionId: string) => restoreFromRecycle([sessionId]),
      onArchive: requestArchiveFromBin,
      // 抽屉头的两枚动作回到**既有的那两个函数**（#154）：清空 = 既有的归档确认弹窗路径，
      // 恢复全部 = 既有的全部还原路径——与底部入口行发来的那两个请求同一个去处，不另起一条。
      onEmpty: requestEmptyBin,
      onRestoreAll: () => restoreFromRecycle(recycledIds),
    }),
    h(RenameModal, {
      open: renameTarget !== null,
      titleKey: 'rename.workspace.title',
      fieldKey: 'field.workspaceName',
      initial: renameTarget?.title ?? '',
      tr,
      onClose: () => setRenameTarget(null),
      onSubmit: async (value: string) => {
        if (renameTarget === null) return
        await renameWorkspace(renameTarget.workspaceId, value)
      },
    }),
    h(RenameModal, {
      open: sessionRenameTarget !== null,
      titleKey: 'rename.session.title',
      fieldKey: 'field.sessionName',
      initial: sessionRenameTarget?.title ?? '',
      tr,
      onClose: () => setSessionRenameTarget(null),
      onSubmit: async (value: string) => {
        if (sessionRenameTarget === null) return
        await renameSession(sessionRenameTarget.id, value)
      },
    }),
    h(GroupModal, {
      dialog: groupDialog,
      groups: groupDefs,
      tr,
      error: groupError,
      onClose: () => {
        setGroupDialog(null)
        setGroupError(null)
      },
      onSubmit: (value: string) => {
        const dialog = groupDialog
        if (dialog === null) return
        if (dialog.kind === 'create') {
          const failure = applyGroupCreate(value)
          if (failure !== null) {
            setGroupError(failure === 'empty' ? tr('group.name.empty') : tr('group.name.duplicate'))
            return
          }
        } else if (dialog.kind === 'rename') {
          if (applyGroupRename(dialog.id, value) !== null) {
            setGroupError(tr('group.name.duplicate'))
            return
          }
        } else {
          applyGroupDelete(dialog.id)
        }
        setGroupDialog(null)
        setGroupError(null)
      },
    }),
    // 「管理分组…」对话框（#99 B 段）：行内 ✎/🗑 关掉本框、开上面那套对话框去做
    //（校核复用），建新组则内联走同一份 `applyGroupCreate`。#139 起多一层：点分组名
    // 进它的成员清单（全部工作区 + 勾选），勾选与批量都回到上面那一条唯一的写路径。
    h(ManageGroupsModal, {
      open: manageGroupsOpen,
      groups: groupDefs,
      counts: groupCounts,
      workspaces: memberRows,
      groupMembers: groupMemberIds,
      tr,
      onCreate: applyGroupCreate,
      // 成员清单的回调是**组在前**（与 onRename / onDelete / onSetMembers 同一序），
      // 这里翻到纯函数那一序（工作区在前，与 `toggleWorkspaceGroup` 一致）。
      onToggleMember: (groupId: string, workspaceId: string) => toggleWorkspaceInGroup(workspaceId, groupId),
      onSetMembers: setWorkspacesInGroup,
      onRename: (groupId: string, name: string) => {
        setManageGroupsOpen(false)
        setGroupError(null)
        setGroupDialog({ kind: 'rename', id: groupId, name })
      },
      onReorder: applyGroupReorder,
      onDelete: (groupId: string, name: string) => {
        setManageGroupsOpen(false)
        setGroupError(null)
        setGroupDialog({ kind: 'delete', id: groupId, name })
      },
      onClose: () => setManageGroupsOpen(false),
    }),
    h(DeleteWorkspaceModal, {
      target: deleteTarget,
      tr,
      onClose: () => setDeleteTarget(null),
      onSubmit: (workspaceId: string) => deleteWorkspace(workspaceId),
    }),
    // 归档确认弹窗（#103，可复用件）：会话行菜单「归档会话」、回收站行菜单「永久归档」、
    // 入口行「清空」、选择态「批量归档」四个入口共用它——归档 = 删除，一律先确认。
    h(ArchiveSessionsModal, {
      target: archiveRequest,
      tr,
      busy: archiveBusy,
      error: archiveError,
      onConfirm: confirmArchive,
      onClose: () => {
        if (archiveBusy) return
        setArchiveRequest(null)
        setArchiveError(null)
      },
    }),
    // #107 标签组：重命名（复用工作区/会话重命名那一枚通用对话框）、删除确认、
    // 新建（名字 + 颜色）。三个都只开在有明确目标时。
    h(RenameModal, {
      open: tagRename !== null,
      titleKey: 'tag.rename.title',
      fieldKey: 'tag.name.label',
      initial: tagRename?.name ?? '',
      tr,
      onClose: () => setTagRename(null),
      onSubmit: async (value: string) => {
        const target = tagRename
        if (target === null) return
        const bucket = tagBucket(target.groupKey)
        // 校核与落盘同一份纯函数：放到这里只为把「重名」翻成用户看得懂的提示。
        if (tagGroupNameError(bucket, value, target.id) !== null) throw new Error(tr('tag.name.duplicate'))
        applyTagBucket(target.groupKey, updateTagGroup(bucket, target.id, { name: value }))
      },
    }),
    h(TagGroupDeleteModal, {
      target: tagDelete === null ? null : { id: tagDelete.id, name: tagDelete.name },
      tr,
      onClose: () => setTagDelete(null),
      onSubmit: (id: string) => {
        const target = tagDelete
        if (target === null) return
        applyTagBucket(target.groupKey, deleteTagGroup(tagBucket(target.groupKey), id))
        setTagDelete(null)
      },
    }),
    h(TagGroupCreateModal, {
      open: tagCreate !== null,
      tr,
      defaultColor: nextTagColor(tagCreate === null ? emptyTagBucket() : tagBucket(tagCreate.groupKey)),
      validate: (name: string) => tagGroupNameError(tagCreate === null ? emptyTagBucket() : tagBucket(tagCreate.groupKey), name),
      onClose: () => setTagCreate(null),
      onSubmit: (name: string, color: TagColor) => {
        if (tagCreate === null) return
        createTagFrom(tagCreate, name, color)
      },
    }),
    // 飘提示宿主（移入/还原/归档的回执）。
    h(FlashHost, {}),
  )
}
