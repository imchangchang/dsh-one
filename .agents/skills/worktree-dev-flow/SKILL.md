---
name: worktree-dev-flow
description: 在 git 仓库里用 git worktree 做多 session / 多 agent 并行开发的完整流程和脚本：主线不开发，dev-start 开 worktree，dev-finish 自测打 done 标记，dev-merge 串行 rebase 后合入。当用户要在工程里建立或执行并行开发、worktree 隔离、多 agent 同时改代码、任务分支合入主线时使用。
---

# Worktree 并行开发流程

## 核心规则

- **主线（main）不开发任何东西**，只负责测试、集成、合入。所有开发都在 worktree 里。
- 每个任务一个 worktree：`.worktrees/<slug>`，分支 `agent/<slug>`，独立装依赖，不跨目录复用。
- worktree 里高频小提交，commit message 写清每步做了什么——合并后靠分支历史还原开发过程。
- 完成 = 自测通过 + 打 `done/<slug>` 标记；合入只能由主线做，且**串行合入**：一次只跑一个 dev-merge，等它完全结束（含末尾重建 dist）再合下一个任务。**合入前须人工在 dev-ui-test 窗口验收通过**（见流程 4）。
- **worktree 开发 session 不主动合入主线**：职责止于 dev-finish（自测通过 + done 标记），dev-merge 只由主线 agent 跑，开发 session 不得自行合入。
- 不要并行起抢同一资源的东西（同端口 dev server、同一个应用实例）；worktree 只隔离代码。例外：`dev-ui-test.sh` 起的隔离 VSCode 实例——user-data-dir 每个 worktree 一份，可并行。
- 任务划分尽量不动同一批文件；做完尽快合，拖越久 rebase 冲突越多。

## 流程

**开发 session**（backlog 认领 + worktree 开发）：

1. 认领 backlog 条目：`git mv docs/backlog/open/<条目>.md docs/backlog/doing/`，文件末尾追加变更记录（见 backlog-folder-index）。
2. `scripts/dev-start.sh <任务名>`——任意位置跑：建 worktree + 分支 + 装依赖。
3. `cd .worktrees/<slug>` 进去开发，高频小提交。
4. UI 类改动：`scripts/dev-ui-test.sh`——构建 dist 后起该 worktree 专属的隔离 VSCode 实例（设置/扩展隔离在 `/tmp/dsh-uidev/<slug>/`，不碰日常 VSCode），人工验证渲染与交互没问题再继续；纯逻辑改动可跳过。**视觉验收是合入前的强制 gate**：headless 的开发子代理开不了 GUI，这一步由「人工」在 dev-finish 之后、dev-merge 之前执行（`dev-finish` 只代表自测通过，`done → closed` 最终以人工窗口验收通过为前提），避免「合入主线才发现问题再打回」。
5. `scripts/dev-finish.sh`——worktree 里跑：检查已提交 → 自测 → 打 `done/<slug>` 标记；随后 backlog 条目 `doing → done`（git mv + 追加变更记录）。

**到此为止**：不跑 dev-merge、不合入主线，那是主线 agent 的活。

**主线 agent**（main 上）：

1. `scripts/dev-merge.sh <slug>`——校验 → rebase 到最新 main → 复测 → --no-ff 合入 → 清理。合入串行进行，一次一个任务。
2. 视觉验证已由人工在 dev-ui-test 窗口验收通过（headless 子代理条目的 gate 环节），合入后只做回归：复测（typecheck/test/build）+ 已验功能抽查，通过 → backlog 条目 `done → closed`；测试有问题 → `done → open`（对应 agent 重新认领再走一遍），代码层面怎么处理见下面「合入后测试发现问题」。
3. `scripts/dev-merge.sh` 不带参数：列出所有待合并任务（即 `docs/backlog/done/` 里的条目）。

rebase 有冲突时：进 worktree 解决 → 重跑 `dev-finish.sh`（backlog 记录同步更新）→ 回主线重跑 `dev-merge.sh <slug>`。主线始终不被冲突污染。

### 合入后测试发现问题

判断标准：主线构建/自测挂、核心功能不可用 → **阻塞**；局部缺陷、有临时绕过 → **非阻塞**。

- **非阻塞（fix-forward）**：已合入的代码不动。backlog 条目 `done → open`，条目里写清三样：已合入的 merge commit hash、发现的问题、剩余要做的。后续修复从最新 main 新开 worktree 走完整流程；原 `agent/<slug>` 分支的历史已在 main，不要再合第二次。
- **阻塞（revert）**：先 `git revert -m 1 <merge-commit>` 恢复主线可用（`--no-ff` 合入，revert 一个 commit 即可），再 `done → open` 并按上面记录。要立刻处理——主线挂着会挡其他人的 dev-merge 复测。
  - 重做时的坑：revert 后旧分支的提交在 main 里处于「已合并又被撤销」状态，直接再合旧分支 git 会认为已合过、改动会丢。正确做法：revert 那个 revert commit，或从旧分支 cherry-pick 到新分支。

## 在新工程搭建

1. 把 `references/scripts/` 下五个脚本复制到工程的 `scripts/` 目录，`chmod +x`（`dev-ui-test.sh` 仅 VSCode 扩展类项目需要，其他项目跳过）。
2. 按工程实际改脚本里的三处适配点：
   - `dev-start.sh`：依赖安装命令（现写的是 `npm ci`，按项目换成 `pnpm install` / `uv sync` / `make deps` 等；无依赖可删）
   - `dev-finish.sh` 和 `dev-merge.sh`：自测命令（现写的是 `npm run typecheck && npm test && npm run build`，换成项目的检查命令）
   - `dev-merge.sh` 末尾的「重建主线 dist」是可选步骤，主线的构建产物需要随合并更新才保留
3. `.gitignore` 加 `.worktrees/`。
4. 把「核心规则」和「流程」两节写进工程的 `AGENTS.md`，让所有 session（人或 AI）都能看到。
5. 脚本假设主分支叫 `main`，不是的话全局替换脚本里的 `main`。

## 注意

- `dev-merge.sh` 的校验会拒绝：缺 done 标记、done 标记不在分支最新提交上（rebase/新提交后没重跑 dev-finish）、主线有未提交改动。遇到拒绝按提示处理，不要绕过校验手动 merge。
- `dev-ui-test.sh` 的窗口闪退/起不来：先查 `--user-data-dir` 路径长度——VSCode 的 IPC socket（`<user-data-dir>/1.x-main.sock`）超 103 字符会 `listen EINVAL`、主进程启动即退（表现是 Dock 图标出现又消失）。脚本已把隔离目录放在短路径 `/tmp/dsh-uidev/<slug>/`；长 slug 更容易踩这个，别把 user-data-dir 放回 worktree 里的长路径。
- 测试产物别污染主线：手动测试/复现命令生成的临时文件（测试数据、diff 样例、临时脚本等）写到 `$TMPDIR` 或 `/tmp`、worktree 的 `.dev-host/`，不要落在 main 仓库根目录——主线出现 untracked 文件会挡 `dev-merge.sh` 校验，也污染仓库。
- 四个脚本是参考实现（来自一个 Node/TypeScript 项目），逻辑通用，但只有安装/自测命令是项目相关的。

## 复用这个 skill 本身

- 项目级（随仓库走，clone 即用）：复制本目录到 `<仓库>/.agents/skills/worktree-dev-flow/`。
- 个人级（本机所有工程可用）：复制到 `~/.dsh/skills/` 或 `~/.agents/skills/`。
