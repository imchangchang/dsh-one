/**
 * @dsh-one/vscode-workspace-tree——侧栏工作区/会话树的**影子插件**（#65 批 2）。
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
 *   `IconFolderClose16` / `IconTriangleRightFill14` / `IconEllipsisOutline16` /
 *   `IconPlusOutline16` / `IconSearchOutline16` / `IconCloseFill14` /
 *   `IconPersonalizationOutline16` / `IconEditOutline16` / `IconTrashOutline16` /
 *   `IconBranchOutline16` / `IconArchiveOutline20` / `StateDot` / `Menu` /
 *   `Tooltip` / `HoverCard` / `Modal` / `Button` / `relativeTime`。
 *
 * **样式 = 官方 token**：本插件不写自造颜色/尺寸。下面 CSS 里的每个数值都逐字
 * 取自官方 css-module（`ui-workspace/src/client/rows/Rows.module.css` 与
 * `WorkspaceBrowser.module.css`，0.1.6-alpha.1 的 `lib/client.js` 内联副本），
 * 颜色一律引用官方 token 变量（`--dsw-*`）。**不引用官方哈希类名**
 * （`YDXeBa_*` / `bhn1Oq_*` 随版本变），只用自有类名 + 官方 token：数值同源、
 * token 同源，只有类名是自己的。
 *
 * ## 已知取舍（下一步的差异化层处理）
 * - 分组展开态、视图偏好（分组方式/排序方式）存在组件内存里，不跨重载持久化
 *   （官方用持久化 store；视图状态归属正是自有树要拿回来的东西，见 #65 批 2）。
 * - 「按最近更新」在组内按 updatedAt 倒序（官方是手动序 + 活动晋升，常见情况下
 *   结果一致）。
 * - 工作区/会话重命名与工作区删除走官方 Modal 原语自渲染（官方同款组件、同款
 *   文案）——官方那条 entry 的对话框随它一起被遮蔽，必须自己重做。
 */
import { createElement as h, useEffect, useRef, useState } from 'react'
import {
  Button,
  HoverCard,
  IconArchiveOutline20,
  IconBranchOutline16,
  IconCloseFill14,
  IconEditOutline16,
  IconEllipsisOutline16,
  IconFolderClose16,
  IconFolderOpen16,
  IconPersonalizationOutline16,
  IconPlusOutline16,
  IconSearchOutline16,
  IconTrashOutline16,
  IconTriangleRightFill14,
  Menu,
  Modal,
  StateDot,
  Tooltip,
  relativeTime,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  UNGROUPED_KEY,
  deriveFlat,
  deriveGroups,
  owningGroupKey,
  sessionStatuses,
  showsStatusDot,
  type GroupNode,
  type SessionListLike,
  type SessionNode,
} from '../../../pure/workspaceTreeView.ts'

// ---------------------------------------------------------------------------
// 字典（自有命名空间 dshOneTree）：键名与取值逐字取自官方 `workspace` 命名空间
// 词典（zh/en 同键集），保证文案与官方一字不差；不复用官方命名空间是为避开
// 跨插件借命名空间的时序风险（同 settingsGearPlugin 的说明）。zh 走 unicode
// 转义以过 i18n 门禁的中文字面量扫描。
// ---------------------------------------------------------------------------
const ZH: Record<string, string> = {
  'group.ungrouped': '\u672a\u5206\u7ec4',
  'session.new': '\u65b0\u4f1a\u8bdd',
  'section.workspaces': '\u5de5\u4f5c\u533a',
  'section.sessions': '\u4f1a\u8bdd',
  'viewOptions.label': '\u89c6\u56fe\u9009\u9879',
  'groupBy.label': '\u5206\u7ec4\u65b9\u5f0f',
  'groupBy.workspace': '\u6309\u5de5\u4f5c\u533a',
  'groupBy.flat': '\u5355\u5217\u8868',
  'orderBy.label': '\u6392\u5e8f\u65b9\u5f0f',
  'orderBy.manual': '\u624b\u52a8\u6392\u5e8f',
  'orderBy.updated': '\u6700\u8fd1\u66f4\u65b0',
  'sessions.expand': '\u5c55\u5f00\u5176\u4f59 {n} \u4e2a\u4f1a\u8bdd',
  'sessions.collapse': '\u6536\u8d77',
  'empty.none': '\u6682\u65e0\u4f1a\u8bdd',
  'empty.noMatches': '\u65e0\u5339\u914d\u7ed3\u679c',
  'search.sessions.aria': '\u641c\u7d22\u4f1a\u8bdd',
  'search.placeholder': '\u641c\u7d22\u4f1a\u8bdd\u2026',
  'search.clear': '\u6e05\u9664\u641c\u7d22',
  'search.results.aria': '\u641c\u7d22\u7ed3\u679c',
  'search.pending': '\u6b63\u5728\u641c\u7d22\u4f1a\u8bdd\u5386\u53f2\u2026',
  'search.unavailable': '\u5185\u5bb9\u641c\u7d22\u6682\u4e0d\u53ef\u7528\uff0c\u4ec5\u663e\u793a\u540d\u79f0\u5339\u914d\u3002',
  'search.noMatches': '\u65e0\u5339\u914d\u4f1a\u8bdd',
  'search.hasMore': '\u4ec5\u663e\u793a\u524d {n} \u6761\u7ed3\u679c\uff0c\u8bf7\u7f29\u5c0f\u641c\u7d22\u8303\u56f4\u3002',
  rename: '\u91cd\u547d\u540d',
  'rename.workspace.title': '\u91cd\u547d\u540d\u5de5\u4f5c\u533a',
  'rename.session.title': '\u91cd\u547d\u540d\u4f1a\u8bdd',
  'field.workspaceName': '\u5de5\u4f5c\u533a\u540d\u79f0',
  'field.sessionName': '\u4f1a\u8bdd\u540d\u79f0',
  'delete.workspace': '\u5220\u9664\u5de5\u4f5c\u533a',
  'delete.desc':
    '\u5c06\u628a\u201c{name}\u201d\u4ece\u5de5\u4f5c\u533a\u5217\u8868\u4e2d\u79fb\u9664\u3002\u6587\u4ef6\u5939\u4e0e\u4f1a\u8bdd\u8bb0\u5f55\u4f1a\u4fdd\u7559\uff0c\u5176\u4f1a\u8bdd\u5c06\u663e\u793a\u5728\u201c\u672a\u5206\u7ec4\u201d\u4e0b\u3002',
  'delete.pending': '\u6b63\u5728\u5220\u9664\u5de5\u4f5c\u533a\u2026',
  'conflict.named': '\u5df2\u5b58\u5728\u540d\u4e3a\u201c{name}\u201d\u7684\u5de5\u4f5c\u533a\u3002',
  'menu.fork': '\u5206\u53c9\u4f1a\u8bdd',
  'menu.archiveSession': '\u5f52\u6863\u4f1a\u8bdd',
  'actions.workspace.aria': '\u5de5\u4f5c\u533a\u201c{name}\u201d\u7684\u64cd\u4f5c',
  'actions.session.aria': '\u4f1a\u8bdd\u201c{name}\u201d\u7684\u64cd\u4f5c',
  'actions.newSession.aria': '\u5728\u201c{name}\u201d\u4e2d\u65b0\u5efa\u4f1a\u8bdd',
  'status.running': '\u8fdb\u884c\u4e2d',
  'status.subagentsRunning.one': '{n} \u4e2a\u5b50\u4ee3\u7406\u8fd0\u884c\u4e2d',
  'status.subagentsRunning.other': '{n} \u4e2a\u5b50\u4ee3\u7406\u8fd0\u884c\u4e2d',
  'status.idle': '\u7a7a\u95f2',
  'status.waitingApproval': '\u7b49\u5f85\u5ba1\u6279',
  'status.planReview': '\u8ba1\u5212\u5f85\u5ba1',
  'status.waitingAnswer': '\u7b49\u5f85\u56de\u7b54',
  'status.completed': '\u5df2\u5b8c\u6210',
  'schedule.active': '\u6709\u6d3b\u52a8\u5b9a\u65f6\u4efb\u52a1',
  'hover.created': '\u521b\u5efa\u4e8e {time}',
  'hover.copied': '\u5df2\u590d\u5236',
  'date.ymd': '{y}\u5e74{m}\u6708{d}\u65e5',
  'time.now': '\u521a\u521a',
  'time.minutes': '{n}\u5206\u949f',
  'time.hours': '{n}\u5c0f\u65f6',
  'time.days': '{n}\u5929',
  'time.months': '{n}\u4e2a\u6708',
  'time.years': '{n}\u5e74',
  'time.ago': '{t}\u524d',
}

