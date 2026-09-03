# 修正 vsce publish 发布已有 vsix 的命令写法

记录于 2026-09-03。用户首发 1.0.0 时跑 `npx vsce publish /tmp/dsh-relcheck/dsh-one-1.0.0.vsix` 报 `Invalid version`。

## 根因

`vsce publish` 的位置参数是版本号（version bump），不是文件路径；发布已打包的 vsix 要用 `-i, --packagePath <paths...>`（`npx vsce publish --help` 实测确认）。仓库文档和脚本输出里写的 `npx vsce publish dsh-one-<x.y.z>.vsix` 是错的。

## 建议方案

把错误写法统一改成 `npx vsce publish --packagePath dsh-one-<x.y.z>.vsix`：

- `docs/development.md:64`
- `scripts/release-gate.sh:156`（提示输出）
- `.agents/skills/release-gate/SKILL.md:66`
- `docs/backlog/open/marketplace-publish.md` 追加一行修正记录（历史行不改）
- 2026-09-03 认领（open → doing）
- 2026-09-03 修复完成，自测通过（doing → done）
- 2026-09-03 主线合入（复测通过），docs/脚本提示修正，无功能变更，转 closed
