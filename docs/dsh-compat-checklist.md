# dsh 上游版本兼容性测试清单

本文对应 dsh-one 2.0.0（2026-09-20）。文中标注日期的段落是当时的现场记录；探针项数与
新增项的实测读数以本机装的 dsh 0.1.6-alpha.2 为基线。

dsh-one 是 dsh 的客户端（gateway HTTP/WS RPC + webview 嵌入），上游每个 release 都可能动 wire 协议与前端插件契约。本清单是对上游新版本的完整测试项，分两层：

- **自动化探针**（`.github/workflows/dsh-upstream-watch.yml` 每日 04:00 UTC+8 跑 `scripts/dsh-upstream-watch/probe.mjs`，覆盖 wire 面、网关前端产物、客户端契约面与本机官方产物面，结果见 `upstream-watch` label 的 issue 与 README 徽章）。安装途径：版本已上 npm 走 `npm install`（快）；**GitHub-only 版本走源码构建**（codeload 源码包 → `pnpm install --frozen-lockfile` → `pnpm run build` → `node --import tsx/esm apps/cli/src/bin.ts`，上游 README 的 Run from source 路径），保证发 npm 前就能提前测。
- **人工/补充项**（探针覆盖不到的模型行为与端到端，由认领该版本测试 issue 的人执行）

## 支持的 dsh 版本

装配界面只对**实测过**的版本作承诺。三种状态分开写，不许混：

| dsh 版本 | 状态 | 整轮 `npm run verify:lab` 读数 |
|---|---|---|
| `0.1.6-alpha.1` | **实测通过** | 69 项全过、3620 条断言全过、零红（2026-09-22 记录）。它也是**版本门的下界** |
| `0.1.6-alpha.2` | 实测通过 | 67 项里 65 项绿、3580 / 3583 条断言；剩下两条是 chat 树的启动 / settle 读数，另立 #226（2026-09-22，本机装的那一版） |
| `0.1.7-alpha.2` | **实测不通** | 69 项里 11 过 / 58 红（2026-09-23 实测）。58 项红只有一条根因：官方改图标名，自有插件的侧栏槽位整片崩（见下一节，另立 #236）；11 项「过」里还要扣掉 1 项空过（F-39 这一轮 0 条断言） |
| `0.1.5-rc.2` | **实测不通** | 69 项里 67 过 / 2 红（F-54 44/47、F-67 7/23，2026-09-23 实测） |
| `0.1.2-rc.1` | **实测不通** | 69 项里 52 过 / 17 红（2026-09-22 实测，三类根因见 #234） |
| 其余版本 | **未验过** | 含 npm `next` 指的 `0.1.5-rc.3`，以及 `0.2.0` 及以上 |

**装哪一版**：今天**没有任何 npm dist-tag 指向实测可用的版本**（2026-09-23 实测：`latest` = 0.1.5-rc.2、`next` = 0.1.5-rc.3，两个都低于下界；`alpha` = 0.1.7-alpha.2，落在区间内但实测不通），所以只能按确切版本装：`npm install -g @deepseek-ai/dsh@0.1.6-alpha.1`——它整轮零红。这句话与界面上的信息条同源，都取 `src/pure/versionGate.ts` 的 `VERIFIED_INSTALL_VERSION`。

**版本门**：装配页期望 dsh `[0.1.6-alpha.1, 0.2.0)`，下界就是上表里实测通过的最老版本。这道门**不阻断**：区间外的版本在面板顶部出一条信息条，条上连安装命令一起给（原来只说「期望区间」，用户不知道该装哪一版，是 #234 要解决的半个问题）。

有一处已知不严：它是**整段判断**，表达不了「落在区间内但实测坏」的版本——`0.1.7-alpha.2` 就是这种（区间内，整片红）。要不要再加一份「已知不可用」的名单，留给 #234 后续条目定；在那之前只能靠上表与 README 的版本表说清，所以两条声明里都必须把 0.1.7-alpha.2 单列出来。

### 会话置顶这份状态住哪：0.1.7 起在官方注册表（我们跟着合流）

官方 0.1.7-alpha.1 给侧栏加了会话置顶，状态存在**官方工作区注册表**里：读是工作区快照的
`pinnedSessionIds`（全局一份，与 `archivedSessionIds` 同一份快照），写是
`uiWorkspace.pinSession(sessionId)` / `unpinSession(sessionId)`。0.1.6 及以下这两样都没有。

我们在 `sidebar.workspaces` 槽位上遮蔽官方侧栏，官方那套置顶 UI 在 dsh-one 的树里不渲染——
状态不合流就是**同一件事两份互不相干的集合**（用户在官方 web 里置顶的，在 dsh-one 的树里
不算置顶，反过来也一样），而同一件事的归档我们早就走官方状态。#240 起：

- **0.1.7 及以上**：我们的树读官方那份集合（置顶标记与「置顶排最前」都按它）、写走官方
  `pinSession` / `unpinSession`；
