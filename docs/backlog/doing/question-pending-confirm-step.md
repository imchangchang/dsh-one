# 问题弹窗：单选点击选项立即提交，缺明确确认步骤，易误触

记录于 2026-09-01。用户反馈：问题弹窗（pending question 卡）不能点击选项就直接继续，必须先选择、再明确点「确认」，否则容易误触。

## 现象

单问题（`questions.length === 1`）且单选（`multiSelect !== true`）时，pending question 卡里点击任一选项按钮**立即提交答案**，对话直接继续，没有任何二次确认：

- 选项点击：`src/ui/chat/webview.ts` `renderQuestion`（约 2848-2849 行）`if (single) submitAnswer(p)`，注释写着「A lone single-select question answers immediately, Claude Code style.」
- 自定义输入：同一函数里单问题按 Enter 也是直接 `submitAnswer(p)`（约 2869-2872 行）。

只有多问题或多选时才渲染「确认」按钮（`needsConfirm = !single || p.questions.some((q) => q.multiSelect)`，约 2879 行）。

计划评审（plan-review）同受影响：单选「批准」也走 `single` 分支直接提交。

## 根因

早期实现刻意对齐 Claude Code / dsh web 的「点一下即答」交互（源自 commit 20d2d3c 引入的结构化答案编码），没有把「选择」和「确认」分成两步。

## 建议方案

问题弹窗统一两步：点击选项仅选中（标记 `selected`、高亮），底部始终显示「确认」按钮，选中后点「确认」才 `submitAnswer`。Enter 提交自定义输入是否保留可讨论（建议保留 Enter 作为显式动作，或同样收敛到确认按钮）。审批卡（approval）本身已是明确动作按钮（允许一次/拒绝），不在此范围。

## 涉及代码位置

- `src/ui/chat/webview.ts`：`renderQuestion` / `submitAnswer`（2805-2891 行附近）
- `test/ui/scenarios.js`：`question` / `plan-review` 场景的期望描述需同步（现在描述里没有确认按钮）

## 变更记录

- 2026-09-01 记录 → open

- 2026-09-01 认领 → doing
