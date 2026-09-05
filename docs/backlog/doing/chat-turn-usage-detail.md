# 回答末尾 token 用量明细（药丸+弹窗）

## 背景（源自 dsh-0.1.2-interaction-gaps 调研，官方 0.1.2 实现已核实）

官方 `TurnTailNodeView` + `TurnUsagePanel`/`TurnTimePanel`：每条已结束回答行尾两个药丸按钮（用量 N tokens / 用时 duration），点击弹锚定对话框——用量明细（provider/model 路由、缓存命中%、未缓存输入/缓存读/缓存写/输出/其中推理，精确整数）、耗时明细（总用时、TPS、TTFT）。数据源 `turn-usage.ts`：**只在 turn/start 在窗口内时**，折叠 turn/start→turn/end 间每次尝试的 `assistant/message`+`assistant/chunk` usage 样本；缺边界或计数不安全时整项缺省（宁可不出，不虚报）。

## dsh-one 现状

已有单行消息级计时（`用时 · 首 token · tok/s`，message-turn-timing-metrics 已闭环）；host 侧聚合（`turnTimingOf`，chatMessages.ts 附近）已消费 `assistant/message` 的 `usage.outputTokens`——usage 明细数据已到 host，只差：聚合输入/缓存/路由字段 + 一行药丸 UI。

## 方案（P1，低成本）

1. host 侧：`turnTimingOf`（或相邻聚合函数）扩展——按官方 turn-usage 语义聚合每次尝试的 usage 样本（输入/缓存读/缓存写/输出/推理/provider/model/路由），**遵守「缺边界宁可缺省」**（turn/start 不在窗口、计数不安全 → 整项不出，不虚报）。
2. webview 侧：已结束回答行尾（现有计时行位置）加「用量 N tokens」药丸（复用/扩展现有计时行），点开弹锚定小窗显示明细（与官方字段对齐：provider/model、缓存命中%、四项 token 拆解、其中推理）；耗时保持现有单行（可并入弹窗，视实现）。
3. 平台对照：字段以官方 `dsh-0.1.2-rc.1`（packages/client/ui-chat TurnUsagePanel）为准；实现时以当时代码为准重新定位（消息渲染已增量更新，行尾结构可能变化——本条目排在阶段 2 之后，基线含增量更新）。

## 验收

- 明细字段与官方对齐（至少：总 token/输入/输出/其中推理/缓存命中或 missing 标注/provider+model 路由）；缺失样本时不显示药丸（缺省语义）。
- harness 场景（构造带 usage 的 assistant/message 快照）+ 截图；真实 dsh 沙盒回归（回显 + 工具轮次，若有 usage 采样）。
- 报告按 SKILL 流程 5。

## 变更记录

- 2026-09-05 从 dsh-0.1.2-interaction-gaps 拆分（P1 项）→ open

- 2026-09-05 认领（open → doing）：阶段 3-P1 token 用量明细开发 session 认领，worktree slug chat-stage3-p1