const EN: Record<string, string> = {
  'group.ungrouped': 'Ungrouped',
  'session.new': 'New Session',
  'section.workspaces': 'Workspaces',
  'section.sessions': 'Sessions',
  'viewOptions.label': 'View options',
  'groupBy.label': 'Group by',
  'groupBy.workspace': 'WorkSpace',
  'groupBy.flat': 'In one list',
  'orderBy.label': 'Order by',
  'orderBy.manual': 'Manual',
  'orderBy.updated': 'Last updated',
  'sessions.expand': 'Show {n} more sessions',
  'sessions.collapse': 'Show less',
  'empty.none': 'No sessions yet',
  'empty.noMatches': 'No matches',
  'search.sessions.aria': 'Search sessions',
  'search.placeholder': 'Search sessions...',
  'search.clear': 'Clear search',
  'search.results.aria': 'Search results',
  'search.pending': 'Searching session history…',
  'search.unavailable': 'Content search is temporarily unavailable. Showing name matches.',
  'search.noMatches': 'No matching sessions',
  'search.hasMore': 'Showing the first {n} results. Narrow your search.',
  rename: 'Rename',
  'rename.workspace.title': 'Rename workspace',
  'rename.session.title': 'Rename session',
  'field.workspaceName': 'Workspace name',
  'field.sessionName': 'Session name',
  'delete.workspace': 'Delete workspace',
  'delete.desc':
    'This removes \u201c{name}\u201d from the workspace list. The folder and session logs will be kept. Its sessions will appear under Ungrouped.',
  'delete.pending': 'Deleting workspace…',
  'conflict.named': 'A workspace named \u201c{name}\u201d already exists.',
  'menu.fork': 'Fork session',
  'menu.archiveSession': 'Archive session',
  'actions.workspace.aria': 'Workspace actions for {name}',
  'actions.session.aria': 'Session actions for {name}',
  'actions.newSession.aria': 'New session in {name}',
  'status.running': 'Running',
  'status.subagentsRunning.one': '{n} subagent running',
  'status.subagentsRunning.other': '{n} subagents running',
  'status.idle': 'Idle',
  'status.waitingApproval': 'Waiting for approval',
  'status.planReview': 'Plan awaiting review',
  'status.waitingAnswer': 'Waiting for answer',
  'status.completed': 'Completed',
  'schedule.active': 'Has active scheduled task',
  'hover.created': 'Created {time}',
  'hover.copied': 'Copied',
  'date.ymd': '{y}-{m}-{d}',
  'time.now': 'now',
  'time.minutes': '{n}min',
  'time.hours': '{n}h',
  'time.days': '{n}d',
  'time.months': '{n}mo',
  'time.years': '{n}y',
  'time.ago': '{t} ago',
}

const LOCALE_NS = 'dshOneTree'

