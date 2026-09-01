# i18n：运行时层（l10n）

记录于 2026-09-01。来自发布流程讨论：manifest 层之外，扩展宿主运行时文案也硬编码中文。

## 背景与现象

- 扩展宿主里由代码直接产出的用户可见文案（状态栏 tooltip、通知、错误提示、日志等）硬编码中文。
- 这部分在 manifest 层（`package.nls`）覆盖不到，需要独立的运行时本地化。

## 现状

- 无 `l10n/` 目录、无 `vscode.l10n.t()` 调用，文案散落在宿主代码里。

## 方案

- 用 VS Code 的 `l10n` API：宿主文案改 `vscode.l10n.t('...')`，并在 `l10n/bundle.l10n.json` 提供译文；`package.json` 加 `"l10n": "./l10n"`。
- 新增 string 时在 bundle 里同步补 zh/en 译文，避免漏翻。

## 涉及代码位置

- `src/` 扩展宿主侧产生文案的模块
- `l10n/bundle.l10n.json`（新增）
- `package.json`（`l10n` 字段）

## 备注

- webview 里无法直接调 `vscode.l10n`（独立浏览器上下文），那条走 `i18n-webview`。
