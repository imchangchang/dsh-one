# DSH One 架构

本文写给接手开发的人。对应 `main` 上的 **2.0.0**（2026-09-20 按代码核实）。文中按文件名与标识符定位，不写行号——行号每次改动都会漂。

与本文配套的文档有两份：`docs/assembly-architecture.html`（同一套架构的另一种讲法，画成从上到下四层，便于先看全景）、`docs/dsh-compat-checklist.md`（上游版本兼容面的完整测试项）。术语按 `AGENTS.md` 词表：`slot`（槽位）/ `shadow`（遮蔽）/ `seam` / `combo`（插件整包）这些官方机制名词直接用英文原词，中文只在第一次出现时用括号解释一句。

## 1. DSH One 是什么

DSH One 是 dsh 与 VS Code 之间的桥接扩展。dsh 由用户自己装、自己升（`npm install -g @deepseek-ai/dsh@next`，Node ≥ 22），扩展不下载也不管理 dsh 运行时，只做三件事：找到 dsh、把它起来（或连上已经在跑的那一个）、提供 VS Code 侧的界面。

同一台 dsh 网关同时服务两个前端：浏览器直接打开网关看到完整的官方界面；VS Code 里看到的是我们的**装配页**——官方的前端插件按清单装进我们自己写的 frame（外框）里渲染。网关服务端一行没改，过滤只发生在扩展自己的转发管道里（loopback 代理），所以官方界面照常可用。

「装配（assembly）」在这个仓库里专指这件事：用官方 dsh web 的前端组件在我们的 shell 里组装出 VS Code 界面。

### 三个装配页（三棵树）

树定义在 `src/ui/assembly/trees.ts`，一棵树 = 一份 block list（不进这棵树的官方插件）+ 一个自有 frame 插件 id + 追加的自有插件。三棵树共用同一套 mirror 与页面生成器，差别只在清单与 frame 插件。

| 树 | 落在哪个容器 | block list | 自有 frame 插件 | 追加的自有插件 |
| --- | --- | --- | --- | --- |
| `CHAT_TREE` | 编辑器标签页，命令 `dshOne.assembledChat`（单例，可另开会话标签页） | 2 条：官方外框、官方侧栏 | `@dsh-one/vscode-chat-ui-layout` | theme-follow、session-boot、dsh-session-export、dsh-git-card、dsh-context-menu、dsh-composer-clear |
| `SIDEBAR_TREE` | 侧栏 view `dshOne.chat` | 13 条：官方外框、对话区那几件、设置子页组、侧栏专属件 | `@dsh-one/vscode-sidebar-ui-layout` | theme-follow、settings-gear、session-bridge、dsh-workspace-tree |
| `SETTINGS_TREE` | 编辑器标签页，命令 `dshOne.assembledSettings`（单例） | 14 条：官方外框、官方侧栏、对话流卡片组 | `@dsh-one/vscode-settings-ui-layout` | theme-follow |

每一条 block list 的理由写在 `src/ui/assembly/wireFilter.ts` 里对应清单的注释中，判据与逐条复核结论见本文第 8 章。

浏览器验证（`npm run verify:lab`）在真网关上跑**四棵树**：上面三棵生产树，加一棵只存在于实验室的对照档 `sidebar-official`（同一份 block list、只是不装自有工作区树插件，用来把「自有树」与「官方浏览区」逐项对照）。

## 2. 模块结构

```
dsh-one/
├── package.json              # 清单：命令、配置项、侧栏 view、l10n、workspaces: packages/*
├── build.mjs                 # esbuild 打包：dist/extension.js（宿主）、dist/sessionsWebview.js（旧侧栏前端）
│                             #   、dist/spawnDsh.js（短命启动器）、dist/assembly/plugins/**（自有插件产物）
│                             #   、packages/dsh-host-capabilities/lib/index.js（宿主半）
├── packages/                 # 以「官方 dsh 插件包」形态分发的自有件（每个子目录一个可安装的 npm 包）
│   ├── dsh-plugin-kit/           # 私有（private，不发布）：可移植插件共用的源码——宿主能力口 + 挂载点
│   ├── dsh-host-capabilities/    # 宿主半：跑在 dsh 宿主进程里提供能力与持久状态，经官方 RPC 暴露
│   ├── dsh-workspace-tree/       # 侧栏的工作区/会话树（shadow 官方 sidebar.workspaces）
│   ├── dsh-git-card/  dsh-context-menu/  dsh-composer-clear/  dsh-session-export/
│   └── …                         # 从 dsh-workspace-tree 到 dsh-session-export 这几件是**可移植件**（`dsh-*` = 官方 web 也能用）；清单字段作用见 docs/plugin-packages.md
├── src/
│   ├── extension.ts          # activate/deactivate：注册命令、侧栏 view、默认打开逻辑、各生命周期钩子
│   ├── log.ts                # 日志（输出面板 + 文件 sink），写入前对 URL query 值脱敏
│   ├── server/
│   │   ├── manager.ts        # dsh web 进程生命周期：re-own / 复用探测 / spawn / 就绪 / 健康检查 / 局域网开关
│   │   ├── locateDsh.ts      # 定位 dsh 可执行文件（dshPath 配置 → PATH → 报错引导安装）
│   │   ├── ownedRecord.ts    # 共享身份记录 ~/.dsh/dsh-owned.json（kill 权只记给 spawn 的那个窗口）
│   │   ├── portProbe.ts      # 端口身份探测（host.describe rpcId 回显；401+`unauthorized` → authDsh）
│   │   ├── externalDsh.ts    # 外部实例：三平台 pid 探测 / 命令行身份确认 / 单 pid 优雅停止
│   │   ├── spawnDsh.ts       # 短命启动器：detached spawn 后立即退出，让 dsh 脱离扩展宿主进程树
│   │   ├── dshRpc.ts         # host RPC 客户端（workspace/session 增删改查、命令执行）
│   │   ├── serverAuth.ts     # 认证：token 换登录 cookie、cookie 头、版本探测
│   │   ├── assemblyMirror.ts # loopback 代理：接口/数据流转发 + 整包过滤 + 事件流过滤 + 伺服自有插件
│   │   ├── localBundleRev.ts # dist/assembly/plugins 的内容哈希（整包缓存键里我们自己那一半）
│   │   ├── modernStreams.ts  # 共享逻辑流（$events + session/control）单例：重连退避按 origin 计引用
│   │   ├── hostEvents.ts / muxEvents.ts / remoteMux.ts  # 三条事件流的订阅助手
│   │   ├── lanForwarder.ts   # 局域网转发器：<局域网地址>:<端口> 纯 TCP 透传到 127.0.0.1:<同端口>
│   │   ├── dshUpdate.ts      # npm 上查 dsh 新版本
│   │   └── tagBridge.ts      # loopback tag-bridge：派生脚本代写标签的 HTTP 小服务
│   ├── ui/
│   │   ├── assembly/         # 装配：trees（树定义）、wireFilter（清单过滤）、pageHtml（页面生成）、
│   │   │                     #   probe / failureNotice / selfHeal / hostSdk / hostBridge / hostWorkspaceRoots
│   │   │                     #   （页面诊断、启动自愈与宿主调用通道）
│   │   ├── assembly/shell/   # 只能用在我们 shell 里的 `@dsh-one/vscode-*` 源码：三个 frame 插件、
│   │   │                     #   theme-follow、settings-gear、session-bridge、session-boot、
│   │   │                     #   frameShared（frame 族共享件）、externalLinkShim、shellLocale
│   │   ├── assemblyView.ts   # 三个装配页的宿主侧：命令、面板生命周期、清单与代理的准备、面板恢复
│   │   ├── sidebarStatusPage.ts / installGuide.ts  # 状态页与安装引导页（宿主直渲的普通 HTML）
│   │   ├── sessionsStore.ts  # 宿主侧状态与基线层（旧自研侧栏与宿主命令共用，见本节末）
│   │   ├── sessionsView.ts / sessionsWebview.ts    # 旧自研侧栏（宿主侧 + 前端），已摘钩保留
│   │   ├── dshStateStore.ts  # ~/.dsh/dsh-one/ 的 IO 壳（原子写、目录监视、迁移）
│   │   ├── statusbar.ts      # 状态栏指示与动作面板
│   │   └── shared/           # 宿主与 webview 共用：icons、webviewL10n、animPhase、composeGuard、reconcile
│   └── pure/                 # 纯逻辑，禁止 import vscode（可用 node --test 直接单测）
│       ├── hostCapabilities.ts / hostCalls.ts / hostStateCalls.ts / hostDownload.ts  # 能力口线协议与宿主侧实现
│       ├── workspaceTreeView.ts / sessionPendingSource.ts / treeGroups.ts …          # 侧栏树的数据形态
│       ├── sessionTagGroups.ts / sessionTags.ts / recycleBinState.ts / sessionMarks.ts  # 标签组、回收站、置顶未读
│       ├── chatContract.ts / conversation.ts / sessionTree.ts / hostFrames.ts        # 消息契约与会话模型
│       ├── envelope.ts / readyLine.ts / semver.ts / dshWire.ts                       # 协议小工具
│       └── …                 # 其余按文件名自解释（tokenScan / installGuidePage / statusTooltip 等）
├── test/                     # src/pure 的单测（node:test）+ assembly-lab（浏览器验证）+ mock-dsh 协议夹具
│                             #   + legacy-sidebar(旧侧栏参照 harness) + sandbox(容器装机验收)
└── scripts/                  # 开发流程脚本（dev-start/finish/merge、两道静态自检）+ 上游探针 + 各项 verify
```

