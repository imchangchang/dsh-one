# 会话行补「已完成」绿点

记录于 2026-08-31。从 ui-parity-leftovers 拆分。

## 背景与现象

官方 dsh web 的会话行 StateDot 除运行中像素环、待交互黄点外，还有「已完成」绿点（观测到会话 running 结束且当时未附着即标绿）。dsh-one 会话行目前只渲染黄点 / 像素环 / 未读蓝点 / 图钉，没有绿点。

## 现状

- 黄点已实现：`sessionsStore` 从全局 mux 下行的 server-request 帧喂 `pendingInteractions`（`a:<approvalId>` / `q:<rpcId>`，连接时 host 重放仍 pending 的请求），`renderSessionRow` 渲染 warning dot。
- `completed` **数据已具备、渲染缺失**：`sessionsStore.completed`（running true→false 跳变且未附着时自动标记，纯内存、刷新后消失，对齐官方语义）已存在，展示层把 completed 并进 `unreadDisplay`（蓝点），但状态槽没有绿点分支；`sessionTree` 的节点模型也没有 completed 字段。

## 方案（已定 2026-08-31，人工确认）

**只改显示，功能保留**：状态槽的蓝点（未读）改成绿点，对齐官方语义。

- `src/ui/chat/webview.ts` `renderSessionRow`：蓝点分支（`session-dot`）改渲染绿点样式。
- 数据与功能不动：`unread`（手动标记未读，持久化）+ `completed`（自动已完成标记）继续合并展示，手动标记未读功能保留，`sessionTree` 透传不变。
- CSS：`session-dot` 加绿点颜色（对齐官方 StateDot「已完成」视觉）。

## 涉及代码位置

- `src/ui/sessionsStore.ts`（completed Set、unreadDisplay 合并）
- `src/pure/sessionTree.ts`（节点模型）
- `src/ui/chat/webview.ts`（`renderSessionRow` 状态槽）

## 变更记录

- 2026-08-31 认领（worktree: agent/session-row-completed-dot）→ doing
- 2026-08-31 开发完成，自测通过 → done
- 2026-08-31 主线合入测试通过，人工确认 → closed
