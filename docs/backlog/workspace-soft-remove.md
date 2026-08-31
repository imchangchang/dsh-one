# 工作区软移除（从列表移除 workspace）

记录于 2026-08-31。

## 背景与现象

dsh web 的工作区（workspace 分组）行有 rename + delete 两个操作。其中 delete 是**软移除**：只把 workspace 记录从注册表删掉，磁盘上的文件夹和会话日志全部保留，组内会话掉回「未分组」。确认文案原文：

> "将把"{name}"从工作区列表中移除。文件夹与会话记录会保留，其会话将显示在"未分组"下。"

dsh-one 的会话面板目前没有对应能力：workspace 组头只有「新建会话 / 在终端中打开 / 在 VSCode 中打开文件夹」，用户无法把一个不想要的 workspace 从列表里去掉。

## 现状

- host 侧能力已齐备，无需 dsh 改动：`workspace.delete` RPC（`dsh-client-runtime` 的 workspaces manager 已封装，另有 `workspace.rename`、`workspace.insert`（排序）等同族接口）。实现语义见 `dsh-workspace` 的 `deleteKnown`：删注册表记录 + 顺序，带 pendingMutation 崩溃恢复标记。
- dsh web 的入口：`dsh-client-ui-workspace` 的 `ProjectRowItem`，组头 hover 出操作菜单，delete 有确认对话框。
- dsh-one 缺口：`src/ui/chat/webview.ts` 的 `renderWorkspaceGroup`（约 1499-1514 行）组头操作按钮没有移除项；`src/pure/chatContract.ts` 的消息协议和 `src/ui/chatView.ts` 的分发也没有对应消息类型。

## 建议方案

对齐 dsh web 的软移除语义：

1. `chatContract.ts` 加 `workspaceRemove` 消息（带 workspaceId）；
2. webview 组头加「从列表移除」按钮，点击先弹确认（说明文件夹与会话保留、会话归入未分组），确认后 post 消息；
3. `chatView.ts` 收到后调 host 的 `workspace.delete`，失败后给用户提示。

注意点：

- 依赖「未分组会话在面板不可见」（ungrouped-sessions.md）先做或同做：否则被移除 workspace 的会话在 dsh-one 里会直接消失，比 dsh web 的表现更差，用户会以为是真删了数据；
- 当前 VSCode 窗口已打开的 workspace（`w.isCurrent`）是否允许移除要想清楚——dsh web 无此概念，建议允许，移除后该窗口的会话归入未分组；
- 不需要做"彻底删除磁盘文件夹/会话"，dsh 原设计就没有这个能力，不要越界。

涉及文件：`src/pure/chatContract.ts`、`src/ui/chat/webview.ts`（renderWorkspaceGroup）、`src/ui/chatView.ts`（消息分发 + host 调用）。
