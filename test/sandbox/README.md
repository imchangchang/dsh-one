# Docker 沙盒测试/截图环境

本目录在 docker 容器里起一个 code-server 浏览器工作台，预装 dsh 与 DSH One 插件的 vsix，用于：
宣发截图（中英文）和最终状态验证需要在**真 VS Code** 里跑插件——沙盒提供一致、可重现的运行时环境，
配合 `ai-visual-validation` / Kimi WebBridge 等浏览器自动化做截图与语义核对。

- 镜像名：`dsh-sandbox:latest`
- 容器名：`dsh-sandbox`（固定，重建前会被强制删除）
- 访问：`http://localhost:<port>`（默认 8080）
- 并行实例：多个 session 同时验证时传 `--instance <slug>`（镜像/容器/buildx 目录按 slug 派生，端口显式指定），见「并行实例」。

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

### 并行实例（多 session 同时验证）

worktree 并行开发时每个 session 用自己的实例，互不干扰（镜像 tag/容器名/端口/截图目录按 slug 与显式端口错开；无 `--instance` 的默认实例保持原行为）：

```bash
# session A（slug a，宿主端口 8081，mock 端点自动取 8082）
test/sandbox/run-sandbox.sh build --instance a --mock-llm --vsix "$(pwd)/dsh-one-1.0.0.vsix"
test/sandbox/run-sandbox.sh start --instance a --mock-llm --port 8081

# session B（slug b，宿主端口 8083，mock 端点自动取 8084）
test/sandbox/run-sandbox.sh build --instance b --mock-llm --vsix "$(pwd)/dsh-one-1.0.0.vsix"
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
- 容器内跑真 dsh 需要模型凭证与联网；审批、流式、错误态等真 dsh 喂不出来的边界态，靠 mock dsh 场景喂（另见相关会话），不依赖本沙盒。**但用 `--mock-llm` 模式可以在不联网、无凭证的前提下把真 dsh 的整套逻辑跑起来**——LLM 走容器内假端点，边界态由该端点的 scenario 编排（见上文「Mock-LLM 模式」）。

## 远程驱动配方（WebBridge 实测记录，2026-09-04）

用 Kimi WebBridge 驱动这个页面做自动化截图/交互时的几个实测结论（避免重复踩坑）：

- **webview iframe 是同源嵌套**：顶层有 2 个 `webview ready` 外框（聊天 840 宽 / 侧边栏 300 宽），内容在**内层 `active-frame`** iframe 里。evaluate 递归 `contentDocument` 可达（`try/catch` 跨源保护），往里钻到 `textarea#input`、`.send-button` 即可发消息。
- **iframe 会被 webview host 反复重建**：查询和点击要在同一帧时序里完成，优雅写法 = 递归函数里找到即点；找不到就重试 2-3 次（重建间隙会瞬间查空）。
- **发消息**：`textarea#input` 填值（用 `Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set` + `input` 事件，别直接 `el.value=`），再点 `.send-button`（合成 Enter keydown 无效，点按钮可靠）。
- **命令面板路径**：`Cmd+Shift+P` → insertText → Enter 走的是 workbench 顶层 DOM，最可靠；但 WebBridge 的 `cdp` 通道需要浏览器扩展开启开发者模式（`cdpFullAccess`），没开时回退到 evaluate 合成事件。
- **真 dsh 的 queue 语义**：网关直接 `session.prompt` 无会话 attach 时只是排队、turn 不启动（真行为，不是坑）；要从扩展 UI 的 New Chat 入口发（attach 后 prompt 即跑）。
- **新建会话**：点侧边栏 + 后即使 tab 没立刻出现，会话与 attach 已生效——标题生成由 dsh 异步跑（mock 模式下标题也是 mock 编排的，易验证：标题会变成「收到：…」）。

## 自动驱动（Playwright）

