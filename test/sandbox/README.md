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
- 容器内跑真 dsh 需要模型凭证与联网；审批、流式、错误态等真 dsh 喂不出来的边界态，靠 mock dsh 场景喂（另见相关会话），不依赖本沙盒。
