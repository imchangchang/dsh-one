# 发送/清空后 composer 高亮层残留「鬼影」+ 首帧前回填文本被吞

## 背景与现象

用户实测反馈（2026-09）：运行中插话（Enter 排队 / ⌘Enter 插话）把消息送回输入区后，输入区还叠加着浅灰色的占位提示——透明文字 + 高亮层方案下表现为「鬼影」草稿叠在占位符上（与 57be56d 一键清空鬼影同源，但那条路径未覆盖发送清空）。

排查定位（2026-09-08，浏览器独立渲染 + Playwright 确定性复现）：

1. **主因（用户所见）**：运行中（`state.running=true`）发送插话时 `sendCurrent()` 清空 `input.value` 后调 `render()`——此时 composerSig 不变（running 不变、无附件、无 recall）+ hadFocus → `keepComposer=true` 保活帧不重建输入区、也不重画 `.ref-token-layer`，高亮层残留发送前的文字；value 已空 → 占位符显示 → 文本与占位符视觉叠加。**只在发送前后签名不变的帧出现（插话命中；非运行态发送 running 翻转会重建，无此问题）**。57be56d 只补了「一键清空按钮」的保活收尾，sendCurrent 的 `/model` 分支与主分支漏了同样的收尾。
2. **次因（罕见时序）**：`restoreDraft` 早于 composer 渲染到达（发送失败回填先于首个 state 帧）时文本进 `stashedDraft`，但首个 state 帧的「换会话归档」把 `stashedDraft` 归档进 `EMPTY_SESSION_KEY` 并清空——之后渲染当前会话取 `composerDrafts` 拿不到，回填文本丢失（输入区只剩占位符）。A1–A5 消息序列诊断复现确认。

## 方案（已开发完成）

1. `sendCurrent` 清空后补就地收尾（`syncComposerAfterClear`：保活帧内 autoGrow + updateButton + renderRefLayer，与一键清空同款）——主发送分支与 `/model` 分支都补。
2. 首个 state 帧（oldKey 为空态占位）归档时不消费 `stashedDraft`（保留给 renderInput 消费），真实切换帧仍走归档清空。
3. `test/ui/scenarios.js` 新增基线场景 `composer-clear-after-send`（运行中输入 → Enter → 断言高亮层无残留）。

## 变更记录

- 2026-09-08 用户反馈 → 排查定位（Playwright 复现两个缺陷）→ 开发完成提交（worktree）→ open 条目直接建立并认领（doing）
- 2026-09-08 开发完成（worktree agent/composer-ghost-after-send，commit 39e7e24）：sendCurrent 清空后补高亮层就地收尾 + 首帧空态归档保留 stashedDraft + harness 基线场景 composer-clear-after-send；自测 449/449 测试通过、typecheck 通过、浏览器诊断 A1-A5/B/C 全回填正常、dev-host 时序复现修复前后对比；验收报告 test/sandbox/verify.composer-ghost-after-send.report.html（F-01/F-02/R-01/R-02 全 pass）→ 待 dev-finish 打 done
