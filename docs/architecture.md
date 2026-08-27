# DSH One 架构

本文面向接手开发的人。定位：用户只装这一个插件就能用完整的 DeepSeek Harness（dsh）——VSCode 充当 dsh 的**启动器和显示器**，UI 不重写，直接 iframe 嵌入官方 Web 界面。

行号引用以当前 main 为准（`src/server/manager.ts:44` 这种格式）；代码改动后请同步更新本文。

## 模块结构

```
dsh-one/
├── package.json            # 清单：命令、配置项、侧边栏 view、extensionKind
├── build.mjs               # esbuild 打包脚本，输出单文件 dist/extension.js
├── src/
│   ├── extension.ts        # activate/deactivate 入口，注册命令与 view
│   ├── log.ts              # 输出通道日志，写入前对 URL query 值脱敏
│   ├── runtime/
│   │   ├── node.ts         # Node ≥ 22 运行时解析（系统优先，否则下载 LTS）
│   │   └── dshRuntime.ts   # dsh 运行时解析（npm install 到 globalStorage）与自动更新
│   ├── server/
│   │   └── manager.ts      # dsh web 进程生命周期：探测/复用/spawn/就绪/清理
│   ├── ui/
│   │   ├── webview.ts      # 侧边栏 WebviewView + 编辑器标签页 WebviewPanel，iframe 嵌入
│   │   └── statusbar.ts    # 状态栏指示
│   └── pure/               # 纯逻辑，禁止 import vscode（可用 node --test 直接单测）
│       ├── envelope.ts     # host.describe RPC 信封构造与 rpcId 回显校验
│       ├── readyLine.ts    # 解析 stdout 就绪行 `dsh web: http://127.0.0.1:<port>`
│       ├── registry.ts     # 从 npm packument 选目标版本（channel / pinnedVersion）
│       └── semver.ts       # 最小 semver 实现（支持 prerelease），零依赖
└── test/                   # src/pure 的单测（node:test）
```

各模块职责要点：

- `src/extension.ts`：只做装配。`resolveAll()`（`src/extension.ts:18`）把 Node+dsh 的解析 memoize 成一个共享 Promise，服务启动路径和后台更新检查不会重复下载。`deactivate()`（`src/extension.ts:94`）**必须是同步的**，见下文设计决策 5。
- `src/runtime/node.ts`：`ensureNode()`（`src/runtime/node.ts:133`）先 `findSystemNode()`（:25）跑 `node --version` 要求 major ≥ 22（`MIN_NODE_MAJOR`，:12）；找不到则查 nodejs.org 最新 LTS、下载、按 `SHASUMS256.txt` 校验 SHA256（:93）、解压后在同卷内 `rename` 做原子切换（:187-189）。已下载过的运行时会先复用（:141-159）。
- `src/runtime/dshRuntime.ts`：`ensureDsh()`（`src/runtime/dshRuntime.ts:148`）负责 dsh 版本解析与安装；`checkForUpdates()`（:230）负责后台更新，12 小时节流（`UPDATE_CHECK_INTERVAL_MS`，:16），时间戳存在 `globalState` 的 `dshOne.lastUpdateCheck`。
- `src/server/manager.ts`：`ServerManager`（:70）是整个扩展的核心，持有 `ServerStatus` 并通过 `onDidChangeState` 事件通知 UI。
- `src/ui/webview.ts`：`bind()`（:108）把任一 webview 绑定到 `ServerManager` 状态流；运行中时渲染 iframe（`dshFrame()`，:95），否则渲染启动/错误页。
- `src/pure/`：与 vscode 解耦的业务规则。所有"容易写错的判断"（rpcId 校验、版本选择、semver 比较、就绪行解析）都下沉到这里，保证可以脱离 VSCode 单测。

## 核心流程一：运行时解析（Node → dsh → current 指针 / last-good）

入口是 `extension.ts` 的 `resolveAll()`，两条路径共用：首次启动服务、后台更新检查。

1. **Node 解析**（`ensureNode`，`src/runtime/node.ts:133`）
   - PATH 上有 Node ≥ 22 → 直接用，结束。
   - 否则看 `globalStorage/runtimes/node/` 下有没有已下载的可用运行时（逐个跑 `--version` 验证，:141-159），有就复用。
   - 都没有 → 带进度通知地下载：`latestLtsVersion()` 查 nodejs.org dist index（:50）→ 下载平台对应包（`nodeAssetName()`，:61）→ SHA256 校验（`verifySha256()`，:93）→ 系统 `tar` 解压（Windows 缺 bsdtar 时回退 PowerShell `Expand-Archive`，:115-122）→ 同卷 `rename` 原子切换到 `runtimes/node/<version>/`（:187-189）→ 最后跑一次 `--version` 自检。

2. **dsh 解析**（`ensureDsh`，`src/runtime/dshRuntime.ts:148`）
   - `useSystemDsh: true` → 直接用 PATH 上的 `dsh`（`findSystemDsh()`，:90），结束。
   - 拉取 `https://registry.npmjs.org/@deepseek-ai/dsh` 的 packument（`fetchPackument()`，:83），`pickVersion()`（`src/pure/registry.ts:28`）选目标版本：pinnedVersion 优先（必须在 registry 里存在，否则报错）；`stable` 通道用 `dist-tags.latest`；`rc` 通道取所有版本里最高的（含 prerelease）。
   - 目标版本已装过（`globalStorage/runtimes/dsh/<version>/node_modules/@deepseek-ai/dsh/lib/bin.js` 存在）→ 先 `verifyInstall()`（:57，跑 `node bin.js --version`）自检，通过后更新指针直接用。
   - 没装过或自检失败 → 带进度通知地 `npm install --prefix <globalStorage>/runtimes/dsh/<version> @deepseek-ai/dsh@<version> --no-audit --no-fund`（`installDsh()`，:98）。npm 命令优先用所解析 Node 自带的 npm-cli.js（`resolveNpm()`，:69），系统 Node 则用 PATH 上的 npm。装完同样跑 `--version` 验证；失败会把整个 prefix 目录删掉再抛错（:124、:132）。
   - **指针与回退**：`current.json` 记录当前版本，`last-good.json` 记录上一个版本（`updatePointer()`，:206）。不用 symlink，Windows 友好。安装/验证失败时若存在 last-good 且与目标版本不同，回退到 last-good 再验证一次（:188-201）。

