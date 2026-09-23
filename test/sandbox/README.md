# Docker 沙盒测试/截图环境

本目录在 docker 容器里起一个 code-server 浏览器工作台，预装 dsh 与 DSH One 插件的 vsix。用途是两个：
**宣发截图**（中英文 × 深浅色四种组合）与**人工核对**（在一个一致、可重现的运行时里看插件的实际观感）。

它是**浏览器工作台**，不是本机原生 VS Code 窗口：交互与截图都走浏览器，宿主层的东西（真剪贴板、
原生菜单、主题刷新时机）在这里照不出来，那部分由人跑 `scripts/dev-ui-test.sh` 起隔离 VS Code 窗口
验（最终准绳，见「已知边界」与「验收口径」）。**另外，装配页的取数源在 code-server 里够不到，
页面会留白**（原因与实测见「已知边界」）——按现在的跑法，沙盒核的是扩展与网关之间那一层。

- 镜像名：`dsh-sandbox:latest`
- 容器名：`dsh-sandbox`（固定，重建前会被强制删除）
- 访问：`http://localhost:<port>`（默认 8080）
- 并行实例：多个 session 同时验证时传 `--instance <slug>`（镜像/容器/buildx 目录按 slug 派生，端口显式指定），见「并行实例」。

## 前置

- 任意的 docker 运行时（推荐 OrbStack）：`docker info` 能跑通即可。
- 打出插件 vsix：仓库根执行 `npm run package`，产物是 `dsh-one-<version>.vsix`（`version` 取
  `package.json`，2026-09 的发布线是 `2.0.0`）。vsix 不进仓库，`.gitignore` 已排除 `*.vsix`。
- 真 dsh 场景先初始化宿主配置：`npm i -g @deepseek-ai/dsh` 后跑一次让 `~/.dsh` 生成本地配置（start 会只读挂载它进容器）。mock dsh 场景不需要。

## 用法

驱动脚本是 `test/sandbox/run-sandbox.sh`，子命令见 `--help`。

### 构建镜像

```bash
VSIX="$(pwd)/dsh-one-2.0.0.vsix"   # 名字跟 npm run package 的产物一致，版本号随 package.json
test/sandbox/run-sandbox.sh build --vsix "$VSIX" --locale en --theme dark
```

- `--vsix <绝对路径>`：预装插件扩展。省略（或不带）则镜像不含插件，仍可用，适合后续 mock dsh 场景（基本用不到真扩展）。
- `--locale <en|zh-cn>` / `--theme <dark|light>`：写进镜像的默认值；运行期可用 `start -e` 覆盖。
- docker build 上下文固定为 `test/sandbox/`，脚本会先把 vsix 拷成 `test/sandbox/dsh-one.vsix`（gitignored，不污染仓库）；不带 `--vsix` 时用一个空占位文件让 COPY 通过，镜像里跳过安装。

> **沙盒提权规避**：`docker build` 走 buildx，默认会把 builder 元数据写到 `~/.docker/buildx/`（session workspace 外），
> 在 DSH `workspace-write` 文件沙盒下写被拦、命令报
> `failed to update builder last activity time: ... operation not permitted`，只能提权重试。
> 脚本已把 `BUILDX_CONFIG` 重定向到 `/tmp/dsh-sandbox-buildx`（可写）自动避开；若本机显式设置了
> `BUILDX_CONFIG` 环境变量则尊重该值。

### 起容器

```bash
test/sandbox/run-sandbox.sh start --locale zh-cn --theme light --port 8080
```

- 容器固定名 `dsh-sandbox`；若已存在同名容器会先强制删除重建。
- `--locale`/`--theme` 由容器 entrypoint 消费：locale 写进 code-server 的 `argv.json`，theme 写进 `settings.json` 的 `workbench.colorTheme`。
- `--port` 默认 8080，宿主与容器内同一个端口（`-p $port:$port -e PORT=$port`）。
- `--instance <slug>`：并行实例，容器名/镜像 tag/buildx 目录按 slug 派生；此时 `--port` 必填（默认实例已占 8080）。
- `--mock-llm` 时 `--mock-port <端口>` 是 mock 端点的**宿主**端口（容器内映射固定 9009）；默认 9009，实例化未显式给时自动取 `--port+1`。
- 宿主 `~/.dsh`（存在时）以只读挂载进容器，entrypoint 复制一份到容器内 `$HOME/.dsh`（容器可写，不污染宿主）。

