# 会话行补「已完成」绿点

记录于 2026-08-31。从 ui-parity-leftovers 拆分。

## 背景与现象

官方 dsh web 的会话行 StateDot 除运行中像素环、待交互黄点外，还有「已完成」绿点（观测到会话 running 结束且当时未附着即标绿）。dsh-one 会话行目前只渲染黄点 / 像素环 / 未读蓝点 / 图钉，没有绿点。

## 现状

- 黄点已实现：`sessionsStore` 从全局 mux 下行的 server-request 帧喂 `pendingInteractions`（`a:<approvalId>` / `q:<rpcId>`，连接时 host 重放仍 pending 的请求），`renderSessionRow` 渲染 warning dot。
- `completed` **数据已具备、渲染缺失**：`sessionsStore.completed`（running true→false 跳变且未附着时自动标记，纯内存、刷新后消失，对齐官方语义）已存在，展示层把 completed 并进 `unreadDisplay`（蓝点），但状态槽没有绿点分支；`sessionTree` 的节点模型也没有 completed 字段。

## 建议方案

- `src/pure/sessionTree.ts`：节点模型透出 `completed` 字段（从展示层 unreadDisplay 的合并拆开或单独透传）。
- `src/ui/chat/webview.ts` `renderSessionRow`：状态槽加绿点分支。注意与蓝点（unread）的优先级/合并语义对齐官方（黄点 > 运行环 > 绿点 > 蓝点？需对照 dsh web 确认），不要把 completed 简单并进 unread。

## 涉及代码位置

- `src/ui/sessionsStore.ts`（completed Set、unreadDisplay 合并）
- `src/pure/sessionTree.ts`（节点模型）
- `src/ui/chat/webview.ts`（`renderSessionRow` 状态槽）