几处容易搞错的地方：

- **侧栏树不住在 `src/ui/`**。当前侧栏（工作区/会话树）是 `packages/dsh-workspace-tree/`，作为装配的一棵树的 shadow 插件运行在页面里；`src/ui/sessionsView.ts` + `src/ui/sessionsWebview.ts` 是一度用过、已摘钩的**旧自研侧栏**（`#65` 迁移参照物，保留给 `test/legacy-sidebar/` 做对照），运行时不再注册，`extension.ts` 里没有它。
- **可移植插件的源码住在自己的包里**（`packages/dsh-*/src/`），`src/ui/assembly/shell/` 只剩只能用在我们 shell 里的件：七个插件的源码（三个外框、主题跟随、会话桥、会话启动注入、设置齿轮），以及它们共用的 `frameShared.ts` / `shellLocale.ts`、两个入口文件 `clientEntry.ts` / `sidebarFrameEntry.ts`，还有给 frame 装的外链捕获 `externalLinkShim.ts`。
- **`src/server/assemblyMirror.ts` 与 `src/ui/assemblyView.ts` 是装配的两半**：前者是页面要连的那台 loopback 服务器（跑在扩展宿主进程里），后者决定什么时候开哪个面板、装哪棵树。
- **`src/ui/sessionsStore.ts` 不是侧栏树的数据层**。它持有宿主侧的状态与基线（供宿主命令、旧侧栏参照物用），装配树的数据来自页面里的官方 hooks，只有「宿主动作 + 持久状态」经宿主能力口来回（见 §6）。

## 3. 核心流程一：定位 dsh

入口在 `ServerManager.start()` 里，`src/server/locateDsh.ts` 的 `locateDsh()` 走三步：`dshOne.dshPath` 配置非空就用它，否则用 PATH 上的 `dsh`；对候选跑一次 `dsh --version` 验证；从输出里提取 semver，提不到记 `unknown`（按新版对待）。

定位失败抛 `DshNotFoundError`，状态里带 `reason: 'dshNotFound'`，侧栏据此显示「未安装」并给「查看安装指南」（`src/ui/sidebarStatusPage.ts` / `src/ui/installGuide.ts`，都是宿主直接渲染的普通 HTML——网关起不来时装配页也起不来，这一层只能由宿主出）。

升级不靠扩展下载：`dshOne.checkUpdate` 查 npm 上的新版本，`dshOne.upgrade` 在可见终端里跑 npm 全局安装命令，用户可随时中断。装完要重启 dsh 服务才生效。

## 4. 核心流程二：服务启动

入口 `ServerManager.ensureStarted()`，单例语义：并发调用共享同一个在飞的 promise；实际逻辑在 `start()`。

1. **re-own（reload 后认领）**：dsh 与 VS Code 窗口的生命周期是解绑的（见 §9 决策 5），上一个宿主 spawn 的 dsh 可能还在跑。先读共享记录 `~/.dsh/dsh-owned.json`：`owner` 与当前窗口身份一致、pid 存活、端口身份确认通过 → 认回 owned 身份（有 kill 权）；owner 不同 → 认证式 adopted（绝不 kill）。记录过期就删掉继续正常流程。
2. **探测与复用**：`port > 0` 时先 `probePort(port)` 四态探测——POST `http://127.0.0.1:<port>/api/host.describe`（信封在 `src/pure/envelope.ts`，按 rpcId 回显校验身份）。`'dsh'` → `running` + `adopted`，复用实例永不 kill；`'authDsh'`（0.1.2 起每次启动 mint 随机 token，我们拿不到）→ 先从日志里试一次「恢复 launch token 认回」，失败才落 `error` + `reason: 'authDshNoToken'`，不另起实例，改由用户粘贴 token 连接（B 档）；`'foreign'` → 从 `port+1` 起往后扫最多 50 个端口顶替；`'down'` → 原端口 spawn。`port = 0` 跳过探测。
3. **spawn（双层）**：env 里删掉 `NODE_OPTIONS` / `ELECTRON_RUN_AS_NODE`（宿主注入的，会干扰子进程）；参数 `web --host 127.0.0.1 --port <端口>`，dsh ≥ 0.1.0-rc.7 追加 `--no-open`（旧版收到这个参数会直接退出，所以按版本 gate）；`--trusted-host <局域网地址>` 只在开启局域网访问、且版本 ≥ 0.1.6-alpha.1（官方从这版才有这个参数）时加。经 `dist/spawnDsh.js` 做 detached spawn（stdio 写日志文件），dsh 脱离扩展宿主进程树，启动器回传真实 pid 写进共享记录。
4. **就绪轮询**：固定端口每 250ms 探一次；`port = 0` 从日志里解析就绪行（`src/pure/readyLine.ts`）拿到实际端口。90s 超时或 pid 提前消失即失败，错误里带日志尾部 40 行。
5. **健康检查**：就绪后每 10s 重探一次；失联回 `stopped`，owned 实例还会被杀掉回收端口。dsh 意外退出统一靠健康检查发现，不弹窗。
6. **局域网转发器**：状态 `running` 且这个实例带过 `--trusted-host` 时起（见 §7）。
7. **UI 就位**：侧栏 view 的状态页按 `onDidChangeState` 跟着服务状态重画；装配对话区在用户打开、或侧栏第一次变得可见时自动打开一次（本窗口只自动开一次，用户手动关过就不再强开）。

`activate()` 默认自动 `ensureStarted()`（配置 `dshOne.autoStart`，默认 `true`）。

**一条已知并接受的竞态**：dsh 死后 pid 被系统复用、那个端口又被另一台手动启动的 dsh 占上时，stop 有可能误杀复用这个 pid 的进程组。杀之前的命令行身份确认（`src/server/externalDsh.ts` 的 `isDshCommandLine`）只能把窗口压低，消不掉——两个 dsh 共享 `~/.dsh` 的代价比这个窗口大得多。

## 5. 核心流程三：装配一次

命令与容器：`dshOne.assembledChat`（对话区面板）、`dshOne.chat`（侧栏 view）、`dshOne.assembledSettings`（设置页标签页）。三者共用 `src/ui/assemblyView.ts` 里的同一套流程：

