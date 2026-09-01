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

## 根因（CI 实测钉死，node v22 windows-latest）

`detached: true`（Windows 触发 DETACHED_PROCESS / CREATE_NEW_PROCESS_GROUP）下，**cmd.exe / PowerShell 这类控制台外壳的输出链断裂**——子进程执行正常（exit 0、dsh 服务能起），但 stdout/stderr 任何形式都收不到：pipe 收集、文件 fd 直传、cmd /c 内部重定向（`> log 2>&1`，文件能建但内容空）全部 0 字节；**node 直跑则输出完全正常**（实测）。与包装方式无关（Node shell:true 自动包装 / 显式 cmd.exe /c / PowerShell 通道均无输出；去掉 detached 立即正常）。对照实测数据见下：

- detached + shell:true / 显式 cmd /c / PowerShell -Command：exit 0 但 out 为空
- 无 detached + shell:true：正常输出 `0.1.1-rc.2`
- detached + node 直跑：正常输出
- detached + cmd /c 重定向：文件创建但内容为空；无 detached 同命令：文件内容正常

## 方案（已实现）

绕开 cmd.exe 层：win32 分支**解析 npm cmd shim（dsh.cmd）背后的真实入口 `node_modules\@deepseek-ai\dsh\lib\bin.js`（CI 打印 dsh.cmd 内容确认），用 `spawn('node', [lib/bin.js, ...args], {detached: true, stdio: 进日志 fd})` 直跑**（与 POSIX 同款，node 在 detached 下输出正常）；shim 解析失败（自定义 dshPath 等）回退 `cmd.exe /d /s /c` 内部重定向 `> log 2>&1`（由 cmd 自己写文件）。dsh 常驻时日志持续由 node 进程直写 fd。CI 的 Windows 冒烟改为经 `dist/spawnDsh.js` 跑 `dsh --version` 并轮询日志出版本号（验收即此），PowerShell 直跑保留作对照。

## 关联

- ci-platform-matrix（CI 冒烟的 spawn dsh 步骤，Windows 部分已改为 PowerShell 直跑 `dsh --version` 验证「Windows 上 dsh 可用」，本 bug 不影响该验证）。

## 变更记录

- 2026-09-01 记录 → open

- 2026-09-01 认领 → doing（并行开发 session）

- 2026-09-01 开发完成，CI 实测验证通过 → done
  - 修复：`src/server/spawnDsh.ts` win32 分支改 node 直跑 dsh 真实入口
    （`lib/bin.js`，解析 npm shim 推断），detached + stdio 进日志 fd；
    shim 解析失败回退 cmd /c 内部重定向。POSIX / DSH_FORCE_PIPE 路径不变。
  - 验证：CI run
    https://github.com/imchangchang/dsh-one/actions/runs/33527829261
    （windows-latest 冒烟输出 `spawned dsh pid=… → dsh smoke OK`，
    日志含 `0.1.1-rc.2`；mac/ubuntu 同步全绿）。root commit 1eaf9ea，
    收尾删除临时诊断步骤/脚本后最终 push 复测：
    https://github.com/imchangchang/dsh-one/actions/runs/33528482138
    （最终版 e699aa0，三平台全绿）。
  - 人工验收方法（Windows 真机）：
    1. 快速冒烟（无 VSCode）：`node dist/spawnDsh.js dsh <任意日志路径> --version`，
       等 2-3s 后日志文件应含版本号（如 `0.1.1-rc.2`），此前恒为 0 字节。
    2. 插件内：正常使用 DSH One 启动 dsh 后，命令面板「DSH One: 显示日志」
       （或 globalStorage 下 dsh-web.log），应能看到 dsh web 启动输出
       （版本/端口等），不再为空文件。
  - 备注：CI 冒烟已改为 Windows 也经 spawnDsh.js 验证日志非空（原为
    PowerShell 直跑，现保留为失败时的对照），该改动随本任务合入。
