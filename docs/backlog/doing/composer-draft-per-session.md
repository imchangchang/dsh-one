# composer 草稿按 session 保存（文本与附件，切换会话不丢不搬家）

记录于 2026-09-0X。用户反馈：在 tab 里已输入未发送的文本，切换 session 或切换窗口的行为需要确认。核实后用户明确期望：**按 session 保存**——切走时存档、切回时恢复；tab 隐藏/显示（retainContextWhenHidden 已保证）不丢；VSCode 重载/重启不在本轮范围。

## 背景与现象

- A 会话输入框打了半截 → 切到 B 会话 → **文本原样出现在 B 的输入框**（跟着搬家）；在 B 里继续编辑 → 切回 A → A 输入框显示的是 B 里最后那份，A 的原草稿已被覆盖。
- 粘贴/选择的图片、文件附件：切换会话**即清空**（无任何恢复）。
- 现象本质：composer 草稿是「全局一份」，不是按会话各存一份。

## 现状（已核实）

- 文本草稿无 per-session 存储：`render()` 每帧 `const draft = oldInput?.value`（`src/ui/chat/webview.ts:1758-1761`），重建输入框时 `renderInput(draft)`（`:2257`）把旧会话文本直接注入新会话输入框；切到新会话的 state 处理只清 `pendingImages/pendingFiles/modelCatalog/commandNotices/recall/recallDraft/earlierAnchor`（`:693-704`），**不清输入框文本**。
- 附件按单会话定点：`stagedForSession`（`:250`），sessionId 变化即 `pendingImages = []`、`pendingFiles = []`（`:695-704`）。
- 停靠/放回文本的 `stashedDraft`（`:2435`）是模块级单值，切会话未重置（极端场景：restoreDraft 时无输入框 → 切会话 → 文本撞进新会话）。
- tab 隐藏/显示由 `retainContextWhenHidden: true`（`src/ui/chatView.ts:1540-1543`）保证不重载，草稿、滚动位置原样保留（曾因缺失修复过，见 `chat-panel-blank-after-tab-switch`）。
- 无 `setState/getState` 持久化：关闭面板/VSCode 重载后草稿丢失（本轮不做）。

## 建议方案

webview 内存按 session 归档，切换时「存旧会话 → 恢复新会话」：

1. 新增 `composerDrafts: Map<sessionId, string>` 与 `stagedPerSession: Map<sessionId, {images, files}>`（模块级）。
2. state 消息处理（sessionId 变化）：先把旧会话的文本（从旧 input DOM 读，input 不存在时合并 `stashedDraft`）与附件（`pending*`）存入归档，`stashedDraft` 重置；再从新会话归档恢复 `pendingImages/pendingFiles`（数组浅拷贝，防用户删附件时污染归档）。
3. `render()` 的 draft 取法：切换帧（`state.sessionId !== scrollSession`）从 `composerDrafts.get(newSid)` 取，非切换帧仍 `oldInput?.value`（流式保活现状不变）。

## 涉及代码位置

- `src/ui/chat/webview.ts`：`stagedForSession` 附近加归档 Map；state 处理分支（`:693-704`）；`render()` draft 取法（`:1758-1761`）。

## 变更记录

- 2026-09-0X 需求确认 → open
- 2026-09-0X 认领 → doing
