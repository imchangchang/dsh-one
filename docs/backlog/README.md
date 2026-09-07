# Backlog：GitHub Issues

记录已知但未解决的问题、待做的改进和将来可能要做的事。**backlog 的唯一事实源是 GitHub Issues**，本目录只保留这份约定和 closed 历史归档。

## 约定：一条目一 issue，状态 = label

- **一个条目一个 issue**，标题用中文一句话说清问题/需求（列表页直接可读）；正文第一行写 `slug: kebab-name`（仅用于 worktree/分支命名）。
- **状态用 label 表达**，四态：
  - `b:open`：待认领（含想法级条目，正文注明「想法：未确认」）；
  - `b:doing`：已认领，开发中；
  - `b:done`：开发完成、自测通过，待主线合入测试；
  - `b:closed`：主线合入测试通过并人工确认（同时 close issue）。
- **引用用 issue 编号 `#N`**：commit message、issue 正文、文档里统一 `#N`（GitHub 自动链接）；条目间依赖写 `前置：#N`。
- **不维护任何手工索引表**——`gh issue list --label b:open` 就是当前待办。
- **变更记录 = issue comment**：每次改状态由改的一方追加一条 comment（对应过去的「git mv + 文件里追加一行」）。

## 准入：提出 ≠ 修改

backlog 只存「提出」阶段的产物。提需求要澄清并确认做法，提问题要核实并定位根因，产出写进 issue 就停下，不顺手改代码；方案/根因未定的想法级条目可以先进 `b:open`（注明「想法：未确认」），修改动作只有被明确要求时才做。建 issue 用模板 `.github/ISSUE_TEMPLATE/backlog.md`。

## 状态流转

### 认领（b:open → b:doing）：多开发者不撞的关键

```bash
# 1. 看待认领列表（服务器实时状态，不是本地快照）
gh issue list --label b:open

# 2. 认领前确认没人占
gh issue view <n> --json assignees,labels

# 3. 认领：加 assignee + 换 label + 留 comment
gh issue edit <n> --add-assignee @me --remove-label b:open --add-label b:doing
gh issue comment <n> --body "认领，worktree: agent/<slug>"

# 4. 复核：再读一次，assignee 必须是自己
gh issue view <n> --json assignees
```

GitHub 没有「没人占才占」的原子锁，第 2、3 步之间有理论时间窗，靠第 4 步复核兜底：发现 assignee 是别人就放弃这条（把自己从 assignee 移除、label 换回去）换一条。其他 agent 只从 `gh issue list --label b:open` 选活，已认领的天然不在列表里。

### 开发完成（b:doing → b:done）

`gh issue edit <n> --remove-label b:doing --add-label b:done` + comment 记录（测试报告路径/结论）。**不合入主线**，等主线 agent 合入测试。

### 合入确认（b:done → b:closed）

主线合入测试通过 + 人工确认：`gh issue edit <n> --remove-label b:done --add-label b:closed` + comment + `gh issue close <n>`。

### 退回（b:done → b:open）

合入测试有问题：`gh issue edit <n> --remove-label b:done --add-label b:open --remove-assignee <认领人>` + comment 写明问题，重新走认领。

## 其他

- 不用 GitHub Projects board（label 过滤已够，不引入第二套状态）；不搞 issue + 文件双轨镜像（必然漂移）。
- `closed-archive-*.md` 是迁移前文件夹 backlog 的 closed 条目归档（标题 + slug + 变更记录），条目完整正文见 git 历史。
- 迁移方案与实施记录见 `migration-github-issues.md`（issue #12）。
