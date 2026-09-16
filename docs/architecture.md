# DSH One 架构

本文面向接手开发的人。定位：DSH One 是 dsh 与 VSCode 之间的**桥接插件**——dsh 由用户自行安装（`npm install -g @deepseek-ai/dsh@next`），扩展负责定位/启动/连接 dsh 并提供 VSCode 侧 UI：自研会话侧栏（`dshOne.chat` 视图）+ 装配对话区（官方 dsh web 前端组件经 loopback 代理装配进 VS Code 面板，见 `src/ui/assembly/` 与 `docs/assembly-architecture.html`）。

行号引用以当前 main 为准（`src/server/manager.ts:45` 这种格式）；代码改动后请同步更新本文。

## 模块结构

```
dsh-one/
├── package.json            # 清单：命令、配置项、侧边栏 view、extensionKind
├── build.mjs               # esbuild 打包脚本：dist/extension.js（宿主）+ dist/sessionsWebview.js（侧栏前端）+ dist/spawnDsh.js + 装配 shell 插件 + 宿主半包（packages/）
├── packages/               # 以「官方 dsh 插件包」形态分发的自有件（每个子目录是一个可安装的 npm 包，见各包 src 的文件头说明）
│   └── dsh-host-capabilities/ # 宿主半：跑在 dsh 宿主进程里提供能力与持久状态（状态落 ~/.dsh/dsh-one/、只读 git、内容落盘），
│                              # 经官方 api-gateway 暴露成 Remote 端点；前端插件经宿主能力口调用（#84）
├── src/
│   ├── extension.ts        # activate/deactivate 入口：装配（命令注册、侧栏 view 注册、默认打开装配面板）
│   ├── log.ts              # 输出通道日志，写入前对 URL query 值脱敏
│   ├── server/
│   │   ├── locateDsh.ts    # 定位 dsh 可执行文件（dshPath 配置 → PATH → 报错引导安装）
│   │   ├── manager.ts      # dsh web 进程生命周期：re-own/复用探测/spawn/就绪/清理（含外部实例的 B 档连接与 A 档停止/重启）
│   │   ├── portProbe.ts    # 端口身份探测（host.describe rpcId 回显；401+`unauthorized` 指纹 → authDsh）
│   │   ├── externalDsh.ts  # 外部实例管理：三平台 pid 探测 / 命令行身份确认 / 单 pid 优雅停止（A 档）
│   │   ├── spawnDsh.ts     # 短命启动器：detached spawn dsh 后立即退出，使其脱离扩展宿主进程树（防 reload 树杀）
│   │   ├── dshRpc.ts       # host RPC 客户端（workspace.create、session 增删改查等）
│   │   ├── serverAuth.ts   # 0.1.2 认证：token 换登录 cookie、cookie 头发起、版本探测
│   │   ├── assemblyMirror.ts # loopback 代理：接口转发（带 cookie、改 Origin、剥 sec-fetch-*）+ 数据流转发 + 插件整包过滤 + 伺服 shell 插件
│   │   ├── modernStreams.ts # 0.1.2 共享逻辑流（$events + session/control）单例：重连退避 refcount 按 origin
│   │   ├── muxEvents.ts    # 订阅会话事件流（WS /api/events.mux）的公共助手
│   │   ├── hostEvents.ts   # 订阅 host 事件流（WS /api/events.host），转发 method + 原始 payload
│   │   └── tagBridge.ts    # loopback tag-bridge：派生脚本 --tag 代写 tags.json 的 HTTP 小服务
│   ├── ui/
│   │   ├── assembly/       # 装配对话区：pageHtml（装配页生成）、wireFilter（插件整包过滤）、shell/（自有 shell 插件）、probe（诊断探针）
│   │   ├── assemblyView.ts # 装配面板宿主：dshOne.assembledChat 命令、单例面板生命周期、reveal/用户关闭追踪（默认打开用）
│   │   ├── sessionsStore.ts # 侧栏数据层：基线拉取 + host 帧逐帧增量维护
│   │   ├── sessionsView.ts # 侧栏视图（WebviewViewProvider）：快照推送、动作路由到 extension 命令、可见性钩子
│   │   ├── sessionsWebview.ts # 侧栏 webview 前端（浏览器上下文）
│   │   ├── statusbar.ts    # 状态栏指示
│   │   └── shared/         # 侧栏前端与宿主共用：icons（官方 fill 图标）、webviewL10n（译文注入）、animPhase/composeGuard/reconcile
│   └── pure/               # 纯逻辑，禁止 import vscode（可用 node --test 直接单测）
│       ├── chatContract.ts # 宿主 ↔ webview 的消息契约 + 会话/交互模型（接口冻结；ChatState 半边随旧聊天区下线后仅单测消费）
│       ├── conversation.ts # 会话事件折叠成消息列表（dshRpc/测试消费）
│       ├── historyWindow.ts # session.history 窗口分页
│       ├── sessionTree.ts  # 侧栏会话树模型构建：分组/过滤/排序（置顶优先）/标签/相对时间/未读标记
│       ├── hostFrames.ts   # host 事件帧解析与逐帧增量应用
│       ├── envelope.ts     # host.describe RPC 信封构造与 rpcId 回显校验
│       ├── readyLine.ts    # 解析就绪行 `dsh web: http://127.0.0.1:<port>`
│       ├── semver.ts       # 最小 semver 实现（支持 prerelease），零依赖
│       └── …               # 其余 pure 模块按文件名自解释（tokenScan/composerAttachment 等）
├── test/                   # src/pure 的单测（node:test）+ mock-dsh 协议夹具 + sandbox 验收基线
└── scripts/                # 开发流程脚本（dev-start/finish/merge、i18n 门禁）+ verify-host-half-official.mjs（临时 HOME/profile 里验宿主半）
```

各模块职责要点：

- `src/extension.ts`：只做装配。`activate()` 注册命令与 view；维护「最近打开的会话」（侧栏高亮/行内改名判定用）；挂默认打开逻辑——侧栏视图每次可见时，若装配对话区没开且本窗口没自动开过、用户也没手动关过，则自动打开一次（`workspaceState` 记 `dshOne.assemblyAutoOpened`）。`deactivate()` 是空操作——dsh 不随窗口退出，本地资源由 `context.subscriptions` 自动 dispose，见下文设计决策 5。
- `src/server/locateDsh.ts`：`locateDsh()` 三步定位：`dshOne.dshPath` 配置非空则用它，否则用 PATH 上的 `dsh`；对候选跑 `dsh --version` 验证并提取版本号；失败则抛出 `DshNotFoundError`，`ServerManager` 据此在 `ServerStatus.reason` 上标记 `dshNotFound`，侧栏状态页据此显示「未安装」并给「查看安装指南」按钮 → 打开安装引导 tab（`dshOne.openInstallPage`；引导页里按平台给一键脚本，官方安装文档 <https://www.deepseek.com/harness/> 作为其中一条入口）。
- `src/ui/sidebarStatusPage.ts` / `src/ui/installGuide.ts`：侧栏状态页与安装引导 tab（#100 落地、#105 改版）。两者都是**宿主侧渲染的普通 HTML**（我们自己的 HTML + CSS + 内联脚本，文案走 `vscode.l10n.t`），不参与装配树——dsh 未安装时网关起不来，装配页组装不了，这一层只能由宿主直接给页面。状态页三态的分流判定在 `src/pure/sidebarStatus.ts`（纯函数，单测覆盖）；引导 tab 是单例面板（槽位逻辑在 `src/pure/panelSlot.ts`），已开则聚焦，页面结构在 `src/pure/installGuidePage.ts`（纯函数：居中 hero + 主按钮下拉（平台项按命令分叉合成、选中态 ✓、外链项 ↗）+ 同行命令胶囊与复制 + 「终端安装 / 编辑器接入」分段）。
- `src/server/manager.ts`：`ServerManager` 是整个扩展的核心，持有 `ServerStatus` 并通过 `onDidChangeState` 事件通知 UI。
- `src/ui/assemblyView.ts`：`registerAssembledChat()` 注册 `dshOne.assembledChat` 命令——ensureStarted 后经 `loadGatewayAssembly()`（cookie GET 网关 `/`，提取 `__DSH_BOOT__` wire 与前端资产名）+ `startAssemblyMirror()` 起 loopback 代理，装配页 HTML 设为面板内容；单例面板，后开替换先开，关面板即 dispose mirror。导出 `revealAssembledChat()`（已开则聚焦）/`hasAssembledChatPanel()`/`wasAssembledChatClosedByUser()` 给默认打开与侧栏点开会话复用。
- `src/ui/sessionsStore.ts`：`SessionsStore` 是侧栏数据层——在 `running` 状态下拉取 workspace.list + session.list 基线并缓存，通过 `subscribeHostEvents()` 订阅 host 事件，帧载荷逐帧增量维护缓存基线（解析与应用在 `src/pure/hostFrames.ts`），全量重拉只留基线场景；另有 60s 本地 tick 让会话行的相对时间文案随时间更新；模型构建全部下沉到 `src/pure/sessionTree.ts`。搜索/排序/置顶/未读/折叠只基于缓存基线本地重建模型；客户端状态（回收站/分组/标签组/置顶/未读）落在 `~/.dsh/dsh-one/` 文件（跨窗口共享）。变更经 `onDidChange` 通知侧栏视图与 extension。
- `src/ui/sessionsView.ts` / `sessionsWebview.ts`：侧栏视图与前端。动作（打开/新建/重命名/归档/置顶/未读/fork/搜索/排序/刷新）经 postMessage 回宿主，路由到 `extension.ts` 注册的命令；纯 store 操作直接落 store。会话高亮由快照的 `activeSessionId` 驱动（= extension 记的「最近打开的会话」）。
- `src/pure/`：与 vscode 解耦的业务规则。所有"容易写错的判断"（rpcId 校验、semver 比较、就绪行解析、会话树构建、@token 扫描）都下沉到这里，保证可以脱离 VSCode 单测。

## 核心流程一：dsh 定位（locateDsh）

入口在 `ServerManager.start()` 内。没有下载、没有版本指针、没有更新检查——升级 dsh 由用户自己 `npm update -g`。

1. `dshOne.dshPath` 非空 → 用配置路径；否则用 `dsh`（走 PATH 查找）。
2. 对候选同步跑 `--version` 验证：失败（不存在/退出码非 0）→ 抛出 `DshNotFoundError`（引导安装文案）。
3. 从输出提取 semver 版本号，提取不到记为 `unknown`（按新版对待）。

## 核心流程二：服务启动（re-own → 复用探测/spawn → 轮询就绪 → UI 就位）

入口 `ServerManager.ensureStarted()`，单例语义：并发调用共享同一个 in-flight Promise；实际逻辑在 `start()`。

1. **re-own（reload 存活认领）**：dsh 与 VSCode 窗口生命周期已解绑（设计决策 5），上一个宿主 spawn 的 dsh 可能仍在跑。先读共享 pidfile（`~/.dsh/dsh-owned.json`）：spawn 记录按 pid 存活且端口通过 token 换票/host.describe 身份确认 → 恢复 owned 身份；owner 不同 → 认证式 adopted（绝不 kill）。**外部记录（`source:'external'`）**跳过 pid 存活闸——token 换票是身份闸，成功 → `external:true` 运行（A 档可管理）。记录过期则删除 pidfile 继续正常流程。已知风险（已拍板接受）：dsh 死后 pid 被复用且端口被另一手动 dsh 占用时，stop 会误杀复用 pid 的进程组。
2. **探测与复用**：`port > 0` 时先 `probePort(port)` 四态探测——POST `http://127.0.0.1:<port>/api/host.describe`（`src/pure/envelope.ts` 构造信封，rpcId 回显校验）；`'dsh'` → `running` + `adopted: true`，**复用的实例永不 kill**；`'authDsh'` → 防护：`error` + `reason:'authDshNoToken'`，**不另起实例**；`'foreign'` → 从 `port+1` 起扫候选找空闲端口临时顶替；`'down'` → 原端口 spawn。`port = 0` 跳过探测。
3. **spawn（双层）**：`locateDsh()` 定位；env 删除 `NODE_OPTIONS`/`ELECTRON_RUN_AS_NODE`；参数 `web --host 127.0.0.1 --port <端口>`，版本 ≥ 0.1.0-rc.7 追加 `--no-open`。经短命启动器 `dist/spawnDsh.js` detached spawn（stdio 进 `dsh-web.log`），dsh 被 launchd 收养、脱离扩展宿主进程树；启动器回传真实 pid 写 pidfile。
4. **就绪轮询**（`waitReady()`）：固定端口每 250ms 轮询 `probeDsh()`；`port=0` 从日志文件就绪行解析实际端口（`src/pure/readyLine.ts`）。失败：90s 超时 / pid 提前消失，带日志尾部 40 行。
5. **健康检查**：ready 后每 30s 重探一次；失联回 `stopped`，owned 实例还会被 kill 回收端口。意外退出统一靠健康检查发现（不弹窗）。
6. **UI 就位**：状态 `running` 后，侧栏经 `onDidChangeState` 刷新基线；装配对话区在用户点开（或默认打开触发）时经 loopback 代理加载装配页，代理在面板打开时启动、面板关闭时 dispose。

