# 发布流程 skill（release-gate skill）

记录于 2026-09-02。release-gate 发布门禁完成后，用户要求把发布过程写成 skill 指导操作：skill 分「怎么做（发布执行）」和「怎么验收（独立验收）」两部分，两部分分两个子代理完成。

## 背景与现象

- `scripts/release-gate.sh` 已实现发布门禁（两段式：bump 收口 → 干净打包验 vsix → 打 tag），`docs/release-checklist.md` 是人工验收清单。
- 但整个发布操作还没有成文的 agent 操作指导：谁来跑、谁验收、子代理怎么分工，都是隐式的。

## 方案

- 新增 `.agents/skills/release-gate/SKILL.md`（随仓库走，项目级 skill）：发布执行与独立验收分两个子代理——发布子代理跑 release-gate.sh 两段式（版本号由调用方给定，不擅自决定；不跑 vsce publish），验收子代理独立重跑自动化校验（dry-run 一致性 / unzip 验 vsix 内容与版本 / git 验 tag==打包 commit）并生成人工 GUI 验收清单；沙盒装机（GUI）headless 子代理做不了，归人。
- skill 内含两个子代理的 prompt 模板，调用方（主 agent / 人）按分工派发。

## 涉及代码位置

- `.agents/skills/release-gate/SKILL.md`（新增）
- 引用 `scripts/release-gate.sh`、`docs/release-checklist.md`、`docs/development.md`（release-gate 条目产物，随 release-gate 分支合入）

- 2026-09-02 记录 → open
- 2026-09-02 认领 → doing（并行开发 session）
