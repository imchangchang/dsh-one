# i18n：webview 层（把 locale 送进 webview）

记录于 2026-09-01。来自发布流程讨论：webview 是独立浏览器上下文，调不了 `vscode.l10n`，是最麻烦的一层，建议后置。

## 背景与现象

- chat / 会话界面里的扩展自写文案（空态 hero「探索未至之境」、placeholder「描述你想要构建的内容」、「加载会话…」、「服务未就绪，暂时无法发送」等）在 `src/ui/chat/webview.ts` 和 `src/ui/chatView.ts` 里硬编码中文。
- webview 是独立 browser context，**调不了 `vscode.l10n`**，不能直接用宿主层的 l10n。

## 现状（2026-09-02 补充核实）

- webview.ts 内联 **201 处中文字面量**（按钮/菜单/aria-label/空态/错误提示/queue note 等），另 chatView.ts 有 124 行含中文（与 webview 共用的工作区树/会话菜单文案）；pure/workflowRun.ts（28）、pure/sessionTree.ts（52）是宿主和 webview 共用的纯函数文案，还没 i18n。
- 无任何注入本地化字符串的通道。
- 宿主侧 `vscode.env.language` 可取当前语言；`l10n/bundle.l10n.json`（英文基线 key=value）+ `l10n/bundle.l10n.zh-cn.json`（79 key）已落地（i18n-runtime）。
- 注入点已核实：webview 首帧 `post({type:'ready'})` 报到（webview.ts:127），宿主侧 `ChatTabHost` 有现成 postMessage 通道（chatView.ts:467），`ToWebviewMessage` 加一条消息类型即可。
- 存量文案直接改造成 key 形式工作量很大（201 处），建议**分文件分批推进**：本条目先做「注入通道 + t() 基础设施 + webview.ts 存量文案全量替换」，pure/ 两个文件及 chatView.ts 剩余文案作为后续条目。

## 方案

- 扩展宿主把当前 `locale` + 相关译文（或 `l10n.bundle`）经消息协议塞进 webview，webview 端读一个注入的 `l10n` map 来取文案。
- webview.ts 加模块级 `t(key)`（仿 `vscode.l10n.t` 的 key=英文默认串 → 查注入 map，缺 key 返回 key 本身），存量 201 处中文字面量替换：英文默认串进 `l10n/bundle.l10n.json`（基线），中文译文进 `l10n/bundle.l10n.zh-cn.json`。
- **边界**：只 i18n 扩展自写的文案；真正由 **dsh 服务下发**的消息文本、字段名不是 i18n 对象，别动。
- locale 变化（用户切换显示语言后窗口 reload）时 webview 重载会重新走 ready 握手，宿主按当前 `vscode.env.language` 重发一次 bundle 即可，无需持久化。

## 涉及代码位置

- `src/ui/chat/webview.ts`（文案取用）
- `src/ui/chatView.ts`（host 侧，把 locale/bundle 经消息交给 webview）

## 备注

- 依赖 `i18n-manifest` / `i18n-runtime` 先落地（建立 locale 与译文来源），这条后置。

## 变更记录

- 2026-09-01 记录 → open
- 2026-09-02 补充核实（201 处中文字面量、bundle 现状、注入点），范围调整为「通道 + 基础设施 + webview.ts 存量替换」→ 认领 → doing
- 2026-09-02 开发完成，自测通过（typecheck + 336 test + build）→ done
- 2026-09-02 用户 visual 验收发现侧栏漏翻：补做侧栏 sessionsWebview 通道 + pure 模块共享文案（ac1b952），复跑自测 → done

## 开发完成（2026-09-02，worktree agent/i18n-webview）

- 基础设施：`chatHtml` 注入 `window.__DSH_L10N__`（CSP nonce 内联，JSON 转义 `</`）；宿主 `loadWebviewL10n` 按 `vscode.env.language` 读 `l10n/bundle.l10n.<locale>.json`（en 不注入）；webview 加模块级 `t()`（key=英文默认串，支持 `{0}`/`{name}` 占位，缺 key 回退 key 本身）。
- 存量替换：webview.ts 201 处中文字面量 → 186 个 `t()` key（含 27 处插值模板）；两个依赖中文 title 的 CSS 选择器（权限模式/模型 pill）改 `data-role` 定位。
- `l10n/bundle.l10n.json` + `zh-cn.json` 补 185 个 key（zh/en 对齐，占位符一致，任务清单校验通过）。
- **侧栏补全（ac1b952，用户 visual 验收发现）**：sessionsView/sessionsHtml 加 l10n 注入通道（`loadWebviewL10n` 移到 chatViewHtml 共享）；sessionsWebview.ts 43 处中文改 `t()`；pure 模块共享文案支持注入 t（sessionTree/workflowRun/activityTree/sessionStats/agentPreset），宿主调用点传 `vscode.l10n.t`、webview 传内联 `t`；ui/webview.ts 状态页改 `vscode.l10n.t`；bundle 补 65 个 key。`i18n-pure-modules` 条目内容已在本次覆盖，无需再单独开发。

### 人工验收方法（dev-ui-test，命令见 worktree-dev-flow skill）

1. 中文环境：默认（不改 locale）起隔离实例 → 全部界面文案应为中文，与改动前一致（空态「dsh 聊天/在会话列表中点击…」、模型菜单、「已复制」反馈、权限/模型 pill 悬停 tooltip、侧栏「从列表移除」「2 分钟前」等）。
2. 英文环境：`--locale=en` 起实例 → 同界面显示英文（Empty state / Copy / Copied / Model / Permission mode / Remove from list / 3 minutes ago 等）。
3. 无 key 泄漏：任一 locale 下界面不应出现 `%key%` 或裸英文 key 混入中文界面。
