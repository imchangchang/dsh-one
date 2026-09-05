# 工作区右键「分组…」子菜单：hover 不展开 + 点击后顶层菜单消失

## 问题现象（用户 2026-09-05 报告，附截图）

Sessions 面板工作区行右键菜单里，「分组…」项（带 › 子菜单指示）两处交互缺陷：

1. **悬停不展开**：鼠标移到「分组…」上不会出现二级菜单，必须点击才显示（VS Code 惯例是 hover 展开 submenu）。
2. **点击后顶层菜单消失**：点击「分组…」后，二级菜单（组名多选）出现，但顶层 6 项菜单整体消失了——两个菜单本应并存（二级菜单锚在「分组…」项右侧）。

## 根因（代码核实）

`src/ui/sessionsWebview.ts` 的 popover 是**单例**：`showPopoverAt` / `showPopover` 打开新菜单前都调 `disposePopover()` 移除旧菜单 DOM。`showWorkspaceGroupsSubmenu` 走 `showPopoverAt`（:2580），点击「分组…」时把顶层右键菜单整个 remove 掉——单例结构不支持两级菜单并存。

「分组…」项的展开只绑了 `click`（`buildWorkspaceGroupsMenu` :2539），没有 hover 展开逻辑。

## 为什么视觉测试没测出（反思结论）

harness 场景 `sessions-workspace-menu-groups` 存在、且模拟的正是真实路径（contextmenu 打开 → 点 Groups… → 截图），截图拍到的是 bug 态（顶层菜单已消失，只剩二级菜单）。但验收核对漏判：

- 期望措辞「右缘对齐顶层菜单，不覆盖 6 项」——实际是「整层消失」而非「覆盖」，核对时容易按「二级菜单没遮住什么」放行；ledger F-03 的 notes 也只记录了「核对初始勾选态（演示 ✓/开发 ✓/日常 0）」，没有把「顶层菜单仍保持打开」列为独立检查点。
- 交互脚本把「打开主菜单 + 点击二级入口」两步合成一次同步执行，截图只有终态，没有「打开主菜单后」的中间态对照。
- hover 展开行为从未被场景化（现有场景只测 click 路径），悬停交互的回归盲区。

## 修复方向

- popover 支持两层：二级菜单用独立的 `showSubPopoverAt`（不清主菜单），`onPopoverOutside`/`disposePopover`/Esc/blur 统一把两层纳入关闭。
- 「分组…」项加 hover（pointerover）展开，click 保留为幂等入口；hover 移到其他菜单项/菜单外时收起二级菜单（带短延时缓冲横穿间隙）。
- 更新 harness 场景：明确「顶层 6 项菜单保持完整显示、与二级菜单并存」，新增 hover 展开场景。

## 涉及代码位置

- `src/ui/sessionsWebview.ts`：popover 双层化（showSubPopoverAt / disposeSubPopover / onPopoverOutside 扩展）、buildWorkspaceGroupsMenu 加 hover、showWorkspaceGroupsSubmenu 改走子层
- `test/ui/scenarios.js`：`sessions-workspace-menu-groups` 期望强化 + 新增 hover 展开场景

## 变更记录

- 2026-09-05 问题记录（open）：上述现象与根因；视觉测试在 main 复现（截图 /tmp/dsh-ui-shots/sessions-workspace-menu-groups.png 显示顶层菜单消失）。
- 2026-09-05 认领（open -> doing）：worktree 开发（分支 agent/workspace-groups-submenu-hover）。
- 2026-09-05 开发完成（doing -> done）：popover 双层化——二级子菜单（showSubPopoverAt）独立于顶层菜单，点击「分组…」不再移除顶层 6 项菜单；「分组…」项改为 hover（pointerover）展开 + click 兜底（幂等不重建）；hover 移出时 140ms 延时收起子层。harness 场景重写（hover/click 两路径 + 移出收起 + 期望明确「顶层菜单并存」），hover 场景升级进 BASELINE_SCENARIOS；顺带校正归档禁用场景期望文本（tooltip 实际在锚点上方）。测试报告 test/sandbox/verify.workspace-groups-submenu-hover.report.html：8 项全 pass（harness 4 定制场景 + 124 场景全量回归 + 单测 495 pass），分支 agent/workspace-groups-submenu-hover，done 标记 c7075fd。无宿主链路改动，未跑沙盒 E2E（视觉场景即覆盖交互语义）。
- 2026-09-05 主线合入后人工确认（监控验收通过）→ closed