1. `ensureStarted()`；状态不是 `running` 就落状态页（三态由 `src/pure/sidebarStatus.ts` 的纯函数判定，装配失败与「未安装」「服务没跑」各有自己的文案与按钮）。
2. **取清单**：带 cookie GET 网关 `/`，从注入 HTML 里取出 `__DSH_BOOT__` 清单与前端资产名（`extractBootWire` / `extractFrontendAssets`），版本不在 `[0.1.2-rc.1, 0.2.0)` 时给页面顶部加一条信息条（**不阻断**）。
3. **过滤清单**：`filterWire()` 按该树的 block list 剔除条目，application 批的整包 URL 改指 mirror 的 `/plugins-local/…`，追加该树的自有插件条目。整包 URL 里的 `rev` 是缓存键，同时代表两半内容（官方那份 + 我们自己的 bundle 内容哈希，见 §9 决策 11）。
4. **起共享 mirror**：同一窗口同一网关地址只起一个 loopback 代理（引用计数，最后一个面板关掉才收），它按树各缓存一份过滤后的整包。
5. **生成页面**：`assemblyPageHtml()` 出一份 HTML（`__DSH_BOOT__` 内联 + 启动自愈 + 阻塞 bootstrap script + 主 bundle + `__DSH_TRANSPORT__` seam + 探针 + 失败提示条），设进 webview。
6. **页面里**：官方 WebBoot 按清单装插件（官方插件从 mirror 的过滤整包拿，我们的插件从 `/plugins-local/…` 的本地路径拿），我们的 frame 插件注册 `root` slot 并渲染整页。打开某个会话的注入、当前会话的上报、主题跟随都在这一步之后由自有插件接管。官方启动审计报「某条目起不来」时，页面运行时的启动自愈接手：把官方点名的那一条从**本页清单**里摘掉、把这一页重载**一次**（再失败落到失败提示条，见 §「页面运行时」那三条）。
7. **渲染**：对话区是官方 `ui-conversation` 的组件；侧栏页是我们的工作区树 shadow 掉官方 `sidebar.workspaces`；设置页渲染官方的 `settings.*` 槽位。

面板生命周期（`src/ui/assemblyView.ts`）：

- 对话区是单例面板，后开替换先开；另有「在新标签页打开」的会话标签页（一个会话一个面板）。面板与 webview 状态经 `acquireVsCodeApi().setState()` 存在页面上，标签页的恢复注册在 `registerWebviewPanelSerializer`（`view type` 与状态形状在 `src/pure/chatPanelState.ts`）——窗口重载或扩展宿主重启后标签页能装回原会话，恢复不出来就落状态页而不是丢标签页。
- 侧栏 view 用 `retainContextWhenHidden`，折叠不触发 dispose；服务在别处起停时状态页跟着重画（`src/pure/sidebarStatusFollow.ts`）。
- 设置页也是单例面板。
- 扩展激活且网关在跑时后台预热一次 mirror 与三棵树的过滤整包（`preheatAssembly()`），失败只落日志。

## 6. 状态与配置

### ServerStatus（`src/server/manager.ts`）

| 字段 | 说明 |
| --- | --- |
| `state` | `stopped` / `starting` / `running` / `error` |
| `url` / `port` | 运行中时的服务地址与端口（`port = 0` 时来自就绪行解析） |
| `adopted` | 连的是已有实例，任何清理路径都不会 kill 它 |
| `external` | 连的是外部启动的 dsh（粘贴 token 连接或探测到认证实例）：可管理，但停止/重启要确认弹窗 + 单 pid |
| `version` | 定位时 `dsh --version` 报的版本 |
| `error` / `reason` | 错误详情（含日志尾部 40 行）；`reason` = `dshNotFound`（未安装）或 `authDshNoToken`（端口上是认证 dsh 且无 token） |

### 配置项（`package.json` 的 `contributes.configuration`）

| 配置 | 默认 | 消费位置 |
| --- | --- | --- |
| `dshOne.dshPath` | `""` | `locateDsh()` |
| `dshOne.port` | `3080` | `ServerManager.start()`（`0` = 让系统分配，跳过复用探测） |
| `dshOne.autoStart` | `true` | `activate()` |
| `dshOne.lanAccess` | `false` | `ServerManager`（局域网转发器与 `--trusted-host`，见 §7） |

### 磁盘与状态：谁拥有什么

| 位置 | 存什么 | 谁写 |
| --- | --- | --- |
| globalStorage（per user-data） | dsh 的 stdout/stderr 日志 `dsh-web.log`（每次 spawn 截断） | 扩展（shell 关注点） |
| `~/.dsh/dsh-owned.json` | 共享身份记录：owner、pid、端口、token、`source` | 扩展（shell 关注点；另一 user-data 的窗口靠它认证式 adopt） |
| `~/.dsh/dsh-one/*.json` | **插件状态**：回收站名单、分组定义、标签组、置顶、未读 | 宿主半的状态存储模块（VS Code 侧由扩展宿主代行同一份模块，见 §9 决策 7） |
| `~/.dsh`（其余） | 会话日志、workspace 注册表、`settings.yaml` | dsh 自己，扩展不读写 |

VS Code 的 `globalStorage` / `workspaceState` / Memento 只允许用于 shell 自身的基础设施（进程管理、代理生命周期、面板布局、旧侧栏的展开折叠这类纯视图态与窗口态），插件状态一律不落那里——理由是双端复用（官方 web 拿不到 VS Code 的存储）与语义一致（dsh 插件的状态就该在 dsh 里）。今天实际用到的：`workspaceState` 一个键 `dshOne.assemblyAutoOpened`（记「本窗口已经把对话区自动打开过一次」），`globalState` 里是旧侧栏留下的折叠态与几个只用于迁移读取的旧键。

## 7. 局域网访问

dsh 上游出于安全只监听 `127.0.0.1`（拒绝 `--host 0.0.0.0`），所以局域网可达性由扩展提供：`src/server/lanForwarder.ts` 在 `<局域网地址>:<端口>` 上收 TCP 连接，原样透传给 `127.0.0.1:<同端口>` 的网关——不做 HTTP 解析，Host 头、Cookie、WebSocket 升级都原样过线。要配合 spawn 时加 `--trusted-host <局域网地址>`，否则网关的 Host 信任栏会拒掉局域网来的请求。

多窗口共用同一个地址与端口：先到者持有监听，后到者探测到「有人在听」就按对端在转发处理，不抢绑。开关是配置 `dshOne.lanAccess`，状态栏提供一键重启切换与复制链接（`dshOne.copyLanLink` / `dshOne.restartLan` / `dshOne.restartLocal`）。`--trusted-host` 是 dsh 0.1.6-alpha.1 才有的参数，版本不够时只记一条日志、保持本机可见。开着的时候任何拿到带 token 链接的同一局域网设备都能用 dsh（包括在你机器上跑命令），README 的安全一节写的就是这件事。

## 8. 我们对上游 dsh 的依赖面

这一章是给「上游改了什么、我们会怎么坏」用的。分五节：依赖什么、block list 为什么这么定、我们用了官方哪些原生机制、漂移怎么被发现、发版时跑什么。

### 8.1 依赖官方的哪些东西

#### 官方插件清单与整包（combo）

网关 `/` 的注入 HTML 里带一份 `__DSH_BOOT__`（清单：entries + batches + 各自的 URL 与 `rev`），以及应用批的整包 URL。我们读它、按 block list 过滤后内联进自己的页面，并从 `__DSH_BOOT__` 之外还取三样东西：`__ModuleLoader__` 门面（队列模式，官方 WebBoot 消费的最小面）、`const preference` 主题预置、以及前端资产的哈希文件名（module js / modulepreload / css）。

整包本身**不能重拼**：官方按内容校验 `rev`，改插件名单重新申请会 404，所以过滤是在我们自己这一端做的——mirror 拉官方原整包、按 `window.__ModuleLoader__.load({` 的段边界切开、删掉 block list 里的段、拼好再伺服给页面（`src/server/assemblyMirror.ts` 的 `fetchFilteredGatewayCombo`）。bootstrap 批只有官方 `client-modules`，永不过滤。

清单条目数随上游版本与用户 profile 变化，探针实测过的读数：0.1.6-alpha.1 = 56 条 entries、0.1.2-rc.1 = 46 条。

