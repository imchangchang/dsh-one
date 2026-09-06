# backlog 工作流迁移到 GitHub Issues

## 背景与现象

backlog 目前用 git 维护在 main 上（`docs/backlog/` 文件夹即索引）。多 session / 多开发者并行时会撞车：

- 多个 agent 同时往 main 提交 backlog 变更（认领、改状态、加条目）时 push 冲突；
- 本地 worktree 里的 backlog 是快照，互相看不见别人刚提交的变更，争抢公共资源（同一条目被不同模块重复认领的风险）；
- 没有可靠的服务器侧同步——这是开源项目，其他开发者本地 checkout 之后步调不一致。

目标：在下一个版本发布之前，把工作流完整切换到 GitHub Issues。

## 现状（验证过的前提）

- remote 存在：`imchangchang/dsh-one`（ssh）；
- 本机 `gh` CLI 已认证（账户 imchangchang，repo 权限）；
- 存量：open 9 条 + doing 4 条 + closed 162 条，共 175 条；
- 现有约定（`docs/backlog/README.md`）：一条目一文件（kebab-name），状态 = 目录（open/doing/done/closed），改状态 = `git mv` + 追加变更记录行。

## 建议方案（2026-09-05 讨论）

核心：**每条 backlog = 一个 GitHub Issue**，心智模型不变，只换载体。

- 状态 = label，四态：`b:open` / `b:doing` / `b:done` / `b:closed`（替代目录，流转语义与现状一致：认领、开发完成、合入确认、测试问题退回）；
- 认领 = `gh issue edit <n> --assignee @me --add-label b:doing` + 追加一条 comment 作变更记录（对应现在「git mv + 追加一行」）；
- 认领唯一性：assignee 原生字段 + 服务器实时状态（认领前 `gh issue view <n>` 读的是服务器最新状态，不是本地快照，消除快照不同步的竞态）+ comment 全量留痕；没有内置强制锁，靠约定，够用；
- 并发写零冲突：每条 issue 独立，服务端原子操作；
- 协作：其他开发者直接开 issue / 认领 issue，全部落在 GitHub 上，步调一致；代码 commit 引用 `#<n>` 自动链接；
- 公开仓库放内部任务的状态与现状与现在（backlog 本来就在公开仓库 main 上）一致，无新增暴露。

### 迁移拆解（实施时执行）

1. 定义 4 个 label；
2. 存量迁移：open/doing 共 13 条逐条迁移成 issue（正文 + 变更记录保留）；closed 162 条不逐条迁，归档成一份 md（如 `docs/backlog/closed/archive-XXXX.md` 或挪入 `docs/`）；
3. 更新约定文档：`docs/backlog/README.md`（改为 issue 流程）、`AGENTS.md`（backlog 维护一行指向新流程）、`.agents/skills/backlog-folder-index/SKILL.md`（正本同步）及 worktree-dev-flow 中涉及认领的步骤；
4. 加 issue template（提出 ≠ 修改约定写进模板）。

### 备选/边界

- 不用 GitHub Projects board（labels 已够，不加复杂度）；
- 双轨（issue + 文件镜像）不推荐，会漂移；
- 存量迁移是最大工作量，试点阶段可先用 issue 方式给新任务，流程验证后再迁存量。

## 涉及代码位置

- `docs/backlog/`（条目文件与 README）
- `AGENTS.md`（backlog 维护约定）
- `.agents/skills/backlog-folder-index/`（skill 正本）
- `.agents/skills/worktree-dev-flow/`（认领步骤）

## 前置

无。

## 变更记录

- 2026-09-05 讨论确定方案（issue + label 状态机 + assignee 认领；不用 Projects board；存量分步迁）→ 记录 → open（目标：下一版本发布前完成切换）
- 2026-09-07 重新梳理，完整工作流程与迁移方案见 `docs/backlog/migration-github-issues.md`（含认领复核流程、中文标题/编号约定、迁移步骤）
