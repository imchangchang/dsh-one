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

## 编辑（待拍板）

只对**最后一条真正用户消息**可编辑（排除 host 注入 context、command 卡、compaction 卡；与 ↑ recall 的判定一致）。

- **E1 追加**：右键「编辑」→ 回填 composer（文本 + 附件），用户修改后发送 = 新 turn 追加；旧消息与旧回复保留在历史里。复用现成逻辑：↑ recall 已实现「最后一条真正用户消息 + 附件回填」（webview.ts ~6051-6062，文件按 path 去重、图片以 image 标记 chip 恢复）。
- **E2 分支**：右键「分支重做」→ fork atSeq（最后 turn 起点的前序 seq）+ 回填 + 聚焦，新会话干净历史重走，原会话不动。fork 通道已存在（assistant turnEnd 操作栏 Fork 按钮，atSeq 现成），E2 增量 = 一步直达（现有路径：Fork 按钮 → 新会话 ↑ recall → 改 → 发，共 3 步）。
- 菜单项显示：建议「编辑」只出现在最后一条真正用户消息上（其余消息无该项）；「分支重做」挂在最后一条完整 turn 的 assistant 消息上（与现有 Fork 按钮并存）。

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
- 2026-09-04 复制部分拍板（两项菜单恒显示 / user=images+files、assistant 含 producedFiles / 多图全写 + 路径文本兜底 / 文件用 markdown 引用）。编辑部分待拍板（E1 追加 / E2 分支 / E1+E2）。