### Mock-LLM 模式（`--mock-llm`）

容器里跑**真 dsh**（设置校验、路由、审批、流式编排都走真实代码），只把 LLM 请求打进容器内假端点
`/app/mock-llm/server.ts`——仓库 `test/mock-llm/` 那份零依赖 `node:http` 服务，只会按 scenario 编排/回放模型响应，不真的推理。
用于：在**不联网、无模型凭证**的情况下，用真 dsh 把整套交互链跑通（会话创建、事件流、审批/提问等边界态由该端点的 scenario 编排）。

命令（build 与 start 必须**配套**都带 `--mock-llm`——镜像里得先有 mock-llm 源码，运行时才会起它）：

```bash
test/sandbox/run-sandbox.sh build --mock-llm
test/sandbox/run-sandbox.sh start --mock-llm
```

- build `--mock-llm`：把仓库 `test/mock-llm/*.ts` 暂存进构建上下文 `.build-mock-llm/`（gitignored，不污染仓库），
  Dockerfile 再拷到镜像 `/app/mock-llm`。
- start `--mock-llm`：向容器传 `-e MOCK_LLM=1`，并以 `-p 9009:9009` 把容器内 mock 端点暴露到宿主，便于
  `curl http://localhost:9009/v1/models` 联调。
- 容器内 entrypoint 在 `MOCK_LLM=1` 时做三步：把容器内 `$HOME/.dsh/settings.yaml` **整体替换**为 mock 配置
  （不 YAML 合并——宿主其他 provider 在 mock 模式下无用，直接替换最确定）；后台启动 mock 端点并轮询
  `/v1/models` 等就绪（约 10s 上限，起不来报错退出）；导出 `MOCK_LLM_KEY=mock-key-1` 作为 settings 里
  `apiKeyEnv` 指向的凭证（true endpoint 默认场景随源码打进 `/app/mock-llm/scenario.ts`）。

与真实模式的对比：

| | 真实模式 | mock-LLM 模式 |
|---|---|---|
| LLM 请求 | 打到 DeepSeek 官方（联网） | 打到容器内假端点（不联网） |
| 模型响应 | 真实模型生成 | mock-llm server 按 scenario 编排/回放 |
| 配置来源 | 宿主 `~/.dsh` 只读挂载，沿用原样 | 容器内 `settings.yaml` 被整体替换为 mock 配置 |
| 凭证 | 真实 API key | `MOCK_LLM_KEY=mock-key-1`（仅容器内有效） |
| 用途 | 宣发截图、人工核对观感（宿主层准绳是 `scripts/dev-ui-test.sh`） | 无凭证/离线跑真 dsh 全逻辑、喂边界态 |

镜像里 pin 的是 `@deepseek-ai/dsh@0.1.5-rc.2`（见 `test/sandbox/Dockerfile`）：它过去是 npm `latest`
指向的版本，但**现在落在扩展的支持区间之外**——版本门下界已抬到 `0.1.6-alpha.1`
（口径与出处：`src/pure/versionGate.ts`），而 0.1.5-rc.2 整轮实测有 2 项红（启动自愈整族不生效、
composer 的 ＋ 不在场，见 `docs/dsh-compat-checklist.md`）。**升级这个 pin 是待办**：换到
0.1.6-alpha.1 并照 #220 那次的流程重跑一轮，再回来改这段文字。旧 pin `0.1.1-rc.2` 更早、更外，
它的升级实测记录见 #220。

2026-09-20 的实测读数（`--instance dshpin`，跑完容器与镜像都已删除）：

```bash
test/sandbox/run-sandbox.sh build --instance dshpin --vsix "$(pwd)/dsh-one-2.0.0.vsix" --mock-llm
#   → 镜像 dsh-sandbox-dshpin:latest 构建成功（npm 装 dsh 那一层 18.6s），vsix 安装成功
test/sandbox/run-sandbox.sh start --instance dshpin --mock-llm --port 8188
docker run --rm --entrypoint bash dsh-sandbox-dshpin:latest -lc 'dsh --version'   # → 0.1.5-rc.2
npm run verify:lab-version 0.1.5-rc.2   # → PASS F-01 底座契约完备性：四棵树零崩溃、零缺失契约（断言 43/43，16.9s）
```

容器里扩展的日志（`~/.local/share/code-server/logs/<stamp>/exthost*/output_logging_*/1-DSH One.log`）：

