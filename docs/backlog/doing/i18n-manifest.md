# i18n：manifest 层（package.nls）

记录于 2026-09-01。来自发布流程讨论：插件期望支持中英两种语言，先从成本最低、收益最大的 manifest 层开始。

## 背景与现象

- 所有文案硬编码中文，无任何 i18n 文件（无 `package.nls.*`、无 `l10n/`）。
- manifest 层文案（命令标题、配置描述、view/activitybar 名、displayName/description）全中文；marketplace 上有英文用户。

## 现状

- `package.json` 的 `contributes`（commands/config/views/viewsContainers）与 `displayName`/`description` 全是中文，直接内联在 JSON 里。
- VS Code 标准做法是 `package.nls.json`（英文底稿） + `package.nls.zh-cn.json`（中文覆盖），`package.json` 里引用 `%key%`。

## 方案

1. 新增 `package.nls.json`（英文 base）+ `package.nls.zh-cn.json`（中文）。
2. 把 `package.json` 里 contributes / displayName / description 的中文字面量改成 `%xxx%` 引用，翻译放进两个 nls 文件。
3. 默认语言按 VS Code 约定为英文 base（英文用户/fallback 看英文，中文用户看中文）。若想中文优先，把中文放 base、英文放 `package.nls.json`——但 marketplace 英文更通用，倾向标准做法。

## 涉及代码位置

- `package.json`（contributes / displayName / description 改 `%key%`）
- `package.nls.json`、`package.nls.zh-cn.json`（新增）

## 备注

- 只覆盖 manifest 层；运行时/宿主文案走 `i18n-runtime`，webview 走 `i18n-webview`。

- 2026-09-01 认领 → doing（并行开发 session）
