---
name: backlog-folder-index
description: 在 git 仓库里用「文件夹即索引」结构维护 backlog：docs/backlog/open + closed，一个条目一个文件，文件名用语义化 kebab-name（不带序号前缀），git mv 改状态，不维护任何手工索引表。多 session / 多 agent / 多 worktree 并发写 backlog 不会互相冲突。当用户要记录、整理、查看 backlog、遗留问题、待办事项，或要在新工程里搭建这套 backlog 结构时使用。
---

# Backlog：文件夹即索引

## 解决的问题

共享的索引文件（一张 markdown 表格记录所有条目状态）是并发写入的冲突点：两个 session 同时加条目、改状态必撞。本方案把状态挪到**路径**上，加条目 = 新建文件，改状态 = `git mv`，并发操作碰的永远是不同文件，git 合并天然无冲突。

文件名**不带序号前缀**：编号要"取当前最大 ID + 1"，两个 session 并发时各自取到同一个号，还是撞。语义化 kebab-name（`mux-reconnect.md`）天然唯一，谁都不用先读全局状态就能命名。

## 目录结构

```
docs/backlog/
├── README.md          # 只有约定说明，没有索引表
├── open/              # 未做 / 进行中 / 部分完成
│   ├── marketplace-publish.md
│   └── mux-reconnect.md
└── closed/            # 已解决
    └── ...
```

## 规则

- **一个条目一个文件**，命名 `kebab-name.md`，只写描述内容的语义化名字，不加序号/日期前缀。
- **优先级不靠文件名表达**，需要时在正文首部写一行「优先级：高/中/低」。
- **改状态就是 `git mv`**：`git mv docs/backlog/open/x.md docs/backlog/closed/`，不动文件内容。
- **绝不建手工索引表/状态看板文件**。`ls docs/backlog/open` 就是当前待办。
- 条目内容包含：背景与现象、根因或现状、建议方案、涉及代码位置。有前置依赖在正文写一行「前置：kebab-name」。
- 引用条目用文件名（"做 mux-reconnect"）。
- `closed/` 只进不出；文件多到碍事时把旧条目汇总成一个 `closed/archive-YYYYQn.md` 再删原文件。

## 在新工程搭建

1. 建目录：`mkdir -p docs/backlog/open docs/backlog/closed`（closed 放空，git 不跟踪空目录的话加一个 `.gitkeep`）。
2. 把上面的「目录结构」和「规则」两节写进 `docs/backlog/README.md`。
3. 在工程的 `AGENTS.md`（或等价的 agent 约定文件）里加一行指向：`backlog 维护见 docs/backlog/README.md，加条目建文件、改状态 git mv，不要建索引表`。
4. 已有 markdown  backlog 的迁移：每条拆成独立文件、按语义起 kebab-name、挪进 open/，删掉旧索引表，全仓库 grep 旧路径修引用。

## 边界：什么时候该换 bd

这套结构回答"有什么活"，回答不了"现在能干什么"——没有结构化的依赖和认领状态。当出现这些信号时换 [beads (bd)](https://github.com/steveyegge/beads)：多个 agent 需要自动领任务、条目间依赖链复杂（blocked-by 成网）、open 里长期超过 ~30 条。

## 复用这个 skill 本身

- 项目级（随仓库走，clone 即用）：复制本目录到 `<仓库>/.agents/skills/backlog-folder-index/`。
- 个人级（本机所有工程可用）：复制到 `~/.dsh/skills/` 或 `~/.agents/skills/`。
