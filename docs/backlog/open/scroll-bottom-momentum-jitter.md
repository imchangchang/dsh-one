# 贴底后触控板惯性下滑：视图反复回弹抖动（非必现）

记录于 2026-09-01。用户报告（合入 chat-scroll-pinning-drift 后测试中发现的场景）。已核实代码路径；机制为推演，碰撞复现依赖真实触控板弹性动画，需人工环境确认。

## 背景与现象

macOS 触控板：会话已经在底部（贴底跟随中），再向下惯性甩动（momentum 翻滚）——浏览器原生弹性回弹（rubber band）期间视图**反复回弹抖动好几次才稳定**，而不是平滑的单次回弹或直接 clamp 住。现象**非必现**（用户确认）：有时回弹一次就停，有时抖多次。

## 根因（代码路径已核实；碰撞机制为推演）

抖动来自**跟随态下的程序滚动与浏览器原生弹性动画抢位置**：

1. `.messages` 是页面唯一滚动容器（布局链 `html/body height:100%` → `#app height:100%` → `.chat-col` flex 列 → `.messages { flex:1; overflow-y:auto }`，整页不会滚动），且 **CSS 没有设 `overscroll-behavior`**（默认 `auto`）——macOS 上触控板滚到底后继续下滑，弹性回弹动画就作用在 `.messages` 上。
2. 跟随态（`stickToBottom === true`）下，以下路径会**程序写** `messages.scrollTop = messages.scrollHeight`。弹性动画进行中写入会打断/重置原生回弹动画，剩余动量继续驱动滚动 → 再次回弹 → 再被打断……直到动量衰减，视觉上就是「回弹好几次才稳定」：
   - `webview.ts` render 尾：`if (stickToBottom) messages.scrollTop = messages.scrollHeight`（:1858）——**每个 snapshot 帧必写**，流式输出/事件推送频繁时碰撞概率高。
   - `repinIfFollowing()`（:1733-1737）：图片 `load`（捕获监听, :1741）/ `<details>` `toggle`（:1748）——**跟随态下每张图片加载完成都会写**，图片多的会话碰撞概率高。
   - `pinToLatest()`（:139-145）：发送消息等（:2796、:3035）。
   - jump「回到最新」点击（:1791）。
3. **非必现的解释**：动量窗口（约 1s）内恰好有上述某条写落地才抢；会话空闲、无流式推送、无图片加载时没有任何写，就是单次原生回弹（用户看到的正常情况）。

⚠️ **与 chat-scroll-pinning-drift 合并的关系**：对比合入前后 diff（`1b4d5ca`），上面 4 条写路径在合入前就存在，本次合入只改了判定阈值（40px→2px）与存档/单向修正语义。**抖动机制不是本次合入引入的回归**，是既有缺陷（用户此前未专门甩过触控板惯性到边，或触发概率低）。记录时按用户新发现问题处理。

## 方案候选（待认领后对比验证）

1. **禁用弹性回弹（最简）**：`.messages`（必要时 `html/body`）加 `overscroll-behavior-y: none`。贴底后再惯性下滑直接 clamp，无回弹无抖动。副作用：失去 macOS 原生弹性手感——用户本来就把它当 bug，预计可接受；需确认弹性确实作用在 `.messages` 而非文档根（若在文档根则设 `html, body`）。
2. **不与弹性动画抢（保留手感）**：写 `scrollTop` 前先判「是否正在回弹（`scrollTop > scrollHeight - clientHeight`，即超底部未被 clamp）」：正在回弹则跳过本轮 pin/repin，延后到滚动稳定再补一次。修掉碰撞但不牺牲原生回弹。实现注意：跳过的帧要记 pending pin，否则后续无写入时内容增长会漂。
3. 对照验证建议（人工 dev-ui-test，真实触控板）：主题 A 原版、B 方案 1、C 方案 2 各甩 10 次对比抖动频率；同时流式+图片会话下复测一次，确认方案不会让「跟贴」退回旧的抖动/漂移问题。

## 涉及代码位置

- `src/ui/chatView.ts` STYLE：`.messages`（:196，`overflow-y: auto`，无 `overscroll-behavior`）；如需设 `html/body`（:87-88）
- `src/ui/chat/webview.ts`：render 尾 pin（:1858）、`repinIfFollowing`（:1733-1737、:1741、:1748）、`pinToLatest`（:139-145）、jump click（:1791）

## 待确认

- 弹性回弹作用在 `.messages` 还是文档根（决定方案 1 的 CSS 目标）。
- 碰撞机制是否成立：人工环境去掉 write 路径对照复现频率（或加 `overscroll-behavior-y: none` 对照）。
- 是否顺带影响 Linux/Windows（方案 2 判断路径跨平台无副作用；方案 1 在非 macOS 无行为差异）。

## 变更记录

- 2026-09-01 记录问题，核实代码路径（写路径 4 处、合入前后对比）→ open
