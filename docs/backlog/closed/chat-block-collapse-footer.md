# 折叠块展开后底部缺收起入口（思考 / 工具调用等）

## 背景与现象

用户反馈对话栏里「思考」「工具调用」这类展开块：摘要行点击展开成很大的文字框后，想收起只能点回顶部的摘要行（summary）。内容很长时人已滚到文字底部，要拽回顶部才能收起，不方便。

## 现状

可展开块都是 `<details>`：`src/ui/chat/webview.ts` 里 `detailsEl()` 工厂 + 若干处 `el('details')`（reasoning 思考块、tool-disclosure 工具卡、command-detail、compaction、retry-row、context、question-detail 等）。原生 details 只有 summary 可点，收起入口唯一。

## 方案

展开时在 details 内容底部追加一个小「收起」按钮（点击 `det.open = false`，样式对齐现有 `.md-code-toggle` / `.tool-output-toggle` 的小灰字按钮观感）；顶部 summary 本来就能点，这样顶、底两端都能折叠。由统一 helper 挂到所有「详情展开」类块上，避免逐块重复逻辑。

- 「收起」文案复用现有 l10n key `Collapse`（zh-cn 已有译文「收起」）。
- 展开态恢复（detailsOpen 持久化、流式重建）时按钮同步恢复：toggle 事件 + 创建时按 `det.open` 立即补齐。

## 涉及代码位置（待核实）

- `src/ui/chat/webview.ts`：`detailsEl()` 工厂（line ≈4365）与各 `el('details')` 创建点
- `src/ui/chatViewHtml.ts`：`.reasoning`、`.tool-output-toggle` 等样式附近加按钮样式

## 变更记录

- 2026-09-05 用户反馈（展开后底部无收起入口）→ 建条目（open/）

- 2026-09-05 认领（doing）：开 worktree 开发

- 2026-09-06 开发完成（doing → done）：底部「收起」按钮落地（worktree 8427783），视觉验收 F-01/02 + 回归 R-01/02/03 全 pass，报告 test/sandbox/verify.chat-block-collapse-footer.report.html

- 2026-09-06 主线合入完成（dev-merge 成功，--no-ff 合入）→ closed：复测 588 单测全过 + build 成功 + 基线 49 场景视觉冒烟全出（collapse-footer 两张分步截图与既有 conversation 等场景核对无回归）
