# hero workspace chip 改选择器（blank 会话换 workspace）

记录于 2026-08-31。从 ui-parity-leftovers 拆分。

## 背景与现象

官方 dsh web 的 workspace chip 是选择器，可给空（blank）会话换 workspace；dsh-one 的 chip 只读展示当前 workspace。

## 现状

没有「blank 会话换 workspace」的链路：切换需要新建会话到目标 workspace 并切换附着，涉及会话创建/附着流程，属新功能而非样式对齐。

## 建议方案

确认官方交互细节（选择器长什么样、是否只对 blank 会话可用）后：blank 会话时 chip 变选择器，选中 workspace → 新建会话到目标 workspace 并切换附着，非 blank 会话保持只读。

## 涉及代码位置

- `src/ui/chat/webview.ts`（hero 区域 workspace chip 渲染）
- 会话创建/附着：`src/ui/chatView.ts` / `src/pure/chatContract.ts`（session.create / attach 相关 RPC）
