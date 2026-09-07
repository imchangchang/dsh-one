# backlog 迁移到 GitHub Issues：新工作流程与迁移方案

## 为什么迁

当前 backlog（`docs/backlog/` 文件夹即索引）在多开发者并行时的硬伤：

1. **认领靠本地快照**：每个 worktree 里的 backlog 是自己 checkout 时的样子，别人刚认领的条目本地看不见，同一条目可能被两个 agent 同时认领；改状态要提交到 main 再 push，并发 push 会撞。
2. **条目信息单薄、没有统一编号**：引用靠 kebab-name 文件名，口头说"做 xxx"还行，commit 里没有可链接的编号；标题只有一个英文短名，列表里看不出条目在说什么。

GitHub Issues 原生解决这两点：状态在服务器上实时可读，认领动作是服务端原子操作；每条 issue 有全仓库唯一的 `#N` 编号，commit 引用 `#N` 自动链接；标题和正文没有长度压力。

## 心智模型对照（只换载体，状态机不变）

| 现在（文件夹 backlog） | 迁移后（GitHub Issues） |
|---|---|
| 一个条目一个 md 文件 | 一个条目一个 issue |
| 状态 = 目录 open/doing/done/closed | 状态 = label：`b:open` / `b:doing` / `b:done` / `b:closed` |
| 改状态 = `git mv` + 文件里追加一行 | 改状态 = `gh issue edit` 换 label + 追加一条 comment |
| 引用 = kebab-name 文件名 | 引用 = issue 编号 `#N`（commit / issue / PR 里自动链接） |
| 标题 = 文件名 | 标题 = 中文详细标题；kebab-name 保留在正文第一行（给 worktree 命名用） |
| 「变更记录」小节 | issue comments（天然带时间和作者） |
| `ls docs/backlog/open` | `gh issue list --label b:open` |

## 新工作流程

### issue 写法

- **标题**：中文，一句话说清是什么问题/要什么效果（如「会话列表：点开未读会话时列表瞬时重排」），让列表页直接可读。
- **正文**用模板（`.github/ISSUE_TEMPLATE/backlog.md`），结构沿用现在的条目约定：
  - 第一行：`slug: kebab-name`（worktree/分支命名仍用它，中文标题不适合做目录名）；
  - 背景与现象 / 根因或现状 / 建议方案 / 涉及代码位置 / 前置依赖（写 `前置：#N`）。
- **想法级条目**照常允许，正文注明「想法：未确认」。

### 提出 ≠ 修改（不变）

提需求/提问题只到「建 issue」为止，不顺手改代码；模板里写明这条。新 issue 默认打 `b:open`。

### 认领（open → doing）：多开发者不会撞的关键环节

```
# 1. 看待认领列表（读的是服务器实时状态，不是本地快照）
gh issue list --label b:open

# 2. 认领前确认没人占
gh issue view <n> --json assignees,labels

# 3. 认领：加 assignee + 换 label + 留 comment
gh issue edit <n> --add-assignee @me --remove-label b:open --add-label b:doing
gh issue comment <n> --body "认领，worktree: agent/<slug>"

# 4. 复核：再读一次，assignee 必须是自己
gh issue view <n> --json assignees
```

GitHub 没有「没人占才占」的原子锁，第 2、3 步之间有理论上的时间窗。靠第 4 步复核兜住：发现 assignee 是别人就放弃这条（把自己从 assignee 移除、label 换回去），换一条。两个 agent 同时抢同一条的概率极低，复核机制够用。

**其他开发者的 agent 只认 label**：派活/选活的入口统一是 `gh issue list --label b:open`，已被认领的（`b:doing`、有 assignee）天然不出现在列表里。

### 后续流转

- **doing → done**（开发完成、自测通过，不合入主线）：
  `gh issue edit <n> --remove-label b:doing --add-label b:done` + comment 记录（测试报告链接/结论）。
- **done → closed**（主线合入测试通过 + 人工确认）：
  `gh issue edit <n> --remove-label b:done --add-label b:closed` + `gh issue close <n>`。
- **done → open**（合入测试有问题退回）：
  `gh issue edit <n> --remove-label b:done --add-label b:open --remove-assignee <认领人>` + comment 写明问题，重新走认领。

