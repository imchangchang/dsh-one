# 多选操作后退出多选模式 + 操作条按钮折行修复

## 背景与现象

Sessions 面板多选模式下两个问题（用户实测反馈）：

1. 点击「移入回收站」后会话已从主列表消失，但仍停留在多选状态，像没生效；批量归档全部成功时会退出，部分失败时故意保留失败项勾选（原设计"失败保留可重试"），用户期望统一为「点击之后直接退出多选状态」。
2. 多选操作条（.selection-bar）三个文本按钮在 300px 侧栏放不下：中文「将选中的 N 个移入回收站」+「归档选中的 N 个会话」+「取消」约 346px，CSS 未设 `white-space: nowrap`，flex 收缩把两个长按钮压窄、文字在按钮内部折成短行，不好看。

## 根因

1. `buildSelectionBar` 的移入回收站 click 只 post `sessionMoveToRecycleMany` + flashTip，未调 `exitSelectionMode()`；`onArchiveManyDone` 失败分支保留勾选重试。
2. `.selection-bar button` 无 nowrap（`src/ui/sessionsView.ts`），同文件 `.recycle-header button` 已有 nowrap 先例且注释写明「300px 侧栏一行放不下三个文本按钮」。

## 建议方案（已与用户确认）

1. 移入回收站点击 post 后直接 `exitSelectionMode()`（flashTip 挂 body、坐标已算好，操作条消失不影响其飘完 2.2s）。
2. 批量归档无论成败都退出多选（失败时宿主已弹错误提示，会话仍在列表可重选）。
3. 操作条按钮缩短文案为「回收站 (N)」「归档 (N)」/「Recycle bin (N)」「Archive (N)」+ `white-space: nowrap`（约 260px 可一行放下）。
4. 同步更新 `test/ui/scenarios.js` 多选场景期望描述（原含「Archive 3 selected」字样）。

## 涉及代码位置

- `src/ui/sessionsWebview.ts`：`buildSelectionBar`（约 :2221）、`onArchiveManyDone`（约 :2397）
- `src/ui/sessionsView.ts`：`.selection-bar` CSS（约 :76）
- `l10n/bundle.l10n.json` / `l10n/bundle.l10n.zh-cn.json`：按钮文案
- `test/ui/scenarios.js`：多选场景期望

## 变更记录

- 提出并核实根因，方案经用户确认（移入/归档都直接退多选 + 短文案方案）。
- 认领，开 worktree 开发。
- 开发完成：worktree agent/multi-select-exit-and-bar-wrap，done 标记 8471dc7；测试报告 test/sandbox/verify.multi-select-exit-and-bar-wrap.report.html（worktree 内，6 项全 pass），待主线审查合入。