注意 spawn 时不走 `dsh` 可执行文件，而是直接 `node <prefix>/node_modules/@deepseek-ai/dsh/lib/bin.js`（`BIN_JS_REL`，`src/runtime/dshRuntime.ts:14`），原因见设计决策 3。

## 核心流程二：服务启动（探测 → 复用/spawn → 就绪双确认 → webview 加载）

入口 `ServerManager.ensureStarted()`（`src/server/manager.ts:97`），单例语义：并发调用共享同一个 in-flight Promise；实际逻辑在 `start()`（:130）。

1. **探测与复用**（:136-143）：`port > 0` 时先 `probeDsh(port)`（:44）——POST `http://127.0.0.1:<port>/api/host.describe`，信封是 `{type:'client-request', rpcId:<uuid>, method:'host.describe', payload:{}}`（`makeDescribeRequest()`，`src/pure/envelope.ts:14`）；只有回包 JSON 的 `rpcId` 与发出的一致才认定是 dsh（`isDshResponse()`，`src/pure/envelope.ts:22`）。探测通过 → 状态置为 `running` 且 `adopted: true`，**复用的实例永不 kill**。`port = 0` 跳过探测。
2. **spawn**（:145-177）：解析运行时（可能触发上面的下载流程）；构造 env 时删除 `NODE_OPTIONS` 和 `ELECTRON_RUN_AS_NODE`（:150-152）；参数为 `web --host 127.0.0.1 --port <port>`，仅当 dsh 版本 ≥ 0.1.0-rc.7 时追加 `--no-open`（`gte()` 判断，:156）；POSIX 下 `detached: true` 让 dsh 自成进程组（后面整组杀），Windows 下系统 dsh 走 `shell: true`（.cmd shim 不能直接 spawn，:167）。工作目录取第一个 workspace folder，没有则用 home（:146）。
3. **就绪双确认**（`waitReady()`，:215）：
   - 第一层：监听 stdout，解析 `dsh web: http://127.0.0.1:\d+` 就绪行（`parseReadyLine()`，`src/pure/readyLine.ts:15`）拿到**实际端口**（port=0 时尤其重要）。
   - 第二层：对该端口再做一次 `probeDsh()`，rpcId 回显通过才算 ready（`src/server/manager.ts:253`）。防止"端口被无关 HTTP 服务占用、stdout 行却解析到了"的误判。
   - 失败路径：90s 超时（`START_TIMEOUT_MS`，:13）、进程提前退出、spawn 错误，都会带上 `TailBuffer`（:29，保留最后 40 行输出）作为错误详情。
4. **webview 加载**：状态变为 `running` 后，`onDidChangeState` 触发 `bind()` 重渲染，`dshFrame()`（`src/ui/webview.ts:95`）输出 `<iframe src="http://127.0.0.1:<port>/?dsh_embed=vscode">`。侧边栏是懒启动——第一次打开侧边栏才触发 `ensureStarted()`（`src/ui/webview.ts:129`）；`openInTab()`（:133）同理。CSP 只允许 `frame-src http://127.0.0.1:* http://localhost:*`（:47-51）。

进程退出有 `exit` 监听作为后备（`src/server/manager.ts:188-202`）：非主动停止的退出会把状态置为 `error` 并弹"查看日志/重试"。

## 状态与配置

### ServerStatus（`src/server/manager.ts:20`）

