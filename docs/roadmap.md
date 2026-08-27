# DSH One Roadmap

## 方向：从嵌入 UI 到 VSCode 原生前端

现状是 iframe 嵌入 dsh web UI。已决策的演进方向：**VSCode 原生前端**，聊天面设计参考 Claude Code 的 VSCode 扩展（CLI 本体 + 薄桥接扩展的分层，dsh 对应 CLI、本扩展对应 VSCode 侧前端）。分三个阶段。

### 阶段一：管理面原生化（已完成）

- Session TreeView：会话列表 / 新建 / 重命名 / 归档 / 聚焦（`src/ui/sessionTree.ts`）。已知过渡限制：嵌入的 dsh web UI 无深链，点击会话只能聚焦面板，无法远程切换会话——待阶段二自写聊天面后解决。
- workspace 映射自动化：Sessions 树按 workspace 分组，当前文件夹置顶，其他 workspace 可从上下文菜单"在 VSCode 中打开文件夹"。
- 反向桥补丁已退役（`src/server/workspaceBridge.ts` 连同 `src/pure/workspace.ts` 已删除）；`src/server/manager.ts` 的 `preseedWorkspace` 仍保留——嵌入 UI 的落地策略还依赖它。

### 阶段二：聊天面自写 webview（骨架完成）

侧边栏新增原生聊天视图 `dshOne.chat`（WebviewView），设计参考 Claude Code：工具调用卡片可见可折叠、权限确认/提问内联在对话流上方不打断焦点、运行中发送按钮变为常驻停止按钮。架构：宿主侧 `src/ui/chatView.ts` 持有 `ChatSessionController`（`src/server/chatSession.ts`，折叠 mux 事件为 ChatState），前端 `src/ui/chat/webview.ts`（marked + dompurify 渲染 markdown，esbuild 打包）按 `src/pure/chatContract.ts` 的冻结契约收发消息。Sessions 树点击会话即附着并聚焦聊天视图；新建会话直接落入聊天；归档/删除当前会话或服务停止时回空态；每次服务运行首次刷新自动附着当前 workspace 最新会话。

**已排除 Chat Participant API**，原因：

- 权限确认 / 工具块 / thinking / 内嵌 diff 全部是 proposed API，无法发布 Marketplace；
- 输入框模型、模式切换器是 Copilot 私有 UI，第三方拿不到。

行业佐证：Cline / Roo Code / Continue 全部选自写 webview。

骨架已知缺口（待后续补齐）：无图片附件、无模型/模式切换、无消息分页（历史全量渲染）、空白会话不在树中显示故自动附着只挑有内容的会话。

### 阶段三：聊天面精化（借鉴 Claude Code 设计）

- 权限模式指示器常驻输入框底部；
- 权限确认内联在对话流中，不打断焦点；
- 工具调用默认可见、可折叠，另有 Focus view；
- diff 双层：聊天内 inline + 一键跳原生 diff 视图；
- Plan 产出为 Markdown 文档；
- `@` 模糊引用文件；
- session 历史分组 + 搜索；
- `session.fork` 做 rewind。

### dsh API 支撑（已核实 0.1.1-rc.2）

可支撑：

- WS `/api/events.mux` 流式事件，`assistant/chunk` 结构化增量；
- `session.prompt`（queue / steer，斜杠命令同入口）；
- `approval/requested` → POST `/api/respond` 权限回环；`question/requested` 同构；
- `ToolEventView`：host 已算好 generic / terminal / diff 渲染意图；
- `session.models` / `selectModel`；`agentPreset.*`；permissions 投影 + `/permission` 命令；
- `session.search` / `fork` / `rename`。

缺口：

- 附件仅支持图片；
- client-runtime 的运行时代码是浏览器 bundle，不能在扩展宿主复用——事件折叠要自己写（契约 `.d.ts` 完备）。

### 与 docs/session-model.md 的关系

`docs/session-model.md` 是长期北极星（session = branch / worktree 模型）；本文的阶段是它的演进路径。

## 已知不足

分两类：**缺陷**是现状就有问题、该修的；**增强**是锦上添花。每条注明现状依据。

| 项 | 类别 | 说明 |
| --- | --- | --- |
| Remote（SSH/WSL/容器）未验证 | 缺陷 | 声明了 `extensionKind: ["workspace"]`（跑在远端），webview 里访问 127.0.0.1 依赖 VSCode 自动端口转发，理论上可行但没实测过。 |
| 多窗口 port=0 各起各的 | 缺陷 | `port: 0` 时跳过收养探测（`src/server/manager.ts:136`），每个窗口各 spawn 一个 dsh 实例。多个实例并发写 `~/.dsh` 正是收养机制要防的场景，目前靠"默认端口非 0"规避。 |
| 真实 UI 未经人工点验 | 缺陷 | iframe 嵌入官方 UI 的完整链路（含 `dsh_embed=vscode` 的侧栏隐藏效果）没有人工验证记录；单测只覆盖 `src/pure/`。 |

## 候选方向

| 项 | 类别 | 说明 |
| --- | --- | --- |
| Remote 实测 | 增强 | 在 SSH / WSL / devcontainer 三种环境各过一遍发版点验清单（见 `docs/development.md`），根据结果决定改代码还是改 README 的限制声明。 |
| 心跳看门狗防孤儿 | 增强 | 目前 VSCode 崩溃（非 deactivate 路径）会留下孤儿 dsh 进程。可以加周期性心跳文件，dsh 侧或扩展重启时发现陈旧实例做提示/回收（回收必须沿用收养语义，只动自己 spawn 过的）。 |
| 上游融合：dsh_embed 与 postMessage 桥 | 增强 | 扩展侧融合（workspace 预置，空窗口侦听桥已随阶段一退役）已落地，但受限于 dsh 客户端能力：rc.2 未消费 `dsh_embed=vscode`（侧栏无法隐藏）、无 workspace 锁定模式、无 postMessage 桥（无法深链/跟随打开）。需给上游 dsh 提 issue/PR。阶段二落地后本项自然消解。 |
| Copilot LM Provider | 增强 | 把 dsh 的模型能力注册为 VSCode Language Model Provider（`vscode.lm`），让 Copilot Chat 等消费。属于新能力探索，优先级最低。 |
