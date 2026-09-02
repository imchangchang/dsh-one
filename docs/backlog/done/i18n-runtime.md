# i18n：运行时层（l10n）

记录于 2026-09-01。来自发布流程讨论：manifest 层之外，扩展宿主运行时文案也硬编码中文。

## 背景与现象

- 扩展宿主里由代码直接产出的用户可见文案（状态栏 tooltip、通知、错误提示、日志等）硬编码中文。
- 这部分在 manifest 层（`package.nls`）覆盖不到，需要独立的运行时本地化。

## 现状

- 无 `l10n/` 目录、无 `vscode.l10n.t()` 调用，文案散落在宿主代码里。

## 方案

- 用 VS Code 的 `l10n` API：宿主文案改 `vscode.l10n.t('...')`，并在 `l10n/bundle.l10n.json` 提供译文；`package.json` 加 `"l10n": "./l10n"`。
- 新增 string 时在 bundle 里同步补 zh/en 译文，避免漏翻。

## 涉及代码位置

- `src/` 扩展宿主侧产生文案的模块
- `l10n/bundle.l10n.json`（新增）
- `package.json`（`l10n` 字段）

## 备注

- webview 里无法直接调 `vscode.l10n`（独立浏览器上下文），那条走 `i18n-webview`。

- 2026-09-01 认领 → doing（并行开发 session）
- 2026-09-01 开发完成，自测通过（typecheck + 326 tests + build）→ done

## 开发完成（2026-09-01，commit a7c30d9，分支 agent/i18n-runtime）

改动（基于最新主线重做，适配 multi-tab 重构后的 chatTab.ts / chatMessages.ts 结构）：

- `package.json` 加 `"l10n": "./l10n"`。
- 新增 `l10n/bundle.l10n.json`：79 条默认串（中文）→ 英文译文。
- 宿主侧用户可见文案改 `vscode.l10n.t()`：`src/extension.ts`（通知/输入框/打开对话框，含新建未分组会话）、`src/ui/statusbar.ts`（状态栏 text + tooltip）、`src/server/manager.ts`（端口占用通知 + 启动失败类 Error 消息）、`src/server/locateDsh.ts`（dsh 未找到错误）、`src/ui/chatView.ts`（发送文件提示/切换 workspace 失败/新建会话失败）、`src/ui/chatTab.ts`（tab 标题兜底/聊天操作失败/附件选择与跳过提示/图片限额提示）、`src/ui/chatMessages.ts`（模型列表/切换模型/Full access 确认/导出日志/分支/重命名/产物附件文件打开错误）、`src/ui/sessionsView.ts`（复制引用提示/移除 workspace 确认）。
- 默认串保持中文（维持中文用户可见行为）；英文 locale 由 bundle 提供译文。
- 不动的部分：webview 内显示的文案（含 pure/ 模块文案、queue notes、commandResult、`webview.ts` 错误页）留给 i18n-webview；dsh 服务下发的消息文本；spawnDsh.ts（独立 Node 进程，无 vscode 依赖）。

人工验收方法（真实 VSCode dev-ui-test）：

1. 中文 locale（系统语言为中文）：`cd <repo-root>/.worktrees/i18n-runtime && bash <repo-root>/scripts/dev-ui-test.sh`，确认状态栏显示「DSH: 运行中 :3080」（或启动中/已停止），悬停 tooltip 为中文（在浏览器中打开/重启服务/显示日志等）；命令面板跑「DSH One: 新建会话」「DSH One: 重命名会话」「DSH One: 创建工作区」均为中文标题/提示。
2. 英文 locale（VS Code 命令行参数 `--locale=en` 启动，或系统语言切英文）：同一份代码下状态栏为「DSH: Running :3080」，tooltip 为英文；新建/重命名会话的输入框与通知为英文；右键文件「发送到当前会话」在无附着会话时的新建/错误提示为英文。
3. 对照抽查：归档会话的 modal 确认框（「确认归档会话…？」+「归档」按钮）、移除 workspace 的 modal（「将把…移除…」+「从列表移除」）在两种 locale 下分别显示中/英文。
4. 端口占用场景（可选）：把设置 `dshOne.port` 改成被占用端口再激活，英文 locale 下通知应显示 "DSH One: port X is occupied by another program; using port Y this time (setting unchanged)"。
