# Sessions 面板工作区分组过滤（tag + 下拉选择器）

## 背景与现状

截图演示 DSH 功能时，Sessions 面板里的工作区太多、不相关的都露出来，干扰演示。需求：按场景给工作区分组，演示时一键只显示所需分组。

现状：面板顶部是搜索框 + 工具按钮行（排序/刷新/折叠全部/新建），下面是按 workspace 分组的会话列表（`src/ui/sessionsWebview.ts` / `sessionsView.ts`）。workspace 有会话级过滤（搜索）、排序、折叠状态，但没有"按场景只看部分 workspace"的能力。

## 建议方案（session 内已确认）

### 分组模型：多对多 tag

一个 workspace 可打多个分组 tag。点分组下拉只显示该组 workspace，其余整组隐藏。

- 「全部」= 现状，显示所有 workspace（含未打标的）
- 未打标的 workspace 只在「全部」出现，不单独建「未分组」tab，避免下拉项膨胀
- tag 过滤与搜索叠加：先按分组过滤，再走现有搜索/排序/折叠逻辑

### 交互形态：下拉选择器（已确认，替代 tab 行）

侧栏窄（~300px），横向 tab 行放不下多个分组，且溢出后不可发现。采用**单行下拉选择器**：搜索框下、列表上一行，左为「全部工作区 ▼」选择器，右为「+」新建分组。点开是菜单：列出全部分组（含计数）、置顶当前选中、「管理分组…」入口。

- 任何分组数量都不挤，长分组名在菜单里完整显示
- 已确认：不做横向滚动 tab 行 / 图标 tab 行 / chip+溢出混合

### 打标入口

打标有三条路（多对多勾选，一个 workspace 可归多组）：

- workspace 行右键菜单「分组」子菜单（多选勾选）——入口已并入 `workspace-rightclick-menu`（其「分组…」子菜单前置本条目；两条目各自认领并行开发，**本条目先合入**）
- 下拉菜单里「管理分组…」进管理视图：建分组、重命名、删除，**并在视图内给 workspace 打标**（选中某组后列出全部 workspace，勾选/取消归组）——本条目功能闭环，不依赖右键菜单即可打标
- 下拉右侧「+」：快速新建分组

### 持久化

- 分组定义 + 分组顺序 + workspace↔分组归属 + 当前选中的分组，都存插件全局 state（`globalState`），跨窗口、重启记住：
  - `sessions.groups`（分组定义与顺序）、`sessions.groupMembership`（workspace↔组）、`sessions.activeGroup`（当前选中组）
  - 与现有 workspaceState 偏好键（`sessions.sortOrder` / `collapsed` / `pinned` / `unread`）区分
  - 当前选中组被删除时自动回落「全部」

### 分组顺序与空组（已拍板）

- 分组顺序：**管理视图内拖拽排序**（持久化），下拉菜单按该顺序渲染；不搞下拉菜单内拖拽
- 空组保留显示（计数 0），可删除；不自动隐藏、不自动删除
- 建组/重命名：trim 后非空、**重名拒绝**；名称允许中文与符号

### 边界（本次不做）

- 「演示模式」开关（一键隐藏所有非演示组）：先不做，下拉过滤不够用再加
- 不影响会话级过滤、归档、未读、置顶等现有功能

## 涉及代码位置

- `src/ui/sessionsWebview.ts`：下拉选择器渲染 + 管理菜单/视图 + 「+」建组
- `src/ui/sessionsStore.ts`：快照按选中分组过滤；分组数据模型
- `src/pure/chatContract.ts`：webview↔host 消息（setWorkspaceGroup/分组 CRUD）+ SessionsSnapshot 扩展
- `src/ui/sessionsView.ts`：host 侧处理消息 + globalState 持久化（分组定义/顺序/归属/当前选中）
- 可能涉及 `src/pure/sessionTree.ts`（分组过滤后的树模型）

## 变更记录

- 2026-09-03 需求提出（用户：截图演示时工作区太多不方便）；讨论后确认 tag 多对多模型、下拉选择器交互、打标入口、全局持久化；设计稿在 `.dev-host/ws-group-tabs-mock-v1.png`（方案 B 下拉选择器）。未开始开发。
- 2026-09-04 打标入口确认放工作区右键菜单（见 `workspace-rightclick-menu`），本条目聚焦分组模型与下拉过滤。
- 2026-09-04 待决点全部拍板（用户确认）：① 开工节奏——与 `workspace-rightclick-menu` 各自认领、并行开发，本条目先合入（右键菜单「分组…」子菜单依赖本条目分组数据，故先做其非分组项并预留接口）；② 两条目不合并 worktree，各由独立 session 开发；③ 管理视图含打标（建组/重命名/删除 + 视图内勾选归组），本条目功能闭环；④ 分组顺序 = 管理视图内拖拽排序，空组保留显示（计数 0、可删除），重名拒绝、选中组删除回落「全部」。方案已拍板，可开工（认领动作由开发 session 执行 open → doing）。
- 2026-09-05 认领：worktree 开发 session（slug workspace-group-filter）开工，方案与拍板细节按正文执行。
- 2026-09-05 开发完成（doing → done）：分支 agent/workspace-group-filter，HEAD 34df8da，dev-finish 自测全绿（typecheck/build/456 tests/check-i18n 通过），质量门禁产物 `test/sandbox/verify.workspace-group-filter.report.html`（ledger：F-01..F-11 + R-01..R-03 全通过，截图内嵌）。实现：分组栏下拉选择器 + 「+」快速建组 + 管理视图（建组/改名/删除/拖拽排序/视图内打标）；数据模型（sessions.groups/groupMembership/activeGroup）存 globalState，纯层拆出可单测；本条目先合入主线，workspace-rightclick-menu 排其后（其「分组…」子菜单复用 workspaceGroupSetMembership/共享快照字段）。
- 2026-09-05 主线合入后人工确认（用户测试通过）→ closed