- **0.1.6 及以下**：仍读写自有 `pinned` 键（`~/.dsh/dsh-one/pinned.json`），行为一个字节不变；
- 分叉判据是「这一页的官方产物里有没有那一格 / 那两个方法」，**不猜版本号**（自定义 profile
  换过插件时版本号答不准）；判定、字段名与写入差量在 `src/pure/sessionPinSource.ts`；
- 旧键里已有的置顶在 0.1.7 上**一次性补写**进官方（补写成功的那些从键里划掉，失败的留着
  下次开页再试——旧键补空之后这一步再来什么都不做，所以它既一次性又幂等）。

读数（F-70，同一台实例上同时开自有树页与官方浏览区页，两个方向都读**页面上渲染出来的
东西**）：补写之后官方那一页也显示它置顶；在自有树上置顶一条会话，官方那一页上它同样排到
组内第一；在官方那一页上取消置顶，自有树重载后它不再置顶。0.1.6-alpha.2 上同一套件走的是
旧代分支（自有键原样保留、置顶照旧），整轮零回归。

### 0.1.7-alpha.2 实测不通：官方改图标名，自有插件整片崩

`@deepseek-ai/dsh-client-ui-primitives` 的图标导出在 0.1.7-alpha.2 整批换了一代写法：0.1.6-alpha.2 是尺寸后缀（`IconCloseFill14`、`IconArchiveOutline20`），0.1.7-alpha.2 是字重后缀（`IconCloseFillMedium` / `IconCloseFillRegular`），两代**互不重叠**。模块加载器按名字取导出，取不到不报错、只是 `undefined`，于是渲染时才炸：`slot entry crashed in 'sidebar.workspaces': Error: Minified React error #130`。

我们取用的 34 个名字里 26 个是这代消失的图标，剩下 8 个（`Button` / `HoverCard` / `Menu` / `Modal` / `StateDot` / `Tooltip` / `relativeTime` / `writeClipboard`）两代都在。适配工作另立 #236；在那之前 0.1.7-alpha.2 不算支持版本。

**整轮读数（2026-09-23，候选版本装到临时目录、独占跑）**：69 项 **11 过 / 58 红**；断言按各套件实际跑到的条数合计 **409 / 592**（大量套件在头一两条上就中止，所以条数远少于全绿那一版的 3620——**这两个条数不可直接比**）。红项按根因只有一类，另有一项是空过：

- **自有插件的槽位崩（58 项红的全部根因）**：`slot entry crashed in 'sidebar.workspaces': Error: Minified React error #130`（同一条还出现在 `sidebar.footer.action` 与对话区的 `conversation.session.header.utilities`）。F-01 CONTRACT 39/43 的读数把范围划得很清：**同一张对照页 `sidebar-official`（装同一批官方件、不装我们的工作区树）ready=true、会话行 5、零崩溃**，chat 与 settings 两棵树也 ready=true；坏的只有装了自有条目的那两个槽位。所以这不是底座缺契约，是我们的插件包自己带不动。红的深度分两档：约 30 个侧栏套件在头一条断言上就中止（0~1 条），另有若干套件只差一两条——F-54 38/40、F-55 25/27、F-67 21/23、F-57 8/9、F-01 39/43、F-02 10/13、F-04 20/22、F-06 7/11、F-09 6/13，它们剩下的红都与「自有树渲染不出来」有关。
- **真绿的 10 项**：F-05 宿主能力口 7/7、F-10 fiber 级契约 20/20、F-11 block list 存活性 20/20、F-48 外链兜底 45/45、F-59 HTML 预览卡 28/28、F-60 git 卡片工作目录 14/14、F-61 断线提示 17/17、F-63 装配失败提示条 13/13、F-68 重试限流与日志限频 14/14、R-06 零越界与零原生副作用 6/6。这十项覆盖 wire 面、契约面、宿主通道、组合包过滤与页面兜底——**底座那半边在这一版是好的**。
- **空过 1 项**：**F-39 报了 pass，但它这一轮 0 条断言**（网关上没有「带会话、且会话带 cwd」的工作区当夹具，套件跳过）。它不是「这一项在 0.1.7 上通过」的证据，只是没跑。
- **环境**：无。整轮独占跑（机器上没有别的实验室轮次）。

同一版还有一处漂移，已在本次修掉（不必等 #236）：`__DSH_BOOT__.batches[].url` 从 `/plugins/??…` 变成 `plugins/??…`（**相对地址，不带前导斜杠**）。`src/server/assemblyMirror.ts` 原来字符串拼 `gateway + url`，拼出 `http://127.0.0.1:61091plugins/??…` 这种解析不了的地址、整页的整包全废；改成 `new URL(url, gateway)` 解析，带前导斜杠的写法结果不变。改前这一条把整轮**堵在门口**（连 F-01 都跑不出来），改后才拿得到上面这份读数。

### 0.1.5-rc.2 实测不通：启动自愈不生效、composer 的 ＋ 不在场

67 项过、2 红，两条红各自成一类：

