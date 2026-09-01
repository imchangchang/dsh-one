# i18n：webview 层（把 locale 送进 webview）

记录于 2026-09-01。来自发布流程讨论：webview 是独立浏览器上下文，调不了 `vscode.l10n`，是最麻烦的一层，建议后置。

## 背景与现象

- chat / 会话界面里的扩展自写文案（空态 hero「探索未至之境」、placeholder「描述你想要构建的内容」、「加载会话…」、「服务未就绪，暂时无法发送」等）在 `src/ui/chat/webview.ts` 和 `src/ui/chatView.ts` 里硬编码中文。
- webview 是独立 browser context，**调不了 `vscode.l10n`**，不能直接用宿主层的 l10n。

## 现状

- 文案内联在 webview.ts / chatView.ts（CHANGELOG 反复提到对齐官方 dsh web 的这些文案）。
- 无任何注入本地化字符串的通道。

## 方案

- 扩展宿主把当前 `locale` + 相关译文（或 `l10n.bundle`）经消息协议塞进 webview，webview 端读一个注入的 `l10n` map 来取文案。
- **边界**：只 i18n 扩展自写的文案；真正由 **dsh 服务下发**的消息文本、字段名不是 i18n 对象，别动。

## 涉及代码位置

- `src/ui/chat/webview.ts`（文案取用）
- `src/ui/chatView.ts`（host 侧，把 locale/bundle 经消息交给 webview）

## 备注

- 依赖 `i18n-manifest` / `i18n-runtime` 先落地（建立 locale 与译文来源），这条后置。
