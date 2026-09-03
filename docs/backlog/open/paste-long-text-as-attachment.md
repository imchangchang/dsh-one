# 粘贴长文本转附件 / 折叠占位

## 背景与现象

在 composer 粘贴一大段纯文本（日志、报错、长文档摘录）时，文本原样进输入框，刷屏且难以编辑。用户期望：

- 粘贴长文本时自动保存成文件、作为附件（path chip）加入；或
- 像 Claude Code 那样折叠成 `[pasted xxx lines]` 占位符。

## 现状（已核实）

- `src/ui/chat/webview.ts` 的 paste 监听（约 5641 行）只拦截 `clipboardData.items` 里 `kind === 'file'` 的项；纯文本走默认行为直接插入 textarea（仅有 session mention 的特殊处理 `pasteSessionMentions`）。
- 文件类粘贴已经能落成附件：宿主 `src/ui/chatTab.ts` `stagePastedFiles()` 把非图片粘贴经 `saveTempAttachment()` 写到 `os.tmpdir()/dsh-one-attachments/`，再以 `filesPicked` 消息投回 composer 作为 path chip。这套通道可以直接复用。

## 建议方案

想法：未确认。大致做法：

1. webview paste 处理器里，无文件项时取 `text/plain`，超过阈值（如 ≥ 10 行或 ≥ 800 字符，可先做固定值）就 `preventDefault`，把文本发给宿主（新增消息类型，如 `textPasted`）。
2. 宿主复用 `saveTempAttachment()` 存成临时 `.txt`/`.md` 文件，走现有 `filesPicked` 通道作为 path chip 附件，agent 通过读文件拿到全文。
3. 输入框里可选插入一个占位引用文本（如 `[pasted 120 lines]`），与附件 chip 对应；删除 chip 时占位文本的联动要定义清楚。
4. 短文本维持现状直接插入。

注意点：

- 占位文本只是显示层，发送时要保证 prompt 里带的是附件路径而不是占位符全文。
- session mention 的粘贴（`dsh-session://`）不应被阈值拦截，优先级更高。
- 临时文件命名与清理策略跟现有 `saveTempAttachment` 一致。

## 涉及代码位置

- `src/ui/chat/webview.ts`（paste 监听、`filesPasted` 上报）
- `src/ui/chatTab.ts`（`stagePastedFiles` / `saveTempAttachment`）
- `src/pure/chatContract.ts`（webview ↔ 宿主消息契约）

## 变更记录

- 2026-09-07 用户提出需求，核实现状后建条目 → open
