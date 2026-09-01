# header jobs 弹层交互微调对齐官方

记录于 2026-08-31。

## 背景与现象

头部「N 个后台任务」chip 的下拉弹层是仿官方 dsh-client-ui-jobs 的 JobListAction 实现的，个别交互细节需对照官方微调（外部点击/Esc 关闭、打开时才有 1s 时长跳秒计时等）。

## 现状

- dsh-one 已有：头部 chip + openJobsMenu 下拉（jobsStore 的 jobsBySession 数据，activityTree.ts 的 jobsChipLabel/jobDotState/jobStatusLabel 已有官方语义）。
- 需核对官方 `JobListAction`（dsh-client-ui-jobs/lib/client.js:117）的交互细节并补齐。

## 方案

对照官方微调：点 trigger 切换开合；外部点击/Esc/任务清空自动关闭；仅打开且有 live job 时 1s interval 刷 now 让时长跳秒；行 = StateDot + kind + label + status(detail ?? status) + duration；排序 live 前按 startedAt 升序、settled 按 finishedAt 降序（activityTree orderJobs 已有）。

## 涉及代码位置

- `src/ui/chat/webview.ts`（openJobsMenu 弹层、jobsTick）
- `src/pure/activityTree.ts`（orderJobs/jobsChipLabel 等，可能微调）

## 变更记录

- 2026-09-01 认领（worktree: agent/header-jobs-interaction-polish）→ doing
