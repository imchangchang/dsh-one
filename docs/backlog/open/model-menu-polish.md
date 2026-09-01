# 模型选择器差异：菜单内容与 trigger 形态（局部缺失）

记录于 2026-09-01。对比 dsh web 聊天面板与 dsh-one 时发现；2026-09-01 评审标注「待定（用户：再核实一下）」，已核实，结论如下。

## 现状（已核实 2026-09-01）

dsh web 模型选择（`dsh-client-ui-model-selection`，lib/client.js:438-621）：模型/推理等级两级菜单、按 provider 分组带描述、loading/error/Retry 态；trigger 含推理等级后缀；模型不可用时输入区有专门阻塞文案。

dsh-one 核对结果：

- ✅ **已对齐**：trigger 显示「模型名 + 推理等级名」（`src/server/chatSession.ts` `modelLabelOf` :100-114，web 风格 "DeepSeek-V4-Flash-Vision-Exp Max"）；两级菜单结构（模型/推理等级）一致。
- ❌ **仍缺**：模型列表无描述（`renderModelMenuModels` webview.ts:1154-1180 只有分组名 + 模型名 + 勾选）；菜单无 loading/error/**Retry 行**（openModelMenu :1117-1128 只有「加载中…」hint）；模型不可用时无「当前模型不可用，请先选择模型」式阻塞文案（置灰时 placeholder 是「服务未就绪，暂时无法发送」）。

## 涉及代码位置

- dsh web：`dsh-client-ui-model-selection`
- dsh-one：`src/ui/chat/webview.ts`（renderModelMenuRoot / renderModelMenuModels / openModelMenu / renderInput 的 model pill）、`src/server/chatSession.ts`（modelLabelOf，已对齐部分）

## 变更记录

- 2026-09-01 记录 → open
- 2026-09-01 评审：待定（用户标注「就是这个样子，再核实一下」）；已核实 trigger 对齐、菜单描述/Retry/阻塞文案仍缺，待用户拍板是否补齐
