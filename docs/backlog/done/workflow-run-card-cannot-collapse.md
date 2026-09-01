# workflow 运行卡无法折叠（点击不生效）

记录于 2026-09-01。验收 workflow-running-member-spin-icon（转圈图标）时在运行中的 workflow 卡上发现。

## 现象

一个**正在运行**的 workflow 卡（如 `demo-microservices-check-2`，含 `服务检查` phase 及多个 running 成员）点击头部（chevron）无法折叠，卡片保持展开，用户收不起来。

## 现状 / 候选根因

- `src/ui/chat/webview.ts` `renderWorkflowRun`(:2565) / `renderWorkflowRunHeader`(:2590) / `renderWorkflowPhase`(:2617)：
  - header 的 click 只 `workflowDisclosure.set(key, toggleWorkflowDisclosure(...))`（:2596、:2626），**没有触发立即重渲染**。DOM 等到下一个 snapshot（新事件 emit）才按新状态重画。
  - 运行中且事件稀疏/停顿的卡，点了看起来就像"没反应"，要等下次事件才折叠；若整个 run 已停（无新事件），可能一直无法折叠。
- `src/pure/workflowRun.ts` `advanceWorkflowDisclosure`(:143)：运行中（mode=running）facts 不变时返回 `prev`，理论上会保留用户手动 toggle——所以状态机本身不太可能是"强制展开"的元凶，问题更可能在"点了不重渲染"。

## 需要进一步确认

- 是否也影响已完成的卡（terminal 状态）——若终态也不能折叠，则是渲染/click 接线问题；若只有运行中卡如是，则无重渲染路径更明显。
- 官方 dsh web 的 DisclosureRow 点击后是否立即重渲染（对照是否应显式触发一次重画）。

## 根因确认（2026-09-01 开发）

**根因**：`renderWorkflowRunHeader`(:2417) / `renderWorkflowPhase`(:2447) 的 click 处理器只
`workflowDisclosure.set(...)` 更新披露 Map，**没有调用 `render()`**。DOM 要等下一个
`state` snapshot（新事件 emit）才按新状态重画。

- **待确认项 1（终态卡）**：**受影响**。两个 click 处理器与 run 状态无关，运行中卡和
  终态（failed/abnormal，默认展开）卡点击后都不折叠；终态卡更糟——run 已 end 不再有
  新 snapshot，点了永远收不起来。
- **待确认项 2（官方 DisclosureRow）**：官方 `WorkflowRunPanel` 用 React state
  `setDisclosures`（`toggleRun`/`togglePhase`），点击即重渲染。dsh-one 是 vanilla DOM
  渲染器，应在 click 后显式同步触发一次 `render()`。
- `advanceWorkflowDisclosure` 状态机**非元凶**：facts 不变时返回 prev，保留用户手动
  toggle（test/workflowRun.test.ts「运行中保持用户选择」覆盖），已保持不动。

**修复**：run/phase 两个 click 处理器在更新披露状态后调用 `render()`（webview.ts）。

## 涉及代码位置

- `src/ui/chat/webview.ts`（renderWorkflowRun / Header / Phase 的 click 接线、是否缺显式重渲染）
- `src/pure/workflowRun.ts`（advanceWorkflowDisclosure 状态机，若需调整）

- 2026-09-01 认领（worktree: agent/workflow-run-card-cannot-collapse）→ doing
- 2026-09-01 根因确认：click 未触发重渲染（运行中 & 终态卡均受影响；官方用 React setState 点击即重渲染）；修复 = click 后同步 render()。开发完成 → done
