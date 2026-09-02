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
│   │   ├── manager.ts      # dsh web 进程生命周期：re-own/探测收养/spawn/就绪/清理
│   │   ├── spawnDsh.ts     # 短命启动器：detached spawn dsh 后立即退出，使其脱离扩展宿主进程树（防 reload 树杀）
│   │   ├── dshRpc.ts       # host RPC 客户端（workspace.create、session 增删改查等）
│   │   ├── muxEvents.ts    # 订阅会话事件流（WS /api/events.mux）的公共助手；chatSession 侧有退避重连（bc23e7c），jobsStore 侧无，见 docs/backlog/open/mux-reconnect.md
│   │   ├── chatSession.ts  # ChatSessionController：历史窗口基线（session.history 尾窗 + loadEarlier 向前翻页）+ mux 事件折叠为 ChatState，回答用户动作；running 位读服务段位（SessionsStore 中继）
│   │   └── hostEvents.ts   # 订阅 host 事件流（WS /api/events.host），转发 method + 原始 payload
│   ├── ui/
│   │   ├── webview.ts      # 编辑器标签页 WebviewPanel，iframe 嵌入 dsh web
│   │   ├── sessionsStore.ts # Sessions 数据层：基线拉取 + host 帧逐帧增量维护（无 TreeItem，供 chat webview 消费）
│   │   ├── jobsStore.ts    # 后台任务数据层：mux 全局 session/jobs 帧（连接基线重放 + 增量）按 owner 会话折叠
│   │   ├── chatView.ts     # Chat 视图（WebviewViewProvider）：持有 ChatSessionController 与 SessionsStore/JobsStore，推状态/收动作
│   │   ├── chat/           # 聊天 webview 前端（浏览器上下文，esbuild 打包进 dist/chatWebview.js）；icons.ts 收录 dsh web 官方 fill 图标
│   │   └── statusbar.ts    # 状态栏指示
│   └── pure/               # 纯逻辑，禁止 import vscode（可用 node --test 直接单测）
│       ├── chatContract.ts # 宿主 ↔ 聊天 webview 的消息契约 + ChatState 模型（接口冻结）
│       ├── conversation.ts # 会话事件折叠成 ChatMessage 列表；turn 失败（turn/end error reason）折叠成「本轮运行失败」错误行
│       ├── historyWindow.ts # session.history 窗口分页：窗口参数拼装（对齐官方 maxMessages: 50）、游标推进与页衔接判定
│       ├── contextMeter.ts # 上下文容量条分级与预估：perTurn = used/turns，剩余轮数定绿/黄/红，超限即 overflow
│       ├── agentPreset.ts  # Agent preset 文案：roster → 选项（官方 system preset 中文化、broken 过滤、默认行、头部只读标签映射）
│       ├── toolLine.ts     # 工具行式排版：工具名 → kimi-cli 风格动作短语；工具输出前 N 行截断（共 N 行提示）
│       ├── activityTree.ts # 后台任务 chip 模型：job 排序/状态点/状态文案/耗时格式化（对齐官方 JobListAction）
│       ├── composerAttachment.ts # composer 附件：image/* 判定与缩略图 data: URL 构造
│       ├── envelope.ts     # host.describe RPC 信封构造与 rpcId 回显校验
│       ├── hostFrames.ts   # host 事件帧解析与逐帧增量应用（对齐官方 applyMutation：session-added 补缺/blank 单调、session-status 翻 running 清 blank、subagent removed 降级、workspace upsert/重排）
│       ├── readyLine.ts    # 解析就绪行 `dsh web: http://127.0.0.1:<port>`（port=0 时从日志文件拿实际端口）
│       ├── semver.ts       # 最小 semver 实现（支持 prerelease），零依赖
│       └── sessionTree.ts  # Sessions 树模型构建：分组/过滤/排序（置顶优先）/标签/相对时间/未读标记
└── test/                   # src/pure 的单测（node:test）
```

各模块职责要点：

- `src/extension.ts`：只做装配。`activate()`（`src/extension.ts:19`）注册命令与 view；`deactivate()` 是空操作——dsh 不随窗口退出，本地资源由 `context.subscriptions` 自动 dispose，见下文设计决策 5。
- `src/server/locateDsh.ts`：`locateDsh()`（`src/server/locateDsh.ts:28`）三步定位：`dshOne.dshPath` 配置非空则用它，否则用 PATH 上的 `dsh`；对候选跑 `dsh --version` 验证并提取版本号（给 `--no-open` 等版本 gate 用）；失败则抛出 `DshNotFoundError`（"未找到 dsh，请安装"的引导错误），`ServerManager` 据此在 `ServerStatus.reason` 上标记 `dshNotFound`，UI 据此展示安装引导（Chat 空态经 `ChatState.serverError`，sessions 面板空态经 `SessionsSnapshot.dshNotFound`），按钮跳转到官方安装页 <https://www.deepseek.com/harness/>（`dshOne.openInstallPage`）。
- `src/server/manager.ts`：`ServerManager`（:71）是整个扩展的核心，持有 `ServerStatus` 并通过 `onDidChangeState` 事件通知 UI。
- `src/ui/webview.ts`：`bind()`（:108）把任一 webview 绑定到 `ServerManager` 状态流；运行中时渲染 iframe（`dshFrame()`，:95），否则渲染启动/错误页。
- `src/ui/sessionsStore.ts`：`SessionsStore` 是原 Sessions 树视图（`dshOne.sessions`，已并入 chat webview 面板）的数据层——在 `running` 状态下拉取 workspace.list + session.list 基线并缓存，通过 `subscribeHostEvents()`（`src/server/hostEvents.ts`）订阅 host 事件，帧载荷逐帧增量维护缓存基线（解析与应用在 `src/pure/hostFrames.ts`；refresh 在途期间到达的帧先缓冲、拉到基线后重放防乱序），全量重拉只留基线场景（服务状态变化/手动刷新/附着会话标题变化）；另有 60s 本地 tick 用缓存基线纯重建模型（不发 RPC），让会话行的相对时间文案随时间更新；模型构建全部下沉到 `src/pure/sessionTree.ts`。支持搜索过滤（标题/会话 ID 子串，大小写不敏感）与排序（最近/最早更新、按标题）；搜索/排序/置顶/折叠只基于缓存基线本地重建模型，不发 RPC；排序、置顶（pinned）、未读（unread）、workspace 折叠（collapsed）偏好都持久化在 `workspaceState`（纯 UI 偏好，非 dsh 数据缓存——dsh 无置顶/未读概念，未读为手动标记、附着会话时自动清除）。变更经 `onDidChange` 通知（ChatViewProvider 推 sessions 快照给 webview、extension.ts 做聊天附着兜底）。另外暴露 `hasSession()` / `latestCurrentSessionId()` 给聊天视图做会话兜底与默认附着，`rawList()` 把缓存的 session.list 基线（含 parentSessionId/origin/totalTokens/title）原样给任务面板复用，`runningFor()` 把单个会话的服务端 running 位中继给附着会话的 ChatSessionController（ChatState.running 的权威来源，基线未覆盖时 controller 回退 mux 事件折叠值）。
- `src/ui/jobsStore.ts`：`JobsStore` 是头部「N 个后台任务」chip 的 job 数据层——WS `/api/events.mux` 是全局广播，连接时 host 重放所有会话的 `session/jobs` 基线（含已 settled 的 job）、之后增量推送；这条通道即官方 web 客户端的正规渠道（dsh-client-connection 的 `WebApiClient.openMux` 打开同一个 `/api/events.mux` 下行，官方 JobListAction 的 `jobsBySession` 正由 `session/jobs` 帧喂出）。store 不过滤 sessionId，整快照替换式维护 `jobsBySession`（空 jobs 数组 = 该会话任务清空、删除 key），200ms 防抖后经 `onDidChange` 通知。生命周期对齐 SessionsStore（跟随 `manager.onDidChangeState` 的 url 订阅/退订）。已知限制：mux 无重连（`docs/backlog/open/mux-reconnect.md`），断流后任务列表随之停滞。
- `src/pure/activityTree.ts`：头部后台任务 chip（对齐官方 dsh-client-ui-jobs 的 JobListAction）的纯模型——`orderJobs()` 行序（运行中按 startedAt 升序在前、已结束按 finishedAt 降序在后）、`jobsChipLabel()` chip 文案（运行中计数优先，全结束显示总数，无 job 返回 null）、`jobDotState()`/`jobStatusLabel()` 状态点与中文文案、`formatJobDuration()` 耗时（最多两个相邻单位，小时封顶）。
- `src/ui/chatView.ts`：`ChatViewProvider`（原生聊天面，`dshOne.chat`）持有当前会话的 `ChatSessionController`（`src/server/chatSession.ts`）与 `SessionsStore`，把 controller 的 ChatState 快照与 store 的 SessionsSnapshot（附服务状态，供面板空态）直推 webview（controller 内部已节流），webview 动作路由回来：聊天动作（send/stop/approval/answer/feedback/fork）落到 controller，sessions 面板动作（sessionOpen/New/Rename/Archive/Pin/Unread、workspaceAdd/Create/OpenFolder/Collapse、sessionFork、搜索/排序/刷新、serverStart）走 onMessage 顶部的免 controller 分支，会话操作复用 `src/extension.ts` 里收普通参数的命令（含 `dshOne.session.fork`，走主机 session.fork RPC；`dshOne.workspace.create` 在 `~/.dsh/workspaces/<名称>` 建目录后经 ensureWorkspace 注册，dsh 全局目录不存在时直接报错）。面板交互对齐 dsh web 官方前端：workspace 行整行点击折叠/展开（文件夹图标 hover 切换为三角箭头），附着会话所在 workspace 的文件夹图标染 deepseek 蓝（官方同款标识，折叠组也生效，随附着切换走 syncSessionHighlight 免重建通道），当前 VSCode 打开的 workspace 行尾带「vscode」标签，会话行 hover 出「⋯」菜单（重命名/置顶/标为未读/分叉会话/归档会话），右键弹同一菜单；会话行首状态槽对齐官方 StateDot——运行中显示 8 格像素环追逐动画（deepseek 蓝，错相 1s 旋转），空闲留空；未读（本地状态，官方无此概念）为蓝色圆点 + 标题加粗，`setSession()` 附着即清未读。图标取自 dsh web bundle（`src/ui/chat/icons.ts`，fill=currentColor），置顶/排序图标为自制（官方无对应物）。`setSession()` 换会话；服务非 running 或换 URL 时清空回空态。聊天头部信息区（对齐官方）：标题（ellipsis + hover 完整标题）后有「N 个子代理」chip、「N 个后台任务运行中」chip（透明底小字 + chevron 矢量图标，对齐官方 SubagentHeader trigger / JobListAction）与只读 preset 标签（浅底胶囊 + 三环图标，对齐官方 AgentPresetLabel）——子代理行由 `composeHeader()` 从 SessionsStore 基线组合（parentSessionId 指向附着会话且 running），后台任务行由 `composeHeader()` 从 JobsStore 的 mux 基线组合（含已结束 job，行序/文案/耗时格式化在 `src/pure/activityTree.ts`，对齐官方 JobListAction），store/jobs 刷新时重推 state；任务下拉里有运行中行时挂 1s tick 只改写耗时文本节点（关闭弹层即清理）；preset 标签的渠道对齐官方 AgentPresetLabel：`composeHeader()` 从 session.list 基线取附着会话的 agentPreset id（官方 sessionSummarySchema 字段，创建时即定、新旧会话都有），经 controller 的 roster 映射成显示名（user preset 显示 roster name 而非裸 id；roster 未就绪回退 `agentPresetLabel()`），roster 的 description 作为悬停 tooltip（对齐官方 AgentPresetLabel 的悬停描述），与空会话 hero 的选择 chip 互斥。空会话（无消息、无待办/队列）按官方空态居中排版做本地化定制（`renderHero`，对齐 HeroShell + composer 卡片 uV2eYG_card）：hero 品牌组合（官方鱼标 × 分隔符 × DSH One 像素鲸鱼 logo，品牌蓝 #2563EB，共用游动动画）、无官方「探索未至之境」标题与「预览版」徽章（用户要求去掉），其下 chip 行（workspace 名选择器 + preset 选择 chip，从 composer footer 挪入）、再下是 780px max-width 大圆角 composer 卡片（22px 圆角、浮层底色、柔和阴影，placeholder 对齐官方「描述你想要构建的内容」）；发送主按钮对齐官方 InputBar primary（34×34 圆形图标按钮，运行中变停止方块）；workspace 名由 `composeHeader()` 从 workspace.list 基线合成（`workspaceLabel`，blank 会话也在所属 workspace 的 sessionIds 里）；开跑（有消息或 turn 进行中）即回常规流式布局，composer 的 IME/焦点保留策略只在布局不变（hero↔hero 或常规↔常规）时生效。composer 待发送附件列表对齐官方 AttachmentRail：图片为圆角缩略图（data: URL 直渲，hover 出移除钮，加载失败回退文件名 chip），文件为文件名 chip + 文档小图标。前端在 `src/ui/chat/webview.ts`，marked + dompurify 渲染 markdown，esbuild 打包成 `dist/chatWebview.js` 由 HTML 模板以 nonce 引用（CSP 惯例同 webview.ts）。布局：宽屏（≥720px）左 sessions 面板（260px）右聊天列，窄屏改上下（面板在上、限高 40% 自滚动），由 STYLE 里的媒体查询切换。
- `src/pure/`：与 vscode 解耦的业务规则。所有"容易写错的判断"（rpcId 校验、semver 比较、就绪行解析、会话树构建）都下沉到这里，保证可以脱离 VSCode 单测。

## 核心流程一：dsh 定位（locateDsh）

入口在 `ServerManager.start()` 内（`src/server/manager.ts:146`）。没有下载、没有版本指针、没有更新检查——升级 dsh 由用户自己 `npm update -g`。

1. `dshOne.dshPath` 非空 → 用配置路径；否则用 `dsh`（走 PATH 查找）。
2. 对候选同步跑 `--version` 验证（`src/server/locateDsh.ts:38`）：失败（不存在/退出码非 0）→ 抛出 `DshNotFoundError`（引导安装文案：`npm install -g @deepseek-ai/dsh@next` 或配置 `dshOne.dshPath`）。
3. 从输出提取 semver 版本号（:15-21），提取不到记为 `unknown`（按新版对待）。

## 核心流程二：服务启动（re-own → 探测收养/spawn → 轮询就绪 → webview 加载）

入口 `ServerManager.ensureStarted()`，单例语义：并发调用共享同一个 in-flight Promise；实际逻辑在 `start()`。

1. **re-own（reload 存活认领）**：dsh 与 VSCode 窗口生命周期已解绑（设计决策 5），上一个宿主 spawn 的 dsh 可能仍在跑。先读 globalStorage 的 pidfile（`dsh-owned.json`，记 `{pid, port}`）：pid 存活（`process.kill(pid, 0)`）且端口通过 host.describe 身份确认 → 恢复 owned 身份（stop/restart 照常可杀）。pidfile 里 `port=0`（系统分配端口）时从日志文件的就绪行解析实际端口再确认；spawn 就绪后也会把实际端口回填进 pidfile。记录过期（pid 死/端口不应答）则删除 pidfile 继续正常流程。已知风险（已拍板接受）：dsh 死后 pid 被复用且端口被另一手动 dsh 占用时，stop 会误杀复用 pid 的进程组——host.describe 响应不含 pid，无法更严格验证。
2. **探测与收养**：`port > 0` 时先 `probePort(port)` 三态探测——POST `http://127.0.0.1:<port>/api/host.describe`，信封是 `{type:'client-request', rpcId:<uuid>, method:'host.describe', payload:{}}`（`makeDescribeRequest()`，`src/pure/envelope.ts`）；只有回包 JSON 的 `rpcId` 与发出的一致才算 `'dsh'`（`validateDescribeResponse()`，同文件），有 HTTP 应答但校验失败算 `'foreign'`，无应答算 `'down'`。`'dsh'` → 状态置为 `running` 且 `adopted: true`，**收养的实例永不 kill**；`'foreign'` → 从 `port+1` 起扫最多 50 个候选找空闲端口**临时顶替**（不写回用户设置，弹窗告知）；`'down'` → 原端口 spawn。`port = 0` 跳过探测。
3. **spawn（双层）**：`locateDsh()` 定位可执行文件；构造 env 时删除 `NODE_OPTIONS` 和 `ELECTRON_RUN_AS_NODE`；参数为 `web --host 127.0.0.1 --port <实际端口>`（fallback 端口也正确传给 dsh），仅当版本 ≥ 0.1.0-rc.7（或 `unknown`）时追加 `--no-open`（`gte()` 判断）。**单层 detached+unref 不够**——实测 VS Code 在 reload 时会对扩展宿主的进程树做 SIGTERM 树杀（`pgrep -P` 递归，`out/vs/base/node/terminateProcess.sh`；信号级 wrapper 实测捕获：宿主退出后 ~43ms SIGTERM 到达），detached 的 dsh 因 ppid 链仍在而被带走。所以 spawn 经短命启动器 `dist/spawnDsh.js`（以 `ELECTRON_RUN_AS_NODE=1` 跑在宿主自带的 Electron 二进制上，不依赖 PATH 里有 node）：启动器 detached spawn dsh（stdio 重定向到 globalStorage 的 `dsh-web.log`，每次截断）后立即退出，dsh 被 launchd 收养、从宿主进程树消失；启动器 stdout 回传 dsh 真实 pid 写 pidfile。
4. **就绪轮询**（`waitReady()`）：dsh 端口被占时直接启动失败（不会自己换端口），所以固定端口每 250ms 轮询 `probeDsh()` 直到应答，不依赖 stdout 就绪行。`port = 0`（系统分配）是例外：实际端口从日志文件的 `dsh web: http://127.0.0.1:<port>` 行解析（`parseReadyLine()`，`src/pure/readyLine.ts`）后再确认。失败路径：90s 超时（`START_TIMEOUT_MS`）、pid 提前消失（双层 spawn 后没有进程句柄，早退靠 `pidAlive()` 判断），都带日志文件尾部 40 行作为错误详情。
5. **健康检查**：ready 后每 30s 重新探测一次（收养、re-own、自己拉起的实例都查）。失联即回到 `stopped`——owned 实例还会被 kill 掉回收端口，避免"状态栏显示运行中、实际已死"的假状态。双层 spawn 后扩展不再持有 dsh 进程句柄，dsh 意外退出统一靠健康检查发现（不弹窗）。
6. **webview 加载**：状态变为 `running` 后，`onDidChangeState` 触发 `bind()` 重渲染，`dshFrame()`（`src/ui/webview.ts:95`）输出 `<iframe src="http://127.0.0.1:<port>/?dsh_embed=vscode">`。dsh web 只在编辑区标签页展示（`openInTab()`，:133）。CSP 只允许 `frame-src http://127.0.0.1:* http://localhost:*`（:48）。

