# DSH One Roadmap

本文对应 dsh-one 2.0.0（2026-09-20）。下面「已完成」说的是到这个版本为止的状态；更早的形态（iframe 嵌入、自研聊天 webview、自研 vanilla 侧栏）只作历史记录。

## 方向：装配官方前端，不自研聊天 UI（2026-09-14 修订，#68）

历史演进：iframe 嵌入（v0.x）→ 自研聊天 webview（#11 系列，已归档于 `develop/dsh-web-alignment`）→ **官方组件装配**（#60 试错、#64 M1 落地、#68 下线自研聊天区后成为唯一对话区）。

现状形态：**对话区用官方 dsh web 前端组件在自有 shell 里组装，侧栏树是我们自研的**（代码在 `src/ui/assembly/`、`src/server/assemblyMirror.ts`；架构讲解见 `docs/assembly-architecture.html`）。侧栏位（`dshOne.chat` 视图）从 #70 起渲染的是**装配的官方侧栏**，挂在里面的是自有插件 `@dsh-one/dsh-workspace-tree` 的树（它 shadow 官方侧栏树；见 `src/extension.ts` 的 `registerAssembledSidebar`）。已拍板不再自研聊天 UI 的原因：自研派要长期追官方协议与 UI 对齐，每个 dsh 版本升级都是一轮重活（#11 系列做到 537 单测仍难逃此命）；装配派让官方前端自己演进，dsh-one 只维护 shell、代理与过滤清单。

### 已完成的阶段

- **装配对话区（#64 M1，2026-09-19 起在 `main` 上）**：插件整包过滤（block list：官方外框 + 官方侧栏）+ 自有外框插件接管根外框与主题 + loopback 代理（登录 cookie、跨来源改写、`sec-fetch-*` 剥离）。浏览器验证 + VS Code 验证两道关全过。
- **cordis 装配整线合入 `main`（2026-09-19，merge `9fbc5da9`）**：`develop/cordis-chat` 整线的代码已在 `main` 上（提交信息：「合入 develop/cordis-chat 整线（cordis 装配：对话区官方组件装配 + 侧栏自研树）」）。**#65 与 #66 这两个 goal 的 issue 仍然开着**，状态见下一节。
- **默认打开与旧聊天区下线（#68）**：点活动栏 DSH One 图标自动打开装配对话区（每窗口一次，手动关过不再强开）；旧自研聊天区全部代码、命令、harness、ledger 场景下线。
- **管理面（旧形态，历史）**：会话列表 / 新建 / 重命名 / 归档 / 聚焦这套自研 vanilla 侧栏（数据层 `src/ui/sessionsStore.ts`）、按 workspace 分组与当前文件夹置顶，属自研侧栏那一代。侧栏换成装配树之后，列表与分组渲染归 `@dsh-one/dsh-workspace-tree`，`sessionsStore.ts` 留下的是宿主侧状态（标签组、回收站、状态文件）与标签桥。旧侧栏代码（`src/ui/sessionsView.ts` / `src/ui/sessionsWebview.ts`）**已摘钩保留**，作 #65 的迁移参照物，当前不参与运行。

### 装配线后续（按 issue 顺序）

- **#65 goal 2：特有功能插件化**（`b:doing`，进行中）——把 dsh-one 特有交互（如侧栏联动的会话深链）做成官方装载协议下的插件。
- **#66 goal 3：通用组件上游化**（`b:open`，待认领）——把验证过的自有组件提回上游，减少长期分叉。

界面通道：侧栏与对话区是两个 webview 页面，各读自己那份官方会话快照。侧栏点会话行会经选择桥上报宿主（`dshOne.sessionSelected`），宿主把会话面板创建 / 聚焦 / 就地切到该会话（`src/ui/assembly/shell/sessionBridgePlugin.ts` → `src/ui/assemblyView.ts` 的 `openSessionChat`）；面板侧的启动注入走 `__DSH_ONE_BOOT__.sessionId`（`src/ui/assembly/shell/sessionBootPlugin.ts`，常驻判据是装配实验室的 F-62）。旧记录里那句「装配页内切会话不经过扩展，侧栏高亮以最后一次从扩展侧打开的会话为准；深链到指定会话待 #65」是自研 vanilla 侧栏那一代的限制，随旧侧栏一同退役。

## 已知不足

分两类：**缺陷**是现状就有问题、该修的；**增强**是锦上添花。每条注明现状依据。

| 项 | 类别 | 说明 |
| --- | --- | --- |
| Remote（SSH/WSL/容器）未验证 | 缺陷 | 声明了 `extensionKind: ["workspace"]`（跑在远端），webview 里访问 127.0.0.1 依赖 VS Code 自动端口转发，理论上可行但没实测过。 |
| 多窗口 port=0 各起各的 | 缺陷 | `port: 0` 时跳过复用探测（`src/server/manager.ts`），每个窗口各 spawn 一个 dsh 实例。多个实例并发写 `~/.dsh` 正是复用机制要防的场景，目前靠"默认端口非 0"规避。 |
| 装配对话区的人工点验依赖发版清单 | 缺陷 | 装配的浏览器验证已自动化（第一道关），但 VS Code 验证（最终准绳）目前靠人按清单开窗实测。 |

## 候选方向

| 项 | 类别 | 说明 |
| --- | --- | --- |
| Remote 实测 | 增强 | 在 SSH / WSL / devcontainer 三种环境各过一遍发版点验清单（见 `docs/development.md`），根据结果决定改代码还是改 README 的限制声明。 |
| 心跳看门狗防孤儿 | 增强 | 目前 VS Code 崩溃（非 deactivate 路径）会留下孤儿 dsh 进程。可以加周期性心跳文件，dsh 侧或扩展重启时发现陈旧实例做提示/回收（回收必须沿用复用语义，只动自己 spawn 过的）。 |
| Copilot LM Provider | 增强 | 把 dsh 的模型能力注册为 VS Code Language Model Provider（`vscode.lm`），让 Copilot Chat 等消费。属于新能力探索，优先级最低。 |
| Session 工作区模型（session ↔ branch / worktree） | 增强 | 未实现的设计草图：session 是核心实体，branch 是它的持久化形态，worktree 是运行时形态，另有一个常驻主分支的集成 session 串行处理合入队列。仓库里目前没有任何相关实现（`src/` 与 `packages/` 只有 git 的只读查询）。草图与开放问题见 `docs/session-model.md`。 |
