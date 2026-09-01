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
- 2026-09-02 开发完成，自测通过 → done。产出：`.agents/skills/release-gate/SKILL.md`（发布执行 / 独立验收分两个子代理的流程指导，含两个子代理的 prompt 模板：发布代理跑 release-gate.sh 两段式，验收代理独立重跑 dry-run 一致性 / unzip 验 vsix / git 验 tag 并生成待人工清单；GUI 沙盒装机归人）。已用两个真实子代理完整演练发布 v0.3.0（发布代理两段式走通、验收代理 4/4 核验通过），演练真实抓出「.vscodeignore 未同步时门禁拦下脏产物」场景，已写入 skill 前置条件。人工验收方法：真实发版时按 skill 流程派两个子代理走一遍（或对照 SKILL.md 逐节核对 prompt 模板与流程），沙盒装机按 docs/release-checklist.md 人工验收。
