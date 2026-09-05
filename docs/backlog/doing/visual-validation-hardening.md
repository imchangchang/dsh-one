# 视觉验证流程加固：隐藏态场景 + 版式断言 + 布局改动全量 before/after

## 背景与现象

a0c0d17（聊天列 748 限宽）把 chat 区布局弄坏却通过了视觉验证。事后 before/after
全量回归（138 场景）实锤：jump-latest 撑通栏、compaction/workflow 卡错位——这些
破坏当时的验收一个都没看到。

## 失守原因（逐条）

1. **验收范围自选**：只截了 3 个「自证改动有效」的场景（conversation/json-message-fenced/
   tool-cordis-run），没有对全量场景逐张核对；改动是 `.messages > *` 全局通配，爆炸半径
   是所有流内元素，验收却只覆盖了消息行。
2. **隐藏态无场景**：jump-latest 只在滚动上翻时出现，harness 默认隐藏 → 从不出现在
   任何截图里，破坏完全不可见。
3. **expect 缺版式断言**：compaction-cards / workflow-running 等场景的 expect 只写
   「有什么」，不写「和谁对齐」——错位不违反 expect 字面，语义核对放行了。
4. **基线集覆盖不全 + 合入后未跑**：compaction-cards / turn-navigator / goal-stack 不在
   BASELINE_SCENARIOS；且合入后主线没有跑 `--mode baseline` 的记录。

## 改进项（随 chat-column-layout 修复一并落地）

- 新增场景：`jump-latest-visible`（interactSteps：滚动上翻 → 浮标出现，截可见态）。
- expect 补版式断言：compaction-cards / workflow-running / conversation 等写明
  「与消息列同列对齐/左右缘对齐关系」。
- BASELINE_SCENARIOS 扩充：compaction-cards、turn-navigator、goal-stack、jump-latest-visible。
- `ai-visual-validation` SKILL.md 补条款：**改动容器级/通配 CSS 规则时，验收必须
  mode=all 全量截图并逐张核对；布局类改动建议附 before/after 像素 diff 分类清单**
  （diff 只用于「哪些场景变了」的分诊，判定仍靠语义核对）。
- ui-visual.sh 可选：支持 DSH_UI_SHOTS 输出目录已有；before/after 对比脚本
  （/tmp/imgdiff.py 模式）沉淀成 scripts/ui-visual-diff.sh。

## 涉及代码位置

- `test/ui/scenarios.js`、`scripts/ui-visual.sh`、`.agents/skills/ai-visual-validation/SKILL.md`

## 变更记录

- 2026-09-06 用户要求反思「为什么当时能过验」并确保不再发生 → 逐条归因 + 改进项，
  建条目并认领（open → doing），随 chat-column-layout 一并落地
