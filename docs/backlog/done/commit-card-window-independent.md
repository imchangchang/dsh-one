# commit 卡片：不依赖当前窗口打开的文件夹，任意窗口状态都能显示

记录于 2026-09-03。用户反馈：聊天消息里的 commit 悬浮卡（作者/时间/message/变更统计/命令行）目前要「该仓库的文件夹在 VS Code 中打开」才显示，要求核实并调研能否做到任意情况都显示。已完成核实与调研，未开始修改。

## 背景与现象

悬浮卡数据只来自 `vscode.git` 扩展 API v1。链路：webview 悬浮 commit hash chip → `commitInfo` 消息 → 宿主 `queryCommitInfo()`（`src/ui/chatMessages.ts:136`）→ `getGitApi()` 拿 `repositories` 逐个 `getCommit(sha)`，仓库优先按会话 cwd 匹配（`preferredRepository`，`:78`），兜底活动编辑器。全部未命中 → `found: false` → chip 灰显「Commit not found」，不弹卡。

## 已核实（根因）

内置 git 扩展（本机 VS Code 自带 `extensions/git/dist/main.js`）的 `repositories` 只由当前窗口状态决定：

- `scanWorkspaceFolders()` 只扫 `workspace.workspaceFolders`（当前窗口打开的文件夹），受 `git.autoRepositoryDetection` 控制；默认扫描深度 `git.repositoryScanMaxDepth = 1`。
- 另有 `git.scanRepositories` 设置数组、以及打开过的文件（`onDidChangeVisibleTextEditors` 对可见编辑器触发 `openRepository`）。

窗口没开该 repo（没开文件夹 / 开的是别的文件夹且该 repo 不在其扫描范围内）→ `repositories` 为空或不含它 → 所有 sha 返回未找到，卡片不显示。用户观察成立。

次生同类场景：worktree 会话的 cwd 在 `.worktrees/<slug>`（主 repo 子目录，默认扫描深度 1 之外），即使窗口开着主 repo 也可能匹配不到（worktree 的 commit 在主 repo object store 里，主 repo 未作为首选仓库命中时同样灰显）。

## 建议方案（可行，未实施）

前提已核实：DSH server 恒定本机（`http://127.0.0.1:<port>`，由扩展 spawn，`src/server/manager.ts`），会话 cwd 是本地真实路径，扩展主机可直接跑 git CLI 兜底，与窗口开什么无关。

1. **数据兜底**：现有 vscode.git 命中时保持原路径（保留原生 diff 打开、零额外开销）；未命中 → `git -C <会话cwd> rev-parse --show-toplevel` 找仓库根（失败 = 不在 git 仓库，维持灰显）→ `git show -s --format=%H%x00%an%x00%ae%x00%aI%x00%s%x00%b --shortstat <sha>` 一条命令拿全卡片字段；GitHub 链接用 `git -C <root> remote get-url origin` + 现有 `githubCommitUrl` 解析。已用 `a5c9358` 实测全字段可拿到。
2. **点击打开 diff**：无 git model 仓库时 `git.viewCommit` 不可用。回退：有 GitHub 链接就浏览器开 commit 页（最简单）；或 `executeCommand('git.openRepository', uri)` 注册进 git model 再走原生路径（有 trust 确认弹窗，需实测验证）。
3. **实现注意**：批量查询按 repo root 分组、一次 `git log --no-walk` 带多个 sha，避免每 hash 起一个进程。

## git 依赖说明（用户追问已明确）

- 兜底**需要系统 git CLI**，但不新增依赖：vscode 内置 git 扩展本身就是 `git` 二进制的壳（所有操作都 spawn 系统 git；找不到 git 时扩展瘫痪，`git.missing` 门控所有命令并提示「Git not found. Install it or configure it using the 'git.path' setting.」）。所以「用 vscode 的 git 能力」和「用户装了 git」是同一个前提——没装 git 时现在的卡片本来也不显示。
- 唯一缝隙：`git.path` 设置（string/string[]/null，`scope: machine`）允许用户把 git 装在 PATH 之外，vscode.git 认它；直接 spawn `git` 会漏掉。实现时读 `vscode.workspace.getConfiguration('git').get('path')` 作为二进制路径即可对齐。

## 失败面（不新增依赖）

- git 二进制缺失时 vscode.git 本身也瘫痪（它同样 shell 出去跑 git），两者依赖相同。
- 唯一新增灰显场景：cwd 不在 git 仓库（如「未分组」会话 cwd 在临时目录），可再上 GitHub API 回退，但收益低、可不做。

## 涉及代码位置

- `src/ui/chatMessages.ts`：`getGitApi`（:66）、`preferredRepository`（:78）、`queryCommitInfo`（:136）、`openCommit`（:165）、`githubCommitUrl`（:110）
- `src/pure/chatContract.ts`：`CommitInfoResult`（:719）
- `src/ui/chat/webview.ts`：`commitInfoCard`（:719）不变，纯消费 `CommitInfoResult`

## 变更记录

- 2026-09-03 用户反馈「卡片要当前文件夹在 VS Code 打开才显示」→ 核实（数据源仅 vscode.git API；内置 git 仓库发现 = 当前窗口 workspace folders 扫描 + `git.scanRepositories` + 打开的编辑器，默认扫描深度 1）→ 调研（git CLI 兜底可行：dsh server 恒本机、会话 cwd 本地路径、`a5c9358` 实测字段齐全）→ 记入 open/（未开始修改）。
- 2026-09-03 用户追问「兜底要用户装 git 么」→ 核实内置 git 扩展源码（`git.path` 设置、`git.missing` 门控、找不到 git 的提示）→ 明确不新增依赖，补「git 依赖说明」节。
- 2026-09-04 Sprint 3 认领（worktree: agent/commit-card-window-independent）：实现 git CLI 兜底（vscode.git 未命中 → 会话 cwd 仓库根 + git show/log 拿全字段 + origin 推 GitHub 链接；点击打开 = GitHub commit 页兜底），任意窗口状态显示 commit 卡。
- 2026-09-04 开发完成（worktree f5210c9，分支 agent/commit-card-window-independent，dev-finish 自测通过 + done 标记）：① vscode.git 未命中时 git CLI 兜底查询（会话 cwd rev-parse --show-toplevel → git log --no-walk 批量 --shortstat 拿全字段；git.path 设置对齐；失败静默保持灰显）；② 点击打开：无 git model 仓库时 GitHub 链接浏览器开 commit 页兜底；③ 解析/投影收敛到 src/pure/commitGit.ts + 9 个单测；④ 验收报告 test/sandbox/verify.commit-card-window-independent.report.html（F-01 新增 / R-01 灰显 / R-02 回显，三项全 pass，沙盒实例 commit-card-independent 独立验证）。