#### 用到的 slot 名（14 组）

名单的单一事实源在 `scripts/dsh-upstream-watch/clientContract.mjs` 的 `SLOT_DEPENDENCIES`，由 `test/upstreamClientContract.test.ts` 保证「名单里的名字在 `src/` 里还有取用点」。

| 组 | 名字 | 用在哪 |
| --- | --- | --- |
| root 与 root 子槽 | `root`、`main` / `conversation`、`rightbar` / `details`、`sidebar`、`shell.overlay` | 自有 frame 注册 `root` 并声明子槽；`main` 是会话面板座（0.1.2 线是 single `conversation`，0.1.6 线是 keyed `main`），`rightbar` 是右列座（0.1.2 线叫 `details`） |
| 侧栏细槽 | `sidebar.workspaces`、`sidebar.workspaces.directoryFlow`、`sidebar.brand.mark` / `sidebar.brand.name`、`sidebar.settings` | 自有工作区树遮蔽 `sidebar.workspaces`；自有 frame 提供品牌位并遮蔽官方品牌块；设置齿轮遮蔽 `sidebar.settings` |
| 设置页 | `settings.section`、`settings.header`、`settings.action` | 自有设置 frame 渲染官方的设置节、标题与动作 |
| 对话区 | `conversation.input.overlay`、`conversation.session.header.utilities` | 清空件的提示浮层、会话日志导出的入口 |

#### 用到的 root 级 hook（4 组）

官方 `ctx.slots.provideRoot({ hooks: … })` 下发的钩子，框架会把它映射成槽位 props（`use<Name>`）：

| hook | props | 谁提供 | 我们为什么依赖 |
| --- | --- | --- | --- |
| `panelInfo` | `usePanelInfo` | 官方 ui-layout；被我们 block 后由自有 frame 补上 | 0.1.6 起官方的会话树与右侧栏读它，缺了挂载即抛 `usePanelInfo is not a function` |
| `sessions` | `useSessions` | 官方 ui-session | 自有工作区树的会话数据全部来自它 |
| 会话等待态：`sessionStatus`（新）/ `sessionPendingInteraction`（旧） | `useSessionStatus` / `useSessionPendingInteraction` | 官方 ui-session | 侧栏会话行的状态点（等审批/等提问）按它渲染；名字表在 `src/pure/sessionPendingSource.ts`（新→旧两代） |
| `workspaces` | `useWorkspaces` | 官方 ui-workspace | 自有树的分组树数据来自它 |

#### 用到的官方预留 seam

| seam | 我们怎么用 |
| --- | --- |
| `__DSH_BOOT__` | 读网关那一份拿到清单与资产名；把过滤后的清单内联进装配页（`pageHtml.ts`） |
| `__DSH_TRANSPORT__` | 官方留给「不同物理传输的 shell」的接口。webview 的页面源是 `vscode-webview://<uuid>`，而官方客户端按 `location.origin` 寻址，所以我们在页面里提供 `fetch`（把宿主寻址的请求换源到 mirror）、`openStream`（自建 WS 说 `remote.mux` 协议）与 `ownsHost: true`（声明传输层拥有 loopback 宿主权威，官方 `isLoopback` 判定读它——不声明会掉进「浏览器里设置不可用」那一档）。页面全局 `fetch` 也一并改写两类宿主寻址 URL（页面自己的源、官方内部常量 `http://dsh.internal`），Request 对象与真外部源原样放行 |
| `__DSH_BOOT_READY__` | 装配页在 `<body>` 末尾按官方启动形态兑现它 |
| `__ModuleLoader__.load({ id, factory })` | 我们的自有插件 bundle 就是这个格式（打包时的 banner/footer，id 必须等于包名）；镜像也按这个边界切整包 |
| 种子表 externals | 自有插件 bundle 里 `react` / `react/jsx-runtime` / `@deepseek-ai/cordis` / `@deepseek-ai/dsh-client-store` 保持 `require()`，由官方主 bundle 的种子表满足；打进包会双重实例化 |
| `dsh.client` 插件声明 | 可移植包在清单里声明 `dsh.bundle.patch` + `dsh.client`，官方 client-modules 据此把 `exports["./client"]` 并进 `__DSH_BOOT__` 与整包（字段作用见 `docs/plugin-packages.md`） |
| 官方 Connection 的 RPC 口 | 宿主半的能力经 `connection.rpc.call('/api', '<ns>/<方法>', { args })` 调用（官方生成版客户端同一形状） |
| `dsh plugin add` + profile 层 | 可移植包装进 profile 的方式（官方按装到的状态重算层列表） |

#### 用到的官方内部标识符（`officialIdentifiers.mjs` 的 11 条）

这一族查的是**本机已安装的官方包文件**里的名字（离线、只读磁盘），它们坏了都**不报错、只是不生效**：提示不弹、官方件悄悄冒回界面、遮蔽目标对不上。逐条如下（出处文件、探针条目名与 `why` 见 `scripts/dsh-upstream-watch/officialIdentifiers.mjs`）。

| 条目 | 是什么 | 漂了我们这边会怎样 |
| --- | --- | --- |
| `root-children.sidebar` / `main` / `rightbar` / `shell.overlay` | 官方 `dsh-client-ui-layout` 的 root 子槽声明表四个座（含 kind 与 scope） | 我们复刻了这份声明表；漏一项或名字变了，挂在它下面的官方子树整块注册失败 |
| `sidebar-toggle.zh` / `sidebar-toggle.en` | 官方侧栏折叠钮的中英文无障碍文案（词典键 `toggle.collapse`） | 留作官方文案的记录（`#178 C8` 起我们不再按文案认这枚钮，改按 `logoRow` 藏） |
| `entry-id.session-log-download` | 官方会话日志导出条目在 `conversation.session.header.utilities` 上的 id | 我们按条目 id 遮蔽它、换成自有导出；改名则官方那枚按钮冒回会话头 |
| `entry-id.appearance` | 官方设置「外观」行在 `settings.general.item` 上的 id | 同上（同 id + priority −1 注册空件遮蔽）；改名则官方外观行冒回设置页 |
| `entry-id.open-document` | 官方设置「打开配置文件」动作者在 `settings.action` 上的 id | 同上（我们自有那条的 id 是 `open-document-vscode`） |
| `entry-id.cordis-panel` | 官方 cordis 面板在 `sidebar.footer.action` 上的条目 id | 我们往同一个 list 槽追加底部入口，排位相对它算；改名则「谁前谁后」的假设静默失效 |
| `snapshot-field.lastAgentError` | 官方会话快照里的失败字段 | 会话被另一个 dsh 占着写句柄时那条提示的判据；改名则提示静默消失（主流程不受影响） |

### 8.2 block list 逐条：每一棵树下线了什么、为什么

判据统一是两条：**① 与 VS Code 容器的形态冲突**（官方件要占同一块视觉区域，或画我们不要的外框）；**② 这棵树声明不了它注册的槽位**（槽位没声明 ⇒ 官方 `slots.inject` 的回调永不跑 ⇒ 整个条目停车、零渲染，继续挂着只是白背一个官方 id 依赖，摘掉才是对的）。2026-09-18 起按这套判据把 22 个 id 逐条复核过一遍（`#180`，续 `#202` / `#204`）。

**三棵树共有的一条：官方外框 `@deepseek-ai/dsh-client-ui-layout`。** 官方 AppFrame 自己画三列网格、拖拽把手与最窄 56px 侧栏轨，与 VS Code 的容器形态直接冲突，由该树的自有 frame 插件接管 root 组合。为什么不能走铁律的首选路径（加载官方件 + 只遮蔽它的 root slot）：`#77` 实测三条硬约束——root 子槽的声明是排他的（两边谁先登记都会让另一方死）、渲染授权按条目算（遮蔽后契约全活着但没有人渲染那些槽位）、服务提供点在同一隔离域唯一（第二次 `provide('layout', …)` 抛错并让整页 boot 失败）。证据与结论留在 `src/ui/assembly/shell/frameShared.ts` 的文件头，接手的契约清单也在那里（见 §8.3）。

