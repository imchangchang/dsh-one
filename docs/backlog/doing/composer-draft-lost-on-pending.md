# composer 草稿在 pending 卡接管时丢失

## 背景与现象

用户在 composer 输入到一半时，agent 弹出 pending 卡（权限审批 / 出题问答 / 计划评审），整个输入区被面板替换；用户应答后 composer 恢复，之前输入的内容**全部丢失**。用户需求：任何情况（弹卡、切会话、流式重建……）都不能丢已输入草稿。

## 根因（已核实，mock harness 实测复现）

`src/ui/chat/webview.ts` `render()` 取草稿只在**当前帧**从 DOM 读：`const draft = ... oldInput?.value`（约 2363 行）。pending 接管帧把 composer 从 DOM 移除后，没有任何持久化位置存这份文本；pending 期间后续帧 `oldInput` 为 null，`draft` 变 undefined；pending 结束恢复 composer 时 `renderInput(undefined)` → 空输入框。

代码注释（约 2505 行「draft 内容仍保留，pending 结束后恢复普通 composer 时按 draft 还原」）与实际行为不符——是回归。

同一路径还有第二个 bug：pending 帧 `keepComposer` 为 false，渲染尾部（约 3003 行）无条件 `autoGrow(document.getElementById('input'))`，输入框已移除时抛 `Uncaught TypeError: Cannot read properties of null (reading 'style')`，静默中止渲染尾部（焦点恢复、补全弹窗、`reportComposerDirty` 脏位上报警告全部丢失）。错误被吞对用户不可见。

已保护、无需再动的场景：会话切换（composerDrafts/stagedPerSession）、流式重建（DOM 读回）、发送失败/stop（restoreDraft）、↑召回（recallDraft）、队列编辑（queueEditDrafts）、pending 面板内答题草稿（answerDrafts）、goal 编辑（goalDraft）。

## 建议方案

1. pending 接管那帧把 composer 文本（和 recall 态、召回草稿）存入模块级暂存（如 `pendingStash`），pending 结束恢复 composer 时按暂存还原，兼带焦点/光标恢复。
2. autoGrow 调用前判空，或 pending 分支跳过渲染尾部（renderInput 未渲染时不该执行 input 相关收尾）。
3. 补回归场景：test/ui/scenarios.js 加「输入中 pending 到达 → 应答后草稿还在」的交互场景（mock host 需支持注入 pending）。

## 涉及代码位置

- `src/ui/chat/webview.ts`：render()（draft 捕获/keepComposer/pending 分支）、autoGrow 调用点、发送清空/恢复路径
- `src/pure/chatContract.ts`：如新增消息契约（暂存不需要，纯 webview 内）

## 变更记录

- 2026-09-03 用户提出需求（弹卡不丢草稿），核实根因并实测复现 → open

- 2026-09-06 认领（agent/composer-draft-clear，worktree .worktrees/composer-draft-clear）→ doing
