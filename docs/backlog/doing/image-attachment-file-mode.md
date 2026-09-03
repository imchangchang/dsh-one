# 图片附件改为文件方式（落盘工作区 + 路径引用）

## 背景与现象

在聊天里粘贴/选择截图后，图片以 base64 走 dsh 附件管线：DSH 把图片归一化压缩后存进 `~/.dsh/attachments/v1/request-images/<sha256>`（哈希命名、无扩展名），会话里只记录 `sha256:...` 的 attachmentId，**不是文件路径**。用户拿不到可直接处理的文件，UI 也看不到路径。而非图片文件（StagedFile）已经是文件方式：字节留在磁盘，发送时把 `<attachment>path</attachment>` 路径行拼进 prompt 文本，agent 自己读文件，聊天里渲染成短名 chip。

用户期望：截图/图片也走文件方式——图片落一份到会话工作区（保留原始字节、简短命名），消息里带文件路径（不发 base64 图），聊天框用短名 chip/缩略图展示（不显示长路径），可以 `@` 引用（fileReferences/list 补全）。

## 现状（代码位置）

- `src/pure/chatContract.ts`：`OutgoingImage`（base64 图）、`StagedFile`（路径 chip）、`ChatUserMessage.files`（ChatFile）
- `src/ui/chatTab.ts`：
  - `pickFiles`：图片读 base64 → `stageImages`（validateImages 限额）；非图文件直接路径 chip
  - `stagePastedFiles`：图片 base64 进 PendingImages；非图写 `/tmp/dsh-one-attachments/`（`saveTempAttachment`）
  - `stageContextFile`：右键发送，同上分流
- `src/ui/chat/webview.ts`：`pendingImageThumb`（base64 缩略图）、`pendingFileChip`（图标+短名）、发送时 `pendingFiles` 拼 `<attachment>` 行
- `src/pure/conversation.ts` `splitAttachments`：发送后从 `<attachment>PATH</attachment>` 行解析回 `ChatFile`

## 方案

1. 图片附件（粘贴/选择/右键发送）一律转换为文件方式：
   - 粘贴：图片字节写到**会话 cwd 下 `dsh-attachments/`**（无点前缀，`@` 补全会扫到；`file-reference-local` 对 dot 目录会过滤），命名 `截图-MMDD-HHmmss.ext`（简短可区分，同秒撞名加序号）
   - 选择/右键：图片本来就在磁盘，直接引用原路径，不复制
   - 非图粘贴文件也改写到 `dsh-attachments/`（原文件名），与图片一致、可被 `@` 补全
   - 无 cwd（未分组会话）回退现有 tmp 目录
2. 消息只发 `<attachment>path</attachment>` 行，不再带 base64 图片（`OutgoingImage` 契约保留兼容旧 queue 项）
3. UI：
   - staging chip：图片显示缩略图（host 提供 base64 previewData，webview 内存态，不随消息发送）
   - 历史消息：`ChatFile` 按扩展名标 `image`，chip 显示缩略图（懒加载：webview `requestFileThumb` → host 读盘转 dataUrl 回 `fileThumb`），短名显示、长路径只留 title
4. 发送失败/撤销恢复（restoreDraft/unsteer）时图片 chip 按文件方式恢复，previewData 由 host 从磁盘重新读

## 不做（本轮）

- 不改 DSH 本体（不做后端镜像/配置）
- 图片限额校验（validateImages）对文件方式图片不再生效——大图落盘不占对话预算，模型端由 read_image 自行处理
- queue 编辑历史兼容路径保持原样

## 验收

- 粘贴/选择截图 → 出现缩略图 chip，发送后用户消息显示短名 chip（可点开、不显示长路径）
- `<cwd>/dsh-attachments/` 出现原始字节截图，短名（如 `截图-0903-153812.png`）
- 模型消息里能通过 `@ dsh-attachments/截图-xxx.png` 补全引用
- 模型（agent）能读到该路径文件内容

- 2026-09-03 发现需求（用户：图片附件希望文件方式，落盘工作区+路径引用）→ open

- 2026-09-03 认领（worktree: agent/image-attachment-file-mode）→ doing
