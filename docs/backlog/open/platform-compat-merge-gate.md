# 平台兼容性合入门禁：macOS/Windows/Linux 平台分支必须声明验证覆盖

## 背景：recover-token-from-log 暴露的教训

Windows rc.3 测出「无 token 记录 → 防护死循环」：根因是 **dsh 冷启动 60s+（Windows node/profile 加载慢）→ 用户在 waitReady 完成前 reload 窗口 → 就绪行 token 未补写记录**。macOS 冷启动几秒内就绪、等不到这个窗口，所以 macOS 全程没暴露——**同类平台时序/行为差异在 macOS 上测不出来**。

SSH 实机排查中踩到的平台差异（每个都是"mac 上正常、Windows 上不同"）：
- 就绪行 URL 格式：Windows `http://127.0.0.1:3080/?token=…`（**带 `/`**，macOS 无斜杠）——解析器恰好兼容，但属侥幸
- 进程/端口定位：lsof（mac）/ /proc/net（Linux）/ netstat（Windows）
- 子进程与信号：cmd shim / `taskkill /T /F`（无优雅路径）/ PowerShell 取命令行
- 冷启动时序：Windows 60s+ vs macOS 秒级（waitReady 90s 窗口）
- 相关历史同族问题：`spawn-dsh-windows-output-pipe`（closed）、`windows-subagent-console-flash`（closed）——Windows spawn 输出/控制台行为反复出问题

## 门禁现状（缺口）

`scripts/dev-merge.sh` 合入门禁 = i18n 检查（check-i18n.sh）+ 测试报告人工审查（ledger + report.mjs）。**没有任何机制拦截"平台分支未被验证"的合入**——开发 session 可以在 macOS 上只验证 mac 路径，Windows/Linux 分支靠"推测"写代码，直到用户实机炸出来。

## 目标形态（候选，实施时定稿）

在 `dev-merge.sh` 校验段加一个**平台兼容性自检**（与 check-i18n 并列）——扫描本次合入 diff，命中平台相关代码时要求：

1. **静态扫描点**（至少）：
   - `process.platform` 分支（win32/darwin/linux）
   - 平台专属命令：`lsof` / `netstat` / `taskkill` / `powershell` / `ps -p` / `cmd.exe` / `/proc/`、信号相关（`process.kill`、SIGTERM、`-pgid`）
   - 路径/分隔符：`path.sep`、反斜杠处理、`dsh.cmd`/`.exe`/`.ps1` shim
   - 子进程 stdio/输出重定向（spawnDsh 类）
2. **要求**：命中即强制 ledger/测试报告里逐项声明「每条平台路径在哪验证过」（CI runner / 真机 / 平台解析单测）；未声明 → 门禁拒绝合入，不降级。
3. **加分项**（可选，不同阶段）：CI 增加 win/latest 单测 job（现在 test/ 里 parseNetstatPids 等纯解析已有单测，但无平台行为级验证）；`spawnDsh.js` 的 Windows 实测路径已有 SSH 实机手段，可沉淀为一次性验证脚本。

## 本次修复与门禁的关系

`recover-token-from-log`（closed）本身：Windows 真机验证已交付（用户装 rc.4 实测自愈），但因门禁缺失，这类"平台才现形"的 bug 只能靠用户报障事后修。门禁落地后：改动涉及平台分支就必须在报告里写明覆盖，避免重复此模式。

## 参照

- `scripts/check-i18n.sh`：同位置同风格的现有门禁（diff 扫描 + 输出问题清单 + 拒绝合入）
- `docs/backlog/closed/recover-token-from-log.md`：本次问题完整根因链与证据

## 变更记录

- 2026-09-05 用户要求（反思本次 Windows 兼容问题 → 门槛化防止复发；先不改，只入 backlog）：建条目（open/）
