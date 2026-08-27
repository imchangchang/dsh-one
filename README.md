# DSH One

[DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh)（dsh）与 VSCode 之间的桥接插件：dsh 由你自己安装，DSH One 负责定位并启动它，把 dsh 界面嵌进 VSCode，并把当前文件夹预置为 dsh workspace。VSCode 就是 dsh 的启动器和显示器。

> 非官方社区项目，与 DeepSeek 官方无关。"dsh" 名称归其原项目所有。

## 前置条件

先自行安装 dsh（需要 Node ≥ 22）：

```bash
npm install -g @deepseek-ai/dsh@next
```

扩展不再下载或管理 Node.js / dsh 运行时，也不做更新检查——升级 dsh 由你自己 `npm update -g`。

## 它是怎么工作的

1. **定位 dsh**：优先用配置 `dshOne.dshPath` 指定的可执行文件；否则在 PATH 上找 `dsh`。找不到就报错并引导安装。
2. **启动服务**：先探测配置端口（默认 3080）——POST `/api/host.describe` 并校验回包 `rpcId` 一致，确认是 dsh 就直接**收养复用**该实例（只连接，永不 kill）；否则自己 spawn `dsh web --host 127.0.0.1 --port <端口>`。就绪需要双重确认：先解析 stdout 的 `dsh web: http://127.0.0.1:<端口>` 行，再做一次 `host.describe` 身份确认。
3. **显示**：侧边栏 WebviewView 或编辑器标签页 WebviewPanel，内容是一个指向 `http://127.0.0.1:<端口>/?dsh_embed=vscode` 的 iframe。注意：`dsh_embed=vscode` 是给官方预留的嵌入参数，截至 dsh 0.1.1-rc.2 官方 UI 并未消费它（隐藏侧栏的效果尚不存在）。
4. **workspace 预置**：服务就绪后，扩展把当前 VSCode 文件夹注册为 dsh workspace（`workspace.create`，幂等）并确保其下有会话，dsh UI 启动时按"最近活跃 workspace"策略直接落在当前文件夹上。
5. **Sessions 树视图**：侧边栏顶部有原生会话列表，按 workspace 分组（当前文件夹置顶），支持新建 / 重命名 / 归档会话、在其他 workspace 上"打开文件夹"；列表订阅 dsh 的 host 事件流自动刷新。

## 使用

- 点击活动栏的 DSH One 图标打开侧边栏；首次使用会自动定位 dsh 并启动服务（未安装 dsh 时会提示安装）。
- 侧边栏 Sessions 树视图：查看/新建/重命名/归档会话，点击会话聚焦 dsh 面板（受限于嵌入 UI 无法深链切换会话）。
- 命令面板（`Ctrl/Cmd+Shift+P`）：
  - `DSH One: 打开面板` / `DSH One: 在编辑器标签页打开`
  - `DSH One: 重启服务` / `DSH One: 停止服务`
  - `DSH One: 显示日志`
- 状态栏显示 `DSH: 运行中 :端口 / 启动中 / 已停止 / 错误`，点击聚焦面板。

## 配置项

| 配置 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `dshOne.dshPath` | `string` | `""` | dsh 可执行文件路径；留空则在 PATH 上查找 `dsh` |
| `dshOne.port` | `number` | `3080` | 服务端口；`0` 表示由 OS 分配（此时跳过收养探测） |

## 进程安全

- 插件**只会终止自己 spawn 的 dsh 进程**；收养的已有实例在任何路径下都不会被 kill。
- 关闭 VSCode 时同步发送 SIGTERM（Windows 用 `taskkill /T /F`），3 秒后由独立的 reaper 进程强制终止（作为后备）。
- 子进程环境会剔除 `NODE_OPTIONS` 和 `ELECTRON_RUN_AS_NODE`（扩展宿主注入的这两个变量会让普通 node 子进程异常）。
- `--no-open` 仅在 dsh ≥ 0.1.0-rc.7 时追加（旧版不认识该参数会直接退出）。

## 已知限制

- **Remote（SSH/WSL/容器）未验证**：扩展声明 `extensionKind: ["workspace"]`，理论上跑在远端、webview 的 127.0.0.1 依赖 VSCode 自动端口转发，但未实际测试。
- **多窗口**：每个 VSCode 窗口各自管理服务；端口被占用时靠收养机制共享已有实例，端口为 0 时各窗口各自起实例。另外 dsh UI 的会话恢复依赖 localStorage（按 origin 隔离），`port: 0` 每次换端口会导致恢复失效，建议固定端口。

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
- [docs/roadmap.md](docs/roadmap.md) — 原生前端路线图、已知不足与候选方向

## License

MIT © dsh-one contributors