- **F-54 交互活性（44/47）**：红的三条全在 composer 的 ＋ 上（`present=false`）。官方那一代没有 `pickFiles`，这个控件根本不在场，套件里「＋ 点不动时页面必须留一行能指名道姓的失败」「把不合契约的贡献摘掉之后 ＋ 必须恢复」这两条的前提就不成立。属 #234 的 (B) 类（判据钉的是 0.1.6 才有的形状），叠着一个真实能力缺口（那一代没有 ＋）。
- **F-67 启动自愈（7/23）**：页面加载次数停在 1、没摘条目、也没落失败提示条——自愈整族在这版没生效，与 #234 在 0.1.2-rc.1 上看到的**同一签名**。这一条因此不再是 rc1 独有：它是这一代（0.1.5 及更早）的共同表现，具体成因仍属 #234 的 (C) 未定性项，本次没查。

## 自动化探针项（probe.mjs，23 项）

探针分三类：**伺服面**（wire——网关对外的 HTTP/WS 接口。含装配形态直引的那两样网关前端产物：`/` 的 HTML 与 `/plugins/??` 的 combo——上游改了交互方式或改了产物写法，都在这一面现形）、**客户端契约面**（combo——装配线直引官方前端插件代码，官方的 slot 名、hook 名、字段名就是我们的 ABI）与**官方产物面**（本机已安装的官方包文件——静默失效型依赖：坏了不报错、只是不生效；含每棵树 block list 的补全检查）。三类都由 `.github/workflows/dsh-upstream-watch.yml` 每日 04:00 UTC+8 跑。

两者的分工：探针只查「名字还在不在」，不查「装起来崩不崩」——后者归 `npm run verify:lab`：F-01 CONTRACT 套件（四棵树零崩溃、零缺失契约），外加 #91 加的两条漂移断言 **F-10 FIBER**（四棵树零 cordis scope 进 FAILED——fiber 失败不进控制台，只能运行期看）与 **F-11 WIRE-LIVENESS**（三棵树 block list 的每个 id 都要在当天 wire 里找得到——官方改名会让过滤静默失效）。

### 伺服面（17 项）

