# DSH One Roadmap

## 方向：装配官方前端，不自研聊天 UI（2026-09-14 修订，#68）

历史演进：iframe 嵌入（v0.x）→ 自研聊天 webview（#11 系列，已归档于 `develop/dsh-web-alignment`）→ **官方组件装配**（#60 试错、#64 M1 落地、#68 下线自研聊天区后成为唯一对话区）。

现状形态：**自研会话侧栏 + 装配对话区**。对话区用官方 dsh web 前端组件在自有 shell 里组装（代码在 `src/ui/assembly/`、`src/server/assemblyMirror.ts`；架构讲解见 `docs/assembly-architecture.html`）。已拍板不再自研聊天 UI 的原因：自研派要长期追官方协议与 UI 对齐，每个 dsh 版本升级都是一轮重活（#11 系列做到 537 单测仍难逃此命）；装配派让官方前端自己演进，dsh-one 只维护 shell、代理与过滤清单。

### 已完成的阶段

- **管理面原生化**：会话列表 / 新建 / 重命名 / 归档 / 聚焦（侧栏 `dshOne.chat` 视图，数据层 `src/ui/sessionsStore.ts`），按 workspace 分组、当前文件夹置顶。
- **装配对话区（#64 M1，2026-09-19 起在 `main` 上）**：插件整包过滤（blocklist：官方外框 + 官方侧栏）+ 自有外框插件接管根外框与主题 + loopback 代理（登录 cookie、跨来源改写、sec-fetch-* 剥离）。浏览器验证 + VS Code 验证两道关全过；对话区的 cordis 装配整线（`develop/cordis-chat`，条目 #63 → #64 → #65 → #66）已于 2026-09-19 合入 `main`。
- **默认打开与旧聊天区下线（#68）**：点活动栏 DSH One 图标自动打开装配对话区（每窗口一次，手动关过不再强开）；旧自研聊天区全部代码、命令、harness、ledger 场景下线。

### 装配线后续（按 issue 顺序）

- **#65 goal 2：特有功能插件化**——把 dsh-one 特有交互（如侧栏联动的会话深链）做成官方装载协议下的插件。
- **#66 goal 3：通用组件上游化**——把验证过的自有组件提回上游，减少长期分叉。

已知过渡限制：装配页内切会话不经过扩展，侧栏高亮以「最后一次从扩展侧打开的会话」为准；从侧栏点会话能聚焦装配面板，但深链到指定会话待 #65。

## 已知不足

分两类：**缺陷**是现状就有问题、该修的；**增强**是锦上添花。每条注明现状依据。

| 项 | 类别 | 说明 |
| --- | --- | --- |
| Remote（SSH/WSL/容器）未验证 | 缺陷 | 声明了 `extensionKind: ["workspace"]`（跑在远端），webview 里访问 127.0.0.1 依赖 VSCode 自动端口转发，理论上可行但没实测过。 |
| 多窗口 port=0 各起各的 | 缺陷 | `port: 0` 时跳过复用探测（`src/server/manager.ts`），每个窗口各 spawn 一个 dsh 实例。多个实例并发写 `~/.dsh` 正是复用机制要防的场景，目前靠"默认端口非 0"规避。 |
| 装配对话区的人工点验依赖发版清单 | 缺陷 | 装配的浏览器验证已自动化（第一道关），但 VS Code 验证（最终准绳）目前靠人按清单开窗实测。 |

## 候选方向

| 项 | 类别 | 说明 |
| --- | --- | --- |
| Remote 实测 | 增强 | 在 SSH / WSL / devcontainer 三种环境各过一遍发版点验清单（见 `docs/development.md`），根据结果决定改代码还是改 README 的限制声明。 |
| 心跳看门狗防孤儿 | 增强 | 目前 VSCode 崩溃（非 deactivate 路径）会留下孤儿 dsh 进程。可以加周期性心跳文件，dsh 侧或扩展重启时发现陈旧实例做提示/回收（回收必须沿用复用语义，只动自己 spawn 过的）。 |
| Copilot LM Provider | 增强 | 把 dsh 的模型能力注册为 VSCode Language Model Provider（`vscode.lm`），让 Copilot Chat 等消费。属于新能力探索，优先级最低。 |
