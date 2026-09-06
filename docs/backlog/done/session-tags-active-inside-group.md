# 活跃会话留在标签组块内（组块是容器），只有未分组活跃会话平铺最外

## 背景与现象

用户提出（2026-09-06 主线排查）：会话明明在「进行中」组里（行菜单勾选确认），但侧栏列表完全看不到组块——组内会话全部活跃（2 个 RUN + 1 个待交互）时组块整体消失，只剩平铺行，看起来像分组功能失效。用户确认期望的语义：**组块是容器，组内会话（含运行中/待交互）都显示在组块里，活跃的排组块内部最上面，其余按时间排序；只有没打组的活跃会话才平铺在最外面。**

## 核实结论（2026-09-06，现象属实，根因是渲染/排序语义）

现状（两条链路共同作用）：

1. **纯层排序**（`src/pure/sessionTree.ts` 的 `toSessionNodes` sort）：
   `置顶 → 活跃（any 状态标记）→ 标签组聚合（组块序）→ 无组殿后`。活跃会话被整体提前、脱离组块序列。
2. **渲染聚合**（`src/ui/sessionsWebview.ts` 的 `tagBlockItems`）：
   `if (s.pinned || s.active || tag === undefined) → 平铺`。组块只聚合「同 tagId 的连续空闲段落」；组内会话全活跃时组块没有空闲成员 → 组块壳不创建。

数据侧无问题：globalState 的 `sessions.tags` / `sessions.sessionTags` 完整，菜单「进行中 ✓」正确（本次诊断中还顺带确认了「已完成」组 5 个会话全部被归档、组内无成员的另一条消失路径，属预期行为）。

## 期望（用户拍板）

- 组块是容器：有组的会话（无论是否活跃）都渲染在组块内。
- 组块内排序：活跃会话（运行中/后代运行/未读/待交互）排组内最上（组内按 updatedAt 降序），其余按当前 sort 键。
- 未分组活跃会话：平铺在最外面（置顶之后、组块之前；组内活跃不脱离组块后，「最上面」仅指无组活跃）。
- 组块顺序不变（tags 定义数组序）；未分组空闲殿后。

## 需要用户拍板的细节

- **折叠组块时组内活跃会话是否也被藏住**：~~旧语义「活跃会话不被折叠组藏住」（d66787c/`session-tags-active-first-collapse` 场景）；新语义「组内活跃在组块内」，折叠后天然会被藏。二选一：① 组块折叠 = 全隐藏（含活跃，简单一致）；② 折叠仅藏空闲行、活跃行仍平铺可见（保留「运行中/待交互必须可见」的既有保证）。~~ **用户拍板（2026-09-06）：折叠就全藏**——组块折叠 = 组内所有会话（含活跃）都隐藏，只留 pill；展开后组内活跃仍排顶部。旧「活跃不被折叠藏住」语义随本条目推翻。
- **折叠组头计数**（`statusBuckets`）：计入组内活跃会话（组内活跃也参与聚合，与展开态可见性一致）——即折叠计数按组内全部会话的状态统计，活跃/未读/待交互都计入。`session-tags-active-first-collapse` 场景的期望需相应更新（原「组内唯一行空闲故无计数角标」不再成立，组内活跃需计数）。

## 涉及文件

- `src/pure/sessionTree.ts`：sort 比较器改为「未分组活跃最前 → 组块（组内活跃优先，活跃组内 updatedAt 降序）→ 空闲按 sort」；tagId 投影不变
- `src/ui/sessionsWebview.ts`：`tagBlockItems` 去掉平铺条件中的 `s.active`（有 tag 即聚块）；折叠处理随拍板结果
- `test/sessionTree.test.ts`：排序断言调整（active 进组内的用例）
- `test/ui/scenarios.js`：`session-tags-active-first` / `session-tags-active-first-collapse` 等场景期望更新（进行中组块应存在、活跃在其内），必要时新增场景
- 视觉自测：`ai-visual-validation` 核对组块内活跃排序

## 变更记录

- 2026-09-06 主线排查「标签页分组不能用了」：核实现象（组内全活跃 → 组块整体消失）与根因（排序/渲染的 active-脱离-组块语义）；用户拍板新语义（组块是容器，组内活跃排组内最上，未分组活跃才平铺最外）；随后拍板折叠细节（折叠就全藏，含活跃；计数计入组内全部会话）→ 建条目（open/）

- 2026-09-06 开发完成（doing → done）：主线语义核定后开 worktree（agent/session-tags-active-inside-group）。改纯层排序（三层：置顶 → 未分组活跃 → 组块-组内活跃前置 → 无组空闲，tagIdOf 统一降级）+ 渲染聚合（tagBlockItems 去掉 s.active 平铺条件，有组即聚块；折叠全藏含活跃；计数计入组内全部会话）。单测 614 全过（sessionTree 56 项，含新层级断言），ai-visual-validation 场景核对通过（F-01..F-04），基线 62 场景回归通过（R-01..R-03），dev-finish 打标 done/session-tags-active-inside-group，验收报告 test/sandbox/verify.session-tags-active-inside-group.report.html
