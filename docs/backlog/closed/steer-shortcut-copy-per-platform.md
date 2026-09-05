# 插话快捷键占位符按平台区分文案（macOS ⌘Enter vs Win/Linux Ctrl+Enter）

## 背景与现象

用户要求排查全仓库是否存在 win/macOS/linux 文案不分的快捷键提示。排查结论：唯一一处用户可见的问题在 **composer 占位符（会话运行中状态）**：

- 英文：「Type a message; Enter queues, ⌘Enter steers now, ↑ edits the queued message, Esc interrupts」
- 中文 l10n：「输入消息，Enter 排队发送，⌘Enter 立即插话，↑ 修改排队消息，Esc 打断」

Windows/Linux 用户的键盘上没有 ⌘ 键，看到的占位符却是「⌘Enter」。

## 根因

`src/ui/chat/webview.ts` 占位符文案写死 ⌘ 符号（约 6634 行），但按键处理（约 6892 行）是 `sendCurrent(e.metaKey || e.ctrlKey)`——mac 用 ⌘、Win/Linux 用 Ctrl **功能上全平台都正确，只有文案是 mac-only**。

辅助事实：webview 目前只在空态/dshNotFound 拿到 `state.hostOs`（`chatTab.ts` EMPTY_STATE、`sessionsView.ts`），挂着会话的正常状态不下发 hostOs，所以占位符想按平台出文案需要先把 hostOs 补进正常 state（或 webview 内用 `navigator.platform` 判断）。

## 排查过、确认没问题的

- 「Esc interrupts」「Shift+Enter for newline」「↑ recalls」等平台中性
- Ctrl+C 打断（webview.ts 约 1326 行）各平台行为一致，且未在文案宣传
- README「Ctrl/Cmd+Shift+P」、CHANGELOG「⌘/Ctrl+Enter」均并列两平台
- dshNotFound 安装脚本块已按 hostOs 分平台出命令

## 建议方案

1. host 侧正常 ChatState 推送也带 `hostOs: hostOsFromPlatform(process.platform)`（复用 `src/pure/installScript.ts` 现有映射）。
2. webview 占位符按 hostOs 二选一：mac 保持 ⌘Enter，win/linux 用 Ctrl+Enter；两条文案都进 `l10n/bundle.l10n.json` 与 `bundle.l10n.zh-cn.json`。
3. 平台→符号的映射做成纯函数（如 `steerShortcutLabel(os)`）放 `src/pure/`，单测覆盖三平台分支——win/linux 文案无真机也可单测验证。
4. mac 下文案不变，现有测试期望（`test/ui/scenarios.js` 约 1026 行、`test/sandbox/verify.composer-ghost-after-send.ledger.json`）不受影响。

## 涉及代码位置

- `src/ui/chat/webview.ts`：占位符（约 6634）、按键处理（约 6892）
- `src/ui/chatTab.ts`：EMPTY_STATE 已有 hostOs 写法可参照（约 625 行）；正常 state 构建处补 hostOs
- `src/pure/installScript.ts`：`hostOsFromPlatform`
- `l10n/bundle.l10n.json`、`l10n/bundle.l10n.zh-cn.json`：新增 Ctrl+Enter 变体文案

## 变更记录

- 2026-09-08 用户要求排查平台差异化文案后记录：建条目（open/）
- 2026-09-08 认领（worktree: agent/steer-shortcut-copy-per-platform）→ doing
- 2026-09-08 开发完成，自测通过（typecheck + 568 单测 + build + check-i18n + 沙盒报告 4 项全 pass：F-01 运行中占位符 Linux 容器真实命中 Ctrl+Enter 分支，报告 test/sandbox/verify.steer-shortcut-copy-per-platform.report.html）→ done
- 2026-09-08 主线合入测试通过（dev-merge 复测 + dist 重建），用户直接确认合入 → closed
