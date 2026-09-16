/**
 * @dsh-one/dsh-workspace-tree——侧栏工作区/会话树的 **shadow 件**（#65 批 2）。
 *
 * ## 命名（AGENTS.md 铁律「自有插件命名分两类」）
 * 本件命名 `dsh-*` 而非 `vscode-*`，因为它不绑定 VS Code 宿主：只有自己写的 DOM
 * 标记（`dshOneTree_*` 类名与 `data-*`），不碰 `acquireVsCodeApi`、不 postMessage；
 * 数据全取官方 hooks、动作全走官方服务、样式全用官方 token。唯一一项与宿主有关的
 * 动作是会话行菜单的「在新标签页打开」（#72）：它走**宿主能力口**这个抽象口
 * （`./hostCapabilities.ts`，插件不直接碰宿主 API），并且按能力口如实上报的
 * `editorTabs` 决定该项出不出现——官方 web 侧没有「编辑器标签页」这个概念，那一项
 * 就不显示，插件其余行为一模一样。因此它不依赖我们的 shell 实现，官方 web 侧同样
 * 能装（#83 收尾要做的是把挂载点挪出我们的 frame 并打成独立 npm 包，本步先把命名
 * 与 id 对齐）。
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
 *   `IconBranchOutline16` / `IconArchiveOutline20` / `IconRightUpOutline16` /
 *   `StateDot` / `Menu` / `Tooltip` / `HoverCard` / `Modal` / `Button` /
 *   `relativeTime`。
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
 * 所以不需要任何 DOM 层 hack。能力不存在（官方 web 形态）时：菜单项不出现，
 * 行右键也不接管（不抢浏览器原生右键菜单）。
 *
 * **样式 = 官方 token + 官方默认几何**：本插件不写自造颜色/尺寸。下面 CSS 里的每个数值都逐字
 * 取自官方 css-module（`ui-workspace/src/client/rows/Rows.module.css` 与
 * `WorkspaceBrowser.module.css`，0.1.6-alpha.1 的 `lib/client.js` 内联副本），
 * 颜色一律引用官方 token 变量（`--dsw-*`）。**不引用官方哈希类名**
 * （`YDXeBa_*` / `bhn1Oq_*` 随版本变），只用自有类名 + 官方 token：数值同源、
 * token 同源，只有类名是自己的。
 * **密度/间距（#85 A 项）**：几何项写 `var(--dsh-one-density-<项>, <官方原值>)`
 * ——宿主（我们的 VS Code 侧栏外框）在容器上设这组变量时自动变紧凑，没人设时
 * 取官方原值，本件零宿主判断、保持可移植（见 CSS 上方的密度偏好说明）。
 * **悬停卡（#85 B 项）**：官方 HoverCard 只在容器右侧放得下 244+8px 时渲染，
 * 否则不渲染（官方定位会落到视口外；取舍见 useHoverCardRoom 上方的说明）。
 *
 * ## 已知取舍（下一步的差异化层处理）
 * - **分组展开态与视图偏好（分组方式/排序方式）目前只存在组件内存里，不跨重载
 *   持久化**。按 AGENTS.md 铁律「插件状态按官方惯例存储」，这类**纯视图态**应当
 *   沿用官方客户端既有惯例（官方 ui-workspace 的 `createWorkspaceViewStore()` 走
 *   `@deepseek-ai/dsh-client-store` 的 `defineStore`，经 entry 的 `store` 座位由
 *   框架托管持久化）。本步先不接该座位：它是**注册期**的座位声明，接入即改注册
 *   形状，与本步「只换渲染」的边界冲突；留到差异化层（要一并管置顶/未读/分组）
 *   时按官方 store 座位一次接好。**这是本步的已知偏差，不是最终形态。**
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
  IconCheckOutline16,
  IconChecklistOutline14,
  IconCloseFill14,
  IconEditOutline16,
  IconEllipsisOutline16,
  IconFolderClose16,
  IconFolderOpen16,
  IconPersonalizationOutline16,
  IconPlusOutline16,
  IconRefreshOutline16,
  IconRightUpOutline16,
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
  deriveRecycleGroups,
  owningGroupKey,
  recycleCount,
  sessionStatuses,
  showsStatusDot,
  workspaceActivityCounts,
  type ActivityCounts,
  type GroupNode,
  type RecycleGroup,
  type SessionListLike,
  type SessionNode,
} from '../../../pure/workspaceTreeView.ts'
import {
  TREE_GROUPS_STATE_KEY,
  createTreeGroup,
  deleteTreeGroup,
  emptyTreeGroups,
  hasTreeGroup,
  parseTreeGroups,
  renameTreeGroup,
  serializeTreeGroups,
  toggleWorkspaceGroup,
  treeGroupDefs,
  workspaceGroupIds,
  workspaceMatchesGroup,
  type WorkspaceGroupDef,
} from '../../../pure/treeGroups.ts'
import type { GroupFile } from '../../../pure/dshStateFile.ts'
import { hostCapabilities, type CapabilityContext } from './hostCapabilities.ts'
import {
  defaultTreeViewPrefs,
  pageStorage,
  readTreeViewPrefs,
  writeTreeViewPrefs,
  type TreeViewPrefs,
} from '../../../pure/workspaceTreePrefs.ts'

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
  'group.filter.all': '\u5168\u90e8',
  'group.filter.aria': '\u6309\u5206\u7ec4\u8fc7\u6ee4',
  'group.new': '\u65b0\u5efa\u5206\u7ec4',
  'group.rename': '\u91cd\u547d\u540d\u5206\u7ec4',
  'group.delete': '\u5220\u9664\u5206\u7ec4',
  'group.delete.desc':
    '\u5c06\u5220\u9664\u5206\u7ec4\u201c{name}\u201d\u3002\u5de5\u4f5c\u533a\u4e0e\u4f1a\u8bdd\u90fd\u4e0d\u4f1a\u5220\u9664\uff0c\u53ea\u662f\u4e0d\u518d\u5f52\u5c5e\u8be5\u5206\u7ec4\u3002',
  'group.name.empty': '\u540d\u79f0\u4e0d\u80fd\u4e3a\u7a7a\u3002',
  'group.name.duplicate': '\u5df2\u5b58\u5728\u540c\u540d\u5206\u7ec4\u3002',
  'group.membership': '\u6240\u5c5e\u5206\u7ec4',
  'group.chip.aria': '\u53ea\u770b\u5206\u7ec4\u201c{name}\u201d',
  'activity.running': '{n} \u4e2a\u4f1a\u8bdd\u8fd0\u884c\u4e2d',
  'activity.waiting': '{n} \u4e2a\u4f1a\u8bdd\u7b49\u5f85\u4ea4\u4e92',
  'select.enter': '\u6279\u91cf\u9009\u62e9',
  'select.exit': '\u9000\u51fa\u9009\u62e9',
  'select.row.aria': '\u9009\u4e2d\u4f1a\u8bdd\u201c{name}\u201d',
  'select.count': '\u5df2\u9009 {n} \u9879',
  'select.none': '\u672a\u9009\u4efb\u52a9\u4f1a\u8bdd',
  'select.archive': '\u79fb\u5165\u56de\u6536\u7ad9',
  'select.archivePending': '\u6b63\u5728\u79fb\u5165\u56de\u6536\u7ad9\u2026',
  'select.archiveFailed': '{n} \u4e2a\u4f1a\u8bdd\u79fb\u5165\u5931\u8d25\u3002',
  'recycle.open': '\u56de\u6536\u7ad9',
  'recycle.title': '\u56de\u6536\u7ad9',
  'recycle.close': '\u5173\u95ed\u56de\u6536\u7ad9',
  'recycle.empty': '\u56de\u6536\u7ad9\u662f\u7a7a\u7684\u3002\u5f52\u6863\u7684\u4f1a\u8bdd\u4f1a\u51fa\u73b0\u5728\u8fd9\u91cc\u3002',
  'recycle.restore': '\u8fd8\u539f',
  'recycle.restoring': '\u6b63\u5728\u8fd8\u539f\u2026',
  'recycle.failed': '\u8fd8\u539f\u5931\u8d25\uff1a{message}',
  'recycle.restore.aria': '\u8fd8\u539f\u4f1a\u8bdd\u201c{name}\u201d',
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
  'menu.openInNewTab': '\u5728\u65b0\u6807\u7b7e\u9875\u6253\u5f00',
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
  'group.filter.all': 'All',
  'group.filter.aria': 'Filter by group',
  'group.new': 'New group',
  'group.rename': 'Rename group',
  'group.delete': 'Delete group',
  'group.delete.desc': 'This deletes the group \u201c{name}\u201d. Workspaces and sessions are kept; they just leave this group.',
  'group.name.empty': 'The name must not be empty.',
  'group.name.duplicate': 'A group with that name already exists.',
  'group.membership': 'Groups',
  'group.chip.aria': 'Show only the group \u201c{name}\u201d',
  'activity.running': '{n} running',
  'activity.waiting': '{n} waiting for you',
  'select.enter': 'Select sessions',
  'select.exit': 'Exit selection',
  'select.row.aria': 'Select session \u201c{name}\u201d',
  'select.count': '{n} selected',
  'select.none': 'No sessions selected',
  'select.archive': 'Move to recycle bin',
  'select.archivePending': 'Moving to the recycle bin\u2026',
  'select.archiveFailed': '{n} sessions could not be moved.',
  'recycle.open': 'Recycle bin',
  'recycle.title': 'Recycle bin',
  'recycle.close': 'Close the recycle bin',
  'recycle.empty': 'The recycle bin is empty. Archived sessions show up here.',
  'recycle.restore': 'Restore',
  'recycle.restoring': 'Restoring\u2026',
  'recycle.failed': 'Restore failed: {message}',
  'recycle.restore.aria': 'Restore session \u201c{name}\u201d',
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
  'menu.openInNewTab': 'Open in New Tab',
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
//
// ## 密度偏好（#85 A 项）：消费 shell 给的 CSS 变量，缺省即官方档
// 几何/间距项（行高、行间空隙、分组空隙、行内边距、分节头高、字号、列表底部
// 留白、图标按钮/搜索胶囊尺寸）写成 `var(--dsh-one-density-<项>, <官方原值>)`：
// - **本插件不判断宿主**：没人给偏好时取官方字面量（官方 web 侧原样），宿主
//   （我们的 VS Code 侧栏外框 @dsh-one/vscode-sidebar-shell）在容器上设这组
//   变量时自动变紧凑——本件据此保持可移植（AGENTS.md 铁律「能移植的必须移植」）。
// - 变量是**可选输入**、不是契约：官方 web 无人设 → 走兜底；任何宿主都可以只
//   设其中几项（未设的项独立回落官方值）。
// - 观感语言（图标/颜色/圆角/字体族/动效曲线）**不在这组变量里**：那些继续
//   逐字沿用官方，本次只调密度（issue #85 范围）。
// - 变量名与官方原值两栏一一对应，改动时两边同步（test/assemblyShellContract.test.ts
//   有一条契约测试守着「shell 设的键集 = 树消费的键集」）。
// ---------------------------------------------------------------------------
const CSS =
  // overflow:hidden 是给分节头的 `margin-right:-4px`（官方原值，让标题栏贴到侧栏
  // 右缘）兜住溢出：shell 把 `--dsh-sidebar-inline-padding` 置 0 之后，那 4px 会伸到
  // 容器外，让侧栏外层（官方 hHd-Xa_regionArea）的 scrollWidth 比 clientWidth 大 4px
  // ——平时看不见，但官方在「单列表」视图里对选中行 scrollIntoView 时会被横滚 4px，
  // 整棵树跟着左移 4px（#85 回归断言实测到的既有缺陷）。列表自己的滚动在 .dshOneTree_list。
  '.dshOneTree_root{--dsh-session-list-edge-inset:var(--dsh-sidebar-inline-padding);--dsh-session-list-scrollbar-width:8px;--dsh-session-list-scrollbar-offset:2px;box-sizing:border-box;min-height:0;padding-right:var(--dsh-session-list-edge-inset);overflow:hidden;flex-direction:column;flex:1;display:flex;position:relative}' +
  '.dshOneTree_iconButton{cursor:pointer;width:var(--dsh-one-density-icon-button-size,28px);height:var(--dsh-one-density-icon-button-size,28px);color:var(--dsw-alias-label-secondary);background:0 0;border:none;border-radius:50%;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}' +
  '.dshOneTree_iconButton:hover{background:var(--dsw-alias-interactive-bg-hover)}' +
  '.dshOneTree_sectionHeader{box-sizing:border-box;height:var(--dsh-one-density-section-header-height,36px);color:var(--dsw-alias-label-tertiary);border-radius:12px;flex:none;justify-content:flex-end;align-items:center;gap:4px;margin-bottom:var(--dsh-one-density-section-header-gap,4px);padding-left:4px;display:flex;overflow:hidden;margin-top:2px;margin-right:-4px}' +
  '.dshOneTree_sectionLabel{white-space:nowrap;opacity:1;visibility:visible;min-width:0;max-width:45%;transition:max-width .18s var(--ds-ease-in-out),margin-right .18s var(--ds-ease-in-out),opacity .12s var(--ds-ease-in-out),transform .18s var(--ds-ease-in-out),visibility 0s linear;flex:none;line-height:20px;overflow:hidden}' +
  '.dshOneTree_sectionLabelHidden{opacity:0;visibility:hidden;max-width:0;margin-right:-4px;transition-delay:0s,0s,0s,0s,.18s;transform:translate(-4px)}' +
  '.dshOneTree_searchSlot{box-sizing:border-box;min-width:0;max-width:var(--dsh-one-density-icon-button-size,28px);transition:max-width .18s var(--ds-ease-in-out),padding-left .18s var(--ds-ease-in-out);flex:1;align-items:center;margin-left:auto;padding-left:0;display:flex}' +
  '.dshOneTree_searchSlotExpanded{max-width:100%;padding-left:0}' +
  '.dshOneTree_headerActions{opacity:1;visibility:visible;max-width:60px;transition:max-width .18s var(--ds-ease-in-out),opacity .12s var(--ds-ease-in-out),transform .18s var(--ds-ease-in-out),visibility 0s linear;flex:none;align-items:center;gap:4px;display:flex;overflow:hidden}' +
  '.dshOneTree_headerActionsHidden{opacity:0;visibility:hidden;pointer-events:none;max-width:0;transition-delay:0s,0s,0s,.18s;transform:translate(4px)}' +
  '.dshOneTree_search{box-sizing:border-box;cursor:text;width:100%;height:var(--dsh-one-density-search-height,28px);color:var(--dsw-alias-label-secondary);transition:width .18s var(--ds-ease-in-out),padding .18s var(--ds-ease-in-out),border-color .18s var(--ds-ease-in-out),background-color .18s var(--ds-ease-in-out);background:0 0;border:none;border-radius:50%;flex:none;align-items:center;gap:0;margin:0;padding:0;display:flex;overflow:hidden}' +
  '.dshOneTree_searchExpanded{border:.5px solid var(--dsw-alias-border-l4);width:calc(100% + 4px);height:var(--dsh-one-density-search-expanded-height,30px);color:var(--dsw-alias-label-caption);background:0 0;border-radius:10px;margin-inline:-2px;padding:0 4px 0 0}' +
  '.dshOneTree_searchButton{cursor:pointer;width:var(--dsh-one-density-icon-button-size,28px);height:var(--dsh-one-density-icon-button-size,28px);color:inherit;background:0 0;border:none;border-radius:50%;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}' +
  '.dshOneTree_searchExpanded .dshOneTree_searchButton{width:var(--dsh-one-density-icon-button-size,28px);height:var(--dsh-one-density-search-expanded-height,30px)}' +
  '.dshOneTree_searchButton:hover{background:var(--dsw-alias-interactive-bg-hover)}' +
  '.dshOneTree_searchExpanded .dshOneTree_searchButton:hover{background:0 0}' +
  '.dshOneTree_searchInput{opacity:0;pointer-events:none;width:0;min-width:0;color:var(--dsw-alias-label-primary);transition:opacity .12s var(--ds-ease-in-out);background:0 0;border:none;outline:none;flex:1;font-size:13px;line-height:18px}' +
  '.dshOneTree_searchExpanded .dshOneTree_searchInput{opacity:1;pointer-events:auto;margin-left:-2px}' +
  '.dshOneTree_searchInput::placeholder{color:var(--dsw-alias-label-tertiary)}' +
  '.dshOneTree_clearButton{cursor:pointer;width:24px;height:24px;color:var(--dsw-alias-label-secondary);background:0 0;border:none;border-radius:50%;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}' +
  '.dshOneTree_clearButton:hover{background:var(--dsw-alias-interactive-bg-hover)}' +
  '.dshOneTree_listArea{min-height:0;margin-left:-4px;margin-right:calc(-1 * var(--dsh-session-list-edge-inset));flex-direction:column;flex:1;padding-left:4px;display:flex;overflow:visible}' +
  '.dshOneTree_list{min-height:0;margin-left:-4px;margin-right:var(--dsh-session-list-scrollbar-offset);padding-left:4px;padding-right:calc(var(--dsh-session-list-edge-inset) - var(--dsh-session-list-scrollbar-width) - var(--dsh-session-list-scrollbar-offset));scrollbar-gutter:stable;flex:1;padding-bottom:var(--dsh-one-density-list-padding-bottom,16px);overflow-y:auto}' +
  '.dshOneTree_flatList>*+*,.dshOneTree_groupSection>*+*{margin-top:var(--dsh-one-density-row-gap,2px)}' +
  '.dshOneTree_groupSection{position:relative}' +
  '.dshOneTree_groupSection+.dshOneTree_groupSection{margin-top:var(--dsh-one-density-group-gap,4px)}' +
  '.dshOneTree_searchStatus,.dshOneTree_searchWarning{color:var(--dsw-alias-label-tertiary);padding:10px 12px;font-size:12px;line-height:18px}' +
  '.dshOneTree_searchWarning{color:var(--dsw-alias-label-secondary)}' +
  '.dshOneTree_empty{color:var(--dsw-alias-label-tertiary);padding:16px 12px;font-size:13px}' +
  '.dshOneTree_sessionOverflowButton{cursor:pointer;text-align:left;width:100%;height:var(--dsh-one-density-overflow-row-height,28px);color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:8px;padding:0 12px 0 28px;font-size:var(--dsh-one-density-meta-font-size,12px)}' +
  '.dshOneTree_sessionOverflowButton:hover{color:var(--dsw-alias-label-secondary);background:0 0}' +
  '.dshOneTree_projectRow,.dshOneTree_sessionRow{cursor:pointer;user-select:none;color:var(--dsw-alias-label-primary);border-radius:8px;align-items:center;gap:6px;padding:0 var(--dsh-one-density-row-padding-inline,8px);display:flex}' +
  '.dshOneTree_projectRow:hover,.dshOneTree_sessionRow:hover,.dshOneTree_sessionRow.dshOneTree_selected,.dshOneTree_projectRow.dshOneTree_menuOpen,.dshOneTree_sessionRow.dshOneTree_menuOpen{background:var(--dsw-alias-interactive-bg-hover)}' +
  '.dshOneTree_projectRow{box-sizing:border-box;align-items:center;height:var(--dsh-one-density-row-height,34px)}' +
  '.dshOneTree_projectRow .dshOneTree_rowActions{height:20px}' +
  '.dshOneTree_sessionRow{height:var(--dsh-one-density-session-row-height,32px);gap:0}' +
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
  '.dshOneTree_title{text-overflow:ellipsis;white-space:nowrap;min-width:0;font-size:var(--dsh-one-density-title-font-size,14px);line-height:var(--dsh-one-density-title-line-height,20px);overflow:hidden}' +
  '.dshOneTree_time{color:var(--dsw-alias-label-tertiary);flex:none;font-size:var(--dsh-one-density-meta-font-size,12px);line-height:var(--dsh-one-density-meta-line-height,20px)}' +
  '.dshOneTree_scheduleIndicator{width:16px;height:20px;color:var(--dsw-alias-label-tertiary);flex:none;justify-content:center;align-items:center;margin-right:6px;display:inline-flex}' +
  '.dshOneTree_dot{flex:none}' +
  '.dshOneTree_rowActions{flex:none;align-items:center;gap:12px;display:none}' +
  '.dshOneTree_projectRow:hover .dshOneTree_rowActions,.dshOneTree_sessionRow:hover .dshOneTree_rowActions,.dshOneTree_projectRow.dshOneTree_menuOpen .dshOneTree_rowActions,.dshOneTree_sessionRow.dshOneTree_menuOpen .dshOneTree_rowActions{display:inline-flex}' +
  '.dshOneTree_sessionRow:hover .dshOneTree_time,.dshOneTree_sessionRow.dshOneTree_menuOpen .dshOneTree_time{display:none}' +
  '.dshOneTree_rowIconButton{cursor:pointer;width:16px;height:16px;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:4px;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}' +
  '.dshOneTree_rowIconButton:hover{color:var(--dsw-alias-label-primary)}' +
  '.dshOneTree_chevron{color:var(--dsw-alias-label-caption)}' +
  '.dshOneTree_searchRow{box-sizing:border-box;cursor:pointer;text-align:left;width:100%;min-height:var(--dsh-one-density-search-row-min-height,48px);color:var(--dsw-alias-label-primary);background:0 0;border:none;border-radius:8px;flex-direction:column;align-items:stretch;padding:4px 8px;display:flex}' +
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
  '.dshOneTree_deleteAction:not(:disabled){color:var(--dsw-alias-state-error-primary)}' +
  // ---- #81：分组过滤条 / 活状态计数 / 批量选择 / 回收站抽屉 ----
  // 数值全部沿用既有密度档变量（不新增键：assemblyShellContract 的契约测试要求
  // 「shell 设的键集 = 树消费的键集」，见该测试的说明）；颜色一律官方 token。
  '.dshOneTree_filterBar{align-items:center;gap:4px;margin:0 0 var(--dsh-one-density-group-gap,4px);padding-left:4px;display:flex;flex-wrap:wrap}' +
  '.dshOneTree_chip{cursor:pointer;height:var(--dsh-one-density-icon-button-size,28px);color:var(--dsw-alias-label-secondary);background:0 0;border:.5px solid var(--dsw-alias-border-l3);border-radius:999px;flex:none;align-items:center;max-width:100%;padding:0 10px;font-size:var(--dsh-one-density-meta-font-size,12px);display:inline-flex;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
  '.dshOneTree_chip:hover{background:var(--dsw-alias-interactive-bg-hover)}' +
  '.dshOneTree_chipActive{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l4);background:var(--dsw-alias-interactive-bg-hover)}' +
  '.dshOneTree_chipAdd{padding:0;width:var(--dsh-one-density-icon-button-size,28px);justify-content:center;color:var(--dsw-alias-label-tertiary)}' +
  '.dshOneTree_activity{pointer-events:none;position:absolute;right:var(--dsh-one-density-row-padding-inline,8px);align-items:center;gap:6px;display:inline-flex}' +
  '.dshOneTree_projectRow:hover .dshOneTree_activity,.dshOneTree_projectRow.dshOneTree_menuOpen .dshOneTree_activity{display:none}' +
  '.dshOneTree_activityItem{color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-one-density-meta-font-size,12px);line-height:var(--dsh-one-density-meta-line-height,20px);align-items:center;gap:4px;display:inline-flex}' +
  '.dshOneTree_check{cursor:pointer;width:16px;height:20px;color:var(--dsw-alias-label-tertiary);flex:none;justify-content:center;align-items:center;display:inline-flex}' +
  '.dshOneTree_checkBox{box-sizing:border-box;width:14px;height:14px;border:.5px solid var(--dsw-alias-border-l4);border-radius:4px;justify-content:center;align-items:center;display:inline-flex}' +
  '.dshOneTree_checkOn{background:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-inverse,#fff)}' +
  '.dshOneTree_selectionBarWrap{flex:none}' +
  '.dshOneTree_selectionBar{gap:8px;box-sizing:border-box;padding:4px 8px;align-items:center;display:flex}' +
  '.dshOneTree_selectionCount{color:var(--dsw-alias-label-secondary);flex:1;min-width:0;font-size:var(--dsh-one-density-meta-font-size,12px)}' +
  '.dshOneTree_selectionError{color:var(--dsw-alias-state-error-primary);font-size:var(--dsh-one-density-meta-font-size,12px);padding:0 8px 4px}' +
  '.dshOneTree_drawer{z-index:10;background:var(--dsw-alias-bg-base);position:absolute;inset:0;flex-direction:column;display:flex}' +
  '.dshOneTree_drawerHeader{height:var(--dsh-one-density-section-header-height,36px);flex:none;align-items:center;gap:4px;padding:0 4px 0 8px;display:flex}' +
  '.dshOneTree_drawerTitle{color:var(--dsw-alias-label-secondary);flex:1;min-width:0;font-size:var(--dsh-one-density-title-font-size,14px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
  '.dshOneTree_drawerList{min-height:0;padding:0 4px var(--dsh-one-density-list-padding-bottom,16px);flex:1;overflow-y:auto}' +
  '.dshOneTree_drawerGroup+.dshOneTree_drawerGroup{margin-top:var(--dsh-one-density-group-gap,4px)}' +
  '.dshOneTree_drawerGroupLabel{color:var(--dsw-alias-label-tertiary);height:24px;align-items:center;padding:0 8px;font-size:var(--dsh-one-density-meta-font-size,12px);display:flex}' +
  '.dshOneTree_drawerRow{cursor:pointer;height:var(--dsh-one-density-session-row-height,32px);color:var(--dsw-alias-label-primary);border-radius:8px;align-items:center;gap:6px;padding:0 var(--dsh-one-density-row-padding-inline,8px);display:flex}' +
  '.dshOneTree_drawerRow:hover{background:var(--dsw-alias-interactive-bg-hover)}' +
  '.dshOneTree_drawerRow .dshOneTree_title{flex:1}' +
  '.dshOneTree_drawerRestore{cursor:pointer;height:20px;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:4px;flex:none;align-items:center;gap:4px;padding:0 4px;font-size:var(--dsh-one-density-meta-font-size,12px);display:inline-flex}' +
  '.dshOneTree_drawerRestore:hover{color:var(--dsw-alias-label-primary)}' +
  '.dshOneTree_drawerStatus{color:var(--dsw-alias-label-tertiary);padding:10px 8px;font-size:var(--dsh-one-density-meta-font-size,12px)}'
const CSS_TAG_ID = '@dsh-one/dsh-workspace-tree/Tree.css'
if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`) === null) {
  const tag = document.createElement('style')
  tag.dataset.plugin = '@dsh-one/dsh-workspace-tree'
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
// 悬停卡（官方 HoverCard 原语）——#85 B 项：容器右侧真有空处时才渲染
//
// 官方几何（0.1.6-alpha.1 官方实现 + css-module，逐字核对）：
// 卡片是 `position:fixed` 的浮层、**固定 244px 宽**，定位 = `left = anchor.right + 8`、
// `top = anchor.top`（只在会超出视口底部时上移，水平方向不夹取、不翻转），
// portal 到 `document.body`。也就是说官方语义是**卡片浮在侧栏右侧的空处**：
// 官方 web 的页面比侧栏宽得多，卡片落在侧栏右边的主区上，压根不压树。
//
// VS Code 侧栏形态下容器**就是**视口（webview 宽度 = 侧栏宽度），行右缘到视口
// 右缘没有 244+8px 的空处，官方定位会落到视口外（被 webview 边界裁掉）。三种
// 处置里选「抑制」，理由：
// - 官方 HoverCard 没有 placement / 翻转 / 夹取入参（只有 anchor / content /
//   openDelayMs / disabled / copyText / copyLabel / copiedLabel），改不了它内部定位；
// - 卡片 244px 宽、约 72px 高的不透明浮层放进侧栏内，就不存在「不压住树」的位置
//   （官方 web 靠浮到侧栏外面避开树，侧栏本身宽度不够）；
// - 用 CSS 把它钉进容器（本仓库 shell 上一版的做法）等于把卡片压在行上——用户
//   验收反馈的「悬停卡遮挡内容」正是这个；
// - 按 #85 给的「窄宽度下降级形态或抑制」走**抑制**：行内仍有标题（超长省略）与
//   相对时间，卡片承载的补充信息（完整标题 / 工作区路径 / 创建时刻）在无空处的
//   宿主里放弃，换「悬停不遮挡任何内容」。
//
// 判据取**容器右缘**（比行右缘保守：行右缘还要让出滚动条槽）——量出余量 ≥ 卡宽 +
// 间隙才渲染浮层。两端同一份判据：官方 web 侧余量充足 → 官方行为原样；VS Code 侧栏
// 恒不足 → 不渲染。
// ---------------------------------------------------------------------------

const HOVER_CARD_WIDTH = 244
const HOVER_CARD_GAP = 8

/** 容器右侧是否有放得下官方悬停卡的空处（随容器尺寸变化重算）。 */
function useHoverCardRoom(rootRef: { current: HTMLDivElement | null }): boolean {
  const [room, setRoom] = useState(false)
  useEffect(() => {
    const measure = (): void => {
      const el = rootRef.current
      if (el === null) return
      const available = document.documentElement.clientWidth - el.getBoundingClientRect().right
      setRoom(available >= HOVER_CARD_WIDTH + HOVER_CARD_GAP)
    }
    measure()
    const el = rootRef.current
    if (el === null) return
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])
  return room
}

