# 空白对话切换模型后误显示「窗口未知」占位

记录于 2026-09-02。已核实 + 已定位根因；用户已明确要求修复。

## 现象

空白对话（hero 页：无消息、无任何上下文压力采样）里切换到「本进程从未观察过窗口」的模型后，composer 右下角出现灰字「窗口未知」contextBar 占位。空白对话没有任何可标的上下文数据，这个占位是纯噪音，此页面不应出现。

## 根因（已核实）

「窗口未知」占位（见 closed 条目 context-window-switch-lag）的初衷是：会话**有**旧模型采样（usedTokens 已知）但新模型窗口未观察时，明示「无诚实比例可给」，不沿用旧窗口误导。但实现里 `contextUsageOf`（src/server/chatSession.ts）对 `windowUnknown` **无条件**返回占位：

- `contextUsageUnknown(undefined)` 也映射成 `{ windowUnknown: true }`（src/pure/contextMeter.ts）——「从未有过采样」与「有采样但窗口未知」没区分；
- webview `patchContextBar`（src/ui/chat/webview.ts）对任何 truthy `contextUsage` 都显示，于是空白对话切模型 → 裸占位 → 灰字「窗口未知」。

## 方案（已定案）

占位只保留「有采样」语义，无采样 = 无数据 = 不显示：

1. `contextUsageUnknown` 的 `usedTokens` 收窄为必填；`used === undefined` 时返回 `undefined`（无占位）。
2. `contextUsageOf` 同步：`windowUnknown` 且无采样 → `contextUsage` 缺省，bar 隐藏。
3. `ContextUsage` 契约去掉「裸占位」变体，JSDoc 写明占位始终带最后一次采样的已用量。
4. webview 防御：占位缺 `usedTokens` 时按无数据显示（隐藏 bar）。

- 2026-09-02 用户报告并拍板修复（要求合理改动而非最小补丁）。

- 2026-09-02 认领（worktree: agent/context-bar-blank-window-unknown）→ doing