```
[info] located dsh: dsh (version=0.1.5-rc.2)
[info] spawning: dsh web --host 127.0.0.1 --port 3080 --no-open (cwd=/home/coder/workspace)
[info] dsh auth exchanged at http://127.0.0.1:3080
[info] dsh is ready at http://127.0.0.1:3080
[info] assembly mirror: filtered combo ready (1 application batch(es), kept 41 segments, dropped …)
```

也就是说，扩展在这一版上能发现 dsh、起网关、换票（0.1.2-rc.1 起的 browser-session 认证）、拉 wire
并过滤整包——**扩展与网关之间这一层在新 pin 上跑通**。页面那一边取不到资源，原因见「已知边界」。

**schema 核对**：mock 模式的 `settings.yaml` 字段对照 `@deepseek-ai/dsh-llm-pi-ai/lib/index.js` 的
`profile`/`modelProfile` 定义核对过：
- `profile`（index.js:933-937）：必填 `apiKeyEnv`、`displayName`、`api`、`baseURL`、`models`。
- `modelProfile`（index.js:926-929）：必填 `id`；`name`/`contextWindow`/`maxTokens`/`input` 运行时按
  `entry.xxx ?? base?.xxx ?? request.default*` 兜底（index.js:639-651），这里仍显式补齐。
- `reasoningEfforts`（index.js:916）：声明 `off: null`（「不支持思考」）+ `max`/`high` 的 wire 值；`max` 是合法级别
  （`THINKING_LEVELS`，index.js:290）。
- `compat` 故意不填：`openai-completions` 网关会拒绝非该协议提供的 compat 字段（index.js:589），留空更稳。
- `agent-default-model` 的 `provider`/`model`/`reasoningEffort` 写法照宿主的 `~/.dsh/settings.yaml` 现有段落。

### 四组合截图

同一镜像改 `--locale`/`--theme` 重启容器即可出中英文 × 深浅色 四种组合：

```bash
test/sandbox/run-sandbox.sh start --locale en    --theme dark   # 英文 × 深色
test/sandbox/run-sandbox.sh start --locale en    --theme light  # 英文 × 浅色
test/sandbox/run-sandbox.sh start --locale zh-cn --theme dark   # 中文 × 深色
test/sandbox/run-sandbox.sh start --locale zh-cn --theme light  # 中文 × 浅色
```

启动后开浏览器访问 `http://localhost:<port>`，再用浏览器自动化进去浏览、操作、截图。

### 并行实例（多 session 同时验证）

worktree 并行开发时每个 session 用自己的实例，互不干扰（镜像 tag/容器名/端口/截图目录按 slug 与显式端口错开；无 `--instance` 的默认实例保持原行为）：

```bash
VSIX="$(pwd)/dsh-one-2.0.0.vsix"   # 版本号随 package.json

# session A（slug a，宿主端口 8081，mock 端点自动取 8082）
test/sandbox/run-sandbox.sh build --instance a --mock-llm --vsix "$VSIX"
test/sandbox/run-sandbox.sh start --instance a --mock-llm --port 8081

# session B（slug b，宿主端口 8083，mock 端点自动取 8084）
test/sandbox/run-sandbox.sh build --instance b --mock-llm --vsix "$VSIX"
test/sandbox/run-sandbox.sh start --instance b --mock-llm --port 8083

test/sandbox/run-sandbox.sh status --instance a        # 查看实例 a 的镜像/容器/端口
test/sandbox/run-sandbox.sh stop --instance b          # 停止实例 b
```

- 实例 id 只用字母/数字/连字符（脚本校验）。**同一 worktree 里不要并行跑两个 build**：构建上下文
  （`test/sandbox/`）与暂存文件（`dsh-one.vsix`、`.build-mock-llm/`，gitignored）是共享的，会互相踩；
  不同 worktree 的并行 build 用各自上下文，互不干扰。两个 session 用不同 slug 才能完全并行。
- mock 端点宿主端口不想用 `--port+1` 就显式传 `--mock-port <端口>`（容器内固定 9009，映射的是宿主端口）。
- 截图目录约定：实例化时用 `/tmp/dsh-sandbox-shots-<slug>/`（见「产物目录约定」）。

### 其他子命令

```bash
test/sandbox/run-sandbox.sh status   # 镜像/容器状态、端口映射（并行实例加 --instance <slug>）
test/sandbox/run-sandbox.sh logs     # 跟随容器日志（Ctrl-C 退出）
test/sandbox/run-sandbox.sh sh       # 进容器 shell
test/sandbox/run-sandbox.sh stop     # 停止并删除容器 dsh-sandbox
test/sandbox/run-sandbox.sh --help   # 全部参数
```