### 引用

- commit message 里写 `#<n>`（如 `chat: 会话列表粘滞排序 (#42)`），GitHub 自动链接到 issue；
- 条目间依赖写 `前置：#N`；
- 口头/文档引用统一用 `#N`，slug 只在建 worktree 时用。

### 不做的事

- 不用 GitHub Projects board：label 过滤已够，不引入第二套状态。
- 不搞 issue + 文件双轨镜像：必然漂移，issue 是唯一事实源。

## 迁移步骤

现状：open 12 条、doing 1 条、done 1 条、closed 181 条。

### 1. 建 label

```
gh label create b:open   --description "待认领"      --color 1d76db
gh label create b:doing  --description "开发中"      --color fbca04
gh label create b:done   --description "待合入主线"  --color 0e8a16
gh label create b:closed --description "已合入确认"  --color 5319e7
```

### 2. 建 issue 模板

`.github/ISSUE_TEMPLATE/backlog.md`：标题提示中文详细写；正文骨架 = slug 行 + 背景与现象 + 根因或现状 + 建议方案 + 涉及代码位置 + 前置依赖；模板说明里写「提出 ≠ 修改」。

### 3. 迁移 open / doing / done 共 14 条

逐条：`gh issue create`（标题用原条目 H1，正文整段搬过去，第一行补 `slug:`），打上对应 label；doing/done 的条目同时 `--add-assignee` 给原认领人；原文件末尾的「变更记录」每行转一条 comment（保留时间线）。迁完一条删一个 md 文件。

### 4. closed 181 条不逐条迁

按现有约定（`closed/` 只进不出、定期归档）汇总成一份 `docs/backlog/closed-archive-2026Q3.md`（标题 + 一句话结论 + 原变更记录），删除原 181 个文件。这些是已完成历史，不值得占用 issue 编号。

### 5. 更新约定文档

- `docs/backlog/README.md`：改为新流程（本文件的正本），保留 `closed-archive-*.md` 说明；
- `AGENTS.md`：backlog 维护一节改为指向 issue 流程；
- `.agents/skills/backlog-folder-index/`：废弃，替换为 github-issues 版 skill（状态机 + gh 命令 + 认领复核）；
- `.agents/skills/worktree-dev-flow/`：认领步骤从 `git mv` 改为上面的 gh 认领流程。

### 6. 验证清单

- `gh issue list --label b:open` 列出 12 条（迁移后），内容与原 md 一致；
- 走一遍完整流程：认领一条 → doing → done → closed，确认 label/assignee/comment 都对；
- 两个 session 同时 `gh issue list` 看到的待认领列表一致；
- 全仓库 grep `docs/backlog/open` 等旧路径，修掉残留引用。

## 实施记录（2026-09-07 完成）

- label 四个已建：`b:open` / `b:doing` / `b:done` / `b:closed`；issue 模板 `.github/ISSUE_TEMPLATE/backlog.md` 已建。
- open 11 条 + 迁移条目本身（b:doing）+ done 1 条，共 13 条已迁成 issue #1–#13，原「变更记录」逐行转为 comment，逐条核对行数一致。
- closed 182 条（迁移期间新增 1 条）归档进 `closed-archive-2026Q3.md` 后删除原文件；open/doing/done/closed 四个目录已删。
- 约定文档已更新：`docs/backlog/README.md`（新流程正本）、`AGENTS.md`、`.agents/skills/backlog-github-issues/`（新 skill，已替代并删除 `backlog-folder-index`）、`.agents/skills/worktree-dev-flow/`（认领/完成/合入/退回步骤改 gh 命令）。
- 残留引用已修：`scripts/check-i18n.sh`、`src/ui/chatViewHtml.ts`、`test/ui/style.css`、`test/sandbox/Dockerfile`、`docs/architecture.md`（两处）、`docs/dsh-web-expandable-ui-research.md`、`test/linkPath.test.ts`（测试样例路径）。历史产物（`test/sandbox/verify.dsh-embed-cleanup.ledger.json` 的 notes）按原样保留。
- 迁移条目本身（issue #12）按新流程走完认领（b:doing + assignee），实施完成后转 b:done。
