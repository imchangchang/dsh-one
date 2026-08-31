# 会话处理完成后不自动标未读

记录于 2026-08-31；2026-08-31 用 Kimi WebBridge 实测 dsh web 后更正结论。

## 背景与现象

用户期望：一个 session 在后台跑完（agent 处理结束）后，会话列表里应出现未读标记，提示"这个会话有新结果没看"。

dsh-one 实际：处理完的 session 不会出现任何未读标记。

## dsh web 的实际行为（实测确认）

**dsh web 有这个功能**，是全自动的，官方叫「已完成」标记（不是"未读"）：

- session 从 running 变为完成（客户端观测到 running 的 true→false 跳变）时，侧边栏会话行的状态槽出现一个圆点（`StateDot`，`data-state="done"`，无障碍文案「已完成」）；
- 当前选中的会话不标（`s.sessionId !== this.selected` 才加入）；
- 打开（选中）会话即清除；会话重新开始运行也会清除；
- **纯内存状态，不持久化**：刷新页面后圆点消失（已实测：从未打开过的探针会话，跑完出点、刷新后点消失）。

实现位置（安装包 0.1.1-rc.2）：

- `dsh-client-runtime/lib/client.js`：`completedNotifications` 集合，注释写明 "Last-observed running bits per session; the true→false edge here arms completedNotifications"、"manager-owned live fact; absent = false"；open/select 时 delete，running 时 delete；
- `dsh-client-ui-workspace/lib/client.js`：`sessionStatuses()` 按 待处理交互(warning) > running(ongoing 像素环) > 子代理运行中 > completed(done 圆点) > idle 的优先级取状态；`showStatus = statuses[0].state !== "done" || row.completed`——idle 不画点，只有 completed 才画。

注意：`completed` **不在 session.list 的 HTTP RPC 返回里**，是 web 客户端 runtime 自己维护后拼进列表模型的。dsh-one 走 HTTP RPC 拿不到这个字段，只能自己实现等价逻辑。

此前本条目记录的"官方没有自动未读逻辑"是错的：当时只 grep 了 web 前端主 bundle 的 "unread" 关键字，而该功能叫 "done/已完成"，且代码在 client-runtime / client-ui-workspace 模块里，不在主 bundle。

## 建议方案

对齐官方语义，在 dsh-one 里实现等价的"完成标记"（可复用现有未读的展示与持久化通道，或按官方改成纯内存——官方不持久化，建议先跟随官方）：

- `SessionsStore` 已订阅 host 事件并维护 `rawSessions` 基线，刷新时对比新旧基线的 `running` 位，true→false 跳变且该 session 不是当前附着会话时加入标记集合；
- 附着（`setSession`）清除——现有 `chatView.ts:837` 的清未读调用天然满足；
- 会话重新开始运行时清除标记；
- 展示沿用现有未读蓝点即可（官方是同一个槽位的 done 圆点，dsh-one 的未读蓝点视觉等价）。

## 注意点

- 官方判定基于"客户端观测到的 running 跳变"：dsh 服务在跑但页面没开期间完成的会话不会有点。dsh-one 同理——VS Code 没开期间完成的会话，下次打开不会有标记，这是与官方一致的语义，不算缺陷。
- 当前附着会话不标；`SessionsStore` 目前不知道哪个会话被附着，需要 `ChatViewProvider` 把 currentSessionId 传进去，或状态转换由 ChatViewProvider 判定后调 `setUnread`。
- 现有未读是持久化在 `workspaceState` 的手动标记。自动完成标记若复用该集合，刷新 VS Code 后标记还在——这与官方（纯内存）不同。要么接受这个差异（用户手动标的和自动标的混在一起），要么分开存。

涉及文件：`src/ui/sessionsStore.ts`（running 跳变检测 + 标记集合）、`src/ui/chatView.ts`（附着会话排除；`setSession` 清除已存在）、`src/pure/sessionTree.ts` / `src/ui/chat/webview.ts`（渲染已就绪，不用动）。
