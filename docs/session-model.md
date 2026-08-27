# Session 工作区模型（设计文档）

状态：设计阶段，未开始开发。

## 背景

当前围绕 dsh 的开发体验里并存着多套相似但不同的概念：

- dsh 的 workspace 和 session；
- VS Code 的 workspace（folder / multi-root workspace）；
- git 的 branch 和 worktree。

概念过多，用户需要在脑中对齐三套词汇。本文定义一个统一模型：**workspace 只有一个含义（= 一个文件夹，即 VS Code 窗口打开的目录）；session 是核心实体，branch 是它的持久化形态，worktree 是它的运行时形态**。

workspace 不必是 git 仓库。典型情形是 workspace 下的某个子文件夹是 git 仓库，session 的 branch 与 worktree 都挂在那个仓库上；workspace 里也可以有多个仓库、或暂时没有仓库（纯问答 session 不需要 git）。

## 概念映射

| 模型概念 | dsh | VS Code | git |
| --- | --- | --- | --- |
| workspace | workspace | workspace folder | —（不直接对应；仓库是 workspace 下的子文件夹） |
| session（静态/持久态） | session | — | branch（挂在 workspace 下某个仓库上） |
| session（运行态） | 运行中的 session | 打开的文件夹 | worktree（集中存放在 workspace 文件夹内） |
| 集成 session | — | — | 主分支上一个专用 session |

三者不是三个概念，而是同一个 session 生命周期的不同阶段。

## Session 生命周期

```
创建 ──→ 运行中 ──→ 待集成 ──→ 已合并 ──→ 已归档
(branch)  (+worktree)  (+worktree)   (branch)   (refs/archive)
```

1. **创建**：只建一个 branch ref，零成本，不检出任何文件。纯问答型 session 可以懒建——第一次要写文件时才真正建 branch。
2. **物化（运行）**：session 需要跑代码时，按需 `git worktree add` 出工作目录。为加速启动，复制源 worktree 的未跟踪/被忽略文件（`node_modules`、`.env`、构建缓存），macOS 上对重目录用 `cp -Rc`（APFS clonefile，写时复制、近乎零成本）。注意排除含绝对路径的产物（Python `.venv`、CMake cache 等），这类需要重建。
3. **开发**：每个对话轮次产生一个 WIP commit（而不是每个文件改动一个 commit，避免历史过碎）。commit message 带 trailer（如 `Dsh-Session: <id>`）关联 session，使 `git log` 成为"对话↔代码"的审计链。
4. **待集成**：session 完成开发，等待集成 session 合并。
5. **合并**：集成 session 把 session 分支合进主分支（squash 成一个 commit，主分支历史 = 对话轮次级别的记录）。
6. **归档**：已合并的 session 关闭。prune 掉 worktree；开发记录由 git 负责保留——合并后历史已在主分支中，session 分支 ref 可挪到 `refs/archive/<session-id>` 命名空间，避免淹没正常分支列表。ref 只是分组标签，删了也不丢 commit。

worktree 是**可丢弃的缓存**：任何时刻都可以 prune，需要时从 branch 重新物化。前提是遵守下面的脏状态策略。

## 集成 session

主分支是集成专用分支，上面常驻一个负责集成测试的 session：

- 有自己的 worktree（检出主分支）；
- 串行处理合并队列（多个 session 同时完成时必须串行化，避免并发合并冲突）；
- 合并后运行集成测试，失败时决定回退、修复还是打回给原 session。

## 不变量与约束

- **session ↔ branch 1:1**：branch 名派生自 session id，但通过一层映射表关联，不把 branch 名硬编码为 session 的唯一标识——为将来"一个 session 跨多仓库""多 session 协作一个分支"留余地。
- **写边界**：每个 session 都知道自己的两个位置——当前 worktree（运行时工作目录）和所属 workspace。session 只在自己的 worktree 内修改文件；workspace 对 session 是只读上下文，让它理解自己的目的（整体项目结构、其他仓库、文档等）。这条约束是"worktree 可随意丢弃"和"集成可串行"的前提。
- **脏状态策略**：worktree 可随意丢弃的前提是改动即时落 commit；若允许未提交修改，则 worktree 脏时禁止回收。两条路线择一，倾向前者（agent 场景 WIP commit 很廉价）。
- **worktree 集中存放**：统一放在 workspace 文件夹内的固定位置（如 `<workspace>/.dsh/worktrees/<session-id>`），不散落到 workspace 之外，也不放进仓库目录内部（避免嵌套仓库出现在 untracked 列表 / embedded repo 提示里）。这样所有 session 的工作目录都在 VS Code 窗口范围内可见。若 workspace 文件夹本身就是 git 仓库，则该目录要加进 `.gitignore`。
- **同一分支不被两处检出**：git 本身强制，模型天然满足。
- **worktree 状态不离开本机**：worktree 元数据在 `.git/worktrees/` 下，不提交、不推送；session 的可共享状态全部在 branch（commit）上。

## 架构：编排核心 + 瘦客户端

这套模型的核心（session 管理、branch/worktree 生命周期、集成队列、归档）全部是 git 操作和进程管理，发生在编辑器**之外**。编辑器只是观察窗：打开某个 session 的 worktree 给人看/改代码。因此分层为：

```
编排核心（CLI/服务：session↔branch↔worktree 映射、集成队列、归档）
   ├── VS Code 扩展（第一个瘦客户端）
   ├── dsh web UI（现成的客户端）
   └── 未来可选：独立编辑器（又一个客户端）
```

"做成扩展还是独立编辑器"因此从生死抉择降级为"要不要多加一个客户端"，现在选扩展不堵死任何路。

## 决策：VS Code 扩展，暂不 fork

结论：**现阶段以 VS Code 扩展承载，不 fork Code-OSS**。

理由：

- 扩展能力足够覆盖需求：管理 git/worktree/子进程是普通 Node 能力；session 列表与集成状态用 TreeView/Webview 呈现；打开 session = 用 `vscode.workspace` API 打开对应 worktree 文件夹（multi-root 亦可）。
- fork 的代价：失去官方 Marketplace 授权（只能接 Open VSX）；Remote SSH/WSL/Containers 扩展在法律上不允许跑在 fork 上；需自行承担全平台打包、签名、公证、自动更新与永久跟随上游的维护；用户需放弃现有编辑器环境，采用门槛极高。

重新评估 fork 的触发条件：需要改编辑器外壳本身时——例如把 session 列表提升为第一公民取代文件资源管理器、深度定制 diff/merge 作为主编排界面、摆脱 VS Code 窗口模型。届时按"编排核心已独立"的前提，fork 只是新增一个客户端。

## 开放问题

- dsh 现有的 session/workspace API 与本模型的对接方式未评估，需要读 dsh 接口后确定落地路径。
- 集成 session 的冲突处理策略（自动 rebase？打回给原 session？人工介入入口？）待定。
- 多 session 并行时的 VS Code 呈现：multi-root workspace 每个根对应一个 session worktree，但 UI 文案上要避免与"multi-root workspace"一词混淆。
- 依赖复制的排除清单（哪些被忽略目录含绝对路径、必须重建）需要按实际技术栈维护。
