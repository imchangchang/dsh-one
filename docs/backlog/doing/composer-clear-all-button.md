# composer 一键清空按钮（输入框右上角 ×）

## 背景与现象

composer 有内容（文本 / 图片 / 文件附件）时，输入框右上角显示一个 × 符号，点击一键清除全部输入内容。用户提需求时说明：清空的是「所有输入内容」。

## 现状（已核实）

- Webview composer（`src/ui/chat/webview.ts` `renderInput`，约 5441 行）**没有**清空按钮。
- 文本清空目前靠 ⌘/Ctrl+A + 删除；多张图片 / 文件附件要逐个点 chip 上的 ×（每个 chip 都有独立的移除按钮，`pendingImageThumb`/`pendingFileChip`）。
- 官方 dsh web 的 InputBar 没有此按钮，本需求属于本地增强，不做对齐。

## 必要性评估（已与用户讨论）

- 纯文本场景增量小（选中删除是熟路）。
- 增量价值主要在「附件多个时一键全清」：选删只能清文本，附件必须逐张删。
- 成本低：`input-area` 内右上角一个 ghost 按钮，仅 dirty 时显示。

## 建议方案

1. 在 `input-area` 右上角加 × 按钮（`:hover` 或直接显示），`input.value`/`pendingImages`/`pendingFiles` 任有值时可见。
2. 点击清空：文本（含 recall 态、recallDraft）、pendingImages、pendingFiles 全清，render() 后 focus 输入框。
3. 注意避开图片 chip 自带的 × 与 hero 大圆角卡片布局；加 aria-label 与 l10n 文案。

## 涉及代码位置

- `src/ui/chat/webview.ts`：renderInput（按钮、点击逻辑、脏位判断）
- `src/ui/chatViewHtml.ts`：样式（按钮定位/悬浮态）
- l10n：`package.nls.json` / `package.nls.zh-cn.json`

## 变更记录

- 2026-09-03 用户提出需求，核实现状后讨论必要性（认可做，作本地增强）→ open

- 2026-09-06 认领（agent/composer-draft-clear，worktree .worktrees/composer-draft-clear）→ doing
