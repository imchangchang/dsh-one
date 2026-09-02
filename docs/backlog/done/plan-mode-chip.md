# 输入区 Plan 状态 chip 缺失（对齐 dsh web PlanChip）

记录于 2026-09-01。对比 dsh web 聊天面板与 dsh-one 时发现。

## 现象

dsh web 计划模式激活时，输入区显示「Plan」pill + 关闭图标（`dsh-client-ui-plan` `PlanChip`，lib/client.js:33-80，挂 `conversation.input.plan`），点击执行 `/plan off`。计划模式状态在输入区有常驻指示。

dsh-one 只在 SLASH_COMMANDS 里注册了 `/plan` 命令（webview.ts:191），无输入区状态 chip——进入计划模式后用户没有可见指示（除消息里的 plan-review 问题卡）。

## 待核实

- `dsh-client-ui-plan` 是否有计划内容消息节点（层级结构/勾选态），调研只定位到 PlanChip 输入开关；计划审批 UI 在 user-questions 的 PlanReviewPanel（见 question-flow-composer-form）。

## 涉及代码位置

- dsh web：`dsh-client-ui-plan`
- dsh-one：`src/ui/chat/webview.ts`（renderInput 的 footer pill 区；状态来源需 host 侧暴露 plan active）

## 开发完成（2026-09-01）

数据链路调研结论：host 侧 `dsh-plan-mode` 注册了 `plan` session projection（wire 视图 `{active, pending}`，`active` 为已落定的开关态、`pending` 为 /plan 命令在途时的目标态），通过 mux 的 `session/projection` 帧推送，`session.history` 基线响应也带 `projections.values.plan`——dsh-one 照现有投影（todos/permissions 等）同款模式消费即可，无需新链路。`/plan off` 走现有 `executeCommand`（webview 发 `send` 消息 → `looksLikeSlashCommand` → commands/execute RPC）。

实现：

- `src/server/chatSession.ts`：`plan` 投影解析（`planSeq` 水位 + `applyPlanValue` 窄化），基线读取 + mux 帧两路都接，`getState` 透传。
- `src/pure/chatContract.ts`：`ChatState.plan?: { active: boolean; pending: boolean }`（投影缺失时缺省，webview 不渲染 chip）。
- `src/ui/chat/webview.ts`：`renderInput` footer pill 区，权限 pill 之后、模型 pill 之前渲染 Plan chip（对齐官方 PlanChip 显示条件 `pending ? !active : active`：退出中立即隐藏、进入中立即显示），点击发 `/plan off`。
- `src/ui/chat/icons.ts`：官方 `IconCloseFill14` 关闭图标。
- `src/ui/chatView.ts`：`.plan-chip` warn 黄色样式（warn 前景色 + 同色低透明背景）。

自测：typecheck + test（253 pass）+ build 全绿。

**人工验收方法**（真实 VSCode 里 dev-ui-test 怎么做）：

1. 起隔离 VSCode 实例（worktree-dev-flow 流程 4 的 dev-ui-test.sh 单元），打开 chat 面板并附着到一个会话。
2. 输入 `/plan` 发送 → 消息流出现 command 卡「Plan mode on…」；输入区 footer（+ / 权限 模型 一行的模型 pill 左侧）出现黄色「Plan ×」chip。
3. 点击 chip → 消息流出现 command 卡「Plan mode off.」，chip 消失；期间输入框无残留 `/plan off` 文本。
4. 普通会话（未进 plan 模式）与空会话 hero：footer 不出现 chip（无残留）。
5. 权限 pill 存在时 chip 排在它后面、模型 pill 前面；点击顺序与布局无重叠。

## 变更记录

- 2026-09-01 记录 → open
- 2026-09-01 评审确认：做（用户标注）

- 2026-09-01 认领 → doing（并行开发 session）
- 2026-09-01 开发完成，自测通过（typecheck + test 253 + build），UI 人工验收方法见上 → done
- 2026-09-01 修复：/plan off 后 chip 未立即消失（composerSig 不含 plan，composer 保活不重建），已修复并重跑自测；人工 dev-ui-test 验收通过（测试 ok）→ done
