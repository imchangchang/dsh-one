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

## 调研结论（2026-09-05 调研 session）

### 根因：Playwright 已知缺陷 + driver 关键调用无超时

**机制**（已本地最小实验复现，Playwright 1.62.1 + 本地 chromium）：code-server 的 webview 内容帧被宿主反复重建（README/驱动注释记载；recycle-bin-drawer 变更记录亦记「E2E 尾段 webview 帧重建伪影」）。重建的瞬间，iframe 处于**「挂起导航、尚无执行上下文」**状态——实测 `frame.url()` 返回空串，对它调 `frame.evaluate()` 或 `locator.count()` **永不返回**（12s×10 竞速口径无响应；端点响应恢复后 4ms 即 resolve）。这是 Playwright/Chromium 已知行为：microsoft/playwright#40511（lazy/未装载 iframe 上 frame.evaluate 挂死；关联 #9675 / #8943），该 issue 的社区 workaround = 跳过 `frame.url()==''` 的帧。

**driver 侧无防护**：`frame.evaluate` / `locator.count()` / `isVisible()` 调用都不带超时，且**不遵守所在扫描循环的墙钟边界**——一个永不 settle 的 await 直接把 `findFrame`/`waitForText`/`approvePending` 整个卡死。作者用 try/catch 假设「帧重建间隙瞬间查空/抛错」，但该状态下调用既不 resolve 也不 reject，try/catch 无效。与挂死形态（进程存活、无输出、SIGTERM 即终止 = 单 await 永不返回）完全吻合；插桩看门狗版 driver 跑 6 轮 F-01 + 冷启动复跑 + 帧观察探针，均未撞上窗口（窗口很短的竞态，撞上即挂、撞不上即过——与「偶尔挂死、重跑即过」一致）。

### 等待点总表（main `test/sandbox/verify-driver.mjs` 行号）

| 位置 | 调用 | 超时 | 循环墙钟能否兜底 |
|---|---|---|---|
| L69-82 findFrame | `predicate(f)` = 帧上 evaluate | 无 | **不能**（单个返回永不返回击穿 10s/30s 边界） |
| L85 isSessionsFrame / L90 isChatFrame | `f.evaluate(...)` | 无 | 同上 |
| L106 newChatAndGetFrame | `newBtn.count()` | 无 | 同上（且 L104-114 循环本身无界） |
| L159-173 waitForText | `f.locator('body').filter({hasText}).count()` | 无 | **不能**（120s 边界被击穿） |
| L213-238 approvePending | `btn.count()` / `btn.isVisible()` | 无 | **不能**（60s PENDING_TIMEOUT 被击穿） |
| L252 fillAndClickClear | `chat.evaluate(...)` | 无 | 不能（无循环保护） |
| L260-274 waitForDraft | `f.evaluate(...)` | 无 | **不能**（30s 边界被击穿） |
| worktree 版 L~215 popoverCommitCardVisible | `f.locator('.popover .commit-card').count()` | 无 | **不能**（hoverSustainMs 轮询被击穿） |
| L290 goto / L291 waitForSelector / L295 click | - | 60s / 30s / 15s | 有界 ✓ |
| L108/124 click、L121 hover、L149/202/249 waitFor、L150-153 click/fill、L181-183 waitFor、L366 screenshot | - | 5-30s（fill/click 默认 30s） | 有界 ✓ |

其余同步操作（saveLedger 等）无风险。`chromium.launch`/`browser.newPage` 有默认 30s。

### 复现记录（实测 vs 推断）

- **已复现（最小实验，`/tmp/dsh-hang-repro/min-repro*.mjs`）**：
  - 指向无响应端点的 iframe：`frame.evaluate`、`locator.count()` 永久挂死；`locator.waitFor({state, timeout})` 2s 正常 reject；`frame.isDetached()` 恒 false（不可用作检测）；端点恢复后 evaluate 4ms 返回。
  - `frame.evaluate(fn, undefined, {timeout:3000})`：**timeout 选项被忽略，仍挂死**；`locator.evaluate(fn, undefined, {timeout:3000})` 有效（3s reject）。→ 修复不能靠 evaluate 的 timeout 选项，必须竞速包装。
  - 慢响应（60s）iframe：挂起期间 `url()==''`、evaluate/count 全挂；响应到达后恢复。