**`CHAT_TREE`（2 条）**：官方外框 + 官方侧栏。后者是因为对话区这棵树没有侧栏位——侧栏位由 `SIDEBAR_TREE` 承担。对话流卡片全保留；`#202` / `#204` 把 `ui-settings-general` 与两件插件设置页从这份清单里摘掉了（本树一个 `sidebar.settings` 子槽都没声明，它们本来就在停车）。

**`SIDEBAR_TREE`（13 条）**：

- 官方外框（同上）。
- 对话区那几件必须下线的（`FLOW_BOTH_TREES`）：`ui-workflow-run` / `ui-deliverables` / `ui-trajectory` / `ui-goal` / `ui-plan` 的 inject 里有官方 `uiConversation` 服务，而该服务由 `ui-conversation` 提供、在这棵树里也被下线——缺服务是硬约束，放回去会停在「未激活」，而 boot 的规矩是一个条目没激活就整页抛错。`ui-plan` 是 `#225` 加进来的：它在 0.1.6-alpha.2 里开始等这个服务（`0.1.6-alpha.1` 不用等），此前只被 `SETTINGS_TREE` 下线，于是侧栏树当场被官方启动审计挡住（`web boot: 1 entry did not activate`）。`ui-directory-picker-native` 注册的 `sidebar.workspaces.directoryFlow` 在这棵树里**真被声明**（官方 WorkspaceBrowser），放回去会把官方原生目录选择器注册进我们自己的树里，形态与添加工作区那条流程都会变。
- `ui-settings-general`：它注册的槽位全是 `sidebar.settings` 的子槽，而这棵树有官方侧栏壳、声明得了那个槽位，它的 `SettingsRoot` 会真的注册进来——所以继续下线（我们那行设置入口按 priority −1 遮蔽它，不靠遮蔽兜底）。
- 设置子页组 `ui-settings-plugins` / `ui-settings-plugin-inventory`：它们等待的槽位都在 `sidebar.settings` 之下，而这棵树里 `ui-settings-general`（槽位声明方）被下线，于是整件停车——挂着不花用户流量，摘掉只是少一个 id 依赖，按 `#180` 对同类项的口径留在清单里。
- 侧栏树专属三件：`ui-chat`（对话流卡片大段）、`ui-conversation`（对话区卡片宿主）、`ui-agent-preset`（挂对话区 hero 的会话级座）——侧栏这棵树没有对话区。

**清单怎么来的、怎么核（#227）**：上面的条目是手写的——形态类（官方外框、官方侧栏、设置子页组这些与版本无关的）只能人定，服务类（挡掉一个服务提供方，就得把等它的 entry 一起挡掉）可以按官方包**静态**算出来。「算」的规则一句话：**一棵树挡掉的包，凡是等它的 entry 也一起挡掉**（顺着依赖一层层找，直到不再新增）；判据是**服务**——每件官方包的 bundle 导出的 `inject` 服务名表（它等哪些服务）＋提供服务的调用点（它提供哪些服务）。同名服务只要还有一个没被挡的提供方，这个服务就还在（三棵树的 frame 插件都 `reflect.provide('layout', …)`，官方 ui-layout 被挡不影响任何人）。

要注意**别拿 `package.json` 的 `dsh.client.inject` 来算**：那是 wire 里每个 entry 的 `inject`，内容是**模块 id**，只决定装载顺序。按它做闭包会把三棵树里真正要用的官方件一起挡掉——实测 chat 2 → 38、sidebar 13 → 39、settings 14 → 38 条，多出来的里面有对话区本身与官方侧栏壳；而依赖方并不会因为对方被挡而不激活（对话区那棵树挡了 `ui-layout`、`ui-conversation` 的模块表里就列着它，对话区照样全绿）。真正让整页 boot 失败的是**服务**：缺一个服务，cordis 停在 `pending (waiting for service: X)`——#225 那起事故（侧栏树挡了 `ui-conversation`、没挡等它的 `ui-plan`）就是这一类。

算出来的清单是**偏保守**的：静态表认不出「同名服务的两代名字」这类等价关系时，会把一个还在的服务当成没了，于是多挡一条。代价是少加载一个本来也不渲染的 entry，方向无害；反过来（少挡）会让整页 boot 失败。所以：**只补不删**（手写清单一条不放），补齐的结果由每日探针按本机官方包离线算出并对比（`block-list-drift`，见 §8.4），少挡一条就红。

**`SETTINGS_TREE`（14 条）**：官方外框 + 官方侧栏（设置页不是侧栏位页，侧栏壳不该进来；它的 `register` 在 `slots.inject('sidebar', …)` 里，本树不声明那个槽位，槽位没声明就整件停车）+ 上述对话区那 6 件 + 只在设置树下线的 6 件（工具卡、附件画廊、subagent 卡、后台任务卡、消息反馈、会话日志导出）。后 6 件在别的树里放行，只在这棵树下线：设置页声明了 keyed `main`（官方 ui-conversation 的整棵对话子树挂在这个名字上，不声明它，官方 ui-agent-preset 的会话级 scope 会抛 `slot "conversation.hero.agentPreset" is not declared`），于是这些槽位在设置页里**是声明了的**，放回去会真的注册进那棵子树。今天渲染不出来只因为我们恰好只渲染自己那条 keyed 条目；把设置页的形态押在这条实现事实上不划算。

### 8.3 我们用官方原生机制做了哪些 shadow 与槽位贡献

一律走官方机制层 1（槽位机制）与层 2（官方服务 API），没有 DOM 兜底。

**接管官方契约（不是 shadow，因为对方被下线了）**：三棵树的 frame 插件接手了官方 ui-layout 对插件承诺的全部四项——① root 槽位注册与子槽位声明表（`sidebar` / `main` / `rightbar` / `shell.overlay`，加 0.1.2 线的 `conversation` / `details`）；② `ctx.layout` 服务（官方 `ILayout` 语义，含 `openRightbar` / `closeRightbar` 的呈现上报）；③ 主题呈现 `ThemePresenter`；④ root 级 hook `panelInfo`。核对办法：读 `dsh-client-ui-layout/lib/client.js` 的 `apply()` 与 `lib/types/client/*.d.ts`，逐项对照 `frameShared.ts` 文件头那份清单；常驻核对是 `npm run verify:lab` 的 CONTRACT 套件（四棵树零未激活、零槽位崩溃、关键槽位有内容、根条目声明表覆盖预期槽位名）。

**shadow（同名单独注册 + 更低优先号，官方件仍在注册表里、契约照常存活）**：

| 目标 slot / 条目 | 谁遮蔽 | 优先号 |
| --- | --- | --- |
| `sidebar.workspaces`（官方 WorkspaceBrowser） | `@dsh-one/dsh-workspace-tree` | −1 |
| `sidebar.settings`（官方 SettingsRoot） | `@dsh-one/vscode-settings-gear` | −1 |
| `sidebar.brand.mark` / `sidebar.brand.name` | `SIDEBAR_TREE` 的 frame（藏掉官方品牌块，VS Code 原生视图头已自报家门） | −1 |
| `conversation.session.header.utilities` 上的条目 id `session-log-download` | `@dsh-one/dsh-session-export`（同一个 cell 里自有那条上位） | −1 |
| `settings.general.item` 上的条目 id `appearance` | `SETTINGS_TREE` 的 frame（注册空件） | −1 |
| `settings.action` 上的条目 id `open-document` | 同上（我们自有那条是 `open-document-vscode`，走 VS Code 编辑器） | −1 |

**槽位贡献（往官方槽位里加自己的东西）**：`shell.overlay` 上注册右键菜单层与 git 卡片浮层；`conversation.input.overlay` 上注册清空/撤销提示；`sidebar.footer.action` 上追加回收站入口行（官方 `cordis-panel` 那条照旧并存）；`settings.action` 上追加「打开配置文件」；设置页渲染官方的 `settings.section` / `settings.header` / `settings.action`；chat 树的 frame 声明并渲染官方的 `rightbar`（官方右侧栏与文件/终端/文档预览三件因此在这棵树上真生效）。