// ---------------------------------------------------------------------------
// 样式：数值逐字取自官方 css-module（Rows.module.css / WorkspaceBrowser.module.css），
// 颜色只用官方 token 变量；类名前缀 dshOneTree_ 是本插件自有命名空间。
// ---------------------------------------------------------------------------
const CSS =
  '.dshOneTree_root{--dsh-session-list-edge-inset:var(--dsh-sidebar-inline-padding);--dsh-session-list-scrollbar-width:8px;--dsh-session-list-scrollbar-offset:2px;box-sizing:border-box;min-height:0;padding-right:var(--dsh-session-list-edge-inset);flex-direction:column;flex:1;display:flex}' +
  '.dshOneTree_iconButton{cursor:pointer;width:28px;height:28px;color:var(--dsw-alias-label-secondary);background:0 0;border:none;border-radius:50%;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}' +
  '.dshOneTree_iconButton:hover{background:var(--dsw-alias-interactive-bg-hover)}' +
  '.dshOneTree_sectionHeader{box-sizing:border-box;height:36px;color:var(--dsw-alias-label-tertiary);border-radius:12px;flex:none;justify-content:flex-end;align-items:center;gap:4px;margin-bottom:4px;padding-left:4px;display:flex;overflow:hidden;margin-top:2px;margin-right:-4px}' +
  '.dshOneTree_sectionLabel{white-space:nowrap;opacity:1;visibility:visible;min-width:0;max-width:45%;transition:max-width .18s var(--ds-ease-in-out),margin-right .18s var(--ds-ease-in-out),opacity .12s var(--ds-ease-in-out),transform .18s var(--ds-ease-in-out),visibility 0s linear;flex:none;line-height:20px;overflow:hidden}' +
  '.dshOneTree_sectionLabelHidden{opacity:0;visibility:hidden;max-width:0;margin-right:-4px;transition-delay:0s,0s,0s,0s,.18s;transform:translate(-4px)}' +
  '.dshOneTree_searchSlot{box-sizing:border-box;min-width:0;max-width:28px;transition:max-width .18s var(--ds-ease-in-out),padding-left .18s var(--ds-ease-in-out);flex:1;align-items:center;margin-left:auto;padding-left:0;display:flex}' +
  '.dshOneTree_searchSlotExpanded{max-width:100%;padding-left:0}' +
  '.dshOneTree_headerActions{opacity:1;visibility:visible;max-width:60px;transition:max-width .18s var(--ds-ease-in-out),opacity .12s var(--ds-ease-in-out),transform .18s var(--ds-ease-in-out),visibility 0s linear;flex:none;align-items:center;gap:4px;display:flex;overflow:hidden}' +
  '.dshOneTree_headerActionsHidden{opacity:0;visibility:hidden;pointer-events:none;max-width:0;transition-delay:0s,0s,0s,.18s;transform:translate(4px)}' +
  '.dshOneTree_search{box-sizing:border-box;cursor:text;width:100%;height:28px;color:var(--dsw-alias-label-secondary);transition:width .18s var(--ds-ease-in-out),padding .18s var(--ds-ease-in-out),border-color .18s var(--ds-ease-in-out),background-color .18s var(--ds-ease-in-out);background:0 0;border:none;border-radius:50%;flex:none;align-items:center;gap:0;margin:0;padding:0;display:flex;overflow:hidden}' +
  '.dshOneTree_searchExpanded{border:.5px solid var(--dsw-alias-border-l4);width:calc(100% + 4px);height:30px;color:var(--dsw-alias-label-caption);background:0 0;border-radius:10px;margin-inline:-2px;padding:0 4px 0 0}' +
  '.dshOneTree_searchButton{cursor:pointer;width:28px;height:28px;color:inherit;background:0 0;border:none;border-radius:50%;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}' +
  '.dshOneTree_searchExpanded .dshOneTree_searchButton{width:28px;height:30px}' +
  '.dshOneTree_searchButton:hover{background:var(--dsw-alias-interactive-bg-hover)}' +
  '.dshOneTree_searchExpanded .dshOneTree_searchButton:hover{background:0 0}' +
  '.dshOneTree_searchInput{opacity:0;pointer-events:none;width:0;min-width:0;color:var(--dsw-alias-label-primary);transition:opacity .12s var(--ds-ease-in-out);background:0 0;border:none;outline:none;flex:1;font-size:13px;line-height:18px}' +
  '.dshOneTree_searchExpanded .dshOneTree_searchInput{opacity:1;pointer-events:auto;margin-left:-2px}' +
  '.dshOneTree_searchInput::placeholder{color:var(--dsw-alias-label-tertiary)}' +
  '.dshOneTree_clearButton{cursor:pointer;width:24px;height:24px;color:var(--dsw-alias-label-secondary);background:0 0;border:none;border-radius:50%;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}' +
  '.dshOneTree_clearButton:hover{background:var(--dsw-alias-interactive-bg-hover)}' +
  '.dshOneTree_listArea{min-height:0;margin-left:-4px;margin-right:calc(-1 * var(--dsh-session-list-edge-inset));flex-direction:column;flex:1;padding-left:4px;display:flex;overflow:visible}' +
  '.dshOneTree_list{min-height:0;margin-left:-4px;margin-right:var(--dsh-session-list-scrollbar-offset);padding-left:4px;padding-right:calc(var(--dsh-session-list-edge-inset) - var(--dsh-session-list-scrollbar-width) - var(--dsh-session-list-scrollbar-offset));scrollbar-gutter:stable;flex:1;padding-bottom:16px;overflow-y:auto}' +
  '.dshOneTree_flatList>*+*,.dshOneTree_groupSection>*+*{margin-top:2px}' +
  '.dshOneTree_groupSection{position:relative}' +
  '.dshOneTree_groupSection+.dshOneTree_groupSection{margin-top:4px}' +
  '.dshOneTree_searchStatus,.dshOneTree_searchWarning{color:var(--dsw-alias-label-tertiary);padding:10px 12px;font-size:12px;line-height:18px}' +
  '.dshOneTree_searchWarning{color:var(--dsw-alias-label-secondary)}' +
  '.dshOneTree_empty{color:var(--dsw-alias-label-tertiary);padding:16px 12px;font-size:13px}' +
  '.dshOneTree_sessionOverflowButton{cursor:pointer;text-align:left;width:100%;height:28px;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:8px;padding:0 12px 0 28px;font-size:12px}' +
  '.dshOneTree_sessionOverflowButton:hover{color:var(--dsw-alias-label-secondary);background:0 0}' +
  '.dshOneTree_projectRow,.dshOneTree_sessionRow{cursor:pointer;user-select:none;color:var(--dsw-alias-label-primary);border-radius:8px;align-items:center;gap:6px;padding:0 8px;display:flex}' +
  '.dshOneTree_projectRow:hover,.dshOneTree_sessionRow:hover,.dshOneTree_sessionRow.dshOneTree_selected,.dshOneTree_projectRow.dshOneTree_menuOpen,.dshOneTree_sessionRow.dshOneTree_menuOpen{background:var(--dsw-alias-interactive-bg-hover)}' +
  '.dshOneTree_projectRow{box-sizing:border-box;align-items:center;height:34px}' +
  '.dshOneTree_projectRow .dshOneTree_rowActions{height:20px}' +
  '.dshOneTree_sessionRow{height:32px;gap:0}' +
  '.dshOneTree_sessionRow .dshOneTree_title{flex:1;margin:0 6px 0 4px}' +
  '.dshOneTree_flatRowWithoutStatus .dshOneTree_title{margin-left:0}' +
  '.dshOneTree_slot{width:16px;height:20px;color:var(--dsw-alias-label-tertiary);flex:none;justify-content:center;align-items:center;display:inline-flex}' +
  '.dshOneTree_visuallyHidden{clip:rect(0 0 0 0);white-space:nowrap;width:1px;height:1px;position:absolute;overflow:hidden}' +
  '.dshOneTree_folderActive{color:var(--dsw-alias-state-business-primary)}' +
  '.dshOneTree_projectRow .dshOneTree_chevron{display:none}' +
  '.dshOneTree_projectRow:hover .dshOneTree_chevron{display:inline-flex}' +
  '.dshOneTree_projectRow:hover .dshOneTree_folder{display:none}' +
  '.dshOneTree_arrow{transition:transform .15s var(--ds-ease-in-out)}' +
  '.dshOneTree_arrowOpen{transform:rotate(90deg)}' +
  '.dshOneTree_projectText{flex-direction:column;flex:1;gap:2px;min-width:0;display:flex}' +
  '.dshOneTree_title{text-overflow:ellipsis;white-space:nowrap;min-width:0;font-size:14px;line-height:20px;overflow:hidden}' +
  '.dshOneTree_time{color:var(--dsw-alias-label-tertiary);flex:none;font-size:12px;line-height:20px}' +
  '.dshOneTree_scheduleIndicator{width:16px;height:20px;color:var(--dsw-alias-label-tertiary);flex:none;justify-content:center;align-items:center;margin-right:6px;display:inline-flex}' +
  '.dshOneTree_dot{flex:none}' +
  '.dshOneTree_rowActions{flex:none;align-items:center;gap:12px;display:none}' +
  '.dshOneTree_projectRow:hover .dshOneTree_rowActions,.dshOneTree_sessionRow:hover .dshOneTree_rowActions,.dshOneTree_projectRow.dshOneTree_menuOpen .dshOneTree_rowActions,.dshOneTree_sessionRow.dshOneTree_menuOpen .dshOneTree_rowActions{display:inline-flex}' +
  '.dshOneTree_sessionRow:hover .dshOneTree_time,.dshOneTree_sessionRow.dshOneTree_menuOpen .dshOneTree_time{display:none}' +
  '.dshOneTree_rowIconButton{cursor:pointer;width:16px;height:16px;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:4px;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}' +
  '.dshOneTree_rowIconButton:hover{color:var(--dsw-alias-label-primary)}' +
  '.dshOneTree_chevron{color:var(--dsw-alias-label-caption)}' +
  '.dshOneTree_searchRow{box-sizing:border-box;cursor:pointer;text-align:left;width:100%;min-height:48px;color:var(--dsw-alias-label-primary);background:0 0;border:none;border-radius:8px;flex-direction:column;align-items:stretch;padding:4px 8px;display:flex}' +
  '.dshOneTree_searchRow:hover,.dshOneTree_searchRow.dshOneTree_selected{background:var(--dsw-alias-interactive-bg-hover)}' +
  '.dshOneTree_searchRowHeading{align-items:center;min-width:0;display:flex}' +
  '.dshOneTree_searchRowTitle{text-overflow:ellipsis;white-space:nowrap;flex:0 auto;min-width:0;margin-left:4px;font-size:14px;line-height:20px;overflow:hidden}' +
  '.dshOneTree_searchRowMeta{align-items:center;gap:6px;min-width:0;margin-left:20px;display:flex}' +
  '.dshOneTree_searchRowWorkspace,.dshOneTree_searchRowSnippet{text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:17px;overflow:hidden}' +
  '.dshOneTree_searchRowWorkspace{max-width:40%;color:var(--dsw-alias-label-tertiary);flex:none}' +
  '.dshOneTree_searchRowSnippet{min-width:0;color:var(--dsw-alias-label-secondary);flex:1}' +
  '.dshOneTree_hoverContent{flex-direction:column;gap:8px;display:flex}' +
  '.dshOneTree_hoverTitle{color:#fff;overflow-wrap:break-word;font-size:14px;line-height:20px}' +
  '.dshOneTree_hoverPath{color:#cfd3d6;word-break:break-all;font-size:12px;line-height:16px}' +
  '.dshOneTree_hoverTime{color:#cfd3d6;font-size:12px;line-height:16px}' +
  '.dshOneTree_hoverStatus{color:#adb2b8;align-items:center;gap:8px;font-size:12px;line-height:20px;display:flex}' +
  '.dshOneTree_renameInput{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);width:100%;height:44px;color:var(--dsw-alias-label-primary);background:0 0;border-radius:22px;outline:none;padding:7px 14px;font-size:14px;font-weight:400;line-height:22px}' +
  '.dshOneTree_renameError{color:var(--dsw-alias-state-error-primary);margin-top:8px;font-size:12px;line-height:18px}' +
  '.dshOneTree_deleteStatus{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}' +
  '.dshOneTree_deleteAction:not(:disabled){color:var(--dsw-alias-state-error-primary)}'