激活扩展时默认自动 `ensureStarted()`（配置 `dshOne.autoStart`，默认 `true`）。

## 状态与配置

### ServerStatus（`src/server/manager.ts`）

| 字段 | 说明 |
| --- | --- |
| `state` | `stopped` / `starting` / `running` / `error` |
| `url` / `port` | 运行中时的服务地址与端口（port=0 时来自就绪行解析） |
| `adopted` | `true` 表示连的是已有实例，任何清理路径都不会 kill 它 |
| `error` | `state === 'error'` 时的错误详情（含 dsh 输出尾部 40 行） |

### 配置项（`package.json` 的 `contributes.configuration`）

| 配置 | 默认 | 消费位置 |
| --- | --- | --- |
| `dshOne.dshPath` | `""` | `locateDsh()` |
| `dshOne.port` | `3080` | `ServerManager.start()` |
| `dshOne.autoStart` | `true` | `activate()`（`src/extension.ts`） |

### 磁盘与全局状态

扩展在 globalStorage 写两份运行时文件：dsh 的 stdout/stderr 日志 `dsh-web.log`（每次 spawn 截断）与 pidfile `dsh-owned.json`（reload 后 re-own 用）。dsh 的数据（会话日志、workspace 元数据）在 `~/.dsh`，由 dsh 自己管理，扩展不读写；侧栏的客户端状态（回收站/分组/标签组/置顶/未读 + tag-bridge 记录）落在 `~/.dsh/dsh-one/`，跨窗口共享。

