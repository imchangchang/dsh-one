# commit 悬浮卡在流式输出期间跳动（帧帧关→开）

## 背景与现象

助手输出中悬停消息文本里的 commit hash chip，弹出的 commit 详情卡（仿 VS Code
historyItem hover 卡）一直「跳动」：流式每帧重建该行时卡片闪关、随后又被重开。

## 根因

消息流增量对账（reconcileFlow，webview.ts）按消息 JSON 签名决定行是否重建：
流式期间内容每帧都变 → 含 chip 的行每帧「先插新行再删旧行」。旧 chip（悬浮卡锚点）
随旧行摘除而断开，render 的存活检查（webview.ts ~2993，`popoverAnchor.isConnected`
判断）在重建前跑过、下一帧才见锚点已断开 → `closePopover()`；新行插入后浏览器的
hover 更新又对新 chip 触发 mouseenter → `onCommitHashHover` 重新 `showPopover`。
每帧重复「关→重开」，视觉上就是卡片跳动；若新 chip 因内容增长已不处于指针下，
卡片则直接闪没。

## 建议方案

行重建之后（reconcileFlow 返回处）对已打开的 commit 卡做一次重锚：按原锚点的
sha（限同 flow 行，防同 sha 在多条消息并存时锚错行）在新 DOM 里找替代 chip，
找到 → 换锚并重定位（卡片原位跟随流式增长，不闪关闪开）；找不到 → 才关闭。
非 commit 卡锚点（header chip 菜单等）维持现有存活检查不变。

## 涉及代码位置

- `src/ui/chat/webview.ts`：`onCommitHashHover` / `commitHashEl`（约 946-1007）、
  render 尾部弹层存活检查（约 2993）、`reconcileFlow` 调用处（约 3255）。

## 变更记录

- 2026-09-07 问题记录（open）：现象截图（流式中 commit 卡悬浮在聊天记录上、底栏
  仍在 Deep diving）；根因如上；方案与涉及位置如上。
- 2026-09-07 认领（open -> doing）：worktree 开发（分支 agent/commit-card-jumps-during-streaming）。
- 2026-09-07 开发完成（doing -> done）：worktree 开发（分支 agent/commit-card-jumps-during-streaming）。
  修复：流式行重建后按同身份重锚已打开弹层（commit chip 按 sha 限同 flow 行；token 用量药丸同
  机制；dshNotFound 空态安装脚本菜单同机制），card 被摘除时鼠标判定（elementFromPoint 仍会有
  chip 在指针下）不排延迟关闭；同类排查另覆盖 ref hover（已有缓存恢复）、header/composer/hero
  菜单（已有保活）。测试：mock-llm 新增 deltaDelayMs 慢速规则与单测；verify-driver 新增
  hoverSustainMs；test/ui 新增 commit-card-stays-during-streaming 场景（无修复复现卡片闪关，
  修复后三帧重建仍在位）；沙盒报告（F-01 慢速流式悬停 4s 持续在位 + R-01~R-03 回归）全部 pass，
  报告 .worktrees/commit-card-jumps-during-streaming/test/sandbox/verify.commit-card-jumps-during-streaming.report.html；
  typecheck/test（540 项，含新增 3 项）/build 全过。done 标记 2e8106a。
