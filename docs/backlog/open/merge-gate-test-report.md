# 合入 gate 改为测试报告审查（流程变更）

## 背景与现状

worktree 开发完成到主线合入之间，人工 gate 是 `dev-ui-test.sh`（人开真窗口点一遍）。沙盒验证（code-server + 真 dsh + mock-LLM + WebBridge/Playwright）已跑通后，这个人工开窗环节成为瓶颈：每个功能都要人在桌面窗口手工过一遍，而沙盒已能验到真宿主 + 真 dsh + 确定性内容。

## 建议方案（session 内已确认）

1. **合入 gate 从"人工开窗"改为"测试报告审查"**：worktree dev-finish 产出 HTML 测试报告（新增功能测试在前 + 现有功能回归测试，每项带期望描述/截图/通过或失败结论），人审报告无问题直接合入；对功能有疑问才人工开窗验收。
2. **ai-visual-validation 降为开发自测环节**（开发完伴随单测做快速视觉自测），不再是合入验收手段。
3. **主线自动化回归主要依赖沙盒**：本地用 WebBridge 驱动、CI 用 Playwright 驱动同一套场景（沙盒驱动层抽两个实现）；黑/白 × 中/英四组合矩阵只在发版 gate 跑。
4. **覆盖范围明写**：真桌面/真模型/平台问题（如 Windows 专项）不在沙盒覆盖内，报告注明。

## 涉及改动位置

- `.agents/skills/worktree-dev-flow/SKILL.md`（dev-finish 步骤加"生成测试报告"；合入 gate 描述改写）
- `AGENTS.md`（主线职责一节、流程 4 的描述）
- `test/sandbox/`（report.mjs 报告生成脚本、playwright 驱动、场景与 ledger 格式——随 sandbox-testing-chain 任务交付）
- 可选：dev-merge.sh 复测增加 dsh 版本兼容冒烟项（后续单独立项）

## 前置

- sandbox-testing-chain（报告脚本与 Playwright 驱动在该任务内做，之后才有工具可用）

## 变更记录

- 2026-09-04 方案确认后记录进 open/。状态变更（skill/AGENTS 改写）待单独认领。
