# chat 多会话同时打开（一个 session 一个 editor tab）

记录于 2026-09-01。用户提问「可以同时打开多个 session 吗」，已确认技术可行，此条记录方案与改动范围。**大改动，建议单独 worktree、单独一轮**。

## 背景与现象

ch态前 chat 在 edttor WebviewPanel（单例），切换回会话 = 同一面板附新会话（旧 controller 销毁重建）。用户想知道能否像 VS Code 编辑 tab 一样**同时打开多个 session**（每个 tab 一个会话，可并行查看）。

## 现状（已核实）

- `ChatViewProvider` 是**单例面板**：一个 `panel` 引用（`openPanel` 创建一次，`openSession` 复用，`setSession` 换 controller），`chatView.ts` :1089-1139。
- 事件订阅/状态机按「单个活跃会话」组织：controller 单实例（ChatSessionController）、mux 投影/`request/context`/pending 交互、stop/审批/提问弹层、侧栏 activeSessionId 高亮、「发送到当前会话」。
- VSCode 的 WebviewPanel 天然支持多实例（非活动 tab 的 webview 会被 VSCode 懒加载/回收），多 session 并行在平台层面无阻碍。

## 建议方案（方向）

单例 → `Map<sessionId, {panel, controller}>` 多实例：

1. **面板管理**：每个会话一个 panel（`viewColumn: Active` 或 Beside）；侧栏点会话 → 聚焦已有 tab（`reveal`）或新建；「发送到当前会话」→ 当前活动 tab 或对应 session 的 tab。
2. **事件路由按 session 分桶**：mux/投影/标题、pending 交互（approval/question/plan-review）、stop、run 状态——按 sessionId 路由到对应 controller/panel；面板被关但会话有 pending 时自动再拉出（现有兜底逻辑扩展为 per-session）。
3. **侧栏联动**：`activeSessionId` = 当前活动的 chat tab 会话（多 tab 时侧栏高亮跟随活动编辑器）；角标/状态槽统计不变。
4. **资源与生命周期**：panel 销毁时释放 controller 与订阅；跑完的会话 tab 可手动关闭；重启/重连后恢复打开过的 session tab（或简化为只恢复活动的）。
5. 与 `chat-tab-title-and-icon` 条目（tab 标题跟会话名 + 官方图标）天然配套，可合并一轮做。

## 涉及代码位置

- `src/ui/chatView.ts`（面板/controller 由单例改多实例、事件路由）
- `src/ui/sessionsView.ts` / `src/ui/sessionsStore.ts`（activeSessionId 语义、侧栏联动）
- `src/extension.ts`（命令绑定：session.open 的目标 tab）

## 规模

大改动（接近 sidebar-sessions-tree-editor-chat 的量级）：状态/订阅路由重构，多文件，建议分步实现每步自测。前置/相关：`chat-tab-title-and-icon`（tab 标题/图标）。

## 开发完成（2026-09，worktree: agent/multi-tab-chat-sessions）

### 实现内容（对照建议方案五点）

1. **面板管理**：`ChatViewProvider` 单例重构为 `Map<sessionId, ChatTab>`（`ChatTab` = panel + controller + 各自订阅）。侧栏点会话 → 已有 tab 则 reveal、没有则新建（`ViewColumn.Active` 当前列，用户决策）；「发送到当前会话」→ 当前活动 chat tab（焦点不在 chat tab 时回退最近活动会话 tab，无则最新/新建）。
2. **事件路由按 session 分桶**：每个 tab 的消息闭包捕获自己的 controller，state 推送 / modelCatalog / attachmentData / fileRefList / restoreDraft / commandResult / imagesPicked / filesPicked 全部 post 回本 tab 的 webview，互不串台。pending 交互（approval/question/plan-review）per-session 兜底：tab 被关但会话有 pending 时自动重建该 tab（`ensurePanel`，复用保留的 controller）。
3. **侧栏联动**：`activeSessionId` = 当前活动 chat tab 的会话（`panel.onDidChangeViewState` 检测，多 tab 高亮跟随活动编辑器）；所有 tab 关闭后不高亮任何会话（用户决策）；服务 down 时回落 null（同单面板时代）。
4. **生命周期**：用户关 tab → panel 与面板侧订阅释放，controller 保留（pending 兜底再拉出、重开复用，同单面板时代）；服务 down/重启 → 全部 controller 释放（tab 保留显示空态），重启后只恢复最近活动的会话 tab（store 基线确认后自动重开，任务范围允许的简化）；归档/删除会话 → 关闭对应 tab 并释放 controller。
5. **tab 标题/图标**：每个 tab 各自 `syncPanelTitle`（标题随会话名，含自动命名/用户重命名）+ 官方 favicon，复用 `chat-tab-title-and-icon` 的基础。

