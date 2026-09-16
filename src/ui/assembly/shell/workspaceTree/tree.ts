/** 树主组件（官方 WorkspaceBrowser 的同构复刻）：组合上面各件 + 状态与订阅。 */
import { createElement as h, useEffect, useRef, useState } from 'react'
import {
  IconArchiveOutline20,
  IconChecklistOutline14,
  IconCloseFill14,
  IconPlusOutline16,
  IconSearchOutline16,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  deriveFlat,
  deriveGroups,
  deriveRecycleGroups,
  owningGroupKey,
  recycleCount,
  workspaceActivityCounts,
  type ActivityCounts,
  type SessionNode,
} from '../../../../pure/workspaceTreeView.ts'
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
import type { GroupFile } from '../../../../pure/dshStateFile.ts'
import { GroupFilterBar } from './groupFilterBar.ts'
import { newGroupId } from './groups.ts'
import { useHoverCardRoom } from './hoverCard.ts'
import { DeleteWorkspaceModal, GroupModal, RenameModal } from './modals.ts'
import { RecycleDrawer } from './recycleDrawer.ts'
import { ProjectRow, SearchResultRow, SessionRow } from './rows.ts'
import { EMPTY_SEARCH, SEARCH_DEBOUNCE_MS, SEARCH_QUERY_MAX, sanitizeQuery, type SearchState } from './search.ts'
import { SelectionBar } from './selection.ts'
import './styles.ts'
import { ViewOptionsMenu } from './toolbar.ts'
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
    useDirectoryFlow,
    open: openSession,
    startSession,
    renameSession,
    forkSession,
    archiveSession,
    renameWorkspace,
    deleteWorkspace,
    addWorkspace,
    searchSessions,
    searchResultLimit,
    loadGroups,
    saveGroups,
    recycleSessions,
    restoreSession,
    openInNewTab,
  } = props
  const tr = t
  const now = Date.now()
  const list = useSessions((state) => state)
  const workspaces = useWorkspaces((state) => state.items)
  const workspacePhase = useWorkspaces((state) => state.phase)
  const archivedSessionIds = useWorkspaces((state) => state.archivedSessionIds)
  const pending = useSessionPendingInteraction((state) => state)
  const directoryFlowAvailable = useDirectoryFlow === undefined ? false : useDirectoryFlow((occupied: boolean) => occupied)

  // 视图态（分组方式/排序/当前过滤的分组/展开集合）住官方客户端惯例的 localStorage，
  // 初值在挂载时读一次；此后每次变更都写回（见下面的写回 effect）。
  const [prefs, setPrefs] = useState<TreeViewPrefs>(readTreeViewPrefs(pageStorage()))
  const groupBy = prefs.groupBy
  const orderBy = prefs.orderBy
  const activeGroupId = prefs.activeGroupId
  const groupExpansion = prefs.expandedGroups
  const [searchText, setSearchText] = useState('')
  const [searchExpanded, setSearchExpanded] = useState(false)
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
  // 批量选择（纯视图态，不持久化）+ 回收站抽屉 + 还原中的会话 id。
  const [selectMode, setSelectMode] = useState(false)
  const [selection, setSelection] = useState<readonly string[]>([])
  const [archiving, setArchiving] = useState(false)
  const [selectionError, setSelectionError] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [recycleError, setRecycleError] = useState<string | null>(null)
  const searchInput = useRef<{ focus(): void } | null>(null)
  const searchRoot = useRef<HTMLDivElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const hoverCard = useHoverCardRoom(rootRef)

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

  // 当前会话所在分组默认展开（官方同款：只在一条分组从未被显式收/展过时自动展开）。
  useEffect(() => {
    if (list.current === undefined || workspacePhase !== 'ready') return
    const key = owningGroupKey(workspaces, list.current)
    setPrefs((prev) =>
      prev.expandedGroups.includes(key) ? prev : { ...prev, expandedGroups: [...prev.expandedGroups, key] },
    )
  }, [list.current, workspaces, workspacePhase])

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

  const archived = new Set(archivedSessionIds)
  const withOrder = (sessions: readonly SessionNode[]): readonly SessionNode[] =>
    orderBy === 'updated' ? [...sessions].sort((a, b) => b.updatedAt - a.updatedAt) : sessions
  // 过滤态只在分组方式 = 按工作区时生效（单列表没有工作区分块可言）。
  const filterActive = groupBy === 'workspace' && activeGroupId !== null && hasTreeGroup(groupsFile, activeGroupId)
  const groups = deriveGroups(list, workspaces, archivedSessionIds, pending, {
    expandedGroups: groupExpansion,
    ...(filterActive && activeGroupId !== null
      ? { workspaceFilter: (workspaceId: string) => workspaceMatchesGroup(groupsFile, workspaceId, activeGroupId) }
      : {}),
  })
  const activity = workspaceActivityCounts(list, workspaces, archivedSessionIds, pending)
  const flatRows = withOrder(deriveFlat(list, archivedSessionIds, pending))
  const recycleGroups = deriveRecycleGroups(list, workspaces, archivedSessionIds)
  const recycleTotal = recycleCount(recycleGroups)
  const selectedSet = new Set(selection)

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

  /** #81 功能 4：把选中的会话批量移入回收站（走官方 uiWorkspace.archiveSession）。 */
  const archiveSelected = (): void => {
    if (archiving || selection.length === 0) return
    setArchiving(true)
    setSelectionError(null)
    recycleSessions(selection).then(
      (result) => {
        setArchiving(false)
        setSelection(result.failed)
        if (result.failed.length > 0) setSelectionError(tr('select.archiveFailed', { n: result.failed.length }))
        else exitSelection()
      },
      (reason: unknown) => {
        setArchiving(false)
        setSelectionError(reason instanceof Error ? reason.message : String(reason))
      },
    )
  }

  /** #81 功能 3/5：从回收站还原（官方 uiWorkspace.unarchiveSession）。 */
  const restoreFromRecycle = (sessionId: string): void => {
    if (restoringId !== null) return
    setRestoringId(sessionId)
    setRecycleError(null)
    restoreSession(sessionId).then(
      () => setRestoringId(null),
      (reason: unknown) => {
        setRestoringId(null)
        setRecycleError(tr('recycle.failed', { message: reason instanceof Error ? reason.message : String(reason) }))
      },
    )
  }


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

  const sectionLabelKey = groupBy === 'flat' ? 'section.sessions' : 'section.workspaces'
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
                tr,
                onOpen: () => openSession(row.id),
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
                onToggleSelect: () => toggleSelected(row.id),
                onOpen: () => openSession(row.id),
                onRename: (title: string) => setSessionRenameTarget({ id: row.id, title }),
                onFork: () => forkSession(row.id),
                onArchive: () => void archiveSession(row.id).catch(() => {}),
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
                    onToggleSelect: () => toggleSelected(row.id),
                    onOpen: () => openSession(row.id),
                    onRename: (title: string) => setSessionRenameTarget({ id: row.id, title }),
                    onFork: () => forkSession(row.id),
                    onArchive: () => void archiveSession(row.id).catch(() => {}),
                    onOpenInNewTab: openInNewTab === undefined ? undefined : () => openInNewTab(row.id),
                  }),
                ),
              ),
            ),
          )

  return h(
    'div',
    { className: 'dshOneTree_root', ref: rootRef, 'data-shell': 'dsh-one-tree', 'data-dshone-tree': 'root' },
    h(
      'div',
      { className: 'dshOneTree_sectionHeader' },
      h(
        'span',
        {
          className: `dshOneTree_sectionLabel${searchExpanded ? ' dshOneTree_sectionLabelHidden' : ''}`,
          'data-dshone-tree': 'section-label',
        },
        tr(sectionLabelKey),
      ),
      h(
        'div',
        { className: `dshOneTree_searchSlot${searchExpanded ? ' dshOneTree_searchSlotExpanded' : ''}` },
        h(
          'div',
          {
            ref: searchRoot,
            className: `dshOneTree_search${searchExpanded ? ' dshOneTree_searchExpanded' : ''}`,
            'data-dshone-tree': 'search-pill',
            onClick: () => {
              setSearchExpanded(true)
              searchInput.current?.focus()
            },
          },
          h(Tooltip, {
            label: tr('search'),
            side: 'bottom',
            delayMs: 500,
            disabled: searchExpanded,
            children: h(
              'button',
              {
                type: 'button',
                className: 'dshOneTree_searchButton',
                'aria-label': tr('search.sessions.aria'),
                'aria-expanded': searchExpanded,
                'data-dshone-tree-action': 'search',
                onClick: () => setSearchExpanded(true),
              },
              h(IconSearchOutline16, { size: searchExpanded ? 11 : 14 }),
            ),
          }),
          h('input', {
            ref: searchInput,
            className: 'dshOneTree_searchInput',
            'data-dshone-tree': 'search-input',
            type: 'text',
            placeholder: tr('search.placeholder'),
            maxLength: SEARCH_QUERY_MAX,
            value: searchText,
            tabIndex: searchExpanded ? 0 : -1,
            onChange: (event: { target: { value: string } }) => setSearchText(sanitizeQuery(event.target.value)),
            onKeyDown: (event: { key: string }) => {
              if (event.key !== 'Escape') return
              setSearchText('')
              setSearchExpanded(false)
            },
          }),
          searchExpanded
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'dshOneTree_clearButton',
                  'data-dshone-tree': 'search-clear',
                  'aria-label': tr('search.clear'),
                  onClick: (event: { stopPropagation(): void }) => {
                    event.stopPropagation()
                    setSearchText('')
                    setSearchExpanded(false)
                  },
                },
                h(IconCloseFill14, {}),
              )
            : null,
        ),
      ),
      h(
        'div',
        { className: `dshOneTree_headerActions${searchExpanded ? ' dshOneTree_headerActionsHidden' : ''}` },
        h(ViewOptionsMenu, {
          groupBy,
          orderBy,
          tr,
          onGroupPick: (mode: 'workspace' | 'flat') => setPrefs((prev) => ({ ...prev, groupBy: mode })),
          onOrderPick: (mode: 'manual' | 'updated') => setPrefs((prev) => ({ ...prev, orderBy: mode })),
        }),
        h(Tooltip, {
          label: selectMode ? tr('select.exit') : tr('select.enter'),
          side: 'bottom',
          delayMs: 500,
          children: h(
            'button',
            {
              type: 'button',
              className: `dshOneTree_iconButton${selectMode ? ' dshOneTree_menuOpen' : ''}`,
              'aria-label': selectMode ? tr('select.exit') : tr('select.enter'),
              'aria-pressed': selectMode,
              'data-dshone-tree-action': 'select-mode',
              onClick: () => (selectMode ? exitSelection() : setSelectMode(true)),
            },
            h(IconChecklistOutline14, { size: 16 }),
          ),
        }),
        h(Tooltip, {
          label: tr('recycle.open'),
          side: 'bottom',
          delayMs: 500,
          children: h(
            'button',
            {
              type: 'button',
              className: 'dshOneTree_iconButton',
              'aria-label': tr('recycle.open'),
              'data-dshone-tree-action': 'recycle-open',
              'data-dshone-tree-recycle-count': recycleTotal,
              onClick: () => setDrawerOpen(true),
            },
            h(IconArchiveOutline20, { size: 16 }),
          ),
        }),
        directoryFlowAvailable
          ? h(Tooltip, {
              label: tr('workspace.add'),
              side: 'bottom',
              delayMs: 500,
              children: h(
                'button',
                {
                  type: 'button',
                  className: 'dshOneTree_iconButton',
                  'aria-label': tr('workspace.add'),
                  'data-dshone-tree-action': 'add-workspace',
                  onClick: () => addWorkspace(),
                },
                h(IconPlusOutline16, { size: 16 }),
              ),
            })
          : null,
      ),
    ),
    h(
      'div',
      { className: 'dshOneTree_listArea' },
      // #81 功能 1：分组过滤条（只在「按工作区」下有意义；搜索态下让位给结果）。
      groupBy === 'workspace' && trimmedQuery === '' && !selectMode
        ? h(GroupFilterBar, {
            groups: treeGroupDefs(groupsFile),
            activeGroupId: filterActive ? activeGroupId : null,
            tr,
            onPick: (groupId: string | null) => setPrefs((prev) => ({ ...prev, activeGroupId: groupId })),
            onCreate: () => {
              setGroupError(null)
              setGroupDialog({ kind: 'create' })
            },
            onRename: (id: string, name: string) => {
              setGroupError(null)
              setGroupDialog({ kind: 'rename', id, name })
            },
            onDelete: (id: string, name: string) => {
              setGroupError(null)
              setGroupDialog({ kind: 'delete', id, name })
            },
          })
        : null,
      // #81 功能 4：选择态的动作条（已选计数 + 批量移入回收站 + 退出）。
      selectMode
        ? h(SelectionBar, {
            count: selection.length,
            busy: archiving,
            error: selectionError,
            tr,
            onArchive: archiveSelected,
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
    h(RecycleDrawer, {
      open: drawerOpen,
      groups: recycleGroups,
      now,
      tr,
      busyId: restoringId,
      error: recycleError,
      onClose: () => {
        setDrawerOpen(false)
        setRecycleError(null)
      },
      onOpen: (sessionId: string) => openSession(sessionId),
      onRestore: restoreFromRecycle,
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
      groups: treeGroupDefs(groupsFile),
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
          const result = createTreeGroup(groupsFile, value, newGroupId())
          if (!result.ok) {
            setGroupError(result.error === 'empty' ? tr('group.name.empty') : tr('group.name.duplicate'))
            return
          }
          // 刻意**不**把过滤切到新分组：刚建的分组还没有成员，切过去等于把树清空，
          // 用户接下来要做的「把工作区归到这个组」反而没地方点了。新分组出现在
          // 过滤条里，用户自己点它即可。
          writeGroups(result.file)
        } else if (dialog.kind === 'rename') {
          const next = renameTreeGroup(groupsFile, dialog.id, value)
          if (next === null) {
            setGroupError(tr('group.name.duplicate'))
            return
          }
          writeGroups(next)
        } else {
          const next = deleteTreeGroup(groupsFile, dialog.id)
          if (next !== null) writeGroups(next)
          // 删掉的正是当前过滤的分组 → 过滤回落「全部」。
          setPrefs((prev) => (prev.activeGroupId === dialog.id ? { ...prev, activeGroupId: null } : prev))
        }
        setGroupDialog(null)
        setGroupError(null)
      },
    }),
    h(DeleteWorkspaceModal, {
      target: deleteTarget,
      tr,
      onClose: () => setDeleteTarget(null),
      onSubmit: (workspaceId: string) => deleteWorkspace(workspaceId),
    }),
  )
}
