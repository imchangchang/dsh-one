# 聊天流 live-jobs 横条与头部 chip 的去留

记录于 2026-08-31。从 ui-parity-leftovers 拆分。

## 背景与现象

官方 dsh web 会话内只有头部「N 个后台任务」chip；dsh-one 除了头部 chip，聊天流里还渲染运行中任务的内联横条（`state.jobs` 驱动的 queue），两处并存展示同一批 job。

## 现状

- 头部 chip：`webview.ts` 用 `jobsChipLabel(state.backgroundJobs)` 渲染，点击 `openJobsMenu` 弹出任务菜单。
- 聊天流内联横条：`webview.ts` `state.jobs` 渲染 queue 行（`renderJobsMenuRow`），任务完成/失败后消失。
- 官方行为尚未逐点核实（会话内是否真的没有内联横条、chip 是否有别的主次关系）。

## 方案（已定 2026-08-31，人工确认）

**删掉聊天流内联横条，只留头部 chip**（对齐官方）。

- 移除 `webview.ts` 里 `state.jobs` 驱动的 queue 横条渲染（~1485 附近）。
- 核实 `state.jobs` 是否只服务横条：若没有其他消费点，一并清理该状态；头部 chip 用的 `backgroundJobs` 数据源**必须保留**。
- 清理不再使用的样式和渲染函数（`renderJobsMenuRow` 是否还被 `openJobsMenu` 的任务菜单用，保留任务菜单）。

## 涉及代码位置

- `src/ui/chat/webview.ts`（queue 横条渲染 ~1485、头部 chip ~1316、`openJobsMenu` ~1011）

## 变更记录

- 2026-08-31 认领（worktree: agent/jobs-inline-bar-vs-head-chip）→ doing
