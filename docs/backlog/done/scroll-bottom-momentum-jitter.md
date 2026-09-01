# 贴底后触控板惯性下滑：视图反复回弹抖动（非必现）

记录于 2026-09-01。用户报告（合入 chat-scroll-pinning-drift 后测试中发现的场景）。已核实代码路径；机制为推演，碰撞复现依赖真实触控板弹性动画，需人工环境确认。

## 背景与现象

macOS 触控板：会话已经在底部（贴底跟随中），再向下惯性甩动（momentum 翻滚）——浏览器原生弹性回弹（rubber band）期间视图**反复回弹抖动好几次才稳定**，而不是平滑的单次回弹或直接 clamp 住。现象**非必现**（用户确认）：有时回弹一次就停，有时抖多次。**关键补充（用户确认）：只在流式输出期间发生；输出完成后同样甩动不再抖**——与「写 scrollTop 的窗口 = 渲染推送窗口」一致，直接印证碰撞机制。

## 根因（代码路径已核实；碰撞机制为推演，获浏览器层面佐证）

抖动来自**跟随态下的程序滚动与浏览器原生弹性动画抢位置**：

1. `.messages` 是页面唯一滚动容器（布局链 `html/body height:100%` → `#app height:100%` → `.chat-col` flex 列 → `.messages { flex:1; overflow-y:auto }`，整页不会滚动），且 **CSS 没有设 `overscroll-behavior`**（默认 `auto`）——macOS 上触控板滚到底后继续下滑，弹性回弹动画就作用在 `.messages` 上。
2. 跟随态（`stickToBottom === true`）下，以下路径会**程序写** `messages.scrollTop = messages.scrollHeight`。弹性动画进行中写入会打断/重置原生回弹动画，剩余动量继续驱动滚动 → 再次回弹 → 再被打断……直到动量衰减，视觉上就是「回弹好几次才稳定」：
   - `webview.ts` render 尾：`if (stickToBottom) messages.scrollTop = messages.scrollHeight`（:1858）——**每个 snapshot 帧必写**，流式输出/事件推送频繁时碰撞概率高。
   - `repinIfFollowing()`（:1733-1737）：图片 `load`（捕获监听, :1741）/ `<details>` `toggle`（:1748）——**跟随态下每张图片加载完成都会写**，图片多的会话碰撞概率高。
   - `pinToLatest()`（:139-145）：发送消息等（:2796、:3035）。
   - jump「回到最新」点击（:1791）。
3. **非必现的解释**：动量窗口（约 1s）内恰好有上述某条写落地才抢；会话空闲、无流式推送、无图片加载时没有任何写，就是单次原生回弹（用户看到的正常情况）。

⚠️ **与 chat-scroll-pinning-drift 合并的关系**：对比合入前后 diff（`1b4d5ca`），上面 4 条写路径在合入前就存在，本次合入只改了判定阈值（40px→2px）与存档/单向修正语义。**抖动机制不是本次合入引入的回归**，是既有缺陷（用户此前未专门甩过触控板惯性到边，或触发概率低）。记录时按用户新发现问题处理。

## 方案候选（按业界规范做法，2026-09-01 网上调研后重写）

这类问题业界有成熟解法，分**两层防线**（对应问题两类根因：惯性中断 + 瞬态高度竞态）：

1. **防线层（CSS，一行，Chrome 官方推荐姿势）**：`.messages { overscroll-behavior-y: none; }`——官方博客（"掌控滚动操作"）的聊天容器标准样例就是给 `overflow:auto` 容器设 `overscroll-behavior`（示例用 `contain` 断滚动链）。`none` = 断链 + **禁掉容器自身的橡皮筋/回弹**；`contain` = 断链但保留回弹——回弹还在就会继续和程序写打架，**对本 bug 无效**。副作用：失去 macOS 原生弹性手感（用户本来就嫌抖动，可接受；非 macOS 无行为差异）。若实测弹性作用在文档根而非 `.messages`，则设 `html, body`。
2. **行为层（JS，不抢不打架）——推荐与 1 同做**：
   - **「用户滚动优先」意图门控**：用户手势/动量未结束（wheel/touch 事件仍在持续到达——动量期间浏览器持续发 wheel 事件，这是可靠的动量信号）时**不写** scrollTop，等滚动 settle 后补 pin。StayDown（chat 贴底标准库：lock/release 意图模型）、TheLounge scroll-pin pattern 都是这套。要回避的行为是「设 scrollTop 会停掉惯性动画」——浏览器层面已承认这是缺陷（WebKit bug 255193：set scrollTop 会终止 scroll inertia，建议的实现方向就是「重新计算并恢复动画」，JS 侧只能躲开）。
   - **microtask 重锚定（写 settle 值）**：render 里不要在同步栈内读 `scrollHeight` 写 `scrollTop`——栈内读到的是瞬态高度（布局批量），写成最底会 clamp 到瞬态 max，下一帧内容 settle 后视口悬空，单帧回弹。规范修法：render 尾改 `queueMicrotask` 中读 settle 后的 max 再写（只对「贴底跟随且悬空」的 follower 写，写程序滚动锁防 listen 误判，幂等）。hermes-webui 同款问题 PR #5685 实测该写法把 82px 单帧抖动降到 0；**我们 render 尾 `textContent=''` + 重追加的结构与它同构，当前代码就有此隐患**（暂未观测到对应症状，与惯性抖动叠加）。
   - 之前条目里「检测 scrollTop 超底（回弹中）就跳过写」的变体**放弃**：Chromium 弹性期间内部容器 scrollTop 是否报超底值实现相关、不可靠；以 wheel 事件流判「用户滚动活跃」是业界标准信号（old 方案 2 改为上述意图门控）。

