# dsh 上游版本兼容性测试清单

dsh-one 是 dsh 的客户端（gateway HTTP/WS RPC + webview 嵌入），上游每个 release 都可能动 wire 协议与前端插件契约。本清单是对上游新版本的完整测试项，分两层：

- **自动化探针**（`.github/workflows/dsh-upstream-watch.yml` 每日 04:00 UTC+8 跑 `scripts/dsh-upstream-watch/probe.mjs`，覆盖 wire 面、网关前端产物与客户端契约面，结果见 `upstream-watch` label 的 issue 与 README 徽章）。安装途径：版本已上 npm 走 `npm install`（快）；**GitHub-only 版本走源码构建**（codeload 源码包 → `pnpm install --frozen-lockfile` → `pnpm run build` → `node --import tsx/esm apps/cli/src/bin.ts`，上游 README 的 Run from source 路径），保证发 npm 前就能提前测。
- **人工/补充项**（探针覆盖不到的模型行为与端到端，由认领该版本测试 issue 的人执行）

## 自动化探针项（probe.mjs，21 项）

探针分两类：**伺服面**（wire——网关对外的 HTTP/WS 接口。含装配形态直引的那两样网关前端产物：`/` 的 HTML 与 `/plugins/??` 的 combo——上游改了交互方式或改了产物写法，都在这一面现形）与**客户端契约面**（combo——装配线直引官方前端插件代码，官方的 slot 名、hook 名、字段名就是我们的 ABI）。两类都由 `.github/workflows/dsh-upstream-watch.yml` 每日 04:00 UTC+8 跑。

两者的分工：探针只查「名字还在不在」，不查「装起来崩不崩」——后者归 `npm run verify:lab`：F-01 CONTRACT 套件（四棵树零崩溃、零缺失契约），外加 #91 加的两条漂移断言 **F-10 FIBER**（四棵树零 cordis scope 进 FAILED——fiber 失败不进控制台，只能运行期看）与 **F-11 WIRE-LIVENESS**（三棵树 block list 的每个 id 都要在当天 wire 里找得到——官方改名会让过滤静默失效）。

### 伺服面（17 项）

