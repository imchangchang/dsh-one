# 视觉验证规范收紧：期望断言化 + 默认进基线 + 核对记录逐检查点

## 背景（workspace-groups-submenu-hover 复盘结论）

视觉测试存在但没拦住「分组…子菜单顶层菜单消失」bug 的三处系统性缺口：

1. **期望措辞可作伪**：「右缘对齐顶层菜单，不覆盖 6 项」——「不覆盖」只否定遮挡、不断言存在，实际整层被移除也能被解读为「没遮挡」而放行。
2. **升级基线靠自觉**：skill 已有「升级为基线」机制但执行不一，右击菜单场景当时就没进 BASELINE_SCENARIOS，合入后主线冒烟永远不碰。
3. **核对记录可笼统**：ledger notes 写「核对勾选态」一句带过，「顶层菜单仍在」未被列为检查点——notes 不走逐检查点记录，核对漏项无从审查。

## 建议方案（已确认做法）

1. **期望书写规则**（`.agents/skills/ai-visual-validation/SKILL.md`）：
   - 视觉验证方法节加一条：涉及弹层叠加/状态切换的场景，期望必须写「**仍应在位清单**」+「不应残留清单」，禁止「不遮挡/不覆盖」这类只否定遮挡的措辞；核对逐条对照，清单里每条都是独立判定点。
   - 新增场景示例注释同步（expect 补一句「交互类场景另写仍应在位清单」）。
2. **功能场景默认进基线**（同文件「怎么新增一个场景」节）：把「如果它是以后必须一直对的状态…把名字加进 BASELINE_SCENARIOS」改为「功能验收场景默认进基线；仅一次性调试 fixture 例外（放 .dev-host/，别提交、别进基线）」。
3. **核对记录逐检查点**（`.agents/skills/worktree-dev-flow/SKILL.md` 流程 5c）：notes 要求按检查点逐条写结论（如「勾选态 ✓ 且顶层菜单仍开」），不允许「核对勾选态」式笼统；报告审查时看 notes 即可判断核对是否覆盖了并存的全部断言。

## 涉及代码位置

- `.agents/skills/ai-visual-validation/SKILL.md`
- `.agents/skills/worktree-dev-flow/SKILL.md`

## 变更记录

- 2026-09-05 问题记录（open）：上述三项缺口与修复方向（用户确认 1/3/4 开工；分步截图另立项 visual-interaction-step-shots）。
- 2026-09-05 认领（open -> doing）：worktree 开发（分支 agent/visual-validation-guidelines）。