### 8.4 漂移怎么发现

三层，各管一类坏法，都不互相替代：

| 手段 | 查什么 | 什么时候跑 |
| --- | --- | --- |
| 每日上游探针（`scripts/dsh-upstream-watch/probe.mjs`，23 项） | **名字还在不在**：伺服面（wire 协议、认证、RPC、WS 帧、网关 `/` 的启动契约、整包端点、Origin 栅栏，17 项）+ 客户端契约面（整包里的 slot 名/hook 名/字段名，4 项）+ 官方产物面（本机官方包里的 11 条内部标识符 + 三棵树 block list 的服务依赖补全，2 项） | GitHub Actions 每日 04:00（UTC+8），结果进 `upstream-watch` label 的 issue 与 README 徽章 |
| 浏览器验证的 CONTRACT / FIBER / WIRE-LIVENESS 套件（`npm run verify:lab`） | **装起来活不活**：四棵树零槽位崩溃、零装载未激活、关键槽位有内容、根条目声明覆盖预期槽位名（F-01）；四棵树零 cordis fiber 进 FAILED（F-10，fiber 失败不进浏览器控制台）；三棵树 block list 的每个 id 都要在当天 wire 里找得到（F-11，官方改名会让过滤静默失效） | 改装配相关代码后必跑；接新版本时用 `npm run verify:lab-version <版本>` |
| `docs/dsh-compat-checklist.md` 的「装配面」一节 | 探针查不出的那一类（**名字一个没少、语义变了**）：0.1.6-alpha.2 上客户端契约面全绿，可页面整棵渲染不出来 | 接新版本时按那一节的流程走 |

探针只读字节，所以它看不见「名字还在但装起来不活」；实验室只看行为，看不见「官方把某个我们没在页面上跑过的名字改了」。两者合起来才覆盖：#76 的 `usePanelInfo is not a function`、`imageIds` → `attachmentIds` 是探针抓的；0.1.6-alpha.2 的整页白、会话服务删掉 `open` / `select` / `clear`、`current` 字段消失、`completed` 挪进 `sessionStatus` 是实验室抓的。

**block list 的服务依赖补全**（#227，`blockListDrift.mjs` + `src/pure/blockListDerivation.ts`）：离线读本机官方包（bundle 导出的 `inject` 服务表 + 提供服务的调用点），按 §8.2 那条规则算出每棵树的清单，与 `wireFilter.ts` 的现状对比：**少挡一条即红**（点出条目、它等的服务、被挡的提供方），规则算不出来的手写条目（形态/角色理由）只报读数。本机 0.1.6-alpha.2 实测：三棵树 少挡 0 条（对话区 2/2、侧栏位 13/13、设置页 14/14）；把 `ui-plan` 从侧栏清单里删掉即红。纯函数与探针模块的单测在 `test/blockListDerivation.test.ts` / `test/blockListDrift.test.ts`。

### 8.5 支持的版本与上游发版时跑什么

**版本门**：装配页期望 dsh `[0.1.2-rc.1, 0.2.0)`（更低的缺浏览器会话认证与装载协议，更高的未验证）。这道门**不阻断**：区间外只在页面顶部出一条信息条。端到端验过的版本：`0.1.2-rc.1`、`0.1.6-alpha.1`、`0.1.6-alpha.2`（逐版本发现的问题见 README 的 Tested versions 表）。

**上游发版时该跑什么**（与 `AGENTS.md` 的验证三层一一对应）：

| 跑什么 | 命令 | 覆盖 |
| --- | --- | --- |
| 上游探针 | `node scripts/dsh-upstream-watch/probe.mjs --command dsh --expect-version <版本>`（CI 每日自动跑） | 名字面 |
| 候选版本上的浏览器验证 | `npm run verify:lab-version <版本>` | 装配面（候选版本装到临时目录再跑实验室，不动本机安装） |
| 本机版本的浏览器验证 | `npm run verify:lab` | 同上，改装配相关代码后也要跑 |
| 宿主半验证 | `npm run verify:host-half` | 网关侧插件半（`packages/dsh-host-capabilities`）与官方 dsh 的兼容 |

**接新版本的正确次序**：先跑探针（名字面）→ 再跑 `verify:lab-version <版本>`（装配面）→ 过了再登记进 README 的 Tested versions。细节与逐项清单在 `docs/dsh-compat-checklist.md`。

**新增一条依赖 = 在三张表里加一行**，否则 `test/upstreamClientContract.test.ts` / `test/upstreamOfficialIdentifiers.test.ts` 会提醒；不再依赖就把那一行删掉。三张表分别是 `clientContract.mjs` 的 `SLOT_DEPENDENCIES` / `ROOT_HOOK_DEPENDENCIES` / `IDENTIFIER_DEPENDENCIES` 与 `officialIdentifiers.mjs` 的 `IDENTIFIERS`。

## 9. 设计决策

以下取舍到今天仍然成立；每条只讲取舍与理由，过程与取证指向对应的 issue。

