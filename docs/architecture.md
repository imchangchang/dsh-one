# DSH One 架构

本文面向接手开发的人。定位：DSH One 是 dsh 与 VSCode 之间的**桥接插件**——dsh 由用户自行安装（`npm install -g @deepseek-ai/dsh@next`），扩展负责定位/启动/连接 dsh 并提供 VSCode 侧 UI（现阶段直接 iframe 嵌入官方 Web 界面，原生前端方向见 `docs/roadmap.md`）。

行号引用以当前 main 为准（`src/server/manager.ts:45` 这种格式）；代码改动后请同步更新本文。

## 模块结构

```
dsh-one/
├── package.json            # 清单：命令、配置项、侧边栏 view、extensionKind
├── build.mjs               # esbuild 打包脚本，双入口：dist/extension.js（宿主）+ dist/chatWebview.js（聊天前端）
├── src/
│   ├── extension.ts        # activate/deactivate 入口，注册命令与 view
│   ├── log.ts              # 输出通道日志，写入前对 URL query 值脱敏
│   ├── server/
│   │   ├── locateDsh.ts    # 定位 dsh 可执行文件（dshPath 配置 → PATH → 报错引导安装）
│   │   ├── manager.ts      # dsh web 进程生命周期：探测/收养/spawn/就绪/清理
│   │   ├── dshRpc.ts       # host RPC 客户端（workspace.create、session 增删改查等）
│   │   └── hostEvents.ts   # 订阅 host 事件流（WS /api/events.host），转发 method
│   ├── ui/
│   │   ├── webview.ts      # 侧边栏 WebviewView + 编辑器标签页 WebviewPanel，iframe 嵌入
│   │   ├── sessionTree.ts  # Sessions 树视图（TreeDataProvider）：基线拉取 + 事件防抖刷新
│   │   ├── chatView.ts     # Chat 视图（WebviewViewProvider）：持有 ChatSessionController，推状态/收动作
│   │   ├── chat/           # 聊天 webview 前端（浏览器上下文，esbuild 打包进 dist/chatWebview.js）
│   │   └── statusbar.ts    # 状态栏指示
│   └── pure/               # 纯逻辑，禁止 import vscode（可用 node --test 直接单测）
│       ├── chatContract.ts # 宿主 ↔ 聊天 webview 的消息契约 + ChatState 模型（接口冻结）
│       ├── envelope.ts     # host.describe RPC 信封构造与 rpcId 回显校验
│       ├── readyLine.ts    # 解析 stdout 就绪行 `dsh web: http://127.0.0.1:<port>`
│       ├── semver.ts       # 最小 semver 实现（支持 prerelease），零依赖
│       └── sessionTree.ts  # Sessions 树模型构建：分组/过滤/排序/标签/相对时间
└── test/                   # src/pure 的单测（node:test）
```

各模块职责要点：

- `src/extension.ts`：只做装配。`activate()`（`src/extension.ts:16`）注册命令与 view；`deactivate()`（:155）**必须是同步的**，见下文设计决策 5。
- `src/server/locateDsh.ts`：`locateDsh()`（`src/server/locateDsh.ts:28`）三步定位：`dshOne.dshPath` 配置非空则用它，否则用 PATH 上的 `dsh`；对候选跑 `dsh --version` 验证并提取版本号（给 `--no-open` 等版本 gate 用）；失败则抛出"未找到 dsh，请安装"的引导错误。
- `src/server/manager.ts`：`ServerManager`（:71）是整个扩展的核心，持有 `ServerStatus` 并通过 `onDidChangeState` 事件通知 UI。
- `src/ui/webview.ts`：`bind()`（:108）把任一 webview 绑定到 `ServerManager` 状态流；运行中时渲染 iframe（`dshFrame()`，:95），否则渲染启动/错误页。
- `src/ui/sessionTree.ts`：`SessionTreeProvider` 在 `running` 状态下拉取 workspace.list + session.list 基线，并通过 `subscribeHostEvents()`（`src/server/hostEvents.ts`）订阅 host 事件，500ms 防抖刷新；模型构建全部下沉到 `src/pure/sessionTree.ts`。另外暴露 `hasSession()` / `latestCurrentSessionId()` 给聊天视图做会话兜底与默认附着。
- `src/ui/chatView.ts`：`ChatViewProvider`（原生聊天面，`dshOne.chat`）持有当前会话的 `ChatSessionController`（`src/server/chatSession.ts`），把其 `onDidChange` 的 ChatState 快照直推 webview（controller 内部已节流），webview 动作（send/stop/approval/answer）路由回 controller。`setSession()` 换会话；服务非 running 或换 URL 时清空回空态。前端在 `src/ui/chat/webview.ts`，marked + dompurify 渲染 markdown，esbuild 打包成 `dist/chatWebview.js` 由 HTML 模板以 nonce 引用（CSP 惯例同 webview.ts）。
- `src/pure/`：与 vscode 解耦的业务规则。所有"容易写错的判断"（rpcId 校验、semver 比较、就绪行解析、会话树构建）都下沉到这里，保证可以脱离 VSCode 单测。

## 核心流程一：dsh 定位（locateDsh）

入口在 `ServerManager.start()` 内（`src/server/manager.ts:146`）。没有下载、没有版本指针、没有更新检查——升级 dsh 由用户自己 `npm update -g`。

1. `dshOne.dshPath` 非空 → 用配置路径；否则用 `dsh`（走 PATH 查找）。
2. 对候选同步跑 `--version` 验证（`src/server/locateDsh.ts:38`）：失败（不存在/退出码非 0）→ 抛出引导安装的错误（`npm install -g @deepseek-ai/dsh@next` 或配置 `dshOne.dshPath`）。
3. 从输出提取 semver 版本号（:15-21），提取不到记为 `unknown`（按新版对待）。

## 核心流程二：服务启动（探测 → 收养/spawn → 就绪双确认 → webview 加载）

入口 `ServerManager.ensureStarted()`（`src/server/manager.ts:97`），单例语义：并发调用共享同一个 in-flight Promise；实际逻辑在 `start()`（:130）。

1. **探测与收养**（:136-144）：`port > 0` 时先 `probeDsh(port)`（:45）——POST `http://127.0.0.1:<port>/api/host.describe`，信封是 `{type:'client-request', rpcId:<uuid>, method:'host.describe', payload:{}}`（`makeDescribeRequest()`，`src/pure/envelope.ts`）；只有回包 JSON 的 `rpcId` 与发出的一致才认定是 dsh（`validateDescribeResponse()`，同文件）。探测通过 → 状态置为 `running` 且 `adopted: true`，**收养的实例永不 kill**。`port = 0` 跳过探测。
2. **spawn**（:146-174）：`locateDsh()` 定位可执行文件；构造 env 时删除 `NODE_OPTIONS` 和 `ELECTRON_RUN_AS_NODE`（:151-153）；参数为 `web --host 127.0.0.1 --port <port>`，仅当版本 ≥ 0.1.0-rc.7（或 `unknown`）时追加 `--no-open`（`gte()` 判断，:158）；POSIX 下 `detached: true` 让 dsh 自成进程组（后面整组杀），Windows 下走 `shell: true`（.cmd shim 不能直接 spawn，:170）。工作目录取第一个 workspace folder，没有则用 home（:147）。
3. **就绪双确认**（`waitReady()`，:230）：
   - 第一层：监听 stdout，解析 `dsh web: http://127.0.0.1:\d+` 就绪行（`parseReadyLine()`，`src/pure/readyLine.ts`）拿到**实际端口**（port=0 时尤其重要）。
   - 第二层：对该端口再做一次 `probeDsh()`，rpcId 回显通过才算 ready（`src/server/manager.ts:268`）。防止"端口被无关 HTTP 服务占用、stdout 行却解析到了"的误判。
   - 失败路径：90s 超时（`START_TIMEOUT_MS`，:14）、进程提前退出、spawn 错误，都会带上 `TailBuffer`（:30，保留最后 40 行输出）作为错误详情。
