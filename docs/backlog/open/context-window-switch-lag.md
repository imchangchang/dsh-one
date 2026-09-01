# 切换模型后上下文窗口显示滞后

记录于 2026-09-01。已核实 + 已定位根因；处理方案留待后续探索。

## 背景与现象

右下角 contextBar（`上下文已用 23% ~245K / 1M`）显示的是当前模型的上下文窗口。切换模型后，这个窗口**不会立刻跟着切**——它一直保持上一个模型的窗口值，直到发出下一条消息才会刷新。

由此存在一个误导场景：从 1M 上下文的模型切到 256K 的模型后、未发新消息前，窗口仍按 1M 显示（如 `245K / 1M ≈ 23%`，看似宽松），而实际模型只有 256K 容量。直到下一条消息发出，窗口才刷成 `245K / 256K ≈ 95%`（warn/危险档）。

## 根因（已核实）

contextBar 的容量分母 `contextWindow` 来自 `contextPressure` 投影；该投影的 `contextWindow` **只被 `request/context` 事件更新**，而 `request/context` 只在 agent **真正 `prepareCall` 时**（即下一次请求发出时）才 append，且 provider/model/contextWindow 三者之一变化才发。

- `contextPressure` 投影：`dsh-token-meter/lib/index.js`（`contextPressureProjection.apply`：`contextWindow` 仅在 `event.type === "request/context"` 时写入）。
- `request/context` 唯一真实触发点：`dsh-agent-loop/lib/index.js`（`prepareCall` 流程，约 749 行）。
- 右下角 `ContextMeter` 读取：`dsh-client-ui-conversation/lib/client.js`（`useProjection("contextPressure")` → `contextOccupancy`）。
- 切换模型本身走 `sessions.selectModel` RPC（`dsh-client-ui-model-selection` → `dsh-host-apiproxy` `api-proxy.js` `selectModel`），只做 `resolveCallConfig` + 设 selection + 保存默认，**不 append 任何 session 事件、不碰投影**。
- dsh-one 侧同理：`src/server/chatSession.ts` 的 `contextUsageOf` 读 `pressure.contextWindow`（同源投影）。

真实安全性不受影响：超限/压缩判断在请求时按目标模型窗口做（`dsh-compaction-basic` 用 `resolveModelInfo().context.contextWindow` 算阈值），请求不会静默把超限内容发给模型。真正问题是**切换与下一条消息之间的窗口期内，显示值在误导用户**。

## 方案（想法：未确认，待本条目内探索）

目标行为：切模型后 contextBar 立即反映新模型窗口；若已用量超新窗口，则提示当前上下文不足，建议先用旧模型 compact 再切。

候选方向（未定，需在本条目内对比后再定）：
1. `selectModel` 时立刻 append `request/context`（用 `resolveModelInfo` 取新模型 `context.contextWindow`），让投影与 meter 立即刷新，超限自动进 red/overflow。
2. 在 model-selection 成功回调里单独算一次并推给 contextBar，不动服务端事件。

## 涉及代码位置

- `node_modules/@deepseek-ai/dsh-token-meter/lib/index.js`（`contextPressure` 投影）
- `node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js`（`request/context` 触发点）
- `node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js`（`ContextMeter` / `contextOccupancy`）
- `node_modules/@deepseek-ai/dsh-host-apiproxy/lib/types/api-proxy.js`（`selectModel`）
- `src/server/chatSession.ts` / `src/pure/contextMeter.ts` / `src/ui/chat/webview.ts`（dsh-one 侧）
- 2026-09-01 评审确认：做（用户标注）
