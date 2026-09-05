# 排队中卡片预览的 @ 引用原样上屏（长 URI/路径占满两行 clamp，正文被吞）

## 背景与现象

用户反馈（2026-09-05）：排队中（queued）卡片预览里，消息文本含 canonical 会话引用 `@[标题](dsh-session:…)` 时原样上屏——base64 URI 很长，`.queue-text` 是两行 line-clamp，两行全被 URI 占掉，正文被 `...` 吞没（截图：`@[长文本输入时对话刷新问题](dsh-session:InNic…) …`）。

附件部分已处理：host 侧 `queueItemOf` 剥 `<attachment>` 行、换成 `[image ×N]`/`[file ×N]` 计数。其余 @ 情况全部原样上屏：

- session mention `@[label](dsh-session:URI)`（截图即此）
- `@path` / `@path/` / `@"path"` 文件/文件夹引用（长路径同样杀 clamp）
- 裸 `dsh-session:` URI
- `/command`（skill 形态，影响最小，本来就是纯文本）

## 根因（现状）

`renderQueueItem`（webview.ts:3925）直接 `el('span', 'queue-text', item.text)` 渲染纯文本，没走引用渲染管线；而插话（steering）气泡 `renderSteeringItem`（3953）和正式用户气泡都已用 `parseSessionMentions` + `renderUserBubbleParts` 把引用渲染成 chip（session 显示短 label、title 完整引用；文件/文件夹显示 basename、title 全路径）。排队卡片是漏接这条管线的最后一处。

## 建议方案

排队预览改走同一条管线：

1. `renderQueueItem` 里 `parseSessionMentions(item.text)` → `renderUserBubbleParts(readable, references)`，把 `parts.bubble` 塞进 `.queue-text` clamp 容器（chips 是 inline-flex，与 line-clamp 共存需实测）。
2. 编辑态不动：点「编辑」后仍是 `editText` 原文 textarea（分支已分开）。
3. `[image ×N]`/`[file ×N]` 计数前缀保持纯文本（host 侧已剥行，不动）。
4. bare URI 无 label 时 chip 显示 sessionId（与气泡行为一致）。
5. 渲染管线本身不动——纯复用，`renderUserBubbleParts` 不加参数。

## 涉及代码位置

- `src/ui/chat/webview.ts`：`renderQueueItem`（~3925）、参照 `renderSteeringItem`（~3953）、`renderUserBubbleParts`（~4506）
- `src/ui/chatViewHtml.ts`：`.queue-text`（~1128，line-clamp 2 行）
- `src/server/chatSession.ts`：`queueItemOf`（~113）——预览文本生产，本次不改

## 验收

- 排队消息含 `@[标题](dsh-session:URI)` 时卡片显示短标题 chip（title 完整引用），正文可读，不再被 URI 占满两行；编辑态仍为 raw 原文。
- 排队消息含 `@长路径` 时显示 basename chip（title 全路径）。
- 无引用时预览行为不变（纯文本）。
- 回归：steering 气泡、正式气泡、composer 补全/回填不受影响。

## 变更记录

- 2026-09-05 用户提出（排队中预览：除附件外其他 @ 情况也需渲染优化，询问意见）→ 核实现状（附件已剥行折叠、@ 引用原样上屏、steering 已走 chip 管线）→ 建条目（open/）
- 2026-09-05 用户确认直接修复 → 认领（worktree: agent/queue-preview-mention-chips）→ doing
