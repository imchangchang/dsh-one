# 粘贴长文本转文件 + @ 引用

## 背景与现象

在 composer 粘贴一大段纯文本（日志、报错、长文档摘录）时，文本原样进输入框，刷屏、难编辑，全文还直接占 prompt 上下文。用户期望：粘贴长文本自动存成文件，输入框里以 `@` 引用的方式指向该文件。

## 方案（用户已拍板）

**文件式 + `@` 引用**，不做 Claude Code 式纯折叠占位符（纯折叠全文仍进 prompt，不占上下文的诉求满足不了）。

1. webview paste 处理器：无文件项时取 `text/plain`，超过阈值（行数/字符数，具体值待定）就 `preventDefault`，把文本发给宿主（新增消息类型，如 `textPasted`）。
2. 宿主把文本落盘到附件临时目录，复用 image-attachment-file-mode 的既有机制：`<tmp>/dsh-one-attachments/<sessionId>/`，命名风格对齐现有附件（如 `pasted-N.txt`）。
3. 输入框插入 `@` 短 token 指向该文件（`formatFileMention` 语法，发送时展开为完整 `@path`，与现有 `@` 引用同一管线），prompt 里只带文件路径，agent 自己读文件。
4. 文件同时进当前会话的附件集，使 `@` 补全候选（附件组）能再引用它——与 image-attachment-file-mode 落地的「@ 候选只列当前 composer 已附加的附件」一致。
5. 短文本维持现状直接插入。

## 注意点

- session mention 粘贴（`dsh-session://`）优先级更高，不被阈值拦截。
- 未附着会话（无 sessionId/cwd）时落盘位置要定义：回退不带会话子目录的 tmp 目录。
- 发送失败/撤销恢复（restoreDraft）时 `@` token 与附件要能恢复。
- 阈值先做固定值，是否可配置后议。

## 现状（已核实）

- `src/ui/chat/webview.ts` paste 监听（约 5641 行）只拦截 `kind === 'file'` 的剪贴板项；纯文本走默认插入（仅 session mention 特殊处理）。
- 非图文件粘贴已能落盘成附件（`chatTab.ts` `stagePastedFiles` / `saveTempAttachment`）。
- `@` 文件引用管线已存在：`src/pure/fileReference.ts`（token 语法/格式化）、webview `@` 补全、发送时 token 展开。

## 涉及代码位置

- `src/ui/chat/webview.ts`（paste 监听、消息上报、`@` token 插入）
- `src/ui/chatTab.ts`（文本落盘、附件暂存）
- `src/pure/chatContract.ts`（webview ↔ 宿主消息契约）

前置：image-attachment-file-mode（done，附件文件化 + `@` 引用管线，本需求复用）

关联需求：用户稍后引用补充

## 变更记录

- 2026-09-07 用户提出需求，核实现状后建条目 → open
- 2026-09-07 用户拍板方案：文件式 + `@` 引用，排除纯折叠占位符 → 仍 open
