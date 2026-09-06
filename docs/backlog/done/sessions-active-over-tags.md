# 侧栏会话排序层级调整：活跃会话 > 标签组 > 时间序

记录于 2026-09-06。用户要求：会话列表里正在运行和待交互的对话排最上面，其次是标签页（标签组聚合），最下面是按时间排序的其他任务。

## 现状（已核实）

`src/pure/sessionTree.ts` 的 `toSessionNodes` sort 层级为：置顶（绝对优先，不参与组块）→ 标签组聚合（组块序）→ 活跃优先（running / 后代运行 / 未读 / 待交互）→ sort 键（updatedDesc/updatedAsc/title）。

即标签组聚合在活跃层之前：打了标签的整组空闲会话（组块序靠前的组）会排在被标记（运行中/待交互等）的会话前面，活跃会话只是在自己组内浮到组首，达不到「活跃的最上面」。且活跃会话带 tagId 时会被收进折叠组块，被折叠藏住。

## 建议方案

- 纯层 sort 层级改为：置顶 → 活跃（组内 updatedAt 降序不变）→ 标签组（组块序，组内按 sort 键）→ 其余按 sort 键。
- `SessionNodeModel` 增加 `active: boolean` 透传渲染层（与行尾状态标记/活跃判定同义），避免渲染层重复四桶判断（running/后代运行/未读/待交互）。
- `src/ui/sessionsWebview.ts` `appendTagBlocks`：非置顶活跃会话脱离组块平铺（与置顶同款语义），组块只聚合非活跃会话——否则活跃会话被折叠组藏住，且排序后同 tag 行不连续会造成组块头重复。

## 涉及代码位置

- `src/pure/sessionTree.ts`（`toSessionNodes` sort 305-327、`SessionNodeModel` 59-97、文件头注释）
- `src/ui/sessionsWebview.ts`（`appendTagBlocks` 1535-1578）
- `test/sessionTree.test.ts`（既有 tag 聚合测试 856-937、活跃优先测试 403-420）

- 2026-09-06 记录（用户提出排序层级要求，现状核实 + 方案）→ open

- 2026-09-06 认领（用户确认修改，开始开发）→ doing

- 2026-09-06 开发完成（自测 614 项 + typecheck + build 过；ui-visual.sh 158 场景视觉核对过；沙盒 R-01 聊天链路回归过；报告 test/sandbox/verify.sessions-active-over-tags.report.html 6 项全 pass）→ done
