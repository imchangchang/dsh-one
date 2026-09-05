# composer 多行输入时聊天对话框上下跳动

## 背景与现象

用户报告（2026-09-XX，会话直报）：在对话里，输入框输入超过一行（自动增高）后，每次输入时整个聊天对话框上下跳动。

## 根因（已核实，浏览器 mock + 精确宿主帧模拟复现）

输入框 `#input` 由 `autoGrow`（`src/ui/chat/webview.ts:6997`）随内容增高（每行 +24px，封顶 160px）。增高即时压缩 `.messages`（flex:1）的 clientHeight，但 `scrollTop`（绝对像素值）不变——**贴底跟随态下视口距底 dist 从 0 变成 Δ**（底部最新内容被顶出视口，且 jump 按钮因 stickToBottom 仍为 true 而不显示）。

随后任一次宿主推帧（流式输出帧 / sessionsStore 相对时间 tick / jobs / subagents 变更 → `chatView.ts` 对每个附着 tab 重推 state）触发 `render()`：
- render 尾把 `scrollTop` 写回 `prevScrollTop`（保持被顶出处）；
- `stickToBottom` 仍为 true 时 microtask 钉底 `m.scrollTop = m.scrollHeight`（`shouldSettlePinNow`：dist>AT_BOTTOM_PX=2 → 钉）→ clamp 回底部。

「输入增高顶出 Δ」与「推帧拽回 Δ」交替 → 视觉上每次跨行/每帧渲染消息区上下跳一次（幅度 = 输入框增高量，24px/行）。对话不处于贴底态（用户翻过历史）时无此跳动（stickToBottom=false，render 尾不钉）。

用户确认复现场景：**有消息的对话、助手在输出中（流式推帧）**。

实验证据（真实 chat STYLE fixture，`.dev-host/jitter/manual.html`，无 harness 拼接样式干扰；`#messages` 为滚动容器、贴底态）：

| 步骤 | scrollTop | clientH | dist（距底） | input 高 |
|---|---|---|---|---|
| 贴底基线 | 2501 | 835 | 0 | 35 |
| 聚焦输入 3 行（跨行增高） | 2501（不变） | 790（-45） | **45**（视口被顶出） | 80 |
| 推一帧完全相同 state（宿主轻推帧：store tick/jobs/subagents 任一） | **2546** | 790 | **0**（被拽回） | 80 |

即：输入增高把贴底视口顶出 Δ（底部最新内容被挤出视口、无「回到最新」按钮提示），随后任一推帧 render 尾钉底把视口拽回——**「顶出 Δ ↔ 拽回 Δ」两段式交替 = 上下跳动**，幅度 = 每行增高量（~24px/行）。流式输出中推帧 200ms/帧，每次跨行输入几乎立即被拽回。

hero 空态（新对话）输入增高时 `.hero-stack` 居中重排、每次跨行整体上移 ~Δ/2——与本次用户确认场景（有消息对话）不同，暂列为未定项。

## 候选修复

**A（主修）**：`autoGrow` 内当输入框高度实际变化且 `stickToBottom` 时，立即把 `.messages.scrollTop` 钉回底部（复用 `markProgramPin`/`distanceFromBottom` 原语），消除「顶出-拽回」两段式——输入增高瞬间视口保持贴底。hero 空态无 `#messages`，走 null 分支跳过。

**B（待定）**：`.messages` 上 ResizeObserver 监听 clientH 变化统一补偿（覆盖 queue/todo/窗口 resize 等其它视口缩小源）——通用但更复杂、与滚动事件锁交互风险高，先不做。

**未定项**：hero 空态（新对话、无消息）输入增高时 `.hero-stack` 居中重排（每次跨行整体上移 ~Δ/2）——属居中布局自然行为还是也算跳动，待用户确认复现场景后决定是否处理。

## 涉及代码位置

- `src/ui/chat/webview.ts`：`autoGrow`（6997-7000）、render 尾部滚动恢复与钉底（3339-3383）、`stickToBottom` 维护
- `src/pure/scrollFollow.ts`：`AT_BOTTOM_PX`、`isAtBottom`、`shouldSettlePinNow`
- `src/ui/chatView.ts`：宿主推帧源（store tick / jobs / subagents onDidChange 全 tab 重推）

## 复现工具

- 一次性 fixture：`.dev-host/jitter/`（真实 chat STYLE 抽取 + 手写 state 推送；harness 的 style.css 是 chat+sessions 两段样式拼接，`#app` 布局规则互相覆盖，不能用于精确复现）——已删除。
