# 批量归档 session；未分组组右键一键归档整组

记录于 2026-09-02。需求两条：① Sessions 面板支持批量选择 session 后一次性归档；② 「未分组」工作区组点右键，可以选择归档该组内所有 session。

## 现状

- 归档只有会话行右键/⋯ 菜单里的单项「Archive session」：`src/ui/sessionsWebview.ts` `buildSessionMenuBody`（~968 行），运行中/未读/待处理的会话置灰禁用；消息走 `sessionArchive` → `src/ui/sessionsView.ts` `onMessage`（381 行）→ `dshOne.session.archive` 命令（`src/extension.ts` 203 行，确认框 + `archiveSession` RPC）。
- 工作区组头（含「未分组」虚拟组）没有右键菜单：`renderWorkspaceGroup`（`src/ui/sessionsWebview.ts` 665 行起）组头只有 hover 快捷 action（未分组仅「新建未分组会话」；真实工作区另有打开终端/打开文件夹/移除列表），无 contextmenu 绑定。
- 面板没有多选机制：树只支持单行点击/右键，无 checkbox 或多选状态。

## 建议方案

- 组头加 contextmenu popover（沿用现有菜单风格），未分组组加「归档组内全部 session」；批量时对每个 session 逐个调 `workspace.archiveSession`（服务端目前只有单条 RPC：`src/server/dshRpc.ts` `archiveSession`，188 行；无批量端点，或循环或加批量）。
- 多选批量归档：倾向复选框模式（滚动树里做 range 多选复杂），选中后出「归档选中」入口；禁用规则沿用单项（运行中/未读/待处理不参与或提示跳过）。

## 涉及代码位置

- `src/ui/sessionsWebview.ts`：`buildSessionMenuBody`（菜单构建）、`renderWorkspaceGroup`（组头）、消息 post。
- `src/ui/sessionsView.ts`：`onMessage` 加批量归档消息分支。
- `src/extension.ts`：`dshOne.session.archive`（单项命令），可加批量命令。
- `src/server/dshRpc.ts`：`archiveSession` 单条 RPC。
- `src/pure/chatContract.ts`：`FromWebviewMessage` 增批量归档消息类型。

## 想法：未确认

- 多选交互形态（复选框 vs Ctrl/Shift 多选）、批量入口位置、含运行中/未读/待处理会话时的处理策略（跳过还是整批禁用）未确认。

## 变更记录

- 2026-09-02 提出需求 → open
