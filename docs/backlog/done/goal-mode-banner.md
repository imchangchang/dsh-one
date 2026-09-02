# goal 模式条幅缺失；与排队/插话/todo 条幅的共存冲突待确认

记录于 2026-09-01。观察来源：dsh web（宿主 DeepSeek Harness Web GUI）截图——输入区上方有「进行中的目标」条幅（含暂停/编辑/删除操作，见会话记录附图），该截图是 dsh web 的，不是 dsh-one 的。

## 背景与现象

- dsh web 界面在输入区上方有「进行中的目标」goal 条幅；此外该界面还有排队（输入框上方 QueueDock）、插话（等待插话气泡）、todo（任务清单卡）等条幅/卡片。
- **dsh-one 现在没有 goal 模式的条幅**：`goal` 只作为聊天命令存在（`src/ui/chat/webview.ts:189`），界面层没有对应条幅。

## 现状（已核实）

- dsh-one webview 渲染顺序：messages → `pending`（approval/question）→ todo 面板（webview.ts:1803）→ queue 队列（:1807）→ composer。这个区域目前没有 goal 条幅的位置。
- 目标（未定）：给 dsh-one 补 goal 模式条幅、对齐 dsh web；届时需确认 **goal 条幅 + 排队 + 插话 + todo 条幅是否冲突**——同一区域叠放/遮挡/互斥，dsh web 里它们如何共存，判定标准都未核实。

评审确认：做（用户标注）；冲突判定标准仍待认领时细化。

## 待确认问题

1. dsh web 中 goal 条幅与 todo/queue 条的叠放关系（源代码不在 dsh-one 仓库，需另找 dsh web 源码或对照可查资料）。
2. dsh-one 若加 goal 条幅，放哪个槽位、与其他条幅是否互斥（如 goal 进行中时是否挡住排队计数头）。

## 涉及代码位置

- `src/ui/chat/webview.ts`：`goal` 命令（:189）；render() 的 pending（:1793）、todo（:1803）、queue（:1807）渲染区——goal 条幅若加大概率在这里。
- `src/ui/chatView.ts`：插话气泡（:215）、排队计数 header（:649）。
- 参考：`docs/dsh-web-expandable-ui-research.md`（QueueDock / todo 形态调研）。

## 变更记录

- 2026-09-01 记录 → open
- 2026-09-01 评审确认：做（用户标注）

- 2026-09-01 认领 → doing（并行开发 session）

- 2026-09-02 开发完成，自测通过（typecheck + 253 测试 + build 全绿）→ done

### 开发完成说明（2026-09-02）

实现：goal 条幅对齐 dsh web 的 GoalBar（`dsh-client-ui-goal` 源码：input.dock id=goal order 10，todo 与 queue 之间垂直叠放、不互斥；active/paused/blocked 渲染、complete/无 goal 不渲染；clear 无确认；编辑条内内联；plan mode 不联动——以上三点经用户确认）。

数据链路（无伪造数据）：`goal` 投影经 `session/projection` 帧 + history 基线折叠（chatSession.ts，与 todos 同机制），`goals/pause|resume|edit|clear` RPC（dshRpc.ts，CAS ref 由投影携带）。webview 渲染条幅（renderGoalBar），图标取自官方 primitives bundle（GOAL_ICONS）。

涉及文件：`src/pure/chatContract.ts`、`src/server/dshRpc.ts`、`src/server/chatSession.ts`、`src/ui/chatView.ts`、`src/ui/chat/icons.ts`、`src/ui/chat/webview.ts`、`test/ui/scenarios.js`（6 个视觉场景，goal-active 进基线）。

**人工验收方法**（真实 VSCode，`dev-ui-test.sh`）：
1. 输入区上方无条幅；发送 `/goal 帮我调研 dsh 的 goal 机制`，待 dsh 返回后出现「进行中的目标」条幅（goal 图标 + objective 截断 + 暂停/编辑/清除按钮），位于 todo 卡与排队消息之间（有排队消息时确认叠放顺序 todo → goal → queue）。
2. 点暂停按钮 → 条幅变「已暂停的目标」，暂停变恢复按钮；点恢复 → 回到「进行中的目标」。
3. 点编辑按钮 → 条内出现预填 objective 的输入框（自动聚焦），改文本回车/点保存 → 条幅显示新 objective；Escape 取消。
4. 点清除按钮 → 条幅消失；再次 `/goal ...` 可重新创建。
5. `/goal complete` 之类使目标完成后条幅消失（不渲染 complete）。
6. 视觉回归：`scripts/ui-visual.sh`（AI 已跑过 22 项 DOM 断言全过；人工可抽查截图）。

- 2026-09-02 同步主线最新代码（rebase 到最新 main，+98 提交：plan-mode-chip/mention-chips/message-turn-timing 等）；冲突 3 处（chatSession.ts 基线+帧投影处理、webview.ts import+保活区、scenarios.js 基线清单）均已解决；重测 typecheck + 253 测试 + build + 22 项 goal DOM 断言 + 5 场景基线抽查全绿；条目随合入到主线。
