# AGENTS.md

给所有在本仓库干活的 session（人或 AI）的约定。

## 并行开发：一律 worktree

**主线（main）不开发任何东西**，只负责测试、集成和合入。所有开发都在 worktree 里做。

完整流程见 skill **`worktree-dev-flow`**（支持 skill 的 agent 直接加载；本仓库 `scripts/` 下的 dev-start / dev-finish / dev-merge / dev-unlock 四个脚本已按本仓库适配，直接可用）。不支持 skill 的环境：跑 `scripts/dev-start.sh --help` 起步，或读本仓库 git 历史里本文件的旧版本。

## backlog 维护

见 skill **`backlog-folder-index`**，本仓库的落地约定在 `docs/backlog/README.md`。一句话版：加条目 = 在 `docs/backlog/open/` 建 `NNN-name.md`，改状态 = `git mv`，不要建任何手工索引表。
