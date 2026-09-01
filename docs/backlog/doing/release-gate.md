# 发布门禁（release-gate）

记录于 2026-09-01。来自发布流程讨论：仓库在开发/合入侧有 dev-finish / dev-merge 自测，但发布侧只有手工步骤，没有可跑的门禁脚本。

## 背景与现象

- 开发流程闭环了：worktree 开发 → dev-finish 自测（typecheck/test/build）→ dev-merge 合入。但**发布**这一步没有任何可执行的 gate，只靠 `docs/development.md` 里手工的发版步骤 + 人工点验清单。
- 结果：发布质量完全依赖人记，版本号、CHANGELOG、tag、vsix 产物之间没有强绑定，容易漏（改了版本忘 tag、或 tag 了没更新 changelog、或发布的 vsix 不是验收过的那份）。

## 现状

- `docs/development.md` 有「发版流程」（改 publisher / 更新 version+CHANGELOG / typecheck+test+package / vsce login+publish）和「发 marketplace 前的人工点验清单」，全是手工步骤。
- `package.json` 已有 `publisher: cgeng`、`icon`、`repository`、`license`；`vsce package` 零报错零警告。

## 方案

新增可跑的门禁脚本 + 验收清单，把发布串成一条：

1. `scripts/release-gate.sh`（自动化部分）：
   - bump `package.json` version + 把 `CHANGELOG [Unreleased]` 收口成 `[x.y.z]`
   - 干净 checkout `npm ci` → `typecheck + test + build + vsce package`
   - 验 vsix 内容（`dist/*`+`assets/*`+package.json+README+LICENSE、无 src/test/docs/map/ts）**和版本号 == 锁定版本**
   - 打 `git tag v<version>`（tag 与 commit、vsix 版本三处对应）
2. `docs/release-checklist.md`（人工部分，列成 checkbox）：沙盒装机验收（找 dsh / 复用服务 / webview / dsh 缺失降级）+ README/截图确认。
3. 发布的就是验收通过的那份 vsix，不重新打包。

## 涉及代码位置

- `scripts/release-gate.sh`（新增）
- `docs/release-checklist.md`（新增）
- 复用 `docs/development.md` 的发版流程与人工点验清单（并入/替换）
- `package.json`、`CHANGELOG.md`（发布时更新）

- 2026-09-01 认领 → doing（并行开发 session）
