# AGENTS.md

给所有在本仓库干活的 session（人或 AI）的约定。

## 并行开发：一律 worktree

**主线（main）不开发任何东西**，只负责测试、集成和合入。所有开发都在 worktree 里做。

完整流程见 skill **`worktree-dev-flow`**（正本在 `.agents/skills/worktree-dev-flow/`，随仓库走，DSH 等项目级 skill 机制自动加载；`scripts/` 下五个脚本已按本仓库适配，含 `main-lock.sh` 主线写锁——任何会写 main 的操作必须先拿锁，`dev-merge.sh` 已内置）。不支持 skill 的环境：直接读那个目录里的 `SKILL.md`，或跑 `scripts/dev-start.sh --help` 起步。

**worktree 开发 session 只开发、不合入**：dev-finish（自测 + 生成测试报告 + done 标记）通过后即止，合入由主线 agent 跑 `dev-merge.sh`。**合入门禁 = 测试报告审查**：报告由 `test/sandbox/` 的 ledger + `report.mjs` 产出（新增功能项在前、现有功能回归在后，每项带期望/截图/通过或失败结论），人工审查通过再合入；对功能有疑问才人工开窗 `dev-ui-test.sh` 验收。

## backlog 维护

见 skill **`backlog-folder-index`**（正本在 `.agents/skills/backlog-folder-index/`），本仓库的落地约定在 `docs/backlog/README.md`。一句话版：加条目 = 在 `docs/backlog/open/` 建 `kebab-name.md`（不带序号前缀）；改状态 = `git mv` 到对应目录（认领 → `doing`，开发完成 → `done`，主线合入测试通过人工确认 → `closed`，测试有问题 `done` 退回 `open`）并在条目文件里追加一行变更记录；不要建任何手工索引表。
