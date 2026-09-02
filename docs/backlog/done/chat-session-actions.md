# chat 窗口的会话操作入口：头部 ⋯ 菜单 + 编辑器 tab 右键高频项

记录于 2026-09-02。用户要求：chat 窗口的 tab 右键应提供与侧栏 session 右键一样的操作；经讨论定为「头部 ⋯ 菜单 + tab 右键补高频项」的适配方案（用户已确认）。

## 背景与现象

chat 窗口（editor WebviewPanel，viewType `dshOne.chatPanel`）一个会话一个 tab。侧栏 session 行右键有完整操作菜单（新tab打开/重命名/置顶/已读未读/分叉/复制引用/归档，带禁用逻辑），chat 窗口侧没有等价入口：编辑器 tab 右键只有 VS Code 原生项，窗口内也无会话操作菜单（仅顶部标题单击可改名）。

## 现状

- 侧栏菜单：`src/ui/sessionsWebview.ts` 的 `buildSessionMenuBody`；菜单动作消息在 `src/ui/sessionsView.ts` 的 `onMessage` 处理。
- chat webview：`src/ui/chat/webview.ts`（已有 `menuItem`/`showPopover` 弹层设施）；宿主消息处理 `src/ui/chatTab.ts` `handleMessage` → `src/ui/chatMessages.ts` 的按域 handler。
- `FromWebviewMessage` 契约（`src/pure/chatContract.ts`）已含 `sessionRename`/`sessionPin`/`sessionUnread`/`sessionFork`/`sessionCopyReference`/`sessionArchive` 等消息，但 chat 侧 handler 未注册（现在 `sessionOpen` 是可以用的，面包屑回父会话）。
- 会话级命令已存在：`dshOne.session.rename`/`.archive`/`.fork`（`src/extension.ts`，直接收 sessionId）；没有 `dshOne.session.copyReference` 命令（侧栏在 `sessionsView.ts` 里直接写剪贴板）。
- 编辑器 tab 右键菜单点：VS Code 的 `editor/title/context`，webview panel tab 可贡献（GitLens 对 Claude 面板的既有用法）。右键 tab 时 VS Code 把被右键 tab 的资源 URI 设为 `resource` 上下文键并作为命令第一个参数；webview panel tab 的 URI path 形如 `webview-panel/webview-<viewType>-<id>`（VS Code 内部实现，webviewEditorInput.ts）。`activeWebviewPanelId` 是「组内活动编辑器」而非「被右键的 tab」，用于显隐不精确。

## 建议方案

1. **chat 窗口头部 ⋯ 会话菜单**：`.chat-header` 右端加 ⋯ 按钮，弹层菜单 = 侧栏菜单去掉「在新 tab 中打开」（当前 tab 即该会话）：重命名 / 置顶 / 已读未读 / 分叉 / 复制引用 / 归档。禁用逻辑与侧栏一致（运行中/待处理/未读/**无已完成轮次**）。复用 chat webview 现有 `menuItem`/`showPopover` 与侧栏一致的图标；会话元数据（pinned/unread/hasCompletedTurn）从已推送的 `SessionsSnapshot` 里按 sessionId 查，运行位/待处理用 `ChatState`。
2. **编辑器 tab 右键**：`package.json` 向 `editor/title/context` 贡献 重命名 / 分叉 / 复制引用 / 归档 四项；`when` 用 resource 上下文键精确限到 chat 面板 tab：`resourceScheme == webview-panel && resourcePath =~ /^webview-panel\/webview-dshOne\.chatPanel-/`（失效时菜单不出现 = 优雅降级）。命令参数为该 URI；webview tab 在 API 层无 per-tab 唯一标识，URI 里是编辑器内部 id，**无法从参数反查会话**，命令按「当前活动 chat tab」解析目标会话，代码注释注明该限制（右键非活动 tab 且多 tab 时可能作用到活动会话，绝大多数场景右键的即是活动 tab）。
3. **宿主侧**：新增 `dshOne.session.copyReference` 命令（侧栏 `sessionCopyReference` 分支改走命令，收敛实现）；`chatMessages.ts` 注册 session 动作 handler（`sessionRename`/`sessionPin`/`sessionUnread`/`sessionFork`/`sessionCopyReference`/`sessionArchive`），实现与 `sessionsView.onMessage` 同款（命令或 store 本地操作）。

## 涉及代码位置

- `src/ui/chat/webview.ts`（头部 ⋯ 菜单 + 菜单弹层）
- `src/ui/chat/chatMessages.ts`（session 动作 handler）
- `src/ui/sessionsView.ts`（copyReference 改走命令）
- `src/extension.ts`（`dshOne.session.copyReference` 注册）
- `package.json`（`editor/title/context` 菜单贡献 + copyReference 命令声明）
- `src/ui/chat/icons.ts`（如缺 PIN_ICON/UNREAD_ICON，与侧栏一致的图标路径）
- `src/ui/chatViewHtml.ts`（如头部 ⋯ 按钮需要新样式）

## 前置

无

- 2026-09-02 认领（本会话）→ doing

- 2026-09-02 开发完成，自测通过（typecheck/test/build，336 tests）→ done
