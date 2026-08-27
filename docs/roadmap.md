# DSH One Roadmap

分两类：**缺陷**是现状就有问题、该修的；**增强**是锦上添花。每条注明现状依据。

## 已知不足

| 项 | 类别 | 说明 |
| --- | --- | --- |
| HTTP 代理未支持 | 缺陷 | registry / nodejs.org 的下载都直接用全局 `fetch`（`src/runtime/dshRuntime.ts:83`、`src/runtime/node.ts:51`），不读 `http.proxy` 设置。公司内网走代理的用户首次下载会直接失败。 |
| Remote（SSH/WSL/容器）未验证 | 缺陷 | 声明了 `extensionKind: ["workspace"]`（跑在远端），webview 里访问 127.0.0.1 依赖 VSCode 自动端口转发，理论上可行但没实测过。 |
| 多窗口 port=0 各起各的 | 缺陷 | `port: 0` 时跳过收养探测（`src/server/manager.ts:136`），每个窗口各 spawn 一个 dsh 实例。多个实例并发写 `~/.dsh` 正是收养机制要防的场景，目前靠"默认端口非 0"兜底。 |
| 运行时目录无 GC | 缺陷 | `runtimes/dsh/<version>/` 按版本累积，旧版本只在作为 last-good 时有意义，其余永不清理；单个 dsh 安装约 280MB，长期用会明显占盘。 |
| 首次下载 dsh 约 7 分钟、只有一个进度条 | 缺陷 | 首次体验 = Node 下载 + `npm install`（455 个包），实测约 7 分钟，期间只有通知进度条的阶段性文案（`src/runtime/dshRuntime.ts:181`），没有百分比也没有可取消。 |
| 真实 UI 未经人工点验 | 缺陷 | iframe 嵌入官方 UI 的完整链路（含 `dsh_embed=vscode` 的侧栏隐藏效果）没有人工验证记录；单测只覆盖 `src/pure/`。 |

## 候选方向

| 项 | 类别 | 说明 |
| --- | --- | --- |
| `http.proxy` 支持 | 增强 | 读 `http.proxy` / `http.proxySupport`，给 fetch 和 npm 都挂上代理（npm 侧可以传 `--proxy` / 环境变量）。直接对应上面的代理缺陷。 |
| 运行时目录 GC | 增强 | 保留 current + last-good 两个 dsh 版本，其余在启动时异步清理；Node 运行时同理（保留最新一个）。注意不能清正在运行的版本。 |
| Remote 实测 | 增强 | 在 SSH / WSL / devcontainer 三种环境各过一遍发版点验清单（见 `docs/development.md`），根据结果决定改代码还是改 README 的限制声明。 |
| 心跳看门狗防孤儿 | 增强 | 目前 VSCode 崩溃（非 deactivate 路径）会留下孤儿 dsh 进程。可以加周期性心跳文件，dsh 侧或扩展重启时发现陈旧实例做提示/回收（回收必须沿用收养语义，只动自己 spawn 过的）。 |
| cordis patch 桥接增强 | 增强 | 父项目 dsh-node-flow 在用 cordis patch 扩展 dsh 能力（见父仓库 `dsh-node-flow/cordis.patch.yml`），可评估是否由本扩展提供桥接入口，让 patch 类能力随运行时一起管理。 |
| Copilot LM Provider | 增强 | 把 dsh 的模型能力注册为 VSCode Language Model Provider（`vscode.lm`），让 Copilot Chat 等消费。属于新能力探索，优先级最低。 |
