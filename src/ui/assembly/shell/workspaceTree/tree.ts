/** 树主组件（官方 WorkspaceBrowser 的同构复刻）：组合上面各件 + 状态与订阅。 */
import { createElement as h, useEffect, useRef, useState } from 'react'
import { deriveFlat, deriveGroups, deriveRecycleGroups, groupSessionNodes, owningGroupKey, visibleRecycleIds, workspaceActivityCounts, type ActivityCounts, type SessionNode } from '../../../../pure/workspaceTreeView.ts'
import { cannotArchiveReason, type SessionEligibilityFacts } from '../../../../pure/sessionEligibility.ts'
import {
  createTreeGroup,
  deleteTreeGroup,
  emptyTreeGroups,
  hasTreeGroup,
  renameTreeGroup,
  toggleWorkspaceGroup,
  treeGroupDefs,
  workspaceGroupIds,
  workspaceMatchesGroup,
} from '../../../../pure/treeGroups.ts'
import { pageStorage, readTreeViewPrefs, writeTreeViewPrefs, type TreeViewPrefs } from '../../../../pure/workspaceTreePrefs.ts'
import { emptySessionMarks, pinnedFirst, toggleMarkId, type SessionMarksState } from '../../../../pure/sessionMarks.ts'
import type { GroupFile } from '../../../../pure/dshStateFile.ts'
import { FlashHost, flashTip } from './flash.ts'
import { GroupFilterBar } from './groupFilterBar.ts'
import { newGroupId } from './groups.ts'
import { useHoverCardRoom } from './hoverCard.ts'
import { ArchiveSessionsModal, DeleteWorkspaceModal, GroupModal, ManageGroupsModal, RenameModal, type ArchiveRequest } from './modals.ts'
import { partitionArchivable } from '../../../../pure/recycleActions.ts'
import { pruneRecycleBin, recycleBinActions, useRecycleBin } from './recycleBinStore.ts'
import { RecycleDrawer } from './recycleDrawer.ts'
import { recycleEntrySignal } from './recycleEntry.ts'
import { ProjectRow, SearchResultRow, SessionRow } from './rows.ts'
import { EMPTY_SEARCH, SEARCH_DEBOUNCE_MS, sanitizeQuery, type SearchState } from './search.ts'
import { SelectionBar } from './selection.ts'
import './styles.ts'
import { TopBar } from './toolbar.ts'
import type { TreeProps } from './types.ts'