**去向（#84 起）**：`~/.dsh/dsh-one/` 下这批插件状态的**新主人是宿主半插件**（`packages/dsh-host-capabilities`），前端插件经宿主能力口读写，扩展侧那套 `dshStateStore` / `tagBridge` 是待退役的存量（迁移见 #82）——理由是同一份用户数据不能有两个家，且官方 web 侧拿不到扩展的存储。

## 设计决策及出处

以下结论来自对 marketplace 上 28 个 dsh 相关插件的逐一源码调研，完整报告在父仓库 `../docs/05-vscode插件调研.md`（不在本仓库内）。

1. **桥接而非整合包。** 产品定位参照 Claude Code CLI 与其 VScode 扩展的关系：dsh 由用户自行安装/升级，扩展只负责定位、启动、连接。早期方案是扩展按需下载 Node + dsh 运行时（依赖树 455 个包 / 约 280MB / 11 个平台相关原生 .node），下载慢、跨平台麻烦，还会把扩展绑进版本管理的复杂度里；桥接定位把这些整体退役。
2. **先探后起 + 复用语义。** 两个 dsh 实例共享 `~/.dsh` 并发写会永久损坏会话日志（seq gap）。所以启动前必须先探测，已有实例就复用且绝不 kill。**2026-09-06 修订（external-dsh-manage-012）**：例外两类——① 0.1.2 认证 dsh 无 token → **报错不另起**；② 用户粘贴 token 连接的外部认证实例 → 可管理，停止/重启走 A 档（确认弹窗 + 杀前身份确认 + 只杀单 pid）。见设计决策 9。
3. **spawn 环境净化。** env 里删掉扩展宿主注入的 `NODE_OPTIONS` / `ELECTRON_RUN_AS_NODE`；Windows 下 `.cmd` shim 走 `shell: true`。
4. **`--no-open` 按版本 gate。** 只有 dsh ≥ 0.1.0-rc.7 认识该参数，旧版收到会直接退出。
5. **dsh 与窗口生命周期解绑。** reload window 不再中断进行中的 session。必须**双层 spawn**：单层 detached 逃不掉 VS Code reload 时的 SIGTERM 树杀；短命启动器拉起 dsh 后立即退出，dsh 被 launchd 收养才彻底脱离。身份写 pidfile，下个宿主 re-own；dsh 只在用户显式 `dshOne.stop` / `dshOne.restart` 时被杀。意外退出由 30s 健康检查发现（不弹窗）。
6. **就绪轮询 + 身份确认。** 固定端口轮询 probeDsh；port=0 从就绪行解析实际端口后再 RPC 确认。
7. **对话区 = 官方组件装配，不自研聊天 UI（#60/#64/#68）。** 调研的 28 个竞品里，重写派每家都在追官方协议叫苦；自研聊天区（#11 系列，曾做到 537 单测）在 #68 整体下线，原因是长期维护成本：每个 dsh 版本升级都要追协议 + 追 UI 对齐。现方案（装配）：官方 dsh web 前端组件原样下发（插件整包过滤只删官方外框/侧栏两个插件，网关服务端零改动），自有 shell 插件接管根外框与主题，loopback 代理解决登录 cookie 与跨来源。装配架构详见 `docs/assembly-architecture.html`；验证两道关：浏览器验证（Playwright 直开装配页）+ VS Code 验证（`scripts/dev-ui-test.sh`）。
8. **零运行时依赖（#68 起全扩展）。** 宿主与两个 webview 前端全部只用 Node 内置模块 + vscode API；旧聊天 webview 时代的 marked/dompurify 依赖随 #68 移除，`dependencies` 字段为空。
9. **宿主能力口：插件不碰宿主，只调抽象口（#84；#83 起含「开外链」）。** 插件要的宿主能力（跑 git、落盘、持久状态、开外链）统一经 `src/ui/assembly/shell/hostCapabilities.ts` 这层薄 SDK 调用，两侧各有一个实现：VS Code 侧 = 扩展宿主的能力桥（`hostCall` 白名单，`src/ui/assembly/hostBridge.ts`）；官方 web 侧 = **宿主半插件**（`packages/dsh-host-capabilities`，跑在 dsh 宿主进程里，经官方 api-gateway 暴露 Remote 端点，前端用官方 Connection 的 `rpc.call('/api', '<ns>/<方法>', { args })` 调）或页面原生动作（下载用 `a[download]`；开外链用 `window.open`——链接该在用户眼前打开，宿主半在远端/容器里开的会是服务器那台机器的浏览器）。这样同一份插件代码两端都能用（AGENTS.md 铁律「能移植的必须移植」），插件的可移植性不再取决于我们改了多少平台分支。通路与线形态的实测记录见 #84 的 issue comment。
10. **插件的挂载点取官方语义属性，不认自有 frame（#83）。** 官方 web 里没有我们的 shell frame（`[data-shell="dsh-one"]`），插件若按它取挂载点就会静默不工作。所以自有插件统一经 `src/ui/assembly/shell/mountPoints.ts` 取容器：对话区容器 = 官方 `ui-conversation` 的会话滚动体 `[data-conversation-scroll]`（会话流与 composer 都在这棵子树里），composer 座位 = 官方槽位属性 `[data-slot="conversation.composer.bar"]`；容器晚挂载会等、被换掉会重挂。绝对定位的卡片按 CSS 的坐标系（最近的可定位祖先盒）摆放，同样不认自有标记。已按此迁移并改名 `dsh-*` 的三件：`@dsh-one/dsh-git-card` / `dsh-context-menu` / `dsh-composer-clear`（理由与逐层举证见各自文件头）。
11. **外部启动的认证 dsh：防护 + 显式接管（2026-09-06，external-dsh-manage-012）。** 0.1.2 起 dsh 每次启动 mint 随机 token，外部实例的 token 扩展拿不到——认证 dsh 会拒绝无凭证的 host.describe（401+`unauthorized`）。默认动作：探测到认证 dsh 无 token → **报错不另起**，状态栏 tooltip 给出管理入口。B 档：粘贴 token 连接（`GET /?token=` 换票验证）→ 连接并存共享记录。A 档：停止/重启走确认弹窗 + 命令行特征确认 + **只向单 pid 发 SIGTERM**；Windows `taskkill /T /F`。pid 探测三平台：macOS `lsof`、Linux `/proc`、Windows `netstat -ano`+PowerShell（`src/server/externalDsh.ts`）。
12. **可移植的自有插件就是官方格式的 npm 包（#73，2026-09-16）。** `@dsh-one/dsh-*` 那几件（清空件 / 右键菜单 / 提交卡 / 会话导出 / 工作区树）在 `packages/<名>/` 下各有自己的包：清单声明 `dsh.bundle.patch`（官方 `dsh plugin add` 靠它把包并进 profile 的层列表）+ `dsh.client`（`platform: "web"`、`inject`、`external`，官方 client-modules 靠它把 `exports["./client"]` 的 bundle 并进 `__DSH_BOOT__` 与 combo），补丁只 insert 自己一行；包名 = 装配清单里的插件 id。`build.mjs` 按包清单打一份产物，落回包内（`lib/client.js` + 宿主半 `lib/index.js`），再拷进 `dist/assembly/plugins/`——VS Code 侧 mirror 伺服的路径没变，两端吃同一份字节，**一次安装双端生效**。插件本体仍在 `src/ui/assembly/shell/`（包里只有薄边界），源内聚留作后续。链路、字段作用与真机实测跑法见 `docs/plugin-packages.md`；官方页面的真机实测是 `npm run verify:plugins-official`（隔离 HOME + 临时 profile + 独立端口 + 假模型），与装配实验室互补。

## 日志与安全细节

- 所有日志走 `Logger`（`src/log.ts`），写入前 `sanitize()` 会把 URL 的 query 值脱敏成 `***`，避免 token 类参数进日志。新增日志点请走 `Logger`，不要 `console.log`。
- webview CSP 收紧：`default-src 'none'`，script 必须带 nonce；装配页在普通浏览器可开（零 acquireVsCodeApi），loopback 代理负责把请求来源改写成网关自己并剥掉浏览器自动加的来源声明头（`sec-fetch-*`），否则网关按可疑请求拒绝（403）。
