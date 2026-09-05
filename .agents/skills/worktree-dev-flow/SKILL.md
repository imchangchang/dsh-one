---
name: worktree-dev-flow
description: 在 git 仓库里用 git worktree 做多 session / 多 agent 并行开发的完整流程和脚本：主线不开发，dev-start 开 worktree，dev-finish 自测打 done 标记，dev-merge 串行 rebase 后合入。当用户要在工程里建立或执行并行开发、worktree 隔离、多 agent 同时改代码、任务分支合入主线时使用。
---

# Worktree 并行开发流程

## 核心规则

- **主线（main）不开发任何东西**，只负责测试、集成、合入。所有开发都在 worktree 里。
- 每个任务一个 worktree：`.worktrees/<slug>`，分支 `agent/<slug>`，独立装依赖，不跨目录复用。
- worktree 里高频小提交，commit message 写清每步做了什么——合并后靠分支历史还原开发过程。
- 完成 = 自测通过 + 打 `done/<slug>` 标记；合入只能由主线做，且**串行合入**：一次只跑一个 dev-merge，等它完全结束（含末尾重建 dist）再合下一个任务。串行靠 `main-lock.sh` 的主线写锁**强制**（不是自觉）：任何会写 main 分支历史或主工作区内容的操作都要先 `acquire_main_lock`，拿不到锁直接退出；`dev-start`/`dev-finish`/`dev-ui-test` 只写 worktree 自己的分支/tag/dist，不需要锁。**合入前 gate = 人工审查 dev-finish 产出的测试报告**（`test/sandbox/verify.<slug>.report.html`：新增功能项在前 + 现有功能回归项在后，每项带期望/截图/通过或失败结论；见流程 5）——报告无问题直接合入；对功能有疑问才人工开窗 `dev-ui-test.sh` 验收（见流程 6）。
- **worktree 开发 session 不主动合入主线**：职责止于 dev-finish（自测 + 生成测试报告 + done 标记），dev-merge 只由主线 agent 跑，开发 session 不得自行合入。
- 不要并行起抢同一资源的东西（同端口 dev server、同一个应用实例）；worktree 只隔离代码。例外：`dev-ui-test.sh` 起的隔离 VSCode 实例——user-data-dir 每个 worktree 一份，可并行。
- 任务划分尽量不动同一批文件；做完尽快合，拖越久 rebase 冲突越多。

## 流程

**开发 session**（backlog 认领 + worktree 开发）：

1. 认领 backlog 条目：`git mv docs/backlog/open/<条目>.md docs/backlog/doing/`，文件末尾追加变更记录（见 backlog-folder-index）。
2. `scripts/dev-start.sh <任务名>`——任意位置跑：建 worktree + 分支 + 装依赖。
3. `cd .worktrees/<slug>` 进去开发，高频小提交。
4. UI 类改动的视觉自测（**开发自测环节，不再是合入门禁**）：二选一或都用——
   - 沙盒场景驱动：`test/sandbox/run-sandbox.sh start --mock-llm` 起沙盒后跑 `test/sandbox/verify-driver.mjs`，对场景做确定性验证（ledger 字段、命令与坑见 `test/sandbox/README.md`；沙盒默认实例是共享单实例——先 `run-sandbox.sh status` 确认空闲再 `start`，别与其他任务并行抢；多个 session 同时验证时各用各的 `--instance <slug>` 并行实例 + 独立端口/截图目录，见 README「并行实例」）。
   - `ai-visual-validation`：浏览器独立渲染 webview + 截图对照期望（见该 skill）。
   纯逻辑改动可跳过视觉自测；跳过不影响测试报告——报告里现有功能的回归项仍要跑（流程 5）。
