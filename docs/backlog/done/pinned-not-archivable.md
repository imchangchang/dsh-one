# 置顶会话不能被归档（未来删除同样保护）

## 背景与现象

置顶的会话现在可以被归档：菜单「归档会话」不置灰，批量多选/组头全选也能勾上置顶会话。用户需求：置顶会话不能被归档，避免有用的会话被误归档（未来如果增加删除，也避免被误删除）。

置顶 = "重要、置前可见"，归档 = "从列表隐藏"，两者语义直接冲突——置顶会话归档后从列表消失，用户视角是"我置顶的会话怎么没了"。

## 现状（已核实）

- 置顶是纯客户端状态：`sessions.pinned` 存 extension workspaceState，dsh 无置顶 API。
- 归档调 `workspace.archiveSession`（`src/server/dshRpc.ts`），只标记不删、dsh 侧可逆，但**插件内没有恢复入口**（无 unarchive），误归档只能去 dsh web 恢复——误归档的实际代价比字面大。
- 当前归档禁用条件：运行中 / 未读 / 待处理（`src/ui/sessionsWebview.ts` 的 `sessionSelectable` / `sessionSelectTip`），置顶不在禁用条件里。
- 归档后果：从 sessions 列表隐藏（`sessionTree.ts` 过滤 archivedSessionIds），已打开的聊天 tab 被关闭（`extension.ts` 归档命令里 `chatView.closeSession`）。
- 置顶 id 归档后残留在 `pinned` 数组（排序时忽略不存在的 id，无害脏数据）。

## 建议方案（session 内已确认）

置顶会话归档路径全部封死，参照现有 running/unread 禁用模式：

1. **UI 置灰**（用户可见保护）：
   - 批量多选：`sessionSelectable` / `sessionSelectTip` 增加置顶条件，行/组头复选框置灰，悬停提示「置顶会话不能归档，先取消置顶」；组头全选提示沿用现有「N 个会话不能归档」框架。
   - 单项菜单：`sessionsWebview.ts` 和 `chat/webview.ts` 两处「归档会话」菜单同样置灰 + 提示。
2. **host 命令层兜底**（防绕过 UI）：`dshOne.session.archive` / `archiveMany`（`src/extension.ts`）执行前查 `sessions.snapshot().pinned`，命中则拒绝（单项弹提示 / 批量计入 failed 回传）。两个 webview 菜单最后都走这两个命令，一处兜底两端生效。
3. **不强制取消置顶**：归档入口只提示"先取消置顶"，不做"归档时自动取消置顶"（违背不让归档的意图，也避免静默改状态）。

### 延伸（未来删除功能实现时一并做）

- 删除入口同样保护置顶会话：置顶不能被删除（删除比归档更难恢复/不可逆）。
- 届时置顶 id 残留问题随删除一起处理（如删除后清 pinned、清理无效 id）。

### 延伸（回收站功能，见 `recycle-bin`）

- 置顶会话同样**不能移入回收站**：回收站清空 = 归档，置顶入站等于绕过本条的保护。移入（行菜单/多选）与归档共用同一 host 层防线校验，两条目实现时一并处理。

### 边界

- 不做归档自动取消置顶的软方案。
- 不清理现有已归档会话残留的置顶 id（无害脏数据）。

## 涉及代码位置

- `src/ui/sessionsWebview.ts`：`sessionSelectable` / `sessionSelectTip`（~1065-1075）、单项归档菜单（~1413）
- `src/ui/chat/webview.ts`：单项归档菜单（~2439）
- `src/extension.ts`：`dshOne.session.archive`（~210）/ `archiveMany`（~234）命令层拒绝
- `src/ui/sessionsStore.ts`：`snapshot().pinned` 供 host 校验（只读，不改）

## 变更记录

- 2026-09-04 需求提出（用户：置顶标签页不能被归档，避免误归档/未来误删除）；已核实现状（归档仅禁运行中/未读/待处理、插件内无恢复入口、置顶 id 归档后残留）；确认方案（UI 置灰 + host 命令层兜底 + 未来删除同样保护）。未开始开发。
- 2026-09-04 回收站需求（`recycle-bin`）讨论确认：置顶同样不能移入回收站（清空 = 归档，入站会绕过保护），与归档共用 host 层防线。

- 2026-09-04 认领（worktree recycle-bin，与 recycle-bin 一起开发并共用 host 层防线）：开始开发。
- 2026-09-04 开发完成（与 recycle-bin 同 worktree，branch agent/recycle-bin，done tag 8294548）：归档路径全部封死——批量多选 sessionSelectable/sessionSelectTip 增加置顶条件（复选框置灰 + 悬停提示）；sessions 面板行菜单与 chat 头部 ⋯ 菜单「Archive session」两处加入置顶禁用（置灰 + 提示，优先级在 running/unread/pending 前）；extension.ts dshOne.session.archive/archiveMany 命令层兜底（单项命中警告返回、批量计入 failed 回传，两个 webview 菜单同走这两个命令一处兜底两端生效）；延伸（recycle-bin 并行落地）：置顶同样不能移入回收站（行菜单/多选禁用 + sessionsView host 层过滤并提示，同一条防线）。不强制取消置顶、不清理历史残留 id（按方案边界）。自测全绿（typecheck/build/test 429）；沙盒验收 F-07 场景 + 全量 E2E 断言 pass（verify.recycle-bin.report.html）。
