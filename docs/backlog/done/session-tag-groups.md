# 会话标签分组（Chrome 垂直标签式）

## 背景与现象

一个工作区下 session 很多：有被其他 session 派生（fork）出来的，有一些是探索性任务，用户想给它们分类管理。侧栏宽度有限（~300px），分类视觉不能占太多横向空间。

## 方案（已与用户确认）

一个 session 只归属一个组（Chrome 标签分组式单组语义，也符合 todo/doing/done 互斥状态），组是可选标记——未打组的 session 保持原样平铺。

### 数据

- 新纯层 `src/pure/sessionTags.ts`（模式对齐现有 `workspaceGroups.ts`）：
  - `SessionTagDef { id, name, color }`：`color` 为枚举 key（映射 vscode charts 主题色）；预设组 name 走 l10n（存储为 key，渲染时翻译），自定义组 name 为用户命名原文。
  - membership：`sessionId → tagId`（单组）；会话移入回收站/归档后残留不清理（恢复后组归属仍在）。
- 预设组：待办 todo（黄）/ 进行中 doing（蓝）/ 已完成 done（绿），首启自动建好，名称 l10n（中英文），不可改名/删除；颜色复用 dsh 现有状态色语义（待交互黄、运行中蓝、完成绿）。
- 自定义组：用户命名 + 颜色轮询（橙/紫/红…），可改名/改色/删除；删除后组内会话回到未分组。
- 持久化 globalState（键 `sessions.tags` / `sessions.sessionTag`），与现有 workspace 分组同模式。

### 展示（Chrome 垂直标签式）

- 组头小标签 pill：高 16px、字号 10px、组色圆点 + 组名，左缘与缩进列对齐。
- 组内会话行：左缩进 12px（`padding-left` 12→24px），其余行内元素不动。
- 组主题竖线：2px、圆角、组色 ~55% 透明度，从 pill 下沿贯穿到组尾行，收在组内缩进列（不越过工作区行），pointer-events 关闭。
- 组块按组顺序显示在会话区，未分组会话按时间序殿后（用户确认）。
- 搜索态：组继续聚合，组内无匹配的组块不显示；搜索强制展开沿用现有 workspace 逻辑。

### 交互

- 会话行「⋯」/右键菜单 →「移到分组」菜单组：各预设/自定义组 + 新建分组… + 移出分组。
- 拖拽：会话行可拖到组块（含 pill）= 加入该组；拖到未分组区 = 移出分组；拖 pill 调整组顺序（拖拽中画插入位置/高亮）。
- 整组批量操作：组头 pill 右键菜单——归档全部 / 移入回收站 / 移出分组（清空组标记）；归档复用 `dshOne.session.archiveMany`，回收站复用现有 store 批量规则（置顶跳过并提示）。
- 多选模式的批量操作（勾选行、批量归档/回收站）不受影响。

## 涉及代码位置

- `src/pure/sessionTags.ts`（新建）
- `src/pure/sessionTree.ts`（workspace 组内按组聚合排序）
- `src/ui/sessionsStore.ts`（tags 状态 + 持久化 + snapshot）
- `src/ui/sessionsWebview.ts`（组块渲染、拖拽、行菜单、pill 右键菜单）
- `src/ui/sessionsView.ts`（组块 CSS）
- `src/pure/chatContract.ts`（SessionsSnapshot 扩展）
- l10n：`package.nls.json` / `package.nls.zh-cn.json`（预设组名等新增 key）

## 变更记录

- 2026-09-05 用户提出（侧栏 session 分组，Chrome 垂直标签式，先出原型确认）；补充：预设 todo/doing/done 组 + 自定义组、拖拽入组、拖组排序、整组批量归档/移入回收站、预设组名走 l10n → 建条目（open/）

- 2026-09-06 认领（doing）：用户确认方案，开 worktree 开发

- 2026-09-06 开发完成（done）：单测 602 项全过，ai-visual-validation 场景核对通过，沙盒回归通过，dev-finish 打标 done/session-tag-groups → 47010c3，验收报告 test/sandbox/verify.session-tag-groups.report.html
