# harness 样式合流：chat 裸 .empty 规则泄漏到 sessions 空组头

## 背景与现象

`test/ui/harness.html` 加载的 `style.css` 由 `gen-ui-harness.mjs` 把 chat（`chatViewHtml.ts` STYLE）与 sessions（`sessionsView.ts` SESSIONS_STYLE）两套样式合流进一个文件。chat 侧有一条裸 `.empty` 规则（hero 空态：`justify-content: center; text-align: center; flex: 1; flex-direction: column; padding: 24px`），sessions 侧给「无会话的工作区/未分组组头」加的类名也叫 `empty`（`.workspace-row.empty`）——harness 里空组头被 chat 规则命中，渲染成内容垂直堆叠、水平居中的一块（multi-select-exit-and-bar-wrap 任务截图实测复现；`sessions-recycle-drawer` 等既有场景的空未分组组头同样中招）。

真实 VS Code 里 sessions 面板只注入 SESSIONS_STYLE，不受影响——**这是 harness 环境 artifact，不是产品 bug**，但它让「空组头」类场景在 harness 下截图失真，容易误判。

## 建议方案（想法：未确认）

二选一：

1. `gen-ui-harness.mjs` 按 view 拆两份样式文件（chat / sessions 各加载各的），与真实面板一致；
2. 或把 chat 的裸 `.empty` 改名/限定作用域（如 `.chat-empty`），sessions 侧 `.workspace-row.empty` 语义不变。

方案 1 更贴近真实环境，但要动 harness.html 的样式加载与 ui-visual.sh 假设，影响面在测试基建。

## 涉及代码位置

- `scripts/gen-ui-harness.mjs`（样式合流）
- `src/ui/chatViewHtml.ts` 的 `.empty`（STYLE 内）
- `src/ui/sessionsWebview.ts` `renderWorkspaceGroup`（空组头加 `empty` 类，约 :1443）

## 变更记录

- 提出并定位（multi-select-exit-and-bar-wrap 任务中实测发现，确认为 harness-only artifact）。
