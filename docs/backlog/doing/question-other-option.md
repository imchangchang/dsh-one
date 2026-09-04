# 问题卡单选：输入自定义回答时取消选项高亮 + 「其他」选项

## 背景与现象

问题卡（renderQuestionPanel）单选场景下，用户先点选某个选项（如 E1 追加），再往底部「其他（自定义回答）」输入框里打字，**选项的高亮（.selected 青色边框）不消失**。视觉上同时存在「E1 已选中」和「输入框有自定义文本」两种状态，与提交编码矛盾——单选时 `custom` 会覆盖 `selected`，实际提交的是自定义文本，选项被丢弃。

## 根因

`src/ui/chat/webview.ts` `renderQuestionItem`：input 事件处理里已经执行了 `draft.selected.clear()`（应在语义上取消选中），但**没有同步移除选项按钮上的 `.selected` class**，视觉残留直到下一次快照重建才消失；保活态下则一直残留。

## 建议方案（已与用户确认，方案甲）

单选（有选项）交互改为：

1. 选项列表末尾追加「其他」选项（不进入 `draft.selected`，避免提交伪造的「其他」选项 label）。
2. 点「其他」→ 显示其下方输入框并聚焦；输入框输入 → 取消真实选项高亮；点其他选项 → 隐藏输入框、清空自定义文本（现状行为）。
3. 提交编码不变（单选 `custom` 非空 → `selected` 置空）。

多选与无选项问题维持现状（输入框常显 + placeholder「输入你的回答」）。

**明确不做**：「倾向某选项 + 备注补充」——dsh user-questions 协议规定单选 `custom` 覆盖 `selected` 且 `selected` 为空，只有一个自由文本位，协议上表达不了选项+备注并存（多选才允许伴随）。如未来确有高频需求，需按「双字段透传」方案另行设计并评估偏离协议的风险。

## 涉及代码位置

- `src/ui/chat/webview.ts`：`renderQuestionItem`（选项渲染、input 事件）、`QuestionDraft`（增加 other 态）
- `test/ui/scenarios.js`：单选面板期望描述（增加「其他」选项、输入框初始隐藏）
- `test/ui/style.css`：`.question-custom` 显隐
- `l10n/bundle.l10n.*.json`：「其他」按钮文案

## 变更记录

- 2026-09-05 提出（方案甲：输入取消高亮 + 「其他」选项）→ open
- 2026-09-05 认领（worktree: agent/question-other-option）→ doing
