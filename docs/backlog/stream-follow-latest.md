# 流式输出时视图跟随最新位置（scroll pinning）

记录于 2026-08-31。

## 背景与现象

对话流式输出期间，消息容器的内容不断增长，但视图不总是自动贴底跟随：有时停留在原处，需要手动滚动或点「↓ 回到最新」才能看到最新输出。期望行为（对齐官方 dsh web 与主流聊天 UI）：只要用户没有主动向上滚动，输出期间视图应始终贴在底部跟随；用户上翻查阅历史时保持不动（当前行为），回到底部附近后恢复跟随。

## 现状

`src/ui/chat/webview.ts` 已有贴底判断与「回到最新」按钮，核心在 `render()` 尾部与 `pinnedScrollTop` 一带：

- `stickToBottom`（webview.ts:56）默认 true；每次 `render()` 重建前比较旧容器的 `scrollTop` 与上次渲染后的 `pinnedScrollTop`（webview.ts:880 附近）——差值 >1px 视为用户主动滚动，按是否接近底部（<40px）重算 `stickToBottom`；内容增长本身造成的 scrollTop 变化依赖 `pinnedScrollTop` 回读来排除。
- 渲染末尾按 `stickToBottom` 决定贴底或恢复 `prevScrollTop`，并回读钳制值更新 `pinnedScrollTop`（webview.ts:1069-1073）。
- 「↓ 回到最新」按钮在不贴底时出现（webview.ts:1019-1023）。

疑似缺口（待核实复现路径）：

- 流式快照是整树重建，新旧 DOM 替换瞬间 scrollHeight 变化，比较窗口内 `oldMessages.scrollTop` 可能已受内容增长影响，把"内容长高"误判为"用户上滚"，从而提前关掉跟随；
- 图片/折叠块等异步内容（attachment 字节后到达、`<details>` 展开）改变高度时不经过 render() 的跟随路径。

## 建议方案

1. 在 messages 容器上直接监听 `scroll` 事件区分用户滚动（wheel/touch/键盘）与程序化高度变化，而不是靠 pinnedScrollTop 差值推断；
2. 贴底判断放宽为"距底 <40px 即跟随"，输出期间用 `requestAnimationFrame` 或在重建后统一 `scrollTop = scrollHeight`；
3. 异步内容（图片加载完成、details 展开）高度变化时，若 `stickToBottom` 为 true 也补一次贴底。

涉及文件：`src/ui/chat/webview.ts`（`stickToBottom`、`pinnedScrollTop`、render() 尾部、`.jump-latest` 按钮）。
