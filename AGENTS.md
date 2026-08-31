# AGENTS.md

给所有在本仓库干活的 session（人或 AI）的约定。

## 并行开发：一律 worktree

**主线（main）不开发任何东西**，只负责测试、集成和合入。所有开发都在 worktree 里做。

完整流程见 skill **`worktree-dev-flow`**（正本在 `.agents/skills/worktree-dev-flow/`，随仓库走，DSH 等项目级 skill 机制自动加载；`scripts/` 下四个脚本已按本仓库适配）。不支持 skill 的环境：直接读那个目录里的 `SKILL.md`，或跑 `scripts/dev-start.sh --help` 起步。

## backlog 维护

见 skill **`backlog-folder-index`**（正本在 `.agents/skills/backlog-folder-index/`），本仓库的落地约定在 `docs/backlog/README.md`。一句话版：加条目 = 在 `docs/backlog/open/` 建 `kebab-name.md`（不带序号前缀），改状态 = `git mv`，不要建任何手工索引表。
