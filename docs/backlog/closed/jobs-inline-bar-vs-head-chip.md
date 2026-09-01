# 后台任务展示改造成 dsh web 风格卡片

记录于 2026-08-31。从 ui-parity-leftovers 拆分；方向 2026-08-31 调整（原为"删横条"，已合入；现改为"做更好看的卡片"）。

## 背景与现象

dsh web 会话内有一个可展开的后台任务卡片（示例：并行 workflow 展开后列出各成员，每个成员带"已完成/运行中"状态徽标，顶部有"运行中 2"计数与折叠箭头），比 dsh-one 之前的简单内联横条精致得多。结论：**不删横条，参考 dsh web 做成更好看的版本**。

## 现状

- 此前的内联横条已删（上一轮 jobs-inline-bar-vs-head-chip 已合入），只留头部「N 个后台任务」chip。
- `state.jobs` 链路保留（除横条外还被 blankHero 空态判断消费）；头部 chip 用独立数据源 `state.backgroundJobs`（JobsStore → mux 基线）。
- 要做 dsh web 样式的卡片，需先研究其逻辑（见 "进行一个job查看" 会话界面：`demo-parallel-audit` 卡片）。

## 方案（规划中，待研究确认）

参考 dsh web 卡片样式重做后台任务展示：可展开/折叠，列出后台任务，每个任务带状态徽标，顶部汇总运行中数量。待研究 dsh web 逻辑（交互、数据来源、样式）后细化。

## 涉及代码位置

- `src/ui/chat/webview.ts`（jobs 渲染、头部 chip ~1316、`openJobsMenu` ~1011、空态判断 ~1223）
- 数据源：`state.jobs` / `state.backgroundJobs`

## 变更记录

- 2026-08-31 认领 → doing
- 2026-08-31 开发完成，自测通过 → done（删除横条，已合入）
- 2026-08-31 方向调整：改做 dsh web 风格卡片 → open
- 2026-09-01 关闭：经研究，该方向（后台任务卡片）实际拆成 4 个更具体的独立条目——`workflow-run-card`（workflow 运行卡）、`todo-panel-card`（任务清单卡）、`todo-write-call-card`（消息内 todo 卡）、`header-jobs-interaction-polish`（header 弹层微调）。本条目作为总纲已无独立内容，避免与 4 个条目重复，关闭。→ closed
