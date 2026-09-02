# 接管外部启动的 dsh 实例（可停止/重启）

记录于 2026-09-02。现状：扩展探测到配置端口上已有 dsh（如用户在终端手动 `dsh web`）时采纳（`adopted: true`），tooltip 明确提示「复用外部启动的实例，不会被插件停止」，且**隐藏「重启服务 / 停止服务」按钮**（statusbar.ts:46-52，`if (!status.adopted)`）。用户提议：外部启动的实例也应能接管，即用扩展的停止/重启也能关掉、重启它。

## 调研结论（2026-09-02 讨论，已核实 dsh 0.1.1-rc.2 源码）

1. **无 shutdown RPC**。host API 方法表（`dsh-host-apiproxy`）只有 `host.describe / pickDirectory / listDirectory / createDirectory / openPath` 五个方法，没有 shutdown；dsh CLI 也没有「停止已运行 web 实例」的命令。停外部实例只能找 pid 杀。
2. **POSIX 可以优雅关闭**：`dsh web` 在 CLI 进程内同进程启动整个 web app（`profile-boot` 的 `runProfile` 里 `boot()` 直接在当前进程跑，webserver 的 listen 也在其中），且 CLI 装了 SIGTERM/SIGINT 处理（`createProcessShutdown` + `process.on('SIGTERM')`）——收到信号后 dispose 整棵 cordis 树，webserver 清理 effect 走 `server.close()` + `closeAllConnections()`。所以**给端口监听进程单个发 SIGTERM = 走 dsh 自己的优雅关闭**，无需 `killOwned` 的 SIGTERM→SIGKILL 升级链之外的额外机制（5s 兜底仍保留）。
3. **Windows 没有优雅路径**：node 在 Windows 上无真正信号，`process.kill(pid, 'SIGTERM')` 实际是 TerminateProcess，dsh 的 SIGTERM handler 收不到，只能 `taskkill /T /F` 硬杀。
4. **不能复用 `killOwned` 的进程组杀法**：`killOwned`（manager.ts:438-466）对 POSIX 用 `process.kill(-pid, 'SIGTERM')` 杀**整个进程组**——对扩展自己 detached 拉起的实例成立；但外部实例多半在终端里 `dsh web` 起的，其进程组是 **shell 的**，`-pid` 会把终端里的 shell 及其他任务一起杀掉。接管必须**只向单 pid 发信号**。
5. **找 pid 三平台**：macOS `lsof -tiTCP:<port> -sTCP:LISTEN`；Linux 可扫 /proc（`/proc/net/tcp` 端口十六进制 + `/proc/<pid>/fd` inode 对照，不依赖 lsof）；Windows `netstat -ano`（或 PowerShell `Get-NetTCPConnection`）+ `tasklist`。
6. **身份核实比 owned 更弱**：`host.describe` 响应不带 pid，找不到 pid 则无法停；杀前用 `ps`/`tasklist` 对照命令行含 `@deepseek-ai/dsh` 可把「pid/端口被复用」的误杀窗口压小，但理论竞态消不掉——owned 路径的 pidfile 误杀风险（architecture.md 决策 1 已知风险）已拍板接受，属同类。

## 决策

2026-09-02 讨论后用户拍板：**先不做**。保留现状（收养不杀、隐藏停止/重启按钮）。原因：收益偏低（外部启动场景少见），成本是平台三套 pid 探测代码 + 确认弹窗 + 文档翻修改（architecture.md 决策 2「收养的实例永不 kill」、release-checklist 人工验收第 21 行）。以后要做时按上述调研直接动工。

## 涉及代码位置（将来做时）

- `src/server/manager.ts`：新增 adopted 实例的 pid 探测 + 单 pid 优雅停止（SIGTERM→5s→SIGKILL；Windows `taskkill /T /F`），restart 在 stop 后走正常 spawn（新实例即 owned，后续免确认）。
- `src/ui/statusbar.ts`：adopted 也显示「重启服务 / 停止服务」，删除「不会被插件停止」提示；停止/重启弹一次确认（外部实例可能是用户终端进程，正在终端看日志）。
- `docs/architecture.md` 决策 2、`docs/release-checklist.md` 相应验收项。

## 变更记录

- 2026-09-02 用户提议接管外部实例 → 调研（dsh 0.1.1-rc.2 源码核实 shutdown 缺失、SIGTERM 优雅路径、进程组坑、平台 pid 探测）→ 用户拍板先不做，结论与依据记入 open/（未开始修改）。