const CSS_TAG_ID = '@dsh-one/vscode-workspace-tree/Tree.css'
if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`) === null) {
  const tag = document.createElement('style')
  tag.dataset.plugin = '@dsh-one/vscode-workspace-tree'
  tag.dataset.pluginCss = CSS_TAG_ID
  tag.textContent = CSS
  document.head.append(tag)
}

// ---------------------------------------------------------------------------
// 类型（本地最小面：官方私包的精确类型不在本仓库）
// ---------------------------------------------------------------------------

type Translate = (key: string, params?: Record<string, string | number>) => string

interface WorkspaceSnapshotLike {
  readonly items: readonly WorkspaceViewLike[]
  readonly archivedSessionIds: readonly string[]
  readonly phase: 'pending' | 'ready'
  readonly state: 'idle' | 'loading' | 'error'
}

interface WorkspaceViewLike {
  readonly workspaceId: string
  readonly path: string
  readonly title: string
  readonly sessionIds: readonly string[]
  readonly createdAt: string
}

/** 等待态快照：官方 UiSession 暴露的 Map（会话 id → {kind}）。 */
type PendingMap = ReadonlyMap<string, { readonly kind?: string }>

/** 一页宿主内容搜索结果（官方 `session.search` 的返回体）。 */
interface SearchPage {
  readonly items: readonly { readonly id: string; readonly snippet?: string }[]
  readonly hasMore: boolean
}

/**
 * 组件 props：官方 WorkspaceBrowser 的同一组槽位（owner share `wide` +
 * 框架标准钩子 + entry 自己 inject 出来的动作 + locale 槽位）。命名与官方保持
 * 一致，便于对照源码阅读。
 */
interface TreeProps {
  /** 侧栏壳给的宽度形态：宽列（true）渲染整块浏览区。自有 frame 恒传 true。 */
  wide?: boolean
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
}

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

/** 官方 `timeLabel`：紧凑相对时间（「刚刚」「5分钟」）。 */
function timeLabel(updatedAt: number, now: number, tr: Translate): string {
  const { unit, n } = relativeTime(updatedAt, now)
  return unit === 'now' ? tr('time.now') : tr(`time.${unit}`, { n })
}

/** 官方 `hoverTimeLabel`：悬停卡里包一层「…前」模板（now 档不包）。 */
function hoverTimeLabel(updatedAt: number, now: number, tr: Translate): string {
  const { unit, n } = relativeTime(updatedAt, now)
  return unit === 'now' ? tr('time.now') : tr('time.ago', { t: tr(`time.${unit}`, { n }) })
}

/** 官方 `createdLabel`：绝对创建时刻走词典日期模板（不用 toLocaleString，避免跟浏览器语言跑）。 */
function createdLabel(createdAt: number, tr: Translate): string {
  const d = new Date(createdAt)
  const pad2 = (v: number): string => String(v).padStart(2, '0')
  return tr('hover.created', {
    time: `${tr('date.ymd', { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() })} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
  })
}