- **未复现（完整挂死未撞上）**：`dsh-sandbox:latest`（13:37 镜像，mock-llm）+ 实例 hang-inv 上跑原版 driver 全 ledger 1 次（4 项全过）、插桩看门狗版 F-01 6 轮、重启容器冷启动后立即跑 1 次、帧观察探针 3 个——均通过。**推断**：真窗口是 dsh 冷启动（插件 `ensureStarted` 按需起 dsh，默认端口 3080，就绪轮询 250ms，`src/server/manager.ts`）期间首个会话的 webview 内容帧处于挂起导航，窗口 1-3s；就绪后无窗口。driver 的 250ms 全帧轮询撞上即死——与「偶尔挂死」「重跑即过」一致。
- **页面帧树（探针实测）**：点开 DSH One 后 frames = [workbench 顶层, webWorkerExtensionHostIframe, webview 外框 `pre/index.html?id=…&purpose=webviewView`, 内层 `pre/fake.html?id=…`]。内层 fake.html 是 coder 的「内容替换」引导帧——webview 内容重建时该帧重新导航，产生空 URL 窗口。

### 两次挂死复盘

- 共同点：**首跑挂死 → kill → 重跑全部通过**。slash-goal-command：重跑产物 shots 12:58-13:11、ledger 5 项全 pass（F-01/R-01..03 由 driver，F-02 由已删除的 `/tmp/slash-goal-popup-probe.mjs` 自定义探针——不排除挂死发生在探针而非 driver，探针同样用 playwright 操作同页、同类无超时点暴露）。commit-card-jumps：重跑 13:41-13:48、ledger 4 项全 pass（重建镜像 13:37、容器 13:38 起）。
- **「无 stdout 输出」线索修正**：观测手段 `tail -25` 管道在进程未退出前不显示任何内容，该观测无法定位挂死点；且 driver 每项 banner 在 `newChatAndGetFrame` 前打印（L300），若挂死在首项 newChat 阶段 banner 已输出。故挂死点无法从日志碎片定位，只能按机制推断：最可能落在首个新会话的 `findFrame`/`waitForText` 全帧扫描。
- 挂死时容器是否冷启动：不可考（无挂死时容器日志）；「首跑挂死、重跑即过」+ 历史观察「容器刚起时 F-01 首跑失败重跑即过」同构，**推断**为冷启动窗口所致，非端口冲突（多实例端口独立，dockers ps 无重叠）。

### 修复方案（建议开发 session 认领；仅改 `test/sandbox/verify-driver.mjs`）

不是「一行零风险」——涉及 6 个调用点 + 2 个循环过滤器 + 1 个全局兜底，明确定义给开发 session：

1. **帧过滤器（一行核心，单独不够）**：所有帧扫描循环开头 `if (!f.url()) continue`（空 URL = 挂起导航帧，直接跳过；扫描循环自然续试，语义正确）。上游 issue 作者自称该 workaround「brittle」，建议与第 2 条并用。
2. **无超时调用竞速看门狗**（不能靠 evaluate 的 `{timeout}` 选项——实测被忽略；`count()`/`isVisible()` 无超时参数）：
   ```js
   /** 竞速看门狗：超过 ms 无回应即 throw（含诊断），不让进程无限等。 */
   async function bounded(p, label, ms = 10_000) {
     let t
     try {
       return await Promise.race([
         p,
         new Promise((_, rej) => {
           t = setTimeout(() => rej(new Error(`watchdog: ${label} >${ms / 1000}s 无回应`)), ms)
         }),
       ])
     } finally { clearTimeout(t) }
   }
   ```
   接入点：`findFrame` 的 `predicate(f)`、`waitForText` 的 `count()`、`approvePending` 的 `count()`/`isVisible()`、`waitForDraft` 的 `evaluate()`、`fillAndClickClear` 的 `evaluate()`、`popoverCommitCardVisible` 的 `count()`（worktree 版）。超时按现有结构转成该项 fail + notes 记录帧快照，不能裸 throw 出里层循环。
