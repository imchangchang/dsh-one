# 任务清单卡（输入框上方，todos 投影）

记录于 2026-08-31。对齐 dsh web 的 TodoPanel/TodoDock。

## 背景与现象

dsh web 输入框上方有一个可折叠的「任务」条（`任务 3 进行中 · 1 待处理`，默认折叠，chevron 展开列出 todo 项）。dsh-one 没有任何任务清单展示。

## 现状

- dsh-one 不消费 `todos` 投影；但 host 完整推送：history 基线 `projections.values.todos`（`dsh-tool-todo` 注册的投影单元，`todo/write` last-wins 整表、`turn/start` 置 null）+ `session/projection` 帧（key `todos`）。
- dsh-one 已有 6 个投影（title/permissions/sessionStats/imageLimits/contextPressure/contextBreakdown）的同构消费机制（基线 seed + `session/projection` higher-seq-wins），todos 是第 7 个，机制完全一样，只是没读。
- 数据可行性已验证（见 docs/dsh-one-todos-data-source.md）。

## 方案

- `src/server/chatSession.ts`：加 `todosSeq` + `applyTodosValue()`；`loadBaseline` 读 `projections.values.todos`；`onFrame` 的 `session/projection` switch 加 `case 'todos'`（higher-seq-wins 同现有）。
- `src/pure/chatContract.ts`：`ChatState` 加 `todos?: Array<{ content: string; status: 'pending'|'in_progress'|'completed' }>`（null/undefined=无清单，[]=空清单）。
- `src/ui/chatView.ts`：把 controller 的 todos 放进 ChatState。
- `src/ui/chat/webview.ts`：输入区上方渲染折叠卡；头部摘要照搬 web 端 `progressLabel`（done/active/pending 计数、非零段 `·` 连接 → `任务 3 进行中 · 1 待处理`）。

## 语义注意

`null` = 无清单（首写前 / turn/start 后）；`[]` 空数组 → web 端不渲染。

## 参考实现

- `docs/dsh-web-task-card-and-todo-row-research.md`（TodoPanel 渲染逻辑）
- `docs/dsh-one-todos-data-source.md`（数据来源已验证）
- 官方源码：`dsh-client-ui-conversation`（TodoPanel/TodoDock）

## 涉及代码位置

- `src/server/chatSession.ts`
- `src/pure/chatContract.ts`
- `src/ui/chatView.ts`
- `src/ui/chat/webview.ts`

## 实现核实（2026-09-01）

- 需求引用的 `docs/dsh-one-todos-data-source.md` 在仓库里**不存在**（git 历史也没有）。数据链路已从代码核实：`session.history` 的 `projections.values` 是 `Record<string, unknown>`（todos 键直通，opaque），`session/projection` 帧 `{key, value, seq}` 已按 higher-seq-wins 消费——与需求描述的机制一致，照常实现。
- `src/ui/chatView.ts` **无需改动**：`ChatSessionController.getState()` 直接产出完整 ChatState（todos 字段在列），`ChatViewProvider.composeHeader` 用 `...state` 透传，todos 自动到达 webview。

## 变更记录

- 2026-09-01 认领（worktree: agent/todo-cards）→ doing
- 2026-09-01 开发完成，自测通过 → done
- 2026-09-01 主线合入测试通过，人工确认 → closed
