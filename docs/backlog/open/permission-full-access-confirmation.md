# Full access 权限切换无风险确认门

记录于 2026-09-01。对比 dsh web 聊天面板与 dsh-one 时发现。

## 现象

dsh web 的权限预设菜单（`dsh-client-ui-conversation` `PermissionSelect`，lib/client.js:3241）：Full access 走 **RiskConfirmation 确认门**（先弹风险确认再生效）。

dsh-one（webview.ts:1097-1119 `openPermissionMenu`）：点任意选项立即 `post({type:'setPermission', value})`，Full access 无任何确认。

## 涉及代码位置

- dsh web：`dsh-client-ui-conversation`（PermissionSelect / RiskConfirmation）
- dsh-one：`src/ui/chat/webview.ts`（openPermissionMenu）

## 变更记录

- 2026-09-01 记录 → open
