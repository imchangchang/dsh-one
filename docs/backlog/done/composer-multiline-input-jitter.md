# composer 多行输入时聊天对话框上下跳动

## 背景与现象

用户报告（2026-09-05，会话直报）：在对话里，输入框输入超过一行（autoGrow 自动增高）后，每次输入时整个聊天对话框上下跳动。用户确认复现场景：**有消息的对话、助手流式输出中**。

## 根因（已核实：浏览器 fixture 实测 + 代码路径推演）

输入框 `#input` 由 `autoGrow`（webview.ts 尾部）随内容增高（每行 +24px，封顶 160px）。`autoGrow` 的 input 事件调用点**不经 render**——增高即时压缩 `.messages`（flex:1）的 clientHeight Δ，但 `scrollTop` 不变 → **贴底视口被顶出 Δ**（底部最新内容被挤出视口，jump 按钮因 stickToBottom 仍 true 而不显示）；此过程**无 clamp、无 scroll 事件、无任何滚动代码运行**（实测确认 Chromium 下 clientHeight 变化引起的 clamp/脱底都不派发 scroll 事件）。

下一次宿主推帧（流式 ~200ms/帧；store tick/jobs/subagents 也对每个 tab 重推 state）触发 `render()` 尾：microtask 钉底 `scrollTop = scrollHeight`（shouldSettlePinNow 四门全过：跟随 + 无意图 + 未贴底 + 无滚动活动）→ 拽回 Δ。

「顶出（input 事件当帧 paint）↔ 拽回（下一推帧 microtask）」跨帧交替 = 上下跳动，幅度 = 每行增高量。空闲时无后续帧则静默脱底（无 jump 提示）直到碰巧来一帧。

实验证据（真实 chat STYLE fixture，无 harness 样式拼接干扰；`#messages` 贴底态）：

| 步骤 | scrollTop | clientH | 距底 | input 高 |
|---|---|---|---|---|
| 贴底基线 | 2501 | 835 | 0 | 35 |
| 聚焦输入 3 行 | 2501（不变） | 790（-45） | **45**（被顶出） | 80 |
| 推一帧相同 state | **2546** | 790 | **0**（拽回） | 80 |

## 调查结论（4 路并行分析，2026-09-05；全文当时存 /tmp/dsh-scroll-audit-*.md）

**结构性根源**：跟随态存的是「推断布尔 + 像素 scrollTop」，而非「dist=0」几何不变量；**clientHeight 变化类扰动（V 算子）没有任何观测机制**——不产生 scroll 事件、不伴随 render 时，只能等下一推帧拽回。bug#4 只是这个洞的第一条。同族未修扰动源：

- todo-panel / queue-dock **手动开合**（纯本地交互，最高 180px 顶出，无 render 无补偿）
- **窗口/面板 resize**（零监听；跟随时静默脱底且无 jump 提示）
- **chatFontSize 运行时改字号**（只改 CSS 变量不 render；容器尺寸不变但内容重排——这条 RO observe 容器也捕不到，需在 chatFontSize 消息处理器里补）

**历史 3 bug 审计**：drift / self-lock 确认无残留；momentum 手势期无写路径。收缩侧（composer 删行变矮 → clientH↑ → clamp）经极简对照实验裁决：**clamp 静默发生、不派发 scroll 事件**——「clamp 误判滚动活动 → 单脉冲」链条不成立。

**官方 dsh web 参考**（本机安装 0.1.2-rc.1，聊天滚动在未压缩的 `dsh-client-ui-chat/lib/client.js` + `dsh-client-ui-conversation/lib/client.js`，~250 行自研、无第三方滚动库）：

- 跟随双通道：结构变化（followSig 签名比对，useLayoutEffect）+ **尺寸变化用 ResizeObserver 同时 observe 内容列与 composer seat**，统一 `if (atBottomRef) scrollTop = scrollHeight`（瞬时写、无节流、无 smooth）；
- atBottom 双轨（ref 供逻辑 / state 仅供按钮显隐，25px 阈值）；程序/用户滚动消歧 = 写后记 observedTop，500ms 采样 + scrollend；
- 布局治本：composer 是滚动容器末尾 sticky-bottom 流内元素（增高顶起内容而非压缩消息区），dock 家族（todo/queue/goal）都在 composer seat 内——V 扰动在布局层消除。此布局重构另立条目 `composer-sticky-in-scroller-layout`。

**几何模型结论**（dist = H−T−C）：dist 数值无法反推扰动来源（用户上滚 24px = composer 顶出 24px = 底部增长 24px），跟随态必须持久化、不能每帧几何重算。ResizeObserver 是唯一打在 V 算子上的浏览器原语，且回调在 layout 后 paint 前派发——补偿与扰动同帧，**顶出帧根本不被绘制**，比「拽回」严格更强；未来新增任何改 clientHeight 的 UI 自动入覆盖。

## 方案（用户拍板 2026-09-05）

**B+F2 结构修复**：

1. **RO 统一补偿**：`.messages` 挂 ResizeObserver（容器创建时挂、元素跨帧存活）。回调：clientHeight 变化且跟随态且无滚动手势/活动时，立即钉底（写 `scrollHeight`，同帧 pre-paint）；手势在飞转既有 settle debounce；非跟随不写（纯 V 下阅读位置像素级不动本就正确）。
2. **F2 单一写路径收口**：8 处 scrollTop 写点收口为统一原语（读回 pinnedScrollTop + markProgramPin 簿记 + 可选门控）——RO 的写经此路径自动登记，结构上不可能重引 self-lock 回声锁。
3. **字号特例**：chatFontSize 消息处理器里跟随态补一次钉底（字号变化改 scrollHeight 不改容器尺寸，RO observe 容器捕不到）。
4. 历史 3 补丁（AT_BOTTOM_PX 精确贴底 / 意图+活动门控 / 回声剔除）全部保留复用。

明确不修（另列 backlog 或接受）：hero 空态居中重排（backlog 未定项）；非跟随态视口上方内容变化的漂移；宽度重排锚点漂移；方案 2 布局重构（`composer-sticky-in-scroller-layout`）。

## 涉及代码位置

- `src/ui/chat/webview.ts`：autoGrow（尾）、render 尾部滚动恢复与钉底、messages 监听创建点（scroll/pin/settle 挂点）、chatFontSize 消息处理器
- `src/pure/scrollFollow.ts`：AT_BOTTOM_PX / isAtBottom / shouldSettlePinNow / isProgramScrollEcho
- `src/ui/chatViewHtml.ts`：`.messages` 样式（199-214）

## 变更记录

- 2026-09-05 用户会话直报，主线排查（真实 chat STYLE fixture + 手动驱动 mock）确认根因 → open
- 2026-09-05 4 路并行子代理深析（现状盘点/几何建模/官方逆向/历史残留审计）收敛于 B+F2；用户拍板方案 1（机制层彻底），方案 2 布局重构另立条目 → 认领 → doing
- 2026-09-05 开发完成（worktree: agent/composer-multiline-input-jitter，commit f6f8f83）：RO 统一补偿 + 写路径收口（writeMessagesScrollTop）+ 字号特例 rAF settle。自测：typecheck/554 单测/build 全绿；headless Chrome CDP 几何断言与截图验证（顶出瞬态同帧修回、收缩侧贴底保持、非跟随阅读位不动、流式 dist 恒 0、dock 开合补偿）；harness 基线 35 场景无回归。测试报告 test/sandbox/verify.composer-multiline-input-jitter.report.html → done
