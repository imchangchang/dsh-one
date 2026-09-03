# 多问题卡片第一页即可提交整组，后续问题被静默遗漏

## 背景与现象

dsh-one 插件 webview 的 ask_user_question 卡片（多个 questions 时）在**第一页**底部就有「提交」按钮：点选第一题选项后提交立即可点，点击即把整组 answers 发给后端——未答的题全部以 `selected: []` 空答案发出，后端 `dsh-user-questions` 不校验每题必答，后续问题被静默跳过，agent 拿到的是空答案。

对照 dsh web（`@deepseek-ai/dsh` 0.1.1-rc.2 的 `QuestionComposer` / `QuestionFlow`）：主按钮随题号切换——非最后一题显示「下一题」、最后一题才显示「提交」；当前题未答时主按钮不可点；提交前校验所有题完成，有缺项跳回该题并提示（`submitDrafts` 的 `missing` 逻辑）。

本文件中注释声称「对齐 dsh web QuestionFlow」，但只对齐了 pager 和跳过按钮，主按钮没对齐。

## 根因

`src/ui/chat/webview.ts`：

- `renderQuestionPanel`（约 5170 行）：底部主按钮恒为 `t('Submit')`，与当前页无关；`hasAnswer()` 检查「任一题有答案」而非「当前页有答案」，所以第一页答完即可点提交。
- 提交路径 `submitAnswer`（约 5154 行）：把整组 answers 直接发送，无「所有题已答/已跳过」校验。
- 跳过本题（`renderQuestionPanel` 内 skip）只清当前页草稿并翻页，无跳过标记，提交校验无法区分「跳过」与「未答」。
- pager（`questionPager`，5055 行）挂在 `panelHeader`（5037 行，标题右侧），仅有 ‹ › 翻页，无文案/状态切换，主按钮是唯一「确认继续」入口。

## 建议方案

对齐 dsh web QuestionFlow：

1. 主按钮按当前页切换：`page < n-1` 显示「Next question」并翻页；`page === n-1` 显示「Submit」并提交整组。
2. disabled 条件从「任一题有答案」收紧为「**当前页**有答案」。
3. `panelState` 增加 skipped 集合（question index 集合），跳过本题时加入；提交校验时「已答或已跳过」视为完成。
4. `submitAnswer`（含最小化态「去聊天里说」路径）统一校验所有题完成：有缺失则跳回第一道未完成题、展开面板并提示「请先完成这道问题。」，不发送。
5. l10n 新增 key：`Next question`（英文基线 + zh-cn `下一题`）、`Please complete this question first.`（zh-cn `请先完成这道问题。`）。

注：dsh web 自身中文字典缺 `submit`/`submitting` 键（最后一道题按钮显示英文 `submit`），属上游问题，不在本条目范围。

## 涉及位置

- `src/ui/chat/webview.ts`（renderQuestionPanel / submitAnswer / questionPager / panelState）
- `l10n/bundle.l10n.json`、`l10n/bundle.l10n.zh-cn.json`
- `src/ui/chatViewHtml.ts`（提示行样式，若需要）

## 变更记录

- 2026-09-08 核实（现象属实：dsh-one 插件卡片；dsh web 已是建议行为）→ open
- 2026-09-08 认领（worktree: agent/question-card-paged-submit）→ doing
