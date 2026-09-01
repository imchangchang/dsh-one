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
- 2026-09-01 开发完成，自测通过（typecheck + 263 tests + build 全绿，dev-finish 打 done 标记）→ done

## 开发完成

**设计决策（用户问题帧确认）**：保留折叠（每栏默认前 8 行对 + 「展开其余 N 行差异」toggle）、LCS 逐行对齐、左右栏同一滚动容器（同步滚动）、直接替换行内式（不保留切换）。dsh web 官方 DiffBlock 是行内式折叠、无 side-by-side，故不对照官方形态。

**改动内容**：
- 新增 `src/pure/diffAlign.ts`：`alignDiffLines(oldText, newText)` 产出行对序列（kind: equal/modify/del/add），LCS 回溯 + del/add 块配对成 modify；行数乘积超 100 万（约 1000×1000 行）时退化为行号对齐，防大 diff 卡渲染。空文本视为无行（不渲染悬空增删行）。
- `webview.ts` `renderDiff` 重写：两列 grid 逐行对齐渲染（左 old 右 new），修改行左右同排红/绿、纯增删行单侧着色 + 对侧灰空位、相同行不着色；折叠/展开逻辑与 detailsOpen 持久化机制不变。
- `chatView.ts` diff CSS：`.diff-row` grid 两列、`.diff-cell.old` 竖分隔线、del/add/empty 背景色。
- 场景：`test/ui/scenarios.js` 新增 `diff-side-by-side`（折叠态，入 BASELINE_SCENARIOS）与 `diff-side-by-side-open`（展开态）；`test/diffAlign.test.ts` 10 条单测。

**人工验收方法（dev-ui-test）**：
```
cd /Users/cgeng/Workspaces/dsh-one/.worktrees/diff-split-view && bash /Users/cgeng/Workspaces/dsh-one/scripts/dev-ui-test.sh
```
在隔离 VSCode 里发起一次会产出 diff 卡的工具调用（如 edit 工具改文件），检查：
1. diff 卡是左右分栏（左老文本、右新文本），修改行左右同排、左红右绿，纯增删行单侧着色 + 对侧灰空位；
2. 默认只显示前 8 行对，尾部有「… 展开其余 N 行差异」提示，点击展开全部、再次点击收起，状态在流式重建后保持；
3. 两栏之间有竖分隔线，左右行水平对齐（滚动是整块随页面滚动）。
也可用 ui-visual 场景快速看：`scripts/ui-visual.sh` 后读 `/tmp/dsh-ui-shots/diff-side-by-side*.png`（需 image-capable 模型）。