| 字段 | 说明 |
| --- | --- |
| `state` | `stopped` / `starting` / `running` / `error` |
| `url` / `port` | 运行中时的服务地址与端口（port=0 时来自就绪行解析） |
| `adopted` | `true` 表示连的是已有实例，任何清理路径都不会 kill 它 |
| `error` | `state === 'error'` 时的错误详情（含 dsh 输出尾部 40 行） |

### 配置项（`package.json` 的 `contributes.configuration`）

| 配置 | 默认 | 消费位置 |
| --- | --- | --- |
| `dshOne.channel` | `"rc"` | `readConfig()`（`src/runtime/dshRuntime.ts:29`）→ `pickVersion()` |
| `dshOne.pinnedVersion` | `""` | 同上；非空时更新检查直接跳过（:238） |
| `dshOne.autoUpdate` | `true` | `checkForUpdates()`（:239） |
| `dshOne.useSystemDsh` | `false` | `ensureDsh()`（:154）、`checkForUpdates()`（:237） |
| `dshOne.port` | `3080` | `ServerManager.start()`（`src/server/manager.ts:133`） |

### 磁盘与全局状态

- `globalStorage/runtimes/node/<version>/`：下载的 Node 运行时。
- `globalStorage/runtimes/dsh/<version>/`：按版本隔离的 dsh 安装（npm prefix）。
- `globalStorage/runtimes/dsh/current.json` / `last-good.json`：版本指针 `{ "version": "x.y.z" }`。
- `globalState['dshOne.lastUpdateCheck']`：上次更新检查时间戳（12h 节流用）。
- 旧版本目录目前没有清理逻辑（见 `docs/roadmap.md`）。

## 设计决策及出处

以下结论来自对 marketplace 上 28 个 dsh 相关插件的逐一源码调研，完整报告在父仓库 `../docs/05-vscode插件调研.md`（不在本仓库内）。

1. **运行时按需下载，不打进 VSIX。** 实测 `npm install @deepseek-ai/dsh` 的依赖树是 455 个包 / 约 280MB / 11 个平台相关原生 .node（node-pty、sharp、koffi 等）。打进 VSIX 又胖又锁平台；在用户机上跑 npm 会自动装对平台的二进制。副作用是天然支持跟踪 dsh 发布节奏——扩展不发版也能上新 dsh。实现：`src/runtime/dshRuntime.ts:98`（`installDsh`）。
2. **先探后起 + 复用语义。** 两个 dsh 实例共享 `~/.dsh` 并发写会永久损坏会话日志（seq gap，Skylake0216 插件已有实际故障案例）。所以启动前必须先探测，已有实例就复用且绝不 kill。实现：`src/server/manager.ts:136-143`、`:261`（`killOwned` 注释）。
3. **spawn 直跑 `node bin.js`。** 绕开 Windows `.cmd` shim 的 EINVAL / 杀不干净问题；env 里删掉扩展宿主注入的 `NODE_OPTIONS` / `ELECTRON_RUN_AS_NODE`（会让普通 node 子进程异常）。实现：`src/runtime/dshRuntime.ts:14`、`src/server/manager.ts:150-167`。
4. **`--no-open` 按版本 gate。** 只有 dsh ≥ 0.1.0-rc.7 认识该参数，旧版收到会直接退出（Xizhi1024 插件已出现过这个 critical bug）。实现：`src/server/manager.ts:11-12`、`:156`。
5. **`deactivate` 同步清理。** VSCode 退出时不会等待 async 清理，所以 `deactivate()` 里只能同步发 SIGTERM，再 spawn 一个 detached reaper（`sh -c 'sleep 3 && kill -KILL -<pgid>'`）3 秒后强制终止作为后备，即使扩展宿主已退出也能执行。Windows 用 `taskkill /T /F` 杀整棵进程树（单个 kill 覆盖不到 dsh 的工具子进程）。实现：`src/extension.ts:94`、`src/server/manager.ts:303`（`killSync`）。
6. **就绪双确认。** stdout 就绪行给实际端口，再补一次 RPC 身份确认，防端口被无关 HTTP 服务占用造成误判。实现：`src/server/manager.ts:215`（`waitReady`）。
7. **iframe 嵌入官方 UI，不重写。** 调研的 28 个竞品里，重写派每家都在追官方协议叫苦；iframe 嵌入零 UI 同步成本。URL 带 `dsh_embed=vscode` 让 dsh 隐藏自身侧栏。实现：`src/ui/webview.ts:96`。
8. **零运行时依赖。** 只用 Node 22 内置模块 + vscode API，esbuild 打单文件 bundle。依据：`package.json` 无 `dependencies`，只有 devDependencies；`build.mjs` 单入口打包。

## 日志与安全细节

- 所有日志走 `Logger`（`src/log.ts:18`），写入前 `sanitize()` 会把 URL 的 query 值脱敏成 `***`（`src/log.ts:9`），避免 token 类参数进日志。新增日志点请走 `Logger`，不要 `console.log`。
- webview CSP 收紧：`default-src 'none'`，frame 只允许 127.0.0.1/localhost，script 必须带 nonce（`src/ui/webview.ts:46-51`）。
