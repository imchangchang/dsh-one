# diff 视图宽度自适应：窄时退化单栏、宽则双栏

记录于 2026-09-02。diff-split-view（一栏改左右分栏）已合入并 closed 后，用户对分栏提出的自适应改进，方案已与用户确认，只记录待实现。

## 背景与现状

diff 卡当前是**固定左右分栏**：`.diff-row` 为两列 `1fr 1fr` grid，左 old 右 new，逐行对齐（见 diff-split-view.md 与 `src/pure/diffAlign.ts`）。问题：chat 面板宽度可被用户拖窄，宽度不够时每列不足 ~200px，长行全部换行，逐行对比失效，纯增/删行的灰空位也占掉一半宽度。

## 需求（2026-09-02 与用户确认的方案）

宽度足够时保持双栏；容器宽度不足时退化为**单栏统一 diff 视图**，复用现有 `alignDiffLines` 行对序列：

- 相同行只显示一遍（不再左右重复）；
- 修改行：old 行（红）在上、new 行（绿）在下；
- 纯删/纯增各显示一行，淡灰空占位隐藏；
- 相邻行对之间留一点间距（常规做法，margin 分隔，让修改行两种状态可分辨）。

## 建议实现

- CSS container query：`.diff` 设 `container-type: inline-size`，断点约 480px，窄容器内由 CSS 切换单栏（隐藏 `.diff-cell.empty`、隐藏相同行的 new cell、行对加间距）。纯 CSS 切换，不重渲染、折叠状态不受影响；VSCode webview（Chromium）完全支持。
- 不改 `alignDiffLines` / `renderDiff` 的数据结构，单栏只调表示层。

## 涉及代码位置

- `src/ui/chat/webview.ts`（renderDiff）
- `src/ui/chatView.ts`（diff CSS：.diff / .diff-row / .diff-cell）

## 变更记录

- 2026-09-02 提出（用户建议 + 方案确认）→ open

- 2026-09-02 认领（Sprint 1 节点，worktree: agent/diff-responsive-layout）→ doing

- 2026-09-02 开发完成（worktree: agent/diff-responsive-layout，commit 79bd1bb）：`.diff` 设 `container-type: inline-size`，窄容器（≤480px）纯 CSS 切单栏——相同行只显一遍、修改行 old 红上/new 绿下、纯增/删灰空占位隐藏、行对加间距；宽容器保持左右分栏。typecheck / test（336 pass）/ build 全过，`done/diff-responsive-layout` 标记已打 → done
