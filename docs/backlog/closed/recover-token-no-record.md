# 无记录 + 认证实例时日志恢复 token（rc.4 漏掉的路径）

## 背景与现象

rc.4 自愈失败（用户 Windows 实测）：recover-token-from-log（closed）把恢复逻辑放在「记录存在但无 token」分支；用户现场却是**记录已被上次防护清掉（NO-PIDFILE）+ 实例活着（12164）+ dsh-web.log 仍有就绪行 token（82B）**——无记录分支直接 probe authDsh → 防护，恢复逻辑永远执行不到。SSH 复验现场确认（NO-PIDFILE / 12164 监听 3080 / 日志 82B 含 token）。

## 方案（已确认）

恢复逻辑上移：**无记录 + probePort 返回 authDsh 时**（防护分支前），tokenFromLog → probeToken（token 与端口实例绑死，换票成功=扩展上次 spawn 的实例）→ findListenerPid 定位 pid + 命令行探测 version → writeOwned 补记录（token 回归，kill 权归当前窗口）→ re-own running；换票失败/无就绪行 → 原防护（authDshNoToken + 管理入口），不退化。

## 涉及代码位置

- `src/server/manager.ts`：fall-through 的 authDsh 分支前插入 `tokenFromLog` + `probeToken` 恢复尝试

## 变更记录

- 2026-09-05 用户报障（装了 rc.4 未自愈）→ SSH 复验现场确认（记录已清、实例活、日志有 token）→ 根因：恢复逻辑只在有记录分支 → 建条目（open/）
- 2026-09-05 认领（open -> doing）：主线直接开发（worktree recover-token-no-record）；实现如上；typecheck/567 单测全过、i18n 门禁通过

- 2026-09-05 开发完成（doing -> done）：分支 agent/recover-token-no-record；ledger test/sandbox/verify.recover-token-no-record.ledger.json（4 项全过）；Windows 真机验证 = 当前现场（无记录+实例活+日志有 token）装 rc.5 看自愈。

- 2026-09-05 合入（done -> closed）：dev-merge 合入 main（11d3c19）；ledger 4 项全过、审查通过；Windows 自愈验证交用户（rc.5）。
