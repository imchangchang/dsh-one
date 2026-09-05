# 回收站入口行（抽屉收起态）加快捷操作：清空全部 / 恢复全部

## 背景与需求

用户提出（2026-09-06）：回收站抽屉折叠收起来的时候（即主列表底部的「回收站 (N)」入口行），希望上面也有快捷操作——清空全部、恢复全部，不用先拉开抽屉再点。

## 现状（已核实）

入口行（`renderRecycleEntry`，`.recycle-entry`）目前只有「垃圾桶图标 + Recycle bin + 计数徽标」，唯一动作是点击整行打开抽屉。清空（垃圾桶图标按钮 + 确认 modal）和恢复全部（`sessionsRestoreAll`）只存在于抽屉头（`renderRecycleHeader`）。

## 方案候选（未定）

1. **入口行右侧加两个图标按钮**（清空 + 恢复全部），与抽屉头同一套图标/逻辑复用；计数为 0 时置灰。300px 侧栏内可放下（图标 + 标签 + 计数 + 两个小图标按钮）。点击按钮不触发打开抽屉（`stopPropagation`）。
2. **悬停才显示**：入口行默认不变，hover 时右侧浮出两个图标按钮，常态更干净。
3. 只加「恢复全部」或只加「清空」其一（若用户其实只常用一个）。

清空仍走现有确认 modal（归档是终点动作，必须确认）；恢复全部无确认（可逆操作的反向，现状抽屉头也是直接执行）。

## 涉及代码位置

- `src/ui/sessionsWebview.ts`：`renderRecycleEntry`（加按钮）、复用 `openRecycleArchiveModal` / `sessionsRestoreAll` 逻辑
- `src/ui/sessionsView.ts`：`.recycle-entry` 布局与按钮样式
- `l10n`：复用现有键（Empty recycle bin / Restore all），无需新增
- `test/ui/scenarios.js`：入口行相关场景期望更新

## 变更记录

- 2026-09-06 用户提出（抽屉收起态也想要清空全部/恢复全部快捷操作）→ 核实现状（入口行无快捷操作，只在抽屉头有）→ 建条目（open/）
- 2026-09-06 认领（worktree: agent/recycle-drawer-polish）→ doing。用户拍板做法：**方案 1——入口行右侧常驻两个图标按钮**（清空 + 恢复全部，计数 0 置灰，点击不触发打开抽屉）。与 recycle-drawer-handle-affordance 同 worktree 开发。
- 2026-09-06 开发完成（worktree recycle-drawer-polish，branch agent/recycle-drawer-polish，done tag da68b6e）：按方案 1 落地——入口行外层 button 改 div（button 不能嵌套），主区 .recycle-entry-main 点击开抽屉，右侧常驻清空（复用 openRecycleArchiveModal 确认链路）/恢复全部（sessionsRestoreAll）两个 .sessions-tool 图标按钮，计数 0 置灰；新增 harness 场景 sessions-recycle-entry-actions / sessions-recycle-handle 并进 BASELINE_SCENARIOS。自测全绿（typecheck/test 588/build）；沙盒验收 ledger 全 pass（verify.recycle-drawer-polish.report.html，F-01/F-02 + R-01..R-03）。
- 2026-09-06 用户追加反馈：清空全部图标（入口行快捷按钮 + 抽屉头）都改成红色 → 已在同 worktree 完成（commit 834d610）：两处清空按钮加 .sessions-tool.danger（color: --vscode-errorForeground），disabled（计数 0）回落灰色；ledger 增 F-05 专项并重渲报告（8 项全 pass），done tag 待随本次提交前移。