1. **桥接而非整合包。** dsh 由用户自己装、自己升，扩展只定位、启动、连接。这样扩展不必承担 Node / dsh 的版本管理与跨平台下载，也不会出现「扩展升级与 dsh 升级互相牵制」；代价是用户要自己装一次 dsh，未安装时扩展只能给安装引导。
2. **先探后起，复用实例永不 kill。** 两个 dsh 实例共享 `~/.dsh` 并发写会损坏会话日志，所以启动前必须先探测端口身份，已有实例就复用它。探测到的认证 dsh 没有 token 时（0.1.2 起每次启动 mint 随机 token）**报错不另起**，由用户粘贴 token 连接；连上的外部实例可以停止/重启，但要确认弹窗 + 命令行特征确认 + 只向单 pid 发信号。
3. **spawn 环境净化 + 双层 spawn，Windows 绕开 cmd 外壳。** env 里删掉宿主注入的 `NODE_OPTIONS` / `ELECTRON_RUN_AS_NODE`；spawn 必须经短命启动器做双层，单层 detached 逃不掉 VS Code reload 时的 SIGTERM 树杀。Windows 上 dsh 是 npm 全局装的 `.cmd` shim，而 detached 下 cmd.exe / PowerShell 这类控制台外壳的输出链会断（CI 实测 pipe 收集与文件 fd 直传都是 0 字节，与包装方式无关），所以启动器优先解析 shim 背后的 `dsh.js` 让 node 直跑，解析不到才回退 `cmd.exe /d /s /c` 内部重定向（由 cmd 自己写日志文件）。代价是多一个 `dist/spawnDsh.js` 与一套共享记录认领逻辑。
4. **`--no-open` 按版本 gate。** 只有 dsh ≥ 0.1.0-rc.7 认识这个参数，旧版收到会直接退出，所以按 `dsh --version` 的结果决定加不加。
5. **dsh 与窗口生命周期解绑。** reload 窗口不中断进行中的 session：dsh 被系统收养（macOS 上是 launchd），身份写共享记录 `~/.dsh/dsh-owned.json`，下个宿主 re-own；只有用户显式 `dshOne.stop` / `dshOne.restart` 才杀。意外退出靠 10s 健康检查发现（不弹窗）。代价是「面板也跟着回来」这件事要自己做：面板注册了 serializer，页面把会话 id 存进 webview state。
6. **对话区 = 官方组件装配，不自研。** 自研聊天区每个 dsh 版本升级都要追协议 + 追 UI 对齐，长期成本压不住；现在的做法是官方前端组件原样下发，我们只提供外框、处理 cookie 与跨源。代价是官方契约漂移会直接打到我们身上（所以有第 8 章那一整套探针与门禁）。
7. **插件不碰宿主，只调宿主能力口。** 插件要的宿主能力（跑 git、落盘、持久状态、开外链、编辑器窗口/终端、宿主面板状态……）统一经 `packages/dsh-plugin-kit/src/hostCapabilities.ts` 这层薄 SDK 调用，两侧各有一份实现：VS Code 侧是扩展宿主的宿主调用通道（`hostCall` 白名单 + 参数校核 + 路径限域），官方 web 侧是宿主半插件（网关 RPC）或页面原生动作（浏览器下载、`window.open`）。这样同一份插件代码两端都能用，能力缺席的那一端「少的就是入口本身」。**插件状态两侧同一个家**：都落 `~/.dsh/dsh-one/<键>.json`，VS Code 侧由扩展宿主代行宿主半的状态存储模块（不是第二份实现），避免同一份数据两个家而漂移。
8. **可移植插件的挂载点取官方语义属性。** 官方 web 里没有我们的 frame，插件若按自有标记取挂载点就会静默不工作，所以统一经 `packages/dsh-plugin-kit/src/mountPoints.ts` 取：对话区容器 = 官方 `[data-conversation-scroll]`（会话流与 composer 都在这棵子树里），composer 槽位 = 官方槽位属性 `[data-slot="conversation.composer.bar"]`；容器异步挂载就等它出现，被换掉就重挂。
9. **可移植的自有插件 = 官方格式的 npm 包。** `@dsh-one/dsh-*` 那几件各自住在 `packages/<名>/`，清单声明 `dsh.bundle.patch` + `dsh.client`，包名 = 装配清单里的插件 id；构建期出一份产物，两端吃同一份字节，装进 profile 就双端生效。只能用在我们 shell 里的件（渲染外框、调 VS Code 宿主、把设置开成编辑器页）保持 `@dsh-one/vscode-*` 并留在 `src/ui/assembly/shell/`，文件名头写明为何不可移植。字段作用与真机实测跑法见 `docs/plugin-packages.md`。
10. **外链由我们的捕获层接管。** VS Code 在 webview 里装的链接拦截挂在页面 window 的冒泡阶段，锚点自己一句 `stopPropagation()` 就能让点击到不了那层（用户看到「点了没反应」，而官方 web 没这层所以只有 VS Code 侧坏）。装配页因此在 `document` 的捕获阶段听 click，命中 http/https/mailto 就交给 `openExternal`，并且既 `preventDefault()` 也 `stopPropagation()`（那层拦截不看 `defaultPrevented`，不拦会被开两次）。只在宿主注入过 `acquireVsCodeApi` 的页面里装，官方 web 与普通浏览器一格不动。
11. **整包 URL 的 `rev` 同时代表两半内容。** 整包 URL 就是 webview 的缓存键（响应头 24h `immutable`），所以它必须同时含官方那半（网关按内容算出的 `rev`）与本地那半（`dist/assembly/plugins` 的内容哈希，宿主每次装配现算）：只带官方那半时，我们重建自己的 bundle 不改 URL，webview 会吃满长缓存，改了界面 reload 也看不到。网关带内容哈希文件名的资产不走这条路（名字里就有版本）。
12. **页面上的插件 roster 有两条来路，两条都过滤。** 一条是启动时那份 `__DSH_BOOT__`，另一条是官方前端自己开的事件流 `/plugins/events`（每帧 `type: "graph"` 带全量 roster）。0.1.6-alpha.2 起客户端会**采纳**后者，不过滤就会把被 block 的官方插件装回来、把自有 frame 插件的条目卸掉，整页白。做法同源：页面把那条流改道到镜像的 `/plugins-local/events`，镜像逐帧跑**同一个** `filterWire`，投影不了就丢帧（退化成老版行为，比放行洗白页面安全）。同一版 dsh 里还有三处同类漂移（会话快照不再下发 `current`、会话服务删掉 `open` / `select` / `clear`、`completed` 挪进 `sessionStatus` 钩子），四处都在我们这边做了单一事实源 + 分代分叉，两代官方产物都能服务。
13. **官方新增插件默认保留，只收敛与 VS Code 容器冲突的呈现。** 官方新版本带来的插件不因为「我们用不上」进 block list；体积与流量问题用缓存（共享 mirror + 内容版本做缓存键）解决，不用裁剪功能解决。block list 只留两类：与 VS Code 容器形态冲突的，以及这棵树声明不了它槽位的。
14. **版本门只提示不阻断。** 区间外的版本给一条信息条照常使用——挡掉用户会让他没法自查是谁的问题，而区间判定太粗（整段区间里已知有漂移），挡也不准。
15. **装配页不留白。** 官方渲染器故意让装配错穿出所有 entry 边界（fail loud），React 随即卸掉整棵 root；官方那套失败卡片只覆盖启动期，留给插件的 `onEntryError` 也收不到装配错。所以这一层由页面运行时出：捕获到错误就记下原文（不吞日志），`#root` 从「有过内容」变成「连续两拍一个可见的盒都没有」就落一行说明加一个重载入口。判据落在用户看到的东西上，页面好着时一个字节不动。
16. **页面自己救一次，用户不必等我们发版。** 官方启动审计报「某条目起不来」（`web boot: N entry did not activate` + 点名 id）时，整页被官方那张失败卡挡住——规则化的 block list 覆盖不了所有漂移（服务级依赖、官方新加的注入项、官方改名），所以汇编页多一手自己的补救：把官方**点名的那一条**从本页清单（`__DSH_BOOT__` 这个官方 seam）里摘掉、把这一页重载**一次**；再失败就落到上一条那行说明（官方那张卡在，提示条由知道发生了什么的那一层显式落下）。三条死规矩：**只试一次**（重载的凭据写在 `sessionStorage`，写不下就不重载——写不下就没有「只用一次」的保证，宁可不救也不许循环）、**只认官方点出来的 id**（不自己猜哪些该摘；摘不干净的情形不浪费那一次）、**必须留痕**（摘了谁、因为什么写进日志，原始审计错误照旧打到控制台——不能悄悄修好，否则验证里那条「零装载未激活」就失去检测能力）。
16. **局域网访问用本机转发器，不改 dsh 的监听。** dsh 只监听 `127.0.0.1` 是上游的安全策略，我们不去绕它，而是在局域网地址上做纯 TCP 透传并让 spawn 带 `--trusted-host`；多窗口共用地址与端口，先到者持有监听。代价是开着的时候局域网内拿到链接的人都能用 dsh，所以默认关闭、状态栏随时可切回。

## 10. 变更记录

按 issue 号从大到小排（这个仓库里约等于时间倒序；每条当时的具体讨论看 issue 本身）。这里只记「结构或依赖面变了」的那些，界面与交互的变化看 CHANGELOG。