/** 官方 `displayTitle`：空白会话显示「新会话」。 */
function displayTitle(node: SessionNode, tr: Translate): string {
  return node.blank ? tr('session.new') : node.title
}

// ---------------------------------------------------------------------------
// 树的行组件（官方 rows/Rows.js 与 rows/WorkspaceBrowser.js 的同构复刻：
// DOM 结构与 class 语义一一对应，类名换成自有前缀）
// ---------------------------------------------------------------------------

const COLLAPSED_SESSION_LIMIT = 5
const SEARCH_DEBOUNCE_MS = 250
const SEARCH_QUERY_MAX = 500

/** 官方 `collapsedSessionRows`：空白会话不占普通行额度，其余最多 5 行。 */
function collapsedSessionRows(sessions: readonly SessionNode[]): { rows: readonly SessionNode[]; hiddenCount: number } {
  let ordinary = 0
  const rows = sessions.filter((session) => {
    if (session.blank) return true
    if (ordinary >= COLLAPSED_SESSION_LIMIT) return false
    ordinary += 1
    return true
  })
  return { rows, hiddenCount: sessions.length - rows.length }
}

/** 官方 `toggled`：不可变数组开关。 */
function toggled(list: readonly string[], key: string): string[] {
  return list.includes(key) ? list.filter((k) => k !== key) : [...list, key]
}

/** 官方 `sanitizeSearchQuery`：去掉 NUL 并截到 wire 上限。 */
function sanitizeQuery(value: string): string {
  const withoutNul = value.replaceAll('\0', '')
  return withoutNul.length <= SEARCH_QUERY_MAX ? withoutNul : withoutNul.slice(0, SEARCH_QUERY_MAX)
}

/** 主状态点 + 全部状态的读屏标签（官方 `SessionStatusDots`）。 */
function SessionStatusDots({ statuses, tr }: { statuses: ReturnType<typeof sessionStatuses>; tr: Translate }): unknown {
  const labels = statuses.map((status) =>
    h(
      'span',
      { className: 'dshOneTree_visuallyHidden', key: status.labelKey },
      status.labelCount === undefined ? tr(status.labelKey) : tr(status.labelKey, { n: status.labelCount }),
    ),
  )
  return h('span', { className: 'dshOneTree_slot' }, h(StateDot, { state: statuses[0].state, className: 'dshOneTree_dot' }), labels)
}

/** 会话行悬停卡（官方 `SessionHoverContent`）：标题 + 相对时间 + 每条活状态。 */
function SessionHoverContent({ node, now, tr }: { node: SessionNode; now: number; tr: Translate }): unknown {
  const statuses = sessionStatuses(node)
  return h(
    'div',
    { className: 'dshOneTree_hoverContent' },
    h('div', { className: 'dshOneTree_hoverTitle' }, displayTitle(node, tr)),
    node.blank ? null : h('div', { className: 'dshOneTree_hoverTime' }, hoverTimeLabel(node.updatedAt, now, tr)),
    statuses.map((status) =>
      h(
        'div',
        { className: 'dshOneTree_hoverStatus', key: status.labelKey },
        h(StateDot, { state: status.state }),
        h('span', null, status.labelCount === undefined ? tr(status.labelKey) : tr(status.labelKey, { n: status.labelCount })),
      ),
    ),
  )
}

/** 工作区行悬停卡（官方 `WorkspaceHoverContent`）：标题 + 路径 + 创建时刻。 */
function WorkspaceHoverContent({
  label,
  cwd,
  createdAt,
  tr,
}: {
  label: string
  cwd?: string
  createdAt?: number
  tr: Translate
}): unknown {
  return h(
    'div',
    { className: 'dshOneTree_hoverContent' },
    h('div', { className: 'dshOneTree_hoverTitle' }, label),
    cwd === undefined ? null : h('div', { className: 'dshOneTree_hoverPath' }, cwd),
    createdAt === undefined ? null : h('div', { className: 'dshOneTree_hoverTime' }, createdLabel(createdAt, tr)),
  )
}

/** 分组头行（官方 `ProjectRowItem`）：文件夹 ⇄ 折叠箭头（悬停换位）+ 标题 + 悬停操作。 */
function ProjectRow({
  group,
  tr,
  expanded,
  onToggle,
  onCreate,
  onRename,
  onDelete,
}: {
  group: GroupNode
  tr: Translate
  expanded: boolean
  onToggle: () => void
  onCreate: () => void
  onRename?: () => void
  onDelete?: () => void
}): unknown {
  const [menuOpen, setMenuOpen] = useState(false)
  const label = group.workspaceId === undefined ? tr('group.ungrouped') : group.label
  const active = expanded && group.containsCurrent
  const menuItems =
    onRename === undefined || onDelete === undefined
      ? null
      : [
          { id: 'rename', label: tr('rename'), icon: h(IconEditOutline16, {}) },
          { id: 'delete', label: tr('delete.workspace'), icon: h(IconTrashOutline16, {}), danger: true },
        ]
  const anchor = h(
    'button',
    {
      type: 'button',
      className: 'dshOneTree_rowIconButton',
      'aria-label': tr('actions.workspace.aria', { name: label }),
      onClick: (event: { stopPropagation(): void }) => {
        event.stopPropagation()
        setMenuOpen((open: boolean) => !open)
      },
    },
    h(IconEllipsisOutline16, {}),
  )
  const row = h(
    'div',
    {
      className: `dshOneTree_projectRow${menuOpen ? ' dshOneTree_menuOpen' : ''}`,
      role: 'treeitem',
      'aria-expanded': expanded,
      'data-dshone-tree-row': 'workspace',
      'data-dshone-tree-count': group.sessionCount,
      onClick: onToggle,
      children: [
        h(
          'span',
          {
            key: 'folder',
            className: `dshOneTree_slot dshOneTree_folder${active ? ' dshOneTree_folderActive' : ''}`,
            children: expanded ? h(IconFolderOpen16, {}) : h(IconFolderClose16, {}),
          },
        ),
        h('span', {
          key: 'chevron',
          className: 'dshOneTree_slot dshOneTree_chevron',
          children: h(IconTriangleRightFill14, {
            className: `dshOneTree_arrow${expanded ? ' dshOneTree_arrowOpen' : ''}`,
          }),
        }),
        h('span', {
          key: 'text',
          className: 'dshOneTree_projectText',
          children: h('span', { className: 'dshOneTree_title' }, label),
        }),
        h('span', {
          key: 'actions',
          className: 'dshOneTree_rowActions',
          children: [
            menuItems === null
              ? null
              : h(Menu, {
                  key: 'menu',
                  open: menuOpen,
                  onClose: () => setMenuOpen(false),
                  items: menuItems,
                  onSelect: (id: string) => {
                    setMenuOpen(false)
                    if (id === 'rename') onRename?.()
                    if (id === 'delete') onDelete?.()
                  },
                  portal: true,
                  closeOnPointerLeave: true,
                  anchor,
                }),
            h(
              'button',
              {
                key: 'new',
                type: 'button',
                className: 'dshOneTree_rowIconButton',
                'aria-label': tr('actions.newSession.aria', { name: label }),
                onClick: (event: { stopPropagation(): void }) => {
                  event.stopPropagation()
                  onCreate()
                },
              },
              h(IconPlusOutline16, {}),
            ),
          ],
        }),
      ],
    },
  )
  if (group.createdAt === undefined) return row
  return h(HoverCard, {
    anchor: row,
    content: h(WorkspaceHoverContent, { label: group.label, cwd: group.cwd, createdAt: group.createdAt, tr }),
    disabled: menuOpen,
    copyText: group.cwd,
    copyLabel: tr('copy'),
    copiedLabel: tr('hover.copied'),
  })
}

