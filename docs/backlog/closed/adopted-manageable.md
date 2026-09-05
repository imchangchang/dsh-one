# adopted（另一窗口 spawn 的）实例提供确认式停止/重启入口

## 背景与现象

用户反馈：外部启动的实例没法重启（截图：tooltip 只有「复用外部启动的实例，不会被插件停止 / 在浏览器中打开 / 显示日志」，无重启/停止）。核实原因：用户开着主窗口 + isolated dev 窗口（`.vscode/launch.json` 的 Run Extension 用独立 `.dev-host/user-data`），3080 实例由主窗口 user-data 身份 spawn（`dsh-owned.json` owner），dev 窗口判定为「另一窗口」→ adopted 分支。

**沟通确认**：B 档拍板（A 档确认弹窗停止/重启 + B 档 token 连接）的范围是「外部启动的实例」——实现里把 adopted（另一窗口 spawn）按 multi-window-adopt 旧规则留给 owner 窗口（绝不 kill）。单用户多窗口场景下这是死路，用户确认 adopted 也应可管理（确认弹窗提示影响另一窗口）。

## 方案（已确认）

1. adopted 分支 tooltip 加 Restart External Instance + Stop External Instance 入口（与 external 同款）；文案改「复用另一窗口启动的 dsh；停止/重启会先弹确认，且可能影响正在使用它的窗口」。
2. `manager.stopExternal` 与命令层 guard 放行 `status.adopted === true`（不放松 pid→命令行 dsh 特征→单 pid 信号的安全校验）。
3. 停止确认弹窗文案统一覆盖两种来源（终端 / 另一窗口）；l10n en+zh 各加 2 key。

## 涉及代码位置

- `src/pure/statusTooltip.ts`（adopted 分支入口与文案）
- `src/server/manager.ts`（stopExternal guard）
- `src/extension.ts`（stop/restart 命令 guard + 弹窗文案）
- `l10n/bundle.l10n.json` + `l10n/bundle.l10n.zh-cn.json`

## 变更记录

- 2026-09-05 用户反馈（截图：外部实例无法重启）+ 确认 adopted 也应可管理（沟通澄清 B 档范围）→ 建条目（open/）
- 2026-09-05 认领（open -> doing）：主线直接开发（worktree adopted-manageable）；实现如上；单测 567 全过、typecheck/build 全绿、i18n 门禁通过

- 2026-09-05 开发完成（doing -> done）：分支 agent/adopted-manageable；ledger test/sandbox/verify.adopted-manageable.ledger.json（5 项全过）；真机复验步骤（主窗口 spawn → 另一窗口管理）见条目覆盖说明。

- 2026-09-05 合入（done -> closed）：dev-merge 合入 main（c1621e8）；ledger 5 项全过、审查通过；真机复验步骤见条目。
