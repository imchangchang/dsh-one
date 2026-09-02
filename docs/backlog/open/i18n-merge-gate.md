# i18n 合入门禁：每个合入主线的分支检查是否需更新 i18n

记录于 2026-09-02。用户要求:i18n 相关处理完后,给合入流程加门禁——每个合入主线的分支都要检查是否需要更新 i18n(manifest nls / 宿主 l10n bundle / webview 文案表)。

## 背景与现象

- i18n 分三层:manifest(`package.nls.*`)、宿主运行时(`l10n/bundle.l10n.*`)、webview(待做)。三层都是「新增/修改用户可见文案时,必须同步补对应语言的文件」,否则英文用户看到中文、或出现 `%xxx%`/裸 key。
- 目前无任何检查:分支开发时漏翻,合入后才发现,只能在主线再开修复 worktree,来回成本高。
- 合入唯一入口是 `scripts/dev-merge.sh`(worktree-dev-flow 串行合入),门禁放这里最顺——所有分支都走它。

## 方案（待确认，2026-09-02 用户补充：文档层也纳入检查）

在 `dev-merge.sh` 校验阶段加一步 i18n 检查（独立脚本 `scripts/check-i18n.sh`，可单跑）：

- 对「待合入分支相对 main 的 diff」检查三类必改文件是否同步：
  1. **宿主层**：`src/**`（扩展开关的入口）出现新增 `vscode.l10n.t('...')` → key 必须同时存在于 `l10n/bundle.l10n.json`（英文基线）。
  2. **webview 层**：`src/ui/chat/webview.ts`、`src/ui/sessionsWebview.ts` 等出现新增 `t('...')`（webview 文案表 key）→ 译文表必须同步。
  3. **manifest 层**：`package.json` 的 contributes 文案改 `%key%` → `package.nls.json` / `package.nls.zh-cn.json` 必须同步。
- **文档层（2026-09-02 补充，用户要求）**：README / README.zh-CN 等文档里引用用户可见文案的地方（命令标题、状态栏文本、界面标签）必须与 manifest nls / 状态栏文案一致——中文命令名出现在英文 README、或改了命令标题却忘了 README 都属于漏同步。检查方式：diff 涉及命令标题 / 状态栏文案改动时，扫描 `README*.md` 里对应的旧字符串是否仍在；另加一次全量对照（英文 README 中不应出现中文命令引用，中文版本相反）。
- 同时兜底扫硬编码中文：diff 新增的 `src/**` 行里出现中文字符串字面量（排除注释、测试夹具），列为「疑似漏翻」——命中即视为检查失败（先报错，后续看误报率再决定是否降级为警告）。
- 检查失败 → dev-merge 拒绝合入，提示缺哪个文件的哪个 key。

## 已知存量问题（2026-09-02 已修）

- README.md（英文版）曾引用中文命令名（`DSH One: 打开 dsh 页面` 等 8 处），与 `package.nls.json` 英文标题不一致；已在 i18n-webview 分支顺手修正为英文命令名。README.zh-CN.md 中文命令名与 `package.nls.zh-cn.json` 一致，无需改。

## 待确认

- 检查粒度：整分支 diff 检查（推荐），还是只查「相对 merge-base 新增的行」？
- 硬编码中文扫描的误报处理：直接 fail，还是 warning 允许人工 pass？
- 门禁是 dev-merge 本地脚本，还是同步进 CI（仓库有 ci-platform-matrix）？
- 文档层检查范围：仅 `README*.md`，还是涵盖 `docs/*.md`（architecture/development/release-checklist 等）？

## 前置

- `i18n-webview`(webview 层文案表落地后,门禁的 webview 检查才有明确对账对象)
- `i18n-runtime` / `i18n-manifest`(已完成,对照逻辑已定)

## 涉及代码位置

- `scripts/dev-merge.sh`(校验阶段)
- `scripts/check-i18n.sh`(新增)
