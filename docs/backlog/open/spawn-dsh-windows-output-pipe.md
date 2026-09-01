# spawnDsh Windows 输出管道 bug（detached+shell 的输出不落盘）

记录于 2026-09-01。来源：ci-platform-matrix 三平台冒烟的 windows-latest 三连败，最终定位到 `src/server/spawnDsh.ts` 在 Windows 上的输出管道问题。**真实影响**：Windows 用户的 dsh 启动日志（logFile）永远为空，排障信息缺失；**功能本体不受影响**（dsh 是 detached 长驻，扩展靠 pid + 服务通道工作，日志只是诊断用途）。

## 现象与证据（CI 实测，windows-latest）

- `dsh` / `dsh.cmd` / `dsh.ps1` 三个 shim 都在 `C:\npm\prefix`（PATH 正常）。
- 对照组直接 `dsh --version` → **0.2s 输出 `0.1.1-rc.2`**（dsh 本身可用）。
- `node dist/spawnDsh.js dsh "$LOG" --version`：pid 打印（spawn 事件触发）但 **20s 后日志 0 字节**。
- 已试两种 stdio 均 0 字节：
  - 文件 fd（`stdio:['ignore', logFd, logFd]`，原始实现）
  - pipe 收集（win32 分支：`stdio:['ignore','pipe','pipe']` + buffer 累积 + exit/2s 兜底写盘，本次为修复尝试）
- mac/ubuntu 同代码路径正常（日志出版本号）。

## 根因（候选，未实机钉死）

Windows 上 `spawn(dshCommand, args, {detached: true, shell: true, windowsHide: true})` 组合：`detached` 在 Windows 触发 CREATE_NEW_PROCESS_GROUP / DETACHED_PROCESS，与 shell 包装（cmd.exe /c "dsh ..."）以及 stdio 句柄传递的交互疑似把子进程输出链断掉——进程树启动后没有执行到 dsh、没有报错、没有任何输出。libuv/Node 在此组合的行为需要 Windows 实机调试（node 版本 v22.23.2 runner）。

## 方案（待实机/排期）

需 Windows 实机或更深的 libuv 行为验证，候选方向：
1. 不用 `detached: true` + `shell: true` 组合：Windows 上显式定位 `dsh.cmd` 完整路径、用 `shell: false` + `cmd.exe /c` 手动拼命令（控制引号），或直接 spawn `dsh.ps1`（PowerShell 通道）。
2. 或者 stdio 全部 `'ignore'`，日志通道改为 dsh 自己的 log（dsh 服务模式可有自己的日志文件），启动器只回 pid。
3. 确认 libuv 相关 issue/正确用法后实现。

## 关联

- ci-platform-matrix（CI 冒烟的 spawn dsh 步骤，Windows 部分已改为 PowerShell 直跑 `dsh --version` 验证「Windows 上 dsh 可用」，本 bug 不影响该验证）。

## 变更记录

- 2026-09-01 记录 → open