注：旧方案 ① 对应防线层；通过对照验证方案 ② 是否确实需要（先上 `none` 看用户能否接受手感，不行再上行为层）。认领后建议：CSS `none` + 意图门控一起做（一行 + 小改），microtask 重锚定作为附带修复。

## 涉及代码位置

- `src/ui/chatView.ts` STYLE：`.messages`（:196，`overflow-y: auto`，无 `overscroll-behavior`）；如需设 `html/body`（:87-88）
- `src/ui/chat/webview.ts`：render 尾 pin（:1858）、`repinIfFollowing`（:1733-1737、:1741、:1748）、`pinToLatest`（:139-145）、jump click（:1791）

## 待确认

- 弹性回弹作用在 `.messages` 还是文档根（决定防线层 CSS 目标）。
- 碰撞机制是否成立：人工环境去掉 write 路径对照复现频率（或加 `overscroll-behavior-y: none` 对照）。
- 是否顺带影响 Linux/Windows（意图门控与 microtask 重锚定跨平台无副作用；`none` 在非 macOS 无行为差异）。

## 外部参照（调研 2026-09-01）

- Chrome 官方博客「掌控滚动操作」：overscroll-behavior 的 auto/contain/none 语义与聊天容器标准用法：https://developer.chrome.com/blog/overscroll-behavior?hl=zh-cn
- WebKit bug 255193：设 scrollTop 会停止 scroll inertia 动画（方案建议方向：不停止或重算恢复）——我们的机制推演：https://wiki.webkit.org/show_bug.cgi?id=255193
- hermes-webui PR #5685（同问题类：pinned tail-follower 流式中抖动；修法 = microtask 重锚定 + 写 settle max + 程序滚动锁）：https://github.com/nesquena/hermes-webui/pull/5685
- StayDown（chat 贴底标准库：lock/release 意图模型、stickyHeight 阈值、图片加载后复查）：https://www.npmjs.com/package/staydown
- TheLounge scroll-pin pattern（被 repartee 1.6.0 采用的贴底模式）：https://docs.rs/crate/repartee/1.6.0

## 变更记录

- 2026-09-01 记录问题，核实代码路径（写路径 4 处、合入前后对比）→ open
- 2026-09-01 网上调研，方案候选按规范做法重写（防线层 CSS + 行为层意图门控 + microtask 重锚定）
- 2026-09-01 用户确认：仅流式输出期间抖动；输出完成后不抖（坐实「写帧窗口 = 渲染推送窗口」）
- 2026-09-01 认领（worktree: agent/scroll-bottom-momentum-jitter）→ doing
- 2026-09-01 完成开发（worktree: agent/scroll-bottom-momentum-jitter）：防线层 `.messages { overscroll-behavior-y: none }`（判定弹性作用在 `.messages`——页面唯一滚动容器，`html/body/#app` 均 `height:100%` 且不设 `overflow`，不参与滚动链）+ 行为层意图门控（render 滚底与 `repinIfFollowing` 在 `userScrollIntentActive` 时跳过，不抢原生惯性动画）+ render 滚底改 microtask 重锚定写 settle 值（`shouldPinNow` 纯函数）；自测 typecheck / test(209) / build 全绿，baseline 15 场景 + 流式推送×意图窗口动态检查通过；惯性碰撞机制本身需真实触控板人工确认 → done
- 2026-09-01 迭代 2（人工验收反馈后补）：① 根层回弹——`.messages` 的 `none` 盖不住 webview 根文档（html/body 页面级）回弹，`overscroll-behavior-y: none` 补到 `html, body`（`.messages` 上保留）；② settle 恢复 pin——动量末尾视口脱底 + 流式无后续 render 时悬空，`noteUserScrollIntent` 加意图过期后一次性定时器 + scroll 监听加同步 settle-restore（都用 `shouldPinNow`），兜住「输出刚好在动量结束时停止」的恢复空洞；自测全绿，动态检查（意图窗口内 microtask 跳过 + settle 定时器恢复回底）通过 → done