`test/sandbox/verify-driver.mjs` 用 Playwright 在宿主侧驱动 code-server 页面，对 ledger（`verify.ledger.json`）里**带 `driver` 字段**的条目做确定性回归：新建会话 → 发 prompt → 断 mock 回复 → 截图 → 把该项 `result` 写回 ledger（`done`/`fail`）。用于 CI/主线自动回归；本地人工循环走上面的 WebBridge 配方（见「与 WebBridge 的分工」）。驱动写完结果后用 `report.mjs` 渲染成 HTML 报告（见「任务测试报告」）。

### 前提

- 沙盒**已起**（`test/sandbox/run-sandbox.sh start --mock-llm`，mock-llm 模式），`--url` 指向它。
- Playwright 与 Chromium 已装（在仓库根执行）：

  ```bash
  npm i -D playwright
  npx playwright install chromium
  ```

  `npx playwright install chromium` 默认写 `~/Library/Caches/ms-playwright`（workspace 外，会触发提权）；本机已装过缓存时可跳过。需要重装时用
  `PLAYWRIGHT_BROWSERS_PATH=/tmp/dsh-sandbox-pw-browsers npx playwright install chromium`，把浏览器装进可写区（此后运行驱动脚本也须带同一环境变量）。

### 命令

```bash
node test/sandbox/verify-driver.mjs \
  --ledger test/sandbox/verify.ledger.json \
  --url http://127.0.0.1:8080 \
  --out /tmp/dsh-sandbox-shots/ \
  [--only F-01]            # 逗号分隔的 id 列表，可选；不给=全部装 driver 的项
```

- `--ledger <path>`：台账；默认 `test/sandbox/verify.ledger.json`。
- `--url <code-server地址>`：默认 `http://127.0.0.1:8080`。
- `--out <截图目录>`：每项截图 `<id>.png`；默认 `/tmp/dsh-sandbox-shots/`。
- `--only F-01,R-01`：只跑指定 id。
- `--headed` / `--keep-open`：调试用（有头浏览器 / 结束后不关浏览器）。

### Ledger 字段

驱动只读 `driver` 格（`driver` 可缺省，缺省的项跳过不执行）。除 `prompt` 外都是可选字段，缺省走原有行为：

```json
{
  "id": "F-01",
  "driver": {
    "prompt": "测试一下",             // 发送给新会话的消息（可选：fillAndClear 项可省）
    "expectText": "收到：测试一下",    // 断言：等待 webview 中出现该文本（超时 120s）
    "afterSendFill": "我的草稿",      // 可选：点发送后立刻填入 composer（pending 接管前正在输入）
    "approve": true,                  // 可选：等待权限审批面板并点 Allow once（英文 locale）
    "expectDraft": "我的草稿",        // 可选：断言 composer textarea 值包含该文本（草稿恢复检查）
    "expectPlaceholder": "占位文本",  // 可选：断言 composer textarea 的 placeholder 包含该文本
    "fillAndClear": "草稿文本"         // 可选：填入该文本并点 .clear-all-button，断言输入框为空
  },
  "result": "pending",              // 驱动每次跑完覆写：done（断言命中）/ fail（断言超时，notes 写原因）
  "screenshots": []
}
```

其余字段（`phase`/`name`/`expect`/`coverageNote` 等）是报告/人看的，驱动不动。跑完把更新后的 ledger 原样写回（JSON 格式化，见 `result`/`screenshots`/`notes`）。

### 执行流程（每项）

1. 打开 `--url`，等 `.monaco-workbench` 出现（超时 30s）。
2. 点活动栏 `a.action-label[aria-label="DSH One"]`。
3. 新建会话（主路径侧边栏「New ungrouped session」；后备命令面板「New Session」——见「已知边界」）。
4. 在聊天 webview 内嵌同源 iframe（`#active-frame`）里对 `textarea#input` `fill`，再点 `.send-button`（合成 Enter 不可靠，点按钮可靠——实测结论）。
5. 断 `expectText`（`frame.locator('body').filter({hasText})` 轮询，超时 60s）；命中 `done`，超时 `fail`。
6. 截图 `page.screenshot({path: --out/<id>.png})`（整页可见区域，webview iframe 内容渲染进图）。
7. `Meta+W` 关当前 chat tab，再进下一项。

**实测坑（2026-09-04 记录）**：

