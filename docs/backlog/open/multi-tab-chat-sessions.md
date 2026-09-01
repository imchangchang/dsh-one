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
- 2026-09-01 评审确认：做（用户标注）
