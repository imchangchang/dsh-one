# chat 编辑器 tab 标题跟会话名 + tab 图标用 dsh 官方图标

记录于 2026-09-01。用户验收 sidebar-sessions-tree-editor-chat 时提出的需求，已确认可行，记录待开发。

## 背景与现象

chat 在 editor WebviewPanel（拆分后）里打开后，tab 标题固定显示「DSH One」（`createWebviewPanel` 时硬编码），不随附着会话变化；tab 前面的图标也是 VS Code 默认图标。用户希望：**tab 标题显示当前会话名**（含 dsh 自动命名），**tab 图标换成 dsh 官方图标**。

## 现状（已核实）

- `src/ui/chatView.ts` `openPanel()`（:1089-1119）：`vscode.window.createWebviewPanel('dshOne.chatPanel', 'DSH One', ...)`——title 硬编码；附着会话时（`setSession`/标题投影回调）没有同步 `panel.title`。
- 会话标题来源：`ChatViewProvider` 有 Last title projection 观察（:1006 附近 auto-rename watch），webview 头部已显示标题；`panel.title` 在标题投影更新时同步即可（含用户重命名/自动命名）。
- **dsh 官方图标**（已核实路径）：`@deepseek-ai/dsh-web-frontend/dist/favicon.svg`（50×50，dsh 品牌图形，dark 模式白色 fill）；dsh-one 自己的 `assets/icon.png`/`icon.svg` 是像素鲸鱼市场图标（发布用）。panel 图标：`panel.iconPath = vscode.Uri.file(assets/icon.png)` 或从 dsh 包取 favicon.svg（版权归属：favicon 来自已安装的 dsh 官方包，直接用同一条目里引用路径或拷贝进 assets/ 并注明来源）。

## 建议方案

1. tab 标题：`setSession` 附着时 + 标题投影回调时 `this.panel.title = 会话标题（fallback 会话 ID 前 8 位）`；空态回落「DSH One」。
2. tab 图标：`panel.iconPath` 设 dsh 官方图标（优先 favicon.svg 拷贝到 `assets/`，注明来源；或直接用 `assets/icon.png`）。

## 涉及代码位置

- `src/ui/chatView.ts`（panel.title / iconPath）
- `assets/`（官方 favicon.svg 引入，注明来源）

## 规模

小改动，单独一轮或随多 tab 条目一起做（见 multi-tab-chat-sessions）。

- 2026-09-01 认领（worktree: agent/chat-tab-title-and-icon）→ doing