- 新会话**首条** prompt 的 mock 回显是 skill/上下文注入文本，不是 prompt 本身。dsh 在新会话首轮会把 skill 与上下文作为一条 **user 消息**注入，成为 mock「最后一条 user 消息」的匹配对象，于是兜底规则回显成「收到：<注入文本>」，`「查天气」→ get_weather` 规则也因此在首条不命中。驱动先发一条固定暖场消息（`开始`）消耗注入轮，再发 `driver.prompt`，此时它才是最后一条 user 消息，mock 干净回显「收到：<prompt>」/ 命中工具规则。这是 dsh 首轮注入的确定性行为。
- webview 内嵌 iframe 会被宿主**反复重建**（见上方 WebBridge 配方），所以每条对 frame 的操作都要即时重扫 `page.frames()`，不能缓存 FrameHandle——驱动里 `findFrame` 每次都重扫。
- webview 内的「New ungrouped session」按钮 hover 才可见；用 `.workspace-group[data-workspace-id="__ungrouped__"] .workspace-row` hover 后再点。

### 与 WebBridge 的分工

| | WebBridge（Kimi 浏览器扩展） | Playwright 驱动（本小节） |
|---|---|---|
| 驱动者 | 人/AI 在真实浏览器里点 | 宿主脚本（Node + Playwright） |
| 触发 | 人工循环、临时截图/交互 | CI/主线自动回归 |
| 确定性 | 靠人判断 | 脚本按 ledger `expectText` 断 |
| 输出 | 人截图/记录 | ledger `result` + `<id>.png` + 汇总 |

WebBridge 适合「边改边看」的本地人工迭代，Playwright 驱动适合「无人在场」的自动回归，两者互不替代。

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
| `environment` | `{mode,dsh,locale,theme,image,driver,date}` 任意键值，渲染成信息表 |
| `coverageNote` | 覆盖范围声明（真桌面/真模型/平台问题不在范围内） |
| `items[]` | 条目，见下 |
| `items[].id` | `F-xx`（新增功能）/ `R-xx`（回归） |
| `items[].phase` | `new-feature` 或 `regression`；**new-feature 排前、regression 排后** |
| `items[].name` / `expect` | 名称 + 期望描述（人审/报告看，写「看到什么」，别写「应当正常」） |
| `items[].result` | `pending`=未执行；`done`=驱动执行完待人工判定；`pass`/`fail`=结论已定 |
| `items[].screenshots` | 截图路径数组（指向 `--out` 输出目录） |
| `items[].notes` | 失败原因/执行说明 |
| `items[].driver` | 可选；`{prompt, expectText}`，有则 verify-driver 自动跑 |

### 命令

```bash
# 1. 起沙盒（默认实例，先 run-sandbox.sh status 确认空闲；与其他任务并行验证时各用各的 --instance，见「并行实例」）
test/sandbox/run-sandbox.sh start --mock-llm --port 8080

# 2. 驱动：结果写回 ledger（done/fail + 截图路径）
node test/sandbox/verify-driver.mjs \
  --ledger test/sandbox/verify.<slug>.ledger.json \
  --url http://127.0.0.1:8080 \
  --out /tmp/dsh-sandbox-shots/

# 3. 逐项看截图定结论：符合期望 done→pass，不符改 fail 并在 notes 写明；
#    渲染前不能留 pending/done——「每项通过/失败」是 gate 的判定依据。

# 4. 渲染 HTML 报告
node test/sandbox/report.mjs \
  --ledger test/sandbox/verify.<slug>.ledger.json \
  --out test/sandbox/verify.<slug>.report.html
```

- 报告 HTML 已 gitignore（`test/sandbox/*.report.html`），随时可重新渲染；**ledger（含结论）随任务分支提交**，是报告的事实来源。
- 截图产物在 `/tmp/dsh-sandbox-shots/`（不落仓库，见「产物目录约定」）。
- 无 UI 行为变化的任务（纯逻辑/文档）可不建 ledger，在 backlog 条目变更记录里注明「无 UI 行为变化，沙盒报告不适用」。


