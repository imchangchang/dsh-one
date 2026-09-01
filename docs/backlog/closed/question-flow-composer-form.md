# 用户问答/审批位置与形态不同（web 是 composer 接管）

记录于 2026-09-01。对比 dsh web 聊天面板与 dsh-one 时发现。

## 现象

dsh web 的用户问答/审批接管 **composer**（`dsh-client-ui-user-questions` `QuestionFlow`，lib/client.js:360-662，注册 `conversation.composer`）：

- QuestionFlow：header 最小化/最大化、分页器「1/N」、跳过本题、提交。
- PlanReviewPanel（:153-230）：warn strip「计划待审」+ 计划 Markdown + **确认执行/拒绝/去聊天里说**三分结构。

dsh-one 渲染为**消息流内 pending 卡**（webview.ts:2721 renderApproval / :2789 renderQuestion）：

- 多题一次排开，无「1/N」分页、无最小化/最大化、无跳过本题。
- plan-review 只把 approve 选项渲染为主按钮（webview.ts:2824 `isApprove`），无「确认执行/拒绝/去聊天里说」三分结构，也无 warn strip。

## 涉及代码位置

- dsh web：`dsh-client-ui-user-questions`（QuestionFlow / PlanReviewPanel）
- dsh-one：`src/ui/chat/webview.ts`（renderApproval / renderQuestion / pending 区）

## 变更记录

- 2026-09-01 记录 → open
- 2026-09-01 评审确认：做（用户标注）

- 2026-09-01 认领 → doing（并行开发 session）
- 2026-09-01 开发完成，自测通过（typecheck + 253 tests + build 全绿；视觉场景 DOM 断言全过）→ done
  - 决策（用户确认）：整体替换消息流 pending 卡（pending 时输入区整个被面板接管，普通 composer 不显示）；分页/最小化/跳过/三分结构全做；「去聊天里说」= 面板最小化 + 聚焦回答输入行，Enter 提交为自定义回答。
  - 实现（分支 agent/question-flow-composer-form，commit 0906c3c）：
    - `webview.ts`：pending 存在时 `renderPendingPanel` 渲染在 composer 位置（.pending-panel），消息流尾部不再出 pending 卡；approval / question（分页 1/N + 跳过本题 + 提交）/ plan-review（warn strip + 计划 Markdown 全文 + 确认执行/拒绝/去聊天里说）三形态；header 最小化/最大化 + 最小化态回答输入行；保活签名含面板本地状态（分页/最小化），面板兼作 add() anchor。
    - `chatView.ts`：面板 CSS（.pending-panel/.pending-block/.panel-header/.plan-warn/.panel-answer 等）。
    - `test/ui/scenarios.js`：更新 approval/question/plan-review 期望，新增 question-multi（分页）/question-page2/question-minimized/plan-review-chat 场景。
  - 人工验收（真实 VSCode dev-ui-test）：
    1. `cd <repo-root>/.worktrees/question-flow-composer-form && bash <repo-root>/scripts/dev-ui-test.sh`
    2. 弹会话里触发权限审批（如 bash 执行）→ 输入区显示「权限请求」面板（工具名 + 原因 + 允许一次/拒绝），消息流尾部无 pending 卡，composer 输入框消失；点右上 chevron 可最小化/还原。
    3. 触发多题 AskUser（≥2 题）→ 面板 header 出现「‹ 1/2 ›」分页器，只显示当前题；「跳过本题」跳到下一题；选完答案后「提交」可点，提交后对话继续。
    4. 触发 plan-review（计划评审）→ 黄色警示条「计划待审」+ 计划全文展开 + 「批准/拒绝/去聊天里说」三按钮；点「去聊天里说」→ 面板收起、输入框聚焦，输入文字回车提交为自定义回答。
    5. 回归：无 pending 时 composer 正常；流式输出期间面板输入不被快照打断（打字不丢焦点/IME）。
- 2026-09-01 主线合入测试通过（merge d68101a，263 tests 全绿），人工 dev-ui-test 验收通过 → closed
