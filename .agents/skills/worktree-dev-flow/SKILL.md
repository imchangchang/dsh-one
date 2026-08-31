---
name: worktree-dev-flow
description: 在 git 仓库里用 git worktree 做多 session / 多 agent 并行开发的完整流程和脚本：主线不开发，dev-start 开 worktree，dev-finish 自测打 done 标记，dev-merge 加锁 rebase 后合入。当用户要在工程里建立或执行并行开发、worktree 隔离、多 agent 同时改代码、任务分支合入主线时使用。
---

# Worktree 并行开发流程

## 核心规则

- **主线（main）不开发任何东西**，只负责测试、集成、合入。所有开发都在 worktree 里。
- 每个任务一个 worktree：`.worktrees/<slug>`，分支 `agent/<slug>`，独立装依赖，不跨目录复用。
- worktree 里高频小提交，commit message 写清每步做了什么——合并后靠分支历史还原开发过程。
- 完成 = 自测通过 + 打 `done/<slug>` 标记；合入只能由主线做，合并期间主线持有 `.dev-lock`。
- 不要并行起抢同一资源的东西（同端口 dev server、同一个应用实例）；worktree 只隔离代码。
- 任务划分尽量不动同一批文件；做完尽快合，拖越久 rebase 冲突越多。

## 流程

```
scripts/dev-start.sh <任务名>     # 任意位置跑：建 worktree + 分支 + 装依赖
cd .worktrees/<slug>              # 进去开发，高频小提交
scripts/dev-finish.sh             # worktree 里跑：检查已提交 → 自测 → 打 done/<slug>
scripts/dev-merge.sh <slug>       # 主线跑：校验 → 上锁 → rebase 到最新 main → 复测 → --no-ff 合入 → 清理
scripts/dev-merge.sh              # 不带参数：列出所有待合并任务
scripts/dev-unlock.sh             # 清理残留的 .dev-lock（正常自动释放，只在合并进程被杀后用）
```

rebase 有冲突时：进 worktree 解决 → 重跑 `dev-finish.sh` → 回主线重跑 `dev-merge.sh <slug>`。主线始终不被冲突污染。

## 在新工程搭建

1. 把 `references/scripts/` 下四个脚本复制到工程的 `scripts/` 目录，`chmod +x`。
2. 按工程实际改脚本里的三处适配点：
   - `dev-start.sh`：依赖安装命令（现写的是 `npm ci`，按项目换成 `pnpm install` / `uv sync` / `make deps` 等；无依赖可删）
   - `dev-finish.sh` 和 `dev-merge.sh`：自测命令（现写的是 `npm run typecheck && npm test && npm run build`，换成项目的检查命令）
   - `dev-merge.sh` 末尾的「重建主线 dist」是可选步骤，主线的构建产物需要随合并更新才保留
3. `.gitignore` 加两行：`.worktrees/` 和 `.dev-lock`。
4. 把「核心规则」和「流程」两节写进工程的 `AGENTS.md`，让所有 session（人或 AI）都能看到。
5. 脚本假设主分支叫 `main`，不是的话全局替换脚本里的 `main`。

## 注意

- `dev-merge.sh` 的校验会拒绝：缺 done 标记、done 标记不在分支最新提交上（rebase/新提交后没重跑 dev-finish）、主线有未提交改动、已有 `.dev-lock`。遇到拒绝按提示处理，不要绕过校验手动 merge。
- 四个脚本是参考实现（来自一个 Node/TypeScript 项目），逻辑通用，但只有安装/自测命令是项目相关的。

## 复用这个 skill 本身

- 项目级（随仓库走，clone 即用）：复制本目录到 `<仓库>/.agents/skills/worktree-dev-flow/`。
- 个人级（本机所有工程可用）：复制到 `~/.dsh/skills/` 或 `~/.agents/skills/`。
