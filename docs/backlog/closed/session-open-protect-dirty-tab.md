# 点击其他 session 时保护有未发送内容的 tab（dirty tab 不覆盖，改开新 tab）

记录于 2026-09-XX。用户反馈：新建 session 的 tab 里已输入未发送内容，点击侧栏其他 session 时当前 tab 内容被替换（覆盖），输入的内容丢失/被顶掉。用户期望：**当前活动 chat tab 有未发送内容时，点击其他 session 应新开一个 tab，而不是覆盖当前 tab**（等价 VS Code 中 dirty 编辑器 tab 不被 preview 复用的行为）。

## 背景与现象

- 侧栏点击未打开的 session → `dshOne.session.open` → `openSession()` 默认在当前活动 chat tab 打开（`replaceTabSession` → `replaceWith`），活动 tab 的会话与输入被整体换掉。
- 草稿本身有按 session 的内存归档（见 closed 的 `composer-draft-per-session`）：同一 webview 内切走再切回草稿可恢复；但覆盖正在编辑的 tab 违背用户心智模型，且存在真实丢失路径：
  1. 空态 tab（未附着任何会话，`stagedForSession === null`）切换时草稿不存档（`webview.ts` 的 `if (stagedForSession !== null)`），必丢；
  2. tab 被关闭 / 扩展重启 / 窗口重载后，内存归档全部蒸发（未持久化）；
  3. 正在编辑的 tab 被别的内容顶掉，用户无法预期内容去向。

## 现状（已核实）

- `src/ui/chatView.ts` `openSession()`：已有该会话 tab 则聚焦；否则替换活动 tab（焦点不在 chat tab 时替换最近活动 tab）；都没有才新建。
- `src/ui/chatTab.ts` `replaceWith()`：释放旧 controller、清暂存附件、附着新会话。panel/webview 复用，草稿归档靠 webview 内存。
- `src/ui/chat/webview.ts`：`composerDrafts`/`stagedPerSession` 按 sessionId 归档；**无 composer dirty 状态上报宿主的消息**（`FromWebviewMessage` 里没有）。
- 空态 bug：`stagedForSession === null` 时切换会话不存档旧草稿（`if (stagedForSession !== null)`）。

## 建议方案

「当前活动 tab dirty（composer 有未发送文本或附件）→ 点击其他 session 走新 tab；非 dirty → 维持现状复用当前 tab」：

1. webview 侧：composer 文本/附件变化时向宿主上报 dirty 状态（新增 `FromWebviewMessage` 消息，如 `composerDirty { dirty: boolean }`），并按当前附着会话 id 区分；会话切换时宿主侧重算脏位。
2. ChatTabHost 增加 `composerDirty` 字段（webview 上报更新；dirty 属于 tab，不是会话——tab 复用/替换时归零）。
3. `openSession()`：替换目标 tab（活动 tab 或最近活动 tab）若 dirty，改走 `openSessionInNewTab`。
4. 顺带修复空态 tab 草稿不存档 bug（`stagedForSession === null` 时也把旧输入框文本存起来——没有 sessionId 可挂，可存到 `EMPTY_TAB_KEY` 专用槽，或直接修到不丢）。

## 涉及代码位置

- `src/pure/chatContract.ts`：`FromWebviewMessage`（加 composerDirty 消息）。
- `src/ui/chat/webview.ts`：上报 dirty（input/附件变化、send 后、会话切换时）；空态存档修 bug。
- `src/ui/chatTab.ts`：`composerDirty` 字段与 handler（chatMessages.ts 或 tab 内）。
- `src/ui/chatView.ts`：`openSession()` 替换前判断 dirty。

## 变更记录

- 2026-09-XX 需求确认 → open
- 2026-09-XX 认领 → doing
- 2026-09-02 开发完成（worktree agent/session-open-protect-dirty-tab，commit 795a64d/af678a5）：webview 上报 composer 脏位（文本/附件，切换帧强制重报），host openSession 目标 tab 脏位为 true 时改走新 tab；顺带修空态草稿切走不存档。自测 typecheck + 330 tests + build 全绿。→ done
- 2026-09-02 人工 dev-ui-test 验收通过（用户）；主线合入（merge $(git log --format=%h -1 --grep="merge(agent)")），复测 typecheck/330 tests/build 全绿 → closed