4. **webview 加载**：状态变为 `running` 后，`onDidChangeState` 触发 `bind()` 重渲染，`dshFrame()`（`src/ui/webview.ts:95`）输出 `<iframe src="http://127.0.0.1:<port>/?dsh_embed=vscode">`。侧边栏是懒启动——第一次打开侧边栏才触发 `ensureStarted()`；`openInTab()`（:133）同理。CSP 只允许 `frame-src http://127.0.0.1:* http://localhost:*`（:48）。

进程退出有 `exit` 监听作为后备（`src/server/manager.ts:185-199`）：非主动停止的退出会把状态置为 `error` 并弹"查看日志/重试"。

## 状态与配置

### ServerStatus（`src/server/manager.ts:21`）

| 字段 | 说明 |
| --- | --- |
| `state` | `stopped` / `starting` / `running` / `error` |
| `url` / `port` | 运行中时的服务地址与端口（port=0 时来自就绪行解析） |
| `adopted` | `true` 表示连的是已有实例，任何清理路径都不会 kill 它 |
| `error` | `state === 'error'` 时的错误详情（含 dsh 输出尾部 40 行） |

### 配置项（`package.json` 的 `contributes.configuration`）

| 配置 | 默认 | 消费位置 |
| --- | --- | --- |
| `dshOne.dshPath` | `""` | `locateDsh()`（`src/server/locateDsh.ts:29`） |
| `dshOne.port` | `3080` | `ServerManager.start()`（`src/server/manager.ts:133`） |

