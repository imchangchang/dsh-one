# Docker 沙盒测试/截图环境

本目录在 docker 容器里起一个 code-server 浏览器工作台，预装 dsh 与 DSH One 插件的 vsix，用于：
宣发截图（中英文）和最终状态验证需要在**真 VS Code** 里跑插件——沙盒提供一致、可重现的运行时环境，
配合 `ai-visual-validation` / Kimi WebBridge 等浏览器自动化做截图与语义核对。

- 镜像名：`dsh-sandbox:latest`
- 容器名：`dsh-sandbox`（固定，重建前会被强制删除）
- 访问：`http://localhost:<port>`（默认 8080）

## 前置

- 任意的 docker 运行时（推荐 OrbStack）：`docker info` 能跑通即可。
- 打出插件 vsix：仓库根执行 `npm run package`，产物 `dsh-one-1.0.0.vsix`（vsix 不进仓库，`.gitignore` 已排除 `*.vsix`）。
- 真 dsh 场景先初始化宿主配置：`npm i -g @deepseek-ai/dsh` 后跑一次让 `~/.dsh` 生成本地配置（start 会只读挂载它进容器）。mock dsh 场景不需要。

## 用法

驱动脚本是 `test/sandbox/run-sandbox.sh`，子命令见 `--help`。

### 构建镜像

```bash
test/sandbox/run-sandbox.sh build --vsix "$(pwd)/dsh-one-1.0.0.vsix" --locale en --theme dark
```

- `--vsix <绝对路径>`：预装插件扩展。省略（或不带）则镜像不含插件，仍可用，适合后续 mock dsh 场景（基本用不到真扩展）。
- `--locale <en|zh-cn>` / `--theme <dark|light>`：写进镜像的默认值；运行期可用 `start -e` 覆盖。
- docker build 上下文固定为 `test/sandbox/`，脚本会先把 vsix 拷成 `test/sandbox/dsh-one.vsix`（gitignored，不污染仓库）；不带 `--vsix` 时用一个空占位文件让 COPY 通过，镜像里跳过安装。

### 起容器

```bash
test/sandbox/run-sandbox.sh start --locale zh-cn --theme light --port 8080
```

- 容器固定名 `dsh-sandbox`；若已存在同名容器会先强制删除重建。
- `--locale`/`--theme` 由容器 entrypoint 消费：locale 写进 code-server 的 `argv.json`，theme 写进 `settings.json` 的 `workbench.colorTheme`。
- `--port` 默认 8080，宿主与容器内同一个端口（`-p $port:$port -e PORT=$port`）。
- 宿主 `~/.dsh`（存在时）以只读挂载进容器，entrypoint 复制一份到容器内 `$HOME/.dsh`（容器可写，不污染宿主）。

### Mock-LLM 模式（`--mock-llm`）

容器里跑**真 dsh**（设置校验、路由、审批、流式编排都走真实代码），只把 LLM 请求打进容器内假端点
`/app/mock-llm/server.ts`——另一个子代理写的零依赖 `node:http` 服务，只会按 scenario 编排/回放模型响应，不真的推理。
用于：在**不联网、无模型凭证**的情况下，用真 dsh 把整套交互链跑通、验证扩展对 dsh 各边界态（审批、错误、空会话等）的渲染与处理。

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
| 用途 | 宣发截图、最终状态验证 | 无凭证/离线跑真 dsh 全逻辑、喂边界态 |

dsh 版本 pin 约定不变：仍 `@deepseek-ai/dsh@0.1.1-rc.2`（升 `@next` 会带 token 认证，扩展不支持，`/api/*` 回 401）。

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

### 其他子命令

```bash
test/sandbox/run-sandbox.sh status   # 镜像/容器状态、端口映射
test/sandbox/run-sandbox.sh logs     # 跟随容器日志（Ctrl-C 退出）
test/sandbox/run-sandbox.sh sh       # 进容器 shell
test/sandbox/run-sandbox.sh stop     # 停止并删除容器 dsh-sandbox
test/sandbox/run-sandbox.sh --help   # 全部参数
```

## 产物目录约定

截图统一输出到 `/tmp/dsh-sandbox-shots/`（脚本或截图工具负责 `mkdir -p`），命名建议 `shot-<NN>-<描述>.png`
（参照 spike 的 `/tmp/dsh-sandbox/shot-*.png`）。都是测试产物，放 /tmp，不落仓库。

## 已知边界

- **code-server 是浏览器工作台，没有原生窗口外壳**：插件 UI 以 webview 形式嵌在浏览器页面里，交互/截图都通过浏览器进行，与本机 VS Code 存在渲染差异（字体、主题刷新时机等）。这是设计内取舍——沙盒只保证环境一致与可重现，不追求像素级等同本机 VS Code。
- 容器内跑真 dsh 需要模型凭证与联网；审批、流式、错误态等真 dsh 喂不出来的边界态，靠 mock dsh 场景喂（另见相关会话），不依赖本沙盒。**但用 `--mock-llm` 模式可以在不联网、无凭证的前提下把真 dsh 的整套逻辑跑起来**——LLM 走容器内假端点，边界态由该端点的 scenario 编排（见上文「Mock-LLM 模式」）。

## 远程驱动配方（WebBridge 实测记录，2026-09-04）

用 Kimi WebBridge 驱动这个页面做自动化截图/交互时的几个实测结论（避免重复踩坑）：

- **webview iframe 是同源嵌套**：顶层有 2 个 `webview ready` 外框（聊天 840 宽 / 侧边栏 300 宽），内容在**内层 `active-frame`** iframe 里。evaluate 递归 `contentDocument` 可达（`try/catch` 跨源保护），往里钻到 `textarea#input`、`.send-button` 即可发消息。
- **iframe 会被 webview host 反复重建**：查询和点击要在同一帧时序里完成，优雅写法 = 递归函数里找到即点；找不到就重试 2-3 次（重建间隙会瞬间查空）。
- **发消息**：`textarea#input` 填值（用 `Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set` + `input` 事件，别直接 `el.value=`），再点 `.send-button`（合成 Enter keydown 无效，点按钮可靠）。
- **命令面板路径**：`Cmd+Shift+P` → insertText → Enter 走的是 workbench 顶层 DOM，最可靠；但 WebBridge 的 `cdp` 通道需要浏览器扩展开启开发者模式（`cdpFullAccess`），没开时回退到 evaluate 合成事件。
- **真 dsh 的 queue 语义**：网关直接 `session.prompt` 无会话 attach 时只是排队、turn 不启动（真行为，不是坑）；要从扩展 UI 的 New Chat 入口发（attach 后 prompt 即跑）。
- **新建会话**：点侧边栏 + 后即使 tab 没立刻出现，会话与 attach 已生效——标题生成由 dsh 异步跑（mock 模式下标题也是 mock 编排的，易验证：标题会变成「收到：…」）。
