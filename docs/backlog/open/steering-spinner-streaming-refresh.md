# 插队圆环等旋转指示器在流式期间偶发「不流畅/刷新」

记录于 2026-09-06。用户反馈：对话流式输出时，插队消息左侧的旋转圆环在某些情况下不停地「刷新」，不是流畅旋转的状态。

## 核实过程（探针实测，2026-09-06）

在当前主线构建（cf8e1c9）上用 Playwright 探针实测，**未能复现**纯流式场景下的闪烁：

- `probe-steer-spin.mjs`：steering-pending 场景推 20 帧流式文本——圆环元素保活（`sameEl=true`），动画相位连续。
- `probe-steer-real.mjs`：长会话（10 轮消息）+ todos + 插队气泡挂尾，30 帧流式（每 10 帧穿插一次 todo 真更新）——零重建、零相位重置。
- `probe-raf-jank.mjs`：重负载流式（大段 markdown：代码块+列表+链接，40 帧）——rAF 间隔 p99 ≈ 10ms，主线程余量充足，无掉帧。
- `probe-move.mjs`：验证 reconcileFlow 的 `insertBefore` 位置修正**不会**重启 CSS 动画（移动后相位连续）。

插队圆环有双保险：行级签名保活（`flowSteerSigs`，内容没变不重建）+ 创建时相位续播（负 `animation-delay`，见 `renderSteeringItem`）。

## 与 composer 输入抖动的关系

**同族不同根**，都属于「手写 DOM 渲染」的边角问题（见 `webview-framework-eval.md` 三层模型）：

- composer 抖动 = 布局层（第 1 层）：兄弟元素高度变化 1:1 传导压缩滚动容器 clientHeight，clamp→补偿震荡。已由 composer-sticky-in-scroller-layout 结构性修复。
- 圆环刷新 = 渲染对账层（第 3 层）：DOM 元素重建 → CSS 动画重启。之前已修过两轮（todo-in-progress-spinner-flicker 已 closed；插话圆圈相位续播 81d9c00 已合入）。

## 候选漏网路径（待复现确认）

以下情况旋转指示器**仍会**从 0° 重启，可能是用户看到的「某些情况」：

1. **todo 弧环无相位续播**：`todoStatusGlyph`（webview.ts:4488-4492）只加了 `todo-progress-spin` class，没调 `syncAnimPhase`。todo 面板靠签名保活，内容**真变**时整面板重建、弧环从 0° 重启。如果 agent 在流式期间频繁更新 todo（勾掉一项、改文案），弧环会反复重启。
2. queue 快照内容真变化（插队消息被领取落地、用户编辑排队消息）——一次性合理重建。
3. 整页重建帧（切会话 / hero ↔ 普通布局切换 / loading 落地）——一次性，且伴随更大视觉变化。
4. 其他未覆盖的重建路径（需要具体复现场景定位）。

## 建议

- 拿到具体复现场景（当时在做什么、屏幕上有哪些面板）后按探针套路（元素身份 + `getAnimations()[0].currentTime` 相位追踪）定位是哪条路径。
- 若确认是路径 1：给 `todoStatusGlyph` 的 in_progress 弧环补 `syncAnimPhase(svg, 1000)`（`todo-progress-spin` 周期 1s），与全站其他旋转指示器对齐。

## 涉及代码位置

- `src/ui/chat/webview.ts`（`todoStatusGlyph` 4488-4492 / `syncAnimPhase` 677 / `renderSteeringItem` 4039-4040 / `reconcileFlow`）
- `src/ui/chatViewHtml.ts`（`.todo-progress-spin` / `@keyframes todo-progress-spin`）

- 2026-09-06 记录（探针核实：主线纯流式场景未复现，候选路径待复现确认）→ open
