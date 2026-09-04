# 自绘弹出菜单点击 webview 外不关闭（session 右键菜单）

## 背景与现象

侧栏 Sessions 面板的 session 行上右键（或 ⋯ 按钮）弹出自绘菜单后，点击侧栏空白处菜单能关闭，但点击**编辑区**（webview 外）菜单不消失，只有点回侧栏内的 session 行才关。用户期望常规右键菜单体验：点击任意位置（含 webview 外）都关闭。

## 根因（已从代码确认）

菜单关闭只依赖 webview 文档内的事件监听：`src/ui/sessionsWebview.ts` 的 `onPopoverOutside` 以捕获阶段挂在 `document` 的 `mousedown` 上（`showPopover`/`showPopoverAt` 里 add，`disposePopover` 里 remove）。webview 是嵌在 VS Code 里的独立文档，点击 webview 外的 mousedown 事件发生在另一个文档，根本不会进入 webview 文档，监听器收不到 → 菜单不关。点击侧栏空白/其他 session 行能关，因为事件在 webview 文档内派发。

chat webview（`src/ui/chat/webview.ts`）同款机制（`onPopoverOutside` + `mousedown`），消息右键菜单、外链右键菜单、composer 菜单等同样受此影响。

VS Code 原生菜单由宿主全局管理所以无此问题；webview 自绘菜单需要自己补偿「失焦即关」——唯一可靠信号是 webview 文档 `window` 的 `blur` 事件（点击编辑器/其他面板时 webview 文档失去焦点即触发）。

## 方案

菜单打开时（`showPopover`/`showPopoverAt`）追加 `window.addEventListener('blur', ...)`，blur 里 `closePopover()`；`disposePopover` 里 remove。sessions 与 chat 两处同款修改（同根因一起修）。菜单项点击/Esc/外点逻辑不动。

## 涉及代码位置

- `src/ui/sessionsWebview.ts`：`showPopover`/`showPopoverAt`/`disposePopover`（blur 监听的 add/remove）
- `src/ui/chat/webview.ts`：同款位置（chat 的 popover 关闭函数与 dispose 逻辑）

## 变更记录

- 2026-09-04 用户报侧栏 session 右键菜单点击编辑区不关闭；代码确认根因为关闭仅依赖 webview 文档内 mousedown，webview 外事件不可达；方案定为 window blur 失焦关闭，sessions + chat 两处同根因一起修。
