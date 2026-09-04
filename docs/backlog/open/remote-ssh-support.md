# Remote-SSH 场景支持：dsh web 入口当前不可用

记录于 2026-09-03。推演（代码级核实）Remote-SSH 下插件的整体行为：插件 `extensionKind: ["workspace"]`（package.json:20），Remote-SSH 时整包跑在**远端**——dsh server spawn 在远端 `127.0.0.1`、会话 cwd 是远端路径、vscode.git 也是远端实例；但窗口 UI 与 webview 渲染在**本地**。错位只发生在「从本地 UI 侧访问远端服务」的地方。未开始修改。**优先级：低**（近期不使用 Remote-SSH，方案先拍板，开发随排期）。

## 背景与现象

dsh web UI 的两个入口在 Remote-SSH 下：（iframe 入口必坏；系统浏览器入口原推演必坏，2026-09-04 核实 `openExternal` 自动转发后判断大概率可用，见「已核实」节，待真实环境验证）

1. **系统浏览器**（原推演必坏，已修正）：状态栏 tooltip「Open in Browser / Retry Starting / Start Service」与整块点击 → `dshOne.openExternal`（src/extension.ts:120-123）→ `vscode.env.openExternal(http://127.0.0.1:<port>)`——openExternal 对传入 URI 自动做 localhost 端口转发，Remote 下大概率能打开；需真实环境验证一次。
2. **编辑器内 tab**：`dshOne.openInTab`（src/ui/webview.ts:97 `dshFrame`）在 webview 里嵌 `<iframe src="http://127.0.0.1:<port>/?dsh_embed=vscode">` —— iframe 由**本地** webview 渲染进程请求，同样连不上，白屏。

端口是配置项 `dshOne.port`（默认 3080，package.json:200-206），被占用时 fallback 到附近空闲端口（src/server/manager.ts:201-227）。

## 已核实（根因 / 现状）

