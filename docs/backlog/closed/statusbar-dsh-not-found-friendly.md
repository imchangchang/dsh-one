# 状态栏「未安装 dsh」提示温和化

记录于 2026-09-03。背景与现象：电脑上没有安装 DSH 时（激活即 autoStart），状态栏显示红色 `$(dsh-fish) DSH: Error`，用户觉得碍眼——未安装是符合预期的正常使用状态，不是错误。

根因/现状：`locateDsh.ts` 找不到 dsh 时抛 `DshNotFoundError`，`manager.ts` 已把失败原因标为 `reason: 'dshNotFound'`（ServerStatus.reason），但 `src/ui/statusbar.ts` 的 text/color/tooltip 没有消费这个字段，一律落进 `error` 分支：红色 "Error" 文案 + 红色 ThemeColor + "Service Error / Retry Starting" tooltip。

建议方案（用户确认要做）：
- statusbar 识别 `status.state === 'error' && status.reason === 'dshNotFound'`：
  - 文本改为 `DSH: Not installed`（zh：未安装）；
  - 颜色用 `charts.yellow`（提示需要动手装，但非 red 错误）；
  - tooltip 改为「dsh is not installed」+ 安装链接（`dshOne.openInstallPage`）+ Show Logs；
  - 点击整块行为：未安装时跳转安装页（`dshOne.openInstallPage`），不再是无反馈的 `dshOne.openExternal`。
- 其余 error 分支（端口占用、启动超时、launcher 崩溃等真实错误）保持红色 Error 不变。

涉及代码位置：`src/ui/statusbar.ts`（text/color/tooltip/update）、`l10n/bundle.l10n.json`、`l10n/bundle.l10n.zh-cn.json`（新增文案 key：Not installed / dsh is not installed / Install dsh）。

## 变更记录

- 2026-09-03 用户提出：未安装 dsh 时状态栏红色 Error 碍眼，此为正常预期状态。核实 manager 已有 reason 字段、statusbar 未消费，方案如上，进 open/。

- 2026-09-03 认领，进入开发（worktree agent/statusbar-dsh-not-found-friendly）。

- 2026-09-03 开发完成（typecheck + 337 测试 + build 全过，done 标记 7ce7cf2）：statusbar 识别 dshNotFound 显示黄色「未安装」+ tooltip 安装链接 + 点击跳安装页，真实错误保持红色 Error。待主线合入与人工验收。

- 2026-09-03 主线合入（merge commit 见 dev-merge，rebase 后复测 337 测试全过 + dist 重建；用户已看视觉报告确认效果，未跑 dev-ui-test 窗口）。