激活扩展时默认自动 `ensureStarted()`（配置 `dshOne.autoStart`，默认 `true`），不再需要手动点击触发首次启动。

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
| `dshOne.autoStart` | `true` | `activate()`（`src/extension.ts`） |

### 磁盘与全局状态

扩展在 globalStorage 写两份运行时文件：dsh 的 stdout/stderr 日志 `dsh-web.log`（每次 spawn 截断）与 pidfile `dsh-owned.json`（`{pid, port}`，reload 后 re-own 用，stop/kill 时删除）。dsh 的数据（会话日志、workspace 元数据）在 `~/.dsh`，由 dsh 自己管理，扩展不读写。

## 设计决策及出处

以下结论来自对 marketplace 上 28 个 dsh 相关插件的逐一源码调研，完整报告在父仓库 `../docs/05-vscode插件调研.md`（不在本仓库内）。

1. **桥接而非整合包。** 产品定位参照 Claude Code CLI 与其 VSCode 扩展的关系：dsh 由用户自行安装/升级，扩展只负责定位、启动、连接。早期方案是扩展按需下载 Node + dsh 运行时（依赖树 455 个包 / 约 280MB / 11 个平台相关原生 .node），下载慢、跨平台麻烦，还会把扩展绑进版本管理（current/last-good 指针、回退、更新检查）的复杂度里；桥接定位把这些整体退役。
2. **先探后起 + 收养语义。** 两个 dsh 实例共享 `~/.dsh` 并发写会永久损坏会话日志（seq gap，Skylake0216 插件已有实际故障案例）。所以启动前必须先探测，已有实例就收养且绝不 kill。实现：`src/server/manager.ts:136-144`、`:277`（`killOwned` 注释）。
3. **spawn 环境净化。** env 里删掉扩展宿主注入的 `NODE_OPTIONS` / `ELECTRON_RUN_AS_NODE`（会让普通 node 子进程异常）；Windows 下 `.cmd` shim 不能直接 spawn，走 `shell: true`。实现：`src/server/manager.ts:151-153`、`:170`。
4. **`--no-open` 按版本 gate。** 只有 dsh ≥ 0.1.0-rc.7 认识该参数，旧版收到会直接退出（Xizhi1024 插件已出现过这个 critical bug）。实现：`src/server/manager.ts:12-13`、`:158`。
5. **dsh 与窗口生命周期解绑（2026-10 反转原决策）。** 原设计在 `deactivate()` 里同步 SIGTERM + detached reaper 补 SIGKILL，导致 reload window 就中断进行中的 session（开发期一天十余次）。现改为「父死子存」，且必须**双层 spawn**：单层 `detached + unref + stdio 进日志文件`只解决进程组与 EPIPE，实测 VS Code reload 时会对扩展宿主进程树做 SIGTERM 树杀（`pgrep -P` 递归），ppid 链不断就逃不掉；短命启动器（`src/server/spawnDsh.ts`）拉起 dsh 后立即退出，dsh 被 launchd 收养才彻底脱离。身份写 globalStorage pidfile，下个宿主 re-own；dsh 只在用户显式 `dshOne.stop` / `dshOne.restart` 时被杀（POSIX 整组 SIGTERM→SIGKILL，Windows `taskkill /T /F`）。副作用：终端升级 dsh 后需手动 restart 生效（已拍板暂不做版本提示）；扩展不再持有 dsh 进程句柄，意外退出由 30s 健康检查发现（不弹窗）。
6. **就绪轮询 + 身份确认。** dsh 端口被占直接启动失败（不换端口），固定端口轮询 probeDsh 即可；port=0 例外，从日志文件解析就绪行拿实际端口后再 RPC 确认。实现：`src/server/manager.ts`（`waitReady`）。
7. **iframe 嵌入官方 UI（现阶段）。** 调研的 28 个竞品里，重写派每家都在追官方协议叫苦；iframe 嵌入零 UI 同步成本。URL 带 `dsh_embed=vscode` 是给官方预留的嵌入参数（截至 0.1.1-rc.2 未被消费）。长期方向是原生前端，见 `docs/roadmap.md`。实现：`src/ui/webview.ts:95`。
8. **零运行时依赖（扩展宿主）。** 扩展宿主只用 Node 22 内置模块 + vscode API，esbuild 打单文件 bundle。**修订（阶段二）**：聊天 webview 前端（`src/ui/chat/`）允许打包依赖——marked + dompurify 由 esbuild 内联进 `dist/chatWebview.js`，无运行时外部加载；宿主 bundle（`dist/extension.js`）仍零依赖。依据：`package.json` 的 `dependencies` 仅被 webview entry 引用；`build.mjs` 双入口打包。

## 日志与安全细节

- 所有日志走 `Logger`（`src/log.ts:18`），写入前 `sanitize()` 会把 URL 的 query 值脱敏成 `***`（`src/log.ts:14`），避免 token 类参数进日志。新增日志点请走 `Logger`，不要 `console.log`。
- webview CSP 收紧：`default-src 'none'`，frame 只允许 127.0.0.1/localhost，script 必须带 nonce（`src/ui/webview.ts:46-51`）。
