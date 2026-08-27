# DSH One

装这一个 VSCode 插件，就能用上完整的 [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh)（dsh）——不用自己装 dsh、不用自己起服务。VSCode 就是 dsh 的启动器和显示器。

> 非官方社区项目，与 DeepSeek 官方无关。"dsh" 名称归其原项目所有。

## 它是怎么工作的（零安装原理）

dsh 的依赖树含平台相关的原生模块，直接打进 VSIX 会有跨平台问题。因此 DSH One 采用**运行时按需下载**：

1. **Node 解析**：先找系统 PATH 上的 Node（要求 ≥ 22）。找不到则从 nodejs.org 下载最新 LTS 官方发行包到扩展的 `globalStorage/runtimes/node/<版本>/`，下载后校验 `SHASUMS256.txt` 中的 SHA256，再原子切换到目标目录。
2. **dsh 解析**：查询 npm registry 选出目标版本（见下方配置），用解析到的 Node 自带的 npm 执行 `npm install --prefix <globalStorage>/runtimes/dsh/<版本> @deepseek-ai/dsh@<版本>`，装完运行 `--version` 验证。当前版本记录在 `current.json`，上一个版本保留为 `last-good.json` 用于回退（不用 symlink，Windows 友好）。
3. **启动服务**：先探测配置端口（默认 3080）——POST `/api/host.describe` 并校验回包 `rpcId` 一致，确认是 dsh 就直接**复用**该实例（只连接，永不 kill）；否则用 `node lib/bin.js web --host 127.0.0.1 --port <端口>` 自己 spawn 一个（直跑 node + bin.js，绕开 shim/shell 问题）。就绪需要双重确认：先解析 stdout 的 `dsh web: http://127.0.0.1:<端口>` 行，再做一次 `host.describe` 身份确认。
4. **显示**：侧边栏 WebviewView 或编辑器标签页 WebviewPanel，内容是一个指向 `http://127.0.0.1:<端口>/?dsh_embed=vscode` 的 iframe（`dsh_embed=vscode` 让官方 UI 隐藏自身侧栏）。

## 使用

- 点击活动栏的 DSH One 图标打开侧边栏；首次使用会自动下载运行时并启动服务（有进度提示）。
- 命令面板（`Ctrl/Cmd+Shift+P`）：
  - `DSH One: 打开面板` / `DSH One: 在编辑器标签页打开`
  - `DSH One: 重启服务` / `DSH One: 停止服务`
  - `DSH One: 检查 dsh 更新` / `DSH One: 显示日志`
- 状态栏显示 `DSH: 运行中 :端口 / 启动中 / 已停止 / 错误`，点击聚焦面板。

## 配置项

| 配置 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `dshOne.channel` | `"stable" \| "rc"` | `"rc"` | stable 用 npm `dist-tags.latest`；rc 取 registry 中最新版本号（含 prerelease，dsh 目前全是 rc 版） |
| `dshOne.pinnedVersion` | `string` | `""` | 非空则固定使用该版本，禁用自动更新 |
| `dshOne.autoUpdate` | `boolean` | `true` | 后台自动更新 dsh（每 12 小时最多检查一次；服务运行时更新在下次启动生效，会提示"立即重启"） |
| `dshOne.useSystemDsh` | `boolean` | `false` | 跳过下载，直接用 PATH 上的 dsh |
| `dshOne.port` | `number` | `3080` | 服务端口；`0` 表示由 OS 分配（此时跳过复用探测） |

## 进程安全

- 插件**只会终止自己 spawn 的 dsh 进程**；复用的已有实例在任何路径下都不会被 kill。
- 关闭 VSCode 时同步发送 SIGTERM（Windows 用 `taskkill /T /F`），3 秒后由独立的 reaper 进程强制终止（作为后备）。
- 子进程环境会剔除 `NODE_OPTIONS` 和 `ELECTRON_RUN_AS_NODE`（扩展宿主注入的这两个变量会让普通 node 子进程异常）。
- `--no-open` 仅在 dsh ≥ 0.1.0-rc.7 时追加（旧版不认识该参数会直接退出）。

## 已知限制

- **Remote（SSH/WSL/容器）未验证**：扩展声明 `extensionKind: ["workspace"]`，理论上跑在远端、webview 的 127.0.0.1 依赖 VSCode 自动端口转发，但未实际测试。
- **HTTP 代理未支持**：registry / nodejs.org 下载暂未尊重 `http.proxy` 设置。
- **多窗口**：每个 VSCode 窗口各自管理服务；端口被占用时靠复用机制共享已有实例，端口为 0 时各窗口各自起实例。
- 下载 Node 依赖系统 `tar`（Windows 10+ 自带 bsdtar，缺失时回退 PowerShell `Expand-Archive`）。

## 开发

```bash
npm install
npm test          # node --test 纯逻辑单测（需要 Node ≥ 22.6）
npm run typecheck
npm run build     # esbuild 打单文件 bundle 到 dist/extension.js
npm run package   # vsce 打出 .vsix
```

零运行时依赖：仅用 Node 内置模块 + vscode API。

详细开发文档：

- [docs/architecture.md](docs/architecture.md) — 模块结构、核心流程、设计决策及出处
- [docs/development.md](docs/development.md) — 环境、构建/调试、发版流程
- [docs/roadmap.md](docs/roadmap.md) — 已知不足与候选方向

## License

MIT © dsh-one contributors
