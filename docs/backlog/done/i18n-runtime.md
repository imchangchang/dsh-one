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
- 2026-09-01 l10n 方向翻转（commit ad8f87b）：核实 VS Code 1.96 l10n 机制后确认原「代码默认串中文 + bundle.l10n.json 英文」方案下英文译文永不生效（en 为默认语言不加载 bundle，非 en 只读 bundle.l10n.<locale>.json），按用户确认改为代码默认串英文 + bundle.l10n.zh-cn.json 中文。

## 开发完成（2026-09-01，commit ad8f87b，分支 agent/i18n-runtime）

改动（基于最新主线重做，适配 multi-tab 重构后的 chatTab.ts / chatMessages.ts 结构；commit a7c30d9 后经方向翻转 ad8f87b 定稿）：

- `package.json` 加 `"l10n": "./l10n"`。
- 77 处宿主侧用户可见文案改 `vscode.l10n.t()`，**代码默认串为英文**（en 用户直接可见；VS Code 对默认语言不加载 bundle，这是标准做法）。
- 新增 `l10n/bundle.l10n.zh-cn.json`：英文默认串 → 中文译文（zh-cn 用户可见，维持中文行为）；`l10n/bundle.l10n.json` 保留为英文基线（key=value，供翻译平台用，运行时不被读取）。
- 覆盖文件：`src/extension.ts`（通知/输入框/打开对话框，含新建未分组会话）、`src/ui/statusbar.ts`（状态栏 text + tooltip）、`src/server/manager.ts`（端口占用通知 + 启动失败类 Error 消息）、`src/server/locateDsh.ts`（dsh 未找到错误）、`src/ui/chatView.ts`（发送文件提示/切换 workspace 失败/新建会话失败）、`src/ui/chatTab.ts`（tab 标题兜底/聊天操作失败/附件选择与跳过提示/图片限额提示）、`src/ui/chatMessages.ts`（模型列表/切换模型/Full access 确认/导出日志/分支/重命名/产物附件文件打开错误）、`src/ui/sessionsView.ts`（复制引用提示/移除 workspace 确认）。
- 显示语言跟随 VS Code UI 语言：en → 英文默认串；zh-cn → bundle 中文译文；其他 locale 无文件时回退英文默认串。
- 不动的部分：webview 内显示的文案（含 pure/ 模块文案、queue notes、commandResult、`webview.ts` 错误页）留给 i18n-webview；dsh 服务下发的消息文本；spawnDsh.ts（独立 Node 进程，无 vscode 依赖）。

人工验收方法（真实 VSCode dev-ui-test；**显示语言跟随 VS Code UI 语言**，中/英文各起一个独立实例）：

1. 英文：`cd <repo-root>/.worktrees/i18n-runtime && code . --extensionDevelopmentPath=/Users/cgeng/Workspaces/dsh-one/.worktrees/i18n-runtime --user-data-dir=/tmp/dsh-uidev/i18n-runtime-en/user-data --extensions-dir=/tmp/dsh-uidev/i18n-runtime-en/extensions --locale=en`，确认状态栏「DSH: Running :3080」，tooltip 为英文（Open in Browser/Restart Service/Show Logs）；命令面板搜 "Rename Session"/"Create Workspace" 为英文标题；归档会话 modal 为 "Archive session ..." + "Archive" 按钮。
2. 中文：把 VS Code 界面切到中文（`--locale=zh-cn` 起实例，或系统中文 + 已装中文语言包），同实例下状态栏「DSH: 运行中 :3080」、tooltip 中文（在浏览器中打开/重启服务/显示日志）、归档 modal「确认归档会话…」+「归档」按钮。
3. 无 workspace 时执行「新建会话」：英文实例弹 "No workspace available. Open a folder in VSCode first."，中文实例弹中文对应文案。
4. 端口占用场景（可选）：把设置 `dshOne.port` 改成被占用端口再激活，英文实例通知显示 "DSH One: port X is occupied by another program; using port Y this time (setting unchanged)"。
