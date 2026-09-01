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

## 方案（已定案 2026-09-01）

目标行为：切模型后 contextBar 立即反映新模型窗口；若已用量超新窗口，则超限显示。

**定案：候选 2（客户端重算，不动服务端事件）。** 关键前置核实：

- `selectModel` 服务端实现内部会调 `llm.resolveCallConfig`，其结果**其实有** `resolved.context.contextWindow`，但 RPC 只回 `{ selected: {provider,model,reasoningEffort} }`，**丢弃了窗口**。官方包（`dsh-host-apiproxy` 的 `sessions.selectModel`）不可改，客户端拿不到这个窗口。
- `session.models` / `llm.models` 的目录 schema（`modelCatalogModelSchema`）**不含** `context`，所以现有 `sessionModels()` RPC 也拿不到窗口。
- 结论：客户端**没有任何 RPC 能查到某模型的确切窗口**。唯一可靠的窗口来源是会话历史/实时流里已经发生过的 `request/context` 事件（其 `data = { provider, model, contextWindow }`，见 `dsh-agent-loop` `prepareCall`）。

**实现：客户端学习式映射 + selectModel 回调重算。**

1. 在 `ChatSessionController` 里加一个模块级 `MODEL_CONTEXT_WINDOW`（`provider/model → contextWindow`），在 `loadBaseline`（扫历史事件）、`onFrame` 的 `session/event`（实时）、`rebaseline`（缓冲重放）里，凡看到 `request/context` 就 `rememberModelContextWindow` 记录。
2. 新增 `applyModelSwitch(selection)`：`selectModel` 成功后，用它查新模型窗口；命中则把 `this.contextPressure.contextWindow` 覆写为新窗口并 `push(true)`，contextBar 立即重算。
3. 超限显示复用现有路径：`contextUsageOf` 用覆写后的 `contextWindow` 算 percent，`meterLevel(used, window, turns)` 在 `used > window` 时返回 `overflow`，webview 的 `level-overflow`（红）与 `cp-overflow` 面板提示（「已超出当前模型窗口」）自动生效，无需另造 UI。

**取舍与已知残留：**
- 服务端事件路径未动：候选 1（selectModel 时 append `request/context`）需改官方包或发模拟事件（不可靠），弃。
- 窗口未知的边缘：若目标模型从未在本 dsh-one 进程内被观察过（map 无记录），覆写不发生，contextBar 保持旧窗口直至下一条消息发出（`request/context` 补上）。这是无 RPC 前提下的诚实残留，常见场景（用户在两三个已知模型间切换）已被 map 覆盖。
- 覆写在重连 re-baseline（`loadBaseline` 重读投影）时可能被旧窗口回退，但 re-baseline 只在断线重连时发生，且届时用户通常已发过新消息（新窗口已就位）。可接受。
- 真正的服务端权威修法：让官方包在 `selectModel` 响应里带 `context.contextWindow`，或在 `selectModel` 时发一条 `request/context`。dsh-one 不能改官方包，故不采用。

## 涉及代码位置

- `node_modules/@deepseek-ai/dsh-token-meter/lib/index.js`（`contextPressure` 投影）
- `node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js`（`request/context` 触发点）
- `node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js`（`ContextMeter` / `contextOccupancy`）
- `node_modules/@deepseek-ai/dsh-host-apiproxy/lib/types/api-proxy.js`（`selectModel`）
- `src/server/chatSession.ts` / `src/pure/contextMeter.ts` / `src/ui/chat/webview.ts`（dsh-one 侧）
- 2026-09-01 评审确认：做（用户标注）

- 2026-09-01 认领（worktree: agent/context-window-switch-lag）→ doing
- 2026-09-01 定案：候选 2 + 客户端学习式映射（`request/context` 观察 → `provider/model→contextWindow` map → `applyModelSwitch` 覆写 `contextPressure.contextWindow`）；核实 selectModel 响应与模型目录均不带 context，客户端无 RPC 可查窗口；候选 1（动服务端事件）弃。
