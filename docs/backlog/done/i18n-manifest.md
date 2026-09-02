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

## 落地与人工验收

- 用户已确认默认语言策略：**英文 base**（`package.nls.json` 英文，`package.nls.zh-cn.json` 中文覆盖）；视图名 `Sessions`（已是英文）保持不动、不本地化。
- 改动：`package.json` 的 `description`、`contributes.commands[].title`（16 条）、`contributes.configuration.properties[].description`（3 条）、`contributes.icons.dsh-fish.description` 改为 `%key%` 引用；key 命名镜像 command/property id。`displayName`、命令 `category`、`viewsContainers.title`、`configuration.title`（均为品牌名 "DSH One"）与视图名 `Sessions` 保持字面量。两个 nls 文件 21 个 key 全对齐（脚本校验，无缺失/多余/残留中文字面量）。
- 人工验收方法（真实 VSCode，合入前主线窗口验证）：
  1. `cd <repo>/.worktrees/i18n-manifest && bash <repo>/scripts/dev-ui-test.sh`——默认英文环境：命令面板（Cmd+Shift+P）搜 "DSH One" 应见英文命令名（Open Panel / Restart Service / Stop Service / Show Logs / New Session 等）；设置页搜 `dshOne` 配置描述为英文。
  2. 中文环境：用同一命令但追加 `--locale=zh-cn` 启动（`code` 命令最后加参数），或窗口内 "Configure Display Language" 切中文后 Reload Window——命令名应恢复中文（打开面板 / 重启服务等），与改动前一致。
  3. 任何界面出现 `%xxx%` 字面量 = key 缺失（不应出现）。

- 2026-09-01 认领 → doing（并行开发 session）
- 2026-09-01 开发完成，自测通过（typecheck / 253 tests / build 全绿）→ done