`status`/`logs`/`sh`/`stop` 都接受 `--instance <slug>`，只作用于指定实例。

## 产物目录约定

截图统一输出到 `/tmp/dsh-sandbox-shots/`（脚本或截图工具负责 `mkdir -p`），命名建议 `shot-<NN>-<描述>.png`
（参照 spike 的 `/tmp/dsh-sandbox/shot-*.png`）。**并行实例用 `/tmp/dsh-sandbox-shots-<slug>/`**（实例 a → `...-a/`），
避免两个 session 的 `<id>.png` 互相覆盖。都是测试产物，放 /tmp，不落仓库。

## 已知边界

- **code-server 是浏览器工作台，没有原生窗口外壳**：插件 UI 以 webview 形式嵌在浏览器页面里，交互/截图都通过浏览器进行，与本机 VS Code 存在渲染差异（字体、主题刷新时机等）。这是设计内取舍——沙盒只保证环境一致与可重现，不追求像素级等同本机 VS Code。
- 容器内跑真 dsh 需要模型凭证与联网；审批、流式、错误态等真 dsh 喂不出来的边界态，靠 mock dsh 场景（`test/mock-dsh/`）喂，与沙盒无关。**但用 `--mock-llm` 模式可以在不联网、无凭证的前提下把真 dsh 的整套逻辑跑起来**——LLM 走容器内假端点，边界态由该端点的 scenario 编排（见上文「Mock-LLM 模式」）。
- **code-server 里装配页起得来、取不到资源，侧栏与对话区留白**：装配页的 base 是扩展的 loopback mirror（`http://127.0.0.1:<随机端口>/`，只绑扩展宿主那台机器的 127.0.0.1，出处 `src/server/assemblyMirror.ts`），而跑页面的浏览器在宿主上——容器里的 127.0.0.1 不是宿主的 127.0.0.1，于是页面自己的 `/assets/*`、`/plugins/*` 请求失败。实测（2026-09-20，Playwright 打 `http://127.0.0.1:8188`）：扩展日志 `assembly mirror: http://127.0.0.1:39195/` ↔ 浏览器里同一轮的失败请求 `net::ERR_FAILED http://127.0.0.1:39195/assets/index-BKQ_L1z6.js`（连同两份 vendor css/js 与一条 `/plugins/??…` 共 5 条）。本机 VS Code 窗口与 SSH 远程由 VS Code 的端口转发接住，code-server 没有这一层。与 dsh 版本无关——换回旧 pin `0.1.1-rc.2` 的镜像跑同一套驱动同样取不到。所以沙盒目前能核的是**扩展与网关之间那一层**（发现 dsh、起网关、换票、拉 wire、过滤整包），页面观感走浏览器验证（`npm run verify:lab`）或 VS Code 验证。

## 验收口径（#68 起）

- **对话区/装配验收 = 浏览器验证**：对话区、侧栏树、设置页都是官方组件装配页。验收用仓库常驻的 Playwright harness（`test/assembly-lab/`，一条命令 `npm run verify:lab`）直开装配页跑断言 + 截图，快且确定性高；**底座契约完备性**（四棵树零 `slot entry crashed`、零缺失服务/钩子）是其中 **F-01 CONTRACT** 套件的常驻断言。这是第一道验收，跑法与套件清单见 `test/assembly-lab/README.md`。
- **宿主行为验收 = VS Code 验证**：本沙盒（code-server + 真 dsh + 插件 vsix）配 Kimi WebBridge 截图与语义核对——**注意装配页的取数源是扩展的 loopback mirror，code-server 里够不到，页面会留白，见「已知边界」**；或由人跑 `scripts/dev-ui-test.sh` 起隔离 VS Code 窗口实测（最终准绳）。
- 旧的 Playwright 自动驱动（`verify-driver.mjs`）只驱动旧聊天 webview 的 composer（`textarea#input` + `.send-button`），旧聊天区下线后没有可驱动对象，已随 #68 移除；仓库里的验收基线 `verify.ledger.json` 随之收缩为两项侧栏/宿主回归项（`R-02` 侧边栏无宿主残留、`R-03` 扩展接管 dsh）。

## 远程驱动配方（WebBridge 实测记录，2026-09-04）

用 Kimi WebBridge 驱动沙盒页面做手动截图/交互时的实测结论（避免重复踩坑）：