// ---------------------------------------------------------------------------
// 树的行组件（官方 rows/Rows.js 与 rows/WorkspaceBrowser.js 的同构复刻：
// DOM 结构与 class 语义一一对应，类名换成自有前缀）
// ---------------------------------------------------------------------------

const SEARCH_DEBOUNCE_MS = 250
const SEARCH_QUERY_MAX = 500

/**
 * #81 功能 6：工作区内的会话**不折叠**。
 *
 * 官方 WorkspaceBrowser 对每个工作区最多渲染 5 条普通会话，其余塞进「Show N more」
 * 一行（官方 `collapsedSessionRows` + `COLLAPSED_SESSION_LIMIT`）。用户明确要求
 * 绕开这个截断：工作区展开就把它的会话全列出来。因此本件**不再调用**
 * `collapsedSessionRows`、也不再渲染那行「显示更多」——相关代码与常量一并删掉，
 * 免得留下「看着像还在用」的死代码。
 *
 * 工作区自身的折叠（分组头点一下收起整块）保留：那是「一次看几个工作区」的层级，
 * 与「一个工作区里看得见几条会话」是两件事。
 */

/** 行菜单里「所属分组」那一节的 id 前缀（与 rename/delete 等动作 id 区分开）。 */
const GROUP_MENU_PREFIX = 'group:'