| id | 检查内容 | dsh-one 依赖点 |
|---|---|---|
| version-parse | `dsh --version` 输出可解析出 semver | `src/server/locateDsh.ts`、`--no-open` 版本 gate |
| ready-line | `dsh web` 就绪行 `dsh web: <url>?token=` | `src/pure/readyLine.ts` |
| auth-401-fingerprint | 无凭证 POST /api/* → 401 + 正文 `unauthorized` | `src/server/portProbe.ts`（authDsh 指纹） |
| token-exchange-cookie | `GET /?token=` → 303 + `dsh-auth-*` cookie | `src/server/serverAuth.ts` |
| rpc-session-list | `session/list`：信封、rpcId 回显、`{items}` 行形状 | `src/server/dshRpc.ts` listSessions |
| rpc-model-catalog | `session/modelCatalog`：`groups/default` 目录 | `src/server/dshRpc.ts`（`session.models` 到 `session/modelCatalog` 的方法映射与共享缓存） |
| rpc-agent-presets | `agentPresets/list`：预设数组 | `src/pure/agentPreset.ts` |
| rpc-workspace-ops | `workspace/create` + `workspace/delete` | `src/server/dshRpc.ts` ensureWorkspace |
| rpc-session-create | `session/create` → `{sessionId}` | 同上 createSession |
| rpc-commands-list | `commands/list` 名册 | 同上 listCommands |
| commands-execute-args | `commands/execute` 接受 dsh-one 现发的 args 形状。**形状不在探针里写死**：探针 import dsh-one 源码的同一份单一事实源 `src/pure/dshWire.ts` 的 `commandsExecuteArgs(version, …)`，按 `--expect-version` 分叉（0.1.2 及以前 `images`、0.1.3 起 `submittedAttachments`），用真实形状发一次（#37） | `src/pure/dshWire.ts`（`commandsExecuteArgs`）、`src/server/dshRpc.ts` executeCommand |
| ws-mux-connect | WS `/api/remote.mux` 带 cookie 建连 | `src/server/remoteMux.ts` |
| ws-session-follow | `session/follow` snapshot 帧（cursor/records/hasMore/projections；detail 记录 header 键与 version、是否有 chunkRows——0.1.3 起 header 与 records 形状变化在这里现形） | `src/pure/remoteFrames.ts`（snapshot 帧形状）、`src/pure/assistantStream.ts`（0.1.3 的 `assistantStream` 侧信道） |
| ws-session-control | `session/control` baseline 帧 | `src/server/modernStreams.ts` |
| boot-html-contract | 带 cookie GET 网关 `/`：HTML 含 `__ModuleLoader__`、`__DSH_BOOT__`、`const preference`，且 `__DSH_BOOT__` 能解析出 entries ≥ 40（实测 0.1.6-alpha.1 = 56、0.1.2-rc.1 = 46） | `src/ui/assembly/pageHtml.ts`（`__ModuleLoader__` 门面 + 主题预置脚本 + 内联 `__DSH_BOOT__`）、`src/server/assemblyMirror.ts`（原样反代 `/`） |
| combo-endpoint | 从 `__DSH_BOOT__` 取 **application 批**的 combo URL（`/plugins/??…&rev=`）请求：HTTP 200 且 body > 10 KB（实测 0.1.6-alpha.1 = 20.4 KB、0.1.2-rc.1 = 18.2 KB；0.1.6-alpha.2 + 一个第三方插件时 4830 KB——取哪一批不按「第几个」定，见 `probe.mjs` 里那条注释） | `src/server/assemblyMirror.ts`（拉网关原 combo 后按插件段过滤）、`src/ui/assembly/wireFilter.ts` |
| origin-fence | 带 cookie POST `session/list` 两次：`Origin: http://127.0.0.1:1` → 403、`Origin` = 网关权威 → 200 | `src/server/assemblyMirror.ts` 的 `proxyHeaders`（Origin/Referer 改写为网关权威） |

后三项是装配形态的上游伺服面检查（#67 的 N1–N3）。它们与最初的依赖总表设计有一处出入：**N3 判据里的方法用 `session/list`，不用原写的 `host.describe`**——实测两个已支持版本（0.1.2-rc.1 / 0.1.6-alpha.1）的认证网关对 `/api/host.describe` 的任何 payload 都回 404 `not found`（栅栏判定先于路由，403 那一半拿它照样成立，但「权威 Origin → 200」判不出来）。`host.describe` 现在只剩「无凭证 → 401 指纹」那一条用途（见上表 `auth-401-fingerprint`）。那份依赖总表（`docs/upstream-dependency-audit.html`）只在 `agent/official-chat-embed` 分支上，main 里没有，`scripts/dsh-upstream-watch/probe.mjs` 的注释还按旧路径引用它。

### 客户端契约面（4 项，`scripts/dsh-upstream-watch/clientContract.mjs`）

做法：带 cookie 取网关 `/` 的 `__DSH_BOOT__`，拉 application 批的那个 combo（官方发给浏览器的原样产物，不经我们的过滤），按三类官方语义取名字后逐个查在场：slot 名（契约目录条目 + 注册/声明/注入/渲染/订阅调用点）、root 级 hook（`ctx.slots.provideRoot({hooks:{…}})` 的顶层键 + 框架映射出的槽位 props）、我们取用过的字段/方法名（按插件段限定作用域）。

| id | 检查内容 | 判定方式 |
|---|---|---|
| client-combo-index | 取法前提：combo 的插件段边界可切、官方 slot 契约目录可取 | 段数 ≥ 40 且每段 id 可读、契约目录 ≥ 30 条；不成立说明官方改了 combo 结构，按该文件注释核对取法 |
| client-slots | 14 组关键 slot 名在场（遮蔽目标 `sidebar.workspaces`、会话面板座 keyed `main`/single `conversation`、右列座 `rightbar`/`details`、`sidebar`、`shell.overlay`、`settings.section/header/action`、各注入点…） | 每个名字要么在契约目录里、要么有注册/注入/渲染调用点；同名换代（如 `details`→`rightbar`）算同一组，任一代在场即通过 |
| client-root-hooks | 4 条 root 级 hook 在场：`panelInfo`、`sessions`、会话等待态（`sessionStatus` / `sessionPendingInteraction` 两代）、`workspaces`，外加框架映射出的槽位 props `use<Name>` | 每条要求「provideRoot 里有这个键」且「`use<Name>` 这个 props 名在 combo 里」——#76 的 `usePanelInfo is not a function` 就落在这一条上；换过名的依赖（等待态）两组命名任一代在场即通过，名字表从产品侧 `src/pure/sessionPendingSource.ts` import，不手写 |
| client-identifiers | 我们取用过的 17 组字段/方法名在场（composer 附件字段与动作两代名、`setDraft`、`draftRev`、`insertReference`、`activePanelId`、`entryKey`、工作区的 `archivedSessionIds` / `pinnedSessionIds` / `pinSession` / `unpinSession`（会话置顶，0.1.7-alpha.1 起；#240）/ `sessionIds` / `workspaceId` 与 `startSession`（注入目标开不了时落到新对话页的入口，#211）、会话快照 `byId`、等待态取值名 `pendingInteraction` / `pendingInteractions`…） | 每个名字要在它该来的插件段里出现（例如附件字段只认 ui-conversation）——#78 抓到的 `imageIds`→`attachmentIds` 就是这一类 |

失败信息的形式：`dsh <当前版本> 缺 N 组：<名字>（期望出处 <官方源码路径>；我方使用点 src/…）`，照它去查官方 release notes 或改我们的取用路径。

清单不是凭记忆写的：每条都写明理由（`why`）与我方使用点（`where`），并由 `test/upstreamClientContract.test.ts` 保证「清单里的名字在 `src/` 里确实还有取用点、`where` 指向的文件确实存在」。**新增依赖 = 在 clientContract.mjs 的三张表里加一行**（名字、理由、使用点、期望的官方出处）；不再依赖就把该行删掉，否则测试会提醒。

### 官方产物面（2 项，`scripts/dsh-upstream-watch/officialIdentifiers.mjs` + `blockListDrift.mjs`）

做法：读**本机已安装的官方包文件**（只读磁盘，不起网关、不走网络），按存在性逐个查标识符还在不在——查的是「装到本机的这版官方包内容变了没有」，与上面 combo 面（查网关下发的产物写法）互补。官方包目录按可信度找三处：① 被测实例自己的 profile（`<DSH_HOME>/profiles/node_modules`，网关实际加载的那一份——**不是每种安装方式都会建它**，实测 npm `--prefix` 装的 dsh 只建 `profiles/web`）；② 被测 dsh **自己安装树**里的官方包（从 `--command` 的可执行文件与 `--cwd` 往上逐级找 `node_modules/@deepseek-ai`，全局装 / `--prefix` 装 / 源码构建三种形态都落在这里）；③ 本机默认 `~/.dsh` 的 profile（#179 点名的那个路径，**可能不是本次被测版本**）。结果行的 detail 会写明读的是哪一份；三处都没有时报红并列出找过的地方（取不到就不能显示成「没问题」）。已安装包里的条目是符号链接，读之前按真身解析。

| id | 检查内容 | 判定方式 |
|---|---|---|
| official-identifiers | 11 条官方内部标识符在场（下表），任一条消失即 fail | 逐条在它的**出处文件**里按**形状**查存在性（不比对内容）；不成立时报出条目名、出处文件与我方使用点 |
| block-list-drift | 三棵树的 block list 覆盖官方**服务依赖**闭包（#227，`blockListDrift.mjs` + `src/pure/blockListDerivation.ts`） | 离线读本机官方包：每件的服务面 = bundle 导出的 `inject`（它等哪些服务）＋提供服务的调用点（`super(ctx, "X")` / `ctx.reflect.provide("X", …)`）。按规则「一棵树挡掉的包，凡是等它的 entry 也一起挡掉」补全，与 `wireFilter.ts` 的清单对比：**少挡一条即 fail**（点出它、它等的服务、被挡的提供方）；规则算不出来的手写条目（形态/角色理由）只报读数——多挡无害，少挡才让整页 boot 失败。取不到就红：一个官方包都没读到、某件 bundle 解析不出 `inject` 导出、或有插件在等的服务在官方包里找不到提供方（框架/主机层那一族 `loader` / `modules` / `remote.*` 除外）。 |

这条的**判据是服务**，不是 `package.json` 的 `dsh.client.inject`：后者是**模块 id** 表（wire 里每个 entry 的 `inject` 就是它），只决定装载顺序——按它做闭包会把三棵树里真正要用的官方件一起挡掉（实测 chat 2 → 38、sidebar 13 → 39、settings 14 → 38 条，把对话区与官方侧栏壳都算进去了），而依赖方并不会因为对方被挡而不激活（对话区那棵树挡了 `ui-layout`、`ui-conversation` 的模块表里就列着它，对话区照样全绿）。真正决定启动审计的是 bundle 里的**服务名**表：缺一个服务，cordis 就停在 `pending (waiting for service: X)`——#225 那起事故（侧栏树挡了 `ui-conversation` 却没挡等它的 `ui-plan`）正是这一类。

**本机实测读数（0.1.6-alpha.2，58 件官方前端包）**：三棵树逐棵 少挡 0 条——对话区 手写 2 / 补全后 2（规则算不出 2：`ui-layout`、`ui-sidebar`，都是形态类）、侧栏位 13 / 13（规则算不出 7）、设置页 14 / 14（规则算不出 14；这棵树下线 ui-conversation 之外的那几件全是形态理由，服务规则本来就不解释它们）。**负向对照**：把 `@deepseek-ai/dsh-client-ui-plan` 从侧栏清单里删掉（= #225 事故前的样子）→ 当场 fail，文案是「侧栏位 少挡了 1 条：`@deepseek-ai/dsh-client-ui-plan`（等 `uiConversation`；提供方全被挡：`@deepseek-ai/dsh-client-ui-conversation`）」；加回去立刻 pass。纯函数单测见 `test/blockListDerivation.test.ts`（现场、多层依赖、同名服务有别的提供方时不误伤、只补不删、框架服务不传播、两处取法自检），探针模块单测与合成产物的负向对照见 `test/blockListDrift.test.ts`。

这 11 条按 **#96 审计 comment 第七节**的核实结果列（基线 dsh 0.1.6-alpha.1，逐条在本机 `~/.dsh/profiles/node_modules/@deepseek-ai` 上只读核对过），每条的出处文件如下：

| 条目 | 出处文件 |
|---|---|
| `root-children.sidebar` / `main` / `rightbar` / `shell.overlay`（root 子槽声明表的四个座，含 kind 与 scope） | `@deepseek-ai/dsh-client-ui-layout/lib/client.js` |
| `sidebar-toggle.zh`（「收起侧边栏」）/ `sidebar-toggle.en`（「Collapse sidebar」），词典键 `toggle.collapse` | `@deepseek-ai/dsh-client-ui-sidebar/lib/client.js` |
| `entry-id.session-log-download`（list 槽位条目 id） | `@deepseek-ai/dsh-session-log-export/lib/client.js` |
| `entry-id.appearance`（`settings.general.item` 的条目 id） | `@deepseek-ai/dsh-client-ui-theme/lib/client.js` |
| `entry-id.open-document`（`settings.action` 的条目 id） | `@deepseek-ai/dsh-client-ui-settings-general/lib/client.js` |
| `entry-id.cordis-panel`（`sidebar.footer.action` 的条目 id） | `@deepseek-ai/dsh-client-ui-cordis/lib/client.js` |
| `snapshot-field.lastAgentError`（会话快照的失败字段，「会话被另一个 dsh 占着」那条提示的判据，#183 起不再订阅内部事件名 `api-session/error`） | `@deepseek-ai/dsh-api-session-controller/lib/client.js` |

为什么单列这一族：它们坏了都**不报错、只是不生效**（提示不弹、官方件悄悄冒回界面、遮蔽目标对不上），日常使用看不出来，探针是发布前唯一能发现它们的手段。新增一条 = 在 `officialIdentifiers.mjs` 的 `IDENTIFIERS` 里加一行（出处文件 + 形状 + 我方使用点）；理由（`why`）与使用点（`where`）写在表里供人读，并由 `test/upstreamOfficialIdentifiers.test.ts` 保证「`where` 指向的文件确实存在」与「删掉一条就报红」。

探针环境：ubuntu-latest + Node 24，临时 `DSH_HOME` 隔离数据目录，只读/无副作用。

## 装配面：探针查不出的那一类

探针读的是**字节**——名字在不在、形状像不像。它不跑页面，所以「整棵装配起不来」这一类它
一条都看不见：0.1.6-alpha.2 上客户端契约面的名字一个没少（那几条探针是绿的），可装配页整棵
渲染不出来（`renderSlot('root') before any 'root' registration`，四棵树皆然），用户升级即撞
白页。

所以「接一个新版本」这一步有一条**必跑**的门禁——把候选版本装到临时目录，用它跑实验室：

```bash
npm run verify:lab-version 0.1.6-alpha.2                  # 缺省跑 F-01 CONTRACT
npm run verify:lab-version next --suite F-01,F-10,F-11    # 也可以点套件
npm run verify:lab-version 0.1.2-rc.1 --suite all         # all = 整轮（全部套件）
```

脚本（`scripts/verify-lab-version.mjs`）做三件事，**不动本机已装的 dsh**：

1. 把候选装到临时目录，并**按确切版本钉住整棵上游依赖树**（#231）：先
   `npm install --package-lock-only` 解析一次（只取元数据、不下载），从锁文件里拿到整棵树
   的上游包名与解析出来的确切版本，再把它们写进 `overrides` 真装——**同族包**
   （`@deepseek-ai/dsh-*`）钉候选那一版，**同期上游包**（`@deepseek-ai/cordis*` 这些）钉
   **候选发布窗口内**最新的一版（候选发布时刻 + 一小时）。不钉的话会被 npm 混装：`dsh`
   自己的依赖写的是 `^0.1.6-alpha.1` 这种范围，alpha.2 一发版，子包就被装成 alpha.2 而
   `dsh` 还是 alpha.1，那种树上 `dsh web` 起不来（`SyntaxError: … '@deepseek-ai/dsh-app-boot'
   does not provide an export named 'watchUserPatches'`），套件却照跑照出读数——那读数既
   不代表候选版也不代表现网。同一件事在 0.1.2-rc.1 上还有第二半：`@deepseek-ai/cordis-plugin-hmr`
   的范围是 `^1.0.17`，不钉就会顺到比候选晚 19 天发布的那一版，`dsh web` 一启动就报
   `user patch-layer watching requires the Cordis HMR service` 并退出——连整轮都跑不了。
2. 装完读一遍树里的版本清单逐条对账：同族包必须同版本、同期上游包必须是期望那一版、树里
   还要没有没钉到的上游包；任何一条不成立就打印是哪几个包、什么版本、期望哪一版，然后
   **报错停下、不跑套件**（宁可红，不要假绿）。
3. 把那个目录的 `.bin` 放到 `PATH` 前面跑 `npm run verify:lab`（实验室按默认跑法起自己的
   隔离实例：独立 `DSH_HOME`、随机端口、跑完按 PID 收）。退出码就是实验室的：0 = 四棵树
   零崩溃、零装载未激活、预期槽位有内容。

另外两个口子：`--from <目录>` 跳过安装、直接核一份已有的装的树（负向对照用：喂一棵混装的
树进去，它必须在第 2 步停下）；`--check-only` 只核版本、不跑套件。网关起不来时那份完整输出
会留在 `<系统临时目录>/dsh-lab-gateway-<端口>.log`，报错里给出路径（#231：原来只留 8 KB
尾巴，真正的异常常被前面那串启动日志挤出窗口）。

### 这样抓到的（0.1.6-alpha.2，2026-09-18）

| 现象 | 官方改了什么 | 我们的落点 |
|---|---|---|
| 整页白：`renderSlot('root') before any 'root' registration` | 客户端的条目协调器（`dsh-client-modules` 的 `ClientEntries`）开始**采纳**官方 `/plugins/events` 事件流推来的 `graph` 帧（0.1.6-alpha.1 的客户端半对它是「收到就丢」）。那一帧带的是**未过滤的全量 roster**，采纳之后我们 block 掉的官方插件被装回来、自有 frame 插件的条目被卸掉，root 槽的注册随之撤销 | 事件流也由镜像过滤：`pageHtml` 把页面的 `/plugins/events` 改道到镜像的 `/plugins-local/events`，镜像逐帧跑该树的 `filterWire`（与页面 boot 那份**同一个函数**） |
| 侧栏树只有工作区、没有会话行 | 会话列表快照不再下发 `current` 字段，官方各处改成自己从行上的 `retainedBy.mainView` 推（`dsh-client-ui-workspace` / `dsh-client-ui-layout` 各一份同形写法） | `pure/workspaceTreeView.ts` 的 `withCurrentSession`（两代字段的单一分叉点；侧栏树、选择桥、对话面板启动注入三处都走它） |
| 侧栏会话行不再有「跑完还没打开」的绿点（F-43 / F-46 红） | 会话列表的**行**上不再有 `completed`，官方把它挪进同一条 `sessionStatus` 钩子的 `completionUnread` 那一格（官方 ui-session 维护：跑起来就清、成为主对话区当前会话也清） | `pure/sessionPendingSource.ts` 的 `completedIds` 投影 + `pure/workspaceTreeView.ts` 的 `withCompletedIds`；合并排在 `withoutPanelOpenCompleted` 之前（宿主面板里开着的那条仍由那条通道压掉），老代给 `null`、行里自带的那一格一个字节不动 |
| 侧栏页出现官方启动审计失败，页面被那张失败卡挡住（#225，2026-09-22 在**本机装的** alpha.2 上撞到） | 官方 `dsh-client-ui-plan` 的导出 `inject` 表里多出 `uiConversation`（alpha.1 没有这个名字），于是它开始等一个侧栏树拿不到的服务 | 侧栏树也下线它（`src/ui/assembly/wireFilter.ts`：从 `FLOW_SETTINGS_TREE` 挪进 `FLOW_BOTH_TREES`，与 workflow-run / deliverables / trajectory / goal 同一条服务级硬约束）。页面侧那一轮的读数：改前 F-01 35/43（红的 8 条全在侧栏两棵树）、改后 43/43；把下线项去掉立刻回到 35/43。**这一类现在另有一条离线判据**（#227，`block-list-drift`）：按官方包的服务依赖算出每棵树的清单，少挡一条就报红——上游再这么改时，探针在发版当天就红，不必等页面撞上 |
| 点会话行没反应（页面上 `sessions.open is not a function`） | 会话服务把「选中」交还给会话视图的所有者：`ctx.sessions` 只剩 retain / using / binding 这些引用管理口，`open` / `select` / `clear` 三个方法被删（类型注释 "view selection remains outside the Controller"） | 改走官方那条**两代都在**的入口 `uiWorkspace.openSession(id)`（官方 ui-chat / ui-subagent / ui-workflow-run 也用它），一个分支覆盖两代。另：官方的启动恢复也搬进了 ui-workspace 的 watcher，多开页上首次注入会被它盖掉（恢复值来自共用的 localStorage），所以注入是**盯住目标直到落定**（1.5 秒观察窗口内每一拍重新看一眼当前读数、没落定就再喊一次；「目标还没出现在这一页的清单里」不当结论、`openSession` 抛的错当场说出来），且目标落定前不上报当前会话 |

这四处的共同点：**契约面的名字一个都没少**，坏掉的是「这些名字背后的语义」。探针按名字查，
补不上这一类，只能靠真页面在真版本上跑出来。

**整轮读数（2026-09-22，本机装的 0.1.6-alpha.2）**：67 项里 65 项全绿、**3580 / 3583** 条断言
通过；红的只有 chat 树那两条（F-61 15/17、F-62 21/22，两处都在会话落定 / 未连通页面的渲染上，
与 block list 无关——改前的 block list 上逐字复现，见 #226）。此前那一轮（2026-09-21，装的还是
alpha.1）是 67 项零红、3583 条全过，套件集与总数都没变。

### 重启实例之后约 3 秒整页白（0.1.6-alpha.2，2026-09-18 复测 #10 时撞到）

**现象**：在 alpha.2 上**重启 dsh 实例**（同端口同 `DSH_HOME`，就是扩展的 restart 路径）之后
约 3 秒（重连成功之后约 2 秒），页面**整页变白**、此后新内容一条不出来；同一刻的控制台里是

```
SlotAssemblyError: scope 'session-maybe' rendered without an installed adapter
conversation.input: sessions service unavailable
```

官方页与装配页都中（官方页那一次不经过我们的镜像、不经过扩展）。已知线索：
`dsh-client-connection` 两版**字节相同**，差异在 `dsh-api-session-controller`（alpha.2 新增了
调用期所有权）与 `dsh-client-ui-settings-general`；只测过「kill + 同端口同 `DSH_HOME` 重起」
这一种断开。

**我们的处置：装配页不再留白。** 装配错在官方渲染器里是**故意穿出所有 entry 边界**的
（fail loud，理由与查证写在 `src/ui/assembly/failureNotice.ts` 的文件头），React 18 随即把整棵
root 卸掉——页面上一个可见的盒都不剩。页面运行时据此兜住这一态，判据落在**用户看到的东西**上：
`#root` 从「有过内容」变成「连续两拍一个可见的盒都没有」，就在页面顶上落一行说明（带**原始
错误文本**，不吞日志）加一个「重新加载」入口，点它整页重载、装配重跑，页面自己回来，用户
不必再知道「刷新可解」这件事。常驻把关 = `npm run verify:lab` 的 **F-63**（注入一次真装配
失败，判提示行真的在视口里、原始错误照旧可观测、点重载入口整页救回来、救回来之后不误报）。

## 人工/补充项（探针覆盖不了）

对新版本逐项过：

1. **流式渲染**：发一条消息，assistant 文本逐字增量出现（0.1.3 起增量改为 `session/follow` 的 `assistantStream: true` opt-in 侧信道，未适配前此项失败表现为「转圈后整段蹦出」）。
2. **工具卡**：跑一个带工具调用的任务，`tool/call`、`tool/result` 卡片渲染与展开正常。
3. **斜杠命令真跑**：`/compact` 等命令端到端执行（探针只验证 args 形状被网关接受）。
4. **审批/提问瀑布**：触发一次权限审批与 `ask_user_question` 提问卡，应答后 agent 继续。
5. **历史迁移**：用旧版本建过会话的 `~/.dsh` 起新版本（session format v2 迁移），历史渲染完整；再回滚旧版本确认可读。
6. **沙盒容器回归**：沿用 `test/sandbox/` 的容器内升级配方（镜像 pin 旧版 → 容器内 `npm i -g` 升新版 → mock-llm 场景回归），跑基线 ledger。
7. **release notes 破坏性变更段**：逐条对照 dsh-one 源码引用点（`grep -rn "0.1.2\|0.1.3" src/` 的注释标注了所有版本相关分支）。

完成后在对应 `upstream-watch` issue 里 comment 结论；发现破坏项按 backlog 流程单独立 issue 修复。

## 上游发版时该跑的三件事

前两件是 **combo 面**（装配线直引官方前端插件，改装配相关代码或上游发版后都要跑）；第三件是**宿主半面**（网关侧插件）。三件与 `AGENTS.md` 的「验证三层」一一对应——探针管名字在不在、装配实验室管装起来对不对、VS Code 验证管宿主层；漂移由谁先发现也就分好了工。

| 跑什么 | 命令 | 覆盖什么 | 前置 |
|---|---|---|---|
| 上游探针 | `node scripts/dsh-upstream-watch/probe.mjs --command dsh --expect-version <版本>`（CI 里由 dsh-upstream-watch 每日自动跑） | 伺服面（wire + 网关前端产物：`/` 的启动契约、combo 端点、Origin 栅栏）+ 客户端契约面（combo 里的 slot/hook/字段名）+ 官方产物面（本机官方包里的内部标识符、三棵树 block list 的服务依赖补全） | 本机有 dsh；探针自起临时 `DSH_HOME` 实例，只读 |
| 浏览器验证（候选版本） | `npm run verify:lab-version <版本>` | **候选版本**上四棵树装不装得起来：零崩溃、零装载未激活、槽位有内容（F-01 CONTRACT）。脚本把候选版本装到临时目录再用它跑实验室，不动本机安装 | 见上一节「装配面」 |
| 浏览器验证（本机版本） | `npm run verify:lab` | 同上，但验的是本机已装的那一版；改装配相关代码后跑它 | 无（这条 script 自己先 `npm run build`） |
| 宿主半验证 | `npm run verify:host-half` | 网关侧插件半（`packages/dsh-host-capabilities`）与官方 dsh 的兼容 | 见 `scripts/verify-host-half-official.mjs` |

另外，探针发现「名字没了」不等于「用户已经炸了」：先按 issue 里的期望出处核对官方改动，再决定是改我们的取用路径（大多数情况）还是登记版本支持范围的变化（README「dsh version tracking」一节）。

**接新版本的正确次序**：先跑上游探针（名字面）→ 再跑 `verify:lab-version <版本>`（装配面，这一步是 0.1.6-alpha.2 那次整页白的门禁）→ 过了再登记进 README 的「Tested versions」。

## 徽章数据

README 两个徽章由 workflow 回写 `.github/dsh-compat/`：

- `upstream-latest.json`：上游最新 release tag（每轮更新）
- `compat.json`：最近一次探针实测的版本与结论（仅探针执行时更新；npm 未发布的 GitHub-only 版本不会覆盖上次实测结果）
