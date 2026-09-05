# composer 长文本滚动窗口跟随光标（输入路径滚动同步不依赖 scroll 事件时序）

## 背景与现象

长文本输入（超过 `#input` max-height 160px，textarea 内部滚动）时要求：可见文本窗口始终跟着输入光标（光标到哪，显示的文本到哪）。用户报告输入过长内容时输入框没有跟随输入光标。

## 现状（已核实）

`composer-long-text-overflow` 修复后的同步机制：`.ref-token-layer` 盒子锚定在输入框不动，`.ref-token-scroll` 内容层按 `translateY(-input.scrollTop)` 平移，裁剪窗口与 textarea 滚动窗口对齐。用 Playwright CDP 真实逐字按键在 harness 复测：触发了 14 次 scroll 事件，最终 `transform == -scrollTop`，窗口与光标位置一致——**Chromium 下机制本身是对的**。

## 根因（代码级：事件时序依赖）

同步有两个写入点：`input` 事件（renderRefLayer）和 `scroll` 事件（监听器）。问题在 `input` 事件里读到的 `input.scrollTop` 是**浏览器对该次输入做「光标滚入视野」之前**的陈旧值——浏览器在 input 事件之后才滚动光标。窗口要跟上，客观上依赖 `scroll` 事件在同一帧内补上。如果目标环境不派发/延迟派发 textarea 的 scroll 事件（不同 Chromium/Embedded webview/部分 IME 提交路径存在行为差异），窗口就停在滚动前的位置：光标继续往下走而显示文本不动——正是「输入框没有跟着输入光标」。

IME 提交路径同样命中：compositionend 恢复层时读取的 scrollTop 也是提交滚动前的值，等 scroll 事件兜底。

任何情况下都不该把「显示窗口跟光标」的正确性押在 scroll 事件是否派发上。

## 建议方案

在 `input`（含 IME composition 期间/结束）路径加 rAF 兜底：`requestAnimationFrame(() => refContent.style.transform = translateY(-input.scrollTop))`——一帧（浏览器完成光标滚入视野并布局后、绘制前）里重读最终 scrollTop，重赋 transform。scroll 监听保留（滚轮/滚动条路径），input 事件里已有的即时同步保留（无滚动时窗口不变，多数情况首个同步即正确）。改动点：

- `src/ui/chat/webview.ts`：input 监听（L6999）与 compositionend（L6993）后追加 rAF 重同步；用 `input.isConnected` 守卫（render 重建路径）。
- 不必改 CSS（裁剪窗口与 textarea 滚动端口均为 padding box，几何一致；此前怀疑的 6px 错位不成立，实测对齐）。

## 验证建议

- harness 真实逐字按键（Playwright pressSequentially）前后：滚动序列中每帧检查 `transform == -scrollTop`（含每键后一帧），断言无滞后帧。
- 场景：复用 new-feature 加进基线（composer-long-scrolled）或扩展该场景 assert。

## 涉及代码位置

- `src/ui/chat/webview.ts` L6693-6716（renderRefLayer）、L6750-6752（scroll 监听）、L6985-7007（compositionstart/end、input 监听）

## 变更记录

- 2026-09-05 主线代码研究 + harness 真实按键复测后定位（事件时序依赖），待修复，先记录 → open

- 2026-09-05 认领（worktree: agent/composer-caret-follow-sync）→ doing