### 用户决策（问题帧确认）

- fork 后**新开一个 tab**（原会话 tab 保留，便于对照）。
- 新 tab 打开位置：**当前列 Active**（不自动分栏）。
- 所有 chat tab 关闭后侧栏**不高亮任何会话**。
- **点击会话默认在当前 tab 打开**（替换当前活动 chat tab 的会话），侧栏右键
  菜单新增「在新 tab 中打开」显式新开 tab（2026-09 追加，用户要求）。
- **焦点不在 chat tab 时**（如正在看文件）：替换最近活动过的 chat tab（不新增
  tab）；从未打开过 chat tab 才新建（2026-09 追加，用户决策）。

### 交互调整（2026-09 追加，用户要求）

- `openSession` 改为默认**在当前活动 chat tab 打开**（替换该 tab 的会话：
  旧 controller 释放、暂存附件清空、panel/消息订阅复用）；已有该会话的 tab
  则聚焦它（一个会话一个 tab，不复制）。
- 无活动 chat tab 时替换**最近活动过的 tab**；都没有才新建 tab（原「总是新建」
  路径保留为 `openSessionInNewTab`）。
- 侧栏 ⋯/右键菜单新增**「在新 tab 中打开」**（`sessionOpenInNewTab` 消息 →
  `dshOne.session.openInNewTab` 命令 → `openSessionInNewTab`，boxedPlus 图标）。
- 新建会话（`dshOne.session.new`）同样走 `openSession`（当前 tab 打开，用户
  决策）；fork 保持 `openSessionInNewTab`（新开 tab，此前决策）。
- 涉及文件：`src/ui/chatView.ts`（openSession 重写 + 新增 openSessionInNewTab/
  replaceTabSession）、`src/ui/sessionsWebview.ts`（菜单项）、`src/ui/sessionsView.ts`
  （消息转发）、`src/pure/chatContract.ts`（sessionOpenInNewTab 消息）、
  `src/extension.ts`（openInNewTab 命令、fork 改新 tab）。

### 涉及文件

- `src/ui/chatView.ts`：单例 → 多 tab 管理器（核心重构）
- `src/ui/sessionsStore.ts`：`setAttachedSession`（单值）→ `setAttachedSessions`（集合，完成标记排除所有打开中的会话）
- `src/extension.ts`：reconcileChat 改为遍历打开会话清理消失项；archive 关闭对应 tab；fork/new 天然新 tab
- `src/pure/chatContract.ts`：activeSessionId/attachedSessionId 语义注释更新
- `src/ui/sessionsView.ts`：构造参数注释更新（webview 前端每面板独立实例，无需改动）

### 人工验收方法（dev-ui-test）