/** 会话行（官方 `SessionNodeItem`）：状态点 + 标题 + （定时标记）+ 相对时间 + 悬停操作。 */
function SessionRow({
  node,
  currentId,
  now,
  flat,
  tr,
  onOpen,
  onRename,
  onFork,
  onArchive,
}: {
  node: SessionNode
  currentId?: string
  now: number
  flat: boolean
  tr: Translate
  onOpen: () => void
  onRename: (title: string) => void
  onFork: () => void
  onArchive: () => void
}): unknown {
  const [menuOpen, setMenuOpen] = useState(false)
  const title = displayTitle(node, tr)
  const selected = node.id === currentId
  const statuses = sessionStatuses(node)
  const showStatus = showsStatusDot(statuses, node.completed)
  const menuItems = [
    { id: 'rename', label: tr('rename'), icon: h(IconEditOutline16, {}) },
    { id: 'fork', label: tr('menu.fork'), icon: h(IconBranchOutline16, {}) },
    { id: 'archive', label: tr('menu.archiveSession'), icon: h(IconArchiveOutline20, { size: 16 }) },
  ]
  const anchor = h(
    'button',
    {
      type: 'button',
      className: 'dshOneTree_rowIconButton',
      'aria-label': tr('actions.session.aria', { name: title }),
      onClick: (event: { stopPropagation(): void }) => {
        event.stopPropagation()
        setMenuOpen((open: boolean) => !open)
      },
    },
    h(IconEllipsisOutline16, {}),
  )
  const row = h(
    'div',
    {
      className:
        `dshOneTree_sessionRow${selected ? ' dshOneTree_selected' : ''}${menuOpen ? ' dshOneTree_menuOpen' : ''}` +
        `${flat && !showStatus ? ' dshOneTree_flatRowWithoutStatus' : ''}`,
      role: 'treeitem',
      'aria-selected': selected,
      'data-dshone-tree-row': 'session',
      onClick: onOpen,
      children: [
        !flat || showStatus ? (showStatus ? h(SessionStatusDots, { key: 'status', statuses, tr }) : h('span', { key: 'status', className: 'dshOneTree_slot' })) : null,
        h('span', { key: 'title', className: 'dshOneTree_title' }, title),
        node.blank
          ? null
          : h('span', {
              key: 'time',
              className: 'dshOneTree_time',
              children: timeLabel(node.updatedAt, now, tr),
            }),
        node.blank
          ? null
          : h('span', {
              key: 'actions',
              className: 'dshOneTree_rowActions',
              children: h(Menu, {
                open: menuOpen,
                onClose: () => setMenuOpen(false),
                items: menuItems,
                onSelect: (id: string) => {
                  setMenuOpen(false)
                  if (id === 'rename') onRename(node.title)
                  if (id === 'fork') onFork()
                  if (id === 'archive') onArchive()
                },
                portal: true,
                closeOnPointerLeave: true,
                anchor,
              }),
            }),
      ],
    },
  )
  return h(HoverCard, {
    anchor: row,
    content: h(SessionHoverContent, { node, now, tr }),
    disabled: menuOpen,
    copyText: node.blank ? undefined : node.title,
    copyLabel: tr('copy'),
    copiedLabel: tr('hover.copied'),
  })
}

/** 搜索结果行（官方 `SearchResultItem`）：标题 + 工作区 + 内容片段。 */
function SearchResultRow({
  node,
  workspaceLabel,
  snippet,
  selected,
  tr,
  onOpen,
}: {
  node: SessionNode
  workspaceLabel: string
  snippet?: string
  selected: boolean
  tr: Translate
  onOpen: () => void
}): unknown {
  const statuses = sessionStatuses(node)
  const showStatus = showsStatusDot(statuses, node.completed)
  return h(
    'button',
    {
      type: 'button',
      className: `dshOneTree_searchRow${selected ? ' dshOneTree_selected' : ''}`,
      role: 'treeitem',
      'aria-selected': selected,
      onClick: onOpen,
      children: [
        h('span', {
          key: 'heading',
          className: 'dshOneTree_searchRowHeading',
          children: [
            showStatus
              ? h(SessionStatusDots, { key: 'status', statuses, tr })
              : h('span', { key: 'status', className: 'dshOneTree_slot' }),
            h('span', { key: 'title', className: 'dshOneTree_searchRowTitle' }, displayTitle(node, tr)),
          ],
        }),
        h('span', {
          key: 'meta',
          className: 'dshOneTree_searchRowMeta',
          children: [
            h('span', { key: 'ws', className: 'dshOneTree_searchRowWorkspace' }, workspaceLabel || tr('group.ungrouped')),
            snippet === undefined || snippet === ''
              ? null
              : h('span', { key: 'snip', className: 'dshOneTree_searchRowSnippet' }, snippet),
          ],
        }),
      ],
    },
  )
}

