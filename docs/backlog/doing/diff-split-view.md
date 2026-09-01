# diff 视图改成左右分栏（side-by-side）

记录于 2026-09-01。验收 expandable-blocks-polish（diff 折叠）时用户提出的偏好需求。

## 背景与用户偏好

当前 dsh-one 的 diff 块是**行内增删**式（`renderDiff`，老文本行标 `del`、新文本行标 `add`，上下堆叠）。用户表示：**更喜欢左右分栏**（side-by-side，左边老文本、右边新文本，同行对比）这种 diff 视图。

## 现状 / 联系到的已有改动

- `src/ui/chat/webview.ts` `renderDiff(diff, key)`（:2996）：行内 del/add 堆叠 + 前 8 行折叠（前阵子 expandable-blocks-polish 加的展开其余 N 行差异）。
- `block.diff` 只在工具事件视图 `card:'diff'`（`ChatToolBlock.diff` `{oldText,newText}`）时产生，host 侧数据是 oldText/newText 两块——左右分栏的原始数据现成。

## 需求（未确认设计）

把 diff 渲染从「行内 del/add 堆叠 + 折叠」改成**左右分栏**：
- 左栏老文本（oldText）、右栏新文本（newText），行对齐逐行对比；
- 是否保留「前 N 行折叠」逻辑（分栏时默认显示多少行 / 展开其余 N 行差异）；
- 是否保留 toggle、以及分栏下滚动/对齐行为；
- 是否要对照 dsh web 的 diff 视图形态（官方有没有 side-by-side）。

## 待确认

- 交互细节（左右栏是否等高、高亮对齐、行折叠阈值、是否仍要「展开其余」）。
- 是否替换现有行内式，还是两者可切换。

## 涉及代码位置

- `src/ui/chat/webview.ts`（renderDiff / diff 渲染及折叠）
- `src/ui/chatView.ts`（diff CSS）
- 2026-09-01 评审确认：做（用户标注）

- 2026-09-01 认领 → doing（并行开发 session）