5. **生成测试报告**（合入门禁产物，dev-finish 前置）：ledger 场景 → `verify-driver.mjs` 跑 → `report.mjs` 渲染 HTML。
   a. 场景定稿进任务专属 ledger：`cp test/sandbox/verify.ledger.example.json test/sandbox/verify.<slug>.ledger.json`（**任务专属文件名，不动 CI 基线** `test/sandbox/verify.ledger.json`）；`phase: new-feature` 条目排前、`regression` 排后，每项写清 `id/name/expect`，能自动断的加 `driver` 字段，截图产物放 `/tmp/dsh-sandbox-shots/`。
   b. 跑驱动（有 `driver` 项时，沙盒已起）：`node test/sandbox/verify-driver.mjs --ledger test/sandbox/verify.<slug>.ledger.json --url http://127.0.0.1:8080 --out /tmp/dsh-sandbox-shots/`——结果写回 ledger（断言命中 `done`；超时/异常 `fail` + `notes` 原因 + 截图路径）。
   c. 逐项看截图定结论：符合期望的 `done → pass`，不符的改 `fail` 并在 `notes` 写明；**渲染报告前不能留 `pending`/`done`**——「每项通过/失败结论」是 gate 的判定依据。`notes` 要**按检查点逐条记录核对结论**（如「勾选态 ✓ 且顶层菜单仍开」），不允许「核对勾选态」式一句带过——核对漏项（期望里有但 notes 没提）靠这个暴露，报告审查据此判断核对是否覆盖了全部断言。
   d. 渲染：`node test/sandbox/report.mjs --ledger test/sandbox/verify.<slug>.ledger.json --out test/sandbox/verify.<slug>.report.html`（截图 base64 内嵌，单文件可分发）。
   e. 提交 ledger（报告 HTML 已 gitignore，不必提交），把报告路径交给用户审——**合入门禁 = 人审报告**：无问题直接等合入；有疑问才走流程 6。
   f. 无 UI 行为变化的任务（纯逻辑/文档）可不建 ledger，在条目变更记录里注明「无 UI 行为变化，沙盒报告不适用」。
6. （仅当报告审查有疑问时）人工 `dev-ui-test.sh` 窗口验收——不再是默认门禁，命令与交接收口不变：构建 dist 后起该 worktree 专属的隔离 VSCode 实例（设置/扩展隔离在 `/tmp/dsh-uidev/<slug>/`，不碰日常 VSCode），人工验证渲染与交互。**代理/会话别自己跑 dev-ui-test**：沙箱或远程环境下 `code` 命令会静默返回 exit 0 但窗口不弹出（`/tmp/dsh-uidev/<slug>/user-data` 不生），而本机 GUI 会话（用户本机 dsh web 服务下跑的会话）里 `code` 会**真的弹出窗口并阻塞等待**——两种情况都别试，窗口是给用户看的。这一步直接把命令丢给用户本人，在真实终端跑，等验收结果回传再继续。**交给用户的单元 = 一条可复制的命令 + 应有的现象，分单下发**（示例）：

```
【测试命令】（单条，复制即跑，已含进入 worktree）

```bash
cd <repo-root>/.worktrees/<slug> && bash <repo-root>/scripts/dev-ui-test.sh
```

【应有现象】

1. 弹出隔离 VSCode 窗口（标题 = 该 worktree 目录，user-data 在 /tmp/dsh-uidev/<slug>/）
2. 左侧活动栏出现 DSH One 图标，点击能打开 chat 面板
3. 扩展激活无报错（输出面板"DSH One"）
4. <本功能特有检查点，由开发 session 按预期行为写>
```

规则：