3. **全局兜底**：每项硬上限（建议 5min）看门狗，触发时转储 `page.frames()` 各帧 URL（含空标记）并判定 fail——保证「进程永不结束」不可能发生；转储是挂死类问题再现时的关键诊断。
4. **防复发（环境时序）**：
   - 预热：driver 首项前加「冒烟项」（新建会话 → 等 composer 出现 → Meta+W 关闭），让 dsh 完成启动，后续项不再有冷启动窗口；或 `run-sandbox.sh start` 后冒烟一次再交付 driver。
   - 低成本兜底：单项目 fail（尤其 expectText 超时）时整轮自动重试一次——与既有「重跑即过」观察一致。
   - 可选（根修环境侧）：mock 模式 entrypoint 预启动 dsh serve（命令取自插件 ServerManager），webview 打开即就绪；改动面大（镜像/entrypoint），列为可选。

### 遗留

- 会话层「delta 0」（session 无事件流动）是另一层现象，本轮未触及，保留为平行线索。
- 本调研未改动任何代码（`test/sandbox/` 未动）；探针/插桩副本在 `/tmp/dsh-hang-repro/` 可复用。

## 变更记录

- 2026-09-06 用户反馈「反复出现的问题都是咋回事（挂死）」→ 汇总 slash-goal/commit-card 两实例 + 会话层 delta 0 → 建条目（open/，调研任务）
- 2026-09-05 调研 session 完成：读码盘点等待点 → 最小实验复现挂死机制（Playwright 已知缺陷：挂起导航 iframe 上 evaluate/count 永不返回）→ 沙盒实例 hang-inv 复跑 10 轮未撞窗口（标注推断）→ 根因/修复/防复发写入本条目；未改代码，建议开发 session 认领修复（涉及 verify-driver.mjs 帧过滤 + 竞速看门狗 + 全局兜底，非一行修）。
- 2026-09-06 开发 session 认领修复（doing）：按「修复方案」1-4 仅改 test/sandbox/verify-driver.mjs（帧过滤 + 竞速看门狗 bounded + 每项 5min 全局兜底 + 冒烟预热/单轮重试），worktree = verify-driver-hang-fix
- 2026-09-06 开发完成（doing -> done，worktree verify-driver-hang-fix，done 标记 f1cb2a5）：仅改 test/sandbox/verify-driver.mjs——全部帧扫描循环跳过空 URL 帧；bounded() Promise.race 竞速看门狗（默认 10s，WatchdogError 带 label）接入 findFrame predicate / waitForText count / approvePending count+isVisible / waitForDraft evaluate / fillAndClickClear evaluate / popoverCommitCardVisible count / newChat 头部按钮 count，watchdog 超时由条目级 catch 转 fail + notes 帧快照诊断（不裸 throw 出扫描循环）；每项 5min 硬上限兜底；首项前冒烟预热 + fail 项整轮自动重试一次。验证：复现侧——假 workbench 确定性复现台上原版 3/3 挂死（>60s 无输出、unsettled TLA 停在 L320）、修后版 9.7s 完成；聊天帧挂起场景 fail-fast + 帧快照 + 自动重试后进程自行退出；bounded() 微测试 3/3；min-repro2 机制复确认吻合。正常路径——真实沙盒（独立实例 8095）跑 CI 基线 F-01/F-02/F-05 场景全 pass，截图语义核对通过。报告 test/sandbox/verify.verify-driver-hang-fix.report.html（7 项全 pass），npm test 554/554 无回归。待主线合入。

- 2026-09-05 合入（done -> closed）：修复 dev-merge 合入 main（verify-driver.mjs，帧过滤+竞速看门狗+5min 兜底+冒烟/重试），报告 7 项全过、人工审查通过；根因与修复方案见本条目正文，复现台 /tmp/verify-driver-fake/。
