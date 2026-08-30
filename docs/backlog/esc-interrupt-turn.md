# Esc / Ctrl+C 打断当前 turn

记录于 2026-08-30。类型：需求。

## 需求

聊天面板里能用 **Esc** 或 **Ctrl+C** 直接打断当前正在进行的 turn，等价于点击「停止」按钮，不用鼠标去找按钮。

## 现状

目前打断只能点输入区右侧的「停止」按钮（turn 进行中时发送按钮变为停止）。停止动作链路已存在：webview 发 stop → `src/ui/chatView.ts` onMessage 路由 → `ChatSessionController.stop()` → `session.cancel` RPC（`src/server/chatSession.ts:313`、`src/server/dshRpc.ts:274`）。本需求只是加键盘入口，不动宿主逻辑。

## 建议方案

在 `src/ui/chat/webview.ts` 监听 keydown：

- `state.running` 为 true 且按下 Esc / Ctrl+C 时，走现有 stop 动作（复用发送停止按钮的消息）。
- 待决策点：
  - Esc 与弹层关闭的优先级：模型/权限选择器、会话行「⋯」菜单、上下文用量弹窗等打开时，Esc 应先关弹层，无弹层时才打断 turn。
  - Ctrl+C 与复制的冲突：输入框或消息区有选中文本时 Ctrl+C 应保持复制语义，无选区时才打断（Claude Code 的做法是连续两次 Ctrl+C 退出，单次打断，可参考但不照抄）。
  - Esc 在 VS Code webview 里可能被宿主拦截的场景需要实测（webview 内 keydown 一般能收到）。

## 涉及代码

- `src/ui/chat/webview.ts`：键盘监听与 stop 动作触发；弹层关闭逻辑已有多处，需统一优先级。
- `src/ui/chatView.ts`：onMessage 的 stop 路由（已有，无需改）。
- 提示文案：输入框 placeholder 可补一句「Esc 打断」（对齐现有快捷键提示风格）。
