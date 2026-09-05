# Windows 测试暴露：无 token 记录 + 认证实例进防护死循环（日志恢复自愈）

## 背景与现象

Windows（14xpro-cgeng，192.168.100.226）rc.3 测试日志：`shared pidfile found: pid=12164 port=3080 alive=true owner=this window` 后直接 `probe 401 authDsh → 拒绝另起第二实例`（防护），重复循环。用户视角：实例活着但扩展无法连接、也无法启动。

## 根因（Windows 实机排查，证据链）

1. 实机检查：`dsh-owned.json` 已被防护清（NO-PIDFILE）；端口 3080 被 pid 12164 监听；12164 命令行 = `node ...\~\.dsh\node-x64\node_modules\@deepseek-ai\dsh\lib\bin.js web --host 127.0.0.1 --port 3080 --no-open`（扩展 spawn 发起的实例，--no-open 为扩展参数）；`~\.dsh\node-x64` 为扩展安装器装的 dsh（0.1.2-rc.1 认证实例）；进程 StartTime = 16:10:57 早于扩展激活 16:12:01 约 1 分钟。
2. `dist/spawnDsh.js` Windows **实测正常**（SSH 复现：就绪行含 token 正确写入日志文件）；`parseReadyLine` 对 Windows 格式（`http://127.0.0.1:3099/?token=…` 带 `/`）解析正常（已有单测覆盖）。
3. 时间线：16:10:57 上一窗口 spawn 12164 → dsh 冷启动 60s+ → 就绪行 **16:12:00** 写入 `dsh-web.log`（82B，含 token）→ **16:12:01 用户在 waitReady 完成前 reload/关闭了窗口** → manager 399 行 token 补写未执行 → 记录停在无 token 版（392 行先行写入）→ 新窗口读记录 → 无 token + authDsh → 身份无法确认 → **clear 记录 + 防护**（不另起）→ 循环。macOS 冷启动几秒内就绪，等不到此窗口；Windows 60s+ 常见。

## 方案（已拍板）

无 token 记录 + 端口 authDsh 时，**从 logFile 重解析就绪行 token**（`readyInfoFromLog` 读前 64KB）→ `probeToken` 换票成功即身份确认（token 只被该进程换出）→ 补写记录（`findListenerPid` 刷新 pid 防复用）→ 按 owner 判定 re-own/adopt **自愈**；换票失败/无就绪行落空走原 clear+防护（不退化）。

## 涉及代码位置

- `src/server/manager.ts`：record 分支新增恢复 else 分支；`readyPortFromLog` 重构为 `readyInfoFromLog`（新增 `tokenFromLog`）

## 变更记录

- 2026-09-05 用户 Windows rc.3 测试报障（防护死循环日志）→ SSH 实机排查（dsh-owned/进程/日志/时间线/spawnDsh 实测）→ 根因如上 → 建条目（open/）
- 2026-09-05 认领（open -> doing）：主线直接开发（worktree recover-token-from-log）；实现如上；typecheck/567 单测全过 i18n 门禁通过

- 2026-09-05 开发完成（doing -> done）：分支 agent/recover-token-from-log；ledger test/sandbox/verify.recover-token-from-log.ledger.json（4 项全过）；Windows 真机验证步骤见条目覆盖说明（装 rc.4 → 清记录保实例 → reload 看自愈）。

- 2026-09-05 合入（done -> closed）：dev-merge 合入 main（4eac9d9）；ledger 4 项全过、审查通过；Windows 自愈验证交用户（rc.4）。
