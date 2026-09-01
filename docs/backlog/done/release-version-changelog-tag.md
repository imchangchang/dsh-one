# 发布三件套一致性（version + release note + tag）

记录于 2026-09-01。来自发布流程讨论：版本号、release note、tag 目前是脱钩的三件事，靠人记容易漏。

## 背景与现象

- CHANGELOG 维护得很勤（`[Unreleased]` 里分 Fixed/Changed/Added，都写清），但 `package.json` 的 `version` 和它没有绑定。
- 发布时其实要**同时**做三件事：① bump `package.json` version；② 把 `CHANGELOG [Unreleased]` 收口成 `[x.y.z]`；③ 打 `git tag v<x.y.z>`。任何一件漏了，版本号、release note、产物就对不上（比如换版本忘 tag、tag 了没收口 changelog）。

## 现状

- 三件事全靠人工记忆；`vsce publish patch/minor` 只会自动 bump version，不收口 changelog、不打 tag。
- 无机制校验「tag == vsix 版本 == commit」。

## 方案

- 发布动作三件套强制绑定：bump version + 收口 changelog + 打 tag 作为一个原子步骤，由 `release-gate.sh`（见 `release-gate.md`）强制执行。
- 校验：`git tag v<version>` 指向的 commit == 打包出该 vsix 的 commit，vsix 内版本 == `package.json` version。
- 若暂不做 release-gate.sh，也至少约定「发布清单里三件事一起做、互相勾选」。

## 涉及代码位置

- `package.json`（version）
- `CHANGELOG.md`（[Unreleased] 收口）
- `scripts/release-gate.sh`（如做，见 `release-gate.md`）
- `docs/development.md`（发版流程）

- 2026-09-01 认领 → doing（并行开发 session）
- 2026-09-02 开发完成，自测通过 → done。随 release-gate 一起实现：`scripts/release-gate.sh --apply` 两段式把「bump version + 收口 CHANGELOG + 打 tag」绑成原子流程（第一遍改文件停下人工 review/commit，第二遍干净打包后打 tag），并校验 vsix 内版本 == package.json version == CHANGELOG [x.y.z] == tag v<x.y.z> 指向打包 commit；`docs/development.md` 发版流程已引用。人工验收方法：在干净仓库跑 `scripts/release-gate.sh --apply` 完整走一遍，确认三件套一致性校验输出通过（dry-run 也可对已产出 vsix 复验）。