- `#228` 装配页启动自愈：官方启动审计点名某条目起不来时，页面自己把它从本页清单里摘掉并重载一次（再失败落到 `#201` 那行说明）。
- `#216` `#215` 标签组：默认色优先取本工作区没用过的颜色；移入回收站的会话不再算活跃成员（组与归属当场清，还原可逆）。
- `#213` `#214` 三个预设标签组改回恒存在、不可删改（名字走 l10n）、空着不占位。
- `#211` 注入目标开不了时，对话面板落到官方新对话页，不再停在官方空态。
- `#205` 启动注入与官方「恢复上次会话」的 watcher 抢同一个选中值：改成盯住目标直到落定，落定前不上报当前会话。
- `#204` chat 树再摘两件官方设置件（它们等待的槽位全在 `sidebar.settings` 之下，本树没声明、本就零渲染）。
- `#202` chat 树摘掉 `ui-settings-general`（理由同上），对话区那枚断线提示改由自有 frame 自己出。
- `#201` 装配页失败提示条：页面运行时兜住整页白，留一行说明加重载入口。
- `#191` 0.1.6-alpha.2 的四处漂移：客户端开始采纳 `/plugins/events` 的全量 roster（事件流改道后逐帧过滤）、会话快照不再下发 `current`、会话服务删掉 `open` / `select` / `clear`、`completed` 挪进 `sessionStatus` 钩子。
- `#188` 装配页去掉自带的 CSP（改为与官方页同处境）；`#185` 为它写的「给隔离沙箱 srcdoc 帧补 nonce」随之下线。
- `#183` 会话被占用那条提示改读官方快照的 `lastAgentError`，不再订阅内部事件名。
- `#180` block list 22 个 id 逐条复核（判据改成「这棵树有没有声明它注册的槽位」），摘掉 `ui-reference` / `ui-skill` 等纯停车项。
- `#178` 依赖面收敛第一批：`bootstrapUrlOf` 按 `phase` 找批而不假定 `batches[0]`；预热请求改带自有 frame 插件 id；不再按官方文案认侧栏折叠钮；设置页改按条目 id 遮蔽官方两项。
- `#176` 添加/创建工作区之后接着在该工作区开新会话（新能力，官方 web 侧缺席是有意的）。
- `#173` 整包 URL 的缓存键补上本地 bundle 的内容哈希。
- `#169` 对话面板跨窗口重载/宿主重启恢复（`registerWebviewPanelSerializer`）；会话多开的标签页是另一条（`#72`）。
- `#165` 修干净 profile 上打不开的两个根因：block list 一致性判据改成集合关系（跨全部 application 批求并集），自有插件已在网关清单里时不叠加本地那份。
- `#164` 侧栏树放回 `ui-commands` / `ui-permission-presets`（官方件按服务名依赖它，缺服务整页抛错）；加 F-55 在自起的全新 `DSH_HOME` 上跑。
- `#150` 外链改由捕获层接管。
- `#147` 侧栏订阅「宿主面板里开着哪些会话」，压掉「跑完还没打开」那颗绿点。
- `#140` 侧栏会话行的等待态（等审批/等提问）按官方等待态钩子显示成黄点。
- `#121` 会话行点击的判据加「这个会话现在是否真开在宿主面板里」。
- `#112` `#109` 当前工作区判定改按 VS Code 打开的文件夹；工作区行的宿主动作（开终端、在新窗口打开文件夹）。
- `#105` `#101` `#100` 安装引导页改版、状态页跟随服务状态、侧栏三态状态页。
- `#99` 侧栏顶栏齿轮与「创建目录」经宿主能力口。
- `#97` 三个外框插件按官方命名方式改名（`@dsh-one/vscode-chat-ui-layout` 等）。
- `#96` `#91` 官方内部标识符探针清单落地；加 F-10 FIBER 与 F-11 WIRE-LIVENESS 两条漂移断言。
- `#94` 插件源码内聚进各自的包，共用件收进私有包 `dsh-plugin-kit`。
- `#84` 宿主能力口（前端 SDK + 宿主半插件），插件不再直接碰宿主。
- `#83` 可移植插件的挂载点从自有 frame 标记迁到官方语义属性，改名 `dsh-*`。
- `#82` 插件状态的家定在 `~/.dsh/dsh-one/`，VS Code 存储只留给 shell 基础设施。
- `#79` 决策 B：chat 树声明并渲染官方 `rightbar`，文件/终端/文档预览三件接进来。
- `#78` 0.1.6 实测漂移的适配（`imageIds` → `attachmentIds`）；树定义从 `assemblyView.ts` 抽成 `trees.ts`。
- `#77` root 不可「加载官方件 + 只遮蔽它的 root slot」：三条实测约束，结论是继续 block 并接手它下发的契约。
- `#76` `#74` 补 root 级 hook `panelInfo` 与 keyed `main` 的声明。
- `#73` 可移植插件改成官方格式的 npm 包（`packages/`）。
- `#71` `#70` 侧栏位与设置页两棵树各就位；瘦身后的 block list 与共享 loopback mirror（跨 tab 命中 HTTP 缓存）。
- `#68` `#65` 自研聊天区下线，装配对话区成为唯一对话区；特有功能开始插件化。
- `#64` `#63` 对话区装配落地：清单过滤 + loopback 代理 + `__DSH_TRANSPORT__`，由 spike 定下并写进代码。
- `#60` 整壳嵌入方案退回。

## 11. 日志与安全细节

### 日志

- **日志**：一律走 `Logger`（`src/log.ts`），写入前 `sanitize()` 把 URL 的 query 值脱敏成 `***`（token 不进日志），同时落一份文件（`src/pure/logFile.ts`，读法见 `docs/development.md`「日志与事后取证」）——窗口重载、宿主重启这类发生在扩展之外的故障事后只能靠这份文件自证。新增日志点走 `Logger`，不要 `console.log`。
### webview CSP

- **宿主层没有 CSP，页面层我们也不加**（`#188`，用户拍板）。宿主那层没有 CSP 是查过的：wrapper 文档 `pre/index.html` 自带一份政策只管它自己；扩展的 HTML 不是 `srcdoc` 帧，而是被 wrapper 用 `contentDocument.write()` 写进另一个内层 iframe，CSP 的继承只发生在 `about:` / `srcdoc` / `blob:` / `data:` 这类 local scheme 上，所以那份政策不继承进来。VS Code 唯一相关行为是发现页面没有 CSP 就给扩展开发期记一条 warning。装配页此前自带一份 CSP，导致同一张第三方插件卡片在装配页与官方页处境不同（帧里的内联事件属性被挡、远端图片与字体被挡）；现在这份政策去掉了，代价是失去脚本注入防护（页面里跑的是官方 bundle + 我们的插件 + 用户 profile 里的第三方插件，与官方页相同）。页面上自己的内联脚本与 `<style>` 仍带着 `nonce` 属性：没有政策可匹配、今天不放行任何东西，留着只是让「把 CSP 加回来」这条退路不必再动这些落点。常驻断言 = `npm run verify:lab` 的 F-59（两侧都没有 CSP meta、六档探针帧的内联脚本全部执行、帧里的内联事件属性真的响应、非本机源的图片请求真的发得出去、本页一个字节都不改插件写下的帧）。
### 两条外部输入的边界

- **loopback 代理是外部请求进入网关的唯一路径**：它负责附上登录 cookie、把 Origin/Referer 改写成网关自己的权威、剥掉浏览器自动加的 `sec-fetch-*`（这几样少一个都会被网关的栅栏当成可疑请求拒成 403）。它只绑 `127.0.0.1` 的随机端口，随最后一个用到它的面板关闭而消失。
- **宿主调用通道是外部输入进入宿主的唯一入口**（`src/ui/assembly/hostBridge.ts`）：调用名走白名单，每个调用自校验参数形状，git 一律 `execFile` 传 argv（不拼 shell），调用方给的 cwd 只允许落在 VS Code 工作区目录、`~/.dsh`、以及网关注册过的 dsh 工作区路径之内（realpath 后判包含关系，越界就回落到 VS Code 工作区目录，绝不放宽），回执只有 `{ code, message }` 且不含命令行原文。

## 文档地图

| 想看什么 | 去哪 |
| --- | --- |
| 从顶到下的四层全景（同一套架构的另一种讲法） | `docs/assembly-architecture.html` |
| 上游依赖面、逐版本测试项、接新版本的门禁 | `docs/dsh-compat-checklist.md` |
| 自有插件包的字段、构建、装进官方 profile 与真机实测 | `docs/plugin-packages.md` |
| 开发流程、脚本、日志取证、人工验收步骤、发版 | `docs/development.md` |
| 浏览器验证的套件清单与判据 | `test/assembly-lab/README.md` |
| 旧自研侧栏与当前侧栏的逐项对照（历史材料） | `docs/legacy-vs-current-sidebar-compare.md` |
| dsh web 的组件与卡片实现（查官方怎么写的：可展开组件、任务卡与 todo 行、workflow 卡） | `docs/dsh-web-expandable-ui-research.md`、`docs/dsh-web-task-card-and-todo-row-research.md`、`docs/dsh-web-workflow-run-card-research.md` |
| host 侧的 todos 数据来源（投影链路，我们目前没接） | `docs/dsh-one-todos-data-source.md` |
| 会话工作区模型（session ↔ branch / worktree，未实现的设计草图） | `docs/session-model.md` |