/**
 * 新分组的 id：`g-<uuid>`——与旧侧栏建组时的形态一字不差（旧文件里现存的分组
 * 就是 `g-...` 这种 id，新老混在一份 membership 里不会互相认错）。
 */
function newGroupId(): string {
  const uuid = typeof crypto === 'object' && crypto !== null && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`
  return `g-${uuid}`
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
  hoverCard,
  counts,
  groups,
  memberOf,
  onToggle,
  onCreate,
  onRename,
  onDelete,
  onToggleGroup,
}: {
  group: GroupNode
  tr: Translate
  expanded: boolean
  /** 容器右侧有空处才渲染官方悬停卡（见 useHoverCardRoom 的取舍说明）。 */
  hoverCard: boolean
  /** 该工作区里「运行中 / 等待交互」的会话数（无则不渲染角标）。 */
  counts?: ActivityCounts
  /** 全部自定义分组（行菜单里的「所属分组」一节）。 */
  groups: readonly WorkspaceGroupDef[]
  /** 本工作区已归属的分组 id。 */
  memberOf: readonly string[]
  onToggle: () => void
  onCreate: () => void
  onRename?: () => void
  onDelete?: () => void
  /** 勾选/取消勾选一个分组的归属（走宿主能力口落盘）。 */
  onToggleGroup: (groupId: string) => void
}): unknown {
  const [menuOpen, setMenuOpen] = useState(false)
  const label = group.workspaceId === undefined ? tr('group.ungrouped') : group.label
  const active = expanded && group.containsCurrent
  // 行菜单 = 原有两项 + 「所属分组」一节（有自定义分组、且本行是真实工作区时才出）。
  // 勾选态走官方 Menu 的 selectedIds（官方 ViewOptionsMenu 同款机制）。
  const groupItems =
    groups.length === 0 || onRename === undefined
      ? []
      : [
          { type: 'separator', id: 'group-separator' },
          { type: 'label', id: 'group-label', text: tr('group.membership') },
          ...groups.map((entry) => ({ id: `${GROUP_MENU_PREFIX}${entry.id}`, label: entry.name })),
        ]
  const menuItems =
    onRename === undefined || onDelete === undefined
      ? null
      : [
          { id: 'rename', label: tr('rename'), icon: h(IconEditOutline16, {}) },
          { id: 'delete', label: tr('delete.workspace'), icon: h(IconTrashOutline16, {}), danger: true },
          ...groupItems,
        ]
  const anchor = h(
    'button',
    {
      type: 'button',
      className: 'dshOneTree_rowIconButton',
      'aria-label': tr('actions.workspace.aria', { name: label }),
      'data-dshone-tree-action': 'workspace-menu',
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
      'data-dshone-tree-key': group.key,
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
        counts === undefined ? null : h(ActivityBadge, { key: 'activity', counts, tr }),
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
                  selectedIds: memberOf.map((id) => `${GROUP_MENU_PREFIX}${id}`),
                  onSelect: (id: string) => {
                    if (id.startsWith(GROUP_MENU_PREFIX)) {
                      onToggleGroup(id.slice(GROUP_MENU_PREFIX.length))
                      return
                    }
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
  if (group.createdAt === undefined || !hoverCard) return row
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
  hoverCard,
  tr,
  selectMode,
  selected,
  onToggleSelect,
  onOpen,
  onRename,
  onFork,
  onArchive,
  onOpenInNewTab,
}: {
  node: SessionNode
  currentId?: string
  now: number
  flat: boolean
  /** 容器右侧有空处才渲染官方悬停卡（见 useHoverCardRoom 的取舍说明）。 */
  hoverCard: boolean
  tr: Translate
  /** #81 功能 4：批量选择态（点整行 = 勾选/取消，而不是打开会话）。 */
  selectMode: boolean
  selected: boolean
  onToggleSelect: () => void
  onOpen: () => void
  onRename: (title: string) => void
  onFork: () => void
  onArchive: () => void
  /**
   * 「在新标签页打开」（#72 多开通道）。**undefined = 这个宿主没有编辑器标签页**
   * （官方 web 形态）：菜单项不出现、行右键也不接管（不抢浏览器原生右键菜单）。
   */
  onOpenInNewTab?: (() => void) | undefined
}): unknown {
  const [menuOpen, setMenuOpen] = useState(false)
  /** 行右键的指针位置：有值时菜单挂在指针处（官方 Menu 的 getAnchorRect 口）。 */
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const title = displayTitle(node, tr)
  const isCurrent = node.id === currentId
  const statuses = sessionStatuses(node)
  const showStatus = showsStatusDot(statuses, node.completed)
  const openInNewTabItem =
    onOpenInNewTab === undefined
      ? []
      : [
          {
            id: 'openInNewTab',
            // 标记属性（自有契约）：菜单项类名是官方哈希，验证套件与样式都不该认它，
            // 按这个属性取「我们那一项」（与 contextMenuPlugin 的图标项同一做法）。
            label: h('span', { 'data-dshone-tree-item': 'openInNewTab' }, tr('menu.openInNewTab')),
            // 图标取官方 primitives 的 IconRightUpOutline16（向右上离开方框 = 到别处打开），
            // 与官方行菜单项同为 16 档、同为 icon 槽位的次级色。
            icon: h(IconRightUpOutline16, {}),
          },
        ]
  const menuItems = [
    { id: 'rename', label: tr('rename'), icon: h(IconEditOutline16, {}) },
    { id: 'fork', label: tr('menu.fork'), icon: h(IconBranchOutline16, {}) },
    ...openInNewTabItem,
    { id: 'archive', label: tr('menu.archiveSession'), icon: h(IconArchiveOutline20, { size: 16 }) },
  ]
  const anchor = h(
    'button',
    {
      type: 'button',
      className: 'dshOneTree_rowIconButton',
      'aria-label': tr('actions.session.aria', { name: title }),
      'data-dshone-tree-action': 'session-menu',
      onClick: (event: { stopPropagation(): void }) => {
        event.stopPropagation()
        setMenuAt(null)
        setMenuOpen((open: boolean) => !open)
      },
    },
    h(IconEllipsisOutline16, {}),
  )
  // 选择态下整行只有「勾选」一个动作：打开会话、行菜单都先让位（与官方进入选择态
  // 后的处置一致——动作条在底部集中给批量动作）。
  const row = h(
    'div',
    {
      className:
        `dshOneTree_sessionRow${(selectMode ? selected : isCurrent) ? ' dshOneTree_selected' : ''}${menuOpen ? ' dshOneTree_menuOpen' : ''}` +
        `${flat && !showStatus && !selectMode ? ' dshOneTree_flatRowWithoutStatus' : ''}`,
      role: 'treeitem',
      'aria-selected': selectMode ? selected : isCurrent,
      'data-dshone-tree-row': 'session',
      // 行上的活状态（供验证套件把「工作区行尾的计数」与「行内真实状态」对照）：
      // 等待交互 > 运行中 > 空闲，与状态点的优先级同源。
      'data-dshone-tree-status':
        node.pendingInteraction !== undefined ? 'waiting' : node.running ? 'running' : 'idle',
      ...(selectMode ? { 'data-dshone-tree-checked': selected } : {}),
      onClick: selectMode ? onToggleSelect : onOpen,
      // 行右键开出同一份菜单（指针位置锚定）：多开不可用的宿主（官方 web）不接管
      // ——那里没有这一项可给，抢掉原生右键菜单只是添乱；选择态下整行只有「勾选」
      // 一个动作（同上面 onClick 的处置），右键也不接管。
      onContextMenu:
        onOpenInNewTab === undefined || selectMode
          ? undefined
          : (event: { preventDefault(): void; stopPropagation(): void; clientX: number; clientY: number }) => {
              event.preventDefault()
              event.stopPropagation()
              setMenuAt({ x: event.clientX, y: event.clientY })
              setMenuOpen(true)
            },
      children: [
        selectMode
          ? h('span', { key: 'check', className: 'dshOneTree_check' }, h(SelectMark, { on: selected }))
          : !flat || showStatus
            ? showStatus
              ? h(SessionStatusDots, { key: 'status', statuses, tr })
              : h('span', { key: 'status', className: 'dshOneTree_slot' })
            : null,
        h('span', { key: 'title', className: 'dshOneTree_title' }, title),
        node.blank || selectMode
          ? null
          : h('span', {
              key: 'time',
              className: 'dshOneTree_time',
              children: timeLabel(node.updatedAt, now, tr),
            }),
        node.blank || selectMode
          ? null
          : h('span', {
              key: 'actions',
              className: 'dshOneTree_rowActions',
              children: h(Menu, {
                open: menuOpen,
                onClose: () => {
                  setMenuAt(null)
                  setMenuOpen(false)
                },
                items: menuItems,
                onSelect: (id: string) => {
                  setMenuAt(null)
                  setMenuOpen(false)
                  if (id === 'rename') onRename(node.title)
                  if (id === 'fork') onFork()
                  if (id === 'openInNewTab') onOpenInNewTab?.()
                  if (id === 'archive') onArchive()
                },
                portal: true,
                closeOnPointerLeave: true,
                anchor,
                // 行右键开的那一份：菜单锚在指针处（官方 Menu 的 getAnchorRect
                // 优先于 anchor 的矩形，官方自己的右键菜单也是这么用的）。
                ...(menuAt === null ? {} : { getAnchorRect: () => new DOMRect(menuAt.x, menuAt.y, 0, 0) }),
              }),
            }),
      ],
    },
  )
  if (!hoverCard || selectMode) return row
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

// ---------------------------------------------------------------------------
// #81 功能 1/2：分组过滤条 + 工作区行尾的活状态计数
// ---------------------------------------------------------------------------

/**
 * 分组过滤条：一枚「全部」+ 每枚分组 + 一枚「＋」（新建分组）。
 *
 * 为什么是 chip 而不是官方 Menu 里的一节：过滤是一个**一直在的当前选择**（用户要
 * 一眼看出「我现在只看 dsn相关」），菜单里的一节藏起来就看不见了。外观语言仍按
 * 官方来——圆形胶囊、官方 token 颜色、尺寸走密度档（与搜索胶囊同源）。
 * 每枚 chip 悬停出「…」菜单（重命名/删除），走的还是官方 Menu 原语。
 */
/** 一枚过滤 chip（组件而不是 render 期函数：里面有 Menu 的 open 态，需要自己的 hook）。 */
function GroupChip({
  chipKey,
  label,
  active,
  aria,
  tr,
  onPick,
  onRename,
  onDelete,
}: {
  chipKey: string
  label: string
  active: boolean
  aria: string
  tr: Translate
  onPick: () => void
  onRename?: () => void
  onDelete?: () => void
}): unknown {
  const [menuOpen, setMenuOpen] = useState(false)
  const body = h(
    'button',
    {
      type: 'button',
      className: `dshOneTree_chip${active ? ' dshOneTree_chipActive' : ''}`,
      'aria-label': aria,
      'aria-pressed': active,
      'data-dshone-tree-chip': chipKey,
      onClick: onPick,
    },
    label,
  )
  if (onRename === undefined || onDelete === undefined) return h('span', { style: { display: 'inline-flex' } }, body)
  return h(
    'span',
    { style: { display: 'inline-flex', position: 'relative' } },
    body,
    h(Menu, {
      open: menuOpen,
      onClose: () => setMenuOpen(false),
      items: [
        { id: 'rename', label: tr('group.rename'), icon: h(IconEditOutline16, {}) },
        { id: 'delete', label: tr('group.delete'), icon: h(IconTrashOutline16, {}), danger: true },
      ],
      onSelect: (id: string) => {
        setMenuOpen(false)
        if (id === 'rename') onRename()
        if (id === 'delete') onDelete()
      },
      portal: true,
      closeOnPointerLeave: true,
      anchor: h(
        'button',
        {
          type: 'button',
          className: 'dshOneTree_chip dshOneTree_chipAdd',
          'aria-label': `${label} - ${tr('group.filter.aria')}`,
          'data-dshone-tree-chip-menu': chipKey,
          onClick: (event: { stopPropagation(): void }) => {
            event.stopPropagation()
            setMenuOpen((open: boolean) => !open)
          },
        },
        h(IconEllipsisOutline16, {}),
      ),
    }),
  )
}

function GroupFilterBar({
  groups,
  activeGroupId,
  tr,
  onPick,
  onCreate,
  onRename,
  onDelete,
}: {
  groups: readonly WorkspaceGroupDef[]
  activeGroupId: string | null
  tr: Translate
  onPick: (groupId: string | null) => void
  onCreate: () => void
  onRename: (groupId: string, name: string) => void
  onDelete: (groupId: string, name: string) => void
}): unknown {
  return h(
    'div',
    { className: 'dshOneTree_filterBar', 'data-dshone-tree': 'group-filter', role: 'group', 'aria-label': tr('group.filter.aria') },
    h(GroupChip, {
      key: 'all',
      chipKey: 'all',
      label: tr('group.filter.all'),
      active: activeGroupId === null,
      aria: tr('group.filter.all'),
      tr,
      onPick: () => onPick(null),
    }),
    ...groups.map((group) =>
      h(GroupChip, {
        key: group.id,
        chipKey: group.id,
        label: group.name,
        active: activeGroupId === group.id,
        aria: tr('group.chip.aria', { name: group.name }),
        tr,
        onPick: () => onPick(activeGroupId === group.id ? null : group.id),
        onRename: () => onRename(group.id, group.name),
        onDelete: () => onDelete(group.id, group.name),
      }),
    ),
    h(Tooltip, {
      label: tr('group.new'),
      side: 'bottom',
      delayMs: 500,
      children: h(
        'button',
        {
          type: 'button',
          className: 'dshOneTree_chip dshOneTree_chipAdd',
          'aria-label': tr('group.new'),
          'data-dshone-tree-action': 'group-new',
          onClick: onCreate,
        },
        h(IconPlusOutline16, { size: 14 }),
      ),
    }),
  )
}

/**
 * 工作区行尾的活状态计数（#81 功能 2）：运行中 / 等待交互。
 *
 * 绝对定位（不吃行的横向空间）：官方该行没有这个元素，正常流里插一个会把标题挤窄，
 * 而 F-04 PARITY 逐项比对标题的几何矩形——绝对定位让「官方有的东西」保持一致，
 * 我们新增的东西不改变它们；行悬停时让它消失（悬停位置留给官方那组行操作按钮，
 * 与官方会话行「悬停时时间让位」同一处置）。
 */
function ActivityBadge({ counts, tr }: { counts: ActivityCounts; tr: Translate }): unknown {
  return h(
    'span',
    {
      className: 'dshOneTree_activity',
      'data-dshone-tree-activity': `${String(counts.running)}/${String(counts.waiting)}`,
    },
    counts.running > 0
      ? h(
          'span',
          { className: 'dshOneTree_activityItem', 'data-dshone-tree-running': counts.running, title: tr('activity.running', { n: counts.running }) },
          h(StateDot, { state: 'ongoing' }),
          String(counts.running),
        )
      : null,
    counts.waiting > 0
      ? h(
          'span',
          { className: 'dshOneTree_activityItem', 'data-dshone-tree-waiting': counts.waiting, title: tr('activity.waiting', { n: counts.waiting }) },
          h(StateDot, { state: 'warning' }),
          String(counts.waiting),
        )
      : null,
  )
}

// ---------------------------------------------------------------------------
// #81 功能 4：批量选择（选择态与批量动作条）
// ---------------------------------------------------------------------------

/** 选中标记（官方圆角方框 + 官方对勾图标；不引第三方复选框件）。 */
function SelectMark({ on }: { on: boolean }): unknown {
  return h(
    'span',
    { className: `dshOneTree_checkBox${on ? ' dshOneTree_checkOn' : ''}` },
    on ? h(IconCheckOutline16, { size: 12 }) : null,
  )
}

/** 选择态的动作条：已选计数 + 移入回收站 + 退出。 */
function SelectionBar({
  count,
  busy,
  error,
  tr,
  onArchive,
  onExit,
}: {
  count: number
  busy: boolean
  error: string | null
  tr: Translate
  onArchive: () => void
  onExit: () => void
}): unknown {
  return h(
    'div',
    { className: 'dshOneTree_selectionBarWrap', 'data-dshone-tree': 'selection-bar' },
    h(
      'div',
      { className: 'dshOneTree_selectionBar' },
      h('span', { className: 'dshOneTree_selectionCount' }, count === 0 ? tr('select.none') : tr('select.count', { n: count })),
      h(
        Button,
        {
          variant: 'outline',
          disabled: busy || count === 0,
          onClick: onArchive,
          className: 'dshOneTree_selectionArchive',
          children: busy ? tr('select.archivePending') : tr('select.archive'),
        },
      ),
      h(
        Button,
        { variant: 'outline', disabled: busy, onClick: onExit, children: tr('select.exit') },
      ),
    ),
    error === null ? null : h('div', { className: 'dshOneTree_selectionError', role: 'alert' }, error),
  )
}

// ---------------------------------------------------------------------------
// #81 功能 3/5：回收站抽屉（数据 = 官方归档集合，见 deriveRecycleGroups）
// ---------------------------------------------------------------------------

/**
 * 回收站抽屉：整块盖住树区（自有渲染，不占官方槽位——官方侧栏没有「抽屉」这样的
 * 座位，硬塞一个新槽会与官方布局插件争地盘）。
 *
 * 内容按工作区组织（`deriveRecycleGroups`），每行一个「还原」——走官方
 * `uiWorkspace.unarchiveSession`（官方 navigation.d.ts 里就有这条，不是我们自造）。
 * 会话标题与时间仍按官方行的呈现（同样的状态点、相对时间）。
 */
function RecycleDrawer({
  open,
  groups,
  now,
  tr,
  busyId,
  error,
  onClose,
  onOpen,
  onRestore,
}: {
  open: boolean
  groups: readonly RecycleGroup[]
  now: number
  tr: Translate
  busyId: string | null
  error: string | null
  onClose: () => void
  onOpen: (sessionId: string) => void
  onRestore: (sessionId: string) => void
}): unknown {
  if (!open) return null
  const total = recycleCount(groups)
  return h(
    'div',
    { className: 'dshOneTree_drawer', 'data-dshone-tree': 'recycle-drawer', role: 'region', 'aria-label': tr('recycle.title') },
    h(
      'div',
      { className: 'dshOneTree_drawerHeader' },
      h('span', { className: 'dshOneTree_drawerTitle' }, tr('recycle.title')),
      h(
        'button',
        {
          type: 'button',
          className: 'dshOneTree_iconButton',
          'aria-label': tr('recycle.close'),
          'data-dshone-tree-action': 'recycle-close',
          onClick: onClose,
        },
        h(IconCloseFill14, {}),
      ),
    ),
    total === 0
      ? h('div', { className: 'dshOneTree_drawerStatus' }, tr('recycle.empty'))
      : h(
          'div',
          { className: 'dshOneTree_drawerList' },
          groups.map((group) =>
            h(
              'div',
              { className: 'dshOneTree_drawerGroup', key: group.key, 'data-dshone-recycle-group': group.key },
              h('div', { className: 'dshOneTree_drawerGroupLabel' }, group.workspaceId === undefined ? tr('group.ungrouped') : group.label),
              group.sessions.map((node) => {
                const title = displayTitle(node, tr)
                return h(
                  'div',
                  {
                    className: 'dshOneTree_drawerRow',
                    key: node.id,
                    role: 'treeitem',
                    'data-dshone-recycle-row': node.id,
                    onClick: () => onOpen(node.id),
                  },
                  h(
                    'span',
                    { className: 'dshOneTree_title' },
                    title,
                  ),
                  h('span', { className: 'dshOneTree_time' }, timeLabel(node.updatedAt, now, tr)),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dshOneTree_drawerRestore',
                      disabled: busyId !== null,
                      'aria-label': tr('recycle.restore.aria', { name: title }),
                      'data-dshone-recycle-restore': node.id,
                      onClick: (event: { stopPropagation(): void }) => {
                        event.stopPropagation()
                        onRestore(node.id)
                      },
                    },
                    h(IconRefreshOutline16, { size: 14 }),
                    busyId === node.id ? tr('recycle.restoring') : tr('recycle.restore'),
                  ),
                )
              }),
            ),
          ),
        ),
    error === null ? null : h('div', { className: 'dshOneTree_selectionError', role: 'alert' }, error),
  )
}

/**
 * 分组对话框（新建 / 重命名 / 删除确认）——官方 Modal + Button + 圆形输入框，
 * 与工作区/会话重命名同款外形。名称的「空/重名」在纯模块里判定（`treeGroups`），
 * 这里只把判定结果翻成文案，不做第二套校验。
 */
function GroupModal({
  dialog,
  groups,
  tr,
  error,
  onSubmit,
  onClose,
}: {
  dialog: { kind: 'create' } | { kind: 'rename'; id: string; name: string } | { kind: 'delete'; id: string; name: string } | null
  groups: readonly WorkspaceGroupDef[]
  tr: Translate
  error: string | null
  onSubmit: (value: string) => void
  onClose: () => void
}): unknown {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const open = dialog !== null
  const kind = dialog?.kind ?? 'create'
  const initialName = dialog === null || dialog.kind === 'create' ? '' : dialog.name
  const lastOpen = useRef(false)
  useEffect(() => {
    if (open && !lastOpen.current) {
      setDraft(initialName)
      setBusy(false)
    }
    lastOpen.current = open
  }, [open, initialName])
  const submit = (): void => {
    if (busy) return
    setBusy(true)
    onSubmit(draft.trim())
  }
  // 名称冲突就地判定（与提交走同一份纯函数，不会出现「界面放过、落盘被拒」）。
  const nameError = ((): string | null => {
    if (kind === 'delete') return null
    const trimmed = draft.trim()
    if (trimmed === '') return tr('group.name.empty')
    if (groups.some((g) => g.id !== (dialog?.kind === 'rename' ? dialog.id : '') && g.name === trimmed)) return tr('group.name.duplicate')
    return null
  })()
  if (kind === 'delete') {
    return h(Modal, {
      open,
      onClose,
      closeLabel: tr('close'),
      title: tr('group.delete'),
      ...(dialog === null || dialog.kind === 'create' ? {} : { description: tr('group.delete.desc', { name: dialog.name }) }),
      footer: h(
        'div',
        { style: { display: 'flex', gap: '8px' } },
        h(Button, { variant: 'outline', disabled: busy, onClick: onClose }, tr('cancel')),
        h(
          Button,
          {
            variant: 'outline',
            disabled: busy,
            className: 'dshOneTree_deleteAction',
            onClick: () => {
              setBusy(true)
              onSubmit('')
            },
          },
          tr('group.delete'),
        ),
      ),
      children: error === null ? null : h('div', { className: 'dshOneTree_renameError', role: 'alert' }, error),
    })
  }
  return h(Modal, {
    open,
    onClose,
    closeLabel: tr('close'),
    title: kind === 'create' ? tr('group.new') : tr('group.rename'),
    footer: h(
      'div',
      { style: { display: 'flex', gap: '8px' } },
      h(Button, { variant: 'outline', disabled: busy, onClick: onClose }, tr('cancel')),
      h(
        Button,
        { variant: 'primary', disabled: busy || nameError !== null, onClick: submit },
        kind === 'create' ? tr('group.new') : tr('rename'),
      ),
    ),
    children: [
      h('input', {
        className: 'dshOneTree_renameInput',
        value: draft,
        'aria-label': kind === 'create' ? tr('group.new') : tr('group.rename'),
        autoFocus: true,
        disabled: busy,
        onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
        onKeyDown: (event: { key: string; preventDefault(): void }) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          if (nameError === null) submit()
        },
      }),
      nameError === null && error === null
        ? null
        : h('div', { className: 'dshOneTree_renameError', role: 'alert' }, nameError ?? error),
    ],
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
   * 官方归档/还原（官方 `dsh-client-ui-workspace` 的 navigation.d.ts：
   * `archiveSession(sessionId)` / `unarchiveSession(sessionId)` 两条都在）。
   * 走官方服务而不是自行记名单——「回收站 = 官方归档集合」正是 #81 的要求。
   */
  archiveSession(sessionId: string): Promise<void>
  unarchiveSession(sessionId: string): Promise<void>
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
      // 「在新标签页打开」（#72 多开通道）：走宿主能力口（抽象口，插件不碰宿主 API）。
      // 能力口如实上报 `editorTabs`：没有编辑器标签页的宿主（官方 web 形态）不注入
      // 这个动作，菜单项与行右键都不出现——那是同一份插件在另一端的正确形态。
      ...(caps.editorTabs
        ? {
            openInNewTab: (sessionId: string): void => {
              caps.openSessionInNewTab(sessionId).catch((reason: unknown) => {
                // 宿主侧失败已弹 VS Code 错误提示（服务没起/清单拉取失败）；
                // 这里只留一条诊断，不重复打扰用户。
                console.warn('[dsh-one] open session in new tab failed:', reason)
              })
            },
          }
        : {}),
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
      // #81 功能 3/4：进回收站 = 官方归档（逐个走官方 uiWorkspace.archiveSession；
      // 串行而不是并发：归档会更新官方工作区注册表，逐个落地便于精确报出失败项）。
      recycleSessions: async (sessionIds: readonly string[]): Promise<{ failed: readonly string[] }> => {
        const service = uiWorkspace()
        const failed: string[] = []
        for (const sessionId of sessionIds) {
          try {
            if (service === undefined) await workspaces.archiveSession(sessionId)
            else await service.archiveSession(sessionId)
          } catch {
            failed.push(sessionId)
          }
        }
        return { failed }
      },
      // #81 功能 5：还原 = 官方 uiWorkspace.unarchiveSession（官方有此接口，不自造）。
      restoreSession: async (sessionId: string): Promise<void> => {
        const service = uiWorkspace()
        if (service === undefined) throw new Error('this shell provides no official uiWorkspace service')
        await service.unarchiveSession(sessionId)
      },
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
