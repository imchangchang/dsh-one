# 滚动贴底跟随判定漂移：流式抖动 / 「回到最新」误显 / 切回位置错

记录于 2026-09-01。已核实 + 已定位根因（主线用视觉测试 + mock 驱动复现，证据见下）。

## 背景与现象

用户报告两个现象（怀疑同源，已证实）：

1. **流式输出时对话轻微抖动**：会话在最新位置、输出期间，视口有很小幅度的跳动/被拽回。
2. **切走再切回后位置不对**：对话在最底部时切到其他会话再回来，位置不再是最新；且**有时看着位置已经是最新（贴底），左下角仍显示「↓ 回到最新」**。

## 根因（已核实）

`stickToBottom`（webview 贴底跟随态，`src/ui/chat/webview.ts`）由弱启发式维护，会与视口实际位置脱节：

1. **40px 容差忽略用户轻滚（→ 抖动）**。判定用 `isNearBottom`（距底 < 40px）：用户滚离底部 20px 时，scroll 事件重估仍判定「贴底」，`stickToBottom` 保持 true，**jump 按钮也不显示**（用户无提示）。下一次流式渲染走到 `stickToBottom ? messages.scrollTop = messages.scrollHeight`，把视图从「离底 20px」拽回绝对底部——每一帧内容的输出都抵消用户的小幅滚动，视觉上就是轻微抖动/被拽走。
   - 实验证据（mock 驱动流式 6 帧）：滚离 20px 后下一帧 `dist 20 → 0`；滚离 60px（>40）则位置稳定（`scrollTop` 固定 2267，dist 随内容增长变大，正确停止跟随）。
2. **非手势滚动不重估（→ 「回到最新」误显）**。scroll 监听里只有 `userScrollIntentActive()`（wheel/touch/键盘后 200ms 内、或 pointerdown 期间）才重估 `stickToBottom`（webview.ts:1618-1626）。scrollTop 因内容收缩/恢复被浏览器 clamp、或用户滚到边界时，产生的 scroll 事件/无事件都**不会**把跟随态同步到「实际已贴底」——`stickToBottom` 残留 false。
   - 实验证据：滚离 60px（false，jump 显示）后将 `scrollTop` 直接设为 max（视口贴底 dist=1），**jump 仍显示**；随后补发一次意图窗口内的 scroll 事件才恢复隐藏。
3. **切换会话存档/恢复沿用同一套判定（→ 切回位置错）**。切换靠 `scrollPositions` 存档（`src/pure/scrollFollow.ts` 的 `ScrollArchive`，atBottom 用同一 40px 容差），恢复用**绝对 scrollTop**。切走时被误判/残留的 atBottom=false 状态在切回时原样恢复；若切走期间内容变长，视口停在旧绝对位置（相对新内容 dist 变大，用户看到「不是最新位置」）；若内容收缩，恢复的 scrollTop 被浏览器 clamp 到新底部——**视口贴底但跟随态 false，jump 误显**。
   - 实验证据：A（12 对长消息）滚离 89px → 切走 → 切回时内容缩为 8 对 → `dist=1`（贴底）但 jump 显示；A 运行中切走 → 后台内容变长 → 切回后 `dist=1411`、jump 显示（视口停在旧位置）。

三个现象共享同一语义缺陷：**「是否贴底」是持久状态，只在用户手势时机采样（40px 容差 + 200ms 意图窗口），之后内容变化/程序滚动/clamp 让它与实际位置失联，而渲染与恢复逻辑把它当精确状态用**。

## 方案（方向，待认领后细化验证）

1. 用户手势滚动时用**精确贴底距离**而非 40px 容差：距底 > 2-4px 即停跟随 + 显示 jump；距底 ≈ 0 才跟随。（修抖动 + 轻滚无提示）
2. scroll 事件重估分两类：手势窗口内双向调整；**非手势 scroll 事件（clamp/内容变化/程序滚动）只做单向修正**——实测距底 ≈ 0 且跟随态为 false 时置 true（修 jump 误显），不主动置 false 防程序滚动误判。
3. 切换存档的 atBottom 判定改为「离开时是否跟随中」（而非重测 40px 距离）；恢复后按实际 clamp 结果同步一次跟随态（修切回位置错）。
4. 渲染尾设置 scrollTop 后读取 clamp 后的实际值，用它同步 jump 显示（UI 显示永远与实际位置一致）。

⚠️ 未验证项：真实宿主推帧节奏（节流）下第 2 类的触发频率、图片加载/details 展开等异步高度变化路径。认领后建议先在 mock（`test/ui/interactive.html`）上把这些路径补测。

## 涉及代码位置

- `src/ui/chat/webview.ts`：`stickToBottom`/`pinnedScrollTop`/`scrollIntentUntil` 维护（92-144）、render 滚动重估与存档（1356-1384、1618-1657、1691-1700、1764-1775）
- `src/pure/scrollFollow.ts`：`NEAR_BOTTOM_PX`、`isNearBottom`、`ScrollArchive`、`restoreScrollTarget`
- 复现工具：`test/ui/interactive.html`（mock host，可直接 `window.postMessage` 推 state）

- 2026-09-01 认领（worktree: agent/chat-scroll-pinning-drift）→ doing
- 2026-09-01 开发完成，自测通过（typecheck + 205 tests + build），DOM mock 验证三个症状（流式抖动/回到最新误显/切回位置错）均已修复 → done