```
【测试命令】（单条，复制即跑，已含进入 worktree）
cd /Users/cgeng/Workspaces/dsh-one/.worktrees/multi-tab-chat-sessions && bash /Users/cgeng/Workspaces/dsh-one/scripts/dev-ui-test.sh

【应有现象】
1. 弹出隔离 VSCode 窗口（标题 = 该 worktree 目录，user-data 在 /tmp/dsh-uidev/multi-tab-chat-sessions/）
2. 左侧活动栏出现 DSH One 图标，点击能打开 chat 面板
3. 扩展激活无报错（输出面板"DSH One"）
4. 【本任务特有检查点】
   a. 侧栏点两个不同会话 → 打开两个 editor tab，标题分别显示会话名（或「会话 <ID 前 8 位>」）
   b. 在 tab A 发消息，切到 tab B 发消息：A 的消息只在 A 里流式出现，B 只在 B 里，互不串台
   c. 两个会话并行运行中，侧栏两个会话行都能看到运行状态点；点 tab 切换，侧栏高亮跟随活动 tab
   d. 关掉一个正在跑（或有审批 pending）的会话 tab → 该会话出现 pending 交互时 tab 自动再弹出来
   e. 把一个会话 tab 拖到右侧分栏：两个会话并排，各自独立滚动/流式
   f. 编辑器里右键文件 →「发送到当前会话」→ 附件 chip 出现在当前活动会话 tab 的输入框
   g. 在会话 A 的 tab 内 fork → 新开一个 tab 显示子会话，原 tab 保留
   h. 归档一个已打开 tab 的会话 → 该 tab 关闭
   i. 全部关闭 chat tab → 侧栏没有高亮行
   j. 执行 dshOne.restart（命令面板）→ 服务重启后只自动重开之前活动的会话 tab
   k. 侧栏点会话 B（当前活动 tab 是 A）→ A 的 tab 内容变成 B，**不新增 tab**
   l. 焦点切到文件编辑器后，再点侧栏会话 C → 最近活动过的 tab 内容变成 C
   m. 会话行 ⋯/右键菜单 →「在新 tab 中打开」→ 新开一个 tab 显示该会话
   n. 右上角「+」新建会话 → 当前活动 tab 变成新会话（不新开 tab）
   o. 空会话 hero 点 workspace chip 切到另一 workspace → chip 显示目标 workspace；
      发送消息 → 落到目标 workspace（懒切换落地）；再开一个空会话 tab 选另一
      workspace 发送 → 两个 tab 各自 pending 目标互不串台
   p. 两个会话 tab 并行，当前活动 tab 是 A，在控制台/app 里给 B 的会话发一条
      提问/审批 → 自动切到或弹出 B 的 tab（pending 兜底 per-session，跟对 tab）
```

- 2026-09-01 评审确认：做（用户标注）

- 2026-09-01 认领 → doing（并行开发 session）

- 2026-09 开发完成，自测通过（typecheck + test 253 全绿 + build）→ done

- 2026-09 交互调整：点击会话默认当前 tab 打开 + 右键「在新 tab 中打开」（仍 done，待人工验收后合入）

### 主线同步与架构决策（2026-09，merge main 后追加）

**主线同步**：本地 main 推进 12 提交（合入 session-pin-absolute-order /
chat-scroll-stream-jitter-self-lock / session-menu-reorder-freeze），merge 解决冲突：

- `chatView.ts`：冲突取多 tab 结构，把 main 的**空会话 hero workspace 懒切换**
  （点 chip 切 workspace、发送/选 preset 时落地）移植为 **per-tab**——
  `pendingWorkspaceId` 挂在 `ChatTabHost` 上，动作经 `ChatTabHostActions`
  路由到 provider，行为从单面板 `this.controller` 语义改为 tab 语义，
  多 tab 并行不串台（`setPendingWorkspace`/`resolvePendingWorkspace`/
  `openWorkspaceSession`/`addWorkspaceAndOpen`/`createWorkspaceAndOpen`）。
- `chatMessages.ts`：新增 workspace（workspacePick/Add/Create）、goal
  （goalPause/Resume/Edit/Clear）、文件（producedOpenFile/openAttachmentFile）
  三个 handler 域；send/setAgentPreset 前置 `resolvePendingWorkspace`。
- `chat/webview.ts`：取 main 完整版（goal 条幅、workspace picker、pending
  面板分页、composer 草稿按会话、skill/cordis 卡、diff 双栏等全部在）。
- `chatViewHtml.ts`：STYLE 替换为 main 完整版。
- `sessionsWebview.ts`：保留双方（菜单首行会话标题 + 在新 tab 中打开）。
- extension/sessionsStore/sessionsView/scrollFollow/sessionTree：auto-merge。

**架构决策（用户确认）**：前端 `webview.ts` **不做按域拆分**。理由：
冲突根源（宿主 God 类）已由 ChatTabHost + chatMessages 按域 handler 解决，
本轮 merge 验证了其收益（main 12 提交基本 auto-merge）；webview.ts 是渲染
层，main 增量（goal 条幅等）都是「新渲染块 + 新状态」的局部加法，单文件
内聚完整且官方同粒度；按横切域拆分会让每次 main 增量都要做「归哪个域」
的决策、制造跨模块状态依赖（需 rerender 注入等硬绕机制），增加而非减少
并行摩擦。此前的 webview 拆分提交（旧基线）随本轮 merge 回退，属正确
取舍；若未来想提升 webview.ts 可读性，应从干净基线按**功能模块**（而非
横切域）另起任务。

自测：typecheck + 326 测试全绿 + build（merge 后）
