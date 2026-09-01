# goal 模式条幅缺失；与排队/插话/todo 条幅的共存冲突待确认

记录于 2026-09-01。观察来源：dsh web（宿主 DeepSeek Harness Web GUI）截图——输入区上方有「进行中的目标」条幅（含暂停/编辑/删除操作，见会话记录附图），该截图是 dsh web 的，不是 dsh-one 的。

## 背景与现象

- dsh web 界面在输入区上方有「进行中的目标」goal 条幅；此外该界面还有排队（输入框上方 QueueDock）、插话（等待插话气泡）、todo（任务清单卡）等条幅/卡片。
- **dsh-one 现在没有 goal 模式的条幅**：`goal` 只作为聊天命令存在（`src/ui/chat/webview.ts:189`），界面层没有对应条幅。

## 现状（已核实）

- dsh-one webview 渲染顺序：messages → `pending`（approval/question）→ todo 面板（webview.ts:1803）→ queue 队列（:1807）→ composer。这个区域目前没有 goal 条幅的位置。
- 目标（未定）：给 dsh-one 补 goal 模式条幅、对齐 dsh web；届时需确认 **goal 条幅 + 排队 + 插话 + todo 条幅是否冲突**——同一区域叠放/遮挡/互斥，dsh web 里它们如何共存，判定标准都未核实。

想法：未确认（是否新增、冲突判定标准都未定，先记录观察）。

## 待确认问题

1. dsh web 中 goal 条幅与 todo/queue 条的叠放关系（源代码不在 dsh-one 仓库，需另找 dsh web 源码或对照可查资料）。
2. dsh-one 若加 goal 条幅，放哪个槽位、与其他条幅是否互斥（如 goal 进行中时是否挡住排队计数头）。

## 涉及代码位置

- `src/ui/chat/webview.ts`：`goal` 命令（:189）；render() 的 pending（:1793）、todo（:1803）、queue（:1807）渲染区——goal 条幅若加大概率在这里。
- `src/ui/chatView.ts`：插话气泡（:215）、排队计数 header（:649）。
- 参考：`docs/dsh-web-expandable-ui-research.md`（QueueDock / todo 形态调研）。

## 变更记录

- 2026-09-01 记录 → open