- **webview iframe 是同源嵌套**：内容在**内层 `active-frame`** iframe 里。evaluate 递归 `contentDocument` 可达（`try/catch` 跨源保护）。
- **iframe 会被 webview host 反复重建**：查询和点击要在同一帧时序里完成；找不到就重试 2-3 次。
- **命令面板路径**：`Cmd+Shift+P` → insertText → Enter 走的是 workbench 顶层 DOM，最可靠；WebBridge 的 `cdp` 通道需要浏览器扩展开启开发者模式（`cdpFullAccess`）。
- **新建会话**：点侧边栏 + 后会话即创建（标题由 dsh 异步生成；mock 模式下标题也是 mock 编排的）。
- **对话区交互**：装配页是官方 dsh web 界面，输入框/发送按钮的 selector 与官方 web 一致（不再是旧自研聊天区的 `textarea#input` / `.send-button`）。

## 任务测试报告（worktree dev-finish 产物，合入门禁）

`report.mjs` 把 ledger + 截图渲染成单文件 HTML（截图 base64 内嵌，可直接分发/发给用户审）。
按 worktree-dev-flow 流程 5，dev-finish 前生成；**人审报告通过 = 合入门禁**（对功能有疑问才人工开窗 dev-ui-test）。

### 场景模板

从示例复制为**任务专属** ledger，不动 CI 基线 `test/sandbox/verify.ledger.json`：

```bash
cp test/sandbox/verify.ledger.example.json test/sandbox/verify.<slug>.ledger.json
```

字段（完整示例见 `verify.ledger.example.json`，实测样例见 `verify.ledger.json`）：

| 字段 | 说明 |
|---|---|
| `title` | 报告标题 |
| `branch` / `commit` | 被验分支与 commit（dev-finish 时由生成方填写） |
| `environment` | `{mode,dsh,locale,theme,image,date}` 任意键值，渲染成信息表 |
| `coverageNote` | 覆盖范围声明（真桌面/真模型/平台问题不在范围内） |
| `items[]` | 条目，见下 |
| `items[].id` | `F-xx`（新增功能）/ `R-xx`（回归） |
| `items[].phase` | `new-feature` 或 `regression`；**new-feature 排前、regression 排后** |
| `items[].name` / `expect` | 名称 + 期望描述（人审/报告看，写「看到什么」，别写「应当正常」） |
| `items[].result` | `pending`=未执行；`pass`/`fail`=结论已定（人看截图/现象逐项判定） |
| `items[].screenshots` | 截图路径数组（指向 `--out` 输出目录） |
| `items[].notes` | 失败原因/执行说明 |

### 命令

```bash
# 1. 起沙盒（默认实例，先 run-sandbox.sh status 确认空闲；与其他任务并行验证时各用各的 --instance，见「并行实例」）
test/sandbox/run-sandbox.sh start --mock-llm --port 8080

# 2. 用 Kimi WebBridge（或人开窗 dev-ui-test.sh）逐项操作 + 截图到 /tmp/dsh-sandbox-shots/，
#    对照 expect 逐条判定，把结论写进 ledger 各项的 result/notes/screenshots。

# 3. 渲染 HTML 报告
node test/sandbox/report.mjs \
  --ledger test/sandbox/verify.<slug>.ledger.json \
  --out test/sandbox/verify.<slug>.report.html
```

- 报告 HTML 已 gitignore（`test/sandbox/*.report.html`），随时可重新渲染；**ledger（含结论）随任务分支提交**，是报告的事实来源。
- 截图产物在 `/tmp/dsh-sandbox-shots/`（不落仓库，见「产物目录约定」）。
- 无 UI 行为变化的任务（纯逻辑/文档）可不建 ledger，在 backlog 条目变更记录里注明「无 UI 行为变化，沙盒报告不适用」。

### 平台覆盖声明（`verify.<slug>.platform.json`）

与 ledger 并排的另一种产物：任务的新增行命中平台相关代码或按状态变量分叉的逻辑时，`dev-merge.sh` 的平台兼容性自检（#6，`scripts/check-platform-compat.sh`）要求提交 `test/sandbox/verify.<slug>.platform.json`，逐条声明「这条平台路径在哪验证过」并给出分支矩阵。**没命中就不需要这个文件**；格式、字段口径与本地跑法见 `docs/development.md` 的「合入门禁」一节（门禁被拒时会直接打印可复制的模板，照模板补齐即可）。


