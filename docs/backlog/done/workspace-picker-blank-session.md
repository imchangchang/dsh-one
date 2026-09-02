# 空会话 hero 工作区 chip 只读，不能切换/新建工作区

记录于 2026-09-01。对比 dsh web 聊天面板与 dsh-one 时发现。

## 现象

dsh web 空会话 hero 的文件夹 chip 是**选择器**（chevron）：点击弹 `WorkspacePicker`（工作区列表 + 「添加工作区」）→ `DirectoryBrowser` modal（面包屑 + 双列 + 新建文件夹 + 显示隐藏文件 + 打开）。

dsh-one hero 工作区 chip 只读展示（webview.ts:1902-1909，注释明确「我们没有更换 blank 会话所属 workspace 的链路」），无 chevron、无选择器。

## 现状

- 属于行为缺口而非 UI 形态：host 侧需要新建/切换 workspace 的命令（类似 `/workspace`?）或事件链路。
- 数据可用性待确认：host 是否有创建/打开工作区的 dsh 命令。

## 涉及代码位置

- dsh web：`dsh-client-ui-workspace`、`dsh-client-ui-directory-picker-browse`（modal）
- dsh-one：`src/ui/chat/webview.ts`（renderHero 的 ws chip）、host 侧（工作区命令）

## 变更记录

- 2026-09-01 记录 → open
- 2026-09-01 评审确认：做（用户标注）

- 2026-09-01 认领 → doing（并行开发 session）
- 2026-09-01 开发完成，自测通过（typecheck + test 253 + build 全绿）→ done

### 开发完成（2026-09-01）

调研结论（先调研后动手）：

- **host 链路实测全部可用**：`workspace.list` / `workspace.create {path}` / `session.create {workspaceId}`（复用/新建 blank 会话）/ `workspace.delete`（对 127.0.0.1:3080 网关实测；`dshRpc.ts` 已有 `listWorkspaces` / `ensureWorkspace` / `ensureSession` / `createSession` 封装）。
- **切换语义对齐官方 connectWorkspace**：选 workspace → 复用该 workspace 已有 blank 会话（`blank && sessionIds 包含 && 未归档`），没有则 `session.create {workspaceId}` → `sessions.open`（dsh-one 的 `openSession`）。官方 picker 行 = 文件夹图标 + title + 当前项对勾，无路径/计数；footer 分隔线 + 添加入口。
- **web 版 DirectoryBrowser 不可行（host 侧限制）**：它依赖 `host.listDirectory` / `host.createDirectory`（browse 能力），当前 dsh host 组合是 native 能力，实测返回 `directory-picker-unavailable`（`host.pickDirectory` 是 dsh 进程自己的 OS 对话框，无法嵌入 webview）。**用户已确认**：hero picker 的「添加工作区」用 VSCode 原生目录对话框（复用 `dshOne.workspace.add` / `dshOne.workspace.create` 命令，两个入口与侧栏一致）。

改动：

- `src/pure/chatContract.ts`：ChatState 加 `workspaceId`（当前项对勾）+ `workspaces`（picker 列表投影）；FromWebviewMessage 加 `workspacePick` / `workspacePickAdd` / `workspacePickCreate`。
- `src/ui/sessionsStore.ts`：暴露 `workspaceBaseline` getter（workspace.list 基线）。
- `src/ui/chatView.ts`：composeHeader 合成 picker 数据（随 store 刷新重推）；onMessage 处理三个新消息——`pickWorkspace`（基线找 workspace → `ensureSession` → `openSession`）、`addWorkspaceAndOpen` / `createWorkspaceAndOpen`（executeCommand 复用侧栏命令，命令返回注册的 WorkspaceView 后切换过去）。失败提示 warning，取消静默。
- `src/extension.ts`：`dshOne.workspace.add` / `dshOne.workspace.create` 改为返回注册的 workspace（侧栏调用方忽略返回值，无行为变化）。
- `src/ui/chat/webview.ts`：hero workspace chip 改 button + chevron（aria-haspopup），点击弹 `openWorkspacePicker`（popover：workspace 行 + 对勾 + footer 两个添加入口；列表为空时只剩添加入口——官方空列表直接进目录流程，这里退化为只弹添加入口，不自动弹系统对话框）。
- `src/ui/chatView.ts` CSS：`.workspace-item-label`（省略号）+ `.workspace-picker-footer`（分隔线，对齐官方 Menu footer）。
- `test/ui/scenarios.js`：empty 场景更新（chip 可点）+ 新增 `workspace-picker-open`（picker 打开态）与 `workspace-picker-empty`（无 workspace 只剩添加入口）场景。

**人工验收方法**（真实 VSCode，dev-ui-test）：

```
cd /Users/cgeng/Workspaces/dsh-one/.worktrees/workspace-picker-blank-session && bash /Users/cgeng/Workspaces/dsh-one/scripts/dev-ui-test.sh
```

