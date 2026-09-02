# 流式输出视口周期脉冲（脱底→吸回跳动）：程序 pin 的 scroll 事件自我回声锁

记录于 2026-09-02。已核实 + 已复现（headless Chrome + mock host 实验，证据见下）。

## 背景与现象

用户报告：对话窗流式输出时仍会跳动（此前 chat-scroll-pinning-drift / scroll-bottom-momentum-jitter 已修三轮，后者合入后留了"极端时序仍可能残留轻微跳动"的已知残留）；**在某条已展开的思考过程（reasoning 折叠块）可见时尤其明显**。用户判断"和触底以及输出字符之间的问题"，要求通用修法而非继续缝补。

## 根因（已复现确认）

**程序 pin 的 scroll 事件自我回声锁**——"滚动活动锁"（`scrollActiveRecently`，SETTLE_IDLE_MS=120ms）把**自己 pin 产生的 scroll 事件**也当成"滚动还没停"，周期性挡住后续补 pin：

1. 贴底跟随中，每个流式快照（真实推送 100ms/帧，`chatSession.ts` FLUSH_INTERVAL_MS=100）渲染后走 `queueMicrotask` 补 pin：`messages.scrollTop = messages.scrollHeight`（`webview.ts` render 尾）；
2. 写导致位置变化 → 浏览器异步派发 scroll 事件 → `noteScrollActivity()` 刷新 `lastScrollActivityAt` → **接下来 120ms 内 `scrollActiveRecently()` 恒为 true**；
3. 锁内的流式帧（约 1 帧/100ms）microtask 里 `shouldSettlePinNow(..., scrollActiveRecently=true)` 为 false → **补 pin 被跳过** → 视口脱底，脱底距离 = 该帧内容增长高度（实验实测 24px）；
4. 120ms 后 debounce 到期 `maybeSettlePin` 吸回（又写 scrollTop → 又触发 scroll 事件 → 又锁）→ **周期「脱底 → 吸回」脉冲**，即用户看到的"一跳一跳"。

**为什么"有可能"/非必现**：`AT_BOTTOM_PX=2` 阈值——内容增量不足一行高（不换行）时瞬态 `atBottom` 仍为 true，microtask 幂等不写、无 scroll 事件链，完全稳定；**内容增量跨行（文本换行、代码块、列表、流式 thinking 逐行输出）时每帧都触发脉冲**。

**为什么展开的 thinking 块尤其明显**：用户展开的是**正在流式输出的 reasoning 块**（思考过程逐行增长），展开态下每帧高度增量常驻可见，脉冲感被放大；且流式结果块内长文本 + `details` 每帧重建（重建后设 `open=true` 每帧各触发一次 toggle 事件，走 `repinIfFollowing→maybeSettlePin`，实测 20 帧 = 20 次 toggle）。

## 实验证据（2026-09-02，headless Chrome + CDP + mock host）

复现工具：`.dev-host/jitter-probe.html`（gitignored 的一次性 fixture：`window.acquireVsCodeApi` 最小桥 + `window.postMessage` 直推 ChatState），`/tmp/dsh-cdp-run.mjs`（CDP Runtime.evaluate 驱动 + rAF 采样），无头 Chrome `--headless=new --remote-debugging-port=9223`。

- **对照 A（简单内容，展开 1 个 reasoning，12 帧 × 100ms）**：dist 恒 0、帧间隔中位 17ms（60fps）——稳定，无脉冲。scroll 事件仅 3 次（内容行高不变时 microtask 不写）。
- **复现 B（复杂内容，20 对消息 + 长 reasoning + 代码块，2 个 reasoning 展开 + 1 个代码块展开，12 帧 × 100ms）**：t≈111ms 起出现 **dist=24 持续 2 帧（约 34ms）** → t≈145ms scroll 事件吸回；随后 scroll 事件流 st=7911→7935→7959→7983→8007→8031，呈"pin 写 → 锁 → 下一帧跳过（脱底）→ settle 吸回"的周期节奏。帧率本身正常（中位 17ms），**跳动是位置脉冲而非掉帧**。
- 事件计数佐证：展开的 details 每帧重建后触发一次 toggle（20 帧 = 20 次 toggle），toggle 走 `repinIfFollowing` 但视口已贴底时幂等不写。

## 修法方向（通用，非缝补）

**识别程序滚动的回声，不让它进"滚动活动锁"**：所有程序写 `messages.scrollTop` 的路径（render 尾 microtask、`maybeSettlePin`、`pinToLatest`、jump、换会话/加载更早的恢复与补偿写）写完记录 `programPinAt = performance.now()`；scroll 事件监听开头加守卫：**距上次程序写 ≤ SETTLE_IDLE_MS、无用户意图（`!userScrollIntentActive()`）、且 `|scrollTop - pinnedScrollTop| ≤ 1` 的事件判为程序回声，直接 return**（不 `noteScrollActivity()`、不 `reconcileScrollPinning`、不触发"回到最新"误显）。

- 用户手势路径不受影响：wheel / touch / keyboard / pointerdown 走 `onScrollGesture` 独立记账（不依赖 scroll 事件），用户滚动产生的 scroll 事件位置 ≠ pinnedScrollTop 且意图活跃 → 照常锁。（保住 momentum-jitter 迭代 3 的全部语义。）
- 不用动 AT_BOTTOM_PX / SETTLE_IDLE_MS / overscroll 防线 / microtask 语义——它们与本次根因正交。
- 可选增强（非必须）：microtask 补 pin 改 rAF——语义等价（都在 paint 前），不必动。

## 涉及代码位置

- `src/ui/chat/webview.ts`：scroll 监听（`noteScrollActivity` / `reconcileScrollPinning`，约 2086-2099）、render 尾 microtask 补 pin（2264-2274）、`maybeSettlePin`（199-207）、`pinToLatest`（216-222）、`repinIfFollowing`（2113-2132）、恢复/补偿写（2238-2241）
- `src/pure/scrollFollow.ts`：`scrollActiveRecently` / `SETTLE_IDLE_MS` / `AT_BOTTOM_PX` / `shouldSettlePinNow`
- 复现工具：`.dev-host/jitter-probe.html`（gitignored）、`/tmp/dsh-cdp-run.mjs`

## 待确认 / 修复后人工验收项

- 真实 VS Code webview（真实 dsh 推送节奏 + 真实内容含图片/附件异步高度）下复现脉冲；修完后该场景不应再出现脱底帧。
- 修法对 momentum-jitter（触控板惯性回弹）场景无回归：用户滚动的 wheel 流照样锁住程序写。

## 变更记录

- 2026-09-02 记录问题；headless Chrome + mock host 实测确认根因（程序 pin 自我回声锁 → 脱底-吸回周期脉冲）；写修法方向 → open
