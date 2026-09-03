# Remote-SSH 场景支持：dsh web 入口当前不可用

记录于 2026-09-03。推演（代码级核实）Remote-SSH 下插件的整体行为：插件 `extensionKind: ["workspace"]`（package.json:20），Remote-SSH 时整包跑在**远端**——dsh server spawn 在远端 `127.0.0.1`、会话 cwd 是远端路径、vscode.git 也是远端实例；但窗口 UI 与 webview 渲染在**本地**。错位只发生在「从本地 UI 侧访问远端服务」的地方。未开始修改。

## 背景与现象

dsh web UI 的两个入口在 Remote-SSH 下都连不上：

1. **系统浏览器**：状态栏 tooltip「Open in Browser / Retry Starting / Start Service」与整块点击 → `dshOne.openExternal`（src/extension.ts:120-123）→ `vscode.env.openExternal(http://127.0.0.1:<port>)` 打开**本地**系统浏览器访问本地 127.0.0.1 —— 本地没有该服务。
2. **编辑器内 tab**：`dshOne.openInTab`（src/ui/webview.ts:97 `dshFrame`）在 webview 里嵌 `<iframe src="http://127.0.0.1:<port>/?dsh_embed=vscode">` —— iframe 由**本地** webview 渲染进程请求，同样连不上，白屏。

端口是配置项 `dshOne.port`（默认 3080，package.json:200-206），被占用时 fallback 到附近空闲端口（src/server/manager.ts:201-227）。

## 已核实（根因 / 现状）

- **VS Code 已知限制**：webview 内容（含 iframe/导航）无法直接访问远端 localhost/127.0.0.1——请求从本地 UI 进程发出。参见 vscode-docs 已知问题（"Webview HTML content cannot directly access port forwarded servers"）与社区讨论（[stackoverflow #76781584](https://stackoverflow.com/questions/76781584/localhost-doesnt-work-inside-my-remote-vs-codes-webviews)、[#55978517](https://stackoverflow.com/questions/55978517/why-does-localhost-not-work-inside-my-vs-codes-webviews-when-connected-to-remot)）。
- **变数：端口转发**。用户可在 Ports 面板手动转发 dsh 端口到本地，转发后两处入口都能通（本地 127.0.0.1:port 即转发端口）。但扩展 API 无「转发端口」接口，需调研（内置 remote 扩展的 `ports.*` 命令/自动转发对非标准端口不保证）；默认状态即坏的。反向风险：本地恰好有同端口服务时 iframe/浏览器会错连本地。
- **其余功能无本地假设，行为等同本地**（已推演确认）：chat/sessions webview 资源走 `webview.asWebviewUri`（Remote 自动映射）、postMessage 通信、CSP 无 127.0.0.1 依赖；文件类（openPath/attachment/@补全/showLogs）全是远端路径直接打开；附件粘贴走字节流（FileReader → base64）不走路径；git 卡片/commit 联动在远端窗口（与本地行为一致，依赖「打开文件夹」的问题同样存在）。
- **次要降级点**（可用但体验差，非故障）：① session log export 保存到**远端** `~/Downloads`（src/ui/chatMessages.ts:806），用户可能去本地找；② 二进制附件兜底 `openExternal(file: URI)`（chatMessages.ts:646）、目录链接 `revealFileInOS`（chatMessages.ts:602）是本地 UI 侧命令，Remote 下大概率无效，走报错降级路径。

## 建议方案（待确认）

1. **Remote 侦测**：`vscode.env.remoteName`（ssh/wsl/containers 场景判非本地）→ 两个入口改成「提示 + 指引」：tooltip/页面给出端口转发指引（Ports 面板操作）或直接显示 URL 文本供复制。
2. **iframe tab**：不可用时降级为展示 status.url + 复制按钮（不白屏）。
3. **核实端口转发能力**：VS Code 内置端口转发是否有扩展可调入口（`ports.forwardPort` 类命令 / 自动转发规则），若有可自动转发 dsh 端口（需改 `dshOne.port` 与转发端口的联动）。
4. 次要点：export 保存位置在 Remote 下提示「已保存到远端主机」；`revealFileInOS`/`file:` 兜底在 Remote 下明确报「远端主机不支持」一类的文案。

## 涉及代码位置

- `src/extension.ts:120-123`：`dshOne.openExternal`
- `src/ui/webview.ts:97-107`：`dshFrame`（iframe）、`openInTab`（:132）
- `src/ui/statusbar.ts:55,77,83`：tooltip 里的「Open in Browser / Retry Starting / Start Service」链接
- `src/ui/chatMessages.ts:602,646,806`：`revealFileInOS` / `openExternal(file:)` / export 保存路径
- `src/ui/webview.ts:48`：`frame-src http://127.0.0.1:* http://localhost:*`（CSP，允许本地 iframe）

## 变更记录

- 2026-09-03 推演 Remote-SSH 场景（extensionKind/manager 端口/iframe 渲染进程/端口转发变数逐项核实）→ 定位两处必坏入口与两个次要降级点，其余功能确认自洽 → 记入 open/（未开始修改）。
