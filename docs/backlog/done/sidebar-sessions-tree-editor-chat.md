# 侧栏 sessions 树 + chat 移进编辑器（懒打开）

记录于 2026-09-01。需求调研结论（用户决策已定稿，此条为「提出」阶段记录）。

## 背景与现象

dsh-one 默认把面板放在主侧边栏（activitybar），用户痛点：面板在左边没全屏、可拉伸但挤编辑区、太窄；且左边要留给文件树。用户希望 chat 出现在右侧且宽、可近全屏。

## 现状（已核实的平台约束）

- dsh-one 现在**一个 webview**（`views.dsh-one` 容器里的 `dshOne.chat`，`registerWebviewViewProvider`）同时装下 sessions 列表 + 原生 chat（宽屏两栏：左 260px 会话列表、右聊天；窄屏上下）。
- `viewsContainers` 官方只支持 `activitybar` / `panel`，**不支持 secondary sidebar**；也**没有公开命令/API**让扩展把自己的 view 运行时搬去 secondary sidebar（源码 `moveViewContainerToLocation` 是内部服务）。所以「默认放右侧 secondary sidebar」不可由扩展实现，只能用户手动拖——治不了窄/无全屏。
- dsh-one 另有一个 `dshOne.openInTab`（`src/ui/webview.ts` 的 `createWebviewPanel`），是**编辑区标签页**的 dsh web iframe（另一块表面，非原生 chat）。

## 调研：候选表面与参考方案（据此确定选方案 B）

平台约束使「默认放右侧 secondary sidebar」不可行，候选表面对比：

- **A. Secondary Sidebar（手动拖）**：右侧停靠；侧栏宽（可拉，挤编辑区）；无全屏；不能默认（仅用户拖一次、按 profile 记住）。→ 只解决靠右，**治不了窄/无全屏**。
- **B. Editor WebviewPanel** ← 采用：编辑区（可拖成右侧一列）；真宽可调；可近全屏（`Ctrl+B` 隐侧栏 + `Ctrl+J` 隐面板，或 Zen 模式）；默认可控（`ViewColumn.Beside`）。→ 三点全治。
- **C. 底部 Panel（挪右侧）**：`viewsContainers.panel` + 全局设置 `workbench.panel.defaultLocation: right`；面板全宽、可最大化；容器可默认注册到 panel，但「右侧」是全局设置。→ 宽+全屏，但不像「右侧聊天栏」观感。
- **D. 现状 activitybar**：左侧；窄；无全屏；默认是。→ 就是不满的那套。

**参考方案**：Cline / Roo Code / Continue / Windsurf 等 AI 插件通用做法 = 主力界面放编辑区（可拖去右列、可全屏），侧栏只留精简入口供切换。dsh-one 现在的分工是反的（主力 native chat 在侧栏，编辑区只有 dsh web iframe）。

## 方案（用户已确认）

把合并的 webview 拆成两块，走「侧栏导航 + 编辑区内容」结构：

1. **chat 进编辑器**：给原生 chat 增一个 editor `WebviewPanel` 形态（复用 ChatViewProvider 逻辑），默认 `ViewColumn.Beside`（右侧一列）。**懒打开**：不点 session 不弹，激活时不自动开（避免每次启动挤占编辑区）；点会话 / 点「新建会话」/ 跑打开面板命令时才拉出并附着。体验类似 VSCode 编辑器标签页。
2. **侧栏改原生 tree**：`createTreeView` 的 `TreeDataProvider`，只展示 workspace + session 列表，**保留现有全部按钮与右键菜单**。

### 必须保留的侧栏交互清单（现状来自前端 `src/ui/chat/webview.ts`）

- 头部工具栏：搜索框（搜索会话）、排序方式、刷新会话列表、折叠全部、新建会话、新建 workspace。
- workspace 行 hover 操作：新建会话（+）、在终端中打开、在 VSCode 中打开文件夹（仅非当前 workspace）、从列表移除。
- 会话行：点击附着/打开、行首状态槽（运行中像素环 > 未读蓝点 > 置顶图钉）、未读标题加粗、active 高亮;行尾 ⋯ 与右键菜单共用：重命名 / 置顶·取消置顶 / 标为未读·已读 / 分叉 / 复制引用 / 复制会话 ID / 归档。
- workspace 标识：当前文件夹图标染 deepseek 蓝、行尾「vscode/当前」标签;「未分组」虚拟组（无路径，不可新建会话/打开终端与文件夹）。
- 状态与持久化：服务未运行/未安装空态 + 启动/安装引导、会话列表相对时间 60s tick、置顶/未读/折叠状态（workspaceState 持久）。

### 拆分后必须处理好的联动

- 「当前会话」归属移到 editor 面板，侧栏只做高亮；侧栏点会话 → 宿主 → 打开/更新 editor 面板并附着。
- 自动附着最新会话的行为改懒加载：仅侧栏高亮，editor 面板未开时记着，打开时再落。
- 运行中 turn 的 stop / 内联权限确认 / 提问弹层全落在 editor 面板;需兜底：editor 面板被关闭但有 pending 交互时自动再拉出。
- 右键「发送到当前会话」：没有打开面板时也要能顶上去（先开 editor 面板再 attach）。
- `dshOne.openInTab`（dsh web iframe）为独立第三块表面，与本次拆分相对独立，是否收敛待定。

## 涉及代码位置

- `src/ui/chatView.ts`——宿主：注册 webview provider 改为 `createTreeView`（sessions）+ editor `WebviewPanel`（chat）；拆分消息路由。
- `src/ui/chat/webview.ts`——前端：sessions UI 完整重写为 tree 项（保留上列交互），chat 部分迁到 editor 面板。
- `src/ui/sessionsStore.ts`——数据源（host 事件刷新），复用/按 native tree 扩展。
- `src/extension.ts`——注册 tree view + editor panel、命令绑定。
- `package.json`——`views.dsh-one` 由 webview 视图改为 tree 视图；新增 `menus view/item/context` 右键菜单；chat 命令改 editor 面板。

## 规模提示

这是**大改动**：sessions 面板交互整套从 webview 前端重写成扩展宿主端原生 tree，牵扯多文件、状态与持久化迁移；建议单独 worktree、分步实现并每步自测。前置/相关：无外部依赖。

- 2026-09-01 认领（worktree: agent/sidebar-sessions-tree-editor-chat）→ doing
- 2026-09-01 开发完成（doing → done）
- 2026-09-01 验收打回继续开发（done → doing）：侧栏原生 tree 交互太弱（功能点击层级深、无内联搜索框、像素状态/加粗/active 高亮丢失），用户拍板恢复为 webview sessions 面板（交互全保留），chat 留在 editor WebviewPanel。
- 2026-09-01 开发完成（doing → done）：按验收反馈改为「侧栏 webview sessions 面板 + chat 留 editor WebviewPanel」。