// ---------------------------------------------------------------------------
// 主组件（官方 `WorkspaceBrowser` 的同构复刻）
// ---------------------------------------------------------------------------
export function WorkspaceTree(props: TreeProps): unknown {
  const {
    t,
    useSessions,
    useWorkspaces,
    useSessionPendingInteraction,
    open: openSession,
    startSession,
    renameSession,
    forkSession,
    renameWorkspace,
    deleteWorkspace,
    pickWorkspaceFolder,
    createWorkspaceFolder,
    openSettings,
    searchSessions,
    searchResultLimit,
    loadGroups,
    saveGroups,
    loadMarks,
    savePinned,
    saveUnread,
    openInNewTab,
  } = props
  const tr = t
  const now = Date.now()
  const list = useSessions((state) => state)
  const workspaces = useWorkspaces((state) => state.items)
  const workspacePhase = useWorkspaces((state) => state.phase)
  const archivedSessionIds = useWorkspaces((state) => state.archivedSessionIds)
  const pending = useSessionPendingInteraction((state) => state)

  // 视图态（分组方式/排序/当前过滤的分组/展开集合）住官方客户端惯例的 localStorage，
  // 初值在挂载时读一次；此后每次变更都写回（见下面的写回 effect）。
  const [prefs, setPrefs] = useState<TreeViewPrefs>(readTreeViewPrefs(pageStorage()))
  const groupBy = prefs.groupBy
  const orderBy = prefs.orderBy
  const activeGroupId = prefs.activeGroupId
  const groupExpansion = prefs.expandedGroups
  const [searchText, setSearchText] = useState('')
  const [content, setContent] = useState<SearchState>(EMPTY_SEARCH)
  const [renameTarget, setRenameTarget] = useState<{ workspaceId: string; title: string } | null>(null)
  const [sessionRenameTarget, setSessionRenameTarget] = useState<{ id: string; title: string } | null>(null)
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
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [recycleError, setRecycleError] = useState<string | null>(null)
  const [archiveRequest, setArchiveRequest] = useState<ArchiveRequest | null>(null)
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const hoverCard = useHoverCardRoom(rootRef)

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

  // 当前会话所在分组默认展开（官方同款：只在一条分组从未被显式收/展过时自动展开）。
  useEffect(() => {
    if (list.current === undefined || workspacePhase !== 'ready') return
    const key = owningGroupKey(workspaces, list.current)
    setPrefs((prev) =>
      prev.expandedGroups.includes(key) ? prev : { ...prev, expandedGroups: [...prev.expandedGroups, key] },
    )
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

  // 排序 = 官方顺序，**唯一例外**是置顶项在这一层排最前（#98 定稿，`pinnedFirst`）。
  const withOrder = (sessions: readonly SessionNode[]): readonly SessionNode[] =>
    pinnedFirst(
      orderBy === 'updated' ? [...sessions].sort((a, b) => b.updatedAt - a.updatedAt) : sessions,
      (node) => pinnedIds.has(node.id),
    )
  // 过滤态只在分组方式 = 按工作区时生效（单列表没有工作区分块可言）。
  const filterActive = groupBy === 'workspace' && activeGroupId !== null && hasTreeGroup(groupsFile, activeGroupId)
  const groups = deriveGroups(list, workspaces, archivedSessionIds, pending, {
    expandedGroups: groupExpansion,
    recycled,
    ...(filterActive && activeGroupId !== null
      ? { workspaceFilter: (workspaceId: string) => workspaceMatchesGroup(groupsFile, workspaceId, activeGroupId) }
      : {}),
  })
  const activity = workspaceActivityCounts(list, workspaces, archivedSessionIds, pending, recycled)
  const visibleNodes = deriveFlat(list, archivedSessionIds, pending, recycled)
  const flatRows = withOrder(visibleNodes)
  const recycleGroups = deriveRecycleGroups(list, workspaces, recycledIds)
  const selectedSet = new Set(selection)

  // #99 顶栏「折叠/展开全部」：可展开的分组 = 有会话的分组（工作区 / 未分组桶）。
  // 键集取**不过滤**的那一份推导（过滤态下也要能一次收起/展开全部工作区，与旧侧栏
  // 「折叠所有工作区」同义）。
  const expandableKeys = deriveGroups(list, workspaces, archivedSessionIds, pending, { expandedGroups: [] })
    .filter((group) => group.sessionCount > 0)
    .map((group) => group.key)
  const allCollapsed = expandableKeys.length > 0 && expandableKeys.every((key) => !groupExpansion.includes(key))
  /** 已全收起 → 展开全部；否则收起全部（图标与提示在顶栏里随 `allCollapsed` 翻转）。 */
  const toggleCollapseAll = (): void => {
    setPrefs((prev) => ({
      ...prev,
      expandedGroups: allCollapsed ? [...new Set([...prev.expandedGroups, ...expandableKeys])] : [],
    }))
  }

  // #99 单胶囊的计数口径 = **成员工作区数**（旧侧栏同款）：全部 = 工作区总数；
  // 某组 = 归属该组的工作区数。
  const groupDefs = treeGroupDefs(groupsFile)
  const groupCounts = new Map(
    groupDefs.map((def) => [def.id, workspaces.filter((workspace) => workspaceMatchesGroup(groupsFile, workspace.workspaceId, def.id)).length]),
  )

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

  const toggleSelected = (sessionId: string): void => {
    setSelectionError(null)
    setSelection((prev) =>
      prev.includes(sessionId) ? prev.filter((id) => id !== sessionId) : [...prev, sessionId],
    )
  }

  /** 退出选择态：清空选择与错误（选择态本身是纯视图态，不落盘）。 */
  const exitSelection = (): void => {
    setSelectMode(false)
    setSelection([])
    setSelectionError(null)
  }

  const errorText = (reason: unknown): string => (reason instanceof Error ? reason.message : String(reason))

  /** 一条会话的资格事实（会话快照 + 置顶/未读两份 id 集合，见 pure/sessionEligibility.ts）。 */
  const eligibilityOf = (node: SessionNode): SessionEligibilityFacts => ({
    pinned: pinnedIds.has(node.id),
    unread: unreadIds.has(node.id),
    running: node.running,
    runningSubagentCount: node.runningSubagentCount,
    ...(node.pendingInteraction === undefined ? {} : { pendingInteraction: node.pendingInteraction }),
  })

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
        if (outcome.failed.length > 0) {
          setArchiveError(tr('archive.failed', { n: outcome.failed.length }))
          return
        }
        setArchiveRequest(null)
        flashTip(tr('archive.done', { n: outcome.done.length }))
      },
      (reason: unknown) => {
        setArchiveBusy(false)
        setArchiveError(errorText(reason))
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

  /** 清空回收站 = 把里面每一条都永久归档（不可逆，先过确认弹窗）。 */
  const requestEmptyBin = (): void => {
    if (recycledIds.length === 0) return
    openArchive({ blocks: recycleGroups, skipped: 0, kind: 'emptyBin' })
  }

  /**
   * 批量归档（选择态操作条）：资格判定先切一遍，可归档的进明细、其余的进跳过数；
   * 一条都不可归档时不开弹窗（按钮本身也会按这个数禁用）。
   */
  const requestArchiveSelection = (): void => {
    if (selection.length === 0) return
    const nodes = selection.flatMap((id) => {
      const node = visibleNodes.find((candidate) => candidate.id === id)
      return node === undefined ? [] : [node]
    })
    const partition = partitionArchivable(nodes.map((node) => ({ node, ...eligibilityOf(node) })))
    if (partition.ready.length === 0) return
    openArchive({
      blocks: groupSessionNodes(list, workspaces, partition.ready.map((entry) => entry.node.id)),
      skipped: partition.skipped.length,
      kind: 'archive',
    })
  }

  // 底部回收站入口行发来的请求（同一 bundle 内的模块级信号，见 recycleEntry.ts 的文件头）：
  // 开抽屉 / 清空（不可逆，走确认弹窗）/ 全部还原（本地可逆，直接执行）。
  useEffect(() => {
    return recycleEntrySignal.subscribe((request) => {
      if (request === 'open') {
        setDrawerOpen(true)
        setRecycleError(null)
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
    const local = list.ids
      .flatMap((id) => {
        const summary = list.byId[id]
        if (summary === undefined || summary.origin === 'subagent' || archived.has(id)) return []
        if (summary.blank && id !== list.current) return []
        const matches = `${summary.displayTitle ?? summary.title ?? ''} ${workspaceLabelOf(id)}`.toLowerCase().includes(needle)
        return matches
          ? [{
              id,
              title: summary.blank ? '' : (summary.displayTitle ?? summary.title ?? id),
              blank: summary.blank,
              running: summary.running,
              runningSubagentCount: 0,
              completed: summary.completed === true,
              hasActiveSchedule: (summary.projectionValues?.schedule?.length ?? 0) > 0,
              updatedAt: summary.updatedAt,
            }]
          : []
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
    const seen = new Set(local.map((row) => row.id))
    const extra: SessionNode[] = []
    for (const item of content.items) {
      if (seen.has(item.id)) continue
      const summary = list.byId[item.id]
      if (summary === undefined) continue
      seen.add(item.id)
      extra.push({
        id: item.id,
        title: summary.blank ? '' : (summary.displayTitle ?? summary.title ?? item.id),
        blank: summary.blank,
        running: summary.running,
        runningSubagentCount: 0,
        completed: summary.completed === true,
        hasActiveSchedule: (summary.projectionValues?.schedule?.length ?? 0) > 0,
        updatedAt: summary.updatedAt,
      })
    }
    return [...local, ...extra].slice(0, searchResultLimit)
  })()
  const snippetOf = (sessionId: string): string | undefined =>
    content.items.find((item) => item.id === sessionId)?.snippet

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
                selected: row.id === list.current,
                pinned: pinnedIds.has(row.id),
                unread: unreadIds.has(row.id),
                tr,
                onOpen: () => openSessionClearingUnread(row.id),
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
      : groupBy === 'flat'
        ? h(
            'div',
            { className: 'dshOneTree_flatList', role: 'tree', 'data-dshone-tree': 'flat' },
            flatRows.map((row) =>
              h(SessionRow, {
                key: row.id,
                node: row,
                ...(list.current === undefined ? {} : { currentId: list.current }),
                now,
                flat: true,
                hoverCard,
                tr,
                selectMode,
                selected: selectedSet.has(row.id),
                pinned: pinnedIds.has(row.id),
                unread: unreadIds.has(row.id),
                onToggleSelect: () => toggleSelected(row.id),
                onOpen: () => openSessionClearingUnread(row.id),
                onRename: (title: string) => setSessionRenameTarget({ id: row.id, title }),
                onFork: () => forkSession(row.id),
                onMoveToRecycleBin: () => moveToRecycleBin([row.id]),
                onArchive: () => requestArchiveSession(row),
                onTogglePin: () => togglePin(row.id),
                onToggleUnread: () => toggleUnread(row.id),
                onOpenInNewTab: openInNewTab === undefined ? undefined : () => openInNewTab(row.id),
              }),
            ),
          )
        : h(
            'div',
            { role: 'tree', 'data-dshone-tree': 'groups' },
            groups.map((group) =>
              h(
                'div',
                { className: 'dshOneTree_groupSection', key: group.key, 'data-dshone-group-key': group.key },
                h(ProjectRow, {
                  group,
                  tr,
                  expanded: groupExpansion.includes(group.key),
                  hoverCard,
                  ...(activity.get(group.key) === undefined ? {} : { counts: activity.get(group.key) as ActivityCounts }),
                  groups: treeGroupDefs(groupsFile),
                  memberOf: group.workspaceId === undefined ? [] : workspaceGroupIds(groupsFile, group.workspaceId),
                  onToggle: () =>
                    setPrefs((prev) => ({
                      ...prev,
                      expandedGroups: prev.expandedGroups.includes(group.key)
                        ? prev.expandedGroups.filter((key) => key !== group.key)
                        : [...prev.expandedGroups, group.key],
                    })),
                  onCreate: () => startSession(group.workspaceId),
                  onToggleGroup: (groupId: string) => {
                    if (group.workspaceId === undefined) return
                    writeGroups(toggleWorkspaceGroup(groupsFile, group.workspaceId, groupId))
                  },
                  ...(group.workspaceId === undefined
                    ? {}
                    : {
                        onRename: () => setRenameTarget({ workspaceId: group.workspaceId as string, title: group.label }),
                        onDelete: () => setDeleteTarget({ workspaceId: group.workspaceId as string, title: group.label }),
                      }),
                }),
                // #81 功能 6：展开的分组把它的会话全列出来，不再截到 5 行。
                ...withOrder(group.sessions).map((row) =>
                  h(SessionRow, {
                    key: row.id,
                    node: row,
                    ...(list.current === undefined ? {} : { currentId: list.current }),
                    now,
                    flat: false,
                    hoverCard,
                    tr,
                    selectMode,
                    selected: selectedSet.has(row.id),
                    pinned: pinnedIds.has(row.id),
                    unread: unreadIds.has(row.id),
                    onToggleSelect: () => toggleSelected(row.id),
                    onOpen: () => openSessionClearingUnread(row.id),
                    onRename: (title: string) => setSessionRenameTarget({ id: row.id, title }),
                    onFork: () => forkSession(row.id),
                    onMoveToRecycleBin: () => moveToRecycleBin([row.id]),
                    onArchive: () => requestArchiveSession(row),
                    onTogglePin: () => togglePin(row.id),
                    onToggleUnread: () => toggleUnread(row.id),
                    onOpenInNewTab: openInNewTab === undefined ? undefined : () => openInNewTab(row.id),
                  }),
                ),
              ),
            ),
          )

  return h(
    'div',
    { className: 'dshOneTree_root', ref: rootRef, 'data-shell': 'dsh-one-tree', 'data-dshone-tree': 'root' },
    // 顶部工具栏（#99 B 段）：官方搜索栏（展开态）+ 折叠/展开全部 + 添加工作区 + 设置齿轮，
    // 末尾保留 #81 已有的视图选项与多选入口。见 toolbar.ts 的说明与机制举证。
    h(TopBar, {
      tr,
      query: searchText,
      onQueryChange: (value: string) => setSearchText(sanitizeQuery(value)),
      onQueryClear: () => setSearchText(''),
      allCollapsed,
      onToggleCollapseAll: toggleCollapseAll,
      onPickWorkspaceFolder: pickWorkspaceFolder,
      ...(createWorkspaceFolder === undefined ? {} : { onCreateWorkspaceFolder: createWorkspaceFolder }),
      ...(openSettings === undefined ? {} : { onOpenSettings: openSettings }),
      groupBy,
      orderBy,
      onGroupPick: (mode: 'workspace' | 'flat') => setPrefs((prev) => ({ ...prev, groupBy: mode })),
      onOrderPick: (mode: 'manual' | 'updated') => setPrefs((prev) => ({ ...prev, orderBy: mode })),
      selectMode,
      onToggleSelectMode: () => (selectMode ? exitSelection() : setSelectMode(true)),
    }),
    h(
      'div',
      { className: 'dshOneTree_listArea' },
      // #81 功能 1 / #99 B 段：分组过滤条 = 单胶囊 + 成员计数 + ▾ 下拉
      //（只在「按工作区」下有意义；搜索态下让位给结果）。
      groupBy === 'workspace' && trimmedQuery === '' && !selectMode
        ? h(GroupFilterBar, {
            groups: groupDefs,
            activeGroupId: filterActive ? activeGroupId : null,
            groupCounts,
            totalCount: workspaces.length,
            tr,
            onPick: (groupId: string | null) => setPrefs((prev) => ({ ...prev, activeGroupId: groupId })),
            onCreate: () => {
              setGroupError(null)
              setGroupDialog({ kind: 'create' })
            },
            onManage: () => setManageGroupsOpen(true),
          })
        : null,
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
      h(
        'div',
        { className: 'dshOneTree_list' },
        workspacePhase !== 'ready'
          ? null
          : groups.length === 0 && trimmedQuery === ''
            ? h('div', { className: 'dshOneTree_empty' }, tr('empty.none'))
            : treeBody,
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
      onClose: () => {
        setDrawerOpen(false)
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
    //（校核复用），建新组则内联走同一份 `applyGroupCreate`。
    h(ManageGroupsModal, {
      open: manageGroupsOpen,
      groups: groupDefs,
      counts: groupCounts,
      tr,
      onCreate: applyGroupCreate,
      onRename: (groupId: string, name: string) => {
        setManageGroupsOpen(false)
        setGroupError(null)
        setGroupDialog({ kind: 'rename', id: groupId, name })
      },
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
    // 飘提示宿主（移入/还原/归档的回执）。
    h(FlashHost, {}),
  )
}
