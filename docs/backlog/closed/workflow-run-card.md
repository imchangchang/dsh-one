# 聊天流 workflow 运行卡片（run→phase→member）

记录于 2026-08-31。对齐 dsh web 的 WorkflowRunPanel。

## 背景与现象

dsh web 聊天流里一个 workflow 运行会渲染成可展开的卡片（如 `demo-parallel-workers / 4 个成员`，展开后按 phase 列出各成员并带状态徽标、聚合文案「运行中 2 · 已完成 1」、状态驱动展开/折叠）。dsh-one 聊天流目前没有这个展示——后台任务只剩头部 chip+下拉（扁平），看不到 workflow 的子成员。

## 现状

- dsh-one 会话事件流（chatSession.ts 经 mux 流）**已经收到** `tool-workflow/run-start|agent-start|agent-end|run-end` 四类 durable 事件，但 `ConversationFolder.applyEvent` 的 default 分支把它们静默忽略。
- `session/jobs`（jobsStore）是扁平的 JobView，不覆盖 workflow——跑 workflow 不注册 job，无法分组复用。
- 数据可行性已验证：dsh-one 无需改后端/加 RPC。

## 方案

- 新增 `src/pure/workflowRun.ts`：按 runId 折叠四类事件 → `{name, status, phases[{phase, members[{seq,label,childId,status}]}]}`（官方 workflowRunDefinition 的简化版；status 推导含 completed/cancelled/failed/running，interrupted 语义 dsh-one 可用 turn/end 近似或省略）。
- 接入：`chatSession.ts` 的 loadBaseline（history 回放折叠）、onFrame `session/event`（实时）、rebaseline（重连重放）；「加载更早」补入缺失 run-start 时整段重建。
- `ChatState` 加 `workflowRuns?`（chatContract.ts），透传给 webview。
- webview `src/ui/chat/webview.ts` 照搬官方卡片：RunHeader（chevron+name+N 个成员+状态点）/ PhaseSection（chevron+phase 名+成员数+聚合文案）/ MemberRow（StateDot+成员名+状态文字），状态驱动展开折叠状态机（非 clean 默认展开、全完成自动收拢、新活动自动展开）。

## 参考实现

- `docs/dsh-web-workflow-run-card-research.md`（渲染逻辑与 CSS 已整理）
- `docs/dsh-one-workflow-run-data-source.md`（数据来源与接入点已验证）
- 官方源码：`dsh-client-ui-workflow-run`（WorkflowRunPanel）

## 涉及代码位置

- `src/pure/workflowRun.ts`（新增，折叠）
- `src/server/chatSession.ts`（接入 baseline/live/rebaseline）
- `src/pure/chatContract.ts`（ChatState.workflowRuns）
- `src/ui/chat/webview.ts`（卡片渲染 + 折叠状态机）

## 实现核实（2026-09-01 开发时对照代码现状）

- 两份研究报告与代码现状一致；按文档主建议实现：折叠挂在 `folder.applyEvent`
  之外（`WorkflowRunFolder` 独立维护），事件经 mux `session/event` / history
  两条通道到达后即被折叠，无需改后端。
- 卡片放在聊天流里（对齐官方 chat node），`WorkflowRunView` 多带 `anchorSeq`
  （run 最后一条事件 seq），webview 按「第一条 seq ≥ anchorSeq 的消息之后」
  插位；`chatView.ts` 的 `composeHeader` 是 `...state` 展开，workflowRuns 自动
  透传，无需改转发逻辑（该文件只加了卡片 CSS）。
- interrupted 语义按研究文档的「可省略」路径处理：类型保留五值（UI 徽标/聚合
  文案映射完整），推导不含 interrupted（无 location 模型）。
- MemberRow 纯展示、不做点击打开子会话（官方 navigableMembers 依赖 sessions
  快照，dsh-one 未带）；空 label 显示「空成员名」。
- 「N 个成员」等运行级/阶段级尾部只在折叠态渲染（官方 DisclosureRow 的
  keepContentWhenOpen 语义）；展开态内容 = phase 列表 / 成员列表。

## 变更记录

- 2026-09-01 认领（worktree: agent/workflow-run-card）→ doing
- 2026-09-01 开发完成，自测通过 → done
- 2026-09-01 主线合入测试通过，人工确认 → closed
