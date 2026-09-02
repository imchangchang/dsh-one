# 窗口 reload 后不恢复已打开的 tab（会话 chat tab 与 dsh web tab）

记录于 2026-09-0X。用户问：打开 tab 的情况下 reload 窗口，窗口不恢复——确认属实后要求直接做。

## 背景与现象

- 「Developer: Reload Window」或重启 VSCode 后，已打开的会话 chat tab（`dshOne.chatPanel`）与 dsh web 全屏 tab（`dshOne.tab`，openInTab）全部消失，需要手动重新打开。
- 会话数据不丢：dsh 服务与 VSCode 生命周期解绑（`src/extension.ts` deactivate 注释），reload 后服务进程还在、下个窗口 re-own；丢的只是 tab UI。

## 现状（已核实）

- 两个 tab 都是 `vscode.window.createWebviewPanel` 运行时创建（`src/ui/chatTab.ts:147`、`src/ui/webview.ts:124`）。VSCode 只在「扩展注册了 `registerWebviewPanelSerializer` 且创建面板时传了 `state`」的情况下才在 reload 后恢复这种面板；本项目两者皆无。
- `retainContextWhenHidden: true` 只保证 tab 在窗口内切走再切回不重载，跨 reload 无效。
- 现有的「恢复」逻辑只覆盖 dsh **服务**重启：`src/ui/chatView.ts:373-389` `onServerState` 在 url 变化时记 `pendingRestoreSessionId`，等 store 基线确认后重开最近活动的会话 tab；`lastActiveSessionId` / `pendingRestoreSessionId` 都是实例内存字段，扩展宿主重启（reload 发生时）即清空，不参与恢复。

## 建议方案

用 VSCode 官方的 webview 面板持久化 API：

1. `chatPanel`：`createWebviewPanel` 第 5 参传 `state: { tabId }`（`randomUUID()`，面板创建后不变——会话可在同一 tab 内被替换，面板的 state 是创建时快照，须以 tabId 为稳定标识）。`workspaceState` 存 `chat.openTabs: Record<tabId, sessionId | null>`，在 tab 打开/用户关闭/会话替换时更新。注册 serializer，`deserializeWebviewPanel(panel, state)` 收到 VSCode 恢复的面板（位置/active 已还原）：按 tabId 查 sessionId → adopt panel（重设 html/iconPath、接线消息与视图状态订阅）→ 服务 running 则直接 `attachController`，否则空态展示、等 `onServerState` 走现有 lastActive/pendingRestore 链（reload 后服务未起时也恢复）。空态 tab（sessionId null）同样恢复。
2. `dshOne.tab`：创建时传 `state: {}`，serializer 恢复时重新 `bind`（render html + 状态订阅 + retry 消息）+ `ensureStarted()`。
3. `extension.ts` 里注册两个 serializer。

边界：用户关闭的 tab 不会恢复（VSCode 只恢复打开状态的面板，且关闭时已从映射中删除）；恢复的面板后续正常走现有生命周期（关闭/替换/服务重启）。

## 涉及代码位置

- `src/ui/chatTab.ts` — ChatTabHost：tabId、adopt panel 路径、面板变化时通知宿主持久化
- `src/ui/chatView.ts` — persistTabs（tabs → workspaceState 记录）、restoreChatPanel（serializer 入口）
- `src/ui/webview.ts` — openInTab 传 state、restoreDshWebTab
- `src/extension.ts` — registerWebviewPanelSerializer × 2

## 变更记录

- 2026-09-0X 用户反馈并确认「直接做」→ 认领（worktree: agent/tab-restore-on-window-reload）→ doing
- 2026-09-0X 开发完成（worktree agent/tab-restore-on-window-reload，rebase 到含 session-open-protect-dirty-tab 的最新 main）：注册 WebviewPanelSerializer（chatPanel 按 tabId 映射重建、dshOne.tab 重新 bind）；workspaceState 增量维护 tabId → sessionId 映射（整表重建会覆盖未恢复面板）；webview 内容经 acquireVsCodeApi().setState 提供恢复凭据；服务未 running 时走现有 lastActive/pendingRestore 链补附着。自测 typecheck + 330 tests + build 全绿。→ done
- 人工 dev-ui-test 验收通过（用户，隔离 VSCode 窗口：两 chat tab + dsh web tab reload 后全部原位恢复；全关后 reload 不恢复）
- 人工 dev-ui-test 验收通过（用户）→ 主线合入（merge 9e1074c），复测 typecheck/334 tests/build 全绿 → closed