- **VS Code 已知限制**：webview 内容（含 iframe/导航）无法直接访问远端 localhost/127.0.0.1——请求从本地 UI 进程发出。参见 vscode-docs 已知问题（"Webview HTML content cannot directly access port forwarded servers"）与社区讨论（[stackoverflow #76781584](https://stackoverflow.com/questions/76781584/localhost-doesnt-work-inside-my-remote-vs-codes-webviews)、[#55978517](https://stackoverflow.com/questions/55978517/why-does-localhost-not-work-inside-my-vs-codes-webviews-when-connected-to-remot)）。
- **官方 API 已核实（2026-09-04 推翻原「无转发接口」猜测）**：
  - `vscode.env.asExternalUri(uri)`：Remote 下**自动建端口转发隧道**并返回本地可访问 URI，本地 no-op；返回 URI 可能不指向 localhost，须整段使用；隧道生命周期由编辑器管理、用户可关闭、结果不可缓存（见 vscode.d.ts 注释；[remote-extensions.md](https://code.visualstudio.com/api/advanced-topics/remote-extensions) "Option 1 - Use asExternalUri" 明文列为 webview iframe 方案）。
  - `vscode.env.openExternal` 对传入 URI **自动做 localhost 端口转发**（官方文档明确），故系统浏览器入口在 Remote 下大概率本来就工作，无需改。
  - 修正条目原推演的「反向错连」风险：Remote + 自动隧道下隧道本地端口由 VS Code 分配，不会错连本地同端口服务；本地场景下 127.0.0.1:3080 指向本地服务属既有正常行为。
- **其余功能无本地假设，行为等同本地**（已推演确认）：chat/sessions webview 资源走 `webview.asWebviewUri`（Remote 自动映射）、postMessage 通信、CSP 无 127.0.0.1 依赖；文件类（openPath/attachment/@补全/showLogs）全是远端路径直接打开；附件粘贴走字节流（FileReader → base64）不走路径；git 卡片/commit 联动在远端窗口（与本地行为一致，依赖「打开文件夹」的问题同样存在）。
- **次要降级点**（可用但体验差，非故障）：① session log export 保存到**远端** `~/Downloads`（src/ui/chatMessages.ts:806），用户可能去本地找；② 二进制附件兜底 `openExternal(file: URI)`（chatMessages.ts:646）、目录链接 `revealFileInOS`（chatMessages.ts:602）是本地 UI 侧命令，Remote 下大概率无效，走报错降级路径。

## 建议方案（2026-09-04 已拍板）

按 VS Code 官方设计（asExternalUri）实施：

1. **iframe 入口主修**：`bind`/`render` 处对 `status.url`（`http://127.0.0.1:<port>`，manager.ts:188/208）先 `await vscode.env.asExternalUri(...)` 再作 iframe src（保留 `?dsh_embed=vscode`）。本地无差别（no-op），Remote 下自动转发生效、不白屏。不需要 `remoteName` 分叉。
2. **iframe 降级**：dshFrame 页加「复制 URL」「在浏览器打开」辅助（用 asExternalUri 返回的本地 URL，openExternal 可直接打开）；隧道建立失败/被用户关闭无事件可监听，静态降级按钮兜底。CSP `frame-src` 现有 `127.0.0.1:* localhost:*` 覆盖 SSH 隧道，实施时如返回其它 host 需同步放宽。
3. **openExternal 入口**：不改代码（自动转发）；实施时如恰好有真实 Remote 环境，验证一次 127.0.0.1 形式的自动转发即可。
4. **remoteName 辅助**：`vscode.env.remoteName` 仅用于降级/次要点文案判定（「当前在 Remote 环境」类提示），不作主分支。
5. **次要点**：export 保存到远端 `~/Downloads` 时提示「已保存到远端主机」；`revealFileInOS`/`openExternal(file:)` 在 Remote 下提示「远端主机不支持」。
6. **不做**：Codespaces 浏览器变体（asExternalUri 返回 `https://*.github.dev` 的 CSP 放行）——超出本条目，如未来需要另开条目。

## 验收方式（2026-09-04 已拍板）

- 本地单测：mock `asExternalUri`/`openExternal` 成功/失败分支；本地运行行为与现状一致（no-op 回归）。
- **不安排真实 Remote-SSH 验收**：优先级低、近期不使用 Remote-SSH，真实行为依赖官方 API 背书；需要时再补人工验收清单。
- 不用 code-server 模拟：其无官方 port forwarding（asExternalUri 大概率 no-op），只能验降级 UI，验不了主线。

## 涉及代码位置

- `src/extension.ts:120-123`：`dshOne.openExternal`（确认不改，自动转发）
- `src/ui/webview.ts:97-118`：`dshFrame`/`render`/`bind`——iframe src 改为 `asExternalUri` 解析后渲染（主改动点）
- `src/ui/webview.ts:48`：CSP `frame-src`（SSH 隧道覆盖现有白名单，实施时确认）
- `src/ui/statusbar.ts:55,77,83`：tooltip 里的「Open in Browser / Retry Starting / Start Service」链接（仅文案判定，不动逻辑）
- `src/ui/chatMessages.ts:602,646,806`：`revealFileInOS` / `openExternal(file:)` / export 保存路径

## 变更记录

- 2026-09-03 推演 Remote-SSH 场景（extensionKind/manager 端口/iframe 渲染进程/端口转发变数逐项核实）→ 定位两处必坏入口与两个次要降级点，其余功能确认自洽 → 记入 open/（未开始修改）。
- 2026-09-04 方案讨论拍板：核实官方 API（`asExternalUri` 自动建隧道 / `openExternal` 自动转发，推翻原「扩展无转发接口」假设）；范围定为 iframe 入口以 asExternalUri 解析 + 降级页、openExternal 入口不动、remoteName 仅辅助文案、次要点三处提示；验收=本地单测 mock 分支，不安排真实 Remote-SSH 验收；优先级：低。
- 2026-09-04 用户拍板：**暂缓，不排入任何 sprint**（真实 Remote-SSH 环境不好验证，等有真实使用场景再排）；条目保留 open/，方案与验收方式不变。
