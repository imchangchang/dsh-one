# 附件文件框与图片框同尺寸（输入区 + 已发送消息）

记录于 2026-09-XX。用户反馈（附截图）：composer 里同时有图片和文件时会看到两个不同大小的框——图片是 48px 方图缩略图（`.attach-thumb`），文件是横向的 pill（`.image-chip`）「README.md ×」，一高一矮，排版不齐。要求：文件框和图片框一样大小；已发送的用户消息里同样处理。

## 现状（已核实）

- 输入区（`renderInput` → `image-chips` 行）：图片走 `pendingImageThumb`（`.attach-thumb` 48×48 方图 + hover 右上角 ×），文件走 `pendingFileChip`（`.image-chip` pill：文档小图标 + 文件名 + 内联 ×）。
- 已发送用户消息（`renderMessage` user 分支 → `msg-images` 行）：图片走 `messageImageThumb`（同 `.attach-thumb` 方图，加载中为同尺寸占位），文件走 `fileChip`（`.image-chip` pill，仅文件名，无图标）。
- CSS 都在 `src/ui/chatView.ts`：`.image-chips` :1222、`.image-chip` :1223、`.file-chip-icon` :1237、`.attach-thumb` :1240、`.thumb-remove` :1247。
- 渲染代码在 `src/ui/chat/webview.ts`：`pendingImageThumb` :4390、`pendingFileChip` :4434、`messageImageThumb` :~2500、`fileChip` :2559。

## 建议方案

文件 chip 改成与 `.attach-thumb` 同尺寸同圆角的 48px 方框：列排（文档图标在上、文件名在下 ellipsis），输入区版本右上角 × 复用 `.thumb-remove` 的 hover 显示交互；已发送消息版本同样式（含图标），无 ×。新增 `.file-chip` 样式，不改动 `.image-chip` pill（图片加载失败的回退 chip 仍用它）。

## 涉及代码位置

- `src/ui/chatView.ts`（CSS）：`.file-chip` 新增；`.file-chip-icon` 放大到 16px；`.thumb-remove` 的 hover/coarse 选择器扩展到 `.file-chip`。
- `src/ui/chat/webview.ts`：`pendingFileChip` 换 `.file-chip` + `thumb-remove`；`fileChip` 换 `.file-chip` 并补文档图标。

## 变更记录

- 2026-09-XX 记录 → open
- 2026-09-XX 认领（worktree: agent/attachment-file-chip-uniform-size）→ doing
