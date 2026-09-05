# 会话头部 preset chip 消失：dsh 0.1.2 把 agentPreset 挪进了 projections

## 背景与现象

用户反馈：会话头部的只读 preset chip（「标准模式」等）现在不显示了。

## 根因（真机数据实证）

dsh 0.1.2 的 session.list 行里 `agentPreset` 从顶层字段迁入了
`projections.values.agentPreset`（字符串 id）。实证（2026-09-06 本机 dsh 0.1.2-rc.1，
GUI 页内按插件协议调 session/list）：679 个会话顶层 `agentPreset` 全部缺省，
116 个会话在 `projections.values.agentPreset` 里有值（如 "kimi"）。

插件链路仍读顶层字段：
- `src/server/dshRpc.ts` `SessionSummary.agentPreset`（顶层）
- `src/ui/sessionsStore.ts` `toSessionInput`：`s.agentPreset !== undefined` 才带
- `src/ui/chatView.ts` `composeHeader`：`self?.agentPreset` undefined → `presetLabel` 永不设置
  → webview 头部 chip（`webview.ts` L3238 `if (state.presetLabel)`）永不渲染。

roster（agentPresets/list）正常，标签映射无需改。hero 选择 chip 不受影响
（走 agentPreset.list + controller 状态，另一条路）。

## 建议方案

`toSessionInput`（及 SessionSummary 窄化）改读 `s.projections?.values.agentPreset`，
顶层字段保留作旧服务端回退：`s.agentPreset ?? (typeof proj === 'string' ? proj : undefined)`。
单测补两种形态。host/session-added 帧的顶层 `agentPreset` 保留（增量帧路径有基线刷新兜底）。

## 涉及代码位置

- `src/server/dshRpc.ts`（SessionSummary 定义 + 窄化辅助）
- `src/ui/sessionsStore.ts`（toSessionInput 映射）
- `src/pure/sessionTree.ts` L50 注释（"session.list 的 agentPreset 字段"已过时，改为 projections）
- `src/ui/chatView.ts` L498-500 注释（"官方 sessionSummarySchema 字段"表述同步修正）
- 单测：sessionsStore / hostFrames 相关测试文件

## 变更记录

- 2026-09-06 用户反馈 preset 显示消失（位置：会话头部只读 chip）→ 真机数据定位根因
  （服务端字段迁移 projections），建条目并认领（open → doing），随 chat-column-layout 一并修复
