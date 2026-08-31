# AGENTS.md

给所有在本仓库干活的 session（人或 AI）的约定。

## 并行开发：锁 + worktree

仓库只有一个，但同一时间可能有多个 session 想改代码。规则：

**开始任何开发前，先跑 `scripts/dev-start.sh <任务名>`**，它会自动判断：

- **主线空闲**（无锁且工作区干净）→ 在主线写入 `.dev-lock`，直接在主线开发。收尾提交后跑 `scripts/dev-unlock.sh` 释放锁。
- **主线被占** → 自动创建 `.worktrees/<slug>`（分支 `agent/<slug>`）并装好依赖，进去开发。

锁不是强制的，是约定：看到 `.dev-lock` 或未提交改动就别动主线。锁还在但工作区干净（上个 session 忘了释放）时，用 `scripts/dev-start.sh <任务名> --force` 接管。

### worktree 里的开发

- 高频小提交，commit message 写清楚每步做了什么——合并后靠分支历史还原开发过程。
- 完成后跑 `scripts/dev-finish.sh`：检查全部已提交 → 跑 `typecheck + test + build` → 打 `done/<slug>` 标记。这就是"等合并"的信号。

### 合入主线

主线空闲时，由正在用主线的 session 跑 `scripts/dev-merge.sh <slug>`：

1. 校验 `done/<slug>` 标记在分支最新提交上、主线干净；
2. 在 worktree 里把分支 rebase 到最新 main（有冲突就在 worktree 里解决，主线始终不受影响），解决后重跑 `dev-finish.sh`；
3. rebase 后复测，然后 `git merge --no-ff` 合入，merge commit 里带任务提交清单；
4. 清理 worktree、分支和 done 标记。

不带参数跑 `scripts/dev-merge.sh` 可以列出所有待合并的任务。

### 注意

- 每个 worktree 有独立 `node_modules`（`dev-start.sh` 会自动 `npm ci`），别跨目录复用。
- 不要并行起会抢同一资源的东西（比如同端口的 dev server、同一个 dsh 实例）；worktree 只隔离代码。
- 任务划分尽量不动同一批文件，拖太久的分支 rebase 时冲突会越来越多，做完了尽快合。
