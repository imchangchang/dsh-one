# 批量归档 session（未分组走统一多选，不特殊处理）

记录于 2026-09-02。需求：Sessions 面板支持批量选择 session 后一次性归档；最初设想「未分组组右键一键归档整组」，2026-09-02 用户确认：统一多选方案天然覆盖（未分组组头复选框全选 → 顶部「归档选中」），未分组不特殊处理。

## 现状

- 归档只有会话行右键/⋯ 菜单里的单项「Archive session」：`src/ui/sessionsWebview.ts` `buildSessionMenuBody`（~968 行），运行中/未读/待处理的会话置灰禁用；消息走 `sessionArchive` → `src/ui/sessionsView.ts` `onMessage`（381 行）→ `dshOne.session.archive` 命令（`src/extension.ts` 203 行，`vscode.window.showWarningMessage` modal 确认 + `archiveSession` RPC）。
- 工作区组头（含「未分组」虚拟组）没有右键菜单：`renderWorkspaceGroup`（`src/ui/sessionsWebview.ts` 665 行起）组头只有 hover 快捷 action（未分组仅「新建未分组会话」；真实工作区另有打开终端/打开文件夹/移除列表），无 contextmenu 绑定。
- 面板没有多选机制：树只支持单行点击/右键，无 checkbox 或多选状态。
- 服务端只有单条归档 RPC：`src/server/dshRpc.ts` `archiveSession`（188 行，`workspace.archiveSession`）。

## 方案（已确认）

### 多选模式

- 入口：会话行右键菜单加「选择多个」；点行 = 勾选/取消勾选，展开/折叠工作区仍可用。
- 模式中行内 hover 按钮（⋯ 菜单、pin、未读）全部隐藏，attached 行的行内改名禁用，防误触。
- 顶部操作条：出现在搜索框下方、第一个工作区上方，含「归档选中的 N 个 session」和「取消」（退出多选模式并清空勾选，清空后按钮条消失）。
- 勾选状态是 webview 临时 UI 状态（模块级变量），不持久化；模态切换/刷新重建树时恢复，退出即清。

### 复选框与三态

- 会话行前复选框；工作区组头前复选框三态：全选（组内全部选中）/ 半选（部分选中）/ 空。
- 勾选组头 = 全选该组 session，再点清空；全选只作用于 session，工作区本身不是归档实体。
- 搜索态下组头全选只作用于当前筛选可见的 session，组头标注「当前筛选结果」。
- 不可归档（运行中/未读/待处理）的复选框置灰 + tooltip，与单项归档禁用规则一致；组头全选只按可勾选的计入。

### 确认与执行

- 点「归档选中的 N 个」→ webview 内 modal 确认框（`vscode.window` 弹窗 API 放不了树形富内容，只能做面板内弹层）：按工作区树形展示所有选中 session，多工作区分组；数量过多时整体折叠到组级，可展开；弹层 `max-height` 限制，超长内滚动，不超屏幕。
- 确认后循环调 `workspace.archiveSession`；成功刷新列表并关闭对应 chat tab（沿用 `chatView.closeSession`）；部分失败列出失败项提示。
- 未分组不特殊处理：未分组组头同真实工作区一样有复选框，多选模式勾选它 → 顶部「归档选中的 N 个」即完成整组归档；不加未分组专属右键入口。

## 涉及代码位置

- `src/ui/sessionsWebview.ts`：`buildSessionMenuBody`（加「选择多个」）、`renderWorkspaceGroup`（组头复选框 + 右键菜单）、顶部操作条、确认 modal、多选状态。
- `src/ui/sessionsView.ts`：`onMessage` 增加多选/批量归档消息分支。
- `src/extension.ts`：`dshOne.session.archive`（单项），可加批量命令或循环复用。
- `src/server/dshRpc.ts`：`archiveSession` 单条 RPC（批量循环调用）。
- `src/pure/chatContract.ts`：`FromWebviewMessage` 增批量归档等消息类型。

## 变更记录

- 2026-09-02 提出需求 → open
- 2026-09-02 与用户确认交互方案（多选模式、三态复选框、确认框形态、取消按钮=退出模式）
- 2026-09-02 确认未分组不特殊处理：组头复选框 + 顶部归档按钮即覆盖，去掉未分组右键专属入口

- 2026-09-02 认领 → doing（worktree: agent/session-batch-archive）

- 2026-09-02 开发完成，自测通过（typecheck/test/build + 视觉场景截图核对）→ done

- 2026-09-02 补充：组头全选语义收紧（有置灰项只能半选）+ 点组头不可全选时飘提示

- 2026-09-02 主线合入（90e5ff9）+ 人工 dev-ui-test 验收通过 → closed