1. 打开 DSH One chat 面板，新开一个空白会话（列表里没有消息的会话，或新建会话），出现 hero（鱼标 + 探索未至之境）：workspace chip 显示当前 workspace 名，尾部有 chevron（与 preset chip 同款）。
2. 点 workspace chip → 弹出下拉：全部 workspace 列表（文件夹图标 + 名称，当前项尾部 ✓），分隔线下「添加已有文件夹…」「创建工作区…」。
3. 点另一个 workspace 行 → 下拉关闭，chip 显示新 workspace 名，面板切到该 workspace 的空白会话；原空白会话仍留在原 workspace（侧栏可见）。
4. 点「添加已有文件夹…」→ VSCode 原生目录对话框 → 选一个目录 → 自动注册并切到新 workspace 的空白会话（chip 显示新目录名）。
5. 点「创建工作区…」→ 输入名称 → 在 ~/.dsh/workspaces/ 下建目录并注册、切过去。
6. 空白态下（无 workspace 的会话）点 chip → 只有两个添加入口，无空列表。
7. 回归：空会话 preset chip、composer、消息流、侧栏会话树不受影响；切换 workspace 失败（如服务异常）只弹 warning 不崩溃。

截图（视觉回归，浏览器渲染）：`/tmp/dsh-ui-shots/empty.png`、`workspace-picker-open.png`、`workspace-picker-empty.png`（ai-visual-validation 出图）。

### 修复（2026-09-01，人工 dev-ui-test 发现）

现象：真实 VSCode 里切 workspace 报 `session.create failed: session-conflict session "X" already exists with cwd "<目标之外>", requested "…"`（三连 toast 均为此错）。

根因：`dshRpc.ensureSession` 的复用分支两个问题——① 复用判定只查 `blank && sessionIds.includes`，漏了官方 `connectWorkspace` 的 `summary.cwd === workspace.path`（cwd 匹配）校验；② 复用时发 `session.create { sessionId }`，而 host 对带 sessionId 的 payload 是 **resume 语义**（cwd = `workspaceId ?? cwd ?? defaults.cwd`），当空白会话所属 workspace 的 path ≠ host 默认 cwd（VSCode 打开目录）时就抛 `session-conflict`——官方复用是纯客户端选择、不发 RPC。

修复（`src/server/dshRpc.ts` `ensureSession` + `src/ui/chatView.ts` 签名带 path）：

- 复用判定补齐 `s.cwd === workspace.path`（与官方一致）；
- 命中复用后直接返回 sessionId，**不再调 session.create**——只有找不到可复用 blank 时才 `session.create { workspaceId }`（host 端 cwd 即 workspace.path，无冲突路径）。

人工验收补充检查点：把 VSCode 打开的目录切到与目标 workspace 不同的路径（如打开 dsh-mobile 目录、切到 aibrain-app 工作区），切过去必须成功且不发 RPC 报错；重复点同一 workspace 行（当前项）不动作。

### 体验优化（2026-09-02，人工反馈）

现象：切换 workspace 功能可用，但每次切到其他 workspace 时整页「刷新」一下（先清空成「加载会话…」占位再重建）。

根因：`ChatSessionController` 初始 `loading: true`（历史基线未落地），webview 的 loading 帧把当前 DOM 清空、只留一行「加载会话…」占位，基线落地后再整页重建——blank→blank 切 workspace 时最明显（两个 hero 长得像却被清空再画）。

修复（`src/ui/chat/webview.ts`）：loading 帧不再清空现有 DOM——旧视图（hero/messages/composer）完整保留到新状态落地一次性切换；只有面板首开/重载后确实没有任何内容时才显示「加载会话…」占位。对侧栏切会话/分叉等所有会话切换同样生效（不再闪空态）。

人工验收补充：切换 workspace 时页面不应先闪成「加载会话…」空态，旧画面保持到新会话画面替换；面板首次打开（无旧内容）仍显示「加载会话…」。

### 懒切换（2026-09-02，人工反馈）

现象：切换仍有小卡顿（点击即触发 ensureSession RPC + controller 重建 + 历史加载），用户要求「切换时不动，发送时再切」（懒切换）。

实现（`src/ui/chatView.ts` + `src/ui/chat/webview.ts`）：

- **点击 chip 只记 pending**：`pendingWorkspaceId` 记录目标 + 重推 state（composeHeader 用 pending 覆盖 workspaceLabel/workspaceId，chip 与对勾显示目标），**零 RPC、不换 controller**——点击瞬时完成。点当前显示项 = 取消（目标等于当前所属 workspace 时清标记）。
- **发送/选 preset 时落地**：`send`、`setAgentPreset` 分支先 `resolvePendingWorkspace()`（ensureSession + openSession 切换）再执行——等待移进发送动作本身；失败提示并中止该次操作，pending 清除、chip 回退。
- **附加**：添加/创建工作区命令成功后 refresh 基线再设 pending；attach（换会话）、服务停止时清 pending。
- **webview 零重建**：`composerSig` 移除 workspaceLabel（pending 帧只改 chip 文字，不进 composer 签名）；hero 保活分支就地 patch workspace chip 文字（草稿、焦点、IME 不中断）；picker 行点击不再拦截当前项（统一 post，宿主判断取消）。

人工验收补充：点 workspace 行即刻无等待地变成目标名（页面零重建、输入框草稿/焦点不动）；点其他 workspace 再点回当前（或点当前显示项）= 取消恢复原 chip；输入文字点发送后才发生切换并在新会话发出消息；选 preset 后发送，preset 生效于目标会话。
