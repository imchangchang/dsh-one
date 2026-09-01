# 模型选择器差异：菜单内容与 trigger 形态（局部缺失）

记录于 2026-09-01。对比 dsh web 聊天面板与 dsh-one 时发现。

## 现象

dsh web 模型选择（`dsh-client-ui-model-selection`，lib/client.js:438-621）：

1. **菜单**：Model/Effort 两级面板，Model 按 provider 分组带**描述**，含 loading / error / **Retry 行**。
2. **trigger**：模型名 + **推理等级后缀 + chevron**；未选时「选择模型」。
3. **阻塞提示**：模型不可用时输入区显示「当前模型不可用，请先选择模型」。

dsh-one（webview.ts:1116-1207）：

- 菜单无模型描述、无 loading/error/Retry 态（只有分组 + 名称 + 勾选）；
- trigger 只显示模型名（无推理等级后缀）；
- 模型不可用时只是 `!canSend` 置灰输入框，无专门阻塞文案。

## 涉及代码位置

- dsh web：`dsh-client-ui-model-selection`
- dsh-one：`src/ui/chat/webview.ts`（renderModelMenuRoot / openModelMenu / renderInput 的 model pill / canSend 文案）

## 变更记录

- 2026-09-01 记录 → open