| id | 检查内容 | dsh-one 依赖点 |
|---|---|---|
| version-parse | `dsh --version` 输出可解析出 semver | `src/server/locateDsh.ts`、`--no-open` 版本 gate |
| ready-line | `dsh web` 就绪行 `dsh web: <url>?token=` | `src/pure/readyLine.ts` |
| auth-401-fingerprint | 无凭证 POST /api/* → 401 + 正文 `unauthorized` | `src/server/portProbe.ts`（authDsh 指纹） |
| token-exchange-cookie | `GET /?token=` → 303 + `dsh-auth-*` cookie | `src/server/serverAuth.ts` |
| rpc-session-list | `session/list`：信封、rpcId 回显、`{items}` 行形状 | `src/server/dshRpc.ts` listSessions |
| rpc-model-catalog | `session/modelCatalog`：`groups/default` 目录 | `src/server/modelCatalog.ts` |
| rpc-agent-presets | `agentPresets/list`：预设数组 | `src/pure/agentPreset.ts` |
| rpc-workspace-ops | `workspace/create` + `workspace/delete` | `src/server/dshRpc.ts` ensureWorkspace |
| rpc-session-create | `session/create` → `{sessionId}` | 同上 createSession |
| rpc-commands-list | `commands/list` 名册 | 同上 listCommands |
| commands-execute-args | `commands/execute` 接受 dsh-one 现发 args 形状（`{agentId, line, images}`；0.1.3 上游已改名 `submittedAttachments`，此项会暴露） | 同上 executeCommand |
| ws-mux-connect | WS `/api/remote.mux` 带 cookie 建连 | `src/server/remoteMux.ts` |
| ws-session-follow | `session/follow` snapshot 帧（cursor/records/hasMore/projections；detail 记录 header 键与 version、是否有 chunkRows——0.1.3 起 header 与 records 形状变化在这里现形） | `src/server/modernStreams.ts`、`src/pure/chunkRows.ts` |
| ws-session-control | `session/control` baseline 帧 | `src/server/modernStreams.ts` |
| boot-html-contract | 带 cookie GET 网关 `/`：HTML 含 `__ModuleLoader__`、`__DSH_BOOT__`、`const preference`，且 `__DSH_BOOT__` 能解析出 entries ≥ 40（实测 0.1.6-alpha.1 = 56、0.1.2-rc.1 = 46） | `src/ui/assembly/pageHtml.ts`（`__ModuleLoader__` 门面 + 主题预置脚本 + 内联 `__DSH_BOOT__`）、`src/server/assemblyMirror.ts`（原样反代 `/`） |
| combo-endpoint | 从 `__DSH_BOOT__` 取首个 batch 的 combo URL（`/plugins/??…&rev=`）请求：HTTP 200 且 body > 10 KB（实测 0.1.6-alpha.1 = 20.4 KB、0.1.2-rc.1 = 18.2 KB） | `src/server/assemblyMirror.ts`（拉网关原 combo 后按插件段过滤）、`src/ui/assembly/wireFilter.ts` |
| origin-fence | 带 cookie POST `session/list` 两次：`Origin: http://127.0.0.1:1` → 403、`Origin` = 网关权威 → 200 | `src/server/assemblyMirror.ts` 的 `proxyHeaders`（Origin/Referer 改写为网关权威） |

后三项是装配形态的上游伺服面检查（#67 的 N1–N3，对应依赖总表 §4 的 F1–F6），它们与依赖总表 §6.2 原设计有一处出入：**N3 判据里的方法用 `session/list`，不用原写的 `host.describe`**——实测两个已支持版本（0.1.2-rc.1 / 0.1.6-alpha.1）的认证网关对 `/api/host.describe` 的任何 payload 都回 404 `not found`（栅栏判定先于路由，403 那一半拿它照样成立，但「权威 Origin → 200」判不出来）。`host.describe` 现在只剩「无凭证 → 401 指纹」那一条用途（见上表 `auth-401-fingerprint`）。

### 客户端契约面（4 项，`scripts/dsh-upstream-watch/clientContract.mjs`）

做法：带 cookie 取网关 `/` 的 `__DSH_BOOT__`，拉 application 批的那个 combo（官方发给浏览器的原样产物，不经我们的过滤），按三类官方语义取名字后逐个查在场：slot 名（契约目录条目 + 注册/声明/注入/渲染/订阅调用点）、root 级 hook（`ctx.slots.provideRoot({hooks:{…}})` 的顶层键 + 框架映射出的槽位 props）、我们取用过的字段/方法名（按插件段限定作用域）。

| id | 检查内容 | 判定方式 |
|---|---|---|
| client-combo-index | 取法前提：combo 的插件段边界可切、官方 slot 契约目录可取 | 段数 ≥ 40 且每段 id 可读、契约目录 ≥ 30 条；不成立说明官方改了 combo 结构，按该文件注释核对取法 |
| client-slots | 14 组关键 slot 名在场（遮蔽目标 `sidebar.workspaces`、会话面板座 keyed `main`/single `conversation`、右列座 `rightbar`/`details`、`sidebar`、`shell.overlay`、`settings.section/header/action`、各注入点…） | 每个名字要么在契约目录里、要么有注册/注入/渲染调用点；同名换代（如 `details`→`rightbar`）算同一组，任一代在场即通过 |
| client-root-hooks | 4 条 root 级 hook 在场：`panelInfo`、`sessions`、`sessionPendingInteraction`、`workspaces`，外加框架映射出的槽位 props `use<Name>` | 每条要求「provideRoot 里有这个键」且「`use<Name>` 这个 props 名在 combo 里」——#76 的 `usePanelInfo is not a function` 就落在这一条上 |
| client-identifiers | 我们取用过的 14 组字段/方法名在场（composer 附件字段/动作两代名、`draftRev`、`insertReference`、`activePanelId`、`entryKey`、工作区快照字段、会话快照 `byId`、`pendingInteractions`…） | 每个名字要在它该来的插件段里出现（例如附件字段只认 ui-conversation）——#78 抓到的 `imageIds`→`attachmentIds` 就是这一类 |

失败信息的形式：`dsh <当前版本> 缺 N 组：<名字>（期望出处 <官方源码路径>；我方使用点 src/…）`，照它去查官方 release notes 或改我们的取用路径。

清单不是凭记忆写的：每条都写明理由（`why`）与我方使用点（`where`），并由 `test/upstreamClientContract.test.ts` 保证「清单里的名字在 `src/` 里确实还有取用点、`where` 指向的文件确实存在」。**新增依赖 = 在 clientContract.mjs 的三张表里加一行**（名字、理由、使用点、期望的官方出处）；不再依赖就把该行删掉，否则测试会提醒。

探针环境：ubuntu-latest + Node 24，临时 `DSH_HOME` 隔离数据目录，只读/无副作用。

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
| 上游探针 | `node scripts/dsh-upstream-watch/probe.mjs --command dsh --expect-version <版本>`（CI 里由 dsh-upstream-watch 每日自动跑） | 伺服面（wire + 网关前端产物：`/` 的启动契约、combo 端点、Origin 栅栏）+ 客户端契约面（combo 里的 slot/hook/字段名） | 本机有 dsh；探针自起临时 `DSH_HOME` 实例，只读 |
| 浏览器验证 | `npm run verify:lab` | 四棵树在真网关上装得起来、槽位有内容、零崩溃零缺失契约（F-01 CONTRACT） | `npm run build` 过 + 本机有一个在跑的 dsh 网关 |
| 宿主半验证 | `npm run verify:host-half` | 网关侧插件半（`packages/dsh-host-capabilities`）与官方 dsh 的兼容 | 见 `scripts/verify-host-half-official.mjs` |

另外，探针发现「名字没了」不等于「用户已经炸了」：先按 issue 里的期望出处核对官方改动，再决定是改我们的取用路径（大多数情况）还是登记版本支持范围的变化（README「dsh version tracking」一节）。

## 徽章数据

README 两个徽章由 workflow 回写 `.github/dsh-compat/`：

- `upstream-latest.json`：上游最新 release tag（每轮更新）
- `compat.json`：最近一次探针实测的版本与结论（仅探针执行时更新；npm 未发布的 GitHub-only 版本不会覆盖上次实测结果）
