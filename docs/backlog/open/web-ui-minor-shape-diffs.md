# 低优先形态差异汇总（对齐 dsh web 时的可选打磨）

记录于 2026-09-01。对比 dsh web 聊天面板与 dsh-one 时发现，属于形态/体验差异，非功能缺口，统一记此处：

1. **上下文用量形状**：web 是发送键旁**圆环**（`conversation` `ContextMeter`，lib/client.js:3065），dsh-one 是横条（`contextBar` webview.ts:975）；弹层面板内容基本对齐。
2. **`/` `@` 触发浮层**：web 是 `role="listbox"` + 图标 + 分组 + loading 行（`dsh-client-ui-input-trigger` `MenuView` :760-836）；dsh-one 是简单 div 菜单（`updateSlashPopup` webview.ts:749-784），且 `@` 候选只有文件/会话两组（web 还有子智能体/技能分组 + kind 图标）。
3. **子代理只读 composer 框架**：web 有独立 `SubagentReadOnlyComposer` 边框 + role=status 提示（`dsh-client-ui-subagent` :699-706）；dsh-one 只置灰 + placeholder。
4. **前端设置弹层**：web 是浏览器侧 `sidebar.settings` modal（`dsh-client-ui-settings*`），不在聊天面板；dsh-one 为 VS Code 扩展刻意不做 —— 仅记录，不作为实现目标。

## 涉及代码位置

- dsh web：`dsh-client-ui-conversation`（ContextMeter）、`dsh-client-ui-input-trigger`、`dsh-client-ui-subagent`、`dsh-client-ui-settings*`
- dsh-one：`src/ui/chat/webview.ts`（contextBar / updateSlashPopup / renderInput）

## 变更记录

- 2026-09-01 记录 → open
