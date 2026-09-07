# AGENTS.md

给所有在本仓库干活的 session（人或 AI）的约定。

## 并行开发：一律 worktree

**主线（main）不开发任何东西**，只负责测试、集成和合入。所有开发都在 worktree 里做。

完整流程见 skill **`worktree-dev-flow`**（正本在 `.agents/skills/worktree-dev-flow/`，随仓库走，DSH 等项目级 skill 机制自动加载；`scripts/` 下五个脚本已按本仓库适配，含 `main-lock.sh` 主线写锁——任何会写 main 的操作必须先拿锁，`dev-merge.sh` 已内置）。不支持 skill 的环境：直接读那个目录里的 `SKILL.md`，或跑 `scripts/dev-start.sh --help` 起步。

**worktree 开发 session 只开发、不合入**：dev-finish（自测 + 生成测试报告 + done 标记）通过后即止，合入由主线 agent 跑 `dev-merge.sh`。**合入门禁 = 测试报告审查**：报告由 `test/sandbox/` 的 ledger + `report.mjs` 产出（新增功能项在前、现有功能回归在后，每项带期望/截图/通过或失败结论），人工审查通过再合入；对功能有疑问才人工开窗 `dev-ui-test.sh` 验收。

## backlog 维护

见 skill **`backlog-github-issues`**（正本在 `.agents/skills/backlog-github-issues/`），本仓库的落地约定在 `docs/backlog/README.md`。一句话版：backlog 唯一事实源是 GitHub Issues——加条目 = 建 issue（默认 `b:open`，中文详细标题，正文首行写 slug）；认领 = `gh issue edit <n> --add-assignee @me --remove-label b:open --add-label b:doing` + comment，**认领后必须再 `gh issue view` 复核 assignee 是自己**；改状态 = 换 label + comment 留痕（`b:open` → `b:doing` → `b:done` → `b:closed`，合入测试有问题 `b:done` 退回 `b:open`）；引用统一用 `#N`；不要建任何手工索引表。