### 磁盘与全局状态

扩展自身不持有任何运行时缓存。dsh 的数据（会话日志、workspace 元数据）在 `~/.dsh`，由 dsh 自己管理，扩展不读写。

## 设计决策及出处

以下结论来自对 marketplace 上 28 个 dsh 相关插件的逐一源码调研，完整报告在父仓库 `../docs/05-vscode插件调研.md`（不在本仓库内）。

1. **桥接而非整合包。** 产品定位参照 Claude Code CLI 与其 VSCode 扩展的关系：dsh 由用户自行安装/升级，扩展只负责定位、启动、连接。早期方案是扩展按需下载 Node + dsh 运行时（依赖树 455 个包 / 约 280MB / 11 个平台相关原生 .node），下载慢、跨平台麻烦，还会把扩展绑进版本管理（current/last-good 指针、回退、更新检查）的复杂度里；桥接定位把这些整体退役。
2. **先探后起 + 收养语义。** 两个 dsh 实例共享 `~/.dsh` 并发写会永久损坏会话日志（seq gap，Skylake0216 插件已有实际故障案例）。所以启动前必须先探测，已有实例就收养且绝不 kill。实现：`src/server/manager.ts:136-144`、`:277`（`killOwned` 注释）。
3. **spawn 环境净化。** env 里删掉扩展宿主注入的 `NODE_OPTIONS` / `ELECTRON_RUN_AS_NODE`（会让普通 node 子进程异常）；Windows 下 `.cmd` shim 不能直接 spawn，走 `shell: true`。实现：`src/server/manager.ts:151-153`、`:170`。
4. **`--no-open` 按版本 gate。** 只有 dsh ≥ 0.1.0-rc.7 认识该参数，旧版收到会直接退出（Xizhi1024 插件已出现过这个 critical bug）。实现：`src/server/manager.ts:12-13`、`:158`。
5. **`deactivate` 同步清理。** VSCode 退出时不会等待 async 清理，所以 `deactivate()` 里只能同步发 SIGTERM，再 spawn 一个 detached reaper（`sh -c 'sleep 3 && kill -KILL -<pgid>'`）3 秒后强制终止作为后备，即使扩展宿主已退出也能执行。Windows 用 `taskkill /T /F` 杀整棵进程树（单个 kill 覆盖不到 dsh 的工具子进程）。实现：`src/extension.ts:155`、`src/server/manager.ts:318`（`killSync`）。
6. **就绪双确认。** stdout 就绪行给实际端口，再补一次 RPC 身份确认，防端口被无关 HTTP 服务占用造成误判。实现：`src/server/manager.ts:230`（`waitReady`）。
7. **iframe 嵌入官方 UI（现阶段）。** 调研的 28 个竞品里，重写派每家都在追官方协议叫苦；iframe 嵌入零 UI 同步成本。URL 带 `dsh_embed=vscode` 是给官方预留的嵌入参数（截至 0.1.1-rc.2 未被消费）。长期方向是原生前端，见 `docs/roadmap.md`。实现：`src/ui/webview.ts:95`。
8. **零运行时依赖（扩展宿主）。** 扩展宿主只用 Node 22 内置模块 + vscode API，esbuild 打单文件 bundle。**修订（阶段二）**：聊天 webview 前端（`src/ui/chat/`）允许打包依赖——marked + dompurify 由 esbuild 内联进 `dist/chatWebview.js`，无运行时外部加载；宿主 bundle（`dist/extension.js`）仍零依赖。依据：`package.json` 的 `dependencies` 仅被 webview entry 引用；`build.mjs` 双入口打包。

## 日志与安全细节

- 所有日志走 `Logger`（`src/log.ts:18`），写入前 `sanitize()` 会把 URL 的 query 值脱敏成 `***`（`src/log.ts:14`），避免 token 类参数进日志。新增日志点请走 `Logger`，不要 `console.log`。
- webview CSP 收紧：`default-src 'none'`，frame 只允许 127.0.0.1/localhost，script 必须带 nonce（`src/ui/webview.ts:46-51`）。
