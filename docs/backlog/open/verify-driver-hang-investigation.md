# verify-driver 反复挂死（进程存活、无输出、永不返回）

## 背景与现象

沙盒验收驱动 `node test/sandbox/verify-driver.mjs`（Playwright 驱动 code-server 页面、写 ledger/截图）在多个任务中**反复挂死**（2026-09-06）：
- slash-goal-command 验收：driver 挂死数十分钟无返回（bash 工具无输出、进程存活）→ 主线 kill + 接管会话改路径才完成；
- commit-card-jumps-during-streaming 验收：同样挂死（进程 38604/38605 存活、session 等待零事件）→ 主线 kill + 提示会话重跑；
- 另有会话层「delta 0」现象（session 无事件流动，与 driver 挂死伴随或独立，一并调研）。

当前无根因结论。**需求**：派调研 session 查明根因（读 driver 源码 + 复现 + 环境因素），产出修复方案（如全局超时/连接参数/日志）并给出后续防复发机制（如 driver 内建超时与看门狗）。

## 已知线索（起点，需核实）

1. 挂死形态：进程存活、无 stdout 输出（管道 tail -25 无内容）、杀 SIGTERM 即终止——**非 CPU 死循环，是 await 永不返回**（网络/浏览器连接等待无超时？）。
2. 环境：docker 容器（code-server 808x 端口 + dsh 0.1.1/0.1.2 + mock-llm）；多个任务多容器并存；driver 连 `http://localhost:<port>` 指定 URL。
3. 同一次运行有时能完成（多数任务 driver 一次过），偶尔挂死——似乎与容器冷启动/页面未就绪时序有关（之前观察：容器刚起时 F-01 首跑失败重跑即过）。
4. driver 的等待点：workbench 激活、扩展激活、dsh 启动、frame 切换、webview evaluate（之前任务日志可见 code-server webview 帧残留问题——陈旧 iframe evaluate 卡住可能类似）。

## 调研范围（以 driver 源码 + 实际复现为准）

1. `test/sandbox/verify-driver.mjs` 全部 await 点是否有超时（playwright 默认 actionTimeout/navigationTimeout、`waitForSelector` timeout、`evaluate` 无超时等）；找出**第一个可能无限等待**的点。
2. 挂死时的真实状态（进程栈/连接/等待什么）：复现时用 `lsof -p <pid>` 看 TCP 连接、`sample`/`dtruss`（macOS）或 node --inspect？——至少确认等待对象（HTTP 连接 vs CDP vs evaluate）。
3. 环境因素：容器冷启动期间 driver 提前连（页面 404/加载中）、多容器并存端口冲突、code-server 版本行为。
4. **产出**：根因结论（代码行级）+ 修复方案（推荐在 driver 内加全局看门狗超时（如 60s 无事件即失败退出并转储状态）+ 关键等待点显式 timeout + 失败输出诊断信息）+ 防复发（如果根因是环境时序，考虑 driver 预热等待/重试逻辑的建议）。

## 变更记录

- 2026-09-06 用户反馈「反复出现的问题都是咋回事（挂死）」→ 汇总 slash-goal/commit-card 两实例 + 会话层 delta 0 → 建条目（open/，调研任务）