- **命令必须用 markdown 代码块包裹（fenced code block，` ```bash ` 起止），且只包命令本身**：用户点选/复制代码块内容即整条命令，不带「测试命令」「应有现象」等说明文字。说明文字（含现象清单）一律放代码块外，不要混进代码块。
- **一个单元 = 一个功能/一次开窗验收**。worktree 里有多个要验的功能就拆成多个单元，各自"一条命令 + 各自现象"，不要全塞进一条消息。
- **命令只给 dev-ui-test 这一条**。`ui-visual.sh`（截图）、`npm test`、`dev-finish` 是别的步骤，**不混进**这个开窗验收单元——它们不能替代人的眼。
- **命令里必须包含 `cd <repo-root>/.worktrees/<slug>`**：`dev-ui-test.sh` 靠 `git rev-parse --show-toplevel` 定位当前 worktree，cwd 在 worktree 里它才把**这个 worktree** 当扩展加载；cwd 在主线会打开主线而不是本任务。
- 这是**纯对话框交接**：不生成脚本文件、不改 `dev-ui-test.sh`，就是交给人复制即跑。
7. `scripts/dev-finish.sh`——worktree 里跑：检查已提交（ledger/本次改动都已提交，未提交会挡）→ 自测 → 打 `done/<slug>` 标记；随后 backlog 条目 `doing → done`（git mv + 追加变更记录）。

**到此为止**：不跑 dev-merge、不合入主线，那是主线 agent 的活。

**主线 agent**（main 上）：

1. `scripts/dev-merge.sh <slug>`——校验 → rebase 到最新 main → 复测 → --no-ff 合入 → 清理。合入串行进行，一次一个任务。
2. 合入前 gate 已过（测试报告已人工审查通过，见流程 5；有疑问的功能已按流程 6 人工开窗验收），合入后只做回归：复测（typecheck/test/build）+ 已验功能抽查，通过 → backlog 条目 `done → closed`；测试有问题 → `done → open`（对应 agent 重新认领再走一遍），代码层面怎么处理见下面「合入后测试发现问题」。
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
6. 流程 5 的测试报告约定（ledger + `test/sandbox/report.mjs`）是本仓库 dsh-one 的落地细节；其他工程没有对应工具时，把该步换成各自可执行的报告/验收方式。

## 注意

- **非交互场景跑 git 一律带 `GIT_EDITOR=true`**：会话/脚本里执行 `git rebase --continue`（冲突解决后内部带 `-e` 会强制编辑）、裸 `git commit`、任何可能调起 editor 的 git 命令，都必须显式 `GIT_EDITOR=true git ...`（或 `--no-edit`）。否则 git 会用 `core.editor`（常见配置 `code --wait`）拉起外部编辑器窗口、阻塞等编辑——窗口在用户桌面上"莫名其妙"弹出，命令挂死。真实终端里用户自己跑 git 时则不必加（编辑器是给用户的）。
- `dev-merge.sh` 的校验会拒绝：缺 done 标记、done 标记不在分支最新提交上（rebase/新提交后没重跑 dev-finish）、主线有未提交改动。遇到拒绝按提示处理，不要绕过校验手动 merge。
- **主线写锁**：`main-lock.sh` 用原子 `mkdir` 实现，锁在 `<git-common-dir>/main-write.lock`（`.git/` 下，不会污染 `git status` 校验）。`dev-merge.sh` 从校验到合入全程持锁、EXIT trap 释放；拿不到锁说明已有进程在写 main，直接退出等它结束。自己写会碰 main 的脚本时 source 它，别绕过——`dev-merge.sh` 的串行保证全靠这把锁。
- `dev-ui-test.sh` 的窗口闪退/起不来：先查 `--user-data-dir` 路径长度——VSCode 的 IPC socket（`<user-data-dir>/1.x-main.sock`）超 103 字符会 `listen EINVAL`、主进程启动即退（表现是 Dock 图标出现又消失）。脚本已把隔离目录放在短路径 `/tmp/dsh-uidev/<slug>/`；长 slug 更容易踩这个，别把 user-data-dir 放回 worktree 里的长路径。
- **worktree 里的 `scripts/` 是建分支那个时间点的快照**：skill 后来新增或改过的脚本（如 `dev-ui-test.sh`）不会自动出现在既有 worktree 里，worktree 自带的 `dev-merge.sh` 也可能是旧版。跑新版脚本时**用主线的路径、cwd 留在 worktree 内**：`bash <main>/scripts/dev-ui-test.sh`（脚本靠 `git rev-parse --show-toplevel` 定位当前 worktree，脚本路径可以和 cwd 分离）。别在 worktree 里直接 `scripts/dev-ui-test.sh` 而期望它是新版。
- 测试产物别污染主线：手动测试/复现命令生成的临时文件（测试数据、diff 样例、临时脚本等）写到 `$TMPDIR` 或 `/tmp`、worktree 的 `.dev-host/`，不要落在 main 仓库根目录——主线出现 untracked 文件会挡 `dev-merge.sh` 校验，也污染仓库。
- 五个脚本是参考实现（来自一个 Node/TypeScript 项目），逻辑通用，但只有安装/自测命令是项目相关的。

## 复用这个 skill 本身

- 项目级（随仓库走，clone 即用）：复制本目录到 `<仓库>/.agents/skills/worktree-dev-flow/`。
- 个人级（本机所有工程可用）：复制到 `~/.dsh/skills/` 或 `~/.agents/skills/`。