/** 视图选项菜单（官方 `ViewOptionsMenu`）：分组方式 + 排序方式两节。 */
function ViewOptionsMenu({
  groupBy,
  orderBy,
  tr,
  onGroupPick,
  onOrderPick,
}: {
  groupBy: 'workspace' | 'flat'
  orderBy: 'manual' | 'updated'
  tr: Translate
  onGroupPick: (mode: 'workspace' | 'flat') => void
  onOrderPick: (mode: 'manual' | 'updated') => void
}): unknown {
  const [open, setOpen] = useState(false)
  return h(Menu, {
    open,
    onClose: () => setOpen(false),
    items: [
      { type: 'label', id: 'group-by', text: tr('groupBy.label') },
      { id: 'workspace', label: tr('groupBy.workspace') },
      { id: 'flat', label: tr('groupBy.flat') },
      { type: 'separator', id: 'order-by-separator' },
      { type: 'label', id: 'order-by', text: tr('orderBy.label') },
      { id: 'manual', label: tr('orderBy.manual') },
      { id: 'updated', label: tr('orderBy.updated') },
    ],
    selectedIds: [groupBy, orderBy],
    onSelect: (id: string) => {
      if (id === 'workspace' || id === 'flat') onGroupPick(id)
      else if (id === 'manual' || id === 'updated') onOrderPick(id)
      setOpen(false)
    },
    align: 'end',
    dense: true,
    portal: true,
    anchor: h(Tooltip, {
      label: tr('viewOptions.label'),
      side: 'bottom',
      delayMs: 500,
      children: h(
        'button',
        {
          type: 'button',
          className: 'dshOneTree_iconButton',
          'aria-label': tr('viewOptions.label'),
          'data-dshone-tree-action': 'view-options',
          onClick: () => setOpen((v: boolean) => !v),
        },
        h(IconPersonalizationOutline16, {}),
      ),
    }),
  })
}

/** 重命名对话框（官方同款 Modal + Button + 圆形输入框）。 */
function RenameModal({
  open,
  titleKey,
  fieldKey,
  initial,
  tr,
  onSubmit,
  onClose,
}: {
  open: boolean
  titleKey: string
  fieldKey: string
  initial: string
  tr: Translate
  onSubmit: (value: string) => Promise<void>
  onClose: () => void
}): unknown {
  const [draft, setDraft] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastOpen = useRef(false)
  useEffect(() => {
    if (open && !lastOpen.current) {
      setDraft(initial)
      setError(null)
      setBusy(false)
    }
    lastOpen.current = open
  }, [open, initial])
  const commit = (): void => {
    if (busy) return
    setBusy(true)
    setError(null)
    onSubmit(draft.trim())
      .then(() => {
        setBusy(false)
        onClose()
      })
      .catch((reason: unknown) => {
        setBusy(false)
        setError(reason instanceof Error ? reason.message : String(reason))
      })
  }
  return h(Modal, {
    open,
    onClose,
    closeLabel: tr('close'),
    title: tr(titleKey),
    footer: h(
      'div',
      { style: { display: 'flex', gap: '8px' } },
      h(Button, { variant: 'outline', disabled: busy, onClick: onClose }, tr('cancel')),
      h(Button, { variant: 'primary', disabled: busy || draft.trim() === '', onClick: commit }, tr('rename')),
    ),
    children: [
      h('input', {
        className: 'dshOneTree_renameInput',
        value: draft,
        'aria-label': tr(fieldKey),
        autoFocus: true,
        disabled: busy,
        onChange: (e: { target: { value: string } }) => {
          setDraft(e.target.value)
          setError(null)
        },
        onKeyDown: (e: { key: string; preventDefault(): void }) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          }
        },
      }),
      error === null ? null : h('div', { className: 'dshOneTree_renameError', role: 'alert' }, error),
    ],
  })
}

/** 删除工作区确认对话框（官方同款，只是动作走官方 workspaces.delete）。 */
function DeleteWorkspaceModal({
  target,
  tr,
  onSubmit,
  onClose,
}: {
  target: { workspaceId: string; title: string } | null
  tr: Translate
  onSubmit: (workspaceId: string) => Promise<void>
  onClose: () => void
}): unknown {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const commit = (): void => {
    if (busy || target === null) return
    setBusy(true)
    setError(null)
    onSubmit(target.workspaceId)
      .then(() => {
        setBusy(false)
        onClose()
      })
      .catch((reason: unknown) => {
        setBusy(false)
        setError(reason instanceof Error ? reason.message : String(reason))
      })
  }
  return h(Modal, {
    open: target !== null,
    onClose,
    closeLabel: tr('close'),
    title: tr('delete.workspace'),
    ...(target === null ? {} : { description: tr('delete.desc', { name: target.title }) }),
    footer: h(
      'div',
      { style: { display: 'flex', gap: '8px' } },
      h(Button, { variant: 'outline', disabled: busy, onClick: onClose }, tr('cancel')),
      h(Button, { variant: 'outline', disabled: busy, onClick: commit, className: 'dshOneTree_deleteAction' }, tr('delete.workspace')),
    ),
    children: [
      busy ? h('div', { className: 'dshOneTree_deleteStatus', role: 'status' }, tr('delete.pending')) : null,
      error === null ? null : h('div', { className: 'dshOneTree_renameError', role: 'alert' }, error),
    ],
  })
}

// ---------------------------------------------------------------------------
// 主组件（官方 `WorkspaceBrowser` 的同构复刻）
// ---------------------------------------------------------------------------

interface SearchState {
  items: readonly { id: string; snippet?: string }[]
  hasMore: boolean
  pending: boolean
  failed: boolean
}

const EMPTY_SEARCH: SearchState = { items: [], hasMore: false, pending: false, failed: false }

