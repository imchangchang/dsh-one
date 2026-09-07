# AGENTS.md

给所有在本仓库干活的 session（人或 AI）的约定。

## 铁律：改代码前必须先建 issue + 开 worktree（违反即流程错误）

**主线（main）不写任何代码**，只负责测试、集成和合入。任何改动仓库文件的任务，动手写代码前必须先完成前两步：

1. **建/认领 backlog issue**：一条目一 issue，状态 = label（`b:open`→`b:doing`→`b:done`→`b:closed`）。没现成 issue 就 `gh issue create`（默认 `b:open`，中文详细标题，正文首行写 slug）；认领 = `gh issue edit <n> --add-assignee @me --remove-label b:open --add-label b:doing` + comment，**并 `gh issue view` 复核 assignee 是自己**。
2. **`scripts/dev-start.sh <slug>` 开 worktree**：在 `.worktrees/<slug>`（分支 `agent/<slug>`）里开发，不在 main 上改文件。

**限制与例外**：

- **只读分析**（读代码 / 查资料 / 分析问题 / 汇报，不新增不修改仓库文件）可以直接在 main 做，不触发流程。
- 反过来：**一旦决定落代码（新增/修改任何仓库文件），就从第 1 步重新开始**——分析阶段不用走，但绝不能「先改了再说」、事后再补流程。
- **凡改仓库自身约定/文档、且不涉及代码行为**（如本 AGENTS.md 本身、`docs/` 纯文档），可直接在 main 上改，不走 worktree（工作流无法 self-bootstrap）。

**提交前自查三问**（任一答不出 = 流程没走完）：这次改动在哪个分支？对应 backlog issue 是 #几？`dev-finish` 打过 done 标记了吗？

并行开发全流程见 skill **`worktree-dev-flow`**。

## 并行开发：一律 worktree

**主线（main）不写任何代码**，只负责测试、集成和合入。所有开发都在 worktree 里做。

完整流程见 skill **`worktree-dev-flow`**（正本在 `.agents/skills/worktree-dev-flow/`，随仓库走，DSH 等项目级 skill 机制自动加载；`scripts/` 下五个脚本已按本仓库适配，含 `main-lock.sh` 主线写锁——任何会写 main 的操作必须先拿锁，`dev-merge.sh` 已内置）。不支持 skill 的环境：直接读那个目录里的 `SKILL.md`，或跑 `scripts/dev-start.sh --help` 起步。

**worktree 开发 session 只开发、不合入**：dev-finish（自测 + 生成测试报告 + done 标记）通过后即止，合入由主线 agent 跑 `dev-merge.sh`。**合入门禁 = 测试报告审查**：报告由 `test/sandbox/` 的 ledger + `report.mjs` 产出（新增功能项在前、现有功能回归在后，每项带期望/截图/通过或失败结论），人工审查通过再合入；对功能有疑问才人工开窗 `dev-ui-test.sh` 验收。

## backlog 维护

见 skill **`backlog-github-issues`**（正本在 `.agents/skills/backlog-github-issues/`），本仓库的落地约定在 `docs/backlog/README.md`。一句话版：backlog 唯一事实源是 GitHub Issues——加条目 = 建 issue（默认 `b:open`，中文详细标题，正文首行写 slug）；认领 = `gh issue edit <n> --add-assignee @me --remove-label b:open --add-label b:doing` + comment，**认领后必须再 `gh issue view` 复核 assignee 是自己**；改状态 = 换 label + comment 留痕（`b:open` → `b:doing` → `b:done` → `b:closed`，合入测试有问题 `b:done` 退回 `b:open`）；引用统一用 `#N`；不要建任何手工索引表。
