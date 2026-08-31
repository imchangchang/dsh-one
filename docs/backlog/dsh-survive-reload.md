# dsh 服务与 VSCode 生命周期解绑（reload 不重启 dsh）

记录于 2026-08-31。

## 背景与现象

dsh-one spawn 出来的 dsh web 服务与 VSCode 窗口生命周期绑定：关闭窗口或 reload window（包括用 dsh-one 打开另一个 workspace 文件夹触发的隐式 reload）时，`deactivate()` 会杀掉 dsh，重新激活后再重新 spawn。后果是 reload 期间正在进行的 session/turn 被中断。用户明确期望：即使是 VSCode 拉起的 dsh，也不要随 VSCode 关闭。

## 现状与根因

`src/server/manager.ts`：

- spawn 的子进程记为 owned（`ownedPid`），`deactivate()` → `killSync()`（manager.ts:394）同步 SIGTERM 进程组，并留一个 3 秒后补 SIGKILL 的 detached reaper。这是 reload 时 dsh 被杀的直接原因。
- 端口上已有 dsh 时是 adopted，永不杀（manager.ts:164），这条路径没问题。
- spawn 时 `stdio: ['ignore', 'pipe', 'pipe']`，readiness 靠解析 stdout 的 ready line（`parseReadyLine`）。

**为什么不能只删 killSync**：pipe 的读端在扩展宿主进程里，宿主退出后读端关闭，dsh 下次写日志会收到 EPIPE，Node 进程可能直接崩溃。要"父死子存"，必须先把 stdio 改为重定向到日志文件。

**dsh 侧已确认的事实**（2026-08-31 查证）：

- 端口被占时 dsh web 直接启动失败（EADDRINUSE 抛出，见 dsh-host-webserver README），不会自己换端口——所以 readiness 轮询固定端口即可，不依赖 ready line。
- `host.describe` 响应为 `{version, cwd, attachedSessions, home, canOpenPath}`，不含 pid——ownership 无法通过 describe 完美验证。

**关联 bug**：manager.ts:192 端口被 foreign 占用时算了 fallback 端口 `spawnPort`，但传给 dsh 的 `--port` 仍是原值，fallback 逻辑实际不生效，foreign 占用时必然启动失败。修本条时一并修复。

## 建议方案（已与用户讨论，待拍板后实施）

1. spawn：`detached: true` + `child.unref()`，stdio 重定向到 globalStorage 下的日志文件；readiness 改为轮询 `probePort`（身份确认照旧靠 rpcId 回显）。
2. 删除 `deactivate()` 对 dsh 的清理；dsh 只在用户显式 `dshOne.stop` / `dshOne.restart` 时被杀。
3. pidfile 记录 ownership：spawn 成功后写 `{pid, port}` 到 globalStorage；reload 后 probe 到 dsh 时读 pidfile，pid 存活则恢复 owned 身份（stop/restart 语义不变），否则走现有 adopted 逻辑。
4. 不留旧行为开关（用户已明确不需要）。

## 待拍板的决策点

1. **版本升级副作用**：dsh 常驻后，终端升级 dsh 不会自动生效，需手动 restart。可选增强：re-own 时对比 describe 的 version 与本机 dsh 版本，不一致提示重启。（倾向先不做）
2. **PID 复用残留风险**：describe 无 pid，只能靠 pidfile + 存活检查 + 端口匹配；极端情况（dsh 死亡 + pid 被复用 + 端口被另一手动 dsh 占用同时成立）下 stop 会误杀复用 pid 的进程。（倾向接受，注释说明）
3. **日志文件策略**：每次 spawn 截断 vs 按时间滚动保留。（倾向截断）
4. **死代码**：readiness 改轮询后 `src/pure/readyLine.ts` 及其测试无用。（倾向删除）
5. **re-own 后的意外退出发现**：无进程句柄，只能靠 30s 健康检查发现，是否需要在健康检查失败时弹窗提示。（原 spawn 路径有即时弹窗）

涉及文件：`src/server/manager.ts`（start/waitReady/killOwned/killSync/dispose）、`src/extension.ts`（deactivate）、`src/pure/readyLine.ts`、`test/readyLine.test.ts`。
