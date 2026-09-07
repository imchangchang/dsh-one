---
name: backlog-github-issues
description: 用 GitHub Issues 维护 backlog：一条目一 issue，状态 = label（b:open/b:doing/b:done/b:closed），认领 = gh 加 assignee + 换 label + 复核，改状态 = 换 label + comment 留痕，引用用 #N 编号。服务器实时状态解决多开发者/多 agent 并行认领撞车。提出与修改分离：发现问题只核实记录成 issue，不顺手改代码。当要记录、整理、查看 backlog、遗留问题、待办事项，或在新工程里搭建这套流程时使用。
---

# Backlog：GitHub Issues

## 解决的问题

backlog 需要回答"有什么活、谁在做、做到哪了"，并且**多个开发者 / 多 agent / 多 session 并行时不能撞**。文件夹 backlog（`docs/backlog/` 目录即索引）的硬伤是状态在 git 里：每个 worktree 看到的是自己 checkout 时的快照，别人刚认领的条目本地看不见，同一条目可能被重复认领；改状态要提交 main 再 push，并发 push 会撞。

GitHub Issues 原生解决：状态在服务器上实时可读，认领是服务端操作；每条 issue 有全仓库唯一 `#N` 编号，commit 引用 `#N` 自动链接；标题和正文没有长度压力，中文详细标题让列表页直接可读。

## 核心模型：一条目一 issue，状态 = label

- **一个条目一个 issue**。标题中文一句话说清问题/需求；正文第一行写 `slug: kebab-name`（仅用于 worktree/分支命名，中文标题不适合做目录名）。
- **状态 = label**，四态：`b:open`（待认领）/ `b:doing`（开发中）/ `b:done`（开发完成，待主线合入测试）/ `b:closed`（合入测试通过 + 人工确认，同时 close issue）。
- **改状态 = `gh issue edit` 换 label + 追加一条 comment**（变更记录），两件事一起做。
- **引用 = `#N`**：commit message、issue 正文、文档统一用 `#N`；条目间依赖写 `前置：#N`。
- **绝不建手工索引表/看板文件**。`gh issue list --label b:open` 就是当前待办。
- 不用 GitHub Projects board（label 够用，不引入第二套状态）；不搞 issue + 文件双轨镜像（必然漂移）。

## 准入与流程：提出 ≠ 修改

backlog 只存「提出」阶段的产物。需求、问题、修改动作是三类不同的活：**发现问题 ≠ 被授权修复，提出需求 ≠ 被授权开发**。「修改动作」是独立环节，只有被明确要求时才执行。

- **提需求**：澄清需求 → 提出方案 → 确认做法 → 建 issue（`b:open`），到此为止。
- **提问题**：核实问题 → 定位根因 → 把根因写进 issue → 建 issue（`b:open`），到此为止。
- **想法级条目也允许**：方案/根因未定的可以先进 `b:open`，正文注明「想法：未确认」。
- 每次提出/核实完就停下，产出写进 issue，**不顺手把代码改了**。

## issue 写法

- 标题：中文，一句话说清（如「会话列表：点开未读会话时列表瞬时重排」）。
- 正文结构（建议做成 `.github/ISSUE_TEMPLATE/backlog.md` 模板）：
  - 第一行 `slug: kebab-name`；
  - 背景与现象 / 根因或现状 / 建议方案（含被否掉的备选）/ 涉及代码位置 / 前置依赖（`前置：#N`）。

## 状态流转

### 认领（b:open → b:doing）

```bash
# 1. 看待认领列表（服务器实时状态）
gh issue list --label b:open

# 2. 认领前确认没人占
gh issue view <n> --json assignees,labels

# 3. 认领：加 assignee + 换 label + 留 comment
gh issue edit <n> --add-assignee @me --remove-label b:open --add-label b:doing
gh issue comment <n> --body "认领，worktree: agent/<slug>"

# 4. 复核：再读一次，assignee 必须是自己
gh issue view <n> --json assignees
```

GitHub 没有「没人占才占」的原子锁，第 2、3 步之间有理论时间窗，靠第 4 步复核兜底：发现 assignee 是别人就放弃（移除自己的 assignee、label 换回 b:open）换一条。**认领不复核等于没认领**——这是多开发者不撞的关键约定。

### 开发完成（b:doing → b:done）

`gh issue edit <n> --remove-label b:doing --add-label b:done` + comment 记录（测试报告/结论）。**不合入主线**，等主线合入测试。

### 合入确认（b:done → b:closed）

`gh issue edit <n> --remove-label b:done --add-label b:closed` + comment + `gh issue close <n>`。

### 退回（b:done → b:open）

合入测试有问题：`gh issue edit <n> --remove-label b:done --add-label b:open --remove-assignee <认领人>` + comment 写明问题，重新走认领。

## 在新工程搭建

1. 建四个 label：`gh label create b:open/b:doing/b:done/b:closed`（描述：待认领/开发中/待合入主线/已合入确认）。
2. 建 `.github/ISSUE_TEMPLATE/backlog.md`（「issue 写法」一节的结构 + 「提出 ≠ 修改」说明，默认 label `b:open`）。
3. 在工程的 `AGENTS.md` 里加一行指向：backlog 维护用 GitHub Issues，加条目 = 建 issue，认领/改状态 = gh 换 label + comment，认领后必须复核 assignee。
4. 已有文件式 backlog 的迁移：open/doing/done 逐条 `gh issue create`（标题 = 原 H1，正文首行补 slug，原变更记录逐行转 comment），closed 条目汇总成一份归档 md 后删原文件；全仓库 grep 旧路径修引用。

## 边界

同文件夹 backlog：这套结构回答"有什么活、认领到哪了"，回答不了"现在能自动干什么"——没有结构化依赖和自动派活。条目间依赖链复杂成网、open 长期超 ~30 条时，评估换 [beads (bd)](https://github.com/steveyegge/beads) 或引入 Projects board。

## 复用这个 skill 本身

- 项目级（随仓库走，clone 即用）：复制本目录到 `<仓库>/.agents/skills/backlog-github-issues/`。
- 个人级（本机所有工程可用）：复制到 `~/.dsh/skills/` 或 `~/.agents/skills/`。
