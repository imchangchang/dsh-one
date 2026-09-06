# 回合轨道栏在 480~748px 窗口宽度下压文字

记录于 2026-09-06。用户反馈：chat 窗口过窄时，右侧回合轨道栏（turn-rail）的刻度线和文字重叠，不合理。

## 根因（已核实）

- `.turn-rail-frame` 定位 `right: 6px; width: 28px`（足迹 34px），挂在 `.messages` 内容区右缘内侧；现有隐藏阈值只有 `@media (max-width: 480px)`。
- 内容列宽 `clamp(680px, 64cqw, 920px)`：面板宽 < 748px 时两侧留白 < 34px，刻度线必压文字（用户气泡右缘顶到列右缘，首当其冲）。
- 实测（turn-navigator 场景）：600px 重叠 34px（刻度线盖住用户气泡尾部）、740px 重叠 16px、800px 无重叠。
- 官方 dsh web 的做法（dsh-client-ui-conversation）：滚动容器两侧恒留 32px chrome 区（`--dsh-composer-side-clearance:16px`，`padding: 16px calc(clearance + 16px)`），轨道栏放进留白区（`right: calc(12px - (clearance + 16px))` 负值）——任何窗口都不压文字，代价是文字列恒窄 40px。

## 决策

2026-09-06 用户拍板：**窄窗口直接隐藏（748px 以下）**——文字宽度优先，轨道栏只在放得下的宽度出现；与现有 ≤480px 隐藏模式一致。备选方案（官方同款恒留 32px 侧边区）未采用。

## 修复

`src/ui/chatViewHtml.ts`：`@media (max-width: 480px) { .turn-rail-frame { display: none } }` 阈值 480px → 748px（748px 以上时内容列两侧留白 ≥ 34px，轨道栏自然放得下）。

## 涉及代码位置

- `src/ui/chatViewHtml.ts`（`.turn-rail-frame` + max-width 媒体查询，~1079 行）

- 2026-09-06 记录（实测重叠区间 + 官方方案对比）→ open
- 2026-09-06 认领（worktree: agent/turn-rail-narrow-hide）→ doing
- 2026-09-06 开发完成：@container(max-width:760px) 隐藏（阈值按最宽刻度 28px 精确推导，761px 刻度恰贴文字右缘实测）；自测通过（typecheck/612 tests/build）+ 全量视觉回归 158 场景；ledger: test/sandbox/verify.turn-rail-narrow-hide.ledger.json → done
