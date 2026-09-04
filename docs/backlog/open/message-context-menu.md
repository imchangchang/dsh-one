# 消息气泡右键菜单：复制 / 编辑

## 背景与现象

对话气泡（user/assistant 消息）没有右键菜单——现有右键菜单只属于外链和会话行。assistant 消息操作栏已有复制按钮（纯文本），user 消息无复制。需求：气泡右键直接复制；最后一条用户消息可编辑（= 重新对话）。

**背景约束**：dsh 无消息替换/删除 API（RPC 全集无 message.edit/delete），「重新对话」只能追加新 turn 或 fork 分支，做不到 ChatGPT 式原地替换。

## 复制（已拍板）

- 消息级右键菜单，user / assistant 消息都显示，两项：
  - **复制文字**：纯文本（复用 `assistantText`；user 取 `text`）
  - **复制文字和附件**：见下
- 附件范围（已确认）：user = images + files；assistant = producedFiles 也算附件。
- 附件形态（已确认）：
  - 图片 = 真实图片二进制写入剪贴板；**多图全部写入**，多数粘贴目标只认第一张，剩余以路径文本兜底（文本部分列出全部路径）。
  - 文件 = markdown 引用 `[文件名](路径)`（webview 剪贴板无法复制文件本体，只能文本）。
- 两项菜单对 user/assistant 都显示（已确认），无附件时「复制文字和附件」退化为纯文字。

## 编辑（已拍板：E1 + E2 都做）

只对**最后一条真正用户消息**可编辑（排除 host 注入 context、command 卡、compaction 卡；与 ↑ recall 的判定一致）。

- **E1 追加 ·「编辑重发」——仅对话中断时出现（用户拍板）**：只有最后一条真正用户消息的回复**未完成**（assistant 消息 `interrupted` / `turnError` / `maxTokens`，或该消息后无任何回复）时才显示；正常完成的对话不显示（想重来走 E2）。点击 → 回填 composer（文本 + 附件）→ 用户修改后发送 = 新 turn 追加；旧消息与旧回复保留在历史里。复用现成逻辑：↑ recall 已实现「最后一条真正用户消息 + 附件回填」（webview.ts ~6051-6062，文件按 path 去重、图片以 image 标记 chip 恢复）。
- **E2 分支 ·「分支重做」**：挂在**最后一轮完整（未中断）turnEnd 回复**上。点击 → fork atSeq（最后 turn 起点的前序 seq）+ 回填 + 聚焦，新会话干净历史重走，原会话不动。fork 通道已存在（assistant turnEnd 操作栏 Fork 按钮，atSeq 现成），E2 增量 = 一步直达（现有路径：Fork 按钮 → 新会话 ↑ recall → 改 → 发，共 3 步）。
- 菜单项显示（已确认的规则）：
  - 「编辑重发」仅最后一条真正用户消息且其回复未完成时出现；其余消息该位置置灰（提示「仅未完成的最后一条消息」；若是最后一条真正用户但对话已完成，提示「本轮已完成，用分支重做」）。
  - 「分支重做」仅最后一轮完整回复（`turnEnd && !interrupted && !turnError && !maxTokens`）上出现；其余置灰（提示「仅最后一轮完整回复」）。
- 交互原型：`.dev-host/msg-menu-proto.html`（可玩；hash：`#menu` 完成场景 / `#interrupted` 中断场景 / `#edit` 编辑态 / `#branch` 分支态），截图 `msg-menu-proto-{0-menu-complete,1-menu,2-edit,3-branch}.png`。

## 涉及代码位置

- `src/ui/chat/webview.ts`：
  - 消息级右键菜单（新建；坐标定位弹层模式可复用 ~1325 外链菜单）
  - `assistantText` (~4496)；user 文本（`ChatUserMessage.text`）
  - recall 回填逻辑 ~6051-6062（E1 直接复用）
  - 剪贴板写多项目（`navigator.clipboard.write`，图片 blob + text/plain + text/html）
  - `fork` 消息通道已在 chatContract（`{ type: 'fork'; atSeq }`，~805）
- `src/pure/chatContract.ts`：复制/编辑回填均为 webview 内本地动作，预计无需新消息；E2 复用现有 fork。

## 变更记录

- 2026-09-04 需求提出（用户：气泡右键复制 + 最后一条对话可编辑重做）；核实现状（无消息级右键菜单、复制仅 assistant 操作栏、dsh 无消息替换 API、↑ recall 已有回填能力、Fork 已有 atSeq 通道）。
- 2026-09-04 复制部分拍板（两项菜单恒显示 / user=images+files、assistant 含 producedFiles / 多图全写 + 路径文本兜底 / 文件用 markdown 引用）。
- 2026-09-04 编辑部分拍板（交互原型 `.dev-host/msg-menu-proto.html` 评审后）：E1 + E2 都做；「编辑重发」**仅对话中断时出现**（未完成回复/无回复；正常完成的不显示），「分支重做」仅最后一轮完整回复上出现；两处缺失时置灰提示。
