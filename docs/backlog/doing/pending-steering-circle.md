# 插话消息显示：去掉「等待插话」徽章，改为正常气泡 + 开头处理中圆圈

记录于 2026-09-02。用户反馈：插话发送的消息要和正常消息一样发送出去，只是在消息最开头加一个「正在处理中的圆圈」表示正在插话；不要现在「气泡 + 一个『等待插话』小标签」的方式（用户口中的「小 clip」即该徽章，已确认）。

## 现状（已核实）

- `src/ui/chat/webview.ts:2628-2633` `renderSteeringItem`：等待插话的 steering 消息渲染成 `msg user steering-pending` 行 = 用户气泡（`bubble`，文本）+ 下方 `queue-tag`「等待插话」徽章；气泡降 0.7 不透明度（`chatViewHtml.ts:156-157` `.msg.user.steering-pending .bubble { opacity: 0.7 }`）。
- 已用浏览器 mock 快照截图确认当前视觉：右侧用户气泡 + 气泡下方灰底小徽章「等待插话」。
- 官方 dsh web 的 `PendingSteeringBubble`（dsh-client-ui-conversation `client.js:5369`）就是 `UserStyleBubble` + `data-pending-steering` 属性，CSS（`MessageItem.module.css`，client.js:4254）对该属性**无任何特殊样式**——即官方本来就是正常用户气泡，无徽章、无降透明。

## 建议方案（已与用户确认方向）

1. `renderSteeringItem` 保留 `steering-pending` 行结构，但：去掉 `queue-tag`「等待插话」文案；气泡恢复正常不透明；在气泡左侧（同一行）加 `.spinner` 圆圈表示处理中（复用现有 `.spinner` 样式，`chatViewHtml.ts:476-481`，12px 旋转圆环）。
2. 布局：`.msg.user.steering-pending` 改为横向 flex（`flex-direction: row`）容纳 [spinner][bubble]，对齐右端；其余（气泡右侧对齐、间距）照常。
3. 插话落地后该行整体被正式 `renderMessage` 的用户消息替换，圆圈随 pending 状态自然消失，无需额外清理逻辑。

## 涉及代码位置

- `src/ui/chat/webview.ts` — `renderSteeringItem`（:2628-2633）
- `src/ui/chatViewHtml.ts` — `.msg.user.steering-pending`（:156-157）与 `.spinner`（:476-481，复用）

## 变更记录

- 2026-09-02 记录 → open（用户口头需求；徽章即「小 clip」已确认；圆圈取气泡左侧同行形式，用户未另选）

- 2026-09-02 认领（worktree: agent/pending-steering-circle）→ doing