function WorkspaceTree(props: TreeProps): unknown {
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
  } = props
  const tr = t
  const now = Date.now()
  const list = useSessions((state) => state)
  const workspaces = useWorkspaces((state) => state.items)
  const workspacePhase = useWorkspaces((state) => state.phase)
  const archivedSessionIds = useWorkspaces((state) => state.archivedSessionIds)
  const pending = useSessionPendingInteraction((state) => state)
  const directoryFlowAvailable = useDirectoryFlow === undefined ? false : useDirectoryFlow((occupied: boolean) => occupied)

  const [groupBy, setGroupBy] = useState<'workspace' | 'flat'>('workspace')
  const [orderBy, setOrderBy] = useState<'manual' | 'updated'>('manual')
  const [groupExpansion, setGroupExpansion] = useState<Record<string, boolean>>({})
  const [expandedSessionGroups, setExpandedSessionGroups] = useState<readonly string[]>([])
  const [query, setQuery] = useState('')
  const [searchExpanded, setSearchExpanded] = useState(false)
  const [content, setContent] = useState<SearchState>(EMPTY_SEARCH)
  const [renameTarget, setRenameTarget] = useState<{ workspaceId: string; title: string } | null>(null)
  const [sessionRenameTarget, setSessionRenameTarget] = useState<{ id: string; title: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ workspaceId: string; title: string } | null>(null)
  const searchInput = useRef<{ focus(): void } | null>(null)
  const searchRoot = useRef<HTMLDivElement | null>(null)

  // 当前会话所在分组默认展开（官方同款：只在一条分组从未被显式收/展过时自动展开）。
  useEffect(() => {
    if (list.current === undefined || workspacePhase !== 'ready') return
    const key = owningGroupKey(workspaces, list.current)
    setGroupExpansion((prev) => (Object.hasOwn(prev, key) ? prev : { ...prev, [key]: true }))
  }, [list.current, workspaces, workspacePhase])

  // 搜索：输入住手 250ms 后打官方 `sessions.search`（宿主内容索引），失败降级为本地匹配。
  const trimmedQuery = query.trim()
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
  const expandedGroups = Object.entries(groupExpansion)
    .filter(([, expanded]) => expanded)
    .map(([key]) => key)
  const groups = deriveGroups(list, workspaces, archivedSessionIds, pending, { expandedGroups })
  const flatRows = withOrder(deriveFlat(list, archivedSessionIds, pending))

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
                tr,
                onOpen: () => openSession(row.id),
                onRename: (title: string) => setSessionRenameTarget({ id: row.id, title }),
                onFork: () => forkSession(row.id),
                onArchive: () => void archiveSession(row.id).catch(() => {}),
              }),
            ),
          )
        : h(
            'div',
            { role: 'tree', 'data-dshone-tree': 'groups' },
            groups.map((group) =>
              h(
                'div',
                { className: 'dshOneTree_groupSection', key: group.key },
                h(ProjectRow, {
                  group,
                  tr,
                  expanded: groupExpansion[group.key] === true,
                  onToggle: () => setGroupExpansion((prev) => ({ ...prev, [group.key]: prev[group.key] !== true })),
                  onCreate: () => startSession(group.workspaceId),
                  ...(group.workspaceId === undefined
                    ? {}
                    : {
                        onRename: () => setRenameTarget({ workspaceId: group.workspaceId as string, title: group.label }),
                        onDelete: () => setDeleteTarget({ workspaceId: group.workspaceId as string, title: group.label }),
                      }),
                }),
                ...(() => {
                  const expanded = expandedSessionGroups.includes(group.key)
                  const limited = expanded ? { rows: group.sessions, hiddenCount: 0 } : collapsedSessionRows(group.sessions)
                  const ordered = withOrder(limited.rows)
                  const rows = ordered.map((row) =>
                    h(SessionRow, {
                      key: row.id,
                      node: row,
                      ...(list.current === undefined ? {} : { currentId: list.current }),
                      now,
                      flat: false,
                      tr,
                      onOpen: () => openSession(row.id),
                      onRename: (title: string) => setSessionRenameTarget({ id: row.id, title }),
                      onFork: () => forkSession(row.id),
                      onArchive: () => void archiveSession(row.id).catch(() => {}),
                    }),
                  )
                  if (limited.hiddenCount > 0) {
                    rows.push(
                      h(
                        'button',
                        {
                          key: 'overflow',
                          type: 'button',
                          className: 'dshOneTree_sessionOverflowButton',
                          onClick: () => setExpandedSessionGroups((prev) => toggled(prev, group.key)),
                        },
                        tr('sessions.expand', { n: limited.hiddenCount }),
                      ),
                    )
                  } else if (expanded && group.sessions.length > COLLAPSED_SESSION_LIMIT) {
                    rows.push(
                      h(
                        'button',
                        {
                          key: 'overflow',
                          type: 'button',
                          className: 'dshOneTree_sessionOverflowButton',
                          onClick: () => setExpandedSessionGroups((prev) => toggled(prev, group.key)),
                        },
                        tr('sessions.collapse'),
                      ),
                    )
                  }
                  return rows
                })(),
              ),
            ),
          )

  return h(
    'div',
    { className: 'dshOneTree_root', 'data-shell': 'dsh-one-tree', 'data-dshone-tree': 'root' },
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
            value: query,
            tabIndex: searchExpanded ? 0 : -1,
            onChange: (event: { target: { value: string } }) => setQuery(sanitizeQuery(event.target.value)),
            onKeyDown: (event: { key: string }) => {
              if (event.key !== 'Escape') return
              setQuery('')
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
                    setQuery('')
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
        h(ViewOptionsMenu, { groupBy, orderBy, tr, onGroupPick: setGroupBy, onOrderPick: setOrderBy }),
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
    h(DeleteWorkspaceModal, {
      target: deleteTarget,
      tr,
      onClose: () => setDeleteTarget(null),
      onSubmit: (workspaceId: string) => deleteWorkspace(workspaceId),
    }),
  )
}

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
    const uiWorkspace = (): UiWorkspaceService | undefined =>
      (ctx as unknown as { uiWorkspace?: UiWorkspaceService }).uiWorkspace
    const directoryFlow = {
      getSnapshot: (): boolean => (ctx.slots.entries?.('sidebar.workspaces.directoryFlow').length ?? 0) > 0,
      subscribe: (listener: () => void): (() => void) =>
        ctx.slots.subscribe === undefined ? () => {} : ctx.slots.subscribe('sidebar.workspaces.directoryFlow', listener),
    }
    return {
      hooks: { directoryFlow },
      // 官方 sessions 服务：选中会话（镜像官方 ui-workspace 的 openSession，
      // 不调 layout.selectPanel——自有侧栏树没有主面板概念）。
      open: (sessionId: string): void => {
        sessions.open(sessionId)
      },
      // 工作区行的「+」：官方 uiWorkspace.startSession 的语义（它依赖 layout 服务的
      // beginNavigation/selectPanel，自有 layout 桩没有这两件，故按同一语义直接
      // 用 sessions 服务实现）。
      startSession: (workspaceId?: string): void => {
        if (workspaceId === undefined) return
        void startSessionIn(workspaceId)
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
      forkSession: (sessionId: string): void => {
        void sessions
          .fork({ sessionId, increaseTitle: true })
          .then((childId) => sessions.open(childId))
          .catch(() => {})
      },
      archiveSession: (sessionId: string): Promise<void> => workspaces.archiveSession(sessionId),
      renameWorkspace: (workspaceId: string, title: string): Promise<unknown> => workspaces.rename(workspaceId, title),
      deleteWorkspace: (workspaceId: string): Promise<void> => workspaces.delete(workspaceId),
      // 官方 uiWorkspace.pickDirectory：宿主原生选择器（官方另经
      // sidebar.workspaces.directoryFlow 槽位让可替换的选择器接管；我们的 entry
      // 无法渲染该子槽，故直调服务）。
      addWorkspace: (): void => {
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
    }
  }

  ctx.effect(() => {
    const disposeLocale = ctx.locale.register(LOCALE_NS, { zh: ZH, en: EN })
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
    return () => {
      disposeInject()
      disposeLocale()
    }
  }, 'dsh-one workspace tree: shadow sidebar.workspaces')
}
